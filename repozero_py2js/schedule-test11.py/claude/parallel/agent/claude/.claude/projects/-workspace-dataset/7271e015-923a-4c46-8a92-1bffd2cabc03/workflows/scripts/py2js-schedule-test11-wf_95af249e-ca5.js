export const meta = {
  name: 'py2js-schedule-test11',
  description: 'Port Python test11.py (argparse + schedule tags) to zero-dependency Node ESM in /output, with differential verification against the reference executable',
  phases: [
    { title: 'Probe' },
    { title: 'Harness' },
    { title: 'Implement' },
    { title: 'Selftest' },
    { title: 'Judge' },
    { title: 'Promote' },
    { title: 'Review' },
    { title: 'Verify' },
    { title: 'Fix' },
    { title: 'Final' },
  ],
}

const SPEC = `
# TASK CONTEXT (shared by all agents)

We are porting a Python program to pure Node.js ESM with ZERO external dependencies.

## Source: /workspace/dataset/test11.py
\`\`\`python
import argparse
import schedule

parser = argparse.ArgumentParser()
parser.add_argument('--a', type=int, required=True)
parser.add_argument('--b', type=int, required=True)
args = parser.parse_args()

jobs_created = 0
for i in range(args.a):
    job = schedule.every(1).seconds.tag('group1').do(lambda: None)
    jobs_created += 1
print(jobs_created)

for i in range(args.b):
    job = schedule.every(1).minutes.tag('group2').do(lambda: None)
    jobs_created += 1
print(jobs_created)

group1_jobs = schedule.get_jobs('group1')
print(len(group1_jobs))

group2_jobs = schedule.get_jobs('group2')
print(len(group2_jobs))

all_jobs = schedule.get_jobs()
print(len(all_jobs))

schedule.clear('group1')
print(len(schedule.get_jobs()))

schedule.clear('group2')
print(len(schedule.get_jobs()))

for i in range(args.a + args.b):
    job = schedule.every(1).seconds.do(lambda: None)
print(len(schedule.get_jobs()))
\`\`\`

Reference executable (already contains all deps, DO NOT use the \`python\` command):
  /workspace/dataset/test11_executable --a 2 --b 3

## HARD REQUIREMENTS (violating any of these invalidates the answer)
1. Pure JavaScript for Node.js. ESM only: \`import\` / \`export\`. \`require()\` and \`module.exports\` are STRICTLY PROHIBITED anywhere (including inside strings/comments used as code).
2. Every generated file uses the \`.mjs\` suffix. All relative imports must include the full \`.mjs\` extension.
3. ZERO external dependencies. No npm packages. Only \`node:\`-prefixed built-ins are allowed to be imported, and ideally not even those (the program needs almost nothing). NEVER import a bare package specifier.
4. Do NOT embed or shell out to Python. Do not spawn the reference executable from product code.
5. Command-line parsing must match Python argparse exactly (names, required, type=int, error text, exit codes, stdout/stderr routing).
6. \`console.log\`/stdout output must match Python \`print\` byte-for-byte.
7. Libraries must be split hierarchically into multiple modules by functionality, each exposing its interface via \`export\`.
8. Everything ships under /output. Entry file is exactly \`/output/test11.mjs\`.
9. Black box: we cannot read CPython's or the \`schedule\` package's source. Reimplement from observed interface behavior.

## OBSERVED REFERENCE BEHAVIOR (verified by running the executable)

### Program output (stdout, one integer per line, trailing newline after each)
For \`--a A --b B\` where a=max(A,0) and b=max(B,0) effectively (Python \`range(n)\` with n<=0 iterates 0 times):
  line1: a                     (jobs_created after loop 1)
  line2: a+b                   (jobs_created after loop 2)
  line3: a                     (len(get_jobs('group1')))
  line4: b                     (len(get_jobs('group2')))
  line5: a+b                   (len(get_jobs()))
  line6: b                     (after clear('group1'))
  line7: 0                     (after clear('group2'))
  line8: max(A,0)+max(B,0)     (after recreating range(A+B) jobs -> careful: this loop is range(args.a + args.b) on the RAW values)

CRITICAL detail confirmed by probing: the final loop is \`range(args.a + args.b)\` using the RAW parsed ints, so a negative value can cancel a positive one.
  \`--a -3 --b 2\` -> 0 / 2 / 0 / 2 / 2 / 2 / 0 / 0     (last line is len(range(-3+2)) = 0)
  \`--a 2 --b 3\`  -> 2 / 5 / 2 / 3 / 5 / 3 / 0 / 5
  \`--a 1 --b 0\`  -> 1 / 1 / 1 / 0 / 1 / 0 / 0 / 1
  \`--a 0 --b 0\`  -> eight lines of 0
  \`--a 10 --b 7\` -> 10 / 17 / 10 / 7 / 17 / 7 / 0 / 17
Model this by actually looping (or by faithful arithmetic that reproduces it, including negatives).

### argparse behavior
prog name = basename of argv[0]. Reference prints \`test11_executable\`; our port must derive it the same way from Node (basename of process.argv[1], i.e. \`test11.mjs\` when run as \`node /output/test11.mjs\`). Do NOT hardcode "test11_executable".

Usage line (stderr on error, stdout in help):
\`usage: PROG [-h] --a A --b B\`

Full help (stdout, exit code 0), triggered by \`-h\`, \`--help\`, or any unambiguous prefix like \`--h\`, \`--he\`, \`--hel\`:
\`\`\`
usage: PROG [-h] --a A --b B

options:
  -h, --help  show this help message and exit
  --a A
  --b B
\`\`\`
(That is: usage line, blank line, "options:", then three option lines. Note two spaces of indent; the help column starts at column 14 — "  -h, --help" is 12 chars then two spaces then the text. \`--a A\` and \`--b B\` have no help text so nothing follows them, and there is NO trailing whitespace on those lines.)
Help printing happens as soon as the help flag is encountered during parsing, BEFORE required-argument checks and BEFORE unrecognized-argument checks: \`--a 3 --b 2 -h\` and \`-h --a 3\` both print help and exit 0.

Errors: two lines on STDERR, exit code 2:
\`usage: PROG [-h] --a A --b B\`
\`PROG: error: MESSAGE\`

Confirmed messages:
- no args:            \`the following arguments are required: --a, --b\`
- only --a given:     \`the following arguments are required: --b\`
- only --b given:     \`the following arguments are required: --a\`
- \`--a x --b 1\`:      \`argument --a: invalid int value: 'x'\`
- \`--a 1 --b 2 --c 3\`: \`unrecognized arguments: --c 3\`
- \`--a 1 --b 2 extra\`: \`unrecognized arguments: extra\`
- \`--a 1 --b 2 --\`:   \`unrecognized arguments: --\`
- \`--a --b 1\`:        \`argument --a: expected one argument\`   (\`--b\` looks like an option so it is not consumed as a value)
- \`--a 1 --b\`:        \`argument --b: expected one argument\`
- \`-a 1 --b 1\`:       \`the following arguments are required: --a\`  (unknown \`-a\` and stray \`1\` go to extras; the REQUIRED check fires first and wins)
- \`--a 0x10 --b 1\`:   \`argument --a: invalid int value: '0x10'\`
- \`--a "" --b 1\`:     \`argument --a: invalid int value: ''\`
- \`--a --5 --b 1\`:    \`argument --a: expected one argument\`
Ordering rule: required-arguments error is raised before the unrecognized-arguments error.

Accepted forms: \`--a 5\`, \`--a=5\`. Repeats overwrite: \`--a 1 --a 2\` -> 2. Negative numbers ARE accepted as values (\`--a -3\`) because the parser defines no option that looks like a negative number.

### Python int() semantics for type=int (all verified)
Accepted: \`1_0\`->10, \` 5 \`(surrounding whitespace)->5, \`+5\`->5, \`007\`->7, \`-3\`->-3, arbitrary precision.
Rejected (ValueError -> argparse "invalid int value"): \`_10\`, \`10_\`, \`1__0\`, \`+_5\`, \`- 5\`, \`5 5\`, \`0x10\`, \`0b101\`, \`1e3\`, \`1.5\`, \`\`(empty), whitespace-only.
Unicode: any Unicode decimal digit (category Nd) is accepted and mixed scripts are allowed.
  \`٥\` (U+0665) -> 5;  \`١٢\`/\`１２\` -> 12;  \`٥_٦\` -> 56;  \`٥5\` -> 55;  \`۵\` (U+06F5) -> 5;  \`𝟝\` (U+1D7DD, astral Nd) -> 5;  \`9𝟝\` -> 95.
  Non-Nd numerics are rejected: \`²\` (U+00B2, category No) -> invalid.
Leading/trailing whitespace stripped uses the Unicode White_Space property exactly:
  ACCEPTED as whitespace: U+0009..U+000D, U+0020, U+0085 (NEL), U+00A0 (NBSP), U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000.
  NOT whitespace (so they cause a ValueError): U+001C..U+001F, U+200B (ZWSP), U+FEFF (BOM).
  In Node this set is exactly \`\\p{White_Space}\` with the \`u\` flag. JavaScript's \`\\s\` is WRONG here (it includes U+FEFF).
Underscore rule: a single \`_\` is allowed only BETWEEN two digits (after the sign, not leading, not trailing, never doubled).

### Python repr() of the offending string in "invalid int value: X" (all verified)
The value is rendered with Python \`repr()\` for str:
- Default quote is \`'\`. If the string contains \`'\` and does NOT contain \`"\`, the whole thing is wrapped in \`"\` instead and the \`'\` is NOT escaped:  \`it's\` -> \`"it's"\`.
- If it contains BOTH \`'\` and \`"\`, single quotes are used and \`'\` is backslash-escaped, \`"\` is left bare: \`both'and"\` -> \`'both\\'and"'\`.
- If it contains only \`"\`, single quotes and the \`"\` is bare: \`he said "hi"\` -> \`'he said "hi"'\`.
- Backslash is always escaped: \`\\back\` -> \`'\\\\back'\`.
- \`\\n\` -> \`\\n\`, \`\\t\` -> \`\\t\`, \`\\r\` -> \`\\r\` (these three short forms only; \\v and \\f use \\x0b / \\x0c).
- Non-printable characters are escaped by codepoint width: \`\\xHH\` (2 hex, lowercase) for cp < 0x100, \`\\uHHHH\` for cp < 0x10000, \`\\UHHHHHHHH\` (8 hex) for astral.
  Verified: U+0001 -> \`\\x01\`; U+00A0 -> \`\\xa0\`; U+2028 -> \`\\u2028\`; U+FEFF -> \`\\ufeff\`; U+E000 -> \`\\ue000\`; U+FFFE -> \`\\ufffe\`; U+001C -> \`\\x1c\`.
- "Printable" follows Python \`str.isprintable()\`: a char is NON-printable iff its Unicode general category is one of Cc, Cf, Cs, Co, Cn, Zl, Zp, Zs — EXCEPT that ASCII space U+0020 IS printable.
  In Node this is exactly \`/[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Cn}\\p{Zl}\\p{Zp}\\p{Zs}]/u\` (with U+0020 special-cased as printable). \`é\`, \`±\`, \`²\`, \`𐐀\` (U+10400) are printable and pass through literally.
- Iterate by CODE POINT, not UTF-16 unit.

### schedule package surface used
\`schedule.every(1).seconds\`, \`.minutes\`, \`.tag('x')\` (returns the job, chainable, variadic tags), \`.do(fn)\` (registers the job in the default scheduler and returns the job), \`schedule.get_jobs(tag?)\`, \`schedule.clear(tag?)\`.
Semantics: \`get_jobs()\` returns all jobs of the default scheduler; \`get_jobs(tag)\` returns only jobs carrying that tag. \`clear()\` removes all; \`clear(tag)\` removes only jobs carrying that tag. Jobs are registered on \`.do(...)\`, not on \`.every(...)\`. Tag order/identity is a set.
Our reimplementation should be a reasonable, idiomatic JS library modeling this API (Scheduler + Job + module-level default-scheduler functions), not just a counter.

## MODULE LAYOUT TO USE (mandatory, so all agents agree)
/output/lib/py/whitespace.mjs   - Unicode White_Space predicate + strip helpers
/output/lib/py/digits.mjs       - Unicode Nd decimal-digit predicate + digit value
/output/lib/py/errors.mjs       - PyValueError (and any other Python-ish error types)
/output/lib/py/repr.mjs         - pyRepr(str) implementing Python str repr
/output/lib/py/int.mjs          - pyInt(str) -> BigInt (throws PyValueError); carries a name of 'int' for argparse messages
/output/lib/py/print.mjs        - pyPrint / pyPrintErr writing to stdout/stderr with Python newline behavior
/output/lib/cli/errors.mjs      - ArgumentError / ArgumentTypeError / ParserExit
/output/lib/cli/formatter.mjs   - usage-line + help-text formatting
/output/lib/cli/argparse.mjs    - ArgumentParser (add_argument, parse_args, parse_known_args, error, exit)
/output/lib/schedule/errors.mjs - ScheduleError, ScheduleValueError, IntervalError, CancelJob
/output/lib/schedule/job.mjs    - Job class
/output/lib/schedule/scheduler.mjs - Scheduler class
/output/lib/schedule/index.mjs  - default scheduler + module-level API (every, getJobs/get_jobs, clear, run_pending, ...)
/output/test11.mjs              - entry point
Candidate implementations mirror this tree under their own root directory.
`

