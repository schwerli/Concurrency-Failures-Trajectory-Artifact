export const meta = {
  name: 'moneyed-probe',
  description: 'Black-box probe py-moneyed/babel behavior for the test19 executable, then synthesize a JS-implementable spec',
  phases: [
    { title: 'Probe', detail: 'parallel agents, one per behavioral dimension' },
    { title: 'Verify', detail: 'adversarially re-test each claimed rule' },
    { title: 'Spec', detail: 'merge into one implementation spec' },
  ],
}

const EXE = '/workspace/dataset/test19_executable'

const PREAMBLE = `
You are black-box probing a PyInstaller-frozen Python program to reverse-engineer its exact behavior
so it can be reimplemented in pure JavaScript (Node ESM, no external deps, no Intl.NumberFormat, no BigInt).

The Python source is:
\`\`\`python
import argparse
from moneyed import Money
parser = argparse.ArgumentParser()
parser.add_argument('--amount1', type=float, required=True)
parser.add_argument('--amount2', type=float, required=True)
parser.add_argument('--currency', type=str, required=True)
args = parser.parse_args()
m1 = Money(args.amount1, args.currency)
m2 = Money(args.amount2, args.currency)
if m1 < m2:
    smaller = m1
else:
    smaller = m2
print(smaller)
\`\`\`

HOW TO RUN IT (critical):
  LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 ${EXE} --amount1 <A> --amount2 <B> --currency <C>
The LANG/LC_ALL env vars are MANDATORY: babel reads them and crashes without them. Always set them.
Always capture BOTH stdout and stderr AND the exact exit code, e.g.:
  out=$(LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 ${EXE} --amount1 1 --amount2 2 --currency USD 2>/tmp/err); rc=$?
Do NOT pipe directly into tail/head when you need the exit code (that gives you the pipe's exit code).

RULES:
- NEVER run \`python\`/\`python3\` to inspect moneyed or babel. Black box only. (python3 exists but the
  moneyed/babel libs are NOT installed outside the frozen binary; and it is disallowed anyway.)
- Each executable run costs ~0.4s. A large 17k-code sweep is ALREADY RUNNING on 56 cores elsewhere,
  so the machine is busy. Keep yourself under ~200 invocations and use at most \`xargs -P 4\`.
- Be empirical. Every rule you state must be backed by a command you actually ran and its literal output.
- Use \`od -c\` or \`hexdump -C\` when whitespace / unicode bytes matter.
- Report EXACT byte-level output including whether there is a trailing newline.

Return findings as structured data. Be precise and exhaustive within your dimension. Do not speculate
without labelling it as unverified.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string', description: 'Precise, implementable statement of the behavior' },
          evidence: { type: 'string', description: 'The literal command(s) run and their literal output' },
          confidence: { type: 'string', enum: ['certain', 'likely', 'unverified'] },
          jsNote: { type: 'string', description: 'How JS differs / what the JS implementation must do' },
        },
        required: ['rule', 'evidence', 'confidence'],
      },
    },
    surprises: { type: 'array', items: { type: 'string' }, description: 'Anything counterintuitive an implementer would get wrong' },
  },
  required: ['dimension', 'rules'],
}

const DIMENSIONS = [
  {
    key: 'rounding',
    prompt: `${PREAMBLE}

DIMENSION: NUMERIC ROUNDING AND QUANTIZATION.

Established already (re-verify): with USD (2 decimals),
  2.345 -> $2.34 ; 2.355 -> $2.36 ; 1.005 -> $1.00
That looks like ROUND_HALF_EVEN applied to the EXACT DECIMAL value of the shortest repr of the float,
NOT to the binary float value. (Binary 2.355 is 2.35499999... which would round to 2.35, but we saw 2.36.)

Your job: nail the rounding rule beyond doubt.
1. Test many halfway cases in 2-decimal currency (USD): x.xx5 values where the shortest decimal repr is
   exactly a tie. Cover both "round down to even" and "round up to even" cases:
   e.g. 0.125, 0.135, 0.145, 0.155, 2.675, 1.115, 1.125, 8.885, 0.005, 0.015, 0.025, 0.035.
   For each, record output. Determine: HALF_EVEN vs HALF_UP vs HALF_DOWN vs binary-float-truncation.
