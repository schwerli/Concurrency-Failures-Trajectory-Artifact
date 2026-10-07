export const meta = {
  name: 'fix-autodoc-class-rtype',
  description: 'Fix autodoc_typehints=description adding a bogus :rtype: None to classes (issue 9575)',
  phases: [
    { title: 'Analyze', detail: 'parallel probes: objtypes, config matrix, test inventory, latent bugs' },
    { title: 'Implement', detail: 'apply the fix to sphinx/ext/autodoc/typehints.py + tests' },
    { title: 'Test', detail: 'run the autodoc test suites' },
    { title: 'Review', detail: 'adversarial verification across 4 lenses' },
  ],
}

const REPO = '/testbed'

phase('Analyze')

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'string', description: 'Detailed prose findings with file:line references' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings', 'risks'],
}

const probes = [
  {
    key: 'objtypes',
    prompt: `In ${REPO} (Sphinx source), the function merge_typehints in sphinx/ext/autodoc/typehints.py is
connected to the 'object-description-transform' event. Determine EXHAUSTIVELY:

1. Every place that emits 'object-description-transform' and what the \`objtype\` argument is (see
   sphinx/directives/__init__.py around line 201).
2. For the Python domain, enumerate ALL possible objtype string values (read sphinx/domains/python.py:
   PythonDomain.object_types / directives mapping). Which of those correspond to *class-like* objects
   whose recorded "return annotation" actually comes from __init__/__new__ rather than a real return
   value? Consider 'class', 'exception', and anything else.
3. Confirm HOW the annotations dict for a class gets a 'return' key: read record_typehints in
   typehints.py and sphinx/util/inspect.py signature() for a class object. Is the return annotation of
   a class always 'None', or can it be something else (e.g. a metaclass __call__, a __new__ with a
   non-None return annotation, or __init_subclass__)? Write a tiny python snippet with
   sphinx.util.inspect.signature to check a class whose __new__ is annotated -> "Square", and report
   the actual observed stringified return annotation.
4. Also check autodoc's ClassDocumenter: does it ever document a class with objtype 'exception'
   (autoexception)? Confirm by grepping objtype attributes in sphinx/ext/autodoc/__init__.py.

Return concrete file:line evidence and the observed output of any snippet you ran.`,
  },
  {
    key: 'matrix',
    prompt: `In ${REPO} (Sphinx source), read sphinx/ext/autodoc/typehints.py fully.

Build the COMPLETE behavior matrix for how a bogus return type can be emitted for an autoclass when
autodoc_typehints is 'description' or 'both':

- autodoc_typehints_description_target values are 'all' (default), 'documented', 'documented_params'
  (confirm from sphinx/ext/autodoc/__init__.py app.add_config_value and doc/usage/extensions/autodoc.rst).
- For each of the 3 values, trace exactly which function runs (modify_field_list vs
  augment_descriptions_with_types with force_rtype True/False) and whether an ':rtype:' field gets
  appended for a class whose __init__ is annotated '-> None'.
- Identify which code path(s) need changing, and which already correctly suppress it (quote the exact
  conditional expressions).
- Also consider: what if the class docstring itself contains an explicit ':rtype:' or ':returns:'
  field? Does the existing 'arguments'/'has_type'/'has_description' bookkeeping already handle it?
- Consider the 'both' setting too, not just 'description'.

Return the matrix as prose with exact line numbers and quoted conditionals.`,
  },
  {
    key: 'tests',
    prompt: `In ${REPO} (Sphinx source), inventory EVERY existing test that would be affected by making
autoclass stop emitting a ':rtype: None' / 'Return type: None' block for classes when
autodoc_typehints='description'.

Search tests/ (especially tests/test_ext_autodoc_configs.py) for assertions containing 'Return type'
or ':rtype:' that appear inside a 'class ...' documentation block. For each hit, report:
  - test function name + file:line
  - the exact assertion text snippet that mentions the class-level Return type
  - whether the Return type belongs to the CLASS entry or to a nested method (__init__, etc.)

Nested-method Return types must be PRESERVED; only class-level ones should disappear. Be precise
about indentation in the expected text (class-level fields are indented 3 spaces, method-level 6).

Also report the test fixture classes involved (e.g. tests/roots/test-ext-autodoc/target/typehints.py
_ClassWithDocumentedInit) and how to run the relevant test files with pytest.`,
  },
  {
    key: 'latent',
    prompt: `In ${REPO}, read the function modify_field_list in sphinx/ext/autodoc/typehints.py closely.

Look at the final block:
    if 'return' in annotations and 'return' not in arguments:
        field = nodes.field()
        field += nodes.field_name('', 'rtype')
        field += nodes.field_body('', nodes.paragraph('', annotation))
        node += field

Note that \`annotation\` here is the LOOP VARIABLE leaking from the preceding
\`for name, annotation in annotations.items():\` loop, not \`annotations['return']\`.

Determine rigorously:
1. Is this a real bug or masked? What guarantees the ordering of \`annotations\` (see record_typehints
   and the OrderedDict usage)? Could 'return' ever NOT be the last inserted key? Consider
   keyword-only params, *args/**kwargs, positional-only, and typing.overload handling.
2. What happens if \`annotations\` is empty ({})? Can modify_field_list even be reached then (check the
   \`if annotations.get(fullname, {}):\` guard in merge_typehints)?
3. Does any other caller/monkeypatch in the codebase or tests call modify_field_list directly?
   Grep for it.
4. Separately: when merge_typehints calls insert_field_list() and then NOTHING is added to that field
   list, is an empty nodes.field_list left in the doctree? What does the text/html writer render for
   an empty field_list? Does this already happen today for
   autodoc_typehints_description_target='documented'? Verify empirically if you can with a quick
   sphinx build in a temp dir.

Report concrete evidence.`,
  },
]

