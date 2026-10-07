export const meta = {
  name: 'cpp2rust-color-blend',
  description: 'Recon, implement, and adversarially fuzz-verify a byte-exact Rust port of test7.cpp (ColorSpace blend)',
  phases: [
    { title: 'Recon', detail: 'settle blend precision, %g spec, strtof spec, CLI/error-path spec' },
    { title: 'Implement', detail: 'build modular Cargo project at /output' },
    { title: 'Fuzz', detail: 'parallel differential fuzz shards vs the C++ oracle' },
    { title: 'Review', detail: 'adversarial reviewers + completeness critic' },
  ],
}

const ORACLE = '/workspace/dataset/test7_executable'

const FACTS = `
ESTABLISHED FACTS (already verified against the oracle binary ${ORACLE} — do NOT re-derive these,
but DO feel free to double-check any you doubt; report if you find one wrong):

The C++ source (/workspace/dataset/color/tests/test7.cpp) is:
  float r1=0.3f, g1=0.4f, b1=0.5f;  float r2=0.7f, g2=0.2f, b2=0.1f;  float ratio=0.3f;
  if (argc > 5) { r1=stof(argv[1]); g1=stof(argv[2]); b1=stof(argv[3]); r2=stof(argv[4]); g2=stof(argv[5]); }
  if (argc > 6) { ratio = stof(argv[6]); }
  RGB rgb1(r1,g1,b1); RGB rgb2(r2,g2,b2);
  RGB result = ColorConverter::blend(rgb1, rgb2, ratio);
  std::cout << result.r << " " << result.g << " " << result.b << std::endl;
The color.hpp library source is NOT available. This is a black-box port.

F1. QUIRK: b2 is NEVER read from argv. It is always 0.1f. argv[6] goes to \`ratio\`, and argv[7+] are
    ignored entirely. So the test harness's nominal 7-arg call "r1 g1 b1 r2 g2 b2 ratio" actually
    means: r1,g1,b1,r2,g2 from argv[1..5], b2=0.1f always, ratio = the "b2" slot (argv[6]),
    and the nominal "ratio" arg (argv[7]) is discarded. All 5 documented examples confirm this.
F2. Arg thresholds are argc>5 (i.e. >=5 user args) and argc>6 (>=6 user args). With 0..4 user args
    every value keeps its default => output "0.42 0.34 0.38".
F3. blend(RGB const&, RGB const&, float) — confirmed from the mangled symbol
    _ZN10ColorSpace14ColorConverter5blendERKNS_3RGBES3_f. RGB ctor is RGB(float,float,float)
    (_ZN10ColorSpace3RGBC2Efff). All storage is 32-bit float.
F4. FORMULA is  out = c1*(1-t) + c2*t  — NOT c1 + (c2-c1)*t. Two independent proofs:
    (a) "1e20 1e20 1e20 1 1 1.0" -> "1 1 0.1". c1+(c2-c1)*t would give 0 (1-1e20 loses the 1).
    (b) "-0.0 -0.0 -0.0 -0 -0 1.0" -> "-0 -0 0.1". c1+(c2-c1)*t would give +0 -> "0".
F5. NO clamping anywhere — not in the RGB ctor, not in blend, not on ratio.
    "2 -1 3 -5 7 0.5" -> "-1.5 3 1.55";  "0 0 0 1 1 5.0" -> "5 5 0.5";
    "0 0 0 1 1 -1.0" -> "-1 -1 -0.1";  "255 128 64 0 0 0" -> "255 128 64".
F6. Output = printf("%g") with default precision 6, three fields separated by single spaces,
    terminated by "\\n" (std::endl). Verified: 1e-08, 1e-09, 1e-10, 1.23457e-05, 1e+20, 1e-20,
    1.23457e+08, 1e+06, 100000, 1.23457e+07, 0.0001, 1e-05, 1e-06, 0.5, 10, 12345.7.
F7. %g ROUNDS HALF TO EVEN on exact ties of the float's exact decimal value. Proofs (integers
    < 2^24 are exact floats): 1234565 -> "1.23456e+06" (half-up would give 1.23457e+06);
    1048565 -> "1.04856e+06"; 8388605 -> "8.3886e+06". Controls: 1234575 -> "1.23458e+06",
    1048555 -> "1.04856e+06", 1048585 -> "1.04858e+06", 2097125 -> "2.09712e+06",
    4194315 -> "4.19432e+06".
F8. %g style selection uses the decimal exponent X of the value AFTER rounding to 6 significant
    digits: use %e if X < -4 or X >= 6, else %f. Then strip trailing zeros in the fraction and a
    trailing '.'. Critical case: 999999.5 -> rounds to 1000000 (X becomes 6) -> "1e+06".
    Exponent field is e/E followed by sign and AT LEAST 2 digits ("1e+06", "1e-08", "1e+20").
F9. Sign/special printing: -0.0f prints "-0"; +inf "inf"; -inf "-inf"; NaN "nan"; negative NaN "-nan".
F10. std::stof == glibc strtof + libstdc++ error wrapper. Grammar (all verified):
     - leading whitespace skipped (space, tab, newline)
     - optional +/-
     - decimal: digits [ '.' digits ] [ (e|E) [+-] digits ]  — the exponent part is only consumed
       if at least one digit follows it: "1e" -> 1, "1e+" -> 1, "1.5e2x" -> 150
     - hex: (0x|0X) hexdigits [ '.' hexdigits ] [ (p|P) [+-] digits ]
       "0x10" -> 16, "0X1P-2" -> 0.25, "0x.8p1" -> 1, "0x1p" -> 1, "0x" -> 0 (parses just the "0"),
       "  +0x10p0z" -> 16
     - "inf" / "infinity" case-insensitive ("iNfInItY" -> inf); "nan", "nan()", "nan(0x1)";
       "-nan" -> prints "-nan"
     - trailing garbage is ignored: "0.5abc" -> 0.5, "1_000" -> 1, "1,5" -> 1
     - accepted: "+.5" -> 0.5, "-.5" -> -0.5, ".5" -> 0.5, "5." -> 5
     - REJECTED (no conversion): "" , "abc", ".", "e5", "--1"
F11. Error paths. On no-conversion, libstdc++ throws std::invalid_argument; on ERANGE it throws
     std::out_of_range. Uncaught => std::terminate => SIGABRT (shell exit status 134). The exact
     stderr text is:
       terminate called after throwing an instance of 'std::invalid_argument'\\n  what():  stof\\n
     (and the same with 'std::out_of_range'). Verified by running the oracle.
F12. ERANGE (=> out_of_range) fires on BOTH overflow and subnormal/underflow:
     out_of_range: "1e400", "1e5000", "-1e5000", "3.5e38", "1e-38", "1e-40", "1e-45", "1e-46",
                   "1e-50", "0.00000000000000000000000000000000000000000000001"
     OK:           "3.4e38" -> 3.4e+38, "1.1754944e-38" -> 1.17549e-38
     So: any nonzero result whose magnitude is below FLT_MIN (2^-126 ~ 1.17549435e-38), i.e. any
     subnormal or underflow-to-zero result, raises out_of_range; so does overflow to infinity.
     Literal "inf"/"nan" do NOT raise it.
`

