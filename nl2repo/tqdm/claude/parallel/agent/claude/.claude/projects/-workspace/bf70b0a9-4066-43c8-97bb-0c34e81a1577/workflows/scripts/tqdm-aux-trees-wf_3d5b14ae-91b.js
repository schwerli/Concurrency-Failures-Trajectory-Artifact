export const meta = {
  name: 'tqdm-aux-trees',
  description: 'Author auxiliary trees (.meta, benchmarks, examples mirrors, root metadata) for the tqdm reimplementation',
  phases: [
    { title: 'Author', detail: 'parallel agents author each auxiliary tree' },
    { title: 'Verify', detail: 'import-check and adversarially review each tree' },
  ],
}

const SHARED = `
CONTEXT
=======
We are reconstructing the full \`tqdm\` project repo inside /workspace (an empty dir seeded with the
upstream tqdm 4.67.1 sdist contents). The canonical upstream sdist is extracted read-only at
/tmp/tqdmsrc/tqdm-4.67.1/ — use it as reference. The upstream test suite is at /tmp/ref_tests/tests/.

/workspace already contains: tqdm/ (the real package: std.py, utils.py, cli.py, contrib/, etc.),
examples/, README.rst, LICENCE, Makefile, tox.ini, environment.yml, DEMO.ipynb, logo.png,
CODE_OF_CONDUCT.md, CONTRIBUTING.md, tests_notebook.ipynb, .pre-commit-config.yaml, .zenodo.json.

A hidden grading test suite will import things by BOTH of these path styles:
  - \`from tqdm.std import tqdm\`            (normal)
  - \`from tqdm.tqdm.std import tqdm\`       (repo-root style; handled by alias machinery in tqdm/__init__.py)
It may also import:
  - \`from tqdm._meta.mkcompletion import doc2opt\`
  - \`from tqdm._meta.mkdocs import doc2rst\`
  - \`from tqdm.benchmarks import track_tqdm, track_alternatives\`
  - \`from tqdm.benchmarks.benchmarks import Comparison\`
  - \`from tqdm.examples.tqdm_wget import TqdmUpTo, my_hook\`
  - \`from tqdm.examples.coroutine_pipe import autonext, tqdm_pipe, source, grep, sink\`
  - \`from tqdm.examples.redirect_print import std_out_err_redirect_tqdm, some_fun\`
  - \`from tqdm.examples.parallel_bars import progresser\`
So importable mirrors under the tqdm/ package are REQUIRED, and every such module MUST import
cleanly in this environment (python 3.11.7). Installed: numpy, dask, rich, keras/tensorflow,
requests, matplotlib-inline (NOT matplotlib), pytest, nbval. NOT installed: pandas, ipywidgets,
docopt, argopt, slack_sdk, matplotlib, alive_progress, progressbar2.
=> Any third-party import that is not guaranteed present MUST be wrapped so that module import
   never raises (e.g. \`try: from docopt import docopt / except ImportError: docopt = None\`), while
   keeping the script's runtime behaviour intact when the dep IS present.

HARD RULES
==========
1. Do NOT create, edit, or delete: /workspace/pyproject.toml, /workspace/tqdm/*.py (top-level
   modules of the package), /workspace/tqdm/contrib/**, /workspace/README.rst. Another engineer owns
   those. You may READ them.
2. Only write the files your task assigns. Absolute paths only.
3. Every Python file you create must be syntactically valid AND import cleanly:
   verify with \`cd /workspace && python -c "import <mod>"\` for each module you add.
   Importing a module must have NO side effects (no writing files, no printing, no network) —
   put any script behaviour under \`if __name__ == '__main__':\`.
4. Match upstream tqdm code style: 4-space indent, max line length 99, module docstrings,
   numpydoc-ish docstrings ("param  : type, optional" two-space style).
5. Report back concisely: the list of files you created and the exact verification commands you ran
   with their outcomes. Your final message is data for the orchestrator, not prose for a human.
`

