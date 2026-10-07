export const meta = {
  name: 'test11-spec-verify',
  description: 'Reverse-engineer + adversarially verify the exact observable spec of the C++ test11 binary (hopscotch load-factor arithmetic, glibc %g float printing, std::stoi/argv semantics) and emit test corpora',
  phases: [
    { title: 'Spec', detail: 'three independent spec derivations against the real binary + gcc' },
    { title: 'Refute', detail: 'adversarial verification: try to break each spec with counterexamples' },
  ],
}

const GROUND_TRUTH = `
GROUND TRUTH ALREADY ESTABLISHED (verify, do not assume):
The C++ program (/workspace/dataset/test11.cpp) is:
    int count = 11;
    if (argc > 1 && std::string(argv[1]) == "--a") { count = std::stoi(argv[2]); }
    tsl::hopscotch_map<int,int> map;
    for (int i = 0; i < count; i++) map.insert({i, i*9});
    std::cout << map.load_factor() << " ";
    map.max_load_factor(0.5);
    map.rehash(0);
    std::cout << map.load_factor() << std::endl;

Reference binary: /workspace/dataset/test11_executable  (run it freely, any args)
Compilers available: gcc/g++ 12.1.0 (in PATH). rustc/cargo 1.75.0. NO python.
IMPORTANT: The hopscotch-map C++ library headers are NOT present on disk and you must
NOT try to find or read them anywhere. This is a strictly black-box exercise: derive
everything from running the binary and from first principles.

Working hypothesis for the map arithmetic (derived from ~120 probe points, all matched):
  - bucket_count starts at 0; size() counts distinct keys inserted (keys 0..count-1 are distinct).
  - load_factor() = (size as f32) / (bucket_count as f32), but returns exactly 0.0f when bucket_count==0.
  - max_load_factor default = 0.9f  (0.9f == 0.89999997615814208984375)
  - load_threshold = (usize)((f32)bucket_count * max_load_factor)   // C-style truncation
  - before inserting each NEW element: if size() >= load_threshold { bucket_count = max(1,bucket_count)*2;
    recompute threshold }   (growth chain 0 -> 2 -> 4 -> 8 -> 16 ...; from 0 it lands on 2 because
    the growth policy's next count is (mask+1)*2 with mask=0)
  - max_load_factor(0.5) sets mlf=0.5f and recomputes threshold.
  - rehash(0) sets bucket_count = round_up_to_power_of_two( ceil( (f32)size / mlf ) ), and 0 stays 0.
  - Printing uses std::cout on a float with default flags == C printf("%g", (double)f) i.e. 6 significant
    digits, trailing zeros stripped, correct rounding (ties-to-even) of the exact binary value.
`

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'verdict', 'rules', 'counterexamples', 'artifacts', 'notes'],
  properties: {
    title: { type: 'string' },
    verdict: { type: 'string', enum: ['hypothesis-confirmed', 'hypothesis-corrected', 'hypothesis-refuted'] },
    rules: {
      type: 'array',
      description: 'Precise, implementable rules. Each must be unambiguous enough to code from directly.',
      items: { type: 'string' },
    },
    counterexamples: {
      type: 'array',
      description: 'Concrete inputs where the hypothesis was WRONG, with observed vs predicted. Empty if none.',
      items: { type: 'string' },
    },
    artifacts: {
      type: 'array',
      description: 'Absolute paths of files written (corpora, reference C programs, logs) with a one-line description each.',
      items: { type: 'string' },
    },
    notes: { type: 'string', description: 'Anything a Rust implementer must not get wrong.' },
  },
}

const REFUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'confidence', 'breaks', 'corrections'],
  properties: {
    refuted: { type: 'boolean', description: 'true if you found at least one real counterexample to the spec' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    breaks: {
      type: 'array',
      description: 'Concrete failing cases: exact command, expected-per-spec, actual-from-binary.',
      items: { type: 'string' },
    },
    corrections: {
      type: 'array',
      description: 'Corrected rules that DO hold, replacing any broken ones.',
      items: { type: 'string' },
    },
  },
}

