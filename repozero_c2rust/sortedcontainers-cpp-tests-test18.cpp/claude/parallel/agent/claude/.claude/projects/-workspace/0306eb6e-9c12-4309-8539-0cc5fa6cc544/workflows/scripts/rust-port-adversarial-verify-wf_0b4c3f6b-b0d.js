export const meta = {
  name: 'rust-port-adversarial-verify',
  description: 'Adversarially review and stress-test the Rust port in /output against the C++ binary',
  phases: [
    { title: 'Review', detail: 'independent lenses over the Rust source' },
    { title: 'Refute', detail: 'three skeptics per finding, majority rules' },
    { title: 'Stress', detail: 'disjoint differential sweeps + build matrix' },
  ],
}

const SHARED = `
# Context

A C++ program was ported to pure Rust. The deliverable is the Cargo project in /output:

  /output/Cargo.toml
  /output/test18.rs                      entry point (package root, [[bin]] path)
  /output/compat.rs                      glibc atoi + std::cout bool formatting
  /output/sortedcontainers/mod.rs         module root + free fn update()
  /output/sortedcontainers/buckets.rs     two-level bucket storage engine
  /output/sortedcontainers/cursor.rs      Cursor = C++ iterator stand-in
  /output/sortedcontainers/sorted_map.rs  SortedMap public container
  /output/test18                          binary produced by \`rustc -O test18.rs\`

The C++ source is /workspace/dataset/test18.cpp. The compiled C++ reference binary is
/workspace/dataset/test18_executable -- run it with any argv to compare. The C++ library header
it included is NOT on disk; the port was done black-box.

## Hard requirements the deliverable must meet
1. Pure Rust, 2021 edition, compiles with rustc or as a Cargo project.
2. Same CLI arguments as the C++ binary (optional argv[1] = n, default 18), parsed from process args.
3. Byte-for-byte identical stdout to the C++ binary. Same numeric and string formatting.
4. ZERO external crates. std only. No crates.io dependencies anywhere, including dev-dependencies.
5. Complete Cargo project in /output, library code split into modules, entry file at /output/test18.rs.
6. An executable must exist in /output.
7. Both \`cd /output && rustc test18.rs\` and \`cd /output && cargo build --release\` must work.
   NOTE: bare \`rustc test18.rs\` defaults to edition 2015, so the code must compile under BOTH
   edition 2015 and edition 2021.

## What the lead engineer already verified (re-derive rather than trust)
- n=0..1200 exhaustive diff vs the C++ binary: all identical.
- Large n (1500..1000000, 15 values): identical. Rust is ~1.9x faster than the C++ binary.
- 46 argv edge cases through the whole program, plus an 82-case atoi corpus diffed against a real
  glibc atoi() C program (including non-UTF-8 argv bytes): all identical.
- \`cargo test\` runs 24 unit tests, all pass, including fuzz comparisons against BTreeMap.
- debug, release, rustc-2015 and rustc-2021 artifacts all produce identical output.

CAUTION: argv values that parse to a large positive n (e.g. "2147483647", "-2147483649") make BOTH
binaries attempt billions of insertions. Do not run those; they will hang. Check the parsed n first.

## Rules
- Do NOT modify anything in /output. You are reviewing and testing only. Use /tmp for scratch.
- No network. Toolchain: rustc/cargo 1.75.0, gcc/g++ 12 at /opt/compiler/gcc-12/bin.
- Your final message is consumed programmatically; return exactly the requested structured data.
`

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
        required: ['title', 'file', 'line', 'severity', 'why_it_is_wrong', 'concrete_trigger'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          why_it_is_wrong: { type: 'string' },
          concrete_trigger: { type: 'string', description: 'Exact inputs/state that expose it, or the exact command that fails' },
        },
      },
    },
  },
}

