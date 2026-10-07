export const meta = {
  name: 'fix-runxfail-skip-location',
  description: 'Analyze --runxfail vs skip-location bug in _pytest/skipping.py, design + judge candidate patches',
  phases: [
    { title: 'Understand', detail: 'map runxfail semantics, existing tests, regression surface' },
    { title: 'Design', detail: '3 independent candidate patches' },
    { title: 'Judge', detail: 'score candidates on correctness + minimality' },
  ],
}

const REPO = '/testbed'
const CTX = `
Repo: ${REPO} (pytest, version 5.4.x dev). Python: /opt/miniconda3/envs/testbed/bin/python

BUG REPORT:
Using \`pytest -rs\` on:
    import pytest
    @pytest.mark.skip
    def test_skip_location(): assert 0
correctly reports \`SKIPPED [1] test_it.py:2: unconditional skip\`.
But \`pytest -rs --runxfail\` reports \`SKIPPED [1] src/_pytest/skipping.py:239: unconditional skip\`
i.e. the location points inside pytest itself instead of the test item.
--runxfail is only about xfail and must not affect skip-location reporting.

ROOT CAUSE (already confirmed): in src/_pytest/skipping.py, hook pytest_runtest_makereport,
the branch \`elif item.config.option.runxfail: pass  # don't interfere\` short-circuits the
whole if/elif chain, so the FINAL elif branch (which rewrites rep.longrepr location for
mark.skip/skipif) is never reached when --runxfail is given.
`.trim()

phase('Understand')

const UNDERSTAND_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'string', description: 'Detailed prose findings' },
    files: { type: 'array', items: { type: 'string' }, description: 'file:line references that matter' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings', 'files', 'risks'],
  additionalProperties: false,
}

const LENSES = [
  {
    key: 'semantics',
    prompt: `${CTX}

TASK: Read src/_pytest/skipping.py in full. Explain precisely what each branch of the
if/elif chain in pytest_runtest_makereport does, and exactly which of those branches the
--runxfail option is *legitimately* meant to disable. Enumerate every behavior that
--runxfail is documented/intended to change (check its help text, docs/ under doc/en for
runxfail, and the code in pytest_configure / pytest_runtest_setup / pytest_runtest_call).
Be explicit about whether the unittest 'unexpectedsuccess' branch and the skip-location
branch should be affected by --runxfail. Report file:line refs.`,
  },
  {
    key: 'tests',
    prompt: `${CTX}

TASK: Read testing/test_skipping.py (and any other test file touching runxfail or skip
locations, e.g. grep -rn "runxfail" testing/ and grep -rn "skipped_by_mark_key\\|reportinfo"
across src/ and testing/). Catalogue EVERY existing test that exercises --runxfail or the
skip-location rewriting. For each, state what output it asserts, so we know what must not
regress. Also identify where a new regression test for this bug should live (exact class /
naming convention used in that file) and sketch it in the file's existing style.`,
  },
  {
    key: 'history',
    prompt: `${CTX}

TASK: Use git log/git blame in ${REPO} to trace the history of the pytest_runtest_makereport
hook in src/_pytest/skipping.py — in particular when \`elif item.config.option.runxfail: pass\`
was introduced and when the skip-location rewriting branch was introduced, and whether they
ever coexisted correctly. Also check the changelog/ directory for the project's changelog-fragment
convention (file naming, e.g. <issue>.bugfix.rst) so a fragment can be added. Report the exact
convention with an example of existing fragment content.`,
  },
  {
    key: 'consumers',
    prompt: `${CTX}

TASK: Find every consumer of the report longrepr-as-3-tuple for skipped tests, to understand
the blast radius of changing when the location rewrite happens. Grep src/_pytest for places
that read \`longrepr\` on skipped reports (terminal.py short summary -rs, junitxml.py,
reports.py serialization, resultlog if present). Also check skipped_by_mark_key usages.
Explain what \`item._store.get(skipped_by_mark_key, True)\` defaulting to True means and which
non-mark skips (pytest.skip() calls in test body, skip during collection, module-level
pytest.skip(allow_module_level=True), --strict skip in setup fixtures) reach that branch.
Report file:line refs.`,
  },
]

const understood = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `understand:${l.key}`, phase: 'Understand', schema: UNDERSTAND_SCHEMA })))

const brief = LENSES.map((l, i) => understood[i]
  ? `### ${l.key}\n${understood[i].findings}\nFILES: ${understood[i].files.join(', ')}\nRISKS: ${understood[i].risks.join(' | ')}`
  : `### ${l.key}\n(no result)`).join('\n\n')

phase('Design')

const PATCH_SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string', description: 'One-paragraph description of the restructuring' },
    newHookSource: { type: 'string', description: 'The complete new source of pytest_runtest_makereport, verbatim, ready to paste' },
    rationale: { type: 'string' },
    behaviorTable: { type: 'string', description: 'Table: (runxfail on/off) x (skip mark, skipif mark, bare pytest.skip in body, xfail mark fail, xfail mark pass, xfail() call, unittest unexpectedsuccess) -> expected outcome + location' },
    testsToAdd: { type: 'string', description: 'Verbatim test code to add to testing/test_skipping.py' },
  },
  required: ['approach', 'newHookSource', 'rationale', 'behaviorTable', 'testsToAdd'],
  additionalProperties: false,
}

