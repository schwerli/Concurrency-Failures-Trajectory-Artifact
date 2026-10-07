export const meta = {
  name: 'fix-point2d-evaluate-false',
  description: 'Audit, fix, and adversarially verify the Point2D "Imaginary coordinates are not permitted" bug under evaluate(False)',
  phases: [
    { title: 'Investigate', detail: 'parallel readers: point.py audit, repo-wide anti-pattern sweep, test conventions, failure surface' },
    { title: 'Implement', detail: 'apply minimal fix + regression tests' },
    { title: 'Verify', detail: 'adversarial refuters, regression runs, minimality review, completeness critic' },
    { title: 'Repair', detail: 'address confirmed verifier findings' },
  ],
}

const PY = args.python
const REPO = args.repo

const PRELUDE = `You are working in the SymPy repo at ${REPO} (branch master, sympy 1.10.dev).

CRITICAL ENVIRONMENT FACTS:
- The default \`python\` on PATH CANNOT import sympy (no mpmath). You MUST use this interpreter for ALL python/pytest invocations: ${PY}
- Example: ${PY} -c "import sympy; ..."   and   ${PY} -m pytest sympy/geometry/tests/test_point.py -x -q
- Do NOT try to pip install anything; there is NO network access.
- WARNING: printing/repr of an unevaluated Add such as \`2+3*I\` built under \`with evaluate(False)\` can trigger a deep recursion in evalf and produce a giant traceback. Avoid printing such objects; inspect \`type(x).__name__\`, \`x.args\`, and assumption properties like \`.is_zero\` instead. This recursion is a PRE-EXISTING, SEPARATE issue and is explicitly OUT OF SCOPE.

THE BUG UNDER INVESTIGATION:
  import sympy as sp
  with sp.evaluate(False):
      sp.S('Point2D(Integer(1),Integer(2))')
  # -> ValueError: Imaginary coordinates are not permitted.
It works fine without the \`with evaluate(False)\` context, and also works with \`sp.S(..., evaluate=False)\`.

ESTABLISHED ROOT CAUSE (already confirmed empirically, do not re-litigate):
${REPO}/sympy/geometry/point.py line ~155 in \`Point.__new__\`:
    if any(a.is_number and im(a) for a in coords):
        raise ValueError('Imaginary coordinates are not permitted.')
Under global evaluate(False), \`im(a)\` does not auto-evaluate to 0 for a real \`a\`; it stays as an \`im\` instance. \`Basic\` has no \`__bool__\`, so the object is always truthy -> the guard fires on real coordinates.
Also confirmed: the assumption system still works on the unevaluated wrapper --
  under evaluate(False): im(Integer(1)).is_zero is True; im(Float(0.5)).is_zero is True; im(I).is_zero is False; im(2*I).is_zero is False.
So testing \`im(a).is_zero is False\` is a correct, evaluate-independent guard.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Concise prose summary of what you found' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          snippet: { type: 'string', description: 'The offending or relevant code, verbatim' },
          issue: { type: 'string' },
          inScope: { type: 'boolean', description: 'True only if fixing this is required to fix the reported bug or is a direct, tiny, clearly-correct sibling of it' },
          evidence: { type: 'string', description: 'Concrete command output or reasoning proving this is real' },
        },
        required: ['file', 'issue', 'inScope', 'evidence'],
      },
    },
    recommendation: { type: 'string' },
  },
  required: ['summary', 'findings', 'recommendation'],
}

phase('Investigate')

const investigations = [
  {
    key: 'point-audit',
    prompt: `${PRELUDE}
