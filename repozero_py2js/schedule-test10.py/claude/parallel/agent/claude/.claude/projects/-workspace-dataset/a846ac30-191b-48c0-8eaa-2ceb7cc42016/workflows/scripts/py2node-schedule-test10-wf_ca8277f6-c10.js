export const meta = {
  name: 'py2node-schedule-test10',
  description: 'Migrate /workspace/dataset/test10.py (argparse + schedule) to zero-dependency ESM .mjs in /output, verified differentially against the reference binary',
  phases: [
    { title: 'Spec', detail: 'independent black-box probing of argparse + schedule.at() surfaces' },
    { title: 'Design', detail: '3 architecture proposals, judged, synthesized into a module contract' },
    { title: 'Build', detail: '2 independent candidate implementations in isolated dirs' },
    { title: 'Bakeoff', detail: 'exhaustive differential testing of both candidates vs the binary' },
    { title: 'Promote', detail: 'install winning candidate into /output' },
    { title: 'Review', detail: 'lens-diverse reviewers over the promoted tree' },
    { title: 'Verify', detail: 'adversarially confirm each finding before acting' },
    { title: 'Fix', detail: 'apply confirmed findings' },
    { title: 'Final', detail: 'full-matrix differential re-verification' },
  ],
}

const EXE = '/workspace/dataset/test10_executable'

