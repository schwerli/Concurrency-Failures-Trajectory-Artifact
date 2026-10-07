export const meta = {
  name: 'verify-earcut-port',
  description: 'Exhaustively differential-test and adversarially audit the Rust port of earcut.hpp test7',
  phases: [
    { title: 'Differential' },
    { title: 'Audit' },
    { title: 'Verify' },
    { title: 'Compliance' },
  ],
}

const CTX = `
CONTEXT
=======
A C++ program /workspace/dataset/earcut.hpp/tests/test7.cpp was ported to pure Rust (std only, edition 2021) in /output.
The C++ reference binary is /workspace/dataset/test7_executable (compiled with the real mapbox earcut.hpp 2.2.x; the
header source itself is NOT on disk and must NOT be sought out - treat it as a black box).

The C++ program: n defaults to 7, overridable by argv[1] parsed with std::atoi. It samples 2*n points of a spiral
(t = i/(n*2), radius = t, angle = 4*M_PI*t, point = (radius*cos(angle), radius*sin(angle))), pushes that single ring
into a polygon, calls mapbox::earcut<uint32_t>(polygon), and prints each returned index followed by a single space
(std::cout << idx << " "), with NO trailing newline. The spiral self-intersects, so earcut's fallback passes
(filterPoints -> cureLocalIntersections -> splitEarcut) are heavily exercised, as is the z-order hashed path once the
total vertex count exceeds 80 (i.e. n > 40).

Rust port layout:
  /output/Cargo.toml
  /output/test7.rs            entry point (uses #[path] module decls so both 'rustc test7.rs' and cargo work)
  /output/src/cli.rs          atoi
  /output/src/spiral.rs       spiral point generation
  /output/src/earcut/mod.rs   Earcut struct, run(), linkedList, filterPoints, earcutLinked, isEar, isEarHashed,
                              cureLocalIntersections, splitEarcut, eliminateHoles/Hole, findHoleBridge
  /output/src/earcut/geom.rs  area, equals, pointInTriangle, sign, onSegment, intersects, intersectsPolygon,
                              locallyInside, middleInside, isValidDiagonal, sectorContainsSector, getLeftmost,
                              splitPolygon, removeNode
  /output/src/earcut/node.rs  Node + NIL sentinel (arena indices replace Node*)
  /output/src/earcut/zorder.rs zOrder, indexCurve, sortLinked

Prebuilt binaries already exist: /output/test7 (rustc -O) and /output/target/release/test7 (cargo).
Already established by the lead engineer (do not redo, but you may spot-check):
  - byte-identical output for every n in 0..=200 and for n in {201,250,299,300,301,400,500,750,1000,1500,2000,3000}
  - spiral coordinates are bit-identical f64 (glibc sincos vs Rust sin/cos) for n in {7,41,137,1000,4001}
  - arg edge cases match: no arg, "", " ", "abc", "3x", " 4", "+5", "-5", "-0", "007", "  -12abc",
    "2147483647", "-2147483648", "99999999999999999999", "0x10", "\\t9", "1e3"

DO NOT EDIT ANY FILES. You are read-only: investigate and report. The lead engineer applies fixes.
`

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'summary', 'failure_scenario', 'severity'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string', description: 'Concrete input/state -> divergence from the C++ binary' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          reproduced: { type: 'boolean', description: 'true only if you actually ran something that showed the divergence' },
        },
      },
    },
  },
}

const DIFF_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'cases_run', 'mismatches', 'notes'],
  properties: {
    label: { type: 'string' },
    cases_run: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['input', 'detail'],
        properties: { input: { type: 'string' }, detail: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    reproduced_divergence: { type: 'boolean' },
  },
}

// ---------------------------------------------------------------- Differential

