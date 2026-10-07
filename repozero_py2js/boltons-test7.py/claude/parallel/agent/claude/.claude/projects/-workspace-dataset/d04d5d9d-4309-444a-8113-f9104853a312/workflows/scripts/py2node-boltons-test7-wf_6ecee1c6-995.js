export const meta = {
  name: 'py2node-boltons-test7',
  description: 'Port test7.py (boltons partition/bucketize) to zero-dependency ESM Node.js with differential verification against the reference executable',
  phases: [
    { title: 'Implement', detail: 'parallel: pyint, pyrepr, argparse, iterutils modules' },
    { title: 'Assemble', detail: 'entry point test7.mjs + smoke run' },
    { title: 'Fuzz', detail: 'differential fuzz vs /workspace/dataset/test7_executable' },
    { title: 'Audit', detail: 'adversarial reviewers per dimension' },
    { title: 'Fix', detail: 'apply confirmed findings and re-verify' },
  ],
}

const OUT = '/output'
const EXE = '/workspace/dataset/test7_executable'

// ---------------------------------------------------------------------------
// Ground-truth spec, derived empirically from the reference executable.
// ---------------------------------------------------------------------------
const SPEC = `
# GROUND TRUTH (observed from running ${EXE})

## Original Python (/workspace/dataset/test7.py)
\`\`\`python
import argparse
from boltons.iterutils import partition, bucketize

parser = argparse.ArgumentParser()
parser.add_argument('--a', type=str, required=True, help='Comma-separated numbers')
args = parser.parse_args()

numbers = [int(x) for x in args.a.split(',')]
result1 = partition(numbers, lambda x: x % 2 == 0)
print(result1)
result2 = partition(numbers, lambda x: x > 0)
print(result2)
result3 = bucketize(numbers, lambda x: x % 2 == 0)
print(result3)
result4 = bucketize(numbers, lambda x: x > 10)
print(result4)
\`\`\`

## Observed reference outputs (VERBATIM — these are contract tests)

\`--a "1,2,3,4,5,-6,11,12,0"\` -> stdout, exit 0:
([2, 4, -6, 12, 0], [1, 3, 5, 11])
([1, 2, 3, 4, 5, 11, 12], [-6, 0])
{False: [1, 3, 5, 11], True: [2, 4, -6, 12, 0]}
{False: [1, 2, 3, 4, 5, -6, 0], True: [11, 12]}

\`--a "2,1,3"\` -> exit 0:
([2], [1, 3])
([2, 1, 3], [])
{True: [2], False: [1, 3]}
{False: [2, 1, 3]}

\`--a "2,4,6"\` -> exit 0:
([2, 4, 6], [])
([2, 4, 6], [])
{True: [2, 4, 6]}
{False: [2, 4, 6]}

\`--a "7"\` -> exit 0:
([], [7])
([7], [])
{False: [7]}
{False: [7]}

\`--a "12345678901234567890,-98765432109876543210"\` -> exit 0:
([12345678901234567890, -98765432109876543210], [])
([12345678901234567890], [-98765432109876543210])
{True: [12345678901234567890, -98765432109876543210]}
{True: [12345678901234567890], False: [-98765432109876543210]}

\`--a "999999999999999999999999999999,1"\` -> exit 0:
([], [999999999999999999999999999999, 1])
([999999999999999999999999999999, 1], [])
{False: [999999999999999999999999999999, 1]}
{True: [999999999999999999999999999999], False: [1]}

\`--a "+5,-0,007"\` -> exit 0:
([0], [5, 7])
([5, 7], [0])
{False: [5, 7], True: [0]}
{False: [5, 0, 7]}

\`--a "1_000,2"\` -> exit 0:
([1000, 2], [])
([1000, 2], [])
{True: [1000, 2]}
{True: [1000], False: [2]}

\`--a "  -5  ,  6  "\` -> exit 0:
([6], [-5])
([6], [-5])
{False: [-5], True: [6]}
{False: [-5, 6]}

\`--a "٣,4"\` (Arabic-Indic digit three) -> exit 0: same as \`--a "3,4"\`
\`--a "١٢"\`/\`--a "१२"\` (Devanagari) -> 12.  \`--a "１２３"\` (fullwidth) -> 123.

## SEMANTICS TO IMPLEMENT

### 1. boltons \`partition(src, key)\`
Returns a 2-tuple \`(trues, falses)\`. Elements where \`key(x)\` is truthy go in the
first list, else the second. Original relative order preserved within each list.
Default \`key\` is \`bool\`.

### 2. boltons \`bucketize(src, key)\`
Returns a dict mapping \`key(x)\` -> list of x, preserving FIRST-OCCURRENCE key
insertion order and original element order within each bucket. Default key is \`bool\`.
Keys here are Python bools -> rendered \`True\`/\`False\`.
CRITICAL: key insertion order is the order each distinct key is FIRST produced.
\`--a "2,1,3"\` gives \`{True: [2], False: [1, 3]}\` (True first, because 2 came first).

### 3. Python \`int(str)\` semantics — MUST use BigInt (arbitrary precision)
Accepted grammar after stripping leading/trailing Unicode whitespace:
  [+|-] digit (['_'] digit)*
- Digits are any Unicode \`\\p{Nd}\` code point (NOT just ASCII 0-9). Value of a
  Nd char = cp - (cp of its block's zero). Find the block zero by walking back
  from cp while the preceding code point is still Nd (max 9 steps).
- Underscores: allowed ONLY as single separators BETWEEN digits.
  REJECT: '_1', '1_', '1__0'.
- Leading '+' or '-' allowed (ASCII only). U+2212 MINUS SIGN is REJECTED.
- Whitespace stripped = Python \`str.strip()\` set: ASCII space \\t \\n \\r \\v \\f,
  plus Unicode whitespace incl. NBSP U+00A0, U+1680, U+2000-U+200A, U+2028,
  U+2029, U+202F, U+205F, U+3000. NOTE: U+200B ZERO WIDTH SPACE is NOT
  whitespace in Python -> '3\\u200b' must RAISE.
- Empty/blank string -> raise.
- '0x10', '1.0', '-3.5', '- 3', '²' (superscript two, category No) -> all raise.
- Result must be a normalized BigInt: '-0' -> 0 (prints "0"), '007' -> 7.
On failure raise a ValueError-equivalent with message:
  \`invalid literal for int() with base 10: <pyrepr of the ORIGINAL unstripped string>\`

### 4. Python \`repr()\` of a str (needed for the ValueError message)
- Default quote \`'\`. If the string contains \`'\` and does NOT contain \`"\`, use \`"\` as quote.
- Inside: backslash -> \`\\\\\`; the active quote char -> escaped with backslash;
  \\n -> \`\\n\`, \\r -> \`\\r\`, \\t -> \`\\t\`.
- Non-printable code points -> \`\\xNN\` (cp < 0x100), \`\\uNNNN\` (cp < 0x10000),
  \`\\UNNNNNNNN\` otherwise. Printability follows Python's \`str.isprintable()\`:
  NOT printable = categories Cc, Cf, Cs, Co, Cn, Zl, Zp, Zs — EXCEPT ASCII
  space (U+0020) which IS printable.
  Verified: \`'3\\u200b'\` (U+200B, category Cf) renders as \`'3\\u200b'\`.
  Verified: \`a'b\` -> \`"a'b"\`;  \`a"b\` -> \`'a"b'\`;  \`a\\b\` -> \`'a\\\\b'\`;  \`− 3\` prints literally.
  Note U+2212 (category Sm) IS printable -> \`'−3'\` renders literally.

### 5. Python \`print()\` of the results
- tuple of 2 lists: \`([1, 2], [3])\` — \`(\`, repr of each element joined by \`, \`, \`)\`.
- list: \`[1, 2, 3]\`, empty \`[]\`.
- dict: \`{False: [1], True: [2]}\`, empty \`{}\`. Separator \`, \`, key/value sep \`: \`.
- bool: \`True\` / \`False\`. int: decimal, no separators.
- Each print emits its text + \`\\n\` to stdout.

### 6. argparse clone — VERIFIED behaviors
prog = basename(process.argv[1])  (mirrors Python's basename(sys.argv[0])).
Options: \`-h/--help\` and \`--a A\` (required, type=str, help='Comma-separated numbers').

Usage line (exact):
\`usage: <prog> [-h] --a A\`

\`--help\` (or any unambiguous prefix like \`--he\`) -> stdout, exit 0:
\`\`\`
usage: <prog> [-h] --a A

options:
  -h, --help  show this help message and exit
  --a A       Comma-separated numbers
\`\`\`
(blank line after usage; section header \`options:\`; two-space indent; the help
text column is aligned — \`-h, --help\` is the longest invocation at 10 chars, so
help text starts at column 2+10+2=14.)

Errors go to STDERR, exit code 2, formatted as:
\`\`\`
usage: <prog> [-h] --a A
<prog>: error: <message>
\`\`\`
Verified messages:
- no \`--a\` given                -> \`the following arguments are required: --a\`
- \`--a\` with no value           -> \`argument --a: expected one argument\`
- \`--a -3,-2,-1,0\`              -> \`argument --a: expected one argument\`
- \`--a -abc\`                    -> \`argument --a: expected one argument\`
- \`--a 1,2 --b 3\`               -> \`unrecognized arguments: --b 3\`
- \`--a 1,2 --\`                  -> \`unrecognized arguments: --\`
- \`-- --a 1,2\`                  -> \`the following arguments are required: --a\`
- \`-a 5\`                        -> \`the following arguments are required: --a\`  (then no unrecognized error; required fires first)
- \`--A 1,2\`                     -> \`the following arguments are required: --a\`

NEGATIVE NUMBER RULE (argparse \`_negative_number_matcher\` = \`^-\\d+$|^-\\d*\\.\\d+$\`):
Because the parser has NO option strings that look like negative numbers, a token
starting with \`-\` is treated as a VALUE (not an option) iff it matches that regex.
  \`--a -3\`   -> ACCEPTED, value "-3"   (then int() gives -3)
  \`--a -3.5\` -> ACCEPTED by argparse, value "-3.5" (then int() RAISES ValueError)
  \`--a -3,-2,-1,0\` -> rejected (does not match) -> "expected one argument"
Also: a token starting with \`-\` that contains a space IS treated as a value
(argparse rule: \`if ' ' in arg_string: return None\` -> positional/value).
\`--a=VALUE\` form always supplies VALUE directly, even \`--a=-3,-2,-1,0\` (ACCEPTED).
Abbreviation/prefix matching for long options is ON.
Repeated \`--a X --a Y\` -> last wins.

### 7. Uncaught ValueError path
When int() fails, the script prints NOTHING to stdout and writes this traceback to
STDERR, then exits with code 1:
\`\`\`
Traceback (most recent call last):
  File "test7.py", line 8, in <module>
    numbers = [int(x) for x in args.a.split(',')]
               ^^^^^^
ValueError: invalid literal for int() with base 10: <repr>
\`\`\`
(The reference executable additionally prints a \`[PYI-NNN:ERROR] ...\` line — that
is a PyInstaller-only artifact with a varying PID and is NOT part of the Python
script's behavior; do NOT reproduce it.)

## HARD CONSTRAINTS
- Node.js ESM only. \`import\`/\`export\` ONLY. \`require\`/\`module.exports\` FORBIDDEN.
- ALL files use the \`.mjs\` extension. All relative imports include the full \`.mjs\` suffix.
- ZERO external/npm dependencies. Only local relative imports are permitted.
  Do NOT even import node: builtins unless genuinely required (they are not needed here;
  use process.stdout.write / process.argv / process.exit).
- Everything written under ${OUT}. Library modules in ${OUT}/lib/, entry at ${OUT}/test7.mjs.
- Split by functionality into multiple modules, each exposing a clean \`export\` interface.
- No Python may be embedded or invoked.
`

