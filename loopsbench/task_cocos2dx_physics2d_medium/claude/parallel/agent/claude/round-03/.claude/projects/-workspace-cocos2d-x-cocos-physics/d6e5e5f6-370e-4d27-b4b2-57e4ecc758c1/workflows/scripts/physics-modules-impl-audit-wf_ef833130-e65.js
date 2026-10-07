export const meta = {
  name: 'physics-modules-impl-audit',
  description: 'Implement 5 hollow Physics2D modules and adversarially audit all 13 physics modules',
  phases: [
    { title: 'Implement', detail: 'one agent per hollow module (ContactManager, RayCast, ShapeQuery, SpatialIndex, WorldQuery)' },
    { title: 'Audit', detail: 'three lenses per module: compile/API, correctness, requirement-completeness' },
    { title: 'Fix', detail: 'apply confirmed findings per module' },
  ],
}

const SHARED = `
# Environment facts (read these carefully — they change what code is legal)

Repo: /workspace. Engine sources: /workspace/cocos2d-x/cocos/physics/.
Requirements: /workspace/requirements/<slug>.yaml (the "## Module:" section is the spec).

CRITICAL: Chipmunk2D headers are NOT present in this workspace (cocos2d-x/external/ was never
populated), so NOTHING in cocos/physics can be compiled or run here. You therefore cannot rely on
a compiler to catch mistakes. Every chipmunk symbol you write must be one you are certain exists in
Chipmunk2D 7.x, or one already used by a sibling file in cocos/physics. Do NOT invent API names.
Do NOT attempt to build (scripts/build_cocos2dx.sh always falls back). Do NOT run git.

## Chipmunk 7 API you may rely on (all verified public API)
- space queries: cpSpacePointQuery(space, point, maxDist, filter, func, data) with
  func(cpShape*, cpVect point, cpFloat distance, cpVect gradient, void* data);
  cpSpacePointQueryNearest(space, point, maxDist, filter, cpPointQueryInfo* out) -> cpShape*;
  cpSpaceSegmentQuery(space, start, end, radius, filter, func, data) with
  func(cpShape*, cpVect point, cpVect normal, cpFloat alpha, void* data);
  cpSpaceSegmentQueryFirst(space, start, end, radius, filter, cpSegmentQueryInfo* out) -> cpShape*;
  cpSpaceBBQuery(space, cpBB, filter, func, data) with func(cpShape*, void* data);
  cpSpaceShapeQuery(space, cpShape*, func, data) -> cpBool with
  func(cpShape*, cpContactPointSet* points, void* data);
  cpSpaceEachBody(space, func, data) with func(cpBody*, void* data);
  cpSpaceEachShape(space, func, data) with func(cpShape*, void* data);
  cpSpaceIsLocked(space); cpSpaceGetStaticBody(space).
- shapes: cpShapeGetBB, cpShapeGetBody, cpShapeGetSpace, cpShapeGetSensor, cpShapeGetFilter,
  cpShapeSetFilter, cpShapeGetSurfaceVelocity, cpShapeGetElasticity, cpShapeGetFriction,
  cpShapeGetUserData / cpShapeSetUserData, cpShapePointQuery(shape, p, cpPointQueryInfo* out) -> cpFloat
  (negative distance means inside), cpShapeSegmentQuery(shape, a, b, radius, cpSegmentQueryInfo*) -> cpBool,
  cpShapesCollide(a, b) -> cpContactPointSet, cpShapeUpdate(shape, cpTransform),
  cpShapeCacheBB(shape), cpPolyShapeGetCount / cpPolyShapeGetVert / cpPolyShapeGetRadius,
  cpCircleShapeGetOffset / cpCircleShapeGetRadius, cpSegmentShapeGetA / cpSegmentShapeGetB /
  cpSegmentShapeGetRadius, cpShapeGetType is NOT public (use PhysicsShape::getType() instead).
- filters: cpShapeFilter{ cpGroup group; cpBitmask categories; cpBitmask mask; },
  cpShapeFilterNew(group, categories, mask), CP_SHAPE_FILTER_ALL, CP_SHAPE_FILTER_NONE.
- bodies: cpBodyGetPosition/SetPosition, cpBodyGetAngle/SetAngle, cpBodyGetVelocity,
  cpBodyGetAngularVelocity, cpBodyGetMass/SetMass, cpBodyGetMoment/SetMoment, cpBodyGetSpace,
  cpBodyGetType, cpBodyIsSleeping, cpBodyLocalToWorld, cpBodyWorldToLocal,
  cpBodyGetVelocityAtWorldPoint, cpBodyEachShape(body, func, data) with func(cpBody*, cpShape*, void*),
  cpBodyEachArbiter(body, func, data) with func(cpBody*, cpArbiter*, void*),
  cpBodyEachConstraint. cocos also ships cpCompat62.h aliases (cpBodyGetPos, cpBodyGetVel, ...).
- arbiters: cpArbiterGetCount, cpArbiterGetNormal, cpArbiterGetPointA(arb,i),
  cpArbiterGetPointB(arb,i), cpArbiterGetDepth(arb,i), cpArbiterGetContactPointSet(arb),
  cpArbiterTotalImpulse, cpArbiterTotalKE, cpArbiterIgnore, cpArbiterIsFirstContact,
  cpArbiterIsRemoval, cpArbiterGetShapes(arb,&a,&b), cpArbiterGetBodies(arb,&a,&b),
  cpArbiterGetRestitution/SetRestitution, cpArbiterGetFriction/SetFriction,
  cpArbiterGetSurfaceVelocity/SetSurfaceVelocity, cpArbiterGetUserData/SetUserData,
  CP_ARBITER_GET_SHAPES(arb,a,b) and CP_ARBITER_GET_BODIES(arb,a,b) macros.
  cpContactPointSet = { int count; cpVect normal; struct { cpVect pointA, pointB; cpFloat distance; }
  points[CP_MAX_CONTACTS_PER_ARBITER]; } and CP_MAX_CONTACTS_PER_ARBITER == 2.
  cpPointQueryInfo = { const cpShape* shape; cpVect point; cpFloat distance; cpVect gradient; }.
  cpSegmentQueryInfo = { const cpShape* shape; cpVect point; cpVect normal; cpFloat alpha; }.
  NOTE both info structs hold a *const* cpShape*, so a const_cast<cpShape*> is required when you
  need a mutable cpShape* out of them (sibling code in CCPhysicsWorld.cpp does the same).
- collision handlers: cpSpaceAddDefaultCollisionHandler(space) -> cpCollisionHandler* with fields
  typeA, typeB, beginFunc, preSolveFunc, postSolveFunc, separateFunc, userData.
  Signatures: cpBool begin(cpArbiter*, cpSpace*, cpDataPointer); cpBool preSolve(...);
  void postSolve(cpArbiter*, cpSpace*, cpDataPointer); void separate(cpArbiter*, cpSpace*, cpDataPointer).
- math: cpv, cpvzero, cpvadd, cpvsub, cpvmult, cpvneg, cpvdot, cpvcross, cpvlength, cpvlengthsq,
  cpvnormalize, cpvdist, cpvdistsq, cpvperp, cpvrotate, cpvforangle, cpvtoangle, cpvlerp, cpvclamp,
  cpBBNew, cpBBNewForExtents, cpBBIntersects, cpBBContainsVect, cpBBContainsBB, cpBBMerge,
  cpBBExpand, cpBBCenter, cpBBArea, cpBBSegmentQuery, cpBBClampVect,
  cpMomentForCircle, cpMomentForSegment, cpMomentForPoly, cpMomentForBox,
  cpAreaForCircle, cpAreaForSegment, cpAreaForPoly, cpTransformIdentity, cpTransformRigid,
  CP_INFINITY, cpfabs, cpfmin, cpfmax, cpfsqrt, cpfclamp.

## cocos2d-x access rules that constrain the new modules
PhysicsShape::_cpShapes is PROTECTED and only befriends PhysicsWorld, PhysicsBody, PhysicsJoint and
PhysicsDebugDraw. PhysicsWorld::_cpSpace is PROTECTED and befriends Node, Sprite, Scene, Director,
PhysicsBody, PhysicsShape, PhysicsJoint, PhysicsWorldCallback and PhysicsDebugDraw.
So PhysicsRayCast / PhysicsShapeQuery / PhysicsWorldQuery / PhysicsContactManager /
PhysicsSpatialIndex CANNOT touch those members, and you must NOT edit any .h file to add friends.
Use public API instead:
- cpSpace* from a world: iterate world->getAllBodies() (public, returns const Vector<PhysicsBody*>&)
  and take cpBodyGetSpace(body->getCPBody()) from the first body that has one; also try
  cpBodyGetSpace of a static body. Keep a small private-ish static helper in the .cpp
  (file-local function in an anonymous namespace) and re-resolve lazily so a world that was empty at
  init() time still works later.
- cpShape* list of a PhysicsShape: cpBodyEachShape(shape->getBody()->getCPBody(), collector, &ctx)
  and keep the cpShape whose cpShapeGetUserData(cpShape) == that PhysicsShape.
- PhysicsShape* from cpShape*: static_cast<PhysicsShape*>(cpShapeGetUserData(cpShape)).
- Public accessors you may use: PhysicsBody::getCPBody/getPosition/getRotation/getShapes/
  getFirstShape/getShape(tag)/getTag/getVelocity/getAngularVelocity/isDynamic/isResting/
  getCategoryBitmask/getCollisionBitmask/getContactTestBitmask/getGroup/getNode/local2World/
  world2Local/getMass/getMoment; PhysicsShape::getBody/getType/getArea/getMoment/getMass/
  getDensity/getRestitution/getFriction/getMaterial/isSensor/getTag/containsPoint/getOffset/
  getCenter/getCategoryBitmask/getCollisionBitmask/getContactTestBitmask/getGroup;
  PhysicsWorld::getAllBodies/getBody(tag)/getShapes(point)/getShape(point)/getGravity/
  getSpeed/getUpdateRate/rayCast/queryRect/queryPoint; PhysicsHelper::* (all static).

## Hard rules for the file you touch
1. Modify ONLY the single .cpp named in your task. Never edit a .h, never edit another module,
   never edit files under /workspace/tests or /workspace/output, never run git.
2. NO placeholder text anywhere in the file. An automated sweep greps every .cpp for these regexes
   and fails the task if any matches: /Hollowed in benchmark base/, /hollowed base/, /\\bTODO\\b/,
   /not implemented/i. Also avoid "FIXME", "stub", "for now", "placeholder", "unimplemented".
   Write real code and normal descriptive comments instead.
3. No function may keep a hollow body: every method must do the work its name and the requirement
   describe. Returning a default value is only acceptable as a genuine guard (e.g. not initialised,
   null argument, index out of range) and must be preceded by an explicit check.
4. Guard every pointer argument, bounds-check every count/maxResults/maxHits/index, never write
   past a fixed-size array (ShapeQueryResult::contactPoints[4], ContactInfo::contactPoints[4] and
   ::depths[4] hold at most 4 entries while chipmunk yields at most CP_MAX_CONTACTS_PER_ARBITER==2),
   and initialise every field of every returned struct on every path.
5. const-correctness must match the header exactly: a method declared const must not mutate members
   (use a file-local helper or mutable-free logic instead), and signatures/default arguments must
   match the declaration character for character (default args live in the header only).
6. Style: cocos2d-x conventions — 4-space indent, opening brace on its own line, NS_CC_BEGIN/NS_CC_END,
   CCASSERT/CCLOG for diagnostics, float (not double) for stored values, PhysicsHelper for
   Vec2<->cpVect / Rect<->cpBB conversions, "physics/CCXxx.h" include style. Keep the existing
   license header, include block (extend it if you need more), constructor/destructor.
7. Determinism matters: iterate containers in a stable order, never depend on pointer values for
   ordering (when you sort, sort by a real key such as distance, then break ties by a stable
   secondary key like insertion index).
`

