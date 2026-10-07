export const meta = {
  name: 'fix-pk-default-save-regression',
  description: 'Investigate Django #31135 pk-with-default save regression, design and adversarially judge the fix',
  phases: [
    { title: 'Investigate', detail: 'parallel read-only probes: regressing commit, raw/loaddata path, existing tests, docs' },
    { title: 'Design', detail: 'independent candidate fixes' },
    { title: 'Judge', detail: 'score candidates on compat, #29260 preservation, minimalism' },
    { title: 'Synthesize', detail: 'single recommended patch + test plan' },
  ],
}

const REPO = '/testbed'
const PY = '/opt/miniconda3/envs/testbed/bin/python'

const NOTE = `
CONTEXT (already established, do not re-derive):
- Repo: ${REPO} (Django at commit 47da189b5f, ~Django 3.1 dev). Python for running things: ${PY}
- Run tests like: cd ${REPO}/tests && ${PY} ./runtests.py <label> --parallel 1
- Bug (ticket #31135): with \`class Sample(models.Model): id = models.UUIDField(primary_key=True, default=uuid4)\`,
  \`s0 = Sample.objects.create(); s1 = Sample(pk=s0.pk, name='x'); s1.save()\` now does an INSERT (fails with
  IntegrityError) instead of the pre-3.0 UPDATE. Same for loaddata / raw saves of a fixture with an explicit pk
  that already exists in the DB. Both were confirmed reproduced.
- Cause: django/db/models/base.py Model._save_table() contains:
      updated = False
      # Skip an UPDATE when adding an instance and primary key has a default.
      if (
          not force_insert and
          self._state.adding and
          self._meta.pk.default and
          self._meta.pk.default is not NOT_PROVIDED
      ):
          force_insert = True
  introduced by commit 85458e94e3 "Fixed #29260 -- Skipped an UPDATE when adding a model instance with primary
  key that has a default."
YOU ARE READ-ONLY for this task: do NOT edit, write, or create any file in ${REPO}. Investigate only.
Scratch files under /tmp are fine.
`

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Tight prose summary of what you found' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'file:line or command output that proves it' },
        },
        required: ['claim', 'evidence'],
      },
    },
    risks: { type: 'array', items: { type: 'string' }, description: 'Things a fix could break' },
  },
  required: ['summary', 'facts'],
}

phase('Investigate')

const PROBES = [
  {
    key: 'regressing-commit',
    prompt: `${NOTE}
TASK: Reverse-engineer exactly what commit 85458e94e3 (ticket #29260) was trying to fix and what guards it.
- \`git show 85458e94e3\` in ${REPO}. Report the full diff including tests and docs/release notes touched.
- Identify EVERY test in the repo that would fail if that force_insert block were removed entirely. Prove it:
  actually try it in a scratch git worktree or by stashing (do NOT leave ${REPO} modified — if you must
  experiment, use \`git stash\` and restore, or better: \`git worktree add /tmp/wt-probe1 HEAD\` and edit THERE).
  Run the relevant test labels and report which fail.
- Explain the semantics #29260 wanted: why must a fresh instance whose pk comes from a default skip the UPDATE?`,
  },
  {
    key: 'raw-path',
    prompt: `${NOTE}
TASK: Map the \`raw=True\` save path and its interaction with \`_state.adding\`.
- Trace how loaddata / django.core.serializers deserialization saves objects: which code sets raw=True
  (django/core/serializers/base.py DeserializedObject.save, python.py, etc.), and what \`_state.adding\` is at
  that moment for an object built by a deserializer with an explicit pk.
- Confirm empirically (scratch script in /tmp using ${PY}) that during a raw save of an existing pk,
  \`self._state.adding\` is True and the force_insert block therefore fires.
- Document the historical contract of raw saves: was loaddata always expected to UPDATE existing rows
  (i.e. loading the same fixture twice is idempotent)? Find tests/docs that assert fixture re-loading works
  (e.g. tests/fixtures, tests/fixtures_regress, tests/serializers). Cite them.
- Report whether \`raw\` is ever True outside deserialization.`,
  },
  {
    key: 'existing-tests',
    prompt: `${NOTE}
TASK: Inventory the existing test coverage for "save an instance whose pk field has a default".
- grep the tests/ tree for tests touching pk defaults + save/force_insert/_state.adding
  (candidates: tests/basic/, tests/custom_pk/, tests/model_fields/, tests/serializers/, tests/fixtures/,
   tests/fixtures_regress/, tests/get_or_create/, tests/queries/).
- For each, quote the test name, file:line, and what behavior it pins.
- Then answer precisely: is there ANY existing test that asserts the *current* (3.0) behavior for a
  NON-raw save with an explicitly-provided pk equal to an existing row? Or for a RAW save of an existing pk?
- Also list the models in tests/ that have a primary key with a default (e.g. UUIDField(primary_key=True,
  default=uuid4)) — these are candidate fixtures for a regression test.`,
  },
  {
    key: 'docs-and-intent',
    prompt: `${NOTE}
TASK: Find what the documentation and release notes in this repo say about this behavior, to determine the
project's *intended* contract.
- grep docs/ for the #29260 change: docs/releases/3.0.txt (backwards incompatible section), docs/ref/models/
  instances.txt (saving objects / "Explicitly specifying auto-primary-key values" / how Django decides
  INSERT vs UPDATE), docs/topics/db/queries.txt, docs/ref/models/fields.txt.
- Quote the exact passages with file:line.
- Key question to answer with evidence: does the documented contract say that providing an explicit pk on a
  NEW instance should UPDATE-then-INSERT, or is forcing INSERT the documented intent for pk-with-default?
  Is there a docs sentence that a fix would need to add or amend?
- Also check docs/releases/3.0.*.txt and docs/releases/3.1.txt to see where a bugfix release note would go.`,
  },
]

