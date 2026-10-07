export const meta = {
  name: 'pyaes-cbc-py2js-migration',
  description: 'Migrate the pyaes AES-CBC Python CLI (test7.py) to a zero-dependency Node.js ESM library + entry point in /output, then differentially verify against the reference executable',
  phases: [
    { title: 'Spec' },
    { title: 'Implement' },
    { title: 'Integrate' },
    { title: 'Verify' },
    { title: 'Audit' },
    { title: 'Fix' },
  ],
}

const RULES = `
=== MISSION CONTEXT (read carefully) ===
We are porting a Python CLI to Node.js. Source: /workspace/dataset/pyaes/test7.py
Reference oracle executable (ALWAYS available, run it freely to probe behavior):
  /workspace/dataset/test7_executable --key K --iv I --data1 D1 --data2 D2
DO NOT run 'python' — it is unavailable. Only run the executable.

The Python source is:
---------------------------------------------
import argparse
import pyaes

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--key', type=str, required=True)  # 16 bytes key
    parser.add_argument('--iv', type=str, required=True)   # 16 bytes IV
    parser.add_argument('--data1', type=str, required=True) # 16 bytes data
    parser.add_argument('--data2', type=str, required=True) # 16 bytes data
    args = parser.parse_args()

    aes = pyaes.AESModeOfOperationCBC(args.key.encode(), args.iv.encode())
    ciphertext1 = aes.encrypt(args.data1.encode())
    ciphertext2 = aes.encrypt(args.data2.encode())
    print(ciphertext1)
    print(ciphertext2)

if __name__ == '__main__':
    main()
---------------------------------------------

=== HARD REQUIREMENTS (violating any of these invalidates the whole answer) ===
1. Pure JavaScript for Node.js (target runtime is Node v18.19.1 — no top-level features newer than that).
2. ES Modules ONLY. Use 'import' / 'export'. 'require()' and 'module.exports' are STRICTLY PROHIBITED anywhere.
3. Every generated file MUST use the .mjs extension. Every relative import MUST include the full './x.mjs' suffix.
4. ZERO external dependencies. No npm packages. import ONLY local files (relative paths). Node built-ins are allowed
   ONLY via the 'node:' prefix (node:process, node:path, node:url are fine).
5. ABSOLUTELY FORBIDDEN: node:crypto in any form. Do not import it, do not reference createCipheriv / Cipher /
   Decipher / webcrypto / subtle. The string "crypto" must not appear as a module specifier anywhere.
   AES must be implemented from scratch in pure JS.
6. No embedding/spawning Python. No child_process to do the real work.
7. All deliverable code goes under /output. Library modules in /output/lib/, entry point at /output/test7.mjs.
8. Argument parsing must be hand-written from process.argv (no argparse/yargs/minimist).

=== VERIFIED ORACLE BEHAVIOR (already probed — trust this, but you may re-probe) ===
Happy path, key '6G!I:]M.SYzm[v9[', iv '*ANz^hUTfAHTf!he', data1 '^Roq|2L=X{7CRJh{', data2 'Gr.c8LH=f{xn_V0L':
  stdout line1: b'3\\xe9\\xbb\\x12r\\xe6Rd\\xdf\\xbb\\xed@\\xf1\\x1bZ\\x14'
  stdout line2: b'-\\xdf\\x14]\\xf5\\xd9\\xc4\\x1e\\xefiq\\xdeI\\xe3\\x08H'
  exit 0

CIPHER SEMANTICS (confirmed by experiment):
- A SINGLE AESModeOfOperationCBC object encrypts both blocks, so CBC state CHAINS:
  block1 = AES_encrypt(key, plaintext1 XOR iv);  block2 = AES_encrypt(key, plaintext2 XOR block1).
  Proven: with identical data1==data2 the two output lines DIFFER.
- Key sizes 16, 24 and 32 bytes are all accepted (AES-128/192/256). Other sizes raise
  ValueError('Invalid key size') -> exit code 1, traceback on stderr.
- IV must be exactly 16 bytes else ValueError('initialization vector must be 16 bytes') -> exit 1.
- Each encrypt() plaintext must be exactly 16 bytes else ValueError('plaintext block must be 16 bytes') -> exit 1.
- .encode() is UTF-8: a 15-character string containing a 2-byte char is 16 BYTES and is ACCEPTED.
  Verified: --data1 'ccccccccccccccé' (15 chars / 16 UTF-8 bytes) works fine.
  So all length checks are on UTF-8 BYTE length, never on JS string .length (also beware surrogate pairs).

PYTHON bytes repr (what print() emits) — confirmed samples:
  b'\\xc2z\\x9f&\\x82LS\\xce\\x98\\x91\\x80Ei\\xb0\\xe6+'
  b"\\x97n/'\\xd5\\x94\\x9c\\xfd\\xee\\x15\\xa7=\\x8d\\xbcYS"     <- contains ' and no " -> outer quotes are "
  b'0g\\xe9k\\xb7\\x91\\t\\x9b\\x95E\\x02U\\xcc\\xe3\\'"'          <- contains BOTH ' and " -> outer ' , inner ' escaped as \\'
  Note \\t appears for byte 0x09.
Rules to implement exactly (CPython bytes_repr):
  - quote = "'" by default; if the buffer contains 0x27 (') AND does NOT contain 0x22 (") then quote = '"'.
  - prefix is b, then quote, then per byte:
      byte == quote        -> backslash + that quote char
      byte == 0x5C (\\)     -> \\\\
      byte == 0x09         -> \\t
      byte == 0x0A         -> \\n
      byte == 0x0D         -> \\r
      byte < 0x20 or byte >= 0x7F -> \\x + two LOWERCASE hex digits, zero padded
      otherwise            -> the literal ASCII character
    (note: when quote is '"', a literal ' is NOT escaped; and " is never escaped in that case because it
     cannot be present. When quote is "'", a literal " is NOT escaped.)
  - then closing quote. print() appends exactly one '\\n'.

ARGPARSE behavior (confirmed by probing the oracle):
  usage line: usage: PROG [-h] --key KEY --iv IV --data1 DATA1 --data2 DATA2
  --help / -h prints (exit 0):
usage: PROG [-h] --key KEY --iv IV --data1 DATA1 --data2 DATA2

options:
  -h, --help     show this help message and exit
  --key KEY
  --iv IV
  --data1 DATA1
  --data2 DATA2

  (Note: two blank-separated sections; the option column padding above is literal — re-probe
   '/workspace/dataset/test7_executable --help' and reproduce it byte for byte, modulo PROG.)
  Errors go to stderr as:  usage line \\n  then  "PROG: error: <msg>\\n"  and exit code 2.
  Confirmed messages:
    the following arguments are required: --key, --iv, --data1, --data2   (only the MISSING ones, in
      declaration order --key, --iv, --data1, --data2)
    unrecognized arguments: --zzz 1        (leftovers joined by a single space, in argv order)
    ambiguous option: --d could match --data1, --data2
    argument --key: expected one argument
  Confirmed accepted forms:
    --key=VALUE   and   --key VALUE
    unique prefix abbreviation: --ke works, --d and --data are ambiguous, --data1 exact wins
    a repeated option: last one wins
    a value that begins with '-' is REJECTED in the space-separated form ("expected one argument")
      but ACCEPTED via --data1=-Xccccccccccccc
    '-k' (single dash) is NOT a valid abbreviation -> treated as unrecognized/missing-required
    an extra positional 'foo' -> "unrecognized arguments: foo", exit 2
  PROG in Python is os.path.basename(sys.argv[0]); in our Node port use basename of process.argv[1]
    (i.e. 'test7.mjs'). That is the faithful analogue.

RUNTIME ERROR behavior (ValueError path): oracle prints a Python traceback to STDERR and exits 1.
  We reproduce a faithful-shaped traceback ending with the exact line 'ValueError: <message>' and exit code 1.
  Exact PyInstaller-specific frame lines cannot be reproduced and are not required; the final
  'ValueError: <msg>' line and exit code 1 ARE required. stdout must stay empty in that case.

=== STYLE ===
Clean, well-factored, commented where non-obvious. No dead code. Deterministic. No console noise beyond
what the program must print. Write files with the Write tool.
`

