export const meta = {
  name: 'scotty3d-understand',
  description: 'Parallel deep-read of Scotty3D halfedge infrastructure, test harness semantics, and requirement expectations',
  phases: [
    { title: 'Survey' },
  ],
}

const TOPICS = [
  {
    key: 'validate',
    prompt: `Read /workspace/src/geometry/halfedge-utility.cpp completely. Report, in precise detail:
1. The exact rules enforced by Halfedge_Mesh::validate() — enumerate every check with the exact error message text and the precise condition.
2. The exact behavior of both interpolate_data() overloads (VertexRef and HalfedgeRef versions) — what fields they set, how averaging works, edge cases with empty input.
3. The behavior of emplace_vertex/emplace_edge/emplace_face/emplace_halfedge and erase_* (what they set/clear, free-list reuse ordering — does emplace reuse from the FRONT or BACK of the free list, and does the reused element get appended to the END of the main list?).
4. from_indexed_faces: how boundary faces are created, ordering of vertices/halfedges/faces.
5. Helper methods: Vertex::degree, Vertex::on_boundary, Vertex::normal, Edge::on_boundary, Edge::center, Edge::length, Face::center, Face::normal, Face::degree, Face::area — give exact formulas/definitions.
Return raw technical notes, no preamble.`,
  },
  {
    key: 'testharness',
    prompt: `Find and read the Scotty3D test framework under /workspace/tests (test.h, test.cpp, and whatever implements Test::differs and Test::CheckAllBits). Report precisely:
1. What Test::differs(mesh, after, flags) compares — exact algorithm. Does it compare by vertex position matching? By element ids? By ordering of the element lists? Does it canonicalize?
2. What each bit of Test::CheckAllBits means (CheckAllBits, and any other flags).
3. Whether corner_uv / corner_normal / bone_weights are compared, and with what tolerance.
4. How tests are registered and run: what is the command line to run a single test or a group of tests with the built Scotty3D binary (look for main.cpp / a --run-tests flag).
Return raw technical notes with exact code excerpts for the differs algorithm.`,
  },
  {
    key: 'globaltests',
    prompt: `Read /workspace/tests/a2/test.a2.g1.cpp, test.a2.g2.cpp, test.a2.g3.cpp, and test.a2.global.mix.cpp.
For each test, report: what operation is exercised, the input mesh (vertices + faces), the expected output mesh (vertices + faces), and any structural assertions.
Pay special attention to what catmark_subdivide_helper is expected to produce topologically: how boundary faces are handled, ordering of new vertices in the vertex list, and how face/edge/vertex positions map.
Return raw technical notes.`,
  },
  {
    key: 'localmixtests',
    prompt: `Read /workspace/tests/a2/test.a2.local.mix.cpp and /workspace/tests/a2/test.a2.lx1.cpp through test.a2.lx8.cpp (all 8).
For each, report: which Halfedge_Mesh API it exercises, and any expectations relevant to bisect_edge, split_edge, flip_edge, collapse_edge, extrude_face, extrude_positions.
Especially note test.a2.local.mix.cpp in full detail (it likely chains operations).
Return raw technical notes.`,
  },
  {
    key: 'a1tests',
    prompt: `Read /workspace/tests/a1/test.a1.task1.cpp and any other test under /workspace/tests/a1 that exercises Transform::local_to_world or Transform::world_to_local. Also read /workspace/src/scene/transform.h and /workspace/src/lib/mat4.h (or wherever Mat4 is defined).
Report: exactly what the transform tests assert, tolerances used, and whether the current implementation in /workspace/src/scene/transform.cpp (already written) satisfies them. Note the exact definition of Mat4::scale, Mat4::translate, Quat::to_mat, Quat::inverse.
Return raw technical notes.`,
  },
  {
    key: 'buildrun',
    prompt: `Inspect /workspace/Maekfile.js and /workspace/src/main.cpp (or equivalent entry point) plus /workspace/src/test.cpp if it exists.
Report:
1. The exact build command and where the output binary lands.
2. The exact command-line invocation to run tests, including how to filter by test-name prefix (e.g. running only "a2.l1" tests).
3. Whether tests are compiled into the main Scotty3D binary or a separate binary.
Do NOT run a full build (it is slow); just read the files. You may run '/workspace/Scotty3D --help' to see flags.
Return raw technical notes.`,
  },
  {
    key: 'existingops',
    prompt: `Look at the git history in /workspace ('git log --all --oneline', 'git show') and the /workspace/assignments directory. Report:
1. Any documentation in /workspace/assignments about A2 local/global operations (A2L1-L4, A2G1-G3) — summarize the exact specified semantics for flip_edge, split_edge, collapse_edge, extrude_face, extrude_positions, catmark_subdivide_helper, flip_orientation, set_corner_normals, set_corner_uvs_per_face.
2. Quote verbatim any spec text describing corner-case/rejection rules (e.g. when collapse_edge must return nullopt, when flip_edge must return nullopt).
Return raw technical notes with verbatim quotes where the spec is precise.`,
  },
]

phase('Survey')
const results = await parallel(TOPICS.map(t => () =>
  agent(t.prompt, { label: `read:${t.key}`, phase: 'Survey' }).then(r => ({ key: t.key, notes: r }))
))

return results.filter(Boolean)
