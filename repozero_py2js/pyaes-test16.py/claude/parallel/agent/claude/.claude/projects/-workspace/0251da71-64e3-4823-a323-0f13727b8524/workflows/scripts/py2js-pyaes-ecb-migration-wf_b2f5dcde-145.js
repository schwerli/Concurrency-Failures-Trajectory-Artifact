export const meta = {
  name: 'py2js-pyaes-ecb-migration',
  description: 'Migrate /workspace/dataset/test16.py (pyaes AES-ECB multi-block) to zero-dependency ESM Node.js in /output, then adversarially verify byte-for-byte against the executable',
  phases: [
    { title: 'Spec', detail: 'Probe the executable to pin down argparse, bytes-repr, AES key sizes, and traceback behavior' },
    { title: 'Implement', detail: 'Write hierarchical .mjs library modules (one agent per module, disjoint files)' },
    { title: 'Integrate', detail: 'Write entry test16.mjs, resolve imports, smoke-test the 4 sample cases' },
    { title: 'Verify', detail: 'Differential fuzz + edge-case + compliance audit against the executable' },
    { title: 'Fix', detail: 'Repair every confirmed divergence and re-verify' },
    { title: 'Final', detail: 'Full-sweep confirmation of stdout/stderr/exit-code parity' },
  ],
}

const EXE = '/workspace/dataset/test16_executable'

const SHARED = `
## Task context (already established — do not re-derive, but you MAY re-verify)

We are migrating this Python program to zero-dependency Node.js ESM:

\`\`\`python
import argparse
import pyaes

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--key', type=str, required=True)   # 16 bytes key
    parser.add_argument('--data', type=str, required=True)  # 48 bytes data (3 blocks)
    args = parser.parse_args()

    aes = pyaes.AESModeOfOperationECB(args.key.encode())
    data = args.data.encode()

    ciphertexts = []
    for i in range(0, len(data), 16):
        block = data[i:i+16]
        cipher = aes.encrypt(block)
        ciphertexts.append(cipher)

    for cipher in ciphertexts:
        print(cipher)

if __name__ == '__main__':
    main()
\`\`\`

Reference executable (run it freely, it is fast): \`${EXE} --key K --data D\`
DO NOT use the \`python\`/\`python3\` command to model behavior of the target program.
(You MAY use python3 only as a scratch calculator if truly needed, but prefer the executable.)

## Hard requirements on the generated code

- Output directory is \`/output\`. Working dir /workspace is read-only-ish; write only under /output.
- Pure JavaScript for Node.js. **ESM only**: \`import\`/\`export\`. \`require()\` and \`module.exports\` are STRICTLY PROHIBITED (not even in comments/strings as usable code).
- All files use the \`.mjs\` suffix. All relative imports must include the full \`.mjs\` suffix.
- **Zero external dependencies.** No npm packages. Only \`node:\`-prefixed built-ins are permitted for import, plus local \`./*.mjs\` files.
- **\`node:crypto\` is absolutely forbidden** — do not import it, do not call Cipher/Decipher/createCipheriv, do not even mention those interfaces. AES must be implemented from scratch in JS.
- No embedding/spawning Python.
- Hierarchical structure: libraries split into multiple modules by functionality, each exposing named \`export\`s.

## Established facts about the reference behavior (verified by the lead)

1. Sample cases (all 16-byte key, 48-byte data) reproduce exactly as in the docstring of the source file.
2. \`argparse\` behavior:
   - no args -> stderr:
     \`usage: test16_executable [-h] --key KEY --data DATA\`
     \`test16_executable: error: the following arguments are required: --key, --data\`
     exit code 2
   - only --key given -> \`...required: --data\`, exit 2
   - \`--help\` -> stdout:
     \`\`\`
     usage: test16_executable [-h] --key KEY --data DATA

     options:
       -h, --help   show this help message and exit
       --key KEY
       --data DATA
     \`\`\`
     exit 0
   - \`--key=V\` works; abbreviations \`--k\`, \`--ke\`, \`--d\`, \`--da\` work (unambiguous prefix matching)
   - unknown option -> \`test16_executable: error: unrecognized arguments: --foo 1\`, exit 2
   - stray positional -> \`test16_executable: error: unrecognized arguments: <val>\`, exit 2
   - duplicate \`--key A --key B\` -> last one wins
   - \`--key\` with no value -> \`test16_executable: error: argument --key: expected one argument\`, exit 2
   - The program name in usage/error lines is \`test16_executable\` (argparse's prog = basename of argv[0]).
3. Key size: \`.encode()\` is UTF-8. 16, 24, 32 **byte** keys all succeed (AES-128/192/256). Other sizes ->
   traceback on stderr ending with \`ValueError: Invalid key size\`, exit 1.
   Verified: \`--key 'aaaaaaaaaaaaaaé' --data '0123456789abcdef'\` (15 chars, 16 UTF-8 bytes) SUCCEEDS
   -> \`b'\\x9f\\xc8N\\x82\\xdcD,Z\\xb7F[Oh\\xb9\\xba\\xb5'\`, proving UTF-8 byte length is what matters.
   24-byte key 'a'*24 + data '0123456789abcdef' -> \`b'\\x7f<L\\x00\\xac\\xe7\\xae]V\\x05&\\\\\\xb8\\xc6\\x82\\x92'\`
   32-byte key 'a'*32 + data '0123456789abcdef' -> \`b'j\\xf3*\\x96\\x98\\n\`60\`i\\x96\\x90\\xd2\\xca\\xebxf\\x92'\` (verify yourself)
4. Data whose length is not a multiple of 16 -> the final short block raises:
   traceback on stderr ending with \`ValueError: plaintext block must be 16 bytes\`, exit 1.
   IMPORTANT: blocks before the short one are encrypted but NOT printed (printing happens after the loop),
   so stdout is EMPTY in that case.
   Empty data -> zero blocks -> no output, exit 0.
5. \`print(bytes)\` uses Python's bytes repr: \`b'...'\`, switching to \`b"..."\` when the payload contains
   a \`'\` and no \`"\`. Confirmed real examples from the executable:
   \`b"\\x80\\x084.\\xed\\xe3\\xf5\\xb0/\\xcbu\\x1f\\xcf'|\\xd2"\` and \`b'\\x9a"p\\xd0;\\x85\\xfd\\x8b\\xc3n\\x1d\\xe4\\xc8i\\xd6\\x17'\`.
6. Traceback text for the two error paths (stderr), observed verbatim:
\`\`\`
Traceback (most recent call last):
  File "test16.py", line 26, in <module>
  File "test16.py", line 11, in main
  File "pyaes/aes.py", line 304, in __init__
  File "pyaes/aes.py", line 134, in __init__
ValueError: Invalid key size
[PYI-149:ERROR] Failed to execute script 'test16' due to unhandled exception!
\`\`\`
\`\`\`
Traceback (most recent call last):
  File "test16.py", line 26, in <module>
  File "test16.py", line 18, in main
  File "pyaes/aes.py", line 342, in encrypt
ValueError: plaintext block must be 16 bytes
[PYI-151:ERROR] Failed to execute script 'test16' due to unhandled exception!
\`\`\`
The \`149\`/\`151\` is the process id, so it is inherently non-reproducible; use \`process.pid\`.
Correct **exit code** and **empty stdout** matter most for these paths.

## Planned module layout (keep to it unless you have a strong reason)

- /output/lib/pybytes.mjs        — Python \`bytes\` repr + UTF-8 encode helpers
- /output/lib/argparse.mjs       — minimal argparse emulation (prefix matching, required, usage/help, exit codes)
- /output/lib/aes/tables.mjs     — AES S-box / inverse S-box / rcon / GF multiply tables
- /output/lib/aes/core.mjs       — AES key expansion + single-block encrypt/decrypt
- /output/lib/aes/modes.mjs      — pyaes-compatible AESModeOfOperationECB (+ its ValueError semantics)
- /output/lib/pyaes.mjs          — aggregator that re-exports the pyaes-shaped public API
- /output/lib/pyerrors.mjs       — Python traceback / PyInstaller failure-line emulation, exit codes
- /output/test16.mjs             — entry point mirroring main()
`

