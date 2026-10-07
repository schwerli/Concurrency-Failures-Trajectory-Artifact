export const meta = {
  name: 'mlp-impl-audit',
  description: 'Adversarially audit the completed mlp coursework implementation for correctness and hidden-test compatibility',
  phases: [
    { title: 'Audit', detail: 'six independent lenses over mlp/ implementation' },
    { title: 'Verify', detail: 'adversarial refutation of each finding' },
  ],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'detail', 'evidence', 'severity', 'suggested_fix'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          detail: { type: 'string' },
          evidence: { type: 'string', description: 'Concrete reproduction: code run and observed vs expected output' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning', 'confidence'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is NOT a real problem' },
    reasoning: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
}

const CONTEXT = `
Repository: /workspace  (Python 3.11, numpy 2.4.6, no scipy, pytest available; data dir /workspace/data,
set MLP_DATA_DIR=/workspace/data; note mnist-train.npz is ABSENT and EMNISTDataProvider is broken under
numpy 2 for a pre-existing reason unrelated to this work - np.reshape(newshape=...)).

This is the Edinburgh MLP (Machine Learning Practical) coursework framework. Modules mlp/errors.py,
mlp/layers.py, mlp/learning_rules.py, mlp/models.py and mlp/optimisers.py were hollowed out
("pass  # TODO: implement") and have now been implemented. The task requirements are the YAML files in
/workspace/requirements/. Reference values used during implementation come from the notebooks in
/workspace/notebooks/ (notably ConvolutionalLayer_tests.ipynb, BatchNormalizationLayer_tests.ipynb,
03_Multiple_layer_models.ipynb, 06_Dropout_and_maxout.ipynb, 02_Single_layer_models.ipynb).

A hidden test suite (not present in the repo) will be run against this implementation. It was presumably
generated from a completed reference version of this same repo, so behaviour must match the canonical
upstream mlpractical solutions wherever a choice was arbitrary.

Existing self-written tests live in /workspace/agent_tests/ (117 passing).

RULES FOR YOU:
- READ-ONLY on /workspace: do NOT edit, create or delete any file under /workspace. Write scratch scripts
  under /tmp and run them with PYTHONPATH=/workspace.
- Actually RUN code to support every claim. A finding with no executed reproduction is worthless.
- Do not report style nits, missing type hints, or docstring wording. Only report things that could make a
  reasonable hidden test fail, or that are mathematically wrong.
- If you find nothing, return an empty findings array. Do not invent problems.
`;

phase('Audit')

