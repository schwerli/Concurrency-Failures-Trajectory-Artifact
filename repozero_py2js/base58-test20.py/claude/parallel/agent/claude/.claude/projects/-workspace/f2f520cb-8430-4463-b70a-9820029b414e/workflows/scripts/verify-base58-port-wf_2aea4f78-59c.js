export const meta = {
  name: 'verify-base58-port',
  description: 'Adversarially fuzz and audit the Node port of test20.py against the reference executable',
  phases: [
    { title: 'Fuzz', detail: 'six independent differential fuzz strategies' },
    { title: 'Audit', detail: 'code-level divergence hunt + constraint compliance' },
    { title: 'Reproduce', detail: 'independently reproduce every claimed defect' },
    { title: 'Synthesis', detail: 'consolidate confirmed defects into a fix list' },
  ],
}

const COMMON = `
CONTEXT
You are validating a Node.js (ESM) port of a Python program against its reference implementation.

  Reference (ground truth): /workspace/dataset/test20_executable
  Port under test:          node /output/test20.mjs
  Original Python source:    /workspace/dataset/base58/test20.py   (read it)

Both take required args --a --b --c --d --e (strings) --f --g (ints) and print 12 lines:
  1 b58encode(a.encode())            7 b58encode(d.encode())
  2 b58decode(b)                     8 b58decode(e)
  3 b58encode_check(c.encode())      9 b58encode_int(g)
  4 b58decode_check(line3)          10 b58encode_check(line2)
  5 b58encode_int(f)                11 b58decode_check(line10)
  6 b58decode_int(line5)            12 b58encode(line11)

WHAT COUNTS AS A DEFECT
- stdout differs by even one byte, OR the exit status differs.
- stderr is NOT compared: the reference embeds its own program name and a per-run
  process id in its traceback trailer, so stderr can never match byte for byte.
  You MAY report a stderr difference beyond those two unavoidable things as a minor note.

HARD RULES
- NEVER run python/python3 or any interpreter of the source. Only the executable and node.
- DO NOT EDIT ANYTHING under /output. It is read-only for you. Put all scratch files in
  /tmp with a name unique to you (e.g. /tmp/<your-area>-<n>.mjs) so you don't collide with
  other agents doing the same job concurrently.
- A ready-made comparison helper already exists at /tmp/harness.mjs — import it, don't modify it:
    import { runCase, report } from '/tmp/harness.mjs'
    const r = runCase(['--a','x','--b','2','--c','x','--d','y','--e','3','--f','1','--g','1'])
    // r.ok, r.ref.{out,err,code}, r.js.{out,err,code}
  Pass argv as an ARRAY OF STRINGS (no shell quoting problems). runCase(argv, timeoutMs).
- BEWARE: the reference is a frozen-Python binary with ~200ms startup and the machine is
  busy. A spawn timeout shows up as code "signal:SIGTERM" with empty stdout. That is NOT a
  defect — ALWAYS re-run any candidate failure on its own with a 60000ms timeout before
  reporting it, and drop it if it then passes.
- NEVER report a defect you have not reproduced at least twice.
- KNOWN AND INTENDED, do not report: a negative --f or --g makes BOTH programs loop forever
  (the original's while-loop over floor division never terminates). Do not fuzz negative
  integers other than "-0", and never without a timeout.

REPORT ONLY REPRODUCIBLE, CONCRETE DEFECTS with the exact argv array and both outputs.
Also report how many cases you ran in total.
`

