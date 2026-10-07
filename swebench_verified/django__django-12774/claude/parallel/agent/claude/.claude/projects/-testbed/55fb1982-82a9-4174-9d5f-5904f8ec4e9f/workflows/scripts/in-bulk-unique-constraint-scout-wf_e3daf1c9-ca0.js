export const meta = {
  name: 'in-bulk-unique-constraint-scout',
  description: 'Scout edge cases, docs, and test conventions for allowing in_bulk() on fields covered by total UniqueConstraints',
  phases: [
    { title: 'Scout', detail: 'parallel read-only investigation of code paths, docs, tests, edge cases' },
    { title: 'Synthesize', detail: 'merge findings into one implementation brief' },
  ],
}

const SCOUT_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          detail: { type: 'string', description: 'Concrete finding with file:line references and exact code/text quoted where relevant' },
          recommendation: { type: 'string' },
        },
        required: ['topic', 'detail'],
      },
    },
  },
  required: ['findings'],
}

const REPO = '/testbed (Django source checkout, branch main)'

const SCOUTS = [
  {
    key: 'semantics',
    prompt: `${REPO}

Task context: Django ticket "Allow QuerySet.in_bulk() for fields with total UniqueConstraints". Today \`QuerySet.in_bulk()\` in django/db/models/query.py (~line 685) raises ValueError unless \`field_name == 'pk'\` or \`self.model._meta.get_field(field_name).unique\`. We want to also allow a field that is covered by a single-field total (unconditional) UniqueConstraint, via \`Options.total_unique_constraints\` (django/db/models/options.py:831).

Investigate the SEMANTICS and EDGE CASES precisely, read-only. Report on:
1. Read \`Options.total_unique_constraints\` and \`Options.constraints\`. Does \`constraints\` include constraints inherited from abstract/concrete parent models? Does it include CheckConstraints (must be filtered)? Is \`UniqueConstraint.fields\` always a tuple/list of strings? Can \`fields\` be empty or contain expressions in THIS version of the codebase (check django/db/models/constraints.py)?
2. Multi-field UniqueConstraints must NOT make a single field eligible. Confirm what \`constraint.fields\` looks like and the exact predicate needed (\`len(constraint.fields) == 1\`).
3. Conditional (partial) UniqueConstraints must NOT qualify — confirm total_unique_constraints already filters \`condition is None\`.
4. Does \`UniqueConstraint.fields\` store the model field NAME or the attname/column? What happens for a ForeignKey named \`author\` — would fields be 'author' or 'author_id'? Does that matter for the in_bulk lookup and for \`getattr(obj, field_name)\`?
5. Are there other places in Django that do a similar "is this field unique?" check which already consult total_unique_constraints (e.g. admin checks, ModelAdmin, \`_get_unique_checks\`, contenttypes)? Quote the idiom they use so our new code matches house style.
6. Does \`Meta.constraints\` on a model with \`Meta.unique_together\` matter here? Should unique_together also be considered by this change? Give a recommendation with reasoning about scope.

Return concrete file:line references and quoted code.`,
  },
  {
    key: 'query-py',
    prompt: `${REPO}

Task context: modifying \`QuerySet.in_bulk()\` in django/db/models/query.py (~line 685) so it also accepts a field covered by a single-field total UniqueConstraint (\`self.model._meta.total_unique_constraints\`).

Read django/db/models/query.py around in_bulk and report, read-only:
1. Quote the full current \`in_bulk\` method with line numbers.
2. What is the surrounding code style for accessing meta — do nearby methods use \`self.model._meta\` directly or bind \`opts = self.model._meta\` first? Quote examples from this file.
3. Does \`in_bulk\` get overridden or called anywhere else in django/ (e.g. prefetch_related, related descriptors, admin, serializers)? grep and report call sites that could be affected by loosening the check.
4. \`self.model._meta.get_field(field_name)\` raises FieldDoesNotExist for an unknown name. If we reorder the condition to check total_unique_constraints first, could we change the exception type for a bogus field name? Recommend an ordering that preserves current behavior for unknown fields.
5. Check git log/blame for in_bulk to see how prior changes to this method were structured and tested.

Return concrete quotes and file:line references.`,
  },
  {
    key: 'tests',
    prompt: `${REPO}

Task context: Django ticket "Allow QuerySet.in_bulk() for fields with total UniqueConstraints". We will add support and need tests.

Investigate the TEST setup, read-only:
1. Read /testbed/tests/lookup/models.py fully and /testbed/tests/lookup/tests.py lines 1-200. Report the existing in_bulk tests (names, line numbers) and the Article/Author model definitions.
2. What models would need to be added or modified to test: (a) a single-field total UniqueConstraint, (b) a multi-field UniqueConstraint (must still raise), (c) a conditional/partial UniqueConstraint (must still raise)? Propose concrete model definitions matching this test app's style. Note: is adding Meta.constraints to the existing Article model safe, or should new models be added?
3. Are conditional UniqueConstraints supported on all backends the test suite runs? Find the skip decorator/feature flag Django uses for partial indexes (e.g. \`supports_partial_indexes\`) and quote an example test that uses it, with file:line.
4. Find how other tests in the repo declare UniqueConstraint in test models — quote 2-3 examples with file:line.
5. How is the lookup test suite run in this repo? Give the exact command (e.g. \`python tests/runtests.py lookup\`) and confirm the runtests.py path.

Return concrete file:line references and quoted code.`,
  },
  {
    key: 'docs',
    prompt: `${REPO}

Task context: Django ticket "Allow QuerySet.in_bulk() for fields with total UniqueConstraints" — in_bulk() will start accepting field_name for fields covered by a single-field total (unconditional) UniqueConstraint.

Investigate DOCUMENTATION requirements, read-only:
1. Read /testbed/docs/ref/models/querysets.txt around the \`in_bulk()\` section (~line 2178-2210). Quote the whole section verbatim with line numbers.
2. What is the exact wording that must change to mention UniqueConstraint? Draft the replacement prose in Django's documentation voice, including the correct :class: cross-reference role for UniqueConstraint (find how other docs pages reference it — quote an example).
3. Find the release notes file for the version currently in development (check django/__init__.py VERSION and ls docs/releases/). Read its "Models" section under "Minor features" and quote the surrounding entries plus their exact line numbers, so a new bullet can be inserted in the right place with correct formatting.
4. Does Django's docs use a \`.. versionchanged::\` directive for this kind of change, or just a release-notes bullet? Look at similar recent QuerySet method changes in querysets.txt and report the convention.

Return exact quotes with line numbers.`,
  },
]

