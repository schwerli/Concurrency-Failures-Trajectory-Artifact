export const meta = {
  name: 'py2node-pbkdf2-port',
  description: 'Port /workspace/dataset/test6.py (pbkdf2 module) to zero-dependency ESM Node.js in /output, with behavioral probing, differential fuzzing and adversarial review',
  phases: [
    { title: 'Probe', detail: 'black-box probe the executable: argparse edge cases, PBKDF2 semantics, encoding, KATs' },
    { title: 'Implement', detail: 'write hierarchical .mjs library + test6.mjs entry into /output' },
    { title: 'Verify', detail: 'differential fuzz vs executable, constraint compliance audit, spec re-derivation' },
    { title: 'Fix', detail: 'apply confirmed findings' },
    { title: 'Final', detail: 'independent final differential sweep + sign-off' },
  ],
}

const CONTEXT = `
TASK CONTEXT (shared by all agents)
===================================
Source Python file: /workspace/dataset/test6.py
Pre-compiled reference executable (ground truth, has all deps bundled): /workspace/dataset/test6_executable
  Run it directly, e.g.:  /workspace/dataset/test6_executable --a 'p1' --b 's1' --c 'p2' --d 's2'
  DO NOT use the \`python\` command. DO NOT try to read the Python package sources (black box).

The Python source is:
-----------------------------------
#!/usr/bin/env python3
import argparse
import pbkdf2

parser = argparse.ArgumentParser()
parser.add_argument('--a', type=str, required=True)  # passphrase1
parser.add_argument('--b', type=str, required=True)  # salt1
parser.add_argument('--c', type=str, required=True)  # passphrase2
parser.add_argument('--d', type=str, required=True)  # salt2
args = parser.parse_args()

key1 = pbkdf2.PBKDF2(args.a, args.b).read(16)
print(key1.hex())

key2 = pbkdf2.PBKDF2(args.c, args.d).read(16)
print(key2.hex())
-----------------------------------

Known established fact (already verified by the lead): pbkdf2.PBKDF2 defaults are
HMAC-SHA1 with 1000 iterations. Evidence: --a password --b salt  =>  6e88be8bad7eae9d9e10aa061224034f
which is the first 16 bytes of the classic PBKDF2-HMAC-SHA1("password","salt",1000,20) =
6e88be8bad7eae9d9e10aa061224034fed48d03f.

DELIVERABLE CONSTRAINTS (hard requirements, violations invalidate the answer):
- Pure JavaScript for Node.js. ES Modules ONLY: \`import\` / \`export\`. \`require()\` and
  \`module.exports\` are strictly forbidden anywhere in the output.
- All generated files use the .mjs suffix and live under /output.
- Library must be split into MULTIPLE modules by functionality, each exposing \`export\`ed interfaces,
  hierarchically organized (e.g. /output/lib/...). Entry file must be exactly /output/test6.mjs.
- ESM imports must include the full file suffix, e.g. \`import { x } from './utils.mjs'\`.
- ZERO external dependencies. No npm packages. Only relative local-file imports are allowed.
  Node builtins are permitted ONLY as \`node:\`-prefixed builtins, and in practice NONE are needed.
- ABSOLUTELY FORBIDDEN: node:crypto in any form, and in particular crypto.pbkdf2 / crypto.pbkdf2Sync /
  createHmac / createHash. SHA-1, HMAC and PBKDF2 must be implemented from scratch in pure JS.
  The string "node:crypto" or "require('crypto')" must not appear in any output file, not even in a comment.
- No embedded/spawned Python. No child_process.
- Command-line arguments must be parsed manually from process.argv and behave identically to Python's
  argparse for this parser: four required long options --a --b --c --d, each taking one string value,
  plus the implicit -h/--help.
- stdout must match Python's print() byte-for-byte (two lines, each 32 lowercase hex chars, each
  terminated by a single \\n).
`

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'observations', 'requirements_for_implementer'],
  properties: {
    summary: { type: 'string', description: 'What you probed and the headline conclusions' },
    observations: {
      type: 'array',
      description: 'Concrete probed behaviors: the exact command, the exact stdout, exact stderr, exit code',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'stdout', 'stderr', 'exit_code', 'conclusion'],
        properties: {
          command: { type: 'string' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exit_code: { type: 'integer' },
          conclusion: { type: 'string' },
        },
      },
    },
    requirements_for_implementer: {
      type: 'array',
      description: 'Precise, actionable rules the JS implementation must satisfy, derived from the observations',
      items: { type: 'string' },
    },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'overall'],
  properties: {
    overall: { type: 'string', description: 'PASS or FAIL plus one-line justification' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'title', 'evidence', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          title: { type: 'string' },
          evidence: { type: 'string', description: 'Reproducible evidence: exact command + observed vs expected output' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is NOT a real problem for this deliverable' },
    reasoning: { type: 'string' },
  },
}

// ---------------------------------------------------------------- Phase 1: probe
phase('Probe')

const PROBES = [
  {
    label: 'probe:argparse',
    prompt: `${CONTEXT}

YOUR JOB: exhaustively black-box probe the ARGUMENT PARSING behavior of /workspace/dataset/test6_executable
so the JS implementation can reproduce Python argparse exactly. Actually RUN the executable for every case;
capture stdout, stderr and exit code separately (e.g. \`cmd >/tmp/o 2>/tmp/e; echo $?\`).

Cover at minimum:
1. Happy path: \`--a v --b v --c v --d v\` in various orders.
2. \`--a=value\` equals-form, including values containing '=', spaces, leading '-', empty string \`--a=\`.
3. Missing one / several / all required options: exact stderr text and exit code. Note the exact
   "usage:" line, the prog name used, and whether missing options are listed in declaration order.
4. Unknown option (\`--z x\`), unknown positional (\`extra\`), and both together: exact message + exit code.
   Note argparse's ordering: does it report unrecognized-arguments or missing-required first?
5. Duplicate option (\`--a 1 --a 2\`): which wins?
6. \`-h\` and \`--help\`: exact full stdout text and exit code. Also \`--help\` combined with a missing
   required arg — does help still win?
7. Abbreviation / prefix behavior: \`--\` alone as separator, \`-a value\` (single dash, is it accepted as
   an abbreviation of --a, or unrecognized?), \`-abc\`, \`--a\` given no value (\`--a --b x ...\`) — exact
   "expected one argument" message.
8. Values that look like options: \`--a -5\`, \`--a -x\`, \`--a=-x\`, \`--a -- -x\`.
9. Argument value with embedded newline / tab / NUL-free control chars, and a very long value.

For each case state the conclusion crisply. Your requirements_for_implementer list must be a complete,
unambiguous spec of the parser to build (including exact error strings with the prog-name placeholder,
noting that Python uses os.path.basename(sys.argv[0]) as prog, which for the JS port means
basename(process.argv[1]) i.e. "test6.mjs").`,
  },
  {
    label: 'probe:encoding',
    prompt: `${CONTEXT}

YOUR JOB: exhaustively black-box probe how the passphrase and salt STRINGS are turned into BYTES by
pbkdf2.PBKDF2, and confirm the PBKDF2 parameters. Actually RUN the executable for each case.

Method: for a candidate encoding hypothesis, compute the expected PBKDF2-HMAC-SHA1(pass, salt, 1000)[0:16]
yourself. You may use node's built-in crypto **only as a throwaway oracle in /tmp for your own analysis**
(NEVER in the deliverable, and do not write any such file into /output). Then compare against the executable.

Cover at minimum:
1. Pure ASCII baseline; empty passphrase; empty salt; both empty.
2. Non-ASCII: Latin-1 range (e.g. 'pässwörd', '¥'), CJK ('日本語'), emoji / astral plane (e.g. '😀',
   U+1F600), combining marks. Determine definitively whether strings are UTF-8 encoded (and whether
   astral chars become 4-byte UTF-8 sequences, i.e. proper surrogate-pair handling) or something else
   (latin-1 / UTF-16 / surrogateescape).
3. Passphrase longer than the SHA-1 block size (>64 bytes) — this exercises HMAC key hashing. Test 63,
   64, 65, 100, 1000 bytes.
4. Salt of many lengths, including very long salts.
5. Whether the two derivations are independent (same input twice => same output; order irrelevant).
6. Confirm output is exactly 16 bytes / 32 lowercase hex chars, and that .read(16) takes the FIRST block's
   first 16 bytes (i.e. block index starts at 1, big-endian 4-byte counter appended to salt).
7. Argument values passed via the shell containing characters like '$', '"', backslash, and a literal
   newline — confirm they are passed through verbatim.

Report a definitive encoding rule and the exact PBKDF2 parameterization in requirements_for_implementer.`,
  },
  {
    label: 'probe:kat',
    prompt: `${CONTEXT}

YOUR JOB: produce a KNOWN-ANSWER-TEST corpus that the implementer and verifiers will use, and pin down
the exact byte-level construction.

1. Derive from first principles (and state) the exact algorithm chain the JS code must implement:
   SHA-1 (FIPS 180-4, 512-bit blocks, big-endian length, 5x32-bit state), HMAC (RFC 2104, block size 64,
   key >64 bytes is SHA-1'd first, key padded with zeros to 64, ipad 0x36 / opad 0x5c), PBKDF2 (RFC 2898:
   T_i = F(P,S,c,i), F = U_1 xor ... xor U_c, U_1 = HMAC(P, S || INT_BE32(i))).
2. Generate at least 60 (passphrase, salt) pairs covering: short/long/empty, ASCII/non-ASCII/emoji,
   the four sample cases from the Python file's comments, bcrypt-looking salts ('$2b$12$...'), values
   with shell-hostile characters, keys of exactly 63/64/65 bytes UTF-8, and multi-hundred-byte inputs.
   For each pair, RUN /workspace/dataset/test6_executable to get the ground-truth 32-hex-char output.
   (Use \`--a P --b S --c P --d S\` so both lines confirm each other, and prefer passing args from a
   script/array rather than hand-quoting, to avoid shell mangling.)
3. Write the corpus to /tmp/kat_corpus.json as a JSON array of objects
   {"passphrase": <string>, "salt": <string>, "expected": <32-hex string>}.
   Use JSON escaping so that non-ASCII and control characters survive exactly.
   Verify the file parses and that every "expected" is 32 lowercase hex chars.
4. Also include in your report 3 canonical intermediate KATs the implementer can unit-test against:
   SHA-1("") , SHA-1("abc"), and HMAC-SHA1(key="key", msg="The quick brown fox jumps over the lazy dog")
   — state them as hex from your own knowledge of the standards, and say how confident you are.

In requirements_for_implementer, state the corpus path, its size, and how to run it.`,
  },
]

const probes = await parallel(PROBES.map(p => () => agent(p.prompt, { label: p.label, phase: 'Probe', schema: PROBE_SCHEMA })))
const goodProbes = probes.filter(Boolean)
log(`probe phase complete: ${goodProbes.length}/${PROBES.length} reports`)

const probeBrief = goodProbes.map((p, i) => `
### Probe report ${i + 1}: ${PROBES[i]?.label ?? 'unknown'}
SUMMARY: ${p.summary}

REQUIREMENTS:
${(p.requirements_for_implementer || []).map(r => `- ${r}`).join('\n')}

KEY OBSERVATIONS (command => stdout | stderr | exit):
${(p.observations || []).slice(0, 40).map(o => `- \`${o.command}\`\n    stdout: ${JSON.stringify(o.stdout)}\n    stderr: ${JSON.stringify(o.stderr)}\n    exit: ${o.exit_code}\n    => ${o.conclusion}`).join('\n')}
`).join('\n')

// ---------------------------------------------------------------- Phase 2: implement
phase('Implement')

const IMPL_PROMPT = `${CONTEXT}

