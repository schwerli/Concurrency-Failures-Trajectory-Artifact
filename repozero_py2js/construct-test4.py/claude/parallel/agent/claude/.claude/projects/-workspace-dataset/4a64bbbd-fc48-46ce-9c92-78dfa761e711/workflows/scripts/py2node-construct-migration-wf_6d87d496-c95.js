export const meta = {
  name: 'py2node-construct-migration',
  description: 'Migrate /workspace/dataset/construct/test4.py to ESM Node.js modules in /output with adversarial differential verification against the reference executable',
  phases: [
    { title: 'Spec', detail: 'parallel black-box probing of argparse, int(), construct repr, exit/stream semantics' },
    { title: 'Implement', detail: 'write hierarchical .mjs library modules + entry point in /output' },
    { title: 'Verify', detail: 'differential + adversarial + static-compliance testing vs the reference executable' },
    { title: 'Fix', detail: 'apply fixes for confirmed mismatches, then re-verify' },
    { title: 'Audit', detail: 'final completeness critic + exhaustive differential sweep' },
  ],
}

const EXE = '/workspace/dataset/test4_executable'
const SRC = '/workspace/dataset/construct/test4.py'
const OUT = '/output'

const COMMON = `
CONTEXT — you are helping migrate this Python program to Node.js ESM:

--- ${SRC} ---
#!/usr/bin/env python3
import argparse
import construct

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=int, required=True)
    parser.add_argument('--b', type=int, required=True)
    args = parser.parse_args()

    struct_format = construct.Struct(
        "field1" / construct.Int8ul,  # first field
        "field2" / construct.Int8ul   # second field
    )
    data = bytes([args.a, args.b])
    result = struct_format.parse(data)
    print(result)

if __name__ == "__main__":
    main()
---

A precompiled reference executable exists at ${EXE}. Run it directly (NEVER run 'python'):
  ${EXE} --a 91 --b 54
It is the ONLY ground truth. You may not read Python package sources.

ALREADY-ESTABLISHED FACTS (verified by the orchestrator, do not re-derive, but you may extend):
- Success stdout is exactly: "Container: \\n    field1 = <a>\\n    field2 = <b>\\n"
  NOTE the TRAILING SPACE after "Container:" and the 4-space indents. Exit code 0.
- Out-of-range or huge/negative ints (bytes() failure) -> Python traceback on STDERR, exit code 1:
    Traceback (most recent call last):
      File "test4.py", line 20, in <module>
        main()
      File "test4.py", line 15, in main
        data = bytes([args.a, args.b])
               ^^^^^^^^^^^^^^^^^^^^^^^
    ValueError: bytes must be in range(0, 256)
    [PYI-<pid>:ERROR] Failed to execute script 'test4' due to unhandled exception!
- argparse errors -> usage line + "test4_executable: error: ..." on STDERR, exit code 2.
- -h/--help/--h/--he -> help text on STDOUT, exit code 0 (help wins even if other args present/missing).
- int() accepts surrounding whitespace, +/- sign, underscores between digits, and Unicode decimal
  digits (e.g. Arabic-Indic '\\u0669\\u0661', fullwidth '\\uff19\\uff11'); rejects '0x10', '91.0', '1_', '', ' '.
- Repeated options: last wins. '--a=91' form works. Missing-required error is emitted BEFORE
  unrecognized-argument errors. Single-dash '-a' is NOT an alias for '--a'.
`

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'evidence'],
        properties: {
          rule: { type: 'string', description: 'A precise, implementable behavioral rule' },
          evidence: { type: 'string', description: 'The exact command run and its exact observed output/exit code' },
          surprising: { type: 'boolean', description: 'true if a naive implementer would likely get this wrong' },
        },
      },
    },
  },
}

phase('Spec')

