export const meta = {
  name: 'bech32-py2node-migration',
  description: 'Black-box probe the Python bech32 executable, build a zero-dep ESM Node port in /output, and differentially verify it to byte-exactness',
  phases: [
    { title: 'Probe', detail: 'parallel black-box probes of bech32 decode + argparse semantics' },
    { title: 'Spec', detail: 'synthesize a single authoritative behavioral spec' },
    { title: 'Implement', detail: '2 independent candidate implementations in /tmp' },
    { title: 'Score', detail: 'differential-test each candidate against the executable' },
    { title: 'Harden', detail: 'loop-until-dry adversarial differential testing + fixes on the winner' },
    { title: 'Critic', detail: 'requirements-compliance + completeness review' },
  ],
}

const EXE = '/workspace/dataset/test5_executable'
const SRC = '/workspace/dataset/test5.py'

const COMMON = `
You are reverse-engineering the behavior of a pre-compiled Python program so it can be reimplemented in Node.js.

Program: ${EXE}   (run it directly; NEVER run \`python\`/\`python3\` — it is not available)
Its source is ${SRC} and is:

    import argparse, bech32
    parser = argparse.ArgumentParser()
    parser.add_argument("--a", type=str, required=True)   # HRP
    parser.add_argument("--b", type=str, required=True)   # segwit address
    args = parser.parse_args()
    result = bech32.decode(args.a, args.b)
    print(result)

You may NOT read the source of the \`bech32\` Python package. Determine behavior only by executing the binary
with many inputs and observing stdout / stderr / exit code. Use \`bash\` loops to run many probes cheaply, e.g.:
  ${EXE} --a bc --b bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4; echo "rc=$?"

Already-established ground truth (RE-VERIFY anything you rely on, do not blindly trust it):
- \`--a bc --b bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4\` -> \`(0, [117, 30, 118, 232, 25, 145, 150, 212, 84, 148, 28, 69, 209, 179, 163, 35, 241, 67, 59, 214])\`, rc 0
- The all-uppercase form of that same address also decodes; a mixed-case form yields \`(None, None)\`.
- A bech32m taproot address (\`bc1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5sspknck9\`) yields \`(None, None)\`
  => this is the BIP-173-era reference implementation with the Bech32 checksum constant 1 only, NO bech32m.
- Failure to decode always prints \`(None, None)\` and exits 0. Only argparse errors exit 2.
`

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'findings', 'probesRun', 'transcript'],
  properties: {
    dimension: { type: 'string' },
    probesRun: { type: 'integer', description: 'how many invocations of the executable you actually made' },
    findings: {
      type: 'array',
      description: 'One entry per behavioral rule you established, each backed by concrete observed I/O.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'evidence'],
        properties: {
          rule: { type: 'string', description: 'Precise, implementable statement of the behavior.' },
          evidence: { type: 'string', description: 'Literal command(s) + literal stdout/stderr/rc that prove it.' },
        },
      },
    },
    transcript: {
      type: 'array',
      description: 'Up to 60 of your most informative probes as exact triples, for the differential corpus.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'stdout', 'rc'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          rc: { type: 'integer' },
        },
      },
    },
  },
}

