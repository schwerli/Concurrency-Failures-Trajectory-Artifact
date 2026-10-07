export const meta = {
  name: 'mixedcase-app-label-fk',
  description: 'Map and design the fix for makemigrations crashing on FK with mixed-case app label (Django #31641 regression from 9e1b6b8a66)',
  phases: [
    { title: 'Repro', detail: 'confirm the crash in a scratch project' },
    { title: 'Map', detail: 'parallel audits of every app_label-case-destroying site' },
    { title: 'Design', detail: 'independent candidate fixes' },
    { title: 'Judge', detail: 'score candidates on correctness + minimality' },
  ],
}

const CONTEXT = `
REPO: /testbed  (Django main branch, version 3.2 dev). A git repo, currently clean.
Additional writable dir: /workspace. Use /tmp for scratch work.

THE BUG (Django ticket #31641): "makemigrations crashes for ForeignKey with mixed-case app name."
An app whose app_label has mixed case (e.g. INSTALLED_APPS contains 'DJ_RegLogin', so app_label
== 'DJ_RegLogin') that has a model with a ForeignKey to another model in the same app fails with:

  ValueError: The field DJ_RegLogin.Content.category was declared with a lazy reference to
  'dj_reglogin.category', but app 'dj_reglogin' isn't installed.

Worked in Django 3.0, broke in 3.1.

ROOT CAUSE ALREADY IDENTIFIED (do not re-derive, build on it):
commit 9e1b6b8a66af4c2197e5b1b41eb9dbb36e4f6502 "Fixed #23916 -- Allowed makemigrations to handle
related model name case changes." changed ForeignObject.deconstruct() in
django/db/models/fields/related.py from:

        if isinstance(self.remote_field.model, str):
            kwargs['to'] = self.remote_field.model
        else:
            kwargs['to'] = "%s.%s" % (self.remote_field.model._meta.app_label,
                                      self.remote_field.model._meta.object_name)
  to (currently around line 584-587):
        if isinstance(self.remote_field.model, str):
            kwargs['to'] = self.remote_field.model.lower()
        else:
            kwargs['to'] = self.remote_field.model._meta.label_lower

Both new branches lowercase the ENTIRE "app_label.ModelName" string, including the app_label.
Model names are case-insensitive in Django's registry (Apps.get_model does model_name.lower()),
but APP LABELS ARE CASE-SENSITIVE (Apps.app_configs is keyed by the label verbatim). So
'DJ_RegLogin.Category' deconstructs to 'dj_reglogin.category', and the resulting lazy reference
can never be resolved against app_configs['DJ_RegLogin'].

RUNNING TESTS: cd /testbed && python tests/runtests.py <label> --parallel=1
  relevant labels: field_deconstruction, migrations, invalid_models_tests, model_fields,
  model_meta, schema, apps, check_framework, model_options, admin_scripts
`;

// ---------------------------------------------------------------- Phase 1: repro
phase('Repro')
const REPRO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reproduced', 'how', 'traceback', 'stack_path'],
  properties: {
    reproduced: { type: 'boolean' },
    how: { type: 'string', description: 'Exact commands + files used, so another agent can rerun it verbatim' },
    traceback: { type: 'string', description: 'The key frames of the actual traceback observed' },
    stack_path: {
      type: 'array', items: { type: 'string' },
      description: 'Ordered file:line hops from FK declaration to the raised error',
    },
    scratch_dir: { type: 'string' },
  },
}

