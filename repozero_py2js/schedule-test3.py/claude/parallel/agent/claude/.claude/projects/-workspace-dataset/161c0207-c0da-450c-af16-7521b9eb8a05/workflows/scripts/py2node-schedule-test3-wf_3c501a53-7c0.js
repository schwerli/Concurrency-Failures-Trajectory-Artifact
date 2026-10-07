export const meta = {
  name: 'py2node-schedule-test3',
  description: 'Migrate /workspace/dataset/test3.py to zero-dependency Node ESM in /output, then differentially verify against the reference executable',
  phases: [
    { title: 'Implement', detail: 'parallel agents build disjoint .mjs modules from the verified spec' },
    { title: 'Integrate', detail: 'wire modules together, fix contract mismatches, smoke test' },
    { title: 'Harness', detail: 'build a byte-exact differential test harness vs the reference binary' },
    { title: 'Converge', detail: 'run harness, fix divergences, repeat until two clean rounds' },
    { title: 'Audit', detail: 'adversarial reviewers on compliance and fidelity' },
    { title: 'Verify', detail: 'refute or confirm each audit finding' },
    { title: 'Repair', detail: 'apply confirmed findings and re-verify' },
  ],
}

const SPEC = '/tmp/spec/SPEC.md'

const PREAMBLE = `
You are implementing part of a Python->Node.js migration. FIRST read the full spec at ${SPEC}
(it is authoritative and was empirically derived from the reference binary
/workspace/dataset/test3_executable, CPython 3.12). Also read /workspace/dataset/test3.py.

You may run the reference binary as many times as you like to check behaviour, e.g.
  /workspace/dataset/test3_executable --a 5 --b x
Never run python. Never install anything.

NON-NEGOTIABLE RULES for every file you write:
- ES modules only. Use \`import\` / \`export\`. The tokens \`require(\` and \`module.exports\` must NEVER
  appear in any file you write. No \`createRequire\`. No CommonJS.
- Every file uses the .mjs extension, and every relative import includes the full '.mjs' suffix.
- Zero external/npm dependencies. The ONLY bare specifiers permitted anywhere are Node builtins
  written with the \`node:\` prefix (e.g. 'node:fs'), and only where truly needed. Prefer the ambient
  globals \`process\` and \`Buffer\` over importing them.
- No child processes, no python, no eval of generated code.
- Write ONLY the files assigned to you. Other agents own the other files in parallel; if you need a
  module you do not own, import it per the contract below and TRUST that contract. Do not create,
  edit, overwrite or delete files owned by others, and do not create extra files outside your list.
- Code style: clean, commented where the CPython behaviour being mirrored is non-obvious. Cite the
  CPython concept being emulated in short comments. No dead code, no TODOs.

SHARED MODULE CONTRACT (exact export names — other agents depend on these):

/output/lib/py/errors.mjs
  export class PyException extends Error   // .constructor.name used for messages
  export class PyValueError extends PyException
  export class PyTypeError extends PyException

/output/lib/py/unicode.mjs
  export function isDecimalDigit(cp)        // /\\p{Nd}/u membership, cp = code point number
  export function decimalDigitValue(cp)     // 0..9 or null
  export function isUnicodeSpace(cp)        // Python Py_UNICODE_ISSPACE / White_Space
  export function isPrintableCodePoint(cp)  // Python str.isprintable(), per code point
  export function toCodePoints(str)         // number[]

/output/lib/py/surrogateescape.mjs
  export function decodeSurrogateescape(bytes)  // Uint8Array -> string (UTF-8, errors='surrogateescape')
  export function encodeSurrogateescape(str)    // string -> Uint8Array (inverse)

/output/lib/py/repr.mjs
  export function reprStr(s)   // Python repr() of a str
  export function pyStr(value) // Python str(): BigInt -> plain decimal, string -> itself

/output/lib/py/int.mjs
  export const DEFAULT_MAX_STR_DIGITS  // 4300
  export function pyIntFromString(s, maxStrDigits = DEFAULT_MAX_STR_DIGITS)  // -> BigInt, throws PyValueError

/output/lib/py/sys.mjs
  export function getArgv()            // user args after the script path, surrogateescape-decoded
  export function getProgName()        // basename(process.argv[1])
  export function writeStdout(s)       // byte-exact write (encodeSurrogateescape)
  export function writeStderr(s)
  export function exit(code)           // never returns
  export function getTerminalColumns() // Python shutil.get_terminal_size().columns semantics

/output/lib/py/builtins.mjs
  export function print(...values)     // sep ' ', end '\\n', via pyStr + writeStdout

/output/lib/argparse/errors.mjs
  export class ArgumentError extends Error   // constructor(action, message); .message == 'argument NAME: msg'
                                             // NAME = action.optionStrings.join('/') for optionals,
                                             // else metavar, else dest   (CPython _get_action_name)
  export class ArgumentTypeError extends Error
  export function getActionName(action)

/output/lib/argparse/types.mjs
  export function int(value)   // fn.name === 'int' mirrors Python type.__name__ in error messages
  export function str(value)   // fn.name === 'str'

/output/lib/argparse/actions.mjs
  export class Action        // fields: optionStrings, dest, nargs, constValue, defaultValue, type,
                             // choices, required, help, metavar; method call(parser, namespace, values, optionString)
  export class StoreAction extends Action
  export class HelpAction extends Action   // nargs 0; prints help to stdout and exits 0

/output/lib/argparse/formatter.mjs
  export function formatUsage({ prog, actions, width })          // 'usage: ...' , NO trailing newline
  export function formatHelp({ prog, actions, groups, width })   // full help text, ends with exactly one '\\n'
       // groups: [{ title, actions }] in order, e.g. [{title:'positional arguments',actions:[]},{title:'options',actions:[...]}]

/output/lib/argparse/parser.mjs
  export class ArgumentParser
    constructor(options = {})            // options.prog defaults to getProgName()
    addArgument(names, options = {})     // names: string | string[]; options: {type, required, help, metavar, action, nargs, dest, default}
    parseArgs(args = null)               // -> namespace object keyed by dest; errors exit(2)
    parseKnownArgs(args = null)          // -> [namespace, extras]
    error(message) / exitWith(status, message) / printUsage(toStderr) / printHelp()
    formatUsage() / formatHelp()

/output/lib/argparse/index.mjs
  export { ArgumentParser } and re-export int, str, Action classes, errors

/output/lib/schedule/job.mjs   export class Job (and IntervalError/ScheduleValueError re-used from errors)
/output/lib/schedule/scheduler.mjs  export class Scheduler
/output/lib/schedule/index.mjs
  export function every(interval = 1)
  export const defaultScheduler
  export { Job, Scheduler, CancelJob, ScheduleError, ScheduleValueError, IntervalError }

/output/test3.mjs   entry, a 1:1 transliteration of the Python.
`

