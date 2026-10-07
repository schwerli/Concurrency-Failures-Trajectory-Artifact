export const meta = {
  name: 'verify-quaternion-rotmat-fix',
  description: 'Exhaustively verify the Quaternion.to_rotation_matrix sign fix in sympy',
  phases: [
    { title: 'Audit', detail: 'independent lenses: math derivation, numeric check, blast radius, tests/docs' },
    { title: 'Verify', detail: 'adversarially refute each finding' },
    { title: 'Synthesize', detail: 'merge into a single verdict' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'
const CTX = `
CONTEXT
=======
Repo: /testbed (sympy, version 1.4.dev). Python interpreter to use for ALL sympy work:
  ${PY}
Always run it as: cd /testbed && ${PY} -c "..."   (so /testbed sympy is imported; verify with sympy.__file__)
NOTE: plain \`python\` on PATH lacks mpmath and CANNOT import sympy. Only use ${PY}.

Reported bug (github issue): Quaternion(cos(x/2), sin(x/2), 0, 0).to_rotation_matrix() returned
  [[1,0,0],[0,cos(x),sin(x)],[0,sin(x),cos(x)]]
which is not a rotation matrix (not orthogonal, det=-1... it's a reflection). One sin(x) must be negative.

A FIX HAS ALREADY BEEN APPLIED to sympy/algebras/quaternion.py in Quaternion.to_rotation_matrix:
  m12 was  2*s*(q.c*q.d + q.b*q.a)
  m12 now  2*s*(q.c*q.d - q.b*q.a)
All other entries (m00,m01,m02,m10,m11,m20,m21,m22) were left untouched.

Your job is to scrutinize the CURRENT state of the code, not to trust that the fix is right or complete.
Report concrete, verified findings only. Do not propose stylistic changes.
`

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string', description: 'what is wrong / what you confirmed, with evidence (commands run + output)' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['bug', 'incomplete-fix', 'test-gap', 'doc-issue', 'info'] },
        },
        required: ['title', 'detail', 'severity'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is wrong, already handled, or not actually a defect' },
    reasoning: { type: 'string', description: 'evidence for your verdict — commands run and their output' },
  },
  required: ['refuted', 'reasoning'],
}

const LENSES = [
  {
    key: 'math-derivation',
    prompt: `${CTX}
LENS: pure mathematical derivation, from first principles.

Derive the quaternion->rotation-matrix formula yourself. Use the conjugation action
  v' = q v q^{-1}   (Hamilton convention, active rotation of a column vector, right-handed axes)
for q = a + b*i + c*j + d*k. Expand it symbolically with sympy (use Quaternion.mul / the raw
i,j,k algebra, or expand by hand in sympy symbols) to get all 9 entries of R as polynomials in
a,b,c,d divided by norm^2. Do NOT read the existing m00..m22 lines until you have your own answer.

Then compare your derived matrix entry-by-entry against the CURRENT code in
sympy/algebras/quaternion.py to_rotation_matrix. Report ANY entry that disagrees, including
entries other than m12. Also state explicitly whether the applied m12 fix matches your derivation
and whether m21 (2*s*(q.c*q.d + q.b*q.a)) is correct as-is.

Also independently confirm the sign convention question the issue raised ("what was the reference
of the original equations?"): determine whether the code implements the active/right-handed
Hamilton convention and whether that is consistent with the rest of the file
(e.g. Quaternion.rotate_point, from_axis_angle, _generic_mul) and with the existing docstring
examples for the z-axis. If the file were instead consistently using the transpose/passive
convention, say so and explain which entries would then be wrong instead.`,
  },
  {
    key: 'numeric-property',
    prompt: `${CTX}
LENS: numerical / property-based testing of the CURRENT (fixed) code.

Write and run a thorough property test script with ${PY}. Cover at minimum:
1. Orthogonality: R.T*R == I and det(R) == 1 (a proper rotation, not a reflection), for
   - symbolic single-axis quaternions about x, y, z: Quaternion(cos(x/2), sin(x/2),0,0) etc. (use trigsimp/simplify)
   - a fully symbolic unit quaternion (a,b,c,d with a^2+b^2+c^2+d^2=1) -- simplify with the constraint
   - many random NUMERIC quaternions (non-unit too, since the code divides by norm^2) -- use nsimplify/evalf and Rational/Float randoms. Avoid Math.random by using a fixed list of hardcoded numeric quaternions plus a deterministic LCG in python.
2. Consistency with the OTHER code path: for random numeric quaternions and random points,
   check that R * v equals the vector part of q.rotate_point(v, q) (or whatever the file's
   rotate_point API is -- read it). These two must agree; if they disagree, that is a real bug
   in one of them. Report which.
3. Composition: R(q1*q2) == R(q1)*R(q2) for random numeric q1,q2.
4. Known-value spot checks: 90-degree rotation about x maps (0,1,0)->(0,0,1) for a right-handed
   active rotation. Verify the x-axis matrix is now [[1,0,0],[0,cos,-sin],[0,sin,cos]].
5. The 4x4 path: to_rotation_matrix(v) with a point -- verify it is a valid affine rotation about
   that point, i.e. it fixes the point v and its upper-left 3x3 equals the 3x3 result.

Paste the actual script output as evidence. Report any check that FAILS as a finding. If everything
passes, report a single 'info' finding summarizing what passed with the numbers.`,
  },
  {
    key: 'blast-radius',
    prompt: `${CTX}
LENS: blast radius across the whole repo.

Find every place in /testbed that calls to_rotation_matrix, or that duplicates/hardcodes this
same quaternion->matrix conversion, or that depends on its output. grep broadly:
  to_rotation_matrix, rotation_matrix, quaternion, Quaternion, rotate_point, from_rotation_matrix,
  and the sympy.algebras package's users (sympy/physics/*, vector, mechanics, printing, doc/*).
For each hit, determine whether the sign fix changes its behavior or breaks an assumption.

Specifically check:
- Are there OTHER copies of this buggy formula elsewhere in sympy that still have the wrong sign?
- Does anything (docs, doctests, tests, examples in doc/src) contain a hardcoded expected matrix
  that the fix now invalidates? Search doc/ and any .rst/.txt too.
- Does the fix interact with Quaternion.to_axis_angle / from_axis_angle / rotate_point?

Report each affected location as a finding with file and line. Report 'info' if a location was
checked and is unaffected only when it is a location a reviewer would plausibly worry about.`,
  },
  {
    key: 'tests-docs',
    prompt: `${CTX}
LENS: test suite and documentation completeness.

1. Read sympy/algebras/tests/test_quaternion.py in full. Determine exactly which entries of the
   rotation matrix the existing tests actually pin down. Critically: the pre-existing tests passed
   even with the m12 sign bug -- explain precisely WHY they failed to catch it (which quaternions
   they used, and why those made the wrong entry invisible, e.g. b*a==0 for z-axis-only rotations).
2. Run the existing tests with the fix applied and report pass/fail with real output:
     cd /testbed && ${PY} -c "import sympy; sympy.test('sympy/algebras/', verbose=True)"
   and also the doctests:
     cd /testbed && ${PY} -c "import sympy; sympy.doctest('sympy/algebras/')"
   If a test or doctest now FAILS, that is a high-severity finding -- report the exact failure text.
3. Identify the test-gap: state the specific new test case(s) that WOULD have caught this bug
   (a quaternion with a nonzero scalar part AND nonzero b, i.e. rotation about x). Give the exact
   expected matrix. Do NOT write the test file yourself -- just specify it precisely, including
   whether trigsimp is needed.
4. Check the to_rotation_matrix docstring examples: do they still produce exactly what they claim
   now that the fix is applied? Would ADDING an x-axis example to the docstring be correct, and if
   so what exact output would sympy print for it? Verify by running it.`,
  },
]

phase('Audit')
const audited = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `audit:${l.key}`, phase: 'Audit', schema: SCHEMA }),
  (res, lens) => {
    if (!res || !res.findings || !res.findings.length) return { lens: lens.key, summary: res?.summary || '', judged: [] }
    const real = res.findings.filter(f => f.severity !== 'info')
    const infos = res.findings.filter(f => f.severity === 'info').map(f => ({ finding: f, lens: lens.key, refuted: false, votes: 'n/a (info)' }))
    if (!real.length) return { lens: lens.key, summary: res.summary, judged: infos }
    return parallel(real.map(f => () =>
      parallel([
        `Correctness lens: is the mathematical/logical claim actually true? Re-derive or re-run independently.`,
        `Reproduction lens: can you actually reproduce the stated defect on the CURRENT code with a concrete command? If it does not reproduce, it is refuted.`,
        `Already-handled lens: is this already correct in the current code, already covered by an existing test, or purely cosmetic/out-of-scope? If so it is refuted.`,
      ].map(lensText => () => agent(`${CTX}

You are an ADVERSARIAL VERIFIER. Your default is to REFUTE. Only set refuted=false if you can
positively confirm the finding with evidence you gathered yourself.

FINDING UNDER REVIEW (from the "${lens.key}" auditor):
  title: ${f.title}
  severity: ${f.severity}
  file: ${f.file || 'n/a'} line: ${f.line || 'n/a'}
  detail: ${f.detail}

${lensText}

Run real commands with ${PY}. Cite the output. If uncertain, refute.`,
        { label: `verify:${lens.key}:${f.title.slice(0, 28)}`, phase: 'Verify', schema: VERDICT })))
        .then(vs => {
          const v = vs.filter(Boolean)
          const refutedCount = v.filter(x => x.refuted).length
          return {
            finding: f,
            lens: lens.key,
            refuted: refutedCount >= 2,
            votes: `${refutedCount}/${v.length} refuted`,
            reasoning: v.map(x => `[refuted=${x.refuted}] ${x.reasoning}`),
          }
        })
    )).then(judged => ({ lens: lens.key, summary: res.summary, judged: [...judged, ...infos] }))
  }
)

