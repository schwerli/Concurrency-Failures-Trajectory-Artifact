export const meta = {
  name: 'cpp-to-rust-color-test11',
  description: 'Black-box port of C++ color test11 to a dependency-free Rust Cargo project, with adversarial differential verification',
  phases: [
    { title: 'Probe',     detail: 'parallel black-box characterization of the C++ binary' },
    { title: 'Implement', detail: 'write the /output Cargo project + test11.rs' },
    { title: 'Verify',    detail: 'adversarial differential fuzzing + compliance audit' },
    { title: 'Repair',    detail: 'fix confirmed defects, re-verify until clean' },
  ],
}

const BIN = '/workspace/dataset/test11_executable'

const GROUND = `
GROUND TRUTH ALREADY ESTABLISHED (verified against the real binary — do not re-derive, but you may re-confirm cheaply):

Source under port: /workspace/dataset/test11.cpp (READ IT — it is the entry file and is fair game).
The C++ library header ../color.hpp DOES NOT EXIST on this machine. This is a BLACK-BOX port.
Reference binary: ${BIN}  (run it with any args to observe behavior).
Tooling: rustc 1.75.0 and cargo 1.75.0 are available. python3 is NOT available — write harnesses in Rust or bash.

Program logic (from test11.cpp):
  float r=0.3f, g=0.7f, b=0.2f;  if (argc > 3) { r=stof(argv[1]); g=stof(argv[2]); b=stof(argv[3]); }
  RGB rgb(r,g,b); RGB inverted = ColorConverter::invert(rgb); RGB grayscale = ColorConverter::grayscale(rgb);
  cout << inverted.r <<" "<< inverted.g <<" "<< inverted.b <<" "<< grayscale.r <<" "<< grayscale.g <<" "<< grayscale.b << endl;

Confirmed semantics:
  * invert(c)    = 1 - c, componentwise. NO clamping (e.g. input 2.0 -> -1; input -0.5 -> 1.5).
  * grayscale(c) = luma = 0.2126*R + 0.7152*G + 0.0722*B, replicated into all three components. NO clamping.
      0.2126*0.3 + 0.7152*0.7 + 0.0722*0.2 = 0.57886 exactly matches observed output.
  * Defaults 0.3/0.7/0.2 used unless argc>3 (i.e. ALL THREE of argv[1..3] present). 1 or 2 args -> defaults. Extra args ignored.
  * Output = six values separated by single spaces, then newline (endl). Default std::cout float formatting == printf "%g" with precision 6.
  * Observed: "-0.0 -0.0 -0.0" -> "1 1 1 -0 -0 -0"; "inf -inf nan" -> "-inf inf nan nan nan nan";
    "1e-7 1e-6 1e-5" -> "1 0.999999 0.99999 1.45846e-06 ..." (two-digit exponent);
    "1234567.8" component -> "-1.23457e+06"; "0x10" parses as hex 16 -> invert "-15".
  * std::stof throws: "abc" -> std::invalid_argument; "1e400" AND "1e-400" -> std::out_of_range.
    Abort output on stderr is exactly (note TWO spaces after "what():"):
      terminate called after throwing an instance of 'std::invalid_argument'
        what():  stof
    and the process dies by SIGABRT (shell exit code 134).
`

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'conclusions', 'evidence', 'rust_guidance', 'open_risks'],
  properties: {
    topic: { type: 'string' },
    conclusions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'confidence'],
        properties: {
          claim: { type: 'string', description: 'A precise, implementable behavioral fact.' },
          confidence: { type: 'string', enum: ['certain', 'high', 'medium', 'low'] },
        },
      },
    },
    evidence: { type: 'array', items: { type: 'string' }, description: 'Concrete command->output pairs proving the conclusions.' },
    rust_guidance: { type: 'string', description: 'Exactly how to implement this aspect in dependency-free Rust, with code sketches.' },
    open_risks: { type: 'array', items: { type: 'string' } },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'passed', 'findings', 'summary'],
  properties: {
    lens: { type: 'string' },
    passed: { type: 'boolean', description: 'true only if ZERO defects were found for this lens.' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'repro', 'expected', 'actual'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          repro: { type: 'string', description: 'Exact shell command that demonstrates the defect.' },
          expected: { type: 'string', description: 'What the C++ reference binary produces.' },
          actual: { type: 'string', description: 'What the Rust port produces.' },
        },
      },
    },
  },
}

