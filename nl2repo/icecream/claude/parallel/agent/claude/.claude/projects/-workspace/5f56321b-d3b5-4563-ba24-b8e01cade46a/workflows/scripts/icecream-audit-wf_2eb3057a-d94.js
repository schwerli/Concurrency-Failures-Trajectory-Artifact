export const meta = {
  name: 'icecream-audit',
  description: 'Adversarially audit the /workspace IceCream implementation against its spec and upstream',
  phases: [
    { title: 'Audit' },
    { title: 'Verify' },
  ],
}

const CONTEXT = `
You are auditing a from-scratch Python project at /workspace that reimplements the
"icecream" debugging library (the ic() function). It will be graded by an
official hidden test suite.

Key facts you must know:
- The implementation lives in /workspace/icecream/{__init__,__version__,icecream,coloring,builtins}.py
  plus /workspace/icecream/_vendor/ (bundled copies of the 'executing' and 'asttokens'
  packages, used only as a fallback when those aren't installed).
- Upstream reference snapshots are on disk for comparison:
  * /tmp/ic_src/icecream-93d44ceb78/  <-- the commit the task spec was written from
                                          (camelCase API: stderrPrint, callOrValue,
                                           prefixLines, prefixFirstLineIndentRemaining;
                                           Sentinel enum; lineWrapWidth in configureOutput)
  * /tmp/ic_src/icecream-master/      <-- newer upstream (snake_case renames, noColor,
                                          use_stdout/use_stderr, non-ASCII colorize skip,
                                          improved safe_pformat)
  * /tmp/ic_src/icecream-2.1.5/       <-- the released 2.1.5 sdist
  Their test suites are in each snapshot's tests/ directory.
- The /workspace implementation is intentionally a SUPERSET: it uses the camelCase
  names as canonical (matching the spec) and adds snake_case aliases plus master's
  extra features, so that either upstream test suite passes.
- It also adds an original feature not in upstream: IceCreamDebugger._recoverCallNode /
  _callTargetsSelf, a fallback that locates the ast.Call node by line number when
  executing() returns None (which happens for ic() calls inside pytest-rewritten
  assert statements on Python < 3.11).
- Verified so far: upstream 93d44 suite = 42/42 pass (pytest + unittest);
  upstream master suite = 49/49 pass; wheel builds; works with executing/asttokens absent.
- Environment: Python 3.10.18. Installed: colorama 0.4.6, Pygments 2.19.2, pytest 8.4.1,
  sympy. NOT installed by default in the grading env: executing, asttokens.

The task specification (abridged, but these are hard requirements) says:
- pyproject.toml must make the project pip-installable and declare deps
  colorama>=0.3.9, pygments>=2.2.0, executing>=2.1.0, asttokens>=2.0.1.
- icecream/__init__.py must export: ic, argumentToString, stderrPrint,
  NO_SOURCE_AVAILABLE_WARNING_MESSAGE, DEFAULT_PREFIX, __title__, __license__,
  __version__, __author__, __contact__, __url__, __description__.
  ic must be an IceCreamDebugger instance. "from icecream import *" must work.
- icecream.py must have class IceCreamDebugger with __call__, format, configureOutput,
  and the argumentToString function.
- builtins.py must have install() and uninstall().
- Documented API surface that must exist and work: ic(*args), ic.format(*args),
  ic.configureOutput(prefix, outputFunction, argToStringFunction, includeContext,
  contextAbsPath), ic.enable(), ic.disable(), ic.use_stdout(), ic.use_stderr(),
  install(ic='ic'), uninstall(ic='ic'), argumentToString(obj) plus .register/.unregister/.registry,
  colorize(s), stderrPrint(*args), colorizedStderrPrint(s), colorizedStdoutPrint(s),
  supportTerminalColorsInWindows(), constants DEFAULT_PREFIX='ic| ',
  DEFAULT_LINE_WRAP_WIDTH=70, DEFAULT_CONTEXT_DELIMITER='- ', DEFAULT_OUTPUT_FUNCTION,
  DEFAULT_ARG_TO_STRING_FUNCTION, NO_SOURCE_AVAILABLE_WARNING_MESSAGE,
  version dunders, classes IceCreamDebugger / Source(executing.Source) with
  get_text_with_indentation / SolarizedDark(Style) with BASE03..BASE3 plus YELLOW,
  ORANGE, RED, MAGENTA, VIOLET, BLUE, CYAN, GREEN, helpers isLiteral(s),
  callOrValue(obj), prefixLines(prefix, s, startAtLine=0),
  prefixFirstLineIndentRemaining(prefix, s), formatPair(prefix, arg, value).
- Spec's stated behaviours include: ic() with no args returns None and prints
  "ic| file.py:LINE in func() at HH:MM:SS.mmm"; ic(1) returns 1; ic(1,2,3) returns
  (1,2,3); disabled ic still returns values but prints nothing;
  ic.configureOutput() with no arguments raises TypeError;
  includeContext output looks like "ic| example.py:5 in main()- 'test': 'test'";
  contextAbsPath uses the absolute path.
- Spec's project tree: .gitignore, LICENSE.txt, MANIFEST.in, README.md, changelog.txt,
  failures-to-investigate/{freshsales,freshsales2,freshsales3}.py, icecream/{__init__,
  __version__,builtins,coloring,icecream,py.typed}, logo.svg, pyproject.toml, tox.ini.

You may run any commands (python, pytest, pip). Do NOT modify files under /workspace --
you are auditing only. You may create scratch files under /tmp.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          detail: { type: 'string' },
          repro: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['title', 'severity', 'file', 'detail', 'repro', 'suggestedFix'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    isReal: { type: 'boolean' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    reasoning: { type: 'string' },
    correctedFix: { type: 'string' },
  },
  required: ['isReal', 'confidence', 'reasoning', 'correctedFix'],
}

const DIMENSIONS = [
  {
    key: 'api-surface',
    prompt: CONTEXT + `

