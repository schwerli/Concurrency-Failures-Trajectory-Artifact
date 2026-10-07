export const meta = {
  name: 'formsets-none-index-audit',
  description: 'Audit the add_fields(index=None) fix in django/forms/formsets.py for correctness and completeness',
  phases: [
    { title: 'Sweep', detail: 'parallel lenses over index=None flows, docs, related code' },
    { title: 'Verify', detail: 'adversarially verify each finding' },
    { title: 'Synthesize', detail: 'merge into a single actionable report' },
  ],
}

const REPO = '/testbed'
const FIX = `In ${REPO}/django/forms/formsets.py, BaseFormSet.add_fields() line ~493 was changed from:
    if self.can_delete and (self.can_delete_extra or index < initial_form_count):
to:
    if self.can_delete and (
        self.can_delete_extra or (index is not None and index < initial_form_count)
    ):
This fixes "TypeError: '<' not supported between instances of 'NoneType' and 'int'" when
BaseFormSet.empty_form is accessed on a formset with can_delete=True, can_delete_extra=False
(empty_form calls self.add_fields(form, None)).
Django ticket #34350.`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          detail: { type: 'string', description: 'what is wrong or missing, with concrete evidence' },
          severity: { type: 'string', enum: ['blocker', 'important', 'nit'] },
        },
        required: ['title', 'file', 'detail', 'severity'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true only if you confirmed the issue by reading the code' },
    reasoning: { type: 'string' },
    recommendation: { type: 'string', description: 'concrete action, or "none"' },
  },
  required: ['real', 'reasoning', 'recommendation'],
}

const LENSES = [
  {
    key: 'semantics',
    prompt: `${FIX}

LENS: Semantic correctness of the chosen behavior. When index is None (the empty_form / __prefix__ template form),
should the DELETE field be added or not? Read BaseFormSet.empty_form, add_fields, _should_delete_form,
deleted_forms, initial_form_count, and the management-form machinery in ${REPO}/django/forms/formsets.py.
Reason about what a JS "add another" widget does: it clones empty_form's HTML into a new EXTRA form.
So does an extra form get DELETE when can_delete_extra=False? Does empty_form's field set now match what
extra forms get? Is skipping DELETE for index=None the behavior that keeps empty_form consistent with the
forms it is a template for? Also check whether the parallel can_order branch (which already guards
index is not None) treats index=None the same way, and whether the two branches are now consistent.
Flag any inconsistency or any case where the new behavior would be surprising.`,
  },
  {
    key: 'other-none-comparisons',
    prompt: `${FIX}

LENS: Other places that could hit the same index=None TypeError or an equivalent crash.
Search ${REPO}/django/forms/formsets.py, ${REPO}/django/forms/models.py (BaseModelFormSet.add_fields,
BaseInlineFormSet.add_fields), ${REPO}/django/contrib/admin/ (helpers.py, options.py, inlines templates),
${REPO}/django/contrib/contenttypes/forms.py, and ${REPO}/django/forms/ generally for any use of an
\`index\` variable that may be None being compared with <, <=, >, >=, used in arithmetic, or used as a
sequence subscript. Verify each candidate by tracing whether index=None can actually reach it
(who calls add_fields / get_form_kwargs with None?). Report only reachable crashes or genuinely
missing None-guards. Do NOT report the already-fixed line.`,
  },
  {
    key: 'docs',
    prompt: `${FIX}

LENS: Documentation and release notes. Check ${REPO}/docs/ for anything that documents can_delete_extra,
empty_form, or add_fields(form, index) and whether it (a) is now inaccurate, (b) should mention that
index is None for empty_form. Look at docs/topics/forms/formsets.txt, docs/ref/forms/, and the
docs/releases/ directory. Determine the current in-development Django version from ${REPO}/django/__init__.py
and check whether a bugfix release-notes file exists that convention would require an entry in
(inspect a few recent bugfix commits with \`git log\` in ${REPO} to see whether Django adds release-notes
entries for this class of bugfix, and whether the docs describe add_fields' index argument).
Be concrete: cite file paths and line numbers, and state whether an edit is actually warranted.`,
  },
  {
    key: 'tests',
    prompt: `${FIX}

LENS: Test coverage. Find every existing test touching can_delete_extra or empty_form:
grep ${REPO}/tests/forms_tests/tests/test_formsets.py, ${REPO}/tests/model_formsets/tests.py,
${REPO}/tests/generic_relations/test_forms.py, ${REPO}/tests/admin_inlines/, ${REPO}/tests/model_formsets_regress/.
Report: (1) which existing tests would have caught this bug (answer: probably none — verify),
(2) exactly where a regression test belongs and what it should assert, following the surrounding
test style precisely (test method names, use of formset_factory/modelformset_factory/inlineformset_factory),
(3) whether the can_delete_extra=True + empty_form case also needs an assertion,
(4) whether any EXISTING test asserts behavior that the fix changes (i.e. a test that would now break).
Give exact file paths, line numbers of insertion points, and the surrounding naming convention.`,
  },
  {
    key: 'regressions',
    prompt: `${FIX}

LENS: Regression risk. Who else calls add_fields, and with what index values?
grep the whole ${REPO}/django tree and ${REPO}/tests tree for add_fields callers and for empty_form usages
(including templates like admin's inline JS/stacked/tabular templates and django/forms/jinja2 + templates
formset templates). Ask: does any code path depend on empty_form containing a DELETE field even when
can_delete_extra is False? For example, does admin's inline JS or the formset rendering templates
iterate empty_form.fields, or reference DELETE explicitly? Does the change break admin inlines when
can_delete_extra=False? Trace concretely and report only real breakage with evidence.`,
  },
]

