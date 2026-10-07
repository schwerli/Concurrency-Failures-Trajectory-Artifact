export const meta = {
  name: 'earcut-port-verify',
  description: 'Exhaustively verify the C++ -> Rust earcut port: differential tests, per-function fidelity audit, independent reimplementation cross-check, adversarial verification',
  phases: [
    { title: 'Differential', detail: 'byte-for-byte arg-matrix comparison vs the C++ binary' },
    { title: 'Audit', detail: 'per-area fidelity audit of the ported algorithm' },
    { title: 'Oracle', detail: 'independent earcut reimplementations + property tests as cross-check' },
    { title: 'Verify', detail: 'adversarially verify every finding' },
    { title: 'Synthesize', detail: 'rank confirmed defects' },
  ],
}

const CONTEXT = `
# Context

A C++ program has been ported to Rust. You are verifying the port.

## The C++ source (/workspace/dataset/test10.cpp) — read it, it is short:
It builds \`std::vector<std::vector<std::array<double,2>>> polygon\` of \`n\` concentric rings
(ring \`layer\` has \`(layer+3)*2\` vertices on a circle of radius \`(layer+1)*0.3\` plus offset
\`layer*0.1\`), calls \`mapbox::earcut<uint32_t>(polygon)\` and prints each index with
\`std::cout << idx << " "\`. \`n\` defaults to 10, or \`std::atoi(argv[1])\`.

## The Rust port lives in /output:
- /output/test10.rs        — entry point (main, atoi emulation, ring generation, printing)
- /output/src/mapbox/mod.rs, earcut.rs, geom.rs, node.rs, point.rs, index.rs — the ported library

The library is a port of mapbox/earcut.hpp (the "earcut" ear-clipping triangulation
algorithm, C++ port of earcut.js v2.2.x). **The original earcut.hpp is NOT present on
this machine and must not be sought out or downloaded.** Judge fidelity against your own
knowledge of the canonical earcut algorithm (earcut.js / earcut.hpp v2.2.4), which is a
widely known open-source algorithm.

Key facts already established about the C++ binary (verified by running it):
- Oracle binary: /workspace/dataset/test10_executable (arg = n).
- For every n >= 1 the output is exactly \`4 5 0 0 1 2 2 3 4 4 0 2 \` (trailing space, NO newline).
  Reason: every "hole" ring is strictly larger than the outer ring, so findHoleBridge finds no
  bridge and every hole is silently dropped; only the convex hexagon (ring 0) is triangulated.
- For n <= 0 the output is empty (0 bytes).
- atoi is glibc's \`(int)strtol(s,NULL,10)\`: truncating, not saturating
  (\`4294967297\` -> 1, \`2147483648\` -> -2147483648, \`9223372036854775808\` -> -1).
- Large n (e.g. 2147483647) makes the C++ binary hang/OOM; that is not a behaviour that
  needs replicating precisely.

Build the Rust port with:
  cd /output && rustc -O --edition 2021 test10.rs -o /tmp/rs_test10
(Do NOT overwrite /output/test10 while other agents may be using it; build your own copy
in /tmp with a unique name.)

## Rules
- Do NOT modify anything under /output. You are auditing, not fixing. Scratch work goes in
  /tmp/<your-unique-dir>.
- Only Rust std is allowed in the port (no crates.io). Flag any dependency.
- Report concrete, verifiable defects. A defect is: a behaviour difference vs the C++ program
  for some input, OR a deviation from canonical earcut semantics that would produce wrong
  triangulations for some polygon, OR a panic/UB-equivalent (index-out-of-bounds, overflow
  panic in debug) reachable from a legitimate input.
- Style opinions, naming, and "could be faster" are NOT defects. Do not report them.
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
        required: ['title', 'file', 'line', 'severity', 'summary', 'failure_scenario', 'evidence'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          summary: { type: 'string' },
          failure_scenario: { type: 'string', description: 'concrete input/state -> wrong output' },
          evidence: { type: 'string', description: 'what you actually ran or read that shows this' },
          suggested_fix: { type: 'string' },
        },
      },
    },
    notes: { type: 'string', description: 'what you checked that was correct (brief)' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'confidence', 'reasoning'],
  properties: {
    real: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    repro: { type: 'string', description: 'exact commands + observed vs expected, if you reproduced it' },
  },
}

// ---------------------------------------------------------------------------
// Phase 1: differential testing — slices of the argument space, in parallel.
// ---------------------------------------------------------------------------
const DIFF_SLICES = [
  {
    key: 'dense-small',
    task: `Exhaustively compare EVERY integer n from -20 through 400 inclusive, passed as argv[1].
