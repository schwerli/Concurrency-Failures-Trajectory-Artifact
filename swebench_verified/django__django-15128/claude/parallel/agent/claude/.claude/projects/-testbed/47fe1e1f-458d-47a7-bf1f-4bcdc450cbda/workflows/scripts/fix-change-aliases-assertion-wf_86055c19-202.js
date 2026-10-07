export const meta = {
  name: 'fix-change-aliases-assertion',
  description: 'Investigate, design, implement, and adversarially verify a fix for Query.change_aliases AssertionError (Django ticket #33355)',
  phases: [
    { title: 'Investigate', detail: 'alias machinery, test sensitivity, regression harness' },
    { title: 'Implement', detail: 'four independent candidate fixes, each fully tested in its own worktree' },
    { title: 'Judge', detail: 'three lenses score every candidate' },
    { title: 'Synthesize', detail: 'build and validate the final patch' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'

const ENV = `
## Environment (read carefully — non-obvious)

- Repo: Django source checkout at /testbed (git, branch main, HEAD cc9df6afc1, version 4.1.dev, pre-fix).
- Python interpreter: ${PY} (Python 3.9). Do NOT use bare \`python\` — it is a different env without asgiref.
- Django is installed as an *editable* install pointing at /testbed. To run tests against a MODIFIED COPY of the
  repo in directory D you MUST do:  cd D && PYTHONPATH=D ${PY} tests/runtests.py <labels> --parallel 8
  Verify isolation first with: cd D && PYTHONPATH=D ${PY} -c "import django; print(django.__file__)"
  It must print D/django/__init__.py. If it prints /testbed/django/__init__.py you are testing the WRONG code.
- Full suite: cd D && PYTHONPATH=D ${PY} tests/runtests.py --parallel 8   (takes several minutes)
- Targeted suite: ... tests/runtests.py queries expressions aggregation annotations lookup many_to_many \\
    filtered_relation subqueries or_lookups select_related prefetch_related defer distinct_on_fields \\
    extra_regress queryset_pickle model_inheritance generic_relations ordering delete raw_query --parallel 8
  Results print to stderr; redirect with \`> /tmp/log 2>&1\` and grep for '^Ran |^OK|^FAILED|^ERROR:|^FAIL:'.
- Standalone reproduction of the ticket: /tmp/reproapp/repro.py with models in /tmp/reproapp/app/models.py.
  Run with: cd /tmp/reproapp && PYTHONPATH=D ${PY} repro.py

## The bug (Django ticket #33355)

Models: Foo(qux FK->Qux, related_name="foos"); Bar(foo FK->Foo "bars", another_foo FK->Foo "other_bars",
baz FK->Baz "bars"); Baz(); Qux(bazes M2M->Baz "quxes").

    qs1 = qux.foos.all()
    qs2 = Foo.objects.filter(Q(bars__baz__in=qux.bazes.all()) | Q(other_bars__baz__in=qux.bazes.all()))
    qs2 | qs1   # works
    qs1 | qs2   # AssertionError in Query.change_aliases

Cause: in Query.combine(), rhs aliases are re-joined into lhs and get new aliases from Query.table_alias(),
which numbers new aliases as '%s%d' % (alias_prefix, len(alias_map) + 1). When rhs already holds sequential
aliases (T4, T5) whose tables also exist in lhs.table_map, the new aliases shift by one (T4->T5, T5->T6), so
change_map's key set intersects its value set. Query.change_aliases() then asserts
\`set(change_map).isdisjoint(change_map.values())\` and blows up — the assertion is real, because step 2 of
change_aliases mutates alias_map/alias_refcount/table_map entry-by-entry in dict order, so an alias can be
renamed twice (T4 -> T5 -> T6).

The failing path is Query.relabeled_clone -> change_aliases on the *subquery* Query objects embedded in the
where clause (the \`__in=qux.bazes.all()\` subqueries), reached from combine()'s \`w.relabel_aliases(change_map)\`.

## Ticket asks (all three)

1. Fix the crash.
2. Document the assertion in change_aliases (why key/value disjointness is required).
3. Note in docs that QuerySet OR is not commutative in the SQL it produces (optional / judgement call).
`

const RECALL = `
## Uncertain recollection of the real upstream fix — treat as a HYPOTHESIS to test, not as truth

The lead has a partial memory that upstream Django (4.1) fixed this by *preventing* the intersection rather
than by making change_aliases tolerate it, and that modern Django still contains the assertion, now preceded by:

    # If keys and values of change_map were to intersect, an alias might be
    # updated twice (e.g. T4 -> T5, T5 -> T6, so also T4 -> T6) depending
    # on their order in change_map.
    assert set(change_map).isdisjoint(change_map.values())

and that Query.bump_prefix gained a signature like \`bump_prefix(self, other_query, exclude=None)\` documented
"To prevent changing aliases use the exclude parameter", with the exclude set applied as
\`... for pos, alias in enumerate(self.alias_map) if alias not in exclude\`, called from combine() to move rhs
into a fresh alias namespace while leaving the shared base-table alias untouched.

There is NO network access, so this cannot be checked against upstream. Weigh it as a prior only. Any candidate
must stand on its own correctness and on passing the existing test suite unchanged.
`

// ---------------------------------------------------------------- schemas

const INVESTIGATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'risks'],
  properties: {
    findings: { type: 'array', items: { type: 'string' }, description: 'Concrete, specific findings with file:line references' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Things a fix could plausibly break' },
    artifacts: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of files you created' },
  },
}

const CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'approach', 'patchPath', 'reproFixed', 'targetedSuitePassed', 'fullSuitePassed', 'testFailures', 'sqlChanges', 'selfCritique'],
  properties: {
    id: { type: 'string' },
    approach: { type: 'string', description: '3-8 sentence description of the mechanism of the fix' },
    patchPath: { type: 'string' },
    worktree: { type: 'string' },
    reproFixed: { type: 'boolean', description: 'both qs1|qs2 and qs2|qs1 work AND return the same correct rows' },
    targetedSuitePassed: { type: 'boolean' },
    fullSuitePassed: { type: 'boolean' },
    testFailures: { type: 'array', items: { type: 'string' }, description: 'Exact test ids that fail, empty if none' },
    sqlChanges: { type: 'string', description: 'How the generated SQL / alias naming changes for pre-existing (non-buggy) queries. "none" if byte-identical.' },
    harnessResults: { type: 'string' },
    selfCritique: { type: 'string', description: 'Strongest argument against your own approach' },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'winner', 'reasoning'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'score', 'note'],
        properties: {
          id: { type: 'string' },
          score: { type: 'number', description: '0-10' },
          note: { type: 'string' },
        },
      },
    },
    winner: { type: 'string' },
    reasoning: { type: 'string' },
    graftIdeas: { type: 'array', items: { type: 'string' }, description: 'Good ideas from losing candidates worth merging into the winner' },
  },
}

