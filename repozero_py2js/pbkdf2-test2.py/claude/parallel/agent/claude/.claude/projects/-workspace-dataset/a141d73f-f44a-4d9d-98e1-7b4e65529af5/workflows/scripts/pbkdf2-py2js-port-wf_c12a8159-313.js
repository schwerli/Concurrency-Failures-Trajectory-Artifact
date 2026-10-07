export const meta = {
  name: 'pbkdf2-py2js-port',
  description: 'Port Python pbkdf2 CLI to zero-dependency ESM Node.js with differential verification',
  phases: [
    { title: 'Implement' },
    { title: 'Integrate' },
    { title: 'Fuzz' },
    { title: 'Review' },
    { title: 'Fix' },
  ],
}

const SPEC = `
# PROJECT CONTEXT (read fully before writing anything)

We are porting this Python program to Node.js ESM, as a BLACK-BOX reimplementation.

Source: /workspace/dataset/test2.py
\`\`\`python
#!/usr/bin/env python3
import argparse
import pbkdf2

parser = argparse.ArgumentParser()
parser.add_argument('--a', type=str, required=True)  # passphrase
parser.add_argument('--b', type=str, required=True)  # salt
parser.add_argument('--c', type=int, required=True)  # iterations
args = parser.parse_args()

result = pbkdf2.PBKDF2(args.a, args.b, iterations=args.c).read(20)
print(result.hex())
\`\`\`

Reference binary (RUN IT to check behavior): /workspace/dataset/test2_executable --a X --b Y --c N
NEVER run \`python\`. Only the executable.

## HARD RULES (violating any = invalid answer)
- Pure JavaScript, Node.js 18, ES Modules ONLY. \`import\`/\`export\`. NO \`require()\`, NO \`module.exports\`.
- ALL files use the \`.mjs\` extension. All relative imports MUST include the \`.mjs\` suffix.
- ZERO external/npm dependencies. Only Node built-ins via \`node:\` prefix (node:fs, node:path, node:process, node:url...).
- **\`node:crypto\` IS ABSOLUTELY FORBIDDEN** — do not import it, do not reference \`crypto.pbkdf2\`, \`crypto.pbkdf2Sync\`, \`createHash\`, \`createHmac\`, or even mention them in comments. SHA-1 and HMAC must be hand-written in pure JS.
- No embedding/spawning Python.
- Everything is written under /output.

## ESTABLISHED BLACK-BOX FACTS (already verified against the executable — trust these, re-verify if you touch them)

### Algorithm
- It is **standard PBKDF2-HMAC-SHA1**, output 20 bytes, printed lowercase hex + newline.
- RFC 6070 confirmed: ("password","salt",1) -> 0c60c80f961f0e71f3a9b524af6012062fe037a6 ;
  ("password","salt",2) -> ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957 ;
  ("password","salt",4096) -> 4b007901b765489abead49d926f721d065a429c1
- Given test cases:
  ("p'_xyB9J", "\\$2b\\$12\\$aTIircdJsS8iO3WFg3aKsE", 500)   -> 8dc01b919e750ff1d42d9066b1cb46cbd79fbaca
  ("=BH[kuEw", "salt_740344", 10000)                        -> b0384e5dbe9a85ba12a97d330410bb28cb062190
  ("RxgG9oiZ", "FeKORdjj", 5000)                            -> 6352bbf03b1567f6d68e560c03dece654146ca25
  (",XD0fO8{", "\\$2b\\$12\\$v3g32CgH6DaUjA3PjeEYqv", 1000)  -> 9f322ad1a21e4b891f19bd297e641e7119dd665a
- Strings are encoded to bytes with UTF-8. Verified multibyte/emoji cases:
  ("密码パス","ソルト盐",100) -> 4429b29d3ddbffbe3bbcdf31fc40fff0874ab542
  ("café","naïve",100)       -> f014dbf5a80c0193c046b7b11e1b14ba2d9b280a
  ("😀🔑","🧂",50)            -> a5dac9673a93a95cc562585930bdd0d92a3dd093
  ("", "", 1)                -> 1e437a1c79d75be61e91141dae20affc4892cc99
- HMAC key-length boundaries verified (63/64/65 'A' chars all correct with standard HMAC key handling:
  keys longer than the 64-byte block are replaced by their SHA-1 digest, shorter keys are zero-padded).

### PBKDF2 object semantics (Dwayne Litzenberger's \`pbkdf2\` module)
- \`PBKDF2(passphrase, salt, iterations=1000)\` then \`.read(n)\`.
- \`_setup\` order of operations, byte-for-byte reproduced in the traceback line numbers below:
  1. encode passphrase to UTF-8            (pbkdf2.py line 193)
  2. encode salt to UTF-8                  (pbkdf2.py line 197)
  3. \`if iterations < 1: raise ValueError("iterations must be at least 1")\`  (pbkdf2.py line 205)
- \`read(n)\` is a keystream reader: it buffers leftover bytes, and block index i starts at 1.
  F(i) = U1 ^ U2 ^ ... ^ Uc, U1 = HMAC-SHA1(passphrase, salt || BE32(i)), Uj = HMAC-SHA1(passphrase, U(j-1)).
  Implement it faithfully as a stateful stream object with \`read(n)\`, \`close()\`, \`closed\`, and the
  block-counter overflow guard at i > 0xffffffff, even though the program only reads 20 bytes once.

### CLI / argparse behaviour (verified)
Three options, all \`required=True\`, no defaults, dest names \`a\`, \`b\`, \`c\`. \`--c\` uses \`type=int\`.
prog name in Python comes from \`os.path.basename(sys.argv[0])\`. For our port, prog MUST be the
basename of the running script, i.e. \`test2.mjs\`, computed dynamically (do NOT hardcode "test2_executable").

- \`--help\` / \`-h\` (anywhere in argv, even after valid args) prints to STDOUT and exits 0:
\`\`\`
usage: test2_executable [-h] --a A --b B --c C

options:
  -h, --help  show this help message and exit
  --a A
  --b B
  --c C
\`\`\`
  (with \`test2_executable\` replaced by the actual prog name; note the blank line after usage,
   two leading spaces on option lines, and the exact column alignment shown — \`-h, --help\` is
   followed by two spaces then the help text.)
- Missing required options -> STDERR, exit code 2:
\`\`\`
usage: test2_executable [-h] --a A --b B --c C
test2_executable: error: the following arguments are required: --a, --b, --c
\`\`\`
  Only the missing ones are listed, in declaration order (--a, --b, --c).
- Unrecognized extras -> STDERR exit 2: \`error: unrecognized arguments: --d z\` (extras joined by single spaces,
  in the order encountered). \`--\` alone also becomes an unrecognized argument (\`unrecognized arguments: --\`).
- Bad int -> STDERR exit 2: \`error: argument --c: invalid int value: '0x10'\` (repr of the string, Python-style quoting).
- Option needing a value but next token looks like an option -> \`error: argument --a: expected one argument\`.
- REQUIRED-MISSING ERRORS TAKE PRECEDENCE over unrecognized-argument errors
  (e.g. \`-a x -b y -c 100\` reports "the following arguments are required: --a, --b, --c", not unrecognized).
  This falls out naturally if you mirror argparse: parse_known_args() checks required at the end of parsing
  and errors there; the unrecognized-extras check happens afterwards in parse_args().
- \`--a=VALUE\` explicit form works and allows dash-leading values (\`--a=-x\` is fine).
- Duplicate \`--a p --a q\` -> last one wins.
- Abbreviation: \`--aa\` does NOT match \`--a\` (it is longer, so it's just unknown).
- A token is treated as a VALUE rather than an option when any of these hold (mirror argparse's \`_parse_optional\`):
  * it is the empty string;
  * it does not start with a prefix char ('-');
  * it contains a space character;
  * it looks like a negative number AND the parser has no options that look like negative numbers
    (our parser has none, so \`-1\` and \`-1.5\` ARE accepted as values — VERIFIED: \`--a -1\` and \`--a -1.5\` work,
     while \`--a -x\` errors with "expected one argument").
  Python's negative-number matcher is the regex \`^-\\d+$|^-\\d*\\.\\d+$\`.
  VERIFIED: \`--a ' -x'\` (leading space) and \`--a '-x y'\` are accepted as values.

### Python \`int()\` conversion semantics for --c (VERIFIED against the executable)
- Leading/trailing Unicode whitespace stripped: \`' 10 '\` -> 10.
- Underscores allowed between digits: \`'1_0'\` -> 10. (Not leading/trailing/doubled, not next to the sign.)
- Optional leading \`+\` or \`-\`: \`'+10'\` -> 10.
- Unicode decimal digits accepted: \`'١٠'\` (ARABIC-INDIC) -> 10.
- Rejected: \`'0x10'\`, \`'10.0'\`, \`''\`, \`'abc'\`.
- Arbitrary precision — parse safely (BigInt) and only then decide.

### Runtime error path (exit code 1, everything on STDERR, nothing on stdout)
\`iterations < 1\`:
\`\`\`
Traceback (most recent call last):
  File "test2.py", line 12, in <module>
    result = pbkdf2.PBKDF2(args.a, args.b, iterations=args.c).read(20)  # 派生 20 字节密钥
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "pbkdf2.py", line 141, in __init__
  File "pbkdf2.py", line 205, in _setup
ValueError: iterations must be at least 1
[PYI-<pid>:ERROR] Failed to execute script 'test2' due to unhandled exception!
\`\`\`
The caret line has 13 leading spaces then 47 '^' characters. \`<pid>\` is the process id (use process.pid).

Invalid-UTF-8 argv bytes: Python decodes argv with UTF-8 + surrogateescape, so a raw byte 0xFF becomes
U+DCFF, and \`.encode('UTF-8')\` then fails. Same traceback shape but the failing frame is
\`File "pbkdf2.py", line 193, in _setup\` for the passphrase / \`line 197\` for the salt, and the last lines are:
\`\`\`
UnicodeEncodeError: 'utf-8' codec can't encode character '\\udcff' in position 1: surrogates not allowed
\`\`\`
where the position is the index of the FIRST offending character in the decoded string, and the character
is rendered as a Python \`\\udcXX\` escape (lowercase hex). Passphrase is checked BEFORE salt, and BOTH are
checked BEFORE the iterations<1 check (VERIFIED by combining an invalid byte with --c 0).

To recover raw argv bytes on Linux, read \`/proc/self/cmdline\` (NUL-separated) with node:fs and take the
LAST \`process.argv.length - 2\` entries — those are the user args as raw bytes. Then emulate Python's
UTF-8-with-surrogateescape decode. If /proc/self/cmdline is unavailable/mismatched, fall back gracefully
to \`process.argv.slice(2)\`. This must never crash on normal input.

## MODULE LAYOUT (fixed — do not rename, do not add or remove files)
/output/lib/bytes.mjs        byte helpers
/output/lib/pycodec.mjs      UTF-8 surrogateescape codec + raw argv
/output/lib/pyint.mjs        Python int() semantics
/output/lib/pyerror.mjs      Python-style exceptions + traceback rendering
/output/lib/argparse.mjs     minimal argparse clone
/output/lib/hash/sha1.mjs    pure-JS SHA-1 hashlib-like module
/output/lib/hash/hmac.mjs    pure-JS HMAC
/output/lib/pbkdf2.mjs       PBKDF2 class
/output/lib/index.mjs        barrel re-export of the public surface
/output/test2.mjs            entry point

## EXACT INTERFACE CONTRACT (every module must match this exactly so the parts compose)

### lib/bytes.mjs
export function toHex(u8) -> lowercase hex string
export function xorInto(dst /*Uint8Array*/, src /*Uint8Array*/) -> dst (in place, same length)
export function concatBytes(arrayOfU8) -> Uint8Array
export function uint32be(n) -> Uint8Array(4) big-endian
export function bytesEqual(a, b) -> boolean

### lib/pycodec.mjs
export function utf8SurrogateEscapeDecode(bytes /*Uint8Array*/) -> string
   Emulates Python's \`bytes.decode('utf-8', 'surrogateescape')\`: valid UTF-8 sequences decode normally
   (including 4-byte sequences -> surrogate PAIR in JS); each undecodable BYTE b becomes U+DC00+b.
   Must reject over-long encodings, surrogates encoded in UTF-8 (ED A0..BF ..), and > U+10FFFF the same
   way Python's strict UTF-8 decoder does, mapping each rejected byte to U+DC00+b.
export function findSurrogateEscape(str) -> { index, codePoint } | null
   Returns the first lone surrogate (U+D800..U+DFFF not part of a valid pair) with its index measured in
   PYTHON CODE POINTS (not UTF-16 units — astral characters count as 1), or null.
export function encodeUtf8Strict(str) -> Uint8Array
   Throws a PyUnicodeEncodeError (from pyerror.mjs) if the string contains a lone surrogate.
   Otherwise returns the UTF-8 bytes (astral pairs -> 4-byte sequences).
export function rawArgv() -> string[]
   The user arguments (after the script path), decoded from raw /proc/self/cmdline bytes with
   utf8SurrogateEscapeDecode when possible; otherwise process.argv.slice(2). Never throws.

### lib/pyint.mjs
export class PyValueError extends Error {}          // re-export from pyerror if simpler, but this name must resolve
export function pyInt(str) -> number
   Python int(str) semantics as described above. Throws PyIntParseError (exported) on failure.
   Result may exceed Number.MAX_SAFE_INTEGER — in that case still return a Number (Infinity-safe), the
   caller only compares against 1 and loops.
export class PyIntParseError extends Error {}
export function pyRepr(str) -> string   // Python repr() of a str, used for the "invalid int value: 'x'" message

### lib/pyerror.mjs
export class PyError extends Error { constructor(type, message) }   // .pyType, .pyMessage
export class PyValueError extends PyError {}
export class PyUnicodeEncodeError extends PyError { constructor(codePoint, position) }
   .pyType === 'UnicodeEncodeError'
   .pyMessage === "'utf-8' codec can't encode character '\\\\udcff' in position 1: surrogates not allowed"
   plus a \`.frameLine\` slot the caller can set to 193 or 197.
export function formatTraceback(frames /*[{file, line, name, source?, caret?}]*/, err) -> string
export function renderFatal(err) -> string
   Produces the FULL stderr text (traceback + the trailing "[PYI-<pid>:ERROR] ..." line), ending with a newline.

### lib/hash/sha1.mjs   (mimics a Python hashlib module object)
export const digest_size = 20
export const block_size  = 64
export class SHA1 { update(u8); digest() -> Uint8Array; copy() -> SHA1 }
export function create(initialBytes /* optional Uint8Array */) -> SHA1     // like hashlib.sha1(data)
export default { digest_size, block_size, new: create, create }
Must be a correct streaming SHA-1 (padding, 64-bit big-endian length, works for empty input and
inputs spanning many blocks). Use Uint32Array/>>>0 arithmetic; no BigInt in the hot loop.

### lib/hash/hmac.mjs
export class HMAC { constructor(key /*Uint8Array*/, msg /*Uint8Array|null*/, digestmod /*sha1 module obj*/);
                    update(u8); digest() -> Uint8Array; copy() -> HMAC }
export function create(key, msg, digestmod) -> HMAC        // like hmac.new(key, msg, digestmod)
Standard RFC 2104: key longer than block_size is hashed; then zero-padded to block_size; ipad 0x36, opad 0x5c.
For speed, precompute the inner/outer padded states ONCE per PBKDF2 run and clone them per iteration
(a \`copy()\` based fast path) — 10000 iterations must stay fast.

### lib/pbkdf2.mjs
export class PBKDF2 {
  constructor(passphrase /*string|Uint8Array*/, salt /*string|Uint8Array*/, iterations = 1000,
              digestmodule = sha1, macmodule = hmac)
  read(n) -> Uint8Array
  close()
  get closed() -> boolean
  hexread(octets) -> string        // convenience, mirrors the Python API
}
Constructor performs _setup in the verified order: encode passphrase (may throw PyUnicodeEncodeError with
frameLine 193), encode salt (frameLine 197), then \`if (iterations < 1) throw new PyValueError('iterations must be at least 1')\`
tagged with frameLine 205.

### lib/index.mjs
Re-export the public surface: PBKDF2, sha1, hmac, parser bits, byte helpers.

### lib/argparse.mjs
export class ArgumentParser {
  constructor({ prog } = {})
  add_argument(flag, { type, required, help, dest })       // supports the '--x' long-flag forms used here
  parse_args(argv /*string[]*/) -> plain object of dest->value
  format_usage(), format_help()
  error(message)   // prints usage + "prog: error: message" to stderr, exits 2
  exit(code, message)
}
It must reproduce the verified behaviours above. Keep it a faithful-but-minimal argparse clone; it only
needs to support store actions with long flags, plus the automatic -h/--help.

## STYLE
- Clean, readable, commented where the behaviour is non-obvious (especially the argparse quirks and the
  surrogateescape codec). Match a consistent house style across files: 2-space indent, semicolons,
  single quotes, named exports, JSDoc-lite comments on exported functions.
- No dead code, no TODOs, no console.log debugging left behind.
`

