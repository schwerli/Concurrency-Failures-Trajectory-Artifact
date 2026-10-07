export const meta = {
  name: 'cpp-to-rust-test19',
  description: 'Spec, implement, and adversarially verify a byte-exact Rust port of indicators test19',
  phases: [
    { title: 'Spec', detail: 'independently derive behavior specs for CyclicProgress / ProgressDisplay / Format' },
    { title: 'Implement', detail: 'build the zero-dependency Cargo project in /output' },
    { title: 'Verify', detail: 'adversarial byte-diff, build hygiene, rounding semantics, structure audit' },
    { title: 'Repair', detail: 'apply confirmed findings and re-verify' },
  ],
}

const GROUND_TRUTH = `
GROUND TRUTH ALREADY ESTABLISHED (do not re-derive, trust these):
- The C++ binary is /workspace/dataset/test19_executable. Its output is INVARIANT to argv (verified with
  "", "0", "1", "-1", "abc", "1 2 3", "--help" -> identical md5). main() ignores argc/argv entirely.
- Spinner charset extracted from the binary's string table, in this exact order (8 braille glyphs, by codepoint):
    U+28FE U+28FD U+28FB U+283F U+287F U+28DF U+28EF U+28F7
  Frame index = next_count % 8.
  Evidence: CyclicProgress(5) after 3 next() -> frame 3; (10) after 6 -> frame 6; (15) after 9 -> frame 1 (9%8).
- ProgressDisplay format literal fragments found in the binary: "Progress: ", "% (", "/", ")".
- Get the exact expected bytes by RUNNING the binary and piping through od -c. Never hand-copy glyphs.

The C++ source of the program under port is /workspace/dataset/test19.cpp (READ IT - it is the entry
program, not the library). The library header ../include/indicators.hpp DOES NOT EXIST on disk and must
NOT be sought out; behavior is inferred black-box.
`;

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['component', 'summary', 'rust_signature_plan', 'behaviors', 'edge_cases', 'confidence'],
  properties: {
    component: { type: 'string' },
    summary: { type: 'string' },
    rust_signature_plan: { type: 'string', description: 'Proposed Rust API mirroring the C++ interface' },
    behaviors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'evidence'],
        properties: { rule: { type: 'string' }, evidence: { type: 'string' } },
      },
    },
    edge_cases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['case', 'decision', 'rationale'],
        properties: { case: { type: 'string' }, decision: { type: 'string' }, rationale: { type: 'string' } },
      },
    },
    confidence: { type: 'string' },
  },
}

