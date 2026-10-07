export const meta = {
  name: 'mv-research',
  description: 'Reconstruct + empirically validate math-verify 0.8.0 module designs',
  phases: [
    { title: 'Recall', detail: 'independent memory reconstructions of the real library' },
    { title: 'Probe', detail: 'empirical behavior probes against installed latex2sympy2_extended' },
    { title: 'Synthesize', detail: 'merge recall + probe into one design doc' },
  ],
}

const COMMON = `
CONTEXT
=======
We are reimplementing HuggingFace's \`math-verify\` version 0.8.0 (github.com/huggingface/math-verify)
from scratch in /workspace. The package lives at /workspace/src/math_verify/.

The environment ALREADY has the exact dependency installed:
  latex2sympy2_extended==1.10.2  at /usr/local/lib/python3.10/site-packages/latex2sympy2_extended/
  sympy==1.14.0, mpmath==1.3.0, numpy, pandas, pytest, pytest-xdist
Python 3.10.18. You may read those installed sources freely — they are the ground truth for the
dependency API. Do NOT modify anything under site-packages.

Key facts already established by the lead engineer (trust these):
 * \`latex2sympy(latex_str, normalization_config=NormalizationConfig(...), conversion_config=ConversionConfig(...))\`
   is the LaTeX workhorse. It already handles \\frac, \\sqrt, \\boxed, intervals, sets, matrices,
   \\cup, \\in, percentages (28\\% -> 28*(1/100)), \\pm (-> FiniteSet), relations, And-chains.
 * NormalizationConfig(basic_latex=True, units=True, malformed_operators=True, nits=True,
   boxed="all", equations=False) reproduces most documented behavior.
 * ConversionConfig(interpret_simple_eq_as_assignment=True) turns "k = \\frac{1}{3}" into 1/3,
   and "z \\in [-3/2,-1] \\cup [1,3/2]" into the bare Union. This matches the spec.
 * The final public API must be:
     from math_verify import parse, verify, math_metric, ExprExtractionConfig,
         LatexExtractionConfig, StringExtractionConfig, LatexNormalizationConfig
   plus math_verify.grader.sympy_expr_eq and math_verify.parser.
 * verify() signature: verify(gold, target, float_rounding=6, numeric_precision=15, strict=True,
   allow_set_relation_comp=False, timeout_seconds=5) -> bool
 * parse() signature: parse(pred, extraction_config=[LatexExtractionConfig(), ExprExtractionConfig()],
   fallback_mode="first_match", extraction_mode="any_match", parsing_timeout=5) -> list
 * LatexExtractionConfig must accept a \`boxed_match_priority: int\` field (tests construct
   \`LatexExtractionConfig(boxed_match_priority=0)\`), plus \`try_extract_without_anchor: bool = True\`
   and a \`normalization_config\` field.

We will be graded by the project's REAL hidden pytest suite (very likely math-verify's own
tests/test_all.py, tests/test_boxed.py, tests/test_errors.py, tests/test_metric.py), which contains
many hundreds of parametrized (gold, pred, expected) cases. So FAITHFULNESS TO THE REAL LIBRARY'S
BEHAVIOR is what scores points, not merely satisfying the doc examples.

Write scratch work under /tmp/research/ (mkdir it). Never write to /workspace in this phase.
`

const RECALL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'summary', 'confidence', 'uncertain_points'],
  properties: {
    file: { type: 'string', description: 'absolute path of the reconstruction you wrote' },
    summary: { type: 'string', description: 'dense prose summary of the design: names, signatures, fields, defaults, ordering, algorithms' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    uncertain_points: { type: 'array', items: { type: 'string' }, description: 'specific things you are unsure about that the lead must decide' },
  },
}

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'findings', 'recipe'],
  properties: {
    file: { type: 'string', description: 'absolute path of the validated code/notes you wrote' },
    findings: { type: 'array', items: { type: 'string' }, description: 'concrete empirical facts, each with the exact input and observed output' },
    recipe: { type: 'string', description: 'the concrete recommended implementation approach, dense, including exact configs/regexes/algorithms that you VERIFIED work' },
  },
}

phase('Recall')