const SPEC = `
# VERIFIED BLACK-BOX SPEC (established by the orchestrator by probing ${EXE})
Treat every item below as GROUND TRUTH already confirmed empirically. Do not contradict it.
Re-probe the binary freely to confirm or to explore anything NOT listed.

## Source program (/workspace/dataset/test10.py) — read it, it is 26 lines
import argparse, schedule; parser with 4 required str options --a --b --c --d; then:
  job1 = schedule.every().seconds.do(lambda: None) ; print(job1)
  schedule.cancel_job(job1)                        ; print(len(schedule.get_jobs()))
  job2 = schedule.every().minutes.do(lambda: None) ; print(job2)
  job3 = schedule.every().hours.do(lambda: None)   ; print(job3)
  schedule.clear()                                 ; print(len(schedule.get_jobs()))
  job4 = schedule.every().days.at(args.a).do(lambda: None) ; print(job4)
  job5 = schedule.every().weeks.do(lambda: None)   ; print(job5)
  print(len(schedule.get_jobs()))
Only --a is ever used semantically (as the .at() time string). --b/--c/--d are required but unused.

## HAPPY PATH stdout (exact bytes, e.g. --a 10:30 --b 1 --c 2 --d 3), exit 0
Job(interval=1, unit=seconds, do=<lambda>, args=(), kwargs={})
0
Job(interval=1, unit=minutes, do=<lambda>, args=(), kwargs={})
Job(interval=1, unit=hours, do=<lambda>, args=(), kwargs={})
0
Job(interval=1, unit=days, do=<lambda>, args=(), kwargs={})
Job(interval=1, unit=weeks, do=<lambda>, args=(), kwargs={})
2
(trailing newline after the final "2"; no other whitespace; 8 lines total)

Job.__str__ format string is exactly:
  Job(interval={interval}, unit={unit}, do={job_func_name}, args={args_tuple_repr}, kwargs={kwargs_dict_repr})
with job_func_name = the function __name__ ("<lambda>" for a lambda), args repr "()" and kwargs repr "{}".
NOTE: print() uses __str__, NOT __repr__ — so NO "(last run: ..., next run: ...)" timestamps appear.
Output is therefore fully deterministic and time-zone independent.

## Scheduler counting semantics (confirmed by the 0 / 0 / 2 lines)
- schedule.every() returns a NEW Job(interval=1) bound to the default scheduler.
- The job is appended to the scheduler's job list ONLY when .do(fn) is called (not at every()/unit/at()).
- .seconds/.minutes/.hours/.days/.weeks are PROPERTIES that set unit and return the job.
- .do(fn) stores the func, computes next_run, registers the job with the scheduler, returns the job.
- cancel_job(job) removes that job (no-op if absent). clear() removes all. get_jobs() returns the list.
- Trace: job1 -> 1 job; cancel -> 0; job2 -> 1; job3 -> 2; clear -> 0; job4 -> 1; job5 -> 2. Prints 0,0,2.

## .at() validation for unit == "days" — THE ONLY INPUT-DEPENDENT LOGIC
Python regex (schedule/__init__.py line 514 region): ^[0-2]\\d:[0-5]\\d(:[0-5]\\d)?$
  * The [0-2] and [0-5] classes are ASCII-literal.
  * CRITICAL CROSS-LANGUAGE TRAP: Python's \\d on str matches ALL Unicode Decimal_Number (Nd)
    characters, NOT just [0-9]. JavaScript's \\d is ASCII-only. You MUST use \\p{Nd} with the /u
    flag (or an equivalent) for the \\d positions, and ASCII [0-2]/[0-5] for the class positions.
  * Then hour/minute/second are parsed with Python int(), which ALSO accepts Unicode Nd digits.
  * A range check follows: hour must be 0..23.

Regex failure (exit 1) message: Invalid time format for a daily job (valid format is HH:MM(:SS)?)
  raised at  File "schedule/__init__.py", line 514, in at
Hour-range failure (exit 1) message: Invalid number of hours ({} is not between 0 and 23)
  raised at  File "schedule/__init__.py", line 547, in at
  *** The "{}" is LITERAL — an unformatted .format() placeholder bug in the schedule library.
      Reproduce the two brace characters verbatim. Do NOT substitute the hour value. ***

### Confirmed --a truth table
OK   (exit 0): 10:30  10:30:45  00:00  23:59  23:59:59  09:05  19:59:59
OK   (Unicode Nd in the \\d slots, value parsed by int()):
     1<U+0660>:30  (i.e. "1" + ARABIC-INDIC ZERO -> hour 10)   -> OK
     10:3<U+0660>  -> OK        1<U+0660>:3<U+0660> -> OK
     10:30:3<U+0660> -> OK      2<U+0660>:30 (hour 20) -> OK
     1<U+FF10>:30 (FULLWIDTH ZERO -> hour 10) -> OK
     1<U+0967>:30 (DEVANAGARI ONE -> hour 11) -> OK
ERR line 547 "Invalid number of hours ({} ...)":  24:00  25:00  29:59
     2<U+0664>:30 (ARABIC-INDIC FOUR -> hour 24) -> line 547
ERR line 514 "Invalid time format ...":
     30:00  10:60  1:30  ":30"  ""  10:30:60  abc  0:00  000:00  20:99
     "10:30 " (trailing space)  " 10:30" (leading space)  "10:30:"  "10:30:00:00"
     2a:30  22:3a  22:30:3a  <U+0660><U+0661>:...(Nd in the [0-2] slot fails)  "10<U+FF1A>30" (fullwidth colon)

### Error path stream behaviour (exit code 1)
stdout receives ONLY the first 5 lines (job1, 0, job2, job3, 0) and MUST be fully flushed.
stderr receives exactly:
Traceback (most recent call last):
  File "test10.py", line 21, in <module>
    job4 = schedule.every().days.at(args.a).do(lambda: None)  # \u521b\u5efa\u6bcf\u65e5\u4f5c\u4e1a
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "schedule/__init__.py", line <514|547>, in at
schedule.ScheduleValueError: <message>
[PYI-<pid>:ERROR] Failed to execute script 'test10' due to unhandled exception!
(the caret line has 11 leading spaces then 32 '^'; the [PYI-<pid>:ERROR] line is a PyInstaller
 artifact where <pid> is the process id — emit it using process.pid. Do NOT emit a JS stack trace.)

## argparse behaviour (all confirmed)
prog = basename(argv[0]) — PROVEN dynamic: copying the binary to /tmp/zz_renamed makes the usage
line read "usage: zz_renamed [-h] ...". So in JS use basename(process.argv[1]) (-> "test10.mjs").

usage line: usage: <prog> [-h] --a A --b B --c C --d D
help (stdout, exit 0), exact:
usage: <prog> [-h] --a A --b B --c C --d D

options:
  -h, --help  show this help message and exit
  --a A
  --b B
  --c C
  --d D

(NOTE "options:" — Python >=3.10 heading, not "optional arguments:". Two spaces of indent;
 "-h, --help" then two spaces before "show this help message and exit".)

errors -> stderr, exit 2, always preceded by the usage line:
  <prog>: error: the following arguments are required: --a, --b, --c, --d   (only the MISSING ones, in declaration order --a,--b,--c,--d)
  <prog>: error: unrecognized arguments: --e 4                             (leftover tokens joined by a single space, original order)
  <prog>: error: argument --a: expected one argument                       (option present with no value)
Confirmed cases:
  (no args)                        -> required: --a, --b, --c, --d
  --b 1 --c 2 --d 3                -> required: --a
  --a 10:30 --b 1 --c 2            -> required: --d
  -a 10:30 -b 1 -c 2 -d 3          -> required: --a, --b, --c, --d   (single-dash forms are NOT recognized;
                                      the required-args error takes PRECEDENCE over unrecognized-arguments)
  --a 10:30 --b 1 --c 2 --d 3 --e 4-> unrecognized arguments: --e 4
  --a 10:30 --b 1 --c 2 --d 3 extra-> unrecognized arguments: extra
  --ab 1 --a 10:30 --b 1 --c 2 --d 3 -> unrecognized arguments: --ab 1
  --a                              -> argument --a: expected one argument
  --a -- --b 1 --c 2 --d 3         -> argument --a: expected one argument
  --a=10:30 --b=1 --c=2 --d=3      -> happy path (= form works)
  --a= --b 1 --c 2 --d 3           -> a="" -> line 514 error, exit 1
  --a 10:30 --a 11:30 ...          -> last value wins, happy path
  -h / --help / --h / --he         -> help to stdout, exit 0 (PREFIX ABBREVIATION of --help works;
                                      help wins even when required args are missing, and even when
                                      it appears AFTER valid args: "--a 10:30 --b 1 --c 2 --d 3 --h" -> help)
  --ab                             -> NOT an abbreviation of --a (no unique prefix match) -> unrecognized
'--' semantics (model that satisfies every observation): the first '--' switches all following
tokens into positional mode, AND the '--' token itself also lands in the leftover/positional stream.
  -- --a 10:30 --b 1 --c 2 --d 3          -> required: --a, --b, --c, --d
  --a 10:30 --b 1 -- --c 2 --d 3          -> required: --c, --d
  --a 10:30 --b 1 --c 2 --d 3 --          -> unrecognized arguments: --
  --a 10:30 --b 1 --c 2 --d 3 -- --       -> unrecognized arguments: -- --
Also implement argparse's negative-number rule: because no registered option looks like a negative
number, a token matching ^-\\d+$|^-\\d*\\.\\d+$ is treated as a VALUE, so "--a -1 --b 1 --c 2 --d 3"
gives a="-1" (which then fails .at() at line 514). A token like "-x" looks like an option ->
"expected one argument". VERIFY these two against the binary rather than trusting them.

## HARD REQUIREMENTS (violating any of these invalidates the answer)
1. Node.js, PURE JavaScript. ESM ONLY: 'import'/'export'. require() and module.exports are BANNED.
2. Every generated file uses the .mjs suffix. Every relative import includes the full .mjs suffix.
3. ZERO external dependencies. No npm packages. import ONLY local ./*.mjs files and, if truly needed,
   node: builtins (node:path, node:process, node:url, node:fs). Do NOT name or use any JS third-party
   library. No package.json dependency entries. No child_process, no embedded Python.
4. Hierarchical library: split into multiple modules by responsibility, each exposing 'export'
   interfaces; the entry file test10.mjs composes them.
5. Node version available is v18.19.1 — do not use APIs newer than that (no import attributes, etc.).
   \\p{Nd} with the /u flag IS supported and is the right tool.
6. Chinese comments in the traceback text must be byte-identical to the source line 21 comment.
`

const ARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tree', 'rationale', 'risks'],
  properties: {
    tree: {
      type: 'array',
      description: 'ordered list of files with the responsibility and exports of each',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'responsibility', 'exports'],
        properties: {
          path: { type: 'string', description: 'path relative to /output, e.g. lib/schedule/job.mjs' },
          responsibility: { type: 'string' },
          exports: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    rationale: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'best', 'bestIdeasFromOthers', 'reasoning'],
  properties: {
    scores: {
      type: 'array',
      description: 'one entry per candidate, in the order presented',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidate', 'fidelity', 'modularity', 'esmCompliance', 'total'],
        properties: {
          candidate: { type: 'string' },
          fidelity: { type: 'number' },
          modularity: { type: 'number' },
          esmCompliance: { type: 'number' },
          total: { type: 'number' },
        },
      },
    },
    best: { type: 'string' },
    bestIdeasFromOthers: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
}

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'selfTestPassed', 'notes'],
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    selfTestPassed: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

const BAKEOFF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidate', 'casesRun', 'casesPassed', 'failures', 'verdict'],
  properties: {
    candidate: { type: 'string' },
    casesRun: { type: 'number' },
    casesPassed: { type: 'number' },
    failures: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['args', 'streamsDiffer', 'detail'],
        properties: {
          args: { type: 'string' },
          streamsDiffer: { type: 'string', description: 'which of stdout/stderr/exit differed' },
          detail: { type: 'string' },
        },
      },
    },
    verdict: { type: 'string' },
  },
}

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
        required: ['id', 'file', 'severity', 'summary', 'failureScenario', 'suggestedFix'],
        properties: {
          id: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          summary: { type: 'string' },
          failureScenario: { type: 'string', description: 'concrete argv -> observed vs expected' },
          suggestedFix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'real', 'confidence', 'evidence'],
  properties: {
    id: { type: 'string' },
    real: { type: 'boolean' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    evidence: { type: 'string', description: 'the exact command run and its output proving/refuting' },
  },
}

const COMMON = `${SPEC}

## Tooling available to you
- Run the reference implementation: ${EXE} --a <val> --b 1 --c 2 --d 3   (NEVER use the 'python' command)
- Run node: node <file.mjs> --a <val> --b 1 --c 2 --d 3   (node v18.19.1)
- Compare rigorously, capturing the three streams separately, e.g.:
    ${EXE} --a 10:30 --b 1 --c 2 --d 3 >/tmp/p.out 2>/tmp/p.err; pe=$?
    node /output/test10.mjs --a 10:30 --b 1 --c 2 --d 3 >/tmp/j.out 2>/tmp/j.err; je=$?
    diff /tmp/p.out /tmp/j.out && echo STDOUT_OK ; [ $pe -eq $je ] && echo EXIT_OK
  Use 'diff' / 'cmp -l' / 'od -c' for byte-exactness — never eyeball it.
- When comparing stderr, remember the PYI pid and the prog name legitimately differ; normalise
  those two things (sed) and require everything else to match byte-for-byte.
`

// ---------------------------------------------------------------- Phase 1: Spec
phase('Spec')

