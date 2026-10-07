export const meta = {
  name: 'iterative-imputer-fill-value',
  description: 'Add fill_value param to IterativeImputer (incl. np.nan support), verify adversarially',
  phases: [
    { title: 'Recon' },
    { title: 'Implement' },
    { title: 'Verify' },
    { title: 'Repair' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'

const CONTEXT = `
REPO: /testbed — scikit-learn 1.3.dev0 source checkout. Python interpreter (built in-place, MUST use this one):
  ${PY}
Run tests like: cd /testbed && ${PY} -m pytest sklearn/tests/test_impute.py -x -q

TASK (from upstream issue "IterativeImputer has no parameter fill_value"):
Add a \`fill_value\` parameter to sklearn.impute.IterativeImputer, forwarded to the internal
SimpleImputer used for the initial imputation round when \`initial_strategy="constant"\`.
The issue explicitly ALSO requests that \`np.nan\` be allowed as \`fill_value\` (for compatibility
with NaN-native estimators like HistGradientBoosting*).

KEY FACTS ALREADY ESTABLISHED by the lead (do not re-derive, but do verify if cheap):
1. sklearn/impute/_iterative.py::IterativeImputer._initial_imputation currently computes:
     valid_mask = np.flatnonzero(np.logical_not(np.isnan(self.initial_imputer_.statistics_)))
   i.e. it uses NaN-in-statistics_ as the sentinel for "all-missing (empty) feature".
   With strategy="constant", SimpleImputer stores fill_value in statistics_ for EVERY column, so
   if fill_value=np.nan then every column looks "empty" -> valid_mask is empty -> broken shapes.
   => this sentinel logic MUST be replaced by an explicit emptiness computation, e.g. an
      \`self._is_empty_feature = np.all(mask_missing_values, axis=0)\` computed when in_fit=True
      and reused at transform time.
2. SimpleImputer.transform (sklearn/impute/_base.py ~line 564) short-circuits:
     if self.strategy == "constant" or self.keep_empty_features: <keep ALL columns>
   So with initial_strategy="constant", X_filled keeps empty columns even when
   keep_empty_features=False, whereas Xt = X[:, ~is_empty] drops them. The returned X_filled
   must therefore ALSO be column-subset in that case, or shapes disagree downstream
   (_assign_where in fit_transform). Note _initial_imputation returns (Xt, X_filled, ...) and
   fit_transform unpacks them as (X, Xt, ...) — the names swap; X_filled becomes local \`Xt\`.
3. CONFIRMED PRE-EXISTING BUG that this refactor must not preserve: the keep_empty_features=True
   branch does \`mask_missing_values[:, valid_mask] = True\`, marking every entry of every VALID
   (non-empty) feature as missing. Demonstrated: with X=[[1,2,3],[4,nan,6],[10,5,9]] and
   keep_empty_features=True, max_iter=3 -> n_iter_=0 and output 3.5 (mere mean), while
   keep_empty_features=False gives n_iter_=2 and 3.1538... The intent was to mark EMPTY features
   as NOT missing (so they retain the initial imputation and are not iteratively imputed), i.e.
   \`mask_missing_values[:, self._is_empty_feature] = False\`.
4. SimpleImputer already accepts fill_value=np.nan today (isinstance(np.nan, numbers.Real) is True),
   verified working. Its constraint entry is \`"fill_value": "no_validation",  # any object is valid\`.
5. IterativeImputer's keep_empty_features docstring already references \`fill_value\`.
`

const RECON_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'string', description: 'Dense factual findings, with file:line refs and literal command output where relevant.' },
    conventions: { type: 'string', description: 'Exact conventions/snippets the implementer must copy (formats, file paths, naming).' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Concrete pitfalls the implementer must handle.' },
  },
  required: ['findings', 'conventions', 'risks'],
}

phase('Recon')

const recon = await parallel([
  () => agent(`${CONTEXT}

YOUR JOB (recon A — repo conventions for adding a parameter):
Read sklearn/impute/_iterative.py and sklearn/impute/_base.py. Determine EXACTLY:
- where \`fill_value\` must be inserted in IterativeImputer: _parameter_constraints dict, __init__
  signature order (mirror upstream: immediately after initial_strategy), attribute assignment order,
  and the docstring Parameters section position + the exact numpydoc text style used by
  SimpleImputer's fill_value docstring (quote it verbatim) plus the right \`.. versionadded::\`
  directive version for this dev version (check sklearn/__init__.py __version__ and which
  doc/whats_new/v1.*.rst is the in-development changelog).
- the exact whats_new changelog entry format used for |Enhancement| entries in that file for the
  sklearn.impute module: quote 2-3 real neighbouring entries verbatim including indentation,
  :pr:\` \` and :user:\` \` roles, and tell me the exact section heading line to insert under.
  The upstream PR for this feature is 25500 by Thijs van Weezel (github user ValueInvestorThijs).
- whether sklearn/tests/test_impute.py has a docstring/param ordering test, and whether there is a
  common test that asserts every public param appears in _parameter_constraints (name the test).
Report file:line for every insertion point.`, { label: 'recon:conventions', phase: 'Recon', schema: RECON_SCHEMA }),

  () => agent(`${CONTEXT}

YOUR JOB (recon B — empirical behaviour probe). Write throwaway scripts under /tmp (NEVER modify
/testbed source in this phase) and RUN them with ${PY}. Report literal outputs for:
1. IterativeImputer(initial_strategy="constant", max_iter=1) on a matrix WITH one fully-missing
   (empty) column, keep_empty_features False and True. Does it crash? What shape comes out?
   Compare against initial_strategy="mean" on the same data. Note statistics_ and output shape.
2. Same, but ALSO call .transform() on new data afterwards, and .get_feature_names_out().
   Does get_feature_names_out()'s length match transform()'s n columns in the
   constant + empty-column + keep_empty_features=False case? (SimpleImputer keeps all columns for
   constant strategy, so I suspect a mismatch — confirm or refute with output.)
3. Whether a NaN-native estimator can actually be driven by IterativeImputer when the initial fill
   is NaN: monkeypatch nothing — just construct
   IterativeImputer(estimator=HistGradientBoostingRegressor(), initial_strategy="constant") and
   inspect what would happen; specifically confirm HistGradientBoostingRegressor accepts NaN in X
   (fit on data containing NaN) so that a NaN initial fill is usable.
4. Confirm the pre-existing keep_empty_features=True bug in fact 3 of the context, and check
   whether existing tests in sklearn/tests/test_impute.py currently ASSERT the buggy behaviour
   (grep for keep_empty_features tests involving IterativeImputer and read them). This is critical:
   if an existing test encodes the buggy output, say so explicitly and quote the test.
5. Baseline: run \`cd /testbed && ${PY} -m pytest sklearn/tests/test_impute.py -q 2>&1 | tail -5\`
   and report the pass/fail count so we have a pre-change baseline.`, { label: 'recon:empirical', phase: 'Recon', schema: RECON_SCHEMA }),

  () => agent(`${CONTEXT}

YOUR JOB (recon C — blast radius). Search the whole repo (grep) for anything that depends on the
internals being changed:
- other uses of \`initial_imputer_\`, \`statistics_\` + IterativeImputer, \`valid_mask\`,
  \`keep_empty_features\` in impute-related code, docs, and examples.
- doc/modules/impute.rst and any example under examples/impute/ that mentions initial_strategy or
  would need a doc update.
- Does anything subclass IterativeImputer or call _initial_imputation (e.g. tests, other estimators)?
  List every caller with file:line and the exact tuple-unpacking used, so a signature/return change
  cannot silently break a caller.
- Check sklearn/tests/test_common.py / sklearn/utils/estimator_checks.py for checks that would
  exercise a new param (param validation checks, check_estimators_*). Name the test entry points a
  verifier should run for IterativeImputer.
Report precise file:line lists.`, { label: 'recon:blast-radius', phase: 'Recon', schema: RECON_SCHEMA }),
])

const reconText = recon.filter(Boolean).map((r, i) =>
  `### Recon ${['A: conventions', 'B: empirical', 'C: blast radius'][i]}\nFINDINGS:\n${r.findings}\n\nCONVENTIONS:\n${r.conventions}\n\nRISKS:\n${(r.risks || []).map(x => `- ${x}`).join('\n')}`
).join('\n\n')

log(`Recon complete (${recon.filter(Boolean).length}/3 agents reported). Implementing.`)

phase('Implement')

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What was changed, file by file, with line refs.' },
    diff: { type: 'string', description: 'Output of `cd /testbed && git diff`.' },
    testResults: { type: 'string', description: 'Literal tail of the test runs performed.' },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'diff', 'testResults'],
}

