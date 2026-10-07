export const meta = {
  name: 'probe-canonicaljson-float',
  description: 'Exhaustively characterize the Python test3_executable behavior (float repr, argparse, canonicaljson, bytes repr) to build a port spec',
  phases: [
    { title: 'Probe', detail: 'parallel probes of float repr, argparse, error paths, bytes repr' },
    { title: 'Adversarial', detail: 'hunt for cases the probes missed' },
  ],
}

const EXE = '/workspace/dataset/test3_executable'

const COMMON = `
You are reverse-engineering a precompiled Python program to port it to Node.js.
The executable is at ${EXE}. It was built from this source:

  import argparse, canonicaljson
  parser = argparse.ArgumentParser()
  parser.add_argument('--a', type=float, required=True)
  args = parser.parse_args()
  data = args.a
  result = canonicaljson.encode_canonical_json(data)
  print(result)

Rules:
- Run the executable directly with Bash, e.g. ${EXE} --a 1.5
- NEVER run 'python' or 'python3'. Do not try to unpack/decompile the binary. Treat it as a black box: probe via CLI only.
- Always capture BOTH stdout and stderr separately, and the exit code. Use a loop like:
    out=$(${EXE} --a "$v" 2>/tmp/err); rc=$?; echo "rc=$rc out=[$out] err=[$(cat /tmp/err)]"
- Run MANY probes (dozens+). Be systematic and exhaustive. Report exact byte-for-byte observed output.
- Beware the shell: quote values, and remember a leading '-' may be consumed by the program's own arg parser, not the shell.
`

const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, implementable rules derived from observation',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          evidence: { type: 'string', description: 'exact commands + exact observed stdout/stderr/exit code' },
          confidence: { type: 'string', enum: ['certain', 'likely', 'uncertain'] },
        },
        required: ['rule', 'evidence', 'confidence'],
      },
    },
    rawObservations: {
      type: 'array',
      description: 'Flat table of every probe run: input value, exit code, exact stdout, exact stderr',
      items: {
        type: 'object',
        properties: {
          argv: { type: 'string' },
          exitCode: { type: 'integer' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
        },
        required: ['argv', 'exitCode', 'stdout', 'stderr'],
      },
    },
    gotchasForJS: {
      type: 'array',
      description: 'Places where naive JavaScript would differ from the observed Python behavior',
      items: { type: 'string' },
    },
  },
  required: ['area', 'rules', 'rawObservations', 'gotchasForJS'],
}