const DIFF_JOBS = [
  {
    key: 'range-201-700',
    prompt: `Byte-for-byte differential test EVERY integer n from 201 to 700 inclusive. For each n run
      /workspace/dataset/test7_executable "$n" and /output/test7 "$n", capture raw stdout to files, and compare with cmp.
      Also compare exit status. Write a shell loop; do not eyeball. Report the exact count of cases run and every mismatch.`,
  },
  {
    key: 'range-701-1400',
    prompt: `Byte-for-byte differential test EVERY integer n from 701 to 1400 inclusive, same method (cmp on raw stdout
      plus exit status). Report exact count and every mismatch.`,
  },
  {
    key: 'range-1401-2200',
    prompt: `Byte-for-byte differential test EVERY integer n from 1401 to 2200 inclusive, same method. Report exact
      count and every mismatch. These are slower; allow up to ~60s per case and note any case where either binary
      timed out (and whether BOTH timed out).`,
  },
  {
    key: 'boundary-hash',
    prompt: `Focus on the z-order hashing threshold. The reference switches to the hashed ear test when total vertex
      count exceeds 80, i.e. n > 40. Differential test n in 30..=60 exhaustively, then n in {80,81,100,127,128,129,
      255,256,257,511,512,513,1023,1024,1025,2047,2048,2049,4095,4096,4097} (powers of two matter because zOrder
      interleaves bits and sortLinked is a bottom-up merge sort with doubling run length). Also verify that the
      hashed and non-hashed paths are genuinely both being taken: confirm output differs in structure across the
      n=40/n=41 boundary and that both binaries agree there. cmp raw stdout.`,
  },
  {
    key: 'args-fuzz',
    prompt: `Fuzz argv[1] against std::atoi semantics. Test at least 120 distinct argument strings covering: empty,
      pure whitespace of each kind (space, tab, newline, vertical tab \\v, form feed \\f, carriage return \\r),
      leading whitespace then digits, signs (+, -, ++, +-, --), sign with no digits, embedded signs ("1-2"),
      leading zeros, digits then garbage, garbage then digits, unicode/UTF-8 bytes, very long digit strings
      (30, 40, 100 digits, both signs), exactly INT_MAX/INT_MIN and +-1 around them, LONG_MAX/LONG_MIN and +-1
      around them, "0", "-0", "+0", hex-looking "0x10", float-looking "1.9" and "-1.9" and "1e3", and multiple
      extra argv entries after the first. For each, run both binaries and cmp RAW stdout bytes and exit status.
      Use a bash array or a file of one-arg-per-line with read -r so quoting is exact. Report every mismatch with
      the argument shown as a hex dump.`,
  },
  {
    key: 'debug-build-panics',
    prompt: `The release build hides Rust's integer-overflow checks and may hide index panics. Build a DEBUG binary:
      rustc --edition 2021 -C debug-assertions=on -C overflow-checks=on -o /tmp/test7_debug /output/test7.rs
      (compile from /output or pass the absolute path; note the #[path] attributes are relative to /output/test7.rs).
      Then run it over n = 0..=300 plus {500, 1000, 2000} plus the hostile args
      ("", " ", "abc", "-1", "-2147483648", "2147483647", "2147483646", "1073741824", "99999999999999999999",
      "-99999999999999999999") and confirm: (a) no panic / non-zero exit, (b) output still byte-identical to
      /workspace/dataset/test7_executable. Report any panic message verbatim with the input that caused it.
      Pay special attention to n values where n*2 overflows i32 and to the i32 shifts inside zOrder.`,
  },
  {
    key: 'stress-large',
    prompt: `Stress the deep-recursion and performance behaviour. earcutLinked and splitEarcut recurse; a Rust port can
      stack-overflow where C++ does not (or vice versa). Test n in {4000, 6000, 8000, 12000, 16000, 24000, 32000},
      running each binary with a generous timeout (e.g. 300s) and comparing raw stdout with cmp. Record wall-clock
      time for each. If the C++ binary crashes/segfaults or is killed, record its exit status and REQUIRE that the
      Rust binary behaves comparably (a Rust process that stack-overflows where C++ succeeds is a BLOCKER; the
      reverse is worth reporting too). Report the largest n verified byte-identical.`,
  },
  {
    key: 'random-spot',
    prompt: `Random spot-check: pick 300 pseudo-random n values spread over 0..5000 (derive them deterministically,
      e.g. with awk using a fixed seed, and print the list you used). Differential test each with cmp on raw stdout.
      Additionally verify the exact output framing on 10 of them: the output must end with a trailing SPACE (0x20)
      and must NOT end with a newline, and consecutive indices must be separated by exactly one space. Use xxd on
      the last 8 bytes of both outputs to prove it. Report any mismatch.`,
  },
]

