export const meta = {
  name: 'pyaes-test15-port',
  description: 'Port /workspace/dataset/test15.py (pyaes ECB) to hand-written ESM Node.js in /output, verified differentially against the reference executable',
  phases: [
    { title: 'Implement', detail: 'AES core, Python runtime emulation, argparse emulation — parallel, pinned interfaces' },
    { title: 'Integrate', detail: 'pyaes ECB shim + test15.mjs entry point' },
    { title: 'Verify', detail: 'differential + KAT + compliance sweeps against the executable' },
    { title: 'Repair', detail: 'fix every discrepancy, re-verify until dry' },
    { title: 'Review', detail: 'adversarial correctness + compliance review' },
  ],
}

const SPEC = `Read /workspace/harness/SPEC.md FIRST — it is the measured behavioral contract for this port. Everything in it was empirically verified against /workspace/dataset/test15_executable; treat it as ground truth and never contradict it.

HARD RULES (violating any one invalidates the whole deliverable):
- ESM only. Use import/export. NEVER use require(), module.exports, __dirname, or CommonJS anything.
- Every file you create MUST use the .mjs extension, and every relative import MUST include the .mjs suffix.
- ZERO external/npm dependencies. Only node: builtins (node:fs, node:path, node:process, node:url) and local relative imports.
- node:crypto is ABSOLUTELY FORBIDDEN — do not import it, do not reference Cipher/Decipher/createCipheriv/webcrypto anywhere, not even in a comment. AES must be implemented by hand from FIPS-197.
- Do NOT shell out to python, and do NOT embed or execute python.
- All deliverable code goes under /output. Never write deliverables anywhere else.
- Target Node 18.19: no Array.prototype.toSorted/findLast on typed arrays, no RegExp /v flag, no Object.groupBy.
- Write clean, documented, production-quality library code. Each module gets a short header comment explaining what Python behavior it reproduces.
- Use the Write tool to create files. Do not print code to stdout as your answer.`

// ---------------------------------------------------------------- Implement
phase('Implement')

const aesCore = agent(`You are implementing the AES block cipher core for a Python-to-Node port.

${SPEC}

Create EXACTLY these four files, with EXACTLY these exported interfaces (other agents import them, so the signatures are contractual and must not drift):

--- /output/lib/aes/galois.mjs ---
  export function xtime(a)      // a is 0..255; multiply by x in GF(2^8) with the AES reduction polynomial 0x11b
  export function gmul(a, b)    // GF(2^8) product of two bytes
  export function ginv(a)       // multiplicative inverse in GF(2^8); ginv(0) === 0 by AES convention

--- /output/lib/aes/tables.mjs ---
  export const SBOX      // Uint8Array(256)
  export const INV_SBOX  // Uint8Array(256)
  export const RCON      // Uint8Array(11) where RCON[i] for i>=1 is x^(i-1) in GF(2^8): 01 02 04 08 10 20 40 80 1b 36
  export const MUL2, MUL3, MUL9, MUL11, MUL13, MUL14   // Uint8Array(256) lookup tables for MixColumns / InvMixColumns

  CRITICAL: derive SBOX algorithmically at module load (multiplicative inverse in GF(2^8) followed by the
  affine transform b ^ rotl(b,1) ^ rotl(b,2) ^ rotl(b,3) ^ rotl(b,4) ^ 0x63) using galois.mjs. Do NOT paste a
  hardcoded table. Then assert the derivation with a handful of known FIPS-197 values
  (SBOX[0x00]=0x63, SBOX[0x01]=0x7c, SBOX[0x10]=0xca, SBOX[0x53]=0xed, SBOX[0x7f]=0xd2, SBOX[0xff]=0x16)
  and assert INV_SBOX[SBOX[i]] === i for all i. Throw an Error if any assertion fails.

--- /output/lib/aes/errors.mjs ---
  export class InvalidKeySizeError extends Error   // message defaults to 'Invalid key size'
  export class InvalidBlockSizeError extends Error // constructor(message) — caller supplies the exact text
  Keep this layer free of any Python/traceback concepts; the pyaes shim maps these to Python exceptions.

--- /output/lib/aes/key-schedule.mjs ---
  export const BLOCK_SIZE = 16
  export const ROUNDS_BY_KEY_SIZE  // Map: 16->10, 24->12, 32->14
  export function isValidKeySize(byteLength)
  export function expandKey(keyBytes)
    // keyBytes: Uint8Array. Throws InvalidKeySizeError when the length is not 16/24/32.
    // Returns { keySize, rounds, roundKeys } where roundKeys is an Array of (rounds+1) Uint8Array(16),
    // each already in the SAME byte order as the 16-byte input block, so AddRoundKey is a plain
    // 16-way XOR with no transposition. Implement the standard FIPS-197 word-oriented schedule
    // (RotWord/SubWord/Rcon, plus the extra SubWord every 8 words for 256-bit keys).

--- /output/lib/aes/block-cipher.mjs ---
  export { BLOCK_SIZE }
  export class AES {
    constructor(keyBytes)          // Uint8Array; throws InvalidKeySizeError for bad lengths
    get keySize()                  // 16 | 24 | 32
    get rounds()                   // 10 | 12 | 14
    encryptBlock(block)            // Uint8Array(16) in -> new Uint8Array(16) out; must NOT mutate the input
    decryptBlock(block)            // Uint8Array(16) in -> new Uint8Array(16) out; must NOT mutate the input
  }
  Standard FIPS-197 cipher and equivalent-inverse-free straightforward inverse cipher:
  encrypt = AddRoundKey, then (rounds-1) x [SubBytes, ShiftRows, MixColumns, AddRoundKey], then
  [SubBytes, ShiftRows, AddRoundKey].
  decrypt = AddRoundKey(last), then (rounds-1) x [InvShiftRows, InvSubBytes, AddRoundKey, InvMixColumns],
  then [InvShiftRows, InvSubBytes, AddRoundKey(first)].
  Throw a TypeError if block.length !== 16 (the pyaes layer checks sizes before calling, so this is
  only a defensive internal guard).

--- /output/lib/aes/index.mjs ---
  Re-export AES, BLOCK_SIZE, expandKey, isValidKeySize, ROUNDS_BY_KEY_SIZE and the two error classes.

Then SELF-TEST before you finish. Write a scratch script to /tmp (NOT /output) that imports your modules and
checks the FIPS-197 Appendix B/C known-answer vectors:
  AES-128 key 000102...0f, plaintext 00112233445566778899aabbccddeeff -> 69c4e0d86a7b0430d8cdb78070b4c55a
  AES-192 key 000102...17, same plaintext -> dda97ca4864cdfe06eaf70a0ec0d7191
  AES-256 key 000102...1f, same plaintext -> 8ea2b7ca516745bfeafc49904b496089
  FIPS-197 Appendix B: AES-128 key 2b7e151628aed2a6abf7158809cf4f3c, plaintext 3243f6a8885a308d313198a2e0370734 -> 3925841d02dc09fbdc118597196a0b32
Also check decryptBlock(encryptBlock(x)) === x for many random blocks and all three key sizes.
Run it with node and iterate until every vector passes. Report the final pass/fail lines.

Your final message: one short paragraph listing the files you created and the KAT results.`, { label: 'aes-core', phase: 'Implement' })

