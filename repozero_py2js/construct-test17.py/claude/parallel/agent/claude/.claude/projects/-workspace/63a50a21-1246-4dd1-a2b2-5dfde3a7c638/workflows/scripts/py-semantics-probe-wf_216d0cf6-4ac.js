export const meta = {
  name: 'py-semantics-probe',
  description: 'Probe test17_executable in parallel to pin down Python int(), bytes repr, argparse, and construct semantics',
  phases: [
    { title: 'Probe', detail: 'parallel dimension probes against the executable' },
    { title: 'Critique', detail: 'completeness critic finds unprobed corners' },
  ],
}

const EXE = '/workspace/dataset/test17_executable'

const COMMON = `
You are reverse-engineering the behavior of a PyInstaller-frozen Python program by BLACK-BOX PROBING ONLY.
The executable is at ${EXE}. Run it like: ${EXE} --a 1 --b 1 --c ab --d 2 --e cd --f 1 --g 2

The original Python source is:
---
import argparse, construct
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=int, required=True)
    parser.add_argument('--b', type=int, required=True)
    parser.add_argument('--c', type=str, required=True)
    parser.add_argument('--d', type=int, required=True)
    parser.add_argument('--e', type=str, required=True)
    parser.add_argument('--f', type=int, required=True)
    parser.add_argument('--g', type=int, required=True)
    args = parser.parse_args()
    format1 = construct.Int8ul.build(args.a)
    format2 = construct.Int16ul.build(args.b)
    format3 = construct.Bytes(args.d).build(args.c.encode())
    format4 = construct.Int8ul.build(args.f)
    format5 = construct.Bytes(args.g).build(args.e.encode())
    format6 = construct.Int8ul.build((args.f + args.g) % 256)
    format7 = construct.Int8ul.build((args.a + args.b) % 256)
    print(format1); print(format2); print(format3)
    print(format4); print(format5); print(format6); print(format7)
---

Rules:
- DO NOT run 'python' or 'python3'. Only run the executable directly.
- You may write helper shell/node scripts under /tmp to batch many probes.
- Capture stdout and stderr SEPARATELY and record the exit code for every probe.
- Note: the "[PYI-NNN:ERROR]" line contains the process PID and is non-deterministic. Ignore its number.

Run MANY probes (at least 40). Report ONLY hard evidence you actually observed, plus clearly-labeled inferences.
Your final message is consumed by a program, not a human. Be dense and precise.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'rules', 'observations', 'gotchas'],
  properties: {
    dimension: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, implementable rules derived from observation',
      items: { type: 'string' },
    },
    observations: {
      type: 'array',
      description: 'Concrete probe results: the exact argv, exact stdout, exact stderr summary, exit code',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'stdout', 'exitCode'],
        properties: {
          argv: { type: 'string' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'integer' },
        },
      },
    },
    gotchas: {
      type: 'array',
      description: 'Things a naive JS reimplementation would get wrong',
      items: { type: 'string' },
    },
  },
}

const DIMENSIONS = [
  {
    key: 'pyint',
    prompt: `${COMMON}

DIMENSION: Python's int(str) coercion, as used by argparse type=int for --a --b --d --f --g.

Determine EXACTLY which strings are accepted and what value they produce, and which produce
"error: argument --a: invalid int value: '<repr of the string>'" (exit 2).

Probe at minimum:
- leading/trailing ASCII whitespace (space, tab \\t, newline \\n, \\r, \\v, \\f) around digits
- UNICODE whitespace around digits: U+00A0 NBSP, U+2000..U+200A, U+3000 ideographic space, U+2028, U+205F, U+FEFF
- sign handling: "+5", "-5", "++5", "+-5", " + 5", "5-", "-"
- underscore separators: "1_2", "_12", "12_", "1__2", "1_", "+1_2", "1_2_3"
- non-decimal literals: "0x10", "0b1", "0o7", "1e3", "1.0", "inf", "nan"
- unicode decimal digits (Unicode category Nd): Arabic-Indic U+0660-0669 (٠١٢٣٤٥٦٧٨٩),
  Devanagari U+0966-096F (०१२३४५६७८९), fullwidth U+FF10-FF19 (０１２３４５６７８９),
  and MIXING ascii with unicode digits e.g. "1٥"