const CLI_CASES_NOTE = `
The differential harness at /tmp/difftest.mjs compares a target command against the reference executable.
Run it with:  node /tmp/difftest.mjs <path-to-entry.mjs>
It normalizes the prog name (reference prints "test11_executable", the port prints the basename of its own script)
before comparing stderr. It reports PASS/FAIL per case and a summary line "RESULT: N/M passed".
`

phase('Probe')

const probes = await parallel([
  () => agent(`${SPEC}

You are an argparse black-box prober. Run /workspace/dataset/test11_executable with MANY more argument
combinations than are listed in the spec, to discover behaviors we have not yet pinned down. Do NOT use the
\`python\` command; run the executable directly. Capture stdout, stderr and exit code separately for each case.

Focus on cases the spec does not already answer, for example:
- interleaved / out-of-order options; options after extras; extras between options
- "--a=" (empty after equals), "--a==5", "--=5", "--" in various positions, "-" alone
- short-option clustering like "-hx", "-h=1", unknown short options "-x", "-x 1"
- abbreviations: "--h", "--he", "--help=1", "--a" is already minimal — check "--" prefix ambiguity
- repeated flags, "--a 1 --b 2 --b 3"
- values that look like options: "--a -1", "--a -x", "--a --", "--a -"
- multiple unrecognized arguments (how are they joined? order preserved?)
- an unrecognized argument PLUS an invalid int (which error wins?)
- an unrecognized argument PLUS a missing required (spec says required wins — confirm the reverse order too)
- huge integers (e.g. --a 99999999999999999999999 --b 0 will hang on the loop; instead test huge values only
  where they fail fast, or use a huge NEGATIVE value like --a -99999999999999999999999 --b 0 which loops zero times)
- exit codes and which stream each line goes to
Be careful: cases with big positive values will hang. Use \`timeout 5\` around every invocation.

Report ONLY the discovered behaviors as a compact list of (argv, exit code, stdout, stderr) triples plus any
RULES you inferred that are missing from the spec above. Flag explicitly anything that CONTRADICTS the spec.`,
    { label: 'probe:argparse', phase: 'Probe', effort: 'high' }),

  () => agent(`${SPEC}

You are a Python-semantics prober. Using ONLY /workspace/dataset/test11_executable as an oracle (never the
\`python\` command), nail down two things precisely, and report a compact table of findings:

(1) Python int() acceptance. Feed values through --a (use --b 0, and keep --a values small or negative so the
    program never loops long; wrap every call in \`timeout 5\`). Verify/extend the spec's claims about:
    Unicode Nd digits from several scripts and planes, the exact whitespace set (test U+000B, U+000C, U+0085,
    U+00A0, U+1680, U+2000, U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+001C, U+200B, U+FEFF),
    underscore placement rules (between digits only; also test around the sign and around unicode digits),
    signs (+/-, double sign, sign with whitespace between sign and digits), and whitespace INSIDE the number.
(2) Python repr() rendering of the rejected value in the error message. Test strings containing quotes,
    backslashes, control chars (U+0000 via a shell-safe method may be impossible — note that), \\n \\t \\r \\v \\f,
    astral printable chars, astral non-printable chars, combining marks, and surrogate-range-ish sequences.

Generate the test strings from a Node or bash script that writes the bytes precisely (printf with hex escapes),
and diff observed vs. what the spec predicts. Report ONLY: a findings table, and an explicit list of any place
where the spec's stated rule is WRONG or INCOMPLETE.`,
    { label: 'probe:pysemantics', phase: 'Probe', effort: 'high' }),

  () => agent(`${SPEC}

${CLI_CASES_NOTE}

You are building the differential test harness. Write /tmp/difftest.mjs — a Node ESM script (zero external deps)
that:
  * takes the path to a port entry file as process.argv[2] (e.g. /output/test11.mjs)
  * holds a CASES array of at least 90 argv arrays covering: normal values (including 0, 1, negatives, mixed
    signs that cancel, larger values like 10/7 and 50/25), the "=" form, repeats, help flags (-h, --help, --h,
    --he), missing required (all three shapes), invalid ints (x, 1.5, 0x10, 0b101, 1e3, empty, "_10", "10_",
    "1__0", "+_5", "- 5", "5 5"), valid exotic ints ("1_0", " 5 ", "+5", "007", unicode digits ٥ / １２ / ٥_٦ /
    ٥5 / U+1D7DD astral, whitespace-padded with U+00A0 / U+2028 / U+000B / U+3000, rejected U+200B / U+FEFF /
    U+001C), repr-exercising values (it's, both'and", he said "hi", backslashes, \\n \\t \\r \\v \\f, U+0001,
    U+00A0, U+E000, U+FFFE, é±, 𐐀), unrecognized args (single, multiple, positional, "--"), "-a 1 --b 1",
    "--a --b 1", "--a 1 --b", and combinations where two error kinds compete.
    Build the exotic strings with explicit \\u escapes / String.fromCodePoint so the file stays ASCII-safe.
    Keep every numeric magnitude small (|value| <= 200) so no case loops for long; huge values may appear only
    as negatives or as invalid-int strings.
  * for each case, spawns the reference \`/workspace/dataset/test11_executable\` and the target
    \`node <entry>\` with the SAME argv array (use node:child_process spawnSync with an argv ARRAY, shell:false,
    encoding 'utf8', timeout 10000)
  * normalizes ONLY the prog name before comparing: in the reference's stdout+stderr replace every occurrence of
    \`test11_executable\` with the basename of the target entry file (e.g. \`test11.mjs\`). No other normalization —
    compare the rest byte-for-byte, including trailing newlines, plus the exit status.
  * prints one line per failing case with a readable JSON dump of the argv and a unified-ish diff of expected vs
    actual for stdout, stderr and status; prints nothing per passing case except a dot
  * ends with a final line exactly like \`RESULT: 93/93 passed\` and exits 0 only when all pass.

Sanity-check the harness by running it against the reference itself (node /tmp/difftest.mjs is not applicable —
instead temporarily verify a couple of cases by hand) and make sure the harness itself has no crashes.
Also write /tmp/difftest-cases.md listing the case argvs in human-readable form.

Return ONLY: the absolute path of the harness, the number of cases, and any caveats.`,
    { label: 'build:difftest', phase: 'Harness', effort: 'high' }),
])

