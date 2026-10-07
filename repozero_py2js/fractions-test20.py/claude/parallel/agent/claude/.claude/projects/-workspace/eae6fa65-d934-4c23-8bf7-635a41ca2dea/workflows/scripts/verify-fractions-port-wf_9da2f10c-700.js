export const meta = {
  name: 'verify-fractions-port',
  description: 'Exhaustively differential-test and adversarially review the Node port of test20.py',
  phases: [
    { title: 'Fuzz', detail: 'differential fuzzers, one per behavioural category' },
    { title: 'Review', detail: 'adversarial code review, one per lens' },
    { title: 'Verify', detail: 'refute or confirm each reported finding' },
  ],
}

const CONTEXT = `
## System under test

A Node.js (ESM, .mjs) port of a Python CLI lives in /output:

  /output/test20.mjs                       entry point
  /output/lib/core/integer.mjs             manual arbitrary-precision signed integers (base 10^7 limbs)
  /output/lib/core/int-parse.mjs           python int(str) parsing + str(int) with the 4300-digit ceiling
  /output/lib/core/unicode-data.mjs        Nd digit decades, Python whitespace, printability
  /output/lib/core/repr.mjs                python repr() of a str
  /output/lib/core/errors.mjs              python exception objects
  /output/lib/fractions/fraction.mjs       fractions.Fraction subset
  /output/lib/cli/argument-parser.mjs      argparse emulation
  /output/lib/cli/help-format.mjs          usage/help layout
  /output/lib/runtime/stdio.mjs            python-like stdout buffering
  /output/lib/runtime/traceback.mjs        traceback rendering (linecache-style source lookup)
  /output/lib/runtime/argv.mjs             argv recovery with PEP-383 surrogateescape
  /output/lib/program/source-map.mjs       per-statement source/anchor table

The reference implementation is the frozen binary /workspace/dataset/test20_executable
(PyInstaller bundle of CPython 3.12). Its Python source is /workspace/dataset/test20.py.
NEVER run the \`python\` command — it is not the reference and may not exist. Only run the
binary and \`node\`.

The program: six REQUIRED int options --a --b --c --d --e --f. It builds
f1=Fraction(a,b), f2=Fraction(c,d), f3=Fraction(e,f) and prints 11 lines:
f1, f2, f3, f1+f2, (f1+f2)+f3, f1*f2, (f1*f2)*f3, 3/(1/f1+1/f2+1/f3),
(f1+f2+f3)/3, f1>f2, f2>f3.

## Differential harness

Use /tmp/dt.sh — it runs both programs in the CURRENT working directory and compares
stdout, stderr and exit code, printing MATCH or DIFF plus a diff excerpt:

    /tmp/dt.sh --a 1 --b 2 --c 3 --d 4 --e 5 --f 6

It is race-safe (mktemp), so parallel use is fine. Read it before using it. If you need a
variant (env vars, redirection, TTY), copy it to your OWN uniquely-named file under /tmp
and edit that copy — do NOT edit /tmp/dt.sh itself, other agents are using it.

## Known, intentional deviation (do NOT report)

The reference prints a trailing PyInstaller line \`[PYI-<pid>:ERROR] Failed to execute
script 'test20' due to unhandled exception!\` on crashes. It embeds a PID, is a packaging
artifact rather than program behaviour, and is filtered out by the harness. Its absence
from the port is deliberate.

Also deliberate: the port hardcodes the program name \`test20_executable\` in usage/error
lines (Python derives it from argv[0]; the reference binary's name is the migration target).

## Constraints the port must respect

- ESM only: \`import\`/\`export\`, .mjs suffixes, complete file suffixes in import specifiers.
- Zero external/npm dependencies. Only node: builtins and local files may be imported.
- No embedded Python.
- Rational arithmetic is implemented manually; the code must not use the BigInt type or
  rely on floating-point/Number magnitudes for exact values.

## Behaviour already verified as matching (regressions here would be serious)

The 4 documented sample cases; zero-denominator and zero-numerator crashes (exit 1 with a
byte-exact traceback both when a test20.py is present in the CWD and when it is not);
--help; missing/invalid/unrecognized arguments (exit 2); -h5; -h=3; --=5; trailing --;
Unicode digits.
`

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'casesRun', 'notes'],
  properties: {
    casesRun: { type: 'integer', description: 'How many distinct invocations you compared' },
    notes: { type: 'string', description: 'One paragraph: what you covered and what you deliberately did not' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'repro', 'expected', 'actual', 'file', 'severity'],
        properties: {
          title: { type: 'string' },
          repro: { type: 'string', description: 'Exact shell command that shows the divergence' },
          expected: { type: 'string', description: 'What the reference binary does' },
          actual: { type: 'string', description: 'What the port does' },
          file: { type: 'string', description: 'Best guess at the responsible file, or "unknown"' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'cosmetic'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reasoning', 'confirmedRepro'],
  properties: {
    real: { type: 'boolean', description: 'true only if you reproduced the divergence yourself' },
    reasoning: { type: 'string' },
    confirmedRepro: { type: 'string', description: 'The command you ran, and its actual observed output' },
  },
}

const FUZZERS = [
  {
    key: 'random-small',
    prompt: `Differential-fuzz the NUMERIC core with small integers.

Write a bash or node driver that generates MANY random six-tuples and compares outputs.
Aim for at least 1500 distinct invocations. Cover: all-positive; all-negative; mixed signs;
values of 0 in every one of the six positions (individually and in combinations, which
trigger either a constructor ZeroDivisionError or a reciprocal ZeroDivisionError);
value 1 and -1; equal numerators/denominators; pairs with large common factors
(e.g. multiples of 360, 2^k, primorials) to stress reduction; numbers whose fractions are
exactly equal so that > comparisons are false both ways; denominators that are negative
(sign normalisation).

Batch efficiently: loop in a script and only print DIFF lines plus a final total, e.g.
run your loop and pipe through 'grep -v ^MATCH'. Report the count of cases you ran.`,
  },
  {
    key: 'big-integers',
    prompt: `Differential-fuzz the ARBITRARY-PRECISION arithmetic.

The port implements its own bignum (base 10^7 limbs, Knuth algorithm D division, Euclidean
gcd). Hunt for limb-boundary and carry/borrow bugs. Cover, with at least 400 invocations:

- Values with exactly 7, 8, 14, 15, 21, 22 digits (limb boundaries), and values like
  9999999, 10000000, 10000001, 99999999999999, and repunits.
- Values that are powers of ten, powers of two, factorials, primes, and products of two
  large primes (so gcd is 1) vs. deliberately huge shared factors (so gcd is enormous).
- Divisions where Knuth D's add-back correction step triggers: divisors whose leading limb
  is near the base, e.g. gcd operands built from numbers like 9999999*10^k + small.
- Mixed magnitudes: a 200-digit numerator over a 3-digit denominator and vice versa.
- The interpreter's 4300-digit int<->str ceiling: inputs of 4299, 4300 and 4301 digits, and
  inputs whose PRODUCT or SUM exceeds 4300 digits so that a later print() raises ValueError
  mid-run (check both the partial stdout and the traceback).
- Performance: confirm no invocation takes absurdly long (flag anything over ~10s).

Generate the big literals with a script (printf/seq/node), not by hand.`,
  },
  {
    key: 'int-literals',
    prompt: `Differential-fuzz the int(str) ACCEPTANCE surface — what argparse will and will not
convert. At least 250 distinct values, each passed as --a with the other five args valid.

Cover: leading/trailing ASCII and Unicode whitespace (space, tab, newline, CR, form feed,
vertical tab, \\x1c-\\x1f, U+0085, U+00A0, U+1680, U+2000..U+200A, U+2028, U+2029, U+202F,
U+205F, U+3000); interior whitespace (must fail); '+' and '-' signs, doubled signs, sign
with a gap; underscores in every legal and illegal position (leading, trailing, doubled,
adjacent to the sign, between digits); leading zeros; empty string; Unicode decimal digits
from MANY scripts including astral ones (Arabic-Indic, Devanagari, Thai, Bengali, Tamil,
Fullwidth, Osmanya, Mathematical bold/double-struck/sans/mono digits U+1D7CE..U+1D7FF,
U+1FBF0 segmented digits) and mixed-script digit strings; near-miss non-Nd characters that
LOOK numeric (superscripts, subscripts, circled digits, Roman numerals, fractions like
U+00BD, No/Nl category characters); float and hex and exponent forms; very long values.

Use printf with \\u escapes or a node one-liner to emit the exotic characters safely.
Verify BOTH acceptance (same computed output) and rejection (same exact error text).`,
  },
  {
    key: 'argparse-structure',
    prompt: `Differential-fuzz the ARGPARSE structure: token classification and consumption.

At least 250 invocations. Cover systematically:
- Every option in --x V, --x=V and abbreviated forms; prefix matching of --h/--he/--hel;
  ambiguous prefixes (--, --=, --=5); unknown options (--z, ---a, --A, -a, -abc, -q5).
- Values that look like options: -5, -05, -5x, -x, -, "- 5", "-5 ", " -5", --b as a value.
- The -- separator in every position: leading, between an option and its value, trailing,
  doubled, followed by extras; and combined with -h.
- Concatenated short forms: -h, -h5, -hx, -hh, -h5x, -h-x, -h=, -h=3, --help=3, --hel=x.
- Extras: bare positionals before/among/after options, empty-string extras, extras with
  embedded spaces, multiple extras (check the joining and ordering in the message).
- Repeated options (last wins), repeated with a bad value first or second.
- Missing required: every subset size from 1 to 6 missing (spot-check ~15 subsets) and
  confirm the ORDER and joining of the names in the message.
- Error precedence: -h before/after a bad int; a bad int plus extras; two bad ints;
  ambiguous option plus a bad int; unknown option plus missing required.
- Argument order permutations of a fully valid invocation (options given in a shuffled
  order should all succeed identically).`,
  },
  {
    key: 'environment',
    prompt: `Differential-fuzz ENVIRONMENT and I/O behaviour.

1. COLUMNS: run --help and an error case (e.g. just --a 1) under COLUMNS values
   1,2,5,10,15,18,20,24,30,38,39,40,41,50,60,63,64,65,70,79,80,81,100,200 and under
   invalid values ("", "abc", "0", "-5", "  40  ", "40x"). The usage line and the help
   body wrap differently at each width. Compare byte-for-byte. Note: your copy of the
   harness must export COLUMNS for BOTH programs.
2. CWD: run from /workspace/dataset (where a real test20.py exists, so tracebacks show
   source lines), from /workspace, from /tmp, and from a directory containing a DECOY
   test20.py with different content (create one in a temp dir — the reference echoes
   whatever that file's line N contains). Use crash-inducing args so a traceback prints.
3. Stream separation: verify stdout-only, stderr-only, and MERGED (2>&1) captures agree.
   The merged case is sensitive to buffering: Python block-buffers stdout when it is a
   pipe, so on a crash the traceback appears BEFORE the earlier stdout lines. Check that
   the port reproduces the merged byte stream exactly for a mid-run crash.
4. stdout closed early / piped to head (should not change the visible prefix), and stdout
   redirected to a file vs a pipe.
5. Very large output (a 4000-digit input) through a pipe, to exercise multi-block flushing.

Report only genuine divergences.`,
  },
  {
    key: 'repr-escaping',
    prompt: `Differential-fuzz the ERROR-MESSAGE quoting of rejected values.

argparse renders the offending value with Python repr(). Pass at least 120 exotic values
as --a (other five args valid) and compare the exact stderr bytes. Cover: values containing
a single quote, a double quote, both, backslashes, newlines, tabs, carriage returns, form
feeds, NUL-free control characters (\\x01..\\x1f, \\x7f), DEL, non-ASCII printables (accented
letters, CJK, emoji, combining marks, RTL marks), zero-width and format characters
(U+200B, U+200E, U+FEFF), unassigned/private-use code points, astral characters, and RAW
INVALID UTF-8 BYTES (e.g. $'\\xff', $'a\\xffb', $'\\xed\\xa0\\x80', $'\\xc3'), which Python
surfaces through PEP-383 surrogateescape as \\udcXX escapes.

Also check the same values as an unrecognized extra argument (they are echoed unquoted
there) and as the value of an option that expects one.

Use bash $'...' quoting or a node driver with execFile to pass raw bytes precisely.
Compare with cmp/od, not by eye.`,
  },
]

const REVIEWERS = [
  {
    key: 'compliance',
    prompt: `Review the port for TASK-CONSTRAINT compliance. Read every file under /output.

Check, and report violations as findings:
- Pure ESM: no require(), no module.exports, no __dirname/__filename usage; every import
  specifier is a relative local path WITH an explicit .mjs suffix, or a node: builtin.
- No npm/external module is imported anywhere. No package.json dependency is relied on.
- Every file that is imported exists at the exact path and case used in the specifier.
- No Python is embedded, spawned, or shelled out to. No child_process at all.
- The rational arithmetic is genuinely manual: grep for the BigInt type and for any use of
  floating-point/Number-typed magnitudes where exactness matters (parseInt/parseFloat/
  Number()/toString(radix)/Math.pow on values that can exceed 2^53). Integer limbs held in
  plain numbers below 10^7 are fine and expected; flag only places where an EXACT value
  could exceed 2^53 or where a numeric conversion could lose precision.
- The library is split into multiple modules by functionality and exposes them via export.
- Every exported symbol is actually used somewhere, and nothing is dead code left over.
- Run: node --check on each .mjs file, and confirm the entry runs from an arbitrary CWD
  and via an absolute path (node /output/test20.mjs ...).

Report each violation with the file and line. For anything you claim, quote the line.`,
  },
  {
    key: 'bignum',
    prompt: `Adversarially review /output/lib/core/integer.mjs — the manual arbitrary-precision
integer layer — for CORRECTNESS BUGS. This is the highest-risk file.

Read it closely, then attack it. Focus on:
- magDivMod (Knuth algorithm D): normalisation factor, the qhat estimate loop and its
  break condition, the multiply-subtract borrow chain, the add-back correction, quotient
  and remainder de-normalisation, the single-limb fast path, and the u < v early return.
  Are all intermediate products provably below 2^53 for base 10^7?
- magMul carry propagation past the inner loop.
- magAdd/magSub borrow handling and trimming; trim() mutating a caller's array.
- gcd: the two-limb fast path (is the packed value always exact?), the Euclid loop,
  gcd(0,0), gcd(x,0), negative operands.
- Sign handling: negative zero, negate() of zero, compare() across signs, divMod sign of
  the remainder, abs() returning \`this\` (aliasing/mutation risk).
- fromSmall, fromDigits with leading zeros / all zeros / very long digit strings.
- toString and decimalLength for zero, for exact powers of the base, and for values whose
  top limb is small.
- Any place a returned object shares a mutable limb array with another object.

DO NOT just read: write a node test script under /tmp that cross-checks the class against
an independent oracle over thousands of random values, including values around limb
boundaries. You may use JavaScript's native arbitrary-precision integer type IN YOUR TEST
SCRIPT ONLY as the oracle (it is banned in /output, not in throwaway tests). Verify
add/sub/mul/divMod/gcd/compare/toString and the identity q*v+r == u with 0 <= |r| < |v|.
Report every mismatch with the exact operands.`,
  },
  {
    key: 'semantics',
    prompt: `Adversarially review the PYTHON-SEMANTICS layers for divergences from CPython 3.12:
/output/lib/fractions/fraction.mjs, /output/lib/core/int-parse.mjs,
/output/lib/core/unicode-data.mjs, /output/lib/core/repr.mjs, /output/lib/core/errors.mjs.

Questions to answer with evidence from the reference binary (never run \`python\`):
- Fraction normalisation: is the sign always carried by the numerator, is the denominator
  always positive, is the result always in lowest terms, for every sign combination
  including zero numerators?
- Do plus/times produce exactly the same reduced pair CPython's _add/_mul produce?
- Does the division helper reproduce CPython's partial cancellation, which is observable
  in the ZeroDivisionError message \`Fraction(n, 0)\`? Try to find any six-tuple where the
  message's numerator differs between the two programs.
- str(): the denominator==1 case, negative values, zero, and the 4300-digit ceiling on
  BOTH numerator and denominator (can you construct a case where the DENOMINATOR is the
  part that exceeds the limit? does the reference raise there too, and identically?).
- int(str): is the underscore rule exactly Python's (single, between digits only)? Is the
  digit-limit check counting digits, or characters including underscores and sign? Find a
  boundary case that distinguishes them and test it against the reference.
- The Unicode Nd decade table: verify programmatically that every code point the table
  claims is a digit really is, and — more importantly — that no Nd code point is MISSING.
  Cross-check the table against Node's own \\p{Nd} property escape over the full code space,
  and spot-check ~30 exotic digits end-to-end against the reference binary.
- repr(): quote selection, escaping, and printability classification.

Report concrete divergences with a reproduction command.`,
  },
  {
    key: 'argparse-review',
    prompt: `Adversarially review /output/lib/cli/argument-parser.mjs and
/output/lib/cli/help-format.mjs against CPython 3.12's argparse.

Read the code, then reason about paths the fuzzers may not reach. Specifically audit:
- parseOptional's ordered fallback: exact match, single-char, '=' split, prefix tuples,
  ambiguity, negative-number matcher, the "contains a space" rule, unknown-option tuple.
- getOptionTuples for both the double-dash and single-dash branches, including the sep
  value ('' for a concatenated short tail vs '=' for an explicit arg) and how that sep
  decides between chaining short options and raising "ignored explicit argument".
- consumeOptional's loop: the queued-actions list, when \`stop\` is set, the extras pushed
  for an unknown option and for an unmatched short-option tail, and whether an action can
  be marked "seen" without its value being stored (affects the required check).
- The order of the post-scan checks and the exact wording/joining of every message.
- help-format: the usage wrapping algorithm (both the short-prog and long-prog branches),
  the help-position and action-width formulas, and the terminal-width lookup including
  the COLUMNS parsing rules.
- Anything that could throw a raw JavaScript error (TypeError on undefined, etc.) instead
  of producing an argparse-style message — try to find an argv that crashes the port with
  a JS stack trace. That would be a critical finding.

Verify every claim against the reference binary before reporting it.`,
  },
  {
    key: 'runtime',
    prompt: `Adversarially review the RUNTIME layer: /output/lib/runtime/stdio.mjs,
/output/lib/runtime/traceback.mjs, /output/lib/runtime/argv.mjs,
/output/lib/program/source-map.mjs, and /output/test20.mjs.

Audit for:
- Output loss or reordering: does every byte written reach the fd before exit, including
  on the crash path and the --help path? What happens on EAGAIN/EPIPE? Is process.exit
  called while data is still buffered anywhere?
- Buffering fidelity: block buffering when stdout is a pipe (8192) vs line buffering on a
  TTY, and whether the port's merged (2>&1) byte order matches the reference for a crash
  after several printed lines. Test with a script that produces enough output to cross the
  8192-byte boundary mid-run and then crashes.
- traceback.mjs: the linecache emulation (relative path resolved against the CWD, caching,
  a file shorter than the line number, an empty line, a file that is a directory or is
  unreadable, CRLF line endings, a BOM). Does the anchor-suppression condition match
  CPython's? Are anchor columns adjusted for leading whitespace correctly — construct a
  decoy test20.py whose line 27 is INDENTED and compare against the reference.
- argv.mjs: the /proc/self/cmdline alignment logic. Can it ever mis-slice and hand the
  parser the wrong tokens — e.g. when node is invoked with its own options before the
  script, via a symlink, through \`node --stack-size=... /output/test20.mjs\`, with zero
  user args, with an empty-string argument, or when /proc is unavailable? Verify the
  fallback path works by testing in an environment where the read fails.
- test20.mjs: does the statement order match test20.py exactly, including the evaluation
  order inside 3/(1/f1 + 1/f2 + 1/f3) — which reciprocal is evaluated first when several
  are zero? Compare against the reference for tuples with multiple zeros.
- source-map.mjs: are the recorded line numbers and column spans right for every site?
  Check each against the reference by forcing that specific failure.

Report concrete, reproduced divergences.`,
  },
]

phase('Fuzz')

const fuzzResults = await pipeline(
  FUZZERS,
  (f) => agent(`${CONTEXT}\n\n## Your assignment\n\n${f.prompt}\n\nBe rigorous and quantitative. Report ONLY divergences you have actually observed by running both programs. Do not report the known intentional deviations listed above.`, {
    label: `fuzz:${f.key}`,
    phase: 'Fuzz',
    schema: FINDING_SCHEMA,
  }),
)

phase('Review')

const reviewResults = await pipeline(
  REVIEWERS,
  (r) => agent(`${CONTEXT}\n\n## Your assignment\n\n${r.prompt}\n\nReport ONLY defects you can substantiate. For behavioural claims, reproduce them against the reference binary first. Do not report the known intentional deviations listed above. Style nits are not findings.`, {
    label: `review:${r.key}`,
    phase: 'Review',
    schema: FINDING_SCHEMA,
  }),
)

const all = [...fuzzResults, ...reviewResults].filter(Boolean)
const findings = all.flatMap((r) => r.findings || [])
const totalCases = all.reduce((sum, r) => sum + (r.casesRun || 0), 0)
log(`${findings.length} candidate findings from ${totalCases} compared invocations`)

phase('Verify')

const verified = await parallel(
  findings.map((f) => () =>
    agent(`${CONTEXT}\n\n## Your assignment: refute this claimed defect\n\nAnother agent claims the Node port diverges from the reference. Your job is to REFUTE it. Reproduce it yourself, exactly.\n\nTitle: ${f.title}\nRepro: ${f.repro}\nClaimed reference behaviour: ${f.expected}\nClaimed port behaviour: ${f.actual}\nSuspected file: ${f.file}\n\nRun the repro. If the two programs actually agree, or the only difference is one of the known intentional deviations, or the repro does not demonstrate what is claimed, set real=false. Set real=true ONLY if you personally observed a genuine divergence in stdout, stderr (excluding the PYI line) or exit code — or, for a pure code-quality/constraint finding with no runtime repro, only if you verified the offending code by reading it and quoting the line. Default to real=false when uncertain.`, {
      label: `verify:${f.title.slice(0, 40)}`,
      phase: 'Verify',
      schema: VERDICT_SCHEMA,
    }).then((v) => ({ finding: f, verdict: v })),
  ),
)

const confirmed = verified.filter(Boolean).filter((v) => v.verdict && v.verdict.real)
log(`${confirmed.length} of ${findings.length} findings survived refutation`)

return {
  totalCases,
  coverage: all.map((r) => r.notes),
  confirmed: confirmed.map((v) => ({ ...v.finding, evidence: v.verdict.confirmedRepro, reasoning: v.verdict.reasoning })),
  refuted: verified.filter(Boolean).filter((v) => v.verdict && !v.verdict.real).map((v) => v.finding.title),
}
