export const meta = {
  name: 'verify-dbshell-env-fix',
  description: 'Adversarially verify the dbshell os.environ fix and sweep for missed call sites',
  phases: [
    { title: 'Sweep', detail: 'find every env-producing/consuming site + docs + tests' },
    { title: 'Verify', detail: 'adversarially refute each claim of completeness/correctness' },
    { title: 'Synthesize', detail: 'merge into a single verdict' },
  ],
}

const DIFF_DESC = `
The repository is Django (at /testbed). A bug was reported: "database client runshell doesn't
respect os.environ values in some cases" — the postgresql client's settings_to_cmd_args_env()
returned an empty dict {} instead of None when no env vars were needed. BaseDatabaseClient.runshell()
had "if env: env = {**os.environ, **env}" so a falsy-but-not-None {} was passed straight to
subprocess.run(env={}), wiping the inherited environment (breaking PATH, PGHOST, PGUSER, etc.).

The fix just applied (verify it with git diff in /testbed):
1. django/db/backends/base/client.py: runshell() now does
   env = {**os.environ, **env} if env else None
   subprocess.run(args, env=env, check=True)
2. django/db/backends/postgresql/client.py: returns "args, (env or None)"
3. tests/dbshell/test_postgresql.py: test_nopass and test_parameters now expect None instead of {};
   test_crash_password_does_not_leak merges os.environ unconditionally.
4. tests/backends/base/test_client.py: new test_runshell_use_environ asserting env=None is passed
   to subprocess.run for both None and {}.
`

const SWEEP_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          issue: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'should-fix', 'nice-to-have', 'info'] },
          suggested_fix: { type: 'string' },
        },
        required: ['file', 'issue', 'severity'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['refuted', 'reasoning'],
}

const LENSES = [
  {
    key: 'callsites',
    prompt: `${DIFF_DESC}

LENS: exhaustive call-site sweep. Find EVERY producer and consumer of the (args, env) pair from
settings_to_cmd_args_env across the whole repo, including non-obvious ones. grep for
settings_to_cmd_args_env, "env=", subprocess.run, subprocess.Popen, subprocess.call, os.environ
under django/db/. In particular scrutinise django/db/backends/mysql/creation.py::_clone_db which has
its own "{**os.environ, **cmd_env} if cmd_env else None" copy of the logic — is it correct now, does
it need the same treatment, and is it consistent with the base client? Also check every backend
client (mysql, oracle, sqlite3, postgresql) for whether it can return a falsy-non-None env, and
whether any third-party-facing contract (documented return type of settings_to_cmd_args_env) is now
inconsistent. Report concrete issues only, with file:line. Do not report style nits.`,
  },
  {
    key: 'behavior',
    prompt: `${DIFF_DESC}

LENS: behavioral correctness and regressions. Reason carefully about the exact semantics of
subprocess.run's env parameter (None = inherit parent env; {} = empty env). Enumerate every input
case for the new expression "env = {**os.environ, **env} if env else None": env is None, env is {},
env is a non-empty dict, env contains a key whose value is not a str, env shadows an existing
os.environ key. For each, state what happens and whether it is the desired behavior. Then check
whether the postgresql change from {} to None can break any caller that assumes a dict is returned
(e.g. does anything do env.update(...) or env['X'] on the result, or unpack it?). Verify by reading
the real files under /testbed. Report only real defects with file:line.`,
  },
  {
    key: 'tests',
    prompt: `${DIFF_DESC}

LENS: test coverage and test correctness. Read tests/backends/base/test_client.py,
tests/dbshell/*.py, tests/backends/mysql/test_creation.py. Questions to answer with evidence:
(a) Does the new test_runshell_use_environ actually fail against the OLD code (i.e. is it a genuine
regression test)? Reason precisely: old code was "if env: env = {**os.environ, **env}" — for env={}
old code passed env={} to subprocess.run, so the assertion env=None would fail. Confirm or refute.
(b) Is mocking BaseDatabaseClient.settings_to_cmd_args_env with mock.patch.object correct given the
method is a classmethod on the base and runshell calls self.settings_to_cmd_args_env(...)? Will the
mock receive the right args and will return_value work? Any chance the patch leaks between subTests?
(c) Are there now-stale assertions anywhere expecting {} from the postgresql client?
(d) Should there be a test that a non-empty env is merged with os.environ rather than replacing it?
Actually run the relevant tests to check: cd /testbed/tests && python runtests.py dbshell
backends.base.test_client --settings=test_sqlite. Report failures verbatim.`,
  },
  {
    key: 'docs',
    prompt: `${DIFF_DESC}

LENS: documentation and release notes. Search /testbed/docs for any documentation of
settings_to_cmd_args_env, runshell, dbshell env handling, PGPASSWORD/MYSQL_PWD, or the 3.2/4.0
release notes entry added by commit bbe6fbb8768e8fb1aecb96d51c049d7ceaf802d3 (Refs #32061). Decide
whether this bugfix requires a docs change or a release-note entry, and whether any documented
contract now says the env return value is a dict. Check git log/git show for how comparable bugfixes
in this repo handled docs. Note: Django backport bugfixes usually do NOT get release notes in the
docs tree for a patch release unless behavior is documented. Report what, if anything, is needed.`,
  },
]

