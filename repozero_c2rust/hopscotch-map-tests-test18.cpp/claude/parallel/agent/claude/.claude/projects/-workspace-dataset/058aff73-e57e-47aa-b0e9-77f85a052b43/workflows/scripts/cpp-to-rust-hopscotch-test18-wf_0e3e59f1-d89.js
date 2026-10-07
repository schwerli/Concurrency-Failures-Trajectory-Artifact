export const meta = {
  name: 'cpp-to-rust-hopscotch-test18',
  description: 'Port hopscotch-map test18.cpp to a dependency-free Rust Cargo project in /output, then differentially verify against the C++ binary',
  phases: [
    { title: 'Spec', detail: 'independent scouts: reserve/bucket_count math, CLI/error semantics, hopscotch algorithm design' },
    { title: 'Implement', detail: 'write the Cargo project + modules + test18.rs and build it' },
    { title: 'Verify', detail: 'exhaustive differential testing, adversarial code review, build hygiene' },
    { title: 'Fix', detail: 'apply fixes for confirmed divergences and re-verify' },
    { title: 'Final', detail: 'final full differential sweep + report' },
  ],
}

const CONTEXT = `
# Task context (shared)

We are porting this C++ program to pure Rust (2021 edition, ZERO external crates, std only):

--- /workspace/dataset/hopscotch-map/tests/test18.cpp ---
#include <iostream>
#include <string>
#include "../include/tsl/hopscotch_map.h"

int main(int argc, char* argv[]) {
    int count = 18;
    if (argc > 1 && std::string(argv[1]) == "--a") {
        count = std::stoi(argv[2]);
    }

    tsl::hopscotch_map<int, int> map;
    map.reserve(count);

    for (int i = 0; i < count; i++) {
        map.insert({i, i * 14});
    }

    std::cout << map.size() << " " << map.bucket_count() << " " << map.overflow_size() << std::endl;

    return 0;
}
---

IMPORTANT: The tsl C++ library source is NOT present on disk (only test18.cpp and the compiled
binary exist). This is a BLACK-BOX port. Do NOT attempt to fetch or read the tsl library source.
Infer behavior from the compiled reference binary: /workspace/dataset/test18_executable
(run it with any args, e.g. \`/workspace/dataset/test18_executable --a 15\`).

## Empirical data already gathered by the lead (verify, don't blindly trust)

Reference outputs (stdout) for \`--a N\`:
N:  0->"0 0 0"   1->"1 2 0"    2->"2 4 0"    3->"3 4 0"    4->"4 8 0"    5->"5 8 0"
    7->"7 8 0"   8->"8 16 0"  14->"14 16 0" 15->"15 32 0" 18->"18 32 0" 28->"28 32 0"
   29->"29 64 0" 57->"57 64 0" 58->"58 128 0" 115->"115 128 0" 116->"116 256 0"
  200->"200 256 0" 1000->"1000 2048 0" 1024->"1024 2048 0" 1000000->"1000000 2097152 0"
No args (or a first arg that is not exactly "--a", e.g. "--b 5", "--a=5", "--a ") -> "18 32 0", exit 0.

Derived model (bucket_count):
  max_load_factor = 0.9  (definitively bracketed to [0.8984375, 0.9046875) by the transitions
                          3->4, 7->8, 14->16, 28->32, 57->64, 115->128)
  reserve(count): target = std::ceil(float(count) / 0.9f); bucket_count = round_up_to_power_of_two(size_t(target))
  round_up_to_power_of_two(0) special-cases to 0 buckets (growth policy leaves mask 0 when input is 0).
  overflow_size() is always 0 for these inputs (std::hash<int> in libstdc++ is identity, keys 0..n-1
  land in distinct buckets, so nothing ever overflows the neighborhood).

Error/edge semantics of the reference binary (stderr + exit code):
 * \`--a\` with NO second arg: C++ builds std::string(nullptr) -> throws; prints to stderr:
     terminate called after throwing an instance of 'std::logic_error'
       what():  basic_string::_S_construct null not valid
   then SIGABRT (shell reports exit code 134).
 * \`--a abc\` (unparseable): stderr:
     terminate called after throwing an instance of 'std::invalid_argument'
       what():  stoi
   then SIGABRT (134).
 * \`--a 9999999999999999999999\` (out of int range): stderr:
     terminate called after throwing an instance of 'std::out_of_range'
       what():  stoi
   then SIGABRT.
 * std::stoi parsing quirks (base 10): "0x10"->0, " 12"->12 (leading whitespace skipped),
   "+7"->7, "12.9"->12 (trailing junk ignored), "7xyz"->7.
 * NEGATIVE count (e.g. --a -1, --a -100, --a -2147483648) -> prints "0 0 0", exit 0.
   Why: reserve(size_type(negative)) sign-extends to a huge size_t; float(huge)/0.9f is ~2.05e19
   which is >= 2^64, and the C++ float->size_t conversion is UB. On x86-64 the emitted sequence
   (subtract 2^63, cvttss2si, add back 2^63) yields 0 for values >= 2^64. So bucket_count becomes 0,
   the insert loop body never runs, and it prints "0 0 0".

## Deliverable layout (hard requirements)
 * A complete Cargo project rooted at /output.
 * Library code organized into modules under /output/src/.
 * The entry file must be /output/test18.rs (package root, NOT src/main.rs).
 * BOTH of these must work:
     cd /output && rustc test18.rs          # standalone, produces /output/test18
     cd /output && cargo build --release    # via [[bin]] name="test18" path="test18.rs"
   (Achieve this by having test18.rs pull in the modules with #[path = "src/lib.rs"] mod ...;
    so nested \`pub mod\` declarations inside src/lib.rs resolve relative to src/.)
 * A compiled executable must exist in /output after you are done.
 * Zero external crates. std only. Rust 2021 edition.
 * stdout must be byte-for-byte identical to the C++ binary for every input.
`.trim()

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'Concise summary of your conclusions' },
    spec: { type: 'string', description: 'Detailed, implementation-ready spec in markdown. Include exact formulas, pseudo-code, and cited empirical evidence.' },
    corrections: { type: 'array', items: { type: 'string' }, description: 'Anything in the lead-provided data you found to be WRONG or incomplete, with evidence' },
    edge_cases: { type: 'array', items: { type: 'string' }, description: 'Edge cases the implementer must handle, each with the expected reference output' },
  },
  required: ['summary', 'spec', 'corrections', 'edge_cases'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pass: { type: 'boolean', description: 'true only if you found ZERO real problems' },
    commands_run: { type: 'array', items: { type: 'string' } },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          title: { type: 'string' },
          evidence: { type: 'string', description: 'Concrete reproduction: exact command, expected vs actual bytes' },
          location: { type: 'string', description: 'file:line if applicable' },
          suggested_fix: { type: 'string' },
        },
        required: ['severity', 'title', 'evidence', 'suggested_fix'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['pass', 'commands_run', 'issues', 'notes'],
}

const FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' }, description: 'Issue titles you deliberately did not fix, with reason' },
    build_ok: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['fixed', 'skipped', 'build_ok', 'notes'],
}

// ---------------------------------------------------------------- Phase 1: Spec
phase('Spec')

const SCOUTS = [
  {
    label: 'spec:reserve-math',
    prompt: `${CONTEXT}

YOUR JOB (read-only investigation — do NOT write any files):
Nail down, with certainty, the EXACT function count(int) -> bucket_count(size_t) implemented by
tsl::hopscotch_map's reserve() + power_of_two growth policy as compiled in the reference binary.

Do this empirically and exhaustively:
 1. Run /workspace/dataset/test18_executable --a N for EVERY N in 0..=300 and record bucket_count.
    Then sweep the transition regions around every power of two up to at least 2^17 (e.g. for each
    power of two P, test N near 0.9*P: floor(0.9*P)-2 .. floor(0.9*P)+2). Use a shell loop; it is fast.
 2. Confirm or refute the model bucket_count = round_up_pow2(size_t(ceil(f32(N)/0.9f))) with
    bucket_count(0)=0. Report ANY N where the model disagrees with the binary.
 3. Determine whether the division must be done in f32 (float) or whether f64 gives identical
    results for all N in 0..=2^31-1. Reason about it analytically (10*N/9 can never be within 0.2 of
    an integer for the relevant N, so the ceil boundary is never close) AND spot-check big N values
    that are cheap to test. State clearly which is safe, and recommend implementing it in f32 for
    fidelity regardless.
 4. Work out the exact Rust code needed to emulate the C++ \`size_t(some_float)\` UB cast on x86-64
    (value >= 2^64 -> 0; value in [2^63, 2^64) -> correct truncation; NaN/negative -> what?). Rust's
    \`as\` cast saturates instead, so a manual emulation is required. Give the exact Rust snippet.
    Verify your emulation reproduces the observed "0 0 0" output for --a -1 and --a -2147483648.
 5. Also determine round_up_to_power_of_two's behavior for inputs that are already powers of two
    (non-strict: returns the input unchanged) using the empirical data, and give exact Rust code
    using leading_zeros/checked arithmetic.
 6. Establish the insert-time growth threshold: load_threshold = size_t(f32(bucket_count) * 0.9f).
    Prove from the data that with reserve(N) followed by N inserts, no growth rehash is ever
    triggered (i.e. N < load_threshold(bucket_count(N)) for all N>=1) — or find the N where it IS
    triggered and say what the binary prints there.

Return an implementation-ready spec with exact formulas and Rust snippets.`,
  },
  {
    label: 'spec:cli-semantics',
    prompt: `${CONTEXT}

YOUR JOB (read-only investigation — do NOT write any files):
Produce an exact, implementation-ready spec for the CLI/argument/error behavior of the reference
binary, so the Rust port is indistinguishable.

Cover:
 1. Argument dispatch: exactly when is argv[2] read? (argc > 1 && argv[1] == "--a"). Confirm with
    the binary: no args, one non-matching arg, "--a" alone, "--a" + count, "--a" + count + extra
    junk args, empty-string first arg, arg with trailing space. Note that std::env::args() in Rust
    includes argv[0], so indices line up if you keep the vector whole.
 2. std::stoi semantics that must be re-implemented from scratch in std-only Rust (do NOT just use
    str::parse — it rejects leading whitespace, "+7" is fine but "12.9"/"7xyz"/"0x10" are not):
      - skip leading whitespace (which characters? C locale isspace: ' ', \\t, \\n, \\v, \\f, \\r)
      - optional +/- sign
      - base 10 digits, stop at first non-digit
      - if NO digits were consumed -> std::invalid_argument
      - if the value does not fit in int (32-bit) -> std::out_of_range (note: strtol parses into
        long, then stoi range-checks against int; determine the exact boundary behavior for
        "2147483648", "-2147483649", "99999999999999999999", "-99999999999999999999")
      - what does the binary print/exit for each? Test all of these against the reference binary and
        record stderr text + exit code (use \`echo rc=$?\`; note bash reports 134 for SIGABRT).
 3. The exact stderr byte sequences for the three abort paths (null argv[2], invalid_argument,
    out_of_range) and the exact process termination signal/exit status. Capture them with
    \`2>&1 | cat -A\` or \`xxd\` so trailing whitespace is exact (note "  what():  stoi" spacing:
    two leading spaces, two spaces after the colon).
 4. Recommend precisely how the Rust port should reproduce each abort path: print the identical
    two lines to stderr, then std::process::abort() (which raises SIGABRT so the shell also reports
    134). Confirm empirically that a tiny Rust test program calling abort() gives shell rc=134.
 5. stdout formatting: "<size> <bucket_count> <overflow_size>" + std::endl (newline, flushed).
    Confirm there is no trailing space and exactly one trailing newline (verify with xxd).

Return an implementation-ready spec.`,
  },
  {
    label: 'spec:hopscotch-design',
    prompt: `${CONTEXT}

YOUR JOB (read-only design work — do NOT write any files):
Design (in Rust, std-only) a faithful hopscotch hash map that provides exactly the observable API
this test needs: reserve(n), insert((k,v)), size(), bucket_count(), overflow_size(), plus enough of
the real algorithm that overflow_size() and bucket_count() would still be correct for adversarial
key sequences (not just 0..n-1).

Requirements for your design:
 * Generic over K: Eq + Hash-like, V. Use a hasher trait that lets us plug in an IDENTITY hash for
   integers, matching libstdc++'s std::hash<int> (static_cast<size_t>(value), i.e. sign-extension
   for negatives). Do NOT use std::collections::hash_map::DefaultHasher for the int case — bucket
   distribution (and thus overflow_size) depends on the identity hash.
 * power-of-two growth policy: bucket_for_hash(h) = h & mask, growth factor 2, mask 0 when
   bucket_count is 0.
 * Bucket array of length bucket_count + NEIGHBORHOOD_SIZE - 1 (padding so a neighborhood never
   wraps past the end). NEIGHBORHOOD_SIZE = 62 for tsl::hopscotch_map's default
   (hopscotch_map<K,V> default NeighborhoodSize template arg is 62, bitmap type u64 with a couple
   of bits reserved / or 62 bits used). Each bucket stores: an optional (K,V) entry, a
   neighborhood bitmap of NEIGHBORHOOD_SIZE bits marking which of the following buckets hold
   entries hashing to this bucket, and an "overflow" flag meaning "some element hashing here lives
   in the overflow list".
 * insert(k,v): if key already present (search this bucket's neighborhood via the bitmap, plus the
   overflow list when the overflow flag is set) -> return without inserting (std::unordered_map-style
   insert does NOT overwrite). Else, if size >= load_threshold -> grow (rehash to
   bucket_count*2) first. Then linear-probe for the first empty slot at or after ibucket; if it is
   within [ibucket, ibucket+NEIGHBORHOOD_SIZE) place it and set the bitmap bit; otherwise perform
   the hopscotch swap/displacement chain to move an empty slot into the neighborhood; if that is
   impossible, push into the overflow list, set the overflow flag, and count it in overflow_size().
   Handle bucket_count == 0 (must grow before any insert).
 * reserve(n) / rehash(n): follow the C++ formulas the other scout is pinning down; re-inserting all
   elements (including overflow ones) into the new table, resetting overflow_size.
 * Keep the code clean, idiomatic, well-commented Rust with no unsafe, no external crates, and no
   dead-code warnings. Note that this specific test only needs insert/size/bucket_count/
   overflow_size, so don't gold-plate with a full API surface that would trip dead_code warnings —
   or mark genuinely-public library API with pub and put it behind a lib target so it isn't dead.
 * Propose the exact module layout under /output/src/ (e.g. lib.rs, growth.rs, hash.rs,
   hopscotch.rs, cxx_compat.rs) with a one-line responsibility per module, and how /output/test18.rs
   wires it up so BOTH \`rustc test18.rs\` and \`cargo build --release\` work.
 * Include a plan for a few #[cfg(test)] unit tests that exercise the neighborhood/overflow path
   with deliberately colliding keys (e.g. keys that are all multiples of bucket_count under the
   identity hash), so the overflow logic is actually covered.

Return the design as a detailed spec with module layout, key data structures, and pseudo-code /
real Rust for the tricky parts (hopscotch displacement, growth, bitmap maintenance).`,
  },
]

