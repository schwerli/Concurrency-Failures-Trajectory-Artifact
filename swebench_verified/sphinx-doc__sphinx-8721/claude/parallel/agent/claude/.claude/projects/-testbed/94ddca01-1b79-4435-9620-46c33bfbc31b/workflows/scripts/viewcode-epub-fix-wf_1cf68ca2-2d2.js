export const meta = {
  name: 'viewcode-epub-fix',
  description: 'Diagnose and design the fix for viewcode generating epub module pages despite viewcode_enable_epub=False',
  phases: [
    { title: 'Investigate', detail: 'parallel readers over epub builder, env caching, viewcode config' },
    { title: 'Verify', detail: 'adversarially refute each diagnosis claim' },
    { title: 'Design', detail: 'independent candidate fixes + judge' },
  ],
}

const DIAG_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'file:line references and code quotes' },
          relevance: { type: 'string' },
        },
        required: ['claim', 'evidence', 'relevance'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    correction: { type: 'string', description: 'if refuted, what is actually true' },
  },
  required: ['refuted', 'reasoning'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string' },
    diff: { type: 'string', description: 'exact code to add/change, with file and location' },
    tradeoffs: { type: 'string' },
    edge_cases: { type: 'string' },
    test_plan: { type: 'string' },
  },
  required: ['approach', 'diff', 'tradeoffs', 'edge_cases', 'test_plan'],
}

const LENSES = [
  {
    key: 'epub-builder-inheritance',
    prompt: `In the Sphinx repo at /testbed, investigate the epub builder class hierarchy.
Specifically: does sphinx/builders/epub3.py's Epub3Builder (and _epub_base.EpubBuilder) inherit from StandaloneHTMLBuilder?
Does it therefore emit the 'html-collect-pages' event? Find where 'html-collect-pages' is emitted (sphinx/builders/html/__init__.py) and confirm whether the epub builder path reaches it.
Also report: what is builder.name for epub builds ('epub'), and what is out_suffix for epub builders?
Report concrete file:line evidence.`,
  },
  {
    key: 'env-sharing-across-builders',
    prompt: `In the Sphinx repo at /testbed, investigate how the BuildEnvironment is shared/persisted across multiple builders in one 'make html epub' invocation.
Key questions:
1. Is the env pickled to <outdir>/../doctrees/environment.pickle and reused by the second builder? Find the code (sphinx/application.py, sphinx/builders/__init__.py, sphinx/environment/__init__.py).
2. If the html build ran doctree_read and populated env._viewcode_modules, will the epub build see that populated attribute? Does the epub build re-run doctree-read for unchanged documents (i.e. are doctrees re-read from cache, skipping the doctree-read event)?
3. Confirm: doctree-read fires only on parse/read of a source file, not when loading a cached doctree. Find where 'doctree-read' is emitted.
Report concrete file:line evidence.`,
  },
  {
    key: 'viewcode-code-paths',
    prompt: `Read /testbed/sphinx/ext/viewcode.py carefully. Trace every function and identify exactly which ones guard against epub builds and which do not.
Specifically compare doctree_read() (lines ~53-61) against collect_pages() (lines ~181+) and should_generate_module_page().
Question: when 'make html epub' runs, which viewcode function actually writes the _modules/*.xhtml pages into the epub output? Explain the precise mechanism by which epub module pages get created even though doctree_read returned early.
Also note: does collect_pages check app.builder.name at all? Does it check viewcode_enable_epub at all?
Report concrete file:line evidence.`,
  },
  {
    key: 'similar-guards-elsewhere',
    prompt: `In the Sphinx repo at /testbed, search for other places in the codebase that guard behavior on epub builders, e.g. patterns like:
- \`app.builder.name.startswith("epub")\`
- \`builder.name == 'epub'\`
- config values like *_enable_epub
Look at sphinx/ext/ and sphinx/builders/. Report the idiomatic pattern this codebase uses for "skip this for epub unless enabled".
Also check sphinx/ext/graphviz.py, sphinx/ext/imgmath.py, or similar for builder-name guards in html-collect-pages / build-finished handlers.
Report concrete file:line evidence with the exact idiom used.`,
  },
  {
    key: 'test-infrastructure',
    prompt: `In the Sphinx repo at /testbed, investigate how to write a pytest test that reproduces "make html epub" — i.e. building the SAME testroot with the html builder and then the epub builder, sharing the environment.
Look at tests/test_ext_viewcode.py and other tests that use @pytest.mark.sphinx with buildername='epub' (grep tests/ for 'epub'). Look at sphinx/testing/fixtures.py and sphinx/testing/path.py to understand how app/outdir/doctreedir are set up, and whether two @pytest.mark.sphinx apps can share a srcdir/doctreedir.
Report: the exact idiom for a test that builds html then epub over the same testroot, and how to assert that _modules pages were NOT written to the epub outdir. Include what file extension epub pages use.
Report concrete file:line evidence and a concrete test skeleton.`,
  },
]

phase('Investigate')

