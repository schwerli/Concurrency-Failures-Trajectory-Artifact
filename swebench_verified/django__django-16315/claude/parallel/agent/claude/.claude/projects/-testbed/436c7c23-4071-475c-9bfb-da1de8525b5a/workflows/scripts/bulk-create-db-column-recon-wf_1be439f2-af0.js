export const meta = {
  name: 'bulk-create-db-column-recon',
  description: 'Map all call sites, backends, tests, and docs affected by making bulk_create pass field objects instead of names for update_fields/unique_fields',
  phases: [
    { title: 'Recon', detail: 'parallel sweeps: backends, callers, tests, docs' },
    { title: 'Critic', detail: 'completeness critic over the merged map' },
  ],
}

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          what: { type: 'string', description: 'what this site does with update_fields/unique_fields' },
          needs_change: { type: 'boolean' },
          why: { type: 'string' },
        },
        required: ['file', 'what', 'needs_change', 'why'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings', 'notes'],
}

const CONTEXT = `
Repo: /testbed (Django). Task context: QuerySet.bulk_create(update_conflicts=True, update_fields=[...], unique_fields=[...])
generates ON CONFLICT / ON DUPLICATE KEY SQL that quotes FIELD NAMES instead of DB COLUMNS (field.column),
so models using db_column="MixedCase" produce invalid SQL.

The intended fix: in django/db/models/query.py bulk_create(), resolve update_fields and unique_fields from
name strings into actual Field objects (via self.model._meta.get_field(), with "pk" mapping to opts.pk.name),
pass Field objects down through _batched_insert -> InsertQuery -> SQLInsertCompiler ->
connection.ops.on_conflict_suffix_sql(), and have each backend emit field.column (quoted) instead of the name.
_check_bulk_create_options() would then receive Field objects already and must stop calling get_field() itself.
`

phase('Recon')

const SWEEPS = [
  {
    key: 'backends',
    prompt: `${CONTEXT}

SWEEP 1 — BACKENDS. Find EVERY implementation and override of on_conflict_suffix_sql() and insert_statement()
across the whole repo (django/db/backends/**: base, postgresql, mysql, sqlite3, oracle, dummy — plus any other).
For each, report the exact file:line, the full current signature, and precisely how it consumes update_fields
and unique_fields (does it quote them? iterate them? pass them to super()? ignore them?).
Note which ones need field.column changes and which are pass-through only.
Also check django/db/backends/base/features.py for supports_update_conflicts / supports_update_conflicts_with_target
to know which backends exercise which code path. Read the actual code; do not guess.`,
  },
  {
    key: 'callers',
    prompt: `${CONTEXT}

SWEEP 2 — CALL CHAIN + OTHER CONSUMERS. Trace the full data flow of update_fields/unique_fields for the
bulk_create insert path, reading actual code:
 - django/db/models/query.py: bulk_create, abulk_create, _check_bulk_create_options, _batched_insert, and
   ANY other method that forwards update_fields/unique_fields (also check for update_conflicts usage).
 - django/db/models/sql/subqueries.py: InsertQuery.__init__ and attribute storage.
 - django/db/models/sql/compiler.py: SQLInsertCompiler.as_sql and anything touching query.update_fields /
   query.unique_fields.
Then search the ENTIRE django/ tree for any OTHER reader of .update_fields or .unique_fields attributes on a
query object, or any other place that would break if these became Field objects instead of strings
(e.g. postgres contrib, expressions, serializers). Report exact file:line for each.
IMPORTANT: also determine whether bulk_create's local variable "unique_fields" (the "pk" remapping at ~line 786)
and _check_bulk_create_options' internal get_field() calls would double-convert or conflict.`,
  },
  {
    key: 'tests',
    prompt: `${CONTEXT}

SWEEP 3 — TEST SURFACE. Find every existing test that exercises bulk_create with update_conflicts /
update_fields / unique_fields, and every test that asserts on the generated ON CONFLICT / ON DUPLICATE KEY SQL.
Look in tests/bulk_create/ (models.py AND tests.py), tests/postgres_tests/, tests/queries/, tests/backends/,
and anywhere else. Report:
 - exact test file:line and test method names
 - the models used (tests/bulk_create/models.py) and whether ANY of them already has a field with db_column set
   (report the model + field + db_column value if so)
 - which tests assert exception messages from _check_bulk_create_options (these may be sensitive to Field-vs-str),
   quoting the asserted message text
 - how tests capture SQL (assertNumQueries? CaptureQueriesContext? connection.queries?) so a new SQL-assertion
   test can follow existing idiom
Also report how to RUN these tests in this repo (the runtests.py invocation and the default sqlite settings).`,
  },
  {
    key: 'docs',
    prompt: `${CONTEXT}

SWEEP 4 — DOCS + RELEASE NOTES + HISTORY. Search docs/ for everything documenting bulk_create's
update_conflicts/update_fields/unique_fields (docs/ref/models/querysets.txt, docs/releases/*).
Report exact file:line of passages that describe these params, and whether any of them documents that
db_column is respected or states anything that the fix would make stale.
Then check git history: run \`git log --oneline -15\` and \`git show --stat HEAD~1\` (commit for ticket #34177,
"pk in unique_fields") to see the shape/style of the immediately preceding related fix — report which files
that commit touched and whether it added tests, so our fix can match repo convention.
Also identify which docs/releases/*.txt file is the correct one for an unreleased bugfix in this checkout
(check django/__init__.py VERSION).`,
  },
]

const recon = await parallel(SWEEPS.map(s => () =>
  agent(s.prompt, { label: `recon:${s.key}`, phase: 'Recon', schema: SCHEMA })
))

const merged = SWEEPS.map((s, i) => ({ sweep: s.key, result: recon[i] })).filter(r => r.result)

phase('Critic')

const critic = await agent(`${CONTEXT}

Below is the merged recon from four parallel sweeps of /testbed. Act as a COMPLETENESS CRITIC.
Independently verify the high-stakes claims by reading the actual files, and report what is MISSING or WRONG:
 - any backend / call site / consumer of update_fields or unique_fields that was NOT listed
 - any place where converting strings -> Field objects would silently break (ordering, hashing, repr in error
   messages, pickling of the query, str() of names, deconstruct, Oracle path)
 - whether _check_bulk_create_options' existing error-message tests would still pass after the change
 - the exact minimal edit list (file:line -> what to change) to implement the fix correctly
 - whether tests/bulk_create/models.py needs a NEW model with db_column set, or an existing one suffices

MERGED RECON:
${JSON.stringify(merged, null, 2)}

Return findings for anything missing/wrong, and put the exact minimal edit list plus a concrete test plan in notes.`,
  { label: 'critic', phase: 'Critic', schema: SCHEMA, effort: 'high' })

return { recon: merged, critic }
