export const meta = {
  name: 'verify-test17-port',
  description: 'Adversarially attack the Node port of test17.py and code-review it against the reference executable',
  phases: [
    { title: 'Attack', detail: 'independent lenses each try to find a divergence' },
    { title: 'Review', detail: 'code review of the port modules' },
    { title: 'Judge', detail: 'confirm or refute each reported divergence' },
  ],
}

const CONTEXT = `
There is a Python program, frozen into the executable /workspace/dataset/test17_executable,
and a Node.js ESM port of it at /output/test17.mjs (library modules under /output/lib/).

The Python original:
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

GROUND RULES:
- NEVER run 'python' or 'python3'. Only run the executable directly. It is the source of truth.
- Run the port as: node /output/test17.mjs <args>
- Compare stdout, stderr and exit code SEPARATELY for each input.
- The "[PYI-NNN:ERROR]" banner embeds the process id, so that NUMBER differs legitimately between
  runs and between the two programs. Normalise it away; never report it as a divergence.
- A ready-made comparison helper exists at /tmp/diffharness.mjs exporting runPair(argvArray) ->
  {ok, ref:{stdout,stderr,status}, port:{stdout,stderr,status}}. Import it from a script in /tmp
  (e.g. 'import { runPair } from "/tmp/diffharness.mjs"'). Use it; it already normalises the PID.
- Write your probe scripts under /tmp, never under /output.
- Do NOT edit anything in /output. You are only finding problems, not fixing them.

Report each divergence with the EXACT argv array that triggers it and both observed outputs.
Your final message is consumed by a program. Be precise and dense.
`

const DIVERGENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'casesRun', 'divergences'],
  properties: {
    lens: { type: 'string' },
    casesRun: { type: 'integer' },
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'refOutput', 'portOutput', 'explanation'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          refOutput: { type: 'string', description: 'stdout/stderr/exit of the executable' },
          portOutput: { type: 'string', description: 'stdout/stderr/exit of the Node port' },
          explanation: { type: 'string' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
}

const LENSES = [
  {
    key: 'int-grammar',
    prompt: `${CONTEXT}
LENS: Python int() grammar for --a --b --d --f --g.
Attack the port's integer parser. Try to find ANY string the two programs disagree on.
Ideas: ASCII and Unicode whitespace padding (all of U+0009-000D, U+001C-001F, U+0020, U+0085,
U+00A0, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF, U+200B);
signs and doubled signs; underscore grouping in every legal and illegal position; non-ASCII
decimal digits from MANY different Nd blocks (Arabic-Indic, Extended Arabic-Indic, Devanagari,
Bengali, Thai, Khmer, Mongolian, fullwidth, Osmanya, and the mathematical digit runs
U+1D7CE-U+1D7FF which are FIVE adjacent blocks of ten, plus U+1FBF0-U+1FBF9 segmented digits);
numeric characters that are NOT Nd (superscripts, fractions, Roman numerals, circled digits,
U+3007 IDEOGRAPHIC NUMBER ZERO) which must be REJECTED; mixed-script digit strings;
enormous values (50+ digits, and values near 2**63 and 2**64); values with leading zeros.
Enumerate systematically - script a loop over every Nd codepoint you can find and compare.`,
  },
  {
    key: 'bytes-repr',
    prompt: `${CONTEXT}
LENS: stdout formatting - Python's bytes repr, and the byte payloads themselves.
Attack how the port renders printed bytes. --c must have --d equal to the UTF-8 byte length of
--c (same for --e/--g) for the program to reach the print stage.
Ideas: every quoting combination of ' and " in the payload; backslashes; the short escapes
\\t \\n \\r versus hex escapes for other controls; byte 0x7f; every byte 0x01-0x7f; high bytes
reached through multi-byte UTF-8 (2-, 3- and 4-byte sequences, including U+0080, U+07FF,
U+0800, U+FFFF, U+10000, U+10FFFF); characters whose UTF-8 encoding contains a byte equal to
0x27 or 0x22 or 0x5c (consider whether that is even possible in UTF-8 and say so);
zero-length payloads; long payloads (1000+ bytes); combining marks; surrogate pairs / astral
characters; U+FEFF; and the Int16ul little-endian byte order across the whole 0-65535 range
(sample widely, e.g. every value where the two bytes differ interestingly).
Also verify the checksum fields format6=(f+g)%256 and format7=(a+b)%256 across many combinations,
especially where the sum exceeds 255 and 65535.`,
  },
  {
    key: 'argparse',
    prompt: `${CONTEXT}
LENS: argparse emulation - option syntax, precedence, exit codes, help text.
Attack the port's argument parser.
Ideas: --opt value vs --opt=value vs --opt= (empty) mixed in one command line; every prefix
abbreviation of --help (--h, --he, --hel, --help) and of the single-letter options; -h glued
forms (-h5, -hx, -h=, -h=5, -hhh); bare '-'; bare '--' in every position; multiple '--';
repeated options; options given out of order; unknown options (single, multiple, with and
without values, with '=' inline); values that look like options (-5, -5.5, -.5, -0, -5e3,
-0x1, -x, --b, '-1 2', ' -5', and negative numbers written with NON-ASCII digits like -٥);
empty-string values; values containing spaces, newlines and '='; the precedence when several
errors apply at once (invalid int AND missing required AND unrecognised, in different argv
orders); -h placed before, among and after invalid arguments; zero arguments; and the exact
--help text and its exit code. Check whether stdout vs stderr is chosen identically.`,
  },
  {
    key: 'errors-tracebacks',
    prompt: `${CONTEXT}
LENS: failure paths - construct exceptions, tracebacks, exit codes, and encoding errors.
Attack the port's error reporting. Compare stderr byte for byte (modulo the PID).
Ideas: Int8ul out of range at BOTH build sites (--a and --f) - the traceback line number must
differ between them; Int16ul out of range; Bytes length mismatch for --c/--d and for --e/--g
(again different line numbers); negative --d and negative --g; a negative length together with
a mismatched payload (which check wins?); gigantic --d (does the huge value echo exactly?);
several problems at once, to pin down which failure is reported;
and invalid UTF-8 in argv, which Python decodes with surrogateescape and then fails to
re-encode: pass raw bytes like \\xff, \\xfe, \\x80, \\xc3 alone, truncated multi-byte sequences,
overlong encodings (\\xc0\\x80), encoded surrogates (\\xed\\xa0\\x80), and values above U+10FFFF
(\\xf5\\x80\\x80\\x80) in --c, in --e, and in an integer option. Check single invalid bytes,
runs of consecutive invalid bytes, and invalid bytes at non-zero character positions
(including after an astral character, where Python's character index is not the UTF-16 index).
Use printf in bash to build these raw byte arguments. Also confirm stdout is EMPTY whenever a
build fails, and check the exit code for every failure class.`,
  },
]

phase('Attack')
const attacks = await parallel(
  LENSES.map((lens) => () =>
    agent(lens.prompt, { label: `attack:${lens.key}`, phase: 'Attack', schema: DIVERGENCE_SCHEMA })
  )
)

phase('Review')
const review = await agent(
  `${CONTEXT}
LENS: code review, not black-box testing.
Read every file under /output (test17.mjs and lib/**). Look for:
- logic that is wrong or fragile even if current tests pass (off-by-one, wrong operator
  precedence, BigInt vs Number mixing, mutation of shared state, regex anchoring mistakes);
- places where the code relies on Node-specific behaviour that could differ from Python;
- the /proc/self/cmdline argv recovery in lib/runtime/argv.mjs: is the "trailing N entries"
  assumption sound? What happens with NODE_OPTIONS set, with an empty-string argument, with
  no arguments at all, when /proc is unavailable, or when an argument contains a NUL?
  Actually TEST these: e.g. run with NODE_OPTIONS='--no-warnings' set, and with empty args.
- compliance with the task's hard requirements: ESM only (import/export, never require or
  module.exports), .mjs suffixes on every file, every import carrying its file extension,
  ZERO external npm packages (only node: builtins and local relative files), and NO use of
  DataView or ArrayBuffer anywhere (this is explicitly forbidden - check for TypedArrays,
  Buffer byte indexing, TextEncoder/TextDecoder too, and report anything questionable).
- Verify the whole thing actually runs cleanly: no warnings on stderr for a normal successful
  invocation, and no leftover debug output.
Report concrete defects with file:line. Prefer few high-confidence findings over speculation.`,
  { label: 'code-review', phase: 'Review', schema: {
    type: 'object',
    additionalProperties: false,
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['file', 'summary', 'severity', 'evidence'],
          properties: {
            file: { type: 'string' },
            line: { type: 'integer' },
            summary: { type: 'string' },
            severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
            evidence: { type: 'string' },
          },
        },
      },
    },
  } }
)