const specs = await parallel([
  () => agent(`${COMMON}

YOUR JOB: exhaustively black-box probe the ARGUMENT PARSING layer of ${EXE} and report precise
implementable rules. Run many commands. Cover at least:
- prefix abbreviation of --help (--h, --he, --hel) and whether --a/--b can be abbreviated or ambiguous
- '=' form, space form, '--a=' with empty value, '--a=-5'
- interleaving/ordering, duplicate options, options after positionals
- unrecognized single args vs multiple ('--c 3 --d 4' -> how are they joined in the message?)
- bare '-', bare '--', '--' separator placement, arguments that look like negative numbers ('-1', '-1.5', '--1')
- what happens with '--a' as the LAST token (missing value), and '--a --b 5'
- the EXACT usage string, EXACT help text (capture with od -c to confirm every space/newline), and
  which stream each goes to, plus exact exit codes
- exact wording/ordering of the "the following arguments are required: ..." message for each combination
- whether an argparse error or the help flag wins when both present
- exit code and stream for every case
Report each as a rule with the literal command + literal output as evidence. Be exhaustive; run 40+ probes.
Use: cmd 2>/dev/null (stdout only) and cmd 2>&1 1>/dev/null (stderr only) to attribute streams.
Do NOT write any files.`, { label: 'spec:argparse', phase: 'Spec', schema: SPEC_SCHEMA }),

  () => agent(`${COMMON}

YOUR JOB: exhaustively black-box probe the INTEGER PARSING semantics (Python's int(str)) as exposed
through '--a <value>' of ${EXE}, and report precise implementable rules for a JS reimplementation.
A value that parses as an int but is outside 0..255 gives the ValueError traceback (exit 1);
a value that fails int() gives "invalid int value: '<repr>'" (exit 2). Use that oracle to classify.
Cover at least:
- leading/trailing ASCII whitespace, tabs, newlines, form feed, vertical tab, NBSP (\\u00a0),
  other Unicode spaces (\\u2000, \\u3000, \\u200b), and whitespace BETWEEN sign and digits
- '+5', '-5', '++5', '+-5', '5+'
- underscores: '1_0', '1__0', '_10', '10_', '+1_0', '1_0_0'
- Unicode decimal digits: Arabic-Indic \\u0660-\\u0669, Devanagari \\u0966-\\u096f, fullwidth \\uff10-\\uff19,
  and MIXING ASCII with Unicode digits; also non-decimal numerics like '\\u00b2' (superscript 2) and
  '\\u216c' (roman numeral) which int() should REJECT
- huge magnitudes (100+ digit numbers) and how they behave
- how the invalid-value message quotes/escapes the offending string (test values containing a single
  quote, a backslash, a newline, a NUL-free control char, and non-ASCII) -- this reveals Python repr()
  rules; capture the EXACT bytes with od -c
Report precise rules. Run 40+ probes. Do NOT write any files.`, { label: 'spec:int', phase: 'Spec', schema: SPEC_SCHEMA }),

  () => agent(`${COMMON}

YOUR JOB: pin down the OUTPUT FORMATTING and PROCESS semantics with byte-level precision.
- Capture success stdout for many (a,b) pairs with 'od -c' and confirm the exact byte sequence,
  including the trailing space after "Container:", indentation width, and the final newline.
- Check boundary values 0, 1, 9, 10, 99, 100, 255 and confirm numbers are rendered as plain decimals
  with no padding/prefix.
- Confirm nothing else is printed on stdout (no trailing blank line) and that stderr is empty on success.
- Determine the exact stderr bytes of the ValueError traceback path (od -c), and confirm the
  '[PYI-<n>:ERROR]' number varies between runs (i.e. it is a PID) by running it repeatedly.
- Confirm exit codes: success=0, ValueError=1, argparse error=2, help=0.
- Check behaviour when stdout is a pipe vs a file (any buffering/ordering difference between the
  stdout and stderr contents) and when stdout is closed early (e.g. '| head -c 0') -- note only what
  is reproducible.
Report precise, implementable rules with literal od -c evidence. Do NOT write any files.`, { label: 'spec:output', phase: 'Spec', schema: SPEC_SCHEMA }),
])

const allFindings = specs.filter(Boolean).flatMap(s => s.findings || [])
log(`Spec phase: ${allFindings.length} behavioral rules gathered`)

const specText = allFindings
  .map((f, i) => `${i + 1}. ${f.surprising ? '[SURPRISING] ' : ''}${f.rule}\n   evidence: ${f.evidence}`)
  .join('\n')

const CONSTRAINTS = `
HARD CONSTRAINTS (violating any invalidates the work):
1. Pure JavaScript for Node.js. ES MODULES ONLY: 'import'/'export'. NEVER 'require()' or 'module.exports'.
2. Every generated file MUST use the .mjs extension, and every relative import MUST include the
   full './x.mjs' suffix.
3. ZERO external dependencies. Only node: builtin modules (node:process, node:path, node:buffer, ...)
   and local relative files may be imported. No npm packages (no yargs/argparse/construct/etc).
4. No embedding or invoking Python.
5. Do NOT use or even MENTION (in code, comments, identifiers, or strings) 'DataView' or 'ArrayBuffer'
   or manual typed-array struct parsing. Use node:buffer's Buffer (e.g. Buffer.from([...]) and
   buf.readUInt8(offset)) for byte handling. Do not write the words DataView/ArrayBuffer anywhere.
6. All generated code lives under ${OUT}. Hierarchical: split the library into multiple modules by
   functionality, each exposing its interface via 'export'. The entry file MUST be exactly
   ${OUT}/test4.mjs and must run as: node ${OUT}/test4.mjs --a 91 --b 54
7. Comments in code should be in English.
`

