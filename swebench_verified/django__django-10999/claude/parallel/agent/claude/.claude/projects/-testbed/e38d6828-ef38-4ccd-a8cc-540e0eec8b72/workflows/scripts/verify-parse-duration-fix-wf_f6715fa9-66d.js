export const meta = {
  name: 'verify-parse-duration-fix',
  description: 'Adversarially verify the parse_duration() negative-duration regex fix in Django',
  phases: [
    { title: 'Probe', detail: 'test suites, consumer audit, ReDoS, design alternatives, docs' },
    { title: 'Refute', detail: 'independent skeptics try to break each claim' },
    { title: 'Judge', detail: 'synthesize a verdict' },
  ],
}

const DIFF = `
File: /testbed/django/utils/dateparse.py  (Django 3.0-dev checkout at /testbed)

The ONLY source change applied:

 standard_duration_re = re.compile(
     r'^'
     r'(?:(?P<days>-?\\d+) (days?, )?)?'
-    r'((?:(?P<hours>-?\\d+):)(?=\\d+:\\d+))?'
+    r'((?:(?P<hours>-?\\d+):)(?=-?\\d+:-?\\d+))?'
     r'(?:(?P<minutes>-?\\d+):)?'
     r'(?P<seconds>-?\\d+)'
     r'(?:\\.(?P<microseconds>\\d{1,6})\\d{0,6})?'
     r'$'
 )

Rationale: the hours lookahead required unsigned digits, so an input whose
minutes/seconds carry their own minus sign (e.g. '-1:-15:-30') failed to bind the
hours group and therefore failed to match at all -> parse_duration() returned None.

Test change applied: tests/utils_tests/test_dateparse.py DurationParseTests.test_negative
gained three cases: '-1:-15:-30', '-1:-15:-30.1', '-4 -1:-15:-30'.

Established already (do not redo, but you may challenge the method): a differential
sweep over 87,757 generated candidate strings found 0 inputs whose parse result
changed if they already matched the OLD regex; 750 inputs went from None to a value.
So the change appears strictly match-set-widening.
`

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string', description: '2-4 sentence bottom line' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'detail', 'evidence'],
        properties: {
          title: { type: 'string' },
          severity: { enum: ['blocker', 'major', 'minor', 'info'] },
          detail: { type: 'string' },
          evidence: { type: 'string', description: 'commands run + verbatim key output, or file:line' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding does not hold up' },
    reasoning: { type: 'string' },
    evidence: { type: 'string' },
  },
}

const PROBES = [
  {
    key: 'tests',
    prompt: `${DIFF}

You are the regression-test probe. Run every test suite in /testbed that could be affected by
duration parsing, using the Django test runner, e.g.:
  cd /testbed && python tests/runtests.py --settings=test_sqlite utils_tests -v1
(figure out the correct invocation for this checkout; try 'python tests/runtests.py utils_tests'
first and adapt if it needs --settings).

At minimum run: utils_tests (whole package), forms_tests, model_fields, serializers,
humanize_tests if present, and any suite whose name or content mentions duration.
Use grep to discover suites that reference duration/timedelta before choosing.
Report ANY failure or error with verbatim output. If everything passes, report that as an
'info' finding including the exact commands and the pass counts. Do not modify any files.`,
  },
  {
    key: 'consumers',
    prompt: `${DIFF}

You are the consumer-audit probe. Find every caller of parse_duration / standard_duration_re in
/testbed (django/forms/fields.py DurationField, django/db/models/fields/__init__.py
DurationField.to_python, DjangoJSONEncoder / serializers, admin widgets, DB backend
converters, django/utils/duration.py round-tripping) and reason about whether now ACCEPTING
strings like '-1:-15:-30', '1:-15:-30', '-4 -1:-15:-30' can cause a problem downstream:
crashes, silently wrong values, validation holes, DB round-trip asymmetry, or a value that
duration_string() would never produce being accepted on input.
Actually exercise the consumers with python (e.g. instantiate forms.DurationField and call
clean(), call models.DurationField().to_python(), round-trip through duration_string /
duration_iso_string). Report concrete behavior with verbatim output. Do not modify files.`,
  },
  {
    key: 'redos',
    prompt: `${DIFF}

You are the performance/ReDoS probe. The changed regex adds an optional '-?' inside a lookahead
that itself sits inside an optional group, next to other optional signed-integer groups.
Determine empirically whether the new pattern can exhibit catastrophic backtracking or a
meaningful slowdown versus the old one on adversarial inputs, since parse_duration() is reachable
from untrusted form input (django/forms/fields.py DurationField).
Write a python script that times BOTH the old and new patterns on adversarial inputs:
long digit runs, long runs of '-', many colons, near-miss strings that force full backtracking
(e.g. '-'*n, '1'*n + ':', ('-1:')*n, '1:'*n + 'x', digits with trailing junk), for n up to a few
thousand. Report worst-case timings for old vs new and whether growth is linear or superlinear.
Report a blocker only if the NEW pattern is materially worse than the OLD one. Do not modify files.`,
  },
  {
    key: 'design',
    prompt: `${DIFF}

You are the design-alternative probe. There are two competing ways to fix negative durations:

(A) the applied lookahead fix: each component keeps its own sign, so '-1:-15:-30' means
    -(1h) + -(15m) + -(30s) and '-1:15:30' means -1h + 15m + 30s.
(B) a leading whole-string sign group:
      r'(?P<sign>-?)' with unsigned '(?P<hours>\\d+)', '(?P<minutes>\\d+)', '(?P<seconds>\\d+)'
    so '-1:15:30' means -(1h15m30s) and '-1:-15:-30' becomes INVALID (None).

Read /testbed/tests/utils_tests/test_dateparse.py and /testbed/tests/utils_tests/test_duration.py
and django/utils/duration.py. Determine which option is consistent with the EXISTING committed
test expectations in this checkout (especially test_negative's existing '-15:30' and '-1:15:30'
cases, and test_parse_postgresql_format) and with what duration_string() emits. Empirically
implement BOTH candidate regexes in a scratch python script, run the existing test_negative
expectations against each, and report which option would break already-committed assertions.
The question to answer crisply: does the applied fix (A) preserve every existing committed
expectation, and would (B) have required editing existing assertions? Do not modify repo files.`,
  },
  {
    key: 'completeness',
    prompt: `${DIFF}

You are the completeness probe. Ask: what negative-duration inputs does parse_duration STILL
reject or mis-parse after this fix, and is the fix's scope right?
Empirically enumerate, in a python script against the LIVE /testbed code (import
django.utils.dateparse), which negative forms now work and which still return None or a
surprising value. Specifically check: '-1:-15:-30', '-01:-01', '-15:-30', '1:-15:-30',
'-4 -1:-15:-30', '-4 days, -1:-15:-30', str()/format() of assorted negative timedeltas,
duration_string() of negative timedeltas, and the microseconds sign interaction in
parse_duration (the 'if kw.get(\\'seconds\\')...startswith(\\'-\\')' branch) for cases where
MINUTES or HOURS are negative but seconds is positive, e.g. '-1:-15:30.1' and '-0:-0:1.5'.
Flag any case where the returned timedelta is arguably wrong (e.g. a negative minute combined
with a positive fractional second producing a value the user would not expect).
Also check whether docs (docs/ref/models/fields.txt, docs/ref/forms/fields.txt) or a release
note under docs/releases/ should mention this. Do not modify files.`,
  },
]