phase('Implement')

const IMPL_TASKS = [
  {
    label: 'py-core',
    files: '/output/lib/py/errors.mjs, /output/lib/py/unicode.mjs, /output/lib/py/surrogateescape.mjs',
    detail: `Implement the Python primitive layer.

errors.mjs: PyException/PyValueError/PyTypeError. Each sets this.name to the Python exception name
('ValueError', 'TypeError') so messages can be shaped like CPython.

unicode.mjs:
- isDecimalDigit(cp): /\\p{Nd}/u test on String.fromCodePoint(cp).
- decimalDigitValue(cp): return 0..9 for Nd code points, else null. Algorithm (spec 3.1): try
  String.fromCodePoint(cp).normalize('NFKC'); if that is exactly one ASCII digit, return it (this
  handles fullwidth and the five back-to-back mathematical digit blocks U+1D7CE..U+1D7FF). Otherwise
  walk downwards up to 9 code points while isDecimalDigit holds to find the run start and return the
  offset. Guard the result to 0..9 and return null if anything is inconsistent. Cache results in a Map
  (a plain object/Map, no external deps).
- isUnicodeSpace(cp): Python Py_UNICODE_ISSPACE. Must be EXACTLY: 0x09-0x0D, 0x1C-0x1F, 0x20, 0x85,
  0xA0, 0x1680, 0x2000-0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000. (Note 0x1C-0x1F ARE Python
  unicode-space, but they are < 128 so int() never strips them — that asymmetry lives in int.mjs, not
  here. Document this in a comment.)
- isPrintableCodePoint(cp): false for general categories Cc, Cf, Cs, Co, Cn(Unassigned), Zl, Zp, Zs,
  EXCEPT U+0020 which is printable. Use RegExp unicode property escapes with the 'u' flag; build the
  regex once. Verify at runtime-authoring time that \\p{Unassigned} is accepted by this Node version;
  if it is not, fall back to an equivalent that still classifies unassigned code points as
  non-printable, and document it.
- toCodePoints(str): Array.from(str) mapped to codePointAt(0) — must preserve lone surrogates.

surrogateescape.mjs: hand-written UTF-8 decoder/encoder implementing Python's 'surrogateescape' error
handler. Decoding: valid UTF-8 sequences (reject overlongs, surrogate range encodings, >U+10FFFF, and
truncated sequences) decode normally; every byte that cannot start/continue a valid sequence becomes
U+DC80 + byte (bytes 0x80-0xFF) — note bytes < 0x80 are always valid so only high bytes get escaped.
Encoding: code points U+DC80..U+DCFF become their single original byte; everything else encodes as
UTF-8. Do not use TextDecoder/TextEncoder for the decode path (they are lossy: they produce U+FFFD).
Buffer/Uint8Array in, out. Be careful and exhaustive about the UTF-8 validity rules; write it as a
small explicit state machine with comments.`,
  },
  {
    label: 'py-int-repr',
    files: '/output/lib/py/repr.mjs, /output/lib/py/int.mjs',
    detail: `Implement Python repr(str) and int(str).

repr.mjs (spec 3.2): reprStr(s) — iterate by CODE POINT.
- Quote selection: use "'" unless s contains "'" and does not contain '"', in which case use '"'.
- Escape backslash first, then the active quote, then \\n \\r \\t.
- Any code point where isPrintableCodePoint is false is escaped as \\xHH (<=0xFF), \\uHHHH (<=0xFFFF),
  or \\UHHHHHHHH (8 hex digits, lowercase hex digits — verify the exact casing against the reference:
  the binary prints '\\x1f5' and '\\u200b', so lowercase hex).
- pyStr(value): BigInt -> value.toString() (plain decimal, never '5n'); string -> as-is; number ->
  integer decimal if integral. Throw PyTypeError for anything unexpected.
Cross-check reprStr against the reference binary for at least these inputs by invoking it with
--a <value>: "it's \\"q\\"", 'a\\\\b', 'a\\nb', 'a\\tb', '\\x1f5', '\\x7f', '\\xa0', '\\u200b', '🙂', '²',
a lone-surrogate case, and confirm the emitted message matches byte for byte.

int.mjs (spec 3.1): pyIntFromString(s, maxStrDigits = 4300) -> BigInt, throwing PyValueError on any
failure. Faithfully port CPython's two-stage algorithm:
 stage 1 (_PyUnicode_TransformDecimalAndSpaceToASCII): map each code point: cp < 128 -> unchanged;
   cp >= 128 && isUnicodeSpace(cp) -> ' '; cp >= 128 && decimalDigitValue(cp) !== null -> that ASCII
   digit; else -> '\\x7f' sentinel (guarantees a later parse failure).
 stage 2 (PyLong_FromString): strip ONLY [\\t\\n\\v\\f\\r ] from both ends; optional single '+'/'-';
   then digits with PEP 515 underscores — underscores must be strictly between digits; then the string
   must be exhausted (trailing whitespace already stripped). Empty digit run -> error.
 stage 3: count digit characters (excluding sign and underscores, INCLUDING leading zeros); if the
   count > maxStrDigits -> PyValueError. Verified boundary: 4300 digits OK, 4301 digits error.
 Return BigInt built from the cleaned digit string with the sign applied; -0 must become 0n.
Performance: must handle a 4300-digit input instantly, and must not blow up on a 100k-char input
(the length guard should short-circuit before any BigInt construction).
Verify your implementation against the reference for every §2 row that involves --a, plus your own
extra cases (Arabic-Indic, Devanagari, Adlam, Lepcha, Tai Laing, fullwidth, mathematical bold/mono
digits, mixed scripts, underscore placements, all the whitespace code points, 4300/4301 boundaries).`,
  },
  {
    label: 'py-sys-builtins',
    files: '/output/lib/py/sys.mjs, /output/lib/py/builtins.mjs',
    detail: `Implement the runtime/IO layer.

sys.mjs:
- getArgv(): returns the user arguments (everything after the script path) as JS strings decoded with
  UTF-8 + surrogateescape so that invalid argv bytes survive as U+DC80..U+DCFF (spec 3.3). On Linux,
  read '/proc/self/cmdline' with readFileSync from 'node:fs' (the ONLY permitted bare import here),
  split on 0x00, drop a trailing empty entry, and take the LAST (process.argv.length - 2) entries as
  the user args — that alignment is robust to node flags and to the interpreter path. Validate: the
  count must be >= 0 and the entries must decode to something whose lossy-UTF-8 form matches
  process.argv.slice(2) after replacing invalid sequences (or simply verify lengths line up); if
  anything is off, or /proc is unreadable, fall back to process.argv.slice(2). Wrap all of it in
  try/catch — this must NEVER throw. Cache the result.
- getProgName(): basename of process.argv[1] (handle both '/' and '\\\\' separators, and a trailing
  separator) mirroring os.path.basename(sys.argv[0]); if process.argv[1] is undefined, fall back to
  the string 'test3.mjs'. Do not import node:path — implement basename directly (a few lines) so the
  module has no bare imports beyond node:fs.
- writeStdout(s) / writeStderr(s): encode with encodeSurrogateescape and write the bytes
  synchronously to fd 1 / fd 2. Use process.stdout.write / process.stderr.write with a Buffer/
  Uint8Array. Guard against EPIPE (swallow it, like Python's BrokenPipeError at exit does not
  double-report... actually Python prints an error on broken pipe; simplest faithful choice: ignore
  EPIPE silently and document the decision).
- exit(code): flush-safe process exit. Because process.stdout may be async when piped, ensure written
  bytes are not lost: prefer writeSync-style semantics (write to the stream and, if the stream reports
  it is not fully flushed, use process.exitCode plus a fallback). Document the approach. The observable
  requirement: 'node /output/test3.mjs --a 5 --b x | cat' must print '5' and exit 0, and error paths
  must reliably emit both stderr lines with exit status 2 even when stderr is a pipe.
- getTerminalColumns(): mirror Python shutil.get_terminal_size().columns as argparse uses it:
  if the COLUMNS env var is set, parse it as an integer (Python int() semantics are close enough here:
  on failure treat as 0); if the parsed value is <= 0, try the real terminal size
  (process.stdout.columns) and otherwise fall back to 80. Verified: COLUMNS=20 changes the help layout.

builtins.mjs: print(...values) with Python semantics: values joined by ' ', terminated by '\\n',
each converted with pyStr, written via writeStdout.

Verify: after the other agents finish you may re-check, but at minimum unit-test your own modules by
writing a scratch script in /tmp (NOT in /output) that imports them.`,
  },
  {
    label: 'argparse-core',
    files: '/output/lib/argparse/errors.mjs, /output/lib/argparse/types.mjs, /output/lib/argparse/actions.mjs',
    detail: `Implement the argparse error/type/action layer, mirroring CPython 3.12 argparse.

errors.mjs:
- getActionName(action): CPython _get_action_name — if action.optionStrings is non-empty ->
  optionStrings.join('/'); else metavar; else dest; else null.
- class ArgumentError extends Error: constructor(action, message) sets
  this.argumentName = getActionName(action) and this.message = argumentName == null ? message :
  \`argument \${argumentName}: \${message}\`. Verified outputs: 'argument --a: invalid int value: ...',
  'argument --b: expected one argument', "argument -h/--help: ignored explicit argument 'x'".
- class ArgumentTypeError extends Error.

types.mjs:
- export function int(value) { return pyIntFromString(value) }  // MUST be declared so that int.name === 'int'
- export function str(value) { return value }                   // str.name === 'str'
  These stand in for the Python builtins passed as type=; argparse formats failures as
  \`invalid \${type.name} value: \${reprStr(value)}\`, mirroring type.__name__.

actions.mjs:
- class Action with fields optionStrings, dest, nargs, constValue, defaultValue, type, choices,
  required, help, metavar, and a call(parser, namespace, values, optionString) method that throws
  'not implemented' in the base class (like CPython's NotImplementedError).
- class StoreAction extends Action: call() assigns namespace[this.dest] = values.
- class HelpAction extends Action: nargs = 0, defaultValue = SUPPRESS-like sentinel, help text
  'show this help message and exit'; call() -> parser.printHelp() then parser.exitWith(0).
- Export a SUPPRESS sentinel string '==SUPPRESS==' as CPython does, and use it for the help action's
  default so it never lands in the namespace.
Keep this layer free of formatting concerns.`,
  },
  {
    label: 'argparse-formatter',
    files: '/output/lib/argparse/formatter.mjs',
    detail: `Implement the argparse HelpFormatter layout maths EXACTLY (spec 2.2, 2.4, 3.4).

Export two pure functions:
  formatUsage({ prog, actions, width })         -> 'usage: ...' with NO trailing newline
  formatHelp({ prog, actions, groups, width })  -> complete help text ending in exactly one '\\n'

Rules ported from CPython 3.12 argparse.HelpFormatter:
- An optional action's usage part: nargs 0 -> '[-h]' style (option string alone, bracketed when not
  required); nargs 1-ish store -> '--a A' where the metavar defaults to dest.toUpperCase(); required
  actions are NOT bracketed, non-required are. Verified target: 'usage: PROG [-h] --a A --b B'.
- Usage wrapping: let prefix = 'usage: '. If prefix.length + usageBody.length > width, wrap. Build
  optParts (per optional action) and posParts (per positional). If prefix.length + prog.length <=
  0.75 * width: indent = ' '.repeat(prefix.length + prog.length + 1) and the first line starts with
  prog followed by as many parts as fit; else: prog alone on the first line and the parts wrapped with
  indent = ' '.repeat(prefix.length). The greedy line-filler is CPython's get_lines: start
  lineLen = indent.length - 1 (or prefix.length - 1 for the prog-leading form), and for each part, if
  lineLen + 1 + part.length > width && line is non-empty -> flush; then push part and
  lineLen += 1 + part.length. When the prog-leading form is used, the first line has the indent
  stripped and the prefix prepended.
- Help body: maxHelpPosition = min(24, max(width - 20, 4)); actionMaxLength = max over actions of
  (invocation.length + 2) where the section indent is 2; helpPosition = min(actionMaxLength + 2,
  maxHelpPosition); helpWidth = max(width - helpPosition, 11); actionWidth = helpPosition - 4.
  Invocation for an optional with nargs 0 is optionStrings.join(', ') ('-h, --help'); with an argument
  it is optionStrings.map(o => o + ' ' + metavar).join(', ') ('--a A').
  If the action has no help text: emit '  ' + invocation + '\\n'.
  Else if invocation.length <= actionWidth: '  ' + invocation.padEnd(actionWidth) + '  ' + firstHelpLine
  + '\\n', with any further help lines indented by helpPosition.
  Else: '  ' + invocation + '\\n' then every help line indented by helpPosition.
  Help text is whitespace-collapsed (all runs of whitespace -> single space, then trimmed) and greedily
  wrapped to helpWidth without breaking words (textwrap.wrap defaults; long words are not broken here).
- Sections: a group with no actions contributes NOTHING (so the empty 'positional arguments' group
  disappears). A non-empty group contributes '\\n' + title + ':\\n' + its action lines.
- Whole document: usage block, then the sections, then collapse any run of 3+ newlines to exactly two,
  strip leading/trailing newlines and append a single '\\n' (CPython's _long_break_matcher + strip).

MANDATORY verification before you finish: compare your output byte-for-byte against the reference for
COLUMNS unset, 20, 21, 25, 30, 40, 60, 79, 80, 100, 200 and also COLUMNS=0 and COLUMNS=garbage, for
both '--help' (stdout) and a required-args error (stderr, where only the usage block appears and the
'PROG: error: ...' line is NOT wrapped). Do this by writing a scratch harness in /tmp that imports
your module and diffs against \`COLUMNS=n /workspace/dataset/test3_executable --help\` with
'test3_executable' substituted for the prog you pass in. Iterate until every width matches exactly.
Report which widths you verified.`,
  },
  {
    label: 'argparse-parser',
    files: '/output/lib/argparse/parser.mjs, /output/lib/argparse/index.mjs',
    detail: `Implement ArgumentParser, mirroring CPython 3.12 _parse_known_args (spec 2.3, 3.4).

Must reproduce, exactly:
- prog defaults to getProgName(); prefixChars '-'.
- The parser starts with two action groups: 'positional arguments' (empty) and 'options', and
  auto-adds the -h/--help action first.
- addArgument(names, options): names may be a string or array; dest derived from the first long option
  with leading dashes stripped and '-' -> '_'; type defaults to a pass-through; required honoured;
  metavar defaults to dest.toUpperCase() for store actions.
- parseArgs(args): calls parseKnownArgs; if extras remain -> error('unrecognized arguments: ' +
  extras.join(' ')).
- parseKnownArgs(args = getArgv()):
  * Build the option-string pattern: for each token decide option-like vs positional using
    _parse_optional semantics (spec 3.4 step list). A literal '--' token is classified OPTION-LIKE
    (pattern '-'), and every token after the first '--' is forced POSITIONAL. This is what makes
    '--a --' report 'expected one argument' while '--a 1 --b x -- y' reports
    'unrecognized arguments: -- y' (the '--' is never consumed because no positional action exists).
  * Scan left to right. For an option token: resolve the action; if it had an explicit '=' argument
    and the action takes 0 arguments, then if the option string's second character is a prefix char
    (i.e. a long option) raise ArgumentError(action, "ignored explicit argument '<arg>'"), otherwise
    perform CPython's short-option re-splitting (run the 0-arg action, then reinterpret '-' + first
    char of the explicit arg, pushing the rest back) — this is what makes '-hx' print help.
    If the action needs exactly one value, take the next token only if it is classified positional,
    else raise ArgumentError(action, 'expected one argument').
  * Type conversion happens the moment the option is consumed. Wrap the type call: a thrown
    PyValueError/PyTypeError/ArgumentTypeError becomes
    ArgumentError(action, \`invalid \${type.name} value: \${reprStr(rawValue)}\`).
  * Unknown option tokens and all positional-classified leftovers accumulate into extras, preserving
    their original order and original text.
  * The help action fires immediately when consumed: print help to stdout and exit 0 (before any
    required-argument checking).
  * After the scan, if any required action was never seen: error('the following arguments are
    required: ' + names.join(', ')) with names = getActionName(action) in add_argument order.
  * Namespace: a plain object; only assign defaults that are not the SUPPRESS sentinel.
- error(message): printUsage to stderr, then write \`\${prog}: error: \${message}\\n\` to stderr,
  exit(2). The usage block is wrapped per the formatter/terminal width; the error line is NOT wrapped.
- printUsage(toStderr): formatUsage(...) + '\\n' (a single trailing newline).
- printHelp(): formatHelp(...) to stdout (the formatter already ends with exactly one '\\n').
- width passed to the formatter is getTerminalColumns() - 2.
- Ambiguity: >1 prefix match -> error(\`ambiguous option: \${arg} could match \${matches.join(', ')}\`).

index.mjs re-exports ArgumentParser plus int, str, the action classes, SUPPRESS and the error classes,
so the entry file can read like Python's \`import argparse\`.

MANDATORY verification: write a scratch harness in /tmp that runs BOTH the reference binary and your
parser (through a tiny scratch entry file in /tmp that imports your parser, or through
/output/test3.mjs once it exists) over every single invocation listed in §2.1/§2.2/§2.3 of the spec,
comparing stdout, stderr and exit code with 'test3_executable' -> your prog substituted. Iterate until
they all match. Report the count of cases you verified and any that still differ.`,
  },
  {
    label: 'schedule',
    files: '/output/lib/schedule/job.mjs, /output/lib/schedule/scheduler.mjs, /output/lib/schedule/index.mjs',
    detail: `Reimplement the small slice of the Python 'schedule' package that the program touches
(spec 3.5), by observed interface behaviour only.

- Job: constructor(interval, scheduler = null) storing interval (whatever was passed — no validation,
  0 and negatives and BigInt all pass through untouched), unit = null initially (the library leaves it
  unset until a unit property is read; 'seconds' is set by .seconds/.second), plus the fields a
  faithful subset needs: latest, jobFunc, atTime, lastRun, nextRun, period, startDay, cancelAfter,
  tags (a Set).
- Getters for the plural units seconds/minutes/hours/days/weeks: set this.unit to that name and
  return this. Getters for the singular second/minute/hour/day/week: raise IntervalError
  ('Use seconds instead of second' etc.) unless interval === 1 (accept both 1 and 1n so BigInt
  intervals behave sensibly), then delegate to the plural form. Comment that this mirrors the
  library's assertion.
- Scheduler: jobs array; every(interval = 1) -> new Job(interval, this). Creating a job must NOT
  register it or start any timer (registration happens on .do(), which is out of scope — do not
  implement job execution, but leave the module coherent: no timers, nothing that keeps the event
  loop alive).
- Errors: ScheduleError extends Error, ScheduleValueError extends ScheduleError, IntervalError extends
  ScheduleValueError, and a CancelJob sentinel class — as the library exposes them.
- index.mjs: defaultScheduler = new Scheduler(); every(interval = 1) returns
  defaultScheduler.every(interval); re-export everything.

Confirm against the reference that \`every(n).minutes\` yields interval === n for n in {0, 1, -3, 5,
huge} by checking the printed value of the binary. Note the program prints job.interval, so interval
must round-trip exactly, including arbitrary-precision BigInt values.`,
  },
  {
    label: 'entry',
    files: '/output/test3.mjs',
    detail: `Write the entry file: a 1:1 transliteration of /workspace/dataset/test3.py.

It must read as closely to the Python as ESM allows, preserving the original comment (including the
Chinese text) on the same line:

  import { ArgumentParser, int, str } from './lib/argparse/index.mjs';
  import * as schedule from './lib/schedule/index.mjs';
  import { print } from './lib/py/builtins.mjs';

  const parser = new ArgumentParser();
  parser.addArgument('--a', { type: int, required: true });
  parser.addArgument('--b', { type: str, required: true });
  const args = parser.parseArgs();

  const job = schedule.every(args.a).minutes;  // 创建分钟间隔作业
  print(job.interval);

Add a brief header comment naming the source file it was migrated from. No extra logic, no
try/catch that would mask argparse's exit codes, no shebang requirement (but a '#!/usr/bin/env node'
shebang is acceptable if you keep it byte-harmless). Nothing may execute at import time other than
this flow. Do NOT create any other file.

Because the other modules are being written in parallel, you cannot run it yet — write it against the
contract in the preamble.`,
  },
]

