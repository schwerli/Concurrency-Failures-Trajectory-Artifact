export const meta = {
  name: 'probe-test10-behavior',
  description: 'Exhaustively probe the test10 Python executable to spec out CLI + networkx behavior for a JS port',
  phases: [
    { title: 'Probe', detail: 'parallel black-box probes of the executable across dimensions' },
    { title: 'Corpus', detail: 'build golden differential-test corpus over all node-collapse shapes' },
    { title: 'Synthesize', detail: 'merge probe reports into one implementation spec' },
  ],
}

const EXE = '/workspace/dataset/test10_executable'

const COMMON = `
You are black-box probing a PyInstaller executable at ${EXE}. It was compiled from this Python source:

\`\`\`python
import argparse
import networkx as nx

parser = argparse.ArgumentParser()
parser.add_argument('--a', type=int, required=True)
parser.add_argument('--b', type=int, required=True)
parser.add_argument('--c', type=int, required=True)
parser.add_argument('--d', type=int, required=True)
parser.add_argument('--e', type=int, required=True)
args = parser.parse_args()

G = nx.Graph()
G.add_weighted_edges_from([(args.a, args.b, 1.0), (args.b, args.c, 2.0), (args.c, args.d, 3.0), (args.d, args.e, 4.0), (args.a, args.e, 5.0)])
print(G.number_of_edges())
print(G[args.a][args.b]['weight'])
mst = nx.minimum_spanning_tree(G)
print(mst.number_of_edges())
print(mst.has_edge(args.a, args.b))
print(nx.dijkstra_path_length(G, args.a, args.e))
print(nx.dijkstra_path(G, args.a, args.e))
print(list(nx.bfs_edges(G, args.a)))
print(list(nx.dfs_edges(G, args.a)))
print(nx.node_connectivity(G))
\`\`\`

Goal: a pure-JS (Node 18, ESM, zero deps) reimplementation must match stdout BYTE FOR BYTE, plus stderr/exit codes for CLI errors.
Run the executable directly (never 'python'). Each run takes ~2s, so batch runs with a shell loop and use 'xargs -P 8' for parallelism when doing many.
Write any scratch files under /workspace/tmp (mkdir -p first). Do NOT write anything to /output.
Report findings as precise, testable RULES an implementer can code from — include the exact observed bytes for anything surprising. Do not speculate without a run backing it.
`

phase('Probe')

