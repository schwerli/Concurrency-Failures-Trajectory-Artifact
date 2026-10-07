export const meta = {
  name: 'clipper2-recon',
  description: 'Reverse-engineer exact Clipper2 offset+union semantics from the provided unoptimized binary via gdb and objdump',
  phases: [
    { title: 'Recon', detail: 'gdb stage dumps, offset disasm, engine disasm, iostream formatting' },
    { title: 'Cross-check', detail: 'verify each report against independently observable binary behavior' },
  ],
}

const COMMON = `
CONTEXT
=======
We must reimplement, in pure Rust (std only, no crates), the exact behaviour of this C++ program:

  // /workspace/dataset/test7.cpp
  int offset = (argc > 1) ? std::stoi(argv[1]) : 10;
  Path64 square = {Point64(0,0), Point64(100,0), Point64(100,100), Point64(0,100)};
  Path64 triangle = {Point64(50,0), Point64(100,100), Point64(0,100)};
  Paths64 subjects = {square};
  Paths64 clips = {triangle};
  Paths64 intersected = Intersect(subjects, clips, FillRule::EvenOdd);
  Paths64 offsetResult = InflatePaths(intersected, offset, JoinType::Round, EndType::Polygon);
  if (!offsetResult.empty() && !offsetResult[0].empty()) {
      double area = Area(offsetResult[0]);
      Rect64 bounds = GetBounds(offsetResult);
      int64_t width = bounds.right - bounds.left;   // unused
      int64_t height = bounds.bottom - bounds.top;  // unused
      std::cout << area << std::endl;
  } else { std::cout << 0 << std::endl; }

The compiled reference binary is /workspace/dataset/test7_executable. It is:
  - dynamically linked, NOT stripped (full C++ symbol names via 'nm -C')
  - compiled at -O0 (very readable disassembly, gdb-friendly)
  - Clipper2 version string "2.0.1"; translation units clipper.engine.cpp, clipper.offset.cpp, clipper.rectclip.cpp
  - Point<long> is 16 bytes (x:int64 at +0, y:int64 at +8). No Z field.
  - std::vector layout: {begin ptr @+0, end ptr @+8, cap ptr @+16} = 24 bytes.
  - Paths64 = std::vector<std::vector<Point<long>>>; outer elements are 24 bytes each.

TOOLS AVAILABLE: objdump, nm, readelf, gdb (all at /opt/compiler/gcc-12/bin), gcc/g++, perl, awk, bash.
NOT available: python3.
gdb works but prints warnings (ASLR disable fails, libthread_db) - ignore them. Use
  gdb -q -batch -ex "..." -ex "..." --args ./test7_executable 10
Use 'set confirm off' and 'set pagination off'. Use --args to pass argv.

The ONLY variable input to the program is the integer 'offset' (std::stoi, base 10). Ground truth
outputs already measured (offset -> stdout):
  -40..-31 -> 0 ; -30 -> 3 ; -29 -> 18 ; -28 -> 45 ; -27 -> 78 ; -26 -> 128 ; -25 -> 210 ;
  -24 -> 253 ; -23 -> 325 ; -22 -> 392 ; -21 -> 512 ; -20 -> 630 ; -15 -> 1352 ; -10 -> 2312 ;
  -5 -> 3570 ; -1 -> 4753 ; 0 -> 5000 ; 1 -> 5302 ; 2 -> 5712 ; 5 -> 6577.5 ; 10 -> 8514.5 ;
  100 -> 68653 ; 1000 -> 3.46204e+06 ; 10000 -> 3.16571e+08 ; 1000000 -> 3.13363e+12
  no args -> 8514.5 ; "12abc" -> 9351 (same as 12) ; "abc" or "" -> std::invalid_argument, abort, exit 134

RULES
=====
- You may freely disassemble and debug /workspace/dataset/test7_executable. That is explicitly sanctioned.
- Do NOT attempt to download or fetch Clipper2 source code, and do not rely on remembering it: every
  claim you make must be justified by what you actually observe in THIS binary (disassembly or gdb).
  Where your prior knowledge of Clipper2 suggests something, you must CONFIRM it in the disassembly
  and say explicitly which instructions confirm it.
- Report exact numeric constants as both hex bit patterns and decimal values.
- Be exhaustive and precise. Downstream, someone will write Rust from your report ALONE and it must
  reproduce results bit-for-bit. Ambiguity is failure.
- Write your full report to the file path given below, then return a SHORT (<=30 line) summary plus
  that path. Do not return the whole report as your message.
`;

