export const meta = {
  name: 'six-exhaustive-audit',
  description: 'Audit the six implementation in /workspace against the spec, packaging, and py3.12 runtime edge cases',
  phases: [
    { title: 'Audit', detail: 'independent auditors per dimension, each executing real code' },
    { title: 'Verify', detail: 'adversarially confirm or refute each finding' },
    { title: 'Critic', detail: 'what dimension or claim was never checked' },
  ],
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'one-line defect statement' },
          detail: { type: 'string', description: 'what is wrong, where (file:line), and the exact command/code that shows it' },
          observed: { type: 'string', description: 'verbatim observed output proving the problem' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          suggested_fix: { type: 'string' },
        },
        required: ['title', 'detail', 'observed', 'severity', 'suggested_fix'],
      },
    },
    checks_run: { type: 'array', items: { type: 'string' }, description: 'each concrete check you executed and its pass/fail' },
    summary: { type: 'string' },
  },
  required: ['findings', 'checks_run', 'summary'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true only if you reproduced the defect yourself' },
    reasoning: { type: 'string' },
    reproduction: { type: 'string', description: 'exact command + output, or why it failed to reproduce' },
  },
  required: ['real', 'reasoning', 'reproduction'],
}

const PREAMBLE = `You are auditing a from-scratch implementation of the Python "six" compatibility library located in /workspace (files: six.py, setup.py, setup.cfg, tox.ini, MANIFEST.in, README.rst, CHANGES, LICENSE, CONTRIBUTORS, .gitignore, documentation/). Python here is 3.12.4. The official upstream test suite is at /tmp/official_test_six.py and an untouched upstream reference tree is at /tmp/ref/six-1.17.0/ (you may diff against it).

CRITICAL RULES:
- DO NOT modify anything under /workspace. It is read-only for you. Write scratch scripts and virtualenvs under /tmp/<your-unique-name>/ only.
- Do not just read code and reason about it. EXECUTE things. A finding with no observed output is worthless and will be discarded.
- Report ONLY real defects: something that would fail a test, break an install, or contradict the specification. Style opinions, missing type annotations, and "upstream does it differently but both work" are NOT findings. Return an empty findings array if the dimension is clean -- that is a perfectly good result.
- The spec for this project is the upstream six 1.17.0 public API plus the packaging requirements below.

PACKAGING REQUIREMENTS FROM THE SPEC: setup.py must make the project pip-installable and must declare the development toolchain (flake8>=3.7.9, isort>=4.3.21, mypy>=0.770, pre-commit>=2.0.1, pytest>=5.4.0, tox>=3.14.0, Sphinx>=2.4.0, black>=19.10b0). six.py must be the single unified API entry exporting moves and all public functions plus version info, usable via "import six" and "from six import *".
`

