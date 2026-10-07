export const meta = {
  name: 'impl-ml-assignments',
  description: 'Implement remaining A1-SL/A3-USL/A4-MDPs modules, then verify and fix each independently',
  phases: [
    { title: 'Implement', detail: 'one agent per module file' },
    { title: 'Verify', detail: 'independent agent writes+runs smoke tests, reports defects' },
    { title: 'Fix', detail: 'repair anything verification flagged' },
  ],
}

const SHARED = `
You are implementing part of a graduate machine-learning assignment repository at /workspace (git repo, branch master). Another agent (the lead) has already implemented A1-SL/util.py and A1-SL/DecisionTree.py, which define the house pattern.

ENVIRONMENT (python3.9): scikit-learn 1.3.2, numpy 1.26.4, pandas 2.3.3, matplotlib 3.9.4 (Agg backend, headless), seaborn 0.13.2, scipy 1.13.1, pymdptoolbox 4.0b3 (module \`mdptoolbox\`), mdptoolbox-hiive 4.0.3.1 (module \`hiive.mdptoolbox\`), yellowbrick 1.5, pytest 8.4.1, gym 0.26.2.

API PITFALLS in this environment - never reintroduce them (the original repo was written against much older libraries):
 * np.object / np.float / np.int are REMOVED -> use builtin object/float/int (e.g. \`X.dtypes == object\`).
 * scipy.interp is REMOVED -> np.interp.
 * matplotlib.cm.get_cmap is REMOVED -> plt.get_cmap(name) or matplotlib.colormaps[name].
 * sklearn AdaBoostClassifier renamed base_estimator -> estimator. base_estimator survives only as a deprecated sentinel STRING, so set_params(base_estimator__max_depth=3) raises AttributeError. Use estimator__* and remap any incoming base_estimator__* keys.
 * Pass n_init explicitly to KMeans / MiniBatchKMeans / GaussianMixture.
 * plt.show() is a no-op under Agg and emits a warning; close figures you create so long runs do not leak them.
 * roc_auc_score(y, proba, multi_class="ovr", average="weighted") CRASHES for 2-class problems (proba has 2 columns). Handle binary by scoring proba[:, 1] - see the \`score()\` helper in A1-SL/DecisionTree.py.

ARTIFACT PATHS: the original author wrote for Windows and used 'Images\\\\name.png' and 'ParamTests\\\\name.csv'. On Linux those literals create junk files with backslashes in the cwd. Instead create the folder (os.makedirs(..., exist_ok=True)) and use os.path.join, wrapped so a failed save can never break the computation - copy the house pattern from A1-SL/util.py (save_figure / save_gridsearch_to_csv).

HARD RULES:
 * ONLY create/edit the file(s) you are explicitly assigned, plus files you add under /workspace/agent_tests/. Never touch another module, never run git commit/add/checkout/stash, never edit .gitignore.
 * Keep every function signature EXACTLY as it appears in the stub file, including parameter names, order and default values. Do not rename functions, do not add or remove parameters.
 * Implement every stubbed function in your file (\`pass  # TODO: implement\`), not just the ones named in acceptance criteria.
 * Match the surrounding code style: same import block, snake_case names as used, aligned dict literals, short comments only where the original has them, citation comments preserved.
 * The default code path (make_graphs=False, full_param=False) must be FAST - seconds, not minutes - because tests will call it. Heavier sweeps belong behind full_param=True or make_graphs=True.
 * VERIFY BY RUNNING. Run the module from inside its own directory (e.g. \`cd /workspace/A1-SL && python -c "..."\`) because modules do \`import util\` and read 'Data/<file>.csv' relatively. Delete any Images/ or ParamTests/ output you generate when you are done.

READ FIRST (do not skip):
 * /workspace/A1-SL/util.py and /workspace/A1-SL/DecisionTree.py - the house pattern for A1-SL: local \`score()\` helper, \`if len(pXXX) == 0:\` -> build param_grid (full_param picks the big grid) -> GridSearchCV(cv=numFolds, scoring='roc_auc_ovr_weighted', return_train_score=True, n_jobs=njobs, verbose=debug) -> util.save_gridsearch_to_csv(cvres, algo, str(filename)[:-4], scalar) -> best_params; else best_params = dict(pXXX). Then fresh estimator, set_params(**best_params), fit, train/test weighted OVR ROC-AUC, optional graphs, \`return time.time() - start, round(train_score, 4), round(test_score, 4)\`.
 * /workspace/A1-SL/main.py - shows how each train_* is invoked and the exact pXXX dicts real runs pass in (your code must accept those dicts).
 * /workspace/A3-USL/dr_cluster.py - a complete, working near-duplicate of the A3-USL clustering + dimensionality-reduction code. It is the single best reference for A3-USL.
 * /workspace/A3-USL/util.py, /workspace/A3-USL/main.py, /workspace/A3-USL/DR_NN.py, /workspace/A3-USL/cluster_NN.py.
 * /workspace/A4-MDPs/QL-Forest.py - contains the reference run_episodes implementation and forest MDP setup.
 * /workspace/requirements/*.yaml - the requirement text for your module.

Your final message is a return value, not a chat reply: report (a) what you implemented, (b) the exact commands you ran and their observed output/timings, (c) anything you deliberately deviated on and why, (d) residual risks.
`

