export const meta = {
  name: 'break-test15-port',
  description: 'Adversarially hunt for stdout/exit-code divergence between the Node port and the reference executable',
  phases: [
    { title: 'Attack', detail: 'independent breakers per surface' },
    { title: 'Confirm', detail: 'reproduce and minimise each reported divergence' },
  ],
}

const HARNESS = `
TOOLS
  Reference:  /workspace/dataset/test15_executable
  Port:       node /output/test15.mjs
  Differ:     node /workspace/difftest.mjs -- --a A --b B --c C --d D     (one case)
              node /workspace/difftest.mjs cases.json                     (JSON array of argv arrays)
              node /workspace/difftest.mjs --fuzz <N> <seed>              (built-in fuzzer)
  The differ compares stdout, exit status, and stderr (with the PyInstaller pid
  normalised). It prints "MISMATCH <kinds> <argv>" per divergence and a tally.
  A cases.json file is the most reliable way to pass awkward strings: write it with
  a small Node script so you control the exact code points, then run the differ on it.
  Do NOT use the \`python\` command; it is unavailable.

CONTEXT
  The port reimplements this Python program in Node with no dependencies:
    parser: argparse with four required str options --a --b --c --d
    enc1 = base58.b58encode(args.a.encode()); enc2 same for b
    dec1 = base58.b58decode(args.c);          dec2 same for d
    print(enc1); print(enc2); print(dec1); print(dec2)
  Port sources live under /output (test15.mjs plus lib/**). Read them if it helps you
  aim, but judge only by observed behaviour.

WHAT COUNTS
  Priority 1: any difference in stdout bytes.
  Priority 2: any difference in exit status.
  Priority 3: any difference in stderr (pid field excluded).
  Report the exact argv that diverges. If you find none in your area, say so plainly
  and list what you tried — a clean report is a useful result, invented bugs are not.
  Note: run at least 30 distinct probes in your area before concluding it is clean.
`

