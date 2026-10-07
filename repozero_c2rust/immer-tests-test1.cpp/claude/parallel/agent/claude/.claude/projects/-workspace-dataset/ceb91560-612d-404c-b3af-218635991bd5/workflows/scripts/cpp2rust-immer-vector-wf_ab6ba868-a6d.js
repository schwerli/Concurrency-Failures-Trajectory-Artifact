export const meta = {
  name: 'cpp2rust-immer-vector',
  description: 'Port immer::vector test1.cpp to dependency-free Rust; differential-test vs the C++ binary, judge, finalize into /output, adversarially verify and repair',
  phases: [
    { title: 'Recon',     detail: 'pin toolchain + remaining C++ ground truth' },
    { title: 'Implement', detail: '3 independent persistent-vector implementations in /tmp/candN' },
    { title: 'DiffTest',  detail: 'build each candidate and diff against the C++ binary' },
    { title: 'Judge',     detail: 'score candidates on 3 lenses' },
    { title: 'Finalize',  detail: 'assemble winner into /output and build' },
    { title: 'Verify',    detail: 'adversarial skeptics, distinct lenses' },
    { title: 'Repair',    detail: 'fix confirmed issues and re-verify' },
    { title: 'Critic',    detail: 'completeness critic' },
  ],
}

const SPEC = `
=== TASK ===
Port this C++ program to pure Rust (std only, ZERO external crates), re-implementing
immer::vector from scratch as a persistent (immutable, structurally-shared) vector.

--- /workspace/dataset/immer/tests/test1.cpp ---
#include <immer/vector.hpp>
#include <iostream>
#include <string>

int main(int argc, char* argv[]) {
    int n = (argc > 1) ? std::stoi(argv[1]) : 5;

    auto v = immer::vector<int>{};
    for (int i = 0; i < n; ++i) {
        v = v.push_back(i);
    }

    std::cout << v.size() << std::endl;

    return 0;
}
-------------------------------------------------

Reference C++ binary: /workspace/dataset/test1_executable  (run it to check ANY behavior)

=== BLACK-BOX RULE (hard) ===
Do NOT read any immer C++ library source or headers (e.g. /usr/include/immer/**,
/usr/local/include/immer/**, any vendored copy). Infer behavior from the interface above
and from running the reference binary. Reading test1.cpp itself is fine.

=== GROUND TRUTH already measured on the reference binary (do not re-derive, but you MAY re-verify) ===
* No argv[1]            -> n = 5,        stdout "5\\n",  exit 0
* "0"->"0\\n", "1"->"1\\n", "2"->"2\\n", "3"->"3\\n", "4"->"4\\n"  (the 5 published test cases)
* n <= 0 (e.g. "-1", "-100", "-2147483648") -> stdout "0\\n", exit 0
* Output = decimal size + "\\n" on stdout (std::endl). Nothing else on stdout. Exit code 0.
* argv beyond argv[1] is ignored:  "3 extra" -> "3\\n"

std::stoi(argv[1]) semantics, base 10, EXACTLY:
  1. skip leading whitespace: ' ' \\t \\n \\v \\f \\r
  2. optional single '+' or '-' IMMEDIATELY followed by digits (no space allowed after sign)
  3. one or more ASCII decimal digits [0-9]; parsing stops at the first non-digit
  4. trailing garbage is ignored:  "3abc"->3, "  +12xyz"->12, "12 34"->12, "1e3"->1,
     "1,000"->1, "0x10"->0, "007"->7, "\\t9"->9, "\\n7"->7, "  -0"->0
  5. NO digits found -> throws std::invalid_argument   (cases: "", " ", "abc", ".5", "+ 7", "-  7",
     non-ASCII digits like U+0663 "\\u0663")
  6. value outside [-2147483648, 2147483647] -> throws std::out_of_range
     ("2147483648", "-2147483649", "99999999999999999999" -> out_of_range;
      "2147483647" and "-2147483648" are OK)
  7. The exception is unhandled -> std::terminate -> SIGABRT.
     Exit status observed by the shell: 134.  stdout: EMPTY.
     stderr is EXACTLY these bytes (note the TWO spaces after "what():", and the trailing \\n):

terminate called after throwing an instance of 'std::invalid_argument'
  what():  stoi

     ...with 'std::out_of_range' substituted for the out-of-range case.

     Rust emulation: write that exact text to stderr, flush, then std::process::abort()
     (abort raises SIGABRT so the shell also reports 134). Nothing may reach stdout.

=== PERFORMANCE ground truth (reference binary) ===
  n=1,000,000    0.02 s
  n=10,000,000   0.25 s
  n=100,000,000  2.66 s
So push_back must be genuinely cheap: O(1) amortised, branching factor 32 trie with a tail
buffer. Do NOT implement anything that copies the whole vector per push (that is O(n^2)).
Target: n=10,000,000 must finish in a few seconds in release/-O builds.

=== REQUIRED DELIVERABLE SHAPE ===
Rust 2021 edition, Cargo project, and these hard requirements:
 R1. Zero external dependencies - std only. Cargo.toml has NO [dependencies] entries.
 R2. CLI identical: parse via std::env::args(); optional single positional arg; default 5.
 R3. Output byte-for-byte identical to std::cout (println!("{}", size)).
 R4. Library code organised into MODULES under src/ (not one giant file).
 R5. The entry file is  test1.rs  in the PACKAGE ROOT (next to Cargo.toml), NOT in src/.
     Cargo.toml must therefore declare:  [[bin]] name = "test1"  path = "test1.rs"
 R6. BOTH build paths must work from the package root:
        cargo build --release              -> target/release/test1
        rustc --edition 2021 -O test1.rs -o test1   -> ./test1
     For the plain-rustc path, test1.rs must pull the modules in with #[path] attributes, e.g.
        #[path = "src/immer/mod.rs"] mod immer;
     IMPORTANT: module files must therefore avoid \`crate::\` paths (they break when the same
     files are compiled both as part of a lib crate and via #[path] into a bin crate, and
     \`crate::\` is not valid in edition 2015). Use \`super::\`/\`self::\` relative paths ONLY.
     BONUS (do it if free): plain \`rustc test1.rs -o test1\` (edition 2015 default) also compiles.
 R7. The installed toolchain is rustc/cargo 1.75.0. No unstable features, no #![feature(...)].
     Cargo must work offline (no deps, so no network).

=== IMMER-FIDELITY REQUIREMENTS (this is a library port, not just a print statement) ===
The persistent vector must be a real immutable data structure with STRUCTURAL SHARING:
  * push_back(&self, value) -> Self          (self remains valid and unchanged afterwards)
  * new()/Default, len()/size(), is_empty()
  * get(i) -> Option<&T>, Index impl, update/set(i, v) -> Self, pop_back() -> Self (or Option)
  * Clone (cheap, O(1)), PartialEq/Eq, Debug, iteration (Iterator + IntoIterator + FromIterator)
  * O(log32 n) indexing, O(1) amortised push_back, no full copies
  * T: Clone bound is fine; nodes shared via Rc
  * #![forbid(unsafe_code)] or at minimum no unsafe unless justified
Include unit tests (#[cfg(test)]) covering persistence (old versions unchanged after push),
structural sharing, indexing across trie levels (n > 32, > 1024, > 32768), update, pop, iteration,
and the stoi parser table above.
`

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'summary', 'files', 'selfTest'],
  properties: {
    dir: { type: 'string' },
    summary: { type: 'string', description: 'design of the data structure in 3-6 sentences' },
    files: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['path', 'purpose'],
        properties: { path: { type: 'string' }, purpose: { type: 'string' } },
      },
    },
    selfTest: { type: 'string', description: 'what you built/ran and the observed results, incl. cargo test output summary' },
    knownGaps: { type: 'string' },
  },
}

