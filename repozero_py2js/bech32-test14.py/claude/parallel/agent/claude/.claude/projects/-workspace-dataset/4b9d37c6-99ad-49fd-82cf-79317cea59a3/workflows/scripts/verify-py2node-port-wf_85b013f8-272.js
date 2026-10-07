export const meta = {
  name: 'verify-py2node-port',
  description: 'Exhaustively differential-test and review a Python->Node.js port of test14.py',
  phases: [
    { title: 'Fuzz', detail: 'parallel differential testers, one per behavioural category' },
    { title: 'Verify', detail: 'adversarially confirm each reported mismatch reproduces' },
    { title: 'Critic', detail: 'completeness critic: what modality was never exercised' },
  ],
}

const CONTEXT = `
You are differential-testing a Node.js port of a Python program.

  Reference (ground truth): /workspace/dataset/test14_executable   (PyInstaller-frozen Python)
  Port under test:          node /output/test14.mjs                (ESM, zero dependencies)
  Original Python source:   /workspace/dataset/test14.py            (read it first)

Harness (use it, do not reinvent):  /tmp/diff.sh <args...>
  - runs BOTH programs with the same argv in the CURRENT working directory
  - compares stdout, stderr and exit status byte for byte
  - normalises the PyInstaller "[PYI-<pid>:ERROR]" line (the pid legitimately differs)
  - prints "OK  args: ..." or "DIFF <stream>  args: ..." plus a diff, exit 1 on mismatch
  - honours env DIFF_TIMEOUT (default 10s)

CRITICAL RULES
  1. Do NOT edit, create or delete anything under /output. You only observe and report.
     You may write scratch files under /tmp/<your-own-unique-dir>/.
  2. The working directory MATTERS: Python's traceback prints source lines by looking up
     the relative path "test14.py" (and "bech32/__init__.py") in the CWD via linecache.
     From /workspace/dataset the tracebacks include source + caret lines; from elsewhere
     they do not. Always state which CWD you used.
  3. Some inputs make BOTH programs loop forever by design (any intermediate/target bit
     width of 0, e.g. --c 0 or --d 0). Both timing out identically is CORRECT, not a bug.
     Use a short DIFF_TIMEOUT (e.g. 5) for those and treat equal timeout kills as a pass.
  4. Run cases in batches from a shell loop and report ONLY genuine mismatches. Quote the
     exact reproducing command line and the exact diff.
  5. Never report a "finding" you have not actually reproduced with /tmp/diff.sh.
  6. Be efficient: batch 20-100 cases per bash call; do not run one case per tool call.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['casesRun', 'mismatches'],
  properties: {
    casesRun: { type: 'integer', description: 'how many distinct argv combinations were compared' },
    notes: { type: 'string', description: 'brief coverage summary, <=400 chars' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'cwd', 'stream', 'detail'],
        properties: {
          command: { type: 'string', description: 'exact /tmp/diff.sh command that reproduces' },
          cwd: { type: 'string' },
          stream: { type: 'string', description: 'stdout | stderr | exit | multiple' },
          detail: { type: 'string', description: 'ref vs port difference, concrete' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reproduces', 'realDivergence', 'explanation'],
  properties: {
    reproduces: { type: 'boolean', description: 'did the exact command reproduce the mismatch' },
    realDivergence: { type: 'boolean', description: 'true only if the port is genuinely wrong vs the reference' },
    explanation: { type: 'string' },
    suggestedFix: { type: 'string' },
  },
}

const CATEGORIES = [
  {
    key: 'valid-random',
    prompt: `Category: RANDOM VALID INPUTS (the happy path the sample tests exercise).
Generate at least 150 random cases: --a a comma separated list of 1..40 integers in range
[0, 2**b), with (b,c,d) drawn from realistic bech32-ish combos including 8/5/8, 5/8/5, 8/8/8,
3/11/3, 1/8/1, 4/7/4, 16/5/16, 7/13/7 and random triples in 1..24. Verify stdout matches exactly
(the Python list repr, e.g. "[20, 20, 26]", including the empty list "[]" case, which you can
reach with --b 0 and all-zero data). Run from /workspace/dataset.`,
  },
  {
    key: 'bitwidth-sweep',
    prompt: `Category: BIT WIDTH SWEEP, exhaustive over small widths.