YOUR TASK: Deeply audit ${REPO}/sympy/geometry/point.py for EVERY place whose behavior changes incorrectly under global \`evaluate(False)\`.

Read the whole file. For each of Point.__new__, Point2D.__new__, Point3D.__new__ and the helper methods, determine:
1. Every guard/conditional that puts a SymPy expression (or a call to a SymPy function like im/re/sqrt/Abs/simplify/nsimplify) into a boolean context where an unevaluated object would be wrongly truthy or wrongly falsy.
2. Whether \`Tuple(*coords)\`, \`any(coords[dim:])\`, the \`is_number\` test, and the \`if evaluate:\` Float->Rational block behave correctly under evaluate(False).
3. Whether Point3D has the identical bug (empirically test: construct Point3D under evaluate(False)).
4. Whether the \`kwargs['_nocheck']=True\` path or \`GeometryEntity.__new__\` is affected.

Empirically verify each claim by running python with ${PY}. Mark inScope=true ONLY for things that must change to fix the reported bug. Report everything else with inScope=false so we know it exists without widening the diff.`,
  },
  {
    key: 'repo-sweep',
    prompt: `${PRELUDE}
YOUR TASK: Sweep the SymPy repo for OTHER occurrences of this same anti-pattern: a call to a SymPy function that may remain unevaluated being used directly in a boolean/truthiness context (e.g. \`if im(x):\`, \`and re(x)\`, \`if simplify(x):\`, \`any(f(a) for ...)\`), which therefore misbehaves under global evaluate(False).

Search strategy (use grep/rg extensively, multiple angles):
- \`grep -rn "and im(" sympy/\`, \`grep -rn "if im(" sympy/\`, \`grep -rn "if re(" sympy/\` and similar for Abs, sign, arg, sqrt, simplify, nsimplify, factor.
- Focus especially on sympy/geometry/ (all files: point.py, line.py, ellipse.py, polygon.py, plane.py, entity.py, util.py) since that is the module in the bug report.
- Also check for guards comparing with \`!= 0\` / \`== 0\` on possibly-unevaluated results.

For each hit, decide whether it is genuinely reachable-and-broken under evaluate(False) (try to construct a failing example with ${PY}) versus a false positive (e.g. the arg is always a plain Python number, or the result is always evaluated). Mark inScope=true ONLY for the one(s) needed for the reported bug. The goal here is a complete map, not a big diff.`,
  },
  {
    key: 'test-conventions',
    prompt: `${PRELUDE}
YOUR TASK: Determine exactly where and how to add a regression test for this bug, matching this repo's conventions. DO NOT modify any files -- only report.

Investigate:
1. Read ${REPO}/sympy/geometry/tests/test_point.py -- its imports, test function naming, and how it asserts raises (raises(ValueError, lambda: ...)).
2. Find existing tests anywhere in the repo that use \`with evaluate(False)\` or \`sympy.core.parameters.evaluate\` as a context manager, and show the exact import path and idiom used (e.g. \`from sympy.core.parameters import evaluate\` vs \`from sympy import evaluate\`).
3. Identify whether there is an existing test for 'Imaginary coordinates are not permitted' that must keep passing, and quote it with file:line.
4. Check ${REPO}/sympy/geometry/tests/test_point.py for an existing evaluate-related test to extend rather than duplicating.
5. Recommend the EXACT test code to add (full function body), including where in the file it should go, and confirm the negative case (Point2D with a genuinely imaginary coord must STILL raise, both under evaluate(True) and evaluate(False)).

Report the recommended test verbatim in \`recommendation\`.`,
  },
  {
    key: 'failure-surface',
    prompt: `${PRELUDE}
YOUR TASK: Characterize the FULL user-visible failure surface of this bug so we can be sure the fix covers all of it, and establish the exact expected-correct behavior.

Empirically run (with ${PY}) and record precise results for, at minimum:
- \`sp.S('Point2D(Integer(1),Integer(2))')\` under: no context, \`with evaluate(False)\`, and kwarg \`evaluate=False\`.
- Direct construction: \`Point(1,2)\`, \`Point2D(1,2)\`, \`Point3D(1,2,3)\`, \`Point(0.5,0.25)\` each under \`with evaluate(False)\`.
- Genuinely imaginary input that MUST still raise: \`Point2D(I,1)\`, \`Point(2+3*I, 1)\`, \`Point3D(I,1,2)\` -- under BOTH evaluate(True) and evaluate(False). (Build these OUTSIDE the evaluate(False) block where convenient to avoid the printing recursion, then construct the Point inside it.)
- Symbolic coords: \`Point(x, y)\` with real and complex-valued symbols, under evaluate(False) -- what does im(x).is_zero return (None?) and does the guard behave the same as under evaluate(True)? This matters: the fix must not START raising for symbols where it previously did not, and must not STOP raising where it previously did.
- Also: does \`Point2D(1,2)\` under evaluate(False) produce an object equal to the one produced under evaluate(True)?

Build a definitive before/after expectation table. Explicitly state, for the candidate fix \`im(a).is_zero is False\`, whether it preserves evaluate(True) behavior EXACTLY for: real numbers, Floats, pure imaginary, complex, real symbols, generic symbols, nan, oo, zoo. Test each with ${PY} under evaluate(True) comparing \`bool(im(a))\` (old) vs \`im(a).is_zero is False\` (new) for a.is_number cases.`,
  },
]

