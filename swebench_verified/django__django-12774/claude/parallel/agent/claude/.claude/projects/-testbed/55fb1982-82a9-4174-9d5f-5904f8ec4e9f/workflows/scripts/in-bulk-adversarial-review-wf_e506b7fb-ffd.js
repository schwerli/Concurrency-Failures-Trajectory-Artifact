export const meta = {
  name: 'in-bulk-adversarial-review',
  description: 'Adversarially review the in_bulk() total-UniqueConstraint change from multiple independent lenses',
  phases: [
    { title: 'Review', detail: 'independent reviewers, each with a distinct lens' },
    { title: 'Verify', detail: 'refute each finding by reading code and running it' },
  ],
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
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
          detail: { type: 'string' },
          failureScenario: { type: 'string', description: 'Concrete inputs/state -> wrong behavior. Empty if not a correctness defect.' },
        },
        required: ['title', 'file', 'severity', 'detail'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is wrong, already handled, or not a real problem' },
    reasoning: { type: 'string' },
    evidence: { type: 'string', description: 'Commands run / code read that establish the verdict' },
  },
  required: ['refuted', 'reasoning'],
}

const CONTEXT = `Repository: /testbed (Django 3.1 alpha source checkout).

Change under review (already applied to the working tree — inspect with \`cd /testbed && git diff\`):
Django ticket "Allow QuerySet.in_bulk() for fields with total UniqueConstraints".
\`QuerySet.in_bulk()\` previously required \`field_name == 'pk'\` or a field with \`unique=True\`.
It now also accepts a field that is the sole field of a total (unconditional) \`UniqueConstraint\`,
via \`Options.total_unique_constraints\` (django/db/models/options.py:831).

Files touched: django/db/models/query.py, tests/lookup/models.py, tests/lookup/tests.py,
docs/ref/models/querysets.txt, docs/releases/3.1.txt.

Test command: \`cd /testbed/tests && /opt/miniconda3/envs/testbed/bin/python runtests.py <labels>\`
using the interpreter /opt/miniconda3/envs/testbed/bin/python (NOT /opt/miniconda3/bin/python).

You may run code and read anything. Do NOT modify tracked files; if you must experiment, write
scratch files under /tmp and clean up. Report only real problems — an empty findings list is a
perfectly good answer.`