const pyRuntime = agent(`You are implementing the CPython runtime-behavior emulation layer for a Python-to-Node port.

${SPEC}

Create EXACTLY these files with EXACTLY these exported interfaces (contractual — other agents import them):

--- /output/lib/python/errors.mjs ---
  export class PyException extends Error {
    constructor(typeName, pyMessage, frames)   // frames: array of {file, line, name}, OUTERMOST FIRST
    get typeName(); get pyMessage(); get frames()
    withFrames(frames)   // returns a copy with the frame list replaced/attached (used by the pyaes shim)
  }
  export class PyValueError extends PyException          // typeName 'ValueError'
  export class PyUnicodeEncodeError extends PyException  // typeName 'UnicodeEncodeError'
  export function formatTraceback(exc)
    // Reproduces the piped/frozen CPython form documented in SPEC.md section 6 — no source-echo lines:
    //   'Traceback (most recent call last):\\n' + for each frame '  File "<file>", line <n>, in <name>\\n'
    //   + '<typeName>: <pyMessage>\\n'
  export function formatPyInstallerFooter(scriptName, pid)
    // '[PYI-<pid>:ERROR] Failed to execute script \\'<scriptName>\\' due to unhandled exception!\\n'

--- /output/lib/python/codec.mjs ---
  export function encodeUtf8Strict(str)
    // Python str.encode() with the default 'strict' errors. Returns Uint8Array.
    // MUST throw PyUnicodeEncodeError for lone surrogates (U+D800..U+DFFF), with EXACTLY the CPython message:
    //   single offending code point: "'utf-8' codec can't encode character '\\\\udcff' in position 0: surrogates not allowed"
    //   run of length > 1:          "'utf-8' codec can't encode characters in position 5-7: surrogates not allowed"
    // 'position' is a UTF-16 code-unit index the way CPython counts str indices for BMP/surrogate content
    // (surrogates are single code points in CPython; every char before them here is BMP or astral —
    //  see the note below and make the astral case correct: CPython counts an astral char as ONE position,
    //  JS strings count it as TWO code units, so you must count code POINTS, not code units).
    // Only the FIRST maximal run of surrogates is reported. The '\\udcff' rendering is lowercase 4-hex-digit.
    // Encode all non-surrogate code points as normal UTF-8 (1-4 bytes), matching astral pairs correctly.
  export function decodeSurrogateEscape(bytes)
    // Python's 'utf-8' decoder with errors='surrogateescape': valid UTF-8 sequences decode normally;
    // each byte that cannot start/continue a valid minimal-length sequence becomes U+DC00 + byte
    // (so 0xff -> U+DCFF). Must reject overlong encodings, surrogate encodings (ED A0 80..ED BF BF),
    // and > U+10FFFF sequences by escaping their bytes individually, exactly like CPython.
  export function byteLengthUtf8Strict(str)   // convenience; same throwing behavior as encodeUtf8Strict
  export function encodeBackslashReplace(str)
    // Python's stderr encoding (errors='backslashreplace'): valid code points as UTF-8, lone surrogates
    // as the LITERAL ASCII text '\\udcff' (backslash, u, 4 lowercase hex digits). Returns Uint8Array.

--- /output/lib/python/repr.mjs ---
  export function bytesRepr(bytes)   // Uint8Array -> the exact Python 3 repr(bytes) string
  Implement SPEC.md section 4 precisely: quote selection, \\\\ \\t \\n \\r escapes, escaping only the chosen
  quote, verbatim printable ASCII 0x20..0x7e, \\xNN lowercase for everything else.
  There is NO \\a \\b \\v \\f \\0 in Python bytes repr — those are \\x07 \\x08 \\x0b \\x0c \\x00.

--- /output/lib/python/stdio.mjs ---
  export function writeStdout(text)   // byte-exact write to fd 1 (use encodeUtf8-ish; text here is ASCII)
  export function writeStderr(text)   // byte-exact write to fd 2 using encodeBackslashReplace
  export function exit(code)
  Use node:fs writeSync on fd 1/2 with a Buffer built from the codec so output is byte-exact and
  synchronous (process.stdout.write can truncate on process.exit).

--- /output/lib/python/argv.mjs ---
  export function pyArgv()
    // Returns the equivalent of CPython's sys.argv[1:] — i.e. the script's own arguments, decoded with
    // surrogateescape so invalid UTF-8 survives. process.argv is LOSSY (invalid bytes become U+FFFD), so:
    //   1. read /proc/self/cmdline with node:fs (readFileSync as a Buffer)
    //   2. split on 0x00, drop a single trailing empty element
    //   3. the script's args are the LAST (process.argv.length - 2) entries — computing it from the tail
    //      makes it robust against node's own flags appearing before the script path
    //   4. decode each with decodeSurrogateEscape
    //   5. if /proc/self/cmdline is unreadable, or the entry count is smaller than expected, fall back
    //      to process.argv.slice(2)
  export function progName()
    // basename(process.argv[1]) — argparse's os.path.basename(sys.argv[0]). Use node:path basename.
  export function terminalWidth()
    // Python shutil.get_terminal_size().columns: honour a valid positive integer in process.env.COLUMNS
    // first; else process.stdout.columns when it is a TTY; else 80.

Then SELF-TEST with scratch scripts in /tmp (NOT /output):
  - bytesRepr against these MEASURED expectations:
      [0x5f,0x7d,0xf0,0xbf,0x10,0x3a,0x8c,0x4a,0xe6,0xfa,0xad,0x99,0x06,0xac,0x3b,0x2a] -> b'_}\\\\xf0\\\\xbf\\\\x10:\\\\x8cJ\\\\xe6\\\\xfa\\\\xad\\\\x99\\\\x06\\\\xac;*'
      utf8 of "abc'def\\"ghi\\\\jklm" -> b'abc\\\\'def"ghi\\\\\\\\jklm'
      utf8 of "abcdef'ghijklmno"   -> b"abcdef'ghijklmno"
      utf8 of 'abcdef"ghijklmno'   -> b'abcdef"ghijklmno'
      bytes 00 09 0a 0b 0c 0d 1b 7f 80 ff -> b'\\\\x00\\\\t\\\\n\\\\x0b\\\\x0c\\\\r\\\\x1b\\\\x7f\\\\x80\\\\xff'
    You can cross-check any additional expectation by grepping /workspace/harness/vectors.json, whose
    "stdout" fields are real Python output for the given key1/key2/data.
  - decodeSurrogateEscape/encodeUtf8Strict round trips: bytes -> str -> must throw with the right message.
    Verify against the executable directly, e.g.
      /workspace/dataset/test15_executable --key1 "$(printf '01234\\xff\\xfe\\xfd789012345')" --key2 0123456789012345 --data 0123456789012345
    prints "UnicodeEncodeError: 'utf-8' codec can't encode characters in position 5-7: surrogates not allowed".
  - Confirm decodeSurrogateEscape of valid multibyte UTF-8 (e.g. the bytes of 'ÀÁ', '€', '😀') is lossless.
Iterate until all self-tests pass.

Your final message: one short paragraph listing the files you created and the self-test results.`, { label: 'py-runtime', phase: 'Implement' })

