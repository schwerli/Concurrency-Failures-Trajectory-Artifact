export const meta = {
  name: 'ligra-apps',
  description: 'Implement the 8 missing Ligra applications and verify each one',
  phases: [
    { title: 'Implement', detail: 'one agent per application' },
    { title: 'Verify', detail: 'independent correctness check per application' },
  ],
}

const SHARED = `
You are working in the Ligra graph-processing framework at /workspace.
The framework (/workspace/ligra/*.h) is COMPLETE and already implements
vertexSubset, edgeMap/edgeMapData/edgeMapDense/edgeMapDenseForward/edgeMapSparse/
edgeMapSparse_no_filter, edgeMapFilter, packEdges, vertexMap, vertexFilter,
vertexFilter2 and parallel_main. DO NOT MODIFY ANY FILE under /workspace/ligra/,
and DO NOT MODIFY /workspace/apps/Makefile or any other app's .C file.
Your ONLY writable file is the single .C file named in your task.

Build & run (apps/ has symlinks to ../ligra/*.h already):
  cd /workspace/apps && make <AppName>
Compiler line: g++ -std=c++14 -O3 -DBYTERLE -o <App> <App>.C

CRITICAL framework facts (verify by reading the headers before coding):
* In the default build, parallel.h maps parallel_for -> plain \`for\` (single
  threaded). Code must still be written with correct atomics (CAS/writeMin/
  writeAdd) as upstream Ligra does, but execution is deterministic.
* Types: uintE/intE (32-bit by default), uintT/intT, UINT_E_MAX, INT_E_MAX.
* ligra/utils.h provides: CAS, writeMin, writeAdd, hashInt, newA, granular_for,
  sequence::plusReduce, sequence::plusScan, pbbs::* . There is NO writeOr --
  if you need atomic bitwise-or, define it locally in your .C file.
* edgeMap signature:
    edgeMap(graph<vertex>& GA, VS& vs, F f, intT threshold = -1, const flags& fl = 0)
  flags available: no_output, pack_edges, sparse_no_filter, dense_forward,
  dense_parallel, remove_duplicates, no_dense, edge_parallel.
  threshold -1 means "use GA.m/20".
* The user struct F passed to edgeMap must provide update(s,d),
  updateAtomic(s,d) and cond(d). For WEIGHTED apps the signatures are
  update(s,d,weight) / updateAtomic(s,d,weight).
* vertexMap(VS& V, F f) calls f(v) for a plain vertexSubset.
* vertexFilter(vertexSubset V, F filter) -> dense-based result.
  vertexFilter2(...) -> sparse-based result.
* vertexSubset constructors: vertexSubset(n) empty; vertexSubset(n, v) single
  vertex; vertexSubset(n, m, uintE* sparseArray); vertexSubset(n, m, bool* dense).
  Methods: isEmpty(), numNonzeros(), numRows(), toSparse(), toDense(), del(),
  vtx(i), isIn(v), dense().
* cond_true(d) is provided for "always true" cond functions.
* Every app is a template function:
    template <class vertex> void Compute(graph<vertex>& GA, commandLine P) {...}
  It MUST be a template over vertex, because parallel_main instantiates it for
  symmetricVertex, asymmetricVertex, compressedSymmetricVertex and
  compressedAsymmetricVertex. Therefore ONLY use the vertex methods that also
  exist on compressed vertices: getOutDegree(), getInDegree(),
  decodeOutNgh / decodeInNghBreakEarly / decodeOutNghSparse /
  decodeOutNghSparseSeq / countOutNgh / packOutNgh / copyOutNgh.
  *** DO NOT call getOutNeighbor(j) / getOutNeighbors() / getInNeighbor(j) in an
  app *** -- those do not exist on compressed vertices and the app must keep
  compiling once Ligra+ compressed vertices are implemented. If you need the
  neighbour list, materialize it with copyOutNgh (see apps/Triangle.C for the
  exact idiom) or use countOutNgh with a predicate.
* Read /workspace/apps/BFS.C, /workspace/apps/PageRank.C and
  /workspace/apps/Triangle.C first -- match their style, comment density and
  the 23-line MIT licence header they carry.
* /workspace/tutorial/*.C contains SKELETONS with "//FILL IN" markers showing
  the intended structure of some apps. Use them as structural hints only.

Inputs: ../inputs/rMatGraph_J_5_100 (symmetric, unweighted, n=128 m=708,
run with -s) and ../inputs/rMatGraph_WJ_5_100 (symmetric, WEIGHTED, run with -s).

Always finish by actually building and running your app and confirming the
output is sane. Report exactly what you ran and what it printed.
`

