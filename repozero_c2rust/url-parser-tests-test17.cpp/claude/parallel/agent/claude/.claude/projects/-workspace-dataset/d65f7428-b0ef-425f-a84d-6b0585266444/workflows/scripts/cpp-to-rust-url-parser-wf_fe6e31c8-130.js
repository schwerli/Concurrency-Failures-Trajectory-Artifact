export const meta = {
  name: 'cpp-to-rust-url-parser',
  description: 'Port test17.cpp url_parser to zero-dep Rust, differentially fuzz-verified against the C++ binary',
  phases: [
    { title: 'Harness', detail: 'build byte-exact differential oracle vs C++ binary' },
    { title: 'Implement', detail: '3 independent zero-dep Rust ports' },
    { title: 'Verify', detail: 'differential fuzz each candidate' },
    { title: 'Judge', detail: 'score candidates on parity + structure' },
    { title: 'Promote', detail: 'install winner into /output, build both ways' },
    { title: 'Audit', detail: 'adversarial divergence hunt on final /output' },
  ],
}

const CPP = '/workspace/dataset/test17_executable'

const SPEC = `
# GROUND TRUTH SPEC (already derived empirically from the C++ binary — trust this, but you may re-probe to confirm)

The C++ binary is at ${CPP}. The original C++ entry source is /workspace/dataset/url-parser/tests/test17.cpp
(read it — it is the ENTRY test file and is fair game). The url_parser LIBRARY source does NOT exist on disk;
it must be re-implemented from scratch from this behavioral spec using ONLY the Rust std library.

## url_encode(input: bytes) -> bytes
For each byte b of the input, independently:
  - if b is ASCII 'A'..='Z' | 'a'..='z' | '0'..='9' | b'-' | b'.' | b'_' | b'~'  =>  emit b unchanged
  - otherwise => emit b'%' followed by exactly TWO **LOWERCASE** hex digits of b treated as an UNSIGNED byte,
    zero-padded. Examples: space -> "%20", '=' -> "%3d", '&' -> "%26", 0x0A -> "%0a", 0xFF -> "%ff", 0xC3 -> "%c3".
CRITICAL: hex digits are lowercase (%3d NOT %3D). Bytes >= 0x80 are treated as UNSIGNED (0xE9 -> "%e9", never
a sign-extended value). Encoding is per-BYTE, never per-Unicode-scalar: "café" -> "caf%c3%a9".

## url_decode(input: bytes) -> bytes
Scan with index i from 0 while i < len:
  - if input[i] == b'%' AND (i + 2) < len AND is_hex(input[i+1]) AND is_hex(input[i+2]):
        emit ((hexval(input[i+1]) << 4) | hexval(input[i+2])) as a single byte; i += 3
  - else if input[i] == b'+': emit b' ' (0x20); i += 1
  - else: emit input[i] unchanged; i += 1
where is_hex accepts 0-9, a-f, AND A-F (decode is case-INSENSITIVE on hex, unlike encode which always emits lowercase).
Malformed '%' sequences are passed through as a LITERAL '%' and the index advances by only ONE.
Verified behaviors: "%" -> "%"; "%2" -> "%2"; "%zz" -> "%zz"; "%2z" -> "%2z"; "%%20" -> "% "; "%%41" -> "%A";
"%1%20" -> "%1 "; "a+b" -> "a b"; "%2F" and "%2f" both -> "/"; "%aB" and "%Ab" both -> byte 0xAB;
"%00" -> a real NUL byte (0x00) in the output; "%ff" -> raw byte 0xFF (NOT valid UTF-8).

## URL parsing
The program builds the URL string: "http://example.com/test?q=" + url_encode(input).
Because url_encode only ever emits unreserved chars plus '%' and hex digits, the parse result is always:
  scheme() -> "http"   host() -> "example.com"   path() -> "/test"   query() -> "q=" + url_encode(input)
  query_params() -> exactly one pair: ("q", url_encode(input))
A param with an EMPTY value is still included: input "" gives query "q=" and one pair ("q", "").
Implement a genuine, general URL parser module anyway (scheme, userinfo, host, port, path, query, fragment,
query_params splitting on '&' then first '=' , keeping values RAW/undecoded) so the library is faithful to the
interface — but the fixed results above are what the test must produce.

## main / CLI (mirrors test17.cpp exactly)
  if argc < 2 { return 1 }   // NO output at all, exit status 1
  let s = raw bytes of argv[1]   // argv[2..] are IGNORED
  print url_encode(s), then "\\n"
  print url_decode(s), then "\\n"
  build the URL as above, then print scheme, host, path, query, each followed by "\\n"
  for each (k, v) in query_params(): print url_decode(k) + "\\n", then url_decode(v) + "\\n"
  return 0
Total output for a normal run is 8 lines, each terminated by exactly one 0x0A. No trailing blank line beyond that.
Confirmed exact bytes for input "hello": "hello\\nhello\\nhttp\\nexample.com\\n/test\\nq=hello\\nq\\nhello\\n".

## HARD RUST CONSTRAINTS
1. Rust 2021 edition. Toolchain is rustc/cargo 1.75.0. NO external crates whatsoever — std only.
   No dev-dependencies either. Cargo.toml must have an empty (or absent) [dependencies].
2. **BYTE-ORIENTED, NOT String-ORIENTED.** Output can contain NUL bytes and invalid UTF-8 (e.g. input "%ff"
   decodes to raw 0xFF; input "%00" decodes to 0x00). A Rust String CANNOT hold invalid UTF-8, and
   String::from_utf8_lossy would corrupt it into U+FFFD. Therefore:
     - read argv[1] as RAW BYTES via std::os::unix::ffi::OsStrExt / OsStringExt:
         use std::os::unix::ffi::OsStrExt;
         let arg = std::env::args_os().nth(1);  then  arg.as_os_str().as_bytes()  -> &[u8]
       (std::env::args() PANICS on non-UTF-8 argv, so args_os() is REQUIRED.)
     - operate on Vec<u8> / &[u8] throughout the library.
     - write with a locked, buffered std::io::stdout().write_all(&bytes) — do NOT use println! with a String
       for the payload lines. Flush explicitly before exiting.
   Verify this yourself: passing a raw 0xFF byte as argv[1], and passing "%ff"/"%00", must round-trip byte-exactly.
3. Exit status must be 1 (no output) when argc < 2, else 0. Use std::process::exit.
`

