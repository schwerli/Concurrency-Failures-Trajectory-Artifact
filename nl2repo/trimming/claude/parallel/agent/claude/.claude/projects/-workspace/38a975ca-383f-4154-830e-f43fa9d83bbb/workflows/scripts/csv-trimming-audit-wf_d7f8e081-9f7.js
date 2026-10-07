export const meta = {
  name: 'csv-trimming-audit',
  description: 'Audit the csv_trimming implementation for spec conformance, harness robustness, and edge-case correctness',
  phases: [
    { title: 'Audit' },
    { title: 'Verify' },
    { title: 'Synthesize' },
  ],
}

const CONTEXT = `
CONTEXT
=======
A Python project has been implemented at /workspace. It is the "CSV-Trimming" library
(package \`csv_trimming\`, version 1.1.1), reproducing the upstream reference implementation
which is available read-only at /tmp/ct_repo (a git clone of
https://github.com/LucaCappelletti94/csv_trimming) and /tmp/dl/csv_trimming-1.1.1 (the PyPI sdist).

/workspace currently contains:
  conftest.py, pytest.ini, setup.py, README.md, LICENSE, MANIFEST.in, .gitignore,
  .github/{FUNDING.yml,workflows/python.yml},
  csv_trimming/{__init__.py,__version__.py,cli.py,logger.py,trim.py},
  tests/{__init__.py,test_cases.py,test_cli.py,test_readme.py,test_trimming.py,
         test_trim_with_correlation.py,test_version.py,test.csv,expected_result.csv,
         trim_correlation_simple.csv,trim_correlation_simple_cleaned.csv,
         documents/noisy/*.csv, documents/cleaned/*.csv}

The package is already \`pip install -e .\` installed; the \`csv-trim\` console script is on PATH.
\`python -m pytest\` from /workspace currently reports 10 passed.

The project will be graded by an "official test suite" that we do not have. It is almost
certainly the upstream tests/ directory (possibly overwriting the tests/*.py we shipped, and
possibly ALSO supplying its own data files, or possibly NOT supplying data files and relying
on ours). The grader may or may not re-install the package.

HARD RULES FOR YOU
==================
* DO NOT modify, create, or delete ANY file under /workspace. It is read-only for you.
  If you want to experiment, copy what you need into a scratch dir under /tmp/<your-own-unique-name>/.
* DO NOT run \`pip install\`, \`pip uninstall\`, or otherwise mutate the installed Python
  environment. Other agents depend on it. (Creating a throwaway venv under /tmp is allowed
  only if you truly need it, but prefer not to.)
* DO NOT run \`git\` write commands anywhere.
* Read files and run read-only commands freely.
`;

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'notes'],
  properties: {
    notes: { type: 'string', description: 'Short summary of what you checked and what you concluded.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'evidence', 'suggested_fix'],
        properties: {
          title: { type: 'string' },
          severity: { enum: ['critical', 'high', 'medium', 'low'] },
          evidence: { type: 'string', description: 'Concrete commands run and their output, or exact file:line, proving the problem is real.' },
          suggested_fix: { type: 'string', description: 'Concrete, minimal change to /workspace that would fix it. Do not apply it.' },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning', 'recommendation'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is NOT a real problem worth fixing.' },
    reasoning: { type: 'string' },
    recommendation: { enum: ['fix', 'ignore'] },
  },
};

