export const meta = {
  name: 'py-base58-to-node-port',
  description: 'Port test19.py (Python base58) to zero-dependency Node ESM in /output, with differential fuzzing against the reference binary',
  phases: [
    { title: 'Implement' },
    { title: 'Fuzz' },
    { title: 'Select' },
    { title: 'Verify' },
    { title: 'Repair' },
    { title: 'Final' },
  ],
}

const SPEC = '/tmp/SPEC.md'
const EXE = '/workspace/dataset/test19_executable'

const COMMON = `
You are porting a Python program to Node.js. READ ${SPEC} FIRST — it is a complete,
empirically-verified behavioral spec produced by probing the reference binary. Also read
/workspace/dataset/test19.py.

The reference binary is ${EXE}. Run it to check any behavior you are unsure about.
NEVER run \`python\`. NEVER pass a negative value to --e or --f (the reference hangs; so
must the port — that is correct behavior, just don't test it without a timeout).

HARD CONSTRAINTS (violating any one invalidates the work):
- ES modules only: \`import\` / \`export\`. No \`require\`, no \`module.exports\`.
- Every file ends in .mjs. Every import specifier is local (\`./x.mjs\`) WITH the extension.
- Zero npm packages. Of the Node built-ins, only \`node:fs\` may be imported.
  Do NOT import node:crypto — SHA-256 must be hand-written in pure JS.
- The strings Buffer, Uint8Array, TypedArray, TextEncoder, TextDecoder, atob, btoa must
  NOT appear anywhere in the source, not even inside comments. Model byte strings as a
  plain Array of numbers 0..255 and implement base58 by hand.
- Library code must be split into several focused modules and expose them via \`export\`.
- Byte-exact stdout and matching process exit codes (0 success / 1 uncaught exception /
  2 argparse error).
`

const IMPL_NOTE = `
Suggested (not mandatory) module split — use your own judgement, but it MUST be
hierarchical, not one big file:
  pybytes.mjs   byte-array primitives (concat, slice, lstrip, equality)
  pycodec.mjs   utf-8 encode/decode with Python semantics + surrogateescape, ascii encode
  pyrepr.mjs    Python bytes repr and str repr
  pyerrors.mjs  ValueError / UnicodeEncodeError analogues + the traceback templates
  pyint.mjs     Python int() parser (unicode whitespace + unicode Nd digits + underscores)
  pystr.mjs     Python str.rstrip() unicode-whitespace charset
  sha256.mjs    pure-JS SHA-256 over number arrays
  base58.mjs    b58encode/b58decode/b58encode_int/b58decode_int/b58*_check
  argparse.mjs  the argparse subset (usage text, required check, --x=v, error messages)
  argv.mjs      raw argv recovery from /proc/self/cmdline with surrogateescape + fallback
  test19.mjs    entry point
Use BigInt for arbitrary-precision integers.
`

const CAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'files', 'selfTest', 'notes'],
  properties: {
    dir: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    selfTest: { type: 'string', description: 'How many differential cases you ran and the pass/fail tally' },
    notes: { type: 'string', description: 'Design decisions and any known remaining divergence' },
  },
}

const FUZZ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'casesRun', 'mismatches', 'verdict'],
  properties: {
    dir: { type: 'string' },
    casesRun: { type: 'integer' },
    verdict: { type: 'string', enum: ['clean', 'minor', 'broken'] },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['args', 'expected', 'actual', 'kind'],
        properties: {
          args: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          kind: { type: 'string', description: 'stdout | exitcode | stderr | crash' },
        },
      },
    },
  },
}

phase('Implement')
log('Spawning 3 independent implementations of the port')

const CANDS = [
  { dir: '/tmp/cand1', angle: 'Prioritise a clean, minimal, provably-correct core: get b58encode/b58decode/int-parsing/bytes-repr exactly right first, then the argv and traceback fidelity layers.' },
  { dir: '/tmp/cand2', angle: 'Prioritise total behavioural fidelity including the argparse error strings, the /proc/self/cmdline surrogateescape recovery, and the exact Python traceback text on stderr. Mirror the Python library structure closely.' },
  { dir: '/tmp/cand3', angle: 'Prioritise adversarial edge cases: unicode whitespace rstrip, unicode Nd digits in int(), astral-plane characters, leading-1 runs, empty inputs, huge integers, quote selection in bytes repr. Build a large self-test corpus as you go.' },
]