const DIFF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'cargoBuilds', 'rustcBuilds', 'totalCases', 'passed', 'failed', 'failures', 'unitTests', 'perf'],
  properties: {
    dir: { type: 'string' },
    cargoBuilds: { type: 'boolean' },
    rustcBuilds: { type: 'boolean' },
    buildLog: { type: 'string', description: 'errors/warnings, truncated' },
    totalCases: { type: 'integer' },
    passed: { type: 'integer' },
    failed: { type: 'integer' },
    failures: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['argDesc', 'expected', 'actual'],
        properties: { argDesc: { type: 'string' }, expected: { type: 'string' }, actual: { type: 'string' } },
      },
    },
    unitTests: { type: 'string' },
    perf: { type: 'string', description: 'timing for n=1e6/1e7 vs the C++ binary' },
    fidelityNotes: { type: 'string' },
  },
}

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'ranking', 'winner', 'graftIdeas'],
  properties: {
    lens: { type: 'string' },
    ranking: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['dir', 'score', 'rationale'],
        properties: { dir: { type: 'string' }, score: { type: 'number' }, rationale: { type: 'string' } },
      },
    },
    winner: { type: 'string' },
    graftIdeas: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'clean', 'issues'],
  properties: {
    lens: { type: 'string' },
    clean: { type: 'boolean', description: 'true only if you could NOT find any real defect' },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'description', 'repro', 'suggestedFix'],
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          description: { type: 'string' },
          repro: { type: 'string', description: 'exact shell commands + observed vs expected' },
          suggestedFix: { type: 'string' },
        },
      },
    },
  },
}