const PROJECT_LAYOUT = `
## REQUIRED PROJECT LAYOUT (both build paths MUST work)
Target directory for the final answer is /output (it already exists and is empty).
  /output/Cargo.toml       package name "test17", edition "2021", a [[bin]] named "test17" with path = "test17.rs"
  /output/test17.rs        THE ENTRY FILE, at the package ROOT (not in src/). Contains fn main().
  /output/src/...          the library code, split into MODULES (e.g. src/url_parser/mod.rs,
                           src/url_parser/encoding.rs, src/url_parser/url.rs)
Both of these must succeed:
  (a) cd /output && rustc test17.rs -o test17        # standalone, single-crate
  (b) cd /output && cargo build --release
To make BOTH work with one set of files, have test17.rs pull the library in with a #[path] module declaration, e.g.
    #[path = "src/url_parser/mod.rs"]
    mod url_parser;
and inside src/url_parser/mod.rs use ordinary "pub mod encoding;" / "pub mod url;" declarations, which resolve
relative to src/url_parser/. Do NOT add a [lib] target that would make cargo compile the same files twice under a
different crate root unless it genuinely builds clean. Keep it warning-free: build must emit no warnings.
Add a doc comment header to each module. Idiomatic, readable Rust — match the clarity of a hand-written port.
`

// ---------------------------------------------------------------- Harness
phase('Harness')

const HARNESS = '/tmp/difftest.sh'

