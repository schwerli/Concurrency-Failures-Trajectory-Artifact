export const meta = {
  name: 'clipper2-rust-port',
  description: 'Port Clipper2 InflatePaths to dependency-free Rust: diverse engine + offset implementations, judged, integrated, adversarially verified',
  phases: [
    { title: 'HiddenTests', detail: 'author independent hidden batteries from the contract' },
    { title: 'Engine', detail: '4 algorithmically diverse boolean engines' },
    { title: 'JudgeEngine', detail: 'score all engines on public + hidden batteries' },
    { title: 'Offset', detail: '3 independent ClipperOffset implementations' },
    { title: 'JudgeOffset', detail: 'score all offsetters' },
    { title: 'Integrate', detail: 'assemble /output, build, diff vs the C++ binary' },
    { title: 'Verify', detail: 'adversarial review across 5 dimensions' },
    { title: 'Fix', detail: 'apply confirmed findings and re-verify' },
  ],
}

const PREAMBLE = `
CONTEXT
We are migrating /workspace/dataset/Clipper/tests/test3.cpp (a Clipper2 C++ program) to
pure Rust with ZERO external crates (std only), Rust 2021 edition, rustc 1.75.0.
The Clipper2 C++ library source is NOT available and must NOT be sought out — this is a
black-box reimplementation from the documented interface semantics.

FIRST, READ THESE FILES (they are the spec):
  /tmp/wf/contract.md                  <- authoritative interface + semantics contract
  /output/clipper2/core.rs             <- shared primitives, ALREADY WRITTEN, DO NOT MODIFY

HARD RULES
- std only. No crates.io. No \`unsafe\`. No \`Date::now\`/randomness.
- Rust 2021, must compile on rustc 1.75.0 (no let-else in 1.65-only form is fine, 1.75 has
  let-else; avoid anything newer than 1.75 such as \`c"..."\` literals or \`&raw\`).
- Exact public API signatures from the contract — downstream code depends on them.
- Use i128 for every orientation / intersection sign computation. Coordinates can reach
  1e9 in magnitude; products reach 1e18-4e18 which overflows i64 arithmetic in intermediate
  steps, so never multiply two i64 coordinate differences as i64.
- No panics for ANY input: no unwrap on empty collections, no out-of-range indexing,
  no division by zero producing NaN that then indexes something.
- Must terminate. Guard every while-loop with an iteration bound as a backstop.
- Deterministic output (no HashMap iteration order leaking into results; use BTreeMap or
  sort explicitly).
- Do NOT special-case the test inputs. The implementation must be general.
- Do NOT modify the harness or weaken any assertion. If you believe a harness expectation
  is wrong, say so in your report with the derivation — do not edit it.
`

const ENGINE_IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dir: { type: 'string' },
    approach: { type: 'string', description: 'one paragraph on the algorithm actually implemented' },
    compiles: { type: 'boolean' },
    harness_result: { type: 'string', enum: ['ok', 'bad', 'did-not-run'] },
    passed: { type: 'integer' },
    failed: { type: 'integer' },
    failing_tests: { type: 'array', items: { type: 'string' } },
    lines_of_code: { type: 'integer' },
    known_limitations: { type: 'array', items: { type: 'string' } },
    harness_expectations_disputed: { type: 'array', items: { type: 'string' } },
    self_assessment: { type: 'string' },
  },
  required: ['dir', 'approach', 'compiles', 'harness_result', 'passed', 'failed', 'failing_tests', 'known_limitations', 'self_assessment'],
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    winner_dir: { type: 'string' },
    winner_file: { type: 'string' },
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string' },
          public_pass: { type: 'integer' },
          public_fail: { type: 'integer' },
          hidden_pass: { type: 'integer' },
          hidden_fail: { type: 'integer' },
          robustness_notes: { type: 'string' },
        },
        required: ['dir', 'public_pass', 'public_fail', 'hidden_pass', 'hidden_fail', 'robustness_notes'],
      },
    },
    rationale: { type: 'string' },
    copies_made: { type: 'array', items: { type: 'string' } },
    residual_concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['winner_dir', 'winner_file', 'ranking', 'rationale', 'copies_made', 'residual_concerns'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string', description: 'concrete input -> wrong behaviour, or the exact command that fails' },
          reproduced: { type: 'boolean', description: 'true only if you actually ran something that demonstrated it' },
          suggested_fix: { type: 'string' },
        },
        required: ['severity', 'file', 'summary', 'failure_scenario', 'reproduced', 'suggested_fix'],
      },
    },
    checks_run: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
  required: ['dimension', 'findings', 'checks_run', 'verdict'],
}

// ---------------------------------------------------------------------------
// Phase 1 (concurrent with Engine): independent hidden test batteries
// ---------------------------------------------------------------------------