For every (b,c,d) with b,c,d each in 1..10 (1000 combos) run a fixed small data set such as
"1,2,3" (values may exceed 2**b for small b, which must yield the None/TypeError path -- that is
part of the test). Report any mismatch. Then repeat with data "0" and with data "1" for widths
1..12. Use DIFF_TIMEOUT=5. Remember widths of 0 hang both programs by design; you may include a
handful of 0-width cases to confirm both are killed identically, but do not include hundreds.
Run from /workspace/dataset. Batch aggressively (a loop of 1000 cases is fine, print only DIFFs).`,
  },
  {
    key: 'bignum',
    prompt: `Category: ARBITRARY PRECISION. Python ints are unbounded; JS numbers are not.
Test values far beyond 2**53: e.g. 2**53-1, 2**53, 2**53+1, 2**64-1, 2**64, 10**30, 10**60,
2**200-1, and multi-element lists of such values, with matching large bit widths (--b 54..256,
--c in 5..64, --d equal to b). Also test that the printed decimal digits are exact (compare the
full stdout, not a prefix). Also test large widths with small values (e.g. --a 1 --b 200 --c 7
--d 200) and asymmetric round trips. At least 80 cases. Run from /workspace/dataset.`,
  },
  {
    key: 'int-grammar',
    prompt: `Category: int() LITERAL GRAMMAR for both --a elements and the --b/--c/--d values.
Python's int(str) accepts surrounding whitespace, a leading + or -, underscores between digits,
leading zeros, and any Unicode decimal digit; it rejects everything else. Test at least 100
literals across: " 7 ", "\\t5\\n", "+5", "-0", "007", "1_0", "1__0", "_1", "1_", "+_1", "0x10",
"1e3", "1.0", "", " ", "-", "+", ".5", "--5", "5-", Arabic-Indic "٣٤", Devanagari "५", fullwidth
"５", Bengali "৫", mixed-script "1٣", a 250 digit number, a 250 digit number with a trailing "x"
(the ValueError message is truncated by CPython -- verify the truncation matches exactly), a
literal containing a quote or a backslash or a control char (repr escaping), and an empty element
in the middle such as "1,,2". Apply them BOTH as --a elements and as --b values (argparse reports
type errors differently from a bare int() failure). Run from /workspace/dataset so tracebacks
include source lines.`,
  },
  {
    key: 'argparse-syntax',
    prompt: `Category: ARGPARSE SYNTAX. Test at least 90 argv shapes:
"--a=1,2" style, "--a 1,2" style, mixed; option order permutations; duplicate options (last wins);
prefix abbreviations ("--h", "--he", "--hel", "--help", "-h"); unknown options ("--e 3", "-x",
"--ab 1", "-hx", "--=5", "--a=1=2"); missing values ("--a" last, "--a --b 8 ...", "--a -x ...");
values that look like negative numbers ("--a -1", "--b -8", "--a -1.5", "--a -.5", "--a -1,-2",
"--a -", "--a '- 1'"); the "--" separator in every position (leading, middle, trailing, twice,
followed by extra tokens); extra positionals; no arguments at all; only "-h"; "-h" combined with a
bad --b value (which error wins); empty string values ("--a ''", "--b ''"); values containing
spaces, "=", tabs, newlines, and non-ASCII. Verify usage text, error text, and exit status.
Run from /workspace/dataset.`,
  },
  {
    key: 'help-and-width',
    prompt: `Category: HELP / USAGE RENDERING AND TERMINAL WIDTH.
argparse sizes its output from shutil.get_terminal_size(), i.e. $COLUMNS. Compare "--help" and a
usage-triggering error (e.g. only "--b 8") for COLUMNS in every value from 4 to 130 inclusive
(export COLUMNS=<n> before each invocation of /tmp/diff.sh so both programs see it), plus COLUMNS
unset, COLUMNS=0, COLUMNS=abc, COLUMNS=-5, COLUMNS=1, COLUMNS=' 40 '. Both the wrapped usage
lines and the wrapped help text of "-h, --help" must match byte for byte. That is ~260 runs;
batch them in one or two loops and print only DIFFs. Run from /workspace/dataset.`,
  },
  {
    key: 'traceback-cwd',
    prompt: `Category: TRACEBACK FIDELITY ACROSS WORKING DIRECTORIES.
