export const meta = {
  name: 'scout-fast-delete-combine',
  description: 'Scout Django deletion internals, callers, overrides, and affected tests for combining fast-delete queries',
  phases: [
    { title: 'Scout', detail: 'parallel readers over deletion internals, overrides, tests, docs' },
    { title: 'Synthesize', detail: 'merge into one implementation-ready map' },
  ],
}

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          what: { type: 'string' },
          why_it_matters: { type: 'string' },
          code: { type: 'string', description: 'verbatim relevant snippet, <= 40 lines' },
        },
        required: ['file', 'what', 'why_it_matters'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings'],
}

const SCOUTS = [
  {
    key: 'overrides',
    prompt: `In the Django repo at /testbed, find EVERY place outside django/db/models/deletion.py that:
1. subclasses django.db.models.deletion.Collector,
2. overrides or calls Collector.related_objects, Collector.get_del_batches, Collector.can_fast_delete, or touches Collector.fast_deletes / Collector.data / Collector.field_updates,
3. calls collector.collect(...) with non-default kwargs.
Search django/ (including contrib), tests/, docs/, and any other top-level dirs. Use grep -rn for: 'related_objects', 'get_del_batches', 'can_fast_delete', 'fast_deletes', 'Collector(', 'deletion.Collector', 'NestedObjects'.
Report each hit with file:line, the exact current code of the override/call site (verbatim), and why a signature change to related_objects(related, objs) -> related_objects(related_model, related_fields, objs) would affect it.`,
  },
  {
    key: 'tests',
    prompt: `In the Django repo at /testbed, analyze tests that would be affected if the deletion Collector combined multiple fast-delete queries against the SAME related table into ONE query using OR'd filters (e.g. DELETE FROM entry WHERE created_by_id IN (..) OR updated_by_id IN (..)).
Focus on: tests/delete/tests.py, tests/delete/models.py, tests/delete_regress/, tests/admin_views/, tests/generic_relations*/, tests/contenttypes_tests/, tests/many_to_many/, tests/many_to_one/, tests/queries/, tests/backends/, tests/model_inheritance*/, tests/proxy_models/, tests/gis_tests/ (skip gis if not relevant).
Find every assertNumQueries / CaptureQueriesContext / assertQuerysetEqual around .delete() calls whose EXPECTED QUERY COUNT could change (drop) because two or more fast deletes now merge. For each: file:line, the test name, current asserted count, the models/relations involved, and your best estimate of the NEW count with combining (and the reasoning). Also list existing test models in tests/delete/models.py verbatim (the whole file is useful).`,
  },
  {
    key: 'internals',
    prompt: `In the Django repo at /testbed, read django/db/models/deletion.py, django/db/models/query.py (_raw_delete, delete), django/db/models/sql/subqueries.py (DeleteQuery.delete_batch, delete_qs), django/db/models/query_utils.py (Q), and django/db/backends/base/operations.py (bulk_batch_size) plus the sqlite3/oracle overrides of bulk_batch_size.
Answer precisely, with verbatim code:
1. How does QuerySet._raw_delete work, and does it handle a queryset whose WHERE clause is an OR of two IN lookups (including a lookup on a to_field / non-pk column)? Any path where it falls back to a subquery (DeleteQuery.delete_qs) and what triggers it?
2. What exactly does bulk_batch_size(fields, objs) do on sqlite3 and oracle, and what changes if we pass 2+ field names instead of 1?
3. Does Q(...) | Q(...) filtering on the same model across two different FKs create a JOIN or stay as simple WHERE columns? Show why (relevant code in sql/query.py add_q / build_filter for related-field IN lookups).
4. Any place where an OR'd filter would break _raw_delete's assumption of a single table (e.g. Query.get_compiler / SQLDeleteCompiler.as_sql single-table check).
Quote the exact source of SQLDeleteCompiler.as_sql and _raw_delete.`,
  },
  {
    key: 'upstream',
    prompt: `In the Django repo at /testbed (a Django checkout around version 3.0 dev), investigate the deletion Collector's fast-delete code path and enumerate the EDGE CASES an implementation that groups fast-deletable related objects by related model and OR's their filters must handle correctly. Read django/db/models/deletion.py, django/db/models/options.py (get_fields, related objects), django/db/models/fields/related.py.
Specifically analyze:
- self-referential ManyToMany (through model with two FKs to the same model) — what relations does get_candidate_relations_to_delete yield?
- two FKs from the same model to the same target (created_by/updated_by)
- FKs pointing to a non-pk to_field
- multi-table inheritance parent links, proxy models, keep_parents=True
- GenericForeignKey / private_fields path
- on_delete=DO_NOTHING mixed with CASCADE on the same target model
- ordering/determinism of the produced queries (dict iteration order, and whether tests could be flaky)
- the counting of deleted rows per model label in Collector.delete()
For each edge case say what the grouped implementation must do to preserve current behavior. Quote code where relevant.`,
  },
  {
    key: 'docs',
    prompt: `In the Django repo at /testbed, find documentation and release notes that mention deletion query behavior which may need updating: grep docs/ for 'fast delete', 'fast-delete', 'Collector', 'ON DELETE CASCADE', 'cascade' near db/models docs, docs/releases/3.0.txt (or the newest in-development release notes file — find it), docs/ref/models/querysets.txt delete() section, docs/topics/db/queries.txt deletion section.
Report: which release-notes file is the in-development one (check docs/releases/ for the highest version and django/__init__.py VERSION), the exact section headings inside it where a performance optimization note belongs (quote surrounding lines with line numbers), and any doc statements about the number of queries issued on delete that would become stale.`,
  },
]

phase('Scout')
const results = await parallel(SCOUTS.map(s => () =>
  agent(s.prompt, { label: `scout:${s.key}`, phase: 'Scout', schema: SCHEMA })
    .then(r => ({ key: s.key, ...r }))
))

phase('Synthesize')
const merged = results.filter(Boolean)
return merged