const PROBES = [
  {
    key: 'float-repr-format',
    prompt: `${COMMON}

AREA: The exact textual formatting of the encoded float (Python's float repr / shortest round-trip algorithm).

The program prints something like b'1.5'. Ignore the b'...' wrapper for this task; focus ONLY on the numeric text inside.

Determine precisely:
1. When is fixed-point notation used vs scientific/exponential notation? Find the EXACT thresholds on both the large and small ends. Test around 1e15, 1e16, 1e17, 1e21, 1e22, and 1e-3, 1e-4, 1e-5, 1e-6. Note that JavaScript's Number.toString() switches at 1e21 and 1e-7 — find where THIS program switches, and confirm whether it differs.
2. Do integral values get a trailing '.0'? (e.g. --a 1 -> ?; --a 100 -> ?; --a 1e10 -> ?) Does the exponential form ever get '.0'? (--a 1e16 -> ?)
3. Exponent formatting in scientific notation: how many digits, is there always a sign, is it zero-padded? Test 1e-5 (2 digits?), 1e+16, 1e100, 1e308, 5e-324, 1e-100.
4. Number of significant digits: is it shortest-round-trip (like repr) or fixed 17 digits? Test values whose shortest repr is short but whose 17-digit form is ugly: 0.1, 0.3, 0.7, 2.675, 1.1, 4.35, 0.30000000000000004 (i.e. the sum 0.1+0.2), 5e-324, 2.2250738585072014e-308, 1.7976931348623157e308, 9007199254740993, 0.1234567890123456789.
5. Very long input digit strings that must be rounded to the nearest double: e.g. 3.141592653589793238462643383279, 0.1000000000000000055511151231257827. What is printed?
6. Subnormals and the extremes: 5e-324, 4.9e-324, 1e-323, 2.2250738585072011e-308, 1.7976931348623157e308.
7. Negative zero: --a -0.0 and --a -0 -> exactly what?
8. Values where the shortest repr has a trailing structure worth checking: 1e15, 1234567890123456.0, 12345678901234567.0, 123456789012345678.0.

Run at least 50 distinct values. Build a definitive table. Your rules must be precise enough that a JS implementer can reproduce every case.`,
  },
  {
    key: 'argparse-cli',
    prompt: `${COMMON}

AREA: The command-line argument parsing behavior (Python argparse), including every error path.

Determine precisely, capturing EXACT stdout, EXACT stderr (byte for byte, including the program name shown, capitalization, punctuation, and line breaks) and EXACT exit codes:
1. Success forms: --a 1.5 ; --a=1.5 ; is there an abbreviation like --a being the only long option (try -a, --A)? Is '--a' abbreviatable at all?
2. Missing required argument: run with NO arguments. Exact stderr + exit code.
3. --a with no value following it. Exact stderr + exit code.
4. Invalid float values: 'abc', '', ' ', '1/3', '0x10', '1,5', '--', 'None', 'null', 'true'. Exact stderr wording, especially the 'invalid float value:' message and how the offending value is quoted/repr'd (single quotes? what about a value containing a quote?).
5. NEGATIVE NUMBERS — this is critical. argparse has a special rule about values that look like negative numbers. Test: --a -1 ; --a -1.5 ; --a -0.001 ; --a -.5 ; --a -1. ; --a -1e5 ; --a -1E5 ; --a -inf ; --a -nan ; --a -Infinity ; --a -1_000 ; --a -1e309 ; --a=-1e5 ; --a=-inf ; --a " -1e5" (leading space). Figure out the EXACT pattern of which negative-looking strings are accepted as a value vs treated as an unknown option. Report the exact stderr for the rejected ones.
6. Extra/unknown arguments: --a 1.5 --b 2 ; --a 1.5 extra ; --a 1.5 -x. Exact stderr + exit code.
7. Repeated: --a 1 --a 2 -> which wins?
8. The '--' separator: --a -- 1.5 ; -- --a 1.5 ; --a 1.5 --.
9. -h and --help: exact full stdout text and exit code. Also -h combined with a missing required arg (does help win?).
10. Whitespace/format tolerance in the float value: ' 1.5 ', '\\t1.5\\n', '+1.5', '.5', '5.', '1_000.5', '1__0.5', '1_.5', 'infinity', 'INF', 'Inf', 'nan', 'NAN'. Which parse, and to what value (check the printed result)?

Report the exact program name string that appears in usage/error messages.`,
  },
  {
    key: 'error-paths',
    prompt: `${COMMON}

AREA: Runtime error paths after successful arg parsing — i.e. what canonicaljson does with special float values.

We already know 'nan' and 'inf' parse fine as floats but then the program exits with code 1 and a Python traceback.

Determine precisely:
1. For --a nan, --a inf, --a infinity, --a INF, --a Inf, --a NAN, --a Infinity, --a 1e309 (overflows to inf), --a -1e999 if you can get it past the parser (try --a=-1e999 or --a " -1e999" or other tricks): capture the COMPLETE, EXACT stderr traceback, byte for byte, every line, including blank lines and indentation. Show it with 'cat -A' or similar so trailing whitespace is visible, and also show it raw.
2. Confirm the exact exit code for these.
3. Confirm whether stdout is completely empty in these cases.
4. Identify the exact exception type and exact exception message text.
5. Does negative infinity produce a different message than positive infinity? Does NaN differ from Infinity? Try hard to get -inf through the parser (hint: '=' form or a leading space may help) and report the exact message.
6. Test whether any finite value ever errors. Try the extremes: 1.7976931348623157e308, -1.7976931348623157e308, 5e-324, -5e-324, 0.0, -0.0.

The goal is to reproduce these tracebacks EXACTLY in Node.js, so precision matters enormously. Report the traceback as a literal string with \\n markers made explicit.`,
  },
  {
    key: 'bytes-repr',
    prompt: `${COMMON}

AREA: The b'...' wrapper — Python's print() of a bytes object, i.e. repr(bytes).

The program prints the return value of canonicaljson.encode_canonical_json(), which is a bytes object, via print(). So the output is repr(bytes) + '\\n'.

Determine precisely:
1. Confirm the exact wrapper: is it b'...' with single quotes? Confirm there is exactly one trailing newline and nothing else. Use 'od -c' or 'xxd' on the output to prove the exact bytes, including whether the newline is \\n or \\r\\n.
2. Confirm no leading/trailing spaces.
3. For a normal value like --a 1.5, dump the exact bytes of stdout.
4. Since the payload for a float is always ASCII digits/'.'/'-'/'+'/'e', confirm no escaping or quote-switching ever occurs. Reason about whether any float input could produce a character needing escaping or a double-quote wrapper (Python uses b"..." if the content contains a single quote) — argue why or why not based on the float repr charset you observe.
5. Check exact stdout bytes for several values including a negative, an exponential, and a value with many digits.

Report the definitive output template as a format string.`,
  },
]

