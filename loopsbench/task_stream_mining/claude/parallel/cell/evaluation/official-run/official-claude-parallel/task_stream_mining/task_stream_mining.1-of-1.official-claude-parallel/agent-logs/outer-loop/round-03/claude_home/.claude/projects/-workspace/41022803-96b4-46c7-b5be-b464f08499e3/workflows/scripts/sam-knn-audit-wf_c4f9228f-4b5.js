export const meta = {
  name: 'sam-knn-audit',
  description: 'Audit workspace against all 5 stream-mining requirements and design the SAM-KNN experiment layer',
  phases: [
    { title: 'Audit', detail: 'parallel auditors over sam_knn.py, prior requirements, perf, paper fidelity' },
    { title: 'Synthesize', detail: 'merge into one implementation plan' },
  ],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'severity'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'info'] },
          file: { type: 'string' },
        },
      },
    },
  },
}

const COMMON = `
You are auditing a pure-Python (NO numpy, NO sklearn available; python 3.12) data-stream-mining
workspace at /workspace. Requirement specs live in /workspace/requirements/*.yaml.
Existing code: streams.py, evaluation.py, classifiers.py, attribute_observers.py (given base
framework, do not change), plus already-implemented hoeffding_tree.py, cvfdt.py, moa_framework.py,
stream/adwin.py, stream/experiments/adwin_exp.py.
The one remaining requirement is requirements/sam_knn.yaml (SAM-KNN). A draft implementation
already exists at /workspace/stream/sam_knn.py; stream/experiments/sam_exp.py does NOT exist yet
and run.sh does not yet run SAM experiments. The existing run.sh (4 prior experiment groups)
takes 56 seconds total.
Read files with Read/Grep. You may run python3 to check behaviour, but DO NOT edit any file
inside /workspace. Report findings only.`