const DEFECTS = {
  type: 'object',
  additionalProperties: false,
  required: ['casesRun', 'defects', 'notes'],
  properties: {
    casesRun: { type: 'integer' },
    defects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'refOutput', 'jsOutput', 'summary'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          refOutput: { type: 'string', description: 'Reference stdout (or a description incl. exit code)' },
          jsOutput: { type: 'string', description: 'Port stdout (or a description incl. exit code)' },
          refExit: { type: 'string' },
          jsExit: { type: 'string' },
          summary: { type: 'string' },
          reproducedTimes: { type: 'integer' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' }, description: 'Minor/stderr-only observations' },
  },
}

const FUZZERS = [
  {
    key: 'bulk-random',
    prompt: `${COMMON}

YOUR STRATEGY: high-volume structured random differencing. Run AT LEAST 1500 cases.
Build pools and sample independently for each of the 7 arguments:
- --a/--c/--d: random strings — empty, 1 char, short, 50, 200, 1000 chars; pure ASCII printable;
  strings containing backslash, single quote, double quote, both quotes, tabs, newlines,
  control bytes, DEL, and every printable ASCII character at least once somewhere.
- --b/--e: valid base58 strings of many lengths (1..80), including runs of leading '1'
  characters, all-'1' strings, and strings with trailing whitespace.
- --f/--g: non-negative integers across magnitudes: 0, 1, small, near 58^k and 256^k,
  64-bit and 128-bit sizes, 40+ digit values.
Batch efficiently (spawn cost dominates; sequential is fine, just keep going). Report the
total count and any reproducible mismatch.`,
  },
  {
    key: 'unicode',
    prompt: `${COMMON}

YOUR STRATEGY: Unicode. The port must encode --a/--c/--d as UTF-8 exactly as Python does, and
must reproduce Python's bytes repr for the resulting non-ASCII bytes (always lowercase \\xNN).
Run AT LEAST 400 cases covering:
- 2-, 3- and 4-byte UTF-8: Latin-1 range (é ñ ÿ), Greek/Cyrillic, CJK, Hangul, Arabic, Hebrew,
  Devanagari, snowman/symbols, emoji (including emoji with ZWJ sequences and skin-tone
  modifiers), combining marks, U+FFFD, U+FEFF (BOM) at the start of a string.
- Boundary code points: U+007F, U+0080, U+07FF, U+0800, U+FFFF, U+10000, U+10FFFF.
- Non-ASCII in --b/--e (must raise on both sides — check exit codes match).
- Unicode digits for --f/--g: Arabic-Indic ٥, Devanagari १२३, fullwidth ５, Bengali, Thai,
  and mixed-script digit strings; also with + sign and with underscores between them.
- Unicode whitespace around --f/--g values, and TRAILING Unicode whitespace on --b/--e
  (U+00A0, U+3000, U+2028, U+2029, U+0085, U+1680, U+2000..U+200A, U+202F, U+205F) which the
  reference strips, versus U+200B which it rejects.
- LEADING whitespace on --b/--e (must NOT be stripped).
Report any reproducible mismatch.`,
  },
  {
    key: 'base58-boundaries',
    prompt: `${COMMON}

YOUR STRATEGY: numeric and structural boundaries of the base58 codec. Run AT LEAST 400 cases.
- Leading-zero handling in both directions: --b/--e made of 1..40 leading '1' characters
  followed by nothing / one digit / many digits. Verify lines 2, 10, 11 and 12 all agree.
- Empty and whitespace-only --b/--e ('', ' ', '\\t', '   ').
- Payloads whose big-integer value sits exactly at 58^k and 58^k-1 and 256^k boundaries.
- --a/--c/--d whose UTF-8 bytes begin with byte 0x00 — you cannot pass a NUL through argv, so
  reach zero-leading payloads through --b instead (line 10 checksums the decoded bytes) and
  verify lines 10/11/12.
- Very long inputs: --a/--c/--d of 500, 1000, 2000 characters; --b/--e of 500+ base58 digits.
- --f/--g at 0, 1, 57, 58, 59, 58^2, 58^2-1, 58^10, 2^64-1, 2^64, 2^128, 10^50, and a
  200-digit integer. Confirm line 6 prints the exact same decimal digits as the input value.
Report any reproducible mismatch.`,
  },
  {
    key: 'sha256-lengths',
    prompt: `${COMMON}

YOUR STRATEGY: stress the SHA-256 inside b58encode_check/b58decode_check (lines 3, 4, 10, 11).
The port implements SHA-256 by hand, so its message padding and multi-block handling are the
highest-risk code in the whole port. Padding bugs only show up at specific lengths.

Sweep --c through EVERY byte length from 0 to 200 inclusive (use single-byte ASCII characters
so character count equals byte length), and additionally lengths 254-260, 350-360, 511-513
and 1000-1030. Pay special attention to lengths 55, 56, 57, 63, 64, 65, 119, 120, 121, 127,
128, 129, 183, 184, 191, 192 — these straddle the 64-byte block and the 8-byte length field.
Then repeat a subset with multi-byte UTF-8 --c so the BYTE length hits those boundaries while
the character count does not (e.g. 'é' repeated 28 times = 56 bytes).
Also drive the second checksum path (line 10) by choosing --b values that decode to payloads
of those same critical lengths — a base58 string of n digits decodes to roughly 0.73n bytes,
so search for --b lengths that land the decoded payload on 51, 52, 55, 56, 59, 60 bytes
(remember line 10 checksums payload+4 bytes).
Report any reproducible mismatch. Report the total number of lengths you covered.`,
  },
  {
    key: 'cli-abuse',
    prompt: `${COMMON}

YOUR STRATEGY: command-line parsing. Compare EXIT CODES (and stdout, which should be empty on
error) for at least 250 invocations. stderr text is not compared, but DO check that the port
produces a non-empty error on stderr whenever the reference does, and that the error
CLASSIFICATION matches (exit 2 for argparse errors, 1 for an uncaught exception, 0 for help).
Cover:
- every subset of missing required options (all 7 missing, 6 missing, ... , 1 missing);
- '--a=v' equals form for each option, mixed with the space form; '--a=' empty value;
- duplicate options (which occurrence wins);
- unknown options: '--z 1', '--zz=9', '-q', '-a v', '--aa v', '--' alone, '--' before other
  options, two '--', bare positional tokens before/after/between options;
- prefix abbreviations: '--h', '--he', '--hel', '--help', '-h' (alone and mixed with other
  options, and with required options missing);
- values that look like options: '--a -x', '--a --b', '--a -', '--a -5', '--a -.5',
  '--a "-x y"' (a dash token containing a space), '--a ""', a value that is exactly '--';
- an option at the very end with no value, for each of the 7 options;
- int values for --f/--g: '5', '+5', '007', ' 5 ', '1_000', '1__0', '_5', '5_', '0x10',
  '0b101', '5.0', '5e3', '1e0', '', 'abc', '+', '-', ' + 5', '٥', '５', very long digit runs,
  and a 300-digit number;
- argument order permutations.
Report any case where the exit code or stdout differs.`,
  },
  {
    key: 'error-paths',
    prompt: `${COMMON}

YOUR STRATEGY: failure modes and the exact boundary between success and failure. At least 250 cases.
- Invalid base58 characters in --b and --e: each of '0', 'O', 'I', 'l', and a sample of
  punctuation, ASCII control characters, and space, placed at the FIRST, MIDDLE and LAST
  position of an otherwise valid string, and as the entire value. Confirm exit codes match and
  that stdout is EMPTY on both sides (nothing is printed before the failure).
- Same for values that are valid except for trailing whitespace (should SUCCEED) versus
  leading or interior whitespace (should FAIL).
- Non-ASCII in --b/--e: single non-ASCII char, several consecutive, several separated,
  non-ASCII at the end (does trailing-whitespace stripping interact with it?).
- Confirm that when --b is invalid, the failure happens regardless of what --e is, and vice
  versa, and that whichever comes first in the program's order is the one that decides the
  exit code.
- Cases where BOTH an argparse error and a runtime error are possible — confirm the argparse
  one wins (exit 2).
- Check stdout is byte-identical (empty) and exit codes match for every failure case.
Report any mismatch in exit code or stdout.`,
  },
]

phase('Fuzz')

const fuzzResults = await parallel(
  FUZZERS.map((f) => () => agent(f.prompt, { label: `fuzz:${f.key}`, phase: 'Fuzz', schema: DEFECTS })),
)

phase('Audit')

const AUDITS = [
  {
    key: 'semantic-divergence',
    prompt: `${COMMON}

YOUR JOB: read the port's source and find places where it diverges from Python semantics, then
PROVE each one by running both programs.

Files to read (read them ALL):
  /output/test20.mjs
  /output/lib/errors.mjs  /output/lib/unicode.mjs  /output/lib/pystr.mjs
  /output/lib/pybytes.mjs /output/lib/pyint.mjs    /output/lib/sha256.mjs
  /output/lib/argparse.mjs
  /output/lib/base58/{alphabet,frames,scrub,int,core,check,index}.mjs

Think about where a JS/Python mismatch hides: integer division and modulo signs, BigInt vs
Number truncation, string indexing by code unit vs code point, surrogate pairs, the exact
whitespace and digit sets, 32-bit overflow in the hash, off-by-one in the checksum slice,
byte values above 127, empty-input paths, and the order in which errors are raised.

For EVERY suspicion, construct an input that would expose it and RUN BOTH PROGRAMS. Report
only what you could actually make diverge, with the argv. If a suspicion turns out not to
diverge, put it in notes instead. Report casesRun as the number of probe invocations you made.`,
  },
  {
    key: 'constraint-compliance',
    prompt: `${COMMON}

YOUR JOB: audit the deliverable against its hard requirements. This is a compliance check, so
be literal and exhaustive. Read every file under /output (use 'find /output -type f' first).

Requirements:
 1. Pure JavaScript for Node.js. ES Modules ONLY: 'import'/'export' throughout. ANY use of
    require() or module.exports anywhere is a fatal violation.
 2. Every generated library file AND the entry file must use the .mjs extension.
 3. Zero external dependencies: no npm packages. NO import may resolve to anything other than
    a local relative file or a 'node:'-prefixed builtin. Check every single import statement.
    Flag any package.json that declares dependencies.
 4. No embedded Python: no child_process invocation of python, no .py files being executed,
    no shelling out at all in the deliverable.
 5. The byte-sequence constraint: the deliverable MUST NOT use Buffer, Uint8Array, any typed
    array (Int8Array/Uint16Array/ArrayBuffer/DataView/etc.), TextEncoder, or TextDecoder
    ANYWHERE. Byte data must be plain JS arrays of numbers. grep for every one of these names
    and report any hit, including in comments or strings.
 6. ESM import statements must include the full file suffix (e.g. './utils.mjs'), and every
    import must resolve to a file that actually exists. Verify each path on disk.
 7. Libraries split into multiple modules by functionality, each exposing its interface via
    export. Confirm the hierarchy is real (multiple files, meaningful separation) and that
    nothing is a stub.
 8. Everything lives under /output.

Also verify it actually RUNS from a different working directory and via an absolute path:
  cd / && node /output/test20.mjs --a x --b 2 --c x --d y --e 3 --f 1 --g 1
  cd /tmp && node /output/test20.mjs --a x --b 2 --c x --d y --e 3 --f 1 --g 1
and that no file is left unused/orphaned (every lib file should be reachable from test20.mjs
by following imports — verify by tracing the import graph).

Report each violation as a defect whose 'argv' is the offending file path split into one
element, refOutput = the requirement, jsOutput = what you found. Report clean results in notes.`,
  },
  {
    key: 'repr-exhaustive',
    prompt: `${COMMON}

YOUR JOB: prove the bytes-repr rendering is byte-exact for EVERY possible byte value, and that
the quoting rule is exactly right.

Line 4 of the output echoes the raw UTF-8 bytes of --c, so it renders arbitrary byte values.
Line 2 and 8 render arbitrary decoded bytes.

- Cover all 256 byte values. Bytes 0x00-0x7f you can produce directly via --c (except NUL,
  which argv cannot carry — reach 0x00 through --b using leading '1' digits instead). Bytes
  0x80-0xff always appear as the continuation bytes of UTF-8 sequences: choose code points so
  that every byte value in 0x80-0xff appears in some line-4 output, and verify each.
- Verify the escaping of 0x09, 0x0a, 0x0d (short escapes) versus 0x07, 0x08, 0x0b, 0x0c, 0x1b
  (which must be \\xNN, NOT \\a \\b \\f \\v), 0x7f, and the backslash.
- Verify the quote rule with all four combinations: no quotes, only ', only ", both ' and ".
  Include values where a quote is the first byte, the last byte, and repeated.
- Verify hex digits are lowercase and always exactly two digits.
- Do the same checks on line 2/8 (decoded bytes) and line 11.
- Also verify line 6 prints a bare decimal integer: no quotes, no b prefix, no separators, and
  no trailing 'n' (a common BigInt porting mistake). Test with huge values.
Run at least 300 cases. Report any reproducible mismatch.`,
  },
]

const auditResults = await parallel(
  AUDITS.map((a) => () => agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: DEFECTS })),
)

