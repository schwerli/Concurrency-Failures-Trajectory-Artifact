export const meta = {
  name: 'coarsen-construct-coords-investigate',
  description: 'Investigate Coarsen.construct coord/index handling in xarray and synthesize a fix plan',
  phases: [
    { title: 'Investigate', detail: 'parallel probes: code path, index handling, test/whatsnew conventions, sibling APIs' },
    { title: 'Synthesize', detail: 'merge findings into one concrete fix + test plan' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'
const CTX = `
Repo: /testbed (xarray, version 2022.10.1.dev, git branch main). Working python interpreter: ${PY}
(plain \`python\`/\`python3\` on PATH has NO numpy — always use ${PY}).

The bug under investigation (GitHub issue): \`ds.coarsen(...).construct(...)\` demotes non-dimensional
coordinates to data variables. Reproducer:

    da = xr.DataArray(np.arange(24), dims=["time"])
    da = da.assign_coords(day=365 * da)
    ds = da.to_dataset(name="T")
    ds.coarsen(time=12).construct(time=("year", "month"))
    # -> "day" appears under "Data variables", not "Coordinates"

Relevant code: xarray/core/rolling.py, class Coarsen.construct (~line 880-980). The suspect line is
    should_be_coords = set(window_dim) & set(self.obj.coords)
    result = reshaped.set_coords(should_be_coords)

Expected behaviour: every variable that was a coordinate on the input object is still a coordinate on
the output. Do NOT edit any files — this is a read/experiment-only investigation. Run experiments with
${PY} -c '...' or heredocs in /tmp. Report concrete observed output, not speculation.
`

const REPORT = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'recommendation', 'evidence'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'evidence'],
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'exact command run + observed output excerpt' },
          file: { type: 'string' },
          line: { type: 'integer' },
        },
      },
    },
    recommendation: { type: 'string', description: 'concrete code / test recommendation with exact snippets' },
    evidence: { type: 'string', description: 'anything else the implementer must know, incl. gotchas' },
  },
}

const PROBES = [
  {
    key: 'codepath',
    prompt: `${CTX}

YOUR PROBE — exact semantics of the current implementation.
Read xarray/core/rolling.py Coarsen.construct end to end. Then empirically determine, for BOTH a Dataset
and a DataArray input, what happens to each of these categories of variable:
  1. data variables along a coarsened dim
  2. data variables NOT along a coarsened dim
  3. dimension coordinates along a coarsened dim (e.g. coords={"time": ...} while coarsening time)
  4. dimension coordinates NOT along a coarsened dim (e.g. a "y" index coord while coarsening time/x)
  5. non-dimension coordinates along a coarsened dim (the bug: "day")
  6. non-dimension coordinates NOT along a coarsened dim (scalar coords, and coords on an un-coarsened dim)
  7. scalar (0-d) coordinates
For each: is it a coord or data var in the output? Does the output have an *index* for it
(check \`result.xindexes\`/\`result.indexes\`)? Explain exactly why, tracing the code (note that
\`reshaped[key] = var\` goes through Dataset.__setitem__, and that the DataArray path round-trips
through _to_temp_dataset/_from_temp_dataset — explain why the DataArray path appears to preserve "day"
but the Dataset path does not).
Also check: what does \`set(self.obj.coords)\` return for a DataArray vs Dataset, and is \`self.obj\`
for a DataArrayCoarsen a DataArray? Report a precise table of behaviours.`,
  },
  {
    key: 'indexes',
    prompt: `${CTX}

YOUR PROBE — index preservation and MultiIndex/edge cases.
Empirically test whether Coarsen.construct currently preserves indexes correctly, and whether the
obvious fix (\`should_be_coords = set(self.obj.coords)\` i.e. re-promote ALL former coords) would
introduce problems. Specifically test today's behaviour and reason about post-fix behaviour for:
  - an un-coarsened dimension coordinate: does \`.xindexes\` contain it after construct? Compare to
    \`ds.isel(...)\`-style expectations. Is an index silently LOST today?
  - a coarsened dimension coordinate (now 2-D): should there be an index? (a 2-D var cannot be an index)
  - a pandas MultiIndex coordinate on an un-coarsened dim (\`ds.stack\`) — does construct survive?
    what about a MultiIndex on a COARSENED dim?
  - a MultiIndex level name being passed to set_coords — does Dataset.set_coords accept level names or
    raise? (relevant if we widen should_be_coords)
  - boundary="trim"/"pad" combined with coords
  - a DataArray whose .name collides with a coord name, and a DataArray with a scalar coord
Then state clearly which of these are pre-existing bugs out of scope for this fix, and which the fix
must not regress. Include the exact reproducer snippets and outputs.`,
  },
  {
    key: 'conventions',
    prompt: `${CTX}

YOUR PROBE — tests + repo conventions.
1. Read xarray/tests/test_coarsen.py fully. Report: how test_coarsen_construct is structured
   (line numbers), what fixtures/imports exist at the top of the file (e.g. \`Dataset\`, \`assert_identical\`,
   \`raise_if_dask_computes\`, \`has_dask\`), and exactly where/how a new test for this bug should be added
   so it matches the file's idiom (parametrized over dask? use of assert_identical?).
   Note the existing test uses coords={"time":..., "y":...} — explain what the existing \`expected\`
   asserts about which variables are coords, and whether adding non-dim coords to that same fixture
   would break the existing assertions.
2. Read doc/whatsnew.rst: report the exact current unreleased section heading structure and the last few
   "Bug fixes" entries verbatim (with line numbers) so a new entry can be added in the identical style,
   including the contributor-link format. Find the GitHub issue/PR number convention used.
3. Search the repo for any other tests that call \`.coarsen(...).construct(\` (e.g. test_dataset.py,
   test_units.py, doc/*.rst, xarray/core/rolling.py docstrings) and list every call site that a change to
   coord promotion could affect. Note especially any doctest in rolling.py whose printed output would
   change if more variables become coords.`,
  },
  {
    key: 'siblings',
    prompt: `${CTX}

YOUR PROBE — how sibling APIs handle this, to match idiom.
Read xarray/core/rolling.py in full (DataArrayRolling.construct ~line 291, DatasetRolling.construct
~line 723, Coarsen/DataArrayCoarsen/DatasetCoarsen._reduce/_dataset_implementation and the
\`coord_func\` machinery). Report how each of them decides what stays a coordinate, quoting code with
line numbers. Compare with \`Dataset.coarsen(...).mean()\` — does the *reduce* path keep non-dim coords
as coords? (test it empirically: does \`ds.coarsen(time=12).mean()\` keep "day" a coord?)
Also look at how other reshaping methods in xarray/core/dataset.py (e.g. \`coarsen_reshape\`,
\`_replace\`, \`set_coords\`, and how \`Dataset.stack\`/\`unstack\` re-promote coords) express "keep the same
set of coords". Recommend the most idiomatic one-or-two-line expression for the fix, and say whether
building the result via \`obj._replace_with_new_dims\`/\`_replace\` + explicit coord_names would be better
than \`reshaped.set_coords(...)\`. Give the exact code you'd write.`,
  },
]

