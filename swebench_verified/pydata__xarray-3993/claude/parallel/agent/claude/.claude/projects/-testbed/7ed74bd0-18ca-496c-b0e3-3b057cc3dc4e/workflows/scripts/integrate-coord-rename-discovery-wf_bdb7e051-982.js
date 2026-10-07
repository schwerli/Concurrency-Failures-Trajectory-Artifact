export const meta = {
  name: 'integrate-coord-rename-discovery',
  description: 'Discover every site to change for renaming DataArray.integrate dim->coord with deprecation',
  phases: [
    { title: 'Discover', detail: 'parallel sweeps: source, tests, docs, deprecation conventions' },
    { title: 'Synthesize', detail: 'merge into one authoritative change list' },
  ],
}

const REPO = '/testbed'

const SWEEP_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          current: { type: 'string', description: 'the current code/text verbatim' },
          needsChange: { type: 'boolean' },
          why: { type: 'string' },
          suggested: { type: 'string', description: 'suggested replacement, or empty if no change' },
        },
        required: ['file', 'line', 'current', 'needsChange', 'why'],
      },
    },
    notes: { type: 'string', description: 'anything else the implementer must know' },
  },
  required: ['findings', 'notes'],
}

phase('Discover')

const task = `Repo: ${REPO} (the xarray library, dev version leading to v0.17.0).

CONTEXT — the change being made:
\`DataArray.integrate\` currently takes a first positional/keyword arg named \`dim\`, while
\`Dataset.integrate\` takes \`coord\`, and both \`.differentiate\` methods take \`coord\`.
This inconsistency is being fixed: \`DataArray.integrate\`'s argument is being renamed
\`dim\` -> \`coord\`, keeping \`dim\` working as a DEPRECATED keyword-only argument that emits a
FutureWarning, and raising ValueError if both are passed.
Relevant existing code: xarray/core/dataarray.py:3483 (integrate), xarray/core/dataset.py:5966 (integrate).

YOUR SPECIFIC SWEEP:
`