// ---------------------------------------------------------------- Phase 1: Probe
phase('Probe')

const PROBES = [
  {
    key: 'precision-disasm',
    prompt: `${GROUND}

YOUR TOPIC: Determine the NUMERIC PRECISION MODEL of the C++ library — this is the single highest-risk unknown.

The test declares \`float r,g,b\`, but the library's RGB struct members and ColorConverter's internal
arithmetic may be \`float\` or \`double\`, and the luma constants may be float literals (0.2126f) or double
literals (0.2126). The candidate models are:
  (A) storage float, arithmetic float (constants float)
  (B) storage float, arithmetic promoted to double then rounded back to float on store
  (C) storage double, arithmetic double (the float inputs widen exactly on construction)

Settle it by INSPECTING THE COMPILED ARTIFACT ${BIN}, which we were explicitly given for debugging.
Use \`objdump -d\`, \`objdump -s -j .rodata\`, \`nm -C\`, and \`gdb\` as needed. Decisive signals:
  * SSE mnemonics: mulss/addss/subss/cvtss2sd (float math) vs mulsd/addsd/subsd (double math).
  * Constant bit patterns in .rodata:
      float  0.2126f = 0x3E59B3D0, 0.7152f = 0x3F371759, 0.0722f = 0x3D93DD98, 1.0f = 0x3F800000
      double 0.2126  = 0x3FCB367A0F9096BC, 0.7152 = 0x3FE6E2EB1C432CA5, 0.0722 = 0x3FB27BB2FEC56D5D
    (VERIFY these encodings yourself — compute them, do not trust me.)
  * The order of operations in the luma sum (R*a + G*b + B*c, and whether FMA is used — vfmadd*).
  * Whether the demangled symbols (nm -C) reveal ColorConverter signatures taking float vs double.
    NOTE: reading exported SYMBOL NAMES from the binary we were told to debug with is fine; there is no
    library source on this machine to read.
Also determine whether invert computes \`1 - c\` or \`1.0f - c\` and whether any clamp instruction
(maxss/minss) appears — we observed no clamping behaviorally, confirm structurally.

Report the winning model with the mnemonic/constant evidence that proves it, and state exactly which
Rust types (f32 vs f64) and which cast points reproduce it bit-for-bit.`,
  },
  {
    key: 'precision-differential',
    prompt: `${GROUND}

YOUR TOPIC: Empirically discriminate the numeric precision model by BRUTE-FORCE SEARCH against the real binary.

Candidate models (implement all three in a Rust harness):
  (A) parse as f32; store f32; luma computed entirely in f32 with f32 constants; invert = 1.0f32 - c
  (B) parse as f32; store f32; luma computed in f64 with f64 constants then rounded to f32 on store; invert likewise
  (C) parse as f32; widen to f64; store f64; luma and invert computed entirely in f64

Method:
 1. Write a Rust program that, for a candidate input triple, formats all six outputs under each model using a
    correct "%g precision 6" formatter, and reports which models DISAGREE on the final printed bytes.
 2. Search hard for disagreeing inputs. Because only 6 significant digits print, models agree almost everywhere —
    you must hunt the rare rounding-boundary cases. Search strategies to combine:
      - millions of pseudo-random f32 values across many exponent ranges (use a deterministic xorshift/LCG PRNG;
        note Rust std has no rand crate and you must not use crates.io)
      - values whose 7th significant decimal digit sits near a 5 (round-half boundaries)
      - random full-precision decimal strings with 9-17 significant digits
      - large magnitudes (1e6..1e38) where f32 mantissa loss is biggest, and subnormals
      - triples chosen so the luma sum suffers catastrophic cancellation (mix large positive and negative)
 3. Collect the disagreeing inputs, then RUN THE REAL BINARY on each and tally which model matches.
    Do NOT stop at one witness: gather at least 20-30 independent disagreeing witnesses if the search yields them,
    across different magnitude regimes, so the verdict is not a fluke.
 4. If two models never disagree anywhere you can find, say so explicitly and report which are
    observationally equivalent for this program (that is a legitimate and useful result).

Be rigorous about the formatter you use in the harness — a bug there would corrupt the verdict. Cross-check your
formatter against the real binary on plain inputs first.

Report the verdict, the witness table (input -> per-model output -> binary output), and the exact Rust
type/cast recipe that matched.`,
  },
  {
    key: 'format-g6',
    prompt: `${GROUND}

YOUR TOPIC: Reverse-engineer, EXACTLY, the default \`std::cout <<\` floating-point formatting so it can be
reimplemented in dependency-free Rust. This is printf "%g" with precision 6, but you must pin every rule.

Rust's \`{}\` for f32/f64 is SHORTEST-ROUNDTRIP, which is NOT %g — e.g. 0.1f32 prints "0.1" in Rust but a value
like 1.0/3.0 prints 17 digits in Rust vs "0.333333" in C++. And Rust has no %g. So a hand-written formatter is
mandatory. Nail down:
  * When scientific vs fixed is chosen: %g uses scientific iff exp < -4 or exp >= precision(6), where exp is the
    decimal exponent of the value rounded to 6 significant digits. Probe the exact boundaries with the binary:
    values near 1e-5, 1e-4, 999999.4, 999999.6, 1000000, 0.0001, 0.00001.
  * Trailing-zero suppression: %g strips trailing zeros AND a trailing '.' (e.g. 1.5 -> "1.5", 2.0 -> "2",
    0.5 -> "0.5", 1.10 -> "1.1"). Confirm on the binary.
  * Scientific form details: mantissa digits, "e+06"/"e-06" with a MINIMUM of two exponent digits, three digits
    when needed (e.g. 1e-38 -> "1e-38", 1e+308-scale not reachable for f32 but check f32 range: 3.4e+38).
  * Rounding: printf rounds the exact binary value to 6 significant decimal digits using round-half-to-EVEN on
    the exact value (glibc is correctly-rounded). Find inputs that expose half-way cases and confirm against the
    binary. This matters: naive round-half-away-from-zero will differ.
  * Special values: "inf", "-inf", "nan", and whether "-nan" is ever printed (probe a negative NaN if you can
    construct one via stof "-nan"). Also "-0" for negative zero, and "0" for positive zero.
  * Zero: does it print "0" (yes, expected).
Probe ALL of these against ${BIN} and record command->output evidence.

Then write the Rust guidance: a concrete, correct algorithm for %g-with-precision-6 using only std.
STRONGLY RECOMMENDED approach and the one you should validate: Rust's \`format!("{:.*e}", 5, x)\` produces a
correctly-rounded scientific representation with 6 significant digits (e.g. "1.45846e-6"), and
\`format!("{:.*}", n, x)\` produces correctly-rounded fixed notation — both use Grisu/Dragon exact rounding
with round-half-to-even, matching glibc. Build %g on top of those primitives: extract the exponent from the
\`{:e}\` form, decide fixed vs scientific, re-render, strip trailing zeros, and fix up the exponent to at least
two digits with an explicit sign. VERIFY this composition actually round-trips correctly, including for
subnormals, huge values, and the half-way rounding cases you found. Report a tested code sketch.`,
  },
  {
    key: 'stof-semantics',
    prompt: `${GROUND}

YOUR TOPIC: Reverse-engineer \`std::stof\` EXACTLY as this binary implements it (libstdc++ over glibc strtof),
so it can be reimplemented from scratch in dependency-free Rust.

Rust's \`str::parse::<f32>()\` is NOT equivalent: it rejects leading whitespace, rejects trailing garbage,
rejects hex float literals, accepts "inf"/"infinity"/"NaN" with different spellings, and never errors on
overflow/underflow (it returns inf/0). So a hand-written parser is required.

Pin down, probing ${BIN} for every claim:
  * Leading whitespace skipped (which characters: space, tab, newline, \\v, \\f, \\r — test via shell quoting).
  * Optional '+'/'-' sign.
  * Decimal form: digits, optional '.', optional fractional digits, optional [eE][+-]?digits.
    Are forms like ".5", "5.", "1e", "1e+" accepted, and how much is consumed? ("1e" should parse as 1 with
    "e" left over, since the exponent is incomplete — CONFIRM.)
  * Hex form: "0x10" -> 16 (already confirmed). Test "0X1p4", "0x1.8p1", "0x" (should be 0 with "x" trailing),
    "0x.8p0".
  * Infinity/NaN spellings, case-insensitive: "inf", "INF", "Infinity", "nan", "NAN", "nan(123)", "-inf", "-nan".
    Determine whether "-nan" produces a NaN whose printed form is "-nan" or "nan".
  * Trailing garbage: silently ignored (confirmed with "0.5abc"). Confirm no exception.
  * NO conversion possible -> std::invalid_argument. Test "", " ", "abc", "e5", "+", ".", "-", "x".
    NOTE the empty-string case: can you even pass an empty argv entry? Try \`${BIN} "" 1 2\`.
  * ERANGE -> std::out_of_range. Overflow confirmed ("1e400"). Underflow confirmed ("1e-400").
    CRITICAL: find the exact underflow boundary. glibc strtof sets ERANGE for results that underflow.
    Probe the subnormal range carefully: 1e-38 (normal), 1.17549e-38 (FLT_MIN), 1e-39, 1e-40, 1e-44,
    1.4e-45 (smallest subnormal), 1e-45, 7e-46, 1e-46, 1e-50. Determine PRECISELY which throw and which
    return a subnormal. Also probe overflow boundary: 3.4028234e38 (FLT_MAX), 3.4028236e38, 3.5e38, 1e39.
    Also check whether the literal string "inf" throws (it should NOT — it is a valid conversion, not ERANGE).
  * Exact abort behavior: capture stderr BYTE-FOR-BYTE (use \`2>&1 | od -c\` or redirect to a file) for both
    exception types, and capture the true exit status (run without a pipe, then \`echo $?\`).
    Determine whether anything is printed to stdout before the abort (it should not be).
    Also determine ordering: if argv[1] is bad AND argv[2] is bad, which exception fires (left-to-right).

Report a complete, unambiguous parsing state machine plus the Rust guidance to implement it with only std,
including how to reproduce SIGABRT death (std::process::abort) and the exact stderr bytes.`,
  },
  {
    key: 'behavior-sweep',
    prompt: `${GROUND}

YOUR TOPIC: Broad behavioral sweep to catch any surprise the other probes would miss. Assume nothing.

Run ${BIN} across a wide, systematic corpus and look for ANY behavior inconsistent with the model
"invert = 1-c componentwise, grayscale = 0.2126R+0.7152G+0.0722B replicated, no clamping, %g6 printing".

Specifically hunt for:
  * Hidden clamping or saturation at any threshold (sweep each channel independently from -1e30 to 1e30 across
    many magnitudes, and finely across [-2, 3]).
  * Any nonlinearity: verify grayscale is EXACTLY linear by checking additivity/scaling on many triples —
    e.g. luma(a)+luma(b) vs luma(a+b) within float rounding. A gamma-correction step (sRGB linearization)
    would break linearity badly; prove it is absent.
  * Confirm the three grayscale components are always byte-identical to each other, including for nan/inf/-0.
  * Confirm the exact separator (single space) and line terminator (single \\n, no trailing space) by piping
    through \`od -c\` on several runs.
  * Whether stdout is the only stream written on success (no stderr noise).
  * Exit code 0 on success.
  * Argument-count edge cases: 0, 1, 2, 3, 4, 10 args; and args that are empty strings.
  * Any locale sensitivity (try LC_ALL=C vs LC_ALL=en_US.UTF-8 vs LC_NUMERIC=de_DE.UTF-8 if available) —
    both for decimal-comma parsing and for output formatting. Report whether the port must care.
  * Recover the luma coefficients to full precision by probing unit vectors ("1 0 0", "0 1 0", "0 0 1") and
    also large-magnitude unit vectors (e.g. "1000000 0 0") to expose more digits of each coefficient than the
    6 printed for a unit input. Confirm they are exactly 0.2126 / 0.7152 / 0.0722 and not, say, Rec.601
    (0.299/0.587/0.114) or some 8-bit-scaled variant.

Report everything that would change the implementation, with command->output evidence.`,
  },
]