Every failing input must produce a byte-identical traceback. The source lines come from linecache,
resolved relative to the CWD. Test each error kind -- int() ValueError (bad --a element), None
propagation TypeError (a value >= 2**b, e.g. --a 256 --b 8 --c 5 --d 8, and a negative value
--a -1), negative shift ValueError at each of the library's three raise sites (--c -1 -> line 88,
--b 0 --c 0 -> line 89, --b -1 -> line 91, --d -1) -- from each of these working directories:
  (a) /workspace/dataset  (the real test14.py is present)
  (b) /workspace          (no sources)
  (c) /output             (no sources)
  (d) a scratch dir containing a DIFFERENT 25+ line test14.py (unrelated content, no indentation)
  (e) a scratch dir containing a SHORT test14.py (5 lines, so line 19 does not exist)
  (f) a scratch dir containing test14.py whose lines 12-14 and 19 are heavily indented
  (g) a scratch dir containing a fake bech32/__init__.py with 95+ lines (with and without test14.py)
  (h) a scratch dir whose test14.py contains non-ASCII / multi-byte characters on lines 12-19
  (i) a scratch dir where test14.py is a DIRECTORY, and one where it is unreadable (chmod 000)
Create scratch dirs under /tmp/<unique>/. Report every byte difference, especially caret (^) line
placement and length, and whether the source line is shown at all.`,
  },
  {
    key: 'repr-escaping',
    prompt: `Category: ERROR MESSAGE STRING REPR. When a value cannot be parsed, both CPython's
int() and argparse quote it with repr(). Verify the escaping matches for at least 60 values passed
via --a (and some via --b): values containing a single quote, a double quote, both quotes, a
backslash, a newline (use $'\\n' in bash), a tab, a carriage return, an escape char, a NUL-free
control char like $'\\x01', DEL $'\\x7f', non-ASCII printable "é" and "日本", an emoji (astral, e.g.
"😀"), a combining mark, a zero-width joiner, U+00A0, U+2028, U+FEFF, a surrogate-ish byte
sequence like $'\\xc3\\x28' if the shell allows, and a 210 character invalid literal (message
truncation boundary: test lengths 198,199,200,201,202,250 of the repr). Run from /workspace/dataset.`,
  },
  {
    key: 'structural-review',
    prompt: `Category: STATIC / REQUIREMENTS REVIEW (no fuzzing needed, but you may run node).