const COMPONENTS = [
  {
    key: 'CyclicProgress',
    prompt: `You are reverse-engineering the C++ class indicators::CyclicProgress so it can be reimplemented in Rust.

${GROUND_TRUTH}

Interface used by the program:
  indicators::CyclicProgress c(5);   // ctor takes an int "total"
  c.next();                          // advance
  std::string s = c.str();           // e.g. "<spinner glyph> 60.0%"

Confirm the three observed lines yourself by running:
  /workspace/dataset/test19_executable | head -3 | od -c
and reason from the raw bytes which glyph index each corresponds to.

Deliver a precise spec: what state the object holds, how next() mutates it, exactly how str() is composed
(separator, percentage numerator/denominator, decimal places, rounding mode), and what integer/float types
are implied (the percentage is almost certainly computed in float/double then printed with
std::fixed << std::setprecision(1)).

Also decide defensible behavior for edge cases the test never exercises but a faithful port should handle:
total == 0 (division by zero -> nan/inf formatting), count > total (does it clamp?), negative total.
Prefer the behavior a naive C++ implementation would exhibit, and say so.

Return ONLY the structured object. Be concrete about the format string.`,
  },
  {
    key: 'ProgressDisplay',
    prompt: `You are reverse-engineering the C++ class indicators::ProgressDisplay so it can be reimplemented in Rust.

${GROUND_TRUTH}

Interface used by the program:
  indicators::ProgressDisplay displays[3];        // DEFAULT-CONSTRUCTIBLE (array of 3)
  displays[0] = indicators::ProgressDisplay(50);  // ctor takes total; copy/move assignable
  displays[0].update(25);                         // set current
  displays[0].increment(5);                       // add to current
  std::string s = displays[0].display();          // "Progress: 50.0% (25/50)"

Run /workspace/dataset/test19_executable and study lines 4-9 with od -c to confirm exact bytes.

Verified data points:
  (50) update(25)  -> "Progress: 50.0% (25/50)";  then increment(5)  -> "Progress: 60.0% (30/50)"
  (100) update(75) -> "Progress: 75.0% (75/100)"; then increment(10) -> "Progress: 85.0% (85/100)"
  (200) update(150)-> "Progress: 75.0% (150/200)";then increment(20) -> "Progress: 85.0% (170/200)"

Deliver a precise spec: state held, semantics of update vs increment, exact display() format, the percentage
formula (current*100/total as float, printed fixed 1dp), and the default-constructed state (what total/current
does a default ProgressDisplay have? The program overwrites all 3 before use, so infer the most natural
default a naive implementation would use; justify it and note it is unobservable here).

Also cover edge cases: total==0, current>total (clamp percentage or count?), negatives.

Return ONLY the structured object.`,
  },
  {
    key: 'Format',
    prompt: `You are reverse-engineering the C++ namespace/struct indicators::Format so it can be reimplemented in Rust.

${GROUND_TRUTH}

Interface used by the program (static functions):
  Format::percentage(0.25f)      -> "25.0%"
  Format::percentage(0.5f, 2)    -> "50.00%"
  Format::percentage(0.75f, 3)   -> "75.000%"
  Format::progress(25, 100)      -> "25/100"
  Format::progress(50, 100)      -> "50/100"
  Format::progress(75, 100)      -> "75/100"

Run /workspace/dataset/test19_executable | tail -6 | od -c to confirm exact bytes (no spaces, no padding).

Deliver a precise spec:
- percentage(value: float, precision: int = 1): takes a FRACTION in [0,1], multiplies by 100, prints with
  std::fixed << std::setprecision(precision), appends '%'. Confirm default precision is 1 from the first call.
  State the exact equivalent Rust format expression.
- progress(current, total): just "current/total", no percentage, no padding.

CRITICAL - rounding fidelity. C++ std::ostringstream with std::fixed/std::setprecision rounds the exact
binary value with glibc's correct rounding (ties-to-even). Rust's "{:.N}" is also exact-value correct
rounding. Analyze whether they agree for ALL inputs, and note the f32->f64 promotion in C++ when a float is
streamed (0.25f/0.5f/0.75f are exact so this test is safe, but 0.1f promotes to 0.100000001490116119384765625).
State clearly whether the Rust code should take f32 and promote to f64 before formatting to mimic C++ ostream
promotion, versus formatting the f32 directly - and give a CONCRETE value where f32 vs f64 formatting of the
same number diverges at precision 3+ (verify it with a real rust snippet you compile in /tmp).

Also cover edge cases: precision 0, negative precision, values > 1 or < 0.

Return ONLY the structured object.`,
  },
]

phase('Spec')
const specs = (await parallel(COMPONENTS.map(c => () =>
  agent(c.prompt, { label: `spec:${c.key}`, phase: 'Spec', schema: SPEC_SCHEMA })
))).filter(Boolean)

log(`Derived ${specs.length}/3 component specs`)

const specText = specs.map(s => JSON.stringify(s, null, 2)).join('\n\n---\n\n')