const impl = await agent(`${CONTEXT}

RECON REPORTS FROM THREE AGENTS — treat as authoritative unless it contradicts what you see in the
source; the empirical outputs especially are real command output:

${reconText}

YOUR JOB: implement the feature in /testbed. You are the ONLY writer. Make these changes:

A) sklearn/impute/_iterative.py — IterativeImputer:
   1. Add \`"fill_value": "no_validation",  # any object is valid\` to _parameter_constraints.
   2. Add \`fill_value=None\` to __init__ (keyword-only, positioned right after initial_strategy) and
      \`self.fill_value = fill_value\`.
   3. Document it in the class docstring Parameters section, immediately after initial_strategy,
      matching SimpleImputer's fill_value wording, with the correct \`.. versionadded::\` for the
      in-development version. Mention that np.nan is allowed / that for numerical data a numerical
      value is expected. Keep numpydoc-valid formatting (this repo runs a docstring validation test).
   4. In _initial_imputation: pass \`fill_value=self.fill_value\` to the internal SimpleImputer.
   5. Replace the statistics_-NaN sentinel with an explicit emptiness computation. Concretely:
        - when in_fit: \`self._is_empty_feature = np.all(mask_missing_values, axis=0)\`
        - if not self.keep_empty_features: drop empty features from Xt and mask_missing_values;
          AND, because SimpleImputer with strategy="constant" preserves empty features even when
          keep_empty_features=False, also drop them from X_filled in that case (guard on the
          initial strategy being "constant") so all returned arrays stay column-aligned. Add a
          brief comment explaining why, in the surrounding comment style.
        - else (keep_empty_features=True): mark EMPTY features as NOT missing —
          \`mask_missing_values[:, self._is_empty_feature] = False\` — which also fixes the
          confirmed pre-existing bug where valid features were marked fully missing.
      Do NOT leave the old \`valid_mask\` computation behind.
   6. Sanity-check every other consumer of these arrays in fit_transform/transform for shape
      alignment (_assign_where, min/max validation using X.shape[1], _get_ordered_idx).

B) sklearn/impute/_base.py — only if strictly needed. Prefer NOT to touch SimpleImputer behaviour.

C) sklearn/tests/test_impute.py — add tests:
   - fill_value is propagated to initial_imputer_.statistics_ when
     initial_strategy="constant" (use max_iter=0 style so it is a pure initial-imputation check).
   - fill_value=np.nan works end to end and does NOT collapse/drop columns: assert output shape and
     that a NaN-native estimator path is coherent. Also assert the pure initial imputation contains
     NaN where inputs were missing when max_iter=0.
   - fill_value is IGNORED (no crash, mean/median behaviour preserved) for non-constant
     initial_strategy.
   - keep_empty_features True/False x initial_strategy in {"mean","constant"} with a fully-missing
     column: assert output shapes and that the empty column takes 0 (mean) / fill_value (constant).
   - a regression test for the keep_empty_features=True bug: with NO empty feature and
     max_iter>=2, the result must be the iterated result, not the initial imputation
     (i.e. n_iter_ > 0). Use the repo's existing test style, pytest.mark.parametrize, and
     assert_allclose/assert_array_equal from sklearn.utils._testing.
   Follow the file's existing naming/style conventions. If an existing test asserts the OLD buggy
   keep_empty_features behaviour, update it and say so loudly in your summary.

D) doc/whats_new/<in-development>.rst — add the |Enhancement| entry for sklearn.impute in the exact
   neighbouring format, crediting :pr:\`25500\` by :user:\`Thijs van Weezel <ValueInvestorThijs>\`.
   Also add a |Fix| entry for the keep_empty_features correction if the changelog convention
   warrants it.

THEN run and iterate until green:
  cd /testbed && ${PY} -m pytest sklearn/tests/test_impute.py -q
  cd /testbed && ${PY} -m pytest sklearn/tests/test_docstring_parameters.py -q -k impute
  cd /testbed && ${PY} -m pytest "sklearn/tests/test_common.py::test_estimators[IterativeImputer()-check_estimators_overwrite_params]" -q
  cd /testbed && ${PY} -m pytest sklearn/tests/test_common.py -q -k "IterativeImputer" 2>&1 | tail -5
Report the FULL git diff and literal test tails. Do not report success unless the suites pass.`,
  { label: 'implement', phase: 'Implement', schema: IMPL_SCHEMA })