const argparseImpl = agent(`You are implementing a faithful, self-contained emulation of Python's argparse for a Python-to-Node port.

${SPEC}

Read /workspace/harness/SPEC.md section 5 with great care — every message string and behavior there was
measured from the real program and must be reproduced byte-for-byte (modulo the prog name).
You may also inspect /workspace/harness/cli_cases.json, which contains 35 real argv/stdout/stderr/exit-code
observations, and you can run /workspace/dataset/test15_executable yourself to answer any question the
spec does not settle. RUN IT — do not guess.

Create EXACTLY this file with EXACTLY this exported interface (contractual):

--- /output/lib/python/argparse.mjs ---
  export class ArgparseExit extends Error { constructor(code, stdoutText, stderrText) }
     // Thrown instead of calling process.exit, so the entry point owns all I/O and exit codes.
     // help    -> new ArgparseExit(0, helpText, '')
     // error   -> new ArgparseExit(2, '', usageLine + progName + ': error: ' + message + '\\n')
  export class ArgumentParser {
    constructor({ prog, width })     // width = terminal columns (the caller passes terminalWidth());
                                     // argparse formats to (width - 2)
    add_argument(flags, options)     // flags: string or array of strings, e.g. '--key1' or ['-h','--help']
                                     // options: { type, required, action, help, dest, metavar, default }
                                     // support at least action 'store' (default) and 'help'
    parse_args(argv)                 // argv: array of strings. Returns a plain object keyed by dest.
                                     //   dest is the long flag with leading dashes stripped and '-' -> '_'
    format_usage()                   // 'usage: ...\\n'   (with argparse's wrapping)
    format_help()                    // the full help text
  }

Behavior you MUST reproduce (all measured):
  1. -h/--help, and ANY unambiguous prefix of them (--h, --he, --hel), print help to STDOUT and exit 0.
     Help wins over missing-required errors, and wins even when it appears after other arguments.
  2. Abbreviation matching for long options: a prefix that matches exactly one option is accepted
     (--dat=X works); a prefix matching several is
       'ambiguous option: --key could match --key1, --key2'
     with candidates listed in the order the options were added.
  3. '--key1=VALUE' inline form, including with abbreviated names.
  4. Missing values: 'argument --key1: expected one argument'.
  5. Missing required options, checked BEFORE the unrecognized-arguments check:
     'the following arguments are required: --key1, --key2, --data' (in the order they were added).
  6. Leftover tokens: 'unrecognized arguments: --extra x' (leftovers joined with a single space).
  7. Later occurrences of an option overwrite earlier ones.
  8. Value-vs-option classification, exactly like argparse's _parse_optional:
     a token is a VALUE if it is empty, does not start with '-', matches /^-\\d+$/ or /^-\\d*\\.\\d+$/
     while the parser has no negative-number-looking option strings, or contains a space.
     Otherwise a leading '-' makes it an option token.
  9. '--' handling: the FIRST '--' encountered while consuming positionals is dropped and everything
     after it is forced to be a positional. Measured consequences, both of which your implementation
     must produce: argv ['--','--key1',K,'--key2',K,'--data',K] gives the required-arguments error,
     while argv [...valid..., '--'] gives 'unrecognized arguments: --'.
 10. Usage/help wrapping at (width - 2), reproducing argparse's HelpFormatter:
       - usage: if 'usage: ' + prog + ' ' + all-parts fits, one line.
         Otherwise, if len('usage: ' + prog) is small enough the option parts wrap with a hanging indent of
         len('usage: ' + prog + ' '); if the prog itself is too long, prog goes on its own line and the
         parts wrap with an indent of len('usage: ').
       - help: help_position = min(action_max_length + 2, 24) where action_max_length = max(len(invocation)) + 2
         over all actions; invocations are '-h, --help', '--key1 KEY1', etc. Actions with no help text
         emit only their invocation line. Long help text wraps at (width - help_position) and continuation
         lines are indented to help_position.
       - The options section header is 'options:' (Python 3.10+), preceded by a blank line.
     SPEC.md quotes the exact expected output for COLUMNS=30 and COLUMNS=40 — match both.
 11. Default metavar for a long option is the dest uppercased ('--key1' -> 'KEY1').

Then SELF-TEST with a scratch script in /tmp (NOT /output) that builds the parser from test15.py
  (--key1/--key2/--data, all type str and required=True, prog 'test15_executable') and replays every
  case in /workspace/harness/cli_cases.json, comparing your stdout/stderr/exit-code against the recorded
  Python output. Also replay the COLUMNS=10,15,20,24,28,30,35,40,50,60,80,200 help/usage renderings against
  \`COLUMNS=<n> /workspace/dataset/test15_executable -h\` and \`COLUMNS=<n> /workspace/dataset/test15_executable --key1 x\`.
  Iterate until everything matches. Note the recorded Python output uses prog 'test15_executable',
  so construct your parser with that prog for the comparison.

Your final message: one short paragraph naming the file and the self-test match counts.`, { label: 'argparse', phase: 'Implement' })

