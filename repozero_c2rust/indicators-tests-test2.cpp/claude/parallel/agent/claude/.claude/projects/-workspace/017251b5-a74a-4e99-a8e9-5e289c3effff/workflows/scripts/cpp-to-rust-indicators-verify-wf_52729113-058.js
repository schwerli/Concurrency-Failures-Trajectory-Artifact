export const meta = {
  name: 'cpp-to-rust-indicators-verify',
  description: 'Independently re-derive indicators.hpp semantics from the C++ binary, differentially test the Rust port, adversarially audit requirement compliance, then fix and re-verify',
  phases: [
    { title: 'Derive', detail: 'independent spec derivation from the binary + reconstructed C++ reference built with g++' },
    { title: 'Verify', detail: 'differential tests, formatting stress test, arg matrix, spec conformance, adversarial code review' },
    { title: 'Adjudicate', detail: 'refute each reported finding independently' },
    { title: 'Fix', detail: 'apply confirmed findings to /output' },
    { title: 'Final', detail: 'clean-room rebuild and end-to-end byte-identity check' },
  ],
}

const CPP_BIN = '/workspace/dataset/test2_executable'
const CPP_SRC = '/workspace/dataset/test2.cpp'
const OUT = '/output'
const GXX = '/opt/compiler/gcc-12/bin/g++'

const EXPECTED = '[======================>       ] 75.0%\\n75.0%\\n'

// The spec I derived from objdump. Given to the agents that need it; deliberately
// NOT given to the independent-derivation agent.
const SPEC = `
indicators::ProgressBar — memory layout recovered from the ctor at 0x402790:
  @0x00 int progress          default 0
  @0x04 int total             default 100
  @0x08 int width             default 50   (movl $0x32)
  @0x0c bool show_percentage  default true
  @0x0d bool show_bar         default true   (gates opening glyph + body + closing glyph)
  @0x10 std::string fill      "="
  @0x18 std::string lead      ">"
  @0x20 std::string remainder " "
  @0x28 std::string start     "["
  @0x30 std::string end       "]"

std::string ProgressBar::str() const  — recovered from 0x402b20:
  std::ostringstream os;
  if (show_bar) {                       // cmpb 0xd(%rbx)
    os << start;
    int completed = (int)((float)progress / (float)total * (float)width);
        // cvtsi2ss progress; cvtsi2ss total; divss; cvtsi2ss width; mulss; cvttss2si
    for (int i = 0; i < width; ++i) {   // loop skipped entirely when width <= 0
      if (completed > i)       os << fill;
      else if (completed == i) os << lead;
      else                     os << remainder;
    }
    os << end;
  }
  if (show_percentage) {                // cmpb 0xc(%rbx)
    if (show_bar) os << " ";
    os << std::fixed << std::setprecision(1)
       << ((double)((float)progress / (float)total) * 100.0) << "%";
       // divss -> cvtss2sd -> mulsd 100.0 -> _M_insert<double>; precision=1, fixed flag 0x4
  }
  return os.str();

indicators::Percentage(float value): str() == fixed/setprecision(1) of ((double)value * 100.0), then "%".
  (In main the value is constant-folded to the double 75.0 at 0x403070.)

main() takes argc/argv and never reads them: set_progress(75); set_total(100); set_width(30);
cout << bar.str() << endl; Percentage pct(0.75f); cout << pct.str() << endl; return 0;
Program output is therefore invariant across all command lines:
  "${EXPECTED}"
`