const TASKS = [
  {
    key: 'map-arithmetic',
    prompt: `${GROUND_TRUTH}

YOUR JOB: exhaustively validate/correct the MAP ARITHMETIC + growth/rehash model.

Method (do this concretely, do not reason in the abstract):
1. Write a C reference program /workspace/spec/model.c that takes an integer count and prints
   the two load factors exactly as the C++ program would, using the hypothesis above
   (float arithmetic, printf("%g %g\\n")). Compile with gcc -O2 -o /workspace/spec/model.
   Use 'float' types where the hypothesis says f32, and truncating casts where it says truncation.
2. Write a shell driver that, for EVERY count in 0..=4200 and for a large sampled set beyond that
   (all powers of two +/- 1 up to 2^22, all computed growth boundaries thr and thr+1 for every
   bucket_count up to 2^24, plus values like 10000, 100000, 1000000, 4194304), compares
   ./model N against /workspace/dataset/test11_executable --a N byte-for-byte.
   NOTE: very large counts are slow in the real binary - keep the sampled set above ~1e6 small
   (a handful) so the whole sweep finishes in a few minutes. Log every mismatch.
3. Report the exact count of cases compared and mismatches found. If there are mismatches, find the
   corrected rule (e.g. a different default max_load_factor, a different rounding, an off-by-one in
   the >= vs > comparison, or a minimum bucket count) and re-validate until zero mismatches.
4. Also determine and state: the exact growth-boundary table (bucket_count -> load_threshold) for
   bucket_count in {0,2,4,...,2^24}, and confirm whether rehash(0) can SHRINK bucket_count
   (find a count where size/0.5 rounds to fewer buckets than currently allocated, and check).
5. Save the full expected-output table for counts 0..=4200 to /workspace/spec/expected_counts.tsv
   with lines "<count>\\t<stdout bytes>" taken from the REAL BINARY (not your model).

Return the verified rules. Be precise about float vs double at every step.`,
  },
  {
    key: 'g-format',
    prompt: `${GROUND_TRUTH}

YOUR JOB: produce a complete, implementable spec of how the program prints a float, i.e. glibc
printf("%g") on a double that came from a float, AND generate a large test corpus for differential
testing of a from-scratch Rust implementation.

Method:
1. Write /workspace/spec/gen_gcorpus.c that, for a large set of float bit patterns, prints one TSV
   line per value: "<8-hex-digit u32 bit pattern>\\t<printf("%g", (double)f) output>".
   Cover, at minimum:
     - every value n / 2^k that a load factor can be: for k in 1..=24 and n in 0..=min(2^k, 4096)
       (computed as (float)n / (float)(1<<k)) -- these are the values that actually matter
     - 0.0f, and values whose 6-significant-digit rounding is an exact tie (e.g. 57/128 = 0.4453125,
       n/2^k values ending in ...5 at the 7th significant digit) -- enumerate MANY of these, they are
       where naive implementations break
     - values that straddle the %g style switch: X < -4 or X >= 6 (e.g. 1e-5, 9.99999e-5, 1e6,
       999999.5, 1234567.0), plus 1e-45 (subnormal), FLT_MAX, FLT_MIN
     - a deterministic pseudo-random sweep (xorshift32 seeded with a fixed constant) of 200000 bit
       patterns, skipping NaN/Inf
   Compile and run it, writing the corpus to /workspace/spec/gcorpus.tsv. Report its line count.
2. From first principles + experiments, write down the EXACT algorithm C99 %g uses with precision 6:
   how X (the decimal exponent) is chosen AFTER rounding, when style e vs style f is used, the
   exact precision passed to each style, trailing-zero stripping, decimal-point stripping, the
   minimum-2-digit exponent field, and the rounding mode used on the exact binary value
   (demonstrate with a real experiment whether glibc does round-half-even on the EXACT value, e.g.
   compare 0.4453125 -> ? and 0.4453135... style cases, and a case where the value is just above
   or just below a decimal tie).
   Include at least 6 worked examples with the actual printf output pasted in.
3. Explicitly enumerate the traps: e.g. a value like 9.999995e-5 where rounding to 6 sig digits
   changes the exponent and therefore the style; and 0.0 -> "0".
Return the algorithm as numbered rules precise enough to implement with big-integer decimal
expansion and nothing else.`,
  },
  {
    key: 'cli-stoi',
    prompt: `${GROUND_TRUTH}

YOUR JOB: nail down the exact command-line / std::stoi / failure-path behaviour, byte-for-byte,
including exit statuses and which stream each byte goes to.

Already observed (re-verify each):
  no args            -> stdout "0.6875 0.34375\\n", rc 0
  --b / --A / "--a " / --a= -> same as no args (count stays 11)
  --a 11             -> same
  --a  (argv[2] missing) -> rc 134, stdout empty, stderr:
        "terminate called after throwing an instance of 'std::logic_error'\\n  what():  basic_string::_S_construct null not valid\\n"
  --a abc            -> rc 134, stderr "...'std::invalid_argument'\\n  what():  stoi\\n"
  --a 99999999999999999999 -> rc 134, stderr "...'std::out_of_range'\\n  what():  stoi\\n"
  --a -5             -> stdout "0 0\\n"
  --a 007 -> 7 ; --a " 12" -> 12 ; --a 12abc -> 12 ; --a 3.9 -> 3 ; --a +7 -> 7 ; --a 0x10 -> 0

Method: probe the binary systematically and report a complete decision table covering:
1. argv[1] matching: exact string equality with "--a" only? Confirm argc==1, and argv[1] values
   "--a" with trailing/leading spaces, "--A", "-a", "", "--a=5".
2. Full std::stoi(base 10) semantics as a parser: leading whitespace set (test space, \\t, \\n, \\v,
   \\f, \\r, and non-ASCII), optional +/-, digits, first invalid char stops parsing, empty digit
   sequence -> invalid_argument, value outside [INT_MIN, INT_MAX] -> out_of_range. Test the exact
   boundaries: "2147483647", "2147483648", "-2147483648", "-2147483649", "  -0", "-", "+", "",
   "  \\t\\n +42xyz", "9223372036854775808", "0000000000000000000000000000012".
   Report EXACTLY which inputs throw which exception.
3. For each throwing case: capture stderr with 'od -c' and give the exact byte sequence, the exit
   code, and whether any stdout was produced. Confirm the process dies via SIGABRT (rc 134).
4. Whether stdout is flushed before the abort (does the first load factor ever get printed before a
   later failure? note the parse happens before any printing, so probably not - confirm).
5. What happens with a huge count that is valid but enormous (e.g. --a 100000000): does it succeed?
   Time it; if it is too slow just note the extrapolated behaviour, do not wait more than ~60s.
6. Anything about locale, or extra args being ignored.

Return a complete, implementable decision table. A Rust implementer must be able to reproduce every
byte and every exit code from your rules alone.`,
  },
]