const probes = (await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Probe', schema: PROBE_SCHEMA })
))).filter(Boolean)

log(`Probe complete: ${probes.length}/${PROBES.length} reports returned`)

const probeDigest = probes.map(p =>
  `### PROBE: ${p.topic}\n` +
  `CONCLUSIONS:\n${p.conclusions.map(c => `  - [${c.confidence}] ${c.claim}`).join('\n')}\n` +
  `EVIDENCE:\n${p.evidence.map(e => `  * ${e}`).join('\n')}\n` +
  `RUST GUIDANCE:\n${p.rust_guidance}\n` +
  `OPEN RISKS:\n${(p.open_risks || []).map(r => `  ! ${r}`).join('\n')}\n`
).join('\n')

// ---------------------------------------------------------------- Phase 2: Implement
phase('Implement')

const SPEC = `
DELIVERABLE REQUIREMENTS (from the user — satisfy every one literally):
 1. Pure Rust, edition 2021. Must compile with rustc AND as a Cargo project.
 2. CLI args identical to the C++ binary; parse via std::env::args().
 3. Logic, numeric precision, and string formatting must match the C++ EXACTLY — println! output byte-for-byte
    identical to std::cout output.
 4. ZERO external dependencies. Only std. No crates.io. Implement everything from scratch.
 5. Complete Cargo project in /output. Library code organized into MODULES. The entry file test11.rs lives in
    the PACKAGE ROOT, i.e. exactly /output/test11.rs.
 6. Black-box: no C++ library source exists; do not seek it out.
 7. Build and produce the executable.

CONCRETE LAYOUT THAT SATISFIES BOTH BUILD PATHS (use this):
   /output/Cargo.toml          -> [package] edition="2021"; [[bin]] name="test11" path="test11.rs"
   /output/test11.rs           -> entry point; \`mod color;\` + fn main()
   /output/color/mod.rs        -> module root, re-exports the submodules
   /output/color/rgb.rs        -> RGB type
   /output/color/converter.rs  -> ColorConverter::invert / ::grayscale
   /output/color/format.rs     -> the %g-precision-6 ostream formatter
   /output/color/parse.rs      -> the std::stof-compatible parser
 This layout means BOTH \`cd /output && rustc test11.rs\` (module files resolved relative to test11.rs) and
 \`cd /output && cargo build --release\` work. Keep Cargo.toml free of any [dependencies].
 IMPORTANT: set \`[profile.release] \` nothing special; and make sure \`cargo build --release\` does not warn-error.
 Also ensure a stray /output/target directory or /output/test11 binary does not break \`rustc test11.rs\`.
`

