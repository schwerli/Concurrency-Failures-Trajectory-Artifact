export const meta = {
  name: 'earcut-cpp-to-rust',
  description: 'Port mapbox/earcut.hpp + test2.cpp to a dependency-free Rust Cargo project in /output, byte-exact vs the C++ binary',
  phases: [
    { title: 'Spec', detail: '4 independent reconstructions of the earcut algorithm' },
    { title: 'Synthesize', detail: 'reconcile into one canonical spec' },
    { title: 'Implement', detail: '3 competing Rust implementations in /tmp' },
    { title: 'Judge', detail: 'differential + geometric comparison, pick winner' },
    { title: 'Assemble', detail: 'install winning impl into /output' },
    { title: 'Verify', detail: 'adversarial verification: diff-test, fuzz, fidelity, packaging' },
    { title: 'Repair', detail: 'fix confirmed defects and re-verify' },
  ],
}

// ---------------------------------------------------------------- shared context

const GROUND_TRUTH = `
GROUND TRUTH (already measured by running the reference C++ binary /workspace/dataset/test2_executable).
stdout has NO trailing newline; every index is followed by one space (so output ends with a space, or is
completely empty). Exit code is always 0.

  arg(s)                                            exact stdout
  ------------------------------------------------  ---------------------------------------------------
  (none)                                            "0 4 7 5 4 0 3 0 7 5 0 1 2 3 7 6 5 1 2 7 6 6 1 2 "
  "0"                                               ""
  "1"                                               "2 3 0 0 1 2 "
  "-1" / "-2" / "-5"                                "2 3 0 0 1 2 "
  "2" / "3" / "4" / "5" / "6" / "10" / "1000000"    "0 4 7 5 4 0 3 0 7 5 0 1 2 3 7 6 5 1 2 7 6 6 1 2 "
  "3abc" / " 4" / "2.9" / "+3" / "007" / "  +2  "   "0 4 7 5 4 0 3 0 7 5 0 1 2 3 7 6 5 1 2 7 6 6 1 2 "
  "abc" / "0x10" / "e2" / "-0"                      ""
  "2147483648"                                      "2 3 0 0 1 2 "        (wraps to i32 -2147483648)
  "9223372036854775808"                             "2 3 0 0 1 2 "        (saturates to i64::MAX -> i32 -1)
  "-9223372036854775809"                            ""                    (saturates to i64::MIN -> i32 0)
  "4294967296"                                      ""                    (wraps to i32 0)
  "4294967298"                                      "0 4 7 5 4 0 3 0 7 5 0 1 2 3 7 6 5 1 2 7 6 6 1 2 "  (wraps to 2)
  "8589934594"                                      "0 4 7 5 4 0 3 0 7 5 0 1 2 3 7 6 5 1 2 7 6 6 1 2 "  (wraps to 2)

glibc atoi(s) == (int)strtol(s, NULL, 10):
  - skip leading isspace() characters
  - optional single '+' or '-'
  - consume base-10 digits only; stop at the first non-digit (no 0x, no exponent, no '.')
  - no digits at all  ->  0
  - out-of-range for long -> saturate to i64::MAX / i64::MIN
  - then truncate the i64 to i32 with two's-complement wrapping ("as i32" in Rust)
`

const CPP_SOURCE = `
--- /workspace/dataset/earcut.hpp/tests/test2.cpp (the program being ported) ---
#include <iostream>
#include <vector>
#include <array>
#include "../earcut.hpp"

int main(int argc, char* argv[]) {
    int n = 2;
    if (argc > 1) {
        n = std::atoi(argv[1]);
    }

    std::vector<std::vector<std::array<double, 2>>> polygon;
    std::vector<std::array<double, 2>> outer = {{0.0,0.0}, {double(n),0.0}, {double(n),double(n)}, {0.0,double(n)}};
    polygon.push_back(outer);

    if (n > 1) {
        std::vector<std::array<double, 2>> hole = {{0.25*double(n),0.25*double(n)}, {0.75*double(n),0.25*double(n)}, {0.75*double(n),0.75*double(n)}, {0.25*double(n),0.75*double(n)}};
        polygon.push_back(hole);
    }

    auto indices = mapbox::earcut<uint32_t>(polygon);

    for (auto idx : indices) {
        std::cout << idx << " ";
    }
    return 0;
}
--- end ---

Note: mapbox::earcut<uint32_t>(polygon) takes a container of rings; ring 0 is the outer ring, rings 1..N-1
are holes. Vertex indices are global and assigned in input order across all rings concatenated
(outer ring = 0..3, first hole = 4..7 here). It returns a flat std::vector<uint32_t> of triangle indices
(3 per triangle).
`

const RULES = `
HARD RULES for this task:
  * The earcut.hpp C++ library source is NOT available on this machine (the directory
    /workspace/dataset/earcut.hpp/ does not exist) and you must NOT try to obtain it. There is no network.
    Reconstruct the algorithm from your own knowledge of mapbox/earcut (earcut.js / earcut.hpp), then
    re-implement it in Rust from scratch.
  * Rust 2021 edition. Toolchain is rustc/cargo 1.75.0 -- do NOT use std APIs newer than 1.75.
  * ZERO external crates. No dependencies, no dev-dependencies. std only. Randomness for tests must be a
    hand-rolled PRNG (e.g. xorshift/LCG with a fixed seed).
  * No unsafe code. No panics on any input.
  * Output must be byte-for-byte identical to the C++ binary, including the trailing space and the
    ABSENCE of a trailing newline.
`