const LENSES = [
  {
    key: 'signatures',
    prompt: `${CONTEXT}

YOUR LENS: requirement / signature compliance.
Read every file in /workspace/requirements/*.yaml. For EVERY acceptance signal listed there, verify by
running python that the callable exists with a compatible signature and does what the requirement says
(including property getter/setter pairs, e.g. "AffineLayer.params" must be a property with a setter).
Use inspect.signature to compare parameter names and defaults against the requirement text.
Also check the extra signature list in the task: SingleLayerModel.fprop(self, inputs),
MultipleLayerModel.fprop(self, inputs, evaluation=False), Optimiser.train(self, num_epochs, stats_interval=5)
returning (stats_array, keys_dict, run_time), etc.
Report any missing, misnamed, or signature-incompatible item.`,
  },
  {
    key: 'math',
    prompt: `${CONTEXT}

YOUR LENS: mathematical correctness, verified numerically and independently.
Write your own finite-difference gradient checker from scratch in /tmp (do NOT reuse
/workspace/agent_tests helpers) and check, for every layer in mlp/layers.py:
 - bprop against d(sum(fprop(x)*g))/dx
 - grads_wrt_params against d(sum(fprop(x)*g))/dparam
for AffineLayer, SigmoidLayer, ReluLayer, LeakyReluLayer(alpha!=default), ELULayer(alpha!=1), SELULayer,
TanhLayer, SoftmaxLayer, RadialBasisFunctionLayer (1-D and 2-D intervals), ReshapeLayer,
BatchNormalizationLayer, ConvolutionalLayer (including non-square kernels/inputs, several channels).
Also check every error function in mlp/errors.py: grad vs finite differences of __call__, and check the
softmax/sigmoid composite errors agree with the equivalent explicit layer+error composition.
Also verify ConvolutionalLayer against a brute-force nested-loop reference convolution you write yourself
(kernels flipped, 'valid' padding), and BatchNormalizationLayer against a brute-force reference.
Report any mismatch beyond finite-difference noise.`,
  },
  {
    key: 'canonical',
    prompt: `${CONTEXT}

YOUR LENS: does the implementation match the canonical/expected conventions where a hidden test could
compare exact values? Examine mlp/layers.py, mlp/errors.py, mlp/learning_rules.py, mlp/models.py,
mlp/optimisers.py and reason about each arbitrary choice, then check it against every reference value
available in /workspace/notebooks/*.ipynb and /workspace/scripts/*.py (run the notebook test cells
verbatim by extracting them with json). Specific choices to scrutinise:
 - BatchNormalizationLayer: initial gamma/beta values (ones/zeros vs random normal), epsilon = 1e-5,
   whether fprop(stochastic=False) should use batch statistics or running averages.
 - SELULayer: alpha=1.6733 lamda=1.0507 (the values in the source comment) vs full precision constants.
 - ReluLayer/LeakyReluLayer/ELULayer bprop keying off outputs vs inputs at exactly x==0.
 - Error functions: mean over all elements vs sum over dim then mean over batch; the grad divisor.
 - SoftmaxLayer.fprop max-subtraction, SoftmaxLayer.bprop formula.
 - RadialBasisFunctionLayer centre grid / scales convention (np.meshgrid ordering, scale = (high-low)/grid_dim).
 - DropoutLayer mask semantics (no 1/incl_prob rescaling in stochastic mode; scaling by incl_prob when
   stochastic=False; share_across_batch mask shape).
 - MultipleLayerModel.grads_wrt_params ordering relative to MultipleLayerModel.params.
 - Optimiser.train return value shape and the keys dict; the row for epoch 0.
Report anything where the current choice looks likely to disagree with the reference solution, citing the
evidence you found in the repo.`,
  },
  {
    key: 'edge',
    prompt: `${CONTEXT}

YOUR LENS: edge cases and robustness. Actually run each of these against the implementation and report
anything that raises, silently corrupts data, or gives a wrong answer:
 - integer-dtype inputs/params (the conv notebook test passes int64 arrays)
 - non-contiguous / reversed-view arrays as params (layer.params = kernels[:, :, ::-1, ::-1]) and as inputs
 - batch size 1 (batch norm variance 0), constant inputs (zero variance), incl_prob=1.0 dropout
 - float32 inputs mixed with float64 params
 - aliasing: does AffineLayer.params setter store references such that
   learning_rule.initialise(model.params) then update_params mutates the layer's actual arrays in place?
   Verify that training actually updates the layer's weights attribute (not a copy). Same for
   BatchNormalizationLayer gamma/beta and ConvolutionalLayer kernels/biases inside a MultipleLayerModel.
 - calling bprop/grads_wrt_params without a preceding fprop
 - DropoutLayer.bprop after fprop(stochastic=False)
 - repeated calls not accumulating state incorrectly
 - ConvolutionalLayer where kernel dim == input dim (output 1x1), and kernel dim 1
 - Optimiser with valid_dataset=None, with data_monitors=None, stats_interval larger than num_epochs,
   stats_interval=1, num_epochs=0
 - whether fprop mutates its inputs anywhere.`,
  },
  {
    key: 'notebooks',
    prompt: `${CONTEXT}

YOUR LENS: reproduce the course's own tests. Extract and execute, verbatim where possible, every assertion
cell from these notebooks against the current implementation:
 - /workspace/notebooks/ConvolutionalLayer_tests.ipynb (use do_cross_correlation=False AND also report what
   happens with True, explaining which convention the implementation uses and why that is or is not correct)
 - /workspace/notebooks/BatchNormalizationLayer_tests.ipynb
 - /workspace/notebooks/03_Multiple_layer_models.ipynb (the TanhLayer / ReluLayer test cells)
 - /workspace/notebooks/06_Dropout_and_maxout.ipynb (the DropoutLayer test cell - note the notebook version
   of the class uses a bare 'rng' global; adapt to mlp.layers.DropoutLayer)
 - /workspace/notebooks/02_Single_layer_models.ipynb (affine fprop / grads_wrt_params / error test cells)
 - /workspace/scripts/generate_conv_test.py and /workspace/scripts/generate_batchnorm_test.py with
   --student_id s1234567 (run them from /tmp with PYTHONPATH=/workspace so they do not write into /workspace)
Report every assertion that fails, and any script that errors out.`,
  },
  {
    key: 'integration',
    prompt: `${CONTEXT}

YOUR LENS: whole-system behaviour. Build and train several models end-to-end with the real data providers
(MLP_DATA_DIR=/workspace/data; use MNISTDataProvider('valid'/'test') and CCPPDataProvider since
mnist-train.npz is missing) covering: SingleLayerModel + SumOfSquaredDiffsError; MultipleLayerModel with
Affine/Sigmoid/Softmax + CrossEntropyError; Affine/Relu + CrossEntropySoftmaxError with each of the four
learning rules (GradientDescent, Momentum, RMSProp, Adam); a model containing DropoutLayer and
BatchNormalizationLayer; a model containing ConvolutionalLayer + ReshapeLayer; a model with
RadialBasisFunctionLayer. For each, assert the training error decreases and accuracy improves.
Then verify: (a) that Optimiser.eval_monitors really runs stochastic layers in evaluation mode
(dropout deterministic during evaluation) - prove it; (b) that the learning rule updates the model's own
parameter arrays in place; (c) that repeated Optimiser.train calls continue improving; (d) that
learning_rule.reset() works for every rule after initialise().
Report anything that fails to converge, errors, or behaves inconsistently.`,
  },
]

