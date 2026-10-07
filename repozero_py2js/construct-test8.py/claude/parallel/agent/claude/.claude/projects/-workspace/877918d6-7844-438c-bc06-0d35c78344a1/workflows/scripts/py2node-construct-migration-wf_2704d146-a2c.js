export const meta = {
  name: 'py2node-construct-migration',
  description: 'Migrate test8.py (argparse + construct Int8ul/Bytes) to zero-dependency Node ESM in /output, verified byte-for-byte against the reference executable',
  phases: [
    { title: 'Probe',     detail: 'Parallel black-box specialists reverse-engineer each subsystem from the executable' },
    { title: 'Spec',      detail: 'Synthesize one authoritative behavioral spec' },
    { title: 'Implement', detail: 'Write the hierarchical .mjs module tree + entry point' },
    { title: 'Verify',    detail: 'Differential fuzzing (4 strategies) + adversarial code review (3 lenses)' },
    { title: 'Repair',    detail: 'Fix confirmed divergences, loop until dry' },
    { title: 'Final',     detail: 'Full-suite confirmation run' },
  ],
}

const EXE = '/workspace/dataset/test8_executable'
const OUT = '/output'
const ENTRY = '/output/test8.mjs'

const GROUND_TRUTH = `
=== ORIGINAL PYTHON SOURCE (/workspace/dataset/test8.py) ===
#!/usr/bin/env python3
import argparse
import construct

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=int, required=True)
    parser.add_argument('--b', type=int, required=True)
    parser.add_argument('--c', type=str, required=True)
    args = parser.parse_args()

    format1 = construct.Int8ul.build(args.a)
    format2 = construct.Int8ul.build(args.b)
    length = len(args.c)
    format3 = construct.Bytes(length).build(args.c.encode())
    print(format1)
    print(format2)
    print(format3)

if __name__ == "__main__":
    main()

=== ALREADY-CONFIRMED GROUND TRUTH (verified by running ${EXE}) ===
Reference executable: ${EXE}   (run it directly; NEVER use the 'python' command)
Program name in argparse messages is literally "test8_executable".

[stdout, success] three lines, each a Python bytes repr, each followed by \\n:
  --a 135 --b 67 --c binary  ->  b'\\x87' / b'C' / b'binary'
  --a 0 --b 255 --c x        ->  b'\\x00' / b'\\xff' / b'x'
  --a 1 --b 1 --c ''         ->  b'\\x01' / b'\\x01' / b''

[python bytes repr rules confirmed]
  quote choice: default "'"; if bytes contain "'" and NOT '"', use '"'; if both present use "'" and escape \\'
    b"it's"          (only single quote)
    b'say "hi"'      (only double quote)
    b'both\\'"x'      (both -> single-quoted, \\' escaped)
  escapes: backslash -> \\\\ , \\t , \\n , \\r  (ONLY these three control chars are named)
    other bytes < 0x20, 0x7f, and >= 0x80 -> \\xNN  (lowercase hex, always 2 digits)
    verified: bell->\\x07, vtab->\\x0b, esc->\\x1b, del->\\x7f, 0x01->\\x01
    printable ASCII 0x20..0x7e -> literal
  prefix is b, no space anywhere.

[argparse confirmed]
  usage line (stdout for --help, stderr for errors):
    usage: test8_executable [-h] --a A --b B --c C
  --help / --h (abbreviation) exit 0, print to stdout exactly:
usage: test8_executable [-h] --a A --b B --c C
<blank line>
options:
  -h, --help  show this help message and exit
  --a A
  --b B
  --c C
  errors -> stderr, exit code 2, two lines:
    usage: test8_executable [-h] --a A --b B --c C
    test8_executable: error: <msg>
  messages confirmed:
    missing all      -> the following arguments are required: --a, --b, --c
    missing one      -> the following arguments are required: --b
    bad int          -> argument --a: invalid int value: 'abc'   (repr of the string)
    empty int        -> argument --a: invalid int value: ''
    no value         -> argument --a: expected one argument
    positional junk  -> unrecognized arguments: extra
    trailing --      -> unrecognized arguments: --
  precedence: required-arguments error fires BEFORE unrecognized-arguments error
    ('-a 5 --b 1 --c x' reports "the following arguments are required: --a", NOT unrecognized)
  '--a=7' form works. Repeated '--a' -> LAST occurrence wins. '--h' abbreviates --help.
  '-a' and '--ab' are NOT recognized (become unrecognized extras).

[python int() semantics for type=int, confirmed]
  accepts surrounding ASCII *and* unicode whitespace (NBSP-wrapped '5' -> 5)
  accepts leading + or -            ('+5' -> 5)
  accepts underscores between digits ('1_0' -> 10)
  accepts unicode decimal digits     ('\\u0663' Arabic-Indic three -> 3)
  rejects '0x10', '1.5', 'abc', ''  -> invalid int value
  arbitrary precision: '99999999999999999999' parses fine, then fails in construct

[construct confirmed]
  Int8ul.build(v): v must be an integer 0..255 else FormatFieldError (exit 1)
  Bytes(n).build(data): len(data) must == n else StreamError (exit 1)
  length = len(args.c) is a PYTHON STR LENGTH = COUNT OF UNICODE CODE POINTS.
    '\\U0001F600' (emoji) -> len 1 but 4 UTF-8 bytes -> StreamError "expected 1, found 4"
    'h\\u00e9llo' -> len 5 but 6 UTF-8 bytes -> StreamError "expected 5, found 6"
    IN JAVASCRIPT '\\u{1F600}'.length IS 2 (UTF-16 units) -- YOU MUST USE CODE POINT COUNT.

[stderr traceback shapes, exit code 1]
  int out of range (e.g. --a 256):
Traceback (most recent call last):
  File "construct/core.py", line 1165, in _build
struct.error: 'B' format requires 0 <= number <= 255

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "test8.py", line 21, in <module>
  File "test8.py", line 12, in main
  File "construct/core.py", line 452, in build
  File "construct/core.py", line 464, in build_stream
  File "construct/core.py", line 1167, in _build
construct.core.FormatFieldError: Error in path (building)
struct '<B' error during building, given value 256
[PYI-NNN:ERROR] Failed to execute script 'test8' due to unhandled exception!
  (NOTE: for --b out of range the second frame is 'line 13, in main'; verify.)
  (NOTE: PYI-NNN is the process PID -> NON-DETERMINISTIC. stdout is what must match exactly.)

  bytes length mismatch (e.g. --c 'h\\u00e9llo'):
    ... File "test8.py", line 15, in main / construct/core.py 452 build / 464 build_stream /
        970 _build / 195 stream_write
construct.core.StreamError: Error in path (building)
bytes object of wrong length, expected 5, found 6

  invalid UTF-8 in argv (e.g. --c $'a\\xffb'): Python decodes argv with surrogateescape,
  so .encode() raises BEFORE construct:
UnicodeEncodeError: 'utf-8' codec can't encode character '\\udcff' in position 1: surrogates not allowed
    Node's process.argv replaces those bytes with U+FFFD, LOSING information.
    Raw argv bytes ARE recoverable on this Linux box by reading /proc/self/cmdline with node:fs
    (NUL-separated). Confirmed present. Use it to reproduce surrogateescape fidelity.

=== HARD CONSTRAINTS ON THE GENERATED CODE ===
* Pure JavaScript, Node.js, ESM ONLY: 'import' / 'export'. require() and module.exports are FORBIDDEN.
* Every generated file uses the .mjs suffix; every relative import includes the full './x.mjs' suffix.
* ZERO npm/external dependencies. Only local relative imports and node: builtins (node:fs, node:process...).
* NEVER import, use, or even mention DataView or ArrayBuffer anywhere (comments included). This is a hard
  ban from the task statement. Use Uint8Array (build with Uint8Array.from / Uint8Array.of / new Uint8Array(len))
  or plain number arrays. Do not call .buffer on a typed array.
* No embedded Python. No child_process shelling out to python.
* Hierarchical: split the library into multiple focused modules under ${OUT}/lib/ that export their
  interfaces; the entry point ${ENTRY} wires them together.
* Node is v18.19.1.
`