const INTERFACES = `
=== FIXED MODULE INTERFACE CONTRACT (do not deviate — other agents depend on these exact names) ===

/output/lib/py-errors.mjs
  export class PyValueError extends Error { constructor(message) }   // .name === 'ValueError'
  export function pythonFatal(err, pyFile, frames)  // prints traceback to stderr, does NOT exit
  export const EXIT_OK = 0, EXIT_RUNTIME_ERROR = 1, EXIT_ARG_ERROR = 2

/output/lib/python-bytes.mjs
  export function encodeUtf8(str) -> Uint8Array          // exactly Python str.encode('utf-8')
  export function bytesRepr(u8)  -> string               // exactly Python repr(bytes) , no trailing newline
  export function pyPrintBytes(u8) -> void               // writes bytesRepr(u8) + '\\n' to stdout

/output/lib/aes-tables.mjs
  export const SBOX      // Uint8Array(256)
  export const INV_SBOX  // Uint8Array(256)
  export const RCON      // Uint8Array or Array of round constants
  (any additional precomputed GF tables you need may also be exported)

/output/lib/aes-core.mjs
  export class AES {
    constructor(key)              // key: Uint8Array of length 16|24|32, else throw PyValueError('Invalid key size')
    encrypt(plaintext)            // Uint8Array(16) -> Uint8Array(16); throw PyValueError('plaintext block must be 16 bytes')
    decrypt(ciphertext)           // Uint8Array(16) -> Uint8Array(16); throw PyValueError('ciphertext block must be 16 bytes')
  }

/output/lib/aes-modes.mjs
  export class AESModeOfOperationECB { constructor(key); encrypt(pt); decrypt(ct) }
  export class AESModeOfOperationCBC {
    constructor(key, iv)          // iv default = 16 zero bytes; wrong iv length ->
                                  //   PyValueError('initialization vector must be 16 bytes')
                                  // NOTE: pyaes validates the IV BEFORE the key (probe the oracle to confirm
                                  //   ordering when BOTH are wrong) — match the oracle.
    encrypt(plaintext)            // Uint8Array(16) -> Uint8Array(16), chains internal state
    decrypt(ciphertext)
  }

/output/lib/pyaes.mjs
  // aggregator that mirrors 'import pyaes' — re-exports AES, AESModeOfOperationECB,
  // AESModeOfOperationCBC and also a default export object bundling them.

/output/lib/argparse.mjs
  export class ArgumentParser {
    constructor(opts)             // { prog } optional; defaults prog = basename(process.argv[1])
    addArgument(flag, opts)       // opts: { type, required, help, dest }
    parseArgs(argv)               // argv defaults to process.argv.slice(2); on error prints usage+error to
                                  //   stderr and exits 2; on -h/--help prints help to stdout and exits 0
    formatUsage() / formatHelp()  // return the exact strings
  }

/output/test7.mjs  (entry point, written by the integrator)
`