phase('Implement')
const implReport = await agent(`Implement a byte-exact Rust port of the C++ program /workspace/dataset/test19.cpp.
Read that .cpp file first. Then build a complete Cargo project in /output.

${GROUND_TRUTH}

=== COMPONENT SPECS (derived by independent reverse-engineering agents) ===
${specText}
=== END SPECS ===

HARD REQUIREMENTS (a grader checks these):
1. Rust 2021 edition, ZERO external crates - std only. No dev-dependencies either.
2. Must build BOTH ways from /output:
     rustc -O test19.rs -o test19      (so module files must be reachable from test19.rs)
     cargo build --release
3. The entry file MUST be at /output/test19.rs (package root, NOT src/main.rs).
4. Library code MUST be organized into modules (not all crammed into test19.rs).
5. CLI: the C++ main takes (argc, argv) and IGNORES them - output is invariant. Still read them via
   std::env::args() and deliberately ignore, mirroring C++. Never panic on any argv.
6. stdout must be BYTE-FOR-BYTE identical to the C++ binary for every invocation.

SUGGESTED LAYOUT (use unless you have a concrete reason not to):
  /output/Cargo.toml           # [[bin]] name = "test19", path = "test19.rs", edition 2021
  /output/test19.rs            # mod indicators; fn main() - mirrors the C++ main line-for-line
  /output/indicators/mod.rs    # pub mod cyclic; pub mod display; pub mod format; re-exports
  /output/indicators/cyclic.rs     # CyclicProgress
  /output/indicators/display.rs    # ProgressDisplay (Default + new(total) + update + increment + display)
  /output/indicators/format.rs     # Format::percentage / Format::progress
With a [[bin]] path pointing at test19.rs, cargo resolves "mod indicators" relative to /output, so the same
tree compiles under plain rustc. Verify this, don't assume.

IMPLEMENTATION NOTES:
- Mirror the C++ main's structure: three CyclicProgress objects, an array [ProgressDisplay; 3] that is
  default-constructed then assigned, the loops, and the exact println! order. Never hardcode expected strings.
- C++ streams floats as double: do arithmetic and formatting in f64 (promote f32 args) so rounding matches glibc.
- Percentage helper computes (current as f64) * 100.0 / (total as f64), printed with 1 decimal.
- Model the C++ default argument for percentage's precision (e.g. percentage(v) + percentage_with(v, p), or a
  clearly documented pair) so the API shape survives.
- Idiomatic Rust: doc comments on public items, derives where sensible, Default impl for ProgressDisplay,
  no unsafe, no panics. Use rem_euclid for the spinner index so a negative count cannot panic.
- Add #[cfg(test)] unit tests in the modules asserting the known-good strings; they must pass under cargo test.

VERIFY BEFORE YOU RETURN (actually run these; do not claim success without pasting real output):
  cd /output && rustc -O test19.rs -o test19 && ./test19 | diff - <(/workspace/dataset/test19_executable) && echo BYTE_EXACT
  cd /output && cargo build --release 2>&1 | tail -5 && ./target/release/test19 | cmp - <(/workspace/dataset/test19_executable) && echo CARGO_BYTE_EXACT
  cd /output && cargo test 2>&1 | tail -20
  cd /output && for a in "" "0" "1" "-1" "abc" "--help" "x y z"; do diff <(./test19 $a) <(/workspace/dataset/test19_executable $a) >/dev/null || echo "ARG MISMATCH: $a"; done

Leave BOTH compiled artifacts in place: /output/test19 (from rustc) and /output/target/release/test19.
Report: the final file tree, the exact verification output proving byte-equality, and any judgement calls
you made on unobservable behavior.`, { label: 'implement', phase: 'Implement' })

log('Implementation pass complete')

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'findings'],
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'file', 'detail', 'repro', 'suggested_fix'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          detail: { type: 'string' },
          repro: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reasoning'],
  properties: {
    real: { type: 'boolean' },
    reasoning: { type: 'string' },
    corrected_severity: { type: 'string' },
  },
}