const DIMENSIONS = [
  {
    key: 'spec-api-surface',
    prompt: `${PREAMBLE}
YOUR DIMENSION: public API surface completeness and behavior.

Write and run a script that asserts EVERY one of these exists on the six module and behaves as documented, and report anything missing or misbehaving:
- Version/type constants: PY2, PY3, PY34, string_types, integer_types, class_types, text_type, binary_type, MAXSIZE, __version__, __author__.
- Iterators/dicts: next, advance_iterator, Iterator, iterkeys, itervalues, iteritems, iterlists, viewkeys, viewvalues, viewitems. Check iteritems/iterkeys/itervalues return iterators (not lists) on py3, and that they accept and forward **kwargs. Check viewkeys/viewvalues/viewitems return real view objects. Check iterlists works on an object with a .lists() method.
- Bytes/str: b, u, unichr, int2byte, byte2int, indexbytes, iterbytes, ensure_binary, ensure_str, ensure_text, StringIO, BytesIO. Verify six.b("\\x03") round-trips, byte2int, indexbytes, list(iterbytes(b"abc")), and the ensure_* functions for BOTH str and bytes input, and that they raise TypeError on a non-str/bytes argument (e.g. an int). Check ensure_str/ensure_text/ensure_binary honour the encoding and errors kwargs.
- Function/method attrs: get_unbound_function, create_bound_method, create_unbound_method, get_method_function, get_method_self, get_function_closure, get_function_code, get_function_defaults, get_function_globals, func_closure/func_code/func_defaults/func_globals if present.
- Syntax: exec_, print_, raise_from, reraise, wraps. For print_: check file=, sep=, end=, flush= kwargs, writing unicode and non-str objects, and that it defaults to sys.stdout looked up at call time. For reraise: check the traceback is preserved and that the local variable is cleaned up. For raise_from: check __cause__ is set.
- Classes/decorators: with_metaclass, add_metaclass, python_2_unicode_compatible. Check with_metaclass produces a class whose type is the metaclass, works with abc.ABCMeta, passes **kwargs through, and does NOT leave a temporary base class in the MRO. Check add_metaclass preserves __dict__ minus __dict__/__weakref__, preserves __slots__ handling (removes slot descriptors), and preserves abstract methods.
- unittest: assertCountEqual, assertRaisesRegex, assertRegex, assertNotRegex -- call each with a real TestCase both passing and failing.
- moves machinery: moves, add_move, remove_move, MovedModule, MovedAttribute.
Also verify "from six import *" works and check what __all__-ish names leak.
Report every concrete failure with its traceback.`,
  },
  {
    key: 'packaging-install',
    prompt: `${PREAMBLE}
YOUR DIMENSION: packaging and installability. Be thorough and destructive here.

Do ALL of the following in /tmp/pkg-audit/ and report failures:
1. Create a fresh venv (python3 -m venv). In it, run "pip install /workspace" (copy /workspace to a scratch dir first if the build needs write access -- do NOT build in place if it would create files in /workspace; if a copy is needed, use /tmp/pkg-audit/src). Confirm it succeeds, then confirm "import six; print(six.__version__, six.__file__)" works from a directory that is NOT the source dir (so you know you imported the installed copy, not the cwd).
2. In that same venv, install pytest and run the official suite /tmp/official_test_six.py against the INSTALLED six (run from a cwd with no six.py present). Report the exact pass/fail counts and every failure verbatim.
3. Fresh venv: "pip install -e /tmp/pkg-audit/src" (editable). Confirm import works.
4. Build both distributions: "python -m build" if available, else "python setup.py sdist bdist_wheel". Confirm sdist and wheel are produced. Inspect the sdist tarball and wheel contents: does the sdist include six.py, setup.py, setup.cfg, README.rst, LICENSE, CHANGES, documentation/? Does the wheel contain six.py at top level? Report anything missing that MANIFEST.in claims to include. NOTE: MANIFEST.in includes test_six.py but there is no test_six.py in /workspace -- determine whether that makes sdist creation FAIL or merely emit a warning. This matters; test it explicitly.
5. Verify setup.py declares every required dev dependency (flake8>=3.7.9, isort>=4.3.21, mypy>=0.770, pre-commit>=2.0.1, pytest>=5.4.0, tox>=3.14.0, Sphinx>=2.4.0, black>=19.10b0). Confirm "pip install '/tmp/pkg-audit/src[dev]'" would resolve -- you may use --dry-run to avoid a huge download.
6. Confirm python_requires and that install_requires is empty (six must have no runtime deps).
7. Check setup.py imports six to get its version -- does that work when setuptools builds in an isolated env (PEP 517 build isolation)? Test "pip install /tmp/pkg-audit/src" WITHOUT --no-build-isolation and confirm it still works, since six.py is in the source root.
Report the verbatim command output for anything that fails.`,
  },
  {
    key: 'moves-coverage',
    prompt: `${PREAMBLE}
YOUR DIMENSION: six.moves completeness on Python 3.12.

The specification enumerates a long list of "from six.moves import X" imports. Write a script that attempts EVERY name in this list and reports which fail and with what error:
builtins, configparser, copyreg, cPickle, cStringIO, collections_abc, dbm_gnu, dbm_ndbm, _dummy_thread, email_mime_base, email_mime_image, email_mime_multipart, email_mime_nonmultipart, email_mime_text, filter, filterfalse, getcwd, getcwdb, getoutput, http_cookiejar, http_cookies, html_entities, html_parser, http_client, BaseHTTPServer, CGIHTTPServer, SimpleHTTPServer, input, intern, map, queue, range, reduce, reload_module, reprlib, shlex_quote, socketserver, _thread, tkinter, tkinter_dialog, tkinter_filedialog, tkinter_scrolledtext, tkinter_simpledialog, tkinter_ttk, tkinter_tix, tkinter_constants, tkinter_dnd, tkinter_colorchooser, tkinter_commondialog, tkinter_tkfiledialog, tkinter_font, tkinter_messagebox, tkinter_tksimpledialog, urllib_robotparser, UserDict, UserList, UserString, xmlrpc_client, xmlrpc_server, xrange, zip, zip_longest, winreg.
IMPORTANT: distinguish genuine bugs in the implementation from names that legitimately cannot import in THIS environment (e.g. winreg is Windows-only; tkinter/dbm_gnu/dbm_ndbm may not be built into this Python; commands/tix may be gone). For each failure, determine which category it is by checking whether the underlying stdlib module exists at all here. Only the former are findings.
Also verify: "from six.moves.urllib import parse, error, request, response, robotparser" and "import six.moves.urllib.parse" and "from six.moves.urllib.parse import urlparse"; that six.moves.urllib_parse and six.moves.urllib.parse are the same module; every MovedAttribute on urllib_parse, urllib_error, urllib_request, urllib_response, urllib_robotparser actually resolves (iterate the _moved_attributes lists and getattr each one); that _dummy_thread maps to _thread on py3.9+; that reload_module comes from importlib on py3.4+; that add_move/remove_move work and that remove_move raises AttributeError for an unknown name; that six.moves modules are in sys.modules under the right names and that importlib.reload(six.moves.<something>) works.
Report each real failure with its traceback.`,
  },
  {
    key: 'internals-importer',
    prompt: `${PREAMBLE}
YOUR DIMENSION: the internal machinery the spec documents explicitly.

Verify by execution:
- six._add_doc(func, doc) sets __doc__.
- six._import_module("os.path") returns the os.path module (i.e. returns the module named by the FULL dotted name via sys.modules, not the top package).
- six._SixMetaPathImporter: instantiate/inspect the live six._importer. Confirm it has and correctly implements: __init__ storing name and known_modules, _add_module, _get_module, find_module(fullname, path=None), find_spec(fullname, path, target=None), load_module, is_package, get_code, get_source, create_module, exec_module. Confirm find_spec returns a ModuleSpec for known names and None for unknown; confirm is_package returns True for "six.moves" and for "six.moves.urllib" and False for e.g. "six.moves.urllib_parse"; confirm get_code and get_source return None; confirm __get_module raises ImportError for unknown names; confirm the importer is registered in sys.meta_path exactly once even after re-importing six.
- Confirm the importer works under the PEP 451 path (find_spec/create_module/exec_module) and not only via the deprecated find_module, since Python 3.12 REMOVED find_module support from the import system. This is a key risk: verify that importing six.moves submodules on 3.12 goes through find_spec.
- MovedAttribute: construct one exactly as the spec shows -- MovedAttribute("StringIO", "StringIO", "io", "StringIO", "StringIO") -- and confirm _resolve() returns io.StringIO. Also construct with new_mod=None and with old_attr/new_attr omitted, and confirm the documented defaulting rules hold on PY3.
- MovedModule: confirm _resolve imports the new module on py3, and that __getattr__ delegates to the resolved module.
- _LazyDescr.__get__ caching: confirm that after first access the attribute is replaced on the object so the descriptor is not re-run (and that it handles the case where the object has no __dict__ / is a module).
- Confirm six.moves has __path__ == [] (package-like) and that six.moves.__name__ is "six.moves".
- Confirm pickling/copying interplay: copy.deepcopy of a six.moves module and pickle of six.moves.range instances behave sanely (don't crash).
Report each real failure with traceback.`,
  },
  {
    key: 'py312-runtime-edges',
    prompt: `${PREAMBLE}
YOUR DIMENSION: Python 3.12-specific breakage and hostile edge cases.

Hunt for anything in /workspace/six.py that breaks or warns on Python 3.12.4:
- Run the official suite with warnings escalated: "python -W error::DeprecationWarning -m pytest /tmp/official_test_six.py -q" and also plain "-W error". Report which tests fail and whether the warning originates in six.py itself or in the stdlib module being imported (only the former is a six bug, but report both categories clearly labelled).
- Compile-check: "python -m py_compile /workspace/six.py" and confirm no SyntaxWarning (e.g. invalid escape sequences in strings/docstrings). Run "python -W error::SyntaxWarning -c 'import six'".
- Check for uses of anything removed in 3.12: imp module, inspect.getargspec, collections ABCs at top level, distutils at import time of six.py, find_module-only import hooks, unittest aliases like assertEquals/failUnless, sys.maxint, etc.
- Verify six.py imports cleanly with no output and no warnings, and that importing it twice / reloading it (importlib.reload(six)) does not duplicate the meta_path entry or break six.moves.
- Verify six works when the module is imported under a DIFFERENT name (six.py vendored as e.g. "mylib._six"): copy six.py to /tmp/edges/pkg/vendored_six.py, import it as vendored_six, and confirm "from vendored_six.moves import queue" works -- six supports being renamed and the spec's _SixMetaPathImporter(six_module_name) design implies it. Report if it breaks.
- Verify thread-safety-ish sanity: import six.moves submodules concurrently from several threads and confirm no deadlock/exception.
- Verify six.print_ against a file object that lacks softspace/encoding attrs, and against sys.stdout replaced by an io.StringIO.
- Verify six.exec_ with globals-only, globals+locals, and a code object.
- Verify assertRaisesRegex/assertRegex/assertNotRegex/assertCountEqual are the py3 names and do not emit DeprecationWarning on 3.12.
- Try to make six.reraise leak a reference cycle or fail when tb is None.
Report each real failure with the exact command and verbatim output.`,
  },
  {
    key: 'diff-vs-upstream',
    prompt: `${PREAMBLE}
YOUR DIMENSION: differential comparison against the upstream reference.

Run "diff -u /tmp/ref/six-1.17.0/six.py /workspace/six.py" and the same for setup.cfg, MANIFEST.in, README.rst, CHANGES, LICENSE, and the documentation/ files. For setup.py, diff /tmp/ref/six-1.17.0/setup.py against /workspace/setup.py.
For EVERY difference you find, decide and state whether it is:
(a) harmless/intentional (e.g. the spec's extra dependency declarations in setup.py, removal of the auto-generated [egg_info] section from setup.cfg), or
(b) a behavioral regression that could fail a test.
Then answer these specific questions by execution:
- Does /workspace/six.py define exactly the same set of public names as the reference? Compute set(dir(reference_six)) symmetric-difference set(dir(workspace_six)) by importing each from its own directory in separate subprocesses, and report any missing or extra name.
- Are the _moved_attributes / _urllib_*_moved_attributes lists identical in content (compare the (name, mod, attr) tuples after resolution, not just source text)?
- Is __version__ identical?
- Also list which files present in the spec's required directory structure are MISSING from /workspace. The spec's structure is: .gitignore, CHANGES, CONTRIBUTORS, LICENSE, MANIFEST.in, README.rst, documentation/{Makefile,conf.py,index.rst}, setup.cfg, setup.py, six.py, tox.ini. Report any that are absent or empty.
Report findings for category (b) and for genuinely missing required files only.`,
  },
]

