export const meta = {
  name: 'cpp-to-rust-idna-test12',
  description: 'Refute/refine the reverse-engineered idna model, implement the Rust port in /output, then adversarially differential-fuzz and audit it',
  phases: [
    { title: 'Refute', detail: 'adversarial probers hunt for inputs where the derived model mispredicts the C++ binary' },
    { title: 'Implement', detail: 'write the Cargo project, modules, and entry file; build both ways' },
    { title: 'Fuzz', detail: 'parallel differential fuzzers vs the C++ reference binary' },
    { title: 'Audit', detail: 'requirement compliance + code review' },
    { title: 'Repair', detail: 'apply fixes for any confirmed divergence' },
  ],
}

const REF = '/workspace/dataset/test12_executable'

const MODEL = `
DERIVED BEHAVIORAL MODEL of the (unavailable) idna.hpp, already validated by extensive probing.
EVERY function operates on RAW BYTES with no UTF-8 awareness. The library is deliberately
simplistic: there is NO real punycode algorithm and NO real IDNA/UTS-46 processing.

  to_ascii(d)        = b"xn--" ++ to_lower(d)
  to_unicode(s)      = if s starts_with b"xn--" then s[4..] else s
                       (ONE strip, whole-string, at the very front; NOT per-label; NO punycode decode)
  punycode_encode(d) = b"xn--" ++ d                (no lowercasing, no real encoding)
  punycode_decode(s) = if s starts_with b"xn--" then s[4..] else s
  is_valid_domain(d) = !d.is_empty() && d.len() <= 255      (BYTE length; no charset rule,
                       no per-label length rule, no leading/trailing hyphen or dot rules)
  is_valid_label(l)  = UNOBSERVABLE (test only ever calls it with "testlabel" -> prints 1)
  is_ascii_domain(d) = every byte < 0x80
  is_idn_domain(d)   = any byte >= 0x80            (note: this is exactly !is_ascii_domain;
                       an "xn--" prefix does NOT make it idn)
  to_lower(s)        = byte-wise ASCII only: b'A'..=b'Z' -> +32; every other byte unchanged
                       (bytes >= 0x80 are NEVER changed)
  normalize(d)       = to_lower(d)                 (no trimming, no dot collapsing, no
                       trailing-dot removal)
  extract_tld(d)     = the bytes after the LAST b'.'; if there is no b'.', the whole of d
                       (so "" -> "", "." -> "", "a." -> "", "localhost" -> "localhost";
                        NOT lowercased: "UPPER.COM" -> "COM")
  count_labels(d)    = (number of b'.' bytes) + 1  (so "" -> 1, "." -> 2, "a..b" -> 3)

main(): domain = "multi.level.domain.name.test"; if argc > 1 then domain = argv[1].
Extra args beyond argv[1] are ignored. It then computes result1..result12 exactly as in the
C++ source and prints them in order, each followed by '\\n' (std::endl). C++ streams a bool
as "1"/"0" and an int in decimal.

Evidence already collected (do not redo, build on it):
 - All 255 single-byte-value arguments were swept: normalize/is_ascii/is_idn/is_valid all
   matched the model exactly.
 - Length: single label of 255 bytes -> valid=1; 256 bytes -> valid=0. A 100-byte single
   label inside "AAAA...(100).com" is valid, so there is NO per-label length limit; the
   4x64-label case failed only because its total was 259 bytes. Multibyte confirms BYTES:
   127 x 'e-acute' = 254 bytes -> valid, 128 x = 256 bytes -> invalid.
 - "a.xn--b" -> to_unicode "a.xn--b" (interior "xn--" NOT stripped => whole-string, not per-label).
 - Valid punycode bodies ("caf-dma", "mnchen-3ya", "fsq270a", "zckzah", "80akhbyknj4f")
   round-trip unchanged => decoding is a pure prefix strip, not real punycode.
 - Special chars ! @ # $ % * ( ) + = / \\ ? : ; , ~ | < > " ' [ ] { } ^ \` , spaces and
   newlines are all accepted by is_valid_domain and pass through untouched.

NOTE: to_unicode is only ever called on to_ascii's output and punycode_decode only on
punycode_encode's output, so in this program the prefix is ALWAYS present.
`