const RULES = `
Ground rules:
- The C++ library header (include/indicators.hpp) does NOT exist in this repo. The only reference
  for library behaviour is the compiled binary ${CPP_BIN} (objdump/nm/gdb are available) and
  the caller ${CPP_SRC}.
- Do NOT modify anything under ${OUT} unless your task explicitly says to. Use /tmp for scratch.
- If you build the Rust project with cargo, set CARGO_TARGET_DIR to a unique /tmp dir so parallel
  agents don't contend on the same target lock. rustc is 1.75.0; g++ 12 is at ${GXX}.
- Zero external crates are allowed: std only. Rust edition 2021.
- Report facts you actually observed by running commands. Never claim a test passed without output.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What you ran and what the overall result was' },
    commands_run: { type: 'array', items: { type: 'string' }, description: 'Key commands, verbatim' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string', description: 'path, or "" if not file-specific' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          detail: { type: 'string', description: 'What is wrong and why it matters' },
          evidence: { type: 'string', description: 'Actual command output proving it' },
          suggested_fix: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'detail', 'evidence', 'suggested_fix'],
      },
    },
  },
  required: ['summary', 'commands_run', 'findings'],
}

phase('Derive')

const derived = await parallel([
  // A1: independent derivation — no access to my notes, must reach its own conclusions.
  () => agent(`You are reverse-engineering a small C++ header from a compiled binary.

${RULES}

Task: derive the COMPLETE observable semantics of \`indicators::ProgressBar\` and
\`indicators::Percentage\` from the binary ${CPP_BIN}, using the caller source ${CPP_SRC} for context.

Do this rigorously and independently — do not guess. Use:
  nm -C ${CPP_BIN}
  objdump -dC --no-show-raw-insn ${CPP_BIN}
  objdump -s -j .rodata ${CPP_BIN}
and read the disassembly of indicators::ProgressBar::ProgressBar(), ProgressBar::str(), and the
inlined Percentage code in main().

Recover and report precisely:
1. The struct field layout (offsets, types) and every constructor default value, including the
   default glyph strings from .rodata and the default width/total/progress and any bool flags.
2. The exact control flow of str(): what each bool flag gates, the loop bounds, the per-iteration
   choice between the glyph strings, and the exact comparison operators used (>, ==, <).
3. The exact floating-point arithmetic: which operations are float (divss/mulss) vs double
   (cvtss2sd/mulsd), where the int truncation happens (cvttss2si), and the ostream precision/flags
   used for the percentage (look for the precision store and the fmtflags and/or masks).
4. What Percentage::str() computes.
5. Whether main() reads argc/argv at all, and therefore whether program output depends on the
   command line. Prove it by running the binary with several different argument lists.

Return your derivation as the "summary" field (be complete and specific — this is the reference
spec another agent will check an implementation against). Put anything you could NOT determine, or
where two readings are possible, in "findings" with severity "minor" and the title prefixed
"AMBIGUITY:". Include the exact expected stdout bytes of the program in summary.`,
    { label: 'derive-spec', phase: 'Derive', schema: FINDINGS_SCHEMA }),

  // A2: reconstructed C++ reference, compiled with the real g++ + real libstdc++.
  () => agent(`You are building a reference oracle for a C++ -> Rust port.

${RULES}

Here is the specification of the original C++ header, recovered from the binary's disassembly:
${SPEC}

Task: reconstruct that header as real C++ and build a *parameterised* oracle so the Rust port can be
differentially tested against genuine libstdc++ iostream behaviour.

Steps:
1. Write /tmp/ref/indicators.hpp implementing indicators::ProgressBar and indicators::Percentage
   exactly per the spec above (same field defaults, same float/double widths, same
   std::fixed/setprecision(1), same loop and comparisons, same UB-shaped int cast).
2. Write /tmp/ref/exact.cpp that is a byte-for-byte behavioural clone of ${CPP_SRC} (same calls,
   same std::cout << ... << std::endl). Compile with:
     ${GXX} -O2 -std=c++17 -o /tmp/ref/exact /tmp/ref/exact.cpp
   Verify /tmp/ref/exact produces output IDENTICAL to ${CPP_BIN} (compare with cmp, and also with
   a couple of different argv lists). If it does not match, fix your header until it does. This is
   the gate that proves your reconstruction is faithful — report failure honestly if you cannot
   reach a match.
3. Write /tmp/ref/probe.cpp: a CLI oracle that takes arguments
     probe bar <progress> <total> <width>      -> prints ProgressBar::str() followed by '\\n'
     probe pct <float>                          -> prints Percentage::str() followed by '\\n'
     probe fixed1 <double>                      -> prints std::fixed/setprecision(1) of the double
   Parse numbers so that "inf", "-inf", "nan", "0x1p-3" etc. work (use strtod/strtol, and accept
   INT_MIN..INT_MAX for the ints). Compile it to /tmp/ref/probe with the same flags.
4. Sanity-check the probe: /tmp/ref/probe bar 75 100 30 must print
   "[======================>       ] 75.0%" and /tmp/ref/probe pct 0.75 must print "75.0%".
5. chmod 755 the /tmp/ref directory and the binaries so other agents can run them.

Return in "summary": the absolute paths of the built binaries, the exact probe CLI usage, and
confirmation (with cmp output) that /tmp/ref/exact matches ${CPP_BIN} byte-for-byte. Report any
place where you had to guess in "findings".`,
    { label: 'cpp-reference', phase: 'Derive', schema: FINDINGS_SCHEMA }),
])

