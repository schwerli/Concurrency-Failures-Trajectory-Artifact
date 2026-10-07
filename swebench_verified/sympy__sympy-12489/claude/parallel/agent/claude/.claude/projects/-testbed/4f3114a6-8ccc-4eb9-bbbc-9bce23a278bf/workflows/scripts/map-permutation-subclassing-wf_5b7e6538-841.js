export const meta = {
  name: 'map-permutation-subclassing',
  description: 'Map every instance-creation site that blocks subclassing combinatorics.Permutation',
  phases: [
    { title: 'Map', detail: 'parallel readers over permutations.py, perm_groups.py, tensor_can.py, callers' },
    { title: 'Synthesize', detail: 'merge into one authoritative change-site list' },
  ],
}

const SCHEMA = {
  type: 'object',
  properties: {
    sites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          enclosing: { type: 'string', description: 'class.method or module-level function containing it' },
          code: { type: 'string' },
          kind: { type: 'string', description: 'one of: module-level-_af_new-alias, hardcoded-Perm-in-_af_new, _af_new-inside-method, Perm(...)-inside-method, Basic.__new__, other' },
          hasSelfOrCls: { type: 'boolean', description: 'is a self or cls reference available at this line?' },
          notes: { type: 'string' },
        },
        required: ['file', 'line', 'enclosing', 'code', 'kind', 'hasSelfOrCls'],
      },
    },
    hazards: {
      type: 'array',
      items: { type: 'string' },
      description: 'behaviors that could break if _af_new became a classmethod and internal calls became self._af_new / cls._af_new',
    },
  },
  required: ['sites', 'hazards'],
}

const TARGETS = [
  {
    key: 'permutations',
    prompt: `In /testbed (sympy), read sympy/combinatorics/permutations.py IN FULL.

Goal context: an issue reports that Permutation cannot be subclassed because Permutation.__new__ delegates to the module-level \`_af_new\` (an alias for the STATIC method Permutation._af_new), which hardcodes \`Basic.__new__(Perm, perm)\`. So subclass instantiation always yields Permutation.

Enumerate EVERY line in this file that creates a Permutation/Cycle instance in a way that ignores the actual class: module-level \`_af_new(...)\` calls, \`Perm(...)\`/\`Permutation(...)\` calls inside methods, \`Basic.__new__(...)\`, and the \`_af_new\` definition itself. For each, state the enclosing class.method and whether \`self\` or \`cls\` is in scope there.

Also carefully note: (a) which methods are @classmethod / @staticmethod / @property / plain instance methods; (b) any method where the result should deliberately NOT be the subclass type; (c) whether Cycle subclasses/uses Permutation machinery; (d) the module-level aliases at the bottom of the file.

Be exhaustive and precise about line numbers.`,
  },
  {
    key: 'perm_groups',
    prompt: `In /testbed (sympy), read sympy/combinatorics/perm_groups.py and sympy/combinatorics/util.py.

Both do \`_af_new = Permutation._af_new\` at module import time. Permutation._af_new is currently a @staticmethod. We are considering converting it to a @classmethod (so \`cls._af_new(perm)\` builds the right subclass).

Question to answer with evidence: does \`_af_new = Permutation._af_new\` at module level still work if _af_new becomes a classmethod? Enumerate every call site of \`_af_new\` in these two files with line numbers and enclosing function, and flag any that would break (e.g. called with an explicit class argument, called with 2 args, reassigned, introspected, pickled, compared with \`is\`).

Also list any place in perm_groups.py that creates Permutation instances by other means (Permutation(...), Perm(...), .copy(), etc.).`,
  },
  {
    key: 'tensor',
    prompt: `In /testbed (sympy), read sympy/combinatorics/tensor_can.py, sympy/combinatorics/named_groups.py, sympy/combinatorics/group_constructs.py, sympy/combinatorics/testutil.py, sympy/combinatorics/polyhedron.py, and the _af_new-related parts of sympy/tensor/tensor.py.

Note tensor_can.py does \`from sympy.combinatorics.permutations import ..., _af_new\` (importing the MODULE-LEVEL alias), and sympy/tensor/tensor.py does \`from sympy.combinatorics.permutations import _af_new\` inside functions.

We are considering turning Permutation._af_new from a @staticmethod into a @classmethod, keeping the module-level alias \`_af_new = Perm._af_new\` in permutations.py.

Enumerate every _af_new call site (file, line, enclosing function) and determine whether it would still work. Flag ANY usage that depends on _af_new being a plain function/staticmethod (e.g. passed as a callback, used with functools, assigned to a class attribute, called unbound with a class as first arg).`,
  },
  {
    key: 'tests',
    prompt: `In /testbed (sympy), find and read the tests that exercise Permutation construction and Permutation._af_new:
- sympy/combinatorics/tests/test_permutations.py
- any other test file referencing _af_new, or subclassing Permutation.
Run: grep -rn "_af_new" /testbed/sympy --include=*.py | grep -i test

Report: (1) every test assertion that would be sensitive to _af_new becoming a classmethod or to __new__ using cls instead of hardcoded Perm; (2) whether any doctest shows \`Perm._af_new\` output; (3) exact command to run the combinatorics + tensor test suites; (4) whether there is any existing test for subclassing Permutation.

Also check sympy/combinatorics/permutations.py doctests mentioning _af_new, and whether there is a deprecation/utilities module used for API changes (e.g. sympy.utilities.exceptions SymPyDeprecationWarning) in this repo version.`,
  },
]

phase('Map')
const results = await parallel(TARGETS.map(t => () =>
  agent(t.prompt, { label: `map:${t.key}`, phase: 'Map', schema: SCHEMA })
))

phase('Synthesize')
const merged = await agent(
  `You are synthesizing a change plan for this sympy issue:

"combinatorics.Permutation can't be subclassed properly — object creation is done in Permutation.__new__, but internally the module-level function _af_new is used (a reference to the staticmethod Permutation._af_new). That method calls Basic.__new__(Perm, perm) with Perm hardcoded, so subclassing is impossible. An elegant solution is to stick to Python's instance creation mechanisms, i.e. use classmethods where appropriate and use the class reference passed to the classmethod for instance creation."

Four mapping agents returned this JSON:

${JSON.stringify(results.filter(Boolean), null, 2)}

Produce the authoritative, deduplicated list of edits needed in /testbed so that:
1. \`Permutation._af_new\` becomes a @classmethod using \`cls\` for instance creation.
2. \`Permutation.__new__\` uses \`cls._af_new(...)\` instead of the module-level \`_af_new(...)\`, and its \`isinstance(a, Perm)\` copy/resize path returns the right class.
3. Instance methods that return new permutations (__mul__, __pow__, __invert__, commutator, next_lex, rank_* setters, etc.) propagate the actual class via \`self._af_new(...)\`.
4. Every external caller (perm_groups.py, util.py, named_groups.py, tensor_can.py, group_constructs.py, testutil.py, polyhedron.py, sympy/tensor/tensor.py) keeps working unchanged.

For each edit give: file, line, exact old code, exact new code, and a one-line justification. Then list the top risks and the exact verification commands. Be concrete and complete — this list will be applied literally.`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return { merged }