const implemented = await parallel(IMPL_TASKS.map((t) => () =>
  agent(`${PREAMBLE}

YOUR ASSIGNMENT (${t.label}). You own EXACTLY these files: ${t.files}

${t.detail}

When done, reply with a compact report: files written, any contract deviation you were forced to make
(there should be none), and what you verified against the reference binary.`,
    { label: `impl:${t.label}`, phase: 'Implement' })
))

log(`Implement phase done: ${implemented.filter(Boolean).length}/${IMPL_TASKS.length} agents reported`)

phase('Harness')

const harnessPromise = agent(`${PREAMBLE}

YOUR ASSIGNMENT: build the differential test harness. You own ONLY files under /tmp/diff/ — you must
NOT create or modify anything in /output.

Write /tmp/diff/cases.mjs exporting \`export const CASES\` — an array of { name, argv: string[],
env?: {COLUMNS?: string} } covering EVERY invocation in spec sections 2.1, 2.2, 2.3 and 2.4 plus a
generated fuzz corpus. The corpus must be DETERMINISTIC (no Math.random — use a small seeded LCG or
fixed enumerations) and should include at least 600 cases spanning:
 - valid ints: 0, signs, leading zeros, underscores in every legal position, lengths 1..4300,
   values far beyond 2^53, 4300/4301-digit boundaries
 - invalid ints: floats, hex/binary/exponent forms, lone signs, doubled/edge underscores, empty,
   whitespace-only, internal whitespace, '²', ZWSP, BOM, control chars 0x00-0x1F and 0x7F
 - Unicode Nd digits from at least 12 different blocks (Arabic-Indic, Extended Arabic-Indic,
   Devanagari, Bengali, Thai, Khmer, Myanmar, Lepcha, Tai Laing, Adlam, fullwidth, the five
   mathematical blocks), single digits, multi-digit, mixed with ASCII, with underscores, negative
 - every code point in the Python unicode-space set as a leading and trailing pad, plus 0x1C-0x1F
   which must FAIL
 - repr-sensitive values: quotes, both quote kinds, backslashes, newlines, tabs, emoji, astral chars
 - argv shapes: '=' forms, duplicated options, missing values, option-like values, negative-number
   values (ASCII and Unicode digits), '--' in every position, unknown long/short options,
   '--help' abbreviations (--h/--he/--hel), '-hx', '--help=x', '-h' mixed with other args, bare '-',
   trailing junk, empty-string args
 - COLUMNS variants: unset, '0', '1', '5', '20', '21', '25', '30', '40', '60', '79', '80', '100',
   '200', 'garbage', '' (empty) — applied to --help and to a missing-required error
Where a case exercises invalid UTF-8 argv, express it as raw bytes: allow an optional
\`argvBytes: number[][]\` field per case so the harness can spawn with exact bytes.

Write /tmp/diff/harness.mjs — an ESM script that, for each case, runs
  /workspace/dataset/test3_executable <argv>   and   node /output/test3.mjs <argv>
with the same env, captures stdout/stderr as BUFFERS and the exit code, normalises the reference
output by replacing every occurrence of 'test3_executable' with 'test3.mjs' (the one sanctioned
divergence — do the replacement on bytes or on a latin1 round-trip so byte fidelity is preserved),
then compares stdout bytes, stderr bytes and exit code. Print a compact per-failure diff (case name,
argv rendered with JSON.stringify, expected vs actual for whichever stream differs, with byte-level
hex for non-printable differences) and a final summary line of the exact form
  RESULT total=<n> pass=<n> fail=<n>
Exit 0 when fail=0, else exit 1. Support \`node /tmp/diff/harness.mjs --filter <substring>\` and
\`--limit <n>\`, and \`--list\` to print case names. Run cases with a modest concurrency (e.g. 8) so the
whole suite finishes quickly, but keep output deterministic (sort failures by case index). Use only
Node builtins with the node: prefix.

Also write /tmp/diff/README.md documenting how to run it.

Do not fix bugs in /output yourself — just report. Finish by running the harness once (it is fine if
/output is still incomplete or broken) and reporting the RESULT line plus a categorised summary of the
top failure clusters (at most 12 clusters, each with a representative case and the observed vs
expected bytes).`,
  { label: 'harness', phase: 'Harness' })

