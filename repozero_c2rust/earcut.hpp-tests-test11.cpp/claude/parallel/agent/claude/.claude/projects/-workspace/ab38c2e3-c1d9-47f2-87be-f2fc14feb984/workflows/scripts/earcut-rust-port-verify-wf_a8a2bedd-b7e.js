export const meta = {
  name: 'earcut-rust-port-verify',
  description: 'Exhaustively differential-test and adversarially review the Rust port of the C++ earcut test11 program',
  phases: [
    { title: 'Sweep', detail: 'parallel black-box differential testing of the Rust binary vs the C++ reference' },
    { title: 'Review', detail: 'adversarial source review across algorithm/numerics/CLI/packaging lenses' },
    { title: 'Verify', detail: 'refute-by-default verification of every reported finding, by execution' },
    { title: 'Critic', detail: 'completeness critic: what was never tested or never read' },
  ],
}

const GROUND_RULES = `
CONTEXT
- Task: a C++ program /workspace/dataset/test11.cpp (uses the mapbox earcut.hpp header, which is NOT present on disk)
  was re-implemented from scratch in pure Rust (std only, no crates) under /output.
- Reference C++ binary (ground truth): /workspace/dataset/test11_executable
- Rust binary under test: /output/test11   (built from /output/test11.rs with: cd /output && rustc -O test11.rs -o test11)
- Rust sources: /output/test11.rs, /output/cli.rs, /output/gear.rs, /output/earcut/{mod,node,geom,zorder,triangulate}.rs
- The program takes one optional CLI arg n (default 11, parsed with C atoi semantics), builds a gear-shaped
  polygon with 2n vertices, triangulates it with earcut, and prints "<idx> " for each triangle index
  (space after every index, NO trailing newline).
- Requirement: the Rust stdout must be BYTE-FOR-BYTE identical to the C++ stdout for the same argv.

HARD RULES
- DO NOT modify, delete, rebuild or write anything under /output. It is READ-ONLY for you.
  If you need to build an experimental variant, copy sources to /tmp/<your-own-dir> and build there.
- Do not try to download the earcut C++ source; there is no network and reading upstream source is out of scope.
  Treat the C++ binary purely as a black box oracle.
- Always guard reference-binary runs with a timeout, e.g. \`timeout 60 /workspace/dataset/test11_executable 5000\`.
  Very large n (e.g. > ~500000) can run for minutes; do not hang the workflow.
- Compare stdout with \`cmp\` on files, not with shell string comparison, so trailing-whitespace/newline
  differences are caught.
- There is a ready-made harness: /workspace/difftest.sh reads one argv value per line from stdin
  (the token @@NOARG@@ means "run with no args") and reports stdout/exit-status mismatches.
  Example: \`seq 400 600 | /workspace/difftest.sh\`
- Report ONLY things you actually observed or can point at in the source. No speculation presented as fact.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'coverage'],
  properties: {
    coverage: { type: 'string', description: 'What you actually ran/read, concretely' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'location', 'detail', 'repro'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          location: { type: 'string', description: 'file:line or file:function' },
          detail: { type: 'string', description: 'Why this is a real divergence from the C++ behaviour or a real defect' },
          repro: { type: 'string', description: 'Exact command(s) that demonstrate it, or "static-only" if not executable' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'confidence', 'evidence', 'recommended_fix'],
  properties: {
    real: { type: 'boolean', description: 'true only if you could NOT refute it' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence: { type: 'string', description: 'Commands you ran and their actual output' },
    recommended_fix: { type: 'string', description: 'Minimal precise fix, or "none" if not real' },
  },
}

// ---------------------------------------------------------------- Sweep -----
phase('Sweep')

const SWEEPS = [
  {
    label: 'sweep:n301-900',
    prompt: `Differential-test every integer n from 301 to 900 inclusive: \`seq 301 900 | /workspace/difftest.sh\`.
Report any mismatch with the exact n and the first differing byte offset. Also spot-check 3 of those n values
by hand with cmp against the reference to confirm the harness itself is sound (deliberately verify the harness
can actually detect a difference, e.g. by diffing reference output for n=5 against reference output for n=6).`,
  },
  {
    label: 'sweep:n901-2000',
    prompt: `Differential-test every integer n from 901 to 2000 inclusive using /workspace/difftest.sh.
Report mismatches precisely. Note the wall-clock time of the slowest case for each binary.`,
  },
  {
    label: 'sweep:large-sampled',
    prompt: `Differential-test larger n: all of 2001..2100, then a spread of larger sizes
(e.g. 3000, 4096, 5000, 7500, 10000, 16384, 20000, 32768, 50000, 65536, 100000) — use timeout 300 per run and
compare with cmp on files. Record wall-clock timings for both binaries at 10000/50000/100000 and report whether
the Rust version is pathologically slower. Report ANY output mismatch. If a size is too slow for the C++ oracle,
say so explicitly rather than silently skipping it.`,
  },
  {
    label: 'sweep:hash-threshold',
    prompt: `The C++ earcut switches to z-order hashed ear tests once the total vertex count exceeds 80.
The gear has 2n vertices, so the switch should happen around n=41. Exhaustively diff n=1..60 and, separately,
reason about and empirically confirm exactly where the behaviour switches: find the smallest n where the
reference output differs from what a non-hashed algorithm would produce, if observable. Concretely: verify
n=39,40,41,42 match byte-for-byte, and report the exact vertex counts involved. Also confirm the very small
degenerate cases n=0,1,2 produce byte-identical (possibly empty) output and exit status 0.`,
  },
  {
    label: 'sweep:cli-fuzz',
    prompt: `Fuzz the command line argument handling. Compare /output/test11 against the reference for AT LEAST these
argv[1] values, byte-for-byte on stdout AND exit status AND stderr:
no argument at all; "" (empty string); "0"; "-0"; "+0"; "-1"; "-7"; "007"; "  7"; "\\t7"; "\\n7"; "7  ";
"7abc"; "abc"; "abc7"; "3.9"; "-3.9"; "0x10"; "010"; "1e3"; "+ 7"; "- 7"; "--7"; "++7";
"2147483647"; "2147483648"; "-2147483648"; "-2147483649"; "4294967296"; "4294967299"; "4294967337";
"9223372036854775807"; "9223372036854775808"; "-9223372036854775808"; "-9223372036854775809";
"99999999999999999999"; a string of 400 '9' digits; "0000000000000000000000005";
"9223372036854775807abc"; "-4294967293"; "  +11  ".
ALSO test extra arguments being present: e.g. \`prog 5 99\` and \`prog 5 abc\` (only argv[1] should matter).
Use a shell loop writing outputs to files and cmp'ing them. Beware: values that decode to a huge positive n
will hang — anything that decodes above ~200000 should be run with \`timeout 20\` and, if BOTH binaries time out,
recorded as "both hang (consistent)" rather than a mismatch. Report every discrepancy with the exact argv.`,
  },
  {
    label: 'sweep:byte-exactness',
    prompt: `Verify byte-level output equivalence properties beyond content:
1. For n=5 and n=11 and n=41, hexdump both outputs and confirm identical trailing bytes (there must be a trailing
   space and NO trailing newline).
2. Confirm stderr is empty for both binaries across a handful of args, and exit status is 0 in every case
   including n=0, n=-1, and a junk arg.
3. Confirm output is identical when stdout is a pipe vs a regular file vs /dev/null (i.e. no buffering-dependent
   difference), for n=200.
4. Confirm locale independence: run both under LC_ALL=C, LC_ALL=C.UTF-8, LC_ALL=de_DE.UTF-8 (if available) and
   LANG unset, for n=1234 — the integers must never be printed with thousands separators by either binary.
5. Confirm behaviour when stdout is closed early (e.g. \`prog 2000 | head -c 10\`) does not make the Rust binary
   panic or print anything on stderr, and that exit status behaviour is not wildly different (SIGPIPE nuance:
   describe exactly what each binary does; a difference here is at most a minor finding).`,
  },
  {
    label: 'sweep:build-modes',
    prompt: `Verify the build/packaging requirements WITHOUT touching /output (copy the tree to /tmp/buildcheck first:
\`cp -r /output /tmp/buildcheck && rm -f /tmp/buildcheck/test11\`).
1. In /tmp/buildcheck: \`rustc test11.rs -o test11_plain\` (no -O) must succeed with no errors. Report all warnings verbatim.
2. \`cargo build\` (DEBUG, so integer-overflow and array-bounds checks are ON) must succeed; then differential-test the
   debug binary target/debug/test11 against the C++ reference for n in 0..120 and for n in {200, 500, 1000, 5000}.
   A debug-only panic (integer overflow, index out of bounds, shift overflow, unwrap) is a BLOCKER finding.
3. \`cargo build --release\` must succeed and its binary must also match for a sample of n.
4. Confirm zero external dependencies: inspect Cargo.toml and \`cargo tree\` output; grep all .rs files for
   \`extern crate\` and for any \`use\` of a non-std crate. Confirm edition 2021.
5. Report the exact list of files in /output and whether Cargo emits any warning about the package layout.
Report timings too. Do not leave /tmp/buildcheck in a broken state; it is scratch, that's fine.`,
  },
  {
    label: 'sweep:robustness',
    prompt: `Robustness / crash hunting on the Rust binary only (with the C++ binary as comparison where feasible):
1. Deep recursion: earcut recurses (earcutLinked passes, splitEarcut). Check whether large inputs can blow the
   Rust stack. Test n = 100000 and n = 200000 with \`ulimit -s 8192\` (default stack) and report RSS/time; a Rust
   stack overflow where the C++ binary succeeds is a BLOCKER.
2. Run the Rust binary under \`RUST_BACKTRACE=1\` for a spread of n and confirm no panic message ever appears.
3. Confirm there is no unbounded memory growth vs the C++ binary: compare \`/usr/bin/time -v\` (or ru_maxrss via
   bash \`time\`/\`\\time -v\` if available) peak RSS at n=50000 for both binaries; a >5x Rust regression is a finding.
4. Try n values that decode negative or zero via atoi and confirm instant clean exit.
Report only what you actually measured.`,
  },
]

