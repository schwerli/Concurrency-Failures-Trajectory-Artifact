export const meta = {
  name: 'cpp-to-rust-hopscotch-test5',
  description: 'Port tests/test5.cpp (tsl::hopscotch_map) to a dependency-free Rust Cargo project in /output, then adversarially verify parity',
  phases: [
    { title: 'Build', detail: 'implement hopscotch map + stoi + entry file, compile both ways' },
    { title: 'Review', detail: 'parallel lenses: map correctness, CLI/stoi parity, structure/build, output bytes' },
    { title: 'Test', detail: 'differential fuzz vs C++ binary; map invariants vs std HashMap' },
    { title: 'Verify', detail: 'adversarial refutation of each finding' },
    { title: 'Fix', detail: 'apply confirmed findings' },
    { title: 'Gate', detail: 'final independent parity + requirements audit' },
  ],
}

const SPEC = args.spec

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          detail: { type: 'string', description: 'what is wrong and the concrete failing input/state' },
          fix: { type: 'string', description: 'concrete minimal fix' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
        },
        required: ['title', 'file', 'detail', 'fix', 'severity'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true only if you reproduced or proved the defect' },
    evidence: { type: 'string' },
  },
  required: ['real', 'evidence'],
}

const GATE = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
  required: ['pass', 'failures', 'evidence'],
}

phase('Build')
const buildPrompt = `You are porting a C++ program to Rust. Work in /output (create it if needed). rustc/cargo 1.75.0 available.

${SPEC}

## What to build

A complete Cargo project rooted at /output with ZERO external dependencies (std only, edition 2021).

Required layout:
- /output/Cargo.toml  — package name "test5", edition 2021, with:
    [lib] name = "hopscotch", path = "src/lib.rs"
    [[bin]] name = "test5", path = "test5.rs"
  (no [dependencies] entries at all)
- /output/src/lib.rs — library root, declares the modules
- /output/src/hopscotch/mod.rs (+ submodules as useful, e.g. map.rs, bucket.rs) — a genuine from-scratch hopscotch hash map
- /output/src/cpp_compat/mod.rs (or similar module, e.g. src/cpp_compat/stoi.rs) — a faithful re-implementation of C++ \`std::stoi\` semantics and the C++ terminate/abort behavior
- /output/test5.rs — the entry program, a direct translation of main()

CRITICAL constraint on test5.rs: it must compile BOTH ways —
  (a) standalone: \`cd /output && rustc -O test5.rs -o test5\`
  (b) via cargo: \`cd /output && cargo build --release\`
Achieve this by having test5.rs pull in the library modules with #[path] module declarations, e.g.
  #[path = "src/hopscotch/mod.rs"] mod hopscotch;
  #[path = "src/cpp_compat/mod.rs"] mod cpp_compat;
so it never needs \`extern crate\`/dependency resolution. src/lib.rs declares the same module files (via #[path] as needed) so the lib target also builds. Make sure BOTH \`rustc -O test5.rs -o test5\` and \`cargo build --release\` succeed with no warnings that indicate real problems (unused-code warnings on a broad library API are acceptable; suppress them tastefully with #![allow(dead_code)] on the library modules rather than deleting API surface).

## The hopscotch map — implement it for real, do not wrap std::collections::HashMap

This is a migration of tsl::hopscotch_map, so implement actual hopscotch hashing:
- power-of-two bucket array, index = hash & (bucket_count - 1)
- per-bucket neighborhood bitmap (u32/u64 NEIGHBORHOOD_SIZE, e.g. 62 or 32) recording which offsets from the home bucket hold entries hashing to it
- insertion: probe for a free slot; if the free slot is beyond the neighborhood, hop closer entries back toward it (the hopscotch displacement loop); if that is impossible, push to an overflow list (Vec/LinkedList) and mark the home bucket's has_overflow flag
- lookup: scan only the set bits of the home neighborhood bitmap, then the overflow list if the flag is set
- erase: clear the entry, clear its neighborhood bit, or remove from overflow (recomputing/clearing the overflow flag correctly); must return usize 0 or 1 like tsl::hopscotch_map::erase(const key_type&)
- growth: rehash into a larger table when load factor exceeds max_load_factor (use 0.5) or when displacement fails repeatedly
- hashing: std::collections::hash_map::DefaultHasher (std only) behind a generic \`S: BuildHasher\` defaulting to std's RandomState — or a deterministic default hasher of your own; either is fine, but keys must be K: Hash + Eq and the map must be generic over <K, V>.

Public API to mirror the C++ interface (used or plausibly used by tests): new(), with_capacity(n), len()/size(), is_empty(), insert((k,v)) returning (bool inserted) or an Option-based equivalent AND an insert_pair/insert taking a tuple so \`map.insert((i, i*2))\` reads like the C++ \`map.insert({i, i*2})\`, get, get_mut, contains_key, erase(&k) -> usize, remove(&k) -> Option<V>, clear, reserve, bucket_count, load_factor, max_load_factor, iter, and Index by &K. Keep the internals private and the invariants documented with brief comments in the surrounding style.

Correctness is the whole point: the map must behave exactly like a hash map for arbitrary insert/erase/lookup sequences, at any size, including after many growths and after erasing entries that live in the overflow list. Write it carefully, then prove it with your own scratch tests (put throwaway test programs in /tmp, NOT in /output — /output must contain only the deliverable project; a tests/ directory with real #[test] cases IS welcome and is run with \`cargo test --release\`).

## std::stoi fidelity
Re-implement libstdc++ \`std::stoi\` exactly as observed in the spec above: skip leading whitespace, optional +/- sign, base-10 digits, stop at first non-digit and ignore the rest, no digits at all => the invalid_argument abort path, value outside i32 range => the out_of_range abort path. Replicate the C++ failure output on stderr byte-for-byte and abort with SIGABRT (std::process::abort()) so the shell-visible exit code is 134:
  terminate called after throwing an instance of 'std::invalid_argument'
    what():  stoi
(note the two spaces after "what():"). Same shape for std::out_of_range. Missing argv[2] must reproduce the std::logic_error 'basic_string::_S_construct null not valid' abort. Nothing goes to stdout on those paths.

## Parity checking (do this before you report done)
The C++ reference binary is /workspace/dataset/test5_executable. For every case in the spec table plus your own cases, run both binaries and diff stdout, stderr, and exit code. Do NOT run the reference with huge counts like 2147483647 (it hangs/OOMs) — cap your own sweeps around 200000 and always use \`timeout\`. Report the exact commands you ran and their diff results.

Return a concise report: files created, both build commands' results, and the parity table you verified.`