const TASKS = [
  {
    label: 'audit:sam-api-contract',
    prompt: `${COMMON}

TASK: Audit /workspace/stream/sam_knn.py line-by-line against EVERY clause of
requirements/sam_knn.yaml (read the yaml in full). For each required class
(ShortTermMemory, LongTermMemory, SAMModel) and each required method/parameter/default
listed in the spec, verify it exists with the exact name, the exact default value, and the
documented return type/shape (e.g. get_window() must return a tuple of (features, labels);
get_memory_sizes() must return a dict; _evaluate_memories(query, k) must return a tuple;
partial_fit(features, label); predict(features) -> int returning a plain int, never None).
Also verify the documented behavioural contracts: STM FIFO eviction, evicted instance moves
to LTM, periodic LTM clean+compress, clean() removing LTM instances whose STM-kNN prediction
disagrees with their stored label, compress() being k-means prototype compression per class,
Euclidean distance with optional feature weighting, tie in local accuracy preferring STM,
min_stm_size gating LTM use.
Flag anything a hidden test could reasonably exercise and get a wrong type / crash
(e.g. predict on an empty model, k larger than memory size, weights of wrong length,
LongTermMemory.clean called with empty STM, compress on empty memory, non-list feature
sequences such as tuples).
Return concrete, actionable findings with severity.`,
  },
  {
    label: 'audit:paper-fidelity',
    prompt: `${COMMON}

TASK: Judge how faithfully /workspace/stream/sam_knn.py implements SAM-KNN as described by
Losing, Hammer & Wersing, "KNN Classifier with Self Adjusting Memory for Heterogeneous
Concept Drift" (ICDM 2016), while staying consistent with requirements/sam_knn.yaml (the yaml
wins where they differ - it is a simplified variant: memory choice is STM-vs-LTM local
accuracy only, no STM size adaptation is demanded).
Comment specifically on: (a) the interleaved test-then-train bookkeeping used to score each
memory vs a leave-one-out recomputation over a validation window; (b) whether the LTM cleaning
rule implemented (both the full clean() sweep and clean_single) matches the paper's notion of
"instances contradicted by the current concept"; (c) the k-means/prototype compression;
(d) whether the union/combined-memory predictor is a reasonable third option; (e) any place the
code would systematically under- or over-use the LTM.
Also state what accuracy range you would EXPECT on RandomTreeGenerator(seed=42,
num_attributes=10, num_classes=2, max_depth=5) with k=5 and STM=1000 over 10000 instances -
sanity bounds a grader might check. Return findings with severity.`,
  },
  {
    label: 'audit:prior-requirements',
    prompt: `${COMMON}

TASK: The harness reports vfdt, cvfdt, adwin and moa as complete. Independently VERIFY each
of requirements/vfdt.yaml, cvfdt.yaml, adwin.yaml, moa.yaml against the code actually present
(hoeffding_tree.py, cvfdt.py, moa_framework.py, stream/adwin.py,
stream/experiments/adwin_exp.py, run.sh). For every "Acceptance signals" bullet and every
named public entry point in those specs (HoeffdingTree.train/predict/get_votes/get_tree_size,
CVFDT.train/predict, CVFDTLeaf.forget, CVFDTSplit.alternate_trees, ADWIN.add_element/
detected_change/get_estimation/_compress, Bucket.merge, BucketRow.add_to_tail/remove_from_head,
OzaBagging.train/predict, EvaluateInterleavedTestThenTrain.run, PerformanceStats,
ADWINExperiment) confirm presence with grep AND confirm the required experiment names are
printed by run.sh with the exact spelling from the yaml (VFDT_ACCURACY, VFDT_TREE_NODES,
CVFDT_DRIFT_ACCURACY, VFDT_DRIFT_ACCURACY, ADWIN_* x5, MOA_ENSEMBLE_ACCURACY,
MOA_WINDOW_ACCURACY). The current run.sh output is:
VFDT_ACCURACY: 0.9698 / VFDT_TREE_NODES: 69 / CVFDT_DRIFT_ACCURACY: 0.6922 /
VFDT_DRIFT_ACCURACY: 0.6961 / ADWIN_DETECTION_DELAY: 43.00 /
ADWIN_FALSE_POSITIVE_RATE: 0.000000 / ADWIN_WINDOW_SIZE_STABLE: 2500.50 /
ADWIN_WINDOW_SIZE_DRIFT: 2100.00 / ADWIN_MEAN_ESTIMATION_ERROR: 0.013654 /
MOA_ENSEMBLE_ACCURACY: 0.7253 / MOA_WINDOW_ACCURACY: 0.8140.
Judge whether any of those VALUES look wrong for the specified setup (e.g. MOA OzaBagging of 10
Hoeffding trees on WaveformGenerator should normally reach ~0.80-0.85 cumulative accuracy over
100k instances - 0.7253 cumulative with 0.8140 window may just be the early-learning drag, but
verify the ensemble is actually training correctly and that ADWIN_WINDOW_SIZE_STABLE=2500.50
is the mean of a growing window rather than a capped one).
Report ONLY real gaps (missing name, wrong signature, wrong default parameter vs spec, metric
not printed, genuinely wrong value). Do not run the full 100k-instance experiments; small smoke
runs only. Return findings with severity.`,
  },
  {
    label: 'audit:performance',
    prompt: `${COMMON}

TASK: Performance audit of /workspace/stream/sam_knn.py for the 5 required experiments
(10000 instances each; experiments 1/3/4 use RandomTreeGenerator with stm_size=1000, k=5;
experiments 2/5 use a 10000-instance stream with abrupt drift at 5000). Pure python, no numpy.
Measure, don't guess: write throwaway benchmark scripts under /tmp (never inside /workspace)
and time (a) a 10000-instance prequential SAM run with stm_max_size=1000 and default
ltm_max_size=10000/ltm_clean_frequency=500, (b) the cost share of the periodic
LongTermMemory.clean full sweep, (c) knn search cost as a function of memory size.
Then report the cheapest changes that keep the algorithm faithful but bound the runtime
(e.g. bounding the clean reference window, incremental single-instance cleaning, capping LTM
size for the experiments, caching squared norms, avoiding repeated neighbour searches between
predict() and partial_fit()). Give concrete measured numbers (seconds) for each option and a
recommended configuration so that the WHOLE 5-experiment SAM suite finishes in under ~2 minutes
(the other 4 requirement groups already take 56s and the total run.sh should stay reasonable).
Return findings with severity.`,
  },
  {
    label: 'design:experiments',
    prompt: `${COMMON}

TASK: Design (do not write files) the exact contents of /workspace/stream/experiments/sam_exp.py
implementing class SAMKNNExperiment plus a main() that prints the 5 required lines:
SAM_ACCURACY_STABLE, SAM_ACCURACY_DRIFT, SAM_STM_SIZE, SAM_LTM_SIZE, SAM_MEMORY_DECISIONS.
Read requirements/sam_knn.yaml "Experiments" section very carefully and pin down every
ambiguity with a defensible reading, e.g.:
- Exp1: prequential (interleaved test-then-train) cumulative accuracy over 10000 instances of
  RandomTreeGenerator(seed=42, num_attributes=10, num_classes=2, max_depth=5), k=5, stm_size=1000.
- Exp2: "stream with abrupt drift at sample 5000 (mean shift)" - the given generators are
  RandomTreeGenerator / RotatingHyperplaneGenerator / WaveformGenerator; none does a mean shift,
  so a small drifting generator must be defined inside sam_exp.py. Specify it exactly
  (Gaussian class-conditional features whose means shift at t=5000, 2 classes, seeded,
  deterministic, subclassing streams.StreamGenerator and returning streams.Instance) and specify
  that accuracy is measured over the LAST 2000 instances only.
- Exp3: average STM size across the evaluation of exp1's setup.
- Exp4: final LTM size after exp1's stream.
- Exp5: fraction of predictions where STM was preferred over LTM, on the drifting stream.
Also design the required comparison of STM-only vs LTM-only vs combined SAM (spec:
"Compare STM-only vs LTM-only vs combined SAM approach") and the tracking of memory decisions
over time, exposing them as methods on SAMKNNExperiment.
Match the house style of /workspace/stream/experiments/adwin_exp.py exactly (module docstring,
sys.path bootstrap, __all__, typing, Google-style docstrings, run_all() returning a dict,
run_sam_experiments() helper, main() printing formatted lines, if __name__ == "__main__").
Return: (1) the full method-by-method design with signatures and docstring intent, (2) the exact
print formats, (3) which SAMModel constructor args each experiment passes, (4) any additions
needed in stream/sam_knn.py to support it. Be precise and complete - your design will be
implemented verbatim.`,
  },
]