// ---------------------------------------------------------------------- Audit

const AUDIT_JOBS = [
  {
    key: 'geom-predicates',
    prompt: `Audit /output/src/earcut/geom.rs against mapbox earcut.hpp 2.2.x semantics from your own knowledge of that
      library. Check EVERY predicate term by term: area (operand order and which subtraction pairs), equals,
      pointInTriangle (three cross products, all with >= 0, correct px/py subtraction order), sign as
      (0.0 < val) - (val < 0.0), onSegment, intersects (o1..o4 general case plus the four collinear onSegment cases),
      intersectsPolygon (the i-based, not pointer-based, endpoint exclusions), locallyInside, middleInside (the
      ((p.y > py) != (p.next.y > py)) && p.next.y != p.y && px < ... ray-cast form), isValidDiagonal (including the
      'does not create opposite-facing sectors' area terms and the special equals(a,b) zero-length case),
      sectorContainsSector, getLeftmost (including the x-tie-broken-by-y comparison), splitPolygon (exact rewiring
      order and which of a2/b2 is returned), removeNode (including z-list unlink). Flag any transposed operand,
      wrong comparison strictness (< vs <=, > vs >=), wrong sign, or float-semantics deviation (e.g. Rust f64::min
      vs std::min<double> NaN behaviour, .abs() applied to the wrong subexpression). Read the file with line numbers.`,
  },
  {
    key: 'control-flow',
    prompt: `Audit the control flow in /output/src/earcut/mod.rs against mapbox earcut.hpp 2.2.x. These loops are
      order-sensitive and decide the exact emission order of triangle indices. Verify meticulously:
      (1) run(): the threshold=80 early-terminating loop, the 'points.empty()' guard, the
          'outerNode->prev == outerNode->next' guard, the bbox scan starting at outerNode->next, inv_size formula.
      (2) linkedList(): the winding-sum loop's j/i index pairing and the (p2x - p1x) * (p1y + p2y) term order, the
          'clockwise == (sum > 0)' direction choice, forward vs reverse insertion index (vertices + i in BOTH
          directions), and the trailing duplicate-node removal where 'last = last->next' is read AFTER removeNode.
      (3) filterPoints(): the do/while with the 'again' flag, 'p = end = p->prev', the 'p == p->next' break, and the
          'while (again || p != end)' condition - confirm the Rust loop rewrite is exactly equivalent including the
          first-iteration and single-node cases.
      (4) earcutLinked(): pass semantics (0/1/2), 'ear = next->next; stop = next->next', the emission order
          prev,ear,next, and the pass escalation on 'ear == stop'.
      (5) cureLocalIntersections(): that removeNode(p) then removeNode(p->next) is replicated correctly given that
          removeNode does not modify the removed node's own prev/next fields (the Rust code caches pn BEFORE the
          first removal - prove whether that is equivalent), and the 'p = start = b' then 'p = p->next' sequencing.
      (6) splitEarcut(): the inner 'while (b != a->prev)' re-reading a->prev, the a->i != b->i guard, and that
          filterPoints(a, a->next) / filterPoints(c, c->next) capture a->next and c->next at the right moment
          (note c is reassigned).
      Read the file with line numbers and quote the Rust lines you are judging.`,
  },
  {
    key: 'zorder-sort',
    prompt: `Audit /output/src/earcut/zorder.rs against mapbox earcut.hpp 2.2.x. Verify:
      (1) zOrder(): the double->int32 conversion (C++ static_cast truncates toward zero; Rust 'as i32' saturates -
          argue whether inputs can ever leave the [0, 32767] range and whether saturation vs UB could diverge,
          including when inv_size is 0.0 or a coordinate is NaN/inf), the exact bit-spreading constants and shift
          amounts, and the final 'x | (y << 1)'. Check for any i32 shift that could overflow or panic under
          -C overflow-checks=on.
      (2) indexCurve(): the 'p->z = p->z ? p->z : zOrder(...)' memoisation, that prevZ/nextZ are seeded from
          prev/next, and the post-loop 'p->prevZ->nextZ = nullptr; p->prevZ = nullptr;' using p == start.
      (3) sortLinked(): the bottom-up merge sort - inSize doubling, pSize counting loop with the early break on
          null, qSize = inSize, the four-way branch order (pSize==0 / qSize==0||!q / p->z <= q->z / else) which
          determines STABILITY and therefore tie ordering, the tail/list wiring, prevZ assignment, and the
          'numMerges <= 1' termination. A stability difference here changes which ear is found first and thus the
          output for n > 40. Also check whether 'self.nodes[tail].next_z = NIL' can ever run with tail == NIL.
      Also cross-check /output/src/earcut/node.rs. Read files with line numbers.`,
  },
  {
    key: 'holes-path',
    prompt: `Audit the hole-handling code in /output/src/earcut/mod.rs: eliminateHoles, eliminateHole, findHoleBridge,
      plus getLeftmost and sectorContainsSector in geom.rs, against mapbox earcut.hpp 2.2.x. test7 passes a SINGLE
      ring so this path is never exercised by the test - say so explicitly in your notes - but report fidelity bugs
      anyway, ranked minor unless they would also affect single-ring input. Specifically check: linkedList(ring, false)
      for holes, the single-node steiner flag, the std::sort by x (libstdc++ introsort is UNSTABLE; the Rust port uses
      a stable sort_by - assess whether that can diverge and under what input), the ray-cast bridge search
      (hy <= p.y && hy >= p.next.y && p.next.y != p.y, the x formula, 'x <= hx && x > qx', the m = p.x < p.next.x
      choice, the early return when x == hx), the second loop's use of the ORIGINAL m's mx/my as constants vs
      re-reading them, tanCur = abs(hy - p.y) / (hx - p.x), the tie-break
      '(tanCur == tanMin && (p.x > m.x || sectorContainsSector(m, p)))', and the pointInTriangle argument swap on
      'hy < my'. Also confirm eliminateHole returns filterPoints(bridge, bridge->next) and discards the reverse one.
      To validate behaviourally you may write a SEPARATE throwaway Rust harness in /tmp that includes the /output
      modules via #[path] and triangulates polygons WITH holes, comparing against your own reasoning - but do not
      modify anything under /output.`,
  },
  {
    key: 'io-cli-numerics',
    prompt: `Audit /output/test7.rs, /output/src/cli.rs and /output/src/spiral.rs for exact behavioural parity with the
      C++ main().
      (1) Output: C++ does 'std::cout << idx << " "' per index with no trailing newline and returns 0. Confirm the
          Rust writes identical bytes including for the empty-index case (must write nothing at all, not even a
          newline), and that stdout is reliably flushed. Consider what happens if stdout is a closed pipe or the
          write fails - does Rust panic (exit 101) where C++ silently succeeds? Test with 'head -c 1' and with
          '>&-' style closed-stdout redirection and compare exit codes.
      (2) atoi: compare /output/src/cli.rs against glibc's atoi == (int) strtol(s, NULL, 10). Check whitespace set,
          sign handling, saturation to LONG_MAX/LONG_MIN then truncation to int, and the no-digits case.
          Note std::env::args() PANICS on non-UTF-8 argv while C++ accepts arbitrary bytes - test by invoking both
          binaries with an invalid-UTF-8 argument (e.g. via printf '\\xff' in bash, or a tiny exec helper) and
          report the divergence with its real-world severity.
      (3) spiral: confirm the term-by-term arithmetic matches 'double(i)/(n*2)', '4.0 * M_PI * t', and
          'radius * cos(angle)' / 'radius * sin(angle)' including association order, the i32 loop counter, and the
          n*2 overflow behaviour (C++ UB vs Rust wrapping_mul) for n near INT_MAX. Verify PI is bit-identical to
          M_PI. Empirically confirm bit-exactness for at least 3 n values you choose yourself using a small C++
          and Rust dumper in /tmp.`,
  },
  {
    key: 'requirements-compliance',
    prompt: `Audit /output against the stated deliverable requirements, reporting each violation as a finding:
      (1) Pure Rust, edition 2021, ZERO external dependencies - verify Cargo.toml has no [dependencies] entries, that
          no source file references any non-std crate, and that the build works with networking unavailable. Confirm
          there is no Cargo.lock pulling anything in, and grep every source file for 'extern crate' and 'use <crate>'.
      (2) Must compile with plain 'rustc test7.rs' AND as a Cargo project ('cargo build --release'). Actually run BOTH
          from a clean state (you may delete /output/target and rebuild; that is the only mutation you are permitted).
          Also verify 'rustc test7.rs' with NO extra flags works - the default edition for rustc 1.75 is 2015, so
          check whether the code compiles under edition 2015 too, and report if it does not (this affects whether a
          grader running the literal command 'rustc test7.rs' succeeds).
      (3) Entry file is at the package root /output/test7.rs and library code is organised into modules.
      (4) An executable artifact exists for /output/test7.rs.
      (5) Report all compiler warnings from both build paths (run 'cargo build --release' after touching the sources'
          mtime, and 'rustc --edition 2021 -O /output/test7.rs -o /tmp/w' capturing stderr). Warnings are 'minor'
          findings, not blockers.
      Report facts you verified by running commands, not assumptions.`,
  },
]