// ---------------------------------------------------------------------------
phase('Implement')

const MODULES = [
  {
    key: 'pyint',
    file: `${OUT}/lib/pyint.mjs`,
    task: `Create ONLY the file ${OUT}/lib/pyint.mjs (create the ${OUT}/lib directory as needed).

It must export:
  - \`export class PyValueError extends Error\`  — with a \`pyType\` field set to 'ValueError'.
  - \`export function pyStrip(s)\` — Python str.strip() using the Python Unicode whitespace set.
  - \`export function isPyDecimalDigit(cp)\` and \`export function pyDigitValue(cp)\` — Unicode Nd support.
  - \`export function pyInt(s)\` — full Python int(str) semantics returning a **BigInt**.

Follow section 3 of the spec EXACTLY. Use BigInt accumulation (\`v = v * 10n + BigInt(d)\`)
so arbitrary precision is exact. Normalize -0 to 0n.

For the Nd digit value: test membership with a \`/\\p{Nd}/u\` regex on the code point's
string, and find the block zero by walking backwards from cp up to 9 steps while the
previous code point is still Nd. Cache results in a Map for speed.

For the error, throw \`new PyValueError(\\\`invalid literal for int() with base 10: \\\${pyRepr(original)}\\\`)\`
— import \`pyRepr\` from './pyrepr.mjs' (another agent is writing that file; it exports
\`export function pyRepr(value)\` which handles strings). Assume that import works.

Iterate over the string by CODE POINT (use \`[...s]\` or a for..of loop), not UTF-16 units,
so astral characters are handled correctly.

Write clean, commented, idiomatic modern JS. Do not create any other file.
Then verify it parses: run \`node --input-type=module --eval "…"\` or \`node --check\` is not
valid for .mjs — instead run \`node -e "import('${OUT}/lib/pyint.mjs').then(m=>console.log(Object.keys(m)))"\`
only AFTER pyrepr.mjs exists; if it does not exist yet, just verify syntax by reading carefully.

SPEC:
${SPEC}`,
  },
  {
    key: 'pyrepr',
    file: `${OUT}/lib/pyrepr.mjs`,
    task: `Create ONLY the file ${OUT}/lib/pyrepr.mjs (create the ${OUT}/lib directory as needed).

It must export:
  - \`export function pyIsPrintable(cp)\` — Python str.isprintable() per code point.
  - \`export function pyRepr(value)\` — Python repr() for the value kinds this program needs:
      * JS string  -> Python str repr (quote selection + escaping, section 4 of spec)
      * BigInt     -> decimal digits (e.g. \`-98765432109876543210\`)
      * boolean    -> \`True\` / \`False\`
      * null       -> \`None\`
      * Array      -> \`[a, b, c]\` / \`[]\`
      * \`PyTuple\`  -> \`(a, b)\` — see below; also \`()\` for empty and \`(a,)\` for 1-element
      * Map        -> \`{k: v, ...}\` / \`{}\` (insertion order — this is how bucketize's
                      dict is represented so key order is preserved)
      * plain Number -> Python-ish int/float rendering (integers without \`.0\` only if
                      Number.isInteger is false use standard repr) — keep this simple,
                      it is not on the hot path.
  - \`export class PyTuple\` — a tiny wrapper: \`new PyTuple([a, b])\`, with an \`items\` array
    and an iterator, so repr can distinguish a tuple from a list.
  - \`export function pyPrint(value)\` — writes \`pyStr(value) + "\\n"\` to process.stdout.
  - \`export function pyStr(value)\` — Python str(): for containers this is identical to
    repr (Python's str of a tuple/list/dict calls repr on it), for a top-level string it
    is the string itself.

For \`pyIsPrintable\`: a code point is NOT printable if its Unicode general category is
Cc, Cf, Cs, Co, Cn, Zl, Zp, or Zs — EXCEPT U+0020 which IS printable. Implement using
regex property escapes: \`/\\p{Cc}|\\p{Cf}|\\p{Cs}|\\p{Co}|\\p{Cn}|\\p{Zl}|\\p{Zp}|\\p{Zs}/u\`.
Note \\p{Cn} (unassigned) is supported in V8 as \`\\p{Unassigned}\`? It is NOT — instead
handle it by testing \`/\\p{Any}/u\` won't help either. Use this approach: a cp is
printable iff it does NOT match the Cc/Cf/Cs/Co/Zl/Zp/Zs classes AND it is assigned.
For "assigned", test \`/\\p{L}|\\p{M}|\\p{N}|\\p{P}|\\p{S}|\\p{Z}/u\` — if it matches any of
those major categories it is assigned. Combine: printable = (matches L/M/N/P/S) OR
cp === 0x20. That single rule reproduces Python exactly for every case that matters
(Z categories other than U+0020 are non-printable; C categories are non-printable;
unassigned are non-printable). Verify against the spec examples.

Escaping order matters: backslash FIRST, then the active quote, then \\n \\r \\t, then
non-printables via \\xNN / \\uNNNN / \\UNNNNNNNN (lowercase hex digits, zero padded to
2 / 4 / 8). Iterate by CODE POINT.

Write clean, commented, idiomatic modern JS. Do not create any other file.

SPEC:
${SPEC}`,
  },
  {
    key: 'argparse',
    file: `${OUT}/lib/argparse.mjs`,
    task: `Create ONLY the file ${OUT}/lib/argparse.mjs (create the ${OUT}/lib directory as needed).

Implement a faithful, self-contained mini-clone of the subset of Python's argparse that
this program uses. Export:
  - \`export class ArgumentParser\` with \`add_argument(...flags, {type, required, help, action})\`
    and \`parse_args(argv)\`, plus \`format_usage()\`, \`format_help()\`, \`error(message)\`,
    \`print_help()\`.
  - \`export function basename(p)\` — pure-JS basename (no node:path import needed;
    split on '/' and take the last non-empty segment).

Behavior must match section 6 of the spec EXACTLY — usage string, help text layout and
column alignment, the \`options:\` section header, error message wording, stderr routing,
and exit codes (0 for --help, 2 for errors).

The trickiest part is the negative-number rule; implement Python's actual algorithm:
  A token is a candidate OPTION only if it starts with a prefix char ('-') AND:
    - it is not exactly '-' ;
    - if it does NOT contain '=' and is not a known option string:
        * if the parser has no option strings that look like negative numbers AND the
          token matches /^-\\d+$|^-\\d*\\.\\d+$/  -> it is a VALUE, not an option;
        * if the token contains a space -> it is a VALUE, not an option.
  '--' terminates option parsing (first occurrence is consumed).
Long-option prefix/abbreviation matching is enabled; ambiguous prefixes are an error.
\`--opt=value\` is supported. Required-argument checking happens BEFORE the
unrecognized-arguments check (verified: \`-a 5\` reports the required error, not unrecognized).
Note: \`parse_args\` = \`parse_known_args\` then error on leftovers.

Keep it focused — do not implement subparsers, nargs, positionals beyond what is needed
to reproduce the observed errors, choices, or metavar customization. But DO make it a
clean reusable module with a sensible API.

Use only \`process.stdout.write\`, \`process.stderr.write\`, \`process.exit\`. No imports of
node: builtins. No external deps.

Write clean, commented, idiomatic modern JS. Do not create any other file.

SPEC:
${SPEC}`,
  },
  {
    key: 'iterutils',
    file: `${OUT}/lib/iterutils.mjs`,
    task: `Create ONLY the file ${OUT}/lib/iterutils.mjs (create the ${OUT}/lib directory as needed).

Reimplement, from interface behavior only, the two boltons.iterutils functions:
  - \`export function partition(src, key = pyBool)\` -> returns a \`PyTuple\` of two arrays
    \`[trues, falses]\` (import PyTuple from './pyrepr.mjs').
  - \`export function bucketize(src, key = pyBool, { valueTransform = null, keyFilter = null } = {})\`
    -> returns a **Map** (so first-occurrence key insertion order is preserved exactly
    like a Python dict). Keys produced by \`key\` here are JS booleans.
  - \`export function pyBool(x)\` — Python truthiness helper (default key): false for
    false/null/undefined/0/0n/''/empty array/empty Map/empty Set, true otherwise.

Semantics per sections 1 and 2 of the spec. \`partition\` puts truthy-key elements first.
\`bucketize\` groups in first-occurrence key order with original element order in buckets.
Both must accept any iterable and must not mutate the input.

IMPORTANT for Map keys: JS \`Map\` uses SameValueZero, so boolean keys \`true\`/\`false\`
dedupe correctly. Good.

Also support the boltons behaviour where \`key\` may be a string (treated as an attribute/
property getter) — a small nicety that keeps the module a faithful general-purpose port;
raise a TypeError-like error if key is neither callable nor a string.

Write clean, commented, idiomatic modern JS. Do not create any other file.

SPEC:
${SPEC}`,
  },
]

