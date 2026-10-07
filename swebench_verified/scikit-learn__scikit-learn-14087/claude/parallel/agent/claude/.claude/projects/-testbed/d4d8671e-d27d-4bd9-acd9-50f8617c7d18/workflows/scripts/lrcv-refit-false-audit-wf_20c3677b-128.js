export const meta = {
  name: 'lrcv-refit-false-audit',
  description: 'Exhaustively audit LogisticRegressionCV refit=False path, find all latent bugs, verify adversarially',
  phases: [
    { title: 'Investigate', detail: 'parallel lenses over the refit=False code path' },
    { title: 'Verify', detail: 'adversarially verify each candidate bug by running code' },
    { title: 'Synthesize', detail: 'merge into a single minimal fix plan' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'
const FILE = '/testbed/sklearn/linear_model/logistic.py'

const SHARED = `
CONTEXT
=======
Repo: /testbed (scikit-learn 0.22.dev0, editable install already built).
Python interpreter WITH numpy/scipy/sklearn available: ${PY}
  (plain "python" has NO numpy -- you MUST use ${PY})
File under audit: ${FILE}
Class: LogisticRegressionCV.fit  (roughly lines 1960-2212)

KNOWN, ALREADY-REPRODUCED BUG (the user's report):
  LogisticRegressionCV(cv=5, solver='saga', tol=1e-2, refit=False).fit(X, y)
  on binary y raises "IndexError: too many indices for array: array is
  3-dimensional, but 4 were indexed" at the line
      w = np.mean([coefs_paths[:, i, best_indices[i], :] ...])
  Root cause: the branch guard in the "else:" (refit=False) block reads
  "if self.multi_class == 'ovr':" but self.multi_class defaults to 'auto'.
  The RESOLVED value lives in the local variable "multi_class" (computed by
  _check_multi_class). Everywhere else in fit() the local "multi_class" is
  used. So for 'auto'+binary the code wrongly takes the multinomial branch.

Relevant facts about fit() you should confirm rather than assume:
 - "l1_ratios_" is a plain PYTHON LIST: self.l1_ratios when
   penalty=='elasticnet', else [None].
 - binary problems collapse n_classes to 1, encoded_labels/classes sliced [1:].
 - multinomial sets iter_encoded_labels = iter_classes = [None].
 - shapes after reshaping: coefs_paths (n_classes, n_folds, n_Cs*n_l1, n_feat[+1]),
   scores (n_classes, n_folds, n_Cs*n_l1).
 - inside the per-class loop, for multi_class=='ovr' the loop rebinds
   scores = self.scores_[cls] and coefs_paths = self.coefs_paths_[cls];
   for multinomial it does "scores = scores[0]" (note: rebinding the same name
   that the outer reshaped array lives in).

YOUR JOB
========
Empirically map the FULL space of failures in the refit=False path. Do not
theorize only -- RUN code. You may write throwaway scripts to /tmp.
IMPORTANT: do NOT edit ${FILE} or any repo file. Read-only on the repo; write
only to /tmp. (You may create a *copy* under /tmp to experiment with, but never
modify the repo tree -- other agents are reading it concurrently.)

Use small fast datasets (e.g. n=100..200, 3 features, tol=1e-2, Cs=3,
max_iter small) so each fit takes well under a few seconds. Prefer
solver='liblinear'/'lbfgs' for speed where the config allows; use 'saga' only
where required (elasticnet).
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'notes'],
  properties: {
    notes: { type: 'string', description: 'What you ran and what you concluded, <=200 words' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'line', 'repro', 'observed', 'expected', 'proposed_fix', 'confidence'],
        properties: {
          title: { type: 'string' },
          line: { type: 'integer', description: '1-indexed line in logistic.py' },
          repro: { type: 'string', description: 'EXACT runnable python snippet that triggers it' },
          observed: { type: 'string', description: 'actual traceback/wrong value observed when running' },
          expected: { type: 'string' },
          proposed_fix: { type: 'string', description: 'concrete code change' },
          confidence: { type: 'string', enum: ['ran-and-confirmed', 'reasoned-only'] },
        },
      },
    },
  },
}

const LENSES = [
  {
    key: 'matrix',
    prompt: `LENS: exhaustive configuration matrix.

Run LogisticRegressionCV(refit=False).fit() over the CROSS PRODUCT of:
  - multi_class in {'auto', 'ovr', 'multinomial'}
  - target: binary (2 classes) AND multiclass (3 classes)
  - penalty in {'l2', 'l1', 'elasticnet'} with compatible solvers
    ('lbfgs'/'liblinear'/'saga'; elasticnet requires saga + l1_ratios=[...])
  - l1_ratios: None, [0.5] (single), [0.1, 0.9] (multiple)
  - Cs = 3 (int) and an explicit list
  - fit_intercept True and False
Also run the SAME configs with refit=True as the control, to establish what
"correct" looks like.

For EVERY cell record: pass/fail, traceback, and on success the shapes and
values of coef_, intercept_, C_, l1_ratio_, scores_, coefs_paths_, n_iter_.
Report every distinct failure as a separate finding, and ALSO report any
cell that silently produces a WRONG-SHAPED or nonsensical attribute
(e.g. C_ length != n_classes-ish, l1_ratio_ containing garbage, coef_ all
zeros, intercept_ wrong) even when no exception is raised.
Be exhaustive; state the cell counts in "notes" (e.g. "ran 54 cells, 11 failed").`,
  },
  {
    key: 'l1ratio',
    prompt: `LENS: the l1_ratio_ / l1_ratios_ bookkeeping in the refit=False branch.

Focus narrowly on these two lines in the refit=False ("else:") block:
    best_indices_l1 = best_indices // len(self.Cs_)
    self.l1_ratio_.append(np.mean(l1_ratios_[best_indices_l1]))

Questions to answer BY RUNNING CODE:
 1. "l1_ratios_" is a plain python list. "best_indices_l1" is a numpy array
    (one entry per fold). What exactly happens for
    (a) penalty='l2' (l1_ratios_ == [None]) and
    (b) penalty='elasticnet' with l1_ratios=[0.1, 0.9]?
    Demonstrate each in isolation at the interpreter (e.g.
    "import numpy as np; l = [None]; l[np.array([0,0,0])]") AND end-to-end
    through a real .fit() call (temporarily patching ONLY a /tmp copy of the
    file if needed to get past the earlier IndexError -- never the repo file).
 2. What does refit=True do for l1_ratio_ in the non-elasticnet case? What
    value ends up in self.l1_ratio_? Is None or 0.5-ish the established
    convention? Check the docstring for l1_ratio_ (around line 1877-1890)
    and check what LogisticRegressionCV with refit=True + penalty='l2'
    actually stores. This determines the correct fix.
 3. Is averaging l1_ratios across folds meaningful at all? What does the
    docstring promise for refit=False?
Report each concrete defect separately with a runnable repro.`,
  },
  {
    key: 'multinomial',
    prompt: `LENS: the multinomial refit=False path and variable-rebinding hazards.

Inside the per-class loop:
    if multi_class == 'ovr':
        scores = self.scores_[cls]
        coefs_paths = self.coefs_paths_[cls]
    else:
        scores = scores[0]          # <-- rebinds the outer reshaped array

Investigate BY RUNNING CODE (multi_class='multinomial', refit=False,
3-class y, and also binary y):
 1. Does the loop ever execute more than once for multinomial? (check
    iter_classes/iter_encoded_labels == [None]). If it only runs once, is
    the "scores = scores[0]" rebinding actually harmful, or latent-only?
    State which, with evidence.
 2. For multinomial refit=False, verify the shape math of
    "coefs_paths[:, i, best_indices[i], :]" against the real array shape,
    and whether the resulting w correctly feeds
    "self.coef_ = w[:, :X.shape[1]]" / "self.intercept_ = w[:, -1]".
 3. "best_indices = np.argmax(scores, axis=1)" -- for multinomial after
    "scores = scores[0]" scores is (n_folds, n_Cs*n_l1), so argmax(axis=1)
    is per-fold. Confirm that is the intent, and that len(best_indices) ==
    len(folds) in EVERY branch (ovr binary, ovr multiclass, multinomial).
    Does "for i in range(len(folds))" ever mismatch best_indices' length?
 4. Compare multinomial refit=False coef_ against a hand-computed average of
    the per-fold best coefficient paths taken straight out of
    clf.coefs_paths_ / clf.scores_. Do they agree numerically? Report a
    finding if not.`,
  },
  {
    key: 'upstream',
    prompt: `LENS: intent, tests, and history -- what is the CANONICAL fix?

Do NOT just guess a fix; establish what the project intends.
 1. Read the full LogisticRegressionCV docstring in ${FILE} (approx lines
    1700-1915), especially the refit, C_, l1_ratio_, coef_, scores_,
    coefs_paths_ entries. Quote what refit=False promises.
 2. Search the existing test suite for refit coverage:
      grep -n "refit" /testbed/sklearn/linear_model/tests/test_logistic.py
    Report which configurations are ALREADY tested with refit=False and which
    are not (this reveals the coverage hole that let the bug through).
 3. Use "git log -L" / "git log -S" in /testbed to find when
    "self.multi_class == 'ovr'" was introduced in that spot and whether
    sibling occurrences of self.multi_class vs local multi_class exist
    elsewhere in the file. Run:
      grep -n "self\\.multi_class" ${FILE}
      grep -n "multi_class ==" ${FILE}
    Report EVERY remaining self.multi_class use and judge, for each, whether
    it is correct or is the same class of bug. This is important -- list them
    all with line numbers and a verdict each.
 4. Recommend the minimal, upstream-idiomatic patch, and state exactly which
    NEW test(s) should be added to
    /testbed/sklearn/linear_model/tests/test_logistic.py (name + parametrize
    grid + assertions), matching the file's existing test style.
Report findings; for item 3 make each questionable self.multi_class use its
own finding.`,
  },
]

phase('Investigate')

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['is_real', 'is_in_scope', 'reasoning', 'corrected_fix'],
  properties: {
    is_real: { type: 'boolean', description: 'true only if you REPRODUCED it by running code' },
    is_in_scope: { type: 'boolean', description: 'true if fixing it is needed for the reported issue or is a same-root-cause defect on the refit=False path' },
    reasoning: { type: 'string' },
    corrected_fix: { type: 'string', description: 'the fix you would actually apply, or "none" if not real/out of scope' },
  },
}

const results = await pipeline(
  LENSES,
  l => agent(SHARED + '\n\n' + l.prompt, {
    label: `investigate:${l.key}`,
    phase: 'Investigate',
    schema: SCHEMA,
  }),
  (res, lens) => {
    if (!res || !res.findings || !res.findings.length) return []
    return parallel(res.findings.map(f => () =>
      agent(SHARED + `

LENS: adversarial verification. You are a SKEPTIC. Another agent claims this
defect exists in LogisticRegressionCV.fit's refit=False path:

  TITLE: ${f.title}
  LINE: ${f.line}
  CLAIMED REPRO:
${f.repro}
  CLAIMED OBSERVED: ${f.observed}
  CLAIMED EXPECTED: ${f.expected}
  PROPOSED FIX: ${f.proposed_fix}
  REPORTER CONFIDENCE: ${f.confidence}

Your default is REFUTED. To accept it you must actually RUN the repro with
${PY} and see the claimed failure. Then also judge SCOPE: is this a real
defect on the refit=False path (same root cause family as the reported issue),
or is it (a) not reproducible, (b) expected/documented behaviour, (c) a
pre-existing unrelated design wart that also affects refit=True, or (d) an
artifact of the reporter having patched files incorrectly?
If the repro fails because of a trivial typo in the snippet, fix the typo and
retry before refuting. If the fix itself is wrong or overreaching, say so and
give the corrected minimal fix.`,
      { label: `verify:${lens.key}:${f.line}`, phase: 'Verify', schema: VERDICT })
        .then(v => ({ ...f, lens: lens.key, verdict: v }))
    ))
  }
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter(f => f.verdict && f.verdict.is_real && f.verdict.is_in_scope)
const rejected = all.filter(f => !(f.verdict && f.verdict.is_real && f.verdict.is_in_scope))

log(`${all.length} candidate findings; ${confirmed.length} confirmed in-scope, ${rejected.length} rejected`)

phase('Synthesize')

const PLAN = {
  type: 'object',
  additionalProperties: false,
  required: ['root_cause', 'edits', 'tests', 'out_of_scope', 'risks'],
  properties: {
    root_cause: { type: 'string' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['line', 'old_code', 'new_code', 'why'],
        properties: {
          line: { type: 'integer' },
          old_code: { type: 'string', description: 'exact current text, copied verbatim from the file' },
          new_code: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
    tests: { type: 'string', description: 'exact test code to add to test_logistic.py' },
    out_of_scope: { type: 'string', description: 'defects deliberately NOT fixed, and why' },
    risks: { type: 'string' },
  },
}

const plan = await agent(SHARED + `

LENS: synthesis. Below are the CONFIRMED defects (each independently
reproduced and scope-checked by a skeptic) and the REJECTED candidates.

CONFIRMED:
${JSON.stringify(confirmed.map(f => ({ title: f.title, line: f.line, observed: f.observed, proposed_fix: f.proposed_fix, skeptic_fix: f.verdict.corrected_fix, skeptic: f.verdict.reasoning })), null, 2)}

REJECTED (do NOT fix these; listed so you know they were considered):
${JSON.stringify(rejected.map(f => ({ title: f.title, line: f.line, why: f.verdict ? f.verdict.reasoning : 'no verdict' })), null, 2)}

Produce ONE minimal, coherent patch plan for ${FILE}, plus tests.

Requirements:
 - MINIMAL and upstream-idiomatic. Fix the reported issue and same-root-cause
   defects on the refit=False path. Do not refactor, do not rename, do not
   reformat untouched code, do not "improve" unrelated things.
 - Match the file's existing style exactly (numpy-style, 79-col lines, the
   surrounding naming conventions).
 - For each edit, "old_code" MUST be text you copied VERBATIM from the
   current file (read it with Read/sed to be sure, including exact
   indentation) so that a literal string replacement will apply cleanly, and
   must be unique enough in the file to be unambiguous.
 - Tests must go in /testbed/sklearn/linear_model/tests/test_logistic.py,
   follow that file's existing conventions (pytest.mark.parametrize, existing
   helper/import style, no new imports unless already present), be FAST, and
   must FAIL before the patch and PASS after. Cover the reported case
   (multi_class='auto' + binary + refit=False) and the other confirmed cells.
 - In "risks", call out anything that could break existing tests (e.g. code
   or tests that read clf.l1_ratio_ / clf.C_ after refit=False).
Do NOT apply anything. Output the plan only.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high', schema: PLAN })

return { plan, confirmed_count: confirmed.length, confirmed, rejected_count: rejected.length }
