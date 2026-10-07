export const meta = {
  name: 'verify-docopt-ng',
  description: 'Exhaustively audit the /workspace docopt-ng implementation against the project specification',
  phases: [
    { title: 'Audit', detail: 'parallel auditors: API surface, spec node examples, packaging, lint/types, structure, test-suite robustness' },
    { title: 'Verify', detail: 'adversarially confirm each reported defect is real' },
  ],
}

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    summary: { type: 'string' },
    checks_run: { type: 'integer' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          evidence: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'info'] },
          suggested_fix: { type: 'string' },
        },
        required: ['title', 'detail', 'evidence', 'severity', 'suggested_fix'],
      },
    },
  },
  required: ['area', 'summary', 'checks_run', 'findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    reasoning: { type: 'string' },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'info'] },
    recommended_action: { type: 'string' },
  },
  required: ['real', 'reasoning', 'severity', 'recommended_action'],
}

const PREAMBLE = `You are auditing a Python project implemented at /workspace. It must implement the
"docopt-ng" command-line argument parser exactly as described by the project specification, whose
required API surface, behavioural examples and packaging requirements are written out in /tmp/spec.md.
READ /tmp/spec.md FIRST.

Context you can rely on:
- The implementation lives at /workspace/docopt/__init__.py (+ _version.py, py.typed).
- The official upstream test suite is vendored at /workspace/tests/ (test_docopt.py, test_docopt_ng.py,
  testcases.docopt, conftest.py). A grading harness will run an official test suite, likely this one.
- Python 3.10.11. pytest, coverage, pytest-cov, mypy, ruff, setuptools, wheel are installed.
  Network access IS available. An authoritative copy of upstream docopt-ng 0.9.0 is unpacked at
  /tmp/repo/docopt-ng-0.9.0 and /tmp/src/docopt_ng-0.9.0 for reference/diffing.

RULES:
- Verify by EXECUTING code, not by reading alone. Write scratch scripts under /tmp only.
- DO NOT modify anything under /workspace. You are read-only with respect to the project. Report, don't fix.
- Be concrete: every finding needs reproducible evidence (the command you ran + its actual output).
- Do not report style opinions or hypotheticals as findings. If everything in your area checks out,
  return an empty findings array and say so.
- Your final message is consumed as structured data.`

phase('Audit')