phase('Integrate')

const integration = await agent(`${PREAMBLE}

YOUR ASSIGNMENT: integration. The eight implementation agents have finished writing /output. Your job
is to make the program actually run and to fix any cross-module contract mismatches.

1. Read every file under /output (use a directory listing first).
2. Run: node /output/test3.mjs --a 5 --b x   ; it must print exactly "5\\n" and exit 0.
3. Run at least these and fix everything that breaks:
   node /output/test3.mjs --help
   node /output/test3.mjs
   node /output/test3.mjs --a 5
   node /output/test3.mjs --a abc --b x
   node /output/test3.mjs --a 99999999999999999999 --b x
   node /output/test3.mjs --a 5 --b x --c 9
   COLUMNS=20 node /output/test3.mjs --help
   node /output/test3.mjs --a 5 --b x | cat        (output must not be swallowed)
4. Compare each against /workspace/dataset/test3_executable with 'test3_executable' -> 'test3.mjs'.
5. You MAY edit any file in /output to resolve mismatches, missing exports, wrong import paths,
   circular imports, or crashes. Keep the module layout from the spec (§4) intact. Preserve the
   NON-NEGOTIABLE RULES above — in particular check that no file contains 'require(' or
   'module.exports', that every relative import ends in '.mjs', and that the only bare imports are
   node: builtins.
6. If two agents duplicated a responsibility or a file is missing, fix it minimally.

Report: the state of each file, every fix you made, and the exact stdout/stderr/exit for the eight
commands above with a pass/fail verdict per command.`,
  { label: 'integrate', phase: 'Integrate' })