// Barrier is justified: the implementer needs the complete cross-cutting picture
// (scope decisions, test idiom, and the expectation table) before writing one diff.
const research = (await parallel(investigations.map(inv => () =>
  agent(inv.prompt, { label: `investigate:${inv.key}`, phase: 'Investigate', schema: FINDINGS_SCHEMA })
    .then(r => ({ key: inv.key, ...r }))
))).filter(Boolean)

log(`Investigation complete: ${research.length}/4 reports, ${research.reduce((n, r) => n + (r.findings?.length || 0), 0)} findings`)

const inScope = research.flatMap(r => (r.findings || []).filter(f => f.inScope))
log(`In-scope findings: ${inScope.length}`)

phase('Implement')

const brief = research.map(r => `
=== REPORT: ${r.key} ===
SUMMARY: ${r.summary}
RECOMMENDATION: ${r.recommendation}
FINDINGS:
${(r.findings || []).map(f => `  - [${f.inScope ? 'IN SCOPE' : 'out of scope'}] ${f.file}${f.line ? ':' + f.line : ''}
    issue: ${f.issue}
    snippet: ${f.snippet || '(n/a)'}
    evidence: ${f.evidence}`).join('\n')}
`).join('\n')

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    filesChanged: { type: 'array', items: { type: 'string' } },
    diff: { type: 'string', description: 'The full unified diff of your change (output of git diff)' },
    rationale: { type: 'string' },
    testsAdded: { type: 'string', description: 'Names of test functions added or extended' },
    testResults: { type: 'string', description: 'Verbatim tail of the test command output' },
    reproConfirmed: { type: 'boolean', description: 'True if the exact snippet from the bug report now works' },
  },
  required: ['filesChanged', 'diff', 'rationale', 'testsAdded', 'testResults', 'reproConfirmed'],
}

const impl = await agent(`${PRELUDE}
Four investigators have reported. Here are their findings:
${brief}

YOUR TASK: Implement the fix and its regression test. You have write access.

REQUIREMENTS -- follow strictly:
1. MINIMAL, IDIOMATIC diff. The core change is the guard at sympy/geometry/point.py:~155. Prefer the assumption-based form:
       if any(a.is_number and im(a).is_zero is False for a in coords):
   Use \`is False\` (not \`not ... is_zero\` / not truthiness) so that an indeterminate \`is_zero is None\` (symbols) does NOT raise -- matching current evaluate(True) behavior for symbols.
2. Apply ONLY findings marked IN SCOPE. Do NOT refactor unrelated code, do NOT fix the pre-existing evalf/printing recursion, do NOT reformat, do NOT touch unrelated files.
3. Add the regression test into ${REPO}/sympy/geometry/tests/test_point.py following the idiom the test-conventions investigator reported. The test MUST cover:
   - the exact reported repro: \`with evaluate(False): S('Point2D(Integer(1),Integer(2))')\` succeeds and equals Point2D(1,2);
   - direct construction under evaluate(False) for Point/Point2D/Point3D;
   - the NEGATIVE case: genuinely imaginary coordinates STILL raise ValueError, under both evaluate(True) and evaluate(False).
   Match surrounding comment density and naming. Import \`evaluate\` the way the rest of the repo's tests do.
4. Verify with ${PY}:
   - the exact bug-report snippet now works;
   - ${PY} -m pytest sympy/geometry/tests/test_point.py -q  passes;
   - ${PY} -m pytest sympy/geometry/ -q  passes (report any pre-existing failures separately and confirm they are pre-existing by \`git stash\`-ing your change, re-running, and unstashing -- be careful to restore your work).
5. Report the verbatim \`git diff\` in the diff field.

Do not commit. Leave the change in the working tree.`, { label: 'implement', phase: 'Implement', schema: IMPL_SCHEMA })

