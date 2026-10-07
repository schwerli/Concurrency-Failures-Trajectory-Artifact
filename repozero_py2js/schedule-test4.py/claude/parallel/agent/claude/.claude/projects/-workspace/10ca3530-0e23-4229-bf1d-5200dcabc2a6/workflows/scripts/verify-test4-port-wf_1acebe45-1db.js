export const meta = {
  name: 'verify-test4-port',
  description: 'Exhaustively differential-test and adversarially review the Node port of test4.py',
  phases: [
    { title: 'Attack', detail: 'independent lenses hunting for divergences' },
    { title: 'Verify', detail: 'confirm each reported divergence reproduces' },
    { title: 'Audit', detail: 'requirements compliance and completeness critic' },
  ],
}

const EXE = '/workspace/dataset/test4_executable'
const JS = '/output/test4.mjs'

const COMMON = `
GROUND TRUTH: the PyInstaller-compiled Python program ${EXE}, built from:

    import argparse, schedule
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    parser.add_argument('--b', type=str, required=True)
    parser.add_argument('--c', type=str, required=True)
    args = parser.parse_args()
    job = schedule.every().monday.at(args.a)   # line 10
    print(job)

UNDER TEST: a zero-dependency Node.js ESM port at ${JS} (library modules under /output/lib/).

Run BOTH and compare. Compare stdout BYTE FOR BYTE and exit codes EXACTLY.
Two things legitimately differ and must be normalized before comparing, never reported as bugs:
  1. the argparse prog name: 'test4_executable' vs 'test4.mjs' (both derive it from argv[0]/argv[1]
     basename). To compare width-sensitive output apples-to-apples, copy the reference to a file
     literally named test4.mjs (cp ${EXE} /tmp/yourdir/test4.mjs) and run that copy — then the prog
     names match and no normalization is needed.
  2. the '[PYI-<n>:ERROR]' number, which is the process id and differs on every run of the reference too.

A ready-made harness exists: node /tmp/diff.mjs '<json array of argv arrays>' <cwd>
It prints "pass N/M" and details each failure. You may use it, extend it, or write your own.
Do NOT edit anything under /output — you are testing, not fixing. Do NOT use the 'python' command.

ALREADY-VERIFIED behaviour (do not re-report as findings; use as background):
- success prints exactly "Job(interval=1, unit=weeks, do=None, args=(), kwargs={})\\n", exit 0
- invalid time format -> ScheduleValueError "Invalid time format for a daily job (valid format is HH:MM(:SS)?)", schedule/__init__.py line 514, exit 1
- hour outside 0..23 -> ScheduleValueError "Invalid number of hours ({} is not between 0 and 23)" with LITERAL braces, line 547, exit 1
- accept rule behaves like Python re.match(r'^[0-2]\\d:[0-5]\\d(:[0-5]\\d)?$') where \\d is any Unicode Nd digit and $ tolerates ONE trailing newline
- the traceback echoes source line 10 ONLY when a readable ./test4.py exists in the CURRENT DIRECTORY (linecache), with '^' anchors derived from byte columns 6..40 measured in display columns
- --help/-h exit 0 and print to stdout; argparse failures exit 2 and print to stderr
- 57 hand-written argv cases and a COLUMNS sweep from 4..500 already match

YOUR JOB is to find cases where the port and the reference STILL diverge. Be relentless and
concrete. Report every genuine divergence with the exact argv, cwd, env, and both outputs.
If you find none in your area, say so explicitly and list what you covered.
`

const FINDINGS = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    casesRun: { type: 'integer', description: 'how many distinct invocations you compared' },
    coverage: { type: 'array', items: { type: 'string' }, description: 'what you actually exercised' },
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          argv: { type: 'string', description: 'exact argv, shell-quoted or JSON' },
          cwd: { type: 'string' },
          env: { type: 'string' },
          referenceBehaviour: { type: 'string' },
          portBehaviour: { type: 'string' },
          severity: { type: 'string', enum: ['stdout-or-exitcode', 'stderr-only', 'cosmetic'] },
          reproCommand: { type: 'string' },
        },
        required: ['argv', 'referenceBehaviour', 'portBehaviour', 'severity', 'reproCommand'],
      },
    },
  },
  required: ['area', 'casesRun', 'coverage', 'divergences'],
}