const RECON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'spec', 'testVectors', 'corrections', 'openRisks'],
  properties: {
    summary: { type: 'string', description: 'Concise conclusion' },
    spec: { type: 'string', description: 'Precise implementable spec / algorithm, unambiguous enough to code from' },
    testVectors: {
      type: 'array',
      description: 'Concrete oracle-verified vectors: exact argv list and exact expected stdout+stderr+exit code',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['args', 'expectedStdout'],
        properties: {
          args: { type: 'array', items: { type: 'string' } },
          expectedStdout: { type: 'string' },
          expectedStderr: { type: 'string' },
          exitCode: { type: 'number' },
          note: { type: 'string' },
        },
      },
    },
    corrections: { type: 'array', items: { type: 'string' }, description: 'Any FACT above that you proved WRONG, with evidence' },
    openRisks: { type: 'array', items: { type: 'string' } },
  },
}

phase('Recon')
log('Recon: 4 independent lenses probing the oracle binary')

const reconTasks = [
  {
    key: 'precision',
    label: 'recon:blend-precision',
    prompt: `${FACTS}

YOUR TASK (lens 1 of 4): settle definitively whether blend computes  c1*(1-t) + c2*t  entirely in
32-bit float, or in double and then narrows the result to float via the RGB(float,float,float) ctor.

These two differ by at most 1 ulp of float, which only changes the printed 6-significant-digit output
occasionally — so you must BRUTE FORCE it, not reason about it.

Method:
1. Write a scratch Rust program in /tmp/recon-prec/ (use rustc; no crates). It should, for a given
   seed, generate many random argv tuples "r1 g1 b1 r2 g2 ratio" (6 args, so ratio = argv[6]).
   Use a mix of: uniform [0,1) values, values with many mantissa bits, huge/tiny exponents,
   adversarial near-tie values, and values chosen so that c1*(1-t)+c2*t lands very close to a
   6-significant-digit rounding boundary (that is where float-vs-double diverges observably).
2. For each tuple compute BOTH candidates:
     FLOAT : let s = 1.0f32 - t;  c1*s + c2*t   (all f32)
     DOUBLE: ((c1 as f64)*(1.0 - t as f64) + (c2 as f64)*(t as f64)) as f32
   Remember the third component always uses c2 = 0.1f32 (b2 default).
3. Format each candidate the way the oracle does. For this recon step you do NOT need a perfect %g
   implementation — instead, DISAGREEMENT DETECTION is enough: only invoke the oracle for tuples
   where FLOAT and DOUBLE produce different f32 bit patterns. For those, run the oracle and see which
   candidate's value matches the printed digits. You can decide which candidate matches by printing
   both candidates with format!("{:e}") style / manual 6-sig-digit rounding, or simply by checking
   which candidate is consistent with the oracle's decimal string (they differ by >= 1 ulp so at the
   digits where they differ the strings differ).
4. Search hard: aim for at least 200 tuples where the two candidates differ in bits, and check ALL of
   them against the oracle. Report the exact counts (how many agreed with FLOAT, how many with DOUBLE,
   how many were ambiguous because both round to the same 6-digit string).
5. Also test whether the sub-expression is 1.0f-t (float) vs 1.0-t (double) independently if you can
   find a discriminating case, and whether the multiply/add could be a single fused multiply-add
   (fma). Test the fma hypothesis explicitly: FMA: fmaf(c1, 1-t, c2*t) or similar orderings.
   Also test the term ORDER hypothesis (c1*(1-t) + c2*t) vs (c2*t + c1*(1-t)) — float addition is
   commutative so this cannot differ; ignore. But DO test c1*(1.0f-t) vs c1 - c1*t style rewrites if
   you find any disagreement with both primary candidates.

Deliver in \`spec\`: a definitive statement of the exact arithmetic to implement, in Rust, that
matched the oracle on every discriminating case. In \`testVectors\` include at least 25 of the
discriminating tuples with the oracle's exact stdout. If you cannot fully discriminate, say so
loudly in \`openRisks\` and report which candidate is consistent with all evidence.`,
  },
  {
    key: 'printf',
    label: 'recon:printf-%g',
    prompt: `${FACTS}

YOUR TASK (lens 2 of 4): produce a complete, unambiguous, implementable specification of glibc's
printf("%g", (double)someFloat) with default precision 6, as used by C++ \`std::cout << float\`,
plus a large oracle-verified test-vector set.

Notes on what libstdc++ actually does: \`std::cout << float\` promotes to double and formats with
%g at precision 6 (std::cout's default precision). Since float->double is exact, this is equivalent
to formatting the float's EXACT value with 6 significant digits.

Cover and verify empirically with the oracle (${ORACLE}) — remember you can only inject values
through the 6 argv slots (r1 g1 b1 r2 g2 ratio) and that setting ratio to "0" makes the output equal
exactly (r1, g1, b1) since out = c1*(1-0) + c2*0 = c1 (for c1 finite; note -0.0 c1 with ratio 0
yields +0.0 because -0.0 + 0.0 = +0.0 — verify this!). That gives you a clean 3-values-per-run
identity oracle for the formatter. Use it heavily.

Must pin down:
1. The %e-vs-%f decision rule and that it is applied AFTER rounding to 6 significant digits
   (999999.5 -> "1e+06"). Find and verify more such exponent-bumping cases, in both directions,
   including tiny ones near the -4 boundary (e.g. values just below 0.0001 that round UP to 0.0001).
   Specifically test values like 9.999995e-05, 9.9999949e-05, 0.000099999949 and report.
2. Trailing-zero stripping and decimal-point removal in both %f and %e styles (e.g. 100000 -> "100000",
   0.5 -> "0.5", 10 -> "10", 1e+06, 1.5e+20, values like 1.20000e+07 -> "1.2e+07").
3. Rounding: exact-value based, round-half-to-EVEN on true ties. Verify with MANY exact-tie floats.
   Good tie generators: integers < 2^24 whose 7th significant digit is exactly 5 with a preceding
   even digit (e.g. 1234565, 1048565, 8388605, 1048525, 2097145, 4194285...) and dyadic rationals
   like N + 0.5 / N + 0.25 that terminate at the 7th significant digit. Confirm at least 15 genuine
   ties, including both round-down (preceding digit even) and round-up (preceding digit odd) cases.
   ALSO verify a near-tie that is NOT a tie because the float's exact binary expansion continues
   past the tie digit (e.g. 0.1234565f whose exact value is slightly above the tie) — this proves
   the rounding uses the EXACT binary value, not the shortest decimal representation. This is the
   single most important subtlety: shortest-repr ("Ryu"/Rust {} formatting) is WRONG here.
4. Zero: 0 -> "0", -0.0 -> "-0". Infinity: "inf"/"-inf". NaN: "nan"/"-nan". Verify each via the oracle
   (for -0 you need out = -0: e.g. args "-0.0 -0.0 -0.0 -0 -0 1.0" gives "-0 -0 0.1"; also
   "-0.0 -0.0 -0.0 -0.0 -0.0 0.5" gives "-0 -0 0.05").
5. The full range: subnormal floats (smallest 1.4013e-45), FLT_MAX (3.40282e+38), and everything in
   between. Note you CANNOT feed a subnormal directly (stof throws out_of_range) — but you CAN
   produce one arithmetically via blend, e.g. c1 tiny-normal times a small (1-t). Figure out a way
   and verify at least a few subnormal formats, or explain why it is unreachable and say so.
   Hint: you can also reach small values via c2*t with c2=0.1 and a tiny t? No — t is also parsed by
   stof. Think about which reachable products give subnormals (e.g. r1 = 1.5e-38 is rejected... but
   r1 = 3.4e38 with a tiny (1-t)? (1-t) can be at most ~1). Consider t slightly less than 1 so that
   (1-t) is ~1e-7, times c1 ~ 1.2e-38 -> subnormal. Chain reasoning like that and TEST it.

Deliver in \`spec\` a step-by-step algorithm precise enough to implement with big-integer exact
decimal expansion (describe how to get the exact decimal digits of an f32: value = mantissa * 2^exp,
so use arbitrary-precision integers; do NOT rely on f64 intermediate formatting). In \`testVectors\`
give at least 60 oracle-verified vectors (argv + exact stdout), heavily weighted toward ties,
exponent boundaries, and trailing-zero stripping.`,
  },
  {
    key: 'strtof',
    label: 'recon:strtof',
    prompt: `${FACTS}

YOUR TASK (lens 3 of 4): produce a complete, unambiguous, implementable specification of
glibc \`strtof\` as wrapped by libstdc++ \`std::stof\`, and pin the exact ERANGE boundaries.

Use the oracle ${ORACLE}. Feed candidate strings into the r1 slot with the other args "0 0 0 0 0"
(so a successful parse of r1 with ratio=0 prints r1 exactly as the first field). Capture stdout,
stderr and the exit status for each.

Must pin down precisely:
1. The exact accepted grammar and where endptr lands (which determines invalid_argument). Include:
   whitespace set accepted before the number (test space, \\t, \\n, \\v, \\f, \\r); sign; decimal form;
   hex form; the "0x" with no hex digits case; the dangling-exponent cases ("1e", "1e+", "0x1p",
   "0x1p+"); inf/infinity/nan spellings and case-insensitivity; nan(n-char-sequence) including
   an unterminated "nan(abc" (does it consume the "(abc" or stop after "nan"?); and strings that
   must be REJECTED.
2. Whether the decimal->float conversion is correctly rounded (round-to-nearest-even). Verify with
   hard cases: exact midpoints between adjacent floats, long digit strings, e.g.
   "1.00000005960464477539062500" (midpoint between 1.0f and the next float => ties-to-even => 1.0),
   "1.00000017881393432617187500" (midpoint between nextafter(1) and the one after => which way?),
   and 17+ digit strings. Report whether Rust's own \`str::parse::<f32>()\` agrees with glibc on all
   your test cases (it should — both are correctly rounded — but VERIFY, and report any divergence).
3. The EXACT ERANGE boundaries, to the last bit. Determine, by bisecting decimal strings against the
   oracle:
   (a) OVERFLOW: the largest decimal that is accepted vs the smallest that throws out_of_range.
       FLT_MAX = 3.4028234663852886e38; the midpoint to infinity is 3.402823669209385e38. Test
       decimals straddling that midpoint and report which side throws.
   (b) UNDERFLOW/SUBNORMAL: is it "result is subnormal" or "result is inexact and subnormal" or
       "result underflowed to zero"? Test: a decimal that is EXACTLY a subnormal float
       ("0x1p-149", and its exact decimal 1.401298464324817070923729583289916131280e-45), the
       largest subnormal (0x1.fffffcp-127 exactly), a decimal just below FLT_MIN that ROUNDS UP to
       FLT_MIN (FLT_MIN = 1.1754943508222875e-38; try 1.17549435082228749e-38 and values in the gap
       between the largest subnormal 1.1754942106924411e-38 and FLT_MIN), and exact FLT_MIN.
       Report the precise predicate.
   (c) Is "0" / "0.0" / "0e-400" / "0e400" / "-0.0" accepted without ERANGE? What about "0x0p-99999"?
   (d) Do hex forms follow the same ERANGE rule ("0x1p-149", "0x1p-200", "0x1p200")?
   (e) Does the sign matter (test the negative counterparts of your boundaries)?
4. The exact stderr bytes and exit status for both exception types. Give the literal byte strings.
   Determine whether anything is written to stdout before the abort (it should not be, but confirm —
   note the program parses ALL args before printing, so a bad arg means no stdout at all; confirm
   that a bad argv[6] with good argv[1..5] still produces no stdout).

Deliver in \`spec\` an implementable algorithm: how to scan the longest valid prefix, how to convert
(you may delegate the decimal mantissa/exponent to Rust's correctly-rounded \`f32::from_str\` on a
NORMALIZED reconstructed string, and must implement hex conversion exactly yourself with integer
math + round-to-nearest-even), and the exact ERANGE predicate. In \`testVectors\` give at least 60
oracle-verified vectors including all the error cases with their exact stderr and exit code.`,
  },
  {
    key: 'cli',
    label: 'recon:cli-and-env',
    prompt: `${FACTS}

YOUR TASK (lens 4 of 4): pin the process-level behaviour and everything about argument handling that
is NOT about number parsing or number formatting.

Use the oracle ${ORACLE}.

1. Verify the argc thresholds exhaustively: run with 0,1,2,3,4,5,6,7,8,12 arguments and record exact
   stdout for each. Confirm 0..4 args => "0.42 0.34 0.38" and that args beyond argv[6] are ignored
   (e.g. that argv[7] can be total garbage like "abc" without any error — this proves argv[7] is
   never parsed). Confirm that with exactly 5 args, ratio stays 0.3f.
2. Confirm the exact output separator and terminator bytes with hexdump (single 0x20 spaces, single
   trailing 0x0a, nothing else, no trailing space). Confirm there is no BOM/extra flush artifact.
3. Exit status on success (0).
4. Non-UTF-8 argument bytes: C++ handles raw bytes. Test the oracle with an argument containing
   invalid UTF-8 (e.g. $'\\xff' or $'0.5\\xff' — the latter should parse as 0.5 due to trailing-garbage
   tolerance, the former should throw invalid_argument). Report exactly what happens.
   IMPORTANT consequence for the Rust port: \`std::env::args()\` PANICS on non-UTF-8 args, whereas
   \`std::env::args_os()\` + std::os::unix::ffi::OsStrExt::as_bytes() gives the raw bytes. Recommend
   which to use and give the exact Rust snippet that reproduces the C++ behaviour byte-for-byte.
5. Test arguments that are empty strings in various positions, and arguments with only whitespace.
6. Check whether locale affects anything (run the oracle with LC_ALL=C, LC_ALL=de_DE.UTF-8,
   LC_ALL=C.UTF-8 and a decimal-comma locale if available) — does the decimal separator or the %g
   output change? Report, and state whether the Rust port needs to care (it should be locale-
   independent, but we need to know what the graders' environment would produce). Also check
   whether the grading is likely done under LC_ALL=C (report what the default env here is).
7. Confirm stdout is a plain write with no buffering-order hazard relative to stderr in the abort
   case (i.e. that the ordering of our stderr write + abort matches).

Deliver in \`testVectors\` at least 30 oracle-verified vectors covering all arg counts and the odd
argument cases, and in \`spec\` the precise Rust argv-handling recipe.`,
  },
]