const rounds = audited.filter(Boolean)
const allJudged = rounds.flatMap(r => r.judged || [])
const survived = allJudged.filter(j => !j.refuted && j.finding.severity !== 'info')
const refuted = allJudged.filter(j => j.refuted)
const infos = allJudged.filter(j => j.finding.severity === 'info')
log(`${allJudged.length} findings judged: ${survived.length} survived, ${refuted.length} refuted, ${infos.length} info`)

phase('Synthesize')
const [synthesis, critic] = await parallel([
  () => agent(`${CTX}

Synthesize the audit into a final verdict for the engineer who applied the fix.

SURVIVED FINDINGS (passed adversarial verification):
${survived.length ? JSON.stringify(survived.map(s => ({ lens: s.lens, ...s.finding, votes: s.votes })), null, 2) : '(none)'}

REFUTED (do not act on, but note if any refutation looks wrong):
${JSON.stringify(refuted.map(s => ({ lens: s.lens, title: s.finding.title, votes: s.votes })), null, 2)}

CONFIRMATIONS / INFO:
${JSON.stringify(infos.map(s => ({ lens: s.lens, title: s.finding.title, detail: s.finding.detail.slice(0, 900) })), null, 2)}

PER-LENS SUMMARIES:
${JSON.stringify(rounds.map(r => ({ lens: r.lens, summary: r.summary })), null, 2)}

Produce a tight report answering exactly these questions, each with evidence:
1. Is the applied one-character m12 fix CORRECT? (yes/no + the derivation that proves it)
2. Is it COMPLETE -- are all 8 other matrix entries right, m21 in particular? (yes/no)
3. What is the correct answer to the issue author's question "what was the reference of the
   original equations?" -- i.e. what convention does the code use and was the bug a convention
   mismatch or a plain typo?
4. Does anything else in the repo need changing? (list files, or "nothing")
5. What is the exact test that should be ADDED, and what exact docstring example (if any)?
   Give literal code, ready to paste, matching the file's existing style. Include the exact
   expected matrix output as sympy prints it.
6. Do all existing sympy/algebras tests and doctests pass with the fix? Quote the result lines.
Be concise and concrete. No hedging.`, { label: 'synthesize', phase: 'Synthesize' }),
  () => agent(`${CTX}

You are a COMPLETENESS CRITIC. Four auditors looked at this fix through these lenses:
math-derivation, numeric-property, blast-radius, tests-docs. Their findings:
${JSON.stringify(allJudged.map(j => ({ lens: j.lens, title: j.finding.title, severity: j.finding.severity, refuted: j.refuted })), null, 2)}

Ask: what did they MISS? Consider at least — the 4x4 affine branch and its \`if not v:\` truthiness
(what happens for v=(0,0,0)?); non-unit / zero-norm quaternions; symbolic non-commuting or
non-real components (Quaternion with real_field=False, complex a,b,c,d); interaction with
to_axis_angle round-tripping; whether R is the transpose of what some other sympy subsystem
expects; and whether the docstring's 4x4 example output is itself still correct.

Actually RUN checks with ${PY} for anything you suspect. Report only defects you positively
confirmed, with the command output. If you confirm nothing, say so plainly.`,
    { label: 'completeness-critic', phase: 'Synthesize' }),
])

return { synthesis, critic, survivedCount: survived.length, refutedCount: refuted.length }
