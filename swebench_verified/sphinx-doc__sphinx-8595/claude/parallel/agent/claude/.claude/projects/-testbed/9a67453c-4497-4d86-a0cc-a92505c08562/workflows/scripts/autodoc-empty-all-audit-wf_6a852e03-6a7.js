export const meta = {
  name: 'autodoc-empty-all-audit',
  description: 'Audit and verify the fix for autodoc ignoring an empty __all__ attribute',
  phases: [
    { title: 'Audit', detail: 'parallel lenses over __all__ handling, mocks, autosummary, docs' },
    { title: 'Verify', detail: 'adversarially refute each finding' },
    { title: 'Regress', detail: 'run the autodoc/autosummary/inspect test suites' },
  ],
}

const CONTEXT = `
Repository: /testbed (Sphinx, branch 3.x era, commit 1f7fdc263).

BUG REPORT: autodoc ignores an empty \`__all__\` attribute.
Given example.py with \`__all__ = []\` and functions foo/bar/baz, and
\`.. automodule:: example\` with \`:members:\`, all three functions are shown.
Expected: nothing shown, because __all__ is empty.

ROOT CAUSE (already located): in sphinx/ext/autodoc/__init__.py,
\`ModuleDocumenter.get_object_members\` used \`if not self.__all__:\` which conflates
\`None\` (module has no __all__ at all -> document implicit members) with \`[]\`
(module explicitly exports nothing -> document nothing).
\`sphinx.util.inspect.getall()\` returns None for "no __all__" and the list otherwise.

FIX ALREADY APPLIED to sphinx/ext/autodoc/__init__.py get_object_members:
  \`if not self.__all__:\`  ->  \`if self.__all__ is None:\`

Do NOT re-apply or re-edit that line. Read the current state of the file.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          detail: { type: 'string', description: 'What is wrong and the concrete failure scenario' },
          suggested_fix: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'important', 'nit'] },
        },
        required: ['title', 'file', 'detail', 'severity'],
      },
    },
    notes: { type: 'string', description: 'Anything checked and found correct' },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is NOT a real problem' },
    reasoning: { type: 'string' },
    evidence: { type: 'string', description: 'File:line or command output proving the verdict' },
  },
  required: ['refuted', 'reasoning'],
}

const LENSES = [
  {
    key: 'truthiness-sweep',
    prompt: `${CONTEXT}

LENS: exhaustive truthiness-vs-None sweep.
Find EVERY other place in sphinx/ (not tests) that reads \`__all__\` or the result of
\`inspect.getall()\` and uses truthiness where None-vs-empty matters. Grep for
\`__all__\`, \`getall\`, \`ignore_module_all\`. Examine at minimum:
  - sphinx/ext/autodoc/__init__.py ModuleDocumenter.import_object, get_object_members, sort_members
  - sphinx/ext/autodoc/importer.py
  - sphinx/ext/autosummary/__init__.py and generate.py
  - sphinx/util/inspect.py getall
For each site, state whether an empty-list __all__ now behaves correctly, and whether
the applied fix leaves any INCONSISTENCY (e.g. sort_members still using truthiness).
Report only real problems as findings.`,
  },
  {
    key: 'mock-modules',
    prompt: `${CONTEXT}

LENS: interaction with autodoc_mock_imports.
sphinx/ext/autodoc/mock.py \`_MockModule.__init__\` sets \`self.__all__ = []\`.
Before the fix, an empty __all__ was ignored so a mocked module documented its dir() members.
After the fix, \`__all__ == []\` means document NOTHING.
Determine concretely whether this changes behavior for any real or tested scenario:
  - Can a _MockModule ever be the target of an automodule directive / reach
    ModuleDocumenter.get_object_members? Trace import_object -> importer.import_module.
  - Look at tests/roots/test-ext-autodoc/target/need_mocks.py and any autodoc_mock_imports tests.
  - Run the relevant tests to check. Use: cd /testbed && python -m pytest tests/test_ext_autodoc_mock.py tests/test_ext_autodoc_automodule.py -x -q 2>&1 | tail -30
If mock modules are affected, say exactly how and whether mock.py should stop setting __all__ = [].
Report findings only if there is a genuine behavior regression.`,
  },
  {
    key: 'test-coverage',
    prompt: `${CONTEXT}

LENS: test coverage for the fix.
The repo has tests/test_ext_autodoc_automodule.py and tests/roots/test-ext-autodoc/target/.
Determine the idiomatic way this repo would test "empty __all__ documents nothing":
  - Read tests/test_ext_autodoc_automodule.py fully.
  - Read tests/test_ext_autodoc.py test_autodoc_ignore_module_all and the do_autodoc helper.
  - Read tests/roots/test-ext-autodoc/target/sort_by_all.py and target/__init__.py to see how
    __all__ fixtures are structured, and tests/roots/test-ext-autodoc/conf.py.
Then report, as a finding of severity 'important', the EXACT new test fixture file(s) and test
function(s) that should be added (full file contents / full test function source, matching this
repo's existing style, correct module paths and expected output lines). Do not write the files
yourself -- just specify them precisely. Also state whether any EXISTING test would now fail.`,
  },
  {
    key: 'existing-tests',
    prompt: `${CONTEXT}

LENS: regression detection. Actually RUN the tests and report real failures.
Run each and capture output:
  cd /testbed && python -m pytest tests/test_ext_autodoc.py -q 2>&1 | tail -40
  cd /testbed && python -m pytest tests/test_ext_autodoc_automodule.py tests/test_ext_autodoc_autoclass.py tests/test_ext_autodoc_autofunction.py -q 2>&1 | tail -40
  cd /testbed && python -m pytest tests/test_util_inspect.py tests/test_ext_autosummary.py -q 2>&1 | tail -40
Report any FAILED/ERROR test as a finding, quoting the assertion diff. If everything passes,
report zero findings and say so in notes with the pass counts.`,
  },
  {
    key: 'docs-and-changes',
    prompt: `${CONTEXT}

LENS: documentation and changelog.
  - Read CHANGES (top section) and determine the exact entry that should be added for this bugfix,
    matching the file's existing format (section, issue-number style). The upstream issue number
    for "autodoc: empty __all__ attribute is ignored" is 8628.
  - Read doc/usage/extensions/autodoc.rst and check whether the documented behavior of :members:
    with respect to __all__ needs a wording update for the empty case.
Report as findings the precise text to add and where (file + anchor line), severity 'important'
for the CHANGES entry, 'nit' for doc wording if merely optional.`,
  },
  {
    key: 'edge-cases',
    prompt: `${CONTEXT}

LENS: adversarial edge cases of the new \`is None\` check.
Reason through and, where possible, EMPIRICALLY TEST these combinations by writing a scratch
module under /tmp and driving autodoc (mirror tests/test_ext_autodoc.py's do_autodoc helper, or
build a tiny sphinx project and run sphinx-build):
  1. \`__all__ = []\` with \`:members:\`  -> expect no members, but module docstring/header still emitted.
  2. \`__all__ = []\` with \`:ignore-module-all:\` -> self.__all__ stays None -> all members shown.
  3. \`__all__ = []\` with explicit \`:members: foo\` (want_all False) -> should still document foo.
  4. \`__all__ = []\` with \`:undoc-members:\` -> still nothing.
  5. \`__all__ = ()\` (empty TUPLE) -> getall returns () which is also falsy; confirm the fix covers it.
  6. \`__all__ = []\` with \`:member-order: bysource\` -> sort_members still uses truthiness
     (\`and self.__all__\`); confirm no crash and no wrong behavior.
  7. A module whose \`__all__\` raises AttributeError, and an invalid \`__all__ = 'notalist'\`
     -> warning path, self.__all__ should remain None so members are shown.
  8. automodule with \`:imported-members:\` plus empty __all__.
Report any case whose ACTUAL behavior is wrong or surprising as a finding, with the commands and
observed output as evidence.`,
  },
]