2. CRITICAL DISAMBIGUATION: find values where "Decimal(str(float))" and "Decimal(float_exact_binary)"
   give DIFFERENT rounded results, and report which one the program follows. Classic examples: 2.675
   (binary = 2.67499999999999982...; half-even on exact decimal 2.675 -> 2.68; on binary -> 2.67).
   Also 1.005, 8.835, 0.145, 1.115, 2.675, 1.265.
3. Test 0-decimal currencies (JPY) with .5 ties: 0.5, 1.5, 2.5, 3.5, 1234.5, 2.4, 2.6.
4. Test 3-decimal currencies (try BHD, KWD, JOD, OMR, TND, IQD, LYD) with 4-decimal ties:
   1.0005, 1.0015, 1.0025, 2.3455.
5. Test whether a 4-decimal currency exists (try CLF, UYW) and how it formats.
6. Does the output ever show MORE decimals than the currency's standard digits? Try 1.23456789 in USD.
7. Does it ever show FEWER (i.e. trailing zeros trimmed)? Try 1.5, 2.0, 100 in USD.

Report the definitive rounding algorithm as a step-by-step recipe implementable with string/integer math
in JS (no BigInt allowed - note that constraint but you don't have to solve it).`,
  },
  {
    key: 'floatstr',
    prompt: `${PREAMBLE}

DIMENSION: FLOAT PARSING AND FLOAT -> DECIMAL-STRING CONVERSION (the argparse type=float step, and
Money's internal float->Decimal conversion).

py-moneyed's Money(float, code) converts via Decimal(str(amount)) (believed). Python's str(float) is the
shortest round-tripping repr, but its scientific-notation THRESHOLDS DIFFER FROM JAVASCRIPT:
  Python: str() uses exponent form when exp < -4 or exp >= 16.  str(1e16)='1e+16', str(1e15)='1000000000000000.0', str(0.0001)='0.0001', str(0.00001)='1e-05'
  JS:     String() uses exponent form when exp < -6 or exp >= 21. String(1e16)='10000000000000000'
This matters ONLY if the conversion path is str()-based AND the exponent form changes the rounded result.

Investigate:
1. HUGE values. Test amounts like 1e15, 1e16, 1e17, 1e20, 1e21, 1e22, 123456789012345678, 1e30, 1e100,
   9007199254740993, 12345678901234567890. What EXACTLY is printed? Does the grouping continue?
   Is there any scientific notation in the OUTPUT? Does it error?
2. TINY values. 1e-5, 1e-7, 0.00001, 1e-300, 5e-324. Output?
3. Special float literals accepted by Python's float(): 'inf', '-inf', 'Infinity', '-Infinity', 'nan',
   'NaN', 'infinity'. Are they accepted by argparse? What does the program then print / how does it
   crash (exact stderr + exit code)?
4. Other Python float() accepted forms: '1_000.5' (underscores), '  1.5  ' (whitespace), '+1.5', '.5',
   '5.', '1e5', '1E5', '1e+5', '0x1p3' (should fail), '1,5' (should fail), '' (empty).
   Record which are ACCEPTED and the resulting output, and which are REJECTED with what message/exit code.
5. Negative zero: --amount1 -0.0 --amount2 -0.0. And -0.0 vs 0.0. What prints?
   IMPORTANT: a leading-dash value may be parsed by argparse as an option. Test both
   \`--amount1 -0.0\` and \`--amount1=-0.0\` and report the difference.
6. Values needing 17 significant digits: 0.1, 0.3, 2.675, 1e23 (Python str(1e23)='1e+23' and the exact
   double is 99999999999999991611392). Print 1e23 in USD and report EXACTLY what digits appear - this
   single test tells you whether the pipeline is str()-based (would give 100000000000000000000000.00)
   or exact-binary-based (99999999999999991611392.00). THIS IS THE MOST IMPORTANT TEST IN YOUR DIMENSION.
   Also test 1e22, 4.35, 1e16+2.

Report exactly how to reproduce the float->decimal-digits step in JS.`,
  },
  {
    key: 'argparse',
    prompt: `${PREAMBLE}

DIMENSION: COMMAND-LINE ARGUMENT PARSING (Python argparse emulation).

The JS reimplementation must parse process.argv by hand and behave identically. Map out argparse's
behavior for THIS parser (3 required options, all with type given, prog name is the executable basename).

Test and record EXACT stdout/stderr text (byte for byte, including line wrapping!) and EXACT exit codes:
1. All three args present, in various ORDERS. Confirm order doesn't matter.
2. \`--amount1=5\` equals-sign form. Mixed forms.
3. UNIQUE-PREFIX ABBREVIATION (argparse allows this by default): --amount1 can be abbreviated?
   Test --curr, --c, --amount (ambiguous between amount1/amount2!), --amount1, --am, --cu, --h, --he.
   Record the exact "ambiguous option" error text and exit code.
4. Missing one / two / all three required args - exact error text and ordering of names in the message.
5. -h and --help: exact full text and exit code. Note the usage line WRAPS - reproduce the wrapping exactly.
6. Unknown option: --foo bar. Exact error.
7. Extra positional argument: \`--amount1 1 --amount2 2 --currency USD extra\`. Exact error.
8. Option given twice: \`--amount1 1 --amount1 3 --amount2 2 --currency USD\`. Which wins?
9. Missing VALUE for an option: \`--amount1 --amount2 2 --currency USD\` and \`--currency\` at the end.
10. Invalid float value: \`--amount1 abc\`. Exact error message text.
11. \`--\` separator handling: \`-- --amount1 1 ...\`.
12. What is the prog name shown in usage/errors? Confirm it is exactly "test19_executable".
    NOTE: the JS file will be named test19.mjs - report what prog name argparse derives (basename of
    sys.argv[0]) so I can decide what the JS should print.
13. Empty string values: \`--currency ""\`, \`--amount1 ""\`.
14. A currency value that looks like an option: \`--currency -USD\` vs \`--currency=-USD\`.

Give me a precise algorithm for the JS hand-rolled parser.`,
  },
  {
    key: 'compare',
    prompt: `${PREAMBLE}

DIMENSION: MONEY COMPARISON SEMANTICS (the \`if m1 < m2\` branch) AND TIE BEHAVIOR.

The script picks m1 if m1 < m2 else m2. Since both use the same currency, comparison is on amount.
But the amounts are the UNROUNDED Decimal values, while the OUTPUT is rounded. That means the choice
can be made on more precision than is displayed.

Investigate:
1. Equal amounts -> which one is chosen? (Indistinguishable in output unless... they format the same,
   so verify by using values that ROUND the same but differ, e.g. --amount1 2.344 --amount2 2.341 in USD:
   both print $2.34, so instead use values that differ in the DISPLAYED output to prove the selection.)
   Design tests that prove the comparison uses the FULL precision, not the rounded value. Example:
   --amount1 1.0000001 --amount2 1.0000002 (both -> $1.00, uninformative) --
   better: prove ordering with clearly distinct values, then probe near-ties like
   --amount1 0.145 --amount2 0.1450000001 in USD -> if the SMALLER (0.145) is chosen it prints its own
   rounding; compare against swapping the two. Report whether comparison is on raw decimal.
2. Negative vs positive, negative vs negative. -5 vs -10. -0.0 vs 0.0 (use = form for negatives).
3. Very close doubles: 0.1+0.2 style. Try --amount1 0.30000000000000004 --amount2 0.3.
4. inf / -inf / nan comparisons IF the earlier dimension found they're accepted. nan < x is False in
   Python -> smaller would be m2. Verify what actually happens (may crash in formatting instead).
5. Large magnitude comparisons: 1e300 vs 1e301.
6. Does Money comparison raise on anything here? (Same currency both times, so probably not.)

Also confirm: is there EXACTLY one trailing newline on stdout? Use \`od -c\`. And confirm stdout encoding
is UTF-8 for the symbol bytes (e.g. EUR sign = e2 82 ac).`,
  },
  {
    key: 'currency-arg',
    prompt: `${PREAMBLE}

DIMENSION: THE --currency ARGUMENT: normalization, validation, and error paths.

Known: 'usd' (lowercase) works and prints as USD. 'XYZ' and 'BTC' raise CurrencyDoesNotExist with a
traceback on stderr and exit code 1.

Investigate exhaustively:
1. Case handling: 'usd', 'Usd', 'uSd', 'USD'. All equivalent?
2. Whitespace: ' USD', 'USD ', ' USD '. Accepted or error?
3. Empty string: --currency "". Exact error and exit code.
4. Numeric ISO codes: '840', '978', '392'. Accepted? (py-moneyed sometimes indexes by numeric code.)
   Test '840' and '036' and '4'.
5. Non-3-letter: 'US', 'USDD', 'U'.
6. Unicode / weird: 'ÜSD', 'US$'.
7. The XXX code: confirm it prints the generic currency sign (U+00A4). Also try XTS, XAU, XAG, XPT,
   XPD, XDR, XUA, XBA..XBD, XSU, XPF, XOF, XAF.
8. Get the EXACT stderr text for the CurrencyDoesNotExist path, byte for byte, with the exact traceback
   lines. Note the \`[PYI-NNN:ERROR]\` line has a VARYING number (it's the PID) - confirm that.
   Report exactly what the JS should emit (and note the PID varies so byte-exactness is impossible there).
9. Exit code for the CurrencyDoesNotExist path.
10. Does argparse's type=str do any stripping? (No, but verify with a value containing a tab.)

Report the normalization algorithm (e.g. \`code.upper()\`) and the validation/error behavior.
IMPORTANT for case-folding: test a Unicode edge case if cheap, e.g. --currency 'ｕｓｄ' (fullwidth) or
'usd' with a Turkish dotless i is irrelevant; but DO test whether Python's .upper() vs JS toUpperCase()
could differ. Low priority.`,
  },
  {
    key: 'format-shape',
    prompt: `${PREAMBLE}

DIMENSION: THE OUTPUT STRING SHAPE for locale en_US (babel format_currency, default format).

Known samples (verify): USD 1234.5 -> \`$1,234.50\`; EUR -> \`€1,234.50\`; CAD -> \`CA$1,234.50\`;
JPY 1234.56 -> \`¥1,235\`; XXX -> \`¤1,234.50\`; negative USD -5.5 -> \`-$5.50\`.

Investigate the FULL pattern:
1. GROUPING: is it always groups of 3? Test 1234.5, 12345.5, 123456.5, 1234567.5, 1234567890.5,
   and 4-digit-only 1000 / 9999. Confirm the group separator is ',' (U+002C) and decimal '.' (U+002E)
   via od -c. Is there a minimum-grouping-digits rule (some locales don't group 4-digit numbers)?
2. NEGATIVE FORMAT: is it \`-$5.50\` or \`($5.50)\`? Test -0.5, -1234.5, -1000000. Confirm the minus
   character byte (ASCII hyphen U+002D vs U+2212). Use od -c. Use \`--amount1=-1234.5\` form.
3. NEGATIVE ZERO OUTPUT: does -0.001 in USD print \`-$0.00\` or \`$0.00\`? Test -0.001, -0.004, -0.0.
   This is a classic edge case. Use the = form for negatives.
4. ZERO: 0 -> \`$0.00\`. And 0 in JPY -> \`¥0\`.
5. Is there EVER a space between symbol and number in en_US? Test currencies whose symbol is alphabetic
   like CHF, SEK, NOK, DKK, PLN, CZK, HUF, RON, TRY, RUB, ZAR, NGN, THB, SGD, MYR, IDR, AED, SAR.
   Report exact bytes (od -c) for at least CHF and SEK - look for NBSP (c2 a0) or narrow-NBSP (e2 80 af).
6. Symbols with multiple codepoints: CAD 'CA$', CNY 'CN¥', XAF 'FCFA', XOF 'F CFA'?, XPF 'CFPF'?, TWD 'NT$'.
   Dump bytes for XOF and XPF specifically - they may contain non-ASCII spaces.
7. Very large numbers: does babel ever switch to compact/scientific? Test 1e20, 1e25 in USD.
8. Confirm there is no currency-code suffix and no space padding anywhere.

For every currency you test, give me the exact symbol string as a JS string literal with \\u escapes for
any non-ASCII codepoint. Precision here matters more than breadth - another agent is enumerating all codes.`,
  },
]

