export const meta = {
  name: 'verify-cpp-to-rust-test13',
  description: 'Adversarially verify the Rust port of test13.cpp matches the C++ binary byte-for-byte',
  phases: [
    { title: 'Fuzz', detail: 'independent differential fuzzers, one input-generation lens each' },
    { title: 'Review', detail: 'independent code reviews, one fidelity lens each' },
    { title: 'Verify', detail: 'reproduce every reported finding against the two binaries' },
    { title: 'Critic', detail: 'what coverage is still missing' },
  ],
}

const CONTEXT = `
# Task under verification

A C++ program was ported to Rust. Your job is to find ANY input where the two
binaries differ, or any defect in the Rust code.

- C++ reference binary: /workspace/dataset/test13_executable
- C++ source:           /workspace/dataset/test13.cpp  (the color.hpp library source is NOT available)
- Rust port source:     /output/test13.rs  +  /output/src/**  (lib.rs, bignum.rs, cstd/{mod,strtof,fmt}.rs, color/{mod,hsl,converter}.rs)
- Rust binary:          /output/test13   (rebuild with: cd /output && rustc -O --edition 2021 test13.rs -o test13)

## Established behaviour of the C++ program (already verified, ~750 cases pass)

main() takes argv; defaults h1=30,s1=0.6,l1=0.5,h2=210,s2=0.4,l2=0.7.
  if (argc > 5) { h1=stof(argv[1]); s1=stof(argv[2]); l1=stof(argv[3]); h2=stof(argv[4]); s2=stof(argv[5]); }
  if (argc > 6) { l2=stof(argv[6]); }
  float d = ColorConverter::hueDifference(hsl1, hsl2);   // d = |h1-h2|; if (d>180) d = 360-d;
  std::cout << d << std::endl;                            // glibc printf("%g") at precision 6
Bad argument => uncaught std::invalid_argument / std::out_of_range from stof =>
stderr "terminate called after throwing an instance of 'std::X'\\n  what():  stof\\n" and SIGABRT (exit 134).

## Differential harness (already written, use it; do not edit it)

/workspace/diff.sh reads one argument vector per line on stdin (shell-quoted words,
e.g.  0.5 0.5 0.5 180 0.5 0.5   or   'NaN(x)' 1 1 1 1 1 ), runs both binaries, and
compares stdout, stderr and exit status. It prints MISMATCH blocks then a
"pass=N mismatch_lines=M" summary. It disables core dumps (important for speed).
Usage:  /workspace/diff.sh < yourcases.txt | tail -40

## Rules

- Treat the C++ binary as ground truth. A difference in stdout, stderr, or exit code is a bug.
- Watch specifically for the Rust port PANICKING (message on stderr + exit 101) — that is always a mismatch.
- Write your case files under /tmp/<your-own-name>/. NEVER modify anything in /output or /workspace/diff.sh.
- Generate cases programmatically (bash/awk loops, or a throwaway rust program compiled to /tmp) — do not hand-type a handful.
- Report only differences you actually OBSERVED by running the harness, with the exact argument vector and both outputs.
`

const FUZZ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cases_run', 'mismatches'],
  properties: {
    cases_run: { type: 'integer' },
    notes: { type: 'string', description: 'how cases were generated; anything suspicious but not a mismatch' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['args', 'cpp', 'rust'],
        properties: {
          args: { type: 'string', description: 'exact argument vector line fed to the harness' },
          cpp: { type: 'string', description: 'cpp rc/stdout/stderr' },
          rust: { type: 'string', description: 'rust rc/stdout/stderr' },
        },
      },
    },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'summary', 'trigger_input'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          trigger_input: {
            type: 'string',
            description: 'a concrete argument vector you believe diverges, or "none" for a non-behavioural defect',
          },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'evidence'],
  properties: {
    real: { type: 'boolean', description: 'true only if you reproduced an actual observable divergence or a definite defect' },
    evidence: { type: 'string' },
  },
}