await agent(
  `Write a rigorous BYTE-EXACT differential test harness at ${HARNESS} (bash, chmod +x).

Usage: ${HARNESS} <path-to-rust-binary>
It compares that binary against the reference C++ binary ${CPP} and must compare **raw bytes**, never shell
variables (output can contain NUL bytes and invalid UTF-8, which command substitution mangles). So: run each
binary redirecting stdout to a temp FILE, capture the exit status, and compare with "cmp -s". Also compare exit
statuses. Compare stdout only (ignore stderr).

The corpus must cover at least all of these argv[1] values:
  - the 5 documented examples: hello / world / test123 / "Hello World" / "hello world test"
  - the empty string ""
  - the NO-ARGUMENT case (invoke each binary with zero extra args; expect exit 1, empty stdout)
  - the EXTRA-ARGUMENT case (pass 3 args; argv[2..] must be ignored)
  - every single byte value from 1..255 inclusive, passed as a 3-char string "X<byte>Y" so that shell handling
    of leading/trailing whitespace and newlines cannot hide a difference. (Byte 0 cannot appear in argv — skip it.)
    Build these with printf and pass them safely; do NOT go through command substitution that strips newlines.
  - percent-escape torture: "%" "%2" "%20" "%2F" "%2f" "%zz" "%2z" "%z2" "%%" "%%%" "%%20" "%%41" "%1%20" "%q%20"
    "abc%" "abc%2" "100%25" "%00" "%00A" "%0a" "%0A" "%41" "%61" "%aB" "%Ab" "%ff" "%FF" "%fe%ff" "%C3%A9" "%e9"
  - plus-sign / form encoding: "+" "a+b" "+%20+" "%2b" "%2B" "a+b+c"
  - reserved chars and structure-breakers: "?" "#" "&" "=" "/" ":" "@" "[" "]" "q=1&r=2" "a#b?c" "://" "?#"
    "http://x" "//" "\\\\" ".." "." "-" "_" "~" "-._~"
  - UTF-8 / multibyte: "café" "日本語" "naïve" "€" "🎉" "Ωmega" "\\u00e9\\u0301"
  - long inputs: 1000 'a' chars; 500 spaces; 300 repetitions of "%ff"
  - whitespace-y: " " "  leading" "trailing  " "\\t" a literal newline, a literal CR, "a\\nb"
  - RANDOM FUZZ: at least 400 random inputs of random length 1..64 built from random bytes drawn from
    /dev/urandom with NUL bytes stripped out. Generate them by writing bytes to a file and reading with a method
    that preserves them exactly (e.g. build the arg via a tiny helper that uses "tr -d '\\\\000'" over
    "head -c N /dev/urandom" written to a file, then pass it using xargs -0 or by exec-ing with the file content
    read into a bash variable via read -r -d '' which preserves everything except NUL). Ensure high bytes and
    '%' and '+' occur frequently: also generate 200 random inputs drawn from the biased alphabet
    "%+abcdefABCDEF0123456789 =&?#/~._-" which is far more likely to hit escape-parsing edges.

Output: print one line per FAILING case with a hex dump of both outputs (od -An -tx1) truncated to something
readable, plus the argv shown with printf %q. At the end print a summary line exactly of the form
  "TOTAL=<n> PASS=<n> FAIL=<n>"
and exit 0 if FAIL==0 else exit 1.

Make it robust: use mktemp -d, clean up, do not leak temp files, and make sure a failing case does not abort the
whole run (no set -e pitfalls). It must be fast enough to run ~1300 cases in well under a minute.

Sanity-check the harness itself before you finish, in two ways:
  1. Run "${HARNESS} ${CPP}" — comparing the reference against ITSELF must report FAIL=0 and exit 0.
     If it does not, your harness is buggy (likely arg-passing corruption) — fix it until it does.
  2. Write a deliberately WRONG 5-line shim (e.g. a bash script that prints uppercase hex, or just "echo hi")
     and confirm the harness reports FAIL>0 and exits 1. This proves it can actually detect divergence.
Report: the absolute harness path, the total case count, and the results of both sanity checks.`,
  { label: 'build-oracle', schema: {
      type: 'object',
      additionalProperties: false,
      required: ['harnessPath', 'caseCount', 'selfCompareClean', 'detectsWrongImpl', 'notes'],
      properties: {
        harnessPath: { type: 'string' },
        caseCount: { type: 'integer' },
        selfCompareClean: { type: 'boolean', description: 'true if C++ vs C++ reports FAIL=0' },
        detectsWrongImpl: { type: 'boolean', description: 'true if a deliberately wrong shim reports FAIL>0' },
        notes: { type: 'string' },
      },
    } }
)

