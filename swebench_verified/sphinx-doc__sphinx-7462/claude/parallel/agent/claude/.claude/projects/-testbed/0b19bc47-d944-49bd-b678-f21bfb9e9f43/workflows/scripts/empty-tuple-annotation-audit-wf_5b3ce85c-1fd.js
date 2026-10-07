export const meta = {
  name: 'empty-tuple-annotation-audit',
  description: 'Audit Sphinx annotation-parsing paths for empty-collection crashes/mis-renders, verify each adversarially, synthesize a fix plan',
  phases: [
    { title: 'Find', detail: 'parallel finders over annotation parsing paths (domains/python.py, pycode/ast.py, util/inspect.py, autodoc e2e)' },
    { title: 'Verify', detail: 'reproduce each claimed defect with a real python run; refute if not reproducible' },
    { title: 'Synthesize', detail: 'single fix + test plan from confirmed findings' },
  ],
}

const ENV = `Repo: /testbed (Sphinx 3.1.0 dev checkout, git branch master, clean).
Activate the python env with: source activate testbed
Then you can run e.g.:
  source activate testbed && python -c "from sphinx.domains.python import _parse_annotation; print(_parse_annotation('Tuple[()]'))"
  source activate testbed && python -m pytest tests/test_domain_py.py -x -q

KNOWN BUG (already reproduced, do not re-litigate that it exists):
sphinx/domains/python.py :: _parse_annotation -> unparse() calls result.pop() unconditionally
for ast.Tuple and (after the loop) for ast.List. For the annotation "Tuple[()]" (the documented
mypy spelling of the empty tuple type) the ast.Tuple has no elts, so result.pop() raises
"IndexError: pop from empty list". Upstream issue: docs build crashes.

Your job is NOT to fix it. Your job is to map the FULL blast radius of empty/degenerate
collection handling in the annotation-parsing paths, so a single fix covers everything.
Report only defects you have actually observed by running code. Do not edit any files.`

const FINDING_SCHEMA = {
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
          input: { type: 'string', description: 'exact annotation string or code snippet that triggers it' },
          repro_command: { type: 'string', description: 'exact shell command you ran' },
          observed: { type: 'string', description: 'verbatim observed output/traceback' },
          expected: { type: 'string', description: 'what a correct implementation should produce' },
          severity: { type: 'string', enum: ['crash', 'wrong-output', 'cosmetic', 'none'] },
        },
        required: ['title', 'file', 'input', 'repro_command', 'observed', 'expected', 'severity'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    reproduced: { type: 'boolean' },
    is_real_defect: { type: 'boolean' },
    command_run: { type: 'string' },
    actual_output: { type: 'string' },
    reasoning: { type: 'string' },
    corrected_expected: { type: 'string', description: 'if the reporter got the expected output wrong, the correct expectation' },
  },
  required: ['reproduced', 'is_real_defect', 'command_run', 'actual_output', 'reasoning'],
}