const probes = [
  {
    label: 'probe:argparse',
    prompt: COMMON + `
YOUR DIMENSION: argparse CLI semantics. Determine exactly, with runs:
- exact --help / -h text (byte for byte, including blank lines and trailing newline) and exit code
- exact usage+error text and exit code for: missing one required arg, missing several (what order are they listed?), missing all, invalid int value, unrecognized option, unrecognized positional, option with no value, duplicate option (last wins?), '--a' immediately followed by another option
- precedence when MULTIPLE error kinds co-occur (e.g. missing required AND unrecognized extra AND invalid int) — which message wins? Test all pair/triple combos you can think of.
- prefix abbreviation: do '--h', '--he', '--hel' work? What about '-a', '-abc', '--aa'? Is there any abbreviation that is ambiguous, and what is that error text?
- the '--' end-of-options separator: '--a 1 -- --b 2 ...' etc.
- '=' form, '--a=-3', '--a= ' (empty value), whitespace-only value
- negative numbers as values ('--a -3'), and values that look like options
- interspersed/odd orderings, repeated '--', empty argv
- is stdout or stderr used for help vs errors? (test with 1>/dev/null and 2>/dev/null separately)
- what happens with args after a valid parse, e.g. trailing positional tokens
Return a rules list precise enough to reimplement argparse's behavior for THIS parser, with exact message templates.`,
  },
  {
    label: 'probe:int-parsing',
    prompt: COMMON + `
YOUR DIMENSION: Python int() coercion of the argument strings, and how node ids are printed back out.
Determine, with runs:
- leading/trailing whitespace (spaces, tabs, newlines, \\r, \\f, \\v, unicode spaces like U+00A0, U+2007, U+3000) — accepted or rejected?
- signs: '+5', '-5', '  -5', '--5', '+-5'
- underscores: '1_0', '_10', '10_', '1__0', '1_000_000'
- leading zeros: '007', '0', '-0', '000'
- non-decimal forms: '0x10', '0b11', '0o7', '1e5', '1.0', 'inf', 'nan', '' (empty string)
- unicode digits: Arabic-Indic '١٢', Devanagari '१२', fullwidth '１２', mixed scripts, and a unicode digit combined with underscores/sign
- huge integers well beyond 2^53 (e.g. 99999999999999999999, 2**64, a 40-digit number) and hugely negative — is the value printed back EXACTLY? (implies BigInt needed in JS)
- how are these values echoed in the printed lists/tuples (line 6,7,8) — any normalization (e.g. '007' -> 7)?
- exact error message bytes for each rejected form
Return: a precise spec for a JS int-parser (what to accept/reject, canonical output form), with the exact error text template.`,
  },
  {
    label: 'probe:graph-order',
    prompt: COMMON + `
YOUR DIMENSION: ordering and tie-breaking of the graph outputs (lines 6,7,8 especially).
The graph is built from 5 weighted edges (a,b,1.0),(b,c,2.0),(c,d,3.0),(d,e,4.0),(a,e,5.0). When argument values repeat, nodes/edges collapse: later duplicate edges OVERWRITE the weight, self-loops appear when the two endpoints are equal.
Determine, with runs, the exact rules for:
- node insertion order and per-node adjacency (neighbor) insertion order, and how they drive bfs_edges / dfs_edges output order. Design inputs that DISCRIMINATE between candidate rules (e.g. does a self-loop occupy a slot in the adjacency order? does an overwriting duplicate edge MOVE the neighbor to the end of the adjacency order or keep its original position?). That last question is critical — construct inputs where the two hypotheses give different bfs/dfs output and report which wins.
- dfs_edges: confirm it is an iterative DFS that RESUMES a parent's neighbor iterator where it left off (stateful iterator), not a restart-from-scratch. Find an input that distinguishes.
- bfs_edges: confirm level-order and the child order within a level.
- dijkstra_path tie-breaking when two distinct paths have EQUAL total weight (e.g. --a 1 --b 2 --c 3 --d 2 --e 5 gives a 5.0 vs 5.0 tie). Find several tie cases and determine the rule (first-found-wins with strict '<' relaxation? or last?). Also check a tie where the LONGER (more hops) path is discovered first.
- output formatting: exactly how ints, floats, bools, lists and tuples are rendered (e.g. '1.0', 'True', '[1, 5]', '[(1, 2), (1, 5)]', '[]'). When is line 5 printed as '0' (int) vs '0.0'/'5.0' (float)?
Return exact rules + the discriminating inputs and their outputs as evidence.`,
  },
  {
    label: 'probe:connectivity-mst',
    prompt: COMMON + `
YOUR DIMENSION: lines 1,2,3,4 and 9 — number_of_edges, edge weight lookup, minimum_spanning_tree, has_edge, and node_connectivity.
Determine, with runs:
- does a self-loop count as 1 edge in number_of_edges? Does it ever appear in the MST?
- MST edge count for every distinct graph shape you can produce (relate it to #nodes and #components; is the graph EVER disconnected given this fixed edge list? prove it by trying hard).
- mst.has_edge(a,b): when is it False? Are there weight TIES that could make the MST ambiguous (remember each surviving edge keeps the weight of the LAST tuple that wrote it)?
- node_connectivity: this is the subtle one. Hypothesis to test: networkx computes it as: if graph disconnected -> 0; else pick v = node of MINIMUM degree (ties -> first in node insertion order; a self-loop adds 2 to the degree), start K = deg(v), then K = min(K, local_node_connectivity(v,w)) for every w that is neither v nor a neighbor of v, then K = min(K, local_node_connectivity(x,y)) for every non-adjacent pair x,y of neighbors of v. local_node_connectivity = max number of internally node-disjoint paths (Menger / max-flow on the split-node digraph).
  Design inputs where this hypothesis DIFFERS from 'true vertex connectivity of the simple graph ignoring self-loops', especially using self-loops to inflate a degree, and report which matches. Enumerate the collapse shapes: single node with self-loop; two nodes; triangle+self-loop; 4-cycle+self-loop; path shapes; 5-cycle. Give the observed value for EVERY distinct shape you can reach.
Return exact rules plus a table: input args -> lines 1,2,3,4,9.`,
  },
]

