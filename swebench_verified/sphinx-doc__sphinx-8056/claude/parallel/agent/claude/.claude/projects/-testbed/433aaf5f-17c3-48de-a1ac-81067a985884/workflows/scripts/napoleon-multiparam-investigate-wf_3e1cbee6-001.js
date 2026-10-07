export const meta = {
  name: 'napoleon-multiparam-investigate',
  description: 'Investigate the correct fix for napoleon multi-parameter docstring rendering',
  phases: [
    { title: 'Investigate', detail: 'parallel probes into napoleon, docfields, tests, and risk' },
    { title: 'Synthesize', detail: 'merge probes into one recommended design' },
  ],
}

const REPO = `Repo: /testbed (Sphinx ~3.2). Python for running code: /opt/miniconda3/envs/testbed/bin/python.

KNOWN CONTEXT (already established, do not re-derive):
- Bug: numpydoc "x1, x2 : array_like, optional" renders as "x2 (x1,) - desc". Type is lost entirely.
- napoleon emits ":param x1, x2: desc" + ":type x1, x2: :class:\`array_like\`, *optional*".
- Root cause: sphinx/util/docfields.py DocFieldTransformer.transform does
  \`argtype, argname = fieldarg.split(None, 1)\` to support ":param int x: desc".
  For fieldarg "x1, x2" that gives argtype="x1," argname="x2", and the real
  ":type x1, x2:" entry is orphaned in the types dict.
- Relevant napoleon code: sphinx/ext/napoleon/docstring.py _consume_field / _consume_fields
  (~line 247-278), _parse_parameters_section (~683), _format_docutils_params (~389).

Return findings as terse structured prose. Cite file:line. Do NOT edit any files.`

const SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'string', description: 'Detailed findings with file:line citations' },
    risks: { type: 'string', description: 'Concrete regression risks / edge cases discovered' },
  },
  required: ['findings', 'risks'],
  additionalProperties: false,
}

phase('Investigate')