const DIMENSIONS = [
  {
    key: 'checksum-core',
    prompt: `Dimension: **bech32 string structure & checksum validation**.
Establish exactly when a string is accepted as a well-formed bech32 string:
- Where is the HRP/data separator found (first '1'? last '1'? what if the HRP itself contains '1', e.g. hrp "a1b"? what about an address with several '1's)?
- Minimum HRP length; what happens with a leading separator ('1qqqqq...' with --a '')?
- Minimum data-part length (checksum is 6 chars): probe hrp+'1'+0..6 data chars.
- Maximum total string length: find the exact cutoff (probe lengths 89, 90, 91 of an otherwise-valid string). Does a valid 90-char address decode but a 91-char one not?
- Is the checksum verified? Flip one character of a valid address and confirm rejection. Confirm the checksum is over the *lowercased* string.
- Build valid addresses yourself: you can compute a bech32 checksum with a tiny node one-liner (generator polynomial 0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3; charset "qpzry9x8gf2tvdw0s3jn54khce6mua7l"; checksum constant 1; hrp expansion = high bits, 0, low bits). Verify your generator by round-tripping the known-good address above.
Report the exact separator-search rule and every length bound as inequalities.`,
  },
  {
    key: 'charset-case',
    prompt: `Dimension: **character set, case handling, and character-range rejection**.
- Which 32 characters are legal in the data part, and in what order do they map to values 0..31? Prove the mapping empirically: construct addresses whose decoded witness program pins down individual 5-bit values, or decode addresses that differ in one data char. Confirm '1', 'b', 'i', 'o' are excluded.
- Are illegal data-part characters rejected? What about illegal characters in the HRP part (e.g. HRP containing 'B'/uppercase, or characters outside a range)?
- Case: all-lower accepted, all-upper accepted, ANY mixed case rejected. Is the mixed-case rule applied to the WHOLE string (including HRP) or only the data part? Test: hrp part uppercase + data part lowercase; hrp lower + data upper.
- When the address is uppercase, what HRP must be passed via --a for a successful decode — the uppercase or the lowercase one? (Test --a BC vs --a bc against an uppercase address.) Explain in terms of a lowercase-normalizing decode.
- Characters outside printable ASCII: test a byte with code < 33 (space 0x20, tab) and > 126 (0x7f DEL, and a non-ASCII UTF-8 character like 'é', 'Ω', an emoji). All should be rejected — confirm and note it is a per-character code-point range check [33,126].
- Empty --b. --b consisting of only '1'.
Report the exact accept/reject predicate per character class.`,
  },
  {
    key: 'witver-proglen',
    prompt: `Dimension: **segwit witness-version and program-length rules** (the part of decode() after checksum validation).
Write a correct bech32 *encoder* in a scratch node script (charset "qpzry9x8gf2tvdw0s3jn54khce6mua7l", polymod constants 0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3, checksum const 1, 5->8/8->5 bit conversion) and validate it by reproducing the known-good address. Then generate addresses systematically and feed them to the executable to establish:
- Which witness versions (first data value, 0..31) are accepted? Find the exact upper bound (is 16 ok and 17 rejected?).
- For witness version 0, which program lengths (in bytes) are accepted? Test every length 0..41. (Expect only 20 and 32.)
- For versions 1..16, which program lengths are accepted? Test every length 0..41 — find the exact lower and upper bounds.
- Order of checks: is there any input where a length violation and a version violation disagree in observable output? (Output is always \`(None, None)\` so this only matters for crashes — check that NOTHING ever crashes / exits non-zero for a well-formed-argv call, including hrp+'1'+exactly-6-checksum-chars with an EMPTY data payload, which would be a witness-version-less address.)
- 5->8 bit conversion with no padding: construct a data part whose bit count is not a multiple of 8 and whose leftover bits are NON-zero -> must be rejected; leftover bits ZERO but count >= 5 -> must be rejected; leftover 1..4 zero bits -> accepted. Prove each case with a concrete address.
Report exact numeric bounds and the padding rules.`,
  },
  {
    key: 'output-format',
    prompt: `Dimension: **exact stdout formatting** of the printed Python tuple.
- Confirm the success format character-by-character: is it \`(0, [117, 30, ...])\` — one space after the comma, no trailing space, single trailing newline? Use \`| od -c | tail -5\` or \`| xxd | tail -3\` to inspect the exact trailing bytes.
- Confirm the failure format is exactly \`(None, None)\` + one newline (hexdump it).
- Is the second element printed as a Python list (square brackets, comma+space separators) or as bytes/bytearray? Decode a program containing byte values 0, 9, 10, 13, 34, 39, 92, 127, 255 if you can construct one — if it printed as bytes those would render as escapes; as a list they render as plain integers. Construct such a program with your encoder (a 20-byte program is easy to choose freely) and hexdump the output.
- What does a witness version > 0 success look like, e.g. \`(1, [..])\`? Produce one (a version-1 program of a length that IS accepted, remembering bech32m is not involved — the checksum is plain bech32).
- Is there any case that prints something other than a 2-tuple, or prints nothing, or writes to stderr with rc 0?
Report the format as an exact template string.`,
  },
  {
    key: 'argparse-cli',
    prompt: `Dimension: **argparse command-line semantics** (prog name is \`test5_executable\`; our port will be \`test5.mjs\`).
Establish exactly, capturing stdout and stderr SEPARATELY (\`2>/dev/null\` and \`2>&1 1>/dev/null\`) plus the exit code:
- \`--help\` and \`-h\`: exact full text, exit code, which stream.
- No args; only --a; only --b: exact stderr text and rc. Note the order of the names in "the following arguments are required: ...".
- \`--a=VALUE\` equals-form; \`--a VALUE\` space-form; repeated flags (last wins?); flag order independence.
- Unrecognized args (\`--c y\`, \`-a\`, \`-b\`, positional \`foo\`): exact message and rc. IMPORTANT: check precedence — when an unrecognized arg is present AND a required arg is missing, which error is reported?
- A value that starts with '-' (e.g. \`--b -bc1x\`, \`--b -1\`, \`--b -\`): which are treated as values and which raise "expected one argument"? Test \`--b -\`, \`--b -1\`, \`--b -x\`, \`--b -1.5\`, \`--b=-bc1x\`, and \`--b -- x\`. Determine the exact rule argparse uses (negative-number-like vs option-like), noting the parser has NO options that look like negative numbers.
- The bare \`--\` separator's effect.
- Abbreviation: since the only long options are --a and --b, is \`--a\` already the full name? Test \`--ab\`, \`--\`, \`--=x\`.
- Empty-string values: \`--a '' --b ''\`, and \`--a '' --b '1qqqqqq...'\`.
- Does argparse write the \`usage:\` line to stderr along with the error, and is there a trailing newline? Hexdump one error case.
Report each rule with its exact literal message text (use \\n for newlines).`,
  },
  {
    key: 'adversarial-crash',
    prompt: `Dimension: **robustness / crash hunting**. Your job is to find ANY input where the program does something a naive port would get wrong: a traceback, a non-zero exit with rc other than 2, output other than \`(None, None)\`/\`(v, [..])\`, or a surprising success.
Try at least 200 inputs, including:
- Very long strings (200, 1000, 10000 chars), strings of only separators ('1', '11', '111...'), strings that are all 'q's.
- HRP given in --a that does not match the address at all; --a that is a prefix/suffix of the address HRP; --a with uppercase; --a containing '1'; --a extremely long; --a empty; --a with non-ASCII.
- Addresses where the data part is exactly 6 chars (empty payload) with a VALID checksum for that hrp — build these with a scratch node encoder and confirm no IndexError/traceback.
- Addresses with a valid checksum but 0, 1, 2 data values before the checksum.
- Strings with NUL-ish / control bytes, newlines inside the value, tabs, and multi-byte UTF-8.
- Addresses of exactly 90 and 91 characters that are otherwise checksum-valid.
- Witness program of length 40 and 41 for version 1.
Report every input that produced anything other than a clean \`(None, None)\`/\`(v, [...])\` with rc 0, and confirm explicitly if none did.`,
  },
]