The probing phase is done. Here are the verified behavioral findings you MUST implement against:
${probeBrief}

YOUR JOB: write the complete deliverable into /output. You are the only writer; nobody else is touching
/output right now.

Required structure (hierarchical, multi-module, ESM, .mjs):
  /output/test6.mjs                  entry point (exact name)
  /output/lib/hash/sha1.mjs          pure-JS SHA-1 (streaming-capable digest module object:
                                     export a factory/class with update()/digest(), plus digest_size=20
                                     and block_size=64 constants, mirroring a hashlib-like interface)
  /output/lib/hash/hmac.mjs          pure-JS HMAC (RFC 2104) parameterized over the digest module
  /output/lib/kdf/pbkdf2.mjs         PBKDF2 class mirroring the Python pbkdf2.PBKDF2 interface:
                                     constructor(passphrase, salt, iterations = 1000, digestmodule = SHA1),
                                     a read(bytes) method with the same streaming/block semantics
                                     (successive read() calls continue with the next block), plus a
                                     convenience one-shot helper
  /output/lib/util/bytes.mjs         string->UTF-8 bytes, bytes->lowercase hex, byte-array helpers
                                     (implement UTF-8 encoding manually with correct surrogate-pair
                                     handling; do not rely on TextEncoder if you can write it yourself,
                                     though TextEncoder is a permitted global if you prefer — but manual
                                     is safer for exact lone-surrogate parity, so implement manually)
  /output/lib/cli/argparse.mjs       a faithful mini-argparse: ArgumentParser with add_argument for
                                     required long string options, -h/--help generation, and the exact
                                     Python error messages/usage/exit codes discovered in probing
