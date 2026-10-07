export const meta = {
  name: 'cpp-immer-to-rust-test14',
  description: 'Port immer-based C++ test14 to dependency-free Rust: recon, dual build, judge, assemble, adversarial verify, fix',
  phases: [
    { title: 'Recon', detail: 'independently falsify the reverse-engineered immer/stoi model against the reference binary' },
    { title: 'Build', detail: 'two independent Rust implementations of the persistent vector + transient' },
    { title: 'Judge', detail: 'three lenses score both candidates and pick a base' },
    { title: 'Assemble', detail: 'install winner into /output, graft best ideas, build both ways' },
    { title: 'Verify', detail: 'differential fuzz + adversarial review + requirements audit + completeness critic' },
    { title: 'Fix', detail: 'apply confirmed findings and re-verify byte-exactness' },
  ],
}

const SPEC = `
=== MIGRATION SPEC (established by 715 differential test cases against the reference binary, 0 mismatches) ===

SOURCE: /workspace/dataset/test14.cpp  (C++17, uses immer::vector<int> + immer::vector_transient)
REFERENCE BINARY: /workspace/dataset/test14_executable  (run it freely to check behaviour)
DO NOT read or fetch immer library sources (they are not present). This is a black-box port. No network.

The C++ program, in full:
    int n = (argc > 1) ? std::stoi(argv[1]) : 14;
    auto v = immer::vector<int>{};
    for (int i = 0; i < n; ++i) v = v.push_back(i);
    auto t = v.transient();
    t.set(n/2, n*10);
    t.push_back(n*20);
    t.push_back(n*30);
    auto v2 = t.persistent();
    std::cout << v.size() << " " << v2.size() << std::endl;
    std::cout << v2[n/2] << std::endl;
    for (int i = v2.size() - 3; i < v2.size(); ++i) std::cout << v2[i] << " ";
    std::cout << std::endl;
    return 0;

--- A. Inferred immer::vector<int> structure (confirmed empirically) ---
* Bit-partitioned vector trie (RRB / Clojure-PersistentVector style) with a tail buffer.
* INNER node branching factor 32 (B = 5 bits per level).
* LEAF branching factor 64 for int (BL = 6 bits). immer derives leaf bits from sizeof(T) so a leaf
  holds more small elements; for 4-byte int the leaf holds 64 elements. This was proven by the
  out-of-range behaviour in section C: masks are & 63, not & 31.
* tail_offset = if size == 0 { 0 } else { ((size - 1) >> 6) << 6 }
* Element access is UNCHECKED (immer asserts only in debug builds):
      if index >= tail_offset  -> tail_leaf[index & 63]
      else                     -> descend the trie: at shift s (s starts at the root shift and
                                  decreases by 5 per inner level) use (index >> s) & 31, and at the
                                  leaf use index & 63.
* Persistence: push_back on a persistent vector never mutates; it copies the tail leaf (and the
  spine when the tail is full). The transient may mutate nodes it uniquely owns.

--- B. Arithmetic / conversion semantics ---
* int == i32 with gcc's wrap-on-overflow. n*10, n*20, n*30 MUST use i32 wrapping_mul
  (verified: n=214748365 prints -2147483646 for n*10; n=100000000 prints -1294967296 for n*30).
* n/2 is truncating division (Rust i32 / already truncates toward zero: -3/2 == -1).
* int -> size_t conversions sign-extend: in Rust '(n/2) as usize' on a negative i32 yields a huge
  usize. That is exactly what C++ does when passing a negative int to set()/operator[].
* The final loop must be transliterated exactly:
      let size = v2.size();                              // usize
      let mut i: i32 = size.wrapping_sub(3) as i32;       // size_t subtraction, then truncate to int
      while (i as usize) < size {                        // int is converted to size_t (sign-extended)
          print!("{} ", v2[i as usize]);
          i = i.wrapping_add(1);
      }
      println!();
  For n <= 0, size == 2 so start == -1, (-1 as usize) is huge, the body never runs and line 3 is empty.
* MUST NOT PANIC IN DEBUG BUILDS. Plain 'rustc test14.rs' (no -O) enables debug_assertions and
  overflow checks, and 'cargo build' (dev profile) does too. Use wrapping_* / masked arithmetic
  everywhere so debug and release builds produce byte-identical output. Never index out of bounds.

--- C. Out-of-range set/get for n <= 0 (must be reproduced) ---
For n <= 0 the vector is empty, so t.set(n/2, n*10) is an out-of-range write and v2[n/2] may be an
out-of-range read. Implementing the unchecked masked arithmetic of section A reproduces the
reference binary EXACTLY, with no special cases and no unsafe code:
    empty transient: size = 0, tail_offset = 0, tail leaf = 64 zero-initialised slots
    set(idx, val)   -> tail[idx & 63] = val
    push_back(n*20) -> tail[0] = n*20, size = 1
    push_back(n*30) -> tail[1] = n*30, size = 2
    get(idx)        -> tail[idx & 63]
  => printed value is n*20 when (idx & 63) == 0, n*30 when == 1, else n*10.
Verified for every n in -200..=0 plus -300,-333,-383..-385,-447..-449,-511..-513,-1000,-1023..-1025,
-12345,-65536,-100000,-1048576,-214748364,-300000000,-1000000000,-2147483647,-2147483648.
So: the transient's tail leaf must be a real 64-slot buffer whose unused slots are default-valued,
set()/get() must mask instead of bounds-checking, and push_back must reuse the existing tail leaf
contents (i.e. copy the whole leaf, keeping slots beyond the logical size).

--- D. Output format (byte exact) ---
line 1: "{v.size()} {v2.size()}\\n"        sizes are usize printed as unsigned decimal
line 2: "{v2[(n/2) as usize]}\\n"          i32
line 3: for each of the last three indices "{value} " (note trailing space), then "\\n"
Examples (exact bytes):
    n=0   -> "0 2\\n0\\n\\n"
    n=1   -> "1 3\\n10\\n10 20 30 \\n"
    n=2   -> "2 4\\n20\\n20 40 60 \\n"
    n=3   -> "3 5\\n30\\n2 60 90 \\n"
    n=14  -> "14 16\\n140\\n13 280 420 \\n"   (the default when no argument is given)
    n=-1  -> "0 2\\n-20\\n\\n"
    n=-3  -> "0 2\\n-30\\n\\n"

--- E. Command line / std::stoi emulation ---
Only argv[1] is consulted; extra arguments are ignored; with no argument n defaults to 14.
Emulate std::stoi(argv[1]) with base 10:
  * skip leading whitespace: ' ' '\\t' '\\n' '\\v' '\\f' '\\r'
  * optional single '+' or '-'
  * then one or more ASCII digits; parsing stops at the first non-digit
        "  7  "->7   "12abc"->12   "3.9"->3   "0x10"->0   "007"->7   "1e3"->1   "2_0"->2   "+9"->9
  * no digits at all -> std::invalid_argument:  "" " " "abc" "-" "+" ".5" "--5" " + 9" and full-width digits
  * digits present but the value does not fit in int -> std::out_of_range:
        "2147483648" "-2147483649" "3000000000" "99999999999999999999" "9223372036854775808"
    (note "-2147483648" and "2147483647" are IN range)
  * accumulate in i64/u64/u128 style so huge digit strings are detected as out_of_range, never panic
On an uncaught exception the C++ program writes NOTHING to stdout and these EXACT bytes to stderr:
    "terminate called after throwing an instance of 'std::invalid_argument'\\n  what():  stoi\\n"
    "terminate called after throwing an instance of 'std::out_of_range'\\n  what():  stoi\\n"
  (two spaces before 'what()', two spaces after the colon) and dies from SIGABRT, so the shell
  reports exit status 134. Reproduce with eprint! of those exact bytes followed by
  std::process::abort(). Nothing may be written to stdout in that case.

--- F. Deliverable requirements (all mandatory) ---
1. Pure Rust, edition 2021, std only, ZERO external crates. Installed toolchain is rustc/cargo 1.75.0
   - do not use APIs newer than 1.75. Cargo must work offline (pass --offline).
2. A complete Cargo project rooted at /output:
     /output/Cargo.toml      package name test14 (or similar), edition 2021, no [dependencies],
                             [[bin]] name = "test14", path = "test14.rs"
     /output/test14.rs       THE ENTRY FILE, in the package root, containing fn main()
     /output/src/...         library code split into modules
   Both build paths must work and yield byte-identical behaviour:
     (a) cd /output && rustc -O test14.rs -o test14        <-- entry file must be self-sufficient, so
         declare modules from it, e.g.  #[path = "src/immer/mod.rs"] mod immer;
     (b) cd /output && cargo build --release --offline      -> target/release/test14
   Also make sure 'cargo build --offline' (dev profile, overflow checks on) works and behaves the same.
   A /output/src/lib.rs library target is welcome so 'cargo test --offline' runs the unit tests.
   Keep the build warning-free (an explicit #![allow(dead_code)] for the public-API-but-unused
   functions in the binary crate is fine).
3. Library code organised into modules, e.g.
     src/immer/mod.rs        module docs + re-exports
     src/immer/node.rs       trie node (leaf of BL-sized Vec<T>, inner of Vec<Rc<Node<T>>>), Rc sharing
     src/immer/vector.rs     Vector<T>: push_back, set, get/Index, size, iter, transient()
     src/immer/transient.rs  TransientVector<T>: push_back, set, get, size, persistent()
     src/cpp/mod.rs + src/cpp/stoi.rs   std::stoi emulation + the terminate/abort behaviour
   Generic over T (Clone + Default, or similar); do not hardcode i32 in the data structure.
   Structural sharing via std::rc::Rc. Transient in-place mutation via Rc::get_mut / Rc::make_mut -
   the idiomatic Rust equivalent of immer's edit-token ownership: nodes still shared with the
   persistent vector are copied on write, nodes uniquely owned by the transient are mutated in place.
   Persistence must hold: after t.set(...)/t.push_back(...), the original vector v is unchanged
   (same size AND same elements). Cover that with unit tests.
4. Performance: the loop 'for i in 0..n { v = v.push_back(i) }' must stay near-linear. Reference
   timings: n=1e6 ~27ms, n=2e6 ~56ms, n=2e7 ~512ms (C++). The release Rust build must handle
   n=2e7 in a few seconds at most. Absolutely no O(n) copy per push_back (do not clone a flat Vec).
5. Unit tests (#[cfg(test)]) covering: push_back/get across leaf and inner boundaries (63,64,65,
   2047,2048,2049,4095,4096,4097), persistence after transient mutation, transient set/push_back,
   persistent()/transient() round-trips, stoi accept/reject/out-of-range table, and the exact
   expected stdout for n = 0,1,2,3,4,14.

--- G. Test tooling available to you ---
* /tmp/harness/difftest.sh <rust_binary> [cases_file]   - byte-compares stdout, stderr and exit
  status against the reference binary over a corpus. Default corpus /tmp/harness/cases_quick.txt
  (490 cases: n = 0..400, structural boundaries, negatives, stoi edge cases, no-arg, multi-arg;
  ~13 s). /tmp/harness/cases_heavy.txt holds 5 large-n cases (~20 s). Prints
  "TOTAL=<n> MISMATCHES=<m>" and "RESULT: PASS|FAIL" and exits non-zero on any mismatch.
  You may add your own case files (one bash-quoted arg list per line, or the literal word NOARG).
* NEVER test n = 2147483647 or similar - the reference binary needs many minutes and ~8 GB there.
* python3 is NOT installed. Use bash arithmetic, the reference binary, or a scratch Rust program.
* /tmp/golden/positive.txt holds reference output for n = 0..300 and boundary/overflow values.
`