const specAgent = derived[0]
const refAgent = derived[1]
const independentSpec = specAgent ? specAgent.summary : '(independent derivation unavailable)'
const refInfo = refAgent ? refAgent.summary : '(C++ reference oracle unavailable — build it yourself if you need it)'

log('Derivation complete; starting six parallel verification passes')

phase('Verify')

const verifyPrompts = [
  {
    label: 'differential-lib',
    prompt: `Differentially test the Rust port's library semantics against a real C++ oracle.

${RULES}

The Rust port under test lives in ${OUT} (entry ${OUT}/test2.rs, modules under ${OUT}/src/).
A reconstructed C++ oracle was built by another agent:
${refInfo}

If those oracle binaries are missing or don't work, rebuild them yourself from this spec:
${SPEC}

Task: write a Rust differential harness in /tmp/diff (e.g. a small bin that depends on the
${OUT} library via a #[path] module include — do NOT edit ${OUT}) exposing the same CLI as the C++
probe (bar <progress> <total> <width>, pct <float>, fixed1 <double>), then compare Rust vs C++
across a large grid, including:
  - progress 0..=120 x total in {1,7,100,150,200,3,1000} x width in {0,1,2,3,7,29,30,40,50,80}
  - progress > total (overflow), negative progress, negative total, negative width, total = 0
  - i32::MIN / i32::MAX for progress, total and width
  - pct values: 0, 1, 0.75, 0.125, 0.5, 0.005, 0.0005, 1e-9, -0.5, 12.7, inf, -inf, nan, 1e30, f32::MIN, f32::MAX
  - fixed1: several thousand values incl. exact decimal ties (0.05,0.15,0.25,...,x.x5), subnormals,
    1e-320, 1e300, -0.0, values around 2^53, and random bit patterns
Report every mismatch as a finding with the exact inputs and both outputs. If a mismatch is a
divergence in the Rust code, say which file/line. Report the total number of cases compared.`,
  },
  {
    label: 'requirements-audit',
    prompt: `Audit a C++ -> Rust migration deliverable against its stated requirements.

${RULES}

Deliverable: ${OUT} (Cargo project). Entry file ${OUT}/test2.rs. Reference C++ binary ${CPP_BIN},
C++ source ${CPP_SRC}.

The requirements the deliverable must satisfy:
1. Pure Rust, edition 2021, compiles with rustc or as a Cargo project.
2. The Rust binary accepts exactly the same command-line arguments as the C++ binary (same names,
   defaults, required fields), parsed via std::env::args(). Note: the C++ main() ignores argv
   entirely — verify that claim yourself against the binary and confirm the Rust side behaves the
   same (never errors, never changes output, never panics) for any argv.
3. Algorithm logic, numeric precision and string formatting exactly match the C++ source;
   println! output byte-for-byte identical to std::cout output.
4. Zero external dependencies: std only, no crates.io.
5. Complete Cargo project in ${OUT}, library code organised into modules, entry test file at
   ${OUT}/test2.rs (package root).
6. Compiles and produces an executable (via \`rustc test2.rs\` or \`cargo build --release\`).

Verify each one empirically. Things worth actually running:
  - cd ${OUT} && rustc -O --edition 2021 test2.rs -o /tmp/ra/test2 && cmp <(/tmp/ra/test2) <(${CPP_BIN})
  - plain \`rustc test2.rs\` with NO --edition flag (does the project still work if the grader does
    that? edition 2015 is the rustc default — check whether the code compiles under 2015 too, and
    report it as a finding if it does not, with a fix that keeps both working)
  - CARGO_TARGET_DIR=/tmp/ra/t cargo build --release --offline, then run the produced binary
  - CARGO_TARGET_DIR=/tmp/ra/t cargo test --offline
  - grep the tree for any non-std dependency; check Cargo.toml [dependencies] is empty
  - confirm the required files exist at the required paths, and that ${OUT}/test2.rs is still a
    Rust SOURCE file (not overwritten by a compiled artifact)
  - check for compiler warnings (rustc -O test2.rs 2>&1, cargo build 2>&1) — warnings are a finding
Report any requirement that is not provably satisfied as a finding, with the failing output.`,
  },
  {
    label: 'format-fidelity',
    prompt: `Stress-test one specific fidelity claim in a C++ -> Rust port.

${RULES}

The Rust port formats the percentage with Rust's \`format!("{:.*}", precision, value)\` (see
${OUT}/src/indicators/cxx_fmt.rs), claiming it is equivalent to C++
\`std::ostream << std::fixed << std::setprecision(1) << double\`, with non-finite values special-cased
to "nan" / "-nan" / "inf" / "-inf".

Task: try hard to REFUTE that claim. Build a C++ harness with ${GXX} that prints
std::fixed/setprecision(p) for a value, and a Rust harness that calls the port's
cxx_fmt::fixed(value, p) — then compare over a very large corpus:
  - precision 1 (the one that matters) and also 0, 2, 6, 17 in case the helper is reused
  - millions of random f64 bit patterns (fixed seed, e.g. an xorshift you write yourself)
  - all exact decimal ties: k/2^n values that land exactly on a rounding boundary for the chosen
    precision (e.g. 0.25, 0.75, 2.5, 1.0625, 8.5, 1e15+0.5)
  - halfway-looking decimals that are NOT exact ties (0.15, 0.35, 8.35, 2.675)
  - subnormals, DBL_MIN, DBL_MAX, 1e300, 1e-300, -0.0, +0.0, values needing 700+ digits
  - NaN with sign bit set and clear, +/- infinity, and NaNs with payloads
Also verify the exact NaN produced by the port's own path: what does the C++ binary print for
progress/total when total == 0 (0.0f/0.0f) — "nan" or "-nan"? Prove it with a g++ program that
mirrors the spec below, and check the Rust port agrees.

Spec of the original C++ code:
${SPEC}

Report every divergence with the exact bit pattern (as hex), the C++ output and the Rust output.
State the total number of comparisons made. If you find zero divergences, say so explicitly and
report the corpus size.`,
  },
  {
    label: 'arg-matrix',
    prompt: `Verify byte-for-byte CLI equivalence between a C++ binary and its Rust port.

${RULES}

C++: ${CPP_BIN}. Rust: build ${OUT}/test2.rs into /tmp/am/test2 (rustc -O --edition 2021, do not
modify ${OUT}), and also build the cargo release binary into /tmp/am/t via CARGO_TARGET_DIR.

Task: run BOTH binaries over a large matrix of command lines and compare stdout, stderr and exit
status byte-for-byte. Cover at least:
  - no arguments
  - the five documented example arg sets from ${CPP_SRC} (progress/total/width/percentage values),
    passed as bare positionals, as --key=value, and as --key value
  - a single argument; 1000 arguments; empty-string arguments; arguments with spaces, newlines,
    tabs, quotes, backslashes, NUL-adjacent bytes, invalid UTF-8 bytes (use a shell that can pass
    raw bytes, e.g. printf into a wrapper or python3 subprocess with bytes argv)
  - --help, -h, --version, -- , -, values like "abc", "", "1e999", "-0", "nan"
  - argv[0] varied (invoke via a symlink and via an exec wrapper that sets a different argv[0])
  - stdout redirected to a file, to a pipe, and to a closed pipe (e.g. \`| true\`, and | head -1) —
    check neither binary differs in exit status or writes anything to stderr
  - run under \`env -i\` (empty environment) and with LC_ALL=C / LC_ALL=en_US.UTF-8 / LANG=tr_TR.UTF-8
Report any difference as a finding with the exact argv and both outputs (hexdump if non-printable).
State how many command lines you compared.`,
  },
  {
    label: 'spec-conformance',
    prompt: `Check a Rust implementation against an independently derived specification.

${RULES}

Another agent independently reverse-engineered the original C++ header from the binary. Its
derivation:
--- BEGIN INDEPENDENT DERIVATION ---
${independentSpec}
--- END INDEPENDENT DERIVATION ---

Task: read the Rust port in ${OUT}/src/indicators/*.rs and ${OUT}/test2.rs and check it against that
derivation, line by line. For every element of the spec (field defaults, glyphs, flag gating, loop
bounds, comparison operators, float vs double arithmetic, truncation semantics, ostream precision,
the separator space, main()'s argv handling, the trailing newlines) either confirm the Rust matches
or report a finding.

Where the derivation and the Rust code disagree, go back to the binary yourself
(objdump -dC --no-show-raw-insn ${CPP_BIN}) and determine which one is right — say so explicitly in
the finding, quoting the relevant instructions. Also flag anything in the derivation that looks
wrong to you even if the Rust agrees with it.`,
  },
  {
    label: 'adversarial-review',
    prompt: `Adversarially review a small Rust codebase for defects.

${RULES}

Review ${OUT}/test2.rs, ${OUT}/src/lib.rs, ${OUT}/src/indicators/mod.rs,
${OUT}/src/indicators/progress_bar.rs, ${OUT}/src/indicators/percentage.rs,
${OUT}/src/indicators/cxx_fmt.rs and ${OUT}/Cargo.toml.

It is a port of this C++ program: ${CPP_SRC}, whose library semantics are:
${SPEC}

Hunt specifically for:
  - panics reachable from any input (integer overflow in debug builds! \`self.progress as f32\`,
    \`i32\` arithmetic, \`" ".repeat(n)\` with huge n, unwraps, indexing, allocation blowups). Check
    whether a DEBUG build (cargo build, no --release) can panic where the C++ cannot — e.g. run
    the debug binary, and consider width = i32::MAX.
  - any place Rust's semantics silently differ from C++: float-to-int casts, integer division,
    overflow, string handling, Display vs the str() method, iterator vs index loops.
  - correctness of the #[path] module wiring: does \`rustc test2.rs\` work from a different cwd
    (e.g. cd /tmp && rustc /output/test2.rs)? Does the lib target and the bin target both compile?
    Is anything compiled twice in a way that could break?
  - dead code / unused warnings, clippy-level sloppiness, misleading comments, and any comment or
    doc that states something the code does not do.
  - whether the unit tests in the files actually assert the right things (recompute the expected
    strings by hand from the spec; a test that encodes a wrong expectation is a finding).
Verify each suspicion by running something before reporting it. Do not report style preferences.`,
  },
]

