export const meta = {
  name: 'get-foo-display-override',
  description: 'Diagnose and validate the fix for overriding get_FOO_display() regressed in Django 2.2',
  phases: [
    { title: 'Investigate', detail: 'root cause, fix-variant semantics, existing test/doc impact' },
    { title: 'Verify', detail: 'adversarially check each investigation conclusion' },
  ],
}

const ROOT = '/testbed'

const LENSES = [
  {
    key: 'root-cause',
    prompt: `You are inspecting the Django source at ${ROOT} (a git checkout at the 3.0 dev stage).

TASK: Establish the precise root cause of this regression: a user-defined \`get_foo_bar_display()\` method in a model class body is ignored in Django 2.2+, but honoured in Django 2.1.

Do this by reading:
- django/db/models/fields/__init__.py (Field.contribute_to_class, around line 749-767)
- django/db/models/base.py (ModelBase.__new__, especially how attrs are split into contributable_attrs vs new_attrs, and add_to_class)
- git log/git show for the commit that introduced the contributable_attrs split (search: \`git log -S contributable_attrs --oneline -- django/db/models/base.py\` then \`git show <sha>\`)

Explain the exact ordering difference between 2.1 and 2.2 that causes the field-generated partialmethod to win over the user's method. Cite file:line.

Return JSON per schema. Be concrete about the mechanism (who setattrs what, in what order).`,
  },
  {
    key: 'fix-variants',
    prompt: `You are inspecting the Django source at ${ROOT}.

TASK: Compare two candidate fixes to Field.contribute_to_class in django/db/models/fields/__init__.py (currently lines ~765-767):

(A) guard with \`if not hasattr(cls, 'get_%s_display' % self.name):\`
(B) guard with \`if 'get_%s_display' % self.name not in cls.__dict__:\`

Analyse the behavioural difference for these scenarios, reading django/db/models/base.py to be exact about when contribute_to_class runs for inherited fields:
1. Method defined in the same class body as the field (the reported bug).
2. Abstract base declares field with choices; concrete child re-declares the SAME field name with EXTENDED choices. What does child.get_foo_display() return for the child-only choice under (A) vs (B)? (Which field instance is the inherited partialmethod bound to?)
3. Abstract base defines a custom get_foo_display() method; child inherits and does NOT redefine it. Which variant preserves the base's method?
4. Multi-table inheritance child (field not re-contributed) and proxy models.

Verify claims empirically where you can: you may run python snippets with the local Django, e.g. write a tiny script that configures settings (django.conf.settings.configure(INSTALLED_APPS=['django.contrib.contenttypes','django.contrib.auth'], DATABASES={}) then django.setup()) and defines models with an explicit app_label in Meta, patching the guard in-place to test each variant (use \`git stash\`/restore or edit-and-revert carefully; leave the working tree CLEAN and unmodified when you finish — verify with \`git -C ${ROOT} status --porcelain\`).

Recommend which variant to ship and why. Return JSON per schema.`,
  },
  {
    key: 'test-doc-impact',
    prompt: `You are inspecting the Django source at ${ROOT}.

TASK: Find everything in the existing test suite and docs that could be affected by making Field.contribute_to_class skip setting get_FOO_display when the model class already defines that attribute.

- grep the tests/ tree for get_FOO_display usage patterns: \`get_.*_display\`, \`_get_FIELD_display\`, and any test that DEFINES its own get_<field>_display method on a model (tests/model_fields/, tests/model_inheritance/, tests/model_forms/, tests/admin_*/, tests/serializers/, tests/basic/).
- Identify any existing test that would BREAK under either guard variant (esp. tests where an abstract base or parent declares choices and a child re-declares the field, or where a model defines its own get_*_display).
- Locate the docs section documenting get_FOO_display (docs/ref/models/instances.txt and/or docs/topics/db/models.txt, docs/releases/*) and report whether a docs/release-note change is warranted, with file:line.
- Report which specific test modules should be run to validate the fix (as runnable \`./tests/runtests.py <labels>\` invocations).

Do NOT modify any file. Return JSON per schema.`,
  },
]

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    summary: { type: 'string', description: 'Bottom line in 1-3 sentences' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'file:line or command output that supports it' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['claim', 'evidence', 'confidence'],
      },
    },
    recommendation: { type: 'string' },
  },
  required: ['lens', 'summary', 'claims', 'recommendation'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    correction: { type: 'string', description: 'If refuted, the corrected statement; else empty' },
  },
  required: ['refuted', 'reasoning', 'correction'],
}

phase('Investigate')

const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `investigate:${l.key}`, phase: 'Investigate', schema: FINDING_SCHEMA }),
  (finding, lens) => {
    if (!finding) return null
    const toCheck = (finding.claims || []).filter(c => c.confidence !== 'high').concat(
      (finding.claims || []).filter(c => c.confidence === 'high').slice(0, 3)
    )
    return parallel(toCheck.map(c => () =>
      agent(`You are a skeptical reviewer of Django internals at ${ROOT}.

A prior agent (lens: ${lens.key}) claims:
  CLAIM: ${c.claim}
  EVIDENCE OFFERED: ${c.evidence}

Try hard to REFUTE this claim by reading the actual source (django/db/models/fields/__init__.py, django/db/models/base.py) and, where useful, running a real python experiment with the local Django. Leave the working tree clean (\`git -C ${ROOT} status --porcelain\` must be empty when you finish).

Default to refuted=true if the claim is materially wrong, overstated, or unverifiable. Return JSON per schema.`,
        { label: `refute:${lens.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then(v => ({ lens: lens.key, claim: c.claim, verdict: v }))
    )).then(verdicts => ({ finding, verdicts: verdicts.filter(Boolean) }))
  }
)

const clean = results.filter(Boolean)
return {
  findings: clean.map(r => r.finding),
  refuted: clean.flatMap(r => r.verdicts).filter(v => v.verdict?.refuted),
}
