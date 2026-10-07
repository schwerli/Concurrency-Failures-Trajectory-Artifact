export const meta = {
  name: 'imageset-reals-intersection-analysis',
  description: 'Root-cause and design the fix for ImageSet.intersect(Reals) returning wrong set',
  phases: [
    { title: 'Understand', detail: 'parallel readers over handler, contains/is_subset, tests, solver helpers' },
    { title: 'Design', detail: 'independent fix proposals' },
    { title: 'Judge', detail: 'score proposals against the semantics map' },
  ],
}

const REPRO = `
REPO: /testbed (sympy, branch master). Python interpreter to use: /opt/miniconda3/envs/testbed/bin/python
(plain \`python\` lacks mpmath — ALWAYS use the full path above.)

THE BUG (sympy issue "bug in is_subset(Reals)", arose from fixing #19513):

    from sympy import *
    n = Symbol('n')
    S1 = imageset(Lambda(n, n + (n - 1)*(n + 1)*I), S.Integers)
    S1                      # {n + I*(n-1)*(n+1) | n in Integers}
    2 in S1                 # False   (correct)
    2 in S1.intersect(Reals) # currently True  -- WRONG, should be False
    S1.intersect(Reals)     # currently Complement(Integers, FiniteSet((-1, 1)))
                            # should be FiniteSet(-1, 1)  i.e. {-1, 1}

The suspect code is the \`if other == S.Reals:\` branch of
\`@dispatch(ImageSet, Set) def intersection_sets\` in
/testbed/sympy/sets/handlers/intersection.py (around lines 279-322).
`;

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Dense prose summary of what you found' },
    key_facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact: { type: 'string' },
          evidence: { type: 'string', description: 'file:line or command output that proves it' },
        },
        required: ['fact', 'evidence'],
      },
    },
    risks: { type: 'array', items: { type: 'string' }, description: 'Things a fix could break' },
  },
  required: ['summary', 'key_facts'],
};

phase('Understand')

