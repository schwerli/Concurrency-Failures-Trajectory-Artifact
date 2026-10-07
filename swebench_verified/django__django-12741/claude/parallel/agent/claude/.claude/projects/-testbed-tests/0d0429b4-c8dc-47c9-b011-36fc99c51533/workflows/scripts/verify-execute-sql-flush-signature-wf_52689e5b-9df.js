export const meta = {
  name: 'verify-execute-sql-flush-signature',
  description: 'Adversarially audit the execute_sql_flush() signature simplification in the Django repo at /testbed',
  phases: [
    { title: 'Audit', detail: 'parallel lenses over the diff and repo' },
    { title: 'Verify', detail: 'adversarially confirm or refute each finding' },
  ],
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          detail: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'important', 'nit'] },
        },
        required: ['file', 'summary', 'detail', 'severity'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    reasoning: { type: 'string' },
    correction: { type: 'string' },
  },
  required: ['real', 'reasoning'],
}

const CONTEXT = `
Repository: /testbed (Django, pre-3.1 development tree). Python interpreter for running anything:
/opt/miniconda3/envs/testbed/bin/python  (test runner: cd /testbed/tests && /opt/miniconda3/envs/testbed/bin/python runtests.py --settings=test_sqlite <labels>)

Task being implemented (Django ticket): Simplify the signature of DatabaseOperations.execute_sql_flush().
Old:  def execute_sql_flush(self, using, sql_list)
New:  def execute_sql_flush(self, sql_list)   -- the alias is inferred from self.connection.alias

The change has ALREADY been applied to the working tree. Inspect it with: cd /testbed && git diff
Do NOT modify any files. Read-only audit. Report findings only.
`

const LENSES = [
  {
    key: 'callsites',
    prompt: `${CONTEXT}
LENS: Missed call sites and completeness.
Exhaustively search the ENTIRE repository (django/, tests/, docs/, extras/, scripts/, contrib) for every place that
calls, references, overrides, mocks, patches, or documents execute_sql_flush -- including in .txt/.rst docs, comments,
docstrings, and any dynamic/getattr-style invocation. Use several search strategies (grep for 'execute_sql_flush',
'sql_flush', 'ops.execute', 'flush(' near connection, etc.) so you don't miss a rename or indirection.
Report any call site still passing the old (using, sql_list) two-arg form, any override of the method in a backend
subclass whose signature was not updated, and any documentation or release-note text that is now wrong or missing.
Also check whether django/db/backends/{mysql,oracle,postgresql,sqlite3}/operations.py or any test-support code
(django/test/, django/db/backends/base/creation.py) overrides or calls it.`,
  },
  {
    key: 'semantics',
    prompt: `${CONTEXT}
LENS: Behavioral equivalence and correctness.
Read django/db/backends/base/operations.py execute_sql_flush() before and after (git diff / git show HEAD:<path>).
The old code opened transaction.atomic(using=<caller-supplied alias>) and then used self.connection.cursor().
Determine rigorously whether transaction.atomic(using=self.connection.alias) is ALWAYS equivalent to the callers'
previous behavior. Specifically investigate:
  - Is BaseDatabaseOperations.connection always the connection whose alias the callers passed? Check how ops is
    constructed (BaseDatabaseWrapper.__init__, ops_class) and whether connection.alias can differ from the 'using'
    value the callers passed (e.g. django/core/management/commands/flush.py used options['database']).
  - Does connections[alias].alias always equal alias? Look at django/db/utils.py ConnectionHandler.__getitem__.
  - Any code path where connection.alias is None or unset (e.g. a manually constructed DatabaseWrapper, test
    doubles, connection created via connections.databases / _nodb_cursor / test database creation).
  - Whether transaction.atomic(using=None) previously fell back to DEFAULT_DB_ALIAS and whether any caller relied
    on that.
Report any real behavior change. Be concrete about the code path.`,
  },
  {
    key: 'style',
    prompt: `${CONTEXT}
LENS: Django project conventions and code quality.
Check the applied diff against how Django itself documents backend-API breaking changes:
  - docs/releases/3.1.txt "Database backend API" section: is the new bullet consistent in wording/style/ordering
    with the neighboring bullets (compare to the sql_flush() bullets added by recent commits -- see
    'git log --oneline -12' and 'git show' for the sql_flush signature-change commits)?
  - Is a deprecation path expected here, or is a hard break correct for this API? Look at how the immediately
    preceding sql_flush() signature changes in this same repo were handled (deprecation shim vs hard break) and
    say whether this change should match.
  - flake8/isort cleanliness of the touched files: run
    'cd /testbed && /opt/miniconda3/envs/testbed/bin/python -m flake8 django/db/backends/base/operations.py django/core/management/commands/flush.py tests/backends/tests.py tests/backends/base/test_operations.py'
    (setup.cfg holds the config) and report violations INTRODUCED by this diff.
  - Any now-unused local variable or import in django/core/management/commands/flush.py (the 'database' variable
    is still used elsewhere in that function -- verify).
  - Does docs/ build reference the release-note file correctly (valid reST, correct indentation of the bullet)?`,
  },
  {
    key: 'tests',
    prompt: `${CONTEXT}
LENS: Test coverage and actual execution.
1. Run the directly relevant tests and report the exact result:
   cd /testbed/tests && /opt/miniconda3/envs/testbed/bin/python runtests.py --settings=test_sqlite -v2 backends.base.test_operations.SqlFlushTests backends.tests.LongNameTest
2. Run the flush management-command tests. Find which test labels exercise 'manage.py flush' (grep tests/ for
   call_command('flush' and for "'flush'") and run those labels too. TransactionTestCase._fixture_teardown also
   calls the flush command -- confirm that path executes cleanly by running a suite full of TransactionTestCases.
3. Report whether any test still asserts the OLD two-argument signature (including via mock.assert_called_with,
   assertNumQueries wrappers, or a custom DatabaseOperations subclass in tests/).
4. Report the pass/fail counts verbatim. If anything fails, include the traceback. Do not fix anything.`,
  },
]

phase('Audit')

const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `audit:${l.key}`, phase: 'Audit', schema: FINDING_SCHEMA }),
  (res, lens) => {
    const found = (res && res.findings) || []
    if (!found.length) return []
    return parallel(found.map(f => () =>
      agent(`${CONTEXT}
A prior auditor reported this finding about the ALREADY-APPLIED change. Your job is to REFUTE it.
Default to real=false unless you can independently reproduce the problem by reading the actual code or running a command.

  file: ${f.file}${f.line ? ':' + f.line : ''}
  severity: ${f.severity}
  summary: ${f.summary}
  detail: ${f.detail}

Go read the cited code yourself (and run commands if that settles it). Decide: is this a genuine defect in the
applied change that a Django core reviewer would require fixing before merge? Style nits that match existing
Django conventions are NOT defects. Speculative "a third-party backend might..." concerns are NOT defects unless
the in-repo code actually breaks. If the finding is real, set correction to the minimal concrete fix.`,
        { label: `verify:${lens.key}:${(f.summary || '').slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then(v => ({ ...f, lens: lens.key, verdict: v }))
    ))
  }
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter(f => f.verdict && f.verdict.real)

log(`audited ${all.length} raw findings, ${confirmed.length} survived refutation`)

return {
  confirmed,
  refuted: all.filter(f => !(f.verdict && f.verdict.real)).map(f => ({ summary: f.summary, why: f.verdict && f.verdict.reasoning })),
}
