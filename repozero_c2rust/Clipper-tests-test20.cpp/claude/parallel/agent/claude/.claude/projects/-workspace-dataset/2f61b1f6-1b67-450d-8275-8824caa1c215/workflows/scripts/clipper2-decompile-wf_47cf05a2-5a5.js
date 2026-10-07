export const meta = {
  name: 'clipper2-decompile',
  description: 'Decompile Clipper2 v2.0.1 engine+offset from an -O0 symbolized binary into faithful pseudocode for a Rust port',
  phases: [
    { title: 'Layouts', detail: 'infer struct field offsets and constants' },
    { title: 'Merge', detail: 'merge layout findings into one doc' },
    { title: 'Decompile', detail: 'faithful pseudocode per function group' },
    { title: 'Verify', detail: 'independently re-check riskiest claims' },
  ],
}

const COMMON = `
You are reverse-engineering a C++ library from a compiled binary, to enable a from-scratch Rust reimplementation.

BINARY: /workspace/dataset/test20_executable
  - x86-64 ELF, NON-PIE (fixed addresses, loads at 0x400000), compiled with g++ at -O0 (no inlining,
    every C++ statement maps almost 1:1 to asm), FULL symbol table (no DWARF for the library though).
  - It statically contains Clipper2 v2.0.1 (namespace Clipper2Lib) plus a small main().
  - Templates are instantiated for Point<long> (= Point64, {int64 x; int64 y}, 16 bytes) and Point<double>.
  - libc/libstdc++ are dynamically linked. std::vector<T> layout is libstdc++: {T* begin; T* end; T* cap} = 24 bytes.

TOOLS (use these, they are already set up):
  - /workspace/notes/dis.sh 'NamePattern'        # disassemble every function whose demangled name matches; callees demangled
  - /workspace/notes/dis.sh 'NamePattern' raw    # same but keep mangled callee names
  - /workspace/notes/symbols_core.txt            # addr size type demangled-name  for all Clipper2Lib functions
  - /workspace/notes/symbols_all.txt             # same, including std:: template instantiations
  - perl -e 'printf("%.17g\\n", unpack("d", pack("Q", 0x4000000000000000)))'   # decode a double bit pattern
  - To read a constant at a virtual address, use objdump, e.g.:
      objdump -s -j .rodata --start-address=0x431970 --stop-address=0x431980 /workspace/dataset/test20_executable
    then decode the little-endian bytes as double/int64 with perl. NOTE: constants may live in .rodata,
    .data.rel.ro or .data. Named constants exist in the symbol table (e.g. try: nm -C BIN | grep -i const).
  - There is NO python on this machine. Use perl/awk/bash.

HARD RULES:
  - Do NOT look for, download, or use the original Clipper2 C++ source (it is not present on this machine,
    and using it is forbidden). Derive EVERYTHING from the binary's disassembly. You may use general
    knowledge of the algorithm to *organize* your reading, but every concrete fact you report
    (comparison direction, constant, field offset, order of operations, early-return condition)
    MUST be justified by the asm you actually read.
  - Precision over speed. This is a numeric-exactness port: a single flipped comparison, a wrong
    rounding mode, a missing early-out, or a swapped argument silently corrupts the final answer.
  - At -O0 the asm is a direct transliteration of source. Read it linearly and reconstruct the
    original C++ statement by statement. Pay attention to: sign of comparisons (jg/jge/jl/jle/ja/jae),
    signed vs unsigned, int64 vs double math, cvttsd2si (C-style truncation toward zero) vs
    calls to nearbyint/llround/floor/ceil, integer overflow tricks, and short-circuit && / ||
    evaluation order.
  - Rounding matters: note EXACTLY how doubles become int64 (truncation via cvttsd2si, or a call to
    llround/lround/nearbyint/rint, or Clipper2's own rounding helper). Report the exact instruction/call.
`