const ENVNOTES = `
ENVIRONMENT NOTES:
 - python3 is NOT installed. Use bash, or write throwaway Rust programs and run them with
   rustc, to generate test inputs. printf and bash loops work fine.
 - The C++ reference binary is ${REF}. It takes an optional single positional argument.
 - Compare stdout BYTE-FOR-BYTE (use cmp, or 'od -c' / 'xxd'), not visually.
 - Non-UTF-8 argv bytes are legal to pass on this platform and the C++ binary handles them.
`

// ---------------------------------------------------------------- Phase 1: Refute
phase('Refute')

const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'the exact argv[1] used, or a bash snippet producing it' },
          modelPredicts: { type: 'string' },
          binaryActually: { type: 'string' },
          whichResultLine: { type: 'integer', description: '1-12, which of result1..result12 diverged' },
        },
        required: ['input', 'modelPredicts', 'binaryActually', 'whichResultLine'],
      },
    },
    probesRun: { type: 'integer' },
    modelHolds: { type: 'boolean' },
    notes: { type: 'string', description: 'anything subtle worth knowing for the port' },
  },
  required: ['divergences', 'probesRun', 'modelHolds', 'notes'],
}

const LENSES = [
  {
    key: 'length-and-validity',
    prompt: `Focus on is_valid_domain (printed as result5, line 5) and any length-dependent behavior.
Hammer the 250-260 byte region with many different SHAPES: many labels, one label, all dots,
mixed multibyte UTF-8 straddling the 255/256 boundary, trailing/leading dots, strings made of
NUL-adjacent and high bytes. Also check whether an argument longer than 255 changes anything
OTHER than line 5 (it must not). Check whether count_labels/extract_tld/normalize still behave
on over-long inputs. Try to find ANY input where validity is not exactly (len>=1 && len<=255).`,
  },
  {
    key: 'prefix-and-tld',
    prompt: `Focus on to_ascii/to_unicode/punycode_encode/punycode_decode (lines 1-4) and
extract_tld/count_labels (lines 11-12). Hunt for: inputs that already begin with "xn--",
"XN--", "Xn--", "xn-", "xn---", "xn----"; inputs that are exactly "xn--"; inputs where the
prefix appears mid-string or at the end; strings of only dots; strings with a trailing dot;
strings where the last label is empty; extremely deep label nesting (hundreds of dots).
Verify extract_tld is NOT lowercased while to_ascii/normalize ARE. Verify to_unicode strips
exactly four bytes and never more.`,
  },
  {
    key: 'bytes-and-encoding',
    prompt: `Focus on byte-level fidelity: to_lower/normalize (lines 9-10), is_ascii_domain and
is_idn_domain (lines 7-8). Sweep MULTI-byte combinations rather than single bytes (single bytes
were already swept). Test: embedded NUL attempts, DEL (0x7f), 0x80, 0xC0/0xFF invalid UTF-8
sequences, overlong UTF-8, lone surrogates encoded as CESU-8, Turkish dotted/dotless I, full-width
Latin capitals, Cyrillic capitals, mathematical bold capitals - confirm NONE of them are
case-folded (only ASCII A-Z is). Confirm is_idn_domain is exactly !is_ascii_domain on every
input you try. Confirm normalize never changes byte length.`,
  },
  {
    key: 'argv-and-main',
    prompt: `Focus on the main()/argv contract rather than the library. Verify: with zero args the
default domain "multi.level.domain.name.test" is used; with two or more args ONLY argv[1] is used
and the rest are ignored; an explicitly EMPTY first argument ("") is honored as the domain and is
NOT treated as absent (it should print line 5 as 0 and line 12 as 1); an argument that is exactly
the default produces the default output; arguments beginning with '-' or '--' are treated as plain
domains, not flags. Also confirm exit status is always 0 and that nothing is ever written to stderr.
Confirm there is no trailing output after line 12 other than its newline.`,
  },
]

const probes = await parallel(LENSES.map(l => () =>
  agent(
    `You are adversarially testing a reverse-engineered model of a C++ library by running its
compiled binary. Your job is to REFUTE the model, not confirm it. Run at least 120 distinct
probes. Report ONLY genuine divergences you actually reproduced by running the binary.

${MODEL}
${ENVNOTES}

YOUR ASSIGNED LENS:
${l.prompt}

Run the binary many times with crafted arguments, compute what the model predicts for each of
the 12 output lines, and diff. If everything matches, say so honestly with modelHolds=true and
report probesRun. Do NOT invent divergences. Do NOT modify anything in /output or /workspace.`,
    { label: `refute:${l.key}`, phase: 'Refute', schema: PROBE_SCHEMA }
  )
))

