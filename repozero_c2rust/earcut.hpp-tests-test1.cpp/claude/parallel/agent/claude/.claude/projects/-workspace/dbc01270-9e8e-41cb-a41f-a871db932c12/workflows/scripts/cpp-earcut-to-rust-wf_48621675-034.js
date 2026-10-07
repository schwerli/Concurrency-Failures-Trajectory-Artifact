export const meta = {
  name: 'cpp-earcut-to-rust',
  description: 'Port mapbox earcut.hpp + test1.cpp to a dependency-free Rust Cargo project in /output, verified byte-for-byte against the C++ oracle',
  phases: [
    { title: 'Spec', detail: 'independent behavioral specs: earcut algorithm, CLI/atoi/format, edge cases' },
    { title: 'Implement', detail: '3 independent from-scratch Rust ports in /tmp/impl_{a,b,c}' },
    { title: 'Verify', detail: 'adversarial differential testing of each candidate vs the C++ binary' },
    { title: 'Judge', detail: 'score candidates on verified correctness + faithfulness + structure' },
    { title: 'Finalize', detail: 'assemble winning port into /output as a Cargo project, compile both ways' },
    { title: 'Review', detail: 'parallel compliance/correctness reviewers + completeness critic' },
    { title: 'Repair', detail: 'apply confirmed review findings and re-verify' },
  ],
}

// ---------------------------------------------------------------- shared brief
const FACTS = `
## Established ground truth (already verified by the orchestrator against the real C++ binary — trust this)

TARGET C++ PROGRAM: /workspace/dataset/test1.cpp (you MAY read this file).
  #include "../earcut.hpp"  -> the library source is NOT on disk and MUST NOT be sought out.
  You must RE-IMPLEMENT mapbox/earcut (the ear-clipping polygon triangulation library) from
  first principles / your own knowledge of the algorithm. Do not try to download or locate it.

ORACLE BINARY: /workspace/dataset/test1_executable  (compiled C++; run it with any args to compare)

DIFF HARNESS (already built, use it, do not modify it):
  /tmp/gt/difftest.sh <path-to-your-executable>
  -> runs 70 argument cases from /tmp/gt/args.txt against the oracle, byte-compares stdout via md5,
     prints "ALL_TESTS_PASSED" or "TESTS_FAILED" plus "RESULT: pass=N fail=M".
  The line "__NOARGS__" in args.txt means "invoke with no arguments".

WHAT test1.cpp DOES:
  n = 1; if (argc > 1) n = std::atoi(argv[1]);
  build ONE ring of n*3 points: for i in 0..n*3 { angle = 2.0 * M_PI * i / (n * 3); push (cos(angle), sin(angle)) }
  polygon = vector of rings, containing that single ring
  indices = mapbox::earcut<uint32_t>(polygon)
  for (idx : indices) std::cout << idx << " ";      // each index followed by ONE space
  return 0;                                          // NO trailing newline ever

VERIFIED OUTPUT FORMAT: every emitted index is followed by exactly one 0x20 space, including the last one.
  n=1 stdout is exactly the 6 bytes "1 2 0 ". Empty index list => zero bytes of output.
  Nothing else is printed. Nothing goes to stderr. Exit code 0.

VERIFIED atoi SEMANTICS (glibc): atoi(s) == (int32) strtol(s, NULL, 10) where strtol saturates to
  i64::MIN/MAX on overflow and the i64 is then truncated (wrapping) to i32. Confirmed samples:
    "abc" -> 0        "3x" -> 3        "1e3" -> 1       "3.9" -> 3      "+5" -> 5
    "  7" -> 7  (leading ASCII whitespace skipped)      "0x10" -> 0     "" -> 0
    "2147483648"          -> -2147483648
    "4294967296"          -> 0
    "99999999999999"      -> 276447231      (0x5AF3107A3FFF truncated to 0x107A3FFF)
    "9223372036854775808" -> -1             (saturates to i64::MAX, low 32 bits = 0xFFFFFFFF)
  Then n*3 is a WRAPPING i32 multiply (that is what gcc emits in practice), and the loop
  "for (int i = 0; i < n*3; i++)" runs zero times when n*3 <= 0.
  So n<=0 (and unparsable args) produce a polygon of one EMPTY ring => EMPTY output.

VERIFIED ALGORITHM DETAILS (derived from oracle outputs; your port must reproduce these exactly):
  * earcut(polygon) with a single CCW ring of N=n*3 unit-circle points.
  * linkedList(ring, clockwise=true) computes sum += (p_prev.x - p_cur.x) * (p_cur.y + p_prev.y)
    over the ring (prev = index i-1 wrapping). If (clockwise == (sum > 0)) the nodes are inserted
    in FORWARD index order 0..N-1, else in REVERSE order. It returns the LAST inserted node.
    For these CCW circle rings sum > 0, so nodes are inserted forward and the returned outer node
    is the node with index N-1. Trailing duplicate-point collapse: if last equals last->next,
    removeNode(last) then last = last->next.
  * Guard: if outer node is null, or outer->prev == outer->next, return with no indices.
  * area(p,q,r) = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);  a vertex is a candidate
    ear only when area(prev, ear, next) < 0 (i.e. strictly convex for this winding).
  * Ear emission order is (prev.i, ear.i, next.i), then removeNode(ear), then ear = next.next and
    stop = next.next ("skip the next vertex" heuristic). Loop condition: while (ear.prev != ear.next).
  * z-order hashing is enabled when the total point count > 80 (i.e. n >= 27). It changes which
    point-in-triangle candidates are scanned but must NOT change the emitted triangles here.
    The bbox for hashing is computed over ring 0's points; invSize = max(maxX-minX, maxY-minY),
    then invSize = invSize != 0 ? 32767/invSize : 0.
  * Confirmed oracle outputs:
      n=1 -> "1 2 0 "
      n=2 -> "4 5 0 0 1 2 2 3 4 4 0 2 "
      n=3 -> "7 8 0 0 1 2 2 3 4 4 5 6 6 7 0 0 2 4 4 6 0 "
      n=4 -> "10 11 0 0 1 2 2 3 4 4 5 6 6 7 8 8 9 10 10 0 2 2 4 6 6 8 10 10 2 6 "
      n=5 -> "13 14 0 0 1 2 2 3 4 4 5 6 6 7 8 8 9 10 10 11 12 12 13 0 0 2 4 4 6 8 8 10 12 12 0 4 4 8 12 "

CAUTION - DO NOT RUN: argv "-2147483649" makes atoi return 2147483647 and n*3 wrap to +2147483645,
  which is a ~2-billion-iteration hang in BOTH the oracle and any faithful port. It is deliberately
  excluded from args.txt. Never invoke either binary with it.

HARD REQUIREMENTS FOR THE FINAL DELIVERABLE (/output):
  1. Rust 2021 edition, compiles with plain \`rustc\` AND as a Cargo project.
  2. ZERO external crates. std only. No dev-dependencies either. Cargo.toml [dependencies] empty.
  3. CLI: parse std::env::args(). Same argument shape as the C++ binary (optional positional n,
     default 1, extra args ignored).
  4. stdout byte-for-byte identical to the C++ binary for every input.
  5. Library code organized into MODULES (not one monolithic file).
  6. Entry file at the package root: /output/test1.rs
  7. \`rustc test1.rs\` inside /output must succeed and yield the executable /output/test1.
`

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'pseudocode', 'pitfalls'],
  properties: {
    summary: { type: 'string', description: 'what this spec covers' },
    pseudocode: { type: 'string', description: 'precise language-agnostic pseudocode for the covered area' },
    pitfalls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['issue', 'why_it_diverges', 'how_to_get_it_right'],
        properties: {
          issue: { type: 'string' },
          why_it_diverges: { type: 'string' },
          how_to_get_it_right: { type: 'string' },
        },
      },
    },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'entry_file', 'modules', 'compiled', 'difftest_output', 'self_reported_pass', 'notes'],
  properties: {
    dir: { type: 'string' },
    entry_file: { type: 'string' },
    modules: { type: 'array', items: { type: 'string' } },
    compiled: { type: 'boolean' },
    difftest_output: { type: 'string', description: 'verbatim tail of /tmp/gt/difftest.sh output' },
    self_reported_pass: { type: 'boolean' },
    notes: { type: 'string', description: 'design decisions, algorithm coverage, known gaps' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'compiles', 'difftest_all_passed', 'difftest_result_line', 'fuzz_mismatches', 'zero_deps', 'faithfulness_score', 'blocking_problems', 'evidence'],
  properties: {
    dir: { type: 'string' },
    compiles: { type: 'boolean' },
    difftest_all_passed: { type: 'boolean' },
    difftest_result_line: { type: 'string' },
    fuzz_mismatches: { type: 'array', items: { type: 'string' }, description: 'args that produced differing stdout, empty if none' },
    zero_deps: { type: 'boolean' },
    faithfulness_score: { type: 'integer', description: '0-10: how completely the real earcut algorithm is ported (hashing, holes, filterPoints, cureLocalIntersections, splitEarcut)' },
    blocking_problems: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string', description: 'commands run and their key output' },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['winner_dir', 'rationale', 'grafts'],
  properties: {
    winner_dir: { type: 'string' },
    rationale: { type: 'string' },
    grafts: { type: 'array', items: { type: 'string' }, description: 'specific better ideas from the losing candidates that should be merged into the winner' },
  },
}

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'summary', 'failure_scenario', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocking', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const REFUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is NOT a real problem for this deliverable' },
    reasoning: { type: 'string' },
  },
}