phase('Audit')
const audits = await parallel(TASKS.map(t => () =>
  agent(t.prompt, { label: t.label, phase: 'Audit', schema: FINDINGS_SCHEMA })))

const collected = TASKS.map((t, i) => ({ label: t.label, result: audits[i] }))
  .filter(x => x.result)

phase('Synthesize')
const plan = await agent(`${COMMON}

You are the lead engineer. Below are audit reports from 5 independent auditors of this
workspace. Merge them into ONE prioritized implementation plan for finishing the sam_knn
requirement (the last of 5). Resolve contradictions between auditors explicitly, and drop
findings that are wrong (verify anything suspicious yourself by reading the code).

AUDIT REPORTS (JSON):
${JSON.stringify(collected, null, 1)}

Output a plan with these sections:
A. Changes required in stream/sam_knn.py (exact, minimal, with rationale). Say "none" if none.
B. Full design spec for stream/experiments/sam_exp.py (class SAMKNNExperiment: every method
   signature, what it computes, the exact 5 printed metric lines and their number formats).
C. Exact edit needed in run.sh.
D. Tests worth adding under agent_tests/test_sam_knn.py (list concrete assertions).
E. Any real gaps in the 4 already-committed requirements that must be fixed.
F. Runtime budget: expected seconds per experiment and the total, plus the specific
   optimisations to apply.
Be concrete and implementation-ready. This is the plan that will be executed verbatim.`,
  { label: 'synthesize:plan', phase: 'Synthesize' })

return { plan, audits: collected }
