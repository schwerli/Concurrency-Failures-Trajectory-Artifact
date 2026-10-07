export const meta = {
  name: 'cpp-to-rust-test7',
  description: 'Migrate indicators test7.cpp to pure-std Rust with byte-exact parity, verified adversarially',
  phases: [
    { title: 'Spec', detail: 'four independent lenses pin down numeric + formatting semantics' },
    { title: 'Implement', detail: 'write the Cargo project in /output' },
    { title: 'Verify', detail: 'differential fuzz, build matrix, adversarial review' },
    { title: 'Repair', detail: 'fix confirmed defects, re-verify' },
  ],
}

const CTX = `
CONTEXT (already established by the lead engineer - treat as high-confidence, but re-verify if your lens covers it):

Source: /workspace/dataset/indicators/tests/test7.cpp
Reference binary: /workspace/dataset/test7_executable  (x86-64 ELF, run it freely with any args)
The C++ library source (indicators.hpp) is NOT on disk. This is a black-box migration.

The C++ program:
    indicators::ProgressDisplay display(200);
    int progress = argc > 1 ? std::stoi(argv[1]) : 150;
    display.update(progress);
    std::cout << display.display() << std::endl;
    display.increment(25);
    std::cout << display.display() << std::endl;
    indicators::Percentage pct1(0.15f, 1);
    indicators::Percentage pct2(0.35f, 2);
    indicators::Percentage pct3(0.65f, 3);
    std::cout << pct1.str() << std::endl;   // 15.0%
    std::cout << pct2.str() << std::endl;   // 35.00%
    std::cout << pct3.str() << std::endl;   // 65.000%

DERIVED SPEC (v1):
1. ProgressDisplay holds two 32-bit ints: current, total(=200). update(p) assigns (NO clamping,
   negatives and >total are allowed). increment(n) does current += n with 32-bit wraparound
   (observed: arg 2147483647 -> second line shows -2147483624).
2. display() == "Progress: " + P + "%" + " (" + current + "/" + total + ")"
   where P is the percentage printed with std::fixed << std::setprecision(1).
   .rodata literals confirm the pieces: "Progress: ", "%", " (", "/", ")".
3. THE PERCENTAGE IS COMPUTED IN 32-BIT FLOAT, MULTIPLY-BEFORE-DIVIDE:
       P = (float)current * 100.0f / (float)total
   Proof: .rodata contains float 100.0f (bytes 00 00 c8 42 = 0x42c80000) and NO double 100.0.
   With current = 2147483647 the binary prints 1073741824.0%.
     - (f32)2147483647 = 2147483648.0f; *100.0f = 214748364800.0f (exact); /200.0f = 1073741824.0  MATCHES
     - double math would give 1073741823.5  -> would print "1073741823.5"                          RULED OUT
     - divide-first in f32 gives 1073741800.0                                                      RULED OUT
     - integer (current*100) would overflow to -100 -> "-0.5"                                      RULED OUT
4. Percentage(value: f32, precision).str() == fixed/setprecision(precision) of (value * 100.0f), then "%".
   0.15f->"15.0", 0.35f->"35.00", 0.65f->"65.000".
5. std::stoi semantics for argv[1] (C-locale strtol, base 10):
   skip leading whitespace (space, tab, newline, vertical-tab, form-feed, carriage-return), optional
   '+'/'-', then one or more decimal digits, stop at first non-digit. Verified: "12abc"->12,
   "  33  "->33, "+7"->7, "0x10"->0, "3.9"->3, "2e3"->2, "1_000"->1, "010"->10, leading-zero runs fine.
   No digits -> std::invalid_argument ("", "abc", ".5", "- 5", "--3", "+-3", "  +  7").
   Outside int32 -> std::out_of_range ("99999999999", "2147483648", "-2147483649").
6. On a stoi throw the program aborts BEFORE any stdout output. stdout is empty; stderr is exactly
   (bytes verified with od -c; note the two leading spaces on line 2 and the two spaces after "what():"):
       line1: terminate called after throwing an instance of 'std::invalid_argument'
       line2: <space><space>what():<space><space>stoi
   each line terminated by a single newline, with 'std::out_of_range' substituted for the range case.
   Process dies by SIGABRT -> shell exit status 134.
7. No argv[1] -> progress defaults to 150. Extra argv beyond [1] are ignored.
8. Every output line is terminated by a newline (std::endl), including the last.
`