phase('Audit')

const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `audit:${l.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (res, lens) => {
    if (!res || !res.findings || res.findings.length === 0) return []
    return parallel(res.findings.map(f => () =>
      parallel(['correctness', 'repo-conventions', 'does-it-reproduce'].map(view => () =>
        agent(`${CONTEXT}

A prior audit agent reported this finding from the "${lens.key}" lens:

  TITLE: ${f.title}
  FILE: ${f.file}${f.line ? ':' + f.line : ''}
  SEVERITY: ${f.severity}
  DETAIL: ${f.detail}
  SUGGESTED FIX: ${f.suggested_fix || '(none given)'}

Your job is to REFUTE it through the "${view}" lens. Read the actual files and run commands.
Default to refuted=true if you cannot concretely confirm the problem is real and worth acting on.
A finding about a test/CHANGES entry that SHOULD be added counts as real only if it is accurate
(correct paths, correct expected output, matches repo conventions) and not already present.`,
          { label: `verify:${view}:${f.title.slice(0, 28)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      )).then(votes => {
        const v = votes.filter(Boolean)
        const survives = v.filter(x => !x.refuted).length >= 2
        return { ...f, lens: lens.key, survives, votes: v }
      })
    ))
  }
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter(f => f.survives)
const rejected = all.filter(f => !f.survives)
log(`audit complete: ${confirmed.length} confirmed, ${rejected.length} refuted`)

phase('Regress')

const regress = await agent(`${CONTEXT}

Run the full relevant regression surface and report results verbatim.
  cd /testbed && python -m pytest tests/test_ext_autodoc.py tests/test_ext_autodoc_automodule.py tests/test_ext_autodoc_autoclass.py tests/test_ext_autodoc_autofunction.py tests/test_ext_autodoc_autoattribute.py tests/test_ext_autodoc_autodata.py tests/test_ext_autodoc_mock.py tests/test_ext_autodoc_configs.py tests/test_ext_autodoc_events.py tests/test_ext_autodoc_private_members.py tests/test_util_inspect.py tests/test_ext_autosummary.py -q 2>&1 | tail -40
Also confirm the fix works end to end: create /tmp/emptyall_check/example.py with
\`__all__ = []\` and three documented functions foo/bar/baz plus a minimal sphinx project
(conf.py with extensions=['sphinx.ext.autodoc'] and sys.path insert, index.rst with
automodule example :members:), run sphinx-build -b text, and report whether foo/bar/baz appear.
Then repeat with \`__all__ = ['foo']\` to confirm foo alone appears, and with no __all__ at all
to confirm all three appear.
Return a plain-text report: the pytest summary line, any failures, and the three end-to-end outcomes.`,
  { label: 'regression-suite', phase: 'Regress' })

phase('Regress')
const critic = await agent(`${CONTEXT}

You are a completeness critic. Here is everything the audit confirmed:
${JSON.stringify(confirmed.map(f => ({ title: f.title, file: f.file, detail: f.detail, fix: f.suggested_fix, severity: f.severity })), null, 2)}

And the regression report:
${regress}

What is MISSING? Consider: a source file never read, a consumer of __all__ never checked,
a config combination never exercised, a test that should exist, an inconsistency between
get_object_members (now \`is None\`) and sort_members (still truthiness).
Verify your own claims by reading files / running commands before asserting them.
Return a short prioritized list of remaining work items, or "nothing missing" if the audit is complete.`,
  { label: 'completeness-critic', phase: 'Regress' })

return { confirmed, rejectedTitles: rejected.map(f => `${f.lens}: ${f.title}`), regress, critic }