// ---------------------------------------------------------------- Recon
phase('Recon')
const recon = await parallel([
  () => agent(`${SPEC}

RECON TASK (read-only, do not create the deliverable): verify the toolchain constraints and
report facts the implementers need.
 1. rustc --version; cargo --version; check what edition plain \`rustc foo.rs\` defaults to.
 2. In a scratch dir /tmp/recon_tc, prove out the exact project shape required by R5/R6:
    a Cargo.toml with [[bin]] name="test1" path="test1.rs" at the package root, a src/ module
    tree pulled in from test1.rs via #[path], and confirm BOTH \`cargo build --release\` (offline)
    and \`rustc --edition 2021 -O test1.rs -o test1\` succeed on a hello-world skeleton.
    Also test whether plain \`rustc test1.rs\` (edition 2015) works with the same #[path] layout,
    and whether \`cargo test\` runs. Report the EXACT Cargo.toml and test1.rs header that worked.
 3. Confirm cargo works with no network (try CARGO_NET_OFFLINE=1).
 4. Report whether a src/lib.rs that declares the same modules can coexist with the bin using
    #[path] on the same files without breaking either build.
Return concrete, copy-pasteable findings.`, { label: 'recon:toolchain', phase: 'Recon' }),

  () => agent(`${SPEC}

RECON TASK (read-only): adversarially expand the behavioural ground truth by running the
reference binary /workspace/dataset/test1_executable. Try to FALSIFY the ground-truth table above.
Cover at least: no args; empty-string arg; whitespace-only; all 6 C-locale whitespace chars as
leading whitespace (space \\t \\n \\v \\f \\r) - note \\v and \\f are NOT yet verified, check them;
"+5"; "-0"; "  -0  "; "007"; huge digit strings; "2147483647"; "-2147483648"; "2147483648";
"-2147483649"; leading whitespace AFTER a sign; embedded NUL is impossible via argv; unicode digits;
"\\u00a0" (non-breaking space - is it whitespace to stoi? verify); locale effects; a second
argument; 20 extra arguments; an argument that is only "-"; only "+".
For each case record exact stdout bytes, exact stderr bytes, and exit status separately
(use: ./test1_executable ARG >/tmp/o 2>/tmp/e; echo $?; xxd /tmp/o; xxd /tmp/e).
Return a compact but COMPLETE table of arg -> (stdout, stderr, exit code), and explicitly call out
ANY case where the ground-truth table above is wrong or incomplete.`, { label: 'recon:behaviour', phase: 'Recon' }),
])
const RECON = `=== RECON FINDINGS (from prior agents; treat as verified facts) ===
[toolchain]
${recon[0] || 'n/a'}

[behaviour]
${recon[1] || 'n/a'}
`
log('Recon complete; spawning 3 independent implementations')