const ITEMS = [
  {
    key: 'knn',
    label: 'A1-SL/kNearestNeighbor.py',
    task: `Implement \`train_knn(filename, X_train, X_test, y_train, y_test, full_param=False, debug=False, numFolds=10, njobs=-1, scalar=1, make_graphs=False, pknn={})\` in /workspace/A1-SL/kNearestNeighbor.py, mirroring A1-SL/DecisionTree.py.

Details:
 * algo = 'k-Nearest Neighbor' (used in titles/filenames).
 * Grid searched hyperparameters: n_neighbors, weights ['uniform','distance'], algorithm ['auto','ball_tree','kd_tree','brute'], p [1,2] (Manhattan/Euclidean). full_param=True gets the wide n_neighbors sweep (e.g. 1..50 thinned) and all algorithms; full_param=False a reduced but still meaningful grid that finishes a 10-fold search on 1400x20 data in a few seconds.
 * main.py passes pknn={'algorithm': 'brute', 'n_neighbors': 11, 'p': 1, 'weights': 'distance'} - that must work verbatim.
 * make_graphs=True: util.plot_learning_curve plus util.compute_vc model-complexity curves for n_neighbors, p, weights (fString=True) and algorithm (fString=True).
 * Return (elapsed_time, round(train_score, 4), round(test_score, 4)) with elapsed measured over the whole call.

Acceptance: from /workspace/A1-SL, \`util.data_load('Mobile_Prices.csv','price_range', scalar=1)\` then train_knn with and without pknn returns 3 floats with scores in [0,1]; also works with plain numpy arrays and a 2-class target; make_graphs=True path runs end to end on a small subset.`,
  },
  {
    key: 'svm',
    label: 'A1-SL/SVM.py',
    task: `Implement \`train_svm(filename, X_train, X_test, y_train, y_test, solver='rbf', full_param=False, debug=False, numFolds=10, njobs=-1, scalar=1, make_graphs=False, pSVM={})\` in /workspace/A1-SL/SVM.py, mirroring A1-SL/DecisionTree.py.

Details:
 * Uses \`svm.SVC\` from the already imported \`sklearn.svm\` module, always with probability=True (needed for ROC-AUC) and kernel=solver, random_state=1.
 * algo = 'SVM' and the grid-search CSV must be written with the solver as the \`solver\` argument of util.save_gridsearch_to_csv so linear/rbf/poly/sigmoid runs do not overwrite each other.
 * Kernel-aware grid: C for every kernel; gamma for rbf/poly/sigmoid; degree (and coef0) for poly; coef0 for sigmoid. full_param=True gets wide log-spaced C/gamma sweeps; full_param=False a small grid - SVC(probability=True) under 10-fold CV is expensive, so keep the default grid to roughly <= 8 combinations.
 * main.py passes pSVM dicts like {'C': 1000, 'gamma': 1.0, 'kernel': 'rbf', 'random_state': 1, 'probability': True, 'break_ties': True} and {'C': 1000, 'cache_size': 2000, 'gamma': 1e-07, ...} - they must work verbatim (note pSVM can carry its own 'kernel', which wins over the solver argument for the final estimator).
 * make_graphs=True: util.plot_learning_curve, util.compute_vc for C (log=True) and, for kernels that use it, gamma (log=True) (plus degree for poly), and for the rbf kernel also call util.svm_rbf_C_Gamma_viz(X_train, y_train, <best params>, njobs, <filename>, midscore) where midscore is a sensible mid-point of the observed scores (e.g. the test score).
 * Return (elapsed_time, round(train_score, 4), round(test_score, 4)).

Acceptance: with pSVM supplied and with an empty pSVM for solver in ('rbf','linear','poly','sigmoid') the function returns 3 floats, scores in [0,1]; works for a 2-class numpy dataset; make_graphs=True runs end to end on a small subset (use a small n_samples so it stays quick).`,
  },
  {
    key: 'nn',
    label: 'A1-SL/NeuralNetwork.py',
    task: `Implement \`train_NN(filename, X_train, X_test, y_train, y_test, solver='adam', full_param=False, debug=False, numFolds=10, njobs=-1, scalar=1, make_graphs=False, pNN={}, nolegend=False)\` in /workspace/A1-SL/NeuralNetwork.py, mirroring A1-SL/DecisionTree.py.

Details:
 * MLPClassifier with solver=solver, random_state=1, max_iter high (10000) together with early_stopping=True so it still converges quickly.
 * Grid searched hyperparameters: hidden_layer_sizes, activation, alpha (regularisation), learning_rate_init, plus the fixed solver. full_param=True gets the wide sweep (several depths/widths e.g. (16,), (128,), (512,512,512,512), alpha 1e-4..1e-1, learning_rate_init 1e-3/1e-2); full_param=False a reduced grid that trains in seconds on 1400x20 data (small architectures, <= ~8 combinations).
 * Save the grid search CSV with the solver passed to util.save_gridsearch_to_csv (adam vs sgd runs must not collide).
 * main.py passes pNN dicts like {'activation': 'tanh', 'alpha': 0.0001, 'early_stopping': True, 'hidden_layer_sizes': (256,256,256,256), 'max_iter': 10000, 'learning_rate_init': 0.001, 'random_state': 1, 'solver': 'adam'} - must work verbatim.
 * make_graphs=True: util.plot_learning_curve; util.compute_vc for alpha (log=True), learning_rate_init (log=True), hidden_layer_sizes (fString=True, rotatex=True) and activation (fString=True), forwarding \`nolegend\` to compute_vc; plus a plot of the fitted network's loss_curve_ (and validation_scores_ when early_stopping produced them) versus iteration, saved through the same util.save_figure helper.
 * Return (elapsed_time, round(train_score, 4), round(test_score, 4)).
 * Suppress nothing, but avoid a wall of ConvergenceWarnings by keeping early_stopping/max_iter sane.

Acceptance: with pNN supplied and with an empty pNN (solver 'adam' and 'sgd') returns 3 floats with scores in [0,1] in a few seconds; works with a 2-class numpy dataset; make_graphs=True runs end to end on a small subset.`,
  },
  {
    key: 'btree',
    label: 'A1-SL/BoostedTree.py',
    task: `Implement \`train_BTree(filename, X_train, X_test, y_train, y_test, full_param=False, debug=False, numFolds=10, njobs=-1, scalar=1, make_graphs=False, pBTree={})\` in /workspace/A1-SL/BoostedTree.py, mirroring A1-SL/DecisionTree.py.

Details:
 * AdaBoostClassifier over a DecisionTreeClassifier base learner. Grid search must cover BOTH ensemble params (n_estimators, learning_rate) and base-tree params (max_depth, criterion, ccp_alpha) via the nested prefix.
 * CRITICAL sklearn 1.3 compatibility: the nested prefix is \`estimator__\`; \`base_estimator__\` raises. main.py passes pBTree dicts written with the OLD spelling, e.g. {'base_estimator__ccp_alpha': 0, 'base_estimator__criterion': 'gini', 'base_estimator__max_depth': 20, 'base_estimator__min_samples_split': 8, 'base_estimator__splitter': 'best', 'learning_rate': 1, 'n_estimators': 300, 'random_state': 1}. Your module must accept either spelling: implement a small LOCAL helper in BoostedTree.py that remaps base_estimator/base_estimator__* to whichever name the installed AdaBoostClassifier exposes (inspect get_params()), and use it on pBTree before set_params. Do NOT rely on util for this (A1-SL/util.py has its own copy for its own use).
 * full_param=True gets the wide grid; full_param=False a small one - AdaBoost under 10-fold CV is expensive, so keep the default grid to roughly <= 8 combinations with n_estimators <= 50 so a default call on 1400x20 data finishes in well under a minute.
 * make_graphs=True: util.plot_learning_curve; util.compute_vc for n_estimators, learning_rate (log=True), the base tree's max_depth and criterion (fString=True) using the correctly-prefixed parameter names; plus util.boost_lr_vs_nest(X_train, y_train, <best params>, njobs, <filename>, midscore).
 * Return (elapsed_time, round(train_score, 4), round(test_score, 4)).

Acceptance: train_BTree works (a) with an empty pBTree, (b) with the exact base_estimator__* dict from main.py (use small n_estimators when timing), (c) with an estimator__* dict, (d) on a 2-class numpy dataset; make_graphs=True runs end to end on a small subset.`,
  },
  {
    key: 'clustering',
    label: 'A3-USL/clustering.py',
    task: `Implement every stub in /workspace/A3-USL/clustering.py: bench_k_means, silo_analysis, bench_EM, ul_Kmeans, ul_EM (init_analysis is already written - leave it, except that matplotlib.cm.get_cmap style removals must not break the file).

/workspace/A3-USL/dr_cluster.py is a working near-duplicate of this exact code - follow it closely for structure, plot titles, metric order and file naming. Differences you MUST apply:
 * bench_k_means(estimator, labels, name, data, sample_size, n_clusters, random_state, filename, verbose=False) must fit the estimator, time the fit, and return the 11-tuple (fit_time, homogeneity, completeness, v_measure, adjusted_rand, adjusted_mutual_info, fowlkes_mallows, silhouette, davies_bouldin, calinski_harabasz, inertia) - all metrics really computed (silhouette via metrics.silhouette_score(data, preds, metric='euclidean', sample_size=sample_size, random_state=random_state), inertia from estimator.inertia_). Compute the predictions once into a local variable instead of calling estimator.predict(data) eleven times.
 * bench_EM(estimator, labels, name, data, sample_size, n_clusters, random_state, filename, verbose=False) must return the 13-tuple (fit_time, homogeneity, completeness, v_measure, adjusted_rand, adjusted_mutual_info, fowlkes_mallows, silhouette, davies_bouldin, calinski_harabasz, aic, bic, score). Unlike dr_cluster.py (which zeroed homogeneity/completeness/fowlkes_mallows/aic to save time) ALL thirteen values must be genuinely computed: aic=estimator.aic(data), bic=estimator.bic(data), score=estimator.score(data).
 * Both keep the \`if verbose:\` tab-separated print of the metric row, like dr_cluster.py.
 * silo_analysis and ul_Kmeans/ul_EM: same behaviour and plots as dr_cluster.py, but use plt.get_cmap / matplotlib.colormaps instead of the removed cm.get_cmap, save through an os.makedirs+os.path.join helper instead of 'Images\\\\...', and work whether \`X\` is a pandas DataFrame or a numpy array (dr_cluster.silo_analysis indexes with X.iloc - make that safe for ndarray input too).
 * ul_Kmeans / ul_EM sweep cluster counts and plot the metric comparisons exactly as dr_cluster.py does (ground-truth scores, no-ground-truth scores, inertia/fit-time, BIC/AIC/score by covariance type). Keep the sweep faithful to the reference; they are slow by nature and that is expected, but make sure a small-input call (e.g. 200x5 data) completes in a reasonable time by keeping n_init as in the reference and nothing heavier.
 * Guard against clusters > n_samples style errors only where trivially cheap; do not restructure the reference sweeps.

Acceptance: from /workspace/A3-USL, with X,y from util.data_load_no_split('Mobile_Prices.csv','price_range', scalar=1) sub-sampled to a few hundred rows: bench_k_means with a KMeans(n_clusters=4, n_init=10, random_state=1) returns exactly 11 finite numbers with the documented ordering and metric values matching a direct sklearn.metrics computation; bench_EM with GaussianMixture(n_components=4, covariance_type='tied', n_init=1, random_state=1) returns exactly 13 numbers with aic/bic/score matching direct calls; silo_analysis runs for DataFrame and ndarray input; ul_Kmeans and ul_EM run to completion on small data (temporarily shrinking the sweep only inside your throwaway test is NOT allowed - if the full sweep is genuinely too slow to smoke test, run it on the smallest sensible input and report the timing).`,
  },
  {
    key: 'dimred',
    label: 'A3-USL/dimred.py',
    task: `Implement all four stubs in /workspace/A3-USL/dimred.py: ulPCA(X, y, random_seed, filename, verbose=False), ulICA(X, y, random_seed, filename, verbose=False), randProj(X, y, random_seed, filename, verbose=False), ul_LLE(X, y, random_seed, filename, verbose=False).

Requirement text (requirements/a3_usl_dimred.yaml): "Implements four dimensionality reduction pipelines - PCA (ulPCA), FastICA (ulICA), Gaussian Random Projection (ulGRP), and Locally Linear Embedding (ulLLE) - each fitting the technique to data and generating explained-variance or reconstruction-error visualizations to guide component count selection."

Details:
 * ulPCA: fit PCA (svd_solver='full', random_state=random_seed) on X; plot per-component explained_variance_ratio_ and the cumulative curve (with an eigenvalue/scree plot) versus number of components; print the values when verbose.
 * ulICA: sweep n_components (1..n_features) with FastICA(random_state=random_seed); plot mean/max absolute kurtosis of the components versus n_components (kurtosis is the standard ICA component-count signal - use scipy.stats.kurtosis or a numpy computation) and the reconstruction error (mean squared error between X and inverse_transform(transform(X))).
 * randProj: sweep n_components with GaussianRandomProjection over several random seeds and plot mean +/- std reconstruction error versus n_components (reconstruct with the pseudo-inverse of the projection matrix, the standard approach since GRP has no inverse_transform).
 * ul_LLE: sweep n_components with LocallyLinearEmbedding(n_neighbors=10, random_state=random_seed, n_jobs=-1) and plot the fitted reconstruction_error_ versus n_components.
 * All four save their figures under an Images folder created with os.makedirs + os.path.join (never the Windows 'Images\\\\...' literal) and never crash if saving fails; close figures after saving. Accept X as DataFrame or ndarray. Cap component sweeps at X.shape[1] (and at n_samples where the technique requires it).
 * Keep the imports already at the top of the file; you may add \`import os\` and a scipy.stats import if needed.
 * Also expose module-level aliases \`ulGRP = randProj\` and \`ulLLE = ul_LLE\` (the requirement text names them that way while main.py calls randProj / ul_LLE), each with a one-line comment saying it is an alias.
 * Runtime: a call on ~1400x20 data must finish in well under a minute for PCA/ICA/RP; LLE is the slow one - keep its sweep bounded (and n_jobs=-1) so it stays around or under a minute.

Acceptance: from /workspace/A3-USL, load X,y via util.data_load_no_split('Mobile_Prices.csv','price_range', scalar=1), sub-sample to ~300 rows, and run all four functions with verbose=True and verbose=False, plus once with a numpy array input; report timings. No crashes, figures produced in A3-USL/Images (delete them afterwards).`,
  },
  {
    key: 'forest',
    label: 'A4-MDPs VI-Forest.py + PI-Forest.py',
    task: `Two files:

(1) /workspace/A4-MDPs/VI-Forest.py - only \`run_episodes(policy, S, R, p, num_episodes, num_resets)\` is stubbed (run_forest and the heatmap helpers are already written). Implement run_episodes EXACTLY as the reference implementation in /workspace/A4-MDPs/QL-Forest.py lines ~134-149: num_resets independent trials of num_episodes steps; clamp the state with min(forest_state, S-1); draw \`np.random.rand(1) <= p\` for the fire; on fire set state to -1 with no reward; otherwise add R[forest_state][policy[forest_state]] and set state to -1 when the chosen action is 1 (Cut); then increment the state by 1; append each trial's total and return np.mean of the trial totals as a float. Keeping the identical RNG call pattern (one np.random.rand(1) per step) matters for reproducibility - do not vectorise it.

(2) /workspace/A4-MDPs/PI-Forest.py - implement both \`run_episodes\` (identical to the above) and \`run_forest(size)\`, structurally mirroring VI-Forest.run_forest but using \`hiive.mdptoolbox.mdp.PolicyIteration\` as the solver: same seeding (42), same forest MDP (S=size, r1=10, r2=50, p=0.1 via mdptoolbox.example.forest), same gamma/epsilon grids reduced the same way VI-Forest reduces them so a run stays quick, same reward/iteration/runtime heatmaps via the module's heatmap()/annotate_heatmap() helpers, same Mean V / Error / Reward versus iteration line plot from pi.run_stats, and the same red/blue Cut/Wait policy pcolor plot (titled for PI). NOTE: hiive's PolicyIteration signature is (transitions, reward, gamma, policy0=None, max_iter=1000, eval_type=0, skip_check=False, run_stat_frequency=None) - it takes NO epsilon argument. Keep the gamma x epsilon heatmap structure (so the plots stay equivalent to VI) but be honest in a short comment about how epsilon is handled for PI; do not pass an unsupported kwarg. Verify the run_stats dictionary keys you read actually exist for PolicyIteration.

Both files end with module-level \`run_forest(10)\` and \`run_forest(1000)\` calls. Measure how long \`cd /workspace/A4-MDPs && python VI-Forest.py\` and \`python PI-Forest.py\` take. Tests may import these files by path, which executes those calls, so: replace the Windows 'Images\\\\...' savefig literals with an os.makedirs+os.path.join helper (so importing does not scatter backslash-named files), and IF a full file run takes longer than ~45 seconds, put the two module-level run_forest calls behind \`if __name__ == "__main__":\` and say so in your report; if it is fast, leave them at module level as the original had them.

Acceptance: run_episodes is importable from both files and, with np.random.seed(42) fixed, returns the same float from both (same algorithm); a hand-checkable case works (e.g. p=0.0 with an all-Wait policy accumulates R[s][0] deterministically, and an all-Cut policy keeps returning to state 0); \`python VI-Forest.py\` and \`python PI-Forest.py\` both run to completion from /workspace/A4-MDPs; report both timings and the PI policy/reward it found.`,
  },
]

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'problems', 'evidence'],
  properties: {
    ok: { type: 'boolean', description: 'true only if every acceptance check passed with no defects worth fixing' },
    problems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'summary', 'repro'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          summary: { type: 'string' },
          repro: { type: 'string', description: 'exact command + observed output proving the defect' },
        },
      },
    },
    evidence: { type: 'string', description: 'commands run and key observed output/timings' },
  },
}