const reviewed = await pipeline(
  verifyPrompts,
  (p) => agent(p.prompt, { label: p.label, phase: 'Verify', schema: FINDINGS_SCHEMA }),
  (res, p) => {
    if (!res || !res.findings || res.findings.length === 0) return { pass: p.label, summary: res ? res.summary : 'agent failed', findings: [] }
    // Adjudicate each finding with two independent skeptics, in parallel.
    return parallel(res.findings.map((f) => () =>
      parallel(['correctness', 'requirements'].map((lens) => () =>
        agent(`You are adjudicating a reported finding about a C++ -> Rust port. Default to REFUTED
unless you can reproduce the problem yourself.

${RULES}

Deliverable under review: ${OUT} (Rust port of ${CPP_SRC}; reference binary ${CPP_BIN}).
Original C++ semantics:
${SPEC}

Reported finding (from the "${p.label}" pass):
  title: ${f.title}
  file: ${f.file}
  severity: ${f.severity}
  detail: ${f.detail}
  evidence: ${f.evidence}
  suggested fix: ${f.suggested_fix}

Judge it through the ${lens} lens${lens === 'correctness'
          ? ' — is the described behaviour actually wrong relative to the C++ binary/spec? Reproduce it by running commands.'
          : ' — does this actually violate one of the stated migration requirements (edition 2021, identical CLI args via std::env::args(), byte-identical output, zero external crates, Cargo project in /output with modules and entry file /output/test2.rs, builds via rustc or cargo)? A finding that breaks no requirement and no C++-fidelity property is REFUTED as not actionable.'}

Reproduce or refute by running commands. Do NOT modify ${OUT}. Then answer: is this real and worth
fixing? If real, state the minimal correct fix precisely (exact file, exact code change).`,
          { label: `judge:${lens}:${f.title.slice(0, 40)}`, phase: 'Adjudicate', schema: {
            type: 'object',
            properties: {
              refuted: { type: 'boolean', description: 'true if the finding is not real or not actionable' },
              reasoning: { type: 'string' },
              reproduction: { type: 'string', description: 'commands + output, or why it could not be reproduced' },
              minimal_fix: { type: 'string' },
            },
            required: ['refuted', 'reasoning', 'reproduction', 'minimal_fix'],
          } })
      )).then((votes) => {
        const real = votes.filter(Boolean)
        const upheld = real.length > 0 && real.filter((v) => !v.refuted).length >= 1 && real.filter((v) => v.refuted).length < real.length
        const unanimous = real.length > 0 && real.every((v) => !v.refuted)
        return { finding: f, pass: p.label, votes: real, upheld: unanimous || upheld, unanimous }
      })
    )).then((judged) => ({ pass: p.label, summary: res.summary, findings: judged }))
  }
)