const SWEEPS = [
  {
    key: 'source',
    prompt: `Sweep ALL non-test library source under ${REPO}/xarray/ (core/, plot/, backends/, coding/, everything except xarray/tests/) plus any top-level scripts, asv_bench/, and properties/.
Find every place that references \`integrate\` as a method/argument, or passes/forwards a \`dim\` argument into an integrate call, or that would need to change because of the rename. Include:
- the signature and body of DataArray.integrate and Dataset.integrate (quote them fully in \`current\`)
- any internal callers or forwarders
- any place that must import \`warnings\` (report whether \`warnings\` is already imported in xarray/core/dataarray.py, with the line number)
- typing/overload stubs, __all__ lists, or generated-method machinery touching integrate
Also check whether \`Dataset.integrate\`'s \`coord\` handling accepts a sequence, and how it validates. Report the exact current signatures verbatim.`,
  },
  {
    key: 'tests',
    prompt: `Sweep ALL tests under ${REPO}/xarray/tests/ (and ${REPO}/properties/ if present).
Find every call to \`.integrate(\` anywhere, and report for each whether it passes the argument positionally or as \`dim=\`/\`coord=\`. Any test passing \`dim=\` will start emitting a FutureWarning and may fail under -W error, so it must be updated to \`coord=\`.
Pay special attention to xarray/tests/test_units.py (there are integrate entries around lines 3684 and 5186) and xarray/tests/test_dataset.py test_integrate (~line 6555) and xarray/tests/test_sparse.py (~line 353).
Also report: where the best place is to add NEW tests asserting (a) FutureWarning when \`dim=\` is used, (b) ValueError when both \`dim=\` and \`coord=\` are passed, (c) that \`dim=\` still produces the correct result. Quote the surrounding test function so the implementer knows the local style (pytest.warns / pytest.raises idioms used in this repo).
Also report whether the test suite runs with warnings-as-errors (check setup.cfg, pytest.ini, pyproject.toml for filterwarnings).`,
  },
  {
    key: 'docs',
    prompt: `Sweep ALL documentation under ${REPO}/doc/ plus every docstring in ${REPO}/xarray/ that mentions integrate or differentiate.
Report:
- doc/computation.rst integrate/differentiate examples (~line 390-415) and whether they use positional args
- doc/api.rst entries for integrate
- doc/whats-new.rst: quote the EXACT current top unreleased section structure verbatim (the version header, and the exact names/order of the subsection headings such as "Breaking changes", "Deprecations", "New Features", "Bug fixes", "Documentation", "Internal Changes"). State clearly whether a "Deprecations" section already exists in the unreleased section, and if not, exactly where it should be inserted and what underline character/length the repo uses.
- What version number the unreleased section is (needed to pick the removal-target version for the deprecation message).
- The exact formatting convention this repo uses for whats-new entries: how :py:meth:, :issue:, :pull: roles and the "By \`Name <url>\`_." attribution line are written. Quote 2-3 real examples verbatim.
- The docstrings of Dataset.integrate and Dataset.differentiate and DataArray.differentiate — note any wording that should be harmonized (e.g. "integrate the array with the trapezoidal rule" vs a clearer "Integrate along the given coordinate using the trapezoidal rule"), and note the parameter-doc formatting style (\`coord : str\` vs \`coord: str\`).
- Check doc/whats-new.rst for whether there's an existing entry mentioning this integrate/coord issue already.`,
  },
  {
    key: 'conventions',
    prompt: `Determine this repo's ESTABLISHED CONVENTION for deprecating/renaming a keyword argument.
Search ${REPO}/xarray/ for existing examples of a renamed-or-deprecated keyword argument, e.g.:
- xarray/core/utils.py \`alias\` / \`alias_message\` / \`alias_warning\` helpers (read them; say whether they fit renaming a kwarg, or only whole functions)
- xarray/core/computation.py around lines 1060-1080
- xarray/core/dataset.py around lines 4040-4075, 1917, 6920-6990
- xarray/core/rolling.py:96, xarray/core/accessor_dt.py:379, xarray/core/variable.py:1055
For each, quote the code verbatim and state: warning category used (FutureWarning vs DeprecationWarning vs PendingDeprecationWarning), whether stacklevel is set, whether the message names the removal version, and whether the old arg is made keyword-only (\`*,\`) in the signature.
Then give a clear recommendation for the exact implementation shape for \`DataArray.integrate\`: signature, both-passed error, warning text and category. Note that the new \`coord\` arg must be able to be passed POSITIONALLY (existing code and docs call \`da.integrate("x")\`), and that \`datetime_unit\` is currently the 2nd positional parameter and must stay compatible.
Also report: does the repo use \`stacklevel=2\` consistently? Is there a \`filterwarnings\` config that turns FutureWarning into an error during tests?`,
  },
]

const sweeps = await parallel(
  SWEEPS.map((s) => () =>
    agent(task + s.prompt, { label: `sweep:${s.key}`, phase: 'Discover', schema: SWEEP_SCHEMA })
      .then((r) => ({ key: s.key, ...r }))
  )
)

phase('Synthesize')

const ok = sweeps.filter(Boolean)

const plan = await agent(
  `You are consolidating four parallel discovery sweeps of the xarray repo at ${REPO} into ONE authoritative,
de-duplicated change list for this task:

Rename \`DataArray.integrate\`'s \`dim\` argument to \`coord\` (matching \`Dataset.integrate\` and both
\`.differentiate\` methods), keeping \`dim\` as a deprecated keyword-only arg that emits a FutureWarning,
and raising ValueError if both are given. Include tests, docs, and a whats-new entry.

SWEEP RESULTS (JSON):
${JSON.stringify(ok, null, 2)}

Verify anything ambiguous by reading the actual files yourself — do not trust the sweeps blindly.
In particular CONFIRM by reading the files: (1) whether \`warnings\` is imported in xarray/core/dataarray.py,
(2) the exact current text of the unreleased whats-new section and whether a "Deprecations" heading exists,
(3) every test file line that passes \`dim=\` to integrate.

Return a precise, ordered, file-by-file implementation plan. For each edit give the file path, the anchor
(exact existing text to match), and the exact replacement text. Be concrete enough that an implementer can
apply it without re-deriving anything. Flag any risk of breaking existing callers.`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return { plan, sweeps: ok }