const built = await parallel(MODULES.map(m => () =>
  agent(`${m.task}

When done, return a one-paragraph summary of what you exported and any judgement calls you made.`,
    { label: `impl:${m.key}`, phase: 'Implement' })
))

log(`Implemented ${built.filter(Boolean).length}/${MODULES.length} library modules`)

// ---------------------------------------------------------------------------
phase('Assemble')

const ASSEMBLE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'true if the entry point runs and matches all contract cases' },
    notes: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'notes', 'failures'],
  additionalProperties: false,
}

const assembled = await agent(`The library modules in ${OUT}/lib/ have just been written by other agents:
  pyint.mjs, pyrepr.mjs, argparse.mjs, iterutils.mjs
READ ALL FOUR FIRST.

Now write the entry point ${OUT}/test7.mjs plus a small glue module ${OUT}/lib/traceback.mjs
that exports \`export function emitPythonTraceback(err)\` writing the exact traceback from
section 7 of the spec to stderr.

${OUT}/test7.mjs must be a faithful line-for-line translation of the Python source:
  1. Build the ArgumentParser, add \`--a\` (type str, required, that help text).
  2. \`parse_args\` over \`process.argv.slice(2)\`.
  3. \`numbers = args.a.split(',').map(pyInt)\`  — on PyValueError, emit the traceback and
     exit 1 having printed NOTHING to stdout. (Split on ',' with a plain String.split(',')
     which matches Python's str.split(',') for this purpose — note Python's split(',')
     on '' yields [''] and JS ''.split(',') also yields [''], so they agree.)
  4. print partition(numbers, x => x % 2n === 0n)
  5. print partition(numbers, x => x > 0n)
  6. print bucketize(numbers, x => x % 2n === 0n)
  7. print bucketize(numbers, x => x > 10n)

CRITICAL — Python vs JS modulo on negatives: Python \`-6 % 2 == 0\` and JS \`-6n % 2n === 0n\`
both give 0, so for the \`== 0\` parity test the sign difference does not matter. But be
deliberate about it and add a comment. If you prefer, implement a \`pyMod\` helper in a
module and use it — floor-modulo: \`((a % b) + b) % b\`. Prefer correctness and clarity.

Also fix up any integration problems you find in the four library modules (wrong export
names, missing imports, mismatched signatures) — you own making the whole thing run.

Then VERIFY against the reference executable ${EXE}. Run at minimum every contract case
listed in the spec, comparing stdout, stderr and exit code. For the traceback cases,
compare stderr after deleting the \`[PYI-NNN:ERROR] ...\` line from the reference output.
Run as: \`node ${OUT}/test7.mjs --a "..."\`.
Note the reference prog name is \`test7_executable\` while ours is \`test7.mjs\` — that
difference in the usage/error lines is expected and correct (argparse derives prog from
argv[0]); normalize it when diffing.

Fix everything until all contract cases pass. Report honestly.

SPEC:
${SPEC}`, { label: 'assemble+smoke', phase: 'Assemble', schema: ASSEMBLE_SCHEMA, effort: 'high' })

