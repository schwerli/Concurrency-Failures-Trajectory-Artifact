export const meta = {
  name: 'audit-cpachecker-v0',
  description: 'Adversarially audit the cpachecker_v0 value-analysis implementation for requirement gaps and soundness bugs',
  phases: [
    { title: 'Audit', detail: 'four independent lenses over value_analysis.py' },
    { title: 'Verify', detail: 'adversarially refute each finding by running code' },
  ],
}

const FINDINGS = {
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
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          detail: { type: 'string' },
          repro: { type: 'string', description: 'exact command or python snippet that demonstrates the problem' },
        },
        required: ['title', 'file', 'severity', 'detail', 'repro'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    reasoning: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['real', 'reasoning'],
}

const COMMON = `You are auditing a from-scratch Python re-implementation of CPAchecker in /workspace.
Requirement spec: /workspace/requirements/cpachecker_v0.yaml (read it fully).
Implementation under audit: /workspace/cpachecker/analyses/value_analysis.py
Skeleton you must not break: /workspace/cpachecker/{cfa.py,cpa_interface.py,expression.py,parser.py,result.py}, /workspace/cpachecker_main.py, /workspace/run.sh.
Benchmarks: /workspace/benchmarks/*.c . The acceptance criterion is that
'./run.sh' prints VA_SIMPLE_SAFE_CORRECT: 1, VA_SIMPLE_UNSAFE_CORRECT: 1, VA_LOOP_SAFE_CORRECT: 1, VA_LOOP_UNSAFE_CORRECT: 1.
You may RUN python3 to test hypotheses (use PYTHONPATH=/workspace). Do NOT edit any file.
Only report problems you have actually demonstrated or can precisely justify. No style nits.`

const LENSES = [
  { key: 'requirements', prompt: `${COMMON}\n\nLENS: requirement conformance. Go through cpachecker_v0.yaml line by line and check that every single item it asks for exists with the required semantics: LocationCPA (node-id state, sep merge, exact-coverage stop), ExplicitValueCPA (var->int or TOP, concrete assignment evaluation, assume feasibility check, coverage stop with 'same or less precise'), CompositeCPA (component-wise transfer/merge/stop), the CPA worklist algorithm (waitlist+reached, merge with states at same location, stop coverage, FALSE on error location, TRUE on empty waitlist), run_value_analysis(cfa, timelimit) returning a VerificationResult. Also check the 'Instructions' section: stdlib only, follows cpa_interface.py, uses cpachecker/expression.py evaluator, uses CFANode/CFAEdge, uses is_error. Report anything missing or contradicting the spec.` },
  { key: 'algorithm', prompt: `${COMMON}\n\nLENS: CPA algorithm correctness. Scrutinise CPAAlgorithm.run and ReachedSet: is the merge/replace logic correct (states replaced in both reached and waitlist)? Can a state be added to reached twice, or removed from the wrong partition? Is the error check able to be missed when a successor is covered? Can the parents map produce a wrong or cyclic error path? Is termination guaranteed by coverage? Is the deadline check reachable (bitmask (checks & 0x3F)==0 — can it ever fire on short runs?), does max_states break out correctly? Are there off-by-one or ordering bugs between BFS/DFS? Try to construct a small CFA that makes the algorithm return a WRONG verdict (TRUE when an error is reachable, or FALSE when it is not) and demonstrate it by running it.` },
  { key: 'semantics', prompt: `${COMMON}\n\nLENS: value-analysis semantics. Scrutinise ExplicitValueTransferRelation. Consider: assignment where the RHS mentions a TOP variable; assignment to a variable never declared; ASSUME edges whose condition cannot be evaluated; C vs Python semantics for / and % and integer overflow/unsigned wraparound; the ASSERT edge; BLANK/FUNCTION_CALL edges; expressions containing __VERIFIER_nondet_uint; conditions containing && || !; the '!' rewriting in expression.py's evaluate_condition. For each concern, decide whether it can make one of the 12 benchmark programs get a WRONG verdict, and demonstrate with a run. Also check whether ValueAnalysisState covers the required 'TOP for unknown' semantics.` },
  { key: 'integration', prompt: `${COMMON}\n\nLENS: integration and robustness. Run ./run.sh and the tests in /workspace/agent_tests. Check: does cpachecker_main.py work for all four value-analysis benchmarks and exit sanely? Does the module import cleanly with no external deps? Do the abstract base classes in cpa_interface.py get satisfied (all abstractmethods implemented, correct signatures — instantiate every class and call every operator)? Are states hashable/eq-consistent (including CompositeState nesting, LocationState slots vs ABC)? Does anything mutate a shared dict/list across states (aliasing bugs)? Does extract_location work for nested composites? Does the code crash on an empty CFA, a CFA with no error node, or unreachable disconnected nodes (the parser creates those after __assert_fail)? Demonstrate each problem.` },
]

phase('Audit')
const results = await pipeline(
  LENSES,
  (l) => agent(l.prompt, { label: `audit:${l.key}`, phase: 'Audit', schema: FINDINGS }),
  (res, lens) => {
    const items = (res && res.findings) || []
    if (!items.length) return []
    return parallel(items.map((f) => () =>
      agent(`You are an adversarial verifier working in /workspace. A previous auditor claims this defect in the Python CPAchecker re-implementation:

TITLE: ${f.title}
FILE: ${f.file}${f.line ? ':' + f.line : ''}
SEVERITY CLAIMED: ${f.severity}
DETAIL: ${f.detail}
CLAIMED REPRO: ${f.repro}

Your job is to REFUTE it. Actually run the repro (PYTHONPATH=/workspace python3 ...) and read the code. Set real=false if the claim is wrong, already handled elsewhere, cannot affect any of the 12 benchmark verdicts AND is not a requirement-spec violation, or is mere style. Set real=true ONLY if you reproduced a genuine requirement gap or a wrong-verdict/crash scenario. Default to real=false when uncertain. Put the command output in 'evidence'. Do not edit files.`,
        { label: `verify:${lens.key}`, phase: 'Verify', schema: VERDICT })
        .then((v) => ({ ...f, lens: lens.key, verdict: v }))))
  },
)

const confirmed = results.flat().filter(Boolean).filter((f) => f.verdict && f.verdict.real)
log(`audit complete: ${confirmed.length} confirmed of ${results.flat().filter(Boolean).length} raised`)
return {
  confirmed: confirmed.map((f) => ({ title: f.title, file: f.file, line: f.line, severity: f.severity, lens: f.lens, detail: f.detail, repro: f.repro, why: f.verdict.reasoning, evidence: f.verdict.evidence })),
  dismissed: results.flat().filter(Boolean).filter((f) => !(f.verdict && f.verdict.real)).map((f) => ({ title: f.title, why: f.verdict && f.verdict.reasoning })),
}
