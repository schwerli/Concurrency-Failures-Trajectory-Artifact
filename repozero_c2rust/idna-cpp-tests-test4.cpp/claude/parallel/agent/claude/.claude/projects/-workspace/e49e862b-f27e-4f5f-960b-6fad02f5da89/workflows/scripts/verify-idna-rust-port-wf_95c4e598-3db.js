export const meta = {
  name: 'verify-idna-rust-port',
  description: 'Differentially fuzz the Rust port against the C++ reference and audit it against the task requirements',
  phases: [
    { title: 'Fuzz', detail: 'parallel differential fuzzers with diverse generators' },
    { title: 'Audit', detail: 'requirements compliance + code fidelity + build matrix' },
    { title: 'Judge', detail: 'adjudicate every reported defect' },
    { title: 'Report', detail: 'final verdict' },
  ],
}

const CPP = '/workspace/dataset/test4_executable'
const RS = '/output/test4'

const COMMON = `
You are verifying a Rust port against a C++ reference binary.

REFERENCE (C++):  ${CPP}
PORT (Rust):      ${RS}          <- built from /output/test4.rs
Cargo project:    /output  (also builds via \`cd /output && cargo build --release\` -> /output/target/release/test4)

Both take one optional positional argument (a domain string; default "example.com") and print 4 lines of "1"/"0":
  is_valid_domain, is_valid_label, is_ascii_domain, is_idn_domain

Outputs must be BYTE-FOR-BYTE identical. Compare with od/xxd, not with naked \`echo\`, so trailing-newline and CR differences cannot hide. A robust comparator:

  cmp_one() {
    local a b
    a=$(${CPP} "$@" 2>/dev/null | od -An -c); b=$(${RS} "$@" 2>/dev/null | od -An -c)
    [ "$a" == "$b" ] || { printf 'MISMATCH args=%q cpp=<%s> rs=<%s>\\n' "$*" "$a" "$b"; return 1; }
  }

Also compare EXIT CODES and confirm stderr is empty for both.

ENVIRONMENT: python3/python are NOT installed. Use bash loops, printf, od, tr, head, seq, awk. rustc/cargo ARE available if you want to write a generator. For arbitrary bytes use printf '\\xNN' or bash $'...' quoting.
CAUTION: \`s=$(printf '\\x0a')\` silently strips the trailing newline — command substitution eats trailing newlines. Use $'\\n' for newline args, and be aware of this artifact before reporting a "mismatch" that is really a shell quoting bug. ALWAYS re-verify a suspected mismatch by invoking both binaries directly and eyeballing od output before you report it.

ESTABLISHED SPEC (byte-based, already confirmed by 657 passing differential cases):
  is_valid_domain(s) = 1 <= s.len_in_BYTES <= 255
  is_valid_label(s)  = 1 <= s.len_in_BYTES <= 63
  is_ascii_domain(s) = every byte <= 0x7F      (empty -> true)
  is_idn_domain(s)   = any byte  >  0x7F       (empty -> false)
  Content/structure is irrelevant: dots, hyphens, spaces, slashes, control chars are all accepted.
  Length limits count BYTES, not code points ("例" x 21 = 63 bytes -> valid label; "例" x 63 = 189 bytes -> invalid).
Your job is to find any input where the two binaries DISAGREE — including inputs that break this spec.
`