const VERIFIERS = [
  {
    key: 'byte-diff',
    prompt: `Adversarially verify OUTPUT EQUALITY between the Rust port in /output and the C++ binary
/workspace/dataset/test19_executable. Do NOT trust the implementer's claims.

- Rebuild yourself: cd /output && rustc -O test19.rs -o /tmp/t19_rustc; and cargo build --release.
- Compare stdout with cmp/od for BOTH Rust binaries against the C++ one, byte level, including trailing
  newline and absence of a BOM. Check stderr is empty and exit code 0 for all three.
- Fuzz argv: no args, empty-string arg, "0", "-1", "999999999999999999999", "--help", a unicode arg,
  50 args, an arg containing spaces and newlines. Identical stdout required, no panics.
- Also test an arg that is invalid UTF-8 (build with printf). NOTE: std::env::args() PANICS on invalid
  UTF-8 while C++ never does. If the implementation uses args() and that panic is reachable, report it.
- Verify exit status matches (0).
Report every divergence as a finding. Empty findings array if everything matches.`,
  },
  {
    key: 'build-hygiene',
    prompt: `Adversarially audit BUILD and PROJECT STRUCTURE of /output against the grader requirements.
Do NOT trust the implementer. Check and report violations:
1. Zero external dependencies: Cargo.toml [dependencies]/[dev-dependencies] empty or absent. grep the tree
   for "extern crate" and any non-std "use" path. Read Cargo.lock if present; report any third-party package.
2. edition = "2021".
3. /output/test19.rs exists and is the entry file at the package root (not src/main.rs).
4. Library code split into MODULES (multiple .rs files), not one monolith. Count files and lines.
5. BOTH build paths work from CLEAN state: rm -rf /output/target then cargo build --release; and copy the
   tree to a temp dir and run rustc -O test19.rs there. Report any compiler warning (minor finding).
6. cargo test passes; report test count (zero tests is a minor finding).
7. No unsafe; no blanket allow attributes hiding real problems.
8. Artifacts exist and are executable ELF: /output/test19 and /output/target/release/test19 (use file(1)).
Report each violation with a repro command. Empty array if clean.`,
  },
  {
    key: 'numeric-fidelity',
    prompt: `Adversarially audit NUMERIC AND FORMATTING FIDELITY of the Rust port in /output versus C++
iostream semantics. Highest-risk area - be rigorous.

Read /output/**/*.rs. Then:
1. Confirm every fixed-precision print goes through f64, not f32 (C++ promotes float to double in
   operator<<). Empirically test: write a small Rust program in /tmp printing a tricky value set at
   precisions 0..6 as both f32 and f64 and show where they differ. Check g++ availability
   (which g++ c++ clang++); if a C++ compiler exists, build the equivalent C++ program and diff the two
   outputs. If none exists, say so and reason from IEEE-754 + glibc printf semantics, using
   test19_executable as the only oracle. Tricky values: 0.25, 0.5, 0.75, 0.1, 0.15, 0.145, 2.675,
   1.0/3.0, 0.0005, 1e-7, 0.0, -0.0, and integer-ratio percentages 1/3, 2/3, 1/6, 5/6, 1/7 as x*100/y.
2. Verify percentage formula ordering: (current * 100.0) / total vs (current / total) * 100.0 can differ by
   an ulp at a rounding boundary. Determine which the C++ binary uses if observable; if not observable from
   this program's fixed inputs, report the risk as a minor finding and state the safer default.
3. Integer types: C++ ints are 32-bit. If Rust uses i32/u32/usize/i64, consider overflow/wrapping divergence
   and whether a debug-mode Rust panic is reachable where C++ would wrap. Report if so.
4. Spinner index math: zero/negative total, and count % 8 where count could be negative (C++ -1%8 == -1
   would index out of bounds; Rust would panic). Confirm rem_euclid or an unsigned counter is used.
Report findings with concrete repro commands. Empty array if genuinely clean.`,
  },
  {
    key: 'faithfulness',
    prompt: `Adversarially audit STRUCTURAL FAITHFULNESS of /output/test19.rs and its modules to
/workspace/dataset/test19.cpp. Read both. Check skeptically:
- Every C++ statement has a corresponding Rust statement in the same order, producing the same 15 output
  lines in sequence. Map the println! calls 1:1 to the std::cout statements.
- The three CyclicProgress objects are constructed with 5/10/15 and advanced 3/6/9 times via actual loops.
  CRITICAL: grep for hardcoded expected output - if the port prints literal precomputed strings instead of
  computing them, that is a BLOCKER.
- The ProgressDisplay array is default-constructed then assigned, mirroring the C++ (a Default impl must
  exist and be used even though the values are overwritten).
- Format::percentage's C++ default argument (precision = 1) is modeled in the API, not just inlined at the
  call site in a way that loses the interface.
- API shape preserved: CyclicProgress with next()/str(); ProgressDisplay with update()/increment()/display();
  a Format type/namespace with percentage()/progress() associated functions. Flattening everything into free
  functions inside main is a major finding.
- Module organization is real (mod.rs re-exports, doc comments) and the code reads as idiomatic Rust rather
  than transliterated C++.
Report findings. Empty array if clean.`,
  },
]