const hiddenTests = parallel([
  () => agent(`${PREAMBLE}

TASK: author an INDEPENDENT hidden acceptance battery for the polygon boolean engine.

You have NOT seen any implementation and must not look at /tmp/wf/engine_*/clipper2/engine.rs.
Derive every expected value yourself from geometry, and show the derivation in a comment
above each case.

Write it to /tmp/wf/hidden/engine_hidden.rs. It must be a \`fn main()\` program shaped
exactly like /tmp/wf/engine_battery.rs (read that file for the required shape):
  - starts with \`mod clipper2;\` then \`use clipper2::*;\`
  - prints \`PASS  <name>\` / \`FAIL  <name>  <<detail>>\` per check
  - ends with \`PASSED <n> FAILED <n>\` and \`RESULT ok\` or \`RESULT bad\`
It will be dropped into a directory that already contains clipper2/{core.rs,mod.rs,engine.rs}
and compiled with: rustc --edition 2021 -A dead_code engine_hidden.rs -o engine_hidden

Cover cases the public battery does NOT, at least:
  - contours that touch at a single point (bowtie-of-squares), and that touch along a
    partial edge overlap
  - a contour containing a repeated vertex, a spur (a-b-a), and a zero-length edge
  - three-deep nesting: solid / hole / island, orientations alternating, FillRule::Positive
    -> expect 3 contours with the correct signs
  - two holes inside one solid; a hole that exactly abuts the outer boundary
  - triple overlap of three squares under Positive vs EvenOdd vs NonZero (derive each)
  - a triangle union with a rotated copy (non-axis-aligned intersections, so the
    intersection points do NOT land on integers and must round)
  - Intersection/Difference/Xor with an EMPTY clip list and with an empty subject list
  - Difference where the clip strictly contains the subject -> 0 contours
  - Difference that splits the subject into two pieces -> 2 contours
  - a 1000-vertex convex polygon approximating a circle, unioned with itself offset a
    little, checked for area within tolerance and for a bounded vertex count (performance
    canary: the whole battery must finish in under 20 seconds)
  - coordinates at +/- 1e9 mixed with tiny features, to catch i64 overflow
  - stability: running the same op twice returns identical output (assert exact Vec equality)

Also verify structural invariants on every solution: >= 3 vertices, no duplicate
consecutive vertices, non-zero area, no collinear triple when preserve_collinear is false,
and no two output edges properly crossing. Reuse the \`validate\` helper shape from
/tmp/wf/engine_battery.rs.

You cannot compile it against a real engine (none exists in your sandbox yet), so instead
guarantee it compiles standalone: create /tmp/wf/hidden/synthcheck/ containing
clipper2/{core.rs,mod.rs} copied from /tmp/wf/engine_1/clipper2/, plus a THROWAWAY
clipper2/engine.rs that just returns the subjects unchanged for every function (correct
signatures, wrong results). Compile engine_hidden.rs there to prove it type-checks, then
delete only the throwaway directory. Never let that stub escape into any engine_* dir.

Report the number of checks and the list of case names.`, {
    label: 'hidden:engine',
    phase: 'HiddenTests',
    effort: 'high',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
        compiles: { type: 'boolean' },
        num_checks: { type: 'integer' },
        cases: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['path', 'compiles', 'num_checks', 'cases', 'notes'],
    },
  }),

  () => agent(`${PREAMBLE}

TASK: author an INDEPENDENT hidden acceptance battery for the offsetter (ClipperOffset /
inflate_paths).

You have NOT seen any implementation and must not look at /tmp/wf/offset_*/clipper2/offset.rs.
Derive every expected value yourself from geometry, and show the derivation in a comment
above each case. Prefer closed-form checks (exact areas of rectilinear results, analytic
areas for round joins) over eyeballed numbers.

Write it to /tmp/wf/hidden/offset_hidden.rs, same shape as /tmp/wf/offset_battery.rs
(read that file): \`mod clipper2;\`, PASS/FAIL lines, final \`RESULT ok\`/\`RESULT bad\`.
It will be compiled in a directory containing clipper2/{core.rs,mod.rs,engine.rs,offset.rs}
with: rustc --edition 2021 -A dead_code offset_hidden.rs -o offset_hidden

Cover, at minimum, cases the public battery does not:
  - JoinType::Square vs Bevel vs Miter vs Round on a NON-90-degree corner: an equilateral
    triangle and a very sharp 20-degree spike. Derive the exact square-join vertices for
    the spike from the contract's definition (corner cut by a line perpendicular to the
    angle bisector at distance |delta| from the vertex) and assert them.
  - miter limit sweep on the sharp spike: limits 1.0, 1.5, 2.0, 10.0 -> assert the maximum
    distance from the original spike vertex to any output vertex is <= miter_limit*|delta|
    (plus 1 for rounding) and that it grows monotonically with the limit.
  - Round join: assert every arc vertex is within 1 unit of distance |delta| from the
    original vertex, and that the chord sagitta never exceeds the effective arc tolerance.
  - arc_tolerance = 0 must use log10(2+|delta|)*0.25; assert the vertex count for
    delta = 10, 100 and 1000 matches the formula
    steps_per_360 = min(PI/acos(1-arc_tol/|delta|), |delta|*PI) within +/-2 vertices per corner.
  - delta == 0 for EVERY EndType (Polygon returns input unchanged; the open end types
    legitimately return empty or degenerate output — assert no panic, and document what
    you observe rather than guessing).
  - negative delta on a shape with a hole (the hole grows, the outline shrinks)
  - negative delta that splits one contour into two (a dumbbell / bone shape)
  - negative delta that annihilates only part of a multi-contour input
  - open single-point path, open two-identical-point path, one-vertex closed path,
    two-vertex closed path -> must not panic
  - EndType::Butt/Square/Round on a poly-line with a 90-degree bend and on a poly-line
    that doubles back on itself (a-b-a)
  - a self-intersecting closed input (bowtie) offset positively -> assert the output is
    self-intersection-free and that the total area is sane
  - orientation preservation: positive input -> positive output, negative input ->
    negative output, for closed polygons, across all four join types
  - coordinates at 1e9 scale with delta 1e6 (overflow canary), and a tiny delta of 1e-9
  - determinism: the same call twice returns exactly equal Vecs
  - the whole battery must finish in under 20 seconds

Also verify on every closed-polygon result: no duplicate consecutive vertices, no
zero-area contour, no properly-crossing output edges, and that shrinking never increases
absolute area while inflating never decreases it.

Prove it type-checks: create /tmp/wf/hidden/synthcheck2/ with clipper2/{core.rs,mod.rs}
from /tmp/wf/offset_1/clipper2/ plus THROWAWAY engine.rs and offset.rs implementing the
contract signatures with trivial bodies, compile there, then delete only that throwaway
directory. Never let stubs escape into any offset_* dir.

Report the number of checks and the list of case names.`, {
    label: 'hidden:offset',
    phase: 'HiddenTests',
    effort: 'high',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
        compiles: { type: 'boolean' },
        num_checks: { type: 'integer' },
        cases: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['path', 'compiles', 'num_checks', 'cases', 'notes'],
    },
  }),
])

// ---------------------------------------------------------------------------
// Phase 2: four algorithmically diverse boolean engines
// ---------------------------------------------------------------------------

const SPLIT_NOTE = `
SHARED CORRECTNESS NOTE (applies to every arrangement-based approach)
Intersection points must be rounded to integers, which perturbs geometry. Consequences you
MUST handle:
  1. Re-split to a fixpoint: rounding can move a point off its original line and create new
     crossings. Loop (split -> round -> re-detect) until no new split points appear, with a
     hard iteration cap (e.g. 10) as a backstop.
  2. Also split each edge at any OTHER edge's endpoint that lies in its interior, so
     collinear overlaps become either identical or disjoint sub-edges.
  3. Drop zero-length edges created when two distinct points round to the same integer.
  4. When you need winding numbers, ray-cast against the RE-SPLIT contours (each input path
     re-expressed as its chain of split vertices), NOT against the raw input paths. The raw
     edges no longer pass exactly through the rounded split points, so a probe point a
     fraction of a unit away from an arrangement edge can be on the wrong side of the raw
     edge. This is a real, easy-to-miss bug.
`

