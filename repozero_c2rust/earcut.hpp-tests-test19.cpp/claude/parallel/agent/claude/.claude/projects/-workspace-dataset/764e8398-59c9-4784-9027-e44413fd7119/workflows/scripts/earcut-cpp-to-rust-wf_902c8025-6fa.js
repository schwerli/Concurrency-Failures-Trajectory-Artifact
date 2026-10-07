export const meta = {
  name: 'earcut-cpp-to-rust',
  description: 'Reconstruct mapbox earcut.hpp semantics, then build + differentially validate competing pure-Rust ports',
  phases: [
    { title: 'Recall', detail: '4 independent reconstructions of earcut.hpp internals' },
    { title: 'Spec', detail: 'merge into one authoritative algorithm spec' },
    { title: 'Build', detail: '3 competing Rust ports, each iterated against the real C++ binary' },
  ],
}

const COMMON = `
CONTEXT — the migration task:
A C++ program /workspace/dataset/test19.cpp uses the header-only library mapbox/earcut.hpp:

    #include <iostream>
    #include <vector>
    #include <array>
    #include "../earcut.hpp"

    int main(int argc, char* argv[]) {
        int n = 19;
        if (argc > 1) { n = std::atoi(argv[1]); }
        std::vector<std::vector<std::array<double, 2>>> polygon;
        std::vector<std::array<double, 2>> fractal;
        for (int i = 0; i < n * 2; i++) {
            double t = double(i) / (n * 2);
            double x = t * 3.0;
            double y = std::sin(t * 10.0) * std::exp(-t) * 2.0 + 1.0;
            fractal.push_back({x, y});
        }
        fractal.push_back({3.0, 0.0});
        fractal.push_back({0.0, 0.0});
        polygon.push_back(fractal);
        auto indices = mapbox::earcut<uint32_t>(polygon);
        for (auto idx : indices) { std::cout << idx << " "; }
        return 0;
    }

The earcut.hpp source is NOT present on this machine and must NOT be fetched. Reconstruct from knowledge.
The compiled C++ binary IS available at /workspace/dataset/test19_executable and may be run freely with any argument.
Ground-truth outputs for n = 0..120 plus 150,200,250,300,400,500,800,1000,1500,2000 are in /tmp/gt/n<N>.txt.
Output format: each index followed by a single space; trailing space present; NO trailing newline.
The polygon here is a single ring (no holes) of 2n+2 vertices, and it is heavily SELF-INTERSECTING,
so the exact output depends on earcut's failure-recovery paths (cureLocalIntersections / splitEarcut),
not just the happy path. Total vertex count 2n+2 crosses earcut's 80-point z-order-hashing threshold at n>=40,
so both the hashed and non-hashed ear tests matter.
`

phase('Recall')