const probeReport = probes.filter(Boolean).join('\n\n---\n\n')
log('Probing + harness complete')

phase('Implement')

const EXTRA = `

## ADDITIONAL BLACK-BOX FINDINGS FROM DEDICATED PROBE AGENTS
(Trust these over the spec above where they conflict; they were measured against the real executable.)

${probeReport}
`

const CANDIDATES = [
  {
    id: 'c1',
    dir: '/tmp/cand1',
    angle: `Optimize for FIDELITY-FIRST engineering: mirror CPython's argparse structure closely (Action objects,
_get_values/_parse_optional/consume_optional analogues), and make the Python-semantics layer (int, repr,
whitespace, Nd digits) rigorous and independently unit-testable. Prefer explicit, well-named small functions.`,
  },
  {
    id: 'c2',
    dir: '/tmp/cand2',
    angle: `Optimize for CLEAN LAYERED ARCHITECTURE and readable idiomatic modern JS: crisp module boundaries,
minimal coupling, JSDoc on every export, each module doing exactly one thing. The schedule library should be a
genuinely usable mini-library (Job/Scheduler with chainable unit getters, tags as a Set, run_pending, next_run,
idle_seconds, cancel_job, CancelJob sentinel), not a stub.`,
  },
  {
    id: 'c3',
    dir: '/tmp/cand3',
    angle: `Optimize for ADVERSARIAL ROBUSTNESS: assume the grader will throw pathological argv at it. Handle
BigInt-precision integers, astral code points, empty strings, arguments that look like options, and stream
routing/flush ordering precisely. Make stdout/stderr writes synchronous and ordered so nothing is lost on exit,
and make process exit codes exact.`,
  },
]

