export const meta = {
  name: 'test11-review-fuzz',
  description: 'Adversarially review and differentially fuzz the Rust port in /output against the C++ reference binary; verify every finding before reporting',
  phases: [
    { title: 'Review', detail: 'six independent lenses over the port' },
    { title: 'Verify', detail: 'reproduce or refute each finding with real commands' },
  ],
}

const CONTEXT = `
CONTEXT
=======
A C++ program has been ported to pure Rust (std only, no crates, edition 2021).

  C++ source:        /workspace/dataset/test11.cpp
  C++ reference bin: /workspace/dataset/test11_executable   (run it with any args)
  Rust port:         /output/  — entry /output/test11.rs, modules /output/cxx/ and /output/tsl/
  Built binaries:    /output/test11 (rustc) and /output/target/release/test11 (cargo)
  Rebuild:           cd /output && rustc --edition 2021 -O test11.rs -o test11
                     cd /output && cargo build --release && cargo test --release
  Existing harness:  /output/tools/difftest.sh          (runs both binaries side by side)
                     /output/tools/gen_corpus.c         (gcc; emits printf("%.*g") corpus)
                     /output/tools/check_g.rs           (replays a corpus through the Rust formatter)

The C++ program is:
    int count = 11;
    if (argc > 1 && std::string(argv[1]) == "--a") { count = std::stoi(argv[2]); }
    tsl::hopscotch_map<int,int> map;
    for (int i = 0; i < count; i++) map.insert({i, i*9});
    std::cout << map.load_factor() << " ";
    map.max_load_factor(0.5);
    map.rehash(0);
    std::cout << map.load_factor() << std::endl;

The requirements the port must satisfy:
  1. Pure Rust, edition 2021, compiles with rustc or cargo.
  2. Identical CLI: same args, defaults, required fields; parsed from std::env::args (family).
  3. Algorithm logic, numeric precision and string formatting byte-identical to the C++ output.
  4. ZERO external dependencies — std only. No crates.io.
  5. Complete Cargo project in /output, library code organised into modules, entry file at
     /output/test11.rs (package root).
  6. Black box: the hopscotch-map C++ headers are NOT on disk; do not go looking for them.
  7. An executable must be produced in /output.

What has already been established and verified (do not waste effort re-deriving, but DO feel
free to attack any of it):
  * bucket_count starts at 0 and doubles (0 -> 2 -> 4 -> 8 ...) when, before inserting a new
    element, size() >= trunc((float)bucket_count * max_load_factor), with the default
    max_load_factor = 0.9f. Thresholds: 0,1,3,7,14,28,57,115,230,460,921,...
  * load_factor() = (float)size / (float)bucket_count, and exactly 0 when bucket_count == 0.
  * rehash(0) resizes to round_up_pow2(ceil((float)size / max_load_factor)).
  * printing == printf("%g") on the float: 6 significant digits, trailing zeros stripped,
    style e iff X < -4 || X >= 6, correct rounding of the EXACT binary value with ties to even.
  * The port matched the reference binary on 1366 invocations (counts 0..1200, all growth
    boundaries up to 2^22, large counts, every std::stoi edge case, the abort paths) and the
    %g formatter matched glibc on 557188 float values at each of 16 precisions.

RULES FOR YOU
  * Do NOT edit anything under /output. Report findings; someone else applies fixes.
  * Scratch files go in /tmp. You may compile and run anything you like there.
  * A finding is only worth reporting if you can state a concrete input that makes the Rust
    port behave differently from the C++ binary, or a concrete latent defect (panic, overflow,
    wrong result for a plausible API use) in the library code.
  * Prefer running commands over reasoning about the code.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'findings', 'commandsRun', 'summary'],
  properties: {
    lens: { type: 'string' },
    summary: { type: 'string', description: 'What you checked and what you concluded.' },
    commandsRun: {
      type: 'integer',
      description: 'Roughly how many commands you actually executed.',
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'severity', 'category', 'repro', 'expected', 'actual', 'fix'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string', description: 'Repo-relative path, with a line number if known.' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          category: {
            type: 'string',
            enum: ['output-fidelity', 'crash-or-panic', 'logic', 'requirements', 'quality', 'test-gap'],
          },
          repro: { type: 'string', description: 'Exact commands that demonstrate it.' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          fix: { type: 'string', description: 'The specific change you would make.' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'confidence', 'evidence'],
  properties: {
    isReal: { type: 'boolean' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    evidence: { type: 'string', description: 'The commands you ran and their actual output.' },
    correctedFix: { type: 'string', description: 'If the finding is real but the proposed fix is wrong, the right one.' },
  },
}

const LENSES = [
  {
    key: 'output-fidelity-fuzz',
    prompt: `Lens: OUTPUT FIDELITY, by brute force.