const recallTargets = [
  {
    key: 'parser',
    prompt: `Reconstruct, from your memory of the actual huggingface/math-verify source code (version 0.5-0.8),
the file \`src/math_verify/parser.py\` as faithfully as you possibly can.

Focus especially on:
 - The exact dataclasses: LatexExtractionConfig (fields + DEFAULT VALUES, especially the default
   \`boxed_match_priority\` and the default \`normalization_config\`), ExprExtractionConfig,
   StringExtractionConfig, and the \`ExtractionTarget\` union alias.
 - The regex-building helper functions (e.g. \`lazy_latex_regex\`, \`lazy_expr_regex\`,
   \`lazy_string_regex\`) — their exact regex patterns and the integer PRIORITY assigned to each
   pattern. Priorities determine which match wins. Reconstruct the priority numbers.
 - The answer-anchor prefixes ("final answer is", "answer:", "answer is", the colon variants,
   the \\*\\*Final Answer\\*\\* markdown form, etc.).
 - \`extract_match\`, \`extract_target_from_pred\`, and the main \`parse()\` function, including how
   \`extraction_mode\` ("first_match"/"any_match") and \`fallback_mode\` ("no_fallback"/"first_match")
   change control flow, and how matches from multiple configs are grouped/sorted by priority then
   by position in the string.
 - Helper functions like \`convert_to_pct\`, \`extract_expr\`, \`extract_latex\`,
   \`should_treat_as_complex\`, and the number-normalization for thousands separators.
 - How timeouts wrap parsing.

Write your reconstruction to /tmp/research/recall_parser.py (as valid-ish Python, comments where unsure).
Do NOT run it. Prioritise recalling exact regexes, field defaults and priority integers.`,
  },
  {
    key: 'grader',
    prompt: `Reconstruct, from your memory of the actual huggingface/math-verify source code (version 0.5-0.8),
the file \`src/math_verify/grader.py\` as faithfully as you possibly can.

Focus especially on:
 - \`sympy_expr_eq(gold, target, float_rounding, numeric_precision, allow_set_relation_comp=False, strict=True) -> bool\`
   and the ORDER of strategies it tries.
 - The helper comparison functions and their exact names, e.g.
   \`sympy_deep_compare_set_and_tuple\`, \`sympy_compare_sets\`, \`sympy_compare_interval\`,
   \`sympy_compare_relational\`, \`sympy_compare_matrix\`, \`sympy_str_eq\`, \`sympy_numeric_eq\`,
   \`sympy_symbolic_eq\`, \`is_assignment_relation\`, \`take_last_relation\`,
   \`unwrap_fcs\`, \`sympy_solve_and_compare\` / \`sympy_compare_symbols\`.
 - How numeric comparison works: use of \`.round()\`, \`N(...)\`, mpmath \`mp.dps\`,
   \`numeric_precision\`, and the fallback to \`math.isclose\`/\`abs(a-b) < eps\`.
 - How relations are compared: flipping direction (a<b vs b>a), and comparing equations up to a
   multiplicative constant (34x+45y=0 vs -34x-45y=0), moving everything to one side.
 - How sets/tuples/intervals/matrices/FiniteSets are compared elementwise, order-insensitively for
   sets and order-sensitively for tuples, and the special handling of \`_unsorted_args\`.
 - The \`strict\` flag: what exactly it relaxes (function/symbol renaming, tuple-vs-set,
   interval-vs-set, etc.).
 - \`allow_set_relation_comp\`: comparing e.g. an inequality against an interval/set.
 - The top-level \`verify()\` function in grader.py, how it iterates over gold/target lists
   (the cartesian product), the timeout decoration, and exception swallowing.

Write your reconstruction to /tmp/research/recall_grader.py. Do NOT run it.
Prioritise exact function names, strategy ORDER, and numeric-comparison details.`,
  },
  {
    key: 'support',
    prompt: `Reconstruct, from your memory of the actual huggingface/math-verify source code (version 0.5-0.8),
these smaller files:
 - \`src/math_verify/utils.py\`   (the \`timeout\` decorator — signal.alarm based, plus any
   \`timeout_seconds=None\` passthrough behavior, and any multiprocessing/thread variant)
 - \`src/math_verify/errors.py\`  (\`TimeoutException\` and any other exception types)
 - \`src/math_verify/metric.py\`  (\`math_metric(gold_extraction_target, pred_extraction_target,
   aggregation_function=max, fallback_mode=..., precision=6, strict=True, ...)\` — what it returns:
   a callable \`(golds: list[str], predictions: list[str]) -> tuple[float, tuple[list, list]]\`)
 - \`src/math_verify/__init__.py\` (exact exports, __all__, __version__, and the
   \`LatexNormalizationConfig\` alias — I believe it is re-exported from latex2sympy2_extended's
   \`NormalizationConfig\`)
 - \`src/math_verify/tasks.py\`   (lighteval task helpers, if you recall them)
 - \`src/math_verify/few_shots.py\` (few-shot example constants)

Write your reconstruction to /tmp/research/recall_support.py with clear
\`# ==== FILE: xxx.py ====\` separators. Do NOT run it.
Be precise about the \`timeout\` decorator's signature and semantics, and about \`math_metric\`'s
return contract.`,
  },
]

