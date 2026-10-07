export const meta = {
  name: 'clipper2-rust-design',
  description: 'Design a from-scratch, std-only Rust polygon-clipping engine matching Clipper2 boolean-op semantics',
  phases: [
    { title: 'Design', detail: '4 independent architectures for the boolean-op engine' },
    { title: 'Judge', detail: 'score each design on fidelity, robustness, implementability' },
    { title: 'Synthesize', detail: 'write the authoritative implementation spec' },
  ],
}

const CONTEXT = `
# TASK CONTEXT (shared)

We are migrating a C++ program to pure Rust (edition 2021, rustc 1.75.0, ZERO external crates, std only).

The C++ program is /workspace/dataset/test5.cpp:

    #include "clipper2/clipper.h"
    using namespace Clipper2Lib;
    int main(int argc, char* argv[]) {
        Path64 subject = {Point64(0,0), Point64(100,0), Point64(100,100), Point64(0,100)};
        Path64 clip    = {Point64(50,50), Point64(150,50), Point64(150,150), Point64(50,150)};
        Paths64 subjects = {subject};
        Paths64 clips    = {clip};
        Paths64 intersection = Intersect(subjects, clips, FillRule::EvenOdd);
        Paths64 unionResult  = Union(subjects, clips, FillRule::EvenOdd);
        Paths64 difference   = Difference(subjects, clips, FillRule::EvenOdd);
        Paths64 xorResult    = Xor(subjects, clips, FillRule::EvenOdd);
        std::cout << intersection.size() << std::endl;
        return 0;
    }

Reference binary /workspace/dataset/test5_executable prints exactly "1\\n" (verified) and ignores argv.

STRICT RULES:
- BLACK BOX: the Clipper2 C++ library source is NOT available and must NOT be sought, downloaded, or reconstructed from memory of its code. Infer required behavior from the public interface (Point64, Path64, Paths64, FillRule, Intersect/Union/Difference/Xor) and from general computational-geometry knowledge. There is no network.
- Pure std Rust only. No crates.io dependencies. rustc 1.75.0, so do not use std APIs stabilized after 1.75.
- Library code will be compiled BOTH as a Cargo lib AND textually as a submodule of a standalone binary, so it must NEVER use \`crate::\` paths — only \`self::\`, \`super::\`, and relative module paths.

# WHAT MUST BE BUILT

A genuine, general-purpose polygon clipping engine in Rust that reproduces Clipper2's public boolean-op semantics:
- Types: Point64 { x: i64, y: i64 }, Path64 = Vec<Point64>, Paths64 = Vec<Path64>, Rect64.
- enum FillRule { EvenOdd, NonZero, Positive, Negative }
- enum ClipType { NoClip, Intersection, Union, Difference, Xor }
- Free functions Intersect / Union / Difference / Xor (subjects, clips, fill_rule) -> Paths64.
- Inputs are arbitrary: possibly self-intersecting, unclosed (implicitly closed), with duplicate or collinear vertices, holes, multiple contours, touching/overlapping edges, collinear overlaps, and degenerate (zero-area, spike) contours.
- Coordinates are i64; intersection points of integer segments are RATIONAL and Clipper2 rounds them to the integer grid. Rounding may create new crossings or move points onto other edges, so the algorithm must be robust to that.
- Output: a set of closed contours (outer boundaries AND holes as separate paths, as Clipper2 returns them from these free functions), with duplicate and collinear vertices removed (Clipper2's default is PreserveCollinear = false), degenerate contours (fewer than 3 points, or zero area) discarded, outer contours with positive area and holes with negative area under the convention Area(path) = 0.5 * sum(cross products).
- The printed value in the test is intersection.size() == 1, but the engine must be correct in general, not special-cased to this input.

Verification will be self-driven (the reference binary takes no arguments and only prints one number), via: known-answer geometric tests, and algebraic properties such as
  area(A ∪ B) + area(A ∩ B) == area(A) + area(B),
  area(A xor B) == area(A ∪ B) - area(A ∩ B),
  (A \\ B) ∪ (A ∩ B) == A,
  idempotence, commutativity, empty/degenerate handling,
plus randomized differential checks against an independent slow reference (e.g. a grid/scanline rasterization oracle at unit resolution, or sampled point-in-polygon under the given fill rule).
`

phase('Design')

