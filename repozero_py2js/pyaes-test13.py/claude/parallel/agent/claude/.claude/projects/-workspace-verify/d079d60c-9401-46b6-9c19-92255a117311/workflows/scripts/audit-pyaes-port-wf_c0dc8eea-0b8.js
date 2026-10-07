export const meta = {
  name: 'audit-pyaes-port',
  description: 'Adversarially audit the Python-to-Node port of test13.py against the reference executable',
  phases: [
    { title: 'Audit', detail: 'independent reviewers probe one dimension each against the reference binary' },
    { title: 'Verify', detail: 'each reported finding is re-tested by a skeptic who tries to refute it' },
    { title: 'Synthesize', detail: 'dedupe, rank, and list confirmed defects' },
  ],
}

const CONTEXT = `
# Task context

A Python program was ported to Node.js. You are auditing the port.

- Original Python source: /workspace/dataset/test13.py (read it).
- Reference behaviour: the frozen executable /workspace/dataset/test13_executable
  (run it directly; NEVER use \`python\`). It is the ground truth for observable
  behaviour: stdout, stderr, and exit status.
- The port: /output/test13.mjs plus modules under /output/lib/ (ESM, .mjs).
- A differential harness exists:
    node /workspace/verify/diff.mjs <cases.jsonl> [--cwd DIR] [--jobs N]
  where each line of cases.jsonl is {"name":"...","args":[...],"env":{...}} and an
  arg may be {"raw":"<bash $'...' escape body>"} to inject raw bytes.
  Case generators: node /workspace/verify/gen.mjs <suite> [count] [seed]
  (suites: ascii reprSweep controlBytes keySizes lengths unicode rawBytes argparse widths).
  You may write your OWN case files to /tmp and run the harness on them.

# Hard constraints the port must satisfy

1. ESM only: \`import\`/\`export\`. No \`require()\`, no \`module.exports\`. All generated
   files must end in .mjs and all relative imports must include the .mjs suffix.
2. Zero external dependencies. Only node: builtin modules may be imported, and only
   local relative files otherwise. No npm packages.
3. node:crypto's Cipher/Decipher/createCipheriv must NOT be used or mentioned anywhere.
4. No embedded Python; no shelling out to python.
5. All generated code lives in /output. Libraries split into multiple modules by
   functionality, exposing interfaces via \`export\`.
6. CLI arguments must behave identically to the reference: same names (--key, --data),
   both required, string type.
7. stdout must match the reference character-for-character; exit status must match.

# Known, accepted divergences (do NOT report these)

- The argparse program name differs (\`test13.mjs\` vs \`test13_executable\`) because it
  derives from argv[0]; this is inherent and appears only in usage/error text on stderr.
- The \`[PYI-<pid>:ERROR]\` line carries a live pid, so its number cannot match.
- Terminal-width-dependent output uses \$COLUMNS, else the tty, else 80 columns.

# Rules of engagement

- DO NOT edit any file under /output. Report problems instead; someone else fixes them.
- Every finding MUST come with an exact reproduction: the command line for the reference
  and for the port, plus the differing output. Verify the repro yourself before reporting.
- A finding is only real if the reference and the port actually differ in stdout, exit
  status, or stderr (modulo the accepted divergences above), or if a hard constraint is
  violated. Style opinions are not findings.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'coverage'],
  properties: {
    coverage: { type: 'string', description: 'what you actually exercised, and what you could not' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'severity', 'repro', 'expected', 'actual'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string', description: 'path of the offending file, with line if known' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          repro: { type: 'string', description: 'exact shell commands that show the difference' },
          expected: { type: 'string', description: 'reference output' },
          actual: { type: 'string', description: 'port output' },
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
    real: { type: 'boolean', description: 'true only if you reproduced the divergence yourself' },
    reasoning: { type: 'string' },
    correctedRepro: { type: 'string', description: 'the repro as you actually ran it, if different' },
  },
}

const DIMENSIONS = [
  {
    key: 'aes-core',
    prompt: `Audit the AES implementation in /output/lib/aes/ for cryptographic correctness.
Independently verify it against the FIPS-197 published test vectors for AES-128, AES-192 and
AES-256 (single block encrypt AND decrypt) — write your own small .mjs script in /tmp that
imports /output/lib/aes/index.mjs and checks the known-answer vectors; do not trust the port's
own claims. Then fuzz round-trips against the reference binary: random 16/24/32-byte keys, keys
and data made of bytes that stress the S-box (all-zero-ish, all-0xff-ish, single-bit patterns),
and confirm ciphertext matches the reference exactly. Also check the derived tables (S-box,
inverse S-box, RCON, GF multiplication tables) against their published values, and check the
key schedule for AES-192/256 (the nk>6 SubWord branch is a classic bug site).`,
  },
  {
    key: 'bytes-repr',
    prompt: `Audit /output/lib/python/reprBytes.mjs against CPython's repr() of a bytes object,