const candidates = await parallel(CANDIDATES.map(c => () => agent(`${SPEC}${EXTRA}

You are implementing CANDIDATE ${c.id}. Write your full implementation under **${c.dir}** using the mandated
module layout (same relative paths, but rooted at ${c.dir} instead of /output — so the entry is
${c.dir}/test11.mjs and libs live in ${c.dir}/lib/...).

Your particular angle: ${c.angle}

Requirements recap you must not violate: ESM only, .mjs everywhere, explicit .mjs in every relative import,
no require/module.exports anywhere, no bare-specifier imports (node: built-ins only if truly needed — note the
entry can get argv from process.argv and write with process.stdout.write without importing anything), no Python.

Implementation notes:
- Parse ints with BigInt internally so arbitrary precision is preserved, and make sure printing an int matches
  Python (no "n" suffix, no exponent form).
- The final loop uses range(a + b) on the RAW parsed values; negatives must be able to cancel positives.
- Guard against pathological loop counts only insofar as Python would behave the same; do not silently clamp.
  (Prefer computing the loop count as max(0, n) and creating that many real Job objects.)
- stdout/stderr: use process.stdout.write / process.stderr.write with explicit "\\n"; ensure output is flushed
  before exiting with a non-zero code (process.exitCode + natural exit is safer than process.exit()).
- The schedule module must actually track Job objects with tags; the counts must fall out of real behavior.

VERIFY YOUR OWN WORK before returning:
1. \`node --check\` each .mjs file.
2. \`grep -rn "require(\\|module.exports" ${c.dir}\` must be empty.
3. \`grep -rnE "^\\s*import .* from '[^.]" ${c.dir}\` must show only node: specifiers (ideally none).
4. Run \`node /tmp/difftest.mjs ${c.dir}/test11.mjs\` and iterate until it reports all cases passing. If the
   harness itself looks buggy, say so explicitly in your report rather than weakening your implementation.
5. Spot-check by hand: \`node ${c.dir}/test11.mjs --a 2 --b 3\` vs \`/workspace/dataset/test11_executable --a 2 --b 3\`.

Return ONLY a JSON-ish summary: files written (paths), the final RESULT line from the difftest harness, and any
known gaps.`, { label: `impl:${c.id}`, phase: 'Implement', effort: 'high' })))