const allDefects = [...fuzzResults, ...auditResults]
  .filter(Boolean)
  .flatMap((r, i) => (r.defects || []).map((d) => ({ ...d, source: i })))

log(`collected ${allDefects.length} candidate defects from ${fuzzResults.filter(Boolean).length + auditResults.filter(Boolean).length} agents`)

phase('Reproduce')

const reproduced = await parallel(
  allDefects.map((d) => () =>
    agent(
      `${COMMON}

YOUR JOB: independently reproduce ONE claimed defect, or refute it. Assume it is FALSE until
your own commands say otherwise — most claimed defects in this kind of work are spawn timeouts,
shell-quoting artifacts, or the reporter comparing stderr.

CLAIM: ${d.summary}
  argv:        ${JSON.stringify(d.argv)}
  claimed ref: ${JSON.stringify(d.refOutput).slice(0, 800)}
  claimed js:  ${JSON.stringify(d.jsOutput).slice(0, 800)}

Run BOTH programs with EXACTLY that argv, at least 3 times each, with a 60000ms timeout, using
/tmp/harness.mjs (argv as an array — no shell quoting). Then:
- If stdout and exit code agree every time -> verdict "refuted".
- If they differ consistently -> verdict "confirmed"; give the exact differing line numbers and
  both values, and say in one sentence what the port gets wrong.
- If it differs only sometimes -> "refuted" (it is a timeout artifact) unless you can show the
  difference is deterministic.
- If the claim is a code-compliance finding rather than a runtime difference (e.g. "file uses
  Buffer"), verify it by reading the file yourself and grepping; confirmed only if the offending
  text is really there and really violates the stated requirement.
Also state whether stdout was empty on both sides when the exit code was non-zero.`,
      {
        label: `repro:${(d.summary || 'defect').slice(0, 40)}`,
        phase: 'Reproduce',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['verdict', 'explanation'],
          properties: {
            verdict: { enum: ['confirmed', 'refuted'] },
            explanation: { type: 'string' },
            differingLines: { type: 'array', items: { type: 'string' } },
            whatPortGetsWrong: { type: 'string' },
          },
        },
      },
    ).then((v) => ({ defect: d, verdict: v })),
  ),
)

