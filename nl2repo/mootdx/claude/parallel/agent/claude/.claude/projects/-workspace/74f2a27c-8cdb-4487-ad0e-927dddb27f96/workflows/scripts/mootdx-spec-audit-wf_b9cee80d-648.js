export const meta = {
  name: 'mootdx-spec-audit',
  description: 'Audit the mootdx implementation in /workspace against the project spec API checklist',
  phases: [
    { title: 'Audit', detail: 'parallel auditors over slices of the spec checklist' },
    { title: 'Verify', detail: 'adversarially verify each reported gap by running python' },
  ],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'fully-qualified symbol, e.g. mootdx.utils.to_file' },
          kind: { type: 'string', description: 'missing | signature-mismatch | wrong-value | behaviour-mismatch | file-missing' },
          detail: { type: 'string', description: 'what the spec requires vs what exists' },
          repro: { type: 'string', description: 'exact python -c or shell command that demonstrates the gap' },
        },
        required: ['symbol', 'kind', 'detail', 'repro'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true if the gap is real and would plausibly fail a spec-derived test' },
    reason: { type: 'string' },
    fix: { type: 'string', description: 'concrete minimal fix (file + what to add/change)' },
  },
  required: ['real', 'reason', 'fix'],
}

const BASE = `You are auditing a Python project at /workspace that must implement the "mootdx" 0.11.7 spec.
The authoritative checklist of required API surface is at /tmp/spec_checklist.md — READ IT FIRST.
The implementation lives in /workspace/mootdx (plus /workspace/sample, /workspace/scripts, /workspace/tests).
You may run python/pytest/grep freely. The environment has network access and all deps installed.
Report ONLY real gaps: a symbol the spec names that does not exist, exists at the wrong module path,
has an incompatible signature, has a wrong constant value, or behaves differently from the spec's
documented examples. Do NOT report style issues, missing docstrings, or things that already work.
For every gap you report you MUST have actually run a command proving it. Include that command in 'repro'.`