const SPEC_LENSES = [
  {
    key: 'disasm',
    label: 'spec:disassembly',
    prompt: CTX + `

YOUR LENS: machine code. Verify spec points 2, 3 and 4 by disassembling /workspace/dataset/test7_executable
(objdump -d -M intel, readelf, nm -C, objdump -s -j .rodata / -j .rodata.cst4 / -j .rodata.str1.1).

Answer decisively:
  a) Does indicators::ProgressDisplay::display() use SS (scalar single / mulss,divss,cvtsi2ss) or
     SD (scalar double / mulsd,divsd,cvtsi2sd) arithmetic to form the percentage? Quote the instructions.
  b) What is the exact operation ORDER (multiply-then-divide vs divide-then-multiply)? Quote instructions.
  c) Same two questions for indicators::Percentage::str().
  d) Are the pct1/pct2/pct3 percentages constant-folded at compile time, or computed at runtime from
     stored float members? If folded, what exact float/double constants appear? (Look for 0x42c80000=100.0f,
     0x4059000000000000=100.0 double, 0x3e19999a=0.15f, 0x3eb33333=0.35f, 0x3f266666=0.65f, and any
     folded 15.0/35.0/65.0.) This determines whether a faithful port must multiply in f32 or may hardcode.
  e) What integer width are ProgressDisplay's members? (Look at the load/store widths: mov eax vs mov rax,
     and whether cvtsi2ss uses a 32-bit or 64-bit source.) Confirm increment wraps as 32-bit signed.
  f) Is std::setprecision/std::fixed used (look for calls to std::ostream::precision / setf, ios_base
     flags 0x100 fixed), or is snprintf/to_string used? Note which, since it affects rounding mode.

You may NOT read indicators.hpp (it is not on disk anyway). Report findings as evidence-backed facts,
flagging any place where spec v1 above is WRONG. Be specific: instruction addresses and mnemonics.`,
  },
  {
    key: 'blackbox',
    label: 'spec:blackbox-golden',
    prompt: CTX + `

YOUR LENS: pure black-box behaviour. Do NOT disassemble. Run /workspace/dataset/test7_executable over a
large, deliberately adversarial argument space and build a golden table. Cover at minimum:
  - every integer in -20..=20
  - boundary neighbourhoods: 0, 1, 199, 200, 201, 2147483647 and -2147483648 and +-30 around each,
    2147483622, 2147483623 (the increment-overflow boundary), 2147483647-25
  - values where the f32 percentage could round ambiguously at 1 decimal place: search for currents
    where current*100/200 lands near a tie, and any current large enough that f32 loses integer
    precision (abs value > 16777216, e.g. 16777217, 16777219, 33554433, 100000001, 1000000001)
  - malformed / tricky strings: "", " ", "abc", "0x1f", "12abc", "  -0  ", "-0", "+0", "007",
    whitespace-prefixed "42" using each of tab/newline/vtab/formfeed/CR, "2147483648", "-2147483649",
    "99999999999999999999", a 5000-digit number, 5000 zeros followed by "7", a non-ASCII digit such as
    the Arabic-Indic three, "1,000", "1 2", "--1"
  - no-args, and 2+ args
For each case record stdout, stderr and exit status EXACTLY (use od -c or base64 for anything with odd bytes;
capture stdout and stderr to separate files, never merged).

Report: (1) any case where spec v1 predicts something different from what you observed - this is the most
valuable output, hunt for it; (2) the full list of interesting or surprising cases with their exact expected
output. Write your complete golden table to /tmp/golden_blackbox.txt (one record per case, unambiguous
delimiters, e.g. base64 of stdout and stderr) so later stages can reuse it, and say so in your answer.`,
  },
  {
    key: 'fmt',
    label: 'spec:format-rounding',
    prompt: CTX + `

YOUR LENS: formatting and rounding equivalence between C++ and Rust. The port must render floats with
Rust's fixed-precision format specifier in place of std::ostream << std::fixed << std::setprecision(N).
Your job is to find every input where these two DISAGREE, so the port can compensate.

Method: check whether a C++ toolchain exists (g++ --version). If it does, write a small C++ program and a
small Rust program that each print a list of f32 values (converted to double by the C++ stream, as
ostream<<float does) with fixed precision 1, 2 and 3, and diff them over a large sample. If no C++ compiler
is available, say so and fall back to comparing Rust against the reference binary plus printf(1)/awk.
Sample space:
  - all the percentage values actually reachable in this task: (float)c*100.0f/200.0f for c across a wide
    integer range including huge magnitudes, plus 0.15f*100.0f, 0.35f*100.0f, 0.65f*100.0f
  - exact ties: 0.05, 0.15, 0.25, 0.35 ... 2.5, 0.125, 0.375, values of form k+0.5 and k+0.05
  - subnormals, positive and negative zero, positive and negative infinity, NaN and negative NaN
  - very large magnitudes where fixed notation prints many digits (1e30, f32::MAX)
Questions to answer decisively:
  a) Do C++ (glibc, round-half-to-even on the exact binary value) and Rust fixed formatting ever differ on
     a value reachable here? Give concrete counterexamples if any exist.
  b) Does negative zero print as "-0.0" in both?
  c) Infinity and NaN: C++ ostream prints "inf"/"-inf"/"nan"/"-nan"; what does Rust print, and does any
     reachable input in THIS program hit those? (total is hardcoded 200, so consider whether it can.)
  d) For huge f32 values (e.g. 1e30f) does Rust produce the identical full digit expansion as C++ fixed
     formatting? Show a concrete comparison.
  e) Confirm whether Rust formatting an f32 directly with a precision spec equals formatting that value
     cast to f64 with the same spec.
Report a clear verdict plus any compensation the Rust port must implement.`,
  },
  {
    key: 'stoi',
    label: 'spec:stoi-and-abort',
    prompt: CTX + `

YOUR LENS: std::stoi replication and the abort/exit-status path (spec points 5, 6, 7).

Part 1 - stoi. Nail the exact contract, testing against /workspace/dataset/test7_executable:
  - exactly which characters count as leading whitespace (test each of space, tab, newline, vertical tab,
    form feed, carriage return, and also a non-breaking space and other Unicode spaces, which should NOT
    be skipped)
  - sign handling, digit requirement, where scanning stops
  - overflow: is the boundary exactly -2147483648 to 2147483647? Test both endpoints and both endpoints
    plus/minus one. Test a value that overflows a 64-bit long (e.g. 99999999999999999999999) and a
    10000-digit number, and a 10000-zero prefix followed by a small number (must NOT be out_of_range).
  - is "-2147483648" accepted? (strtol accumulates negatively so it should be.)
Part 2 - the failure path, in Rust, with ZERO external crates:
  - Determine how to reproduce exit status 134 from pure std. Verify empirically that
    std::process::abort() yields shell status 134 (SIGABRT) on this machine: write and run a tiny Rust
    program that eprints then aborts, and compare the shell status variable and the raw wait-status
    against the C++ binary's.
  - Verify stderr byte-equality is achievable, and that nothing extra (Rust panic message, backtrace note)
    is emitted. Make sure stdout stays EMPTY and that anything buffered is not flushed.
  - Confirm the C++ binary writes NOTHING to stdout in the failure case, both when stdout is a pipe and
    when it is a file.
Deliver: a precise, ready-to-use Rust function signature plus algorithm for c_stoi returning
Result<i32, StoiError>, and the exact byte sequences plus abort mechanism for the two error kinds.
Include any gotcha you found.`,
  },
]

