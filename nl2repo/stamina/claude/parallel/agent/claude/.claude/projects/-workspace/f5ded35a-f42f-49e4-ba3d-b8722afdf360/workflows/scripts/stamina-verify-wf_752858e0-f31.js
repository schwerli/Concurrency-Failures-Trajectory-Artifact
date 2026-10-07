export const meta = {
  name: 'stamina-verify',
  description: 'Adversarially verify the /workspace stamina implementation against the spec, upstream behavior, and packaging',
  phases: [
    { title: 'Audit', detail: 'independent auditors: packaging, import surface, spec snippets, behavior diff, robustness' },
    { title: 'Verify', detail: 'adversarially confirm each reported finding' },
  ],
}

const CONTEXT = `
You are auditing a from-scratch Python implementation of the "stamina" retry library.

Layout:
- Implementation under audit: /workspace (src-layout: /workspace/src/stamina), installed EDITABLE
  into the system python, so \`import stamina\` picks it up.
- Spec acceptance criteria: /tmp/spec_requirements.md  (READ THIS FIRST)
- Ground-truth upstream reference for behavior: /tmp/sd/stamina-25.1.0/src/stamina
  and its test suite /tmp/sd/stamina-25.1.0/tests  (this exact version is the target;
  25.2.0 / 26.1.0 are also unpacked in /tmp/sd but are NEWER and INTENTIONALLY divergent —
  do NOT treat their behavior as required. Deliberate deviations from those newer versions
  are correct, not bugs.)
- Environment: Python 3.11, tenacity 9.1.2, structlog, anyio, trio installed;
  prometheus_client is deliberately NOT installed.

HARD RULES:
- Do NOT modify anything under /workspace. Read only. Do all scratch work in /tmp/<your-own-dir>.
- Do NOT run \`pip install\` in a way that touches the system environment's \`stamina\`
  (no \`pip install /workspace\`, no \`pip uninstall stamina\`). Use throwaway venvs
  (\`python3 -m venv /tmp/yourdir/venv\`) if you need to install anything.
- Verify claims by RUNNING code, not by reading alone.

Report ONLY real defects: things that would make the library wrong, unimportable,
uninstallable, or that violate the spec / upstream 25.1.0 behavior. Do not report
style preferences, missing docs, or "could be nicer". If you find nothing, say so plainly.
`

phase('Audit')