phase('Probe')
const probed = await pipeline(
  PROBES,
  p => agent(p.prompt, { label: `probe:${p.key}`, phase: 'Probe', schema: FINDING_SCHEMA }),
  (res, p) => {
    if (!res) return { key: p.key, summary: 'probe failed', findings: [] }
    const notable = (res.findings || []).filter(f => f.severity !== 'info')
    return parallel(notable.map(f => () =>
      parallel(['correctness', 'does-it-reproduce', 'scope-and-severity'].map(lens => () =>
        agent(`${DIFF}

A probe of the change above reported this finding. You are an independent SKEPTIC using the
"${lens}" lens. Try hard to REFUTE it. Work in /testbed and verify empirically with real
commands (python, grep, the test runner) rather than reasoning alone. Default to refuted=true
if you cannot reproduce the claimed problem or if it is not actually caused by this diff
(pre-existing behavior does NOT count as caused by this diff).

FINDING
  title: ${f.title}
  severity: ${f.severity}
  detail: ${f.detail}
  evidence claimed: ${f.evidence}`,
          { label: `refute:${p.key}:${lens}`, phase: 'Refute', schema: VERDICT_SCHEMA })
      )).then(votes => {
        const good = votes.filter(Boolean)
        const refutedCount = good.filter(v => v.refuted).length
        return { ...f, probe: p.key, survives: refutedCount < 2, votes: good.length, refutedCount,
                 skepticNotes: good.map(v => v.reasoning) }
      })
    )).then(judged => ({ key: p.key, summary: res.summary, findings: judged }))
  },
)

const all = probed.filter(Boolean)
const survivors = all.flatMap(r => r.findings || []).filter(f => f && f.survives)
log(`probes done: ${all.length}; surviving non-info findings: ${survivors.length}`)

phase('Judge')
const verdict = await agent(`${DIFF}

Five independent probes examined this change; every non-informational finding was then put
through three adversarial skeptics (majority-refute kills it). Here are the probe summaries and
the findings that SURVIVED refutation.

PROBE SUMMARIES
${all.map(r => `- [${r.key}] ${r.summary}`).join('\n')}

SURVIVING FINDINGS (${survivors.length})
${survivors.length ? survivors.map(f => `- [${f.probe}] (${f.severity}) ${f.title}
    ${f.detail}
    evidence: ${f.evidence}
    skeptic votes: ${f.refutedCount}/${f.votes} refuted`).join('\n') : '(none)'}

Give the final verdict on the applied change. Answer, in order:
1. Is the fix correct and does it resolve the reported issue? (yes/no + why)
2. Is it safe — any regression, perf, or validation risk that a maintainer would object to?
3. Anything still missing (tests, docs, release note)?
Be concise and concrete. Do not modify files. Return plain prose, no preamble.`,
  { label: 'judge', phase: 'Judge' })

return { verdict, probeSummaries: all.map(r => ({ key: r.key, summary: r.summary })), survivors }