const impl = await parallel([() => aesCore, () => pyRuntime, () => argparseImpl])
log('implement phase done: ' + impl.filter(Boolean).length + '/3 agents returned')

// ---------------------------------------------------------------- Integrate
phase('Integrate')

await agent(`You are wiring together an already-implemented Python-to-Node port. The AES core, the CPython
runtime emulation, and the argparse emulation are ALREADY WRITTEN under /output/lib/. Read them first:
  /output/lib/aes/*.mjs
  /output/lib/python/*.mjs

${SPEC}

Now create the remaining two layers.

--- /output/lib/pyaes/ecb.mjs ---
  A faithful shim for the pyaes public API used by test15.py.
    export const BLOCK_SIZE = 16
    export class AESModeOfOperationECB {
      constructor(key)      // key: Uint8Array (already utf-8 encoded bytes)
      get name()            // 'ECB'
      encrypt(plaintext)    // Uint8Array(16) -> Uint8Array(16)
      decrypt(ciphertext)   // Uint8Array(16) -> Uint8Array(16)
    }
  It must raise PyValueError instances carrying the EXACT traceback frames measured in SPEC.md section 6,
  because the entry point renders them:
    - bad key length: PyValueError('Invalid key size') with frames
        [{file:'pyaes/aes.py', line:304, name:'__init__'}, {file:'pyaes/aes.py', line:134, name:'__init__'}]
      (catch the InvalidKeySizeError from the AES core and translate it — do not duplicate the length check
       logic if you can avoid it)
    - plaintext not exactly 16 bytes: PyValueError('plaintext block must be 16 bytes') with frames
        [{file:'pyaes/aes.py', line:342, name:'encrypt'}]
    - ciphertext not exactly 16 bytes: PyValueError('ciphertext block must be 16 bytes') with frames
        [{file:'pyaes/aes.py', line:350, name:'decrypt'}]
      Add a comment noting this path is unreachable from test15.py (the ciphertext is always 16 bytes)
      and that line 350 is therefore an unverified approximation.
  The frames here are the pyaes-internal frames only; the entry point prepends the test15.py frames.

--- /output/lib/pyaes/index.mjs ---
  Re-export AESModeOfOperationECB and BLOCK_SIZE so the entry point can write
  \`import * as pyaes from './lib/pyaes/index.mjs'\` and then call \`new pyaes.AESModeOfOperationECB(...)\`,
  mirroring the Python \`import pyaes\`.

--- /output/test15.mjs ---
  The entry point. A line-for-line mirror of /workspace/dataset/test15.py, keeping the same structure
  (a main() function, invoked under an \`if\` that mirrors \`if __name__ == '__main__'\` — for ESM use a
  comparison of process.argv[1] against fileURLToPath(import.meta.url) via node:url and node:path, so
  the module is still importable without running).

  main() must do, in this exact order (see SPEC.md section 1 — the order decides which error wins):
    1. build the ArgumentParser with prog = progName() and width = terminalWidth();
       add --key1, --key2, --data, each { type: 'str', required: true }
    2. parse pyArgv(); catch ArgparseExit, write its stdout/stderr text, exit with its code
    3. key1 = encodeUtf8Strict(args.key1);  aes1 = new pyaes.AESModeOfOperationECB(key1)   // test15.py line 12
    4. key2 = encodeUtf8Strict(args.key2);  aes2 = new pyaes.AESModeOfOperationECB(key2)   // test15.py line 13
    5. data = encodeUtf8Strict(args.data);  ciphertext = aes1.encrypt(data)                // test15.py line 14
    6. wrongPlaintext = aes2.decrypt(ciphertext)                                           // test15.py line 15
    7. writeStdout(bytesRepr(ciphertext) + '\\n')                                           // line 16
    8. writeStdout(bytesRepr(wrongPlaintext) + '\\n')                                       // line 17

  Every PyException escaping main() must be rendered to STDERR exactly as SPEC.md section 6 shows, with
  the test15.py frames prepended in front of the exception's own frames:
        {file:'test15.py', line:20, name:'<module>'}
        {file:'test15.py', line:<12|13|14|15>, name:'main'}
     then the exception's own frames (none for UnicodeEncodeError, the pyaes frames otherwise),
  followed by formatPyInstallerFooter('test15', process.pid), then exit 1.
  The cleanest way is a small table mapping each step to its test15.py line number: attach the right
  'main' frame at each call site (a helper like \`atLine(12, () => ...)\` is fine).
  stdout must stay EMPTY on that path.

VERIFY before you finish, and iterate until these all pass:
  node /output/test15.mjs --key1 0123456789012345 --key2 0123456789012345 --data 0123456789012345
     must print  b'_}\\\\xf0\\\\xbf\\\\x10:\\\\x8cJ\\\\xe6\\\\xfa\\\\xad\\\\x99\\\\x06\\\\xac;*'  then  b'0123456789012345'
  node /workspace/harness/diff_vectors.mjs   (132 recorded AES/repr vectors)
  node /workspace/harness/diff_cli.mjs       (35 recorded argparse/help/error cases)
  node /workspace/harness/diff_width.mjs     (usage/help across terminal widths)
  bash /workspace/harness/diff_raw.sh        (invalid-UTF-8 argv / UnicodeEncodeError)
If a harness reveals a bug in a library module under /output/lib, FIX THAT MODULE — you own all of /output now.

Your final message: the files you created plus the exact pass/fail line from each of the four harnesses.`,
  { label: 'integrate', phase: 'Integrate' })