// ---------------- Phase 1: Recon (adversarial verification of the spec itself) ----------------
phase('Recon')

const RECON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['modelHolds', 'confirmations', 'contradictions', 'newFacts'],
  properties: {
    modelHolds: { type: 'boolean', description: 'true if you could not falsify the spec claims you tested' },
    confirmations: { type: 'array', items: { type: 'string' } },
    contradictions: { type: 'array', items: { type: 'string' }, description: 'concrete args where the spec predicts the wrong bytes' },
    newFacts: { type: 'array', items: { type: 'string' }, description: 'behaviours the spec does not yet capture' },
  },
}

const RECON_LENSES = [
  {
    key: 'structure',
    task: `Try hard to FALSIFY section A and C of the spec (leaf branching 64, inner 32, unchecked masked access, and the n<=0 out-of-range rule).
Method: for many n <= 0, compute the spec's prediction yourself with bash arithmetic (k = n/2 truncating; slot = ((k % 64) + 64) % 64; expected = n*20 if slot==0 else n*30 if slot==1 else n*10, all wrapped to i32) and compare to the reference binary's second output line. Cover at least 400 distinct values of n including n around multiples and near-multiples of 64 and 128 (e.g. -126..-130, -190..-194, -254..-258), powers of two, and very large magnitudes. Also confirm line 1 is always "0 2" and line 3 is always empty for n <= 0.
Then check the positive side: for n = 1..2000 confirm the reference's line 2 is always n*10 (wrapped) and line 3 is the three values you would predict from a plain array simulation ([0..n) with index n/2 overwritten by n*10, then n*20 and n*30 appended). Report any n where a plain array simulation does NOT match the reference - that would mean the trie/tail emulation matters for in-range indices too.`,
  },
  {
    key: 'stoi',
    task: `Try hard to FALSIFY section E of the spec (std::stoi emulation and the abort behaviour).
Probe the reference binary with at least 60 distinct argv[1] values: empty, only whitespace, every whitespace character (space tab newline vertical-tab form-feed carriage-return) alone and as a prefix, signs alone and doubled, sign followed by whitespace, leading zeros, embedded underscores/dots/exponents, hex and octal-looking input, thousands separators, unicode digits, very long digit strings (50+ digits), exactly INT_MIN and INT_MAX and each +/-1, values between INT_MAX and LONG_MAX, values above LONG_MAX, strings with trailing junk, and a multi-arg invocation.
For each, record exact stdout bytes, exact stderr bytes and exit status (use od -c when bytes are subtle). Confirm the two exact stderr messages and exit status 134, and that stdout is empty on abort. Report anything the spec gets wrong. Keep each invocation cheap - use small n values; never use an argument whose numeric value exceeds a few hundred thousand.`,
  },
  {
    key: 'boundaries',
    task: `Try hard to find any n >= 0 where the spec's output rules break, focusing on structural boundaries and overflow.
Check the reference binary at n = 0..64, 63..66, 126..130, 2046..2050, 4094..4098, 32766..32770, 65534..65538, 131070..131074, 262142..262146, 2097150..2097154 (leaf 64 and inner 32 boundaries: 64, 2048, 65536, 2097152) and at overflow thresholds where n*10, n*20 or n*30 crosses i32 range: around 71582788, 107374182, 143165576, 214748364 (only run values up to ~2.2e8, and only a handful of those since each takes seconds).
For each, verify line 1 == "n n+2", line 2 == wrapped n*10, and line 3 == the three trailing values predicted by a plain array simulation (careful for n=1 and n=2 where n/2 falls inside the last three). Report exact mismatches if any. Also record wall-clock timings for the largest values so we know the Rust port's performance target.`,
  },
]

