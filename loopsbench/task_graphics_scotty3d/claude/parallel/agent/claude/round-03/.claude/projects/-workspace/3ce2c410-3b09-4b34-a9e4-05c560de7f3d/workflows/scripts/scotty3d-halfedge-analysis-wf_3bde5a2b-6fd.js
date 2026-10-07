export const meta = {
  name: 'scotty3d-halfedge-analysis',
  description: 'Independent deep analyses + adversarial verification of Scotty3D halfedge op designs',
  phases: [
    { title: 'Analyze', detail: 'one agent per operation: derive exact spec + reference C++ from repo evidence' },
    { title: 'Critique', detail: 'adversarial reviewer hunts for invariant violations in each design' },
  ],
}

const COMMON = `
You are analyzing the Scotty3D codebase at /workspace (CMU 15-462 A2 halfedge mesh assignment).

ABSOLUTE RULE: You are READ-ONLY. Do NOT create, edit, write, or delete ANY file anywhere.
Do NOT run git commands that mutate state. Do NOT run the build. Only Read/Grep/Glob and
read-only bash (cat/grep/find/sed -n). Another agent is editing the source concurrently.

Key files to read:
- src/geometry/halfedge.h (element defs, invariants, API docs)
- src/geometry/halfedge-utility.cpp (interpolate_data, emplace_*/erase_*, validate(), Face/Vertex/Edge helpers, from_indexed_faces)
- src/geometry/halfedge-local.cpp (add_face example; stubs)
- src/geometry/halfedge-global.cpp (stubs)
- tests/a2/*.cpp (exact expected behavior)
- src/test.cpp (Test::differs for Halfedge_Mesh -- position/topology isomorphism)
- assignments/A2.md and assignments/A2/*.md (task specs)

The mesh invariants enforced by validate() are the ground truth for "valid mesh":
edge cycle exactly 2 halfedges; face cycle >= 3; vertex cycle >= 2; vertex has >=1
non-boundary face and <= 1 boundary face; edge has >= 1 non-boundary face; faces are
simple (no repeated vertex or edge); all data finite. Local ops must NOT call validate()
(complexity rules) -- they must pre-check instead.
`

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'code', 'edge_cases', 'evidence', 'risks'],
  properties: {
    summary: { type: 'string', description: 'Algorithm in prose, 10-30 lines' },
    code: { type: 'string', description: 'Complete compilable C++ implementation body/bodies, matching existing signatures exactly, tab-indented like the repo' },
    edge_cases: { type: 'array', items: { type: 'string' }, description: 'Each edge case and how the code handles it (accept with what topology, or reject with nullopt)' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'Concrete citations: file:line or test expectations that pin down the required behavior' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Places where the intended reference behavior is genuinely ambiguous, with the alternatives' },
  },
}

