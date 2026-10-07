export const meta = {
  name: 'physics2d-cpp-restore',
  description: 'Restore 13 hollowed cocos2d-x Physics2D C++ modules and adversarially verify each',
  phases: [
    { title: 'Implement' },
    { title: 'Verify' },
  ],
}

const DIR = '/workspace/cocos2d-x/cocos/physics'

const SHARED = `
You are restoring intentionally hollowed source in a cocos2d-x 3.17 tree at /workspace/cocos2d-x.
All physics sources live in ${DIR}.

CRITICAL GROUND RULES
- The hollowing marker is the literal comment "Hollowed in benchmark base" (sometimes with a suffix).
  After your work, ZERO such comments may remain in your file, and no function may remain a
  placeholder that returns a constant/empty value when a real computation is possible.
- Chipmunk is API version 7 (cpShapeFilter, cpSpacePointQueryNearest, cpSpaceSegmentQuery*,
  cpSpaceBBQuery, cpArbiter*, cpBodyGetPosition, cpSpaceStep, cpTransform, ...).
  physics/cpCompat62.h provides Chipmunk 6.2-style aliases (cpBodyGetPos, cpShapeGetLayers,
  cpPolyShapeGetNumVerts, cpShapeNearestPointQuery, cpSpaceAddStaticShape, ...). Prefer the
  Chipmunk 7 names directly unless the file already uses the compat aliases.
- The project's external/ dependencies are NOT vendored in this environment, so the tree CANNOT be
  compiled. You therefore must be extremely careful and conservative: every Chipmunk call, every
  cocos2d-x type, and every member you touch must actually exist. VERIFY EVERY IDENTIFIER by
  reading the corresponding header in ${DIR} (and cocos/math/, cocos/base/ as needed) before using
  it. Do NOT invent members, do NOT invent Chipmunk functions, do NOT guess struct field names.
  When you are unsure whether an API exists, use a formulation you can prove from a header you read
  or from an existing non-hollowed call site in this tree (grep for it).
- Never introduce a mock, fake, stub, or "simulated" code path. Use real geometry / real Chipmunk
  traversal.
- Match the surrounding code style exactly: 4-space indent, cocos2d-x brace-on-new-line, NS_CC_BEGIN
  / NS_CC_END, the #if CC_USE_PHYSICS guard, existing comment density (sparse - do not over-comment).
- Only modify the ONE .cpp file assigned to you. Do NOT modify any .h file, any other .cpp, any
  CMakeLists.txt, or anything outside ${DIR}. Do not create new files.
- Keep every existing function signature byte-identical to the header declaration.
- Include only headers that exist. Check with ls/grep before adding an #include.
`