phase('Probe')

const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: FINDINGS_SCHEMA, effort: 'high' }),
  (findings, d) => {
    if (!findings) return null
    // adversarially re-test the rules this probe claimed
    return agent(`${PREAMBLE}

DIMENSION UNDER AUDIT: ${d.key}

Another agent probed this dimension and produced the claims below. Your job is to REFUTE them.
Independently re-run the decisive commands yourself. Assume each claim is wrong until your own
command output proves it. Pay special attention to:
  - claims marked 'likely' or 'unverified'
  - any claim about exact bytes, whitespace, or exit codes that was not backed by od -c / explicit $?
  - off-by-one and boundary values the original agent did not test
  - rules stated too generally from too few samples

CLAIMS:
${JSON.stringify(findings, null, 2)}

Keep yourself under ~120 executable invocations (the machine is busy).

Return the CORRECTED, verified rule set in the same schema. For each rule either confirm it (keep it,
confidence 'certain', evidence = YOUR command output) or correct/delete it. Add any rule the original
agent missed. In 'surprises', list specifically what the original agent got WRONG.`,
      { label: `verify:${d.key}`, phase: 'Verify', schema: FINDINGS_SCHEMA, effort: 'high' })
  }
)

phase('Spec')

const verified = results.filter(Boolean)
log(`${verified.length}/${DIMENSIONS.length} dimensions verified`)

