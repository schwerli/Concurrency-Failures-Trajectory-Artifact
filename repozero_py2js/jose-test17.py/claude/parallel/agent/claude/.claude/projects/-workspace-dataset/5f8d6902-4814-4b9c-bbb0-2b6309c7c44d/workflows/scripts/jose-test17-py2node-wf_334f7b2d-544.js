export const meta = {
  name: 'jose-test17-py2node',
  description: 'Build + adversarially verify a pure-ESM Node port of python-jose test17.py into /output',
  phases: [
    { title: 'Foundations', detail: 'one agent per primitive module (bytes, base64url, sha256, hmac, pyjson, pyrepr, errors, pytime, argparse)' },
    { title: 'Assemble', detail: 'jws/jwt/index + entry test17.mjs' },
    { title: 'Verify', detail: 'differential vs reference executable, RFC vectors, repr/json fidelity, compliance scan' },
    { title: 'Repair', detail: 'apply all findings, re-run harness to green' },
    { title: 'Adversarial', detail: 'independent refutation lenses on the final tree' },
    { title: 'Final', detail: 'final repair pass + confirmation' },
  ],
}

const SPEC = `
# MISSION
Port /workspace/dataset/test17.py (Python, uses the python-jose library) to pure Node.js ESM under /output.
The reference implementation is the precompiled executable /workspace/dataset/test17_executable.
Run it freely to observe behaviour: /workspace/dataset/test17_executable --data X --verify_iat true
NEVER run "python"/"python3" to implement logic (probing with python3 for CROSS-CHECKING a repr/json question is allowed only if python3 exists, but the executable is the authority).

# THE PYTHON SOURCE (verbatim)
import argparse
from jose import jwt
import time

parser = argparse.ArgumentParser()
parser.add_argument('--data', type=str, required=True)
parser.add_argument('--verify_iat', type=str, required=True, choices=['true', 'false'])
args = parser.parse_args()

secret = "secret"
payload = {
    "info": args.data,
    "iat": int(time.time())
}
token = jwt.encode(payload, secret)
print(token)

verify_iat = args.verify_iat == 'true'
options = {"verify_iat": verify_iat}
decoded = jwt.decode(token, secret, options=options, algorithms=["HS256"])
print(decoded)

# HARD CONSTRAINTS (violating any one invalidates the whole deliverable)
1. ES Modules only. Use import/export. "require(" and "module.exports" are STRICTLY PROHIBITED anywhere in the output, including inside comments or strings.
2. Every generated file MUST use the .mjs extension. Every relative import MUST include the explicit .mjs suffix.
3. ZERO external/npm dependencies. Do not import anything that is not a local relative ./ or ../ path.
   Do NOT import any node: builtin either (not node:fs, not node:path, not node:util). The program needs none: process, console and globalThis are ambient.
4. ABSOLUTELY FORBIDDEN: the node crypto module in every possible spelling and any Web Crypto access.
   Do not import it, do not reference it, do not even mention its name in a comment or string.
   Also forbidden: globalThis.crypto, crypto.subtle, webcrypto, createHmac, createHash.
   SHA-256 and HMAC MUST be implemented from scratch in plain JavaScript arithmetic (FIPS 180-4 + RFC 2104).
   Do not use Buffer or TextEncoder/TextDecoder for base64 / utf-8 either: implement those by hand in pure JS
   (they are not forbidden, but hand-rolling them is required here so the library is provably self-contained).
5. Do not embed or shell out to Python. Pure JS only.
6. All deliverables live under /output. Scratch/verification scripts go under /workspace/verify (never /output).

# OBSERVED GROUND TRUTH (measured from the reference executable — treat as authoritative)

## stdout for a successful run (exit code 0), exactly two lines, each ending with a newline:
line1 = the compact JWS token
line2 = the Python repr of the decoded claims dict

Example: --data 'iat_data_5' --verify_iat false
  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpbmZvIjoiaWF0X2RhdGFfNSIsImlhdCI6MTc4NjM0MTI1N30.<sig>
  {'info': 'iat_data_5', 'iat': 1786341257}

## Token structure
header  JSON = {"alg":"HS256","typ":"JWT"}   (exactly this byte sequence, key order alg then typ)
payload JSON = {"info":<data>,"iat":<int>}   (insertion order: info first, iat second)
signing input = base64url(headerJSON) + "." + base64url(payloadJSON)
signature = HMAC-SHA256(key="secret" as utf-8 bytes, signing input as ASCII bytes) -> 32 bytes
all three parts base64url encoded, "+"->"-", "/"->"_", trailing "=" padding STRIPPED.
iat = floor(current unix epoch seconds)  == Python int(time.time()).

## JSON serialisation rules (Python json.dumps(obj, separators=(',',':')) with ensure_ascii=True)
- no spaces after ":" or ","
- escapes: backslash -> \\\\ , double quote -> \\" , 0x08 -> \\b , 0x0c -> \\f , 0x0a -> \\n , 0x0d -> \\r , 0x09 -> \\t
- every other char < 0x20 -> \\u00XX (lowercase hex)
- every char > 0x7e -> \\uXXXX (lowercase hex, 4 digits). 0x7f (DEL) IS escaped -> \\u007f
- astral chars are emitted as the UTF-16 surrogate pair, e.g. U+1F600 -> \\ud83d\\ude00
- "/" "<" ">" "&" are NOT escaped
- integers serialise with no decimal point
Measured examples (data -> payload JSON before base64):
  '中文测试'      -> {"info":"\\u4e2d\\u6587\\u6d4b\\u8bd5","iat":...}
  'emoji😀'       -> {"info":"emoji\\ud83d\\ude00","iat":...}
  'a"b'           -> {"info":"a\\"b","iat":...}
  'back\\slash'    -> {"info":"back\\\\slash","iat":...}
  tab inside      -> {"info":"tab\\there","iat":...}
  CR inside       -> {"info":"cr\\rhere","iat":...}
  0x01 inside     -> {"info":"ctrl\\u0001char","iat":...}
  0x07 inside     -> {"info":"bell\\u0007x","iat":...}
  0x7f inside     -> {"info":"del\\u007fchar","iat":...}
  U+200B inside   -> {"info":"zw\\u200bspace","iat":...}
  U+00A0 inside   -> {"info":"nbsp\\u00a0x","iat":...}
  'lt<gt>amp&'    -> {"info":"lt<gt>amp&","iat":...}
  'slash/fwd'     -> {"info":"slash/fwd","iat":...}

## Python dict/str repr rules for line 2 (measured)
- dict: {'k1': v1, 'k2': v2} — braces, key repr, ": ", values joined by ", ", insertion order preserved
- int: plain decimal
- str: normally single-quoted. If the string contains an apostrophe AND no double quote, the repr uses
  double quotes instead:  "it's"  ->  {'info': "it's", ...}
  If it contains both, single quotes are used and the apostrophes are escaped as \\'
- inside a str repr: backslash -> \\\\ ; the enclosing quote char is escaped; 0x0a -> \\n ; 0x0d -> \\r ; 0x09 -> \\t
- any character for which Python str.isprintable() is False is escaped: \\xXX for < 0x100,
  \\uXXXX for < 0x10000, \\UXXXXXXXX for >= 0x10000 (lowercase hex digits)
- str.isprintable() is False exactly for Unicode general categories Cc, Cf, Cs, Co, Cn, Zl, Zp, Zs,
  EXCEPT ASCII space U+0020 which IS printable.
  In JavaScript this is testable with a /u regex using Unicode property escapes, e.g. the character class
  containing \\p{Cc} \\p{Cf} \\p{Cs} \\p{Co} \\p{Cn} \\p{Zl} \\p{Zp} \\p{Zs} — verified to work on this Node 18.
- printable non-ASCII is emitted RAW (not escaped): 中文测试, é, 😀 all appear literally.
Measured examples:
  'it's'          -> {'info': "it's", 'iat': N}
  'a"b'           -> {'info': 'a"b', 'iat': N}
  'back\\slash'    -> {'info': 'back\\\\slash', 'iat': N}
  tab inside      -> {'info': 'tab\\there', 'iat': N}
  newline inside  -> {'info': 'newline\\ninside', 'iat': N}
  CR inside       -> {'info': 'cr\\rhere', 'iat': N}
  0x01 inside     -> {'info': 'ctrl\\x01char', 'iat': N}
  0x07 inside     -> {'info': 'bell\\x07x', 'iat': N}
  0x7f inside     -> {'info': 'del\\x7fchar', 'iat': N}
  U+200B inside   -> {'info': 'zw\\u200bspace', 'iat': N}
  U+00A0 inside   -> {'info': 'nbsp\\xa0x', 'iat': N}
  '中文测试'      -> {'info': '中文测试', 'iat': N}
  'emoji😀'       -> {'info': 'emoji😀', 'iat': N}
  'accént'        -> {'info': 'accént', 'iat': N}

## argparse behaviour (measured, exit code 2 on error, usage+error to STDERR, nothing on stdout)
usage line (single line, no trailing spaces):
usage: test17_executable [-h] --data DATA --verify_iat {true,false}

error line format:
test17_executable: error: <message>

measured messages:
  no args                       -> the following arguments are required: --data, --verify_iat
  only --data abc               -> the following arguments are required: --verify_iat
  only --verify_iat true        -> the following arguments are required: --data
  --verify_iat TRUE             -> argument --verify_iat: invalid choice: 'TRUE' (choose from 'true', 'false')
  --verify_iat ''               -> argument --verify_iat: invalid choice: '' (choose from 'true', 'false')
  --data -abc                   -> argument --data: expected one argument
  --data -- (value missing)     -> argument --data: expected one argument
  trailing positional 'extra'   -> unrecognized arguments: extra
  --unknown 1 appended          -> unrecognized arguments: --unknown 1
  --DATA abc --verify_iat true  -> the following arguments are required: --data   (case sensitive; --DATA is not recognised, but the required-args error is reported first and the unrecognized error is never reached)

--help / -h (exit 0, printed to STDOUT, stderr empty), byte-exact:
usage: test17_executable [-h] --data DATA --verify_iat {true,false}
<blank line>
options:
  -h, --help            show this help message and exit
  --data DATA
  --verify_iat {true,false}
(note: "  -h, --help" is padded so the help text starts at column 25, i.e. 24 chars of prefix;
 --data and --verify_iat have no help text so their lines end right after the metavar; no trailing spaces anywhere)
-h anywhere in argv wins immediately, even with other/invalid args present.

accepted forms (all measured working):
  --data abc --verify_iat true
  --data=abc --verify_iat=true
  unique prefix abbreviations: --dat, --d, --verify_i, --v  (Python argparse allow_abbrev default True)
  a value that looks like a negative number is accepted as a value: --data -5 and --data -1.5 both give info '-5' / '-1.5'
  a bare "-" is accepted as a value: --data -  -> info '-'
  --data=-abc  (the = form accepts a leading dash)
  repeated options: last one wins (--data abc ... --data xyz -> 'xyz')
  order does not matter (--verify_iat=false --data=x works)
rejected: --data -abc (a token starting with - that is NOT a valid negative number is treated as an option, so the value is missing)

standalone "--": it is NOT consumed by anything (no positional arguments are defined). It and every token
after it are treated as positionals and end up in the "unrecognized arguments" list, BUT the
"required arguments" check happens first, so:
  --data abc --verify_iat true --        -> unrecognized arguments: --
  -- --data abc --verify_iat true        -> the following arguments are required: --data, --verify_iat
  --data abc -- --verify_iat true        -> the following arguments are required: --verify_iat
  --data -- --verify_iat true            -> argument --data: expected one argument
(prog name "test17_executable" is hard-coded on purpose so stderr/stdout match the reference byte for byte.)

# MODULE LAYOUT AND EXACT INTERFACES (do not deviate — other agents code against these)
/output/lib/bytes.mjs
  export function utf8Encode(str) -> Uint8Array      // hand-written UTF-8 encoder, astral pairs -> 4 bytes,
                                                     // unpaired surrogate -> U+FFFD bytes (ef bf bd)
  export function utf8Decode(bytes) -> string        // hand-written UTF-8 decoder, invalid -> U+FFFD
  export function latin1Encode(str) -> Uint8Array    // low byte of each code unit
  export function concatBytes(list) -> Uint8Array
  export function bytesEqual(a, b) -> boolean
/output/lib/base64url.mjs
  export function base64UrlEncode(bytes) -> string   // unpadded, -_ alphabet
  export function base64UrlDecode(str) -> Uint8Array // tolerates missing padding and -_ or +/
  export function base64UrlEncodeText(str) -> string
/output/lib/sha256.mjs
  export const SHA256_BLOCK_SIZE = 64
  export const SHA256_DIGEST_SIZE = 32
  export function sha256(bytes) -> Uint8Array(32)    // FIPS 180-4 from scratch, correct for any length
/output/lib/hmac.mjs
  export function hmacSha256(keyBytes, messageBytes) -> Uint8Array(32)   // RFC 2104
  export function constantTimeEqual(a, b) -> boolean
/output/lib/pyjson.mjs
  export function pyJsonDumpsCompact(value) -> string   // json.dumps(...,separators=(',',':')) equivalent
  export function pyJsonLoads(text) -> value            // hand-written JSON parser.
      // objects MUST be returned as Map instances so key insertion order is preserved exactly
      // (a plain JS object reorders integer-like keys, which would corrupt the dict repr)
      // numbers: return an integer Number when the JSON literal has no fraction/exponent, else a float Number.
      // Tag floats so pyRepr can tell 1.0 from 1 — use the exported helper below.
  export function isJsonInteger(value) -> boolean        // helper used by pyRepr for int vs float
/output/lib/pyrepr.mjs
  export function pyRepr(value) -> string      // Map/object -> dict, string -> str repr, number, boolean
                                               // (True/False), null/undefined -> None, Array -> list
  export function pyReprString(str) -> string
  export function pyIsPrintable(codePointString) -> boolean
/output/lib/errors.mjs
  export class JOSEError extends Error
  export class JWSError extends JOSEError
  export class JWSSignatureError extends JWSError
  export class JWSAlgorithmError extends JWSError
  export class JWTError extends JOSEError
  export class JWTClaimsError extends JWTError
  export class ExpiredSignatureError extends JWTError
  (each sets this.name to the class name; keep messages in python-jose wording)
/output/lib/pytime.mjs
  export function timeTime() -> number        // float seconds since epoch
  export function pyInt(value) -> number      // Python int() truncation toward zero
/output/lib/argparse.mjs
  export class ArgumentParser {
    constructor({ prog } = {})
    addArgument(optionStrings, { type, required, choices, help, dest, metavar, action } = {})
    parseArgs(argv)          // argv WITHOUT node and script path; returns a plain namespace object
    formatUsage() / formatHelp()
    error(message)           // usage+error to stderr then process.exit(2)
    exitWithHelp()           // help to stdout then process.exit(0)
  }
  Must reproduce every argparse behaviour listed in the ground-truth section above.
/output/lib/jws.mjs
  export function sign(payload, key, { headers = null, algorithm = 'HS256' } = {}) -> string
  export function verify(token, key, algorithms, { verify = true } = {}) -> Uint8Array  // returns raw payload bytes
  export function getUnverifiedHeader(token) -> Map
  export function getUnverifiedClaims(token) -> Uint8Array
  // payload may be a Map/object (serialised with pyJsonDumpsCompact) or raw bytes/string
  // header is built as {"alg":<algorithm>,"typ":"JWT"} in that exact key order
  // only HS256 is supported; anything else throws JWSAlgorithmError('Algorithm not supported.')
/output/lib/jwt.mjs
  export const DEFAULT_OPTIONS   // mirror python-jose: verify_signature, verify_aud, verify_iat, verify_exp,
                                 // verify_nbf, verify_iss, verify_sub, verify_jti, verify_at_hash all true,
                                 // require_* false, leeway 0
  export function encode(claims, key, algorithm = 'HS256', headers = null, accessToken = null) -> string
  export function decode(token, key, { algorithms = null, options = null, audience = null, issuer = null,
                                        subject = null, accessToken = null } = {}) -> Map
  // decode: split, verify signature via jws.verify with the allowed algorithms, parse claims with
  // pyJsonLoads (Map), then run claim validation honouring the merged options
  // (verify_iat: iat must be an integer else JWTClaimsError('Issued At claim (iat) must be an integer.');
  //  exp/nbf/aud/iss/sub/jti/at_hash validators in python-jose wording, each skippable by its option flag)
/output/lib/index.mjs
  re-export the public surface (jwt, jws, errors, pyRepr, ArgumentParser)
/output/test17.mjs
  the entry point: mirrors the Python script line for line, prints exactly two lines via console.log

# STYLE
Clear, commented, production-quality JS. No TypeScript syntax. Small focused functions.
Keep the Chinese comments from the original script where they annotate the same lines (they document intent).
`