const analyses = await parallel(probes.map(p => () =>
  agent(p.prompt, { label: `analyze:${p.key}`, phase: 'Analyze', schema: ANALYSIS_SCHEMA })
    .then(r => ({ key: p.key, ...r }))
))

const valid = analyses.filter(Boolean)
log(`analysis complete: ${valid.map(a => a.key).join(', ')}`)

const brief = valid.map(a => `### ${a.key}\n${a.findings}\nRISKS:\n- ${(a.risks || []).join('\n- ')}`).join('\n\n')

phase('Implement')

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    diff: { type: 'string', description: 'Full unified diff of every change made (git diff output)' },
    rationale: { type: 'string' },
    testsAddedOrUpdated: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['diff', 'rationale', 'testsAddedOrUpdated'],
}

const impl = await agent(`You are fixing a real bug in the Sphinx repo at ${REPO}.

# Bug (upstream issue #9575)
With \`autodoc_typehints = "description"\`, \`.. autoclass::\` renders a bogus "Return type: None" for a
class, because the class's recorded signature annotations include the \`__init__\` return annotation
(\`-> None\`). A class has no return type; nothing should be emitted.

# Prior analysis from parallel investigation (trust but re-verify anything you rely on)
${brief}

# Your task
Implement the minimal, upstream-quality fix in ${REPO}/sphinx/ext/autodoc/typehints.py:

1. Give \`modify_field_list\` a new keyword parameter \`suppress_rtype: bool = False\`. In its final
   \`:rtype:\` block, bind \`annotation = annotations['return']\` explicitly (do NOT keep relying on the
   leaked loop variable), and \`return\` early without appending the field when
   \`annotation == 'None' and suppress_rtype\`.
2. In \`merge_typehints\`, for the \`autodoc_typehints_description_target == "all"\` branch, pass
   \`suppress_rtype=True\` when \`objtype == 'class'\`. Verify against the analysis whether 'exception'
   also needs it — if autoexception reaches this code with objtype 'exception' and exhibits the same
   bogus output, handle it too; if the evidence says otherwise, don't. State your decision and the
   evidence in \`rationale\`.
3. Keep the other two \`autodoc_typehints_description_target\` branches unchanged if the analysis
   confirms they already suppress \`rtype: None\` for classes.

Style rules: match the surrounding code exactly (typing style, no new imports unless needed, no
comments unless the surrounding code is commented, keep it terse). Do NOT reformat unrelated lines.

# Tests
- Update every existing test the analysis identified as asserting a CLASS-level 'Return type: None'
  under autodoc_typehints='description'. Remove only the class-level Return type block (mind the
  3-space vs 6-space indentation); nested \`__init__\` Return type blocks MUST stay.
- Add a regression test in tests/test_ext_autodoc_configs.py named
  \`test_autodoc_typehints_description_and_type_aliases\`-style neighbours, i.e. follow the existing
  naming/decorator conventions. Cover the exact issue: an autoclass with an annotated
  \`__init__(self, ...) -> None\` and no documented params, asserting NO 'Return type' appears for the
  class. Reuse existing fixtures in tests/roots/test-ext-autodoc/target/typehints.py where possible;
  only add a new fixture class if genuinely needed.
- Also add coverage asserting that a *method*'s '-> None' return type is still shown, so the fix
  cannot regress into suppressing method rtypes.

# Verify before returning
Run the relevant tests and iterate until green:
  cd ${REPO} && python -m pytest tests/test_ext_autodoc_configs.py -x -q
  cd ${REPO} && python -m pytest tests/test_ext_autodoc.py -q
Do not return until the tests you touched pass. Report the final \`git diff\` verbatim in \`diff\`.`,
  { label: 'implement', phase: 'Implement', schema: IMPL_SCHEMA })