Compare raw stdout bytes (use cmp on files, not shell string interpolation), stderr, and exit status.
Also compare with no argument at all.`,
  },
  {
    key: 'large-n',
    task: `Compare larger n values: 401..600 (every value), plus 700, 800, 999, 1000, 1200, 1500, 2000, 3000, 5000.
Use a per-run timeout of 60s. Compare raw stdout bytes, stderr and exit status. Note the wall-clock
time of both binaries and report if the Rust one is pathologically slower (>20x) — that IS worth
reporting as a note, not a finding.`,
  },
  {
    key: 'atoi-strings',
    task: `Fuzz argv[1] with non-canonical strings, at least 120 distinct cases, covering: empty string,
pure whitespace, every ASCII whitespace form (space, tab, \\n, \\v, \\f, \\r) as leading padding,
mixed leading whitespace + sign, "+"/"-" alone, "++5", "--5", "+-5", " +7 ", "0", "-0", "+0",
"007", "0x1A", "0b11", "1_000", "1e3", "3.99", ".5", "5.", "1,5", "12abc", "abc12", "  12  34",
"INF", "nan", very long digit strings (30, 40, 100 digits, positive and negative),
values straddling int32/int64 boundaries: 2147483646..2147483649, -2147483647..-2147483649,
4294967295, 4294967296, 4294967297, 4294967303, 9223372036854775806..9223372036854775809,
-9223372036854775808, -9223372036854775809, 18446744073709551616, and a few multi-arg invocations
(e.g. two args, three args) since the C++ ignores argv[2..].
IMPORTANT: skip (or use a short timeout and treat a timeout in BOTH as a match) any case whose
truncated int32 value is a large positive number, because the C++ binary hangs there.
Compare raw stdout bytes, stderr, exit status.`,
  },
  {
    key: 'weird-argv',
    task: `Compare behaviour for unusual argv: argument containing a NUL-adjacent pattern, unicode digits
("１２３" fullwidth), emoji, a 10000-char argument, arguments with embedded newlines,
"-0000000000000000000000005", "+00000000000000000000000007", and locale variations
(run both binaries under LC_ALL=C, LC_ALL=C.UTF-8, LC_ALL=tr_TR.UTF-8 if available, and with
LANG unset). Compare raw stdout bytes, stderr, exit status.
Note: the Rust port uses std::env::args() which panics on non-UTF-8 argv; test a non-UTF-8
byte argument (e.g. via python3 os.execv with b'\\xff\\xfe') and report a divergence if the
Rust binary panics where C++ prints something. Judge severity honestly: it is only a real
defect if the C++ program produces meaningful output for that input.`,
  },
]

// ---------------------------------------------------------------------------
// Phase 2: per-area fidelity audit.
// ---------------------------------------------------------------------------
const AUDIT_AREAS = [
  {
    key: 'entry-main',
    task: `Audit /output/test10.rs ONLY, line by line, against /workspace/dataset/test10.cpp.
