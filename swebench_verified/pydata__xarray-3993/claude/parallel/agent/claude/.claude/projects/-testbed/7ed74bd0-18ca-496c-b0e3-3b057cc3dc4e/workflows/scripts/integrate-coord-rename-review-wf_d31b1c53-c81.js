export const meta = {
  name: 'integrate-coord-rename-review',
  description: 'Adversarially review the DataArray.integrate dim->coord deprecation diff',
  phases: [
    { title: 'Review', detail: 'parallel lenses over the diff' },
    { title: 'Verify', detail: 'refute each finding by running code' },
  ],
}

const REPO = '/testbed'
const PY = '/opt/miniconda3/envs/testbed/bin/python'

const CONTEXT = `Repo: ${REPO} — the xarray library, unreleased v0.17.0. Python interpreter with deps: ${PY}
(run tests as: cd ${REPO} && ${PY} -m pytest ...). NOTE: plain \`python\` has no numpy — always use ${PY}.

THE TASK BEING REVIEWED (xarray issue GH3993):
\`DataArray.integrate\` took a first arg named \`dim\` while \`Dataset.integrate\` and both
\`.differentiate\` methods take \`coord\`. The inconsistency was fixed by renaming
\`DataArray.integrate\`'s arg \`dim\` -> \`coord\`, keeping \`dim\` as a DEPRECATED keyword-only
arg that emits a FutureWarning, and raising ValueError if both are passed.

THE DIFF UNDER REVIEW: run \`cd ${REPO} && git diff\` to see it. It touches:
  xarray/core/dataarray.py (integrate signature + body + docstring)
  xarray/tests/test_dataset.py (new test_integrate_deprecated_dim_kwarg)
  xarray/tests/test_units.py (dim= -> coord= in a parametrize entry)
  doc/whats-new.rst (new Deprecations section)

`

const FINDINGS_SCHEMA = {
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
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          detail: { type: 'string' },
          repro: { type: 'string', description: 'concrete code/command showing the problem, or empty' },
          fix: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'detail', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is NOT a real problem' },
    reasoning: { type: 'string' },
    evidence: { type: 'string', description: 'the actual command run and its actual output' },
  },
  required: ['refuted', 'reasoning', 'evidence'],
}