// ---------------------------------------------------------------- schemas
const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, implementable rules discovered, each with the evidence that established it',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          evidence: { type: 'string' },
          confidence: { type: 'string', enum: ['verified', 'inferred'] },
        },
        required: ['rule', 'evidence', 'confidence'],
      },
    },
    testVectors: {
      type: 'array',
      description: 'Concrete input->exact output pairs usable as regression tests',
      items: {
        type: 'object',
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          stdout: { type: 'string' },
          exitCode: { type: 'integer' },
        },
        required: ['argv', 'stdout', 'exitCode'],
      },
    },
    gotchas: { type: 'array', items: { type: 'string' } },
  },
  required: ['area', 'rules', 'testVectors', 'gotchas'],
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' }, description: 'absolute paths written' },
    exports: { type: 'array', items: { type: 'string' }, description: 'named exports provided' },
    imports: { type: 'array', items: { type: 'string' }, description: 'local .mjs paths this module imports' },
    notes: { type: 'string' },
    selfTest: { type: 'string', description: 'what you ran and the observed result' },
    ok: { type: 'boolean' },
  },
  required: ['files', 'exports', 'imports', 'notes', 'selfTest', 'ok'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          repro: { type: 'string', description: 'exact shell commands showing JS vs executable divergence' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'repro', 'expected', 'actual', 'fix'],
      },
    },
    casesRun: { type: 'integer' },
    allMatched: { type: 'boolean' },
  },
  required: ['lens', 'findings', 'casesRun', 'allMatched'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    reproConfirmed: { type: 'string' },
  },
  required: ['real', 'refuted', 'reasoning', 'reproConfirmed'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    fixed: { type: 'boolean' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    what: { type: 'string' },
    verification: { type: 'string' },
  },
  required: ['fixed', 'filesChanged', 'what', 'verification'],
}

// ---------------------------------------------------------------- Phase 1: Spec
phase('Spec')

const SPEC_TASKS = [
  {
    key: 'argparse',
    prompt: `You are pinning down the EXACT argparse-compatible CLI behavior of the reference executable, for later reimplementation in JS.

Probe \`${EXE}\` exhaustively for CLI surface behavior. Cover at minimum:
- missing one/both required args (exact stderr text, ordering of names in the "required:" list, exit code)
- \`--help\` and \`-h\` (exact stdout, including blank lines and column alignment of the options block — count spaces precisely with \`cat -A\` or \`od -c\`)
- \`--key=V\` / \`--data=V\` equals-form, including a value that itself contains \`=\`
- prefix abbreviation: \`--k\`, \`--ke\`, \`--key\`, \`--d\`, \`--da\`; is there any ambiguous prefix? (both options start with different letters, so check \`--\` alone)
- unrecognized options and stray positionals — exact message, how multiple unrecognized items are joined
- an option value that starts with \`-\` (e.g. \`--key -abcdefghijklmno\`) and one that looks like a negative number (\`--key -1\`); argparse has special negative-number handling — determine what actually happens
- \`--\` pseudo-argument separator behavior
- duplicate options, option given after an unrecognized one
- empty-string values
- \`--keyx\` (superstring, not a prefix)
- ordering: does the "unrecognized arguments" error appear before or instead of the "required" error when both apply?
- exact exit codes for each path, and whether text goes to stdout or stderr (test with 1>/dev/null and 2>/dev/null separately)

Use \`od -c\` / \`cat -A\` on captured output to get whitespace exactly right. Report every rule with the command that proves it. Include the full literal help text and usage text as testVectors (stdout field) where applicable.`,
  },
  {
    key: 'bytesrepr',
    prompt: `You are pinning down Python's \`print(bytes_object)\` repr formatting exactly, as emitted by the reference executable, so it can be reimplemented in JS.

The program prints raw 16-byte AES ciphertext blocks via \`print(cipher)\`. You must determine the complete repr rule set for ALL 256 possible byte values, plus the quote-selection rule.

Strategy: you cannot choose ciphertext bytes directly, but you can brute-force search — run \`${EXE}\` with many random 16-byte keys/data (a bash or node loop; ~ a few thousand runs is fine and fast) and collect the outputs. Across enough samples you will observe every byte value and both quoting styles. Ideally also find a sample whose payload contains BOTH \`'\` (0x27) and \`"\` (0x22) to determine what happens then (expected: stays b'...' with \\' escaped — CONFIRM it, do not assume).

Determine and report:
- which byte values are emitted literally
- exact escapes for 0x09, 0x0a, 0x0d, 0x5c, 0x27, 0x22, 0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f, 0x7f, 0x80-0xff
- hex-escape casing (\\xNN — lowercase letters? zero-padded?)
- the quote-selection rule (single quotes default; double quotes iff payload contains 0x27 and not 0x22)
- whether \`print\` adds exactly one trailing \\n per line and whether the final line has a trailing newline

Write your brute-force harness under /tmp (NOT /output). Report a table of byte-value -> emitted text as rules, and include at least 6 real observed input->stdout pairs as testVectors (use short, shell-safe ASCII keys/data so they are easy to re-run; prefer alphanumeric-only values to avoid quoting issues).`,
  },
  {
    key: 'aes',
    prompt: `You are establishing ground-truth AES test vectors from the reference executable so a from-scratch JS AES implementation can be validated.

The program does raw AES ECB single-block encryption (no padding) with keys of 16/24/32 UTF-8 bytes.

Collect and report:
1. Confirm AES-128 against the FIPS-197 known-answer test as closely as you can with printable-ASCII-only inputs (the CLI only accepts text, so you cannot feed arbitrary binary — note this limitation explicitly).
2. Generate a solid regression suite: for each key size (16, 24, 32 bytes) produce at least 5 (key, data) pairs of printable ASCII where data is 16/32/48/64 bytes, and record the EXACT stdout.
3. Determine behavior for key sizes that are NOT 16/24/32 bytes (e.g. 0, 1, 15, 17, 23, 25, 31, 33) — exact stderr tail, exit code, and whether stdout is empty. Note: an empty \`--key ''\` is an interesting case, report it.
4. Determine data-length behavior: 0, 1, 15, 16, 17, 31, 32, 48, 64, 80 bytes — how many lines printed, exit code, stdout emptiness on failure. Confirm that a trailing short block means NOTHING is printed at all (because print happens after the whole encryption loop).
5. Multi-byte UTF-8 in key and data: verify that byte length (not character count) governs both key validation and block splitting. Give at least 2 vectors with non-ASCII characters, and be careful to record the exact bytes you passed (use a shell \`printf\` or a node script to build argv so it is unambiguous — record the exact command).
6. Confirm ECB determinism: identical plaintext blocks within one invocation produce identical ciphertext lines.

Report all of it as rules + testVectors. testVectors[].argv must be the literal argv array (e.g. ["--key","aaaaaaaaaaaaaaaa","--data","0123456789abcdef"]) and stdout the exact expected stdout including newlines.`,
  },
  {
    key: 'errpaths',
    prompt: `You are pinning down the failure-path output of the reference executable (stderr text, stdout emptiness, exit codes) so it can be emulated.

Probe \`${EXE}\` for every failure mode and record, for each: exact stdout (usually empty — verify with \`od -c\`), exact stderr, and exit code.

Cover:
- invalid key size (short, long, empty, 17, 23, 25, 31, 33 bytes)
- data length not a multiple of 16
- both wrong at once — which error wins?
- argparse errors (missing required, unknown arg, missing value) vs runtime errors — different exit codes (2 vs 1)?
- Is the traceback's \`[PYI-<n>:ERROR]\` number the process id? Run the same failing command several times and see whether the number changes and whether it tracks the pid (compare with \`echo $$\`-adjacent pids or just observe it varies and is close to the shell's next pid).
- Does anything get written to stdout before a runtime failure? (crucial: confirm stdout is byte-empty)
- Behavior when stdout is a closed pipe / when piping to \`head -1\` (just note it; do not over-engineer)

Also determine the line numbers in the traceback frames and reproduce the two traceback texts verbatim as rules. Report exit codes as the single most important thing to match.`,
  },
]

