export const meta = {
  name: 'point-distance-audit',
  description: 'Audit the sympy Point.distance zip-truncation bug: design the fix, find blast radius, verify adversarially',
  phases: [
    { title: 'Investigate', detail: 'parallel readers: fix design, callers, sibling methods, tests, upstream convention' },
    { title: 'Verify', detail: 'adversarially verify each claim against the actual code' },
    { title: 'Synthesize', detail: 'single recommended patch plan' },
  ],
}

const REPO = '/testbed'
const PY = '/opt/miniconda3/envs/testbed/bin/python'

const PREAMBLE = `You are auditing the sympy repo at ${REPO} (sympy ~1.0, 2016 era, git branch master).
Use ${PY} as the python interpreter (the default 'python' lacks mpmath and will fail to import sympy).
Ignore DeprecationWarning/SyntaxWarning noise on import.

THE BUG (github sympy issue #11617):
  >>> Point(2,0).distance(Point(1,0,2))
  1        # WRONG -- should be sqrt(5)
sympy/geometry/point.py Point.distance (~line 269) does:
    return sqrt(sum([(a - b)**2 for a, b in zip(
        self.args, p.args if isinstance(p, Point) else p)]))
zip() truncates to the shorter coordinate tuple, silently dropping the 3rd dimension.

Be concrete and cite file:line. Do not speculate -- read and RUN code to check claims.`

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One-paragraph summary of what you found' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          evidence: { type: 'string', description: 'code snippet or command output proving it' },
          impact: { type: 'string', enum: ['blocks-fix', 'must-change', 'should-consider', 'informational'] },
        },
        required: ['claim', 'file', 'evidence', 'impact'],
      },
    },
  },
  required: ['summary', 'findings'],
}

const LENSES = [
  {
    key: 'fix-design',
    prompt: `${PREAMBLE}

TASK: Determine the exact minimal correct fix for Point.distance.
- Read sympy/geometry/point.py fully.
- Check whether sympy/core/compatibility.py exports zip_longest and how other modules import it (grep for 'zip_longest' across sympy/). Report the exact import line to use.
- Consider the candidate fixes: (a) itertools/compatibility zip_longest with fillvalue=S.Zero, (b) manually zero-padding the shorter coord tuple, (c) raising an error on dimension mismatch.
- CRITICALLY: distance() accepts a non-Point iterable p too (see 'p.args if isinstance(p, Point) else p'). Verify each candidate still works when p is a plain tuple/list, e.g. Point(1,2).distance((3,4)) and Point(1,2,3).distance((3,4)). RUN these.
- Check whether fillvalue=S.Zero vs 0 matters for the sympy subtraction (a-b) when a is a Symbol or Rational. RUN a check.
- Note __abs__ calls Point.distance(origin, self) -- confirm the fix keeps that correct.
Report the exact recommended replacement code for the distance method body.`,
  },
  {
    key: 'callers',
    prompt: `${PREAMBLE}

TASK: Find the blast radius of changing Point.distance so that mismatched dimensions zero-pad instead of truncate.
- grep the WHOLE sympy/ tree for '.distance(' and 'Point.distance' and '__abs__' usage on points.
- For each caller in sympy/geometry/ (line.py, line3d.py, plane.py, ellipse.py, polygon.py, curve.py, entity.py, util.py) and anywhere else, determine whether it can ever pass Points of DIFFERENT ambient dimension (e.g. a Point2D and a Point3D, or a bare 2-tuple against a Point3D).
- Pay special attention to code that mixes Point2D and Point3D, and to Point3D.__new__ which silently promotes a 2-tuple to 3D by appending zero (point.py ~line 827).
- Report any caller that would CHANGE behavior under the fix, with evidence.`,
  },
  {
    key: 'siblings',
    prompt: `${PREAMBLE}

TASK: Find sibling methods with the SAME zip-truncation defect.
- In sympy/geometry/point.py examine every method that zips coordinate tuples: taxicab_distance, midpoint, dot, equals, __eq__, __add__, __sub__, is_scalar_multiple, is_collinear, and anything else.
- For each, RUN a mismatched-dimension example (2D vs 3D) and record the actual current output.
- Classify each: is it silently wrong (like distance), does it correctly raise, or is it correctly guarded?
- IMPORTANT judgement call: the user reported ONLY distance. State for each sibling whether fixing it is required for correctness of the reported bug, or is scope creep that risks regressions. Be conservative and explicit.`,
  },
  {
    key: 'tests',
    prompt: `${PREAMBLE}

TASK: Map the existing test surface.
- Read sympy/geometry/tests/test_point.py fully. Find every existing assertion about distance/taxicab_distance/__abs__ and note whether any DEPENDS on the current truncating behavior (i.e. would break if we zero-pad).
- grep the whole sympy/ test tree (and doctests in docstrings) for distance assertions involving points of mixed dimension.
- Report the naming convention this repo uses for regression tests (e.g. 'def test_issue_NNNN():') with examples from test_point.py, and the exact imports available at the top of test_point.py.
- Propose the exact regression test function to add for issue 11617, matching local style. It must assert Point3D(1,0,2).distance(Point2D(2,0)) == sqrt(5) and the reverse direction.
- Report the exact command to run the geometry test suite in this repo (check bin/test and sympy/utilities/runtests.py).`,
  },
  {
    key: 'baseline',
    prompt: `${PREAMBLE}

TASK: Establish a clean pre-change baseline so we can tell new failures from pre-existing ones.
- Run the geometry test suite BEFORE any change: ${PY} -c "import sympy; sympy.test('sympy/geometry/', verbose=False)" (or the repo's preferred runner -- figure it out).
- Also run the geometry doctests: ${PY} -c "import sympy; sympy.doctest('sympy/geometry/')".
- Record the exact pass/fail counts and the names of any ALREADY-FAILING tests. This is the baseline. Do NOT modify any files.
- Report the precise commands that worked and their summary lines verbatim.`,
  },
]

