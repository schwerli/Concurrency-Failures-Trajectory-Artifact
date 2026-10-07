export const meta = {
  name: 'mv-design-clean',
  description: 'Empirically design math-verify modules from the spec (no upstream source)',
  phases: [
    { title: 'Probe', detail: 'validated prototypes against installed latex2sympy2_extended' },
    { title: 'Synthesize', detail: 'merge probes into one implementation plan' },
  ],
}

const RULES = `
=========================  HARD RULES  =========================
This is a FROM-SCRATCH implementation exercise. You are STRICTLY FORBIDDEN from:
  * running \`pip download\`, \`pip install math-verify\`, \`curl\`, \`wget\`, \`git clone\`, or any
    other command that fetches the \`math-verify\` package, its source, or its tests;
  * reading anything under /tmp/QUARANTINE_upstream (quarantined upstream source - off limits);
  * searching the web for the math-verify source code or its test suite.
A previous research round violated this and had to be thrown away. Do not repeat it.

You MAY and SHOULD:
  * read the installed dependency at /usr/local/lib/python3.10/site-packages/latex2sympy2_extended/
    (this is a declared dependency of our project, not the thing we are implementing);
  * run python to experiment, and iterate on your own prototypes;
  * use your own reasoning and general knowledge of sympy.
================================================================
`

const COMMON = RULES + `
CONTEXT
=======
We are implementing a library called \`math-verify\` from a written specification, in /workspace,
package root /workspace/src/math_verify/. Environment: Python 3.10.18,
latex2sympy2_extended==1.10.2, sympy==1.14.0, mpmath==1.3.0, numpy, pandas, pytest, pytest-xdist.

Established foundations (trust these, they were verified by the lead engineer):
 * \`from latex2sympy2_extended import latex2sympy, NormalizationConfig\` and
   \`from latex2sympy2_extended.latex2sympy2 import ConversionConfig\`.
 * \`latex2sympy(s, normalization_config=NormalizationConfig(...), conversion_config=ConversionConfig(...))\`
   already handles: \\frac \\sqrt \\boxed \\cfrac/\\dfrac/\\tfrac, \\left/\\right, \\text{...} units,
   intervals [0,1) (0,1], finite sets {1,2,3}, \\cup/\\cap, \\in, matrices (pmatrix/bmatrix),
   percentages (28\\% -> 28*(1/100)), \\pm (-> FiniteSet), relations, chained inequalities (-> And),
   tuples (7,6) -> Tuple.
 * NormalizationConfig(basic_latex=True, units=True, malformed_operators=True, nits=True,
   boxed="all", equations=False) reproduces most documented behavior.
 * ConversionConfig(interpret_simple_eq_as_assignment=True) makes "k = \\frac{1}{3}" -> 1/3 and
   "z \\in [-3/2,-1] \\cup [1,3/2]" -> the bare Union. Both match the spec.

TARGET PUBLIC API (from the spec):
  from math_verify import parse, verify, math_metric, ExprExtractionConfig,
      LatexExtractionConfig, StringExtractionConfig, LatexNormalizationConfig
  parse(pred, extraction_config=[LatexExtractionConfig(), ExprExtractionConfig()],
        fallback_mode="first_match", extraction_mode="any_match", parsing_timeout=5) -> list
  verify(gold, target, float_rounding=6, numeric_precision=15, strict=True,
         allow_set_relation_comp=False, timeout_seconds=5) -> bool
  math_verify.grader.sympy_expr_eq(gold, target, float_rounding, numeric_precision,
         allow_set_relation_comp=False, strict=True) -> bool
  LatexExtractionConfig must accept \`boxed_match_priority: int\` (tests construct
  \`LatexExtractionConfig(boxed_match_priority=0)\`), \`try_extract_without_anchor: bool = True\`,
  and a \`normalization_config\` field.

Write scratch work under /tmp/research/ (mkdir -p it). Do NOT write to /workspace.
`

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'pass_count', 'findings', 'recipe', 'unsolved'],
  properties: {
    file: { type: 'string', description: 'absolute path of the validated prototype you wrote' },
    pass_count: { type: 'string', description: 'e.g. "27/30 cases pass"' },
    findings: { type: 'array', items: { type: 'string' }, description: 'concrete empirical facts, each with exact input and observed output' },
    recipe: { type: 'string', description: 'dense, concrete implementation recipe you VERIFIED works: exact configs, regexes, priorities, algorithms' },
    unsolved: { type: 'array', items: { type: 'string' }, description: 'cases you could not make pass, and why' },
  },
}

phase('Probe')

