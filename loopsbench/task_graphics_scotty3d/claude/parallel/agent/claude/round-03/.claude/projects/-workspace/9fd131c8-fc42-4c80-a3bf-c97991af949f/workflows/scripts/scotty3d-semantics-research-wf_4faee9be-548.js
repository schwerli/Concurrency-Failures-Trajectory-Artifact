export const meta = {
  name: 'scotty3d-semantics-research',
  description: 'Parallel deep-read of Scotty3D tests/docs to pin down exact expected semantics for the 8 unfinished requirements',
  phases: [
    { title: 'Research' },
  ],
}

const TOPICS = [
  {
    key: 'extrude',
    prompt: `In the repo /workspace (Scotty3D, CMU 15-462 A2 skeleton), determine the EXACT expected semantics of Halfedge_Mesh::extrude_face(FaceRef) and Halfedge_Mesh::extrude_positions(FaceRef, Vec3 move, float shrink).
Read carefully: /workspace/tests/a2/test.a2.l4.cpp (all 3 tests, including the exact 'after' meshes and how positions are computed), /workspace/src/gui/widgets.cpp (search for extrude / bevel to see how the GUI calls these, what 'move' and 'shrink' mean and in which order they are applied and relative to what starting positions), /workspace/src/geometry/halfedge.h comments, and /workspace/assignments/A2.md.
Report: (1) topology created by extrude_face: exactly which new vertices/halfedges/edges/faces, how the inner face relates to the original face, which face the returned FaceRef is, whether the original face becomes the inner face or the ring, orientation of side quads, what happens for boundary faces; (2) extrude_positions: exact formula for new positions from the CURRENT positions (or from original positions?) - note extrude_positions is called repeatedly as the user drags, so state precisely what it must be idempotent/relative to; where the centroid comes from; what direction 'move' is; how shrink interpolates; (3) the numeric expectations in test.a2.l4.cpp with a worked example verifying your formula reproduces the expected vertex coordinates. Quote the relevant code exactly. Be precise and complete.`,
  },
  {
    key: 'subdiv',
    prompt: `In the repo /workspace (Scotty3D, CMU 15-462 A2 skeleton), determine the EXACT expected semantics of Halfedge_Mesh::catmark_subdivide_helper(vertex_positions, edge_vertex_positions, face_vertex_positions) declared in /workspace/src/geometry/halfedge.h and stubbed in /workspace/src/geometry/halfedge-global.cpp.
Read: /workspace/tests/a2/test.a2.g2.cpp and test.a2.g3.cpp (they test linear_subdivide and catmark_subdivide which call the helper) — extract the exact before/after meshes including how BOUNDARY faces are handled; /workspace/assignments/A2/linear.md, /workspace/assignments/A2/catmull.md, /workspace/assignments/A2/halfedge.md; /workspace/src/geometry/halfedge-global.cpp (linear_subdivide/catmark_subdivide stubs).
Report: (1) precisely what topology the helper must produce: what happens to every edge, every non-boundary face, and every BOUNDARY face (do boundary loops get a center vertex? do their edges get split? how does the boundary loop end up connected?); (2) which vertices get positions from which map, and what to do if a map lacks an entry; (3) an exact worked example: for the input mesh in test.a2.g2.cpp, list the expected faces after subdivision and confirm counts (V/E/F) for both the interior and the boundary; (4) any ordering/iteration hazards (modifying lists while iterating). Quote code exactly.`,
  },
  {
    key: 'globals',
    prompt: `In the repo /workspace (Scotty3D), determine the EXACT expected semantics of these three functions stubbed in /workspace/src/geometry/halfedge-global.cpp: void Halfedge_Mesh::flip_orientation(); void Halfedge_Mesh::set_corner_normals(float threshold); void Halfedge_Mesh::set_corner_uvs_per_face().
Read: /workspace/src/geometry/halfedge.h (the detailed comments above each declaration), /workspace/src/gui/widgets.cpp (how they are invoked, what UI parameters mean), /workspace/src/geometry/halfedge-utility.cpp (Halfedge_Mesh::cube() calls set_corner_normals(0.0f) and set_corner_uvs_per_face(); also see set_corner_uvs_project for the style of implementation), /workspace/src/geometry/util.cpp and /workspace/src/geometry/indexed.cpp (to see how corner_normal/corner_uv are consumed downstream, e.g. what UV layout is expected per face), plus any test files under /workspace/tests that touch these.
Report: (1) flip_orientation: exactly which pointers must change (the header says only Halfedge::next, Halfedge::vertex and Vertex::halfedge change — explain the algorithm that achieves this and how corner data should be treated); (2) set_corner_normals: the exact smoothing-group algorithm for smooth/auto/flat modes, how the 'angle > threshold' test is defined (angle between what?), how boundary faces' halfedges should be handled, and how normals are averaged (area weighted?); (3) set_corner_uvs_per_face: the exact projection: which tangent plane/axes, what scale/offset, what a unit square maps to, and how boundary halfedges are treated. Look for any existing reference behaviour in the repo (e.g. Util:: mesh generators that set uvs) to match conventions. Quote code exactly.`,
  },
  {
    key: 'localops',
    prompt: `In the repo /workspace (Scotty3D, CMU 15-462 A2), extract the exact expected behaviour and edge cases for the local halfedge ops: bisect_edge, split_edge, flip_edge, collapse_edge (stubs in /workspace/src/geometry/halfedge-local.cpp).
Read: /workspace/tests/a2/test.a2.l1.cpp, l2.cpp, l3.cpp, local.mix.cpp; /workspace/src/geometry/halfedge.h (declaration comments + the validate() contract); /workspace/src/geometry/halfedge-utility.cpp validate(); /workspace/assignments/A2.md and /workspace/assignments/A2/halfedge.md.
Report: (1) for each op, the precise required output topology including where vertex->halfedge must point (e.g. split_edge says "the newly added vertex's halfedge should be aligned with the original edge"), how boundary faces must be treated (bisect_edge on a boundary edge, split_edge not splitting boundary faces, flip_edge rejecting boundary edges); (2) an enumeration of ALL the invalid-result cases that must be detected BEFORE mutating the mesh (list them concretely in terms of the validate() rules: faces with <3 halfedges, vertices with <2 halfedges in their cycle, faces touching a vertex/edge twice, vertices on >1 boundary face, orphaned vertices/edges), especially for collapse_edge (triangle faces collapsing to degenerate 2-gons, the "figure 8" case in A2.md, collapsing an edge where both endpoints are on the boundary but the edge is not, collapsing an edge of a triangle with a boundary edge, etc.); (3) for collapse_edge, describe an algorithm that detects rejection cases up-front and then performs the collapse correctly for general polygons. Quote code exactly. Be exhaustive about edge cases.`,
  },
  {
    key: 'transform',
    prompt: `In the repo /workspace (Scotty3D, CMU 15-462 A1), determine the exact expected semantics of Mat4 Transform::local_to_world() const and Mat4 Transform::world_to_local() const in /workspace/src/scene/transform.cpp.
Read: /workspace/src/scene/transform.h and transform.cpp, /workspace/tests/a1/test.a1.task1.cpp, /workspace/assignments/A1.md (the A1T1 section), and every call site of local_to_world/world_to_local in /workspace/src (grep). Also check how std::weak_ptr parent expiry should be handled and whether cycles are possible.
Report: (1) the exact composition order (row-vector vs column-vector convention used by Mat4 — verify against /workspace/src/lib/mat4.h operator* and Mat4::translate semantics, and against the expected matrix in the test); (2) exact code for both functions using parent.lock() and parent_to_local(), never Mat4::inverse(); (3) edge cases: no parent, expired weak_ptr, deep chains, and whether iterative or recursive matters. Quote code exactly.`,
  },
]

phase('Research')
const results = await parallel(TOPICS.map(t => () =>
  agent(t.prompt, { label: `research:${t.key}`, phase: 'Research' })
))

return results.map((r, i) => `### ${TOPICS[i].key}\n${r}`).join('\n\n')