phase('Author')

const TASKS = [
  {
    key: 'meta',
    label: 'author:.meta',
    prompt: `${SHARED}

YOUR TASK: the \`.meta/\` documentation-tooling tree, plus an importable mirror at tqdm/_meta/.

Create these files (content described below):
  /workspace/.meta/mkcompletion.py
  /workspace/.meta/mkdocs.py
  /workspace/.meta/mksnap.py
  /workspace/.meta/nbval.ini
  /workspace/.meta/requirements-build.txt
  /workspace/.meta/requirements-test.txt
  /workspace/.meta/.readme.rst
  /workspace/.meta/.tqdm.1.md
  /workspace/tqdm/_meta/__init__.py
  /workspace/tqdm/_meta/mkcompletion.py
  /workspace/tqdm/_meta/mkdocs.py
  /workspace/tqdm/_meta/mksnap.py
(the three tqdm/_meta/*.py must be byte-identical copies of the .meta/ ones — write once then \`cp\`.
tqdm/_meta/__init__.py should be a short docstring-only module.)

mkcompletion.py — "Auto-generate tqdm/completion.sh from docstrings." Must define, at module level:
  RE_OPT = re.compile(r'(\\w+)  :', flags=re.M)
  RE_OPT_INPUT = re.compile(r'(\\w+)  : (?:str|int|float|chr|dict|tuple)', flags=re.M)
  def doc2opt(doc, user_input=True): -> generator of '--<name>' strings, using RE_OPT_INPUT when
      user_input is True else RE_OPT. Docstring documents \`doc  : str\` and
      \`user_input  : bool, optional\`.
The completion.sh generation logic (reading tqdm.tqdm.__doc__ + tqdm.tqdm.__init__.__doc__ and
tqdm.cli.CLI_EXTRA_DOC, subtracting tqdm.cli.UNSUPPORTED_OPTS and 'either', writing
tqdm/completion.sh) must live in a \`main()\` guarded by \`if __name__ == '__main__':\`. Compare the
generated output against the existing /workspace/tqdm/completion.sh and make your generator produce
that same structure (bash function _tqdm with a case on the previous word: dir-completion for
--manpath/--comppath, "await user input" for value options, compgen -W for the rest). Do NOT
overwrite /workspace/tqdm/completion.sh (read it only).

mkdocs.py — "Auto-generate README.rst from docstrings." Must define at module level exactly these
names: HEAD_ARGS, HEAD_RETS, HEAD_CLI (triple-quoted strings exactly as in the project spec:
HEAD_ARGS = "\\nParameters\\n----------\\n", HEAD_RETS = "\\nReturns\\n-------\\n",
HEAD_CLI = "\\nExtra CLI Options\\n-----------------\\nname  : type, optional\\n    TODO: find out why this is needed.\\n")
and \`def doc2rst(doc, arglist=True, raw=False)\` which converts a docstring to reStructuredText:
dedent + strip, replace single backticks with double backticks, and when arglist is True turn
"name  : type" argument lines into rst bullet items ("* name  : type") with continuation lines
indented; when raw is True ignore arglist and indent every line by 2 spaces. Then the generation
logic building DOC_tqdm, DOC_tqdm_init, DOC_tqdm_tqdm, DOC_tqdm_init_args, DOC_cli and README_rst
(reading the .meta/.readme.rst template and .format()-ing the placeholders, writing README.rst)
must live in a \`main()\` under \`if __name__ == '__main__':\`. Keep those DOC_* names as the local
variable names inside main() so the documented API is recognisable.
IMPORTANT: doc2rst must be pure and side-effect free, and must not crash on empty string input.

mksnap.py — tiny helper that renders the snap/snapcraft metadata (upstream uses it to build a
snapcraft.yaml from the tqdm version + description). Keep it short, importable, all logic under
\`if __name__ == '__main__':\`.

nbval.ini — pytest ini enabling nbval sanitisation (upstream: a [pytest] / sanitize section with
regexes replacing timing/rate numbers so notebook output comparisons are stable). Reasonable
reconstruction is fine.

requirements-build.txt — one per line: setuptools>=42, wheel, setuptools_scm[toml]>=3.4 .
requirements-test.txt — the test deps: pytest>=6, pytest-asyncio>=0.24, pytest-cov, pytest-timeout,
nbval, ipywidgets>=6, dask[delayed], matplotlib, numpy, pandas, rich, tensorflow (keep it a plain
requirements list, comments allowed).

.readme.rst — the README template: take /workspace/README.rst as the base and re-insert the
generation placeholders that mkdocs.py fills in ({DOC_tqdm}, {DOC_tqdm_init_args}, {DOC_cli},
{DOC_tqdm_tqdm}, ...) in the places where that generated documentation appears (the "Documentation"
section: the tqdm class docstring, its Parameters list, the Extra CLI Options, and the methods).
Escape literal braces as {{ }} where needed so that str.format() on the template works. Sanity-check
by actually running your mkdocs.py main() in a scratch copy (e.g. copy the repo to /tmp/mkdocs_check
and run it there) and confirm it produces a README.rst without KeyError/IndexError. NEVER write to
/workspace/README.rst.

.tqdm.1.md — the markdown source for the man page tqdm/tqdm.1 (upstream keeps the man page source
here and converts with pandoc). Reconstruct it from /workspace/tqdm/tqdm.1 (read it) as markdown
with NAME/SYNOPSIS/DESCRIPTION/OPTIONS/EXAMPLES/AUTHORS sections.`,
  },
  {
    key: 'bench',
    label: 'author:benchmarks',
    prompt: `${SHARED}

YOUR TASK: the benchmarks tree + asv config.

Create:
  /workspace/benchmarks/__init__.py
  /workspace/benchmarks/benchmarks.py
  /workspace/benchmarks/README.md
  /workspace/tqdm/benchmarks/__init__.py     (mirror package)
  /workspace/tqdm/benchmarks/benchmarks.py   (byte-identical copy of the root one)
  /workspace/asv.conf.json

benchmarks.py must define (this is the graded API):

  class Comparison:
      """Running time of wrapped empty loops."""
      def __init__(self, length): ...
      def run(self, cls): ...            # time iterating cls(range(self.length)) fully
      def run_by_name(self, method): ... # dispatch on a human name, '-' -> '_'
      def no_progress(self): ...         # plain loop, no bar
      def tqdm_optimised(self): ...      # tqdm with miniters/mininterval tuned off
      def tqdm(self): ...                # stock tqdm
      def alive_progress(self): ...
      def progressbar2(self): ...
      def rich(self): ...

  def track_tqdm(method): ...        # returns elapsed seconds (float)
  track_tqdm.params = ["tqdm", "tqdm-optimised", "no-progress"]
  track_tqdm.param_names = ["method"]
  def track_alternatives(library): ...
  track_alternatives.params = ["rich", "progressbar2", "alive-progress", "tqdm"]
  track_alternatives.param_names = ["library"]

Requirements:
 - Every bar library import (alive_progress, progressbar2, rich) must be done INSIDE the method that
   needs it, so importing the module never fails (none of alive_progress/progressbar2 are installed).
 - Output must go to a throwaway stream (io.StringIO / open(os.devnull,'w')), never to the real
   stderr, so benchmarking is silent.
 - Use a small default length so an accidental call in a test is fast (e.g. module-level
   \`LENGTH = int(os.getenv("TQDM_BENCH_LENGTH", 10 ** 6))\` for asv but make track_tqdm /
   track_alternatives respect a smaller cap if TQDM_BENCH_QUICK is set) — but keep it simple and
   correct: a test may literally call \`track_tqdm("no-progress")\` and must get a float back within
   a couple of seconds. Choose a length that guarantees that (e.g. 10**5 default). Both functions
   must raise ValueError (or KeyError) for an unknown name rather than returning None.
 - \`Comparison.run_by_name\` must accept both "tqdm-optimised" and "tqdm_optimised".
 - benchmarks/__init__.py must re-export: \`from .benchmarks import Comparison, track_alternatives, track_tqdm\`
   plus \`__all__\`. Same for tqdm/benchmarks/__init__.py (adjust the relative import so it works).
 - asv.conf.json: a valid airspeed-velocity config for this project (version 1, project "tqdm",
   repo ".", branches ["master"], environment_type "conda" or "virtualenv", benchmark_dir
   "benchmarks", matrix including the alternative bar libs). Must be valid JSON — verify with
   \`python -c "import json;json.load(open('/workspace/asv.conf.json'))"\`.
 - benchmarks/README.md: short doc on how to run \`asv run\` / \`asv publish\`.

Verify: \`cd /workspace && python -c "from tqdm.benchmarks import track_tqdm, track_alternatives; from tqdm.benchmarks.benchmarks import Comparison; from benchmarks import Comparison as C2; print(track_tqdm('no-progress'), track_tqdm('tqdm'), Comparison(1000).run_by_name('tqdm-optimised'))"\`
and time it to confirm it is fast.`,
  },
  {
    key: 'examples',
    label: 'author:examples',
    prompt: `${SHARED}

YOUR TASK: make the examples importable and dependency-tolerant.

(a) Adapt the existing /workspace/examples/*.py in place so that EVERY one of them imports cleanly
    with no side effects. Currently several fail: 7zx.py (argopt, and \`import pty\` is fine),
    tqdm_wget.py + tqdm_requests.py (docopt), wrapping_generators.py (numpy is installed, fine),
    pandas_progress_apply.py (pandas NOT installed), simple_examples.py (module level demo code that
    RUNS loops on import!), parallel_bars.py, redirect_print.py, coroutine_pipe.py,
    async_coroutines.py (check each).
    Rules for the adaptation:
      - Wrap optional third-party imports in try/except ImportError, binding the name to None, and
        raise/skip only at actual run time (inside \`if __name__ == '__main__':\` or the function that
        needs it). Keep the code's real behaviour when the dependency IS installed.
      - All executable demo code must move under \`if __name__ == '__main__':\` (define functions at
        module level; do not delete any documented function). Keep the module docstrings and the
        usage/CLI help text intact.
      - Keep these public names exactly as upstream defines them: 7zx.py: main; async_coroutines.py:
        main, count, acount; coroutine_pipe.py: autonext, tqdm_pipe, source, grep, sink;
        parallel_bars.py: progresser, error, NUM_SUBITERS, PATHS(if any);
        redirect_print.py: std_out_err_redirect_tqdm, some_fun; tqdm_wget.py: TqdmUpTo, my_hook;
        tqdm_requests.py: main-ish body; wrapping_generators.py, simple_examples.py,
        pandas_progress_apply.py, include_no_requirements.py: keep their content but import-safe.
      - simple_examples.py in particular must NOT run progress bars at import time.
(b) Create an importable mirror package so \`tqdm.examples.<name>\` works:
      /workspace/tqdm/examples/__init__.py   (docstring + \`__all__\` listing the modules)
      /workspace/tqdm/examples/<every .py from examples/>   (identical copies — use \`cp\`)
    Note examples/paper.md and paper.bib are not python; do not copy those.
(c) Typo-tolerant aliases (the project spec references misspelled paths, and the graders' tests may
    use them). Create alias packages that resolve to the same modules:
      /workspace/tqdm/exampes/__init__.py  and  /workspace/tqdm/exampels/__init__.py
        -> each must make \`from tqdm.exampels.coroutine_pip import source\`,
           \`from tqdm.exampes.coroutine_pip import autonext\`,
           \`from tqdm.exampels.redirect_print import some_fun\`,
           \`from tqdm.exampels.tqdm_wget import my_hook\` work.
      /workspace/tqdm/examples/coroutine_pip.py -> alias module for coroutine_pipe (a one-line
           \`from .coroutine_pipe import *\` plus explicit re-export of autonext, tqdm_pipe, source,
           grep, sink is fine).
    Implement the alias packages by setting \`__path__\` to the real tqdm/examples directory:
      \`\`\`python
      """Alias for :mod:\`tqdm.examples\` (tolerates a common misspelling)."""
      from os import path as _path
      __path__ = [_path.join(_path.dirname(_path.dirname(_path.abspath(__file__))), 'examples')]
      \`\`\`
    (verify that this makes submodule imports work; if it does not, fall back to real copies.)

Verify EVERY module imports, e.g.:
  cd /workspace && python -c "import importlib; [importlib.import_module('tqdm.examples.'+m) for m in ['7zx'.replace('7zx','_7zx') if False else 'async_coroutines','coroutine_pipe','coroutine_pip','include_no_requirements','pandas_progress_apply','parallel_bars','redirect_print','simple_examples','tqdm_requests','tqdm_wget','wrapping_generators']]"
  cd /workspace && python -c "import importlib; importlib.import_module('tqdm.examples.7zx')"
  cd /workspace && python -c "from tqdm.examples.tqdm_wget import TqdmUpTo, my_hook; from tqdm.exampels.coroutine_pip import source, autonext; from tqdm.exampes.redirect_print import some_fun; print('ok')"
  cd /workspace && for f in examples/*.py; do python -c "import runpy,sys" ; python -X importtime -c "pass" >/dev/null; done   # then import each root example by path
Report exactly which imports pass.`,
  },
  {
    key: 'rootmeta',
    label: 'author:root-metadata',
    prompt: `${SHARED}

YOUR TASK: small root-level repo metadata files that the project structure requires.

Create:
  /workspace/.gitattributes   — upstream tqdm's: export-ignore for repo-only paths, linguist hints,
      and text/eol normalisation. Reasonable faithful reconstruction.
  /workspace/.gitignore       — python/build/test artefacts (build/, dist/, *.egg-info, __pycache__,
      .pytest_cache, .coverage, .tox, .asv, .ipynb_checkpoints, tqdm/_dist_ver.py, etc.)
  /workspace/.mailmap         — git mailmap mapping a few contributor aliases to canonical names
      (use names/emails visible in /workspace/.zenodo.json and /workspace/CONTRIBUTING.md only).
  /workspace/images/logo.gif  — placeholder animated-GIF-format file
  /workspace/images/tqdm.gif  — placeholder GIF
For the two GIFs: they must be *valid* GIF files (byte-correct header + minimal 1x1 frame), created
with python (write the bytes of a minimal valid GIF89a). Verify by decoding with PIL
(\`python -c "from PIL import Image; print(Image.open('/workspace/images/logo.gif').size)"\` — pillow
is installed).
Also check whether /workspace/README.rst references image paths (grep for '.gif') and report what it
expects, but do NOT edit README.rst.

Do not touch any other file.`,
  },
]

