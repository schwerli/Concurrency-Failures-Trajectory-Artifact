export const meta = {
  name: 'jose-test8-fuzz-audit',
  description: 'Randomized differential fuzzing plus adversarial audit of the Node port in /output',
  phases: [
    { title: 'Fuzz', detail: 'independent generators diffing the port against the reference build' },
    { title: 'Audit', detail: 'requirement-compliance and correctness review of every module' },
    { title: 'Verify', detail: 'adversarially confirm or refute each reported problem' },
  ],
}

const CONTEXT = `
CONTEXT
=======
A Python program at /workspace/dataset/test8.py was ported to Node.js. The port lives in /output:

  /output/test8.mjs                     entry point
  /output/lib/index.mjs                 public surface
  /output/lib/jose/{jwt,jws,exceptions}.mjs
  /output/lib/python/{argparse,repr,jsonEncoder,jsonDecoder,unicodeClass}.mjs
  /output/lib/crypto/{sha256,hmacSha256}.mjs
  /output/lib/binary/{bytes,base64url}.mjs
  /output/tools/{difftest,gencases}.mjs  test harness (NOT part of the deliverable)

The reference build is /workspace/dataset/test8_executable. Run it directly; NEVER run 'python'.
Run the port with: node /output/test8.mjs --payload X --secret Y

The port must match the reference EXACTLY: stdout bytes, stderr bytes, and exit code.

HARD REQUIREMENTS ON THE DELIVERABLE
  1. ES Modules only. 'import'/'export' only. No require(), no module.exports.
  2. All library and entry files use the .mjs suffix, and imports include the full suffix.
  3. ZERO external/npm dependencies. Only local relative-path imports are allowed.
     Importing ANY bare module specifier is a violation - including Node built-ins
     such as node:crypto, node:fs, node:path, node:url in the SHIPPED code
     (/output/test8.mjs and everything under /output/lib/). The tools/ directory is
     a dev harness and is exempt.
  4. node:crypto must not be used or even referenced anywhere in the shipped code.
     HMAC and SHA-256 must be hand-implemented.
  5. No embedded Python, no shelling out to Python.
`

const FUZZ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy', 'casesRun', 'mismatches', 'notes'],
  properties: {
    strategy: { type: 'string' },
    casesRun: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argvJson', 'referenceOutput', 'portOutput', 'detail'],
        properties: {
          argvJson: { type: 'string', description: 'JSON array of argv, exactly reproducible' },
          referenceOutput: { type: 'string' },
          portOutput: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const STRATEGIES = [
  {
    key: 'unicode-sweep',
    prompt: `${CONTEXT}
TASK: exhaustively sweep the Unicode code point space for repr()/JSON escaping divergence.

Write a Node script that, for a large sample of code points, runs BOTH programs with that code point as
the --payload and byte-compares stdout+stderr+exit code. You may batch, but every code point you claim to
have covered must actually have been executed.

Cover at minimum:
  - every code point 0x01..0x2FF individually (skip 0x00, which cannot pass through argv)
  - every code point in 0x2000..0x20FF, 0xFE00..0xFEFF, 0xFF00..0xFFFF
  - a dense sample across 0x300..0xD7FF and 0xE000..0xFFFF (at least 3000 points)
  - a sample across the astral planes 0x10000..0x10FFFF (at least 2000 points), including plane
    boundaries, unassigned ranges, private use planes 15 and 16, and noncharacters (U+xFFFE/U+xFFFF)
  - multi-character combinations mixing printable and non-printable

The port decides printability from the engine's Unicode property escapes, while the reference uses
CPython's bundled Unicode database. If those two disagree on any code point, this sweep is what finds it.
Report EVERY divergent code point precisely (hex value, both renderings).
Report casesRun as the true number of code points actually executed.`,
  },
  {
    key: 'argv-shapes',
    prompt: `${CONTEXT}
TASK: fuzz the command-line PARSING surface for divergence in stderr text and exit codes.

Write a generator that produces several thousand random argv arrays from a vocabulary of tokens designed to
stress argparse: '--payload', '--secret', '--help', '-h', '--', '-', '', '-x', '-1', '-1.5', '-.5',
'--pay', '--p', '--s', '--se', '--h', '--payload=v', '--secret=', '--payload=--', '---', 'positional',
'a b', ' -x', '--payloadx', '--PAYLOAD', '-payload', plain values, and repeated options - in random orders
and lengths (0 to 8 tokens).

Diff stdout, stderr, AND exit code byte for byte against the reference for every generated argv.
Pay particular attention to:
  - which of "the following arguments are required" vs "unrecognized arguments" wins
  - the exact spacing and ordering inside those messages
  - abbreviation resolution and ambiguity
  - '--' placement
  - whether -h/--help short-circuits
Report every divergence with the exact argv as a JSON array.
Report casesRun as the true number of argv arrays actually executed.`,
  },
  {
    key: 'crypto-lengths',
    prompt: `${CONTEXT}
TASK: prove the hand-written SHA-256 and HMAC-SHA256 are correct.

Two independent jobs:

(a) KNOWN-ANSWER TESTS. The port exposes sha256, toHex and hmacSha256 from /output/lib/index.mjs.
    Write a Node script importing them and check them against PUBLISHED test vectors you know from the
    standards: the NIST/FIPS-180-4 SHA-256 vectors (empty string, "abc", the 448-bit and 896-bit strings,
    one million 'a' characters) and the RFC 4231 HMAC-SHA256 vectors (test cases 1 through 7, which include
    a 131-byte key that exercises the key-longer-than-block path). Report any vector that fails, with
    expected and actual hex.

(b) DIFFERENTIAL LENGTH SWEEP. Run both programs across payload and secret byte-lengths 0..300 inclusive
    (both dimensions, at least the full 0..300 range for each while holding the other fixed, plus a random
    sample of combinations), including multi-byte UTF-8 content so that byte length differs from character
    length. This targets SHA-256 padding boundaries (55/56/63/64 mod 64) and the HMAC key-normalization
    boundary at 64 bytes.

Report every failure. Report casesRun as the true total number of checks executed.`,
  },
  {
    key: 'random-payloads',
    prompt: `${CONTEXT}
TASK: broad randomized end-to-end differential fuzzing.

Generate at least 4000 random (payload, secret) pairs and diff both programs byte for byte. Mix these
generators roughly evenly:
  - random ASCII including all printable punctuation
  - random bytes decoded as UTF-8 (valid sequences only)
  - random strings from the full Unicode range including astral characters
  - strings built from characters that are escaped in either JSON or repr (quotes, backslash, controls,
    format characters, separators)
  - very long strings (1KB - 64KB)
  - strings that are pure whitespace, pure quotes, or pure backslashes
  - strings resembling JSON or JWT fragments, e.g. '{"a":1}', 'a.b.c', '==', '-_'

Note: a NUL byte cannot be passed through argv, so skip it. Newlines and tabs CAN be passed - include them.
Report every mismatch with the exact argv as a JSON array.
Report casesRun as the true number of pairs actually executed.`,
  },
]

phase('Fuzz')
const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'severity', 'summary', 'failureScenario'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          summary: { type: 'string' },
          failureScenario: { type: 'string', description: 'Concrete input/state -> wrong behaviour' },
        },
      },
    },
  },
}