const recon = await parallel(RECON_LENSES.map((l, idx) => () =>
  agent(`You are recon agent ${idx + 1} of 3 on a C++-to-Rust migration. Your job is NOT to write the port; it is to adversarially validate the reverse-engineered behavioural spec below by experiment against the reference binary. Assume the spec may be wrong; try to break it. Be exhaustive and report concrete argument values, not impressions.

${l.task}

${SPEC}`, { label: `recon:${l.key}`, phase: 'Recon', schema: RECON_SCHEMA })
))

const reconOk = recon.filter(Boolean)
const contradictions = reconOk.flatMap(r => r.contradictions || [])
const newFacts = reconOk.flatMap(r => r.newFacts || [])
log(`Recon: ${reconOk.length}/3 reported, ${contradictions.length} contradictions, ${newFacts.length} new facts`)

const RECON_NOTES = contradictions.length || newFacts.length
  ? `\n=== RECON FINDINGS (from independent adversarial validation of the spec) ===\nCONTRADICTIONS (spec may be wrong here - trust the reference binary, not the spec):\n${contradictions.map(c => '  - ' + c).join('\n') || '  (none)'}\nADDITIONAL FACTS:\n${newFacts.map(c => '  - ' + c).join('\n') || '  (none)'}\n`
  : '\n=== RECON FINDINGS: three independent agents failed to falsify the spec. Treat it as reliable. ===\n'

