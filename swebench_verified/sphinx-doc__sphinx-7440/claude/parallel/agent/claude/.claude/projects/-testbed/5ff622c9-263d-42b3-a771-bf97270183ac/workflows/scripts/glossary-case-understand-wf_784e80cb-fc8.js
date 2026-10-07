export const meta = {
  name: 'glossary-case-understand',
  description: 'Map all code paths depending on glossary term lowercasing, then design the fix',
  phases: [
    { title: 'Investigate', detail: 'parallel readers over term registration, lookup, i18n, search, tests' },
    { title: 'Design', detail: 'independent fix proposals' },
    { title: 'Judge', detail: 'score proposals and synthesize' },
  ],
}

const REPO = '/testbed'

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    sites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          what: { type: 'string' },
          dependsOnLowercase: { type: 'string', description: 'yes | no | unclear, plus why' },
        },
        required: ['file', 'line', 'what', 'dependsOnLowercase'],
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'sites', 'risks'],
}

const AREAS = [
  {
    key: 'registration',
    prompt: `In the Sphinx repo at ${REPO}, trace EXACTLY how glossary terms are registered as cross-reference targets.
Start at sphinx/domains/std.py:make_glossary_term (~line 276) and StandardDomain.note_object (~line 649).
Read the full Glossary directive run() method too.
Report every place a term name is lowercased, normalized, or used as a dict key, with file:line.
Also: does note_object have any way to suppress the duplicate warning? What is the objects dict keyed by?
Report facts with file:line. Do not propose fixes.`,
  },
  {
    key: 'lookup',
    prompt: `In the Sphinx repo at ${REPO}, trace how a :term: cross-reference is RESOLVED.
Find the XRefRole subclass used for the term role, its process_link, StandardDomain.resolve_xref,
_resolve_term_xref if any, _resolve_obj_xref (~line 926), and resolve_any_xref (~line 941).
Determine precisely where the *reference target* text gets lowercased on the lookup side, with file:line.
Key question: if terms were stored with original case, what exact lookup changes would be needed so that
existing docs using :term:\`mysql\` to point at a glossary entry "MySQL" keep working (case-insensitive fallback)?
Report facts with file:line. Do not write code.`,
  },
  {
    key: 'i18n-and-consumers',
    prompt: `In the Sphinx repo at ${REPO}, find every OTHER consumer of glossary term objects besides the std domain resolution.
Grep the whole tree (sphinx/) for make_glossary_term, note_object('term', 'term', and for iteration over StandardDomain.objects.
Specifically check: sphinx/transforms/i18n.py, sphinx/search/__init__.py, sphinx/builders/html, intersphinx,
StandardDomain.get_objects (~line 964), merge_domaindata, clear_doc.
For each consumer, state whether it assumes the stored term name is lowercase. Report file:line facts. Do not write code.`,
  },
  {
    key: 'tests-and-history',
    prompt: `In the Sphinx repo at ${REPO}:
1. Find ALL existing tests that touch glossary terms or term xrefs: grep tests/ for 'glossary', ':term:', "note_object", "'term'".
   Read tests/test_domain_std.py and tests/test_directive_other.py and tests/roots/*glossary* fully enough to list
   which assertions would break if terms were stored with ORIGINAL case instead of lowercased.
2. Run: cd ${REPO} && git log -S "termtext.lower()" --oneline -- sphinx/domains/std.py
   and git log --oneline -20 -- sphinx/domains/std.py
   to find WHY lowercasing was introduced. Report the commit and its message.
Report facts with file:line and commit hashes. Do not write code.`,
  },
]

phase('Investigate')
const findings = await parallel(AREAS.map(a => () =>
  agent(a.prompt, { label: `investigate:${a.key}`, phase: 'Investigate', schema: FINDINGS_SCHEMA })
    .then(r => ({ area: a.key, ...r }))
))

const ctx = JSON.stringify(findings.filter(Boolean), null, 1)

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string' },
    diffSketch: { type: 'string', description: 'concrete code, file:line anchored' },
    backwardCompat: { type: 'string' },
    testsToAddOrChange: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
  },
  required: ['approach', 'diffSketch', 'backwardCompat', 'testsToAddOrChange', 'weaknesses'],
}

const ANGLES = [
  { key: 'minimal', lens: 'MINIMAL CHANGE: smallest possible diff that fixes the bug. Bias toward not touching the storage format.' },
  { key: 'store-original-case', lens: 'STORE ORIGINAL CASE: register terms with their original case and make lookup case-insensitive as a fallback. Think hard about how resolve_xref finds a case-differing match without O(n) scans breaking, and what happens with intersphinx/ get_objects / search index.' },
  { key: 'upstream-fidelity', lens: 'UPSTREAM FIDELITY: what would the Sphinx maintainers most plausibly have merged for this exact issue? Consider their conventions (CHANGES entry, deprecation policy, test style in tests/test_domain_std.py). Check git history conventions in the repo.' },
]

phase('Design')
const designs = await parallel(ANGLES.map(a => () =>
  agent(`You are designing the fix for this Sphinx bug:

"glossary duplicate term with a different case" — a glossary containing both "MySQL" and "mysql" as
separate terms emits: WARNING: duplicate term description of mysql, other instance in glossary.
MySQL and mysql are legitimately DIFFERENT terms. Expected: no warning, both terms usable.

Root cause: sphinx/domains/std.py:308 does std.note_object('term', termtext.lower(), node_id, ...)

Investigation findings from parallel readers (facts with file:line):
${ctx}

Your design lens: ${a.lens}

Read the actual code at ${REPO} to verify anything you rely on. Produce a concrete, buildable design.
Critically: any fix MUST keep case-insensitive :term: references working, because that was the
long-standing documented behaviour that many projects depend on.`,
    { label: `design:${a.key}`, phase: 'Design', schema: DESIGN_SCHEMA })
    .then(r => ({ angle: a.key, ...r }))
))

phase('Judge')
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    ranking: { type: 'array', items: { type: 'string' } },
    scores: { type: 'string' },
    recommendation: { type: 'string', description: 'the single approach to implement, with concrete code' },
    graftedIdeas: { type: 'array', items: { type: 'string' } },
    mustAvoid: { type: 'array', items: { type: 'string' } },
  },
  required: ['ranking', 'scores', 'recommendation', 'graftedIdeas', 'mustAvoid'],
}

const dctx = JSON.stringify(designs.filter(Boolean), null, 1)
const JUDGES = ['correctness and backward compatibility', 'upstream maintainer taste and minimality', 'test coverage and edge cases']

const verdicts = await parallel(JUDGES.map(j => () =>
  agent(`Three designs were proposed to fix the Sphinx glossary case-sensitivity bug
(sphinx/domains/std.py:308 lowercases term names, so "MySQL" and "mysql" collide).

Designs:
${dctx}

Judge them through the lens of: ${j}.
Verify claims against the real code at ${REPO} — read files, do not trust the designs' assertions.
Rank them and give ONE concrete recommendation with actual code.`,
    { label: `judge:${j.slice(0, 18)}`, phase: 'Judge', schema: JUDGE_SCHEMA })
))

return { findings: findings.filter(Boolean), designs: designs.filter(Boolean), verdicts: verdicts.filter(Boolean) }