const LENSES = [
  {
    key: 'correctness',
    prompt: `${CONTEXT}

LENS: CORRECTNESS of the new guard in \`QuerySet.in_bulk\`.
Scrutinize specifically:
- Multi-field UniqueConstraints must NOT make a member field eligible. Is \`len(constraint.fields) == 1\` correct and is \`fields[0]\` always safe?
- Conditional (partial) UniqueConstraints must NOT qualify. Verify \`total_unique_constraints\` really filters them, and that CheckConstraints can't leak through.
- Is short-circuit ordering such that a bogus field_name still raises FieldDoesNotExist (not ValueError, not IndexError)? Write a script to prove it.
- Constraints inherited from abstract and from concrete (MTI) parents: does \`_meta.constraints\` include them? Does in_bulk behave sanely for a child model? Actually construct such models in /tmp and test.
- A UniqueConstraint on a ForeignKey: does \`constraint.fields\` hold 'author' while the user might pass 'author_id'? What does in_bulk do for each? Is \`getattr(obj, field_name)\` correct in both cases? Test it.
- Nullable field with a single-field UniqueConstraint: NULLs are not deduplicated by SQL unique indexes. Does in_bulk silently drop/collide rows? Compare against the pre-existing behavior for a \`unique=True, null=True\` field (Article.slug is exactly that) — is the new path any worse than the status quo? Only flag if the new code makes it worse.
Prove or disprove each with real executed code. Report defects only.`,
  },
  {
    key: 'regression',
    prompt: `${CONTEXT}

LENS: REGRESSION RISK from the test-model changes.
The change added \`Meta.constraints\` with \`UniqueConstraint(fields=['year'], name='season_year_unique')\` to the existing \`Season\` model in tests/lookup/models.py, and added two new models (\`MultipleFieldsConstraintProduct\`, \`ConditionConstraintProduct\`).
Scrutinize:
- Does any existing test create two \`Season\` rows with the same \`year\` inside one test method (which would now IntegrityError)? Grep every Season.objects.create / bulk_create / fixture across ALL of tests/, not just tests/lookup/. Report line numbers you checked.
- Are constraint/index names globally unique across the whole test suite database? The names used are 'season_year_unique', 'lookup_name_color_uniq', 'lookup_name_without_color_uniq'. Grep the entire tests/ tree for collisions — an earlier iteration of this change collided with tests/constraints/models.py. Verify no remaining collision.
- \`ConditionConstraintProduct\` declares \`required_db_features = {'supports_partial_indexes'}\`. Is that necessary and sufficient to avoid system check models.W036 on MySQL/Oracle? Read django/db/models/base.py _check_constraints.
- Does adding Meta to Season change its default ordering, managers, db_table, or anything else observable? Confirm Season had no Meta before.
- Run the suites that touch these models and report exact pass/fail counts.
Report defects only.`,
  },
  {
    key: 'api-design',
    prompt: `${CONTEXT}

LENS: API DESIGN, SCOPE, and CONSISTENCY WITH DJANGO'S CONVENTIONS.
Scrutinize:
- Should \`Meta.unique_together\` single-field entries also be honored? Argue for/against; check what upstream Django's own \`total_unique_constraints\` consumers do (django/db/models/base.py:1027,1031, fields/related.py:533, contrib/admin/views/main.py:376). Is excluding unique_together defensible and consistent? Give a clear recommendation.
- Compare the new code to how the OTHER consumers of total_unique_constraints filter for single-field constraints. Is there an existing idiom/helper this should reuse instead of open-coding the list comprehension? Quote them.
- Is the error message still accurate now that "unique field" has a broader meaning? Should it change? Note that tests/lookup/tests.py asserts the exact string.
- Style: does the code match Django's coding style (django/contrib/... conventions, docs/internals/contributing/writing-code/coding-style.txt)? Check line length against setup.cfg max-line-length, and whether \`opts = self.model._meta\` binding matches nearby methods in query.py.
- Should the docstring of in_bulk mention this?
Report defects and concrete improvements only.`,
  },
  {
    key: 'docs',
    prompt: `${CONTEXT}

LENS: DOCUMENTATION accuracy and build-correctness.
Scrutinize the diff in docs/ref/models/querysets.txt and docs/releases/3.1.txt:
- Is the reworded in_bulk paragraph factually precise about what now qualifies (sole field of an unconditional UniqueConstraint)? Does it accidentally imply multi-field constraints qualify?
- Are the reST roles correct and resolvable? \`:class:\`~django.db.models.UniqueConstraint\`\` and \`:meth:\`.QuerySet.in_bulk\`\` — confirm the targets exist (docs/ref/models/constraints.txt, docs/ref/models/querysets.txt) and that the abbreviated \`.\`-prefix form is the right convention for each file. Check the active \`.. currentmodule::\` at each location.
- Is \`.. versionchanged:: 3.1\` the right directive and version? Confirm django/__init__.py VERSION. Is it placed per this file's convention (compare the bulk_create and explain versionchanged blocks in the same file)?
- Is the release-notes bullet in the right section, right order, right indentation, under 79 columns?
- Try to actually build/validate the docs if sphinx is available (\`cd /testbed/docs && python -m sphinx -b dummy . _build/dummy\` or check \`make spelling\`/docutils). If sphinx is unavailable, say so explicitly rather than guessing. At minimum, check for reST syntax errors in the changed hunks.
Report defects only.`,
  },
  {
    key: 'test-quality',
    prompt: `${CONTEXT}

LENS: TEST QUALITY — do the new tests actually pin the behavior?
The new tests in tests/lookup/tests.py are test_in_bulk_meta_constraint, test_in_bulk_multiple_fields_meta_constraint, test_in_bulk_conditional_meta_constraint.
Scrutinize:
- MUTATION TESTING: revert the source change in django/db/models/query.py (in a /tmp COPY of the repo, or by editing and then restoring with \`git checkout\`) and confirm test_in_bulk_meta_constraint FAILS. Then mutate the guard in targeted ways — e.g. drop the \`len(constraint.fields) == 1\` filter; drop the \`field_name not in unique_fields\` clause; use \`opts.constraints\` instead of \`opts.total_unique_constraints\` — and confirm at least one new test catches EACH mutation. Report any mutation that survives (that's a test-coverage gap). YOU MUST RESTORE THE TREE EXACTLY with \`cd /testbed && git checkout -- django/db/models/query.py\` afterwards and verify with \`git diff --stat\` that the intended change is still present.
- Is the positive test asserting the right thing (that the third Season is excluded, that values map to the right objects)?
- Is \`@skipUnlessDBFeature('supports_partial_indexes')\` needed on the conditional test given the ValueError is raised before any SQL? Is it harmful or just conservative?
- Any missing case worth adding: in_bulk with no id_list on a constraint field, ordering/slicing interaction, a constraint field that is also the pk?
Report gaps only. Be rigorous about restoring the tree.`,
  },
]

phase('Review')
const reviewed = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  (res, lens) => {
    const fs = (res && res.findings) || []
    if (!fs.length) return []
    return parallel(fs.map(f => () =>
      agent(`${CONTEXT}

A reviewer working the "${lens.key}" lens raised this finding against the applied change:

Title: ${f.title}
File: ${f.file}${f.line ? ':' + f.line : ''}
Severity: ${f.severity}
Detail: ${f.detail}
Failure scenario: ${f.failureScenario || '(none given)'}

Your job is to REFUTE it. Read the actual code and RUN code to check. Default to refuted=true
if the finding is speculative, already handled elsewhere, purely stylistic noise, or describes
behavior that is unchanged from before this patch (pre-existing behavior is not a regression).
Only set refuted=false if you independently reproduced a genuine problem introduced or left
unfixed by THIS change. Do not modify tracked files; restore anything you touch.`,
        { label: `verify:${lens.key}:${(f.title || '').slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then(v => ({ lens: lens.key, ...f, verdict: v }))
    ))
  }
)

const all = reviewed.flat().filter(Boolean)
const survived = all.filter(f => f.verdict && f.verdict.refuted === false)
log(`${all.length} findings raised, ${survived.length} survived refutation`)

return { survived, refuted: all.filter(f => !survived.includes(f)) }