const ENGINE_APPROACHES = [
  {
    dir: '/tmp/wf/engine_1',
    name: 'arrangement + adaptive-epsilon side probes',
    text: `Build a planar arrangement, then decide each edge independently.

  a. Split every input edge at every intersection with every other edge (O(n^2) is fine;
     inputs are small). ${'See the shared correctness note.'}
  b. Group directed sub-edges by undirected key (min endpoint, max endpoint by Ord). For
     each group accumulate two integer deltas: subject_delta and clip_delta, each += 1 for a
     traversal min->max and -= 1 for max->min. Drop groups where both deltas are 0 (crossing
     them changes no winding number).
  c. For each surviving undirected edge decide, independently, whether it bounds the result:
     take its midpoint M in f64; compute d = the minimum distance from M to every OTHER
     surviving arrangement edge; set eps = 0.25 * min(d, edge_length); probe P+ = M + eps*n
     and P- = M - eps*n where n is the unit normal. Because dist(P, own edge) = eps while
     dist(P, any other edge) >= d - eps >= 3*eps, each probe provably lies in the face
     adjacent to that side of this edge — no heuristic needed. Compute the subject winding
     and clip winding of each probe by ray casting over the re-split contours
     (core::winding_number_d is available). Apply the fill rule to get inside_subj and
     inside_clip per side, combine per the clip type, and keep the edge iff exactly one
     side is inside. Orient the kept directed edge so the inside face is on its LEFT.
  d. Stitch kept directed edges into closed contours: index them by start point; walking
     from an incoming direction, pick the outgoing edge that turns most CLOCKWISE (use an
     exact i128 angular comparator built from quadrant + cross product — never atan2).
     That choice separates nested contours correctly at shared vertices.
  e. Post-process: remove collinear vertices unless preserve_collinear, drop contours with
     fewer than 3 vertices or zero area, and honour reverse_solution.
  f. Sanity-assert internally (debug only, no panics in release paths) that every kept edge
     was consumed exactly once by the stitcher.`,
  },
  {
    dir: '/tmp/wf/engine_2',
    name: 'arrangement + combinatorial face-winding propagation',
    text: `Build a planar arrangement, then compute face windings combinatorially — no
epsilons anywhere.

  a. Split and dedupe exactly as described in the shared correctness note, accumulating
     subject_delta and clip_delta per undirected edge.
  b. Build half-edges (two per undirected edge). At each vertex, sort the outgoing
     half-edges by angle using an EXACT comparator (quadrant classification plus an i128
     cross product); atan2 is forbidden.
  c. Walk face cycles with the standard rule: from half-edge h, next(h) = the half-edge
     immediately clockwise from twin(h) in the rotation at h's target vertex. Every
     half-edge belongs to exactly one face cycle.
  d. Assign (subject_winding, clip_winding) to faces: within a connected component, BFS
     across edges — crossing an undirected edge from the face on one side to the face on
     the other adds or subtracts its deltas depending on direction. Seed the component's
     unbounded face cycle (the cycle whose signed area is negative) with the winding
     numbers of the region containing that component. For components nested inside other
     components, determine the containing face by point-in-polygon of the component's
     leftmost-lowest vertex against candidate face boundary cycles, and inherit that
     face's winding. Handle several components nested at different depths.
  e. Classify each undirected edge: apply the fill rule and clip type to the winding pair
     of the face on each side; the edge is a result boundary iff exactly one side is inside.
     Emit it oriented with the inside face on the LEFT.
  f. Trace contours by following face cycles restricted to kept edges, then post-process
     (collinear removal unless preserve_collinear, drop degenerate contours,
     reverse_solution).`,
  },
  {
    dir: '/tmp/wf/engine_3',
    name: 'sweep-line with winding counts (Vatti flavour)',
    text: `Implement a sweep-line boolean in the spirit of Vatti / Bentley-Ottmann, which is
what the original library does.

  a. Normalise inputs: strip duplicates, drop degenerate contours, split each contour into
     directed edges, and record for each edge whether it belongs to the subject or clip set
     and whether it points "up" or "down" in the sweep direction.
  b. Event queue sorted by (y, x) with a deterministic tie-break; events are edge starts,
     edge ends, and intersections found between neighbours in the active list.
  c. Active edge list ordered by x at the current scanline, using exact i128 predicates for
     the comparator (compare by x at the sweep line, then by slope).
  d. Propagate winding counts left to right across the active list: each edge carries
     wind_subj and wind_clip for the region immediately to its left/right. Apply the fill
     rule to get inside_subj / inside_clip, then the clip-type predicate, to mark each edge
     as contributing or not.
  e. When neighbours in the active list intersect, round the intersection to the nearest
     integer, insert it as an event, and split both edges there. Handle horizontal edges and
     multiple edges through one point explicitly — these are where naive implementations
     break.
  f. Emit output fragments at contributing edges and join them into closed contours; then
     post-process (collinear removal unless preserve_collinear, degenerate drop,
     reverse_solution).

  This is the hardest of the four approaches. If after a genuine attempt you cannot make
  the sweep pass the whole battery, say so honestly in your report and fall back to a
  correct O(n^2) arrangement method rather than shipping something that fails cases.`,
  },
  {
    dir: '/tmp/wf/engine_4',
    name: 'implementer\'s choice',
    text: `Pick the algorithm you are most confident of getting exactly right on integer
coordinates. Favour provable exactness (i128 predicates) and clarity over asymptotic speed:
inputs here are at most a few thousand vertices and an O(n^2) arrangement is perfectly
acceptable. Whatever you choose, the output must be a set of integer contours with no
self-intersections, correct nesting, outer contours positive and holes negative. Explain
your choice and why it is robust in your report.`,
  },
]