const specProbes = [
  {
    key: 'argparse',
    prompt: `You are confirming and EXTENDING the argparse half of a black-box spec.

${COMMON}

Your job: probe ${EXE} to (a) confirm the argparse claims above and (b) find any argparse
behaviour NOT yet documented that a faithful reimplementation would get wrong.

Explore at least: option abbreviation edge cases (--a vs --ab vs --h vs --he vs --hel), '='-form
with empty and with embedded '=' (--a=10:30=x), repeated options, interleaved unknown options,
'--' in many positions, tokens that look like negative numbers (--a -1, --a -1.5, --a -x, --a -),
a lone '-', args containing spaces/newlines/unicode, the precedence order between the three error
kinds (required vs unrecognized vs expected-one-argument), whether help exits 0 even when combined
with unknown options (--h --zzz), and exact exit codes.

Report ONLY things that would change an implementation: corrections to the spec above, plus newly
discovered rules with the exact command and exact observed output for each. Be concrete and terse.
Return your findings as plain text.`,
  },
  {
    key: 'schedule',
    prompt: `You are confirming and EXTENDING the 'schedule' library half of a black-box spec.

${COMMON}

Your job: probe ${EXE} to (a) confirm the .at() / Job.__str__ / scheduler-counting claims above and
(b) pin down the exact boundary of the daily time-string grammar and the int() digit parsing.

Explore at least: every boundary of ^[0-2]\\d:[0-5]\\d(:[0-5]\\d)?$; which hour values trip line 547
vs line 514; MANY Unicode Decimal_Number digits in each of the four \\d slots (Arabic-Indic U+0660-0669,
Extended Arabic-Indic U+06F0-06F9, Devanagari U+0966-096F, Fullwidth U+FF10-FF19, Thai U+0E50-0E59,
Bengali U+09E6-09EF, and the Mathematical digits U+1D7CE-1D7FF which form a 50-codepoint contiguous
Nd run made of five 10-codepoint blocks); non-Nd digit-like chars that Python's \\d must REJECT
(superscript U+00B9, circled U+2460, Roman numeral U+2160, fraction U+00BD — these are No/Nl, not Nd);
whether the hour-range message really contains a literal '{}'; and confirm stdout is byte-identical
across repeated runs and across different TZ values (try TZ=UTC and TZ=Asia/Tokyo) — this proves
__str__ carries no timestamp.

Also determine whether ANY --a value can make the program print something other than the fixed
8-line happy-path stdout or the fixed 5-line truncated stdout.

Report ONLY things that would change an implementation, with exact commands and exact observed
output. Include a definitive list of which Unicode digit families are accepted and which are not.
Return your findings as plain text.`,
  },
]

const specFindings = await parallel(specProbes.map(p => () =>
  agent(p.prompt, { label: `spec:${p.key}`, phase: 'Spec' })))

const specText = specProbes
  .map((p, i) => `### Confirmed/extended spec — ${p.key}\n${specFindings[i] || '(probe produced no output)'}`)
  .join('\n\n')

log('Spec confirmation complete; moving to architecture design')

// ------------------------------------------------------------- Phase 2: Design
phase('Design')

const ANGLES = [
  {
    key: 'faithful-port',
    lens: `Mirror the Python packages structurally: an argparse-shaped module family and a
schedule-shaped module family, each mimicking the real library's class layout (ArgumentParser /
HelpFormatter / actions; Scheduler / Job / errors). Favour recognisability for a reviewer who knows
both libraries.`,
  },
  {
    key: 'layered-seams',
    lens: `Organise by layer rather than by source library: a Python-runtime-semantics layer
(python int()/str-repr/print/stdout-flush/regex-\\d compatibility helpers), a domain layer
(scheduler + job), a CLI layer (parser + help formatter), and a thin composition entry. Favour
putting every cross-language trap behind one well-named seam.`,
  },
  {
    key: 'minimal-surface',
    lens: `Smallest correct hierarchy that still genuinely separates concerns — resist inventing
modules that exist only to look modular, but do NOT collapse into one file. Favour a tree where
every module has a real, testable reason to exist and the whole thing is easy to audit for the
zero-dependency and ESM-suffix rules.`,
  },
]

const proposals = await parallel(ANGLES.map(a => () =>
  agent(`Design the file hierarchy for a zero-dependency ESM Node.js port of /workspace/dataset/test10.py.

${COMMON}

${specText}

## Your assigned design lens
${a.lens}

Read /workspace/dataset/test10.py first. Then propose the concrete file tree under /output
(entry MUST be /output/test10.mjs). For each file give its exact relative path, its single
responsibility, and its named exports. Aim for roughly 6-11 files: enough to be genuinely
hierarchical, not so many that it is padding.

Your tree MUST have a home for every one of these concerns:
 - Python-compatible Unicode-Nd \\d regex + Python int() digit-value parsing
 - Python str()/repr() rendering of the Job line (tuple "()" and dict "{}" reprs)
 - the ScheduleValueError family and the exact traceback rendering (incl. the [PYI-<pid>:ERROR] line)
 - Job (units, at(), do(), toString) and Scheduler (every/cancel_job/clear/get_jobs) separately
 - the module-level default-scheduler facade that mirrors 'import schedule'
 - argparse: option-table + abbreviation resolution, tokenizing/'--'/negative-number rule,
   usage+help formatting, and the three error messages
 - stdout/stderr writing that CANNOT truncate when the process exits non-zero

Do NOT write any files. Design only.`, { label: `design:${a.key}`, phase: 'Design', schema: ARCH_SCHEMA })))

const liveProposals = proposals.map((p, i) => ({ p, key: ANGLES[i].key })).filter(x => x.p)
const proposalText = liveProposals
  .map(x => `### Candidate "${x.key}"\nrationale: ${x.p.rationale}\nrisks: ${(x.p.risks || []).join('; ')}\ntree:\n` +
    x.p.tree.map(f => `  - ${f.path} :: ${f.responsibility} :: exports ${(f.exports || []).join(', ')}`).join('\n'))
  .join('\n\n')

const judgeLenses = [
  'behavioural fidelity: which tree makes it hardest to accidentally diverge from the reference binary, especially on the Unicode-\\d, literal-"{}", and stream-flush traps',
  'auditability against the hard requirements: ESM-only, .mjs suffixes on every import, zero external deps, genuine functional decomposition',
  'maintainability and altitude: are the module boundaries real seams or decorative? is anything missing a home? is anything over-split?',
]

