export const meta = {
  name: 'moneyed-probe',
  description: 'Black-box probe of py-moneyed/babel executable behavior across dimensions, then adversarially verify each claim',
  phases: [
    { title: 'Probe', detail: 'parallel dimension probes against the executable' },
    { title: 'Verify', detail: 'adversarially re-test each claimed behavior' },
  ],
}

const PREAMBLE = `You are black-box reverse-engineering a PyInstaller executable at /workspace/dataset/test10_executable.

It wraps this Python source (/workspace/dataset/test10.py):
  import argparse
  from moneyed import Money
  parser = argparse.ArgumentParser()
  parser.add_argument('--amount', type=float, required=True)
  parser.add_argument('--currency', type=str, required=True)
  args = parser.parse_args()
  m = Money(args.amount, args.currency)
  print(str(m))

CRITICAL: you MUST set LANG=en_US.UTF-8 on every invocation or it crashes with a locale error. Example:
  LANG=en_US.UTF-8 /workspace/dataset/test10_executable --amount 624.98 --currency USD; echo "rc=$?"
Always capture stdout, stderr and the exit code SEPARATELY, e.g.:
  LANG=en_US.UTF-8 /workspace/dataset/test10_executable ARGS >/tmp/o 2>/tmp/e; echo rc=$?; echo "OUT:"; cat -A /tmp/o | head; echo "ERR:"; cat /tmp/e

Each run takes ~0.4s. Run MANY probes (50-200+); use bash loops. Do NOT use the 'python' command to inspect
the library — treat it as a pure black box (you may use python3 only as a local scratch calculator for your own
arithmetic reasoning about what Python semantics would be, never to import moneyed/babel).

The goal is a faithful Node.js reimplementation, so report EXACT strings (bytes, spaces, unicode codepoints).`;

