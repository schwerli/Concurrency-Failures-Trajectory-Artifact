export const meta = {
  name: 'moneyed-breakit',
  description: 'Adversarially hunt for inputs where the JS port diverges from the reference binary, verify each, and audit the code',
  phases: [
    { title: 'Hunt', detail: 'independent agents each attack a different surface' },
    { title: 'Confirm', detail: 're-run each claimed divergence in isolation' },
    { title: 'Audit', detail: 'static review of the port against the constraints' },
  ],
}

const PREAMBLE = `
There is a JavaScript (Node ESM) port of a Python program. Your job is to BREAK IT:
find any input where the port's behavior differs from the reference Python binary.

REFERENCE (Python, PyInstaller-frozen):
  LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 /workspace/dataset/test19_executable <args>
PORT (JavaScript):
  LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 node /output/test19.mjs <args>

The LANG/LC_ALL env vars are MANDATORY for the reference (babel crashes without them).
Pass the SAME argv to both. Compare stdout, stderr, AND exit code.

The one known-unreproducible difference, which you must NORMALISE AWAY and NOT report:
the reference's final stderr line is \`[PYI-<pid>:ERROR] Failed to execute script 'test19' ...\`
where <pid> is the OS process id. Replace /\\[PYI-\\d+:ERROR\\]/ with a constant on both sides
before comparing. Everything else — including the whole traceback body — must match byte for byte.

The original Python source:
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

WRITE A COMPARISON HARNESS rather than eyeballing. Suggested shape (use YOUR OWN uniquely-named
private directory under /tmp — other agents are running concurrently and generic filenames
like /tmp/run.sh WILL be clobbered):

  // compare.mjs — run with: node compare.mjs
  import { execFile } from 'node:child_process';
  const ENV = {...process.env, LANG:'en_US.UTF-8', LC_ALL:'en_US.UTF-8'};
  const run = (cmd, argv) => new Promise(res => execFile(cmd, argv, {env: ENV, encoding:'buffer'},
    (e, so, se) => res({code: e ? (e.code ?? 0) : 0, out: so.toString(), err: se.toString()
      .replace(/\\[PYI-\\d+:ERROR\\]/g, '[PYI]')})));
  // for each case: compare run('/workspace/dataset/test19_executable', argv)
  //                    vs run(process.execPath, ['/output/test19.mjs', ...argv])

NOTES / CONSTRAINTS:
- Each reference invocation costs ~0.4s. Run cases CONCURRENTLY (a pool of ~8) and keep your
  total under ~1500 reference invocations.
- argv cannot contain NUL bytes (execve forbids it) — skip those, they are not a real divergence.
- Do NOT run \`python\`/\`python3\` against moneyed/babel; they are not installed outside the binary.
- You MAY read the port's source at /output/**.mjs to find weak spots to attack — this is
  white-box fuzzing and that is encouraged.

ALREADY TESTED — 11,715 cases across these areas all pass, so do not just redo them:
  every one of the 308 valid currency codes at several magnitudes; half-even tie cases at
  0/2/3/4 fraction digits in both signs; the 28-significant-digit quantize ceiling at each
  fraction-digit count; signed zero and its tie direction; inf/-inf/nan; argparse abbreviation
  and ambiguity (including the whole-argv pre-pass); -h bundling (-hx, -h=x, -h-x, --help=);
  the \`--\` separator; unrecognized-argument and required-argument precedence; Python float()
  acceptance including PEP 515 underscores, Unicode Nd digits and Unicode whitespace folding;
  repr() quoting and escaping; 6,000 randomly generated amount pairs.

GO DEEPER OR SIDEWAYS FROM THAT LIST. Report every genuine divergence you find with the exact
argv, both outputs, and both exit codes. If you find none, say so plainly and describe what you
attacked — a clean report is a valid result, do NOT invent findings.
`

const FINDINGS = {
  type: 'object',
  properties: {
    surface: { type: 'string' },
    invocationsRun: { type: 'number' },
    attacked: { type: 'string', description: 'What you actually tried, concretely' },
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          argvEscaped: { type: 'string', description: 'argv as a copy-pasteable shell command' },
          python: { type: 'string', description: 'exact stdout|stderr|exit of the reference' },
          javascript: { type: 'string', description: 'exact stdout|stderr|exit of the port' },
          rootCause: { type: 'string', description: 'which file/line in /output causes it' },
        },
        required: ['argv', 'python', 'javascript'],
      },
    },
  },
  required: ['surface', 'divergences', 'attacked'],
}