const TASKS = [
  {
    key: 'collapse_edge',
    prompt: `${COMMON}

TASK: Derive the complete, correct implementation of
  std::optional<Halfedge_Mesh::VertexRef> Halfedge_Mesh::collapse_edge(EdgeRef e)
in src/geometry/halfedge-local.cpp, for GENERAL POLYGON faces (not just triangles), including boundary handling.

Study tests/a2/test.a2.l3.cpp closely and derive the exact expected topology for both cases
(quad-quad interior collapse; and the boundary case where an adjacent triangle degenerates and disappears).
Also tests/a2/test.a2.local.mix.cpp fuzzes collapse on a closed sphere and validates after every op,
so your pre-checks must be sufficient to never produce an invalid mesh.

Deliver:
1. The exhaustive list of pre-conditions under which collapse MUST be rejected (return nullopt),
   each justified against a specific validate() rule. Think hard about: the link condition
   (common neighbours of the two endpoints that are not the apex of a triangle adjacent to e),
   both endpoints on the boundary while e is interior, degenerating faces of degree 3 (become
   2-gons -> must be removed by merging their two remaining edges), degree-2 endpoints,
   the "figure 8" case from assignments/A2.md, a lone triangle mesh, a tetrahedron,
   a face that touches BOTH endpoints twice, two triangles sharing two edges, and the case
   where a degenerating 2-gon's two surviving halfedges are twins of each other.
2. Exact rewiring order that keeps every pointer class consistent (twin/next/vertex/edge/face,
   plus vertex->halfedge, edge->halfedge, face->halfedge fixups) and the exact set of erased elements.
3. interpolate_data usage for the merged vertex (bone weights) and for merged corners (uv/normal).
4. Full C++ code.`,
  },
  {
    key: 'catmark_subdivide_helper',
    prompt: `${COMMON}

TASK: Derive the complete implementation of
  void Halfedge_Mesh::catmark_subdivide_helper(vertex_positions, edge_vertex_positions, face_vertex_positions)
in src/geometry/halfedge-global.cpp. This is a PROVIDED (non-student) function in upstream Scotty3D
that was deleted from this workspace; reconstruct equivalent behavior.

It must: insert a vertex in every edge, insert a vertex in every non-boundary face, split every
non-boundary face of degree N into N quads around the face vertex, leave boundary loops as single
(now double-length) boundary faces, and set all positions from the three maps.

Pin the required element counts from tests/a2/test.a2.g2.cpp and test.a2.g3.cpp:
  new #verts = V + E + (F - n_boundaries); new #edges = 2E + sum_{non-boundary f} deg(f);
  new #faces = F + sum_{non-boundary f} (deg(f) - 1); every non-boundary face has degree 4.
Verify your algorithm reproduces those counts exactly (note the ORIGINAL face object is reused as
one of the quads, which is why it is deg(f)-1 new faces, and boundary faces are preserved).
Also derive the expected topology of the square and quad-cube examples in those tests and check
your algorithm against at least the single-square-with-boundary case by hand, step by step.

Consider whether to build the new topology by calling the local ops (bisect_edge etc.) or directly;
prefer a self-contained direct construction that does not depend on student code. Beware of iterating
over element lists while inserting into them (std::list iterators stay valid, but you must snapshot
the original ranges). Handle missing map entries gracefully with geometric fallbacks
(vertex keeps position / edge midpoint / face centroid).
Use interpolate_data for every newly created vertex and halfedge so uv/normal/bone data propagate.

Deliver a complete C++ implementation plus your hand-verification of the counts.`,
  },
  {
    key: 'global_mesh_utilities',
    prompt: `${COMMON}

TASK: Derive complete implementations of these three PROVIDED (non-student) functions in
src/geometry/halfedge-global.cpp:
  void Halfedge_Mesh::flip_orientation()
  void Halfedge_Mesh::set_corner_normals(float threshold)
  void Halfedge_Mesh::set_corner_uvs_per_face()

Evidence to mine:
- halfedge.h documents flip_orientation as changing ONLY Halfedge::next, Halfedge::vertex and
  Vertex::halfedge (no elements created/erased) -- derive the exact algorithm including how
  Vertex::halfedge must be re-pointed, and whether boundary loops participate.
- halfedge.h documents set_corner_normals' three modes precisely (threshold >= 180 all smooth,
  0 < threshold < 180 sharp flag OR dihedral angle in degrees > threshold, threshold <= 0 all flat).
  Derive: how to walk a smoothing group around a corner using twin/next, why boundary edges must
  act as group boundaries, what to store on halfedges of boundary faces, and how faces should be
  weighted in the average. Note Halfedge_Mesh::cube() calls set_corner_normals(0.0f) with every edge
  sharp then set_corner_uvs_per_face() (halfedge-utility.cpp), and Vertex::normal() in
  halfedge-utility.cpp is area-weighted -- argue for the weighting most consistent with this codebase.
- set_corner_uvs_per_face: "assign UV coordinates by projecting each face vertex onto a tangent plane
  perpendicular to the face normal" (see the provided set_corner_uvs_project just below it for style).
  Decide the tangent frame construction (must be deterministic and well-defined for any normal,
  including axis-aligned ones), the projection origin, and any normalization. Check what
  Halfedge_Mesh::cube() would produce and whether that is sane for texturing a cube
  (look for how corner_uv is consumed: src/geometry/indexed.cpp, src/scene/*, src/pathtracer/*).

Deliver complete C++ for all three, and be explicit in 'risks' about any place where the upstream
reference could plausibly differ from your choice.`,
  },
  {
    key: 'extrude_face',
    prompt: `${COMMON}

TASK: Derive complete implementations of
  std::optional<Halfedge_Mesh::FaceRef> Halfedge_Mesh::extrude_face(FaceRef f)
  void Halfedge_Mesh::extrude_positions(FaceRef face, Vec3 move, float shrink)
in src/geometry/halfedge-local.cpp.

tests/a2/test.a2.l4.cpp is extremely specific. Extract EVERY constraint it imposes, including:
- extrude_face must return the SAME FaceRef (and same id) it was given;
- exactly deg(f) new vertices, 2*deg(f) new edges, deg(f) new faces; all new faces are quads;
- the new vertices must be the LAST deg(f) entries of mesh.vertices (the test walks backwards from
  --mesh.vertices.end()) and must be created at the ORIGINAL vertex positions;
- then extrude_positions(face, move, shrink) must produce the exact 'after' meshes for
  shrink=0.5/move=0, shrink=-1/move=0, and shrink=0/move=(0,0,1).
Derive from the third test whether 'move' is added directly as a translation vector.
Derive from the first two the exact shrink formula (lerp toward which centroid?) and note that
extrude_positions receives NO start positions, so it must recover the original ring positions by mesh
navigation from the inset face -- state exactly which navigation path yields them given your
extrude_face wiring, and confirm it is stable under repeated calls (the GUI calls it repeatedly with
absolute, not incremental, parameters: see src/gui/model.cpp around line 219).
Also handle: boundary face input (should it be rejected?), and what happens when f is a boundary loop.
Explain interpolate_data usage for all new vertices and halfedges.

Deliver complete C++ for both functions.`,
  },
  {
    key: 'split_flip_bisect',
    prompt: `${COMMON}

TASK: Derive complete implementations of these three in src/geometry/halfedge-local.cpp:
  std::optional<Halfedge_Mesh::VertexRef> Halfedge_Mesh::bisect_edge(EdgeRef e)   // upstream PROVIDED example
  std::optional<Halfedge_Mesh::VertexRef> Halfedge_Mesh::split_edge(EdgeRef e)
  std::optional<Halfedge_Mesh::EdgeRef>  Halfedge_Mesh::flip_edge(EdgeRef e)

For bisect_edge: reconstruct the upstream provided example implementation (it is described in
assignments/A2.md as "We've provided an example with bisect_edge"; the file comment calls it
"an example for how to implement local operations" with numbered phases). Nail down which
halfedge/edge keeps which identity, what vm->halfedge is set to, whether the new edge inherits
Edge::sharp, and the exact interpolate_data calls.

For split_edge: derive the exact expected output topology of BOTH cases in tests/a2/test.a2.l2.cpp
(interior edge between a quad and a triangle; and a boundary edge of a quad) and state the general
rule for which vertex the new diagonal connects to ("the vertex ccw from the ccw-most end of e within
the face"), how boundary faces are skipped, which face object is reused vs newly created, and what
vertex->halfedge must be on return ("should lie along e").

For flip_edge: derive the exact rewiring for general polygons from tests/a2/test.a2.l1.cpp, and
enumerate every case where the flip must be REJECTED (boundary edge; the single edge case A2.md hints
at; endpoint of degree 2; the flip making a face non-simple by repeating a vertex or edge; a==b
self-loop) -- each justified against a validate() rule. No elements may be created or erased, and the
same EdgeRef must be returned.

Deliver complete C++ for all three.`,
  },
]