You may add more modules if it improves the decomposition. Every import must use an explicit .mjs suffix
and be a relative local path.

Implementation notes:
- SHA-1 must be correct for messages of any length, including >2^29 bits is not needed but the 64-bit
  big-endian length field must be written correctly, and the padding rule (0x80, zeros, 8-byte length)
  must handle the boundary cases where the message length mod 64 is 55, 56, 57, 63, 64.
- Use Uint8Array for byte buffers. Be extremely careful with 32-bit arithmetic: use \`| 0\`, \`>>> 0\`,
  and implement rotate-left as \`((x << n) | (x >>> (32 - n))) >>> 0\`. Additions must be kept in 32-bit
  range (chained \`+\` then \`>>> 0\` is fine in JS since intermediate doubles are exact below 2^53, but
  do it deliberately and consistently).
- HMAC: if key length > 64, key = SHA1(key); then zero-pad to 64.
- PBKDF2: F(P,S,c,i) = U1 xor U2 ... xor Uc with U1 = HMAC(P, S || i as 4-byte big-endian, 1-based).
  read(16) returns the first 16 bytes of block 1. Preserve the leftover-buffer semantics so that
  read(8) twice equals read(16) once.
- Output: \`console.log(hex)\` for each of the two keys, in order. Two lines total on success.
- Exit codes: 0 on success; argparse errors print usage+error to STDERR and exit 2; -h/--help prints
  help to STDOUT and exits 0.
- The prog name in usage/error messages must be the basename of process.argv[1] (so "test6.mjs"),
  mirroring Python's os.path.basename(sys.argv[0]).
- Add brief comments; keep the code clean and idiomatic. No TODOs, no dead code.

Then SELF-VERIFY before returning:
1. \`node --check\` every .mjs file.
2. Run the four sample cases from the Python source comments and diff against the expected output shown there.
3. Run the KAT corpus at /tmp/kat_corpus.json (if it exists) through your implementation and report the
   pass/fail count. Write your throwaway test scripts to /tmp, NEVER into /output.
4. Run a differential loop of at least 200 randomly generated cases against
   /workspace/dataset/test6_executable and report the mismatch count. Include non-ASCII, emoji, empty
   strings, and long inputs in the generator. Pass arguments via execFileSync-style argv arrays (from a
   /tmp script) so quoting never corrupts the comparison.
5. \`grep -rn "require(\\|module.exports\\|node:crypto\\|child_process\\|from '[^.]" /output\` must come back
   clean (only relative './' or '../' imports).
6. Confirm /output contains ONLY .mjs files (no stray test scripts, no package.json, no node_modules).

Return a concise report: the file tree you created, the verification results with actual numbers, and
anything you were unsure about.`

