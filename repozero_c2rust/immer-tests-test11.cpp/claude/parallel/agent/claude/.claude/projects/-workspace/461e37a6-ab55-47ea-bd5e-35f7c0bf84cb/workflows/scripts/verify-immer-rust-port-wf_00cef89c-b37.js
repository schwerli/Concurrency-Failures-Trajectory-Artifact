export const meta = {
  name: 'verify-immer-rust-port',
  description: 'Adversarially audit + differentially fuzz the Rust port of immer test11',
  phases: [
    { title: 'Audit', detail: '6 lenses: trie correctness, stoi fuzz, output fidelity, requirements, Rust soundness, scale fuzz' },
    { title: 'Verify', detail: 'each finding refuted or confirmed by 3 independent skeptics' },
    { title: 'Critic', detail: 'completeness critic: what was not checked' },
  ],
}

const RULES = `
## What exists

The C++ original is /workspace/dataset/immer/tests/test11.cpp and the compiled reference binary is /workspace/dataset/test11_executable (run it freely with any arguments to compare).

The Rust port under audit lives in /output:
- /output/test11.rs        entry file (the \`main\`), uses #[path] to pull in modules
- /output/src/immer/mod.rs, node.rs, vector.rs, iter.rs   persistent vector trie
- /output/src/cpp/mod.rs, stoi.rs, cint.rs, cli.rs        C++ semantics (std::stoi, int wrapping, argv)
- /output/Cargo.toml
- prebuilt binaries: /output/test11 (from \`rustc -O test11.rs\`) and /output/target/release/test11 (from cargo)

## Requirements the port must satisfy

1. Pure Rust, 2021 edition, compiles with rustc or as a Cargo project.
2. Same CLI as the C++ binary: one optional positional arg n, default 11, parsed from std::env.
3. Algorithm logic, numeric precision and formatting must match exactly; stdout must be byte-for-byte identical to the C++ program's.
4. ZERO external crates — std only. Everything implemented from scratch.
5. Complete Cargo project in /output, library code organized into modules, entry file at /output/test11.rs.
6. Black-box re-implementation: the immer library source must NOT be consulted (it is not present).
7. An executable must be produced.

## Hard rules for you

- READ-ONLY on /output and /workspace/dataset: do NOT edit, create or delete any file there. Write scratch files ONLY under /tmp/<your-own-subdir>.
- You MAY compile and run things (rustc, cargo, the reference binary) — building scratch programs in /tmp that \`#[path]\`-include /output/src modules is encouraged.
- \`cargo\` commands inside /output would write to /output/target; that is acceptable (it already exists), but do not touch source files.
- Report only defects you have actually demonstrated or can pin to specific lines. Include the exact command and observed output for each.
- Empty findings list is a perfectly good answer if the code is correct.
`;

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    what_i_ran: { type: 'array', items: { type: 'string' }, description: 'Commands actually executed' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string', description: 'Concrete inputs/state -> wrong observable behaviour, with the command and output that shows it' },
          suggested_fix: { type: 'string' },
        },
        required: ['id', 'severity', 'file', 'summary', 'failure_scenario'],
      },
    },
    checks_that_passed: { type: 'array', items: { type: 'string' } },
  },
  required: ['lens', 'what_i_ran', 'findings', 'checks_that_passed'],
}

phase('Audit')