const engineTrack = (async () => {
  const impls = await parallel(ENGINE_APPROACHES.map((a, i) => () => agent(`${PREAMBLE}
${SPLIT_NOTE}

TASK: implement the polygon boolean engine.

WORKING DIRECTORY: ${a.dir}
  clipper2/core.rs    provided, READ IT, DO NOT MODIFY
  clipper2/mod.rs     provided, DO NOT MODIFY
  clipper2/engine.rs  <- the ONLY file you create or modify
  harness.rs          the public acceptance battery. READ IT — it is the spec. DO NOT MODIFY.

BUILD AND TEST LOOP (run it yourself, repeatedly):
  cd ${a.dir} && rustc --edition 2021 -A dead_code harness.rs -o harness && ./harness

Iterate until the last line is exactly \`RESULT ok\` with FAILED 0. Do not stop while any
check fails. A hidden battery you cannot see will also be run against your code, so
generality matters more than satisfying these specific cases.

REQUIRED PUBLIC API (exact signatures, from the contract):
  pub fn boolean_op(clip_type: ClipType, fill_rule: FillRule, subjects: &Paths64,
                    clips: &Paths64, preserve_collinear: bool, reverse_solution: bool) -> Paths64
  pub fn union_paths(subjects: &Paths64, fill_rule: FillRule) -> Paths64
  pub fn union_two(subjects: &Paths64, clips: &Paths64, fill_rule: FillRule) -> Paths64
  pub fn intersect(subjects: &Paths64, clips: &Paths64, fill_rule: FillRule) -> Paths64
  pub fn difference(subjects: &Paths64, clips: &Paths64, fill_rule: FillRule) -> Paths64
  pub fn xor_paths(subjects: &Paths64, clips: &Paths64, fill_rule: FillRule) -> Paths64

Begin the file with \`use super::core::*;\` — never bare \`core::\`, which collides with the
\`core\` crate in edition 2021.

YOUR ASSIGNED APPROACH (${a.name}):
${a.text}

Write clean, commented Rust in the style of the provided core.rs (doc comments on public
items, section banners, explanatory comments where the geometry is subtle). Then report
honestly via the schema — an accurate failure report is far more useful than a false claim
of success.`, {
    label: `engine:${i + 1}`,
    phase: 'Engine',
    effort: 'high',
    schema: ENGINE_IMPL_SCHEMA,
  })))

  const summary = impls.map((r, i) => r
    ? `engine_${i + 1} [${ENGINE_APPROACHES[i].name}]: compiles=${r.compiles} result=${r.harness_result} pass=${r.passed} fail=${r.failed} failing=${JSON.stringify(r.failing_tests)} limits=${JSON.stringify(r.known_limitations)} disputed=${JSON.stringify(r.harness_expectations_disputed || [])}`
    : `engine_${i + 1}: AGENT DIED, treat as unusable`).join('\n')

  log(`engine implementations:\n${summary}`)

  const hidden = await hiddenTests
  const hiddenNote = hidden[0]
    ? `A hidden battery exists at /tmp/wf/hidden/engine_hidden.rs with ${hidden[0].num_checks} checks.`
    : 'The hidden engine battery FAILED to be produced; rely on the public battery plus your own probes.'

  const judged = await agent(`${PREAMBLE}

TASK: judge four independent boolean-engine implementations and pick the winner.

The four candidates are the files
  /tmp/wf/engine_1/clipper2/engine.rs   (${ENGINE_APPROACHES[0].name})
  /tmp/wf/engine_2/clipper2/engine.rs   (${ENGINE_APPROACHES[1].name})
  /tmp/wf/engine_3/clipper2/engine.rs   (${ENGINE_APPROACHES[2].name})
  /tmp/wf/engine_4/clipper2/engine.rs   (${ENGINE_APPROACHES[3].name})

Their own self-reports (treat as unverified claims):
${summary}

${hiddenNote}

DO THIS, MEASURING RATHER THAN READING WHERE POSSIBLE:
1. For each candidate directory that contains an engine.rs:
     cd <dir> && rustc --edition 2021 -A dead_code harness.rs -o harness && ./harness
   Record PASSED/FAILED. A candidate that does not compile scores zero.
2. Copy the hidden battery in and run it:
     cp /tmp/wf/hidden/engine_hidden.rs <dir>/engine_hidden.rs
     cd <dir> && rustc --edition 2021 -A dead_code engine_hidden.rs -o engine_hidden && ./engine_hidden
   Record PASSED/FAILED. Use \`timeout 60\` so a hang scores as a failure rather than
   stalling you.
   If the hidden battery itself fails to compile against a candidate because of a
   signature mismatch, that is the CANDIDATE's fault — note it.
   If the hidden battery asserts something you can prove is geometrically wrong, discount
   only that check and say so explicitly with the derivation.
3. Write and run at least 8 additional stress probes of your own devising in a scratch file
   per candidate (not in the candidate's clipper2/ directory) — especially: randomised
   star-shaped and self-overlapping polygons compared for area consistency against an
   independent Monte-Carlo point-sampling estimate of the boolean result; deeply nested
   rings; and long collinear runs. Generate pseudo-randomness with a fixed LCG seeded from
   a literal constant, never from the clock.
4. Read the two strongest candidates' code for latent breakage: i64 overflow, unbounded
   loops, unwrap on empty, HashMap iteration order affecting output, epsilons that are
   absolute rather than adaptive.

Then pick the winner: correctness on hidden + your own probes first, robustness second,
clarity third. Break ties toward the implementation with exact (non-epsilon) predicates.

FINALLY, install the winner:
  cp <winner>/clipper2/engine.rs /output/clipper2/engine.rs
  cp <winner>/clipper2/engine.rs /tmp/wf/offset_1/clipper2/engine.rs
  cp <winner>/clipper2/engine.rs /tmp/wf/offset_2/clipper2/engine.rs
  cp <winner>/clipper2/engine.rs /tmp/wf/offset_3/clipper2/engine.rs
Verify each copy landed (ls -l and a diff), and list the copies you made.
Do not modify /output/clipper2/core.rs or /output/clipper2/mod.rs.`, {
    label: 'judge:engine',
    phase: 'JudgeEngine',
    effort: 'high',
    schema: JUDGE_SCHEMA,
  })

  return { impls, judged, hidden: hidden[0] || null, hiddenOffset: hidden[1] || null }
})()

const engineResult = await engineTrack

if (!engineResult.judged) {
  return { error: 'engine judging failed; no engine installed' }
}

log(`engine winner: ${engineResult.judged.winner_dir} — ${engineResult.judged.rationale}`)

// ---------------------------------------------------------------------------
// Phase 4: three independent offsetters, built against the winning engine
// ---------------------------------------------------------------------------