const specs = await parallel(SPEC_TASKS.map((t) => () =>
  agent(SHARED + '\n\n# YOUR ASSIGNMENT\n\n' + t.prompt, {
    label: `spec:${t.key}`,
    phase: 'Spec',
    schema: SPEC_SCHEMA,
  })
))

const specValid = specs.filter(Boolean)
log(`Spec phase: ${specValid.length}/${SPEC_TASKS.length} spec agents returned; ${specValid.reduce((n, s) => n + s.rules.length, 0)} rules, ${specValid.reduce((n, s) => n + s.testVectors.length, 0)} test vectors`)

const SPEC_DIGEST = specValid.map((s) => {
  const rules = s.rules.map((r) => `  - [${r.confidence}] ${r.rule}\n    evidence: ${r.evidence}`).join('\n')
  const vecs = s.testVectors.slice(0, 40).map((v) => `  - argv=${JSON.stringify(v.argv)} exit=${v.exitCode} stdout=${JSON.stringify(v.stdout)}`).join('\n')
  const got = s.gotchas.map((g) => `  - ${g}`).join('\n')
  return `### Spec area: ${s.area}\nRules:\n${rules}\nTest vectors:\n${vecs}\nGotchas:\n${got}`
}).join('\n\n')

// Persist the digest so later agents can read it from disk too.
await agent(
  `Write the following verified specification digest verbatim to \`/output/.spec-digest.md\` (create the /output directory if needed). Do not alter the content, do not summarize it, do not add commentary. Then reply with just the word DONE and the byte size of the file.\n\n<<<DIGEST\n${SPEC_DIGEST}\n>>>DIGEST`,
  { label: 'spec:persist', phase: 'Spec' }
)

// ---------------------------------------------------------------- Phase 2: Implement
phase('Implement')

const CONTEXT = SHARED + `

# VERIFIED SPECIFICATION DIGEST (from the Spec phase — trust this, it was probed from the executable)

${SPEC_DIGEST}

(The same digest is on disk at /output/.spec-digest.md)
`