const AUDITS = [
  {
    key: 'requirements',
    prompt: `${CONTEXT}
TASK: audit the SHIPPED code (/output/test8.mjs and everything under /output/lib/) against the five HARD
REQUIREMENTS above. Read every shipped file. Grep for: 'require(', 'module.exports', 'node:', 'crypto',
'from "' / "from '" with a bare specifier, and any import lacking a file extension.

Also verify:
  - every relative import resolves to a file that actually exists on disk
  - every .mjs import specifier includes the extension
  - nothing in lib/ or test8.mjs imports from tools/
  - the entry file actually runs and produces output when invoked as 'node /output/test8.mjs'
  - the code is genuinely split into multiple modules that export their interfaces (a requirement:
    "Libraries must be split into multiple modules by functionality and expose interfaces through export")
Report a finding for each violation. If there are none, return an empty findings array.`,
  },
  {
    key: 'correctness',
    prompt: `${CONTEXT}
TASK: hunt for real correctness bugs in the shipped code by reading it closely.

Read every shipped module. For each, ask what input would make it produce a byte different from the
reference. Focus on:
  - lib/crypto/sha256.mjs: the padding arithmetic, the 64-bit length field, the message schedule, and
    whether any intermediate can exceed 32 bits or go negative
  - lib/crypto/hmacSha256.mjs: key normalization at exactly 64 and 65 bytes, empty key
  - lib/binary/base64url.mjs: the tail cases for input lengths 1 and 2 mod 3, and decode padding
  - lib/binary/bytes.mjs: surrogate handling in utf8Encode/utf8Decode
  - lib/python/repr.mjs: the exact branch order versus CPython's unicode_repr, especially the
    interaction between the quote character, backslash, 0x7f, and the printability test
  - lib/python/jsonEncoder.mjs: the escape table versus CPython's ESCAPE_DCT/ESCAPE_ASCII
  - lib/python/jsonDecoder.mjs: does it correctly rebuild astral characters from escaped surrogate pairs?
  - lib/python/argparse.mjs: token classification, the '--' separator, abbreviation, required-vs-extras
    ordering, and the help-column arithmetic
Where you suspect a bug, CONSTRUCT the input and run both programs to check. Only report what you can
demonstrate or precisely argue. Empty findings array if you find nothing.`,
  },
  {
    key: 'dead-code',
    prompt: `${CONTEXT}
TASK: review the shipped code for quality problems that a senior reviewer would flag:
  - dead code, unreachable branches, unused imports, unused exports, vestigial parameters
  - functions that claim in a comment to do something they do not do
  - misleading or wrong comments (verify each factual claim in a comment against the actual behaviour of
    the reference binary where you can)
  - duplicated logic that should be shared
  - error paths that would throw an unhandled exception and produce a Node stack trace instead of the
    reference program's behaviour - in particular, what does the port do if it is given input that makes
    an internal function throw? Try to find such an input.
Report findings with severity. Empty array if clean.`,
  },
  {
    key: 'robustness',
    prompt: `${CONTEXT}
TASK: try to make the PORT crash, hang, or print a Node stack trace where the reference does not.

Attack surface: argv contents and shapes, absurd lengths, deeply weird Unicode, environment variables
(notably COLUMNS, which the port reads for help formatting - check what the reference does for
'COLUMNS=20 ${'${EXE}'} --help' versus the port, and for other COLUMNS values including 0, 1, 40, 200 and
non-numeric), stdout being closed or a full pipe, and being invoked from a different working directory.

Explicitly test:
  - running the port from several different working directories
  - COLUMNS set to 0, 1, 20, 40, 60, 79, 80, 200, '', 'abc'  for both --help and an error case
  - piping stdout to 'head -c 1' so the pipe closes early
  - very large payloads (1MB)
Report every divergence as a finding.`,
  },
]

