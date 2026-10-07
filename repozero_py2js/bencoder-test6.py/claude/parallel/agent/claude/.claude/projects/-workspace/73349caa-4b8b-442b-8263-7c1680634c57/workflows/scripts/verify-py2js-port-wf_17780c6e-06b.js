export const meta = {
  name: 'verify-py2js-port',
  description: 'Exhaustively fuzz and adversarially review a Python->Node.js port of test6.py',
  phases: [
    { title: 'Fuzz', detail: 'parallel differential fuzzers, one per input dimension' },
    { title: 'Triage', detail: 'confirm each reported divergence independently' },
    { title: 'Review', detail: 'static review lenses over the generated modules' },
    { title: 'Critic', detail: 'completeness critic: what was never exercised' },
  ],
}

const CONTEXT = `
# Context

A Python script was ported to Node.js ESM. You are VERIFYING the port, not rewriting it.

Source Python (/workspace/dataset/test6.py):
\`\`\`python
import argparse
import bencoder

parser = argparse.ArgumentParser()
parser.add_argument('--a', type=str, required=True)
parser.add_argument('--b', type=int, required=True)
args = parser.parse_args()

list_data = [args.a.encode('ascii'), args.b, [args.b]]
encoded = bencoder.encode(list_data)  # Encode nested list
decoded = bencoder.decode(encoded)  # Decode the encoded data
print(encoded)
print(decoded)
\`\`\`

Reference implementation (ground truth, a frozen PyInstaller binary):
  /workspace/dataset/test6_executable --a VAL --b VAL
NEVER run \`python\`. Only run the executable.

Port under test (all files under /output):
  node /output/test6.mjs --a VAL --b VAL

Module layout:
  /output/test6.mjs                     entry point
  /output/lib/unicode/properties.mjs    Unicode predicates (printable / Nd / int-whitespace)
  /output/lib/python/bytes.mjs          PyBytes: bytes as a plain Array of 0..255
  /output/lib/python/errors.mjs         exception types incl. UnicodeEncodeError, SystemExit
  /output/lib/python/codecs.mjs         encodeAscii (str.encode('ascii'))
  /output/lib/python/numbers.mjs        pyInt (Python int(str) grammar), returns BigInt|null
  /output/lib/python/repr.mjs           Python repr() for bytes/str/int/list/dict
  /output/lib/python/sys.mjs            stdout/stderr/exit/argv
  /output/lib/python/traceback.mjs      unhandled-exception rendering
  /output/lib/bencode/{encode,decode,index}.mjs
  /output/lib/argparse/{errors,formatter,parser,types,index}.mjs

# Differential harness

  node /tmp/harness/diff.mjs '["--a","x","--b","5"]'        # single case, JSON argv array
  node /tmp/harness/diff.mjs --file /tmp/cases-N.json       # batch

Batch file format: JSON array of {"name": "...", "argv": ["--a","x"]} objects (or bare argv
arrays). Use \\uXXXX JSON escapes for exotic characters. The harness normalises the
PyInstaller pid in the banner, compares stdout + stderr + exit status, and exits non-zero
on any divergence. Write your batch files to /tmp/ with a unique name.

A NUL byte cannot pass through execve(), so cases containing one are skipped — do not
report those as divergences.
`