log('Spec locked from live probing of the reference executable. Building 9 primitive modules in parallel.')

const FILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'exports', 'notes'],
  properties: {
    path: { type: 'string', description: 'absolute path written' },
    exports: { type: 'array', items: { type: 'string' }, description: 'exported names' },
    notes: { type: 'string', description: 'implementation notes / anything the integrator must know' },
  },
}

phase('Foundations')

const MODULES = [
  {
    file: '/output/lib/bytes.mjs',
    task: `Implement the byte/UTF-8 helpers module. Hand-write the UTF-8 encoder and decoder with bit arithmetic
(no Buffer, no TextEncoder, no TextDecoder). Handle: 1-byte ASCII, 2/3-byte sequences, astral code points via
surrogate pairs -> 4 bytes, unpaired surrogates -> the U+FFFD replacement bytes. Decoder must reject overlong /
truncated sequences by emitting U+FFFD. Include a short doc comment per export.`,
  },
  {
    file: '/output/lib/base64url.mjs',
    task: `Implement base64url encode/decode by hand (build the alphabet string, do the 3-byte -> 4-char grouping
with shifts, strip = padding on encode; on decode accept both -_ and +/ and any amount of missing padding, and
throw on characters outside the alphabet). Import utf8Encode from ./bytes.mjs for base64UrlEncodeText.`,
  },
  {
    file: '/output/lib/sha256.mjs',
    task: `Implement SHA-256 exactly per FIPS 180-4 in plain JS: the 64 round constants, the initial hash values,
message schedule with sigma0/sigma1, compression loop with Ch/Maj/Sigma0/Sigma1, big-endian length padding
(0x80 then zeros then a 64-bit big-endian bit length, using Math.floor for the high word so messages > 512MB
would still be right), all arithmetic forced to unsigned 32-bit with >>> 0. Return a Uint8Array of 32 bytes.
Self-check mentally against the known digests: empty string ->
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ; "abc" ->
ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ; and the 448-bit boundary case
"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq" ->
248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1 .
Do not import anything except (optionally) ./bytes.mjs.`,
  },
  {
    file: '/output/lib/hmac.mjs',
    task: `Implement HMAC per RFC 2104 on top of sha256 from ./sha256.mjs: key longer than the 64-byte block is
hashed first, shorter keys are zero-padded, ipad 0x36 / opad 0x5c, digest = H((K^opad) || H((K^ipad) || msg)).
Also export constantTimeEqual(a, b) that compares two Uint8Arrays with an accumulating XOR (length-checked first).
Verify against RFC 4231 test case 1: key = 20 bytes of 0x0b, data = "Hi There", HMAC-SHA256 =
b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7 . Import concatBytes/utf8Encode from ./bytes.mjs
if useful. Absolutely no built-in crypto of any kind.`,
  },
  {
    file: '/output/lib/pyjson.mjs',
    task: `Implement the Python-compatible JSON layer: pyJsonDumpsCompact (json.dumps with separators=(',',':')
and ensure_ascii=True semantics — see the escape table in the spec, note 0x7f IS escaped as \\u007f and that
astral chars come out as two \\uXXXX surrogate escapes because you iterate UTF-16 code units) and a hand-written
recursive-descent pyJsonLoads that returns Map for objects (order preserving), Array for arrays, string, number,
true/false/null. Track integer-ness: expose isJsonInteger(value) so pyRepr can distinguish Python int from float —
implement it by returning plain Numbers for integers and wrapping float literals in a small exported marker class
OR by keeping a WeakSet/registry of float values; whatever you choose, document it clearly in the notes field and
make isJsonInteger work for plain integer Numbers too (Number.isInteger). Serialiser must accept Map, plain object,
Array, string, number, boolean, null. Throw a clear Error on unsupported types and on malformed JSON input.`,
  },
  {
    file: '/output/lib/pyrepr.mjs',
    task: `Implement Python repr emulation. pyReprString must reproduce CPython's unicode_repr exactly:
choose the quote character (single quote by default; double quote when the string contains a single quote and no
double quote; when it contains both, use single quotes and escape the single quotes with a backslash), escape the
backslash, escape the chosen quote char, map 0x09/0x0a/0x0d to \\t/\\n/\\r, and escape every non-printable code
point as \\xXX (< 0x100) / \\uXXXX (< 0x10000) / \\UXXXXXXXX (>= 0x10000) with lowercase hex.
Printability: iterate by CODE POINT (for..of), and treat a code point as non-printable when it matches the
Unicode general categories Cc, Cf, Cs, Co, Cn, Zl, Zp, Zs — with ASCII space U+0020 forced printable. Use a
single cached /u RegExp with Unicode property escapes for this (verified available on this Node 18); if a
category escape is unsupported at runtime, fall back gracefully rather than throwing at import time.
pyRepr must render: Map and plain object as a Python dict {'k': v, ...} with ", " between items and ": " after
keys, Array as a list [a, b], string via pyReprString, boolean as True/False, null/undefined as None, integer
Numbers as plain decimals, and non-integer numbers with Python float repr semantics (shortest round-trip, always
containing a "." or "e", e.g. 1.0 -> "1.0"). Import isJsonInteger from ./pyjson.mjs only if you need it and it
does not create a cycle — prefer keeping pyrepr.mjs dependency-free.`,
  },
  {
    file: '/output/lib/errors.mjs',
    task: `Implement the python-jose exception hierarchy as ES classes with the exact names and inheritance from
the spec. Each constructor takes an optional message, calls super, and sets this.name to the class name.
Keep python-jose's message wording as static defaults where it has one (e.g. JWSSignatureError -> 'Signature
verification failed.'). No imports at all.`,
  },
  {
    file: '/output/lib/pytime.mjs',
    task: `Implement timeTime() returning Date.now() / 1000 as a float (the Python time.time() analogue) and
pyInt(value) implementing Python int() truncation toward zero (Math.trunc, with a guard that rejects NaN/Infinity
the way Python raises for those). Also export a small helper nowEpochSeconds() = pyInt(timeTime()). No imports.`,
  },
  {
    file: '/output/lib/argparse.mjs',
    task: `Implement the argparse subset. This is the highest-risk module: reproduce EVERY behaviour in the
ground-truth argparse section byte for byte. Requirements:
- prog defaults to 'test17_executable' (hard-coded to match the reference binary's stderr/stdout exactly);
  allow overriding via the constructor.
- an automatic -h/--help action that prints formatHelp() to stdout and exits 0, and that wins as soon as it is
  seen, before any validation of other arguments.
- usage line: "usage: <prog> [-h] --data DATA --verify_iat {true,false}" — build it generically from the
  registered actions: optional actions in registration order, [-h] bracketed because it is not required,
  required options unbracketed, metavar defaults to the dest upper-cased, choices render as {a,b} joined by ",".
- help body: a blank line, then "options:", then one line per action, two spaces of indent; the help text column
  starts at offset 24 (so "  -h, --help" is padded with spaces to width 24 then the help string); when an action
  has no help text the line ends immediately after the invocation, with NO trailing whitespace.
- "=" form, unique-prefix abbreviation (allow_abbrev), last-occurrence-wins, order independence.
- a token starting with "-" is a value rather than an option when it parses as a negative number
  (mirror argparse's _negative_number_matcher, i.e. /^-\\d+$|^-\\d*\\.\\d+$/, and only when no registered option
  string looks like a negative number) or when it is exactly "-".
- standalone "--": mark it and everything after it as positional-ish tokens that are NOT consumed by any option
  and end up in the unrecognized list, and remember that the "required" check is reported BEFORE the
  "unrecognized arguments" check.
- errors: print formatUsage() then "<prog>: error: <message>" to stderr and exit(2). Messages exactly:
  "the following arguments are required: --data, --verify_iat" (registration order, ", " separator),
  "argument --verify_iat: invalid choice: 'X' (choose from 'true', 'false')" (repr-quoted value, choices each
  wrapped in single quotes, joined by ", "),
  "argument --data: expected one argument",
  "unrecognized arguments: extra" / "unrecognized arguments: --unknown 1" (space separated),
  "ambiguous option: --xy could match --xyz, --xyw" for ambiguous abbreviations (unreachable here, implement anyway).
- write to stdout/stderr with process.stdout.write / process.stderr.write so no extra newline creeps in, and
  exit via process.exit.
- import pyReprString from ./pyrepr.mjs to quote values in the invalid-choice message the way Python does.
Run the reference executable to double-check each message you emit.`,
  },
]