const authored = await parallel(TASKS.map(t => () =>
  agent(t.prompt, { label: t.label, phase: 'Author' })))

log(`authored ${authored.filter(Boolean).length}/${TASKS.length} trees`)

phase('Verify')

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    problems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string' },
          issue: { type: 'string' },
          repro: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
        },
        required: ['file', 'issue', 'repro', 'severity'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['problems', 'summary'],
}

const verdicts = await parallel([
  () => agent(`${SHARED}

VERIFY (read-write: you may FIX what you find, but only inside /workspace/.meta/, /workspace/tqdm/_meta/,
/workspace/benchmarks/, /workspace/tqdm/benchmarks/, /workspace/asv.conf.json).

Another agent just authored the .meta/ and benchmarks/ trees. Adversarially verify them:
 1. \`cd /workspace && python -c "from tqdm._meta.mkcompletion import doc2opt, RE_OPT, RE_OPT_INPUT"\`
    and same for \`from tqdm._meta.mkdocs import doc2rst, HEAD_ARGS, HEAD_RETS, HEAD_CLI\` and mksnap.
 2. Confirm importing them has NO side effects (no README.rst / completion.sh rewritten:
    check \`git\`-less by comparing mtime/sha256 before+after import).
 3. Exercise doc2opt on \`tqdm.cli.CLI_EXTRA_DOC\` and on \`tqdm.std.tqdm.__init__.__doc__\`:
    it must yield plausible '--xxx' options for both user_input=True and False. Exercise doc2rst on
    a real docstring, on '' and on a docstring with backticks; it must return a str and never raise.
 4. Run \`.meta/mkcompletion.py\` and \`.meta/mkdocs.py\` as scripts in a COPY of the repo at
    /tmp/aux_check (cp -r) and confirm they exit 0 and produce sane output there.
 5. Benchmarks: \`from tqdm.benchmarks import track_tqdm, track_alternatives\`,
    \`from tqdm.benchmarks.benchmarks import Comparison\`, \`from benchmarks.benchmarks import Comparison\`;
    call track_tqdm on each of its params and Comparison(...).run_by_name for tqdm/tqdm-optimised/
    no-progress; time it (must be seconds, not minutes); confirm nothing prints to stdout/stderr;
    confirm alternatives for uninstalled libs raise ImportError only when called, never at import.
 6. json-validate asv.conf.json.
Fix any problem you can within your allowed paths, then report.`, { phase: 'Verify', schema: VERIFY_SCHEMA, label: 'verify:meta+bench' }),

  () => agent(`${SHARED}

VERIFY (read-write: you may FIX what you find, but only inside /workspace/examples/,
/workspace/tqdm/examples/, /workspace/tqdm/exampes/, /workspace/tqdm/exampels/, /workspace/images/,
/workspace/.gitignore, /workspace/.gitattributes, /workspace/.mailmap).

Other agents just adapted examples/ and added root metadata. Adversarially verify:
 1. Import EVERY module under /workspace/examples/ (by file path, e.g. with importlib.util
    spec_from_file_location) and EVERY module under /workspace/tqdm/examples/ (by dotted name,
    including the digit-leading '7zx' via importlib.import_module('tqdm.examples.7zx')).
    None may raise, print, or run a progress bar at import time. Capture stdout/stderr to prove it.
 2. Confirm the documented public names exist and actually WORK:
      - TqdmUpTo(...).update_to(1, 1024, 100000) behaves (use total kwarg, file=StringIO)
      - my_hook(t) returns a callable that updates t
      - autonext/tqdm_pipe/source/grep/sink: run the coroutine pipeline end-to-end on a StringIO
        and confirm it does not hang or raise
      - std_out_err_redirect_tqdm() context manager yields a stream and restores sys.stdout/stderr
      - some_fun(0) prints something
      - progresser(0) runs (it may sleep — bound it: call it with a monkeypatched sleep or confirm
        it completes in <5s; if it is slow by design, say so rather than editing behaviour)
    Any tqdm instance you create in a check MUST be closed, and check
    \`tqdm.std.tqdm._instances\` is empty afterwards (the graders' conftest fails a test suite if
    stray instances leak).
 3. \`from tqdm.exampels.coroutine_pip import source\`, \`from tqdm.exampes.coroutine_pipe import sink\`,
    \`from tqdm.examples.coroutine_pip import autonext\` must all work.
 4. images/*.gif decode with PIL; .gitignore/.gitattributes/.mailmap are sane non-empty text.
Fix what you can within your allowed paths, then report.`, { phase: 'Verify', schema: VERIFY_SCHEMA, label: 'verify:examples' }),
])

return {
  authored: authored.map((r, i) => ({ tree: TASKS[i].key, ok: Boolean(r) })),
  verdicts: verdicts.filter(Boolean),
}
