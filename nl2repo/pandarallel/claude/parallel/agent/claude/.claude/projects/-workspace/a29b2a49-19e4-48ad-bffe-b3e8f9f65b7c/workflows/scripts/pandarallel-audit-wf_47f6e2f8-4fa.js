export const meta = {
  name: 'pandarallel-audit',
  description: 'Exhaustively probe the /workspace pandarallel implementation for defects against pandas 2.3.2 and the project spec',
  phases: [
    { title: 'Probe', detail: 'parallel read-only probes across 8 dimensions' },
    { title: 'Verify', detail: 'adversarially verify each finding by reproduction' },
    { title: 'Critique', detail: 'completeness critic: what was not covered' },
  ],
}

const COMMON = `
CONTEXT
=======
A from-scratch implementation of the "pandarallel" Python library lives in /workspace.
It is installed in editable mode (\`pip install -e /workspace\` already done), so
\`import pandarallel\` resolves to /workspace/pandarallel. Environment: Python 3.10.18,
pandas 2.3.2, numpy 2.2.6, dill 0.4.0, psutil 7.0.0, pytest 8.4.1. /dev/shm exists.

The library monkey-patches pandas with parallel_* methods after calling:
    from pandarallel import pandarallel
    pandarallel.initialize(nb_workers=2, progress_bar=<bool>, use_memory_fs=<None|True|False>, verbose=0)

Public API surface:
  df.parallel_apply(func, axis=0|1, ...)        <-> df.apply(...)
  df.parallel_applymap(func)                    <-> df.applymap(...)
  series.parallel_apply(func, args=..., **kw)   <-> series.apply(...)
  series.parallel_map(func)                     <-> series.map(...)
  df.groupby(k).parallel_apply(func)            <-> df.groupby(k).apply(func)
  df.groupby(k).col.parallel_apply(func)        <-> df.groupby(k).col.apply(func)
  series.rolling(w).parallel_apply(f, raw=..)   <-> series.rolling(w).apply(...)
  series.expanding().parallel_apply(f, raw=..)  <-> series.expanding().apply(...)
  df.groupby(k).col.rolling(w).parallel_apply   <-> ...rolling(w).apply(...)
  df.groupby(k).col.expanding().parallel_apply  <-> ...expanding().apply(...)

Files: /workspace/pandarallel/{__init__,core,progress_bars,utils}.py and
/workspace/pandarallel/data_types/{__init__,generic,dataframe,dataframe_groupby,
expanding_groupby,rolling_groupby,series,series_rolling}.py plus /workspace/setup.py,
setup.cfg, MANIFEST.in, README.md, LICENSE.

The grading criterion is a hidden pytest suite that, for each operation, compares the
parallel result against the sequential pandas result with \`res.equals(res_parallel)\`,
parameterized over df_size in (1000, 1), progress_bar in (False, True), and
use_memory_fs in (None, False). It also checks that exceptions raised inside the user
function propagate (pytest.raises), that an invalid axis raises ValueError, and that
\`pandarallel.core.MEMORY_FS_ROOT\` honours the MEMORY_FS_ROOT env var after
importlib.reload.

YOUR JOB
========
Hunt for real DEFECTS in the implementation. Read the source first, then write and RUN
scratch python scripts to empirically confirm or refute each suspicion. Do not guess:
every finding must be backed by a command you actually ran and its output.

HARD RULES
==========
- READ-ONLY on /workspace. Never edit, create, or delete anything under /workspace.
  Put every scratch file under your own directory /tmp/probe_%SLOT%/ .
- Always compare against real pandas behaviour (compute the sequential result and use
  .equals(), plus check dtype and index) — "looks plausible" is not evidence.
- A defect is: parallel result != sequential pandas result, an exception the sequential
  path does not raise, a hang, a crash, a resource leak, or a spec requirement not met.
  A cosmetic difference (e.g. a warning) is at most low severity.
- Guard against hangs: run scripts with \`timeout 180 python ...\`. If something hangs,
  that IS a finding.
- Keep total runtime sane: prefer small df sizes (1, 2, 1000) and nb_workers=2.
- Report ONLY confirmed, reproducible defects. Zero findings is a perfectly good answer
  if the code is correct — do not invent problems, do not report style opinions.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'coverage'],
  properties: {
    coverage: { type: 'string', description: 'What you actually exercised, one paragraph' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'file', 'repro', 'observed', 'expected'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          file: { type: 'string', description: 'path:line of the root cause' },
          repro: { type: 'string', description: 'exact self-contained python snippet that shows the defect' },
          observed: { type: 'string' },
          expected: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'severity', 'explanation'],
  properties: {
    real: { type: 'boolean' },
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
    explanation: { type: 'string' },
    corrected_repro: { type: 'string' },
    recommended_fix: { type: 'string' },
  },
}

const DIMENSIONS = [
  {
    key: 'dataframe',
    prompt: `Probe DataFrame.parallel_apply and DataFrame.parallel_applymap
