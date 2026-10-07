export const meta = {
  name: 'fix-nested-prefetch-deferred-fields',
  description: 'Investigate, implement, and adversarially verify a fix for Django nested-prefetch clobbering deferred fields',
  phases: [
    { title: 'Investigate', detail: 'variants, fix points, at-risk tests' },
    { title: 'Implement', detail: 'candidate fixes in isolated worktrees, each test-run' },
    { title: 'Judge', detail: 'score candidates on correctness and minimality' },
    { title: 'Critic', detail: 'completeness check on the winning approach' },
  ],
}

const GROUND_TRUTH = `
# Repo / environment
- Django source checkout at /testbed (version 4.1a0, git repo, branch main, clean at start).
- ALWAYS run \`source activate testbed\` before any python command (conda env; otherwise \`import django\` fails).
- Test runner: \`cd <repo> && source activate testbed && python tests/runtests.py <suite> [--parallel=4]\`.
- No network access. Do not try to fetch the upstream Django commit; derive the fix from the code.

# The bug (Django ticket: "Deferred fields incorrect when following prefetches back to the parent object")
Models:
    class User(models.Model):
        email = models.EmailField()
        kind = models.CharField(max_length=10, choices=[("ADMIN","Admin"),("REGULAR","Regular")])
    class Profile(models.Model):
        full_name = models.CharField(max_length=255)
        user = models.OneToOneField(User, on_delete=models.CASCADE)

    queryset = User.objects.only("email").prefetch_related(
        Prefetch("profile", queryset=Profile.objects.prefetch_related(
            Prefetch("user", queryset=User.objects.only("kind"))
        ))
    )
    user = queryset.first()                    # 3 queries -- correct today
    user.profile.user.kind                     # EXPECTED 0 queries, ACTUALLY 1 query -- THE BUG

# Root cause (already verified empirically -- do not re-derive, build on it)
\`ReverseOneToOneDescriptor.get_prefetch_queryset()\` at
/testbed/django/db/models/fields/related_descriptors.py:365-381 ends with:

        # Since we're going to assign directly in the cache,
        # we must manage the reverse relation cache manually.
        for rel_obj in queryset:
            instance = instances_dict[rel_obj_attr(rel_obj)]
            self.related.field.set_cached_value(rel_obj, instance)

The \`for rel_obj in queryset\` line EVALUATES a queryset that still carries its own
\`_prefetch_related_lookups\` (the nested \`Prefetch("user", queryset=User.objects.only("kind"))\`).
That triggers the nested prefetch immediately (verified by tracing: "prefetch_one_level:
lookup=user level=0" fires from inside get_prefetch_queryset), which correctly caches the
\`only("kind")\` User on each Profile. The very next statement then OVERWRITES that cache with
the outer parent instance (which has \`kind\` deferred, because the outer qs is \`.only("email")\`).

Afterwards, \`prefetch_one_level\` in /testbed/django/db/models/query.py:1869+ copies
\`rel_qs._prefetch_related_lookups\` into \`additional_lookups\` and clears them; the outer
machinery then processes the \`profile__user\` lookup, but \`prefetch_related_objects\`
(query.py ~line 1764) computes \`obj_to_fetch = [obj for obj in obj_list if not is_fetched(obj)]\`
and \`is_fetched\` is \`ForwardManyToOneDescriptor.is_cached\`, which is now True -- so the
lookup is skipped and the clobbered parent instance survives.
Net effect: \`user.profile.user is user\` -> True, and \`.kind\` is deferred on it.

Three sites perform this same unconditional overwrite:
1. \`ForwardManyToOneDescriptor.get_prefetch_queryset\` -- related_descriptors.py:143-148
   (inside \`if not remote_field.multiple:\`, uses \`remote_field.set_cached_value\`)
2. \`ReverseOneToOneDescriptor.get_prefetch_queryset\` -- related_descriptors.py:377-381
   (uses \`self.related.field.set_cached_value\`)
3. \`create_reverse_many_to_one_manager(...).get_prefetch_queryset\` -- related_descriptors.py:645-649
   (uses \`setattr(rel_obj, self.field.name, instance)\`, i.e. goes through the descriptor __set__)
The ticket reports the reverse-FK variant fails too: \`user.profile_set.all()[0].user.kind\` queries.

# Reusable repro harness already on disk
- /tmp/reproapp/{__init__.py,models.py} -- a standalone app with the User/Profile models above.
- /tmp/repro.py -- prints query counts, \`is\` identity, and \`get_deferred_fields()\`.
  Run: \`source activate testbed && python /tmp/repro.py\`
  Current output: 3 outer queries; "inner is outer? True"; deferred {'kind'}; 1 query on access.
You may copy/extend these. NOTE: if you work in a git worktree, /tmp/repro.py imports whatever
Django is on sys.path -- run it with \`PYTHONPATH=<your-worktree>\` and verify with
\`python -c "import django; print(django.__file__)"\` that you are testing YOUR copy.
`