const FUZZ_SCHEMA = {
  type: 'object',
  properties: {
    strategy: { type: 'string' },
    casesRun: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Exact shell-quoted argument reproducing the mismatch' },
          cppOutput: { type: 'string' },
          rustOutput: { type: 'string' },
          reVerified: { type: 'boolean', description: 'true only if you re-ran both binaries directly and the mismatch persisted' },
        },
        required: ['input', 'cppOutput', 'rustOutput', 'reVerified'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['strategy', 'casesRun', 'mismatches', 'notes'],
}

const FUZZERS = [
  {
    key: 'random-ascii',
    prompt: `Strategy: RANDOM ASCII. Generate at least 800 pseudo-random ASCII strings of lengths 0..300 (use $RANDOM and printf; vary length distribution so boundaries 0,1,63,64,255,256 are hit often). Include punctuation, digits, mixed case, dots and hyphens in random positions. Run every one through the comparator.`,
  },
  {
    key: 'random-bytes',
    prompt: `Strategy: RANDOM RAW BYTES including invalid UTF-8. Generate at least 600 strings of random bytes in 0x01..0xFF (skip 0x00 — it cannot traverse argv) of lengths 1..300. Build them with printf '\\xNN'. IMPORTANT: avoid the trailing-newline command-substitution artifact — if a generated string could end in 0x0A, either regenerate or pass it via a bash array/variable built with $'...'. This is the highest-value fuzzer because Rust's std::env::args() PANICS on non-UTF-8 while C++ does not: verify the Rust binary never panics, never prints to stderr, and always exits 0.`,
  },
  {
    key: 'boundary-exhaustive',
    prompt: `Strategy: EXHAUSTIVE LENGTH BOUNDARIES. For EVERY length n in 0..=300 (and also 400, 512, 1000, 4096, 8192, 65536), compare a string of n 'a' characters. Then repeat for n dots, n hyphens, and an alternating "a.a.a..." pattern. Then do the same sweep using multi-byte characters: n copies of "ü" (2B), "例" (3B), "😀" (4B) for n in 0..=90. That is a few thousand cases; script it in a loop and report only mismatches plus the total count. Pay special attention to very large inputs (does the Rust version handle a 65536-byte argument identically?).`,
  },
  {
    key: 'unicode-structured',
    prompt: `Strategy: STRUCTURED UNICODE. Test real internationalised domain names across scripts: Chinese, Japanese, Korean, Arabic, Hebrew, Cyrillic, Greek, Thai, Devanagari, emoji, combining marks (e.g. "e" + U+0301), zero-width joiner sequences, RTL override characters, U+00AD soft hyphen, NBSP, and full-width Latin (e.g. "ｅｘａｍｐｌｅ.ｃｏｍ"). Also test punycode forms ("xn--fsq.com", "xn--fiqs8s", mixed "例子.xn--fiqs8s") and uppercase variants. At least 200 cases. Confirm no normalization or case-folding difference between the two binaries.`,
  },
  {
    key: 'cli-contract',
    prompt: `Strategy: CLI CONTRACT. Exhaustively compare argument handling, not domain content:
 - zero arguments
 - one empty argument ""
 - two, three, five arguments (confirm only argv[1] is used and extras are ignored, including when extras are invalid UTF-8)
 - arguments that look like flags: "--help", "-h", "-x", "--", "-", "--version"
 - arguments containing newlines, tabs, NUL-adjacent bytes, very long args
 - exit codes in every case (must match)
 - stderr must be empty for both in every case
 - stdout when piped vs when redirected to a file (confirm no buffering-related difference; e.g. \`${CPP} x > f1; ${RS} x > f2; cmp f1 f2\`)
 - behaviour under \`head -c 2\` (early pipe close): does the Rust binary emit a BrokenPipe panic or a stderr message where C++ stays silent? Report exactly what each does.
At least 60 distinct invocations.`,
  },
  {
    key: 'adversarial-spec-attack',
    prompt: `Strategy: ADVERSARIAL SPEC ATTACK. Assume the stated spec is subtly WRONG and hunt for the counterexample. Specifically attack:
 - Is the domain limit really 255 and not 253 or 254? Bisect precisely.
 - Is the label limit really 63? Bisect precisely.
 - Could the C++ code be doing something with a trailing dot, or splitting on dots and checking each label, that only shows up for a specific shape? Construct names with one over-long label plus many short ones, at many total lengths.
 - Could is_ascii_domain be testing >= 0x80 on a SIGNED char (making high bytes negative and flipping a comparison)? Design inputs that would expose a signed-char bug: single bytes 0x7F, 0x80, 0x81, 0xFF at the start, middle, and end of strings of various lengths.
 - Could either predicate short-circuit on the first dot, or stop at a NUL-like byte?
 - Does either binary treat the input as a C string anywhere (stopping early at some byte)?
Report the precise bisected boundaries you measured, and any disagreement between the two binaries.`,
  },
]

phase('Fuzz')
log('Running 6 differential fuzzers with diverse generation strategies...')

const fuzzed = await pipeline(
  FUZZERS,
  (f) =>
    agent(`${COMMON}\n\n${f.prompt}\n\nReport casesRun honestly and list ONLY re-verified mismatches. An empty mismatches array is a perfectly good result — do not invent findings.`, {
      label: `fuzz:${f.key}`,
      phase: 'Fuzz',
      schema: FUZZ_SCHEMA,
    }),
  (res, f) => {
    if (!res || !res.mismatches || !res.mismatches.length) return []
    return parallel(
      res.mismatches.map((m) => () =>
        agent(
          `${COMMON}

ADJUDICATE A REPORTED MISMATCH from fuzzer "${f.key}".
  claimed input:  ${m.input}
  claimed C++:    ${m.cppOutput}
  claimed Rust:   ${m.rustOutput}

Re-run BOTH binaries yourself with exactly that input and compare od -An -c output. Decide whether this is:
  (a) a REAL divergence between the two binaries  -> real=true
  (b) an artifact of the fuzzer's shell quoting (e.g. trailing-newline stripping by $(), unquoted expansion, locale) -> real=false
Explain which, and if real, give the minimal reproducing input and state exactly which of the 4 output lines differs and what the correct C++ behaviour is.`,
          { label: `judge:${f.key}`, phase: 'Judge', schema: {
            type: 'object',
            properties: {
              real: { type: 'boolean' },
              minimalInput: { type: 'string' },
              explanation: { type: 'string' },
              whichLineDiffers: { type: 'string' },
            },
            required: ['real', 'minimalInput', 'explanation', 'whichLineDiffers'],
          } }
        ).then((v) => (v ? { ...v, fuzzer: f.key, claimed: m } : null))
      )
    )
  }
)

const fuzzResults = fuzzed.map((r) => (Array.isArray(r) ? r : [])).flat().filter(Boolean)
const realBugs = fuzzResults.filter((v) => v.real)
log(`Fuzzing done. ${fuzzResults.length} reported mismatches adjudicated; ${realBugs.length} judged real.`)

phase('Audit')
const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          requirement: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['severity', 'requirement', 'problem', 'evidence', 'suggestedFix'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

const AUDITS = [
  {
    key: 'requirements',
    prompt: `${COMMON}

REQUIREMENTS COMPLIANCE AUDIT. Read every file under /output (Cargo.toml, test4.rs, src/**). Check each requirement and report violations:
 1. Pure Rust, edition 2021. Compiles with rustc AND as a Cargo project.
 2. CLI args identical to the C++ binary (same names, defaults, required fields), parsed via std::env::args(). NOTE: the port deliberately uses std::env::args_os() instead, because std::env::args() panics on non-UTF-8 input while the C++ binary accepts it. Judge whether this is a justified, well-documented deviation that still satisfies the intent ("parse args with std, no arg-parsing crate") — verify the justification is actually TRUE by running ${RS} $'\\xff' and confirming it does not panic. Also confirm a std::env::args()-based implementation really would panic (you may write a 5-line scratch program in /tmp to prove it).
 3. Output byte-for-byte identical to std::cout.
 4. ZERO external dependencies. Verify Cargo.toml has NO [dependencies] section with entries, and that no file has \`extern crate\` or \`use\` of any non-std crate. Confirm \`cargo build --release --offline\` works and Cargo.lock (if present) contains only the local package.
 5. Complete Cargo project in /output, library code organized into MODULES, entry file at /output/test4.rs.
 6. No C++ library source was consulted (idna.hpp does not exist on disk — confirm).
 7. An executable exists at /output/test4 built from test4.rs.
Verify each claim by running commands. Be strict but do not invent violations.`,
  },
  {
    key: 'code-fidelity',
    prompt: `${COMMON}

CODE FIDELITY & QUALITY REVIEW. Read /output/test4.rs and everything under /output/src. Then:
 - Confirm each of the 4 predicates implements exactly the established spec, with no off-by-one. Quote the actual line for each.
 - Look for anywhere the code uses .chars().count(), .len() on a str where bytes were intended, or a char-based iteration that would diverge from byte semantics on multi-byte input.
 - Check the empty-input case is handled so that is_ascii_domain("")==true and is_idn_domain("")==false.
 - Check the output formatting emits exactly '1'/'0' + '\\n' with no extra flush artifacts, no "true"/"false", no CR.
 - Check the default "example.com" is used ONLY when zero arguments are present (an explicitly empty first argument must NOT fall back to the default). Verify by running: ${RS} "" | od -An -c  vs  ${CPP} "" | od -An -c
 - Run \`cd /output && cargo test\` and report the result. Run \`cargo build --release 2>&1\` and report ANY warning.
 - Run \`cd /output && rustc -O test4.rs -o /tmp/rs_bare\` (no --edition, so edition 2015) and \`rustc -O --edition 2021 test4.rs -o /tmp/rs_2021\`; confirm BOTH succeed warning-free and that /tmp/rs_2021 agrees with ${CPP} on a dozen inputs.
 - Flag genuine code-quality issues (dead code, misleading comments, comments that state something false about the reference behaviour).
Report only real problems, with the file:line and evidence.`,
  },
]

const audits = (await parallel(
  AUDITS.map((a) => () => agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: AUDIT_SCHEMA }))
)).filter(Boolean)

