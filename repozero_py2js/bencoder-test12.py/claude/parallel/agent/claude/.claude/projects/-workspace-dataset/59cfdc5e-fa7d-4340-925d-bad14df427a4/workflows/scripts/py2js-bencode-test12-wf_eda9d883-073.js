export const meta = {
  name: 'py2js-bencode-test12',
  description: 'Port /workspace/dataset/test12.py to ESM Node .mjs in /output, then adversarially differential-test it against the reference executable',
  phases: [
    { title: 'Spec', detail: 'nail down int()/repr/argparse/bencode semantics by probing the executable' },
    { title: 'Build', detail: 'write the hierarchical .mjs library + entry file into /output' },
    { title: 'Differential', detail: 'fuzz node vs executable across independent lenses' },
    { title: 'Repair', detail: 'fix every confirmed mismatch, re-verify' },
    { title: 'Audit', detail: 'requirement-compliance + completeness critics' },
  ],
}

const COMMON = `
CONTEXT
=======
We are porting /workspace/dataset/test12.py (Python, uses the \`bencoder\` package) to Node.js ESM.
Read /workspace/dataset/test12.py and /workspace/SPEC.md first — SPEC.md is a verified black-box
behavioral spec already derived from the reference binary.

The reference implementation is the precompiled executable:
    /workspace/dataset/test12_executable --a VAL --b VAL --c INT
Run it freely to observe behavior. NEVER run \`python\` — it is not available/allowed.

HARD REQUIREMENTS on the generated code (violating any of these invalidates the work):
 1. Pure JavaScript, Node.js runtime, ES Modules only. \`import\` / \`export\` only.
    \`require()\` and \`module.exports\` are STRICTLY PROHIBITED.
 2. Every generated file uses the .mjs suffix, and every relative import includes the
    full ".mjs" extension.
 3. Zero external dependencies. No npm packages. Only local relative imports are allowed
    (node: builtins are permitted but are not actually needed here).
 4. No embedding/【calling】Python.
 5. All generated code lives in /output.
 6. Libraries must be SPLIT INTO MULTIPLE MODULES by functionality, each exposing its
    interface via \`export\`. The entry file must be /output/test12.mjs.
 7. BLACK BOX + BANNED APIS: the bencode logic must be hand-written. The identifiers
    \`Uint8Array\` and \`ArrayBuffer\` (and any of their interfaces/methods) MUST NOT appear
    anywhere in the generated code — not in code, not in comments, not in strings.
    Do not use Buffer either (it is a typed-array subclass). Represent byte strings as
    plain JS strings whose char codes are all 0..255 ("latin-1 byte string"), and do all
    byte work with String/charCodeAt/fromCharCode.
 8. Arbitrary-precision integers are required (Python ints are unbounded) -> use BigInt.
`;

const ARCH = `
TARGET FILE LAYOUT in /output (hierarchical, split by functionality):
  /output/lib/bytes.mjs        - latin-1 "byte string" helpers + Python str.encode('ascii')
                                 emulation (raising a UnicodeEncodeError-shaped error carrying
                                 the offending code point and its position/range).
  /output/lib/pyrepr.mjs       - Python repr() emulation: bytes repr (quote selection + escapes),
                                 int repr, list repr, dict repr.
  /output/lib/bencode.mjs      - hand-written bencode encode + decode over the byte-string
                                 representation, with sorted dict keys.
  /output/lib/argparse.mjs     - minimal faithful argparse clone: option table, --opt VAL and
                                 --opt=VAL, prefix abbreviation, required-args check ordering,
                                 unrecognized-args check, usage/help text, exit codes.
  /output/lib/pyint.mjs        - Python int(str) semantics (unicode whitespace strip, sign,
                                 underscores, unicode Nd digits, BigInt result).
  /output/lib/errors.mjs       - error types + the PyInstaller-style traceback renderer.
  /output/test12.mjs           - entry point mirroring test12.py line for line.
(You may adjust/extend this layout if a cleaner split exists, but keep it multi-module.)
`;

phase('Spec')

