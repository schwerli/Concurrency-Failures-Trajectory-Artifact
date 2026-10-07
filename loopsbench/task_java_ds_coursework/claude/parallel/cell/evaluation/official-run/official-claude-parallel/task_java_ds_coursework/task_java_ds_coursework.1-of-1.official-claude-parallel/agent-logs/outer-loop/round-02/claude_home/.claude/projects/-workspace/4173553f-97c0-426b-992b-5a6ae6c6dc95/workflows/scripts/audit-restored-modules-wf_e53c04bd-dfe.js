export const meta = {
  name: 'audit-restored-modules',
  description: 'Audit 12 already-restored Java modules against decompiled references, fix what is wrong',
  phases: [
    { title: 'Audit', detail: 'compile + run + cross-check each module vs reference' },
    { title: 'Adversarial', detail: 'second opinion tries to break each passing module' },
  ],
}

const MODULES = args

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    compiles: { type: 'boolean' },
    ranSuccessfully: { type: 'boolean' },
    divergencesFromReference: { type: 'array', items: { type: 'string' } },
    bugsFound: { type: 'array', items: { type: 'string' } },
    fixesApplied: { type: 'array', items: { type: 'string' } },
    ok: { type: 'boolean' },
    evidence: { type: 'string', description: 'real observed program output' },
  },
  required: ['slug', 'compiles', 'ranSuccessfully', 'divergencesFromReference', 'bugsFound', 'fixesApplied', 'ok', 'evidence'],
}

const BREAK_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    stillOk: { type: 'boolean' },
    newProblems: { type: 'array', items: { type: 'string' } },
    fixesApplied: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
  required: ['slug', 'stillOk', 'newProblems', 'fixesApplied', 'evidence'],
}

const COMMON = `
Repo: /workspace - a Java data-structures course project (six lab experiments under Experiments/,
fifteen homework assignments under Homework/). Core algorithm bodies had been replaced with
\`throw new UnsupportedOperationException("TODO: implement")\`; a previous agent already restored
the ones in your module, but that work was NEVER verified or run. Assume it may be wrong.

The repo still ships the ORIGINAL compiled .class files from before the stubbing. They were
decompiled with CFR into /tmp/ref/<ModuleName>/. Those decompiled bodies are ground truth for
what the code should do (decompiled, so control flow looks mechanical and locals have synthetic
names like n, n2, string3 - compare SEMANTICS and PRINTED STRINGS, not formatting).

Build commands:
  cd <module dir> && LANG=C.UTF-8 javac -encoding UTF-8 -d /tmp/build/<yourname> ./*.java
  (LANG=C.UTF-8 is required - Chinese-named non-source files otherwise cause encoding errors.)
  Homework/DS01 and Homework/DS02_Matrix declare duplicate helper classes across files, so compile
  each entry-point .java on its own into its own output dir.
  Build into a scratch dir under /tmp - never overwrite the repo's shipped .class files, they are
  the reference and are tracked in git.

Driving stdin: many of these programs do \`new Scanner(System.in)\` inside the menu loop, which
discards buffered input, so piping a whole script at once loses lines and dies with
NoSuchElementException. Use \`bash /workspace/agent_tests/feed.sh <input-file> [delay]\` to pace it.
Always wrap runs in \`timeout 60\` so a menu loop cannot hang you.

Hard rules:
- NEVER run git add / commit / checkout / stash / reset / clean. The parent agent owns all git.
- Never delete or overwrite the shipped .class files or the data files (samples.txt, data.txt,
  order.txt, random.txt, etc). If a program mutates a data file as part of its job, restore it after.
- Only touch files in YOUR assigned module. Other agents work on other modules concurrently.
- Keep the file's existing idiom: Chinese comments and prompt strings stay Chinese, same spacing.
- Do not change method signatures, class names or field names.
`

const results = await pipeline(
  MODULES,
  (m) => agent(
    `${COMMON}

## Your module: ${m.slug}
Directory: /workspace/${m.mod}
Files: ${m.files}
Decompiled reference: ${m.ref}

Module-specific notes:
${m.note}

## What to do
1. Read every assigned source file in /workspace/${m.mod} in full.
2. Read the matching decompiled reference file(s) in ${m.ref}.
3. Compile the module. Fix any compile error.
4. RUN it for real against its data files, exercising as many code paths / menu branches as you can.
5. Cross-check every previously-stubbed method body against the reference. Report every semantic
   divergence: different loop bounds, missing branch, different printed text, different numeric
   formatting (e.g. String.format("%.2f") vs plain concatenation), different tie-breaking.
6. Check the output is actually CORRECT, not just non-crashing. Where the module has an invariant
   (sorted output, V-1 MST edges, lossless round trip, non-increasing extract-max, zero-slack
   critical path), test that invariant explicitly and show the result.
7. FIX everything you find, directly in the source file. Re-compile and re-run after each fix.

Set ok=true only if you personally watched it compile AND run correctly. evidence must be real
observed output pasted verbatim, not a description of what you expect.`,
    { label: `audit:${m.slug}`, phase: 'Audit', schema: AUDIT_SCHEMA, effort: 'high' }
  ),
  (a, m) => agent(
    `${COMMON}

## Your role: ADVERSARIAL SECOND OPINION for ${m.slug}
Directory: /workspace/${m.mod}   Reference: ${m.ref}
Module notes: ${m.note}

A prior auditor reported:
${JSON.stringify(a, null, 2)}

Your job is to try to BREAK it. Default to suspicion: assume the auditor was lazy, ran only the
happy path, and rationalised divergences it should have fixed. Specifically:
1. Re-verify zero \`TODO: implement\` stubs remain in the assigned files.
2. Re-compile yourself from a clean scratch output dir.
3. Run it yourself on inputs the auditor probably did NOT try: empty input, a single element,
   duplicate keys, the largest value in the data file, deleting a non-existent item, searching for
   something absent, an unbalanced/degenerate shape, boundary indices.
4. Line-by-line diff the previously-stubbed method bodies against the decompiled reference. Any
   divergence in semantics or in printed output is a defect unless you can prove it is equivalent.
5. Hunt specifically for: off-by-one loop bounds, \`<\` vs \`<=\`, a recursion that never terminates
   on some input, integer division where the reference used floating point, a swapped left/right
   child, a stale index after a delete, an exception caught and silently swallowed, a method that
   returns a plausible constant instead of computing anything.
6. Fix every real defect you find yourself, then re-verify.

Set stillOk=true only when you have personally observed a clean compile and a correct run after
your own fixes. evidence must be real observed output.`,
    { label: `break:${m.slug}`, phase: 'Adversarial', schema: BREAK_SCHEMA, effort: 'high' }
  )
)

const out = results.filter(Boolean)
log(`audited ${out.length}/${MODULES.length}: ${out.map(r => `${r.slug}=${r.stillOk ? 'ok' : 'FAIL'}`).join(', ')}`)
return out