const auditFindings = audits.flatMap((a) => a.findings || [])
const serious = auditFindings.filter((f) => f.severity === 'blocker' || f.severity === 'major')

phase('Report')
const report = await agent(
  `${COMMON}

FINAL VERDICT.
Differential fuzzing across 6 strategies ran these case counts: ${JSON.stringify(
    fuzzed.map((r, i) => ({ strategy: FUZZERS[i].key })).map((s, i) => s)
  ).slice(0, 400)}
Adjudicated mismatches judged REAL (${realBugs.length}):
${realBugs.length ? realBugs.map((b) => `- [${b.fuzzer}] input=${b.minimalInput} line=${b.whichLineDiffers}: ${b.explanation}`).join('\n') : '(none)'}

Audit findings (${auditFindings.length} total, ${serious.length} blocker/major):
${auditFindings.length ? auditFindings.map((f) => `- [${f.severity}] ${f.requirement}: ${f.problem}\n    evidence: ${f.evidence}\n    fix: ${f.suggestedFix}`).join('\n') : '(none)'}

Independently spot-check the conclusion: run your own final differential sweep of at least 40 diverse inputs (the 5 documented examples, empty, boundaries 63/64/255/256, multibyte, invalid UTF-8, no-arg, extra args) and confirm byte-identical output and exit codes.

Then return plain text with:
1. VERDICT: PASS or FAIL (FAIL only if a real output divergence or a blocker/major requirement violation exists).
2. Total differential cases run and mismatches found.
3. Any remaining action items, each with a concrete fix. If none, say "none".
Be concise and factual.`,
  { label: 'final-verdict', phase: 'Report' }
)

return { report, realBugs, auditFindings, seriousCount: serious.length }