log(`Assembly: ok=${assembled?.ok} ${assembled?.failures?.length ? `failures=${assembled.failures.length}` : ''}`)

// ---------------------------------------------------------------------------
phase('Fuzz')

const FUZZ_SCHEMA = {
  type: 'object',
  properties: {
    casesRun: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          argv: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          stream: { type: 'string' },
        },
        required: ['argv', 'expected', 'actual', 'stream'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
  },
  required: ['casesRun', 'mismatches', 'summary'],
  additionalProperties: false,
}

const FUZZ_ANGLES = [
  { key: 'numeric', focus: `Numeric value space: positive/negative/zero, mixed signs, magnitudes spanning 1 digit to 60 digits (well past Number.MAX_SAFE_INTEGER), values straddling the >10 boundary (9, 10, 11), parity edges, '-0', '+0', leading zeros ('007', '0000'), long lists (200+ elements), single-element lists, repeated values. Verify BigInt exactness and that no value is ever rendered in exponential notation or loses precision.` },
  { key: 'ordering', focus: `Bucketize key-insertion-order and partition ordering: construct inputs whose FIRST element flips which of True/False appears first in each of the two dicts, independently for the parity dict and the >10 dict. Include cases where only one key is ever produced, and where the two dicts have opposite key orders in the same run. Also verify within-bucket element order is the original order.` },
  { key: 'intparse', focus: `Python int() parsing: underscores (valid '1_0', '1_000_000'; invalid '_1','1_','1__0','1_,2'), whitespace forms (leading/trailing spaces, tabs, newlines, \\v \\f \\r, NBSP U+00A0, U+2000-U+200A, U+3000, and the NON-whitespace U+200B which must raise), Unicode Nd digits from several blocks (Arabic-Indic U+0660, Extended Arabic-Indic U+06F0, Devanagari U+0966, Bengali U+09E6, Thai U+0E50, fullwidth U+FF10, and an ASTRAL one such as Osmanya U+104A0 or Mathematical Bold U+1D7CE), mixed ASCII+Unicode digits, superscript '²' (must raise), '0x10', '1.0', '-3.5', '- 3', '−3' (U+2212), empty segments ('', '1,,2', '1,2,'). Check the exact ValueError message and its repr quoting.` },
  { key: 'argparse', focus: `argparse surface: missing --a; --a with no value; --a=VALUE form including '--a=' (empty value) and '--a=-3,-2'; bare negative-number values ('--a -3', '--a -3.5', '--a -0'); non-negative-number dash values ('--a -abc', '--a -3,-2'); a dash value containing a space ('--a "-3 4"'); unrecognized options; '--' in various positions; repeated --a; long-option abbreviations ('--he', '--hel'); '-h'; wrong case '--A'; short '-a'. Compare stdout, stderr and exit code. Remember to normalize the prog name (test7_executable vs test7.mjs) and to strip the reference's '[PYI-NNN:ERROR]' line before diffing.` },
]

