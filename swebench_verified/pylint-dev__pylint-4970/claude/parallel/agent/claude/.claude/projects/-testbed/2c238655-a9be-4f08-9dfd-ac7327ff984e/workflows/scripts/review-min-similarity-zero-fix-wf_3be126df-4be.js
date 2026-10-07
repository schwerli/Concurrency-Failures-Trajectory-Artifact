export const meta = {
  name: 'review-min-similarity-zero-fix',
  description: 'Adversarially review the min-similarity-lines=0 fix from multiple lenses',
  phases: [
    { title: 'Review', detail: 'independent lenses over the working diff' },
    { title: 'Verify', detail: 'refute each finding' },
  ],
}

const CONTEXT = `Repo /testbed (pylint ~2.11 dev). A fix has been applied to the WORKING TREE (uncommitted; \`git diff\` shows it) for this issue:

  "Setting min-similarity-lines to 0 should stop pylint from checking duplicate code."
  Desired: min-similarity-lines=0 (and symilar's --duplicates=0) fully disables the duplicate-code check,
  including NO output at all from the standalone \`symilar\` tool.

The fix adds three \`if self.min_lines == 0: return\` guards in pylint/checkers/similar.py
(Similar.run, SimilarChecker.process_module, SimilarChecker.close), updates the option help text,
the two checked-in rcfiles, ChangeLog/whatsnew, and adds two tests.

Run things with /opt/miniconda3/envs/testbed/bin/python from cwd /testbed (plain \`python\` lacks astroid).
Start by running \`git diff\` to see the exact change.`

const LENSES = [
  {
    key: 'correctness',
    prompt: `${CONTEXT}

LENS: CORRECTNESS. Hunt for real defects introduced by this diff. Specifically probe:
 - Is \`self.min_lines\` guaranteed to be in sync with the configured value at every point each guard runs? Consider: rcfile, TOML, CLI flag, \`--jobs=N\` worker processes, the reduce_map_data path (which constructs a fresh SimilarChecker and hand-copies min_lines), and pylint.testutils.set_config. Construct a case where config says 0 but self.min_lines says 4, or vice versa - and check whether it is reachable in practice.
 - Does skipping process_module break anything downstream: stats keys (nb_duplicated_lines, percent_duplicated_lines), the RP0801 "Duplication" report table, get_map_data/combine_mapreduce_data, or any consumer of self.linesets?
 - Does the close() guard leave stats unset/stale in any path? Check pylint/lint/pylinter.py and pylint/lint/parallel.py for anything reading those stats.
 - Any exception risk (KeyError, ZeroDivisionError, TypeError) newly reachable?
 - Negative values, and min-similarity-lines=1.
EMPIRICALLY test each hypothesis before reporting it. Report only defects you could actually trigger or prove by code path.`,
  },
  {
    key: 'regression',
    prompt: `${CONTEXT}

LENS: REGRESSION / BEHAVIOR PRESERVATION. Prove the fix changes NOTHING when min-similarity-lines != 0.
 - Run the similarity-related suites and compare output before/after by stashing pylint/checkers/similar.py:
   \`git stash push pylint/checkers/similar.py\` ... \`git stash pop\`.
 - Diff the full \`pylint --reports=y\` output (including the Duplication table) with and without the patch at the DEFAULT setting, on a real directory such as pylint/checkers. They must be byte-identical.
 - Also compare at min-similarity-lines=0 with --reports=y: report any formatting delta in the Duplication table (e.g. "0" vs "0.000" for percent duplicated lines) and say whether any existing test covers it (check tests/unittest_reporting.py).
 - Check \`pylint --generate-rcfile\` output is still valid and that no test snapshots the changed help string.
 - Run: tests/checkers/unittest_similar.py, tests/unittest_reporting.py, tests/test_check_parallel.py, tests/test_self.py, tests/lint.
Report any real regression, and explicitly confirm the non-zero path is untouched.`,
  },
  {
    key: 'test-quality',
    prompt: `${CONTEXT}

LENS: TEST QUALITY. Assess the two added tests (tests/checkers/unittest_similar.py::test_set_duplicate_lines_to_zero and tests/test_self.py::TestRunTC::test_duplicate_code_disabled_with_min_similarity_lines_zero).
 - For EACH, determine empirically whether it actually fails without the source fix. Do this by stashing ONLY pylint/checkers/similar.py (\`git stash push pylint/checkers/similar.py\`), running the test, then \`git stash pop\`. Report which tests are discriminating and which are merely locks.
 - Is coverage complete? Which of the three guards (run / process_module / close) is exercised by a test, and which are not covered at all? Propose the minimal additional test(s) that would cover an uncovered guard - especially the reduce_map_data / --jobs>1 path and the close() guard. Write them in the exact established style of the surrounding file.
 - Do the tests match the file's conventions (naming, type annotations, use of redirect_stdout/pytest.raises(SystemExit), the _run_pylint vs _test_output helpers)?
 - Would the tests be flaky or environment-dependent (e.g. --persistent, cache dirs, path separators)?
Report concrete gaps and paste ready-to-apply test code for anything missing.`,
  },
  {
    key: 'design-altitude',
    prompt: `${CONTEXT}

LENS: DESIGN / SIMPLICITY / UPSTREAM-FIT. This is intended as an upstream pylint PR.
 - Are three guards the right number, or is one redundant? Argue concretely: for each guard, what observable behavior would change if it were removed TODAY? (Note: hash_lineset with min_common_lines=0 builds \`shifted_lines = [iter(lines[i:]) for i in range(0)]\` = [] so \`zip()\` is empty - meaning R0801 is already silent by accident. Verify this claim.)
 - Is guarding in process_module (skipping file ingestion) appropriate, or is it a layering violation / surprising side effect on self.linesets for anyone calling get_map_data()?
 - Should the condition be \`== 0\` or \`<= 0\`? What does pylint do elsewhere for "0 disables" options - find precedents in the codebase (grep for other numeric options that disable at 0, e.g. max-line-length or similar) and match the house style.
 - Review the help-text wording, ChangeLog/whatsnew wording, and rcfile comments against the repo's existing conventions (read neighbouring entries).
 - Is anything missing that an upstream reviewer would ask for: doc/ mention, CONTRIBUTORS.txt, copyright header, the symilar usage() text?
Report specific, actionable improvements only - no generic praise.`,
  },
]