// ---------------------------------------------------------------- Implement + Verify (pipelined)
const CANDIDATES = [
  { id: 'a', dir: '/tmp/cand_a', angle:
    'Angle: cleanest idiomatic decomposition. src/url_parser/mod.rs re-exporting src/url_parser/encoding.rs ' +
    '(percent encode/decode over &[u8]) and src/url_parser/url.rs (the URL struct + parser). Favor small pure ' +
    'functions, exhaustive #[cfg(test)] unit tests asserting the exact spec examples, and zero clones in hot paths.' },
  { id: 'b', dir: '/tmp/cand_b', angle:
    'Angle: faithfulness-first / paranoid. Mirror the inferred C++ structure closely — free functions url_encode, ' +
    'url_decode, is_hex, hex_to_char, to_lower, trim, split_path, is_scheme_valid, is_host_valid, is_port_valid ' +
    'in one module, and a URL struct with scheme/userinfo/host/port/path/query/fragment accessors plus ' +
    'query_params/get_query_param in another. Prioritize exact byte semantics over elegance; add a unit test for ' +
    'every single edge case listed in the spec.' },
  { id: 'c', dir: '/tmp/cand_c', angle:
    'Angle: robustness + performance. Use a byte-table lookup ([bool; 256] or a const fn) for the unreserved set, ' +
    'pre-size output Vec capacity, write through a single BufWriter lock for all 8 lines, and structure the URL ' +
    'parser as an explicit state machine over byte slices with no intermediate allocation where avoidable.' },
]

phase('Implement')

