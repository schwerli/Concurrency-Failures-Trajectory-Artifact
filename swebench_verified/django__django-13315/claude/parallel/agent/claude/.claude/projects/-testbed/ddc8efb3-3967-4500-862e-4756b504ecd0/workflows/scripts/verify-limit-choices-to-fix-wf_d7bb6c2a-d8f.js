export const meta = {
  name: 'verify-limit-choices-to-fix',
  description: 'Sweep Django test suites and adversarially review the limit_choices_to duplicate-options fix',
  phases: [
    { title: 'Sweep', detail: 'run affected Django test suites in parallel' },
    { title: 'Review', detail: 'independent lenses over the patch' },
    { title: 'Verify', detail: 'adversarially verify each finding' },
    { title: 'Synthesize', detail: 'merge into a single report' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'
const RUN = `cd /testbed/tests && ${PY} runtests.py`

const CONTEXT = `
Repo: /testbed (Django 3.2 alpha checkout). Test runner: \`${RUN} <labels> --parallel 8\`.
Do NOT use bare \`python\` — only ${PY} has the deps (asgiref).

The change under review (see \`cd /testbed && git diff\`): django/forms/models.py
\`apply_limit_choices_to_to_formfield()\` used to do
    if limit_choices_to is not None:
        formfield.queryset = formfield.queryset.complex_filter(limit_choices_to)
and now does
    if limit_choices_to:
        complex_filter = limit_choices_to
        if not isinstance(complex_filter, Q):
            complex_filter = Q(**limit_choices_to)
        complex_filter &= Q(pk=OuterRef('pk'))
        formfield.queryset = formfield.queryset.filter(
            Exists(formfield.queryset.model._base_manager.filter(complex_filter)),
        )
This fixes Django ticket #11707: a limit_choices_to Q object spanning a multi-valued
(join) relationship produced duplicate options in ModelForm choice fields, because the
JOIN produced one row per matching related object. The EXISTS() subquery is a semi-join,
so it cannot duplicate outer rows.
Tests were also changed: tests/model_forms/models.py (StumpJoke gained \`funny\`, related_names
'jokes'/'jokes_today' instead of '+') and tests/model_forms/tests.py gained
LimitChoicesToTests.test_limit_choices_to_no_duplicates.
`

const SUITES = [
  'model_forms',
  'model_formsets model_formsets_regress inline_formsets',
  'forms_tests',
  'admin_widgets admin_filters admin_ordering admin_changelist',
  'admin_views',
  'admin_inlines generic_inline_admin generic_relations generic_relations_regress',
  'contenttypes_tests auth_tests',
  'many_to_many many_to_one one_to_one m2m_through m2m_through_regress m2m_recursive m2m_multiple m2m_and_m2o',
  'queries expressions expressions_case aggregation aggregation_regress',
  'model_fields model_options field_defaults invalid_models_tests',
  'multiple_database schema migrations.test_operations',
  'serializers null_fk null_fk_ordering custom_managers defer select_related prefetch_related',
]

const SUITE_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    ok: { type: 'boolean', description: 'true only if the run ended in OK (no failures/errors)' },
    counts: { type: 'string', description: 'e.g. "Ran 812 tests ... OK (skipped=3)"' },
    failures: {
      type: 'array',
      description: 'one entry per failing/erroring test; empty if none',
      items: {
        type: 'object',
        properties: {
          test: { type: 'string' },
          excerpt: { type: 'string', description: 'short traceback excerpt / assertion message' },
          causedByPatch: { type: 'boolean', description: 'true if it fails because of the patch; verify by re-running with the patch stashed' },
        },
        required: ['test', 'excerpt', 'causedByPatch'],
      },
    },
  },
  required: ['label', 'ok', 'counts', 'failures'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          detail: { type: 'string' },
          failureScenario: { type: 'string', description: 'concrete inputs/state -> wrong behavior, or "n/a"' },
          suggestedFix: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'detail', 'failureScenario'],
      },
    },
    notes: { type: 'string', description: 'anything checked and found clean, briefly' },
  },
  required: ['findings', 'notes'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true only if you could demonstrate the problem is real AND in scope for this patch' },
    refuted: { type: 'boolean' },
    evidence: { type: 'string', description: 'what you actually ran/read and what it showed' },
    recommendation: { type: 'string', enum: ['fix-now', 'note-to-user', 'drop'] },
  },
  required: ['real', 'refuted', 'evidence', 'recommendation'],
}