const verified = await pipeline(
  LENSES,
  lens => agent(lens.prompt, { label: `investigate:${lens.key}`, phase: 'Investigate', schema: DIAG_SCHEMA }),
  (diag, lens) => {
    if (!diag || !diag.findings) return []
    return parallel(diag.findings.map(f => () =>
      agent(`You are an adversarial verifier working in the Sphinx repo at /testbed.

Another agent claims:
CLAIM: ${f.claim}
EVIDENCE OFFERED: ${f.evidence}

Independently verify this by reading the actual source files. Try hard to REFUTE it. Check that the cited file:line actually says what is claimed. If the claim is subtly wrong (wrong class, wrong event name, wrong inheritance, wrong config default), mark refuted=true and give the correction.
Default to refuted=true if you cannot confirm it from source.`,
        { label: `verify:${lens.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then(v => ({ lens: lens.key, ...f, verdict: v }))
    ))
  }
)

const confirmed = verified.flat().filter(Boolean).filter(f => f.verdict && !f.verdict.refuted)
const refuted = verified.flat().filter(Boolean).filter(f => f.verdict && f.verdict.refuted)

log(`${confirmed.length} confirmed findings, ${refuted.length} refuted`)

const context = confirmed.map(f => `[${f.lens}] ${f.claim}\n  evidence: ${f.evidence}`).join('\n')
const corrections = refuted.map(f => `[${f.lens}] REFUTED: ${f.claim}\n  correction: ${f.verdict.correction || f.verdict.reasoning}`).join('\n')

phase('Design')

const ANGLES = [
  'Minimal-change: the smallest possible guard added to collect_pages(), mirroring the existing doctree_read() guard idiom exactly.',
  'Correctness-first: consider that env._viewcode_modules is shared across builders via the pickled environment. Where is the RIGHT place to prevent epub module pages -- collect_pages, should_generate_module_page, a builder-inited hook, or somewhere else? Consider also whether the html build should be unaffected and whether viewcode_enable_epub=True must still work.',
  'Upstream-fidelity: what would the Sphinx maintainers (tk0miya) most plausibly have committed for this bug report? Consider CHANGES entry, the exact guard placement, and the test they would add. Keep it idiomatic to this codebase.',
]

const candidates = (await parallel(ANGLES.map((angle, i) => () =>
  agent(`You are fixing a real Sphinx bug in the repo at /testbed.

BUG REPORT:
"viewcode creates pages for epub even if viewcode_enable_epub=False on \`make html epub\`.
Expected behavior: module pages should not be created for epub by default."

CONFIRMED DIAGNOSIS (independently verified):
${context}

${corrections ? `CLAIMS THAT WERE REFUTED (do not rely on these):\n${corrections}\n` : ''}

YOUR ANGLE: ${angle}

Read /testbed/sphinx/ext/viewcode.py and produce a concrete fix. Give the EXACT code change (old lines -> new lines) with precise placement. Also propose the test to add to /testbed/tests/test_ext_viewcode.py and any new testroot files needed, plus a CHANGES entry.
Be precise about: builder.name values for epub ('epub' via Epub3Builder), the config name viewcode_enable_epub, and the fact that collect_pages is an html-collect-pages handler.`,
    { label: `design:${i + 1}`, phase: 'Design', schema: FIX_SCHEMA })
))).filter(Boolean)

const judged = await parallel(candidates.map((c, i) => () =>
  agent(`Score this proposed fix for the Sphinx viewcode/epub bug, 0-10, on: correctness, minimality, idiomatic fit with the codebase, and whether viewcode_enable_epub=True still works.

PROPOSAL ${i + 1}:
approach: ${c.approach}
diff: ${c.diff}
tradeoffs: ${c.tradeoffs}
edge cases: ${c.edge_cases}
test plan: ${c.test_plan}

Read /testbed/sphinx/ext/viewcode.py to check it. Return JSON with score, strengths, weaknesses, and any bug in the proposed diff.`,
    { label: `judge:${i + 1}`, phase: 'Design', schema: {
      type: 'object',
      properties: {
        score: { type: 'number' },
        strengths: { type: 'string' },
        weaknesses: { type: 'string' },
        bugs_in_diff: { type: 'string' },
      },
      required: ['score', 'strengths', 'weaknesses'],
    } })
    .then(v => ({ index: i + 1, candidate: c, judgment: v }))
))

const ranked = judged.filter(Boolean).sort((a, b) => (b.judgment.score || 0) - (a.judgment.score || 0))

return {
  confirmed_diagnosis: confirmed.map(f => ({ lens: f.lens, claim: f.claim, evidence: f.evidence })),
  refuted_claims: refuted.map(f => ({ lens: f.lens, claim: f.claim, correction: f.verdict.correction })),
  ranked_fixes: ranked.map(r => ({
    rank_score: r.judgment.score,
    approach: r.candidate.approach,
    diff: r.candidate.diff,
    edge_cases: r.candidate.edge_cases,
    test_plan: r.candidate.test_plan,
    judge_strengths: r.judgment.strengths,
    judge_weaknesses: r.judgment.weaknesses,
    judge_bugs: r.judgment.bugs_in_diff,
  })),
}