log('Candidate implementations complete')

phase('Selftest')

const SELFTEST_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    passed: { type: 'integer' },
    total: { type: 'integer' },
    complianceOk: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['id', 'passed', 'total', 'complianceOk', 'failures', 'notes'],
  additionalProperties: false,
}

const selftests = await parallel(CANDIDATES.map(c => () => agent(`${SPEC}

Independently AUDIT candidate ${c.id} at ${c.dir}. You did not write it. Do not modify it.

1. Run \`node /tmp/difftest.mjs ${c.dir}/test11.mjs\` and record the RESULT numbers and every failing case.
2. Run compliance greps: any \`require(\` or \`module.exports\`; any import of a bare specifier (non-relative,
   non-\`node:\`); any file not ending in .mjs; any relative import missing the .mjs extension; any reference to
   python. Also confirm the module tree matches the mandated layout and that every lib module actually exports
   something used.
3. Try 15 adversarial argv cases of your own invention that the harness likely misses, comparing against
   /workspace/dataset/test11_executable directly (always with \`timeout 5\`, small magnitudes).

Report the structured result. complianceOk=false if ANY hard requirement is violated. Put concrete failing
argv + expected vs actual in \`failures\`.`, { label: `audit:${c.id}`, phase: 'Selftest', schema: SELFTEST_SCHEMA, effort: 'high' })))

