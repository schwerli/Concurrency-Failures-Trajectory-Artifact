export const meta = {
  name: 'verify-base58-port',
  description: 'Differentially fuzz and adversarially audit the Node port of test14.py against the reference binary',
  phases: [
    { title: 'Fuzz', detail: 'category-specific differential test vectors vs the reference binary' },
    { title: 'Audit', detail: 'lens-specific source review of /output' },
    { title: 'Verify', detail: 'adversarially confirm or refute each reported issue' },
    { title: 'Synthesize', detail: 'rank surviving defects with repro commands' },
  ],
}

const CONTEXT = `
# Target under verification

A Node.js ESM port of a Python script lives in /output:
  /output/test14.mjs                 entry point
  /output/lib/*.mjs                  python-semantics helpers (pyint, pyrepr, pystr, pyunicode, pybytes, pyprint, pytraceback, pyerrors)
  /output/lib/base58/*.mjs           base58 port (alphabet, scrub, int_codec, index)
  /output/lib/argparse/*.mjs         argparse port (parser, formatter, types, exit, index)

The original Python source is /workspace/dataset/test14.py. In essence:
  parser.add_argument('--a', type=int, required=True)
  parser.add_argument('--b', type=int, required=True)
  parser.add_argument('--c', type=str, required=True)
  encoded_int1 = base58.b58encode_int(args.a)
  encoded_int2 = base58.b58encode_int(args.b)
  decoded_int  = base58.b58decode_int(args.c)
  print(encoded_int1); print(encoded_int2); print(decoded_int)

The GROUND TRUTH is the precompiled reference binary:
  /workspace/dataset/test14_executable --a <int> --b <int> --c <str>
Run the binary directly. NEVER use the 'python' command. ALWAYS wrap invocations
in 'timeout 10' (some inputs legitimately never terminate -- see below).

Run the port as: node /output/test14.mjs <args...>

# Differential harness (already written and validated -- prefer it)

  /tmp/dt/diff1.sh [--stderr] -- <args...>

It runs both programs with timeouts, compares stdout and exit code (and stderr
with --stderr, filtering the PyInstaller '[PYI-...' bootloader line), then prints
PASS or a FAIL block with both sides quoted via printf %q. Exit 0 = match.
Read it before use. You may write your own additional drivers under /tmp/<your-own-unique-dir>/.

# Behaviour already established by black-box probing (treat as known-correct)

base58:
- b58encode_int(0) -> b'1'  (the library's default_one behaviour, not positional arithmetic)
- alphabet: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz  (no 0 O I l)
- b58decode_int right-strips its argument FIRST (trailing whitespace is padding),
  THEN ascii-encodes it, THEN folds digits. So '5Q ' -> 255, '' -> 0, '   ' -> 0.
- rstrip's whitespace set is Python str.isspace() = Unicode White_Space PLUS U+001C..U+001F.
- leading/interior whitespace is NOT stripped -> ValueError: Invalid character ' '
- any character > U+007F -> UnicodeEncodeError, exit 1
- invalid ascii base58 char -> ValueError: Invalid character 'X', exit 1
- on ANY decode error stdout is completely EMPTY (nothing prints until all three values exist)

int() conversion for --a/--b:
- accepts Unicode decimal digits of any script ('١٠', '１０' -> 10), leading/trailing
  Unicode White_Space, a leading + or -, and single underscores BETWEEN digits
- REJECTS U+001C..U+001F and U+FEFF as leading whitespace (they are not White_Space)
- rejects '0x10', '10.5', '1__0', '_10', '10_', '', '²'
- argparse then reports: argument --a: invalid int value: <repr of the ORIGINAL text>, exit 2

argparse:
- missing required options are reported BEFORE unrecognized ones (so '-a 5 -b 5 -c A',
  which uses undefined short flags, complains that --a/--b/--c are missing)
- -h/--help prints help to STDOUT and exits 0, even when required options are absent
- '--he' abbreviates to --help
- '--a=5' works; '--c -A' -> 'argument --c: expected one argument'; '--c=-A' assigns '-A'
- a trailing bare '--' becomes 'unrecognized arguments: --'
- later occurrences win: '--a 5 --a 7' uses 7
- error exit status is 2; usage line goes to stderr

Arbitrary precision is required: --a values of hundreds of digits must encode exactly.

# KNOWN AND ACCEPTED deviations -- DO NOT report these, they are settled

1. Program name in usage/help/error text. The reference binary says 'test14_executable';
   the port says 'test14.mjs', derived from basename(argv[1]) exactly as Python derives
   prog from basename(sys.argv[0]). This is the intended faithful behaviour.
2. The '[PYI-<pid>:ERROR] Failed to execute script' bootloader line. It is a PyInstaller
   launcher artifact with a per-run pid and is intentionally not reproduced.
3. Negative --a/--b never terminate in EITHER program. The library loops 'while i:' with
   floored divmod, and divmod(-1,58) == (-1,57) forever. The port reproduces the same
   non-termination on purpose. Only report a defect here if the port terminates quickly
   with output or a Node error while the reference binary hangs, or vice versa -- i.e. a
   genuine behavioural divergence, not the shared hang itself.
4. Bytes that are invalid UTF-8 in argv. Python applies surrogateescape; Node substitutes
   U+FFFD. Both still fail with exit 1. Platform-level, unfixable in pure JS.

# Hard requirements the port must satisfy (violations ARE defects)

- ESM only: 'import'/'export'. Any require() or module.exports is a violation.
- Every generated file uses the .mjs suffix, and every relative import includes it.
- ZERO external/npm dependencies. Only node: builtins and local ./ imports.
- The code must NOT use or even mention Uint8Array or Buffer anywhere. Manual base58
  logic on strings/BigInt/plain arrays only. Grep for these identifiers.
  (TextEncoder/atob/btoa-style byte APIs should also be absent.)
- No embedded or shelled-out Python.
`

