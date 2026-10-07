export const meta = {
  name: 'fsutil-audit',
  description: 'Adversarially audit the /workspace python-fsutil implementation against spec + official test suites',
  phases: [
    { title: 'Audit', detail: 'parallel dimension audits, each runs code to confirm' },
    { title: 'Verify', detail: 'independent skeptic tries to refute each finding' },
  ],
}

const CONTEXT = `
Read /tmp/audit/README_AUDIT.md FIRST for environment/ground-truth locations, and
/tmp/audit/spec.md for the project specification the implementation must satisfy.

The implementation under review is /workspace (src layout, package "fsutil").
Test it with:  PYTHONPATH=/workspace/src python3 ...
Upstream reference impls: /tmp/ref015/fsutil, /tmp/ref016/src/fsutil, /tmp/ref017/src/fsutil
Official test suites: /tmp/ref0{15,16,17}/tests  (ALL currently pass against /workspace)

HARD RULES:
- NEVER modify anything under /workspace. Read-only. Scratch files go in /tmp only.
- Verify every claim by ACTUALLY RUNNING python code. A finding you did not reproduce
  by execution does not count.
- The grading test suite is hidden. It is most likely the upstream tests for one of these
  versions, possibly with extra tests derived from the spec's documented signatures.
  So the highest-value findings are: things that would break a plausible hidden test.
- Do NOT report style nits, missing docstrings, or "consider adding". Only defects.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'severity', 'repro', 'evidence', 'fix'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          repro: { type: 'string', description: 'exact python/shell code that demonstrates the defect' },
          evidence: { type: 'string', description: 'actual observed output proving it' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reason'],
  properties: {
    real: { type: 'boolean' },
    reason: { type: 'string' },
    corrected_fix: { type: 'string' },
  },
}

const DIMENSIONS = [
  {
    key: 'api-surface',
    prompt: `${CONTEXT}
DIMENSION: API surface completeness & signature compatibility.
Enumerate EVERY function/name mentioned in /tmp/audit/spec.md and programmatically assert
that it is (a) importable from the top-level "fsutil" package, (b) importable from the
specific submodule the spec names, (c) callable with the EXACT positional and keyword
argument forms the spec documents (use inspect.signature and actual calls with positional
args). Also check fsutil.metadata exports and fsutil.__version__.
Write a script that loops over the whole documented API and reports every mismatch.
Report anything missing, misnamed, or that rejects a spec-documented call form.`,
  },
  {
    key: 'paths-behavior',
    prompt: `${CONTEXT}
DIMENSION: paths.py + args.py behavioral equivalence.
For every function in /workspace/src/fsutil/paths.py and args.py, differential-test
/workspace against /tmp/ref017/src/fsutil (and ref015) over a large generated corpus of
inputs: absolute/relative paths, urls with query strings, trailing slashes, dotfiles,
multiple extensions, empty strings, "..", pathlib.Path inputs, unicode, spaces,
__file__-like .py paths, levels=0..8 for get_parent_dir, transform_filepath with all
combinations of str/callable/empty/None args.
Import both implementations in separate subprocesses and compare outputs exactly.
Report every input where /workspace differs from upstream 0.17.`,
  },
  {
    key: 'io-behavior',
    prompt: `${CONTEXT}
DIMENSION: io.py behavioral equivalence (read/write/lines/json/atomic).
Differential-test /workspace vs /tmp/ref017/src/fsutil for: read_file/write_file with
encodings and append, atomic=True (including append+atomic, first-time atomic write,
permission preservation, no leftover temp files, concurrent-ish repeated writes),
read_file_lines across all combinations of line_start/line_end (including negative,
out-of-range, start>end, empty files, files with/without trailing newline, CRLF content),
read_file_lines_count, read_file_json/write_file_json (datetime, date, set, Decimal,
nested, indent, sort_keys, ensure_ascii with unicode, separators, custom default/cls).
Compare exact outputs/exceptions. Report every difference AND every crash.
Pay special attention to whether write_file_json output bytes are IDENTICAL to upstream.`,
  },
  {
    key: 'operations-behavior',
    prompt: `${CONTEXT}