// ---------------------------------------------------------------- Verify + Repair
const VERIFIERS = [
  {
    key: 'vectors',
    prompt: `Run \`node /workspace/harness/diff_vectors.mjs\` (132 recorded Python vectors: AES-128/192/256 x repr edge cases).
Then extend the evidence: run \`node /workspace/harness/diff_fuzz.mjs 400 991\` and \`node /workspace/harness/diff_fuzz.mjs 400 4242\`,
which generate FRESH random cases and live-compare /output/test15.mjs against /workspace/dataset/test15_executable
(random byte-lengths, multibyte UTF-8, deliberately invalid key/data sizes).
Report every mismatch verbatim: the argv, the expected bytes, the actual bytes. Do NOT fix anything — you are a detector.
If everything passes, say so and give the pass counts.`,
  },
  {
    key: 'argparse',
    prompt: `Run \`node /workspace/harness/diff_cli.mjs\`, \`node /workspace/harness/diff_width.mjs\`,
\`node /workspace/harness/diff_argv_fuzz.mjs 400 31337\` and \`node /workspace/harness/diff_argv_fuzz.mjs 400 5150\`.
These live-compare /output/test15.mjs against /workspace/dataset/test15_executable on argv shapes, help/usage
rendering, and terminal widths. Then hand-probe at least 15 further adversarial argv shapes of your own design
against BOTH programs and diff them (ideas: repeated '--', '-h' mixed with '=' forms, '--key1=' with an empty
value, options after '--', abbreviations that become unambiguous only with '=', '-hh', '--help=x', a lone '-',
'--key1 --key1', unicode option names, extremely long values, COLUMNS=1, COLUMNS=0, COLUMNS=abc, COLUMNS unset).
Report every mismatch verbatim (argv, expected, actual). Note: the prog name legitimately differs
(test15.mjs vs test15_executable) — normalize that away and do not report it. Do NOT fix anything.`,
  },
  {
    key: 'unicode',
    prompt: `Run \`bash /workspace/harness/diff_raw.sh\`. Then design and run at least 20 MORE raw-byte argv cases
of your own, comparing /output/test15.mjs against /workspace/dataset/test15_executable byte-for-byte.
Node's spawn API cannot carry invalid UTF-8, so build the args in bash with printf, exactly the way
/workspace/harness/diff_raw.sh does. Ideas to cover: a lone surrogate as the very last character; two
separate surrogate runs (only the FIRST must be reported); a surrogate run whose reported position must
count an ASTRAL character (e.g. an emoji, 4 UTF-8 bytes) as ONE position — CPython counts code points while
JS strings count code units, so this is the single likeliest bug in the port; overlong encodings (C0 AF);
CESU-8 surrogate encodings (ED A0 80); 5-byte sequences (F8..); F4 90 80 80 (> U+10FFFF); truncated
sequences at the end of the arg; invalid bytes in --key2 and in --data; invalid bytes that also make the
key the wrong size (which error wins?); invalid bytes inside an unrecognized argument (backslashreplace on
stderr). Compare stdout, stderr and exit code, normalizing '[PYI-<pid>:ERROR]' and the prog name.
Report every mismatch verbatim. Do NOT fix anything.`,
  },
  {
    key: 'compliance',
    prompt: `Audit /output for compliance with the task's hard constraints. Read every file under /output.
Check and report violations of:
  1. ESM only — no require(, no module.exports, no exports., no __dirname/__filename, no CommonJS.
  2. Every file ends in .mjs, and EVERY relative import includes an explicit .mjs suffix (no extensionless
     or directory imports).
  3. Zero external dependencies — the only bare imports allowed are node: builtins. There must be no
     package.json dependency on anything, no node_modules, no npm package imported.
  4. node:crypto is NOWHERE — not imported, and the strings crypto, Cipher, Decipher, createCipheriv,
     webcrypto, subtle appear nowhere (not even in comments). Grep for them.
  5. No python: no child_process spawning python, no embedded .py, no shelling out at runtime. In fact grep
     for child_process / execSync / spawn in /output and report ANY hit — the deliverable must not spawn
     anything at runtime.
  6. No hardcoded AES S-box table pasted as literal data (the S-box must be derived algorithmically from
     GF(2^8) arithmetic). Small assertion constants for self-checking are fine and expected.
  7. No reading of the recorded harness files (/workspace/harness/*) or the reference executable from the
     deliverable — /output must be self-contained. Grep for '/workspace' in /output and report hits.
  8. Runs on Node 18: report any use of APIs newer than Node 18.19 (Array.prototype.toSorted/toReversed/with,
     Object.groupBy, Promise.withResolvers, RegExp /v flag, node:sqlite, etc.).
  9. Every module is genuinely reachable from /output/test15.mjs. Report dead files.
 10. Hierarchical organization: libraries split into multiple modules by functionality, each exposing its
     interface via export. Confirm this holds and describe the tree.
Also confirm \`node --input-type=module -e "import('/output/test15.mjs')"\` does not execute main() (importing
the module must be side-effect free).
Report a findings list. Do NOT fix anything.`,
  },
  {
    key: 'aes-kat',
    prompt: `Independently validate the AES implementation under /output/lib/aes/ as a cryptographic primitive,
WITHOUT trusting the port's own self-tests. Write your own scratch test script in /tmp (never in /output) that
imports /output/lib/aes/index.mjs and checks:
  - FIPS-197 Appendix C.1/C.2/C.3 full known-answer vectors for AES-128/192/256 with plaintext
    00112233445566778899aabbccddeeff and keys 000102..0f / 000102..17 / 000102..1f, expecting
    69c4e0d86a7b0430d8cdb78070b4c55a, dda97ca4864cdfe06eaf70a0ec0d7191, 8ea2b7ca516745bfeafc49904b496089.
  - FIPS-197 Appendix B: key 2b7e151628aed2a6abf7158809cf4f3c, plaintext 3243f6a8885a308d313198a2e0370734
    -> ciphertext 3925841d02dc09fbdc118597196a0b32.
  - NIST SP 800-38A ECB examples (key 2b7e151628aed2a6abf7158809cf4f3c; blocks 6bc1bee22e409f96e93d7e117393172a,
    ae2d8a571e03ac9c9eb76fac45af8e51, 30c81c46a35ce411e5fbc1191a0a52ef, f69f2445df4f9b17ad2b417be66c3710
    -> 3ad77bb40d7a3660a89ecaf32466ef97, f5d3d58503b9699de785895a96fdbaaf, 43b1cd7f598ece23881b00e3ed030688,
    7b0c785e27e8ad3f8223207104725dd4). Also verify the AES-192 and AES-256 ECB variants from that document
    if you can state them confidently; skip rather than invent.
  - decryptBlock is a true inverse of encryptBlock over >= 2000 random blocks x all three key sizes.
  - encryptBlock/decryptBlock do not mutate their input arrays, and repeated calls on the same AES instance
    are stable (no cached-state corruption).
  - The S-box in tables.mjs equals the FIPS-197 S-box. You may hardcode the reference table IN YOUR /tmp TEST
    (that is the point of an independent check) and compare all 256 entries, plus the inverse S-box.
  - The key schedule matches the FIPS-197 Appendix A expansions for all three key sizes (at minimum, check the
    final round key of each).
  - The AES core rejects key lengths 0..48 except 16/24/32.
Also independently cross-check against the reference executable: pick 30 random 16-byte keys/plaintexts,
get the truth from \`/workspace/dataset/test15_executable\`, and confirm the /output AES core reproduces it.
Report every discrepancy precisely. Do NOT fix anything.`,
  },
  {
    key: 'code-quality',
    prompt: `Review the port under /output as a senior engineer, for CORRECTNESS BUGS the differential harnesses
could plausibly miss, and for clarity. Read every file. Focus on:
  - repr: the quote-selection rule and each escape class; bytes 0x00, 0x07, 0x08, 0x0b, 0x0c, 0x1b, 0x7f, 0x80,
    0xff; a byte value that could be mishandled by a signed/unsigned or hex-padding slip (e.g. 0x0f -> \\x0f).
  - the UTF-8 codec: astral characters (surrogate pairs) counted as ONE code point for the
    UnicodeEncodeError position; overlong/CESU-8/out-of-range rejection in the surrogateescape decoder;
    off-by-one in the reported 'position N-M' range.
  - /proc/self/cmdline parsing: the trailing-NUL element, the tail-slicing arithmetic, what happens when an
    argument is itself an empty string, and the fallback path.
  - the argparse emulation: ordering of the required-args check vs the unrecognized-args check, the
    negative-number heuristic, prefix-ambiguity candidate ORDER, the '--' rules, and the wrapping math.
  - error ordering in test15.mjs: key1 errors must mask key2 and data errors; the correct test15.py line
    number must appear in each traceback.
  - any place a Uint8Array vs Buffer vs Array confusion could silently change behavior.
  - anything that would break if the process is spawned with node flags before the script path.
For each finding give file:line, the concrete input that triggers it, and the wrong output. Try to actually
REPRODUCE each finding by running the code before reporting it; mark anything you could not reproduce as
SPECULATIVE. Do NOT fix anything.`,
  },
]

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['clean', 'summary', 'findings'],
  properties: {
    clean: { type: 'boolean', description: 'true only if you found NOTHING that needs fixing' },
    summary: { type: 'string', description: 'pass/fail counts and one-line verdict' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'severity'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string', description: 'exact reproduction: command/input, expected output, actual output, and file:line if known' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'speculative'] },
        },
      },
    },
  },
}