// ---------------------------------------------------------------- Implement + DiffTest (pipelined)
phase('Implement')
const CANDS = [
  {
    dir: '/tmp/cand1',
    brief: `DESIGN A - Clojure/immer-style bit-partitioned vector trie.
Branching factor 32 (BITS=5). Struct fields: size, shift, root: Rc<Node<T>>, tail: Rc<Vec<T>> (or
Rc<[T;32]>-like). Tail buffer absorbs the last <=32 elements so the common push_back is a 32-slot
tail copy + one Rc alloc; when the tail fills, push it into the trie and possibly grow the root
(increase shift). Radix indexing: (i >> shift) & 31 per level, with a tail short-circuit.
Node = enum { Branch(Vec<Rc<Node<T>>>), Leaf(Vec<T>) }.`,
  },
  {
    dir: '/tmp/cand2',
    brief: `DESIGN B - RRB-flavoured relaxed radix balanced tree.
Same 32-way trie but each branch may carry an optional size table so subtrees need not be full;
strict radix fast path when the size table is absent (this is what immer's flex_vector generalises
to, and it degrades to design A for pure push_back workloads). push_back still amortised O(1) with
a tail. Prove indexing correctness for both the strict and the relaxed path in unit tests.
Keep the code honest: if a size table is present, index by scanning/binary-searching it.`,
  },
  {
    dir: '/tmp/cand3',
    brief: `DESIGN C - clarity-first bit-partitioned trie with an explicitly documented invariant set.
Branching factor 32, tail buffer, but organise around a small, heavily-tested core: a private
\`trie\` module with push_tail/index/update/pop primitives and a thin public \`Vector<T>\` facade.
Emphasis on: exhaustive unit tests (property-style loops up to n=200_000 comparing against
std::vec::Vec as an oracle for get/update/pop/iterate), clear invariant comments, and the smallest
amount of code that is still O(log32 n). Prefer readability where it does not cost complexity class.`,
  },
]

const results = await pipeline(
  CANDS,
  (c) => agent(`${SPEC}
${RECON}

YOUR CANDIDATE DIRECTORY: ${c.dir}
${c.brief}

Build the COMPLETE deliverable inside ${c.dir} (create it fresh: rm -rf ${c.dir} && mkdir -p ${c.dir}).
Do NOT touch /output - that is reserved for a later phase. Do not touch the other /tmp/cand* dirs.
Layout (adapt names if your recon says otherwise):
  ${c.dir}/Cargo.toml         [[bin]] name="test1" path="test1.rs", edition 2021, no dependencies
  ${c.dir}/test1.rs           entry point: #[path=...] mod declarations + fn main()
  ${c.dir}/src/lib.rs         library root declaring the modules (must not break the rustc path)
  ${c.dir}/src/immer/mod.rs   + vector.rs / node.rs ...   the persistent vector
  ${c.dir}/src/cxx/mod.rs     + stoi.rs (or similar)      the std::stoi emulation incl. abort()
Then VERIFY YOURSELF before returning:
  * cargo build --release  AND  rustc --edition 2021 -O test1.rs -o test1  both succeed, zero warnings
  * cargo test passes
  * differential check vs /workspace/dataset/test1_executable on at least these args:
    (none) "" " " 0 1 2 3 4 5 -1 -100 007 +7 3abc "  42" abc .5 "+ 7" 2147483647 -2147483648
    2147483648 -2147483649 99999999999999999999 0x10 "12 34" "1,000" 1000000
    compare stdout bytes, stderr bytes and exit status SEPARATELY for each
  * time n=10000000 in the release build
Iterate until all of that is green. Return the schema fields; be honest in knownGaps.`,
    { label: `impl:${c.dir.slice(-5)}`, phase: 'Implement', schema: IMPL_SCHEMA }),

  (impl, c) => agent(`${SPEC}
${RECON}

INDEPENDENT DIFFERENTIAL TEST of the candidate in ${c.dir}. You did NOT write this code; be a hostile
tester. The implementer claimed: ${impl ? JSON.stringify(impl.selfTest).slice(0, 1200) : 'NOTHING (implementation agent failed)'}
Verify or refute, from scratch:
 1. cd ${c.dir}; cargo build --release 2>&1 (record warnings/errors);
    also rustc --edition 2021 -O test1.rs -o /tmp/dt_${c.dir.slice(-1)}_bin 2>&1
 2. Confirm Cargo.toml really has no [dependencies], and grep the tree for \`extern crate\`,
    \`use some_crate\`, unsafe, and #![feature(  - report anything found.
 3. Write a differential harness script that runs the C++ binary and the Rust binary over a LARGE
    case matrix and compares stdout bytes, stderr bytes AND exit status separately. Include:
    no-arg; "" ; " " ; each whitespace char alone and as a prefix; 0..40; 31 32 33 1023 1024 1025
    32767 32768 32769 1048575 1048576 1048577; negatives; +N; leading zeros; trailing junk;
    "abc" ".5" "+ 7" "-  7" "-" "+" "0x10" "1e3" "1,000" "12 34"; INT_MAX/INT_MIN and +-1 past them;
    a 400-digit number; unicode digit; multiple extra args.
    Report the exact command list you used and the pass/fail counts.
 4. Performance: time both binaries at n=1000000 and n=10000000. Flag it as a failure if the Rust
    release build is more than ~30x slower than C++ or is super-linear (test 1e6 vs 1e7 scaling).
 5. cargo test - report the summary line.
 6. Fidelity: read the vector implementation and judge whether push_back really is structurally
    shared O(log32 n) (not a full clone per push) and whether old versions stay valid/unchanged.
    Write a tiny extra Rust test if needed to prove the old version is unaffected.
Report every failure precisely. Do not fix anything - just report.`,
    { label: `difftest:${c.dir.slice(-5)}`, phase: 'DiffTest', schema: DIFF_SCHEMA }),
)