// ============================================================ Phase 1: Spec
phase('Spec')

const SPEC_TASKS = [
  {
    key: 'algorithm',
    prompt: `You are writing an implementation spec for a from-scratch Rust re-implementation of the
mapbox earcut polygon triangulation library (the C++ header earcut.hpp). Cover the CORE ALGORITHM
in complete detail, from your own knowledge of how earcut works:

  - the doubly-linked Node representation (i, x, y, prev, next, prevZ, nextZ, z, steiner) and an
    arena/index-based way to model it in safe Rust without Rc/RefCell
  - linkedList(ring, clockwise), insertNode, removeNode, equals
  - eliminateHoles / eliminateHole / findHoleBridge / splitPolygon / getLeftmost (holes are unused by
    the test but the port should be faithful)
  - earcutLinked(ear, pass) including the exact ear-emission order, the "skip the next vertex"
    advance (ear = next.next; stop = next.next), and the pass 0/1/2 fallback chain
    (filterPoints -> cureLocalIntersections -> splitEarcut)
  - isEar and isEarHashed (including the bidirectional prevZ/nextZ walk and the two tail loops),
    pointInTriangle, area, sign, isValidDiagonal, locallyInside, middleInside, intersects,
    intersectsPolygon, onSegment
  - indexCurve, sortLinked (the iterative bottom-up merge sort on the z chain), zOrder
  - filterPoints, cureLocalIntersections, splitEarcut
  - the exact top-level operator(): threshold/len accumulation loop, the \`len > 80\` gate for
    enabling z-order hashing, bbox + invSize computation

Be explicit about EVERY comparison operator and sign convention (>= vs >, < vs <=), since a single
flipped comparison changes the emitted triangle order. State clearly which node the top-level
returns and which node earcutLinked starts from.

${FACTS}

Return the spec as precise pseudocode plus a pitfalls list. Do NOT write Rust files; this is a spec only.`,
  },
  {
    key: 'cli-format',
    prompt: `You are writing an implementation spec for the CLI + numeric + output-formatting layer of a
Rust program that must be byte-for-byte identical to a C++ program's stdout.

Cover exhaustively:
  - a faithful pure-std Rust reimplementation of C-library atoi for argv[1] (optional leading ASCII
    whitespace, optional +/- sign, decimal digits only, stop at first non-digit, i64 saturation then
    wrapping truncation to i32, 0 when no digits). Include a table of test vectors.
  - std::env::args() handling: argc>1 detection in Rust terms (args().count() > 1 / nth(1)),
    default n = 1, extra args ignored, and what happens with non-UTF8 argv (consider args_os).
  - wrapping i32 arithmetic for n*3 and the "loop runs zero times when n*3 <= 0" behaviour.
  - reproducing \`angle = 2.0 * M_PI * i / (n * 3)\` exactly: M_PI vs std::f64::consts::PI,
    the exact order of operations (2.0 * PI * (i as f64)) / ((n*3) as f64), int-to-double conversion,
    and why f64::cos/f64::sin in Rust on linux-gnu match glibc's cos/sin bit-for-bit.
  - printing: \`std::cout << idx << " "\` for u32 == Rust \`{} \` per element with no trailing newline;
    how to write it with a locked+buffered stdout so it is fast for millions of indices AND emits
    identical bytes; the need to flush.
  - Cargo project layout that satisfies BOTH \`rustc test1.rs\` (standalone, from /output) and
    \`cargo build --release\`, with library code split across modules under /output/src/ and the entry
    file at /output/test1.rs. Give the exact Cargo.toml and the exact module-declaration strategy
    (explicit #[path = "src/xxx.rs"] mod declarations in test1.rs so it also works under rustc, while
    src/lib.rs re-declares the same modules as \`pub mod\` for the lib target). Explain how the
    modules should refer to each other so BOTH targets compile (crate:: paths).

${FACTS}

Return the spec as precise pseudocode/config plus a pitfalls list. Do NOT write Rust files; spec only.`,
  },
  {
    key: 'edge-cases',
    prompt: `You are the edge-case and numerical-robustness analyst for a C++ -> Rust port. Your job is to
enumerate every input or numerical situation where a naive Rust port would diverge from the C++ oracle,
and to prescribe the test matrix.

Investigate empirically by RUNNING the oracle /workspace/dataset/test1_executable with many arguments
(it is safe and fast for |n| <= ~5000; NEVER pass "-2147483649" - see the caution below). Study:
  - n = 0, negative n, non-numeric argv, empty-string argv, whitespace argv, no argv at all
  - the n >= 27 boundary where z-order hashing turns on (81 points) - confirm the emitted triangles
    are unchanged across that boundary, and explain why
  - large n (100, 1000, 2000, 5000): does the emitted pattern stay "cut every other vertex"? At what
    n, if ever, do three consecutive unit-circle points become numerically collinear or reflex under
    area(p,q,r) = (q.y-p.y)*(r.x-q.x) - (q.x-p.x)*(r.y-q.y) in f64, which would push earcut into its
    filterPoints / cureLocalIntersections / splitEarcut fallback passes? Compute this analytically AND
    check it against the oracle.
  - whether any two adjacent generated points can ever compare exactly equal (triggering earcut's
    duplicate-point collapse), and at what n
  - u32 index type: any overflow risk
  - output size: for large n the stdout is megabytes - note the performance requirement
  - argv parse vectors that exercise atoi saturation without causing a hang

Produce a concrete, prioritized list of arguments that MUST be diff-tested, beyond the 70 already in
/tmp/gt/args.txt (read that file), and for each say what specifically it is probing.

${FACTS}

Return your analysis as pseudocode-free prose in \`pseudocode\` (the test matrix) plus a pitfalls list.
Do NOT write any Rust implementation files.`,
  },
]