const built = await pipeline(
  CANDS,
  (c, _orig, i) => agent(
    `${COMMON}\n${IMPL_NOTE}\n
Write your complete candidate implementation into the directory ${c.dir} (create it;
mkdir -p is fine). Entry point ${c.dir}/test19.mjs, libraries under ${c.dir}/lib/.

Your angle for this candidate: ${c.angle}

When the files are written, differentially self-test: run \`node ${c.dir}/test19.mjs ARGS\`
and \`${EXE} ARGS\` on at least 60 varied argument sets (all four sample cases from the
docstring at the bottom of test19.py, plus every vector in section 3 of the spec, plus
your own edge cases) and compare stdout byte-for-byte AND the exit code. Iterate until
they agree. Report honestly — do not claim a pass you did not observe.`,
    { label: `impl:cand${i + 1}`, phase: 'Implement', schema: CAND_SCHEMA }
  ),
  (res, c, i) => res && agent(
    `${COMMON}

An implementation of the port lives in ${c.dir} (entry ${c.dir}/test19.mjs). You did NOT
write it; your job is to BREAK it.

Write a differential fuzzer (put it in /tmp/fuzz${i + 1}.mjs, run it with node) that:
 - generates at least 400 randomized argument sets covering: ASCII text, empty strings,
   strings of only whitespace, leading/trailing unicode whitespace, base58-valid strings,
   base58-INVALID strings (chars 0 O I l, punctuation, spaces in the middle), strings of
   leading '1' runs, UTF-8 multibyte (Latin-1 accents, CJK, emoji / astral plane),
   quote and backslash characters, very long strings (1-2 KB), integers of every size
   from 0 to 10^40, integers written with +, underscores, surrounding whitespace, and
   unicode digits, and malformed integers.
 - ALSO covers the argparse paths: missing required args, unknown options, --x=v form,
   duplicate options, a missing value at end of line, -h.
 - runs each case against BOTH ${EXE} and \`node ${c.dir}/test19.mjs\`, comparing stdout
   byte-for-byte and the exit status. Compare stderr too, but report a stderr-only
   difference as a separate, lower-priority mismatch (and ignore the varying PID in the
   [PYI-...] line).
 - NEVER generates a negative --e or --f, and uses a per-case timeout so a hang cannot
   stall the run.

Report every distinct mismatch you find (dedupe by root cause, cap the list at 20).
Report casesRun honestly. verdict: 'clean' = zero stdout/exit mismatches, 'minor' =
only stderr or a couple of exotic cases, 'broken' = stdout or exit code differs on
ordinary input.`,
    { label: `fuzz:cand${i + 1}`, phase: 'Fuzz', schema: FUZZ_SCHEMA }
  ).then((f) => ({ cand: c, build: res, fuzz: f }))
)

const alive = built.filter((b) => b && b.fuzz)
log(`Fuzzing done: ${alive.map((b) => `${b.cand.dir}=${b.fuzz.verdict}(${b.fuzz.mismatches.length} issues/${b.fuzz.casesRun} cases)`).join(', ')}`)

phase('Select')
const digest = alive.map((b) => `### ${b.cand.dir}
files: ${b.build.files.join(', ')}
self-test: ${b.build.selfTest}
notes: ${b.build.notes}
fuzz verdict: ${b.fuzz.verdict} over ${b.fuzz.casesRun} cases
mismatches:
${b.fuzz.mismatches.map((m) => `  - [${m.kind}] args=${m.args}\n    expected=${m.expected}\n    actual=${m.actual}`).join('\n') || '  (none)'}`).join('\n\n')

const FINAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['basedOn', 'files', 'fixesApplied', 'testTally', 'remainingRisks'],
  properties: {
    basedOn: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    fixesApplied: { type: 'array', items: { type: 'string' } },
    testTally: { type: 'string' },
    remainingRisks: { type: 'array', items: { type: 'string' } },
  },
}

