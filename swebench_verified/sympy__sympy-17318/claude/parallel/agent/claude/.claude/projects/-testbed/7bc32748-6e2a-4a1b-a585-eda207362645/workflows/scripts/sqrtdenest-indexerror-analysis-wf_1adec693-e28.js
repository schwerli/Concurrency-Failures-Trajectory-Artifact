export const meta = {
  name: 'sqrtdenest-indexerror-analysis',
  description: 'Analyze sympy sqrtdenest IndexError (issue #12420) and converge on the correct minimal fix',
  phases: [
    { title: 'Analyze', detail: 'parallel readers: root cause, call sites, fix candidates, upstream precedent' },
    { title: 'Critique', detail: 'adversarially critique the recommended fix' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'

const ROOT_CAUSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    exact_failure_path: { type: 'string' },
    triggering_input_class: { type: 'string' },
    minimal_repros: { type: 'array', items: { type: 'string' } },
    invariant_violated: { type: 'string' },
  },
  required: ['summary', 'exact_failure_path', 'triggering_input_class', 'minimal_repros', 'invariant_violated'],
}

const CALLSITE_SCHEMA = {
  type: 'object',
  properties: {
    callers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          function: { type: 'string' },
          callee: { type: 'string' },
          assumed_invariant: { type: 'string' },
          would_a_fix_here_affect_it: { type: 'string' },
        },
        required: ['file', 'line', 'function', 'callee', 'assumed_invariant'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['callers', 'notes'],
}

const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          file: { type: 'string' },
          description: { type: 'string' },
          diff_sketch: { type: 'string' },
          pros: { type: 'string' },
          cons: { type: 'string' },
          risk_of_regression: { type: 'string' },
        },
        required: ['id', 'file', 'description', 'diff_sketch', 'pros', 'cons', 'risk_of_regression'],
      },
    },
    recommended_id: { type: 'string' },
    recommendation_reason: { type: 'string' },
  },
  required: ['candidates', 'recommended_id', 'recommendation_reason'],
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    counterexamples: { type: 'array', items: { type: 'string' } },
    regressions_found: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
  required: ['verdict', 'counterexamples', 'regressions_found', 'recommendation'],
}

const CTX = `Repo: /testbed (sympy, git branch master). Python interpreter WITH mpmath installed: ${PY}
(the bare \`python\` on PATH lacks mpmath — always use ${PY}).

Bug (sympy issue #12420):
    >>> sqrtdenest((3 - sqrt(2)*sqrt(4 + 3*I) + 3*I)/2)
    IndexError: tuple index out of range
raised from sympy/simplify/radsimp.py::_split_gcd (line \`g = a[0]\` with empty \`a\`),
reached via sqrtdenest.py::_sqrt_match -> radsimp.py::split_surds.

Already confirmed in this checkout:
  _sqrt_match(4 + I)                        -> IndexError
  sqrtdenest(3 - sqrt(2)*sqrt(4 + I) + 3*I) -> IndexError
(Note: the literal issue expression auto-evaluates to I in this version because
 sqrt(4+3*I) auto-denests, so use \`4 + I\` variants to reproduce.)

Desired behavior: an expression that cannot be denested is returned unchanged.
Do NOT modify any files under /testbed — this is analysis only.`

phase('Analyze')