const realDivergences = probes.filter(Boolean).flatMap(p => p.divergences || [])
const probeNotes = probes.filter(Boolean).map((p, i) => `[${LENSES[i].key}] holds=${p.modelHolds} probes=${p.probesRun}: ${p.notes}`).join('\n')
log(`Refute phase: ${probes.filter(Boolean).length}/${LENSES.length} lenses reported, ${realDivergences.length} candidate divergences`)

// Verify each claimed divergence independently before letting it influence the implementation.
let confirmedDivergences = []
if (realDivergences.length) {
  const VERDICT = {
    type: 'object',
    properties: {
      isReal: { type: 'boolean' },
      explanation: { type: 'string' },
      correctedRule: { type: 'string', description: 'the corrected model rule, if the divergence is real' },
    },
    required: ['isReal', 'explanation'],
  }
  const verdicts = await parallel(realDivergences.map((d, i) => () =>
    agent(
      `A prober claims the following divergence between a derived model and a C++ binary.
Independently REPRODUCE it by running ${REF} yourself. Shell quoting mistakes and
command-substitution stripping trailing newlines are the most common causes of FALSE reports -
be suspicious. Default to isReal=false unless you personally reproduced it.

${MODEL}
${ENVNOTES}

CLAIM:
  input: ${JSON.stringify(d.input)}
  output line ${d.whichResultLine}
  model predicts: ${d.modelPredicts}
  binary allegedly: ${d.binaryActually}`,
      { label: `verify-divergence:${i}`, phase: 'Refute', schema: VERDICT }
    )
  ))
  confirmedDivergences = realDivergences
    .map((d, i) => ({ ...d, verdict: verdicts[i] }))
    .filter(x => x.verdict && x.verdict.isReal)
  log(`Divergence verification: ${confirmedDivergences.length}/${realDivergences.length} confirmed real`)
}

const CORRECTIONS = confirmedDivergences.length
  ? `\n\nCONFIRMED CORRECTIONS TO THE MODEL (these were reproduced against the real binary and MUST be honored):\n` +
    confirmedDivergences.map(d => `- input ${JSON.stringify(d.input)} line ${d.whichResultLine}: ${d.verdict.correctedRule || d.binaryActually}`).join('\n')
  : `\n\nThe model was NOT refuted by any lens; treat it as authoritative.`

// ---------------------------------------------------------------- Phase 2: Implement
phase('Implement')