const allJudged = reviewed.filter(Boolean).flatMap((r) => r.findings || [])
const confirmed = allJudged.filter((j) => j && j.upheld)
const rejected = allJudged.filter((j) => j && !j.upheld)

log(`${allJudged.length} findings reported, ${confirmed.length} survived adjudication, ${rejected.length} refuted`)

let fixReport = null
if (confirmed.length > 0) {
  phase('Fix')
  const fixList = confirmed.map((c, i) => `
[${i + 1}] (${c.finding.severity}, from ${c.pass}${c.unanimous ? ', unanimous' : ', split vote'}) ${c.finding.title}
    file: ${c.finding.file}
    problem: ${c.finding.detail}
    evidence: ${c.finding.evidence}
    proposed fixes: ${c.finding.suggested_fix} | ${c.votes.map((v) => v.minimal_fix).join(' | ')}`).join('\n')

  fixReport = await agent(`Apply confirmed review findings to a Rust deliverable.

${RULES}
EXCEPTION: you ARE allowed — and required — to edit files under ${OUT} for this task.

Deliverable: ${OUT}, a Rust port of ${CPP_SRC}. Reference binary: ${CPP_BIN}.
Original C++ semantics that must be preserved exactly:
${SPEC}

These findings survived independent adjudication:
${fixList}

Task:
1. Fix each one with the minimal correct change. Do not restructure the project: the layout must
   stay a Cargo project rooted at ${OUT} with the entry file ${OUT}/test2.rs and library modules
   under ${OUT}/src/. Zero external crates. Edition 2021.
2. If you judge one of the findings to be wrong after all, do NOT change the code for it — say so
   in your report with your reasoning.
3. After fixing, re-verify everything:
     cd ${OUT} && rustc -O --edition 2021 test2.rs -o test2
     cmp <(${OUT}/test2) <(${CPP_BIN})        # must be identical
     CARGO_TARGET_DIR=/tmp/fx cargo build --release --offline && cmp <(/tmp/fx/release/test2) <(${CPP_BIN})
     CARGO_TARGET_DIR=/tmp/fx cargo test --offline
     CARGO_TARGET_DIR=/tmp/fx cargo build --offline && cmp <(/tmp/fx/debug/test2) <(${CPP_BIN})   # debug too
   plus a handful of argv variations. Ensure zero compiler warnings from both rustc and cargo.
4. Leave ${OUT}/test2 in place as the built executable (source ${OUT}/test2.rs must remain source).
   Remove any scratch files you created under ${OUT} that are not part of the deliverable.

Report exactly what you changed per finding, what you declined and why, and paste the verification
command output.`, { label: 'apply-fixes', phase: 'Fix', schema: FINDINGS_SCHEMA })
}