const SPEC_LENSES = [
  {
    key: 'pyint',
    prompt: `Determine the EXACT accept/reject behavior of Python's \`int(s)\` as exposed through
\`--c\` of the reference executable. Probe at least 40 distinct inputs covering: empty, whitespace
forms (space, tab, newline, form feed, vertical tab, non-breaking space U+00A0, U+2007, U+3000,
U+200B), signs (+, -, --, +-, sign with space), underscores (1_000, _1, 1_, 1__0, -1_2), leading
zeros, huge values (60+ digits, both signs), unicode decimal digits from several scripts
(Arabic-Indic ١٢٣, Extended Arabic-Indic ۹, fullwidth １２３, Devanagari १२३, mathematical bold 𝟏𝟐,
Bengali, Thai), non-Nd digit-like chars (superscript ², roman numeral Ⅻ, circled ①, fraction ½),
mixed-script digits, and hex/float/exponent forms (0x10, 1.5, 1e3, inf, nan).
Use printf/$'...' in bash to emit exact bytes. Report a precise, implementable ruleset plus the
exact error message text for rejects. Also state clearly whether MIXED scripts are allowed and
whether the value is arbitrary precision.`,
  },
  {
    key: 'repr',
    prompt: `Determine the EXACT Python \`repr()\` rendering used on lines 1-4 of the program output.
Focus on bytes repr: quote selection (when is b"..." used vs b'...'), which characters are escaped
and how (\\\\, \\t, \\n, \\r, \\', \\xNN casing), and which byte values print literally. Probe every
byte value 0x00-0x7f that can survive .encode('ascii'): drive them in via --a using bash
$'\\xNN' / printf. NOTE 0x00 cannot be passed through argv, say so. Also determine the exact
spacing/punctuation of the decoded structure on line 2: list of dicts, "{k: v}" separators,
", " between items, how ints render, and the key ORDER inside each dict.
Report a complete escape table and quote-selection rule.`,
  },
  {
    key: 'argparse',
    prompt: `Determine the EXACT CLI behavior: usage string, help output (byte-exact, note the
two-space indents and column alignment), which stream each goes to (stdout vs stderr), exit codes,
and the PRECEDENCE ORDER between: -h/--help, invalid int value, expected-one-argument, missing
required arguments, and unrecognized arguments. Probe combinations that pit two error conditions
against each other (e.g. missing --a AND an unrecognized flag; invalid --c AND missing --b;
-h with an invalid --c; -h after unrecognized junk). Also probe: '--' separator, prefix
abbreviations (--h, --a is exact), '--a=' with empty value, '--a=--b', repeated options,
interspersed positionals, and values beginning with '-' (both '-foo' and '-5' and '-5x').
Verify with 2>/dev/null and 1>/dev/null which stream carries what.
Report an implementable decision procedure with exact message strings.`,
  },
  {
    key: 'bencode',
    prompt: `Determine the EXACT bencode wire format the \`bencoder\` package produces for this
program, and the decode round-trip. Confirm: byte-string form <len>:<bytes>, int form i<n>e,
list l..e, dict d..e; the key SORT ORDER inside dicts (probe by choosing --a/--b values that would
reorder if sorting were by something other than raw byte order — note the dict keys here are fixed
as b'first', b'second', b'number', so instead reason from the observed output and confirm
'number' < 'second' bytewise). Confirm how negative ints, zero, -0, and very large ints encode.
Confirm the length prefix counts BYTES. Since --a/--b are ascii-encoded, bytes==chars, but state
the rule. Also determine what decode() returns (types + ordering) as evidenced by line 2 of output.
Report a complete, implementable encode+decode grammar.`,
  },
]

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'rules', 'exactStrings', 'gotchas', 'probesRun'],
  properties: {
    lens: { type: 'string' },
    rules: { type: 'string', description: 'Precise implementable ruleset, markdown' },
    exactStrings: { type: 'string', description: 'Verbatim message/format strings observed' },
    gotchas: { type: 'array', items: { type: 'string' } },
    probesRun: { type: 'integer' },
  },
}

const specs = (await parallel(SPEC_LENSES.map(l => () =>
  agent(`${COMMON}\n\nYOU ARE A BLACK-BOX BEHAVIORAL PROBER. You write NO implementation code.\nYour whole job is to run the reference executable many times and report exactly what it does.\n\n${l.prompt}`,
    { label: `spec:${l.key}`, phase: 'Spec', schema: SPEC_SCHEMA })
      .then(r => r && { ...r, lens: l.key })
))).filter(Boolean)