let round = 0
let allFindings = []
let dryRounds = 0

while (dryRounds < 1 && round < 4) {
  round++
  phase(round === 1 ? 'Verify' : `Verify (round ${round})`)
  const label = round === 1 ? 'Verify' : `Verify (round ${round})`
  const reports = await parallel(VERIFIERS.map(v => () =>
    agent(v.prompt, { label: `${v.key}#${round}`, phase: label, schema: FINDINGS })
      .then(r => ({ key: v.key, ...r }))
  ))
  const live = reports.filter(Boolean)
  for (const r of live) log(`[round ${round}] ${r.key}: ${r.clean ? 'CLEAN' : r.findings.length + ' finding(s)'} — ${r.summary}`)

  const actionable = live.flatMap(r => (r.findings || []).filter(f => f.severity !== 'speculative').map(f => ({ ...f, source: r.key })))
  const speculative = live.flatMap(r => (r.findings || []).filter(f => f.severity === 'speculative').map(f => ({ ...f, source: r.key })))
  allFindings.push(...actionable, ...speculative)

  if (actionable.length === 0) {
    dryRounds++
    log(`round ${round}: no actionable findings (${speculative.length} speculative) — converged`)
    break
  }

  phase(round === 1 ? 'Repair' : `Repair (round ${round})`)
  const brief = actionable.map((f, i) => `${i + 1}. [${f.severity}] (from ${f.source}) ${f.title}\n   ${f.detail}`).join('\n\n')
  await agent(`You own /output. Independent verifiers found the following problems in the Python-to-Node port.
Fix ALL of them at the source (the right library module — do not paper over a bug in the entry point).

${SPEC}

FINDINGS:
${brief}

For each finding: reproduce it first, then fix it, then prove the fix by re-running the reproduction.
Some findings may be false positives — if you conclude one is, prove it with a command and its output and
say so explicitly instead of making a speculative change. Do not weaken or delete any test/self-check to
make something pass, and do not touch anything under /workspace/harness (those are the graders).

Then re-run the full suite and iterate until all four are green:
  node /workspace/harness/diff_vectors.mjs
  node /workspace/harness/diff_cli.mjs
  node /workspace/harness/diff_width.mjs
  bash /workspace/harness/diff_raw.sh
  node /workspace/harness/diff_fuzz.mjs 300 24680
  node /workspace/harness/diff_argv_fuzz.mjs 300 13579

Your final message: for each finding, one line saying FIXED (with the file changed) or FALSE-POSITIVE (with
the disproving evidence), then the final pass/fail line from every harness above.`,
    { label: `repair#${round}`, phase: round === 1 ? 'Repair' : `Repair (round ${round})` })
}

