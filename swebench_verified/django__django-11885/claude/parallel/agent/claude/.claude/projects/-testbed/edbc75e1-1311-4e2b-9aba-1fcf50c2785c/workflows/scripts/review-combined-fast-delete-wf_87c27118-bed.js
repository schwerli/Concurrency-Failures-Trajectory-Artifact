export const meta = {
  name: 'review-combined-fast-delete',
  description: 'Adversarially review the combined fast-delete change in django/db/models/deletion.py',
  phases: [
    { title: 'Review', detail: 'independent lenses over the diff' },
    { title: 'Verify', detail: 'refute each finding' },
  ],
}

const CONTEXT = `
CONTEXT FOR YOUR REVIEW (you are reviewing a change in the Django checkout at /testbed; run \`git diff\` there to see it):

Ticket: "Combine fast delete queries". When emulating ON DELETE CASCADE, deletion.Collector issues one
"DELETE FROM t WHERE fk_id IN (...)" per foreign key. When several FKs point at the same target model
(e.g. Entry.created_by and Entry.updated_by both -> User, or a self-referential M2M through table with
from_id/to_id), those should be combined into ONE query with OR'd filters.

The change (all in django/db/models/deletion.py plus one override in django/contrib/admin/utils.py):
1. can_fast_delete: 'model = type(objs)' -> 'model = objs._meta.model', so it can be passed a MODEL CLASS,
   not just an instance/queryset. collect() now asks can_fast_delete(related_model, from_field=field)
   BEFORE building any queryset.
2. get_del_batches(objs, field) -> get_del_batches(objs, fields): passes all field names to
   connection.ops.bulk_batch_size(field_names, objs).
3. collect(): fast-deletable related models are accumulated in model_fast_deletes = defaultdict(list)
   keyed by related_model with a list of fields; after the relation loop, one queryset per related model
   is built and appended to self.fast_deletes.
4. related_objects(related, objs) -> related_objects(related_model, related_fields, objs), which builds
   reduce(or_, Q(**{'%s__in' % f.name: objs}) for f in related_fields) and filters _base_manager on it.
5. django/contrib/admin/utils.py NestedObjects.related_objects updated to the new signature and to
   select_related(*[f.name for f in related_fields]).

Already verified by the author: the full Django test suite (13061 tests, sqlite) shows no new failures
(26 pre-existing env failures re unicode filenames/locale/root perms, identical before and after);
a manual probe confirms the combined SQL is emitted, including for a FK whose to_field is a non-pk
unique column (produces "other_referrer_id IN (42)").

Be concrete and skeptical. Only report defects you can tie to a specific line and a concrete failure
scenario. Do NOT report style preferences or "consider adding a comment".
`

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
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          claim: { type: 'string' },
          failure_scenario: { type: 'string', description: 'concrete models/inputs -> wrong behavior' },
        },
        required: ['title', 'file', 'severity', 'claim', 'failure_scenario'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    evidence: { type: 'string', description: 'code quoted or command output that settles it' },
  },
  required: ['refuted', 'reasoning'],
}

