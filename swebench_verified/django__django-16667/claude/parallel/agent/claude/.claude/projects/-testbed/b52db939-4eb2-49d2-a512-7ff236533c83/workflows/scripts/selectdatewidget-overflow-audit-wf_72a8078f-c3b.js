export const meta = {
  name: 'selectdatewidget-overflow-audit',
  description: 'Verify the SelectDateWidget OverflowError fix and hunt for sibling unguarded-int crashes in Django forms',
  phases: [
    { title: 'Find', detail: 'sweep forms/widgets/fields/utils for user-int -> C-long crash paths' },
    { title: 'Verify', detail: 'adversarially confirm each candidate is reachable from untrusted form data' },
    { title: 'Review', detail: 'critique the applied fix + tests for correctness and Django conventions' },
  ],
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          symbol: { type: 'string' },
          desc: { type: 'string' },
          repro: { type: 'string', description: 'concrete untrusted input reaching the crash' },
          exception: { type: 'string' },
        },
        required: ['file', 'line', 'symbol', 'desc', 'repro', 'exception'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true only if an unhandled non-ValidationError escapes to the caller from untrusted form/widget data on Django main as checked out' },
    reason: { type: 'string' },
    evidence: { type: 'string', description: 'result of actually running the repro, if run' },
  },
  required: ['real', 'reason'],
}

const REVIEW = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string' },
          desc: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['severity', 'desc', 'suggestion'],
      },
    },
    verdict: { type: 'string' },
  },
  required: ['issues', 'verdict'],
}

const CTX = `Repo: /testbed (Django main, pre-4.2.1). Run python as /opt/miniconda3/envs/testbed/bin/python.
Run tests with: /opt/miniconda3/envs/testbed/bin/python /testbed/tests/runtests.py <label>
A fix was just applied to django/forms/widgets.py SelectDateWidget.value_from_datadict:
  except OverflowError:
      return "0-0-0"
was added after the existing "except ValueError" branch, so a huge user-supplied year/month/day
no longer raises OverflowError out of form.is_valid(). Tests were added in
tests/forms_tests/widget_tests/test_selectdatewidget.py (test_value_from_datadict_overflow,
test_form_with_overflow_year).
Do NOT modify files unless explicitly told to; you are auditing/reviewing.`

const LENSES = [
  {
    key: 'multiwidget-date',
    prompt: `${CTX}
Read django/forms/widgets.py in full. Hunt for OTHER widget value_from_datadict / format_value /
decompress implementations where raw user strings from data are passed to constructors or C-level
APIs that can raise something other than ValueError (OverflowError, TypeError, OSError,
UnicodeDecodeError) - e.g. datetime.date/datetime/timedelta, int() -> C long, strftime with
extreme years, range(). Actually try each candidate with the python interpreter to confirm the
exception type. Report only paths reachable from untrusted request data.`,
  },
  {
    key: 'fields',
    prompt: `${CTX}
Read django/forms/fields.py in full. Hunt for to_python/clean/bound-field paths where untrusted
input can raise a non-ValidationError exception (OverflowError, TypeError, OSError, RecursionError,
decimal errors). Note which already guard (e.g. DurationField catches OverflowError,
IntegerField/DecimalField). Actually execute candidates via a minimal django settings-configured
script to confirm. Report real crash paths only.`,
  },
  {
    key: 'dateparse-formats',
    prompt: `${CTX}
Audit django/utils/dateparse.py, django/utils/formats.py (incl. sanitize_strftime_format),
django/utils/datetime_safe.py if present, and django/utils/timezone.py for untrusted-input
crash paths reachable from form/widget cleaning (huge years, huge day counts, absurd offsets).
Verify by execution. Report real crash paths only.`,
  },
  {
    key: 'strftime-output',
    prompt: `${CTX}
Specifically probe SelectDateWidget end to end with extreme but NON-overflowing values:
year 0, year 10000, year 1, negative year, month/day at boundaries, values like "1e5", "0x10",
" 12 ", unicode digits (e.g. Arabic-Indic numerals), "+2000", huge-but-int-sized years such as
9999999999 (fits C long on 64-bit, so no OverflowError but datetime.date raises ValueError),
and sys.maxsize exactly. For each, call
SelectDateWidget().value_from_datadict({...}, {}, "field") and then a
forms.DateField(widget=SelectDateWidget()) full form.is_valid() cycle in a configured Django
script under /tmp. Report any input that still raises an unhandled exception, or that produces a
surprising/incorrect return value from the widget. This is the most important lens - be exhaustive.`,
  },
  {
    key: 'other-widgets',
    prompt: `${CTX}
Sweep the rest of Django for the SAME class of bug in code that consumes untrusted data:
django/contrib/admin (filters, date_hierarchy, changelist), django/views/generic/dates.py,
django/db/models/fields (to_python for DateField/DateTimeField/DurationField),
django/contrib/postgres/forms. Focus on int(...) or datetime construction on user-controlled
strings that can raise OverflowError/OSError rather than ValidationError. Verify by execution
where feasible. Report only genuinely reachable crashes.`,
  },
]