const INVESTIGATION_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'string', description: 'Detailed prose findings with file:line references and observed command output' },
    key_facts: { type: 'array', items: { type: 'string' }, description: 'Crisp, individually checkable facts' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Things a fix could break' },
  },
  required: ['findings', 'key_facts', 'risks'],
}

phase('Investigate')

const investigations = await parallel([
  () => agent(`${GROUND_TRUTH}

TASK A -- Map every affected relation kind and characterize actual behavior at HEAD.

For EACH of these relation shapes, write a standalone repro (extend /tmp/reproapp style with your
own app dir under /tmp/<uniquename>/ so you do not collide with other agents) and report the
observed query counts and whether the nested "back to parent" prefetch is clobbered:
 1. reverse OneToOne (\`Prefetch("profile", queryset=Profile.objects.prefetch_related(Prefetch("user", queryset=User.objects.only("kind"))))\`) -- the ticket's case
 2. reverse ForeignKey (\`profile_set\`) -- ticket says also broken; CONFIRM or REFUTE with output
 3. forward ForeignKey / forward OneToOne as the OUTER prefetch (e.g. \`Profile.objects.only("full_name").prefetch_related(Prefetch("user", queryset=User.objects.prefetch_related(Prefetch("profile", queryset=Profile.objects.only("full_name")))))\`)
 4. ManyToMany with a nested prefetch back to the parent
 5. GenericForeignKey and GenericRelation (django/contrib/contenttypes/fields.py) -- do their
    get_prefetch_queryset implementations do the same manual reverse-cache assignment? Are they affected?
 6. The same nesting but WITHOUT \`.only()\`/\`.defer()\` anywhere -- is the object identity still
    silently replaced/clobbered? (i.e. is this bug only observable via deferred fields, or is the
    wrong instance always used?)

Also answer: with \`to_attr\` used on the inner Prefetch, does the bug still occur?

Report exact commands run and exact output. Be precise about query COUNTS -- a candidate fix will
be judged on keeping the ticket's case at 3 queries during iteration and 0 on attribute access.`,
    { label: 'variants', phase: 'Investigate', schema: INVESTIGATION_SCHEMA }),

  () => agent(`${GROUND_TRUTH}

TASK B -- Enumerate and evaluate candidate fix points in the prefetch machinery.

Read /testbed/django/db/models/query.py (\`prefetch_related_objects\`, \`get_prefetcher\`,
\`prefetch_one_level\`, \`Prefetch\`, \`normalize_prefetch_lookups\`) and
/testbed/django/db/models/fields/related_descriptors.py closely.

Enumerate every plausible fix point, and for each give the concrete code change plus its
consequences for (a) correctness, (b) query count, (c) blast radius. At minimum evaluate:
  F1. Guard the three overwrite sites with \`if not <field>.is_cached(rel_obj)\` so a value already
      populated by the nested prefetch is preserved.
  F2. Strip \`_prefetch_related_lookups\` from the queryset BEFORE the descriptor iterates it (so the
      nested prefetch does not run early inside get_prefetch_queryset), and then make the outer
      machinery actually perform the descendant lookup instead of skipping it via \`is_fetched\`.
      Work out exactly where that stripping would have to happen and whether the resulting query
      count stays at 3.
  F3. Change \`is_fetched\`/\`obj_to_fetch\` in \`prefetch_related_objects\` so an explicit
      \`Prefetch(..., queryset=...)\` is never skipped just because a cache entry exists. Determine
      the resulting query count (does the nested prefetch then run TWICE -> 4 queries?).
  F4. Anything better you can think of, including making \`prefetch_one_level\`'s own assignment loop
      authoritative, or deferring the manual reverse-cache assignment out of the descriptors into
      \`prefetch_one_level\`.

Critical question to answer definitively, with evidence: is the early evaluation of the queryset
inside \`get_prefetch_queryset\` (the \`for rel_obj in queryset\` loop) LOAD-BEARING? i.e. if the
nested lookups were stripped first, would anything else break? And is \`all_related_objects =
list(rel_qs)\` in prefetch_one_level relying on the result cache already being filled?

Also: which of \`set_cached_value\` vs \`setattr(rel_obj, field.name, instance)\` has side effects
(look at \`ForwardManyToOneDescriptor.__set__\`) and does that matter for the reverse-m2o site?

Do NOT edit any files. Report analysis only.`,
    { label: 'fix-points', phase: 'Investigate', schema: INVESTIGATION_SCHEMA }),

  () => agent(`${GROUND_TRUTH}

TASK C -- Find every existing test that could regress, and decide where the new regression test belongs.

1. Search the Django test suite for tests that depend on the CURRENT clobbering behavior, i.e. that
   assert the "back reference" after a prefetch is the SAME instance as the parent
   (\`assertIs\`, \`self.assertEqual(obj.rel.back, obj)\`, \`assertNumQueries(0)\` after traversing back
   to a parent). Grep for things like \`known_related_objects\`, \`set_cached_value\`,
   \`_state.fields_cache\`, \`assertNumQueries\` in combination with prefetch tests.
   Look hard at: tests/prefetch_related/, tests/known_related_objects/, tests/defer/,
   tests/defer_regress/, tests/select_related_onetoone/, tests/many_to_one/, tests/one_to_one/,
   tests/generic_relations/, tests/contenttypes_tests/, tests/queries/, tests/foreign_object/,
   tests/custom_managers/, tests/serializers/, tests/admin_changelist/.
   For each at-risk test give file:line, what it asserts, and WHY it might break under fix F1
   ("skip set_cached_value when already cached").
2. Specifically: does any existing test combine a nested Prefetch with \`select_related()\` on the
   inner queryset such that the inner object is already cached before the descriptor's loop runs?
   (That is the case where fix F1 changes which instance wins even with no defer involved.)
3. Determine the right home for the ticket's regression test: which test package, which existing
   models can express User/Profile-with-only() (do NOT assume you must add models -- check
   tests/prefetch_related/models.py for an existing OneToOne + FK pair, e.g. look for
   Author/AuthorAddress/Book/BookWithYear/House/Room/Person etc.), and which existing TestCase class
   it should join. Quote the candidate models and give a concrete draft test that follows the
   surrounding style.
4. Report the baseline pass/fail of the suites you consider at risk (run them).

Do NOT edit any files under /testbed/django. You may run tests.`,
    { label: 'at-risk-tests', phase: 'Investigate', schema: INVESTIGATION_SCHEMA }),
])

