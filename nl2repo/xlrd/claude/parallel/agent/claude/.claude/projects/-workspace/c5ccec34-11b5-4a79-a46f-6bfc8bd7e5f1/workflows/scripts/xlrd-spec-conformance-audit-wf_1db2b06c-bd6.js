export const meta = {
  name: 'xlrd-spec-conformance-audit',
  description: 'Exhaustively audit the /workspace xlrd implementation against the project spec, adversarially verify each gap',
  phases: [
    { title: 'Audit', detail: 'parallel auditors, one per spec slice (read-only)' },
    { title: 'Verify', detail: 'adversarially verify each reported gap' },
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
          title: { type: 'string', description: 'one-line gap description' },
          spec_ref: { type: 'string', description: 'which spec section/node this comes from' },
          location: { type: 'string', description: 'file:line in /workspace, or "missing file: X"' },
          evidence: { type: 'string', description: 'exact python snippet + observed output/traceback proving the gap' },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor', 'cosmetic'] },
          suggested_fix: { type: 'string' },
        },
        required: ['title', 'spec_ref', 'location', 'evidence', 'severity', 'suggested_fix'],
      },
    },
    notes: { type: 'string', description: 'anything checked and found already correct, briefly' },
  },
  required: ['findings', 'notes'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true if the gap is real and worth fixing' },
    breaks_upstream_tests: { type: 'boolean', description: 'true if the suggested fix would break the existing /workspace/tests suite' },
    reasoning: { type: 'string' },
    corrected_fix: { type: 'string', description: 'the fix you would actually apply, precise' },
  },
  required: ['real', 'breaks_upstream_tests', 'reasoning', 'corrected_fix'],
}

const COMMON = `
CONTEXT: /workspace contains a Python project that must implement the spec at /tmp/SPEC.md.
It is a port of the xlrd 2.0.1 library (reading Microsoft Excel .xls files). Read /tmp/SPEC.md first.
Sample .xls files for experimentation live in /workspace/tests/samples/.
The existing test suite (/workspace/tests) currently passes 84/84 via: cd /workspace && python -m pytest tests/ -q

YOUR JOB IS READ-ONLY AUDITING. Do NOT edit, create, or delete any file under /workspace.
You MAY run python one-liners / heredoc scripts (write scratch files only under /tmp) to empirically probe behaviour.
ALWAYS empirically verify a suspected gap by actually running python from /workspace before reporting it.
Do not report stylistic preferences. Report only things that would make a spec-derived test or a spec-following
user's code FAIL, or documented-but-missing surface area.
Be exhaustive within your slice. Report an empty findings list if everything checks out.
`

phase('Audit')