- superscript/other numeric-but-not-Nd chars: "²" (U+00B2), "½" (U+00BD), "Ⅷ" (U+2167) — expect REJECT
- empty string, string of only whitespace
- very large integers (30+ digits) — do they parse? (check the value echoed in the downstream error message)

CRITICAL: to read back the parsed VALUE, use --d: the error message for a bad Bytes length is
"bytes object of wrong length, expected <VALUE>, found <N>". That echoes the exact parsed integer.
Use that as your oracle for what integer a string parsed to. For accepted-but-in-range values use stdout bytes.

Also determine the EXACT repr used in the "invalid int value: '...'" message for strings containing
quotes, backslashes, newlines, and non-ASCII (Python repr of a str, which differs from repr of bytes:
non-ASCII printable chars are NOT escaped in Python 3 str repr).`,
  },
  {
    key: 'bytesrepr',
    prompt: `${COMMON}

DIMENSION: Python 3 bytes.__repr__ — how print(b'...') renders. This is what stdout shows.

You control the bytes content via --c (with --d = byte length of its UTF-8 encoding) and --e/--g.
Remember --d must equal len(args.c.encode('utf-8')) exactly or you get an error instead of output.

Determine EXACTLY:
1. Quote selection: when is b'...' used vs b"..."? Probe content with: no quotes; only single quote;
   only double quote; BOTH single and double quotes. Report the escaping applied in each case.
2. Which byte values are emitted literally vs escaped. Probe the full range 0x00-0xFF.
   Specifically confirm the special short escapes: \\t (0x09), \\n (0x0A), \\r (0x0D), \\\\ (0x5C).
   Check whether 0x07 (bell), 0x08 (backspace), 0x0B (vertical tab), 0x0C (form feed), 0x1B (escape)
   use short escapes like \\a \\b \\v \\f \\e or hex escapes \\x07 etc.
   Check 0x7F (DEL) and all bytes >= 0x80.
3. The exact hex escape format: lowercase or uppercase hex digits? Always 2 digits?

To emit arbitrary bytes, use a shell that can produce them, e.g.:
  ${EXE} --a 1 --b 1 --c "$(printf '\\x07\\x08')" --d 2 --e ab --f 1 --g 2
CAUTION: the shell cannot pass a NUL byte (0x00) in an argv string — note that limitation.
Also note: --c is decoded from argv bytes as UTF-8 by Python, so to get a specific byte >= 0x80
you must pass the UTF-8 encoding of the character whose encoding you want. Design probes carefully:
e.g. the character U+00FF encodes to UTF-8 as \\xc3\\xbf (2 bytes), so --d must be 2 and output is b'\\xc3\\xbf'.
This means you can only produce byte sequences that are VALID UTF-8. Report that constraint,
and cover as much of 0x00-0xFF as reachable (all bytes 0x01-0x7F directly; 0x80-0xFF via multibyte sequences).

Build a definitive byte-value -> rendering table for 0x01..0xFF.`,
  },
  {
    key: 'argparse-errors',
    prompt: `${COMMON}

DIMENSION: argparse behavior — usage text, error messages, exit codes, and option-parsing rules.

Determine EXACTLY (character-for-character, including the program name "test17_executable"):
1. The full --help output and its exit code. Also -h. Also -h combined with other args, and -h AFTER
   an invalid value (which wins?). Also "--help" placed after an unrecognized option.
2. The usage line printed on error, and the exact "test17_executable: error: ..." message text for:
   - no args at all; some args missing (confirm the ORDER in which missing args are listed:
     is it declaration order --a --b --c --d --e --f --g, or the order they were omitted?)
   - unrecognized option: single unknown, multiple unknowns, unknown mixed with extra positionals.
     Report the exact joining (spaces?) of the unrecognized items.
   - option present with no value: "--a" at end of argv, and "--a --b 1"
   - invalid int value
   Confirm which of these takes PRECEDENCE when several apply at once (e.g. an unrecognized option
   AND a missing required option AND an invalid int).