// ---------- Phase 1: test sweep (pipeline: each suite verifies its own failures) ----------
phase('Sweep')
const sweepP = pipeline(
  SUITES,
  (label) => agent(
    `${CONTEXT}

Run this Django test suite group and report the result:

    ${RUN} ${label} --parallel 8

Notes:
- The run can take several minutes; be patient, use a generous timeout (up to 600000 ms).
- Report EVERY failure or error. For each one, determine whether the patch caused it: re-run
  just that test with the patch reverted (\`cd /testbed && git stash push django/forms/models.py\`,
  re-run, then ALWAYS \`git stash pop\` to restore it — never leave the stash in place, and never
  stash the tests/ files). If it fails both with and without the patch, it is pre-existing:
  causedByPatch=false.
- Do not modify any file. Read-only investigation plus the stash/pop dance only.
- If a label does not exist in this checkout, drop it from the command and say so in counts.`,
    { label: `test:${label.split(' ')[0]}`, phase: 'Sweep', schema: SUITE_SCHEMA },
  ),
)

// ---------- Phase 2: adversarial review lenses ----------
phase('Review')
const LENSES = [
  {
    key: 'semantics',
    prompt: `Lens: SEMANTIC EQUIVALENCE of the filter rewrite.
Prove or disprove that \`qs.filter(Exists(Model._base_manager.filter(lct & Q(pk=OuterRef('pk')))))\`
selects exactly the same DISTINCT set of rows as \`qs.complex_filter(lct)\`, for every shape of
limit_choices_to that Django supports: plain dict, dict with __ lookups, dict with 'pk__in': queryset,
Q object, negated Q (~Q), Q with OR across joins, Q combining a join and a local field, callable
returning any of those, and dict/Q referencing a related field's isnull.
Pay special attention to cases where the two forms could genuinely DIFFER rather than just dedupe:
(a) OR'd conditions across a multi-valued join, (b) negation over a multi-valued join
(NOT EXISTS vs excluded-join semantics), (c) conditions that reference an annotation or alias
defined on formfield.queryset (the subquery is built from _base_manager, which has no such
annotation), (d) a queryset with .using(other_db), (e) a default manager that filters rows
(_default_manager vs _base_manager), (f) sliced or .distinct() or .union() querysets,
(g) limit_choices_to as a dict whose keys collide with Q() kwargs.
Write and run throwaway scripts in /tmp (never modify /testbed files) using the model_forms or
queries test apps to demonstrate each interesting case; a good approach is a small test module
placed in /tmp plus \`${RUN}\`-style settings, or use \`${PY} -c\` with django.setup() against
tests/ settings. Report only differences you actually demonstrated or can show from the SQL
(\`str(qs.query)\`).`,
  },
  {
    key: 'compat',
    prompt: `Lens: BACKWARDS COMPATIBILITY and public API.
1. The guard changed from \`if limit_choices_to is not None\` to \`if limit_choices_to:\`. Enumerate
   the values where this differs ({} , Q(), None, falsy-but-meaningful objects, a callable returning
   {} or Q()) and decide whether any of those previously produced a DIFFERENT queryset than skipping
   entirely. Check \`Q().__and__\`/complex_filter({}) behaviour empirically.
2. Are there third-party-visible consequences: formfield.queryset now carries an Exists() filter, so
   \`formfield.queryset.query\` differs; does anything in Django itself introspect that (admin
   widgets, autocomplete views, ModelChoiceIterator, formsets, \`.only()\`/\`.values()\` chains,
   pickling of the queryset, \`qs.count()\`, further \`.filter()\` chaining, \`repr\`)?
3. Does the change need documentation (docs/ref/models/fields.txt limit_choices_to section,
   docs/releases/3.2.txt release notes)? Check whether a release-note entry for this ticket is
   expected by Django's contribution conventions, and quote the exact file/section where it should go.
4. Does any other Django code path have the same duplicate bug and get missed here, e.g.
   django/db/models/fields/__init__.py Field.get_choices, django/db/models/fields/reverse_related.py
   ForeignObjectRel.get_choices, django/contrib/admin/filters.py RelatedOnlyFieldListFilter,
   ForeignKey.validate? For each, say whether duplicates are observable to a user and whether it is
   in scope for ticket #11707 (which is specifically about formfields).
Read-only: do not modify /testbed files; scratch work goes in /tmp.`,
  },
  {
    key: 'backends',
    prompt: `Lens: DATABASE BACKEND PORTABILITY and query construction.
The patch introduces a correlated \`EXISTS (SELECT ...)\` in the WHERE clause of every choice-field
queryset that has limit_choices_to.
- Check django/db/models/expressions.py Exists/Subquery and the backend features flags in
  django/db/backends/*/features.py for anything that would make this fail or behave differently on
  MySQL, Oracle, PostgreSQL, or SQLite (e.g. supports_boolean_expr_in_select_clause,
  supports_subqueries_in_group_by, Oracle's handling of EXISTS in WHERE, MySQL's
  "This version of MySQL doesn't yet support LIMIT & IN/ALL/ANY/SOME subquery" when
  limit_choices_to itself contains a sliced subquery).
- Confirm that filtering by a bare Exists() (not \`.annotate()\` + \`.filter()\`) is supported in
  THIS checkout: find the code in django/db/models/sql/query.py (build_filter / check_filterable /
  resolve_expression) that accepts a conditional expression as a positional filter arg, and confirm
  Exists.conditional is True. Show the generated SQL for a concrete case.
- Check whether the EXISTS subquery is correctly correlated (OuterRef resolves to the outer table)
  even when the outer queryset later gets extra joins, is used inside a formset, or is re-filtered.
- Note any performance cliff worth telling the user about (correlated subquery per row vs a JOIN),
  and whether an alternative (\`.distinct()\`) would have been better/worse — argue with evidence
  (e.g. distinct() breaking with ordering on related fields, or with .values()).
Read-only: no edits to /testbed; scratch scripts in /tmp only.`,
  },
  {
    key: 'coverage',
    prompt: `Lens: TEST QUALITY / COMPLETENESS of the regression test.
Read the diff in tests/model_forms/models.py and tests/model_forms/tests.py.
- Does test_limit_choices_to_no_duplicates actually fail without the source fix, for BOTH the
  ForeignKey (ModelChoiceField) and the ManyToManyField (ModelMultipleChoiceField) halves? Verify
  each half independently by stashing django/forms/models.py (\`cd /testbed && git stash push
  django/forms/models.py\`, run, then ALWAYS \`git stash pop\`).
- Is the assertion robust across databases and orderings (assertCountEqual vs assertSequenceEqual,
  no Meta.ordering on Character)? Would it pass vacuously if the queryset were empty?
- Changing StumpJoke's related_name from '+' to 'jokes'/'jokes_today' and adding \`funny\`: does that
  break or weaken any other test in tests/model_forms/ (or elsewhere) that relies on the old
  related_name, and does StumpJoke need a migration anywhere? Note tests/admin_views/models.py has
  its OWN StumpJoke that was intentionally left alone — confirm that is fine.
- What untested behaviour remains that a reviewer would ask for: callable limit_choices_to returning
  a join Q, a dict (not Q) spanning a join, limit_choices_to on a formfield declared directly on the
  form, formsets, and the admin. Say which of these you actually exercised and what happened.
- Propose the minimal set of additional assertions worth adding (exact code), if any.
Read-only on /testbed except the stash/pop dance; scratch work in /tmp.`,
  },
  {
    key: 'blast',
    prompt: `Lens: BLAST RADIUS — who calls this function and what else consumes limit_choices_to.
Map every caller of apply_limit_choices_to_to_formfield and every place limit_choices_to reaches a
formfield: fields_for_model, BaseModelForm.__init__ (note it re-applies on EVERY instantiation —
does applying the new Exists() filter repeatedly to an already-filtered queryset compound, and is
that different from before? base_fields vs self.fields deepcopy semantics matter — check
django/forms/forms.py DeclarativeFieldsMetaclass/BaseForm and whether self.fields is a fresh
deepcopy each time), modelform_factory, formsets/inlineformset_factory, admin's
formfield_for_foreignkey / formfield_for_manytomany / autocomplete views / RelatedFieldWidgetWrapper,
contenttypes GenericForeignKey, and django.contrib.auth forms.
Then answer precisely: can the Exists() filter be applied twice to the same queryset in any real code
path, and if so what is the resulting SQL and is it still correct? Demonstrate with a concrete run
(e.g. instantiate a ModelForm twice, or a formset with several forms, and print
\`str(form.fields['most_recently_fooled'].queryset.query)\`) using the model_forms test app.
Read-only: no edits to /testbed; scratch scripts in /tmp.`,
  },
]