Check with extreme care:
1. atoi emulation vs glibc \`(int)strtol(s,NULL,10)\` — whitespace set, sign handling, digit
   consumption, LONG_MAX/LONG_MIN saturation then truncation to int32. Prove it by running both
   binaries on the boundary strings you derive.
2. Floating point expression order and association. C++ computes
   \`2.0 * M_PI * i / ((layer + 3) * 2)\`, \`(layer + 1) * 0.3\`, \`layer * 0.1\`,
   \`(radius + offset) * std::cos(angle)\`. Verify the Rust does the multiplications and the
   division in the SAME order with the SAME intermediate types (int-to-double conversions in
   the same places). Any reassociation is a real defect even if this particular input hides it.
   Verify M_PI == std::f64::consts::PI bit-for-bit.
3. Loop bounds: \`for (int layer = 0; layer < n; layer++)\` and \`for (int i = 0; i < (layer+3)*2; i++)\`
   with n negative / zero / huge.
4. Output: \`std::cout << idx << " "\` — separator, absence of trailing newline, decimal formatting
   of uint32_t. Verify with od/cmp on a real run, and verify the empty-output case emits 0 bytes.
5. Whether \`std::cout\` buffering/flushing differences could change the bytes on stdout when
   stdout is a pipe vs a tty vs a file (compare all three).
6. Whether the ring vertex COUNT and the angle DIVISOR are still the same expression
   (the port hoisted \`(layer+3)*2\` into a variable — confirm that is value-identical,
   including in the integer-overflow regime for huge layer values).`,
  },
  {
    key: 'linkedlist-winding',
    task: `Audit ONLY these parts of /output/src/mapbox/earcut.rs: \`linked_list\`, \`insert_node\`,
\`remove_node\`, \`filter_points\`, plus /output/src/mapbox/node.rs and /output/src/mapbox/index.rs.
Against canonical earcut:
1. \`signedArea\` sum: canonical is \`sum += (data[j] - data[i]) * (data[i+1] + data[j+1])\` with
   j starting at the LAST vertex and then j = i (previous vertex). Verify the port's j-sequence
   and operand order match exactly, and verify the resulting winding decision
   \`if (clockwise == (signedArea > 0))\` forward-links, else reverse-links.
   Independently derive which winding the outer ring ends up in and confirm it is consistent with
   the sign convention used by \`area()\` and \`is_ear\` (an ear requires area < 0).
2. The trailing \`if (last && equals(last, last->next)) { removeNode(last); last = last->next; }\` —
   note that C++ reads \`last->next\` AFTER removeNode(last), and removeNode does not clear the
   removed node's own prev/next. Confirm the port preserves that exact aliasing behaviour.
3. \`vertices\` accounting: \`vertices += len\` happens after linking; node \`i\` is
   \`static_cast<N>(vertices + i)\`. Confirm the truncation point matches.
4. \`filter_points(start, end)\`: the \`end = nullptr\` default, the \`p = end = p->prev\` update after
   removal, the \`if (p == p->next) break\`, the \`while (again || p != end)\` loop condition, and the
   steiner-point guard. Walk through a ring that collapses entirely and confirm no panic and the
   same return value.
Write a small scratch harness in /tmp if that helps you prove a claim.`,
  },
  {
    key: 'holes-bridge',
    task: `Audit ONLY \`eliminate_holes\`, \`eliminate_hole\`, \`find_hole_bridge\`,
\`sector_contains_sector\`, \`get_leftmost\` in /output/src/mapbox/earcut.rs.
Against canonical earcut v2.2.4:
1. Holes are linked with \`clockwise = false\`; single-node holes are marked steiner;
   the queue holds each hole's leftmost node and is sorted by x ascending
   (C++ uses \`std::sort\`, which is UNSTABLE — the port uses a stable sort. Determine whether
   that can change output for any polygon with two holes whose leftmost x are exactly equal,
   and whether it can change output for THIS program's input specifically).
2. \`find_hole_bridge\`: the \`hy <= p->y && hy >= p->next->y && p->next->y != p->y\` guard,
   the x-intersection formula and its exact operand order, \`x <= hx && x > qx\`,
   \`m = p->x < p->next->x ? p : p->next\`, the early \`if (x == hx) return m\`,
   the \`qx = -infinity\` initialisation, and the second loop's
   \`hx >= p->x && p->x >= mx && hx != p->x\` + pointInTriangle with the
   \`hy < my ? hx : qx\` / \`hy < my ? qx : hx\` swap, \`tan = |hy - p->y| / (hx - p->x)\`,
   and the tie-break \`tan == tanMin && (p->x > m->x || sectorContainsSector(m, p))\`.
3. \`eliminate_hole\` must call \`filterPoints(bridgeReverse, bridgeReverse->next)\` and return
   \`filterPoints(bridge, bridge->next)\`, and must return outerNode unchanged when no bridge exists.
4. Construct a polygon where a hole IS bridgeable and verify the port produces a valid
   triangulation for it (build a scratch binary in /tmp that calls the library directly).
   Also construct the specific case from this program (outer ring smaller than all holes) and
   confirm all holes are dropped.`,
  },
  {
    key: 'earclip-core',
    task: `Audit ONLY \`run\` (operator()), \`earcut_linked\`, \`is_ear\`, \`is_ear_hashed\` in
/output/src/mapbox/earcut.rs, plus \`area\`, \`point_in_triangle\`, \`sign\`, \`cpp_min\`, \`cpp_max\`
in /output/src/mapbox/geom.rs.
Against canonical earcut v2.2.4:
1. \`operator()\`: \`threshold = 80\`, the \`for (i = 0; threshold >= 0 && i < points.size(); i++)\`
   loop that decrements threshold by each ring size and accumulates \`len\` (note: \`len\` stops
   accumulating once threshold goes negative — confirm the port replicates that, and note that
   \`len\` only feeds capacity reservations so a mismatch there is at most a perf issue),
   \`hashing = threshold < 0\`, the early return when
   \`!outerNode || outerNode->prev == outerNode->next\`, holes eliminated BEFORE the bbox is
   computed, and the bbox do-while that starts at \`outerNode->next\` and therefore never
   re-processes outerNode itself (min/max are seeded from outerNode).
   \`inv_size = max(maxX-minX, maxY-minY); inv_size = inv_size != 0 ? 32767/inv_size : 0\`.
   Verify the hashing threshold boundary empirically: find the n at which this program flips to
   the hashed path and confirm both binaries agree on both sides of it.
2. \`earcut_linked\`: \`if (!pass && hashing) indexCurve(ear)\`, the \`while (ear->prev != ear->next)\`
   loop, emission order \`prev->i, ear->i, next->i\`, \`ear = stop = next->next\` after a cut,
   and the pass escalation 0 -> filterPoints+pass1, 1 -> cureLocalIntersections+pass2,
   2 -> splitEarcut, then \`break\`.
3. \`is_ear\`: reflex check \`area(a,b,c) >= 0\` returns false; scan \`p = ear->next->next\` while
   \`p != ear->prev\`; reject when pointInTriangle && \`area(p->prev,p,p->next) >= 0\`.
4. \`is_ear_hashed\`: bbox, minZ/maxZ, forward scan on nextZ while \`z <= maxZ\`, backward scan on
   prevZ while \`z >= minZ\`, and the \`p != ear->prev && p != ear->next\` exclusions.
   Confirm the split forward/backward loops are logically equivalent to the canonical
   interleaved version (they must examine the same candidate set).
5. \`point_in_triangle\`: canonical earcut.hpp uses the subtracted form
   \`(cx-px)*(ay-py) - (ax-px)*(cy-py) >= 0 && ...\`. Confirm the port matches, and reason about
   whether a non-subtracted form would differ in floating point.
6. \`sign(val)\` == \`(0.0 < val) - (val < 0.0)\`, and cpp_min/cpp_max match \`std::min/std::max\`
   argument order (which matters for -0.0/NaN).`,
  },
  {
    key: 'zorder-sort',
    task: `Audit ONLY \`index_curve\`, \`sort_linked\`, \`z_order\` (in earcut.rs and geom.rs).
Against canonical earcut v2.2.4:
1. \`indexCurve\`: \`p->z = p->z ? p->z : zOrder(p->x, p->y)\` (note: memoised on 0, so a genuine
   z of 0 is recomputed — confirm the port keeps that quirk), prevZ/nextZ seeded from prev/next,
   then \`p->prevZ->nextZ = nullptr; p->prevZ = nullptr; sortLinked(p)\` where p == start.
2. \`sortLinked\` (Simon Tatham merge sort): the exact \`inSize\` doubling, the
   \`for (i = 0; i < inSize; i++) { pSize++; q = q->nextZ; if (!q) break; }\` walk — pay close
   attention to whether the port's while-loop increments its counter in the same place, because
   an off-by-one there changes pSize and thus the sort. Trace it by hand for inSize = 1, 2, 4
   on a 5-element and a 6-element list. Then the merge loop
   \`while (pSize > 0 || (qSize > 0 && q))\` with the four branches, tail/list/prevZ maintenance,
   \`tail->nextZ = nullptr\`, and \`if (numMerges <= 1) return list\`.
   Best proof: extract the port's sort_linked into a scratch program in /tmp, and also write a
   direct transcription of the canonical C++ merge sort, and compare their outputs on many
   random z-value lists (including duplicates, which test stability). Report any divergence.
3. \`zOrder\`: \`static_cast<int32_t>((x - minX) * inv_size)\` (C truncation toward zero) and the
   bit-interleaving with the exact masks; confirm the Rust \`as i32\` (which saturates) cannot
   differ for in-range inputs, and reason about out-of-range inputs.
4. Verify \`remove_node\` maintains prevZ/nextZ exactly as C++ does (only patching neighbours,
   never the removed node's own fields).`,
  },
  {
    key: 'recovery-paths',
    task: `Audit ONLY \`cure_local_intersections\`, \`split_earcut\`, \`is_valid_diagonal\`,
\`split_polygon\`, \`intersects\`, \`on_segment\`, \`intersects_polygon\`, \`locally_inside\`,
\`middle_inside\` in /output/src/mapbox/earcut.rs.
Against canonical earcut v2.2.4. Be exhaustive about:
1. \`cureLocalIntersections\`: the do-while shape, \`a = p->prev; b = p->next->next\`, the
   \`!equals(a,b) && intersects(a,p,p->next,b) && locallyInside(a,b) && locallyInside(b,a)\` test,
   emission order \`a->i, p->i, b->i\`, then \`removeNode(p); removeNode(p->next);\` — note C++ reads
   \`p->next\` AFTER removing p, which still yields the ORIGINAL next node. Confirm the port does
   the same. Then \`p = start = b\` followed by the unconditional \`p = p->next\`, and the final
   \`return filterPoints(p)\`.
2. \`splitEarcut\`: outer do-while over a, inner \`b = a->next->next; while (b != a->prev)\`,
   the \`a->i != b->i && isValidDiagonal(a,b)\` test, \`c = splitPolygon(a,b)\`,
   \`a = filterPoints(a, a->next); c = filterPoints(c, c->next)\`, then
   \`earcutLinked(a); earcutLinked(c); return;\` — both with pass = 0 (so indexCurve runs again
   when hashing). Confirm the port re-reads \`a->next\` AFTER splitPolygon (splitPolygon mutates
   \`a->next\`), because reading it before would be a real bug.
3. \`isValidDiagonal\`: the full canonical predicate including the
   \`(area(a->prev,a,b->prev) != 0 || area(a,b->prev,b) != 0)\` opposite-facing-sector clause and
   the \`equals(a,b) && area(a->prev,a,a->next) > 0 && area(b->prev,b,b->next) > 0\` zero-length case.
4. \`intersects\`: the four \`sign(area(...))\` orientations, the \`o1 != o2 && o3 != o4\` general case,
   and the four collinear \`onSegment\` cases with their exact argument triples.
5. \`middleInside\`: the crossing test
   \`((p->y > py) != (p->next->y > py)) && p->next->y != p->y && (px < (p->next->x - p->x) * (py - p->y) / (p->next->y - p->y) + p->x)\`
   — check the operand order character by character.
6. \`splitPolygon\`: the two new nodes and all eight link assignments, and that it returns b2.
7. Reachability: determine whether the pass-1/2/3 recovery paths are reachable at all for THIS
   program's input; say so explicitly. Also try to construct ANY polygon (via a scratch harness
   in /tmp linking the library) that reaches cure_local_intersections and split_earcut, and
   check the port does not panic and returns a sane triangulation.`,
  },
  {
    key: 'arena-safety',
    task: `Audit the pointer->arena-index translation across ALL of /output/src/mapbox/*.rs.
The C++ uses raw \`Node*\`. The port uses \`usize\` handles into a \`Vec<Node>\` with
\`NULL = usize::MAX\`. Hunt specifically for:
1. Any place a handle is read into a local BEFORE a mutation that the C++ performs AFTER
   (or vice versa) — i.e. a stale-snapshot bug. Go function by function. Pay special attention
   to \`filter_points\`, \`cure_local_intersections\`, \`split_earcut\`, \`eliminate_hole\`,
   \`linked_list\` (the equals(last, last->next) tail), and \`earcut_linked\`.
2. Any place \`NULL\` (usize::MAX) could be used as an index -> guaranteed panic. Enumerate every
   indexing site and argue it is unreachable with NULL, or produce an input that reaches it.
   Consider: \`sort_linked\` doing \`self.nodes[tail].next_z = NULL\` when tail is NULL (empty list),
   \`index_curve\` on a single-node ring, \`cure_local_intersections\`/\`filter_points\` with NULL
   arguments, and \`find_hole_bridge\` when m stays NULL.
3. Arithmetic that panics in a debug build but wraps/UBs in C++ (integer overflow, \`as\` casts,
   shifts). Note that /output must also build with \`cargo build\` (debug, overflow checks ON) —
   if any reachable arithmetic overflows in debug, that is a real defect. Test it: build a debug
   binary in /tmp and run the same arg matrix through it, comparing against the C++ oracle.
4. Whether \`Earcut::run\` being called twice on the same instance behaves like reusing a C++
   \`Earcut\` object (nodes arena reset, vertices reset, indices cleared, hashing/min/max state).
   Write a scratch harness that calls run() twice with different polygons and check the second
   result equals a fresh instance's result.
5. Confirm zero non-std dependencies: grep for \`extern crate\`, \`use\` of anything outside \`std\`/
   \`core\`/\`alloc\`/the crate's own modules, and check /output/Cargo.toml has an empty
   [dependencies].`,
  },
]

