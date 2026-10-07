export const meta = {
  name: 'diagnose-identity-sum',
  description: 'Diagnose and design fix for Sum of Identity matrix elements returning 0',
  phases: [
    { title: 'Investigate', detail: 'parallel readers over Identity._entry, summation machinery, Piecewise, tests' },
    { title: 'Design', detail: 'independent fix proposals' },
    { title: 'Judge', detail: 'score proposals for correctness and regression risk' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'
const CTX = `
Repo: /testbed (SymPy, older version, python at ${PY} — always append 2>/dev/null to suppress DeprecationWarnings).

BUG (sympy issue "Sum of the elements of an identity matrix is zero"):
  n = Symbol('n', integer=True, positive=True); i, j = symbols('i j', integer=True)
  M = MatrixSymbol('M', n, n)
  with assuming(Q.orthogonal(M)): e = refine((M.T*M).doit())   # e == Identity(n)
  Sum(e[i,i], (i,0,n-1)).doit()                 # -> n     CORRECT
  Sum(Sum(e[i,j], (i,0,n-1)), (j,0,n-1)).doit() # -> 0     WRONG, should be n

ROOT CAUSE (already established, do not re-derive):
  sympy/matrices/expressions/matexpr.py, Identity._entry (~line 478):
      def _entry(self, i, j):
          if i == j: return S.One
          else: return S.Zero
  With symbolic i, j the structural check 'i == j' is False, so Identity[i,j] returns 0
  unconditionally. Hence the double sum is 0.

ALSO ESTABLISHED: if _entry returned KroneckerDelta(i,j), the inner sum becomes
  Piecewise((1, (0 <= j) & (j <= n-1)), (0, True))
but then Sum(that_piecewise, (j, 0, n-1)).doit() does NOT evaluate — it stays unevaluated
instead of giving n. So a second fix in the summation machinery is likely also needed.
`

phase('Investigate')

const AREAS = [
  {
    key: 'entry-consumers',
    prompt: `${CTX}
TASK: Find every consumer of Identity._entry / Identity[i,j] and anything that depends on it
returning a CONCRETE S.Zero/S.One rather than a KroneckerDelta.
Search sympy/ for: '_entry', 'is_Identity', 'Identity(', 'as_explicit', 'ImmutableDenseMatrix',
and MatrixExpr.__getitem__ / as_explicit / _eval_derivative paths.
Specifically determine:
 1. Does MatrixExpr.as_explicit() / .as_mutable() call _entry with concrete Integer indices?
    (If yes, KroneckerDelta(0,1) must auto-evaluate to 0 — verify empirically with ${PY}.)
 2. Which other MatrixExpr subclasses call Identity's _entry indirectly (MatMul._entry,
    MatAdd._entry, BlockMatrix._entry, MatPow, Transpose, Trace)? Would they break or
    improve if Identity[i,j] became KroneckerDelta(i,j)?
 3. Is KroneckerDelta importable in matexpr.py without a circular import? Check what
    sympy/matrices/expressions/matexpr.py already imports and whether
    'from sympy.functions.special.tensor_functions import KroneckerDelta' at module level
    or inside the method is required. TEST IT empirically.
Report concrete file:line refs and empirical command output.`,
  },
  {
    key: 'summation-piecewise',
    prompt: `${CTX}
TASK: Investigate why Sum(Piecewise((1, (0<=j)&(j<=n-1)), (0, True)), (j, 0, n-1)).doit()
does not evaluate to n, and find the right place to fix it.
Read sympy/concrete/summations.py in depth: Sum.doit, eval_sum, eval_sum_direct,
eval_sum_symbolic, eval_sum_hyper, and how 'deltasummation' (sympy/concrete/delta.py) is used.
Also read sympy/functions/elementary/piecewise.py: piecewise_fold, Piecewise._eval_sum if any,
and Piecewise.eval / _intervals.
Determine:
 1. Where in Sum.doit / eval_sum a Piecewise summand is (or is not) handled.
 2. Whether piecewise_fold is applied, and whether the condition (0<=j)&(j<=n-1) can be
    recognized as always-true over the summation range (j, 0, n-1).
 3. Is there an existing helper that simplifies a Piecewise given the summation bounds?
    Look for '_eval_interval', 'as_set', 'Piecewise' mentions in summations.py.
 4. Empirically probe with ${PY}: try Sum.doit on that Piecewise; try piecewise_fold;
    try Sum(Piecewise(...)).doit(deep=True); print intermediate reprs. Report exact output.
Report concrete file:line refs and the most surgical fix location.`,
  },
  {
    key: 'deltasummation',
    prompt: `${CTX}
TASK: Deep-dive sympy/concrete/delta.py (deltasummation, _has_simple_delta, _extract_delta)
and how Sum handles a KroneckerDelta summand.
Determine:
 1. Exactly what Sum(KroneckerDelta(i,j), (i, 0, n-1)).doit() produces and via which code path
    (add prints / use ${PY} to trace). Why a Piecewise and not just 1?
 2. Is the Piecewise result correct//desirable? Could deltasummation instead return
    something the outer Sum can handle?
 3. Would fixing this at the deltasummation level be better or worse than fixing the
    Piecewise summation? Argue both sides.
 4. Check the 3-arg / bounded KroneckerDelta behavior: KroneckerDelta(i,j) with
    i,j both integer and range-limited.
Report file:line refs and empirical output.`,
  },
  {
    key: 'tests-baseline',
    prompt: `${CTX}
TASK: Establish the regression-test baseline that a fix must not break.
 1. Find all existing tests touching Identity entries / Identity as_explicit / Q.orthogonal
    refine: grep sympy/matrices/expressions/tests/, sympy/assumptions/tests/,
    sympy/concrete/tests/ for 'Identity', 'refine', 'orthogonal', 'KroneckerDelta'.
 2. RUN the currently-passing relevant test files with ${PY} -m pytest (or bin/test) and
    record the PASS baseline. At minimum:
      sympy/matrices/expressions/tests/test_matexpr.py
      sympy/matrices/expressions/tests/test_indexing.py
      sympy/matrices/expressions/tests/test_matmul.py
      sympy/matrices/expressions/tests/test_blockmatrix.py
      sympy/concrete/tests/test_sums_products.py
      sympy/concrete/tests/test_delta.py
      sympy/assumptions/tests/test_refine.py
    Report exact pass/fail counts and the command that works in this repo.
 3. Flag any test that ASSERTS Identity[i,j] == 0 for symbolic indices (those would need
    updating) — quote them with file:line.
Do NOT modify any files. Read and run tests only.`,
  },
]

const findings = await parallel(AREAS.map(a => () =>
  agent(a.prompt, { label: `investigate:${a.key}`, phase: 'Investigate' })
))

const notes = AREAS.map((a, k) => `### ${a.key}\n${findings[k] || '(no result)'}`).join('\n\n')

phase('Design')

const ANGLES = [
  { key: 'minimal', slant: 'Minimal-diff: smallest change that fixes the reported case. Prefer touching the fewest files. Justify why the narrow fix is not papering over the real bug.' },
  { key: 'root-cause', slant: 'Root-cause-first: fix Identity._entry properly AND whatever summation gap remains, even if that means two files. Argue for correctness over diff size.' },
  { key: 'upstream-fidelity', slant: 'Match what SymPy upstream actually did / would accept in review: idiomatic to this codebase, uses existing helpers (Eq, KroneckerDelta, piecewise_fold), adds tests in the conventional place.' },
]

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          anchor: { type: 'string', description: 'existing code the edit replaces, verbatim' },
          replacement: { type: 'string', description: 'new code, verbatim' },
          rationale: { type: 'string' },
        },
        required: ['file', 'anchor', 'replacement', 'rationale'],
      },
    },
    verifiedWorks: { type: 'boolean', description: 'true only if you APPLIED the edits in a scratch copy, ran the repro, got n, and then REVERTED' },
    reproOutput: { type: 'string', description: 'actual stdout of the repro after applying the edits' },
    testsRun: { type: 'string', description: 'test command + pass/fail counts after applying edits' },
    risks: { type: 'array', items: { type: 'string' } },
    newTests: { type: 'string', description: 'test code to add, with target file path' },
  },
  required: ['summary', 'edits', 'verifiedWorks', 'reproOutput', 'testsRun', 'risks', 'newTests'],
}