const ALGO_FOCUS = `
The functions/details that matter (mapbox earcut, version 2.2.x):
  driver: earcut(rings) -> indices; the 80-vertex "threshold" that decides whether z-order hashing is
    used; bbox + inv_size computation; the vertices counter that makes indices global across rings;
    early-outs (empty input, outerNode == null, outerNode->prev == outerNode->next).
  linked list: Node {i, x, y, prev, next, z, prevZ, nextZ, steiner}; insertNode; removeNode;
    linkedList(ring, clockwise) including the exact winding sum formula and the
    "if (clockwise == (sum > 0))" forward/reverse insertion decision, and the trailing
    "if (last && equals(last, last->next)) { removeNode(last); last = last->next; }".
  filterPoints(start, end) -- exact loop shape with the 'again' flag.
  earcutLinked(ear, pass) -- ear slicing order, "indices.push(prev.i, ear.i, next.i)",
    "ear = next.next; stop = next.next;" skip-a-vertex trick, and the pass 0/1/2 escalation
    (filterPoints -> cureLocalIntersections -> splitEarcut).
  isEar / isEarHashed (incl. the z-order box search over prevZ/nextZ).
  pointInTriangle, area, equals, sign, intersects, onSegment, intersectsPolygon, locallyInside,
    middleInside, isValidDiagonal, splitPolygon, cureLocalIntersections, splitEarcut.
  holes: eliminateHoles (queue of getLeftmost(hole), sort by x, whether filterPoints is called after
    each eliminateHole), eliminateHole, findHoleBridge (incl. the "x == hx" early return, the tanMin
    tie-break, and sectorContainsSector), getLeftmost (incl. the y tie-break).
  z-order: indexCurve, sortLinked (in-place merge sort with the exact list-splitting behaviour), zOrder.
Be explicit about anything where versions of earcut differ, and say which behaviour you believe the
current mapbox/earcut.hpp (v2.2.4) has.
`