phase('Probe')
log(`Probing ${DIMENSIONS.length} behavioral dimensions of the Python executable in parallel`)

const probes = (await parallel(DIMENSIONS.map((d) => () =>
  agent(`${COMMON}\n\n${d.prompt}\n\nBe exhaustive and empirical. Run as many probes as you need (hundreds is fine — use shell loops). Return the structured result.`,
    { label: `probe:${d.key}`, phase: 'Probe', schema: PROBE_SCHEMA })
))).filter(Boolean)

log(`Probe complete: ${probes.reduce((n, p) => n + (p.findings?.length || 0), 0)} rules from ${probes.reduce((n, p) => n + (p.probesRun || 0), 0)} invocations`)

// Barrier justified: the spec must reconcile ALL dimensions at once (they overlap and can contradict).
phase('Spec')
const specText = await agent(
  `${COMMON}

Below are structured findings from six independent black-box probing agents. Reconcile them into ONE authoritative,
implementable behavioral specification for a Node.js port. Where two probes disagree, RE-RUN the executable yourself to
settle it, and say which one was right.

The spec must be precise enough that a competent engineer can implement it with zero further probing. Cover, as numbered
requirements with exact constants and exact literal output strings:
 1. argv parsing (argparse-compatible): required --a/--b, equals-form, repeats, option-like values, unrecognized-arg vs
    missing-required precedence, exact usage/error text, exit codes, which stream. Note that our prog name is \`test5.mjs\`
    (derived from the script basename) where the binary shows \`test5_executable\`.
 2. bech32 string validation: character code-point range, case rule, separator search, length bounds, charset mapping,
    checksum (polymod constants, hrp expansion, checksum constant).
 3. 5->8 bit conversion with pad=false, including the exact rejection conditions.
 4. segwit decode() rules: hrp equality against the *decoded* (lowercased) hrp, decoded-length bounds, witness-version
    bound, the version-0 special case, and the exact order of the checks (so no input can crash).
 5. Exact stdout rendering of the result tuple, both success and failure, including whitespace and trailing newline.

Also list every input class that must be in a regression corpus.
Return the spec as plain markdown text (this is a return value, not a message to a human).`,
  { label: 'synthesize-spec', phase: 'Spec' }
) || ''

