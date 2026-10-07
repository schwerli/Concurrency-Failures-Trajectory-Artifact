export const meta = {
  name: 'clipper2-rust-spec-design',
  description: 'Spec + design panel for a from-scratch Rust port of Clipper2 Union/Area/TranslatePaths',
  phases: [
    { title: 'Spec', detail: 'geometry ground truth, iostream double formatting, Clipper2 API conventions' },
    { title: 'Design', detail: '3 independent boolean-op engine designs' },
    { title: 'Judge', detail: 'score designs on correctness risk and implementability' },
  ],
}

const GROUND_RULES = `
CONTEXT: We are porting this C++ program to pure Rust (2021 edition, std only, ZERO external crates):

    #include "clipper2/clipper.h"
    using namespace Clipper2Lib;
    int main(int argc, char* argv[]) {
        Path64 rect1 = {Point64(0,0), Point64(50,0), Point64(50,50), Point64(0,50)};
        Path64 rect2 = {Point64(25,25), Point64(75,25), Point64(75,75), Point64(25,75)};
        Path64 rect3 = {Point64(50,50), Point64(100,50), Point64(100,100), Point64(50,100)};
        Paths64 subjects = {rect1, rect2, rect3};
        Paths64 unionAll = Union(subjects, FillRule::NonZero);
        double totalArea = 0;
        for (const auto& path : unionAll) totalArea += Area(path);
        Paths64 translated = TranslatePaths(unionAll, 200, 200);
        std::cout << totalArea << std::endl;
        return 0;
    }

The compiled C++ binary prints exactly the 5 bytes "6250\\n" for EVERY argument list (args are ignored), exit code 0.

HARD RULES for you:
- BLACK BOX ONLY. Do NOT read, fetch, or quote the real Clipper2 C++/C# source. It is not on disk. Infer semantics from the public interface and from general computational-geometry knowledge.
- The Rust port must use ONLY the standard library. No crates.io dependencies.
- Target toolchain is rustc 1.75.0 / cargo 1.75.0, edition 2021. Do not propose APIs newer than 1.75.
- Your final message IS the return value. Return data, not chit-chat.
`

phase('Spec')

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'risks'],
  properties: {
    findings: { type: 'array', items: { type: 'string' }, description: 'Concrete, precise statements of fact/spec' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Ways a naive port gets this wrong' },
  },
}

const GEOM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['unionPolygons', 'totalArea', 'reasoning', 'degeneracies'],
  properties: {
    unionPolygons: {
      type: 'array',
      description: 'Each polygon of the union result, as an ordered vertex ring',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['vertices', 'signedArea', 'isHole'],
        properties: {
          vertices: { type: 'array', items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 } },
          signedArea: { type: 'number' },
          isHole: { type: 'boolean' },
        },
      },
    },
    totalArea: { type: 'number' },
    reasoning: { type: 'string' },
    degeneracies: { type: 'array', items: { type: 'string' } },
  },
}

