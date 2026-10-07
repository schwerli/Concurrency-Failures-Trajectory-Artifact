export const meta = {
  name: 'cpp-to-rust-test5-indicators',
  description: 'Port indicators test5.cpp to a dependency-free Rust Cargo project in /output, verified byte-for-byte against the C++ binary',
  phases: [
    { title: 'Analyze', detail: 'parallel read-only analysis: API semantics, float/format equivalence, packaging constraints' },
    { title: 'Design', detail: 'synthesize a single authoritative implementation spec' },
    { title: 'Implement', detail: 'one agent writes /output and builds it both ways' },
    { title: 'Verify', detail: 'adversarial verifiers, each with a distinct lens, read-only on /output' },
    { title: 'Fix', detail: 'single fixer applies confirmed defects' },
    { title: 'Critic', detail: 'completeness critic: what requirement is unmet or unverified' },
  ],
}

const CPP = `#include <iostream>
#include <string>
#include "../include/indicators.hpp"

int main(int argc, char* argv[]) {
    indicators::ProgressBuilder builder;
    builder.set_progress(60).set_total(200);
    std::cout << builder.build() << std::endl;

    indicators::ProgressTracker tracker;
    tracker.add_stage("Downloading")
           .add_stage("Processing")
           .add_stage("Saving");
    tracker.set_progress(1);
    tracker.set_total(3);
    std::cout << tracker.get_progress() << std::endl;
    std::cout << tracker.get_percentage() << std::endl;

    std::cout << indicators::Format::percentage(0.33f) << std::endl;
    std::cout << indicators::Format::percentage(0.66f, 2) << std::endl;
    return 0;
}`

const FACTS = `
=== GROUND TRUTH ===
C++ entry file (/workspace/dataset/indicators/tests/test5.cpp), verbatim:
---
${CPP}
---

The C++ library header ("../include/indicators.hpp") DOES NOT EXIST on this machine.
/workspace/dataset/ contains ONLY test5.cpp and test5_executable. This is a strictly
black-box port: infer the API contract from the call sites + observed stdout. Do not
hunt for the C++ library source; it is not there.

Reference binary: /workspace/dataset/test5_executable (runnable, ignores all argv).
Its stdout is EXACTLY these 29 bytes (verified with xxd + wc -c):
  "30.0%\\n1/3\\n33.3%\\n33.0%\\n66.00%\\n"
i.e. five lines, each terminated by a single \\n, no trailing blank line, exit code 0.
Passing extra argv (e.g. "foo bar 42") does not change the output.

Line-by-line attribution:
  line 1 "30.0%"  <- ProgressBuilder{progress=60,total=200}.build()
  line 2 "1/3"    <- ProgressTracker.get_progress()   (progress=1, total=3)
  line 3 "33.3%"  <- ProgressTracker.get_percentage()
  line 4 "33.0%"  <- Format::percentage(0.33f)        (default precision = 1)
  line 5 "66.00%" <- Format::percentage(0.66f, 2)     (explicit precision = 2)

=== TOOLCHAIN ===
rustc 1.75.0 / cargo 1.75.0. Rust 2021 edition. 64 cores.
ZERO external crates: std only. No crates.io, no dev-dependencies.

=== DELIVERABLE (from the task requirements, verbatim intent) ===
- A complete Cargo project rooted at /output.
- Library code organized into MODULES (not all in one file).
- The entry file MUST be /output/test5.rs, in the PACKAGE ROOT (not src/main.rs).
- It must be buildable BOTH ways:
    (a) cd /output && rustc test5.rs        -> produces executable /output/test5
    (b) cd /output && cargo build --release -> produces target/release/test5
  (Requirement text says "produce an executable at /output/test5.rs"; that is a typo
   for the rustc default output name /output/test5. Produce /output/test5.)
- CLI args: parse via std::env::args(); accept the same args as the C++ binary
  (which takes none and ignores extras). Must not panic or error on extra args.
- Output must be byte-for-byte identical to the C++ binary's stdout.
`