// ---------------- Phase 2: Build two independent candidates ----------------
phase('Build')

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'files', 'rustcOk', 'cargoReleaseOk', 'cargoDevOk', 'cargoTestOk', 'quickMismatches', 'heavyMismatches', 'perf', 'design', 'knownIssues'],
  properties: {
    dir: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    rustcOk: { type: 'boolean' },
    cargoReleaseOk: { type: 'boolean' },
    cargoDevOk: { type: 'boolean' },
    cargoTestOk: { type: 'boolean' },
    quickMismatches: { type: 'integer', description: 'mismatches on cases_quick.txt' },
    heavyMismatches: { type: 'integer', description: 'mismatches on cases_heavy.txt' },
    perf: { type: 'string', description: 'measured release timings, e.g. n=2e7 -> 1.4s' },
    design: { type: 'string', description: 'how the trie, tail, transient ownership and stoi are implemented' },
    knownIssues: { type: 'array', items: { type: 'string' } },
  },
}

const CANDIDATES = [
  { key: 'A', dir: '/tmp/candA', slant: 'Favour a clean, textbook bit-partitioned trie: an enum Node with Leaf(Vec<T>) and Inner(Vec<Rc<Node<T>>>), an explicit root shift, and a separate tail leaf. Optimise for readability and obviously-correct index arithmetic.' },
  { key: 'B', dir: '/tmp/candB', slant: 'Favour a structure that mirrors immer more literally: B/BL bit parameters as associated consts with BL derived from size_of::<T>() the way immer derives leaf bits (so it is 6 for i32), and an explicit ownership/edit-token concept for the transient implemented via Rc uniqueness. Optimise for fidelity to the original library design.' },
]