if (!impl) {
  log('Implementation agent failed; aborting.')
  return { error: 'implementation agent returned null' }
}

log('Implementation done. Fanning out adversarial verification.')

phase('Verify')

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['clean', 'issues'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          where: { type: 'string', description: 'file:line' },
          problem: { type: 'string' },
          evidence: { type: 'string', description: 'Literal command output or precise reasoning proving it is real.' },
          fix: { type: 'string' },
        },
        required: ['severity', 'where', 'problem', 'evidence', 'fix'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['verdict', 'issues'],
}

const DIFF_CTX = `${CONTEXT}

THE IMPLEMENTATION UNDER REVIEW (already applied to /testbed working tree):
${impl.summary}

DIFF:
\`\`\`diff
${impl.diff}
\`\`\`

You may read the files directly with \`cd /testbed && git diff\` and run code with ${PY}.
DO NOT EDIT /testbed source files — you are a reviewer. Write scratch scripts to /tmp only.`

const LENSES = [
  {
    key: 'correctness-shapes',
    prompt: `LENS: correctness & array-shape alignment. Try hard to BREAK the change. Exercise, with real
scripts run through ${PY}, the full cartesian product of: initial_strategy in
{mean, median, most_frequent, constant} x fill_value in {None, 0, 100, np.nan} x
keep_empty_features in {True, False} x (data with an empty column / without) x
(fit_transform / fit-then-transform on new data) x max_iter in {0, 1, 3} x
missing_values in {np.nan, -1}. Also test: n_features==1 edge case, all-missing matrix,
sample_posterior=True, add_indicator=True, min_value/max_value arrays, a pandas DataFrame input,
and get_feature_names_out() length vs transform() width in every combination.
Report any exception, silent shape change, or wrong value as an issue with the literal traceback.`,
  },
  {
    key: 'regression-behaviour',
    prompt: `LENS: behavioural regression. The change alters how empty features and mask_missing_values are
computed — code paths shared by ALL initial_strategy values, not just "constant". Prove that
default-parameter behaviour is bit-for-bit unchanged: construct several datasets (with and without
empty columns), and compare outputs of the NEW code against the OLD code. To get the old behaviour,
\`cd /tmp && git -C /testbed stash list\` is NOT available to you — instead reconstruct the old
behaviour by copying the pre-change function body into a standalone /tmp script (get the original
via \`cd /testbed && git show HEAD:sklearn/impute/_iterative.py\`), or by \`git worktree\`-free means:
create /tmp/orig/ with \`cd /testbed && git show HEAD:sklearn/impute/_iterative.py > /tmp/orig_iterative.py\`
and diff behaviour by monkeypatching the old _initial_imputation onto the class. Report ANY output
difference for keep_empty_features=False + non-constant strategies as a blocker (that combination
must be untouched), and characterise the keep_empty_features=True difference as intended-fix or
regression with numbers. Also run the FULL sklearn/tests/test_impute.py and report the tail.`,
  },
  {
    key: 'api-conventions',
    prompt: `LENS: scikit-learn API & docs conventions. Verify: _parameter_constraints entry present and of the
right kind; get_params/set_params round-trip includes fill_value; __init__ stores the param without
mutating it (sklearn convention: no validation/transformation in __init__); docstring is numpydoc
valid with the correct versionadded version and correct Parameters ORDER matching the __init__
signature (this repo has a test enforcing docstring/signature agreement — find and run it);
whats_new entry is in the correct in-development file, correct section, correct :pr:/:user: roles,
alphabetical/positional placement per convention, and rst-valid. Run:
  cd /testbed && ${PY} -m pytest sklearn/tests/test_docstring_parameters.py -q
  cd /testbed && ${PY} -m pytest sklearn/tests/test_public_functions.py -q 2>&1 | tail -3
  cd /testbed && ${PY} -m pytest sklearn/impute -q 2>&1 | tail -3
  cd /testbed && ${PY} -m pytest sklearn/tests/test_common.py -q -k "IterativeImputer" 2>&1 | tail -5
  cd /testbed && ${PY} -m flake8 sklearn/impute/_iterative.py sklearn/tests/test_impute.py 2>&1 | head -20
  cd /testbed && ${PY} -m black --check --diff sklearn/impute/_iterative.py sklearn/tests/test_impute.py 2>&1 | head -40
Report each command's literal result.`,
  },
  {
    key: 'test-quality',
    prompt: `LENS: test quality & issue-requirement coverage. Re-read the original issue text in the context
above. Judge whether the ADDED TESTS would actually fail against the ORIGINAL code (i.e. they test
the new behaviour, not tautologies). For each added test, state whether it is a genuine regression
test and PROVE the key ones fail pre-change: get the original file via
\`cd /testbed && git show HEAD:sklearn/impute/_iterative.py > /tmp/orig_iterative.py\` and reason
precisely (or monkeypatch) about what the old code would do. Flag: tests that assert only that no
exception was raised, missing coverage of the issue's explicit np.nan-as-fill_value request,
missing coverage of fill_value forwarding into initial_imputer_, and any test that would be
flaky/estimator-version-dependent. Also confirm the tests actually run (not skipped) and report
\`cd /testbed && ${PY} -m pytest sklearn/tests/test_impute.py -q -k "fill_value or empty_features" -v 2>&1 | tail -30\`.`,
  },
]