const judgements = await parallel(judgeLenses.map((lens, i) => () =>
  agent(`Score these competing architectures for the Python-to-Node port.

${COMMON}

## Candidate architectures
${proposalText}

## Your judging lens (weight this above all else)
${lens}

Score each candidate 0-10 on fidelity, modularity, and esmCompliance, plus a total. Name the single
best candidate, and list the specific ideas from the runners-up that the winner should absorb.`,
    { label: `judge:${i + 1}`, phase: 'Design', schema: JUDGE_SCHEMA })))

const liveJudgements = judgements.filter(Boolean)
const tally = {}
for (const j of liveJudgements) {
  for (const s of j.scores || []) tally[s.candidate] = (tally[s.candidate] || 0) + (s.total || 0)
  if (j.best) tally[j.best] = (tally[j.best] || 0) + 5
}
const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1])
log(`Design ranking: ${ranked.map(([k, v]) => `${k}=${v}`).join(', ') || 'no scores returned'}`)

const contract = await agent(`Synthesize the FINAL, binding module contract for this port.

${COMMON}

${specText}

## Candidate architectures
${proposalText}

## Judge panel results
${liveJudgements.map((j, i) => `Judge ${i + 1}: best="${j.best}"; reasoning: ${j.reasoning}; graft: ${(j.bestIdeasFromOthers || []).join('; ')}`).join('\n')}
Weighted ranking: ${ranked.map(([k, v]) => `${k}=${v}`).join(', ')}

Produce the winning tree, absorbing the best grafted ideas. Output a precise specification that two
independent engineers could each implement WITHOUT talking to each other and arrive at
interchangeable results: for every file, its exact relative path (entry = test10.mjs), its exact
named exports with signatures, and which other files it imports. Then state the exact算法 for the
three cross-language traps (Unicode-Nd regex, Python int() digit values, non-truncating stream
writes on non-zero exit).

Output plain text. Do not write any files.`, { label: 'design:contract', phase: 'Design' })

log('Module contract locked; building two independent candidates')

// -------------------------------------------------------------- Phase 3: Build
phase('Build')

const CANDIDATE_DIRS = ['/tmp/cand-a', '/tmp/cand-b']

const buildPrompt = (dir, tag, extraEmphasis) => `Implement the full port into ${dir}.

${COMMON}

${specText}

## BINDING MODULE CONTRACT (follow it)
${contract}

## Instructions
1. Read /workspace/dataset/test10.py.
2. mkdir -p ${dir} and write the complete tree there, with ${dir}/test10.mjs as the entry.
   Use the contract's paths verbatim, but relative to ${dir} instead of /output.
3. ${extraEmphasis}
4. SELF-TEST EXHAUSTIVELY before you finish. Write a throwaway comparison script in /tmp (NOT inside
   ${dir}) that runs both ${EXE} and 'node ${dir}/test10.mjs' over a large argv matrix and diffs
   stdout, stderr (normalising only the prog name and the PYI pid) and exit code. Your matrix must
   include: the happy path; --a values 10:30 10:30:45 00:00 23:59 23:59:59 09:05 24:00 25:00 29:59
   30:00 10:60 1:30 0:00 000:00 ":30" "" abc 10:30:60 "10:30 " " 10:30" 10:30: 2a:30 22:3a
   10:30:00:00; Unicode-Nd cases in all four digit slots across several digit families; non-Nd
   digit-lookalikes that must be REJECTED; every argparse case in the spec (missing each subset of
   required args, unrecognized options and positionals, single-dash forms, '=' form, empty '=' form,
   repeated options, -h/--help/--h/--he, '--' in leading/middle/trailing/doubled positions,
   negative-number-looking values, missing option value).
   Iterate until your matrix is 100% clean. Do not report success unless it actually is.
5. Verify compliance by grepping your own output: no 'require(', no 'module.exports', no
   'from "' / "from '" import that is not './'-relative-with-.mjs or a 'node:' builtin, and every
   file ends in .mjs. Confirm 'node --input-type=module' is not needed (the .mjs suffix handles it).

Return the list of files you wrote (paths relative to ${dir}), whether the self-test matrix passed
100%, and any notes on judgement calls you made.`

const builds = await parallel([
  () => agent(buildPrompt(CANDIDATE_DIRS[0], 'A',
    `Emphasis for your build: be maximally paranoid about BYTE-EXACTNESS of stdout and about the
     stream-flush requirement on the exit-1 path (a naive process.exit() after console.log can
     truncate piped stdout — prove yours does not by piping through 'cat' and through a pipe to
     'wc -c'). Prefer setting process.exitCode over calling process.exit().`),
    { label: 'build:A', phase: 'Build', schema: BUILD_SCHEMA }),
  () => agent(buildPrompt(CANDIDATE_DIRS[1], 'B',
    `Emphasis for your build: be maximally paranoid about the argparse surface — abbreviation
     resolution, the precedence order of the three error kinds, the '--' model, and the
     negative-number rule. Prove each argparse case in the spec against the binary individually.`),
    { label: 'build:B', phase: 'Build', schema: BUILD_SCHEMA }),
])

log(`Candidate builds: ${builds.map((b, i) => `${CANDIDATE_DIRS[i]}=${b ? (b.selfTestPassed ? 'self-test PASS' : 'self-test FAIL') : 'DIED'}`).join(', ')}`)

// ------------------------------------------------------------ Phase 4: Bakeoff
phase('Bakeoff')