const fuzzResults = await pipeline(
  FUZZ_ANGLES,
  a => agent(`You are differential-testing a Node.js port against its Python reference.

  Reference: ${EXE}
  Port:      node ${OUT}/test7.mjs

Write a THROWAWAY harness at /tmp/fuzz_${a.key}.mjs (NOT under ${OUT} — ${OUT} must contain
only the deliverable). The harness spawns both binaries with identical argv and diffs
stdout, stderr and exit code.

Normalization rules when diffing:
  - Replace the prog name: reference emits \`test7_executable\`, port emits \`test7.mjs\`.
  - Delete any line matching \`^\\[PYI-\\d+:ERROR\\] \` from the reference stderr (PyInstaller artifact).
  - Compare byte-for-byte otherwise, including trailing newlines.

Generate AT LEAST 250 cases focused on: ${a.focus}

Report every mismatch precisely. Do NOT fix anything — you are the oracle, not the repairer.
Return honest counts; if you ran fewer cases than asked, say so.

SPEC (for reference on intended behavior):
${SPEC}`, { label: `fuzz:${a.key}`, phase: 'Fuzz', schema: FUZZ_SCHEMA, effort: 'high' })
)

const allMismatches = fuzzResults.filter(Boolean).flatMap(r =>
  (r.mismatches || []).map(m => ({ ...m, angle: r.summary?.slice(0, 40) })))