Write your own differential fuzzer in /tmp (shell or a gcc-compiled C driver — no python here)
and hammer both binaries with it. Cover at minimum:
  * a deterministic pseudo-random sweep of a few thousand counts drawn from 0..3000000, biased
    towards small values and towards trunc(2^k * 0.9) boundaries
  * random junk argv[1] values (including ones that differ from "--a" by one byte, embedded NULs
    are impossible via execve so skip those, but do try trailing whitespace, unicode, very long
    strings, strings containing '=' and '-')
  * random junk argv[2] values: random ASCII, huge digit strings, leading whitespace of every
    isspace() flavour, signs, mixed alphanumerics, empty
  * zero, one, two, three, and ten arguments
Compare stdout, stderr and exit status. Report ANY divergence with the exact argv.
Report how many invocations you compared.`,
  },
  {
    key: 'g-format-adversarial',
    prompt: `Lens: THE %g FORMATTER (/output/cxx/ostream.rs and /output/cxx/bigdec.rs).

This is the highest-risk code: a from-scratch reimplementation of glibc's %g including exact
ties-to-even rounding via a big-integer decimal expansion. Try hard to break it.

Independently build your own corpus (do not just rerun /output/tools/gen_corpus.c — write your
own, with different coverage) and replay it through the Rust formatter using
/output/tools/check_g.rs (or your own harness). Target:
  * exact decimal ties at every precision from 1 to 20, especially where the tie digit sits at a
    carry boundary (e.g. ...995, ...9995, 0.999999_5)
  * carry propagation that adds a digit and shifts the exponent (999999.5, 9.999999e-5,
    0.00009999995) and therefore changes the e-vs-f style choice
  * subnormals, FLT_MIN, FLT_MAX, 2^-149, values needing 100+ exact decimal digits
  * negative zero, negative values, inf, nan, and negative nan
  * precision 0 and precision far beyond the exact digit count
  * the exponent field width (e+06 vs e+100 vs e-05)
Also verify independently, by compiling a C++ program, that libstdc++'s
'std::cout << aFloat' really does agree with printf("%g", (double)aFloat) for a large sample —
if it ever disagrees, the port is anchored to the wrong reference.
Report every input where the Rust output differs from glibc.`,
  },
  {
    key: 'container-invariants',
    prompt: `Lens: THE HOPSCOTCH TABLE (/output/tsl/hopscotch_hash.rs, growth_policy.rs, hash.rs).

The program only ever observes load_factor(), but the module is a real container and must not be
quietly broken. Write Rust test programs in /tmp that pull the modules in with
  #[path = "/output/tsl/mod.rs"] mod tsl;
(or copy the tree to /tmp and add tests) and attack:
  * Every inserted key must be findable afterwards, and len() must equal the number of distinct
    keys, across adversarial hash patterns: all keys colliding on one home bucket, keys strided
    by the bucket count, keys forcing the neighborhood-displacement path
    (swap_empty_slot_closer), and keys forcing the overflow list.
  * Elements must survive rehash() in both directions (grow and shrink), including elements that
    were sitting in the overflow list, and the overflow bit bookkeeping must not go stale (a
    lookup that scans overflow when it should not, or fails to when it should).
  * Duplicate inserts must not double-count. Removing is not implemented — confirm nothing
    pretends otherwise.
  * Panics/overflow: indexing past buckets, 'islot + 1 - NEIGHBORHOOD_SIZE' underflow,
    '1u64 << (islot - home)' shifting by >= 64, usize overflow in
    round_up_to_power_of_two / next_bucket_count / bucket_count + NEIGHBORHOOD_SIZE - 1,
    'as usize' on a NaN or huge f32 in compute_load_threshold / required_bucket_count,
    and set_max_load_factor(0.0) or a negative or NaN factor.
  * Non-integer key types (String, tuples, enums) and a custom BuildHasher.
Report anything that panics, loses an element, or returns a wrong answer.`,
  },
  {
    key: 'stoi-and-abort-path',
    prompt: `Lens: std::stoi AND THE ABORT PATH (/output/cxx/stoi.rs, terminate.rs, argv.rs).

Attack the parser and the failure path:
  * Compile a small C++ program that calls std::stoi on a corpus of strings and prints either the
    value or which exception it threw. Compile a Rust program that runs the same corpus through
    /output/cxx/stoi.rs. Diff them over thousands of generated strings: every isspace flavour,
    multiple signs, "+-5", "--5", digits then sign, exactly INT_MIN/INT_MAX and one either side,
    LONG_MIN/LONG_MAX boundaries, 40-digit numbers, "0", "-0", huge leading-zero runs, embedded
    NULs are impossible through argv so skip them, non-ASCII bytes, and the empty string.
  * Verify the abort path byte for byte: 'od -c' the stderr of both binaries for the
    missing-argv[2], invalid_argument and out_of_range cases, and confirm the exit status and the
    signal (should be SIGABRT / status 134) match, and that stdout stays empty.
  * Check argv handling: what happens with a non-UTF-8 argv[1] or argv[2] (the port uses
    args_os for this reason — confirm it actually works and that a UTF-8 argument behaves
    identically), and with argv[0] alone.