const auditText = selftests.filter(Boolean).map(s => JSON.stringify(s)).join('\n')
log(`Audits: ${auditText}`)

phase('Judge')

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    winner: { type: 'string', enum: ['c1', 'c2', 'c3'] },
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          fidelity: { type: 'integer' },
          compliance: { type: 'integer' },
          architecture: { type: 'integer' },
          robustness: { type: 'integer' },
          rationale: { type: 'string' },
        },
        required: ['id', 'fidelity', 'compliance', 'architecture', 'robustness', 'rationale'],
        additionalProperties: false,
      },
    },
    graftIdeas: { type: 'array', items: { type: 'string' } },
  },
  required: ['winner', 'scores', 'graftIdeas'],
  additionalProperties: false,
}

const judges = await parallel(['behavioral fidelity vs the reference executable', 'hard-requirement compliance and ESM/zero-dependency hygiene', 'module architecture, hierarchy quality and library completeness'].map((lens, i) => () => agent(`${SPEC}

Judge the three candidate implementations at /tmp/cand1, /tmp/cand2, /tmp/cand3 through this lens: **${lens}**.
Read their code. You may run them and the difftest harness (\`node /tmp/difftest.mjs <dir>/test11.mjs\`).

Independent audit results for reference:
${auditText}

Score each 0-10 on fidelity, compliance, architecture, robustness (weight your lens most heavily but fill all
four). Pick a winner. In \`graftIdeas\`, list specific concrete things from the LOSING candidates that the winner
should adopt (name the file and the idea).`, { label: `judge:${i + 1}`, phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'high' })))