const HOLLOW = [
  {
    slug: 'physics_contact_mgr',
    file: 'CCPhysicsContactManager.cpp',
    header: 'CCPhysicsContactManager.h',
    focus: `Contact lifecycle pipeline. init(world, maxContacts) must resolve the cpSpace via the
world's bodies, install a default collision handler on it (cpSpaceAddDefaultCollisionHandler) whose
userData is this manager and whose begin/preSolve/postSolve/separate functions build a ContactInfo
from the arbiter and route it through filterContact + the dispatch* methods, reserve _contacts up to
_maxContacts, and set _initialized. processContacts(space) must walk the live arbiters of that space
once per step (cpSpaceEachBody + cpBodyEachArbiter, de-duplicating each arbiter so a pair shared by
two bodies is only recorded once) and rebuild _contacts with fresh contact points, normal, depths,
pointCount, totalImpulse and isNew/isPersistent flags, honouring _maxContacts and filterContact.
filterContact must implement cocos-style bitmask filtering: reject when either shape is null, when
both shapes belong to the same body, when (categoryBitmask(A) & collisionBitmask(B)) == 0 or
(categoryBitmask(B) & collisionBitmask(A)) == 0, apply the group rule (equal non-zero groups: >0
always pass, <0 never pass), then let the custom ContactFilterFunc veto. The contactTest bitmask
pair check ((categoryA & contactTestB) | (categoryB & contactTestA)) decides whether the pair is
reported as an event, not whether it collides — model that explicitly. getContact must bounds-check,
findContactBetween must match a pair in either order by body, getActiveContactCount must count the
contacts with pointCount > 0, isContactActive must match a shape pair in either order,
getContactNormal/getContactDepth/getTotalImpulse must bounds-check (depth = max depth over the
recorded points), setMaxContacts must clamp to >= 0 and shrink _contacts when lowered, clear() must
drop contacts (keeping registered callbacks), and each dispatch* must invoke every registered
callback in registration order.`,
  },
  {
    slug: 'physics_raycast',
    file: 'CCPhysicsRayCast.cpp',
    header: 'CCPhysicsRayCast.h',
    focus: `Advanced raycasting on top of cpSpaceSegmentQuery*. init(world) stores the world, resolves
the cpSpace and sets _initialized. Build the cpShapeFilter from RayCastInput
(categoryMask/collisionMask/groupFilter) with cpShapeFilterNew, falling back to the defaults set by
setDefaultFilter. rayCastFirst uses cpSpaceSegmentQueryFirst and fills RayCastHit
{shape, point, normal, fraction (alpha), distance (fraction * ray length)}; rayCastAll collects every
hit through the static rayCastAllCallback (declared in the header — implement it and use it, do not
replace it with a lambda), sorts them by fraction ascending (stable) and copies at most maxHits;
rayCastAny returns whether any hit exists (cheap first-hit query, no output). rayCastClosest and
rayCastMultiple are origin/end convenience wrappers over the same machinery with the default filter.
fanRayCast sweeps numRays rays over the full angle centred on direction (numRays == 1 fires straight
down direction; the sweep is symmetric: from -angle/2 to +angle/2 in equal steps) and keeps the first
hit of each ray. circleRayCast fires numRays evenly spaced rays of length radius over a full 2*pi from
center. lineOfSight is "no blocking hit against obstacleMask between from and to". distanceToNearest
Surface returns the distance to the first hit along a normalised direction, or -1 when nothing is hit
inside maxDist. Clamp every ray length to _maxDistance, normalise directions defensively (zero-length
direction => no hit), and honour maxHits/maxDistance <= 0 as "nothing to do".
computeReflectionAngle returns the angle (radians) of the reflected direction; computeReflection
Direction is the mirror r = d - 2*(d.n)*n on a normalised normal; computeRefractionDirection is Snell
via the standard vector form with ratio = n1/n2, returning the reflected direction on total internal
reflection. These three are static and must not touch members.`,
  },
  {
    slug: 'physics_shape_query',
    file: 'CCPhysicsShapeQuery.cpp',
    header: 'CCPhysicsShapeQuery.h',
    focus: `Shape-level queries. init(world) stores world, resolves cpSpace, sets _initialized.
Because PhysicsShape::_cpShapes is inaccessible, add a file-local helper that maps a PhysicsShape*
to its primary cpShape* via cpBodyEachShape on the owning body plus a cpShapeGetUserData match, and
another that collects all cpShape* of a PhysicsShape. overlapTest uses cpShapesCollide and writes at
most 4 contact points (points are the midpoint of pointA/pointB, or pointA — be consistent and say
which in a comment) plus the point count. shapeQuery uses cpSpaceShapeQuery to gather every other
shape overlapping the given one, filling ShapeQueryResult{shape, contactPoints[<=4], normal, depth,
pointCount} where depth is the deepest (most negative distance => positive depth) contact, skipping
the query shape's own siblings, bounded by maxResults. distanceBetweenShapes returns the separation
(0 when overlapping) and, when the out pointers are non-null, the closest point on each shape,
derived from cpShapesCollide (its points/distance are signed) — fall back to bounding-box centres
only if no cpShape can be resolved. containsPointInShape uses cpShapePointQuery (negative distance =>
inside) and reports the signed distance through the optional out param. sweepTest advances a copy of
the query along direction*distance using per-cpShape cpShapeSegmentQuery against the space
(cpSpaceSegmentQueryFirst along the sweep line with the shape's bounding radius as the query radius)
and returns SweepResult{shape, hitPoint, hitNormal, t in [0,1], hit}; castShape is the start/end
form of the same thing. getShapeBoundingBox converts cpShapeGetBB with PhysicsHelper::cpbb2rect
(merging all cpShapes of the PhysicsShape). getShapeSurfaceVelocity reads cpShapeGetSurfaceVelocity.
computeShapeMassProperties fills {mass, moment, area, centerOfMass} from the PhysicsShape accessors
plus its geometry (circle/box/polygon/segment via getType()), with centerOfMass from getCenter().
batchOverlapTest fills results[i] with "shapes[i] overlaps anything else in the space" for the first
min(count, maxResults) shapes and returns how many it wrote. findShapesInRect/AtPoint/AlongSegment
wrap cpSpaceBBQuery / cpSpacePointQuery / cpSpaceSegmentQuery, de-duplicating PhysicsShape pointers
(a PhysicsShape can own several cpShapes) and bounded by maxResults. The compute*Area/Moment helpers
must use the chipmunk primitives (cpAreaForCircle/Poly/Segment, cpMomentForCircle/Poly/Segment) with
a stack cpVect buffer for the polygon vertices, guarding count < 3 and radius <= 0.`,
  },
  {
    slug: 'physics_spatial_index',
    file: 'CCPhysicsSpatialIndex.cpp',
    header: 'CCPhysicsSpatialIndex.h',
    focus: `Uniform-grid broad phase, pure C++ (no chipmunk needed beyond what the body accessors give
you). init(cellSize, worldBounds) validates cellSize > 0 and a non-empty bounds, computes
_gridWidth/_gridHeight as ceil(size/cellSize) (at least 1), allocates _cells (gridWidth*gridHeight
buckets), clears _trackedBodies and sets _initialized. cellIndex(x, y) returns y*_gridWidth + x, or
-1 when out of range. getCellCoords clamps the point into [0, _gridWidth-1] x [0, _gridHeight-1]
relative to the bounds origin. getBodyBounds returns the union of the body's shapes' bounding boxes;
with no usable shape info fall back to a cellSize-sized box centred on the body position (use
PhysicsBody::getPosition and, when available, the shape bounding boxes through the public
PhysicsShape API — do not touch protected members). insertBody adds the body to every cell its bounds
overlap and to _trackedBodies (idempotent — no duplicate entry in a cell). removeBody erases it from
every cell and from _trackedBodies. updateBody = remove + insert (cheap and correct). queryRect
walks the overlapping cell range and returns each distinct body whose own bounds intersect the rect.
queryCircle walks the cells overlapping the circle's bounding box and keeps bodies whose bounds are
within radius of the centre (closest-point-on-box distance). querySegment walks the cells the segment
crosses (a DDA/Bresenham-style traversal, or the segment's cell bounding box scanned with a
per-cell segment/box overlap test) and keeps bodies whose bounds the segment intersects.
findPotentialPairs enumerates each unordered pair that shares at least one cell, exactly once, with
a stable order (cell order, then insertion order inside the cell) and with bounds actually
intersecting. getCellCount returns the number of allocated cells; getBodyCount the tracked-body
count; getCellSize the cell size. rebuild re-inserts every tracked body from scratch (recomputing
grid dimensions first). setCellSize / setWorldBounds validate their argument, recompute the grid and
rebuild. getNearestBodies returns up to maxCount tracked bodies sorted by distance from point
(ascending, deterministic tie-break). getBodiesInFrustum returns bodies inside the cone of half-angle
angle/2 around a normalised direction within distance (a body whose centre is inside the cone, or
whose bounds the cone clips — pick one rule, implement it exactly, and document it). Every public
method must be a no-op / empty result when !_initialized.`,
  },
  {
    slug: 'physics_world_query',
    file: 'CCPhysicsWorldQuery.cpp',
    header: 'CCPhysicsWorldQuery.h',
    focus: `World-level query facade over a raw cpSpace (init takes the cpSpace* directly here, so
just validate it, store it and set _initialized — every other method must return the documented empty
result when !_initialized or _space is null). queryNearestPoint uses cpSpacePointQueryNearest with a
category-mask filter and fills PhysicsNearestResult{shape, point, distance, gradient} (shape null and
distance <= 0 semantics documented in a comment when nothing is found — return distance -1 for "no
hit" and say so). querySegment collects every cpSpaceSegmentQuery hit as PhysicsSegmentQueryResult
{shape, point, normal, alpha} sorted by alpha ascending; querySegmentFirst uses
cpSpaceSegmentQueryFirst and returns alpha 1.0 with a null shape when nothing is hit. queryBoundingBox
uses cpSpaceBBQuery, de-duplicating PhysicsShape pointers. queryPointAll uses cpSpacePointQuery with
maxDistance and returns every hit sorted by distance ascending. countBodiesInRect counts DISTINCT
bodies (not shapes) whose shapes intersect the rect. isPointOccupied is a cheap
cpSpacePointQueryNearest test with maxDistance 0. distanceToNearestBody returns the nearest surface
distance or -1 when nothing is in range (use a generous max distance, e.g. cpSpacePointQueryNearest
with CP_INFINITY-free large finite value, and document the choice). getActiveContacts walks
cpSpaceEachBody + cpBodyEachArbiter, records each arbiter once (de-duplicate by arbiter pointer) and
fills PhysicsContactPairInfo{bodyA, bodyB, contactPoint (average of the arbiter's points),
contactNormal, penetration (max depth)}. getBodiesAlongRay returns distinct bodies hit by a segment
query ordered by alpha. getBodyAtPoint returns the body owning the nearest shape at that point.
getBodiesInCircle returns distinct bodies whose shapes are within radius of centre (bb query on the
circle's box, then an exact per-shape point/distance test). lineOfSight is "no blocking shape (per
blockMask) strictly between start and end". computePathClearance returns the minimum clearance over
every waypoint segment of the path (min over segments of the distance to the nearest blocking
surface; 0 when a segment is itself blocked, and a documented sentinel when the path is degenerate,
i.e. pathCount < 2 or path == nullptr). findOpenPositions walks the search area on a spacing grid and
returns each sample point whose nearest blocking shape is farther than clearance, in row-major order.
Category-mask filtering must be applied through cpShapeFilterNew(CP_NO_GROUP, categoryMask,
categoryMask) where a mask of 0 or 0xFFFFFFFF means "everything" — implement that rule explicitly and
consistently in one file-local helper.`,
  },
]