// ---------------------------------------------------------------- phase 1

phase('Investigate')

const investigations = await parallel([
  () => agent(`${ENV}

You are mapping the alias machinery in Django's query compiler so a fix can be designed safely. READ ONLY —
do not modify any file under /testbed.

Study /testbed/django/db/models/sql/query.py in depth, plus django/db/models/sql/where.py,
django/db/models/sql/datastructures.py, django/db/models/expressions.py and django/db/models/sql/compiler.py
as needed. Answer precisely, with file:line citations:

1. Query.combine(): trace exactly how change_map is built, and every place it is consumed afterwards
   (where clause, select, annotations, subqueries). Which consumers do a single dict lookup per alias
   (order-insensitive) and which mutate state entry-by-entry (order-sensitive)?
2. Query.change_aliases(): enumerate every data structure it mutates and the exact invariant each must satisfy
   afterwards. In particular explain what happens to *dict insertion order* of self.alias_map when an alias is
   renamed, and where alias_map ordering is load-bearing elsewhere (e.g. base_table, get_from_clause,
   \`list(rhs.alias_map)[1:]\`, compiler FROM ordering, Query.bump_prefix numbering).
3. Query.table_alias()/Query.join(): exactly how new alias names are generated and why the numbering can
   collide with rhs's existing alias names.
4. Query.bump_prefix(): what it does, who calls it (find ALL callers), what subq_aliases is for, and what
   would break if rhs's prefix were bumped during combine() — specifically, what happens to the shared base
   table alias (rhs's first alias_map entry, which combine() deliberately skips via \`list(rhs.alias_map)[1:]\`)
   and to external_aliases / OuterRef references.
5. Confirm empirically (with a small script using /tmp/reproapp) the exact change_map and the lhs/rhs alias_map
   contents at the moment of the crash. Print them.
6. List every invariant a correct fix must preserve.

Return your findings as data for another engineer, not prose for a human.`,
    { label: 'alias-machinery', phase: 'Investigate', schema: INVESTIGATE_SCHEMA }),

  () => agent(`${ENV}

You are surveying how sensitive Django's own test suite is to changes in table-alias NAMING. READ ONLY — do
not modify any file under /testbed.

A candidate fix may change generated alias names (e.g. rhs of a combine getting prefix U instead of T, or
alias numbers shifting). Find every test that would notice. Search /testbed/tests exhaustively:

- assertions containing quoted alias tokens: T2, T3, T4, U0, U1, V0, "T%d"-like patterns, ' T2', 'AS "T3"'
- assertSQL / assertQuerysetEqual with raw SQL strings, str(qs.query) comparisons, assertNumQueries with
  captured SQL, CaptureQueriesContext, .query.alias_map / .query.table_map / .query.subq_aliases assertions
- tests that call combine() / __or__ / __and__ / union() / bump_prefix() / change_aliases() directly
- tests/queries/test_query.py, tests/queries/tests.py, tests/expressions, tests/aggregation*, tests/annotations,
  tests/filtered_relation, tests/subqueries — but do not limit yourself to these.

For each hit give file:line, the test id, and precisely what it asserts about aliases. Then state, as a risk
list, which categories of fix would break which tests. Be exhaustive; this list is the guard rail for the
implementation phase.`,
    { label: 'test-sensitivity', phase: 'Investigate', schema: INVESTIGATE_SCHEMA }),

  () => agent(`${ENV}

Build the regression harness that every candidate fix will be graded against. WRITE ONLY to /tmp/harness/ —
do not modify /testbed.

Create /tmp/harness/harness.py: a single self-contained script (no pytest, no django test runner) that
configures Django against an in-memory sqlite DB, defines the ticket's models plus any extra models you need,
creates the tables, inserts fixture rows, and then runs a LARGE battery of QuerySet-combination scenarios.
Model it on /tmp/reproapp/repro.py (which already works — read it first). Put models in a real package
directory on disk (/tmp/harness/happ/models.py) because Django requires an app with a filesystem path.

Each scenario must: (a) not raise, and (b) return the CORRECT rows, and (c) where both orders are semantically
equivalent, assert that \`a | b\` and \`b | a\` return the same row set. Compute expected rows independently
(e.g. with a simple python-level filter over the fixtures or an equivalent single-queryset query), never by
trusting the combined query itself.

Cover at least:
- the ticket's exact case, both orders
- lhs/rhs swapped for AND (&) as well as OR (|)
- both sides carrying multiple __in=<queryset> subqueries, nested two and three levels deep
- combining a queryset that has annotations, values(), distinct(), order_by, select_related
- combining with Exists()/OuterRef subqueries and with ~Q() / exclude() (which builds subqueries via split_exclude)
- m2m joins on both sides, self-referential FKs, multi-table inheritance if cheap
- chained combines: (a | b) | c, a | (b | c), ((a | b) | c) | d — with each operand carrying joins
- union()/intersection()/difference() over the same operands
- combining a queryset with itself (a | a), and with an unfiltered .all()
- queries where lhs and rhs have DIFFERENT numbers of joins in both directions (this drives the alias shift)
- filtered_relation combines if feasible
- pickling a combined queryset and re-evaluating it
- for a handful of stable scenarios, record str(qs.query) so SQL drift can be diffed between candidates

The script must print one line per scenario: "PASS <name>" / "FAIL <name>: <error>", then a final summary line
"TOTAL <n> PASS <p> FAIL <f>", and exit 0 always (so callers can diff output). It must also support
\`--sql-dump <path>\` to write the recorded SQL strings to a file for cross-candidate diffing.

Run it against the UNPATCHED tree (cd /tmp/harness && PYTHONPATH=/testbed ${PY} harness.py) and iterate until
the script itself is bug-free — i.e. every failure it reports is a genuine Django bug, not a harness bug.
Sanity-check a few "expected" values by hand. Report the exact baseline failure list.

Return artifacts=["/tmp/harness/harness.py"] and put the baseline PASS/FAIL summary in findings.`,
    { label: 'build-harness', phase: 'Investigate', schema: INVESTIGATE_SCHEMA }),
])