// ─────────────────────────────────────────────────────────────────────────────
phase('Probe')

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'rules', 'transcript', 'gotchas'],
  properties: {
    area: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, implementable behavioral rules with the exact observed evidence',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'evidence'],
        properties: {
          rule: { type: 'string' },
          evidence: { type: 'string', description: 'exact command + exact observed output' },
        },
      },
    },
    transcript: {
      type: 'array',
      description: 'Every distinct case you ran: the argv you passed and the exact stdout/stderr/exit code',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'stdout', 'exit'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          stdout: { type: 'string' },
          stderrTail: { type: 'string' },
          exit: { type: 'integer' },
        },
      },
    },
    gotchas: {
      type: 'array',
      description: 'Places where a naive JS port would silently diverge from Python',
      items: { type: 'string' },
    },
  },
}

const PROBE_AREAS = [
  {
    key: 'argparse-surface',
    prompt: `Reverse-engineer the ARGPARSE SURFACE of ${EXE} as a black box.

Nail down, by running the executable: the exact --help/-h output (byte for byte, including the blank
line and every column of padding in the options block); the exact usage line; the exact error text and
exit code for every failure mode you can construct. Systematically cover: missing one/two/three required
args (what is the separator and ordering in the "required" list?); unknown options; unknown positionals;
'--' handling; '--opt=value' vs '--opt value'; option abbreviation ('--h', '--he', '--a', '--ab');
repeated options; a value that itself looks like an option (e.g. --c --b, --c -x, --c -5, --a -3);
an empty-string value; interleaved ordering; '-h' combined with missing required args (which wins?);
'--help' appearing AFTER an invalid int (which wins?); unrecognized-vs-required precedence in both orders.
Also determine which stream each thing goes to (stdout vs stderr) and the trailing-newline situation.
Use 'cat -A' or od to be certain about trailing newlines and spaces.

Report exhaustively enough that someone can reimplement argparse's observable surface for THIS parser
without ever seeing argparse. Note exact padding/column math in the help text.`,
  },
  {
    key: 'python-int',
    prompt: `Reverse-engineer exactly which strings the executable's 'type=int' argument converter ACCEPTS
and REJECTS, and what value it produces. ${EXE} --a <S> --b 1 --c x  — a rejected S gives exit 2 with
"argument --a: invalid int value: <repr of S>"; an accepted S in 0..255 prints its byte on line 1, and an
accepted S outside 0..255 gives an exit-1 traceback ending in "given value <N>" which reveals the parsed
integer. Use that oracle to determine the parsed value precisely.

Probe at least: plain digits; leading/trailing ASCII spaces, tabs, newlines, \\r, \\f, \\v; unicode
whitespace (U+00A0 NBSP, U+2003 EM SPACE, U+3000 IDEOGRAPHIC SPACE, U+2028); leading + and -; multiple
signs ('++5', '- 5', '-+5'); sign with space after it; underscores ('1_0', '_1', '1_', '1__0', '+1_0');
unicode decimal digits (Arabic-Indic U+0660-0669, Devanagari U+0966-096F, fullwidth U+FF10-FF19);
superscript digits (U+00B2) and other numeric-but-not-decimal chars; '0x10','0b1','0o7','1e2','1.0','.5';
empty string; only-whitespace; very long digit strings; '007'; '+0'; '-0'.
ALSO determine the exact repr used in the error message for tricky S (embedded quote, backslash, newline,
non-ASCII, non-printable) — that is Python's repr() of a str, whose escaping rules differ from bytes repr.

Report a decision procedure precise enough to reimplement int() for this use, plus the str-repr rules.`,
  },
  {
    key: 'bytes-repr',
    prompt: `Reverse-engineer Python's BYTES REPR formatting as printed by ${EXE} on line 3 (and lines 1-2).

Line 3 prints the repr of the UTF-8 encoding of --c, but ONLY when the code-point length of --c equals its
UTF-8 byte length (otherwise you get an exit-1 StreamError). So to probe arbitrary byte values on line 3 use
pure-ASCII/Latin-1-safe inputs where those lengths coincide; to probe HIGH bytes (0x80-0xff) use lines 1 and 2
instead via --a/--b (e.g. --a 128 prints repr of a single byte 0x80).

Determine for EVERY byte 0x00..0xff how it renders inside the repr. Drive lines 1 and 2 across all 256 values
with a loop and record the output. Then determine quote selection and escaping on multi-byte strings via --c:
no quotes present; only "'"; only '"'; both; backslashes; tab/newline/CR; other C0 controls; DEL.
Confirm whether \\a \\b \\f \\v \\0 are ever emitted as named escapes or always as \\xNN.
Confirm hex case and zero padding. Confirm the 'b' prefix and absence of spaces.

Deliver a complete, exact byte -> rendering table (summarized by ranges where identical) and the precise
quote-selection algorithm.`,
  },
  {
    key: 'construct-errors',
    prompt: `Reverse-engineer the CONSTRUCT failure modes and their exact stderr tracebacks from ${EXE}.

Cases: --a out of range (negative, 256, huge, and also confirm the frame line number differs for --b);
--c whose Python code-point length differs from its UTF-8 byte length (accented chars, CJK, emoji,
combining marks, ZWJ sequences); --c containing bytes that are invalid UTF-8 (pass raw bytes with
printf, e.g. $'a\\xffb', $'\\xe9', $'\\xc3', a truncated multi-byte sequence, an overlong encoding,
a raw surrogate encoding $'\\xed\\xa0\\x80').

For each: capture the FULL stderr byte-for-byte (use a here-doc / redirect to a file and cat -A), the exit
code, and anything printed on stdout BEFORE the failure (important: does line 1 and/or line 2 get flushed to
stdout before the exception? test --a 1 --b 1 --c <bad> and check stdout alone with 2>/dev/null).
That stdout-before-crash behaviour is critical.

Determine the exact ordering: is it a UnicodeEncodeError (raised by .encode()) or a construct StreamError,
and what is the reported position/expected/found numbers for multi-error strings? Establish precisely how
'position N' in UnicodeEncodeError is counted (code points? which index when several bad bytes?) and
whether only the FIRST bad char is reported. Also determine what 'expected X, found Y' uses.

Report the exact traceback templates with placeholders, noting which parts are non-deterministic.`,
  },
  {
    key: 'argv-encoding',
    prompt: `Investigate how ${EXE} DECODES raw argv bytes, and how a Node.js program can reproduce it.

(1) Against the executable: pass --c values containing raw non-UTF-8 bytes via printf $'...' and read the
UnicodeEncodeError message, which reveals the decoded code points (e.g. '\\udcff'). Map: which byte values
become which surrogates? Confirm the Python surrogateescape rule (byte 0xNN in 0x80..0xff that is not part
of a valid UTF-8 sequence -> U+DC00+NN). Test bytes 0x80, 0xa0, 0xc3 (lone lead), 0xed 0xa0 0x80 (encoded
surrogate), 0xc0 0x80 (overlong), 0xf5, 0xff, and a valid multi-byte char adjacent to a bad byte.
Determine which POSITION is reported when there are several undecodable bytes and how position is counted.
Also test raw bad bytes in the --a value and see what the 'invalid int value:' repr shows.

(2) On the Node side: verify with small node -e one-liners (Node v18) that process.argv lossily maps those
bytes to U+FFFD, and that reading /proc/self/cmdline with node:fs (readFileSync, NUL-separated, note the
trailing NUL and that argv[0] is the executable) recovers the exact raw bytes. Determine precisely how to
align /proc/self/cmdline entries with process.argv.slice(2) for a script run as 'node /output/test8.mjs ...'
— how many leading entries to skip, and how to make that robust (e.g. when run via a different launcher, or
if the file is unreadable). Write and actually RUN a tiny throwaway .mjs in /tmp proving the alignment logic
works for: normal args, args containing spaces, empty-string args, args with raw invalid UTF-8 bytes.

Deliver a concrete, tested recipe for obtaining Python-identical (surrogateescape-decoded) argument strings
in Node, INCLUDING the fallback when /proc is unavailable. Do NOT mention DataView or ArrayBuffer.`,
  },
]