const LAYOUT_TASKS = [
  {
    key: 'L1',
    label: 'layout:core-structs',
    prompt: `${COMMON}
TASK: Determine the exact memory layout of the Clipper2 core engine structs.

Structs to map: Vertex, LocalMinima, Active, OutPt, OutRec, and the member variables of
ClipperBase (the object pointed to by 'this' inside ClipperBase methods) and Clipper64.

Method: read the accessor patterns in small functions that touch these types. Good starting points:
  Clipper2Lib::Active::Active()            (default ctor: shows every field and its initial value)
  Clipper2Lib::ClipperBase::ClipperBase()  (ctor: shows every ClipperBase member + initial value)
  Clipper2Lib::NextVertex, PrevPrevVertex, IsMaxima, IsHotEdge, IsOpen, IsOpenEnd, GetPolyType,
  Clipper2Lib::GetDx, SetDx (if present), Clipper2Lib::NewOutPt / AddOutPt, NewOutRec,
  Clipper2Lib::GetRealOutRec, MoveSplits, SwapOutrecs, DisposeOutPt, UpdateEdgeIntoAEL,
  Clipper2Lib::AddLocMin, ReuseableDataContainer64::AddLocMin, AddPaths_.
Also: the enum PathType / VertexFlags encodings (VertexFlags is a bitmask: find the tested bit values
and infer which flag means OpenStart/OpenEnd/LocalMax/LocalMin).

DELIVERABLE: write /workspace/notes/layout_core.md containing, for EACH struct, a table of
  offset | size | field name (your best inference) | type | evidence (function + asm line)
plus the initial values set by each constructor, plus enum/bitmask encodings.
Where you are guessing a field's *name*, say so, but the offset/size/type must be evidence-backed.
Return a <=350 word summary of the layouts (offsets only, terse) plus the file path.`,
  },
  {
    key: 'L2',
    label: 'layout:aux-structs',
    prompt: `${COMMON}
TASK: Determine the exact memory layout of the Clipper2 auxiliary structs and the join machinery types.

Structs to map: HorzSegment, HorzJoin, IntersectNode, ReuseableDataContainer64, PolyPath / PolyPath64,
Rect<long> (Rect64), and Clipper2Lib::Point<double> (PointD).

Method: read
  Clipper2Lib::HorzSegment::HorzSegment(OutPt*), Clipper2Lib::UpdateHorzSegment,
  Clipper2Lib::HorzSegSorter::operator(), Clipper2Lib::HorzJoin::HorzJoin(OutPt*, OutPt*),
  Clipper2Lib::IntersectNode ctor / emplace_back instantiation, Clipper2Lib::IntersectListSort,
  Clipper2Lib::EdgesAdjacentInAEL, Clipper2Lib::ReuseableDataContainer64::*,
  Clipper2Lib::Rect<long>::AsPath, Rect<long> methods (Width/Height/MidPoint/IsEmpty/Contains),
  and any PolyPath64 methods.
For Rect64: determine the field ORDER in memory (left, top, right, bottom?) from AsPath() and
from GetBounds<long>. This matters: the caller does TranslatePaths(paths, -bounds.left, -bounds.top).
Also report what GetBounds returns for an EMPTY input (read the code path carefully — Clipper2 has a
peculiar initialization there; check whether it starts from INT64_MAX/INT64_MIN and whether it returns
an inverted/"invalid" rect or a zeroed rect when there are no points, and whether Rect64 has an
'IsValid'-style sentinel constructor).

DELIVERABLE: write /workspace/notes/layout_aux.md with offset|size|field|type|evidence tables,
plus a precise description of GetBounds<long>(Paths64) INCLUDING the empty-input case, and of
TranslatePaths<long>. Return a <=350 word summary + the file path.`,
  },
  {
    key: 'L3',
    label: 'layout:offset+consts',
    prompt: `${COMMON}
TASK: Determine (a) the layout of ClipperOffset and its nested Group, and (b) every named/anonymous
numeric constant used by the library.

(a) Read:
  Clipper2Lib::ClipperOffset::ClipperOffset(double, double, bool, bool)   -- ctor: all members + defaults
  Clipper2Lib::ClipperOffset::Group::Group(Paths64 const&, JoinType, EndType)
  Clipper2Lib::ClipperOffset::Clear, AddPaths, CalcSolutionCapacity, CheckReverseOrientation
Report the offset of every ClipperOffset member you can identify (delta_, group_delta_, abs_group_delta_,
temp_lim_/miter_limit_, steps_per_rad_, step_sin_/step_cos_, join_type_, end_type_, groups_, solution_,
solution_tree_, preserve_collinear_, reverse_solution_, error_code_, arc_tolerance_, ...). Names are
guesses; offsets/types must be evidence-backed.

(b) Constants: run
      nm -C /workspace/dataset/test20_executable | grep -iE 'const|tolerance|max_coord|min_coord|PI'
    and decode the values. Specifically hunt for and decode: arc_const (and any array around it),
    floating point tolerance constants, max_coord/min_coord (int64 clamp limits), MAX_DBL sentinels,
    PI, and the default arc tolerance. Report each as: symbol/address, raw hex, exact decimal value
    (print with perl "%.17g").

(c) Enum encodings: confirm from main()'s disassembly (main is at 0x402a9f) and from library code:
    FillRule {EvenOdd, NonZero, Positive, Negative} = ?, ClipType {NoClip/None, Intersection, Union,
    Difference, Xor} = ?, JoinType {Square, Bevel, Round, Miter} = ?, EndType {Polygon, Joined, Butt,
    Square, Round} = ?, PathType {Subject, Clip} = ?. Give the integer value of each.
    (Known already: main passes JoinType Round=2, Miter=3, Square=0, Bevel=1 and EndType::Polygon=0 --
    verify and extend.)

DELIVERABLE: write /workspace/notes/layout_offset_consts.md. Return a <=350 word summary + the file path.`,
  },
]