const FILE_TASKS = [
  {
    key: 'bytes+pycodec',
    files: '/output/lib/bytes.mjs and /output/lib/pycodec.mjs',
    detail: `Write BOTH files. bytes.mjs has no imports. pycodec.mjs imports PyUnicodeEncodeError from '../lib/pyerror.mjs' — use the correct relative path './pyerror.mjs' — and node:fs for /proc/self/cmdline.
The surrogateescape decoder is the trickiest part: implement a strict UTF-8 state machine that, on ANY invalid byte,
emits U+DC00+byte for that single byte and resumes at the NEXT byte (Python's error handler consumes exactly the
bytes the decoder rejected — for a truncated/invalid multi-byte sequence Python escapes the bytes that could not
start/continue a valid sequence, one U+DCxx per byte). Reject: continuation bytes as leads, C0/C1 overlongs,
0xED 0xA0-0xBF (UTF-16 surrogates), 0xF4 0x90+ and 0xF5-0xFF (beyond U+10FFFF), truncated sequences.
findSurrogateEscape must count positions in Python code points: iterate with a for..of over the string
(which yields code points) and count 1 per code point.
rawArgv(): read /proc/self/cmdline with fs.readFileSync, split on 0x00, drop a trailing empty chunk, then take
the last (process.argv.length - 2) entries. If the count doesn't line up or anything throws, return process.argv.slice(2).`,
  },
  {
    key: 'pyerror+pyint',
    files: '/output/lib/pyerror.mjs and /output/lib/pyint.mjs',
    detail: `Write BOTH files. pyerror.mjs has no local imports; pyint.mjs imports from './pyerror.mjs'.
renderFatal(err) must emit EXACTLY the verified traceback. Build it from frames so both error shapes share code:
frame 1 is always {file:'test2.py', line:12, name:'<module>',
  source:'result = pbkdf2.PBKDF2(args.a, args.b, iterations=args.c).read(20)  # 派生 20 字节密钥',
  caret:true}
rendered as '  File "test2.py", line 12, in <module>' then '    ' + source then the caret line:
13 spaces + 47 '^'. Then '  File "pbkdf2.py", line 141, in __init__' and
'  File "pbkdf2.py", line <frameLine>, in _setup'. Then '<PyType>: <message>'.
Then '[PYI-' + process.pid + ':ERROR] Failed to execute script \\'test2\\' due to unhandled exception!'.
Header line is 'Traceback (most recent call last):'. Everything newline-terminated.
pyInt: strip Python-whitespace (\\t \\n \\v \\f \\r space plus Unicode whitespace incl. U+00A0, U+1680,
U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 — note Python's str.strip() also strips U+001C-U+001F
and U+0085), then optional sign, then digits with single underscores strictly BETWEEN digits.
Digits: ASCII 0-9 AND any Unicode Nd code point. For an Nd code point, its numeric value is
cp - (start of its contiguous 10-code-point block); find the block start by walking back while the
previous code point is still Nd (max 9 steps) using /\\p{Nd}/u. Accumulate with BigInt, then Number().
Empty digit run => throw. pyRepr(s): Python repr of a str — prefer single quotes; if the string contains a
single quote and no double quote, use double quotes; escape backslash, \\n \\r \\t, and non-printables as \\xNN /
\\uNNNN; lone surrogates as \\udcXX.`,
  },
  {
    key: 'sha1',
    files: '/output/lib/hash/sha1.mjs',
    detail: `Pure-JS streaming SHA-1, hashlib-module-like. NO node:crypto — not even in a comment.
Correctness targets you MUST self-check by writing a throwaway script in /tmp (NOT in /output) and running node:
  sha1('')      = da39a3ee5e6b4b0d3255bfef95601890afd80709
  sha1('abc')   = a9993e364706816aba3e25717850c26c9cd0d89d
  sha1('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq') = 84983e441c3bd26ebaae4aa1f95129e5e54670f1
  sha1('a'*1000000) = 34aa973cd4c4daa4f61eeb2bdbad27316534016f
  Also verify streaming: feeding 'abc' as three separate 1-byte update() calls gives the same digest,
  and a 55/56/57/63/64/65-byte input (padding boundaries) matches a single-shot digest.
digest() must NOT mutate the object's state (callers may digest a copy() and keep updating the original);
implement it by finalizing on a clone of the internal state+buffer.
Use a preallocated Uint32Array(80) message schedule and >>>0 arithmetic for speed.`,
  },
  {
    key: 'hmac',
    files: '/output/lib/hash/hmac.mjs',
    detail: `Pure-JS HMAC over the sha1 module (import * as sha1 from './sha1.mjs' or the named exports).
NO node:crypto. Must support copy() cheaply so PBKDF2 can clone a pre-keyed inner/outer state per iteration
rather than re-deriving the padded keys 10000 times.
Self-check in /tmp (NOT /output) against RFC 2202 HMAC-SHA1 vectors:
  key=0x0b*20, data='Hi There'          -> b617318655057264e28bc0b6fb378c8ef146be00
  key='Jefe', data='what do ya want for nothing?' -> effcdf6ae5eb2fa2d27416d5f184df9c259a7c79
  key=0xaa*80, data='Test Using Larger Than Block-Size Key - Hash Key First'
                                        -> aa4ae5e15272d00e95705637ce8a3b55ed402112
Also verify the >64-byte-key path and the exactly-64-byte-key path.`,
  },
  {
    key: 'pbkdf2',
    files: '/output/lib/pbkdf2.mjs',
    detail: `The PBKDF2 class per the contract. Imports: './hash/sha1.mjs', './hash/hmac.mjs', './bytes.mjs',
'./pycodec.mjs', './pyerror.mjs'.
_setup order: encodeUtf8Strict(passphrase) [on PyUnicodeEncodeError set err.frameLine=193 and rethrow],
encodeUtf8Strict(salt) [frameLine=197], then iterations<1 -> PyValueError('iterations must be at least 1')
with frameLine=205. A Uint8Array passed in is used as-is with no encoding step.
Also accept a non-integer iterations value the way Python would (the CLI always gives an int, so just
compare numerically).
read(n): keystream with leftover buffer, block counter starting at 0 and pre-incremented, guard i > 0xffffffff
with an overflow error. F(i) computed with the cloned pre-keyed HMAC for speed.
Self-check in /tmp (NOT /output) against RFC 6070 and by shelling out to /workspace/dataset/test2_executable.
ALSO verify the streaming property: two successive read(10) calls concatenate to the same 20 bytes as one read(20),
and read(25) then read(15) works across block boundaries.`,
  },
  {
    key: 'argparse',
    files: '/output/lib/argparse.mjs',
    detail: `The minimal argparse clone. Imports './pyint.mjs' only for pyRepr if you need it (the type
callable itself is passed in by the caller). Must reproduce every verified behaviour in the spec:
help text formatting, required-before-unrecognized precedence, '--x=v' form, negative-number value rule,
space-containing and empty-string values, duplicate-wins-last, 'expected one argument', 'invalid int value: %r',
exit codes 0/2, and stdout-vs-stderr routing (help -> stdout, errors -> stderr).
Do NOT call process.exit() from deep inside; instead throw a dedicated \`SystemExit\` error carrying
{code, stdout?, stderr?} OR write the stream and then throw SystemExit(code) — pick the write-then-throw
approach so ordering is natural, and export SystemExit so the entry point can catch it and set
process.exitCode. Use a synchronous write to fd 1 / fd 2 (fs.writeSync) so nothing is lost on exit.
Verify your formatting by diffing against the real executable's --help and error outputs.`,
  },
]