const [rootCause, callSites, candidates, upstream] = await parallel([
  () => agent(`${CTX}

TASK: Establish the precise root cause.
Read sympy/simplify/sqrtdenest.py (_sqrt_match, _sqrtdenest0, _sqrtdenest1, _sqrtdenest_rec)
and sympy/simplify/radsimp.py (split_surds, _split_gcd, rad_rationalize).
Explain exactly why \`surds\` ends up empty in split_surds for these inputs, and characterize
the FULL class of Add expressions that reach split_surds with no Pow-with-exp-1/2 args.
Pay attention to the guard \`all((x**2).is_Rational for x in pargs)\` in _sqrt_match: which
terms satisfy it without being surds (ImaginaryUnit, negative-square terms, rationals, ...)?
Use ${PY} to experiment and confirm each claim empirically. Report facts you VERIFIED by running code.`,
    { label: 'root-cause', phase: 'Analyze', schema: ROOT_CAUSE_SCHEMA }),

  () => agent(`${CTX}

TASK: Enumerate every call site of split_surds, _split_gcd, _sqrt_match, and rad_rationalize
in the whole /testbed tree (source AND tests AND doctests). For each, state what invariant the
caller assumes about the argument, and whether tightening the guard in _sqrt_match (or making
split_surds/_split_gcd defensive) would change its behavior.
Grep thoroughly. Use ${PY} to check behavior where useful.`,
    { label: 'call-sites', phase: 'Analyze', schema: CALLSITE_SCHEMA }),

  () => agent(`${CTX}

TASK: Propose and evaluate concrete candidate fixes. Consider at least:
  (a) tighten the guard in _sqrt_match: require each x**2 to be Rational AND positive
      (so surd-like terms only), falling through to the generic path otherwise;
  (b) make split_surds/_split_gcd defensive against an empty surds list;
  (c) catch the exception in _sqrtdenest1 / sqrtdenest and return expr unchanged;
  (d) any other option you find.
For each: give a diff sketch, pros/cons, and regression risk. Verify empirically with ${PY}
(you may copy the repo to /tmp and edit the COPY, or monkeypatch at runtime in a scratch script,
to test a candidate WITHOUT editing /testbed). Recommend one. Bias toward the smallest change that
makes the generic (non-surd) code path handle these expressions correctly rather than merely
swallowing an error — an expression that can't be denested must come back unchanged and
structurally intact.`,
    { label: 'fix-candidates', phase: 'Analyze', schema: CANDIDATE_SCHEMA }),

  () => agent(`${CTX}

TASK: Determine what the canonical/upstream sympy fix for issue #12420 looks like.
Check \`git log\`, \`git log -S\` searches in /testbed for relevant history, and reason from the
code's own conventions about what the maintainers would accept. If you know current sympy master's
version of _sqrt_match, state exactly how it differs from this checkout's version (line by line).
Also state what a corresponding regression test in
sympy/simplify/tests/test_sqrtdenest.py would look like (naming convention: test_issue_12420),
including which assertions it should contain. Report the exact expected values by RUNNING ${PY}
where the values are computable without the fix (e.g. \`sqrtdenest\` of the non-crashing variants).`,
    { label: 'upstream-precedent', phase: 'Analyze' }),
])

log('Analysis complete; critiquing recommended fix')

phase('Critique')

const rec = (candidates && candidates.candidates || []).find(c => c.id === candidates.recommended_id) || null
const recText = rec ? JSON.stringify(rec) : JSON.stringify(candidates)

const LENSES = [
  { key: 'correctness', ask: 'Does it actually fix ALL inputs in the triggering class, or only the reported one? Hunt for an input that still crashes.' },
  { key: 'regression', ask: 'Does it change the result of any currently-passing denesting? Find an expression whose sqrtdenest output changes for the worse. Actually run the existing test files.' },
  { key: 'semantics', ask: 'Does the fix return a structurally unchanged expression when denesting is impossible, or does it mangle/expand it? Check idempotence and that sqrtdenest(e) == e where nothing can be denested.' },
]

const critiques = await parallel(LENSES.map(l => () => agent(`${CTX}

Recommended fix under review:
${recText}

Root-cause report:
${JSON.stringify(rootCause)}

TASK: Adversarially critique this fix through the ${l.key} lens. ${l.ask}
You MAY apply the fix to a COPY of the repo (e.g. \`cp -r /testbed /tmp/tb-${l.key}\` then edit and
run there with ${PY}) — do NOT edit /testbed itself. Run the real test files
sympy/simplify/tests/test_sqrtdenest.py and sympy/simplify/tests/test_radsimp.py in the copy
via \`${PY} -m pytest\` and report actual pass/fail output.
Default to reporting a problem if you find one; say so plainly if the fix holds up.`,
  { label: `critique:${l.key}`, phase: 'Critique', schema: CRITIQUE_SCHEMA })))

return {
  rootCause,
  callSites,
  candidates,
  upstream,
  critiques: critiques.filter(Boolean).map((c, i) => ({ lens: LENSES[i].key, ...c })),
}