const LENSES = [
  {
    key: 'trie-correctness',
    prompt: `You are auditing the PERSISTENT VECTOR TRIE for correctness: /output/src/immer/vector.rs, node.rs, iter.rs.

Your job is to BREAK it. The driver program only prints sums, which are order-insensitive, so element *placement* bugs could hide — attack that directly.

Specifically scrutinise and empirically test:
1. \`tail_offset()\` = \`((size-1) >> BITS) << BITS\` for size < 32, == 32, == 33, and every multiple of 32.
2. \`is_root_full()\` = \`(size >> BITS) > (1 << shift)\` — is the depth-growth trigger exactly right? Off by one either way would corrupt placement or waste a level. Derive it and test the exact boundaries (1055/1056/1057, 32799/32800/32801, and the next one up ~1048576+).
3. \`push_leaf\` subidx arithmetic \`((size - 1) >> level) & MASK\`, the descend-vs-append decision, and the level==BITS base case.
4. \`new_path\` depth.
5. \`leaf_for\` / \`get\` radix descent, and \`i & MASK\` for the tail (is masking the tail index correct for ALL sizes, including when the tail starts at a non-multiple-of-32 index? prove it or break it).
6. The odometer iterator in iter.rs: correctness for empty vectors, vectors entirely in the tail, exactly-full leaves, after depth growth, and that it yields exactly size elements in index order. Also whether \`stack\` unwinding can skip or repeat a subtree.
7. \`update\` path copying and persistence.
8. Whether debug_assert!s can fire on any reachable input (a debug build must not panic). Test with a DEBUG build (no -O) as well as release.

Method: write scratch Rust programs in /tmp/trie/ that \`#[path = "/output/src/immer/mod.rs"] mod immer;\` and differentially compare against std::vec::Vec for many sizes (exhaustive 0..=3000, plus every size in a window around each structural boundary, plus randomised element values so misplacement cannot cancel out). Build BOTH with and without -O so debug_assert!s are active. Also verify structural sharing really happens (Rc::ptr_eq on untouched subtrees) and that old versions are never mutated.

Report every real defect with the reproducing command.`,
  },
  {
    key: 'stoi-fuzz',
    prompt: `You are auditing C++ \`std::stoi\` FIDELITY: /output/src/cpp/stoi.rs, as consumed by /output/test11.rs.

Differentially fuzz the Rust binary /output/test11 against /workspace/dataset/test11_executable on the FIRST ARGUMENT. For each candidate arg, compare stdout bytes, stderr bytes, and exit status.

Cover at least: empty string; only whitespace (each of space \\t \\n \\v \\f \\r, and combinations); signs (+, -, --5, +-5, "+ 5", "-", "+"); digit prefixes ("3abc", "12.9", "1e3", "0x10", "0b1", "007", "0", "-0", "1 2", "5-3"); non-ASCII and invalid UTF-8 bytes (use printf/bash $'\\xff' to build args like $'\\xff5', $'5\\xff', $'\\xc3\\xa95'); exact int limits (2147483647, -2147483648) and just past them (2147483648, -2147483649, 4294967296, 9223372036854775807, 9223372036854775808, 999999999999999999999, and a 400-digit number); underscores and thousands separators ("1_0", "1,000"); leading zeros with huge digit counts ("000000000000000000000000005"); tab/newline inside ("1\\t2"); a string of 100000 '9' characters.
IMPORTANT: values of n above a few million make BOTH programs slow — for the range-limit cases the interesting behaviour is the throw, which is immediate; for accepted huge n use \`timeout 20\` and compare "both timed out" rather than hanging.

Write a fuzz script in /tmp/stoifuzz/ that loops over a large generated corpus (include randomly generated byte strings, at least 2000 cases) and prints only mismatches. Report exactly which inputs diverge, if any.

Also read /output/src/cpp/stoi.rs and check the overflow-latching logic (u64 accumulation with a saturating flag) against strtol semantics, and the negative-limit special case (magnitude == 2147483648).`,
  },
  {
    key: 'output-fidelity',
    prompt: `You are auditing OBSERVABLE OUTPUT fidelity: does the Rust program produce byte-identical stdout to the C++ program in every situation?

Check:
1. Exact bytes for many n via \`cmp\` / \`od -c\` — including the no-argument default (n = 11), n = 0, negative n, and the wrap-around cases (46341, 65535, 65536, 92681, 100000, 1000000, 2000000).
2. Trailing newline presence and absence of \\r.
3. Behaviour when stdout is a PIPE vs a TTY vs a FILE vs \`/dev/full\` (write error) vs closed stdout (\`>&-\`). Does the Rust program's buffering/flushing produce the same bytes and exit status as the C++ one? \`std::endl\` flushes each line — compare interleaving of stdout and stderr when both are redirected to the same file (e.g. an aborting case where a partial line might be buffered).
4. Extra arguments beyond argv[1] must be ignored by both.
5. Locale sensitivity: run both under LC_ALL=C, LC_ALL=en_US.UTF-8, LC_NUMERIC=de_DE.UTF-8 — no thousands separators should ever appear.
6. Environment robustness: run with an empty environment (\`env -i\`), and check argv[0]-only invocation.
7. SIGPIPE: \`./prog 100 | head -c 1\` — compare behaviour/exit status of both binaries.
8. Whether the numeric formatting of negative values matches exactly.

Method: write /tmp/outfid/check.sh that automates all of the above over a matrix and reports only mismatches, with the exact bytes for each side. Be precise about which differences are genuine port defects versus unavoidable runtime differences (e.g. Rust's SIGPIPE handling) — classify the latter honestly, and say whether the graded stdout comparison would be affected.`,
  },
  {
    key: 'requirements',
    prompt: `You are auditing REQUIREMENTS COMPLIANCE of the deliverable in /output.

Verify each of these mechanically and report any that fail:
1. Zero external dependencies: no [dependencies] entries in Cargo.toml, no Cargo.lock referencing third-party crates, no \`extern crate\` of anything but std, no \`use\` of any non-std crate. Prove it (grep + read Cargo.toml + inspect Cargo.lock if present). Also confirm the build works with NO network access.
2. Edition 2021 is declared, and the project builds with \`cargo build --release\` from a clean state (try \`cargo clean && cargo build --release\` and report warnings verbatim — warnings are a quality defect worth reporting).
3. \`rustc test11.rs\` (bare, from /output, no flags) succeeds and produces a working executable — check this in a COPY of the tree under /tmp so you do not disturb /output. Note that bare rustc selects edition 2015; verify the sources compile under both editions and that the resulting binaries behave identically.
4. The entry file is at /output/test11.rs, library code is in modules under /output/src, and an executable exists at /output/test11.
5. \`cargo test\` and \`cargo test --release\` both pass, and the test suite is meaningful (not vacuous). Judge whether the tests would actually catch a regression: try MUTATING a copy of the source in /tmp (e.g. change \`(size >> BITS) > (1 << shift)\` to \`>=\`, change tail_offset's formula, change wrapping_mul to a plain mul, break the stoi negative limit) and confirm the copied test suite FAILS for each mutation. Report any mutation the tests do NOT catch — that is a test-coverage finding.
6. No file in /output reads or vendors immer's source, and there is no leftover scratch/debris (stray binaries, target/ is fine, but report anything unexpected).
7. The CLI accepts exactly the same arguments as the C++ binary — no extra flags like --help that would change behaviour.

Report findings with evidence. Mutation testing results are the most valuable part: be thorough there.`,
  },
  {
    key: 'rust-soundness',
    prompt: `You are auditing the Rust code for SOUNDNESS, PANIC-FREEDOM, RESOURCE USE and IDIOM: /output/test11.rs and everything under /output/src.

Check and empirically demonstrate:
1. Any reachable panic/unwrap/expect/index-out-of-bounds on any command line. Include \`unreachable!()\` in node.rs — argue whether it is truly unreachable.
2. Integer overflow: in a DEBUG build, does any arithmetic overflow-panic for large n (e.g. \`i + 1\`, \`size + 1\`, \`i * 7\`)? Build a debug binary in /tmp from a copy and run it with big n, negative n, and n = 2147483647 (use timeout).
3. Recursion depth: \`push_leaf\`, \`new_path\`, \`update_path\`, and the recursive \`Drop\` of the Rc trie. Can any input overflow the stack? Reason about maximum depth and test with the largest n that fits in memory/time.
4. Memory: peak RSS for n = 2000000 vs the C++ binary (use /usr/bin/time -v). Is there unbounded growth from keeping intermediate versions alive? Is the per-push tail clone the intended cost?
5. Performance: time both binaries for n = 100000, 1000000, 2000000, 5000000. Report the ratio. A large asymptotic gap (not a constant factor) would indicate an algorithmic defect — e.g. iteration being O(n log n) or push_back being O(n).
6. Warnings: compile with \`rustc -O -W unused -W dead_code\` and also \`RUSTFLAGS="-W warnings" cargo build --release\`, plus \`cargo clippy\` IF it is installed (do not install anything). Report every warning.
7. Idiom/quality: needless clones, unnecessary bounds, misleading doc comments, comments that contradict the code, dead code, over-broad visibility. Note anything where a doc comment states something the code does not do — that is a real finding.
8. \`Vector::iter\` lifetimes and the \`FusedIterator\`/\`ExactSizeIterator\` impls: are their contracts actually upheld (e.g. does \`len()\` stay consistent, does \`next()\` after exhaustion always return None)? Write tests to check.

Report defects with the command and output that shows each.`,
  },
  {
    key: 'scale-fuzz',
    prompt: `You are the SCALE DIFFERENTIAL FUZZER. Your only job is to find an n where the Rust binary /output/test11 and the C++ binary /workspace/dataset/test11_executable print different bytes.

Strategy:
1. Exhaustive sweep: EVERY integer n from 0 to 4000 inclusive. Compare stdout byte-for-byte. This is the most important check — automate it, do not sample.
2. Every structural boundary of a 32-way trie in a window of +-3: 32, 64, 1024, 1056, 1088, 32768, 32800, 33824, 1048576, 1048608, 1049632 (skip any that take longer than ~20s in either binary, and say which you skipped).
3. Wrap-around neighbourhoods: n where the first or second sum crosses an i32 boundary. Solve for them: first sum = n(n+1)/2 crosses 2^31 near n = 65535, and the doubled sum crosses near n = 46341; sweep +-40 around each, and around the second and third wraps (e.g. n near 92681, 113511, 131071, 160000, 185363).
4. Random sampling: 300 random n in [0, 3000000] (use \`shuf -i\`), with a timeout; compare bytes.
5. Negative and zero: every n from -100 to 0.

Write /tmp/scalefuzz/fuzz.sh that prints ONLY mismatches plus a final count of comparisons made. Report the total number of n values compared, any mismatch found (with n and both outputs), and the largest n you were able to compare within the time budget.`,
  },
]

