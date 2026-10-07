export const meta = {
  name: 'mlab-window-correction-analysis',
  description: 'Exhaustively analyze the mlab._spectral_helper window-normalization fix (drop np.abs) before implementing',
  phases: [
    { title: 'Investigate', detail: 'parallel lenses: math/scipy reference, consumers, tests, edge cases' },
    { title: 'Verify', detail: 'adversarially refute each proposed change' },
    { title: 'Synthesize', detail: 'merge into one implementation plan' },
  ],
}

const REPO = '/testbed'
const PY = '/opt/miniconda3/envs/testbed/bin/python'

const CONTEXT = `
Repo: ${REPO} (matplotlib, branch main, dev version 3.7.0.dev).
Python with matplotlib installed in-place (editable): ${PY}. NOTE: scipy is NOT installed in this env.
Tests: ${REPO}/lib/matplotlib/tests/test_mlab.py ; run with: ${PY} -m pytest <file> -q

Bug report being fixed:
  "Windows correction is not correct in mlab._spectral_helper" — the np.abs() around the window
  in the window-normalization terms is not needed and gives wrong results for windows with negative
  values (e.g. scipy.signal.windows.flattop). Reference: scipy's _spectral_helper does
      if scaling == 'density': scale = 1.0 / (fs * (win*win).sum())
      elif scaling == 'spectrum': scale = 1.0 / win.sum()**2

Current code in ${REPO}/lib/matplotlib/mlab.py (inside _spectral_helper), the 4 sites:
  L398  elif mode == 'magnitude':   result = np.abs(result) / np.abs(window).sum()
  L403  elif mode == 'complex':     result /= np.abs(window).sum()
  L427      (psd, scale_by_freq=True)   result /= (np.abs(window)**2).sum()
  L430      (psd, scale_by_freq=False)  result /= np.abs(window).sum()**2

Proposed patch (PLAN):
  L398 -> result = np.abs(result) / window.sum()
  L403 -> result /= window.sum()
  L427 -> result /= (window**2).sum()
  L430 -> result /= window.sum()**2
  Plus: in test_mlab.py L618 and L665, "(np.abs(windowVals)**2).sum()" -> "(windowVals**2).sum()"
  Plus: a new regression test using a window with negative values (flattop), WITHOUT importing scipy
  (scipy is unavailable), asserting matplotlib's psd matches an analytically/independently computed
  reference so the np.abs regression would be caught.

You may read files and RUN code/tests with ${PY}. Do NOT edit any repo file — analysis only.
Return findings as data, terse, concrete, with file:line references.
`

phase('Investigate')

const LENSES = [
  {
    key: 'math',
    prompt: `${CONTEXT}
LENS: signal-processing math correctness.
Derive, from first principles AND from scipy's reference implementation, the correct window
normalization for each of the 4 sites: psd/density (scale_by_freq=True), psd/spectrum
(scale_by_freq=False), magnitude spectrum, complex spectrum.
Answer precisely:
 1. For each site, is the PLAN's replacement the mathematically correct normalization? Cite the
    physical reasoning (coherent gain sum(w) vs. noise-power gain sum(w^2), Bendat & Piersol 11.5.2,
    scipy's density/spectrum scalings).
 2. Site L427: (np.abs(window)**2).sum() vs (window**2).sum() — for REAL windows these are
    identical. Does the change matter at all? Under what dtype could they differ (complex-dtype
    window arising from window(np.ones(NFFT, x.dtype)) when x is complex)? Which is more defensible?
 3. Empirically demonstrate the bug: build a flattop window with numpy only (no scipy — use the
    standard flattop coefficients), and show current-code vs patched-code normalization factors and
    the resulting error in a psd of a known-amplitude sinusoid. Give numbers.
 4. Should magnitude/complex spectra really divide by window.sum() (coherent gain) — verify against
    what matplotlib documents and what a unit-amplitude sinusoid test implies. Numbers, please.
Report: per-site verdict (correct/incorrect/no-op), the numeric demonstration, and any site where
the PLAN is WRONG or incomplete.`,
  },
  {
    key: 'consumers',
    prompt: `${CONTEXT}
LENS: blast radius / consumers.
Enumerate EVERY caller and consumer of _spectral_helper and of these scalings in the repo:
mlab.psd/csd/cohere/specgram/complex_spectrum/magnitude_spectrum/angle_spectrum/phase_spectrum,
Axes.psd/csd/cohere/specgram/magnitude_spectrum/..., and any docs/tutorials/examples that document
the window normalization or the "np.abs(window)" behavior.
Answer:
 1. Which public APIs change numerically for a window with negative values? Which are unaffected?
 2. Does dropping np.abs introduce a dtype/typing hazard? Specifically: (a) window can be a
    complex-dtype array when x is complex — does "result /= window.sum()" or
    "result /= (window**2).sum()" break in-place division (numpy casting error) for any mode?
    RUN code to prove it for every mode ('psd' with scale_by_freq True/False, 'complex',
    'magnitude', 'angle', 'phase') and for real AND complex input x, onesided AND twosided.
    (b) can window arrive as a python list / non-ndarray such that ".sum()" fails where
    "np.abs(window).sum()" worked? Trace lines 376-384 of mlab.py and prove it by running code.
 3. Is a documentation/API-change note needed (doc/api/next_api_changes/behavior/*.rst)? Look at how
    sibling behaviour-change notes are written in this repo and give an exact filename + content
    suggestion if warranted.
Report concrete file:line lists and the empirical dtype results.`,
  },
  {
    key: 'tests',
    prompt: `${CONTEXT}
LENS: test coverage.
 1. Inventory every test in ${REPO}/lib/matplotlib/tests/test_mlab.py (and elsewhere, e.g.
    test_axes.py) that exercises the window normalization; state for each whether the PLAN's patch
    changes its outcome (it should NOT, since all use non-negative windows: hanning/ones/none).
    Run the relevant subset now with ${PY} -m pytest to get the BASELINE (pre-patch) status.
 2. Design the strongest possible regression test that FAILS on current code and PASSES after the
    patch, with NO scipy dependency. Give complete, runnable pytest code. Prefer testing psd of a
    signal windowed with a flattop-like window (negative lobes) against an independently computed
    expected value. Show the actual numbers you measured for current vs expected so the assertion
    tolerance is justified. Also state where in the file it belongs (class TestSpectral is
    parametrized — check whether a module-level function is better).
 3. Also propose (with code) a test for magnitude/complex spectrum normalization with a
    negative-valued window if it adds value, or explain why it is redundant.
Report: baseline pytest output summary, the inventory table, and the final test code you verified
actually fails pre-patch (you can verify by monkeypatching/simulating the math in a scratch script
outside the repo, e.g. under /tmp, since you must not edit repo files).`,
  },
  {
    key: 'edge',
    prompt: `${CONTEXT}
LENS: adversarial edge cases — try to find a case where dropping np.abs makes things WORSE.
Consider and empirically test: window that sums to ~0 (division by zero / inf) e.g. a
zero-mean window or np.array([1,-1,1,-1,...]); complex-dtype windows; window_none/window_hanning on
complex input; NFFT=1; scale_by_freq True vs False; twosided vs onesided; mode='complex' phase
correctness (does dividing by a possibly-negative real number flip the sign/phase, and is that the
desired convention? compare to scipy/numpy fft convention); csd/cohere paths; specgram.
Answer: list each hazard, whether it is NEW (introduced by the patch) or PRE-EXISTING, its severity,
and whether the PLAN should guard against it (e.g. warn/raise on window.sum()==0) or leave it alone
because scipy behaves the same way. Prove claims by running code with ${PY}.
Be skeptical, but do not invent hazards: verify each numerically.`,
  },
]