const FINDERS = [
  {
    key: 'parse-annotation-empty',
    prompt: `${ENV}

LENS: sphinx/domains/python.py :: _parse_annotation / unparse.
Exhaustively probe EVERY ast node branch in unparse() with empty/degenerate inputs and with
nesting. At minimum actually run each of these through _parse_annotation and record the result
(crash, or the rendered punctuation/xref sequence — reconstruct the visible text so you can judge
whether it renders correctly):
  Tuple[()]   Tuple[]   Tuple   Tuple[int]   Tuple[int, ...]
  Callable[[], int]   Callable[[int], int]   Callable[..., None]
  List[]   List[[]]   Dict[str, ()]   Optional[Tuple[()]]   Tuple[Tuple[()], int]
  Union[Tuple[()], int]   ()   (int, str)   Tuple[()] with surrounding whitespace
Also check what happens to the make_xref post-pass (the loop that converts nodes.Text to
pending_xref) for degenerate cases — e.g. does any branch emit an empty or whitespace-only
nodes.Text that would become a bogus cross-reference target?
Report each concrete defect separately with its exact repro.`,
  },
  {
    key: 'pycode-ast-unparse',
    prompt: `${ENV}

LENS: sphinx/pycode/ast.py. This module has its own unparse()/ast wrapper used to stringify
default values and annotations. Read it fully, then probe it directly for the same class of
empty/degenerate-collection defects: empty tuple, empty list, empty dict, empty set, single-element
tuple (does it emit the required trailing comma?), starred/ellipsis, nested empties.
Run real commands, e.g.:
  source activate testbed && python -c "from sphinx.pycode.ast import ast, unparse; print(repr(unparse(ast.parse('Tuple[()]', mode='eval').body)))"
Check behaviour on the interpreter version present in the env AND note where behaviour is
version-gated (ast.Index vs plain slice, ast.Constant vs ast.Num/ast.Str, ast.Ellipsis).
Report each concrete defect with exact repro. If a branch is correct, say so — do not invent
defects.`,
  },
  {
    key: 'stringify-inspect',
    prompt: `${ENV}

LENS: sphinx/util/inspect.py and sphinx/util/typing.py (stringify / restify of typing objects) plus
sphinx/util/inspect.py signature_from_str / stringify_signature.
Question: for a real function annotated "def foo() -> Tuple[()]:", what annotation STRING does
autodoc actually hand to _parse_annotation, on the python version in this env? Determine it
empirically: write a temp module in /tmp, import it, and run the same stringify path autodoc uses
(sphinx.util.typing.stringify on the __annotations__ value). Note that typing may normalise
Tuple[()] to Tuple[] / Tuple[()] / typing.Tuple[()] differently per version — record exactly what
you observe and what the resulting string is.
This matters because the fix must handle whatever string actually reaches the parser.
Also probe stringify on: Tuple[()], Tuple[int, ...], Callable[[], int], Tuple.
Report each concrete defect with exact repro.`,
  },
  {
    key: 'autodoc-e2e',
    prompt: `${ENV}

LENS: end-to-end. Build docs for a module containing the reported reproducer and confirm the
crash path from the user's report, then keep the harness so it can validate a fix.
Create a scratch project OUTSIDE the repo (e.g. /tmp/e2e/) with a conf.py enabling
sphinx.ext.autodoc, an index.rst with automodule, and a target module:

    from typing import Tuple
    def foo() -> Tuple[()]:
        """Sample text."""
        return ()

Run the build (python -m sphinx -b html . _build or sphinx.application API) and capture the real
traceback. Then also test the py:function directive path directly, which is the path
_parse_annotation is on:
  ".. py:function:: hello() -> Tuple[()]"
  ".. py:function:: hello(x: Tuple[()]) -> None"
using tests/test_domain_py.py's restructuredtext.parse helper style (see tests/test_domain_py.py
and tests/test_util_docutils.py for how to get an app fixture; or just run pytest on a temp test
file). Report exactly which entry points crash.
Also report: does the crash abort the whole build, or is it caught per-object?`,
  },
  {
    key: 'test-surface',
    prompt: `${ENV}

LENS: test suite and conventions. Do NOT hunt for runtime bugs.
Deliverables (put them in "notes", and leave "findings" empty unless you find an actually-failing test):
1. Read tests/test_domain_py.py::test_parse_annotation fully. Give the exact code style used for
   assertions (assert_node with lists of [node_class, "text"]) and the exact place a new
   "Tuple[()]" case should be inserted, quoting surrounding lines with line numbers.
2. Report what node classes are imported at the top of that test file (so a new assertion doesn't
   need new imports), quoting the import block.
3. Check whether the repo's CHANGES file has an existing "Bugs fixed" section for the unreleased
   version, quote its last few entries verbatim with line numbers, and give the exact issue number
   to cite for this bug if discoverable from the repo (search CHANGES/git log for the numbering
   convention). The upstream issue for the empty-tuple crash is #7501 — verify that number is not
   already used in CHANGES.
4. Run the current tests/test_domain_py.py and report the baseline pass/fail count verbatim.`,
  },
]