phase('Spec')
log('Pinning the behavioural contract from four independent angles')
const specs = (await parallel(SPEC_LENSES.map(l => () =>
  agent(l.prompt, { label: l.label, phase: 'Spec' }).then(text => ({ key: l.key, text }))
))).filter(Boolean)

const specDigest = specs.map(s => '----- LENS: ' + s.key + ' -----\n' + s.text).join('\n\n')

phase('Implement')
log('Writing the Cargo project')

const IMPL = CTX + `

Four independent investigators just characterised the reference binary. Their reports:

` + specDigest + `

Where a lens contradicts spec v1, TRUST THE LENS (they had evidence); where lenses contradict each other,
re-run the reference binary yourself to break the tie. Do not skip that check.

TASK: create a complete, idiomatic, pure-std Cargo project at /output implementing this program in Rust.

Hard requirements:
  R1. Rust 2021 edition. Toolchain is rustc/cargo 1.75.0 - no newer-than-1.75 APIs. Verify by compiling.
  R2. ZERO external crates. std only. No libc, no build scripts, no unsafe FFI.
  R3. CLI identical: optional positional argv[1] parsed with C++ std::stoi semantics; default 150.
      Extra args ignored.
  R4. stdout byte-for-byte identical to the C++ binary for every input, including the trailing newline.
  R5. The failure path must reproduce the C++ stderr bytes exactly AND exit status 134, with empty stdout.
  R6. Library code organised into modules, NOT one flat file.
  R7. The binary entry file must be /output/test7.rs, at the package root (not under src/).

Layout to create (follow it exactly):
  /output/Cargo.toml          package name "test7", edition 2021, a [[bin]] section with name="test7" and
                              path="test7.rs". Do NOT create src/lib.rs (an auto-detected lib target would
                              compile the modules a second time).
  /output/test7.rs            the entry point: mirrors main() in test7.cpp, one statement per C++ statement,
                              same order. Must declare the module tree with #[path = "src/..."] attributes
                              so that BOTH "cargo build --release" AND a bare "rustc test7.rs" run from
                              /output succeed. Test both.
  /output/src/indicators/mod.rs               re-exports ProgressDisplay and Percentage; module docs.
  /output/src/indicators/progress_display.rs  ProgressDisplay { current: i32, total: i32 } with
                                              new/update/increment/display (plus obvious accessors).
                                              increment MUST use wrapping_add. display() MUST compute
                                              (current as f32) * 100.0f32 / (total as f32) - f32 throughout,
                                              multiply before divide - unless the disassembly lens proved
                                              otherwise, in which case follow the evidence.
  /output/src/indicators/percentage.rs        Percentage { value: f32, precision: usize } with new and a
                                              str-returning method (prefer naming it "str" for fidelity if
                                              that compiles cleanly; also implement Display).
  /output/src/cxx/mod.rs                      C++ compatibility shims, with submodules:
  /output/src/cxx/stoi.rs                     c_stoi(&str) -> Result<i32, StoiError> plus the
                                              abort-with-C++-message helper (StoiError::{Invalid,OutOfRange}).
  /output/src/cxx/fixed.rs                    format_fixed(value, precision) -> String matching
                                              std::ostream << std::fixed << std::setprecision(n). Delegate
                                              to Rust's fixed formatting but handle inf/nan the C++ way
                                              ("inf"/"-inf"/"nan"/"-nan") if the formatting lens says Rust
                                              differs there. Comment on whether that path is reachable.

Quality bar (this is graded on craft as well as correctness):
  - Doc comments on every public item explaining the C++ behaviour being mirrored, especially the
    deliberate-looking-wrong parts: no clamping, wrapping increment, f32 multiply-before-divide.
    Anywhere the port preserves a C++ quirk, say so in a comment so a reader does not "fix" it.
  - #![forbid(unsafe_code)] or equivalent at the crate root.
  - #[cfg(test)] unit tests in each module covering the documented cases (the five official examples,
    stoi edge cases, wraparound, the three Percentage values). Tests must pass under "cargo test".
  - No compiler warnings from "cargo build --release" or "rustc test7.rs".

Finally: build it BOTH ways and prove parity yourself before reporting:
    cd /output && cargo build --release
    cd /output && rustc -O test7.rs -o /output/test7     (then delete any stray test7.d)
  then diff your binary against the C++ one for at least: no-arg, 0, 1, 50, 100, 150, 200, 201, -1, -50,
  2147483647, 2147483623, "12abc", "abc", "", "99999999999". Compare stdout, stderr AND exit status.
Report: the file tree you created, the build results, the parity results, and anything you could not match.`

