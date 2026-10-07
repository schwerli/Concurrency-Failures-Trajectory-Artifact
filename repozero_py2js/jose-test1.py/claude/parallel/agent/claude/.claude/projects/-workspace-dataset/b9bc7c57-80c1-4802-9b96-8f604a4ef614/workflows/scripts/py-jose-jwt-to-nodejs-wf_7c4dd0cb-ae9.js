export const meta = {
  name: 'py-jose-jwt-to-nodejs',
  description: 'Port python-jose jwt.encode CLI to zero-dependency ESM Node.js, with adversarial differential verification',
  phases: [
    { title: 'Spec', detail: 'probe the executable + pin down SHA-256/HMAC/JSON/argparse specs' },
    { title: 'Build', detail: 'write the hierarchical .mjs module tree into /output' },
    { title: 'Verify', detail: 'differential fuzz + compliance audits from independent lenses' },
    { title: 'Fix', detail: 'apply confirmed fixes, re-verify until clean' },
    { title: 'Final', detail: 'completeness critic + final differential gate' },
  ],
}

const EXE = '/workspace/dataset/test1_executable'
const SRC = '/workspace/dataset/test1.py'

const CONTEXT = `
## Task context (shared by all agents)

We are porting this Python program to Node.js:

  /workspace/dataset/test1.py
  ---
  import argparse
  from jose import jwt

  parser = argparse.ArgumentParser()
  parser.add_argument('--payload', type=str, required=True)
  args = parser.parse_args()

  secret = "my_secret_key"
  token = jwt.encode({"data": args.payload}, secret)
  print(token)
  ---

A precompiled reference binary exists at ${EXE}. Run it directly
(NEVER run \`python\`). Example:
  ${EXE} --payload 'test_data_4'
  -> eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjoidGVzdF9kYXRhXzQifQ.yrpEHOpvymsU4Va-v2CbJxx3HB_c5MYAikdDyqU1bcM

## Already-established behavioral facts (verified by the orchestrator)

1. Header segment is always \`{"alg":"HS256","typ":"JWT"}\` (that exact key order, compact separators).
2. Payload segment is \`{"data":<the --payload value>}\` serialized like Python
   \`json.dumps(obj, separators=(",", ":"), ensure_ascii=True)\` — i.e. NO spaces after ',' or ':',
   and every character outside printable ASCII 0x20..0x7E is \\uXXXX-escaped with LOWERCASE hex.
   Confirmed escapes: '"'->\\" , '\\\\'->\\\\\\\\ , 0x08->\\b , 0x0c->\\f , 0x0a->\\n , 0x0d->\\r , 0x09->\\t ,
   other C0 controls -> \\u00XX , 0x7f -> \\u007f , 'é' -> \\u00e9 , '中' -> \\u4e2d ,
   emoji U+1F600 -> surrogate pair \\ud83d\\ude00 . Forward slash '/' is NOT escaped.
3. Signature is HMAC-SHA256 over ASCII("<b64url(header)>.<b64url(payload)>") with key
   ASCII("my_secret_key"), then base64url-encoded with '=' padding STRIPPED and +/ -> -_ .
4. argparse semantics observed on the binary:
   - \`--payload VALUE\` and \`--payload=VALUE\` both work; \`--payload=\` gives empty string.
   - Prefix abbreviation works: \`--pay\`, \`--p\` are accepted (unambiguous prefix of --payload).
   - Duplicate \`--payload a --payload b\` -> last wins ("b").
   - Missing value -> stderr "usage: ...\\n<prog>: error: argument --payload: expected one argument", exit 2.
   - Missing required arg -> stderr "usage: ...\\n<prog>: error: the following arguments are required: --payload", exit 2.
   - Extra positional -> "error: unrecognized arguments: extra", exit 2.
   - Unknown option -> "error: unrecognized arguments: --bogus 1", exit 2.
   - \`-h\`/\`--help\` anywhere prints help to stdout and exits 0.
   - \`--payload -1\` and \`--payload -1.5\` SUCCEED (argparse negative-number matcher: regex
     ^-\\d+$|^-\\d*\\.\\d+$ , and since the parser owns no negative-number-looking options,
     such tokens are treated as VALUES not options). \`--payload -x\` FAILS with
     "expected one argument". \`--payload -\` SUCCEEDS (lone '-' is a value).
     A token containing a space (e.g. " -x") is also treated as a value.

## HARD CONSTRAINTS on the generated code (violating any of these invalidates the answer)

- Pure JavaScript, Node.js runtime (node v18.19.1 is installed).
- ES Modules ONLY. Use \`import\`/\`export\`. \`require()\` and \`module.exports\` are STRICTLY PROHIBITED.
- Every generated file uses the \`.mjs\` suffix; every relative import includes the full \`.mjs\` suffix.
- ZERO external dependencies. No npm packages. Only local relative-file imports are allowed.
- The string \`node:crypto\` and the \`crypto\` module MUST NOT appear anywhere — not in code,
  not in comments, not in identifiers, not in strings. SHA-256 and HMAC MUST be implemented
  from scratch in pure JavaScript. Also do not use globalThis.crypto / webcrypto / subtle.
  (Node built-ins like node:fs / node:path / node:url are permitted but not required.)
- No embedding or invoking Python.
- All output files live under \`/output\`. Entry file MUST be exactly \`/output/test1.mjs\`.
- Library code must be split hierarchically into multiple functional modules under /output,
  each exposing its interface via \`export\`.
- stdout must match the binary byte-for-byte (token + single trailing newline via console.log).
`