const FUZZ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'vectorsRun', 'mismatches'],
  properties: {
    category: { type: 'string' },
    vectorsRun: { type: 'integer' },
    notes: { type: 'string', description: 'coverage summary; what you deliberately did not cover' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['repro', 'referenceBehaviour', 'portBehaviour', 'stream'],
        properties: {
          repro: { type: 'string', description: 'exact copy-pasteable shell command that shows the divergence' },
          stream: { type: 'string', description: 'stdout | stderr | exitcode | hang' },
          referenceBehaviour: { type: 'string' },
          portBehaviour: { type: 'string' },
        },
      },
    },
  },
}

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'findings'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'summary', 'failureScenario', 'severity'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', description: 'blocker | major | minor' },
          summary: { type: 'string' },
          failureScenario: { type: 'string', description: 'concrete input -> wrong output, ideally a shell command' },
          suggestedFix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reasoning'],
  properties: {
    real: { type: 'boolean' },
    reasoning: { type: 'string' },
    reproEvidence: { type: 'string', description: 'actual observed output from running both programs' },
    correctedSummary: { type: 'string' },
  },
}

// ---------------------------------------------------------------- Fuzz phase

const FUZZ_CATEGORIES = [
  {
    key: 'happy-path-roundtrip',
    prompt: `Exhaustively cross-check ORDINARY valid inputs. Cover: 0 and 1; every single-digit
result; all 58 single-character decode inputs (each alphabet character alone); every
boundary at powers of 58 (57,58,59,3363,3364,195111,195112, 58^4 +/-1, 58^5 +/-1);
values around 2**31, 2**32, 2**53 (the JS exact-integer limit), 2**53+1, 2**63, 2**64,
2**128, 2**256; and numbers with 40, 80, 200 and 600 decimal digits. Also verify
encode/decode round-trips: for many integers n, check that decoding the encoding of n
returns n in BOTH programs. Run at least 200 distinct vectors. Loop in bash over lists.`,
  },
  {
    key: 'decode-string-shapes',
    prompt: `Attack the --c decode path with valid-alphabet strings. Cover: empty string; every
leading-'1' pattern ('1','11','111z','1zzz'); very long inputs (100, 500, 2000 alphabet
characters) to confirm big-integer accuracy; strings mixing case; the maximum-value
strings 'z', 'zz', 'zzzz...'; and inputs whose value exceeds 2**53 to catch float
precision loss. Also confirm trailing-whitespace stripping for EVERY whitespace character
individually: space, tab, newline, CR, vertical tab, form feed, U+001C, U+001D, U+001E,
U+001F, U+0085, U+00A0, U+1680, U+2000, U+2028, U+2029, U+202F, U+205F, U+3000, and
confirm U+FEFF is NOT stripped. Use bash $'\\uXXXX' or printf to build these. Run at
least 120 vectors.`,
  },
  {
    key: 'decode-invalid-chars',
    prompt: `Attack invalid --c inputs and verify the exit code AND the stderr text with
/tmp/dt/diff1.sh --stderr. Cover: each excluded confusable ('0','O','I','l'); punctuation
and symbols ('-','+','/','=','.','_','#','$','!','~','*','%','^','&','(',')','[',']','{','}',
'<','>','?','|',';',':',',',backslash, single quote, double quote, backtick); leading and
interior whitespace; ASCII control characters including a LEADING vertical tab / form feed /
U+001C (these are whitespace but only trailing whitespace is stripped, so they must error
with an ESCAPED repr like '\\x0b'); a single quote alone (Python repr flips to double
quotes there); and non-ASCII: U+0080, U+00A1, U+0101, U+20AC, U+FEFF, an astral emoji
(U+1F600), and runs of 2 and 3 consecutive non-ASCII characters (the UnicodeEncodeError
message switches to 'characters' and 'position i-j'). Also mixes like 'aZ' + non-ascii at
positions 0, 1 and last. IMPORTANT: run these with cwd = /workspace/dataset (where
test14.py exists, so the reference prints the source line) AND with cwd = /tmp (where it
does not). Both must match. Run at least 80 vectors.`,
  },
  {
    key: 'int-parsing',
    prompt: `Attack --a and --b int conversion, checking stdout, exit code and stderr text.
Cover: plain, signed ('+5','-0'), leading zeros; underscores in every legal and illegal
position; surrounding whitespace using EACH Unicode White_Space character individually
(U+0009..U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000..U+200A, U+2028, U+2029, U+202F,
U+205F, U+3000) which must be ACCEPTED, versus U+001C..U+001F and U+FEFF which must be
REJECTED with an escaped repr in the message; Unicode decimal digits from many scripts
(Arabic-Indic U+0660, Extended Arabic-Indic U+06F0, Devanagari U+0966, Bengali U+09E6,
Thai U+0E50, Fullwidth U+FF10, and the mathematical digit blocks U+1D7CE, U+1D7D8,
U+1D7E2, U+1D7EC, U+1D7F6 which are DIRECTLY ADJACENT to each other and are a classic
source of off-by-ten errors); digits mixed across scripts in one number; non-decimal
numerics that must be REJECTED ('²','½','Ⅴ','U+00B9','U+2070'); and junk ('0x10','1e5',
'10.5','abc','','+','-','--','inf','nan','NaN','1,000',' '). Verify the reported repr is
of the ORIGINAL text. Run at least 120 vectors.`,
  },
  {
    key: 'argparse-structure',
    prompt: `Attack argument parsing structure, checking stdout, stderr and exit code with
/tmp/dt/diff1.sh --stderr. Cover: no args; each subset of missing required options (all 7
non-empty subsets) and confirm the missing list order; '--a=5' style for each option and
combinations of '=' and space forms; repeated options; option order permutations;
'--help' and '-h' alone and combined with valid/invalid/missing options and placed first,
middle and last; '--he','--hel','--h' abbreviations; unknown options ('--extra 1','--extra',
'-x','-a','-abc','--=5','--'); extra positionals (one and several, before/among/after
options); a bare '-'; '--' alone, '--' with tokens after it, '--' before options;
values that look like options ('--c -A','--c -5','--c=-A','--a -5','--a -1.5','--b -0');
empty-string values ('--a ""','--c ""'); and a value containing a space ('--c "a b"').
Report the exact divergence for each. Run at least 90 vectors.`,
  },
  {
    key: 'output-format-and-exit',
    prompt: `Focus narrowly on byte-exact output framing and process exit behaviour.
Verify: the bytes repr prefix and quoting ("b'...'"); that exactly three lines are printed
on success and each ends with a newline; that a trailing newline is present on the final
line (compare 'od -c' or 'xxd' of both programs' full stdout for several inputs, not just
the shell-captured string, since command substitution strips trailing newlines); that NO
output at all precedes a decode error; that exit codes are 0 / 1 / 2 in the right cases;
that stdout and stderr go to the correct streams (redirect them separately: 1>f1 2>f2 and
diff each); and that output is not truncated when stdout is a pipe closed early or piped
to 'head -1'. Also confirm success output is identical when stdout is a file vs a pipe vs
a tty-less pipe. Run at least 40 vectors and use byte-level comparison throughout.`,
  },
  {
    key: 'precision-stress',
    prompt: `Hunt specifically for numeric precision and BigInt/Number coercion bugs. Generate
many large pseudo-random integers (use bash arithmetic, /dev/urandom via od, or fixed long
literals -- be deterministic where you can) with 15 to 400 decimal digits, encode them via
both programs, and diff. Then do the same for decode with long base58 strings. Pay special
attention to values just above 2**53 where a stray Number() conversion would silently lose
precision, to values that are exact multiples and near-multiples of 58, and to values whose
base58 representation has long runs of the same character or of the alphabet's first
character. Verify the round-trip identity decode(encode(n)) == n for at least 150 large n
in both programs. Run at least 150 vectors.`,
  },
]