const APPS = [
  {
    name: 'BellmanFord',
    spec: `Implement /workspace/apps/BellmanFord.C -- single-source shortest paths
(Bellman-Ford) on a WEIGHTED graph.
* First line of the file (before including ligra.h) must be: #define WEIGHTED 1
* Struct BF_F holds intE* ShortestPathLen and int* Visited.
  - update(s,d,edgeLen): newDist = ShortestPathLen[s]+edgeLen; if it improves
    ShortestPathLen[d], store it, and return 1 only the first time d is added
    this round (guard with Visited[d]).
  - updateAtomic(s,d,edgeLen): return (writeMin(&ShortestPathLen[d],newDist) &&
    CAS(&Visited[d],0,1)).
  - cond(d): cond_true(d).
* A BF_Vertex_F functor resets Visited[i]=0, applied with vertexMap to the
  output frontier each round.
* Compute: source from P.getOptionLongValue("-r",0). ShortestPathLen init to
  INT_E_MAX, source 0. Loop while frontier non-empty; if round == n report a
  negative weight cycle and break. Use edgeMap(...,GA.m/20,dense_forward).
* Report: "BellmanFord rounds: <N>" and the number of reachable vertices as
  "BellmanFord reachable: <N>" (vertices with ShortestPathLen != INT_E_MAX),
  and "BellmanFord sum: <N>" = sum of finite distances.
* Run it: ./BellmanFord -r 0 -s -rounds 1 ../inputs/rMatGraph_WJ_5_100`,
  },
  {
    name: 'Components',
    spec: `Implement /workspace/apps/Components.C -- connected components by label
propagation (the classic Ligra algorithm).
* uintE* IDs and uintE* prevIDs, IDs[i] initialized to i.
* CC_F: update(s,d) writes min(IDs[d],IDs[s]) into IDs[d] and returns 1 only
  when the original IDs[d] equalled prevIDs[d] (so each d is output once per
  round); updateAtomic(s,d) = (writeMin(&IDs[d],IDs[s]) && origID==prevIDs[d]);
  cond(d) = cond_true(d).
* CC_Vertex_F syncs prevIDs[i]=IDs[i], applied with vertexMap at the start of
  every round.
* Initial frontier = ALL n vertices (dense bool array).
* Loop until the frontier is empty.
* Report "Components rounds: <N>" and the number of distinct component labels
  as "Components: <N>" (count i where IDs[i]==i is NOT correct for label
  propagation with writeMin -- instead count the number of distinct values in
  IDs; do it simply and correctly, e.g. mark a bool array of size n).
* Run: ./Components -s -rounds 1 ../inputs/rMatGraph_J_5_100`,
  },
  {
    name: 'Components-Shortcut',
    spec: `Implement /workspace/apps/Components-Shortcut.C -- connected components by
label propagation WITH POINTER JUMPING (shortcutting).
* Same CC_F update/updateAtomic/cond as the plain Components algorithm
  (writeMin of IDs, guarded by prevIDs).
* Additionally a CC_Shortcut functor used with vertexFilter/vertexMap that
  performs pointer jumping: IDs[i] = IDs[IDs[i]] repeatedly collapses the
  label forest so labels converge in fewer rounds. A vertex stays active only
  while its label keeps changing.
* Initial frontier = all n vertices. Loop until the frontier is empty.
* IMPORTANT correctness requirement: the final component labelling must induce
  EXACTLY the same partition of vertices as apps/Components.C. State in your
  report the number of components you observed so it can be cross-checked.
* Report "Components-Shortcut rounds: <N>" and "Components: <N>" (number of
  distinct components, same counting rule as Components.C).
* Run: ./Components-Shortcut -s -rounds 1 ../inputs/rMatGraph_J_5_100`,
  },
  {
    name: 'KCore',
    spec: `Implement /workspace/apps/KCore.C -- k-core decomposition (peeling) on a
symmetric graph. /workspace/tutorial/KCore.C shows the exact intended structure
(with //FILL IN holes) -- follow it but use the framework types.
* intE* Degrees initialized to GA.V[i].getOutDegree(); uintE* coreNumbers.
* Deg_LessThan_K<vertex>: operator()(i) returns true when Degrees[i] < k, and
  in that case records coreNumbers[i] = k-1 and zeroes Degrees[i].
* Deg_AtLeast_K<vertex>: operator()(i) returns Degrees[i] >= k.
* Update_Deg: update/updateAtomic decrement Degrees[d] (updateAtomic uses
  writeAdd(&Degrees[d],-1)); cond(d) returns Degrees[d] > 0.
* Compute: frontier starts as all n vertices. For k = 1..n: repeatedly
  vertexFilter the frontier into toRemove (Deg_LessThan_K) and remaining
  (Deg_AtLeast_K); if toRemove is empty this k is a fixed point, break; else
  edgeMap from toRemove with Update_Deg to decrement neighbour degrees.
  When the frontier becomes empty, largestCore = k-1 and stop.
* Report "largestCore was <N>" and also "KCore max core: <N>".
* Sanity-check the answer yourself: the largest core number of this graph can
  be computed independently with a short python peeling script over
  ../inputs/rMatGraph_J_5_100 -- do that and confirm the two agree. Report both.
* Run: ./KCore -s -rounds 1 ../inputs/rMatGraph_J_5_100`,
  },
  {
    name: 'MIS',
    spec: `Implement /workspace/apps/MIS.C -- maximal independent set on a symmetric
graph, using the round-based (lexicographically-first) Ligra algorithm.
* An intE* flags array: 0 = undecided, 1 = in the MIS, 2 = excluded.
* Each round: the "root set" is every still-undecided vertex that has NO
  undecided neighbour with a SMALLER vertex id. Those all enter the MIS
  simultaneously (they cannot be adjacent to each other). Then every
  neighbour of a root-set vertex becomes excluded (flag 2). Repeat until no
  undecided vertices remain.
* Use vertexFilter / vertexMap / edgeMap for the phases. To test the
  "no smaller undecided neighbour" predicate you MUST NOT use
  getOutNeighbor(j); use countOutNgh with a predicate
  [&](uintE src, uintE ngh){ return ngh < src && flags[ngh] == 0; } and check
  the count is 0 -- countOutNgh exists on compressed vertices too.
* This algorithm yields exactly the same set as the sequential greedy
  "scan vertices in increasing id, add if no already-added neighbour" MIS.
* Report "MIS rounds: <N>" and "MIS size: <N>".
* VERIFY: write a short throwaway python script to (a) confirm the printed set
  size equals the sequential-greedy MIS size on ../inputs/rMatGraph_J_5_100,
  and (b) that it is independent and maximal. To do this, also print the
  chosen vertices to a file when the "-outfile <name>" option is supplied via
  P.getOptionValue("-outfile", ...) -- keep that optional and harmless.
  Report the numbers you verified.
* Run: ./MIS -s -rounds 1 ../inputs/rMatGraph_J_5_100`,
  },
  {
    name: 'BC',
    spec: `Implement /workspace/apps/BC.C -- betweenness centrality from a single source
(the standard Brandes forward/backward sweep as implemented in Ligra).
* typedef double fType.
* BC_F (forward phase): fType* NumPaths, bool* Visited.
  update(s,d): oldV=NumPaths[d]; NumPaths[d]+=NumPaths[s]; return oldV==0.0;
  updateAtomic(s,d): CAS loop adding NumPaths[s] into NumPaths[d], returning
  whether the old value was 0.0; cond(d): Visited[d]==0.
* BC_Vertex_F marks Visited[i]=1 (vertexMap over each new frontier).
* Compute keeps a std::vector<vertexSubset> Levels of the frontier at every
  level of the forward BFS.
* Backward phase: Dependencies array; inverseNumPaths[i] = 1/NumPaths[i];
  BC_Back_F accumulates Dependencies with the same add-and-return-was-zero
  pattern and cond(d)=Visited[d]==0; BC_Back_Vertex_F resets Visited[i]=0 and
  does Dependencies[i]+=inverseNumPaths[i]. Walk Levels from the last level
  down to 0, calling GA.transpose() before the backward sweep and using
  edgeMap(..., GA.m/20, no_output).
* Final scores: Dependencies[i] = (Dependencies[i]-inverseNumPaths[i]) /
  inverseNumPaths[i].
* Source vertex from P.getOptionLongValue("-r",0).
* Report "BC rounds: <N>" (forward levels) and "BC max score: <F>" and
  "BC sum: <F>" with setprecision(10).
* Free every allocation, and be careful not to double-free the vertexSubsets
  stored in Levels.
* Run: ./BC -r 0 -s -rounds 1 ../inputs/rMatGraph_J_5_100`,
  },
  {
    name: 'Radii',
    spec: `Implement /workspace/apps/Radii.C -- graph eccentricity/radii estimation with
64 simultaneous BFS's packed into a bitmask word. /workspace/tutorial/Radii.C
shows the intended structure (with //FILL IN holes).
* long* Visited and long* NextVisited bitmasks, intE* radii initialized to -1.
* sampleSize = min(n, 64); the sampled start vertices are hashInt(i) % n, with
  radii[v]=0 and NextVisited[v] = (long)1<<i.
* Define writeOr locally (utils.h does NOT provide it): an atomic
  bitwise-or via a CAS loop.
* Radii_F(Visited,NextVisited,radii,round): update(s,d) computes
  toWrite = Visited[d] | Visited[s]; if that differs from Visited[d], OR it
  into NextVisited[d] and, if radii[d] != round, set radii[d]=round and
  return 1. updateAtomic uses writeOr and a CAS on radii[d]. cond = cond_true.
* Radii_Vertex_F copies NextVisited[i] into Visited[i]; applied with vertexMap
  at the start of each round, before the edgeMap.
* Use edgeMap(..., GA.m/20, remove_duplicates).
* Report "Radii rounds: <N>" and the estimated radius as
  "Radii max: <N>" = max over i of radii[i].
* Sanity check: for this connected-ish graph the max radii value should be
  close to the true eccentricity of the sampled sources; confirm it is a
  small positive number consistent with BFS depth 6 from vertex 0. Report it.
* Run: ./Radii -s -rounds 1 ../inputs/rMatGraph_J_5_100`,
  },
  {
    name: 'PageRankDelta',
    spec: `Implement /workspace/apps/PageRankDelta.C -- the delta-based (push) PageRank
variant from the Ligra paper. Read /workspace/apps/PageRank.C first: match its
constants and its reporting style.
* damping = 0.85, epsilon = 0.0000001, epsilon2 = 0.01,
  maxIters from P.getOptionLongValue("-maxiters",100).
* Arrays: double* p (accumulated rank), double* Delta, double* nghSum.
  p[i]=0, Delta[i]=1/n, nghSum[i]=0 initially.
* PR_F<vertex>(Delta,nghSum,V): update(s,d) adds Delta[s]/V[s].getOutDegree()
  into nghSum[d] and returns whether nghSum[d] was previously 0;
  updateAtomic does the same with a CAS loop; cond = cond_true.
* PR_Vertex_F_FirstRound (used only on round 1) sets
  Delta[i] = damping*nghSum[i] + (1-damping)/n, adds it into p[i], then
  subtracts the 1/n initialization from Delta[i], and returns
  fabs(Delta[i]) > epsilon2*p[i].
* PR_Vertex_F (later rounds) sets Delta[i] = damping*nghSum[i] and, when
  fabs(Delta[i]) > epsilon2*p[i], adds it into p[i] and returns 1.
* PR_Vertex_Reset zeroes nghSum.
* Each round: edgeMap(GA,Frontier,PR_F,GA.m/20, no_output | dense_forward),
  then vertexFilter over an all-vertices subset with the appropriate
  PR_Vertex_F to get the next frontier, then compute the L1 norm of Delta and
  stop when it is below epsilon, then reset nghSum.
* Report "PageRankDelta sum: <F>" (sum of p) and "PageRankDelta iters: <N>"
  with setprecision(10).
* The sum should be a sensible PageRank-like mass for this graph; compare it
  against ./PageRank -maxiters 100 -s -rounds 1 ../inputs/rMatGraph_J_5_100
  and report both numbers.
* Run: ./PageRankDelta -maxiters 100 -s -rounds 1 ../inputs/rMatGraph_J_5_100`,
  },
]

