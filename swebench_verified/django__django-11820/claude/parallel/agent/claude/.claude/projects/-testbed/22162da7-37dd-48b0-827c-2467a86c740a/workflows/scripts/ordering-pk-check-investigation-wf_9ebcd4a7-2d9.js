export const meta = {
  name: 'ordering-pk-check-investigation',
  description: 'Investigate models.E015 false positive for related-field __pk in Meta.ordering and design the fix',
  phases: [
    { title: 'Investigate', detail: 'parallel probes: check logic, query-time semantics, tests/docs surface' },
    { title: 'Design', detail: 'independent fix proposals' },
    { title: 'Judge', detail: 'score proposals against correctness/minimality/upstream style' },
  ],
}

const ENV = `Repo: /testbed (Django 3.1 dev checkout, git branch main).
Python interpreter WITH django importable: /opt/miniconda3/envs/testbed/bin/python (python3.6).
Run the model-check test suite with: cd /testbed && /opt/miniconda3/envs/testbed/bin/python tests/runtests.py invalid_models_tests --parallel 1
Write scratch repro scripts under /tmp only. DO NOT modify any file under /testbed — this is an investigation-only task.
The bug: django/db/models/base.py Model._check_ordering() raises models.E015 for Meta.ordering entries like 'option__pk' (pk of a related model), because opts.get_field('pk') raises FieldDoesNotExist ('pk' is an alias, not a real field). Regression from commit 440505cb2cadbe1a5b9fba246bcde6c04f51d07e which added related-field/lookup validation.`

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string', description: 'Dense prose summary of what you established, with file:line refs' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'evidence'],
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'file:line, code snippet, or command output that proves it' },
        },
      },
    },
    ordering_cases: {
      type: 'array',
      description: 'Concrete Meta.ordering strings you actually executed, with observed check result and observed runtime (queryset) result',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ordering', 'check_result', 'should_be_valid'],
        properties: {
          ordering: { type: 'string' },
          model_shape: { type: 'string' },
          check_result: { type: 'string', description: 'E015 raised or clean, as observed today' },
          runtime_result: { type: 'string', description: 'What queryset.order_by()/query compilation does with this name, if tested' },
          should_be_valid: { type: 'boolean' },
        },
      },
    },
  },
}

phase('Investigate')

