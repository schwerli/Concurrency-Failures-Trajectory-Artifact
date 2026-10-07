export const meta = {
  name: 'color-oracle-probe',
  description: 'Black-box probe of a C++ color-conversion binary to pin down exact f32 expression order, ostream %g formatting, and std::stof semantics',
  phases: [
    { title: 'Probe', detail: 'independent agents brute-force each sub-behavior against the oracle' },
    { title: 'Adversarial verify', detail: 'fresh-corpus refutation of each claimed finding' },
  ],
}

const BRIEF = `
# Mission
You are reverse-engineering a C++ color-conversion library by BLACK-BOX differential testing.

## Oracle
Compiled C++ binary: /workspace/dataset/test12_executable
Invoke: ./test12_executable <r> <g> <b>   (three decimal strings)
It prints ONE line, 13 space-separated values, then a newline:
  hsl.h hsl.s hsl.l  hsv.h hsv.s hsv.v  cmyk.c cmyk.m cmyk.y cmyk.k  yuv.y yuv.u yuv.v
With fewer than 3 args it uses defaults r=0.4 g=0.2 b=0.8.

The C++ library source (color.hpp) is NOT on disk and you MUST NOT try to find/read/download it.
Everything must be inferred from oracle observations.

## The driver program (this IS known - it is the test file)
    float r = 0.4f, g = 0.2f, b = 0.8f;
    if (argc > 3) { r = std::stof(argv[1]); g = std::stof(argv[2]); b = std::stof(argv[3]); }
    RGB rgb(r, g, b);
    HSL hsl = ColorConverter::rgbToHSL(rgb);
    HSV hsv = ColorConverter::rgbToHSV(rgb);
    CMYK cmyk = ColorConverter::rgbToCMYK(rgb);
    YUV yuv = ColorConverter::rgbToYUV(rgb);
    std::cout << hsl.h << " " << hsl.s << " " << hsl.l << " "
              << hsv.h << " " << hsv.s << " " << hsv.v << " "
              << cmyk.c << " " << cmyk.m << " " << cmyk.y << " " << cmyk.k << " "
              << yuv.y << " " << yuv.u << " " << yuv.v << std::endl;

## Facts ALREADY ESTABLISHED (trust these, but do not hesitate to refute with evidence)
All arithmetic is IEEE-754 binary32 (float), NOT double. Evidence: input (1,1,1) yields
yuv.v = 2.23517e-08, which is exactly 3 ulp of 0.1f -- a float artifact ~1e9x too large for double.

max/min are std::max/std::min-like 3-way reductions that return the FIRST argument on ties,
i.e. max = std::max(std::max(r,g),b) where std::max(a,b) = (a<b)?b:a, and
     min = std::min(std::min(r,g),b) where std::min(a,b) = (b<a)?b:a.
Evidence: input (-0.0, 0.0, 0.0) prints hsl.l = -0 and hsv.v = -0, which requires max == -0.0
(picking r over the equal +0.0 of g and b) and min == -0.0.
delta = max - min.

Hue (same value for HSL and HSV) uses this branch structure, in this order:
  if (max == min)            h = 0
  else if (max == r && g >= b) h = <60*(g-b)/delta>
  else if (max == r)           h = <60*(g-b)/delta + 360>
  else if (max == g)           h = <60*(b-r)/delta + 120>
  else                         h = <60*(r-g)/delta + 240>
Evidence: (0,0,-1)->h=60 (r branch wins tie over g); (0.5,1,1)->h=180 (g branch wins tie over b);
(1,0.5,1)->h=300 (r branch wins tie over b, g<b sub-branch);
(inf,0.2,0.3)->h=360 (proves the "+360" literal add, since 60*(g-b)/inf is -0 and a
plain "if (h<0) h+=360" normalisation would leave -0, printing "-0" not "360").
NOTE the <angle brackets> mean the ASSOCIATIVITY / literal types / intermediate precision are
NOT yet pinned down. That is part of what you may be asked to determine.

HSL: l = (max + min) / 2
     if (max == min) s = 0
     else if (l < 0.5) s = delta / (max + min)
     else              s = delta / (2 - max - min)
  (the l<0.5 vs l<=0.5 distinction is unobservable: l==0.5 iff max+min==1 iff 2-max-min==1)
Evidence: (1e-7,1e-8,1e-9) -> s=0.980198 = 9.9e-8/1.01e-7 (the low branch);
(0.123456789,0.987654321,0.5) -> s=0.972222 = 0.8641975/0.8888889 (the high branch);
(-1,-1,-1) -> s prints "0" not "-0", proving the max==min guard on s.

HSV: v = max
     s = (max == 0) ? 0 : delta / max
Evidence: (-1,-1,-1) -> hsv.s prints "-0" (= 0/-1), so s is NOT guarded by max==min;
(0,-0.5,0) -> hsv.s prints "0" via the max==0 guard (would be 0.5/0 = inf otherwise).

CMYK: k = 1 - max
      if (k == 1) { c = m = y = 0 }        // equivalently max == 0
      else { c = (1 - r - k)/(1 - k); m = (1 - g - k)/(1 - k); y = (1 - b - k)/(1 - k); }
Evidence: (0,-0.5,0) -> "0 0 0 1" (without the guard m would be 0.5/0 = inf);
(-1,-1,-1) -> "-0 -0 -0 2" (= 0/-1, so no delta-style guard);
(1.5,-0.5,2) -> "0.25 1.25 0 -1".

YUV, strictly left-to-right float ops:
      y = ((0.299f*r) + (0.587f*g)) + (0.114f*b)
      u = ((-0.147f*r) - (0.289f*g)) + (0.436f*b)
      v = ((0.615f*r) - (0.515f*g)) - (0.100f*b)
Evidence: (1,1,1) -> v = 2.23517e-08 which is exactly fl(fl(0.615f-0.515f)-0.1f); the
alternative grouping 0.615f-(0.515f+0.1f) evaluates to exactly 0 and is therefore refuted.
(-0.0,0.0,0.0) -> u prints "0" and v prints "-0", consistent with the above.

Output formatting is C++ ostream default float formatting = printf("%.6g", (double)value),
i.e. 6 SIGNIFICANT digits, trailing zeros stripped. Special values print as
"inf" / "-inf" / "nan" / "-nan" / "0" / "-0".

std::stof(argv[i]) semantics (glibc strtof + libstdc++ wrapper):
 - leading whitespace skipped; partial parse allowed ("0.5abc" -> 0.5); hex floats ("0x1p-1" -> 0.5);
   "inf"/"INFINITY"/"nan" accepted; "+.5" -> 0.5
 - no conversion possible  -> throws std::invalid_argument -> terminate -> SIGABRT (shell exit 134),
   stderr gets:  terminate called after throwing an instance of 'std::invalid_argument'\\n  what():  stof
 - ERANGE (overflow like "1e400", OR underflow to subnormal/zero like "1e-40", "1e-45")
   -> throws std::out_of_range, same terminate path with 'std::out_of_range'

## Tooling
g++ is at /opt/compiler/gcc-12/bin/g++ (gcc 12). rustc/cargo 1.75.0 are on PATH.
There is NO python3.
64 cores; use 'xargs -P 32' for mass oracle invocations.

## Methodology that works well here
To test a numeric hypothesis WITHOUT having to reimplement C++ ostream formatting, write your own
small C++ program that implements the candidate formula and prints with the IDENTICAL
'std::cout << a << " " << b ...' statement, compile with g++, and diff its stdout against the
oracle's stdout for the same args. Any diff is then purely numeric. Test at both -O0 and -O2
(watch for FMA contraction differences; also try -ffp-contract=off).
When feeding exact float values through the CLI, print them with "%.9g" so that stof recovers
the identical binary32, and AVOID subnormal/overflow strings (they abort).

## Hard rules
- Do NOT write anything into /workspace or /output. Use ONLY your own scratch directory.
- Do NOT install anything. Zero network.
- Your final message is a DATA return value consumed by a program, not prose for a human.
`

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'confidence', 'rust_code', 'evidence', 'refuted_alternatives', 'residual_risks'],
  properties: {
    area: { type: 'string', description: 'which sub-behaviour was probed' },
    confidence: { type: 'string', enum: ['certain', 'high', 'medium', 'low'] },
    rust_code: {
      type: 'string',
      description: 'Self-contained Rust (std only, 2021 edition) implementing the confirmed behaviour. Must compile as-is when pasted into a module. Include doc comments citing the discriminating inputs.',
    },
    evidence: {
      type: 'array',
      description: 'Concrete discriminating observations: exact input args, oracle output, and what it proves.',
      items: { type: 'string' },
    },
    refuted_alternatives: {
      type: 'array',
      description: 'Candidate variants tested and DISPROVED, each with the input that killed it.',
      items: { type: 'string' },
    },
    residual_risks: {
      type: 'array',
      description: 'Anything still unpinned or unobservable, and why it is safe (or not).',
      items: { type: 'string' },
    },
    corpus_size: { type: 'integer', description: 'number of distinct oracle invocations compared' },
    mismatches: { type: 'integer', description: 'remaining mismatches against the oracle (should be 0)' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason', 'counterexamples', 'corpus_size'],
  properties: {
    refuted: { type: 'boolean', description: 'true if you found ANY input where the claim disagrees with the oracle' },
    reason: { type: 'string' },
    counterexamples: {
      type: 'array',
      description: 'exact CLI args + oracle output + claimed output, for each disagreement found',
      items: { type: 'string' },
    },
    corrected_rust_code: { type: 'string', description: 'empty string if nothing to correct' },
    corpus_size: { type: 'integer' },
  },
}

const PROBES = [
  {
    key: 'hue',
    dir: '/tmp/probe/hue',
    task: `Pin down the EXACT float expression for hue (hsl.h and hsv.h are believed identical -- VERIFY that
they are identical for every input, including inf/nan cases, or report where they diverge).

For each of the four non-degenerate branches, determine the exact associativity, the types of the
literals, and whether any intermediate is computed in double before being stored to a float field.
Candidate axes to enumerate and cross-test (do a full cross product, do not guess):
  A1: (60.0f*(g-b))/delta          vs  A2: 60.0f*((g-b)/delta)
  A3: 60.0*(double)(g-b)/(double)delta  (double intermediate, then rounded to float on store)
  B1: result + 360.0f              vs  B2: result + 360 (int->float)  vs  B3: double add then store
  and the analogous +120 / +240 forms, plus the possibility that the multiplier is written as
  '60' (int) which converts to float, or that the whole expression is double because a literal
  like '360.0' or '60.0' is a double literal (this is VERY common in real C++ code and would make
  the ENTIRE expression double-precision with a final round-to-float on assignment -- test it hard).
  Also consider the '(2 + (b-r)/delta)*60' style factored forms, e.g.
  C1: 60.0f*(2.0f+(b-r)/delta)  vs  C2: 60.0f*(b-r)/delta + 120.0f  -- these round differently.
  Also consider whether hue is stored in a float field or a double field: if hsl.h were a double
  computed from a double expression, more digits survive. Design inputs whose 6-significant-digit
  printout DISCRIMINATES float storage from double storage (i.e. where float rounding changes the
  6th significant digit). This is the single most important discrimination -- spend effort here.

Build a large corpus (>= 40000 triples) mixing: uniform [0,1]; values crafted so (g-b)/delta lands
near a decimal rounding boundary at the 6th significant digit; near-tie max values; exact-equality
ties; negatives; out-of-range; huge/small magnitudes; zeros and -0.0. Report the surviving variant.`,
  },
  {
    key: 'hsl_sl',
    dir: '/tmp/probe/hsl',
    task: `Pin down the EXACT float expressions for hsl.s and hsl.l.
Determine, by full cross-product testing:
  l:  (max+min)/2.0f   vs  (max+min)*0.5f   vs  double intermediate then store to float
      vs  a double field holding a double-precision result (design discriminating inputs!)
  s (low branch):  delta/(max+min)
  s (high branch): delta/(2.0f-max-min)  vs  delta/(2.0f-(max+min))  vs
                   delta/((2.0f-max)-min)  vs  double variants
  Note 'l < 0.5' vs 'l <= 0.5' is provably unobservable -- confirm that argument holds under
  inf/nan/-0 inputs too, and say so.
  Also determine whether the branch test uses l, or uses (max+min) < 1, or uses
  'l < 0.5f' with l already rounded to float -- design inputs where a double-precision l
  straddles 0.5 differently from a float-rounded l, if such inputs exist.
  Also probe the nan/inf behaviour of the max==min guard: does (nan,nan,nan) take the guard?
  (nan == nan is false, so it should NOT -- verify against the oracle.)

Corpus >= 40000 triples, heavily weighted to inputs where the high/low branch boundary and the
6th significant digit are both sensitive. Also include inf, -inf, nan, -0.0, and mixed sign zeros.`,
  },
  {
    key: 'hsv_sv',
    dir: '/tmp/probe/hsv',
    task: `Pin down the EXACT float expressions for hsv.s and hsv.v, and the exact form of the guard.
Cross-test:
  s: (max == 0) ? 0 : delta/max     vs   (max == 0.0f) with -0.0 subtleties: note -0.0 == 0.0 is
     TRUE in IEEE, so an input whose max is -0.0 takes the guard; verify with (-0.0,-0.0,-0.0)
     and (-0.0, 0.0, 0.0) and report exactly what the oracle prints for hsv.s there.
  Is the guard maybe 'if (max <= 0) s = 0'? Design an input with max < 0 (e.g. all-negative,
  which yields hsv.s = -0 per established facts) to discriminate <= from ==. Report which.
  Is the returned 0 possibly '0.0f' vs copying delta (which could be -0)? Discriminate.
  v: is it exactly max, or something like max (stored to a double field)? Discriminate float vs
     double storage with an input where they differ in the 6th significant digit -- note v = max
     is an exact copy of an input float so this may be unobservable; say so if it is.
  Also: confirm hsv.h == hsl.h bit-for-bit over the whole corpus, or find where they differ.
  Also: nan handling -- (nan,nan,nan): does the max==min guard on h apply? What does s print?

Corpus >= 40000 triples with the same diversity as the other probes.`,
  },
  {
    key: 'cmyk',
    dir: '/tmp/probe/cmyk',
    task: `Pin down the EXACT float expressions for cmyk.c, m, y, k and the guard.
Cross-test:
  k: 1.0f - max   vs  1 - max (int literal)  vs  double intermediate stored to float
  guard: 'if (k == 1)'  vs  'if (max == 0)'  vs  'if (1 - k == 0)'  vs 'if (k >= 1)'.
    Design inputs that discriminate! e.g. max slightly negative gives k slightly > 1: does the
    guard fire? (-1,-1,-1) is known to print "-0 -0 -0 2" so k=2 does NOT fire the guard,
    which already refutes 'k >= 1'. Find further discriminators, e.g. max = -0.0 (k == 1).
  channels: (1.0f - r - k)/(1.0f - k)   vs  (1.0f - r - k)/(1.0f - k) with a shared
    precomputed denominator (identical), vs  (1.0f - (r + k))/(1.0f - k),
    vs  ((1.0f - r) - k)/(1.0f - k),  vs  (max - r)/max  [algebraically equal when k = 1-max!
    note (1-r-k)/(1-k) == (max-r)/max exactly in real arithmetic -- these two DIFFER in float
    rounding, so this is a crucial discrimination], vs double intermediates.
    Test (max-r)/max very hard: it is a plausible implementation and algebraically identical.
  Also test the ordering variant where the code computes 'float inv = 1.0f/(1.0f-k)' and
    multiplies -- that rounds differently from dividing. Discriminate.

Corpus >= 40000 triples. Include inf/-inf/nan inputs and report exactly what the oracle prints
(established: (inf,0.2,0.3) -> cmyk "-nan -nan -nan -inf").`,
  },
  {
    key: 'yuv',
    dir: '/tmp/probe/yuv',
    task: `Confirm or refute the claimed YUV expressions and pin the exact constants and associativity.
Claimed:
      y = ((0.299f*r) + (0.587f*g)) + (0.114f*b)
      u = ((-0.147f*r) - (0.289f*g)) + (0.436f*b)
      v = ((0.615f*r) - (0.515f*g)) - (0.100f*b)
Cross-test at minimum:
  - constant precision: 0.299f vs 0.299 (double) -- if ANY constant is a double literal the whole
    expression becomes double and rounds to float only on the final store. TEST THIS EXHAUSTIVELY;
    it is the most likely failure mode. Try all-double, all-float, and mixed.
  - the u form: is it '-0.147f*r - 0.289f*g + 0.436f*b' (left-to-right, which is what is claimed)
    or '0.436f*b - 0.147f*r - 0.289f*g' or '-(0.147f*r) - ...'? Discriminate.
  - the v constant: 0.100f vs 0.1f (identical) but also 0.10f, and whether it might be
    0.615/-0.515/-0.100 with the signs folded into the constants and all three ADDED left to right:
    y = fma-free ((0.615f*r) + (-0.515f*g)) + (-0.100f*b). Note a+(-b) == a-b exactly in IEEE, so
    this is unobservable -- confirm and say so.
  - FMA contraction: verify the oracle is NOT using fused multiply-add by finding an input where
    contracted and non-contracted results differ, and reporting which the oracle matches.
    (Compile your candidate with -ffp-contract=fast -mfma to generate the contracted variant.)
  - also try the possibility that constants are 0.299, 0.587, 0.114 exactly as written but the
    accumulation is into a double and the FIELD is double (more surviving digits).

Corpus >= 60000 triples, weighted to inputs where the 6th significant digit is rounding-sensitive.`,
  },
  {
    key: 'fmt',
    dir: '/tmp/probe/fmt',
    task: `DELIVERABLE: a complete, self-contained pure-Rust (std only, no crates, 2021 edition) module that
formats an f32 EXACTLY as 'std::cout << value' does with default stream flags (i.e. exactly like
glibc printf("%.6g", (double)value)), for EVERY possible f32 bit pattern.

Build a C++ oracle for this: a program that reads hex f32 bit patterns from stdin and for each one
does 'std::cout << bitcast_to_float(pattern) << "\\n";' -- the SAME formatting path as the target
program. Compile with the same g++. Then build a Rust program that formats the same patterns with
your implementation, and diff the two outputs.

You must handle and verify:
 - the %g rule: round the value to 6 significant decimal digits FIRST, then let X be the decimal
   exponent of the ROUNDED value; if X < -4 or X >= 6 use scientific style with 5 fractional
   digits, else fixed style with (6 - 1 - X) fractional digits; then strip trailing zeros and a
   trailing '.'. Verify the exponent is computed AFTER rounding (e.g. 9.999995e5 style cases,
   0.0000999999949, and values that round up from 999999.x to 1e+06).
 - exponent formatting: 'e+06', 'e-08', at least two digits, three when needed (e.g. e-45, e+38).
 - rounding mode: glibc rounds the EXACT binary value; exact decimal ties (the expansion of a
   binary float is finite, so ties DO occur) are broken half-to-even. VERIFY this empirically and
   find at least two tie cases among f32 values. Do NOT use naive f64 arithmetic for rounding --
   implement exact big-integer / exact-decimal expansion so every one of the 2^32 patterns is right.
 - special values: nan -> "nan", nan with sign bit set -> "-nan", inf -> "inf", -inf -> "-inf",
   +0.0 -> "0", -0.0 -> "-0". Note the target program's values include -nan (established:
   (inf,0.2,0.3) prints "-nan"), so sign-bit-of-nan handling is REQUIRED.
 - subnormals and the extremes: 1e-45 (smallest subnormal) through 3.40282e+38.

Verification requirement: compare against the C++ oracle over (a) ALL f32 patterns in a systematic
sweep if you can make it fast enough -- 2^32 is 4.3 billion, too many, so instead do (b) an
exhaustive sweep of ALL 2^24 patterns with exponent fields in a chosen critical set, PLUS at least
30 million uniformly random patterns, PLUS every pattern within +-64 ulp of every decimal power of
ten from 1e-45 to 1e38, PLUS all subnormals with mantissa < 2^16, PLUS the specific values produced
by the color pipeline. Use batched stdin/stdout (one process, millions of lines) so this is fast,
and 'cmp' the two output files. Report the exact corpus sizes and 0 mismatches.

Return the full Rust module source in rust_code. It should expose:
    pub fn fmt_cout(v: f32) -> String
and be written so that a 13-value line can be assembled from it. Keep it dependency-free and
reasonably tidy; a small internal big-unsigned-integer helper is fine and expected.`,
  },
  {
    key: 'stof',
    dir: '/tmp/probe/stof',
    task: `DELIVERABLE: a complete, self-contained pure-Rust (std only, no crates, 2021 edition) module
replicating std::stof(const std::string&) exactly, including its throwing behaviour.

Semantics to replicate (glibc strtof + libstdc++ __stoa wrapper):
    errno = 0; float v = strtof(s, &end);
    if (end == s) throw std::invalid_argument("stof");
    if (errno == ERANGE) throw std::out_of_range("stof");
    return v;
On an uncaught throw the process prints to STDERR:
    terminate called after throwing an instance of 'std::invalid_argument'
      what():  stof
(note: exactly two spaces after 'what():') and then aborts via SIGABRT (shell reports 134).
Same with 'std::out_of_range'. VERIFY the exact stderr bytes against the oracle
(run it with a bad arg and capture stderr with 2>file, then hexdump to confirm every byte,
including whether there is a trailing newline).

You must determine and replicate, by testing the oracle:
 - accepted grammar: leading whitespace (which chars exactly? test space, \\t, \\n, \\v, \\f, \\r),
   optional sign, then either
     * decimal digits with optional '.' and optional [eE][+-]digits
     * hex: 0x/0X hexdigits with optional '.' and optional [pP][+-]digits (and what happens with
       no 'p' exponent, and with "0x" followed by no hex digit -- does it parse as 0 with endptr
       after the '0'?)
     * inf / infinity (case-insensitive)
     * nan / nan(alphanumeric_sequence) (case-insensitive) -- and what SIGN the resulting nan has,
       and how it prints
 - partial parse: endptr semantics; "0.5abc" -> 0.5 with no error. " .5e" -> ? (the 'e' with no
   digits must not be consumed). "1e+" -> ? ".e3" -> ? "." -> ? "+" -> ? "" -> ?
   Test ALL of these against the oracle and record the exact behaviour.
 - ERANGE conditions: overflow ("1e400" -> out_of_range, and confirm "1e39" too);
   underflow -- establish the EXACT boundary. Established: "1e-40" and "1e-45" throw
   out_of_range. Binary-search the oracle for the exact threshold string where it stops throwing;
   the hypothesis is 'nonzero true value whose rounded result is subnormal (or zero) => ERANGE',
   i.e. threshold at FLT_MIN = 1.17549435e-38. Verify precisely with values just below/above
   FLT_MIN, and with a value that rounds UP to exactly FLT_MIN (does it throw?).
   Also: does exact "0" / "0.0" / "0e0" / "-0" throw? (should not). Does "1e-46" throw?
   Also test hex subnormals like "0x1p-149".
 - correct rounding: the decimal->binary32 conversion must be correctly rounded (round-half-even).
   Rust's own str::parse::<f32>() IS correctly rounded, so the clean design is: scan the input to
   find exactly the substring strtof would consume, then delegate to Rust's parser for the decimal
   case, and implement hex-float conversion yourself with exact rounding. VERIFY this delegation is
   safe including for huge digit strings (e.g. 800 digits), values near ties, and "0x" forms.
   Watch out: Rust's parse accepts "inf"/"infinity"/"NaN" but rejects hex; and Rust's parse returns
   Ok(inf) on overflow rather than an error, so you must detect overflow yourself for ERANGE.

Verification: build a C++ oracle program that calls std::stof on argv strings and prints
the result's raw hex bit pattern plus which exception (if any) was thrown; compile with the same
g++; then diff against your Rust implementation over a corpus of >= 200000 strings covering:
random decimal strings with 1..40 digits and exponents in [-60,60]; adversarial tie strings;
hex float strings; all the malformed forms above; whitespace variants; inf/nan spellings;
huge-digit-count strings; and the exact boundary region around FLT_MIN, FLT_MAX and the
subnormal range. Report exact corpus size and 0 mismatches.

Return the full Rust module source in rust_code, exposing something like:
    pub enum StofErr { Invalid, OutOfRange }
    pub fn stof(s: &str) -> Result<f32, StofErr>
plus a helper that replicates the terminate-and-abort path (write the exact stderr text, then
std::process::abort()).`,
  },
]

phase('Probe')

const results = await pipeline(
  PROBES,
  (p) => agent(
    `${BRIEF}\n\n## Your scratch directory (yours alone, already created)\n${p.dir}\n\n## Your specific assignment: ${p.key}\n${p.task}\n`,
    { label: `probe:${p.key}`, phase: 'Probe', schema: FINDING_SCHEMA, effort: 'high' }
  ),
  (finding, p) => {
    if (!finding) return null
    // Three independent refuters per finding, each with a distinct lens.
    const lenses = [
      'NUMERIC: hunt for inputs where the claimed float expression order/precision disagrees with the oracle. Generate your OWN fresh adversarial corpus (do not reuse theirs); target 6th-significant-digit rounding boundaries and branch boundaries.',
      'EDGE: hunt for disagreement on degenerate inputs -- signed zeros, exact ties between channels, inf, -inf, nan, values at the subnormal/normal boundary, FLT_MAX, and out-of-[0,1] inputs including large magnitudes.',
      'COMPILE: paste the claimed rust_code into a real rustc project, make it compile, and run it head-to-head against the oracle. Report any compile error, any API mismatch, and any behavioural difference. If it does not compile as given, that is a refutation -- return the fixed code.',
    ]
    return parallel(lenses.map((lens, i) => () =>
      agent(
        `${BRIEF}\n\n## Your scratch directory (yours alone -- create it)\n${p.dir}/verify${i}\n\n` +
        `## A prior agent probed "${p.key}" and CLAIMS the following. Your job is to REFUTE it.\n` +
        `Be adversarial. Default to refuted=false ONLY if you genuinely cannot break it after real effort.\n\n` +
        `### Claimed confidence: ${finding.confidence}\n` +
        `### Claimed Rust implementation\n\`\`\`rust\n${finding.rust_code}\n\`\`\`\n` +
        `### Claimed evidence\n${(finding.evidence || []).map(e => '- ' + e).join('\n')}\n` +
        `### Alternatives they claim to have refuted\n${(finding.refuted_alternatives || []).map(e => '- ' + e).join('\n')}\n` +
        `### Residual risks they admit\n${(finding.residual_risks || []).map(e => '- ' + e).join('\n')}\n\n` +
        `## Your lens for this refutation attempt\n${lens}\n`,
        { label: `refute:${p.key}:${i}`, phase: 'Adversarial verify', schema: VERDICT_SCHEMA, effort: 'high' }
      )
    )).then(verdicts => ({ key: p.key, finding, verdicts: verdicts.filter(Boolean) }))
  }
)

const clean = results.filter(Boolean)
for (const r of clean) {
  const nRef = r.verdicts.filter(v => v.refuted).length
  log(`${r.key}: ${r.finding.confidence}, corpus=${r.finding.corpus_size}, mismatches=${r.finding.mismatches}, refuters_objecting=${nRef}/${r.verdicts.length}`)
}

return clean.map(r => ({
  area: r.key,
  confidence: r.finding.confidence,
  corpus_size: r.finding.corpus_size,
  mismatches: r.finding.mismatches,
  rust_code: r.finding.rust_code,
  evidence: r.finding.evidence,
  refuted_alternatives: r.finding.refuted_alternatives,
  residual_risks: r.finding.residual_risks,
  refutations: r.verdicts.map(v => ({
    refuted: v.refuted,
    reason: v.reason,
    counterexamples: v.counterexamples,
    corrected_rust_code: v.corrected_rust_code || '',
    corpus_size: v.corpus_size,
  })),
}))