const specs = await parallel(SPEC_TASKS.map((t) => () =>
  agent(t.prompt, { label: `spec:${t.key}`, phase: 'Spec', schema: SPEC_SCHEMA })
    .then((s) => (s ? { key: t.key, ...s } : null))
))

const goodSpecs = specs.filter(Boolean)
log(`specs complete: ${goodSpecs.map((s) => s.key).join(', ')}`)

const SPEC_BUNDLE = goodSpecs.map((s) => `
================= SPEC: ${s.key} =================
${s.summary}

--- pseudocode ---
${s.pseudocode}

--- pitfalls ---
${(s.pitfalls || []).map((p, i) => `${i + 1}. ${p.issue}\n   diverges because: ${p.why_it_diverges}\n   correct approach: ${p.how_to_get_it_right}`).join('\n')}
`).join('\n')

// ==================================== Phase 2+3: Implement -> Verify (pipeline)
const CANDIDATES = [
  {
    id: 'a',
    dir: '/tmp/impl_a',
    angle: `STYLE MANDATE: maximum faithfulness. Port the ENTIRE earcut library surface - holes,
z-order hashing with the full sortLinked merge sort, filterPoints, cureLocalIntersections,
splitEarcut, isValidDiagonal, findHoleBridge, splitPolygon - even the parts this test never
exercises. Use an index-based arena (Vec<Node> + usize handles, usize::MAX as null) so the
doubly-linked list is safe Rust with no unsafe, no Rc, no RefCell.`,
  },
  {
    id: 'b',
    dir: '/tmp/impl_b',
    angle: `STYLE MANDATE: correctness-by-construction and clean module boundaries. Design the port as
small, individually testable modules with #[cfg(test)] unit tests for the primitive predicates
(area, point_in_triangle, sign, intersects, z_order, sort_linked) and for the atoi reimplementation.
Still port the complete algorithm including hashing and the pass-1/2 fallbacks, but prioritize
readable, well-documented Rust that a reviewer can check line-by-line against the spec. Use a
generic point trait or generic index type where it costs nothing.`,
  },
  {
    id: 'c',
    dir: '/tmp/impl_c',
    angle: `STYLE MANDATE: performance plus faithfulness. The oracle must be matched byte-for-byte, but
also make it fast for large n (n=5000 means 15000 points and megabytes of stdout): preallocate the
node arena, write output through a manually buffered writer (BufWriter with a large capacity, or
build the byte string with a hand-rolled u32-to-decimal formatter) and avoid per-index allocations.
Port the complete algorithm including hashing and the pass-1/2 fallbacks.`,
  },
]