if (!impl) return { error: 'implementation agent failed' }

phase('Test')

const TEST_SCHEMA = {
  type: 'object',
  properties: {
    command: { type: 'string' },
    passed: { type: 'boolean' },
    summaryLine: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
  },
  required: ['command', 'passed', 'summaryLine', 'failures'],
}

const suites = [
  'tests/test_ext_autodoc_configs.py',
  'tests/test_ext_autodoc.py',
  'tests/test_ext_autodoc_autoclass.py tests/test_ext_autodoc_autofunction.py tests/test_ext_autodoc_automodule.py',
  'tests/test_ext_napoleon_docstring.py tests/test_domain_py.py',
]

const testResults = await parallel(suites.map(s => () =>
  agent(`In ${REPO}, run exactly:
  cd ${REPO} && python -m pytest ${s} -q --no-header -p no:randomly 2>&1 | tail -40

Report whether it passed, the final pytest summary line verbatim, and for any failure the test id plus
the essential assertion diff (trimmed). Do NOT fix anything — report only.`,
    { label: `test:${s.split(' ')[0].replace('tests/', '')}`, phase: 'Test', schema: TEST_SCHEMA })
))

const failing = testResults.filter(Boolean).filter(r => !r.passed)
log(`tests: ${testResults.filter(Boolean).length - failing.length}/${testResults.filter(Boolean).length} suites green`)

phase('Review')

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['sound', 'flawed'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          summary: { type: 'string' },
          evidence: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['severity', 'summary', 'evidence'],
      },
    },
  },
  required: ['verdict', 'issues'],
}