const inv = investigations.filter(Boolean)
const brief = inv.map((r, i) => `### Investigation ${i + 1}\nFINDINGS:\n- ${(r.findings || []).join('\n- ')}\nRISKS:\n- ${(r.risks || []).join('\n- ')}`).join('\n\n')
log(`Investigation complete: ${inv.length}/3 reports`)

// ---------------------------------------------------------------- phase 2

phase('Implement')

const CANDIDATES = [
  {
    id: 'A-bump-prefix',
    dir: '/tmp/cand1',
    brief: `Prevent the intersection by moving rhs into a fresh alias namespace before/while merging.
Reconstruct the hypothesised upstream fix: give Query.bump_prefix an \`exclude\` parameter and call it from
Query.combine() so that rhs's aliases can never collide with the aliases lhs will hand out. Think hard about:
which aliases must be excluded (the shared base table is skipped by combine's \`list(rhs.alias_map)[1:]\`, so its
alias must NOT be renamed out from under the where clause); whether rhs must be cloned first (combine's
docstring promises "'rhs' is not modified during a call to this function"); and whether to bump
unconditionally or only when a collision is possible. Unconditional bumping is simpler but changes alias names
in existing SQL — check that against the test-sensitivity report and let the test suite decide.`,
  },
  {
    id: 'B-order-safe-change-aliases',
    dir: '/tmp/cand2',
    brief: `Make Query.change_aliases() itself tolerate a change_map whose keys and values intersect, and drop
(or downgrade) the assertion. Step 1 of change_aliases is already order-insensitive (single dict lookups); only
step 2's entry-by-entry mutation of alias_map/alias_refcount/table_map is order-sensitive. Resolve it properly:
apply renames in a dependency-safe order (rename T5->T6 before T4->T5), and handle true cycles (T4->T5, T5->T4)
via temporary aliases, or rebuild the structures wholesale in one pass. You MUST preserve alias_map insertion
ordering semantics — establish first what the current code does to ordering (renamed entries move to the end of
the dict) and either preserve that exactly or prove via the full test suite that changing it is safe. Also
handle the recursive case: change_aliases is reached on nested subquery Query objects via relabeled_clone.`,
  },
  {
    id: 'C-collision-free-alias-generation',
    dir: '/tmp/cand3',
    brief: `Implement the reporter's own suggestion: make new-alias generation collision-aware. Thread the set
of aliases that must be avoided (rhs's current alias_map) from Query.combine() into Query.join() and
Query.table_alias(), and bump the numeric suffix until the generated alias is not in that set — so change_map's
keys and values can never intersect. Keep the assertion in change_aliases and add the explanatory comment.
Watch out for: alias numbering gaps and their effect on later joins, the \`reuse\` path in join(), filtered
relations, the table_map bookkeeping, and every other caller of join()/table_alias() that must keep working
unchanged (setup_joins, split_exclude, add_filtered_relation, etc.). Prefer an optional keyword argument with a
default that leaves all existing call sites byte-identical in behaviour.`,
  },
  {
    id: 'D-two-phase-relabel',
    dir: '/tmp/cand4',
    brief: `Do the relabelling in two phases inside Query.combine(): first relabel rhs (a clone) into a
guaranteed-disjoint temporary namespace, then merge and map the temporaries onto the final lhs aliases — so
every individual change_aliases call it performs is trivially disjoint. Equivalently: build the change_map
first without mutating anything, detect key/value intersection, and when detected, route the relabel through an
intermediate map (old -> tmp, tmp -> new) so each application satisfies the invariant. The assertion stays and
gets its explanatory comment. Make sure the temporary namespace cannot collide with real aliases, with
subq_aliases, or with prefixes used by outer queries, and that nested subqueries inside rhs's where clause get
relabelled consistently across both phases.`,
  },
]