const LENSES = [
  {
    key: 'buckets-correctness',
    prompt: `${SHARED}

## Your lens: the bucket engine's correctness

Read /output/sortedcontainers/buckets.rs closely and attack the data structure itself. It claims two
invariants: (1) no bucket is ever empty, (2) bucket key ranges are strictly increasing.

Hunt for sequences of insert/remove/get_or_insert_with that break either invariant, or that make
lower_bound/upper_bound/find/advance/at return a wrong answer. Think hard about:
- \`partition_point\` predicate monotonicity, and the \`map_or(true, ...)\` fallbacks.
- \`split_if_needed\`: the offset translation when a bucket splits, and whether the caller's Pos is
  still valid afterwards. Is the split ever needed on a bucket other than the one just touched?
- \`rebalance\`: merging the first bucket with its right neighbour vs a later bucket with its left
  neighbour. Does key order survive both directions? Can it loop, or leave a bucket over 2*load?
  Does \`self.load / 2\` behave when load is 1 (integer division to 0)?
- \`insert_at\` when pos.bucket == buckets.len() (append path) vs the middle path.
- Whether \`len\` can ever desynchronise from the sum of bucket lengths.
- Whether a Pos can ever be non-normalised, which would break Cursor equality.

Write an independent stress program in /tmp that includes the real module via
\`#[path = "/output/sortedcontainers/buckets.rs"] mod buckets;\` and hammers it with randomised
operation sequences at small load factors (1, 2, 3), comparing against a naive sorted Vec model and
asserting the invariants after every single operation. Run at least 200k operations. Report what you
actually observed.`,
  },
  {
    key: 'cursor-and-api',
    prompt: `${SHARED}

## Your lens: cursor semantics and the C++-to-Rust API mapping

Read /output/sortedcontainers/cursor.rs, /output/sortedcontainers/sorted_map.rs,
/output/sortedcontainers/mod.rs and /workspace/dataset/test18.cpp side by side.

For each C++ construct, decide whether the Rust translation is exactly equivalent, and prove it:
- \`m[key]\` used as an rvalue (prints, and inserts a default when missing) vs \`entry_or_default\`.
- \`m.get(key, "default")\` (must NOT insert) vs \`get_or\`.
- \`it != m.end()\` then \`it->second\` vs \`if let Some(value) = m.find(&k).value()\`. Is
  \`value()\` None on exactly the same condition as \`it == m.end()\`?
- \`std::get<0>(lb->first)\` vs \`key.0\`.
- \`for (it = range.first; it != range.second; ++it)\` vs the while/advance loop. Could the loop
  ever fail to terminate, or over/under-count?
- \`sortedcontainers::update\` overwrite semantics.
- \`keys()\` / \`values()\` ordering and alignment with each other.
- \`std::tuple<int,int>\` ordering vs Rust \`(i32, i32)\` ordering.
- Cursor equality via \`std::ptr::eq(self.store, other.store)\`: is comparing a \`&Buckets<K,V>\`
  fat/thin pointer sound here? Could two live cursors into the SAME map ever compare unequal when
  they address the same element, or equal when they do not? Consider zero-sized types and the case
  where the map is empty.
- Are the Clone/Copy/PartialEq/Eq hand impls on Cursor sound and free of surprising bounds?

Where you suspect a divergence, write a small Rust program in /tmp that includes the real modules
via \`#[path = ...]\` and demonstrates it.`,
  },
  {
    key: 'panics-and-overflow',
    prompt: `${SHARED}

## Your lens: panics, overflow, and anything that aborts where C++ would not

The C++ binary never crashes and always exits 0. Find any input or state where the Rust port could
panic, abort, or exit non-zero. Consider:
- Integer overflow in /output/test18.rs: \`i * 2\` and \`(i + 10) * 2\` with i32, and \`n / 2\`
  when n is i32::MIN. Rust panics on overflow in DEBUG builds -- \`cargo build\` without --release
  produces such a binary. Work out the exact n at which each expression would overflow, and whether
  that n is reachable in practice (bear in mind the C++ binary would also need to allocate that
  many entries). Test the debug binary at /output/target/debug/test18 if it exists, else build one
  in /tmp with \`cargo build\` -- do NOT modify /output (build with CARGO_TARGET_DIR=/tmp/dbg).
- \`0..n\` and \`0..n/2\` ranges with negative n.
- Every \`unwrap\`, \`expect\`, indexing, and slice operation in the library. Are the bucket indexings
  (\`self.buckets[pos.bucket][pos.offset]\`) provably in range at every call site?
- /output/compat.rs \`atoi\`: \`checked_mul\`/\`checked_add\`/\`filter\`/\`unwrap_or\` chain, the
  \`1u64 << 63\` limit, \`magnitude as i64\`, \`wrapping_neg\`, and \`value as i32\`. Can it panic
  or loop forever on a pathological string (e.g. 10 million digits)? Test that.
- Non-UTF-8 argv (\`to_string_lossy\`), and an empty argv[0].
- Broken pipe on stdout: \`println!\` panics if stdout is closed, while C++ silently ignores it.
  Test \`/output/test18 18 | head -1\` versus the C++ binary, and report the exit codes and whether
  Rust prints a panic message to stderr. Judge whether this matters for the stated requirements.
- Stack depth / recursion: is anything recursive?

Report each real difference with the exact command that shows it.`,
  },
  {
    key: 'requirements-and-build',
    prompt: `${SHARED}

## Your lens: requirement compliance and build robustness

Audit the deliverable against the seven hard requirements above, and be pedantic.

- Confirm zero external crates: inspect /output/Cargo.toml, check for Cargo.lock contents, and grep
  the whole tree for \`extern crate\`, \`use\` statements naming anything outside std/core/alloc.
- Verify \`cd /output && rustc test18.rs\` works from a clean state (move any existing ./test18 aside
  into /tmp first, then restore it exactly -- or better, build to a /tmp output path with -o so you
  never touch /output). Confirm which edition that uses and that the code is edition-agnostic.
  Specifically test compiling with \`--edition 2015\`, \`--edition 2018\` and \`--edition 2021\`.
- Verify \`cargo build --release\` and \`cargo test\` work with CARGO_TARGET_DIR pointed at /tmp so
  you do not dirty /output.
- Check the project builds when copied elsewhere (copy /output to /tmp/copy and build there) -- i.e.
  no absolute paths baked in.
- Check for compiler warnings in every configuration (rustc plain, rustc --edition 2021, cargo
  build, cargo build --release, cargo test). Report every warning verbatim. Also run
  \`cargo clippy\` if it is installed; if not, say so.
- Confirm the entry file is at /output/test18.rs and an executable exists in /output. Report exactly
  which files exist in /output and whether any build artifacts (target/, Cargo.lock) are present and
  whether that is a problem.
- Is \`edition = "2021"\` actually declared? Does the [[bin]] target name match?
- Sanity-check the module organisation against "organize library code into modules".`,
  },
]