const LENSES = [
  {
    key: 'backcompat',
    prompt: `LENS: backwards compatibility. Every pre-existing way of calling \`DataArray.integrate\` must keep
working with IDENTICAL results and (except for \`dim=\`) NO warning. ACTUALLY RUN code with ${PY} to check:
- \`da.integrate("x")\` positionally
- \`da.integrate("x", "D")\` — datetime_unit as 2nd positional (it was the 2nd param before; confirm it still is)
- \`da.integrate(dim="x")\` — must still WORK (not just warn) and give the same answer
- \`da.integrate(("y","x"))\` sequence of coords
- \`da.integrate(datetime_unit="D", dim="time")\`
- What happens with NO argument at all: \`da.integrate()\`. coord now defaults to None. Before the change,
  \`dim\` was REQUIRED so \`da.integrate()\` raised TypeError. Now what happens? Is the resulting error
  comprehensible, or is it a confusing crash deep in Dataset._integrate_one? Judge whether that regression matters.
- Does anything subclass DataArray or call .integrate via getattr/apply_ufunc/pipe in the repo?
Report ONLY real problems.`,
  },
  {
    key: 'deprecation-mechanics',
    prompt: `LENS: deprecation mechanics correctness. Check:
- Warning category (FutureWarning vs DeprecationWarning) against what the rest of xarray/core/ uses for
  user-facing kwarg deprecations. Is FutureWarning right here?
- stacklevel: is the value correct so the warning points at the USER's call site, not inside xarray?
  VERIFY EMPIRICALLY by writing a small script in a temp file that calls da.integrate(dim="x") and printing
  warning.filename/lineno — check it names the user's script and the correct line number, not dataarray.py.
- Is the both-passed ValueError reachable and is the message clear?
- Is the \`if dim is not None and coord is None\` second condition redundant/dead given the guard above? Is that a problem?
- Edge case: what if a user legitimately passes \`coord=None, dim="x"\` explicitly? What about \`dim=None\` explicitly (should NOT warn)? Verify.
- Is making \`dim\` keyword-only correct, or does it break anyone who passed dim positionally? (Before the change \`dim\` WAS the first positional param — so old code \`da.integrate("x")\` passed dim positionally. Now that same call binds to \`coord\`. Confirm this is behaviourally identical and NOT a break.)
Run code to support every claim.`,
  },
  {
    key: 'tests',
    prompt: `LENS: test quality and suite health. Do these:
1. Run: cd ${REPO} && ${PY} -m pytest xarray/tests/test_dataset.py -k "integrate or trapz" -q
2. Run: cd ${REPO} && ${PY} -m pytest xarray/tests/test_units.py -q -k "computation" 2>&1 | tail -5
3. Run: cd ${REPO} && ${PY} -m pytest xarray/tests/test_dataarray.py -q 2>&1 | tail -5
4. Run: cd ${REPO} && ${PY} -m pytest xarray/tests/test_sparse.py -q -k integrate 2>&1 | tail -5
5. Grep the WHOLE repo (including asv_bench/, properties/, doc/) for any remaining call passing \`dim\` to
   integrate that would now emit a FutureWarning in CI.
6. Assess the new test \`test_integrate_deprecated_dim_kwarg\` in xarray/tests/test_dataset.py: is it in the
   right file (it tests DataArray — but note test_integrate for DataArray already lives in test_dataset.py,
   so consistency may favour keeping it there)? Is the \`dask\` parametrization meaningful or dead weight?
   Does it use the repo's assert helpers correctly? Is anything important NOT covered?
7. Check whether the repo has any test that asserts the full set of public method signatures (which might
   need updating), and whether mypy is configured and would complain about \`coord\` defaulting to None while
   typed as \`Union[Hashable, Sequence[Hashable]]\` (not Optional). Run mypy on the file if available.
Report real problems only.`,
  },
  {
    key: 'docs',
    prompt: `LENS: documentation and docstring correctness. Check:
- Does the new docstring RENDER correctly as numpydoc? Specifically the \`.. deprecated:: 0.17.0\` directive
  nested under the \`dim\` parameter description — is that valid numpydoc/RST in this position? Compare with
  how other xarray docstrings mark deprecated parameters (grep for "deprecated::" in xarray/).
- Parameter-doc style consistency: the diff added \`coord: hashable, or a sequence of hashable\` (no space
  before colon) while the next line is \`dim : hashable, ...\` (space before colon). numpydoc wants \`name : type\`.
  Check what Dataset.integrate and DataArray.differentiate use and whether this inconsistency should be fixed.
- Should the docstring summary line "integrate the array with the trapezoidal rule." be capitalized /
  reworded to "Integrate along the given coordinate using the trapezoidal rule."? Check the summary lines
  of neighbouring methods for the house style, and whether Dataset.integrate should be harmonized too.
- Run the doctests: cd ${REPO} && ${PY} -m pytest --doctest-modules xarray/core/dataarray.py -q 2>&1 | tail -5
- Verify the doc/whats-new.rst entry: correct section placement (should Deprecations come after Breaking
  changes and before New Features?), correct blank-line spacing vs neighbouring sections, valid \`:issue:\` role,
  and whether it should ALSO reference a :pull: number. Compare formatting to the v0.16.2 Deprecations section.
- Check doc/computation.rst and doc/api.rst for anything that needs updating.
- Is there any doc that TELLS users to use \`dim\` for integrate?`,
  },
]

const reviewed = await pipeline(
  LENSES,
  (l) => agent(CONTEXT + l.prompt, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  (res, lens) =>
    parallel(
      (res?.findings ?? []).map((f) => () =>
        agent(
          CONTEXT +
            `You are an ADVERSARIAL VERIFIER. A reviewer claims the following problem exists in the diff.
Your job is to REFUTE it. Default to refuted=true unless you can PROVE it real by running code or reading files.

CLAIM: ${f.title} (severity ${f.severity})
FILE: ${f.file}${f.line ? ':' + f.line : ''}
DETAIL: ${f.detail}
SUGGESTED REPRO: ${f.repro || '(none given)'}
PROPOSED FIX: ${f.fix}

Reproduce it concretely with ${PY}. A finding is REFUTED if: it does not actually reproduce, it describes
pre-existing behaviour unchanged by this diff, it is a pure style preference with no house-style rule behind
it, or the "problem" is the intended designed behaviour of a deliberate deprecation. Put the ACTUAL command
and ACTUAL output in \`evidence\`.`,
          { label: `verify:${lens.key}:${f.title.slice(0, 32)}`, phase: 'Verify', schema: VERDICT_SCHEMA }
        ).then((v) => ({ ...v, finding: { ...f, lens: lens.key } }))
      )
    )
)

const all = reviewed.flat().filter(Boolean)
const confirmed = all.filter((v) => !v.refuted)
log(`${all.length} findings reviewed, ${confirmed.length} survived adversarial verification`)

return {
  confirmed: confirmed.map((v) => ({ ...v.finding, why: v.reasoning, evidence: v.evidence })),
  refutedCount: all.length - confirmed.length,
  refutedTitles: all.filter((v) => v.refuted).map((v) => v.finding.title),
}