const LENSES = [
  {
    key: 'handler-semantics',
    prompt: `${REPRO}

YOUR LENS: the ImageSet-vs-Reals intersection handler itself.

Read /testbed/sympy/sets/handlers/intersection.py fully, focusing on the \`other == S.Reals\` branch.
Explain PRECISELY, line by line, what the code computes for the repro's im = (n-1)*(n+1):
- what \`f_.as_real_imag()\` returns, what \`expand_complex\` does
- what \`Mul.make_args(im)\` yields
- what \`solve_linear(i, 0)\` returns for each arg (run it in python and show output)
- what \`zip(*[...])\` produces for x and xis
- what \`FiniteSet(xis)\` constructs (a set containing a TUPLE?) vs \`FiniteSet(*xis)\`
- whether \`base_set -= ...\` is the mathematically correct operation at all, given we
  want exactly the n where the imaginary part VANISHES

State the correct mathematical semantics: for imageset(Lambda(n, re(n)+I*im(n)), base_set)
intersected with Reals, which n survive? Then say what the code should do instead.

Also examine the "exclude values that make denominators 0" loop right below (lines ~312-321):
it iterates \`for i in denoms(f)\` but then inside computes solve_linear over
\`Mul.make_args(im)\` -- note IM, not I. Is that a copy-paste bug? What should it be?
Note the loop variable \`i\` is also shadowed by the inner comprehension's \`i\`.

Use git log/git blame on that region to find the #19513 commit that introduced this code and
report what it changed and why (paste the relevant diff hunk).`,
  },
  {
    key: 'contains-is-subset',
    prompt: `${REPRO}

YOUR LENS: is there a SECOND, independent bug in \`is_subset\` / \`Complement\` / \`__contains__\`,
separate from the intersection handler? The issue is TITLED "bug in is_subset(Reals)".

Investigate:
- \`Set.is_subset\`, \`Set._eval_is_subset\`, \`Set.issubset\` in /testbed/sympy/sets/sets.py
- /testbed/sympy/sets/handlers/issubset.py (if it exists)
- \`ImageSet._contains\` in /testbed/sympy/sets/fancysets.py
- how \`2 in Complement(Integers, FiniteSet((-1,1)))\` evaluates to True (it does)
- Run: S1.is_subset(S.Reals) and (S1 - S.Reals), Reals.intersect(S1), Intersection(S1, Reals)
  and the argument-order-swapped forms. Report every output.
- Does the intersection get computed via is_subset anywhere (e.g. line ~53
  \`if other.is_subset(S.Reals)\` and line ~366)? Trace which dispatch actually fires for
  S1.intersect(Reals) -- prove it with a breakpoint/print or by reading Set.intersect ->
  Intersection -> simplify_intersection -> intersection_sets dispatch.

Conclude clearly: is the ONLY defect the ImageSet/Reals handler, or is there also a defect in
is_subset/Complement that needs its own fix? Give evidence either way. Do NOT speculate.`,
  },
  {
    key: 'existing-tests',
    prompt: `${REPRO}

YOUR LENS: what existing tests pin the current behavior of ImageSet ∩ Reals?

grep the test suite for tests touching this branch:
- /testbed/sympy/sets/tests/test_fancysets.py (esp. anything with Reals + imageset,
  test_imageset_intersect_real, test_imageset_intersect_interval, test_ImageSet_contains ...)
- /testbed/sympy/sets/tests/test_sets.py
- /testbed/sympy/solvers/tests/* that rely on imageset intersect Reals
- grep broadly: grep -rn "intersect(S.Reals)\\|Intersection(.*Reals" /testbed/sympy --include=*.py

For EACH test that exercises imageset ∩ Reals, quote the assertion and say what it expects.
Flag any that would CHANGE if the handler switched from "base_set -= solutions" to
"base_set &= solutions". Pay special attention to tests involving:
  - Lambda(n, 1/n), Lambda(n, n + I*n**2) or similar with denominators
  - test_imageset_intersect_real and any test referencing issue 19513

Run those specific test functions with the testbed python and report pass/fail baseline, e.g.
  /opt/miniconda3/envs/testbed/bin/python -m pytest /testbed/sympy/sets/tests/test_fancysets.py -x -q
Report the baseline result (should be all passing before any fix).`,
  },
  {
    key: 'solver-helpers',
    prompt: `${REPRO}

YOUR LENS: the solver helpers a fix would rely on. Establish their exact contracts empirically.

For each of these, read the source AND run examples with /opt/miniconda3/envs/testbed/bin/python:
- \`solve_linear(lhs, rhs=0, symbols=[], exclude=[])\` from sympy.solvers.solvers:
  what does it return for solve_linear(n-1, 0), solve_linear(n**2+1, 0),
  solve_linear(n*(n-1), 0), solve_linear(sin(n), 0)? What does it return when the
  expression is NOT linear in the symbol (what is the first element then)? Show the outputs.
  What does passing symbols=[n] change?
- \`denoms(eq, *symbols)\` from sympy.solvers.solvers: what does denoms(1/n + I/(n-2)) return?
- \`solveset_real\` / \`solveset(expr, n, S.Reals)\`: results for (n-1)*(n+1), n**2+1, sin(n).
  Does it return ImageSet/ConditionSet in awkward cases?
- \`ConditionSet(n, Eq(im, 0))\` with and without a base_set third arg -- what is the default
  base set, and does \`Integers & ConditionSet(n, Eq(f,0))\` behave sensibly? Show outputs.
- What does \`Union()\` of zero args return? What does \`base_set &= Union(FiniteSet(1), FiniteSet(-1))\`
  give when base_set is Integers? Show it.

Goal: tell the implementer which helper is safest for "find all n with im(n)==0" in a way that
degrades gracefully (ConditionSet) for non-linear/transcendental im, and that does NOT hang or
raise. Note any helper that is slow or raises NotImplementedError.`,
  },
];

const understanding = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `understand:${l.key}`, phase: 'Understand', schema: FINDINGS_SCHEMA })
));

