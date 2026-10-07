export const meta = {
  name: 'napoleon-multiparam-verify',
  description: 'Adversarially verify the napoleon multi-parameter fix',
  phases: [
    { title: 'Attack', detail: 'independent lenses trying to break the patch' },
    { title: 'Judge', detail: 'confirm or refute each reported defect' },
  ],
}

const CTX = `Repo: /testbed (Sphinx 3.2 dev). Python: /opt/miniconda3/envs/testbed/bin/python

A fix has ALREADY BEEN APPLIED to the working tree. Inspect it with \`git diff\`.

The fix, in sphinx/ext/napoleon/docstring.py:
1. _consume_fields() gained a \`multiple: bool = False\` kwarg. When \`multiple and _name\`,
   it splits _name on "," and appends one (name.strip(), _type, _desc) tuple per name.
2. _parse_parameters_section() now calls _consume_fields(multiple=True) in the
   napoleon_use_param=True branch only; the else branch calls _consume_fields()
   unchanged. (_consume_fields advances a line iterator, so it is called once per branch.)

Bug being fixed: numpydoc "x1, x2 : array_like, optional" rendered as "x2 (x1,)" with the
type destroyed, because sphinx/util/docfields.py does fieldarg.split(None, 1) to support
":param int x:", turning "x1, x2" into argtype="x1," argname="x2".

Baseline BEFORE the fix: \`pytest tests/test_ext_napoleon_docstring.py -q\` = 2 failed, 39 passed.
Those 2 failures (NumpyDocstringTest::test_docstrings, TestNumpyDocstring::test_token_type_invalid)
are PRE-EXISTING and unrelated. Do not report them as regressions.

You may create throwaway files under /tmp and run builds there. Do NOT modify /testbed files
(if you must experiment, copy the tree or use monkeypatching; restore anything you touch).`

const DEFECT = {
  type: 'object',
  properties: {
    defects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { enum: ['high', 'medium', 'low'] },
          evidence: { type: 'string', description: 'Exact repro: input, command, observed vs expected output' },
        },
        required: ['title', 'severity', 'evidence'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string' },
  },
  required: ['defects', 'notes'],
  additionalProperties: false,
}

phase('Attack')

const LENSES = [
  { key: 'correctness', prompt: `LENS: CORRECTNESS of the split logic itself.
Run real code. Check: single-name params byte-identical to pre-fix; comma inside the TYPE
("x : int or float, optional", "Dict[int, str]") must NOT split; "x1,x2" without space;
"x1 , x2"; trailing comma "x1, : int"; empty name with a type; name-only field with no type;
whitespace-only parts. For each, report pre-fix vs post-fix emitted RST (get pre-fix by
\`git stash\`/\`git stash pop\` in a COPY of the repo under /tmp, not in /testbed).` },
  { key: 'escaping', prompt: `LENS: ESCAPING and *args/**kwargs.
NumpyDocstring._escape_args_and_kwargs (docstring.py ~1082) splits on ", " (comma-SPACE) and
escapes each part; GoogleDocstring's base version has no comma handling. The new split uses
"," + strip. Probe the interaction: numpy "*args, **kwargs", numpy "*args,**kwargs" (no space),
Google "Args:\\n    *args, **kwargs: desc", and names ending in "_" with
strip_signature_backslash. Report any case that emits UNESCAPED "*" into RST, and whether it
produces a docutils WARNING. State clearly for each whether it is a NEW breakage caused by
this patch or a PRE-EXISTING inconsistency merely surfaced.` },
  { key: 'aliasing', prompt: `LENS: SHARED MUTABLE STATE.
The split appends the SAME _type string and the SAME _desc LIST OBJECT into multiple tuples.
Trace every consumer of the fields list (_format_docutils_params, _format_fields,
_fix_field_desc, _strip_empty, _format_block, _indent, _dedent) and prove whether any
mutates _desc in place. Write a test that would FAIL if aliasing corrupted output (e.g. 3+
names with a multi-line description containing a literal block). Also check the recursive
self.__class__(_desc, ...).lines() re-parse. Report a real aliasing bug or state it is safe
with proof.` },
  { key: 'integration', prompt: `LENS: END-TO-END RENDERING + SCOPE GAPS.
Build real sphinx projects under /tmp with autodoc+napoleon and inspect HTML.
1. Confirm the reported bug is fixed for "x1, x2 : array_like, optional".
2. Check sections the patch did NOT change but that share _format_docutils_params:
   "Keyword Arguments" (napoleon_use_keyword -> :keyword:/:kwtype:) and
   "Attributes" with napoleon_use_ivar=True (-> :ivar:/:vartype:).
   Do they still exhibit the "x2 (x1,)" bug? Show the rendered HTML.
3. Check "Other Parameters" and "Returns"/"Raises" are unaffected.
4. Report whether leaving keyword/ivar unfixed is a defensible scope limit or a
   user-visible inconsistency, with the actual rendered evidence.` },
]

const attacks = await pipeline(
  LENSES,
  l => agent(`${CTX}\n\n${l.prompt}\n\nReport ONLY real, reproduced defects. Empty defects array is a fine answer.`,
    { label: `attack:${l.key}`, phase: 'Attack', schema: DEFECT }).then(r => ({ lens: l.key, ...r })),
  (r) => r && r.defects.length
    ? parallel(r.defects.map(d => () =>
        agent(`${CTX}

A reviewer using the "${r.lens}" lens claims this defect in the APPLIED patch:

TITLE: ${d.title}
SEVERITY: ${d.severity}
EVIDENCE: ${d.evidence}

Your job is to REFUTE it. Reproduce the claim yourself by running code. Default to
refuted=true if you cannot reproduce it, if it is a PRE-EXISTING behavior that the patch
did not introduce, if it is one of the 2 known pre-existing test failures, or if it
describes a deliberate scope limit rather than a defect in what was changed.
Only set refuted=false if you independently reproduced a REAL problem NEWLY caused by
this patch (or a real gap serious enough to block).`,
          { label: `judge:${d.title.slice(0, 40)}`, phase: 'Judge', effort: 'high',
            schema: { type: 'object',
              properties: { refuted: { type: 'boolean' }, reasoning: { type: 'string' },
                            preexisting: { type: 'boolean' } },
              required: ['refuted', 'reasoning', 'preexisting'], additionalProperties: false } })
          .then(v => ({ lens: r.lens, ...d, verdict: v }))))
    : []
)

const all = attacks.flat().filter(Boolean)
const surviving = all.filter(d => d.verdict && d.verdict.refuted === false)

log(`${all.length} defects claimed, ${surviving.length} survived refutation`)

return { surviving, allClaimed: all.map(d => ({ lens: d.lens, title: d.title, severity: d.severity,
                                                refuted: d.verdict?.refuted, preexisting: d.verdict?.preexisting })) }