const recalls = await parallel(recallTargets.map(t => () =>
  agent(COMMON + '\n\nYOUR TASK\n=========\n' + t.prompt, {
    label: `recall:${t.key}`, phase: 'Recall', schema: RECALL_SCHEMA,
  })
))

phase('Probe')

const probeTargets = [
  {
    key: 'latex-extract',
    prompt: `Design and EMPIRICALLY VALIDATE the LaTeX extraction layer (regex + priorities) plus the
NormalizationConfig/ConversionConfig to hand to \`latex2sympy\`.

Required behaviors to verify (input string -> expected parse() result). These come from the project spec:
  "Answer $ 9 $"                                  -> 9
  "Answer \\\\( 9 \\\\), and more text"              -> 9
  "Answer \\\\[ 9 \\\\]"                             -> 9
  "Answer $$ 9 $$"                                -> 9
  "$\\\\boxed{\\\\frac{1}{3}}$"                       -> Rational(1,3)
  "Answer $ \\\\frac{1}{2} \\\\$ = \\\\frac{10}{9} $"  -> Rational(10,9)
  "$\\\\frac13$" -> 1/3 ; "$\\\\frac3{3}$" -> 1 ; "$\\\\sqrt3$" -> sqrt(3)
  "$\\\\cfrac{1}{3}$", "$\\\\dfrac{1}{3}$", "$\\\\tfrac{1}{3}$" -> 1/3
  "$\\\\left( \\\\frac{1}{3} \\\\right)$" -> 1/3
  "$\\\\frac{1}{3} \\\\text{meters}$" -> 1/3
  "$k = \\\\frac{1}{3}$" -> 1/3
  "final answer is $9999$, \\\\boxed{1}"  with LatexExtractionConfig(boxed_match_priority=0)   -> 1
  "final answer is $9999$, \\\\boxed{1}"  with LatexExtractionConfig(boxed_match_priority=100) -> 9999
  "\\\\boxed{1}" with boxed_match_priority=-1 and fallback_mode="no_fallback" -> [] (nothing)
  "SoHi YES. could answer therefore\\\\boxed{840}.,but let me put this after explain. **Final Answer** \\\\boxed{840}" -> 840
  "the answer should be \\\\boxed{004}. But let me check again: **Final Answer** \\\\boxed{004}" -> 4
  "\\\\boxed{35 cm} ++++++ \\\\boxed{4}" -> should compare equal to "\${35 cm,4}$" (i.e. a set {35,4})
  "$[0,1)$" -> Interval.Ropen(0,1) ; "$(0,1)$" -> Interval.open(0,1) ; "$[0,1]$" -> Interval(0,1)
  "\${1,2,3}$" -> FiniteSet(1,2,3)
  "$(0.6,2.6667]$" -> Interval.Lopen(0.6, 2.6667)
  "$x \\\\geq 5$" -> x>=5 ; "$-793 < a < 10$" -> And(-793<a, a<10)
  "$34x+45y-20z+100=0$" -> Eq(34x+45y-20z+100, 0)
  "$\\\\begin{pmatrix} 1 & 0 \\\\\\\\ 0 & 1 \\\\end{pmatrix}$" -> Matrix([[1,0],[0,1]])
  "$(3, \\\\frac{\\\\pi}{2})$" -> Tuple(3, pi/2) ; "$(7,6)$" -> Tuple(7,6)
  "$1 \\\\pm \\\\sqrt{19}$" -> FiniteSet(1-sqrt(19), 1+sqrt(19))
  "By the quadratic formula, \$x = \\\\boxed{1 \\\\pm \\\\sqrt{19}}.\$" -> same as above

Deliverables:
 1. The exact NormalizationConfig(...) and ConversionConfig(...) kwargs to use.
 2. A concrete, TESTED list of (regex_pattern_string, priority_int) for LaTeX extraction, covering:
    inline \$...\$, \\\\(...\\\\), display \$\$...\$\$, \\\\[...\\\\], \\\\boxed{...} (with brace matching!),
    \\\\fbox{...}, answer-anchored forms ("final answer is X", "answer: X", "the answer is X",
    "**Final Answer** X"), and a bare/no-anchor fallback.
    Explain how boxed_match_priority slots into the priority ordering, and what the DEFAULT
    boxed priority should be so that the two "final answer is \$9999\$, \\\\boxed{1}" cases above
    both work.
 3. How to handle a trailing "." or "\\\\.\$" and stray \\\\\$ inside math mode.
 4. Note: matching must find the LAST occurrence for answer-ish patterns. Explain the mechanism
    (e.g. iterate finditer and take last, or use a greedy prefix).

Write a working, self-tested prototype to /tmp/research/probe_latex_extract.py that prints a
PASS/FAIL table for every case above, and iterate until as many as possible PASS.
Report the final pass count in your findings.`,
  },
  {
    key: 'expr-numbers',
    prompt: `Design and EMPIRICALLY VALIDATE the plain-expression ("expr") extraction layer, in particular
NUMBER FORMAT NORMALIZATION. Required behaviors (from the spec):
  parse("7,425,000")                                  -> 7425000
  parse("1 000")                                      -> 1000
  parse("1000,99")                                    -> 1000.99   (European decimal!)
  parse("1,22")                                       -> 1.22      (European decimal!)
  parse("$1,000.99")                                  -> 1000.99   (currency stripped)
  parse("the number is not 10 which is 1,000.99€")    -> 1000.99
  parse("so the number is 10 which is 1,000.99m²")    -> 1000.99
  parse(".4")                                         -> 0.4
  parse("Answer: €\$%^&*()123.45")                     -> 123.45
  compare_strings("2", "AZYUK2A", match_types=["expr"]) == 0   (must NOT extract 2 from noise)
  parse("and then Alice wins ... The probability is (1/2) * (1/2) * P(A), P(A) = 2/3") -> 2/3
  parse("Let's denote ... Therefore, there are 12 distinct arithmetic sequences.")     -> 12
  parse("") -> []
  parse("No valid mathematical expression here") -> []
  parse("there are 12 distinct sequences") -> 12
  Also: expr mode must parse algebraic text like "x^2 + 3*x".

Critical subtlety: distinguishing a THOUSANDS separator ("1,000.99" -> 1000.99, "7,425,000" ->
7425000) from a EUROPEAN DECIMAL comma ("1000,99" -> 1000.99, "1,22" -> 1.22). Derive and TEST the
rule (hint: groups of exactly 3 digits after each comma, and presence of a '.' elsewhere, decide it).

Deliverables:
 1. A tested \`convert_to_pct\`-style number normalizer function.
 2. A tested list of (regex, priority) for expr extraction: the number regex (with sign, decimals,
    scientific notation, thousands separators), a simple-expression regex (operators, ^, /, *,
    parens, variables), and anchored variants ("answer is X", "= X").
 3. The rule that prevents extracting "2" out of "AZYUK2A" (boundary conditions around the match).
 4. How \`parse_expr\` from sympy.parsing.sympy_parser should be called (which transformations,
   \`evaluate\`, handling of \`^\`).

Write a self-testing prototype to /tmp/research/probe_expr_numbers.py printing a PASS/FAIL table for
every case above; iterate until max cases pass. Report final pass count.`,
  },
  {
    key: 'grader-core',
    prompt: `Design and EMPIRICALLY VALIDATE the numeric + symbolic comparison core of \`sympy_expr_eq\`.
You may build sympy objects directly via \`latex2sympy\` (use
NormalizationConfig(basic_latex=True, units=True, malformed_operators=True, nits=True, boxed="all",
equations=False) and ConversionConfig(interpret_simple_eq_as_assignment=True)).

Required equivalences (gold, pred, expected, precision):
  ("$\\\\frac{1}{2}$", "$0.5$", True, 6)
  ("$\\\\frac{1}{12}$", "$0.0833333333333333$", True, 6)
  ("$\\\\frac{1}{3}$", "$0.33$", True, 2)      # precision=2 -> equal
  ("$\\\\frac{1}{3}$", "$0.33$", False, 6)     # precision=6 -> NOT equal
  ("$\\\\frac{1}{3}$", "$0.3333$", True, 4)
  ("$\\\\frac{x+2}{7}$", "$\\\\frac{x}{7}+\\\\frac{2}{7}$", True, 6)     # symbolic
  ("$\\\\tan^2(y)+1$", "$\\\\sec^2(y)$", True, 6)                      # trig identity
  ("$\\\\frac{\\\\sqrt{\\\\sqrt{11}+\\\\sqrt{194}}}{15+2\\\\sqrt{33}}$",
   "$\\\\frac{\\\\sqrt{\\\\sqrt{11}+\\\\sqrt{194}}}{2\\\\sqrt{33}+15}$", True, 6)
  ("$\\\\frac{34}{16}+\\\\frac{\\\\sqrt{1358}}{16}$", "$4$", False, 6)
  ("$3\\\\sqrt{13}$", "$3\\\\sqrt{13}$", True, 6)
  ("\${-100}^{-1}$", "$-\\\\frac{1}{100}$", True, 6)
  ("$28\\\\%$", "28 percent", True, 6)   # percent equivalence

Design the strategy ladder and TEST it:
  1. exact structural equality / str equality
  2. numeric equality with rounding to \`float_rounding\` decimals, evaluated at
     \`numeric_precision\` significant digits (use sympy N / mpmath mp.dps). Handle the case where
     one side is a Float and the other exact — and make sure precision=2 vs 6 behaves as required.
  3. symbolic equality: simplify(gold - target) == 0, plus expand/trigsimp/radsimp/cancel fallbacks,
     with guards against hangs.
  4. Do NOT let symbolic simplify wrongly equate 1/3 and 0.33 when precision=6.
Also determine: when both sides contain free symbols, numeric substitution is unsafe — how does the
real library decide between numeric and symbolic paths? Test and describe.
Important: comparison must be robust to exceptions (return False, never raise) and must be fast.

Write a self-testing prototype /tmp/research/probe_grader_core.py that prints PASS/FAIL for every
case; iterate until max pass. Report final pass count and the exact strategy ladder that worked.`,
  },
  {
    key: 'grader-structures',
    prompt: `Design and EMPIRICALLY VALIDATE comparison of STRUCTURED objects in \`sympy_expr_eq\`:
sets, tuples, intervals, matrices, relations. Build objects via \`latex2sympy\` with
NormalizationConfig(basic_latex=True, units=True, malformed_operators=True, nits=True, boxed="all",
equations=False) and ConversionConfig(interpret_simple_eq_as_assignment=True).

Required (gold, pred, expected, precision):
  SETS / INTERVALS
   ("\${1,3}\\\\cup{2,4}$", "\${1,2,3,4}$", True, 6)
   ("\${1,2,3}$", "\${3,2,1}$", True, 6)
   ("$[0,1)$", "$[0,1)$", True, 6)
   ("$[0,9)$", "$[0,1)$", False, 6)
   ("$(0,9)$", "$[0,9)$", False, 6)         # open/closed matters
   ("$(\\\\frac{3}{5},\\\\frac{8}{3}]$", "$(0.6,2.6667]$", True, 2)   # endpoint precision
   ("$(\\\\frac{3}{5},\\\\frac{8}{3}]$", "$(0.6,2.6667]$", True, 6)   # spec says equivalent too
   ("$[0,1)$", "the domain is (0, 1)", False, 6)
  TUPLES / COORDS
   ("$(1,\\\\frac{9}{2})$", "$(1,4.5)$", True, 6)
   ("$(7,6)$", "$(7,6)$", True, 6)
  MATRICES
   ("$\\\\begin{pmatrix}\\\\frac{1}{3}\\\\\\\\ \\\\frac{1}{5} \\\\end{pmatrix}$",
    "$\\\\begin{pmatrix}0.33\\\\\\\\0.2 \\\\end{pmatrix}$", True, 2)
   ("\\\\boxed{\\\\begin{pmatrix} 0 & 3 \\\\\\\\ 0 & -1 \\\\end{pmatrix}}",
    "\\\\boxed{\\\\begin{pmatrix} 0 & 3 \\\\\\\\ 0 & -1 \\\\end{pmatrix}}", True, 6)
  RELATIONS
   ("$x \\\\geq 5$", "$5 \\\\leq x$", True, 6)            # direction flip
   ("$34x+45y-20z+100=0$", "$-34x-45y+20z-100=0$", True, 6)  # equation up to -1 factor
   ("$$-793 < a < 10$$", "$$(-793, 10)$$", True, 6)      # And-chain vs Interval — requires
                                                          # allow_set_relation_comp OR default?
                                                          # DETERMINE empirically what makes the
                                                          # spec assertion compare_strings(...)==1 hold
                                                          # with default allow_set_relation_comp=False.
  STRICT MODE
   ("$f(x)$", "$f(y)$", strict=True -> False ; strict=False -> True)
   ("$\\\\begin{pmatrix} x & y \\\\\\\\ z & w \\\\end{pmatrix}$",
    "$\\\\begin{pmatrix} a & b \\\\\\\\ c & d \\\\end{pmatrix}$", strict=True->False, strict=False->True)
   ("$\\\\sin(x)+\\\\cos(x)$", "$\\\\sin(t)+\\\\cos(t)$", strict=True->False, strict=False->True)
   ("$g(a,b)+h(a)$", "$g(x,y)+h(x)$", strict=True->False, strict=False->True)

Notes:
 * latex2sympy2_extended provides patched \`FiniteSet\` (module latex2sympy2_extended.sets) and
   \`And\` (module .logic) that retain \`_unsorted_args\` — figure out how that helps compare a
   FiniteSet against a Tuple, and ordered vs unordered comparison.
 * Sets must compare order-insensitively but element comparison must respect \`float_rounding\`
   (so a FiniteSet of Rationals equals a FiniteSet of Floats within precision) — plain sympy
   set equality will NOT do this. Write an elementwise matcher.
 * Design the strict=False structural comparison: canonically rename free symbols / applied
   function arguments in both expressions (e.g. map symbols in order of appearance to
   _x0,_x1,...) and compare. TEST it.
 * Determine how "And(-793<a, a<10)" can be converted to Interval.open(-793,10) for comparison
   (hint: sympy's \`as_set()\` on the relational, guarded by single-free-symbol).

Write a self-testing prototype /tmp/research/probe_grader_structures.py printing PASS/FAIL for every
case; iterate until max pass. Report final pass count and the exact algorithms that worked.`,
  },
  {
    key: 'string-timeout-metric',
    prompt: `Design and EMPIRICALLY VALIDATE three smaller subsystems.

(A) StringExtractionConfig extraction. Required:
   parse("The answer is A.",       [StringExtractionConfig(lowercase=False)]) == ["A", "A"]
   parse("The answer is A.",       [StringExtractionConfig(lowercase=True)])  == ["a", "A"]
   parse("Final answer is B",      [StringExtractionConfig()])                == ["b", "B"]
   parse("No valid answer here",   [StringExtractionConfig()])                == []
   parse("A. Because B is not valid", [StringExtractionConfig()])             == ["a", "A"]
   parse("The answer is U.",       [StringExtractionConfig(strings=("U",))])  == ["u", "U"]
   parse("Because B is valid",     [StringExtractionConfig()])                == ["b", "B"]
  Note the return is a 2-element list [normalized, original]. Derive the regexes: an anchored form
  ("answer is X"), and a leading-token form ("A. ..."), and a bare-mention fallback. Note
  "No valid answer here" must yield [] even though it contains the word "answer" — so the string
  set ("A","B","C","D") must not match arbitrary words; require word boundaries.
  Careful: "A. Because B is not valid" -> A wins (leading position), while "Because B is valid" -> B.

(B) The \`timeout\` decorator in utils.py. It must:
   - use signal.SIGALRM (signal.alarm / setitimer) so a slow call raises TimeoutException
   - accept \`timeout_seconds: int | None\`; when None, no timeout is installed (thread-safe mode)
   - be usable as \`@timeout(timeout_seconds=5)\` decorator factory AND support the
     pattern where the wrapped function's own \`timeout_seconds\` kwarg overrides it.
   - restore any previous handler.
   The spec requires these to work (they patch internals with unittest.mock):
     with patch("math_verify.parser.parse_expr", side_effect=lambda *a, **k: (time.sleep(5), "x")[1]):
         parse("1+1", parsing_timeout=1, extraction_mode="first_match", fallback_mode="no_fallback") == []
     with patch("math_verify.parser.latex2sympy", ...sleep 5...):
         parse("$1+1$", parsing_timeout=1, ...) == []
     with patch("math_verify.grader.sympy_expr_eq", ...sleep 5...):
         verify(parse("1+1"), parse("1+1"), timeout_seconds=1) == False
   THIS IS IMPORTANT: it implies module-level names \`parse_expr\`, \`latex2sympy\` in
   math_verify.parser and \`sympy_expr_eq\` in math_verify.grader must be looked up at call time
   through the module namespace so mock.patch works, and that the timeout must fire and be caught,
   returning [] / False rather than propagating.
   Prototype and TEST this at /tmp/research/probe_timeout.py with real sleeps and real patching of a
   dummy module. Confirm signal.alarm(1) with a 5s sleep is interruptible.
   Also handle: nested timeouts (parse inside verify) and alarm(0) cleanup.

(C) \`math_metric\` in metric.py. Determine a sensible faithful contract:
   math_metric(gold_extraction_target: Sequence[ExtractionTarget],
               pred_extraction_target: Sequence[ExtractionTarget],
               aggregation_function: Callable[[list[float]], float] = max,
               fallback_mode="first_match", precision=6, strict=True,
               allow_set_relation_comp=False)
     -> Callable[[list[str], list[str]], tuple[float, tuple[list, list]]]
   The returned callable parses each gold and each prediction, verifies pairwise, aggregates with
   aggregation_function, and returns (score, (parsed_golds, parsed_preds)). Validate the shape by
   writing a small usage example.

Write findings + tested prototypes to /tmp/research/probe_timeout.py (and a
/tmp/research/probe_string_metric.py). Report pass counts.`,
  },
]

