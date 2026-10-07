export const meta = {
  name: 'gnn-spec-audit',
  description: 'Exhaustively audit the /workspace GraphNeuralNetwork implementation against its specification, empirically, then adversarially verify every finding',
  phases: [
    { title: 'Audit', detail: '11 independent auditors run the code against the spec' },
    { title: 'Verify', detail: 'each finding is refuted or confirmed by 2 independent skeptics' },
  ],
}

const RULES = `
You are auditing a Python project that lives in /workspace. It implements the
GraphNeuralNetwork specification stored at /tmp/audit/SPEC.md — READ THAT FILE FIRST.

The project will be graded by a HIDDEN pytest suite that was auto-generated from
that spec. So your job is to find anything that a spec-faithful generated test
could trip over, and anything that is simply wrong.

HARD RULES:
- DO NOT modify, create or delete ANY file under /workspace. It is read-only for you.
  (Reading is encouraged: Read/Grep/Glob freely.)
- Put every scratch script, log and artifact under /tmp/audit/{SLUG}/ .
- Run python with PYTHONPATH=/workspace (or cd into /workspace and use
  \`PYTHONPATH=/workspace python /tmp/audit/{SLUG}/foo.py\`) so \`import gnn\` works.
  Suppress TF noise with TF_CPP_MIN_LOG_LEVEL=3.
- ALWAYS actually RUN code to check a claim. Never report a finding you did not
  observe by execution unless it is purely about file contents (then quote them).
- Keep individual runs short: cap training at a handful of epochs unless your
  brief says otherwise. Use timeouts. TF import alone takes ~10s.
- The environment is TensorFlow 2.20 / Keras 3.12 / numpy 2.2 / networkx 3.4,
  even though the spec text lists slightly older versions. Judge against what is
  installed.

Report ONLY real problems. For each finding give: a one-line summary, the exact
repro command, the observed output, and the minimal suggested fix. Severity:
  critical = a documented spec example/API raises or returns wrong shapes/values
  major    = a plausible generated test would fail, or a documented behaviour is wrong
  minor    = works but deviates from the spec's wording/defaults
  nit      = cosmetic
If you find nothing in your area, return an empty findings list and say what you ran.
`

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'ran', 'findings'],
  properties: {
    area: { type: 'string' },
    ran: { type: 'string', description: 'short summary of what you actually executed' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'severity', 'repro', 'observed', 'suggested_fix'],
        properties: {
          summary: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          repro: { type: 'string' },
          observed: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason', 'confidence'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is NOT a real problem worth fixing' },
    reason: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    corrected_severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
  },
}