const sweepResults = await parallel(
  SWEEPS.map((s) => () =>
    agent(`${GROUND_RULES}\n\nYOUR TASK (${s.label}):\n${s.prompt}\n\nReturn structured findings. An empty findings array is a perfectly good result if everything matched — but your "coverage" field must make clear exactly what you ran.`,
      { label: s.label, phase: 'Sweep', schema: FINDINGS_SCHEMA })
  )
)

// --------------------------------------------------------------- Review -----
const REVIEW_DIMENSIONS = [
  {
    key: 'core-algorithm',
    prompt: `Review /output/earcut/triangulate.rs for fidelity to the canonical earcut ear-clipping algorithm
(mapbox/earcut.hpp v2.2.x, which you should reconstruct from your own knowledge of the algorithm — do NOT claim to
read a file that does not exist). Focus on the parts that determine the EMITTED INDEX SEQUENCE:
- run(): the 80-vertex threshold loop, the early return when outerNode->prev == outerNode->next, ordering of
  eliminate_holes vs the hashing bbox computation.
- linked_list(): winding-order sum computation and the exact operand order, the forward/reverse insertion choice
  (\`clockwise == (sum > 0)\`), the duplicate-last-point removal, and vertex index numbering (must be the index into
  the flattened concatenated coordinate list).
- filter_points(): the do/while structure, that removal continues from p->prev, the \`p == p->next\` break, and that
  \`end\` tracks the removed node's prev.
- earcut_linked(): triangle emission order (prev, ear, next), the "skip the next vertex" advance to next->next for
  BOTH ear and stop, the pass 0/1/2 fallback ladder, and the loop-exit condition.
- is_ear(): the reflex early-out with >= 0, the scan range (ear->next->next up to but excluding ear->prev), and the
  \`area(p->prev,p,p->next) >= 0\` filter.
- remove_node(): must NOT clear the removed node's own prev/next (later code reads them).
For each concern, state whether it is a real behavioural divergence and how it would manifest. Prefer running the
binaries to prove a divergence over arguing about it.`,
  },
  {
    key: 'hashed-path',
    prompt: `Review the z-order hashed acceleration path: /output/earcut/zorder.rs plus index_curve, sort_linked,
is_ear_hashed and the bbox/inv_size setup in /output/earcut/triangulate.rs.
- z_order(): the (coord - min) * inv_size truncating cast, the bit-interleave masks, and the final \`x | (y << 1)\`.
  Check for any Rust/C++ divergence in the cast (Rust \`as i32\` saturates; C++ static_cast is UB when out of range) —
  can the argument ever be outside [0, 32767] here? Prove it from the inv_size formula.
- inv_size = 32767 / max(width, height), with the zero-size guard.
- index_curve(): the \`z = z ? z : zOrder(...)\` memoisation, the prevZ/nextZ initialisation and the list terminatation
  before sorting.
- sort_linked(): Simon Tatham merge sort — check pSize/qSize bookkeeping, the \`p->z <= q->z\` tie-break (stability
  matters for the traversal order!), the tail termination and the numMerges<=1 exit.
- is_ear_hashed(): the bbox min/max, the three traversal loops, the \`p != a && p != c\` exclusions, and whether the
  Morton range [minZ, maxZ] can ever exclude a point that lies inside the triangle bbox.
This path only activates for > 80 vertices (n >= 41), so validate empirically in that range.`,
  },
  {
    key: 'holes-and-fallbacks',
    prompt: `Review the code paths that the gear fixture may rarely or never exercise, for correctness as a faithful
port: eliminate_holes, eliminate_hole, find_hole_bridge, get_leftmost, split_earcut, split_polygon,
cure_local_intersections, is_valid_diagonal, intersects_polygon, and the predicates in /output/earcut/geom.rs
(area, equals, point_in_triangle, sign, on_segment, intersects, locally_inside, middle_inside,
sector_contains_sector).
Check each against the canonical earcut algorithm as you know it, paying attention to strict vs non-strict
comparisons, operand order, and the "special zero-length case" in is_valid_diagonal.
IMPORTANT: determine empirically whether these paths are reachable for this fixture at all. Write a small
instrumented COPY of the crate in /tmp (never touch /output) that prints to stderr whenever
cure_local_intersections / split_earcut / pass>=1 / eliminate_holes is entered, and run it over n=0..2000 to
report exactly which fallback paths fire and how often. That evidence decides how much these paths matter.`,
  },
  {
    key: 'numerics',
    prompt: `Review floating-point fidelity between the C++ source (/workspace/dataset/test11.cpp — you MAY read this
file, it is the test fixture, not the library) and /output/gear.rs plus /output/earcut/geom.rs.
- Point generation: C++ computes \`2.0 * M_PI * i / n\` and \`2.0 * M_PI * (i + 0.5) / n\` with int i and int n,
  then cos/sin, and \`0.7 * cos(angle2)\`. Confirm the Rust reproduces the exact same expression tree, association
  order, and int->double conversion points. Any reassociation (e.g. computing a step and accumulating) would be a
  blocker; confirm none exists.
- std::f64::consts::PI vs M_PI: prove they are the same bit pattern.
- cos/sin: Rust's f64::cos/sin lower to the platform libm on Linux, the same one the C++ binary calls. Verify
  empirically that the generated coordinates are bit-identical: write a tiny C program and a tiny Rust program in
  /tmp that print the raw 64-bit hex of cos/sin for the exact angles used at several n (including large n where
  argument reduction matters, e.g. n=100000) and compare. Check whether a C compiler is even available
  (\`which gcc g++ cc\`); if not, fall back to comparing the full triangulation output at large n as the proxy and
  say so.
- Check for any place where LLVM might constant-fold a sin/cos at compile time (only possible for compile-time
  constant arguments) — argue why that cannot happen here.
- geom.rs predicates: verify each arithmetic expression preserves the C++ operand order exactly, since
  (a*b - c*d) is not reassociable in IEEE terms. Check area(), point_in_triangle(), middle_inside().
- Confirm neither binary uses fused multiply-add contraction that the other does not (the reference binary contains
  no vfmadd instructions; you may check that with objdump on the BINARY, which is allowed).`,
  },
  {
    key: 'cli-and-io',
    prompt: `Review /output/cli.rs and /output/test11.rs against the C++ fixture /workspace/dataset/test11.cpp
(you MAY read that fixture).
- C++ does: \`int n = 11; if (argc > 1) n = std::atoi(argv[1]);\`. Verify the Rust default and the argc>1 condition
  match exactly, including when argv[1] is an empty string.
- atoi semantics: leading isspace() skipping (which characters exactly?), optional sign, digit run, stop at first
  non-digit, no errno, and the overflow behaviour (glibc atoi == (int)strtol, i.e. saturate to LONG_MAX/LONG_MIN then
  truncate to 32 bits). Verify the Rust matches for saturating AND non-saturating overflow cases; construct at least
  three adversarial inputs where naive i32 parsing would differ and check them against the reference binary.
- Locale: C's isspace is locale-dependent in theory; establish whether that could ever matter here.
- Output: C++ \`std::cout << idx << " "\` for uint32_t, no newline, no flush call, return 0. Verify the Rust matches
  byte-for-byte including the absence of a trailing newline, and that write errors are handled the same way
  (C++ silently sets badbit; the Rust must not panic).
- Verify \`std::env::args()\` is used as required, and reason about what happens with non-UTF-8 argv: does the Rust
  binary panic where C++ would not? Demonstrate it with a real non-UTF-8 argv (e.g. via a tiny helper that execs
  with a \\xff byte, or \`bash -c 'exec ...' \` with $'\\xff7'). Judge the severity honestly.`,
  },
  {
    key: 'rust-hazards',
    prompt: `Hunt for Rust-specific defects in /output (read every .rs file). Specifically:
- Arithmetic that can overflow in a DEBUG build (overflow checks on): shifts, additions, casts, negation of i32::MIN
  (note cli.rs negates into i64 — check the i64::MIN path), \`len - 1\`, \`in_size *= 2\` in sort_linked (can it overflow
  i32 for large inputs? what is the loop bound?), \`p_size\`/\`q_size\` counters.
- Any indexing that could panic (NIL == usize::MAX used as a sentinel — find every place a NIL could reach an index
  expression; sort_linked's final \`self.nodes[tail].next_z = NIL\` when tail is NIL is a classic).
- unwrap()/expect()/panic paths, including \`partial_cmp(...).unwrap()\` on NaN in eliminate_holes.
- Unbounded recursion (earcut_linked -> split_earcut -> earcut_linked) and stack depth.
- Infinite loops: every \`loop { ... }\` that walks a ring must be able to terminate; check the do-while translations
  in filter_points, cure_local_intersections, middle_inside, intersects_polygon, get_leftmost, find_hole_bridge.
- Two-phase-borrow reliance that could break on other rustc versions (e.g. \`self.method(self.field)\`,
  \`self.nodes.create(self.nodes[a].i, ...)\`) — is the code portable to a plain \`rustc\` invocation on 1.75 and later?
- Whether \`cargo clippy\` (if installed) or \`rustc -W warnings\` reports anything meaningful. Report warnings verbatim.
Prove reachability for anything you flag; an unreachable theoretical panic is at most a 'minor'.`,
  },
  {
    key: 'requirements-compliance',
    prompt: `Audit the deliverable against the literal task requirements. Read /workspace/dataset/test11.cpp and the
files under /output.
Requirements: (1) pure Rust, edition 2021, compiles with rustc or as a Cargo project; (2) same CLI args as the C++
binary (same names, defaults, required fields), parsed via std::env::args(); (3) algorithm/precision/formatting
identical, println!/stdout byte-for-byte identical; (4) ZERO external crates, std only; (5) a complete Cargo project
in /output with library code organised into MODULES and the entry file test11.rs in the package root /output;
(6) black-box reimplementation; (7) library files inside /output, entry file /output/test11.rs, and a compiled
executable produced by \`rustc test11.rs\` or \`cargo build --release\`.
Check each one and report gaps. Pay attention to the ambiguity in (7): it says "produce an executable at
/output/test11.rs" which literally collides with the source path — assess what artifacts currently exist
(\`ls -la /output\`, \`file\`-style checks via \`head -c 4 | xxd\`) and whether a grader looking for either
/output/test11 (executable) or /output/target/release/test11 would find it. Also confirm module organisation is
real (multiple modules, not one giant file) and that documentation/comments are sane and non-misleading.
Do not modify anything.`,
  },
]