const specs = await parallel(SCOUTS.map(s => () => agent(s.prompt, { label: s.label, phase: 'Spec', schema: SPEC_SCHEMA })))
const goodSpecs = specs.filter(Boolean)
log(`specs gathered: ${goodSpecs.length}/${SCOUTS.length}`)

const specBundle = goodSpecs.map((s, i) => `
===== SPEC ${i + 1}: ${SCOUTS[i] ? SCOUTS[i].label : 'unknown'} =====
SUMMARY: ${s.summary}

${s.spec}

CORRECTIONS TO LEAD-PROVIDED DATA:
${(s.corrections || []).map(c => `- ${c}`).join('\n') || '(none)'}

EDGE CASES TO HANDLE:
${(s.edge_cases || []).map(c => `- ${c}`).join('\n') || '(none)'}
`).join('\n')

// ----------------------------------------------------------- Phase 2: Implement
phase('Implement')

const implResult = await agent(`${CONTEXT}

Three specialist scouts investigated the reference binary and produced these specs. Trust them, but
re-verify anything that looks contradictory by running the reference binary yourself.

${specBundle}

YOUR JOB: build the complete deliverable at /output. Write real files with the Write tool.

Checklist:
 1. /output/Cargo.toml — package name "test18", edition "2021", NO dependencies. Declare
    [[bin]] name = "test18", path = "test18.rs". Also declare a [lib] (name e.g. "hopscotch_map",
    path = "src/lib.rs") so the library code is a real library target.
 2. /output/src/*.rs — the library modules (growth policy, identity/std hash shim, the hopscotch
    map itself, and a C++-compat module for std::stoi + the float->size_t UB cast + the
    terminate/abort helpers). Well-commented, idiomatic, no unsafe, std only.
 3. /output/test18.rs — a faithful transliteration of main(): default count = 18, the
    \`argc > 1 && argv[1] == "--a"\` dispatch, stoi(argv[2]) with the null-argv[2] abort path,
    reserve(count), the insert loop with i*14 (use wrapping_mul to avoid a panic on overflow in
    release/debug alike), then
    println!("{} {} {}", map.len(), map.bucket_count(), map.overflow_size()).
    It must pull in the modules via \`#[path = "src/lib.rs"] mod <name>;\` so that plain
    \`rustc test18.rs\` from /output compiles standalone.
 4. Build BOTH ways and make sure both succeed with ZERO warnings:
      cd /output && cargo build --release 2>&1 | tail -30
      cd /output && rustc test18.rs 2>&1 | tail -30    # leaves the executable at /output/test18
    Leave the rustc-produced executable /output/test18 in place at the end.
 5. Run \`cargo test\` and make sure your unit tests pass (include tests for the
    neighborhood/overflow/displacement path with deliberately colliding keys, and tests for the
    bucket_count formula and stoi semantics).
 6. Self-verify with a differential sweep before you return:
      for n in $(seq 0 300); do
        a=$(/workspace/dataset/test18_executable --a $n); b=$(/output/test18 --a $n);
        [ "$a" = "$b" ] || echo "MISMATCH n=$n cpp='$a' rust='$b'";
      done
    plus the no-arg case, the negative cases, and the three abort paths (compare stderr bytes and
    exit codes). Fix everything you find. Do not return until the sweep is clean.

Return a summary of what you created, the exact build/test commands you ran with their outcomes,
and anything you were unsure about.`, { label: 'implement', phase: 'Implement' })