log(`Spec phase: ${specs.length}/${SPEC_LENSES.length} lenses resolved (${specs.reduce((n, s) => n + (s.probesRun || 0), 0)} probes)`)

const SPEC_DIGEST = specs.map(s =>
  `### LENS: ${s.lens}\nRULES:\n${s.rules}\n\nEXACT STRINGS:\n${s.exactStrings}\n\nGOTCHAS:\n- ${(s.gotchas || []).join('\n- ')}`
).join('\n\n---\n\n')

phase('Build')

const buildReport = await agent(`${COMMON}\n${ARCH}\n
VERIFIED BEHAVIORAL SPEC (produced by four independent probing agents just now — trust this over
your own assumptions, but re-verify anything that looks self-contradictory by running the executable):

${SPEC_DIGEST}

YOUR TASK
=========
Implement the full port. Create every file under /output. Then self-verify:
  - Run: node /output/test12.mjs --a simple --b hello --c -100
    and diff byte-for-byte against: /workspace/dataset/test12_executable --a simple --b hello --c -100
  - Repeat for all four sample test cases embedded as comments in /workspace/dataset/test12.py.
  - Also check: empty strings, quote characters in values, backslashes, tabs/newlines in values,
    huge integers, unicode-digit --c values, and the non-ascii UnicodeEncodeError path.
  - Compare stdout, stderr, AND exit code separately (use \`cmd >out 2>err; echo $?\`).
Iterate until byte-identical on everything you test.

Note: the PyInstaller line "[PYI-<n>:ERROR] Failed to execute script 'test12' due to unhandled
exception!" contains a varying process id — emit the same shape using process.pid.

Also run a self-audit before you finish:
  grep -rn "Uint8Array\\|ArrayBuffer\\|require(\\|module.exports\\|Buffer" /output   -> must be empty
  grep -rn "^import\\|from '" /output    -> every import must be a relative ./ or ../ path ending in .mjs
  ls /output/*.mjs /output/lib/*.mjs

Report what you built and what you verified.`,
  { label: 'implement', phase: 'Build' })

log('Build complete; starting differential verification')

phase('Differential')

const DIFF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'casesRun', 'mismatches'],
  properties: {
    lens: { type: 'string' },
    casesRun: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'expected', 'actual', 'channel'],
        properties: {
          argv: { type: 'string', description: 'exact shell args reproducing it' },
          channel: { type: 'string', enum: ['stdout', 'stderr', 'exitcode'] },
          expected: { type: 'string' },
          actual: { type: 'string' },
        },
      },
    },
  },
}

const DIFF_LENSES = [
  { key: 'happy', prompt: `Happy-path saturation. At least 120 valid invocations: the four documented sample cases verbatim; short/long/empty strings; every printable ASCII character appearing in --a and --b (including ' " \\\\ backtick $ ! * ? ; | & < > ( ) [ ] { } # % ~ ^ and space); strings containing BOTH ' and "; tab/newline/carriage-return embedded values; values that look like flags but are passed via --a=...; --c across -1e18-ish magnitudes, 0, -0, +0, huge 40-digit positive and negative, unicode-digit forms, underscore forms, whitespace-padded forms.` },
  { key: 'errors', prompt: `Error-path saturation. At least 80 invocations that should fail or print help: every subset of missing required options (7 subsets); invalid int values of many shapes; expected-one-argument triggers; unrecognized args (before, between, and after valid ones); positional junk; '--' separator; -h and --help alone and combined with each error class; --h and other abbreviations; bad abbreviation; '--a' with no value at end of argv; '--c=--5'. Compare stdout, stderr and exit code SEPARATELY for every case.` },
  { key: 'unicode', prompt: `Unicode / encoding saturation. At least 70 invocations: non-ascii in --a only, in --b only, in both; the very first char bad; a bad char in the middle; runs of 2, 3, and 5 consecutive non-ascii chars (verify the "characters in position P-Q" plural form and the exact P-Q values); two separate non-adjacent bad runs (which one is reported?); latin-1 range chars (\\xa0, \\xe9, \\xff), BMP chars (U+4E2D, U+05D0), astral chars via printf '\\xf0\\x9f\\x98\\x80' (emoji) and how the position index counts them, combining marks, and a bad char in --b when --a is clean vs when --a is also bad (line number 10 vs 11 in the traceback). Ignore the varying PYI-<pid> number when diffing — normalize it with sed before comparing, but DO verify the rest of that line matches.` },
  { key: 'adversarial', prompt: `Adversarial / structural. Try hard to BREAK the port rather than confirm it. At least 60 invocations probing: argument-order permutations, duplicated options where the last should win, mixing = and space forms in one call, values that are exactly "--a"/"-h"/"--"/"-"/"", extremely long values (10000 chars) where the bencode length prefix matters, values whose length changes the digit count of the prefix (9/10/99/100 chars), a value containing the literal substring "5:first" or "i1e" or "e" that could confuse a naive encoder/decoder, and --c values at BigInt boundaries (2^53-1, 2^53, 2^53+1, 2^63, -2^63) where a Number-based implementation would lose precision. ALSO statically audit /output for banned constructs (Uint8Array, ArrayBuffer, Buffer, require(, module.exports, non-relative imports, missing .mjs extensions, files outside /output) and report each as a mismatch with channel 'stdout' and argv 'STATIC-AUDIT: <detail>'.` },
]

