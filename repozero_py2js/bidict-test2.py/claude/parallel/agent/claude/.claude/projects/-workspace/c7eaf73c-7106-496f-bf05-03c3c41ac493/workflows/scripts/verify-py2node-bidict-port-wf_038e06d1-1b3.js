export const meta = {
  name: 'verify-py2node-bidict-port',
  description: 'Adversarially verify the Node port of test2.py matches the reference executable',
  phases: [
    { title: 'Fuzz' },
    { title: 'Audit' },
    { title: 'Verify' },
    { title: 'Synthesize' },
  ],
}

const CONTEXT = `
# Context
A Python program was ported to Node.js (ESM, zero dependencies).

- Python source (read-only reference):  /workspace/dataset/test2.py
- Reference executable (ground truth):  /workspace/dataset/test2_executable
    Run it directly, e.g.  /workspace/dataset/test2_executable --key a --val 83
    NEVER use the \`python\` command. Do not try to decompile or extract the binary's
    internals -- treat it strictly as a black box and probe it by running it.
- Node port under test:                 /output/test2.mjs   (libs under /output/lib/**)
- Differential tester:                  /workspace/verify/difftest.mjs
    \`cd <somedir> && node /workspace/verify/difftest.mjs\`            runs a built-in battery
    \`node /workspace/verify/difftest.mjs -- --key a --val 1\`         compares ONE argv, prints JSON
    It normalizes the nondeterministic \`[PYI-<pid>:ERROR]\` number before comparing;
    everything else (stdout, stderr, exit status) is compared byte-for-byte.

# Hard constraints the port must satisfy
1. ESM only: \`import\`/\`export\`. NO \`require()\`, NO \`module.exports\`.
2. All files use the \`.mjs\` suffix; all relative imports include the full \`.mjs\` suffix.
3. Zero external dependencies. Only node: builtins and local relative files may be imported.
4. The JS \`Map\` type is STRICTLY PROHIBITED anywhere in /output (the task forbids using
   any Map interface for the bidirectional key/value management). \`Set\` is also avoided.
   Report any occurrence.
5. No embedded/spawned Python.
6. Behavior must match the reference byte-for-byte on stdout, stderr and exit code.

# Known-and-intended design decisions (do NOT report these as bugs)
- \`prog\` defaults to the string 'test2_executable' because the reference build is a frozen
  binary and its own name appears in usage/error text AND in \`--help\` (which goes to stdout).
- The traceback hardcodes 'test2.py' / 'bidict/_base.py' frames because that is literally what
  the reference prints.
- The \`[PYI-<pid>:ERROR]\` line uses process.pid; the reference uses its own pid. Nondeterministic
  by nature, normalized by the differ.
`

const DIVERGENCE_SCHEMA = {
  type: 'object',
  properties: {
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          argv: { type: 'array', items: { type: 'string' }, description: 'exact argv that diverges' },
          env: { type: 'string', description: 'env vars needed, e.g. COLUMNS=40, or empty' },
          cwd: { type: 'string', description: 'cwd used, or empty for default' },
          referenceOutput: { type: 'string' },
          portOutput: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['argv', 'summary', 'referenceOutput', 'portOutput'],
      },
    },
    casesRun: { type: 'integer' },
    notes: { type: 'string' },
  },
  required: ['divergences', 'casesRun'],
}

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          category: { type: 'string' },
          summary: { type: 'string' },
          evidence: { type: 'string', description: 'concrete proof: command run + output, or exact quoted code' },
        },
        required: ['file', 'severity', 'summary', 'evidence'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true only if independently reproduced/confirmed' },
    reasoning: { type: 'string' },
    reproduction: { type: 'string', description: 'exact command + observed output, or why it failed to reproduce' },
  },
  required: ['real', 'reasoning'],
}

