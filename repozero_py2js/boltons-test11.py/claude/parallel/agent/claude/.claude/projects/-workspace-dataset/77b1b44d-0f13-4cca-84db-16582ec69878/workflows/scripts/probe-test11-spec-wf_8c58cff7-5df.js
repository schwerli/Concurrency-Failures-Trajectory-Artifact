export const meta = {
  name: 'probe-test11-spec',
  description: 'Differentially probe the test11 reference executable to produce an exact behavioral spec for a JS port',
  phases: [
    { title: 'Probe', detail: 'parallel facet probes against /workspace/dataset/test11_executable' },
    { title: 'Critique', detail: 'completeness critic per facet' },
  ],
}

const COMMON = `
You are probing a pre-compiled reference program to reverse-engineer its exact observable behavior.

THE PROGRAM: /workspace/dataset/test11_executable
Its Python source (/workspace/dataset/test11.py) is:
---
import argparse
from boltons.iterutils import flatten, chunked

parser = argparse.ArgumentParser()
parser.add_argument('--a', type=str, required=True, help='Nested list structure')
args = parser.parse_args()

nested = eval(args.a)
result1 = list(flatten(nested))
print(result1)
result2 = list(chunked(result1, 2))
print(result2)
result3 = list(chunked(result1, 3))
print(result3)
nested2 = [[x*2 for x in chunk] for chunk in result2]
result4 = list(flatten(nested2))
print(result4)
result5 = list(chunked(result4, 4))
print(result5)
---

RULES:
- Run ONLY the executable. Do NOT run 'python', 'python3', or any interpreter. Do NOT try to read boltons source.
- Probe by running e.g.:  cd /workspace/dataset && ./test11_executable --a "[1,[2,3]]"
- Always capture stdout and stderr SEPARATELY plus the exit code. Example:
    ./test11_executable --a "X" >/tmp/o.txt 2>/tmp/e.txt; echo "exit=$?"; echo "--STDOUT"; cat /tmp/o.txt; echo "--STDERR"; cat /tmp/e.txt
- Beware shell quoting when the input contains quotes/backslashes; prefer single-quoted shell strings, and verify what actually reached the program.
- Run MANY probes (30+). Be systematic and adversarial: find the boundary where behavior changes.
- Your final output is DATA for an engineer writing a from-scratch JavaScript reimplementation. Report exact literal strings, never paraphrase output.
`;