const [variants, fixPoints, atRisk] = investigations.map(r => r || { findings: 'AGENT FAILED', key_facts: [], risks: [] })

log('Investigation complete; implementing candidate fixes in isolated worktrees')

const CONTEXT = `
${GROUND_TRUTH}

# Investigation findings from earlier agents (treat as evidence, verify anything you rely on)

## Relation-kind variants (Task A)
${variants.findings}
KEY FACTS: ${JSON.stringify(variants.key_facts)}
RISKS: ${JSON.stringify(variants.risks)}

## Candidate fix points (Task B)
${fixPoints.findings}
KEY FACTS: ${JSON.stringify(fixPoints.key_facts)}
RISKS: ${JSON.stringify(fixPoints.risks)}

## At-risk existing tests + test placement (Task C)
${atRisk.findings}
KEY FACTS: ${JSON.stringify(atRisk.key_facts)}
RISKS: ${JSON.stringify(atRisk.risks)}
`

const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string', description: 'One-paragraph description of the fix actually implemented' },
    diff: { type: 'string', description: 'Complete `git diff` output of the change, including the test' },
    ticket_case_iteration_queries: { type: 'integer', description: 'Queries executed by `queryset.first()` in the ticket case after the fix' },
    ticket_case_access_queries: { type: 'integer', description: 'Queries executed by `user.profile.user.kind` after the fix' },
    variants_fixed: { type: 'array', items: { type: 'string' }, description: 'Relation kinds verified fixed, with observed numbers' },
    variants_still_broken: { type: 'array', items: { type: 'string' }, description: 'Relation kinds still broken, honestly reported' },
    test_results: { type: 'string', description: 'Exact suites run and their Ran/OK/FAILED lines. Report failures verbatim -- do not hide them.' },
    regressions: { type: 'array', items: { type: 'string' }, description: 'Any test that changed from pass to fail, with name and cause analysis' },
    self_critique: { type: 'string', description: 'Weakest points of this approach' },
  },
  required: ['approach', 'diff', 'ticket_case_iteration_queries', 'ticket_case_access_queries', 'variants_fixed', 'variants_still_broken', 'test_results', 'regressions', 'self_critique'],
}