const spec = await agent(`You are writing the authoritative implementation spec for a Python->JavaScript port.

TARGET: reimplement this Python program in pure Node.js ESM, zero dependencies, no Intl.NumberFormat,
no BigInt, split into hierarchical .mjs library modules plus an entry file test19.mjs.

\`\`\`python
import argparse
from moneyed import Money
parser = argparse.ArgumentParser()
parser.add_argument('--amount1', type=float, required=True)
parser.add_argument('--amount2', type=float, required=True)
parser.add_argument('--currency', type=str, required=True)
args = parser.parse_args()
m1 = Money(args.amount1, args.currency)
m2 = Money(args.amount2, args.currency)
if m1 < m2: smaller = m1
else: smaller = m2
print(smaller)
\`\`\`

Below are SIX independently probed-and-adversarially-verified behavioral rule sets.

${JSON.stringify(verified, null, 2)}

Write a single coherent implementation spec covering, in order:
1. Argument parsing algorithm (exact, including abbreviation, = form, error text, exit codes).
2. Python float() parsing rules for the string -> double step (which literals are valid).
3. The double -> exact decimal digit string step, and how to do it in JS WITHOUT BigInt.
   Be concrete: recommend a specific technique (e.g. decimal string arithmetic on digit arrays, or
   Number.prototype.toFixed limitations, or manual repr) and state its correctness boundaries.
4. The rounding/quantization step (exact algorithm, tie rule, per-currency digit count).
5. The formatting step (grouping, separators, sign placement, symbol placement).
6. The comparison step.
7. Error paths and exit codes.
8. A list of the highest-risk edge cases the implementer must get right, each with the expected output.

Where the six rule sets CONFLICT with each other, say so explicitly and flag it for me to re-test.
Be concrete and implementable. This spec is read by an engineer, not a user.`,
  { label: 'synthesize-spec', phase: 'Spec', effort: 'high' })

return { spec, verified }
