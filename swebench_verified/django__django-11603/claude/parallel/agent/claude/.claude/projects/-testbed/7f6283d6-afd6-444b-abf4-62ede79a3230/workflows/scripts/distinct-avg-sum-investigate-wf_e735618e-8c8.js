export const meta = {
  name: 'distinct-avg-sum-investigate',
  description: 'Investigate everything needed to add DISTINCT support to Avg/Sum (and Min/Max) aggregates in Django',
  phases: [
    { title: 'Investigate', detail: 'parallel probes: docs, tests, backends, edge cases' },
    { title: 'Synthesize', detail: 'merge into one precise change plan' },
  ],
}

const REPO = '/testbed'

const PROBES = [
  {
    key: 'docs',
    prompt: `In the Django repo at ${REPO}, find EVERY documentation location that must be updated when Avg, Sum, Min, and Max aggregates gain DISTINCT support (i.e. \`allow_distinct = True\`).

Look at least at:
- docs/ref/models/querysets.txt (the aggregation functions reference: Avg, Count, Max, Min, StdDev, Sum, Variance — note exactly how Count documents its \`distinct\` argument, including the ".. versionchanged::" / ".. versionadded::" conventions used)
- docs/ref/models/expressions.txt (Aggregate.allow_distinct, the "Creating your own Aggregate Functions" section)
- docs/releases/ — determine the CURRENT in-development release notes file (check django/__init__.py VERSION) and find the "Models" section under "Minor features" where such a change would be noted. Quote a couple of neighbouring bullet entries verbatim so the new entry can match style exactly.
- Any other doc mentioning aggregate distinct.

Report exact file paths, line numbers, and VERBATIM surrounding text (enough to write precise edits). Also state the exact reST directive version number that should be used (e.g. .. versionadded:: X.Y).`,
  },
  {
    key: 'tests',
    prompt: `In the Django repo at ${REPO}, map out the test surface for aggregate DISTINCT support.

Find:
- tests/aggregation/tests.py — how existing DISTINCT tests are written (e.g. Count(distinct=True)), what models/fixtures exist (Author, Book, Publisher, Store: their fields and the test data set up in setUpTestData), and where a new test for Avg/Sum/Min/Max distinct would naturally go. Quote the model definitions and setUpTestData verbatim (or enough of it) so someone can write assertions with correct expected numeric values.
- tests/aggregation_regress/tests.py — the test_allow_distinct test and any distinct-related tests.
- Any test that asserts "does not allow distinct" TypeError for specific built-in aggregate classes (these may need updating if Avg/Sum/Min/Max no longer raise).
- tests/backends/sqlite/tests.py line ~56 usage of allow_distinct — what is it doing?
- Postgres-specific aggregate tests (tests/postgres_tests/test_aggregates.py) mentioning distinct.

Report exact paths, line numbers, verbatim code excerpts, and concrete suggestions for new test methods (including the exact expected values computable from the fixture data — show your arithmetic).`,
  },
  {
    key: 'backends',
    prompt: `In the Django repo at ${REPO}, investigate database-backend implications of emitting \`AVG(DISTINCT x)\`, \`SUM(DISTINCT x)\`, \`MIN(DISTINCT x)\`, \`MAX(DISTINCT x)\`.

Check:
- django/db/backends/*/ for any special-casing of aggregates or DISTINCT (features.py flags, operations.py, sqlite3 backend's custom aggregate registration — sqlite3 implements STDDEV/VARIANCE in Python via create_aggregate; does SQLite natively support AVG(DISTINCT)/SUM(DISTINCT)?).
- Oracle: django/db/backends/oracle/ — anything about DISTINCT within aggregate functions, and whether Oracle supports AVG(DISTINCT)/SUM(DISTINCT)/MIN(DISTINCT)/MAX(DISTINCT). Note Oracle DOES accept DISTINCT for MIN/MAX.
- MySQL: does MySQL support MIN(DISTINCT)/MAX(DISTINCT)? (Yes historically, DISTINCT is a no-op there.)
- Any feature flag pattern in django/db/backends/base/features.py that could be needed.
- Whether StdDev/Variance should also get allow_distinct (note: SQLite implements these as Python aggregates via connection.create_aggregate, which would NOT honour DISTINCT — investigate django/db/backends/sqlite3/base.py and tests/backends/sqlite/tests.py to confirm). Give a clear recommendation with evidence.

Report file:line evidence and a recommendation on exactly which aggregate classes should get allow_distinct = True.`,
  },
  {
    key: 'edges',
    prompt: `In the Django repo at ${REPO}, look for edge cases and code paths that interact with \`Aggregate.distinct\` beyond the constructor.

Investigate:
- django/db/models/aggregates.py as_sql: how 'distinct' extra_context is applied, and the filter fallback path (the Case/When rewrite when supports_aggregate_filter_clause is False) — does DISTINCT still work correctly there for Avg/Sum? Any interaction where DISTINCT + FILTER produce wrong SQL?
- Window function usage: Aggregate.window_compatible = True. Is DISTINCT inside an OVER() window function valid SQL? Search django/db/models/expressions.py Window and any validation. Note most DBs reject DISTINCT in window functions — check whether Django validates this today for Count(distinct=True) over a Window (i.e. is this a pre-existing gap, not something this change must fix?).
- django/db/models/sql/query.py or compiler.py: anything special about distinct aggregates (e.g. Count distinct handling, aggregation subquery wrapping in Query.get_aggregation).
- django/contrib/postgres/aggregates/ — which already set allow_distinct (StringAgg, ArrayAgg, JSONBAgg?) and whether any others should.
- Check git log/history for the original ticket #28658 commit that added allow_distinct/Count distinct, to mirror its shape (files touched: code + docs + tests + release notes?).

Report file:line evidence and flag anything that would make this change unsafe or incomplete.`,
  },
]

phase('Investigate')
const findings = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Investigate' }).then(r => ({ key: p.key, report: r }))
))

const good = findings.filter(Boolean)
log(`${good.length}/${PROBES.length} probes returned`)

phase('Synthesize')
const plan = await agent(
  `You are synthesizing a precise, minimal, Django-core-quality change plan for this ticket:

"Add DISTINCT support for Avg and Sum aggregates. As an extension of #28658, aggregates should be supported for other general aggregates such as Avg and Sum. Before 2.2, these aggregations just ignored the parameter, but now throw an exception. This change would just involve setting these classes as allowing DISTINCT, and could also be applied to Min and Max (although pointless)."

Repo: ${REPO} (Django main, version 3.0 dev).

Four investigators reported the following. Reconcile them, resolve contradictions by re-reading the actual files yourself (you have full read access — VERIFY every file:line claim you rely on), and output a single concrete change plan.

${good.map(f => `===== PROBE: ${f.key} =====\n${f.report}`).join('\n\n')}

Your output must be an actionable plan with:
1. Exact source edits (file, line, old text -> new text) for django/db/models/aggregates.py.
2. Exact doc edits: file, line, and the FULL verbatim replacement text (correct reST, correct version directive number).
3. Exact test additions: file, where to insert, and complete test method source code with expected values that are CORRECT for the existing fixture data (verify the fixture numbers yourself by reading the test file).
4. An explicit list of what NOT to change and why (e.g. StdDev/Variance on SQLite).
5. Any risk that would make the change wrong.

Be decisive and specific. No hedging, no options menus.`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return plan
