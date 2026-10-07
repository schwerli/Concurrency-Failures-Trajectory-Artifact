export const meta = {
  name: 'verify-remaining-ds-modules',
  description: 'Low-concurrency differential verification of the 5 remaining restored Java DS modules against their shipped .class oracle',
  phases: [
    { title: 'Verify', detail: 'deep semantic diff vs decompiled reference + differential run vs shipped .class' },
    { title: 'Confirm', detail: 'sequential skeptics refute each claimed discrepancy' },
    { title: 'Fix', detail: 'apply only confirmed discrepancies' },
    { title: 'Recheck', detail: 'fresh independent acceptance pass' },
  ],
}

const COMMON = `
You are verifying a RESTORED Java source file in a data-structures course repo at /workspace.

BACKGROUND — the most important thing to understand:
The repo's methods were stubbed out with \`throw new UnsupportedOperationException("TODO: implement")\`
and a previous agent restored them. The repo ALSO tracks the ORIGINAL compiled .class files from
BEFORE the stubbing, sitting right next to the stubbed .java. Those .class files are a perfect
behavioural oracle for what the code is supposed to do.

Two oracles available to you:
1. DECOMPILED REFERENCE SOURCE at /tmp/ref/<ModuleName>/*.java — produced by CFR from those
   .class files, with \\uXXXX unescaped back to Chinese. Essentially the original source.
   (If /tmp/ref is missing or empty, regenerate it: \`bash /workspace/agent_tests/regen_reference.sh\`)
2. DIFFERENTIAL EXECUTION — run the shipped .class and compare to the rebuilt one:
     ORACLE:  cd <moduleDir> && LANG=C.UTF-8 java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp <moduleDir> <MainClass>
     REBUILT: cd <moduleDir> && LANG=C.UTF-8 javac -encoding UTF-8 -nowarn -d /tmp/build/<slug> ./*.java
              cd <moduleDir> && LANG=C.UTF-8 java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp /tmp/build/<slug> <MainClass>
   The working directory stays the module dir in BOTH cases so relative data files resolve
   identically. Only -cp differs. Diff the two outputs. Identical output = gold-standard pass.

CRITICAL RULE — FIDELITY, NOT CORRECTNESS:
Several originals contain genuine student bugs. Fidelity to the original is what is graded.
If the oracle .class reproduces the same "wrong" behaviour, that is CORRECT and must be preserved.
NEVER report a finding that amounts to "the original algorithm is buggy, we should fix it".
Only report places where the RESTORED source behaves DIFFERENTLY from the oracle.

INTERACTIVE PROGRAMS: many are menu-driven and call \`new Scanner(System.in)\` on every menu
iteration, which discards buffered input. Piping a whole script at once loses lines and crashes
with NoSuchElementException. Use the paced feeder:
  bash /workspace/agent_tests/feed.sh <input-file> 0.25 | LANG=C.UTF-8 java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp ... <MainClass>
Feed the SAME input file to both oracle and rebuilt runs. Put scratch files in /tmp, not the repo.

RATE LIMITS: this API key is capped at 60 requests/minute and other agents share it. Work
efficiently — batch your shell commands, avoid redundant re-reads, and do not spin in tight
retry loops. Prefer a few well-chosen large commands over many tiny ones.

HARD CONSTRAINTS:
- Do NOT modify, delete, or recompile-over any .class file in the repo. Build only into /tmp/build/.
- Do NOT modify any module other than your assigned one.
- Do NOT modify the repo's data files (samples.txt, data.txt, order.txt, random.txt, etc).
  \`git status --short <moduleDir>\` must show only the intended .java modification when you finish.
  Restore anything else with \`git checkout -- <path>\` and delete stray output files.
- Randomness: if the program uses Random/Math.random or HashMap iteration order, outputs differ
  run to run. Compare STRUCTURE (line counts, format, invariants, value ranges) instead, and say
  so. Seedless randomness is not a discrepancy.
- Always bound runs with \`timeout 60 ...\` so a program waiting on stdin cannot hang you.
`