const implReport = await agent(IMPL_PROMPT, { label: 'implement', phase: 'Implement' })
log('implementation written to /output')

// ---------------------------------------------------------------- Phase 3: verify (barrier: fixes need all findings)
phase('Verify')

const VERIFIERS = [
  {
    label: 'verify:differential-fuzz',
    prompt: `${CONTEXT}

The implementation now exists in /output (entry: /output/test6.mjs). Implementer's report:
---
${implReport}
---

YOUR JOB: be a relentless DIFFERENTIAL FUZZER. Find any input where
\`node /output/test6.mjs --a A --b B --c C --d D\` differs from
\`/workspace/dataset/test6_executable --a A --b B --c C --d D\` in stdout, stderr, or exit code.

Write a harness in /tmp (never in /output) that spawns both with an explicit argv array (no shell
quoting), and compares raw stdout bytes, stderr, and exit code. Run at least 1500 cases across these
generators, and report the exact failing inputs (JSON-escaped) for any mismatch:
- random printable ASCII of lengths 0..200 (include 0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128 byte lengths)
- shell/format-hostile chars: $ " ' \\\\ \` % { } [ ] ( ) ; | & < > * ? ! ~ # newline tab CR
- non-ASCII: Latin-1 supplement, Greek/Cyrillic, CJK, Arabic (RTL), combining marks, emoji incl. ZWJ
  sequences and skin-tone modifiers, astral-plane codepoints, and a lone-surrogate-ish input if you can
  get one through argv
- bcrypt-style salts like '$2b$12$f521Zvhc8Ddk7KB0UzFbyR'
- very long inputs (1 KB, 10 KB)
- inputs whose UTF-8 length crosses the HMAC 64-byte key threshold exactly
- CLI shape fuzzing: reordered options, --x=y equals form, missing options, unknown options, extra
  positionals, duplicates, -h, --help, empty argv, values beginning with '-'
Also verify the sample cases embedded in the Python source comments byte-for-byte.

Report every mismatch as a finding with a copy-pasteable reproduction. If zero mismatches, say so and
report the exact counts per generator. Do not modify any file in /output.`,
  },
  {
    label: 'verify:constraints',
    prompt: `${CONTEXT}

The implementation now exists in /output. Implementer's report:
---
${implReport}
---

YOUR JOB: audit COMPLIANCE with the hard deliverable constraints, mercilessly and literally. Read every
file under /output (\`find /output -type f\`) in full. Check:
1. Every file is .mjs and under /output. No package.json, no node_modules, no .js/.py/.json/.txt strays,
   no leftover test or scratch files, no hidden files.
2. Zero occurrences of \`require(\`, \`module.exports\`, \`exports.\`, \`__dirname\`-via-require, CommonJS
   anything. Check with grep and by reading.
3. Zero external/bare imports: every \`import\` specifier must start with './' or '../' and end in '.mjs'.
   Bare specifiers, \`node:*\` builtins, npm packages, and extensionless relative imports are all violations
   worth reporting (node: builtins are technically allowed but flag any that appear, since none should be needed).
4. Zero mention of node:crypto / crypto.pbkdf2 / pbkdf2Sync / createHmac / createHash / webcrypto /
   globalThis.crypto / subtle.deriveBits — anywhere, including comments and strings. This is a blocker.
5. No child_process, no spawning, no Python, no fs reads of external data, no network.
6. Hierarchical multi-module structure with real \`export\`s, and each module actually imported/used
   (no orphan modules, no unused exports that misrepresent the structure).
7. Entry file is exactly /output/test6.mjs and runs with plain \`node /output/test6.mjs ...\` with no flags.
8. Every \`import\` resolves (no typos in paths, correct case). Verify by actually running the program and
   by \`node --check\` on each file.
9. The CLI arg names/required-ness match the Python source exactly: --a --b --c --d, all required, type str.
10. stdout format: exactly two lines of 32 lowercase hex chars each, single trailing newline each; nothing else
    (no extra blank line, no CRLF). Verify with \`node /output/test6.mjs ... | xxd | tail\`.

Report each violation as a finding. Do not modify any file in /output.`,
  },
  {
    label: 'verify:crypto-review',
    prompt: `${CONTEXT}

The implementation now exists in /output. YOUR JOB: adversarially review the CRYPTO CORE for latent
correctness bugs that random testing might miss. Read /output/lib/**/*.mjs in full and reason about the
code, then write targeted probes in /tmp to try to break it.

Specifically hunt for:
- SHA-1 padding bugs at message lengths mod 64 == 55/56/57/63 and 0, and the 8-byte big-endian bit-length
  field (including lengths > 2^32 bits only if cheap to check; at minimum ensure the high word is written).
- Streaming/update() state bugs: does \`update(a); update(b)\` equal \`update(a+b)\` for chunk splits that
  land mid-block? Does calling digest() twice, or update() after digest(), behave sanely (and does the
  PBKDF2 code ever depend on that)?
- Signed/unsigned 32-bit errors: missing \`>>> 0\`, rotate-left with n=0 or 32, \`<<\` sign extension,
  the K constants and the f-function per round range (0-19/20-39/40-59/60-79).
- HMAC: key exactly 64 bytes (must NOT be hashed), key 65 bytes (must be hashed), zero-length key,
  ipad/opad constants, and whether the inner/outer key buffers are accidentally shared/mutated across
  calls (aliasing bugs that only show up when the same HMAC object is reused across the 1000 iterations).
- PBKDF2: 1-based block counter, 4-byte big-endian INT, XOR accumulation over exactly \`iterations\`
  U-values (off-by-one: are there 1000 HMAC calls, or 999/1001?), and the leftover-buffer semantics of
  read() (read(8)+read(8) must equal read(16); read(20)/read(21) must cross into block 2 correctly).
- Buffer aliasing / accidental mutation of the caller's input arrays.
- Any use of \`Buffer\` where Uint8Array semantics differ, and any place a >255 value could be written
  into a byte array.
Where you can, verify against authoritative published test vectors you know (FIPS 180-4 SHA-1 vectors,
RFC 2202 HMAC-SHA1 vectors, RFC 6070 PBKDF2-HMAC-SHA1 vectors including the c=1 / c=2 / c=4096 cases and
the 'saltSALTsalt...' 25-byte / long-password cases) by exercising the /output modules directly from a
/tmp script that imports them. Note that RFC 6070 vectors need dkLen up to 25 — use read() to get them,
which also tests multi-block output.

Report real defects with reproductions. Do not modify any file in /output.`,
  },
  {
    label: 'verify:cli-parity',
    prompt: `${CONTEXT}

The implementation now exists in /output. YOUR JOB: adversarially review the CLI ARGUMENT PARSER in
/output for parity with Python argparse, and for robustness.

Read /output/lib/cli/argparse.mjs (or wherever parsing lives) plus /output/test6.mjs in full. Then probe
BOTH programs side by side from a /tmp harness using explicit argv arrays, comparing stdout, stderr and
exit code, for at least these shapes:
  [] ; ['--a','x'] ; ['--a','x','--b','y'] ; all four in every rotation ; ['--a=x','--b=y','--c=z','--d=w']
  ['--a','x','--b','y','--c','z','--d','w','extra'] ; ['--z','1', ...valid] ; ['-h'] ; ['--help']
  ['--help','--a','x'] ; ['--a','x','--a','y', ...] ; ['--a','','--b','','--c','','--d','']
  ['--a','-5', ...] ; ['--a','-x', ...] ; ['--a=-x', ...] ; ['--a','--b','y','--c','z','--d','w']
  ['--','--a','x'] ; ['-a','x', ...] ; ['--A','x', ...] (case) ; values with newline/tab/spaces
Note: exact stderr text parity is desirable but the top priority is (a) identical stdout on all valid
inputs and (b) identical exit codes; report stderr differences at the severity you judge appropriate,
remembering the prog name legitimately differs ("test6.mjs" vs "test6_executable").

Also review the parser code for: mutation of process.argv, off-by-one in the argv slice (must start at
index 2), swallowing of values that look like options, mishandling of a value containing '=', and any
place where a missing value would produce \`undefined\` instead of an error. Report real defects with
reproductions. Do not modify any file in /output.`,
  },
]