which produces the port's entire stdout. Exhaustively drive every byte value 0x00..0xff through
the reference binary and the port in every interesting position (leading, trailing, middle),
and check the quote-selection rule (single vs double quotes when the payload contains ' and/or "),
backslash escaping, the \\t \\n \\r special cases, and \\xNN hex casing/padding. Note that a NUL
byte cannot be passed through execve, so cover 0x00 by calling reprBytes directly from a /tmp
script and comparing with what CPython would print — and note that ciphertext frequently contains
0x00, so run enough random cases through the reference to hit it in stdout.`,
  },
  {
    key: 'argparse',
    prompt: `Audit /output/lib/python/argparse.mjs and argparseFormatter.mjs against CPython 3.12
argparse as embodied by the reference binary. Be adversarial and exhaustive: prefix abbreviations
(unique, ambiguous, exact), --opt=value including empty values, the -- terminator in every
position, values that begin with '-' (including negative numbers, floats, values containing
spaces, a lone '-'), unknown options with and without attached values, repeated options,
interleavings, -h/--help in every position and combined forms like -hx/-hh/--help=x/--=x/---key,
single-dash long forms, the ordering of the 'required' error versus the 'unrecognized arguments'
error, exit statuses (0/1/2), and which stream each message goes to. Also verify the usage and
help LAYOUT across terminal widths by setting COLUMNS (try every width from 10 to 100), since
wrapping arithmetic is easy to get subtly wrong. Ignore the program-name divergence itself, but
DO check that everything else on those lines matches.`,
  },
  {
    key: 'codecs',
    prompt: `Audit /output/lib/python/codecs.mjs and /output/lib/python/argv.mjs. The reference
decodes argv with UTF-8 + surrogateescape and then re-encodes with strict UTF-8, so malformed
argv bytes produce a UnicodeEncodeError whose message embeds a code-point index and a run length.
Attack this: pass raw byte sequences via bash $'...' escapes — lone continuation bytes, truncated
sequences, overlong encodings, encoded surrogates (ED A0 80), 5-byte sequences, bytes above
U+10FFFF (F5..FF), invalid bytes adjacent versus separated (the message switches between the
singular 'character' and plural 'characters in position S-E' forms), invalid bytes in the key
versus the data, and lengths chosen so a lossy fallback decode would land on exactly 16 bytes
(which would wrongly succeed). Also verify genuine multi-byte UTF-8 input whose encoded length
is exactly 16 bytes works, and that a real U+FFFD in the input is handled as data, not as an
error. Check that the /proc/self/cmdline recovery works and that its fallback path is sound.`,
  },
  {
    key: 'traceback',
    prompt: `Audit /output/lib/python/traceback.mjs and linecache.mjs. The reference prints source
lines and caret rows in a traceback only when it can read a file named test13.py relative to the
CURRENT WORKING DIRECTORY and decode it as UTF-8. Verify the port reproduces this in every mode:
(a) cwd contains the real test13.py, (b) cwd contains no test13.py, (c) cwd contains a test13.py
that is too short to have the referenced lines, (d) a test13.py whose relevant lines are blank,
shorter than the recorded column offset, differently indented (tabs, deeper indent), have trailing
whitespace, or contain multi-byte UTF-8 before the failing expression, (e) a test13.py containing
bytes that are not valid UTF-8. Compare the reference and the port byte-for-byte (ignore only the
[PYI-<pid>:ERROR] number). Do this for all three error paths: invalid key size, wrong plaintext
block size, and UnicodeEncodeError. Create the doctored files in temporary directories and use
the harness's --cwd flag or run both binaries yourself with a changed cwd.`,
  },
  {
    key: 'constraints',
    prompt: `Audit the port against the hard constraints, mechanically. Enumerate every file under
/output (there must be no stray files, no package.json requirement, no .js files that should be
.mjs). Grep for: require(, module.exports, exports., import statements naming anything that is not
a relative ./ or ../ path ending in .mjs or a node: builtin, any mention of crypto (especially
createCipheriv/Cipher/Decipher), any spawn/exec/child_process usage, any python invocation. Verify
every relative import resolves to a real file including its .mjs suffix (actually run node with
--input-type=module to import each module, or import them all from a /tmp script). Confirm the
library is genuinely split into multiple modules by functionality with named exports, that
/output/test13.mjs is the entry point, and that nothing under /output writes to disk at runtime.
Also confirm the port runs correctly when invoked from an unrelated cwd and via an absolute path,
and that it does not depend on files outside /output (other than the optional test13.py that
linecache may read).`,
  },
  {
    key: 'bug-hunt',
    prompt: `Read every file under /output line by line and hunt for latent defects a differential
test might miss: uninitialised or shadowed variables, off-by-one errors, wrong operator precedence,
integer overflow in 32-bit word arithmetic (>>> vs >>), Uint8Array vs Array confusion, aliasing
bugs where a buffer is mutated in place while still needed, unreachable branches, functions that
return undefined on a path, incorrect JSDoc that contradicts the code, and any place where a
plausible input would throw a raw JavaScript TypeError instead of the emulated Python error.
For each suspicion, construct an input that would trigger it and try it against both binaries.
Pay attention to: the block cipher's state slicing, the key schedule loop bounds, the argparse
consumeOptional loop (which mutates its loop variables), the help-formatter arithmetic when
COLUMNS is tiny, and the frames array being shared/mutated across throws.`,
  },
  {
    key: 'stress',
    prompt: `Run a high-volume randomized differential campaign. Write your own generator to /tmp
producing several thousand cases mixing: random 16-byte data over the full printable ASCII range,
random 16/24/32-byte keys, random multi-byte UTF-8 strings whose encoded length is exactly 16
bytes and also off-by-one from 16, random raw byte sequences, random argparse token soups (options
in random order, random abbreviations, random junk tokens, random --/=/dash-prefixed values), and
random COLUMNS values. Run them through /workspace/verify/diff.mjs with a high --jobs value in
both cwd modes (/workspace/dataset which has test13.py, and /tmp which does not). Report the total
number of cases executed and every distinct divergence class you found. Aim for at least 3000
cases total; keep going until you have run at least that many and found no new divergence class.`,
  },
]