async function runDiffRound(roundLabel) {
  const rounds = await parallel(DIFF_LENSES.map(l => () =>
    agent(`${COMMON}\n
YOU ARE A DIFFERENTIAL TESTER (${roundLabel}). The port already exists at /output/test12.mjs.
Your job: find every place where \`node /output/test12.mjs ARGS\` differs from
\`/workspace/dataset/test12_executable ARGS\`. You do NOT fix anything — you only report.

Method: write a bash (or node) harness that, for each case, runs both commands capturing
stdout, stderr and exit code into separate files and diffs all three. Print only the failures.
Build the arg lists with a bash array so quoting is exact. Example harness shape:

  run(){ local -a A=("\$@")
    /workspace/dataset/test12_executable "\${A[@]}" >/tmp/eo 2>/tmp/ee; local er=\$?
    node /output/test12.mjs "\${A[@]}" >/tmp/no 2>/tmp/ne; local nr=\$?
    sed -i -E 's/PYI-[0-9]+/PYI-N/' /tmp/ee /tmp/ne
    diff -q /tmp/eo /tmp/no >/dev/null || echo "STDOUT DIFF: \${A[*]}"
    ...
  }

${l.prompt}

Report EVERY mismatch found with a reproducing argv. If you find none, say so with casesRun set
honestly. Do not stop at the first failure — enumerate all of them.`,
      { label: `diff:${l.key}:${roundLabel}`, phase: 'Differential', schema: DIFF_SCHEMA })
        .then(r => r && { ...r, lens: l.key })
  ))
  return rounds.filter(Boolean)
}

let round = 1
let allClear = false
let lastMismatches = []

while (round <= 4 && !allClear) {
  const results = await runDiffRound(`round${round}`)
  const mismatches = results.flatMap(r => (r.mismatches || []).map(m => ({ ...m, lens: r.lens })))
  const cases = results.reduce((n, r) => n + (r.casesRun || 0), 0)
  log(`Round ${round}: ${cases} cases across ${results.length} lenses -> ${mismatches.length} mismatches`)

  if (mismatches.length === 0) { allClear = true; lastMismatches = []; break }
  lastMismatches = mismatches

  phase('Repair')
  const repairInput = mismatches.map((m, i) =>
    `${i + 1}. [lens=${m.lens}] [${m.channel}] argv: ${m.argv}\n   expected(python): ${JSON.stringify(m.expected)}\n   actual(node):     ${JSON.stringify(m.actual)}`
  ).join('\n')

  await agent(`${COMMON}\n${ARCH}\n
Differential testers found the following mismatches between /output/test12.mjs and the reference
executable. Fix ALL of them in /output. For each one, first REPRODUCE it yourself by running both
commands, because a reported mismatch may itself be wrong (e.g. a tester forgot to normalize the
varying PYI-<pid> number, or mis-quoted the shell args). If a report does not reproduce, say so
and move on — do NOT contort the code to satisfy a phantom.

Fix root causes, not symptoms: prefer correcting the shared rule in the relevant lib module over
special-casing an input. After fixing, re-run every listed case plus the four documented sample
cases to confirm no regression. Keep the architecture multi-module and keep every hard requirement
(no Uint8Array/ArrayBuffer/Buffer/require/module.exports, ESM only, .mjs everywhere, /output only).

MISMATCHES (round ${round}):
${repairInput}`,
    { label: `repair:round${round}`, phase: 'Repair' })

  phase('Differential')
  round++
}