log('Spec synthesized')

const FILE_LAYOUT = `
MANDATORY engineering requirements for the port (these are hard constraints from the customer; violating any one
invalidates the work):
 - Pure JavaScript on Node.js. **ES Modules only**: \`import\` / \`export\`. \`require()\` and \`module.exports\` are
   STRICTLY PROHIBITED anywhere in any file.
 - Every generated file uses the **.mjs** suffix, and every relative import includes the full \`.mjs\` suffix.
 - **Zero external dependencies.** No npm packages (no yargs, no argparse, ...). \`import\` may ONLY reference local
   relative files. Node builtins are allowed only via the \`node:\` prefix (e.g. \`node:process\`, \`node:path\`,
   \`node:url\`) and should be kept to the bare minimum.
 - No embedded Python, no shelling out, no spawning anything.
 - **STRICTLY PROHIBITED: \`Uint8Array\` and \`DataView\`.** Do not use, reference, or even mention those identifiers
   anywhere in the code or comments. Use plain JavaScript arrays of numbers and plain arithmetic for all bit
   manipulation (the bech32 encoding logic must be manual).
 - Hierarchical library split: multiple small modules by responsibility, each exposing a named \`export\`, composed by
   the entry file. Suggested (adapt if you have a better decomposition):
       lib/charset.mjs    - CHARSET string, value<->char maps, printable-ASCII predicate, generator constants
       lib/polymod.mjs    - bech32Polymod, hrpExpand, verifyChecksum, createChecksum
       lib/bech32.mjs     - bech32Decode / bech32Encode (string level)
       lib/convertbits.mjs- convertBits(data, from, to, pad)
       lib/segwit.mjs     - decode(hrp, addr) / encode(hrp, witver, witprog)
       lib/pyformat.mjs   - Python-repr rendering of the result tuple
       lib/cli.mjs        - argparse-compatible argv parser (usage text, errors, exit codes)
   and the entry point \`test5.mjs\` that wires them together.
 - Integer arithmetic must stay exact. The bech32 polymod uses 30-bit values and XOR/shift — plain JS numbers with
   \`^\`, \`<<\`, \`>>>\` are fine, but be careful that \`<<\` on a value >= 2^26 can set the sign bit; mask correctly
   (\`>>> 0\` or \`& 0x3fffffff\`) so results always match Python's arbitrary-precision ints.
 - stdout must match Python's \`print\` byte-for-byte, including the single trailing newline. Use a single
   \`console.log(...)\` of the fully formatted string.
 - Non-ASCII argv: iterate strings by Unicode code point (\`for (const ch of s)\` / \`codePointAt\`), not UTF-16 units,
   so the [33,126] range check matches Python's \`ord()\` semantics.
`

phase('Implement')
log('Building 2 independent candidate implementations')

const CAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'entry', 'files', 'notes'],
  properties: {
    dir: { type: 'string' },
    entry: { type: 'string', description: 'absolute path to the entry test5.mjs' },
    files: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string', description: 'design decisions + anything you verified against the executable' },
  },
}

