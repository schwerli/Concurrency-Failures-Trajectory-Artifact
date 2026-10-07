export const meta = {
  name: 'w042-fix-adversarial-verify',
  description: 'Adversarially verify the models.W042 parent-link fix in django/db/models/base.py',
  phases: [
    { title: 'Refute', detail: 'independent skeptics attack the patch from distinct lenses' },
    { title: 'Judge', detail: 'merge surviving objections' },
  ],
}

const PATCH = `
--- a/django/db/models/base.py
+++ b/django/db/models/base.py
@@ class Model
     @classmethod
     def _check_default_pk(cls):
         if (
             cls._meta.pk.auto_created and
+            # Inherited PKs are checked in parents models.
+            not (
+                isinstance(cls._meta.pk, OneToOneField) and
+                cls._meta.pk.remote_field.parent_link
+            ) and
             not settings.is_overridden('DEFAULT_AUTO_FIELD') and
             not cls._meta.app_config._is_default_auto_field_overridden
         ):
`

const PREAMBLE = `You are adversarially reviewing a patch ALREADY APPLIED to the Django checkout at /testbed (Django 3.2 dev). Ticket #32388: models.W042 was falsely raised on multi-table-inheritance child models whose parent defines an explicit primary key.

The patch (in django/db/models/base.py::Model._check_default_pk):
${PATCH}

Four tests were added to tests/check_framework/test_model_checks.py::ModelDefaultAutoFieldTests: test_explicit_inherited_pk, test_explicit_inherited_parent_link, test_auto_created_inherited_pk, test_auto_created_inherited_parent_link.

Your job is to REFUTE this patch: find a real defect, crash, false negative, or regression. Default to "refuted=true" ONLY if you can demonstrate a concrete failure. You have Bash — WRITE AND RUN actual Python to prove or disprove each hypothesis. Use /opt/miniconda3/envs/testbed/bin/python (bare \`python\` lacks asgiref). Run Django tests with: cd /testbed/tests && /opt/miniconda3/envs/testbed/bin/python runtests.py <labels>

Do NOT modify django/ source or the tests — the tree is shared. Write scratch files only under /tmp/<your-lens-name>/ and clean them up.

YOUR LENS: `