phase('Implement')
const implReport = await agent(`${GROUND}

You are the IMPLEMENTER. Write the complete Rust port now.

${SPEC}

Here are the black-box probe reports from five parallel investigators. Treat their 'certain'/'high' conclusions
as the specification. Where two probes disagree (especially about the float-vs-double precision model), prefer
the one with structural disassembly evidence corroborated by differential witnesses, and note the conflict.

${probeDigest}

IMPLEMENTATION RULES:
 * Mirror the C++ structure: an RGB type with r/g/b fields and a ColorConverter with invert() and grayscale()
   associated functions, so the port reads like the original.
 * Write the %g formatter and the stof parser from scratch in their own modules. Do NOT use \`{}\` Display for
   the floats (shortest-roundtrip != %g) and do NOT use \`str::parse::<f32>()\` for argument parsing
   (semantics differ on whitespace/hex/trailing-garbage/ERANGE).
 * Reproduce the abort path exactly: on invalid_argument / out_of_range, write the exact libstdc++ terminate
   message to stderr and die by SIGABRT via std::process::abort() so the shell sees 134.
 * Emit the six values with single-space separators and a trailing newline, in ONE write (endl flushes; a single
   println! is fine).
 * Idiomatic, warning-free Rust. Add brief comments where behavior is deliberately C-compatible rather than
   idiomatic (e.g. "%g uses round-half-even; matches glibc").

BUILD AND SELF-TEST BEFORE RETURNING:
 * \`cd /output && cargo build --release\` must succeed with no warnings.
 * \`cd /output && rustc test11.rs -O -o /tmp/test11_rustc\` must also succeed (the user explicitly asked that
   \`rustc test11.rs\` works). Then also produce the required executable by running \`cd /output && rustc test11.rs\`
   so that /output/test11 exists.
 * Run a differential smoke test of at least 300 inputs (the 5 documented examples, all edge cases named in the
   probe reports, plus randomized triples) comparing your binary's stdout+stderr+exit-code against
   ${BIN} byte-for-byte. Fix everything that differs before returning.

Return a summary of: files written, the precision model you implemented, the formatter algorithm, the parser
state machine, and the differential smoke-test results (how many cases, how many matched).`,
  { label: 'implement', phase: 'Implement' })