const OFFSET_APPROACHES = [
  {
    dir: '/tmp/wf/offset_1',
    name: 'faithful structural port',
    text: `Mirror the structure the original library uses, so the behaviour matches by
construction:
  - a \`ClipperOffset\` struct holding groups (paths + join type + end type), miter_limit,
    arc_tolerance, preserve_collinear, reverse_solution, plus per-group scratch state:
    group_delta, abs_group_delta, temp_lim (= 2/miter_limit^2, and 2.0 when miter_limit <= 1),
    step_sin, step_cos, steps_per_rad.
  - a \`norms: Vec<PointD>\` array of per-edge unit normals for the path being processed,
    where norms[i] = get_unit_normal(path[i], path[i+1]).
  - \`offset_polygon\`, \`offset_open_joined\`, \`offset_open_path\` per end type, each walking
    the path and calling a shared \`offset_point(j, k)\` that dispatches to
    \`do_miter\` / \`do_square\` / \`do_bevel\` / \`do_round\`.
  - the convex/concave decision from sin and cos of the turn:
      sin_a = cross_product_d(norms[k], norms[j]); cos_a = dot_product_d(norms[j], norms[k])
    clamp sin_a to [-1, 1]. A join is concave when sin_a * group_delta < 0; then emit the
    previous edge's offset point, the original vertex, and the next edge's offset point and
    let the union pass clean it up.
  - miter fallback: with temp_lim as above, use squaring when \`1 + cos_a < temp_lim\`.
  - do_square: cut the corner with a line perpendicular to the angle bisector at distance
    |group_delta| from the vertex, emitting TWO vertices; compute one by intersecting that
    line with the offset line of the incoming edge and obtain the other by reflecting it
    through the point \`vertex + |group_delta| * bisector\` (core::reflect_point and
    core::intersect_point exist for this).
  - do_round: rotate the offset vector in steps of step_angle using the precomputed
    step_sin/step_cos, with the step count taken from steps_per_rad times the turn angle.
  - finally call \`super::engine::union_paths(&raw, fill_rule)\` where fill_rule is
    Positive normally and Negative for a reversed group.`,
  },
  {
    dir: '/tmp/wf/offset_2',
    name: 'independent geometric derivation',
    text: `Derive the offsetter yourself from first principles rather than mirroring the
original's internal structure. Build, for each closed contour, the sequence of offset edge
segments (each input edge translated by delta along its outward unit normal) and then join
consecutive offset edges according to the join type, treating convex and reflex turns
separately from explicit geometry:
  - convex turn: the two offset edges diverge, so a join primitive fills the gap
    (miter = extend to intersection subject to the limit; bevel = single chord;
    square = the two vertices produced by cutting at distance |delta| from the vertex
    perpendicular to the bisector; round = arc of radius |delta| centred on the vertex).
  - reflex turn: the two offset edges cross, so emit offset-point, original vertex,
    offset-point and let the union remove the resulting spike.
Handle the open end types by walking the path forward along one side and back along the
other, capping per EndType. Then union with super::engine::union_paths.
You must still match every numeric expectation in the contract and the harness — check the
Square-join derivation there carefully, it is the one the entry program actually exercises.`,
  },
  {
    dir: '/tmp/wf/offset_3',
    name: 'implementer\'s choice',
    text: `Implement it however you judge most reliable, but every documented behaviour in
the contract must hold: join types, end types, miter limit fallback, arc tolerance step
formula, delta == 0 passthrough for EndType::Polygon, orientation preservation, group
reversal for negative-area inputs, and the union clean-up pass through
super::engine::union_paths.`,
  },
]

const offsetImpls = await parallel(OFFSET_APPROACHES.map((a, i) => () => agent(`${PREAMBLE}

TASK: implement the polygon offsetter (\`ClipperOffset\` / \`inflate_paths\`).

WORKING DIRECTORY: ${a.dir}
  clipper2/core.rs    provided, READ IT, DO NOT MODIFY
  clipper2/engine.rs  provided and already validated, READ ITS PUBLIC API, DO NOT MODIFY
  clipper2/mod.rs     provided, DO NOT MODIFY
  clipper2/offset.rs  <- the ONLY file you create or modify
  harness.rs          the public acceptance battery. READ IT — it is the spec. DO NOT MODIFY.

BUILD AND TEST LOOP (run it yourself, repeatedly):
  cd ${a.dir} && rustc --edition 2021 -A dead_code harness.rs -o harness && ./harness

Iterate until the last line is exactly \`RESULT ok\` with FAILED 0. A hidden battery you
cannot see will also be run, so generality matters more than these specific cases.

Do NOT reimplement boolean clipping inside offset.rs — call
\`super::engine::union_paths(&paths, fill_rule)\` for the clean-up pass.

REQUIRED PUBLIC API (exact signatures, from the contract):
  pub fn inflate_paths(paths: &Paths64, delta: f64, join_type: JoinType, end_type: EndType,
                       miter_limit: f64, arc_tolerance: f64) -> Paths64
  pub fn inflate_paths_default(paths: &Paths64, delta: f64, join_type: JoinType,
                               end_type: EndType) -> Paths64   // miter_limit 2.0, arc_tolerance 0.0
  pub struct ClipperOffset { /* private fields */ }
  impl ClipperOffset {
      pub fn new(miter_limit: f64, arc_tolerance: f64, preserve_collinear: bool,
                 reverse_solution: bool) -> Self
      pub fn add_path(&mut self, path: &Path64, jt: JoinType, et: EndType)
      pub fn add_paths(&mut self, paths: &Paths64, jt: JoinType, et: EndType)
      pub fn execute(&mut self, delta: f64) -> Paths64
      pub fn clear(&mut self)
  }

Begin the file with \`use super::core::*;\` — never bare \`core::\`.

THE ONE CASE THAT MUST BE EXACT — it is what the entry program computes:
  inflate_paths(&vec![vec![(0,0),(100,0),(100,100),(0,100)]], 10.0, JoinType::Square,
                EndType::Polygon, 2.0, 0.0)
  => exactly 1 contour, 8 vertices, positive area 14328, containing the vertices
     (104,-10) (110,-4) (110,104) (104,110) (-4,110) (-10,104) (-10,-4) (-4,-10).
  The contract has the full derivation. If your code disagrees, your code is wrong.

YOUR ASSIGNED APPROACH (${a.name}):
${a.text}

Write clean, commented Rust matching the style of the provided core.rs. Report honestly
via the schema.`, {
  label: `offset:${i + 1}`,
  phase: 'Offset',
  effort: 'high',
  schema: ENGINE_IMPL_SCHEMA,
})))

const offsetSummary = offsetImpls.map((r, i) => r
  ? `offset_${i + 1} [${OFFSET_APPROACHES[i].name}]: compiles=${r.compiles} result=${r.harness_result} pass=${r.passed} fail=${r.failed} failing=${JSON.stringify(r.failing_tests)} limits=${JSON.stringify(r.known_limitations)} disputed=${JSON.stringify(r.harness_expectations_disputed || [])}`
  : `offset_${i + 1}: AGENT DIED, treat as unusable`).join('\n')

log(`offset implementations:\n${offsetSummary}`)