const MODULES = [
  {
    slug: 'physics_helper',
    file: 'CCPhysicsHelper.cpp',
    header: 'CCPhysicsHelper.h',
    brief: `Implement Vec2<->cpVect, Size<->cpVect, Rect<->cpBB conversions, float precision conversion,
batch point conversions (points2cpvs/cpvs2points), getBodyPosition/getBodyAngle,
transform2cpTransform, convex hull computation (computeConvexHull - use a deterministic
monotone-chain/Andrew hull), computePolygonCenter, isPolygonConvex,
segmentIntersect, pointToSegmentDistance, polygonArea, polygonMoment, circleArea, circleMoment.

Notes:
- cpbb2rect must produce a Rect with origin at (bb.l, bb.b) and size (r-l, t-b).
- rect2cpbb must use cpBBNew(l, b, r, t) ordering; getMinX/getMinY/getMaxX/getMaxY on Rect.
- polygonArea: standard shoelace, return the absolute value.
- polygonMoment: Chipmunk cpMomentForPoly(mass, count, verts, offset, radius) is the correct
  primitive - use it (radius 0). circleMoment: cpMomentForCircle(mass, 0, radius, offset).
- circleArea: cpAreaForCircle(0, radius) or M_PI*radius*radius; be consistent.
- segmentIntersect must return false for parallel/degenerate input and only report intersections
  where both parameters lie in [0,1].`,
  },
  {
    slug: 'physics_shape',
    file: 'CCPhysicsShape.cpp',
    header: 'CCPhysicsShape.h',
    brief: `Two hollowed regions (grep for the marker):
1) Polygon and edge shape initialisation (PhysicsShapePolygon::init and/or
   PhysicsShapeEdgePolygon / PhysicsShapeEdgeChain / PhysicsShapeEdgeBox init) must be restored so
   area, mass and moment are computed correctly via calculateArea() / calculateDefaultMoment() and
   the cpShape(s) are created and registered exactly as upstream cocos2d-x 3.17 does.
2) updateScale() for PhysicsShapePolygon, PhysicsShapeEdgePolygon and PhysicsShapeEdgeChain so
   vertex coordinates scale correctly: for each vertex, undo the previous scale
   (divide by the recorded _scaleX/_scaleY) and apply the new one (_newScaleX/_newScaleY),
   write back with cpPolyShapeSetVerts / cpSegmentShapeSetEndpoints as appropriate, then call
   the base PhysicsShape::updateScale().

Read the whole file first. Study the non-hollowed sibling implementations in the same file
(e.g. PhysicsShapeCircle / PhysicsShapeBox) to mirror their exact idioms for _area, _mass,
_moment, _cpShapes.pushBack, cpShapeSetUserData, setMaterial, and the _newScaleX/_newScaleY /
_scaleX/_scaleY dance. Also inspect the class declarations in CCPhysicsShape.h for the exact
member names available (do NOT invent members).`,
  },
  {
    slug: 'physics_body',
    file: 'CCPhysicsBody.cpp',
    header: 'CCPhysicsBody.h',
    brief: `Two hollowed regions plus surrounding correctness bugs:
1) addShape(PhysicsShape*, bool addMassAndMoment) must integrate the shape area/mass/moment into
   the body totals (accumulate _area; when addMassAndMoment and the shape mass/moment are not
   PHYSICS_INFINITY, addMass(shape->getMass()) and addMoment(shape->getMoment())), set the shape
   body pointer, push into _shapes, retain, add the shape cpShapes to the world if the body is
   already in a world, and return the shape.
2) beforeSimulation()/afterSimulation() transform propagation (node world transform -> cpBody and
   back), and the onEnter/onExit/onRemove-style lifecycle hooks that call
   addToPhysicsWorld so the body actually joins the scene PhysicsWorld.
3) Audit and FIX setMass/addMass/addMoment: infinity handling must be correct
   (PHYSICS_INFINITY sentinel), _mass/_massDefault/_moment/_momentDefault bookkeeping consistent,
   and cpBodySetMass / cpBodySetMoment called to sync the Chipmunk body whenever the body is
   dynamic. Watch for inverted conditions, wrong sentinel comparisons, or a missing cpBody sync.

Read the entire file and CCPhysicsBody.h before editing. Mirror upstream cocos2d-x 3.17 semantics.`,
  },
  {
    slug: 'physics_joint',
    file: 'CCPhysicsJoint.cpp',
    header: 'CCPhysicsJoint.h',
    brief: `One hollowed region: the createConstraints() implementations. Implement createConstraints()
for every joint class in this file: PhysicsJointFixed (cpPivotJoint at the anchor + cpGearJoint with
phase 0 / ratio 1), PhysicsJointPin (cpPivotJoint; when the specific-anchor flag is set use the
two-anchor cpPivotJointNew2 form, otherwise the world-anchor cpPivotJointNew form),
PhysicsJointLimit (cpSlideJointNew with min/max), PhysicsJointDistance (cpPinJointNew),
PhysicsJointSpring (cpDampedSpringNew with stiffness/damping and computed rest length),
PhysicsJointGroove (cpGrooveJointNew), PhysicsJointRotarySpring (cpDampedRotarySpringNew),
PhysicsJointRotaryLimit (cpRotaryLimitJointNew), PhysicsJointRatchet (cpRatchetJointNew),
PhysicsJointGear (cpGearJointNew), PhysicsJointMotor (cpSimpleMotorNew).

Each must follow the file existing pattern: a do { ... } while(false) with CC_BREAK_IF on a null
constraint, push each constraint into _cpConstraints, and return true only on full success.
Convert positions with PhysicsHelper::point2cpv. Read CCPhysicsJoint.h for the exact member names of
every joint class (do NOT invent members) and mirror upstream cocos2d-x 3.17.`,
  },
  {
    slug: 'physics_contact',
    file: 'CCPhysicsContact.cpp',
    header: 'CCPhysicsContact.h',
    brief: `Three things:
1) generateContactData(): restore full extraction from _contactInfo (a cpArbiter*): read the
   contact point set via cpArbiterGetContactPointSet, allocate/refresh the PhysicsContactData
   (_contactData / _preContactData handling as upstream does), fill points[], normal, and count.
2) onEvent() (the routing function around line 199, currently commented
   "Minimal callback routing for hollowed base."): dispatch BEGIN / PRESOLVE / POSTSOLVE / SEPARATE
   to the correct EventListenerPhysicsContact callbacks (onContactBegin, onContactPreSolve,
   onContactPostSolve, onContactSeparate), guarding each with hitTest(shapeA, shapeB) and writing
   the result back into the contact (setResult) for BEGIN/PRESOLVE only.
3) EventListenerPhysicsContactWithGroup::hitTest() currently uses the wrong boolean operator -
   it must match when EITHER shape body group equals _group (OR logic), not both.

Read the whole file and CCPhysicsContact.h first; use the exact member and enum names declared
there. Mirror upstream cocos2d-x 3.17.`,
  },
  {
    slug: 'physics_world',
    file: 'CCPhysicsWorld.cpp',
    header: 'CCPhysicsWorld.h',
    brief: `Four hollowed regions plus an injected bug:
1) rayCast(), queryRect(), queryPoint() must dispatch through real Chipmunk space traversal:
   cpSpaceSegmentQuery with PhysicsWorldCallback::rayCastCallbackFunc,
   cpSpaceBBQuery with PhysicsWorldCallback::queryRectCallbackFunc,
   cpSpacePointQuery with the point-query callback - check the PhysicsWorldCallback struct already
   present in this file for the exact callback names and the RayCastCallbackInfo /
   RectQueryCallbackInfo / PointQueryCallbackInfo helper structs.
   Set and clear PhysicsWorldCallback::continues around the traversal exactly as upstream does.
2) getShapes(const Vec2&) must collect every shape at the point via cpSpacePointQuery, and
   getShape(const Vec2&) contains an injected bug: it shifts the query point by (0.5, 0) - remove
   the shift and query the exact point.
3) updateBodies(), removeBody(), removeBodyOrDelay(), removeJoint(), updateJoints(), removeShape(),
   addJoint(): correct delayed add/remove queue handling (_delayAddBodies / _delayRemoveBodies /
   _delayAddJoints / _delayRemoveJoints), cpSpaceRemoveShape for every shape of a removed body,
   and the cpSpaceIsLocked guards.
4) update(float delta, bool userCall): the full simulation step - process the delayed queues first,
   then step the space (cpSpaceStep / cpHastySpaceStep as the platform #ifdef in this file
   dictates) either once for a user call or in _updateRate-throttled _fixedRate/substep fashion,
   then update body transforms, run the debug draw hook, and reset accumulators.

Read the entire file and CCPhysicsWorld.h before editing; every member and callback name must come
from what is actually declared there. Mirror upstream cocos2d-x 3.17.`,
  },
  {
    slug: 'physics_collision_pair',
    file: 'CCPhysicsCollisionPair.cpp',
    header: 'CCPhysicsCollisionPair.h',
    brief: `Every method is hollowed. Implement the whole class against cpArbiter:
init/update (store arbiter, resolve _shapeA/_shapeB from cpArbiterGetShapes +
cpShapeGetUserData, set _valid, clear _ignored), invalidate (drop arbiter, _valid=false),
getShapeA/B, getBodyA/B (via PhysicsShape::getBody()), getContactCount
(cpArbiterGetCount), getContactPoint(index) (cpArbiterGetPointA/PointB/Normal/Depth into a
CollisionPoint, plus per-point normal/tangent impulse where obtainable), getContactPoints (fill the
caller array, bounded by getContactCount()), getContactNormal (cpArbiterGetNormal),
getTotalNormalImpulse / getTotalTangentImpulse / getTotalImpulse (cpArbiterTotalImpulse and its
projection onto the normal / tangent), getKineticEnergy (cpArbiterTotalKE),
getRestitution/setRestitution (cpArbiterGetRestitution/cpArbiterSetRestitution),
getFriction/setFriction, getSurfaceVelocity/setSurfaceVelocity,
isFirstContact (cpArbiterIsFirstContact), isRemoval (cpArbiterIsRemoval),
isSensor (either shape is a sensor - cpShapeGetSensor), ignore() (cpArbiterIgnore + _ignored=true),
isIgnored, and the computed helpers: computeSeparatingVelocity (relative velocity projected on the
normal), computeOverlap (max penetration depth over all points, reported positive),
computeRelativeVelocity (cpBodyGetVelocityAtWorldPoint difference at the contact centre),
computeContactCenter (mean of the contact points).

EVERY accessor must be null-safe: if _arbiter is null or !_valid, return the neutral value that the
current stub returns (nullptr / 0 / Vec2::ZERO / false) rather than dereferencing.
Read CCPhysicsCollisionPair.h for the exact CollisionPoint field names, and CCPhysicsShape.h /
CCPhysicsBody.h for accessor names. Use PhysicsHelper for cpVect<->Vec2.`,
  },
  {
    slug: 'physics_contact_mgr',
    file: 'CCPhysicsContactManager.cpp',
    header: 'CCPhysicsContactManager.h',
    brief: `Every method is hollowed. Implement the contact lifecycle manager:
init(cpSpace*) (store the space, install the default cpCollisionHandler and point its
begin/preSolve/postSolve/separate funcs at this manager static trampolines if the header declares
them, set _initialized), processContacts (per-step iteration over the tracked contacts, refreshing
each and retiring stale ones), filterContact (bitmask category/collision/contact-test filtering
between the two shapes - both directions must pass, plus the group rule), the four callback
dispatchers (begin/preSolve/postSolve/separate), getContact, findContactBetween(bodyA, bodyB),
getActiveContactCount, and the contact pool management (acquire from / release to the pool,
clear()).

Read CCPhysicsContactManager.h FIRST and implement exactly the declared members - do not invent
member variables or methods. Null-guard everything. Use PhysicsShape/PhysicsBody accessors that you
have confirmed exist in their headers.`,
  },
  {
    slug: 'physics_debug_draw',
    file: 'CCPhysicsDebugDraw.cpp',
    header: 'CCPhysicsDebugDraw.h',
    brief: `Every method is hollowed. Implement the debug draw subsystem:
drawWorld (top-level dispatcher: beginDraw, iterate the world bodies and joints, endDraw),
drawBody (iterate its shapes; optional bounding box / centre of mass / velocity / sleep overlays),
drawShape (dispatch on PhysicsShape::Type - CIRCLE via drawCircle/drawDot, POLYGON/BOX via
drawPolygon, EDGESEGMENT via drawSegment, and the edge-polygon/chain variants),
drawJoint (pin / spring / slide variants drawn as segments plus anchor dots),
drawBoundingBox, drawContactPoint, drawVelocityVector, drawCenterOfMass, drawSleepIndicator,
and beginDraw/endDraw renderer state management (clear the DrawNode, set the draw node
visibility/z-order).

Read CCPhysicsDebugDraw.h FIRST for the exact declared members and signatures, and check
cocos/2d/CCDrawNode.h for the exact DrawNode API you call (drawSegment, drawPolygon, drawCircle,
drawDot, drawLine, clear) - only use overloads that actually exist. Read CCPhysicsWorld.h /
CCPhysicsBody.h / CCPhysicsShape.h / CCPhysicsJoint.h for the accessors (getBodies, getJoints,
getShapes, getBoundingBox, getPosition, getVelocity, isResting, getType, ...). Do NOT invent
accessors: if an accessor you want does not exist, derive the value from ones that do. Null-guard
the draw node and the world.`,
  },
  {
    slug: 'physics_raycast',
    file: 'CCPhysicsRayCast.cpp',
    header: 'CCPhysicsRayCast.h',
    brief: `Every method is hollowed. Implement advanced raycasting on top of cpSpaceSegmentQuery /
cpSpaceSegmentQueryFirst: rayCastFirst, rayCastAll, rayCastAny, rayCastClosest, rayCastMultiple,
fanRayCast (sweep N rays across an arc centred on a direction), circleRayCast (N rays evenly
distributed over a full circle), lineOfSight (true when no blocking shape is hit),
distanceToNearestSurface, and the reflection / refraction direction computation used for ray
bouncing (reflect: d - 2*(d dot n)*n ; refract: Snell law with total-internal-reflection fallback).

Read CCPhysicsRayCast.h FIRST for the exact declared signatures and result struct field names, and
confirm every Chipmunk symbol you use (cpSpaceSegmentQueryFirst, cpSegmentQueryInfo with fields
shape/point/normal/alpha, cpShapeFilter / CP_SHAPE_FILTER_ALL). Use PhysicsHelper for conversions.
Null-guard the space. Rays must be deterministic: iterate angles by index, never randomly.`,
  },
  {
    slug: 'physics_shape_query',
    file: 'CCPhysicsShapeQuery.cpp',
    header: 'CCPhysicsShapeQuery.h',
    brief: `Every method is hollowed. Implement shape-level query operations:
overlapTest (two shapes - cpShapesCollide contact count > 0), shapeQuery (all shapes in
the space overlapping a given shape - cpSpaceShapeQuery), distanceBetweenShapes
(cpShapesCollide distance, or nearest-point-query fallback), containsPointInShape
(cpShapePointQuery distance <= 0), sweepTest (march the moving shape along its path and report the
first hit - deterministic fixed-step march or a segment query along the motion), castShape,
batchOverlapTest, findShapesInRect (cpSpaceBBQuery), findShapesAtPoint (cpSpacePointQuery),
findShapesAlongSegment (cpSpaceSegmentQuery), plus the polygon/circle area and moment helpers
(cpAreaForPoly / cpMomentForPoly / cpAreaForCircle / cpMomentForCircle).

Read CCPhysicsShapeQuery.h FIRST for exact signatures and result struct fields. Confirm every
Chipmunk symbol exists (cpSpaceShapeQuery takes a cpSpaceShapeQueryFunc(cpShape*,
cpContactPointSet*, void*)). Use PhysicsHelper for conversions. Null-guard everything and keep
iteration order deterministic.`,
  },
  {
    slug: 'physics_spatial_index',
    file: 'CCPhysicsSpatialIndex.cpp',
    header: 'CCPhysicsSpatialIndex.h',
    brief: `Every method is a placeholder returning empty/zero. Implement a real uniform grid:
init(cellSize, worldBounds) (validate cellSize > 0, compute _gridWidth/_gridHeight by ceil of the
bounds divided by the cell size, resize _cells, set _initialized, return true),
clear (empty every cell and _trackedBodies), insertBody (compute the body bounds via
getBodyBounds and push it into every overlapping cell, add to _trackedBodies), removeBody
(erase from every cell and from _trackedBodies), updateBody (remove then insert),
queryRect / queryCircle / querySegment (traverse only the cells the query touches; deduplicate
results and apply the exact geometric test - rect intersection, circle-vs-bounds distance,
segment-vs-bounds), findPotentialPairs (enumerate unordered pairs that share at least one cell,
deduplicated, with a stable order), getCellCount, getBodyCount, rebuild (re-derive the grid and
re-insert every tracked body - must be safe to call after setCellSize/setWorldBounds),
setCellSize / setWorldBounds (must invalidate/rebuild the grid, not just assign),
getNearestBodies (distance-sorted, capped at maxCount, ties broken deterministically),
getBodiesInFrustum (cone test: within distance AND the angle between (body - origin) and the
normalised direction is <= angle/2), and the private helpers cellIndex, getCellCoords,
getBodyBounds.

Results MUST be deterministic: never rely on unordered_set iteration order for output ordering -
build output by cell/index traversal order, or sort. getBodyBounds should use the body shapes
bounding boxes (check CCPhysicsBody.h / CCPhysicsShape.h for the real accessor, e.g.
PhysicsShape::getBoundingBox / PhysicsBody::getShapes / getPosition) and fall back to a
cell-sized box around the body position if no shape bounds are available. Do NOT invent accessors.`,
  },
  {
    slug: 'physics_world_query',
    file: 'CCPhysicsWorldQuery.cpp',
    header: 'CCPhysicsWorldQuery.h',
    brief: `Every method is a placeholder. Implement the high-level world query interface over cpSpace:
init(cpSpace*) (store, set _initialized, return space != nullptr),
queryNearestPoint (cpSpacePointQueryNearest -> fill PhysicsNearestResult from cpPointQueryInfo),
querySegment / querySegmentFirst (cpSpaceSegmentQuery / cpSpaceSegmentQueryFirst -> alpha-sorted
PhysicsSegmentQueryResult list), queryBoundingBox (cpSpaceBBQuery -> PhysicsBBQueryResult list),
queryPointAll (cpSpacePointQuery collecting every shape within maxDistance),
countBodiesInRect (distinct bodies, not shapes), isPointOccupied, distanceToNearestBody
(-1 when nothing found), getActiveContacts (iterate the space bodies via
cpSpaceEachBody + cpBodyEachArbiter - fill PhysicsContactPairInfo
with contact point, normal and penetration), getBodiesAlongRay, getBodyAtPoint,
getBodiesInCircle, lineOfSight (false when a shape matching blockMask is hit between the points),
computePathClearance (minimum clearance over every waypoint / leg of the path), and
findOpenPositions (deterministic grid scan of searchArea at the given spacing, keeping positions
with at least the requested clearance of free space).

categoryMask must be honoured through cpShapeFilter (categories/mask) - use
cpShapeFilterNew(CP_NO_GROUP, categoryMask, categoryMask) when a mask is supplied and
CP_SHAPE_FILTER_ALL when the mask is 0 / all-ones. Read CCPhysicsWorldQuery.h FIRST for the exact
result struct fields. Confirm every Chipmunk symbol you use. Null-guard _space everywhere; keep all
output ordering deterministic (sort by alpha/distance, or preserve traversal order).`,
  },
]

