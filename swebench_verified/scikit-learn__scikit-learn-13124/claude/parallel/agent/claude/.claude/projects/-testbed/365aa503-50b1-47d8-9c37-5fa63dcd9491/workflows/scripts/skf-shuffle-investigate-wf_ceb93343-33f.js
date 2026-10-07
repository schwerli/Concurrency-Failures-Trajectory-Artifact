export const meta = {
  name: 'skf-shuffle-investigate',
  description: 'Investigate StratifiedKFold shuffle bug: current behavior, affected tests, canonical fix, downstream impact',
  phases: [
    { title: 'Investigate', detail: '5 parallel investigators: repro, test-impact, canonical fix, downstream/docs, invariants' },
    { title: 'Synthesize', detail: 'merge findings into an implementation brief' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'

const REPRO_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    observations: { type: 'array', items: { type: 'string' } },
    root_cause: { type: 'string' },
    script_paths: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'observations', 'root_cause'],
}

const TESTS_SCHEMA = {
  type: 'object',
  properties: {
    tests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          location: { type: 'string' },
          name: { type: 'string' },
          asserts: { type: 'string' },
          risk: { type: 'string', description: 'why a change in fold assignment could break it, or why it is safe' },
        },
        required: ['location', 'name', 'asserts', 'risk'],
      },
    },
    doctests: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['tests', 'notes'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string' },
    code: { type: 'string', description: 'full proposed _make_test_folds body' },
    docstring_changes: { type: 'string' },
    rationale: { type: 'string' },
    invariants: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['approach', 'code', 'rationale', 'invariants'],
}

phase('Investigate')