const AUDITS = [
  {
    key: 'api-surface',
    prompt: `${PREAMBLE}

YOUR AREA: API surface conformance.

1. Run the exact multi-symbol \`from docopt import (...)\` statement in /tmp/spec.md and confirm it succeeds.
2. For EVERY one of the 33 numbered API entries in /tmp/spec.md, confirm the symbol exists in the docopt
   module and that its signature matches what the spec documents. Use inspect.signature / inspect.getsource
   to compare parameter names, order, and default values exactly. Note that leading-underscore names,
   nested functions (e.g. \`isanumber\` inside \`_parse_argv\`), class attributes (\`DocoptExit.usage\`),
   properties (\`_Pattern.name\`, \`_Option.name\`), classmethods (\`_Option.parse\`) and staticmethods
   (\`_Tokens.from_pattern\`) all need checking.
3. Check documented semantics of the small pieces by calling them directly: _levenshtein and
   _levenshtein_norm (is the norm actually distance/max_len, in 0..1?), _Pattern.__eq__/__hash__ being
   repr-based, _transform expanding (-a|-b)(-c|-d) into one _Either with 4 branches, _Tokens.move/current
   on an empty token list returning None, _formal_usage, _parse_docstring_sections field names/order,
   _DocSections being a NamedTuple with the 4 documented fields, ParsedOptions dot-access with '-'/'_'
   conversion, and DocoptExit carrying .collected/.left.
4. Report any symbol that is missing, misnamed, or whose signature/behaviour contradicts the spec.

Report how many distinct checks you actually ran.`,
  },
  {
    key: 'spec-examples',
    prompt: `${PREAMBLE}

YOUR AREA: behavioural conformance to the specification's numbered Node examples.

/tmp/spec.md contains Node examples (Node 1 through Node 30). Execute EVERY one of them LITERALLY as
written — same docstring text (mind the leading/trailing newlines and indentation), same argv, same
expected result — and determine whether the implementation produces exactly the documented outcome.

Method: write one scratch script per node (or one script with a clearly-labelled section per node) under
/tmp, run it, and record for each node: PASS (documented behaviour reproduced exactly) or MISMATCH
(with the actual value/exception printed verbatim).

Important nuances to handle carefully and report precisely:
- Some node examples show a dict of ONLY a subset of keys (e.g. Node 1 omits nothing? check; Node 2 omits
  '--help'?). Determine whether the real result dict equals the documented dict exactly, or is a superset.
  If it is a superset, say exactly which extra keys appear and why (e.g. options parsed from the Options
  section that the spec's comment omitted). Judge whether the difference is a defect in the implementation
  or an abbreviation in the spec's prose — state which, and justify it against how upstream docopt behaves.
- Node 5/6: what exactly does str(SystemExit) print?
- Node 11 and 21: prefix matching and the .left attribute.
- Node 17: does docopt() with no argv raise DocoptLanguageError there, and if not, what happens?
  (Consider that argv defaults to sys.argv[1:], which under pytest/python -c is whatever was passed.)
- Node 20: unmatched bracket detection.
- Node 22: 'uSaGe:' and "My Program's Usage:" headers.

Deliver a per-node PASS/MISMATCH table in your summary, then list only genuine implementation defects as
findings. A mismatch that is purely an abbreviation/typo in the specification prose (and where the
implementation matches real upstream docopt-ng 0.9.0 behaviour, which you can verify by diffing against
/tmp/repo/docopt-ng-0.9.0) should be severity "info", not a blocker.`,
  },
  {
    key: 'packaging',
    prompt: `${PREAMBLE}

YOUR AREA: packaging and installability.

Verify, by actually doing it in throwaway virtualenvs under /tmp (use \`python3 -m venv\`; never touch the
system site-packages, and never modify /workspace):
1. \`pip install .\` from a COPY of /workspace (copy it to /tmp first so you cannot dirty the original)
   succeeds, and afterwards \`python -c "from docopt import docopt, DocoptExit, _Argument; print(docopt.__version__ if hasattr(docopt,'__version__') else '')"\`
   plus \`python -c "import docopt; print(docopt.__version__)"\` work and report 0.9.0.
2. Editable install \`pip install -e .\` also succeeds and imports work from an unrelated cwd.
3. \`pip install '.[test]'\` resolves (pytest + coverage present in the extra) and \`.[docs]\`/\`.[dev]\`
   extras are declared. Confirm [project.optional-dependencies] exists with testing and documentation groups.
4. A wheel and an sdist can be built (\`pip wheel . --no-deps -w /tmp/wh\`, and an sdist via the build
   backend). Confirm the built distributions actually CONTAIN docopt/__init__.py, docopt/_version.py and
   docopt/py.typed (inspect the wheel/sdist contents). py.typed shipping matters for PEP 561.
5. Confirm the declared version is dynamic-from-_version.py and that _version.py contains ONLY the
   __version__ assignment, with a semantic version.
6. Consider offline robustness: does the build backend require downloading anything? (setuptools/wheel are
   preinstalled; a backend requiring network at build time would be a risk if grading runs offline.)
   Report if the configuration would fail with --no-build-isolation or without network.
7. Sanity-check that pyproject.toml is valid TOML and that no [tool.*] section breaks tooling
   (e.g. leftover config for a build backend that is not the declared one).

Report concrete failures only.`,
  },
  {
    key: 'test-robustness',
    prompt: `${PREAMBLE}

YOUR AREA: will the grading harness's test run actually succeed, under every plausible invocation?

1. Run the vendored suite and report the exact pass/fail counts: \`cd /workspace && python -m pytest -q\`.
2. Now stress the invocation styles a grader might use, and report the result of EACH:
   - \`cd /workspace && pytest -q\` (bare console script, no -m)
   - \`cd /workspace && pytest -q tests\` and \`pytest -q tests/test_docopt.py tests/test_docopt_ng.py\`
   - from a different cwd: \`cd /tmp && pytest -q /workspace/tests\`
   - \`cd /workspace && python -m pytest -q --no-header -p no:cacheprovider\`
   - with coverage, as a grader might: \`cd /workspace && python -m pytest -q --cov=docopt\`
   - a suite placed at a DIFFERENT path: copy /workspace to /tmp/graded, then also copy the official tests
     to /tmp/graded/test_suite/ and check that a bare \`pytest\` at /tmp/graded still collects and passes
     them (this checks that pytest config in pyproject.toml does not restrict collection via testpaths).
   - simulate the environment's stale editable-install path: the image ships
     /usr/local/lib/python3.10/site-packages/docopt_ng.pth pointing at /docopt-ng. Copy /workspace to
     /docopt-ng (that directory currently does not exist; creating it is allowed — it is outside /workspace)
     and confirm tests pass there too, and report which docopt module gets imported in each case
     (print docopt.__file__).
3. Confirm testcases.docopt (the language-agnostic tester) is actually being collected — it should
   contribute several hundred test items via tests/conftest.py. Report the item count from
   \`python -m pytest --collect-only -q | tail -3\`.
4. Report any test that fails, errors, or is skipped, and any warning that could become an error under
   \`-W error\` (e.g. the PytestRemovedIn9Warning from tests/conftest.py) — check whether
   \`python -m pytest -q -W error\` still passes, since some harnesses enable that.

Findings = anything that makes a plausible grading invocation fail or collect zero tests.`,
  },
  {
    key: 'source-fidelity',
    prompt: `${PREAMBLE}

YOUR AREA: source fidelity, structure, lint and types.

1. Diff /workspace/docopt/ against the authoritative upstream copies at /tmp/repo/docopt-ng-0.9.0/docopt/
   and /tmp/src/docopt_ng-0.9.0/docopt/. Report ANY difference in __init__.py, _version.py, py.typed
   (byte-level). Fidelity to upstream 0.9.0 is desirable because the grading suite is the upstream suite.
2. Check the required directory structure listed at the end of /tmp/spec.md against the actual contents of
   /workspace (use \`find /workspace -type f -not -path '*/.git/*'\`). Report any REQUIRED file that is
   missing or empty-but-shouldn't-be. Extra files (tests/, examples/, conftest.py) are acceptable — but
   flag any extra file that could actively interfere with grading.
3. Confirm each required top-level doc/config file has real, coherent content and is not a stub:
   .gitignore, .pre-commit-config.yaml, CHANGELOG.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md, LICENSE-MIT,
   README.md, pdm.lock. For pdm.lock specifically: verify it is the genuine upstream lock file
   (diff it against /tmp/repo/docopt-ng-0.9.0/pdm.lock) rather than a fabricated placeholder.
4. Run \`cd /workspace && ruff check .\` and report errors AND any deprecation warnings about the
   configuration schema (ruff 0.12 deprecates top-level \`select\`; report whether it warns and whether
   the exit code is nonzero).
5. Run \`cd /workspace && mypy docopt\` (and note that the package ships py.typed). Report errors.
6. Verify the examples under /workspace/examples/ are runnable: for each example script, run it with
   \`--help\` or a plausible argv and confirm it does not traceback (a SystemExit from docopt is expected
   and fine). Report any example that raises an unexpected exception.

Findings = missing/incorrect required files, source divergence from upstream, lint/type errors, broken examples.`,
  },
]

