export const meta = {
  name: 'sqlite-unique-addfield-investigation',
  description: 'Exhaustively investigate the SQLite "Cannot add a UNIQUE column" AddField regression and design the correct fix',
  phases: [
    { title: 'Understand', detail: 'parallel readers over sqlite schema editor, base schema editor, regression commit, tests, sqlite ALTER TABLE limits' },
    { title: 'Design', detail: 'independent candidate fixes' },
    { title: 'Judge', detail: 'score candidates adversarially' },
  ],
}

const READERS = [
  {
    key: 'regression-commit',
    prompt: `In the Django repo at /testbed, investigate commit 2f73e5406d ("Refs #32502 -- Avoided table rebuild when adding fields with no default on SQLite.") and commit 4e249d11a6.
Report:
1. The exact diff of 2f73e5406d (all files, including tests).
2. What the sqlite3 DatabaseSchemaEditor.add_field looked like BEFORE that commit vs after (use git show 2f73e5406d^:django/db/backends/sqlite3/schema.py and grep add_field).
3. What tests that commit added/changed.
4. Whether the pre-commit behavior always called _remake_table (i.e., was the old add_field unconditionally remaking the table?).
Return a precise factual report with exact code snippets.`,
  },
  {
    key: 'base-schema-editor',
    prompt: `In /testbed, read django/db/backends/base/schema.py carefully. Report on:
1. The full body of add_field() — exactly how UNIQUE ends up in the ALTER TABLE ADD COLUMN statement. Trace column_sql() and _iter_column_sql() and where field.unique / _unique_sql / _create_unique_sql are used.
2. How unique is handled: is it inline in the column definition, or via deferred sql? Look at connection.features.supports_deferrable_unique_constraints, and any features flags about adding unique columns.
3. The full body of column_sql() and _iter_column_sql() with exact line numbers.
4. Any existing feature flag in django/db/backends/base/features.py or sqlite3/features.py related to unique columns / ALTER TABLE ADD COLUMN restrictions (e.g. supports_virtual_generated_columns, can_create_inline_fk, etc.). List every relevant flag name and its sqlite3 override.
Return exact snippets with file:line references.`,
  },
  {
    key: 'sqlite-limits',
    prompt: `Research (from your knowledge and from any docs/comments inside /testbed) the exact restrictions SQLite places on "ALTER TABLE ... ADD COLUMN". Enumerate ALL of them (from sqlite.org/lang_altertable.html): e.g. cannot be PRIMARY KEY, cannot be UNIQUE, cannot have certain defaults, cannot be NOT NULL without default, generated column restrictions, FK with NOT NULL default restrictions.
Then check /testbed/django/db/backends/sqlite3/schema.py add_field() and report which of those restrictions Django currently guards against and which it does NOT guard against. Be exhaustive — there may be more than one unguarded case.
Also grep /testbed for "Cannot add a UNIQUE column" and any existing handling.
Return a checklist mapping each SQLite restriction -> guarded or not, with file:line evidence.`,
  },
  {
    key: 'tests',
    prompt: `In /testbed, find all existing tests relevant to adding a unique/OneToOne field to an existing model.
1. In tests/schema/tests.py grep for tests like test_add_field_unique, test_add_field, test_add_unique, OneToOneField add, "unique=True" combined with add_field.
2. In tests/migrations/test_operations.py grep for AddField with unique / OneToOneField.
3. Identify the best existing test to model a new regression test on: give exact test method name, file, line range, and full source.
4. Note test helper decorators used (e.g. @isolate_apps, skipUnlessDBFeature) and how tests assert the number of executed statements or use CaptureQueriesContext.
5. Report how tests/schema/tests.py defines models (Author, Book, etc.) and whether there's a Note/Tag model with a OneToOne.
Return exact test source snippets with file:line.`,
  },
  {
    key: 'callers',
    prompt: `In /testbed, find every call site and override of add_field in database backends and check for interactions:
1. grep -rn "def add_field" django/
2. Read django/db/backends/sqlite3/schema.py add_field and _remake_table fully; explain what _remake_table does with a create_field that is unique (does create_model emit the unique index as deferred sql, and does _remake_table run deferred sql?).
3. Check django/db/migrations/operations/fields.py AddField.database_forwards.
4. Determine whether changing sqlite3 add_field to call _remake_table when field.unique is True would correctly create the unique index. Trace create_model -> _model_indexes_sql / _unique_sql for a unique field on sqlite (sql_create_unique = CREATE UNIQUE INDEX).
Return a precise trace with file:line.`,
  },
]