phase('Investigate')
const probes = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Investigate', schema: REPORT })
))

const named = PROBES.map((p, i) => ({ key: p.key, report: probes[i] })).filter(x => x.report)
log(`${named.length}/${PROBES.length} probes returned`)

phase('Synthesize')
const synthesis = await agent(`${CTX}

Four parallel investigators probed this bug. Their structured reports:

${named.map(n => `### probe:${n.key}\n${JSON.stringify(n.report, null, 2)}`).join('\n\n')}

Your job: produce THE implementation plan for the fix. You may re-verify any claim you doubt by running
${PY} yourself (still do NOT edit repo files). Deliver:
  1. The exact replacement code for the \`should_be_coords\` / \`set_coords\` block in
     xarray/core/rolling.py Coarsen.construct, with surrounding context lines so it can be applied as an
     exact-match edit. Handle the DataArray path correctly.
  2. Whether any additional change is needed to preserve indexes for un-coarsened dimension coordinates
     (state whether that is in scope; if a one-line addition fixes it without risk, include it).
  3. The exact test code to add to xarray/tests/test_coarsen.py (matching file idiom, with the correct
     imports already present), covering: non-dim coord along coarsened dim, non-dim coord on an
     un-coarsened dim, scalar coord, dim coord on coarsened dim, and the DataArray path. Say whether to
     extend test_coarsen_construct's fixture or add a new test function, and justify.
  4. The exact doc/whatsnew.rst entry text and where it goes.
  5. Any risk of breaking existing tests, and the precise pytest command(s) to run to prove it.
Flag disagreements between probes explicitly and resolve them with evidence.`,
  { label: 'synthesize-plan', phase: 'Synthesize', schema: {
    type: 'object',
    additionalProperties: false,
    required: ['fix_code', 'index_note', 'test_code', 'whatsnew', 'risks', 'commands'],
    properties: {
      fix_code: { type: 'string' },
      index_note: { type: 'string' },
      test_code: { type: 'string' },
      whatsnew: { type: 'string' },
      risks: { type: 'string' },
      commands: { type: 'array', items: { type: 'string' } },
      disagreements: { type: 'string' },
    },
  } })

return { synthesis, probes: named }