phase('Fuzz')

// Each category's mismatches flow straight into verification without waiting for
// the other categories, so a slow fuzzer never blocks a fast one's follow-up.
const fuzzed = await pipeline(
  FUZZ_CATEGORIES,
  (cat) =>
    agent(
      `${CONTEXT}

You are a differential fuzzer. Your category: ${cat.key}

${cat.prompt}

Method: write bash loops that invoke /tmp/dt/diff1.sh for each vector (read that script
first). Work in your own scratch directory under /tmp. Report ONLY genuine divergences
between the reference binary and the port -- every mismatch must include a
copy-pasteable repro command that you actually ran and observed. Do NOT report anything
listed under "KNOWN AND ACCEPTED deviations". Do NOT edit any file under /output.
Report the true number of vectors you ran, and in 'notes' state honestly what you could
not cover.`,
      { label: `fuzz:${cat.key}`, phase: 'Fuzz', schema: FUZZ_SCHEMA },
    ),
  (result, cat) => {
    if (!result || !result.mismatches || result.mismatches.length === 0) return []
    return parallel(
      result.mismatches.slice(0, 12).map((m) => () =>
        agent(
          `${CONTEXT}

A differential fuzzer working on "${cat.key}" claims this divergence between the
reference binary and the Node port:

  repro:     ${m.repro}
  stream:    ${m.stream}
  reference: ${m.referenceBehaviour}
  port:      ${m.portBehaviour}

Your job is to REFUTE it. Actually run both programs yourself, several times and with
byte-level comparison (od -c) where output framing matters. Consider that the claim may
be an artifact of the fuzzer's own harness: shell quoting, command substitution stripping
trailing newlines, a missing timeout, locale, or the working directory (the reference
binary prints a traceback source line only when test14.py is readable from cwd).
Also check it is not one of the KNOWN AND ACCEPTED deviations.

Set real=false unless you personally reproduced a true divergence. Default to
real=false when uncertain. If it is real but described inaccurately, set real=true and
give a corrected summary. Include the actual observed output as reproEvidence.
Do NOT edit any file under /output.`,
          { label: `verify:${cat.key}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((v) => ({ source: cat.key, claim: m, verdict: v })),
      ),
    )
  },
)

// -------------------------------------------------------------- Audit phase

const AUDIT_LENSES = [
  {
    key: 'requirements-compliance',
    prompt: `Verify the hard requirements mechanically. Enumerate every file under /output
(find /output -type f) and check: only .mjs files; no require( or module.exports anywhere;
every import specifier is either a node: builtin or a relative ./ or ../ path WITH an
explicit .mjs suffix; no npm/bare-module import; no package.json dependency reliance; no
Python embedded or invoked. Then grep -rniE for 'uint8array|buffer|textencoder|textdecoder|
atob|btoa|readuint|writeuint|\\bbytes\\b' and confirm the prohibited byte-buffer APIs
Uint8Array and Buffer appear NOWHERE -- not in code, not in comments, not in strings.
Confirm every module actually resolves by running: node --input-type=module -e
"import('/output/lib/...')" style checks or simply node /output/test14.mjs --help.
Check that files live in a genuinely hierarchical structure with functionality split
across modules exposing named exports, and that no module is dead/unreferenced.
Report each violation with file and line.`,
  },
  {
    key: 'python-int-semantics',
    prompt: `Review /output/lib/pyint.mjs, /output/lib/pyunicode.mjs and /output/lib/pystr.mjs
against CPython's int(str) algorithm. Scrutinise: the White_Space vs str.isspace()
distinction and whether each is applied in the right place; the underscore grammar regex
for false accepts and false rejects; sign handling and whether '+'/'-' alone is rejected;
the decimal-digit-value routine, especially for adjacent Nd decades such as
U+1D7CE..U+1D7FF and for lone surrogates or astral code points; whether the caching is
sound; whether code-point vs UTF-16-unit indexing is used consistently (astral characters
and lone surrogates must not shift reported positions); and whether BigInt conversion can
ever throw or lose precision. Construct concrete failing inputs and TEST them against the
reference binary to confirm before reporting.`,
  },
  {
    key: 'base58-semantics',
    prompt: `Review /output/lib/base58/*.mjs against the library behaviour described above.
Scrutinise: the zero/default_one special case; the floored-divmod helper's correctness for
every sign combination; digit accumulation order and whether the emitted string can ever be
reversed or off by one; the rstrip-then-ascii-encode ORDER and whether swapping it would
change any observable result; the digit-map lookup and whether a falsy-zero bug could make
the character '1' (digit value 0) be treated as invalid; the UnicodeEncodeError run
detection and its position arithmetic for astral characters; and whether decode can return
a Number rather than a BigInt anywhere. Build concrete failing inputs and TEST them against
the reference binary before reporting.`,
  },
  {
    key: 'argparse-semantics',
    prompt: `Review /output/lib/argparse/*.mjs against CPython argparse. Scrutinise: the order
of the required-options check versus the unrecognized-arguments check; the exact wording and
punctuation of every error message; the missing-required list's ordering and which option
string it names; help output column arithmetic (action_max_length, help_position, the
no-help-text case) and whether it still matches if options were added or renamed; the
option-token classification order (exact match, single char, '=' split, abbreviation,
negative-number matcher, embedded space, unknown); abbreviation ambiguity handling; the
'--' handling; explicit-arg handling for short options; whether 'expected one argument' vs
'invalid int value' fire in the right cases; and whether error() correctly stops all
further processing rather than falling through (note that error() throws -- check every
call site, especially inside convert(), for code that would keep running or return
undefined). Test concrete cases against the reference binary before reporting.`,
  },
  {
    key: 'repr-and-output',
    prompt: `Review /output/lib/pyrepr.mjs, pybytes.mjs, pyprint.mjs and pytraceback.mjs.
Scrutinise: Python's repr quote-selection rule and its escaping order (backslash first,
then the active quote, then \\n \\r \\t, then non-printables); the printability predicate
versus Python's str.isprintable (especially U+0020, U+00A0, U+2028, unassigned code points,
lone surrogates); the \\xXX vs \\uXXXX vs \\UXXXXXXXX threshold; bytes repr only printing
0x20..0x7E literally; and whether printing uses process.stdout.write with exactly one
trailing newline. Check for stream-flush hazards: process.exitCode is used instead of
process.exit -- confirm nothing anywhere calls process.exit in a way that could truncate a
piped write, and confirm output is complete when stdout is a pipe. Verify the traceback
module's linecache emulation cannot crash on a missing, empty, short, or unreadable
test14.py, and that reading it can never be influenced into throwing an unhandled error.
Test concrete cases against the reference binary before reporting.`,
  },
  {
    key: 'robustness-and-crash',
    prompt: `Hunt for ways to make the PORT crash with a Node-level error (TypeError,
RangeError, unhandled rejection, stack overflow, assertion) or emit a JS stack trace where
the reference binary behaves cleanly. Try: absurdly long argument values (100k+ characters,
via bash brace expansion or printf) for both --a and --c; deeply pathological Unicode (lone
surrogates via $'\\xed\\xa0\\x80', unpaired UTF-16 halves, U+0000 NUL bytes in arguments,
combining marks); Math.max applied to an empty array in the help formatter if options were
absent; argv[1] being undefined (run via 'node --input-type=module' with stdin, or from a
symlink, or check the ?? fallback); and running from a directory that is unreadable or where
test14.py is a directory / a dangling symlink / a huge binary file rather than the expected
source. Also check the process exits 0/1/2 and never with a Node default 1-from-throw when
the reference exits 0. Any unhandled JS exception surfacing to the user is a defect. Report
what you actually reproduced.`,
  },
]

const audited = await pipeline(
  AUDIT_LENSES,
  (lens) =>
    agent(
      `${CONTEXT}

You are a code auditor. Your lens: ${lens.key}

${lens.prompt}

Read the source under /output carefully. You may run both programs freely to check
hypotheses (always with 'timeout 10'). Work in your own scratch directory under /tmp.
Do NOT edit any file under /output -- report findings only.
Only report a finding if you can name a concrete input or a concrete requirement that is
violated. Prefer few high-confidence findings over many speculative ones. Do NOT report
anything listed under "KNOWN AND ACCEPTED deviations".`,
      { label: `audit:${lens.key}`, phase: 'Audit', schema: AUDIT_SCHEMA },
    ),
  (result, lens) => {
    if (!result || !result.findings || result.findings.length === 0) return []
    return parallel(
      result.findings.slice(0, 12).map((f) => () =>
        agent(
          `${CONTEXT}

An auditor working under the "${lens.key}" lens reported this finding about the port:

  file:     ${f.file}:${f.line}
  severity: ${f.severity}
  summary:  ${f.summary}
  scenario: ${f.failureScenario}

Your job is to REFUTE it. Read the actual code at that location and, wherever the claim is
behavioural, construct the input and run BOTH the reference binary and the port to see
whether the divergence or crash really occurs. Many plausible-sounding findings are wrong
because the surrounding code already handles the case, because the input cannot reach that
code path through the CLI, or because the claim is one of the KNOWN AND ACCEPTED deviations.
A finding is only real if it produces an observably wrong result, a crash, or a violation of
a stated hard requirement.

Set real=false unless you personally confirmed it. Default to real=false when uncertain.
Include your actual observed evidence. Do NOT edit any file under /output.`,
          { label: `verify:${lens.key}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((v) => ({ source: lens.key, claim: f, verdict: v })),
      ),
    )
  },
)

// ---------------------------------------------------------- Synthesize phase

phase('Synthesize')

const fuzzMismatches = fuzzed.flat().filter(Boolean).filter((r) => r.verdict && r.verdict.real)
const auditFindings = audited.flat().filter(Boolean).filter((r) => r.verdict && r.verdict.real)

const coverage = FUZZ_CATEGORIES.map((c) => c.key)
log(`confirmed: ${fuzzMismatches.length} differential, ${auditFindings.length} audit`)

if (fuzzMismatches.length === 0 && auditFindings.length === 0) {
  return {
    verdict: 'clean',
    confirmed: [],
    coverage,
    note: 'All fuzz categories and audit lenses reported either nothing or only claims that adversarial verification refuted.',
  }
}

const synthesis = await agent(
  `${CONTEXT}

Adversarial verification confirmed the following defects in the port. Consolidate them into
a single ranked action list for the engineer who will fix them.

Confirmed differential mismatches:
${JSON.stringify(fuzzMismatches, null, 2)}

Confirmed audit findings:
${JSON.stringify(auditFindings, null, 2)}

Merge duplicates that share a root cause. Rank by severity: byte-level stdout or exit-code
divergence on plausible input first, then hard-requirement violations, then stderr-only or
exotic-input issues. For each, give: the file and line, the root cause in one sentence, a
minimal repro command, and a specific code-level fix. Be concise and concrete. Verify each
repro command one final time before including it.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' },
)

return { verdict: 'defects-found', confirmed: { fuzzMismatches, auditFindings }, coverage, synthesis }
