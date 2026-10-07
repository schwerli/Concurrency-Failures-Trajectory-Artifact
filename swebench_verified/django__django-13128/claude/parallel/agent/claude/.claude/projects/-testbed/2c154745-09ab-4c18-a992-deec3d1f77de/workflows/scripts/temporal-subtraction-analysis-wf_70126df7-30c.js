export const meta = {
  name: 'temporal-subtraction-analysis',
  description: 'Analyze Django fix for temporal subtraction without ExpressionWrapper',
  phases: [
    { title: 'Analyze', detail: 'parallel deep-dives on design, backends, tests, docs' },
    { title: 'Critique', detail: 'adversarial review of each analysis' },
  ],
}

const CONTEXT = `
Repo: /testbed (Django, pre-3.2 dev). Task ticket: "make temporal subtraction work without ExpressionWrapper".

Failing case:
    class Experiment(models.Model):
        start = models.DateTimeField()
        end = models.DateTimeField()
    Experiment.objects.annotate(
        delta=F('end') - F('start') + Value(datetime.timedelta(), output_field=DurationField())
    )
raises FieldError: Expression contains mixed types: DateTimeField, DurationField. You must set output_field.

Root cause (already established, do not re-derive): django/db/models/expressions.py CombinedExpression.as_sql()
dispatches to DurationExpression / TemporalSubtraction only at SQL-compile time (lines ~445-474). At
_resolve_output_field() time the inner (F('end') - F('start')) CombinedExpression still reports output_field
DateTimeField (both sources are DateTimeField), so the OUTER '+' sees DateTimeField + DurationField -> mixed types error.

Proposed fix (mirrors upstream Django 3.2): move the type dispatch from as_sql() into
CombinedExpression.resolve_expression(), so resolution returns an actual TemporalSubtraction (output_field =
DurationField) or DurationExpression instance. Sketch:

    def resolve_expression(self, query=None, allow_joins=True, reuse=None, summarize=False, for_save=False):
        lhs = self.lhs.resolve_expression(query, allow_joins, reuse, summarize, for_save)
        rhs = self.rhs.resolve_expression(query, allow_joins, reuse, summarize, for_save)
        if not isinstance(self, (DurationExpression, TemporalSubtraction)):
            try:
                lhs_type = lhs.output_field.get_internal_type()
            except (AttributeError, FieldError):
                lhs_type = None
            try:
                rhs_type = rhs.output_field.get_internal_type()
            except (AttributeError, FieldError):
                rhs_type = None
            if 'DurationField' in {lhs_type, rhs_type} and lhs_type != rhs_type:
                return DurationExpression(self.lhs, self.connector, self.rhs).resolve_expression(
                    query, allow_joins, reuse, summarize, for_save,
                )
            datetime_fields = {'DateField', 'DateTimeField', 'TimeField'}
            if self.connector == self.SUB and lhs_type in datetime_fields and lhs_type == rhs_type:
                return TemporalSubtraction(self.lhs, self.rhs).resolve_expression(
                    query, allow_joins, reuse, summarize, for_save,
                )
        c = self.copy()
        c.is_summary = summarize
        c.lhs = lhs
        c.rhs = rhs
        return c

and DurationExpression.as_sql() gains a native-duration short circuit:

    def as_sql(self, compiler, connection):
        if connection.features.has_native_duration_field:
            return super().as_sql(compiler, connection)
        connection.ops.check_expression_support(self)
        ...existing body...

and CombinedExpression.as_sql() loses the DurationExpression/TemporalSubtraction dispatch block.
`

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string', description: 'concrete, with file:line references' },
          severity: { type: 'string', enum: ['blocker', 'important', 'nice-to-know'] },
        },
        required: ['title', 'detail', 'severity'],
      },
    },
    recommendation: { type: 'string' },
  },
  required: ['findings', 'recommendation'],
}