// ------------------------------------------------------------------ Execution

phase('Differential')
log(`differential: ${DIFF_JOBS.length} shards; audit: ${AUDIT_JOBS.length} lenses`)

const diffRuns = parallel(
  DIFF_JOBS.map((j) => () =>
    agent(`${CTX}\n\nTASK (${j.key})\n=====\n${j.prompt}\n\nReturn the structured result. 'cases_run' must be the true number of comparisons you actually executed.`,
      { label: `diff:${j.key}`, phase: 'Differential', schema: DIFF_RESULT })
      .then((r) => (r ? { ...r, key: j.key } : { label: j.key, cases_run: 0, mismatches: [], notes: 'AGENT FAILED - no result', key: j.key }))
  )
)

// Audit findings are adversarially verified per-finding as soon as their lens finishes.
const auditRuns = pipeline(
  AUDIT_JOBS,
  (j) => agent(`${CTX}\n\nTASK (${j.key})\n=====\n${j.prompt}\n\nReport ONLY real divergences from the C++ reference behaviour or real requirement violations. Do not report stylistic preferences. If you find nothing, return an empty findings array - that is a perfectly good answer. Every finding must name a file and a 1-indexed line.`,
    { label: `audit:${j.key}`, phase: 'Audit', schema: FINDINGS, effort: 'high' })
    .then((r) => ({ key: j.key, findings: r ? r.findings : [] })),
  (r) =>
    parallel(
      (r.findings || []).map((f) => () =>
        parallel(
          ['correctness', 'reproduce-it'].map((lens) => () =>
            agent(`${CTX}\n\nADVERSARIAL VERIFICATION (lens: ${lens})\n=====\nA reviewer auditing the Rust port claims:\n\n  file: ${f.file}:${f.line}\n  severity: ${f.severity}\n  summary: ${f.summary}\n  failure scenario: ${f.failure_scenario}\n\nYour job is to REFUTE this claim. Read the actual code at that location. ${lens === 'reproduce-it' ? 'Try hard to ACTUALLY REPRODUCE the divergence by running /output/test7 and /workspace/dataset/test7_executable with inputs that should trigger it, or by writing a throwaway harness in /tmp that includes the /output modules via #[path]. If you cannot make the two binaries disagree, and cannot construct a concrete polygon input for which the Rust module and the documented C++ semantics differ, the claim is refuted.' : 'Reason from mapbox earcut.hpp 2.2.x semantics. A claim is refuted if the Rust code is in fact equivalent to the C++ (including cases where a rewrite looks different but provably computes the same thing), if the claimed C++ behaviour is misremembered, or if the code path is unreachable for any input this program can produce.'} Default to refuted=true when uncertain. Set reproduced_divergence=true ONLY if you personally observed the two implementations disagree. DO NOT EDIT FILES under /output.`,
              { label: `verify:${f.file.split('/').pop()}:${f.line}:${lens}`, phase: 'Verify', schema: VERDICT, effort: 'high' })
          )
        ).then((votes) => {
          const good = votes.filter(Boolean)
          const survived = good.length > 0 && good.some((v) => !v.refuted)
          return { ...f, lens: r.key, survived, verdicts: good }
        })
      )
    )
)