const ARCH = `
REQUIRED ARCHITECTURE (create exactly this layout under ${OUT}):
  ${OUT}/test4.mjs                       -- entry point; mirrors the Python main() 1:1
  ${OUT}/lib/errors.mjs                  -- PyValueError / ArgumentTypeError / ArgumentParserExit style error classes
  ${OUT}/lib/python/repr.mjs             -- Python repr() of a string (for "invalid int value: '...'")
  ${OUT}/lib/python/int.mjs              -- faithful Python int(str) parser (unicode digits, underscores, sign, whitespace), returns BigInt
  ${OUT}/lib/python/bytes.mjs            -- Python bytes(iterable-of-int) semantics -> Buffer, raising ValueError "bytes must be in range(0, 256)"
  ${OUT}/lib/python/traceback.mjs        -- renders the exact PyInstaller-style unhandled-exception report to stderr
  ${OUT}/lib/argparse/formatter.mjs      -- usage line + help text formatting
  ${OUT}/lib/argparse/parser.mjs         -- ArgumentParser: add_argument/parse_args, abbreviation, '=' form, required checks, error()/exit codes
  ${OUT}/lib/argparse/index.mjs          -- re-export barrel for the argparse emulation
  ${OUT}/lib/construct/container.mjs     -- Container class with the construct __str__ rendering ("Container: \\n    k = v")
  ${OUT}/lib/construct/numbers.mjs       -- Int8ul (and siblings) formats implemented over Buffer
  ${OUT}/lib/construct/core.mjs          -- Subconstruct base, Renamed, Struct, and the '/' naming helper (JS: Named(name, fmt) since JS has no operator overloading)
  ${OUT}/lib/construct/index.mjs         -- barrel exporting the 'construct' namespace surface used by the entry
Each module must have a short header comment saying what it emulates. Keep modules cohesive and
genuinely reusable (e.g. numbers.mjs should support the common int formats, not just Int8ul).
`

phase('Implement')

const implReport = await agent(`${COMMON}

${CONSTRAINTS}

${ARCH}

VERIFIED BEHAVIORAL SPEC (from black-box probing of the reference executable — implement ALL of it):
${specText}

ADDITIONAL IMPLEMENTATION NOTES:
- The program name used in usage/error messages must match the reference byte-for-byte:
  use the literal prog name "test4_executable" (define it as an exported constant in the entry or a
  small config, with a comment explaining it mirrors the reference program name so that usage and
  error text align exactly).
- The traceback path must reproduce the reference stderr text, using the current process id for the
  '[PYI-<pid>:ERROR]' line (read it from node:process). Exit code 1.
- Use BigInt inside the int parser so 100-digit inputs behave correctly, and range-check against
  0..255 before constructing the Buffer.
- Write to stdout/stderr via node:process streams so no extra newline is introduced.
- The Struct parse must actually read bytes out of a Buffer with readUInt8 (a real parse), and must
  produce a Container whose string rendering matches construct's.
- Container must hide keys beginning with '_' from its string rendering (that is how construct behaves),
  and preserve field insertion order.

DELIVERABLE: create every file. Then verify with real runs:
  node ${OUT}/test4.mjs --a 91 --b 54
  diff <(node ${OUT}/test4.mjs --a 91 --b 54 2>&1; echo "RC=$?") <(${EXE} --a 91 --b 54 2>&1; echo "RC=$?")
and a handful of error cases. Fix anything that differs before returning.
Return a concise report: the file list you created, and the results of your verification runs.`,
  { label: 'implement', phase: 'Implement' })

log('Implementation written; starting adversarial verification')

const MISMATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mismatches', 'casesRun'],
  properties: {
    casesRun: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'expected', 'actual', 'severity'],
        properties: {
          argv: { type: 'string', description: 'Exact argument vector used, shell-quoted' },
          expected: { type: 'string', description: 'Reference executable output (stdout/stderr/exit code)' },
          actual: { type: 'string', description: 'Node implementation output (stdout/stderr/exit code)' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          note: { type: 'string' },
        },
      },
    },
  },
}