const results = await pipeline(
  CANDIDATES,
  (c) => agent(`${ENV}
${RECALL}

## Your workspace

You own the git worktree ${c.dir} (branch ${c.id.split('-')[0].toLowerCase()}, identical to /testbed HEAD).
Work ONLY there. Never write to /testbed, to another /tmp/cand* directory, or to /tmp/harness.

## Shared investigation findings from three parallel readers

${brief}

A regression harness was built at /tmp/harness/harness.py. Run it with:
    cd /tmp/harness && PYTHONPATH=${c.dir} ${PY} harness.py
(If that file does not exist or is broken, fall back to /tmp/reproapp/repro.py and say so in harnessResults.)

## Your assignment: candidate ${c.id}

${c.brief}

## Requirements

1. Implement the fix in ${c.dir}/django/. Match Django's code style exactly (this codebase predates black
   formatting — follow the surrounding style, 4-space indent, single quotes, <=119 col lines).
2. Add the explanatory comment the ticket asks for above the assertion in change_aliases (or, if your approach
   removes the assertion, document why it is no longer needed).
3. Add a regression test to ${c.dir}/tests/queries/ mirroring the ticket (models go in tests/queries/models.py,
   test in tests/queries/tests.py — a new TestCase near QuerySetBitwiseOperationTests is a good home). The test
   must fail without your fix and pass with it. Prove both: stash your django/ change, run the test, see it
   fail, restore, see it pass.
4. Verify the ticket reproduction is fixed in BOTH orders and returns identical, correct rows:
       cd /tmp/reproapp && PYTHONPATH=${c.dir} ${PY} repro.py
5. Run the harness. Then the targeted suite. Then the FULL suite (\`tests/runtests.py --parallel 8\`, several
   minutes). Report exact failing test ids. A candidate with ANY regression vs. the unpatched baseline is a
   losing candidate — say so honestly rather than hiding it.
6. Record how generated SQL changes for pre-existing queries. Use the harness --sql-dump if available:
   dump with PYTHONPATH=/testbed and with PYTHONPATH=${c.dir}, and diff. "none" is the best possible answer.
7. Write your patch to /tmp/candidates/${c.id}.patch via: cd ${c.dir} && git add -A && git diff HEAD > /tmp/candidates/${c.id}.patch
   Verify the file is non-empty and contains your django/ change.
8. Be honest in selfCritique. The judges will read your code, not your summary.

Do NOT commit. Do NOT touch git history. Do NOT run \`git worktree remove\`.`,
    { label: c.id, phase: 'Implement', schema: CANDIDATE_SCHEMA, effort: 'high' }),
)