const totalCases = fuzzResults.filter(Boolean).reduce((s, r) => s + (r.casesRun || 0), 0)
log(`Fuzz: ${totalCases} cases across ${fuzzResults.filter(Boolean).length} angles, ${allMismatches.length} mismatches`)

// ---------------------------------------------------------------------------
phase('Audit')

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          summary: { type: 'string' },
          failureScenario: { type: 'string', description: 'concrete argv -> wrong output' },
          fix: { type: 'string' },
        },
        required: ['file', 'severity', 'summary', 'failureScenario', 'fix'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
}

const AUDIT_LENSES = [
  { key: 'requirements', prompt: `Audit ${OUT}/** against the HARD CONSTRAINTS. Check EVERY file: (a) no \`require(\` and no \`module.exports\` anywhere; (b) every file ends in .mjs; (c) every relative import includes the .mjs suffix; (d) NO imports of any npm/external package — grep every import statement and confirm each specifier starts with './' or '../'; (e) no \`node:\` builtin imports if avoidable, and if any exist justify or remove them; (f) no Python is embedded or shelled out; (g) files live under ${OUT} with libraries split hierarchically into ${OUT}/lib/ and the entry at ${OUT}/test7.mjs; (h) no stray test/scratch files polluting ${OUT}; (i) every module exposes its interface via \`export\`. Report each violation as a finding.` },
  { key: 'correctness', prompt: `Adversarially hunt for CORRECTNESS bugs in ${OUT}/**. Read every line. Focus on: BigInt vs Number leakage (any place a BigInt could be coerced to Number and lose precision, or where \`+\` concatenates instead of adds); the Unicode Nd block-zero walk (does it work for astral code points and at block boundaries?); the underscore validation state machine; the Python-whitespace strip set (is U+200B correctly EXCLUDED? is U+0085 handled?); repr escaping order and the quote-selection rule; printability classification; off-by-one in help-text column alignment; the argparse negative-number matcher and prefix-matching; error-check ordering. For each suspected bug, construct the concrete argv that triggers it and ACTUALLY RUN both \`node ${OUT}/test7.mjs\` and ${EXE} to confirm before reporting. Only report findings you have empirically confirmed or can prove by careful reading.` },
  { key: 'robustness', prompt: `Audit ${OUT}/** for robustness and code quality: unhandled exception paths that would leak a JS stack trace to the user instead of the Python-style traceback (e.g. a TypeError thrown from deep inside), stdout/stderr write ordering and flushing (does the process exit before stdout drains? test with a 5000-element list piped to a slow consumer — \`node ${OUT}/test7.mjs --a "$(seq -s, 1 5000)" | cat\` must not truncate), process.exit truncation hazards, performance on large inputs (10000 elements should be fast), dead code, duplicated logic across modules that should be shared, unclear naming, and missing or misleading comments. Confirm each finding by running it.` },
]

