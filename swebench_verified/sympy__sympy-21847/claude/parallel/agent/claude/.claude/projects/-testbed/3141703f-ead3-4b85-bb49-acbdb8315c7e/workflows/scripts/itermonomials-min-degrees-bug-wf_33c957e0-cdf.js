export const meta = {
  name: 'itermonomials-min-degrees-bug',
  description: 'Diagnose sympy itermonomials min_degrees bug, map blast radius, design and adversarially verify the fix',
  phases: [
    { title: 'Investigate', detail: 'root cause, callers/tests, doc semantics, non-commutative branch' },
    { title: 'Verify', detail: 'adversarially check each investigation claim' },
    { title: 'Synthesize', detail: 'single fix plan' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'file:line refs and/or command output' },
        },
        required: ['claim', 'evidence'],
      },
    },
    recommended_changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'string' },
          change: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['file', 'change', 'rationale'],
      },
    },
  },
  required: ['summary', 'claims'],
}

const VERDICT = {
  type: 'object',
  properties: {
    claim: { type: 'string' },
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    correction: { type: 'string', description: 'if refuted, what is actually true' },
  },
  required: ['claim', 'refuted', 'reasoning'],
}

const CONTEXT = `
Repo: /testbed (sympy). Use \`${PY}\` as the python interpreter (the default python lacks mpmath).
Bug report: \`sympy.itermonomials(vars, max_degrees, min_degrees=N)\` with INTEGER degrees returns
too few monomials. e.g. itermonomials([x1,x2,x3], 3, min_degrees=3) returns only [x1**3, x2**3, x3**3],
omitting x1*x2**2, x1*x2*x3, etc. Docstring promises: min_degree <= total_degree(monom) <= max_degree.
The relevant code is sympy/polys/monomials.py, function itermonomials, the \`total_degree\` branch
(lines ~113-144). Read the code yourself. Do NOT edit any files — investigate and report only.
`

const LENSES = [
  {
    key: 'root-cause',
    prompt: `${CONTEXT}
Your lens: ROOT CAUSE + exact minimal correct fix for the COMMUTATIVE integer-degree branch.
Determine precisely which expression is wrong and what it must become. Consider: what does the
\`powers\` dict hold after the loop? Is total degree the max of exponents or the sum? Does S.One
appended to \`variables\` distort the count? Verify empirically by monkeypatching/copying the
function body into a scratch script under /tmp and comparing against a brute-force reference
implementation (e.g. enumerate all exponent tuples via itertools.product over range(max_degree+1)
and filter by sum). Test a matrix of cases: n=1,2,3 variables; max_degree 0..4; min_degree 0..max+1.
Report exact expected counts, e.g. number of monomials with total degree exactly 3 in 3 vars = 10.
Also state whether the generator yields duplicates or the trailing 1 correctly.`,
  },
  {
    key: 'noncommutative',
    prompt: `${CONTEXT}
Your lens: the NON-COMMUTATIVE branch (the \`else\` under \`if all(variable.is_commutative ...)\`,
using itertools.product). Does the same bug exist there? What is "total degree" for a
non-commutative monomial like a*b*a? Confirm what \`Mul(*item)\` produces when item contains
repeated S.One entries and whether \`set(...)\` dedup is still correct after a fix. Empirically
check with a scratch script in /tmp: symbols a,b non-commutative, max_degree 2 and 3,
min_degree 0..3. Enumerate what the CORRECT output set should be by hand/brute force and compare.
Note the existing doctest at monomials.py:60-61 (\`set(itermonomials([a, b, x], 2))\`) — would the
fix change it? State the exact expected set after the fix.`,
  },
  {
    key: 'blast-radius',
    prompt: `${CONTEXT}
Your lens: BLAST RADIUS. Find every caller of itermonomials in the repo (grep the whole /testbed
tree, including sympy/polys, solvers, integrals, physics, tests, doc/). For each caller, note
whether it passes min_degrees and whether the fix (more monomials returned when min_degrees>0)
could change its behavior or break it. Also list every existing test and doctest that asserts on
itermonomials output — give file:line and the asserted value — and say for each whether it stays
valid under the fix. Look especially at sympy/polys/tests/test_monomials.py.
Report the full list; do not sample.`,
  },
  {
    key: 'docs-semantics',
    prompt: `${CONTEXT}
Your lens: DOCUMENTATION & INTENDED SEMANTICS. Read the full docstring of itermonomials and any
related docs (grep doc/ and *.rst for itermonomials). Determine the intended contract for Case I
(integer degrees) vs Case II (list degrees). Check git history: \`cd /testbed && git log --oneline -20 -- sympy/polys/monomials.py\`
and \`git log -p --follow sympy/polys/monomials.py | head -400\` to find when min_degrees was added
to the integer branch and what the author intended. Report whether the docstring needs updating,
whether new doctest examples should be added to document the fixed behavior, and propose the exact
doctest lines (with correct, hand-verified expected output sorted by monomial_key('grlex', ...)).
Verify any proposed doctest output by actually running the equivalent brute-force computation in /tmp.`,
  },
  {
    key: 'edge-cases',
    prompt: `${CONTEXT}
Your lens: EDGE CASES & INVARIANTS after the fix. Enumerate and empirically probe (scratch scripts
in /tmp, brute-force reference): min_degree=0 (must be unchanged from today's behavior — confirm!);
min_degree > max_degree (must yield nothing); max_degree=0 with min_degree=0 and min_degree=1
(note the early \`if not variables or max_degree == 0: yield S.One\` return happens BEFORE any
min_degree filtering — is that a second, separate bug? e.g. itermonomials([x], 0, 1) — what does it
return today, what should it return?); empty variable list; single variable; max_degree=1 min_degree=1;
non-integer/negative inputs. For each, state today's behavior and the correct behavior. Flag any bug
that the primary max->sum fix would NOT address.`,
  },
]