const rawFindings = await parallel(VERIFIERS.map(v => () => agent(v.prompt, { label: v.label, phase: 'Verify', schema: FINDINGS_SCHEMA })))
const collected = rawFindings.filter(Boolean)
const allFindings = collected.flatMap((r, i) => (r.findings || []).map(f => ({ ...f, source: VERIFIERS[i]?.label ?? '?' })))
log(`verify phase: ${collected.map((r, i) => `${VERIFIERS[i]?.label}=${r.overall}`).join(' | ')}`)
log(`${allFindings.length} raw findings collected`)

// Adversarially screen the non-trivial findings so we don't "fix" phantom problems.
const screenable = allFindings.filter(f => f.severity === 'blocker' || f.severity === 'major')
const screened = await parallel(screenable.map(f => () => agent(
  `${CONTEXT}

A verifier reported this finding against the implementation in /output:

  SEVERITY: ${f.severity}
  FILE:     ${f.file}
  TITLE:    ${f.title}
  EVIDENCE: ${f.evidence}
  PROPOSED FIX: ${f.fix}

YOUR JOB: try to REFUTE it. Read the actual code in /output and actually run the reproduction against
both /output/test6.mjs and /workspace/dataset/test6_executable. Set refuted=true if the finding does not
reproduce, misreads the code, describes a difference that is expected and acceptable (e.g. the prog name
in usage text being "test6.mjs" instead of "test6_executable", which is the correct faithful analog of
Python's os.path.basename(sys.argv[0])), or is a style opinion rather than a defect. Set refuted=false
only if you independently reproduced a real violation of the stated deliverable constraints or a real
behavioral divergence on stdout/exit-code. Default to refuted=true when genuinely uncertain, but never
refute something you reproduced. Do not modify any file in /output.`,
  { label: `screen:${f.severity}:${f.title.slice(0, 34)}`, phase: 'Verify', schema: VERDICT_SCHEMA },
).then(v => ({ f, v }))))

