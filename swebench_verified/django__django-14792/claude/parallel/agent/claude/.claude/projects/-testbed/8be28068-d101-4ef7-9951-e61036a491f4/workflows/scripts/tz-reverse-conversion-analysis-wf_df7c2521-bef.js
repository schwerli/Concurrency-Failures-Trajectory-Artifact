export const meta = {
  name: 'tz-reverse-conversion-analysis',
  description: 'Map every code path affected by reverse timezone conversion in Trunc()/Extract() and design a verified fix',
  phases: [
    { title: 'Investigate', detail: 'parallel lanes: postgres, mysql, oracle, sqlite, timezone util, tests' },
    { title: 'Design', detail: 'independent fix proposals' },
    { title: 'Judge', detail: 'score proposals adversarially' },
  ],
}

const LANES = [
  {
    key: 'postgresql',
    prompt: `In /testbed (Django 4.0 alpha checkout), analyze django/db/backends/postgresql/operations.py.

Focus: _prepare_tzname_delta and _convert_field_to_tz, plus every caller of them in that file.

Answer precisely:
1. Exact current source of _prepare_tzname_delta (quote it) with line numbers.
2. For each of these tzname inputs, what does the CURRENT code produce, and what SHOULD PostgreSQL's "AT TIME ZONE '<x>'" receive to mean the correct zone?
   - 'Etc/GMT-10' (IANA name; means UTC+10)
   - 'Etc/GMT+10' (IANA name; means UTC-10)
   - 'Europe/Paris'
   - 'UTC'
   - '+10' / '-10'
   - 'UTC+10:00' (this is str(datetime.timezone(timedelta(hours=10))))
   - 'Etc/GMT-10' vs a POSIX offset string
3. Explain PostgreSQL's semantics: how does it interpret "AT TIME ZONE 'Etc/GMT-10'" vs "AT TIME ZONE '-10'" vs "AT TIME ZONE 'UTC-10:00'"? Which forms are POSIX-inverted and which are not? Cite PostgreSQL docs knowledge precisely.
4. List every other place in that file that manipulates tznames (e.g. _convert_sql_to_tz, time_extract_sql, bulk_batch_size... whatever exists).

Return a concise structured report. Quote code exactly.`,
  },
  {
    key: 'mysql',
    prompt: `In /testbed (Django 4.0 alpha checkout), analyze django/db/backends/mysql/operations.py.

Focus: _prepare_tzname_delta, _convert_field_to_tz, and all their callers.

Answer precisely:
1. Exact current source with line numbers.
2. What does MySQL's CONVERT_TZ(dt, from_tz, to_tz) accept as a tz argument? Named zones (requires mysql tz tables loaded) vs offset strings of form '+10:00'. Does it accept bare '+10'? Does it accept 'Etc/GMT-10'?
3. For inputs 'Etc/GMT-10', 'Europe/Paris', 'UTC', 'UTC+10:00', '+10:00', what does the CURRENT code produce and what is correct?
4. Note the interaction with self.connection.timezone_name.
5. Also check django/db/backends/mysql/base.py / features.py for anything tz-name related.

Return a concise structured report. Quote code exactly.`,
  },
  {
    key: 'oracle',
    prompt: `In /testbed (Django 4.0 alpha checkout), analyze django/db/backends/oracle/operations.py.

Focus: _prepare_tzname_delta, _convert_field_to_tz, _tzname_re, and all their callers (datetime_cast_date_sql, datetime_cast_time_sql, datetime_extract_sql, datetime_trunc_sql, date_trunc_sql, time_trunc_sql, etc.).

Answer precisely:
1. Exact current source with line numbers.
2. What does Oracle's "AT TIME ZONE '<x>'" accept? Named regions vs '+10:00' offsets. Does it accept 'Etc/GMT-10'? Does it accept bare '+10'?
3. For inputs 'Etc/GMT-10', 'Europe/Paris', 'UTC', 'UTC+10:00', '+10:00', what does the CURRENT code produce and what is correct?
4. Does _tzname_re permit all these forms?

Return a concise structured report. Quote code exactly.`,
  },
  {
    key: 'sqlite',
    prompt: `In /testbed (Django 4.0 alpha checkout), analyze django/db/backends/sqlite3/base.py function _sqlite_datetime_parse (around line 426) and its callers (_sqlite_date_trunc, _sqlite_time_trunc, _sqlite_datetime_cast_date, _sqlite_datetime_cast_time, _sqlite_datetime_extract, _sqlite_datetime_trunc). Also check django/db/backends/sqlite3/operations.py for how tzname is passed.

Answer precisely:
1. Quote _sqlite_datetime_parse exactly with line numbers.
2. Trace what happens step by step for tzname = 'Etc/GMT-10':
   - sign_index = tzname.find('+') + tzname.find('-') + 1  -> what value?
   - what does tzname.split(sign) give? what is offset?
   - does 'offset.split(":")' succeed or raise? (offset would be '10' -> no colon!)
   So does it CRASH or silently misbehave? Be exact.
3. Same trace for tzname = 'UTC+10:00', 'Europe/Paris', 'UTC', '+10:00'.
4. Note that pytz.timezone(tzname) is called with the residual name -- what happens with pytz.timezone('Etc/GMT')? Is that a valid pytz zone?
5. Is there an analogous problem here that must be fixed alongside postgres/mysql/oracle?

Return a concise structured report. Quote code exactly. Actually RUN python to verify the trace, e.g.:
cd /testbed && python -c "..."  (pytz is installed)`,
  },
  {
    key: 'tzutil',
    prompt: `In /testbed (Django 4.0 alpha checkout), analyze django/utils/timezone.py, specifically _get_timezone_name (around line 74) and its callers (get_default_timezone_name, get_current_timezone_name, and django/db/models/functions/datetime.py TimezoneMixin.get_tzname).

Answer precisely:
1. Quote _get_timezone_name exactly with line numbers, and its git history (git log -p -L for that function or git log -S"_get_timezone_name").
2. Find the commit that changed it in 3.2 (the ticket says it used to return '+10' for pytz.timezone('Etc/GMT-10') and now returns 'Etc/GMT-10'). Use git log -S and git show. Report the commit hash + message.
3. RUN python in /testbed to record actual values of str(tz) and tz.tzname(None) for:
   - pytz.timezone('Etc/GMT-10'), pytz.timezone('Europe/Paris'), pytz.utc, pytz.FixedOffset(600), pytz.FixedOffset(-600)
   - zoneinfo.ZoneInfo('Etc/GMT-10'), zoneinfo.ZoneInfo('Europe/Paris')
   - datetime.timezone.utc, datetime.timezone(timedelta(hours=10)), datetime.timezone(timedelta(hours=-10)), datetime.timezone(timedelta(hours=10, minutes=30))
   Report the exact output table. Note which raise exceptions.
4. Report whether changing _get_timezone_name is required, safe, or risky given those values (esp. pytz DstTzInfo.tzname(None) returning e.g. 'CET' for Europe/Paris -- verify by running it).

Return a concise structured report with the actual python output.`,
  },
  {
    key: 'tests',
    prompt: `In /testbed (Django 4.0 alpha checkout), find ALL existing tests that would be affected by changing _prepare_tzname_delta in the postgresql/mysql/oracle backends or _sqlite_datetime_parse or django.utils.timezone._get_timezone_name.

Search: tests/db_functions/datetime/test_extract_trunc.py, tests/backends/**, tests/utils_tests/test_timezone.py, tests/timezones/**, tests/postgres_tests/**, tests/aggregation*/**, and anything grepping for 'tzname', 'AT TIME ZONE', 'CONVERT_TZ', 'Etc/GMT', 'FixedOffset', 'get_current_timezone_name', 'timezone.override'.

Report:
1. File paths + test names + line numbers of tests that assert on generated SQL containing timezone names/offsets.
2. Any test that already covers 'Etc/GMT-10'-like zones (likely none).
3. The test class/style used in tests/db_functions/datetime/test_extract_trunc.py -- how are tz-aware Trunc/Extract tests written? Quote one representative test (e.g. one using timezone.override or a tzinfo= kwarg) with line numbers.
4. What is the canonical place to ADD tests for this fix? Give exact file paths and nearby line numbers, plus how the tests are skipped per-backend (skipUnlessDBFeature / @skipIf connection.vendor).
5. How to RUN the relevant test suites: exact ./tests/runtests.py invocations (default sqlite settings).

Return a concise structured report.`,
  },
]