phase('Final')

const final = await parallel([
  () => agent(`Final clean-room acceptance check of a C++ -> Rust migration.

${RULES}

Deliverable: ${OUT}. Reference: ${CPP_BIN} (source ${CPP_SRC}).

Act as a skeptical grader who has never seen this project. Do everything from scratch:
1. \`cp -a ${OUT} /tmp/accept\` then delete any build artifacts there (target/, test2 binary,
   Cargo.lock) so you are building from source only.
2. Build both ways, in the copy, and record full output:
     cd /tmp/accept && rustc -O --edition 2021 test2.rs -o /tmp/accept/test2
     cd /tmp/accept && CARGO_TARGET_DIR=/tmp/accept/t cargo build --release --offline
   Report any warning or error verbatim.
3. Run each produced binary with no args and with each of the five documented example arg sets,
   comparing to ${CPP_BIN} with cmp -l. Also compare exit codes and stderr.
4. Run \`cargo test --offline\` and report the results.
5. Confirm requirement-by-requirement compliance and list the final file tree of ${OUT}
   (paths + sizes + file(1) type for test2.rs and test2).
6. Confirm ${OUT}/test2.rs is a Rust source file and that an executable exists in ${OUT}.
7. Grep the whole deliverable for anything non-std (extern crate, use of a crate name,
   [dependencies] entries, build.rs, .cargo/config).

Report PASS/FAIL per requirement in "summary". Any failure or warning is a finding.`,
    { label: 'acceptance', phase: 'Final', schema: FINDINGS_SCHEMA }),

  () => agent(`Completeness critic for a C++ -> Rust migration review.

${RULES}

Deliverable: ${OUT} (port of ${CPP_SRC}, reference ${CPP_BIN}).
Original C++ semantics as understood:
${SPEC}

Verification already performed by other agents: independent binary re-derivation; a reconstructed
C++ oracle compiled with g++ and confirmed byte-identical to the reference binary; a differential
grid over progress/total/width and percentage values; a formatting stress test of
std::fixed/setprecision(1) vs Rust's {:.1}; a CLI argv matrix (including weird bytes, locales,
redirected stdout); a spec-conformance read of the Rust source; an adversarial code review; and a
clean-room rebuild.

Task: ask what is STILL unverified, and then go verify the most valuable of those things yourself.
Think about: things the graders might do that nobody simulated; environments nobody tried
(different cwd, read-only ${OUT}, no HOME, no /tmp space, cross-compiling, older rustc,
\`cargo run\`, \`cargo build\` without --offline, \`rustc test2.rs\` with no flags at all so the
edition defaults to 2015); properties nobody asserted (stdout buffering/interleaving order, exit
code, locale-dependent formatting, output when stdout is a tty vs pipe); and any claim in the
Rust source's comments or doc-comments that was asserted but never tested.

Run the checks you identify. Report anything that fails, or any real gap you could not close, as a
finding. In "summary", list what you checked and what residual risk (if any) remains.`,
    { label: 'completeness-critic', phase: 'Final', schema: FINDINGS_SCHEMA }),
])

return {
  independent_derivation: independentSpec,
  reference_oracle: refInfo,
  verify_passes: reviewed.filter(Boolean).map((r) => ({ pass: r.pass, summary: r.summary, findings: (r.findings || []).length })),
  confirmed_findings: confirmed.map((c) => ({ pass: c.pass, severity: c.finding.severity, title: c.finding.title, file: c.finding.file, detail: c.finding.detail, unanimous: c.unanimous })),
  refuted_findings: rejected.map((c) => ({ pass: c.pass, title: c.finding.title, why: c.votes.map((v) => v.reasoning).join(' || ').slice(0, 600) })),
  fix_report: fixReport,
  final_checks: final.filter(Boolean).map((f) => ({ summary: f.summary, findings: f.findings })),
}