log('implementation pass complete')

// -------------------------------------------------------------- Phase 3+4: loop
const VERIFIERS = [
  {
    label: 'verify:differential',
    prompt: `${CONTEXT}

YOUR JOB: exhaustive black-box differential testing of /output/test18 (the Rust port) against
/workspace/dataset/test18_executable (the C++ reference). You are a tester: you may run anything,
but do NOT edit source files.

If /output/test18 is missing or stale, rebuild it: \`cd /output && rustc test18.rs\`.
(Also confirm \`cargo build --release\` works and that /output/target/release/test18 agrees.)

Test, comparing stdout EXACTLY (byte-for-byte), plus stderr and exit codes:
 1. Every N from 0 to 2000 inclusive via --a N.
 2. Around every power-of-two boundary up to 2^20: for each P, N in {floor(0.9P)-3 .. floor(0.9P)+3}
    and {P-2..P+2}. Skip only what is genuinely too slow; report anything you skipped.
 3. Large N: 100000, 999999, 1000000, 1048576, 1048577, 1500000, 2000000 (time each; skip and SAY SO
    if a run exceeds ~60s).
 4. Negative: -1, -2, -100, -12345, -2147483647, -2147483648.
 5. int-boundary strings: "2147483647", "2147483648", "-2147483648", "-2147483649",
    "99999999999999999999", "-99999999999999999999".
 6. stoi quirks: "0x10", " 12", "+7", "12.9", "7xyz", "", " ", "-", "+", "  -0", "007",
    "\\t42", "42\\n", "1e3", "--", "0", "-0".
 7. Arg dispatch: no args; "--b 5"; "--a=5"; "--a " (trailing space); "" (empty first arg);
    "--a 5 99" (extra arg); "--a" alone (abort path); "--a" with an empty second arg "".
 8. For each abort path, compare stderr byte-for-byte (use \`2>&1 >/dev/null | xxd\` or \`cat -A\`)
    and compare the exit status (\`echo rc=$?\`; SIGABRT shows as 134).
 9. Verify the stdout of a normal run ends with exactly one \\n and has no trailing space (xxd).

Write your sweep as shell loops that print only mismatches, so the output stays small. Report the
total number of cases compared. Every mismatch is an issue with the exact reproducing command and
the expected vs actual bytes. Be precise about whether a difference is on stdout (must match
exactly) vs stderr/exit-code (should match).`,
  },
  {
    label: 'verify:adversarial-review',
    prompt: `${CONTEXT}

YOUR JOB: adversarial code review of the Rust project at /output. Read every file. You may run
things (including the reference binary and the Rust binary) to CONFIRM suspicions, but do NOT edit
source files. Your goal is to find real defects that black-box sweeps over "nice" inputs would miss.

Hunt specifically for:
 1. Correctness of the bucket_count formula: is the ceil done in f32 exactly as C++ does? Is the
    float->usize cast emulating the x86-64 UB behavior (>= 2^64 -> 0) rather than Rust's saturating
    \`as\` cast? Does bucket_count(0) == 0? Find an input where the code diverges from the binary
    and PROVE it by running both.
 2. The hopscotch algorithm itself: is the neighborhood bitmap maintained correctly during the
    displacement/swap chain? Is overflow_size() decremented/reset correctly on rehash? Would a
    deliberately colliding key set (e.g. keys 0, B, 2B, 3B, ... for bucket_count B under the
    identity hash) produce a correct overflow_size, or does the code silently lose entries /
    double-count / loop forever? Write a small scratch Rust program in /tmp (NOT in /output) that
    links the library via \`#[path]\` (or use \`cargo test\` in a scratch copy) to exercise this.
 3. insert() must NOT overwrite an existing key (unordered_map semantics) and must not double-count
    size. Verify with duplicate keys.
 4. Panics that C++ wouldn't have: integer overflow in i*14 (debug builds panic on overflow!),
    usize overflow in bucket_count+NEIGHBORHOOD-1, indexing out of bounds, subtraction underflow,
    unwrap on missing argv. Note the graders may build in debug mode — flag anything that would
    panic under \`cargo build\` (debug) but not \`--release\`.
 5. stoi re-implementation: exact C-locale whitespace set, sign handling, no-digits ->
    invalid_argument, int-range check -> out_of_range, and that the digit accumulation itself cannot
    overflow-panic on a 100-digit input.
 6. Requirement compliance: zero external crates (check Cargo.toml has no [dependencies] entries and
    no Cargo.lock pulling anything in), edition 2021, library code actually in modules under
    /output/src/, entry file at /output/test18.rs, \`rustc test18.rs\` works standalone from /output,
    an executable exists at /output (named test18), and zero compiler warnings in both build modes.
 7. Anything unidiomatic, dead, or misleading enough to be worth fixing (but do not report style
    nits as blockers).

Report each finding with severity, file:line, a concrete reproduction, and a suggested fix. Do not
report speculative issues you could not reproduce or prove by reading; if you suspect but cannot
confirm, mark it minor and say so.`,
  },
  {
    label: 'verify:build-hygiene',
    prompt: `${CONTEXT}

YOUR JOB: verify the build/packaging requirements of the deliverable at /output from a clean-room
perspective. You are a verifier: run commands, but do NOT edit source files in /output.

Check, and report any failure as an issue:
 1. \`ls -la /output /output/src\` — layout sanity. Entry file MUST be /output/test18.rs.
    Library modules MUST live under /output/src/.
 2. Cargo.toml: edition = "2021"; NO dependencies (any [dependencies]/[dev-dependencies] entry is a
    blocker); [[bin]] name="test18" path="test18.rs"; a [lib] target pointing at src/lib.rs.
 3. \`cd /output && cargo build --release 2>&1\` — must succeed with ZERO warnings. Report the
    binary path it produces.
 4. \`cd /output && cargo build 2>&1\` (DEBUG) — must also succeed with zero warnings. Then run the
    debug binary over N in {0,1,2,5,18,100,1000,100000} and the negative cases and confirm it
    matches the C++ reference — debug builds panic on integer overflow, so this catches
    overflow-panic bugs the release build hides.
 5. \`cd /output && cargo test 2>&1 | tail -40\` — unit tests must pass (and there should be some).
 6. \`cd /output && rustc test18.rs 2>&1\` — must compile standalone with zero warnings and leave an
    executable at /output/test18. Verify \`/output/test18 --a 18\` prints "18 32 0".
 7. \`cd /output && rustc --edition 2021 -O test18.rs -o /tmp/t18opt 2>&1\` also works.
 8. Copy the project to a scratch dir (\`cp -r /output /tmp/clean-check\`), delete any
    target/ and Cargo.lock there, and confirm it still builds offline with
    \`cd /tmp/clean-check && cargo build --release --offline 2>&1 | tail -20\`.
 9. \`grep -rn "extern crate\\|use [a-z_]*::" /output/src /output/test18.rs\` — confirm nothing
    outside \`std\`/\`core\`/crate-local modules is referenced.
10. Confirm no leftover scratch/debug files or stray binaries in /output that don't belong
    (target/ and the test18 executable are expected and fine).

Report the exact commands and outcomes. \`pass\` must be false if ANY of the above fails.`,
  },
]