const DIFF_HARNESS = `
Use a differential harness like this (bash), comparing stdout, stderr and exit code separately:

  cmp_case() {
    local eo eerr erc ao aerr arc
    eo=$(${EXE} "$@" 2>/tmp/e.err); erc=$?; eerr=$(cat /tmp/e.err)
    ao=$(node ${OUT}/test4.mjs "$@" 2>/tmp/a.err); arc=$?; aerr=$(cat /tmp/a.err)
    if [ "$eo" != "$ao" ] || [ "$erc" != "$arc" ] || [ "$eerr" != "$aerr" ]; then
      printf 'MISMATCH argv=[%s]\\n exp_rc=%s act_rc=%s\\n exp_out=%q\\n act_out=%q\\n exp_err=%q\\n act_err=%q\\n' "$*" "$erc" "$arc" "$eo" "$ao" "$eerr" "$aerr"
    fi
  }

IMPORTANT: the '[PYI-<pid>:ERROR]' line contains a process id that legitimately differs between the two
programs — normalize it (e.g. sed -E 's/\\[PYI-[0-9]+:ERROR\\]/[PYI-N:ERROR]/') before comparing, and do
NOT report that number as a mismatch. Everything else must match byte-for-byte, including trailing spaces
(compare with od -c when a difference is subtle).
`

const VERIFY_SCHEMA = MISMATCH_SCHEMA

async function runVerification(round) {
  const p = `Verify${round > 1 ? ` R${round}` : ''}`
  return (await parallel([
    () => agent(`${COMMON}

The Node.js reimplementation lives at ${OUT}/test4.mjs (with libraries under ${OUT}/lib/).
${DIFF_HARNESS}

YOUR JOB (round ${round}): HAPPY-PATH + BOUNDARY differential sweep. Run at least 120 cases covering:
- every boundary byte value: 0,1,2,127,128,129,254,255 for both --a and --b, in both orders
- a large random sample of valid (a,b) pairs in 0..255 (use $RANDOM), both space and '=' forms
- mixed forms ('--a=7 --b 8'), reversed option order, duplicated options
- values with leading '+', leading zeros ('007'), surrounding whitespace, underscores, unicode digits
Report only genuine mismatches. Be precise about which stream differed.`,
      { label: `diff:happy${round}`, phase: p, schema: VERIFY_SCHEMA }),

    () => agent(`${COMMON}

The Node.js reimplementation lives at ${OUT}/test4.mjs (with libraries under ${OUT}/lib/).
${DIFF_HARNESS}

YOUR JOB (round ${round}): ADVERSARIAL ARGPARSE differential sweep. You are trying to BREAK the JS port.
Run at least 120 hostile cases: missing options, missing values, unknown options (one and many),
'--' separator in every position, bare '-', '-a'/'-b' single dash, abbreviations of --help,
'--a' with '=' and empty value, option-looking values ('--a -1', '--a --1', '--a -1.5', '--a -x'),
help combined with errors, empty argv, arguments after values, repeated/conflicting options,
very long argv, args containing spaces/quotes/newlines/unicode, and anything else you can invent.
Verify stdout, stderr AND exit code for every case. Report only genuine mismatches.`,
      { label: `diff:argparse${round}`, phase: p, schema: VERIFY_SCHEMA }),

    () => agent(`${COMMON}

The Node.js reimplementation lives at ${OUT}/test4.mjs (with libraries under ${OUT}/lib/).
${DIFF_HARNESS}

YOUR JOB (round ${round}): ADVERSARIAL VALUE/int() differential sweep. Attack the number parser.
At least 120 cases: out-of-range (-1, 256, 1000, 2**31, 10**100, -10**100), whitespace variants
(tabs, newlines, \\f, \\v, \\u00a0, \\u2000, \\u3000, \\u200b), sign variants, underscore placements,
unicode decimal digits from several scripts (Arabic-Indic, Devanagari, Bengali, fullwidth) including
mixed-script and mixed-with-ASCII, non-decimal numerics ('\\u00b2', '\\u216c', '\\u2160'), floats,
hex/octal/binary literal forms ('0x10','0o7','0b1'), scientific notation, embedded NUL-free control
chars, empty and whitespace-only, and strings needing Python repr escaping (quotes, backslashes,
newlines, non-ASCII) so you can check the "invalid int value: '...'" message escaping byte-for-byte.
Verify stdout, stderr AND exit code. Report only genuine mismatches.`,
      { label: `diff:ints${round}`, phase: p, schema: VERIFY_SCHEMA }),

    () => agent(`${COMMON}

${CONSTRAINTS}

YOUR JOB (round ${round}): STATIC COMPLIANCE AUDIT of everything under ${OUT}. Do not run differential
tests; instead read every generated file and mechanically check the hard constraints:
- 'grep -rn "require(\\|module.exports\\|exports\\." ${OUT}' must be empty
- every file ends in .mjs; every relative import specifier ends in .mjs and resolves to an existing file
  (verify each import target exists on disk)
- no bare (non-'node:') import specifiers anywhere -> no external packages. Also flag bare specifiers
  without the 'node:' prefix (e.g. 'fs' or 'path'), which should use the node: form.
- 'grep -rniE "dataview|arraybuffer" ${OUT}' must be empty (this is a hard prohibition, including comments)
- no python invocation, no child_process spawning of python
- entry point is exactly ${OUT}/test4.mjs and runs standalone
- library is genuinely split into cohesive modules with 'export'ed interfaces (not one giant file, and
  not empty stub files)
- run 'node --check' on each file, and confirm 'node ${OUT}/test4.mjs --a 1 --b 2' works from a
  different cwd (e.g. cd / && node ${OUT}/test4.mjs --a 1 --b 2)
Report every violation as a mismatch entry (use argv='<static>' and describe the violation in 'note',
put the offending file:line in 'actual' and the required state in 'expected').`,
      { label: `audit:static${round}`, phase: p, schema: VERIFY_SCHEMA }),
  ])).filter(Boolean)
}