const LENSES = [
  {
    key: 'toplevel',
    prompt: `Reconstruct, as faithfully and completely as you can, these parts of mapbox/earcut.hpp (C++ header-only, the modern version used by mapbox-gl-native, i.e. the port of earcut.js v2.2.x):

1. \`mapbox::earcut<N>(const Polygon&)\` free function and \`detail::Earcut<N>::operator()(const Polygon& points)\` — the FULL body, including:
   - the \`int threshold = 80;\` loop that sums ring sizes, and exactly how \`hashing = threshold < 0\` is derived,
   - node-pool reservation, \`indices.reserve\`,
   - \`linkedList(points[0], true)\`, the \`if (!outerNode || outerNode->prev == outerNode->next) return;\` guard,
   - \`eliminateHoles\` call condition,
   - the bbox scan and \`inv_size = maxX-minX vs maxY-minY\` computation (exact expression, including the \`32767.\` constant and the zero guard),
   - the final \`earcutLinked(outerNode)\` / \`earcutLinked(outerNode, 0)\` call signature.
2. \`linkedList(const Ring& points, const bool clockwise)\` — including the signed-area sum used to decide winding, whether it uses \`area\`-style shoelace over the ring, and the direction in which nodes are inserted; and the trailing \`if (last && equals(last, last->next)) { removeNode(last); last = last->next; }\`.
3. \`filterPoints(Node* start, Node* end)\`.
4. \`insertNode\`, \`removeNode\` (including prevZ/nextZ unlinking), the \`Node\` struct fields, and the node allocator.
5. The small geometry helpers: \`area(p,q,r)\`, \`equals(p1,p2)\`, \`sign(double)\`, \`pointInTriangle(...)\` — exact formulas and comparison operators (>=, >, etc.), since sign conventions change the output.

Write real C++ (or extremely precise pseudocode) with every comparison operator and floating-point expression exactly as you believe the header has it. Where you are unsure between two variants, say so explicitly and give BOTH variants labelled "VARIANT A / VARIANT B". Do not hedge silently.

Return the reconstruction as your final message (it is consumed by another agent, not a human).` },
  {
    key: 'earloop',
    prompt: `Reconstruct, as faithfully and completely as you can, the EAR-CUTTING CORE of mapbox/earcut.hpp (C++ header-only port of earcut.js v2.2.x):

1. \`earcutLinked(Node* ear, int pass = 0)\` — the FULL body: the \`if (!ear) return;\` guard, the \`if (!pass && hashing) indexCurve(ear);\` line, the main \`while (ear->prev != ear->next)\` loop, the \`stop\` pointer, the \`hashing && !invSizeIsZero ? isEarHashed(ear) : isEar(ear)\` dispatch, the exact order of the three emitted indices (\`prev->i\`, \`ear->i\`, \`next->i\`), \`removeNode(ear)\`, the \`ear = next->next; stop = next->next;\` advance, and the else-branch \`ear = next;\` plus the \`if (ear == stop)\` failure cascade:
   - pass 0 -> \`earcutLinked(filterPoints(ear), 1)\`
   - pass 1 -> \`ear = cureLocalIntersections(filterPoints(ear)); earcutLinked(ear, 2);\`
   - pass 2 -> \`splitEarcut(ear);\`
   Give the exact arguments and exact recursion.
2. \`isEar(Node* ear)\` — full body including the \`area(a,b,c) >= 0\` reject, the iteration \`p = ear->next->next\` while \`p != ear->prev\`, the \`pointInTriangle(...) && area(p->prev, p, p->next) >= 0\` test.
3. \`isEarHashed(Node* ear)\` — full body including the min/max bbox of the triangle, \`zOrder(minTX, minTY)\` / \`zOrder(maxTX, maxTY)\` bounds, the two-directional walk over the z-order list (\`p = ear->prevZ\`, \`n = ear->nextZ\`), the \`p != ear->prev && p != ear->next\` skips, and the exact loop structure — note that different earcut versions use either a single interleaved loop or two separate loops; state which and give the alternative.
4. \`pointInTriangle\` exact expression.

Write real C++ with every comparison operator exactly as you believe it is. Where unsure between variants, give BOTH labelled "VARIANT A / VARIANT B".

Return the reconstruction as your final message (consumed by another agent).` },
  {
    key: 'zorder',
    prompt: `Reconstruct, as faithfully and completely as you can, the Z-ORDER / HASHING machinery of mapbox/earcut.hpp (C++ port of earcut.js v2.2.x):

1. \`indexCurve(Node* start)\` — full body, including setting \`p->z = p->z ? p->z : zOrder(p->x, p->y)\` (or \`if (p->z == 0) p->z = zOrder(...)\`; state which), linking prevZ/nextZ, the \`p->prevZ->nextZ = nullptr\` break, and the \`sortLinked(p)\` call.
2. \`sortLinked(Node* list)\` — the FULL iterative bottom-up merge sort on the nextZ/prevZ list: inSize doubling, numMerges, pSize/qSize, the tie-break comparison (\`p->z <= q->z\`), tail linking, and the terminating \`while (numMerges > 1)\`.
3. \`zOrder(const double x_, const double y_)\` — the exact integer conversion. In the C++ header this is something like:
       int32_t x = static_cast<int32_t>((x_ - minX) * inv_size);
       int32_t y = static_cast<int32_t>((y_ - minY) * inv_size);
   followed by the standard bit-interleaving magic (0x00FF00FF / 0x0F0F0F0F / 0x33333333 / 0x55555555 shifts by 8,4,2,1) and \`return x | (y << 1);\`.
   Give the EXACT sequence of shifts and masks, and state the integer type used at each step (int32_t vs uint32_t matters). Note that some earcut versions instead use \`(x_ - minX) * inv_size\` where inv_size = 32767/size, and older ones use \`32767 * (x - minX) / size\`. State which the modern C++ header uses and give alternatives.
4. How \`removeNode\` maintains prevZ/nextZ, and whether \`z\` is reset anywhere.
5. Whether the hashed path is guarded by \`inv_size != 0\` and where.

Write real C++ with exact operators/casts. Where unsure, give BOTH variants labelled "VARIANT A / VARIANT B".

Return the reconstruction as your final message (consumed by another agent).` },
  {
    key: 'repair',
    prompt: `Reconstruct, as faithfully and completely as you can, the FAILURE-RECOVERY and HOLE machinery of mapbox/earcut.hpp (C++ port of earcut.js v2.2.x). This is the part that matters most for SELF-INTERSECTING polygons:

1. \`cureLocalIntersections(Node* start)\` — full body: the \`do { a = p->prev; b = p->next->next; if (!equals(a,b) && intersects(a, p, p->next, b) && locallyInside(a,b) && locallyInside(b,a)) { indices.emplace_back(a->i); indices.emplace_back(p->i); indices.emplace_back(b->i); removeNode(p); removeNode(p->next); p = start = b; } p = p->next; } while (p != start);\` and the \`return filterPoints(p);\` at the end. Give exact index emission order.
2. \`splitEarcut(Node* start)\` — full body: the nested do/while over \`a\` and \`b = a->next->next\`, the \`isValidDiagonal(a, b)\` test, \`splitPolygon(a, b)\`, \`filterPoints(a, a->next)\` and \`filterPoints(c, c->next)\`, then \`earcutLinked(a)\` and \`earcutLinked(c)\` and the \`return\`.
3. \`isValidDiagonal(Node* a, Node* b)\` — the modern version:
       return a->next->i != b->i && a->prev->i != b->i && !intersectsPolygon(a, b) &&
              ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
                (area(a->prev, a, b->prev) != 0 || area(a, b->prev, b) != 0)) ||
               (equals(a, b) && area(a->prev, a, a->next) > 0 && area(b->prev, b, b->next) > 0));
   Confirm or correct, and give the older simpler variant as an alternative.
4. \`intersects(p1,q1,p2,q2)\` — including the \`sign()\`-based version with \`onSegment\` special cases, and the earlier simpler version. State which the modern header uses.
5. \`intersectsPolygon(a,b)\`, \`locallyInside(a,b)\`, \`middleInside(a,b)\`, \`onSegment\`, \`sign\`, \`sectorContainsSector\`.
6. \`splitPolygon(Node* a, Node* b)\` — exact node creation order and relinking.
7. \`eliminateHoles\`, \`eliminateHole\`, \`findHoleBridge\`, \`compareX\` / the hole sort — briefly, since this test has no holes, but note whether eliminateHole calls \`filterPoints\` / \`splitPolygon\`.

Write real C++ with exact operators. Where unsure between variants, give BOTH labelled "VARIANT A / VARIANT B".

Return the reconstruction as your final message (consumed by another agent).` },
]