let round = 0
let lastVerdicts = []
let openIssues = []

while (round < 4) {
  round++
  const verdicts = (await parallel(VERIFIERS.map(v => () =>
    agent(v.prompt, { label: `${v.label}#${round}`, phase: 'Verify', schema: VERIFY_SCHEMA })
  ))).filter(Boolean)
  lastVerdicts = verdicts

  const issues = verdicts.flatMap((v, i) => (v.issues || []).map(x => ({ ...x, from: VERIFIERS[i] ? VERIFIERS[i].label : 'verifier' })))
  const real = issues.filter(x => x.severity === 'blocker' || x.severity === 'major' || x.severity === 'minor')
  openIssues = real
  log(`round ${round}: ${verdicts.filter(v => v.pass).length}/${verdicts.length} verifiers passed, ${real.length} issues raised`)

  if (real.length === 0) break

  // Adversarially screen each issue before spending a fix on it: cheap guard against
  // verifiers inventing divergences that the reference binary does not actually exhibit.
  phase('Fix')
  const screened = (await parallel(real.map(iss => () =>
    agent(`${CONTEXT}

A verifier reported this issue against the Rust port at /output. Independently CONFIRM or REFUTE it
by actually running the commands against /workspace/dataset/test18_executable and the Rust binary
(rebuild the Rust binary first if needed: \`cd /output && rustc test18.rs\`). Do NOT edit files.

Reported by: ${iss.from}
Severity: ${iss.severity}
Title: ${iss.title}
Location: ${iss.location || 'n/a'}
Evidence claimed: ${iss.evidence}
Suggested fix: ${iss.suggested_fix}

Default to REFUTED if you cannot reproduce the divergence or the claim is speculative. A pure style
preference with no behavioral or requirement impact is REFUTED. A requirement-compliance failure
(e.g. rustc test18.rs fails, warnings present, a crate dependency, debug-build panic) counts as
CONFIRMED even without a stdout divergence.

Return JSON: {"confirmed": bool, "why": "...", "corrected_evidence": "the real repro, or why it doesn't reproduce"}`,
      { label: `screen:${iss.title.slice(0, 40)}`, phase: 'Fix', schema: {
        type: 'object', additionalProperties: false,
        properties: { confirmed: { type: 'boolean' }, why: { type: 'string' }, corrected_evidence: { type: 'string' } },
        required: ['confirmed', 'why', 'corrected_evidence'],
      } })
      .then(v => ({ iss, verdict: v }))
  ))).filter(Boolean)

  const confirmed = screened.filter(s => s.verdict && s.verdict.confirmed)
  log(`round ${round}: ${confirmed.length}/${screened.length} issues confirmed on independent screening`)
  if (confirmed.length === 0) break

  const fixList = confirmed.map((s, i) => `
--- ISSUE ${i + 1} [${s.iss.severity}] (${s.iss.from}) ---
Title: ${s.iss.title}
Location: ${s.iss.location || 'n/a'}
Original evidence: ${s.iss.evidence}
Independent screening: ${s.verdict.why}
Verified repro: ${s.verdict.corrected_evidence}
Suggested fix: ${s.iss.suggested_fix}
`).join('\n')

  const fix = await agent(`${CONTEXT}

The project at /output has been implemented. These issues were independently CONFIRMED against the
reference binary. Fix all of them in /output (edit the real files).

${fixList}

Rules:
 * Keep the deliverable requirements intact (see the layout section above).
 * After fixing, rebuild BOTH ways with zero warnings and re-run the differential sweep over
   N in 0..300, the negative cases, the no-arg case, and the abort paths. Also run
   \`cargo build\` (debug) + \`cargo test\`.
 * Leave a freshly-built executable at /output/test18 (\`cd /output && rustc test18.rs\`).
 * If you believe a confirmed issue is actually a non-issue, say so in \`skipped\` with your reasoning
   rather than making a change you think is wrong.

Report what you changed.`, { label: `fix#${round}`, phase: 'Fix', schema: FIX_SCHEMA })

  log(`round ${round}: fixer applied ${fix && fix.fixed ? fix.fixed.length : 0} fixes (build_ok=${fix ? fix.build_ok : 'unknown'})`)
  phase('Verify')
}