const audits = await pipeline(
  LENSES,
  lens => agent(`${RULES}\n\n---\n\n${lens.prompt}`, { label: `audit:${lens.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (audit, lens) => {
    const findings = (audit && audit.findings) || []
    if (!findings.length) return { lens: lens.key, verified: [], passed: (audit && audit.checks_that_passed) || [], ran: (audit && audit.what_i_ran) || [] }
    return parallel(findings.map(f => () =>
      parallel(['does-it-reproduce', 'is-it-actually-wrong-vs-the-C++-reference', 'is-the-severity-and-scope-right'].map(angle => () =>
        agent(`${RULES}

You are an independent SKEPTIC verifying one claimed defect in the Rust port. Your angle: **${angle}**.

Claimed finding (from the "${lens.key}" audit):
${JSON.stringify(f, null, 2)}

Your task: try hard to REFUTE it. Re-run the claimed reproduction yourself from scratch; read the actual code at the cited location; check whether the claimed wrong behaviour really differs from what the C++ reference binary does (run it). Common reasons a finding is bogus: the behaviour actually matches C++; the code path is unreachable; the reproduction does not reproduce; the "bug" is in the auditor's scratch test rather than in /output; the claim is about style with no observable effect; the cited line does not say what the finding claims.

Default to refuted = true when you cannot demonstrate the defect yourself. Only set refuted = false if you personally reproduced a real, observable problem (or, for a non-observable code-quality claim, confirmed by reading that the code genuinely has the stated flaw).`, { label: `verify:${f.id}:${angle.slice(0, 12)}`, phase: 'Verify', schema: {
          type: 'object',
          properties: {
            refuted: { type: 'boolean' },
            reasoning: { type: 'string' },
            evidence: { type: 'string', description: 'Command(s) run and output observed' },
            corrected_severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit', 'not-a-defect'] },
          },
          required: ['refuted', 'reasoning', 'corrected_severity'],
        } })))
        .then(votes => {
          const real = votes.filter(Boolean)
          const survives = real.length > 0 && real.filter(v => !v.refuted).length >= Math.ceil(real.length / 2)
          return { finding: f, votes: real, survives }
        })
    )).then(judged => ({
      lens: lens.key,
      verified: judged.filter(Boolean).filter(j => j.survives),
      refuted: judged.filter(Boolean).filter(j => !j.survives).map(j => ({ id: j.finding.id, summary: j.finding.summary })),
      passed: (audit && audit.checks_that_passed) || [],
      ran: (audit && audit.what_i_ran) || [],
    }))
  },
)

const results = audits.filter(Boolean)
const confirmed = results.flatMap(r => (r.verified || []).map(v => ({ lens: r.lens, ...v.finding, votes: v.votes.map(x => ({ refuted: x.refuted, severity: x.corrected_severity, why: x.reasoning })) })))

phase('Critic')

const critic = await agent(`${RULES}

You are the COMPLETENESS CRITIC. Six audit lenses ran over the Rust port and their findings were adversarially verified. Here is what they did and what survived:

${JSON.stringify(results.map(r => ({ lens: r.lens, ran: r.ran, passed: r.passed, confirmed: (r.verified || []).map(v => v.finding), refuted: r.refuted })), null, 2)}

Your job: identify what was NOT checked and could still be wrong. Consider: behaviours of the C++ program nobody exercised; inputs nobody tried; requirements nobody verified mechanically; properties of the persistent vector nobody tested (e.g. aliasing, iterator invalidation analogues, equality/Debug impls, FromIterator, IntoIter); build configurations nobody tried (debug binary behaviour, \`cargo build\` without --release, \`cargo run --\`, building from a different working directory, \`rustc\` without -O, \`cargo test --release\`); and anything about byte-level output nobody confirmed.

Then ACTUALLY RUN the most valuable 5-10 of those missing checks yourself and report the results. Return real findings only, with evidence, plus the list of gaps you could not close and why.`, { label: 'critic:completeness', phase: 'Critic', schema: FINDINGS_SCHEMA })

return {
  confirmed_findings: confirmed,
  critic_findings: (critic && critic.findings) || [],
  critic_ran: (critic && critic.what_i_ran) || [],
  per_lens: results.map(r => ({ lens: r.lens, confirmed: (r.verified || []).length, refuted: (r.refuted || []).length, passed_checks: (r.passed || []).length })),
}
