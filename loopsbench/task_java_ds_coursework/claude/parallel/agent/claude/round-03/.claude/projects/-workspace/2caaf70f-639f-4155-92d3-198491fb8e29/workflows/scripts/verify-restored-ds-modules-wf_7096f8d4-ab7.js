export const meta = {
  name: 'verify-restored-ds-modules',
  description: 'Differential-verify 10 restored Java DS modules against their shipped .class oracle, adversarially confirm findings, fix, re-verify',
  phases: [
    { title: 'Verify', detail: 'one deep verifier per module: semantic diff vs decompiled reference + differential run vs shipped .class' },
    { title: 'Confirm', detail: 'adversarial skeptics try to refute each reported discrepancy' },
    { title: 'Fix', detail: 'apply only confirmed discrepancies, per module' },
    { title: 'Recheck', detail: 're-run differential after fixes' },
  ],
}

const COMMON = `
You are verifying a RESTORED Java source file in a data-structures course repo at /workspace.

BACKGROUND — this is the single most important thing to understand:
The repo's methods were stubbed out with \`throw new UnsupportedOperationException("TODO: implement")\`
and a previous agent restored them. The repo ALSO tracks the ORIGINAL compiled .class files from
BEFORE the stubbing, sitting right next to the stubbed .java. Those .class files are a perfect
behavioural oracle for what the code is supposed to do.

Two oracles available to you:
1. DECOMPILED REFERENCE SOURCE at /tmp/ref/<ModuleName>/*.java — produced by CFR from those
   .class files, with \\uXXXX unescaped back to Chinese. This is essentially the original source.
2. DIFFERENTIAL EXECUTION — run the shipped .class directly and compare to the rebuilt one:
     ORACLE:  cd <moduleDir> && LANG=C.UTF-8 java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp <moduleDir> <MainClass>
     REBUILT: cd <moduleDir> && LANG=C.UTF-8 javac -encoding UTF-8 -nowarn -d /tmp/build/<slug> ./*.java
              cd <moduleDir> && LANG=C.UTF-8 java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp /tmp/build/<slug> <MainClass>
   Note the working directory stays the module dir in BOTH cases so relative data files
   (samples.txt / data.txt / order.txt / random.txt) resolve identically. Only -cp differs.
   Diff the two outputs. Identical output on the same input is the gold-standard pass.

CRITICAL RULE — FIDELITY, NOT CORRECTNESS:
Several originals contain genuine student bugs. Fidelity to the original is what is graded.
If the oracle .class reproduces the same "wrong" behaviour, that is CORRECT and must be preserved.
NEVER report a finding that amounts to "the original algorithm is buggy, we should fix it".
Only report places where the RESTORED source behaves DIFFERENTLY from the oracle.

INTERACTIVE PROGRAMS: many of these are menu-driven and call \`new Scanner(System.in)\` on every
menu iteration, which discards buffered input. Piping a whole script at once loses lines and
crashes with NoSuchElementException. Use the paced feeder:
  bash /workspace/agent_tests/feed.sh <input-file> 0.25 | LANG=C.UTF-8 java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp ... <MainClass>
Feed the SAME input file to both oracle and rebuilt runs. Put scratch input files in /tmp, not in the repo.

HARD CONSTRAINTS:
- Do NOT modify, delete, or recompile-over any .class file in the repo. Build only into /tmp/build/.
- Do NOT modify any module other than your assigned one.
- Do NOT modify the repo's data files (samples.txt, data.txt, order.txt, random.txt, etc).
  If the program WRITES output files into the module dir, back them up first and restore the
  directory to a clean state when done (\`git status --short <moduleDir>\` must show only the
  intended .java modification when you finish).
- Randomness: if the program uses Random/Math.random or HashMap iteration order, outputs will
  differ run-to-run. In that case compare STRUCTURE (line counts, format, invariants, value ranges)
  rather than exact text, and say so in your report. Seedless randomness is not a discrepancy.
- Timeouts: always bound runs (e.g. \`timeout 60 java ...\`) so a program waiting on stdin cannot hang you.
`