phase('Layouts')
const layouts = await parallel(LAYOUT_TASKS.map((t) => () =>
  agent(t.prompt, { label: t.label, phase: 'Layouts' })
))

phase('Merge')
const layoutDoc = await agent(`${COMMON}
TASK: You are given three independently-produced layout reports for the same binary. Merge them into
one authoritative reference document.

REPORT 1 (core structs):
${layouts[0] || '(missing)'}

REPORT 2 (aux structs):
${layouts[1] || '(missing)'}

REPORT 3 (offset + constants):
${layouts[2] || '(missing)'}

The full detail is on disk: /workspace/notes/layout_core.md, /workspace/notes/layout_aux.md,
/workspace/notes/layout_offset_consts.md -- read all three.

Resolve every conflict by going back to the asm yourself (use dis.sh). Then write
/workspace/notes/LAYOUTS.md: the single authoritative struct/constant/enum reference.

Return the COMPLETE content of the consolidated tables (structs: offset|field|type; all enum values;
all constants with exact values). Be terse but complete -- your returned text is injected into the
prompts of the next phase's agents, so it must be self-contained and accurate.`, { label: 'merge:layouts', phase: 'Merge' })

const GROUPS = [
  {
    key: 'g1_math',
    label: 'dc:geometry-math',
    fns: `Clipper2Lib::CrossProduct (all overloads), DotProduct (all overloads), CrossProductSign,
ProductsAreEqual, IsCollinear (if present), Area<long>(Path64), Area(OutPt*), AreaTriangle,
Clipper2Lib::Hypot, AlmostZero, GetLineIntersectPt<long> and <double>, SegmentsIntersect,
GetClosestPointOnSegment<long>, PerpendicDistFromLineSqrd<long>, PointInPolygon (if present),
GetBounds<long> (both Path64 and Paths64 overloads), TranslatePaths<long>, operator== / operator!= /
operator+ / operator- for Point<long>, GetUnitNormal, NormalizeVector, GetAvgUnitVector,
Clipper2Lib::GetDx, TopX (if present), and any rounding helper (look for a function that converts
double->int64; check what main and the library use: cvttsd2si vs a call).`,
  },
  {
    key: 'g2_setup',
    label: 'dc:path-input-setup',
    fns: `Clipper2Lib::AddPaths_, Clipper2Lib::AddLocMin, ReuseableDataContainer64::AddLocMin,
ReuseableDataContainer64::AddPaths, ClipperBase::AddPath, ClipperBase::AddPaths,
ClipperBase::AddReuseableData, Clipper64::AddSubject, Clipper64::AddClip, ClipperBase::Clear,
ClipperBase::Reset, ClipperBase::InsertScanline, ClipperBase::PopScanline,
ClipperBase::PopLocalMinima, Clipper2Lib::LocMinSorter (or whatever sorts local minima -- find it),
Clipper2Lib::IsValidAelOrder, ClipperBase::InsertLeftEdge, Clipper2Lib::InsertRightEdge,
Clipper2Lib::Active::Active, ClipperBase::DeleteFromAEL, ClipperBase::DeleteEdges,
ClipperBase::SwapPositionsInAEL, Clipper2Lib::SetDx/GetDx if present.
KEY QUESTIONS: exactly how the vertex list is built from an input path (duplicate-point handling,
collinear handling, is the closing segment implicit, what happens for paths with <3 points or
zero-length segments); exactly how local minima are found and flagged; the sort predicate used for
local minima and whether the sort is std::sort or std::stable_sort (check the instantiated symbol
name in symbols_all.txt -- this determines tie-break order and therefore output);
the exact IsValidAelOrder logic including its use of dx and the 'newcomer_is_left' semantics.`,
  },
  {
    key: 'g3_loop',
    label: 'dc:main-loop-windcount',
    fns: `ClipperBase::ExecuteInternal, Clipper64::Execute (all overloads),
ClipperBase::InsertLocalMinimaIntoAEL, ClipperBase::IsContributingClosed,
ClipperBase::IsContributingOpen, ClipperBase::SetWindCountForClosedPathEdge,
ClipperBase::SetWindCountForOpenPathEdge, ClipperBase::DoTopOfScanbeam, ClipperBase::DoMaxima,
ClipperBase::UpdateEdgeIntoAEL, Clipper2Lib::GetMaximaPair, GetCurrYMaximaVertex,
GetCurrYMaximaVertex_Open, Clipper2Lib::TrimHorz, Clipper2Lib::FindEdgeWithMatchingLocMin,
ClipperBase::PushHorz, ClipperBase::PopHorz, Clipper2Lib::IsHorizontal/IsHeadingRightHorz etc.
KEY QUESTIONS: the exact scanbeam loop structure in ExecuteInternal (order of DoIntersections,
DoTopOfScanbeam, DoHorizontal, ConvertHorzSegsToJoins, ProcessHorzJoins and where y advances);
the exact wind-count rules per FillRule in IsContributingClosed (all four fill rules, all clip types)
-- transcribe every branch; SetWindCountForClosedPathEdge's handling of same-poly-type vs
opposite-type edges and EvenOdd special cases.`,
  },
  {
    key: 'g4_intersect',
    label: 'dc:intersections',
    fns: `ClipperBase::DoIntersections, ClipperBase::BuildIntersectList,
ClipperBase::ProcessIntersectList, ClipperBase::AddNewIntersectNode,
Clipper2Lib::IntersectListSort, Clipper2Lib::EdgesAdjacentInAEL,
ClipperBase::AdjustCurrXAndCopyToSEL, Clipper2Lib::Insert1Before2InSEL,
Clipper2Lib::ExtractFromSEL, ClipperBase::SwapPositionsInAEL, and TopX / the curr_x update logic.
KEY QUESTIONS: the exact intersection-point computation in AddNewIntersectNode (including any
clamping of the resulting y/x into the current scanbeam, the exact rounding of double->int64, and any
fallback when the segments are parallel or the computed point is outside the scanbeam);
the exact sort comparator IntersectListSort (tie-breaks!) and whether std::sort or std::stable_sort
is used (check symbols_all.txt); the swap loop in ProcessIntersectList including the
'edges not adjacent' repair pass.`,
  },
  {
    key: 'g5_edges',
    label: 'dc:IntersectEdges+outrecs',
    fns: `ClipperBase::IntersectEdges (the big one, 0x965 bytes -- transcribe it COMPLETELY, branch by
branch), ClipperBase::AddLocalMinPoly, ClipperBase::AddLocalMaxPoly, ClipperBase::JoinOutrecPaths,
Clipper2Lib::SwapOutrecs, ClipperBase::AddOutPt, ClipperBase::NewOutRec,
ClipperBase::StartOpenPath, ClipperBase::Split, Clipper2Lib::SetOwner (if present),
Clipper2Lib::GetPrevHotEdge, Clipper2Lib::GetLastOp, Clipper2Lib::FixOutRecPts (if it belongs here).
KEY QUESTIONS: IntersectEdges is the heart of the algorithm -- every fill-rule branch, every
open-path branch, the wind-count updates (old_e1_windcnt/old_e2_windcnt), which edges become hot,
when AddOutPt vs AddLocalMinPoly vs AddLocalMaxPoly vs JoinOutrecPaths is called, and the
CheckJoinLeft/CheckJoinRight calls with their bool argument. Also: in AddLocalMinPoly, the exact
owner-assignment logic (is_new flag, GetPrevHotEdge, SetOwner) and the horizontal/pt handling.
Transcribe faithfully -- do not summarize away branches.`,
  },
  {
    key: 'g6_horz',
    label: 'dc:horizontals+joins',
    fns: `ClipperBase::DoHorizontal (0x7f2 bytes -- transcribe COMPLETELY),
ClipperBase::ResetHorzDirection, ClipperBase::ConvertHorzSegsToJoins,
ClipperBase::ProcessHorzJoins, ClipperBase::AddTrialHorzJoin, Clipper2Lib::UpdateHorzSegment,
Clipper2Lib::HorzSegSorter::operator(), ClipperBase::CheckJoinLeft, ClipperBase::CheckJoinRight,
Clipper2Lib::MoveSplits, Clipper2Lib::GetLastOp, Clipper2Lib::HorzIsSpike (if present),
Clipper2Lib::TrimHorz.
KEY QUESTIONS: DoHorizontal's full control flow (left/right direction, the while loop over
adjacent AEL edges, maxima handling, the horz_seg_ collection, and when it calls IntersectEdges
vs AddOutPt); the sort of horz_segs_ (std::sort vs stable_sort -- check symbols_all.txt) and the
exact HorzSegSorter comparator including tie-breaks; the exact conditions in CheckJoinLeft/Right
(the collinearity test, the bool 'check_curr_x' parameter, and which OutPts get spliced).`,
  },
  {
    key: 'g7_output',
    label: 'dc:output-building',
    fns: `ClipperBase::CleanCollinear, ClipperBase::FixSelfIntersects, ClipperBase::DoSplitOp,
Clipper2Lib::GetCleanPath, Clipper2Lib::DuplicateOp, Clipper2Lib::DisposeOutPt,
Clipper2Lib::DisposeOutPts, Clipper2Lib::FixOutRecPts, Clipper2Lib::BuildPath64,
Clipper64::BuildPaths64, ClipperBase::CheckBounds, ClipperBase::RecursiveCheckOwners,
ClipperBase::CheckSplitOwner, Clipper2Lib::Path2ContainsPath1, Clipper2Lib::PointInOpPolygon,
Clipper2Lib::GetRealOutRec, Clipper2Lib::IsValidOwner (if present), Clipper2Lib::Area(OutPt*),
Clipper2Lib::AreaTriangle, ClipperBase::CleanUp, ClipperBase::DisposeAllOutRecs,
Clipper2Lib::SegmentsIntersect (as used by DoSplitOp/FixSelfIntersects).
KEY QUESTIONS: the exact collinear-removal criterion in CleanCollinear (including preserve_collinear
handling and the 'is it a duplicate point' test); DoSplitOp's full logic (which of the two loops is
kept, area comparisons, the new OutRec creation, and the exact SegmentsIntersect/GetLineIntersectPt
usage with rounding); BuildPath64's point-emission rules (skipping duplicates/collinear, the
reverse flag, minimum path length, and whether the first point can be dropped);
BuildPaths64's filtering (which OutRecs are emitted, the is_open handling, and the ORDER in which
solution paths are appended -- order affects nothing numerically here but report it anyway);
CheckBounds/RecursiveCheckOwners/CheckSplitOwner ownership fixing.`,
  },
  {
    key: 'g8_offset1',
    label: 'dc:offset-driver',
    fns: `Clipper2Lib::InflatePaths (the free function at 0x404dea -- what it constructs and calls),
ClipperOffset::ClipperOffset, ClipperOffset::AddPath, ClipperOffset::AddPaths,
ClipperOffset::Group::Group, Clipper2Lib::GetLowestClosedPathInfo,
ClipperOffset::CheckReverseOrientation, ClipperOffset::CalcSolutionCapacity,
ClipperOffset::BuildNormals, ClipperOffset::DoGroupOffset (0x704 bytes -- transcribe COMPLETELY),
ClipperOffset::ExecuteInternal (0x4c7 bytes -- transcribe COMPLETELY),
ClipperOffset::Execute(double, Paths64&), ClipperOffset::Clear.
KEY QUESTIONS: exactly how group_delta_ is derived from delta and path orientation (sign flips!);
the computation of steps_per_rad_ / step_sin_ / step_cos_ from arc_tolerance/abs_delta (transcribe
the formula and every constant, including any clamping of arc tolerance and the
'steps per 360 degrees' minimum/maximum); the special-case handling when a group has a single point
or a degenerate path; whether and how ExecuteInternal post-processes the raw offset paths with a
Clipper64 union (which FillRule and ClipType, whether ReverseSolution/PreserveCollinear are set,
and whether the solution is reversed); the exact meaning of the bool ctor args
(preserve_collinear, reverse_solution) and their default values as used by InflatePaths.`,
  },
  {
    key: 'g9_offset2',
    label: 'dc:offset-joins',
    fns: `ClipperOffset::OffsetPoint, ClipperOffset::OffsetPolygon, ClipperOffset::OffsetOpenPath,
ClipperOffset::OffsetOpenJoined, ClipperOffset::DoBevel, ClipperOffset::DoSquare,
ClipperOffset::DoMiter, ClipperOffset::DoRound, Clipper2Lib::GetPerpendic,
Clipper2Lib::GetPerpendicD, Clipper2Lib::GetAvgUnitVector, Clipper2Lib::NormalizeVector,
Clipper2Lib::GetUnitNormal, Clipper2Lib::Hypot, Clipper2Lib::AlmostZero.
KEY QUESTIONS: OffsetPoint's decision tree -- the cos/sin of the turn angle, the concavity test,
the thresholds that select bevel vs square vs miter vs round, the miter-limit test formula, and the
exact order in which points are pushed; DoRound's step loop (initial angle, number of steps formula,
the rotation via step_sin_/step_cos_, whether the endpoint is emitted explicitly);
DoSquare's construction; DoMiter's formula; every double->int64 conversion's exact rounding
(cvttsd2si truncation vs a llround/nearbyint call) -- this is critical for exactness.`,
  },
]