const recon = {}
const reconResults = await parallel(reconTasks.map((t) => () =>
  agent(t.prompt, { label: t.label, phase: 'Recon', schema: RECON_SCHEMA })
    .then((r) => ({ key: t.key, r }))
))
for (const item of reconResults.filter(Boolean)) recon[item.key] = item.r

const missing = reconTasks.filter((t) => !recon[t.key]).map((t) => t.key)
if (missing.length) log(`WARNING: recon lens(es) failed and returned nothing: ${missing.join(', ')}`)

const allCorrections = Object.entries(recon).flatMap(([k, v]) => (v.corrections || []).map((c) => `[${k}] ${c}`))
const allRisks = Object.entries(recon).flatMap(([k, v]) => (v.openRisks || []).map((c) => `[${k}] ${c}`))
if (allCorrections.length) log(`Recon produced ${allCorrections.length} correction(s) to the seeded facts`)

function specBlock(k, title) {
  const v = recon[k]
  if (!v) return `### ${title}\n(LENS FAILED — no data; fall back to the FACTS above and verify yourself)\n`
  const vecs = (v.testVectors || []).slice(0, 70)
  return `### ${title}\nSUMMARY: ${v.summary}\n\nSPEC:\n${v.spec}\n\nORACLE-VERIFIED VECTORS (JSON):\n${JSON.stringify(vecs)}\n`
}