const SPEC = `
${MODEL}
${CORRECTIONS}

Prober notes:
${probeNotes}
${ENVNOTES}

DELIVERABLE - a complete Cargo project in /output with EXACTLY this layout:

  /output/Cargo.toml
  /output/test12.rs              <- the entry file (REQUIRED at the package root by the spec)
  /output/src/idna/mod.rs        <- library root, re-exports the 12 public functions
  /output/src/idna/case.rs       <- to_lower, normalize
  /output/src/idna/encode.rs     <- to_ascii, to_unicode
  /output/src/idna/punycode.rs   <- punycode_encode, punycode_decode
  /output/src/idna/validate.rs   <- is_valid_domain, is_valid_label, is_ascii_domain, is_idn_domain
  /output/src/idna/labels.rs     <- extract_tld, count_labels

HARD REQUIREMENTS:
1. Rust 2021 edition. ZERO external crates - only std. Cargo.toml must have an empty
   [dependencies] section.
2. It MUST build BOTH ways, and you must verify both:
     cd /output && cargo build --release
     cd /output && rustc -O test12.rs -o test12
   To make both work, /output/test12.rs should pull the library in with
     #[path = "src/idna/mod.rs"]
     mod idna;
   (a mod.rs target means its child modules resolve in the same src/idna/ directory, which is
   what makes the plain-rustc build work). Cargo.toml should declare an explicit
   [lib] name = "idna", path = "src/idna/mod.rs"  AND  [[bin]] name = "test12", path = "test12.rs".
   If cargo objects to that combination, keep the bin target working and adjust the lib target -
   the bin and the rustc build are what matter. Leave the final executable at /output/test12.
3. BYTE EXACTNESS. The C++ program passes raw argv bytes straight through to stdout, so the
   Rust port must be byte-transparent too, including for arguments that are NOT valid UTF-8
   (the C++ binary accepts those and this platform allows them). Therefore:
     - Model all "strings" internally as Vec<u8>/&[u8], not String.
     - Read the argument losslessly. Use std::env::args_os() with
       std::os::unix::ffi::OsStrExt::as_bytes() under #[cfg(unix)], and fall back to
       std::env::args() on non-unix. Document in a brief comment WHY (args() would panic on
       non-UTF-8 argv, which would diverge from C++).
     - Write output with std::io::Write::write_all on a locked, buffered stdout, appending b'\\n'
       per line to match std::endl, and flush at the end. Print bools as b"1"/b"0" and the int
       in decimal. Do NOT round-trip bytes through String::from_utf8_lossy anywhere - that would
       corrupt non-UTF-8 input.
4. count_labels must return i32 to mirror the C++ int.
5. is_valid_label is unobservable from the test (it is only ever called with "testlabel").
   Implement it in the same minimal style as the rest of the library - non-empty and at most 63
   bytes - and add a short comment saying it is unobservable and why that choice was made.
6. test12.rs must mirror the C++ main() structure readably: same variable names result1..result12,
   same order of calls, same order of prints, and the same default domain
   "multi.level.domain.name.test".
7. Add #[cfg(test)] unit tests in the library modules covering the tricky cases (empty input,
   "." and "..", trailing dot, "xn--" already present, 255/256 byte boundary, non-ASCII
   passthrough, uppercase handling, extract_tld not being lowercased).
8. Write idiomatic, clearly-commented Rust. Each module gets a brief //! doc comment stating the
   observed contract it implements. Do not over-engineer; mirror the library's simplicity, but do
   note in comments where the original is deliberately NOT real IDNA/punycode.

VERIFY BEFORE YOU FINISH (actually run these, do not assume):
  - cargo build --release succeeds with no warnings that indicate real problems
  - rustc -O test12.rs -o test12 succeeds
  - cargo test passes
  - /output/test12 with no args matches ${REF} with no args, byte for byte
  - all five documented examples match: example.com, test.org, localhost,
    sub.domain.example.com, a.b.c.d.e.f.g.h
  - these edge cases match byte for byte: "" (empty arg), ".", "..", "a.", ".a", "a..b",
    "UPPER.COM", "xn--caf-dma.fr", "a.xn--b", a 255-byte arg, a 256-byte arg, a UTF-8 arg
    like "café.fr" and "日本.jp"
Use a bash loop with cmp to do the comparisons.

Report what you built, the exact commands you ran, and their results.`

const implReport = await agent(SPEC, { label: 'implement-rust-port', phase: 'Implement' })
log('Implementation phase complete')

// ---------------------------------------------------------------- Phase 3: Fuzz + Audit
phase('Fuzz')

const FUZZ_SCHEMA = {
  type: 'object',
  properties: {
    casesRun: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          inputRepr: { type: 'string', description: 'bash snippet that reproduces the failing argument' },
          cppOutput: { type: 'string' },
          rustOutput: { type: 'string' },
          diagnosis: { type: 'string' },
        },
        required: ['inputRepr', 'cppOutput', 'rustOutput', 'diagnosis'],
      },
    },
    allMatched: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['casesRun', 'mismatches', 'allMatched', 'notes'],
}

const GENERATORS = [
  { key: 'structured-domains', desc: `Realistic and semi-realistic domain names: TLDs, subdomains, hyphens, digits, single-letter labels, very deep nesting (1..200 labels), mixed case in every position, leading/trailing/consecutive dots, names that are entirely dots, names already carrying "xn--"/"XN--" prefixes at the front, middle and end.` },
  { key: 'unicode', desc: `UTF-8 inputs: Latin-1 accents, CJK, Arabic and Hebrew (RTL), Devanagari, emoji including multi-codepoint ZWJ sequences and skin-tone modifiers, combining marks, full-width forms, Turkish dotted/dotless I, Greek final sigma, characters whose uppercase/lowercase differ in length. Also mixed ASCII+Unicode where the uppercase ASCII must fold but the Unicode must not.` },
  { key: 'hostile-bytes', desc: `Invalid UTF-8 and control bytes: lone 0x80-0xBF continuation bytes, 0xC0/0xC1/0xF5-0xFF, truncated multi-byte sequences, overlong encodings, CESU-8 surrogate pairs, 0x01-0x1F control characters, 0x7F, and long runs of high bytes. Build these with printf '\\xNN'. NOTE: a literal NUL byte cannot be passed through argv at all, so skip NUL. Verify the Rust port does not panic and does not mangle any byte.` },
  { key: 'boundaries-and-scale', desc: `Length and scale: every length from 250 to 260 bytes in several different shapes, plus 1, 2, 63, 64, 65, 127, 128, 255, 256, 1000, 8000 byte arguments; arguments made of thousands of dots; arguments that are one enormous label; multibyte characters straddling the 255/256 byte boundary so the character count and byte count disagree. Also pass zero args, two args, three args, and an empty first arg.` },
]