const FUZZ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'casesRun', 'divergences'],
  properties: {
    dimension: { type: 'string' },
    casesRun: { type: 'integer' },
    notes: { type: 'string', description: 'Behaviours confirmed identical; interesting near-misses.' },
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'pythonOutput', 'nodeOutput'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          pythonOutput: { type: 'string', description: 'rc + stdout + stderr from the executable' },
          nodeOutput: { type: 'string', description: 'rc + stdout + stderr from the port' },
          suspectedCause: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['argv', 'reproduced', 'explanation'],
  properties: {
    argv: { type: 'array', items: { type: 'string' } },
    reproduced: { type: 'boolean', description: 'true only if you re-ran both and saw a real difference' },
    explanation: { type: 'string' },
    culpritFile: { type: 'string' },
    suggestedFix: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'findings'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'summary', 'severity', 'concreteTrigger'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          concreteTrigger: {
            type: 'string',
            description: 'Exact argv or condition that exposes it, or "static-only" if not runtime-reachable',
          },
        },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// Phase 1+2: fuzz each input dimension, triaging each dimension's divergences
// as soon as that dimension finishes (no barrier).
// ---------------------------------------------------------------------------

const DIMENSIONS = [
  {
    key: 'int-grammar',
    prompt: `Fuzz the --b integer parser exhaustively. Python's int(str) grammar: surrounding
whitespace, one optional +/- sign, Unicode Nd digits, underscores only BETWEEN digits.
Probe at least: huge magnitudes (100, 1000, 5000 digits), values straddling 2**31, 2**53,
2**63, 2**64, 2**1024; every underscore placement (leading, trailing, doubled, after sign,
between every digit); signs (++5, --5, +-5, "- 5", "-", "+"); leading zeros; every kind of
surrounding whitespace incl. \\u0009 \\u000a \\u000b \\u000c \\u000d \\u0020 \\u001c-\\u001f
\\u0085 \\u00a0 \\u1680 \\u2000-\\u200a \\u2028 \\u2029 \\u202f \\u205f \\u3000 \\ufeff \\u180e;
whitespace in the MIDDLE of digits; Unicode digits from MANY Nd blocks including
astral/non-BMP ones (\\u{1D7CE}-\\u{1D7D7} math bold, \\u{104A0} Osmanya, \\u{1E950} Adlam,
\\u{11066} Brahmi, \\uff10-\\uff19 fullwidth, \\u0660 Arabic-Indic, \\u06f0 ext Arabic-Indic,
\\u0966 Devanagari, \\u09e6 Bengali, \\u0e50 Thai, \\u17e0 Khmer, \\u1946 Limbu, \\ua9f0 Javanese,
\\uabf0 Meetei); MIXED digits from different blocks in one number; non-Nd numerics
(\\u00b2 \\u00bd \\u2160 \\u3007 \\u4e00); other bases (0x10, 0b1, 0o7, 1e3, inf, nan, 5.0, 5j).
Also verify the exact "invalid int value: ..." message text, which embeds Python's repr()
of the string. Run at least 400 cases across several batch files.`,
  },
  {
    key: 'ascii-codec',
    prompt: `Fuzz the --a value through str.encode('ascii'). Every code point >= 0x80 must raise
UnicodeEncodeError with an exact message naming the FIRST offending character and its
code-point POSITION (counted in code points, not UTF-16 units). Probe: offending char at
position 0, in the middle, at the end, after astral characters (so UTF-16 index != code
point index -- e.g. "\\u{1F600}\\u{1F600}\\u00e9" must report position 2); escape form
boundaries \\u007f/\\u0080/\\u00ff/\\u0100/\\uffff/\\u{10000}/\\u{10FFFF}; lone surrogates
(\\ud800, \\udfff) and unpaired-surrogate sequences; combining marks; RTL marks; multiple
offending characters (only the first is reported); very long strings with the offender far
in. Also confirm the traceback shape, the exit status, and that NOTHING is written to
stdout when it raises. Run at least 250 cases.`,
  },
  {
    key: 'bytes-repr',
    prompt: `Fuzz Python's repr() of the encoded bytes and of the decoded list, using only ASCII
--a values (so no UnicodeEncodeError). repr chooses quotes and escapes precisely: it prefers
single quotes, switching to double ONLY when the value contains ' but no "; it emits \\\\ \\t
\\n \\r as mnemonics but NOT \\v \\f \\a \\b (those become \\x0b \\x0c \\x07 \\x08); bytes < 0x20
and >= 0x7f become \\xHH. Probe every ASCII byte 0x01..0x7f individually as the sole --a
value AND embedded among other characters; all combinations of quote presence (neither, only
', only ", both, many of each); backslash runs of length 1-5; backslash immediately before a
quote; strings that are themselves valid bencode (e.g. "i5e", "l4:teste", "3:abc",
"d1:ai1ee") to make sure encode/decode round-trips rather than re-parsing; --a values whose
length changes the decimal length prefix width (0, 9, 10, 99, 100, 999, 1000 bytes). Verify
BOTH printed lines byte for byte. Run at least 300 cases.`,
  },
  {
    key: 'argparse-tokens',
    prompt: `Fuzz argument tokenisation. The parser declares only --a (str, required) and --b (int,
required) plus the implicit -h/--help. Probe: long-option abbreviation (--h --he --hel --hel
p, and --a/--b which are already minimal); "=" inline values incl. --a=, --b=, --a==x,
--help=x, --h=x; short clustering (-h, -ha, -hx, -h=x, -xh); tokens that look like negative
numbers as VALUES (-5, -5.5, -.5, -0, -5e3, -5x, -+5); the bare "-" token; the empty-string
token; "--" in every position (before/after/between options, repeated, trailing, as a
value); unknown options (long, short, and unknown-with-=); extra positionals; duplicate
options (later must win, in both space and = forms); ordering of the three error classes
(type-conversion error vs missing-required vs unrecognized-arguments) and where -h
short-circuits relative to each. Verify exact stderr text, usage line, and exit status.
Run at least 300 cases.`,
  },
  {
    key: 'help-output',
    prompt: `Verify the help and usage output byte for byte, including trailing whitespace and blank
lines. Compare \`node /output/test6.mjs -h | od -c\` against the executable's. Then probe
every route that can print help or usage: -h, --help, --h, --he, --hel, -ha, -h mixed with
valid/invalid/unknown args in every position, and every error path (each must print the
usage line to stderr followed by "prog: error: ...").  Confirm the program name shown is
identical between the two binaries in EVERY message. Also confirm which stream each goes to
(help->stdout exit 0; errors->stderr exit 2) by capturing the streams separately with the
harness. Run at least 120 cases.`,
  },
  {
    key: 'randomised-sweep',
    prompt: `Run a large randomised sweep. Generate several thousand cases mechanically with a
throwaway Node script that writes batch files to /tmp/, drawing --a from a mix of random
ASCII (all of 0x01..0x7f), random Latin-1, random BMP, random astral, and random-length
strings (0 to 4000 chars); and --b from random integers across a huge magnitude range
(including values with hundreds of digits), random malformed integer strings, and random
Unicode-digit strings. Also generate cases with randomly shuffled/duplicated/omitted
option tokens. Since you cannot use Math.random (deterministic-run constraint does not
apply to your throwaway script, but if it errors just use a simple LCG seeded from a
constant), use a small LCG. Aim for at least 2000 cases total across batches. Report every
divergence.`,
  },
  {
    key: 'nd-block-adjacency',
    prompt: `The port derives a Unicode digit's numeric VALUE by walking backwards from its code
point until it leaves the Nd category, assuming every Nd block is exactly ten contiguous
code points 0..9. FIRST verify that assumption holds for the Unicode version Node ships:
write a throwaway Node script that scans all code points 0..0x10FFFF, finds every maximal
run of consecutive \\p{Nd} code points, and reports any run whose length is not a multiple
of 10, or any run longer than 10 that would make the walk-back ambiguous. Report the exact
list of runs longer than 10 if any exist. THEN, for every distinct Nd block you found, feed
its digits 0..9 to --b (both singly and as multi-digit numbers) through the differential
harness and confirm the value the port computes matches the executable. This is the single
highest-risk assumption in the port -- be exhaustive.`,
  },
  {
    key: 'scale-and-stress',
    prompt: `Stress the port at scale and check for differences the small cases hide. Probe: --a
values of length 0, 1, 9, 10, 99, 100, 255, 256, 999, 1000, 4095, 4096, 65535, 65536, and
the largest the OS will accept on argv (find the limit empirically -- when the executable
fails with E2BIG so will the port, that is not a divergence); --b values with 1, 2, 18, 19,
20, 100, 1000, 10000 digits; both maximal at once. Confirm output is identical and that
neither side truncates, buffers short, or mangles a long line. Also check stdout behaviour
when the pipe is closed early (e.g. \`| head -c 10\`) is not wildly different. Report only
genuine divergences in stdout/stderr/exit-status for cases the executable itself handles
successfully.`,
  },
]

const fuzzed = await pipeline(
  DIMENSIONS,
  (dimension) =>
    agent(`${CONTEXT}\n\n# Your assignment: fuzz dimension "${dimension.key}"\n\n${dimension.prompt}\n\nActually RUN the cases through the harness -- do not reason about what would happen. Report only divergences you observed in real output.`, {
      label: `fuzz:${dimension.key}`,
      phase: 'Fuzz',
      schema: FUZZ_SCHEMA,
    }),
  // Triage this dimension's divergences immediately; a dimension with none
  // costs nothing here.
  (report, dimension) => {
    if (!report || report.divergences.length === 0) return { report, verdicts: [] }
    return parallel(
      report.divergences.slice(0, 24).map((divergence) => () =>
        agent(`${CONTEXT}\n\n# Your assignment: independently confirm a reported divergence\n\nA fuzzer claims this argv produces different output between the executable and the port:\n\nargv: ${JSON.stringify(divergence.argv)}\nclaimed python: ${divergence.pythonOutput}\nclaimed node:   ${divergence.nodeOutput}\nsuspected cause: ${divergence.suspectedCause ?? 'unstated'}\n\nRe-run BOTH yourself with the harness. Be skeptical: fuzzers report false positives from\nshell quoting, from the PyInstaller pid, from NUL bytes, and from argv the OS mangled.\nSet reproduced=true ONLY if you personally observed a real difference in stdout, stderr\n(after pid normalisation) or exit status. If it reproduces, read the culprit module and say\nexactly what to change.`, {
          label: `triage:${dimension.key}`,
          phase: 'Triage',
          schema: VERDICT_SCHEMA,
        }),
      ),
    ).then((verdicts) => ({ report, verdicts: verdicts.filter(Boolean) }))
  },
)

const dimensionReports = fuzzed.filter(Boolean).map((entry) => entry.report).filter(Boolean)
const confirmed = fuzzed
  .filter(Boolean)
  .flatMap((entry) => entry.verdicts)
  .filter((verdict) => verdict.reproduced)

log(`fuzzing done: ${dimensionReports.reduce((sum, r) => sum + r.casesRun, 0)} cases, ${confirmed.length} confirmed divergences`)

// ---------------------------------------------------------------------------
// Phase 3: static review lenses, run concurrently with nothing to wait on.
// ---------------------------------------------------------------------------

const LENSES = [
  {
    key: 'constraints',
    prompt: `Audit COMPLIANCE with the task's hard constraints, reading every file under /output:
(1) Pure ESM only -- \`import\`/\`export\`, never \`require()\` or \`module.exports\`.
(2) Every generated file must end in .mjs, and every relative import must include the
    explicit .mjs suffix.
(3) ZERO external/npm dependencies, AND no bare-specifier imports at all -- not even
    node: builtins. Only relative local-file imports are permitted. Flag any \`import\`
    whose specifier does not start with './' or '../'.
(4) The identifiers \`Uint8Array\`, \`ArrayBuffer\`, \`Buffer\`, \`DataView\`, \`TypedArray\`,
    \`SharedArrayBuffer\`, \`atob\`, \`btoa\`, \`TextEncoder\`, \`TextDecoder\` must appear
    NOWHERE -- not in code, not in comments, not in strings. Bencode must be manual over
    plain values. Grep for each one.
(5) No embedded Python, no shelling out, no eval, no dynamic import, no filesystem access.
(6) Libraries genuinely split into multiple modules by functionality, each exposing its
    interface via \`export\`.
Report a finding per violation with the exact file and line. Be literal and thorough --
this is a pass/fail gate.`,
  },
  {
    key: 'correctness',
    prompt: `Hunt for latent correctness bugs by READING the port's logic, especially paths the
fuzzers are unlikely to reach. Focus on: pyInt's underscore/sign/whitespace state machine
(is there any accepted-but-should-reject or rejected-but-should-accept string?);
decimalDigitValue's walk-back; encodeAscii's position counting with astral characters and
lone surrogates; repr's quote selection and escape ordering (what if the value contains a
backslash AND the chosen quote? what about 0x27 when quote is "?); the bencode length
prefix for empty and very long byte strings; the bencode decoder's bounds checks and its
handling of a byte string whose CONTENT looks like bencode; BigInt round-tripping of
negative zero and of values with leading zeros. For each finding give a concrete argv that
triggers it, then actually run that argv through the harness to check whether it really
diverges -- report severity 'blocker' only for ones that do.`,
  },
  {
    key: 'argparse-fidelity',
    prompt: `Read /output/lib/argparse/*.mjs closely against real argparse semantics and find
divergences the fuzzers might miss. Consider: the order in which errors are raised and
which one wins when several apply; whether -h can fire after an error has already been
detected; abbreviation ambiguity (construct a hypothetical: if the parser had two options
sharing a prefix, would the message match argparse's "ambiguous option: X could match A,
B"?); the exact action-name form in messages (single option string vs '-h/--help' joined by
slash); "--" handling with no positionals declared; whether a token containing a space is
treated as a value; whether the negative-number heuristic matches argparse's
_negative_number_matcher exactly; short-cluster peeling for a flag taking no argument; the
help-column arithmetic in formatter.mjs (max_help_position, the wrap-to-next-line branch --
is that branch reachable, and is it correct if it is?). Verify each claim against the
executable where it is reachable; mark the rest 'static-only'.`,
  },
  {
    key: 'robustness',
    prompt: `Look for ways the port CRASHES or misbehaves where the executable does not: uncaught
JS exceptions surfacing as a Node stack trace instead of the intended output, wrong exit
status, output ordering between stdout and stderr, unflushed output on exit, RangeError from
deep recursion or huge string building, BigInt conversion throwing on unexpected input,
\`Object.assign\` in the Action constructor masking a typo'd field, reading a property of
null/undefined. Also check the entry point's catch: does any error type escape and print a
Node stack trace? Try to actually produce one. For each finding give the argv you used and
what you observed.`,
  },
]

const reviews = (
  await parallel(
    LENSES.map((lens) => () =>
      agent(`${CONTEXT}\n\n# Your assignment: review lens "${lens.key}"\n\n${lens.prompt}`, {
        label: `review:${lens.key}`,
        phase: 'Review',
        schema: REVIEW_SCHEMA,
      }),
    ),
  )
).filter(Boolean)

// ---------------------------------------------------------------------------
// Phase 4: completeness critic
// ---------------------------------------------------------------------------

phase('Critic')

const critique = await agent(
  `${CONTEXT}\n\n# Your assignment: completeness critic\n\nEight fuzzing dimensions and four review lenses have run. Here is what they covered:\n\n${JSON.stringify(dimensionReports.map((r) => ({ dimension: r.dimension, casesRun: r.casesRun, notes: r.notes })), null, 2)}\n\nConfirmed divergences: ${JSON.stringify(confirmed, null, 2)}\n\nReview findings: ${JSON.stringify(reviews, null, 2)}\n\nYour job is to find what is STILL unverified. Name specific behaviours of the Python\nprogram that no dimension exercised, and specific lines of the port that no case reached.\nThen actually TEST your top candidates through the harness and report anything that\ndiverges. Be adversarial: assume the port is subtly wrong somewhere and find it.\nReturn your findings as prose, listing any confirmed divergence with its exact argv.`,
  { label: 'critic', schema: REVIEW_SCHEMA, effort: 'xhigh' },
)

return {
  casesRun: dimensionReports.reduce((sum, r) => sum + r.casesRun, 0),
  dimensionReports,
  confirmedDivergences: confirmed,
  reviews,
  critique,
}