const builds = await parallel(CANDIDATES.map(c => () =>
  agent(`You are implementing candidate ${c.key} of a C++-to-Rust migration. Work ONLY inside ${c.dir} (create it; do not touch /output or the other candidate's directory).

Build the complete Cargo project described in the spec, laid out exactly as required in section F but rooted at ${c.dir} instead of /output (same file names and relative paths, so it can be copied to /output verbatim later).

Design slant for your candidate: ${c.slant}

Process you must follow:
1. Read /workspace/dataset/test14.cpp. Do not look for immer sources; they do not exist here.
2. Write the modules, the entry file ${c.dir}/test14.rs, and Cargo.toml.
3. Build all three ways and fix every warning:
     cd ${c.dir} && rustc -O test14.rs -o test14
     cd ${c.dir} && cargo build --release --offline
     cd ${c.dir} && cargo build --offline            (dev profile: overflow checks ON - must not panic)
4. Run cargo test --offline and make the unit tests meaningful (section F.5).
5. Differential-test ALL THREE binaries (rustc -O build, cargo release build, and cargo DEV build) with
     /tmp/harness/difftest.sh <binary>
     /tmp/harness/difftest.sh <binary> /tmp/harness/cases_heavy.txt
   Iterate until MISMATCHES=0 everywhere. Also verify the dev-profile binary's output is identical to
   the release one for n = 0, 1, 2, 3, 4, 14, -1, -3, -64, -128 and for an overflowing n like 214748365.
6. Measure release timings for n = 1e6, 2e6, 2e7 and report them.
7. Do not stop while any mismatch, test failure, warning or panic remains. Report honestly in your
   structured result; do not claim a check passed if you did not run it.

${SPEC}
${RECON_NOTES}`, { label: `build:${c.key}`, phase: 'Build', schema: BUILD_SCHEMA })
))

const buildOk = builds.filter(Boolean)
log(`Build: ${buildOk.length}/2 candidates completed; quick mismatches A/B = ${builds.map(b => b ? b.quickMismatches : 'ERR').join(' / ')}`)

// ---------------- Phase 3: Judge panel ----------------
phase('Judge')

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['winner', 'scoreA', 'scoreB', 'reasoning', 'graftsFromLoser', 'mustFix'],
  properties: {
    winner: { type: 'string', enum: ['A', 'B'] },
    scoreA: { type: 'number' },
    scoreB: { type: 'number' },
    reasoning: { type: 'string' },
    graftsFromLoser: { type: 'array', items: { type: 'string' }, description: 'specific ideas worth copying from the losing candidate' },
    mustFix: { type: 'array', items: { type: 'string' }, description: 'defects in the winner that must be fixed before shipping' },
  },
}

const JUDGE_LENSES = [
  { key: 'exactness', focus: 'Byte-exactness and robustness. Re-run difftest.sh yourself on both candidates (quick AND heavy corpora, and on the dev-profile binary too). Hunt for inputs where either candidate diverges or panics: n<=0, huge negatives, overflow n, stoi edge cases, no-arg, multi-arg. Build a corpus of your own with at least 80 extra cases. Score correctness above all else.' },
  { key: 'authenticity', focus: 'Fidelity of the data-structure port. Does it really implement a persistent bit-partitioned trie with structural sharing (not a cloned flat Vec)? Is the tail leaf a real 64-slot buffer? Are B=5/BL=6 handled the way the spec describes and generic over T? Does the transient mutate uniquely-owned nodes in place and copy shared ones, leaving the persistent vector untouched? Verify persistence empirically with a scratch test, and check push_back complexity by timing n=1e6 vs n=1e7 (should be ~linear, not quadratic). Also check memory sanity.' },
  { key: 'craft', focus: 'Requirements compliance and code craft. Check every item of spec section F: edition 2021, zero dependencies, no APIs newer than rustc 1.75, both build paths from a CLEAN checkout (delete target/ and the compiled binary, then rebuild), entry file at the package root, module organisation, unit-test quality and honesty, warning-free build, absence of unsafe, comment/doc quality, and dead-code hygiene. Penalise anything that only works by accident (e.g. a hardcoded special case for n<=0 instead of the masked arithmetic falling out of the structure).' },
]