// ---------------------------------------------------------------- schemas

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'testVectors'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'rule', 'evidence'],
        properties: {
          area: { type: 'string' },
          rule: { type: 'string', description: 'a precise, implementable rule' },
          evidence: { type: 'string', description: 'exact command run and exact observed output' },
        },
      },
    },
    testVectors: {
      type: 'array',
      description: 'concrete (argv, stdout, stderr, exitCode) tuples for regression testing',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argvJson', 'stdout', 'exitCode'],
        properties: {
          argvJson: { type: 'string', description: 'JSON array of argv strings after the program name' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'integer' },
        },
      },
    },
  },
}

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issues', 'ranClean'],
  properties: {
    ranClean: { type: 'boolean', description: 'true if you found NO defects in your lens' },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'title', 'repro', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          title: { type: 'string' },
          repro: { type: 'string', description: 'exact shell command + actual vs expected output' },
          fix: { type: 'string', description: 'concrete recommended change' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reasoning'],
  properties: {
    real: { type: 'boolean', description: 'true only if you reproduced the defect yourself' },
    reasoning: { type: 'string' },
    actualOutput: { type: 'string' },
  },
}

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'notes'],
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

// ---------------------------------------------------------------- Phase 1: Spec

phase('Spec')

const PROBES = [
  {
    key: 'argparse',
    prompt: `${CONTEXT}

YOUR LENS: **argparse conformance**. Exhaustively probe ${EXE}'s command-line parsing
so we can reimplement Python argparse's behavior for this exact parser
(one required optional \`--payload\` of type str, plus the auto \`-h/--help\`).

Probe at minimum: the \`=\` form; abbreviations (--p, --pa, --payl, --payload, and also
--payloadx which should fail); \`-h\`, \`--help\`, \`--h\`, \`--hel\`; interspersed args;
\`--\` as a separator BEFORE and AFTER --payload (e.g. \`-- --payload x\`, \`--payload -- x\`,
\`--payload x --\`); values that look like options (\`-x\`, \`-1\`, \`-1e5\`, \`-.5\`, \`-1.\`, \`--\`, \`-\`,
\` -x\` with a leading space, \`--foo=bar\`); empty-string value \`--payload ''\`;
repeated flags; unknown options in several positions; multiple stray positionals
(check the exact "unrecognized arguments:" joining); combined \`--payload=-1e5\`.
Capture the EXACT stderr text (including the usage line and the program name) and exit codes.
Note explicitly whether help/usage goes to stdout or stderr (test with 1>/dev/null and 2>/dev/null).

Do NOT write any files under /output. You may use /tmp for scratch.
Return findings as precise implementable rules plus concrete test vectors.`,
  },
  {
    key: 'json-escaping',
    prompt: `${CONTEXT}

YOUR LENS: **Python json.dumps(ensure_ascii=True) string-escaping fidelity**.
Determine the EXACT byte-level serialization rule the binary applies to the payload string,
by feeding adversarial values through ${EXE} and base64url-decoding the second JWT segment.

Helper to decode (bash):
  dec() { s=$(${EXE} --payload "$1" | cut -d. -f2); p=$(( (4 - \${#s} % 4) % 4 )); \\
          for i in $(seq 1 $p); do s="\${s}="; done; printf '%s' "$s" | tr '_-' '/+' | base64 -d; echo; }

Probe: all C0 controls 0x00-0x1F (use printf '\\xNN'; note 0x00 may be impossible to pass via
execve — say so if it is), 0x7F, 0x80-0xFF range chars, Latin-1 accents, CJK, emoji (astral,
must become a surrogate pair), combining marks, RTL marks, U+2028/U+2029, U+FFFD,
the exact hex case used in \\uXXXX (lower or upper), whether '/' or "'" are escaped,
backslash and double-quote, and a value that is itself valid JSON like {"a":1}.
Also confirm the header segment is byte-identical across all inputs.

Also determine how invalid UTF-8 bytes in argv are handled if you can construct such a case
(e.g. printf '\\xff'), and report the observed behavior exactly.

Do NOT write any files under /output. You may use /tmp for scratch.
Return precise implementable rules + concrete test vectors (argv -> full expected stdout token).`,
  },
  {
    key: 'crypto-vectors',
    prompt: `${CONTEXT}

YOUR LENS: **SHA-256 / HMAC-SHA256 / base64url reference vectors**.
We must implement SHA-256 and HMAC-SHA256 from scratch in pure JavaScript (the platform
hashing module is forbidden). Your job is to produce an authoritative, self-contained
specification + test-vector set that an implementer can code against and self-check.

Deliver as findings:
 - The SHA-256 algorithm spec precise enough to implement: initial H0..H7 constants, the 64
   round constants K (state them as the derivation rule AND note they are the standard FIPS 180-4
   values), message schedule W expansion, the sigma/Sigma rotations, padding rule
   (0x80, zeros, 64-bit big-endian bit length), and the big-endian digest output order.
   CRITICAL implementation warnings for JavaScript: all arithmetic must be done with
   32-bit unsigned semantics using >>> 0, rotations via ((x>>>n)|(x<<(32-n)))>>>0,
   additions chained mod 2^32; message length in BITS can exceed 2^32 so the high word
   must be computed as Math.floor(bitLen / 2**32).
 - The HMAC construction: block size 64 bytes for SHA-256, key longer than 64 bytes is hashed
   first, key shorter is zero-padded right to 64, ipad 0x36 / opad 0x5c, H((K^opad) || H((K^ipad) || msg)).
   Note that "my_secret_key" is 13 bytes so it is zero-padded, but the implementation must still
   handle the >64-byte case correctly.
 - base64url: standard base64 alphabet with '+'->'-', '/'->'_', trailing '=' padding removed.
 - Known-answer test vectors you are CONFIDENT about (state them and mark confidence):
   SHA-256 of "" , "abc" , "a"*1000000 (just the first, if unsure omit), and the
   multi-block/length-boundary cases at input lengths 55, 56, 63, 64, 65, 119, 120 bytes.
   Plus RFC 4231 HMAC-SHA-256 vectors (test cases 1-7) if you are confident of them.

You may ALSO derive ground-truth end-to-end vectors empirically from ${EXE}: craft payload
values whose resulting signing input has a specific length to exercise the padding boundaries
(the signing input is "<b64url header>.<b64url payload>"; the header segment is a fixed
36 chars, so total length = 37 + payloadSegLen and you can tune it by payload length).
Produce at least 12 such (payload -> full token) vectors spanning signing-input lengths
that straddle 55/56/63/64/119/120 mod-64 boundaries.

Do NOT write any files under /output. You may use /tmp for scratch.`,
  },
  {
    key: 'io-shape',
    prompt: `${CONTEXT}

YOUR LENS: **process I/O shape and exotic inputs**.
Determine, for ${EXE}: exact trailing-newline behavior on stdout (use \`| od -c | tail -3\`),
whether anything is written to stderr on success, the exit code on success, behavior with
very large payloads (10 KB, 100 KB, 1 MB — confirm it still succeeds and record the token
for a 10000-'A' payload), behavior when stdout is a pipe vs a file, and whether output is
affected by env vars like PYTHONIOENCODING or LC_ALL/LANG (test LC_ALL=C with a UTF-8 payload).
Also record what \`${EXE} --payload x\` prints when LANG is unset.

Produce a set of test vectors including at least one large-payload case
(record the FULL expected token string, not a truncation).

Do NOT write any files under /output. You may use /tmp for scratch.`,
  },
]