const bakeoffs = await parallel(CANDIDATE_DIRS.map((dir, i) => () =>
  builds[i] ? agent(`Adversarially differential-test candidate ${dir} against the reference binary.

${COMMON}

You did NOT write this code. Your job is to BREAK it. Assume it is wrong until proven otherwise.

Run 'node ${dir}/test10.mjs' against ${EXE} over an aggressive argv matrix and report every
divergence in stdout, stderr, or exit code. Normalise ONLY the prog name and the PYI pid; everything
else must match byte-for-byte (use cmp/od, not eyeballing).

Cover at minimum every case listed in the spec, and then go hunting beyond it: exotic Unicode digit
families in each of the four digit slots, digit-lookalike characters that must be rejected,
combining marks, embedded newlines/tabs/NULs in --a, very long --a values, '--a=' with embedded '=',
argv orderings the author probably did not try, help mixed with errors, '--' doubled and tripled,
and piping stdout to a slow/closed consumer to expose flush truncation
(e.g. 'node ${dir}/test10.mjs --a bad --b 1 --c 2 --d 3 | wc -c' and '| head -1').
Also confirm repeated runs are byte-identical and that TZ does not change stdout.

If a divergence is only the prog name or the PYI pid, that is NOT a failure — do not report it.
Report casesRun, casesPassed, and each real failure with the exact args and the exact diff.`,
    { label: `bakeoff:${dir.slice(-1).toUpperCase()}`, phase: 'Bakeoff', schema: BAKEOFF_SCHEMA })
  : null))

const scored = bakeoffs.map((b, i) => ({ b, dir: CANDIDATE_DIRS[i] })).filter(x => x.b)
for (const s of scored) log(`${s.dir}: ${s.b.casesPassed}/${s.b.casesRun} passed, ${(s.b.failures || []).length} failures`)

const rate = s => (s.b.casesRun > 0 ? s.b.casesPassed / s.b.casesRun : 0)
const winner = scored.length
  ? scored.slice().sort((x, y) => {
      const fx = (x.b.failures || []).length, fy = (y.b.failures || []).length
      if (fx !== fy) return fx - fy
      const rx = rate(x), ry = rate(y)
      if (rx !== ry) return ry - rx
      return y.b.casesRun - x.b.casesRun
    })[0]
  : null

if (!winner) {
  log('WARNING: no candidate survived the bakeoff; promoting candidate A blindly for the review phase to repair')
}
const winnerDir = winner ? winner.dir : CANDIDATE_DIRS[0]
const loserDir = CANDIDATE_DIRS.find(d => d !== winnerDir)
log(`Bakeoff winner: ${winnerDir}`)

const allBakeoffFailures = scored.flatMap(s => (s.b.failures || []).map(f => `[${s.dir}] args=${f.args} (${f.streamsDiffer}): ${f.detail}`))

// ------------------------------------------------------------ Phase 5: Promote
phase('Promote')

const promote = await agent(`Install the winning candidate into /output as the deliverable.

${COMMON}

Winning candidate directory: ${winnerDir}
Losing candidate directory (for reference only, and it must NOT leak into /output): ${loserDir}

Steps:
1. Copy the entire tree from ${winnerDir} into /output, preserving the internal directory layout,
   so the entry point lands at exactly /output/test10.mjs.
2. /output must contain ONLY the deliverable: the entry file plus the library tree. No candidate
   subdirectories, no /tmp test harnesses, no scratch files, no node_modules, no package-lock.
   A package.json is NOT required (the .mjs suffix already selects ESM); if one exists it must have
   an empty/absent "dependencies". Remove anything that is not part of the deliverable.
3. Fix up nothing else — but DO confirm every relative import still resolves after the move
   (run the happy path from several different working directories, e.g. cd / && node /output/test10.mjs
   --a 10:30 --b 1 --c 2 --d 3, and cd /output && node test10.mjs --a 10:30 --b 1 --c 2 --d 3;
   both must produce identical byte output).
4. Repair anything the bakeoff flagged for the WINNING candidate, listed here:
${(winner ? (winner.b.failures || []).map(f => `   - args=${f.args} (${f.streamsDiffer}): ${f.detail} | fix: adapt as needed`).join('\n') : '   (none available)') || '   (none)'}
   Also consider whether these divergences found in the OTHER candidate apply to this one too, and
   pre-emptively check each against /output:
${allBakeoffFailures.map(f => `   - ${f}`).join('\n') || '   (none)'}
5. Re-run the happy path and at least 20 spec cases against ${EXE} to confirm /output is clean.

Return a plain-text summary: the final /output file listing (with line counts) and the test result.`,
  { label: 'promote', phase: 'Promote' })

log('Promoted to /output; entering review/verify/fix loop')