phase('Analyze')
const results = await pipeline(
  TASKS,
  t => agent(t.prompt, { label: `spec:${t.key}`, phase: 'Analyze', schema: SPEC_SCHEMA }),
  (spec, t) => {
    if (!spec) return null
    return agent(`${COMMON}

A colleague produced this design for ${t.key}. Your job is to REFUTE it: find concrete inputs
(specific small meshes) where this code produces an INVALID mesh (cite the exact validate() rule
broken), crashes, loops forever, leaks/orphans elements, mismatches the expectations in tests/a2/,
or wrongly rejects a case the tests require to succeed. Trace the code by hand on the actual test
meshes in tests/a2/. Default to reporting a problem if you are unsure; be specific and concrete.

DESIGN SUMMARY:
${spec.summary}

CODE:
${spec.code}

CLAIMED EDGE CASES:
${(spec.edge_cases || []).join('\n')}
`, { label: `refute:${t.key}`, phase: 'Critique', effort: 'high', schema: {
        type: 'object', additionalProperties: false,
        required: ['problems', 'verdict'],
        properties: {
          problems: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['what', 'input', 'rule_broken', 'fix'], properties: {
            what: { type: 'string' }, input: { type: 'string' }, rule_broken: { type: 'string' }, fix: { type: 'string' },
          } } },
          verdict: { type: 'string', enum: ['sound', 'minor-issues', 'broken'] },
        },
      } }).then(cr => ({ key: t.key, spec, critique: cr }))
  },
)

return results.filter(Boolean)