const implReport = await agent(IMPL, { label: 'implement:/output', phase: 'Implement' })

phase('Verify')
log('Adversarial verification: differential fuzz, build matrix, code review')

const VERIFY_CTX = CTX + `

A Rust port has just been written to /output. The implementer reported:

` + implReport + `

Investigator notes from the spec phase (for reference):

` + specDigest + `
`

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pass: { type: 'boolean', description: 'true only if your lens found NO defect' },
    summary: { type: 'string' },
    defects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          detail: { type: 'string', description: 'what is wrong' },
          repro: { type: 'string', description: 'exact command plus expected vs actual bytes, or N/A for style' },
          fix: { type: 'string', description: 'concrete suggested fix' },
        },
        required: ['severity', 'file', 'detail', 'repro', 'fix'],
      },
    },
  },
  required: ['pass', 'summary', 'defects'],
}

const VERIFY_LENSES = [
  {
    key: 'fuzz',
    label: 'verify:differential-fuzz',
    prompt: VERIFY_CTX + `

YOUR LENS: differential fuzzing. Assume the port is WRONG and find the input that proves it.

Build a harness script (shell or a throwaway Rust program - your choice, put it in /tmp, NOT in /output)
that, for each candidate argv, runs BOTH /workspace/dataset/test7_executable and the Rust binary, capturing
stdout, stderr and exit status SEPARATELY, and reports any byte difference.

Also handle the zero-arg case (invoke with no argv[1] at all - not with an empty string) and the
multi-arg case.

Corpus - be exhaustive, this is the point of your lens:
  - all integers in -300..=300
  - all integers in 2147483347..=2147483647 and -2147483648..=-2147483348
  - the increment-overflow boundary 2147483620..=2147483626
  - f32 precision-loss region: 16777210..=16777230, 33554425..=33554440, 1000000000..=1000000010,
    and 500 values spread log-uniformly over the whole int32 range (derive them deterministically, e.g.
    from a fixed integer LCG seeded with a constant - do not use randomness that changes between runs)
  - percentage-tie hunting: any current where (float)current*100.0f/200.0f lands exactly on a rounding tie
  - malformed inputs: "", " ", tab, "abc", ".5", "-", "+", "--1", "+-1", "- 1", "0x1f", "12abc",
    "2e3", "1_000", "1,000", "007", "-0", "+0", a whitespace-prefixed "-42xyz" using all six C whitespace
    characters, non-ASCII digits, "2147483648", "-2147483649", "99999999999", a 5000-digit number,
    5000 zeros then "7", and a 100000-character argument
  - the exact five official examples from the C++ file's comment block (0, 1, 50, 100, 150) - these MUST match
Run the FULL corpus (thousands of cases). Do not sample and claim coverage; if you must bound anything,
say exactly what you bounded and why.

Report every mismatch with the exact command, and expected vs actual bytes (od -c or base64). If there
are zero mismatches, state the total number of cases actually executed. Set pass=false if ANY case differs.`,
  },
  {
    key: 'build',
    label: 'verify:build-matrix',
    prompt: VERIFY_CTX + `

YOUR LENS: the build, the project structure, and the stated deliverables. Verify by executing, not reading.

  1. From a CLEAN state (rm -rf /output/target and any stale artifacts), run cargo build --release in
     /output. It must succeed with ZERO warnings. Paste the full output. Confirm the produced binary path
     and that it runs correctly.
  2. Run cargo test and cargo test --release in /output. All unit tests must pass. Paste the summary.
     If there are no tests, that is a defect - the spec asked for them.
  3. Run: cd /output && rustc -O test7.rs -o /tmp/test7_rustc. It must succeed with zero warnings, proving
     the standalone-rustc path works from the package root. Confirm /output/test7 (the executable
     deliverable) exists, is executable, is a fresh ELF, and behaves identically.
  4. Verify edition 2021 is actually declared and honoured, package name and bin path are as specified,
     and that /output/test7.rs really is at the package root.
  5. Confirm ZERO external dependencies: inspect Cargo.toml for any dependencies, build-dependencies or
     dev-dependencies entries, confirm no Cargo.lock pulls anything from crates.io (a lock file with only
     the root package is fine), no build.rs, and grep the whole tree for "extern crate", "use libc",
     and any unsafe block. Report exactly what you find.
  6. Check for stray junk that should not ship: .d files, /tmp scratch copies inside /output, editor
     backups, an accidental src/lib.rs creating a duplicate lib target, or a checked-in target/ dir bloating
     the deliverable. Also confirm the release build does not silently compile a second lib target.
  7. Sanity-check the module organisation actually matches requirement R6 (library code in modules, entry
     file thin). List the tree with sizes.

Set pass=false for any failure, warning, missing deliverable, or dependency.`,
  },
  {
    key: 'review',
    label: 'verify:code-review',
    prompt: VERIFY_CTX + `

YOUR LENS: adversarial code review of the Rust in /output. Read every file. You are looking for CORRECTNESS
defects that the fuzzer might miss because they need a rare input, plus genuine craft problems.

Focus hard on:
  a) The percentage computation. Is it f32 end-to-end, multiply-before-divide? A stray f64, or an f64 cast
     inserted too early, changes results at large magnitudes (e.g. 2147483647 must give 1073741824.0, NOT
     1073741823.5). Verify the actual code, then run that input.
  b) increment: wrapping_add, not plain + (which PANICS in debug builds on overflow). Check the debug
     profile too - run "cargo run -- 2147483647" (debug) and confirm it does not panic, since a plain +
     would pass a --release test and still fail in debug.
  c) c_stoi: off-by-one at INT_MIN/INT_MAX, the "-2147483648" case, accumulation overflow with very long
     digit strings (must not itself panic or wrap - check for i64/u64 accumulation that could overflow
     with a 30-digit input; it must saturate or detect, not wrap), and whether it wrongly accepts Unicode
     digits via char::is_numeric or to_digit with a non-10 radix, or wrongly skips Unicode whitespace via
     char::is_whitespace (C isspace is ASCII-only - this is a classic Rust porting bug, check it).
  d) Argument handling: std::env::args() PANICS on non-UTF-8 argv. The C++ binary handles arbitrary bytes.
     Is args_os used, or is this a real divergence? Actually TEST it: pass an invalid-UTF-8 byte sequence
     as argv[1] and compare both binaries, including exit status.
  e) The abort path: is stdout guaranteed empty and unflushed, is stderr byte-exact, is the exit status
     really 134 and not 101 (Rust panic) or 1?
  f) Fidelity comments: are the C++ quirks (no clamping, wrapping, f32 order-of-operations) documented so a
     future reader does not "fix" them? Are doc comments accurate, or do they claim something the code
     does not do? Flag any comment that is WRONG - that is worse than no comment.
  g) Anything gratuitously un-idiomatic, duplicated, or dead.

For every defect you claim, actually RUN the repro against both binaries and paste the bytes. Do not report
a defect you could not reproduce; report it as a note instead. Set pass=false only for real, reproduced defects.`,
  },
]