const SUITES = 'prefetch_related known_related_objects defer defer_regress select_related select_related_onetoone select_related_regress many_to_one many_to_one_null one_to_one many_to_many generic_relations generic_relations_regress contenttypes_tests queries foreign_object model_inheritance custom_managers'

const SHARED_IMPL_RULES = `
Rules for your implementation:
- You are in your OWN git worktree of the Django repo -- your cwd is the worktree root. Edit files there.
  Confirm with \`python -c "import django; print(django.__file__)"\` under \`PYTHONPATH=$PWD\` that you
  are exercising YOUR copy, not /testbed.
- Match Django's code style exactly (4-space indent, comment tone, line length <= 88ish as in the
  surrounding file). This is a patch that must look like it was written by a Django committer.
- ALSO add the regression test from the ticket to the Django test suite, in the location Task C
  recommends (reuse existing test models if they express the shape; only add models if genuinely
  necessary). The test must assert BOTH the iteration query count AND 0 queries on attribute access.
  Follow the style of the surrounding tests.
- Then RUN, and report verbatim Ran/OK/FAILED lines for:
    source activate testbed && python tests/runtests.py ${SUITES} --parallel=4
  If anything fails, investigate whether it is a real regression (compare against /testbed baseline
  by running the same suite there) and report honestly. DO NOT weaken or edit an existing test to
  make it pass -- if an existing test contradicts your fix, that is a finding to report.
- Verify the ticket case AND every relation-kind variant from Task A. Report exact query counts.
- Return the full \`git diff\` (git add -N any new files first so they appear in the diff).
`

phase('Implement')