log('Implementation written; entering adversarial verification')

// ---------------------------------------------------------------- Phases 3+4: Verify / Repair
const VERIFIERS = [
  {
    key: 'differential-fuzz',
    prompt: `You are an ADVERSARIAL DIFFERENTIAL FUZZER. Your job is to BREAK the Rust port in /output by finding
any input where it differs from the C++ reference ${BIN}.

Build a Rust (or bash) fuzz harness that, for each test input, runs BOTH binaries and byte-compares
stdout, stderr, AND exit code. Use /output/test11 (build it if missing: \`cd /output && rustc test11.rs\`).
Do not modify anything in /output — you are read-only on the port; build scratch work in /tmp.

Run AT LEAST 100,000 randomized cases plus a large structured corpus. Use a deterministic PRNG (no crates).
Cover, aggressively:
  * uniform random floats in [0,1], and in [-10,10]
  * random f32 bit patterns reinterpreted and printed with up to 17 significant digits
  * huge/tiny magnitudes: 1e-45..1e-38 subnormals, 1e38 near FLT_MAX, overflow/underflow strings
  * round-boundary decimals: values whose 7th significant digit is 5, and long digit strings
  * catastrophic cancellation triples (large opposite-signed values whose luma nearly cancels)
  * special strings: inf, -inf, INF, Infinity, nan, -nan, NAN, nan(0x1)
  * hex floats: 0x10, 0X1p4, 0x1.8p1, 0x.8p0, 0x
  * malformed: "", " ", "abc", "e5", "+", "-", ".", "1e", "1e+", "0.5abc", " \\t 0.25", "--1", "1,5"
  * leading/trailing whitespace of every kind
  * argument counts 0,1,2,3,4,10 and empty-string args
  * cases mixing a valid and an invalid arg to check left-to-right exception ordering
Report every distinct MISMATCH CLASS you find (dedupe near-identical repros; report the minimal witness for
each class). If you find zero mismatches after this volume, report passed=true and state exactly how many
cases you ran and what the corpus covered — do not claim coverage you did not execute.`,
  },
  {
    key: 'format-torture',
    prompt: `You are a FORMATTING SPECIALIST auditing the Rust port in /output against ${BIN}.
Do not modify /output; scratch work goes in /tmp. Build the port with \`cd /output && rustc test11.rs\` if
/output/test11 is missing.

Your single lens: is the printed representation of every double/float byte-for-byte identical to
\`std::cout <<\` default formatting (%g, precision 6)? Attack ONLY the formatter. Ignore parsing bugs unless
they change printed output.

Construct inputs that drive the SIX printed values into every formatting regime and compare byte-for-byte:
  * fixed vs scientific boundaries: results near 1e-5, 1e-4, 0.0001, 0.00001, 999999, 999999.5, 1000000
    (both for the invert results and for the luma result — remember you control the luma value by choosing R,G,B)
  * exponent formatting: e-06 vs e-6, three-digit exponents, e+38, e-38, e-45 (subnormal luma)
  * trailing zero suppression: results that are exactly 1, 2, 0.5, 1.5, 1.25, 0.100000
  * round-half cases: values exactly halfway at the 6th significant digit — verify round-half-to-EVEN, and
    verify against the reference, not against your assumption
  * negative zero: "-0" vs "0"; make BOTH invert and luma produce -0 if possible
  * inf/-inf/nan/-nan in each of the six slots independently
  * subnormal luma values, and luma values that underflow to zero
  * the largest and smallest magnitudes reachable
For each regime, show the exact command, the reference output, and the port output. Report every discrepancy
as a finding with a minimal repro. Aim for at least 500 targeted comparisons; be systematic, not random.`,
  },
  {
    key: 'compliance-audit',
    prompt: `You are a REQUIREMENTS COMPLIANCE AUDITOR for the deliverable in /output. Do not modify /output.

Verify each requirement literally and independently, by EXECUTING commands (not by reading code alone):
 1. Edition 2021 declared in Cargo.toml.
 2. ZERO external dependencies: Cargo.toml has no [dependencies] entries; no Cargo.lock referencing remote
    crates; \`grep -rn "extern crate\\|use [a-z_]*::" \` shows only std/core/crate/self/super paths. Confirm the
    build works fully offline (try \`cargo build --release --offline\`).
 3. \`cd /output && cargo build --release\` succeeds. Report ALL warnings verbatim (warnings are a defect here).
 4. \`cd /output && rustc test11.rs\` succeeds AND produces an executable named test11 in /output. Confirm
    /output/test11 exists, is executable, and runs. Report any warnings.
    Then confirm the freshly-rustc-built binary reproduces all five documented examples.
 5. /output/test11.rs exists at the package ROOT (not in src/).
 6. Library code is genuinely organized into MODULES (multiple files, not one monolith) and the module graph is
    reachable from test11.rs.
 7. The five documented example cases from /workspace/dataset/test11.cpp reproduce byte-for-byte:
      "0.0 0.0 0.0" -> "1 1 1 0 0 0"
      "1.0 1.0 1.0" -> "0 0 0 1 1 1"
      "0.5 0.5 0.5" -> "0.5 0.5 0.5 0.5 0.5 0.5"
      "0.3 0.7 0.2" -> "0.7 0.3 0.8 0.57886 0.57886 0.57886"
      "1.0 0.0 0.0" -> "0 1 1 0.2126 0.2126 0.2126"
    and the no-argument default run matches the C++ binary.
 8. Both build paths (cargo release binary at /output/target/release/test11 and the rustc binary /output/test11)
    behave identically on a sample of inputs.
 9. Nothing extraneous or broken in /output (e.g. stale artifacts that break \`rustc test11.rs\`, a src/main.rs
    that conflicts with the [[bin]] target, etc.).
Report each requirement as pass/fail with the command output that proves it. Any failure is a finding.`,
  },
  {
    key: 'code-review',
    prompt: `You are a SENIOR RUST REVIEWER reading the port in /output (do not modify it). The C++ original is
/workspace/dataset/test11.cpp; the reference binary is ${BIN}.

Review for CORRECTNESS DEFECTS that fuzzing might miss because they only trigger on rare inputs. Read every
line of the formatter and the parser especially, and reason about:
  * Formatter: off-by-one in significant-digit counting; the exponent used to pick fixed-vs-scientific must be
    the exponent AFTER rounding to 6 significant digits (e.g. 999999.6 rounds to 1e+06 and must print
    "1e+06", not "1000000"); trailing-zero stripping must not eat a meaningful zero or leave a bare "."; the
    exponent must always carry a sign and at least two digits; integer-valued results must print without a
    decimal point; handling of 0, -0, inf, -inf, nan.
  * Parser: state machine gaps for hex floats, incomplete exponents ("1e"), lone sign, "0x" with no digits,
    inf/nan spellings, the exact ERANGE overflow AND underflow boundaries, and correct rounding of the decimal
    string to f32 (a naive digit-accumulate-then-divide loop accumulates error and will mis-round some inputs —
    check whether the implementation is correctly rounded, and if it defers to a std primitive, whether that
    primitive's semantics match strtof).
  * Precision model: confirm the f32/f64 choice and every cast point matches what the probes established, and
    that no accidental widening/narrowing sneaks in.
  * Panic safety: any unwrap/expect/index/slice that could panic on hostile input (a Rust panic prints a
    different message and exit code 101 than the C++ abort, so any reachable panic is a blocker).
  * Integer overflow in exponent handling on extreme inputs like "1e999999999999".
For each defect give a concrete input that triggers it, then ACTUALLY RUN both binaries on that input to confirm
the divergence before reporting it. Report only defects you have empirically confirmed or can prove by
inspection; mark unconfirmed-but-plausible ones as 'minor' and say they are unconfirmed.`,
  },
]