const judges = await parallel(JUDGE_LENSES.map((j, idx) => () =>
  agent(`You are judge ${idx + 1} of 3 comparing two independent Rust ports of the same C++ program. Candidate A is in /tmp/candA, candidate B is in /tmp/candB. Read the code and RUN things - do not judge from reading alone.

Your lens: ${j.focus}

Score each candidate 0-100 on your lens, pick a winner, list concrete ideas worth grafting from the loser, and list defects in the winner that must be fixed. Be specific: file, function, and the failing input or command. If a candidate is missing or does not build, say so and score it accordingly.

${SPEC}
${RECON_NOTES}`, { label: `judge:${j.key}`, phase: 'Judge', schema: JUDGE_SCHEMA })
))

const judgeOk = judges.filter(Boolean)
const votesA = judgeOk.filter(j => j.winner === 'A').length
const votesB = judgeOk.filter(j => j.winner === 'B').length
const sumA = judgeOk.reduce((s, j) => s + (j.scoreA || 0), 0)
const sumB = judgeOk.reduce((s, j) => s + (j.scoreB || 0), 0)
const winner = votesA === votesB ? (sumA >= sumB ? 'A' : 'B') : (votesA > votesB ? 'A' : 'B')
const winnerDir = winner === 'A' ? '/tmp/candA' : '/tmp/candB'
const loserDir = winner === 'A' ? '/tmp/candB' : '/tmp/candA'
const grafts = judgeOk.flatMap(j => j.graftsFromLoser || [])
const mustFix = judgeOk.flatMap(j => j.mustFix || [])
log(`Judge: winner=${winner} (votes ${votesA}-${votesB}, scores ${sumA}-${sumB}); ${grafts.length} grafts, ${mustFix.length} must-fix items`)

// ---------------- Phase 4: Assemble into /output ----------------
phase('Assemble')

const ASSEMBLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'files', 'rustcOk', 'cargoReleaseOk', 'cargoDevOk', 'cargoTestOk', 'quickMismatches', 'heavyMismatches', 'binaries', 'summary'],
  properties: {
    ok: { type: 'boolean' },
    files: { type: 'array', items: { type: 'string' } },
    rustcOk: { type: 'boolean' },
    cargoReleaseOk: { type: 'boolean' },
    cargoDevOk: { type: 'boolean' },
    cargoTestOk: { type: 'boolean' },
    quickMismatches: { type: 'integer' },
    heavyMismatches: { type: 'integer' },
    binaries: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const assembled = await agent(`Install the winning candidate as the final deliverable in /output.

The judge panel picked the candidate in ${winnerDir} (runner-up: ${loserDir}).

Steps:
1. Copy the winning project into /output preserving the required layout (/output/Cargo.toml,
   /output/test14.rs, /output/src/...). /output currently exists and is empty; it must end up as a
   self-contained Cargo project. Do not copy build artefacts (target/) from the candidate directory.
2. Apply these grafts from the runner-up where they are genuine improvements (skip any that would
   risk byte-exactness, and say which you skipped):
${(grafts.length ? grafts : ['(none)']).map(g => '   - ' + g).join('\n')}
3. Fix these defects the judges found in the winner:
${(mustFix.length ? mustFix : ['(none)']).map(g => '   - ' + g).join('\n')}
4. Rebuild everything from clean in /output and make sure all of this passes with zero warnings:
     cd /output && rustc -O test14.rs -o test14
     cd /output && cargo build --release --offline
     cd /output && cargo build --offline
     cd /output && cargo test --offline
5. Differential-test /output/test14, /output/target/release/test14 AND /output/target/debug/test14:
     /tmp/harness/difftest.sh <bin>
     /tmp/harness/difftest.sh <bin> /tmp/harness/cases_heavy.txt
   All must report MISMATCHES=0. Iterate until they do.
6. Leave the rustc -O executable at /output/test14 (that exact path) and the cargo release binary at
   /output/target/release/test14. Add a short /output/README.md documenting the C++ to Rust mapping,
   both build commands, and the reverse-engineered immer behaviour (including the leaf-64 masking and
   the out-of-range rule for n <= 0).
7. Report honestly which checks you actually ran.

${SPEC}
${RECON_NOTES}`, { label: 'assemble', phase: 'Assemble', schema: ASSEMBLE_SCHEMA })

log(`Assemble: ok=${assembled ? assembled.ok : 'ERR'} quickMismatches=${assembled ? assembled.quickMismatches : '?'}`)

// ---------------- Phase 5: Verify (parallel adversarial lenses) ----------------
phase('Verify')

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'severity', 'detail', 'repro'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          detail: { type: 'string' },
          repro: { type: 'string', description: 'exact command or input that demonstrates the problem' },
        },
      },
    },
  },
}