const probeResults = await parallel(probes.map(p => () => agent(p.prompt, { label: p.label, phase: 'Probe' })))

phase('Corpus')

const corpus = await agent(COMMON + `
YOUR JOB: build a GOLDEN differential-test corpus and leave it on disk for later use.

1. mkdir -p /workspace/tmp
2. Generate an input list covering:
   - ALL 52 set-partitions of the 5 positions (a,b,c,d,e) — i.e. every possible pattern of which arguments are equal to which. For each partition, emit SEVERAL value assignments: blocks numbered 1..k ascending, descending (k..1), including 0, including negatives, and large/mixed values. That is ~52 * 4 = ~200 cases.
   - plus ~30 assorted random 5-tuples drawn from a small value range (so collisions happen) and a few from a large range.
   Write the input list to /workspace/tmp/cases.txt, ONE CASE PER LINE, each line being exactly the 5 argument values separated by single spaces (e.g. "1 2 3 1 5"), meaning --a 1 --b 2 --c 3 --d 1 --e 5.
3. Run the executable for every case (use xargs -P 8; each run ~2s) and record results in /workspace/tmp/golden.txt with this EXACT format, one block per case, blocks separated by a line of '=====':
     CASE <the 5 values space separated>
     EXIT <exit code>
     STDOUT
     <the raw stdout bytes>
     STDERR
     <the raw stderr bytes>
   Keep the ordering identical to cases.txt. Verify the file has the right number of blocks and that no run produced an empty stdout with exit 0 (that would mean a harness bug).
4. Also write /workspace/tmp/run_golden.sh: a reusable script that takes a command prefix (e.g. "node /output/test10.mjs") and re-runs the same cases.txt, producing the same block format on stdout, so a later agent can diff it against golden.txt.
5. Sanity check: re-run 5 random cases by hand and confirm they match what you recorded.

Return: the absolute paths written, the number of cases, and a compact summary of the DISTINCT output shapes you observed (e.g. how many cases had node_connectivity 0/1/2, how many printed '0' vs a float on line 5, how many printed '[]' on lines 7/8). Report any case whose output surprised you, with its exact bytes.`, { label: 'golden-corpus', phase: 'Corpus' })

phase('Synthesize')

const spec = await agent(`You are merging four black-box probe reports plus a golden-corpus report into ONE implementation spec for a Node.js (ESM, zero-dependency) port of a Python/networkx script.

=== PROBE: argparse ===
${probeResults[0] ?? '(failed)'}

=== PROBE: int parsing ===
${probeResults[1] ?? '(failed)'}

=== PROBE: graph ordering / tie-breaking ===
${probeResults[2] ?? '(failed)'}

=== PROBE: connectivity / MST ===
${probeResults[3] ?? '(failed)'}

=== GOLDEN CORPUS ===
${corpus ?? '(failed)'}

Produce a single, de-duplicated, conflict-resolved implementation spec. Where two probes disagree, say so explicitly and re-run the executable yourself (${EXE}) to settle it — cite the deciding run. Organize as:
1. CLI parsing rules (with exact message templates and exit codes, and error precedence)
2. int() coercion rules + canonical rendering (state clearly whether BigInt is required)
3. Graph construction (insertion orders, duplicate/self-loop semantics)
4. Per-line output semantics for all 9 printed lines, including exact Python repr formatting rules
5. Algorithm rules: MST (kruskal), dijkstra (+tie-breaking), bfs_edges, dfs_edges, node_connectivity (full algorithm, self-loop handling)
6. A list of the TRICKIEST cases an implementer will get wrong, each with input -> expected exact output.
Be concrete and terse. No fluff.`, { label: 'synthesize-spec', phase: 'Synthesize' })

return { spec, corpusReport: corpus }