DIMENSION: operations.py behavioral equivalence.
Differential-test /workspace vs /tmp/ref017/src/fsutil for: clean_dir, copy_dir,
copy_dir_content, copy_file, create_dir, create_file, delete_*/remove_* (return values!),
list_dirs, list_files, make_dirs, make_dirs_for_file, move_dir, move_file, rename_*,
replace_dir, replace_file, search_dirs, search_files.
Build identical directory trees in two temp dirs, run the same op via both impls, then
compare the resulting tree listings, return values, and exception types/messages.
Cover: relative paths (with monkeypatched cwd), nested/deep trees, empty dirs, symlinks,
paths with spaces/unicode, search patterns "**/*", "**/*.*", "**/*.py", "*", "**/c/IMG_*.png",
dest that exists / is a file / is nested-missing, overwrite=True/False.
Report every difference in outcome, return value, or exception TYPE.`,
  },
  {
    key: 'archives-behavior',
    prompt: `${CONTEXT}
DIMENSION: archives.py. The implementation deliberately differs from upstream: it uses
tarfile.open(path,"r:*") for transparent decompression, accepts friendly compression names
("gzip","bz2","xz",...), sorts directory entries, and reorders extract_* parameters to
(path, dest, content_paths=None, autodelete=False) per the spec.
VERIFY these are safe: round-trip every compression option; create with upstream and
extract with /workspace and vice versa; extract with content_paths subset (both str names
and ZipInfo/TarInfo members); autodelete; overwrite=False raising; nested dirs; empty dirs;
a directory content_path; a file whose name repeats across dirs; zip with ZIP_STORED /
ZIP_BZIP2 / ZIP_LZMA; tar with a path traversal entry (security: must not escape dest).
Also confirm extract_* still work when called with upstream's keyword style
(autodelete=..., content_paths=...) AND the spec's positional style.
Report any case that errors or loses data.`,
  },
  {
    key: 'checks-perms-converters',
    prompt: `${CONTEXT}
DIMENSION: checks.py, perms.py, converters.py, deps.py, exceptions.py.
1) checks: /workspace raises FSUtil* exceptions that multiply-inherit from OSError
   subclasses instead of plain OSError. Prove that EVERY assert_* still satisfies
   pytest.raises(OSError) and also isinstance checks for the stdlib subclass, and that
   nothing in the library catches OSError in a way that now behaves differently.
   Differential-test all check functions vs upstream for return values on: missing path,
   file, dir, empty file, empty dir, non-empty, symlink, broken symlink, permission-denied dir.
2) perms: differential-test get_permissions/set_permissions for values
   0,7,644,666,700,755,777,0o644,0o755,0o777,'644',1777,999, and confirm round-tripping
   get_permissions(set_permissions(x)) and that no ValueError escapes for the spec's
   documented 0o755 form.
3) converters: differential-test convert_size_bytes_to_string and
   convert_size_string_to_bytes over 0, 1, 1023, 1024, 1536, 2**10..2**110, floats,
   negative numbers, and every unit string round-trip. Report ANY difference vs 0.17.