const FINDINGS = {
  type: 'object',
  required: ['area', 'probesRun', 'divergences', 'triedAndClean'],
  properties: {
    area: { type: 'string' },
    probesRun: { type: 'integer' },
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        required: ['argv', 'kind', 'refOutput', 'portOutput'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          kind: { type: 'string', description: 'stdout | exit | stderr' },
          refOutput: { type: 'string' },
          portOutput: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
    triedAndClean: { type: 'array', items: { type: 'string' } },
  },
}

phase('Attack')

const AREAS = [
  {
    key: 'bytes-repr',
    prompt: `${HARNESS}
YOUR AREA: the printed representation of decoded bytes.
Hunt for any byte value or combination whose rendering differs. Systematically cover
every byte 0x00..0xff as the sole decoded byte, then as part of longer sequences.
Remember you can produce an arbitrary byte string on the decode side by first encoding
it: run the REFERENCE with --a <payload> to get the base58 text, then feed that text as
--c to both programs. Pay special attention to: quote-selection when the payload
contains ' and/or ", backslashes, tabs/newlines/CRs, DEL (0x7f), all of 0x80..0xff, and
long mixed payloads. Also cover payloads generated from multi-byte UTF-8 input.`,
  },
  {
    key: 'argparse',
    prompt: `${HARNESS}
YOUR AREA: command-line parsing.
Try to find any argv the two programs disagree about. Cover: --x=V vs --x V, repeated
options, options in unusual order, missing options (each subset), unknown options,
bare positionals, the -- separator (before/after/multiple), empty-string values, values
starting with a single or double dash, values that look like negative numbers
(-5 -5.5 -.5 -5. -0 -1e3 -0x10), values containing spaces or '=', abbreviations of
--help (--h --he --hel --help -h) and bogus abbreviations (--a b vs --ab), single '-'
as a value, '-h' as a VALUE of --a, unicode values, very long values, and no arguments
at all. Check stdout AND exit status AND stderr wording for each.`,
  },
  {
    key: 'decode-edges',
    prompt: `${HARNESS}
YOUR AREA: base58 decoding edge cases.
Cover: empty string; strings of only '1's; leading '1's followed by data; '1' in the
middle; every character NOT in the alphabet (0 O I l, punctuation, digits, whitespace)
in leading / middle / trailing position; leading vs trailing whitespace of many kinds
(space, tab, newline, CR, vertical tab, form feed, 0x1c-0x1f, NBSP U+00A0, U+2000..U+200A,
U+2028, U+2029, U+202F, U+205F, U+3000, and the NON-whitespace lookalikes U+200B, U+2060,
U+FEFF, U+180E, U+001B); mixed whitespace runs; non-ASCII input at various code-point
positions including astral characters (emoji) and combinations of non-ASCII with invalid
ASCII; strings hundreds of characters long; and inputs where --c is valid but --d is not
(and vice versa) to check which error surfaces. Verify exception TYPE, message, and the
reported position index in every failing case.`,
  },
  {
    key: 'encode-edges',
    prompt: `${HARNESS}
YOUR AREA: base58 encoding edge cases and arbitrary-precision correctness.
Cover: empty input; every single ASCII character; two- and three-character inputs that
straddle 58-power boundaries; inputs whose UTF-8 encoding is 2, 3 and 4 bytes per
character (é, €, emoji, combining marks, CJK); mixed ASCII/non-ASCII; inputs of length
1, 2, 3, 15, 16, 17, 31, 32, 33, 63, 64, 65 characters (the port batches big-integer work
16 base58 digits at a time, so boundaries near multiples of 16 digits matter most);
inputs of several hundred and several thousand characters; inputs that are all the same
character; and round-trips (encode with --a, feed the result to --c, confirm the bytes
come back). Look hard for any digit dropped, duplicated, or mis-ordered at a batch
boundary.`,
  },
  {
    key: 'traceback-linecache',
    prompt: `${HARNESS}
YOUR AREA: stderr rendering, which depends on the current working directory.
The reference resolves "test15.py" through Python's linecache, so its traceback shows a
source line only when a readable test15.py sits in the cwd — and it shows whatever that
file's line 13 or 14 contains, with carets positioned from the compiled column offsets.
Run the differ from many different working directories with many different test15.py
files planted in them, and find any case where the port's traceback differs. Vary:
no file at all; the real file (/workspace/dataset/test15.py); a file with fewer than 13
lines; line 13 blank; line 13 whitespace-only; line 13 very short (1-5 chars); line 13
exactly 24 and exactly 25 characters; line 13 with leading indentation of various widths
(spaces and tabs); line 13 containing wide CJK characters or emoji before column 31;
line 13 containing multi-byte characters at columns 0-7; a file with CRLF line endings;
a file that is not valid UTF-8; a directory named test15.py; an unreadable file.
Test both the --c failure (line 13) and the --d failure (line 14).`,
  },
  {
    key: 'ordering-io',
    prompt: `${HARNESS}
YOUR AREA: output ordering, streams, flushing and exit status.
Verify: nothing reaches stdout when either decode fails; which of --c and --d is blamed
when both are invalid; that stdout is exactly four newline-terminated lines on success
with no trailing extras; exit statuses for success / decode failure / argparse failure /
--help. Check behaviour when stdout is a pipe, a file, and /dev/full; when stdout is
closed; and with very large outputs (a multi-kilobyte encode result) to be sure nothing
is truncated by an early exit. Compare byte counts with wc -c and od, not just eyeballing.`,
  },
]

const attacks = await pipeline(
  AREAS,
  (area) => agent(area.prompt, { label: `attack:${area.key}`, phase: 'Attack', schema: FINDINGS }),
  (report, area) => {
    const found = (report?.divergences || []).slice(0, 8)
    if (found.length === 0) return { area: area.key, report, confirmed: [] }
    return parallel(found.map((d, i) => () =>
      agent(`${HARNESS}
A previous agent reported this divergence in the "${area.key}" area. Independently
REPRODUCE it and decide whether it is real. Run the differ on the exact argv yourself.

  argv:  ${JSON.stringify(d.argv)}
  kind:  ${d.kind}
  claim: reference produced ${JSON.stringify(d.refOutput)}
         port produced      ${JSON.stringify(d.portOutput)}
  note:  ${d.note || '(none)'}

Default to refuted=true unless you personally observe the divergence. Environment-
dependent artefacts (the PyInstaller pid, absolute paths, the working directory the
previous agent happened to use) are NOT divergences unless the port is wrong for the
SAME cwd. If it is real, minimise it to the smallest argv that still diverges and state
exactly which bytes differ.`,
        {
          label: `confirm:${area.key}:${i + 1}`,
          phase: 'Confirm',
          schema: {
            type: 'object',
            required: ['refuted', 'explanation'],
            properties: {
              refuted: { type: 'boolean' },
              minimalArgv: { type: 'array', items: { type: 'string' } },
              kind: { type: 'string' },
              explanation: { type: 'string' },
            },
          },
        }))).then((verdicts) => ({
      area: area.key,
      report,
      confirmed: found
        .map((d, i) => ({ ...d, verdict: verdicts[i] }))
        .filter((d) => d.verdict && d.verdict.refuted === false),
    }))
  },
)

const results = attacks.filter(Boolean)
const realBugs = results.flatMap((r) => r.confirmed.map((c) => ({ area: r.area, ...c })))
log(`confirmed divergences: ${realBugs.length}`)

return {
  perArea: results.map((r) => ({
    area: r.area,
    probesRun: r.report?.probesRun,
    reported: (r.report?.divergences || []).length,
    confirmed: r.confirmed.length,
    triedAndClean: r.report?.triedAndClean || [],
  })),
  realBugs,
}
