export const meta = {
  name: 'earcut-spec-recon',
  description: 'Reconstruct exact earcut (mapbox ear-clipping) semantics from algorithmic knowledge, enumerate version divergences, and produce one canonical implementation spec',
  phases: [
    { title: 'Recall', detail: 'parallel independent reconstruction of each subsystem' },
    { title: 'Synthesize', detail: 'merge into one canonical spec + ranked uncertainty list' },
  ],
}

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subsystem', 'functions', 'determinismNotes', 'uncertainties'],
  properties: {
    subsystem: { type: 'string' },
    functions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'signature', 'pseudocode', 'notes'],
        properties: {
          name: { type: 'string' },
          signature: { type: 'string' },
          pseudocode: { type: 'string', description: 'Exact line-by-line C++-like pseudocode. Preserve operator choices (>= vs >), traversal order, and short-circuit order exactly.' },
          notes: { type: 'string', description: 'Anything that affects output ordering or floating-point results' },
        },
      },
    },
    determinismNotes: { type: 'string' },
    uncertainties: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'alternatives', 'confidence'],
        properties: {
          what: { type: 'string' },
          alternatives: { type: 'string' },
          confidence: { type: 'string' },
        },
      },
    },
  },
}

const PREAMBLE = `You are reconstructing the precise semantics of the mapbox "earcut" polygon triangulation algorithm (the C++ header-only port, earcut.hpp, whose API is mapbox::earcut<N>(polygon) -> std::vector<N> of triangle vertex indices into the flattened concatenation of all rings; ring 0 is the outer ring, rings 1..k are holes).

The library source is NOT available on disk and you must NOT try to download it. Reconstruct from your knowledge of this well-known public algorithm. Do not search the local filesystem for it (it is absent). Do not use WebFetch/WebSearch.

CRITICAL: the goal is a byte-for-byte identical reimplementation, so the EXACT ORDER in which triangles are emitted matters, as do exact comparison operators (>= vs >), exact traversal directions, exact tie-breaks, and exact floating-point expression forms (do not algebraically rearrange - "(q.y-p.y)*(r.x-q.x) - (q.x-p.x)*(r.y-q.y)" must stay in that form).

Report pseudocode at the level of literal translatable statements.`

phase('Recall')

