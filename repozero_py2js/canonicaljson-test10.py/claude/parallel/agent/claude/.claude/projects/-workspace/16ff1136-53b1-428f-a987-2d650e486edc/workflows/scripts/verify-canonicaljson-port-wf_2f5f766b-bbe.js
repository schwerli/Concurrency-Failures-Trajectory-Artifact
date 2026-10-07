export const meta = {
  name: 'verify-canonicaljson-port',
  description: 'Adversarially fuzz and review the Python->Node port of test10.py',
  phases: [
    { title: 'Fuzz', detail: 'independent differential campaigns per behavioural area' },
    { title: 'Review', detail: 'code review lenses over the ported modules' },
    { title: 'Verify', detail: 'reproduce each claimed defect against the reference binary' },
    { title: 'Synthesize', detail: 'merge confirmed defects into one report' },
  ],
}

const CONTEXT = `
You are verifying a Python-to-Node.js port.

REFERENCE (ground truth, a PyInstaller bundle of CPython 3.13 running test10.py):
  /workspace/dataset/test10_executable --a <str> --b <int> --c <float>
SOURCE: /workspace/dataset/test10.py
PORT:   /output/test10.mjs  (+ /output/lib/**/*.mjs)
Run the port with:  node /output/test10.mjs --a <str> --b <int> --c <float>

The program builds a dict {string,integer,float,list} and prints:
  line 1: repr() of canonicaljson.encode_canonical_json(data)   -> a Python bytes repr
  line 2: repr() of canonicaljson.encode_pretty_printed_json(data)
  line 3: len(list(canonicaljson.iterencode_canonical_json(data)))

A DIFFERENTIAL HARNESS already exists:
  node /tmp/diff/run.mjs <cases.json>        # prints "PASS n/m" then diffs
  cases.json is a JSON array of argv arrays, e.g. [["--a","x","--b","1","--c","1.5"]]
  It compares stdout, stderr (PyInstaller PID line normalised) and exit status.
  It already passes 1092/1092 on an existing corpus at /tmp/diff/cases.json.
  NOTE: argv cannot contain NUL bytes or lone surrogates - exclude those.

RULES
- The reference binary is the only source of truth. NEVER guess what Python does;
  run the binary.
- Do not modify anything under /output. Do not modify /tmp/diff/run.mjs.
  Write your own case files to /tmp/diff/<your-unique-name>.json.
- Every claimed defect MUST come with a concrete argv vector where the reference
  binary and the port disagree, plus both actual outputs.
`;

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          argv: { type: 'array', items: { type: 'string' }, description: 'exact argv that diverges, or [] for a non-behavioural issue' },
          referenceOutput: { type: 'string' },
          portOutput: { type: 'string' },
          file: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['title', 'argv', 'explanation'],
      },
    },
    casesRun: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
};

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    evidence: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['real', 'evidence', 'reasoning'],
};