phase('Audit')
log(`Auditing /workspace across ${DIMENSIONS.length} dimensions, each executing real code`)

const audited = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `audit:${d.key}`, phase: 'Audit', schema: FINDINGS }),
  (res, d) => {
    if (!res || !res.findings || res.findings.length === 0) return []
    // Each finding gets three independent skeptics with distinct lenses.
    const lenses = [
      'REPRODUCE: run the exact command/code yourself in a scratch dir. If you cannot reproduce the claimed output, it is refuted.',
      'ENVIRONMENT: decide whether this is a defect in /workspace/six.py or setup.py, versus an artifact of this container (missing stdlib module, no network, no tkinter, wrong cwd, stale venv) or of the auditor testing it wrong. Environment artifacts and tester error are refuted.',
      'CONSEQUENCE: decide whether this would actually fail the official six test suite, break "pip install", or violate the stated specification. Cosmetic, stylistic, or upstream-also-does-this issues are refuted.',
    ]
    return parallel(res.findings.map(f => () =>
      parallel(lenses.map((lens, i) => () =>
        agent(`${PREAMBLE}
A prior auditor working on the "${d.key}" dimension reported this finding. Your job is to REFUTE it. Default to refuted=true when uncertain.

TITLE: ${f.title}
SEVERITY CLAIMED: ${f.severity}
DETAIL: ${f.detail}
CLAIMED OBSERVED OUTPUT: ${f.observed}
SUGGESTED FIX: ${f.suggested_fix}

YOUR LENS (${i === 0 ? 'reproduce' : i === 1 ? 'environment' : 'consequence'}): ${lens}

Do the work in /tmp/verify-${d.key}-${i}/. Do not modify /workspace.`,
          { label: `verify:${d.key}:${i}`, phase: 'Verify', schema: VERDICT })
      )).then(votes => {
        const good = votes.filter(Boolean)
        const realVotes = good.filter(v => v.real).length
        return {
          dimension: d.key,
          ...f,
          confirmed: realVotes >= 2,
          votes: `${realVotes}/${good.length} confirmed`,
          evidence: good.map((v, i) => `[lens${i}] real=${v.real}: ${v.reproduction}`).join('\n'),
        }
      })
    ))
  }
)