phase('Implement')
log(`Implementing ${FILE_TASKS.length} module groups in parallel`)

const implResults = await parallel(FILE_TASKS.map((t) => () =>
  agent(
    `${SPEC}

# YOUR ASSIGNMENT
Write ${t.files}.

${t.detail}

Write ONLY your assigned file(s). Other agents are concurrently writing the other modules to the exact
contract above — import from them by path and trust the contract; do NOT create, stub, or modify them.
You may write throwaway self-check scripts under /tmp and run them with node (your imports of not-yet-written
sibling modules may fail at that moment — that is expected; test your own logic in isolation by inlining
what you need into the /tmp script).

When done, reply with a terse report: the paths written, and any place where you had to make a judgement
call the contract did not pin down.`,
    { label: `impl:${t.key}`, phase: 'Implement' }
  )
))

log('Module implementation done; wiring entry point')

phase('Integrate')
const integrate = await agent(
  `${SPEC}

# YOUR ASSIGNMENT
All library modules under /output/lib have just been written by other agents. Your job:

1. READ every file under /output/lib (bytes.mjs, pycodec.mjs, pyint.mjs, pyerror.mjs, argparse.mjs,
   hash/sha1.mjs, hash/hmac.mjs, pbkdf2.mjs) and check they actually match the interface contract and
   compose with each other. Fix any mismatch, missing export, wrong relative import path, circular import,
   or duplicated/conflicting class definition (e.g. PyValueError defined in two places — it must be defined
   once in pyerror.mjs and re-exported from pyint.mjs).
2. Write /output/lib/index.mjs — the barrel re-export.
3. Write /output/test2.mjs — the entry point. It must mirror the Python program exactly:
   - prog = basename of the script file (derive from import.meta.url via node:url fileURLToPath + node:path basename)
   - build the ArgumentParser, add --a (str, required), --b (str, required), --c (int, required)
   - parse rawArgv() from pycodec.mjs (so invalid-UTF-8 bytes survive as surrogate escapes)
   - result = new PBKDF2(a, b, c).read(20); print toHex(result) + '\\n' to stdout
   - catch SystemExit -> set process.exitCode and return
   - catch PyError -> write renderFatal(err) to stderr, process.exitCode = 1
   - Use fs.writeSync(1, ...) / fs.writeSync(2, ...) so output is flushed deterministically, and make sure
     stdout gets NOTHING on the error paths.
4. Run it end-to-end and confirm all four given test cases plus the RFC 6070 vectors match the executable.
5. Confirm with grep that the string "crypto" appears NOWHERE under /output, and that no file contains
   \`require(\` or \`module.exports\`, and every relative import ends in \`.mjs\`.

Report: what you fixed, and the pass/fail status of each check.`,
  { label: 'integrate', phase: 'Integrate' }
)