const MODULES = [
  {
    key: 'tables+core',
    file: '/output/lib/aes/tables.mjs and /output/lib/aes/core.mjs',
    prompt: `Implement the AES primitive, from scratch, in two modules.

**/output/lib/aes/tables.mjs**
Export the AES lookup tables. Prefer COMPUTING them at module load from first principles (GF(2^8) arithmetic) over pasting giant literal arrays — it is shorter, self-verifying, and less error-prone. Export at least:
- \`S\` (forward S-box, Uint8Array(256))
- \`SI\` (inverse S-box)
- \`RCON\` (round constants, enough for AES-256: at least 11 entries; index 1-based like the FIPS spec or document your convention)
- \`xtime\`/\`gmul\` helpers or the four T-tables — your choice, but keep it clear
Include a tiny internal consistency assertion (e.g. S[0x00]===0x63, S[0x53]===0xed, SI[S[i]]===i for all i) that throws on mismatch at import time. Keep it cheap.

**/output/lib/aes/core.mjs**
\`import\` from './tables.mjs' (with the .mjs suffix) and export:
- \`expandKey(keyBytes: Uint8Array): { roundKeys, rounds }\` supporting 16/24/32-byte keys (Nk 4/6/8, Nr 10/12/14), including the AES-192/256 key-schedule quirks (the extra SubWord for Nk=8 at i%Nk===4).
- \`encryptBlock(state16: Uint8Array, schedule): Uint8Array\` — 16-byte in, 16-byte out, ECB/raw, no padding.
- \`decryptBlock(block16: Uint8Array, schedule): Uint8Array\` — for completeness/symmetry.
Use the column-major state ordering AES specifies (byte i -> state[i%4][i/4]) or an equivalent flat formulation — whichever you choose, VALIDATE it, do not hand-wave.

**Validation you MUST perform before reporting ok:true** (this is the whole point):
1. FIPS-197 Appendix C known-answer vectors for AES-128/192/256 with plaintext 00112233445566778899aabbccddeeff:
   - AES-128 key 000102...0f -> 69c4e0d86a7b0430d8cdb78070b4c55a
   - AES-192 key 000102...17 -> dda97ca4864cdfe06eaf70a0ec0d7191
   - AES-256 key 000102...1f -> 8ea2b7ca516745bfeafc49904b496089
   Write a scratch test at /tmp/aes-kat.mjs and run \`node /tmp/aes-kat.mjs\`. All three must pass.
2. Round-trip: decryptBlock(encryptBlock(x)) === x for several random blocks and all three key sizes.
3. Cross-check against the reference executable for at least 3 printable-ASCII cases per key size: build the expected hex yourself and confirm the executable's repr bytes agree. (Convert the executable's Python repr to bytes with a small node scratch script — do NOT use python.)

Report ok:false if any check fails. Do not write anything outside /output/lib/aes/ and /tmp.
Do NOT import node:crypto for anything, not even to generate random bytes — use a deterministic LCG in scratch tests.`,
  },
  {
    key: 'modes+pyaes',
    file: '/output/lib/aes/modes.mjs and /output/lib/pyaes.mjs',
    prompt: `Implement the pyaes-shaped public API on top of the AES core.

You may assume a teammate is concurrently writing \`/output/lib/aes/core.mjs\` exporting exactly:
  \`expandKey(keyBytes) -> schedule\`, \`encryptBlock(block16, schedule) -> Uint8Array\`, \`decryptBlock(block16, schedule) -> Uint8Array\`
and \`/output/lib/aes/tables.mjs\`. Import from './core.mjs'. If core.mjs is not on disk yet when you finish, that is fine — do not create it, do not stub it, and do not edit it (that would clobber your teammate). Just make sure your imports match that contract exactly. If core.mjs IS on disk, read it and adapt to its real signatures, keeping the contract above if possible.

**/output/lib/aes/modes.mjs** — export \`class AESModeOfOperationECB\`:
- constructor(key) — accepts a Uint8Array/Buffer (also tolerate a JS string by UTF-8 encoding it, mirroring pyaes' string tolerance). Validate the key BYTE length is 16/24/32; otherwise throw an error object that carries the Python-visible message \`Invalid key size\` and a marker so the entry point can render the right traceback and exit code (see /output/lib/pyerrors.mjs — a teammate is writing it, exporting \`PyValueError\` (an Error subclass taking a message) plus traceback renderers. Import \`PyValueError\` from '../pyerrors.mjs' and construct it with the message; do NOT create pyerrors.mjs yourself).
- \`name\` property = "Electronic Codebook (ECB)" (pyaes sets this).
- \`encrypt(plaintext)\` — must throw \`PyValueError('plaintext block must be 16 bytes')\` when the block is not exactly 16 bytes; otherwise return the 16 ciphertext bytes as a Uint8Array.
- \`decrypt(ciphertext)\` — symmetric, same 16-byte validation with the pyaes message for decrypt (\`ciphertext block must be 16 bytes\`).
- Keep the key schedule computed once in the constructor and reused (matching pyaes semantics where one cipher object encrypts many blocks).

**/output/lib/pyaes.mjs** — the aggregator standing in for \`import pyaes\`:
- re-export \`AESModeOfOperationECB\` and anything else useful (\`AES\` core class-ish wrapper if you like) as named exports
- also provide a \`default\` export object shaped like the Python module (\`{ AESModeOfOperationECB }\`) so \`import pyaes from './lib/pyaes.mjs'\` then \`new pyaes.AESModeOfOperationECB(...)\` reads like the original. Both named and default.

Report the exact export surface you provide so the integrator can rely on it. Do not write any file other than these two.`,
  },
  {
    key: 'pybytes',
    file: '/output/lib/pybytes.mjs',
    prompt: `Implement Python bytes/str semantics helpers.

**/output/lib/pybytes.mjs** — export:
- \`encodeUtf8(str) -> Uint8Array\` — exactly Python's \`str.encode()\` (UTF-8). Use \`node:util\`'s TextEncoder or the global TextEncoder (a global is fine and needs no import). Think about lone surrogates: Node's TextEncoder emits U+FFFD (EF BF BD) for an unpaired surrogate, which is what we want for parity with typical shell input; note the caveat rather than over-engineering.
- \`bytesRepr(bytes) -> string\` — Python 3's \`repr(bytes)\`, i.e. what \`print(b'..')\` emits (minus the newline).
- \`pyPrint(bytes)\` or similar helper if useful, but the entry point will handle stdout.

\`bytesRepr\` rules — implement them EXACTLY per the verified spec digest:
- payload is built per byte; quote character is \`'\` unless the payload contains 0x27 AND does not contain 0x22, in which case \`"\`
- when the quote is \`'\`, a 0x27 byte is escaped as \\' ; when the quote is \`"\`, a 0x22 byte would be escaped as \\" (that combination cannot arise given the rule, but implement it correctly anyway — mirror CPython)
- 0x5c -> \\\\ ; 0x09 -> \\t ; 0x0a -> \\n ; 0x0d -> \\r
- printable ASCII 0x20..0x7e (other than the escapes above) -> literal
- everything else (0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f, 0x7f, 0x80-0xff) -> \\xNN with LOWERCASE hex, zero-padded to 2 digits
- result is \`b\` + quote + payload + quote

Accept Uint8Array, Buffer, or array-of-numbers input. Be defensive about non-integer/out-of-range values (mask to & 0xff).

**Validation you MUST perform**: write /tmp/repr-test.mjs that exercises all 256 byte values and the quote-selection branches, and cross-check several REAL outputs from the reference executable (from the spec digest's test vectors — re-run them) by re-deriving the repr from the ciphertext bytes. Since you cannot get the raw bytes from the executable directly, do the inverse: PARSE the executable's repr output back into bytes with an independent parser, then re-render with your bytesRepr and confirm you get the identical string back (round-trip on real data — do this for at least 200 distinct executable outputs from a loop so you cover the full byte range and both quote styles). Report casesRun-style detail in selfTest.

Do not write any file other than /output/lib/pybytes.mjs (plus /tmp scratch).`,
  },
  {
    key: 'argparse',
    file: '/output/lib/argparse.mjs',
    prompt: `Implement the argparse emulation.

**/output/lib/argparse.mjs** — export a small, honest emulation of the subset of \`argparse\` this program uses. Suggested surface:
- \`class ArgumentParser\` with \`constructor({ prog } = {})\` (default prog = basename of process.argv[1]... BUT read the spec: the reference prog is \`test16_executable\`. The graders run \`node test16.mjs --key ... --data ...\` and compare against \`/workspace/dataset/test16_executable ...\`. Therefore the prog string must be **\`test16_executable\`** to match byte-for-byte. Hard-code that as the default prog in the entry point (pass it in explicitly from test16.mjs — keep argparse.mjs generic with a prog option). Document this decision in a comment.)
- \`addArgument(name, { type, required, help })\` supporting long options only (\`--key\`), \`required\`, and \`type: String\`
- \`parseArgs(argv)\` -> plain object of values keyed by the de-dashed name (\`key\`, \`data\`)
- \`formatUsage()\`, \`formatHelp()\`, \`error(msg)\`, \`exit(code, message)\`

Behavior that MUST match the reference exactly (see the spec digest for verbatim strings):
- usage line: \`usage: test16_executable [-h] --key KEY --data DATA\` (note: required options still appear without brackets, in the order added, after \`[-h]\`)
- \`-h\`/\`--help\`: print the full help to STDOUT, exit 0. Reproduce the blank line and the exact column alignment of the options block character-for-character (\`  -h, --help   show this help message and exit\`, then \`  --key KEY\`, then \`  --data DATA\`). Do not compute a clever column width that happens to differ — match the observed bytes. Consider hard-coding derived-but-verified spacing, with a comment explaining it mirrors argparse's HelpFormatter.
- errors go to STDERR as \`<usage line>\\n<prog>: error: <msg>\\n\` and exit 2
- missing required: \`the following arguments are required: --key, --data\` (comma+space joined, in the order the arguments were added, only the missing ones)
- \`--key=V\` equals form, including values containing \`=\`
- unambiguous prefix abbreviation (\`--k\`, \`--ke\`, \`--d\`, \`--da\`), and the correct ambiguity error if a prefix matched several options (implement it even though it cannot happen here)
- unrecognized arguments (options and stray positionals): \`unrecognized arguments: <items joined by a single space>\` — match the reference's ordering/joining exactly
- missing value: \`argument --key: expected one argument\`
- last occurrence of a repeated option wins
- correct precedence between the "required" error and the "unrecognized" error (the spec digest states which fires first — follow it; argparse collects unrecognized extras in parse_known_args and reports them AFTER required-checking, so verify against the digest and the executable)
- value that begins with \`-\`: replicate argparse's actual behavior (it normally refuses to treat \`-abc\` as a value and reports "expected one argument"; a negative-number-looking token may be accepted when the parser has no options that look like negative numbers). Follow the spec digest's verified findings, and re-verify the tricky ones yourself against the executable.

**Validation**: write /tmp/argparse-test.mjs (or a bash differential script) that runs BOTH \`node <a tiny harness that uses your parser>\` and the reference executable across ~40 argv shapes, comparing stdout/stderr/exit code. You will not have the real entry point yet, so build a throwaway harness in /tmp that imports /output/lib/argparse.mjs and just prints the parsed values or lets errors happen. Compare only the argparse-relevant paths. Report what matched.

Do not write any file other than /output/lib/argparse.mjs (plus /tmp scratch).`,
  },
  {
    key: 'pyerrors',
    file: '/output/lib/pyerrors.mjs',
    prompt: `Implement the Python-exception / traceback emulation.

**/output/lib/pyerrors.mjs** — export:
- \`class PyValueError extends Error\` — constructor(message); has \`pyType = 'ValueError'\`. This is what modes.mjs throws.
- \`renderTraceback({ frames, excType, message })\` -> the exact multi-line Python traceback string (no trailing newline, or document which).
- \`TRACEBACK_INVALID_KEY_SIZE\` and \`TRACEBACK_BAD_BLOCK_SIZE\` — the two verbatim frame lists observed from the reference, so the entry point can emit them:
\`\`\`
Traceback (most recent call last):
  File "test16.py", line 26, in <module>
  File "test16.py", line 11, in main
  File "pyaes/aes.py", line 304, in __init__
  File "pyaes/aes.py", line 134, in __init__
ValueError: Invalid key size
\`\`\`
\`\`\`
Traceback (most recent call last):
  File "test16.py", line 26, in <module>
  File "test16.py", line 18, in main
  File "pyaes/aes.py", line 342, in encrypt
ValueError: plaintext block must be 16 bytes
\`\`\`
- \`pyiFailureLine(scriptName)\` -> \`[PYI-<pid>:ERROR] Failed to execute script '<scriptName>' due to unhandled exception!\` using \`process.pid\`. (The reference is a PyInstaller bundle; the number is the pid and is inherently not reproducible. Document that in a comment.)
- \`dieWithTraceback(err, { scriptName })\` -> writes the right traceback + PYI line to **stderr** and exits with code **1**, writing NOTHING to stdout. Choose the traceback by inspecting the error message (\`Invalid key size\` vs \`plaintext block must be 16 bytes\`), with a generic fallback renderer for anything else.

Use \`process.stderr.write\` and \`process.exit\`. Make sure stderr is flushed before exit — on Node, \`process.exit()\` can truncate async writes to a pipe. Handle that (e.g. write synchronously via \`node:fs\` writeSync(2, ...) — importing \`node:fs\` is allowed). This matters: verify it by piping stderr to \`cat\` and confirming nothing is lost.

**Validation**: build a /tmp harness that throws each error and confirm the stderr bytes match the reference executable's stderr except for the pid number (diff with the pid line filtered out), and that exit code is 1 and stdout is byte-empty.

Do not write any file other than /output/lib/pyerrors.mjs (plus /tmp scratch).`,
  },
]