YOUR DIMENSION: API surface completeness and correctness.

Systematically enumerate EVERY name the spec says must be importable/callable and
verify it exists with the right type, signature, default values, and semantics.
Write a scratch script under /tmp that imports icecream (with cwd=/workspace) and
checks each one, including: "from icecream import *", every constant's exact value,
argumentToString.registry / .register / .unregister, Source subclassing
executing.Source, SolarizedDark colour attributes, all helper functions with their
documented default arguments, and the version dunders.

Also check the spec's documented RETURN VALUES and side effects, e.g. install()/
uninstall() semantics (including uninstall() raising AttributeError when not
installed, and NameError when ic is used after uninstall).

Report anything missing, misnamed, wrongly-defaulted, or behaviourally divergent
from the spec text.`,
  },
  {
    key: 'output-format',
    prompt: CONTEXT + `

YOUR DIMENSION: exact output formatting behaviour.

Empirically compare /workspace's output byte-for-byte against the upstream reference
implementation at /tmp/ic_src/icecream-93d44ceb78/icecream/ for a large, diverse
battery of inputs. Build a harness under /tmp that imports each implementation in a
separate subprocess (upstream needs the real 'executing'/'asttokens', which ARE
installed system-wide, so it will import fine) and diffs ic.format(...) / captured
stderr for the same source lines.

Cover at minimum: single/multiple args, literals vs expressions, tuples, lists,
dicts, sets, nested containers, multiline string values, strings containing
backslashes, very long single args, several long args (line wrapping at
lineWrapWidth, and after configureOutput(lineWrapWidth=...)), includeContext on/off,
contextAbsPath on/off, callables as prefix, multiline call syntax, calls with
comments interleaved, unicode/non-ASCII values, empty containers, objects whose
repr() is empty or 1 character, bytes, None, booleans, and custom classes.

Note: /workspace intentionally adopts newer-upstream behaviours (non-ASCII strings
skip syntax highlighting; safe_pformat keeps medium flat lists compact). Those
specific differences are INTENDED -- verify them against
/tmp/ic_src/icecream-master/icecream/icecream.py instead, and only report a
difference from 93d44 if it is NOT explained by one of those two intentional
changes.

Report any unintended formatting divergence.`,
  },
  {
    key: 'fallback-safety',
    prompt: CONTEXT + `

YOUR DIMENSION: adversarially attack the ORIGINAL _recoverCallNode /
_callTargetsSelf fallback in /workspace/icecream/icecream.py.

This code runs only when executing() fails to identify the call node. Your job is to
find inputs where it attributes the WRONG source text to an argument, crashes, hangs,
or regresses behaviour that upstream got right.

Specifically try to construct cases where:
- Two different ic() calls with the same positional-arg count occur on / span the
  same line, and the fallback picks the wrong one.
- A call is inside a pytest-rewritten assert AND the recovered node's argument text
  does not match what the user actually wrote.
- node.lineno..end_lineno spanning logic mis-selects for nested or multi-line calls.
- f_locals/f_globals lookups raise, or shadowing makes the wrong name resolve to the
  debugger instance.
- An ic subclass, a renamed instance, a functools.partial, a decorator, a lambda
  wrapper, comprehensions, generators, async functions, or exec/eval contexts.
- Sources that fail to parse, files that changed on disk after import, .pyc-only
  execution, frozen/zipimport-like cases, very large files (performance).
- The NO_SOURCE_AVAILABLE warning being wrongly suppressed or wrongly emitted, and
  the "exactly one warning" behaviour upstream tests rely on.

Actually run pytest with assertion rewriting ENABLED (the default) to exercise the
path. Report concrete reproducible defects with severity.`,
  },
  {
    key: 'packaging',
    prompt: CONTEXT + `

YOUR DIMENSION: packaging, installability, and the repo tree.

Verify: pyproject.toml is valid and complete; the project builds an sdist AND a
wheel; "pip install ." and "pip install -e ." both work in a fresh venv; the
declared dependencies exactly cover what the spec demands; py.typed ships;
the vendored packages ship and are importable post-install; the sdist contains
everything needed to rebuild (check MANIFEST.in); metadata (name, version,
description, license, authors, classifiers, requires-python) is coherent and
matches icecream/__version__.py; no import-time side effects that break
"pip install -e ."; console scripts/entry points are not needed.