phase('Sweep')
const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `sweep:${l.key}`, phase: 'Sweep', schema: FINDINGS }),
  (res, lens) => {
    const fs = (res && res.findings) || []
    if (!fs.length) return []
    return parallel(fs.map(f => () =>
      parallel([
        `Read the actual code and try to REFUTE this claim. Default to real=false unless the code plainly confirms it.`,
        `Judge whether acting on this claim is in scope for a minimal, upstream-style bugfix for Django ticket #34350, or scope creep. real=false if it is scope creep or speculative.`,
      ].map(lensPrompt => () => agent(
        `${FIX}\n\nCLAIM from a reviewer (lens=${lens.key}):\ntitle: ${f.title}\nfile: ${f.file}${f.line ? ':' + f.line : ''}\nseverity: ${f.severity}\ndetail: ${f.detail}\n\n${lensPrompt}\nRepo root is ${REPO}. Read the real files before answering.`,
        { label: `verify:${lens.key}:${f.title.slice(0, 30)}`, phase: 'Verify', schema: VERDICT }
      )))
      .then(votes => {
        const v = votes.filter(Boolean)
        return { ...f, lens: lens.key, votes: v, survives: v.length > 0 && v.every(x => x.real) }
      })
    ))
  }
)

const all = results.flat().filter(Boolean)
const survivors = all.filter(f => f.survives)
log(`${all.length} raw findings, ${survivors.length} survived adversarial verification`)

phase('Synthesize')
const report = await agent(
  `${FIX}\n\nHere are reviewer findings that survived adversarial verification (each was confirmed by an independent refuter AND a scope judge):\n${JSON.stringify(survivors, null, 2)}\n\nAnd here are findings that were REFUTED (for context on what was already considered and dismissed — do not resurrect them unless the refutation is plainly wrong):\n${JSON.stringify(all.filter(f => !f.survives).map(f => ({ title: f.title, file: f.file, why_refuted: f.votes.map(v => v.reasoning) })), null, 2)}\n\nProduce a tight, actionable report for the engineer who made the fix:\n1. VERDICT: is the one-line fix correct and sufficient as-is? (yes/no + one sentence)\n2. REQUIRED actions, if any — with exact file:line and exact code/text to add.\n3. OPTIONAL/nice-to-have, clearly separated.\n4. Anything that must NOT be done (scope creep to avoid).\nBe concrete and brief. Repo root ${REPO}; read files as needed to make your recommendations exact.`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return { rawCount: all.length, survivorCount: survivors.length, survivors, report }