const specs = await parallel([
  () => agent(`${GROUND_RULES}

TASK: Compute the exact ground-truth geometry of Union({rect1,rect2,rect3}, FillRule::NonZero) for the three axis-aligned rectangles above.

rect1 = [0,50] x [0,50]
rect2 = [25,75] x [25,75]
rect3 = [50,100] x [50,100]

Note rect1 and rect3 touch ONLY at the single point (50,50). rect1&rect2 overlap in [25,50]x[25,50]. rect2&rect3 overlap in [50,75]x[50,75].

Work out by hand (show shoelace arithmetic) the boundary ring(s) of the union region, in the orientation Clipper2 would emit (outer contours positive-area / counter-clockwise in a standard math Y-up frame, holes negative). Give the exact signed area of each ring and the total. Verify the total equals 6250.

Also enumerate every degeneracy in this input that a boolean-op engine must handle correctly: collinear overlapping edge segments, T-junctions (a vertex of one polygon lying in the interior of another polygon's edge), the point-touch at (50,50), and vertices shared by 3+ edges. Be exhaustive and specific with coordinates.`,
    { label: 'spec:geometry', phase: 'Spec', schema: GEOM_SCHEMA }),

  () => agent(`${GROUND_RULES}

TASK: Specify exactly how \`std::cout << (double)x << std::endl\` formats a double under the DEFAULT locale/format flags, and how to reproduce it byte-for-byte in Rust with only std.

Cover: default precision (6), the defaultfloat/%g-like behaviour, when scientific notation kicks in (exponent < -4 or >= precision), trailing-zero suppression, the exponent format (e+05 style, minimum 2 exponent digits), negative zero, integral values like 6250.0 printing as "6250", infinity ("inf"), NaN ("nan"), and the -0 case.

Then specify a Rust function \`fn format_double_ostream(v: f64) -> String\` that reproduces C++ default \`operator<<\` for double using only std (format!("{:.*e}", ...) / format!("{:.*}", ...) primitives, manual trailing-zero trimming, manual exponent digit padding). Give the FULL Rust source of that function in one of the findings entries, plus a table of at least 15 (input -> expected output) test vectors including 6250.0, 0.0, -0.0, 1.0/3.0, 1e-5, 1e-4, 123456.0, 1234567.0, 0.0001234567, 1e20, -2.5, f64::INFINITY, f64::NAN, 100.0, 1e6.

Also state plainly whether Rust's own \`println!("{}", 6250.0f64)\` already yields "6250" (so the simple path is safe for this program), and where Rust's Display for f64 DIVERGES from C++ ostream default (e.g. 1234567.0, 1.0/3.0, 1e20).`,
    { label: 'spec:iostream-format', phase: 'Spec', schema: SPEC_SCHEMA }),

  () => agent(`${GROUND_RULES}

TASK: Write a precise black-box behavioural spec for the Clipper2 public API surface this program touches, so we can re-create it faithfully in Rust:

- \`Point64(x, y)\` — 64-bit integer point. Field types, range limits (Clipper2 uses a MAX_COORD guard around 4.6e18 / int64 range), equality.
- \`Path64\` = sequence of Point64 (an implicitly-closed polygon; the closing edge from last->first is implied, NOT duplicated).
- \`Paths64\` = sequence of Path64.
- \`FillRule\` enum — the exact enumerator list and order Clipper2 uses (EvenOdd, NonZero, Positive, Negative) and the winding-number predicate each implies.
- \`Area(const Path64&) -> double\` — the exact formula and sign convention. Clipper2 computes the shoelace sum with 128-bit-ish care and returns a double. State the sign for a counter-clockwise ring in a Y-up frame, and what it returns for paths with < 3 points.
- \`Area(const Paths64&) -> double\` — sum over paths.
- \`Union(const Paths64& subjects, FillRule) -> Paths64\` — a boolean union with NO clip paths, all inputs treated as closed subject polygons. Describe: output orientation convention (outer rings vs holes), whether collinear/duplicate points are removed from the output, whether the result is "clean" (no repeated vertices, no closing-point duplication), and whether output ordering is deterministic.
- \`TranslatePaths(const Paths64&, dx, dy) -> Paths64\` — signature (it is a template over path type with delta type matching the coordinate type), semantics, and whether it mutates in place or returns a copy.

Also list the OTHER commonly-used Clipper2 free functions we should include for a credible library port (Intersect, Difference, Xor, BooleanOp, ScalePath(s), ReversePath(s), IsPositive, PointInPolygon, Bounds, MakePath, StripDuplicates/StripNearEqual, Ellipse, TrimCollinear, RectClip) with one-line semantics each. Mark which are needed by the test program vs nice-to-have.

Be concrete and exhaustive; this becomes the Rust API contract.`,
    { label: 'spec:clipper-api', phase: 'Spec', schema: SPEC_SCHEMA }),
])

const [geom, fmt, api] = specs

log(`Spec done: geometry total=${geom?.totalArea}, ${geom?.unionPolygons?.length ?? 0} ring(s)`)

phase('Design')

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approach', 'moduleLayout', 'algorithmSteps', 'degeneracyHandling', 'orientationHandling', 'failureModes', 'linesOfCodeEstimate', 'confidence'],
  properties: {
    approach: { type: 'string' },
    moduleLayout: { type: 'array', items: { type: 'string' }, description: 'file path -> what lives there' },
    algorithmSteps: { type: 'array', items: { type: 'string' }, description: 'Numbered, implementable steps with the actual math' },
    degeneracyHandling: { type: 'array', items: { type: 'string' } },
    orientationHandling: { type: 'string' },
    failureModes: { type: 'array', items: { type: 'string' } },
    linesOfCodeEstimate: { type: 'integer' },
    confidence: { type: 'number', description: '0..1 that a careful implementer gets exactly 6250 and correct general unions' },
  },
}

const APPROACHES = [
  {
    key: 'vatti',
    brief: `Approach A: a Vatti-style active-edge scanline clipper, i.e. re-derive the algorithm Clipper2 itself uses.
Local minima list, scanbeam queue, active edge list ordered by x at the current scanline, intersection events within a scanbeam, winding counts (wind_cnt / wind_cnt2), OutRec/OutPt output linked lists, joining of horizontal edges.`,
  },
  {
    key: 'planar',
    brief: `Approach B: planar-subdivision / arrangement.
(1) Collect all directed edges of all input rings. (2) Split every edge at every intersection point and at every T-junction vertex, using exact integer predicates and rounding intersection points to the integer lattice the way Clipper does. (3) Build a planar graph keyed by integer vertex. (4) For each directed half-edge compute the winding number of the face immediately to its left and to its right, by ray casting / by accumulating crossing counts along a sweep. (5) Keep half-edges whose left face is "inside" per the fill rule and right face is "outside". (6) Trace closed rings by walking half-edges, at each vertex taking the next outgoing edge in angular order (the "most clockwise" turn) to build faces. (7) Classify rings into outers/holes by signed area and nesting.`,
  },
  {
    key: 'martinez',
    brief: `Approach C: Martinez-Rueda-Trecu sweep-line boolean operation.
Sweep events (left/right endpoints + intersection-split events) in a priority queue, a status line of segments ordered by y-at-x, computeFields to derive inOut/otherInOut/inResult flags, then result-segment connection into contours with hole/parent tracking.`,
  },
]

