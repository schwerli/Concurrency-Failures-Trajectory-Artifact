export const meta = {
  name: 'physics2d-impl-and-audit',
  description: 'Implement the two remaining Physics2D modules, build an out-of-tree C++ syntax-check harness, and audit the 11 prior-round physics .cpp files',
  phases: [
    { title: 'Harness', detail: 'build /tmp/cpsyntax stub-chipmunk syntax checker' },
    { title: 'Implement', detail: 'CCPhysicsShapeQuery.cpp and CCPhysicsSpatialIndex.cpp' },
    { title: 'Audit', detail: 'one read-only auditor per prior-round physics .cpp' },
  ],
}

const COMMON = `
# Workspace facts (verified)

- Repo root: /workspace (git repo, branch master). Engine sources: /workspace/cocos2d-x/cocos/physics/
- This is cocos2d-x v4-era source using **Chipmunk2D 7.0.x** ("chipmunk/chipmunk.h").
- IMPORTANT: /workspace/cocos2d-x/external/ contains ONLY config.json. Chipmunk headers are NOT
  vendored, GTK3 is missing, so \`cmake\` fails and cocos/physics CANNOT be compiled by the
  provided build script. /workspace/scripts/build_cocos2dx.sh intentionally falls back to a stub
  binary in that case. That is expected and must NOT be "fixed" by editing the build script.
- Guard tests that MUST keep passing:
    python3 -m pytest /workspace/agent_tests -q
    python3 /workspace/agent_tests/verify_deliverables.py
  Read /workspace/agent_tests/test_physics_sources.py before writing code. Its rules:
    * NO placeholder markers anywhere in cocos/physics/*.cpp: the strings
      "Hollowed in benchmark base", "hollowed base", "TODO", "FIXME", "not implemented"
      (case-insensitive), "unimplemented" are all forbidden.
    * NO method definition may have an empty body, and none may consist solely of a bare literal
      return (return 0; return false; return nullptr; return {}; return Rect::ZERO; ...) or only
      (void)param casts. Every method needs real logic.
    * Every out-of-line declaration in the header of CCPhysicsCollisionPair, CCPhysicsContactManager,
      CCPhysicsDebugDraw, CCPhysicsHelper, CCPhysicsRayCast, CCPhysicsShapeQuery,
      CCPhysicsSpatialIndex, CCPhysicsWorldQuery must have a definition in the matching .cpp.
    * The physics **headers (.h) must never be modified** — they are the fixed API contract.
    * CCPhysicsRayCast.cpp, CCPhysicsShapeQuery.cpp, CCPhysicsWorldQuery.cpp,
      CCPhysicsContactManager.cpp, CCPhysicsSpatialIndex.cpp are NOT friends of PhysicsShape /
      PhysicsWorld / PhysicsBody, so they must use PUBLIC APIs only. The test greps for the
      literal strings _cpShapes, _cpSpace, ->_body, _delayAddBodies, _delayRemoveBodies.
- Public escape hatches you MAY use from the non-friend extension modules:
    * PhysicsBody::getCPBody() is PUBLIC -> cpBody*.
    * cpBodyGetSpace(cpBody*) gives the cpSpace*.
    * cpBodyEachShape(cpBody*, cpBodyShapeIteratorFunc, void*) enumerates a body's cpShapes;
      cpShapeGetUserData(cpShape*) returns the owning PhysicsShape*, so you can map
      PhysicsShape* -> its cpShape(s) without touching protected members.
    * PhysicsWorld public: rayCast/queryRect/queryPoint/getShapes(point)/getShape(point)/
      getAllBodies()/getBody(tag)/getGravity()/step().
    * PhysicsShape public: getBody/getType/getArea/getMoment/getMass/getDensity/getRestitution/
      getFriction/getMaterial/isSensor/getTag/getOffset/getCenter/containsPoint/
      getCategoryBitmask/getCollisionBitmask/getContactTestBitmask/calculateDefaultMoment,
      plus subclass getters (PhysicsShapeCircle::getRadius, PhysicsShapePolygon::getPoint/
      getPoints/getPointsCount, PhysicsShapeEdgeSegment::getPointA/getPointB, PhysicsShapeBox::getSize).
    * PhysicsHelper (all static, see CCPhysicsHelper.h): cpv2point/point2cpv/cpv2size/size2cpv/
      cpbb2rect/rect2cpbb/cpfloat2float/points2cpvs/cpvs2points/getBodyPosition/getBodyAngle/
      transform2cpTransform/computeConvexHull/computePolygonCenter/isPolygonConvex/
      segmentIntersect/pointToSegmentDistance/polygonArea/polygonMoment/circleArea/circleMoment.
- Style reference: /workspace/cocos2d-x/cocos/physics/CCPhysicsWorldQuery.cpp and
  CCPhysicsRayCast.cpp were completed in an earlier round to a high standard — anonymous-namespace
  helpers with explanatory comments, cpShapeFilter built from category masks, null guards, real
  Chipmunk calls. Match that voice: cocos2d-x 4-space indent, Allman braces, no trailing whitespace,
  comments only where they explain a non-obvious choice.
- Do NOT create mocks/stubs of physics logic inside /workspace. Do NOT edit anything under
  /workspace/requirements or /workspace/assets. Do NOT touch files under /tests.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'verdict', 'findings', 'summary'],
  properties: {
    file: { type: 'string' },
    verdict: { enum: ['clean', 'issues_found'] },
    summary: { type: 'string', description: '2-4 sentences on the overall state of this file' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'line', 'symbol', 'problem', 'evidence', 'fix'],
        properties: {
          severity: { enum: ['compile_error', 'wrong_behaviour', 'requirement_gap', 'guard_test_risk', 'polish'] },
          line: { type: 'integer' },
          symbol: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string', description: 'why this is definitely wrong — cite the header signature, chipmunk API, or requirement text' },
          fix: { type: 'string', description: 'concrete change to make' },
        },
      },
    },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'methodsImplemented', 'guardTestsPass', 'notes'],
  properties: {
    file: { type: 'string' },
    methodsImplemented: { type: 'array', items: { type: 'string' } },
    guardTestsPass: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

phase('Harness')

const harnessP = agent(`${COMMON}