const ANGLES = [
  'MINIMAL-DIFF angle: change as few lines as possible. Prefer moving/duplicating only what is strictly needed so the skip-location rewrite runs regardless of --runxfail.',
  'CLARITY angle: restructure the chain so that the runxfail guard is scoped narrowly to only the xfail branches (e.g. nest the xfail handling under `if not item.config.option.runxfail`), making the skip-location rewrite a sibling top-level concern. Optimize for a reader understanding intent.',
  'INVARIANT angle: first write down the invariants the hook must satisfy for every (option, marker, outcome) combination, then derive the control flow from those invariants. Consider whether `item._store.get(skipped_by_mark_key, True)` default-True is itself a latent bug and say so, but do not change behavior beyond the reported bug unless it is provably a bug.',
]

const candidates = await parallel(ANGLES.map((angle, i) => () =>
  agent(`${CTX}

RESEARCH BRIEF from the understand phase:
${brief}

TASK: Design a patch for src/_pytest/skipping.py's pytest_runtest_makereport so that
--runxfail no longer breaks skip-location reporting. Do NOT edit any files — return the
proposed source text only.

Take this specific angle: ${angle}

Hard requirements:
- With and without --runxfail, mark.skip / mark.skipif skips must report the item's own location.
- --runxfail must still make xfail-marked failing tests report as plain failures, xfail-marked
  passing tests as plain passes, and pytest.xfail() calls a no-op, with no 'wasxfail' attribute set.
- The unittest unexpectedsuccess branch must keep working.
- A bare pytest.skip() inside a test body must NOT get its location rewritten (it should keep
  pointing at the skip call site) — verify how skipped_by_mark_key governs this and preserve it.
- Match the surrounding code style; keep the explanatory comments accurate.
Read the actual file at ${REPO}/src/_pytest/skipping.py before answering.`,
    { label: `design:${i + 1}`, phase: 'Design', schema: PATCH_SCHEMA })))

const alive = candidates.filter(Boolean)

phase('Judge')

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      properties: {
        correctness: { type: 'number' },
        minimality: { type: 'number' },
        clarity: { type: 'number' },
      },
      required: ['correctness', 'minimality', 'clarity'],
      additionalProperties: false,
    },
    defects: { type: 'array', items: { type: 'string' }, description: 'Concrete defects: input -> wrong behavior' },
    bestIdeasToGraft: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
  required: ['scores', 'defects', 'bestIdeasToGraft', 'verdict'],
  additionalProperties: false,
}

const judged = await parallel(alive.flatMap((c, i) =>
  ['correctness-skeptic', 'regression-hunter', 'style-reviewer'].map(lens => () =>
    agent(`${CTX}

CANDIDATE PATCH #${i + 1} (${lens} review):
APPROACH: ${c.approach}
PROPOSED HOOK SOURCE:
\`\`\`python
${c.newHookSource}
\`\`\`
CLAIMED BEHAVIOR TABLE:
${c.behaviorTable}
PROPOSED TESTS:
\`\`\`python
${c.testsToAdd}
\`\`\`

TASK: Review as a ${lens}. Try hard to REFUTE that this patch is correct. Read the real
${REPO}/src/_pytest/skipping.py and the existing testing/test_skipping.py to ground your
review. Specifically check: does it break any existing test in testing/test_skipping.py?
Does the proposed test code use the right fixtures/idioms for this repo version (e.g.
testdir vs pytester)? Are the claimed behaviors actually what the code produces — trace it.
Default to reporting a defect if you are uncertain. Score 0-10 each.`,
      { label: `judge:c${i + 1}:${lens}`, phase: 'Judge', schema: VERDICT_SCHEMA }))))

const byCand = alive.map((c, i) => {
  const vs = judged.slice(i * 3, i * 3 + 3).filter(Boolean)
  const avg = k => vs.length ? vs.reduce((s, v) => s + v.scores[k], 0) / vs.length : 0
  return {
    index: i + 1,
    approach: c.approach,
    newHookSource: c.newHookSource,
    behaviorTable: c.behaviorTable,
    testsToAdd: c.testsToAdd,
    scores: { correctness: avg('correctness'), minimality: avg('minimality'), clarity: avg('clarity') },
    total: avg('correctness') * 2 + avg('minimality') + avg('clarity'),
    defects: vs.flatMap(v => v.defects),
    graft: vs.flatMap(v => v.bestIdeasToGraft),
  }
})

byCand.sort((a, b) => b.total - a.total)
log(`ranked: ${byCand.map(c => `#${c.index}=${c.total.toFixed(1)}`).join(' ')}`)

return { brief, ranked: byCand }