// ---------------------------------------------------------------- Spec -> Implement
const TRACKS = [
  {
    key: 'pybytes',
    spec: `Produce a precise, implementation-ready specification for two things:
(a) Python's str.encode() (UTF-8) semantics as they must be reproduced in JS from a JS string that came out of
    process.argv — including how JS handles lone surrogates vs Python, and how to count BYTE length.
(b) Python's repr(bytes) byte-for-byte, and what print() adds.
Empirically confirm the quote-selection and escaping rules by finding oracle invocations whose ciphertext
contains 0x27 and/or 0x22 and/or 0x09/0x0a/0x0d/0x5c bytes. You may brute-force by running
/workspace/dataset/test7_executable in a shell loop with varying inputs until you observe those cases; report
the exact observed output lines as evidence. Also determine exactly how the process behaves on the ValueError
paths (stdout content, stderr shape, exit code).
Return a tight spec (not prose) that a coder can implement directly.`,
    impl: `Implement /output/lib/py-errors.mjs and /output/lib/python-bytes.mjs exactly per the interface contract
and the spec below. These are leaf modules: they may import each other but nothing else.
Then self-test: write a scratch file OUTSIDE /output (e.g. /workspace/verify/t-bytes.mjs) that checks bytesRepr
against every documented sample, including the three confirmed oracle samples, plus bytes 0x00-0xFF coverage,
plus the both-quotes case. Run it with node and iterate until it passes. Report what you verified.`,
  },
  {
    key: 'argparse',
    spec: `Produce a precise, implementation-ready specification of the argparse behavior of the oracle
/workspace/dataset/test7_executable for the four required string options. PROBE IT EXHAUSTIVELY — run it many
times. Cover at minimum: --help and -h exact byte output (capture with od/cat -A if needed so trailing spaces
and blank lines are unambiguous); missing-required message with 1, 2, 3 and 4 missing and the ORDER they are
listed; unrecognized extra options and positionals (single and multiple, and their exact joining); '=' form;
'--foo=' with empty value; unique-prefix abbreviation rules and ambiguity message formatting and ordering;
'--' end-of-options separator; a value that looks like a negative number e.g. --key -5 ; repeated options;
interleaving; empty-string values. Report exact stdout/stderr/exit code for each probe as evidence.
Return a spec precise enough to reimplement byte for byte.`,
    impl: `Implement /output/lib/argparse.mjs exactly per the interface contract and the spec below. It is a
self-contained minimal argparse clone (only what this program needs, but faithful on every probed behavior).
It may import node:process and node:path only. It must NOT import any other local module except
./py-errors.mjs if useful.
Column alignment in the help text: reproduce it from the captured oracle bytes, substituting PROG.
Then self-test with a scratch harness OUTSIDE /output (/workspace/verify/t-args.mjs) driving parseArgs with
many argv arrays; compare against the recorded oracle behavior. Iterate until it matches. Report evidence.`,
  },
  {
    key: 'aes',
    spec: `Produce an implementation-ready spec for the AES core + CBC mode needed here.
Include: key expansion for 128/192/256 (Nk/Nr/Rcon, the RotWord/SubWord/Rcon rule AND the extra SubWord step
for Nk==8), the encryption round structure (AddRoundKey, SubBytes, ShiftRows, MixColumns, final round without
MixColumns), the exact GF(2^8) multiplication / xtime rule with 0x11B, the column-major state mapping from the
16 input bytes, and the inverse operations for decrypt. Also give a set of KNOWN-ANSWER TEST VECTORS
(FIPS-197 Appendix C: AES-128/192/256 single-block ECB of 00112233445566778899aabbccddeeff) that an
implementation can be checked against, and derive at least 4 CBC-chaining ground-truth cases by running the
oracle /workspace/dataset/test7_executable with 16/24/32-byte keys. Be exact about the CBC chaining formula
and about which validation error fires first when several inputs are invalid (probe the oracle).`,
    impl: `Implement /output/lib/aes-tables.mjs, /output/lib/aes-core.mjs, /output/lib/aes-modes.mjs and
/output/lib/pyaes.mjs exactly per the interface contract and the spec below.
STRICTLY NO node:crypto — implement AES from scratch. Prefer a clear, correct byte-oriented implementation
(SubBytes/ShiftRows/MixColumns) over an obscure T-table one; correctness and readability beat micro-speed here.
Generate the S-box/inverse S-box and GF tables either as literal constants or by computing them at module load
from first principles (multiplicative inverse in GF(2^8) + affine transform) — whichever you do, VERIFY the
resulting S-box against the known AES S-box values (SBOX[0x00]===0x63, SBOX[0x53]===0xed, SBOX[0xff]===0x16,
INV_SBOX[SBOX[i]]===i for all i).
Then self-test OUTSIDE /output (/workspace/verify/t-aes.mjs): run the FIPS-197 known-answer vectors for
AES-128/192/256 (encrypt AND decrypt round-trip), plus the CBC chaining ground truth from the oracle.
Iterate until every vector passes. Report the actual pass/fail output.`,
  },
]