const PROBES = [
  {
    key: 'check-logic',
    prompt: `${ENV}

Read django/db/models/base.py Model._check_ordering() in full (around line 1659-1751). Fully characterize the related-field validation loop.

Then EMPIRICALLY probe, with small scripts run under the testbed interpreter (use django.conf.settings.configure + django.setup() + django.test.utils.isolate_apps('django.contrib.auth') with app_label='auth' on your models — that pattern works, verified), every ordering-string shape involving 'pk' and lookups. At minimum:
  - 'option__pk' (FK to a model, ordering on its pk) -> currently E015 (the reported bug)
  - '-option__pk'
  - 'pk' alone (no LOOKUP_SEP)
  - 'option__pk__lower' / 'option__pk__isnull' style transforms/lookups on a pk
  - 'option__option2__pk' (two levels)
  - 'pk__lower' style (pk as FIRST part of a multi-part name)
  - MTI: ordering on a child model referring to 'parent_ptr__pk' or parent's pk; and a model whose pk IS a OneToOneField/parent link, ordering '<fk>__pk' where the target's pk is itself a relation
  - a OneToOneField(primary_key=True) target: '<fk>__pk' where pk is a relation -> does _cls advance correctly?
  - reverse relation: '<related_name>__pk'
  - GenericForeignKey / GenericRelation with '__pk'
  - non-relational field followed by 'pk', e.g. an IntegerField named 'test': 'test__pk' -> SHOULD this be an error? (state what happens today and what is correct)
  - a nonexistent relation: 'missing_related__pk' -> must still be E015
Report the exact current behavior for each in ordering_cases, and say for each whether it SHOULD be valid (i.e. whether Django can actually order by it at query time). Note precisely which line of the loop causes each false positive and why (which exception, what fld is at that moment, what get_transform returns).`,
  },
  {
    key: 'runtime-semantics',
    prompt: `${ENV}

Determine the GROUND TRUTH for which Meta.ordering names Django can actually resolve at query time, so the static check can be made to agree with the ORM instead of guessing. Read and cite:
  - django/db/models/sql/query.py: names_to_path(), add_ordering(), solve_lookup_type(), try_transform()
  - django/db/models/sql/compiler.py: get_order_by() / find_ordering_name()
  - django/db/models/options.py: Options.pk, get_field(), how 'pk' is special-cased
  - django/db/models/query.py: order_by()
Answer concretely:
  1. How does the ORM resolve the trailing 'pk' in .order_by('option__pk')? Which code maps 'pk' -> the concrete pk field? Cite the line.
  2. Does names_to_path accept 'pk' at any position in a path, or only as the final component, or also as an intermediate component (e.g. 'a__pk__b' where the pk is itself a FK)?
  3. Are transforms/lookups after a pk valid at ordering time (e.g. order_by('option__pk__lower'))?
  4. When the ORM follows a relation, what does it use to get the next model — compare with the check's fld.get_path_info()[-1].to_opts.model.
  5. Is there any name the ORM accepts in order_by that _check_ordering would currently reject, besides the __pk case? Prove or disprove with executed queries (use a real sqlite connection: settings with DATABASES sqlite3 :memory:, define models in a test app, then str(Model.objects.order_by(name).query) and report success/exception).
Report every executed name in ordering_cases with the runtime result.`,
  },
  {
    key: 'tests-docs',
    prompt: `${ENV}

Map the test and documentation surface that a fix must satisfy or update.
  - Read tests/invalid_models_tests/test_models.py, the whole OtherModelTests ordering test block (roughly lines 630-900). List EVERY existing ordering test by name with a one-line note on what it asserts, and the exact wording/format of the expected E015 message and how tests are written (isolate_apps decorator usage, model naming, assertEqual(Model.check(), [...]) style, use of register_lookup).
  - Identify where a new regression test for "ordering refers to related field's pk" belongs, i.e. after which existing test method, and the exact model shape/naming convention the neighbouring tests use.
  - grep the whole repo for other places that validate or document Meta.ordering: docs/ref/checks.txt E015 wording, docs/ref/models/options.txt, django/contrib/admin/checks.py (does admin ordering validation have the same __pk handling? cite it), any other _check_ordering-like code.
  - Run the current suite: cd /testbed && /opt/miniconda3/envs/testbed/bin/python tests/runtests.py invalid_models_tests --parallel 1 and report pass/fail counts as the pre-fix baseline. Also run: model_options model_meta ordering admin_checks --parallel 1 and report the baseline.
Be exhaustive and quote exact strings — the implementer will copy your wording.`,
  },
]

const probes = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Investigate', schema: PROBE_SCHEMA })
))

const probeText = PROBES.map((p, i) => {
  const r = probes[i]
  if (!r) return `## ${p.key}\n(probe failed)`
  return `## ${p.key}\n${r.summary}\n\nFindings:\n${(r.findings || []).map(f => `- ${f.claim}\n  evidence: ${f.evidence}`).join('\n')}\n\nCases:\n${(r.ordering_cases || []).map(c => `- ordering=${c.ordering} shape=${c.model_shape || '?'} check=${c.check_result} runtime=${c.runtime_result || 'n/t'} should_be_valid=${c.should_be_valid}`).join('\n')}`
}).join('\n\n')

phase('Design')

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approach_name', 'diff', 'rationale', 'cases_fixed', 'risks', 'tests_to_add'],
  properties: {
    approach_name: { type: 'string' },
    diff: { type: 'string', description: 'Exact replacement code for the affected block of _check_ordering, as it should read after the fix' },
    rationale: { type: 'string' },
    cases_fixed: { type: 'array', items: { type: 'string' } },
    cases_still_broken: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    tests_to_add: { type: 'string', description: 'Exact test method source to add to tests/invalid_models_tests/test_models.py, matching neighbouring style' },
    docs_changes: { type: 'string' },
  },
}

const ANGLES = [
  { key: 'minimal', slant: 'MINIMAL/UPSTREAM-STYLE: the smallest change that a Django core reviewer would merge for this ticket. Special-case the pk alias where the check walks the path. Do not fix unrelated tickets. Prefer clarity and a short comment explaining why pk needs special handling.' },
  { key: 'correctness', slant: 'MAXIMUM CORRECTNESS: make the static check agree with what the ORM actually accepts, using the runtime-semantics findings. Consider whether the loop must also stop advancing _cls after a non-relational field, and whether lookups (get_lookup) as well as transforms should be accepted. Be explicit about which extra cases you fix beyond the ticket and whether that is in scope.' },
  { key: 'reuse', slant: 'REUSE-FIRST: is there an existing helper in django/db/models (options.py, sql/query.py, or admin checks) that already resolves a dotted ordering path including the pk alias, that _check_ordering should call instead of hand-walking the path? If a clean reuse exists, propose it and show the code; if not, say so plainly and fall back to the minimal special-case.' },
]