phase('Understand')
const findings = await parallel(READERS.map(r => () =>
  agent(r.prompt, { label: `read:${r.key}`, phase: 'Understand' })
))

const ctx = READERS.map((r, i) => `### ${r.key}\n${findings[i] || '(no result)'}`).join('\n\n')

phase('Design')
const ANGLES = [
  'Minimal-fix angle: the smallest possible change to django/db/backends/sqlite3/schema.py that fixes the bug, matching Django core style. Prefer what Django core would actually commit.',
  'Correctness-first angle: enumerate EVERY case where ALTER TABLE ADD COLUMN is unsafe on SQLite and guard all of them, not just UNIQUE.',
  'Feature-flag angle: consider whether this belongs behind a database feature flag in features.py, and argue for or against.',
]

const CAND_SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string' },
    exactDiff: { type: 'string', description: 'The exact code change as a before/after snippet with file paths' },
    rationale: { type: 'string' },
    testPlan: { type: 'string', description: 'Exact test(s) to add: file, class, method name, and full source' },
    risks: { type: 'string' },
  },
  required: ['approach', 'exactDiff', 'rationale', 'testPlan', 'risks'],
}

const candidates = await parallel(ANGLES.map((a, i) => () =>
  agent(`You are designing a fix for a Django bug: on SQLite, "migrations.AddField" of a nullable OneToOneField (unique=True, null=True) crashes with "django.db.utils.OperationalError: Cannot add a UNIQUE column", because sqlite3's DatabaseSchemaEditor.add_field only falls back to _remake_table when the field is not null or has a non-None effective default.

Here is the research gathered by other agents:

${ctx}

Your assigned angle: ${a}

Investigate the repo at /testbed yourself to verify anything you need. Then produce a concrete, complete fix proposal.`,
    { label: `design:${i + 1}`, phase: 'Design', schema: CAND_SCHEMA }
  )
))

phase('Judge')
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidate: { type: 'number' },
          correctness: { type: 'number' },
          styleFit: { type: 'number' },
          notes: { type: 'string' },
        },
        required: ['candidate', 'correctness', 'styleFit', 'notes'],
      },
    },
    winner: { type: 'number' },
    recommendedDiff: { type: 'string', description: 'The final exact code change to apply, with file paths and before/after' },
    recommendedTests: { type: 'string', description: 'The final exact tests to add, with file, class, method, full source' },
    reasoning: { type: 'string' },
  },
  required: ['scores', 'winner', 'recommendedDiff', 'recommendedTests', 'reasoning'],
}

const valid = candidates.filter(Boolean)
const candText = valid.map((c, i) => `## Candidate ${i + 1}\napproach: ${c.approach}\n\ndiff:\n${c.exactDiff}\n\nrationale: ${c.rationale}\n\ntests:\n${c.testPlan}\n\nrisks: ${c.risks}`).join('\n\n---\n\n')

const judges = await parallel([
  'You are a Django core committer reviewing for minimalism and style fit with the existing codebase.',
  'You are an adversarial correctness reviewer. Try to find cases where each candidate still breaks: nullable unique non-FK fields, unique fields with defaults, OneToOneField with db_index, primary_key fields, fields with db_constraint=False, M2M fields, fields where db_parameters type is None. Also check that the fix does not cause needless table rebuilds for common cases.',
  'You are a test-coverage reviewer. Judge whether the proposed tests actually reproduce the original failure and would fail before the fix and pass after.',
].map((persona, i) => () =>
  agent(`${persona}

Research context:
${ctx}

Candidates:
${candText}

Verify claims against the actual repo at /testbed (read the files, run greps). Score each candidate 0-10 on correctness and styleFit, pick a winner, and give the FINAL exact diff and FINAL exact tests you would commit.`,
    { label: `judge:${i + 1}`, phase: 'Judge', schema: JUDGE_SCHEMA }
  )
))

return { research: ctx, candidates: valid, judges: judges.filter(Boolean) }