const verified = await pipeline(
  VERIFIERS,
  v => agent(v.prompt, { label: `verify:${v.key}`, phase: 'Verify', schema: FINDINGS_SCHEMA }),
  (report, v) => {
    if (!report || !report.findings || report.findings.length === 0) return { dimension: v.key, findings: [] }
    return parallel(report.findings.map(f => () =>
      agent(`You are a skeptical adjudicator. Another agent reported this finding about the Rust port in /output.
Your job is to REFUTE it. Default to real=false unless you reproduce the problem yourself.

FINDING: ${f.title} [${f.severity}] in ${f.file}
DETAIL: ${f.detail}
CLAIMED REPRO: ${f.repro}
SUGGESTED FIX: ${f.suggested_fix}

Actually run the repro. Read the code. The bar for real=true: it causes (a) a byte difference from
/workspace/dataset/test19_executable, (b) a build failure under "rustc -O test19.rs" or "cargo build
--release", (c) a violation of an explicit grader requirement (zero deps, edition 2021, test19.rs at package
root, library code in modules), or (d) a panic/crash the C++ never exhibits. Otherwise it is style noise ->
real=false. Hypothetical concerns about code paths this program never reaches are real=false UNLESS they
represent a genuine unfaithful-port defect such as hardcoded output.`,
        { label: `refute:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(vd => ({ ...f, dimension: v.key, verdict: vd }))
    )).then(rs => ({ dimension: v.key, findings: rs.filter(Boolean).filter(x => x.verdict && x.verdict.real) }))
  }
)

const confirmed = verified.filter(Boolean).flatMap(r => r.findings || [])
log(`${confirmed.length} confirmed finding(s) after adversarial refutation`)

phase('Repair')
let repairReport
if (confirmed.length > 0) {
  repairReport = await agent(`Fix these CONFIRMED defects in the Rust port at /output. Each survived an
adversarial refutation pass, so treat them as real.

${confirmed.map((f, i) => `${i + 1}. [${f.severity}] ${f.title} (${f.file})
   ${f.detail}
   Repro: ${f.repro}
   Suggested fix: ${f.suggested_fix}`).join('\n\n')}

Constraints that must still hold: zero external crates, edition 2021, entry file at /output/test19.rs,
library code in modules, byte-identical stdout to /workspace/dataset/test19_executable.

After fixing, re-verify and paste real command output:
  cd /output && rustc -O test19.rs -o test19 && ./test19 | cmp - <(/workspace/dataset/test19_executable) && echo BYTE_EXACT
  cd /output && cargo build --release && ./target/release/test19 | cmp - <(/workspace/dataset/test19_executable) && echo CARGO_BYTE_EXACT
  cd /output && cargo test 2>&1 | tail -15
Report what you changed and what you deliberately did not change.`, { label: 'repair', phase: 'Repair' })
} else {
  repairReport = 'No defects survived adversarial verification; no repairs applied.'
}

const finalGate = await agent(`Final gate check on /output. Run these and report the LITERAL output of each:
  cd /output && rm -rf target && cargo build --release 2>&1 | tail -8
  cd /output && rustc -O test19.rs -o test19 2>&1
  cd /output && ./test19 | cmp - <(/workspace/dataset/test19_executable) && echo RUSTC_BYTE_EXACT
  cd /output && ./target/release/test19 | cmp - <(/workspace/dataset/test19_executable) && echo CARGO_BYTE_EXACT
  cd /output && cargo test 2>&1 | tail -12
  cd /output && ls -la test19 target/release/test19
  find /output -path /output/target -prune -o -type f -print | sort
State plainly whether every gate passed. Do NOT modify any files; just report.`, { label: 'final-gate', phase: 'Repair' })

return {
  specs: specs.map(s => s.component),
  implementation: implReport,
  confirmedFindings: confirmed.map(f => ({ severity: f.severity, title: f.title, file: f.file })),
  repair: repairReport,
  finalGate,
}