const LENSES = [
  { key: 'semantics', prompt: `Lens: QUERY SEMANTICS. Does OR-combining change WHICH ROWS are deleted versus the old one-query-per-FK behavior, in any case? Consider: NULL fk values, a row matching both FKs (double counting in the returned deleted_counter?), FKs to non-pk to_field columns, FKs with different to_field targets combined in one query, related models with a custom _base_manager (filtered!) or default manager, multi-table-inherited related models (would the DELETE need a join / hit the "Can only delete from one table at a time" assertion in SQLDeleteCompiler.as_sql?), and proxy models. Verify by actually running code in /testbed (write a probe script under /tmp, use sqlite in-memory with a real installed app package) where you can.` },
  { key: 'grouping', prompt: `Lens: GROUPING KEY CORRECTNESS. model_fast_deletes is keyed by related_model. Is that key correct/sufficient? What if two different relations to the same related_model have DIFFERENT on_delete values, or one is DO_NOTHING (skipped earlier) — could a field ever be grouped in that should not be? What about relations where related.field's target model differs (parent link / inherited FK), hidden relations (related_name='+'), and relations from a proxy vs concrete model — could two entries collide and produce a query against the wrong table? Also: can_fast_delete is now called with a model class BEFORE the queryset exists; enumerate every behavioral difference between can_fast_delete(model_class) and the old can_fast_delete(queryset).` },
  { key: 'batching', prompt: `Lens: BATCHING AND BACKEND LIMITS. get_del_batches now receives N field names and calls connection.ops.bulk_batch_size(field_names, objs). Read django/db/backends/*/operations.py bulk_batch_size implementations (base, sqlite3, oracle, mysql, postgresql). With N fields, the batch is smaller, but the produced query now has N placeholders lists of that size — i.e. N*batch_size parameters total. Could this EXCEED the backend's parameter limit (SQLite SQLITE_MAX_VARIABLE_NUMBER=999, Oracle limits) where the old code did not? Work through the arithmetic exactly for sqlite and oracle and say whether the new code is safe, unsafe, or exactly break-even. Test on sqlite in /testbed with a large object count (e.g. delete an object with 2 FKs pointing at it from 2000+ rows, or a model with 3 FKs and thousands of parents) and report the real outcome.` },
  { key: 'compat', prompt: `Lens: API COMPATIBILITY AND CALLERS. related_objects() and get_del_batches() changed signature. Search the whole /testbed tree (django/, tests/, docs/, extras/, scripts/) for every caller, subclass, override, or documentation reference. Is django/contrib/admin/utils.py NestedObjects the only override, and is its new select_related(*names) correct — specifically, does select_related with MULTIPLE field names still produce the behavior the admin's deletion-confirmation page needs, and can select_related now be called with zero args (which means "follow all FKs") if related_fields were ever empty? Can related_fields or the reduce() ever be empty, raising TypeError from reduce with no initializer? Prove whether model_fast_deletes values can be empty lists.` },
  { key: 'ordering', prompt: `Lens: EXECUTION ORDER AND CONSTRAINTS. Fast deletes for a model's relations are now appended AFTER all non-fast related processing for that model (previously interleaved per-relation). Does the resulting order of self.fast_deletes risk foreign-key constraint violations on backends that check constraints immediately (MySQL/InnoDB) or sqlite with foreign_keys=ON? Construct a concrete model graph where the new order deletes a parent row before a child row that references it, and TEST it on sqlite in /testbed with PRAGMA foreign_keys=ON. Also check Collector.delete()'s single-object fast path and the deleted_counter accounting still hold.` },
  { key: 'coverage', prompt: `Lens: TEST COVERAGE. The author added tests/delete/tests.py::FastDeleteTests::test_fast_delete_combined_relationships. Read tests/delete/models.py and tests/delete/tests.py. Is the new test meaningful (does it fail without the fix)? What important scenario from the ticket is NOT covered by the existing suite plus this test — in particular self-referential ManyToManyField('self') (is there any model in the Django test suite exercising a combined m2m through-table delete?), 3+ FKs to the same target, and the queryset .delete() path. Name the specific missing test and write the exact test code you would add, using models that ALREADY exist in tests/delete/models.py or tests/backends/models.py (Object.related_objects is a self-referential m2m). Verify your proposed test actually passes on the patched tree by running it.` },
]

phase('Review')
const reviewed = await pipeline(
  LENSES,
  l => agent(CONTEXT + '\n\n' + l.prompt, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS }),
  (r, l) => parallel(((r && r.findings) || []).map(f => () =>
    agent(`${CONTEXT}

A reviewer raised this finding against the change. Your job is to REFUTE it. Default to refuted=true unless
you can demonstrate the defect is real with evidence (quoted code, or a probe script you actually ran in /testbed).

Finding: ${f.title}
File: ${f.file}${f.line ? ':' + f.line : ''}
Claim: ${f.claim}
Failure scenario: ${f.failure_scenario}

Check the real code and, where the claim is testable, actually run it. Report refuted=true if the claim is
wrong, describes pre-existing behavior unchanged by this diff, or cannot actually occur.`,
      { label: `verify:${l.key}:${f.title.slice(0, 30)}`, phase: 'Verify', schema: VERDICT })
      .then(v => ({ ...f, lens: l.key, verdict: v }))
  ))
)

const all = reviewed.flat().filter(Boolean)
const confirmed = all.filter(f => f.verdict && f.verdict.refuted === false)
log(`${all.length} findings raised, ${confirmed.length} survived refutation`)
return { confirmed, refuted: all.filter(f => !f.verdict || f.verdict.refuted).map(f => ({ title: f.title, lens: f.lens, why: f.verdict && f.verdict.reasoning })) }
