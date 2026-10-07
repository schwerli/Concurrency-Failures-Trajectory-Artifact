export const meta = {
  name: 'verify-earcut-port',
  description: 'Adversarially hunt for any divergence, panic, or requirement violation in the /output Rust port',
  phases: [
    { title: 'Hunt', detail: 'differential + robustness + compliance sweeps' },
    { title: 'Verify', detail: 'independently reproduce each reported defect' },
  ],
}

const CTX = `
A C++ program /workspace/dataset/test19.cpp (a test of the header-only mapbox/earcut.hpp triangulator)
has been ported to pure Rust. The port lives in /output:

  /output/Cargo.toml            (package "test19"; lib "earcut_test19" at src/lib.rs; bin "test19" at test19.rs)
  /output/test19.rs             entry file — also standalone-buildable with plain \`rustc test19.rs\`
  /output/src/lib.rs
  /output/src/atoi.rs           C atoi() semantics
  /output/src/shape.rs          the fractal ring generator
  /output/src/earcut/{mod,node,geom,predicates,zorder,triangulate,holes}.rs
  /output/test19                prebuilt optimized binary (rustc -O)
  /output/target/release/test19 cargo release binary

Reference C++ binary: /workspace/dataset/test19_executable  (run it with any argument)
The C++ source is in /workspace/dataset/test19.cpp. The earcut.hpp header itself is NOT on this machine.

Requirements the port must satisfy:
 R1. Pure Rust 2021, compiles with rustc or cargo.
 R2. Same CLI as the C++ binary: one optional positional arg, default n = 19, parsed with atoi semantics.
 R3. Byte-for-byte identical stdout (indices separated by AND terminated with a space; NO trailing newline).
 R4. Zero external crates — std only.
 R5. Complete Cargo project in /output, library code organized into modules, entry file test19.rs in /output.
 R6. Black-box reimplementation using std.

Already-performed validation (do not just repeat it — go beyond):
 - byte-exact match for every integer n from -20 to 700, plus 750/800/900/1000/1234/1500/2000/2500/3000/4000/5000
 - byte-exact match for args: "" "abc" "+3" "-5" "3.9" "007" " 5" "12abc" "0x5" "999999999999999999999"
   "-999999999999999999999" "  -0" "2147483647" "-2147483648" "4294967296" "1e3" "\\t42xyz" "--3" "+-3" "  +0019  "
 - no-arg and extra-trailing-arg invocations match
 - cargo build --release, cargo test, plain rustc all clean
`