const lenses = [
  {
    key: 'correctness',
    prompt: `Adversarially review the working-tree change in ${REPO} (\`git diff\`) for CORRECTNESS.
Try hard to REFUTE that it fixes issue #9575 properly. Default to flagging if uncertain.

Specifically attack:
- Does the class-level 'Return type: None' actually disappear? Prove it by BUILDING a real doc:
  create a temp dir with a sample_package/__init__.py containing the exact \`Square\` class from the
  issue report, a docs/conf.py with \`autodoc_typehints = "description"\`, and docs/index.rst with
  \`.. autoclass:: sample_package.Square\` + \`:members:\`. Run \`python -m sphinx -b text docs out\`
  using ${REPO}'s sphinx (set PYTHONPATH). Show the resulting text output.
- Does a class whose \`__init__\` returns a NON-None annotation (illegal but possible), or whose
  \`__new__\` is annotated \`-> "Square"\`, behave sensibly? Build and show output.
- Are method/function \`-> None\` return types still rendered? Prove with the same temp build
  (add a method \`def area(self) -> None:\` and a module-level \`def f() -> None:\`).
- Is \`suppress_rtype\` threaded correctly (keyword vs positional, default value)?
- Did the loop-variable-leak fix change behavior for any input? Reason about it concretely.`,
  },
  {
    key: 'coverage',
    prompt: `Adversarially review the working-tree change in ${REPO} (\`git diff\`) for TEST COVERAGE and
CONFIG-MATRIX completeness. Try to REFUTE that it is complete.

Attack:
- Run the full matrix by hand: for autodoc_typehints in {'description','both','signature','none'} x
  autodoc_typehints_description_target in {'all','documented','documented_params'}, does an autoclass
  ever still emit a class-level 'Return type: None'? Actually BUILD these (temp dir, text builder,
  ${REPO} on PYTHONPATH) rather than only reading code. Report a table of observed outputs.
- autoexception / a class deriving from Exception: is the bogus rtype gone there too? Build it.
- A class with \`autoclass_content = 'both'\` or a documented \`__init__\` (\`:special-members: __init__\`):
  is the __init__'s own Return type still present?
- A class with an explicit \`:rtype: int\` in its own docstring: is it preserved (not clobbered)?
- Do the new/updated tests actually assert the absence, or do they only assert a substring that would
  still pass if the bug returned? Check for weak assertions (e.g. \`in\` vs \`==\`).`,
  },
  {
    key: 'regression',
    prompt: `Adversarially review the working-tree change in ${REPO} (\`git diff\`) for REGRESSIONS in
tests that were EDITED. Try to REFUTE that the test edits are legitimate.

For every test assertion the diff modified:
- Did the author delete a class-level 'Return type' block (legitimate) or did they weaken/delete a
  method-level one, or delete an assertion outright to make it pass (illegitimate)?
- Check indentation carefully: class-level fields are indented 3 spaces in text output, method-level 6.
  Verify each deletion removed the right one.
- Run \`cd ${REPO} && git diff -- tests/\` and scrutinize every hunk.
- Re-run the edited tests and confirm they pass for the right reason, not by vacuous assertion.
- Also check that no test file lost coverage of the 'both' setting or of napoleon interaction.`,
  },
  {
    key: 'upstream',
    prompt: `Review the working-tree change in ${REPO} (\`git diff\`) for PROJECT-CONVENTION fit — would the
Sphinx maintainers accept this as-is? Try to find what's missing or off-style.

Check:
- Does the repo require a CHANGES entry for bugfixes? Read ${REPO}/CHANGES (top of file) and
  ${REPO}/CONTRIBUTING.rst / doc/internals/contributing.rst. If a CHANGES entry is conventional for a
  bugfix like this, report the EXACT text and placement it should have (matching the surrounding
  entries' format, correct version section, correct '#9575' issue reference) — and whether the diff
  includes one.
- Does the change need a docs update in doc/usage/extensions/autodoc.rst (e.g. the
  autodoc_typehints_description_target description)? Quote the current text and say yes/no with reason.
- Style: typing annotations on the new parameter, line length (check setup.cfg/tox.ini flake8 config),
  trailing whitespace. Run \`cd ${REPO} && python -m flake8 sphinx/ext/autodoc/typehints.py tests/test_ext_autodoc_configs.py\`
  and report output.
- Are there stray debug files, temp dirs, or unrelated changes in \`git status\`?`,
  },
]

const reviews = await parallel(lenses.map(l => () =>
  agent(l.prompt, { label: `review:${l.key}`, phase: 'Review', schema: VERDICT_SCHEMA })
    .then(r => ({ key: l.key, ...r }))
))

const allIssues = reviews.filter(Boolean).flatMap(r => (r.issues || []).map(i => ({ lens: r.key, ...i })))
const serious = allIssues.filter(i => i.severity === 'blocker' || i.severity === 'major')

log(`review: ${allIssues.length} issues (${serious.length} blocker/major)`)

return {
  rationale: impl.rationale,
  diff: impl.diff,
  testsAddedOrUpdated: impl.testsAddedOrUpdated,
  implNotes: impl.notes,
  testSuites: testResults.filter(Boolean).map(r => ({ cmd: r.command, passed: r.passed, summary: r.summaryLine, failures: r.failures })),
  failingSuites: failing,
  reviewVerdicts: reviews.filter(Boolean).map(r => ({ lens: r.key, verdict: r.verdict })),
  seriousIssues: serious,
  minorIssues: allIssues.filter(i => i.severity !== 'blocker' && i.severity !== 'major'),
}