const DONE = [
  { slug: 'physics_body', file: 'CCPhysicsBody.cpp' },
  { slug: 'physics_collision_pair', file: 'CCPhysicsCollisionPair.cpp' },
  { slug: 'physics_contact', file: 'CCPhysicsContact.cpp' },
  { slug: 'physics_debug_draw', file: 'CCPhysicsDebugDraw.cpp' },
  { slug: 'physics_helper', file: 'CCPhysicsHelper.cpp' },
  { slug: 'physics_joint', file: 'CCPhysicsJoint.cpp' },
  { slug: 'physics_shape', file: 'CCPhysicsShape.cpp' },
  { slug: 'physics_world', file: 'CCPhysicsWorld.cpp' },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'summary'],
  properties: {
    summary: { type: 'string', description: 'One paragraph: overall state of the file.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'symbol', 'problem', 'fix'],
        properties: {
          severity: { enum: ['high', 'medium', 'low'] },
          symbol: { type: 'string', description: 'Function or member the defect lives in' },
          problem: { type: 'string' },
          fix: { type: 'string', description: 'Concrete change that resolves it' },
        },
      },
    },
  },
}

const LENSES = [
  {
    key: 'api',
    prompt: (m) => `You are auditing ONE file for problems that would stop it from COMPILING or LINKING,
or that misuse an API. File: /workspace/cocos2d-x/cocos/physics/${m.file}.

Read the whole file and its header /workspace/cocos2d-x/cocos/physics/${m.header || m.file.replace('.cpp', '.h')},
plus any sibling header whose API it calls. Chipmunk headers are absent, so reason from the API list
below and from how sibling files in cocos/physics call chipmunk.

Hunt specifically for:
- definitions whose signature, constness, return type or parameter list disagrees with the header
  declaration; default arguments repeated in the .cpp; missing "const" on a const method
- members/methods used that do not exist in the header, or that are private/protected to another
  class (PhysicsShape::_cpShapes and PhysicsWorld::_cpSpace are only visible to their friend list:
  Node, Sprite, Scene, Director, PhysicsBody, PhysicsShape, PhysicsJoint, PhysicsWorldCallback,
  PhysicsDebugDraw — nothing else)
- chipmunk symbols that do not exist in Chipmunk 7 or are called with the wrong argument count/order
  or wrong callback signature; cpShape* vs const cpShape* (query info structs hold const pointers);
  cpFloat/float and cpVect/Vec2 mixups; missing PhysicsHelper conversions
- missing #include for something the file now uses; use of a type only forward-declared
- narrowing/implicit conversions that change behaviour, unused-variable or shadowing warnings that
  are compiled with -Werror in this project's Release config
- undefined behaviour: writing past a fixed-size array, returning a reference/pointer to a local,
  dereferencing a possibly-null pointer, reading an uninitialised struct field

Report ONLY defects you can point at in the current text. Do not report style preferences.`,
  },
  {
    key: 'logic',
    prompt: (m) => `You are auditing ONE file for LOGIC and CORRECTNESS bugs.
File: /workspace/cocos2d-x/cocos/physics/${m.file}. Header:
/workspace/cocos2d-x/cocos/physics/${m.header || m.file.replace('.cpp', '.h')}.
Requirement spec: /workspace/requirements/${m.slug}.yaml (read the "## Module:" section).

This file was restored/implemented from a deliberately hollowed and subtly-corrupted base, so both
"missing" and "wrong on purpose" defects are in scope. Hunt for:
- wrong math: sign errors, swapped operands, degrees/radians mixups, area/moment formulas, wrong
  centre-of-mass offset, missing normalisation, reversed normals, alpha/fraction vs distance confusion
- inverted or short-circuited filter/mask logic (AND where OR is required and vice versa), group
  rules, sensor handling
- infinity / PHYSICS_INFINITY handling for mass and moment (setMass/addMass/addMoment/setMoment on a
  body must keep cpBody in sync and must treat infinite mass as "static-like": no division by
  infinity, no NaN, and 0-mass bodies must not become NaN)
- lifecycle order bugs: add/remove queued while the space is locked, double-add, use-after-free,
  forgetting to erase from a delay queue, forgetting to clear a mark, forgetting to delete a joint
  whose owner is going away, leaking a joint or contact
- off-by-one and boundary errors: <= vs <, count vs count-1, loop bounds, empty-container paths
- transform propagation: beforeSimulation/afterSimulation must convert between node and world space
  consistently and must not double-apply rotation/scale
- state that is computed but never stored (or stored and never used), early returns that skip
  required work, callbacks that are registered but never invoked
- determinism hazards: iteration order that depends on pointer values or hash order, unstable sort

For reference, upstream cocos2d-x v3/v4 semantics are the intended behaviour for
CCPhysicsBody/CCPhysicsContact/CCPhysicsJoint/CCPhysicsShape/CCPhysicsWorld; if the code deviates
from upstream in a way that changes observable behaviour, that is a finding — say what upstream does.
Report only defects you can point at in the current text, with the concrete failing scenario.`,
  },
  {
    key: 'completeness',
    prompt: (m) => `You are auditing ONE file for REQUIREMENT COMPLETENESS.
File: /workspace/cocos2d-x/cocos/physics/${m.file}. Header:
/workspace/cocos2d-x/cocos/physics/${m.header || m.file.replace('.cpp', '.h')}.
Requirement: /workspace/requirements/${m.slug}.yaml — read the "## Module:" section and treat every
clause in it as a checklist item.

Check:
1. Every method declared in the header has a definition in this .cpp (list any that are missing).
2. No method is still hollow: a body that only returns a default value / does nothing / ignores its
   arguments, without a real guard justifying it, is a finding. Count "(void)param;" casts that
   discard work as hollow.
3. Every clause of the requirement's module description is actually implemented; name the clauses
   that are not.
4. No placeholder text survives anywhere in the file. An automated sweep fails on these regexes:
   /Hollowed in benchmark base/, /hollowed base/, /\\bTODO\\b/, /not implemented/i. Report each hit
   as a HIGH finding with its line. Also flag "FIXME", "stub", "placeholder", "unimplemented",
   "for now".
5. Comments that describe behaviour the code does not have.

Report only what is actually true of the current file text.`,
  },
]