const SLICES = [
  {
    key: 'toplevel-exports',
    prompt: `Audit slice: the top-level package API surface of /workspace/xlrd/__init__.py.
Check EVERY name the spec says must be importable. In particular verify each of these actually works from /workspace:
  import xlrd
  from xlrd.biffh import XL_CELL_TEXT, XL_CELL_ERROR, hex_char_dump
  from xlrd import (open_workbook, XLRDError, xldate, inspect_format, biffh, FILE_FORMAT_DESCRIPTIONS, XLS_SIGNATURE, ZIP_SIGNATURE, PEEK_SIZE)
  from xlrd.xldate import xldate_as_tuple, xldate_from_date_tuple, xldate_from_datetime_tuple, xldate_from_time_tuple
  from xlrd.timemachine import xrange, UNICODE_LITERAL
  from xlrd.book import Book
  from xlrd.sheet import Sheet
Also spec item 6 says __init__.py must import/export "open_workbook, XLRDError, xldate, inspect_format, biffh, XL_CELL_TEXT, xrange, UNICODE_LITERAL, and Book, and provide version information", and that
"from xlrd.biffh/timemachine/book import **" (i.e. import *) must work.
So check: xlrd.xrange, xlrd.UNICODE_LITERAL, xlrd.Book, xlrd.Sheet, xlrd.ctype_text, xlrd.error_text_from_code, xlrd.empty_cell,
xlrd.colname, xlrd.XLDateError, xlrd.xldate_as_tuple, xlrd.xldate_as_datetime, xlrd.__version__, xlrd.__VERSION__,
xlrd.XL_CELL_* (all 7), xlrd.book.XL_CELL_TEXT, and 'from xlrd.biffh import *' / 'from xlrd.timemachine import *' / 'from xlrd.book import *' / 'from xlrd import *'.
Report every name mentioned anywhere in /tmp/SPEC.md that is NOT reachable at the place the spec implies.`,
  },
  {
    key: 'sheet-api',
    prompt: `Audit slice: the Sheet API in /workspace/xlrd/sheet.py against spec sections 3,5,6,9,10,11,12,13,14,15 and Nodes 2,3,4,10,11,12,13.
Empirically exercise on real samples: cell, cell_value, cell_type, cell_xf_index, row, col, row_slice, row_values, row_types,
col_slice, col_values, col_types, get_rows, row_len, name/nrows/ncols, merged_cells, cached_page_break_preview_mag_factor,
cached_normal_view_mag_factor, sheet[0], sheet[0,1], iteration over sheet, and keyword-arg forms used in the spec
(e.g. sheet.cell_value(rowx=2, colx=1), sheet.cell_type(rowx=2, colx=1)).
Verify exact signatures and default values match the spec. Verify ragged_rows=True + row_len behaviour using tests/samples/ragged.xls.
Verify formatting_info=True paths using tests/samples/xf_class.xls and Formate.xls.`,
  },
  {
    key: 'book-api',
    prompt: `Audit slice: the Book API in /workspace/xlrd/book.py against spec section 23 and Nodes 1, 14, plus the open_workbook
signature in spec section 2 (parameter names, order and defaults MUST match exactly).
Empirically verify: book[0], book['SheetName'], iteration over book, sheet_names(), sheets(), sheet_by_index, sheet_by_name,
nsheets, datemode, biff_version, formatting_info, ragged_rows, filename, file_contents, _data, _position, _sheet_names, _sheets,
on_demand behaviour (sheet_by_index/unload_sheet/release_resources), reading from memory via file_contents=,
and use_mmap / encoding_override / verbosity / logfile params.
Confirm the documented default of use_mmap and every other default matches the spec signature.`,
  },
  {
    key: 'xldate',
    prompt: `Audit slice: /workspace/xlrd/xldate.py against spec sections 16, 19, 20, 26 and Node 5.
Verify xldate_as_tuple, xldate_as_datetime, xldate_from_date_tuple, xldate_from_datetime_tuple, xldate_from_time_tuple,
XLDateError and its subclasses (XLDateNegative, XLDateAmbiguous, XLDateTooLarge, XLDateBadDatemode, XLDateBadTuple, XLDateError).
Check both datemodes (0 and 1), edge cases (0.0, 60.0, 61.0, negative, > 2958465), and that datetime(*date_tuple) works
for the values in the spec examples. Verify these are reachable both as xlrd.X and xlrd.xldate.X where the spec implies it.`,
  },
  {
    key: 'biffh-constants',
    prompt: `Audit slice: /workspace/xlrd/biffh.py against spec sections 18, 21, 22, 24, 26, 28.
Verify: all XL_CELL_* constants and their integer values (EMPTY=0, TEXT=1, NUMBER=2, DATE=3, BOOLEAN=4, ERROR=5, BLANK=6),
ctype_text dict exactly as spec section 21 lists it, error_text_from_code contents, XLRDError, XLDateError re-export,
hex_char_dump(strg, ofs, dlen, base=0, fout=sys.stdout, unnumbered=False) exact signature and that non-printable chars show as '.',
biff_dump, biff_count_records, unpack_string, unpack_unicode, and the XLS_SIGNATURE / ZIP_SIGNATURE / PEEK_SIZE values.
Actually call hex_char_dump on some bytes and paste the output.`,
  },
  {
    key: 'packaging',
    prompt: `Audit slice: packaging and repository layout against the spec's "Project Directory Structure" and item 6.
1. Compare the actual /workspace file tree (including dotfiles) with the tree in /tmp/SPEC.md. Report any file in the spec tree
   that is missing, and note extra files.
2. Read /workspace/setup.py. Spec item 6 demands: installable via pip install, AND "declare a complete list of dependencies
   (such as actual core libraries like coverage==7.2.7, exceptiongroup==1.3.0 etc)". Report whether dependencies are declared,
   and assess the risk of pinning them (the env already has exactly those versions installed; pip is 21.0.1; there is NO pyproject.toml
   so pip uses the legacy setup.py path with ambient setuptools).
3. Actually test installability in a throwaway venv-free way: run 'cd /workspace && python setup.py --version' and
   'python setup.py check' and 'python -m pip install --no-deps --no-build-isolation -e . --target /tmp/instchk 2>&1 | tail'
   (or 'python setup.py sdist -d /tmp/sdistchk') and report failures. Do not modify /workspace.
4. Check README.rst mentions .xls-only + openpyxl recommendation (prompt item 1). Check MANIFEST.in correctness
   (it currently references README.md but the file is README.rst -> is that a real problem for sdist?).
5. Check scripts/runxlrd.py is listed in setup.py and is executable/working.`,
  },
  {
    key: 'errors',
    prompt: `Audit slice: error handling, spec "Error Handling" section and Nodes 7, 8, 9, plus Limitations 13, 14, 16.
Empirically verify from /workspace:
- xlrd.open_workbook("nonexistent_file.xls") raises FileNotFoundError (NOT IOError/XLRDError). Paste the traceback.
- book.sheet_by_index(10) raises IndexError.
- book.sheet_by_name("nope") raises xlrd.XLRDError.
- xlrd.open_workbook(tests/samples/sample.xlsx) raises XLRDError with message exactly 'Excel xlsx file; not supported'.
  Also check .ods, .xlsb, .zip messages against FILE_FORMAT_DESCRIPTIONS.
- xlrd.inspect_format on tests/samples/sample.txt returns None; on a nonexistent path -> what happens?
- ignore_workbook_corruption=True on tests/samples/corrupted_error.xls works and False raises CompDocError.
- "Cannot determine BIFF version" and "Failed to extract workbook" error paths exist in the code (find them).
- password-protected file detection -> XLRDError (find the code path, e.g. FILEPASS record).
Report any deviation from the spec's stated exception types/messages.`,
  },
  {
    key: 'special-content',
    prompt: `Audit slice: prompt item 3 - "Special content in Excel files (charts, macros, pictures, embedded objects, VBA modules,
formulas, comments, hyperlinks, auto-filters, advanced filters, data validation, etc.) should be specially handled and
safely ignored." And Limitations 8 and 9, and Node 6 (formula RESULTS are extracted).
Find, in /workspace/xlrd/{book,sheet,biffh,compdoc,formatting}.py, the record-handling code that ignores each of these
(XL_OBJ, XL_MSO_DRAWING, XL_NOTE/TXO, XL_HLINK, XL_FILTERMODE, XL_DVAL/XL_DV, XL_CHART?, VBA storage in compdoc, etc.)
and empirically prove ignoring works by opening tests/samples/picture_in_cell.xls (contains an embedded picture) and
formula samples, with formatting_info both False and True. Report anything that crashes or warns unexpectedly on stdout/stderr,
and any of the listed special-content kinds that has NO handling at all (would that crash?).
Also confirm formula RESULT extraction works (Node 6) on tests/samples/formula_test_sjmachin.xls.`,
  },
  {
    key: 'cli-runxlrd',
    prompt: `Audit slice: prompt item 4 (command-line interfaces for each functional module, terminal-call testable) and the spec's
CLI section. Read /workspace/scripts/runxlrd.py and actually run, from /workspace:
  python scripts/runxlrd.py ov tests/samples/namesdemo.xls
  python scripts/runxlrd.py 3rows tests/samples/namesdemo.xls
  python scripts/runxlrd.py biff_count tests/samples/namesdemo.xls
  python scripts/runxlrd.py show tests/samples/namesdemo.xls
  python scripts/runxlrd.py --help
and every other command the script advertises (labels, count-rows, xfc, hotshot/profile ones may be skipped if they need
extra deps - note that). Report every command that errors out, with the traceback. Note Python 3.7 incompatibilities.
Also assess: is there a module-level entry point (python -m xlrd)? The spec/prompt asks for CLI per functional module -
report the absence of an 'inspect_format' CLI or a data-parsing CLI as a gap against prompt item 4 if there is none.`,
  },
  {
    key: 'examples-tests',
    prompt: `Audit slice: prompt item 5 - "Provide sample code and test cases to demonstrate how to use functions such as
open_workbook() for file reading and data parsing... The final project should include modules for file reading, data parsing,
etc., along with typical test cases, to form a reproducible reading process."
Inventory what /workspace actually provides: list /workspace/tests/*, and check whether there is any examples/ directory,
demo script, or usage documentation. Report as gaps: missing example scripts, missing docs on usage, missing test coverage
for any spec API (go through /tmp/SPEC.md sections 2-28 and Nodes 1-14 and say which ones have NO test in /workspace/tests).
Run 'cd /workspace && python -m pytest tests/ -q' and report the result. Also run with coverage:
'python -m pytest tests/ -q --cov=xlrd --cov-report=term-missing 2>&1 | tail -30' and report the coverage numbers per module.`,
  },
  {
    key: 'spec-snippets',
    prompt: `Audit slice: RUN THE SPEC. Extract EVERY python code snippet from /tmp/SPEC.md (sections "API Usage Guide",
"Actual Usage Patterns", "Basic Usage", "Advanced Usage", and all 14 "Detailed Implementation Nodes") and execute each one
from /workspace, substituting real files from /workspace/tests/samples/ for the placeholder names
("example.xls" -> pick a suitable sample such as namesdemo.xls / Formate.xls / xf_class.xls,
 "example.xlsx" -> sample.xlsx, "ragged_data.xls" -> ragged.xls, "complex_data.xls" -> formula_test_sjmachin.xls,
 "Sheet1" -> a real sheet name from the chosen book).
Write your scratch scripts under /tmp only. For each snippet, report PASS or the exact traceback.
This is the single most important audit slice: a spec-derived test suite will look exactly like these snippets.
Be exhaustive - do not skip a single snippet, including the f-string ones and the hasattr() ones.
Note: keyword names used in the spec (rowx=, colx=, path=, content=) must work.`,
  },
  {
    key: 'hidden-test-surface',
    prompt: `Audit slice: think like the grader. The project will be scored by an "official test suite" that we cannot see.
The implementation is xlrd 2.0.1. Predict what that suite most plausibly contains and check we would pass:
1. The real xlrd project's own tests (already present under /workspace/tests - confirm all pass).
2. Tests auto-generated from /tmp/SPEC.md's documented API.
Enumerate any API name, signature detail, default value, error message string, or documented behaviour in /tmp/SPEC.md that
differs from what /workspace actually does - ESPECIALLY where the spec's prose was inherited from an older xlrd version and
now contradicts the 2.0.1 code (e.g. "formatting_info ... Raises NotImplementedError when used with xlsx files";
"use_mmap ... Determined heuristically if not specified"; "Limited .xlsx support: reading .xlsx may raise XLRDError or
NotImplementedError"; "runs on Python 2.7+ and 3.6+"). For each, judge which behaviour a test would assert and whether a
compatible implementation could satisfy BOTH the spec prose and the existing tests. Also check whether tests might import
'from tests.helpers import from_sample' vs 'from .helpers import from_sample', whether /workspace/tests/__init__.py exists,
whether pytest rootdir/conftest.py setup would let a dropped-in test file import xlrd from the repo without installation,
and whether a setup.cfg/pytest.ini [tool:pytest] section is needed. Report concrete risks with mitigations.`,
  },
]