const MODULES = [
  { slug: 'dsexp01_stack',        dir: 'Experiments/DSExp01_Stack',        ref: 'DSExp01_Stack',
    note: 'Main entry is DSExperiment (there is also Log.java). Reads samples.txt. /tmp/ref/DSExp01_Stack additionally has *.ORIGINAL.java extracted from a submission .zip — those are PRISTINE original sources, the highest-quality oracle available anywhere in this repo. Compare against the .ORIGINAL.java text essentially character by character for the restored methods. Key methods: convertToPostfix, calculatePostfixExpression, addMultiply, splitIntoPieces.' },
  { slug: 'dsexp02_tree',         dir: 'Experiments/DSExp02_Tree',         ref: 'DSExp02_Tree',
    note: 'Main entry is DSLab2. Builds a binary tree from PRE-ORDER user input on stdin, so it is fully interactive — you must craft a stdin script. ~13 restored methods: recursive+iterative pre/in/post-order, level-order, full/complete/balanced classification, lowest common ancestor. Exercise every menu option in both oracle and rebuilt runs.' },
  { slug: 'dsexp03_graph',        dir: 'Experiments/DSExp03_Graph',        ref: 'DSExp03_Graph',
    note: 'Main entry is Main. Reads data.txt. ~15 restored methods: adjacency-matrix and adjacency-list build, conversion between representations, recursive/iterative DFS and BFS from every vertex. DFS2(int i) specifically must print the vertex, mark visited, and record DFN. Watch for HashMap/HashSet iteration-order dependence.' },
  { slug: 'dsexp04_search',       dir: 'Experiments/DSExp04_Search',       ref: 'DSExp04_Search',
    note: 'Main entry is Main. Reads order.txt and random.txt. ~21 restored methods: BST insert/delete/delete-min/search/in-order-sort, plus half-search decision tree and average successful/unsuccessful search length (ASL) computation. The ASL floating-point numbers are a very sensitive fingerprint — compare them digit for digit against the oracle.' },
  { slug: 'dsexp05_hash',         dir: 'Experiments/DSExp05_Hash',         ref: 'DSExp05_Hash',
    note: 'Main entry is Main. Consistent hashing with virtual nodes and an FNV-like hash. ~7 restored methods. The exact hash function arithmetic matters enormously — one wrong constant or a missing & 0xFFFFFFFFL / signed-vs-unsigned shift changes every mapping. Verify the hash of specific keys matches the oracle exactly. If server IPs are randomly generated, compare structure and verify the hash function separately with a tiny driver that calls it on fixed inputs.' },
  { slug: 'dsexp05_redblacktree', dir: 'Experiments/DSExp05_RedBlackTree', ref: 'DSExp05_RedBlackTree',
    note: 'Main entry is Main. Reads order.txt. ~13 restored methods: left/right rotation, insertBST placement, balanceTree post-insert recolour/rotate, post-DELETE rebalancing, search, in-order traversal, average search length. Red-black delete rebalancing is the single most error-prone routine in this whole repo — scrutinise every case (sibling red, sibling black with red child near/far, both children black) against the decompiled reference line by line. Also verify the final tree shape/colours printed by the oracle match exactly.' },
  { slug: 'ds02_linkedlist',      dir: 'Homework/DS02_LinkedList',         ref: 'DS02_LinkedList',
    note: 'Main entry is DS02. Sorted linked list of products: add, delete, search by name and by brand, update, file persistence. ~11 restored methods. Fully menu-driven — craft a stdin script exercising every operation including the file save/load. If it writes a data file into the module dir, restore the dir to clean afterwards.' },
  { slug: 'ds02_string',          dir: 'Homework/DS02_String',             ref: 'DS02_String',
    note: 'Main entry is DS_String. Builds a character-level linked list and does substring pattern matching. Only ~2 restored methods, so verify them exhaustively: empty pattern, pattern longer than text, pattern at the very start, at the very end, no match, repeated overlapping matches. Check the exact return convention (0-based vs 1-based index, and what is returned on no-match).' },
  { slug: 'ds03_huffman',         dir: 'Homework/DS03_Huffman',            ref: 'DS03_Huffman',
    note: 'Main entry is HuffmanHomework. ~11 restored methods: frequency count, greedy tree build, encode to a binary file plus a key file, decode back. The tie-breaking rule when two nodes have equal frequency determines the whole code table — get it wrong and every output byte differs. Verify round-trip (encode then decode reproduces the input exactly) AND that the produced binary/key files are byte-identical to the oracle run. This module WRITES files into its directory — snapshot what exists first and clean up after.' },
  { slug: 'ds04_maze',            dir: 'Homework/DS04_Maze',               ref: 'DS04_Maze',
    note: 'Main entry is Main. Swing GUI, so this environment is very likely HEADLESS and a run will throw HeadlessException. Try `xvfb-run` if available; if not, say so plainly and fall back to rigorous line-by-line source comparison against the decompiled reference as your primary evidence, plus optionally extracting the pure-logic methods (DFS wall carving, Prim generation, DFS solving) into a standalone /tmp harness driven by a FIXED Random seed and running that same harness against both the oracle class and the rebuilt class. ~9 restored methods. Do not claim differential verification you did not actually perform.' },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    module: { type: 'string' },
    compiled: { type: 'boolean' },
    differentialRun: { type: 'string', description: 'What differential execution you ACTUALLY performed and its result. Say plainly if you could not run it and why.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          method: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          description: { type: 'string', description: 'How restored behaviour DIFFERS from the oracle' },
          evidence: { type: 'string', description: 'Concrete proof: diff of oracle vs rebuilt output, or exact reference-source lines contradicting the restored code' },
          suggestedFix: { type: 'string' },
        },
        required: ['method', 'file', 'severity', 'description', 'evidence', 'suggestedFix'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['module', 'compiled', 'differentialRun', 'findings', 'summary'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true only if this is a genuine restored-vs-oracle divergence that must be fixed' },
    reasoning: { type: 'string' },
  },
  required: ['real', 'reasoning'],
}

const RECHECK_SCHEMA = {
  type: 'object',
  properties: {
    module: { type: 'string' },
    stillCompiles: { type: 'boolean' },
    matchesOracle: { type: 'string', enum: ['exact', 'structural', 'diverges', 'unverifiable'] },
    detail: { type: 'string' },
  },
  required: ['module', 'stillCompiles', 'matchesOracle', 'detail'],
}

const results = await pipeline(
  MODULES,

  (m) => agent(
    `${COMMON}

YOUR ASSIGNED MODULE: ${m.slug}
  restored source dir: /workspace/${m.dir}
  decompiled reference: /tmp/ref/${m.ref}/
  build output dir to use: /tmp/build/${m.slug}

Module-specific guidance: ${m.note}

TASK:
1. Read every restored method in /workspace/${m.dir}/*.java.
2. Read the corresponding decompiled reference in /tmp/ref/${m.ref}/ and compare SEMANTICS
   method by method. Decompiler artifacts (renamed locals, for->while, inverted conditions,
   explicit casts, string-concat lowering) are NOT discrepancies. Real differences in
   control flow, comparison operators, boundary conditions, loop bounds, initial values,
   printed text, or output ORDER are.
3. Actually RUN the differential test. Build the rebuilt classes into /tmp/build/${m.slug} and
   run oracle-vs-rebuilt on identical input, then diff. Report exactly what you ran.
4. Pay special attention to printed output: these are console programs graded on their output.
   Chinese prompt strings, spacing, punctuation, newlines and number formatting all matter.

Report every genuine restored-vs-oracle divergence. Report NOTHING if the restored code
faithfully reproduces the oracle — an empty findings list is a perfectly good result and is
much better than an invented one. Do not report style, do not report "the original is buggy".`,
    { label: `verify:${m.slug}`, phase: 'Verify', schema: FINDINGS_SCHEMA }
  ),

  (report, m) => {
    if (!report || !report.findings || report.findings.length === 0) {
      return { module: m.slug, mod: m, report, confirmed: [], rejected: [] }
    }
    return parallel(
      report.findings.map((f) => () =>
        parallel([
          () => agent(
            `${COMMON}

MODULE: ${m.slug} — restored source /workspace/${m.dir}, reference /tmp/ref/${m.ref}/

A verifier claims the restored code diverges from the oracle:
  method: ${f.method}
  file: ${f.file}
  claim: ${f.description}
  evidence offered: ${f.evidence}

Your job is to REFUTE this claim. Read the restored code AND the decompiled reference yourself.
Consider that the claim may be a decompiler artifact, a misreading, or a case where the original
itself is buggy and the restoration correctly reproduces the bug (which is REQUIRED, not a defect).
Where possible run the oracle .class and the rebuilt class to settle it empirically.
Default to real=false when uncertain. Only say real=true if you independently confirmed a genuine
behavioural divergence from the oracle.`,
            { label: `refute:${m.slug}:${f.method}`, phase: 'Confirm', schema: VERDICT_SCHEMA }
          ),
          () => agent(
            `${COMMON}

MODULE: ${m.slug} — restored source /workspace/${m.dir}, reference /tmp/ref/${m.ref}/

Claimed divergence in ${f.method} (${f.file}): ${f.description}

Judge this through the EMPIRICAL lens only. Do not reason from reading the source. Construct
an actual input that would expose the claimed difference, run it against BOTH the shipped oracle
.class and the rebuilt class, and diff the outputs. If you cannot produce an input where the two
actually differ, answer real=false. If you genuinely cannot execute the module at all, say so in
reasoning and answer real=false unless the source evidence is overwhelming and unambiguous.`,
            { label: `empirical:${m.slug}:${f.method}`, phase: 'Confirm', schema: VERDICT_SCHEMA }
          ),
          () => agent(
            `${COMMON}

MODULE: ${m.slug} — restored source /workspace/${m.dir}, reference /tmp/ref/${m.ref}/

Claimed divergence in ${f.method} (${f.file}): ${f.description}
Proposed fix: ${f.suggestedFix}

Judge this through the CONSEQUENCE lens. Assume for argument the divergence is real. Would applying
the proposed fix make the restored code MORE faithful to the decompiled reference, or would it
"improve" the algorithm away from what the original actually did? Check the proposed fix against
the reference source directly. If the fix would push the code away from the oracle, or if the
reference source plainly already agrees with the CURRENT restored code, answer real=false.`,
            { label: `consequence:${m.slug}:${f.method}`, phase: 'Confirm', schema: VERDICT_SCHEMA }
          ),
        ]).then((votes) => {
          const good = votes.filter(Boolean)
          const yes = good.filter((v) => v.real).length
          return { finding: f, real: yes >= 2, votes: good.length, yes }
        })
      )
    ).then((judged) => ({
      module: m.slug,
      mod: m,
      report,
      confirmed: judged.filter(Boolean).filter((j) => j.real).map((j) => j.finding),
      rejected: judged.filter(Boolean).filter((j) => !j.real).map((j) => ({ method: j.finding.method, yes: j.yes, votes: j.votes })),
    }))
  },

  (judged, m) => {
    if (!judged || !judged.confirmed || judged.confirmed.length === 0) {
      return { ...(judged || { module: m.slug }), fixed: false, fixNote: 'no confirmed divergences; nothing applied' }
    }
    return agent(
      `${COMMON}

MODULE: ${m.slug} — restored source /workspace/${m.dir}, reference /tmp/ref/${m.ref}/

The following divergences from the oracle were independently confirmed by a majority of
skeptical reviewers. Apply them to /workspace/${m.dir} so the restored source faithfully
reproduces the oracle:

${judged.confirmed.map((f, i) => `[${i + 1}] ${f.method} (${f.file}${f.line ? ':' + f.line : ''}) severity=${f.severity}
     problem: ${f.description}
     evidence: ${f.evidence}
     fix: ${f.suggestedFix}`).join('\n\n')}

Rules:
- Edit ONLY files under /workspace/${m.dir}. Never touch a .class file.
- Before each edit, re-read the decompiled reference for that method and make the restored code
  match the ORACLE's behaviour — the reference is the authority, not the fix text above.
- After editing, recompile into /tmp/build/${m.slug} and re-run the differential test to prove
  the fix actually closed the gap.
- Leave the module dir clean apart from the intended .java changes (check \`git status --short\`).
Return a concise description of what you changed and the post-fix differential result.`,
      { label: `fix:${m.slug}`, phase: 'Fix' }
    ).then((note) => ({ ...judged, fixed: true, fixNote: note }))
  },

  (state, m) => agent(
    `${COMMON}

MODULE: ${m.slug} — restored source /workspace/${m.dir}, reference /tmp/ref/${m.ref}/
Build into /tmp/build/${m.slug}-recheck.

Module-specific guidance: ${m.note}

This is a FINAL independent acceptance check, done fresh. Ignore any earlier conclusions.
1. Compile the module. It must compile clean.
2. Confirm zero \`UnsupportedOperationException("TODO: implement")\` remain in the module.
3. Run the differential test (shipped oracle .class vs rebuilt class, identical input, same cwd)
   and diff outputs. Exercise the module's real functionality, not just startup.
4. Confirm \`git status --short /workspace/${m.dir}\` shows only intended .java modifications —
   no stray output files, no modified data files, no modified .class files. If the module wrote
   scratch files, clean them up (restore data files with \`git checkout -- <path>\` if needed).

Answer matchesOracle:
  'exact'        = byte-identical output on identical input
  'structural'   = differs only through legitimate nondeterminism (Random, hash iteration order),
                   with structure/format/invariants matching
  'diverges'     = a real behavioural difference remains
  'unverifiable' = could not execute (e.g. headless GUI); say exactly what you could and could not check
Be honest. A truthful 'unverifiable' is far more useful than an unearned 'exact'.`,
    { label: `recheck:${m.slug}`, phase: 'Recheck', schema: RECHECK_SCHEMA }
  ).then((rc) => ({
    module: m.slug,
    dir: m.dir,
    confirmedCount: (state && state.confirmed) ? state.confirmed.length : 0,
    rejectedCount: (state && state.rejected) ? state.rejected.length : 0,
    fixNote: state ? state.fixNote : 'unknown',
    recheck: rc,
  }))
)

const clean = results.filter(Boolean)
log(`verification complete for ${clean.length}/${MODULES.length} modules`)
for (const r of clean) {
  log(`${r.module}: ${r.recheck ? r.recheck.matchesOracle : 'NO-RECHECK'} (confirmed fixes: ${r.confirmedCount}, rejected claims: ${r.rejectedCount})`)
}
return clean