const brief = LENSES.map((l, i) => {
  const u = understanding[i];
  if (!u) return `### ${l.key}\n(agent failed)`;
  return `### ${l.key}\n${u.summary}\n\nFACTS:\n${(u.key_facts || []).map(f => `- ${f.fact}  [${f.evidence}]`).join('\n')}\n\nRISKS:\n${(u.risks || []).join('; ')}`;
}).join('\n\n');

log('Understand phase complete; designing fixes');

phase('Design')

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    approach_name: { type: 'string' },
    rationale: { type: 'string' },
    diff: { type: 'string', description: 'Exact final code for the changed region, as a unified diff or full replacement block with file and line anchors' },
    handles_denominators: { type: 'string', description: 'How the denominator-exclusion loop is fixed' },
    degrades_gracefully: { type: 'string', description: 'What happens for non-linear / transcendental imaginary parts' },
    tests_to_add: { type: 'array', items: { type: 'string' }, description: 'Concrete assertions to add, with target test file' },
    verified_output: { type: 'string', description: 'Actual observed output after applying your patch in a scratch copy, including the full sets/*/tests result' },
  },
  required: ['approach_name', 'rationale', 'diff', 'handles_denominators', 'degrades_gracefully', 'tests_to_add', 'verified_output'],
};

const ANGLES = [
  {
    key: 'minimal',
    slant: `Aim for the SMALLEST correct change to the existing code shape. Keep solve_linear.
Fix (a) the wrong set operation (subtract vs intersect) and (b) the FiniteSet(tuple) bug and
(c) the im-vs-i copy/paste bug in the denominator loop. Do not add new helpers unless required.`,
  },
  {
    key: 'helper-refactor',
    slant: `Introduce a small local helper (e.g. \`_solution_union(exprs, sym)\`) that maps a list of
expressions to the Union of their zero-sets, using solve_linear when the expr is linear in sym and
falling back to ConditionSet(sym, Eq(expr, 0)) otherwise. Then express the fix as
\`base_set &= _solution_union(Mul.make_args(im), n)\` and \`base_set -= _solution_union(denoms(f), n)\`.
Justify why the union (not intersection) of per-factor zero sets is right for a PRODUCT im.`,
  },
  {
    key: 'solveset-based',
    slant: `Use the solveset machinery instead of solve_linear: \`base_set &= solveset_real(im, n)\` (or
solveset(im, n, S.Reals)) and similar for denominators. Evaluate honestly whether this is robust
(recursion into intersection_sets? ConditionSet blowups? performance? circular imports?) and report
any test regressions it causes. If it is worse than the helper approach, SAY SO explicitly.`,
  },
];

const proposals = await parallel(ANGLES.map(a => () => agent(
  `${REPRO}

RESEARCH BRIEF FROM THE UNDERSTAND PHASE (trust but verify):

${brief}

YOUR TASK: design and EMPIRICALLY VALIDATE a fix.

YOUR ANGLE: ${a.slant}

Rules:
1. Work in a scratch copy so you do not disturb the main tree:
   cp -a /testbed /tmp/wk-${a.key} && work in /tmp/wk-${a.key}
   (run python as: cd /tmp/wk-${a.key} && /opt/miniconda3/envs/testbed/bin/python ...)
   Verify sys.path picks up the scratch sympy (print sympy.__file__) BEFORE trusting results.
2. Apply your patch there and confirm ALL of these:
   - S1.intersect(Reals) == FiniteSet(-1, 1)
   - (2 in S1.intersect(Reals)) is False
   - (2 in S1) is False
   - S1.intersect(Reals) is a plain FiniteSet, not a Complement/ConditionSet
   Also check these do not regress (report actual output for each):
   - imageset(Lambda(n, n), S.Integers).intersect(Reals)
   - imageset(Lambda(n, n*I), S.Integers).intersect(Reals)
   - imageset(Lambda(n, n + I), S.Integers).intersect(Reals)
   - imageset(Lambda(n, 1/n + I*n), S.Integers).intersect(Reals)   # denominator case
   - imageset(Lambda(n, I*(n**2+1)), S.Integers).intersect(Reals)   # no real solutions
   - imageset(Lambda(n, I*sin(n)), S.Integers).intersect(Reals)     # transcendental -> ConditionSet?
   - imageset(Lambda(n, n + I*n*(n-1)*(n-2)), S.Integers).intersect(Reals)  # 3 factors
   - Symbol('m') free: imageset(Lambda(n, n + I*m), S.Integers).intersect(Reals)
   - S1.is_subset(Reals)
3. Run the full relevant test files and paste the tail of the output:
   /opt/miniconda3/envs/testbed/bin/python -m pytest sympy/sets/tests/ -q
   /opt/miniconda3/envs/testbed/bin/python -m pytest sympy/solvers/tests/test_solveset.py -q
   If anything fails, either fix your approach or report the failure honestly with the assertion text.
4. Put the EXACT final code in \`diff\` (with enough context to apply unambiguously).
5. \`verified_output\` must contain REAL pasted output, not what you expect. If you did not run it, say so.`,
  { label: `design:${a.key}`, phase: 'Design', schema: PROPOSAL_SCHEMA, effort: 'high' }
)));