phase('Fuzz')
log('Differential fuzzing against the reference executable')

const FUZZ_SCHEMA = {
  type: 'object',
  properties: {
    casesRun: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          invocation: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          stream: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['invocation', 'expected', 'actual'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['casesRun', 'mismatches', 'summary'],
}

const FUZZ_AREAS = [
  {
    key: 'algo-random',
    prompt: `Generate at least 400 RANDOMISED (passphrase, salt, iterations) triples and diff
\`node /output/test2.mjs --a A --b B --c C\` against \`/workspace/dataset/test2_executable --a A --b B --c C\`.
Cover: ASCII printable incl. shell-hostile chars, lengths 0..200, salts of length 0..200, iterations
1..20000 (keep the total runtime sane — bias toward small iteration counts, include a handful of large ones),
strings that are exactly 63/64/65 bytes, strings of repeated single characters, and strings containing
'=' , '-' , '--' , tabs and newlines. Use node:child_process spawnSync with an argv ARRAY (never a shell
string) so quoting cannot corrupt the comparison. Compare stdout, stderr AND exit code.`,
  },
  {
    key: 'unicode',
    prompt: `Focus on ENCODING. At least 250 cases: CJK, Hangul, Arabic, Hebrew, Devanagari, Cyrillic, Greek,
combining marks, ZWJ emoji sequences, skin-tone modifiers, astral plane (U+1F600, U+10000, U+10FFFF),
U+FFFD itself, NEL U+0085, NBSP U+00A0, RTL marks, and mixed scripts, as both passphrase and salt.
Also test the same text in NFC vs NFD forms (they must produce DIFFERENT digests, and each must match the
reference). Diff node /output/test2.mjs against /workspace/dataset/test2_executable via spawnSync with an
argv array. Compare stdout, stderr and exit code.`,
  },
  {
    key: 'raw-bytes',
    prompt: `Focus on RAW BYTE argv edge cases that are not valid UTF-8. Using node:child_process spawnSync
with argv entries built from Buffers containing raw bytes (construct the argument strings with
Buffer.from([...]).toString('binary')? NO — that is lossy. Instead use spawnSync with the argv array where
each element is created via Buffer.from(bytes).toString('utf8')? also lossy.
The reliable way: spawn through \`/bin/sh -c\` is also awkward. Use spawnSync('/bin/sh', ['-c', cmd]) where cmd
uses printf with octal escapes to build the argument, e.g.
  sh -c '"$0" --a "$(printf "a\\\\377b")" --b s --c 10' /workspace/dataset/test2_executable
so the SAME shell construction is used for both the reference and \`node /output/test2.mjs\`. That guarantees
identical raw bytes reach both programs.
Test: 0xFF, 0x80, 0xC0 0x80 (overlong NUL), 0xE0 0x80 0x80, 0xED 0xA0 0x80 (UTF-16 surrogate encoded),
0xF5 0x80 0x80 0x80, 0xF4 0x90 0x80 0x80 (> U+10FFFF), truncated 2/3/4-byte sequences, a valid multibyte char
followed by a stray continuation byte, invalid bytes at position 0 / middle / end, invalid bytes in the SALT
(should report line 197 not 193), and invalid bytes in BOTH (passphrase reported first), and invalid bytes
combined with --c 0 (the UnicodeEncodeError must win over the ValueError).
Compare stdout, stderr and exit code. NOTE: the reference stderr contains a "[PYI-<pid>:ERROR]" line whose
number is the process id — normalise that number away (replace /PYI-\\d+/ with 'PYI-N') on BOTH sides before
comparing, and say so in your summary. Everything else must match byte for byte.`,
  },
  {
    key: 'cli',
    prompt: `Focus on the ARGPARSE surface. At least 200 invocations covering: no args; each subset of the
three options missing; --help and -h alone and in every position; --a=v forms; repeated options; unknown
options (--d, --aa, --a-b); bare '--'; positional junk before/after; values that start with '-' (-1, -1.5,
-0, -.5, -1e5, -x, --, -, ' -x', '-x y', ''); options given a missing value at end of argv; -a/-b/-c single
dash forms; --c with values ' 10 ', '1_0', '+10', '0x10', '10.0', '1e3', '', 'abc', '١٠' (Arabic-Indic),
'१०' (Devanagari), '٠٠١٠', '-0', '00010', '1_0_0', '_10', '10_', '1__0', a 30-digit number, and
'\\u00a010' (NBSP-prefixed). Compare stdout, stderr and exit code between node /output/test2.mjs and
/workspace/dataset/test2_executable via spawnSync with an argv array.
IMPORTANT: the prog name legitimately differs ('test2.mjs' vs 'test2_executable'). Normalise it: replace
'test2_executable' and 'test2.mjs' with 'PROG' on both sides before comparing, and note that in your summary.
Everything else must match byte for byte.`,
  },
  {
    key: 'runtime-errors',
    prompt: `Focus on the RUNTIME ERROR path and iteration extremes. Cases: --c 0, -1, -100, -0 (which is 0),
'-0', a very large negative, and the boundary --c 1. Also --c 1 with empty strings. For the error cases,
compare stdout (must be empty), exit code (must be 1) and the FULL stderr byte-for-byte after normalising
/PYI-\\d+/ -> 'PYI-N'. Verify the caret line has exactly 13 leading spaces and 47 carets and that the
Chinese comment text in the source line is reproduced correctly in UTF-8.
Then separately: verify the PBKDF2 class streaming API directly by importing /output/lib/pbkdf2.mjs in a
/tmp script — read(10)+read(10) === read(20); read(1) twenty times === read(20); read(0) returns empty;
read(25)+read(15) spans blocks correctly and equals a single read(40) computed independently; close() then
read() throws. Cross-check a 40-byte and a 100-byte derivation against an independent pure-JS PBKDF2
implementation YOU write from the RFC 8018 definition inside the /tmp script (do NOT use node:crypto).`,
  },
  {
    key: 'perf-and-hygiene',
    prompt: `Two jobs.
(1) PERFORMANCE: time \`node /output/test2.mjs --a p --b s --c 100000\` and confirm it completes in a
reasonable time (well under ~10s). If it is slow, report exactly where the time goes (e.g. HMAC re-keying
per iteration, allocation churn, Buffer<->Uint8Array conversions). Also confirm --c 1000000 does not blow
the stack or leak memory. Compare the digest for --c 100000 against the reference executable.
(2) HYGIENE: verify all the hard rules mechanically with grep/node over /output:
  - no occurrence of the substring 'crypto' anywhere (case-insensitive), in code OR comments
  - no 'require(' and no 'module.exports'
  - no bare/package imports: EVERY import specifier is either relative and ends with '.mjs', or starts with 'node:'
  - every file under /output ends with '.mjs'
  - every .mjs file parses as ESM (\`node --input-type=module --check\` or import it)
  - no leftover debug console.log in lib files
  - no reference to python/spawning python
  - lib/index.mjs actually re-exports a usable surface (import it and assert the names exist)
Report findings precisely with file:line.`,
  },
]

const fuzzResults = await parallel(FUZZ_AREAS.map((a) => () =>
  agent(
    `You are differentially testing a Node.js port against its Python reference.

Reference: /workspace/dataset/test2_executable   (NEVER run \`python\`)
Port:      node /output/test2.mjs
Original Python source: /workspace/dataset/test2.py

The port must be byte-identical on stdout, stderr and exit code (with the two documented normalisations:
the PYI process id, and the prog name).

${a.prompt}

Write your harness under /tmp (NEVER write to /output — you are a tester, not an implementer, and other
testers are running concurrently). Actually RUN it and report REAL observed output. Do not speculate.
If you find mismatches, include the exact invocation (as an argv array), the expected bytes and the actual
bytes. Report honestly — finding zero mismatches is a fine result, inventing them is not.`,
    { label: `fuzz:${a.key}`, phase: 'Fuzz', schema: FUZZ_SCHEMA }
  )
))

const allMismatches = fuzzResults.filter(Boolean).flatMap((r) =>
  (r.mismatches || []).map((m) => ({ ...m }))
)
log(`Fuzzing complete: ${fuzzResults.filter(Boolean).reduce((s, r) => s + (r.casesRun || 0), 0)} cases, ${allMismatches.length} raw mismatches`)

phase('Review')

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          summary: { type: 'string' },
          failureScenario: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['file', 'severity', 'summary', 'failureScenario'],
      },
    },
  },
  required: ['findings'],
}