(/workspace/pandarallel/data_types/dataframe.py, utils.chunk).
Sweep at minimum: axis=0, axis=1, axis="index", axis="columns", invalid axis (must raise
ValueError like pandas); df with 0 rows, 0 cols, pd.DataFrame() entirely empty, 1 row,
1 col, more workers than rows/cols; float/int/object/bool/datetime/categorical columns;
mixed dtypes where the udf reduces vs does not reduce (returns Series/DataFrame/scalar);
result_type="expand"/"reduce"/"broadcast"; udf with extra positional args and kwargs
(\`df.parallel_apply(f, axis=1, args=(2,), bias=3)\`); non-unique index; MultiIndex rows;
MultiIndex columns; duplicate column names; nb_workers=1; a udf returning a list or a
dict; \`raw=True\`. Also verify parallel_applymap for na_action="ignore" and for a df
containing NaN. For every case assert equality of values, dtypes and index against the
sequential pandas call.`,
  },
  {
    key: 'series',
    prompt: `Probe Series.parallel_apply and Series.parallel_map
(/workspace/pandarallel/data_types/series.py).
Sweep at minimum: empty series, size 1, size 2 with nb_workers=2, size 1000;
dtypes int64/float64/object/bool/category/datetime64/Int64 (nullable)/string; udf with
args=(...) and keyword arguments; udf returning a Series (expansion) or a list; na_action
for parallel_map plus a dict/Series argument to map instead of a callable (pandas allows
\`series.map({...})\` and \`series.map(other_series)\` — check what the parallel version
does); non-unique index; MultiIndex; named vs unnamed series; NaN handling; whether the
result name, dtype and index exactly match the sequential result.`,
  },
  {
    key: 'groupby',
    prompt: `Probe DataFrameGroupBy.parallel_apply and SeriesGroupBy.parallel_apply
(/workspace/pandarallel/data_types/dataframe_groupby.py). This code calls the pandas
private method \`_wrap_applied_output(selected_obj, values, not_indexed_same=any(mutated))\`.
Sweep at minimum: groupby single key "a", list of one key ["a"], multiple keys ["a","b"],
groupby(level=0), groupby on a Series (\`df.groupby("a").b.parallel_apply\`),
group_keys=True vs group_keys=False, as_index=True vs as_index=False, sort=True vs
sort=False, dropna=True vs False with NaN in the key, a Categorical grouping column
(observed=True/False), a grouper with 0 groups (empty df), a single group, more groups
than workers and fewer groups than workers; udf returning: a scalar, a Series with the
same index as the group (transform-like), a Series with a different index, a DataFrame
with the same index, a DataFrame with a fresh index, None, a mix of DataFrame and None.
For each, compare with the sequential \`.apply(...)\` result via .equals() AND compare
\`.index\`, \`.columns\`/\`.name\` and dtypes. Suppress the pandas DeprecationWarning about
grouping columns rather than letting it hide a real difference.`,
  },
  {
    key: 'rolling',
    prompt: `Probe rolling and expanding parallelization
(/workspace/pandarallel/data_types/series_rolling.py, rolling_groupby.py,
expanding_groupby.py, utils.get_window_attributes / chunk with start_offset).
Sweep at minimum: series.rolling(w).parallel_apply for w in (1,2,4,7) with raw=False and
raw=True, min_periods set and unset, closed in (None,"right","left","both","neither"),
win_type=None, center=True (the implementation claims to fall back to a single chunk —
verify the result is still exactly correct), step=2, an offset window ("2s") on a
DatetimeIndex series, series shorter than the window, series of length 1, length 0;
df.rolling(w).parallel_apply on a whole DataFrame; series.expanding().parallel_apply
(with min_periods) — this is a bespoke feature where each worker gets the whole prefix
and slices its own part, check it exactly matches sequential; groupby rolling/expanding:
\`df.groupby(k).col.rolling(w).parallel_apply(f, raw=False)\`,
\`df.groupby(k).col.expanding().parallel_apply(f, raw=False)\`, also with raw=True, with
one group, with many groups, with an empty df, and \`df.groupby(k)[["b","c"]].rolling(w)\`
(a DataFrame-valued groupby rolling). Compare index (MultiIndex!) names, order, dtypes
and values against sequential pandas.`,
  },
  {
    key: 'progress-transport',
    prompt: `Probe the progress bar system and the two data transports
(/workspace/pandarallel/progress_bars.py and /workspace/pandarallel/core.py).
Checks: with progress_bar=True, every supported operation must still return a result
exactly equal to the sequential one, for use_memory_fs=None, True and False; the console
progress bar must never crash (including when a chunk length is 0, when the progress
value exceeds the max, when there is exactly one worker, and when many workers are used);
verify progress output goes to stdout and does not corrupt the returned value;
simulate the notebook path by monkeypatching \`pandarallel.progress_bars.is_notebook_lab\`
to return True with ipywidgets NOT installed and confirm it falls back to the console bar
instead of raising ImportError; confirm \`progress_wrapper\` state machine cannot divide by
zero; check that \`ProgressBarsType\` values are used consistently (in particular that
Series.parallel_map gets a real ProgressBarsType, not a bool). Also measure: does
progress_bar=True change the RESULT of any operation? It must not.`,
  },
  {
    key: 'errors-resources',
    prompt: `Probe error handling and resource management in /workspace/pandarallel/core.py.
Checks: a udf raising RuntimeError / AttributeError / ZeroDivisionError / KeyboardInterrupt
/ SystemExit / a custom exception class / an exception that is not picklable — the same
exception type must surface to the caller (or at least a clear error, never a hang) for
BOTH use_memory_fs=None and use_memory_fs=False, and for every parallelized data type
(dataframe apply, applymap, series apply/map, groupby apply, rolling apply); a udf that
returns an unpicklable object; use_memory_fs=True when MEMORY_FS_ROOT points at a
non-existent directory (must raise SystemError at initialize); nb_workers=0 and negative
(must raise, not hang); nb_workers=1; MEMORY_FS_ROOT env var override + importlib.reload
of pandarallel.core; verify NO temporary files are left in /dev/shm after both successful
and failing calls (count files matching pandarallel_* before/after); verify no leaked
child processes or manager processes accumulate after ~30 successive parallel calls
(use psutil to count children of the current process before and after — a steady growth
is a high severity leak); verify a second call after a failed call still works.`,
  },
  {
    key: 'packaging',
    prompt: `Probe packaging and the public import surface.
Checks: \`python -c "from pandarallel import pandarallel; print(pandarallel)"\`;
\`python -c "import pandarallel; print(pandarallel.__version__)"\`;
build a source distribution and a wheel in a scratch dir
(\`cd /tmp/probe_%SLOT% && python -m pip download --no-deps --no-binary :all: file:///workspace -d .\`
or \`python -m build\` if available, else \`python /workspace/setup.py sdist bdist_wheel --dist-dir /tmp/probe_%SLOT%/dist\`
run from /tmp so nothing is written into /workspace — if the only way to build writes into
/workspace, copy the whole /workspace tree to /tmp/probe_%SLOT%/src first and build there);
confirm the built artifact contains every module of the pandarallel package and the
data_types subpackage (\`tar tzf\`/\`unzip -l\`); install the built wheel into a throwaway
virtualenv (\`python -m venv\`, then pip install the wheel plus pandas) and confirm
\`from pandarallel import pandarallel\` then a small parallel_apply works there;
run \`python setup.py verify\` (from a COPY of the tree under /tmp) and confirm it exits 0
and prints an OK line per module; check setup.py declares install_requires containing
pandas>=1.0, dill>=0.3.1, psutil, numpy and pytest; check \`python setup.py --version\`,
\`--name\`, \`--description\` work; check setup.cfg does not break a bare \`pytest\`
invocation from /workspace when the test file lives at the repository root
(copy the tree to /tmp and try it: a \`testpaths\` misconfiguration that makes bare
\`pytest\` collect nothing would be a high severity finding).`,
  },
  {
    key: 'spec-conformance',
    prompt: `Audit conformance with the written project specification. The spec requires:
(1) parallel apply/map/applymap on DataFrame and Series; (2) DataFrameGroupBy and
SeriesGroupBy parallel apply; (3) parallel rolling AND expanding windows; (4) a pretty
progress bar for terminal and notebook; (5) automatic detection of the CPU core count
and sensible task allocation; (6) two transports — memory file system (/dev/shm, root
overridable through the MEMORY_FS_ROOT env var) and pipes — selected automatically when
use_memory_fs is None; (7) complete error handling; (8) a global configuration entry
point \`pandarallel.initialize(shm_size_mb=None, nb_workers=NB_PHYSICAL_CORES,
progress_bar=False, verbose=2, use_memory_fs=None)\` where verbose 0 = silent,
1 = warnings only, 2 = everything; (9) cross-platform support (Windows/Linux/macOS —
check the code uses the "spawn" start method on Windows and does not use POSIX-only
constructs unconditionally); (10) a complete setup.py that makes the project pip
installable and declares pandas>=1.0, dill>=0.3.1, psutil, numpy, pytest, plus
\`pandarallel/__init__.py\` exposing the API and \`__version__\` so that
\`from pandarallel import pandarallel\` gives access to everything.
Also required directory layout: pandarallel/{__init__,core,progress_bars,utils}.py,
pandarallel/data_types/{__init__,dataframe,dataframe_groupby,expanding_groupby,generic,
rolling_groupby,series,series_rolling}.py, plus .gitignore, LICENSE, MANIFEST.in,
README.md, setup.cfg, setup.py and a docs/ directory containing docs/docs/index.md,
docs/docs/troubleshooting.md, docs/docs/user_guide.md, docs/mkdocs.yml,
docs/examples_mac_linux.ipynb, docs/examples_windows.ipynb, docs/progress_apply.gif,
docs/progress_parallel_apply.gif, docs/standard_vs_parallel_4_cores.png.
Verify each item by reading the tree and running code. Report each unmet requirement as a
finding (file = the path that should exist or the module that misses the behaviour).
Additionally RUN the exact test snippets quoted in the spec — reproduce them verbatim as
a pytest file under /tmp/probe_%SLOT%/ with the fixtures
(df_size in (1000,1), progress_bar in (False,True), use_memory_fs in (None,False),
pandarallel_init calling initialize(progress_bar=..., use_memory_fs=..., nb_workers=2))
and report any failure.`,
  },
]