const judgeText = judges.filter(Boolean).map(j => JSON.stringify(j)).join('\n')
log(`Judging complete: ${judgeText}`)

phase('Promote')

const promote = await agent(`${SPEC}${EXTRA}

Three candidates were built at /tmp/cand1, /tmp/cand2, /tmp/cand3.

Independent audits:
${auditText}

Judge panel results:
${judgeText}

Your job: produce the FINAL implementation in **/output**, using the mandated module layout exactly:
/output/lib/py/{whitespace,digits,errors,repr,int,print}.mjs
/output/lib/cli/{errors,formatter,argparse}.mjs
/output/lib/schedule/{errors,job,scheduler,index}.mjs
/output/test11.mjs

Start from the winning candidate, then graft in the specific improvements the judges listed from the others.
Do not blindly concatenate — the result must be coherent, minimal, and consistent in style. Every module must
have a clear single responsibility, JSDoc on its exports, and imports with explicit .mjs extensions.

/output must contain ONLY the final deliverable (no candidate leftovers, no test scratch files, no package.json
unless it is genuinely required — it is not, since .mjs already forces ESM).

Then verify:
- \`node --check\` every file
- \`grep -rn "require(\\|module\\.exports" /output\` -> empty
- every relative import ends in .mjs; no bare-specifier imports
- \`node /tmp/difftest.mjs /output/test11.mjs\` -> all cases pass
- hand spot-check \`node /output/test11.mjs --a 2 --b 3\` == \`/workspace/dataset/test11_executable --a 2 --b 3\`

Return the final RESULT line, the file list, and anything you deliberately did not graft (with the reason).`,
  { label: 'promote:final', phase: 'Promote', effort: 'high' })

log('Promoted winner into /output')

phase('Review')

const LENSES = [
  { key: 'behavior', prompt: `Hunt for any argv input where \`node /output/test11.mjs ARGS\` diverges from \`/workspace/dataset/test11_executable ARGS\` in stdout, stderr, or exit code (ignoring only the prog-name substitution). Actually RUN both with timeout 5 and small magnitudes. Be creative and adversarial: option-lookalike values, equals-forms, abbreviations, unicode, competing error kinds, empty strings, repeated flags, argument order.` },
  { key: 'compliance', prompt: `Hunt for hard-requirement violations in /output: any require()/module.exports, any non-.mjs file, any relative import without a .mjs extension, any bare-specifier/npm import, any Python invocation or embedded Python, any mention/use of a JS external library, files placed outside /output, missing exports, or an entry file not named test11.mjs. Also confirm the library is genuinely split hierarchically by functionality and that each module exports a used interface.` },
  { key: 'pysemantics', prompt: `Hunt for defects in the Python-semantics layer of /output: pyInt (unicode Nd digits including astral, White_Space stripping incl. U+0085/U+00A0/U+2028/U+3000 and the exclusion of U+001C/U+200B/U+FEFF, underscore placement, signs, BigInt precision) and pyRepr (quote selection, backslash and quote escaping, \\n/\\t/\\r short forms vs \\x0b/\\x0c, \\xHH/\\uHHHH/\\UHHHHHHHH width selection, Python str.isprintable category rules, code-point iteration for astral chars). Verify each suspicion against the reference executable.` },
  { key: 'robustness', prompt: `Hunt for crash/edge defects in /output: unhandled exceptions escaping to a stack trace, output lost due to async stdout on exit, wrong exit codes, BigInt/Number mixing errors, infinite or absurd loops for large inputs where Python would behave differently, EPIPE handling, and any place a JS TypeError could surface instead of the argparse error message. Also review the schedule library for correctness of tag filtering and clear() semantics (e.g. clearing while iterating, jobs with multiple tags, clear() with no tag).` },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          detail: { type: 'string' },
          repro: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
        },
        required: ['title', 'file', 'detail', 'repro', 'severity'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    isReal: { type: 'boolean' },
    reason: { type: 'string' },
    confirmedRepro: { type: 'string' },
  },
  required: ['isReal', 'reason', 'confirmedRepro'],
  additionalProperties: false,
}