const impls = await parallel(MODULES.map((m) => () =>
  agent(CONTEXT + '\n\n# YOUR ASSIGNMENT (write ONLY your own files — teammates own the others)\n\n' + m.prompt, {
    label: `impl:${m.key}`,
    phase: 'Implement',
    schema: IMPL_SCHEMA,
  })
))

const implOk = impls.filter(Boolean)
log(`Implement phase: ${implOk.filter((i) => i.ok).length}/${MODULES.length} modules self-reported ok`)

const IMPL_DIGEST = implOk.map((i, n) =>
  `### Module group ${MODULES[n] ? MODULES[n].key : n}\nfiles: ${i.files.join(', ')}\nexports: ${i.exports.join(', ')}\nimports: ${i.imports.join(', ')}\nok: ${i.ok}\nnotes: ${i.notes}\nselfTest: ${i.selfTest}`
).join('\n\n')

// ---------------------------------------------------------------- Phase 3: Integrate
phase('Integrate')

const INTEGRATE_CONTEXT = CONTEXT + `

# MODULE REPORTS FROM THE IMPLEMENT PHASE

${IMPL_DIGEST}
`

const integration = await agent(INTEGRATE_CONTEXT + `

# YOUR ASSIGNMENT: integrate and make it actually run

1. Read EVERY file under /output (\`ls -R /output\`, then read each .mjs). Fix any mismatch between what modules import and what their dependencies actually export — import/export contracts were negotiated in parallel, so drift is likely. You own all files now.
2. Write **/output/test16.mjs**, the entry point mirroring \`main()\`:
   - shebang-free, ESM, imports only local \`./lib/*.mjs\` (plus \`node:\` built-ins if needed)
   - build the parser with prog \`test16_executable\`, add \`--key\` (type String, required) and \`--data\` (type String, required)
   - parse \`process.argv.slice(2)\`
   - \`encodeUtf8\` the key, construct \`AESModeOfOperationECB\`
   - \`encodeUtf8\` the data, loop \`for (let i = 0; i < data.length; i += 16)\` slicing \`data.subarray(i, i+16)\`, encrypt each, COLLECT into an array
   - only AFTER the loop, print each ciphertext via \`bytesRepr\` + '\\n' to stdout — this ordering is load-bearing: a mid-loop failure must leave stdout empty
   - wrap the body so PyValueError -> \`dieWithTraceback\` (stderr traceback, exit 1, empty stdout)
   - export something (e.g. \`export { main }\`) so the file satisfies the "expose interfaces through export" requirement, while still auto-running when invoked directly. Auto-run unconditionally is simplest and safest for the grader — just call main() at the bottom; also \`export { main }\`.
   - Use a synchronous, un-truncatable stdout write path (accumulate the whole output and \`writeSync(1, ...)\`, or process.stdout.write then exit on drain). Verify by piping to \`cat\` and to \`head\`.
3. Confirm the 4 documented sample cases byte-for-byte:
   - key \`4)9PfvFH4vtYbj #\` data \`Fgoy$38USLH;|sEffFv7IVmVvO-=IWE|@6LV<[pA5.8GNQo[\`
   - key \`f,up,%MXu2|y^cJf\` data \`W{m+z}@i*7%BK&yVe)wpquY9^u}VX2oNJ]27B:Z#S1$JedU+\`
   - key \`et5Cx<|7}!5JG{ (\` data \`3swAe|hlrAO2+Lpw.JEW $4SYBa$E-3EV.^:BW0a|dr^XGE3\`
   - key \`Z8#}u)^9o)CW($f1\` data \`+P1ydM>N}cd82*UgcbG&kil%L>-;tdw2#d ^S4wScbH0xu#9\`
   Use \`diff <(node /output/test16.mjs ...) <(${EXE} ...)\` and also compare exit codes. Mind shell quoting — prefer a node or bash script that passes argv via an array/exec to avoid quoting mistakes.
4. Also smoke-test: --help, no args, missing one arg, bad key size, 15-byte data, empty data, 24- and 32-byte keys, 80-byte data.
5. Write **/output/run-diff.mjs** — a reusable differential harness (ESM, zero deps, may use node:child_process) that takes a list of argv arrays, runs both \`node /output/test16.mjs <argv>\` and the reference executable with \`spawnSync\` (argv array form — no shell), and reports any stdout/exit-code mismatch (and stderr mismatch ignoring the \`[PYI-<pid>:...]\` line). It must exit non-zero if anything mismatches and print a compact diff. Make it accept cases from a JSON file path via argv, and include a built-in default case list. This is for the Verify phase — make it good.
6. Optional but nice: /output/README.md documenting the module layout.

Report the final file tree, every export, and the literal command+output proving all 4 sample cases pass. If something does not match, FIX IT — do not report success on a mismatch.`, {
  label: 'integrate',
  phase: 'Integrate',
  schema: {
    type: 'object',
    properties: {
      fileTree: { type: 'array', items: { type: 'string' } },
      samplesPass: { type: 'boolean' },
      smokePass: { type: 'boolean' },
      evidence: { type: 'string' },
      remainingIssues: { type: 'array', items: { type: 'string' } },
      diffHarnessPath: { type: 'string' },
    },
    required: ['fileTree', 'samplesPass', 'smokePass', 'evidence', 'remainingIssues', 'diffHarnessPath'],
  },
})