const harness = await harnessPromise
log('Harness ready; entering convergence loop')

phase('Converge')

let cleanStreak = 0
const rounds = []
for (let round = 1; round <= 6 && cleanStreak < 2; round++) {
  const r = await agent(`${PREAMBLE}

YOUR ASSIGNMENT: convergence round ${round}. A differential harness exists at /tmp/diff/harness.mjs
(cases in /tmp/diff/cases.mjs, docs in /tmp/diff/README.md). It runs the reference binary and
\`node /output/test3.mjs\` over a large corpus and compares stdout/stderr/exit bytes.

${round > 1 ? `Previous rounds reported:\n${rounds.map((x, i) => `  round ${i + 1}: ${x}`).join('\n')}\n` : ''}
Steps:
1. Run: node /tmp/diff/harness.mjs   and read the RESULT line and failures.
2. For every failure, determine whether the bug is in /output (fix /output) or in the harness/case
   expectations (fix /tmp/diff — but be very skeptical of "the harness is wrong": the reference binary
   is ground truth, and the ONLY sanctioned divergence is the prog name. Re-run the reference binary
   yourself to confirm before touching a case).
3. Fix the root causes in /output. Minimal, surgical, well-commented edits that keep the module layout
   (§4) and the NON-NEGOTIABLE RULES intact. Never paper over a divergence by special-casing an input:
   fix the algorithm.
4. Re-run the harness until the RESULT line shows fail=0 or you can no longer make progress.

Finish with a single line of the form
  ROUND ${round}: RESULT total=<n> pass=<n> fail=<n> | fixes: <short list> | remaining: <short list or none>`,
    { label: `converge:${round}`, phase: 'Converge' })

  rounds.push(r || 'agent returned nothing')
  const text = String(r || '')
  const m = text.match(/fail\s*=\s*(\d+)/)
  const failed = m ? Number(m[1]) : null
  if (failed === 0) cleanStreak++
  else cleanStreak = 0
  log(`round ${round}: ${failed === null ? 'unparsed' : `fail=${failed}`} (clean streak ${cleanStreak})`)
}

