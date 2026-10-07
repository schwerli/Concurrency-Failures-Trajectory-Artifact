export const meta = {
  name: 'coarsen-construct-fix-verify',
  description: 'Adversarially verify the applied Coarsen.construct coord-preservation fix',
  phases: [
    { title: 'Attack', detail: 'independent skeptics try to break the patch' },
    { title: 'Judge', detail: 'resolve attacks into confirmed defects' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'
const CTX = `
Repo: /testbed (xarray 2022.10.1.dev, git branch main). Interpreter WITH numpy/dask/pint: ${PY}
(bare \`python\` has no numpy).

A fix has ALREADY been applied to the working tree. See it with: cd /testbed && git diff

Summary of the fix, in xarray/core/rolling.py, Coarsen.construct (~line 976):
    -   should_be_coords = set(window_dim) & set(self.obj.coords)
    +   should_be_coords = (set(window_dim) | set(self.obj.coords)) & set(
    +       reshaped.variables
    +   )
        result = reshaped.set_coords(should_be_coords)
Intent: every variable that was a coordinate on the input stays a coordinate on the output
(previously non-dimensional coords like a "day" coord along the coarsened "time" dim, coords on
un-coarsened dims, and scalar coords were silently demoted to data variables).
A new test test_coarsen_construct_keeps_all_coords was added to xarray/tests/test_coarsen.py, and a
doc/whats-new.rst entry.

Established facts (already verified, do not redo unless you doubt them):
 - test_coarsen.py + test_rolling.py: 2012 passed. test_dataset.py/test_dataarray.py: pass.
 - test_units.py has ONE failure, TestPintWrappingDask::test_duck_array_ops, which ALSO fails on a clean
   tree (pre-existing, unrelated).
 - doctests in xarray/core/rolling.py pass.
 - In xarray, any variable whose name matches an existing dimension name is automatically a coordinate,
   so the \`set(window_dim) | ...\` term cannot promote a former *data* variable.

You may run anything read-only and create scratch files in /tmp, but DO NOT modify files under /testbed
(you may use \`git stash\`/\`git stash pop\` ONLY if you restore state immediately; prefer copying the repo
to /tmp if you need to compare pre/post behaviour).
`

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['defects', 'verdict_summary'],
  properties: {
    defects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'failure_scenario', 'evidence', 'severity'],
        properties: {
          summary: { type: 'string' },
          failure_scenario: { type: 'string', description: 'concrete inputs -> wrong output' },
          evidence: { type: 'string', description: 'exact command + observed output' },
          severity: { enum: ['blocking', 'should-fix', 'nit'] },
          file: { type: 'string' },
          line: { type: 'integer' },
        },
      },
    },
    verdict_summary: { type: 'string' },
  },
}