const reviewed = await pipeline(
  LENSES,
  lens => agent(lens.prompt, { label: `review:${lens.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  (result, lens) => {
    const findings = (result && result.findings) || []
    if (!findings.length) return []
    return parallel(findings.map(f => () =>
      parallel([
        `Read the code and decide whether the defect is REAL as described. Reproduce it or fail to.`,
        `Assume the finding is wrong. Argue why the existing code is actually correct. Only concede if you can produce a concrete failing input.`,
        `Ignore the reasoning entirely. Just try to make it happen: build a program in /tmp that includes the real /output modules via #[path], or run the built binaries, and see whether the claimed behaviour occurs.`,
      ].map((angle, i) => () =>
        agent(`${SHARED}

## Your job: refute a review finding

A reviewer working the "${lens.key}" lens filed this against the Rust port:

  title:      ${f.title}
  location:   ${f.file}:${f.line}
  severity:   ${f.severity}
  claim:      ${f.why_it_is_wrong}
  trigger:    ${f.concrete_trigger}

${angle}

Default to refuted=true when you cannot demonstrate the problem concretely. A finding only survives
if you can point at a real input, command, or code path that actually misbehaves. "It would be
cleaner if..." is not a defect unless it violates one of the seven hard requirements.`,
          {
            label: `refute:${f.file.split('/').pop()}:${i}`,
            phase: 'Refute',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['refuted', 'reasoning'],
              properties: {
                refuted: { type: 'boolean' },
                reasoning: { type: 'string' },
                reproduction: { type: 'string', description: 'If NOT refuted: the exact command and observed output proving the defect' },
              },
            },
          }))
      ).then(votes => {
        const live = votes.filter(Boolean)
        const survived = live.filter(v => !v.refuted).length
        return { ...f, lens: lens.key, votes: live.length, survived, verdict: survived >= 2 ? 'CONFIRMED' : 'REFUTED' }
      })
    ))
  }
)

