export const meta = {
  name: 'w042-inherited-pk-analysis',
  description: 'Root-cause models.W042 false positive on inherited manually specified primary keys',
  phases: [
    { title: 'Investigate', detail: 'parallel lenses on pk creation, inheritance, and the check' },
    { title: 'Synthesize', detail: 'merge into a single fix proposal' },
  ],
}

const REPO = '/testbed'

const LENSES = [
  {
    key: 'mti-parent-link',
    prompt: `In the Django checkout at ${REPO}, explain EXACTLY how the primary key of a multi-table-inheritance (MTI) child model is created.

Read django/db/models/base.py (ModelBase.__new__, the parent-link creation logic) and django/db/models/options.py (Options._prepare, setup_pk).

Answer concretely:
1. When \`class Child(Parent)\` with Parent concrete and Parent having an EXPLICIT pk (e.g. id = models.AutoField(primary_key=True) or a UUIDField pk), what field object is Child._meta.pk? What is its class? What is its \`auto_created\` value and WHY?
2. Same question when the user explicitly declares \`parent_ptr = models.OneToOneField(Parent, models.CASCADE, parent_link=True)\` on the child. Is auto_created True or False then?
3. What are \`Child._meta.pk.remote_field.parent_link\` and \`Child._meta.pk.remote_field.model\` in each case?
4. Is there any OTHER situation (not MTI) where _meta.pk is a OneToOneField with parent_link=True?

Quote the exact file:line for each claim. Be precise; do not speculate.`,
  },
  {
    key: 'abstract-and-proxy',
    prompt: `In the Django checkout at ${REPO}, determine which models the models.W042 check (\`Model._check_default_pk\` in django/db/models/base.py, invoked via django/core/checks/model_checks.py check_all_models) actually runs on.

Answer:
1. Are abstract models included? Trace apps.get_models() / Apps.register_model to prove it.
2. Are proxy models included? For \`class ProxyChild(Concrete): class Meta: proxy = True\`, what is ProxyChild._meta.pk and its auto_created value? Note Options.setup_proxy in options.py. Would a proxy of a model with an AUTO-created pk produce a duplicate W042 warning today?
3. Are swapped-out models (e.g. a replaced auth.User) included?
4. For abstract-parent inheritance (\`class Child(AbstractParentWithExplicitPk)\`), what is Child._meta.pk.auto_created? Does W042 fire today? Should it?

Quote exact file:line for each claim.`,
  },
  {
    key: 'check-semantics',
    prompt: `In the Django checkout at ${REPO}, read \`Model._check_default_pk\` in django/db/models/base.py (around line 1298) and the tests in tests/check_framework/test_model_checks.py (class ModelDefaultAutoFieldTests) plus tests/check_framework/apps.py.

Answer:
1. Exactly what the check currently tests, condition by condition.
2. What DEFAULT_AUTO_FIELD is used for in Options._get_default_pk_class (options.py) — in particular, for an MTI child whose pk is a promoted parent link, does DEFAULT_AUTO_FIELD have ANY effect on that child's pk column type? Prove it.
3. Therefore: is warning on an MTI child ever actionable for the user? What would setting DEFAULT_AUTO_FIELD or app_config.default_auto_field change for that child?
4. List every existing test in the repo that asserts W042 is or isn't raised, with file:line.

Quote exact file:line for each claim.`,
  },
  {
    key: 'upstream-shape',
    prompt: `In the Django checkout at ${REPO}, search the codebase for existing idioms used to detect "this field is an auto-created parent link" — i.e. patterns like \`isinstance(f, OneToOneField) and f.remote_field.parent_link\`, or \`field.remote_field.parent_link\`, or \`parent_links\`, or \`auto_created and field.remote_field.parent_link\`.

Use grep across django/. For each hit report file:line and the exact expression used. I want to write a new condition in django/db/models/base.py::_check_default_pk that matches the codebase's existing idiom for "pk is an (auto-created) parent link".

Also report:
- Is \`OneToOneField\` already imported in django/db/models/base.py? If not, what is imported from django.db.models.fields.related there, and would adding OneToOneField create a circular import? Check the import block at the top of base.py.
- Does \`django/db/models/options.py\` expose anything like \`parents\` that could be used instead? Which is more robust?`,
  },
  {
    key: 'regression-surface',
    prompt: `In the Django checkout at ${REPO}, I am about to change \`Model._check_default_pk\` in django/db/models/base.py so that it does NOT warn when the model's pk is a parent link (MTI child), because the pk is inherited and the parent is checked separately.

Identify the regression surface:
1. Which test files/tests could break? grep the tests/ tree for W042, 'Auto-created primary key', DEFAULT_AUTO_FIELD, default_auto_field.
2. Are there tests that rely on W042 firing for a child model?
3. Is there documentation (docs/) describing W042 or DEFAULT_AUTO_FIELD that would need updating? Give file:line.
4. Which test labels should be run to validate the change? Give the exact \`python tests/runtests.py <labels>\` command.

Quote exact file:line for each claim.`,
  },
]

phase('Investigate')
const findings = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `probe:${l.key}`, phase: 'Investigate' })
))

const usable = findings.map((f, i) => `### ${LENSES[i].key}\n${f ?? '(no result)'}`).join('\n\n')

phase('Synthesize')
const plan = await agent(
  `You are synthesizing five independent investigations of a Django bug into one precise fix proposal.

BUG (Django ticket #32388): models.W042 "Auto-created primary key used when not defining a primary key type" is raised on multi-table-inheritance child models whose parent defines an explicit primary key. The child's pk is an auto-created parent-link OneToOneField, so \`cls._meta.pk.auto_created\` is True — but the user cannot fix this by setting DEFAULT_AUTO_FIELD, and the pk is not really auto-created in the sense the check means.

Repo: ${REPO}. The check lives in django/db/models/base.py::Model._check_default_pk.

INVESTIGATIONS:
${usable}

Produce:
1. A one-paragraph root cause statement.
2. The EXACT unified diff for django/db/models/base.py (including any needed import change). Keep it minimal and match Django's code style (the file uses 4-space indent, and the existing condition is a multi-line boolean in an \`if (...)\`). Include a short comment explaining why parent links are skipped.
3. Whether abstract-parent inheritance is affected (it should still warn, because there the pk really is auto-created in that model's own app) — state clearly.
4. The exact new tests to add to tests/check_framework/test_model_checks.py::ModelDefaultAutoFieldTests, written out in full Django test style, covering: explicit inherited pk, explicit inherited parent_link declared by the user, auto-created inherited pk (must STILL warn, on the parent only), and auto-created inherited parent_link.
5. The exact runtests.py command to validate.

Be concrete and complete. Output the diff and tests verbatim, ready to apply.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' }
)

return plan