phase('Investigate')
const findings = await parallel(LANES.map(l => () =>
  agent(l.prompt, { label: `investigate:${l.key}`, phase: 'Investigate' })
    .then(r => ({ key: l.key, report: r }))
))

const ctx = findings.filter(Boolean).map(f => `===== ${f.key.toUpperCase()} =====\n${f.report}`).join('\n\n')

phase('Design')
const ANGLES = [
  { key: 'minimal', slant: 'Prefer the SMALLEST correct change. Do not touch django/utils/timezone.py unless strictly necessary. Focus on making _prepare_tzname_delta only flip a REAL numeric UTC offset suffix and never mangle IANA zone names.' },
  { key: 'shared-helper', slant: 'Prefer factoring a single shared helper (e.g. split_tzname_delta(tzname) -> (name, sign, offset)) into django/db/backends/utils.py, used by all three backends AND the sqlite in-python implementation, so the parsing logic exists exactly once.' },
  { key: 'root-cause', slant: 'Argue from the root cause: the regression came from _get_timezone_name returning IANA names instead of offsets. Evaluate whether the right fix is in django/utils/timezone.py, in the backends, or both. Be honest about backwards-compat risk for pytz named zones.' },
]

const designs = await parallel(ANGLES.map(a => () => agent(
  `You are designing the fix for this Django ticket in /testbed:

TICKET: Reverse time zone conversion in Trunc()/Extract() database functions.
Using tzinfo of "Etc/GMT-10" (means UTC+10), Django 3.2+ generates
  DATE_TRUNC('day', "t"."start_at" AT TIME ZONE 'Etc/GMT+10')
i.e. the OPPOSITE direction. On 3.1, _get_timezone_name() returned '+10' and
_prepare_tzname_delta() flipped it to '-10' (correct, POSIX-inverted for PG).
Now _get_timezone_name() returns 'Etc/GMT-10' and the naive +/- flip in
_prepare_tzname_delta() corrupts the IANA name.

Here are exhaustive investigation reports from six parallel analysts:

${ctx}

YOUR SLANT: ${a.slant}

Produce a COMPLETE, CONCRETE fix proposal:
- Exact final source code for every function you change, in every file (postgresql, mysql, oracle, sqlite base.py, django/db/backends/utils.py, django/utils/timezone.py as applicable). Give full replacement bodies, not diffs-in-prose.
- A truth table: for each input tzname ('Etc/GMT-10', 'Etc/GMT+10', 'Europe/Paris', 'UTC', 'UTC+10:00', 'UTC-10:00', '+10:00', '-10:00', 'Australia/Melbourne', 'America/New_York') show what each backend emits AFTER your fix, and assert it is semantically correct.
- Edge cases: what about a zone name legitimately containing '-' or '+' like 'Etc/GMT-10', 'GMT+0', 'America/Port-au-Prince', 'Etc/GMT0'? Verify 'America/Port-au-Prince' is not corrupted.
- Which tests to add and where (exact file, exact test code).
- Risks / backwards-incompatibilities, and a release-note need.

Be rigorous and specific. You may read files and run python in /testbed to verify claims.`,
  { label: `design:${a.key}`, phase: 'Design' }
).then(r => ({ key: a.key, design: r }))))