phase('Hunt')

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          detail: { type: 'string' },
          repro: { type: 'string', description: 'exact shell command(s) that demonstrate it, or "n/a"' },
        },
        required: ['title', 'file', 'severity', 'detail', 'repro'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

const HUNTERS = [
  { key: 'diff-deep', prompt: `Hunt for ANY input where /output/test19 and /workspace/dataset/test19_executable differ, byte for byte.
Go beyond the already-tested range. Ideas: n values in 700..20000 sampled densely enough to be meaningful (mind runtime — time one large run first and budget accordingly); values right at the z-order hashing threshold (the switch happens when the ring exceeds 80 vertices, i.e. around n=39/40); powers of two and neighbours; n where 2n+2 is exactly 80/81/82; very large n where C++ \`int\` arithmetic \`n * 2\` overflows (e.g. 1073741824, 2147483647) — compare behaviour including exit status, timing out gracefully if either side hangs (use \`timeout\`).
Compare with \`cmp\`, not shell \`$(...)\` capture, so trailing whitespace is included. Also compare exit codes and stderr.
Report every genuine divergence. If you find none, say so plainly — do not invent findings.` },
  { key: 'robustness', prompt: `Attack the LIBRARY (not just the binary) for panics, hangs, and UB-equivalents.
Write throwaway Rust test programs in /tmp/verify-robust (create it; do NOT modify /output) that depend on the /output crate by path — e.g. a separate Cargo project with \`earcut_test19 = { path = "/output" }\` — or just \`#[path]\`-include the modules.
Exercise: empty polygon list; a ring with 0/1/2/3 points; duplicate points; all-collinear rings; NaN and infinite coordinates; ±0.0; huge coordinates near f64::MAX; rings with holes (multi-ring input — note the C++ reference cannot be consulted for holes, so only check for panics/hangs/obviously-invalid output, not exact indices); a hole outside the outer ring; Steiner-point cases.
Build with debug assertions ON (overflow checks + bounds checks) so arithmetic overflow and out-of-bounds arena indexing surface.
Report any panic, infinite loop (use a timeout), or index-out-of-bounds. Also state clearly which of these the C++ original would also crash on, if you can reason about it.` },
  { key: 'compliance', prompt: `Audit /output against requirements R1-R6 literally and pedantically. Read every file in /output (excluding target/).
Check: edition 2021; zero dependencies in Cargo.toml AND Cargo.lock; no \`extern crate\` of anything external; the entry file really is /output/test19.rs and really is the bin target; both \`rustc test19.rs\` and \`cargo build --release\` succeed from a clean state (test in a COPY at /tmp/verify-clean, do not delete /output/target); no warnings from \`cargo build\`, \`cargo test\`, \`cargo clippy\` if clippy exists; module organisation is real (library code in modules, not one blob).
Note the requirement text says both "Save the entry file to /output/test19.rs" and "produce an executable at /output/test19.rs" — which is self-contradictory. Report what currently exists at those paths and judge whether the chosen resolution (source at test19.rs, executable at test19) is the sensible reading, or whether something else should also be produced.
Do NOT modify /output. Report findings only.` },
  { key: 'semantics', prompt: `Review the ported algorithm in /output/src/earcut/*.rs for FIDELITY to mapbox/earcut.hpp, from your own knowledge of that library (the header is not on disk; do not try to fetch it).
Line-by-line, check each ported routine against what earcut.hpp does: operator()/run, linkedList, filterPoints, earcutLinked and its pass 0/1/2 cascade, isEar, isEarHashed, cureLocalIntersections, splitEarcut, splitPolygon, insertNode, removeNode, indexCurve, sortLinked, zOrder, area, equals, sign, pointInTriangle, intersects, onSegment, intersectsPolygon, locallyInside, middleInside, isValidDiagonal, eliminateHoles, eliminateHole, findHoleBridge, getLeftmost, sectorContainsSector.
Flag: wrong comparison operator (>= vs >), wrong argument order, a value hoisted out of a loop that C++ re-evaluates, missing prevZ/nextZ maintenance, integer type mismatches in zOrder, sort stability, and anything where the Rust deviates.
The single-ring path is already exhaustively validated against the reference binary, so concentrate your scepticism on code paths the test19 program NEVER executes: the entire holes module, multi-ring input, the steiner flag, and the inv_size == 0 degenerate case. Those are unverified by the differential tests.
Report concrete divergences with file and line. Do not report stylistic preferences.` },
]

const hunts = await parallel(HUNTERS.map(h => () =>
  agent(CTX + '\n\nYOUR ASSIGNMENT:\n' + h.prompt, {
    label: `hunt:${h.key}`, phase: 'Hunt', schema: FINDINGS, effort: 'high',
  })))

const all = hunts.filter(Boolean).flatMap((h, i) =>
  (h.findings || []).map(f => ({ ...f, hunter: HUNTERS[i].key })))

log(`hunt: ${all.length} candidate findings from ${hunts.filter(Boolean).length} hunters`)

if (all.length === 0) {
  return { verified: [], note: 'no candidate findings', summaries: hunts.filter(Boolean).map(h => h.summary) }
}

phase('Verify')

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    real: { type: 'boolean', description: 'true only if independently reproduced or proven by reading the code' },
    reasoning: { type: 'string' },
    evidence: { type: 'string', description: 'command output or exact code quote proving the verdict' },
  },
  required: ['real', 'reasoning', 'evidence'],
}

const verified = await parallel(all.map((f, i) => () =>
  agent(CTX + `
A reviewer reported this finding about the /output Rust port. Your job is to REFUTE it.
Default to refuted (real = false) unless you can independently reproduce it or prove it by reading the code.
Do NOT trust the reporter's reasoning; re-derive from scratch. Do NOT modify /output — work in /tmp/refute-${i}.

  TITLE:    ${f.title}
  FILE:     ${f.file}
  SEVERITY: ${f.severity}
  DETAIL:   ${f.detail}
  REPRO:    ${f.repro}

If the finding concerns a code path that the test19 program never executes, it can still be real — judge it on whether the ported library diverges from earcut.hpp or can panic, not on whether test19 exercises it. But a finding that merely restates a documented, intentional design choice is NOT real.
`, { label: `refute:${i}`, phase: 'Verify', schema: VERDICT, effort: 'high' })
    .then(v => ({ ...f, verdict: v }))))

const confirmed = verified.filter(Boolean).filter(f => f.verdict && f.verdict.real)
log(`verify: ${confirmed.length}/${all.length} findings survived refutation`)

return {
  confirmed,
  refuted: verified.filter(Boolean).filter(f => !(f.verdict && f.verdict.real)).map(f => f.title),
  summaries: hunts.filter(Boolean).map(h => h.summary),
}