const recalls = await parallel(LENSES.map(l => () =>
  agent(COMMON + '\n\n' + l.prompt, { label: `recall:${l.key}`, phase: 'Recall' })
))

const good = recalls.filter(Boolean)
log(`recall: ${good.length}/${LENSES.length} reconstructions returned`)

phase('Spec')

const spec = await agent(COMMON + `
Four agents independently reconstructed different parts of mapbox/earcut.hpp from memory. Their reconstructions follow.

Your job: merge them into ONE authoritative, self-consistent C++-level specification of the whole header, written so a Rust engineer can port it line by line without further guessing.

Requirements for your output document:
- Cover: Node struct, allocator, operator(), linkedList, filterPoints, earcutLinked, isEar, isEarHashed, pointInTriangle, cureLocalIntersections, splitEarcut, eliminateHoles/eliminateHole/findHoleBridge/sectorContainsSector, splitPolygon, insertNode, removeNode, indexCurve, sortLinked, zOrder, area, equals, sign, intersects, intersectsPolygon, locallyInside, middleInside, onSegment, isValidDiagonal, getLeftmost, compareX.
- Every comparison operator, cast, and floating-point expression must be explicit.
- Where the reconstructions DISAGREE, keep a clearly-marked "AMBIGUITY" note listing each variant and a suggested empirical discriminator (what kind of input would distinguish them). Do NOT silently pick one.
- Add an explicit "PORTING PITFALLS FOR RUST" section: integer types (int32_t wraparound in zOrder, uint32_t indices), NaN/-0.0 behaviour, the fact that C++ \`static_cast<int32_t>\` truncates toward zero, iteration-order sensitivity, and the fact that node identity (pointer equality) is used for loop termination so a Rust port needs arena indices, not Rc/RefCell clones.

Write the merged spec to /tmp/spec/earcut_spec.md (create the directory). Then return a SHORT confirmation (under 200 words) naming the file and listing the ambiguities you flagged. Do not paste the spec into your reply.

===== RECONSTRUCTION 1 (top-level) =====
${recalls[0] || '(missing)'}

===== RECONSTRUCTION 2 (ear loop) =====
${recalls[1] || '(missing)'}

===== RECONSTRUCTION 3 (z-order) =====
${recalls[2] || '(missing)'}

===== RECONSTRUCTION 4 (repair/holes) =====
${recalls[3] || '(missing)'}
`, { label: 'synthesize-spec', phase: 'Spec', effort: 'high' })

log('spec written: ' + String(spec).slice(0, 200))