const confirmed = screened.filter(Boolean).filter(x => x.v && x.v.refuted === false).map(x => x.f)
const minors = allFindings.filter(f => f.severity === 'minor' || f.severity === 'nit')
log(`${confirmed.length} findings survived adversarial screening (+${minors.length} minor/nit for consideration)`)

// ---------------------------------------------------------------- Phase 4: fix
phase('Fix')

let fixReport = 'No confirmed findings; no fix pass needed.'
if (confirmed.length > 0 || minors.length > 0) {
  fixReport = await agent(`${CONTEXT}

The implementation exists in /output. Verification found the following issues. You are the only writer.

CONFIRMED (survived adversarial screening) — you MUST fix all of these:
${confirmed.length ? confirmed.map((f, i) => `${i + 1}. [${f.severity}] ${f.file} — ${f.title}\n   evidence: ${f.evidence}\n   suggested fix: ${f.fix}`).join('\n\n') : '(none)'}

MINOR / NIT — fix only if clearly correct, low-risk, and genuinely an improvement; skip anything that
would risk behavioral parity:
${minors.length ? minors.map((f, i) => `${i + 1}. [${f.severity}] ${f.file} — ${f.title}\n   evidence: ${f.evidence}\n   suggested fix: ${f.fix}`).join('\n\n') : '(none)'}

YOUR JOB: apply the fixes with surgical edits (do not rewrite working modules wholesale), then re-verify:
- \`node --check\` on every .mjs file
- the four sample cases from the Python source comments
- the KAT corpus /tmp/kat_corpus.json if present
- a fresh 300-case differential run vs /workspace/dataset/test6_executable (argv arrays, not shell strings)
- the constraint greps (no require/module.exports, no crypto, only relative .mjs imports)
- /output contains only .mjs files; delete any scratch files that leaked in
Report exactly what you changed and the post-fix verification numbers. For anything you deliberately did
not fix, say why.`, { label: 'apply-fixes', phase: 'Fix' })
}