phase('Audit')

const LENSES = [
  {
    key: 'compliance',
    prompt: `Audit /output for HARD REQUIREMENT compliance ONLY. Check, file by file (list the
directory recursively first, and check EVERY file including any stray ones):
 - any occurrence of 'require(' or 'module.exports' or 'exports.' or 'createRequire' or '__dirname' /
   '__filename' (CommonJS-only globals) — each is a hard failure
 - every file ends in .mjs; no .js/.cjs/.json/.ts files were left behind; no stray scratch/test files
   or directories that do not belong to the deliverable (the deliverable is the library + entry file)
 - every relative import specifier ends with '.mjs'
 - every bare import specifier is a node: builtin (list them all with file:line); anything else is a
   hard failure. Flag any npm-style import, any dynamic import() of a bare specifier, and any
   package.json that would be needed for the code to run
 - no child_process / spawn / exec / python anywhere; no network access; no eval / new Function
 - the modules are genuinely split hierarchically by responsibility with meaningful exports (not one
   giant file plus stubs), and the entry file is /output/test3.mjs
 - the code runs on a bare Node install from any cwd: verify by running
   \`cd / && node /output/test3.mjs --a 5 --b x\` and \`cd /tmp && node /output/test3.mjs --help\`
 - no reliance on a package.json "type" field (ESM must come from the .mjs extension alone) — verify
   there is no package.json in /output, and that it still works if one existed with type commonjs:
   test by creating /tmp/pkgtest/package.json {"type":"commonjs"} and a copy? Do NOT copy /output;
   instead just reason about it and confirm .mjs wins.`,
  },
  {
    key: 'argparse-fidelity',
    prompt: `Audit the argparse reimplementation in /output/lib/argparse/ for behavioural divergence
from the reference. Do NOT trust the existing harness — independently design at least 60 NEW adversarial
invocations that the spec's §2 tables do not already cover, run them against BOTH
/workspace/dataset/test3_executable and \`node /output/test3.mjs\`, and report every divergence
(remember the prog-name substitution). Ideas to mine: interleavings of -h with malformed args; '='
with empty value; '--a=--b'; repeated '--'; '--' as an option value; abbreviation collisions;
arguments containing '='; extremely long option-ish tokens; values that look like negative numbers in
non-ASCII digits; empty-string option names; args after a failing conversion; '--a' given twice where
the first is invalid; unicode option names; NUL bytes in values (via raw argv bytes); 100k-char values;
COLUMNS values that are negative/huge/float/with whitespace; TERM/LINES env noise. Report each
divergence with the exact argv, expected bytes, actual bytes.`,
  },
  {
    key: 'int-repr-fidelity',
    prompt: `Audit /output/lib/py/int.mjs, repr.mjs, unicode.mjs and surrogateescape.mjs against
CPython semantics. Independently derive test inputs (at least 200 NEW ones beyond the spec) and check
them against the reference binary. Focus on: the Nd digit-value algorithm across EVERY Unicode Nd
block you can enumerate with a \\p{Nd} sweep (sample every block, including ones adjacent in code
space, and all five mathematical blocks) — a wrong digit value would silently print a wrong number,
which is the worst possible failure; the whitespace transform asymmetry (< 128 vs >= 128); PEP 515
underscore placement rules with non-ASCII digits; the 4300-digit limit counted on digit characters
with and without underscores/leading zeros/signs; BigInt round-tripping of 4300-digit values;
repr escaping of every control character 0x00-0x1F, 0x7F-0x9F, lone surrogates, astral code points,
combining marks, RTL marks, and both quote characters; surrogateescape decode/encode round-trips for
invalid UTF-8 argv bytes (spawn with raw bytes). Report every divergence with exact bytes. Also flag
any performance cliff (e.g. a 1e6-char argument taking more than a second).`,
  },
  {
    key: 'formatter-fidelity',
    prompt: `Audit /output/lib/argparse/formatter.mjs. Independently verify the help and usage layout
against the reference for COLUMNS from 1 to 120 inclusive (every single value — script it), plus
unset, '0', '-5', '1e3', ' 40 ', '40.5', 'abc', '' and a very large value like '100000', for BOTH
\`--help\` (stdout) and a missing-required error (stderr). Compare byte for byte with the prog-name
substitution. Report the exact COLUMNS values that diverge, with expected vs actual blocks. Also
check: does the reference wrap the 'error:' line at any width (it should not)? Does help output end in
exactly one newline at every width? Is the empty 'positional arguments' section ever emitted?`,
  },
  {
    key: 'hidden-bugs',
    prompt: `Hunt for latent correctness bugs and crash paths in /output that the differential harness
would NOT catch. Read every file closely. Look for: unhandled exception paths that would print a Node
stack trace instead of an argparse error; \`process.exit\` truncating buffered stdout when piped to a
slow consumer (test with a large output: 4300-digit value piped through \`head -c 5\`, and through a
sleeping reader); EPIPE handling; reliance on /proc/self/cmdline mis-aligning user args when node
flags are present (test: \`node --no-warnings /output/test3.mjs --a 5 --b x\`,
\`node --stack-size=2000 /output/test3.mjs --a 5 --b x\`, and via NODE_OPTIONS='--no-warnings'), and
when the script is invoked through a symlink or a relative path (test \`cd /output && node ./test3.mjs
--a 5 --b x\` and via a symlink in /tmp); BigInt vs Number mixing anywhere in the interval path;
mutable module-level state / caches that could poison results; regexes that could catastrophically
backtrack on a long input; any use of \`\\s\` where the Python space set was meant; any use of
String.prototype.length where code points were meant; off-by-one in the UTF-8 decoder; getters with
side effects called twice. For each candidate bug give a concrete reproduction command and the wrong
behaviour you observed. Only report things you actually reproduced or can prove by reading the code.`,
  },
]