phase('Find')
const rounds = await pipeline(
  LENSES,
  (l) => agent(l.prompt, { label: `find:${l.key}`, phase: 'Find', schema: FINDINGS }),
  (res, l) => {
    const fs = (res && res.findings) || []
    if (!fs.length) return []
    return parallel(
      fs.slice(0, 8).map((f) => () =>
        parallel(
          ['reachability', 'exception-type', 'already-guarded'].map((lens) => () =>
            agent(
              `${CTX}\n\nAdversarially REFUTE this claimed bug via the "${lens}" lens.\n` +
                `Claim: ${f.symbol} at ${f.file}:${f.line} - ${f.desc}\n` +
                `Claimed repro: ${f.repro} raising ${f.exception}\n\n` +
                `Actually run the repro on this checkout. Default to real=false unless you observe ` +
                `an unhandled non-ValidationError exception escaping from untrusted form data. ` +
                `If an outer layer already converts it to a ValidationError, real=false.`,
              { label: `verify:${l.key}:${f.symbol}`, phase: 'Verify', schema: VERDICT }
            )
          )
        ).then((vs) => {
          const ok = vs.filter(Boolean)
          return { ...f, lens: l.key, votes: ok, real: ok.filter((v) => v.real).length >= 2 }
        })
      )
    )
  }
)

const candidates = rounds.flat().filter(Boolean)
const confirmed = candidates.filter((c) => c.real)
log(`${candidates.length} candidates, ${confirmed.length} survived adversarial verification`)

phase('Review')
const reviews = await parallel([
  () =>
    agent(
      `${CTX}\n\nReview the applied fix with \`git diff\` in /testbed. Questions to answer concretely:\n` +
        `1. Is "0-0-0" the right return value, versus "%s-%s-%s" % (y or 0, m or 0, d or 0)? What does\n` +
        `   SelectDateWidget.format_value do with each on re-render, and what does DateField.to_python do?\n` +
        `   Check that the form redisplays sanely and the error message is "Enter a valid date."\n` +
        `2. Should OverflowError be merged into the existing except ValueError clause instead of a\n` +
        `   separate clause? Argue both ways and pick, considering that "%s-%s-%s" with a 10^15 year\n` +
        `   would flow onward into format_value/strftime.\n` +
        `3. Any regression risk for valid dates?\n` +
        `Run: /opt/miniconda3/envs/testbed/bin/python /testbed/tests/runtests.py forms_tests model_forms admin_widgets\n` +
        `and report the actual result.`,
      { label: 'review:fix', phase: 'Review', schema: REVIEW }
    ),
  () =>
    agent(
      `${CTX}\n\nReview ONLY the new tests in tests/forms_tests/widget_tests/test_selectdatewidget.py\n` +
        `(see git diff). Check: do they actually fail without the fix? Verify by temporarily reverting\n` +
        `the widgets.py hunk in a scratch COPY of the file or via "git stash push -- django/forms/widgets.py"\n` +
        `followed by "git stash pop" (restore the working tree exactly when done - this is mandatory).\n` +
        `Also check Django test-suite conventions: subTest usage, naming, ticket-reference comments,\n` +
        `assertEqual vs assertIs, whether the form-level test belongs in this file, and whether the\n` +
        `negative-year and huge-month/day cases behave as asserted. Report concrete improvements.`,
      { label: 'review:tests', phase: 'Review', schema: REVIEW }
    ),
  () =>
    agent(
      `${CTX}\n\nCompleteness critic. What is missing from this bug fix as a Django contribution?\n` +
        `Consider: is a release note needed (check docs/releases/ for the in-development version and\n` +
        `whether comparable widget crash fixes get notes), does any docs page describe this behavior,\n` +
        `is there a sibling widget (SplitDateTimeWidget, SelectDateWidget subclasses, admin\n` +
        `AdminSplitDateTime) with the same untrusted-int hazard left unfixed, and is the "0-0-0"\n` +
        `sentinel consistent with the existing pseudo-ISO convention. Be specific and cite files.`,
      { label: 'review:completeness', phase: 'Review', schema: REVIEW }
    ),
])

return {
  confirmedSiblingBugs: confirmed.map((c) => ({
    file: c.file,
    line: c.line,
    symbol: c.symbol,
    desc: c.desc,
    repro: c.repro,
    exception: c.exception,
  })),
  rejectedCount: candidates.length - confirmed.length,
  reviews: reviews.filter(Boolean),
}