const DIMENSIONS = [
  {
    key: 'argparse',
    prompt: `${PREAMBLE}

YOUR DIMENSION: command-line argument parsing semantics (Python argparse).
Determine exactly, by experiment:
- exit codes for: success, missing --amount, missing --currency, missing both, unknown flag, bad float value.
- the EXACT usage/error text emitted, and whether it goes to stdout or stderr. Reproduce the exact strings including
  the program name ("test10_executable"), line breaks, and trailing newline presence.
- "--amount=5" vs "--amount 5"; "--currency=USD".
- prefix abbreviations: --am, --amo, --a, --c, --cur. Which are accepted/ambiguous? What is the error for ambiguous?
- negative number handling: "--amount -5", "--amount -5.5", "--amount=-5". Does argparse accept a bare negative
  value after --amount (the parser has no numeric-looking options, so it should)? Test "--amount -inf" too.
- repeated flags ("--amount 1 --amount 2") - last wins?
- the "--" separator; extra positional args; empty string values; arg order swapped.
- "-h" and "--help": exact output text and exit code.
- what happens with no args at all.
Report a precise, complete spec of the parser behavior with exact literal strings (use cat -A or od -c where
whitespace matters). Include the exact wording of every error message you can trigger.`,
  },
  {
    key: 'floatparse',
    prompt: `${PREAMBLE}

YOUR DIMENSION: how the string passed to --amount is converted to a float (Python's float() via argparse type=float),
and how invalid values are reported.
Test acceptance/rejection AND the resulting formatted output for at least:
  "5", "5.", ".5", "+5", "-5", "  5  " (leading/trailing spaces/tabs/newlines), "1_000", "1_000.5", "1_0_0",
  "_5", "5_", "1__0", "1e3", "1E3", "1e+3", "1e-3", "1.5e2", "1e", "e5", "inf", "Inf", "INF", "infinity",
  "Infinity", "-inf", "+inf", "nan", "NaN", "-nan", "0x10", "0b1", "1,000", "", " ", "5 5", unicode digits
  like "٥" (Arabic-Indic five, U+0665) and "５" (fullwidth), "1e400" (overflow to inf?), "1e-400" (underflow to 0?),
  a 400-digit number, "0.1", "0.30000000000000004".
For each: does it exit 0 (and with what stdout) or exit non-zero (and with what exact stderr message)?
Pay special attention to the EXACT format of the invalid-value error, including how the offending string is quoted
(Python repr rules: which quote char is used when the value contains a quote, how non-ASCII/control chars appear).
Test values containing a single quote, a double quote, a backslash, and a newline.
Also: determine whether Money() uses the exact decimal digits of Python's repr(float) - e.g. compare the output for
--amount 0.1 --currency XXX at high-precision currencies (CLF has 4 decimal digits) and for values like
2.675, 1.005, 8.835, 0.615 in USD, which distinguish "exact binary double value" from "shortest repr string".
State your conclusion clearly: is the Decimal built from str(float) (shortest round-trip repr) or from the exact
binary value of the double? Give the decisive experiments.`,
  },
  {
    key: 'rounding',
    prompt: `${PREAMBLE}

YOUR DIMENSION: numeric rounding, quantization and the digit-grouping of the formatted output.
Determine:
- the rounding mode used when the value has more decimals than the currency allows. Test .5 ties extensively in
  USD (2 digits): 0.005 0.015 0.025 0.035 0.045 0.055 0.065 0.075 0.085 0.095 0.125 0.135 1.005 2.675 and
  in JPY (0 digits): 0.5 1.5 2.5 3.5 4.5 -0.5 -1.5 -2.5 and in KWD (3 digits) and CLF (4 digits).
  Confirm whether it is ROUND_HALF_EVEN (banker's) or ROUND_HALF_UP, being careful that the tie must be an EXACT
  decimal tie (e.g. 0.015 as a decimal string is an exact tie; as a binary double it is slightly below).
- negative values: exact sign placement for all magnitudes; -0.0 and tiny negatives like -0.001 -> is it "-$0.00"?
- thousands grouping: verify group size 3 for 1000, 10000, 1e6, 1e9, 1e15, 1e18, 1e20, 1e24, 1e25 (USD). Is
  there any special "minimum grouping digits" behavior (i.e. is 1000 grouped as "1,000" or "1000")?
- the maximum magnitude before it throws decimal.InvalidOperation. Binary-search the exact threshold for USD
  (2 decimals), JPY (0 decimals), KWD (3 decimals) and CLF (4 decimals) using values like 1e24..1e30 and also
  values with many significant digits. Formulate the exact rule in terms of total digit count (hypothesis: the
  quantized result must fit within decimal context precision 28). Verify with e.g. 9999999999999999999999999.99.
  Report the exact exit code and stderr for the failure.
- inf / -inf / nan / -nan formatting in USD, JPY, XXX and a 4-digit currency (CLF). Report the exact unicode
  characters used (run the output through 'od -c' or 'hexdump -C').
- very small values: 1e-7, 1e-30, -1e-30.
Report a precise rule set that a reimplementation can follow.`,
  },
  {
    key: 'pattern',
    prompt: `${PREAMBLE}

YOUR DIMENSION: the currency display pattern and symbol placement for the en_US locale.
Determine:
- Is the currency symbol always a PREFIX, or are there currencies where it is a suffix or separated by a space
  (breaking space vs non-breaking space U+00A0 vs narrow no-break space U+202F)? Probe a WIDE range of currency
  codes (at least: USD EUR GBP JPY CHF CNY CAD AUD SEK NOK DKK PLN RUB INR BRL MXN ZAR KRW TRY THB ILS PHP VND
  NGN GHS XCD XOF XAF XPF BTN BYN BYR MRO MRU MGA STD STN VEF VES ZWL ZWD CLF CLP KWD BHD OMR JOD TND IQD LYD
  UGX ISK HUF TWD SGD HKD NZD CZK RON BGN HRK UAH KZT AED SAR QAR EGP MAD DZD ARS COP PEN UYU BOB PYG CRC GTQ
  HNL NIO DOP JMD TTD BBD BSD BZD CUP CUC XXX XAU XAG XPT XPD XDR XTS XUA XBA XBB XBC XBD YER AFN AMD AZN GEL
  KGS TJS TMT UZS MNT MMK KHR LAK NPR PKR LKR BDT MVR SCR MUR KES TZS RWF BIF DJF ETB SOS SDG SSP ERN CVE GMD
  GNF LRD SLL SLE STN CDF AOA MZN ZMW MWK BWP NAD SZL LSL) and for each report the exact rendered output for
  amount 1234.56789 and for -1234.56789, using 'od -c' on any output containing a non-ASCII byte so the exact
  codepoints are unambiguous.
- Any currency whose output contains a space or unusual separator - list them ALL explicitly with codepoints.
- The decimal separator and grouping separator characters (should be "." and ","), verified via od -c.
- Whether the negative pattern is always "-" + positive form, or if any currency uses parentheses/other.
Report a table and an explicit rule.`,
  },
  {
    key: 'errors',
    prompt: `${PREAMBLE}

YOUR DIMENSION: error/exception paths and the exact process behavior.
Determine, with exact stdout/stderr separation and exit codes:
- Unknown/invalid currency code: try "FOO", "", "US", "USDD", " USD ", "usd", "Usd", "uSd", "u$d", "123", "ABC",
  "XYZ", "US1", a code with a newline, a code with unicode. Report the EXACT exception type and message line, e.g.
  "moneyed.classes.CurrencyDoesNotExist: No currency with code FOO is defined." and how the offending code appears
  (raw? repr? uppercased?). Determine definitively whether the input is uppercased before lookup (does "usd" work?
  does "usd" and "USD" produce identical output?) and whether whitespace is stripped (it should NOT be).
- The full traceback shape written to stderr for (a) unknown currency and (b) decimal.InvalidOperation from a huge
  amount. Note that the PyInstaller "[PYI-nnn:ERROR] Failed to execute script 'test10' due to unhandled exception!"
  line has a varying number - report the surrounding lines exactly.
- Does anything get printed to stdout in the failure cases? Is stdout empty?
- Confirm the success case writes exactly the formatted string plus a single trailing newline "\\n" (verify with od -c).
- Test currency codes that are 3 chars but contain digits, e.g. "US1", "1US", "111" - are any valid?
Report exact strings and exit codes.`,
  },
]

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'summary', 'rules', 'claims'],
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string', description: 'Prose summary of everything learned in this dimension' },
    rules: {
      type: 'array',
      description: 'Implementable rules, each precise enough to code from directly',
      items: { type: 'string' },
    },
    claims: {
      type: 'array',
      description: 'Individually checkable factual claims, each with the exact command and observed result',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'command', 'observed'],
        properties: {
          claim: { type: 'string' },
          command: { type: 'string', description: 'exact shell command (including LANG=en_US.UTF-8)' },
          observed: { type: 'string', description: 'exact stdout/stderr/exit code observed' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['confirmed', 'note'],
  properties: {
    confirmed: { type: 'boolean' },
    note: { type: 'string', description: 'If not confirmed, what the truth actually is, with the command and real output' },
  },
}

phase('Probe')

const results = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: FINDINGS, effort: 'high' }),
  async (found, d) => {
    if (!found) return null
    // Adversarially re-verify a sample of the riskiest claims for this dimension.
    const toCheck = found.claims.slice(0, 14)
    const verdicts = await parallel(
      toCheck.map((c, i) => () =>
        agent(
          `You are an adversarial fact-checker for a black-box reverse-engineering effort.

CRITICAL: every invocation of /workspace/dataset/test10_executable MUST be prefixed with LANG=en_US.UTF-8.

Someone claims the following about that executable:
  CLAIM: ${c.claim}
  They say they ran: ${c.command}
  They say they observed: ${c.observed}

Actually RUN that command yourself (and any variations needed to be sure - check stdout vs stderr separately and
the exit code, and use 'od -c' if exact bytes matter). Decide whether the claim is TRUE as stated.
Be skeptical: default to confirmed=false if the observed output differs in ANY detail (whitespace, exit code,
which stream, exact characters). If it is false, state precisely what the real behavior is.`,
          { label: `verify:${d.key}#${i}`, phase: 'Verify', schema: VERDICT, effort: 'low' }
        ).then((v) => ({ claim: c.claim, command: c.command, ...(v || { confirmed: false, note: 'verifier died' }) }))
      )
    )
    const bad = verdicts.filter(Boolean).filter((v) => !v.confirmed)
    log(`${d.key}: ${bad.length}/${verdicts.length} claims refuted`)
    return { dimension: d.key, summary: found.summary, rules: found.rules, refuted: bad }
  }
)

return results.filter(Boolean)