const candidates = await parallel([
  () => agent(`${CONTEXT}

CANDIDATE 1 -- Implement the "do not clobber an already-cached related object" fix (approach F1).

Guard the manual reverse-relation cache assignment at all THREE sites in
django/db/models/fields/related_descriptors.py so that a value already populated (by a nested
prefetch, or by select_related on the inner queryset) is not overwritten by the parent instance:
  - ForwardManyToOneDescriptor.get_prefetch_queryset
  - ReverseOneToOneDescriptor.get_prefetch_queryset
  - create_reverse_many_to_one_manager(...).get_prefetch_queryset
Use the appropriate \`is_cached\` API for each site. Consider whether contenttypes' GenericForeignKey /
GenericRelation need the same treatment (only if Task A found them affected).

Think about whether guarding is enough or whether the object also needs to be reachable in the
opposite direction, and about the case where the inner queryset was NOT explicitly given.

${SHARED_IMPL_RULES}`,
    { label: 'cand1-guard-cache', phase: 'Implement', isolation: 'worktree', schema: CANDIDATE_SCHEMA }),

  () => agent(`${CONTEXT}

CANDIDATE 2 -- Implement the "fix the ordering in the prefetch machinery" fix (approach F2/F4).

Rather than guarding the descriptors, make django/db/models/query.py handle nesting correctly:
ensure the nested \`_prefetch_related_lookups\` are NOT evaluated early inside
\`get_prefetch_queryset\`, and/or make \`prefetch_one_level\`'s own assignment authoritative so that
the descendant lookup that walks back to the parent is actually performed and its result wins over
the descriptor's convenience cache.

You must keep the ticket case at 3 queries during iteration (a 4-query solution is a failure -- the
upstream regression test almost certainly asserts 3) and 0 queries on access.

Explore the design space freely within this direction: options include capturing and clearing
\`_prefetch_related_lookups\` on the queryset before handing it to the descriptor, changing how
\`obj_to_fetch\`/\`is_fetched\` treats explicitly-supplied Prefetch querysets, or moving the manual
reverse-cache assignment out of the descriptors into \`prefetch_one_level\`. Pick the cleanest one
that works and is defensible as an upstream patch.

${SHARED_IMPL_RULES}`,
    { label: 'cand2-machinery', phase: 'Implement', isolation: 'worktree', schema: CANDIDATE_SCHEMA }),

  () => agent(`${CONTEXT}

CANDIDATE 3 -- Open brief: implement the fix YOU judge most likely to match what Django upstream
would accept, whatever direction that is.

You have full latitude: guard the descriptors, restructure the machinery, or combine both. Optimize
for: (a) the ticket's expectation exactly (3 queries iterating, 0 on access, kind == "ADMIN"),
(b) fixing every relation kind Task A found broken, (c) zero regressions, (d) a minimal, idiomatic,
committer-quality diff. Consider whether a release note or docs change is warranted
(docs/releases/4.1.txt or similar) and whether the deferred-field semantics deserve a comment.

Think hard about the SEMANTIC question first and state your answer in \`approach\`: when the user
writes \`Prefetch("user", queryset=User.objects.only("kind"))\` nested under a prefetch that came
from \`User.objects.only("email")\`, which instance SHOULD \`profile.user\` be -- the parent instance
or a freshly fetched one -- and why? Make the code match that answer.

${SHARED_IMPL_RULES}`,
    { label: 'cand3-open', phase: 'Implement', isolation: 'worktree', schema: CANDIDATE_SCHEMA }),
])

const live = candidates.filter(Boolean)
log(`${live.length}/3 candidates returned; judging`)

if (!live.length) {
  return { error: 'all candidates failed', investigations: { variants, fixPoints, atRisk } }
}

const summarize = (c, i) => `
### CANDIDATE ${i + 1}
APPROACH: ${c.approach}
ITERATION QUERIES: ${c.ticket_case_iteration_queries} (must be 3)
ACCESS QUERIES: ${c.ticket_case_access_queries} (must be 0)
VARIANTS FIXED: ${JSON.stringify(c.variants_fixed)}
VARIANTS STILL BROKEN: ${JSON.stringify(c.variants_still_broken)}
TEST RESULTS: ${c.test_results}
REGRESSIONS: ${JSON.stringify(c.regressions)}
SELF-CRITIQUE: ${c.self_critique}
DIFF:
\`\`\`diff
${c.diff}
\`\`\`
`

const allCandidates = live.map(summarize).join('\n')

phase('Judge')

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    ranking: { type: 'array', items: { type: 'integer' }, description: 'Candidate numbers best-first' },
    winner: { type: 'integer' },
    scores: { type: 'string', description: 'Per-candidate scoring rationale on the stated lens' },
    defects_found: { type: 'array', items: { type: 'string' }, description: 'Concrete defects in any candidate diff, with the failing scenario' },
    recommended_diff: { type: 'string', description: 'The diff you would apply, with any corrections you would make to the winner' },
  },
  required: ['ranking', 'winner', 'scores', 'defects_found', 'recommended_diff'],
}