const AUDITORS = [
  {
    key: 'spec-conformance',
    prompt: `${CONTEXT}

YOUR TASK: Spec-conformance audit.

Read /workspace/README.md and every file in /workspace/csv_trimming/. Then check the
implementation against this specification checklist, which the grader derived the project from.
The spec explicitly names the following public API surface, and the grader's tests may import
or call ANY of it:

  - \`from csv_trimming import CSVTrimmer\`
  - \`from csv_trimming.__version__ import __version__\`  (must be "1.1.1", must satisfy validate_version_code)
  - \`csv_trimming/__init__.py\` must define \`__all__ = ["CSVTrimmer"]\`
  - In csv_trimming/trim.py: module-level \`NAN_LIKE = NAN_LIKE_ARTIFACTS + UNICODE_NAN_LIKE_ARTIFACTS\`
    and \`SPACE_LIKE = sorted(SPACES + UNICODE_SPACES, key=lambda x: -len(x))\`
  - A module-level function \`is_nan(candidate: Any) -> bool\`
  - CSVTrimmer methods, with EXACTLY these names and signatures:
      __init__(self, correlation_callback: Optional[Callable[[pd.Series, pd.Series], Tuple[bool, pd.Series]]] = None)
      _mask_edges(self, mask: np.ndarray) -> np.ndarray
      trim_padding(self, csv) -> pd.DataFrame
      restore_header(self, csv) -> pd.DataFrame
      drop_empty_columns(self, csv) -> pd.DataFrame
      drop_duplicated_schema(self, csv) -> pd.DataFrame
      drop_empty_rows(self, csv) -> pd.DataFrame
      _deep_strip(self, string: str)
      trim_spaces(self, csv) -> pd.DataFrame
      restore_true_nan(self, csv) -> pd.DataFrame
      normalize_correlated_rows(self, csv) -> pd.DataFrame
      trim(self, csv, restore_header=True, drop_padding=True, drop_duplicated_schema=True) -> pd.DataFrame
  - csv_trimming/logger.py must expose a \`logger\`
  - csv_trimming/cli.py must define \`main()\`, support positional \`input_csv\` and \`output_csv\`
    and the flags \`--no-restore-header\`, \`--keep-padding\`, \`--keep-duplicated-schema\`,
    and be runnable both as \`csv-trim\` and as \`python -m csv_trimming.cli\`.
  - setup.py must configure console_scripts entry point \`csv-trim = csv_trimming.cli:main\`
    and declare deps including ugly_csv_generator>=1.1.4, random_csv_generator>=1.0.0, scipy>=1.10.0.

VERIFY EACH ITEM EMPIRICALLY with python -c / inspect.signature, not by eyeballing.
In particular actually run:
  python -c "import inspect, csv_trimming.trim as t; print(inspect.signature(t.CSVTrimmer.trim))"
  python -m csv_trimming.cli --help
  cd /tmp/<scratch> && python -m csv_trimming.cli <a copied csv> out.csv   (check it works from a foreign cwd)
Also compare /workspace/csv_trimming against /tmp/ct_repo/csv_trimming with diff -r and report ANY
divergence (there should be none; report it if there is).
Report only REAL gaps where the grader could plausibly fail. Do not report style nits.`,
  },
  {
    key: 'harness-robustness',
    prompt: `${CONTEXT}

YOUR TASK: Grading-harness robustness audit. This is the highest-value audit — think hard about
how the official test suite might be executed and find ways our layout breaks.

Enumerate and ACTUALLY TEST the plausible grading scenarios by copying /workspace to a scratch
dir under /tmp and mutating the COPY (never /workspace):

  1. Grader replaces /workspace/tests/*.py with its own copies but keeps our data files. (fine?)
  2. Grader drops in a whole tests/ directory INCLUDING data files.
  3. Grader deletes tests/ and supplies its own at a different path.
  4. Grader runs \`pytest\` from /workspace. Runs \`pytest tests/\`. Runs \`python -m pytest\`.
     Runs \`pytest /workspace/tests/test_cli.py\` from a DIFFERENT cwd (note: the upstream tests use
     RELATIVE paths like "tests/test.csv", so cwd matters — determine whether that is our problem
     or inherently the test suite's, and whether anything we control could mitigate it).
  5. Grader runs pytest with our pytest.ini (\`addopts = --doctest-modules\`) — confirm that
     --doctest-modules does not cause collection errors, e.g. that setup.py and conftest.py are
     not imported/executed as doctest modules, and that no docstring in csv_trimming/*.py is
     accidentally parsed as a failing doctest. Test this explicitly.
  6. \`pytest-readme\` is NOT installed in this environment (check \`pip list\`), yet the spec's
     dependency list mentions it. Our conftest.py has been made tolerant of its absence.
     Verify: (a) with pytest_readme absent, collection still works; (b) SIMULATE pytest_readme
     being present — you can create a fake \`pytest_readme\` module on PYTHONPATH in your scratch
     dir that mimics the real API (it writes a generated \`test_readme.py\` into the CWD) and
     confirm our conftest still behaves. Look at the real pytest-readme source if you can fetch it
     (\`pip download pytest-readme --no-deps -d /tmp/<scratch>/prd\`) to get the API exactly right.
     Report any incompatibility.
  7. A fresh install path: build an sdist/wheel from the COPY in scratch
     (\`python setup.py sdist\` or \`python -m build\` if available) and confirm setup.py is valid
     and the package + entry point are correctly declared. Do NOT install it into the live env;
     inspect the artifact contents instead (tar tzf / unzip -l).
  8. \`pip install .\` with NO network: check whether our install_requires can be satisfied purely
     from already-installed packages (compare each requirement against \`pip list\`). Flag any
     requirement that is NOT already satisfied, since that would make an offline install fail.
     Pay attention to extras too.

Report concrete, reproducible failure modes with the exact command and output.`,
  },
  {
    key: 'edge-cases',
    prompt: `${CONTEXT}

YOUR TASK: Behavioural / edge-case audit of the trimming logic itself.

Write throwaway scripts under /tmp/<scratch>/ that exercise csv_trimming.CSVTrimmer against
adversarial inputs and report anything that raises an unexpected exception or produces
obviously-wrong output. Cover at least:
  - completely empty DataFrame; DataFrame with 0 rows but columns; 1 row; 1 column
  - DataFrame that is entirely NaN / entirely empty strings / entirely unicode spaces
  - DataFrame with duplicate column names, and with numeric (non-string) column labels
  - mixed dtypes: ints, floats, datetimes, bools, None, np.nan, pd.NA
  - each individual method called standalone (trim_padding, restore_header, drop_empty_columns,
    drop_duplicated_schema, drop_empty_rows, trim_spaces, restore_true_nan,
    normalize_correlated_rows, _mask_edges, _deep_strip, is_nan)
  - all 8 combinations of trim(restore_header=..., drop_padding=..., drop_duplicated_schema=...)
    on each of tests/test.csv and the three tests/documents/noisy/*.csv
  - a correlation_callback provided vs not provided
  - the ugly_csv_generator fuzz path: replicate tests/test_trimming.py but with MANY more
    iterations (e.g. 400) and varied seeds, and with duplicate_schema=True as well as False,
    to find inputs that make trim() raise. Report the exact seed + repro if you find one.

IMPORTANT framing: this implementation intentionally matches the upstream reference exactly.
A crash that ALSO happens with the upstream code on an input the official tests never produce is
NOT worth "fixing" — deviating from upstream risks breaking the official tests. So for every
crash you find, state clearly whether it is reachable from the official test suite
(tests/test_cases.py, test_cli.py, test_trimming.py, test_trim_with_correlation.py,
test_version.py, test_readme.py as present in /workspace/tests) or only from your synthetic input.
Rank findings accordingly: only inputs reachable by the official tests are high severity.`,
  },
  {
    key: 'test-suite-determinism',
    prompt: `${CONTEXT}

YOUR TASK: Verify the shipped test suite passes reliably and deterministically, and hunt for
flakiness or ordering dependencies.

Do all of this by copying /workspace into a scratch dir under /tmp and running there
(so that any temp files the tests create do not pollute /workspace):
  - run the full suite 3 times; confirm 10 passed each time and identical results
  - run each test module in isolation (pytest tests/test_cases.py, etc.)
  - check for tests that depend on leftover state or on each other:
    note that tests/test_cli.py writes tests/output.tmp.csv and tests/output.tmp.cli.csv and
    removes them; tests/test_cases.py writes tests/trimmed.csv on failure and removes it at the
    end. Determine whether a failure mid-run leaves junk behind that could break a re-run.
  - tests/test_trimming.py uses random_csv + uglify with a fixed random.Random(1234) and
    seeds derived from the iteration index. Confirm it is genuinely deterministic across runs
    and across processes (PYTHONHASHSEED variation: run with PYTHONHASHSEED=0 and =12345).
  - confirm that running pytest twice in a row without cleaning .pytest_cache still passes
  - check whether tests/__init__.py being present vs absent changes collection (the grader
    might ship a tests/ dir without __init__.py). Test BOTH ways in your scratch copy.
  - check for any file our project writes into the repo during a test run that is NOT cleaned up,
    and whether .gitignore covers it.
Report reproducible problems only, with commands and output.`,
  },
];

