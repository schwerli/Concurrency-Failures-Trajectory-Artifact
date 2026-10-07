export const meta = {
  name: 'offsettext-fix-review',
  description: 'Adversarially review the offsetText labelcolor fix for correctness and hidden regressions',
  phases: [
    { title: 'Review', detail: 'diverse lenses over the diff' },
    { title: 'Verify', detail: 'refute each finding by running code' },
  ],
}

const REPO = '/testbed'
const PY = '/opt/miniconda3/envs/testbed/bin/python'

const DIFF = `
--- lib/matplotlib/axis.py, XAxis._init (~line 2258) and YAxis._init (~line 2518) ---
-            color=mpl.rcParams['xtick.color'],
+            color=(
+                mpl.rcParams['xtick.labelcolor']
+                if mpl.rcParams['xtick.labelcolor'] != 'inherit'
+                else mpl.rcParams['xtick.color']
+            ),
(and the identical change with 'ytick' in YAxis._init)

--- lib/matplotlib/tests/test_axes.py ---
+ new test_offset_text_rcparam_color and test_offset_text_rcparam_color_inherit (after test_offset_label_color, ~line 6804)
+ one assertion appended to each of test_xtickcolor_is_not_xticklabelcolor and test_ytickcolor_is_not_yticklabelcolor
  (assert ax.{x,y}axis.get_offset_text().get_color() == 'blue')
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
          line: { type: 'number' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          detail: { type: 'string' },
          repro: { type: 'string', description: 'concrete python snippet or test command showing the problem' },
        },
        required: ['title', 'file', 'severity', 'detail', 'repro'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    evidence: { type: 'string', description: 'what you actually RAN and what it output' },
    reasoning: { type: 'string' },
  },
  required: ['refuted', 'evidence', 'reasoning'],
}

phase('Review')

const LENSES = [
  {
    key: 'correctness',
    prompt: `Review this applied change in the matplotlib repo at ${REPO} for CORRECTNESS BUGS.

${DIFF}