phase('Judge')
const dctx = designs.filter(Boolean).map(d => `===== PROPOSAL ${d.key.toUpperCase()} =====\n${d.design}`).join('\n\n')

const LENSES = [
  'CORRECTNESS: does each proposal actually produce semantically correct SQL for every listed tzname on every backend? Hunt for a case where it is still wrong or inverted. Verify by running python in /testbed where possible.',
  'ROBUSTNESS: hunt for tz names the proposal corrupts or crashes on — America/Port-au-Prince, Etc/GMT0, Etc/GMT-0, GMT+0, UTC, bare offsets, offsets with seconds, negative FixedOffset, 30-minute offsets like UTC+05:45 (Asia/Kathmandu), and the sqlite offset.split(":") ValueError path.',
  'DJANGO-IDIOM & MINIMALITY: which proposal best matches how upstream Django would actually write this (naming, placement in django/db/backends/utils.py, use of django.utils.dateparse, no over-engineering)? Which introduces least backwards-compat risk? Would touching django/utils/timezone.py break pytz named zones?',
]

const votes = await parallel(LENSES.map((lens, i) => () => agent(
  `Three fix proposals for a Django timezone bug are below. Judge them through ONE lens only.

LENS ${i + 1}: ${lens}

${dctx}

For each proposal give: concrete defects found (with the exact input that breaks it), then a score 0-10 on your lens. End with a ranking and a short prescription for the BEST SYNTHESIS — specifying exact final code for every file. You may read /testbed and run python to verify.`,
  { label: `judge:lens${i + 1}`, phase: 'Judge' }
)))

return {
  investigations: findings.filter(Boolean),
  designs: designs.filter(Boolean),
  judgments: votes.filter(Boolean),
}