const proposals = await parallel(ANGLES.map(a => () =>
  agent(`${CTX}

Investigation notes from the previous phase (trust but spot-check):
${notes}

TASK: Propose a concrete, complete fix. Your assigned angle: ${a.slant}

You MUST empirically validate:
 1. Apply your edits to the real files in /testbed (you have write access).
 2. Run the repro script. It must print n (not 0) for the double sum, and still print
    'I 1 0 0 1' / 'True True' / 'n' for the earlier lines.
 3. Run the regression test files listed in the tests-baseline notes and compare to baseline.
 4. Then GIT-REVERT your edits (git checkout -- <files>) so the tree is clean for the next
    agent. Report the exact edits as verbatim anchor/replacement pairs so they can be reapplied.
IMPORTANT: you share the working tree with sibling agents. Work fast, and ALWAYS
'git checkout -- <files>' when done, even on failure. Never commit.
Report honestly: if you could not make it work, set verifiedWorks=false and say what failed.`,
    { label: `design:${a.key}`, phase: 'Design', schema: PROPOSAL_SCHEMA }
  )
))

const good = proposals.filter(Boolean)
log(`${good.length}/${ANGLES.length} proposals returned; ${good.filter(p => p.verifiedWorks).length} self-verified`)

phase('Judge')

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          angle: { type: 'string' },
          correctness: { type: 'number', description: '0-10: does it actually fix the math, not just this one input' },
          regressionRisk: { type: 'number', description: '0-10, higher = safer' },
          idiomatic: { type: 'number', description: '0-10: fits this codebase' },
          notes: { type: 'string' },
        },
        required: ['angle', 'correctness', 'regressionRisk', 'idiomatic', 'notes'],
      },
    },
    winner: { type: 'string' },
    recommendedEdits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          anchor: { type: 'string' },
          replacement: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['file', 'anchor', 'replacement', 'rationale'],
      },
      description: 'final synthesized edit set, grafting best ideas from runners-up',
    },
    recommendedTests: { type: 'string' },
    remainingConcerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['scores', 'winner', 'recommendedEdits', 'recommendedTests', 'remainingConcerns'],
}

const LENSES = ['correctness of the underlying mathematics (does it generalize beyond the reported input?)',
                'regression risk across the whole matrix-expression + concrete-summation subsystems',
                'code review acceptability: idiomatic, minimal, well-tested']

const judged = await parallel(LENSES.map((lens, k) => () =>
  agent(`${CTX}

Candidate fixes (each reports whether it self-verified):
${JSON.stringify(good, null, 2)}

TASK: Judge these candidates through this specific lens: ${lens}

Be adversarial. For each candidate, actively try to REFUTE that it works:
 - Does the edit's 'anchor' text actually exist verbatim in the file? Check with grep.
 - Does the fix handle Identity[0,1] (concrete) -> 0, Identity[i,i] -> 1, as_explicit()?
 - Does it handle the single sum Sum(e[i,i]) -> n still?
 - Does changing Piecewise/summation break unrelated Sum evaluation?
 - Any circular-import hazard?
You MAY apply candidates to /testbed to test, but you MUST 'git checkout -- <files>' after.
Then score and synthesize a final recommended edit set.`,
    { label: `judge:${k}`, phase: 'Judge', schema: VERDICT_SCHEMA }
  )
))

return { proposals: good, verdicts: judged.filter(Boolean) }