const ANGLES = [
  {
    key: 'arrangement',
    label: 'design:arrangement',
    brief: `Design the engine around a PLANAR ARRANGEMENT: gather all directed edges of subject and clip, split every segment at every intersection point (with integer rounding, iterated to a fixed point so rounding-induced crossings are resolved), deduplicate overlapping collinear edge fragments while accumulating per-source winding deltas, classify each surviving fragment by computing the "inside" predicate for subject and clip on both sides (from winding numbers under the FillRule), keep fragments whose classification differs across the two sides, then stitch kept directed edges into closed loops via angular ordering at each vertex.`,
  },
  {
    key: 'vatti',
    label: 'design:vatti',
    brief: `Design the engine as a VATTI-STYLE SWEEP (the family Clipper itself belongs to): local-minima list, scanbeam queue, active-edge list ordered by x at the current scanline, intersection events resolved per scanbeam, winding counts (wind_cnt / wind_cnt2) maintained per active edge, contribution decided by FillRule + ClipType, and output built incrementally through output-record joining (left/right bounds, horizontal edge handling, maxima/minima pairing).`,
  },
  {
    key: 'martinez',
    label: 'design:martinez',
    brief: `Design the engine around the MARTINEZ-RUEDA-FEITO boolean algorithm: sweep line over sorted endpoint events, subdivide segments at intersections, compute inOut / otherInOut flags per event to classify edges as contributing or not for each operation, then connect the result edges into contours. Explain precisely how you generalize its (normally even-odd-per-polygon, non-self-intersecting) model to Clipper2's four FillRules and to self-intersecting input.`,
  },
  {
    key: 'hybrid-oracle',
    label: 'design:hybrid-verifiable',
    brief: `Design for MAXIMUM VERIFIABILITY: pick whichever core algorithm you judge most likely to be bug-free in a from-scratch std-only implementation, but center the design on exactness and testability — exact integer/rational predicates (i128 cross products, exact orientation and segment-intersection tests, no floating point in decisions), a simple independent oracle implementation (e.g. point-sampling / rasterization) usable as a differential test reference, deterministic tie-breaking rules, and an explicit list of invariants that can be asserted at every stage.`,
  },
]

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approach_name', 'core_algorithm', 'module_breakdown', 'fill_rule_handling', 'rounding_strategy', 'degeneracy_handling', 'output_normalization', 'risks', 'estimated_loc', 'self_assessment'],
  properties: {
    approach_name: { type: 'string' },
    core_algorithm: { type: 'string', description: 'Detailed step-by-step description of the algorithm, enough to implement from.' },
    module_breakdown: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'responsibility', 'key_items'],
        properties: {
          path: { type: 'string' },
          responsibility: { type: 'string' },
          key_items: { type: 'array', items: { type: 'string' }, description: 'Key types/functions with signatures' },
        },
      },
    },
    fill_rule_handling: { type: 'string', description: 'Exactly how EvenOdd/NonZero/Positive/Negative map to inside-tests, and how ClipType combines subject-inside and clip-inside.' },
    rounding_strategy: { type: 'string', description: 'How rational intersection points are rounded to i64 and how rounding-induced degeneracies are handled.' },
    degeneracy_handling: { type: 'array', items: { type: 'string' }, description: 'One entry per degenerate case (collinear overlap, touching vertex, spike, duplicate point, zero-area contour, unclosed path, empty input, ...) with the chosen handling.' },
    output_normalization: { type: 'string', description: 'Collinear/duplicate removal, degenerate contour dropping, orientation/area sign convention, ordering of returned paths.' },
    risks: { type: 'array', items: { type: 'string' } },
    estimated_loc: { type: 'integer' },
    self_assessment: { type: 'string', description: 'Honest weaknesses of THIS approach vs the alternatives.' },
  },
}

const designs = await parallel(ANGLES.map(a => () =>
  agent(
    `${CONTEXT}

# YOUR ASSIGNMENT (${a.key})

${a.brief}

Produce a concrete, implementable design. Be specific about data structures, exact predicates (with i128 arithmetic where overflow is possible: coordinates are i64 but in practice within +/-2^47 for this workload — still, state your overflow analysis), tie-breaking rules, and the precise algorithm for every stage. Where a stage has a known-hard degeneracy, say exactly how you resolve it rather than hand-waving.

You may read /workspace/dataset/test5.cpp and run /workspace/dataset/test5_executable. Do NOT attempt to find or reconstruct the Clipper2 C++ source. Do not write any files; return your design via the structured output tool.`,
    { label: a.label, phase: 'Design', schema: DESIGN_SCHEMA }
  )
))

const valid = designs.filter(Boolean)
log(`${valid.length}/${ANGLES.length} designs produced`)