// ---------------------------------------------------------------- Phase 1: fuzz
const FUZZERS = [
  {
    key: 'argparse-misuse',
    prompt: `Fuzz the argparse surface. Generate and compare at least 250 DISTINCT argv vectors
covering: missing/duplicated required options, option abbreviations (--k, --ke, --va, --he),
\`=\` forms including empty and multi-\`=\` values, unknown options, bare \`-\` and \`--\`,
multiple \`--\`, interspersed positionals, tokens that look like negative numbers
(-1, -1.5, -0, -.5, -1e3, -1a), short-option-like tokens (-k, -kv, -h combined),
options given as values, and ordering permutations. Also try very long values and
values containing '=' or spaces.`,
  },
  {
    key: 'repr-unicode',
    prompt: `Fuzz the KeyError repr path. The missing key is printed with Python's repr().
Compare at least 250 DISTINCT --key values covering: quotes (single, double, both, nested),
backslashes, all C0 control characters, \\x7f, C1 range (\\x80-\\x9f), soft hyphen \\xad,
line/paragraph separators U+2028/U+2029, zero-width chars, combining marks, RTL marks,
non-ASCII printable (accented, CJK, Greek, Cyrillic), astral/emoji incl. ZWJ sequences and
flags, lone surrogates if you can pass them, NUL if passable, plus multi-char mixes of the
above. Use a script that builds argv programmatically so exotic bytes survive.
Also confirm the two keys that SUCCEED ('a','b') and that no other key does.`,
  },
  {
    key: 'width-help',
    prompt: `Fuzz the help/usage layout. Both --help (stdout) and every error path (stderr) embed a
width-sensitive usage block. Sweep COLUMNS over EVERY integer from 1 to 120 inclusive, plus
0, negative, huge (100000), non-numeric, whitespace-padded ('  40  '), empty string, and unset,
for each of these argv: ['--help'], [], ['--val','5'], ['--key','a'],
['--key','a','--val','1','extra'], ['--bogus']. Also try setting LINES with and without COLUMNS.
That is a lot of cases -- write a loop script, do not hand-enumerate.`,
  },
  {
    key: 'cwd-linecache',
    prompt: `Fuzz the traceback source-line lookup. The reference resolves the relative filename
'test2.py' against the CURRENT WORKING DIRECTORY when printing a traceback, so the source line
and caret row appear only when such a file exists there. Build many temp dirs under /tmp
containing different 'test2.py' files: absent; the real one (copy /workspace/dataset/test2.py);
fewer than 11 lines; exactly 11 lines; line 11 empty / whitespace-only / very long / shorter than
the caret span / indented by various amounts / containing tabs / containing non-ASCII and wide CJK
chars / containing a different subscript expression like 'x = foo[bar]' or 'y = a.b.c[d][e]' /
containing text that is not a subscript at all; also a DIRECTORY named test2.py, and an unreadable
file (chmod 000). For each, run the differ from that cwd with a missing key. Report any divergence.`,
  },
  {
    key: 'io-edge',
    prompt: `Fuzz process/IO level behavior. Compare: exit codes for every path; stdout vs stderr
routing (redirect them separately and diff each); behavior when stdout is closed
(\`>&-\`) or is a full/closed pipe (pipe into \`head -c 0\` or \`true\`); when stdin is closed;
under \`env -i\` (empty environment); with PYTHONIOENCODING / LC_ALL=C / LANG=C set;
with an absurdly long argv value (100KB); with argv containing NUL-adjacent bytes and
invalid UTF-8 byte sequences (use a script that spawns with raw Buffers if possible).
Also verify there is no extra trailing newline or missing newline anywhere, and that
stdout for the success cases is exactly "1\\n" or "2\\n".`,
  },
]

const fuzzResults = await pipeline(
  FUZZERS,
  (f) => agent(
    `${CONTEXT}

# Your job
${f.prompt}

Write throwaway scripts under /tmp (NEVER modify anything under /output or /workspace/dataset).
Use /workspace/verify/difftest.mjs, or spawn both binaries yourself if you need finer control
(e.g. raw bytes, closed fds). Report ONLY genuine divergences between the reference and the port,
each with the exact argv/env/cwd needed to reproduce and both outputs verbatim.
If you find none, return an empty divergences array and say how many cases you ran.`,
    { label: `fuzz:${f.key}`, phase: 'Fuzz', schema: DIVERGENCE_SCHEMA },
  ),
)

