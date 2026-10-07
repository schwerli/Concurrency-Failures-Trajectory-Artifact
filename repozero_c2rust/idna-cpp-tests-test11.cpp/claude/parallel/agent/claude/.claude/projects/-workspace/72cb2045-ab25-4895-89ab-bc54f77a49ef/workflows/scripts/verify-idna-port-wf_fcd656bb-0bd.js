export const meta = {
  name: 'verify-idna-port',
  description: 'Adversarially verify the Rust idna port matches the C++ binary byte-for-byte',
  phases: [
    { title: 'Spec', detail: 'per-API independent semantic derivation vs the Rust source' },
    { title: 'Fuzz', detail: 'differential fuzzing, distinct strategies, loop until dry' },
    { title: 'Critic', detail: 'completeness review of what was never exercised' },
  ],
}

const CPP = '/workspace/dataset/test11_executable'
const RS = '/output/test11'

const GROUND_RULES = `
ENVIRONMENT
- C++ reference binary (ground truth): ${CPP}
- Rust port under test:                ${RS}
- Rust source lives in /output (test11.rs, src/lib.rs, src/idna/*.rs). You may READ it.
- The C++ library source (idna.hpp / idna.cpp) does NOT exist on disk. Do not look for it.

HARD RULES
- You MUST NOT modify, create, or delete anything under /output. Read-only there.
- Do all scratch work under your own private scratch dir; create it with
  mkdir -p and use a path unique to you (given below). Never write to /tmp root directly.
- Both binaries take the SAME argv. Compare raw bytes of stdout AND the exit code.
- Compare with byte-exact tooling (cmp, or diff on files, or shell string equality on
  command substitution ONLY when you know there are no trailing-newline subtleties).
  Prefer writing stdout to files and using 'cmp -s'.
- Arguments may contain spaces, quotes, newlines, NUL-adjacent bytes, and invalid UTF-8.
  Quote your shell variables properly ("$x", not $x).
- Report ONLY real, reproduced divergences. If you cannot reproduce it twice, it is not
  a finding. Do not speculate about code you did not execute.
`

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['api', 'derivedSpec', 'rustMatches', 'divergences', 'probesRun'],
  properties: {
    api: { type: 'string' },
    derivedSpec: { type: 'string', description: 'Precise behavioural spec you derived from the binary, in one or two sentences' },
    rustMatches: { type: 'boolean', description: 'true only if the Rust implementation provably matches on every probe you ran' },
    probesRun: { type: 'integer', description: 'how many distinct inputs you actually executed both binaries on' },
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argvDescription', 'reproCommand', 'cppOutput', 'rustOutput'],
        properties: {
          argvDescription: { type: 'string' },
          reproCommand: { type: 'string', description: 'exact shell command that reproduces the difference' },
          cppOutput: { type: 'string' },
          rustOutput: { type: 'string' },
        },
      },
    },
  },
}

const FUZZ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy', 'casesExecuted', 'divergenceCount', 'divergences', 'notes'],
  properties: {
    strategy: { type: 'string' },
    casesExecuted: { type: 'integer' },
    divergenceCount: { type: 'integer' },
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['reproCommand', 'cppOutput', 'rustOutput'],
        properties: {
          reproCommand: { type: 'string' },
          cppOutput: { type: 'string' },
          rustOutput: { type: 'string' },
        },
      },
    },
    notes: { type: 'string', description: 'anything surprising, plus what you deliberately did NOT cover' },
  },
}

// ---------------------------------------------------------------- Phase 1: Spec
// One agent per API. Each independently derives the contract from the reference
// binary, then checks the Rust source against it. Independent derivation is the
// point: an agent that agrees with the port for the wrong reason is caught by the
// fuzz phase, but an agent that derives a *different* contract is caught here.