const candidates = (await parallel([1, 2].map((n) => () =>
  agent(`${COMMON}

## Authoritative behavioral specification

${specText}

${FILE_LAYOUT}

## Your task

Build the complete port under the directory \`/tmp/cand${n}/\` (create it). The entry point must be
\`/tmp/cand${n}/test5.mjs\` and the library modules under \`/tmp/cand${n}/lib/\`.

${n === 2
    ? 'Take an independent path: derive the bech32 algorithm from the spec and your own probing rather than from memory of any reference implementation, and design your own module decomposition (still hierarchical, still matching the mandatory constraints).'
    : 'Follow the suggested module decomposition closely and write clean, well-commented, idiomatic ESM.'}

Then SELF-VERIFY before returning. Write a scratch differential script (NOT inside /tmp/cand${n} — put it in
/tmp/verify${n}/) that runs both \`node /tmp/cand${n}/test5.mjs ...\` and \`${EXE} ...\` over at least 300 inputs
covering every class in the spec's regression-corpus list, comparing stdout, stderr and exit code EXACTLY. Iterate
until zero mismatches. Include: valid v0-20byte, v0-32byte, v1..v16 programs at boundary lengths, uppercase forms,
mixed-case, bad checksums, wrong hrp, 90/91-char addresses, empty payloads, non-ASCII, control characters,
option-like values, missing/unknown/repeated flags, --help.

Report your final mismatch count honestly. Return the structured result.`,
    { label: `implement:cand${n}`, phase: 'Implement', schema: CAND_SCHEMA })
))).filter(Boolean)

if (!candidates.length) throw new Error('no candidate implementation was produced')
log(`Candidates ready: ${candidates.map((c) => c.dir).join(', ')}`)

phase('Score')
const SCORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidate', 'totalCases', 'mismatches', 'compliance', 'verdict'],
  properties: {
    candidate: { type: 'string' },
    totalCases: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'expected', 'actual'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          expected: { type: 'string' },
          actual: { type: 'string' },
          stream: { type: 'string' },
        },
      },
    },
    compliance: {
      type: 'object',
      additionalProperties: false,
      required: ['esmOnly', 'mjsSuffixes', 'noExternalImports', 'noUint8ArrayOrDataView', 'hierarchical', 'violations'],
      properties: {
        esmOnly: { type: 'boolean' },
        mjsSuffixes: { type: 'boolean' },
        noExternalImports: { type: 'boolean' },
        noUint8ArrayOrDataView: { type: 'boolean' },
        hierarchical: { type: 'boolean' },
        violations: { type: 'array', items: { type: 'string' } },
      },
    },
    verdict: { type: 'string', description: 'PASS if zero mismatches and zero compliance violations, else FAIL' },
  },
}

const scoreBody = (dir) => `${COMMON}

## Task: adversarially differential-test the candidate port at \`${dir}\`

Entry point: \`node ${dir}/test5.mjs\`. Ground truth: \`${EXE}\`.

Build a fresh, INDEPENDENT test harness in a scratch dir (do NOT modify anything under ${dir}). Generate a corpus of
**at least 600** argv vectors and, for each, run both programs capturing stdout, stderr and exit code separately, then
compare all three EXACTLY (byte-for-byte, including trailing newlines). Normalize ONLY the program name difference:
the binary prints \`test5_executable\` where the port legitimately prints \`test5.mjs\`. Any other difference is a bug.

Your corpus MUST include, generated programmatically:
 - Valid addresses you construct with your own bech32 encoder: witness versions 0..16 crossed with program byte
   lengths 1,2,19,20,21,31,32,33,39,40,41; several HRPs of different lengths ('bc','tb','ltc','tltc','xyz','a',
   a 60+ char hrp); each in lowercase and uppercase form.
 - Random mutations of valid addresses: single-char substitution / deletion / insertion / transposition (>=150 cases).
 - Case mutations: one char uppercased in the hrp, in the data part, in the checksum.
 - Length edge cases: total length exactly 89, 90, 91, and 200.
 - Structural edges: no '1', leading '1', trailing '1', multiple '1's, hrp containing '1', data part of length
   0..6, empty --b, --b of just '1'.
 - Non-ASCII and control characters in --a and --b (space, tab, newline, 0x7f, 'é', 'Ω', an emoji, and a raw
   byte >= 0x80). Pass these safely (e.g. via an argv array in a node/child-process driver, not shell interpolation).
 - HRP mismatches: right address with wrong --a, uppercase --a with uppercase address, empty --a, --a with '1'.
 - argparse cases: no args, only --a, only --b, --a= form, repeated flags, unknown flags (\`--c\`, \`-a\`, positional),
   unknown-flag-AND-missing-required together, option-like values (\`-1\`, \`-x\`, \`-\`, \`--\`), \`--help\`, \`-h\`.
 - The four sample cases from the original task file, e.g. \`--a xyz --b xyz1s5y9ce53aq686ffxxxjk6scl7zt3efeze40r73h\`
   and \`--a ltc --b ltc1hsja87ry7v8cn6rfgv46af5t9l4t5rqu3d2\` (both expected \`(None, None)\`).

Separately, statically audit the candidate's source for the mandatory constraints: ESM only (no \`require(\`, no
\`module.exports\`), all files \`.mjs\`, all relative imports carry the \`.mjs\` suffix, no import of any non-local /
non-\`node:\` module, absolutely no \`Uint8Array\` or \`DataView\` anywhere (grep for both), and a genuine multi-module
hierarchical split with named exports. Also confirm \`node --check\` passes on every file.

Report the true numbers. Do not fix anything — just report. List up to 25 distinct mismatches (minimize each to the
smallest reproducing argv).`