const built = await pipeline(
  CANDIDATES,
  (c) => agent(
    `You are porting a C++ program to Rust. Build a COMPLETE, COMPILING cargo project at ${c.dir}
(create the directory; it does not exist yet).

${SPEC}

${PROJECT_LAYOUT.replace(/\/output/g, c.dir)}

${c.angle}

Then verify it yourself before reporting:
  1. cd ${c.dir} && cargo build --release 2>&1  — must succeed with ZERO warnings.
  2. cd ${c.dir} && rustc test17.rs -o /tmp/rustc_check_${c.id} 2>&1 — must also succeed with ZERO warnings.
  3. cargo test --release if you wrote unit tests — all must pass.
  4. Spot-check against the reference binary ${CPP} by hand on at least: "hello", "Hello World", "", "q=1&r=2",
     "%ff", "%00", "%%41", "a+b", "café", a raw 0xFF byte, and the no-argument case (exit 1, no output).
     Compare RAW BYTES (od -An -tx1), not shell strings.
  5. Run the shared differential harness: /tmp/difftest.sh ${c.dir}/target/release/test17
     Iterate on your code until it reports FAIL=0. Do NOT stop while any case fails.

Report the absolute path of the release binary, whether both build paths are warning-free, the harness
TOTAL/PASS/FAIL numbers, and a one-paragraph description of your module layout.`,
    { label: 'impl:' + c.id, phase: 'Implement', schema: {
        type: 'object',
        additionalProperties: false,
        required: ['dir', 'binaryPath', 'cargoClean', 'rustcClean', 'harnessFail', 'harnessTotal', 'layout'],
        properties: {
          dir: { type: 'string' },
          binaryPath: { type: 'string' },
          cargoClean: { type: 'boolean', description: 'cargo build --release succeeded with no warnings' },
          rustcClean: { type: 'boolean', description: 'rustc test17.rs succeeded with no warnings' },
          harnessFail: { type: 'integer' },
          harnessTotal: { type: 'integer' },
          layout: { type: 'string' },
        },
      } }
  ).then((r) => (r ? { ...r, id: c.id } : null)),

  (impl, c) => {
    if (!impl) return null
    return agent(
      `INDEPENDENT VERIFICATION of a Rust port that claims byte-for-byte parity with a C++ binary.
You did NOT write this code. Be skeptical and adversarial. Do not fix the code; only assess it.

Rust project: ${c.dir}   (claimed binary: ${impl.binaryPath})
Reference C++ binary: ${CPP}
Shared differential harness: /tmp/difftest.sh <rust-binary>

Do all of the following:
  1. Rebuild from scratch yourself: rm -rf ${c.dir}/target, then cd ${c.dir} && cargo build --release 2>&1.
     Record whether it is warning-free. Also independently run: cd ${c.dir} && rustc test17.rs -o /tmp/vr_${c.id}.
  2. Confirm ZERO external dependencies: read ${c.dir}/Cargo.toml and confirm [dependencies] is empty/absent and
     there is no Cargo.lock referencing any registry package, and grep the sources for "extern crate" / "use "
     lines naming anything outside std/core/alloc.
  3. Confirm the required layout: /output-equivalent root has Cargo.toml + test17.rs at the PACKAGE ROOT, and the
     library lives in src/ split across MODULES (more than one file).
  4. Run the shared harness and record TOTAL/PASS/FAIL verbatim.
  5. Then go BEYOND the harness — hunt for divergence it might miss. Design and run at least 30 NEW adversarial
     cases of your own. Ideas: raw 0xFF / 0x80 / 0xFE bytes alone and in sequences; overlong and truncated UTF-8;
     "%" at the very end of a long string; "%0" ; "%g0"; strings of only '%'; 10000-char inputs; inputs that are
     entirely high bytes; "%25%32%30" (double-encoded); "+++"; mixed "%2b+%2B"; a string containing 0x7F;
     inputs whose decoded form contains embedded NUL followed by more text ("%00abc%00def"); CR-only and CRLF;
     and anything else you suspect. Compare raw bytes AND exit codes.
  6. Explicitly verify the two highest-risk traps: (a) hex case — the C++ encoder emits LOWERCASE hex; confirm the
     Rust one never emits uppercase; (b) non-UTF-8 handling — confirm the Rust binary does not panic on a
     non-UTF-8 argv[1] (a naive std::env::args() would panic) and does not substitute U+FFFD anywhere.

Report the harness numbers, your extra case count, and every genuine divergence you found (empty list if none).`,
      { label: 'verify:' + c.id, phase: 'Verify', schema: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'rebuildClean', 'zeroDeps', 'layoutOk', 'harnessTotal', 'harnessPass', 'harnessFail',
                     'extraCases', 'lowercaseHexOk', 'nonUtf8Ok', 'divergences', 'verdict'],
          properties: {
            id: { type: 'string' },
            rebuildClean: { type: 'boolean' },
            zeroDeps: { type: 'boolean' },
            layoutOk: { type: 'boolean' },
            harnessTotal: { type: 'integer' },
            harnessPass: { type: 'integer' },
            harnessFail: { type: 'integer' },
            extraCases: { type: 'integer' },
            lowercaseHexOk: { type: 'boolean' },
            nonUtf8Ok: { type: 'boolean' },
            divergences: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['input', 'cppOutput', 'rustOutput'],
                properties: { input: { type: 'string' }, cppOutput: { type: 'string' }, rustOutput: { type: 'string' } },
              },
            },
            verdict: { type: 'string', enum: ['PARITY', 'DIVERGENT', 'BROKEN'] },
          },
        } }
    ).then((v) => ({ impl, verify: v, cand: c }))
  }
)

const usable = built.filter(Boolean).filter((r) => r.verify)
log('candidates verified: ' + usable.map((r) => r.cand.id + '=' + r.verify.verdict + '/fail:' + r.verify.harnessFail).join(', '))