const claimed = attacks.filter(Boolean).flatMap((a) =>
  a.divergences.map((d) => ({ ...d, lens: a.lens }))
)
log(`${claimed.length} claimed divergences from ${attacks.filter(Boolean).length} lenses; ${review?.findings?.length ?? 0} review findings`)

phase('Judge')
const verdicts = await parallel(
  claimed.map((d) => () =>
    agent(
      `${CONTEXT}
A tester claims the following input makes the port diverge from the reference:

  argv: ${JSON.stringify(d.argv)}
  claimed reference output: ${d.refOutput}
  claimed port output: ${d.portOutput}
  claimed explanation: ${d.explanation}

Your job is to REFUTE this claim. Re-run both programs yourself with EXACTLY this argv and
compare stdout, stderr and exit code. Remember to normalise the [PYI-NNN] pid before comparing;
a difference in that number alone is NOT a divergence, and neither is any difference you cannot
reproduce. Default to refuted=true when uncertain.
Report whether a genuine, reproducible divergence exists.`,
      { label: `judge:${d.lens}`, phase: 'Judge', schema: {
        type: 'object',
        additionalProperties: false,
        required: ['refuted', 'reasoning'],
        properties: {
          refuted: { type: 'boolean' },
          reasoning: { type: 'string' },
          reproducedRef: { type: 'string' },
          reproducedPort: { type: 'string' },
        },
      } }
    ).then((v) => ({ claim: d, verdict: v }))
  )
)

const confirmed = verdicts.filter(Boolean).filter((v) => v.verdict && !v.verdict.refuted)
return {
  attackSummary: attacks.filter(Boolean).map((a) => ({ lens: a.lens, casesRun: a.casesRun, claimed: a.divergences.length, notes: a.notes })),
  confirmedDivergences: confirmed,
  refutedCount: verdicts.filter(Boolean).length - confirmed.length,
  reviewFindings: review?.findings ?? [],
}