const scored = results.filter(Boolean)
log(`Diff-tested ${scored.length}/3 candidates: ${scored.map(r => `${r.dir}=${r.passed}/${r.totalCases}`).join(', ')}`)

// ---------------------------------------------------------------- Judge
phase('Judge')
const EVIDENCE = JSON.stringify(scored, null, 1).slice(0, 24000)
const LENSES = [
  { key: 'correctness', ask: 'byte-exact behavioural parity with the C++ binary (stdout, stderr, exit status), stoi edge cases, and the quality/paranoia of the evidence backing each claim' },
  { key: 'fidelity',    ask: 'faithfulness as an immer::vector re-implementation: real structural sharing, O(1) amortised push_back, O(log32 n) index, persistence of old versions, API completeness, performance vs the C++ reference' },
  { key: 'compliance',  ask: 'requirement compliance and engineering quality: zero deps, edition 2021, module organisation under src/, test1.rs at the package root, BOTH build paths working, no unsafe, no warnings, test coverage, readability' },
]
const judgments = await parallel(LENSES.map(l => () => agent(`${SPEC}

Three candidate implementations were built and independently diff-tested. Evidence (structured
diff-test reports):
${EVIDENCE}

You are the ${l.key.toUpperCase()} judge. Score each candidate 0-10 on: ${l.ask}.
You MUST inspect the actual code on disk (/tmp/cand1, /tmp/cand2, /tmp/cand3) - do not score from the
reports alone; the reports may be wrong or over-generous. Re-run anything you doubt.
Then name a winner and list specific graft-worthy ideas from the losers (file + what to take).`,
  { label: `judge:${l.key}`, phase: 'Judge', schema: JUDGE_SCHEMA })))

const votes = judgments.filter(Boolean)
const tally = {}
for (const j of votes) for (const r of (j.ranking || [])) tally[r.dir] = (tally[r.dir] || 0) + r.score
const winner = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || '/tmp/cand1'
const grafts = votes.flatMap(j => j.graftIdeas || [])
log(`Winner: ${winner} (scores: ${JSON.stringify(tally)})`)

// ---------------------------------------------------------------- Finalize
phase('Finalize')
const FINAL_CTX = `${SPEC}
${RECON}

=== JUDGING RESULT ===
Winning candidate: ${winner}
Score tally: ${JSON.stringify(tally)}
Judge reports: ${JSON.stringify(votes).slice(0, 14000)}
Graft ideas to consider: ${JSON.stringify(grafts).slice(0, 4000)}
Diff-test evidence: ${EVIDENCE.slice(0, 10000)}
`
const finalReport = await agent(`${FINAL_CTX}

FINALIZE. Assemble the production deliverable in /output (currently empty).
 1. Start from ${winner} and graft in the worthwhile improvements the judges identified from the
    other candidates (better tests, cleaner module split, faster paths, missing API, doc comments).
    Do not graft anything you have not re-verified.
 2. Final layout in /output (package root = /output):
      /output/Cargo.toml      edition 2021, no [dependencies], [[bin]] name="test1" path="test1.rs"
      /output/test1.rs        entry file at the PACKAGE ROOT (R5) - #[path] mod decls + fn main()
      /output/src/...         library modules (immer vector + stoi/cxx compat), each documented
      /output/README.md       short: design, module map, how to build both ways, behaviour table
      /output/.gitignore      target/  (optional)
 3. Build BOTH ways from /output and leave the artefacts in place:
      cargo build --release                          -> /output/target/release/test1
      rustc --edition 2021 -O test1.rs -o test1      -> /output/test1   <-- REQUIRED, must exist
    (Requirement 7 asks for the executable produced from test1.rs; name it exactly \`test1\`.
     Do NOT overwrite the source file /output/test1.rs.)
    Also check plain \`rustc test1.rs -o /tmp/e2015\` (edition 2015) and make it work if cheap.
 4. cargo test must pass. Zero compiler warnings from both build paths (fix, do not #[allow] your
    way out, except where an allow is genuinely idiomatic).
 5. Re-run the full differential matrix against /workspace/dataset/test1_executable using
    /output/test1 AND /output/target/release/test1 - stdout, stderr, exit status - and paste the
    pass/fail summary into your answer. Every one of the 5 published examples (0,1,2,3,4) plus the
    no-arg default (5) must match exactly.
Return: the final file tree (with line counts), the build commands and their exit status, the
cargo test summary, and the differential pass/fail summary.`, { label: 'finalize', phase: 'Finalize' })