const findings = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Investigate', schema: FINDINGS })
    .then(r => ({ key: p.key, ...r }))
))

const good = findings.filter(Boolean)
log(`investigation done: ${good.length}/${PROBES.length} probes returned`)

const brief = good.map(f => `### ${f.key}\n${f.summary}\nFACTS:\n${(f.facts || []).map(x => `- ${x.claim} [${x.evidence}]`).join('\n')}\nRISKS:\n${(f.risks || []).map(r => `- ${r}`).join('\n')}`).join('\n\n')

phase('Design')

const CANDIDATE = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    diff: { type: 'string', description: 'Exact unified diff against django/db/models/base.py (and docs if needed)' },
    rationale: { type: 'string' },
    behaviorTable: { type: 'string', description: 'What each scenario does after the fix: (a) new instance no explicit pk, (b) new instance explicit pk, row absent, (c) new instance explicit pk, row present, (d) raw/loaddata explicit pk row present, (e) fetched instance saved' },
    preserves29260: { type: 'string', description: 'Why the #29260 optimization still holds, with the specific test names that still pass' },
    testsRun: { type: 'string', description: 'Test labels you actually ran in a throwaway worktree and their results' },
    tradeoffs: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'diff', 'rationale', 'behaviorTable', 'preserves29260'],
}

const ANGLES = [
  { key: 'minimal-upstream', angle: `Aim for the SMALLEST change that restores backwards compatibility where it is clearly a bug, and nothing more. Consider that the Django project may have decided the non-raw explicit-pk INSERT is *intended* (documented in the 3.0 release notes) while the raw/loaddata breakage is unambiguously a regression. If so, the fix is to exclude raw saves. Argue for or against also changing the non-raw case, based on the documented contract.` },
  { key: 'explicit-pk-tracking', angle: `Aim for full backwards compatibility as the reporter requests: the force_insert shortcut should only apply when the pk value was actually GENERATED by the field default, not when the caller supplied an explicit pk. Design that (e.g. detect at __init__/_save_table whether pk_val came from the default, via get_pk_value_on_save / a _state flag / comparing to what the default would produce). Be honest about the cost and the edge cases (deferred fields, model inheritance, from_db, copy/pickle, refresh_from_db).` },
  { key: 'semantics-first', angle: `Reason from first principles about what INSERT-vs-UPDATE should mean, then pick the fix. Consider the three signals available: force_insert, _state.adding, pk explicitly set. Consider what other ORMs and what Model.save()'s documented algorithm promise. Also consider whether the right answer touches _state.adding for deserialized objects instead of _save_table.` },
]

const candidates = await parallel(ANGLES.map(a => () =>
  agent(`${NOTE}

INVESTIGATION BRIEF (from parallel read-only probes — verify anything you rely on):
${brief}

TASK: Propose ONE concrete fix for ticket #31135, from this specific angle:
${a.angle}

Requirements:
- Read django/db/models/base.py yourself before proposing.
- Produce an exact unified diff. Keep the codebase's style (this era of Django uses trailing \`and\` at
  end of line inside multi-line boolean conditions).
- VALIDATE your candidate: \`git worktree add /tmp/wt-${a.key} HEAD\`, apply your diff THERE, and run the
  affected suites, at minimum:
    cd /tmp/wt-${a.key}/tests && ${PY} ./runtests.py basic serializers fixtures fixtures_regress model_fields custom_pk get_or_create many_to_many one_to_one model_inheritance --parallel 1
  plus a scratch reproduction of all five scenarios in the behavior table. Report REAL output. Clean up the
  worktree when done (\`git worktree remove --force /tmp/wt-${a.key}\`).
- Do NOT modify ${REPO} itself.`,
    { label: `design:${a.key}`, phase: 'Design', schema: CANDIDATE, effort: 'high' })
    .then(r => (r ? { key: a.key, ...r } : null))
))

const cands = candidates.filter(Boolean)
log(`designed ${cands.length} candidates: ${cands.map(c => c.key).join(', ')}`)

phase('Judge')

const VERDICT = {
  type: 'object',
  properties: {
    ranking: { type: 'array', items: { type: 'string' }, description: 'candidate keys, best first' },
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          score: { type: 'number', description: '0-10' },
          verdict: { type: 'string' },
          fatalFlaws: { type: 'array', items: { type: 'string' } },
        },
        required: ['key', 'score', 'verdict'],
      },
    },
    recommendation: { type: 'string' },
  },
  required: ['ranking', 'scores', 'recommendation'],
}