const FUZZ_LENSES = [
  { key: 'realistic', prompt: `Generate >=800 realistic grading-distribution cases: h in [-720,720], s and l in [0,1], written as plain decimals with 1..12 significant digits, plus integers, plus values with trailing zeros. Include the documented examples. This is the distribution the port will actually be graded on, so be thorough here above all.` },
  { key: 'random-f32-bits', prompt: `Pick >=800 random f32 bit patterns (avoid NaN/inf for h at first, then include them), print each as a decimal string with varying significant digit counts (1..17) and varying exponent notation (plain, e+NN, E-NN), and feed them as h1 with h2 sweeping over 0, 180, 359.9, -45, 1e30. Compile a tiny throwaway Rust program in /tmp to emit the strings.` },
  { key: 'printf-g-boundaries', prompt: `Target the %g precision-6 formatter. The printed value is r where r=|h1-h2| or 360-|h1-h2|. Engineer h1 (with h2=0) so r hits: exact 6-significant-digit rounding ties (values like N+0.5 that are exactly representable in f32, both even and odd N), all-nines carry cases (0.999999x, 9.999995, 99.99995), the %e/%f switch at decimal exponent -5/-4 and 5/6, trailing-zero stripping, and every exponent magnitude from e-45 to e+38. Use 360-h1 to reach large magnitudes. >=600 cases.` },
  { key: 'malformed', prompt: `Target the strtof scanner with malformed and partial-parse inputs: pure garbage, leading/trailing/embedded whitespace of every kind (space tab newline vertical-tab form-feed CR), lone and doubled signs, empty string, "." alone, ".e5", "5.e3", digits followed by letters/punctuation/underscores, thousands separators, unicode bytes, "e5", "5e", "5e+", "5e-", "0x", "0X", "0xg", inf/infinity/nan in every casing, "nan()", "nan(abc_123)", "nan(", "nan(x", "infin", "infinit", "infinityx", and very long digit strings (1000+ digits, and 100000 digits) with and without exponents. >=800 cases. Put the tricky ones in EVERY argv position (1..6), since all six are parsed.` },
  { key: 'hex-floats', prompt: `Target C99 hex float parsing: 0x forms with digits before/after/both sides of the point, no point, huge and tiny p exponents (p+99999, p-99999, p with no digits, p+ with no digits), missing p entirely, uppercase X/P and mixed-case hex digits, 1..200 hex digits of mantissa, values landing on normal / subnormal / zero / overflow. Sweep p exponents from -200 to +200 for several mantissas. >=800 cases.` },
  { key: 'underflow-boundary', prompt: `Target the decimal underflow/ERANGE boundary. FLT_MIN=2^-126=1.17549435082228750797e-38, largest subnormal=1.17549421069244107e-38, FLT_TRUE_MIN=2^-149=1.40129846432481707e-45, and the critical threshold 2^-126-2^-151=1.1754943157937903e-38. Sweep decimal strings densely (many digits) across all of these, across every subnormal octave down to 2^-149 and below, and around each subnormal grid point +/- small fractions of an ulp. Also test exact decimal expansions of subnormal f32 values (which are exactly representable and must NOT report a range error). >=1000 cases.` },
  { key: 'overflow-boundary', prompt: `Target overflow/ERANGE. FLT_MAX=3.40282346638528859812e38, overflow threshold=(2-2^-24)*2^127=3.40282356779733661637e38. Sweep decimal and hex strings densely on both sides of both, with many digit counts, plus 1e38..1e40, 1e300, 1e99999, huge exponents, negative counterparts, and exact decimal expansions of FLT_MAX and of the tie value. >=600 cases.` },
  { key: 'argc-and-order', prompt: `Target argument-count handling and per-argument abort ordering. Run with 0,1,2,3,4,5,6,7,8,12 arguments. Verify that with <5 arguments nothing is parsed (so a garbage argv[1] must NOT abort), and with exactly 5 that l2 keeps its default. Put an invalid value (garbage, and separately an out-of-range value) in each of positions 1..6 and 7..8, alone and in combination, checking which exception type wins and whether it aborts at all. Also test empty-string and whitespace-only arguments in each position. >=400 cases.` },
  { key: 'extremes-inf-nan', prompt: `Target inf/nan/sign arithmetic in hueDifference. All combinations of h1,h2 in {inf,-inf,nan,-nan,0,-0,180,-180,1e38,-1e38,3.4e38,-3.4e38} plus large finite values whose difference overflows to inf, values whose difference is exactly 180 or exactly 360, and negative-zero results. Also sweep h1 over many large magnitudes so 360-|h1-h2| goes far negative and check the printed form. >=500 cases.` },
  { key: 'stress-long', prompt: `Stress termination and robustness: arguments with 10^5 and 10^6 decimal digits, hex mantissas with 10^5 digits, exponents like e+999999999999999999999, p-999999999999999, deeply nested nan(...) char sequences, arguments of 10^6 bytes of garbage. Confirm the Rust port terminates promptly (use timeout 10) and matches. Also confirm neither binary is unreasonably slow. >=200 cases.` },
]