log(`Integrate: samples=${integration && integration.samplesPass} smoke=${integration && integration.smokePass} files=${integration ? integration.fileTree.length : 0}`)

const STATE = INTEGRATE_CONTEXT + `

# INTEGRATION REPORT

fileTree:
${integration ? integration.fileTree.map((f) => '  - ' + f).join('\n') : '(integration agent failed — inspect /output yourself)'}
samplesPass: ${integration ? integration.samplesPass : 'unknown'}
smokePass: ${integration ? integration.smokePass : 'unknown'}
evidence: ${integration ? integration.evidence : ''}
remainingIssues: ${integration ? integration.remainingIssues.join(' | ') : ''}
diff harness: ${integration ? integration.diffHarnessPath : '/output/run-diff.mjs'}
`

// ---------------------------------------------------------------- Phase 4/5: Verify + Fix rounds
const LENSES = [
  {
    key: 'fuzz-happy',
    prompt: `Differential-fuzz the HAPPY PATH at scale.

Generate at least 400 random test cases with a DETERMINISTIC PRNG (an LCG — \`Math.random\` is fine here since you are a normal agent, but deterministic is nicer for reporting; either way record the exact failing argv). Vary:
- key byte length across {16, 24, 32}
- data byte length across {0, 16, 32, 48, 64, 80, 160}
- character classes: printable ASCII including quotes/backslashes/spaces/tabs, digits, and multi-byte UTF-8 (2-, 3-, and 4-byte sequences: é, ±, 中, 😀) — remembering that byte length, not char count, must hit the size constraints
- values containing leading/trailing spaces, \`=\`, \`-\`, and shell metacharacters

CRITICAL: pass argv as an ARRAY via spawnSync without a shell, for BOTH programs, so quoting can never differ. Use or extend /output/run-diff.mjs.

Compare stdout byte-for-byte and exit codes. Report EVERY divergence with the exact argv array (JSON) so it can be replayed. If everything matches, say so and report casesRun honestly.`,
  },
  {
    key: 'fuzz-repr',
    prompt: `Differential-fuzz specifically to exercise the full 0x00-0xff range of the bytes-repr renderer and both quote styles.

Run at least 800 random 16-byte-key / 16-byte-data cases through both programs and compare stdout exactly. Track which of the 256 byte values you have actually observed in the reference output (parse the reference repr back to bytes with your own independent parser, written fresh — do NOT import /output/lib/pybytes.mjs for the parsing side, that would be circular) and keep going until you have seen ALL 256 byte values at least once, plus at least 5 outputs using the \`b"..."\` double-quote form, plus (if you can find one) an output whose payload contains both 0x27 and 0x22. Report your coverage numbers explicitly — coverage is the deliverable here.

Report any divergence with the exact argv. Also independently sanity-check the repr of the specific tricky bytes: 0x09 0x0a 0x0d 0x20 0x22 0x27 0x5c 0x7e 0x7f 0x80 0xff — confirm from real observed output, not from reasoning.`,
  },
  {
    key: 'cli-adversarial',
    prompt: `Adversarially attack the CLI/argparse surface for divergence.

Run at least 60 hostile argv shapes through both programs (argv arrays via spawnSync, no shell) and compare stdout, stderr (ignoring only the \`[PYI-<pid>:ERROR]\` line), and exit code:
- no args; only --key; only --data; --help; -h; --help with other args; -h after an error-triggering arg
- --key= (empty value via equals); --key '' ; --data ''
- abbreviations --k --ke --key --d --da; --keys; --dat; --datax; -k; -key (single dash)
- --key=with=equals=signs
- values starting with '-' and '--'; --key -1; --key -12.5; --key -abc
- \`--\` separator in various positions
- repeated options; interleaved order (--data before --key)
- unknown options alone and combined with missing required
- extra positionals, multiple extra positionals (check joining/order in the message)
- an argv with only \`--\`
- extremely long values (e.g. 10000 chars) — check nothing truncates
- --key with a value containing a newline and a NUL-free control char

Report every divergence with the exact argv array. Note which mismatches are in stdout/exit-code (must-fix) vs stderr-only (still fix if cheap).`,
  },
  {
    key: 'error-paths',
    prompt: `Adversarially verify the FAILURE paths.

For at least 40 failing invocations (invalid key sizes 0,1,15,17,23,25,31,33,64 bytes; data lengths 1,15,17,31,33,47,49,63 bytes; both-invalid combinations; UTF-8 cases where char count looks right but byte count does not), compare between both programs:
- exit code (MUST match: 1 for runtime ValueError, 2 for argparse errors)
- stdout must be byte-EMPTY (verify with a byte-length check, not a visual one) — in particular confirm that when block 3 of 4 fails, the JS program prints NOTHING, matching Python's print-after-loop ordering
- stderr equality ignoring the \`[PYI-<pid>:ERROR]\` line

Also test which error wins when the key is invalid AND the data length is invalid, and when an argparse error coexists with a runtime error.
Also verify robustness: no unhandled Node stack traces leaking into stderr, no "UnhandledPromiseRejection", no ERR_MODULE_NOT_FOUND.

Report every divergence with exact argv.`,
  },
  {
    key: 'compliance',
    prompt: `Audit the deliverable against the HARD REQUIREMENTS. This is a static/compliance review, not a behavior diff — but verify claims by running commands, not by eyeballing.

Check and prove each with a command:
1. Every file under /output that contains code uses the \`.mjs\` suffix. No \`.js\`/\`.cjs\` code files. (\`find /output -type f | sort\`)
2. Zero \`require(\` and zero \`module.exports\` anywhere in /output (\`grep -rn\`). Also no \`exports.\` CommonJS assignment, no \`__dirname\`/\`__filename\` bare usage that would break in ESM.
3. Every \`import\` in /output resolves to either a \`node:\`-prefixed built-in or a local relative path ENDING IN \`.mjs\`. No bare package specifiers (\`grep -rnE "from ['\\"][^.n]"\` and review every import line manually).
4. **No \`node:crypto\`, no \`crypto\`, no \`createCipheriv\`, no \`createDecipheriv\`, no \`Cipher\`/\`Decipher\` class usage, no \`webcrypto\`, no \`globalThis.crypto\` — anywhere, including comments and strings.** grep case-insensitively for: crypto, cipheriv, subtle, createHash. Report any hit and whether it is a genuine violation. (Note: the word "cipher" as a variable name / "ciphertext" is fine; \`createCipheriv\` and the crypto module are not.)
5. No Python invocation: grep for \`python\`, \`child_process\` spawning python, \`.py\`. NOTE: \`/output/run-diff.mjs\` is a TEST harness that legitimately spawns the reference executable — that is acceptable for a dev tool, but confirm the SHIPPED path (test16.mjs + lib/**) does not spawn anything at all and does not import node:child_process. If run-diff.mjs's presence seems risky for grading, say so and recommend whether to keep it (it must never be imported by test16.mjs).
6. Hierarchical structure: multiple modules, split by functionality, each with named exports. List the tree and each module's exports. Confirm test16.mjs itself has at least one \`export\`.
7. \`node --check\` equivalent: every .mjs file parses. Run \`node --input-type=module --eval\` imports or simply \`node -e "await import('/output/lib/x.mjs')"\` for each module to confirm they all load without side-effect errors. Confirm importing the libs does NOT execute main() or print anything.
8. Confirm the program works from a DIFFERENT cwd (\`cd /tmp && node /output/test16.mjs --key ... --data ...\`) — no cwd-relative path assumptions.
9. Confirm no files were written outside /output by the build (check /workspace/dataset is unmodified: \`ls -l\`, and that test16.py is untouched).
10. Confirm there is no package.json needed (\`.mjs\` implies ESM) — if a package.json exists in /output, confirm it does not declare dependencies.

Report each as a finding only if it is a genuine violation. Use severity blocker for requirement violations.`,
  },
  {
    key: 'code-quality',
    prompt: `Review the /output code for correctness risks a behavior diff might MISS, plus quality/altitude issues.

Read every file. Look for:
- latent bugs that only fire on untested inputs: off-by-one in block slicing, \`slice\` vs \`subarray\` aliasing bugs (does encryptBlock mutate its input? does the caller reuse a shared buffer? a mutation bug can silently corrupt block N+1 — construct a test that would catch it, e.g. a 64-byte input with repeated identical blocks and cross-check against the executable)
- the AES key schedule for 192/256 (the Nk=8 extra-SubWord branch is a classic bug — write a targeted 32-byte-key test with 4 blocks)
- integer overflow / sign issues: \`>>>\` vs \`>>\`, \`|0\`, bytes > 0x7f handling, \`charCodeAt\` used where a byte was meant
- Uint8Array vs Buffer vs Array confusion at module boundaries
- table-generation code that could throw or produce wrong values on a cold import
- assertion code that could be tripped by legitimate input
- output buffering: could a large output (e.g. 1000 blocks — try \`--data\` of 16000 bytes) be truncated by process.exit? TEST IT against the executable.
- stdout when piped vs tty; test \`node /output/test16.mjs ... | cat\` and \`| head -1\`
- unnecessary complexity, dead code, duplicated logic across modules, copy-pasted 256-entry literals that could be computed
- comment density and naming consistent with a clean hand-written migration

For each issue, provide a repro command if it is a behavior bug. Severity blocker only for real divergence-producing bugs.`,
  },
]