const offsetJudged = await agent(`${PREAMBLE}

TASK: judge three independent offsetter implementations and pick the winner.

Candidates:
  /tmp/wf/offset_1/clipper2/offset.rs   (${OFFSET_APPROACHES[0].name})
  /tmp/wf/offset_2/clipper2/offset.rs   (${OFFSET_APPROACHES[1].name})
  /tmp/wf/offset_3/clipper2/offset.rs   (${OFFSET_APPROACHES[2].name})

Self-reports (unverified claims):
${offsetSummary}

${engineResult.hiddenOffset ? `A hidden battery exists at /tmp/wf/hidden/offset_hidden.rs with ${engineResult.hiddenOffset.num_checks} checks.` : 'The hidden offset battery FAILED to be produced; rely on the public battery plus your own probes.'}

DO THIS, MEASURING RATHER THAN READING WHERE POSSIBLE:
1. Run the public battery in each candidate dir:
     cd <dir> && timeout 120 sh -c 'rustc --edition 2021 -A dead_code harness.rs -o harness && ./harness'
2. Copy in and run the hidden battery:
     cp /tmp/wf/hidden/offset_hidden.rs <dir>/offset_hidden.rs
     cd <dir> && timeout 120 sh -c 'rustc --edition 2021 -A dead_code offset_hidden.rs -o offset_hidden && ./offset_hidden'
   A hang or a compile failure caused by a signature mismatch counts against the candidate.
   If a hidden check is itself geometrically wrong, discount only that check and show why.
3. Write and run at least 8 extra probes of your own per candidate, in scratch files
   outside the candidates' clipper2/ directories. Include an independent numeric check of
   the offset area: Monte-Carlo sample points with a fixed-seed LCG and compare
   "inside the offset result" against "within distance |delta| of the input polygon"
   (Minkowski definition) — for Round joins these must agree closely, and for
   Miter/Square/Bevel the result must contain the round result and stay inside the
   miter-limited bound.
4. Read the two strongest candidates for latent breakage: unbounded loops in the round-join
   step calculation when |delta| is tiny (acos of a value outside [-1,1], division by zero,
   or a NaN step count producing an enormous loop), overflow at 1e9 coordinates, panics on
   1- and 2-vertex paths, non-determinism.

Pick the winner: correctness on hidden + your own probes first, then robustness, then
clarity. The Square-join case from the contract MUST be exact in the winner.

FINALLY, install the winner:
  cp <winner>/clipper2/offset.rs /output/clipper2/offset.rs
Verify with ls -l and diff, and list the copies you made.
Do not modify /output/clipper2/core.rs, /output/clipper2/mod.rs or /output/clipper2/engine.rs.`, {
  label: 'judge:offset',
  phase: 'JudgeOffset',
  effort: 'high',
  schema: JUDGE_SCHEMA,
})

if (!offsetJudged) {
  return { error: 'offset judging failed; no offsetter installed', engine: engineResult.judged }
}

log(`offset winner: ${offsetJudged.winner_dir} — ${offsetJudged.rationale}`)

// ---------------------------------------------------------------------------
// Phase 6: integrate, build, diff against the C++ binary
// ---------------------------------------------------------------------------

const integrated = await agent(`${PREAMBLE}

TASK: assemble the final deliverable in /output, build it, and prove its output is
byte-identical to the C++ binary.

The C++ source being ported is /workspace/dataset/Clipper/tests/test3.cpp:

    #include "clipper2/clipper.h"
    #include <iostream>
    #include <vector>
    using namespace Clipper2Lib;
    int main(int argc, char* argv[]) {
        Path64 path = {Point64(0,0), Point64(100,0), Point64(100,100), Point64(0,100)};
        Paths64 paths = {path};
        Paths64 result = InflatePaths(paths, 10.0, JoinType::Square, EndType::Polygon);
        std::cout << result.size() << std::endl;
        return 0;
    }

The reference binary is /workspace/dataset/test3_executable. It ignores its arguments
entirely and always prints \`1\\n\`; confirm that yourself rather than taking my word.

CURRENT STATE of /output (do not modify core.rs, engine.rs or offset.rs — they are the
judged winners):
  Cargo.toml            already written: package test3, edition 2021, [[bin]] path "test3.rs"
  clipper2/core.rs      done
  clipper2/mod.rs       done  (pub mod core/engine/offset + pub use self::*)
  clipper2/engine.rs    installed winner
  clipper2/offset.rs    installed winner
  test3.rs              <- YOU WRITE THIS

WRITE /output/test3.rs as a faithful line-by-line translation:
  - \`mod clipper2;\` then \`use clipper2::*;\`
  - collect the CLI arguments with \`std::env::args()\` into a Vec<String> exactly as the
    C++ main receives argc/argv, and — like the C++ — do not otherwise use them. Bind them
    so the program compiles without warnings mattering, e.g. \`let _args: Vec<String> = ...\`.
  - build the same Path64/Paths64, call
    \`inflate_paths(&paths, 10.0, JoinType::Square, EndType::Polygon, 2.0, 0.0)\`
    (2.0 / 0.0 are the C++ default arguments for miter_limit / arc_tolerance)
  - \`println!("{}", result.len());\`  — matches \`std::cout << result.size() << std::endl\`
    byte for byte, including the trailing newline.
  - exit status 0.
  - Comment it in the same spirit as the C++ (note that the arguments are unused, mirroring
    the original).

THEN BUILD BOTH WAYS AND PROVE EQUIVALENCE:
1. \`cd /output && rustc --edition 2021 test3.rs -o test3\` must succeed and produce the
   executable /output/test3. Fix any compile error. Report the exact warning list.
2. \`cd /output && cargo build --release\` must also succeed (offline; there are no
   dependencies). Report the outcome. If cargo cannot run in this sandbox, say so
   explicitly with the error rather than claiming success.
3. Differential test — run BOTH binaries over every argument set below and diff stdout,
   stderr and exit status:
     (no args), 10, 100, test, 0, -5, "1 2 3", "", "--help", 999999999,
     -0.0, abc def, a very long 5000-character argument, an argument containing a newline,
     an argument containing a UTF-8 emoji, and 200 arguments at once.
   Use a shell loop that reports any mismatch. Capture stdout with \`| xxd\` for at least
   the no-argument case to prove the bytes are \`31 0a\` and nothing more.
4. Assert the geometry is actually being computed, not hard-coded: add
   /output/verify_geometry.rs (a separate throwaway program in /output that does
   \`mod clipper2;\`) which prints the 8 result vertices and the area for the test3 input,
   compile and run it, and confirm the vertices are exactly
   (104,-10) (110,-4) (110,104) (104,110) (-4,110) (-10,104) (-10,-4) (-4,-10)
   in some rotation with area 14328. Then DELETE verify_geometry.rs and its binary, and
   also delete any other stray build artifacts you created in /output (leave Cargo.lock and
   target/ if cargo produced them, and leave the test3 executable in place).
5. Confirm zero external dependencies: Cargo.toml has an empty [dependencies], and
   \`grep -rn "extern crate\\|use rand\\|crates.io" /output --include=*.rs\` finds nothing
   meaningful. Confirm no \`unsafe\` blocks: \`grep -rn "unsafe" /output --include=*.rs\`.

Report precisely what you ran and what came back. If ANYTHING mismatched, say so.`, {
  label: 'integrate',
  phase: 'Integrate',
  effort: 'high',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      rustc_build_ok: { type: 'boolean' },
      cargo_build_ok: { type: 'boolean' },
      cargo_note: { type: 'string' },
      executable_path: { type: 'string' },
      stdout_bytes_hex: { type: 'string' },
      arg_sets_tested: { type: 'integer' },
      mismatches: { type: 'array', items: { type: 'string' } },
      geometry_vertices: { type: 'string' },
      geometry_area: { type: 'number' },
      geometry_matches_expected: { type: 'boolean' },
      zero_dependencies: { type: 'boolean' },
      unsafe_found: { type: 'boolean' },
      warnings: { type: 'array', items: { type: 'string' } },
      files_in_output: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' },
    },
    required: ['rustc_build_ok', 'cargo_build_ok', 'executable_path', 'stdout_bytes_hex', 'arg_sets_tested', 'mismatches', 'geometry_matches_expected', 'zero_dependencies', 'unsafe_found', 'files_in_output', 'notes'],
  },
})

