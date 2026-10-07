export const meta = {
  name: 'verify-bech32-port',
  description: 'Differentially fuzz and audit the Python->Node bech32 port in /output against the reference executable',
  phases: [
    { title: 'Fuzz', detail: 'one agent per input family: generate corpus, diff Node vs executable' },
    { title: 'Verify', detail: 'independently re-confirm each reported mismatch' },
    { title: 'Audit', detail: 'multi-lens static audit of the generated code' },
    { title: 'Critique', detail: 'completeness critic: what was never exercised' },
  ],
}

const SHARED = `
## Context

A Python program at /workspace/dataset/bech32/test12.py has been ported to Node ESM at /output/test12.mjs
(library modules under /output/lib/{bech32,python,cli}/*.mjs).

The behavioural spec derived by black-box probing lives at /tmp/spec/SPEC.md -- READ IT FIRST. It is
ground truth for what the reference does, including two non-obvious findings:
  * the reference bech32 module is BIP-173 only (no bech32m), and
  * its only length limit is HRP <= 83 chars; there is NO 90-character total limit.

## Tools already built for you (use them, do not reinvent)

* /workspace/dataset/test12_executable --a <hrp> --b <addr>   <- the reference implementation (Python, precompiled).
  NEVER run \`python\`. Run this binary directly.
* node /output/test12.mjs --a <hrp> --b <addr>                <- the port under test.
* node /tmp/probe/gen.mjs enc <hrp> <witver> <b0,b1,...>      <- prints a valid segwit address.
* node /tmp/probe/gen.mjs raw <hrp> <d0,d1,...>               <- prints a valid raw bech32 string from 5-bit data.
  You can also \`import { segwitEncode, bech32Encode, convertbits } from '/tmp/probe/gen.mjs'\` in your own .mjs script.
* node /tmp/probe/diff.mjs <corpus.json> [maxExamples]        <- THE DIFFERENTIAL RUNNER.
  corpus.json is a JSON array of argv arrays, e.g. [["--a","bc","--b","bc1pqypqj3p230"],["--help"]].
  It runs both programs on every entry and compares stdout, stderr and exit code byte-for-byte.
  It prints "total=N mismatches=M" then one JSON line per mismatch.
  It normalises the program name token (test12_executable vs test12.mjs) because argparse derives
  prog from basename(argv[0]) in both languages -- that difference is intentional and NOT a bug.

## Rules

* DO NOT modify anything under /output. You are only measuring and reporting. The orchestrator applies fixes.
* Write your corpus to /tmp/corpus/<family>.json so it can be replayed later. Make it a real JSON array of argv arrays.
* Aim for at least 400 cases in your corpus, more if your family is cheap to enumerate. Bias hard toward
  boundaries, not random middles.
* Report ONLY real divergences. The prog-name token is not one.
`

const FUZZ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['family', 'corpusPath', 'total', 'mismatches', 'examples', 'notes'],
  properties: {
    family: { type: 'string' },
    corpusPath: { type: 'string' },
    total: { type: 'integer' },
    mismatches: { type: 'integer' },
    examples: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'expected', 'actual', 'diagnosis'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          expected: { type: 'string' },
          actual: { type: 'string' },
          diagnosis: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'reasoning', 'rootCause', 'suggestedFix'],
  properties: {
    isReal: { type: 'boolean' },
    reasoning: { type: 'string' },
    rootCause: { type: 'string' },
    suggestedFix: { type: 'string' },
  },
}

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'findings'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'severity', 'summary', 'failureScenario', 'suggestedFix'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          summary: { type: 'string' },
          failureScenario: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
      },
    },
  },
}

