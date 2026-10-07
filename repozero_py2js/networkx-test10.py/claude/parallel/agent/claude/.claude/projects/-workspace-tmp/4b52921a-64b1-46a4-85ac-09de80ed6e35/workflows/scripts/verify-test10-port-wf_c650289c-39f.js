export const meta = {
  name: 'verify-test10-port',
  description: 'Adversarially verify the Node.js port in /output against the reference executable',
  phases: [
    { title: 'Attack', detail: 'independent lenses hunt for divergences and rule violations' },
    { title: 'Confirm', detail: 'each candidate finding is refuted or confirmed by an independent skeptic' },
    { title: 'Report', detail: 'merge into a ranked, deduplicated finding list' },
  ],
}

const CONTEXT = `
CONTEXT
=======
A Python script was ported to Node.js. The port lives in /output:
  /output/test10.mjs                     entry point
  /output/lib/index.mjs                  barrel
  /output/lib/python/{repr,int,heapq}.mjs
  /output/lib/cli/{argparse,args}.mjs
  /output/lib/graph/{graph,traversal,mst,shortest_path,flow,connectivity,index}.mjs

Reference implementation (ground truth), a PyInstaller binary of Python 3.12 + networkx:
  /workspace/dataset/test10_executable --a 1 --b 2 --c 3 --d 4 --e 5     (~2s per run)
Never run 'python'. Run the binary. Original source: /workspace/dataset/test10.py

The port must satisfy ALL of these:
 1. Byte-identical stdout to the reference for any argument vector. stderr + exit code should match too.
 2. Pure JavaScript, Node.js, ES Modules only: 'import'/'export', NEVER require()/module.exports. All files .mjs.
    import statements must include the file extension.
 3. ZERO external/npm dependencies. No bare-specifier imports at all except node: builtins. Only relative local imports.
 4. No embedded Python, no shelling out to the reference binary or any interpreter at runtime.
 5. Library code split into multiple modules by functionality, exposing interfaces via export; entry file /output/test10.mjs.
 6. Argument parsing must behave like the reference: 5 required int options --a..--e, same errors/exit codes.

RULES FOR YOU
=============
- Do NOT modify anything in /output. It is read-only for you. If you need to experiment, copy it: cp -r /output /workspace/tmp/<your-own-unique-dir>/ and hack on the copy.
- Keep all scratch files under your own unique subdirectory of /workspace/tmp (mkdir -p it). Do NOT write to /workspace/tmp/cases.txt or any shared path.
- Every finding MUST be backed by a reproducible command with its actual observed output. No speculation.
- Run the reference binary in parallel (xargs -P 8) when doing many runs.
- Already verified by the author (do not just re-run this, go beyond it): 371 cases covering all 52 set-partitions of the 5 argument
  positions across 6 value vectors + 60 random tuples all matched exactly, plus ~28 hand-picked CLI cases (help, missing args,
  invalid int, unrecognized args, '=' form, '--' separator, abbreviations '--h'/'--he', negative numbers, big ints, underscores,
  duplicate options, leading zeros, whitespace-padded values).
`

phase('Attack')

