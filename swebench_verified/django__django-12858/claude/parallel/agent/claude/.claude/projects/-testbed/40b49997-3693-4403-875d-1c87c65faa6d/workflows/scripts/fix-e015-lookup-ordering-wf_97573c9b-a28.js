export const meta = {
  name: 'fix-e015-lookup-ordering',
  description: 'Map, patch-review, and verify the models.E015 ordering-with-lookup false positive in Django',
  phases: [
    { title: 'Map', detail: 'locate validation sites, tests, and lookup/transform API semantics' },
    { title: 'Critique', detail: 'adversarially review the proposed one-line patch' },
  ],
}

const MAP_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'string', description: 'Detailed prose findings with file:line references' },
    files: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings'],
}

phase('Map')

const PROBES = [
  {
    label: 'map:check-site',
    prompt: `In the Django repo at /testbed, read django/db/models/base.py Model._check_ordering (around line 1689-1786) very carefully.
Explain exactly how the "related fields" loop walks a lookup path like 'supply__product__parent__isnull', which exception is raised where, what \`fld\` holds at that point, and why \`fld.get_transform('isnull')\` returns None.
Also state what Field.get_lookup() and Field.get_transform() do (read django/db/models/query_utils.py RegisterLookupMixin) and whether get_lookup('isnull') would return a class for a ForeignKey and for a CharField.
Report precise file:line references.`,
  },
  {
    label: 'map:tests',
    prompt: `In the Django repo at /testbed, find ALL existing tests that exercise Model._check_ordering / models.E015 (grep for E015, 'ordering' refers to the nonexistent, test_ordering_pointing in tests/).
List each test method name with file:line, and note specifically which ones cover transforms/lookups in ordering (e.g. tests referencing __isnull, custom transforms, related lookups).
Also report whether there is any existing test asserting that an invalid lookup like 'field__nonexistent_lookup' in Meta.ordering DOES raise E015 — that matters because a fix must not break it.
Report file:line for everything.`,
  },
  {
    label: 'map:other-sites',
    prompt: `In the Django repo at /testbed, search for OTHER places that validate ordering / lookup paths and might have the same false-positive bug pattern (\`get_transform(...) is None\` without also consulting \`get_lookup(...)\`).
Grep for get_transform across django/ and report each call site with file:line and whether a lookup (not transform) tail would be wrongly rejected there.
Specifically check django/contrib/admin/checks.py ordering validation and django/db/models/options.py, and django/db/models/sql/compiler.py find_ordering_name for how ordering strings are actually resolved at query time.`,
  },
  {
    label: 'map:git-history',
    prompt: `In the Django repo at /testbed, use git log/git show to find the commit that introduced the current related-fields loop in Model._check_ordering (ticket #29408, "ordering refers to the nonexistent field, related field, or lookup").
Show the diff of that commit (git log -S "get_transform(part)" -- django/db/models/base.py) and summarize what behavior it intended to add (transform support in Meta.ordering) and what it overlooked (plain lookups such as isnull).
Also report the upstream fix if present in history. Report commit hashes.`,
  },
]

const maps = await parallel(PROBES.map(p => () => agent(p.prompt, { label: p.label, phase: 'Map', schema: MAP_SCHEMA })))

phase('Critique')

const PATCH = `In django/db/models/base.py Model._check_ordering, change:

                except (FieldDoesNotExist, AttributeError):
                    if fld is None or fld.get_transform(part) is None:
                        errors.append(... models.E015 ...)

to:

                except (FieldDoesNotExist, AttributeError):
                    if fld is None or (
                        fld.get_transform(part) is None and fld.get_lookup(part) is None
                    ):
                        errors.append(... models.E015 ...)`

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['sound', 'sound-with-caveats', 'broken'] },
    problems: { type: 'array', items: { type: 'string' } },
    missed_cases: { type: 'array', items: { type: 'string' }, description: 'Meta.ordering values that would now be wrongly accepted or still wrongly rejected' },
    test_cases_to_add: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'problems'],
}

const LENSES = [
  { key: 'false-negative', ask: 'Try to REFUTE the patch by finding Meta.ordering strings that are genuinely invalid at query time but would now silently pass the check (false negatives). Actually test your candidates by running a small Django test/shell against /testbed if you can.' },
  { key: 'false-positive', ask: 'Try to find Meta.ordering strings involving lookups/transforms that would STILL be wrongly rejected after the patch (remaining false positives), e.g. lookups on relations, nested transform+lookup chains, "pk" aliases, m2m paths.' },
  { key: 'runtime-parity', ask: 'Compare the patched check against what the ORM actually accepts at query time (order_by resolution in django/db/models/sql/compiler.py and query.py). Does the check now match runtime behavior, over-accept, or under-accept? Be concrete with examples.' },
]

const critiques = await parallel(LENSES.map(l => () => agent(
  `You are reviewing a proposed patch to Django at /testbed.

Context gathered by other agents:
${maps.filter(Boolean).map(m => m.findings).join('\n\n---\n\n')}

PROPOSED PATCH:
${PATCH}

Your lens: ${l.ask}

Read the real code. Be skeptical and concrete. Return your verdict.`,
  { label: `critique:${l.key}`, phase: 'Critique', schema: CRITIQUE_SCHEMA },
)))

return {
  maps: maps.filter(Boolean),
  critiques: critiques.filter(Boolean).map((c, i) => ({ lens: LENSES[i].key, ...c })),
}