const APIS = [
  { name: 'to_ascii', hint: 'field 1 of the output line' },
  { name: 'to_unicode', hint: 'field 2. Probe prefix handling exhaustively, including case variants and partial prefixes.' },
  { name: 'punycode_encode', hint: 'field 3. Compare carefully against to_ascii — they are NOT the same.' },
  { name: 'punycode_decode', hint: 'field 4. Compare carefully against to_unicode.' },
  { name: 'is_valid_domain', hint: 'field 5 (prints 1/0). Binary-search every length boundary exactly; test multi-byte input where byte length and character count differ.' },
  { name: 'is_valid_label', hint: 'field 6 (prints 1/0). Binary-search the length boundary exactly. Does it look at dot-separated labels or the whole string?' },
  { name: 'is_ascii_domain', hint: 'field 7 (prints 1/0). Probe every boundary byte: 0x00, 0x7f, 0x80, 0xff. What about the empty string?' },
  { name: 'is_idn_domain', hint: 'field 8 (prints 1/0). Is it exactly the negation of field 7 for every input you try?' },
  { name: 'to_lower', hint: 'field 9. Is case folding ASCII-only or locale/UTF-8 aware? Probe accented Latin-1 UTF-8, Turkish dotted I, Greek, and bytes 0x80-0xff.' },
  { name: 'normalize', hint: 'field 10. Does it EVER differ from field 9? Try whitespace, trailing dots, mixed case, NFC/NFD pairs.' },
  { name: 'count_labels', hint: 'field 11 (prints an integer). How are empty labels, leading/trailing dots, and the empty string counted?' },
]

const specs = await pipeline(
  APIS,
  (api, _orig, i) => agent(
    `${GROUND_RULES}
Your private scratch dir: /tmp/wf-spec-${i}

TASK
You are reverse-engineering ONE function of the C++ idna library: \`idna::${api.name}\`.
It is exposed as ${api.hint}

The output line format is 11 space-separated fields in this order:
  to_ascii to_unicode punycode_encode punycode_decode is_valid_domain is_valid_label
  is_ascii_domain is_idn_domain to_lower normalize count_labels
Fields 1-10 are each followed by a space; field 11 is followed by a newline.

STEP 1 — Derive the contract. Run ${CPP} on many inputs and isolate your field.
Be systematic and adversarial: hunt for the input that breaks the obvious hypothesis.
Cover at minimum: empty string, single chars, pure ASCII, mixed case, non-UTF-8 bytes,
multi-byte UTF-8, dots in every position, the literal string "xn--" and variants,
and exact length boundaries (binary-search them; do not guess).
The reference binary is also an unstripped ELF — 'objdump -d' and 'nm -C' on it are
fair game and are the fastest way to confirm an exact constant. Use them to CONFIRM
what you observed behaviourally, not as a substitute for running the binary.

STEP 2 — Read the Rust implementation of this one function in /output/src/idna/
and state whether it matches the contract you derived.

STEP 3 — Try hard to FALSIFY the Rust version. Construct the inputs most likely to
break it given how it is written, and run BOTH binaries on them. Set rustMatches
false if and only if you actually reproduced a byte difference.

Return the structured result. probesRun must be the true count of inputs you executed.`,
    { label: `spec:${api.name}`, phase: 'Spec', schema: SPEC_SCHEMA }
  )
)

const specDivergences = specs.filter(Boolean).flatMap(s => s.divergences.map(d => ({ ...d, api: s.api })))
log(`Spec phase: ${specs.filter(Boolean).length}/${APIS.length} APIs analysed, ${specDivergences.length} divergence(s)`)
for (const s of specs.filter(Boolean)) log(`  ${s.api}: ${s.rustMatches ? 'match' : 'MISMATCH'} (${s.probesRun} probes) — ${s.derivedSpec}`)

// ---------------------------------------------------------------- Phase 2: Fuzz
// Distinct strategies rather than N identical fuzzers: each angle is blind to what
// the others surface. Loop until two consecutive rounds find nothing new.