phase('Probe')

const results = await pipeline(
  DIMENSIONS,
  (d) => agent(COMMON.replaceAll('%SLOT%', d.key) + '\n\nYOUR DIMENSION\n==============\n' + d.prompt, {
    label: `probe:${d.key}`,
    phase: 'Probe',
    schema: FINDINGS_SCHEMA,
  }),
  (report, d) => {
    if (!report || !report.findings || report.findings.length === 0) return { dimension: d.key, coverage: report?.coverage || '', verified: [] }
    return parallel(report.findings.map((f) => () =>
      agent(`You are an adversarial verifier. A probe agent claims the pandarallel implementation in /workspace has this defect:

TITLE: ${f.title}
FILE: ${f.file}
CLAIMED SEVERITY: ${f.severity}
OBSERVED: ${f.observed}
EXPECTED: ${f.expected}
REPRO:
\`\`\`python
${f.repro}
\`\`\`

Your default position is that the claim is WRONG. Try hard to refute it:
- Run the repro yourself (scratch dir /tmp/verify_${d.key}/, timeout 180). Does it actually
  reproduce? Read /workspace source to check the claimed root cause is the real one.
- Is the "expected" behaviour actually what sequential pandas 2.3.2 does? Compute the
  sequential result and compare. Many claims are really "pandas itself behaves this way".
- Is the repro even valid (typos, wrong fixture, forgot pandarallel.initialize,
  compares against a wrong baseline, relies on a pandas API that does not exist)?
- Would the hidden grading suite described below ever hit this? The suite compares
  parallel vs sequential results for: df.parallel_apply(axis 0 and 1),
  df.parallel_applymap, series.parallel_apply(args=,kwargs), series.parallel_map,
  df.groupby(k).parallel_apply for k in "a", ["a"], ["a","b"], series.rolling(4)
  .parallel_apply(raw=False), df.groupby(k).col.rolling(4).parallel_apply(raw=False),
  df.groupby(k).col.expanding().parallel_apply(raw=False), empty dataframes/series,
  exception propagation, invalid axis -> ValueError, and MEMORY_FS_ROOT env override.
  Set severity high only if it plausibly breaks one of those, or is a hang/crash/leak.

Set real=false unless you personally reproduced it AND confirmed sequential pandas
disagrees with the parallel result (or it is a genuine hang/crash/leak/spec violation).
Report READ-ONLY: never modify /workspace.`, {
        label: `verify:${d.key}:${f.title.slice(0, 40)}`,
        phase: 'Verify',
        schema: VERDICT_SCHEMA,
      }).then((v) => ({ finding: f, verdict: v }))
    )).then((verified) => ({ dimension: d.key, coverage: report.coverage, verified: verified.filter(Boolean) }))
  }
)

