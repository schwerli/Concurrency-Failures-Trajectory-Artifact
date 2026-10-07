export const meta = {
  name: 'string-arg-invariance-understand',
  description: 'Map constraints and evaluate designs for making codegen.ast String satisfy expr.func(*expr.args) == expr',
  phases: [
    { title: 'Understand', detail: 'parallel readers over Token/String internals, usages, and Atom/Str machinery' },
    { title: 'Design', detail: 'independent candidate designs plus adversarial critique' },
    { title: 'Judge', detail: 'score candidate designs and synthesize the final plan' },
  ],
}

const REPO = '/testbed'

const UNDERSTAND = [
  {
    key: 'token-internals',
    prompt: 'In the sympy repo at ' + REPO + ', read sympy/codegen/ast.py carefully, especially the CodegenAST, Token, and String classes.\n\n' +
      'Explain precisely and with line numbers:\n' +
      '1. How Token.__new__ builds the Basic args (the role of __slots__, not_in_args, defaults, _construct_<attr>).\n' +
      "2. What String currently sets (__slots__, not_in_args, is_Atom) and therefore what String('foo').args is, and why String('foo').func(*String('foo').args) fails.\n" +
      "3. How Token.__eq__, _hashable_content, and __hash__ work for String, and what would change if 'text' were moved into Basic args.\n" +
      '4. What Token.kwargs() returns for String, and how _sympyrepr/_sympystr use __slots__ (so repr stays String(\'foo\')).\n' +
      "5. Whether the Token.__new__ pass-through branch (single arg already an instance of cls) matters here, i.e. String(String('foo')).\n" +
      '6. Every subclass of String in the whole repo (search sympy/ for classes deriving from String, e.g. QuotedString, Comment, and anything in sympy/codegen/*.py or sympy/printing/*.py) and whether they add slots or rely on text being outside args.\n\n' +
      'Return a dense factual report with file:line references. No recommendations.',
  },
  {
    key: 'usages',
    prompt: 'In the sympy repo at ' + REPO + ', find every place that could be affected by changing sympy.codegen.ast.String so that its text lives in Basic.args, or so that .func/.args round-trip.\n\n' +
      'Search across all of sympy/ (source, tests, and doctests) for:\n' +
      '- Constructions and uses of String, QuotedString, Comment (grep -rn for them across sympy/, including codegen/fnodes.py, cnodes.py, cxxnodes.py, algorithms.py, and sympy/printing/*).\n' +
      '- Code that iterates .args of Token/String instances, or calls .atoms(), .subs(), .xreplace(), .replace(), .free_symbols, .has(), sympify or srepr on them.\n' +
      '- Printers that print String or its subclasses (sympy/printing/c.py, fortran.py, codeprinter.py, pycode.py, repr.py, str.py, latex.py): do they access .text or .args?\n' +
      '- Tests that assert on repr/str of String or on .args of codegen AST nodes: sympy/codegen/tests/*, sympy/printing/tests/*, sympy/core/tests/test_args.py (is there a _test_args entry for codegen ast String?), sympy/utilities/tests/*.\n' +
      '- Anything relying on String being hashable or atomic, e.g. use as dict keys or inside Tuple via _mk_Tuple.\n\n' +
      'Report concrete file:line findings grouped by risk (would break / might break / safe). Be exhaustive; no recommendations.',
  },
  {
    key: 'atom-str',
    prompt: 'In the sympy repo at ' + REPO + ', report on the core machinery relevant to making a Basic subclass atomic yet arg-invariant.\n\n' +
      '1. Read sympy/core/basic.py class Atom (around line 1899): list every method/attribute it defines with line numbers, and describe exactly what each does (matches, xreplace, doit, class_key, sort_key, _eval_simplify, _sorted_args, __slots__).\n' +
      '2. Read sympy/core/symbol.py class Str (around line 21): what it is, its __slots__, __new__, _hashable_content, how it stores the string, and whether it is exported from sympy (check sympy/core/__init__.py and sympy/__init__.py).\n' +
      '3. Is Atom importable via "from sympy.core.expr import Atom"? Check the imports at the top of sympy/core/expr.py and verify by running: cd ' + REPO + ' && python -c "from sympy.core.expr import Expr, Atom; print(Atom)".\n' +
      '4. For a Basic subclass with empty args, what does Basic.func return and what does Basic.__new__ store? Read Basic.func, Basic.args, __reduce_ex__/copy, compare and sort_key to see if empty-args atoms carrying extra __slots__ state have known pitfalls (pickling, caching).\n' +
      '5. Does anything in core conflict if a class overrides func as a property returning a zero-argument callable? Grep for uses of .func( in sympy/core/basic.py and sympy/core/operations.py and describe whether such an override is sufficient or dangerous.\n\n' +
      'Run python commands to confirm claims where cheap. Return a dense factual report with file:line refs. No recommendations.',
  },
  {
    key: 'baseline',
    prompt: 'In the sympy repo at ' + REPO + ', establish the current baseline behavior.\n\n' +
      'Write a small python script to a temp file (not inside the repo) and run it with the repo python, printing for String(\'foo\'): .args, .func, .is_Atom, .kwargs(), repr, str, the result of func(*args) (catch exceptions), func(**kwargs()) == self, sympy.srepr, .xreplace({}), .atoms(), .free_symbols, .doit(), .sort_key(), and repr of QuotedString(\'a\') and Comment(\'b\'). Also print sympy.__version__.\n\n' +
      'Then run these test suites with python -m pytest -q and report pass/fail counts plus any failures:\n' +
      '- sympy/codegen/tests/test_ast.py\n' +
      '- sympy/codegen/tests/\n' +
      '- sympy/printing/tests/test_c.py sympy/printing/tests/test_fortran.py\n' +
      'Also run: python -m pytest -q --doctest-modules sympy/codegen/ast.py\n\n' +
      'Finally show the current body of test_String in sympy/codegen/tests/test_ast.py with line numbers.\n\n' +
      'Return raw outputs (trimmed to what matters) plus a one-paragraph summary. Do not modify the repo.',
  },
]