const STRATEGIES = [
  { key: 'ascii-exhaustive', desc: 'Every single-byte input 0x01-0x7f, then all 2-byte and a large sample of 3-byte printable-ASCII combinations. Also every ASCII byte embedded at the start, middle and end of a longer string.' },
  { key: 'length-boundaries', desc: 'Lengths 0..300 of plain "a", and lengths straddling 63/64 and 255/256 built from multi-byte UTF-8 so byte-length and char-count diverge. Also lengths straddling boundaries with dots sprinkled in.' },
  { key: 'dots-and-labels', desc: 'Every arrangement of dots: leading, trailing, doubled, tripled, only-dots strings of length 0..40, dots mixed with empty labels, and long dot-heavy domains.' },
  { key: 'ace-prefix', desc: 'The "xn--" prefix in every mutation: exact, upper/mixed case (XN--, Xn--, xN--), truncated (x, xn, xn-), repeated (xn--xn--xn--), embedded mid-string, per-label (a.xn--b), prefix-only, prefix plus one char, and "xn--" with trailing dots.' },
  { key: 'utf8-and-high-bytes', desc: 'Valid UTF-8 across planes (Latin-1 supplement, Greek, Cyrillic, CJK, emoji, astral plane), plus every high byte 0x80-0xff alone and in sequences, plus deliberately INVALID UTF-8: lone continuation bytes, truncated sequences, overlong encodings, surrogate encodings.' },
  { key: 'control-and-whitespace', desc: 'Control bytes 0x01-0x1f and 0x7f, tabs, newlines, carriage returns, vertical tab, form feed, leading/trailing/interior whitespace runs, and mixtures with printable text. (0x00 cannot be passed through argv — note that rather than trying.)' },
  { key: 'case-folding', desc: 'Case folding stress: all-upper, all-lower, alternating, non-ASCII uppercase whose lowercase differs in Unicode (Ä, Σ, İ, Ǆ), German ß, Turkish dotless i, full-width Latin letters, and ASCII letters adjacent to high bytes.' },
  { key: 'argv-shape', desc: 'The CLI contract rather than the string algorithms: zero arguments (must print the built-in default trio), one argument, two, three, ten, fifty arguments; empty-string arguments alone and mixed with non-empty; arguments that look like flags (-h, --help, -); and a single argument that is 60KB long. Verify exit codes match too.' },
]

const seen = new Set()
const confirmed = []
let dryRounds = 0
let round = 0