const build = await agent(buildPrompt, { label: 'build:port', phase: 'Build' })
log('Initial port complete — fanning out reviewers and testers')

const REVIEW_LENSES = [
  {
    key: 'hopscotch',
    prompt: `Read every file under /output (source only; the C++ library source is not available and must not be sought out). Audit ONLY the hopscotch hash map implementation for correctness defects: neighborhood bitmap bookkeeping, the displacement/hop-back loop, overflow-list insert/erase/lookup, the has_overflow flag lifecycle (is it ever left stale after erasing the last overflow entry for a bucket?), rehash/growth (are neighborhood bitmaps rebuilt from scratch? are overflow entries reinserted?), duplicate-key insert returning without growing, integer overflow in index math, and any path that could lose or duplicate an entry or return a stale value.
For each suspected defect, construct a CONCRETE input sequence that triggers it and, where you can, actually demonstrate it by writing a scratch test in /tmp that uses the library (e.g. \`rustc --edition 2021 -O /tmp/t.rs -L /output/target/release/deps\` or simply \`#[path = "/output/src/hopscotch/mod.rs"] mod hopscotch;\` inside a /tmp file). Do NOT modify anything under /output. Report only defects you can justify with a specific failing scenario.`,
  },
  {
    key: 'cli-stoi',
    prompt: `Read /output/test5.rs and the C++-compat/stoi module under /output/src. Audit CLI and stoi parity against the reference binary /workspace/dataset/test5_executable ONLY (never modify /output).
Empirically compare, running both binaries with \`timeout 10\` and capturing stdout, stderr and exit code separately: no args; --a 0; --a 1; --a 2; --a 3; --a 5; --a 007; "--a" " 12"; --a 12abc; --a abc; --a ""; --a (with no second arg); --b 7; -a 3; --A 3; 3; --a 0x10; --a +4; --a 4.9; "--a" "  -0  "; --a -1; --a -5; --a --a; --a 2147483648; --a -2147483649; --a 99999999999999999999; --a 3 extra; --a 100000; --a 12345; plus tab/newline-prefixed numbers, "- 5", "--a 0000000000000000005", i32::MIN "-2147483648" (careful: that one would try a huge allocation in C++ — reason about it instead of running the C++ side, or verify only that Rust does not print anything wrong before the loop), and any other input class you can think of where libstdc++ stoi or the argv indexing could diverge.
Report every divergence in stdout bytes, stderr bytes, or exit code as a finding with the exact command and both outputs. Also flag any place the Rust program panics with a Rust panic message where C++ aborts, or vice versa.`,
  },
  {
    key: 'structure',
    prompt: `Audit /output against these explicit deliverable requirements, without modifying anything:
1. Pure Rust, edition 2021, compiles with rustc AND as a Cargo project.
2. CLI args identical to the C++ binary; parsed via std::env::args().
3. Logic, numeric precision, string formatting identical; println! output byte-for-byte identical to std::cout.
4. ZERO external dependencies — grep Cargo.toml (and any Cargo.lock) to prove no crates.io deps; confirm no \`extern crate\`, no vendored third-party code.
5. Complete Cargo project in /output with library code organized into modules; entry test file at the package root as /output/test5.rs.
6. Implemented from std only.
7. Compiles to an executable.
Verify each by running commands: \`cd /output && cargo build --release\`, \`cargo test --release\` if tests exist, \`rustc -O test5.rs -o /tmp/test5_standalone\` (do not clobber /output artifacts unnecessarily), \`cargo tree\` or Cargo.lock inspection, \`cargo build --release 2>&1 | grep -c warning\`. Check that /output contains no stray scratch files, no build noise checked in beyond target/, and that the module layout is genuinely modular rather than one giant file. Confirm the produced executable exists and runs. Report each unmet or fragile requirement as a finding.`,
  },
  {
    key: 'output-bytes',
    prompt: `Focus narrowly on output byte fidelity and program shape in /output (read-only).
The C++ prints: \`std::cout << map.size() << " " << removed << std::endl;\` — one line, single space separator, trailing newline, and std::endl FLUSHES. Verify the Rust equivalent emits exactly that, including when stdout is a pipe vs a tty, and that nothing else (no debug prints, no BOM, no CRLF, no extra trailing newline) reaches stdout. Confirm the counted values are computed with the same types/semantics as C++ (int loop counters, i*2 values, \`removed\` accumulating erase()'s 0/1 return, the erase loop stepping i += 2 over i < count) and that the C++ int arithmetic \`i * 2\` overflow behavior is not silently changed into a Rust panic for any count the program can actually reach.
Prove byte equality with: \`cmp <(timeout 10 /workspace/dataset/test5_executable ARGS 2>/dev/null) <(timeout 10 /output/test5 ARGS 2>/dev/null)\` over many arg sets, and \`xxd\` on a couple of outputs. Also check exit codes on the success paths are 0. Report divergences only, with evidence. Do not modify /output.`,
  },
]