const foundations = await parallel(MODULES.map((m) => () =>
  agent(
    SPEC + `

# YOUR ASSIGNMENT
Write EXACTLY ONE file: ` + m.file + `
No other agent may touch it and you must not create or modify any other file under /output.
` + m.task + `

Write the file with the Write tool. You may create scratch test scripts under /workspace/verify/ to sanity-check
your module (name them so they cannot collide: use your module's basename as a prefix) and run them with node.
Return the structured summary.`,
    { label: 'build:' + m.file.split('/').pop(), phase: 'Foundations', schema: FILE_SCHEMA }
  )
))

const built = foundations.filter(Boolean)
log('Foundations written: ' + built.length + '/' + MODULES.length + ' modules.')

phase('Assemble')

const assembled = await parallel([
  () => agent(
    SPEC + `

# YOUR ASSIGNMENT
The primitive modules under /output/lib/ already exist (bytes, base64url, sha256, hmac, pyjson, pyrepr, errors,
pytime, argparse). READ them first to learn their real signatures, then write EXACTLY these three files:
  /output/lib/jws.mjs
  /output/lib/jwt.mjs
  /output/lib/index.mjs
Do not modify any other file. If a primitive module has a bug or a signature that does not match the spec,
do NOT edit it — report it in the notes field instead and code defensively around it only if trivial.

jws.mjs: compact JWS serialisation. sign() builds the header Map in the order alg then typ, serialises both
header and payload with pyJsonDumpsCompact, base64url encodes them, HMACs the ASCII signing input with the
utf-8 bytes of the key, and joins with dots. verify() splits into 3 parts, base64url-decodes the header, checks
that the header alg is present, is HS256, and is in the caller-supplied allowed algorithms list (throw
JWSError('The specified alg value is not allowed') when it is not, matching python-jose), recomputes the HMAC
and compares with constantTimeEqual, throwing JWSSignatureError('Signature verification failed.') on mismatch;
malformed tokens throw JWSError('Not enough segments'). Return the raw payload bytes.

jwt.mjs: encode()/decode() with the DEFAULT_OPTIONS map and claim validators as specified. decode() must merge
caller options over the defaults, verify the signature (unless verify_signature is false), parse the claims with
pyJsonLoads into a Map, require the claims to be a JSON object (JWTError('Invalid payload string: must be a json
object')), then validate exp, nbf, iat, aud, iss, sub, jti, at_hash — each gated on its option flag and each
raising the python-jose error type with python-jose wording. verify_iat=true must require iat to be an integer.
Missing claims are simply skipped (not an error) unless a require_* flag is set.

index.mjs: a thin barrel that re-exports the public surface: a jwt namespace object, a jws namespace object, the
error classes, pyRepr, and ArgumentParser. Use explicit named re-exports (export { ... } from './x.mjs') plus
"export * as jwt from './jwt.mjs'" style aggregation as appropriate. No side effects.

Then prove it works end to end from a scratch script under /workspace/verify/ (not /output): build a token for
data 'iat_data_5' and compare your signature against the reference executable run with the same data — note the
iat differs between runs, so instead verify by decoding: take a FULL token produced by the reference executable
(run it now) and feed it to your jws.verify with key 'secret'; it must verify. That is the real cross-check that
your HMAC is correct.
Return the structured summary.`,
    { label: 'build:jws+jwt+index', phase: 'Assemble', schema: FILE_SCHEMA }
  ),
  () => agent(
    SPEC + `

# YOUR ASSIGNMENT
Write EXACTLY ONE file: /output/test17.mjs — the entry point. Do not modify anything else.
The sibling modules live in ./lib/. READ /output/lib/argparse.mjs, /output/lib/pyrepr.mjs and (if they exist yet)
/output/lib/jwt.mjs to match the real signatures; if jwt.mjs is not written yet, code against the interface in
the spec exactly.

It must mirror the Python script one statement at a time:
  build the ArgumentParser, add --data (type str, required) and --verify_iat (type str, required,
  choices ['true','false']), parse process.argv.slice(2),
  secret = 'secret',
  claims = ordered Map with 'info' -> args.data then 'iat' -> pyInt(timeTime()),
  token = jwt.encode(claims, secret),
  console.log(token),
  verifyIat = args.verify_iat === 'true',
  options = { verify_iat: verifyIat },
  decoded = jwt.decode(token, secret, { options, algorithms: ['HS256'] }),
  console.log(pyRepr(decoded)).
Keep the original Chinese comments on the corresponding lines.
Add a top-of-file header comment describing the port, and a guard so uncaught JOSE errors surface the way an
uncaught Python exception would (message to stderr, non-zero exit) — but do NOT swallow anything that should
have been a clean success.
Return the structured summary.`,
    { label: 'build:test17.mjs', phase: 'Assemble', schema: FILE_SCHEMA }
  ),
])