phase('Attack')

const LENSES = [
  {
    key: 'fuzz-timestr',
    prompt: `${COMMON}
YOUR AREA: fuzz the --a time string. Generate and compare AT LEAST 400 distinct values, including:
- systematic sweeps: every "H:M", "HH:MM", "HH:MM:SS" with hours 0..30 and minutes/seconds 0..70,
  1/2/3-digit components, 1 and 4+ colon-separated components, leading zeros, leading '+'/'-'
- EVERY Unicode Nd digit: enumerate all 680 Nd code points (you can list them with a short node
  one-liner using /\\p{Nd}/u) and substitute them into EACH of the four digit positions of "HH:MM",
  checking accept/reject and WHICH error message results. Include astral-plane digits
  (mathematical bold/double-struck/sans-serif, Osmanya, segmented digits U+1FBF0..9) since those are
  surrogate pairs in JS and a naive port mishandles them.
- non-Nd numeric lookalikes: Roman numerals, superscripts (U+00B2), circled digits, U+1D7CE region
  neighbours, Nl/No category characters
- whitespace and control characters in every position; 0/1/2/3 trailing newlines; \\r, \\r\\n, \\t,
  U+2028, U+00A0, NUL bytes if you can pass them
- very long strings, strings of 10k digits, and strings containing the literal '{}'
Report any value where accept/reject, the error message, or the exit code differs.`,
  },
  {
    key: 'fuzz-argv',
    prompt: `${COMMON}
YOUR AREA: fuzz the argv SHAPE (not the time value). Compare AT LEAST 300 distinct argv vectors:
- all subsets and orderings of --a/--b/--c present/absent; duplicated options; interleaved
- '=' forms: --a=v, --a=, --a==v, --a=v=w; and '=' inside values
- abbreviations: every prefix of --help (--h, --he, --hel) and of --a/--b/--c; ambiguous prefixes
  like '--', '--=', '-', '---', '----a'
- '--' separator in every position, repeated, alone, as a value, immediately after an option
- values that look like options: -x, --x, -5, -5.5, -0, +5, '-', '- ', ' -5', '--a'
- single-dash forms -a -b -c, bundled -abc, -h combined with everything, -h after --, -h with
  invalid --a value
- unrecognized extras: positionals before/after/between options, multiple extras, extras containing
  spaces, empty-string arguments ''
- options after a successful parse, and pathological counts (100 repeated --a)
Verify the ERROR PRECEDENCE in every mixed case (missing-required vs unrecognized vs expected-one-argument).`,
  },
  {
    key: 'traceback-cwd',
    prompt: `${COMMON}
YOUR AREA: the stderr traceback, especially its dependence on the working directory.
The port implements Python's linecache lookup, so verify it thoroughly:
- run from a directory with NO test4.py; with the real test4.py; with a decoy test4.py whose line 10
  is short, empty, missing (file shorter than 10 lines), whitespace-only, indented by 1..30 spaces,
  indented with tabs, containing CJK/fullwidth/emoji characters, containing combining marks, and
  exactly equal to 'schedule.every().monday.at(args.a)' with 6 leading spaces
- a test4.py that is a directory, is unreadable (chmod 000), is a symlink, is empty, has CRLF line
  endings, has no trailing newline on line 10, is invalid UTF-8, or is a 1MB single line
- confirm the '^' anchor row's leading-space count and caret count match EXACTLY in every case, and
  that the anchor row is OMITTED under the same conditions in both
- both error paths (line 514 and line 547) and both cwd states
Compare stderr byte for byte after masking ONLY the PYI pid number. This is the highest-risk area —
be exhaustive and construct at least 25 distinct decoy files.`,
  },
  {
    key: 'help-and-width',
    prompt: `${COMMON}
YOUR AREA: --help / usage rendering and terminal width. Use a renamed copy of the reference (named
exactly test4.mjs) so prog names match, then compare BYTE FOR BYTE:
- COLUMNS from 1 to 300 for --help, for a missing-required error, and for an 'expected one argument'
  error and an 'unrecognized arguments' error
- COLUMNS set to invalid/odd values: '', '0', '-5', 'abc', '40.5', '0x28', ' 40 ', '+40', '4_0',
  a value written in Arabic-Indic digits, a huge value like 99999999
- LINES set/unset; both COLUMNS and LINES set; only LINES set
- stdout a tty vs a pipe vs /dev/null (use 'script -qc' or a pty helper if available to test tty);
  stderr redirected separately
- also verify the prog-name derivation matches: run the reference and the port through copies/symlinks
  with unusual names (spaces, unicode, very long, no extension, empty-looking) and confirm both
  derive the same displayed prog from argv basename
Report any byte difference.`,
  },
  {
    key: 'code-review',
    prompt: `${COMMON}
YOUR AREA: adversarial CODE REVIEW. Read every file under /output (test4.mjs and lib/**/*.mjs).
Do NOT just read — for each suspicion, CONSTRUCT an input that would expose it and run both programs.
Focus on Python-vs-JavaScript semantic gaps:
- Unicode Nd handling and the (cp - runStart) % 10 digit-value derivation in lib/py/digits.mjs
- the Python-'$'-tolerates-trailing-newline translation in lib/py/regex.mjs, and whether the pattern
  translator mishandles any construct it is fed
- pyInt: underscores, signs, whitespace, astral digits, huge values, precision loss past 2^53
- code-point vs UTF-16 length confusion anywhere widths or offsets are computed (pyLen, ljust,
  displayWidth, byteOffsetToCharOffset)
- the argparse port: prefix matching, negative-number matcher, nargs pattern, error precedence,
  '--' handling, Map iteration order vs Python dict order for ambiguous-option match lists
- anything that would throw an unexpected JS error (TypeError, undefined access) instead of the
  Python behaviour, and whether an unexpected throw would produce a JS stack trace on stderr
- output flushing: is stdout guaranteed flushed before the process exits, including when piped to a
  closed pipe or /dev/full, and is the exit code right in those cases?
Report only divergences you actually reproduced, each with a repro command.`,
  },
]