const allFindings = reviewed.filter(Boolean).flat().flat().filter(Boolean)
const confirmed = allFindings.filter(f => f.verdict === 'CONFIRMED')
log(`${allFindings.length} findings filed, ${confirmed.length} survived refutation`)

phase('Stress')

const STRESS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cases_run', 'mismatches', 'summary'],
  properties: {
    cases_run: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'cpp_output', 'rust_output'],
        properties: {
          argv: { type: 'string' },
          cpp_output: { type: 'string' },
          rust_output: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

const SWEEPS = [
  {
    key: 'n-1201-4000',
    prompt: `Exhaustively diff EVERY integer n from 1201 to 4000 inclusive. Compare stdout byte for byte
(use cmp or md5sum on the raw bytes, not line-wise text comparison) and also compare exit codes.`,
  },
  {
    key: 'n-4001-8000',
    prompt: `Exhaustively diff EVERY integer n from 4001 to 8000 inclusive, byte for byte, plus exit codes.`,
  },
  {
    key: 'n-sampled-large',
    prompt: `Diff a wide spread of larger n: every multiple of 500 from 8000 to 60000, then
80000, 100000, 131072, 150000, 200000, 262144, 300000, 400000, 500000, 750000, 1000000, 1500000.
Byte for byte. Also record wall-clock time for each binary at the three largest sizes and report
whether the Rust port is competitive. Stop escalating if a single run exceeds 60s.`,
  },
  {
    key: 'argv-fuzz',
    prompt: `Fuzz the ARGUMENT, not the size. Generate several hundred adversarial argv[1] strings and diff
the full program output for each. Include: every ASCII byte as a single-character argument; random
mixes of digits, signs, whitespace and letters; strings with embedded NULs if the shell allows;
very long digit strings (1000 and 100000 digits, both signs); numbers straddling INT_MAX, INT_MIN,
UINT_MAX, LONG_MAX, LONG_MIN; leading-zero padded numbers; unicode digits (e.g. Arabic-Indic ٣,
fullwidth ３) which C's atoi must reject; non-UTF-8 byte sequences; and multiple arguments where
argv[1] is valid and later ones are junk. Also test the zero-argument invocation.

CRITICAL: before running any candidate, compute what n it parses to (a tiny C program calling atoi
is the easiest oracle) and SKIP anything above ~400000, because both binaries would then try to
allocate billions of entries and hang. Report how many you skipped.`,
  },
]

const stress = await parallel(SWEEPS.map(s => () =>
  agent(`${SHARED}

## Your assignment: differential sweep (${s.key})

${s.prompt}

Compare /workspace/dataset/test18_executable against /output/test18 (already built). Drive it from a
bash script in /tmp; do not do it one call at a time. Report the exact number of cases you ran and
every mismatch you found, with both outputs. If there were no mismatches, say so plainly and state
the case count -- do not invent findings.`,
    { label: `stress:${s.key}`, phase: 'Stress', schema: STRESS_SCHEMA })
    .then(r => ({ key: s.key, ...r }))
))

return {
  confirmed,
  refuted: allFindings.filter(f => f.verdict === 'REFUTED').map(f => ({ title: f.title, file: f.file, lens: f.lens })),
  stress: stress.filter(Boolean),
}