const scores = (await parallel(candidates.map((c) => () =>
  agent(scoreBody(c.dir), { label: `score:${c.dir.split('/').pop()}`, phase: 'Score', schema: SCORE_SCHEMA, effort: 'high' })
    .then((s) => ({ ...s, dir: c.dir, entry: c.entry }))
))).filter(Boolean)

for (const s of scores) {
  log(`${s.dir}: ${s.totalCases} cases, ${s.mismatches?.length ?? '?'} mismatches, violations: ${s.compliance?.violations?.length ?? '?'}`)
}

const rank = (s) => (s.mismatches?.length ?? 999) + (s.compliance?.violations?.length ?? 999) * 10
scores.sort((x, y) => rank(x) - rank(y))
const winner = scores[0]
const runnerUp = scores[1]
log(`Winner: ${winner.dir} (score ${rank(winner)})${runnerUp ? ` over ${runnerUp.dir} (score ${rank(runnerUp)})` : ''}`)

phase('Harden')
const promoteNotes = `
The winning candidate is at \`${winner.dir}\`. Its known outstanding issues:
${JSON.stringify(winner.mismatches || [], null, 1)}
Compliance violations: ${JSON.stringify(winner.compliance?.violations || [])}
${runnerUp ? `A second, independent implementation exists at \`${runnerUp.dir}\` — consult it when a behavior is ambiguous, and graft in anything it does better. Its known issues: ${JSON.stringify(runnerUp.mismatches || [])}` : ''}
`

const HARDEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['round', 'newMismatchesFound', 'fixesApplied', 'residualMismatches', 'casesRun'],
  properties: {
    round: { type: 'integer' },
    casesRun: { type: 'integer' },
    newMismatchesFound: { type: 'integer' },
    fixesApplied: { type: 'array', items: { type: 'string' } },
    residualMismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'expected', 'actual'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          expected: { type: 'string' },
          actual: { type: 'string' },
        },
      },
    },
    filesInOutput: { type: 'array', items: { type: 'string' } },
  },
}

// Round 1 promotes into /output and fixes known issues; later rounds hunt fresh divergences until dry.
let dryRounds = 0
let round = 0
const history = []
while (dryRounds < 2 && round < 5) {
  round += 1
  const isFirst = round === 1
  const r = await agent(`${COMMON}

## Authoritative behavioral specification

${specText}

${FILE_LAYOUT}

