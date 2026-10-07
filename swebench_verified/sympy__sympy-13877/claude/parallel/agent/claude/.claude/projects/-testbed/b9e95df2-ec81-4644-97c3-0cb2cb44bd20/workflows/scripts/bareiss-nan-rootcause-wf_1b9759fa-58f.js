export const meta = {
  name: 'bareiss-nan-rootcause',
  description: 'Root-cause the Bareiss determinant NaN bug in sympy and converge on the correct minimal fix',
  phases: [
    { title: 'Investigate', detail: 'parallel read-only root-cause analyses from distinct angles' },
    { title: 'Propose', detail: 'independent candidate fixes' },
    { title: 'Judge', detail: 'adversarially score each candidate fix' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'
const CTX = `
Repo: /testbed (sympy 1.1.2.dev, git branch master). READ-ONLY: do NOT edit any files.
Use this interpreter for all experiments (the default \`python\` lacks mpmath):
  ${PY}
Suppress noise by appending \`2>/dev/null\` or ignore DeprecationWarnings.

The bug (reproduced):
  from sympy import *; from sympy.abc import a
  f = lambda n: det(Matrix([[i + a*j for i in range(n)] for j in range(n)]))
  f(1)=0  f(2)=-a  f(3)=2*a*(a+2)+2*a*(2*a+1)-3*a*(2*a+2)  f(4)=0  f(5)=nan
  f(6) -> TypeError: Invalid NaN comparison   (raised from core/exprtools.py factor_terms via cancel)

The relevant code is \`Matrix._eval_det_bareiss\` in sympy/matrices/matrices.py around lines 165-216.
Note the true determinant of this matrix family is 0 for all n>=3 (rank <= 2: row j = [0,1,2,...] + a*j*[1,1,..1]).
The user also asks: "isn't the Bareiss algorithm only valid for integer matrices, which cannot be assumed here?"
`

const FINDING = {
  type: 'object',
  properties: {
    root_cause: { type: 'string', description: 'Precise mechanism, citing file:line' },
    evidence: { type: 'string', description: 'Concrete commands run and their actual output that prove it' },
    proposed_fix: { type: 'string', description: 'Exact minimal code change (old -> new), with file:line' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string', description: 'Caveats, related issues, anything surprising' },
  },
  required: ['root_cause', 'evidence', 'proposed_fix', 'confidence'],
}

phase('Investigate')

const ANGLES = [
  {
    key: 'trace-nan',
    prompt: `${CTX}

YOUR ANGLE: empirically trace exactly where the nan is born.
Instrument by monkey-patching from a script (do NOT edit repo files): re-implement the \`bareiss\` recursion
in your own script mirroring sympy/matrices/matrices.py:187-214 exactly, and print, at each recursion level,
the matrix entries, the chosen pivot_pos/pivot_val, and \`cumm\`. Do this for n=5 and n=6.
Identify the precise arithmetic operation that first yields nan or zoo, and why.
Pay attention to: is \`cumm\` ever an expression that is mathematically zero but structurally nonzero?
Is the \`if val:\` truthiness test in \`_find_pivot\` (line 178-182) selecting such a pivot?
Report the exact expression values involved.`,
  },
  {
    key: 'cancel-discard',
    prompt: `${CTX}

YOUR ANGLE: scrutinize the \`entry\` closure at sympy/matrices/matrices.py:208-212:
    def entry(i, j):
        ret = (pivot_val*tmp_mat[i, j + 1] - mat[pivot_pos, j + 1]*tmp_mat[i, 0]) / cumm
        if not ret.is_Atom:
            cancel(ret)
        return ret
Is the \`cancel(ret)\` return value used? What was clearly intended? Use \`git log\`/\`git blame\` on those lines
to find when this was introduced and what the original code looked like (e.g. \`git log -p -L 200,220:sympy/matrices/matrices.py\`
or \`git log --follow\`). Then empirically test the one-line change \`cancel(ret)\` -> \`return cancel(ret)\`:
apply it ONLY in an in-memory monkeypatched copy of the algorithm in your own script, and report whether
f(1)..f(8) all become 0/-a/correct. Also state mathematically WHY cancelling matters for Bareiss
(fraction-free requires exact divisibility of the numerator by cumm).`,
  },
  {
    key: 'pivot-truthiness',
    prompt: `${CTX}

YOUR ANGLE: investigate the pivot search. \`_find_pivot\` (matrices.py:177-182) uses bare Python truthiness \`if val:\`.
What does \`bool(expr)\` do for a SymPy expression that is mathematically zero but not automatically simplified,
e.g. \`2*a*(a+2)+2*a*(2*a+1)-3*a*(2*a+2)\`? Test it. Compare with what \`_find_reasonable_pivot\`
(find it in the repo) would do. Read the XXX comments referencing issue #12362.
Determine: is the wrong-pivot selection the ROOT cause of the nan, or merely a downstream consequence of
entries never being simplified? Design an experiment that distinguishes these two hypotheses and run it.
Also check what \`det(method='berkowitz')\` and \`det(method='lu')\` return for f(5), f(6), f(7).`,
  },
  {
    key: 'upstream-fix',
    prompt: `${CTX}

YOUR ANGLE: find how upstream SymPy actually fixed this, using only local repo information.
Search the repo for existing tests of bareiss determinants (sympy/matrices/tests/test_matrices.py, test_commonmatrix.py),
for issue-number comments (12362, and any near 13950-14100), and for any TODO/XXX around determinants.
Grep the test suite for tests that would constrain any candidate fix (e.g. tests asserting a specific
unsimplified determinant form, tests on Bareiss with non-integer/symbolic entries, \`det_bareiss\` usages,
\`berkowitz\`, matrices over non-commutative or non-exact domains).
Report: the exact list of test names/files that exercise _eval_det_bareiss, and any test that a
"cancel the entries" fix could plausibly BREAK. Also answer the user's question about whether Bareiss
is only valid for integer matrices - cite the docstring at matrices.py:166-175 and the theory
(exact division in an integral domain / commutative ring, not just Z).`,
  },
  {
    key: 'correctness-scope',
    prompt: `${CTX}

YOUR ANGLE: characterize the blast radius and correctness of the whole family of nearby bugs, empirically.
Build a stress harness that compares det(method='bareiss') vs det(method='berkowitz') vs det(method='lu')
(and vs a slow exact cofactor expansion you write yourself) over many matrix families:
 - the reporter's family for n=1..8
 - random small integer matrices
 - random symbolic matrices in 1-2 symbols with entries like i+a*j, a**2, Rational(1,3)*a, sqrt(2)
 - singular symbolic matrices (rank-deficient by construction)
 - matrices with entries that are non-simplified zeros
Report every disagreement or exception you find, as a compact table. This establishes the ground truth
that a fix must satisfy. Report the exact reproduction snippets for the worst failures.`,
  },
]

const findings = await parallel(ANGLES.map(ang => () =>
  agent(ang.prompt, { label: `investigate:${ang.key}`, phase: 'Investigate', schema: FINDING })
    .then(r => r && ({ ...r, angle: ang.key }))))

const good = findings.filter(Boolean)
log(`${good.length}/${ANGLES.length} investigations returned`)

const digest = good.map(f =>
  `### angle: ${f.angle} (confidence: ${f.confidence})\nROOT CAUSE: ${f.root_cause}\nEVIDENCE: ${f.evidence}\nPROPOSED FIX: ${f.proposed_fix}\nNOTES: ${f.notes || ''}`
).join('\n\n')

phase('Propose')

const CANDIDATE = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    diff: { type: 'string', description: 'Exact old_string -> new_string edit(s) with file paths' },
    rationale: { type: 'string' },
    test_results: { type: 'string', description: 'Actual observed output of the full verification you ran' },
    risks: { type: 'string' },
  },
  required: ['label', 'diff', 'rationale', 'test_results', 'risks'],
}

const STRATEGIES = [
  'MINIMAL: the smallest possible change to _eval_det_bareiss that fixes the nan. Prefer a one-line change if it is genuinely sufficient. Justify why nothing more is needed.',
  'ROBUST: fix the root cause AND harden the pivot search / entry simplification so mathematically-zero-but-unsimplified entries cannot poison the recursion. Keep it idiomatic to the surrounding code.',
  'UPSTREAM-FAITHFUL: the change you believe the actual SymPy maintainers made for this issue, matching their style and conservatism. Prioritize not breaking any existing test.',
]

const candidates = await parallel(STRATEGIES.map((s, idx) => () => agent(`${CTX}

Five independent investigators analyzed this bug. Their findings:

${digest}

YOUR TASK - propose ONE candidate fix under this strategy:
${s}

You MAY edit files in /testbed to test your candidate, but you MUST \`git stash\` / \`git checkout --\` to
restore the repo to a pristine state before you finish (verify with \`git diff\` showing nothing).
Report your fix as an exact old_string -> new_string edit.

VERIFY your candidate before reporting:
 1. ${PY} -c "...f(1)..f(8) for the reporter's family..." - all must be mathematically correct (0 for n>=3, -a for n=2).
 2. Cross-check bareiss vs berkowitz on symbolic + integer matrices.
 3. Run the relevant existing test suites and report PASS/FAIL counts:
    ${PY} -m pytest sympy/matrices/tests/test_matrices.py sympy/matrices/tests/test_commonmatrix.py -x -q 2>&1 | tail -20
    (if pytest is unavailable, use: ${PY} -c "import sympy; sympy.test('sympy/matrices', verbose=False)")
 4. Also run sympy/matrices/tests/test_sparse.py and sympy/matrices/tests/test_immutable.py.
Report ACTUAL output, never guesses. If your candidate fails a test, say so plainly.`,
  { label: `propose:${idx}`, phase: 'Propose', schema: CANDIDATE })))

const cands = candidates.filter(Boolean)
log(`${cands.length}/${STRATEGIES.length} candidates produced`)

const catalog = cands.map((c, i) =>
  `## CANDIDATE ${i} - ${c.label}\nDIFF:\n${c.diff}\nRATIONALE: ${c.rationale}\nTEST RESULTS: ${c.test_results}\nRISKS: ${c.risks}`
).join('\n\n')

phase('Judge')

const LENSES = [
  { key: 'correctness', ask: 'Does it actually produce mathematically CORRECT determinants, not merely avoid the exception? Try hard to find a matrix where the candidate returns a wrong (not just unsimplified) determinant. Verify by applying the candidate yourself, testing, then restoring the repo with git checkout.' },
  { key: 'regressions', ask: 'Does it break any existing test or documented behavior? Actually apply each candidate and run the matrices test suites plus a broader smoke (sympy/solvers, sympy/polys imports of det). Restore the repo afterwards.' },
  { key: 'minimality', ask: 'Is it the minimal, most idiomatic change? Flag over-engineering, dead code, changes that paper over the symptom rather than fixing the cause, and any behavior change beyond the bug.' },
  { key: 'performance', ask: 'Does it slow down determinants unacceptably? Time bareiss det on dense symbolic matrices (n=5..8, 2 symbols) and integer matrices before vs after each candidate. Report actual timings. Restore the repo afterwards.' },
]

const VERDICT = {
  type: 'object',
  properties: {
    scores: { type: 'array', items: { type: 'object', properties: { candidate_index: { type: 'integer' }, score: { type: 'integer', description: '0-10' }, justification: { type: 'string' } }, required: ['candidate_index', 'score', 'justification'] } },
    best_candidate_index: { type: 'integer' },
    blocking_problems: { type: 'string', description: 'Any candidate that MUST NOT be used, and why' },
  },
  required: ['scores', 'best_candidate_index', 'blocking_problems'],
}

const verdicts = await parallel(LENSES.map(l => () => agent(`${CTX}

${cands.length} candidate fixes were proposed:

${catalog}

YOUR LENS: ${l.key}. ${l.ask}

Be adversarial and empirical - actually run code, do not reason from plausibility. Use ${PY}.
You may temporarily edit /testbed but MUST restore it to pristine (\`git checkout -- .\`, verified with \`git diff\`)
before finishing. Score every candidate 0-10 on YOUR lens only.`,
  { label: `judge:${l.key}`, phase: 'Judge', schema: VERDICT })))

return {
  investigations: good,
  candidates: cands,
  verdicts: verdicts.filter(Boolean),
}