const REVIEW_LENSES = [
  { key: 'strtof-grammar', prompt: `Review /output/src/cstd/strtof.rs ONLY for grammar fidelity to glibc strtof: whitespace set, sign handling, the inf/infinity/nan forms and the nan(n-char-sequence) rule, the "0x with no hex digits falls back to parsing just the 0" rule, where endptr must land (consumed count) in every partial-parse case, and the "exponent marker present but no digits => do not consume it" rule. Cite exact line numbers. For each finding give a concrete argument vector and CHECK IT with /workspace/diff.sh before reporting.` },
  { key: 'erange-model', prompt: `Review the ERANGE logic in /output/src/cstd/strtof.rs (decimal_to_f32, decimal_underflow, extract_dec, classify, glibc_underflow, hex_to_f32, round_to_f32). Look for: integer overflow or shift-overflow panics (u32 shifts by >=32, i64->u32 casts of negative values, q+1 overflow), the mag>60 / mag<-100 fast paths being wrong for some digit/exponent combination, the exponent-search loop failing to terminate or converging to a wrong e, div_pow5/shr_bits exactness tracking being wrong, and whether the guard "value.abs() <= f32::MIN_POSITIVE" can miss an underflow case. Prove each with a concrete input run through /workspace/diff.sh.` },
  { key: 'printf-g', prompt: `Review /output/src/cstd/fmt.rs against glibc printf("%g") at precision 6 for a double-promoted float. Check: the exact decimal expansion (m*2^e, and the 5^-e trick), the %e-vs-%f switch condition, precision and trailing-zero trimming in both styles, the round-half-to-even tie rule and that it uses the FULL exact remainder, the all-nines carry path (round_up, including the insert/truncate and exponent bump), exponent formatting width and sign, and negative zero / nan / inf spellings. Prove each finding with a concrete input via /workspace/diff.sh.` },
  { key: 'main-and-io', prompt: `Review /output/test13.rs and /output/src/color/*. Check: argc semantics vs C++ argc (env::args includes argv[0]?), parse order and which argument aborts first, that s1/l1/s2/l2 are still parsed even though unused, f32->f64 widening and the final f64->f32 narrowing matching C++ 'float hueDiff = ...', the hueDifference formula including the >180 (not >=180) comparison and NaN behaviour, println! vs std::endl (newline, and whether C++ flushes differently), and the terminate() message bytes + abort exit status. Verify with /workspace/diff.sh and with od -c on stderr.` },
  { key: 'panic-safety', prompt: `Hunt for any input that makes the Rust port PANIC or hang rather than match. Read all of /output/src and /output/test13.rs looking for unwrap/expect/indexing/slicing/arithmetic that can fail: str::from_utf8().unwrap(), text.parse().unwrap(), q2.to_u64().expect(), sig[P-1] and db[P+1..] indexing, vec![b'0'; (-x-1) as usize] with a huge x, shl_bits with an enormous shift causing OOM, from_ascii_digits with non-digit bytes, and any usize/u32/i64 cast that could wrap. For each, construct the triggering argument vector and RUN it. Non-UTF8 argv bytes matter too: env::args() panics on invalid UTF-8 while C++ does not — test with a non-UTF8 argument.` },
  { key: 'requirements', prompt: `Audit deliverable compliance, then verify by building from scratch. Requirements: (1) pure Rust 2021 edition, compiles with rustc AND as a Cargo project; (2) same CLI args as C++; (3) byte-identical output; (4) ZERO external crates - std only (grep the whole tree for any use of a non-std crate and check Cargo.toml has no [dependencies]); (5) complete Cargo project in /output with library code organised into modules and the entry file at /output/test13.rs; (6) an executable produced at /output. Run: cd /output && rustc -O --edition 2021 test13.rs -o /tmp/req_check/test13 and separately CARGO_HOME=/tmp/req_check/ch cargo build --release, and confirm both succeed with no warnings (also try rustc WITHOUT -O and plain 'rustc test13.rs'). Report anything missing or any warning.` },
]