const FAMILIES = [
  {
    key: 'v0-valid',
    brief: `Valid witness-version-0 addresses. Programs of exactly 20 and 32 bytes.
Cover: all bytes < 32 (so convertbits(witprog,5,8) returns a LIST), at least one byte >= 32 (returns None),
byte value exactly 31 vs exactly 32 at every position, all-zero programs, all-0xff programs.
Use hrps bc, tb, ltc, test, and a few odd ones.`,
  },
  {
    key: 'v1-v16-valid',
    brief: `Valid addresses for witness versions 1..16 with program lengths 2..40 (every length).
Cover the 31/32 byte-value boundary so both the list and None print paths are hit for each length.
Remember: the reference accepts non-zero witness versions with an ORDINARY bech32 checksum (no bech32m).`,
  },
  {
    key: 'segwit-rejects',
    brief: `Addresses that decode as bech32 but must be rejected by the segwit layer:
witness version 17..31 (data[0] > 16), program length 0, 1 and 41+, witness version 0 with program
length in {2..19, 21..31, 33..40}, and payloads whose trailing partial group is non-zero (which makes
convertbits(data[1:],5,8,pad=false) return None). Use gen.mjs raw to build arbitrary 5-bit payloads.`,
  },
  {
    key: 'checksum-tamper',
    brief: `Take valid addresses and corrupt them: substitute each data character with every other charset
character (sample broadly), swap adjacent characters, delete one character, insert one character,
truncate the checksum, duplicate the checksum. Almost all must produce no output; find any where the
port and the reference disagree.`,
  },
  {
    key: 'case-variants',
    brief: `Case handling. For several valid addresses emit: all lower, all upper, and mixed case flipping
exactly one character at every position (both directions). Also pass the --a hrp in the wrong case
(upper hrp with upper address, upper hrp with lower address, mixed hrp). Also addresses whose hrp has
no cased characters at all (digit-only hrp like "123", punctuation hrp) in upper and lower form.`,
  },
  {
    key: 'hrp-lengths',
    brief: `HRP length sweep. For hrp lengths 1..95 build a valid address (use gen.mjs enc) and check both
programs agree, with BOTH a short 2-byte program and a 40-byte program so total length varies
independently of hrp length. The expected boundary is hrp length 83 OK / 84 rejected, with NO
90-character total limit -- confirm that precisely and report any deviation.`,
  },
  {
    key: 'hrp-charset',
    brief: `HRP character space. Build valid addresses with hrps made of every printable ASCII code point 33..126
(one hrp per code point, plus multi-char combinations), hrps containing '1', hrps that are entirely
digits, and hrps whose characters are in the bech32 charset. Also try hrp arguments that mismatch the
address hrp by a prefix, a suffix, or one character.`,
  },
  {
    key: 'separator-edge',
    brief: `Separator ('1') handling. Addresses with: no '1' at all, '1' only at index 0, multiple '1' characters
(rfind must pick the LAST), fewer than 6 characters after the last '1', exactly 6 characters after it
(empty payload), '1' as the final character, and hrps that themselves end in '1'.`,
  },
  {
    key: 'charset-and-bytes',
    brief: `Character-level rejection. Addresses containing the four excluded characters '1','b','i','o' in the
data part; characters with code point < 33 (space, tab, newline, and every control char you can pass
through argv) or > 126 (DEL, Latin-1, multi-byte UTF-8, emoji, combining marks); and the empty string
for --b. Also the empty string for --a.`,
  },
  {
    key: 'official-vectors',
    brief: `The published BIP-173 and BIP-350 test vectors -- every valid and every invalid address listed in both
BIPs -- each tried against the correct hrp and against a wrong hrp. This is the highest-signal family:
the BIP-350 (bech32m) vectors must ALL produce no output, and the BIP-173 vectors must decode.
Look up the vectors from your own knowledge; do not fetch anything.`,
  },
  {
    key: 'argparse-forms',
    brief: `Command-line parsing only. Enumerate: missing --a, missing --b, missing both, --a=v and --b=v forms,
values containing '=', repeated options (last wins), reordered options, unknown options (--c, -a, -b, -z,
--ab, --aa), abbreviations of --help (--h, --he, --hel, --hel=x, --help=x), -h in every position, -h with a
tail (-hh, -hz, -h=x), a bare --, a trailing --, -- before the options, an option with no value at the end
of argv, empty-string values, values that look like options (-x, -5, -0, -1.5, -.5, -5x, "-", "- 5", " -x"),
and extra positional junk. Compare stdout, stderr AND exit code. Expect exit 2 for usage errors and 0 for
--help. Ignore only the prog-name token.`,
  },
  {
    key: 'max-size',
    brief: `Size extremes. The largest addresses the reference accepts (hrp 83 chars + 40-byte program = 155 chars
total) and everything just past each edge. Also very long --b values (1000+ chars, both valid-charset and
not) and very long --a values, to confirm neither program errors out differently.`,
  },
]

phase('Fuzz')
log(`fanning out ${FAMILIES.length} differential fuzz families`)