let round = 0
let finalVerdict = null
let repairLog = []

while (round < 4) {
  round++
  phase('Verify')
  const reports = (await parallel(VERIFIERS.map(v => () =>
    agent(`${GROUND}\n\nROUND ${round} OF ADVERSARIAL VERIFICATION.\n\n${v.prompt}`,
      { label: `verify:${v.key}#${round}`, phase: 'Verify', schema: VERIFY_SCHEMA })
  ))).filter(Boolean)

  const failing = reports.filter(r => !r.passed)
  const allFindings = reports.flatMap(r => (r.findings || []).map(f => ({ ...f, lens: r.lens })))
  const blockers = allFindings.filter(f => f.severity !== 'minor')

  log(`Round ${round}: ${reports.length} verifiers, ${failing.length} failing, ${allFindings.length} findings (${blockers.length} blocker/major)`)

  finalVerdict = { round, reports, allFindings }

  if (allFindings.length === 0) {
    log(`Round ${round}: CLEAN — all verifiers passed with zero findings.`)
    break
  }

  phase('Repair')
  const fixSummary = await agent(`${GROUND}

You are the REPAIR ENGINEER for the Rust port in /output. Adversarial verifiers found the following issues in
round ${round}. Fix every blocker and major finding, and every minor finding that is genuinely a divergence
from the C++ reference.

${SPEC}

FINDINGS:
${allFindings.map((f, i) => `
[${i + 1}] (${f.severity}) [${f.lens}] ${f.title}
    repro:    ${f.repro}
    expected: ${f.expected}
    actual:   ${f.actual}`).join('\n')}

For EACH finding: first reproduce it yourself by running both binaries. If it does not reproduce, say so and do
not "fix" it — a spurious fix can introduce a real regression. If it does reproduce, fix the root cause (not the
symptom) and re-run that repro to confirm.

After all fixes:
 * rebuild BOTH ways: \`cd /output && cargo build --release\` and \`cd /output && rustc test11.rs\` (leaving the
   executable /output/test11 in place), with zero warnings
 * re-run a regression differential of at least 2,000 inputs versus ${BIN}, including the five documented
   examples and every repro above, byte-comparing stdout+stderr+exit code
Return: which findings you fixed and how, which you rejected and why, and the regression results.`,
    { label: `repair#${round}`, phase: 'Repair' })

  repairLog.push({ round, findings: allFindings.length, fixSummary })
}

return {
  rounds: round,
  implementation: implReport,
  repairs: repairLog,
  finalFindings: finalVerdict ? finalVerdict.allFindings : [],
  verifierSummaries: finalVerdict ? finalVerdict.reports.map(r => ({ lens: r.lens, passed: r.passed, summary: r.summary })) : [],
  probeConclusions: probes.map(p => ({ topic: p.topic, conclusions: p.conclusions })),
}