${isFirst ? `## Task (round 1): promote the winner into /output, then harden it

${promoteNotes}

1. Copy the winning candidate's tree into \`/output\` so that the entry point is exactly \`/output/test5.mjs\` and the
   library modules live under \`/output/lib/\` (all \`.mjs\`). \`/output\` must contain ONLY the final deliverable —
   no scratch scripts, no test harnesses, no candidate leftovers, no node_modules, no package.json unless it is
   genuinely needed (it is not: \`.mjs\` already forces ESM, so do NOT add one).
2. Fix every known outstanding issue listed above.
3. Then hunt for NEW divergences (see below).` : `## Task (round ${round}): keep hunting divergences in /output

The deliverable already lives at \`/output/test5.mjs\` + \`/output/lib/*.mjs\`. Previous rounds' results:
${JSON.stringify(history, null, 1)}

Attack from angles previous rounds did NOT cover. Be creative and adversarial: think about where a JS port of Python
semantics plausibly breaks — integer overflow in the polymod shift, \`>>\` vs \`>>>\`, UTF-16 surrogate pairs vs code
points, \`String.prototype.indexOf\` vs Python \`rfind\`, \`toLowerCase\`/\`toUpperCase\` on non-ASCII (Turkish dotless
i 'ı', Kelvin sign 'K', 'ſ'), empty-array edge cases, \`-0\`, numeric string coercion, argv containing an embedded
newline or NUL, and argparse's option-like-value heuristics.` }

## Divergence hunting protocol

Write your harness in a scratch dir OUTSIDE /output (e.g. /tmp/harden${round}/). Run \`node /output/test5.mjs ARGV...\`
against \`${EXE} ARGV...\` over **at least 500 fresh argv vectors this round**, comparing stdout, stderr and exit code
byte-for-byte. Drive both through a child-process API with an argv ARRAY (never shell string interpolation) so exotic
bytes survive. The ONLY permitted normalization is the prog name (\`test5_executable\` vs \`test5.mjs\`).

For every divergence: minimize it, fix the ROOT CAUSE in /output (never special-case an input), and re-run the full
corpus plus all previous rounds' cases to confirm no regression.

Finally re-audit the hard constraints on /output: \`grep -rn "require(\\|module.exports\\|Uint8Array\\|DataView" /output\`
must be empty; every import must be a relative \`./...mjs\` path or a \`node:\` builtin; \`node --check\` passes on every
file; and \`node /output/test5.mjs --a bc --b bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4\` prints
\`(0, [117, 30, 118, 232, 25, 145, 150, 212, 84, 148, 28, 69, 209, 179, 163, 35, 241, 67, 59, 214])\`.

Report honestly: casesRun this round, how many NEW divergences you found, what you fixed, and any residual
mismatches you could not resolve. Set newMismatchesFound to 0 only if the round was genuinely clean.`,
    { label: `harden:round${round}`, phase: 'Harden', effort: 'high', schema: HARDEN_SCHEMA })

  if (!r) { log(`round ${round}: agent failed, retrying`); continue }
  history.push({ round, casesRun: r.casesRun, newMismatchesFound: r.newMismatchesFound, fixesApplied: r.fixesApplied, residual: r.residualMismatches })
  log(`round ${round}: ${r.casesRun} cases, ${r.newMismatchesFound} new divergences, ${(r.fixesApplied || []).length} fixes, ${(r.residualMismatches || []).length} residual`)
  const clean = (r.newMismatchesFound || 0) === 0 && (r.residualMismatches || []).length === 0
  dryRounds = clean ? dryRounds + 1 : 0
}