phase('Investigate')
const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `investigate:${l.key}`, phase: 'Investigate', schema: FINDINGS }),
  (res, lens) => {
    if (!res || !res.claims) return { lens: lens.key, res, verdicts: [] }
    return parallel(res.claims.slice(0, 8).map(c => () =>
      agent(`${CONTEXT}
You are an adversarial verifier. Another agent investigating this bug asserted:

CLAIM: ${c.claim}
THEIR EVIDENCE: ${c.evidence}

Try hard to REFUTE this claim. Independently re-derive the answer — read the source at
sympy/polys/monomials.py yourself and run your own scratch experiments in /tmp with \`${PY}\`.
Do not trust their evidence; reproduce it. If the claim is right but imprecise or overstated,
mark refuted=true and give the correction. Default to refuted=true if you cannot confirm it.`,
        { label: `verify:${lens.key}`, phase: 'Verify', schema: VERDICT })
    )).then(vs => ({ lens: lens.key, res, verdicts: vs.filter(Boolean) }))
  }
)

const good = results.filter(Boolean)
log(`${good.length} lenses investigated`)

phase('Synthesize')
const digest = good.map(g => {
  const claimLines = (g.res?.claims || []).map((c, i) => {
    const v = g.verdicts[i]
    const status = !v ? 'UNVERIFIED' : (v.refuted ? `REFUTED (${v.correction || v.reasoning})` : 'CONFIRMED')
    return `  - [${status}] ${c.claim}\n    evidence: ${c.evidence}`
  }).join('\n')
  const changes = (g.res?.recommended_changes || []).map(c => `  * ${c.file}:${c.line || '?'} — ${c.change} (${c.rationale})`).join('\n')
  return `### Lens: ${g.lens}\nSummary: ${g.res?.summary}\nClaims:\n${claimLines}\nProposed changes:\n${changes}`
}).join('\n\n')

const plan = await agent(`${CONTEXT}

Five investigators examined this bug from different lenses and every claim was independently
adversarially verified. Here are their findings with verification verdicts:

${digest}

Produce the FINAL, MINIMAL, CORRECT fix plan. Requirements:
- Discard or correct any REFUTED claim. Treat UNVERIFIED claims with suspicion.
- The fix must be minimal and in the spirit of the surrounding code (this is sympy; the change
  should look like something a sympy maintainer would merge).
- Give exact old_string -> new_string edits with enough surrounding context to be unique.
- Say explicitly whether the non-commutative branch also needs the same change.
- Say explicitly whether the \`max_degree == 0\` early-return is a separate bug that should be
  fixed in the same patch, or left alone; justify.
- List every existing test/doctest that must be updated, with the exact new expected value, and
  propose new regression tests for sympy/polys/tests/test_monomials.py (exact code) covering the
  reported case (3 vars, min=max=3 -> 10 monomials) and the min<max case.
- Read the target files yourself to confirm the old_string snippets match byte-for-byte.
Do NOT edit any files. Output the plan as prose + code blocks.`,
  { label: 'synthesize-plan', phase: 'Synthesize', effort: 'high' })

return { plan, lensCount: good.length }