const LENSES = [
  {
    key: 'correctness',
    prompt: `${CTX}

LENS: correctness of the new expression. Try hard to find an input where the patched line produces a
WRONG coord set. Consider: coarsening multiple dims at once; boundary="trim"/"pad" with side="left"/"right";
a coord that is an index on a coarsened dim (now 2-D — should it still be a coord? does an index linger
or get dropped inconsistently?); a MultiIndex on a coarsened dim and on an un-coarsened dim (does
set_coords raise on MultiIndex level names?); a DataArray input with name colliding with a coord;
0-d/scalar coords; a coord whose dims are a mix of coarsened and un-coarsened dims; datetime/cftime coords;
coarsening a dim of size 0; \`keep_attrs=True/False\` interaction with coord attrs.
Compare the output's coord set against \`ds.isel(time=slice(...))\`-style expectations and against
\`ds.coarsen(...).mean()\` (the reduce path). Report only defects you can demonstrate with output.`,
  },
  {
    key: 'simplification',
    prompt: `${CTX}

LENS: is the expression the simplest correct form? The \`set(window_dim) |\` term and the
\`& set(reshaped.variables)\` guard may both be dead code. PROVE or DISPROVE by construction:
  (a) find any realizable input where \`set(window_dim) & set(reshaped.variables)\` contains a name that is
      NOT in \`self.obj.coords\` (if you can, the union term is load-bearing; if not, it is dead);
  (b) find any realizable input where \`set(self.obj.coords)\` contains a name NOT in
      \`reshaped.variables\` (if not, the guard is dead).
Read the loop above the patched line and Dataset.__setitem__/merge in xarray/core to argue from the code,
then confirm empirically (you can monkeypatch a copy of the repo in /tmp to instrument the sets, or just
compute the sets in a REPL replicating the loop). Then state the single clearest form you would ship,
and whether the shipped form is acceptable as-is. Report a "nit"-severity defect if simplification is
warranted, with the exact replacement.`,
  },
  {
    key: 'test-quality',
    prompt: `${CTX}

LENS: test quality. Read the new test test_coarsen_construct_keeps_all_coords in
xarray/tests/test_coarsen.py (git diff shows it). Determine:
 - Does it actually FAIL on unpatched code for the right reason, for BOTH dask params? Verify by copying
   /testbed to /tmp/xr-clean (\`cp -a\`), reverting ONLY xarray/core/rolling.py there
   (\`cd /tmp/xr-clean && git checkout xarray/core/rolling.py\`), and running the new test there with
   ${PY} -m pytest. Report exact output. (Do not touch /testbed.)
 - Is \`raise_if_dask_computes()\` meaningfully exercised — i.e. is the object actually chunked along the
   coarsened dim, and would a regression that computes eagerly be caught? Note \`has_dask\` is True here.
 - Does \`assert_identical(actual, expected)\` really assert coord-vs-datavar status, or would it pass if a
   coord were demoted? Prove it either way (that determines whether the explicit
   \`set(actual.coords) == set(ds.coords)\` assertion is load-bearing).
 - Is \`expected.vart\` the right DataArray comparison (does it carry all the coords)? Is the DataArray-path
   assertion strong enough?
 - Any coverage gap worth adding: multi-dim coarsen with non-dim coords, boundary="trim", a coord spanning
   both a coarsened and un-coarsened dim, MultiIndex.
Report gaps as defects with the exact test code you'd add.`,
  },
  {
    key: 'regression',
    prompt: `${CTX}

LENS: hidden regressions elsewhere. Anything downstream that assumed construct's old (buggy) behaviour.
 - grep the whole repo (xarray/**, doc/**, asv_bench/**) for \`.construct(\` and for Coarsen usage, and check
   each site that could be affected by more variables becoming coords.
 - Run the wider test suites that touch coarsen/rolling/coords and report exact pass/fail counts:
   ${PY} -m pytest xarray/tests/test_coarsen.py xarray/tests/test_rolling.py xarray/tests/test_computation.py xarray/tests/test_missing.py xarray/tests/test_groupby.py xarray/tests/test_indexes.py -q
   plus ${PY} -m pytest --doctest-modules xarray/core/rolling.py -q
 - Check whether doc/user-guide/reshaping.rst's coarsen().construct() example (~line 326) would now render
   differently, and whether that rendered output is committed anywhere that would go stale.
 - Check the type annotations still hold (\`${PY} -m mypy xarray/core/rolling.py\` if mypy is installed —
   report whether new errors appear vs a clean copy; if mypy is absent or slow, say so and skip).
 - Verify \`git diff\` contains NOTHING unintended (no stray debug code, no unrelated edits).
Report only real regressions, with exact command output.`,
  },
]

phase('Attack')
const attacks = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `attack:${l.key}`, phase: 'Attack', schema: VERDICT })
))

const found = LENSES.map((l, i) => ({ key: l.key, report: attacks[i] })).filter(x => x.report)
const allDefects = found.flatMap(f => (f.report.defects || []).map(d => ({ ...d, lens: f.key })))
log(`${found.length}/${LENSES.length} lenses reported; ${allDefects.length} candidate defects`)

phase('Judge')
const judged = await parallel(allDefects.map((d, i) => () =>
  agent(`${CTX}

A reviewer of the applied fix raised this candidate defect (lens: ${d.lens}):

${JSON.stringify(d, null, 2)}

Your job is to REFUTE it. Default to refuted=true unless you can independently reproduce the problem
yourself with a concrete command against /testbed as it currently stands. Ask: is this a real defect
*introduced or left unfixed by this patch*, or is it (a) a pre-existing xarray behaviour unrelated to the
patch and out of scope, (b) a misreading of the code, (c) a purely stylistic preference, or (d) something
already handled? Run the commands. Quote actual output.`,
    { label: `judge:${i + 1}:${d.lens}`, phase: 'Judge', schema: {
      type: 'object',
      additionalProperties: false,
      required: ['refuted', 'reasoning', 'evidence'],
      properties: {
        refuted: { type: 'boolean' },
        reasoning: { type: 'string' },
        evidence: { type: 'string' },
        recommended_action: { type: 'string' },
      },
    } })
    .then(v => ({ defect: d, verdict: v }))
))

const surviving = judged.filter(Boolean).filter(j => j.verdict && j.verdict.refuted === false)
return {
  lens_summaries: found.map(f => ({ lens: f.key, summary: f.report.verdict_summary })),
  candidate_count: allDefects.length,
  surviving,
  refuted: judged.filter(Boolean).filter(j => j.verdict && j.verdict.refuted)
    .map(j => ({ summary: j.defect.summary, why_refuted: j.verdict.reasoning })),
}