phase('Implement')

const results = await pipeline(
  ITEMS,
  (item) => agent(SHARED + '\n\nYOUR ASSIGNMENT\n' + item.task, { label: 'impl:' + item.key, phase: 'Implement' }),

  (implReport, item) => agent(
    SHARED +
    '\n\nYOU ARE THE INDEPENDENT VERIFIER for ' + item.label + '. Another agent just implemented it and claims:\n---\n' +
    (implReport || '(no report - the implementer failed; treat the file as suspect)') +
    '\n---\n\nDo NOT trust that report and do NOT edit the implementation file. Your job is to find real defects:\n' +
    ' 1. Read the file and the requirement in /workspace/requirements/.\n' +
    ' 2. Write a pytest module at /workspace/agent_tests/test_' + item.key + '.py that exercises every public function of the assignment with small, fast inputs: exact return arity/types, value ranges, both the "params supplied" and "grid search" paths, DataFrame AND numpy inputs, multi-class AND 2-class targets where applicable, the make_graphs/plot paths, and the exact parameter dicts /workspace/A1-SL/main.py or /workspace/A3-USL/main.py would pass. Where a metric is checkable, assert it against a direct sklearn/numpy computation rather than a loose range.\n' +
    ' 3. Run it: `cd /workspace && python -m pytest agent_tests/test_' + item.key + '.py -q`. Tests must be self-contained (chdir into the module directory / sys.path.insert as needed) and must clean up generated Images/ParamTests output.\n' +
    ' 4. Additionally probe by hand for: signature drift vs the stub, stale sklearn/numpy/matplotlib APIs, Windows path literals, crashes on binary targets, unused/undefined names, functions still returning None, values silently hardcoded to 0, and anything the requirement asks for that is missing.\n' +
    'Report ok=false with concrete repro commands for anything a reviewer would insist on fixing. A slow-but-correct research sweep is not a defect; a crash, wrong arity, wrong metric, or unmet requirement is.',
    { label: 'verify:' + item.key, phase: 'Verify', schema: VERIFY_SCHEMA },
  ),

  (verdict, item) => {
    if (!verdict || verdict.ok !== false) return { item: item.key, verdict, fixed: null }
    return agent(
      SHARED +
      '\n\nYOU ARE FIXING ' + item.label + '. An independent verifier found these defects:\n---\n' +
      JSON.stringify(verdict.problems, null, 2) +
      '\n---\nEvidence: ' + (verdict.evidence || '') +
      '\n\nFix every blocker and major in ' + item.label + ' (you may also fix minors when the fix is clearly safe). Judge each claim first - if a reported "defect" is actually correct behaviour or an artefact of the verifier\'s test, say so and explain instead of changing working code. You may edit the implementation file(s) for ' + item.label + ' and, if a test is wrong, /workspace/agent_tests/test_' + item.key + '.py. Re-run `cd /workspace && python -m pytest agent_tests/test_' + item.key + '.py -q` plus your own manual checks until green. Report what you changed, what you rejected and why, and the final test output.',
      { label: 'fix:' + item.key, phase: 'Fix', schema: VERIFY_SCHEMA },
    ).then((fixReport) => ({ item: item.key, verdict, fixed: fixReport }))
  },
)

log('pipeline complete for ' + ITEMS.length + ' modules')

return results.map((r, i) => ({
  module: ITEMS[i].label,
  verified_ok: r && r.verdict ? r.verdict.ok : null,
  problems: r && r.verdict ? r.verdict.problems : null,
  fix_ok: r && r.fixed ? r.fixed.ok : null,
  fix_problems: r && r.fixed ? r.fixed.problems : null,
}))