// ---------------------------------------------------------------- implement + audit + fix
const MODULES = [
  ...HOLLOW.map(m => ({ ...m, hollow: true })),
  ...DONE.map(m => ({ ...m, hollow: false, header: m.file.replace('.cpp', '.h') })),
]

phase('Implement')

const results = await pipeline(
  MODULES,
  // stage 1 — implement the hollow modules
  (m) => {
    if (!m.hollow) return `pre-implemented: ${m.file}`
    return agent(
      `${SHARED}

# Your task
Implement /workspace/cocos2d-x/cocos/physics/${m.file} completely. It is currently hollowed: most
method bodies are placeholders. Requirement: /workspace/requirements/${m.slug}.yaml.

Start by reading, in this order:
1. /workspace/requirements/${m.slug}.yaml (the "## Module:" section is your spec)
2. /workspace/cocos2d-x/cocos/physics/${m.header} (the exact API you must satisfy)
3. /workspace/cocos2d-x/cocos/physics/${m.file} (what is there now)
4. At least two sibling files for idiom and chipmunk usage: CCPhysicsWorld.cpp is the best model for
   space queries and callbacks, CCPhysicsShape.cpp for geometry/mass/moment, CCPhysicsBody.cpp for
   body access, CCPhysicsHelper.cpp for conversions, CCPhysicsCollisionPair.cpp for arbiter reads.
   Read the headers of anything you call so you only use APIs that exist.

## Module-specific specification
${m.focus}

Then rewrite the file so every declared method is fully implemented. Keep the license header,
namespace guards and the #if CC_USE_PHYSICS structure. Extend the include block as needed. Prefer
small file-local helpers in an anonymous namespace over duplicated logic. Comment the non-obvious
geometry with one short line, not an essay.

When you are done, re-read your own file top to bottom once and check: every header-declared method
defined exactly once with the declared signature; no placeholder text (see rule 2 in the environment
notes); no out-of-bounds write into a fixed-size array; every returned struct fully initialised;
const methods do not mutate members; every chipmunk call is one from the verified list.

Your final message is a data return value, not a chat reply: reply with a compact summary of what
each group of methods now does and any deliberate design decision a reviewer needs to know about
(e.g. how you resolved the cpSpace, what "no hit" sentinel you chose).`,
      { label: `impl:${m.slug}`, phase: 'Implement' }
    )
  },
  // stage 2 — three audit lenses in parallel for this module
  (implNote, m) =>
    parallel(
      LENSES.map(l => () =>
        agent(
          `${SHARED}

${l.prompt(m)}

${m.hollow ? `Context: this file was just implemented from scratch by another agent, whose notes were:\n${implNote}\n` : 'Context: this file was restored from a hollowed base in an earlier session and has NOT been reviewed yet.'}

Return findings as structured output. Be precise and conservative: a false positive costs a reviewer
real time. If the file is clean for your lens, return an empty findings array and say so in summary.`,
          { label: `audit:${m.slug}:${l.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }
        ).then(r => ({ lens: l.key, ...(r || { findings: [], summary: 'audit failed' }) }))
      )
    ).then(audits => ({ module: m, implNote, audits })),
  // stage 3 — apply the findings for this module
  async (bundle) => {
    const m = bundle.module
    const all = bundle.audits.flatMap(a => (a.findings || []).map(f => ({ lens: a.lens, ...f })))
    const actionable = all.filter(f => f.severity === 'high' || f.severity === 'medium')
    if (!actionable.length) {
      log(`${m.slug}: audit clean (${all.length} low-severity note(s))`)
      return { slug: m.slug, applied: 0, findings: all }
    }
    const fixNote = await agent(
      `${SHARED}

# Your task
Three independent auditors reviewed /workspace/cocos2d-x/cocos/physics/${m.file}. Apply the findings
that are genuinely defects, in that one file only.

Findings (JSON):
${JSON.stringify(all, null, 2)}

Auditor summaries:
${bundle.audits.map(a => `- [${a.lens}] ${a.summary}`).join('\n')}

Process: read the file and its header first. For each finding, verify it against the actual text
before changing anything — auditors do make mistakes, and a "fix" applied to a misdiagnosis makes the
file worse. Apply the real ones with minimal, surgical edits; keep everything else intact. Do not
introduce placeholder text (rule 2). Do not edit any other file. Do not run git or the build.

Your final message is a data return value: list each finding as FIXED (what you changed),
REJECTED (why it was not a defect), or DEFERRED (why it needs human judgement).`,
      { label: `fix:${m.slug}`, phase: 'Fix' }
    )
    return { slug: m.slug, applied: actionable.length, findings: all, fixNote }
  }
)

const clean = results.filter(Boolean)
log(`done: ${clean.length}/${MODULES.length} modules processed`)
return clean.map(r => ({
  slug: r.slug,
  findingCount: (r.findings || []).length,
  applied: r.applied,
  high: (r.findings || []).filter(f => f.severity === 'high').length,
  fixNote: r.fixNote,
}))