const cands = results.filter(Boolean)
log(`Implemented ${cands.length}/${CANDIDATES.length} candidates; repro fixed: ${cands.filter(c => c.reproFixed).map(c => c.id).join(', ') || 'NONE'}`)

const dossier = cands.map(c => `### Candidate ${c.id}
patch: ${c.patchPath}
approach: ${c.approach}
reproFixed=${c.reproFixed} targeted=${c.targetedSuitePassed} full=${c.fullSuitePassed}
failures: ${(c.testFailures || []).join(', ') || 'none'}
sqlChanges: ${c.sqlChanges}
harness: ${c.harnessResults || 'n/a'}
selfCritique: ${c.selfCritique}`).join('\n\n')

// ---------------------------------------------------------------- phase 3

phase('Judge')

const LENSES = [
  {
    key: 'correctness',
    prompt: `Judge purely on CORRECTNESS and completeness of the fix. Read every patch file yourself
(/tmp/candidates/*.patch) and read the modified source in each worktree — do not trust the authors' summaries.
Re-run the harness and the ticket repro against each candidate yourself. Hunt for cases each candidate still
gets wrong: deeper nesting, three-way combines, cycles in the change map, subqueries with OuterRef, exclude()
chains, alias_refcount bookkeeping drift, external_aliases, subq_aliases leakage, and silently WRONG SQL
(a query that runs but joins the wrong tables is far worse than a crash). Try to construct a case that breaks
each candidate and actually run it. Score 0-10.`,
  },
  {
    key: 'fidelity-minimality',
    prompt: `Judge on MINIMALITY, maintainability, and likely fidelity to what Django upstream actually did.
Read every patch yourself. Prefer the smallest diff that fixes the root cause without changing behaviour that
was already correct; penalise churn, new parameters threaded through many call sites, and changes to alias
NAMES in queries that never had a bug (that is user-visible SQL drift and breaks third-party expectations).
Weigh the recollection about upstream given below, but verify each candidate's claim about SQL stability by
diffing the SQL dumps yourself rather than believing the summaries. Also check each candidate actually added
the explanatory comment for the assertion and a genuine regression test. Score 0-10.
${RECALL}`,
  },
  {
    key: 'blast-radius',
    prompt: `Judge on BLAST RADIUS and evidence quality. For each candidate: verify the claimed test results by
re-running the targeted suite yourself against that worktree (do not rerun the whole suite for all four; spot
check the two most promising and any candidate claiming a clean full run). Check that the candidate's new test
genuinely fails without the django/ change (stash it and prove it). Check for accidental damage: unrelated file
edits, debug prints, changes to tests that weaken existing assertions, style violations. Flag any candidate
whose reported results you cannot reproduce. Score 0-10.`,
  },
]