const fuzzResults = await parallel(GENERATORS.map(g => () =>
  agent(
    `Differential-test a Rust port against its C++ reference. Run BOTH binaries on the same
argument and compare stdout BYTE FOR BYTE, and also compare exit status and stderr.

  C++ reference : ${REF}
  Rust port     : /output/test12   (if missing, build it: cd /output && rustc -O test12.rs -o test12)

Write a bash harness in /tmp (NOT in /output) that loops over generated inputs and uses cmp to
compare. Run at least 400 distinct cases. Passing an argument with awkward bytes is easiest via
a bash array or "$(printf ...)" - but beware that command substitution strips trailing newlines,
which causes FALSE mismatches; prefer bash arrays or printf into a variable carefully, and
double-check any mismatch you find is not a quoting artifact before reporting it.

YOUR ASSIGNED INPUT CLASS: ${g.desc}

${ENVNOTES}

Do NOT modify anything under /output. Report only mismatches you reproduced at least twice.`,
    { label: `fuzz:${g.key}`, phase: 'Fuzz', schema: FUZZ_SCHEMA }
  )
))

const auditPromise = parallel([
  () => agent(
    `Audit the Rust project in /output against this migration spec. Read every file. Report
concrete violations with file:line, not style opinions.

SPEC REQUIREMENTS TO CHECK:
 1. Pure Rust, edition 2021, compiles with rustc AND as a Cargo project.
 2. CLI: same arguments as the C++ binary - one optional positional domain, default
    "multi.level.domain.name.test", extra args ignored. Arguments come from the process args.
 3. Logic, numeric precision and string formatting exactly match the C++ source; stdout is
    byte-for-byte identical to std::cout output. Bools print as 1/0, the int prints in decimal,
    every line ends in a single '\\n', and there is no extra trailing output.
 4. ZERO external crates - inspect Cargo.toml and every 'use' statement. Check there is no
    Cargo.lock referencing any registry package.
 5. Library code is organized into modules; the entry file test12.rs is at the package root /output.
 6. The entry file mirrors the C++ main(): result1..result12 in the same order, same call order,
    same print order.
 7. An executable exists at /output/test12 and actually runs.

Also independently re-derive the 12 function semantics from this authoritative model and check
each Rust function against it line by line:
${MODEL}

Actually RUN the builds and the binary to confirm your claims. Do not modify any file - this is
a read-only audit. Report a clear PASS/FAIL per requirement.`,
    { label: 'audit:requirements', phase: 'Audit' }
  ),
  () => agent(
    `Adversarial code review of the Rust project in /output. You are looking for CORRECTNESS
BUGS that differential testing might miss, not style nits. Read every file.

Specifically hunt for:
 - Any place bytes are round-tripped through String / from_utf8 / from_utf8_lossy / chars(),
   which would corrupt non-UTF-8 input or make case folding non-byte-wise.
 - Case folding that uses to_ascii_lowercase on a str vs on bytes, or that touches bytes >= 0x80.
 - Off-by-one in the "xn--" prefix strip (must remove exactly 4 bytes) or in the <=255 length
   check (255 valid, 256 invalid).
 - extract_tld accidentally lowercasing, or mishandling no-dot / trailing-dot / empty input.
 - count_labels using split().count() in a way that disagrees with (dots + 1) on empty input,
   or overflowing i32.
 - is_idn_domain not being exactly the negation of is_ascii_domain.
 - Panics: slicing, indexing, unwrap, expect, integer overflow in debug builds.
 - Output buffering or flushing that could truncate or reorder output, or a missing final flush.
 - Anything that behaves differently between the cargo build and the plain rustc build.

For each finding, state the exact input that triggers it. Verify by running the binary before
reporting. Do not modify any file - report only.`,
    { label: 'review:adversarial', phase: 'Audit' }
  ),
])