phase('Decompile')
const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string', description: 'path of the report file written' },
    summary: { type: 'string', description: 'terse but information-dense summary of findings' },
    risky: {
      type: 'array',
      description: 'the 3-8 findings you are least sure about, each phrased as a checkable claim',
      items: { type: 'string' },
    },
  },
  required: ['file', 'summary', 'risky'],
}

const results = await pipeline(
  GROUPS,
  (g) => agent(`${COMMON}

AUTHORITATIVE STRUCT/CONSTANT/ENUM REFERENCE (derived by a previous agent from this same binary;
full version in /workspace/notes/LAYOUTS.md -- read it, and correct it if the asm disagrees):
${layoutDoc}

TASK: Faithfully decompile this group of functions into precise, complete C-like pseudocode that a
Rust programmer can transliterate without ever seeing the asm.

FUNCTIONS IN YOUR GROUP:
${g.fns}

Use /workspace/notes/dis.sh to disassemble each one. Work through them systematically. For each
function produce:
  1. Its exact signature (types, by-ref vs by-value, return type).
  2. Complete pseudocode -- every branch, every early return, every loop, in source order.
     Do NOT elide "uninteresting" branches; do NOT paraphrase conditions ("if the edges are
     adjacent" is useless; "if (node.edge1->next_in_ael == node.edge2 || node.edge2->next_in_ael ==
     node.edge1)" is what is needed).
  3. Every numeric constant with its exact value.
  4. Every double->int64 conversion, annotated with the exact rounding behaviour observed.
  5. Notes on anything surprising or that a reimplementer would plausibly get wrong.

DELIVERABLE: write /workspace/notes/${g.key}.md with the full transcription. It is fine (expected,
even) for this file to be long. Then return the structured summary.`, { label: g.label, phase: 'Decompile', schema: SUMMARY_SCHEMA }),
  (r, g) => r ? agent(`${COMMON}

TASK: Adversarially verify another agent's decompilation claims. Assume the claims may be wrong.

The report under review is at: ${r.file}  (read it)
It covers these functions: ${g.fns}

The report's author flagged these as the least-certain claims:
${(r.risky || []).map((x, i) => `  ${i + 1}. ${x}`).join('\n')}

Your job:
  1. Independently re-derive each flagged claim from the asm (dis.sh). Report CONFIRMED or WRONG
     (with the correct answer and the asm evidence).
  2. Then pick the 6 highest-risk *unflagged* claims in the report -- prioritise: comparison
     directions and their operands, sign conventions, double->int64 rounding, loop bounds and
     off-by-ones, short-circuit ordering, constants, and any place the report says "presumably"
     or "likely" -- and verify those too the same way.
  3. If the report OMITS a branch or a whole function that exists in the asm, say so explicitly.

Append your findings to ${r.file} under a heading "## Adversarial verification". Return a terse list
of every correction you made (or "no corrections" plus what you checked).`, { label: `vfy:${g.key}`, phase: 'Verify' }) : null
)

log(`decompiled ${results.filter(Boolean).length}/${GROUPS.length} groups`)
return {
  layoutDoc: '/workspace/notes/LAYOUTS.md',
  groups: GROUPS.map((g, i) => ({ key: g.key, file: `/workspace/notes/${g.key}.md`, verified: !!results[i] })),
}