const FACETS = [
  {
    key: 'float-repr',
    prompt: `${COMMON}
FACET: numeric formatting (Python repr) of every number that can appear in output.

Determine the EXACT printed form for floats and ints. Nail down the rules:
- When does a float print in fixed notation vs scientific notation? Find the exact exponent thresholds on BOTH ends (probe e.g. 1e15, 1e16, 1e17, 9999999999999998.0, 1e-4, 1e-5, 0.0001, 0.00001, 12345.6789e10 ...).
- Exponent digit padding and sign (e+16 vs e+016 vs e16; 1e-05 vs 1e-5; what about 1e100, 1e-100, 1e308, 5e-324?).
- Is there a trailing '.0' in fixed notation for whole floats? In scientific notation is the mantissa '1e+16' or '1.0e+16'?
- Shortest-round-trip digits: probe 0.1, 1/3, 2/3, 0.1+0.2, 1e23, 123456789012345678.0, 2**53+1 as float.
- Signed zero (-0.0), inf, -inf, nan (use float('inf') etc). What does -float('nan') print? inf*2? nan*2?
- Big integers (arbitrary precision): 2**70, 10**30, negative bigints. Are they exact?
- int vs float distinction: does 2.0 stay 2.0? What about True*2, and bool printing?
- Complex numbers: try --a "[1j]" and "[complex(1,2)]" and "[1+2j]". Report repr and the doubled form.
- Also try decimal-ish exotica: 1e309 (inf?), -1e309, 0.5, 1/0 (error?).

Report a decision table precise enough to implement without further probing, plus a table of >=25 concrete (input expression -> exact printed token) pairs.`,
  },
  {
    key: 'eval-subset',
    prompt: `${COMMON}
FACET: what Python expression syntax the --a value supports (it is passed to eval) and the exact error text when it fails.

Systematically probe which constructs work and what the output/error is:
- literals: int, float, hex/oct/bin/underscored ints (0x10, 0o17, 0b101, 1_000), strings (single/double/triple-quoted, escapes \\n \\t \\\\ \\' \\x41 \\u00e9, raw r'..'), f-strings, bytes b'..', None/True/False, Ellipsis
- containers: list, tuple (with/without parens, trailing comma, single-element (1,)), set literal, empty set(), dict literal, nested, dict/set/list comprehensions, generator expressions
- operators: + - * / // % ** unary minus, comparisons, and/or/not, ternary, chained
- calls: range(1 arg/2/3, negative step), list(), tuple(), set(), dict(), str(), len(), sorted(), reversed(), map(), filter(), zip(), enumerate(), sum(), abs(), int(), float(), open() (dangerous - just note if it is reachable, do NOT actually write files), __import__
- indexing/slicing/attribute access
- names: bare undefined name (report exact NameError traceback), and whether 'flatten'/'chunked'/'args'/'parser'/'argparse' are in scope (try --a "flatten" or "[len]" etc)
- malformed input: empty string --a "", "[1,", "1+", "]]" -> report exact SyntaxError traceback text verbatim (whitespace-exact, including caret lines and the reported File/line)

For every error, give the verbatim stderr, stdout, and exit code. Preserve exact indentation and caret characters.`,
  },
  {
    key: 'argparse',
    prompt: `${COMMON}
FACET: command-line argument parsing, exactly as argparse does it here.

Probe and report verbatim (stdout vs stderr vs exit code) for:
- --help and -h (exact text, including blank lines and trailing newline; check with 'cat -A' whether there are trailing spaces)
- no args at all; --a with no value; --a="[1]"; --a "[1]"; '--a[1]' (no space)
- prefix abbreviation: does '--' + partial work? Try --a vs -a vs --A (case), --=x
- repeated --a "[1]" --a "[2]" (last wins?)
- unknown options: --b 2, -b, extra positional, multiple extras (exact 'unrecognized arguments' text and ordering vs the required-arg error)
- interaction: '-a [1]' produced 'the following arguments are required: --a' -- confirm and explain the precedence between "required" and "unrecognized" errors; test '--b 2' with no --a at all
- value that looks like an option: --a -5 ; --a=-5 ; --a "-[1]" ; --a -- ; -- --a "[1]" ; --a "" (empty string)
- '--' separator handling, and args after '--'
- does '--help' win over a missing required --a? does '--a bad --help' print help or the eval error?
- exit codes for each case
Also check with 'cat -A' if the usage/help lines have trailing whitespace, and whether output ends with a newline.
Report a precise algorithm an engineer can reimplement, plus verbatim expected texts.`,
  },
  {
    key: 'flatten-chunked',
    prompt: `${COMMON}
FACET: the semantics of boltons flatten() and chunked() as observed through this program.

Determine precisely:
- flatten: which values are recursed into vs yielded as-is. Probe list/tuple/set/dict/dict.keys()/dict.values()/dict.items()/range/generator/str/bytes/bytearray/frozenset/memoryview/enumerate object/int/None/float. Confirm strings and bytes are NOT recursed at depth>=1 but the TOP-LEVEL argument IS always iterated (compare --a "'abc'" vs --a "['abc']").
- What happens if the top-level value is not iterable (--a "5", --a "None", --a "1.5")? Give verbatim traceback + exit code.
- Deep nesting: [[[[1]]]] , empty containers at various depths ([[],[1,[]]]), mixed.
- dict ordering (insertion order?), set ordering: probe {3,1,2}, {1,2,3}, {'b','a'}, {10,20,30}, {0,1,2,3,4,5,6,7,8,9}, and a set of strings run 3 TIMES to see whether string-set order is stable across runs (hash randomization!). Report exactly which cases are deterministic.
- chunked(list, n): last-chunk behavior, n>len, empty list. Confirm output is a list of lists.
- The 'x*2' step: behavior for int, float, bool, str, bytes, None, complex, and any other element type flatten can emit. Give verbatim TypeError traceback for the failing ones (None, and try others).
- Whether the 5 print lines are emitted incrementally before a crash (stdout content when a later line raises).
Report a rule-level spec plus >=20 concrete input->5-line-output examples.`,
  },
  {
    key: 'str-bytes-repr',
    prompt: `${COMMON}
FACET: exact repr of strings and bytes inside the printed lists.

Determine Python's quoting/escaping rules as observed:
- quote choice: string containing ' only, " only, both, neither
- escapes: backslash, \\n, \\r, \\t, \\x00, \\x1f, \\x7f, vertical tab, form feed, bell
- non-ASCII: 'é', '中文', emoji, combining chars; is output raw UTF-8 or escaped? Check locale effects by piping to a file and using 'xxd'/'od -c'.
- unpaired surrogates / \\udcff via '\\udcff' literal, and astral chars
- unicode categories Python escapes in repr (e.g. \\x85, \\xa0, \\u2028, \\u200b, \\u0378 unassigned) - probe a range and report which come out escaped vs literal
- bytes: b'ab', b'\\x00\\xff', b"it's", bytes with quotes/backslashes/newlines, empty b''
- empty string ''
- the doubling step for strings/bytes (x*2) and for multi-byte characters
- str subclasses not needed; but do check bytearray and memoryview if they survive flatten
Give a verbatim table of (python literal in --a) -> (exact token in stdout line 1). Use od -c or cat -A where whitespace/binary matters.`,
  },
];

phase('Probe')
const specs = await pipeline(
  FACETS,
  f => agent(f.prompt, { label: `probe:${f.key}`, phase: 'Probe' }),
  (spec, f) => agent(`${COMMON}

A previous engineer probed the facet "${f.key}" of this program and produced the spec below. You are the COMPLETENESS CRITIC.

Your job: find what is MISSING, UNVERIFIED, or WRONG. Run your own probes (20+) to (a) falsify at least three specific claims in the spec, and (b) cover cases the spec never tested. Focus on boundaries and on anything the spec states without showing literal program output.

--- SPEC UNDER REVIEW ---
${spec}
--- END SPEC ---

Return: (1) CORRECTIONS: any claim you falsified, with the verbatim probe output that disproves it. (2) ADDITIONS: new verified facts with verbatim output. (3) The FINAL MERGED SPEC for this facet, corrected and extended, as the authoritative reference for a JS reimplementation. Be exhaustive but literal.`,
    { label: `critique:${f.key}`, phase: 'Critique' })
)

return { facets: FACETS.map((f, i) => ({ key: f.key, spec: specs[i] })) }