Report every divergence.`,
  },
  {
    key: 'requirements-and-build',
    prompt: `Lens: REQUIREMENTS AND BUILD HYGIENE.

Verify mechanically, not by reading prose:
  * 'cd /output && cargo build --release' and 'cargo test --release' both succeed from clean
    (try 'cargo clean' first, and also 'cargo build' without --release).
  * 'cd /output && rustc --edition 2021 -O test11.rs -o /tmp/t11' succeeds and the result behaves
    identically to the cargo binary. Also try plain 'rustc test11.rs' with no flags — the task
    statement names exactly that command, so it must work, and note the edition default of the
    installed rustc (1.75) and whether the code depends on the 2021 edition being selected.
  * Zero dependencies: grep Cargo.toml, confirm no [dependencies] entries, no Cargo.lock pulling
    anything, no 'extern crate', and that no module uses anything but std.
  * Warnings: build with 'RUSTFLAGS="-D warnings" cargo build --release' and with
    'cargo clippy' if clippy is installed. Report every warning, and note whether the
    '#![allow(dead_code)]' attributes are hiding anything that is genuinely unreachable.
  * An executable exists in /output and is current with the sources (rebuild and compare).
  * The module layout matches requirement 5 (library code in modules, entry at the package root).
  * Anything in /output that should not ship, or anything missing (e.g. a README explaining the
    layout, or a .gitignore for target/).
Report concrete problems only.`,
  },
  {
    key: 'code-quality',
    prompt: `Lens: CODE QUALITY AND SIMPLIFICATION — no bug hunting, only whether this reads like
good, idiomatic, honest Rust that a reviewer would merge.

Read /output/test11.rs, /output/cxx/*.rs, /output/tsl/*.rs and judge:
  * Is there duplicated logic that should be shared, or an abstraction that earns nothing?
  * Are the comments explaining WHY (non-obvious C++ semantics, rounding rules, threshold
    truncation) rather than restating the code? Flag any comment that is wrong, stale, or
    merely narrates. Flag any place where a tricky invariant is NOT explained.
  * Do the names and the module split match what a Rust reviewer would expect? Is anything
    misplaced?
  * Is any claim in a doc comment or test name overstated relative to what is actually verified?
    (Be strict here: an assertion of exactness that has not been demonstrated is a defect.)
  * Are the tests meaningful — would they actually fail if the corresponding logic broke? Name
    any test that would pass even if its subject were deleted or inverted. Are there obvious
    gaps? Try mutating a constant in a copy under /tmp and check the tests catch it.
  * Any dead code, needless allocation in a hot loop, or clumsy construct worth simplifying.
Report specific, actionable items with file and line. Do not report style preferences that
rustfmt would not change and that a reviewer would not raise.`,
  },
]

phase('Review')

const results = await pipeline(
  LENSES,
  (lens) => agent(`${CONTEXT}\n\n${lens.prompt}`, {
    label: `review:${lens.key}`,
    phase: 'Review',
    schema: FINDINGS_SCHEMA,
  }),
  (report, lens) => {
    if (!report || !report.findings.length) return { lens: lens.key, report, verified: [] }
    return parallel(report.findings.map((f) => () =>
      agent(`${CONTEXT}

You are verifying ONE claimed finding from the "${lens.key}" review. Your default position is
that it is WRONG. Reproduce it yourself with real commands before you accept it.

  TITLE:    ${f.title}
  FILE:     ${f.file}
  SEVERITY: ${f.severity}
  CATEGORY: ${f.category}
  REPRO:    ${f.repro}
  EXPECTED: ${f.expected}
  ACTUAL:   ${f.actual}
  PROPOSED FIX: ${f.fix}

Set isReal=false if: the repro does not reproduce; the "expected" behaviour is not in fact what
the C++ binary does (check it); the claim is about code that cannot be reached from any input;
or it is a style opinion dressed up as a defect. For a quality/test-gap finding, isReal=true only
if a reviewer would genuinely ask for the change. If the finding is real but the proposed fix is
wrong or incomplete, say so in correctedFix. Quote the actual command output as evidence.`,
        { label: `verify:${lens.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then((v) => ({ finding: f, verdict: v }))
    )).then((verified) => ({ lens: lens.key, report, verified: verified.filter(Boolean) }))
  }
)

const out = results.filter(Boolean)
const confirmed = []
for (const r of out) {
  const real = r.verified.filter((v) => v.verdict && v.verdict.isReal)
  log(`${r.lens}: ${r.report ? r.report.findings.length : 0} claimed, ${real.length} confirmed (${r.report ? r.report.commandsRun : 0} commands run)`)
  for (const v of real) confirmed.push({ lens: r.lens, ...v.finding, verdict: v.verdict })
}

return {
  confirmed,
  summaries: out.map((r) => ({ lens: r.lens, summary: r.report ? r.report.summary : 'agent returned nothing' })),
}