phase('Spec')
const built = await pipeline(
  TRACKS,
  (t) => agent(`${RULES}\n\n=== YOUR TASK: SPEC for track "${t.key}" ===\n${t.spec}`, {
    label: `spec:${t.key}`, phase: 'Spec',
  }),
  (specText, t) => agent(
    `${RULES}\n${INTERFACES}\n\n=== YOUR TASK: IMPLEMENT track "${t.key}" ===\n${t.impl}\n\n` +
    `=== SPEC PRODUCED BY THE SPEC AGENT FOR THIS TRACK ===\n${specText}\n\n` +
    `Write the real files now with the Write tool. Report a short summary of files written and tests passed.`,
    { label: `impl:${t.key}`, phase: 'Implement' }
  )
)

log(`library modules built for ${built.filter(Boolean).length}/${TRACKS.length} tracks`)

phase('Integrate')
const integration = await agent(
  `${RULES}\n${INTERFACES}\n\n=== YOUR TASK: INTEGRATE ===\n` +
  `All library modules under /output/lib/ have been written by other agents. Read every one of them.\n` +
  `1. Verify the interface contract is actually satisfied by the files on disk; if a module deviates, FIX the\n` +
  `   module (you own all files now).\n` +
  `2. Write /output/test7.mjs — the entry point. It must mirror test7.py's main() exactly:\n` +
  `   build the ArgumentParser with the four required --key/--iv/--data1/--data2 string options, parse\n` +
  `   process.argv, construct AESModeOfOperationCBC(encodeUtf8(key), encodeUtf8(iv)), encrypt data1 then\n` +
  `   data2 with the SAME object (chaining), and print each ciphertext with Python bytes repr semantics.\n` +
  `   Wrap the crypto part so a PyValueError produces the Python-style traceback on stderr and exit code 1,\n` +
  `   with NOTHING on stdout. Import order in the file should mirror the Python (argparse, then pyaes).\n` +
  `   Use an 'if main' guard analogous to Python's, via import.meta.url vs process.argv[1], and also export\n` +
  `   main() so the module is reusable.\n` +
  `3. Smoke test all four sample cases from the task description and confirm byte-identical stdout vs\n` +
  `   /workspace/dataset/test7_executable. Use 'diff <(node /output/test7.mjs ...) <(/workspace/dataset/test7_executable ...)'.\n` +
  `4. Confirm 'grep -rn "require(\\|module.exports\\|node:crypto\\|createCipheriv" /output' returns nothing.\n` +
  `Iterate until the smoke tests pass. Report exact command output as evidence.`,
  { label: 'integrate', phase: 'Integrate' }
)