const LENSES = [
  { key: 'rules', prompt: `Audit ONLY compliance with the hard task rules: ESM-only (no require/module.exports),
every file .mjs, every relative import carries the .mjs suffix, zero npm/external imports (only node: builtins
and local relative files), absolutely no node:crypto reference anywhere (including comments and strings),
no embedded/spawned Python, everything lives under /output, and the library is genuinely SPLIT INTO MULTIPLE
MODULES BY FUNCTIONALITY exposing interfaces via export (a single fat file would be a blocker).
Also check the entry file is /output/test2.mjs. Verify mechanically, then read the files.` },
  { key: 'crypto-correctness', prompt: `Audit ONLY the cryptographic core: /output/lib/hash/sha1.mjs,
/output/lib/hash/hmac.mjs, /output/lib/pbkdf2.mjs. Look for: SHA-1 padding bugs at 55/56/63/64 byte
boundaries, the 64-bit length field (does it handle inputs > 2^32 bits / >512MB, and is it big-endian),
signed-vs-unsigned 32-bit arithmetic (missing >>>0), the message schedule rotate-left, digest() mutating
state so a second digest() differs, HMAC key handling at exactly block_size and above, HMAC copy() sharing
mutable state between clones (aliasing bugs!), PBKDF2 block index encoding (big-endian, 1-based), the XOR
accumulation, and the read() leftover-buffer bookkeeping. For each suspected bug, WRITE A /tmp SCRIPT THAT
PROVES IT and report the observed wrong output. Do not report a bug you could not trigger.` },
  { key: 'argparse-fidelity', prompt: `Audit ONLY /output/lib/argparse.mjs against real argparse behaviour.
Probe /workspace/dataset/test2_executable to establish ground truth for anything you are unsure about, then
check the port. Look for divergence in: help text spacing/column alignment, the ordering of required-missing
vs unrecognized-arguments errors, how '--a=' with an empty value behaves, how a lone '-' is treated, the
negative-number heuristic regex, tokens containing spaces, the empty-string token, repeated options,
error message punctuation, exit codes, and which stream each message goes to. Prove each finding by running
both binaries.` },
  { key: 'codec-and-int', prompt: `Audit ONLY /output/lib/pycodec.mjs and /output/lib/pyint.mjs.
For the codec: is the strict UTF-8 validator actually strict (overlongs, encoded surrogates, >U+10FFFF,
truncated sequences), does it emit exactly one U+DCxx per rejected BYTE and resume at the right offset
(compare against the reference executable's reported error POSITION, which is a code-point index — that is a
strong oracle: craft inputs where a wrong resume offset shifts the reported position), and does
findSurrogateEscape count astral characters as ONE code point (craft an input with an emoji BEFORE an invalid
byte and check the reported position matches the reference).
For pyint: whitespace stripping set, underscore placement rules, Unicode Nd digit value computation for
several non-ASCII blocks, sign handling, huge values, and the pyRepr quoting/escaping rules. Prove findings
against the reference executable.` },
  { key: 'integration', prompt: `Audit the WHOLE thing as a black box user plus a code reader: /output/test2.mjs
and /output/lib/index.mjs. Look for: output written with the wrong newline behaviour, stdout polluted on error
paths, exit codes not set (process.exitCode vs process.exit and truncated async writes), unhandled promise
rejections, a thrown JS TypeError leaking a Node stack trace instead of the Python-style traceback for any
plausible input, the prog name derivation, circular imports between lib modules, and any module that is
imported but unused or exported but broken. Also confirm the barrel index.mjs imports cleanly.
Prove each finding by running something.` },
  { key: 'adversarial', prompt: `You are a hostile reviewer whose goal is to FIND AN INPUT WHERE THE PORT
DISAGREES WITH THE REFERENCE. Ignore code style entirely. Think about what the other reviewers would miss:
pathological lengths, arguments that are themselves valid option strings, values containing NUL-adjacent
bytes, extremely long argv, arguments that look like the prog name, --c values that are huge or have many
underscores, unicode whitespace around --c, strings whose UTF-8 encoding crosses the HMAC block boundary
exactly, salts of length 59..69 (salt+4 bytes crossing the SHA-1 padding boundary), and the /proc/self/cmdline
recovery path (does it still work when the script is invoked via a relative path, via a symlink, from a
different cwd, or with extra node exec args like --no-warnings?). TEST THAT LAST ONE CAREFULLY — it is the
most fragile part of the design and it MUST degrade gracefully, never crash and never mangle normal args.
Report only divergences you actually reproduced, with the exact commands.` },
]