const flat = audited.flat().filter(Boolean)
const confirmed = flat.filter(f => f.confirmed)
const refuted = flat.filter(f => !f.confirmed)
log(`${flat.length} raw findings -> ${confirmed.length} confirmed, ${refuted.length} refuted`)

phase('Critic')
const critic = await agent(`${PREAMBLE}
A multi-agent audit of /workspace just ran across these dimensions: ${DIMENSIONS.map(d => d.key).join(', ')}.

Confirmed findings:
${confirmed.length ? confirmed.map(f => `- [${f.severity}] (${f.dimension}) ${f.title}\n  ${f.detail}`).join('\n') : '(none)'}

Refuted findings (already dismissed by 2+ skeptics):
${refuted.length ? refuted.map(f => `- (${f.dimension}) ${f.title} -- ${f.votes}`).join('\n') : '(none)'}

YOUR JOB: find what was NOT checked. Ask: which part of the specification has no verification behind it? Which risky behavior did nobody execute? Is there a way the grading test suite could fail that none of the dimensions above would have caught?
Then GO RUN those missing checks yourself in /tmp/critic/ and report only defects you actually observe. Pay particular attention to:
- whether a grading harness that copies its own test file into /workspace and runs bare "pytest" from /workspace would behave correctly (collection errors, conftest needs, cwd shadowing, an accidentally-collected file),
- whether "import six" works with /workspace as cwd AND with six installed, without ambiguity,
- whether any file in /workspace is syntactically invalid or would break "pytest --collect-only" from /workspace,
- whether the documentation/ files reference anything that breaks a Sphinx build (do not run a full Sphinx build if it is not installed; just check for obvious breakage),
- anything about the spec's 15 "nodes" whose exact assert-style examples were never literally executed. Literally execute the code blocks from the spec's Node 1 through Node 15 examples (skip Node 12's interactive input example, and for it just confirm six.moves.input is the builtin input).
Report real defects only.`,
  { label: 'completeness-critic', phase: 'Critic', schema: FINDINGS })

return {
  confirmed_findings: confirmed,
  refuted_count: refuted.length,
  refuted_titles: refuted.map(f => `(${f.dimension}) ${f.title}`),
  critic_findings: critic ? critic.findings : [],
  critic_checks: critic ? critic.checks_run : [],
  critic_summary: critic ? critic.summary : 'critic agent failed',
  dimension_summaries: DIMENSIONS.map((d, i) => ({ dimension: d.key, findings_raised: (audited[i] || []).length })),
}