const confirmed = []
const rejected = []
const coverage = []
for (const r of results.filter(Boolean)) {
  coverage.push({ dimension: r.dimension, coverage: r.coverage })
  for (const v of r.verified) {
    const row = {
      dimension: r.dimension,
      title: v.finding.title,
      file: v.finding.file,
      severity: v.verdict?.severity || v.finding.severity,
      observed: v.finding.observed,
      expected: v.finding.expected,
      repro: v.verdict?.corrected_repro || v.finding.repro,
      fix: v.verdict?.recommended_fix || v.finding.suggested_fix,
      why: v.verdict?.explanation,
    }
    if (v.verdict && v.verdict.real) confirmed.push(row)
    else rejected.push({ title: v.finding.title, why: v.verdict?.explanation })
  }
}

log(`Probe+verify done: ${confirmed.length} confirmed, ${rejected.length} refuted`)

phase('Critique')

const critique = await agent(`You are a completeness critic for an audit of the pandarallel implementation in
/workspace (read-only; scratch under /tmp/critic/).

Eight probe agents covered these areas:
${JSON.stringify(coverage, null, 2)}

Confirmed defects so far:
${JSON.stringify(confirmed.map((c) => ({ title: c.title, file: c.file, severity: c.severity })), null, 2)}

Your job: find what they MISSED. Read the actual source in /workspace/pandarallel/ and
ask: which code path has no probe behind it? Which pandas 2.3.2 behaviour could differ
from what this code assumes? Pay particular attention to code that deviates from the
well-known upstream pandarallel 1.6.5 implementation, because deviations are where new
bugs live — notably: utils.chunk returning [slice(0)] for 0 items and callers doing
\`(chunk_.stop or 0) - (chunk_.start or 0)\`; utils.df_indexed_like also accepting Series;
utils.get_window_attributes dropping the deprecated \`axis\` keyword;
dataframe_groupby passing \`not_indexed_same=any(mutated)\` instead of a tuple, and its
empty-groups branch; DataFrame.ApplyMap forwarding kwargs and using DataFrame.map
instead of applymap; series_rolling's can_be_chunked fallback and the bespoke
SeriesExpanding data type with its ExpandingChunk wrapper; core.py's queue.get(timeout)
health-check loop, pool.terminate()/join() and manager.shutdown() in finally blocks, the
create_temp_file/remove_file helpers, and registering parallel_apply on Rolling,
Expanding, SeriesGroupBy and DataFrame.parallel_map.
Then EMPIRICALLY test your top suspicions (timeout 180 per script) and report only what
you confirm as a real defect, with a runnable repro.`, {
  label: 'critique',
  phase: 'Critique',
  schema: FINDINGS_SCHEMA,
})

return {
  confirmed,
  refuted: rejected.map((r) => r.title),
  critique_findings: critique?.findings || [],
  critique_coverage: critique?.coverage || '',
}