const finalBuild = await agent(
  `${COMMON}

Three independent candidate ports were built and independently fuzzed against the
reference binary. Here are the results:

${digest}

Your job: produce the FINAL deliverable in /output.
 1. Read the candidates' code. Pick the strongest base (best fuzz verdict, cleanest
    hierarchy), then graft in anything the other two did better — especially any case
    where one candidate handles a mismatch the others failed.
 2. Fix EVERY mismatch listed above. If a mismatch report looks wrong, re-run that exact
    case against ${EXE} yourself before believing it.
 3. Write the result to /output: entry /output/test19.mjs, libraries under /output/lib/.
    Nothing else in /output. Clean, well-named, commented modules.
 4. Re-run a differential check of /output/test19.mjs against ${EXE} on at least 200
    cases (include all four docstring sample cases and every section-3 vector) and
    confirm zero stdout/exit-code mismatches. Report the real tally.
 5. Grep the finished tree to prove: no 'require(', no 'module.exports', no 'Buffer',
    no 'Uint8Array', no 'TextEncoder'/'TextDecoder', no bare (non-'./') import other
    than 'node:fs', and every import specifier ends in .mjs.`,
  { label: 'select+finalize', phase: 'Select', schema: FINAL_SCHEMA }
)

phase('Verify')
const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'pass', 'findings'],
  properties: {
    lens: { type: 'string' },
    pass: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'issue', 'evidence', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          evidence: { type: 'string', description: 'A concrete reproducing command and its two outputs, or a grep hit' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const LENSES = [
  {
    key: 'constraints',
    prompt: `Audit /output for compliance with the task's hard constraints ONLY. Check every
file: ESM-only (no require/module.exports), .mjs suffix on all files AND on every import
specifier, imports are local relative paths except at most 'node:fs', zero npm deps, the
banned identifiers (Buffer, Uint8Array, TypedArray, TextEncoder, TextDecoder, atob, btoa)
appear nowhere including comments, no embedded Python, no shelling out to python, code is
split hierarchically into multiple exporting modules rather than one monolith, and
/output contains nothing stray. Also confirm the entry file is exactly /output/test19.mjs
and that it runs from any cwd (test: cd / && node /output/test19.mjs --a x --b '' --c x --d x --e 1 --f 1).`,
  },
  {
    key: 'differential-deep',
    prompt: `Run your own INDEPENDENT differential fuzz of /output/test19.mjs against ${EXE}.
Do not trust any earlier report. At least 600 cases, heavily weighted toward the exotic:
unicode whitespace (all of U+0009 U+000A U+000B U+000C U+000D U+001C-U+001F U+0020 U+0085
U+00A0 U+1680 U+2000-U+200A U+2028 U+2029 U+202F U+205F U+3000) as leading, trailing and
interior characters of --b; the non-whitespace lookalikes U+180E U+200B U+FEFF U+007F;
astral-plane and combining characters; strings of 1000+ leading '1's; bytes-repr quote
selection (values containing ' and/or "); every byte value 0x00-0xFF reachable in
decoded output; integers 0, 1, 57, 58, 3363, 2^64, 2^256, 10^60; integers written with
unicode digits from several scripts; and all argparse failure modes. Compare stdout
byte-for-byte plus exit code. Never use a negative --e/--f. Use a timeout per case.
Report each distinct mismatch with the exact reproducing argv.`,
  },
  {
    key: 'skeptic',
    prompt: `Read /workspace/dataset/test19.py and ALL of /output line by line as an adversarial
reviewer looking for behavioural divergence from the reference that random fuzzing would
MISS. Think about: integer overflow / precision (is BigInt used everywhere it must be?),
the exact SHA-256 implementation (test it against known vectors: empty string, 'abc', a
message longer than 55 bytes, longer than 64 bytes, longer than 119 bytes — padding and
multi-block handling), double-SHA256 checksum ordering, the leading-zero-byte handling in
both encode and decode, the b58decode_int accumulation for very long inputs, the argv
recovery fallback path (what happens when /proc is unreadable?), the int() parser's
underscore rules and unicode Nd tables, and whether any code path can throw a raw
JavaScript error (TypeError, RangeError, stack overflow from a spread/recursion on a long
array) where Python would succeed. For each suspicion, CONSTRUCT the input that would
expose it and actually run both binaries to confirm before reporting. Report only
divergences you reproduced.`,
  },
  {
    key: 'completeness',
    prompt: `You are the completeness critic for this port. Read ${SPEC}, /workspace/dataset/test19.py
and all of /output. Enumerate every behaviour in the spec and the Python source and check
each one is actually implemented and actually exercised: all four docstring sample cases
reproduce byte-for-byte; every vector in spec section 3; the exit-code-1 traceback
templates in section 7 (run each and diff the stderr, ignoring the PID); the argparse
messages in section 6; the int() acceptance/rejection table in section 5; the bytes-repr
rules in section 4; b58decode_check's checksum-mismatch path (exercise it by importing
the module directly from a scratch .mjs file in /tmp). Report anything unimplemented,
untested, or silently wrong. Verify claims by running commands, not by reading alone.`,
  },
]

const verdicts = await parallel(LENSES.map((l) => () =>
  agent(`${COMMON}\n\nThe finished port is in /output (built from ${finalBuild ? finalBuild.basedOn : 'a candidate'}).\n\nLENS: ${l.key}\n\n${l.prompt}\n\nSet pass=true only if you found no blocker and no major finding.`,
    { label: `verify:${l.key}`, phase: 'Verify', schema: VERIFY_SCHEMA })
))

const allFindings = verdicts.filter(Boolean).flatMap((v) => v.findings.map((f) => ({ ...f, lens: v.lens })))
const serious = allFindings.filter((f) => f.severity !== 'minor')
log(`Verification: ${allFindings.length} findings (${serious.length} blocker/major)`)

phase('Repair')
let repair = null
if (allFindings.length) {
  const list = allFindings.map((f, i) => `${i + 1}. [${f.severity}] (${f.lens}) ${f.file}: ${f.issue}
   evidence: ${f.evidence}
   proposed fix: ${f.fix}`).join('\n')
  repair = await agent(
    `${COMMON}

Four independent reviewers audited the finished port in /output and reported these
findings:

${list}

For EACH finding: first reproduce it yourself against ${EXE}. If it reproduces, fix it in
/output. If it does not reproduce, say so and change nothing. Do not regress anything
while fixing — after your edits re-run a differential check of at least 250 cases
(including all four docstring samples, every spec section-3 vector, and the exact
reproducing argv from each finding above) and confirm zero stdout/exit-code mismatches.
Also re-run the constraint greps (no require/module.exports/Buffer/Uint8Array/
TextEncoder/TextDecoder, all imports local and .mjs-suffixed).
Report per finding: fixed / not-reproducible / wont-fix-with-reason.`,
    { label: 'repair', phase: 'Repair', schema: {
      type: 'object',
      additionalProperties: false,
      required: ['outcomes', 'testTally', 'constraintGreps'],
      properties: {
        outcomes: { type: 'array', items: { type: 'string' } },
        testTally: { type: 'string' },
        constraintGreps: { type: 'string' },
      },
    } }
  )
}

phase('Final')
const gate = await agent(
  `${COMMON}

FINAL ACCEPTANCE GATE for /output. Trust nothing you have been told; verify everything
yourself from scratch.

1. List /output recursively and read every file.
2. Run the four sample cases from the docstring at the bottom of /workspace/dataset/test19.py
   through \`node /output/test19.mjs\` and diff against the expected output written in
   that docstring. All four must match byte-for-byte.
3. Run a fresh differential sweep of at least 300 varied cases against ${EXE}
   (no negative --e/--f; per-case timeout). Zero stdout or exit-code mismatches required.
4. Run the constraint greps and confirm each one is clean.
5. Confirm the module hierarchy is real: multiple library .mjs files under /output,
   each exporting a coherent slice of functionality, imported with explicit .mjs paths.

Return a truthful verdict. If anything fails, say exactly what, with the reproducing
command. Do not fix anything — just report.`,
  { label: 'acceptance-gate', phase: 'Final', schema: {
    type: 'object',
    additionalProperties: false,
    required: ['accepted', 'sampleCasesPass', 'sweepTally', 'constraintGreps', 'fileTree', 'problems'],
    properties: {
      accepted: { type: 'boolean' },
      sampleCasesPass: { type: 'string' },
      sweepTally: { type: 'string' },
      constraintGreps: { type: 'string' },
      fileTree: { type: 'array', items: { type: 'string' } },
      problems: { type: 'array', items: { type: 'string' } },
    },
  } }
)

return { finalBuild, verdicts, repair, gate }