const repro = await agent(`${CONTEXT}

TASK: Reproduce this crash for real, from scratch, and trace it precisely.

1. Create a minimal scratch Django project OUTSIDE the repo (e.g. /tmp/mixedcase_repro) with an app
   whose app_label is mixed case, e.g. package dir 'DJ_RegLogin' with an apps.py AppConfig whose
   name = 'DJ_RegLogin', a Category model and a Content model with
   category = models.ForeignKey(Category, on_delete=models.CASCADE). Put 'DJ_RegLogin' in
   INSTALLED_APPS. Use the /testbed Django (PYTHONPATH=/testbed) and sqlite3.
2. Run 'python manage.py makemigrations' and 'python manage.py migrate' and capture the failure.
3. Now instrument/trace to prove the exact mechanism: which call lowercases the app_label, and
   which code path then consumes the mangled string and registers the unresolvable lazy reference.
   Use pdb/print tracing or targeted greps to nail every hop:
   deconstruct -> ModelState.from_model / autodetector -> StateApps rendering ->
   Apps.lazy_model_operation / do_pending_operations -> _check_lazy_references.
   Note: the crash surfaces both via makemigrations and via migrate's state rendering.
4. Also determine whether a ManyToManyField and a string-reference FK ('DJ_RegLogin.Category' and
   bare 'Category') hit the same failure.

Do NOT modify anything under /testbed. Report exactly what you ran and observed.`,
  { label: 'repro', phase: 'Repro', schema: REPRO_SCHEMA });

log(repro?.reproduced ? 'Crash reproduced — mapping blast radius' : 'Repro inconclusive — mapping anyway');

// ---------------------------------------------------------------- Phase 2: map (parallel audits)
phase('Map')
const SITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sites', 'notes'],
  properties: {
    notes: { type: 'string' },
    sites: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'code', 'destroys_app_label_case', 'reasoning'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          code: { type: 'string' },
          destroys_app_label_case: { type: 'boolean' },
          relied_on_by: { type: 'string', description: 'What downstream behaviour depends on this lowercasing (e.g. #23916 case-change detection)' },
          reasoning: { type: 'string' },
        },
      },
    },
  },
}

const LENSES = [
  {
    key: 'fields',
    prompt: `Audit django/db/models/fields/related.py exhaustively for every place an
"app_label.ModelName" style reference string is built, parsed, lowercased or compared.
Cover: resolve_relation(), lazy_related_operation(), RelatedField.deconstruct(),
ForeignObject.deconstruct(), ForeignKey.deconstruct(), ManyToManyField.deconstruct() (including
its 'through' and 'to' handling), contribute_to_class, related_name/related_query_name
interpolation (%(app_label)s / %(class)s), and the swappable-setting branches. For each, say
whether it lowercases the app_label portion and whether that is a bug for a mixed-case app_label.
Pay special attention to whether ManyToManyField.deconstruct has the SAME .lower() bug as
ForeignObject.deconstruct, and to django/db/models/utils.py make_model_tuple().`,
  },
  {
    key: 'migrations',
    prompt: `Audit the migrations machinery for app_label case handling of related-model
references. Cover: django/db/migrations/operations/utils.py resolve_relation() and
field_references()/ModelTuple-style helpers (note line ~22 does model.lower().split('.', 1) —
decide if it's a bug), django/db/migrations/state.py (ModelState.from_model, .render(),
_get_related_models, StateApps.__init__ / bulk_create / render_multiple, the 'relations'
bookkeeping), django/db/migrations/autodetector.py (renamed_models_rel,
_generate_altered_fields / _get_dependencies_for_foreign_key / _resolve_dependency,
only_relation_agnostic_fields, deep_deconstruct). Report every site that lowercases or
case-sensitively compares an app_label.`,
  },
  {
    key: 'registry',
    prompt: `Establish authoritatively how case-sensitive app labels vs model names are in
Django's registry and check framework. Read django/apps/registry.py (get_app_config, get_model,
lazy_model_operation, do_pending_operations, _pending_operations keys),
django/apps/config.py (label derivation and its validation), django/db/models/utils.py
make_model_tuple, django/core/checks/model_checks.py _check_lazy_references, and
django/db/models/options.py (label, label_lower, app_label). Answer precisely: is a mixed-case
app_label legal and supported? Where is the asymmetry (model name case-insensitive, app label
case-sensitive) enforced? Quote the code. Also check AppConfig.label validation rules
(is_valid_identifier etc.) to confirm 'DJ_RegLogin' is a legal label.`,
  },
  {
    key: 'tests',
    prompt: `Find the tests that pin the CURRENT lowercasing behaviour, since any fix must not
break them. Read tests/field_deconstruction/tests.py (the assertions changed by commit
9e1b6b8a66 — run 'git show 9e1b6b8a66 -- tests/' to see exactly which), and
tests/migrations/test_autodetector.py (the test added by that commit for related model name case
changes, likely named something like test_rename_related_field_preserved_db_column or
test_alter_field_to_fk_dependency_other_app / a case-change test). Also search the whole tests/
tree for any existing mixed-case app_label fixtures or tests (grep for app_label with capitals,
'Label', 'label='). Report: (a) which exact assertions depend on 'to' being fully lowercased,
(b) which depend only on the MODEL NAME being lowercased, (c) where a regression test for this
bug should live and what it should assert.`,
  },
]

