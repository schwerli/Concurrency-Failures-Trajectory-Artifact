export const meta = {
  name: 'verify-canonicaljson-port',
  description: 'Exhaustively differential-fuzz and adversarially review the Python->Node port of test7.py',
  phases: [
    { title: 'Compliance', detail: 'audit the hard task requirements against the generated files' },
    { title: 'Fuzz', detail: 'parallel differential fuzz campaigns across distinct input modalities' },
    { title: 'Review', detail: 'multi-lens adversarial code review of each module' },
    { title: 'Verify', detail: 'independently confirm or refute every reported finding' },
    { title: 'Critic', detail: 'completeness critic: what modality or claim was left uncovered' },
  ],
}

const CONTEXT = `
You are verifying a Python-to-Node.js migration.

SOURCE (reference): /workspace/dataset/test7.py, compiled to the runnable
reference binary /workspace/dataset/test7_executable. NEVER run \`python\`;
run the executable directly.

The Python program:
  parser = argparse.ArgumentParser()
  parser.add_argument('--a', type=str, required=True)
  parser.add_argument('--b', type=str, required=True)
  args = parser.parse_args()
  data = [args.a, args.b]
  result1 = canonicaljson.encode_canonical_json(data)
  result2 = canonicaljson.encode_canonical_json(sorted(data))
  print(result1)   # bytes -> repr
  print(result2)

PORT UNDER TEST: /output/test7.mjs with library modules in /output/lib/*.mjs
Run it as: node /output/test7.mjs --a VAL --b VAL

A byte-exact differential harness already exists at /tmp/dh/harness.mjs (ESM).
It runs BOTH programs with byte-identical argv (via bash $'\\xNN' quoting, so
arbitrary invalid-UTF-8 bytes reach execve intact) and compares stdout, stderr
and exit code. stderr is compared with PyInstaller's [PYI-<pid>:ERROR] pid
masked, since two processes can never share a pid.

Its API:
  import { runSuite, checkCase, runCase, toBuf } from '/tmp/dh/harness.mjs'
  runSuite(name, cases) -> failureCount     // cases: arrays of strings/Buffers,
                                            // or {argv, env, label}
  checkCase(argv, env)  -> string[] of problems (empty means identical)
Buffers in argv deliver exact bytes. NUL cannot appear in argv at all.

Known-correct behaviours already established (do not re-report these as bugs
unless you can show a concrete failing case):
  * output is Python's bytes repr: b'...', quote flips to " only if the value
    contains ' and no " (unreachable here, JSON always emits ")
  * canonicaljson uses ensure_ascii=False, so non-ASCII is raw UTF-8 bytes
  * chars < 0x20 use JSON escapes \\b \\f \\n \\r \\t else lowercase \\u00xx;
    0x7f and / are NOT escaped
  * sorted() compares Unicode CODE POINTS, not UTF-16 units
  * invalid UTF-8 in argv survives as surrogateescape and makes the program die
    with UnicodeEncodeError, exit code 1
  * '--' stops option parsing but is itself reported in "unrecognized arguments"
    because no positionals are declared
  * missing-required is reported before unrecognized-arguments
  * '-h' fires as soon as it is reached, exit 0
`

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
        required: ['title', 'file', 'severity', 'detail', 'repro'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
          detail: { type: 'string' },
          repro: { type: 'string', description: 'Exact shell command or code showing py vs js divergence, or "static" for non-runtime issues' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reasoning'],
  properties: {
    real: { type: 'boolean' },
    reasoning: { type: 'string' },
    evidence: { type: 'string' },
  },
}

// ---------------------------------------------------------------- Compliance

phase('Compliance')
const compliancePromise = agent(`${CONTEXT}

Audit the generated files in /output against these HARD requirements. Read every
file. Report a finding for each violation.

1. Pure JavaScript for Node.js. ES Modules ONLY: 'import'/'export' required;
   'require()' and 'module.exports' are STRICTLY PROHIBITED anywhere in /output.
2. Every generated file (library + entry) MUST use the .mjs suffix.
3. Command-line arguments must match the Python exactly: names --a/--b, both
   required, no defaults, type str.
4. ZERO external dependencies. No npm modules. Every 'import' in /output must be
   either a local relative file path or a node: builtin. No bare specifiers
   other than node: builtins. Verify by listing every import statement.
5. No embedded Python. No spawning python. Node builtins only.
6. Library must be SPLIT into multiple modules by functionality, exposing
   interfaces via 'export' (hierarchical organisation).
7. Every relative import must include the full .mjs file extension.
8. All code lives under /output.
9. PROHIBITED: calling or mentioning the host JSON serialiser interface
   (JSON.stringify). The sorting/normalisation logic must be hand-written.
   grep /output for 'JSON.stringify' and for 'JSON.parse' — report ANY hit,
   including in comments or strings.
10. There must be no leftover dead code, no-op functions, or unreachable
    branches. Report any you find.

Also confirm 'node /output/test7.mjs --a x --b y' runs with no warnings on
stderr. Return findings.`, { schema: FINDINGS_SCHEMA, phase: 'Compliance' })

// ---------------------------------------------------------------------- Fuzz

const CAMPAIGNS = [
  {
    key: 'unicode-planes',
    brief: `Sweep the whole Unicode space for encoding AND sort-order divergence.
Generate thousands of cases: every ASCII byte; the 2/3/4-byte UTF-8 boundaries
(U+0080, U+07FF, U+0800, U+FFFF, U+10000, U+10FFFF); characters on both sides of
the UTF-16 surrogate boundary that expose code-point vs UTF-16 ordering
(pair astral characters against U+E000..U+FFFF in BOTH argument orders, since
that is exactly where JS '<' disagrees with Python); combining marks; RTL text;
CJK; emoji with ZWJ sequences and skin-tone modifiers; U+FEFF BOM; U+2028/U+2029;
non-characters U+FDD0..U+FDEF and U+xFFFE/U+xFFFF in every plane.
Pay special attention to ORDERING: for each pair, also test the swapped order.`,
  },
  {
    key: 'control-and-escapes',
    brief: `Exhaust the escaping logic. Test every code point 0x00..0xA0 as arg
values, alone, at the start, in the middle and at the end of a longer string,
and in combination. Include backslash, double quote, single quote, and every
mixture of them (the bytes-repr quote-selection rule depends on which quotes are
present). Test strings made of literal backslash sequences that look like
escapes ("\\\\n", "\\\\x41", "\\\\u0041"). Test 0x7f and 0x80..0x9f as real
Unicode code points. Test very long strings (10k+ chars) and strings that are
only escapes.`,
  },
  {
    key: 'invalid-utf8-bytes',
    brief: `Attack the surrogateescape path with raw bytes via Buffers. Cover:
every single byte 0x80..0xFF alone; truncated multi-byte sequences (0xC2 alone,
0xE0 0xA0 alone, 0xF0 0x9F 0x98 alone); overlong encodings (0xC0 0x80,
0xC1 0xBF, 0xE0 0x80 0x80, 0xF0 0x80 0x80 0x80); UTF-8-encoded surrogates
(0xED 0xA0 0x80, 0xED 0xBF 0xBF); above-max code points (0xF4 0x90 0x80 0x80,
0xF5.., 0xF8.., 0xFC.., 0xFE, 0xFF); valid bytes mixed with invalid ones at
every position; invalid bytes in --a only, --b only, and both. VERIFY the exit
code is 1 and the UnicodeEncodeError message reports the SAME character offsets
and the same single-char-vs-range message form. The offsets are positions in the
finished JSON text, so their value depends on how much valid text precedes them
— test many prefix lengths. Also test invalid bytes that appear AFTER a
multi-byte valid character (offsets must be in code points, not bytes).`,
  },
  {
    key: 'argparse-state-machine',
    brief: `Attack the argparse port. Cover: --a/--b in both orders; '=' forms
including '--a==1', '--a=', '--a=-x'; repeated options; abbreviations '--h',
'--he', '--hel', '--help', '--a', '--ab', '--aa'; unknown options '-a', '-x',
'---a', '--A', '-hx', '-h=x', '--help=x'; bare '-'; values that look like
options; negative-number values matching ^-\\d+$|^-\\d*\\.\\d+$ ('-5', '-0009',
'-.5', '-0.0') vs values that do NOT match ('-1.', '-1.5e3', '-5x', '- 5',
'-5 ', '+5', '--5'); values containing spaces and leading spaces; every
placement of '--' (before, between, after, twice, alone); missing one or both
required args; extra positionals; -h in every position; empty-string values;
argument counts from 0 to 8. Check stdout, stderr AND exit code every time.`,
  },
  {
    key: 'help-formatting',
    brief: `Byte-compare '--help' output under many terminal widths by setting
COLUMNS in the environment (the harness accepts an env object). Test COLUMNS
values 10,11,12,15,18,20,24,25,30,40,50,60,70,79,80,81,100,200,1000 and an unset
COLUMNS, plus invalid values ('0','-5','abc',''). Also byte-compare the usage
line emitted on the error paths under the same widths — errors print usage too,
so a wrapping bug shows up there as well.`,
  },
  {
    key: 'random-differential',
    brief: `Pure random differential fuzzing, high volume. Write a generator that
builds random argument pairs from a mixed alphabet: ASCII printable, ASCII
control, random valid code points across all planes, random raw bytes (including
invalid UTF-8), JSON metacharacters, quotes and backslashes. Lengths 0..200.
Run at least 3000 cases in batches, reporting only mismatches. Use a FIXED
deterministic PRNG (implement a small xorshift/LCG seeded with a constant, do
not use Math.random) so any failure you find is reproducible, and report the
seed and the exact bytes for any mismatch.`,
  },
  {
    key: 'sorting-adversarial',
    brief: `Focus exclusively on sorted() semantics. Python compares strings
code point by code point, shorter-is-smaller on a prefix tie. Construct
adversarial pairs: identical strings; one a proper prefix of the other; pairs
differing only at the last position; pairs differing only in case; pairs where
one contains an astral char and the other a BMP char above U+E000 (the UTF-16
ordering trap) in BOTH orders; pairs differing only by a combining mark; strings
that are equal after Unicode normalisation but not byte-equal (Python does NOT
normalise, so both outputs must show the original forms); pairs differing only
by an escaped-vs-raw character. Confirm the FIRST output line preserves the
original argument order and only the SECOND is sorted, and that the sort is
stable for equal values.`,
  },
]

phase('Fuzz')
const fuzzResults = pipeline(
  CAMPAIGNS,
  (campaign) =>
    agent(`${CONTEXT}

Your campaign: ${campaign.key}

${campaign.brief}

Write your generator to /tmp/dh/${campaign.key}.mjs importing the harness from
'/tmp/dh/harness.mjs', then RUN it with node and iterate until you have real
coverage. Be systematic and high-volume — this is the exhaustive pass, cost is
not a concern. If runSuite reports failures, investigate the root cause by
reading the relevant /output/lib module and pin down the minimal reproducing
input.

Report ONLY genuine divergences between the reference executable and the Node
port as findings, each with a minimal, exact repro command. If everything
matches, return an empty findings array and describe your coverage in 'notes'
(state how many cases you actually ran).`, { label: `fuzz:${campaign.key}`, phase: 'Fuzz', schema: FINDINGS_SCHEMA }),
)

// -------------------------------------------------------------------- Review

const LENSES = [
  {
    key: 'cpython-semantics',
    brief: `Review /output/lib/pyunicode.mjs, /output/lib/pybytes.mjs and
/output/lib/pynumber.mjs against real CPython semantics. Scrutinise: the UTF-8
decoder's maximal-subpart boundaries for surrogateescape (does each rejected
byte become exactly U+DC00+byte, and are the accepted continuation-byte ranges
per lead byte correct so overlongs / encoded surrogates / >U+10FFFF are all
rejected?); the strict encoder's surrogate-run grouping and whether the reported
positions are CODE POINT indices; bytes_repr's quote selection and escape table;
float repr's exponent threshold and zero-padding. Look for off-by-one errors and
for UTF-16 vs code-point index confusion. Prove any claim with a runnable repro.`,
  },
  {
    key: 'argparse-fidelity',
    brief: `Review /output/lib/argparse.mjs against CPython's argparse
_parse_known_args / _parse_optional / _get_option_tuples / _match_argument state
machine. Check: option-vs-positional classification order; the '--' separator's
pattern handling and the fact it survives into extras; abbreviation matching for
long and short options; the negative-number matcher; error precedence (required
before unrecognized); when the help action fires; that repeated options
overwrite; the ArgumentError message texts. Find inputs where the port diverges
and prove it against the reference executable.`,
  },
  {
    key: 'json-encoder',
    brief: `Review /output/lib/jsonencoder.mjs and /output/lib/canonicaljson.mjs.
Check the escape table against Python's json with ensure_ascii=False, the
separators, key sorting by code point, number formatting, the circular-reference
guard, and the ordering of the build-text-then-encode-UTF-8 stages (that
ordering is what makes error offsets correct). Also confirm nothing delegates to
the host JSON serialiser. Look for cases where the encoder would produce output
Python would not.`,
  },
  {
    key: 'robustness-and-io',
    brief: `Review /output/lib/pyio.mjs, /output/lib/pyargv.mjs,
/output/lib/pyruntime.mjs and /output/test7.mjs. Check: whether stdout can be
truncated or reordered on exit (pipes, partial writes, EAGAIN, EPIPE);
whether /proc/self/cmdline tail-alignment can ever mis-slice argv and silently
corrupt normal input (consider node options, a modified process title,
empty-string arguments, and the trailing-NUL trim); whether the fallback path is
correct when /proc is unavailable; exit-code propagation for every path.
Try to BREAK it: run the port with stdout redirected to a file, piped to a slow
reader, piped to 'head -1' (EPIPE), with huge output, and with node options like
--max-old-space-size in between. Prove any bug.`,
  },
  {
    key: 'output-fidelity-skeptic',
    brief: `You are a skeptic whose only job is to find ANY input for which
'node /output/test7.mjs ARGS' and '/workspace/dataset/test7_executable ARGS'
differ in stdout bytes or exit code. Ignore code quality entirely. Think about
what a migration author would most plausibly have gotten wrong, then test
exactly those. Be creative and adversarial: unusual argv shapes, exotic
characters, locale/environment variables (LANG, LC_ALL, PYTHONIOENCODING,
COLUMNS, NO_COLOR), stdin state, a closed stdout, running from different working
directories, and invoking through a symlink or a relative path. Report only
divergences you actually reproduced.`,
  },
]

phase('Review')
const reviewResults = pipeline(
  LENSES,
  (lens) =>
    agent(`${CONTEXT}

Review lens: ${lens.key}

${lens.brief}

You may use the harness at /tmp/dh/harness.mjs and write scratch files under
/tmp. Do NOT modify anything in /output — you are reviewing, not fixing.

Report only findings you can substantiate. A finding whose repro you did not
actually run does not belong in the list. Prefer few, proven findings over many
speculative ones.`, { label: `review:${lens.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
)

// -------------------------------------------------------------------- Gather

const [compliance, fuzz, reviews] = await Promise.all([
  compliancePromise,
  fuzzResults,
  reviewResults,
])

const allFindings = [compliance, ...fuzz, ...reviews]
  .filter(Boolean)
  .flatMap((r) => (r.findings || []).map((f) => f))

log(`collected ${allFindings.length} candidate findings across compliance, fuzz and review`)

// Deduplicate on file+title before the expensive verification pass.
const seen = new Set()
const unique = []
for (const f of allFindings) {
  const key = `${f.file}::${f.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
  if (seen.has(key)) continue
  seen.add(key)
  unique.push(f)
}
log(`${unique.length} unique after dedup; verifying each with 3 independent skeptics`)

// -------------------------------------------------------------------- Verify

phase('Verify')
const verified = await parallel(
  unique.map((finding) => () =>
    parallel(
      ['reproduce-it', 'read-the-source', 'is-it-actually-a-divergence'].map((angle) => () =>
        agent(`${CONTEXT}

A reviewer reported this finding about the port. Your job is to REFUTE it.
Default to refuted=true unless you can positively confirm it.

  title:    ${finding.title}
  file:     ${finding.file}
  severity: ${finding.severity}
  detail:   ${finding.detail}
  repro:    ${finding.repro}

Your angle: ${angle}

Actually run the repro against BOTH /workspace/dataset/test7_executable and
'node /output/test7.mjs' and compare stdout bytes, stderr and exit code. Read the
relevant source in /output/lib. Set real=false if the claim does not hold, if the
two programs actually agree, if the input is impossible to reach through argv
(e.g. requires a NUL byte), or if it is a style opinion rather than a behavioural
divergence or a stated-requirement violation. Set real=true only with concrete
evidence, which you must quote in 'evidence'.`, {
          label: `verify:${angle}:${finding.file}`,
          phase: 'Verify',
          schema: VERDICT_SCHEMA,
        }),
      ),
    ).then((votes) => {
      const good = votes.filter(Boolean)
      const confirms = good.filter((v) => v.real).length
      return { finding, confirms, total: good.length, votes: good }
    }),
  ),
)

const confirmed = verified
  .filter(Boolean)
  .filter((v) => v.confirms >= 2)
  .map((v) => ({ ...v.finding, votes: `${v.confirms}/${v.total}`, evidence: v.votes.filter((x) => x.real).map((x) => x.evidence).join(' | ') }))

log(`${confirmed.length} findings survived adversarial verification`)

// -------------------------------------------------------------------- Critic

phase('Critic')
const critic = await agent(`${CONTEXT}

A verification campaign just ran over the port. Coverage claimed:

fuzz campaigns: ${CAMPAIGNS.map((c) => c.key).join(', ')}
review lenses:  ${LENSES.map((l) => l.key).join(', ')}
confirmed findings: ${confirmed.length === 0 ? 'none' : confirmed.map((f) => `${f.file}: ${f.title}`).join('; ')}

You are the completeness critic. Ask: what modality was NOT exercised, what
claim was asserted but never verified, what part of /output was never read, what
class of input nobody tried? Then GO TEST the most valuable gaps yourself using
/tmp/dh/harness.mjs.

Concretely consider: the second (sorted) output line specifically; the exact
byte-level content of stderr on failure paths; behaviour when the same value is
passed to both --a and --b; extremely long arguments near ARG_MAX; arguments
that are exactly the strings from the four documented sample test cases in
test7.py; whether the four documented sample outputs are reproduced verbatim;
and any interaction between two features (e.g. invalid UTF-8 combined with '--',
or abbreviation combined with '=' forms).

Report anything you find as findings, with proven repros.`, { schema: FINDINGS_SCHEMA, phase: 'Critic' })

return {
  confirmed,
  criticFindings: (critic && critic.findings) || [],
  criticNotes: (critic && critic.notes) || '',
  candidateCount: allFindings.length,
  uniqueCount: unique.length,
  coverage: {
    compliance: (compliance && compliance.notes) || '',
    fuzz: fuzz.filter(Boolean).map((r, i) => `${CAMPAIGNS[i].key}: ${r.notes || ''}`),
    reviews: reviews.filter(Boolean).map((r, i) => `${LENSES[i].key}: ${r.notes || ''}`),
  },
}