const probes = await parallel(PROBE_AREAS.map(a => () =>
  agent(
    `You are a black-box reverse-engineering specialist. Work empirically: RUN the reference executable many
times and record exactly what it does. Never run the 'python' command; the executable is self-contained.
Be exhaustive — dozens of invocations is the expected volume. Use bash loops, printf for raw bytes,
'cat -A' / 'od -c' to make whitespace and newlines unambiguous, and check exit codes every time.

${GROUND_TRUTH}

YOUR ASSIGNED AREA: ${a.key}

${a.prompt}

Do not write any files under /output. Your job is purely to establish truth.`,
    { label: `probe:${a.key}`, phase: 'Probe', schema: PROBE_SCHEMA, effort: 'high' }
  )
))

const probeReport = probes.filter(Boolean).map(p =>
  `##### AREA: ${p.area}\nRULES:\n${p.rules.map(r => `- ${r.rule}\n    evidence: ${r.evidence}`).join('\n')}\n` +
  `GOTCHAS:\n${(p.gotchas || []).map(g => `- ${g}`).join('\n')}\n` +
  `OBSERVED CASES:\n${(p.transcript || []).slice(0, 60).map(t =>
    `  argv=${JSON.stringify(t.argv)} exit=${t.exit} stdout=${JSON.stringify(t.stdout)}` +
    (t.stderrTail ? ` stderrTail=${JSON.stringify(t.stderrTail)}` : '')).join('\n')}`
).join('\n\n')