const LENSES = [
  {
    key: 'crash-attrerror',
    prompt: `Crash safety. Can the new condition raise AttributeError, TypeError, or anything else for ANY model shape?

Concretely construct and run models where cls._meta.pk is: a plain AutoField (remote_field is None), a ForeignKey with primary_key=True, a OneToOneField with primary_key=True but parent_link=False, a OneToOneField to a model in another app, a proxy model's pk, a model with order_with_respect_to, a model whose pk is inherited through TWO levels of MTI (grandparent -> parent -> child), a model with multiple concrete parents (diamond / multiple MTI bases), and a swapped-out model.

Note Python's \`and\` short-circuits: does \`isinstance(...) and ....remote_field.parent_link\` ever evaluate remote_field when it's None? Prove it. Also check the evaluation ORDER of the whole boolean — is cls._meta.pk ever None at check time (e.g. abstract models, models still being constructed)?

Report every crash you actually reproduce, with the exact traceback.`,
  },
  {
    key: 'false-negative',
    prompt: `False negatives — cases where W042 SHOULD warn but now stays silent, meaning a real "you didn't pick a pk type" problem goes unreported.

Build and run these: (a) MTI child in app A whose parent is in app B, where app B sets default_auto_field but app A does not, and vice versa; (b) MTI child whose parent has an auto-created pk and lives in a THIRD-PARTY app the user cannot edit — is the warning still surfaced anywhere? (c) two-level MTI where only the middle model would warn; (d) a child that declares parent_link=True explicitly AND the parent has an auto-created pk.

For each: does the underlying actionable problem still get reported by SOME model's warning? Is any auto-created pk column now completely unreported across the whole project? That would be the real defect. Prove with runnable code that enumerates all W042 warnings.`,
  },
  {
    key: 'scope-proxy-abstract',
    prompt: `Scope correctness. The patch author explicitly declared proxy models OUT OF SCOPE (a proxy's pk is the concrete parent's AutoField, auto_created=True, remote_field None, so proxies still emit a duplicate W042).

Verify empirically: (1) Does a proxy of an auto-pk model emit a SECOND W042 today, both before and after the patch? (2) Is that a pre-existing behavior unchanged by this patch, or did the patch alter it? (3) Do abstract models get checked at all — trace and prove. (4) Does the patch change behavior for concrete children of ABSTRACT parents (both with and without an explicit pk on the abstract base)?

Then judge: is leaving proxies alone the RIGHT call for this ticket, or does it make the fix incoherent/half-done? Argue the strongest case that it is wrong, then say whether that case actually holds. Check what upstream Django does if you can find evidence in the repo (docs, release notes, tests).`,
  },
  {
    key: 'style-and-alternatives',
    prompt: `Implementation quality and alternatives.

(1) Is \`isinstance(cls._meta.pk, OneToOneField) and cls._meta.pk.remote_field.parent_link\` the idiom Django already uses elsewhere for "this field is a parent link"? grep django/ and compare — cite file:line.
(2) Would \`cls._meta.pk.remote_field and cls._meta.pk.remote_field.parent_link\`, or checking \`cls._meta.parents\`, or \`cls._meta.pk.auto_created and cls._meta.pk.model is not cls\`, be more robust or more readable? For EACH alternative, construct a model where it gives a DIFFERENT answer than the chosen condition, or prove none exists.
(3) Is the comment "Inherited PKs are checked in parents models." accurate and grammatical? Is it TRUE — are inherited PKs really always checked in the parent model? Find a counterexample (e.g. parent in an app that is not in INSTALLED_APPS, or a parent that is swapped out).
(4) Check flake8/isort compliance of the changed file: cd /testbed && /opt/miniconda3/envs/testbed/bin/python -m flake8 django/db/models/base.py tests/check_framework/test_model_checks.py`,
  },
  {
    key: 'test-quality',
    prompt: `Test quality. Read the four new tests in tests/check_framework/test_model_checks.py::ModelDefaultAutoFieldTests.

(1) Which of them actually FAIL without the patch? Prove it by stashing ONLY the base.py change (git stash push django/db/models/base.py), running, then \`git stash pop\`. Be careful to restore the tree exactly — verify with \`git diff --stat\` afterward.
(2) Are the tests isolated? Does isolate_apps correctly tear down the Parent/Child models so tests do not leak into each other? Try running the class in different orders / with --reverse.
(3) Is the assertion on test_auto_created_inherited_pk correct in asserting exactly ONE warning naming Parent?
(4) What test cases are MISSING that a reviewer would demand? Specifically consider: MTI child whose parent has an explicit non-Auto pk (e.g. UUIDField/CharField), multi-level MTI, and a child overriding with its own explicit pk. For each missing case, run it manually and report whether current behavior is correct.
(5) Run the whole check_framework suite and report the exact result line.`,
  },
]

phase('Refute')
const verdicts = await parallel(LENSES.map(l => () =>
  agent(PREAMBLE + l.prompt, {
    label: `refute:${l.key}`,
    phase: 'Refute',
    effort: 'high',
    schema: {
      type: 'object',
      properties: {
        refuted: { type: 'boolean', description: 'true only if you demonstrated a concrete real defect' },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit', 'info'] },
              claim: { type: 'string' },
              evidence: { type: 'string', description: 'the actual command run and its actual output' },
              suggested_fix: { type: 'string' },
            },
            required: ['severity', 'claim', 'evidence'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['refuted', 'confidence', 'findings', 'summary'],
    },
  })
))

const alive = verdicts.filter(Boolean)
log(`refuters returned: ${alive.length}/${LENSES.length}; refuted=${alive.filter(v => v.refuted).length}`)

phase('Judge')
const judged = await agent(
  `You are the final judge on a Django patch review. Five independent adversarial reviewers attacked the patch below, each from a different lens, each with shell access to /testbed.

PATCH:
${PATCH}

REVIEWER VERDICTS (JSON):
${JSON.stringify(alive.map((v, i) => ({ lens: LENSES[i]?.key, ...v })), null, 2)}

Your job:
1. Discard findings that are speculative, not backed by an actual command+output, or that describe PRE-EXISTING behavior the patch does not change.
2. For each SURVIVING finding, state severity and whether it BLOCKS shipping this patch as the fix for ticket #32388.
3. Give a final verdict: SHIP / SHIP-WITH-CHANGES / DO-NOT-SHIP. If SHIP-WITH-CHANGES, give the exact additional diff or test needed, verbatim.
4. Explicitly state whether the "proxy models still warn" issue should block this patch.
5. Note anything the reviewers MISSED.

Be decisive and concrete. You may use Bash on /testbed to spot-check any claim you doubt — do not modify django/ or tests/.`,
  { label: 'judge', phase: 'Judge', effort: 'high' }
)

return judged