// ---------------------------------------------------------------------------
// Phase 3: independent-oracle cross-check.
// ---------------------------------------------------------------------------
const ORACLES = [
  {
    key: 'reimpl-a',
    task: `Write your OWN independent Rust implementation of the earcut algorithm from scratch, from
your knowledge of earcut.js / earcut.hpp v2.2.4, in /tmp/oracle_a/. Do not copy or even read
/output/src/mapbox/earcut.rs while writing it (write yours first, then compare). Then:
1. Build a comparison harness that runs BOTH your implementation and the /output library over a
   large corpus of polygons and diffs the exact index sequences. Copy the /output library into
   /tmp/oracle_a/ported/ so you can link both into one binary; do not modify /output.
2. Corpus: at least 400 polygons covering — convex regular n-gons (n = 3..40); concave/star
   polygons; polygons with 1..5 holes that ARE properly nested inside the outer ring; holes that
   are NOT inside (like this program's input); rings given clockwise and counter-clockwise;
   duplicate consecutive vertices; collinear runs; zero-area rings; single-point and two-point
   rings; empty rings; empty polygon; self-touching polygons; polygons large enough to trip the
   80-vertex hashing threshold (both just under and just over); and a few hundred pseudo-random
   simple-ish polygons from a deterministic LCG you write yourself (no rand crate).
3. Report every divergence in the index sequence. For each divergence, say which side you believe
   is right per canonical earcut and why. If your own implementation is the one that is wrong,
   say so and do NOT report it as a finding.`,
  },
  {
    key: 'reimpl-b',
    task: `Same brief as an independent reimplementation cross-check, but approach it differently: write a
direct, mechanical transcription of the canonical **earcut.js v2.2.4** JavaScript source (from
your knowledge) into Rust in /tmp/oracle_b/, keeping JS semantics (f64 everywhere, same function
and variable names, same statement order) so it is as close to the reference as possible.
Then diff its output against the /output library over a corpus of at least 400 polygons
(convex n-gons, stars, properly nested holes, non-nested holes, both windings, duplicate and
collinear vertices, degenerate rings, >80 vertices to exercise the z-order hashing path, and a
few hundred deterministic pseudo-random polygons from an LCG you write yourself).
Copy the /output library into /tmp/oracle_b/ported/ to link both into one binary; do not modify
/output. Report every divergence in the exact index sequence, and for each one state which side
matches canonical earcut and why. Be explicit about which recovery passes
(filterPoints / cureLocalIntersections / splitEarcut) and which of hashed vs unhashed isEar your
corpus actually exercised — if a code path got zero coverage, say so.`,
  },
  {
    key: 'property',
    task: `Property-test the /output earcut library for intrinsic correctness (not just fidelity).
Copy it to /tmp/prop/ported/ and write a harness in /tmp/prop/ (do not modify /output). For a
large deterministic corpus of polygons (write your own LCG; at least 500 cases, including
properly-nested holes, concave and star shapes, >80 vertices to hit the hashing path, and
degenerate inputs), assert:
1. Every emitted index is < total vertex count across all rings, and the count of indices is
   divisible by 3.
2. For simple polygons WITHOUT holes and without degeneracies: the number of triangles is
   exactly V - 2, and the sum of |triangle area| equals the polygon's |shoelace area| to within
   1e-9 relative.
3. For polygons WITH properly nested, non-overlapping holes: sum of |triangle area| equals
   |outer area| - sum |hole areas| to within 1e-9 relative.
4. No triangle references the same vertex index twice.
5. No two triangles overlap in area (sample interior points, or check pairwise via area sums —
   your choice, but be rigorous).
6. The library never panics and always terminates (use a generous timeout per case).
Report each property violation with the exact polygon that triggers it (dump the coordinates).
Note honestly which violations are EXPECTED because canonical earcut also has them (earcut is a
heuristic and does not guarantee a valid triangulation for self-intersecting or badly degenerate
input) versus which indicate a porting bug. Only report the latter as findings.`,
  },
]

