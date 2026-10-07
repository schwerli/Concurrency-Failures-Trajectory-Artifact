export const meta = {
  name: 'probe-schedule-test4',
  description: 'Black-box probe of test4_executable across argparse and schedule.at() dimensions',
  phases: [
    { title: 'Probe', detail: 'parallel probing of distinct behavior dimensions' },
    { title: 'Critic', detail: 'find uncovered behavior gaps' },
  ],
}

const EXE = '/workspace/dataset/test4_executable'

const SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'exact argv used, shell-quoted' },
          stdout: { type: 'string' },
          stderrSummary: { type: 'string' },
          exitCode: { type: 'integer' },
          rule: { type: 'string', description: 'the general rule this demonstrates' },
        },
        required: ['input', 'stdout', 'exitCode', 'rule'],
      },
    },
    rules: { type: 'array', items: { type: 'string' }, description: 'Precise implementable rules inferred' },
    surprises: { type: 'array', items: { type: 'string' }, description: 'Behaviors that would trip up a naive JS port' },
  },
  required: ['dimension', 'findings', 'rules', 'surprises'],
}

const COMMON = `
You are black-box probing a PyInstaller-compiled Python program at ${EXE}.
Its Python source is:

    import argparse, schedule
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    parser.add_argument('--b', type=str, required=True)
    parser.add_argument('--c', type=str, required=True)
    args = parser.parse_args()
    job = schedule.every().monday.at(args.a)
    print(job)

Run it MANY times with the Bash tool to characterize behavior. Capture stdout, stderr and exit code
SEPARATELY and EXACTLY (use redirection to files, and 'od -c' or 'cat -A' when whitespace matters).
Do NOT use the 'python' command. Never guess: every rule you report must be backed by an actual run.
Already-established baseline facts (do not re-verify, build on them):
- success prints exactly: Job(interval=1, unit=weeks, do=None, args=(), kwargs={})   (exit 0)
- invalid time format -> stderr Python traceback, "schedule.ScheduleValueError: Invalid time format for a daily job (valid format is HH:MM(:SS)?)" at schedule/__init__.py line 514, exit 1
- hour out of 0..23 -> "schedule.ScheduleValueError: Invalid number of hours ({} is not between 0 and 23)" (LITERAL braces, unformatted) at line 547, exit 1
- the regex behaves like Python's ^[0-2]\\d:[0-5]\\d(:[0-5]\\d)?$ where \\d matches ANY Unicode decimal digit and $ tolerates one trailing newline
Report ONLY your assigned dimension. Be exhaustive and adversarial.
`

phase('Probe')