phase('Probe')
const probeResults = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Probe', schema: PROBE_SCHEMA })
))

const good = probeResults.filter(Boolean)
log(`Probes complete: ${good.length}/${PROBES.length}; ${good.reduce((n, r) => n + r.rules.length, 0)} rules, ${good.reduce((n, r) => n + r.rawObservations.length, 0)} raw observations`)

// Barrier is justified: the adversarial hunters need the full combined spec to know what is already covered.
const specDigest = good.map(r =>
  `## AREA: ${r.area}\n` +
  r.rules.map(x => `- [${x.confidence}] ${x.rule}\n    evidence: ${x.evidence}`).join('\n') +
  `\nGotchas for JS:\n` + r.gotchasForJS.map(g => `  - ${g}`).join('\n')
).join('\n\n')

phase('Adversarial')
const HUNT_SCHEMA = {
  type: 'object',
  properties: {
    missedCases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          argv: { type: 'string' },
          exitCode: { type: 'integer' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          whyItMatters: { type: 'string', description: 'which spec rule is wrong/incomplete, or how naive JS would get this wrong' },
          severity: { type: 'string', enum: ['breaks-port', 'edge-case', 'cosmetic'] },
        },
        required: ['argv', 'exitCode', 'stdout', 'stderr', 'whyItMatters', 'severity'],
      },
    },
    corrections: {
      type: 'array',
      description: 'Spec rules that are demonstrably WRONG, with the counter-example',
      items: {
        type: 'object',
        properties: { wrongRule: { type: 'string' }, correctRule: { type: 'string' }, counterExample: { type: 'string' } },
        required: ['wrongRule', 'correctRule', 'counterExample'],
      },
    },
  },
  required: ['missedCases', 'corrections'],
}

const LENSES = [
  { key: 'js-divergence', angle: `Your lens: JAVASCRIPT DIVERGENCE. You know JS deeply. Hunt for inputs where a competent-but-naive JS port (using Number(str) for parsing and String(n)/n.toString() for formatting) would produce output DIFFERENT from this executable. Think about: JS toString switching to exponential at >=1e21 and <1e-6 vs Python's thresholds; JS printing integral floats without '.0'; JS exponent format 'e-5'/'e+21' vs Python's zero-padded 2-digit 'e-05'; JS Number('') === 0, Number(' ') === 0, Number('0x10') === 16, Number('Infinity') === Infinity, Number('1_000') === NaN, JS accepting '0b101'/'0o17'/'Infinity' — and whether Python's float() agrees. Test each divergence hypothesis against the real executable and report the ground truth.` },
  { key: 'argparse-corners', angle: `Your lens: ARGPARSE INTERNALS. Hunt for obscure argparse behaviors: the negative-number-matcher regex boundary (which exact negative-looking strings become values vs options), '--a=' with empty value, '--a=-1', prefix matching, '-a' single dash, values starting with '--', a value that is exactly '-', a value that is exactly '--', multiple '--', interspersed unknowns, argument order, and the exact exit codes (2 vs 1) and exact stderr text for each. Also probe how the offending value is quoted in error messages when it contains a single quote, a double quote, a backslash, or a newline.` },
  { key: 'numeric-extremes', angle: `Your lens: FLOATING-POINT EXTREMES AND ROUNDING. Hunt for values where the printed digits reveal the exact float-to-string algorithm: halfway cases, subnormals, values needing 17 significant digits, values whose shortest repr is 1 digit, powers of two and ten, values just below/above the fixed-vs-exponential thresholds (9.999999999999999e15, 1.0000000000000001e16, 0.00009999999999999999, 0.0001), and very long input mantissas that must round-to-nearest-even. Also test overflow-to-infinity boundaries: 1.7976931348623158e308, 1.797693134862315808e308, and huge exponents.` },
]

const hunts = await parallel(LENSES.map(l => () =>
  agent(`${COMMON}

Here is a SPEC that other agents derived from probing this same executable:

${specDigest}

${l.angle}

Your job is adversarial: assume the spec above is INCOMPLETE or WRONG somewhere. Find concrete inputs, RUN THEM against the real executable, and report ground truth. Do not report a case unless you actually ran it and observed the output. Run at least 40 probes. Report only genuinely informative cases (things the spec does not already pin down, or that contradict it).`,
    { label: `hunt:${l.key}`, phase: 'Adversarial', effort: 'high', schema: HUNT_SCHEMA })
))

const h = hunts.filter(Boolean)
log(`Adversarial: ${h.reduce((n, x) => n + x.missedCases.length, 0)} missed cases, ${h.reduce((n, x) => n + x.corrections.length, 0)} corrections`)

return {
  spec: good,
  adversarial: h,
}