const findings = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `lens:${l.key}`, phase: 'Investigate' })
    .then(r => ({ lens: l.key, report: r }))
))

const good = findings.filter(Boolean)
log(`${good.length}/${LENSES.length} lenses reported`)

phase('Verify')

const VERDICT = {
  type: 'object',
  properties: {
    site: { type: 'string' },
    planIsCorrect: { type: 'boolean' },
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    correctedRecommendation: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['site', 'planIsCorrect', 'refuted', 'reasoning', 'correctedRecommendation'],
}

const SITES = [
  { key: 'L398-magnitude', desc: "mode=='magnitude': np.abs(result)/np.abs(window).sum() -> np.abs(result)/window.sum()" },
  { key: 'L403-complex', desc: "mode=='complex': result /= np.abs(window).sum() -> result /= window.sum()" },
  { key: 'L427-density', desc: "psd scale_by_freq=True: result /= (np.abs(window)**2).sum() -> result /= (window**2).sum()" },
  { key: 'L430-spectrum', desc: "psd scale_by_freq=False: result /= np.abs(window).sum()**2 -> result /= window.sum()**2" },
]

const digest = good.map(f => `### LENS ${f.lens}\n${f.report}`).join('\n\n')

const verdicts = await parallel(SITES.map(s => () =>
  agent(`${CONTEXT}

Prior investigation reports from four independent lenses:
${digest}

YOUR JOB: adversarially REFUTE the proposed change for THIS ONE SITE:
  ${s.key}: ${s.desc}

Try hard to show the change is wrong, incomplete, or harmful. Default to refuted=true only if you
find real evidence. Verify by RUNNING code with ${PY} (you may write scratch files under /tmp; do
NOT edit the repo). Check the claim against scipy's documented scalings and against a numerically
independent computation (hand-rolled DFT + windowing in numpy).
Then give a final verdict.`,
    { label: `verify:${s.key}`, phase: 'Verify', schema: VERDICT, effort: 'high' })
))

phase('Synthesize')

const plan = await agent(`${CONTEXT}

Four investigation reports:
${digest}

Adversarial per-site verdicts (JSON):
${JSON.stringify(verdicts.filter(Boolean), null, 2)}

Produce the FINAL implementation plan as a precise, unambiguous spec for the engineer who will apply
it. Include:
 1. The exact edits to lib/matplotlib/mlab.py (old line -> new line, with line numbers).
 2. The exact edits to lib/matplotlib/tests/test_mlab.py (including full code for any NEW regression
    test, verified to be scipy-free and to fail pre-patch / pass post-patch, placed at a stated
    location in the file).
 3. Whether an api-change note file is warranted; if yes, exact path + exact content.
 4. Anything explicitly NOT to do, and why (e.g. hazards that are pre-existing, or guards that would
    diverge from scipy).
 5. The exact pytest command(s) to validate.
Be decisive. No hedging, no options menus.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' })

return { plan, verdicts: verdicts.filter(Boolean) }