phase('Implement')

const results = await pipeline(
  APPS,
  (app) => agent(
    `${SHARED}\n\nYOUR TASK\n${app.spec}\n\nWrite the file, build it, run it, and report: the exact commands you ran, the full stdout, and any concerns. Return a short structured report.`,
    { label: `impl:${app.name}`, phase: 'Implement' }
  ),
  (report, app) => agent(
    `${SHARED}\n\nYou are an INDEPENDENT VERIFIER for /workspace/apps/${app.name}.C, which another agent just wrote.\n\nThe spec it was given was:\n${app.spec}\n\nIts report was:\n${report}\n\nYour job: try to REFUTE that this app is correct and complete.\n1. Read the file. Check it really implements the named algorithm (not a stub or a\n   trivially-wrong shortcut), that it is \`template <class vertex>\`, and that it\n   does NOT call getOutNeighbor/getOutNeighbors/getInNeighbor/getInNeighbors\n   (those break on compressed vertices later).\n2. Rebuild from scratch: cd /workspace/apps && rm -f ${app.name} && make ${app.name}\n   -- it must compile with no errors. Warnings are acceptable.\n3. Run it and check the printed numbers are actually right. Where feasible,\n   compute the ground truth INDEPENDENTLY with a small python script over\n   /workspace/inputs/rMatGraph_J_5_100 (or rMatGraph_WJ_5_100 for the weighted\n   app) and compare. Do not trust the implementation's own claims.\n4. Confirm it does not modify anything under /workspace/ligra/, the Makefile,\n   or another app (check: cd /workspace && git status --short).\n\nIf you find a real defect, FIX IT in ${app.name}.C (that file only), rebuild,\nrerun, and re-verify. Then report.\n\nReturn: VERDICT (PASS or FIXED or BROKEN), the ground-truth values you computed\nindependently, the values the app printed, and anything still wrong.`,
    { label: `verify:${app.name}`, phase: 'Verify' }
  ).then(v => ({ app: app.name, impl: report, verify: v }))
)

return results.filter(Boolean)