phase('Verify')
let results = await runVerification(1)
let mismatches = results.flatMap(r => r.mismatches || [])
let totalCases = results.reduce((n, r) => n + (r.casesRun || 0), 0)
log(`Round 1: ${totalCases} cases run, ${mismatches.length} candidate mismatches`)

let round = 1
while (mismatches.length > 0 && round <= 3) {
  phase('Fix')
  const list = mismatches
    .map((m, i) => `${i + 1}. [${m.severity}] argv: ${m.argv}\n   expected: ${m.expected}\n   actual:   ${m.actual}${m.note ? `\n   note: ${m.note}` : ''}`)
    .join('\n')

  log(`Fix round ${round}: addressing ${mismatches.length} reported issues`)

  await agent(`${COMMON}

${CONSTRAINTS}

The Node.js port lives at ${OUT}/test4.mjs with libraries under ${OUT}/lib/.
Differential testers and a static auditor reported these candidate issues:

${list}

YOUR JOB: for EACH issue, first REPRODUCE it yourself by running both programs
(${EXE} vs 'node ${OUT}/test4.mjs') with the same argv. Remember the '[PYI-<pid>:ERROR]' number is a
process id and legitimately differs — never "fix" that. If an issue does not reproduce, ignore it and
say so. For issues that DO reproduce, fix the JS implementation so it matches the reference
byte-for-byte on stdout, stderr and exit code — without breaking any currently-passing behaviour.
Preserve the modular architecture and all hard constraints. After fixing, re-run every reported case
plus a regression set of ~30 known-good cases and confirm they all match.
Return a concise report of what reproduced, what you changed, and the final verification results.`,
    { label: `fix:round${round}`, phase: 'Fix' })

  round++
  phase(`Verify R${round}`)
  results = await runVerification(round)
  mismatches = results.flatMap(r => r.mismatches || [])
  totalCases = results.reduce((n, r) => n + (r.casesRun || 0), 0)
  log(`Round ${round}: ${totalCases} cases run, ${mismatches.length} candidate mismatches`)
}

phase('Audit')

const finalAudit = await agent(`${COMMON}

${CONSTRAINTS}

The finished Node.js port lives at ${OUT}. YOUR JOB: final completeness critic + exhaustive sweep.
1. Run a large randomized differential sweep (400+ cases) mixing valid pairs, out-of-range values,
   malformed values and malformed argv. Normalize '[PYI-<pid>:ERROR]' before comparing. Compare
   stdout, stderr and exit code.
2. Explicitly re-verify the four documented sample test cases produce byte-identical stdout and exit 0:
   (--a 91 --b 54), (--a 128 --b 5), (--a 56 --b 78), (--a 81 --b 216).
   Verify with 'od -c' that the trailing space after "Container:" is present.
3. Re-check every hard constraint mechanically (grep for require/module.exports, bare imports,
   dataview/arraybuffer, .mjs suffixes on files and import specifiers, node --check on each file).
4. Ask: what is still unverified or missing? Anything a reviewer would flag? Any module that is a
   hollow stub? Any behaviour of the reference not yet emulated?
Return: a PASS/FAIL verdict, the number of cases run and mismatches found, the final file tree with
one-line descriptions, and a list of anything still outstanding. Be honest — do not claim a clean
sweep unless you actually ran it.`,
  { label: 'audit:final', phase: 'Audit' })

return { implReport, roundsRun: round, remainingMismatches: mismatches.length, finalAudit }