// ---------------------------------------------------------------- Verify + Audit, loop until dry
const VERIFIERS = [
  { key: 'fuzz-ascii', prompt:
    `Write and run a differential fuzzer at /workspace/verify/fuzz-ascii.mjs (ESM, .mjs, may use node:child_process
     since it is a TEST harness outside /output — that restriction only binds the deliverable).
     Generate at least 400 random cases: printable-ASCII keys of length 16, 24 and 32, random 16-byte IVs, random
     16-byte data1/data2, drawn from the full printable ASCII range INCLUDING quotes, backslashes, spaces and
     shell metacharacters (pass args via execFileSync argv array, never through a shell string).
     For each case run BOTH /workspace/dataset/test7_executable and 'node /output/test7.mjs' and compare stdout,
     stderr-emptiness and exit code exactly. Report the count of mismatches and the FIRST 5 mismatching cases in
     full detail (inputs + both outputs). If zero mismatches, say so explicitly with the actual harness output.` },
  { key: 'fuzz-unicode', prompt:
    `Write and run a differential fuzzer at /workspace/verify/fuzz-unicode.mjs targeting UTF-8 and encoding edge
     cases (test harness outside /output, so node:child_process is allowed there).
     Cases must include: multi-byte characters chosen so the UTF-8 byte length is exactly 16 while the JS string
     length is 15, 14, 8, or 4 (e.g. 2-byte Latin-1 supplement, 3-byte CJK, 4-byte emoji / astral plane); keys and
     IVs that are also multi-byte but exactly 16/24/32 BYTES; strings whose JS .length is 16 but UTF-8 length is
     not (must produce the ValueError path in BOTH); and combining marks. At least 150 cases.
     Compare stdout, stderr's final line, and exit code against /workspace/dataset/test7_executable for each.
     Report mismatch count and full details of the first 5 mismatches.` },
  { key: 'fuzz-repr', prompt:
    `The riskiest formatting area is Python's repr(bytes) quote selection and escaping. Write and run
     /workspace/verify/fuzz-repr.mjs that hunts specifically for ciphertexts containing the bytes 0x22 ("),
     0x27 ('), 0x5c (backslash), 0x09, 0x0a, 0x0d, 0x7f, 0x00 and high bytes. Brute force many random inputs
     (thousands of cheap iterations are fine) against BOTH the oracle and 'node /output/test7.mjs', keeping only
     the interesting cases, and verify byte-for-byte equality of stdout. You MUST find and report at least one
     confirmed case for each of: output containing ' only (so the outer quote flips to "), output containing "
     only, output containing BOTH ' and ", output containing a backslash, and output containing 0x09/0x0a/0x0d.
     If a category cannot be found within your budget, say so explicitly rather than claiming success.
     Report mismatch count and full details of any mismatch.` },
  { key: 'cli-conformance', prompt:
    `Write and run /workspace/verify/cli-conformance.mjs, a differential test of ARGUMENT PARSING ONLY.
     Build a table of at least 60 argv vectors covering: no args; each single missing required arg; multiple
     missing; -h; --help; --help combined with other args; --hel abbreviation; every unique prefix of every
     option (--k, --ke, --key, --i, --iv, --d, --da, --dat, --data, --data1, --data2); '=' form; '=' with empty
     value; missing value at end of argv; value starting with '-'; value that is a negative number; '--'
     separator; extra positionals (one and several); unknown options (one and several); duplicate options;
     empty string values; and the well-formed happy path.
     For each, run the oracle and 'node /output/test7.mjs' and compare exit code, stdout, and stderr — but when
     comparing, normalize ONLY the program name (the oracle says 'test7_executable', ours says 'test7.mjs') and
     the Python traceback frame lines (everything between 'Traceback (most recent call last):' and the final
     'ValueError:' line, plus any '[PYI-...]' line), since those are PyInstaller-specific and out of scope.
     Everything else — usage line, error text, blank lines, help layout, exit codes — must match EXACTLY.
     Report the comparison table result, mismatch count, and full detail of every mismatch.` },
  { key: 'compliance-audit', prompt:
    `Static compliance audit of the DELIVERABLE ONLY (/output). Read every file under /output.
     Check and report a PASS/FAIL for each:
     (1) every file ends in .mjs; (2) no 'require(' and no 'module.exports' anywhere; (3) no import of any
     non-'node:' bare specifier (i.e. zero npm deps) — list every import specifier found; (4) no reference to
     node:crypto / createCipheriv / Cipher / Decipher / webcrypto / subtle / the substring 'crypto' as a module
     specifier; (5) every relative import includes the .mjs suffix and resolves to a file that exists on disk;
     (6) no child_process / spawning / python; (7) the library is genuinely split into multiple functional
     modules with named exports (list them); (8) code runs on Node 18 (no syntax/APIs newer than Node 18 —
     check for things like Array.fromAsync, Object.groupBy, RegExp /v flag);
     (9) there are no stray non-deliverable/test files polluting /output.
     Actually RUN the greps and 'node --check'-equivalent (node --input-type=module or just import each file) to
     back every claim. Report concrete evidence, not assertions.` },
  { key: 'adversarial-review', prompt:
    `Adversarial code review of /output. Read every file closely. Your job is to FIND DEFECTS, not to praise.
     Focus on: AES correctness for 192/256 key expansion (the Nk==8 extra SubWord is a classic bug); GF
     multiplication overflow; Uint8Array vs Number sign issues; state column/row ordering mistakes that happen to
     pass a single test vector; CBC state mutation and aliasing bugs (returning a view into an internal buffer
     that is later mutated, so line 1 changes after line 2 is computed); UTF-8 encoder correctness for astral
     plane and lone surrogates; off-by-one in the repr hex padding or lowercase; the quote-selection condition
     being inverted; argparse abbreviation/ambiguity logic; error precedence (IV checked before key?); output
     written with console.log vs process.stdout.write and any trailing-newline discrepancy; anything that would
     break only on Node 18.
     For each suspected defect, PROVE it by constructing an input and running both 'node /output/test7.mjs' and
     /workspace/dataset/test7_executable to show the divergence — or by a direct unit experiment in
     /workspace/verify/. Report ONLY defects you actually demonstrated, each with a reproduction command.
     If you demonstrate none, say 'NO DEFECTS DEMONSTRATED' and list what you tried.` },
]