const reviews = await parallel(LENSES.map((l) => () =>
  agent(
    `You are reviewing a Node.js ESM port of a Python program. Be rigorous and evidence-driven.

Reference implementation: /workspace/dataset/test2_executable  (NEVER run \`python\`)
Original source: /workspace/dataset/test2.py
Port under review: /output (entry /output/test2.mjs, library /output/lib/**)

The hard rules the port must satisfy:
- Node 18, ES Modules only, .mjs everywhere, relative imports include the .mjs suffix
- ZERO external/npm dependencies; only node: builtins and local files
- node:crypto is FORBIDDEN entirely (including crypto.pbkdf2 / pbkdf2Sync / createHash / createHmac)
- no embedded or spawned Python
- library split into multiple modules by functionality, interfaces exposed via export
- byte-identical stdout/stderr/exit-code vs the reference, modulo the process id in the
  "[PYI-<pid>:ERROR]" line and the prog name ("test2.mjs" vs "test2_executable")

${l.prompt}

Do NOT edit any file — you are read-only. Scratch scripts go in /tmp only.
Report findings ranked most severe first. An empty findings list is a perfectly good answer if the code is
correct; do not manufacture findings. Every finding must have a concrete reproduced failure scenario.`,
    { label: `review:${l.key}`, phase: 'Review', schema: REVIEW_SCHEMA }
  )
))