const designs = await parallel(APPROACHES.map((a) => () => agent(`${GROUND_RULES}

You are one of three independent architects. Design the Rust implementation of the polygon boolean engine using YOUR ASSIGNED APPROACH ONLY. Do not hedge toward the others.

${a.brief}

Requirements the design must satisfy:
- Pure std Rust, edition 2021, rustc 1.75. Integer coordinates are i64. No unsafe required.
- Must produce, for the 3-rectangle NonZero union above, exactly one outer ring of signed area +6250 (total 6250).
- Must correctly handle these degeneracies present in the input: a pure point-touch between rect1 and rect3 at (50,50); T-junctions where a rectangle corner lies in the interior of another rectangle's edge (e.g. (50,25) on rect1's right edge x=50, (25,50) on rect1's top edge y=50, (75,50)/(50,75) similarly); COLLINEAR OVERLAPPING edges (rect1's right edge x=50 from y=25..50 lies on rect3's left edge x=50 from y=50..100? verify which segments actually overlap) ; and vertices where 3+ edges meet.
- Output convention: outer contours counter-clockwise (positive shoelace area in a Y-up frame), holes clockwise (negative), no duplicated closing vertex, no collinear redundant vertices, deterministic ordering.
- Must generalise: arbitrary simple/self-intersecting input rings, all four fill rules, and the other boolean ops (Intersect / Difference / Xor).
- Must avoid i64 overflow in cross products: state exactly where i128 is required.

Here is the ground-truth geometry spec produced by another agent (trust but verify):
${JSON.stringify(geom)?.slice(0, 4000)}

And the API contract spec:
${JSON.stringify(api)?.slice(0, 6000)}

Deliver a design detailed enough that an implementer writes it without further research: give the actual predicates (cross products, orientation tests), the actual intersection-rounding rule, the exact data structures with Rust type signatures, and the tie-breaking rules at each ordering comparison. Be brutally specific about the point-touch at (50,50): say what your algorithm outputs there and why that still totals 6250.`,
  { label: `design:${a.key}`, phase: 'Design', schema: DESIGN_SCHEMA, effort: 'high' })))

const liveDesigns = designs.filter(Boolean)
log(`Designs: ${liveDesigns.map((d, i) => `${APPROACHES[i]?.key}=${d.confidence}`).join(' ')}`)

phase('Judge')

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'winner', 'rationale', 'mustFixInWinner', 'graftFromOthers'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'correctnessRisk', 'implementability', 'fidelity', 'total'],
        properties: {
          key: { type: 'string' },
          correctnessRisk: { type: 'number', description: '0..10, higher = safer' },
          implementability: { type: 'number', description: '0..10, higher = easier to get right from scratch' },
          fidelity: { type: 'number', description: '0..10, matches Clipper2 output conventions' },
          total: { type: 'number' },
        },
      },
    },
    winner: { type: 'string' },
    rationale: { type: 'string' },
    mustFixInWinner: { type: 'array', items: { type: 'string' }, description: 'Concrete defects in the winning design that the implementer MUST fix' },
    graftFromOthers: { type: 'array', items: { type: 'string' }, description: 'Better ideas from the losing designs to merge in' },
  },
}

const LENSES = [
  'correctness under degeneracy: hammer on the point-touch at (50,50), collinear overlaps, and T-junctions. Which design provably does the right thing there?',
  'implementability from scratch by one engineer in one pass with no reference source and no external crates, on rustc 1.75. Which design has the fewest places to silently get a tie-break wrong?',
  'fidelity to Clipper2 observable behaviour: ring orientation, hole sign, collinear-vertex removal, determinism, and generalisation to the other boolean ops and all four fill rules.',
]

const bundle = liveDesigns.map((d, i) => `### DESIGN ${APPROACHES[i]?.key}\n${JSON.stringify(d)}`).join('\n\n')

const verdicts = await parallel(LENSES.map((lens, i) => () => agent(`${GROUND_RULES}

You are judge #${i + 1} of 3. Score the three candidate designs THROUGH THIS LENS ONLY:

LENS: ${lens}

${bundle}

Be adversarial. Assume each design is subtly wrong until you have checked its predicates yourself. Hand-simulate the winning design on the 3-rectangle input far enough to convince yourself it emits a single ring of area 6250. List concrete defects.`,
  { label: `judge:${i + 1}`, phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'high' })))

const live = verdicts.filter(Boolean)
const tally = {}
for (const v of live) for (const s of (v.scores || [])) tally[s.key] = (tally[s.key] || 0) + (s.total || 0)
log(`Judge tally: ${JSON.stringify(tally)}`)

return {
  groundTruthGeometry: geom,
  formatSpec: fmt,
  apiSpec: api,
  designs: liveDesigns.map((d, i) => ({ key: APPROACHES[i]?.key, ...d })),
  judgeVerdicts: live,
  tally,
}