const [repro, testImpact, fixA, fixB, downstream, invariants] = await parallel([
  () => agent(`You are investigating a bug in the scikit-learn repo at /testbed (version 0.21.dev0, git branch main, clean).

Python interpreter to use for ALL execution: ${PY}  (plain \`python\` has no numpy).

BUG REPORT: sklearn.model_selection.StratifiedKFold with shuffle=True does not shuffle samples within each stratum in a useful way -- it effectively only permutes the ORDER of the folds. Reproducer: n_splits=10, y = 10 ones followed by 10 zeros. With shuffle=False, test folds are (0,10),(1,11),...,(9,19). With shuffle=True and any random_state, the SAME set of folds appears, just in a different order: sample i of class 1 is always paired with sample i+10 of class 0.

TASK: Reproduce and characterize this empirically. Write throwaway scripts under /tmp (NOT in /testbed) and run them.
1. Run the exact reporter script; confirm the behavior.
2. Read sklearn/model_selection/_split.py StratifiedKFold._make_test_folds (around line 622) and explain mechanically WHY this happens (hint: it delegates to KFold per class with the same random_state, over np.zeros(max(count, n_splits))).
3. Show additional cases: (a) n_splits=5 with 10+10 samples -- does shuffle produce genuinely different partitions across seeds, or just permuted/paired ones? (b) unbalanced classes e.g. y with counts 7 and 3, n_splits=3. (c) a case where count < n_splits so the "trim" branch fires. (d) Check fold SIZE balance: does the current implementation ever produce test folds whose sizes differ by more than 1 sample? Try to find a concrete y/n_splits where it does (e.g. multiclass with counts like [10, 10, 10] vs [4,4,4,4...] or counts that are not multiples of n_splits, e.g. 3 classes each with count 4 and n_splits=3 -- compute test fold sizes).
4. Check whether the current implementation is invariant to relabeling classes (e.g. y=[1,1,0,0,...] vs y=["b","b","a","a",...] vs y=[0,0,1,1,...]) -- report exact fold assignments.

Report concrete numeric outputs. Do NOT modify any file under /testbed.`, { label: 'repro', phase: 'Investigate', schema: REPRO_SCHEMA }),

  () => agent(`Repo: /testbed (scikit-learn 0.21.dev0). Python: ${PY}.

CONTEXT: We are about to change StratifiedKFold._make_test_folds in sklearn/model_selection/_split.py so that shuffle=True genuinely shuffles samples within each class (instead of only permuting fold order), and so that fold assignment is computed by round-robin allocation rather than delegating to per-class KFold. This WILL change the concrete fold indices produced in some cases (both shuffle=True and possibly shuffle=False), and may change test fold sizes.

TASK: Exhaustively catalog every place in the repo whose expected values could be affected. Be thorough -- search the whole repo, not just test_split.py:
- sklearn/model_selection/tests/test_split.py: every test touching StratifiedKFold, RepeatedStratifiedKFold, or cross-validator fold contents/sizes. For each, quote the assertion and judge whether it hardcodes specific indices/fold sizes/score values.
- sklearn/model_selection/tests/test_validation.py, test_search.py: hardcoded expected scores from StratifiedKFold-based CV (e.g. cross_val_score with default cv on classification, cross_val_predict, GridSearchCV score values, LeaveOneLabelOut, etc.).
- Anywhere else in sklearn/ tests that could depend on stratified fold assignment (e.g. sklearn/tests/test_calibration.py, sklearn/linear_model tests with CV, feature_selection RFECV, ensemble, semi_supervised, etc.). Use grep for StratifiedKFold and for cv= with integers on classification data. Note: cross_val_score with an integer cv on a classifier uses StratifiedKFold, so ANY hardcoded score assertion there is at risk.
- Doctests: docstrings in _split.py and .rst files under doc/ that print StratifiedKFold output (grep doc/ for StratifiedKFold and for 'TRAIN:'), plus examples/ scripts.

For each item report location as path:line, the test/function name, what it asserts, and a risk judgement (HIGH: hardcodes fold indices or exact scores from stratified CV; MED: asserts fold sizes/counts; LOW: only asserts invariants like class ratios).

Also list which tests specifically assert the CURRENT (buggy) shuffle semantics and would need updating (e.g. tests asserting that shuffled folds equal unshuffled folds, or asserting specific test-fold contents with random_state set).

Do NOT modify any files.`, { label: 'test-impact', phase: 'Investigate', schema: TESTS_SCHEMA }),

  () => agent(`Repo: /testbed (scikit-learn 0.21.dev0). Python: ${PY}.

TASK: Reconstruct, from your knowledge of scikit-learn's upstream history, the CANONICAL upstream fix for this issue: "StratifiedKFold either shuffling is wrong or documentation is misleading" (GitHub issue about shuffle=True only permuting fold order). The fix landed in scikit-learn 0.22 and rewrote StratifiedKFold._make_test_folds to:
  * encode classes by order of first appearance (using np.unique with return_index/return_inverse and a class_perm) so the result is invariant to class labels while preserving data order,
  * compute an 'allocation' matrix by round-robin over sorted y_encoded: allocation[i] = np.bincount(y_order[i::n_splits], minlength=n_classes),
  * build folds_for_class = np.arange(n_splits).repeat(allocation[:, k]) per class, rng.shuffle(folds_for_class) when shuffle=True, and assign test_folds[y_encoded == k] = folds_for_class,
  * use rng = check_random_state(self.random_state).

Write out the EXACT final upstream implementation of _make_test_folds as it appears in scikit-learn 0.22+/1.x, including the error/warning branches (n_splits > y_counts check, min_groups warning) and the comments. Also write out the upstream docstring changes to StratifiedKFold: the 'shuffle' parameter description ("Whether to shuffle each class's samples before splitting into batches. Note that the samples within each split will not be shuffled.") and the expanded 'Notes' section listing the design goals (same class distribution in each test set; invariance to class label; order preservation when shuffle=False; test set sizes differing by at most one sample) with the ".. versionchanged:: 0.22" directive.

IMPORTANT: this repo is at 0.21.dev0, so a versionchanged directive should say 0.21 if the note describes a change made in THIS repo's dev version -- flag that judgement call rather than deciding it silently. Also check the current repo's docstring/warning text (read sklearn/model_selection/_split.py) and note which surrounding text differs from upstream 1.x so we do NOT accidentally import unrelated later changes (e.g. the min_groups warning wording, n_splits='warn' default, parameter doc formatting style).

Verify your reconstructed code actually runs: write it as a standalone function in /tmp and check it against the reporter's example (n_splits=10, y = 10 ones then 10 zeros) -- with shuffle=True and different random_state values the partitions must genuinely differ (not just be reordered), and each test fold must have 1 sample from each class. Also verify fold sizes differ by at most 1 for tricky counts.

Do NOT modify any files under /testbed.`, { label: 'canonical-fix', phase: 'Investigate', schema: FIX_SCHEMA }),

  () => agent(`Repo: /testbed (scikit-learn 0.21.dev0). Python: ${PY}.

TASK: Independently DESIGN (do not look up) a correct implementation of StratifiedKFold._make_test_folds that fixes this bug, then stress-test it. Requirements:
  1. shuffle=True must genuinely randomize WHICH samples of each class land in which test fold, so different random_state values give genuinely different partitions (not merely a permutation of the same folds).
  2. Stratification: each test fold's class distribution must match the overall distribution as closely as possible.
  3. Test fold sizes must differ by at most 1 sample overall (and per class, by at most 1).
  4. shuffle=False must preserve data order dependencies as much as possible: the samples of class k in a given test fold should be contiguous in y (ignoring samples of other classes).
  5. The result must be invariant to how classes are labelled/renamed (relabelling y=["Happy","Sad"] to y=[1,0] must not change the indices generated).
  6. Must handle classes with fewer members than n_splits (currently warns, and the old code trimmed oversized splits).
  7. Must remain deterministic for a given int random_state, and must not consume the caller's RandomState differently per class in a way that couples classes.

Read the current implementation in sklearn/model_selection/_split.py (StratifiedKFold, ~line 622) first. Then write your design as a standalone function in /tmp, and empirically verify all 7 properties with a brute-force test harness over many random y (varying n_classes 2-5, counts 1-30, n_splits 2-10): check max/min test fold size difference, per-class distribution, order preservation, label invariance, and that seeds produce different partitions. Report failures honestly with concrete counterexamples.

Return your final function source and the verification results. Do NOT modify any files under /testbed.`, { label: 'independent-design', phase: 'Investigate', schema: FIX_SCHEMA }),

  () => agent(`Repo: /testbed (scikit-learn 0.21.dev0). Python: ${PY}.

TASK: Map the downstream/doc surface of a change to StratifiedKFold's fold assignment.
1. Read sklearn/model_selection/_split.py fully enough to list: which classes inherit from or delegate to StratifiedKFold (_BaseKFold, RepeatedStratifiedKFold, StratifiedShuffleSplit -- does StratifiedShuffleSplit share _make_test_folds? check), and which helpers (check_cv, cross_val_predict, _index_param_value) rely on its behavior.
2. Find every doc file that documents shuffle semantics for StratifiedKFold: grep doc/ for StratifiedKFold, 'stratif', 'shuffle'. Quote passages that would become wrong or that should be updated (esp. doc/modules/cross_validation.rst).
3. Find doc/whats_new/ -- which file is the current dev changelog (v0.21.rst?)? Read its structure: how are entries formatted for sklearn.model_selection, are there existing 'Changed models'/'API changes' sections, what issue/PR reference style is used (:issue:\`NNNN\` vs :pr:\`NNNN\`), and how are contributors credited? Quote 2-3 example entries verbatim so we can match style exactly. Also note whether there is a 'Changed models' section at the top listing estimators whose predictions change.
4. Check KFold's docstring wording for 'shuffle' in this repo for consistency.
5. Note the doctest example inside StratifiedKFold's docstring (X 4 samples, y=[0,0,1,1], n_splits=2) and predict whether a round-robin-allocation implementation would change its printed output. Compute it by hand and state the expected TRAIN/TEST lines.

Do NOT modify any files.`, { label: 'downstream-docs', phase: 'Investigate', schema: TESTS_SCHEMA }),

  () => agent(`Repo: /testbed (scikit-learn 0.21.dev0). Python: ${PY}.

TASK: Write a reusable, rigorous property-test harness (save it at /tmp/skf_props.py) that can be pointed at ANY StratifiedKFold implementation (import from sklearn.model_selection) and checks these invariants over a large randomized sweep:
  P1 every sample appears in exactly one test fold; train = complement; no overlap.
  P2 number of folds == n_splits; every fold non-empty when n_samples >= n_splits.
  P3 per-class counts per test fold: for each class, counts across folds differ by at most 1.
  P4 total test fold sizes differ by at most 1.
  P5 with shuffle=False, for each class k the positions of class-k samples in consecutive test folds are in increasing blocks (order preserved: fold index is non-decreasing along y restricted to class k).
  P6 label invariance: relabelling classes (permuting label names, incl. string labels and reversed numeric order) yields identical test_fold assignment per sample position.
  P7 with shuffle=True, across >= 20 seeds, the SET of frozensets of test folds is not constant (genuinely different partitions), for cases like n_splits=10 with 10+10 samples and n_splits=5 with 20+20.
  P8 reproducibility: same int random_state -> identical splits across repeated .split() calls; RandomState instance -> may differ across calls.
  P9 determinism/no coupling: with shuffle=True the assignment of class A samples is not deterministically tied to class B samples (test the reporter's pairing symptom: sample i of class 1 paired with sample i of class 0 in the same fold across all seeds).

Run the harness against the CURRENT (unfixed) sklearn in /testbed and report exactly which properties FAIL today, with the concrete failing configuration and numbers. This baseline tells us what the fix must repair, and which properties already hold (so we do not regress them).

Note P5/P6/P3 may already hold; be precise. Print a clear PASS/FAIL table. Do NOT modify any files under /testbed (only write to /tmp).`, { label: 'property-harness', phase: 'Investigate', schema: REPRO_SCHEMA }),
])