const audits = await pipeline(
  AUDIT_LENSES,
  l => agent(`${l.prompt}

You have full shell access. The reference implementation is ${EXE}.
Return findings only — do NOT edit any files.

SPEC:
${SPEC}`, { label: `audit:${l.key}`, phase: 'Audit', schema: AUDIT_SCHEMA, effort: 'high' }),
  // Adversarially verify each finding as soon as its audit lands.
  (res, lens) => parallel((res?.findings || []).map(f => () =>
    agent(`A reviewer claims this defect in the Node.js port at ${OUT}:

  file: ${f.file}
  severity: ${f.severity}
  claim: ${f.summary}
  scenario: ${f.failureScenario}
  proposed fix: ${f.fix}

Your job is to REFUTE it. Read the actual code and RUN the concrete scenario against both
\`node ${OUT}/test7.mjs\` and the reference ${EXE}, normalizing the prog name
(test7_executable vs test7.mjs) and stripping the reference's '[PYI-NNN:ERROR]' line.

Default to refuted=true if you cannot demonstrate a real, observable divergence from the
reference or a real violation of the hard constraints. A stylistic preference is NOT a defect.
Report the exact commands you ran and their output.`,
      { label: `refute:${lens.key}:${(f.summary || '').slice(0, 28)}`, phase: 'Audit', effort: 'high', schema: {
        type: 'object',
        properties: {
          refuted: { type: 'boolean' },
          evidence: { type: 'string' },
        },
        required: ['refuted', 'evidence'],
        additionalProperties: false,
      } }).then(v => ({ ...f, lens: lens.key, verdict: v }))
  ))
)