const reviews = await pipeline(
  LENSES,
  lens => agent(`${DIFF_CTX}\n\n${lens.prompt}`, { label: `verify:${lens.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }),
  (review, lens) => {
    const issues = (review?.issues || []).filter(i => i.severity === 'blocker' || i.severity === 'major')
    if (!issues.length) return { lens: lens.key, review, confirmed: [] }
    // Adversarially re-check each serious issue with an independent skeptic.
    return parallel(issues.map(issue => () =>
      agent(`${DIFF_CTX}

A reviewer using the "${lens.key}" lens claims this is a real defect in the change:

WHERE: ${issue.where}
PROBLEM: ${issue.problem}
EVIDENCE THEY GAVE: ${issue.evidence}
PROPOSED FIX: ${issue.fix}

YOUR JOB: try to REFUTE it. Reproduce independently with your own script via ${PY}. Set
refuted=true if the claim is wrong, pre-existing-and-out-of-scope, a reviewer misunderstanding,
already covered elsewhere, or purely stylistic with no behavioural impact. Default to refuted=true
when genuinely uncertain — we only want defects we can demonstrate. If it IS real, give the
minimal reproduction command + output.`,
        {
          label: `refute:${lens.key}`,
          phase: 'Verify',
          schema: {
            type: 'object',
            properties: {
              refuted: { type: 'boolean' },
              reasoning: { type: 'string' },
              reproduction: { type: 'string' },
            },
            required: ['refuted', 'reasoning'],
          },
        })
        .then(v => ({ issue, verdict: v }))
    )).then(checked => ({
      lens: lens.key,
      review,
      confirmed: checked.filter(Boolean).filter(c => c.verdict && c.verdict.refuted === false).map(c => ({ ...c.issue, proof: c.verdict.reproduction })),
    }))
  }
)

const flat = reviews.filter(Boolean)
const confirmedIssues = flat.flatMap(r => r.confirmed || [])
const allNotes = flat.map(r => `[${r.lens}] verdict=${r.review?.verdict} notes: ${r.review?.notes || ''}\n  minor/nits: ${(r.review?.issues || []).filter(i => i.severity === 'minor' || i.severity === 'nit').map(i => `${i.where}: ${i.problem}`).join(' | ') || 'none'}`).join('\n')

log(`Verification: ${confirmedIssues.length} confirmed serious issue(s) after adversarial refutation.`)

phase('Repair')

let repair = null
if (confirmedIssues.length) {
  repair = await agent(`${DIFF_CTX}

Adversarial verification CONFIRMED these defects (each survived an independent refutation attempt):

${confirmedIssues.map((i, n) => `#${n + 1} [${i.severity}] ${i.where}\n  PROBLEM: ${i.problem}\n  EVIDENCE: ${i.evidence}\n  PROOF: ${i.proof || 'see evidence'}\n  SUGGESTED FIX: ${i.fix}`).join('\n\n')}

Reviewer notes (minor items — apply only if clearly correct and low-risk):
${allNotes}

YOUR JOB: you MAY edit /testbed. Fix every confirmed defect with the minimal, convention-respecting
change. Keep the feature intact: fill_value must still be forwarded, np.nan must still work, and
default behaviour must stay unchanged. Then re-run until green:
  cd /testbed && ${PY} -m pytest sklearn/tests/test_impute.py -q
  cd /testbed && ${PY} -m pytest sklearn/tests/test_docstring_parameters.py -q
  cd /testbed && ${PY} -m pytest sklearn/tests/test_common.py -q -k IterativeImputer 2>&1 | tail -5
  cd /testbed && ${PY} -m black --check sklearn/impute/_iterative.py sklearn/tests/test_impute.py
  cd /testbed && ${PY} -m flake8 sklearn/impute/_iterative.py sklearn/tests/test_impute.py
Report what you changed, what you deliberately did NOT change and why, and the literal test tails.`,
    { label: 'repair', phase: 'Repair', schema: IMPL_SCHEMA })
} else {
  log('No confirmed serious issues — running final consolidated check only.')
}

const finalCheck = await agent(`${CONTEXT}

Final gate. Do NOT edit anything. Just run and report, verbatim, the tail of each:
  cd /testbed && ${PY} -m pytest sklearn/impute -q 2>&1 | tail -5
  cd /testbed && ${PY} -m pytest sklearn/tests/test_impute.py -q 2>&1 | tail -5
  cd /testbed && ${PY} -m pytest sklearn/tests/test_docstring_parameters.py -q 2>&1 | tail -5
  cd /testbed && ${PY} -m pytest sklearn/tests/test_common.py -q -k IterativeImputer 2>&1 | tail -5
  cd /testbed && ${PY} -m pytest --doctest-modules sklearn/impute/_iterative.py -q 2>&1 | tail -5
  cd /testbed && ${PY} -m black --check sklearn/impute/_iterative.py sklearn/tests/test_impute.py 2>&1 | tail -3
  cd /testbed && ${PY} -m flake8 sklearn/impute/_iterative.py sklearn/tests/test_impute.py 2>&1 | tail -5
  cd /testbed && git diff --stat
Then run this smoke script and report its output verbatim:
  ${PY} - <<'EOF'
import numpy as np
from sklearn.experimental import enable_iterative_imputer
from sklearn.impute import IterativeImputer
from sklearn.ensemble import HistGradientBoostingRegressor
X = np.array([[1., 2, 3], [4, np.nan, 6], [10, 5, 9]])
for fv in [None, 0, 100, np.nan]:
    it = IterativeImputer(initial_strategy="constant", fill_value=fv, max_iter=0)
    print("fill_value", fv, "->", it.fit_transform(X).ravel(), "stats", it.initial_imputer_.statistics_)
it = IterativeImputer(estimator=HistGradientBoostingRegressor(min_samples_leaf=1),
                      initial_strategy="constant", fill_value=np.nan, max_iter=2, random_state=0)
print("nan-native full run:", it.fit_transform(X).ravel())
print("get_params fill_value:", IterativeImputer(fill_value=5).get_params()["fill_value"])
EOF
Report a final PASS/FAIL judgement based purely on what you observed.`,
  { label: 'final-gate', phase: 'Repair', schema: VERDICT_SCHEMA })

return {
  implementation: (repair && repair.summary) ? `${impl.summary}\n\nREPAIRS:\n${repair.summary}` : impl.summary,
  finalDiff: (repair && repair.diff) ? repair.diff : impl.diff,
  confirmedIssuesFixed: confirmedIssues.map(i => `[${i.severity}] ${i.where}: ${i.problem}`),
  reviewerNotes: allNotes,
  finalGate: finalCheck ? { verdict: finalCheck.verdict, issues: finalCheck.issues, notes: finalCheck.notes } : 'final gate agent returned null',
}