// Pipeline, not a barrier: each family's mismatches go straight to independent
// verification while slower families are still generating their corpus.
const perFamily = await pipeline(
  FAMILIES,
  (fam) =>
    agent(
      `${SHARED}

## Your family: ${fam.key}

${fam.brief}

Steps:
1. Read /tmp/spec/SPEC.md.
2. Write a generator script (anywhere under /tmp, NOT /output) that emits /tmp/corpus/${fam.key}.json
   -- a JSON array of argv arrays. Every entry must include the flags themselves, e.g.
   ["--a","bc","--b","bc1pqypqj3p230"].
3. Run: node /tmp/probe/diff.mjs /tmp/corpus/${fam.key}.json 12
4. If mismatches > 0, shrink each one to a minimal reproducing argv and re-run the two programs by hand
   to capture their exact stdout/stderr/exit code.
5. Return the structured result. "expected" is the reference output, "actual" is the port's output; include
   exit codes in those strings when they differ. Set mismatches to the number the runner reported.

Be adversarial: your job is to find a case where the port disagrees, not to confirm it works.`,
      { label: `fuzz:${fam.key}`, phase: 'Fuzz', schema: FUZZ_SCHEMA },
    ),
  (result, fam) => {
    if (!result || result.mismatches === 0 || result.examples.length === 0) return result
    // Each candidate divergence gets three independent skeptics, each told to refute.
    return parallel(
      result.examples.map((ex) => () =>
        parallel(
          ['reproduce it from a clean shell', 'check it against /tmp/spec/SPEC.md', 'check whether it is only the prog-name token or a harness artifact'].map(
            (lens) => () =>
              agent(
                `${SHARED}

## Verify a reported divergence (family ${fam.key})

argv: ${JSON.stringify(ex.argv)}
reported reference output: ${JSON.stringify(ex.expected)}
reported port output:      ${JSON.stringify(ex.actual)}
reporter's diagnosis:      ${ex.diagnosis}

Your lens: ${lens}.

Try to REFUTE this. Run both programs yourself:
  /workspace/dataset/test12_executable ${ex.argv.map((a) => JSON.stringify(a)).join(' ')}
  node /output/test12.mjs ${ex.argv.map((a) => JSON.stringify(a)).join(' ')}
Capture stdout, stderr and exit code for each. Default to isReal=false if you cannot reproduce a
genuine byte-level difference, or if the only difference is the prog-name token.
If it IS real, name the exact file and line in /output that causes it and the minimal fix.`,
                { label: `verify:${fam.key}`, phase: 'Verify', schema: VERDICT_SCHEMA },
              ),
          ),
        ).then((votes) => {
          const real = votes.filter(Boolean).filter((v) => v.isReal)
          return { family: fam.key, argv: ex.argv, confirmed: real.length >= 2, votes: votes.filter(Boolean) }
        }),
      ),
    ).then((verdicts) => ({ ...result, verdicts }))
  },
)

const fuzz = perFamily.filter(Boolean)
const confirmedBugs = fuzz.flatMap((r) => (r.verdicts ?? []).filter((v) => v.confirmed))
log(`fuzz done: ${fuzz.reduce((n, r) => n + r.total, 0)} cases, ${confirmedBugs.length} confirmed divergences`)

phase('Audit')

const LENSES = [
  {
    key: 'esm-and-deps',
    brief: `Hard requirement compliance. Walk every file under /output and check:
  * ESM only -- no \`require(\`, no \`module.exports\`, no \`exports.\`, no \`__dirname\`/\`__filename\`.
  * every file ends in .mjs, and EVERY relative import specifier includes the .mjs extension.
  * zero npm/external imports; the only bare specifiers allowed are node: builtins. List every import found.
  * no embedded Python, no child_process shelling out to python, no eval of foreign code.
  * every module actually resolves: run \`node --check\` on each file AND \`node -e "await import('...')"\`
    for each module to prove there are no unresolved specifiers or circular-import failures.
  * every exported symbol is either used or a deliberate part of the module's public surface; flag dead exports.`,
  },
  {
    key: 'forbidden-apis',
    brief: `The task forbids using OR MENTIONING \`Uint8Array\` and \`DataView\` anywhere. Grep all of /output
(code AND comments AND strings) for: Uint8Array, DataView, ArrayBuffer, TypedArray, Buffer, Int8Array,
Uint16Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, atob, btoa, TextEncoder, TextDecoder.
Report every hit with file and line. Also confirm all byte-ish data is plain JS arrays of numbers.`,
  },
  {
    key: 'python-semantics',
    brief: `Hunt for Python-vs-JavaScript semantic divergences by reading every line of /output/lib and
/output/test12.mjs. Specifically check:
  * \`0\` and \`''\` are falsy in JS but not None in Python -- any truthiness test that should be \`!== null\`?
  * \`>>\`/\`<<\`/\`&\`/\`^\` in JS truncate to 32 bits and coerce via ToInt32; prove every value in
    bech32Polymod, bech32CreateChecksum and convertbits stays in range so the results are identical to
    Python's arbitrary-precision ints. Check the sign bit: could \`chk\` ever go negative?
  * \`(1 << n)\` for large n, and negative shift counts (JS masks the count mod 32, Python raises).
    The reference convertbits pad=false branch is \`(acc << (tobits - bits)) & maxv\`; confirm /output uses
    that and not \`(acc << (frombits - tobits))\`, which would be a negative shift for 5->8.
  * \`array.slice(0, -6)\` when the array has fewer than 6 elements -- does it match Python's \`data[:-6]\`?
  * \`String.lastIndexOf\` vs Python \`rfind\`, \`indexOf\` vs \`find\`, and \`slice\` vs Python slicing on
    out-of-range indices.
  * string iteration by code point vs UTF-16 code unit.
  * \`Math\` / number formatting: does any integer ever print as \`1e+21\` or \`-0\`?
  * short-circuit evaluation order where Python's \`or\`/\`and\` protects a later operand from throwing.
Return concrete failure scenarios with an argv that would trigger them, not style opinions.`,
  },
  {
    key: 'output-bytes',
    brief: `Byte-exact output fidelity. Verify:
  * \`print(witver)\` and \`print(converted)\` produce exactly the Python repr plus one \\n --
    compare \`od -c\` of both programs for a case that prints a list, a case that prints None,
    and witness version 0 (which is falsy in JS).
  * --help output is byte-identical modulo the prog name (\`diff <(exe --help) <(node ... --help)\`).
  * every usage-error message is byte-identical modulo the prog name, and goes to STDERR not stdout,
    with exit code 2; --help goes to STDOUT with exit code 0.
  * stdout is not truncated when the process exits non-zero: confirm the port never calls process.exit(),
    and test through a pipe (e.g. \`node /output/test12.mjs 2>&1 >/dev/null | cat\`) plus a case with
    large output, to prove nothing is lost.
  * no stray trailing whitespace or missing/extra final newline anywhere.`,
  },
  {
    key: 'argparse-fidelity',
    brief: `Audit /output/lib/cli/*.mjs against CPython's argparse from your own knowledge of its source.
Walk the ported algorithm (parseOptional, getOptionTuples, consumeOptional, matchArgument, the
option/value pattern string, the required-args check, the extras collection order) and find any case
where it would diverge. Pay attention to: the order in which the required-arguments error and the
unrecognized-arguments error are raised; the negative-number heuristic; the "contains a space" rule;
prefix-abbreviation matching and the ambiguous-option error; \`--\` separator handling; a flag with a
concatenated tail like \`-hz\`; \`--help=x\`; \`--h=x\`; and the metavar/dest derivation. For every suspicion,
construct the argv and actually run both programs to see whether they agree.`,
  },
  {
    key: 'bech32-crypto',
    brief: `Audit the bech32 maths itself against the BIP-173 reference algorithm from your own knowledge.
Check the CHARSET string character by character, the five generator constants digit by digit, the
polymod loop, hrp expansion (high bits, zero separator, low bits), checksum creation and verification,
and convertbits in both directions and both pad modes. Then empirically confirm: encode/decode
round-trips for many random (hrp, witver, program) triples agree with the reference executable, and
the port's own bech32Encode output is accepted by the Python executable.`,
  },
]