const AUDITORS = [
  {
    slug: 'api-signatures',
    brief: `Check EVERY documented signature against the code with inspect.signature:
load_data_v1(dataset="cora", path="../data/cora/"), preprocess_adj(adj, symmetric=True),
GCN(adj_dim, feature_dim, n_hidden, num_class, num_layers=2, activation=tf.nn.relu, dropout_rate=0.5, l2_reg=0, feature_less=True),
GAT(adj_dim, feature_dim, num_class, num_layers=2, n_attn_heads=8, att_embedding_size=8, dropout_rate=0.0, l2_reg=0.0, use_bias=True),
GraphSAGE(feature_dim, neighbor_num, n_hidden, n_classes, use_bias=True, activation=tf.nn.relu, aggregator_type='mean', dropout_rate=0.0, l2_reg=0),
sample_neighs(G, nodes, sample_num=None, self_loop=False, shuffle=True),
GraphConvolution.__init__(units, activation=tf.nn.relu, dropout_rate=0.5, use_bias=True, l2_reg=0, feature_less=False, seed=1024, **kwargs),
GATLayer.__init__(att_embedding_size=8, head_num=8, dropout_rate=0.5, l2_reg=0, activation=tf.nn.relu, reduction='concat', use_bias=True, seed=1024, **kwargs),
MeanAggregator.__init__(units, input_dim, neigh_max, concat=True, dropout_rate=0.0, activation=tf.nn.relu, l2_reg=0, use_bias=False, seed=1024, **kwargs).
Parameter NAMES, ORDER and DEFAULT VALUES must all match exactly (a generated test may
call every argument by keyword, or positionally). Also verify each documented method
exists (build/call/get_config/compute_output_shape) and that calling every parameter
by keyword actually works end to end for each constructor.`,
  },
  {
    slug: 'spec-nodes',
    brief: `Extract the five "Detailed Implementation Nodes" code blocks (Node 1..Node 5) and the
"Basic Usage Process" block from SPEC.md VERBATIM into separate scripts and run each one,
including every assert exactly as written. Only change you may make: reduce the 200-epoch
fit in the Basic Usage Process to 5 epochs (note it in your report). Report any error,
assertion failure, warning that looks like a bug, or NaN. Also re-run Node 5 a second time
in the same process to check for state leakage between fits.`,
  },
  {
    slug: 'usage-examples',
    brief: `Run the two "Usage Example" blocks verbatim: the GATLayer example with
features=tf.random.normal((32,100,64)) and a (32,100,100) int32 adjacency (batched 3-D
input; the docs say the output is [batch_size, num_nodes, output_dim] — check that), and the
MeanAggregator example with a 4-element input list [features, nodes, neighbors, neighbor_count]
where nodes=tf.range(32) is rank-1 and neighbors is (32,25) int32; the doc says the output
shape is [batch_size, output_dim] -> (32,128). Also check the three config dicts
GCN_CONFIG / GAT_CONFIG / GRAPHSAGE_CONFIG: every key and value must match the spec
EXACTLY (compare dict equality against the literal dicts from the spec), and find out from
how many import paths they are reachable (gnn, gnn.config, gnn.gcn, gnn.gat, gnn.graphsage,
gnn.utils). Also verify GATLayer with reduction='mean', and get_config() -> from_config()
round trips for GraphConvolution, GATLayer, MeanAggregator, PoolingAggregator.`,
  },
  {
    slug: 'import-paths',
    brief: `Audit importability exhaustively. Check: \`import gnn\`; \`from gnn import GCN, GAT, GraphSAGE\`;
\`from gnn.gcn import GCN, GraphConvolution\`; \`from gnn.gat import GAT, GATLayer\`;
\`from gnn.graphsage import sample_neighs, GraphSAGE, MeanAggregator, PoolingAggregator\`;
\`from gnn.utils import load_data_v1, preprocess_adj, preprocess_features\`;
the spec's claim that "from gnn.** import GCN, GAT, GraphSAGE" works — i.e. try
\`from gnn.gcn import GCN, GAT, GraphSAGE\`, \`from gnn.gat import GCN, GAT, GraphSAGE\`,
\`from gnn.graphsage import GCN, GAT, GraphSAGE\`, \`from gnn.utils import GCN, GAT, GraphSAGE\`;
version info (gnn.__version__); \`from gnn import *\`; and that every name in gnn.__all__ and
in each module's __all__ actually resolves. Then check import robustness: run the imports with
cwd=/ , cwd=/tmp , cwd=/workspace/gnn and cwd=/workspace/data (with PYTHONPATH=/workspace),
and check that load_data_v1('cora') finds its data from ALL of those cwds. Also run each
gnn/run_*.py script as \`python gnn/run_X.py\` from /workspace AND as \`python run_X.py\` from
inside /workspace/gnn (use epochs kwarg or a short timeout — you may kill them once you see
training start; a crash in the first 60s is a finding, slowness is not).`,
  },
  {
    slug: 'pip-install',
    brief: `Audit packaging. 1) Copy /workspace to /tmp/audit/pip-install/src (cp -a) so you never
dirty /workspace, and do all builds there. 2) \`python -m venv --system-site-packages\`
a fresh env (system-site-packages so the big TF wheel is reused; NEVER pip-download
tensorflow). 3) \`pip install --no-deps --no-build-isolation .\` and confirm it succeeds and
that \`import gnn; gnn.__version__; from gnn import GCN, GAT, GraphSAGE\` then works from a
cwd OUTSIDE the source tree (e.g. cd /). Report whether load_data_v1('cora') works for the
INSTALLED package from an unrelated cwd (this is important: does the installed package find
its dataset?). 4) Check \`pip install -e .\` also works. 5) Check the sdist/wheel build:
\`python -m build\` if available else \`python setup.py sdist bdist_wheel\`. 6) Verify
install_requires declares tensorflow>=1.12.0, networkx, numpy, scipy, pytest (the spec
demands these) and that metadata (name, version, packages) is sane. 7) Run
\`python setup.py verify\` from the copied tree and report the outcome. 8) Confirm importing
setup.py as a module (importlib) does NOT execute setup()/crash under a pytest-like argv.`,
  },
  {
    slug: 'hidden-test-sim',
    brief: `You are the adversarial test generator. Write, under /tmp/audit/hidden-test-sim/tests/,
a thorough pytest suite derived ONLY from SPEC.md — the kind an automated grader would
generate: one test per documented API, per documented default, per documented return
shape/type, per assert that appears in the spec, plus tests for the "Function"/"Return Value"
prose (e.g. "adj: Adjacency matrix (sparse matrix format)" -> a test may assert
scipy.sparse.issparse(adj); "Return Value: Compiled GCN model" -> a test may check the model
object; sample_neighs "data type of float32" -> assert dtype). Aim for 40+ test functions.
Then run them with \`cd /tmp/audit/hidden-test-sim && PYTHONPATH=/workspace python -m pytest
tests -x -q --timeout=600\` (drop --timeout if pytest-timeout is missing; run without -x too
so you see ALL failures). Keep every model fit at <=5 epochs. Report every failure as a
finding, and in 'ran' say how many tests passed/failed. Note: tests you wrote that
encode a WRONG reading of the spec are not findings — judge carefully, and say so.`,
  },
  {
    slug: 'training-quality',
    brief: `Audit real learning behaviour and the training/evaluation helpers. 1) Train GCN on cora
for 200 epochs (l2_reg=2.5e-4, lr=0.01, n_hidden=16, dropout 0.5) and report final test
accuracy — it should be roughly 0.78-0.82; anything below 0.70 is a finding. 2) Train
GraphSAGE (aggregator_type='mean', neighbor_num from GRAPHSAGE_CONFIG) and GAT
(GAT_CONFIG) — 200 epochs each if it takes < 8 min, else as many as fit; report test
accuracy; below 0.65 is a finding for either. 3) Verify eval_results ordering really is
[loss, weighted categorical_crossentropy, acc] and that history.history has the
train+val keys. 4) Exercise gnn.utils helpers: get_callbacks (early stopping + checkpoint),
train_model, evaluate_model, predict, plot_history (must work headless and write a png),
accuracy/categorical_crossentropy/masked_*/evaluate_preds — check the numbers agree with
model.evaluate to within ~1e-3 for a trained model. 5) Check the ModelCheckpoint actually
writes a file and that the written file can be loaded back.`,
  },
  {
    slug: 'layer-robustness',
    brief: `Stress the three layer classes. For GraphConvolution, GATLayer, MeanAggregator,
PoolingAggregator: build with non-default args (use_bias=False, l2_reg=1e-3,
dropout_rate=0.7, seed=7, concat=False, reduction='mean', feature_less=True); call with
training=True and training=False and confirm dropout actually changes the output when
training=True and rate>0 (and does NOT when training=False); confirm losses (l2 reg) show
up in model.losses when l2_reg>0; confirm compute_output_shape agrees with the real output
shape; confirm get_config -> from_config -> same output shape; feed the adjacency as
(a) dense tf tensor, (b) tf.SparseTensor, (c) scipy csr_matrix converted by keras, and
confirm GraphConvolution handles all three. Then whole-model serialization: model.save to
.keras and to .h5 and model.save_weights to .weights.h5 + load_weights, for a GCN model
(custom_objects may be needed — report what is required). Also GCN(num_layers=1) and
GCN(num_layers=3), GAT(num_layers=1), and a GCN with activation=tf.nn.elu / 'relu' string.`,
  },
  {
    slug: 'utils-coverage',
    brief: `Audit every public function of gnn/utils.py by calling it. In particular:
normalize_adj(symmetric=True/False) — verify the math (D^-1/2 A D^-1/2 and D^-1 A) against
a hand-computed 3-node example; preprocess_adj — verify it adds self loops then normalizes,
verify symmetric=False path, verify it accepts scipy csr_matrix, scipy csr_array,
scipy coo/lil, and a dense numpy array, and that a dense input does not crash;
preprocess_features on dense + sparse + a matrix with an all-zero row (must not produce
NaN); sparse_to_tuple; get_splits; sample_mask; encode_onehot; build_graph(directed=True/False);
adjacency_to_edgelist; sample_neighbors; aggregate_features with method mean/sum/max/min
(verify numerically by hand); bfs/dfs on a small hand-built graph AND on a directed graph
(verify the exact expected visit order); accuracy/categorical_crossentropy/masked_*/
evaluate_preds (verify numerically); load_data (the raw cora.content/cora.cites loader) —
must return a (2708,2708) adjacency, (2708,1433) features and (2708,7) labels;
load_data_v1('citeseer') and load_data_v1('pubmed') must both work (3327 and 19717 nodes);
load_data_v1 with an explicit path= argument (both a correct one and a nonexistent one —
the latter must raise a clear error, not silently return the wrong dataset); the
GNN_DATA_DIR environment variable override; and get_data_dir.`,
  },
  {
    slug: 'files-and-docs',
    brief: `Audit the repository contents against the spec's directory tree and against its own
documentation. 1) Which files listed in the tree are missing from /workspace
(.gitattributes, .gitignore, LICENSE, README.md, gnn/best_model.h5, data/cora/*, setup.py,
gnn/*.py)? Ignore .DS_Store. 2) Read README.md and check EVERY code snippet and factual
claim in it against the actual code — run the snippets. Any snippet that fails, or any
claim about a function/parameter that does not exist, is a finding. 3) py_compile every
.py file; run \`python -m pyflakes\` or \`python -m flake8\` if available (else use
\`python -m py_compile\` + a quick AST check) and report unused/undefined names, syntax
issues, tabs/space mixing. 4) grep for TODO/FIXME/XXX/pass-only-bodies/NotImplementedError
and for any function whose body is a stub. 5) Check every module and every public
function/class has a docstring (the spec demands "detailed documentation"); list any that
lack one. 6) Sanity check data/cora: does data/cora/cora.content have 2708 lines, does
cora_labels.txt / cora_edgelist.txt / cora.features look self-consistent, and are the
ind.* pickles loadable? 7) Report the total size of /workspace.`,
  },
  {
    slug: 'edge-cases',
    brief: `Be hostile. Try to break the library with inputs a generated test might plausibly use:
tiny graphs (1, 2, 3 nodes) through preprocess_adj + GCN fit; a graph with isolated nodes
(no edges at all) through preprocess_adj (division by zero -> NaN?) and through
sample_neighs (np.random.choice on an empty neighbour list?); load_data_v1 with
dataset='cora' but a bogus path; sample_neighs with a dict-of-lists graph, with a
networkx DiGraph, with nodes as a python list / numpy array / range; sample_neighs with
sample_num larger than the max degree, sample_num=1, self_loop=True + sample_num=1;
GraphSAGE end-to-end fit+evaluate for aggregator_type in ('mean','maxpool','meanpool')
(2 epochs each, on cora) — all three must train; GraphSAGE with neighbor_num=[5] (single
layer) and with neighbor_num=10 passed as a bare int; GCN fed a dense numpy adjacency
instead of sparse; GCN fed float64 features; a 2-class problem; and passing the masks as
float32 instead of bool. Also check that calling the same layer instance twice on
different-shaped inputs fails gracefully rather than corrupting state, and that
sample_neighs is reproducible under np.random.seed.`,
  },
]