phase('Implement')

const verdicts = await pipeline(
  CANDIDATES,

  // ---- stage 1: implement
  (c) => agent(
`Implement a complete, dependency-free Rust re-implementation of the mapbox earcut triangulation
library plus the test1 driver program, in a FRESH standalone directory.

WORK DIRECTORY: ${c.dir}
  Create it (mkdir -p). Put the entry file at ${c.dir}/test1.rs and library modules under ${c.dir}/src/.
  This is a scratch candidate; a later stage assembles the real deliverable in /output. Do NOT write
  anything into /output. Do NOT modify anything under /workspace or /tmp/gt.

${c.angle}

${FACTS}

Design specs produced by the spec phase — follow them, and if two specs conflict, prefer the one that
is consistent with the oracle's actual behaviour (test it):
${SPEC_BUNDLE}

BUILD AND SELF-VERIFY (mandatory, iterate until green):
  1. cd ${c.dir} && rustc -O test1.rs -o ${c.dir}/test1     # must compile with ZERO errors
     Fix all warnings too (or silence them deliberately with a justified allow).
  2. bash /tmp/gt/difftest.sh ${c.dir}/test1
     Iterate on your code until it prints ALL_TESTS_PASSED. Read the MISMATCH diffs it prints.
  3. Additionally spot-check by hand against the oracle with several args of your own choosing,
     including a byte-exact check: cmp <(/workspace/dataset/test1_executable 5) <(${c.dir}/test1 5)
     and confirm there is no trailing newline: ${c.dir}/test1 1 | xxd   (must be exactly "1 2 0 ").
  4. Also verify the modular structure requirement: library logic lives in multiple files under
     ${c.dir}/src/, declared from test1.rs via explicit #[path = "src/....rs"] mod items so that a
     bare \`rustc test1.rs\` works, and mirrored by a ${c.dir}/src/lib.rs with \`pub mod\` items.
     Also create ${c.dir}/Cargo.toml (edition 2021, empty [dependencies], [lib] path="src/lib.rs",
     [[bin]] name="test1" path="test1.rs") and confirm \`cargo build --release --offline\` succeeds
     in ${c.dir} (set CARGO_TARGET_DIR=${c.dir}/target). No crates.io dependencies whatsoever.

Report the verbatim final lines of the difftest output. Be honest: if you could not reach
ALL_TESTS_PASSED, say so and report exactly which args still mismatch.`,
    { label: `impl:${c.id}`, phase: 'Implement', schema: IMPL_SCHEMA }
  ),

  // ---- stage 2: adversarial independent verification
  (impl, c) => agent(
`You are an ADVERSARIAL verifier. Another agent claims it produced a byte-exact Rust port of a C++
program in ${c.dir}. Your job is to BREAK it, or to certify it with hard evidence. Assume its
self-report is optimistic. Do NOT fix the code and do NOT edit any files in ${c.dir}; only measure.

Its self-report:
${JSON.stringify(impl, null, 2)}

${FACTS}

Do all of the following and report exactly what you observed:
  1. Rebuild it yourself from source to make sure the binary matches the source:
       cd ${c.dir} && rustc -O test1.rs -o /tmp/verify_${c.id}_bin 2>&1 | tail -40
     Report any errors or warnings. If it does not compile, that is a blocking problem.
  2. Run bash /tmp/gt/difftest.sh /tmp/verify_${c.id}_bin and report the verbatim RESULT line and
     whether ALL_TESTS_PASSED appeared.
  3. FUZZ beyond args.txt. Build your own arg list and byte-compare with \`cmp\` (not just md5) against
     /workspace/dataset/test1_executable. Cover at minimum:
       every n in 0..=40; n in {41..120 sampled}, 26/27/28 (hashing boundary), 200, 333, 511, 512,
       999, 1000, 1023, 1024, 1365, 2000, 3000, 5000;
       negatives -1 -2 -7 -100; "0"; ""; " "; "abc"; "3x"; "3.9"; "1e3"; "+5"; "-0"; "  7"; "007";
       "0x10"; "2147483648"; "4294967296"; "99999999999999"; "9223372036854775808";
       "1 2" as a single arg; multiple args ("2" "9"); a non-UTF8 argv byte if you can construct one.
     NEVER pass "-2147483649" to either binary (2-billion-iteration hang).
     Report every mismatching arg in fuzz_mismatches (empty array if genuinely none).
  4. Confirm zero external dependencies: inspect ${c.dir}/Cargo.toml, grep the sources for
     \`extern crate\`, \`use \` statements naming non-std crates, and confirm no vendor/ or
     Cargo.lock with registry packages. Confirm edition 2021.
  5. Read the source and score faithfulness 0-10: does it actually implement the real earcut
     (z-order hashing + sortLinked, filterPoints, cureLocalIntersections, splitEarcut, hole
     elimination), or did it shortcut to a special-cased "cut every other vertex" loop that only
     happens to match convex circle inputs? A hardcoded/lookup-table/pattern-generating shortcut is
     a BLOCKING problem - record it as such. Also flag any place a comparison operator's strictness
     differs from the spec.
  6. Check output performance: time ${c.dir}/test1 5000 and the oracle; flag anything pathological
     (>10x slower or quadratic behaviour).
  7. Confirm exact bytes for the no-arg case and n=1: no trailing newline, single trailing space.

Be rigorous and skeptical. Default to reporting a problem when uncertain.`,
    { label: `verify:${c.id}`, phase: 'Verify', schema: VERDICT_SCHEMA }
  ).then((v) => (v ? { ...v, id: c.id, dir: c.dir, impl } : null))
)