const probes = await parallel(probeTargets.map(t => () =>
  agent(COMMON + '\n\nYOUR TASK\n=========\n' + t.prompt, {
    label: `probe:${t.key}`, phase: 'Probe', schema: PROBE_SCHEMA,
  })
))

phase('Synthesize')

const recallBlob = recallTargets.map((t, i) => {
  const r = recalls[i]
  return `--- RECALL ${t.key} (confidence: ${r ? r.confidence : 'DIED'}) file=${r ? r.file : '-'} ---\n${r ? r.summary : 'agent died'}\nUNCERTAIN: ${r && r.uncertain_points ? r.uncertain_points.join(' | ') : '-'}`
}).join('\n\n')

const probeBlob = probeTargets.map((t, i) => {
  const p = probes[i]
  return `--- PROBE ${t.key} file=${p ? p.file : 'DIED'} ---\nFINDINGS:\n${p && p.findings ? p.findings.map(f => '  * ' + f).join('\n') : '-'}\nRECIPE:\n${p ? p.recipe : 'agent died'}`
}).join('\n\n')

const synth = await agent(COMMON + `

YOUR TASK
=========
You are the integration architect. Below are (a) three independent from-memory reconstructions of the
real math-verify source, and (b) five empirically-validated behavior probes with working prototypes on
disk under /tmp/research/.

Produce a SINGLE authoritative implementation plan for /workspace, written to
/tmp/research/PLAN.md, that the lead engineer will implement directly. It must be concrete enough to
type out code from: exact file list, exact dataclass fields + defaults, exact regex/priority tables,
exact function signatures, and the exact strategy ladders for grading.

Read the prototype files under /tmp/research/ to confirm details before asserting them — where a
recall and a probe disagree, TRUST THE PROBE (it was empirically tested) and say so.
Also read the installed latex2sympy2_extended sources as needed.

Resolve explicitly:
 1. The default \`boxed_match_priority\` for LatexExtractionConfig.
 2. The exact NormalizationConfig + ConversionConfig used for latex parsing.
 3. The full (regex, priority) tables for latex / expr / string extraction.
 4. The full strategy ladder for sympy_expr_eq, in order, with the structured-object dispatch.
 5. How the mock-patchability requirement constrains module structure
    (math_verify.parser.parse_expr, math_verify.parser.latex2sympy, math_verify.grader.sympy_expr_eq).
 6. Any remaining risks / cases the probes could not make pass.

=========== RECALL REPORTS ===========
${recallBlob}

=========== PROBE REPORTS ============
${probeBlob}
`, { label: 'synthesize-plan', phase: 'Synthesize', effort: 'high' })

return {
  planFile: '/tmp/research/PLAN.md',
  synthesis: synth,
  recalls: recallTargets.map((t, i) => ({ key: t.key, ok: !!recalls[i], file: recalls[i] && recalls[i].file })),
  probes: probeTargets.map((t, i) => ({ key: t.key, ok: !!probes[i], file: probes[i] && probes[i].file })),
}