const specs = await parallel(
  PROBES.map((p) => () => agent(p.prompt, { label: `probe:${p.key}`, phase: 'Spec', schema: PROBE_SCHEMA })),
)

const specOk = specs.filter(Boolean)
log(`Spec phase: ${specOk.length}/${PROBES.length} probes returned; ` +
    `${specOk.reduce((n, s) => n + (s.findings?.length || 0), 0)} rules, ` +
    `${specOk.reduce((n, s) => n + (s.testVectors?.length || 0), 0)} vectors`)

const SPEC_DIGEST = specOk
  .map((s, i) => {
    const name = PROBES[i]?.key ?? `probe${i}`
    const rules = (s.findings || []).map((f) => `  - [${f.area}] ${f.rule}\n      evidence: ${f.evidence}`).join('\n')
    const vecs = (s.testVectors || [])
      .slice(0, 40)
      .map((v) => `  - argv=${v.argvJson} exit=${v.exitCode}\n      stdout=${JSON.stringify(v.stdout)}${v.stderr ? `\n      stderr=${JSON.stringify(v.stderr)}` : ''}`)
      .join('\n')
    return `### Probe: ${name}\nRULES:\n${rules}\nVECTORS:\n${vecs}`
  })
  .join('\n\n')

// ---------------------------------------------------------------- Phase 2: Build