phase('Audit');
log(`Running ${AUDITORS.length} independent auditors over /workspace`);

const audited = await pipeline(
  AUDITORS,
  (a) => agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA })
          .then((r) => ({ key: a.key, ...(r || { findings: [], notes: 'agent returned null' }) })),
  (r) => parallel((r.findings || []).map((f) => () =>
      agent(`${CONTEXT}

YOUR TASK: Adversarially REFUTE the following audit finding about /workspace.

  Auditor: ${r.key}
  Title: ${f.title}
  Severity claimed: ${f.severity}
  Evidence claimed: ${f.evidence}
  Suggested fix: ${f.suggested_fix}

Independently reproduce the claim yourself with concrete commands (copying to /tmp scratch if you
need to mutate anything — NEVER touch /workspace). Then decide:

  * Is the problem REAL and reachable by a plausible grading run of the official test suite?
  * Or is it hypothetical / already handled / a style nit / based on a misreading?
  * Crucially: would the suggested fix RISK BREAKING the official tests by deviating from the
    upstream reference implementation at /tmp/ct_repo? Fidelity to upstream is the single most
    important property of this project, because the official tests were written against upstream.
    A "fix" that changes csv_trimming/*.py behaviour away from upstream should be refuted unless
    the finding is a genuine crash reachable from the official tests.

Default to refuted=true when uncertain. Set recommendation='fix' ONLY if you reproduced a real
problem AND the fix is safe.`,
        { label: `verify:${r.key}:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then((v) => ({ auditor: r.key, ...f, verdict: v }))
    )).then((vs) => ({ key: r.key, notes: r.notes, verified: vs.filter(Boolean) }))
);

const results = audited.filter(Boolean);
const allFindings = results.flatMap((r) => r.verified);
const confirmed = allFindings.filter((f) => f.verdict && !f.verdict.refuted && f.verdict.recommendation === 'fix');

log(`${allFindings.length} raw findings, ${confirmed.length} survived adversarial verification`);

phase('Synthesize');
const summary = await agent(`${CONTEXT}

YOUR TASK: Completeness critic + synthesis.

Four auditors examined /workspace. Their notes:
${results.map((r) => `--- ${r.key} ---\n${r.notes}`).join('\n')}

Findings that SURVIVED adversarial verification (these should be fixed):
${confirmed.length ? JSON.stringify(confirmed.map((f) => ({ auditor: f.auditor, title: f.title, severity: f.severity, evidence: f.evidence, fix: f.suggested_fix, why: f.verdict.reasoning })), null, 2) : '(none)'}

Findings that were REFUTED (for your awareness, do not resurrect without new evidence):
${JSON.stringify(allFindings.filter((f) => !confirmed.includes(f)).map((f) => ({ title: f.title, why: f.verdict && f.verdict.reasoning })), null, 2)}

Now do two things:
1. Ask "what did nobody check?" — identify any remaining risk to the grade that none of the four
   auditors covered (an execution mode not tried, a spec requirement not verified, a file that
   should exist but does not). Actually go check the top few gaps yourself with commands.
2. Produce the final prioritized action list for the maintainer.

Return a concise markdown report with: (a) confirmed must-fix items with exact minimal edits,
(b) optional hardening, (c) anything you newly discovered, (d) an explicit "no action needed"
list of things verified good. Be precise and short.`,
  { label: 'synthesize', phase: 'Synthesize' });

return { summary, confirmedCount: confirmed.length, confirmed, notes: results.map((r) => ({ key: r.key, notes: r.notes })) };