const auditFindings = await pipeline(
  LENSES,
  (lens) => agent(`${PREAMBLE}

YOUR ASSIGNMENT: adversarial audit (lens: ${lens.key}). You are a reviewer, not an implementer — do
NOT edit any file in /output. Read, run, probe, and report.

${lens.prompt}

Return ONLY a JSON object matching the schema: a list of findings, each with a stable id, severity
('blocker' | 'major' | 'minor'), the file and (if known) line, a one-sentence summary, and an exact
reproduction command plus the observed vs expected result. If you find nothing, return an empty list —
do not invent findings. Be precise: a finding that cannot be reproduced with the command you give
will be thrown out.`,
    {
      label: `audit:${lens.key}`,
      phase: 'Audit',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['lens', 'casesRun', 'findings'],
        properties: {
          lens: { type: 'string' },
          casesRun: { type: 'integer' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'severity', 'file', 'summary', 'repro', 'observed', 'expected'],
              properties: {
                id: { type: 'string' },
                severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
                file: { type: 'string' },
                line: { type: 'integer' },
                summary: { type: 'string' },
                repro: { type: 'string' },
                observed: { type: 'string' },
                expected: { type: 'string' },
              },
            },
          },
        },
      },
    }),
  (report, lens) => {
    if (!report || !report.findings || report.findings.length === 0) return []
    return parallel(report.findings.map((f) => () =>
      agent(`${PREAMBLE}

YOUR ASSIGNMENT: adversarially VERIFY a single audit finding. You are a skeptic. Default to REFUTED
unless you personally reproduce the defect. Do NOT edit any file in /output.

Finding (from lens "${lens.key}"):
  id: ${f.id}
  severity: ${f.severity}
  file: ${f.file}${f.line ? ':' + f.line : ''}
  summary: ${f.summary}
  repro: ${f.repro}
  observed: ${f.observed}
  expected: ${f.expected}

Run the repro exactly. Then decide:
 - Is the "expected" claim actually what the reference binary /workspace/dataset/test3_executable does?
   Verify by running the reference yourself (remember: the ONLY sanctioned divergence is prog name
   'test3_executable' -> 'test3.mjs'). If the finding's expectation is wrong, it is REFUTED.
 - Is the defect real and reachable through the documented interface \`node /output/test3.mjs ...\`?
   A theoretical concern with no observable difference in stdout/stderr/exit-code is REFUTED unless it
   is a HARD REQUIREMENT violation (CommonJS syntax, non-.mjs file, external/npm import, spawning
   python), which counts as real even without behavioural impact.
Report your verdict with the exact commands you ran and their output.`,
        {
          label: `verify:${f.id}`,
          phase: 'Verify',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'real', 'reasoning', 'evidence'],
            properties: {
              id: { type: 'string' },
              real: { type: 'boolean' },
              reasoning: { type: 'string' },
              evidence: { type: 'string' },
              correctedExpectation: { type: 'string' },
            },
          },
        })
        .then((v) => ({ finding: f, lens: lens.key, verdict: v }))
    ))
  }
)