// Fuzz and audit are independent; run both groups concurrently, then verify.
const [fuzzResults, auditResults] = await Promise.all([
  parallel(STRATEGIES.map(s => () =>
    agent(s.prompt, { label: `fuzz:${s.key}`, phase: 'Fuzz', schema: FUZZ_SCHEMA, effort: 'high' }))),
  parallel(AUDITS.map(a => () =>
    agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: AUDIT_SCHEMA, effort: 'high' }))),
])

const fuzz = fuzzResults.filter(Boolean)
const audits = auditResults.filter(Boolean)

const totalCases = fuzz.reduce((n, f) => n + (f.casesRun || 0), 0)
const mismatches = fuzz.flatMap(f => (f.mismatches || []).map(m => ({ kind: 'mismatch', source: f.strategy, ...m })))
const findings = audits.flatMap(a => (a.findings || []).map(f => ({ kind: 'finding', ...f })))

log(`fuzzers executed ~${totalCases} differential cases; ${mismatches.length} mismatches, ${findings.length} audit findings`)

phase('Verify')
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'verdict', 'evidence'],
  properties: {
    real: { type: 'boolean' },
    verdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED', 'UNCLEAR'] },
    evidence: { type: 'string', description: 'Exact commands run and their exact output' },
    suggestedFix: { type: 'string' },
  },
}

const claims = [...mismatches, ...findings]

if (claims.length === 0) {
  log('nothing to verify - fuzzers and auditors both came back clean')
  return { totalCases, mismatches: [], findings: [], confirmed: [] }
}

// Each claim gets two independent skeptics with different lenses.
const LENSES = [
  'REPRODUCE IT: run the exact commands yourself against both programs and compare raw bytes. If you cannot reproduce the divergence, the claim is REFUTED.',
  'STEAL-MAN THEN BREAK IT: assume the claim is wrong. Read the relevant source in /output and argue why the described failure cannot happen. Only if that argument fails should you call it CONFIRMED.',
]

const verified = await pipeline(
  claims,
  claim => parallel(LENSES.map((lens, i) => () =>
    agent(`${CONTEXT}
A reviewer reported the following problem with the port. Your job is ADVERSARIAL verification.

${lens}

REPORTED PROBLEM:
${JSON.stringify(claim, null, 2)}

Default to REFUTED when uncertain. A claim only counts if the port actually behaves differently from
/workspace/dataset/test8_executable, or actually violates one of the stated hard requirements.
Include the exact commands and their exact output as evidence.`,
      { label: `verify:${(claim.summary || claim.detail || 'claim').slice(0, 40)}#${i}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' }))),
  (votes, claim) => {
    const good = votes.filter(Boolean)
    const yes = good.filter(v => v.real && v.verdict === 'CONFIRMED').length
    return { claim, confirmed: yes >= 1 && yes >= good.length - yes, votes: good }
  },
)

const survivors = verified.filter(Boolean).filter(v => v.confirmed)
log(`${survivors.length}/${claims.length} claims survived adversarial verification`)

return {
  totalCases,
  fuzzSummary: fuzz.map(f => ({ strategy: f.strategy, casesRun: f.casesRun, mismatches: (f.mismatches || []).length, notes: f.notes })),
  confirmed: survivors.map(s => ({ claim: s.claim, evidence: s.votes.map(v => v.evidence), fixes: s.votes.map(v => v.suggestedFix).filter(Boolean) })),
  refuted: verified.filter(Boolean).filter(v => !v.confirmed).map(v => v.claim.summary || v.claim.detail),
}