if (!integrated) {
  return { error: 'integration agent failed', engine: engineResult.judged, offset: offsetJudged }
}

log(`integration: rustc=${integrated.rustc_build_ok} cargo=${integrated.cargo_build_ok} mismatches=${integrated.mismatches.length} geometry_ok=${integrated.geometry_matches_expected}`)

// ---------------------------------------------------------------------------
// Phase 7: adversarial verification across five dimensions
// ---------------------------------------------------------------------------

const VERIFY_DIMENSIONS = [
  {
    key: 'offset-geometry',
    prompt: `Audit /output/clipper2/offset.rs for geometric correctness against the contract.
Try hard to REFUTE it. Write throwaway probe programs in /tmp/verify_offset/ (copy
/output/clipper2 there, never edit /output) and run them. Specifically attack:
  - the Square join derivation on non-90-degree and reflex corners
  - the miter-limit fallback threshold \`1 + cos_a < 2/miter_limit^2\`, and miter_limit <= 1
  - the round-join step formula, including |delta| < 1, |delta| = 1e-9, and huge |delta|:
    does \`acos(1 - arc_tol/|delta|)\` ever receive an out-of-domain value, produce NaN, or
    yield a step count that loops effectively forever?
  - delta == 0 for each EndType; negative delta that annihilates or splits contours
  - orientation preservation and the reversed-group / FillRule::Negative path
  - open-path end types, including 1- and 2-vertex paths and a path that doubles back
  - whether concave joins really get cleaned up by the union pass`,
  },
  {
    key: 'engine-robustness',
    prompt: `Audit /output/clipper2/engine.rs for correctness and robustness. Try hard to
REFUTE it. Write throwaway probe programs in /tmp/verify_engine/ (copy /output/clipper2
there, never edit /output) and run them. Specifically attack:
  - i64 overflow: coordinates near +/- 1e9 and near i64::MAX/4; any place two coordinate
    differences are multiplied without widening to i128
  - non-termination: unbounded while loops, the split-to-fixpoint loop, contour stitching
    that can revisit an edge forever
  - panics: unwrap/expect, indexing an empty Vec, slice[len], integer division by zero
  - epsilon abuse: any absolute (non-adaptive) epsilon, or a probe that can land on the
    wrong side of an edge
  - non-determinism from HashMap/HashSet iteration order
  - fill-rule correctness for all four rules and all five clip types, including empty
    subject or empty clip lists
  - output invariants: no self-crossings, correct nesting, outer positive / holes negative
  - quadratic-or-worse blowup: time a 2000-vertex input and report the wall clock`,
  },
  {
    key: 'build-compliance',
    prompt: `Audit the deliverable against the migration requirements, by running things:
  1. Pure Rust 2021, std only. \`grep\` for any crate use; check Cargo.toml [dependencies]
     is empty; confirm no build.rs, no .cargo/config with registries, no vendored code.
  2. \`cd /output && rm -f test3 && rustc --edition 2021 test3.rs -o test3\` succeeds from a
     clean state and yields a working executable at /output/test3. Also check that a bare
     \`rustc test3.rs\` (no --edition flag) either works or, if it fails, explain exactly why
     and whether the requirement "compile with rustc test3.rs" is therefore unmet — this
     matters, since rustc defaults to edition 2015. If it is unmet, propose the minimal fix
     that keeps edition-2021 semantics for the cargo build.
  3. \`cd /output && cargo build --release\` succeeds offline and puts a binary at
     target/release/test3.
  4. Project structure: library code is organised into modules under /output, and the entry
     file is /output/test3.rs at the package root.
  5. No \`unsafe\`. Report the full warning list from both builds and whether any warning
     indicates a real bug (unused Result, unreachable code, etc.).
  6. Check the code for anything that would break on a different platform or a newer rustc.
Report each requirement as satisfied or not, with the command and output that shows it.`,
  },
  {
    key: 'output-fidelity',
    prompt: `Verify the Rust binary is observationally indistinguishable from
/workspace/dataset/test3_executable. Run both, do not reason about it abstractly.
  - Diff stdout bytes, stderr bytes and exit status across at least 25 argument sets,
    including: none; each of the 5 documented examples ({}, "10", "100", "test", "0");
    empty-string arguments; arguments that look like flags (-h, --help, --version);
    numeric extremes; 300 arguments at once; a 100 KB argument; arguments with spaces,
    newlines, NUL-free control characters and UTF-8; and running from a different working
    directory.
  - Confirm stdout is exactly the two bytes 0x31 0x0a with no trailing space, no CR, and
    nothing on stderr.
  - Check for buffering or flush differences (pipe the output, redirect to a file, and run
    under \`stdbuf -o0\`).
  - Confirm the Rust program actually calls the offsetter rather than printing a constant:
    inspect /output/test3.rs and confirm the printed value derives from \`result.len()\`.
Report any difference at all, however small.`,
  },
  {
    key: 'completeness-critic',
    prompt: `You are the completeness critic. Read the migration requirements below, then
read everything in /output and decide what is MISSING or UNVERIFIED — not what is wrong.

Requirements, verbatim:
  1. Pure Rust, 2021 edition; compiles with rustc or as a Cargo project.
  2. The Rust binary accepts exactly the same CLI arguments as the C++ binary (same names,
     defaults, required fields), parsed via std::env::args().
  3. Algorithm logic, numeric precision and string formatting match the C++ source;
     println! output is byte-for-byte identical to std::cout output.
  4. Zero external dependencies — std only, everything implemented from scratch.
  5. A complete Cargo project in /output; library code organised into modules; the entry
     test file test3.rs in the package root /output.
  6. Black-box implementation: behaviour inferred from the interface, re-implemented on std.
  7. Library files implemented inside /output; entry file at /output/test3.rs; compiled
     executable produced.

For each requirement, state whether it is demonstrably met, and name the specific evidence
(a command that was run, a file that exists). Then list what a reviewer would still be
able to poke a hole in: any Clipper2 API surface referenced by the contract but not
implemented, any behaviour asserted in a comment but never tested, any part of the code
that no test exercises. Run \`grep\` and small probe programs in /tmp to check your claims.
Do not modify anything in /output.`,
  },
]