const KEY_TECHNIQUE = `
=== KEY TECHNIQUE for dual rustc + cargo buildability ===
Because the entry point lives at the package root but modules live under src/, the
entry file should pull in the module tree with #[path] attributes, which resolve
relative to the directory of the containing file (/output). Example:

    #[path = "src/indicators/mod.rs"]
    mod indicators;

and Cargo.toml declares:

    [[bin]]
    name = "test5"
    path = "test5.rs"

Do NOT also declare a [lib] target that compiles the same sources (double
compilation / ambiguity). Do NOT create src/main.rs. Verify BOTH build paths.
Also ensure the build is warning-clean (unused args, dead_code on genuinely-unused
public API is acceptable but prefer silencing it deliberately and explaining why).
`

phase('Analyze')

const A_SEMANTICS = {
  type: 'object',
  additionalProperties: false,
  required: ['api_contract', 'format_rules', 'open_questions'],
  properties: {
    api_contract: {
      type: 'array',
      description: 'One entry per inferred type/method needed by the call sites',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol', 'cpp_signature', 'rust_signature', 'behavior'],
        properties: {
          symbol: { type: 'string' },
          cpp_signature: { type: 'string' },
          rust_signature: { type: 'string' },
          behavior: { type: 'string' },
        },
      },
    },
    format_rules: { type: 'string', description: 'Exact formatting rule per output line and how to reproduce it in Rust' },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
}

const A_FLOAT = {
  type: 'object',
  additionalProperties: false,
  required: ['equivalence_verdict', 'evidence', 'recommended_arithmetic', 'edge_cases'],
  properties: {
    equivalence_verdict: { type: 'string', description: 'Do C++ std::fixed<<setprecision(N) and Rust {:.N$} agree on these values? Justify.' },
    evidence: { type: 'string', description: 'Concrete numeric evidence: exact binary values of 0.33f/0.66f, products, rounding decisions' },
    recommended_arithmetic: { type: 'string', description: 'f32 vs f64 multiply path, and why it cannot change any of the 5 output lines' },
    edge_cases: { type: 'array', items: { type: 'string' }, description: 'total=0, negatives, inf/NaN naming differences (Rust prints NaN, C++ prints nan), etc.' },
  },
}

const A_PKG = {
  type: 'object',
  additionalProperties: false,
  required: ['cargo_toml', 'file_layout', 'pitfalls'],
  properties: {
    cargo_toml: { type: 'string', description: 'Exact Cargo.toml contents to use' },
    file_layout: { type: 'array', items: { type: 'string' }, description: 'Exact file paths to create under /output' },
    pitfalls: { type: 'array', items: { type: 'string' } },
  },
}