log('Assembly done. Running verification fan-out.')

phase('Verify')

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'findings'],
  properties: {
    pass: { type: 'boolean' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'problem', 'evidence', 'fix'],
        properties: {
          file: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string', description: 'exact command + expected vs actual output' },
          fix: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
        },
      },
    },
  },
}

const VERIFIERS = [
  {
    key: 'diff-happy',
    task: `Differential test the happy path. Write /workspace/verify/diff_happy.sh (or .mjs) that, for at least
40 different --data values (including the sample cases iat_data_1/5/8/19, empty string, spaces, quotes, both
quote types together, backslashes, tabs/newlines/CR, control bytes 0x01 and 0x07 and 0x7f, U+00A0, U+200B,
Chinese, accented latin, an emoji, a 3000-char string, '-5', '-', 'a=b', JSON-looking text, and a string
containing both an apostrophe and a double quote) and for both --verify_iat values, runs BOTH
  /workspace/dataset/test17_executable --data "$V" --verify_iat "$F"
  node /output/test17.mjs --data "$V" --verify_iat "$F"
and compares. IMPORTANT: the iat second changes between the two runs, so compare like this: (a) line 2 must match
exactly after normalising the integer that follows "'iat': " — and additionally check that both programs, when
given the SAME iat, produce the SAME token: do that by decoding the reference token's payload, extracting its iat,
and re-signing with your library through a tiny harness that lets you inject the iat (import jwt from
/output/lib/jwt.mjs directly and encode a Map with the same info and the same iat) — the resulting token string
must be byte-identical to the reference token. Also assert exit codes match and stderr is empty for both.
Report every mismatch with the exact reproducing command.`,
  },
  {
    key: 'diff-cli',
    task: `Differential test argument parsing and error paths ONLY. For at least 25 argv vectors — no args,
each single missing option, invalid choices ('TRUE','1','','yes'), --help, -h alone, -h combined with valid and
invalid args, unknown options, trailing positionals, '=' forms, abbreviations (--dat/--d/--verify_i/--v),
repeated options, reversed order, --data -5, --data -1.5, --data -, --data -abc, --data=-abc, standalone -- in
the three positions from the spec, and --DATA — run the reference executable and node /output/test17.mjs and
compare stdout, stderr and exit code byte for byte (for successful runs, normalise the iat integer and the
signature, since those legitimately differ between runs; for error/help runs everything must match exactly).
Use printf %q or a JS array-based spawn so argv is passed exactly. Report every byte-level difference.`,
  },
  {
    key: 'primitives',
    task: `Verify the cryptographic and encoding primitives against published test vectors, from a scratch
script under /workspace/verify/. SHA-256: empty, "abc", the 55/56/57/63/64/65-byte boundary lengths, the
"abcdbcde...nopq" 448-bit vector, 1000000 'a' characters (expect
cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0), and a few random byte arrays of length
0..200 cross-checked for self-consistency (same input twice, avalanche on a 1-bit flip). HMAC-SHA256: RFC 4231
test cases 1 through 7 (including the 131-byte oversized keys in cases 6 and 7). base64url: round-trip all byte
lengths 0..64, the -_ alphabet appears for the right inputs, no padding on output, decode tolerates missing
padding, and cross-check a couple of values against the base64url segments of a token produced by the reference
executable. UTF-8: round-trip ASCII, 2/3/4-byte sequences, an unpaired surrogate, and every code point in a
sample set; confirm the byte lengths are what UTF-8 requires. Do NOT use any built-in crypto or Buffer/TextEncoder
in the ASSERTIONS either — hard-code the expected hex strings. Report any failure.`,
  },
  {
    key: 'json-repr',
    task: `Verify pyJsonDumpsCompact and pyRepr against the reference executable, from a scratch script under
/workspace/verify/. Method: for ~30 tricky data strings, run the reference executable, base64url-decode the
token's payload segment yourself (write your own decoder in the test, or reuse /output/lib/base64url.mjs) to get
the EXACT payload JSON bytes Python produced, and compare with pyJsonDumpsCompact of the equivalent Map; and
compare line 2 of the reference stdout with pyRepr of the equivalent Map (normalising only the iat integer).
Cover: both quote types (separately and together, to exercise the quote-selection rule), backslashes, all of
\\b \\f \\n \\r \\t, control bytes 0x00 0x01 0x07 0x0b 0x1f 0x7f, U+0085, U+00A0, U+00AD, U+061C, U+200B,
U+2028, U+2029, U+3000, a private-use char U+E000, an unassigned char, a surrogate-adjacent astral char,
CJK, Hangul, RTL Arabic/Hebrew, combining marks, and an emoji ZWJ sequence. Note 0x00 may be impossible to pass
through argv — if so, exercise it through pyJsonDumpsCompact/pyRepr directly and state the expected value from
the documented rules instead. Report every mismatch.`,
  },
  {
    key: 'compliance',
    task: `Static compliance audit of everything under /output. Verify, and report a finding for each violation:
(1) every file ends in .mjs; (2) no occurrence of "require(" or "module.exports" anywhere; (3) every import
specifier is a relative path ending in .mjs — no bare specifiers, no node: prefixed builtins at all;
(4) NO reference anywhere (code, comment, string, filename) to the node crypto module or Web Crypto — grep
case-insensitively for crypt, subtle, createHash, createHmac, webcrypto and report anything that surfaces;
(5) no Buffer, TextEncoder, TextDecoder, atob or btoa usage; (6) no python/python3 invocation, no child process
spawning, no fs access in the shipped code; (7) top-level await / syntax parses under node 18 — prove it by
running "node --check" on every file; (8) no unused imports, no dead exports that the spec did not ask for;
(9) /output contains no scratch/test/debug files beyond the specified library modules and test17.mjs, and no
package.json is required for .mjs to work (confirm by running the entry point). List the final file tree in the
summary.`,
  },
  {
    key: 'lib-quality',
    task: `Read every file under /output and review it as a senior reviewer for correctness bugs that the other
verifiers' black-box tests would MISS. Focus on: 32-bit overflow or sign errors in SHA-256 (especially the
length padding for messages where byteLength*8 exceeds 2^32, and the >>> 0 discipline), HMAC key handling for
keys exactly 64 bytes and longer than 64 bytes, base64url decode of inputs whose length mod 4 is 1 (invalid —
must throw), the JSON parser's handling of escaped surrogate pairs / nested structures / duplicate keys / numbers
like -0 and 1e3 and 1.0, the repr code-point iteration (must iterate code points not UTF-16 units, and must emit
\\UXXXXXXXX with 8 digits for astral non-printables), the argparse abbreviation and negative-number heuristics,
off-by-one in the help column padding, and any place where a Map was silently converted to a plain object
(which would destroy key order). Also confirm the modules are genuinely hierarchical (no cycles) — draw the
import graph in your summary. Report concrete defects with the exact line and a minimal failing input; do not
report style nits.`,
  },
]