const reviewResults = await pipeline(
  REVIEW_DIMENSIONS,
  (d) =>
    agent(`${GROUND_RULES}\n\nYOUR REVIEW DIMENSION (${d.key}):\n${d.prompt}\n\nReturn structured findings, most severe first. Only report what you can back with evidence.`,
      { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  (review, d) => {
    if (!review || !review.findings || review.findings.length === 0) return []
    return parallel(
      review.findings.map((f) => () =>
        agent(`${GROUND_RULES}

You are an adversarial verifier. A reviewer working on the "${d.key}" dimension reported the following finding about the Rust port:

  TITLE:    ${f.title}
  SEVERITY: ${f.severity}
  LOCATION: ${f.location}
  DETAIL:   ${f.detail}
  REPRO:    ${f.repro}

Your job is to REFUTE it. Default to refuted unless you can demonstrate the problem is real.
- If it claims an output divergence, RUN both binaries and cmp the bytes. A claim that does not reproduce is refuted.
- If it claims a panic/overflow/crash, build a debug copy in /tmp (cp -r /output /tmp/verify-${d.key}-\${RANDOM}) and
  actually trigger it. If you cannot trigger it, it is refuted (or downgrade it to a theoretical 'minor').
- If it claims a source-level divergence from the canonical earcut algorithm, decide whether it could EVER change the
  emitted index sequence for ANY input, not just the gear fixture. If it cannot, say so and mark it not real.
- If it is a requirements/packaging claim, check the filesystem yourself.
Set real=true ONLY if it survives. Give the exact commands you ran and their real output in "evidence".`,
          { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
          .then((v) => ({ dimension: d.key, finding: f, verdict: v }))
      )
    )
  }
)

const verified = reviewResults
  .flat()
  .filter(Boolean)
  .filter((r) => r && r.verdict && r.verdict.real)

const sweepFindings = sweepResults
  .filter(Boolean)
  .flatMap((r) => (r.findings || []).map((f) => ({ dimension: 'sweep', finding: f, verdict: null })))

// --------------------------------------------------------------- Critic -----
phase('Critic')

const critic = await agent(`${GROUND_RULES}

A verification effort just completed on the Rust port. Here is what was covered:

SWEEP COVERAGE:
${sweepResults.filter(Boolean).map((r, i) => `- ${SWEEPS[i] ? SWEEPS[i].label : 'sweep'}: ${r.coverage}`).join('\n')}

REVIEW DIMENSIONS RUN: ${REVIEW_DIMENSIONS.map((d) => d.key).join(', ')}

SURVIVING FINDINGS (${verified.length}):
${verified.map((v) => `- [${v.finding.severity}] ${v.finding.title} @ ${v.finding.location} :: ${v.verdict.recommended_fix}`).join('\n') || '(none)'}

UNVERIFIED SWEEP FINDINGS (${sweepFindings.length}):
${sweepFindings.map((v) => `- [${v.finding.severity}] ${v.finding.title} :: ${v.finding.detail}`).join('\n') || '(none)'}

YOUR JOB: be the completeness critic. What is STILL not covered? Think about:
- input space regions never exercised (which n ranges, which argv shapes)
- behavioural surfaces never checked (exit codes? stderr? environment? stdin? signals? concurrent runs?)
- code in /output that no reviewer read (list every .rs file and check each was covered by some dimension above)
- build/deployment surfaces (does the required executable actually exist and run from a different cwd? is it
  dynamically linked to something unusual? does it work when invoked via a relative path or symlink?)
- any assumption the sweeps made that could be wrong (e.g. that difftest.sh really detects differences)
Then GO AND TEST the top gaps yourself — actually run the commands, do not just list them. Report what you found.
Finish by giving a blunt verdict: is this port byte-for-byte equivalent to the C++ reference for all practically
reachable inputs, yes or no, and what residual risk remains.`,
  { label: 'completeness-critic', phase: 'Critic', schema: FINDINGS_SCHEMA })

return {
  sweepFindings,
  verifiedFindings: verified,
  totalReviewFindingsBeforeVerification: reviewResults.flat().filter(Boolean).length,
  critic,
}