const allDivergences = fuzzResults
  .filter(Boolean)
  .flatMap((r, i) => (r.divergences || []).map((d) => ({ ...d, source: FUZZERS[i].key })))
const casesRun = fuzzResults.filter(Boolean).reduce((sum, r) => sum + (r.casesRun || 0), 0)
log(`Fuzzing done: ${casesRun} cases, ${allDivergences.length} candidate divergences`)

// --------------------------------------------------------------- Phase 2: audit
const AUDITS = [
  {
    key: 'constraints',
    prompt: `Audit compliance with the hard constraints. Grep every file under /output for:
\`require(\`, \`module.exports\`, \`new Map\`, \`Map(\`, bare \`Map\`, \`new Set\`, \`WeakMap\`,
\`WeakSet\`, non-relative imports, imports missing a .mjs suffix, any non-.mjs file,
any spawn/exec/child_process usage, any reference to python. Then actually verify the port
runs under a plain \`node --input-type=module\` style ESM load with no package.json present
(check whether /output/package.json exists and whether it is needed). Confirm every relative
import resolves to a file that exists.`,
  },
  {
    key: 'argparse-fidelity',
    prompt: `Audit /output/lib/argparse/*.mjs for fidelity to CPython argparse as observed from the
reference binary. Scrutinize: the option-tuple/abbreviation logic, the pattern-string
classification ('O'/'A'/'-'), nargs pattern construction, the required-vs-unrecognized error
ordering, \`_get_values\` type conversion, the help-column arithmetic, and the usage line-wrapping
(the 0.75 threshold branch and the getLines off-by-one seed). For each thing you doubt, PROVE it by
running the reference binary with a crafted input and comparing. Report only differences you
actually demonstrated.`,
  },
  {
    key: 'bidict-fidelity',
    prompt: `Audit /output/lib/bidict/*.mjs. The program only ever does \`b[args.key]\` on
bidict({'a': 1, 'b': 2}), but the library should be a faithful, self-consistent reimplementation.
Write a throwaway ESM test under /tmp that imports /output/lib/bidict/index.mjs and exercises:
forward and inverse lookup, inverse-of-inverse identity, mutation visibility through .inverse,
duplicate-value rejection (ValueDuplicationError) vs duplicate-key overwrite on construction and
on setItem, put/forceput/pop/delItem/clear, insertion order preservation after overwrite and after
delete, iteration, size, repr, and the Python-equality collisions (1 vs 1.0 vs true, '1' vs 1,
None/NONE). Look hard for logic errors in the OrderedStore vacancy handling and in the
write() duplication branches. Report real defects with a failing snippet.`,
  },
  {
    key: 'python-layer-fidelity',
    prompt: `Audit /output/lib/python/*.mjs (repr, unicode_props, textwrap, terminal, sys_io,
exceptions). Write throwaway tests under /tmp. For repr: confirm quote selection, escape set, and
the printable/non-printable boundary against the reference binary by feeding keys through
\`--key\` (the KeyError line shows repr output) -- this is the only ground truth available.
For textwrap: reason about whether the wrap() implementation matches CPython for the one string it
is used on ('show this help message and exit') at every width 1..60, and verify via the reference's
--help under COLUMNS. For terminal: check the COLUMNS/LINES precedence and fallback. For sys_io:
check the partial-write/EAGAIN/EPIPE handling is correct and that print() matches Python's print.
Report demonstrated defects only.`,
  },
  {
    key: 'robustness',
    prompt: `Adversarially hunt for crashes and latent bugs in the port that the reference does not
have. Look for: unhandled JS exceptions leaking a JS stack trace (which would never match Python),
infinite loops, \`Math.min(...[])\` producing Infinity, regex catastrophic backtracking,
reading process.argv incorrectly, off-by-one in slicing, undefined-vs-null confusion,
prototype pollution via Object.create(null) misuse, and any code path that could throw a
non-PyException and hit the \`throw error\` rethrow in test2.mjs. Try to construct inputs that
make the port print a JS stack trace or exit with a code the reference never produces.
Report each with the exact reproducing command.`,
  },
]