const AREAS = [
  {
    key: 'core-loop',
    prompt: `${PREAMBLE}

YOUR SUBSYSTEM: the main entry point and the ear-clipping loop.

Reconstruct exactly:
1. operator()(polygon) / the top-level earcut() driver: the "threshold = 80" heuristic deciding whether z-order hashing is enabled, how len is accumulated, the early-outs (empty polygon; outerNode null; outerNode->prev == outerNode->next), when eliminateHoles is called, how the bounding box minX/minY/maxX/maxY and inv_size are computed (including the exact formula inv_size = max(maxX-minX, maxY-minY); inv_size = inv_size != 0 ? 32767/inv_size : 0), and the final call to earcutLinked.
2. earcutLinked(ear, pass): loop condition, the exact order the three indices are pushed (prev->i, ear->i, next->i), the "skip next vertex" step (ear = next->next; stop = next->next), and the multi-pass fallback ladder: pass 0 -> filterPoints then pass 1; pass 1 -> cureLocalIntersections(filterPoints(ear)) then pass 2; pass 2 -> splitEarcut. Note where "break" happens.
3. isEar(ear) - including the triangle bbox fast-reject variant and the exact scan range (p = ear.next.next while p != ear.prev).
4. cureLocalIntersections(start) - exact emission order of the 3 indices and which nodes get removed and how p/start are reassigned.
5. splitEarcut(start) - the double loop over a and b, the isValidDiagonal test, splitPolygon, the two filterPoints(x, x->next) calls, and the two recursive earcutLinked calls, and that it returns immediately after the first split.

Also state precisely whether earcutLinked's recursion for pass 1 is "earcutLinked(filterPoints(ear), 1)".`,
  },
  {
    key: 'holes',
    prompt: `${PREAMBLE}

YOUR SUBSYSTEM: ring construction and hole elimination. This is the area with the MOST version-to-version divergence, so be exhaustive.

Reconstruct exactly:
1. linkedList(ring, clockwise): the signed-area sum loop (sum += (p2.x - p1.x) * (p1.y + p2.y) with j trailing i), the "if (clockwise == (sum > 0))" forward vs reverse insertion, index assignment (vertices + i), and the trailing "if (last && equals(last, last.next)) { removeNode(last); last = last.next; }".
2. eliminateHoles(polygon, outerNode): building the queue via linkedList(points[i], false), the "if (list == list.next) list.steiner = true" marker, getLeftmost, the std::sort by x (NOTE: std::sort is NOT stable - say so), and CRUCIALLY the per-hole loop body. There are at least two historical variants:
   (A) newer: outerNode = eliminateHole(queue[i], outerNode);   with eliminateHole returning a node
   (B) older: eliminateHole(queue[i], outerNode); outerNode = filterPoints(outerNode, outerNode->next);
   Describe BOTH precisely and say which versions used which.
3. eliminateHole(hole, outerNode): both variants. The newer one is roughly: bridge = findHoleBridge(hole, outerNode); if (!bridge) return outerNode; bridgeReverse = splitPolygon(bridge, hole); filterPoints(bridgeReverse, bridgeReverse->next); return filterPoints(bridge, bridge->next);  The older is: outerNode = findHoleBridge(hole, outerNode); if (outerNode) { b = splitPolygon(outerNode, hole); filterPoints(b, b->next); }
4. findHoleBridge(hole, outerNode): the leftward-ray scan (condition "hy <= p->y && hy >= p->next->y && p->next->y != p->y"), the x interpolation formula, "x <= hx && x > qx", m = p->x < p->next->x ? p : p->next, the "if (x == hx) return m" early return (present in newer versions only - flag it), then the second loop with tanMin, the pointInTriangle call with the (hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy) argument swap, the tan = abs(hy - p->y) / (hx - p->x) formula, and the tie-break "(tan < tanMin || (tan == tanMin && (p->x > m->x || sectorContainsSector(m, p))))" vs the older "(tan == tanMin && p->x > m->x)".
5. sectorContainsSector(m, p) and getLeftmost(start) - including getLeftmost's tie-break on y.
6. splitPolygon(a, b) - the exact relinking and what it returns (b2).`,
  },
  {
    key: 'predicates',
    prompt: `${PREAMBLE}

YOUR SUBSYSTEM: geometric predicates and list surgery.

Reconstruct exactly (operator-for-operator):
1. area(p, q, r)
2. equals(p1, p2)
3. pointInTriangle(ax, ay, bx, by, cx, cy, px, py) - the three cross products, their exact operand order, and whether the comparisons are >= 0. Note whether any version uses a different sign convention.
4. sign(val) and onSegment(p, q, r)
5. intersects(p1, q1, p2, q2) - the orientation-based version with o1..o4 and the four collinear onSegment cases. Also describe the OLDER variant that started with a special equals-endpoints check, and say which versions had which.
6. intersectsPolygon(a, b) - the guard "p->i != a->i && p->next->i != a->i && p->i != b->i && p->next->i != b->i".
7. locallyInside(a, b) - the reflex/convex branch with its exact >= vs < operators.
8. middleInside(a, b) - the ray-cast parity loop and its exact condition, including "p->next->y != p->y".
9. isValidDiagonal(a, b) - the full boolean expression including the "does not create opposite-facing sectors" clause (area(a->prev, a, b->prev) != 0 || area(a, b->prev, b) != 0) and the zero-length special case (equals(a,b) && area(a->prev,a,a->next) > 0 && area(b->prev,b,b->next) > 0). Describe older simpler variants too.
10. filterPoints(start, end) - the do/while with the "again" flag, the steiner guard, the "p = end = p->prev", the "if (p == p->next) break", and what it returns.
11. insertNode / removeNode - including the prevZ/nextZ unlinking in removeNode.`,
  },
  {
    key: 'zorder',
    prompt: `${PREAMBLE}

YOUR SUBSYSTEM: the z-order (Morton code) spatial hash used for large polygons.

Reconstruct exactly:
1. zOrder(x, y): the transform "int32_t x = (x_ - minX) * inv_size" (a C-style truncating cast toward zero), then the bit-interleave shifts/masks (0x00FF00FF, 0x0F0F0F0F, 0x33333333, 0x55555555) and the final "x | (y << 1)". State whether earcut.hpp uses inv_size (multiply) or size (divide), and the 32767 constant.
2. indexCurve(start): "p->z = p->z ? p->z : zOrder(p->x, p->y)", setting prevZ/nextZ from prev/next, then breaking the circle (p->prevZ->nextZ = null; p->prevZ = null) and calling sortLinked.
3. sortLinked(list): the exact bottom-up merge sort on the nextZ/prevZ chain (inSize doubling, pSize/qSize, the "p->z <= q->z" comparison for stability, tail wiring, numMerges <= 1 termination). This ordering is observable in output, so be precise.
4. isEarHashed(ear): the triangle bbox, minZ/maxZ from zOrder of the bbox corners, the simultaneous prevZ/nextZ walk "while (p && p->z >= minZ && n && n->z <= maxZ)", the per-candidate guards (bbox containment check present in newer versions; "p != ear->prev && p != ear->next"), then the two tail loops. Describe version differences in whether the bbox containment pre-check exists inside the loops.
5. Exactly when hashing is enabled and when indexCurve is called (only when pass == 0).`,
  },
  {
    key: 'versions',
    prompt: `${PREAMBLE}

YOUR SUBSYSTEM: version archaeology. Do NOT re-derive the whole algorithm; instead enumerate every OUTPUT-AFFECTING difference between releases of mapbox/earcut.hpp (and its JS parent mapbox/earcut), roughly v2.0.0 through v2.2.4 (and any later 3.x if it exists).

For each difference, report: which function, what changed, which versions have which behavior, and how it would show up in the emitted index sequence.

Known candidates to confirm or refute:
- eliminateHole returning a node and reassigning outerNode, vs the void form with a filterPoints(outerNode, outerNode->next) in the caller loop
- the "if (x == hx) return m" early return in findHoleBridge
- sectorContainsSector in the findHoleBridge tie-break
- the isValidDiagonal "opposite-facing sectors" clause and zero-length special case
- intersects(): orientation/sign form vs the older equals-endpoints-special-case form
- isEar/isEarHashed triangle-bbox fast rejects
- the threshold=80 hashing heuristic (was it always 80? was it ever based on a different metric?)
- zOrder using inv_size multiply vs size divide, and the 32767 vs 32767.0 constant
- whether filterPoints is called on the outer ring before earcutLinked
- any change in the order the three indices are pushed

Rank the differences by how likely they are to change the output for a polygon consisting of N heavily-overlapping axis-aligned squares (a pathological self-intersecting input that will exercise the cureLocalIntersections and splitEarcut fallback paths).

Return your answer using the same schema; put each difference in the functions array (name = function, pseudocode = the two variants side by side, notes = versions + observable impact).`,
  },
]