const verifyResults = await parallel(VERIFIERS.map((v) => () =>
  agent(
    SPEC + `

# YOUR ASSIGNMENT — VERIFY ONLY, DO NOT EDIT /output
` + v.task + `

You are a verifier: you may create and run scripts under /workspace/verify/ (prefix filenames with "` + v.key + `_"
so you cannot collide with other agents) and you may READ anything, but you MUST NOT write to or modify any file
under /output. Report findings for the repair agent instead. Be concrete: every finding needs a copy-pasteable
reproduction. If everything passes, say so and set pass=true.`,
    { label: 'verify:' + v.key, phase: 'Verify', schema: FINDINGS_SCHEMA }
  )
))

const allFindings = verifyResults.filter(Boolean).flatMap((r, i) =>
  (r.findings || []).map((f) => ({ ...f, source: VERIFIERS[i] ? VERIFIERS[i].key : 'unknown' }))
)
log('Verification produced ' + allFindings.length + ' finding(s) across ' + verifyResults.filter(Boolean).length + ' verifiers.')

phase('Repair')

let repairReport = 'no repairs needed'
if (allFindings.length > 0) {
  repairReport = await agent(
    SPEC + `

# YOUR ASSIGNMENT — REPAIR
Six independent verifiers audited /output. Here are their findings as JSON:

` + JSON.stringify(allFindings, null, 2) + `

And their summaries:

` + JSON.stringify(verifyResults.filter(Boolean).map((r) => ({ pass: r.pass, summary: r.summary })), null, 2) + `

You own every file under /output now. For each finding: reproduce it first, then fix the ROOT CAUSE in the right
module (do not paper over it in the entry point), then re-verify. Some findings may be wrong — if you conclude a
finding is invalid, say so with evidence rather than making a change that breaks fidelity with the reference
executable. The reference executable is always the tie-breaker: /workspace/dataset/test17_executable.

After fixing, run a full differential regression yourself:
- the four sample cases from the Python file's comment block (data iat_data_5/8/1/19) — token shape and
  line 2 must match the documented format
- at least 30 adversarial --data values plus every CLI error path in the spec, comparing stdout/stderr/exit code
  against the reference (normalising only the iat integer and the signature for successful runs, and additionally
  proving byte-identical tokens by re-signing the reference token's own payload iat through your library)
- node --check on every .mjs file
- a grep proving no forbidden crypto/require/bare-import/Buffer references remain
Leave /workspace/verify/regress.mjs behind as the reusable harness (it must exit non-zero on any mismatch).
Report what you changed and paste the final regression summary.`,
    { label: 'repair', phase: 'Repair' }
  )
}