phase('Implement')

const results = await pipeline(
  MODULES,
  (m) => agent(
    `${SHARED}

## YOUR ASSIGNMENT: ${m.slug}
Target file (the ONLY file you may modify): ${DIR}/${m.file}
Its header (read it, do not modify): ${DIR}/${m.header}

${m.brief}

## PROCEDURE
1. Read ${DIR}/${m.file} in full.
2. Read ${DIR}/${m.header} in full.
3. Read/grep any other header in ${DIR} (and cocos/math/CCGeometry.h, cocos/math/Vec2.h,
   cocos/base/CCVector.h, cocos/2d/CCDrawNode.h, cocos/base/ccTypes.h) whose types you touch, so
   every identifier you write is one you have SEEN declared.
4. Grep the tree for existing call sites of any Chipmunk function you are unsure about
   (grep -rn "cpFoo" /workspace/cocos2d-x/cocos) to confirm the real signature/name in use here.
5. Write the complete implementation with the Write/Edit tools.
6. Self-review your own output line by line: every identifier proven, every signature matching the
   header, no marker comments left, no placeholder returns left, no unused-parameter warnings
   (either use the parameter or keep the existing (void)param; cast), braces balanced.
7. Re-grep your file for "Hollowed in benchmark base" and confirm 0 hits.

## RETURN VALUE
Return a JSON object with: file, functions_implemented (count), markers_remaining (int),
uncertain_identifiers (array of any API name you could not fully prove, empty if none),
notes (short string describing anything a reviewer must double check).`,
    { label: `impl:${m.slug}`, phase: 'Implement', schema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        functions_implemented: { type: 'integer' },
        markers_remaining: { type: 'integer' },
        uncertain_identifiers: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['file', 'functions_implemented', 'markers_remaining', 'uncertain_identifiers', 'notes'],
    } }
  ).then((r) => ({ module: m, impl: r })),

  (prev, m) => agent(
    `You are an adversarial C++ reviewer for a cocos2d-x 3.17 physics module that CANNOT be compiled
in this environment (external deps absent). Your job is to catch anything that would break a real
build or produce wrong behaviour.

File under review: ${DIR}/${m.file}
Its header: ${DIR}/${m.header}
Chipmunk API version: 7 (with physics/cpCompat62.h providing 6.2-style aliases).

Implementer self-report: ${JSON.stringify(prev ? prev.impl : null)}

REVIEW CHECKLIST - be specific and skeptical:
1. Does every function definition exactly match its declaration in the header (name, params,
   const-ness, return type, class scope)? Any function declared in the header but now MISSING from
   the .cpp? Any function defined in the .cpp but not declared?
2. Does every Chipmunk symbol used actually exist in Chipmunk 7 (or in cpCompat62.h)? Flag any
   invented function, wrong arity, or wrong argument order. Confirm struct field names
   (cpSegmentQueryInfo{shape,point,normal,alpha}, cpPointQueryInfo{shape,point,distance,gradient},
   cpContactPointSet{count,normal,points[].pointA/pointB/distance}).
3. Does every cocos2d-x member/accessor used actually exist? Grep the relevant headers to confirm.
   Flag invented members.
4. Are all #includes present for what is used, and do all included paths exist on disk?
5. Any remaining "Hollowed in benchmark base" comment, or any function that still just returns a
   constant when real work is possible?
6. Correctness: null-guards, off-by-one in loops, integer/float division, uninitialised struct
   fields, dangling pointers, use of unordered containers where deterministic output order is
   required, missing retain/release, missing cpSpace lock guards.
7. C++ validity: balanced braces, missing semicolons, lambda-to-function-pointer conversions that
   will not compile (capturing lambdas can NOT convert to C function pointers - flag any capturing
   lambda passed to a Chipmunk callback), narrowing conversions, use of C++ features beyond C++11.
8. Does the file still compile-plausibly as a whole? Read it end to end.

Use Read/Grep freely. Then FIX every real problem you find yourself, directly in
${DIR}/${m.file} (you may only modify that file). Re-read after editing to confirm.

RETURN a JSON object: file, issues_found (array of short strings), issues_fixed (array of short
strings), remaining_risks (array of short strings), markers_remaining (int), verdict
("clean" or "fixed" or "needs_attention").`,
    { label: `verify:${m.slug}`, phase: 'Verify', schema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        issues_found: { type: 'array', items: { type: 'string' } },
        issues_fixed: { type: 'array', items: { type: 'string' } },
        remaining_risks: { type: 'array', items: { type: 'string' } },
        markers_remaining: { type: 'integer' },
        verdict: { type: 'string' },
      },
      required: ['file', 'issues_found', 'issues_fixed', 'remaining_risks', 'markers_remaining', 'verdict'],
    } }
  ).then((v) => ({ slug: m.slug, file: m.file, impl: prev ? prev.impl : null, verify: v }))
)

return { modules: results.filter(Boolean) }