const verified = auditFindings.flat().filter(Boolean)
const confirmed = verified.filter((v) => v.verdict && v.verdict.real)
log(`Audit: ${verified.length} findings verified, ${confirmed.length} confirmed real`)

phase('Repair')

let repairReport = 'no confirmed findings — nothing to repair'
if (confirmed.length > 0) {
  repairReport = await agent(`${PREAMBLE}

YOUR ASSIGNMENT: apply the confirmed audit findings to /output, then prove the fixes.

Confirmed findings (each was independently reproduced by a skeptical verifier):
${confirmed.map((c, i) => `${i + 1}. [${c.finding.severity}] (${c.lens}) ${c.finding.file}${c.finding.line ? ':' + c.finding.line : ''}
   ${c.finding.summary}
   repro: ${c.finding.repro}
   observed: ${c.finding.observed}
   expected: ${c.verdict.correctedExpectation || c.finding.expected}
   verifier notes: ${c.verdict.reasoning}`).join('\n')}

Rules:
 - Fix root causes, surgically. Keep the §4 module layout and the NON-NEGOTIABLE RULES.
 - After each fix, re-run its repro command and confirm the reference and \`node /output/test3.mjs\`
   now agree (prog-name substitution aside).
 - Then run the full differential harness: node /tmp/diff/harness.mjs — it MUST end with fail=0.
   If a fix broke something, fix that too and re-run.
 - Finally run a compliance sweep yourself: grep the whole of /output for 'require(', 'module.exports',
   '__dirname', '__filename', bare (non node:) import specifiers, and any file not ending in .mjs.

Report: per finding, what you changed and the verification output; then the final harness RESULT line;
then the compliance sweep output.`,
    { label: 'repair', phase: 'Repair' })
}

phase('Repair')

const final = await agent(`${PREAMBLE}

YOUR ASSIGNMENT: final gate. Do not make sweeping changes; only fix what is provably broken.

1. Recursively list /output and print every file's path and line count.
2. Run the full differential harness: node /tmp/diff/harness.mjs — report the RESULT line verbatim.
   If fail > 0, fix the root causes in /output and re-run until fail=0 (or explain precisely why a
   divergence is impossible to fix and is limited to the sanctioned prog-name difference).
3. Compliance sweep (report the actual grep output, not a summary):
   - grep -rn "require(\\|module\\.exports\\|createRequire\\|__dirname\\|__filename" /output
   - list every import specifier in /output (grep -rhn "from ['\\\"]" /output) and confirm each is
     either a relative path ending in .mjs or a node: builtin
   - find /output -type f ! -name '*.mjs'
4. Spot-check these by hand against the reference (with prog substitution) and paste both outputs:
   --a 5 --b x | --help | (no args) | --a abc --b x | --a 99999999999999999999 --b x |
   --a 5 --b x --c 9 | COLUMNS=20 --help | --a "٥" --b x | --a 5 --b x -h
5. Confirm the entry file is /output/test3.mjs and reads as a 1:1 transliteration of the Python.

Return a final verdict: SHIP or BLOCKED, plus a short file-by-file inventory (path — one-line purpose),
the harness RESULT line, and anything a human reviewer should know (including the deliberate
prog-name divergence).`,
  { label: 'final-gate', phase: 'Repair' })

return {
  implemented: implemented.map((r, i) => ({ task: IMPL_TASKS[i].label, ok: Boolean(r) })),
  harness: harness ? String(harness).slice(-1500) : null,
  integration: integration ? String(integration).slice(-1500) : null,
  convergeRounds: rounds.map((r) => String(r).slice(-400)),
  auditSummary: {
    total: verified.length,
    confirmed: confirmed.length,
    confirmedList: confirmed.map((c) => ({ id: c.finding.id, sev: c.finding.severity, file: c.finding.file, summary: c.finding.summary })),
    refuted: verified.filter((v) => !(v.verdict && v.verdict.real)).map((v) => ({ id: v.finding.id, why: v.verdict ? v.verdict.reasoning.slice(0, 200) : 'no verdict' })),
  },
  repair: repairReport ? String(repairReport).slice(-2000) : null,
  final: final ? String(final) : null,
}