phase('Find')
const results = await pipeline(
  FINDERS,
  f => agent(f.prompt, { label: `find:${f.key}`, phase: 'Find', schema: FINDING_SCHEMA })
    .then(r => ({ key: f.key, ...r })),
  (r) => {
    const real = (r.findings || []).filter(x => x.severity !== 'none')
    if (!real.length) return { key: r.key, notes: r.notes, verified: [] }
    return parallel(real.map(fnd => () =>
      parallel([
        `correctness lens: does this actually reproduce, exactly as described?`,
        `expectation lens: is the reporter's "expected" output actually what Sphinx SHOULD emit (compare against how the non-empty case renders, and against the annotation's real python source text)?`,
        `scope lens: is this the SAME root cause as the known unconditional result.pop() bug, or a genuinely separate defect needing a separate code change?`,
      ].map((lens, i) => () => agent(`${ENV}

You are an adversarial verifier. Default to refuted (is_real_defect=false) unless you personally
observe the problem by running a command.

CLAIMED DEFECT
  title: ${fnd.title}
  file: ${fnd.file}${fnd.line ? ':' + fnd.line : ''}
  input: ${fnd.input}
  reporter's repro: ${fnd.repro_command}
  reporter's observed: ${fnd.observed}
  reporter's expected: ${fnd.expected}
  severity: ${fnd.severity}

YOUR LENS (${i + 1}/3): ${lens}

Run the repro yourself. Report reproduced/is_real_defect with the verbatim output you got.
If the reporter's "expected" is wrong, fill corrected_expected.`,
        { label: `verify:${fnd.title.slice(0, 34)}:${i + 1}`, phase: 'Verify', schema: VERDICT_SCHEMA }))
      ).then(votes => {
        const v = votes.filter(Boolean)
        const yes = v.filter(x => x.is_real_defect).length
        return { finding: fnd, votes: v, confirmed: yes >= 2, yes, of: v.length }
      })
    )).then(verified => ({ key: r.key, notes: r.notes, verified }))
  }
)

const buckets = results.filter(Boolean)
const confirmed = buckets.flatMap(b => (b.verified || []).filter(v => v.confirmed))
const refuted = buckets.flatMap(b => (b.verified || []).filter(v => !v.confirmed))
log(`${confirmed.length} confirmed, ${refuted.length} refuted across ${buckets.length} lenses`)

phase('Synthesize')
const brief = JSON.stringify({
  confirmed: confirmed.map(c => ({
    title: c.finding.title, file: c.finding.file, line: c.finding.line,
    input: c.finding.input, observed: c.finding.observed,
    expected: c.votes.find(v => v.corrected_expected)?.corrected_expected || c.finding.expected,
    severity: c.finding.severity, votes: `${c.yes}/${c.of}`,
  })),
  refuted: refuted.map(c => ({ title: c.finding.title, why: c.votes.map(v => v.reasoning).join(' | ').slice(0, 400) })),
  notes: buckets.map(b => ({ lens: b.key, notes: b.notes })),
}, null, 1)

const plan = await agent(`${ENV}

Below is the verified audit output (3-vote adversarial verification per finding).

${brief}

Produce the MINIMAL, idiomatic fix plan for sphinx/domains/python.py (and any other file a
confirmed finding demands). Requirements:
- Match the surrounding code style exactly (this is Sphinx 3.x; note the "# type: List[Node]"
  comment-style annotations used in unparse()).
- One coherent change that covers every CONFIRMED finding sharing the root cause; do not
  over-engineer for refuted ones.
- Render "Tuple[()]" as the literal text Tuple[()] — i.e. emit '(' and ')' punctuation nodes for
  the empty tuple, consistent with how the non-empty case renders.
- State whether empty ast.List (Callable[[], int]) needs the same guard, citing the evidence.
- Give the exact before/after code blocks (copy the real current source text so the edit applies
  cleanly), the exact new test case for tests/test_domain_py.py::test_parse_annotation in that
  file's existing assert_node style, and the exact CHANGES entry line.
Return markdown.`, { label: 'synthesize:fix-plan', phase: 'Synthesize' })

return { confirmed: confirmed.length, refuted: refuted.length, plan }