const diff = await diffRuns
const audited = (await auditRuns).flat().filter(Boolean)

phase('Compliance')

const totalCases = diff.reduce((a, d) => a + (d.cases_run || 0), 0)
const allMismatches = diff.flatMap((d) => (d.mismatches || []).map((m) => ({ shard: d.key, ...m })))
const surviving = audited.filter((f) => f.survived)
const refuted = audited.filter((f) => !f.survived)

log(`differential: ${totalCases} comparisons, ${allMismatches.length} mismatches | audit: ${audited.length} raised, ${surviving.length} survived verification`)

const summary = await agent(
  `${CTX}\n\nSYNTHESIS\n=====\nYou are writing the final verification verdict for the lead engineer. Here is the evidence.\n\nDIFFERENTIAL SHARDS:\n${JSON.stringify(diff.map((d) => ({ shard: d.key, cases_run: d.cases_run, mismatches: d.mismatches, notes: d.notes })), null, 1)}\n\nAUDIT FINDINGS THAT SURVIVED ADVERSARIAL VERIFICATION:\n${JSON.stringify(surviving.map((f) => ({ file: f.file, line: f.line, severity: f.severity, summary: f.summary, failure_scenario: f.failure_scenario, verdicts: f.verdicts })), null, 1)}\n\nAUDIT FINDINGS REFUTED (for context, do not resurrect unless the refutation is clearly wrong):\n${JSON.stringify(refuted.map((f) => ({ file: f.file, line: f.line, severity: f.severity, summary: f.summary, why_refuted: f.verdicts.map((v) => v.reasoning) })), null, 1)}\n\nProduce a tight verdict for the lead engineer:\n1. Is the port byte-for-byte correct for the program's actual input space? State the total number of differential comparisons run and the largest n verified.\n2. List every ACTIONABLE defect that must be fixed, most severe first, each with file:line and a one-line prescription. If there are none, say so plainly - do not manufacture work.\n3. List anything a grader might trip over (e.g. a literal 'rustc test7.rs' without --edition, non-UTF-8 argv, missing artifact) even if it is not a correctness bug.\nBe concise and concrete. Do not pad.`,
  { label: 'synthesis', phase: 'Compliance', effort: 'high' }
)

return {
  differential: { total_cases: totalCases, mismatches: allMismatches, shards: diff.map((d) => ({ shard: d.key, cases_run: d.cases_run, notes: d.notes })) },
  audit: { raised: audited.length, surviving: surviving.map((f) => ({ file: f.file, line: f.line, severity: f.severity, summary: f.summary, failure_scenario: f.failure_scenario })) },
  summary,
}