const findings = reviews.filter(Boolean).flatMap((r) => r.findings || [])
const blocking = findings.filter((f) => f.severity === 'blocker' || f.severity === 'major')
log(`Review complete: ${findings.length} findings (${blocking.length} blocker/major), plus ${allMismatches.length} fuzz mismatches`)

phase('Fix')

let fixReport = 'no fixes needed'
if (findings.length > 0 || allMismatches.length > 0) {
  fixReport = await agent(
    `${SPEC}

# YOUR ASSIGNMENT: fix the port at /output

A fuzzing pass and a six-lens review pass just ran against /output. Their raw output follows.
Some findings may be WRONG, duplicated, or merely stylistic — you are the final authority. For each one,
first reproduce it yourself against /workspace/dataset/test2_executable, then fix it only if it is real.
Do not "fix" the two legitimate differences (the PYI process id, and the prog name test2.mjs vs
test2_executable).

## Differential fuzz mismatches
${JSON.stringify(allMismatches, null, 2)}

## Review findings
${JSON.stringify(findings, null, 2)}

## Fuzz summaries
${JSON.stringify(fuzzResults.filter(Boolean).map((r) => ({ cases: r.casesRun, summary: r.summary })), null, 2)}

## Integration report
${integrate}

After fixing, RE-VERIFY everything yourself:
- the four given test cases and the RFC 6070 vectors
- a fresh batch of ~100 random (passphrase, salt, iterations) diffs against the reference
- the --help output, the missing-required errors, the invalid-int error, the unrecognized-argument error
- --c 0 and --c -1 tracebacks (normalising the pid)
- an invalid-UTF-8 byte in --a and in --b
- the hygiene sweep: no 'crypto' substring anywhere under /output, no require(/module.exports, all imports
  relative-with-.mjs or node:, all files .mjs
- \`node /output/test2.mjs --a p --b s --c 100000\` finishes quickly and matches the reference

Report: a numbered list of what you changed and why, what you rejected as a false positive and why, and the
final verification results (state clearly if anything still fails).`,
    { label: 'fix', phase: 'Fix' }
  )
}