const TESTERS = [
  {
    key: 'difffuzz',
    prompt: `You are a differential fuzzer. Do not modify /output. Compare /output/test5 (build it first if missing: \`cd /output && cargo build --release && cp -f target/release/test5 /tmp/rust_test5\` — prefer copying to /tmp and testing that copy, or just use /output/test5 read-only) against /workspace/dataset/test5_executable.
Write a bash or python driver in /tmp that sweeps: every count 0..=300 via \`--a N\`; a set of larger counts (1000, 4095, 4096, 4097, 8192, 65536, 100000, 131072, 200000); the no-arg default; and ~300 randomized argv vectors built from a grammar of {--a, --b, -a, "", " 12", "+7", "-3", "9abc", "abc", "0x1f", "  8  ", "007", "2147483648", numbers with leading zeros/tabs/newlines} in 0..3 positions. For each case compare stdout bytes, stderr bytes and exit status of both binaries (use \`timeout 15\`; skip any case whose count would exceed ~200000 on the C++ side to avoid hangs/OOM — but still record it as skipped and note the skip in your report; do not silently drop cases).
Report EVERY mismatch as a finding with the exact argv, both stdouts, both stderrs, both exit codes. If everything matches, say so explicitly and report the total number of cases compared and skipped.`,
  },
  {
    key: 'mapstress',
    prompt: `You are stress-testing the hopscotch map library in /output for correctness, without modifying /output. Write test programs in /tmp that include the library modules directly, e.g. a /tmp/stress.rs starting with \`#[path = "/output/src/hopscotch/mod.rs"] mod hopscotch;\` (adjust to the real module layout you find) and compile with \`rustc --edition 2021 -O /tmp/stress.rs -o /tmp/stress\`.
Run a model-based randomized comparison against std::collections::HashMap as the oracle: millions of operations over a deterministic xorshift/LCG PRNG (no external crates — implement the PRNG inline), mixing insert of duplicate and fresh keys, get, contains_key, erase (both hits and misses), remove, clear, reserve, and iteration, with key spaces both dense (0..64, forcing heavy neighborhood collisions and overflow use) and sparse (random u64). Assert after every op that len() matches the oracle, and periodically that iter() yields exactly the oracle's key/value multiset and that every oracle key is findable with the right value. Also test adversarial hash collisions: a wrapper key type whose Hash always writes the same value (or a small modulus), inserting thousands of such keys to force the overflow path, then erasing them in random order and verifying lookups throughout. Also test non-integer keys (String) and non-Copy values, growth from with_capacity(0), and erase-then-reinsert cycles.
Report each reproducible failure as a finding with a minimal reproducing sequence. If all clean, report the op counts and configurations you exercised.`,
  },
]