// ---------------------------------------------------------------- Verify + Repair loop
const SKEPTIC_LENSES = [
  { key: 'stoi-parity',   ask: `Attack the std::stoi emulation ONLY. Fuzz /output/test1 against /workspace/dataset/test1_executable with at least 300 generated argv strings (whitespace combos incl. \\v and \\f, signs, leading zeros, huge/overflowing numbers, junk suffixes, unicode, empty, "-", "+", 400-digit numbers, mixed). Compare stdout bytes, stderr bytes and exit status separately. Any single mismatch is a high-severity issue.` },
  { key: 'output-bytes',  ask: `Attack the OUTPUT path. Verify byte-exactness (xxd) of stdout for the 5 published cases and the no-arg default; verify nothing extra is printed (no trailing spaces, no CR, exactly one \\n); verify stdout is EMPTY on the abort paths; verify exit statuses (0 vs 134); verify behaviour when stdout is a pipe vs a file vs closed (e.g. >&- ), and with LC_ALL=C vs a UTF-8 locale.` },
  { key: 'persistence',   ask: `Attack the DATA STRUCTURE. Write your own adversarial Rust test file that uses the /output library modules and check: old versions are unchanged after push_back/update/pop; structural sharing actually happens (clone is O(1); pushing does not deep-copy - reason from the code and/or measure); indexing is correct across level boundaries (n = 31,32,33,1023,1024,1025,32767,32768,32769,1048576,1048577); update/pop/iterate/FromIterator/PartialEq/Debug all agree with a std Vec oracle; no panics on out-of-range get; Index panics like std does. Also confirm push_back is NOT O(n) per call by timing 1e6 vs 1e7 (must be ~linear overall, not quadratic).` },
  { key: 'requirements',  ask: `Attack REQUIREMENT COMPLIANCE literally, as a grader would. Check each of R1-R7 and the task's 7 numbered requirements: zero external deps (Cargo.toml has no [dependencies]; no vendored crates; grep for extern crate); edition 2021; args parsed via std::env::args(); library code in MODULES under src/ (not one file); test1.rs present at /output package root; an executable named test1 exists at /output/test1 and actually runs; \`cargo build --release\` works from a CLEAN state (delete target/ and rebuild, offline) and \`rustc --edition 2021 test1.rs\` works from a clean state too - then RESTORE the artefacts afterwards. Confirm no immer C++ headers were copied into /output. Confirm /output/test1.rs is still SOURCE CODE, not clobbered by a binary.` },
  { key: 'robustness',    ask: `Attack ROBUSTNESS and anything the other lenses would miss: 64-bit vs 32-bit assumptions (usize vs i32 conversions, n up to INT_MAX), integer overflow in the trie shift arithmetic (debug builds panic on overflow - run a DEBUG build too: cargo run -- <arg> for tricky values), behaviour of the debug build vs release build on all published cases, memory blowup, stack depth/recursion (does a recursive trie op blow the stack at large n?), non-UTF8 argv bytes (use a shell to pass invalid UTF-8, e.g. $'\\xff' - the C++ binary treats argv as bytes; what does the Rust one do? compare!), and any panic path that would print a Rust panic message where C++ prints nothing.` },
]