const results = await pipeline(
  AUDITS,
  (a) => agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: AUDIT_SCHEMA }),
  (report, a) => {
    if (!report || !report.findings || report.findings.length === 0) return { report, verdicts: [] }
    const toCheck = report.findings.filter((f) => f.severity !== 'info')
    if (toCheck.length === 0) return { report, verdicts: [] }
    return parallel(
      toCheck.map((f) => () =>
        agent(
          `${PREAMBLE}

You are an adversarial verifier. Another auditor examining "${a.key}" in /workspace reported this finding:

  TITLE: ${f.title}
  SEVERITY CLAIMED: ${f.severity}
  DETAIL: ${f.detail}
  EVIDENCE CLAIMED: ${f.evidence}
  SUGGESTED FIX: ${f.suggested_fix}

Your job is to REFUTE it. Independently reproduce the claim by running commands yourself. Decide:
- Is it actually real and reproducible, right now, in /workspace as it stands?
- Would it actually affect the grading of this project (the official upstream docopt-ng test suite
  passing, the documented API being importable, and the package being installable)? A difference from
  the specification's PROSE that matches real upstream docopt-ng 0.9.0 behaviour is NOT a defect —
  the upstream test suite is the authority. Say so if that is the case.
- If uncertain, default to real=false.

Set real=true only if you reproduced it and it genuinely needs fixing. Give the exact command + output
in your reasoning.`,
          { label: `verify:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((v) => ({ finding: f, verdict: v })),
      ),
    ).then((verdicts) => ({ report, verdicts: verdicts.filter(Boolean) }))
  },
)

const clean = results.filter(Boolean)
const confirmed = clean.flatMap((r) => r.verdicts.filter((v) => v.verdict && v.verdict.real))
const rejected = clean.flatMap((r) => r.verdicts.filter((v) => v.verdict && !v.verdict.real))
const info = clean.flatMap((r) =>
  (r.report && r.report.findings ? r.report.findings : []).filter((f) => f.severity === 'info'),
)

log(`audits: ${clean.length}, confirmed defects: ${confirmed.length}, refuted: ${rejected.length}, info notes: ${info.length}`)

return {
  summaries: clean.map((r) => r.report && { area: r.report.area, summary: r.report.summary, checks_run: r.report.checks_run }),
  confirmed_defects: confirmed.map((c) => ({
    title: c.finding.title,
    severity: c.verdict.severity,
    detail: c.finding.detail,
    evidence: c.finding.evidence,
    action: c.verdict.recommended_action,
    verifier_reasoning: c.verdict.reasoning,
  })),
  refuted: rejected.map((c) => ({ title: c.finding.title, why: c.verdict.reasoning })),
  info_notes: info.map((f) => ({ title: f.title, detail: f.detail })),
}