const probeTargets = [
  {
    key: 'latex-extract',
    prompt: `Design and EMPIRICALLY VALIDATE the LaTeX extraction layer (regex table + priorities) and the
NormalizationConfig/ConversionConfig handed to \`latex2sympy\`.

Required behaviors (input -> expected first parse() result), all from the spec:
  "Answer $ 9 $" -> 9 ; "Answer \\\\( 9 \\\\), and more text" -> 9 ; "Answer \\\\[ 9 \\\\]" -> 9 ;
  "Answer $$ 9 $$" -> 9
  "$\\\\boxed{\\\\frac{1}{3}}$" -> Rational(1,3)
  "Answer $ \\\\frac{1}{2} \\\\$ = \\\\frac{10}{9} $" -> Rational(10,9)
  "$\\\\frac13$" -> 1/3 ; "$\\\\frac3{3}$" -> 1 ; "$\\\\sqrt3$" -> sqrt(3)
  "$\\\\cfrac{1}{3}$" / "$\\\\dfrac{1}{3}$" / "$\\\\tfrac{1}{3}$" -> 1/3
  "$\\\\left( \\\\frac{1}{3} \\\\right)$" -> 1/3 ; "$\\\\frac{1}{3} \\\\text{meters}$" -> 1/3
  "$k = \\\\frac{1}{3}$" -> 1/3
  "final answer is $9999$, \\\\boxed{1}" with boxed_match_priority=0   -> 1
  "final answer is $9999$, \\\\boxed{1}" with boxed_match_priority=100 -> 9999
  "\\\\boxed{1}" with boxed_match_priority=-1, fallback_mode="no_fallback" -> []
  "SoHi YES. could answer therefore\\\\boxed{840}.,but let me put this after explain. **Final Answer** \\\\boxed{840}" -> 840
  "the answer should be \\\\boxed{004}. But let me check again: **Final Answer** \\\\boxed{004}" -> 4
  "$[0,1)$"->Interval.Ropen(0,1) ; "$(0,1)$"->Interval.open(0,1) ; "$[0,1]$"->Interval(0,1)
  "\${1,2,3}$"->FiniteSet(1,2,3) ; "$(0.6,2.6667]$"->Interval.Lopen(0.6,2.6667)
  "$x \\\\geq 5$"->x>=5 ; "$-793 < a < 10$"->And(-793<a,a<10)
  "$34x+45y-20z+100=0$"->Eq(...) ; "$\\\\begin{pmatrix} 1 & 0 \\\\\\\\ 0 & 1 \\\\end{pmatrix}$"->Matrix([[1,0],[0,1]])
  "$(3, \\\\frac{\\\\pi}{2})$"->Tuple(3,pi/2) ; "$(7,6)$"->Tuple(7,6)
  "$1 \\\\pm \\\\sqrt{19}$"->FiniteSet(1-sqrt(19),1+sqrt(19))
  "By the quadratic formula, \$x = \\\\boxed{1 \\\\pm \\\\sqrt{19}}.\$" -> same FiniteSet
  parse("") -> [] ; parse("No valid mathematical expression here") -> []

Deliverables:
 1. Exact NormalizationConfig(...) / ConversionConfig(...) kwargs.
 2. A TESTED list of (regex, priority) covering: inline \$...\$, \\\\(...\\\\), display \$\$...\$\$,
    \\\\[...\\\\], \\\\boxed{...} (needs real brace-balancing, not a naive regex!), \\\\fbox{...},
    answer-anchored forms ("final answer is X", "answer:", "the answer is", "**Final Answer** X"),
    and a no-anchor fallback. Explain exactly how the integer boxed_match_priority slots into the
    ordering, and pick the DEFAULT boxed priority so BOTH "final answer is \$9999\$, \\\\boxed{1}"
    cases behave as specified.
 3. Matching must prefer the LAST occurrence for answer-ish patterns; state the mechanism.
 4. Handling of a trailing "." and stray \\\\\$ inside math mode.

Write a self-testing prototype /tmp/research/probe_latex_extract.py printing a PASS/FAIL table for
every case; iterate until max pass.`,
  },
  {
    key: 'expr-numbers',
    prompt: `Design and EMPIRICALLY VALIDATE the plain-expression ("expr") extraction layer, especially
NUMBER FORMAT NORMALIZATION. Required:
  parse("7,425,000")->7425000 ; parse("1 000")->1000
  parse("1000,99")->1000.99 ; parse("1,22")->1.22        (European decimal comma!)
  parse("\$1,000.99")->1000.99                            (currency stripped)
  parse("the number is not 10 which is 1,000.99EUR")->1000.99
  parse("so the number is 10 which is 1,000.99m2")->1000.99
  parse(".4")->0.4 ; parse("Answer: ...garbage...123.45")->123.45
  parse("and then Alice wins ... The probability is (1/2) * (1/2) * P(A), P(A) = 2/3") -> 2/3
  parse("Let's denote ... Therefore, there are 12 distinct arithmetic sequences.") -> 12
  parse("") -> [] ; parse("No valid mathematical expression here") -> []
  MUST NOT extract 2 from "AZYUK2A" (digit glued to letters is not a number)
  Must parse algebraic text like "x^2 + 3*x".

Critical subtlety: THOUSANDS separator ("1,000.99"->1000.99 ; "7,425,000"->7425000) vs EUROPEAN
DECIMAL comma ("1000,99"->1000.99 ; "1,22"->1.22). Derive and TEST the disambiguation rule
(consider: are all comma-groups exactly 3 digits? is there also a '.'? how many digits precede?).

Deliverables:
 1. A tested number-normalizer function.
 2. A tested (regex, priority) list for expr extraction: number regex (sign, decimals, scientific
    notation, thousands separators), simple-expression regex (+ - * / ^ parens variables), and
    anchored variants ("answer is X", "= X").
 3. The exact boundary conditions that reject "AZYUK2A".
 4. How to call sympy's \`parse_expr\` (which transformations, evaluate flag, \`^\` handling).

Write a self-testing prototype /tmp/research/probe_expr_numbers.py printing PASS/FAIL per case;
iterate until max pass.`,
  },
  {
    key: 'grader-core',
    prompt: `Design and EMPIRICALLY VALIDATE the numeric + symbolic comparison core of \`sympy_expr_eq\`.
Build sympy objects via \`latex2sympy\` using NormalizationConfig(basic_latex=True, units=True,
malformed_operators=True, nits=True, boxed="all", equations=False) and
ConversionConfig(interpret_simple_eq_as_assignment=True).

Required (gold, pred, expected, precision):
  ("$\\\\frac{1}{2}$","$0.5$",True,6) ; ("$\\\\frac{1}{12}$","$0.0833333333333333$",True,6)
  ("$\\\\frac{1}{3}$","$0.33$",True,2) ; ("$\\\\frac{1}{3}$","$0.33$",False,6)
  ("$\\\\frac{1}{3}$","$0.3333$",True,4) ; ("$\\\\frac{1}{3}$","$0.333333$",True,6)
  ("$\\\\frac{x+2}{7}$","$\\\\frac{x}{7}+\\\\frac{2}{7}$",True,6)
  ("$\\\\tan^2(y)+1$","$\\\\sec^2(y)$",True,6)
  ("$\\\\frac{\\\\sqrt{\\\\sqrt{11}+\\\\sqrt{194}}}{15+2\\\\sqrt{33}}$",
   "$\\\\frac{\\\\sqrt{\\\\sqrt{11}+\\\\sqrt{194}}}{2\\\\sqrt{33}+15}$",True,6)
  ("$\\\\frac{34}{16}+\\\\frac{\\\\sqrt{1358}}{16}$","$4$",False,6)
  ("\${-100}^{-1}$","$-\\\\frac{1}{100}$",True,6) ; ("$28\\\\%$","28 percent",True,6)

Design and TEST the strategy ladder:
  1. fast structural / string equality
  2. numeric equality: round both to \`float_rounding\` decimals after evaluating at
     \`numeric_precision\` significant digits (sympy N / mpmath mp.dps). precision=2 vs 6 must
     behave exactly as required above.
  3. symbolic: simplify(gold-target)==0 with expand/trigsimp/radsimp/cancel fallbacks, guarded
     against hangs.
Determine how to decide between the numeric and symbolic paths when free symbols are present
(numeric substitution is unsafe then) - test and describe.
Comparison must NEVER raise (swallow exceptions -> False) and must be fast.

Write self-testing prototype /tmp/research/probe_grader_core.py; iterate until max pass.`,
  },
  {
    key: 'grader-structures',
    prompt: `Design and EMPIRICALLY VALIDATE comparison of STRUCTURED objects: sets, tuples, intervals,
matrices, relations, and the \`strict\` flag. Build objects via \`latex2sympy\` (same configs as
described in the context above).

Required (gold, pred, expected, precision):
 SETS/INTERVALS
  ("\${1,3}\\\\cup{2,4}$","\${1,2,3,4}$",True,6) ; ("\${1,2,3}$","\${3,2,1}$",True,6)
  ("$[0,1)$","$[0,1)$",True,6) ; ("$[0,9)$","$[0,1)$",False,6) ; ("$(0,9)$","$[0,9)$",False,6)
  ("$(\\\\frac{3}{5},\\\\frac{8}{3}]$","$(0.6,2.6667]$",True,2) and also True at precision 6
  ("$[0,1)$","the domain is (0, 1)",False,6)
 TUPLES
  ("$(1,\\\\frac{9}{2})$","$(1,4.5)$",True,6) ; ("$(7,6)$","$(7,6)$",True,6)
 MATRICES
  ("$\\\\begin{pmatrix}\\\\frac{1}{3}\\\\\\\\ \\\\frac{1}{5} \\\\end{pmatrix}$",
   "$\\\\begin{pmatrix}0.33\\\\\\\\0.2 \\\\end{pmatrix}$",True,2)
  identical pmatrix vs itself -> True
 RELATIONS
  ("$x \\\\geq 5$","$5 \\\\leq x$",True,6)                       # direction flip
  ("$34x+45y-20z+100=0$","$-34x-45y+20z-100=0$",True,6)      # equation up to a -1 factor
  ("$$-793 < a < 10$$","$$(-793, 10)$$",True,6)              # And-chain vs Interval.
     IMPORTANT: the spec asserts this is True with the DEFAULT allow_set_relation_comp=False.
     Determine empirically what makes that hold and describe it precisely.
 STRICT MODE (strict=True -> not equal ; strict=False -> equal)
  ("$f(x)$","$f(y)$") ; ("$\\\\sin(x)+\\\\cos(x)$","$\\\\sin(t)+\\\\cos(t)$")
  ("$\\\\begin{pmatrix} x & y \\\\\\\\ z & w \\\\end{pmatrix}$","$\\\\begin{pmatrix} a & b \\\\\\\\ c & d \\\\end{pmatrix}$")
  ("$g(a, b) + h(a)$","$g(x, y) + h(x)$")

Notes to exploit:
 * latex2sympy2_extended ships patched \`FiniteSet\` (latex2sympy2_extended.sets) and \`And\`
   (.logic) retaining \`_unsorted_args\` - work out how that enables comparing a FiniteSet against
   a Tuple and ordered-vs-unordered semantics.
 * Set/interval/matrix element comparison must honor \`float_rounding\` (Rational vs Float within
   precision). Plain sympy \`==\` will NOT do this - write a recursive elementwise matcher that
   delegates to the numeric comparison from the core ladder.
 * For And-chain -> Interval, investigate sympy's \`.as_set()\` on relationals, guarded by a
   single-free-symbol check.
 * strict=False: canonically rename free symbols / applied-function args in both expressions
   (e.g. by order of appearance -> _x0,_x1,...) then compare. TEST it, including the matrix case.

Write self-testing prototype /tmp/research/probe_grader_structures.py; iterate until max pass.`,
  },
  {
    key: 'string-timeout-metric',
    prompt: `Design and EMPIRICALLY VALIDATE three smaller subsystems.

(A) StringExtractionConfig extraction. Required exactly:
   parse("The answer is A.",[StringExtractionConfig(lowercase=False)]) == ["A","A"]
   parse("The answer is A.",[StringExtractionConfig(lowercase=True)])  == ["a","A"]
   parse("Final answer is B",[StringExtractionConfig()])               == ["b","B"]
   parse("No valid answer here",[StringExtractionConfig()])            == []
   parse("A. Because B is not valid",[StringExtractionConfig()])       == ["a","A"]
   parse("The answer is U.",[StringExtractionConfig(strings=("U",))])  == ["u","U"]
   parse("Because B is valid",[StringExtractionConfig()])              == ["b","B"]
 The result is a 2-element list [normalized, original]. Derive regexes: an anchored form
 ("answer is X"), a leading-token form ("A. ..."), and a bare-mention fallback, all with word
 boundaries so "No valid answer here" yields []. Note "A. Because B is not valid" -> A (leading
 position wins) while "Because B is valid" -> B.

(B) The \`timeout\` decorator for utils.py. Must:
 - use signal.SIGALRM (signal.setitimer) so a slow call raises TimeoutException from errors.py
 - accept \`timeout_seconds: int | None\`; when None install NO timeout (thread-safe mode)
 - work as \`@timeout(timeout_seconds=5)\` AND let the wrapped call override via its own kwarg
 - restore the previous handler and cancel the alarm in a finally block; support nesting
   (parse inside verify)
 These spec requirements constrain the design - they patch our internals with unittest.mock:
   patch("math_verify.parser.parse_expr", <sleeps 5s>)  =>
       parse("1+1", parsing_timeout=1, extraction_mode="first_match", fallback_mode="no_fallback") == []
   patch("math_verify.parser.latex2sympy", <sleeps 5s>) =>
       parse("$1+1$", parsing_timeout=1, ...) == []
   patch("math_verify.grader.sympy_expr_eq", <sleeps 5s>) =>
       verify(parse("1+1"), parse("1+1"), timeout_seconds=1) == False
 => \`parse_expr\` and \`latex2sympy\` must be MODULE-LEVEL names in math_verify.parser, and
 \`sympy_expr_eq\` a module-level name in math_verify.grader, resolved at call time so patching
 works; and the TimeoutException must be caught and converted to []/False, not propagated.
 Note TimeoutException should subclass BaseException so a bare \`except Exception\` inside the
 parsing code cannot accidentally swallow it - verify this reasoning and test it.
 Prototype and TEST with real sleeps and real mock.patch in a dummy module:
 /tmp/research/probe_timeout.py

(C) \`math_metric\` for metric.py:
   math_metric(gold_extraction_target, pred_extraction_target, aggregation_function=max,
               fallback_mode="first_match", precision=6, strict=True,
               allow_set_relation_comp=False)
     -> Callable[[list[str], list[str]], tuple[float, tuple[list, list]]]
 The returned callable parses each gold and each prediction, verifies pairwise, aggregates with
 aggregation_function, returns (score, (parsed_golds, parsed_preds)). Write a small usage example
 validating the shape. Put it in /tmp/research/probe_string_metric.py together with (A).`,
  },
]