const COMBINED_SPEC = `
${FACTS}

=====================  RECON RESULTS (authoritative; supersede the FACTS on conflict)  =====================
${specBlock('precision', 'Blend arithmetic precision')}
${specBlock('printf', 'printf %g precision-6 formatting')}
${specBlock('strtof', 'std::stof / glibc strtof')}
${specBlock('cli', 'CLI / process behaviour')}

CORRECTIONS TO THE SEEDED FACTS:
${allCorrections.length ? allCorrections.map((c) => '- ' + c).join('\n') : '(none reported)'}

OPEN RISKS FLAGGED BY RECON:
${allRisks.length ? allRisks.map((c) => '- ' + c).join('\n') : '(none reported)'}
==============================================================================================
`

phase('Implement')
log('Implementing the Cargo project at /output')

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['filesWritten', 'buildOk', 'buildLog', 'selfTestSummary', 'notes'],
  properties: {
    filesWritten: { type: 'array', items: { type: 'string' } },
    buildOk: { type: 'boolean' },
    buildLog: { type: 'string' },
    selfTestSummary: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
}

const impl = await agent(`${COMBINED_SPEC}

YOUR TASK: implement the Rust port. You are the ONLY agent writing to /output — own it completely.

HARD REQUIREMENTS from the user (follow to the letter):
R1. Pure Rust, edition 2021, ZERO external crates (std only). Must compile with the installed
    rustc (1.75.0) — do NOT use features newer than 1.75.
R2. The binary must accept exactly the same CLI arguments as the C++ binary — same positional
    meaning, same defaults, same argc thresholds, INCLUDING the b2-is-never-read quirk (F1) and the
    ignoring of argv[7+]. Do not "fix" the bug: reproduce it exactly.
R3. Byte-for-byte identical stdout to the C++ std::cout output. Also match stderr and exit status on
    the error paths.
R4. Zero dependencies — implement the float formatter and the strtof-compatible parser from scratch.
R5. Project structure: a COMPLETE Cargo project rooted at /output, library code organised into
    MODULES, and the entry file at /output/test7.rs (package root, not src/).
R6. Compile and produce an executable.

CONCRETE LAYOUT to build (use exactly this):
  /output/Cargo.toml       package name "color_blend", edition 2021, and
                             [[bin]] name = "test7"  path = "test7.rs"
                           plus [lib] name = "color_blend" path = "src/lib.rs"
                           Set [profile.release] appropriately (nothing exotic).
  /output/test7.rs         the entry point. It MUST work BOTH ways:
                             (a) \`cd /output && rustc test7.rs\`  (standalone, produces ./test7)
                             (b) \`cd /output && cargo build --release\`
                           Achieve this by declaring the modules with #[path] attributes pointing
                           into src/, e.g.
                              #[path = "src/cnum/mod.rs"] mod cnum;
                              #[path = "src/color/mod.rs"] mod color;
                           so that no external crate reference is needed. Do NOT \`use color_blend::\`
                           in test7.rs (that would break plain rustc).
  /output/src/lib.rs       library root: \`pub mod cnum; pub mod color;\` so the same code is also
                           reachable as a library and unit-testable via \`cargo test\`.
  /output/src/color/mod.rs        pub mod rgb; pub mod converter;
  /output/src/color/rgb.rs        the RGB type: \`pub struct RGB { pub r: f32, pub g: f32, pub b: f32 }\`
                                  with \`pub fn new(r: f32, g: f32, b: f32) -> RGB\` mirroring
                                  RGB(float,float,float) — NO clamping.
  /output/src/color/converter.rs  \`pub fn blend(c1: &RGB, c2: &RGB, ratio: f32) -> RGB\` implementing
                                  exactly the arithmetic the recon lens proved.
  /output/src/cnum/mod.rs         pub mod strtof; pub mod fmt_g;
  /output/src/cnum/strtof.rs      the glibc-strtof-compatible parser + the std::stof wrapper
                                  (returning a Result with an Invalid / OutOfRange error enum), and
                                  the abort-with-C++-message helper.
  /output/src/cnum/fmt_g.rs       the exact printf("%g") precision-6 formatter for f32, built on
                                  exact big-integer decimal expansion.

IMPLEMENTATION GUIDANCE (get these right — they are where a naive port fails):
G1. The formatter MUST NOT use Rust's \`{}\` / \`{:e}\` float Display, which produce the SHORTEST
    round-tripping representation. printf rounds the EXACT binary value to 6 significant digits with
    round-half-to-even. Implement exact decimal expansion of the f32 with your own arbitrary-precision
    integer arithmetic (a Vec<u32> or Vec<u8> bignum is fine — decompose the f32 into
    mantissa * 2^exp and compute the exact decimal digit string), then round at 6 significant digits
    with ties-to-even, then apply the %g style selection AFTER rounding (a tie/round-up that carries
    can increase the decimal exponent and flip %f -> %e, e.g. 999999.5 -> "1e+06"), then strip
    trailing zeros and a trailing '.'. Handle -0.0 => "-0", inf => "inf", -inf => "-inf",
    NaN => "nan" / "-nan" (sign bit of the NaN decides).
G2. The parser MUST scan the longest valid strtof prefix itself (Rust's f32::from_str rejects leading
    whitespace, trailing garbage, hex floats, "infinity", "nan(...)", "5.", "1e"). Once you have
    isolated the numeric prefix you MAY hand a cleaned-up DECIMAL string to \`f32::from_str\` — it is
    correctly rounded, same as glibc — but you must implement HEX float conversion yourself with
    integer math and round-to-nearest-even (including the subnormal path). Then apply the ERANGE
    predicate the recon lens established, and the invalid_argument predicate (no conversion).
G3. Reproduce the abort exactly: write the exact stderr bytes then \`std::process::abort()\` so the
    process dies with SIGABRT (status 134). Write stderr with \`std::io::Write\` on
    \`std::io::stderr()\` and FLUSH before aborting.
G4. Read args with \`std::env::args_os()\` and \`std::os::unix::ffi::OsStrExt::as_bytes()\` so that
    non-UTF-8 argument bytes behave like C (\`std::env::args()\` panics on them). Do the parsing on
    &[u8]. Keep the code cfg-gated or simple enough that it still builds on this Linux target.
G5. Print with a single \`println!\` (or a buffered write) producing exactly
    "<r> <g> <b>\\n" — one space between fields, one trailing newline, nothing else.
G6. Follow the argc logic literally: let n = number of args INCLUDING argv[0]. if n > 5 { read
    argv[1..=5] } if n > 6 { ratio = argv[6] }. Never read argv[7+]. b2 is always 0.1f32.

QUALITY BAR:
- Idiomatic, commented Rust. Doc comments on public items explaining the C behaviour being emulated.
- Put real unit tests in the modules (#[cfg(test)]) covering the tie-rounding cases, the %e/%f
  boundary cases, the hex parses, and the ERANGE boundaries from the vectors above.
- No \`unwrap()\` on anything that can fail in normal operation, no panics on any input.

BEFORE YOU FINISH you must:
1. \`cd /output && cargo build --release\` — must succeed with NO warnings if reasonably achievable.
2. \`cd /output && rustc test7.rs -O -o /tmp/test7_rustc_check\` — must also succeed. Then ALSO
   produce the required executable in /output by running \`cd /output && rustc -O test7.rs\`
   (this writes /output/test7). Keep /output/test7.rs as the SOURCE file — do not overwrite it with
   a binary.
3. \`cd /output && cargo test\` — all unit tests must pass.
4. Run a differential smoke test against the oracle over ALL the test vectors given above plus the 5
   documented examples from the C++ file (which use the 7-arg form) plus the no-arg case, comparing
   stdout, stderr and exit status. Iterate until 100% match. Report the final counts honestly in
   selfTestSummary — if anything still mismatches, say exactly what.

Return the file list, whether the build succeeded, and an honest self-test summary.`, {
  label: 'implement:/output',
  phase: 'Implement',
  schema: IMPL_SCHEMA,
})