log(`Probe complete: ${probes.filter(Boolean).length}/${PROBE_AREAS.length} areas, ` +
    `${probes.filter(Boolean).reduce((n, p) => n + p.rules.length, 0)} rules established`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Spec')

const spec = await agent(
  `You are the architect for a Python->Node.js migration. Five black-box specialists independently probed
the reference executable. Synthesize their findings into ONE authoritative, self-contained implementation
spec plus a module decomposition.

${GROUND_TRUTH}

===== SPECIALIST FINDINGS =====
${probeReport}
===== END FINDINGS =====

Produce a spec that a single implementer can follow without re-probing. It must include:
 1. The exact module tree under ${OUT}/lib/ (hierarchical, split by responsibility) and each module's
    exported interface (function signatures + semantics). Entry point is ${ENTRY}.
 2. The precise algorithm for each tricky piece: Python int() acceptance, Python str repr (for the
    "invalid int value:" message), Python bytes repr (quote selection + escape table), UTF-8 encoding
    with surrogateescape round-tripping, code-point length, argparse parse order/precedence, help+usage
    text generation, construct Int8ul / Bytes build + their error objects and traceback rendering.
 3. Exit codes and which stream every message goes to, and the stdout-before-crash flushing behaviour.
 4. A list of the divergence traps a naive implementer would fall into.
 5. Where the specialists CONTRADICT each other or left something unknown, say so explicitly and give the
    resolution you want the implementer to adopt (prefer whatever is directly evidenced by a transcript).

Reminder of hard bans to restate in the spec: ESM only, .mjs everywhere, explicit .mjs in imports,
no npm deps, no require/module.exports, never mention or use DataView/ArrayBuffer, no python.

Return the spec as detailed markdown. Do not write files.`,
  { label: 'synthesize-spec', phase: 'Spec', effort: 'high' }
)

// ─────────────────────────────────────────────────────────────────────────────
phase('Implement')

const implResult = await agent(
  `Implement the migration now. Write real files to disk under ${OUT}.

${GROUND_TRUTH}

===== AUTHORITATIVE SPEC =====
${spec}
===== END SPEC =====

Requirements recap (violating any of these invalidates the work):
 - Create a hierarchical library under ${OUT}/lib/ split into multiple focused .mjs modules, each exporting
   its interface, plus the entry point ${ENTRY}.
 - ESM only: import/export. NO require(), NO module.exports. Every relative import ends in '.mjs'.
 - Zero external packages. Only relative local imports and node: builtins.
 - NEVER use or mention DataView or ArrayBuffer, not even in a comment. Use Uint8Array / plain arrays.
   Do not access '.buffer' on a typed array.
 - Comments in the code should be sparse and purposeful, matching the terse style of the original script;
   the original had short Chinese inline comments on the build lines — you may keep brief equivalents.
 - Handle Python's surrogateescape argv decoding via /proc/self/cmdline (node:fs) with a safe fallback to
   process.argv when that is unavailable or misaligned.
 - stdout must match the reference BYTE FOR BYTE, including newlines. Write with a mechanism that does not
   mangle lone surrogates or non-ASCII (build a Uint8Array of the exact bytes and write it to fd 1).
 - Exit codes must match: 0 success, 2 argparse errors, 1 uncaught Python exception. Render the Python
   traceback to stderr for the exit-1 cases as faithfully as the spec describes (the [PYI-NNN:ERROR] line
   uses the current pid).
 - Respect the stdout-before-crash flushing behaviour the spec describes.

After writing every file, self-test: run at minimum the four documented sample cases and a spread of edge
cases (0, 255, 256, -1, empty --c, quote-containing --c, control chars, non-ASCII --c, missing args, bad
int, --help) comparing your output against ${EXE} with a diff, and fix anything that differs. Also verify
compliance mechanically, e.g.:
  grep -rnE 'require\\(|module\\.exports|DataView|ArrayBuffer' ${OUT} || echo CLEAN
  grep -rnE "from ['\\"]\\\\." ${OUT} | grep -v "\\\\.mjs['\\"]" || echo IMPORTS-OK
Fix any hit before finishing.

Return a concise report: the file tree you created, each module's responsibility, and the results of your
self-test (what you compared and whether it matched).`,
  { label: 'implement', phase: 'Implement', effort: 'high' }
)

log('Implementation written. Starting verification.')

// ─────────────────────────────────────────────────────────────────────────────
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
        required: ['title', 'severity', 'repro', 'expected', 'actual'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          repro: { type: 'string', description: 'exact shell command that demonstrates the divergence' },
          expected: { type: 'string', description: 'what the reference executable produces' },
          actual: { type: 'string', description: 'what the node implementation produces' },
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
    real: { type: 'boolean', description: 'true only if you personally re-ran the repro and saw the divergence' },
    reasoning: { type: 'string' },
    correctedRepro: { type: 'string' },
  },
}