const reviewed = await pipeline(
  [...REVIEW_LENSES.map(l => ({ ...l, phase: 'Review' })), ...TESTERS.map(t => ({ ...t, phase: 'Test' }))],
  item => agent(item.prompt, { label: `${item.phase === 'Test' ? 'test' : 'review'}:${item.key}`, phase: item.phase, schema: FINDINGS })
    .then(r => ({ key: item.key, findings: (r && r.findings) || [], notes: (r && r.notes) || '' })),
  res => {
    if (!res || !res.findings.length) return res
    return parallel(res.findings.map(f => () =>
      agent(`A reviewer claims this defect exists in the Rust project at /output. Your job is to REFUTE it. Default to refuted=true unless you can actually reproduce or prove the defect by reading the exact code and/or running a command.

Claim: ${f.title} (${f.severity})
File: ${f.file}
Detail: ${f.detail}
Proposed fix: ${f.fix}

Read the real code at that path and, where the claim is behavioral, reproduce it concretely (run /output/test5 and /workspace/dataset/test5_executable with \`timeout 10\`, or compile a scratch program in /tmp that includes the library module directly). Do not modify /output. Set real=true ONLY with reproduction or an airtight code-path argument; otherwise real=false. Put the command output or the decisive code lines in evidence.`,
        { label: `verify:${res.key}:${f.title.slice(0, 32)}`, phase: 'Verify', schema: VERDICT })
      .then(v => ({ ...f, source: res.key, verdict: v }))
    )).then(verdicts => ({ ...res, verdicts: verdicts.filter(Boolean) }))
  }
)

const all = reviewed.filter(Boolean)
const confirmed = all.flatMap(r => (r.verdicts || []).filter(v => v.verdict && v.verdict.real))
const notes = all.map(r => `[${r.key}] ${r.notes}`).join('\n')
log(`${confirmed.length} confirmed finding(s) after adversarial verification`)

let fixReport = 'No confirmed findings — nothing to fix.'
if (confirmed.length) {
  phase('Fix')
  const order = { blocker: 0, major: 1, minor: 2 }
  const sorted = [...confirmed].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))
  fixReport = await agent(`Apply these independently-CONFIRMED fixes to the Rust project in /output. Each was reproduced by a skeptical verifier, so treat them as real — but re-read the code before editing and do not make a change that breaks parity with the C++ reference.

${sorted.map((f, i) => `### ${i + 1}. [${f.severity}] ${f.title}
File: ${f.file}
Defect: ${f.detail}
Suggested fix: ${f.fix}
Verifier evidence: ${f.verdict.evidence}`).join('\n\n')}

Reviewer notes (context, not necessarily defects):
${notes}

Constraints unchanged: std only, no crates.io dependencies, edition 2021, library code in modules under /output/src, entry file /output/test5.rs must still compile BOTH standalone (\`cd /output && rustc -O test5.rs -o test5\`) and via \`cargo build --release\`. The hopscotch map must remain a real hopscotch-hashing implementation, not a wrapper over std::collections::HashMap.

After editing: rebuild both ways, run \`cargo test --release\` if tests exist, and re-verify parity against /workspace/dataset/test5_executable (use \`timeout\`; never run the C++ side with counts above ~200000) over at least: no args, --a 0..20, --a 007, --a 12abc, --a abc, --a with no second arg, --a "", --b 7, --a -1, --a 0x10, --a +4, --a 4.9, --a 100000, --a 2147483648, --a 99999999999999999999 — comparing stdout, stderr, and exit code. Also ensure the final binaries exist at /output/test5 and /output/target/release/test5, and that /output holds no scratch/debug files.
Report exactly what you changed and the verification output.`, { label: 'fix:apply', phase: 'Fix' })
}