const liveVerdicts = verdicts.filter(Boolean)
log(`verified ${liveVerdicts.length}/${CANDIDATES.length} candidates: ` +
  liveVerdicts.map((v) => `${v.id}=${v.difftest_all_passed ? 'PASS' : 'FAIL'}/f${v.faithfulness_score}`).join(' '))

// ============================================================ Phase 4: Judge
phase('Judge')

const judgement = await agent(
`You are the judge selecting which candidate Rust port becomes the deliverable. Three independent
implementations were built and then adversarially verified. Here are the verification verdicts:

${JSON.stringify(liveVerdicts.map((v) => ({
  id: v.id, dir: v.dir, compiles: v.compiles, difftest_all_passed: v.difftest_all_passed,
  difftest_result_line: v.difftest_result_line, fuzz_mismatches: v.fuzz_mismatches,
  zero_deps: v.zero_deps, faithfulness_score: v.faithfulness_score,
  blocking_problems: v.blocking_problems, evidence: v.evidence,
  impl_notes: v.impl?.notes, modules: v.impl?.modules,
})), null, 2)}

${FACTS}

Selection criteria, in strict priority order:
  1. byte-exact correctness vs the oracle (difftest ALL_TESTS_PASSED and zero fuzz mismatches)
  2. no blocking problems; in particular NO hardcoded/pattern-shortcut implementations
  3. faithfulness: a genuine, complete earcut port
  4. zero external dependencies, edition 2021, compiles under both rustc and cargo
  5. clean modular structure, readability, and reasonable performance

You MAY and SHOULD independently re-check the candidates yourself before deciding: read their source
files, rebuild them, and re-run bash /tmp/gt/difftest.sh on each. Do not take the verdicts on faith.
Do not edit any candidate.

Pick exactly one winner_dir. Then list concrete \`grafts\`: specific superior details from the losing
candidates that the finalizer should merge into the winner (e.g. "b's #[cfg(test)] predicate tests",
"c's hand-rolled u32 decimal writer for large-n throughput", "a's complete findHoleBridge"). Each
graft must be actionable and specific.`,
  { label: 'judge', phase: 'Judge', schema: JUDGE_SCHEMA }
)

log(`winner: ${judgement?.winner_dir} (${(judgement?.grafts || []).length} grafts)`)

// ========================================================== Phase 5: Finalize
phase('Finalize')