const PROBES = [
  {
    key: 'fix-shape',
    prompt: `${REPO}

TASK: Determine the exact shape the fix should take in sphinx/ext/napoleon/docstring.py.

The leading candidate is: give _consume_fields() a \`multiple: bool = False\` kwarg that,
when true and a name is present, splits the name on commas into one (name, type, desc)
tuple per name; then call it with multiple=True from _parse_parameters_section when
napoleon_use_param is enabled.

Investigate and report:
1. The full current source of _consume_field, _consume_fields, _parse_parameters_section,
   _parse_keyword_arguments_section, _parse_other_parameters_section, _parse_attributes_section
   and NumpyDocstring's overrides of any of them. Quote them.
2. Which sections SHOULD get multiple=True. Consider that only the napoleon_use_param /
   napoleon_use_keyword (docutils :param:) rendering path suffers the docfields bug;
   the _format_fields path renders "x1, x2" fine as one bold run.
3. Whether _parse_parameters_section is defined once on GoogleDocstring and inherited by
   NumpyDocstring, or overridden. Same for keyword arguments.
4. Whether sharing the same _desc list object across the split tuples can cause
   aliasing/mutation bugs downstream in _format_docutils_params / _format_fields /
   _strip_empty / _fix_field_desc. Read those functions to decide.
5. Exact patch text you would recommend (unified diff), minimal and idiomatic to the file.`,
  },
  {
    key: 'regression-risk',
    prompt: `${REPO}

TASK: Stress the comma-splitting idea for REGRESSIONS. Be adversarial.

If _consume_fields(multiple=True) splits a parameter name on "," for the Parameters
section, what currently-working docstrings could break?

Investigate concretely (write throwaway scripts under /tmp and RUN them against the
testbed python to check real behavior; do not edit repo files):
1. Google style: "Args:\\n    x1, x2 (int): desc" - what happens today, what after?
2. Names that legitimately contain commas or that are not names at all, e.g.
   numpydoc "*args, **kwargs : ...", "x1, x2, x3 : int", "x : int, optional"
   (comma in TYPE not name - must NOT split).
3. A field with a type but empty name, or a name-only field.
4. Whether _escape_args_and_kwargs is applied before or after the split, and what that
   means for "*args, **kwargs" (each part must keep its escaping: \\*args, \\*\\*kwargs).
   Check the current order in _consume_field.
5. numpydoc's own documented semantics for "x1, x2 : array_like" - is emitting two
   separate parameter entries (each with the full shared description) the accepted
   rendering? Compare with what numpydoc/other tools do if evidence exists in repo docs.
6. Trailing/leading whitespace, and a trailing comma like "x1, : int".

Report each case with observed CURRENT output and PREDICTED post-fix output.`,
  },
  {
    key: 'docfields-angle',
    prompt: `${REPO}

TASK: Evaluate the ALTERNATIVE fix location: sphinx/util/docfields.py.

Instead of (or in addition to) fixing napoleon, one could make
DocFieldTransformer.transform smarter about \`fieldarg.split(None, 1)\` (~line 320-330),
e.g. skip the "type name" interpretation when fieldarg contains a comma, or when an
explicit :type: field already supplied a type for that fieldarg.

Investigate and report:
1. Quote the exact transform() region and explain the ordering: is the ":type x1, x2:"
   field guaranteed to be processed before or after the ":param x1, x2:" field?
   Does ordering matter for a fix here?
2. What legitimate syntaxes rely on the space-split? (":param int x:", ":param str name:").
   Would a comma-guard break any of them? Search tests/ for such usages.
3. Would fixing ONLY docfields produce the user's literally-requested rendering
   ("x1, x2 (array_like, optional) - desc" as a single entry)? Write a throwaway
   sphinx project in /tmp, monkeypatch/patch a copy to test, and report the real HTML.
4. Cross-domain blast radius: which domains use TypedField (c, cpp, javascript, python,
   rst)? Would a docfields change affect them? Grep and report.
5. Give a clear recommendation: fix in napoleon, in docfields, or both - and why.`,
  },
  {
    key: 'tests',
    prompt: `${REPO}

TASK: Map the test surface.

1. In tests/test_ext_napoleon_docstring.py, find every test that exercises the
   Parameters / Args / Keyword Arguments sections with napoleon_use_param=True.
   List test function names + line numbers and quote the expected-output strings that
   involve a parameter section.
2. Identify any existing test that ALREADY has a comma-separated parameter name
   (e.g. "x1, x2 :") - grep for it. Report whether one exists and what it expects.
3. Determine the exact style/idiom used for these tests (class, helper methods,
   Config usage) so a new test matches the file's conventions. Quote one representative
   test verbatim as a template.
4. Report the exact command to run just the napoleon docstring tests in this repo.
5. Run the napoleon test suite NOW (unmodified repo) and report the current
   pass/fail baseline counts.`,
  },
]

const probes = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Investigate', schema: SCHEMA })
    .then(r => ({ key: p.key, ...r }))
))

const ok = probes.filter(Boolean)
log(`${ok.length}/${PROBES.length} probes returned`)

phase('Synthesize')

const synthesis = await agent(
  `${REPO}

You are synthesizing four independent investigations into ONE recommended design for
fixing the napoleon multi-parameter rendering bug.

${ok.map(p => `### PROBE: ${p.key}\n\nFINDINGS:\n${p.findings}\n\nRISKS:\n${p.risks}`).join('\n\n---\n\n')}

Produce:
1. RECOMMENDATION: exactly where to fix (napoleon vs docfields vs both) and why, in 3-6 sentences.
2. PATCH: the precise unified diff to apply to repo source. Minimal, idiomatic.
3. EDGE CASES the patch must handle, each with input -> expected emitted RST.
4. TESTS: concrete test functions to add, matching the existing file's conventions.
5. ANY DISAGREEMENT between probes, and how you resolved it.

Verify claims against the real files before asserting them - re-read the source if the
probes conflict. Do NOT edit repo files.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' }
)

return { probes: ok, synthesis }