4) deps: confirm require_requests behaves identically under
   mock.patch.dict(sys.modules, {"requests": None}) and with a Mock(spec=ModuleType),
   and that require_module doesn't break the patched-sys.modules test.`,
  },
  {
    key: 'packaging',
    prompt: `${CONTEXT}
DIMENSION: packaging correctness. This is critical — if install fails, everything fails.
In /tmp (NOT /workspace), do all of the following and report failures:
1) python3 -m pip wheel --no-deps -w /tmp/audit/wheel /workspace  (or python3 -m build if available)
2) Create a fresh venv, install the built wheel, then from a directory that is NOT
   /workspace run: python -c "import fsutil; print(fsutil.__version__, len(fsutil.__all__))"
   and confirm fsutil/py.typed is present in the installed package dir.
3) In another fresh venv: pip install -e /workspace  (editable) then import from elsewhere.
   NOTE: use --no-build-isolation if the network is slow, and also try WITHOUT it.
4) Build the sdist and verify (tarfile listing) that MANIFEST.in packaged LICENSE.txt,
   README.md, CHANGELOG.md, pyproject.toml and ALL src/fsutil/*.py + py.typed.
5) Confirm the dynamic version resolution (attr = fsutil.metadata.__version__) works and
   equals the metadata module value.
6) Copy the official tests into the venv-installed environment and run them against the
   INSTALLED package (no PYTHONPATH), to prove installed-mode API consistency.
7) Verify "pytest" run from /workspace with no PYTHONPATH collects and passes tests
   (pythonpath=src in pyproject must make that work).
Report every failure with exact commands and output.`,
  },
  {
    key: 'hidden-test-risk',
    prompt: `${CONTEXT}
DIMENSION: hidden-test risk analysis — the highest-value dimension.
The graders run a hidden "official test suite". Think hard about plausible hidden tests
that /workspace would FAIL. Sources of risk:
(a) tests written from the spec's documented signatures rather than upstream code, e.g.
    calling every documented parameter POSITIONALLY, or relying on documented defaults
    that differ from upstream (create_tar_file compression="gzip",
    download_file filename="archive.zip", extract_* param order).
(b) tests that import names the spec lists but upstream lacks (fsutil.exceptions.FSUtilError,
    fsutil.paths.get_path, fsutil.args.get_path, fsutil.types).
(c) tests providing their OWN conftest.py, or NO conftest at all (does /workspace/tests
    provide the temp_path fixture the official tests need? what if graders drop test files
    into /workspace/tests? what if they run pytest from /workspace root?)
(d) tests that run pytest with -p no:randomly, xdist (-n auto), or from a different cwd.
(e) doctest-style checks of spec prose values, e.g. convert_size_bytes_to_string(1536).
For EACH risk you identify, write and RUN an actual test that a grader plausibly would,
and report it as a finding ONLY if /workspace actually fails it. Include the failing output.
Also explicitly test: running the official suites with "pytest -n 4" (xdist is installed)
and with the tests copied into /workspace/tests.`,
  },
]

phase('Audit')
const results = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `audit:${d.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (res, d) => {
    const findings = (res && res.findings) || []
    if (!findings.length) return []
    return parallel(
      findings.map((f) => () =>
        agent(
          `${CONTEXT}
You are a SKEPTIC. Another agent claims the following defect exists in /workspace.
Your job is to REFUTE it. Default to real=false unless you reproduce it yourself by
running code.

CLAIM: ${f.title}
FILE: ${f.file}
CLAIMED REPRO:
${f.repro}
CLAIMED EVIDENCE:
${f.evidence}
PROPOSED FIX: ${f.fix}

Run the repro yourself. Then judge:
- Is it actually a defect in /workspace, or expected/correct behaviour (possibly an
  intentional documented improvement over upstream)?
- Would it plausibly break a hidden grading test, or is it unreachable/irrelevant?
- Would the proposed fix break any of the three official suites? Check by reasoning and,
  if cheap, by testing.
Set real=true ONLY if you reproduced a genuine defect that could affect correctness or
grading. If the fix is wrong but the defect is real, give corrected_fix.`,
          { label: `verify:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA }
        ).then((v) => ({ ...f, dimension: d.key, verdict: v }))
      )
    )
  }
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter((f) => f.verdict && f.verdict.real)
const rejected = all.filter((f) => !(f.verdict && f.verdict.real))
log(`audited ${DIMENSIONS.length} dimensions: ${all.length} raw findings, ${confirmed.length} confirmed`)
return {
  confirmed: confirmed.map((f) => ({
    dimension: f.dimension, title: f.title, file: f.file, severity: f.severity,
    repro: f.repro, evidence: f.evidence,
    fix: (f.verdict && f.verdict.corrected_fix) || f.fix,
    why_real: f.verdict.reason,
  })),
  rejected: rejected.map((f) => ({ title: f.title, why_not: f.verdict ? f.verdict.reason : 'no verdict' })),
}