const LENSES = [
  {
    key: 'correctness',
    prompt: `Judge purely on CORRECTNESS. For each candidate diff, reason about what it does for: nested
prefetch back to parent (o2o both directions, FK both directions, m2m, GFK); a nested queryset that
uses select_related instead of only(); Prefetch with to_attr; multi-level nesting three deep;
prefetching the same relation from two different parents; None/missing related objects; multiple
databases (\`using\`); and \`_state.fields_cache\` vs descriptor \`__set__\` side effects. Look for cases
where the candidate leaves a STALE or WRONG instance cached, or where it silently changes which
instance is shared. Verify claims by reading the diff, and re-run anything you doubt in
/testbed (you may copy a candidate diff into a scratch worktree via \`git worktree add\`).`,
  },
  {
    key: 'regression-risk',
    prompt: `Judge purely on REGRESSION RISK and blast radius. Which candidate is most likely to break
third-party code or other Django behavior? Consider: code that relies on \`obj.rel.back is obj\`
identity after prefetch_related (a documented-ish optimization -- check
docs/ref/models/querysets.txt and docs/topics/db/queries.txt for what Django PROMISES here),
extra queries introduced in unrelated paths, memory/instance duplication, behavior with
\`prefetch_related_objects()\` called directly, and custom descriptors implementing
get_prefetch_queryset in third-party apps. Actually RUN the reported-at-risk suites against each
diff if you need evidence (\`git worktree add\` a scratch tree in /testbed and apply the diff).`,
  },
  {
    key: 'upstream-fit',
    prompt: `Judge purely on UPSTREAM FIT -- would a Django core committer merge this as the fix for this
ticket? Consider minimality, whether it fixes the root cause vs papering over a symptom, comment and
naming quality, whether the regression test is in the right place and in the house style, whether
existing test models were reused rather than new ones bolted on, whether a release note is needed,
and whether the diff would still read correctly after the codebase moves. Penalize clever hacks and
anything that depends on an accidental evaluation order.`,
  },
]

const judgements = await parallel(LENSES.map(l => () =>
  agent(`${GROUND_TRUTH}

You are judging ${live.length} candidate fixes. ${l.prompt}

${allCandidates}

Rank the candidates best-first on YOUR lens only, name the winner, and list every concrete defect you
found with the scenario that triggers it. In \`recommended_diff\`, give the diff you would actually
apply (you may amend the winner). Be adversarial: assume each candidate's self-report is optimistic.`,
    { label: `judge:${l.key}`, phase: 'Judge', schema: JUDGE_SCHEMA })))

const liveJudges = judgements.filter(Boolean)

phase('Critic')

const critic = await agent(`${GROUND_TRUTH}

You are the final completeness critic. Below are ${live.length} candidate fixes and ${liveJudges.length}
independent judge verdicts.

${allCandidates}

# JUDGE VERDICTS
${liveJudges.map((j, i) => `## Judge ${LENSES[i]?.key || i}
RANKING: ${JSON.stringify(j.ranking)} WINNER: ${j.winner}
SCORES: ${j.scores}
DEFECTS: ${JSON.stringify(j.defects_found)}
RECOMMENDED DIFF:
\`\`\`diff
${j.recommended_diff}
\`\`\``).join('\n\n')}

Your job: decide what should ACTUALLY be applied to /testbed, and say what is still missing.

Do the work to be sure:
- Create a scratch worktree in /testbed (\`git worktree add /tmp/critic-tree HEAD\`), apply the diff you
  believe is right, and VERIFY end to end: the ticket case (3 queries iterating, 0 on access,
  kind == "ADMIN"), every relation-kind variant, and the test suites
  \`${SUITES}\`. Run them and report verbatim results.
- If the judges disagree, adjudicate with evidence, not vibes.
- Call out anything not yet covered: an unfixed relation kind, a missing test assertion, a docs or
  release-note gap, a claim nobody verified.

Return, in \`final_diff\`, the exact unified diff to apply to /testbed (django source change + test),
already validated by you. In \`verification\`, the commands and their real output. In \`remaining_gaps\`,
what a reviewer would still ask for.`,
  {
    label: 'completeness-critic',
    phase: 'Critic',
    schema: {
      type: 'object',
      properties: {
        recommendation: { type: 'string' },
        final_diff: { type: 'string' },
        verification: { type: 'string' },
        remaining_gaps: { type: 'array', items: { type: 'string' } },
        judge_adjudication: { type: 'string' },
      },
      required: ['recommendation', 'final_diff', 'verification', 'remaining_gaps', 'judge_adjudication'],
    },
  })

return {
  investigation: { variants, fixPoints, atRisk },
  candidates: live,
  judges: liveJudges.map((j, i) => ({ lens: LENSES[i]?.key, ...j })),
  critic,
}