const VERIFY_LENSES = [
  { key: 'fuzz', task: `Differential-fuzz /output against the reference binary far beyond the standard corpus. Build your own case files and run /tmp/harness/difftest.sh with them. Cover: every n in 0..3000; every n in -400..-1; n around 64/128/2048/4096/65536/2097152 boundaries; overflow-zone n (71582788, 71582789, 107374182, 107374183, 143165576, 214748364, 214748365) - a few of those only, each takes seconds; at least 120 stoi-shaped strings including pathological ones (50-digit numbers, "+-1", " 12 34", "9223372036854775807", "0000000000000000009"); the no-argument case; multi-argument cases; and an argument containing a newline. Use randomised values too (bash RANDOM). Test BOTH /output/test14 and /output/target/debug/test14 (overflow checks on). Report every divergence in stdout, stderr or exit status as a finding; if there are none, return an empty findings array.` },
  { key: 'review', task: `Adversarially code-review /output for defects that could make it diverge from the C++ program or panic, WITHOUT running the whole corpus (the fuzzer covers that). Read every Rust file. Look for: bounds checks or asserts that could panic instead of masking, non-wrapping arithmetic (+, *, - on i32/usize) that panics under debug_assertions, casts that do not match C++ integer conversion rules, an int/size_t comparison in the final loop that is not sign-extension-faithful, off-by-one in tail_offset or shift computation, tail leaf slots that are not preserved by push_back (breaking the n<=0 rule), any place where the transient could mutate a node still shared with the persistent vector (aliasing bug that would corrupt v), stack-overflow risk from recursive Drop of a deep trie for large n, quadratic behaviour, and any use of unsafe. For each finding give the file, line and a concrete triggering input.` },
  { key: 'compliance', task: `Audit /output against the seven stated deliverable requirements, from a clean state. Steps: list every file in /output; verify Cargo.toml (edition 2021, no [dependencies], [[bin]] name=test14 path=test14.rs, valid package name); verify the entry file is /output/test14.rs and contains fn main; verify library code is split into modules under src/; grep the whole tree for 'extern crate', non-std crate imports, 'unsafe', and any crates.io reference; confirm no registry access is needed by running 'rm -rf /output/target && cd /output && cargo build --release --offline' and 'cargo test --offline'; confirm 'rm -f /output/test14 && cd /output && rustc -O test14.rs -o test14' succeeds standalone and the resulting binary works; confirm both binaries exist afterwards at /output/test14 and /output/target/release/test14; check for compiler warnings in all builds; and check the package builds when copied elsewhere (cp -r /output /tmp/copycheck && cd /tmp/copycheck && cargo build --release --offline) so nothing depends on absolute paths. Report each violation as a finding.` },
  { key: 'critic', task: `Act as the completeness critic for this migration. Read /output's code, README and tests, then ask what is still unverified or missing, and go verify it yourself. Consider: is any behaviour of the C++ program unmodelled (argv handling, iostream formatting, ordering of stdout vs stderr, return code 0)? Are the unit tests actually asserting the right expected bytes, or are they tautological? Does 'cargo test --offline' really pass and cover leaf/inner boundaries and persistence? Is the documented reverse-engineered model consistent with the code that implements it? Would the port still be correct for a T other than i32 (write a scratch test using the library with String or u8 via the lib target)? Is there dead or duplicated code, or a module boundary that misleads? Report concrete gaps as findings, each with a repro or a specific file/line.` },
]