const designs = await parallel(ANGLES.map(a => () =>
  agent(`${ENV}

Investigation results from three parallel probes — treat as established fact, but re-verify anything you rely on by reading the code yourself:

${probeText}

Your task: propose a fix for django/db/models/base.py Model._check_ordering() so that Meta.ordering entries referring to a related field's pk (e.g. 'option__pk') do not raise models.E015, while genuinely invalid names still do.

Your angle: ${a.slant}

Requirements:
- Give the exact post-fix source of the affected block (the "# Check related fields." loop and anything else you change), matching the file's existing style and comment density.
- Empirically validate your proposal: apply it to a COPY of base.py in /tmp, or apply-then-revert in place with git checkout, run the repro cases AND cd /testbed && /opt/miniconda3/envs/testbed/bin/python tests/runtests.py invalid_models_tests --parallel 1. Report actual observed results. LEAVE /testbed CLEAN when you finish (git status must show no modifications; verify it).
- Give the exact new test method(s) to add, in the neighbouring tests' style.
- List cases you do NOT fix and why.`,
    { label: `design:${a.key}`, phase: 'Design', schema: DESIGN_SCHEMA })
))

phase('Judge')

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ranking', 'recommended_diff', 'recommended_tests', 'reasoning', 'must_fix_before_merge'],
  properties: {
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['approach_name', 'score', 'verdict'],
        properties: {
          approach_name: { type: 'string' },
          score: { type: 'number' },
          verdict: { type: 'string' },
        },
      },
    },
    recommended_diff: { type: 'string', description: 'The exact code to land, grafting the best of the runners-up' },
    recommended_tests: { type: 'string', description: 'Exact test source to land' },
    docs_changes: { type: 'string' },
    reasoning: { type: 'string' },
    must_fix_before_merge: { type: 'array', items: { type: 'string' } },
    out_of_scope: { type: 'array', items: { type: 'string' } },
  },
}

const designText = designs.filter(Boolean).map(d => `### ${d.approach_name}
rationale: ${d.rationale}
code:
${d.diff}
cases_fixed: ${(d.cases_fixed || []).join('; ')}
cases_still_broken: ${(d.cases_still_broken || []).join('; ')}
risks: ${(d.risks || []).join('; ')}
tests:
${d.tests_to_add}
docs: ${d.docs_changes || 'none'}`).join('\n\n')

const LENSES = [
  'CORRECTNESS: does the recommended code actually fix option__pk and keep rejecting truly-invalid names? Verify by applying each candidate to a /tmp copy and running it. Reject any candidate that silences legitimate errors (e.g. makes missing_related__pk pass, or makes any existing invalid_models_tests ordering test fail).',
  'SCOPE & STYLE: which candidate reads like the surrounding Django code and is the right size for this bug report? Penalize scope creep into unrelated tickets, and penalize under-fixing if a case is obviously the same bug.',
  'REGRESSION RISK: what could this break elsewhere — MTI, proxy models, GenericForeignKey, reverse relations, JSONField transforms, admin ordering checks, third-party fields whose get_path_info differs? Actually run the broader suites for the top candidate.',
]

const votes = await parallel(LENSES.map((lens, i) => () =>
  agent(`${ENV}

Candidate fixes for the models.E015 __pk false positive:

${designText}

Investigation context:
${probeText}

Judge these candidates through this lens ONLY: ${lens}

Score each 0-10 on your lens. Then produce the single best code to land, grafting good ideas across candidates. Validate empirically (apply to a /tmp copy of base.py, or apply and git-checkout-revert; leave /testbed CLEAN and verify with git status). Report real command output, not predictions.`,
    { label: `judge:${i}`, phase: 'Judge', schema: JUDGE_SCHEMA })
))

return {
  probes: PROBES.map((p, i) => ({ key: p.key, result: probes[i] })),
  designs: designs.filter(Boolean),
  judges: votes.filter(Boolean),
}