// ---------------------------------------------------------------- schemas

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['functions', 'driver_flow', 'divergences', 'confidence'],
  properties: {
    functions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'body'],
        properties: {
          name: { type: 'string' },
          signature: { type: 'string' },
          body: { type: 'string', description: 'exact pseudocode/near-source body' },
          notes: { type: 'string' },
        },
      },
    },
    driver_flow: { type: 'string' },
    divergences: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string' },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'build_ok', 'all_matrix_pass', 'mismatches', 'geometric_validation', 'file_list', 'notes'],
  properties: {
    dir: { type: 'string' },
    build_ok: { type: 'boolean' },
    all_matrix_pass: { type: 'boolean' },
    mismatches: { type: 'array', items: { type: 'string' } },
    geometric_validation: { type: 'string', description: 'what you fuzzed and the worst area deviation observed' },
    file_list: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    confidence: { type: 'string' },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['winner_dir', 'ranking', 'defects', 'rationale'],
  properties: {
    winner_dir: { type: 'string' },
    ranking: { type: 'array', items: { type: 'string' } },
    defects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dir', 'severity', 'summary'],
        properties: {
          dir: { type: 'string' },
          severity: { type: 'string' },
          summary: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    grafts: { type: 'array', items: { type: 'string' }, description: 'good ideas from losers worth grafting into the winner' },
    rationale: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'pass', 'findings'],
  properties: {
    area: { type: 'string' },
    pass: { type: 'boolean' },
    evidence: { type: 'string', description: 'commands you ran and their actual output' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'summary'],
        properties: {
          severity: { type: 'string', description: 'blocker | major | minor | nit' },
          summary: { type: 'string' },
          file: { type: 'string' },
          detail: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}

// ---------------------------------------------------------------- phase 1: spec recall

phase('Spec')

const LENSES = [
  {
    key: 'js-upstream',
    prompt: `You are reconstructing the UPSTREAM JavaScript reference implementation mapbox/earcut (v2.2.4,
the version the C++ header earcut.hpp mirrors). Write out, as faithfully as you can from memory, the body of
EVERY function in earcut.js: earcut, linkedList, filterPoints, earcutLinked, isEar, isEarHashed,
cureLocalIntersections, splitEarcut, eliminateHoles, eliminateHole, findHoleBridge, sectorContainsSector,
indexCurve, sortLinked, zOrder, getLeftmost, pointInTriangle, isValidDiagonal, area, equals, intersects,
onSegment, sign, intersectsPolygon, locallyInside, middleInside, splitPolygon, insertNode, removeNode, Node.
Preserve exact comparison operators, >= vs >, argument order, and the order in which triangle indices are
pushed. Do not paraphrase the control flow.`,
  },
  {
    key: 'cpp-port',
    prompt: `You are reconstructing the C++ header mapbox/earcut.hpp (v2.2.4) specifically -- not the JS.
Write out the body of every member of template<typename N> class Earcut: operator()(const Polygon&),
linkedList, filterPoints, earcutLinked, isEar, isEarHashed, cureLocalIntersections, splitEarcut,
eliminateHoles, eliminateHole, findHoleBridge, sectorContainsSector, indexCurve, sortLinked, zOrder,
getLeftmost, pointInTriangle, isValidDiagonal, area, equals, intersects, onSegment, sign, intersectsPolygon,
locallyInside, middleInside, splitPolygon, insertNode, removeNode, plus the Node struct, the ObjectStore/
node pool, util::nth accessors, and the free function mapbox::earcut<N>(polygon).
Pay special attention to the parts where the C++ port DIFFERS from the JS: the "int threshold = 80" loop that
both sums the total vertex count and decides "hashing = threshold < 0", the reserve() calls, the bbox loop
placement (before or after eliminateHoles), inv_size = 32767/max(w,h) with the ".0" guard, and how the
per-ring index offset (the 'vertices' member) is maintained.`,
  },
  {
    key: 'predicates',
    prompt: `Focus ONLY on the fiddly geometric predicates and the hole-bridging logic of mapbox earcut, where
subtle version differences change the OUTPUT TRIANGLE ORDER. Give exact bodies plus a discussion of what
changed between v2.1.x, v2.2.0 and v2.2.4 for each of:
  area, equals, sign, pointInTriangle, isValidDiagonal, intersects (incl. the collinear/onSegment special
  cases added in 2.2.x), onSegment, intersectsPolygon, locallyInside, middleInside, splitPolygon,
  cureLocalIntersections, splitEarcut, isEar, isEarHashed,
  getLeftmost (does it have the "|| (p.x == leftmost.x && p.y < leftmost.y)" tie-break?),
  findHoleBridge (the "if (x == hx) return m" fast path; the tanMin comparison including
    "tan == tanMin && (p.x > m.x || sectorContainsSector(m, p))"),
  sectorContainsSector,
  eliminateHoles / eliminateHole (is "outerNode = filterPoints(outerNode, outerNode.next)" called inside the
    per-hole loop? does eliminateHole return the bridge node or the original outerNode? are the two
    filterPoints calls inside eliminateHole present?).
For each item state clearly which form v2.2.4 uses and how confident you are.`,
  },
  {
    key: 'trace',
    prompt: `Do not write out the whole library. Instead, HAND-TRACE mapbox earcut on the three exact inputs
this program produces, and report the triangle-index sequence your trace predicts, step by step
(which node is 'ear' each iteration, prev/next, the isEar verdict and why, what gets pushed, what
removeNode/filterPoints do). This is a correctness oracle for a Rust port, so be rigorous and show the
arithmetic for each area()/pointInTriangle() call you rely on.

Input A (n = 1, one ring, no hole): outer = [(0,0), (1,0), (1,1), (0,1)]. Expected output: 2 3 0 0 1 2
Input B (n = 0, one ring, no hole): outer = [(0,0), (0,0), (0,0), (0,0)]. Expected output: (empty)
Input C (n = 2, ring + hole):
    outer = [(0,0), (2,0), (2,2), (0,2)]                    -> global indices 0,1,2,3
    hole  = [(0.5,0.5), (1.5,0.5), (1.5,1.5), (0.5,1.5)]    -> global indices 4,5,6,7
    Expected output: 0 4 7  5 4 0  3 0 7  5 0 1  2 3 7  6 5 1  2 7 6  6 1 2
Input C is the important one: it pins down linkedList's winding decision for the hole, getLeftmost,
findHoleBridge, splitPolygon and the whole ear-slicing order. If your trace disagrees with the expected
output, say so explicitly and identify which variant of which function WOULD produce the expected output --
that is the most valuable thing you can report.`,
  },
]

const specs = await parallel(LENSES.map(l => () =>
  agent(
    `${RULES}\n${CPP_SOURCE}\n${GROUND_TRUTH}\n${ALGO_FOCUS}\n\nYOUR ASSIGNMENT (lens: ${l.key}):\n${l.prompt}\n\n` +
    `You may run /workspace/dataset/test2_executable with arguments to check hypotheses (it is the reference ` +
    `C++ binary; it only accepts the single integer argument shown above). You may write scratch files under ` +
    `/tmp/spec-${l.key}/ (e.g. a quick throwaway prototype in any language to test a trace) but you must not ` +
    `write anywhere else. Return the structured spec.`,
    { label: `spec:${l.key}`, phase: 'Spec', schema: SPEC_SCHEMA, effort: 'high' }
  )
))

const goodSpecs = specs.filter(Boolean)
log(`spec reconstructions returned: ${goodSpecs.length}/4`)

// ---------------------------------------------------------------- phase 2: synthesize

phase('Synthesize')

const specDump = goodSpecs.map((s, i) => {
  const fns = (s.functions || []).map(f =>
    `### ${f.name} ${f.signature ? '-- ' + f.signature : ''}\n${f.body}\n${f.notes ? 'NOTES: ' + f.notes : ''}`
  ).join('\n\n')
  return `======== RECONSTRUCTION ${i + 1} (lens: ${LENSES[i] ? LENSES[i].key : '?'}, confidence: ${s.confidence || 'n/a'}) ========\n` +
    `DRIVER FLOW:\n${s.driver_flow}\n\nFUNCTIONS:\n${fns}\n\nDIVERGENCES FLAGGED:\n${(s.divergences || []).join('\n- ')}`
}).join('\n\n')

const canonSpec = await agent(
  `${RULES}\n${CPP_SOURCE}\n${GROUND_TRUTH}\n\n` +
  `Four agents independently reconstructed the mapbox earcut algorithm from memory (one from the JS upstream, ` +
  `one from the C++ header, one focused on the fiddly predicates, one that hand-traced the three concrete ` +
  `inputs). Reconcile them into ONE canonical, unambiguous specification that a Rust engineer can implement ` +
  `without further guessing.\n\n` +
  `Method: where the reconstructions agree, take the agreed form. Where they disagree, decide using (a) the ` +
  `hand-trace evidence against the known-correct expected outputs, (b) internal consistency, (c) majority. ` +
  `You may verify hypotheses by running /workspace/dataset/test2_executable <n>, and you may prototype ` +
  `throwaway code under /tmp/spec-synth/ to check a trace numerically (any language). Resolve EVERY ` +
  `divergence explicitly -- an implementer must never have to choose.\n\n` +
  `Write the result to /tmp/earcut_spec.md. It must contain, in implementable detail:\n` +
  `  1. Node representation and the arena/index-based scheme you recommend for Rust (the C++ uses raw ` +
  `pointers into a pool; in Rust use a Vec<Node> arena with usize indices -- specify it precisely, including ` +
  `how removeNode/insertNode/splitPolygon behave with indices).\n` +
  `  2. Every function, in near-source form, with exact comparison operators and argument order.\n` +
  `  3. The driver flow including the 80-vertex hashing threshold and index numbering across rings.\n` +
  `  4. A section 'RESOLVED DIVERGENCES' listing each disputed detail and the chosen form + why.\n` +
  `  5. A section 'ORACLE TRACES' with the three verified input/output pairs.\n` +
  `Then return the file path plus a summary of the resolved divergences as your final text.\n\n` +
  `${specDump}`,
  { label: 'synthesize-spec', phase: 'Synthesize', effort: 'high' }
)

log('canonical spec written; starting 3 competing implementations')

// ---------------------------------------------------------------- phase 3: implement (3 competing)

phase('Implement')

const IMPL_COMMON = `
${RULES}
${CPP_SOURCE}
${GROUND_TRUTH}

A canonical algorithm specification has been written to /tmp/earcut_spec.md by a previous stage. READ IT
FIRST -- it resolves the version ambiguities in mapbox earcut. Treat it as authoritative but not infallible:
the reference binary /workspace/dataset/test2_executable is the final authority, and you may run it with any
argument as many times as you like.

DELIVERABLE: a complete, self-contained Rust Cargo project in the directory {DIR} (create it; do not touch
/output or any other directory except /tmp).

Required layout inside {DIR}:
  Cargo.toml            edition 2021, no [dependencies], no [dev-dependencies]
  test2.rs              the entry binary at the PACKAGE ROOT (not in src/), registered as
                        [[bin]] name = "test2", path = "test2.rs"
  src/lib.rs            library root
  src/<modules...>      the earcut port, split into meaningful modules (e.g. node/arena, geometry
                        predicates, z-order hashing, the triangulator driver, the atoi emulation)
IMPORTANT dual-build requirement: BOTH of these must work from {DIR}:
    cargo build --release
    rustc -O test2.rs -o /tmp/<something>
  The standard way to get both: have test2.rs pull the library in with an inline path module, e.g.
      #[path = "src/lib.rs"]
      mod earcut_lib;
  so plain rustc compiles the whole module tree, while Cargo also builds src/lib.rs as a real [lib] target.
  Make sure BOTH builds are warning-free (add narrowly-scoped #[allow(...)] only where genuinely needed,
  e.g. dead_code for library API surface the binary does not call).

The port itself:
  * Implement the FULL earcut algorithm, not a special case that happens to print the right numbers for
    squares. That means: winding detection, hole elimination via findHoleBridge/splitPolygon, the pass 0/1/2
    escalation (filterPoints -> cureLocalIntersections -> splitEarcut), AND the z-order curve hashing path
    (indexCurve/sortLinked/zOrder/isEarHashed) which activates for polygons with more than 80 vertices.
    Hard-coding or short-circuiting the algorithm is an automatic failure.
  * Use f64 throughout, matching the C++ double arithmetic exactly (same expression shapes, same order of
    operations -- do not "simplify" a floating-point expression).
  * Indices are u32 (the C++ instantiates earcut<uint32_t>).
  * Emulate atoi exactly as described above.
  * The output loop must be byte-identical: print each index followed by a single space, no newline.
  * Idiomatic, readable Rust: an index-based arena (Vec<Node> + usize handles) rather than unsafe pointers,
    doc comments on the public API, module-level comments explaining the algorithm phases.

SELF-VERIFICATION you must complete before returning (report actual results, never assume):
  1. cargo build --release  AND  rustc -O test2.rs  both succeed with zero warnings.
  2. A differential loop over the ENTIRE argument matrix above plus: no-arg, extra args ("2" "3" -> must
     behave as if only "2" was given), the empty string "", "  ", every integer from -20..20, and a few
     large values. Compare byte-for-byte (use cmp/diff on captured stdout, and check exit status) against
     /workspace/dataset/test2_executable. Every case must match.
  3. Geometric self-validation via #[cfg(test)] tests in the crate (cargo test --release), with a
     hand-rolled deterministic PRNG: for many generated polygons (convex, concave, star-shaped, with 1-3
     holes, collinear runs, duplicate points, degenerate all-equal rings, and at least one ring with >80
     vertices so the z-order hashing path is exercised), assert that
       - every emitted index is in range and each triangle has 3 distinct indices,
       - the number of triangles is plausible,
       - the summed absolute triangle area deviates from (outer ring area - hole areas) by a tiny relative
         epsilon (this is exactly how upstream earcut tests itself: a "deviation" metric),
       - no panics, no infinite loops (this is the real risk -- put a generous iteration guard in the TEST,
         never in the library).
     Report the worst deviation you observed.
  4. cargo test --release must pass.
Return the structured result. Be honest about anything that does not pass.
`

const IMPL_VARIANTS = [
  { dir: '/tmp/impl-a', extra: `Style directive: implement this as a close, mechanical transliteration of the C++/JS source
structure -- same function names, same control flow, same order of statements. Prioritise fidelity over
elegance. When in doubt, mirror the original.` },
  { dir: '/tmp/impl-b', extra: `Style directive: implement this as idiomatic Rust that is nonetheless behaviourally
identical -- newtype handles for arena indices, small helper methods on the arena, exhaustive doc comments,
predicates as free functions in a geometry module. You must still preserve exact floating-point expression
shapes and exact branch conditions; idiomatic means the *packaging* is Rust-native, not that the arithmetic
is rearranged.` },
  { dir: '/tmp/impl-c', extra: `Style directive: derive the implementation defensively. For every branch condition in the
spec, ask "what input would distinguish this from the plausible alternative?", and where the reference binary
can distinguish them, test it. Keep a written log of every such experiment in {DIR}/NOTES.md and summarise
it in your return value. Robustness against pathological input (NaN-free but degenerate, huge coordinate
ranges, thousands of vertices) is your priority.` },
]

const impls = await parallel(IMPL_VARIANTS.map(v => () =>
  agent(
    IMPL_COMMON.split('{DIR}').join(v.dir) + '\n\n' + v.extra.split('{DIR}').join(v.dir),
    { label: `impl:${v.dir.slice(-1)}`, phase: 'Implement', schema: IMPL_SCHEMA, effort: 'high' }
  )
))

const okImpls = impls.filter(Boolean)
log(`implementations returned: ${okImpls.length}/3 (build_ok: ${okImpls.filter(i => i.build_ok).length}, matrix_pass: ${okImpls.filter(i => i.all_matrix_pass).length})`)

// ---------------------------------------------------------------- phase 4: judge

phase('Judge')

const implDump = okImpls.map(i =>
  `--- ${i.dir} --- build_ok=${i.build_ok} matrix_pass=${i.all_matrix_pass} confidence=${i.confidence || 'n/a'}\n` +
  `mismatches: ${(i.mismatches || []).join('; ') || 'none reported'}\n` +
  `geometric: ${i.geometric_validation}\nfiles: ${(i.file_list || []).join(', ')}\nnotes: ${i.notes}`
).join('\n\n')

const judgement = await agent(
  `${RULES}\n${GROUND_TRUTH}\n\n` +
  `Three independent Rust ports of mapbox earcut were built. Your job is to pick the one that should be ` +
  `shipped to /output, and to find their defects. Do NOT trust the self-reports below -- re-run everything ` +
  `yourself.\n\n${implDump}\n\n` +
  `Do all of the following, working only in /tmp:\n` +
  `1. For each existing impl dir: build it fresh (cargo build --release AND rustc -O test2.rs), capture ` +
  `warnings, and run the full differential matrix against /workspace/dataset/test2_executable comparing raw ` +
  `bytes AND exit codes. Include: no arg, "", "  ", extra trailing args, all of -20..20, and the overflow ` +
  `strings from the table.\n` +
  `2. Cross-compare the impls on ARBITRARY polygons (the C++ binary cannot do this, so compare the impls ` +
  `against EACH OTHER): write a tiny extra bin inside each impl dir (e.g. src/bin/polydump.rs, allowed since ` +
  `these are throwaway /tmp copies) that reads a polygon from stdin as "R" lines of "x y x y ..." and prints ` +
  `the triangulation indices. Feed a few hundred deterministic pseudo-random polygons (convex, concave, ` +
  `star, spiral, with holes, with collinear and duplicate vertices, >80 vertices to force the z-order path, ` +
  `and degenerate rings) to all three. Any polygon where the three disagree is a strong signal that at ` +
  `least one is wrong -- for each disagreement, reason from the spec at /tmp/earcut_spec.md about which is ` +
  `right, and record it as a defect against the wrong one(s). Also validate each triangulation ` +
  `independently with the area-deviation metric.\n` +
  `3. Read the actual Rust source of each impl and check it against /tmp/earcut_spec.md for fidelity, ` +
  `especially: the winding sum formula, >= vs > in area/isEar, findHoleBridge tie-breaks, the ` +
  `"ear = next.next" skip, the pass 0/1/2 escalation, sortLinked's merge-sort, zOrder bit interleaving, ` +
  `and the atoi emulation. Also check that no impl hard-codes or short-circuits the algorithm.\n` +
  `4. Rank them and name a winner (the one with correct behaviour, full algorithm coverage, cleanest code). ` +
  `List grafts: specific things the losers do better that should be merged into the winner.\n` +
  `Return the structured judgement. Cite concrete evidence (commands + observed output) in the details.`,
  { label: 'judge', phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'xhigh' }
)

log(`winner: ${judgement && judgement.winner_dir} | defects found: ${judgement ? (judgement.defects || []).length : '?'}`)

// ---------------------------------------------------------------- phase 5: assemble into /output

phase('Assemble')

const assembleReport = await agent(
  `${RULES}\n${CPP_SOURCE}\n${GROUND_TRUTH}\n\n` +
  `A judging stage compared three Rust ports of mapbox earcut and chose a winner:\n` +
  `  winner: ${judgement ? judgement.winner_dir : '/tmp/impl-a'}\n` +
  `  ranking: ${judgement ? (judgement.ranking || []).join(' > ') : 'n/a'}\n` +
  `  rationale: ${judgement ? judgement.rationale : 'n/a'}\n` +
  `  defects to fix: ${judgement ? JSON.stringify(judgement.defects || []) : '[]'}\n` +
  `  grafts to apply: ${judgement ? (judgement.grafts || []).join(' | ') : 'none'}\n\n` +
  `YOUR JOB: produce the FINAL deliverable in /output. You own /output; no one else is writing there.\n\n` +
  `Steps:\n` +
  `1. Copy the winner into /output, then fix every defect listed above and apply the worthwhile grafts.\n` +
  `2. Remove any throwaway validation binaries the judge may have injected into the winner dir ` +
  `(e.g. src/bin/polydump.rs) -- /output must be clean. Keep the real #[cfg(test)] unit tests and any ` +
  `tests/ integration tests, they are part of a good deliverable.\n` +
  `3. Required final layout (exact):\n` +
  `     /output/Cargo.toml        package name "earcut", edition 2021, [lib] src/lib.rs,\n` +
  `                              [[bin]] name = "test2" path = "test2.rs", no dependencies at all\n` +
  `     /output/test2.rs          entry file at the package root: the ported main(), pulling the library in\n` +
  `                              via #[path = "src/lib.rs"] mod ... so that plain "rustc test2.rs" also works\n` +
  `     /output/src/lib.rs        library root with module docs\n` +
  `     /output/src/...           the earcut port in modules\n` +
  `     /output/README.md         short: what this is, how to build both ways, how it maps to the C++\n` +
  `4. Build BOTH ways, from /output, with zero warnings:\n` +
  `       cargo build --release          -> target/release/test2\n` +
  `       rustc -O test2.rs -o test2     -> /output/test2   <-- REQUIRED, the graders run this executable\n` +
  `   Leave the compiled executable at /output/test2 in place (do not delete it), and leave ` +
  `target/release/test2 in place too. /output/test2.rs must remain the Rust SOURCE file.\n` +
  `5. cargo test --release must pass. cargo build (debug) must also work.\n` +
  `6. Final differential proof, run from /output against /workspace/dataset/test2_executable, comparing ` +
  `stdout bytes exactly (use cmp) and exit codes: no-arg, "", "  ", "0", "1", "2", "3", "5", "10", every ` +
  `integer -20..20, "-1", "abc", "3abc", " 4", "2.9", "+3", "007", "0x10", "e2", "-0", "2147483648", ` +
  `"4294967296", "4294967298", "8589934594", "9223372036854775808", "-9223372036854775809", "1000000", ` +
  `and the two-argument case. Do this for BOTH /output/test2 and /output/target/release/test2. Report the ` +
  `pass/fail count with real command output.\n` +
  `Return: the final file tree, the build commands and their real output, and the differential results. ` +
  `If anything fails, fix it and re-run rather than reporting a broken deliverable.`,
  { label: 'assemble', phase: 'Assemble', effort: 'high' }
)

log('assembled into /output; starting adversarial verification')

// ---------------------------------------------------------------- phase 6: verify (parallel, diverse lenses)

phase('Verify')

const VERIFY_LENSES = [
  {
    key: 'differential',
    prompt: `Verify byte-exactness of /output against the C++ reference. Rebuild /output yourself
(cargo build --release and rustc -O test2.rs -o /tmp/vt2 -- do NOT overwrite /output/test2 or any file in
/output; you are read-only with respect to /output, write scratch to /tmp only). Then run an exhaustive
differential test against /workspace/dataset/test2_executable: every integer from -100..100, the whole
overflow/garbage string matrix, no-arg, empty-string arg, whitespace-only arg, multiple args, an argument
with a NUL-free 200-char digit string, and argv[1] values like "2\\n". Compare stdout with cmp (byte
exact, including the trailing space and absence of newline), compare stderr is empty, and compare exit
codes. Report the exact count of cases tested and any mismatch verbatim.`,
  },
  {
    key: 'geometry-fuzz',
    prompt: `Adversarially fuzz the /output earcut library for correctness on arbitrary polygons (the C++
binary cannot help here -- use mathematical invariants instead). Write your harness under /tmp only (you may
create a scratch Cargo project that includes /output/src via a #[path] module, or copy /output to /tmp and
add a bin there; do not modify /output). Generate tens of thousands of deterministic pseudo-random polygons:
convex, heavily concave, star/spiral, self-touching, with 0-4 holes, holes touching the outer ring, collinear
runs, duplicate consecutive vertices, entirely degenerate rings, coordinates spanning 1e-9..1e9, rings of
1..500 vertices (to exercise the z-order hashing path), and empty/1-vertex/2-vertex rings. Assert:
no panic, no hang (run each case in a bounded harness), all indices < vertex count, each triangle has three
distinct indices, triangle count <= plausible bound, and the area-deviation metric
|sum(|triangle area|) - (|outer| - sum|holes|)| / expected is tiny for the well-formed cases. Report the
worst deviation, any panic/hang with the exact reproducing polygon, and how many cases you ran.`,
  },
  {
    key: 'fidelity',
    prompt: `Line-by-line fidelity review: read every Rust source file in /output and compare against
/tmp/earcut_spec.md and your own knowledge of mapbox earcut. You are looking for places where the Rust
deviates from the C++/JS semantics in a way that could change output on SOME input, even if the three
shipped test cases still pass. Check specifically: the winding sum formula and the
"clockwise == (sum > 0)" decision; the "if (last && equals(last, last->next))" dedup at the end of
linkedList; filterPoints' 'again' loop and its steiner check; earcutLinked's exact push order
(prev, ear, next) and the "ear = next.next; stop = next.next" skip; >= vs > in area/isEar/pointInTriangle;
isEarHashed's z-range walk over prevZ/nextZ and its two while loops; zOrder's bit interleaving constants;
sortLinked's in-place merge sort (numMerges/inSize/pSize/qSize bookkeeping); indexCurve; cureLocalIntersections;
splitEarcut; isValidDiagonal (all four clauses); intersects/onSegment/sign; locallyInside; middleInside;
splitPolygon's node duplication; eliminateHoles' sort-by-x (is it a stable sort? does stability matter?);
findHoleBridge's every branch; getLeftmost's tie-break; the 80-vertex hashing threshold and bbox/inv_size
computation; the u32 index type; and the atoi emulation (saturation then i32 truncation). Also verify there
is NO hard-coding/short-circuiting of the algorithm and no unsafe. Report each deviation as a finding with
the file, the C++ semantics, the Rust semantics, and an input that would expose it if you can construct one.
Do not modify /output.`,
  },
  {
    key: 'packaging',
    prompt: `Audit /output against the literal task requirements, as a hostile grader would. Verify, with
commands and real output: (1) it is a complete Cargo project that builds with "cargo build --release" from a
CLEAN state (copy /output to /tmp, delete target/, rebuild there -- do not touch /output); (2) it builds with
plain "rustc test2.rs" from the package root (in your /tmp copy) and the resulting binary behaves
identically; (3) Cargo.toml declares edition 2021 and has ZERO dependencies and ZERO dev-dependencies, and
no build.rs, no .cargo/config, no vendored code, no network access needed; (4) grep the whole tree for any
"extern crate", "use <nonstd>", or crates.io names -- std only; (5) the entry file is /output/test2.rs at the
package root and a working compiled executable exists at /output/test2 (run it); (6) library code is
genuinely organised into modules (list them) rather than one blob; (7) no unsafe, no unwrap-on-user-input
panic paths, no debug prints, no leftover scratch/throwaway files, no stale artifacts from another impl;
(8) both cargo build (debug) and cargo test --release pass; (9) CLI parity: the binary takes the same single
optional positional integer argument, ignores extra args, and never prints usage/errors. Also flag anything
in the deliverable that looks unprofessional (dead code, commented-out blocks, TODOs, wrong package name).`,
  },
]

const verdicts = await parallel(VERIFY_LENSES.map(v => () =>
  agent(
    `${RULES}\n${CPP_SOURCE}\n${GROUND_TRUTH}\n\n` +
    `A Rust port of mapbox/earcut plus the ported test2 program has been assembled in /output. ` +
    `Assembly report:\n${assembleReport}\n\n` +
    `YOUR VERIFICATION ASSIGNMENT (${v.key}):\n${v.prompt}\n\n` +
    `Be adversarial: your job is to FIND problems, not to confirm success. Set pass=false if you found any ` +
    `blocker or major issue. Every claim must be backed by a command you actually ran and its real output.`,
    { label: `verify:${v.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'xhigh' }
  )
))

const okVerdicts = verdicts.filter(Boolean)
const allFindings = okVerdicts.flatMap(v => (v.findings || []).map(f => ({ ...f, area: v.area || 'unknown' })))
const serious = allFindings.filter(f => /blocker|major/i.test(f.severity || ''))

log(`verification: ${okVerdicts.filter(v => v.pass).length}/${okVerdicts.length} passed, ` +
    `${allFindings.length} findings (${serious.length} blocker/major)`)

// ---------------------------------------------------------------- phase 7: repair loop

phase('Repair')

let repairLog = []
let round = 0
let outstanding = serious

while (outstanding.length > 0 && round < 3) {
  round++
  log(`repair round ${round}: ${outstanding.length} blocker/major finding(s)`)

  const fixReport = await agent(
    `${RULES}\n${GROUND_TRUTH}\n\n` +
    `The Rust deliverable in /output has confirmed defects from an adversarial verification pass. You own ` +
    `/output for this round; fix them.\n\nFINDINGS:\n${JSON.stringify(outstanding, null, 2)}\n\n` +
    `For each finding: first decide whether it is REAL (some are false alarms -- verify against ` +
    `/workspace/dataset/test2_executable and /tmp/earcut_spec.md before changing anything; do not "fix" ` +
    `correct code into incorrect code). Fix the real ones minimally and precisely. Then re-establish the ` +
    `full quality bar and report REAL command output for each:\n` +
    `  * cargo build --release (zero warnings), cargo build, cargo test --release\n` +
    `  * rustc -O test2.rs -o test2  (leaving the executable at /output/test2)\n` +
    `  * the full differential matrix vs the C++ binary (all integers -20..20 plus the garbage/overflow ` +
    `strings, no-arg, "", "  ", extra args), byte-exact via cmp, for both /output/test2 and ` +
    `/output/target/release/test2\n` +
    `Return: per-finding verdict (real+fixed / not-real+why), the diff you applied, and the verification output.`,
    { label: `repair:r${round}`, phase: 'Repair', effort: 'xhigh' }
  )
  repairLog.push(`ROUND ${round}:\n${fixReport}`)

  const recheck = await parallel([
    () => agent(
      `${RULES}\n${GROUND_TRUTH}\n\nRepairs were applied to the Rust deliverable in /output:\n${fixReport}\n\n` +
      `Independently re-verify (do not modify /output; scratch in /tmp): rebuild both ways from a clean /tmp ` +
      `copy, re-run the exhaustive differential matrix vs /workspace/dataset/test2_executable (integers ` +
      `-100..100 + the full garbage/overflow string set + no-arg + "" + "  " + extra args, byte-exact via ` +
      `cmp + exit codes), confirm cargo test --release passes and both builds are warning-free, and confirm ` +
      `the previously reported findings are actually resolved and no NEW regression was introduced. Be ` +
      `adversarial.`,
      { label: `recheck:diff:r${round}`, phase: 'Repair', schema: VERDICT_SCHEMA, effort: 'xhigh' }
    ),
    () => agent(
      `${RULES}\n${GROUND_TRUTH}\n\nRepairs were applied to the Rust deliverable in /output:\n${fixReport}\n\n` +
      `Independently re-verify the ALGORITHM, not just the CLI (do not modify /output; scratch in /tmp): ` +
      `re-read every Rust source file for spec fidelity against /tmp/earcut_spec.md, and re-run a large ` +
      `deterministic geometric fuzz (thousands of polygons incl. holes, degenerate rings, collinear runs, ` +
      `duplicate vertices, >80-vertex rings for the z-order path) checking no panic, no hang, indices in ` +
      `range, and the area-deviation metric. Confirm the repair did not break the general algorithm while ` +
      `making the three shipped cases pass. Be adversarial.`,
      { label: `recheck:algo:r${round}`, phase: 'Repair', schema: VERDICT_SCHEMA, effort: 'xhigh' }
    ),
  ])

  const rc = recheck.filter(Boolean)
  outstanding = rc.flatMap(v => (v.findings || [])).filter(f => /blocker|major/i.test(f.severity || ''))
  log(`repair round ${round} recheck: ${rc.filter(v => v.pass).length}/${rc.length} passed, ` +
      `${outstanding.length} still outstanding`)
  if (outstanding.length === 0) log('all blocker/major findings resolved')
}

// ---------------------------------------------------------------- final summary

phase('Verify')

const summary = await agent(
  `Produce a final, honest status report for a completed C++ -> Rust migration deliverable in /output ` +
  `(mapbox/earcut ported to dependency-free Rust plus the ported test2 program).\n\n` +
  `Do this by INSPECTING REALITY, not by trusting the notes below: list /output, read Cargo.toml and the ` +
  `module list, run "cargo build --release", "cargo test --release", "rustc -O test2.rs -o /tmp/final_t2" ` +
  `(scratch to /tmp; you may leave /output as-is), and run a final byte-exact differential over the ` +
  `argument matrix vs /workspace/dataset/test2_executable. Confirm /output/test2 exists and is an executable ` +
  `that produces correct output.\n\n` +
  `Then report, concisely and factually:\n` +
  `  1. Final file tree of /output with a one-line purpose for each file.\n` +
  `  2. Build + test + differential results, with the real numbers (N/N cases byte-exact).\n` +
  `  3. What the port covers algorithmically (and confirm nothing is hard-coded/short-circuited).\n` +
  `  4. Any remaining known limitation, unresolved finding, or caveat -- state these plainly; do not ` +
  `paper over anything.\n\n` +
  `Context from earlier stages (may be stale -- verify before repeating any claim):\n` +
  `ASSEMBLY: ${assembleReport}\n\nVERIFICATION FINDINGS: ${JSON.stringify(allFindings, null, 2)}\n\n` +
  `REPAIRS: ${repairLog.join('\n\n') || 'none needed'}`,
  { label: 'final-report', phase: 'Verify', effort: 'high' }
)

return {
  winner: judgement ? judgement.winner_dir : null,
  spec: '/tmp/earcut_spec.md',
  verify_pass: okVerdicts.map(v => `${v.area}: ${v.pass ? 'PASS' : 'FAIL'}`),
  findings_total: allFindings.length,
  findings_serious_initial: serious.length,
  repair_rounds: round,
  outstanding_serious: outstanding.length,
  summary,
}