const finalized = await agent(
`You are assembling the FINAL DELIVERABLE at /output. This is the artifact the user receives.

The judge selected ${judgement?.winner_dir} as the base implementation.
Judge rationale: ${judgement?.rationale}

Merge in these specific improvements from the other candidates (${CANDIDATES.map((c) => c.dir).join(', ')}):
${(judgement?.grafts || []).map((g, i) => `  ${i + 1}. ${g}`).join('\n') || '  (none)'}

${FACTS}

Produce this exact layout (create /output if needed; /output currently exists and is empty):
  /output/Cargo.toml        edition 2021, empty [dependencies],
                            [lib] name = "<snake_name>" path = "src/lib.rs",
                            [[bin]] name = "test1" path = "test1.rs"
  /output/test1.rs          the entry program. Declares each library module with an explicit
                            #[path = "src/<name>.rs"] mod <name>; item so that a bare
                            \`rustc test1.rs\` from /output compiles standalone.
  /output/src/lib.rs        mirrors the same modules as \`pub mod <name>;\` for the cargo lib target
  /output/src/*.rs          the library modules (multiple files - at minimum separate modules for
                            the earcut node arena/linked list, the geometric predicates + z-order
                            hashing, the top-level triangulation driver, and the CLI/atoi/format
                            helpers). Modules must refer to each other via \`crate::\` paths so BOTH
                            the bin target and the lib target compile unchanged.
  /output/README.md         short: what it is, how to build both ways, how output matches the C++,
                            and the module map.

Then BUILD AND VERIFY, iterating until everything is green:
  1. cd /output && rustc -O test1.rs -o /output/test1
     Must succeed with zero errors AND zero warnings. The executable /output/test1 must exist
     afterwards (requirement: the entry file test1.rs compiles to an executable in /output).
     Do NOT overwrite /output/test1.rs itself with a binary - the source must survive.
  2. cd /output && CARGO_TARGET_DIR=/output/target cargo build --release --offline
     Must succeed with zero warnings. Confirm /output/target/release/test1 exists and also passes
     the difftest. If cargo is unavailable or offline-blocked, report exactly what happened.
  3. bash /tmp/gt/difftest.sh /output/test1        -> must print ALL_TESTS_PASSED
  4. bash /tmp/gt/difftest.sh /output/target/release/test1  -> must print ALL_TESTS_PASSED
  5. Byte-exactness spot checks:
       cd /output && ./test1 1 | xxd          (exactly "1 2 0 ", 6 bytes, no newline)
       ./test1 | xxd                          (same 6 bytes)
       ./test1 0 | wc -c                      (0)
       for k in 2 3 4 5 27 100 1000; do cmp <(/workspace/dataset/test1_executable $k) <(./test1 $k) && echo "ok $k"; done
  6. cargo test --offline must pass if you kept any #[cfg(test)] tests (run it; if you have none,
     that is acceptable, but prefer keeping the useful predicate/atoi unit tests).
  7. Leave the workspace clean: no stray build artifacts other than /output/target and /output/test1.
     Do not leave a Cargo.lock referencing any registry package (an empty-deps lock file is fine).

Report the final \`ls -R /output\` (excluding target), the difftest RESULT lines verbatim, and any
requirement you could not fully satisfy.`,
  { label: 'assemble /output', phase: 'Finalize' }
)

// ============================================================ Phase 6: Review
phase('Review')

const REVIEW_LENSES = [
  {
    key: 'byte-exactness',
    prompt: `Review /output for any way its stdout could differ from the C++ oracle by even one byte.
Scrutinize: the trailing space after every index, absence of any trailing newline, absence of any
stderr/extra output, exit code 0, integer formatting of u32, buffering/flush correctness (including
whether output is flushed on all exit paths and whether a BufWriter could be dropped without
flushing or panic on EPIPE differently than C++), and locale-independence. Then EMPIRICALLY diff:
run bash /tmp/gt/difftest.sh /output/test1 and additionally \`cmp\` the two binaries' stdout for
n in 0..=45 plus 26,27,28,80,81,100,255,256,511,512,1000,1024,2000,5000 and for the non-numeric
argv vectors. Never pass "-2147483649".`,
  },
  {
    key: 'numeric-precision',
    prompt: `Review /output for floating-point divergence from the C++ oracle. Verify the angle
expression reproduces \`2.0 * M_PI * i / (n * 3)\` with the identical order of operations and
identical int->double conversions; verify PI is the same f64 as M_PI; verify Rust's f64::cos/sin
resolve to the same libm as the C++ binary on this platform (check with \`ldd\` / \`nm -D\` on both
binaries and report what you find). Then empirically confirm the generated coordinate sets are
bit-identical: write a tiny throwaway C program (in /tmp, NOT in /output) and a tiny throwaway Rust
program (also in /tmp) that both print the raw f64 bit patterns (%016lx of the double bits) for
i in 0..n*3 at several n including 1, 5, 27, 1000, 5000, and diff them. Also check the geometric
predicates in /output for any reordered arithmetic that would change rounding versus the C++
expressions \`area = (q.y-p.y)*(r.x-q.x) - (q.x-p.x)*(r.y-q.y)\` and pointInTriangle. Report anything
that is not bit-identical.`,
  },
  {
    key: 'cli-parsing',
    prompt: `Review /output's argument handling against C's atoi + argc semantics. Verify the Rust
reimplementation of atoi handles: leading ASCII whitespace (which exact characters does strtol skip?
space \\t \\n \\v \\f \\r), optional + or -, decimal-only digits, stopping at the first non-digit,
returning 0 with no digits, i64 saturation on overflow followed by WRAPPING truncation to i32, and
the subsequent wrapping i32 \`n*3\`. Verify \`argc > 1\` is modelled correctly (extra args ignored;
what happens when argv[1] is an empty string; what happens with non-UTF8 argv - does /output panic
where C++ would not? construct a non-UTF8 argument with a shell $'\\xff' or a small exec harness and
test both binaries). Verify no panic path exists for any argument. Prove each claim by running both
binaries. Never pass "-2147483649".`,
  },
  {
    key: 'algorithm-faithfulness',
    prompt: `Review /output's earcut implementation for faithfulness to the real algorithm. Read every
library module. Confirm it is a genuine general triangulator and NOT special-cased for convex or
circular input: there must be no hardcoded output pattern, no lookup table, no "n" dependence, no
early-out that only works for convex polygons. Confirm the presence and correctness of: linked-list
construction with winding detection, the ear-emission order (prev, ear, next), the ear = next.next
skip heuristic, isEar, isEarHashed with the bidirectional z-chain walk and both tail loops, indexCurve,
sortLinked, zOrder, filterPoints, cureLocalIntersections, splitEarcut, and hole elimination
(eliminateHoles/findHoleBridge/splitPolygon/getLeftmost). Check every comparison operator's
strictness against the spec. THEN prove generality empirically: write a throwaway Rust harness in
/tmp that links /output's library (e.g. \`cargo new\` is NOT allowed to add deps - instead just
\`rustc\` a test file with #[path] mod items pointing at /output/src/*.rs) and triangulate several
NON-convex polygons of your own design: an L-shape, a star, a square with a square hole, a polygon
with collinear points, a polygon with a duplicate point, and a degenerate 2-point ring. Verify the
returned triangles are a valid triangulation (right count: 3*(V-2)+ for holes; non-negative total
area equal to the polygon area within 1e-9; every index in range). Report anything wrong.`,
  },
  {
    key: 'requirements-compliance',
    prompt: `Audit /output against the deliverable requirements as a checklist, and report every item
that is not fully satisfied. Requirements: (1) pure Rust, 2021 edition, compiles with rustc AND as a
Cargo project; (2) CLI args identical to the C++ binary, parsed via std::env::args(); (3) logic,
numeric precision and formatting match the C++ exactly; (4) ZERO external crates - std only, and no
dev-dependencies; verify Cargo.toml, any Cargo.lock, and grep for non-std \`use\`/\`extern crate\`;
(5) a COMPLETE Cargo project in /output with library code organized into MODULES (not one file), and
the entry test file at the package root /output/test1.rs; (6) no reliance on the original C++ library
source; (7) an executable produced from test1.rs exists in /output.
Verify each by running commands: \`cd /output && rustc -O test1.rs -o /output/test1\` from a clean
state, \`CARGO_TARGET_DIR=/output/target cargo build --release --offline\`, \`cargo test --offline\`,
\`ls -R /output\`, \`file /output/test1\`, \`cat /output/Cargo.toml\`. Also confirm /output/test1.rs is
still SOURCE TEXT and was not clobbered by a binary, and confirm \`rustc test1.rs\` (no -O) also works.
Report warnings as findings. Report anything under /output that should not ship.`,
  },
  {
    key: 'rust-quality',
    prompt: `Review /output as a Rust reviewer: idiomatic 2021 code, no \`unsafe\`, no panics reachable
from any input (indexing, slicing, unwrap, expect, integer overflow in debug builds - check that any
arithmetic that could overflow uses wrapping_*/checked_* deliberately since a debug cargo build
panics on overflow where release wraps; verify \`cargo build\` (debug) then run the debug binary
through bash /tmp/gt/difftest.sh to prove no debug-only overflow panic). Check module boundaries and
naming, doc comments, dead code, clippy-style issues you can spot by eye, and that \`rustc -O\` and
\`cargo build --release\` are both warning-free. Also verify performance: time /output/test1 5000
against the oracle and flag anything pathological. Report concrete findings only.`,
  },
]

