export const meta = {
  name: 'restore-java-stubs',
  description: 'Restore remaining stubbed Java methods in 5 files, then adversarially verify each',
  phases: [
    { title: 'Restore', detail: 'one agent per stubbed file' },
    { title: 'Verify', detail: 'independent reviewer compiles + runs each module' },
  ],
}

const FILES = args

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    file: { type: 'string' },
    methodsImplemented: { type: 'array', items: { type: 'string' } },
    remainingStubs: { type: 'integer' },
    compiles: { type: 'boolean' },
    ranSuccessfully: { type: 'boolean' },
    runEvidence: { type: 'string', description: 'actual observed program output excerpt' },
    notes: { type: 'string' },
  },
  required: ['slug', 'file', 'methodsImplemented', 'remainingStubs', 'compiles', 'ranSuccessfully', 'runEvidence', 'notes'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    ok: { type: 'boolean' },
    remainingStubs: { type: 'integer' },
    compiles: { type: 'boolean' },
    ranSuccessfully: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
  required: ['slug', 'ok', 'remainingStubs', 'compiles', 'ranSuccessfully', 'problems', 'evidence'],
}

const COMMON = `
You are working in the git repo /workspace: a Java data-structures course project.
Core algorithm method bodies were replaced with \`throw new UnsupportedOperationException("TODO: implement")\`.
Your job is to RESTORE working implementations so the project compiles and behaves correctly.

Ground rules:
- Match the surrounding code's idiom, naming, comment density and language exactly. Many comments/strings are Chinese - keep that.
- Do NOT change method signatures, field names, class names, or any code that is not a stub.
- Do NOT add new files unless strictly required. Do NOT delete the shipped .class files.
- Compile with: cd <module dir> && LANG=C.UTF-8 javac -encoding UTF-8 -d /tmp/build/<name> ./*.java
  (LANG=C.UTF-8 avoids filename encoding errors from Chinese-named non-source files.)
- Homework/DS01 and Homework/DS02_Matrix declare duplicate helper classes across files, so compile
  each entry point .java on its own into its own output dir.
- Several programs create a fresh \`new Scanner(System.in)\` per menu iteration, which discards
  buffered input. To drive them, use \`bash agent_tests/feed.sh <input-file> [delay]\` which paces stdin.
- Programs that need a GUI (Swing) cannot be shown but should still compile; use \`-Djava.awt.headless=true\`
  only to check for non-GUI failures, and don't treat HeadlessException as your bug.
- NEVER commit. NEVER run git add/commit/checkout/stash/reset. The parent agent handles all git.
- Work only on your assigned file. Other agents are editing other files concurrently.
`

const results = await pipeline(
  FILES,
  (f) => agent(
    `${COMMON}

## Your assignment: ${f.slug}
Target file: /workspace/${f.stub}  (${f.stubs} remaining TODO stubs)

${f.hasRef
  ? `## A decompiled reference of the ORIGINAL implementation is available
The repo ships the original compiled .class files from before the stubbing. They have been
decompiled with CFR into: ${f.ref}
Read those .java files. They contain the EXACT original algorithm bodies (decompiled, so control
flow may look mechanical - e.g. while(true)/break instead of for, goto-ish labels, synthetic local
names like n, n2, string3). Your task:
  1. Read the stubbed file /workspace/${f.stub} fully.
  2. Read the corresponding decompiled reference file(s) in ${f.ref}.
  3. For each stubbed method, transcribe the reference body back into idiomatic Java that matches
     the style of the non-stubbed methods in the real source file. Preserve the exact semantics,
     exact printed strings (including Chinese text, spacing and punctuation), and exact numeric
     formatting from the reference.
  4. Rename decompiler-synthetic locals to readable names consistent with the file's style.
  5. Do not "improve" the algorithm - fidelity to the reference is what is being tested.`
  : `## No reference available - implement from scratch
${f.runNote}
Read the whole file plus its sibling files in the same directory for context. Infer each method's
contract from: its name, its signature, the fields it touches, the Chinese prompts/comments around
it, how callers use it, and any data files in the directory. Then write a correct, complete,
idiomatic implementation. Make the program actually work end-to-end when run.`}

## Runtime notes
${f.runNote}

## Definition of done (all required)
1. Zero occurrences of \`UnsupportedOperationException("TODO: implement")\` remain in your file.
   Verify with: grep -c 'TODO: implement' /workspace/${f.stub}
2. The module compiles cleanly (no errors).
3. You actually RAN the program and observed correct output. Drive its menus / stdin as needed.
   Do not claim success without pasting real observed output into runEvidence.
4. Sanity-check the algorithm's output against what the data files imply (e.g. a BST in-order walk
   must be sorted; an MST must have V-1 edges; a critical path must have zero slack throughout).

Return the structured result. runEvidence must be REAL output you observed, not a description.`,
    { label: `restore:${f.slug}`, phase: 'Restore', schema: RESULT_SCHEMA }
  ),
  (res, f) => agent(
    `${COMMON}

## Your role: INDEPENDENT VERIFIER for ${f.slug}
Another agent just claimed to restore /workspace/${f.stub}. Its self-report:
${JSON.stringify(res, null, 2)}

Do NOT trust that report. Verify it yourself from scratch, and be skeptical:
1. grep -c 'TODO: implement' /workspace/${f.stub}  -> must be 0.
2. Compile the module yourself. Report the exact error text if it fails.
3. RUN the program yourself against its real data files, driving stdin as needed.
   Exercise MULTIPLE code paths, not just the first menu option - insertion AND deletion AND
   search AND traversal, every menu branch you can reach.
4. Check for correctness bugs, not just "it didn't crash":
   - infinite loops / hangs (use timeout)
   - off-by-one in loop bounds
   - output that is silently wrong (unsorted "sorted" output, wrong averages, missing solutions,
     wrong edge counts, NullPointerException swallowed by a catch)
   - stubs replaced by a fake/degenerate implementation that merely returns a constant
5. ${f.hasRef ? `Cross-check the restored bodies against the decompiled reference in ${f.ref}.
   Flag any place where semantics or printed strings diverge from the reference.` : `Reason about whether the from-scratch implementation actually fulfils the module's stated purpose.`}

If you find real problems, FIX them yourself directly in the file (you have edit tools), re-verify,
and report what you fixed in problems[]. Only set ok=true when you have personally observed the
module compile and run correctly. evidence must be real observed output.`,
    { label: `verify:${f.slug}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' }
  )
)

const out = results.filter(Boolean)
log(`verified ${out.length}/${FILES.length}: ${out.map(r => `${r.slug}=${r.ok ? 'ok' : 'FAIL'}`).join(', ')}`)
return out