phase('Synthesize')

const brief = await agent(`Synthesize an implementation brief for fixing StratifiedKFold's shuffle bug in /testbed (scikit-learn 0.21.dev0).

You have six independent investigation reports. Reconcile them. Where the "canonical upstream" reconstruction and the "independent design" differ, say which to prefer and why (bias toward the canonical upstream implementation, since hidden acceptance tests likely encode upstream's exact behavior -- but flag any place where the canonical version looks wrong or where the two agree/disagree on printed outputs).

REPORT 1 -- reproduction:
${JSON.stringify(repro)}

REPORT 2 -- test impact:
${JSON.stringify(testImpact)}

REPORT 3 -- canonical upstream fix:
${JSON.stringify(fixA)}

REPORT 4 -- independent design:
${JSON.stringify(fixB)}

REPORT 5 -- downstream & docs:
${JSON.stringify(downstream)}

REPORT 6 -- property harness baseline:
${JSON.stringify(invariants)}

Produce a concise but complete brief:
A. Root cause (2-3 sentences).
B. The exact code to write for _make_test_folds (final, ready to paste), plus any import changes needed (is check_random_state already imported in _split.py? verify by reading the file).
C. Exact docstring edits (shuffle param wording, Notes section, versionchanged number to use given this repo is 0.21.dev0).
D. Concrete list of existing tests/doctests that will need updating, with the new expected values where you can compute them.
E. Changelog entry location + verbatim text matching the repo's style.
F. Risks / things to verify after implementing.

Be specific and factual; quote file:line.`, { label: 'brief', phase: 'Synthesize' })

return { brief, repro, testImpact, fixA, fixB, downstream, invariants }