phase('Adversarial')

const LENSES = [
  {
    key: 'refute-fidelity',
    prompt: `Try to REFUTE the claim: "node /output/test17.mjs is byte-for-byte behaviourally identical to
/workspace/dataset/test17_executable for every input either program can receive." Hunt for ANY input where they
differ: exotic argv shapes, unicode extremes, extremely long values, values that stress the negative-number
heuristic (-0, -.5, -1e3, --0, -1abc), abbreviation collisions, '=' with an empty value (--data=), repeated
'--verify_iat=true --verify_iat=false', -h in weird positions, multibyte characters split across a 64-byte SHA
block boundary (construct data whose signing input length hits exactly 55/56/63/64/65/119/120 bytes), and a
payload large enough to exercise multi-block hashing. Default to "refuted" if you find a real difference; be
precise about which side is wrong. Run both binaries — do not speculate.`,
  },
  {
    key: 'refute-crypto',
    prompt: `Try to REFUTE the claim: "the deliverable contains no use of, and no reference to, Node's crypto
module or any Web Crypto API, and implements SHA-256/HMAC from scratch." Audit adversarially: grep for obfuscated
or partial spellings, dynamic import(), string concatenation that could build a module name, globalThis lookups,
Buffer/atob/btoa, and any indirect hashing helper. Then independently confirm the hand-written SHA-256 really is
SHA-256 by checking three published digests you type in yourself. Report anything suspicious as refuted.`,
  },
  {
    key: 'refute-esm',
    prompt: `Try to REFUTE the claim: "the deliverable is valid, hierarchical, dependency-free ESM that runs on
this Node 18 with no package.json, no npm install, and no bare imports." Check: file extensions, every import
specifier's suffix, absence of require/module.exports, absence of __dirname/__filename, no import.meta.url misuse,
no circular imports (build the real graph), no top-level side effects other than in test17.mjs, every documented
export actually exported, and that copying /output to a fresh empty directory and running it there still works
(actually do this: copy to /tmp and run). Report anything that fails as refuted.`,
  },
  {
    key: 'refute-repr',
    prompt: `Try to REFUTE the claim: "pyRepr reproduces CPython's repr() and pyJsonDumpsCompact reproduces
json.dumps(separators=(',',':')) for every string that can reach them." Attack the printability table
(categories Cc Cf Cs Co Cn Zl Zp Zs, ASCII space exception), the quote-selection rule, astral escaping in both
directions (\\UXXXXXXXX in repr vs surrogate pairs in JSON), soft hyphen U+00AD, U+2028/U+2029, U+FEFF, tag
characters U+E0001, variation selectors, unassigned code points, and characters right at category boundaries.
Verify every disputed character against the reference executable itself (pass it through --data and read both
the decoded payload segment and line 2). Report each real mismatch as refuted.`,
  },
  {
    key: 'completeness',
    prompt: `You are the completeness critic. Do not look for bugs the others already found — look for what is
MISSING: a requirement in the task brief that nothing in /output satisfies, a module the spec asked for that was
not created, an interface that drifted from the documented contract, a behaviour of the reference executable that
nobody tested, a file in /output that should not ship, missing doc comments, or a claim in the build agents'
notes that was never verified. Re-read the brief in this prompt line by line and check each requirement against
the actual tree. Output the gaps as findings.`,
  },
]