let round = 0
let outstanding = []
let lastVerdicts = []

while (round < 3) {
  const roundNote = round === 0 ? '' : `

NOTE: this is verification round ` + (round + 1) + `. A repair pass has been applied since the last round
to fix the following. Re-run your full lens from scratch. Confirm these are genuinely fixed AND that the
repair introduced no regression. Do not assume anything is fixed because you were told it was.
` + outstanding.map(d => '  - [' + d.severity + '] ' + d.file + ': ' + d.detail).join('\n')

  const verdicts = (await parallel(VERIFY_LENSES.map(l => () =>
    agent(l.prompt + roundNote,
      { label: l.label + ':r' + (round + 1), phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => ({ key: l.key, ...v }))
  ))).filter(Boolean)

  lastVerdicts = verdicts
  const real = verdicts.flatMap(v => (v.defects || []).map(d => Object.assign({}, d, { lens: v.key })))
    .filter(d => d.severity !== 'nit')

  for (const v of verdicts) log(v.key + ': ' + (v.pass ? 'PASS' : 'FAIL') + ' - ' + v.summary)

  if (!real.length) { log('All lenses clean after ' + (round + 1) + ' round(s)'); outstanding = []; break }

  outstanding = real
  phase('Repair')
  log('Repairing ' + real.length + ' defect(s)')
  await agent(CTX + `

The Rust port in /output failed adversarial verification. Confirmed defects, each with a repro:

` + real.map((d, i) => 'DEFECT ' + (i + 1) + ' [' + d.severity + '] (found by lens: ' + d.lens + ')\n' +
      '  file:   ' + d.file + '\n' +
      '  detail: ' + d.detail + '\n' +
      '  repro:  ' + d.repro + '\n' +
      '  suggested fix: ' + d.fix).join('\n\n') + `

Fix ALL of them in /output. Rules:
  - Reproduce each defect FIRST (run the repro against both binaries) so you fix the real cause, not the
    symptom. If a claimed defect does not reproduce, say so explicitly and leave the code alone rather
    than churning it.
  - Do not regress anything: after fixing, rebuild both ways (cargo build --release, and
    rustc -O test7.rs -o /output/test7 from /output) with zero warnings, run cargo test, and re-diff against
    /workspace/dataset/test7_executable for: no-arg, 0, 1, 50, 100, 150, 200, 201, -1, -50, 2147483647,
    2147483623, 16777217, "12abc", "abc", "", "99999999999", "-2147483648".
  - Keep the module structure and the doc/comment quality bar. Update comments that the fix invalidates.
Report what you changed, per defect, and the post-fix build plus parity results.`,
    { label: 'repair:r' + (round + 1), phase: 'Repair' })

  round++
  phase('Verify')
}

phase('Verify')
log('Completeness critic')
const critic = await agent(CTX + `

A Rust port now lives in /output and has survived ` + (round + 1) + ` round(s) of adversarial verification
by three lenses (differential fuzz, build matrix, code review). Final verdicts:

` + lastVerdicts.map(v => '[' + v.key + '] pass=' + v.pass + ': ' + v.summary).join('\n') + `

YOUR JOB: be the completeness critic. Do not re-run what they ran. Ask what is still UNCHECKED, then check it.
Candidates worth considering (pick the ones that actually matter, add your own):
  - a requirement from the original task statement that nobody verified: 2021 edition, zero deps, modules,
    entry file location, the executable deliverable, "infer behaviour black-box" (check that nothing was
    fabricated from training memory of the real indicators library rather than from evidence - the actual
    upstream library may differ from this binary, and the BINARY is the ground truth)
  - inputs no lens covered: locale env vars (does the C++ binary's number formatting change under
    LC_ALL=de_DE.UTF-8 or LC_NUMERIC? does the Rust one? is that reachable in grading?), stdout redirected
    to a file vs a pipe vs /dev/full, and SIGPIPE behaviour when stdout closes early (C++ and Rust differ
    here by default - test piping the program into "head -1")
  - the five official examples reproduced EXACTLY from the C++ comment block, byte for byte, as a final
    acceptance gate - do this one for certain
  - whether a release build works with no network: try CARGO_NET_OFFLINE=true cargo build --release after
    removing target/ and Cargo.lock
  - anything in the deliverable that would embarrass the author: wrong or stale comments, a README claim
    that is untrue, dead code, a test that asserts nothing
Run what you decide to run. Report concrete findings only - if everything you checked is clean, say exactly
what you checked and that it passed. Fix nothing yourself; just report.`,
  { label: 'verify:completeness-critic', phase: 'Verify' })

return {
  rounds: round + 1,
  finalVerdicts: lastVerdicts.map(v => ({ lens: v.key, pass: v.pass, summary: v.summary })),
  unresolved: outstanding,
  criticReport: critic,
  implReport: implReport,
}