// ---------------------------------------------------------------------------
// Run phase 1 + 2 + 3 concurrently; each finding then gets adversarially
// verified as soon as its producing agent finishes (pipeline, no barrier).
// ---------------------------------------------------------------------------
const LENSES = [
  { key: 'repro', angle: `Try to REPRODUCE it by actually running commands. If you cannot produce a concrete input where the Rust binary's stdout bytes differ from /workspace/dataset/test10_executable's, or a concrete polygon where the library's index sequence deviates from canonical earcut, or an actual panic, then it is NOT real. Default to refuted=true when uncertain.` },
  { key: 'canonical', angle: `Judge it purely against canonical earcut v2.2.4 semantics from your own knowledge. Is the claimed deviation actually a deviation, or did the reporter misremember the reference? Quote the canonical logic you are comparing against. Default to refuted=true when uncertain.` },
  { key: 'reachability', angle: `Assume the logic claim is correct and ask only: is this code path REACHABLE, and does it change observable output? A deviation in dead code, or one that provably cannot alter the emitted index sequence for any input, is NOT a real defect for this deliverable. Default to refuted=true when uncertain.` },
]

const workItems = [
  ...DIFF_SLICES.map(s => ({ ...s, phase: 'Differential', prompt: `${CONTEXT}\n\n# Your task: differential testing (slice: ${s.key})\n\n${s.task}\n\nBe rigorous: compare RAW BYTES via files and \`cmp\`, never via shell variable interpolation (which strips trailing whitespace — and the expected output ENDS in a space). Report each genuine mismatch as a finding with the exact argv. Report the total number of cases you ran in \`notes\`.` })),
  ...AUDIT_AREAS.map(a => ({ ...a, phase: 'Audit', prompt: `${CONTEXT}\n\n# Your task: fidelity audit (area: ${a.key})\n\n${a.task}\n\nRead the actual Rust code carefully; do not guess. Where you can prove a claim by running something, do. Report only genuine defects.` })),
  ...ORACLES.map(o => ({ ...o, phase: 'Oracle', prompt: `${CONTEXT}\n\n# Your task: independent oracle cross-check (${o.key})\n\n${o.task}` })),
]