phase('Critic')
const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'issues', 'overall'],
  properties: {
    lens: { type: 'string' },
    overall: { type: 'string', description: 'PASS or FAIL' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'problem', 'fix'],
        properties: {
          severity: { type: 'string', description: 'blocker | major | minor' },
          file: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const LENSES = [
  { key: 'constraints', prompt: `Lens: **hard-constraint compliance**. Audit EVERY file under /output against the mandatory requirements. Grep for \`require(\`, \`module.exports\`, \`Uint8Array\`, \`DataView\` (must all be absent, including in comments). Verify every file ends in \`.mjs\`, every relative import carries the \`.mjs\` suffix and resolves to an existing file, no import references anything but a relative path or a \`node:\` builtin, \`node --check\` passes on all files, the library is genuinely split into multiple modules with named \`export\`s and no dead/unused module, the entry point is exactly \`/output/test5.mjs\`, and /output holds no scratch/test/candidate leftovers. Run \`node /output/test5.mjs\` end to end.` },
  { key: 'semantics', prompt: `Lens: **Python-semantics fidelity**. Read every line of /output and hunt for places where the JS diverges from Python for inputs the test corpus may have missed: \`ord\`/code-point iteration vs UTF-16, \`str.rfind\` vs \`lastIndexOf\`, \`lower()\`/\`upper()\` round-trip on odd Unicode, list-slice \`data[1:]\` on a 0- or 1-element list, \`data[:-6]\`, integer shifts exceeding 31 bits in the polymod (sign-bit contamination), \`& 0x3fffffff\` masking, the pad=false rejection conditions, the exact ORDER of decode()'s guard clauses (could any input reach an index-out-of-range that Python avoids, or vice versa?), and the Python \`repr\` of the printed tuple. For each suspicion, actually run it against ${EXE} to confirm or refute before reporting. Report only CONFIRMED divergences.` },
  { key: 'cli', prompt: `Lens: **argparse fidelity**. Read /output's CLI module and adversarially compare it to ${EXE} on at least 120 argv vectors focused purely on parsing: equals-form, repeats, interleaved order, option-like values (\`-\`, \`-1\`, \`-1.5\`, \`-x\`, \`--\`, \`--=x\`, \`--ab\`, \`--a\` with no value), unknown flags mixed with missing required ones (precedence!), positionals, \`--help\`/\`-h\` exact text and stream and exit code, empty-string values, values containing spaces/newlines/=, and an argv where the value equals a flag name (\`--a --b\`). Confirm stream (stdout vs stderr) and exit code for each. Report only CONFIRMED divergences (prog-name difference is expected and NOT a divergence).` },
  { key: 'completeness', prompt: `Lens: **completeness critic**. What is MISSING from this work? Which behavior class was never tested, which claim was asserted but never verified, which module is untested, which spec requirement has no corresponding code? Look for silent caps or shortcuts. Then close the most important gaps yourself: write and run the missing differential tests against ${EXE} (at least 200 cases in the gap areas you identify) and report what you found. Report gaps as issues even if the code turns out correct.` },
]

const critiques = (await parallel(LENSES.map((l) => () =>
  agent(`${COMMON}

## Authoritative behavioral specification

${specText}

${FILE_LAYOUT}

## Task

The finished deliverable is at \`/output/test5.mjs\` with libraries under \`/output/lib/\`. Review it.

${l.prompt}

You may run anything you like in scratch dirs. **Do not modify /output** — only report. For every issue give the exact
file, the problem, and the precise fix. Return the structured result.`,
    { label: `critic:${l.key}`, phase: 'Critic', effort: 'high', schema: CRITIC_SCHEMA })
))).filter(Boolean)

const allIssues = critiques.flatMap((c) => (c.issues || []).map((i) => ({ ...i, lens: c.lens })))
const blockers = allIssues.filter((i) => /blocker|major/i.test(i.severity))
log(`Critics reported ${allIssues.length} issues (${blockers.length} blocker/major)`)

if (blockers.length) {
  phase('Critic')
  const fix = await agent(`${COMMON}

## Authoritative behavioral specification

${specText}

${FILE_LAYOUT}

## Task: resolve reviewer findings in /output

Four reviewers audited \`/output\`. These blocker/major issues were reported:

${JSON.stringify(blockers, null, 1)}

All reported issues (including minor):
${JSON.stringify(allIssues, null, 1)}

For EACH issue: first verify it is real by running \`${EXE}\` and \`node /output/test5.mjs\` yourself. If real, fix the
root cause in /output. If it is a false positive, say so and explain with evidence. Do not regress anything: after
fixing, re-run a broad differential corpus (>= 400 cases spanning valid v0/v1-16 addresses at boundary lengths, case
variants, checksum mutations, structural edges, non-ASCII, and the full argparse matrix) and confirm zero divergences
except the expected prog-name difference.

Return a plain-text report: per issue -> real/false-positive, what you changed, and the final differential result
(cases run, divergences).`,
    { label: 'resolve-findings', phase: 'Critic', effort: 'high' })
  log('Findings resolved')
  return { spec: specText, winner: winner.dir, scores: scores.map((s) => ({ dir: s.dir, cases: s.totalCases, mismatches: (s.mismatches || []).length, verdict: s.verdict })), hardenHistory: history, issues: allIssues, resolution: fix }
}

return { spec: specText, winner: winner.dir, scores: scores.map((s) => ({ dir: s.dir, cases: s.totalCases, mismatches: (s.mismatches || []).length, verdict: s.verdict })), hardenHistory: history, issues: allIssues, resolution: 'no blocker/major issues reported' }