const analyses = await parallel([
  () => agent(`You are reverse-engineering a C++ API from its call sites in order to re-implement it in Rust.

${FACTS}

TASK: Produce the precise API contract that /output/test5.rs must call, and the exact
formatting rule for each of the 5 output lines.

Think hard about:
- ProgressBuilder: fluent setters. \`builder.set_progress(60).set_total(200)\` chains, so in
  C++ they return a reference. In Rust that is \`fn set_progress(&mut self, v: i32) -> &mut Self\`.
  \`build()\` returns something streamable to std::cout that renders "30.0%" for 60/200
  => it returns a percentage string with 1 decimal place. 60/200 = 0.30 -> 30.0%.
- ProgressTracker: \`add_stage("...")\` chains (3 stages added, never printed).
  \`get_progress()\` -> "1/3" (i.e. "{progress}/{total}"). Note: get_progress is called BEFORE
  ... actually set_progress(1) and set_total(3) are both called before printing, so "1/3".
  \`get_percentage()\` -> "33.3%" for 1/3 (1 decimal).
- Format::percentage(float, int precision = 1) -> string of value*100 with \`precision\`
  decimals plus a literal '%'.
- Consider whether build()/get_percentage() most plausibly DELEGATE to Format::percentage
  (DRY, and consistent with all observed digits). Check that delegation reproduces every line.
- Stages are stored but unused in output. Decide what the Rust struct should keep and what
  minimal, honest accessors (if any) belong there. Do not invent sprawling unused API.

Also state, for each of the 5 lines, the exact Rust expression that produces it.

You may RUN /workspace/dataset/test5_executable and inspect it with tools like nm/strings/objdump
to CONFIRM the API surface and any embedded format strings — that is fair black-box observation
of the shipped binary. Report anything you learn from symbols (e.g. mangled names revealing
signatures like default-arg thunks, or float vs double parameter types).

Return the structured contract.`, { label: 'analyze:semantics', phase: 'Analyze', schema: A_SEMANTICS }),

  () => agent(`You are a floating-point formatting equivalence auditor.

${FACTS}

TASK: Prove (or refute) that a Rust implementation can reproduce lines 1,3,4,5 exactly,
and pin down the arithmetic path.

Specifically analyze:
1. 0.33f32 has exact value 0.3299999883651733398437500. Times 100:
   - in f32: what is the nearest f32 to 32.99999883651733? Show the spacing (2^-18 near 33)
     and the rounding decision.
   - in f64: 32.999998836517334.
   For each, what does C++ \`std::fixed << std::setprecision(1)\` print, and what does Rust
   \`format!("{:.1}", x)\` print? Must both be "33.0"?
2. 0.66f32 exact value, times 100, at precision 2 -> must be "66.00" in both.
3. 60/200: if computed as \`static_cast<float>(60)/200\` = 0.3f (=0.300000011920928955),
   times 100 in f32 -> is the result exactly 30.0f or 30.000002f? Show the ULP math.
   Does \`{:.1}\` print "30.0" either way?
4. 1/3: 0.33333334f * 100f = 33.333336f; f64 path = 33.333333333333336.
   Does \`{:.1}\` print "33.3" in both?
5. Rounding mode: C++ iostream/printf performs correctly-rounded exact decimal conversion
   with ties-to-even; Rust's {:.N} also does exact decimal conversion with ties-to-even.
   Confirm this and confirm none of the 5 values sits on a tie boundary.

WRITE AND RUN actual code to prove it. Use /tmp/fpcheck as your scratch dir (NEVER touch /output):
 - a C++ file compiled with g++ printing the candidate values with setprecision, and
 - a Rust file compiled with rustc printing the same via format!("{:.*}", p, v),
then diff them. Also print the values with 17 significant digits (%.17g / {:.17e}) to show
the exact binary values. Include the actual observed program output in your evidence field.

Then recommend the arithmetic path (f32 multiply then widen, vs widen then f64 multiply) and
state plainly whether the choice can change any of the 5 required output lines.

Also enumerate divergence risks in UNEXERCISED edge cases (total=0 -> C++ float div-by-zero
prints "inf"/"nan" but Rust {:.1} prints "inf"/"NaN"; negative totals; huge values) and
recommend whether the Rust port should guard total<=0. Be explicit that guarding is a
deliberate choice about untested behavior.`, { label: 'analyze:float-exactness', phase: 'Analyze', schema: A_FLOAT }),

  () => agent(`You are a Cargo/rustc packaging specialist.

${FACTS}
${KEY_TECHNIQUE}

TASK: Determine the exact, minimal, working project layout for /output that satisfies BOTH
build paths and the "modules, not one file" requirement, on rustc/cargo 1.75.0, edition 2021.

PROVE it works by building a THROWAWAY skeleton in /tmp/pkgcheck (NEVER touch /output):
create the same layout with trivial stub contents (a module that returns "ok"), then run
  cd /tmp/pkgcheck && rustc test5.rs && ./test5
  cd /tmp/pkgcheck && cargo build --release && ./target/release/test5
and report the actual command output for each. Confirm:
 - #[path = "src/indicators/mod.rs"] mod indicators; resolves for BOTH rustc and cargo
   (cargo sets the bin path to test5.rs, so #[path] is relative to /output in both cases)
 - nested submodules inside src/indicators/mod.rs (declared as plain \`pub mod format;\`)
   resolve relative to src/indicators/ WITHOUT needing further #[path] attributes
 - whether cargo warns/errors about test5.rs at the package root, about the missing
   src/main.rs, or about \`edition = "2021"\` + no lib target
 - whether target/ artifacts inside /output cause any problem
 - a .gitignore or not (irrelevant, but note if cargo complains about anything)
 - that the build is WARNING-FREE, and what pragma (if any) is needed for public API items
   that the entry file never calls (dead_code).

Report the exact Cargo.toml text you validated, the validated file layout, and every pitfall
you actually hit (with the real error text), not hypothetical ones.`, { label: 'analyze:packaging', phase: 'Analyze', schema: A_PKG }),
])