const candText = cands.map(c => `### candidate: ${c.key} — ${c.name}\nRATIONALE: ${c.rationale}\nDIFF:\n${c.diff}\nBEHAVIOR:\n${c.behaviorTable}\nPRESERVES #29260: ${c.preserves29260}\nTESTS RUN: ${c.testsRun || 'n/a'}\nTRADEOFFS: ${(c.tradeoffs || []).join('; ')}`).join('\n\n')

const LENSES = [
  { key: 'upstream-fidelity', prompt: `Judge which candidate matches what the Django core team would actually accept and merge for ticket #31135. Weigh: minimalism, whether it touches public API/behavior beyond the bug, whether it needs a deprecation, whether the docs already commit to the 3.0 behavior for the non-raw case. A patch that is "more backwards compatible" but re-breaks #29260 or adds a hidden state flag is worse than a two-word condition change.` },
  { key: 'correctness-regression', prompt: `Judge purely on correctness. For each candidate, hunt for a scenario where it produces a WRONG query: multi-table inheritance (parent pk with default, child save), \`force_insert=True\`, \`update_fields\`, \`Model.objects.bulk_create\`, \`refresh_from_db\` then save, deserialized objects with natural keys, \`pk\` set to a value that does not exist yet (must still INSERT, not silently no-op), and the "two INSERTs" original #29260 case. Try to REFUTE each candidate's claims. Prefer refuted=true when uncertain.` },
  { key: 'test-coverage', prompt: `Judge on testability and the quality of the regression test each candidate implies. Which candidate can be pinned by a clear, fast, non-flaky test in this repo's existing suites (tests/basic, tests/serializers, tests/fixtures)? Name the exact test file, test class, and assertions you'd add for the winner. Penalize candidates whose behavior is hard to assert or that would require new test models.` },
]

const verdicts = await parallel(LENSES.map(l => () =>
  agent(`${NOTE}

INVESTIGATION BRIEF:
${brief}

CANDIDATE FIXES:
${candText}

TASK (lens: ${l.key}): ${l.prompt}

Score every candidate 0-10 and rank them. Be adversarial and concrete. Verify code claims against the repo
(read-only). Re-run a test yourself in a scratch worktree if a candidate's claimed test results look wrong.`,
    { label: `judge:${l.key}`, phase: 'Judge', schema: VERDICT, effort: 'high' })
    .then(r => (r ? { key: l.key, ...r } : null))
))

const vs = verdicts.filter(Boolean)
log(`judged by ${vs.length} lenses`)

phase('Synthesize')

const FINAL = {
  type: 'object',
  properties: {
    chosen: { type: 'string' },
    finalDiff: { type: 'string', description: 'The exact final source diff to apply to /testbed, including docs changes if warranted' },
    testDiff: { type: 'string', description: 'The exact test additions to apply, with file paths' },
    justification: { type: 'string' },
    behaviorAfter: { type: 'string' },
    knownLimitations: { type: 'string', description: 'Anything the fix deliberately does NOT change, and why — e.g. the non-raw explicit-pk case' },
    verification: { type: 'string', description: 'Real command output from validating the final combined patch in a worktree' },
  },
  required: ['chosen', 'finalDiff', 'testDiff', 'justification', 'behaviorAfter', 'knownLimitations'],
}

const final = await agent(`${NOTE}

INVESTIGATION BRIEF:
${brief}

CANDIDATES:
${candText}

JUDGE VERDICTS:
${vs.map(v => `### lens ${v.key}\nranking: ${v.ranking.join(' > ')}\n${v.scores.map(s => `- ${s.key}: ${s.score}/10 — ${s.verdict}${(s.fatalFlaws || []).length ? ' FLAWS: ' + s.fatalFlaws.join('; ') : ''}`).join('\n')}\nrecommendation: ${v.recommendation}`).join('\n\n')}

TASK: Produce the FINAL patch for ticket #31135. Pick the winning candidate (you may graft the best parts of
runners-up). Then PROVE it in a throwaway worktree:
  git worktree add /tmp/wt-final HEAD
  (apply source + test diff there)
  cd /tmp/wt-final/tests && ${PY} ./runtests.py basic serializers fixtures fixtures_regress model_fields custom_pk get_or_create model_inheritance many_to_many one_to_one queries defer --parallel 1
  (plus the /tmp scratch reproduction of the ticket showing UPDATE now happens where it should)
Report the REAL command output in \`verification\`. Also confirm the new tests FAIL on unpatched HEAD (that is
what makes them regression tests) — show that output too. Clean up the worktree at the end.
Do NOT modify ${REPO}. Give me diffs only.`,
  { label: 'synthesize', phase: 'Synthesize', schema: FINAL, effort: 'high' })

return { final, rankings: vs.map(v => ({ lens: v.key, ranking: v.ranking })), candidates: cands.map(c => c.key) }