phase('Investigate')
const investigated = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `probe:${l.key}`, phase: 'Investigate', schema: FINDING_SCHEMA }),
  (res, lens) => {
    if (!res) return null
    const actionable = (res.findings || []).filter(f => f.impact === 'blocks-fix' || f.impact === 'must-change')
    if (!actionable.length) return { lens: lens.key, res, verdicts: [] }
    return parallel(actionable.map(f => () =>
      agent(`${PREAMBLE}

ADVERSARIAL VERIFICATION. Another agent investigating the "${lens.key}" angle claims:

  CLAIM: ${f.claim}
  FILE: ${f.file}${f.line ? ':' + f.line : ''}
  EVIDENCE OFFERED: ${f.evidence}
  CLAIMED IMPACT: ${f.impact}

Your job is to REFUTE this claim. Open the file, read the real code, and RUN python to check.
Default to refuted=true if you cannot independently reproduce the evidence.
Common failure modes to check for: the agent hallucinated a line number or a method that does not exist in this 2016-era version; the agent confused Point/Point2D/Point3D behavior; the agent tested with the wrong interpreter; the "impact" is overstated because Point3D.__new__ already zero-pads 2-tuples so the mismatch never actually occurs at that call site.`,
        { label: `refute:${lens.key}`, phase: 'Verify', schema: {
          type: 'object',
          properties: {
            refuted: { type: 'boolean' },
            reasoning: { type: 'string' },
            corrected_claim: { type: 'string', description: 'if partially right, the accurate version' },
          },
          required: ['refuted', 'reasoning'],
        } }
      ).then(v => ({ claim: f, verdict: v }))
    )).then(verdicts => ({ lens: lens.key, res, verdicts: verdicts.filter(Boolean) }))
  }
)

const good = investigated.filter(Boolean)
log(`${good.length}/${LENSES.length} lenses returned; ${good.reduce((n, g) => n + g.verdicts.length, 0)} claims adversarially checked`)

phase('Synthesize')
const dossier = JSON.stringify(good, null, 1)
const plan = await agent(`${PREAMBLE}

Five investigators reported below, with adversarial verification verdicts on their high-impact claims.
Claims marked refuted:true should be DISCARDED unless a corrected_claim survives.

${dossier}

Produce the final patch plan. Requirements:
- Be MINIMAL and conservative. The reported bug is distance() only. Recommend fixing siblings ONLY if a verified finding shows it is necessary.
- Give the exact old->new code for sympy/geometry/point.py, including any new import line and where it goes.
- Give the exact regression test to add to sympy/geometry/tests/test_point.py, matching repo style.
- List every pre-existing test failure from the baseline so they are not misattributed to this change.
- List the exact verification commands to run after the change.
- Flag any remaining risk.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high', schema: {
    type: 'object',
    properties: {
      point_py_change: { type: 'string', description: 'exact old and new code, unified-diff-like' },
      import_change: { type: 'string' },
      test_to_add: { type: 'string', description: 'exact python source of the test function' },
      siblings_verdict: { type: 'string', description: 'whether to touch taxicab_distance/midpoint/dot/etc and why' },
      baseline_failures: { type: 'array', items: { type: 'string' } },
      verify_commands: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
    },
    required: ['point_py_change', 'test_to_add', 'siblings_verdict', 'verify_commands', 'risks'],
  } }
)

return { plan, lenses: good.map(g => ({ lens: g.lens, summary: g.res.summary })) }