const maps = await parallel(LENSES.map(l => () =>
  agent(`${CONTEXT}

REPRO EVIDENCE from a prior agent:
${JSON.stringify(repro, null, 2)}

TASK (${l.key} lens): ${l.prompt}

Read-only: do NOT modify any file. Cite exact file:line and quote the code. Be exhaustive —
a missed site means an incomplete fix.`,
    { label: `map:${l.key}`, phase: 'Map', schema: SITE_SCHEMA })
));

const allSites = maps.filter(Boolean).flatMap((m, i) =>
  (m.sites || []).map(s => ({ ...s, lens: LENSES[i].key })));
const buggy = allSites.filter(s => s.destroys_app_label_case);
log(`Map complete: ${allSites.length} reference sites, ${buggy.length} flagged as case-destroying`);

// ---------------------------------------------------------------- Phase 3: design candidates
phase('Design')
const PATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approach_name', 'rationale', 'diff', 'files_touched', 'preserves_23916', 'risks', 'tests_to_add'],
  properties: {
    approach_name: { type: 'string' },
    rationale: { type: 'string' },
    diff: { type: 'string', description: 'Unified diff against /testbed, applyable with git apply' },
    files_touched: { type: 'array', items: { type: 'string' } },
    preserves_23916: { type: 'string', description: 'Explain how related MODEL NAME case changes still produce no spurious migration' },
    risks: { type: 'array', items: { type: 'string' } },
    tests_to_add: { type: 'string', description: 'Concrete test code + file path for the regression test' },
    existing_tests_needing_update: { type: 'array', items: { type: 'string' } },
  },
}

const EVIDENCE = `
REPRO:
${JSON.stringify(repro, null, 2)}

CASE-DESTROYING / RELEVANT SITES FOUND BY THE AUDIT:
${JSON.stringify(allSites, null, 2)}

AUDIT NOTES:
${maps.filter(Boolean).map((m, i) => `--- ${LENSES[i].key} ---\n${m.notes}`).join('\n\n')}
`;

const ANGLES = [
  { key: 'minimal', hint: `Aim for the SMALLEST correct change: preserve the intent of #23916
(model name case changes must not generate spurious migrations) while keeping the app_label's
case intact. Consider splitting on '.' and lowercasing only the model-name half, in every
deconstruct() that has this bug. Prefer a shared helper if more than one site needs it.` },
  { key: 'thorough', hint: `Aim for a change that fixes EVERY site the audit flagged, including
the migrations operations/utils.py resolve_relation and any ManyToManyField/through handling, so
that no other mixed-case-app_label path can crash. Justify each hunk with a concrete failure it
prevents; do not include hunks you cannot justify.` },
  { key: 'upstream', hint: `Reason about what the Django core team most plausibly committed for
ticket #31641 in 3.1.1, and reproduce that shape — idiomatic for this codebase, minimal blast
radius, with the regression test placed where Django would put it. Django's actual fix touched
ForeignKey/ForeignObject deconstruct and added tests; match Django's code style (quoting,
comments, naming) exactly as found in the surrounding file.` },
]