let repaired = finalReport
for (let round = 0; round < 3; round++) {
  phase(round === 0 ? 'Verify' : 'Repair')
  const verdicts = (await parallel(SKEPTIC_LENSES.map(l => () => agent(`${SPEC}

The deliverable is COMPLETE and lives in /output. Build artefacts: /output/test1 and
/output/target/release/test1. Reference: /workspace/dataset/test1_executable.
Finalizer's report: ${String(repaired).slice(0, 6000)}

You are an adversarial skeptic with the "${l.key}" lens. Your job is to REFUTE the claim that this
deliverable is correct and complete. ${l.ask}
Run real commands; do not speculate. Report only defects you actually reproduced, with the exact
repro. If, after genuinely trying, you find nothing, set clean=true. Do NOT modify /output.`,
    { label: `skeptic:${l.key}`, phase: round === 0 ? 'Verify' : 'Repair', schema: VERDICT_SCHEMA, effort: 'high' })))).filter(Boolean)

  const issues = verdicts.flatMap(v => (v.issues || []).map(i => ({ ...i, lens: v.lens || 'unknown' })))
  const actionable = issues.filter(i => i.severity === 'high' || i.severity === 'medium')
  log(`Round ${round + 1}: ${verdicts.filter(v => v.clean).length}/${verdicts.length} lenses clean, ${issues.length} issues (${actionable.length} actionable)`)
  if (!actionable.length) { repaired = `${repaired}\n\n=== VERIFIED CLEAN in round ${round + 1}; low-severity notes: ${JSON.stringify(issues)}` ; break }

  // confirm each actionable issue with an independent refuter before spending a fix on it
  const confirmed = (await parallel(actionable.map(i => () => agent(`${SPEC}

An adversarial reviewer claims the deliverable in /output has this defect:
  severity: ${i.severity}
  lens: ${i.lens}
  description: ${i.description}
  repro: ${i.repro}
Independently REPRODUCE it. Default to refuted=true if you cannot reproduce it exactly, or if the
behaviour actually matches /workspace/dataset/test1_executable (the C++ binary is the only oracle
that matters; a difference from some idealised Rust style is NOT a defect). Do not modify /output.
Return JSON only: {"real": true|false, "evidence": "..."}`,
    { label: `refute:${i.lens}`, phase: round === 0 ? 'Verify' : 'Repair', effort: 'high',
      schema: { type: 'object', additionalProperties: false, required: ['real', 'evidence'], properties: { real: { type: 'boolean' }, evidence: { type: 'string' } } } })
    .then(v => (v && v.real ? { ...i, evidence: v.evidence } : null))))).filter(Boolean)

  log(`Round ${round + 1}: ${confirmed.length}/${actionable.length} issues confirmed real`)
  if (!confirmed.length) { repaired = `${repaired}\n\n=== All round-${round + 1} claims failed independent reproduction.` ; break }

  repaired = await agent(`${SPEC}

Fix these INDEPENDENTLY CONFIRMED defects in /output:
${JSON.stringify(confirmed, null, 1).slice(0, 14000)}

Rules: minimal, surgical fixes; do not regress anything; keep the module organisation and both build
paths working. After fixing, rebuild BOTH ways (cargo build --release AND
rustc --edition 2021 -O test1.rs -o test1, leaving /output/test1 in place), re-run cargo test, and
re-run the full differential matrix vs /workspace/dataset/test1_executable (stdout, stderr, exit
status). Report what you changed, why, and the post-fix verification output.`,
    { label: `fix:round${round + 1}`, phase: 'Repair' })
}

// ---------------------------------------------------------------- Completeness critic
phase('Critic')
const critic = await agent(`${SPEC}

Final completeness review of /output. Latest report: ${String(repaired).slice(0, 6000)}

Ask: what is MISSING? Consider: an unverified requirement; a build path never exercised from clean;
a published test case never actually run against the final artefact; a stale/leftover file in /output
(scratch scripts, stray binaries, /output/test1.rs accidentally clobbered, other candidates' files);
missing docs; missing unit tests; a claim in the README that is not true; artefacts that should exist
but do not (/output/test1, /output/target/release/test1).
Verify the final state yourself with real commands: list /output recursively, run
/output/test1 with no args and with 0,1,2,3,4 and diff against /workspace/dataset/test1_executable,
run cargo test, and confirm /output/test1.rs is still valid Rust source.
You MAY fix small omissions directly (stale files, README inaccuracies, a missing artefact); report
anything larger instead of half-fixing it.
Return: a final verified status report - file tree, build status, test status, differential results,
and anything still outstanding.`, { label: 'critic:completeness', phase: 'Critic', effort: 'high' })

return { winner, tally, finalReport: repaired, critic }