const FUZZ_AREAS = [
  {
    key: 'float-repr',
    prompt: `Attack FLOAT FORMATTING. Python's float repr uses shortest-round-trip digits with
its own fixed/exponential threshold and zero-padded exponents. Generate at least 3000 --c values
spanning: subnormals, values near the fixed<->exponential switch in BOTH directions, 15/16/17
significant digit values, values whose shortest repr ends in trailing zeros, powers of ten from
1e-330..1e308, negative zero, values that round-trip ambiguously, halfway cases (x.5 ulp),
random uniform bit patterns reinterpreted as doubles (via a Float64Array + DataView) written back
as decimal strings, and overflow/underflow literals. Hold --a and --b at simple values.`,
  },
  {
    key: 'int-parse',
    prompt: `Attack INTEGER PARSING AND RENDERING for --b. Python ints are arbitrary precision.
Generate at least 2000 values: huge magnitudes (100+ digits), leading zeros, sign forms,
PEP 515 underscores in every legal and illegal position, every kind of surrounding whitespace
(ASCII tab newline vtab formfeed CR space, plus U+0085 U+00A0 U+1680 U+2000..U+200A U+2028 U+2029
U+202F U+205F U+3000, and the C0 separators U+001C..U+001F which behave DIFFERENTLY), non-ASCII
decimal digits from many scripts (Arabic-Indic, Devanagari, Thai, fullwidth, Osmanya/astral Nd
digits), mixed-script digits, digits with combining marks, and near-miss junk. Verify error text
matches too.`,
  },
  {
    key: 'float-parse',
    prompt: `Attack FLOAT PARSING for --c. Generate at least 2000 values: every legal decimal shape
(.5, 5., 1.e5, +.5), exponent forms, underscores in legal/illegal positions, inf/infinity/nan in
mixed case with signs, whitespace variants including all the non-ASCII Python-whitespace code points
and the C0 separators U+001C..U+001F, non-ASCII decimal digits, hex-float attempts, thousands
separators, unicode minus U+2212, and near-miss junk. Values that parse to nan/inf must produce the
ValueError path - check exit status and stderr shape. Verify error text matches too.`,
  },
  {
    key: 'string-escape',
    prompt: `Attack STRING ESCAPING and the bytes repr for --a. Generate at least 2500 values:
every C0 control character individually and in combination, DEL U+007F, C1 controls U+0080..U+009F,
backslash and quote combinations (strings containing only single quotes, only double quotes, both,
and neither - the bytes repr picks its quote character based on this), U+2028/U+2029, BOM,
zero-width and bidi controls, astral/emoji/flag sequences, combining marks, unassigned code points,
private use, non-characters U+FFFE/U+FFFF, long strings (1KB+), strings that look like JSON or like
options, and strings mixing all of the above. Confirm the byte-for-byte repr on BOTH output lines.`,
  },
  {
    key: 'argparse',
    prompt: `Attack ARGUMENT PARSING. Enumerate argv shapes exhaustively rather than randomly:
missing/duplicate/reordered options, equals-sign syntax vs space syntax, every abbreviation of
--a --b --c --help (--h, --he, --hel, -h, -hh, -hx, -h=1, -h-x, --=x, ---a), single-dash forms,
values that look like options (-1, -1.5, -1e5, -inf, -.5, a lone dash, a double dash, a triple
dash), the negative-number heuristic (which accepts plain ints and plain decimals but NOT
exponents), values containing spaces, empty-string values, a double dash in every position, tokens
after a double dash, unrecognised options and positionals, and interactions where -h appears after
an invalid value. Also check that the --help/usage text matches byte-for-byte, including under
COLUMNS=1,11,20,40,47,48,79,80,200 (set COLUMNS in the environment for BOTH processes and compare;
note run.mjs unsets COLUMNS, so for this sub-task write your own tiny comparison script rather than
using run.mjs). Report exit statuses and stderr too. At least 400 shapes.`,
  },
  {
    key: 'chunk-count',
    prompt: `Attack THE THIRD OUTPUT LINE, the chunk count from iterencode_canonical_json. Establish
empirically whether it is ever anything other than 20 for this program, across at least 800 varied
inputs (all three axes varied together, including extreme strings/ints/floats). Then read
/output/lib/json/encoder.mjs and reason about whether its generator would reproduce CPython's
chunk boundaries for OTHER shapes too (nested lists/dicts, empty containers, non-string dict keys,
indent set). Report any place the port's chunking rule is structurally wrong even if this program
cannot reach it - but mark such findings with argv: [].`,
  },
  {
    key: 'combined-random',
    prompt: `Run a broad UNBIASED random campaign varying all three arguments simultaneously.
At least 6000 cases. Draw --a from a mixed generator over the whole Unicode range (excluding NUL
and lone surrogates), --b from a mixed integer generator including huge and malformed values, --c
from a mixed float generator including malformed values, nan/inf, and extreme magnitudes. Include
some cases that omit arguments or add junk tokens. Report every divergence class you find.`,
  },
];