3. Option syntax forms: "--a 5", "--a=5", "--a=" (empty), abbreviations. Since all long options are a
   single letter (--a..--g), test whether any prefix matching applies, and test "--" (bare double dash)
   both alone and before/after values.
4. Values that look like options: "--c -5", "--c -x", "--c --b", "--c=-x", "--a -5", "--d -3".
   argparse has a "negative number matcher": since this parser has NO options that look like negative
   numbers, arguments matching a negative-number pattern are treated as VALUES not options. Determine
   the exact pattern (does "-5" work? "-5.5"? "-5x"? "-.5"? "-5e3"?).
5. Repeated options ("--a 1 --a 9") — last wins?
6. Whether stdout or stderr is used for help vs errors.

Report exit codes for every case.`,
  },
  {
    key: 'construct-build',
    prompt: `${COMMON}

DIMENSION: the 'construct' library's build() semantics and its EXACT exception output on stderr.

Three builders are used: Int8ul.build(int), Int16ul.build(int), Bytes(n).build(bytes).

Determine EXACTLY:
1. Int8ul valid range and Int16ul valid range (probe boundaries: -1, 0, 255, 256 / -1, 0, 65535, 65536).
2. The COMPLETE stderr traceback text for an Int8ul out-of-range failure and an Int16ul one.
   Reproduce it line by line verbatim (excluding the non-deterministic PYI-NNN number).
   Note the "given value X" tail and how very large X is rendered.
3. The COMPLETE stderr traceback for Bytes(n).build when len(data) != n, and separately when n is NEGATIVE.
   Note the two DIFFERENT construct/core.py line numbers involved (one for each case) and the message text.
4. The "File \\"test17.py\\", line NN, in main" line number for EACH of the 7 build sites.
   Map: which line number appears when format1 fails, format2 fails, format3 fails, format4 fails,
   format5 fails? (format6/format7 may be unreachable — say so if you cannot trigger them, and explain why.)
   To fail format4 you need format1..3 to succeed first, etc.
5. Bytes(0).build(b'') — does it succeed and print b''?
6. Confirm that when ANY build fails, NOTHING is printed to stdout (because all prints happen after all builds).
7. Exit code on an unhandled exception.
8. Whether the modulo results ((f+g)%256 and (a+b)%256) can ever be negative given the constraints
   enforced by the earlier builds. Reason it through and state the conclusion.`,
  },
]

phase('Probe')
const results = await parallel(
  DIMENSIONS.map((d) => () =>
    agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: SCHEMA })
  )
)

const good = results.filter(Boolean)
log(`probed ${good.length}/${DIMENSIONS.length} dimensions`)

phase('Critique')
const critique = await agent(
  `${COMMON}

You are a COMPLETENESS CRITIC. Four probe agents characterized these dimensions of the executable's
behavior. Here is what they found:

${JSON.stringify(good, null, 2)}

Your job: find what they MISSED or got WRONG. Actually RUN new probes against ${EXE} to check.
Focus on:
- Contradictions between the four reports.
- Claims stated as rules but not backed by an observation.
- Interaction cases spanning two dimensions (e.g. a unicode-digit --d combined with a unicode --c;
  an out-of-range --a combined with a length-mismatched --c: which error fires first?).
- Anything about ORDERING of validation and error precedence.
- Byte values in the repr table that were never actually observed.
- Whether stdout is fully absent on failure, and whether output is line-buffered vs block-buffered
  when piped (does partial stdout ever appear?).

Run at least 25 fresh probes. Report only DISCREPANCIES and NEW findings, each with the probe evidence.`,
  { label: 'completeness-critic', phase: 'Critique', schema: {
    type: 'object',
    additionalProperties: false,
    required: ['discrepancies', 'newFindings'],
    properties: {
      discrepancies: { type: 'array', items: { type: 'string' } },
      newFindings: { type: 'array', items: { type: 'string' } },
    },
  } }
)

return { dimensions: good, critique }