if (!impl) {
  log('Implementation agent failed; aborting.')
  return { error: 'implementation failed' }
}

log(`Implemented. repro confirmed: ${impl.reproConfirmed}. files: ${(impl.filesChanged || []).join(', ')}`)

phase('Verify')

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    problems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          description: { type: 'string' },
          evidence: { type: 'string', description: 'Command run + verbatim output proving the problem is real' },
          suggestedFix: { type: 'string' },
        },
        required: ['severity', 'description', 'evidence', 'suggestedFix'],
      },
    },
    approved: { type: 'boolean', description: 'True if the change is correct and complete from your lens with no blocker/major problems' },
    notes: { type: 'string' },
  },
  required: ['lens', 'problems', 'approved', 'notes'],
}

const VERIFY_BASE = `${PRELUDE}
A fix has ALREADY been applied to the working tree. Its diff:
--------------------
${impl.diff}
--------------------
Author's rationale: ${impl.rationale}
Tests added: ${impl.testsAdded}

You are a VERIFIER. Be adversarial and skeptical. Read the actual files on disk (do not trust the diff summary). Run commands with ${PY} to prove or disprove your concerns. Do NOT modify any files -- report only. If you cannot produce concrete evidence for a problem, do not report it.`

const LENSES = [
  {
    key: 'refute-correctness',
    prompt: `${VERIFY_BASE}

YOUR LENS: correctness. Try hard to REFUTE the claim "this fix is correct and preserves prior behavior". Default to reporting a problem if you find any input where behavior differs from evaluate(True) semantics in a way that is wrong.
Specifically hunt for:
- Inputs where the OLD code raised but the NEW code does not (a real regression in the guard's protective purpose): pure imaginary, complex numbers, Float imaginary, Rational*I, nan/oo/zoo, \`sqrt(-1)\`, \`exp(I*pi/2)\`, symbols declared imaginary=True, symbols with real=False.
- Inputs where the NEW code raises but the OLD did not.
- The interaction of \`a.is_number\` short-circuit with the new form.
- Whether \`is_zero is False\` vs \`is_zero == False\` vs \`not is_zero\` matters for any real input.
Build a comparison harness: for a list of candidate coords, evaluate the OLD predicate \`bool(a.is_number and im(a))\` and the NEW predicate under evaluate(True), and confirm they agree for EVERY case; then check the NEW predicate agrees between evaluate(True) and evaluate(False). Report any disagreement with verbatim output.`,
  },
  {
    key: 'regression-suite',
    prompt: `${VERIFY_BASE}

YOUR LENS: regressions across the wider test suite. Run, with ${PY} -m pytest ... -q :
- sympy/geometry/  (whole package)
- sympy/core/tests/test_sympify.py
- sympy/parsing/tests/test_sympy_parser.py
- sympy/core/tests/test_parameters.py  (if it exists -- find the actual test file for core/parameters.py)
- sympy/utilities/tests/test_wester.py is slow; SKIP it. Also try a targeted \`grep -rln "Point2D\\|Point3D" sympy/*/tests/\` and run the most relevant additional suites (e.g. sympy/vector, sympy/plotting if quick, sympy/printing tests touching Point).
For ANY failure, determine whether it is PRE-EXISTING by stashing the change (\`git stash\`), re-running that specific test, then \`git stash pop\` to restore. YOU MUST restore the working tree before finishing -- verify with \`git diff --stat\` that the fix is still present at the end. Report exact pass/fail counts as evidence.`,
  },
  {
    key: 'minimality-idiom',
    prompt: `${VERIFY_BASE}

YOUR LENS: minimality, scope discipline, and repo idiom. Check:
- Does the diff contain ANYTHING beyond what is needed for this bug (unrelated refactors, reformatting, stray debug prints, unrelated files, .orig/.rej/.pyc artifacts, changes to out-of-scope findings)? Run \`git status --porcelain\` and \`git diff\` yourself.
- Is the new test placed sensibly, named per convention, and does it match the surrounding comment density and style? Does it duplicate an existing test?
- Is the imported name for \`evaluate\` the one the rest of the repo's tests use?
- Does the test actually FAIL without the fix? PROVE it: \`git stash push -- sympy/geometry/point.py\` (stashing ONLY the source fix, keeping the test), run the new test, confirm it fails, then \`git stash pop\` to restore. Verify with \`git diff --stat\` that everything is restored before you finish. This is the single most important check you own -- a regression test that passes without the fix is worthless.
- Are there untracked files that should not be committed?`,
  },
  {
    key: 'completeness-critic',
    prompt: `${VERIFY_BASE}

YOUR LENS: completeness. Ask "what is MISSING?" Consider:
- Does Point3D go through the same guard, and is it covered by a test? What about the general N-dimensional \`Point\` (4+ coords) and the \`dim=\` kwarg path?
- Are there OTHER lines in sympy/geometry/point.py that still break under evaluate(False)? Actually TEST the module end-to-end under \`with evaluate(False)\`: construct Points, and exercise common operations (distance, midpoint, __add__, __sub__, is_collinear, __contains__, translate, scale, rotate) to see whether anything else raises spuriously. Report what you find, marking clearly which items are BEYOND the scope of this bug report vs which are the same bug resurfacing.
- Do other geometry entities that build Points internally (Line, Segment, Circle, Polygon, Triangle, Plane) work under evaluate(False)? Try instantiating each with integer args under \`with evaluate(False)\`.
- Is there any documentation/docstring in point.py that describes the evaluate flag and should mention this, or a doctest that is now wrong?
- Was any claim in the author's rationale left unverified?
Report gaps as problems with severity reflecting whether they are in scope for THIS bug (blocker/major) or follow-up observations (minor/nit).`,
  },
]