phase('Scout')
const results = await parallel(SCOUTS.map(s => () =>
  agent(s.prompt, { label: `scout:${s.key}`, phase: 'Scout', schema: SCOUT_SCHEMA })
    .then(r => ({ key: s.key, ...r }))
))

const ok = results.filter(Boolean)
log(`${ok.length}/${SCOUTS.length} scouts reported`)

phase('Synthesize')
const brief = await agent(
  `You are synthesizing scout reports into a single implementation brief for this Django change:
"Allow QuerySet.in_bulk() for fields with total UniqueConstraints."

Scout reports (JSON):
${JSON.stringify(ok, null, 2)}

Verify anything that looks contradictory or uncertain by reading the actual files at /testbed yourself before asserting it. Then produce a precise implementation brief:
- The exact new code for \`in_bulk\` in django/db/models/query.py (full replacement snippet, correct indentation, Django style).
- Exact test model additions/changes for /testbed/tests/lookup/models.py.
- Exact new/changed tests for /testbed/tests/lookup/tests.py, including the negative cases (multi-field constraint, conditional constraint) and the right skip decorator for partial-index support.
- Exact docs edit for docs/ref/models/querysets.txt (old text -> new text).
- Exact release-notes bullet and the file + insertion point.
- Any traps to avoid (exception type for unknown field names, FK attname vs name, inherited constraints).

Be concrete and quote real line numbers. Return the brief as markdown.`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return { brief, scouts: ok }