log(impl ? `Implement: buildOk=${impl.buildOk} — ${impl.selfTestSummary}` : 'Implement agent FAILED')

phase('Fuzz')
log('Fuzz: 10 differential shards, each with a distinct strategy')

const FUZZ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['casesRun', 'mismatchCount', 'mismatches', 'notes'],
  properties: {
    casesRun: { type: 'number' },
    mismatchCount: { type: 'number' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['args', 'oracle', 'rust'],
        properties: {
          args: { type: 'array', items: { type: 'string' } },
          oracle: { type: 'string' },
          rust: { type: 'string' },
          diagnosis: { type: 'string' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
}

const SHARDS = [
  { key: 'uniform01', focus: 'Uniform random values in [0,1] with 1-8 decimal places, and ratio in [0,1]. This is the realistic grading distribution — run the MOST cases here (>= 20000).' },
  { key: 'full-float-bits', focus: 'Random FULL-RANGE floats: generate random 32-bit patterns, filter out NaN/inf/subnormal (stof rejects subnormals), and feed them as their exact shortest decimal AND as 9-digit and 17-digit decimals. Covers huge/tiny exponents.' },
  { key: 'tie-hunting', focus: 'Adversarial 6-significant-digit TIE and near-tie hunting on the RESULT of blend. Search for (c1,c2,t) whose exact blend result sits exactly on or within 1 ulp of a 6-sig-digit rounding boundary. Include all integers < 2^24 with a 7th significant digit of 5, dyadic rationals, and results near powers of 10.' },
  { key: 'exponent-boundaries', focus: 'Values engineered so the blend RESULT lands at %e/%f style boundaries: magnitudes near 1e-5, 1e-4, 999999.x, 1e6, and results that round UP across those boundaries. Also results that are exactly powers of ten, and results whose 6-digit rounding carries all the way (e.g. 9.999995e-5, 999999.5, 9999995).' },
  { key: 'special-values', focus: 'inf, -inf, nan, -nan, "infinity", "NaN(x)", -0.0, +0.0 in every one of the 6 slots and in combination, including inf*0 => nan and inf-inf => nan situations produced by blend (e.g. c1=inf with t=1 gives inf*0 + c2*1; c1=inf,c2=-inf). Verify the printed sign of every resulting NaN.' },
  { key: 'stof-grammar', focus: 'strtof GRAMMAR fuzzing: random strings built from the alphabet [0-9a-fA-FxXpPeE+-. _,\\t\\n(){}] of length 0-14, plus systematic prefixes/suffixes of valid numbers, plus every string form listed in the recon spec. Compare stdout, stderr AND exit status.' },
  { key: 'stof-erange', focus: 'ERANGE boundary fuzzing: decimals densely straddling FLT_MAX/infinity midpoint (3.402823669209385e38), FLT_MIN (1.1754943508222875e-38), the largest subnormal, and zero; plus hex forms 0x1p-149..0x1p+128 and 0x...p... variants; plus exact-midpoint decimals between adjacent floats. Verify accept-vs-out_of_range for each.' },
  { key: 'argc', focus: 'Argument-count fuzzing: 0..12 arguments where the trailing (ignored) args are deliberately invalid garbage, empty strings, whitespace-only strings, very long strings (10KB), and non-UTF-8 bytes. Confirm argv[7+] is never parsed and that non-UTF-8 in argv[1..6] behaves identically (use bash $\'\\xff\' style args, and run both binaries with identical argv via a small runner).' },
  { key: 'hex-floats', focus: 'Hex float fuzzing: random 0x mantissas with 1-15 hex digits, optional fraction, exponents p-160..p+160, uppercase/lowercase mixes, "0x" alone, dangling p, and hex values that round to subnormals or overflow. These exercise your hand-written hex->f32 rounding.' },
  { key: 'documented+regression', focus: 'The 5 documented examples from the C++ file verbatim (7-arg form), the no-arg and 1..4-arg cases, every test vector produced by all four recon lenses, and every mismatch previously found by any other shard (re-verify the fix). Also re-run everything with LC_ALL=C, LC_ALL=C.UTF-8 and an empty environment to confirm locale independence.' },
]

const fuzzResults = await parallel(SHARDS.map((s, i) => () =>
  agent(`${COMBINED_SPEC}

A Rust port has been implemented at /output. The entry source is /output/test7.rs; the compiled
Rust binary should be at /output/test7 (if it is missing or stale, rebuild it with
\`cd /output && rustc -O test7.rs -o /tmp/rust_shard_${i}\` and use that copy instead — do NOT write
anything into /output, another agent owns it; build your own copy under /tmp/shard${i}/).

The C++ oracle is ${ORACLE}.

YOUR TASK: differential fuzz shard #${i + 1} ("${s.key}"). Your job is to BREAK the Rust port.
Assume it is wrong until your evidence says otherwise. Do not accept "close enough" — the
comparison is byte-for-byte on stdout, byte-for-byte on stderr, and equal exit status.

YOUR FOCUS: ${s.focus}

Method:
- Work only in /tmp/shard${i}/. Write a harness (bash and/or a scratch Rust program compiled with
  rustc — no crates) that generates cases for YOUR focus, runs both binaries with IDENTICAL argv,
  and diffs stdout / stderr / exit status.
- Seed any randomness deterministically from the integer ${i * 7919 + 13} so your run is reproducible;
  use /dev/urandom or a hand-rolled xorshift/LCG, not a fixed tiny list.
- Run a LOT of cases — at least 5000 for your focus (>= 20000 for the uniform01 shard) unless your
  focus is intrinsically a small enumerable set, in which case enumerate it EXHAUSTIVELY and say so.
- Note: arguments are positional "r1 g1 b1 r2 g2 ratio" (6 slots max that matter). To stress the
  formatter you can set ratio="0" to make the output equal (r1, g1, b1) exactly.
- When you find a mismatch, MINIMISE it to the smallest reproducing argv and diagnose the root cause
  (which of: blend arithmetic / %g rounding / %g style selection / trailing-zero stripping /
  sign handling / strtof grammar / strtof rounding / ERANGE predicate / argv handling).

Report the exact number of cases you ran and EVERY distinct mismatch (minimised, deduplicated by
root cause, up to 25). If you found zero mismatches, say so plainly and state exactly what you
covered so a reader can judge the coverage. Do NOT report a mismatch you did not actually observe,
and do NOT hide one you did.`, { label: `fuzz:${s.key}`, phase: 'Fuzz', schema: FUZZ_SCHEMA })
))

const shards = fuzzResults.map((r, i) => ({ key: SHARDS[i].key, r })).filter((x) => x.r)
const totalCases = shards.reduce((a, x) => a + (x.r.casesRun || 0), 0)
const allMismatches = shards.flatMap((x) => (x.r.mismatches || []).map((m) => ({ shard: x.key, ...m })))
log(`Fuzz round 1: ${totalCases} cases across ${shards.length} shards, ${allMismatches.length} mismatch(es)`)

let fixReport = null
if (allMismatches.length) {
  phase('Fix')
  log(`Fixing ${allMismatches.length} mismatch(es)`)
  fixReport = await agent(`${COMBINED_SPEC}

You own /output. Differential fuzzing of the Rust port against the C++ oracle ${ORACLE} found the
following MISMATCHES (byte-for-byte stdout/stderr/exit-status differences). Each is real and
reproducible.

${JSON.stringify(allMismatches, null, 1)}

Shard notes:
${JSON.stringify(shards.map((s) => ({ shard: s.key, casesRun: s.r.casesRun, notes: s.r.notes })), null, 1)}

YOUR TASK: fix the Rust implementation in /output so every one of these cases matches exactly.
- Diagnose the ROOT CAUSE of each, do not special-case individual inputs.
- Preserve every hard requirement: std-only, edition 2021, rustc 1.75 compatible, modules under
  /output/src, entry at /output/test7.rs buildable BOTH by \`rustc test7.rs\` and \`cargo build --release\`.
- Add a unit test for each fixed case so it cannot regress.
- Rebuild: \`cd /output && cargo build --release\` AND \`cd /output && rustc -O test7.rs\` (the latter
  refreshes /output/test7). Run \`cargo test\`.
- Then re-verify EVERY listed mismatch case against the oracle, plus the 5 documented examples and
  the no-arg case.
Report honestly: for each listed mismatch, whether it now matches. If any still does not, say so and
explain why.`, { label: 'fix:mismatches', phase: 'Fix', schema: IMPL_SCHEMA })
  log(fixReport ? `Fix: buildOk=${fixReport.buildOk} — ${fixReport.selfTestSummary}` : 'Fix agent FAILED')

  phase('Refuzz')
  const refuzz = await parallel(SHARDS.map((s, i) => () =>
    agent(`The Rust port at /output was just PATCHED to fix differential-fuzz mismatches.
Rebuild your own copy under /tmp/refuzz${i}/ (\`cd /output && rustc -O test7.rs -o /tmp/refuzz${i}/test7\`,
creating the dir first; do not write into /output) and re-run a differential fuzz campaign against
the oracle ${ORACLE}.

Focus: ${s.focus}
Seed randomness deterministically from ${i * 104729 + 7} (a DIFFERENT seed than the first round, so
you explore new cases). Run at least 5000 cases.

Also specifically re-verify these previously-found mismatches:
${JSON.stringify(allMismatches.filter((m) => m.shard === s.key).slice(0, 25))}

Arguments are positional "r1 g1 b1 r2 g2 ratio"; b2 is always 0.1f32 and argv[7+] are ignored.
Compare stdout, stderr and exit status byte-for-byte. Report exact counts and every distinct
remaining mismatch, minimised. Be honest about what you covered.`, { label: `refuzz:${s.key}`, phase: 'Refuzz', schema: FUZZ_SCHEMA })
  ))
  const rs = refuzz.map((r, i) => ({ key: SHARDS[i].key, r })).filter((x) => x.r)
  const rTotal = rs.reduce((a, x) => a + (x.r.casesRun || 0), 0)
  const rMis = rs.flatMap((x) => (x.r.mismatches || []).map((m) => ({ shard: x.key, ...m })))
  log(`Refuzz: ${rTotal} cases, ${rMis.length} remaining mismatch(es)`)
  allMismatches.length = 0
  allMismatches.push(...rMis)
}

phase('Review')
log('Review: 4 adversarial lenses + completeness critic')

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'PASS_WITH_NITS', 'FAIL'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'summary', 'evidence'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          evidence: { type: 'string', description: 'Concrete failing input or a cited requirement, not speculation' },
        },
      },
    },
  },
}