if (!allClear) log(`WARNING: exited repair loop with ${lastMismatches.length} unresolved mismatch reports after ${round - 1} rounds`)

phase('Audit')

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'findings'],
  properties: {
    pass: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'detail'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          detail: { type: 'string' },
          file: { type: 'string' },
        },
      },
    },
  },
}

const AUDITS = [
  { key: 'requirements', prompt: `Audit /output against EVERY hard requirement in the task statement, one by one, with a command proving each: ESM-only (no require/module.exports anywhere), .mjs suffix on every file, every import is relative AND ends in .mjs AND resolves to an existing file, zero external/npm imports, no Uint8Array/ArrayBuffer/Buffer token anywhere (code, comments, or strings), no Python invocation or embedded python source, all files under /output, multi-module hierarchical split with real \`export\`s that are actually imported (flag any dead module or any module that is just a re-export shim), and an entry file exactly at /output/test12.mjs. Also confirm the code runs on Node 18 (no syntax/API newer than Node 18).` },
  { key: 'completeness', prompt: `Completeness critic. Read /workspace/dataset/test12.py, /workspace/SPEC.md, and every file in /output. Ask: what behavior of the Python program is NOT reproduced, what code path in /output is never exercised by the sample cases, and what input class did the differential testers likely MISS entirely? Then actually TEST your hypotheses against the reference executable and report only what genuinely differs. Be specific and adversarial — hunt for the untested corner, do not restate what already passes.` },
  { key: 'codequality', prompt: `Code-quality and robustness review of /output. Look for: silent precision loss (Number vs BigInt), off-by-one in the bencode length prefix or the UnicodeEncodeError position index, decoder that does not actually parse (e.g. just echoes the input structure it was handed) — verify the decoder is a REAL parser by having it decode a bencode payload you construct by hand, incorrect dict key sort, quote-selection bugs in bytes repr, and any place the code would throw an unhandled JS exception on weird input. Report concrete defects with a reproducing input where possible.` },
]

const audits = (await parallel(AUDITS.map(a => () =>
  agent(`${COMMON}\n\nYOU ARE AN AUDITOR. Report problems; do not rewrite the implementation.\n\n${a.prompt}`,
    { label: `audit:${a.key}`, phase: 'Audit', schema: AUDIT_SCHEMA, effort: 'high' })
      .then(r => r && { ...r, key: a.key })
))).filter(Boolean)

const blockers = audits.flatMap(a => (a.findings || []).filter(f => f.severity !== 'minor').map(f => ({ ...f, key: a.key })))
log(`Audit: ${audits.length} auditors, ${blockers.length} blocker/major findings`)

if (blockers.length) {
  phase('Repair')
  await agent(`${COMMON}\n${ARCH}\n
Final auditors raised the following findings against /output. Verify each one against the
reference executable, fix the real ones, and explicitly note any you determined to be false
positives (with the evidence that makes them false). After fixing, re-run the four documented
sample cases plus a spread of error/unicode/bigint cases and confirm byte-identical stdout,
stderr and exit codes (normalizing only the varying PYI-<pid> number).

FINDINGS:
${blockers.map((f, i) => `${i + 1}. [${f.severity}] (${f.key}${f.file ? ' / ' + f.file : ''}) ${f.detail}`).join('\n')}`,
    { label: 'repair:final', phase: 'Repair' })

  phase('Audit')
  const recheck = await runDiffRound('final')
  const remaining = recheck.flatMap(r => (r.mismatches || []).map(m => ({ ...m, lens: r.lens })))
  log(`Final re-verification: ${remaining.length} mismatches remaining`)
  return { rounds: round - 1, blockers: blockers.length, remaining, buildReport }
}

return { rounds: round - 1, blockers: 0, remaining: lastMismatches, buildReport }