phase('Review')
const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `review:${l.key}`, phase: 'Review', schema: {
    type: 'object',
    additionalProperties: false,
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'severity', 'file', 'detail', 'evidence'],
          properties: {
            title: { type: 'string' },
            severity: { enum: ['high', 'medium', 'low'] },
            file: { type: 'string' },
            detail: { type: 'string' },
            evidence: { type: 'string', description: 'command run and observed output, or precise code path' },
            suggested_fix: { type: 'string' },
          },
        },
      },
    },
  }}),
  (r, lens) => parallel((r?.findings || []).map(f => () =>
    agent(`Adversarially REFUTE this code-review finding about the working-tree diff in /testbed (pylint). Default to refuted=true unless you can reproduce the problem yourself.

Finding (from lens "${lens.key}"):
  title: ${f.title}
  severity: ${f.severity}
  file: ${f.file}
  detail: ${f.detail}
  claimed evidence: ${f.evidence}

Independently verify by running commands with /opt/miniconda3/envs/testbed/bin/python from cwd /testbed. Do NOT trust the claimed evidence - reproduce it. If the "problem" is pre-existing on main (check by stashing pylint/checkers/similar.py), it is NOT introduced by this diff - say so and mark it refuted-as-preexisting unless it is genuinely made worse.

IMPORTANT: leave the working tree exactly as you found it (git stash pop anything you stash).`,
      { label: `verify:${lens.key}:${f.title.slice(0, 32)}`, phase: 'Verify', schema: {
        type: 'object', additionalProperties: false,
        required: ['refuted', 'reasoning', 'is_preexisting'],
        properties: {
          refuted: { type: 'boolean' },
          is_preexisting: { type: 'boolean' },
          reasoning: { type: 'string' },
          revised_severity: { enum: ['high', 'medium', 'low', 'none'] },
        },
      }}
    ).then(v => ({ lens: lens.key, ...f, verdict: v }))
  ))
)

const all = results.flat().filter(Boolean)
const survived = all.filter(f => f.verdict && !f.verdict.refuted)
log(`${all.length} findings raised, ${survived.length} survived refutation`)
return { survived, refuted: all.filter(f => f.verdict && f.verdict.refuted).map(f => ({ lens: f.lens, title: f.title, why: f.verdict.reasoning })) }