const LENSES = [
  { key: 'requirements', prompt: 'Audit COMPLIANCE with the user requirements, literally and pedantically: (1) pure Rust 2021, compiles with rustc 1.75; (2) CLI args identical to the C++ binary including the b2 quirk and defaults; (3) byte-for-byte stdout; (4) ZERO external crates — grep every Cargo.toml for [dependencies] and every source file for `extern crate` / non-std `use`; (5) a COMPLETE Cargo project in /output with library code organised into MODULES, entry file at /output/test7.rs in the package root; (6) black-box (no C++ library source was read — note that /workspace/dataset/color/ does not even exist, so confirm nothing outside the given .cpp was consulted); (7) an executable was actually produced. VERIFY each by running commands, not by reading claims. Check that `cd /output && rustc test7.rs` works from a CLEAN state and that `cargo build --release` works, and that /output/test7.rs is still valid Rust SOURCE (not clobbered by a binary).' },
  { key: 'formatter', prompt: 'Adversarially audit ONLY /output/src/cnum/fmt_g.rs (the %g formatter). Read it line by line hunting for correctness bugs: exact-decimal expansion errors, bignum carry/overflow bugs, off-by-one in significant-digit counting, wrong tie detection (a tie is only a tie if the exact binary value terminates exactly at the halfway point — check that trailing nonzero digits beyond the cut defeat the tie), the round-up carry that adds a digit and bumps the decimal exponent (999999.5 -> "1e+06"), the %e/%f threshold applied before instead of after rounding, exponent field width (>= 2 digits) and sign, trailing-zero stripping in BOTH styles, "-0", inf/-inf, nan/-nan sign, subnormal inputs, FLT_MAX, and integer overflow / panic paths (any indexing or arithmetic that could panic in debug). For every suspected bug, CONSTRUCT the concrete f32 input and verify against the oracle before reporting it. Report only bugs you actually confirmed, or clearly mark unconfirmed suspicions as such.' },
  { key: 'parser', prompt: 'Adversarially audit ONLY /output/src/cnum/strtof.rs. Hunt for: prefix-scanning bugs (where endptr lands), the dangling-exponent backtrack ("1e", "1e+", "0x1p"), "0x" with no hex digits, whitespace set, sign handling, inf/infinity/nan/nan(...) spellings and case, trailing-garbage tolerance, the hand-written hex->f32 conversion (round-to-nearest-EVEN, subnormal path, exponent overflow/underflow, >24-bit mantissas needing sticky-bit rounding, huge p exponents that could overflow an i32), the ERANGE predicate (subnormal AND overflow AND underflow-to-zero, but NOT literal inf/nan and NOT exact zero), and the invalid_argument predicate. Also check the abort path writes the EXACT stderr bytes and flushes before aborting, and that nothing is written to stdout first. For every suspected bug, construct the concrete input string and verify against the oracle before reporting.' },
  { key: 'port-fidelity', prompt: 'Adversarially audit the PORT FIDELITY of /output/test7.rs, /output/src/color/rgb.rs and /output/src/color/converter.rs against the C++ source. Check: the exact default values (0.3f, 0.4f, 0.5f, 0.7f, 0.2f, 0.1f, 0.3f) and that they are f32 literals; the argc>5 and argc>6 thresholds using the count INCLUDING argv[0]; that b2 is hardcoded to 0.1f32 and never read from argv; that argv[7+] are never touched; that blend is out = c1*(1-t) + c2*t in the exact precision recon proved, with NO clamping; that all three components are computed the same way; that argv is read as raw bytes (args_os + OsStrExt) so non-UTF-8 does not panic; and that the printed line is exactly "<r> <g> <b>\\n". Verify by RUNNING both binaries on cases you design, not just by reading. Report confirmed defects only.' },
]