const SURFACES = [
  {
    key: 'numeric-fuzz',
    prompt: `${PREAMBLE}

SURFACE: NUMERIC FUZZING AT SCALE.

Generate a few hundred *adversarially chosen* amount values, not uniform randoms. Target:
- values whose shortest round-trip repr in JS vs Python might differ in FORM (JS switches to
  exponent notation at 1e21 and 1e-7; Python at 1e16 and 1e-5). Concentrate hard on 1e15..1e22
  and 1e-4..1e-8, with many mantissas. Read /output/lib/decimal.mjs decimalFromNumber to see
  how the port parses String(x) and try to make that regex fail or mis-scale.
- values with exactly 17 significant digits, and denormals (5e-324, 1e-310).
- values right at the 28-digit quantize ceiling where ROUNDING CARRIES into a new digit
  (e.g. a value that is 27 digits before rounding and 28 after, or 28 before and 29 after) —
  for USD, JPY, BHD and CLF. This is the highest-value attack in your surface.
- exact ties (…5 as the last significant digit) at many magnitudes and both signs.
- values where the two amounts are extremely close so the comparison decides on low-order digits.
Report divergences.`,
  },
  {
    key: 'argparse-fuzz',
    prompt: `${PREAMBLE}

SURFACE: ARGUMENT-PARSING FUZZING.

Read /output/lib/argparse.mjs and /output/lib/help_formatter.mjs, then attack them. Ideas:
- Combinations not yet covered: an ambiguous prefix AFTER a \`--\`; \`--\` as an option VALUE
  (\`--currency -- USD\`, \`--amount1 -- 5\`); \`=\` inside values; repeated \`--\`.
- Tokens that are prefixes of each other in odd ways: \`--currenc\`, \`--currencyy\`, \`--CURRENCY\`,
  \`--=\`, \`--\`, \`-\`, \`--=x\`, \`-=x\`, \`--amount1=\` (empty value).
- Single-dash forms: \`-a\`, \`-amount1\`, \`-h\` combined with everything, \`-\` alone, \`--h=\`.
- COLUMNS env var set to small and large values (40, 60, 100, 200) with --help and with an
  error — does the port's usage wrapping track the reference? Test COLUMNS=40,50,60,70,79,80,81,120.
  NOTE: pass COLUMNS explicitly in the env for BOTH processes so the comparison is fair.
- Very long values and very many extra arguments (does the unrecognized-arguments line match?).
- Values that look like options but contain spaces, tabs, or newlines.
- Order permutations mixed with abbreviations and the equals form.
Report divergences.`,
  },
  {
    key: 'unicode-fuzz',
    prompt: `${PREAMBLE}

SURFACE: UNICODE AND ENCODING.

Read /output/lib/pyfloat.mjs and /output/lib/pyrepr.mjs, then attack them.
- Unicode decimal digits (Nd) from MANY scripts as amounts, including astral ones
  (Mathematical bold/double-struck/sans-serif digits U+1D7CE-U+1D7FF, U+104A0 Osmanya,
  U+1E950 Adlam, U+16A60, U+11066 Brahmi). Mix scripts within one number. Combine with
  signs, exponents, decimal points and underscores.
- Non-Nd numeric characters that must be REJECTED: Roman numerals, superscript digits
  (U+00B2, U+2070), circled digits (U+2460), No/Nl category chars, U+066B, U+FF0E.
- Every Unicode whitespace codepoint as padding: verify which strip and which do not
  (U+0085, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000,
  U+180E, U+200B, U+FEFF, U+001C-U+001F).
- repr() escaping in BOTH the "invalid float value" message AND the CurrencyDoesNotExist
  KeyError line: unpaired surrogates, astral printables (emoji), astral non-printables,
  combining marks, RTL marks, private-use characters, unassigned codepoints, and strings
  mixing quote characters.
- Currency codes exercising Unicode case folding: German sharp s, Turkish dotted/dotless i,
  ligatures (U+FB00-U+FB06), Greek final sigma, Cherokee, Deseret, and any character whose
  uppercase is LONGER than its lowercase.
Report divergences.`,
  },
  {
    key: 'code-audit',
    prompt: `${PREAMBLE}

SURFACE: STATIC CODE AUDIT (you may also run the binary to check anything suspicious).

Read every file under /output (test19.mjs and lib/*.mjs). You are looking for:

(a) CONSTRAINT VIOLATIONS — these are disqualifying, so check carefully:
    - Any \`require()\` or \`module.exports\` (ES modules only; both are strictly prohibited).
    - Any import of an npm/external module. ONLY relative local ./*.mjs imports are allowed.
      Even Node built-ins like node:fs are permitted but should not be needed — flag any that are
      imported and unused.
    - Any use of Intl.NumberFormat or arbitrary-precision integer literals/primitives — both
      are strictly prohibited, including in comments.
    - Any import missing its .mjs file extension (ESM requires the full suffix).
    - Any embedded Python, or shelling out to a subprocess.
    - Files outside /output.

(b) LATENT BUGS the differential tests could plausibly have missed. Reason about the code paths:
    - decimal.mjs: the digit-string rounding and carry logic (shiftRoundHalfEven,
      incrementDigits, stripLeadingZeros), the magnitude comparison, the precision check.
      Look for off-by-one, empty-string, and carry-out-grows-the-string cases. Construct
      concrete inputs that would hit any suspect branch and TEST THEM against the binary.
    - locale.mjs groupIntegerDigits: check the minimumGroupingDigits arithmetic for
      1-, 2-, 3- and 4-digit integers.
    - pyfloat.mjs: the two-step transform, the underscore rule, the exponent regex.
    - argparse.mjs: the pre-pass, the -h bundling, the option/value boundary.
    - Anything that would throw an unhandled JS TypeError/RangeError instead of the
      Python-shaped error (which would produce a Node stack trace and a wrong exit code).

(c) QUALITY: dead code, misleading comments, comments that contradict the code, unused exports.

For every issue, say exactly which file and line, and — for behavioral claims — PROVE it by
running both programs on an input that demonstrates it. Report proven behavioral divergences in
'divergences'; put constraint violations and code-quality issues in 'attacked' as a clear list.`,
  },
]