phase('Sweep')

const results = await pipeline(
  LENSES,
  lens => agent(lens.prompt, { label: `sweep:${lens.key}`, phase: 'Sweep', schema: SWEEP_SCHEMA }),
  (sweep, lens) => {
    const findings = (sweep?.findings || []).filter(f => f.severity !== 'info')
    if (!findings.length) return { lens: lens.key, confirmed: [], notes: sweep?.notes || '' }
    return parallel(findings.map(f => () =>
      parallel(['does-it-actually-break-something', 'is-the-code-really-like-that', 'is-the-fix-worse-than-the-bug'].map(angle => () =>
        agent(`You are an adversarial reviewer working in /testbed (Django).

${DIFF_DESC}

A reviewer claims this finding about the change:
  file: ${f.file}${f.line ? ':' + f.line : ''}
  issue: ${f.issue}
  severity: ${f.severity}
  suggested fix: ${f.suggested_fix || '(none given)'}

Your job is to REFUTE it through the "${angle}" lens. Read the actual file(s) with Read/grep and, if
useful, run python to check behavior. Default to refuted=true if you are uncertain or if the finding
is stylistic, speculative, pre-existing (not caused by this change), or would not change observable
behavior. Only set refuted=false if you can point to concrete evidence that this is a real problem
introduced or left unfixed by this change that a Django core reviewer would insist on.`,
          { label: `verify:${f.file.split('/').pop()}:${angle}`, phase: 'Verify', schema: VERDICT_SCHEMA })))
        .then(votes => {
          const real = votes.filter(Boolean)
          const survives = real.length > 0 && real.filter(v => !v.refuted).length >= 2
          return { ...f, survives, votes: real.map(v => ({ refuted: v.refuted, reasoning: v.reasoning })) }
        })
    )).then(judged => ({ lens: lens.key, confirmed: judged.filter(j => j.survives), notes: sweep?.notes || '' }))
  }
)

phase('Synthesize')

const clean = results.filter(Boolean)
const surviving = clean.flatMap(r => r.confirmed)

log(`${surviving.length} finding(s) survived adversarial verification across ${clean.length} lenses`)

const synthesis = await agent(`You are finalizing a code review in /testbed (Django).

${DIFF_DESC}

Findings that survived a 3-vote adversarial panel (majority had to agree they were real):
${JSON.stringify(surviving, null, 2)}

Lens notes:
${JSON.stringify(clean.map(r => ({ lens: r.lens, notes: r.notes })), null, 2)}

Run "cd /testbed && git diff" to see the exact change, and run the tests:
cd /testbed/tests && python runtests.py dbshell backends.base.test_client backends.mysql.test_creation --settings=test_sqlite

Then produce a final verdict: is the fix correct and complete? List only actionable items a Django
core reviewer would require, in priority order, each with file:line and the exact edit. If the fix is
correct and complete, say so plainly and state the test result. Be concise.`,
  { label: 'synthesize', phase: 'Synthesize' })

return { surviving, synthesis }