const confirmed = reproduced.filter(Boolean).filter((r) => r.verdict?.verdict === 'confirmed')

phase('Synthesis')

const summary = await agent(
  `You are consolidating the validation results for a Node.js port of a Python base58 program.

The port lives in /output (entry /output/test20.mjs); ground truth is /workspace/dataset/test20_executable.

Nine agents fuzzed and audited it, then every claimed defect was independently re-run by a
separate agent that tried to refute it.

CONFIRMED DEFECTS (survived reproduction):
${JSON.stringify(confirmed.map((c) => ({ summary: c.defect.summary, argv: c.defect.argv, wrong: c.verdict.whatPortGetsWrong, lines: c.verdict.differingLines })), null, 2)}

REFUTED CLAIMS (for context, do not act on these):
${JSON.stringify(reproduced.filter(Boolean).filter((r) => r.verdict?.verdict === 'refuted').map((r) => r.defect.summary), null, 2)}

COVERAGE REPORTED BY EACH AGENT:
${JSON.stringify([...fuzzResults, ...auditResults].filter(Boolean).map((r) => ({ casesRun: r.casesRun, defects: (r.defects || []).length, notes: r.notes })), null, 2)}

Produce a short report:
1. Total differential cases run across all agents.
2. Each confirmed defect: what is wrong, the minimal reproducing argv, and which /output file
   and function must change to fix it. Be specific about the fix. Rank by severity: anything
   affecting normal valid inputs first, then error paths, then compliance issues.
3. Anything the coverage notes suggest was NOT tested and should be.
4. A one-line verdict: is the port correct for valid inputs, yes or no.
You may run /workspace/dataset/test20_executable and node /output/test20.mjs to settle
questions, but do not edit /output.`,
  { label: 'synthesis', phase: 'Synthesis', effort: 'high' },
)

return {
  totalCases: [...fuzzResults, ...auditResults].filter(Boolean).reduce((n, r) => n + (r.casesRun || 0), 0),
  candidateDefects: allDefects.length,
  confirmedDefects: confirmed.length,
  confirmed: confirmed.map((c) => ({ summary: c.defect.summary, argv: c.defect.argv, wrong: c.verdict.whatPortGetsWrong })),
  summary,
}
