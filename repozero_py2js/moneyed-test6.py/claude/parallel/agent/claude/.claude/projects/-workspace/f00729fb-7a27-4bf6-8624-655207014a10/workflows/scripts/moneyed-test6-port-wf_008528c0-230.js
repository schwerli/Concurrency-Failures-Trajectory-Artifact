export const meta = {
  name: 'moneyed-test6-port',
  description: 'Port test6.py (py-moneyed) to zero-dependency Node ESM: 3 candidate impls, objective differential scoring, judge selection, adversarial verification, fix loop',
  phases: [
    { title: 'Implement', detail: '3 independent candidate implementations of the full library' },
    { title: 'Score', detail: 'objective differential-harness run per candidate' },
    { title: 'Select', detail: 'judge picks winner and installs it into /output' },
    { title: 'Verify', detail: 'adversarial skeptics: numerics, argparse, currency, compliance' },
    { title: 'Confirm', detail: 'independently refute each finding' },
    { title: 'Fix', detail: 'apply confirmed findings' },
    { title: 'Final', detail: 'full-corpus regression + compliance gate' },
  ],
}

const COMMON = `
Read the authoritative spec FIRST: /tmp/dt/SPEC.md  (it is long; read all of it).
The currency list is /tmp/dt/currencies.txt (308 codes, one per line).
The Python reference is the executable /workspace/dataset/test6_executable — probe it freely.
NEVER run \`python\`.

Absolute constraints (violating any of these invalidates the work):
- ESM only: \`import\`/\`export\`. No \`require()\`, no \`module.exports\`.
- Every file ends in \`.mjs\`; every relative import includes the \`.mjs\` suffix.
- Zero dependencies: no npm packages, and do not import ANY module that is not a local
  ./relative .mjs file (not even node: builtins — the program does not need them).
- \`BigInt\` and \`Intl.NumberFormat\` are FORBIDDEN, including in comments and identifiers.
  Implement big-integer arithmetic over decimal digit strings/arrays yourself.
- No embedded Python, no child processes in the shipped code.
`

const HARNESS = `
Differential harness (this is the objective measure):
  node /tmp/dt/diff.mjs <ENTRY> --stderr --conc 16                 # full: 11482 cases, ~3 min
  node /tmp/dt/diff.mjs <ENTRY> --stderr --conc 16 --limit 2500    # fast smoke
  node /tmp/dt/diff.mjs <ENTRY> --stderr --conc 16 --tag C         # single category
Tags: A:sample B:int/prec/known C:pow10/extreme D:special E:lit F:argparse G:valid/lower/mixed/invalid3 H:fuzz
Iterate with smoke + per-tag runs; do ONE full run at the end. Do not exceed --conc 16.
Target: fail=0 on the full run with --stderr.
`

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'entry', 'files', 'fullRunTotal', 'fullRunPass', 'fullRunFail', 'notes'],
  properties: {
    dir: { type: 'string' },
    entry: { type: 'string', description: 'absolute path to the entry .mjs' },
    files: { type: 'array', items: { type: 'string' } },
    fullRunTotal: { type: 'integer' },
    fullRunPass: { type: 'integer' },
    fullRunFail: { type: 'integer' },
    notes: { type: 'string', description: 'design decisions, anything still failing, and why' },
  },
}

const SCORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['entry', 'total', 'pass', 'fail', 'failuresByTag', 'exampleDiffs', 'compliance', 'complianceProblems'],
  properties: {
    entry: { type: 'string' },
    total: { type: 'integer' },
    pass: { type: 'integer' },
    fail: { type: 'integer' },
    failuresByTag: { type: 'string', description: 'raw JSON string the harness printed, or "{}"' },
    exampleDiffs: { type: 'array', items: { type: 'string' }, maxItems: 15 },
    compliance: { type: 'boolean', description: 'true iff no BigInt / no Intl.NumberFormat / no require / no non-local imports / all .mjs' },
    complianceProblems: { type: 'array', items: { type: 'string' } },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'detail', 'repro', 'severity'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          detail: { type: 'string' },
          repro: { type: 'string', description: 'exact argv that diverges, plus expected vs actual, or "static" for non-behavioral issues' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reason', 'evidence'],
  properties: {
    real: { type: 'boolean' },
    reason: { type: 'string' },
    evidence: { type: 'string', description: 'the command you ran and its actual output' },
  },
}

// ---------------------------------------------------------------- Implement
phase('Implement')
log('Spawning 3 independent candidate implementations')

const ANGLES = [
  {
    n: 1,
    angle: `Prioritise a literal, line-by-line transliteration of CPython's own algorithms:
_pydecimal.Decimal.__truediv__ / _fix / __str__, PyOS_double_to_string mode 0, and
argparse._parse_known_args. Write the big-integer layer as an explicit long-division /
long-multiplication over arrays of decimal digits. Keep each CPython routine in its own
clearly named function so the correspondence is auditable.`,
  },
  {
    n: 2,
    angle: `Prioritise defensive breadth: enumerate the input space first (write down the
equivalence classes for float parsing, for repr formatting, for the divide ideal-exponent
logic, and for argparse token classification), build a small table-driven test of your own
for each class against the executable BEFORE wiring it together, then implement. Treat the
fuzz and unicode-digit categories as first-class, not afterthoughts.`,
  },
  {
    n: 3,
    angle: `Prioritise a clean, minimal, strongly-factored design with exact behaviour: the
smallest set of well-named modules that fully covers the spec, no speculative generality,
every module independently importable and unit-testable. Exploit the fact that the divisor is
always 2 for a fast path, but keep the general spec-faithful divide as the primary code path
so the Decimal module is correct on its own terms.`,
  },
]

const impls = await pipeline(
  ANGLES,
  (a) => agent(
    `You are implementing a high-fidelity Python-to-Node.js port. Work ONLY inside /tmp/cand${a.n}
(create it). Entry point: /tmp/cand${a.n}/test6.mjs, library modules under /tmp/cand${a.n}/lib/.
${COMMON}
Your assigned emphasis:
${a.angle}
${HARNESS}
Use ENTRY=/tmp/cand${a.n}/test6.mjs.

Work until the full run reports fail=0, or until you have exhausted your ideas — then report
the honest numbers. Do NOT touch /output. Do NOT modify anything under /tmp/dt.
Report the absolute file list, the FULL-run total/pass/fail, and honest notes.`,
    { label: `impl:cand${a.n}`, phase: 'Implement', schema: IMPL_SCHEMA, effort: 'high' },
  ),
  (impl, a) => impl && agent(
    `Independently and skeptically score a candidate implementation. Do not trust its self-report.
Entry: /tmp/cand${a.n}/test6.mjs
${COMMON}
1. Run the FULL differential harness yourself and report the real numbers:
   node /tmp/dt/diff.mjs /tmp/cand${a.n}/test6.mjs --stderr --conc 16
2. Independently audit compliance by grepping the candidate's files for: BigInt, Intl,
   require(, module.exports, and any \`from '\`/\`from "\` import target that is not a local
   ./ or ../ path ending in .mjs. Also confirm every file ends in .mjs and that
   /tmp/cand${a.n}/test6.mjs exists.
Report exact numbers and up to 15 concrete example diffs verbatim. Do not fix anything.`,
    { label: `score:cand${a.n}`, phase: 'Score', schema: SCORE_SCHEMA, effort: 'low' },
  ),
)

const scores = impls.filter(Boolean)
log(`Scored ${scores.length} candidates: ` + scores.map((s) => `${s.entry} fail=${s.fail} compliant=${s.compliance}`).join(' | '))

if (!scores.length) {
  return { error: 'all candidates failed to produce a scoreable implementation' }
}

// ---------------------------------------------------------------- Select
phase('Select')
const summary = scores.map((s, i) => `Candidate ${i + 1}: entry=${s.entry}
  total=${s.total} pass=${s.pass} fail=${s.fail}
  failuresByTag=${s.failuresByTag}
  compliant=${s.compliance} problems=${JSON.stringify(s.complianceProblems)}
  exampleDiffs=${JSON.stringify(s.exampleDiffs)}`).join('\n\n')

const selected = await agent(
  `Three independent candidate ports were built and objectively scored against the Python
executable. Pick the best base and install the FINAL deliverable into /output.
${COMMON}
Objective scores:
${summary}

Your job:
1. Read all surviving candidates' source (they are in /tmp/cand1, /tmp/cand2, /tmp/cand3 —
   some may not exist). Choose the one with the lowest 'fail' that is compliant; break ties by
   code clarity and module factoring. If one candidate solved a specific category the winner
   got wrong, GRAFT that fix in rather than starting over.
2. Install into /output: entry /output/test6.mjs plus hierarchical modules under /output/lib/.
   Rewrite imports so they resolve correctly from /output. Every file .mjs, every relative
   import carries the .mjs suffix. Delete nothing outside /output; /output starts empty apart
   from anything you put there.
3. Make sure /output/lib contains genuinely separated concerns (bignum, decimal, pyfloat,
   argparse, currencies, money, and error/traceback handling) and that each module exports a
   clean interface. The entry file must be thin: parse args, build Money, divide, print.
4. Add a short header comment to each module saying what Python behaviour it reproduces.
5. Drive the residual failures to zero:
   ${HARNESS.trim()}
   Use ENTRY=/output/test6.mjs. Iterate until the FULL run with --stderr reports fail=0.
Report the winner you chose, what you grafted, the final full-run numbers, and honest notes.`,
  { label: 'select+install', phase: 'Select', schema: IMPL_SCHEMA, effort: 'high' },
)

log(`Installed to /output — full run fail=${selected ? selected.fullRunFail : 'n/a'}`)

// ---------------------------------------------------------------- Verify
phase('Verify')
const LENSES = [
  {
    key: 'numerics',
    prompt: `Adversarially attack the NUMERIC pipeline of /output/test6.mjs: Python float()
parsing, str(float) shortest-repr formatting, Decimal parsing, the divide ideal-exponent /
trailing-zero-stripping logic, _fix rounding, and to-scientific-string. Read the code, then
CONSTRUCT NEW adversarial inputs that are NOT in /tmp/dt/corpus.jsonl and run both
/workspace/dataset/test6_executable and \`node /output/test6.mjs\` on each, comparing stdout and
exit code byte-for-byte. Hunt specifically around: the decpt in (-4, 16] fixed/exponential
boundary; values whose shortest repr has exactly 17 digits; coefficients ending in 5 or 0;
subnormals and the 5e-324 / 1e-323 region; 1e308-1e309 overflow edge; exact powers of ten in
both directions; negative zero; the leftdigits > -6 boundary in __str__ (find inputs whose
result has leftdigits exactly -6 and -5); values needing zero-padded 2-digit exponents; and
unicode-digit / underscore / whitespace float literals. Report ONLY divergences you actually
observed, each with the exact argv and both outputs.`,
  },
  {
    key: 'argparse',
    prompt: `Adversarially attack the ARGPARSE clone in /output. Read the code, then construct
NEW argv vectors not in /tmp/dt/corpus.jsonl and diff \`node /output/test6.mjs ...\` against
/workspace/dataset/test6_executable on stdout, exit code, and stderr (ignore differences that
are only the program name or the [PYI-...] pid line). Hunt: prefix-abbreviation edges and any
ambiguous-option message; '=' forms including empty and repeated '='; the negative-number
matcher boundary (-5, -5.5, -.5, -5., -inf, -1e4, --5, -0); lone '-' and multiple '--';
interspersed unknown options and values; ordering/precedence between 'expected one argument',
'invalid float value', 'the following arguments are required', 'unrecognized arguments', and
the help action; repeated options; the exact byte content of --help and of the usage line;
tokens containing spaces; empty-string tokens. Report ONLY observed divergences with exact argv
and both outputs.`,
  },
  {
    key: 'currency',
    prompt: `Verify the CURRENCY layer of /output exhaustively and mechanically. (1) Confirm
/output/lib (whatever the currency module is called) contains exactly the 308 codes in
/tmp/dt/currencies.txt — write a throwaway script under /tmp to diff the two sets and report
any extra/missing code. (2) Confirm case-insensitive lookup works for all 308 codes in
lower/UPPER/Mixed form by diffing node against the executable. (3) Confirm invalid codes
produce exit 1, EMPTY stdout, and the CurrencyDoesNotExist traceback with the UPPERCASED code
in both the KeyError line and the final message; check the empty string, padded strings,
numeric codes, 2/4-letter codes, non-ASCII codes, and codes whose toUpperCase() differs from
Python's str.upper() (e.g. 'ﬁx', dotless i 'ı', German 'ß', Turkish 'i'). Report ONLY observed
divergences.`,
  },
  {
    key: 'compliance',
    prompt: `Audit /output against the task's hard requirements. Do NOT run the differential
harness. Check and report every violation you find:
 (a) any use of BigInt or Intl (including Intl.NumberFormat) anywhere, including comments,
     strings and identifiers — grep case-sensitively and case-insensitively;
 (b) any require( or module.exports or __dirname/__filename;
 (c) any import whose target is not a local relative path ending in .mjs (npm packages AND
     node: builtins are both disallowed here);
 (d) any file not ending in .mjs; any file outside /output;
 (e) /output/test6.mjs exists and is the entry point; library code is split into multiple
     modules under a subdirectory, each with real \`export\`s, and the entry imports them;
 (f) any embedded Python or child-process/exec usage;
 (g) dead code, unused exports, stubbed/TODO paths, or modules that are imported but never
     used; anything that would look like a stub rather than a real implementation;
 (h) that \`node /output/test6.mjs --amount 133.13 --currency GBP\` prints exactly "66.565".
Report each violation as a finding with the file and the offending line.`,
  },
  {
    key: 'quality',
    prompt: `Review /output as a senior reviewer for CORRECTNESS RISK, not style. Read every
module fully. Look for: off-by-one in digit/exponent arithmetic; string-index arithmetic that
breaks on empty or single-digit coefficients; loops that can run away on pathological input;
places where a JS Number is used where arbitrary precision is required (silent precision loss);
places where -0 vs 0 is conflated; NaN/Infinity paths that fall through to the finite code;
regexes that are subtly wrong (unanchored, greedy, missing unicode flag); and any spot where the
code diverges from the algorithms stated in /tmp/dt/SPEC.md. For each suspected defect, try to
build a concrete input that triggers it and check it against
/workspace/dataset/test6_executable. Report findings with repro where you found one, and mark
severity 'minor' with repro "static" where you could not trigger it but the code is still wrong.`,
  },
]

const verified = await pipeline(
  LENSES,
  (l) => agent(
    `${l.prompt}\n${COMMON}\nThe spec is /tmp/dt/SPEC.md. You may read and run anything, but do NOT
modify /output or /tmp/dt. Report an empty findings list if you genuinely found nothing.`,
    { label: `hunt:${l.key}`, phase: 'Verify', schema: FINDINGS_SCHEMA, effort: 'high' },
  ),
  (res, l) => res && res.findings.length
    ? parallel(res.findings.map((f) => () =>
        agent(
          `Independently REFUTE this claimed defect in the Node port at /output. Default to
refuted=true unless you can reproduce it yourself.
Claim: ${f.title}
File: ${f.file}
Detail: ${f.detail}
Claimed repro: ${f.repro}
${COMMON}
If the repro is concrete argv, run BOTH /workspace/dataset/test6_executable and
\`node /output/test6.mjs\` with exactly those arguments and compare stdout + exit code (and
stderr, ignoring program name and the [PYI-...] pid line). If the repro is "static", read the
code and decide whether the described defect is genuinely present and reachable; a defect that
cannot change observable behaviour for ANY input is refuted.
Set real=true ONLY if you personally observed the divergence or proved the defect reachable.
Put the literal command and its output in evidence. Do not modify anything.`,
          { label: `refute:${l.key}`, phase: 'Confirm', schema: VERDICT_SCHEMA, effort: 'high' },
        ).then((v) => (v ? { ...f, lens: l.key, verdict: v } : null))
      ))
    : [],
)

const confirmed = verified.flat().filter(Boolean).filter((f) => f.verdict.real)
log(`${verified.flat().filter(Boolean).length} findings raised, ${confirmed.length} survived refutation`)

// ---------------------------------------------------------------- Fix
let fixReport = 'no confirmed findings — nothing to fix'
if (confirmed.length) {
  phase('Fix')
  const list = confirmed.map((f, i) => `${i + 1}. [${f.severity}] (${f.lens}) ${f.title}
   file: ${f.file}
   detail: ${f.detail}
   repro: ${f.repro}
   confirmed by: ${f.verdict.reason}
   evidence: ${f.verdict.evidence}`).join('\n\n')
  fixReport = await agent(
    `Fix these CONFIRMED defects in the Node port at /output. Each was independently reproduced.
${COMMON}
${list}

Fix every one at the root cause — do not special-case the repro inputs. Preserve the modular
structure and the hard constraints. After fixing, re-run the affected categories, then the FULL
harness:
${HARNESS.trim()}
Use ENTRY=/output/test6.mjs. Report what you changed per finding and the final full-run numbers.
If a fix is impossible without violating a constraint, say so explicitly instead of hacking.`,
    { label: 'apply-fixes', phase: 'Fix', effort: 'high' },
  )
}

// ---------------------------------------------------------------- Final
phase('Final')
const final = await agent(
  `Final gate on the delivered Node port in /output.
${COMMON}
1. Run the FULL differential harness and report the exact numbers:
   node /tmp/dt/diff.mjs /output/test6.mjs --stderr --conc 24
2. Re-run the four documented sample cases and confirm byte-exact stdout:
   --amount 133.13 --currency GBP -> 66.565
   --amount 918.14 --currency USD -> 459.07
   --amount 807.86 --currency JPY -> 403.93
   --amount 624.02 --currency CAD -> 312.01
3. Re-audit compliance: no BigInt, no Intl, no require/module.exports, no non-local imports,
   all files .mjs, entry is /output/test6.mjs, library split across multiple modules in a
   subdirectory, all imports carry .mjs suffixes.
4. List every file under /output with its line count.
Report honestly. If fail>0, list the remaining diffs verbatim — do not paper over them.`,
  { label: 'final-gate', phase: 'Final', schema: SCORE_SCHEMA, effort: 'medium' },
)

return {
  candidateScores: scores.map((s) => ({ entry: s.entry, fail: s.fail, compliant: s.compliance })),
  selected: selected && { notes: selected.notes, fail: selected.fullRunFail, files: selected.files },
  findingsRaised: verified.flat().filter(Boolean).length,
  findingsConfirmed: confirmed.map((f) => ({ lens: f.lens, severity: f.severity, title: f.title })),
  fixReport,
  final,
}