const candidates = await parallel(ANGLES.map(a => () =>
  agent(`${CONTEXT}

${EVIDENCE}

TASK: Design and write a concrete patch fixing this bug. ANGLE: ${a.hint}

Requirements:
- Produce a real unified diff against /testbed that 'git apply' accepts. Verify it applies by
  copying the repo to a scratch clone (e.g. 'git -C /testbed worktree list' is off-limits; instead
  'cp -a' or 'git clone /testbed /tmp/clone_${a.key}') and running 'git apply' + the relevant tests
  THERE. Never modify /testbed itself.
- Run at minimum: python tests/runtests.py field_deconstruction migrations invalid_models_tests
  model_fields --parallel=1  in your clone, and report real pass/fail numbers.
- Include a regression test that would fail before your fix and pass after. Verify that claim by
  running the test both with and without the source hunks applied.
- State explicitly how the #23916 behaviour (no spurious migration on related model NAME case
  change) is preserved, and whether tests/field_deconstruction assertions need updating.

Report the diff and the ACTUAL test output numbers you observed, not what you expect.`,
    { label: `design:${a.key}`, phase: 'Design', schema: PATCH_SCHEMA })
));

const alive = candidates.filter(Boolean);
log(`${alive.length}/${ANGLES.length} candidate patches produced`);

// ---------------------------------------------------------------- Phase 4: judge panel
phase('Judge')
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'best_index', 'best_reason', 'must_fix', 'recommended_diff'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['approach_name', 'correctness', 'minimality', 'verdict'],
        properties: {
          approach_name: { type: 'string' },
          correctness: { type: 'integer', minimum: 0, maximum: 10 },
          minimality: { type: 'integer', minimum: 0, maximum: 10 },
          verdict: { type: 'string' },
        },
      },
    },
    best_index: { type: 'integer' },
    best_reason: { type: 'string' },
    must_fix: { type: 'array', items: { type: 'string' }, description: 'Defects in the winner that must be corrected before landing' },
    recommended_diff: { type: 'string', description: 'The final diff to land: winner, plus any grafted hunks/tests from runners-up, with must_fix applied. Must be verified to apply and pass tests.' },
    verified_test_output: { type: 'string' },
  },
}

const judged = await parallel(['correctness', 'regression-risk', 'style-and-tests'].map(lens => () =>
  agent(`${CONTEXT}

${EVIDENCE}

CANDIDATE PATCHES:
${JSON.stringify(alive, null, 2)}

TASK: Judge these candidates through the ${lens} lens, then produce the diff you would land.

${lens === 'correctness' ? `Focus: does each patch actually fix the reported crash for ALL of:
FK to a model class in the same mixed-case app; FK by string 'DJ_RegLogin.Category'; FK by bare
string 'Category'; ManyToManyField; a FK across two mixed-case apps; and a swappable
(AUTH_USER_MODEL) reference where the setting has mixed case. Adversarially try to break each
patch — construct the case it gets wrong.` : ''}
${lens === 'regression-risk' ? `Focus: what does each patch break? Specifically hunt for
(a) spurious-migration regressions of #23916, (b) migration files already written on disk with
fully-lowercased 'to' values that must keep loading, (c) autodetector dependency matching that
compares deconstructed 'to' against ModelState keys, (d) case-insensitive app_label comparisons
elsewhere that would now see a mixed-case value. Run the migrations test suite in a clone to
back your claims with numbers.` : ''}
${lens === 'style-and-tests' ? `Focus: is the code idiomatic for this file, is the regression test
in the right place with the right name and assertions, is any docs/release-note needed? Verify the
regression test genuinely fails without the source hunks (run it) — a test that passes either way
is worthless.` : ''}

You MUST empirically verify before scoring: clone /testbed to /tmp/judge_${lens}, apply each
candidate, run the test suites. Report real numbers in verified_test_output. Never modify /testbed.
recommended_diff must be a diff you actually applied and tested successfully in your clone.`,
    { label: `judge:${lens}`, phase: 'Judge', schema: VERDICT_SCHEMA })
));

return {
  repro,
  sites: { total: allSites.length, case_destroying: buggy },
  candidates: alive,
  verdicts: judged.filter(Boolean),
}