phase('Spec')

const results = await pipeline(
  TASKS,
  (t) => agent(t.prompt, { label: `spec:${t.key}`, phase: 'Spec', schema: SPEC_SCHEMA }),
  (spec, t) => {
    if (!spec) return null
    return parallel(['counterexample-hunter', 'boundary-and-rounding-skeptic'].map((lens) => () =>
      agent(`${GROUND_TRUTH}

You are the "${lens}" adversarial verifier. Another agent produced this spec for the area "${t.key}":

TITLE: ${spec.title}
VERDICT: ${spec.verdict}
RULES:
${spec.rules.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}
NOTES: ${spec.notes}
ARTIFACTS: ${spec.artifacts.join(' | ')}

Your job is to REFUTE it. Actually run /workspace/dataset/test11_executable and/or gcc-compiled C
reference programs to hunt for inputs where the stated rules predict something different from
reality. Do not take the spec's word for anything; re-derive independently where cheap. Focus on
boundaries, exact-tie rounding, off-by-one in >= vs >, float-vs-double confusion, sign/overflow
edges, and the empty/zero cases. If after genuine effort you cannot break it, say refuted=false —
but you must have run real commands to say that. Report every break with the exact command and the
observed vs predicted bytes.`,
        { label: `refute:${t.key}:${lens}`, phase: 'Refute', schema: REFUTE_SCHEMA })
    )).then((votes) => ({ key: t.key, spec, votes: votes.filter(Boolean) }))
  }
)

const out = results.filter(Boolean)
for (const r of out) {
  const broken = r.votes.filter((v) => v.refuted).length
  log(`${r.key}: ${r.spec.verdict}, ${broken}/${r.votes.length} verifiers refuted`)
}
return out