phase('Understand')
const findings = await parallel(UNDERSTAND.map(u => () =>
  agent(u.prompt, { label: 'read:' + u.key, phase: 'Understand' })))

const ctx = UNDERSTAND.map((u, i) => '### ' + u.key + '\n' + (findings[i] || '(failed)')).join('\n\n')

const ISSUE = 'Argument invariance of codegen.ast String: Currently, the codegen.ast String class does not support argument invariance like expr.func(*expr.args) == expr, but instead uses the invariance expr.func(**expr.kwargs()) == expr. The former should hold for any Basic subclass, which String is.'

phase('Design')
const CANDIDATES = [
  {
    key: 'atom-mixin',
    angle: "Design A: make String inherit from Atom and give it an args-free round-trip. Keep not_in_args = ['text'], add a kwargs() override returning an empty dict, and a func property returning a zero-argument callable that returns self, so both func(*args) and func(**kwargs()) reconstruct the object. This is the approach sympy upstream took.",
  },
  {
    key: 'text-in-args',
    angle: 'Design B: put the text into Basic.args. Drop not_in_args for String so that args has one element, converting the text to a Basic-compatible wrapper (e.g. sympy.core.symbol.Str) or keeping the raw python str in args. Then func(*args) works through the normal Token.__new__ path. Consider _construct_text, _hashable_content, repr, printers, and whether non-Basic objects in args are acceptable.',
  },
  {
    key: 'token-general',
    angle: 'Design C: fix this generally in Token rather than only in String, so that func(*args) works for any Token subclass that uses not_in_args (for example by overriding func or args on Token, or by eliminating not_in_args). Consider every Token subclass in the repo that uses not_in_args.',
  },
]

