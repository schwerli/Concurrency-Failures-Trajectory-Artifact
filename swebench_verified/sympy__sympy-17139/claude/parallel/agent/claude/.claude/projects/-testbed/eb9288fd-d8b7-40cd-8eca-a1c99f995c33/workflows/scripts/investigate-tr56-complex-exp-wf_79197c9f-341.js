export const meta = {
  name: 'investigate-tr56-complex-exp',
  description: 'Root-cause TypeError in fu._TR56 for complex exponents and scope the correct fix',
  phases: [
    { title: 'Investigate', detail: 'parallel probes: root cause, sibling comparison sites, empirical breakage, test conventions' },
    { title: 'Judge', detail: 'score candidate fixes for minimality and regression risk' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'

const PROBES = [
  {
    key: 'rootcause',
    prompt: `You are investigating a bug in the sympy repo at /testbed (python interpreter: ${PY}).

Bug: \`simplify(cos(x)**I)\` raises \`TypeError: Invalid comparison of complex I\` from \`sympy/simplify/fu.py\` line ~504 in \`_TR56._f\`: \`if (rv.exp < 0) == True:\`.

Read /testbed/sympy/simplify/fu.py carefully, especially \`_TR56\`, \`TR5\`, \`TR6\`, and how they are invoked from \`sympy/simplify/trigsimp.py\` (\`_futrig\`, \`futrig\`) and from \`fu.py\`'s own \`fu\` / \`_TR56\` callers (grep for \`TR5(\`, \`TR6(\`, \`_TR56\`).

Report precisely:
1. The exact control flow that reaches the failing comparison for \`cos(x)**I\`, including every intermediate value (\`rv\`, \`rv.exp\`, \`rv.base\`).
2. What each subsequent line in \`_f\` would do if the comparison were skipped: trace \`rv.exp == 2\`, \`rv.exp == 4\`, \`rv.exp % 2\`, \`perfect_power(rv.exp)\`, \`rv.exp//2\` for exponent \`I\`, \`2 + 3*I\`, and a plain \`Symbol('n')\` with no assumptions. Actually RUN these in the interpreter (e.g. \`${PY} -c "from sympy import *; print(bool(Mod(Symbol('n'),2)))"\`) and paste real output — do not guess. Note: \`floor\`/\`//\` and \`perfect_power\` on complex input may raise.
3. Whether \`_TR56\` is reachable with non-real exponents through paths other than TR5/TR6 (e.g. TR8, TR22, fu()).
4. The minimal, most idiomatic guard that fits the surrounding code style, and where exactly it belongs (line number + surrounding context). Consider \`rv.exp.is_real\`, \`rv.exp.is_extended_real\`, \`rv.exp.is_number and not rv.exp.is_real\`, \`rv.exp.is_negative\`. Check whether \`is_extended_real\` even exists in this sympy version (grep it).

Return a dense technical report with file:line references and real interpreter output.`,
  },
  {
    key: 'siblings',
    prompt: `You are auditing the sympy repo at /testbed (python: ${PY}) for a class of bug.

A bug was found in \`sympy/simplify/fu.py\` \`_TR56\`: \`if (rv.exp < 0) == True:\` raises \`TypeError: Invalid comparison of complex I\` when the exponent is non-real (e.g. \`cos(x)**I\`). Note the \`== True\` idiom was clearly INTENDED to be safe against undecidable comparisons (it handles the case where \`<\` returns an unevaluated Relational), but sympy's \`Expr.__lt__\` RAISES for complex numbers rather than returning an unevaluated relational — see /testbed/sympy/core/expr.py around line 406.

Task: find every OTHER site in /testbed/sympy/simplify/ (fu.py, trigsimp.py, simplify.py, and anything else in that dir) that uses the same fragile pattern — a \`<\`, \`>\`, \`<=\`, \`>=\` comparison (or \`sorted\`/\`min\`/\`max\` on possibly-complex Exprs) on an expression that could be a non-real number at runtime.

For each candidate, TRY to actually trigger it from a user-facing entry point (\`simplify\`, \`trigsimp\`, \`futrig\`, \`fu\`, \`TR*\`) with expressions like \`cos(x)**I\`, \`sin(x)**I\`, \`cos(x)**(2+3*I)\`, \`tan(x)**I\`, \`cosh(x)**I\`, \`(1+I)*cos(x)**2\`, \`cos(x)**(I*2)\`, \`sin(x)**(-I)\`, \`exp(I*x)*cos(x)**I\`. Run real commands and paste output.

Distinguish: (a) confirmed reachable crash, (b) pattern present but unreachable/guarded, (c) false positive. Be rigorous — a claim of reachability must come with a reproducing one-liner. Return the list ranked by confidence.`,
  },
  {
    key: 'empirical',
    prompt: `You are validating a candidate fix in the sympy repo at /testbed (python: ${PY}).

Bug: \`simplify(cos(x)**I)\` raises \`TypeError: Invalid comparison of complex I\` at /testbed/sympy/simplify/fu.py:504 in \`_TR56._f\`.

Candidate fix: insert, right after the \`if not (rv.is_Pow and rv.base.func == f): return rv\` guard in \`_f\`:
\`\`\`
        if not rv.exp.is_real:
            return rv
\`\`\`

Your job — do this EMPIRICALLY, and CLEAN UP AFTER YOURSELF:
1. Apply the candidate patch to /testbed/sympy/simplify/fu.py (use Edit).
2. Run: \`simplify(cos(x)**I)\`, \`simplify(sin(x)**I)\`, \`simplify(cos(x)**(2+3*I))\`, \`simplify(tan(x)**I)\`, \`trigsimp(cos(x)**I)\`, \`fu(cos(x)**I)\`, \`TR5(sin(x)**I)\`, \`TR6(cos(x)**I)\`. Report exact returned values or new tracebacks. If a NEW traceback appears downstream (outside \`_TR56\`), report its full text — that means the fix is incomplete.
3. Check the fix does not change behavior for real exponents. Run the existing test suites and report pass/fail counts + any failure text:
   - \`${PY} -m pytest /testbed/sympy/simplify/tests/test_fu.py -q\` (if pytest unavailable use \`${PY} -c "import sympy; sympy.test('sympy/simplify/tests/test_fu.py')"\`)
   - same for test_trigsimp.py and test_simplify.py
   - also \`${PY} -m pytest --doctest-modules /testbed/sympy/simplify/fu.py -q\` or sympy's doctest runner on fu.py
4. Probe the symbolic-exponent question specifically: does \`TR5(sin(x)**n)\` / \`TR6(cos(x)**n)\` for \`n = Symbol('n')\` (no assumptions, so \`n.is_real is None\`) behave the SAME before and after the patch? Test with n unassumed, n real, n integer, n positive even. This is the main regression risk since \`not None\` is True. Show before/after output for each.
5. \`git checkout -- sympy/simplify/fu.py\` at the end so the tree is clean, and confirm with \`git status --porcelain\`.

Return: the empirical table of results, whether the fix is sufficient, and any regression you found.`,
  },
  {
    key: 'tests',
    prompt: `You are locating where a regression test should go in the sympy repo at /testbed.

The bug being fixed: \`simplify(cos(x)**I)\` raises \`TypeError: Invalid comparison of complex I\` from \`_TR56\` in sympy/simplify/fu.py (the \`(rv.exp < 0) == True\` comparison).

Read /testbed/sympy/simplify/tests/test_fu.py — find the tests for \`TR5\`, \`TR6\`, and \`_TR56\` (function names, exact line numbers, assertion style). Also check /testbed/sympy/simplify/tests/test_trigsimp.py and test_simplify.py for where an issue-regression test for \`simplify\` would idiomatically go (look for the convention used for issue-numbered tests, e.g. \`def test_issue_NNNNN():\`).

Report:
1. Exact function names + line numbers of \`test_TR5\`, \`test_TR6\` (or equivalent) in test_fu.py, quoting the full body of each.
2. Whether imports needed for a complex-exponent test (\`I\`, \`Symbol\`, \`simplify\`) are already imported at the top of each test file — quote the import lines.
3. The dominant convention in this repo for regression tests of this kind: appended to the relevant \`test_TRn\` function, or a separate \`test_issue_NNNNN\`? Cite 2-3 real examples with line numbers.
4. Your recommendation for the smallest test additions that would have caught this bug, written in the file's exact style.

Do NOT modify any files. Return the report.`,
  },
]

phase('Investigate')
const reports = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Investigate' })
    .then(r => ({ key: p.key, report: r }))
))

const ok = reports.filter(Boolean)
log(`${ok.length}/${PROBES.length} probes returned`)

phase('Judge')
const bundle = ok.map(r => `### PROBE: ${r.key}\n${r.report}`).join('\n\n---\n\n')

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    rootCause: { type: 'string' },
    recommendedPatch: { type: 'string', description: 'exact unified-diff-style or before/after snippet for fu.py' },
    guardChoice: { type: 'string', description: 'which predicate to use and why (is_real vs is_extended_real vs is_number)' },
    sufficient: { type: 'boolean', description: 'does the fu.py fix alone make simplify(cos(x)**I) work' },
    additionalSitesToFix: { type: 'array', items: { type: 'string' } },
    regressionRisks: { type: 'array', items: { type: 'string' } },
    recommendedTests: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['rootCause', 'recommendedPatch', 'guardChoice', 'sufficient', 'additionalSitesToFix', 'regressionRisks', 'recommendedTests', 'openQuestions'],
}