const adversarial = await parallel(LENSES.map((l) => () =>
  agent(
    SPEC + `

# YOUR ASSIGNMENT — ADVERSARIAL AUDIT (READ ONLY, do not modify /output)
` + l.prompt + `

You may create scripts under /workspace/verify/ prefixed with "` + l.key + `_" and run them. Do not modify /output.
Set pass=false and list findings if you refuted anything; pass=true only if the claim genuinely survived your
best attack. Every finding needs a copy-pasteable reproduction.`,
    { label: 'adv:' + l.key, phase: 'Adversarial', schema: FINDINGS_SCHEMA }
  )
))

const advFindings = adversarial.filter(Boolean).flatMap((r, i) =>
  (r.findings || []).map((f) => ({ ...f, source: LENSES[i] ? LENSES[i].key : 'unknown' }))
)
log('Adversarial pass produced ' + advFindings.length + ' finding(s).')

phase('Final')

let finalReport = 'no final repairs needed'
if (advFindings.length > 0) {
  finalReport = await agent(
    SPEC + `

# YOUR ASSIGNMENT — FINAL REPAIR AND SIGN-OFF
Five adversarial auditors attacked the deliverable. Their findings:

` + JSON.stringify(advFindings, null, 2) + `

Their summaries:

` + JSON.stringify(adversarial.filter(Boolean).map((r) => ({ pass: r.pass, summary: r.summary })), null, 2) + `

Fix every VALID finding at its root cause. Reject invalid ones explicitly with evidence (the reference
executable /workspace/dataset/test17_executable is the tie-breaker; fidelity to it beats theoretical purity,
EXCEPT that the hard constraints — ESM/.mjs/no-npm/no-builtin-crypto/no-Buffer — can never be traded away).

Then run the full regression harness /workspace/verify/regress.mjs (create it if the repair agent did not) and
make it green, and finish with this exact final checklist, reporting the real command output for each item:
1. the four documented sample cases produce the documented token header/payload shape and line-2 format
2. token byte-identity vs the reference proven by re-signing the reference token's own payload
3. every CLI error path matches stdout/stderr/exit code exactly
4. node --check passes on every .mjs file
5. grep proves zero forbidden references (crypto/subtle/createHash/createHmac/require(/module.exports/Buffer/
   TextEncoder/bare imports)
6. /output tree listing with a one-line purpose per file
Report the final state honestly — if something still does not match, say exactly what.`,
    { label: 'final-repair', phase: 'Final' }
  )
}

return {
  modulesBuilt: built.map((b) => b.path),
  assembled: assembled.filter(Boolean).map((a) => a.path),
  verifyPassed: verifyResults.filter(Boolean).map((r, i) => ({ key: VERIFIERS[i] && VERIFIERS[i].key, pass: r.pass })),
  findingsFromVerify: allFindings.length,
  repairReport,
  adversarialPassed: adversarial.filter(Boolean).map((r, i) => ({ key: LENSES[i] && LENSES[i].key, pass: r.pass })),
  findingsFromAdversarial: advFindings.length,
  finalReport,
}