const auditResults = await pipeline(
  AUDITS,
  (a) => agent(
    `${CONTEXT}

# Your job
${a.prompt}

Do NOT modify anything under /output or /workspace/dataset -- you are auditing, not fixing.
Put any scratch files under /tmp. Every finding must carry concrete evidence (a command and its
output, or exact quoted code). Speculation without evidence must be omitted.`,
    { label: `audit:${a.key}`, phase: 'Audit', schema: AUDIT_SCHEMA },
  ),
)

const allFindings = auditResults.filter(Boolean).flatMap((r) => r.findings || [])
log(`Audits done: ${allFindings.length} candidate findings`)

// -------------------------------------------------------------- Phase 3: verify
// Divergences and findings both get independently re-checked by skeptics whose
// default is to refute. Two distinct lenses per item.
const claims = [
  ...allDivergences.map((d) => ({
    kind: 'divergence',
    label: (d.argv || []).join(' ').slice(0, 40) || '(empty argv)',
    text: `Claimed behavioral divergence.
argv: ${JSON.stringify(d.argv)}
env: ${d.env || '(none)'}
cwd: ${d.cwd || '(default)'}
summary: ${d.summary}
claimed reference output: ${d.referenceOutput}
claimed port output: ${d.portOutput}`,
  })),
  ...allFindings.map((f) => ({
    kind: 'finding',
    label: `${f.file}:${f.line || 0}`,
    text: `Claimed defect in the port.
file: ${f.file}${f.line ? `:${f.line}` : ''}
severity: ${f.severity}
summary: ${f.summary}
evidence offered: ${f.evidence}`,
  })),
]

let verified = []
if (claims.length > 0) {
  const LENSES = [
    'Reproduce it literally. Run the exact command against BOTH the reference binary and the port and diff the bytes yourself. If it does not reproduce, it is refuted.',
    'Question the premise. Is this actually a difference from the reference, or is it a difference from some idealized Python that the reference binary does not exhibit? Is it forbidden by a stated constraint? Is it in the known-and-intended list? If the reference does the same thing, it is refuted.',
  ]
  verified = await parallel(claims.map((claim) => () => parallel(
    LENSES.map((lens) => () => agent(
      `${CONTEXT}

# Claim to check
${claim.text}

# Your lens
${lens}

Default to real=false when uncertain or unable to reproduce. Do not modify /output.
Scratch files go in /tmp.`,
      { label: `verify:${claim.label}`, phase: 'Verify', schema: VERDICT_SCHEMA },
    )),
  ).then((votes) => {
    const good = votes.filter(Boolean)
    return {
      claim,
      confirmed: good.length > 0 && good.filter((v) => v.real).length >= Math.ceil(good.length / 2),
      votes: good,
    }
  })))
}

const confirmed = verified.filter(Boolean).filter((v) => v.confirmed)
log(`Verification done: ${confirmed.length} of ${claims.length} claims survived`)

// ----------------------------------------------------------- Phase 4: synthesize
phase('Synthesize')
const summary = await agent(
  `${CONTEXT}

# Inputs
Fuzzing ran ${casesRun} differential cases across 5 independent fuzzers.
${claims.length} candidate issues were raised; ${confirmed.length} survived adversarial verification.

Confirmed issues:
${confirmed.length === 0 ? '(none)' : JSON.stringify(confirmed.map((c) => ({ claim: c.claim.text, votes: c.votes })), null, 2)}

Refuted/unconfirmed issues (for context, do not action):
${JSON.stringify(verified.filter(Boolean).filter((v) => !v.confirmed).map((v) => v.claim.label), null, 2)}

# Your job
Independently sanity-check the CONFIRMED issues only (re-run each once against both binaries).
Then produce a final report:
- overall verdict: does the port match the reference?
- the confirmed issues, most severe first, each with file:line and a concrete recommended fix
- anything a completeness critic would say is still untested

Be concise and concrete. Do not modify /output.`,
  { label: 'synthesize', phase: 'Synthesize' },
)

return { casesRun, claimCount: claims.length, confirmedCount: confirmed.length, confirmed, summary }