const designs = await pipeline(
  CANDIDATES,
  c => agent('You are designing a patch for this sympy issue:\n\n' + ISSUE + '\n\n' +
    'Here is research about the repo at ' + REPO + ':\n\n' + ctx + '\n\n' + c.angle + '\n\n' +
    'Produce a concrete, complete implementation proposal for THIS design only:\n' +
    '- Exact code (final form of the classes/methods to change, with file and anchor context).\n' +
    "- Which invariants it preserves: func(*args)==expr, func(**kwargs())==expr, repr equal to String('foo'), str equal to foo, .text, equality and hash across subclasses (String('a') != Comment('a')), is_Atom, use inside Tuple via _mk_Tuple, printers.\n" +
    '- Every risk or breakage you can identify, and how the design handles it (cite file:line from the research).\n' +
    '- Whether existing tests and doctests in the repo would still pass, and which specific ones are at risk.\n' +
    '- Verify your claims by actually prototyping in ' + REPO + ' and running python and pytest. You MUST restore the repo afterwards with: cd ' + REPO + ' && git checkout -- . ; then confirm git status is clean.\n\n' +
    'Return a design brief with the exact diff you would apply, an honest risk list, and the empirical evidence from your prototype run.',
    { label: 'design:' + c.key, phase: 'Design' }),
  (brief, c) => agent('Adversarially critique this candidate design for the sympy codegen.ast String arg-invariance issue. Design key: ' + c.key + '\n\n' + brief + '\n\n' +
    'Your job is to find what is WRONG or fragile: hidden breakage, tests or doctests it would fail, semantic problems (non-Basic objects in .args, sort_key/pickling/cache issues, subclass equality collisions, sympify round-trip, srepr eval round-trip), maintenance smell, and mismatch with what a sympy maintainer would accept.\n\n' +
    'Prototype in ' + REPO + ' to check your claims empirically: apply the diff, then run python -m pytest -q on sympy/codegen/tests/, sympy/printing/tests/test_c.py, sympy/printing/tests/test_fortran.py, and "sympy/core/tests/test_args.py -k codegen", plus python -m pytest -q --doctest-modules sympy/codegen/ast.py. ALWAYS restore with: cd ' + REPO + ' && git checkout -- . ; and verify git status is clean before finishing.\n\n' +
    'Return: design_key, empirical_test_results, real_problems, non_problems, verdict (viable|risky|broken), and a one-paragraph justification.',
    { label: 'critique:' + c.key, phase: 'Design' })
    .then(crit => ({ key: c.key, brief: brief, critique: crit })))

const designCtx = designs.filter(Boolean).map(d =>
  '## Design ' + d.key + '\n### Proposal\n' + d.brief + '\n### Adversarial critique\n' + d.critique).join('\n\n')

phase('Judge')
const LENSES = [
  { key: 'correctness', prompt: 'Which design most robustly satisfies BOTH invariants and preserves all existing behavior with zero regressions?' },
  { key: 'maintainer-fit', prompt: 'Which design would a sympy maintainer actually merge? Consider idiom, minimalism, precedent elsewhere in sympy (Atom, Str, the Basic.func contract), and the risk of putting non-Basic objects in .args.' },
  { key: 'blast-radius', prompt: 'Which design has the smallest blast radius across the repo (printers, fnodes/cnodes, tests, doctests, pickling, caching)?' },
]

const votes = await parallel(LENSES.map(l => () =>
  agent('Judge these candidate designs for the sympy codegen.ast String arg-invariance issue through one specific lens.\n\n' +
    'Lens: ' + l.key + ' -- ' + l.prompt + '\n\n' + designCtx + '\n\n' +
    'You may run commands in ' + REPO + ' to check facts (restore with git checkout -- . if you modify anything).\n\n' +
    'Return JSON only: {"lens": "' + l.key + '", "ranking": ["design keys best to worst"], "winner": "key", "scores": {"key": 0-10}, "reasoning": "3-6 sentences", "must_include": ["specific implementation details the final patch must have"], "must_avoid": ["specific pitfalls"]}',
    { label: 'judge:' + l.key, phase: 'Judge' })))

const synth = await agent('Synthesize the final implementation plan for this sympy issue:\n\n' + ISSUE + '\n\n' +
  'Candidate designs and adversarial critiques:\n' + designCtx + '\n\n' +
  'Judge votes (3 lenses):\n' + votes.filter(Boolean).join('\n\n') + '\n\n' +
  'Decide the winning approach (you may graft the best parts of runners-up). Then output THE FINAL PLAN:\n' +
  '1. Exact edits: file path, the precise old code and the precise new code (ready to apply with a string-replace edit).\n' +
  '2. Any import changes needed, verified to work in this repo version.\n' +
  '3. The exact test additions for sympy/codegen/tests/test_ast.py (upstream-style: assert st.func(*st.args) == st alongside st.func(**st.kwargs()) == st), plus any extra tests worth adding.\n' +
  '4. The full list of verification commands to run afterwards.\n' +
  '5. Residual risks.\n\n' +
  'Do NOT apply the edits. Just return the plan, precisely. Confirm ' + REPO + ' git status is clean at the end of your work.',
  { label: 'synthesize', phase: 'Judge' })

return { synth: synth, votes: votes.filter(Boolean) }