const LENSES = [
  {
    key: 'cli-fuzz',
    prompt: `LENS: command-line parsing fidelity, by brute force.
Fuzz the CLI hard and diff the port against the reference on stdout, stderr AND exit code. Ideas to cover:
- every combination of a missing/duplicated/misspelled option; options in random orders; interleaved unknown options
- '=' forms with weird values ('--a=', '--a==1', '--a=+1', '--a= 1', '--a=-0')
- abbreviation space: '--h', '--he', '--hel', '--help', '--help=x', '-h', '-hh', '-h=1', '--', '---', '-', '----a 1', '--a-'
- values that look like options: '--a -1', '--a -1.5', '--a -x', '--a --', '--a -', '--a "-1 "'
- int() acceptance: unicode digits (Arabic-Indic, Devanagari, fullwidth), underscores in every legal/illegal position,
  huge magnitudes (30+ digits, both signs), '0x1', '1e2', 'inf', 'nan', empty, whitespace-only, '  -7  ', tabs/newlines inside values
- args after '--', repeated '--', empty argv, only '-h', '-h' mixed with missing required args (which error wins?)
- non-UTF8-ish / control characters in values, and a value containing a space or a quote (check the repr in the error message)
Generate at least 150 distinct argv vectors, run both sides, and report EVERY divergence with exact bytes. Use printf %q or a JSON
array + a small runner script so odd characters survive. Report the count of vectors tested.`,
  },
  {
    key: 'algo-fuzz',
    prompt: `LENS: graph algorithm fidelity, by brute force over the value space.
The 9 printed lines come from number_of_edges, an edge weight lookup, minimum_spanning_tree edge count, mst.has_edge,
dijkstra_path_length, dijkstra_path, bfs_edges, dfs_edges and node_connectivity.
Exhaustively diff the port vs the reference over ALL 5-tuples drawn from a small domain so that node collapses, self-loops and
weight overwrites happen in every combination: enumerate all 3^5 = 243 tuples over {1,2,3}, then all 243 over {0,-1,7}, then
sample a few hundred tuples over a wider domain including large and negative values. That is ~700 reference runs at ~2s: use
xargs -P 8 and be patient, it is fine to take several minutes. Report the exact count run and EVERY divergence.
Pay special attention to: ties in dijkstra distance (two equal-cost paths), self-loops in bfs/dfs/mst, node_connectivity when a
self-loop inflates a degree, and whether line 5 prints '0' (int) versus '0.0'/'5.0' (float).`,
  },
  {
    key: 'code-audit',
    prompt: `LENS: read the port's source critically (no fuzzing).
Read every file under /output. Hunt for logic that is right on the tested inputs but wrong in general, or that diverges from
CPython/networkx semantics. Specifically scrutinise:
- lib/python/repr.mjs: is the float repr correct for values the script could theoretically produce? Check the scientific-notation
  thresholds and the '.0' suffix against the reference (you can only produce floats 1.0-15.0 via the CLI, so verify the helper
  directly with node -e against known CPython repr values you are confident about, e.g. repr(1e16)='1e+16', repr(1e15)=
  '1000000000000000.0', repr(1e-5)='1e-05', repr(0.0001)='0.0001', repr(0.1)='0.1', repr(1/3)='0.3333333333333333').
- lib/python/int.mjs: unicode digit handling, underscore rules, whitespace set.
- lib/cli/argparse.mjs: error precedence, the pattern/token classification, abbreviation matching, '--' handling.
- lib/graph/*.mjs: Map key identity with BigInt, adjacency insertion order on duplicate edges, self-loop degree counting,
  stable sort in kruskal, the dijkstra strict-'<' relaxation and heap tie ordering, the stateful DFS iterator, and the
  node_connectivity search (min-degree seed, non-neighbour loop, non-adjacent neighbour pairs).
- correctness of the max-flow implementation (arc pairing, augmenting path walk, per-call residual reset).
Also check requirement compliance: any 'require(' or 'module.exports'? any bare-specifier import? any missing file extension in an
import? any dead/unused export? any file outside /output being written at runtime?
For each suspected defect, construct a concrete input that would expose it and RUN both sides to prove it. Report proven defects
and, separately, clearly-labelled unproven suspicions.`,
  },
  {
    key: 'robustness',
    prompt: `LENS: runtime robustness and environment sensitivity.
Check the port behaves like the reference under conditions a grader might create:
- stdout piped vs tty vs redirected to a file; output truncation on exit (especially the --help and error paths, where exit codes
  are involved). Verify with: node /output/test10.mjs --help | cat, and ... > file, and inside a pipeline that closes early.
- exit codes in every path (success, argparse error, help).
- being invoked from a different working directory, via a relative path, via a symlink, and with 'node --experimental-vm-modules'.
- COLUMNS / terminal width influence on usage/help wrapping: does the reference wrap its usage line when COLUMNS is small
  (try COLUMNS=20, COLUMNS=40, and a narrow 'stty cols')? Does the port? Report any divergence and how the reference behaves.
- LANG/LC_ALL variations and unicode argument values.
- extremely large integer arguments (300 digits) and deep argv (repeating an option 1000 times).
- stdin closed, and a very long single argument.
Report divergences with exact commands and bytes.`,
  },
]

const attacks = await parallel(LENSES.map(lens => () => agent(CONTEXT + '\n' + lens.prompt + `

OUTPUT FORMAT: return a JSON-ish list of findings. Each finding: {id, severity: 'blocker'|'major'|'minor'|'nit', file, summary,
repro command, observed reference output, observed port output, suggested fix}. If you found nothing, say so explicitly and state
exactly what you tested and how many runs you made.`, { label: `attack:${lens.key}`, phase: 'Attack' })))

phase('Confirm')

const confirmed = await agent(CONTEXT + `
You are the SKEPTIC. Four independent reviewers attacked the port. Their reports:

=== cli-fuzz ===
${attacks[0] ?? '(agent failed)'}

=== algo-fuzz ===
${attacks[1] ?? '(agent failed)'}

=== code-audit ===
${attacks[2] ?? '(agent failed)'}

=== robustness ===
${attacks[3] ?? '(agent failed)'}

Your job: for EVERY claimed finding, try to REFUTE it. Re-run the repro yourself against both /output and the reference binary.
Default to 'refuted' when a claim is not reproducible, is about behaviour the reference does not actually exhibit, or is a style
opinion dressed up as a defect. Note that a divergence in the *program name* inside usage/error text is expected ONLY if the port
prints something other than 'test10_executable' — the port deliberately hardcodes that name; verify it does match.
Then, independently, spend real effort trying to find a divergence NOBODY reported: pick the 3 riskiest code paths and attack them
with fresh inputs of your own design (at least 40 more reference runs).
Return: (1) the surviving CONFIRMED findings, most severe first, each with a verified repro and a precise fix; (2) the refuted
claims with one line each on why; (3) anything new you found.`, { label: 'skeptic', phase: 'Confirm' })

phase('Report')

const report = await agent(`Merge this verification into a final, terse report for the engineer who wrote the port.

${confirmed}

Return:
- VERDICT: ship / fix-first
- CONFIRMED FINDINGS: ranked, each as: severity | file:line | one-line defect | exact repro | exact fix to apply
- COVERAGE: what was actually exercised (counts of reference runs, dimensions covered)
- RESIDUAL RISK: what remains untested and why it is or is not acceptable
No praise, no restating the task. If there are zero confirmed findings, say that plainly and keep the coverage/risk sections.`, { label: 'final-report', phase: 'Report' })

return { report }