const clean = usable.filter((r) =>
  r.verify.verdict === 'PARITY' && r.verify.harnessFail === 0 &&
  r.verify.zeroDeps && r.verify.layoutOk && r.verify.divergences.length === 0)

if (usable.length === 0) return { error: 'no candidate produced a verifiable build' }

// ---------------------------------------------------------------- Judge
phase('Judge')

const pool = clean.length > 0 ? clean : usable
const judgeInput = pool.map((r) =>
  '- id=' + r.cand.id + ' dir=' + r.cand.dir + ' verdict=' + r.verify.verdict +
  ' harnessFail=' + r.verify.harnessFail + ' rebuildClean=' + r.verify.rebuildClean +
  ' layout: ' + r.impl.layout).join('\n')

const scores = await parallel(['code-quality', 'spec-fidelity'].map((lens) => () => agent(
  `Pick the best of these independently-written Rust ports. All are in the running; judge through the ${lens} lens.

${judgeInput}

Read the actual source files in each candidate directory (test17.rs, src/**). Judge on:
  - ${lens === 'code-quality'
      ? 'module decomposition, naming, idiomatic std usage, absence of needless allocation/cloning, readability, ' +
        'quality and coverage of #[cfg(test)] unit tests, doc comments'
      : 'exact fidelity to the byte-level spec (lowercase hex, unsigned high bytes, malformed-% advance-by-1, ' +
        '+ -> space, byte-oriented I/O via args_os + write_all, exit-1-on-argc<2), and whether the URL parser is a ' +
        'genuine general parser rather than hardcoded constants that only happen to pass this test'}
  - CRITICAL DISQUALIFIER: if a candidate HARDCODES the outputs (e.g. literally prints "http"/"example.com"/"/test"
    without parsing, or special-cases the test inputs), score it 0 and say so. It must genuinely parse the URL it builds.
Return a ranking best-first with a one-line justification per candidate and a 0-10 score each.`,
  { label: 'judge:' + lens, phase: 'Judge', schema: {
      type: 'object', additionalProperties: false, required: ['ranking'],
      properties: { ranking: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'score', 'why'],
        properties: { id: { type: 'string' }, score: { type: 'number' }, why: { type: 'string' } } } } },
    } })))

const tally = {}
for (const s of scores.filter(Boolean))
  for (const r of s.ranking) tally[r.id] = (tally[r.id] || 0) + r.score

let winner = pool[0]
for (const r of pool) if ((tally[r.cand.id] || 0) > (tally[winner.cand.id] || 0)) winner = r
log('winner: candidate ' + winner.cand.id + ' (score ' + (tally[winner.cand.id] || 0) + ') from ' + winner.cand.dir)

// ---------------------------------------------------------------- Promote
phase('Promote')