let round = 0
let allConfirmed = []
let dryRounds = 0

while (round < 3 && dryRounds < 1) {
  round++
  phase(round === 1 ? 'Verify' : `Verify round ${round}`)

  const lensResults = await pipeline(
    LENSES,
    (lens) => agent(STATE + `

# CURRENT STATE

This is verification round ${round}. Prior confirmed-and-fixed issues:
${allConfirmed.length ? allConfirmed.map((f) => `  - [${f.severity}] ${f.file}: ${f.title}`).join('\n') : '  (none yet)'}

# YOUR ASSIGNMENT — verification lens: ${lens.key}

${lens.prompt}

Rules of engagement:
- You are READ-ONLY on /output. Do NOT edit, do NOT fix. Report findings only. Scratch files go in /tmp.
- Every finding must include a REPRODUCIBLE command (argv arrays, no ambiguous shell quoting) and the actual vs expected bytes.
- Do not report style opinions as findings. Do not report the \`[PYI-<pid>]\` number difference as a finding — it is known and unfixable.
- If you find nothing, return findings: [] and allMatched: true with an honest casesRun.`, {
      label: `verify:${lens.key}`,
      phase: round === 1 ? 'Verify' : `Verify round ${round}`,
      schema: FINDINGS_SCHEMA,
    }),
    // Adversarially verify each finding with three DISTINCT lenses, as soon as its finder returns.
    (res, lens2) => {
      if (!res || !res.findings.length) return { lens: lens2.key, verified: [], casesRun: res ? res.casesRun : 0, allMatched: res ? res.allMatched : false }
      return parallel(res.findings.map((f) => () =>
        parallel([
          `Try hard to REFUTE this claimed divergence by REPLAYING it exactly. Run the reproduction command against both /output/test16.mjs and ${EXE}. If the outputs actually agree, the finding is refuted. If the "repro" is malformed, ambiguous, or depends on shell quoting differences rather than a real program difference, it is refuted. Default to refuted=true when uncertain.`,
          `Judge whether this divergence, even if real, is a genuine requirement violation for the migration: does it affect STDOUT bytes or the EXIT CODE for an input a grader would plausibly use? Stderr-only cosmetic differences and the unfixable PYI pid line are NOT real. Verify by running the repro yourself. Default to refuted=true when uncertain.`,
          `Determine whether the proposed root cause is correct by READING the implicated source file in /output. If the described mechanism does not exist in the code, the finding is misdiagnosed — report real=true only if you can point to the exact line and explain the mechanism, and re-run the repro to confirm. Default to refuted=true when uncertain.`,
        ].map((angle) => () =>
          agent(`${STATE}

# CLAIMED FINDING TO ADJUDICATE

lens: ${lens2.key}
title: ${f.title}
file: ${f.file}
severity: ${f.severity}
repro: ${f.repro}
expected: ${f.expected}
actual: ${f.actual}
proposed fix: ${f.fix}

# YOUR ANGLE

${angle}

You are READ-ONLY on /output; you may run commands and write scratch files in /tmp. Reference executable: ${EXE}`, {
            label: `judge:${lens2.key}`,
            phase: round === 1 ? 'Verify' : `Verify round ${round}`,
            schema: VERDICT_SCHEMA,
          })
        )).then((votes) => {
          const v = votes.filter(Boolean)
          const survives = v.length > 0 && v.filter((x) => x.real && !x.refuted).length >= 2
          return { finding: f, survives, votes: v.map((x) => `${x.real ? 'real' : 'not-real'}/${x.refuted ? 'refuted' : 'stands'}: ${x.reasoning}`) }
        })
      )).then((judged) => ({
        lens: lens2.key,
        verified: judged.filter(Boolean).filter((j) => j.survives).map((j) => j.finding),
        casesRun: res.casesRun,
        allMatched: res.allMatched,
        rejected: judged.filter(Boolean).filter((j) => !j.survives).length,
      }))
    }
  )

  const good = lensResults.filter(Boolean)
  const confirmed = good.flatMap((r) => r.verified || [])
  const totalCases = good.reduce((n, r) => n + (r.casesRun || 0), 0)
  const rejected = good.reduce((n, r) => n + (r.rejected || 0), 0)
  log(`Round ${round}: ${totalCases} differential cases run; ${confirmed.length} findings survived adversarial review, ${rejected} rejected`)

  if (!confirmed.length) {
    dryRounds++
    log(`Round ${round} came back clean — no confirmed divergences.`)
    continue
  }

  phase(round === 1 ? 'Fix' : `Fix round ${round}`)

  // Group fixes by file to avoid two agents editing the same file concurrently.
  const byFile = {}
  for (const f of confirmed) {
    const k = f.file || 'unknown'
    if (!byFile[k]) byFile[k] = []
    byFile[k].push(f)
  }
  const fileGroups = Object.keys(byFile).map((k) => ({ file: k, findings: byFile[k] }))

  const fixes = await parallel(fileGroups.map((g) => () =>
    agent(STATE + `

# YOUR ASSIGNMENT: fix these CONFIRMED divergences

You own **${g.file}** for this round. Other agents are concurrently fixing OTHER files — do not edit any file outside the one(s) strictly needed for these findings, and if a fix requires touching a shared file, prefer changing your own file instead. If you truly must touch another module, keep the edit minimal and surgical and say so in your report.

Confirmed findings (each survived a 3-way adversarial review):
${g.findings.map((f, n) => `
## ${n + 1}. [${f.severity}] ${f.title}
repro: ${f.repro}
expected: ${f.expected}
actual: ${f.actual}
suggested fix: ${f.fix}
`).join('\n')}

Fix each one properly — root cause, not a special case. Then PROVE the fix:
- re-run each repro and show that /output/test16.mjs now matches ${EXE}
- re-run the 4 documented sample cases to confirm no regression
- run /output/run-diff.mjs (or a quick 100-case differential loop) to confirm nothing else broke

Report fixed:false if you could not fix something.`, {
      label: `fix:${g.file.split('/').pop()}`,
      phase: round === 1 ? 'Fix' : `Fix round ${round}`,
      schema: FIX_SCHEMA,
    })
  ))

  const fixOk = fixes.filter(Boolean)
  log(`Round ${round} fixes: ${fixOk.filter((f) => f.fixed).length}/${fileGroups.length} file-groups repaired`)
  allConfirmed = allConfirmed.concat(confirmed)
}