const FUZZ_LENSES = [
  { key: 'samples-and-happy', prompt:
    `Differential-test the HAPPY PATH at volume. Loop over every value 0..255 for --a and for --b (that is
512 comparisons, script it) and a large corpus of --c values that are pure ASCII (so code-point length ==
byte length): empty, single chars across 0x20..0x7e, strings with quotes/double-quotes/both, backslashes,
tabs, newlines, CR, C0 controls, DEL, long strings, repeated chars, and the four documented sample cases.
Compare stdout, stderr and exit code against the reference for each. Script the whole thing in bash and
report only the mismatches.` },
  { key: 'argparse-abuse', prompt:
    `Differential-test the ARGPARSE surface: --help, -h, --h, --he; every combination of present/absent
required args (8 combos); '--a=1' vs '--a 1'; repeated options; unknown options ('-a', '--ab', '--xyz',
'-x'); positional junk in various positions; bare '--' leading/middle/trailing; values that look like
options ('--c --b', '--c -1', '--a -3', '--c -h'); empty-string values; missing value at end of argv;
invalid int values including ones needing repr escaping (quote, backslash, newline, non-ASCII, control
char); '--help' combined with missing/invalid args in both orders; no arguments at all. Compare stdout,
stderr AND exit code. Ignore only the [PYI-NNN:ERROR] pid line when diffing stderr, but flag if it is
absent when it should be present.` },
  { key: 'unicode-and-bytes', prompt:
    `Differential-test UNICODE and RAW BYTES. Cover --c with: Latin-1 accented chars, Greek/Cyrillic, CJK,
emoji (BMP and astral), combining marks, ZWJ family emoji, RTL marks, U+0000 (if passable), NBSP, and
mixed ASCII+non-ASCII — these mostly produce exit-1 StreamErrors, so confirm the exact 'expected X, found Y'
numbers and the stdout-before-crash content. Then raw invalid UTF-8 via printf: $'a\\xffb', $'\\xe9',
$'\\xc3', $'\\xc3\\x28', $'\\xed\\xa0\\x80', $'\\xc0\\x80', $'\\xf5\\x80\\x80\\x80', $'\\xff\\xfe', a bad byte at
position 0 / middle / end, and multiple bad bytes (which position is reported?). Also raw bad bytes inside
the --a value. Compare stdout, stderr (minus the pid line) and exit code.` },
  { key: 'int-and-overflow', prompt:
    `Differential-test the INT converter and construct's range errors. Cover: 0, 255, 256, -1, -256, 1000,
huge (10^20, 10^100), '+5', '007', '-0', '1_0', '+1_0', '_1', '1_', '1__0', whitespace-padded in every
ASCII whitespace char, unicode-whitespace-padded (NBSP, EM SPACE, IDEOGRAPHIC SPACE), unicode decimal
digits (Arabic-Indic, Devanagari, fullwidth), superscript digits, '0x10', '0b1', '0o7', '1e2', '1.0',
'.5', 'abc', '', ' ', 'nan', 'inf', 'None', '५५'. For each compare stdout, stderr (minus pid line) and
exit code against the reference. Pay special attention to the exact 'invalid int value: ...' repr and to
the 'given value N' number for out-of-range values, and to whether the traceback frame line number
differs between --a and --b failing.` },
]