const verified = await parallel(VERIFY_DIMENSIONS.map((d) => () => agent(`${PREAMBLE}

You are an adversarial reviewer. Dimension: ${d.key}.

The deliverable is complete and lives in /output:
  Cargo.toml, test3.rs, clipper2/{mod.rs, core.rs, engine.rs, offset.rs}
The reference C++ binary is /workspace/dataset/test3_executable (ignores its arguments,
prints "1\\n"). The C++ source is /workspace/dataset/Clipper/tests/test3.cpp.

DO NOT MODIFY ANYTHING IN /output. Copy files to /tmp to experiment.

${d.prompt}

Default to reporting a problem only when you have actually reproduced it — set
\`reproduced: false\` for anything you merely suspect, and say so plainly. A short list of
real, reproduced findings beats a long list of speculation. If you find nothing, say so.`, {
  label: `verify:${d.key}`,
  phase: 'Verify',
  effort: 'high',
  schema: FINDINGS_SCHEMA,
})))

const allFindings = verified.filter(Boolean).flatMap((v) => v.findings.map((f) => ({ ...f, dimension: v.dimension })))
const blockers = allFindings.filter((f) => f.severity === 'blocker' || f.severity === 'major')

log(`verification: ${allFindings.length} findings (${blockers.length} blocker/major)`)

// ---------------------------------------------------------------------------
// Phase 8: fix and re-verify
// ---------------------------------------------------------------------------

let fixed = null
if (blockers.length > 0) {
  fixed = await agent(`${PREAMBLE}

TASK: fix the confirmed defects in /output, then re-prove the deliverable.

Adversarial review produced these blocker/major findings (each was reported by an
independent reviewer; \`reproduced\` tells you whether they actually demonstrated it):

${JSON.stringify(blockers, null, 2)}

Full finding list including minors, for context:
${JSON.stringify(allFindings, null, 2)}

Reviewer verdicts:
${verified.filter(Boolean).map((v) => `- ${v.dimension}: ${v.verdict}`).join('\n')}

PROCEDURE
1. Triage: for each finding, reproduce it yourself first. If it does not reproduce, mark it
   \`no_change_needed\` and say why — do not make speculative edits.
2. Fix the ones that do reproduce, smallest correct change first, in
   /output/clipper2/*.rs or /output/test3.rs. Keep the public API from
   /tmp/wf/contract.md unchanged. Keep the code style consistent with the surrounding file.
3. Re-run every battery against the patched /output:
     mkdir -p /tmp/refix && cp -r /output/clipper2 /tmp/refix/
     cp /tmp/wf/engine_battery.rs /tmp/refix/eb.rs
     cp /tmp/wf/offset_battery.rs /tmp/refix/ob.rs
     cp /tmp/wf/hidden/engine_hidden.rs /tmp/refix/eh.rs   # if it exists
     cp /tmp/wf/hidden/offset_hidden.rs /tmp/refix/oh.rs   # if it exists
   compile and run each with \`rustc --edition 2021 -A dead_code <f> -o <bin>\` and
   \`timeout 120\`. ALL must print RESULT ok. (The batteries expect \`mod clipper2;\`, so keep
   the clipper2 directory next to them.)
4. Rebuild /output both ways (\`rustc --edition 2021 test3.rs -o test3\` and
   \`cargo build --release\`) and re-run the differential test against
   /workspace/dataset/test3_executable over at least 15 argument sets, diffing stdout,
   stderr and exit status.
5. Leave /output clean: no scratch files, no throwaway programs.

Report per finding what you did (fixed / skipped / no_change_needed) and the final battery
and differential results. Be honest — if something still fails, say exactly what.`, {
    label: 'fix',
    phase: 'Fix',
    effort: 'high',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        outcomes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              summary: { type: 'string' },
              outcome: { type: 'string', enum: ['fixed', 'skipped', 'no_change_needed'] },
              detail: { type: 'string' },
            },
            required: ['summary', 'outcome', 'detail'],
          },
        },
        engine_battery: { type: 'string' },
        offset_battery: { type: 'string' },
        engine_hidden: { type: 'string' },
        offset_hidden: { type: 'string' },
        rustc_build_ok: { type: 'boolean' },
        cargo_build_ok: { type: 'boolean' },
        differential_mismatches: { type: 'array', items: { type: 'string' } },
        output_dir_listing: { type: 'array', items: { type: 'string' } },
        still_broken: { type: 'array', items: { type: 'string' } },
      },
      required: ['outcomes', 'engine_battery', 'offset_battery', 'rustc_build_ok', 'cargo_build_ok', 'differential_mismatches', 'output_dir_listing', 'still_broken'],
    },
  })
}

return {
  engine_winner: engineResult.judged.winner_dir,
  engine_ranking: engineResult.judged.ranking,
  engine_rationale: engineResult.judged.rationale,
  engine_residual: engineResult.judged.residual_concerns,
  offset_winner: offsetJudged.winner_dir,
  offset_ranking: offsetJudged.ranking,
  offset_rationale: offsetJudged.rationale,
  offset_residual: offsetJudged.residual_concerns,
  hidden_engine_checks: engineResult.hidden ? engineResult.hidden.num_checks : 0,
  hidden_offset_checks: engineResult.hiddenOffset ? engineResult.hiddenOffset.num_checks : 0,
  integration: integrated,
  verification: verified.filter(Boolean).map((v) => ({ dimension: v.dimension, verdict: v.verdict, findings: v.findings.length, checks_run: v.checks_run.length })),
  findings: allFindings,
  fix: fixed,
}