const rawFindings = await pipeline(
  REVIEW_LENSES,
  (l) => agent(
`${l.prompt}

${FACTS}

You are reviewing the FINAL deliverable at /output. Do NOT edit any files - report only.
The finalizer reported:
${typeof finalized === 'string' ? finalized.slice(0, 6000) : JSON.stringify(finalized).slice(0, 6000)}

Return findings ranked most severe first. Only report things you have EVIDENCE for - run commands.
An empty findings array is the correct answer if you genuinely find nothing.`,
    { label: `review:${l.key}`, phase: 'Review', schema: FINDING_SCHEMA }
  ),
  // adversarially refute each finding with 3 independent skeptics before it counts
  (res, l) => parallel(((res && res.findings) || []).map((f) => () =>
    parallel(['does-it-actually-reproduce', 'is-it-in-scope-for-the-requirements', 'is-the-proposed-fix-necessary'].map((lens) => () =>
      agent(
`Adversarially evaluate this review finding about the Rust deliverable in /output, through the
"${lens}" lens. Try hard to REFUTE it. Verify empirically by running commands before you conclude.

FINDING (from the ${l.key} reviewer):
  severity: ${f.severity}
  file: ${f.file}
  summary: ${f.summary}
  failure scenario: ${f.failure_scenario}
  proposed fix: ${f.fix}

${FACTS}

Set refuted=true if the finding is not a real problem for this deliverable (cannot reproduce, is
stylistic noise with no behavioural or requirement impact, is already handled elsewhere in the code,
or the "fix" would actually break byte-exactness). Set refuted=false only if you independently
reproduced or confirmed a genuine problem. Do NOT edit any files.`,
        { label: `refute:${l.key}:${lens}`, phase: 'Review', schema: REFUTE_SCHEMA }
      )
    )).then((votes) => {
      const live = votes.filter(Boolean)
      const refutedCount = live.filter((v) => v.refuted).length
      return { ...f, lens: l.key, refutedCount, voteCount: live.length,
               survives: live.length > 0 && refutedCount < Math.ceil(live.length / 2),
               refutations: live.map((v) => v.reasoning) }
    })
  ))
)

const confirmed = rawFindings.flat().filter(Boolean).filter((f) => f.survives)
const dismissed = rawFindings.flat().filter(Boolean).filter((f) => !f.survives)
log(`review: ${confirmed.length} findings survived adversarial verification, ${dismissed.length} refuted`)