const [auditReport, reviewReport] = await auditPromise
const allMismatches = fuzzResults.filter(Boolean).flatMap(f => f.mismatches || [])
const totalCases = fuzzResults.filter(Boolean).reduce((n, f) => n + (f.casesRun || 0), 0)
log(`Fuzz: ${totalCases} differential cases, ${allMismatches.length} candidate mismatches`)

// ---------------------------------------------------------------- Phase 5: Repair
phase('Repair')

let repairReport = 'No repair needed.'
if (allMismatches.length || /FAIL/i.test(auditReport || '')) {
  repairReport = await agent(
    `Fix the Rust project in /output. The reference C++ binary is ${REF} and its behavior is
ALWAYS authoritative - never "fix" the reference.

${MODEL}
${ENVNOTES}

DIFFERENTIAL MISMATCHES REPORTED:
${JSON.stringify(allMismatches, null, 2)}

REQUIREMENTS AUDIT:
${auditReport}

ADVERSARIAL CODE REVIEW:
${reviewReport}

For each reported item: first REPRODUCE it yourself by running both binaries. Many reports are
shell-quoting artifacts - if you cannot reproduce it, say so and move on rather than making a
speculative change. Fix only what is genuinely broken, then re-verify:
  cd /output && cargo build --release && cargo test && rustc -O test12.rs -o test12
and re-run the full edge-case comparison (no args, the 5 documented examples, "", ".", "..",
"a.", ".a", "a..b", "UPPER.COM", "xn--caf-dma.fr", "a.xn--b", 255- and 256-byte args, "café.fr",
"日本.jp") with cmp. Report exactly what you changed and the verification output.`,
    { label: 'repair', phase: 'Repair' }
  )
}

// ---------------------------------------------------------------- Final gate
const FINAL = {
  type: 'object',
  properties: {
    buildsWithCargo: { type: 'boolean' },
    buildsWithRustc: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    executableExists: { type: 'boolean' },
    zeroDependencies: { type: 'boolean' },
    entryFileAtRoot: { type: 'boolean' },
    allComparisonsMatch: { type: 'boolean' },
    casesCompared: { type: 'integer' },
    remainingProblems: { type: 'array', items: { type: 'string' } },
    fileList: { type: 'array', items: { type: 'string' } },
  },
  required: ['buildsWithCargo', 'buildsWithRustc', 'testsPass', 'executableExists',
             'zeroDependencies', 'entryFileAtRoot', 'allComparisonsMatch', 'casesCompared',
             'remainingProblems', 'fileList'],
}

const gate = await agent(
  `Final independent acceptance check of the Rust project in /output. Trust nothing you are told;
verify everything yourself by running commands.

Do all of this from scratch:
 1. rm -f /output/test12 && cd /output && cargo build --release  (record success/failure)
 2. cd /output && cargo test                                     (record pass/fail)
 3. cd /output && rustc -O test12.rs -o test12                   (record success/failure)
 4. Confirm /output/test12 exists and is executable.
 5. Confirm Cargo.toml has edition 2021 and no dependencies, and that no source file uses a
   non-std crate.
 6. Confirm /output/test12.rs exists at the package root.
 7. Run a final differential sweep of at least 200 inputs against ${REF}, comparing stdout with
   cmp, including: no args, the five documented examples, empty string, ".", "..", "a.", ".a",
   "a..b", "UPPER.COM", "XN--A.b", "xn--caf-dma.fr", "a.xn--b", "café.fr", "日本.jp",
   "  spaced  .com", 255-byte and 256-byte arguments, a 3000-byte argument, an argument of 500
   dots, and several invalid-UTF-8 byte arguments built with printf '\\xNN'. Also verify the
   cargo-built binary at /output/target/release/test12 produces identical output to /output/test12.
 8. Report the full file list of /output excluding the target/ directory.

${ENVNOTES}

Report honestly. If something fails, say exactly what and why - do not paper over it.`,
  { label: 'final-acceptance-gate', phase: 'Repair', schema: FINAL }
)

return {
  modelRefuted: confirmedDivergences.length > 0,
  confirmedDivergences,
  differentialCases: totalCases,
  mismatchesFound: allMismatches.length,
  repair: repairReport,
  gate,
}
