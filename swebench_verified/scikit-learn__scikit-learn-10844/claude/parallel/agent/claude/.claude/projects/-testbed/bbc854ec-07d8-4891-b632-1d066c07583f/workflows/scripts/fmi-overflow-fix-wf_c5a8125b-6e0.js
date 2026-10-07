export const meta = {
  name: 'fmi-overflow-fix',
  description: 'Design and adversarially verify the fowlkes_mallows_score integer-overflow fix',
  phases: [
    { title: 'Investigate', detail: 'math bounds, sibling overflow sites, existing tests' },
    { title: 'Verify', detail: 'adversarial refutation of the proposed formula' },
  ],
}

const FILE = '/testbed/sklearn/metrics/cluster/supervised.py'
const PY = '/opt/miniconda3/envs/testbed/bin/python'

const PROPOSAL = [
  'The current last line of fowlkes_mallows_score in ' + FILE + ' is:',
  '    return tk / np.sqrt(pk * qk) if tk != 0. else 0.',
  'where tk, pk, qk are numpy int64 scalars. pk*qk overflows int64 for ~100k samples in few',
  'clusters, silently returning a wrong score (measured: 1.9532862454053506 for two identical',
  'labelings of 100000 samples split into 2 equal clusters, plus a RuntimeWarning).',
  'The proposed fix is:',
  '    return np.sqrt(tk / pk) * np.sqrt(tk / qk) if tk != 0. else 0.',
  'Use ' + PY + ' as the python interpreter (scikit-learn 0.20.dev0 is built there,',
  'importable from /testbed; numpy 1.19.2).',
].join('\n')

phase('Investigate')

const INVESTIGATIONS = [
  {
    key: 'math',
    prompt: PROPOSAL + `

Prove or refute, rigorously and with numeric experiments, that the proposed formula is
mathematically equivalent to the original (in exact arithmetic) for ALL valid inputs.
Specifically establish:
  1. Whether tk <= pk and tk <= qk always hold, given tk = sum_ij n_ij^2 - n,
     pk = sum_j (n_.j)^2 - n, qk = sum_i (n_i.)^2 - n for a contingency table of n samples.
     Give the proof.
  2. Whether tk, pk, qk can ever be negative.
  3. Whether pk or qk can be 0 while tk != 0 (which would make the new code divide by zero
     where the old code did not). Consider degenerate cases: all-singleton clusters,
     a single cluster, n_samples == 0, n_samples == 1.
  4. Floating-point accuracy: is sqrt(tk/pk)*sqrt(tk/qk) more or less accurate than
     tk/sqrt(pk*qk) in float64? Run a numeric sweep over many random contingency tables
     comparing both against a high-precision (Fraction/Decimal/mpmath) reference, and report
     max relative error for each. The old form also computes pk*qk in int64 first, so compare
     against a float64 version of the old form to isolate FP effects from overflow.
  5. Whether the result can exceed 1.0 by floating-point rounding under the new formula.
Report findings as concise bullet points with the actual numbers you measured.
Do NOT edit any files under /testbed; use scratch scripts in /tmp.`,
  },
  {
    key: 'siblings',
    prompt: PROPOSAL + `

Audit ${FILE} (the whole file) and its sibling modules under /testbed/sklearn/metrics/cluster/
for OTHER integer-overflow-prone arithmetic of the same shape: products or sums of large
integer counts (n_samples squared, comb(n,2), contingency-table sums) done in numpy integer
dtype before any float conversion. For each candidate, state the file:line, the expression,
the input scale at which it overflows int64, and whether it is actually reachable. Be
concrete and skeptical: only report sites where you traced the dtype and confirmed integer
arithmetic, ideally by running it. Do NOT edit any files. Report a ranked list.`,
  },
  {
    key: 'tests',
    prompt: PROPOSAL + `

Find every existing test that covers fowlkes_mallows_score in /testbed (grep the whole tree,
including the doctest in the function docstring and any usage in doc/ rst files). List
file:line and what each asserts. Then recommend the precise regression test for this overflow
bug: which file, near which existing test, what inputs so that it overflows int64 without
being slow (runtime well under a second, small memory), and what to assert. Note that a bare
equality assert would not catch a warning-only failure mode, so consider whether the test
should also assert that no RuntimeWarning is raised. Check what warning-assertion helpers
already exist in sklearn.utils.testing in this version and use those idioms.
Write out the exact test function source you recommend. Do NOT edit any files.`,
  },
]

const findings = await pipeline(
  INVESTIGATIONS,
  d => agent(d.prompt, { label: 'investigate:' + d.key, phase: 'Investigate' }),
)

phase('Verify')

const LENSES = [
  ['correctness', 'is there any valid (labels_true, labels_pred) input for which the new formula returns a different or worse answer than the mathematically exact FMI? Try hard to construct one and RUN it.'],
  ['regression', 'does the change alter the return TYPE, the docstring doctest output text, or behaviour at documented edge cases (perfect match -> 1.0, total split -> 0.0, empty input)? Actually run the doctests of the fowlkes_mallows_score docstring against a patched copy, and check the return type is still a plain-printing float.'],
  ['divzero', 'construct an input where the new formula divides by zero or yields nan/inf where the old one did not. Include degenerate inputs: empty arrays, a single sample, one cluster, all singletons, and labelings where pk or qk is zero. RUN each against a patched copy.'],
]

const verdicts = await parallel(LENSES.map(([name, lens]) => () => agent(
  PROPOSAL + `

Prior investigation concluded the following. Do NOT take it on trust:
---
` + findings.filter(Boolean).join('\n\n---\n\n') + `
---

Your job is ADVERSARIAL: try to REFUTE the claim that the proposed one-line fix is safe and
correct, through this specific lens:

  ` + lens + `

Actually execute code: copy the function into a scratch script under /tmp (do NOT edit files
under /testbed), patch the last line, and run the old and new formula side by side on the
inputs you devise. Default to reporting a problem if you are uncertain.
End your response with a line of exactly "VERDICT: SAFE" or
"VERDICT: PROBLEM: <one-line summary>".`,
  { label: 'refute:' + name, phase: 'Verify' },
)))

return {
  investigation: Object.fromEntries(INVESTIGATIONS.map((d, i) => [d.key, findings[i]])),
  refutation: verdicts.filter(Boolean),
}