const [semantics, floats, pkg] = analyses

log('Analysis complete; synthesizing authoritative spec')

phase('Design')

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['spec', 'files', 'build_commands', 'risks'],
  properties: {
    spec: { type: 'string', description: 'The authoritative implementation spec: module layout, every type, every method signature and behavior, exact format strings' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'purpose'],
        properties: { path: { type: 'string' }, purpose: { type: 'string' } },
      },
    },
    build_commands: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const spec = await agent(`You are the architect for a black-box C++ -> Rust port. Three independent
analysts have reported. Synthesize ONE authoritative implementation spec. Resolve every
disagreement explicitly and pick the option that (a) reproduces the 29 required bytes and
(b) reads like idiomatic, honest Rust a reviewer would accept.

${FACTS}
${KEY_TECHNIQUE}

--- ANALYST 1: API semantics ---
${JSON.stringify(semantics, null, 2)}

--- ANALYST 2: float/format exactness ---
${JSON.stringify(floats, null, 2)}

--- ANALYST 3: packaging (validated against a real throwaway build) ---
${JSON.stringify(pkg, null, 2)}

Requirements for the spec you produce:
- Module layout under /output/src/ with a clear separation (e.g. indicators/mod.rs +
  format.rs + progress_builder.rs + progress_tracker.rs). Library code must NOT all live
  in the entry file.
- For EVERY public item: exact Rust signature and exact behavior.
- Fluent builders must support the same chaining shape as the C++ call sites
  (\`&mut self -> &mut Self\`).
- Rust has no default arguments. Specify how Format::percentage's \`precision = 1\` default is
  expressed. Prefer the plainly readable option (a second function such as
  \`percentage_with_precision(value, precision)\` with \`percentage(value)\` delegating to it)
  over a clever generic/trait-overload trick, UNLESS you can argue the trick is clearly better.
- Specify the exact format! strings. Percentage = value*100 rendered with N decimals + '%'.
  Progress = "{progress}/{total}".
- State the chosen arithmetic path and note it cannot alter the 5 lines (cite analyst 2).
- Decide the total<=0 guard and say why, flagging it as untested-by-the-reference behavior.
- Entry file must read std::env::args() and ignore extras, exactly like the C++ main which
  takes (argc, argv) and never uses them. It must not error on extra args. Keep it
  warning-clean.
- printing must use println! and produce exactly one trailing \\n at the end of the last line.

Do NOT write any files. Output the spec only.`, { phase: 'Design', schema: SPEC_SCHEMA })

log('Spec ready; implementing into /output')

phase('Implement')

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files_written', 'rustc_result', 'cargo_result', 'diff_result', 'byte_count', 'notes'],
  properties: {
    files_written: { type: 'array', items: { type: 'string' } },
    rustc_result: { type: 'string', description: 'Exact command + output of the rustc build and the run' },
    cargo_result: { type: 'string', description: 'Exact command + output of cargo build --release and the run' },
    diff_result: { type: 'string', description: 'Exact command + output of diffing Rust stdout against the C++ binary stdout' },
    byte_count: { type: 'string', description: 'wc -c of rust stdout and cpp stdout' },
    notes: { type: 'array', items: { type: 'string' } },
  },
}