phase('Build')

const ARCHITECTURE = `
## Required module layout under /output (hierarchical, one concern per module)

  /output/test1.mjs                     entry point (must be exactly this path)
  /output/lib/bytes/utf8.mjs            UTF-8 encode/decode helpers over Uint8Array (no TextEncoder reliance is fine either way, but hand-rolled is safer/explicit)
  /output/lib/bytes/base64url.mjs       base64 + base64url encode (and decode, for self-test)
  /output/lib/hash/sha256.mjs           from-scratch SHA-256 (streaming-capable class + one-shot fn)
  /output/lib/hash/hmac.mjs             generic HMAC over an injected hash primitive; exports hmacSha256
  /output/lib/json/python-json.mjs      Python-compatible json.dumps (compact separators, ensure_ascii)
  /output/lib/jose/algorithms.mjs       algorithm registry (HS256 -> hmacSha256), mirrors jose's ALGORITHMS
  /output/lib/jose/jws.mjs              JWS compact serialization (signing input, sign, assemble)
  /output/lib/jose/jwt.mjs              jwt.encode(claims, key, algorithm='HS256') facade
  /output/lib/cli/argparse.mjs          minimal Python-argparse-compatible parser (ArgumentParser class with add_argument/parse_args)
  /output/lib/cli/errors.mjs            usage/error formatting + exit-code behavior

You may add modules if it improves the decomposition, but keep the above spine.
Every module must \`export\` its public interface and import siblings with the full
\`.mjs\` suffix and a relative path.
`