// ---------------------------------------------------------------- Review
phase('Review')

const finalChecks = await parallel([
  () => agent(`Final acceptance gate for the Python-to-Node port in /output. Run, in order, and report the
exact final line of each:
  node /workspace/harness/diff_vectors.mjs
  node /workspace/harness/diff_cli.mjs
  node /workspace/harness/diff_width.mjs
  bash /workspace/harness/diff_raw.sh
  node /workspace/harness/diff_fuzz.mjs 500 8675309
  node /workspace/harness/diff_fuzz.mjs 500 111
  node /workspace/harness/diff_argv_fuzz.mjs 500 22222
  node /workspace/harness/diff_argv_fuzz.mjs 500 98765
Also re-run the four documented sample test cases from /workspace/dataset/test15.py by hand and confirm the
two output lines and exit code 0 for each:
  key1='QU$h{ecq^#qb{L3M' key2='%%3u+dl)X>Iur%O(' data='^Z-jz9z*elH|LaA0'
  key1='o@Y5$=J*i3fc}j@i' key2='^)Bo{|},-!h+N?3:' data='MU72,Mn57hI?@|p1'
  key1='# U^*?eb+>m%,bg{' key2='z;TFC}m_zXVHnYvW' data='uMDU^:jC@eO9Emb)'
  key1=';[k@{V^g6X,ND0N{' key2='CO@7Yhw_oHCg5xP;' data='PtW;0FXof#;8pnZz'
Expected line 1/line 2 for those four are in /workspace/dataset/test15.py as comments — compare against them.
Do not modify anything. Report PASS or the failures.`, { label: 'acceptance', phase: 'Review', schema: FINDINGS }),

  () => agent(`Adversarial final review of /output. Your job is to find a reason this deliverable would be
REJECTED. Read every file. Consider: an ESM/CommonJS violation; a missing .mjs suffix in an import; a bare
(non node:) import; any trace of node:crypto or python; a hardcoded S-box; a stray file that does not belong;
a module that is unreachable dead code; a file written outside /output; reliance on /workspace at runtime;
a Node-18 incompatibility; output that differs by even one byte from the reference on the four documented
sample cases; a non-zero exit code where Python exits 0; buffered stdout lost on exit; anything that breaks
when cwd is not /output (test it: cd /tmp && node /output/test15.mjs ...), when the script is invoked through
a relative path, through a symlink, or with node flags before the script path (test:
node --no-warnings /output/test15.mjs --key1 0123456789012345 --key2 0123456789012345 --data 0123456789012345).
Also verify stdout is byte-exact when piped through \`head -c\` and when the pipe is closed early (no EPIPE crash).
Actually RUN your checks. Report only what you could reproduce. Do not fix anything.`, { label: 'adversary', phase: 'Review', schema: FINDINGS }),
])