// completeness critic
const critic = await agent(
`You are the completeness critic for a C++ -> Rust port deliverable at /output.

Verified-surviving review findings so far:
${JSON.stringify(confirmed.map((f) => ({ severity: f.severity, file: f.file, summary: f.summary })), null, 2)}

Findings that were refuted by adversarial verification (do not resurrect these without new evidence):
${JSON.stringify(dismissed.map((f) => ({ file: f.file, summary: f.summary, why_refuted: (f.refutations || [])[0] })), null, 2)}

${FACTS}

Ask: what is still UNVERIFIED or UNCOVERED? Consider input classes nobody tested, requirements nobody
checked, build modes nobody tried (debug vs release, rustc without -O, cargo test, a truly clean
rebuild from only the source files), library behaviours nobody exercised (holes, degenerate rings,
non-convex input), and any claim asserted but never demonstrated. Go run the missing checks yourself
now and report what you find as findings. Do NOT edit files. If coverage is genuinely complete, return
an empty findings array and say so in your reasoning via a single 'nit' finding at most.`,
  { label: 'completeness-critic', phase: 'Review', schema: FINDING_SCHEMA }
)

const criticFindings = ((critic && critic.findings) || []).map((f) => ({ ...f, lens: 'completeness-critic', survives: true }))
const allConfirmed = [...confirmed, ...criticFindings]

// ============================================================ Phase 7: Repair
phase('Repair')

let repair = null
const actionable = allConfirmed.filter((f) => f.severity !== 'nit')

if (actionable.length === 0) {
  log('no actionable findings — deliverable stands as finalized')
} else {
  log(`repairing ${actionable.length} confirmed findings`)
  repair = await agent(
`Apply fixes to the Rust deliverable at /output for the following findings, each of which survived
adversarial verification by multiple independent reviewers.

${JSON.stringify(actionable.map((f) => ({
  severity: f.severity, lens: f.lens, file: f.file, summary: f.summary,
  failure_scenario: f.failure_scenario, fix: f.fix,
})), null, 2)}

${FACTS}

Rules:
  - Byte-exact stdout parity with the oracle is inviolable. If a proposed fix would change output
    bytes, do NOT apply it; explain why and leave the code alone.
  - Preserve the required layout: /output/Cargo.toml, /output/test1.rs (SOURCE, at package root),
    /output/src/lib.rs + multiple library modules, /output/README.md. Keep zero dependencies.
  - After editing, re-verify EVERYTHING and iterate until green:
      cd /output && rm -f test1 && rustc -O test1.rs -o /output/test1
      bash /tmp/gt/difftest.sh /output/test1                     -> ALL_TESTS_PASSED
      CARGO_TARGET_DIR=/output/target cargo build --release --offline
      bash /tmp/gt/difftest.sh /output/target/release/test1      -> ALL_TESTS_PASSED
      CARGO_TARGET_DIR=/output/target cargo build --offline      (debug: proves no overflow panics)
      bash /tmp/gt/difftest.sh /output/target/debug/test1        -> ALL_TESTS_PASSED
      CARGO_TARGET_DIR=/output/target cargo test --offline
      cd /output && ./test1 1 | xxd                              -> exactly "1 2 0 " (6 bytes)
    Everything must be warning-free.
  - Report, per finding, whether you fixed it / skipped it (with reason) / found no change needed.
  - End your report with the final verbatim difftest RESULT lines and \`ls -R /output\` excluding target.`,
    { label: 'apply fixes', phase: 'Repair' }
  )
}

// final independent gate
const gate = await agent(
`FINAL ACCEPTANCE GATE for the deliverable at /output. You are the last check before it ships.
Trust nothing; verify everything yourself with commands. Do NOT edit any files.

${FACTS}

Run and report the verbatim output of each:
  1. ls -R /output   (excluding target contents)
  2. cat /output/Cargo.toml
  3. head -40 /output/test1.rs
  4. file /output/test1.rs   (must be ASCII/UTF-8 source text, NOT a binary)
  5. cd /output && rm -f test1 && rustc test1.rs -o /output/test1 2>&1   (no -O; zero warnings/errors)
  6. bash /tmp/gt/difftest.sh /output/test1
  7. cd /output && rm -f test1 && rustc -O test1.rs -o /output/test1 2>&1
  8. bash /tmp/gt/difftest.sh /output/test1
  9. cd /output && CARGO_TARGET_DIR=/output/target cargo build --release --offline 2>&1 | tail -20
 10. bash /tmp/gt/difftest.sh /output/target/release/test1
 11. cd /output && CARGO_TARGET_DIR=/output/target cargo test --offline 2>&1 | tail -25
 12. cd /output && ./test1 1 | xxd  ;  ./test1 | xxd  ;  ./test1 0 | wc -c
 13. for k in 2 3 4 5 26 27 28 100 1000 2000; do cmp <(/workspace/dataset/test1_executable $k) <(/output/test1 $k) && echo "ok $k"; done
 14. grep -rn "extern crate\\|^use " /output/src /output/test1.rs | grep -v "use crate::\\|use std::\\|use super::\\|use self::" || echo "no non-std imports"
 15. wc -l /output/src/*.rs /output/test1.rs
 16. ls /output/test1 && file /output/test1

Then state a clear verdict: SHIP or DO-NOT-SHIP, and if DO-NOT-SHIP, exactly what is broken.
Finish with a concise summary a human can read: the module map, how the port matches the C++,
and the verification evidence.`,
  { label: 'acceptance gate', phase: 'Repair' }
)

return {
  winner: judgement?.winner_dir,
  candidates: liveVerdicts.map((v) => ({ id: v.id, pass: v.difftest_all_passed, faithfulness: v.faithfulness_score, blocking: v.blocking_problems })),
  confirmedFindings: allConfirmed.map((f) => ({ severity: f.severity, lens: f.lens, file: f.file, summary: f.summary })),
  refutedCount: dismissed.length,
  repair: typeof repair === 'string' ? repair : null,
  gate: typeof gate === 'string' ? gate : JSON.stringify(gate),
}