let confirmed = []
let round = 0
let dry = 0

while (dry < 2 && round < 4) {
  round++
  phase(round === 1 ? 'Verify' : `Repair`)

  const lensPrompt = extra => `You are differentially testing a Node.js reimplementation against its
reference Python executable.

  reference : ${EXE}
  candidate : node ${ENTRY}

Both take the same arguments. Run them side by side and find every observable divergence in stdout,
stderr, and exit code. The ONLY tolerated difference is the numeric pid in the '[PYI-NNN:ERROR]' stderr
line. Trailing newlines and whitespace matter — compare with cmp/diff on captured files, not by eyeballing.

Never run the 'python' command. Script your comparisons in bash so you can cover high volume; a helper
function that runs both, diffs stdout and stderr and exit code, and prints only mismatches is the right
approach. Be careful that your harness itself passes raw bytes faithfully (use printf and arrays, avoid
shell mangling) — before reporting a finding, sanity-check that your harness is not the thing that is broken.

${GROUND_TRUTH}

YOUR LENS: ${extra}

Report ONLY genuine divergences you actually observed, with the exact repro command. If everything matches,
return an empty findings array. Do not edit any files.`

  const rawFindings = (await parallel(FUZZ_LENSES.map(l => () =>
    agent(lensPrompt(l.prompt), { label: `fuzz:${l.key}`, phase: round === 1 ? 'Verify' : 'Repair',
                                  schema: FINDINGS_SCHEMA, effort: 'high' })
  ))).filter(Boolean).flatMap(r => r.findings || [])

  let staticFindings = []
  if (round === 1) {
    const review = await agent(
      `Audit the generated code under ${OUT} for RULE COMPLIANCE and latent correctness bugs (not style).

Hard rules that must hold — verify each mechanically and by reading:
  1. ESM only: no require(, no module.exports, no __dirname/__filename misuse. All files end in .mjs.
  2. Every relative import specifier ends in '.mjs'.
  3. Zero external packages: only relative imports and 'node:*' builtins. No bare package specifiers.
  4. The strings 'DataView' and 'ArrayBuffer' must appear NOWHERE, including comments. Also flag any
     '.buffer' access on a typed array as a violation of the spirit of that ban.
  5. No python invocation, no child_process, no embedded Python source.
  6. The library is genuinely hierarchical: multiple focused modules under ${OUT}/lib/ exporting interfaces,
     not one monolith with a token second file.
Report each violation as a finding with the file and line.

Then read for LATENT bugs that volume fuzzing might miss: code-point vs UTF-16 length confusion
(''.length vs [...''].length) anywhere a Python len() is modelled; surrogate pair handling; the
surrogateescape encode/decode path; hex formatting case and padding; quote-selection branch for bytes repr;
off-by-one in argparse ordering/precedence; unflushed or double-flushed stdout; writes to fd 1 that could
be truncated or reordered relative to the exit; exceptions thrown while formatting an error.
For each latent bug give a concrete repro command that would expose it.

Do not edit files.`,
      { label: 'review:compliance', phase: 'Verify', schema: FINDINGS_SCHEMA, effort: 'high' }
    )
    staticFindings = (review && review.findings) || []
  }

  const all = [...rawFindings, ...staticFindings]
  if (!all.length) { dry++; log(`Round ${round}: no findings (dry ${dry}/2)`); continue }
  dry = 0
  log(`Round ${round}: ${all.length} candidate findings -> adversarial verification`)

  const verified = (await parallel(all.map(f => () =>
    agent(
      `Adversarially verify this claimed defect in the Node reimplementation at ${ENTRY}
(reference: ${EXE}). Your default posture is SKEPTICAL: many claims are harness artifacts, shell-quoting
mistakes, or the tolerated pid difference.

CLAIM: ${f.title}
SEVERITY CLAIMED: ${f.severity}${f.file ? `\nFILE: ${f.file}` : ''}
REPRO: ${f.repro}
EXPECTED (reference): ${f.expected}
ACTUAL (candidate): ${f.actual}

Actually RUN both programs yourself with that repro (fix obvious shell-quoting problems in the repro if
needed and report the corrected form). Set real=true ONLY if you personally reproduce a genuine divergence
in stdout, stderr (ignoring the [PYI-NNN:ERROR] pid number), or exit code, OR it is a hard-rule violation
(require/module.exports/DataView/ArrayBuffer/external import/non-.mjs) that you confirmed by reading the
file. Otherwise real=false. Never run the 'python' command. Do not edit files.`,
      { label: `verify:${f.title.slice(0, 40)}`, phase: round === 1 ? 'Verify' : 'Repair',
        schema: VERDICT_SCHEMA, effort: 'high' }
    ).then(v => ({ ...f, verdict: v }))
  ))).filter(Boolean).filter(f => f.verdict && f.verdict.real)

  if (!verified.length) { dry++; log(`Round ${round}: 0/${all.length} findings survived verification (dry ${dry}/2)`); continue }

  confirmed.push(...verified)
  log(`Round ${round}: ${verified.length} confirmed defects -> repairing`)

  await agent(
    `Fix these CONFIRMED defects in the Node.js reimplementation under ${OUT}. Each was independently
reproduced against the reference executable ${EXE}.

${verified.map((f, i) => `--- DEFECT ${i + 1} [${f.severity}] ${f.title}
${f.file ? `file: ${f.file}\n` : ''}repro:    ${f.verdict.correctedRepro || f.repro}
expected: ${f.expected}
actual:   ${f.actual}
verifier notes: ${f.verdict.reasoning}`).join('\n\n')}

${GROUND_TRUTH}

Edit the files to fix every one. Preserve the hierarchical module structure and all hard rules (ESM only,
.mjs suffixes on files and relative imports, zero external deps, never mention DataView or ArrayBuffer,
no python). After each fix, re-run its repro against both programs and confirm they now agree. Then re-run
the four documented sample cases plus a broad regression sweep to make sure you did not break anything.
Report what you changed and the verification results.`,
    { label: `repair:round-${round}`, phase: 'Repair', effort: 'high' }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Final')

const final = await agent(
  `Final acceptance check of the Node.js migration at ${ENTRY} against ${EXE}.

Write a thorough bash harness that compares stdout, stderr (ignoring only the [PYI-NNN:ERROR] pid number)
and exit code across a broad matrix: the four documented sample cases; --a and --b sweeping 0..255 plus
out-of-range values; a spread of --c values (empty, ASCII incl. quotes/backslash/controls, non-ASCII,
emoji, raw invalid UTF-8); every argparse failure mode; --help and -h. Report the pass/fail tally and the
exact repro for anything that still differs.

Also re-verify the hard rules mechanically and report the raw command output for each:
  find ${OUT} -type f | sort
  grep -rnE 'require\\(|module\\.exports|DataView|ArrayBuffer' ${OUT}   (must be empty)
  grep -rnE "^\\\\s*import .* from ['\\"][^.n]" ${OUT}                     (bare specifiers other than node: — must be empty)
  grep -rnE "from ['\\"]\\\\.[^'\\"]*['\\"]" ${OUT} | grep -v '\\\\.mjs'      (relative imports missing .mjs — must be empty)
  node --check on each .mjs file

Do not make code changes unless you find an outright failure, in which case fix it and re-verify.
Return: the tally, any remaining divergence, the final file tree, and the raw output of the rule checks.`,
  { label: 'final-acceptance', phase: 'Final', effort: 'high' }
)

return {
  confirmedDefectsFixed: confirmed.length,
  rounds: round,
  implementation: implResult,
  finalAcceptance: final,
}
