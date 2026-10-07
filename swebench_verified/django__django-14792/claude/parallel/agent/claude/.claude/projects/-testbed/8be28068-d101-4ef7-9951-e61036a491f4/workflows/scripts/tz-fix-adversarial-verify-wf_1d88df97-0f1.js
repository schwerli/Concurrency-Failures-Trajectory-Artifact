export const meta = {
  name: 'tz-fix-adversarial-verify',
  description: 'Adversarially refute the _get_timezone_name fix and hunt for regressions it introduces',
  phases: [
    { title: 'Refute', detail: 'independent skeptics per lens' },
    { title: 'Critic', detail: 'completeness critic' },
  ],
}

const DIFF = `
--- a/django/utils/timezone.py
+++ b/django/utils/timezone.py
 def _get_timezone_name(timezone):
-    """Return the name of \`\`timezone\`\`."""
-    return str(timezone)
+    """
+    Return the offset for fixed offset timezones, or the name of timezone if
+    not set.
+    """
+    return timezone.tzname(None) or str(timezone)
`

const CONTEXT = `
REPO: /testbed, Django 4.0 alpha. IMPORTANT: pytz is ONLY installed in
/opt/miniconda3/envs/testbed/bin/python -- the default \`python\` on PATH has no pytz.
Run tests with: cd /testbed/tests && /opt/miniconda3/envs/testbed/bin/python runtests.py <labels>

TICKET #33037: "Reverse time zone conversion in Trunc()/Extract() database functions."
With tzinfo = pytz.timezone('Etc/GMT-10') (which means UTC+10), Django 3.2 generated
  DATE_TRUNC('day', "m"."start_at" AT TIME ZONE 'Etc/GMT+10')
i.e. the OPPOSITE direction (UTC-10). Django 3.1 generated AT TIME ZONE '-10' which
PostgreSQL POSIX-interprets as UTC+10 (correct).

ROOT CAUSE (confirmed via git): commit 10d1261984 "Refs #32365 -- Allowed use of
non-pytz timezone implementations" changed _get_timezone_name from
\`return timezone.tzname(None)\` to \`return str(timezone)\`. So pytz.timezone('Etc/GMT-10')
started reporting the IANA name 'Etc/GMT-10' instead of the offset '+10'. The backends'
_prepare_tzname_delta() then naively flip +/- anywhere in the string, corrupting the name.

THE FIX APPLIED (already in the working tree):
${DIFF}

Plus a regression test tests/utils_tests/test_timezone.py::TimezoneTests::test_get_timezone_name
and a release note in docs/releases/3.2.7.txt.

ALREADY-ESTABLISHED FACTS (verified by running python; you may re-verify):
- tzname(None) differs from str() ONLY for transition-less "static" zones: pytz/zoneinfo
  Etc/GMT-10 -> '+10', Etc/GMT+10 -> '-10', Etc/GMT0 -> 'GMT', Etc/GMT -> 'GMT',
  Etc/UTC -> 'UTC'. Every DST-capable IANA zone (Europe/Paris, America/New_York,
  Australia/Melbourne, Asia/Kolkata, America/Port-au-Prince, ...) is UNCHANGED:
  pytz DstTzInfo.tzname(None) returns self.zone; zoneinfo.ZoneInfo.tzname(None) returns
  None so it falls back to str().
- For datetime.timezone, str() IS tzname(None), so nothing changes there.
- pytz LOCALIZED DstTzInfo instances also return the zone name from tzname(None).
- pytz._FixedOffset.tzname(None) is None -> falls back to str() -> 'pytz.FixedOffset(600)'
  (unchanged, still broken, pre-existing).
- Full chain now: pytz Etc/GMT-10 -> get_tzname()='+10' -> PG "AT TIME ZONE '-10'" = UTC+10. CORRECT.
- Test sweep of 5677 tests across utils_tests timezones db_functions cache template_tests
  view_tests forms_tests model_fields queries expressions aggregation aggregation_regress
  backends admin_views datetimes dates: only pre-existing unrelated failure
  template_tests.test_loaders.FileSystemLoaderTests.test_permissions_error (fails on clean
  tree too, because tests run as root so chmod-based permission denial doesn't apply).

KNOWN, DELIBERATELY OUT-OF-SCOPE adjacent bugs (pre-existing in 3.1 too, NOT regressions):
(a) _prepare_tzname_delta corrupts zone names that legitimately contain a sign:
    postgres 'America/Port-au-Prince' -> 'America/Port+au+Prince'; mysql/oracle -> '-au-Prince'.
(b) SQLite's _sqlite_datetime_parse crashes (ValueError -> OperationalError) for any tzname
    with a sign but no HH:MM offset, e.g. 'Etc/GMT-10' (before fix) and '+10' (after fix).
Do NOT re-report these as defects of the fix unless you can show the fix makes them WORSE.
`