const attacked = await pipeline(
  LENSES,
  lens => agent(lens.prompt, { label: `attack:${lens.key}`, phase: 'Attack', schema: FINDINGS }),
  (report, lens) => {
    if (!report || !report.divergences || report.divergences.length === 0) {
      return { lens: lens.key, report, verified: [] }
    }
    // Verify each claimed divergence independently before trusting it.
    return parallel(report.divergences.map(d => () =>
      agent(
        `${COMMON}
A tester claims the port diverges from the reference. Try HARD to REFUTE this claim.

  argv: ${d.argv}
  cwd: ${d.cwd ?? '(unspecified)'}
  env: ${d.env ?? '(none)'}
  claimed reference behaviour: ${d.referenceBehaviour}
  claimed port behaviour: ${d.portBehaviour}
  repro: ${d.reproCommand}

Run both programs yourself, several times, and decide. A claim is REFUTED if the outputs actually
match, if the only difference is the prog name or the PYI pid, if the tester compared stdout against
stderr, if the shell mangled the argument (e.g. $(...) stripping trailing newlines, or an unquoted
value), or if the difference disappears once cwd/env are controlled. Default to refuted=true when
uncertain. If it is real, state precisely which of stdout / exit code / stderr differs and give the
exact bytes from each side.`,
        { label: `verify:${lens.key}`, phase: 'Verify', schema: {
          type: 'object',
          properties: {
            refuted: { type: 'boolean' },
            reasoning: { type: 'string' },
            realDifference: { type: 'string' },
            channel: { type: 'string', enum: ['stdout', 'exitcode', 'stderr', 'none'] },
          },
          required: ['refuted', 'reasoning', 'channel'],
        } },
      ).then(v => ({ lens: lens.key, claim: d, verdict: v }))
    )).then(verified => ({ lens: lens.key, report, verified: verified.filter(Boolean) }))
  },
)

const results = attacked.filter(Boolean)
const confirmed = results.flatMap(r =>
  Array.isArray(r.verified) ? r.verified.filter(v => v.verdict && v.verdict.refuted === false) : []
)
log(`attack lenses done; ${confirmed.length} confirmed divergence(s)`)