Read every file under /output (test14.mjs and lib/**). Check, and report as a "mismatch" with
stream="review" any violation of:
  1. ESM only: import/export everywhere; NO require(), NO module.exports, all local imports carry
     the explicit .mjs suffix and resolve to files that exist.
  2. Zero external dependencies: nothing imported except local ./ files and node: builtins.
     No package.json dependency needed to run. Confirm "node /output/test14.mjs" works from any cwd.
  3. The code must NOT use or even mention Uint8Array or DataView anywhere (a hard prohibition).
     grep for both, plus TypedArray/Buffer/ArrayBuffer usage.
  4. No embedded Python, no shelling out to python, no invoking the reference executable at runtime.
  5. Library code is split hierarchically into multiple modules under lib/ and exposes its API via
     export; the entry point is /output/test14.mjs.
  6. Argument parsing matches the Python argparse spec in /workspace/dataset/test14.py: four
     required options --a (str), --b/--c/--d (int), no defaults, no positionals.
  7. Dead code / unreachable branches / copy-paste errors / logic that could throw a raw JS
     TypeError instead of the emulated Python error. Read carefully for off-by-one and for any
     place a JS number could silently replace a BigInt (precision loss).
Also actually RUN a couple of sanity commands (e.g. from / and from /tmp) to prove item 2.
Report concrete file:line for each issue.`,
  },
  {
    key: 'adversarial-logic',
    prompt: `Category: ADVERSARIAL LOGIC HUNT. Read /workspace/dataset/test14.py and then
/output/lib/bech32/convert.mjs, /output/lib/python/pyint.mjs, /output/lib/argparse/parser.mjs.
Your job is to invent inputs where the port's ALGORITHM should diverge from the reference, then
prove it with /tmp/diff.sh. Think about: the accumulator mask (max_acc) when frombits+tobits-1 is
0 or 1; frombits > tobits vs frombits < tobits; padding when the leftover bit count is exactly 0
vs nonzero; data values exactly 2**b-1 and exactly 2**b; a single 0 value with --b 0 (empty list
result); very long input lists (5000+ elements) where an O(n^2) or accumulator overflow bug would
show; lists with 10000 elements to compare performance and output; widths where tobits > frombits
by a large factor (e.g. --b 1 --c 64 --d 1); the short-circuit in "value < 0 or (value >> frombits)"
when the value is negative AND frombits is negative (which error, if any, wins); and the exact
ordering of the library's internal errors versus the None check (e.g. --a 256 --b 8 --c 5 --d -1:
does the negative shift at line 88 beat the TypeError at line 90?). At least 60 targeted cases.
Run from /workspace/dataset.`,
  },
]

phase('Fuzz')
log(`differential-testing ${CATEGORIES.length} categories against the frozen Python reference`)

const results = await pipeline(
  CATEGORIES,
  (category) =>
    agent(`${CONTEXT}\n\n${category.prompt}\n\nReturn structured findings.`, {
      label: `fuzz:${category.key}`,
      phase: 'Fuzz',
      schema: FINDINGS_SCHEMA,
    }),
  (findings, category) => {
    if (!findings || findings.mismatches.length === 0) return { category: category.key, findings, verdicts: [] }
    return parallel(
      findings.mismatches.slice(0, 12).map((mismatch) => () =>
        agent(
          `${CONTEXT}\n\nAnother tester reported this mismatch between the reference and the port:\n` +
            `  command: ${mismatch.command}\n  cwd: ${mismatch.cwd}\n  stream: ${mismatch.stream}\n` +
            `  claim: ${mismatch.detail}\n\n` +
            `Adversarially verify it. cd to the stated cwd, run the exact command, and decide:\n` +
            `(1) does the mismatch actually reproduce? (2) is the PORT genuinely wrong, or is the\n` +
            `claim bogus (e.g. the tester compared against its own expectation instead of the\n` +
            `reference, or the difference is only the PyInstaller pid, or both programs merely\n` +
            `timed out on a by-design infinite loop)? Default to realDivergence=false unless you\n` +
            `personally saw the reference and the port disagree. If real, say precisely what the\n` +
            `port should output instead and which file should change.`,
          { label: `verify:${category.key}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((verdict) => ({ mismatch, verdict })),
      ),
    ).then((verdicts) => ({ category: category.key, findings, verdicts: verdicts.filter(Boolean) }))
  },
)

const clean = results.filter(Boolean)
const confirmed = clean.flatMap((entry) =>
  entry.verdicts.filter((item) => item.verdict?.reproduces && item.verdict?.realDivergence),
)
const totalCases = clean.reduce((sum, entry) => sum + (entry.findings?.casesRun ?? 0), 0)
log(`${totalCases} differential cases run; ${confirmed.length} confirmed divergences`)

phase('Critic')
const critic = await agent(
  `${CONTEXT}\n\nA fleet of testers has just finished. Coverage summaries:\n` +
    clean.map((entry) => `- ${entry.category}: ${entry.findings?.casesRun ?? 0} cases. ${entry.findings?.notes ?? ''}`).join('\n') +
    `\n\nConfirmed divergences: ${confirmed.length === 0 ? 'none' : JSON.stringify(confirmed.map((item) => item.mismatch.command))}\n\n` +
    `You are the completeness critic. What observable behaviour of the reference was NEVER ` +
    `exercised? Consider: stdin, environment variables other than COLUMNS, locale/LANG, argv[0] ` +
    `effects, extremely large argv, non-UTF8 bytes in argv, output to a pipe vs a tty, SIGPIPE ` +
    `(e.g. piping stdout into "head -0"), stdout redirected to a closed fd or /dev/full, exit ` +
    `codes under signals, and anything about the Python list repr or the argparse text you think ` +
    `nobody checked. Pick the 5 most likely to hide a real defect, ACTUALLY TEST THEM with ` +
    `/tmp/diff.sh (or by hand where the harness cannot express it, e.g. SIGPIPE and /dev/full), ` +
    `and report only what genuinely differs. Same rules: never edit /output.`,
  { label: 'completeness-critic', phase: 'Critic', schema: FINDINGS_SCHEMA },
)

return {
  totalCases,
  perCategory: clean.map((entry) => ({
    category: entry.category,
    casesRun: entry.findings?.casesRun ?? 0,
    reported: entry.findings?.mismatches.length ?? 0,
    notes: entry.findings?.notes ?? '',
  })),
  confirmedDivergences: confirmed.map((item) => ({
    command: item.mismatch.command,
    cwd: item.mismatch.cwd,
    stream: item.mismatch.stream,
    detail: item.mismatch.detail,
    explanation: item.verdict.explanation,
    suggestedFix: item.verdict.suggestedFix ?? '',
  })),
  refutedCount: clean.reduce(
    (sum, entry) => sum + entry.verdicts.filter((item) => !(item.verdict?.reproduces && item.verdict?.realDivergence)).length,
    0,
  ),
  criticFindings: critic?.mismatches ?? [],
  criticNotes: critic?.notes ?? '',
}