phase('Recon')

const tasks = [
  {
    label: 'gdb-stage-dumps',
    out: '/workspace/recon/01-gdb-ground-truth.md',
    prompt: `${COMMON}

YOUR TASK: build a gdb-based harness that dumps the exact intermediate Paths64 values, for many offsets.

Useful symbol addresses (verify with 'nm -C /workspace/dataset/test7_executable'):
  0x40a3ba  Clipper2Lib::ClipperBase::AddPaths(Paths64 const&, PathType, bool)
              args: rdi=this, rsi=&paths, edx=PathType, cl=is_open
  0x40468c  Clipper2Lib::Clipper64::Execute(ClipType, FillRule, Paths64&)
              args: rdi=this, esi=ClipType, edx=FillRule, rcx=&solution
  0x427f4a  Clipper2Lib::ClipperOffset::Execute(double, Paths64&)
  0x427a82  Clipper2Lib::ClipperOffset::ExecuteInternal(double)
  0x4279f2  Clipper2Lib::ClipperOffset::CheckReverseOrientation()
  0x426c72  Clipper2Lib::ClipperOffset::OffsetPolygon(Group&, Path64 const&)
  0x40f33c  Clipper2Lib::Clipper64::BuildPaths64(Paths64&, Paths64*)

There should be exactly 3 calls to ClipperBase::AddPaths per run:
  #1 = Intersect subjects (the square), #2 = Intersect clips (the triangle),
  #3 = the RAW offset polygon(s) produced by ClipperOffset before its internal cleanup Union.
And exactly 2 calls to Clipper64::Execute: #1 = the Intersect, #2 = the offset cleanup Union.
CONFIRM these counts empirically rather than assuming.

Write a bash+gdb script /workspace/recon/dump.sh that takes an offset argument and prints, in a
simple parseable text format:
  INTERSECT_IN_SUBJ / INTERSECT_IN_CLIP / INTERSECT_OUT / OFFSET_RAW / OFFSET_OUT
each as a list of paths, each path as a list of (x,y) integer pairs, in order.
Technique hint: break on the symbol, read the vector triple with gdb 'x/3gx $rsi' etc., then dump
each inner vector's Point64 array with 'x/Ngd'. For return values use gdb 'finish' then re-read the
out-param buffer. Since the code is -O0 you can also break at the call sites inside main
(disassemble main: it starts at 0x403aaf) and read named stack slots by offset from %rbp.
Verify your dumper is right by checking that Area(OFFSET_OUT[0]) computed by shoelace equals the
program's printed stdout for that offset (write a tiny awk/perl shoelace checker). Do this for at
least 25 different offsets and report any mismatch.

Then produce a ground truth data file /workspace/recon/ground_truth.txt covering EVERY integer
offset in -45..80, plus 100,150,200,300,500,1000,2000,10000. For each offset record at minimum:
  - the exact OFFSET_RAW path(s) (vertex list)
  - the exact OFFSET_OUT path(s) (vertex list), including how many paths and their order
  - the program's printed stdout
Also record INTERSECT_OUT (it should be offset-independent - confirm that, and give its exact
vertex list and orientation/signed area).

In your report, call out explicitly:
  - For which offsets does OFFSET_OUT contain more than one path? What is the ordering rule you can
    infer (offsetResult[0] is what gets printed, so ordering matters)?
  - For which offsets is OFFSET_OUT[0] NOT simply OFFSET_RAW with collinear/duplicate points removed?
  - The exact signed area (shoelace/2) of OFFSET_RAW vs OFFSET_OUT[0] per offset, so we can see where
    the cleanup Union actually changes geometry.
Write the full report to ${'/workspace/recon/01-gdb-ground-truth.md'} and keep ground_truth.txt as data.`,
  },
  {
    label: 'offset-disasm',
    out: '/workspace/recon/02-offset-module.md',
    prompt: `${COMMON}

YOUR TASK: from the disassembly ONLY, produce exact, line-level pseudocode for the polygon-offsetting
module (clipper.offset.cpp) as compiled into this binary, sufficient to reimplement bit-exactly.

Functions to fully analyse (get exact addresses+sizes with 'nm -SC'):
  ClipperOffset::ClipperOffset(double,double,bool,bool)   0x4048cc   (default ctor args used by
      InflatePaths: find them by disassembling Clipper2Lib::InflatePaths at 0x404bdf)
  Clipper2Lib::InflatePaths(Paths64 const&,double,JoinType,EndType,double,double)  0x404bdf
  ClipperOffset::Group::Group(Paths64 const&, JoinType, EndType)   0x4253ee
  Clipper2Lib::GetLowestClosedPathInfo(...)  (find address)
  ClipperOffset::AddPath 0x425580, AddPaths 0x425628
  ClipperOffset::BuildNormals 0x425676
  Clipper2Lib::GetUnitNormal(Point64 const&, Point64 const&)   (find address; static)
  Clipper2Lib::GetPerpendic(Point64 const&, PointD const&, double)  (find address; static)
  ClipperOffset::DoBevel 0x425804, DoSquare 0x425c3a, DoMiter 0x426214, DoRound 0x42635a
  ClipperOffset::OffsetPoint 0x42681e
  ClipperOffset::OffsetPolygon 0x426c72, OffsetOpenJoined 0x426d16, OffsetOpenPath 0x426e66
  ClipperOffset::DoGroupOffset 0x427246
  ClipperOffset::CalcSolutionCapacity 0x42794a
  ClipperOffset::CheckReverseOrientation 0x4279f2
  ClipperOffset::ExecuteInternal(double) 0x427a82
  ClipperOffset::Execute(double, Paths64&) 0x427f4a
  Clipper2Lib::arc_const, floating_point_tolerance (static consts - read their values from .rodata /
  .data with objdump -s, and find where they are loaded)

CRITICAL things I need pinned down EXACTLY, with the instructions that prove them:
 1. The default arc_tolerance and miter_limit passed by InflatePaths, and the two bool ctor args.
 2. The exact formula for steps-per-360 / steps-per-radian, and whether there is a clamp like
    min(x, abs_delta*PI). Give the exact constant(s) (e.g. is there a 0.25, a log10, an acos, a
    'arc_const'?). Show the FP constants as hex doubles from .rodata.
 3. The exact rounding used when converting double coords to Point64 (nearbyint? rint? lround?
    +0.5 truncation? Which libm call or SSE instruction - look for roundsd/cvtsd2si/nearbyint@plt).
    State the tie-breaking behaviour and the SSE rounding mode used.
 4. DoRound: exact sequence of emitted points; is the step rotation a fixed step_sin/step_cos
    applied cumulatively (accumulating FP error) or recomputed per step? Is the sign of step_sin
    flipped for negative delta? How many intermediate points (loop bounds)? Is the final point
    GetPerpendic(pt, norms[j], delta)?
 5. OffsetPoint: the exact branch conditions and their constants (e.g. -0.99, 0.999, sin_a/cos_a
    clamping to [-1,1]), the concavity test, and exactly which points are pushed in the concave
    branch (2 points? 3 points including the original vertex?).
 6. DoGroupOffset: how group_delta is derived from delta and the group's is_reversed/lowest-path
    orientation; special handling when abs(delta) is below floating_point_tolerance; whether a
    'delta = abs(delta)' happens for EndType::Polygon; any special case for paths with <3 points.
 7. BuildNormals: normal formula and orientation convention, and how norms[] indices relate to
    edges/vertices; the j/k iteration order in OffsetPolygon (which k for which j, and the
    initial values).
 8. ExecuteInternal/Execute: exactly what happens after the raw paths are built - the fill rule and
    clip type of the cleanup Clipper64 pass, PreserveCollinear setting, ReverseSolution setting, and
    how CheckReverseOrientation decides.
 9. Any duplicate-point stripping (StripDuplicates) applied to the input paths, and whether it is
    'is_joined' aware.

You may cross-check your reading of the assembly by running gdb and inspecting registers/xmm at
those functions with concrete offsets (e.g. offset 1, 10, -1, -30). Do that for at least the
steps-per-radian computation and DoRound. Report observed xmm values.

Write the full report to ${'/workspace/recon/02-offset-module.md'} as annotated pseudocode
(C-like, explicit about doubles vs int64), then return a short summary.`,
  },
  {
    label: 'engine-disasm',
    out: '/workspace/recon/03-engine-module.md',
    prompt: `${COMMON}

YOUR TASK: from the disassembly ONLY, produce exact, implementable pseudocode for the boolean
clipping engine (clipper.engine.cpp) as compiled into this binary - enough to reimplement
Intersect(EvenOdd) and Union(Positive) on integer polygons bit-exactly.

Start from 'nm -SC /workspace/dataset/test7_executable | grep Clipper2Lib' and enumerate every
ClipperBase/Clipper64 method. Key ones (find/confirm addresses):
  ClipperBase::AddPaths 0x40a3ba, Clipper2Lib::AddPaths_ (the free function that builds
     Vertex lists + LocalMinima), ClipperBase::Reset, ClipperBase::ExecuteInternal 0x40ce42,
  InsertLocalMinimaIntoAEL, InsertLeftEdge, InsertRightEdge, SetWindCountForClosedPathEdge,
  SetWindCountForOpenPathEdge, IsContributingClosed, IsContributingOpen,
  ClipperBase::IntersectEdges 0x40c4dc, DoHorizontal, DoTopOfScanbeam, DoMaxima,
  ClipperBase::DoIntersections 0x40d898, BuildIntersectList 0x40db24,
  AddNewIntersectNode 0x40d8e0, ProcessIntersectList 0x40dd30, IntersectListSort 0x409225,
  Clipper2Lib::GetLineIntersectPt<long> 0x41401d, SegmentsIntersect 0x40ffd1,
  AddOutPt, AddLocalMinPoly, AddLocalMaxPoly, JoinOutrecPaths, StartOpenPath,
  ClipperBase::CleanCollinear 0x40bd2c, FixSelfIntersects 0x40c29e, DoSplitOp (if present),
  ConvertHorzSegsToJoins, ProcessHorzJoins, Clipper64::BuildPaths64 0x40f33c,
  BuildPath (free function), Clipper2Lib::Area(OutPt*) 0x409344, AreaTriangle 0x410e82,
  ClipperBase::DeepCheckOwner / CheckBounds / RecursiveCheckOwners (if present).

CRITICAL things to pin down EXACTLY, quoting instructions:
 1. Vertex/LocalMinima construction from an input path: duplicate-point removal, the flags
    (OpenStart/OpenEnd/LocalMax/LocalMin), how horizontal starts are handled, and the ORDER in
    which local minima end up in the list (this determines output path order later).
 2. The scanbeam / scanline loop: how Y values are collected and popped, and tie handling.
 3. Wind-count computation for FillRule::EvenOdd and FillRule::Positive, and IsContributing
    predicates for both.
 4. IntersectEdges: the full decision tree for closed-closed edge intersections, including the
    'both edges same polytype' cases and the wind-count updates.
 5. AddNewIntersectNode + GetLineIntersectPt: EXACT arithmetic used to compute an intersection
    point, including how the double result is rounded to int64, and any clamping of the point into
    the current scanbeam [top_y, bot_y]. This is the main source of coordinate values that are not
    present in the input, so exactness matters.
 6. IntersectListSort's comparison, and how ProcessIntersectList reorders / swaps AEL entries.
 7. Output construction: BuildPaths64 iteration order over OutRecs (which decides solution path
    ORDER - our program prints Area(solution[0]) so path order is load-bearing), the BuildPath
    function's collinear-point removal when preserve_collinear is false, minimum vertex count,
    the reverse_solution handling, and any area-based rejection of tiny/degenerate OutRecs.
 8. CleanCollinear and FixSelfIntersects: when they run and exactly what they change.
 9. Whether Positive fill-rule output orientation is normalised, and whether zero-area or
    self-intersecting outputs are dropped.

Cross-check with gdb where useful (e.g. break on GetLineIntersectPt and record inputs/outputs for
offset -30, -20, -1, 1, 10; break on BuildPaths64 and see how many OutRecs there are).

Write the full report to ${'/workspace/recon/03-engine-module.md'} as annotated, implementable
pseudocode, then return a short summary. Flag anything you could not determine.`,
  },
  {
    label: 'io-formatting',
    out: '/workspace/recon/04-io-formatting.md',
    prompt: `${COMMON}

YOUR TASK: nail down, to byte-exactness, two small but critical behaviours, and produce a Rust
implementation plan (plus test vectors) for each. Keep it std-only, no crates.

(A) 'std::cout << (double)area << std::endl' with a default-configured ostream.
    That is: defaultfloat, precision 6 (significant digits), no showpoint, no showpos.
    Determine and document the exact algorithm: it behaves like printf("%g", x) with precision 6,
    i.e. choose %e if exponent < -4 or exponent >= precision, else %f, and strip trailing zeros
    and a trailing '.' (because showpoint is off). Exponent is printed with at least 2 digits and
    an explicit sign, e.g. 3.46204e+06.
    Confirm empirically by compiling tiny C++ programs with g++ (available at
    /opt/compiler/gcc-12/bin/g++) that print a large table of doubles with std::cout, and comparing
    to what your proposed Rust algorithm would produce. IMPORTANT: the values our program prints are
    always signed areas of integer polygons, i.e. exact multiples of 0.5, and can be 0, negative, or
    up to ~1e13. Cover: 0, 0.5, 3, 18, 4753, 6577.5, 8514.5, 68653, 950027, 3462035.5, 3.16571e8,
    3.13363e12, 99999.5, 999999.5, 1000000, 1000000.5, 12345650000.0, and values that stress
    round-half-to-even in the 6th significant digit (e.g. 1234565, 1234575, 0.0001234565).
    Also document what 'std::cout << 0' (an int literal) prints - the else branch prints int 0.
    Deliverable: a self-contained Rust function 'fn fmt_double_cout(x: f64) -> String' (std only,
    NO format!("{:e}") reliance unless you prove it matches) that is byte-identical to the C++
    output for all those cases, plus the C++ test program and the observed table.
    You MUST actually compile and run both sides: write the Rust candidate to a scratch dir,
    compile with rustc (rustc 1.75, edition 2021), and diff against g++ output over a few thousand
    values including all multiples of 0.5 in [0, 5000], random large multiples of 0.5 up to 1e13,
    and 1e-5..1e-3 range. Report the diff result.

(B) 'std::stoi(std::string(argv[1]), nullptr, 10)' semantics, exactly as used here (base 10).
    Document: leading whitespace skipping, optional +/-, digit prefix parsing ('12abc' -> 12),
    empty/no-digits -> throws std::invalid_argument, out-of-int-range -> throws std::out_of_range,
    and note that values outside [INT_MIN, INT_MAX] throw even though strtol would succeed.
    Verify empirically against /workspace/dataset/test7_executable with args like: '  7', '+7',
    '-0', '0x10', '10.9', '1e3', '2147483647', '2147483648', '-2147483648', '-2147483649',
    '99999999999999999999', '007', 'INF', '', ' ', '--5', '5 ', 'tab-prefixed'.
    Record exit codes and stderr text. Note the C++ program on throw prints to stderr:
      terminate called after throwing an instance of 'std::invalid_argument'
        what():  stoi
    and aborts (exit 134 under bash). Decide and document what the Rust port should do to be
    "equivalent" (stdout must match; document the stderr/exit-code difference and pick the closest
    reasonable behaviour, e.g. eprint the same two lines and abort with SIGABRT via
    std::process::abort()).
    Deliverable: a Rust 'fn stoi(s: &str) -> i32' spec + code matching the above, and the observed
    behaviour table.

Write the full report (with both Rust functions inline) to ${'/workspace/recon/04-io-formatting.md'},
then return a short summary.`,
  },
];