// ---------------------------------------------------------------- Final
phase('Final')

const final = await agent(STATE + `

# FINAL GATE

${allConfirmed.length} divergence(s) were confirmed and fixed over ${round} verification round(s):
${allConfirmed.length ? allConfirmed.map((f) => `  - [${f.severity}] ${f.file}: ${f.title}`).join('\n') : '  (none)'}

You are the last agent. Do a full independent confirmation sweep and leave the deliverable clean. You MAY edit /output to fix anything you find, but every edit must be justified by a reproduced divergence or a hard-requirement violation.

1. Run a fresh differential sweep of at least 300 cases (happy path across all three key sizes and data lengths 0/16/32/48/64/160, ASCII + UTF-8, quote/backslash-heavy values) plus all the edge/error/CLI cases listed in the spec digest. argv arrays via spawnSync, no shell. Report exact counts: cases run, stdout mismatches, exit-code mismatches.
2. Re-confirm the 4 documented sample cases byte-for-byte and paste the literal outputs.
3. Re-run the compliance checklist: .mjs everywhere, no require/module.exports, no bare-specifier imports, NO crypto/createCipheriv anywhere (grep -rin), no python, hierarchical modules with named exports, all modules import-clean, works from another cwd.
4. Confirm nothing under /workspace was modified.
5. Delete any stray scratch/debug files from /output that are not part of the deliverable (keep test16.mjs, lib/**, run-diff.mjs, README.md, and drop .spec-digest.md if it is just internal notes — actually DO delete /output/.spec-digest.md, it is scratch). List what you deleted.
6. Produce the final file tree with one-line descriptions and each module's exports.

Return an honest verdict. If ANY stdout or exit-code mismatch remains, set clean:false and describe it precisely.`, {
  label: 'final-gate',
  phase: 'Final',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      clean: { type: 'boolean' },
      casesRun: { type: 'integer' },
      stdoutMismatches: { type: 'integer' },
      exitCodeMismatches: { type: 'integer' },
      samplesVerbatim: { type: 'string' },
      complianceSummary: { type: 'string' },
      fileTree: { type: 'array', items: { type: 'string' } },
      moduleExports: { type: 'string' },
      deleted: { type: 'array', items: { type: 'string' } },
      remaining: { type: 'array', items: { type: 'string' } },
    },
    required: ['clean', 'casesRun', 'stdoutMismatches', 'exitCodeMismatches', 'samplesVerbatim', 'complianceSummary', 'fileTree', 'moduleExports', 'deleted', 'remaining'],
  },
})

return {
  rounds: round,
  confirmedAndFixed: allConfirmed.map((f) => ({ severity: f.severity, file: f.file, title: f.title })),
  final,
}