phase('Judge')

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ranking', 'best_approach', 'rationale', 'ideas_to_graft', 'fatal_flaws'],
  properties: {
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['approach_name', 'fidelity', 'robustness', 'implementability', 'verifiability', 'total'],
        properties: {
          approach_name: { type: 'string' },
          fidelity: { type: 'integer', description: '0-10: likelihood of matching Clipper2 output semantics (path counts, holes, orientation)' },
          robustness: { type: 'integer', description: '0-10: handling of degeneracies and integer rounding' },
          implementability: { type: 'integer', description: '0-10: likelihood of a correct from-scratch std-only Rust implementation' },
          verifiability: { type: 'integer', description: '0-10: ease of proving correctness by tests/invariants' },
          total: { type: 'integer' },
        },
      },
    },
    best_approach: { type: 'string' },
    rationale: { type: 'string' },
    ideas_to_graft: { type: 'array', items: { type: 'string' }, description: 'Specific ideas from the runners-up that should be merged into the winner.' },
    fatal_flaws: { type: 'array', items: { type: 'string' }, description: 'Concrete flaws found in any design that must be avoided.' },
  },
}

const LENSES = [
  { key: 'fidelity', focus: 'FIDELITY to Clipper2 output semantics: number of returned paths, holes returned as separate contours, orientation/area-sign conventions, collinear-vertex removal, behaviour under EvenOdd for the specific two-square test, and general agreement with what a Clipper2 user would expect.' },
  { key: 'robustness', focus: 'ROBUSTNESS: integer rounding of rational intersections, collinear overlaps, vertex-on-edge touching, self-intersecting input, spikes and zero-area contours, and whether the design can silently produce unclosed or crossing output loops.' },
  { key: 'implementability', focus: 'IMPLEMENTABILITY in one pass of from-scratch std-only Rust at rustc 1.75, including how much subtle state must be kept correct, how debuggable each stage is, and realistic bug-rate per approach.' },
]

const judgeInput = JSON.stringify(valid, null, 1)

const judgements = await parallel(LENSES.map(l => () =>
  agent(
    `${CONTEXT}

# YOUR ASSIGNMENT: judge competing designs through one specific lens

Lens: ${l.focus}

Here are the candidate designs (JSON):

${judgeInput}

Score every design 0-10 on each axis, rank them, name the single best, and list specific ideas from the runners-up worth grafting onto the winner. Be adversarial: hunt for concrete fatal flaws (cases where the design produces the wrong number of output contours, infinite-loops, or cannot terminate rounding iteration). Judge the designs on their merits, not their ambition.`,
    { label: `judge:${l.key}`, phase: 'Judge', schema: JUDGE_SCHEMA }
  )
))

const verdicts = judgements.filter(Boolean)

phase('Synthesize')

const spec = await agent(
  `${CONTEXT}

# YOUR ASSIGNMENT: write the authoritative implementation SPEC

Candidate designs (JSON):
${judgeInput}

Judge panel verdicts (JSON):
${JSON.stringify(verdicts, null, 1)}

Synthesize ONE final design: take the winning approach, graft in the best ideas from the runners-up, and eliminate every fatal flaw the judges identified. Then write the specification to /tmp/design/SPEC.md (create the directory). The spec must be detailed enough that a competent Rust engineer can implement it without further design decisions:

1. Module layout with exact file paths under /output/src/, and the responsibility of each.
2. Every public type and function signature (matching the Clipper2-style API named in the task context).
3. Exact predicates and arithmetic (i128 where needed) with an overflow analysis.
4. Stage-by-stage pseudocode for the boolean-op pipeline, including the rounding fixed-point iteration with a proven termination argument (or a bounded iteration with a documented fallback).
5. Precise fill-rule and clip-type classification tables.
6. A complete degeneracy checklist with the resolution for each case.
7. Output normalization rules (dedup, collinear removal, degenerate dropping, orientation, hole handling).
8. Invariants to assert between stages.
9. A test plan: known-answer tests, algebraic property tests, and an independent slow oracle (specify the oracle algorithm precisely) for randomized differential testing.

HARD CONSTRAINTS to state in the spec: std only; edition 2021 / rustc 1.75; no \`crate::\` paths anywhere in library code (use \`self::\`/\`super::\`) because the same sources are compiled both as a Cargo lib and as a \`#[path]\` submodule of the standalone binary /output/test5.rs; no floating point in any decision predicate; deterministic output ordering.

Return a concise summary (<= 40 lines) of the final design plus the absolute path of the spec file you wrote.`,
  { label: 'synthesize:spec', phase: 'Synthesize' }
)

return { spec, verdicts }