Use ${PY} to actually run code. Hunt specifically for:
- Comparing a non-string rcParam value to the string 'inherit'. rcParams['xtick.labelcolor'] is validated by validate_color_or_inherit, which permits RGB/RGBA TUPLES and numpy-ish values. Does \`some_tuple != 'inherit'\` ever raise, or return an ambiguous array truth value? Compare with how Tick.__init__ (axis.py:120-127) does it and with cbook._str_equal. Test a tuple, a numpy array, and a np.str_ value.
- Case sensitivity / whitespace ('Inherit', 'INHERIT').
- Does the change break rcParams['xtick.labelcolor'] = 'none'?
- Any code path where _init() runs before rcParams are set, or where offsetText color is later clobbered (Axis.clear, _reset_visual_defaults, reset_ticks, set_tick_params(reset=True), twinx/twiny, sharex, secondary_axes, colorbar).
Report only real defects with a runnable repro. Empty list is a valid answer.`,
  },
  {
    key: 'regression',
    prompt: `Review this applied change in the matplotlib repo at ${REPO} for HIDDEN REGRESSIONS in rendering.

${DIFF}

Use ${PY} to run tests. Investigate:
- Any image-comparison baseline test that renders offset text, most importantly lib/matplotlib/tests/test_subplots.py::test_subplots_offsettext (png/pdf/svg) and lib/matplotlib/tests/test_axes.py::test_twin_spines. RUN them.
- Any bundled stylesheet in lib/matplotlib/mpl-data/stylelib/ that sets *tick.labelcolor (grep to confirm none do), and confirm every style still yields the pre-change offset-text color. Write a script that loops over ALL styles via plt.style.available, builds a figure with 1e9-scale data, and compares the offsetText color before vs after the fix (you can simulate 'before' as rcParams['*tick.color']).
- Run the broader suites: test_axes.py, test_subplots.py, test_figure.py, test_constrainedlayout.py, test_tightlayout.py, test_polar.py, test_colorbar.py, test_backend_svg.py, test_backend_pdf.py, and lib/mpl_toolkits. Report ONLY failures that are caused by this diff — verify any failure is not pre-existing by 'git stash'-ing lib/matplotlib/axis.py and re-running. Restore with 'git stash pop' afterwards and CONFIRM the diff is restored with 'git diff --stat'.
Report only real regressions with evidence. Empty list is valid.`,
  },
  {
    key: 'consistency',
    prompt: `Review this applied change in the matplotlib repo at ${REPO} for SEMANTIC CONSISTENCY and COMPLETENESS.

${DIFF}

Investigate whether the fix leaves user-visible INCONSISTENCIES that a matplotlib maintainer would flag as "you fixed half of it":
- Does the offset text now agree with tick labels in every reachable configuration? Enumerate combinations of xtick.color / xtick.labelcolor / text.color and check with ${PY}.
- twinx()/twiny() and secondary_xaxis/secondary_yaxis: does the secondary axis's offset text pick up labelcolor? Test it.
- Colorbar long axis offset text: test with 1e6-scale data.
- mplot3d: all three Axis3D subclass maxis.XAxis, so y/z offset text resolves against XTICK rcParams. Confirm empirically whether this is PRE-EXISTING (test on a stashed axis.py) or newly introduced. This matters — if pre-existing, it is out of scope; if newly introduced, it is a bug in this diff.
- Is 'inherit' the ONLY sentinel? Check rcsetup.validate_color_or_inherit.
Report inconsistencies actually CAUSED or LEFT UNFIXED-but-newly-visible by this diff. Distinguish clearly between pre-existing and new. Empty list is valid.`,
  },
  {
    key: 'test-quality',
    prompt: `Review the TEST additions of this change in the matplotlib repo at ${REPO}.

${DIFF}

Read lib/matplotlib/tests/test_axes.py around lines 6796-6835 and 7810-7840. Evaluate:
- Do the new tests leak rcParams into other tests? Check lib/matplotlib/conftest.py and the mpl_test_settings fixture — is direct plt.rcParams.update() safe here, and is it consistent with neighbouring tests? Prove it by running the new tests together with an unrelated test that depends on default tick colors, in one process, in both orders.
- Is test_offset_text_rcparam_color_inherit actually meaningful (does it fail if the 'else' branch is removed)? PROVE this by temporarily editing axis.py to drop the fallback, running the test, then REVERTING the edit exactly. Confirm with 'git diff --stat' that only the intended change remains.
- Are the tests redundant with the assertions added to test_{x,y}tickcolor_is_not_{x,y}ticklabelcolor? Recommend keeping or trimming.
- Style/flake8 conformance (max line length per ${REPO}/.flake8), naming, and whether 'fig' is unused (flake8 does not flag it, but neighbours use 'fig, ax = plt.subplots()' too — check consistency).
Run ${PY} -m flake8 on the test file and report ONLY issues on the added lines.
Report concrete problems. Empty list is valid.`,
  },
]

const reviewed = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS, effort: 'high' }),
  (res, lens) => {
    if (!res || !res.findings || !res.findings.length) return []
    return parallel(res.findings.map(f => () =>
      agent(
        `You are an adversarial verifier in the matplotlib repo at ${REPO}. Use ${PY} to RUN code — do not reason from reading alone.

A reviewer claims this defect exists in an applied change:

TITLE: ${f.title}
FILE: ${f.file}${f.line ? ':' + f.line : ''}
SEVERITY: ${f.severity}
DETAIL: ${f.detail}
CLAIMED REPRO: ${f.repro}

The applied change:
${DIFF}

Your job is to REFUTE this claim. Actually execute the repro. A claim is refuted if:
- the repro does not reproduce, OR
- the behavior is PRE-EXISTING (verify by 'git stash push lib/matplotlib/axis.py', re-running, then 'git stash pop' — you MUST restore and confirm with 'git diff --stat' showing both files still modified), OR
- it is a style nit with no behavioral impact, OR
- it describes intended, documented behavior.

Default to refuted=true when uncertain. In 'evidence', quote the exact commands you ran and their real output. CRITICAL: leave the working tree exactly as you found it (lib/matplotlib/axis.py and lib/matplotlib/tests/test_axes.py both modified).`,
        { label: `verify:${lens.key}:${f.title.slice(0, 30)}`, phase: 'Verify', schema: VERDICT, effort: 'high' }
      ).then(v => ({ ...f, lens: lens.key, verdict: v }))
    ))
  }
)

const all = reviewed.flat().filter(Boolean)
const confirmed = all.filter(f => f.verdict && !f.verdict.refuted)
log(`${all.length} raw findings, ${confirmed.length} survived refutation`)

return { confirmed, refuted: all.filter(f => f.verdict && f.verdict.refuted).map(f => ({ title: f.title, why: f.verdict.reasoning })) }