phase('Audit')

const [compliance, critic] = await parallel([
  () => agent(
    `Audit the deliverable at /output against these HARD requirements. Read the actual files.
Report PASS/FAIL per requirement with evidence (file:line where relevant).

1. Pure JavaScript for Node.js. No TypeScript.
2. ES Modules ONLY. 'import'/'export' used; 'require(' and 'module.exports' MUST NOT appear anywhere.
3. Every generated library and entry file uses the .mjs suffix.
4. All 'import' statements include the complete file suffix (e.g. './utils.mjs') and resolve to real files.
5. ZERO external dependencies: no npm packages imported. Only Node.js BUILT-IN modules are allowed,
   and they must be referenced (node:fs style is preferred). Local relative imports are allowed.
   There must be no package.json dependency on anything external, no node_modules requirement.
6. No embedded Python: no child_process spawning python, no .py files being executed, no eval of Python.
7. Libraries are split into MULTIPLE modules by functionality, each exposing interfaces via 'export'
   (i.e. genuine hierarchical organization, not one monolith).
8. Entry file is /output/test4.mjs.
9. Command-line interface matches: exactly --a, --b, --c, all type string, all required, no defaults.
10. It runs correctly from a clean state: verify 'node /output/test4.mjs --a 10:30 --b x --c y' works
    from several different working directories and with no node_modules present anywhere.
Also run a syntax check on every .mjs file (node --check works for ESM if the file has .mjs suffix).
List every file you found with a one-line description of its role, and flag any dead/unused module or
unused export, any file that is not reachable from the entry point, and any leftover scratch/test file
that should not ship.`,
    { label: 'audit:compliance', phase: 'Audit', schema: {
      type: 'object',
      properties: {
        requirements: { type: 'array', items: { type: 'object', properties: {
          id: { type: 'string' }, verdict: { type: 'string', enum: ['PASS', 'FAIL'] }, evidence: { type: 'string' },
        }, required: ['id', 'verdict', 'evidence'] } },
        files: { type: 'array', items: { type: 'string' } },
        problems: { type: 'array', items: { type: 'string' } },
      },
      required: ['requirements', 'files', 'problems'],
    } },
  ),
  () => agent(
    `${COMMON}
YOU ARE THE COMPLETENESS CRITIC. Other agents fuzzed the time string, the argv shape, the traceback,
the help/width rendering, and reviewed the code. Ask: WHAT DID EVERYONE MISS?
Think about untested modalities rather than more of the same: signals and interrupts; stdin;
extremely large argv; environment variables Python honours (PYTHONIOENCODING, PYTHONUTF8, LC_ALL,
LANG, PYTHONWARNINGS, NO_COLOR, TERM); locale-dependent formatting; running via a symlink, a relative
path, or with an unusual argv[0]; concurrent invocations; read-only or missing cwd; closed/invalid
file descriptors; output to /dev/full or a closed pipe; exit-code propagation through a shell;
whether repeated runs are deterministic; whether the current date/time can ever leak into output.
Pick the 8 most promising untested angles, actually TEST each against both programs, and report what
you found. Then state your overall confidence that the port is behaviourally equivalent for stdout
and exit code, and list any residual risk.`,
    { label: 'audit:critic', phase: 'Audit', schema: {
      type: 'object',
      properties: {
        anglesTested: { type: 'array', items: { type: 'object', properties: {
          angle: { type: 'string' }, result: { type: 'string' }, divergence: { type: 'boolean' },
        }, required: ['angle', 'result', 'divergence'] } },
        newDivergences: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'string' },
        residualRisk: { type: 'array', items: { type: 'string' } },
      },
      required: ['anglesTested', 'newDivergences', 'confidence', 'residualRisk'],
    } },
  ),
])

return {
  perLens: results.map(r => ({
    lens: r.lens,
    casesRun: r.report?.casesRun,
    coverage: r.report?.coverage,
    claimed: r.report?.divergences?.length ?? 0,
  })),
  confirmed,
  compliance,
  critic,
}