const MODULES = [
  { slug: 'dsexp02_tree', dir: 'Experiments/DSExp02_Tree', ref: 'DSExp02_Tree',
    note: 'Main entry is DSLab2. Builds a binary tree from PRE-ORDER user input on stdin, so it is fully interactive — you must craft a stdin script (work out the sentinel for a null child by reading the build method first). ~13 restored methods: recursive AND iterative pre/in/post-order, level-order, full/complete/balanced classification, lowest common ancestor. Exercise every menu option on both oracle and rebuilt. Test several tree shapes: a single node, a left-only chain, a right-only chain, a perfect tree, and a lopsided tree — the full/complete/balanced classifiers differ exactly on those.' },
  { slug: 'dsexp03_graph', dir: 'Experiments/DSExp03_Graph', ref: 'DSExp03_Graph',
    note: 'Main entry is Main. Reads data.txt. ~15 restored methods: adjacency-matrix and adjacency-list build, conversion between representations, recursive/iterative DFS and BFS from every vertex. DFS2(int i) specifically must print the vertex, mark visited, and record DFN. Traversal ORDER is the whole point — a neighbour loop running in the wrong direction, or an adjacency list built by head-insertion vs tail-append, silently reverses it. Check printed order vertex by vertex.' },
  { slug: 'dsexp04_search', dir: 'Experiments/DSExp04_Search', ref: 'DSExp04_Search',
    note: 'Main entry is Main. Reads order.txt and random.txt. ~21 restored methods: BST insert/delete/delete-min/search/in-order-sort, plus the half-search decision tree and average successful/unsuccessful search length (ASL) computation. The ASL floating-point numbers are an extremely sensitive fingerprint — compare them digit for digit against the oracle. Note insertBST(node,parent,value) returns void and threads the parent explicitly; searchBST returns the value or -1; sortBST appends in-order into the allElements list.' },
  { slug: 'dsexp05_redblacktree', dir: 'Experiments/DSExp05_RedBlackTree', ref: 'DSExp05_RedBlackTree',
    note: 'Main entry is Main. Reads order.txt. ~13 restored methods: left/right rotation, insertBST placement, balanceTree post-insert recolour/rotate, post-DELETE rebalancing, search, in-order traversal, average search length. Red-black DELETE rebalancing is the single most error-prone routine in this repo — scrutinise every case (sibling red; sibling black with red child near / far; both children black) against the decompiled reference line by line, including which node the loop advances to. Verify the exact tree shape and node colours the oracle prints, and delete enough distinct keys to drive every rebalancing case.' },
  { slug: 'ds02_linkedlist', dir: 'Homework/DS02_LinkedList', ref: 'DS02_LinkedList',
    note: 'Main entry is DS02. Sorted linked list of products: add, delete, search by name and by brand, update, file persistence. ~11 restored methods. Fully menu-driven — craft a stdin script exercising EVERY operation including save and load. Sort position on insert, and the not-found paths for delete/search/update, are where restorations usually drift. If it writes a data file into the module dir, restore the dir to clean afterwards.' },
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

// Sequential retry: agent() returns null when the API 429s it to death. Retrying
// serially also spaces the requests out, which is what the rate limit wants.
async function tryAgent(prompt, opts, attempts) {
  const n = attempts || 3
  for (let i = 0; i < n; i++) {
    const r = await agent(prompt, i === 0 ? opts : { ...opts, label: `${opts.label}~retry${i}` })
    if (r) return r
    log(`agent ${opts.label} returned null (attempt ${i + 1}/${n}) — retrying`)
  }
  log(`agent ${opts.label} FAILED after ${n} attempts`)
  return null
}

async function verifyModule(m) {
  const report = await tryAgent(
    `${COMMON}

YOUR ASSIGNED MODULE: ${m.slug}
  restored source dir: /workspace/${m.dir}
  decompiled reference: /tmp/ref/${m.ref}/
  build output dir to use: /tmp/build/${m.slug}

Module-specific guidance: ${m.note}

TASK:
1. Read every restored method in /workspace/${m.dir}/*.java.
2. Read the decompiled reference in /tmp/ref/${m.ref}/ and compare SEMANTICS method by method.
   Decompiler artifacts (renamed locals, for->while, inverted conditions, explicit casts,
   string-concat lowering, inlined constants) are NOT discrepancies. Real differences in control
   flow, comparison operators, boundary conditions, loop bounds, initial values, printed text,
   or output ORDER are.
3. Actually RUN the differential test: build into /tmp/build/${m.slug}, run oracle-vs-rebuilt on
   identical input, diff. Report exactly what you ran.
4. These are console programs graded on their output. Chinese prompt strings, spacing,
   punctuation, newlines and number formatting all matter.

Report every genuine restored-vs-oracle divergence. Report NOTHING if the restored code
faithfully reproduces the oracle — an empty findings list is a perfectly good result and is much
better than an invented one. Do not report style; do not report "the original is buggy".`,
    { label: `verify:${m.slug}`, phase: 'Verify', schema: FINDINGS_SCHEMA }
  )

  const findings = (report && report.findings) ? report.findings : []
  const confirmed = []
  const rejected = []

  // Skeptics run strictly sequentially to stay well under the shared 60 RPM cap.
  for (const f of findings) {
    const lenses = [
      { tag: 'refute', ask: `Your job is to REFUTE this claim. Read the restored code AND the decompiled reference yourself. The claim may be a decompiler artifact, a misreading, or a case where the ORIGINAL itself is buggy and the restoration correctly reproduces that bug (which is REQUIRED, not a defect). Where possible run the oracle .class and the rebuilt class to settle it empirically. Default to real=false when uncertain.` },
      { tag: 'empirical', ask: `Judge this through the EMPIRICAL lens only — do not reason from reading the source. Construct an actual input that would expose the claimed difference, run it against BOTH the shipped oracle .class and the rebuilt class, and diff. If you cannot produce an input where the two actually differ, answer real=false.` },
      { tag: 'consequence', ask: `Judge this through the CONSEQUENCE lens. Assume the divergence is real. Would the proposed fix ("${f.suggestedFix}") make the code MORE faithful to the decompiled reference, or "improve" the algorithm away from what the original did? Check the proposed fix against the reference source directly. If it would push the code away from the oracle, or the reference plainly already agrees with the CURRENT restored code, answer real=false.` },
    ]
    let yes = 0, votes = 0
    for (const lens of lenses) {
      const v = await tryAgent(
        `${COMMON}

MODULE: ${m.slug} — restored source /workspace/${m.dir}, reference /tmp/ref/${m.ref}/

A verifier claims the restored code diverges from the oracle:
  method: ${f.method}
  file: ${f.file}${f.line ? ':' + f.line : ''}
  claim: ${f.description}
  evidence offered: ${f.evidence}

${lens.ask}

Only answer real=true if you independently confirmed a genuine behavioural divergence from the oracle.`,
        { label: `${lens.tag}:${m.slug}:${f.method}`, phase: 'Confirm', schema: VERDICT_SCHEMA },
        2
      )
      if (v) { votes++; if (v.real) yes++ }
    }
    if (votes > 0 && yes * 2 > votes) confirmed.push(f)
    else rejected.push({ method: f.method, yes, votes })
  }

  let fixNote = 'no confirmed divergences; nothing applied'
  if (confirmed.length > 0) {
    fixNote = await tryAgent(
      `${COMMON}

MODULE: ${m.slug} — restored source /workspace/${m.dir}, reference /tmp/ref/${m.ref}/

These divergences from the oracle were independently confirmed by a majority of skeptical
reviewers. Apply them to /workspace/${m.dir} so the restored source faithfully reproduces
the oracle:

${confirmed.map((f, i) => `[${i + 1}] ${f.method} (${f.file}${f.line ? ':' + f.line : ''}) severity=${f.severity}
     problem: ${f.description}
     evidence: ${f.evidence}
     fix: ${f.suggestedFix}`).join('\n\n')}

Rules:
- Edit ONLY files under /workspace/${m.dir}. Never touch a .class file.
- Before each edit, re-read the decompiled reference for that method and make the restored code
  match the ORACLE's behaviour — the reference is the authority, not the fix text above.
- After editing, recompile into /tmp/build/${m.slug} and re-run the differential test to prove
  the fix actually closed the gap.
- Leave the module dir clean apart from the intended .java changes (\`git status --short\`).
Return a concise description of what you changed and the post-fix differential result.`,
      { label: `fix:${m.slug}`, phase: 'Fix' }
    ) || 'FIX AGENT FAILED — confirmed divergences may remain unapplied'
  }

  const rc = await tryAgent(
    `${COMMON}

MODULE: ${m.slug} — restored source /workspace/${m.dir}, reference /tmp/ref/${m.ref}/
Build into /tmp/build/${m.slug}-recheck.

Module-specific guidance: ${m.note}

FINAL independent acceptance check, done fresh. Ignore any earlier conclusions.
1. Compile the module. It must compile clean.
2. Confirm zero \`UnsupportedOperationException("TODO: implement")\` remain in the module.
3. Run the differential test (shipped oracle .class vs rebuilt class, identical input, same cwd)
   and diff outputs. Exercise the module's real functionality, not just startup.
4. Confirm \`git status --short /workspace/${m.dir}\` shows only intended .java modifications —
   no stray output files, no modified data files, no modified .class files. Clean up if needed.

Answer matchesOracle:
  'exact'        = byte-identical output on identical input
  'structural'   = differs only through legitimate nondeterminism (Random, hash iteration order),
                   with structure/format/invariants matching
  'diverges'     = a real behavioural difference remains
  'unverifiable' = could not execute; say exactly what you could and could not check
Be honest. A truthful 'unverifiable' is far more useful than an unearned 'exact'.`,
    { label: `recheck:${m.slug}`, phase: 'Recheck', schema: RECHECK_SCHEMA }
  )

  return {
    module: m.slug,
    dir: m.dir,
    verified: !!report,
    findingsRaised: findings.length,
    confirmedCount: confirmed.length,
    rejectedCount: rejected.length,
    rejected,
    fixNote,
    recheck: rc,
  }
}

// Two modules in flight at a time keeps us far below the shared 60 RPM cap
// (the previous run put 10+ agents in flight and got 429'd to death).
const BATCHES = [
  [MODULES[0], MODULES[1]],
  [MODULES[2], MODULES[3]],
  [MODULES[4]],
]

const all = []
for (const batch of BATCHES) {
  log(`starting batch: ${batch.map((b) => b.slug).join(', ')}`)
  const res = await parallel(batch.map((m) => () => verifyModule(m)))
  for (const r of res.filter(Boolean)) {
    all.push(r)
    log(`${r.module}: ${r.recheck ? r.recheck.matchesOracle : 'RECHECK-FAILED'} (raised ${r.findingsRaised}, confirmed ${r.confirmedCount}, rejected ${r.rejectedCount})`)
  }
}

return all