const buildResult = await agent(
  `${CONTEXT}

${SPEC_DIGEST ? `## Empirically derived specification from the probe phase\n\n${SPEC_DIGEST}\n` : ''}

${ARCHITECTURE}

## Your job

Write the complete implementation to disk under /output, using the Write tool.
Then self-test it against the reference binary before you return.

Implementation requirements in detail:

1. **SHA-256 from scratch.** Implement FIPS 180-4 SHA-256 in pure JS over Uint8Array.
   Use 32-bit unsigned arithmetic (\`>>> 0\`) everywhere. Compute the 64-bit big-endian
   bit-length correctly for messages longer than 512 MB (hi word = Math.floor(bits / 2**32)).
   Provide both a streaming class and a one-shot \`sha256(bytes) -> Uint8Array(32)\`.
   Include the standard K constants and H init values.

2. **HMAC from scratch**, block size 64, per RFC 2104: hash the key if > 64 bytes,
   right-zero-pad to 64, ipad/opad 0x36/0x5c.

3. **UTF-8 encoding** of the signing input and of the JSON bytes. Note the signing input is
   pure ASCII after base64url encoding, but the JSON string itself is ASCII-only too because
   ensure_ascii=True escapes everything non-ASCII — still, implement a correct general
   UTF-8 encoder and use it, and handle lone surrogates the way Python's json module does
   (it emits the escape for the lone surrogate rather than throwing — verify against the binary
   if you can construct such a case; if you cannot construct it, pick the non-throwing behavior).

4. **Python json.dumps compatibility.** Serialize with separators (",", ":") and
   ensure_ascii=True. Escape rule: for each UTF-16 code unit c of the string —
   '"' -> \\", '\\\\' -> \\\\\\\\, 0x08 -> \\b, 0x09 -> \\t, 0x0a -> \\n, 0x0c -> \\f, 0x0d -> \\r,
   any other code unit < 0x20 or > 0x7e -> \\u%04x with LOWERCASE hex.
   Do NOT escape '/'. Astral characters are emitted as their two surrogate escapes
   (which falls out naturally from iterating UTF-16 code units).
   Support at least strings, objects (insertion order), arrays, numbers, booleans and null,
   since it is a general-purpose module — but correctness for the string+object case is what matters.

5. **argparse compatibility.** Implement enough of argparse for this program, matching the
   probe-phase rules exactly: \`--opt value\`, \`--opt=value\`, unambiguous prefix abbreviation,
   required-argument enforcement, last-one-wins on repeats, auto \`-h/--help\`,
   the exact usage/error text, help to stdout with exit 0, errors to stderr with exit 2,
   the negative-number heuristic (a token matching /^-\\d+$/ or /^-\\d*\\.\\d+$/ is a VALUE when the
   parser has no negative-number-looking option strings), a lone "-" is a value, a token
   containing a space is a value, and \`--\` handling.
   Use the script's own basename for the program name in usage text (i.e. "test1.mjs"), matching
   how Python derives prog from sys.argv[0] — derive it from process.argv[1] via node:path/node:url,
   do not hardcode it.
   The help text layout should mirror Python 3.11+ argparse:
     usage: test1.mjs [-h] --payload PAYLOAD
     (blank line)
     options:
       -h, --help         show this help message and exit
       --payload PAYLOAD
   Reproduce the column alignment the binary produces (check it with \`${EXE} --help | cat -A\`).

6. **Entry point /output/test1.mjs** parses process.argv.slice(2), builds {"data": value},
   calls jwtEncode(claims, "my_secret_key"), and console.log's the token.

7. Do not print anything extra. Exit code 0 on success.

## Self-test before returning (REQUIRED)

Write a scratch differential script in /tmp (NOT in /output) that runs both
\`node /output/test1.mjs ...\` and \`${EXE} ...\` over at least 200 payloads —
including all the probe vectors above, random ASCII, unicode, emoji, control characters,
empty string, and lengths 0..200 plus 1000 and 10000 — and byte-compares stdout, stderr and
exit codes. Iterate until it passes 100%. Report the final pass count in \`notes\`.

Also grep your own output to prove compliance:
  grep -rniE 'require\\(|module\\.exports|node:crypto|webcrypto|subtle|from *.(crypto|node:crypto).' /output || echo CLEAN
  grep -rn "crypto" /output || echo NO-CRYPTO-MENTION
Both must come back clean. If the word appears anywhere (even a comment), rename it.

Return the list of files written and your self-test notes.`,
  { label: 'build:implementation', phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' },
)

log(`Build: wrote ${buildResult?.files?.length ?? 0} files. ${(buildResult?.notes || '').slice(0, 300)}`)

// ---------------------------------------------------------------- Phases 3+4: Verify / Fix loop

const LENSES = [
  {
    key: 'differential-fuzz',
    prompt: `YOUR LENS: **massive differential fuzzing**. Treat \`node /output/test1.mjs\` as the
candidate and \`${EXE}\` as ground truth. Write a fuzz harness in /tmp that compares
stdout + stderr + exit code byte-for-byte across at least 1000 cases:
 - payload lengths 0..300 of 'A', and 1000 / 5000 / 20000
 - random printable ASCII, random bytes that form valid UTF-8, CJK, emoji (astral), combining marks
 - every C0 control character that can survive execve, plus 0x7f
 - strings containing '"', '\\\\', '/', "'", newline, tab, CR, U+2028, U+2029
 - payloads that are themselves JSON: {"a":1}, [1,2,3], "quoted"
 - signing-input length boundaries: choose payload lengths so the signing input length lands on
   54,55,56,57,63,64,65,111,112,119,120,127,128 (the header segment is fixed-length; compute it)
 - argparse forms: --payload=V, --pay V, --p V, repeats, -h, --help, missing arg, missing value,
   unknown option, extra positional, -1, -1.5, -x, lone -, --
Report every mismatch as an issue with the exact repro command and actual-vs-expected.
Do NOT modify /output. Scratch files go in /tmp.`,
  },
  {
    key: 'constraint-compliance',
    prompt: `YOUR LENS: **hard-constraint compliance audit**. Read every file under /output and verify:
 - Every file has a .mjs suffix; no .js/.cjs/.json files are required at runtime.
 - No \`require(\` and no \`module.exports\` anywhere.
 - No import of ANY non-relative specifier except permitted Node built-ins (node:path, node:url,
   node:fs, node:process). Flag any bare npm-style specifier as a blocker.
 - The token "crypto" does NOT appear ANYWHERE in /output — not in code, comments, identifiers,
   strings, or filenames. Also check for webcrypto / subtle / globalThis.crypto / SubtleCrypto.
   This is a blocker if found. Run: \`grep -rni crypto /output\`.
 - No Python is embedded or shelled out to; no child_process usage at all.
 - Every relative import resolves to a real file AND includes the .mjs extension
   (verify by actually running \`node --input-type=module -e "import('/output/<f>')"\` for each module,
   or simply \`node --check\` is NOT enough for ESM resolution — actually import each module).
 - Entry point is exactly /output/test1.mjs and it runs.
 - Libraries are genuinely split by functionality (multiple modules, each with exports) —
   flag a single-monolith-file layout as a major issue.
 - No leftover scratch/test files inside /output that would be confusing (test harnesses belong in /tmp).
Report each violation as an issue.
Do NOT modify /output. Scratch files go in /tmp.`,
  },
  {
    key: 'sha256-correctness',
    prompt: `YOUR LENS: **cryptographic primitive correctness under adversarial inputs**.
The SHA-256 and HMAC in /output are hand-rolled. Independently validate them WITHOUT using
the platform hashing module (you may not import it either — reason from the FIPS 180-4 spec
and from known-answer vectors, and use the reference binary as an oracle).
 - Import /output/lib/hash/sha256.mjs directly with node and check known-answer vectors:
   SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
   SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
   SHA-256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")
     = 248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1
   SHA-256 of 1,000,000 'a' = cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0
   Also test lengths 0..200 for internal consistency vs a second independent path if one exists,
   and specifically lengths 55, 56, 63, 64, 65, 119, 120, 127, 128 (padding boundaries).
 - Validate HMAC-SHA256 against RFC 4231 test cases 1-7, ESPECIALLY case 6/7 where the key is
   131 bytes (longer than the 64-byte block) — this exercises the "hash the key first" path
   that the actual program never hits and is a classic latent bug.
 - Check for 32-bit overflow bugs: does the code use >>> 0 consistently? Is the bit-length
   high word computed correctly for inputs >= 2^29 bytes (reason about it; you need not run it)?
 - Check the streaming/update path (if any) against the one-shot path with odd chunk sizes.
 - Check base64url: padding stripped, +/ mapped to -_ , correct handling of input lengths
   with remainder 0, 1 and 2 mod 3.
Report each defect as an issue with a runnable repro.
Do NOT modify /output. Scratch files go in /tmp.`,
  },
  {
    key: 'argparse-conformance',
    prompt: `YOUR LENS: **argparse + CLI conformance**. Compare \`node /output/test1.mjs\` against
\`${EXE}\` on parsing behavior ONLY, exhaustively. For each case compare exit code, stdout and
stderr (normalizing ONLY the program name: the binary says "test1_executable", ours says
"test1.mjs" — every other character must match, including the usage line layout, the blank line,
the "options:" header and the exact column padding of the help body; verify with \`cat -A\`).
Cases: no args; -h; --help; --h; --hel; --payload; --payload=; --payload=x; --pay x; --p x;
--payl=x; --payloadx x; --payload x --payload y; --payload x extra; extra --payload x;
--bogus; --bogus 1 --payload a; --payload -x; --payload -1; --payload -1.5; --payload -1e5;
--payload -.5; --payload -; --payload --; -- --payload x; --payload x --; --payload -- x;
--payload=-1e5; -hx; -h --payload; --payload " -x"; --payload "a b".
Also verify success output goes to stdout with exactly one trailing \\n and nothing on stderr
(check with od -c).
Report each divergence as an issue with the exact command and both outputs.
Do NOT modify /output. Scratch files go in /tmp.`,
  },
  {
    key: 'json-escaping-conformance',
    prompt: `YOUR LENS: **JSON serialization fidelity**. Verify /output's Python-json module produces
byte-identical payload segments to the reference binary. Decode the middle JWT segment from both
\`node /output/test1.mjs --payload V\` and \`${EXE} --payload V\` and compare the raw JSON bytes
for a large adversarial corpus: every C0 control, 0x7f, Latin-1 accents, Greek, Cyrillic, Hebrew
(RTL), Arabic, CJK, Hangul, Devanagari, emoji including ZWJ sequences and skin-tone modifiers,
flag sequences (regional indicators), variation selectors, U+2028/U+2029, U+FEFF, combining marks,
characters at the BMP boundary U+FFFF and just above U+10000, the max code point U+10FFFF,
quotes, backslashes, forward slashes, and mixed strings.
Verify the \\u hex is LOWERCASE and always 4 digits, that astral chars become surrogate PAIRS,
and that '/' is never escaped.
Additionally unit-test the module directly (import it) for objects, nested objects, arrays,
numbers (integers, floats, negative, 0, 1e21, -0), true/false/null, and empty containers,
against what Python's json.dumps(separators=(',',':')) would produce — reason from the spec since
you cannot run Python. Flag anything suspicious (e.g. -0 should serialize as -0.0 in Python,
1e21 as 1e+21, integers without .0, floats with repr semantics) as a MINOR issue if it only
affects unused generality, but report it.
Do NOT modify /output. Scratch files go in /tmp.`,
  },
  {
    key: 'code-quality',
    prompt: `YOUR LENS: **code quality, robustness and hidden landmines**. Read all of /output carefully.
Look for: reliance on Node APIs not present in Node 18; use of TextEncoder/Buffer in ways that
differ from the hand-rolled path (Buffer is allowed but flag inconsistency); silent truncation for
large inputs; String.fromCharCode.apply stack overflow on large arrays (a real risk for a 20 KB
payload — check base64 and utf8 paths for \`.apply(null, bigArray)\` or spread of big arrays);
O(n^2) string concatenation that would hang on 1 MB input; incorrect handling of the empty string;
mutation of shared module-level state across calls (e.g. a reused hash instance or a shared
Uint8Array buffer) that would break if the module were called twice — actually TEST double
invocation by importing the lib and calling the encode function twice, comparing results;
off-by-one in the argparse abbreviation matcher; unhandled promise rejections; missing
error handling that would produce a Node stack trace instead of the argparse-style message.
Also confirm running the entry from a DIFFERENT cwd works (\`cd /tmp && node /output/test1.mjs --payload x\`)
and that a relative invocation works too.
Report each as an issue with a repro.
Do NOT modify /output. Scratch files go in /tmp.`,
  },
]

const PREAMBLE = `${CONTEXT}

The candidate implementation has been written to /output. Your job is to try to BREAK it.
Be adversarial and specific. An issue is only worth reporting if you have actually reproduced it
with a command. Do not report style opinions. If you find nothing, set ranClean=true and issues=[].
`

let round = 0
let cleanRounds = 0
let allConfirmed = []

while (round < 4 && cleanRounds < 1) {
  round++
  phase(round === 1 ? 'Verify' : `Verify r${round}`)
  log(`--- verification round ${round} ---`)

  // Each lens finds issues, then each issue is independently verified by a skeptic
  // as soon as that lens finishes (pipeline, no barrier between find and verify).
  const perLens = await pipeline(
    LENSES,
    (lens) =>
      agent(`${PREAMBLE}\n${lens.prompt}`, {
        label: `audit:${lens.key}`,
        phase: round === 1 ? 'Verify' : `Verify r${round}`,
        schema: AUDIT_SCHEMA,
        effort: 'high',
      }),
    (audit, lens) => {
      const issues = (audit?.issues || []).slice(0, 12)
      if (!issues.length) return []
      return parallel(
        issues.map((iss) => () =>
          agent(
            `${CONTEXT}

An auditor claims the implementation in /output has this defect:

  severity: ${iss.severity}
  file:     ${iss.file}
  title:    ${iss.title}
  repro:    ${iss.repro}
  proposed fix: ${iss.fix}

Independently REPRODUCE it. Run the exact repro yourself against \`node /output/test1.mjs\`
and, where relevant, against ${EXE}. Set real=true ONLY if you personally observed the
divergence or defect. If the repro does not reproduce, or the "defect" is actually correct
behavior (e.g. the program name legitimately differs between test1_executable and test1.mjs,
or it concerns unused generality that does not affect this program's observable output),
set real=false and explain. Default to real=false when uncertain.
Do NOT modify /output.`,
            {
              label: `verify:${lens.key}:${iss.title.slice(0, 40)}`,
              phase: round === 1 ? 'Verify' : `Verify r${round}`,
              schema: VERDICT_SCHEMA,
            },
          ).then((v) => ({ ...iss, lens: lens.key, verdict: v })),
        ),
      )
    },
  )

  const confirmed = perLens
    .filter(Boolean)
    .flat()
    .filter(Boolean)
    .filter((x) => x.verdict?.real)

  log(`Round ${round}: ${confirmed.length} confirmed defect(s)`)

  if (!confirmed.length) {
    cleanRounds++
    break
  }

  allConfirmed.push(...confirmed)

  phase(round === 1 ? 'Fix' : `Fix r${round}`)
  const fixList = confirmed
    .map(
      (c, i) =>
        `${i + 1}. [${c.severity}] (${c.lens}) ${c.file} — ${c.title}\n   repro: ${c.repro}\n   suggested fix: ${c.fix}\n   verifier notes: ${c.verdict?.reasoning || ''}`,
    )
    .join('\n')

  await agent(
    `${CONTEXT}

The implementation in /output has these INDEPENDENTLY CONFIRMED defects:

${fixList}

Fix all of them by editing the files under /output. Preserve the hierarchical module layout,
the ESM/.mjs rules, and the zero-dependency + no-platform-hashing-module constraints.
Do not regress anything: after fixing, re-run a differential check of at least 300 cases
against ${EXE} (payload lengths 0..200, unicode, emoji, controls, empty, plus the argparse
forms) and confirm 100% agreement on stdout/stderr/exit code (normalizing only the program
name in usage text). Also re-run:
  grep -rni crypto /output || echo CLEAN
  grep -rnE 'require\\(|module\\.exports' /output || echo CLEAN
Both must be clean. Report what you changed and the final pass rate.`,
    { label: `fix:round${round}`, phase: round === 1 ? 'Fix' : `Fix r${round}`, effort: 'high' },
  )
}

// ---------------------------------------------------------------- Phase 5: Final

phase('Final')

const [critic, gate] = await parallel([
  () =>
    agent(
      `${CONTEXT}

COMPLETENESS CRITIC. The implementation is in /output and has passed ${round} verification round(s).
Ask: what has NOT been checked? Which requirement from the task statement might still be unmet?
Re-read the constraint list at the top of this prompt and check EACH one against the actual files.
Specifically confirm:
 (a) hierarchical multi-module library layout with real \`export\`s — list the module tree;
 (b) every import has an explicit .mjs suffix and is relative or a permitted node: builtin;
 (c) zero occurrences of the forbidden hashing-module name anywhere (run \`grep -rni crypto /output\`);
 (d) no require/module.exports;
 (e) entry is /output/test1.mjs and \`node /output/test1.mjs --payload test_data_4\` emits
     exactly the token from the task's Test Case 1;
 (f) all four sample test cases from the original file reproduce exactly:
     test_data_4, test_data_11, test_data_10, test_data_6;
 (g) nothing stray or broken left in /output.
Report anything still missing or wrong as issues. Do NOT modify /output.`,
      { label: 'critic:completeness', phase: 'Final', schema: AUDIT_SCHEMA, effort: 'high' },
    ),
  () =>
    agent(
      `${CONTEXT}

FINAL GATE. Run a last 500-case differential between \`node /output/test1.mjs\` and ${EXE}
covering payload lengths 0..250, unicode/emoji/control/quote/backslash corpora, the four
official sample test cases, and all argparse forms. Also time a 1 MB payload to confirm it
completes in reasonable time (< 30 s) and matches.
Return ranClean=true with issues=[] ONLY if 100% of cases agree on stdout, stderr (modulo the
program name in usage text) and exit code. Otherwise report each mismatch.
Put the final pass/total count in \`summary\`. Do NOT modify /output.`,
      { label: 'gate:final-differential', phase: 'Final', schema: AUDIT_SCHEMA, effort: 'high' },
    ),
])

const finalIssues = [...(critic?.issues || []), ...(gate?.issues || [])]

if (finalIssues.length) {
  log(`Final phase surfaced ${finalIssues.length} issue(s) — applying last fix pass`)
  await agent(
    `${CONTEXT}

Final review surfaced these issues in /output:

${finalIssues.map((i, n) => `${n + 1}. [${i.severity}] ${i.file} — ${i.title}\n   repro: ${i.repro}\n   fix: ${i.fix}`).join('\n')}

Fix every one that is genuinely a defect (ignore any that are merely the expected program-name
difference between test1_executable and test1.mjs). Then re-run the four official sample test
cases plus a 300-case differential and confirm 100% agreement. Report the result.`,
    { label: 'fix:final', phase: 'Final', effort: 'high' },
  )
}

// Final artifact inventory for the orchestrator to report on.
const inventory = await agent(
  `List the final state of /output. For EACH file: its path, its line count, and a one-line
description of its responsibility and what it exports. Then paste the OUTPUT (not the source)
of these commands:
  node /output/test1.mjs --payload test_data_4
  node /output/test1.mjs --payload test_data_11
  node /output/test1.mjs --payload test_data_10
  node /output/test1.mjs --payload test_data_6
  grep -rni crypto /output ; echo "grep-rc=$?"
  grep -rnE 'require\\(|module\\.exports' /output ; echo "grep-rc=$?"
Return this as plain text. Do NOT modify anything.`,
  { label: 'final:inventory', phase: 'Final' },
)

return {
  rounds: round,
  confirmedDefectsFixed: allConfirmed.length,
  criticClean: critic?.ranClean ?? null,
  gateClean: gate?.ranClean ?? null,
  gateSummary: gate?.summary ?? null,
  inventory,
}