const results = await pipeline(
  LENSES,
  (lens) => agent(lens.prompt, { label: `audit:${lens.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (res, lens) => {
    const findings = (res && res.findings) || []
    if (!findings.length) return []
    return parallel(findings.map((f) => () =>
      parallel([
        `Try hard to REFUTE this claimed defect. Run code to check. Default to refuted=true unless you can reproduce a genuine problem.`,
        `Assess this claimed defect from the perspective of a HIDDEN TEST written against a canonical reference implementation of this repo: would a reasonable test actually fail because of it? Run code. If the claim is about an arbitrary convention, weigh the evidence in /workspace/notebooks and /workspace/requirements.`,
        `Assess whether the SUGGESTED FIX would itself break something else (regressions, other notebook reference values, other requirements). Run the existing suite: cd /workspace && python -m pytest agent_tests -q. refuted=true means "the finding should NOT be acted on".`,
      ].map((lensPrompt, i) => () =>
        agent(`${CONTEXT}

${lensPrompt}

CLAIMED DEFECT (from lens "${lens.key}"):
title: ${f.title}
file: ${f.file}${f.line ? ':' + f.line : ''}
severity: ${f.severity}
detail: ${f.detail}
evidence: ${f.evidence}
suggested_fix: ${f.suggested_fix}`,
          { label: `verify:${lens.key}:${i}`, phase: 'Verify', schema: VERDICT_SCHEMA })))
        .then((votes) => {
          const valid = votes.filter(Boolean)
          const refutations = valid.filter((v) => v.refuted).length
          return {
            ...f,
            lens: lens.key,
            votes: valid,
            survives: valid.length > 0 && refutations < Math.ceil(valid.length / 2),
          }
        })
    ))
  }
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter((f) => f.survives)
log(`${all.length} findings raised, ${confirmed.length} survived adversarial verification`)
return {
  confirmed: confirmed.map((f) => ({
    title: f.title, file: f.file, line: f.line, severity: f.severity, lens: f.lens,
    detail: f.detail, evidence: f.evidence, suggested_fix: f.suggested_fix,
    verdicts: f.votes.map((v) => ({ refuted: v.refuted, confidence: v.confidence, reasoning: v.reasoning })),
  })),
  refuted: all.filter((f) => !f.survives).map((f) => ({
    title: f.title, file: f.file, severity: f.severity, lens: f.lens,
    why_refuted: f.votes.filter((v) => v.refuted).map((v) => v.reasoning).slice(0, 2),
  })),
}