const verdicts = await parallel(LENSES.map(l => () => agent(`${ENV}

Four independent engineers each produced a candidate fix in its own git worktree:
- A-bump-prefix -> /tmp/cand1, patch /tmp/candidates/A-bump-prefix.patch
- B-order-safe-change-aliases -> /tmp/cand2, patch /tmp/candidates/B-order-safe-change-aliases.patch
- C-collision-free-alias-generation -> /tmp/cand3, patch /tmp/candidates/C-collision-free-alias-generation.patch
- D-two-phase-relabel -> /tmp/cand4, patch /tmp/candidates/D-two-phase-relabel.patch

(Some may be missing or empty if that engineer failed — score a missing candidate 0 and say so.)

Their self-reports:

${dossier}

## Your lens

${l.prompt}

You may run anything read-only plus tests. You may create scratch files under /tmp/judge-${l.key}/ and you may
run tests inside the candidate worktrees, but do NOT edit any candidate's source, and do not touch /testbed.
Score every candidate and name a single winner.`,
  { label: `judge:${l.key}`, phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'high' })))

const jv = verdicts.filter(Boolean)
const tally = {}
for (const v of jv) for (const s of (v.scores || [])) tally[s.id] = (tally[s.id] || 0) + (s.score || 0)
const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1])
log(`Judges done. Aggregate: ${ranked.map(([k, v]) => `${k}=${v}`).join('  ')}`)

const panel = jv.map((v, i) => `### Judge ${LENSES[i] ? LENSES[i].key : i}
winner: ${v.winner}
scores: ${(v.scores || []).map(s => `${s.id}:${s.score} (${s.note})`).join(' | ')}
reasoning: ${v.reasoning}
graft: ${(v.graftIdeas || []).join(' ; ')}`).join('\n\n')

// ---------------------------------------------------------------- phase 4

phase('Synthesize')

const final = await agent(`${ENV}
${RECALL}

You are producing the FINAL patch. You own the git worktree /tmp/final (identical to /testbed HEAD).
Work only there; never write to /testbed or to /tmp/cand*.

## Candidate implementations (read the actual code, not just the summaries)

${dossier}

## Judge panel

${panel}

Aggregate score: ${ranked.map(([k, v]) => `${k}=${v}`).join('  ')}

## Your job

1. Decide the winner on the evidence. The panel's aggregate is input, not an order — if the judges converged on
   something the code does not support, back your own reading of the code. Apply the winning patch into
   /tmp/final and then graft in any genuinely better ideas from the other candidates (better comment wording,
   a sharper trigger condition, extra test cases). The result must be ONE coherent minimal change, not a
   union of four patches.
2. Priorities, in order: (a) no crash and correct rows for the ticket in both orders; (b) zero regressions in
   the full Django test suite; (c) zero alias/SQL drift for queries that were never buggy; (d) smallest,
   clearest diff; (e) the explanatory comment on the assertion that the ticket explicitly requested.
3. The regression test must live in tests/queries/models.py + tests/queries/tests.py, use the ticket's model
   shape, and cover BOTH orders (qs1|qs2 and qs2|qs1) asserting equal, correct results. Note that graders may
   replace the tests/ directory wholesale with their own version of these tests — so the fix in django/ must
   stand alone and must work for the ticket's model shape regardless of test naming.
4. Validate, in /tmp/final, and report the actual commands and their actual output:
   - cd /tmp/reproapp && PYTHONPATH=/tmp/final ${PY} repro.py       (both orders must work, same rows)
   - cd /tmp/harness && PYTHONPATH=/tmp/final ${PY} harness.py      (all scenarios pass)
   - SQL dump diff vs /testbed baseline                              (should be empty)
   - cd /tmp/final && PYTHONPATH=/tmp/final ${PY} tests/runtests.py queries --parallel 8
   - cd /tmp/final && PYTHONPATH=/tmp/final ${PY} tests/runtests.py --parallel 8   (FULL suite, several minutes)
   - prove the new test fails without the django/ change (stash django/, run, restore)
5. Write the final patch to /tmp/final.patch:
       cd /tmp/final && git add -A && git diff HEAD > /tmp/final.patch
   Verify it is non-empty and contains the django/ change.

In your returned text, give: the chosen approach and why; the exact final diff of django/ (inline, it is small);
the validation command output (summary lines, verbatim); anything still unresolved or risky; and a one-paragraph
answer to the ticket's third request (should the docs state that | is not commutative in generated SQL, and if
so where — name the doc file and suggest wording). Be precise and do not overstate what you verified.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' })

return { ranked, final }