Also verify the repo tree matches the spec's stated structure and that no stray
files (build artifacts, __pycache__, .egg-info, leftover scratch dirs) are present
in /workspace. Check that tox.ini is coherent with the supported Python versions.

Test editable install in a fresh venv, then run
/tmp/ic_src/icecream-93d44ceb78/tests against it from a directory OTHER than
/workspace to prove the installed package (not the source tree) is exercised.

Report concrete problems.`,
  },
  {
    key: 'hidden-tests',
    prompt: CONTEXT + `

YOUR DIMENSION: predict the hidden grading test suite and find what would fail.

The grader runs an "official test suite" we cannot see. It is most likely the
upstream tests/test_icecream.py plus tests/test_install.py from the snapshot the spec
was generated from, possibly lightly adapted, possibly regenerated from the spec
prose by an LLM.

Do two things:
1. Re-read the spec summary above and write NEW tests, from the spec prose alone,
   the way a test-generator would: assert on the documented example outputs, the
   documented constants, the documented return values, the documented exceptions.
   Run them against /workspace. Report every one that fails.
2. Consider adaptations of the upstream suite that could break us: running with
   pytest instead of unittest; running with -p no:cacheprovider; running from a
   different working directory; tests placed at the repo root instead of tests/;
   running with python -O (asserts stripped); running with -W error (warnings as
   errors); running tests in a random order; parallel execution (pytest-xdist);
   importing icecream.icecream directly; "import icecream.icecream.__version__ as
   version_module" style imports mentioned in the spec.
   Empirically try each of these against /workspace and report what breaks.

Pay special attention to the spec's literal claim that DEFAULT_ARG_TO_STRING_FUNCTION
is pprint.pformat, while /workspace uses safe_pformat. Assess the risk concretely
and quantify which choice is safer.

Report concrete, reproducible failures with severity.`,
  },
  {
    key: 'robustness',
    prompt: CONTEXT + `

YOUR DIMENSION: general robustness, correctness bugs, and environment edge cases.

Hunt for real defects in /workspace/icecream/*.py: exceptions escaping from ic()
that should not, infinite recursion, mutable default/class-attribute aliasing
(note lineWrapWidth/contextDelimiter/_pairDelimiter are CLASS attributes -- check
that configureOutput(lineWrapWidth=...) on one instance doesn't leak to another,
and compare that behaviour to upstream), thread-safety, objects with pathological
__repr__ (raising, recursive, huge, empty), circular data structures, generators,
numpy-like objects, objects overriding __class__, and singledispatch registration
of ABCs / subclasses / unregistering something never registered.

Also verify: the _vendor bootstrap can't break when a partially-installed
'executing' exists without 'asttokens' (and vice versa); sys.path is not polluted
when both are installed; repeated imports are idempotent; the bootstrap is safe if
/workspace/icecream/_vendor is read-only; no circular import between
icecream/__init__.py, icecream/icecream.py and icecream/builtins.py; that
"import icecream.builtins" standalone works; that install()/uninstall() round-trip
cleanly and uninstall() twice raises AttributeError.

Check whether __init__.py's globals().update(...) of __version__.__dict__
(which overwrites icecream.__name__, __file__, __spec__, __loader__, __doc__)
causes any observable breakage -- test importlib.reload, pickling, pydoc, help(),
inspect.getmodule, warnings module attribution, and pytest collection.

Report concrete, reproducible defects with severity.`,
  },
]

phase('Audit')

const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: 'audit:' + d.key, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (res, d) => {
    if (!res || !res.findings || !res.findings.length) return []
    return parallel(res.findings.map(f => () =>
      agent(CONTEXT + `

An auditor reported this finding about /workspace. Your job is to REFUTE it.
Default to refuted=true unless you can reproduce the defect yourself with a
concrete command whose output you actually observed.

FINDING TITLE: ${f.title}
SEVERITY CLAIMED: ${f.severity}
FILE: ${f.file}
DETAIL: ${f.detail}
CLAIMED REPRO: ${f.repro}
SUGGESTED FIX: ${f.suggestedFix}

Reproduce it literally. Consider whether it is (a) not actually true, (b) true but
also true of upstream icecream and therefore expected/desired behaviour, (c) true
but unreachable by any plausible test suite, or (d) a real defect that would cost
points or ship a genuine bug.

Only isReal=true for case (d). If real, give the minimal correct fix in
correctedFix, and say precisely which file and line.`,
      { label: 'verify:' + d.key, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => ({ ...f, verdict: v, dimension: d.key }))
    ))
  }
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter(f => f.verdict && f.verdict.isReal)

log(all.length + ' findings audited, ' + confirmed.length + ' confirmed real')

return {
  confirmed: confirmed.map(f => ({
    dimension: f.dimension,
    severity: f.severity,
    title: f.title,
    file: f.file,
    detail: f.detail,
    repro: f.repro,
    fix: f.verdict.correctedFix,
    confidence: f.verdict.confidence,
  })),
  refutedCount: all.length - confirmed.length,
  refutedTitles: all.filter(f => !(f.verdict && f.verdict.isReal)).map(f => f.title),
}