// ------------------------- Phases 6-8: lens-diverse review, adversarial verify, fix (loop till dry)
const REVIEW_LENSES = [
  {
    key: 'requirements-compliance',
    prompt: `Audit /output ONLY for compliance with the HARD REQUIREMENTS: ESM-only (no require(, no
module.exports, no __dirname/__filename without fileURLToPath), every file .mjs, every relative
import carrying the .mjs suffix and resolving, ZERO external dependencies (no npm package imported
or even mentioned; only './'-relative files and node: builtins), no child_process/embedded Python,
no APIs newer than Node 18.19.1, and a genuinely hierarchical multi-module library with real
'export' interfaces rather than one monolith. Grep for violations; do not take comments on trust.
Also verify /output contains no scratch/candidate/test files that are not part of the deliverable.`,
  },
  {
    key: 'stdout-byte-exactness',
    prompt: `Audit /output ONLY for byte-exactness of stdout versus ${EXE}. Verify the 8-line happy
path and the 5-line truncated error path with 'cmp' and 'od -c'. Hunt specifically for: a missing or
extra trailing newline, CRLF, the Job line's spacing/commas, "<lambda>", "()" and "{}" reprs, and
stdout truncation when the process exits non-zero or when stdout is a pipe rather than a tty
(test '| cat', '| wc -c', '| head -1', and redirect to a file). Prove flush safety, do not assume it.`,
  },
  {
    key: 'at-grammar-and-unicode',
    prompt: `Audit /output ONLY for the .at() daily-time grammar and Python int() digit semantics.
Confirm the JS regex is equivalent to Python's ^[0-2]\\d:[0-5]\\d(:[0-5]\\d)?$ under Python's
Unicode-Nd \\d, including that [0-2]/[0-5] stay ASCII-only. Attack the Nd digit-value parser with
many digit families, and especially with the Mathematical digits U+1D7CE-1D7FF, which form a single
50-codepoint contiguous Nd run of five 10-wide blocks — a "scan back to the start of the contiguous
Nd run" implementation gets those wrong unless it takes the offset modulo 10. Also confirm surrogate
pairs / astral digits are handled by code point and not by UTF-16 unit, that No/Nl lookalikes
(U+00B9, U+2460, U+2160, U+00BD) are REJECTED, and that the hour range check and the literal '{}'
in the hours message are exact. Verify each claim against the binary.`,
  },
  {
    key: 'argparse-fidelity',
    prompt: `Audit /output ONLY for argparse fidelity. Verify against ${EXE}: the usage line, the
help text byte-for-byte (including the "options:" heading and every space of indentation), the three
error message forms, exit codes 0/1/2, which stream each goes to, the PRECEDENCE between required /
unrecognized / expected-one-argument, prefix abbreviation (--h, --he, --hel, and that --ab is not an
abbreviation of --a), the '=' form including '--a=' and '--a=x=y', repeated options, the '--' model
in every position including doubled, the negative-number rule, and dynamic prog derivation from
basename(argv[1]). Attack orderings the author likely missed.`,
  },
  {
    key: 'scheduler-semantics',
    prompt: `Audit /output ONLY for scheduler/Job semantics. Confirm registration happens on .do()
and not earlier (so the printed counts are 0, 0, 2), that cancel_job/clear/get_jobs behave like the
Python originals, that Job.toString mirrors Python's __str__ (and that nothing accidentally emits
__repr__-style "(last run: ..., next run: ...)" text), that units are set by property access, and
that the default-scheduler facade is a genuine module-level singleton shared across imports. Also
check the library is honest beyond the script's happy path: singular unit aliases, unit validation,
and the ScheduleValueError family. Verify the printed counts against the binary.`,
  },
  {
    key: 'code-quality',
    prompt: `Audit /output ONLY for code quality and correctness hazards that the other reviewers
will miss: dead or duplicated code, a module that does not earn its place, an export nobody imports,
misleading names or comments, comment density that does not match the surrounding style, silent
catch blocks, mutable module-level state that could leak between imports, off-by-one in the help
formatter, and anything that would confuse a reviewer who knows Python's argparse/schedule. Do not
report style nits that have no behavioural or clarity consequence.`,
  },
]

let round = 0
let dryRounds = 0
const seen = new Set()
const confirmedAll = []