phase('Build')

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dir: { type: 'string', description: 'candidate directory' },
    binary: { type: 'string', description: 'absolute path to built candidate binary' },
    pass: { type: 'integer' },
    fail: { type: 'integer' },
    failingNs: { type: 'array', items: { type: 'integer' }, description: 'n values still mismatching (empty if all pass)' },
    notes: { type: 'string', description: 'what resolved the ambiguities; remaining risks; <400 words' },
  },
  required: ['dir', 'binary', 'pass', 'fail', 'failingNs', 'notes'],
}

const CANDS = [
  { dir: '/tmp/cand1', angle: 'Port the algorithm as a flat arena of Node structs in a Vec<Node> with usize indices and explicit prev/next/prevZ/nextZ index fields, mirroring the C++ pointer code as literally as possible (a near-transliteration). Favour literal fidelity over Rust idiom.' },
  { dir: '/tmp/cand2', angle: 'Port it with a raw-index arena too, but derive the ambiguous details EMPIRICALLY: for each AMBIGUITY in the spec, construct a discriminating n value, run the C++ binary, and let the observed output decide. Document each resolution.' },
  { dir: '/tmp/cand3', angle: 'Port it independently from your own knowledge of earcut.js v2.2.4 (the JS reference implementation that earcut.hpp tracks), using the spec only as a cross-check. Translate the JS line by line into Rust with an index arena, then reconcile any C++-specific differences (notably the int32_t zOrder and the 80-point threshold) against the binary.' },
]

const results = await parallel(CANDS.map((c, i) => () => agent(COMMON + `
An authoritative merged spec of earcut.hpp is at /tmp/spec/earcut_spec.md — READ IT FIRST. It contains AMBIGUITY notes where reconstructions disagreed; you must resolve those empirically against the real binary.

YOUR TASK: produce a standalone, working, dependency-free Rust implementation in ${c.dir} that reproduces /workspace/dataset/test19_executable EXACTLY.

APPROACH FOR THIS CANDIDATE: ${c.angle}

HARD RULES:
- Pure Rust 2021, std only, zero crates. rustc 1.75.0 is installed.
- Work ONLY inside ${c.dir} (mkdir -p it). Do NOT write anywhere else — other agents are working in parallel. In particular do NOT touch /output, /workspace, or /tmp/gt.
- CLI: one optional positional arg parsed with C \`atoi\` semantics (skip leading whitespace, optional +/- sign, consume digits, stop at first non-digit, empty/garbage -> 0; on overflow glibc strtol saturates to LONG_MAX/LONG_MIN and atoi truncates to int — verify against the binary with e.g. "999999999999999999999"). Default n = 19.
- Output: indices separated by, and terminated with, a single space; NO trailing newline. Must be byte-identical.
- Floating point must match bit-for-bit: use f64 throughout, \`(i as f64) / ((n*2) as f64)\`, \`t * 3.0\`, \`(t * 10.0).sin() * (-t).exp() * 2.0 + 1.0\`. Beware: Rust's f64::sin/exp are libm calls and should agree with C++ here, but VERIFY by comparing generated vertex coordinates if you see mismatches.
- Note \`n * 2\` is computed in C++ \`int\` arithmetic and can overflow for huge n; mirror with wrapping i32 arithmetic if the binary shows that behaviour.

VALIDATION LOOP (mandatory, iterate until clean):
  1. Build:  cd ${c.dir} && rustc -O -o ${c.dir}/cand main.rs   (or a cargo project; the binary must end up at ${c.dir}/cand)
  2. Test:   /tmp/difftest.sh ${c.dir}/cand
     This compares against all 131 ground-truth files in /tmp/gt (n = 0..120 plus 150,200,250,300,400,500,800,1000,1500,2000).
  3. If any FAIL: diff the index streams position by position to find the FIRST divergence, form a hypothesis about which spec ambiguity is wrong, change ONE thing, re-test. Use small failing n first — they are easiest to reason about. Add your own debug prints comparing against the binary as needed.
  4. Also spot-check extra n values not in /tmp/gt (e.g. 7, 41, 79, 137, 613, 3000) by running the binary live.
  Do not stop while FAIL > 0 unless you have genuinely exhausted your ideas; report honestly if so.

Keep iterating until \`PASS=131 FAIL=0\`. Then also confirm: no-arg invocation matches \`./test19_executable\`, and "abc"/""/"+3"/"3.9"/"007"/" 5"/"12abc"/"-5" all match.

Report your result via the structured schema. Be truthful about pass/fail counts — a false claim of success is worse than an honest failure.
`, { label: `build:${c.dir.split('/').pop()}`, phase: 'Build', schema: RESULT_SCHEMA, effort: 'high' })))

const done = results.filter(Boolean)
const winners = done.filter(r => r.fail === 0)
log(`build: ${winners.length}/${CANDS.length} candidates fully passing`)

return { candidates: done, winners: winners.map(w => w.binary) }