const reports = await parallel(tasks.map(t => () =>
  agent(t.prompt, { label: t.label, phase: 'Recon' })
));

phase('Cross-check')

const check = await agent(`You are auditing four reverse-engineering reports about the binary
/workspace/dataset/test7_executable (an -O0, unstripped C++ program using Clipper2 2.0.1).
The reports are at:
  /workspace/recon/01-gdb-ground-truth.md
  /workspace/recon/02-offset-module.md
  /workspace/recon/03-engine-module.md
  /workspace/recon/04-io-formatting.md
(some may be missing if an agent failed - note that).

Read them. Your job is to find CONTRADICTIONS, UNSUPPORTED CLAIMS, and GAPS that would block a
bit-exact Rust reimplementation. Specifically:
 - Cross-validate report 02's offset algorithm against report 01's OFFSET_RAW ground truth: hand-
   simulate the documented algorithm for offsets 1, -1, 10, -10, -30 on the triangle
   [(50,0),(100,100),(0,100)] and check the predicted raw vertex list matches the dumped one
   EXACTLY. Use awk/perl or a tiny C/C++/Rust scratch program to do the arithmetic - do not
   hand-wave. Report any vertex that differs.
 - Check report 03's claims against report 01's OFFSET_OUT ground truth, especially path ordering
   and where the cleanup Union changes geometry.
 - Verify report 04's formatter really is byte-exact by re-running its diff yourself.
Anything a report asserts from memory of Clipper2 rather than from this binary must be flagged and,
where it matters, verified by you in the disassembly or with gdb.

Write your audit to /workspace/recon/05-audit.md and return a concise list of (a) confirmed facts
that the implementer can rely on, (b) corrections, (c) remaining unknowns with a suggested way to
resolve each.`, { label: 'audit', phase: 'Cross-check' });

return { reports: reports.map((r, i) => ({ label: tasks[i].label, ok: !!r, path: tasks[i].out })), audit: check }