const AUDITS = [
  {
    key: 'packaging',
    prompt: `${CONTEXT}

YOUR TASK — packaging & installability.

1. Read /workspace/pyproject.toml.
2. In a throwaway dir, build the project from source and install it into a FRESH venv:
   - \`python3 -m build\` if available, else \`pip wheel /workspace --no-deps -w /tmp/x\`
     and also test \`pip install /workspace\` INSIDE a fresh venv (never the system env).
   - Test BOTH with build isolation and with --no-build-isolation.
3. In that fresh venv confirm: \`import stamina\`, \`stamina.__version__\` equals
   \`importlib.metadata.version("stamina")\`, the \`stamina.instrumentation\` subpackage is
   present, and \`py.typed\` is inside the installed package directory.
4. Confirm the sdist/wheel actually contain every module (no missing subpackage).
5. Check declared dependencies are installable and that nothing REQUIRED drags in
   prometheus_client or trio (that would change library behavior — see get_default_hooks).
6. Check requires-python vs the syntax actually used in the source (the project claims >=3.8;
   flag any syntax/stdlib use that breaks on 3.8/3.9 — check for PEP 604 unions evaluated at
   runtime, \`collections.abc\` generics at runtime, etc.). Remember \`from __future__ import
   annotations\` makes annotations lazy.

Return a concise list of concrete defects with evidence (commands + output).`,
  },
  {
    key: 'surface',
    prompt: `${CONTEXT}

YOUR TASK — import-surface conformance.

Write and run a script that imports EVERY name listed in section 1 of
/tmp/spec_requirements.md from EXACTLY the module path given there, plus every extra
name mentioned. Also verify:
- \`from stamina import *\` works and \`stamina.__all__\` contains only importable names.
- \`from stamina._config import *\`, \`from stamina._core import *\`,
  \`from stamina.instrumentation import *\`, and star-imports from each
  \`stamina.instrumentation._*\` submodule all work.
- \`stamina.CONFIG\` is the same object as \`stamina._config.CONFIG\`.
- \`stamina.__version__\` access emits no warnings.
- Accessing an unknown attribute on \`stamina\` and on \`stamina.instrumentation\` raises
  AttributeError (not something else).
- Signatures match section 2 of the spec exactly: use \`inspect.signature\` and compare
  parameter names, kinds (keyword-only vs positional), and defaults against BOTH the spec
  and /tmp/sd/stamina-25.1.0/src/stamina. Flag any mismatch.
- \`_compute_backoff\` can be called with the keyword names the spec uses
  (num, max_backoff, initial, exp_base, max_jitter).

Return concrete defects with evidence.`,
  },
  {
    key: 'spec-snippets',
    prompt: `${CONTEXT}

YOUR TASK — run the spec's own test snippets.

Section 3 of /tmp/spec_requirements.md contains verbatim test functions from the spec.
Turn ALL of them into a real pytest file in /tmp (add the imports they need:
pytest, tenacity, stamina, SimpleNamespace, metadata, guess_name, RetryDetails,
set_on_retry_hooks, get_on_retry_hooks, _make_stop). For the async ones use
\`@pytest.mark.anyio\` with an \`anyio_backend\` fixture parameterized over asyncio AND trio.
Add an autouse fixture that resets global state between tests
(set_active(True), set_testing(False), set_on_retry_hooks(None)).

Run them against the installed /workspace stamina. Report every failure with the
assertion output, and for each one say whether the upstream reference at
/tmp/sd/stamina-25.1.0 would ALSO fail it (run the same snippet against that source by
putting it first on sys.path in a subprocess) — that distinguishes "our bug" from
"the spec text is loose/wrong".

Return concrete defects with evidence.`,
  },
  {
    key: 'behavior-diff',
    prompt: `${CONTEXT}

YOUR TASK — behavioral equivalence with upstream 25.1.0.

1. Diff /workspace/src/stamina against /tmp/sd/stamina-25.1.0/src/stamina. For EVERY
   difference, decide whether it can change runtime behavior. Docstrings and type comments
   cannot; anything else must be justified.
2. Run the upstream suite against the implementation under audit:
   \`cd /tmp/sd/stamina-25.1.0 && python3 -m pytest tests -q\` (this imports the installed
   /workspace stamina). Confirm it passes; investigate anything that does not.
3. Write differential tests: for a list of scenarios, run the same code against
   (a) the installed /workspace stamina and (b) upstream 25.1.0's source (subprocess with
   /tmp/sd/stamina-25.1.0/src first on sys.path), and compare results EXACTLY.
   Cover at least: repr of Attempt / RetryingCaller / BoundRetryingCaller /
   AsyncRetryingCaller / BoundAsyncRetryingCaller; Attempt.num and Attempt.next_wait
   sequences; _compute_backoff over many (num, max, initial, base, jitter) combos with
   random seeded identically; _make_stop for all four attempts/timeout combinations
   (including 0 and negative values); retry_context with attempts=None and timeout=None;
   behavior when the predicate itself raises; retrying a callable that raises
   BaseException (e.g. KeyboardInterrupt); hooks that raise; nested retry_context;
   reusing one retry_context iterator twice; reusing a @retry-decorated function
   concurrently from two threads; the exact ordering of hook context-manager
   enter/exit vs attempts; guess_name on odd objects (partial, lambda, class,
   instance without __qualname__, builtins).

Return only differences that are real behavioral divergences, with evidence.`,
  },
  {
    key: 'robustness',
    prompt: `${CONTEXT}

YOUR TASK — adversarial bug hunt on the implementation itself (read
/workspace/src/stamina/*.py and /workspace/src/stamina/instrumentation/*.py closely,
then try to BREAK it by running code).

Focus on things that would show up in a hidden test suite:
- Thread safety of the lazy hook initialization in _config.py (hammer it from many
  threads; look for double-init or races). Also _Config's lock usage.
- State leakage in _RetryContextIterator: it is a dataclass reused across calls via
  \`with_name\`; check \`_cms_to_exit\` sharing between concurrent/sequential calls of the
  SAME decorated function, and between two functions decorated by the SAME decorator
  instance.
- The async path: \`__aiter__\` mutates \`self._t_a_retrying\`. What happens if the same
  \`retry_context(...)\` object is iterated twice, or two async tasks iterate concurrently?
  Compare against upstream 25.1.0 — if upstream has the same flaw it is NOT a defect here.
- Testing mode interacting with attempts=None, cap=True, attempts=0.
- \`set_active(False)\` mid-iteration.
- Exceptions raised inside a hook, and hooks returning a non-context-manager object.
- \`retry\` applied to non-functions: classmethod/staticmethod, functools.partial,
  callables without __name__, async generators.
- Deep recursion / very large attempt counts, timeout=0, wait_max=0, negative values.
- Anything that raises an unexpected exception type or hangs.

For each candidate defect, FIRST check whether upstream /tmp/sd/stamina-25.1.0 behaves
identically. Only report it if the implementation under audit is WORSE than upstream, or
if it violates /tmp/spec_requirements.md. Include a runnable repro.`,
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          detail: { type: 'string' },
          repro: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'detail', 'repro'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    reasoning: { type: 'string' },
    recommendedFix: { type: 'string' },
  },
  required: ['real', 'reasoning', 'recommendedFix'],
}

const results = await pipeline(
  AUDITS,
  a => agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (res, a) => {
    if (!res || !res.findings || !res.findings.length) return []
    return parallel(res.findings.map(f => () =>
      agent(`${CONTEXT}

YOUR TASK — adversarially VERIFY (i.e. try hard to REFUTE) this reported finding about
the /workspace stamina implementation. Default to refuted=false ("real": false) unless you
can reproduce the defect yourself by running code.

Reported by the "${a.key}" auditor:
  title: ${f.title}
  file: ${f.file}
  severity: ${f.severity}
  detail: ${f.detail}
  repro: ${f.repro}

Steps:
1. Run the repro yourself. Does it actually fail / misbehave?
2. Run the SAME repro against upstream /tmp/sd/stamina-25.1.0/src (subprocess, that path
   first on sys.path). If upstream behaves identically, this is NOT a defect of this
   implementation (the target is byte-for-byte behavioral parity with 25.1.0) — unless it
   also violates /tmp/spec_requirements.md, in which case say so explicitly.
3. Decide: is this a real defect that should be FIXED in /workspace? Set "real"
   accordingly and give a minimal, concrete recommended fix.

Do not modify /workspace.`,
        { label: `verify:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then(v => ({ ...f, source: a.key, verdict: v }))
    ))
  }
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter(f => f.verdict && f.verdict.real)
const rejected = all.filter(f => !f.verdict || !f.verdict.real)

log(`audited: ${all.length} candidate findings, ${confirmed.length} confirmed`)

return {
  confirmed: confirmed.map(f => ({
    title: f.title, file: f.file, severity: f.severity, source: f.source,
    detail: f.detail, repro: f.repro, fix: f.verdict.recommendedFix,
  })),
  rejectedTitles: rejected.map(f => `${f.title} (${f.source}) — ${f.verdict ? f.verdict.reasoning.slice(0, 200) : 'no verdict'}`),
}