const DIMENSIONS = [
  {
    key: 'at-regex',
    prompt: `${COMMON}
YOUR DIMENSION: the exact accept/reject boundary of the time string, and which of the two error
messages is produced. Probe systematically:
- every hour first-digit 0-9 and non-ASCII; boundary hours 00,09,19,20,23,24,25,29; 2-digit vs 1-digit vs 3-digit
- minute/second boundaries 00,59,60,99; 2 vs 3 colon-separated components; 1 and 4+ components
- Unicode decimal digits (Arabic-Indic U+0660-0669, fullwidth U+FF10-FF19, Devanagari U+0966-096F,
  superscripts, Roman numerals, U+00B2) in EACH digit position independently. Which positions accept them?
  Does the resulting int() value use their numeric value (e.g. does 2<U+0665>:00 -> hour 25 -> hours error)?
- trailing/leading whitespace: \\n, \\r, \\t, space, form feed, vertical tab, U+2028, and \\n at various counts/positions
- empty string, only colons, "::", negative like -1:00, "+1:00", digits with embedded NUL if possible
Report the precise decision procedure that reproduces ALL observed results.`,
  },
  {
    key: 'at-hours-error',
    prompt: `${COMMON}
YOUR DIMENSION: the SECOND error path only (hour numerically out of range) and any THIRD error path.
- Which inputs reach the hours error rather than the format error? Enumerate the full set of hour
  strings that pass the format regex but fail the range check (20-29 range, plus Unicode-digit combos).
- Is the message byte-identical every time, including the literal "{}"? Confirm with od -c on stderr.
- Capture the COMPLETE stderr for one hours-error run and one format-error run, byte for byte
  (od -c or cat -A). Note the exact traceback lines, indentation, the caret "^" line, the file names
  and line numbers, and the final "[PYI-<n>:ERROR] Failed to execute script 'test4' due to unhandled
  exception!" line. Determine whether <n> is stable across runs or varies (run it several times).
- Are there any inputs that produce a DIFFERENT exception (TypeError, ValueError from int(),
  IndexError from unpacking, or a minutes/seconds range error)? Try hard to find a third error path.`,
  },
  {
    key: 'argparse-errors',
    prompt: `${COMMON}
YOUR DIMENSION: argparse error paths and their precedence. Baseline already known: missing-required ->
exit 2 with "usage: ..." then "test4_executable: error: the following arguments are required: --a, --b, --c";
unrecognized -> "unrecognized arguments: ..."; missing value -> "argument --a: expected one argument".
Probe precedence and formatting:
- ordering of names in the required list (declaration order vs command-line order) with various subsets
- interaction: both an unrecognized arg AND a missing required arg -> which error wins?
- unrecognized formatting with multiple extras, with values, with quoted/space-containing extras
- prefix abbreviation: --a/--b/--c are full names; test --he, --hel, --h, and any ambiguous prefixes
- "--" separator semantics, repeated "--", "-" alone, "-x", "--=", "--a=" (empty value), "--a=" with =inside value
- repeated options (last wins?), option value that starts with "-" or "--", negative numbers like -5, -5.5, -x5
- exit codes for each path. Report the exact stderr text (byte-exact) for each distinct case.`,
  },
  {
    key: 'argparse-help',
    prompt: `${COMMON}
YOUR DIMENSION: the --help / -h output and usage-line formatting, byte-exactly.
- Capture 'test4_executable --help' stdout with od -c / cat -A. Note the blank line, the "options:"
  header, exact indentation, and the exact column where "show this help message and exit" starts.
- Does -h short-circuit before the required-args check? Does it work when combined with other args,
  after "--", or with invalid values?
- Does the output depend on the COLUMNS environment variable or terminal width? Test COLUMNS=20,
  COLUMNS=30, COLUMNS=40, COLUMNS=200, and unset, both for --help and for the usage line printed on
  error. Report exactly how wrapping/indentation changes so the wrapping algorithm can be reproduced.
- Does the program name in usage/error come from argv[0]? Test by invoking through a symlink or a
  copy with a different filename (e.g. cp it to /tmp/zz.bin and run that), and via a relative path,
  and via a path with a directory component. Report the exact rule for deriving the displayed prog name.
- Is stdout used for --help and stderr for errors? Confirm which stream each goes to.`,
  },
  {
    key: 'io-and-env',
    prompt: `${COMMON}
YOUR DIMENSION: process-level and encoding behavior.
- Exact trailing bytes of successful stdout: is there exactly one trailing "\\n"? Use od -c.
- Non-UTF8 / invalid byte sequences in the --a value (e.g. printf '\\xff\\xfe'), and very long values.
  Does it crash differently? What about NUL bytes?
- Values for --b and --c: are they ever validated or printed? Confirm they are completely ignored
  (any value, empty, weird unicode) as long as they are present.
- Does the LANG/LC_ALL/PYTHONIOENCODING env var change the output or error text? Test LC_ALL=C.
- Does stdout buffering matter when piped vs tty (e.g. does order of stdout/stderr change)?
- Does it read stdin, touch files, or depend on the current directory or the current DATE/TIME?
  Run the same successful command twice at different moments and confirm output is identical
  (the Job repr must not contain a timestamp).`,
  },
]

const probes = await parallel(DIMENSIONS.map(d => () =>
  agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: SCHEMA })
))

const good = probes.filter(Boolean)

phase('Critic')

const critic = await agent(
  `${COMMON}
Five probe agents characterized this program. Here are their consolidated reports:

${JSON.stringify(good, null, 2)}

YOUR JOB: act as a completeness critic for a Node.js ESM reimplementation that must match
stdout byte-for-byte and exit codes exactly.
1. Identify CONTRADICTIONS between reports and resolve them by running ${EXE} yourself.
2. Identify behaviors NOT yet covered that a JS port would plausibly get wrong. Specifically consider
   JS-vs-Python trap areas: JS RegExp \\d is ASCII-only while Python's is Unicode; JS '$' does not match
   before a trailing newline while Python's does; Number()/parseInt do not accept Unicode digits while
   Python int() does; String.split with a limit differs from Python's str.split; JS lacks Python's
   '%-*s' padding. Probe each such trap against the real binary and report the ground truth.
3. Report a FINAL consolidated decision procedure precise enough to implement without further probing.
Run whatever commands you need to settle every open question.`,
  { label: 'critic:gaps', phase: 'Critic', schema: {
    type: 'object',
    properties: {
      contradictionsResolved: { type: 'array', items: { type: 'string' } },
      newFindings: { type: 'array', items: { type: 'string' } },
      jsTraps: { type: 'array', items: { type: 'object', properties: {
        trap: { type: 'string' }, groundTruth: { type: 'string' }, evidence: { type: 'string' },
      }, required: ['trap', 'groundTruth', 'evidence'] } },
      finalDecisionProcedure: { type: 'string' },
    },
    required: ['contradictionsResolved', 'newFindings', 'jsTraps', 'finalDecisionProcedure'],
  } }
)

return { probes: good, critic }