while (dryRounds < 2 && round < 4) {
  round++
  const roundResults = await parallel(STRATEGIES.map((s, i) => () => agent(
    `${GROUND_RULES}
Your private scratch dir: /tmp/wf-fuzz-r${round}-${i}

TASK — differential fuzzing, round ${round}, strategy "${s.key}".

Your assigned angle:
${s.desc}

Write a shell (or python3) driver in your scratch dir that, for each generated input,
runs both binaries with that input as a single argv element, captures stdout to
separate files, and compares them with 'cmp -s'. Also compare exit codes. Print only
the mismatches, plus a final total of cases executed.

Generate inputs PROGRAMMATICALLY so you can cover hundreds to thousands of cases.
Use printf with escapes (e.g. printf '\\xff') or python3 to build byte sequences, and
pass them via a shell array or python subprocess with a list argv — never by
re-splitting a string. python3 + subprocess.run([...], capture_output=True) with
bytes arguments (os.fsencode / bytes objects) is the most reliable route for
arbitrary bytes; prefer it.

${round > 1 ? `Round ${round}: earlier rounds already covered the obvious ground for this angle and
found the divergences listed below. Go DEEPER and DIFFERENT — new input shapes,
longer strings, combinations with other angles, higher volume. Do not just re-run
what a previous round would have generated.
Already-known divergences (do not re-report): ${confirmed.length ? JSON.stringify(confirmed.map(c => c.reproCommand)) : 'none'}` : ''}

Report every reproduced divergence with an exact repro command. If you find none,
say so honestly with divergenceCount 0 — a clean result is a useful result, and
inventing a finding is much worse than reporting none. In notes, state what you
deliberately did NOT cover so a later reviewer can pick it up.`,
    { label: `fuzz:${s.key}${round > 1 ? `#${round}` : ''}`, phase: 'Fuzz', schema: FUZZ_SCHEMA }
  )))

  const ok = roundResults.filter(Boolean)
  const total = ok.reduce((n, r) => n + r.casesExecuted, 0)
  const fresh = ok.flatMap(r => r.divergences.map(d => ({ ...d, strategy: r.strategy })))
    .filter(d => { const k = d.reproCommand; if (seen.has(k)) return false; seen.add(k); return true })

  log(`Round ${round}: ${total} cases across ${ok.length} strategies, ${fresh.length} new divergence(s)`)
  for (const r of ok) log(`  ${r.strategy}: ${r.casesExecuted} cases, ${r.divergenceCount} divergences`)

  if (fresh.length === 0) { dryRounds++; continue }
  dryRounds = 0

  // Each fresh divergence gets independently re-verified by skeptics before it
  // counts — a fuzzer that quoted its shell wrong produces phantom findings.
  const judged = await parallel(fresh.map((d, i) => () =>
    parallel([0, 1].map(k => () => agent(
      `${GROUND_RULES}
Your private scratch dir: /tmp/wf-judge-r${round}-${i}-${k}

A fuzzer claims the Rust port diverges from the C++ reference. Your job is to REFUTE it.
The single most common cause of a false positive here is the fuzzer's own shell quoting
or capture bug, not a real difference in the binaries.

Claimed repro: ${d.reproCommand}
Claimed C++ output:  ${JSON.stringify(d.cppOutput)}
Claimed Rust output: ${JSON.stringify(d.rustOutput)}

Reproduce it yourself from scratch, using python3 subprocess with an explicit argv list
so quoting cannot confuse you. Compare raw stdout bytes and exit codes.
Set refuted true if the outputs are in fact identical, or if the claimed repro does not
pass the same argv to both binaries. Default to refuted true when uncertain.`,
      {
        label: `judge:${i}.${k}`, phase: 'Fuzz',
        schema: {
          type: 'object', additionalProperties: false,
          required: ['refuted', 'explanation'],
          properties: {
            refuted: { type: 'boolean' },
            explanation: { type: 'string' },
            actualCppBytes: { type: 'string' },
            actualRustBytes: { type: 'string' },
          },
        },
      }
    ))).then(votes => {
      const v = votes.filter(Boolean)
      return { divergence: d, real: v.length > 0 && v.every(x => !x.refuted), votes: v }
    })
  ))

  const real = judged.filter(Boolean).filter(j => j.real)
  log(`  ${real.length}/${fresh.length} survived adversarial verification`)
  confirmed.push(...real.map(j => ({ ...j.divergence, evidence: j.votes.map(v => v.explanation) })))
}

// -------------------------------------------------------------- Phase 3: Critic
const critic = await agent(
  `${GROUND_RULES}
Your private scratch dir: /tmp/wf-critic

You are the completeness critic on a C++ to Rust port verification effort.

The port has been checked by 11 per-API reverse-engineering agents and ${round} rounds of
differential fuzzing across these angles: ${STRATEGIES.map(s => s.key).join(', ')}.
Confirmed divergences so far: ${confirmed.length ? JSON.stringify(confirmed) : 'NONE'}.

Read the full Rust source in /output (test11.rs, Cargo.toml, src/lib.rs, src/idna/*.rs).

Then answer: what is still UNVERIFIED? Look specifically for
 (a) behaviour a fuzzer generating argv strings structurally cannot reach,
 (b) places the Rust code could panic where C++ would not (integer overflow in the
     label counter, allocation, unwrap, slicing, arithmetic on huge inputs),
 (c) output-buffering / broken-pipe / stdout-error differences between
     std::cout and a Rust BufWriter (e.g. piping into 'head -1'),
 (d) build/packaging requirements: it must be a valid Cargo project in /output, the
     entry file must be /output/test11.rs, 'rustc test11.rs' must work standalone from
     /output, 'cargo build --release' must work, edition must be 2021, and there must be
     ZERO external crate dependencies (only std) — verify each of these by running them,
     and confirm Cargo.lock lists no third-party packages,
 (e) whether the Rust source compiles with no warnings.

For every gap you identify, ACTUALLY TEST IT NOW and report what you found.
Distinguish clearly between "tested, matches", "tested, DIVERGES", and "untestable".`,
  {
    label: 'critic', phase: 'Critic',
    schema: {
      type: 'object', additionalProperties: false,
      required: ['gapsFound', 'buildChecks', 'verdict'],
      properties: {
        gapsFound: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['gap', 'tested', 'result'],
            properties: {
              gap: { type: 'string' },
              tested: { type: 'boolean' },
              result: { type: 'string', enum: ['matches', 'DIVERGES', 'untestable'] },
              detail: { type: 'string' },
              reproCommand: { type: 'string' },
            },
          },
        },
        buildChecks: {
          type: 'object', additionalProperties: false,
          required: ['rustcStandaloneWorks', 'cargoReleaseWorks', 'zeroExternalDeps', 'edition2021', 'warningFree'],
          properties: {
            rustcStandaloneWorks: { type: 'boolean' },
            cargoReleaseWorks: { type: 'boolean' },
            zeroExternalDeps: { type: 'boolean' },
            edition2021: { type: 'boolean' },
            warningFree: { type: 'boolean' },
            detail: { type: 'string' },
          },
        },
        verdict: { type: 'string' },
      },
    },
  }
)

return {
  specSummary: specs.filter(Boolean).map(s => ({ api: s.api, spec: s.derivedSpec, matches: s.rustMatches, probes: s.probesRun })),
  specDivergences,
  fuzzRounds: round,
  totalUniqueDivergenceClaims: seen.size,
  confirmedDivergences: confirmed,
  critic,
}