const recalls = await parallel(AREAS.map(a => () =>
  agent(a.prompt, { label: `recall:${a.key}`, phase: 'Recall', schema: SPEC_SCHEMA, effort: 'high' })
))

const good = recalls.filter(Boolean)
log(`${good.length}/${AREAS.length} subsystem reconstructions returned`)

phase('Synthesize')

const merged = await agent(
`${PREAMBLE}

Below are ${good.length} independent reconstructions of different subsystems of earcut, plus a version-archaeology report. Merge them into ONE canonical, self-consistent, literally-translatable specification targeting the MOST RECENT earcut.hpp (2.2.4-era) behavior.

Requirements for your output:
- Every function in one place, in dependency order, as literal pseudocode a Rust programmer can transcribe line by line.
- Where the independent reports DISAGREE, say so explicitly and pick the 2.2.4 behavior as primary, listing the alternative as a fallback to try.
- Produce a RANKED list of "uncertainty switches": each is a single localized behavioral choice (with variant A and variant B spelled out) that a differential test could flip if output does not match. Rank by likelihood of mattering for a pathological input of N heavily-overlapping axis-aligned squares where every ring after the first is treated as a hole.
- Call out every place where output ORDER depends on an implementation detail (unstable std::sort, pointer identity, traversal start node).

REPORTS:
${good.map((r, i) => `\n===== REPORT ${i + 1}: ${r.subsystem} =====\n${JSON.stringify(r, null, 1)}`).join('\n')}`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' }
)

return { merged, uncertainties: good.flatMap(r => r.uncertainties || []) }