const SLICES = [
  {
    key: 'imports-consts',
    prompt: `${BASE}

YOUR SLICE: the "Module import smoke list" and spec items 124-175 (all constants, __version__/__author__/
__homepage__/__date__, consts.py values, demjson constants, config.BASE/CONF/__all__, JS_DECODE, PandasFunc,
__version_info__, __credits__, NUM_SAMPLES, FREQUENCY, MARKET_*).
Actually execute every import line in the smoke list (one python -c per line or a single script that
imports each in a try/except and prints failures). Then check every constant's exact value.`,
  },
  {
    key: 'quotes-server-config',
    prompt: `${BASE}

YOUR SLICE: spec items 2, 28-36, 77-90, 94 — mootdx/quotes.py (Quotes, BaseQuotes, StdQuotes, ExtQuotes,
valid_server), mootdx/server.py (server, check_server, connect2, callback, async_event inner),
mootdx/config.py (setup, load_config inner, clone, settings/CONFIG), mootdx/consts.py (return_last_value,
check_empty), and /workspace/sample/verify_server.py (the QA_fetch_get_* function family, select_best_ip,
__select_market_code). Verify BaseQuotes class attributes and the closed property / pool / reconnect / close
methods exist with the documented signatures. Verify the Node 10 error behaviours:
client.stock_count(3) and client.stocks(2) each raise MootdxValidationException.`,
  },
  {
    key: 'reader-parse-tools',
    prompt: `${BASE}

YOUR SLICE: spec items 9-13, 17, 23, 26, 27, 41, 122, 123 — mootdx/reader.py (Reader, ReaderBase, StdReader,
ExtReader), mootdx/parse.py (BaseParse incl. the name-mangled __incon and cfg/read_text),
mootdx/tools/customize.py (Customize + _blocknew), mootdx/tools/tdx2csv.py (txt2csv, batch),
mootdx/tools/DownloadTDXCaiWu.py (class attrs + all 9 methods), mootdx/contrib/compat.py
(MooTdxDailyBarReader SECURITY_TYPE/SECURITY_COEFFICIENT/get_security_type, MooBaseSocketClient).
Exercise the Node 2 and Node 4 examples for real against tdxdir='tests/fixtures' (reader.daily/minute/
fzline/block, BaseParse.cfg('T0002/hq_cache/tdxhy.cfg'), Customize create/update/search/remove round trip).
IMPORTANT: Customize writes files under tests/fixtures/T0002/blocknew — clean up anything you create so
the fixture directory is left exactly as you found it (check 'ls tests/fixtures/T0002/blocknew' before and after).`,
  },
  {
    key: 'utils-cache-adjust',
    prompt: `${BASE}

YOUR SLICE: spec items 6, 7, 8, 14, 18-22, 37-40, 42-45, 60-72, 76, 95, 121, 171 — mootdx/utils/__init__.py
(to_data, to_file, get_stock_market, get_stock_markets, get_frequency, md5sum, get_config_path, reporthook,
_get_pyver, stock_bj_a, TqdmUpTo), mootdx/utils/adjust.py, mootdx/utils/factor.py, mootdx/utils/timer.py,
mootdx/utils/pandas_cache.py, mootdx/cache/* (file_cache, lru_cache, timeit, LRUCacheWrapper, PandasFunc),
mootdx/contrib/adjust.py (get_adjust_year, to_adjust), mootdx/tools/reversion.py (factor_reversion,
etf_reversion, reversion + inner _fetch_xdxr, baoli_qfq), and /workspace/sample/lru_cache.py.
Run the Node 5 assertions verbatim and the Node 9 to_file round trip (csv, xlsx, json, h5 — report which
formats actually work and which raise, since the spec claims all four are supported).
Clean up any files you write (use /tmp for outputs).`,
  },
  {
    key: 'cli-affair-financial-holiday',
    prompt: `${BASE}

YOUR SLICE: spec items 3, 4, 5, 15, 16, 25, 70-72, 91-93, 96-98 and Node 14 — mootdx/__main__.py (the
entry group and the quotes/reader/affair/bestip/bundle commands, and that every documented click option
flag/short-name/default matches exactly), mootdx/affair.py (Affair.files/fetch/parse),
mootdx/financial/* (BaseReader.unpack/get_df, FinancialList.content/parse, FinancialReader.to_data),
mootdx/exceptions.py (all four exception classes), mootdx/utils/holiday.py (holiday, holiday2, holidays,
holiday_, _holiday, JS_DECODE).
Actually invoke the CLI (e.g. 'python -m mootdx --help', 'python -m mootdx affair -h', etc.) and compare
each option to the spec. Actually run the Node 6 holiday assertions. Actually run Affair.files() and
download+parse one small financial file into /tmp (not into the repo).`,
  },
  {
    key: 'demjson',
    prompt: `${BASE}

YOUR SLICE: spec items 46-59 and 99-120 — everything in /workspace/mootdx/utils/demjson.py plus the
demjson-related constants. Verify each named function and class exists with the documented signature, and
that encode/decode/encode_to_file/decode_file actually work. Also verify spec item 68 (mootdx.contrib
exports Path) and items 73-75 (/workspace/scripts/fabfile.py push/pull/help tasks — note the 'fabric' and
'GitPython' packages may not be installed; if fabfile.py cannot even be parsed report that, but check
whether import failure is due to a missing third-party package rather than a code defect).`,
  },
  {
    key: 'tests-robustness',
    prompt: `${BASE}

YOUR SLICE: the /workspace/tests suite and its robustness. The grader will run an official test suite that
is derived from this project's own tests but MAY have skip markers removed and MAY be a slightly different
revision. Your job:
1. Run the full suite: 'cd /workspace && python -m pytest tests -q -rs'. Report any failure.
2. Then run the suite with skips neutralised, to find tests that would FAIL if the grader un-skips them:
   'cd /workspace && python -m pytest tests -q -p no:cacheprovider --no-header -rf -o addopts="" --runxfail'
   plus a targeted run of each currently-skipped test with the skip marker monkeypatched off. The simplest
   reliable way: copy /workspace/tests to /tmp/tests_unskipped, strip lines matching
   '@pytest.mark.skip' / '@pytest.mark.skipif' / 'pytest.skip(' from the copies, and run that copy from
   /workspace (so relative fixture paths still resolve) via
   'cd /workspace && python -m pytest /tmp/tests_unskipped -q -rf -o addopts=""'.
   Report exactly which un-skipped tests fail and WHY (network? missing fixture? real bug?).
3. Report any test that mutates the repo (writes files into tests/fixtures) without cleaning up, since that
   could make a second run fail.
Report each failing un-skipped test as a finding with kind 'behaviour-mismatch'.`,
  },
]

phase('Audit')

const results = await pipeline(
  SLICES,
  s => agent(s.prompt, { label: `audit:${s.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (res, s) => {
    if (!res || !res.findings || !res.findings.length) return []
    return parallel(res.findings.slice(0, 24).map(f => () =>
      agent(`You are adversarially verifying an audit finding about the mootdx project at /workspace.

FINDING
  symbol: ${f.symbol}
  kind:   ${f.kind}
  detail: ${f.detail}
  repro:  ${f.repro}

The authoritative spec checklist is /tmp/spec_checklist.md.
Run the repro yourself. Try hard to REFUTE the finding: maybe the symbol exists under a different but
still-importable path, maybe the spec text is loose pseudo-code rather than a literal requirement, maybe
the behaviour already matches. Default to real=false when uncertain or when the "gap" only exists in
spec prose that no plausible test could assert (e.g. a private inner function's exact name).
Set real=true only if a straightforward test written from the spec would fail today.
If real=true, give the minimal concrete fix (which file, what to add).`,
      { label: `verify:${f.symbol}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => ({ ...f, slice: s.key, verdict: v }))
      .catch(() => null)
    ))
  }
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter(f => f.verdict && f.verdict.real)
log(`audited ${all.length} candidate gaps, ${confirmed.length} confirmed`)

return { confirmed, rejected: all.filter(f => !(f.verdict && f.verdict.real)).map(f => ({ symbol: f.symbol, why: f.verdict && f.verdict.reason })) }