phase('Gate')
const gate = await parallel([
  () => agent(`Final independent parity gate. Do not fix anything — only verify and report.

Project: /output (Rust). Reference: /workspace/dataset/test5_executable (C++).
${SPEC}

Do all of the following and report the raw evidence:
1. Fresh builds from scratch: \`cd /output && cargo clean && cargo build --release\` and \`cd /output && rustc -O test5.rs -o /tmp/gate_standalone\`. Record any errors/warnings.
2. Confirm executables exist: /output/test5 and /output/target/release/test5 (both should run). If /output/test5 is missing after cargo clean, that is a failure — report it.
3. Byte-exact comparison of stdout, stderr, and exit code between the C++ binary and BOTH Rust binaries for: no args; --a 0,1,2,3,4,5,6,7,10,11,50,51,999,1000,4096,65536,100000; --a 007; "--a" " 12"; --a 12abc; --a abc; --a ""; --a alone; --b 7; -a 3; 3; --a 0x10; --a +4; --a 4.9; --a -1; --a -5; --a --a; --a 2147483648; --a -2147483649; --a 99999999999999999999; --a 3 extra. Use \`timeout 20\`. Use \`cmp\`/\`diff\` on captured files, not eyeballing.
4. \`cargo test --release\` if a tests/ dir or #[test] fns exist.
5. Prove zero external dependencies (Cargo.toml, Cargo.lock).
Set pass=false and list every failure if ANY of stdout/stderr/exit-code diverges, any build fails, or any requirement is unmet.`, { label: 'gate:parity', phase: 'Gate', schema: GATE }),

  () => agent(`Completeness critic for the C++→Rust port in /output. Do not modify anything. Ask: what is still missing or unproven?
Consider: input classes nobody tested (unicode argv, very long argv strings, argv[1] exactly "--a" vs "--a=5", locale-ish whitespace forms like \\v \\f \\r, embedded NULs); hopscotch code paths nobody exercised (overflow-list erase of the last element for a bucket, rehash while overflow is non-empty, displacement chain that fully exhausts the neighborhood, with_capacity edge values, max_load_factor boundary exactly at the threshold, insert of an existing key while the table is at the growth threshold); requirements only partially satisfied (module organization quality, dead code left behind, comments/idiom matching, whether the entry file really is a faithful line-by-line translation of main()); and anything about the deliverable layout that a strict grader would fail (file at /output/test5.rs present and being the actual source that was compiled, executable produced, no crates).
Where you can cheaply close a gap yourself by RUNNING something (compile a /tmp probe, run both binaries), do it and report the result. Return each genuine remaining gap as a finding with a concrete way to close it. Empty findings list if you truly find nothing.`, { label: 'gate:critic', phase: 'Gate', schema: FINDINGS }),
])

return {
  build: typeof build === 'string' ? build.slice(0, 4000) : build,
  confirmedCount: confirmed.length,
  confirmed: confirmed.map(f => ({ severity: f.severity, title: f.title, file: f.file, detail: f.detail.slice(0, 400), source: f.source })),
  refuted: all.flatMap(r => (r.verdicts || []).filter(v => v.verdict && !v.verdict.real).map(v => ({ source: r.key, title: v.title }))),
  reviewerNotes: notes.slice(0, 4000),
  fixReport: typeof fixReport === 'string' ? fixReport.slice(0, 4000) : fixReport,
  gateParity: gate[0],
  gateCritic: gate[1],
}