const reviewed = await pipeline(
  LENSES,
  l => agent(`${SPEC}

Review the FINAL implementation in /output. Lens: ${l.key}.

${l.prompt}

You have the reference executable /workspace/dataset/test11_executable as ground truth (never use the \`python\`
command; always wrap invocations in \`timeout 5\`; keep numeric magnitudes small so nothing hangs). The difftest
harness is at /tmp/difftest.mjs (usage: node /tmp/difftest.mjs /output/test11.mjs).

Do NOT modify any files. Report only defects you have actually demonstrated or can precisely justify, each with
an exact reproduction command.`, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' }),
  (r, l) => parallel((r && r.findings ? r.findings : []).map(f => () =>
    agent(`Adversarially VERIFY this claimed defect in /output. Default to refuted unless you can demonstrate it.

Claim: ${f.title}
File: ${f.file}
Detail: ${f.detail}
Repro: ${f.repro}

Ground truth is /workspace/dataset/test11_executable (never the \`python\` command; wrap in \`timeout 5\`).
Remember the ONE legitimate difference: the prog name in usage/error lines is the basename of argv[0], so the
reference says "test11_executable" while the port says "test11.mjs" — that is CORRECT, not a defect.
Actually run the commands. Set isReal=true only if you reproduced a genuine divergence or a genuine hard-
requirement violation. Put the exact commands and observed outputs in confirmedRepro.`,
      { label: `verify:${l.key}:${f.severity}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' })
      .then(v => ({ ...f, lens: l.key, verdict: v }))))
)

const confirmed = reviewed.flat().filter(Boolean).filter(f => f.verdict && f.verdict.isReal)
log(`Confirmed defects: ${confirmed.length}`)

phase('Fix')

let fixReport = 'No confirmed defects; nothing to fix.'
if (confirmed.length > 0) {
  fixReport = await agent(`${SPEC}

The final implementation in /output has these CONFIRMED defects (each independently verified against the
reference executable):

${confirmed.map((f, i) => `### ${i + 1}. [${f.severity}] ${f.title} (${f.file}, lens=${f.lens})
Detail: ${f.detail}
Confirmed repro: ${f.verdict.confirmedRepro}`).join('\n\n')}

Fix ALL of them in /output without breaking anything else and without violating any hard requirement.
Keep the module layout and style. After fixing:
- \`node --check\` every .mjs file
- \`node /tmp/difftest.mjs /output/test11.mjs\` must report all cases passing
- re-run each confirmed repro and show it now matches the reference (modulo the prog-name difference)
Return a per-defect fixed/skipped list with the evidence.`, { label: 'fix:confirmed', phase: 'Fix', effort: 'high' })
}

phase('Final')

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    allPass: { type: 'boolean' },
    resultLine: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    complianceChecks: { type: 'array', items: { type: 'string' } },
    sampleOutput: { type: 'string' },
    remainingIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['allPass', 'resultLine', 'files', 'complianceChecks', 'sampleOutput', 'remainingIssues'],
  additionalProperties: false,
}

const final = await agent(`${SPEC}

FINAL GATE. Independently validate the deliverable in /output. Do not write code unless a check fails and the
fix is trivially safe (if a non-trivial failure remains, report it instead of hacking around it).

Run and record evidence for ALL of the following:
1. \`find /output -type f | sort\` — list every file; flag anything that is not part of the deliverable or does
   not end in .mjs.
2. \`node --check\` on every .mjs file.
3. \`grep -rn "require(" /output\` and \`grep -rn "module.exports" /output\` — must be empty.
4. Every relative import ends with .mjs; no bare-specifier imports (only \`node:\` allowed).
5. \`node /tmp/difftest.mjs /output/test11.mjs\` — capture the final RESULT line.
6. A fresh randomized differential sweep of 40 argv cases you invent on the spot (small magnitudes, timeout 5),
   including at least 10 error cases and 5 unicode cases, compared against the reference.
7. \`node /output/test11.mjs --a 2 --b 3\` output captured verbatim for the report.
8. Confirm no file outside /output is required at runtime (the entry must run from any cwd:
   test \`cd /tmp && node /output/test11.mjs --a 1 --b 1\`).

allPass=true only if 1-8 are all clean. Put concrete evidence in the fields.`,
  { label: 'final:gate', phase: 'Final', schema: FINAL_SCHEMA, effort: 'high' })

return { promote, fixReport, final, confirmedCount: confirmed.length }