phase('Audit')

const reviewed = await pipeline(
  DIMENSIONS,
  (dimension) =>
    agent(`${CONTEXT}\n\n# Your dimension: ${dimension.key}\n\n${dimension.prompt}`, {
      label: `audit:${dimension.key}`,
      phase: 'Audit',
      schema: FINDINGS_SCHEMA,
    }),
  (result, dimension) => {
    if (!result) return []
    log(`${dimension.key}: ${result.findings.length} candidate finding(s)`)
    return parallel(
      result.findings.map((finding) => () =>
        agent(
          `${CONTEXT}\n\n# Your job: refute a reported finding\n\n` +
            `Another auditor claims the port diverges from the reference:\n\n` +
            `Title: ${finding.title}\nFile: ${finding.file}\nSeverity: ${finding.severity}\n` +
            `Repro:\n${finding.repro}\n\nThey expected:\n${finding.expected}\n\nThey observed:\n${finding.actual}\n\n` +
            `Run the repro YOURSELF against both the reference binary and the port. Try hard to refute ` +
            `the claim: check whether the divergence is actually one of the accepted divergences, whether ` +
            `the repro was malformed (shell quoting, wrong cwd, a NUL byte that execve cannot pass), and ` +
            `whether the two commands were really given identical argv. Set real=true ONLY if you ` +
            `personally reproduced a genuine divergence or constraint violation. Default to real=false ` +
            `when uncertain.`,
          { label: `verify:${dimension.key}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((verdict) => ({ dimension: dimension.key, finding, verdict })),
      ),
    )
  },
)

const all = reviewed.flat().filter(Boolean)
const confirmed = all.filter((entry) => entry.verdict?.real === true)
const refuted = all.filter((entry) => entry.verdict?.real !== true)

log(`${confirmed.length} confirmed, ${refuted.length} refuted, of ${all.length} candidates`)

phase('Synthesize')

const summary = await agent(
  `${CONTEXT}\n\n# Your job: synthesise the audit\n\n` +
    `Confirmed findings (each was independently reproduced by a skeptic):\n` +
    JSON.stringify(confirmed.map((e) => ({ dimension: e.dimension, ...e.finding, why: e.verdict.reasoning })), null, 2) +
    `\n\nRefuted candidates (for context; do not resurrect unless the refutation is clearly wrong):\n` +
    JSON.stringify(refuted.map((e) => ({ dimension: e.dimension, title: e.finding.title, why: e.verdict?.reasoning })), null, 2) +
    `\n\nProduce a prioritised, deduplicated defect list for the engineer who will fix them. For each: ` +
    `the file and line, what is wrong, the exact repro, and the minimal fix. Order by severity. ` +
    `If a confirmed finding is actually a duplicate of another, merge them. Be concise and concrete. ` +
    `If there are no real defects, say so plainly and list what was verified.`,
  { label: 'synthesise', phase: 'Synthesize' },
)

return { confirmedCount: confirmed.length, refutedCount: refuted.length, summary }