const LENSES = [
  {
    key: 'design',
    prompt: `${CONTEXT}

YOUR LENS: correctness of the proposed resolve_expression() dispatch itself.
Read django/db/models/expressions.py in full. Verify:
- The old as_sql() dispatch passed self.lhs/self.rhs (UNresolved) into DurationExpression/TemporalSubtraction, but in as_sql those were already-resolved children of an already-resolved node. In the new resolve_expression the sketch also passes self.lhs/self.rhs (unresolved) and then calls .resolve_expression() on the new node — confirm children get resolved exactly once and not twice, and that copy()/is_summary/contains_aggregate semantics are preserved.
- The isinstance(self, (DurationExpression, TemporalSubtraction)) guard: is it needed? What infinite recursion does it prevent? Note TemporalSubtraction.__init__ takes only (lhs, rhs).
- Subclasses of CombinedExpression elsewhere in the codebase that would now hit this dispatch (grep for CombinedExpression subclasses; check django/db/models/fields/related_lookups.py, functions/, postgres/). Would any of them be silently converted into DurationExpression/TemporalSubtraction and lose behavior?
- resolve_expression() previously did c = self.copy(); c.is_summary = summarize; c.lhs = ...; the sketch resolves lhs/rhs BEFORE copying. Any behavioral difference (e.g. for_save, exceptions ordering)?
- Does TemporalSubtraction's class-level "output_field = fields.DurationField()" attribute interact correctly with BaseExpression.output_field being a cached_property? Confirm the override works and that __init__'s output_field=None path doesn't clobber it.
- Does the F('end') - F('start') expression still work when used in filter(), order_by(), aggregate(), Subquery, and when resolved twice (e.g. reused queryset clone)?
Return findings with severity.`,
  },
  {
    key: 'backends',
    prompt: `${CONTEXT}

YOUR LENS: database backend implications. Read:
  django/db/backends/base/operations.py (combine_duration_expression, subtract_temporals, check_expression_support)
  django/db/backends/base/features.py (has_native_duration_field, supports_temporal_subtraction)
  django/db/backends/{sqlite3,mysql,oracle,postgresql}/operations.py and features.py
Answer precisely:
- BEFORE the change, DurationExpression was only used when NOT connection.features.has_native_duration_field. AFTER the change it is chosen at resolve time, backend-agnostically. Enumerate exactly what would break on PostgreSQL and Oracle (has_native_duration_field=True) WITHOUT the "if connection.features.has_native_duration_field: return super().as_sql(...)" short circuit. Quote the SQL that combine_duration_expression / format_for_duration_arithmetic would generate on those backends.
- Is the short circuit sufficient, or does DurationExpression.compile() also need guarding?
- MySQL/sqlite: confirm the generated SQL is unchanged from before for the existing supported cases (F('duration') + timedelta, datetime - datetime, datetime + duration). Note sqlite3 operations.py combine_duration_expression raises for some connectors — check which.
- supports_temporal_subtraction feature flag: which backends set it False, and does moving dispatch to resolve time change WHEN the NotSupportedError/check_expression_support fires (compile time vs resolve time)? Does any test assert on that timing?
- Oracle subtract_temporals for DateField/TimeField, postgres subtract_temporals for DateField — any interaction with the new resolve-time typing (e.g. output_field now DurationField earlier, affecting field converters / from_db_value)?
Return findings with severity.`,
  },
  {
    key: 'tests',
    prompt: `${CONTEXT}

YOUR LENS: regression surface in the test suite. Search /testbed/tests for everything exercising duration /
temporal arithmetic and expression output_field resolution. Specifically:
  tests/expressions/tests.py (FTimeDeltaTests and others), tests/expressions/models.py (Experiment model),
  tests/annotations/, tests/aggregation/, tests/db_functions/, tests/queries/, tests/postgres_tests/,
  tests/expressions_case/, tests/backends/
For each relevant test, state: name, what it asserts, and whether the proposed change alters its behavior
(SQL text, exception type/message, or resolved expression class). Pay special attention to:
- any test asserting the exact repr/str/class of a combined expression
- any test that asserts FieldError "mixed types" is raised for a case that would now silently resolve
- tests using ExpressionWrapper around temporal arithmetic (they must keep working)
- tests that mock/inspect connection.features.has_native_duration_field
- Experiment model fields in tests/expressions/models.py (names: assigned, completed, estimated_time, start, end?) — list the exact field names and types, since new tests will use them.
Also state the exact command to run the relevant suites (this repo uses ./tests/runtests.py).
Return findings with severity.`,
  },
  {
    key: 'docs-and-scope',
    prompt: `${CONTEXT}

YOUR LENS: documentation and API scope. Search /testbed/docs for text telling users they must wrap temporal
arithmetic in ExpressionWrapper or set output_field (grep for ExpressionWrapper, DurationField, timedelta,
"mixed types", "output_field"). Identify:
- docs/ref/models/expressions.txt, docs/ref/models/database-functions.txt, docs/topics/db/aggregation.txt,
  docs/releases/3.2.txt (or the current in-development release notes file — find which one exists) passages
  that need updating or a release note added.
- Whether F() expression docs show the ExpressionWrapper workaround for date subtraction.
- Exactly what release-notes wording upstream Django would use for this ("Minor features" vs "Backwards
  incompatible changes"). Quote the surrounding lines and give the exact file:line where an entry belongs.
Do NOT edit anything; just report.
Return findings with severity.`,
  },
]

phase('Analyze')
const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `analyze:${l.key}`, phase: 'Analyze', schema: SCHEMA }),
  (res, lens) => res
    ? agent(`${CONTEXT}

An analyst working the "${lens.key}" lens reported these findings about the proposed fix:

${JSON.stringify(res, null, 2)}

ADVERSARIALLY VERIFY each finding against the actual code in /testbed. For each: is it real, or speculation?
Read the specific files and quote the lines that confirm or refute it. Default to refuted=true when you cannot
confirm from source. Also report anything the analyst MISSED in this lens.`,
        { label: `verify:${lens.key}`, phase: 'Critique', schema: {
            type: 'object',
            properties: {
              verified: { type: 'array', items: { type: 'object', properties: {
                title: { type: 'string' }, refuted: { type: 'boolean' }, evidence: { type: 'string' },
              }, required: ['title', 'refuted', 'evidence'] } },
              missed: { type: 'array', items: { type: 'string' } },
            },
            required: ['verified', 'missed'],
          } })
      .then(v => ({ lens: lens.key, analysis: res, verification: v }))
    : null,
)

return results.filter(Boolean)