phase('Refute')
const LENSES = [
  { key: 'regression-hunt', prompt: `Your job: find a case where this fix makes Django BEHAVE WORSE than it does on unpatched 3.2 (i.e. a genuine regression introduced by the patch). Consider every consumer of _get_timezone_name: django/utils/cache.py:322 (cache key generation via get_current_timezone_name), django/template/context_processors.py:64 (TIME_ZONE context var), django/templatetags/tz.py:121 ({% get_current_timezone %}), django/db/models/functions/datetime.py:25 (TimezoneMixin.get_tzname), get_default_timezone_name. For each, determine whether the value can change and whether that change is harmful. Actually RUN code to check. Report concrete inputs.` },
  { key: 'tzinfo-zoo', prompt: `Your job: find a tzinfo implementation for which \`timezone.tzname(None)\` raises, or returns a WRONG/misleading value that str() would have gotten right. Systematically enumerate: every zone in pytz.all_timezones (compare tzname(None) vs str() for ALL of them and report every disagreement, not a sample); every zoneinfo.available_timezones(); datetime.timezone with and without name; pytz.FixedOffset; pytz.utc; dateutil.tz.* if installed; a plain datetime.tzinfo subclass; django.utils.timezone.get_fixed_timezone(). Write and RUN a script. Report the FULL list of zones where tzname(None) != str(timezone) and judge each: is the offset form correct for use as a DB "AT TIME ZONE"/CONVERT_TZ argument?` },
  { key: 'semantics', prompt: `Your job: refute the CLAIM that "AT TIME ZONE '-10'" is the correct SQL for a tzinfo meaning UTC+10 on PostgreSQL, and the analogous claims for MySQL CONVERT_TZ and Oracle AT TIME ZONE. Reason from actual PostgreSQL/MySQL/Oracle timezone-argument semantics (POSIX sign inversion, which forms are accepted). Determine: after this fix, for tzinfo=pytz.timezone('Etc/GMT-10'), (i) postgres receives '-10' -- correct? accepted by PG? (ii) mysql CONVERT_TZ receives '+10' -- is a bare '+10' a VALID MySQL tz argument, or does CONVERT_TZ return NULL? (iii) oracle AT TIME ZONE receives '+10' -- valid? If mysql/oracle are still broken, say so clearly and state whether that is a regression from 3.2 or the same as 3.1.` },
  { key: 'test-quality', prompt: `Your job: attack the added test tests/utils_tests/test_timezone.py::TimezoneTests::test_get_timezone_name. Would it actually FAIL on the unpatched code (verify by reverting just django/utils/timezone.py with git stash and running it)? Is it in the right file/class? Does it follow the conventions of the surrounding tests (HAS_ZONEINFO guard, subTest usage, pytz+zoneinfo parity)? Is anything important untested -- e.g. should there be an end-to-end Trunc/Extract test, and would such a test PASS on sqlite (the default test backend)? Actually try writing and running such an end-to-end test with Etc/GMT-10 on sqlite and report exactly what happens. Also check flake8: cd /testbed && /opt/miniconda3/envs/testbed/bin/python -m flake8 django/utils/timezone.py tests/utils_tests/test_timezone.py docs/releases/3.2.7.txt` },
]

const verdicts = await parallel(LENSES.map(l => () => agent(
  `${CONTEXT}

YOUR LENS: ${l.prompt}

Be a hostile skeptic: your goal is to REFUTE the fix or find real damage. But be honest -- if after genuine effort you cannot break it on your lens, say so plainly and explain what you tried. Do NOT invent defects. Do NOT modify files in /testbed except transiently (git stash/git stash pop), and leave the tree exactly as you found it (verify with git status and git diff at the end).

End with:
VERDICT: <SOUND | DEFECTIVE>
DEFECTS: <numbered list with the exact input that breaks it, or "none">`,
  { label: `refute:${l.key}`, phase: 'Refute' }
).then(r => ({ key: l.key, verdict: r }))))

phase('Critic')
const vctx = verdicts.filter(Boolean).map(v => `===== ${v.key.toUpperCase()} =====\n${v.verdict}`).join('\n\n')

const critic = await agent(
  `${CONTEXT}

Four hostile skeptics reviewed the fix. Their reports:

${vctx}

You are the COMPLETENESS CRITIC. Answer:
1. What is MISSING from this change that a Django core reviewer would demand before merge? (docs? a second test? a different file? a release note in a different version file -- check which release-note files exist in docs/releases/ and which is right for a 3.2 backport of a regression fix, given the repo is on main at 4.0 alpha.)
2. Did any skeptic find a REAL defect (not one of the two known out-of-scope adjacent bugs)? Adjudicate each claimed defect as CONFIRMED or REJECTED, with reasoning.
3. Is the docstring/comment wording accurate and idiomatic for Django?
4. Is the release-note wording accurate? Verify the ticket number and the phrasing convention used by other entries in docs/releases/3.2.*.txt.
5. Anything else unverified.

You may read /testbed and run python/tests. Leave the tree unmodified.
Be concise and concrete. Prioritize: list only what actually matters.`,
  { label: 'completeness-critic', phase: 'Critic' }
)

return { verdicts: verdicts.filter(Boolean), critic }