const probes = await parallel(probeTargets.map(t => () =>
  agent(COMMON + '\n\nYOUR TASK\n=========\n' + t.prompt, {
    label: `probe:${t.key}`, phase: 'Probe', schema: PROBE_SCHEMA,
  })
))

phase('Synthesize')

const probeBlob = probeTargets.map((t, i) => {
  const p = probes[i]
  if (!p) return `--- PROBE ${t.key}: AGENT DIED ---`
  return `--- PROBE ${t.key}  (${p.pass_count})  file=${p.file} ---
FINDINGS:
${(p.findings || []).map(f => '  * ' + f).join('\n')}
RECIPE:
${p.recipe}
UNSOLVED:
${(p.unsolved || []).map(f => '  ! ' + f).join('\n')}`
}).join('\n\n')

const synth = await agent(RULES + `
You are the integration architect for the from-scratch \`math-verify\` implementation in /workspace
(package /workspace/src/math_verify/). Five probe agents each built and empirically validated a
prototype under /tmp/research/. Their reports are below.

Produce ONE authoritative implementation plan, written to /tmp/research/PLAN.md, concrete enough
that the lead engineer can type out the final code from it. READ the prototype files under
/tmp/research/ to confirm details before asserting them.

The plan must specify, precisely:
 1. File list for src/math_verify/ and what goes in each.
 2. Exact dataclass definitions with field names, types and DEFAULT values:
    LatexExtractionConfig (incl. default boxed_match_priority and default normalization_config),
    ExprExtractionConfig, StringExtractionConfig, the ExtractionTarget alias.
 3. The exact NormalizationConfig + ConversionConfig for latex parsing.
 4. Full (regex, priority) tables for latex / expr / string extraction, and the exact algorithm of
    parse(): how matches from multiple configs are collected, sorted by (priority, position),
    how extraction_mode first_match/any_match and fallback_mode no_fallback/first_match alter it.
 5. The full ordered strategy ladder for sympy_expr_eq, including structured-object dispatch
    (sets/tuples/intervals/matrices/relations) and the strict / allow_set_relation_comp flags.
 6. utils.timeout semantics + the module structure required for unittest.mock patchability of
    math_verify.parser.parse_expr, math_verify.parser.latex2sympy, math_verify.grader.sympy_expr_eq.
 7. math_metric's contract.
 8. Remaining risks and any cases the probes could not make pass, with your recommended fallback.

Be decisive: where probes conflict, pick one and justify in a sentence.

=========== PROBE REPORTS ============
${probeBlob}
`, { label: 'synthesize-plan', phase: 'Synthesize', effort: 'high' })

return {
  planFile: '/tmp/research/PLAN.md',
  synthesis: synth,
  probes: probeTargets.map((t, i) => ({
    key: t.key, ok: !!probes[i],
    pass_count: probes[i] && probes[i].pass_count,
    file: probes[i] && probes[i].file,
    unsolved: probes[i] && probes[i].unsolved,
  })),
}