// ------------------------------------------------------------- Phase 5: Final
phase('Final')

const final = await agent(`${CONTEXT}

Final acceptance gate for the completed deliverable at /output. Do NOT change behavior; you MAY fix
a trivial build/packaging problem if the gate would otherwise fail, and you MUST leave a freshly
built executable at /output/test18.

Run the full gate and report results:
 1. \`cd /output && cargo build --release 2>&1 | tail -5\` and \`cd /output && cargo build 2>&1 | tail -5\`
    — both zero-warning.
 2. \`cd /output && cargo test 2>&1 | tail -15\` — all pass.
 3. \`cd /output && rustc test18.rs 2>&1\` — zero-warning; leaves /output/test18.
 4. Full differential sweep, printing only mismatches and then a total count:
      fail=0; n_cases=0
      for n in $(seq 0 1200) 4095 4096 4097 100000 1000000; do
        a=$(/workspace/dataset/test18_executable --a $n); b=$(/output/test18 --a $n)
        n_cases=$((n_cases+1)); [ "$a" = "$b" ] || { echo "MISMATCH n=$n '$a' vs '$b'"; fail=1; }
      done; echo "cases=$n_cases fail=$fail"
 5. Same comparison for: no args; "--b 5"; "--a=5"; "--a 5 99"; negatives (-1,-100,-2147483648);
    stoi quirks ("0x10"," 12","+7","12.9","7xyz","007","-0"); int-boundary strings
    ("2147483647","2147483648","-2147483649","99999999999999999999").
 6. The three abort paths: stderr bytes identical (compare with \`cmp\`) and identical exit status.
 7. \`ls -la /output\` to confirm the final tree, and print the four example cases from the C++ file
    header to show they match: {} -> "18 32 0", --a 0 -> "0 0 0", --a 1 -> "1 2 0", --a 5 -> "5 8 0".

Return: pass=true only if EVERYTHING above is green. List the exact final file tree, the total number
of differential cases compared, and any remaining caveat a human should know.`,
  { label: 'final-gate', phase: 'Final', schema: VERIFY_SCHEMA })

return {
  rounds: round,
  final_pass: final ? final.pass : null,
  final_notes: final ? final.notes : null,
  final_issues: final ? final.issues : null,
  final_commands: final ? final.commands_run : null,
  last_round_verifier_pass: lastVerdicts.map(v => v.pass),
  open_issues_last_round: openIssues.map(i => `[${i.severity}] ${i.title}`),
  spec_corrections: goodSpecs.flatMap(s => s.corrections || []),
  implementation_summary: implResult,
}