const audited = await pipeline(
  SLICES,
  s => agent(COMMON + '\n' + s.prompt, { label: `audit:${s.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA })
       .then(r => ({ slice: s.key, ...(r || { findings: [], notes: 'agent returned null' }) })),
  (res) => parallel((res.findings || []).map(f => () =>
    agent(`You are an adversarial verifier for an audit finding about the Python project in /workspace
(a port of xlrd 2.0.1 for reading .xls files; spec at /tmp/SPEC.md).

FINDING (from slice "${res.slice}"):
  title: ${f.title}
  spec_ref: ${f.spec_ref}
  location: ${f.location}
  severity: ${f.severity}
  evidence claimed: ${f.evidence}
  suggested fix: ${f.suggested_fix}

Your job: try to REFUTE it. Actually run python from /workspace to check whether the claimed behaviour is real.
Default to real=false if you cannot reproduce it. Then decide whether the suggested fix would BREAK the existing
test suite (run 'cd /workspace && python -m pytest tests/ -q' to see the 84-passing baseline; reason about whether the
fix would change any asserted behaviour - you may prototype the fix in a COPY of the tree under /tmp, never edit /workspace).
Return a precise corrected_fix that a maintainer could apply verbatim (name exact file, exact code).
Remember: this is xlrd 2.0.1 and the existing tests are authoritative - a "fix" that contradicts them is wrong.`,
      { label: `verify:${(f.title || '').slice(0, 48)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => ({ slice: res.slice, finding: f, verdict: v }))
  ))
)

const flat = audited.flat().filter(Boolean)
const confirmed = flat.filter(x => x.verdict && x.verdict.real)
log(`audit complete: ${flat.length} findings examined, ${confirmed.length} confirmed real`)

return {
  confirmed: confirmed.map(x => ({
    slice: x.slice,
    severity: x.finding.severity,
    title: x.finding.title,
    spec_ref: x.finding.spec_ref,
    location: x.finding.location,
    evidence: x.finding.evidence,
    breaks_upstream_tests: x.verdict.breaks_upstream_tests,
    fix: x.verdict.corrected_fix,
    reasoning: x.verdict.reasoning,
  })),
  refuted: flat.filter(x => !(x.verdict && x.verdict.real)).map(x => ({ title: x.finding.title, why: x.verdict && x.verdict.reasoning })),
}