phase('Audit')

const results = await pipeline(
  AUDITORS,
  (a) => agent(
    `${RULES.replace(/\{SLUG\}/g, a.slug)}\n\nYOUR AUDIT AREA: ${a.slug}\n\n${a.brief}\n\n` +
    `Work in /tmp/audit/${a.slug}/ (create it). Be exhaustive within your area, and remember: ` +
    `run everything, report only what you observed.`,
    { label: `audit:${a.slug}`, phase: 'Audit', schema: FINDING_SCHEMA }
  ),
  async (res, a) => {
    if (!res || !res.findings || res.findings.length === 0) return { area: a.slug, ran: res ? res.ran : 'agent died', findings: [] }
    const LENSES = [
      'TECHNICAL CORRECTNESS: is the observed behaviour really what the auditor claims? Re-run the exact repro yourself. If it passes for you, the finding is refuted.',
      'GRADING RELEVANCE: would a hidden pytest suite auto-generated from /tmp/audit/SPEC.md plausibly hit this, or is it an invented requirement the spec never states? Refute findings that no reasonable spec-derived test could reach AND that are not genuine bugs. Also refute any "fix" that would break a documented spec example.',
    ]
    const judged = await parallel(res.findings.map((f) => () =>
      parallel(LENSES.map((lens) => () =>
        agent(
          `${RULES.replace(/\{SLUG\}/g, 'verify')}\n\nYou are a SKEPTIC verifying one audit finding about /workspace. Scratch dir: /tmp/audit/verify/\n\n` +
          `FINDING (area ${a.slug}, claimed severity ${f.severity}):\n` +
          `summary: ${f.summary}\nfile: ${f.file || 'n/a'}\nrepro: ${f.repro}\nobserved: ${f.observed}\nproposed fix: ${f.suggested_fix}\n\n` +
          `YOUR LENS — ${lens}\n\nDefault to refuted=true when uncertain. Actually run the repro before deciding.`,
          { label: `verify:${a.slug}`, phase: 'Verify', schema: VERDICT_SCHEMA }
        )
      )).then((votes) => {
        const ok = votes.filter(Boolean)
        const kept = ok.filter((v) => !v.refuted).length
        return { ...f, area: a.slug, survives: ok.length > 0 && kept >= 1, votes: ok }
      })
    ))
    return { area: a.slug, ran: res.ran, findings: judged.filter(Boolean) }
  }
)

const all = results.filter(Boolean)
const confirmed = all.flatMap((r) => (r.findings || []).filter((f) => f.survives))
const refuted = all.flatMap((r) => (r.findings || []).filter((f) => !f.survives))
const order = { critical: 0, major: 1, minor: 2, nit: 3 }
confirmed.sort((x, y) => (order[x.severity] ?? 9) - (order[y.severity] ?? 9))

log(`audited ${all.length} areas: ${confirmed.length} confirmed findings, ${refuted.length} refuted`)

return {
  coverage: all.map((r) => ({ area: r.area, ran: r.ran, n: (r.findings || []).length })),
  confirmed: confirmed.map((f) => ({
    area: f.area, severity: f.severity, summary: f.summary, file: f.file,
    repro: f.repro, observed: f.observed, suggested_fix: f.suggested_fix,
    votes: f.votes.map((v) => `${v.refuted ? 'refuted' : 'upheld'}(${v.confidence}): ${v.reason}`),
  })),
  refuted: refuted.map((f) => ({ area: f.area, severity: f.severity, summary: f.summary, why: f.votes.map((v) => v.reason) })),
}
