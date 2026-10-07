export const meta = {
  name: 'probe-schedule-test12',
  description: 'Black-box characterize test12_executable across argparse + schedule dimensions',
  phases: [
    { title: 'Probe', detail: 'six parallel probe agents run the executable' },
    { title: 'Synthesize', detail: 'merge findings into one implementation spec' },
  ],
}

const COMMON = `
You are black-box characterizing a PyInstaller executable: /workspace/dataset/test12_executable
Its Python source is /workspace/dataset/test12.py (short; you MAY read it). It uses argparse (--a/--b/--c, type=int, all required)
and the \`schedule\` library, printing job intervals and Job() reprs.

HARD RULES:
- Do NOT extract, unpack, decompile, or run \`strings\`/binwalk/pyi-archive_viewer on the executable, and do NOT try to read the
  bundled \`schedule\` package source. Characterize by RUNNING it only. This is a strict black-box exercise.
- ALWAYS wrap every run in \`timeout 8\` (some inputs loop forever / for minutes). Never run the executable without a timeout.
  Passing 0 to --a/--b/--c hangs forever; -1 to --a or --b takes ~1min+. Budget accordingly and note timeouts as such.
- Capture stdout and stderr SEPARATELY and record the exit code, e.g.:
    timeout 8 /workspace/dataset/test12_executable --a 5 --b 10 --c 3 >/tmp/o 2>/tmp/e; echo "rc=$?"; echo "--out--"; cat -A /tmp/o; echo "--err--"; cat -A /tmp/e
  Use \`cat -A\` whenever exact spaces/tabs/newlines matter (report the real characters, not the $ markers, in your answer).
- Report EXACT byte-level text: leading/trailing spaces, blank lines, punctuation.

BASELINE (already established, do not re-derive):
  --a 5 --b 10 --c 3  ->  rc=0, stdout:
5
10
3
Job(interval=1, unit=days, do=<lambda>, args=(), kwargs={})
Job(interval=1, unit=weeks, do=<lambda>, args=(), kwargs={})   (x8 more weeks lines, 9 Job lines total)
12
`

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'rules', 'cases', 'gotchas'],
  properties: {
    dimension: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, implementable rules inferred (imperative, unambiguous). Include exact format strings.',
      items: { type: 'string' },
    },
    cases: {
      type: 'array',
      description: 'Concrete observed cases, verbatim output.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['args', 'exitCode', 'stdout', 'stderr'],
        properties: {
          args: { type: 'string', description: 'Argv after the program name, shell-quoted' },
          exitCode: { type: 'integer', description: 'Exit code; use 124 for timeout' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
    gotchas: { type: 'array', items: { type: 'string' } },
  },
}

const PROBES = [
  {
    key: 'int-parsing',
    prompt: `${COMMON}
DIMENSION: exactly which strings argparse's \`type=int\` accepts / rejects, and the exact rejection message.
Hold --b and --c at valid values (e.g. --b 1 --c 1) and vary --a. Determine acceptance and the parsed value.
Test at minimum: "5", "  5  ", "\\t5\\n", "+5", "-5", "007", "+007", "1_000", "1_0_0", "1__0", "_1", "1_", "-_1", "0x10", "0b101",
"0o17", "1e3", "1.0", "1.", ".5", "", " ", "5 5", "1,000", "inf", "nan", "None", "true", "5x", "x5", "٥" (U+0665 Arabic-Indic five),
"٥٦", "５" (U+FF15 fullwidth five), "５６", "१२" (Devanagari), "𝟝" (U+1D7DD math double-struck five), "²" (superscript two),
"½", "Ⅴ" (Roman numeral), "5\\u00a0" (nbsp), "\\u20035" (en-quad + 5), "-0", "+0" (NOTE: 0 hangs — use timeout and report rc=124),
"０" (fullwidth zero, also hangs).
For each: does it parse, to what value (read it off stdout line 1), or what is the exact stderr text?
Report the exact invalid-value message format (quoting style around the value, and how weird characters are shown).
Also: is the message repr()-style (e.g. does '\\t5' show as '\\t5')? Test that specifically.`,
  },
  {
    key: 'option-syntax',
    prompt: `${COMMON}
DIMENSION: argparse option-string syntax and error behavior.
Test at minimum: --a=5 form; -a 5; -a5; --a5; --ab 5; --A 5; -- separator ("--a 1 --b 2 --c 3 --" and "-- --a 1 ...");
repeated options (last wins?); options out of order; a bare positional ("foo --a 1 --b 2 --c 3" and "--a 1 --b 2 --c 3 foo");
two unrecognized args at once; "--a" with no value; "--a --b 2 --c 3"; "--a -5" (negative value); "--a=-5";
"--a=" (empty after equals); "--a 1 --b 2 --c 3 extra1 extra2"; "-abc"; "---a 5"; "--a 1 -b 2 --c 3".
Record exact usage/error lines, which stream they go to, and exit codes.
Determine: what is the exact "unrecognized arguments" message when multiple extras exist (separator/order)?
What is the exact "expected one argument" message? What is the exact missing-required message and the ORDER of listed args
(test omitting different subsets: only --a given, only --b given, only --c given, only --a and --c given, none given)?`,
  },
  {
    key: 'help-usage',
    prompt: `${COMMON}
DIMENSION: help and usage text, byte-exact.
Capture: -h, --help, --he, --h, --hel, and -h combined with other args ("-h --a 1", "--a 1 -h", "--a bad -h", "-h --zzz").
Which stream, exact bytes (use cat -A to see trailing spaces), exit codes.
Also determine whether terminal width affects wrapping: run with COLUMNS=20 and COLUMNS=200 exported (and note whether
COLUMNS is even honored when stdout is a pipe). Report the exact help text including the blank line placement and the
indentation of the options block (count spaces precisely).
Also: does the header say "options:" or "optional arguments:"?`,
  },
  {
    key: 'schedule-repr',
    prompt: `${COMMON}
DIMENSION: the printed Job() repr and job bookkeeping.
Confirm byte-exactly all 9 Job lines and the final job count. Then determine how the printed \`interval\` (first three lines)
and the repr interval relate to inputs. Vary --a/--b/--c over valid positive values including 1, 2, 7, 60, 3600, 86400,
1000000, 2147483647, 2147483648, 4294967296, 250000000000, and a value with many digits like 12345678901234567890 (expect an
error there — record it). Confirm the first three stdout lines are exactly the three integers as Python prints them
(no separators, no sign for positives, "+5" input printed as 5).
Also confirm the count line is always 12 whenever the program completes, and that stdout lines appear in source order,
with prints interleaved before any later failure (e.g. --a 5 --b 5 --c <bad> still prints 5 and 5 first).`,
  },
  {
    key: 'overflow-map',
    prompt: `${COMMON}
DIMENSION: overflow / error surface for large and negative intervals, per unit.
Units: --a is seconds (source line 11), --b is minutes (line 13), --c is hours (line 15).
Already known:
  --a 100000000000000 -> rc=1, stderr traceback, deepest frame "schedule/__init__.py", line 729, in _schedule_next_run,
     OverflowError: days=1157407407; must have magnitude <= 999999999
  --a 86400000000000 -> same shape, "days=1000000000; must have magnitude <= 999999999"
  --a 12345678901234567890... very large -> line 729, OverflowError: Python int too large to convert to C int
  --a 300000000000 -> line 731, OverflowError: date value out of range
  --a 250000000000 and 251000000000 -> rc=0 (no overflow)
  --c 2147483647 -> line 731, date value out of range;  --c -1 -> line 734, date value out of range (~1s)
YOUR JOB: pin down the EXACT thresholds by bisection for the seconds unit (--a) between the three regimes:
  (A) rc=0, (B) line 731 "date value out of range", (C) line 729 "days=N; must have magnitude <= 999999999",
  (D) line 729 "Python int too large to convert to C int".
Report the largest --a with rc=0 and the smallest --a giving regime B; the smallest giving C; the smallest giving D.
Do the same for --c (hours): largest rc=0 value and smallest overflow value. And for --b (minutes): find the smallest
positive value that overflows (bisect; it should be large).
Also test NEGATIVE large magnitudes: --a -100000000000000, --a -12345678901234567890, --c -2147483647, --c -1000000,
--c -100000, --c -24, --c -1000 (which of these error immediately at 729 vs 731 vs 734, and what message?).
Note: the threshold for regime B depends on TODAY'S DATE (it is now 2026-08-10) since it is "now + period > datetime.max".
State the rule in date terms, not just the raw number. Give the exact full traceback text (all 5 lines) for one example of
each regime, and note that the final "[PYI-NNN:ERROR] ..." line's number varies per run (report whether it equals the PID).`,
  },
  {
    key: 'loop-scaling',
    prompt: `${COMMON}
DIMENSION: confirm the negative/zero interval behavior is a linear step loop, and measure its scaling.
Hypothesis: schedule computes next_run = now + period, then runs \`while next_run <= now: next_run += period\` (line 734),
so period==0 loops forever and period<0 walks backwards until the datetime underflows year 1 -> OverflowError: date value out of range.
Verify by timing (use \`time timeout N ...\`, N sized per case):
  --c -1 (hours), --c -2, --c -4, --c -24, --c -168  (expect time roughly proportional to 1/|interval|)
  --a -3600 (seconds, one hour per step) should take about the same wall time as --c -1 (hours).
  --a -86400 vs --c -24 should match too.
Also confirm: --a 0 / --b 0 / --c 0 never terminate (run with timeout 10, report rc=124 and empty output), and confirm
whether ANY stdout was produced before the hang (e.g. --a 5 --b 5 --c 0 should print 5 and 5 first — check whether those
bytes actually appear when stdout is a pipe vs when it is a tty; note Python block-buffers a piped stdout, so report both).
Use \`script -qc\` or a pty if needed to test the tty case; if you cannot, say so.
Report a table of |interval| vs wall seconds, and state whether the linear-loop hypothesis holds.`,
  },
]

phase('Probe')
const results = await parallel(
  PROBES.map((p) => () => agent(p.prompt, { label: `probe:${p.key}`, phase: 'Probe', schema: SPEC_SCHEMA, effort: 'high' }))
)

const good = results.filter(Boolean)
log(`${good.length}/${PROBES.length} probes returned`)

phase('Synthesize')
const spec = await agent(
  `You are consolidating black-box probe results for a Python->Node.js migration of /workspace/dataset/test12.py
(argparse with --a/--b/--c type=int required, plus the \`schedule\` library).

Here are the raw probe reports as JSON:

${JSON.stringify(good, null, 2)}

Produce a single precise IMPLEMENTATION SPEC in markdown for a Node.js (ESM) reimplementation with zero dependencies.
It must state, unambiguously and byte-exactly:
1. Argument parsing: accepted syntaxes, the int() grammar (whitespace/sign/underscore/unicode-digit rules), and every
   error message template with exact wording, stream, and exit code. Include the missing-required-argument ordering rule.
2. The exact usage line and full help text.
3. The normal-path stdout, line by line, and the Job repr template.
4. The complete error/overflow model: timedelta construction limits and messages, datetime range overflow, the
   while-loop semantics (zero -> non-terminating, negative -> walk back to year 1 -> OverflowError), and the exact
   traceback text per regime including the schedule/__init__.py line numbers (729 / 731 / 734) and test12.py line numbers
   (11 / 13 / 15) and the trailing PyInstaller line.
5. Any contradictions or gaps between probe reports — call them out explicitly under "## UNRESOLVED" rather than papering over them.
Be exhaustive but do not invent anything the probes did not observe. Quote exact strings in fenced blocks.`,
  { label: 'synthesize-spec', phase: 'Synthesize', effort: 'high' }
)

return spec