const impl = await agent(`You are the sole implementer. You own /output exclusively. Write the project now.

${FACTS}
${KEY_TECHNIQUE}

=== AUTHORITATIVE SPEC (follow it; deviate only to fix an outright error, and say so in notes) ===
${JSON.stringify(spec, null, 2)}

INSTRUCTIONS:
1. Create every file with the Write tool. Real, complete, compiling Rust — no placeholders,
   no TODOs, no unimplemented!().
2. Code quality bar: this will be read by a human reviewer. Doc comments on public items
   explaining the inferred C++ contract. Consistent naming. No dead abstractions, no
   speculative API sprawl beyond what the contract needs.
3. Build BOTH ways from /output and capture real output:
     cd /output && rustc test5.rs 2>&1
     cd /output && ./test5
     cd /output && cargo build --release 2>&1
     cd /output && ./target/release/test5
4. Prove byte-for-byte equality against the reference, e.g.:
     cd /output && ./test5 > /tmp/rust.out
     /workspace/dataset/test5_executable > /tmp/cpp.out
     diff /tmp/rust.out /tmp/cpp.out && echo IDENTICAL
     cmp /tmp/rust.out /tmp/cpp.out && echo CMP_OK
     wc -c /tmp/rust.out /tmp/cpp.out
     xxd /tmp/rust.out | tail -3
   Also confirm the same for the cargo-built binary, and with extra argv passed
   (./test5 foo bar 42 must produce identical bytes), and that exit code is 0.
5. Builds must be WARNING-FREE. If rustc emits a warning, fix the cause (or, for public
   API deliberately unused by the entry file, apply a narrow, commented allow).
6. /output/test5 (the rustc-produced executable) MUST exist when you finish. Since cargo
   also writes target/, run the rustc build LAST if anything would clobber it, and verify
   /output/test5 exists and runs at the very end.
7. Do not leave stray scratch files in /output.

If any step fails, iterate until it passes. Report the REAL command outputs verbatim.`, { phase: 'Implement', schema: IMPL_SCHEMA })

log(`Implementation done. Files: ${(impl && impl.files_written ? impl.files_written.join(', ') : 'none reported')}`)