const verdicts = (await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `verify:${l.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
    .then(v => ({ key: l.key, ...v }))
))).filter(Boolean)

const serious = verdicts.flatMap(v => (v.problems || [])
  .filter(p => p.severity === 'blocker' || p.severity === 'major')
  .map(p => ({ lens: v.key, ...p })))

log(`Verification: ${verdicts.filter(v => v.approved).length}/${verdicts.length} lenses approved; ${serious.length} blocker/major problems`)

let repair = null
if (serious.length > 0) {
  phase('Repair')
  repair = await agent(`${PRELUDE}
The fix in the working tree was reviewed by 4 adversarial verifiers. They raised these blocker/major problems:

${serious.map((p, i) => `[${i + 1}] (${p.severity}, lens=${p.lens}) ${p.description}
    EVIDENCE: ${p.evidence}
    SUGGESTED FIX: ${p.suggestedFix}`).join('\n\n')}

Full verifier notes:
${verdicts.map(v => `--- ${v.key} (approved=${v.approved}) ---\n${v.notes}`).join('\n')}

YOUR TASK: Independently judge EACH problem. Some may be wrong, out of scope, or describe pre-existing behavior -- reject those with a clear reason rather than churning the diff. Fix the ones that are genuinely real AND in scope for this bug report, keeping the diff minimal.

Then re-verify with ${PY}:
- the exact bug-report snippet works;
- the new regression test fails WITHOUT the source fix and passes WITH it (prove via git stash of just sympy/geometry/point.py, and RESTORE afterwards);
- ${PY} -m pytest sympy/geometry/ -q passes.
Ensure \`git status --porcelain\` shows no stray artifacts. Report the final \`git diff\`.`, { label: 'repair', phase: 'Repair', schema: IMPL_SCHEMA })
} else {
  log('No blocker/major problems -- skipping repair phase.')
}

return {
  rootCause: 'sympy/geometry/point.py Point.__new__: `im(a)` used in boolean context; unevaluated under global evaluate(False) and always truthy',
  outOfScopeObservations: research.flatMap(r => (r.findings || []).filter(f => !f.inScope).map(f => `${f.file}${f.line ? ':' + f.line : ''} -- ${f.issue}`)),
  implementation: impl,
  verdicts,
  seriousProblems: serious,
  repair,
}