const verifyRaw = await pipeline(
  VERIFY_LENSES,
  l => agent(`You are verification agent "${l.key}" on the final deliverable in /output for a C++-to-Rust migration. Be adversarial and concrete. Only report a finding you can demonstrate.

${l.task}

${SPEC}
${RECON_NOTES}`, { label: `verify:${l.key}`, phase: 'Verify', schema: FINDINGS_SCHEMA }),
  (res, lens) => {
    const items = (res && res.findings) || []
    if (!items.length) return []
    return parallel(items.map(f => () =>
      agent(`Adversarially REFUTE this claimed defect in the Rust port at /output. Your default answer is refuted=true unless you can reproduce the problem yourself.

Claimed defect (from the "${lens.key}" lens):
  title: ${f.title}
  file: ${f.file}${f.line ? ':' + f.line : ''}
  severity: ${f.severity}
  detail: ${f.detail}
  repro: ${f.repro}

Run the repro. Read the code at that location. Decide: is this a real defect that affects the deliverable (byte-exact output, robustness, or a stated requirement), or is it a false alarm / stylistic noise? A divergence from the C++ reference binary on any input, or a panic, is always real. Be careful not to break /output while testing: do not edit files, only read and run.

${SPEC}`, { label: `refute:${lens.key}`, phase: 'Verify', schema: {
        type: 'object', additionalProperties: false,
        required: ['refuted', 'reason', 'severity'],
        properties: {
          refuted: { type: 'boolean' },
          reason: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
        },
      } }).then(v => ({ ...f, lens: lens.key, verdict: v }))
    ))
  }
)

const allFindings = verifyRaw.flat().filter(Boolean)
const confirmed = allFindings.filter(f => f.verdict && f.verdict.refuted === false)
log(`Verify: ${allFindings.length} candidate findings, ${confirmed.length} survived adversarial refutation`)

// ---------------- Phase 6: Fix and re-verify ----------------
phase('Fix')

let fixResult = null
if (confirmed.length) {
  fixResult = await agent(`Fix the confirmed defects in the Rust deliverable at /output. These findings each survived an independent adversarial refutation attempt:

${confirmed.map((f, i) => `${i + 1}. [${f.verdict.severity}] ${f.title}
   file: ${f.file}${f.line ? ':' + f.line : ''}
   detail: ${f.detail}
   repro: ${f.repro}
   refuter's assessment: ${f.verdict.reason}`).join('\n\n')}

Rules:
- Fix root causes, not symptoms. Never special-case an input to make a test pass; the masked trie
  arithmetic must produce the n<=0 behaviour naturally.
- Byte-exactness against /workspace/dataset/test14_executable is non-negotiable.
- If a finding is wrong or is a pure style preference, skip it and say why.
After fixing, rebuild from clean and re-run everything:
  rm -rf /output/target /output/test14
  cd /output && rustc -O test14.rs -o test14 && cargo build --release --offline && cargo build --offline && cargo test --offline
  /tmp/harness/difftest.sh /output/test14
  /tmp/harness/difftest.sh /output/test14 /tmp/harness/cases_heavy.txt
  /tmp/harness/difftest.sh /output/target/release/test14
  /tmp/harness/difftest.sh /output/target/debug/test14
All must be warning-free with MISMATCHES=0 and passing tests. Report exactly what you changed, what
you skipped and why, and the final verified state.

${SPEC}`, { label: 'fix', phase: 'Fix', schema: {
    type: 'object', additionalProperties: false,
    required: ['changed', 'skipped', 'allGreen', 'evidence'],
    properties: {
      changed: { type: 'array', items: { type: 'string' } },
      skipped: { type: 'array', items: { type: 'string' } },
      allGreen: { type: 'boolean' },
      evidence: { type: 'string' },
    },
  } })
} else {
  log('No confirmed findings - skipping fix phase')
}

return {
  recon: { modelHolds: reconOk.map(r => r.modelHolds), contradictions, newFacts },
  builds: builds.map((b, i) => b ? { cand: CANDIDATES[i].key, quick: b.quickMismatches, heavy: b.heavyMismatches, rustc: b.rustcOk, cargoRel: b.cargoReleaseOk, cargoDev: b.cargoDevOk, tests: b.cargoTestOk, perf: b.perf, issues: b.knownIssues } : { cand: CANDIDATES[i].key, error: true }),
  judge: { winner, votesA, votesB, sumA, sumB, grafts, mustFix, reasoning: judgeOk.map(j => j.reasoning) },
  assembled,
  findings: { total: allFindings.length, confirmed: confirmed.map(f => ({ lens: f.lens, title: f.title, file: f.file, severity: f.verdict.severity, detail: f.detail, repro: f.repro })) },
  fix: fixResult,
}