phase('Verify')

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'passed', 'findings'],
  properties: {
    lens: { type: 'string' },
    passed: { type: 'boolean', description: 'true only if this lens found NOTHING that must be fixed' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'summary', 'evidence', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          summary: { type: 'string' },
          evidence: { type: 'string', description: 'Real reproduction: command run + actual output. No speculation.' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const LENSES = [
  {
    key: 'byte-equality',
    prompt: `LENS: byte-for-byte output equality and CLI behavior.
Independently re-verify from scratch — trust nothing in the implementer's report.
Run the reference C++ binary and BOTH Rust binaries (/output/test5 built by rustc, and
/output/target/release/test5 built by cargo). Compare with cmp -l and xxd. Check:
 - exact 29 bytes, single trailing newline, no CR, no trailing blank line
 - exit code 0
 - identical output with no args, with extra args ("foo bar 42"), with an arg that looks
   like a flag ("--help", "-n", "--total=5"), and with an empty-string arg
 - stderr is empty
 - behavior when stdout is a pipe vs a file (should be identical)
 - LC_ALL/LANG variations do not change the Rust output (e.g. LC_ALL=C vs LC_ALL=de_DE.UTF-8;
   note the C++ binary uses the default "C" locale so decimal points must stay '.')
Report any mismatch as a blocker with the real command output.`,
  },
  {
    key: 'build-reproducibility',
    prompt: `LENS: build reproducibility and packaging compliance.
Verify BOTH build paths actually work FROM A CLEAN STATE, without mutating /output.
Copy the project: \`cp -a /output /tmp/verify-build\` then in the COPY delete build artifacts
(rm -rf target test5) and run both \`rustc test5.rs\` and \`cargo build --release\`, capturing
warnings. Requirements to check:
 - /output/test5.rs exists at the PACKAGE ROOT (not src/main.rs)
 - library code is split across MULTIPLE module files under /output/src/, not crammed into
   the entry file
 - Cargo.toml declares edition 2021 and has ZERO dependencies (no [dependencies] entries,
   no dev-dependencies, no build-dependencies); grep the whole project for \`extern crate\`
   and for any \`use\` of a non-std crate
 - both builds are warning-free (report the exact warning text if not)
 - \`cargo build --release\` binary name is test5
 - /output/test5 executable currently EXISTS in /output and runs
 - no leftover scratch/junk files in /output; list /output recursively
Also run \`cargo metadata --format-version 1 --no-deps\` (or cargo tree if available) to
prove the dependency set is empty. Report anything unmet as a blocker/major.`,
  },
  {
    key: 'numeric-adversarial',
    prompt: `LENS: adversarial numeric/formatting refutation. Your job is to BREAK the port.
Read the Rust implementation in /output, then try to construct a case where its formatting
diverges from the C++ semantics it claims to mirror. Work in /tmp/verify-num (never touch /output).
 - Extract the Rust percentage/progress formatting logic into a scratch harness and compare it
   against an equivalent C++ harness compiled with g++ (std::fixed/std::setprecision) over a
   sweep of values: 0.0, 0.005, 0.0049999, 0.125, 0.3, 0.33, 0.5, 0.6, 0.66, 0.999, 1.0,
   1.005, 2.0, tie-boundary values like 0.125/0.375 at precision 2, and random f32 bit patterns.
 - Test both precision 1 and 2, and precision 0 and 3 if the API allows.
 - Specifically probe rounding ties (does Rust round half-to-even like glibc printf?) and
   report any value where the two disagree, with both outputs printed.
 - Then judge: does any disagreement you found affect the 5 REQUIRED output lines? Findings that
   only affect values never exercised by test5 are at most 'minor' — say so honestly rather than
   inflating them, but DO report them.
 - Also check the integer path: does the Rust get_progress()/set_* use a type that would
   overflow or format differently from C++ int for the values used? Check negative and large
   values for panics (Rust debug overflow panics vs C++ UB) — is the shipped binary release or debug?
Default to reporting a finding only when you have real, printed evidence of divergence.`,
  },
  {
    key: 'requirements-compliance',
    prompt: `LENS: literal requirement compliance and code quality review.
The task's 7 numbered requirements are reproduced in the ground-truth block. Go through each
one and check the delivered /output against it literally, then review code quality.
 - Req 2: args parsed via std::env::args()? Does the code actually call it (grep), matching the
   C++ main(argc, argv) which ignores them? It must not be fake-satisfied by never touching args.
 - Req 4: std only.
 - Req 5: complete Cargo project; library code in modules; entry test file test5.rs at root.
 - Req 6: black-box — no copied C++ library source (none exists), no vendored header.
 - Req 7: files inside /output; /output/test5.rs saved; executable produced.
Code review: is the Rust idiomatic and readable? Are doc comments accurate and non-fabricated
(they must not claim to document C++ source nobody read — they should say "inferred")? Any
misleading comment, dead code, speculative unused API, panicking path, unwrap on user input,
or clippy-obvious smell? Is the fluent-builder ergonomics sane? Would a reviewer object to
anything? Read every file in /output. Do not modify anything.`,
  },
]

const verdicts = (await parallel(LENSES.map((l) => () =>
  agent(`You are an adversarial verifier. Be skeptical and specific. Every finding needs a real
reproduction (command + actual output). Do NOT modify anything under /output — it is read-only
for you; use /tmp/verify-${l.key} for any scratch work.

${FACTS}

${l.prompt}

Set passed=false only if you found something that MUST be fixed (blocker or major).
An empty findings list with passed=true is a perfectly good answer if the port is correct.`,
    { label: `verify:${l.key}`, phase: 'Verify', schema: VERDICT })
))).filter(Boolean)

const mustFix = verdicts.flatMap((v) => (v.findings || []).filter((f) => f.severity === 'blocker' || f.severity === 'major'))
const minor = verdicts.flatMap((v) => (v.findings || []).filter((f) => f.severity === 'minor' || f.severity === 'nit'))

log(`Verify: ${verdicts.length} lenses, ${mustFix.length} must-fix, ${minor.length} minor`)

let fixReport = 'no fixes needed'
if (mustFix.length > 0 || minor.length > 0) {
  phase('Fix')
  fixReport = await agent(`You own /output exclusively. Adversarial verifiers reported issues. Fix them.

${FACTS}
${KEY_TECHNIQUE}

MUST-FIX (blocker/major):
${JSON.stringify(mustFix, null, 2)}

ALSO REPORTED (minor/nit) — apply only if the fix is clearly correct and low-risk; otherwise
explain why you are declining:
${JSON.stringify(minor, null, 2)}

Rules:
- Never regress byte-for-byte output equality with /workspace/dataset/test5_executable.
- A "finding" may be WRONG. Independently reproduce each one first. If it does not reproduce,
  say so and change nothing for that item.
- After fixing, re-run the full proof from /output:
    rustc test5.rs (warning-free) ; ./test5 | cmp - <(/workspace/dataset/test5_executable)
    cargo build --release (warning-free) ; ./target/release/test5 | diff - /tmp/cpp.out
    ./test5 foo bar 42 | cmp - /tmp/cpp.out
  and ensure /output/test5 exists and runs at the end.
Report per item: reproduced? fixed / declined / not-a-bug, plus the final build+diff output.`, { phase: 'Fix' })
}

phase('Critic')

const CRITIC = {
  type: 'object',
  additionalProperties: false,
  required: ['ready', 'gaps', 'final_proof', 'summary'],
  properties: {
    ready: { type: 'boolean' },
    gaps: { type: 'array', items: { type: 'string' }, description: 'Requirements unmet or claims still unverified. Empty if none.' },
    final_proof: { type: 'string', description: 'Verbatim output of the final independent build + byte-diff + ls of /output' },
    summary: { type: 'string', description: 'Concise final state description for the user: layout, key design decisions, verification performed' },
  },
}

const critic = await agent(`You are the completeness critic and final gate. Assume the previous agents were
sloppy or over-claimed. Independently establish the true final state of /output.

${FACTS}

Prior reports (may be stale or wrong — verify, do not trust):
IMPLEMENTER: ${JSON.stringify(impl, null, 2)}
VERIFIERS: ${JSON.stringify(verdicts.map((v) => ({ lens: v.lens, passed: v.passed, findings: (v.findings || []).length })), null, 2)}
FIX PASS: ${typeof fixReport === 'string' ? fixReport : JSON.stringify(fixReport)}

Do this yourself, now, and paste the REAL output into final_proof:
  ls -laR /output
  cat /output/Cargo.toml
  cd /output && rm -f test5 && rustc test5.rs 2>&1 && echo "RUSTC_OK(warning-free if nothing above)"
  cd /output && ./test5 > /tmp/final_rust.out; echo "exit=$?"
  /workspace/dataset/test5_executable > /tmp/final_cpp.out
  cmp /tmp/final_rust.out /tmp/final_cpp.out && echo BYTES_IDENTICAL
  wc -c /tmp/final_rust.out /tmp/final_cpp.out
  cd /output && cargo build --release 2>&1 | tail -20 && ./target/release/test5 | cmp - /tmp/final_cpp.out && echo CARGO_BIN_IDENTICAL
  cd /output && ./test5 --help extra 1 2 3 | cmp - /tmp/final_cpp.out && echo ARGS_IGNORED_OK
  grep -rn "extern crate" /output --include=*.rs || echo "no extern crate"
  grep -n "dependencies" -A3 /output/Cargo.toml || echo "no dependencies section"
Then read every .rs file in /output and ask: what is MISSING or still unverified? Consider:
a requirement not literally satisfied; a module organization that is nominal rather than real;
a doc comment that lies; the entry file not actually using std::env::args(); /output/test5
absent; warnings; scratch files left behind.

Fix ONLY trivial, zero-risk gaps yourself (e.g. deleting a stray scratch file). For anything
else, report it in gaps. Set ready=true only if every one of the 7 requirements is literally
met and byte equality is proven by YOUR OWN command output.`, { phase: 'Critic', schema: CRITIC })

return { spec, impl, verdicts, fixReport, critic }