const reviewP = pipeline(
  LENSES,
  (l) => agent(`${CONTEXT}\n\n${l.prompt}`, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  // Verify each finding as soon as its lens finishes, with three distinct skeptic angles.
  (res, l) => parallel((res?.findings ?? []).filter(f => f.severity !== 'nit').map((f) => () =>
    parallel(['does-it-reproduce', 'is-it-in-scope-for-this-ticket', 'would-upstream-django-accept-this-objection'].map((angle) => () =>
      agent(
        `${CONTEXT}

Adversarially verify this review finding. Your default is REFUTED — only mark real=true if you
demonstrate it concretely.

Finding (from the '${l.key}' lens):
  title: ${f.title}
  file: ${f.file}
  severity: ${f.severity}
  detail: ${f.detail}
  failure scenario: ${f.failureScenario}
  suggested fix: ${f.suggestedFix ?? '(none)'}

Verify through the "${angle}" lens specifically.
- does-it-reproduce: actually run code proving the claimed behaviour. If you cannot reproduce it,
  refuted=true.
- is-it-in-scope-for-this-ticket: ticket #11707 is only about duplicate options in formfields. A
  pre-existing quirk of complex_filter, or a limitation that existed before this patch too, is NOT a
  defect of this patch — check the old code path's behaviour by stashing django/forms/models.py
  (always \`git stash pop\` afterwards).
- would-upstream-django-accept-this-objection: judge against Django's actual conventions and the
  real upstream fix for this ticket; a stylistic preference or a theoretical performance concern that
  upstream knowingly accepted is refuted=true (recommendation 'note-to-user' at most).
Read-only on /testbed apart from stash/pop; scratch work in /tmp.`,
        { label: `verify:${l.key}:${angle}`, phase: 'Verify', schema: VERDICT_SCHEMA },
      ),
    )).then((votes) => {
      const v = votes.filter(Boolean)
      const realVotes = v.filter((x) => x.real && !x.refuted).length
      return { finding: f, lens: l.key, votes: v, survives: realVotes >= 2 }
    }),
  )),
)

const [sweep, reviewed] = await Promise.all([sweepP, reviewP])

const suites = sweep.filter(Boolean)
const regressions = suites.flatMap((s) => (s.failures ?? []).filter((f) => f.causedByPatch).map((f) => ({ suite: s.label, ...f })))
const preexisting = suites.flatMap((s) => (s.failures ?? []).filter((f) => !f.causedByPatch).map((f) => ({ suite: s.label, ...f })))
const judged = reviewed.flat().filter(Boolean)
const confirmed = judged.filter((j) => j.survives)
log(`sweep: ${suites.filter(s => s.ok).length}/${suites.length} suite groups clean, ${regressions.length} patch-caused failures; review: ${confirmed.length}/${judged.length} findings survived verification`)

// ---------- Phase 3: completeness critic + synthesis ----------
phase('Synthesize')
const critic = await agent(
  `${CONTEXT}

A test sweep and a 5-lens adversarial review of this patch just finished.

Suite results: ${JSON.stringify(suites.map((s) => ({ label: s.label, ok: s.ok, counts: s.counts, failures: (s.failures ?? []).map((f) => ({ test: f.test, causedByPatch: f.causedByPatch })) })))}

Surviving findings: ${JSON.stringify(confirmed.map((c) => ({ lens: c.lens, ...c.finding })))}
Refuted findings: ${JSON.stringify(judged.filter((j) => !j.survives).map((c) => ({ lens: c.lens, title: c.finding.title, why: c.votes.map((v) => v.evidence).join(' | ').slice(0, 400) })))}

Your job: find what is MISSING. Specifically:
1. Is there a code path, test suite, or limit_choices_to shape nobody exercised that could still be
   broken? Name it and, if cheap, exercise it yourself now (read-only; scratch in /tmp;
   \`${RUN} <label>\` to run suites).
2. Is the fix complete for the ticket as reported — a Q object on a ForeignKey involving a join
   rendering duplicate OPTIONS? Confirm end-to-end at the rendered-HTML level: build a form and
   assert the rendered <option> list has no duplicates (not just the queryset).
3. Verify the working tree is clean of stray edits and no git stash was left behind by the reviewers:
   \`cd /testbed && git status --porcelain && git stash list && git diff --stat\`. The ONLY modified
   files should be django/forms/models.py, tests/model_forms/models.py, tests/model_forms/tests.py.
   Report the exact output.
Return a concise report: gaps found (with evidence), anything still broken, and a final
ship/don't-ship verdict.`,
  { label: 'critic', phase: 'Synthesize' },
)

return { suites: suites.map((s) => ({ label: s.label, ok: s.ok, counts: s.counts })), regressions, preexisting, confirmed: confirmed.map((c) => ({ lens: c.lens, ...c.finding })), refutedCount: judged.length - confirmed.length, critic }