let round = 0
let outstanding = []
while (round < 3) {
  round++
  phase(round === 1 ? 'Verify' : 'Fix')
  const reports = await parallel(VERIFIERS.map((v) => () =>
    agent(`${RULES}\n\n=== YOUR TASK (verification round ${round}): ${v.key} ===\n${v.prompt}\n\n` +
          `Be rigorous and skeptical. Never report success you did not actually observe in command output.`,
      { label: `${v.key}#${round}`, phase: round === 1 ? 'Verify' : 'Audit' })
  ))
  const joined = reports.filter(Boolean).map((r, i) => `----- ${VERIFIERS[i].key} -----\n${r}`).join('\n\n')

  const triage = await agent(
    `${RULES}\n\nYou are the TRIAGE agent. Below are ${VERIFIERS.length} independent verification reports on the\n` +
    `deliverable in /output. Decide, skeptically, whether any REAL defect in /output remains.\n` +
    `Ignore complaints about out-of-scope things (PyInstaller traceback frame lines, the program name differing,\n` +
    `test harnesses under /workspace/verify). Independently re-run the single most convincing reproduction for\n` +
    `each claimed defect before accepting it. Then return STRICT JSON.\n\n${joined}`,
    { label: `triage#${round}`, phase: round === 1 ? 'Verify' : 'Audit',
      schema: {
        type: 'object',
        properties: {
          defects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                file: { type: 'string' },
                summary: { type: 'string' },
                repro: { type: 'string' },
                fix: { type: 'string' },
              },
              required: ['file', 'summary', 'repro', 'fix'],
            },
          },
          allClear: { type: 'boolean' },
          notes: { type: 'string' },
        },
        required: ['defects', 'allClear', 'notes'],
      } }
  )

  outstanding = (triage && triage.defects) || []
  log(`round ${round}: ${outstanding.length} confirmed defect(s); allClear=${triage && triage.allClear}`)
  if (!outstanding.length) break

  await agent(
    `${RULES}\n${INTERFACES}\n\n=== YOUR TASK: FIX ===\nThe following defects in /output were CONFIRMED with\n` +
    `reproductions. Fix every one of them in place, minimally and correctly, preserving the module structure and\n` +
    `all hard requirements. After each fix, re-run its reproduction command to prove it is resolved, and re-run\n` +
    `the four sample cases from the task plus a quick 100-case random differential sweep to prove no regression.\n\n` +
    `DEFECTS:\n${JSON.stringify(outstanding, null, 2)}\n\nReport exact command output as evidence.`,
    { label: `fix#${round}`, phase: 'Fix' }
  )
}

phase('Fix')
const final = await agent(
  `${RULES}\n\n=== FINAL GATE ===\nDo a last independent end-to-end confirmation of the deliverable in /output.\n` +
  `1. Run all four sample cases from the task description through BOTH the oracle and 'node /output/test7.mjs'\n` +
  `   and diff. 2. Run a fresh 300-case random differential sweep across 16/24/32-byte keys including unicode.\n` +
  `   3. Re-run the compliance greps (no require/module.exports/npm imports/node:crypto, all .mjs, suffixed\n` +
  `   relative imports). 4. Confirm /output contains only the intended deliverable files and list the tree.\n` +
  `Return a concise final report: the file tree of /output with a one-line role for each file, the exact\n` +
  `verification commands run, and their results. Do not modify code unless something fails — if it does, fix it\n` +
  `and re-verify.`,
  { label: 'final-gate', phase: 'Fix' }
)

return { integration, outstanding, final }