const audits = (
  await parallel(
    LENSES.map((lens) => () =>
      agent(
        `${SHARED}

## Your audit lens: ${lens.key}

${lens.brief}

Read the actual files. Run commands to prove or disprove each suspicion -- an unverified suspicion is
not a finding. Return only findings you have evidence for, most severe first. Empty list is a fine answer.`,
        { label: `audit:${lens.key}`, phase: 'Audit', schema: AUDIT_SCHEMA },
      ),
    ),
  )
).filter(Boolean)

phase('Critique')

const critic = await agent(
  `${SHARED}

## Completeness critique

These differential families were run: ${FAMILIES.map((f) => f.key).join(', ')}
Corpora are in /tmp/corpus/. Totals per family:
${fuzz.map((r) => `  ${r.family}: ${r.total} cases, ${r.mismatches} mismatches`).join('\n')}

These audit lenses were run: ${LENSES.map((l) => l.key).join(', ')}
Findings reported: ${JSON.stringify(audits.flatMap((a) => a.findings.map((f) => `${a.lens}:${f.severity}:${f.summary}`)))}
Confirmed differential divergences: ${JSON.stringify(confirmedBugs.map((b) => b.argv))}

Your job: find what is still UNEXERCISED. Inspect the corpora on disk to see what was actually covered
rather than trusting the descriptions. Then answer:
  * which reachable code paths in /output has nothing driven yet? (check every branch of every function)
  * which input shapes does no corpus contain?
  * which claim in /tmp/spec/SPEC.md is asserted but never re-verified?
Then actually TEST the top gaps you find yourself -- build a corpus and run /tmp/probe/diff.mjs on it.
Report what you tested and any divergence you found.`,
  { label: 'critic', phase: 'Critique' },
)

return {
  totalCases: fuzz.reduce((n, r) => n + r.total, 0),
  perFamily: fuzz.map((r) => ({ family: r.family, total: r.total, mismatches: r.mismatches, notes: r.notes })),
  confirmedDivergences: confirmedBugs,
  unconfirmedExamples: fuzz.flatMap((r) => (r.verdicts ?? []).filter((v) => !v.confirmed).map((v) => v.argv)),
  auditFindings: audits.flatMap((a) => a.findings.map((f) => ({ lens: a.lens, ...f }))),
  critique: critic,
}