const REVIEW_LENSES = [
  {
    key: 'float-repr-code',
    prompt: `Read /output/lib/pyfloat.mjs and /output/lib/pyint.mjs. Audit floatRepr against
CPython's float_repr_style / format_float_short 'r' mode: shortest round-trip digits, exponential
when decpt <= -4 or decpt > 16, exponent zero-padded to >= 2 digits, mandatory .0 in fixed form,
signed zero. Look for off-by-one thresholds, digit-string extraction bugs (the minus and dot
stripping in shortestDigits), and the fallback loop's correctness. Prove each concern by running
the reference binary at the specific value you suspect.`,
  },
  {
    key: 'numeric-parse-code',
    prompt: `Read /output/lib/pyint.mjs, /output/lib/pyfloat.mjs and /output/lib/pyunicode.mjs.
Audit against CPython's PyLong_FromUnicodeObject / PyFloat_FromString:
_PyUnicode_TransformDecimalAndSpaceToASCII folds only code points >= 127, then the ASCII parser
strips only Py_ISSPACE. Check the whitespace table, the decimalValue run-walking trick (is it right
for every Nd block, including astral ones?), the underscore rule, sign handling, signed zero, and
BigInt conversion. Also check DECIMAL_FLOAT rejects/accepts exactly what Python does. Prove each
concern against the reference binary.`,
  },
  {
    key: 'encoder-code',
    prompt: `Read /output/lib/json/encoder.mjs, /output/lib/json/escape.mjs and
/output/lib/canonicaljson.mjs. Audit against CPython's json/encoder.py _make_iterencode: the list
buffer merging, the dict's three separate yields per key, empty-container short circuits, indent
bookkeeping, key coercion order, sort_keys ordering (code point, not UTF-16 unit), the
ensure_ascii=False escape set (exactly backslash, double quote, and U+0000..U+001F - nothing else),
and separators when indent is set. Verify the chunk count and both output lines against the
reference binary for anything you suspect.`,
  },
  {
    key: 'repr-code',
    prompt: `Read /output/lib/pyrepr.mjs and /output/lib/pyunicode.mjs. Audit bytesRepr against
CPython PyBytes_Repr (smart quote selection, which bytes get backslash-x escapes, lowercase hex,
DEL and above) and strRepr against unicode_repr (quote selection, Py_UNICODE_ISPRINTABLE = not
Cc/Cf/Cs/Co/Cn/Zl/Zp/Zs except U+0020, and the x/u/U escape widths). strRepr is reachable via
argparse's "invalid int value" message - use that to test it against the reference binary with
exotic --b values.`,
  },
  {
    key: 'argparse-code',
    prompt: `Read /output/lib/argparse/parser.mjs and /output/lib/argparse/formatter.mjs. Audit
against CPython 3.13 argparse: _parse_optional, _get_option_tuples, consume_optional's
action_tuples loop, _match_argument with the dash-stripped nargs pattern for optionals,
_get_values, required-before-extras ordering, error/usage/exit codes, HelpFormatter's
_max_help_position clamp, _format_usage re-flow, and textwrap behaviour. Prove each concern by
running the reference binary, including with COLUMNS set to small values.`,
  },
  {
    key: 'requirements',
    prompt: `Audit COMPLIANCE with the migration task's hard requirements, not behaviour:
(1) pure JavaScript for Node.js, ESM only - import/export everywhere, absolutely no require()
or module.exports anywhere under /output;
(2) every generated file uses the .mjs suffix and every relative import includes the full suffix;
(3) ZERO external dependencies - no npm packages, no bare-specifier imports at all (node: builtins
would be allowed but bare npm specifiers are not); no package.json needed;
(4) no embedded Python and no shelling out to python;
(5) libraries are split into multiple modules by functionality under /output and expose their
interfaces via export;
(6) the code must NOT use JSON.stringify anywhere (custom sorting/normalisation logic is required
to be hand-written) - grep for it;
(7) command-line arguments match the Python exactly: --a str required, --b int required,
--c float required, no defaults.
Also verify the port runs on the installed Node version with no flags and no warnings, and that
every file under /output actually parses (import each module). Report violations as findings with
argv: [].`,
  },
];

phase('Fuzz')