const promoted = await agent(
  `Install the winning Rust port into its FINAL location: /output

Source of truth: the project at ${winner.cand.dir} (candidate ${winner.cand.id}).
Reference C++ binary: ${CPP}. Shared harness: /tmp/difftest.sh <rust-binary>

Steps:
  1. /output currently exists. Copy the project there so the final layout is exactly:
       /output/Cargo.toml
       /output/test17.rs          <- entry file at the PACKAGE ROOT, contains fn main()
       /output/src/...            <- library, split across multiple MODULE files
     Do NOT copy any target/ directory or Cargo.lock from the candidate; regenerate them in place.
     Make sure every #[path] attribute and mod declaration still resolves correctly at the new location
     (paths must be relative, not absolute, and not contain "${winner.cand.dir}").
  2. cd /output && cargo build --release 2>&1  — must succeed, ZERO warnings.
  3. cd /output && rustc test17.rs -o test17 2>&1 — must succeed, ZERO warnings. This leaves the standalone
     executable at /output/test17.
  4. cargo test --release — all unit tests must pass (if any exist).
  5. Run /tmp/difftest.sh on BOTH produced binaries — /output/test17 AND /output/target/release/test17.
     Both must report FAIL=0. Iterate until they do.
  6. Re-run the 5 documented examples from the original test17.cpp header comment against /output/test17 and
     confirm the output matches the documented "Program Output" blocks character for character.
  7. Add a concise /output/README.md documenting: how to build both ways, the module layout, and the three
     non-obvious behaviors a reader would otherwise get wrong (lowercase hex, malformed-% passthrough advancing
     one byte, byte-oriented I/O for non-UTF-8 argv). Keep it short and factual.
  8. Final check: confirm zero external dependencies (Cargo.toml [dependencies] empty/absent) and print the
     output of "ls -R /output" excluding target/.

Report the final file list, both binary paths, the harness numbers for each binary, and whether the 5 documented
examples matched exactly.`,
  { label: 'promote-to-output', schema: {
      type: 'object', additionalProperties: false,
      required: ['files', 'rustcBinary', 'cargoBinary', 'harnessFailRustc', 'harnessFailCargo',
                 'examplesMatch', 'cargoClean', 'rustcClean', 'unitTestsPass', 'notes'],
      properties: {
        files: { type: 'array', items: { type: 'string' } },
        rustcBinary: { type: 'string' },
        cargoBinary: { type: 'string' },
        harnessFailRustc: { type: 'integer' },
        harnessFailCargo: { type: 'integer' },
        examplesMatch: { type: 'boolean' },
        cargoClean: { type: 'boolean' },
        rustcClean: { type: 'boolean' },
        unitTestsPass: { type: 'boolean' },
        notes: { type: 'string' },
      },
    } }
)

// ---------------------------------------------------------------- Audit
phase('Audit')

const AUDITS = [
  { key: 'fresh-fuzz', prompt:
    'Run a FRESH, INDEPENDENT fuzz campaign against /output/test17 vs the reference. Do not reuse /tmp/difftest.sh — ' +
    'write your own comparison loop from scratch (so a bug in that harness cannot hide a bug in the port). Do at ' +
    'least 1500 random cases: random binary blobs (NUL stripped), random UTF-8 including astral-plane emoji and ' +
    'combining marks, and heavily biased strings over "%+ =&?#/aAfF09~._-" of lengths 1..40. Compare stdout raw ' +
    'bytes and exit codes. Report any divergence with hex dumps.' },
  { key: 'requirements', prompt:
    'AUDIT COMPLIANCE against the task requirements, reading the actual files under /output. Check each and report ' +
    'pass/fail with evidence: (1) pure Rust, edition 2021 declared in Cargo.toml; (2) CLI args parsed via ' +
    'std::env (args_os counts) and accepts the same arguments as the C++ binary — argv[1] required, argv[2..] ' +
    'ignored, argc<2 exits 1 with no output; (3) ZERO external crates — no crates.io deps anywhere, no ' +
    'dev-dependencies, Cargo.lock contains no registry packages; (4) library code organized into MODULES (must be ' +
    'more than one file under src/); (5) entry file is at /output/test17.rs, the PACKAGE ROOT; (6) an executable ' +
    'was actually produced and is runnable; (7) both "rustc test17.rs" and "cargo build --release" work from a ' +
    'clean tree. Actually EXECUTE the builds in a scratch copy to prove (7) — do not just read files.' },
  { key: 'hardcode-hunt', prompt:
    'ADVERSARIAL CODE REVIEW of /output. Your goal is to prove the port is CHEATING or FRAGILE. Read every source ' +
    'file. Specifically hunt for: outputs hardcoded as string literals ("http", "example.com", "/test") rather than ' +
    'produced by real parsing; special-casing of specific test inputs; a query_params that assumes exactly one ' +
    'param or hardcodes the key "q"; panics reachable from user input (unwrap/expect/slicing/indexing that could ' +
    'go out of bounds or split a multi-byte boundary); integer overflow in hex math; use of String/from_utf8_lossy ' +
    'anywhere on the payload path that would corrupt invalid UTF-8; and any place a subtractive index like i+2 ' +
    'could underflow or over-read. For each suspected issue, CONSTRUCT AN INPUT that triggers it and actually run ' +
    'both binaries to prove or disprove it. Report only issues you empirically confirmed, plus any confirmed-safe ' +
    'notes about traps you checked and cleared.' },
  { key: 'unicode-locale', prompt:
    'Stress the environmental and boundary conditions of /output/test17 vs the reference: run both under different ' +
    'locales (LC_ALL=C, LC_ALL=C.UTF-8, LANG=en_US.UTF-8) and confirm identical bytes; test stdout redirected to a ' +
    'file vs a pipe vs /dev/null (buffering differences and missing flushes show up here — confirm the Rust binary ' +
    'flushes and does not lose output when stdout is a pipe that closes early, and check for a broken-pipe panic ' +
    'by piping to "head -1"); test a 1 MiB argv[1]; test argv[1] consisting of 100000 "%" characters; test inputs ' +
    'with a trailing incomplete escape at exactly the buffer boundary. Report any divergence or panic.' },
]