// ---------------------------------------------------------------- Phase 5: final sign-off
phase('Final')

const signoff = await agent(`${CONTEXT}

Everything is written and a fix pass has run. Fix-pass report:
---
${fixReport}
---

YOUR JOB: independent FINAL SIGN-OFF. Trust nothing above; re-verify from scratch.
1. \`find /output -type f | sort\` — list the exact deliverable tree. Flag any non-.mjs file.
2. Read every file under /output at least once for a sanity read (ESM only, relative .mjs imports only,
   no crypto/require/child_process, no stray debug output, no top-level side effects in library modules).
3. Run all four sample cases from the Python source comments and diff byte-for-byte against the expected
   outputs in the comments. Report the exact bytes if anything differs.
4. Run a final 500-case differential sweep vs /workspace/dataset/test6_executable from a /tmp harness
   using explicit argv arrays: random ASCII, non-ASCII, emoji, empty strings, 1 KB inputs, bcrypt-style
   salts, and CLI error shapes. Compare stdout, exit code (and stderr modulo the prog name).
5. Confirm exit codes: 0 for success, 2 for missing/unknown args, 0 for -h/--help.
6. Confirm \`node /output/test6.mjs --a p --b s --c p --d s | xxd\` shows exactly two 32-hex lines each
   ending in 0a and nothing more.
Return a final verdict: PASS or FAIL, the file tree, the measured numbers, and any residual risk the lead
should know about. Do not modify /output unless you find a genuine blocker — if you do fix something, say
exactly what.`, { label: 'final-signoff', phase: 'Final' })

return {
  probes: goodProbes.length,
  confirmedFindings: confirmed.length,
  refutedFindings: screenable.length - confirmed.length,
  minorFindings: minors.length,
  implReport,
  fixReport,
  signoff,
}