const live = finalChecks.filter(Boolean)
for (const r of live) log(`FINAL ${r.clean ? 'CLEAN' : r.findings.length + ' finding(s)'}: ${r.summary}`)

const finalActionable = live.flatMap(r => (r.findings || []).filter(f => f.severity !== 'speculative'))
if (finalActionable.length) {
  phase('Review')
  await agent(`You own /output. Final blocking issues were found in the Python-to-Node port. Fix them all at
the source, then re-run every harness until green.

${SPEC}

ISSUES:
${finalActionable.map((f, i) => `${i + 1}. [${f.severity}] ${f.title}\n   ${f.detail}`).join('\n\n')}

Harnesses:
  node /workspace/harness/diff_vectors.mjs
  node /workspace/harness/diff_cli.mjs
  node /workspace/harness/diff_width.mjs
  bash /workspace/harness/diff_raw.sh
  node /workspace/harness/diff_fuzz.mjs 400 555
  node /workspace/harness/diff_argv_fuzz.mjs 400 666
Report FIXED/FALSE-POSITIVE per issue plus the final harness lines.`, { label: 'final-repair', phase: 'Review' })
}

return {
  rounds: round,
  totalFindings: allFindings.length,
  finalFindings: live.map(r => ({ clean: r.clean, summary: r.summary, findings: r.findings })),
}