const verdicts = await parallel([
  `You are a skeptical sympy core reviewer. Below are four independent investigation reports about a TypeError in sympy/simplify/fu.py \`_TR56\` when the exponent is complex (\`simplify(cos(x)**I)\`).

Synthesize the MINIMAL correct fix. Priorities, in order: (1) correctness — no new crash, no wrong math; (2) minimality — this is an upstream-style bug fix, not a refactor; (3) no behavior change for real/symbolic exponents.

Be adversarial about the \`not rv.exp.is_real\` guard: \`is_real\` is None for unassumed symbols, so the guard fires for them too. Decide whether that is acceptable (i.e. whether those cases already returned unchanged) based on the empirical probe, not intuition. If the probes disagree, say so and side with the one that pasted real interpreter output.

REPORTS:
${bundle}`,
  `You are a regression-hunter reviewing a proposed one-line guard in sympy/simplify/fu.py \`_TR56\`. Your job is to REFUTE the claim that adding \`if not rv.exp.is_real: return rv\` is safe and sufficient.

Look for: cases where a real-exponent simplification silently stops happening; cases where \`is_real is None\` for something that used to be transformed; downstream crashes that the guard merely relocates; whether \`TR5/TR6\` docstring examples still hold; whether the \`max\`/\`pow\` branches were reachable with non-real exponents in a way that mattered.

You have the repo at /testbed and python ${PY} — verify your refutations by RUNNING code (apply the patch, test, then \`git checkout -- sympy/simplify/fu.py\`). Do not report a refutation you could not reproduce.

Then fill the schema with your own recommendation (which may be identical to the proposal if you failed to refute it).

REPORTS:
${bundle}`,
].map(p => () => agent(p, { phase: 'Judge', schema: JUDGE_SCHEMA })))

return { reports: ok, verdicts: verdicts.filter(Boolean) }