while (dryRounds < 2 && round < 4) {
  round += 1
  phase('Review')
  log(`Review round ${round}`)

  const reviewed = await parallel(REVIEW_LENSES.map(l => () =>
    agent(`Review the deliverable in /output. You are reviewer "${l.key}", round ${round}.

${COMMON}

${specText}

## Promotion report
${promote}

${round > 1 ? `## Findings already CONFIRMED and FIXED in earlier rounds — do not re-report these\n${confirmedAll.map(f => `- [${f.id}] ${f.file}: ${f.summary}`).join('\n')}\n` : ''}
## Your review lens — stay in it, other reviewers cover the rest
${l.prompt}

Read the files under /output and VERIFY empirically by running commands. Every finding must come
with a concrete reproducing command and the observed-vs-expected difference. Give each finding a
stable id of the form ${l.key}-<n>. Report nothing you have not actually reproduced. An empty
findings list is a perfectly good answer if the code is correct in your lens.`,
      { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA })))

  const fresh = reviewed.filter(Boolean)
    .flatMap(r => r.findings || [])
    .filter(f => {
      const k = `${f.file}::${f.summary}`.toLowerCase().replace(/\s+/g, ' ')
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

  log(`Round ${round}: ${fresh.length} fresh findings`)
  if (!fresh.length) { dryRounds += 1; continue }
  dryRounds = 0

  phase('Verify')
  const verdicts = await parallel(fresh.map(f => () =>
    parallel(['reproduce it exactly as described and check the claim is literally true',
              'check whether the reference binary actually behaves the way the finding assumes — the finding may be measuring against a wrong expectation',
              'check whether the suggested fix would break some OTHER confirmed spec case (regression risk)']
      .map(angle => () => agent(`Try to REFUTE this code-review finding about /output.

${COMMON}

## Finding ${f.id} (${f.severity}) in ${f.file}${f.line ? `:${f.line}` : ''}
summary: ${f.summary}
failure scenario: ${f.failureScenario}
suggested fix: ${f.suggestedFix}

## Your refutation angle
${angle}

Default to real=false if you cannot reproduce a genuine divergence from ${EXE} or a genuine
violation of the hard requirements. Run actual commands; paste the exact command and output as your
evidence. Note: prog-name and PYI-pid differences are NOT defects. Set id to "${f.id}".`,
        { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA })))
      .then(vs => {
        const live = vs.filter(Boolean)
        const yes = live.filter(v => v.real).length
        return { f, real: live.length > 0 && yes * 2 > live.length, votes: `${yes}/${live.length}`, evidence: live.map(v => v.evidence).join(' | ') }
      })))

  const confirmed = verdicts.filter(Boolean).filter(v => v.real)
  const rejected = verdicts.filter(Boolean).filter(v => !v.real)
  log(`Round ${round}: ${confirmed.length} confirmed, ${rejected.length} refuted`)
  for (const r of rejected) log(`  refuted ${r.f.id} (${r.votes}): ${r.f.summary}`)

  if (!confirmed.length) { dryRounds += 1; continue }

  confirmedAll.push(...confirmed.map(c => c.f))

  phase('Fix')
  const fixReport = await agent(`Apply these CONFIRMED findings to the deliverable in /output.

${COMMON}

${specText}

## Confirmed findings (each was independently reproduced by a majority of refutation attempts)
${confirmed.map(c => `### ${c.f.id} (${c.f.severity}) — ${c.f.file}${c.f.line ? `:${c.f.line}` : ''}
summary: ${c.f.summary}
failure scenario: ${c.f.failureScenario}
suggested fix: ${c.f.suggestedFix}
verifier evidence: ${c.evidence}`).join('\n\n')}

Fix every one of them in /output. Keep the hierarchical ESM structure, the .mjs suffixes, and zero
external dependencies. The suggested fixes are advisory — implement the correct fix, not necessarily
the suggested one.

After fixing, REGRESSION-TEST: re-run a broad argv matrix (the whole spec truth table plus the
scenarios from these findings) against ${EXE} and confirm stdout/stderr/exit all match, normalising
only prog name and PYI pid. Report what you changed per finding and the regression-test result.
If a fix cannot be made without breaking another confirmed case, say so explicitly rather than
papering over it.`, { label: `fix:round${round}`, phase: 'Fix' })

  log(`Round ${round} fixes applied`)
  if (round >= 4) log('Reached round cap; proceeding to final verification')
  void fixReport
}

// -------------------------------------------------------------- Phase 9: Final
phase('Final')

const finalChecks = await parallel([
  () => agent(`FINAL exhaustive differential verification of /output vs ${EXE}.

${COMMON}

${specText}

Build a comprehensive argv matrix (aim for 120+ distinct cases) covering the complete spec truth
table, the full argparse surface, and wide Unicode-Nd coverage, plus stdout-piping variants. For
every case compare stdout bytes, stderr (prog name and PYI pid normalised) and exit code.

Report the total case count, the pass count, and every remaining divergence with exact args and
exact diff. Be honest — do not round up. If everything passes, say so plainly and show the command
you used so it can be re-run.`, { label: 'final:differential', phase: 'Final', schema: BAKEOFF_SCHEMA }),

  () => agent(`FINAL compliance gate on /output.

${COMMON}

Mechanically verify and report PASS/FAIL for each, with the command you ran:
1. Every file under /output ends in .mjs (list any that do not, and justify only package.json).
2. No occurrence of 'require(' or 'module.exports' anywhere.
3. Every 'import ... from X': X is either './'- or '../'-relative AND ends in .mjs, or is a 'node:'
   builtin. List every distinct X found. Flag ANY bare specifier (that would be an npm dependency).
4. No 'child_process', no 'eval(', no spawning python, no network access.
5. Entry is exactly /output/test10.mjs and it runs from any cwd.
6. The library is split across multiple modules, each using 'export'; report the file tree with line
   counts and a one-line responsibility for each so a human can see the hierarchy.
7. /output contains no scratch, candidate, backup, or test-harness files.
8. Node 18.19.1 compatibility: nothing requiring a newer runtime.

Return a plain-text report. Any FAIL must name the exact file and line.`, { label: 'final:compliance', phase: 'Final' }),

  () => agent(`FINAL completeness critic for the /output deliverable.

${COMMON}

${specText}

Your job is to find what everyone else MISSED. Ask: which behaviour of the original program has
never actually been executed against /output? Which hard requirement was asserted but never
mechanically checked? Which cross-language trap in the spec has no corresponding test? Is there an
argv shape nobody tried? Is there a Unicode digit family nobody tried? Did anyone check the program
under 'set -o pipefail', with stdout closed, with a huge argv, with LANG/LC_ALL unset, with TZ set
to something exotic?

Actually run the gaps you identify. Report only gaps that you closed and what the result was,
plus any gap you could not close and why. Be specific and terse.`, { label: 'final:completeness', phase: 'Final' }),
])

const [diffFinal, complianceFinal, completenessFinal] = finalChecks

return {
  bakeoffWinner: winnerDir,
  reviewRounds: round,
  confirmedAndFixed: confirmedAll.map(f => ({ id: f.id, file: f.file, severity: f.severity, summary: f.summary })),
  finalDifferential: diffFinal || 'differential agent died',
  finalCompliance: complianceFinal || 'compliance agent died',
  finalCompleteness: completenessFinal || 'completeness agent died',
}