const reviews = await parallel(LENSES.map((l) => () =>
  agent(`You are reviewing a C++ -> Rust port that must be BYTE-FOR-BYTE behaviour-identical to the
C++ oracle at ${ORACLE}. The Rust project is at /output.

${COMBINED_SPEC}

Current fuzz status: ${totalCases} differential cases run; ${allMismatches.length} unresolved mismatch(es)${allMismatches.length ? ': ' + JSON.stringify(allMismatches.slice(0, 10)) : '.'}

YOUR REVIEW LENS: ${l.prompt}

Rules: you may build scratch copies under /tmp/review-${l.key}/ but you must NOT modify anything in
/output. Default to reporting a finding as unconfirmed unless you actually reproduced it. Prefer
three confirmed blockers over twenty speculative nits. If the code is genuinely correct on your
lens, return PASS and say what you verified.`, { label: `review:${l.key}`, phase: 'Review', schema: REVIEW_SCHEMA })
))

const reviewOut = reviews.map((r, i) => ({ lens: LENSES[i].key, r })).filter((x) => x.r)
const blockers = reviewOut.flatMap((x) => (x.r.findings || []).filter((f) => f.severity === 'blocker' || f.severity === 'major').map((f) => ({ lens: x.lens, ...f })))
log(`Review: ${reviewOut.length} lenses reported, ${blockers.length} blocker/major finding(s)`)