phase('Hunt')

const results = await pipeline(
  SURFACES,
  s => agent(s.prompt, { label: `hunt:${s.key}`, phase: 'Hunt', schema: FINDINGS, effort: 'high' }),
  (found, s) => {
    if (!found || !found.divergences?.length) return found
    // Every claimed divergence gets re-run from scratch by a skeptic.
    return parallel(found.divergences.map(d => () =>
      agent(`${PREAMBLE}

A previous agent claims the following is a DIVERGENCE between the reference and the port.
Assume it is WRONG until your own commands prove otherwise. Common ways such a claim is bogus:
 - the PID in the [PYI-...:ERROR] line was not normalised
 - LANG/LC_ALL was not set for the reference, so it crashed for an unrelated reason
 - the two processes were given different argv (quoting/escaping mistakes in a shell)
 - the exit code came from a pipe (\`| tail\`) rather than the process
 - COLUMNS or another env var differed between the two runs

CLAIM:
${JSON.stringify(d, null, 2)}

Re-run both programs yourself, from a script (not a shell one-liner), passing argv as an array so
there is no quoting ambiguity. Report whether the divergence is REAL, and if so the exact minimal
argv and both outputs. If it is not real, say so and explain what the original agent did wrong.`,
        { label: `confirm:${s.key}`, phase: 'Confirm', schema: {
          type: 'object',
          properties: {
            real: { type: 'boolean' },
            argv: { type: 'array', items: { type: 'string' } },
            explanation: { type: 'string' },
            python: { type: 'string' },
            javascript: { type: 'string' },
          },
          required: ['real', 'explanation'],
        }, effort: 'high' })
    )).then(verdicts => ({ ...found, verdicts: verdicts.filter(Boolean) }))
  }
)

phase('Audit')

const clean = results.filter(Boolean)
const confirmed = clean.flatMap(r => (r.verdicts || []).filter(v => v.real))
log(`${clean.length}/${SURFACES.length} surfaces reported; ${confirmed.length} confirmed divergences`)

return {
  surfaces: clean.map(r => ({ surface: r.surface, invocationsRun: r.invocationsRun, attacked: r.attacked, claimed: r.divergences?.length ?? 0 })),
  confirmed,
}