log(`Verifying the port: ${DIFF_SLICES.length} differential slices, ${AUDIT_AREAS.length} audit areas, ${ORACLES.length} oracle cross-checks`)

const perItem = await pipeline(
  workItems,
  item => agent(item.prompt, { label: `${item.phase.toLowerCase()}:${item.key}`, phase: item.phase, schema: FINDINGS_SCHEMA }),
  (result, item) => {
    if (!result || !result.findings || result.findings.length === 0) return []
    return parallel(result.findings.map(f => () =>
      parallel(LENSES.map(l => () =>
        agent(
          `${CONTEXT}\n\n# Your task: adversarially verify ONE claimed defect\n\n` +
          `A prior agent auditing the Rust port reported this. Your job is to try to REFUTE it.\n\n` +
          `- title: ${f.title}\n- file: ${f.file}:${f.line}\n- severity: ${f.severity}\n` +
          `- summary: ${f.summary}\n- failure scenario: ${f.failure_scenario}\n- their evidence: ${f.evidence}\n\n` +
          `## Your lens\n${l.angle}\n\n` +
          `Set \`real: false\` if you refute it. Be specific in \`reasoning\`.`,
          { label: `verify:${item.key}:${l.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }
        )
      )).then(votes => {
        const v = votes.filter(Boolean)
        const realCount = v.filter(x => x.real).length
        return { finding: f, source: item.key, votes: v, realCount, total: v.length, survives: realCount * 2 > v.length }
      })
    ))
  }
)

const judged = perItem.filter(Boolean).flat().filter(Boolean)
const confirmed = judged.filter(j => j.survives)
const rejected = judged.filter(j => !j.survives)

log(`${judged.length} findings raised, ${confirmed.length} survived adversarial verification`)

if (confirmed.length === 0) {
  return {
    confirmed: [],
    rejectedCount: rejected.length,
    rejectedTitles: rejected.map(r => `${r.source}: ${r.finding.title} (${r.realCount}/${r.total} upheld)`),
    synthesis: 'No findings survived adversarial verification.',
  }
}

phase('Synthesize')
const synthesis = await agent(
  `${CONTEXT}\n\n# Your task: synthesize the verified defect list\n\n` +
  `These findings survived a 3-lens adversarial verification (majority upheld):\n\n` +
  JSON.stringify(confirmed.map(c => ({
    source: c.source,
    title: c.finding.title,
    file: c.finding.file,
    line: c.finding.line,
    severity: c.finding.severity,
    summary: c.finding.summary,
    failure_scenario: c.finding.failure_scenario,
    evidence: c.finding.evidence,
    suggested_fix: c.finding.suggested_fix,
    upheld: `${c.realCount}/${c.total}`,
    dissent: c.votes.filter(v => !v.real).map(v => v.reasoning),
  })), null, 2) +
  `\n\nThese were REFUTED (for context, do not resurrect them unless a refutation is clearly wrong):\n` +
  JSON.stringify(rejected.map(r => ({ title: r.finding.title, upheld: `${r.realCount}/${r.total}`, why: r.votes.filter(v => !v.real).map(v => v.reasoning).slice(0, 2) })), null, 2) +
  `\n\nDeduplicate, drop anything you judge spurious after re-reading the actual code in /output, ` +
  `and rank by real impact on this deliverable (byte-identical output vs the C++ binary first, ` +
  `then latent triangulation-correctness bugs in the ported library, then panic risks). ` +
  `For each surviving item give: file:line, one-sentence defect, the concrete input that exposes it, ` +
  `and a minimal concrete patch. Verify each patch claim by reading the code yourself. ` +
  `Be blunt if the list is empty after your own review.`,
  { phase: 'Synthesize', effort: 'high' }
)

return {
  confirmedCount: confirmed.length,
  confirmed: confirmed.map(c => ({ source: c.source, title: c.finding.title, file: c.finding.file, line: c.finding.line, severity: c.finding.severity, upheld: `${c.realCount}/${c.total}`, summary: c.finding.summary, suggested_fix: c.finding.suggested_fix })),
  rejectedTitles: rejected.map(r => `${r.source}: ${r.finding.title} (${r.realCount}/${r.total} upheld)`),
  synthesis,
}