const alive = ANGLES.map((a, i) => ({ angle: a.key, p: proposals[i] })).filter(x => x.p);
log(`${alive.length}/${ANGLES.length} proposals returned`);

phase('Judge')

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    ranking: { type: 'array', items: { type: 'string' }, description: 'approach keys, best first' },
    winner: { type: 'string' },
    winner_final_code: { type: 'string', description: 'The exact code to write into intersection.py, cleaned up, ready to apply' },
    grafts: { type: 'array', items: { type: 'string' }, description: 'Good ideas from the runners-up to fold in' },
    tests_to_add: { type: 'array', items: { type: 'string' }, description: 'Final consolidated list of assertions to add, each with target file and test function name' },
    unresolved: { type: 'array', items: { type: 'string' }, description: 'Anything still uncertain that the implementer must check' },
  },
  required: ['ranking', 'winner', 'winner_final_code', 'tests_to_add'],
};

const bundle = alive.map(x => `## APPROACH ${x.angle}
name: ${x.p.approach_name}
rationale: ${x.p.rationale}
handles_denominators: ${x.p.handles_denominators}
degrades_gracefully: ${x.p.degrades_gracefully}
tests_to_add: ${(x.p.tests_to_add || []).join(' | ')}
CODE:
${x.p.diff}
OBSERVED OUTPUT:
${x.p.verified_output}`).join('\n\n---\n\n');

const LENSES2 = ['mathematical-correctness', 'regression-risk-and-idiom', 'graceful-degradation'];

const judgments = await parallel(LENSES2.map(lens => () => agent(
  `${REPRO}

Three candidate fixes were designed and each claims to have been tested. Judge them through the
lens of **${lens}**.

${bundle}

RESEARCH BRIEF:
${brief}

Be adversarial. Specifically check:
- Is the set algebra actually right? For im = product of factors, the zero set is the UNION of the
  factors' zero sets. Does the winning code use Union, not Intersection? Prove it with a 3-factor
  case run in a scratch copy.
- Does any candidate still contain FiniteSet(tuple) (a set whose element is a Tuple)? That is the
  original bug; catch it.
- Does the denominator loop correctly use the denominator expression (not \`im\`)? Does it still
  SUBTRACT (correct for denominators) while the im-part INTERSECTS?
- Does any candidate break \`imageset(Lambda(n, n), S.Integers).intersect(Reals) == Integers\`?
- Is the code idiomatic for this file (imports at top of branch, naming, comment style)?
- Independently re-run the claimed verification in your own scratch copy
  (cp -a /testbed /tmp/judge-${lens.replace(/[^a-z]/g, '')}) for the winner you pick. Do not take the
  designer's word for the output.

Then produce the FINAL code to apply and the FINAL test assertions.`,
  { label: `judge:${lens}`, phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'high' }
)));

return {
  understanding: LENSES.map((l, i) => ({ lens: l.key, findings: understanding[i] })),
  proposals: alive,
  judgments: LENSES2.map((l, i) => ({ lens: l, verdict: judgments[i] })).filter(x => x.verdict),
};