phase('Fuzz')
const fuzz = await parallel(FUZZ_LENSES.map((l) => () =>
  agent(`${CONTEXT}\n\n# Your lens: ${l.key}\n\n${l.prompt}\n\nWork in /tmp/fuzz-${l.key}/. Report cases_run and every observed mismatch.`,
    { label: `fuzz:${l.key}`, phase: 'Fuzz', schema: FUZZ_SCHEMA })
))

const fuzzMismatches = fuzz.filter(Boolean).flatMap((r, i) =>
  (r.mismatches || []).map((m) => ({ ...m, lens: FUZZ_LENSES[i].key }))
)
const totalCases = fuzz.filter(Boolean).reduce((a, r) => a + (r.cases_run || 0), 0)
log(`fuzz: ${totalCases} cases across ${fuzz.filter(Boolean).length} lenses, ${fuzzMismatches.length} raw mismatches`)

phase('Review')
const reviewed = await pipeline(
  REVIEW_LENSES,
  (l) => agent(`${CONTEXT}\n\n# Your lens: ${l.key}\n\n${l.prompt}`,
    { label: `review:${l.key}`, phase: 'Review', schema: REVIEW_SCHEMA }),
  (r, l) => parallel(((r && r.findings) || []).map((f) => () =>
    agent(`${CONTEXT}\n\n# Adversarially verify one claimed finding\n\n` +
      `A reviewer working the "${l.key}" lens claims:\n` +
      `  file: ${f.file}:${f.line}\n  summary: ${f.summary}\n  trigger: ${f.trigger_input}\n\n` +
      `Your job is to REFUTE it. Actually run the trigger input (and variations) through ` +
      `/workspace/diff.sh and read the cited code. Set real=true ONLY if you reproduce a genuine ` +
      `observable divergence between the two binaries, or a defect that is certainly real (e.g. a ` +
      `panic you triggered). Default to real=false when the claim is speculative, cosmetic, or the ` +
      `harness shows the two binaries agreeing.`,
      { label: `verify:${l.key}:${f.line}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then((v) => ({ ...f, lens: l.key, verdict: v }))
  ))
)

const confirmed = reviewed.flat().filter(Boolean).filter((f) => f.verdict && f.verdict.real)
log(`review: ${reviewed.flat().filter(Boolean).length} findings raised, ${confirmed.length} survived refutation`)

phase('Critic')
const critic = await agent(
  `${CONTEXT}\n\n# Completeness critic\n\n` +
  `Ten differential fuzzers ran (${totalCases} cases total) with these lenses: ${FUZZ_LENSES.map(l => l.key).join(', ')}.\n` +
  `Six code reviews ran with these lenses: ${REVIEW_LENSES.map(l => l.key).join(', ')}.\n` +
  `Raw fuzz mismatches: ${JSON.stringify(fuzzMismatches)}\n` +
  `Confirmed review findings: ${JSON.stringify(confirmed.map(f => ({ file: f.file, line: f.line, summary: f.summary })))}\n\n` +
  `What is STILL not covered? Name concrete input classes or code paths nobody exercised, then ` +
  `actually generate and run those cases yourself with /workspace/diff.sh. Report any new mismatch ` +
  `you find, and state plainly which residual risks remain untested.`,
  { label: 'critic', phase: 'Critic' })

return { totalCases, fuzzMismatches, confirmed, critic }