phase('Fix')
const finalCheck = await agent(
  `Final independent acceptance check of the Node.js port at /output against
/workspace/dataset/test2_executable (NEVER run \`python\`).

You did not write this code and you are not fixing it. Verify and report, with real command output:

1. All four sample cases from /workspace/dataset/test2.py produce the documented digests.
2. 60 fresh random (passphrase, salt, iterations) triples — including unicode and punctuation-heavy
   strings — match the reference on stdout, stderr and exit code (spawnSync with an argv array).
3. --help, no-args, missing-one-arg, bad-int, unknown-arg, and '--' cases match after normalising the
   prog name.
4. --c 0 and an invalid-UTF-8 byte in --a each match on stderr after normalising /PYI-\\d+/.
5. Hard-rule hygiene: no 'crypto' substring under /output (case-insensitive), no require( / module.exports,
   every import is node:-prefixed or relative ending in .mjs, every file is .mjs, the library is split
   across multiple modules under /output/lib.
6. Print the final file tree of /output with line counts.

Answer with a clear PASS/FAIL per item and the evidence. Be honest — report failures plainly.`,
  { label: 'accept', phase: 'Fix' }
)

return {
  implemented: implResults.filter(Boolean).length,
  fuzzCases: fuzzResults.filter(Boolean).reduce((s, r) => s + (r.casesRun || 0), 0),
  mismatches: allMismatches.length,
  findings: findings.length,
  fixReport,
  finalCheck,
}