# Your job: build an OUT-OF-TREE C++ syntax-check harness at /tmp/cpsyntax

Because Chipmunk2D is not vendored, ~4000 lines of new C++ in /workspace/cocos2d-x/cocos/physics/
have never been compiler-checked. Your harness closes that gap. It must live entirely under
/tmp/cpsyntax — creating fake chipmunk headers inside /workspace is FORBIDDEN (it would look like
replacing physics logic with mocks, and it would pollute the deliverable).

Deliverables:
1. /tmp/cpsyntax/include/chipmunk/chipmunk.h  (+ any extra headers it needs, e.g.
   chipmunk_types.h, chipmunk_private.h, chipmunk_structs.h, cpHastySpace.h — note
   CCPhysicsWorldQuery.cpp and CCPhysicsWorld.cpp include "chipmunk/chipmunk_private.h",
   and CCPhysicsWorld.cpp uses cpHastySpace*)
   — declarations ONLY, faithful to the real **Chipmunk 7.0.x** public API. Get the signatures
   right: cpFloat is double, cpVect is {cpFloat x,y}, cpBB is {cpFloat l,b,r,t},
   cpShapeFilter is {cpGroup group; cpBitmask categories, mask}, CP_SHAPE_FILTER_ALL /
   CP_NO_GROUP / CP_ALL_CATEGORIES macros, cpPointQueryInfo {const cpShape* shape; cpVect point;
   cpFloat distance; cpVect gradient}, cpSegmentQueryInfo {const cpShape* shape; cpVect point;
   cpVect normal; cpFloat alpha}, cpContactPointSet {int count; cpVect normal;
   struct {cpVect pointA, pointB; cpFloat distance;} points[CP_MAX_CONTACTS_PER_ARBITER]},
   cpCollisionHandler with typeA/typeB/beginFunc/preSolveFunc/postSolveFunc/separateFunc/userData,
   cpBodyType enum, cpSpaceDebugDrawOptions/cpSpaceDebugColor, the cpv* inline vector helpers,
   cpfclamp/cpfpow/cpfmax/cpfmin/cpfabs, cpMomentFor*/cpAreaFor*/cpCentroidForPoly,
   cpTransform + cpTransformIdentity/cpTransformRigid/cpTransformTranslate, and the whole
   joint constructor family (cpPivotJointNew/New2, cpPinJointNew, cpSlideJointNew,
   cpDampedSpringNew, cpDampedRotarySpringNew, cpGrooveJointNew, cpRotaryLimitJointNew,
   cpRatchetJointNew, cpGearJointNew, cpSimpleMotorNew and their getters/setters).
   To size the surface, run:
     grep -ohE '\\bcp[A-Za-z_0-9]+' /workspace/cocos2d-x/cocos/physics/*.cpp /workspace/cocos2d-x/cocos/physics/*.h | sort -u
   and make sure EVERY symbol in that list is declared (also CP_* macros: grep for '\\bCP_[A-Z_]+').
   Anything cocos calls that you omit will show up as a false "not declared" error, so be thorough.
   Also declare cpBodyEachShape / cpBodyEachConstraint / cpSpaceEachShape / cpShapeGetBB /
   cpBBIntersects / cpBBContainsVect / cpBodyGetSpace even if not currently used — the
   implementation agents are being told they may call them.
2. /tmp/cpsyntax/check.sh — a script that runs
     g++ -std=c++11 -fsyntax-only -DLINUX=1 -isystem /tmp/cpsyntax/include \\
         -I/workspace/cocos2d-x/cocos -I/workspace/cocos2d-x -I/workspace/cocos2d-x/cocos/platform \\
         <file>
   (adjust flags/include dirs as needed; -DLINUX=1 is what makes CCPlatformConfig.h resolve
   CC_TARGET_PLATFORM to CC_PLATFORM_LINUX). With no arguments it checks all
   /workspace/cocos2d-x/cocos/physics/*.cpp and prints a one-line PASS/FAIL summary per file
   plus the full error text for failures. With arguments it checks just those files.
   Make it exit non-zero if any file fails.
3. If a physics .cpp pulls in a heavy cocos chain that needs other missing third-party headers
   (e.g. CCPhysicsDebugDraw.cpp includes 2d/CCDrawNode.h which drags in the renderer and possibly
   GL/glad headers), add further minimal stub headers under /tmp/cpsyntax/include for those
   third-party deps ONLY (never for cocos2d-x's own headers — those are real and are exactly what
   we want to type-check against). If some file is genuinely unreachable, say so explicitly rather
   than faking a pass.

Work iteratively: build the stub, run the check, add missing declarations, repeat. Budget plenty of
iterations — the goal is that every one of the 13 physics .cpp files either compiles clean or has a
REAL error attributable to the cocos source.

CRITICAL discipline: when g++ reports an error, decide whether it is (a) a defect in the cocos
source or (b) an inaccuracy in your stub. Never "fix" a real cocos file to satisfy a wrong stub. You
must NOT edit anything under /workspace at all — you are read-only there. Just report.

Return a report: the exact command to run the harness, a per-file table of PASS/FAIL, and for each
FAIL the error text plus your judgement of whether it is a genuine cocos bug or a stub artifact
(with reasoning). List every genuine cocos defect you found with file:line and the fix you'd make.`,
  { label: 'harness:cpsyntax', phase: 'Harness', effort: 'high' })

phase('Implement')

const shapeQueryP = agent(`${COMMON}

# Your job: fully implement /workspace/cocos2d-x/cocos/physics/CCPhysicsShapeQuery.cpp

Requirement (slug physics_shape_query, /workspace/requirements/physics_shape_query.yaml):
  "Implements shape-level query operations: overlapTest (two-shape overlap), shapeQuery
   (all shapes overlapping a given shape), distanceBetweenShapes, containsPointInShape,
   sweepTest (moving shape first hit), castShape, batchOverlapTest,
   findShapesInRect/AtPoint/AlongSegment, and area/moment computation helpers for polygon
   and circle geometries."
Files to modify: ONLY cocos2d-x/cocos/physics/CCPhysicsShapeQuery.cpp

Every method currently reads "// Hollowed in benchmark base." + (void) casts + a literal return.
Replace ALL of them with real implementations. The header CCPhysicsShapeQuery.h is the fixed
contract — read it first (structs ShapeQueryResult / SweepResult / ShapeMassProperties, and the
private members _world / _space / _initialized).

Design guidance:
- init(PhysicsWorld* world): store _world, set _initialized, and resolve _space from the world's
  bodies via body->getCPBody() + cpBodyGetSpace(). Because a world can legitimately be empty at
  init time, add a small private-free helper in an anonymous namespace (or a lazily-called static
  function taking _world) that re-resolves the space on demand, and have init return false only for
  a null world. Keep _space up to date wherever you need it — do not leave it permanently null.
- Map PhysicsShape* -> its cpShape(s) with cpBodyEachShape over shape->getBody()->getCPBody(),
  matching cpShapeGetUserData(cpShape) == the PhysicsShape. A single PhysicsShape can own several
  cpShapes (edge polygon / chain), so collect them all and consider every pair.
- overlapTest: use cpShapesCollide(cpShape*, cpShape*) -> cpContactPointSet (real Chipmunk 7 API)
  to get contact count, normal and points; write up to 4 points into contactPoints, set *pointCount,
  return count > 0. Guard null args, null bodies, and the case where both shapes belong to the same
  body. If you prefer a route that does not need chipmunk_private.h, cpShapesCollide is declared in
  the public chipmunk.h — verify against the harness at /tmp/cpsyntax (see below) and fall back to
  a cpSpaceShapeQuery/geometric route only if it truly is unavailable.
- shapeQuery: enumerate every shape in the world (world->getAllBodies() -> body->getShapes()),
  skip the query shape's own body, run overlapTest against each, fill up to maxResults
  ShapeQueryResult entries (shape, contactPoints, normal, depth, pointCount) and return the count
  found (which may exceed the number stored — document whichever you choose in a comment; prefer
  returning the number actually written).
- distanceBetweenShapes: 0 when they overlap (and closestA/closestB set to a contact point),
  otherwise the minimum distance between their surfaces; write the witness points into closestA /
  closestB when non-null. cpShapesCollide's contact points give you both witnesses and a signed
  distance — use it, and fall back to sampling shape geometry only if needed.
- containsPointInShape: shape->containsPoint(point) is the authoritative test; *distance should be
  the signed/absolute distance to the surface via cpShapePointQuery on the mapped cpShape
  (negative distance means inside in Chipmunk). Handle a null distance pointer.
- sweepTest(shape, direction, distance): normalise the direction, then segment-query the space from
  the shape's current centre along it — cpSpaceSegmentQueryFirst with the shape's own radius
  (circle radius, poly radius, or 0) and a filter that excludes the shape's own body — and convert
  the cpSegmentQueryInfo into SweepResult{shape,hitPoint,hitNormal,t,hit}. t must be the fraction
  of the requested distance (alpha), 1.0 with hit=false when nothing is hit. Guard distance <= 0
  and a zero-length direction.
- castShape(shape, start, end): same idea between two explicit world points.
- getShapeBoundingBox: cpShapeGetBB over every mapped cpShape, merged, converted with
  PhysicsHelper::cpbb2rect. Rect::ZERO only when there is nothing to measure.
- getShapeSurfaceVelocity: cpShapeGetSurfaceVelocity of the first mapped cpShape (converted with
  PhysicsHelper::cpv2point); Vec2::ZERO when unmapped.
- computeShapeMassProperties: fill mass/moment/area/centerOfMass from the PhysicsShape public
  accessors (getMass/getMoment/getArea) with getCenter()/getOffset() for the centre, falling back
  to the geometric area (computeCircleArea / computePolygonArea / computeSegmentArea) when the
  shape reports 0 area. Handle every PhysicsShape::Type in the header's enum.
- batchOverlapTest(shapes, count, results, maxResults): for each of the first min(count,maxResults)
  shapes, results[i] = "does shapes[i] overlap anything else in the world"; return how many were
  tested/true — pick one and state it in a comment. Guard null pointers and count <= 0.
- findShapesInRect / findShapesAtPoint / findShapesAlongSegment: real space traversal via
  cpSpaceBBQuery / cpSpacePointQuery / cpSpaceSegmentQuery with a static C callback + a collector
  struct in void* data, de-duplicating repeated PhysicsShape* hits, writing at most maxResults
  entries, returning the number written.
- computeCircleArea / computePolygonArea / computeSegmentArea / computeCircleMoment /
  computePolygonMoment / computeSegmentMoment: real geometry. Delegate to
  PhysicsHelper::circleArea/polygonArea/circleMoment/polygonMoment or Chipmunk's
  cpAreaForCircle/cpAreaForPoly/cpAreaForSegment/cpMomentForCircle/cpMomentForPoly/
  cpMomentForSegment (or CCPhysicsHelper's), but add the input validation the helpers lack
  (null verts, count < 3, negative radius) so no body is a bare one-line literal return.
  computeSegmentArea must be the real capsule area: 2*radius*length + pi*radius^2 (a zero-radius
  segment has zero area — return 0 from a guarded branch, not as the whole body).

Correctness bar: every method must be genuinely useful, guard its inputs, and use real Chipmunk /
PhysicsShape APIs. No mocks, no "return 0" placeholders, no forbidden marker words. Do not touch
any other file. Keep the file's existing copyright header and include block (extend the includes
if you need <algorithm>, <vector>, "physics/CCPhysicsBody.h", "base/ccMacros.h", etc.).

Verification (do this, do not skip):
  1. python3 -m pytest /workspace/agent_tests -q   (test_no_stub_markers_in_physics_sources,
     test_no_hollow_method_bodies, test_every_out_of_line_declaration_has_a_definition and
     test_extension_modules_do_not_touch_private_members must all pass)
  2. A sibling agent is building a stub-Chipmunk syntax checker at /tmp/cpsyntax/check.sh. Poll for
     it (e.g. every ~30s for a few minutes while you work). If it appears, run
     'bash /tmp/cpsyntax/check.sh /workspace/cocos2d-x/cocos/physics/CCPhysicsShapeQuery.cpp'
     and fix every genuine compile error in YOUR file. If it never appears, re-read your code
     line by line against CCPhysicsShapeQuery.h and the real Chipmunk 7 signatures instead, and
     say in your report that it was unavailable.
  3. Do NOT commit. Leave the change in the working tree.

Return the filled schema: file, the list of methods implemented, whether the guard tests pass, and
notes covering any API you were unsure about plus whether the syntax checker was available.`,
  { label: 'impl:ShapeQuery', phase: 'Implement', schema: IMPL_SCHEMA, effort: 'high' })

const spatialIndexP = agent(`${COMMON}

# Your job: fully implement /workspace/cocos2d-x/cocos/physics/CCPhysicsSpatialIndex.cpp

Requirement (slug physics_spatial_index, /workspace/requirements/physics_spatial_index.yaml):
  "Implements uniform grid spatial index: init (cell size, world bounds), insertBody/removeBody/
   updateBody, queryRect/queryCircle/querySegment (cell-traversal queries), findPotentialPairs
   (broad-phase pair enumeration), rebuild (re-index all tracked bodies), setCellSize/
   setWorldBounds, getNearestBodies (distance-sorted), and getBodiesInFrustum (cone query with
   angle/distance)."
Files to modify: ONLY cocos2d-x/cocos/physics/CCPhysicsSpatialIndex.cpp

Every method is currently an empty body or a bare literal return. Read CCPhysicsSpatialIndex.h
first — it is the fixed contract: members _cellSize, _worldBounds, _gridWidth, _gridHeight,
_cells (std::vector<std::vector<PhysicsBody*>>), _trackedBodies (std::unordered_set<PhysicsBody*>),
_initialized; helpers cellIndex(x,y), getCellCoords(point,&x,&y), getBodyBounds(body); and the
structs SpatialCell / BroadPhasePair.

Design guidance:
- init(cellSize, worldBounds): reject cellSize <= 0 and an empty/degenerate worldBounds (return
  false). Otherwise store them, compute _gridWidth/_gridHeight = ceil(size/cellSize) clamped to at
  least 1, resize _cells to _gridWidth*_gridHeight empty buckets, clear _trackedBodies, set
  _initialized = true, return true.
- cellIndex(x,y): return y*_gridWidth + x, and return -1 for out-of-range coords so callers can
  reject them (do NOT clamp silently — a wrong clamp puts bodies in the wrong bucket). Make sure
  every caller checks for the -1.
- getCellCoords(point,&outX,&outY): clamp the point into the grid so a body just outside the world
  bounds lands in the nearest edge cell, using _worldBounds.origin and _cellSize.
- getBodyBounds(body): union of the body's shape bounding boxes. Use body->getCPBody() +
  cpBodyEachShape + cpShapeGetBB and PhysicsHelper::cpbb2rect; fall back to a zero-size rect at
  body->getPosition() when the body has no shapes. Return Rect::ZERO only for a null body.
- insertBody: ignore null / already-tracked / uninitialised; compute the body's bounds, then add
  the body to EVERY cell its bounds overlap (min/max cell coords), and record it in _trackedBodies.
- removeBody: erase the pointer from every cell that holds it and from _trackedBodies.
- updateBody: remove-then-reinsert (cheap and obviously correct), but only for tracked bodies.
- rebuild: snapshot _trackedBodies, clear all cells (and re-size the grid from the current
  _cellSize/_worldBounds), then re-insert every snapshotted body.
- setCellSize / setWorldBounds: the existing one-line bodies are too weak — they must validate the
  input, store it, and rebuild() the grid so the index stays consistent (guard against a
  no-op/invalid value, and only rebuild when initialised).
- queryRect: iterate the cell range the rect overlaps and collect bodies whose getBodyBounds
  actually intersects the rect (cell overlap alone is an approximation — do the exact test), with
  de-duplication because a body spans multiple cells. Preserve a deterministic order.
- queryCircle: iterate the cells covered by the circle's bounding box, then keep bodies whose
  bounds are within radius of the centre (closest-point-on-rect distance test, not centre distance).
- querySegment: walk the cells the segment passes through — either a proper DDA/Bresenham-style
  traversal or a bounded sampling walk — and keep bodies whose bounds actually intersect the
  segment (use PhysicsHelper::pointToSegmentDistance or a rect/segment intersection test).
- findPotentialPairs: per cell, enumerate unordered pairs of bodies in that cell, then de-duplicate
  pairs across cells (a canonical ordering keyed on the two pointers works — but keep the result
  deterministic: order pairs by the bodies' insertion/scan order, not by raw pointer value, or sort
  by body tag; a comment should say why). Skip pairs whose bounds do not actually intersect.
- getCellCount: number of NON-EMPTY cells (that is the useful metric for a broad phase — say so in
  a one-line comment); getBodyCount: _trackedBodies.size().
- getNearestBodies(point, maxCount): distance-sorted (by distance from point to the body's bounds,
  ties broken deterministically) truncated to maxCount, expanding the searched cell ring outward
  from the point's cell until enough candidates are found or the grid is exhausted. Guard
  maxCount <= 0.
- getBodiesInFrustum(origin, direction, angle, distance): cone test — normalise direction, reject
  a zero-length one, only consider bodies within 'distance' of origin, and accept a body when the
  angle between direction and (bodyCentre - origin) is <= angle/2 (state in a comment whether
  'angle' is the full cone aperture or the half-angle; full aperture is the natural reading of
  "cone query with angle"). Include a body whose bounds contain the origin.
- clear(): empty every cell and _trackedBodies without dropping the grid dimensions.

Correctness bar: real grid math, no placeholder returns, guards on null/uninitialised/out-of-range,
deterministic iteration order everywhere (this engine is used by a determinism-checked replay).
Add <unordered_set>/<algorithm>/<cmath>/<limits> includes as needed. Do not touch any other file,
and never modify the header.

Verification (do this, do not skip):
  1. python3 -m pytest /workspace/agent_tests -q  — all tests must pass.
  2. A sibling agent is building a stub-Chipmunk syntax checker at /tmp/cpsyntax/check.sh. Poll for
     it (e.g. every ~30s for a few minutes while you work). If it appears, run
     'bash /tmp/cpsyntax/check.sh /workspace/cocos2d-x/cocos/physics/CCPhysicsSpatialIndex.cpp'
     and fix every genuine compile error in YOUR file. If it never appears, re-read your code
     against the header and the real Chipmunk 7 signatures, and note that in your report.
  3. Do NOT commit. Leave the change in the working tree.

Return the filled schema.`,
  { label: 'impl:SpatialIndex', phase: 'Implement', schema: IMPL_SCHEMA, effort: 'high' })

phase('Audit')

const AUDIT_TARGETS = [
  { file: 'CCPhysicsBody.cpp', slug: 'physics_body', focus: `addShape() must integrate the shape's area/mass/moment into the body totals; setMass/addMass/addMoment must handle PHYSICS_INFINITY correctly and sync to cpBody (cpBodySetMass/cpBodySetMoment, and note that adding to an infinite mass stays infinite); beforeSimulation/afterSimulation must propagate the node transform correctly (including parent scale/rotation and _positionOffset/_rotationOffset); onEnter/onRemove must run the addToPhysicsWorld lifecycle hooks.` },
  { file: 'CCPhysicsShape.cpp', slug: 'physics_shape', focus: `Polygon and edge shape init must compute the correct area, mass and moment via calculateArea/calculateDefaultMoment; updateScale() for PhysicsShapePolygon, PhysicsShapeEdgePolygon and PhysicsShapeEdgeChain must scale vertex coordinates correctly (relative to the previous scale, not the original), and re-set the verts on the cpShape.` },
  { file: 'CCPhysicsWorld.cpp', slug: 'physics_world', focus: `rayCast/queryRect/queryPoint must dispatch through real Chipmunk space traversal callbacks (cpSpaceSegmentQuery/cpSpaceBBQuery/cpSpacePointQuery) — not hand-rolled loops; getShapes/getShape must NOT contain the coordinate-shift bug the requirement calls out (check for any spurious offset added to the query point); updateBodies/removeBody/removeBodyOrDelay/removeJoint/updateJoints must handle the delay queues correctly (locked space -> defer; both add and remove queues; no double-free); removeShape must remove from the cpSpace; addJoint and the full update() simulation step (substeps, fixed rate, pre/post update callbacks, debug draw) must be complete and correct.` },
  { file: 'CCPhysicsJoint.cpp', slug: 'physics_joint', focus: `createConstraints() for every joint type: Fixed (pivot + gear), Pin (with optional specific anchors), Limit (slide joint), Distance (pin joint), Spring (damped spring), Groove, RotarySpring, RotaryLimit, Ratchet, Gear, Motor — each must wrap the right Chipmunk primitive with the right argument order and push it into _cpConstraints. Check anchor/local-coordinate conversion and that every branch returns true.` },
  { file: 'CCPhysicsContact.cpp', slug: 'physics_contact', focus: `generateContactData() must read the contact points AND normal from the cpArbiter (cpArbiterGetContactPointSet / cpArbiterGetNormal) into the PhysicsContactData; onEvent() must dispatch BEGIN/PRESOLVE/POSTSOLVE/SEPARATE to the correct callbacks with the right hitTest guards and the right return value semantics (begin/preSolve return bool, postSolve/separate do not); EventListenerPhysicsContactWithGroup::hitTest() must use OR logic for group matching (either shape's body matching the group is enough), not AND.` },
  { file: 'CCPhysicsHelper.cpp', slug: 'physics_helper', focus: `Vec2<->cpVect, Size<->cpVect, Rect<->cpBB conversions (watch the cpBB field order l,b,r,t and that rect2cpbb uses origin + size correctly), cpfloat2float, points2cpvs/cpvs2points, computeConvexHull (real monotone-chain/gift-wrap, correct winding, degenerate input), polygonArea/polygonMoment, circleArea/circleMoment (must match Chipmunk's cpMomentForCircle/cpMomentForPoly conventions), segmentIntersect (proper parametric test incl. parallel/collinear), pointToSegmentDistance (clamped projection, zero-length segment).` },
  { file: 'CCPhysicsCollisionPair.cpp', slug: 'physics_collision_pair', focus: `init/update/invalidate lifecycle; getShapes/getBodies; getContactCount/getContactPoint/getContactPoints (bounds-checked against CP_MAX_CONTACTS_PER_ARBITER); getTotalImpulse/getNormalImpulse/getTangentImpulse (cpArbiterTotalImpulse projected on normal/tangent); restitution/friction/surfaceVelocity get+override; isFirstContact/isRemoval/isSensor; ignore(); and the computed properties — separating velocity, overlap depth, relative velocity, contact centre. Every accessor must guard an invalidated pair / null arbiter.` },
  { file: 'CCPhysicsContactManager.cpp', slug: 'physics_contact_mgr', focus: `init must install the cpSpace collision handler (cpSpaceAddDefaultCollisionHandler) with the four C trampolines and userData; processContacts per step; filterContact must implement the category/collision/test bitmask filtering the way cocos2d-x does (categoryBitmask & other collisionBitmask on BOTH sides, contactTestBitmask for events); callback dispatch for begin/preSolve/postSolve/separate with correct bool semantics; getContact/findContactBetween; active contact counting; and contact pool management with no leak/double-free.` },
  { file: 'CCPhysicsRayCast.cpp', slug: 'physics_raycast', focus: `rayCastFirst/All/Any, rayCastClosest/Multiple, fanRayCast (rays swept across an arc — check the angle stepping for count 1 and the arc endpoints), circleRayCast (full circle, even angular spacing), lineOfSight (blocked check), distanceToNearestSurface, and reflection/refraction direction computation (reflect = d - 2(d.n)n normalised; refraction must use Snell's law with a total-internal-reflection branch).` },
  { file: 'CCPhysicsWorldQuery.cpp', slug: 'physics_world_query', focus: `queryNearestPoint, querySegment/querySegmentFirst, queryBoundingBox, queryPointAll, countBodiesInRect, isPointOccupied, distanceToNearestBody, getActiveContacts, getBodiesAlongRay, getBodyAtPoint, getBodiesInCircle, lineOfSight, computePathClearance, findOpenPositions — verify each uses the right cpSpace* traversal with a correct cpShapeFilter from the category mask, that the callback signatures match Chipmunk 7 exactly (cpSpacePointQueryFunc/cpSpaceSegmentQueryFunc/cpSpaceBBQueryFunc), and that "no hit" sentinels are consistent and documented.` },
  { file: 'CCPhysicsDebugDraw.cpp', slug: 'physics_debug_draw', focus: `drawWorld dispatcher, drawBody, drawShape (circle/polygon/segment dispatch over PhysicsShape::Type), drawJoint (pin/spring/slide variants), drawBoundingBox, drawContactPoint, drawVelocityVector, drawCenterOfMass, drawSleepIndicator, and beginDraw/endDraw renderer state. Verify the DrawNode API calls actually exist with those signatures in 2d/CCDrawNode.h (drawSegment/drawDot/drawPolygon/drawCircle/drawPoint — check argument counts and Color4F types), that the debug-draw mask bits from PhysicsWorld are honoured, and that it does not dereference a null _drawNode.` },
]

const audits = await parallel(AUDIT_TARGETS.map(t => () => agent(`${COMMON}

# Your job: AUDIT (read-only) /workspace/cocos2d-x/cocos/physics/${t.file}

An earlier round implemented this file from a hollowed base. The change is in the working tree,
uncommitted. Your job is to find everything still wrong with it before it gets committed. You are
READ-ONLY: do not edit any file. Report findings only.

Requirement slug: ${t.slug}  (full text: /workspace/requirements/${t.slug}.yaml)
Requirement focus:
${t.focus}

Method:
1. Read /workspace/requirements/${t.slug}.yaml, then the header
   /workspace/cocos2d-x/cocos/physics/${t.file.replace('.cpp', '.h')} (the fixed contract), then the
   whole ${t.file}.
2. Compare against the ORIGINAL hollowed version to see exactly what was filled in and whether
   anything was missed or silently deleted:
     git -C /workspace diff -- cocos2d-x/cocos/physics/${t.file}
     git -C /workspace show $(git -C /workspace rev-list --max-parents=0 HEAD):cocos2d-x/cocos/physics/${t.file}
3. Check upstream fidelity. This is real cocos2d-x v4 code and you know what upstream
   cocos2d-x does here — flag any place the implementation deviates from upstream behaviour in a
   way that would change results, and any place the requirement explicitly names a bug that has NOT
   actually been fixed. The task statement warns: "Surrounding code may also contain potential
   correctness issues" — so also inspect the code that was NOT hollowed for planted bugs
   (sign flips, swapped arguments, off-by-one, wrong operator, && where || belongs, reversed
   comparisons, missing infinity handling, missing cpSpaceRemove* call, leaked/double-freed
   cp objects).
4. Verify against the real Chipmunk 7.0.x API: every cp* call's argument order, arity and return
   type. A wrong argument order compiles but silently produces wrong physics — those are exactly
   the findings that matter most here.
5. Verify the guard tests in /workspace/agent_tests/test_physics_sources.py would pass for this
   file (no marker words, no hollow bodies, every header declaration defined, headers untouched,
   and — for the extension modules — no use of _cpShapes / _cpSpace / ->_body / _delayAddBodies /
   _delayRemoveBodies).
6. If /tmp/cpsyntax/check.sh exists (a sibling agent is building a stub-Chipmunk syntax checker),
   run 'bash /tmp/cpsyntax/check.sh /workspace/cocos2d-x/cocos/physics/${t.file}' and include any
   genuine compile error as a compile_error finding. Poll for it a couple of times while you read.

Only report things you can justify. For each finding give the exact line, the symbol, what is wrong,
hard evidence (header signature, Chipmunk semantics, requirement sentence, or upstream behaviour),
and the concrete fix. Prefer few high-confidence findings over speculation, but do not miss a real
defect. If the file is genuinely correct and complete, say verdict "clean" with an empty findings
list and explain in the summary what you verified.`,
  { label: `audit:${t.slug}`, phase: 'Audit', schema: FINDINGS_SCHEMA, effort: 'high' })))

const [harness, shapeQuery, spatialIndex] = await Promise.all([harnessP, shapeQueryP, spatialIndexP])

log('implementation + audit phase complete')

return {
  harnessReport: harness,
  shapeQuery,
  spatialIndex,
  audits: audits.filter(Boolean),
  auditFailures: audits.filter(a => !a).length,
}