const confirmed = audits.flat().filter(Boolean).filter(f => f.verdict && f.verdict.refuted === false)
log(`Audit: ${audits.flat().filter(Boolean).length} raw findings, ${confirmed.length} survived adversarial refutation`)

// ---------------------------------------------------------------------------
phase('Fix')

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    fixed: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
    finalVerification: { type: 'string' },
    fileList: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'fixed', 'skipped', 'finalVerification', 'fileList'],
  additionalProperties: false,
}

const workItems = [
  ...allMismatches.map(m => `[FUZZ MISMATCH] argv: ${m.argv}\n  stream: ${m.stream}\n  expected(reference): ${JSON.stringify(m.expected)}\n  actual(port): ${JSON.stringify(m.actual)}`),
  ...confirmed.map(f => `[CONFIRMED ${f.severity}] ${f.file}: ${f.summary}\n  scenario: ${f.failureScenario}\n  suggested fix: ${f.fix}\n  refuter evidence: ${(f.verdict?.evidence || '').slice(0, 600)}`),
]

const fixed = await agent(`You are finishing the Python-to-Node.js port at ${OUT}.

${workItems.length === 0
  ? 'Differential fuzzing and the adversarial audit found NO surviving defects. Your job is final validation and polish only.'
  : `Fix ALL of the following ${workItems.length} verified issues:\n\n${workItems.join('\n\n')}`}

Rules:
- Preserve the hierarchical module structure. Keep the entry at ${OUT}/test7.mjs and
  libraries under ${OUT}/lib/.
- ESM only; .mjs everywhere; full .mjs suffixes on relative imports; ZERO external deps
  (every import specifier must start with './' or '../').
- Remove any scratch/test files that ended up under ${OUT} — it must contain ONLY the
  deliverable library modules and test7.mjs. (Scratch belongs in /tmp.)
- Make sure stdout is fully flushed before exit for large outputs.

AFTER fixing, run a FINAL comprehensive differential validation (write the harness in /tmp):
at least 400 cases spanning every category — plain numeric lists, big integers beyond
2^53, Unicode digits including an astral block, underscores, whitespace forms, all the
int() failure modes, bucketize key-order flips, and the full argparse surface
(--help, -h, --he, missing --a, --a with no value, --a=..., negative-number values,
unrecognized args, '--' placement, repeated --a). Diff stdout + stderr + exit code with
the prog-name and [PYI-NNN:ERROR] normalizations.

Also assert the constraints mechanically:
  grep -rn "require(\\|module.exports" ${OUT}   -> must be empty
  grep -rn "^import\\|from '" ${OUT}            -> every specifier relative and .mjs-suffixed
  find ${OUT} -type f ! -name '*.mjs'           -> must be empty

Report honestly: if anything still diverges, say exactly what. Set ok=false if any
divergence remains. List every file you left under ${OUT} in fileList.

SPEC:
${SPEC}`, { label: 'fix+final-validation', phase: 'Fix', schema: FIX_SCHEMA, effort: 'high' })

return {
  assembled,
  fuzz: { totalCases, mismatches: allMismatches.length },
  audit: { raw: audits.flat().filter(Boolean).length, confirmed: confirmed.length },
  final: fixed,
}