const fuzzResults = await pipeline(
  FUZZ_AREAS,
  (area) => agent(
    `${CONTEXT}\n\nYOUR ASSIGNMENT (id: ${area.key}):\n${area.prompt}\n\n` +
    `Write your generator and case file under /tmp/diff/${area.key}-cases.json, run the harness, ` +
    `and iterate: when you find a divergence, minimise it to the smallest argv that still ` +
    `diverges. Report the number of cases you actually ran in casesRun. If you find nothing, ` +
    `say so plainly with an empty findings array - do NOT invent findings.`,
    { label: `fuzz:${area.key}`, phase: 'Fuzz', schema: FINDINGS },
  ),
  (result, area) => {
    if (!result || !result.findings || result.findings.length === 0) return [];
    return parallel(result.findings.map((f) => () =>
      agent(
        `${CONTEXT}\n\nA fuzzing agent claims this divergence between the reference binary and the port:\n` +
        `TITLE: ${f.title}\nARGV: ${JSON.stringify(f.argv)}\n` +
        `CLAIMED reference output: ${f.referenceOutput || '(not given)'}\n` +
        `CLAIMED port output: ${f.portOutput || '(not given)'}\n` +
        `EXPLANATION: ${f.explanation}\n\n` +
        `Your job is to REFUTE this. Run both programs yourself with exactly this argv and compare ` +
        `stdout, stderr and exit status byte for byte. Set real=false unless you personally ` +
        `reproduce a genuine disagreement. Note: differences confined to the ` +
        `"[PYI-<pid>:ERROR]" line are NOT real (that line contains a process id). Differences in ` +
        `argv that cannot survive execve (NUL bytes, lone surrogates) are NOT real. ` +
        `If argv is [] this is a structural claim - assess it by reading the code instead. ` +
        `Default to real=false when uncertain.`,
        { label: `verify:${area.key}`, phase: 'Verify', schema: VERDICT },
      ).then((v) => ({ area: area.key, finding: f, verdict: v })),
    ));
  },
)

phase('Review')

const reviewResults = await pipeline(
  REVIEW_LENSES,
  (lens) => agent(
    `${CONTEXT}\n\nYOUR ASSIGNMENT (id: ${lens.key}):\n${lens.prompt}\n\n` +
    `This is a code review, but every behavioural claim must be backed by a reproduction against ` +
    `the reference binary. Report only issues you can substantiate. Empty findings array is a fine ` +
    `answer - do NOT invent findings.`,
    { label: `review:${lens.key}`, phase: 'Review', schema: FINDINGS },
  ),
  (result, lens) => {
    if (!result || !result.findings || result.findings.length === 0) return [];
    return parallel(result.findings.map((f) => () =>
      agent(
        `${CONTEXT}\n\nA reviewer claims this defect in the port:\n` +
        `TITLE: ${f.title}\nFILE: ${f.file || '(unspecified)'}\nARGV: ${JSON.stringify(f.argv)}\n` +
        `EXPLANATION: ${f.explanation}\n\n` +
        `Your job is to REFUTE it. If argv is non-empty, run both programs and compare byte for ` +
        `byte. If argv is [], read the code and decide whether the claim is actually true AND ` +
        `actually matters for this program's observable behaviour or for the migration task's ` +
        `stated requirements. Set real=false unless you can substantiate it. Default to ` +
        `real=false when uncertain.`,
        { label: `verify:${lens.key}`, phase: 'Verify', schema: VERDICT },
      ).then((v) => ({ area: lens.key, finding: f, verdict: v })),
    ));
  },
)

phase('Synthesize')

const all = [...fuzzResults.flat(), ...reviewResults.flat()].filter(Boolean);
const confirmed = all.filter((entry) => entry.verdict && entry.verdict.real);
log(`${all.length} claims raised, ${confirmed.length} survived adversarial verification`);

return {
  confirmed: confirmed.map((entry) => ({
    area: entry.area,
    title: entry.finding.title,
    argv: entry.finding.argv,
    file: entry.finding.file,
    explanation: entry.finding.explanation,
    evidence: entry.verdict.evidence,
  })),
  refuted: all.filter((e) => !(e.verdict && e.verdict.real)).map((e) => `${e.area}: ${e.finding.title}`),
};