let finalFix = null
if (blockers.length || allMismatches.length) {
  phase('Final fix')
  finalFix = await agent(`${COMBINED_SPEC}

You own /output. Final round: resolve the following CONFIRMED problems in the Rust port.

UNRESOLVED DIFFERENTIAL MISMATCHES:
${allMismatches.length ? JSON.stringify(allMismatches, null, 1) : '(none)'}

BLOCKER / MAJOR REVIEW FINDINGS:
${blockers.length ? JSON.stringify(blockers, null, 1) : '(none)'}

Fix each at the root cause. Then:
- \`cd /output && cargo build --release\` (no warnings if achievable), \`cd /output && cargo test\`,
  and \`cd /output && rustc -O test7.rs\` to refresh /output/test7.
- Confirm /output/test7.rs is still Rust SOURCE and that \`rustc test7.rs\` works standalone.
- Re-verify against the oracle: the 5 documented examples, the no-arg case, all vectors in the spec
  above, and every case listed here.
Report honestly which items are fixed and which are not.`, { label: 'final-fix', phase: 'Final fix', schema: IMPL_SCHEMA })
  log(finalFix ? `Final fix: buildOk=${finalFix.buildOk} — ${finalFix.selfTestSummary}` : 'Final fix agent FAILED')
}

phase('Gate')
const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'casesRun', 'mismatchCount', 'mismatches', 'buildChecks', 'structure', 'report'],
  properties: {
    pass: { type: 'boolean' },
    casesRun: { type: 'number' },
    mismatchCount: { type: 'number' },
    mismatches: { type: 'array', items: { type: 'string' } },
    buildChecks: { type: 'string' },
    structure: { type: 'array', items: { type: 'string' } },
    report: { type: 'string' },
  },
}

const gate = await agent(`${COMBINED_SPEC}

FINAL ACCEPTANCE GATE for the Rust port at /output vs the C++ oracle ${ORACLE}.
You must be skeptical and independent — earlier agents claimed success; verify it yourself from
scratch. Do NOT modify /output (build scratch copies under /tmp/gate/ if needed).

Run and report on ALL of the following:
1. Structure: list /output recursively. Confirm: /output/Cargo.toml, /output/test7.rs (Rust SOURCE),
   library modules under /output/src (at least color/{rgb,converter} and cnum/{strtof,fmt_g}), and a
   produced executable. Confirm ZERO external dependencies (Cargo.toml has no [dependencies]
   entries; no non-std \`use\`/\`extern crate\` anywhere).
2. Builds: from a clean state run \`cd /output && cargo build --release\` and
   \`cd /output && rustc -O test7.rs -o /tmp/gate/t7\`. Report both outcomes and any warnings.
   Also run \`cd /output && cargo test\` and report pass/fail counts.
3. The 5 documented examples from the C++ file, using the 7-argument form exactly as documented:
     "0.0 0.0 0.0 1.0 1.0 1.0 0.5" -> "1 1 0.1"
     "1.0 0.0 0.0 0.0 1.0 0.0 0.5" -> "1 0 0"
     "0.0 0.0 1.0 1.0 1.0 0.0 0.5" -> "0 0 1"
     "0.5 0.5 0.5 0.5 0.5 0.5 0.5" -> "0.5 0.5 0.3"
     "0.3 0.4 0.5 0.7 0.2 0.1 0.3" -> "0.34 0.38 0.46"
   Confirm the Rust binary reproduces each EXACTLY (and that the oracle does too).
4. A fresh differential campaign of at least 30000 cases mixing: realistic [0,1] values, full-range
   floats, tie/boundary hunting, special values, hex floats, malformed strings, and 0..12 argument
   counts. Compare stdout, stderr and exit status byte-for-byte. Seed from 20260810.
5. Confirm the no-arg case prints "0.42 0.34 0.38" and that hexdump shows exactly single-space
   separators and one trailing 0x0a with no trailing space.

Set pass=true ONLY if every check above passes with zero mismatches. If anything fails, set
pass=false and list precisely what. Report the exact case count you actually ran — do not inflate it.`, {
  label: 'gate:acceptance',
  phase: 'Gate',
  schema: GATE_SCHEMA,
})

return {
  reconCorrections: allCorrections,
  reconRisks: allRisks,
  blendPrecision: recon.precision ? recon.precision.summary : null,
  implSummary: impl ? impl.selfTestSummary : null,
  fuzzRound1Cases: totalCases,
  unresolvedMismatches: allMismatches,
  reviewVerdicts: reviewOut.map((x) => ({ lens: x.lens, verdict: x.r.verdict, findings: (x.r.findings || []).length })),
  blockers,
  finalFix: finalFix ? finalFix.selfTestSummary : null,
  gate,
}