const audits = await parallel(AUDITS.map((a) => () => agent(
  `${a.prompt}

Context: /output holds a zero-dependency Rust port of the C++ program ${'/workspace/dataset/url-parser/tests/test17.cpp'}.
Reference C++ binary: ${CPP}. Rust binaries: /output/test17 and /output/target/release/test17.
The behavioral spec the port must satisfy is below for reference.
${SPEC}

Report findings as structured data. Only report issues you EMPIRICALLY CONFIRMED by running commands.`,
  { label: 'audit:' + a.key, phase: 'Audit', schema: {
      type: 'object', additionalProperties: false, required: ['key', 'passed', 'issues', 'evidence'],
      properties: {
        key: { type: 'string' },
        passed: { type: 'boolean' },
        issues: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['severity', 'summary', 'repro'],
          properties: {
            severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
            summary: { type: 'string' }, repro: { type: 'string' } } } },
        evidence: { type: 'string' },
      },
    } })))

const auditResults = audits.filter(Boolean)
const openIssues = auditResults.flatMap((a) => a.issues.map((i) => ({ ...i, area: a.key })))
const blocking = openIssues.filter((i) => i.severity === 'critical' || i.severity === 'major')

// ---------------------------------------------------------------- Repair if needed
let repair = null
if (blocking.length > 0) {
  phase('Audit')
  log('repairing ' + blocking.length + ' blocking issue(s)')
  repair = await agent(
    `Independent audits of the Rust port in /output found these EMPIRICALLY CONFIRMED blocking issues:

${blocking.map((i, n) => (n + 1) + '. [' + i.severity + '/' + i.area + '] ' + i.summary + '\n   repro: ' + i.repro).join('\n')}

Fix ALL of them in /output while preserving byte-for-byte parity with ${CPP} and the required project layout
(Cargo.toml + test17.rs at the package root, library in modules under src/, zero external crates).
For each issue: reproduce it first, fix it, then prove the fix by re-running the repro against both binaries.
Then re-verify everything: cargo build --release (zero warnings), rustc test17.rs -o test17 (zero warnings),
cargo test --release, /tmp/difftest.sh on both /output/test17 and /output/target/release/test17 (both FAIL=0),
and the 5 documented examples. Report what you changed and the final verification numbers.`,
    { label: 'repair', phase: 'Audit', schema: {
        type: 'object', additionalProperties: false,
        required: ['fixed', 'unfixed', 'harnessFail', 'buildsClean', 'summary'],
        properties: {
          fixed: { type: 'array', items: { type: 'string' } },
          unfixed: { type: 'array', items: { type: 'string' } },
          harnessFail: { type: 'integer' },
          buildsClean: { type: 'boolean' },
          summary: { type: 'string' },
        },
      } }
  )
}

return {
  winner: winner.cand.id,
  scores: tally,
  candidates: usable.map((r) => ({ id: r.cand.id, verdict: r.verify.verdict, harnessFail: r.verify.harnessFail })),
  promoted,
  audits: auditResults.map((a) => ({ key: a.key, passed: a.passed, issueCount: a.issues.length })),
  openIssues,
  repair,
}
