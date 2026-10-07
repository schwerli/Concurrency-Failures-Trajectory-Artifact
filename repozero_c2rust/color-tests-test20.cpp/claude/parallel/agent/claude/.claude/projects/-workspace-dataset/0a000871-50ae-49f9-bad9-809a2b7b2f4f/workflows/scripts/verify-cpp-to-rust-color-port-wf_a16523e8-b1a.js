export const meta = {
  name: 'verify-cpp-to-rust-color-port',
  description: 'Adversarially verify the Rust port of test20.cpp is byte-identical to the C++ binary',
  phases: [
    { title: 'Fuzz' },
    { title: 'Audit' },
    { title: 'Verify' },
    { title: 'Critic' },
  ],
}

const CTX = `
# Context

A C++ program has been ported to Rust. Your job is to find ANY input for which the
Rust port's output differs from the C++ binary's, byte-for-byte.

- C++ reference binary: /workspace/dataset/test20_executable
- C++ source of the *entry* file only: /workspace/dataset/test20.cpp  (the library header
  color.hpp is NOT available - behaviour was reverse-engineered from the binary)
- Rust port source: /output/  (test20.rs at root, modules under /output/src/color/)
- Rust binary: /output/test20   (rebuild with:
      rustc -O --edition 2021 --out-dir /tmp/rb /output/test20.rs && cp /tmp/rb/test20 /output/test20 )
- A differential fuzz harness exists: perl /workspace/difftest.pl <mode> <rounds> <seed>
  modes: uniform extreme mixed tiny huge negative special ties hue strings all
  It prints "fails=0" when every round matched. It compares BOTH stdout and stderr.

# Program shape

The program pushes 5 hard-coded RGB colours, then reads extra colours from argv in
groups of 3 (loop: for i=1; i+2<argc; i+=3, using std::stof on each arg). For every
colour it prints one line:

  Color <i>: r g b  hslH hslS hslL  hsvH hsvS hsvV  cmykC cmykM cmykY cmykK
             yuvY yuvU yuvV  bright(x1.2) dark(x0.8) saturated(x1.5) gray inverted
             [distance-to-colour-0, last line only]

every field followed by one space, formatted like std::cout's default (%g, 6
significant digits). Whitespace-split field indices: 0="Color", 1="<i>:", 2-4 rgb,
5-7 hsl, 8-10 hsv, 11-14 cmyk, 15-17 yuv, 18-20 bright, 21-23 dark, 24-26 saturated,
27-29 gray, 30-32 inverted, 33 distance.

# Rules

- NEVER edit anything under /output. Report only. Do not rebuild unless you need to.
- You may run either binary with any arguments as often as you like.
- A finding is only real if you can show an exact argv where the two binaries' stdout
  or stderr bytes differ. Verify with a real command before reporting it.
- Note: arguments are passed as strings and parsed with std::stof, so you can express
  exact float values (e.g. 0x1.fffffep-1) and weird spellings.
`

const FINDINGS = {
  type: 'object',
  properties: {
    clean: { type: 'boolean', description: 'true if no real mismatch was found' },
    commands_run: { type: 'integer', description: 'roughly how many probe invocations you made' },
    notes: { type: 'string', description: 'what you covered, max 100 words' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          repro: { type: 'string', description: 'exact shell command line that shows the difference' },
          cpp_output: { type: 'string' },
          rust_output: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['area', 'repro', 'cpp_output', 'rust_output', 'explanation'],
      },
    },
  },
  required: ['clean', 'findings', 'notes', 'commands_run'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true only if you personally reproduced a byte difference' },
    repro: { type: 'string' },
    cpp_output: { type: 'string' },
    rust_output: { type: 'string' },
    diagnosis: { type: 'string', description: 'root cause and the minimal fix, if real' },
  },
  required: ['real', 'diagnosis'],
}

// ---------------------------------------------------------------- Phase: Fuzz
const FUZZ = [
  { k: 'uniform',  n: 4000, seed: 11, extra: 'Plain in-gamut colours. This is the case a grader will actually use, so make it exhaustive.' },
  { k: 'mixed',    n: 3000, seed: 22, extra: 'Mixed in/out of gamut.' },
  { k: 'ties',     n: 3000, seed: 33, extra: 'Equal channels: max==min, two-way ties, greys. Also hand-probe every permutation of {0,0.5,1} and of {0.25,0.25,0.75}.' },
  { k: 'hue',      n: 3000, seed: 44, extra: 'Hue sector boundaries. The saturated triple runs rgb->HSL->rgb and is catastrophically cancellation-sensitive near hue 0/120/240/360. Hand-craft colours whose hue lands exactly on and 1 ulp either side of those boundaries.' },
  { k: 'tiny',     n: 3000, seed: 55, extra: 'Very small magnitudes incl. values near FLT_MIN and subnormals.' },
  { k: 'huge',     n: 3000, seed: 66, extra: 'Very large magnitudes incl. near FLT_MAX and overflow to inf inside the conversions.' },
  { k: 'negative', n: 3000, seed: 77, extra: 'Negative channels (the conversions do not clamp their inputs).' },
  { k: 'special',  n: 3000, seed: 88, extra: 'inf/-inf/nan/-nan/0/-0 in every channel position and combination. Signed zero and NaN SIGN are both printed, so check "-0" vs "0" and "-nan" vs "nan" carefully in every one of the 32 fields.' },
  { k: 'strings',  n: 3000, seed: 99, extra: 'Odd textual spellings accepted by strtof: hex floats, INF/INFINITY/NAN/nan(payload), leading whitespace, trailing garbage, huge digit strings, and inputs that make std::stof throw (compare stderr AND exit status).' },
  { k: 'extreme',  n: 3000, seed: 111, extra: 'Round numbers and powers of two.' },
]

const fuzzResults = await parallel(FUZZ.map((f) => () =>
  agent(`${CTX}

# Your assignment: fuzz mode "${f.k}"

1. Run: perl /workspace/difftest.pl ${f.k} ${f.n} ${f.seed}
   Then run it again with at least three more distinct seeds of your own choosing.
2. ${f.extra}
3. Beyond the harness, hand-craft at least 12 of your own targeted argv probes in this
   area, running both binaries and diffing their exact bytes (use cmp or od -c when a
   difference might be whitespace). Think about what the harness's value distribution
   would MISS, and probe exactly that.

Report every real byte-level difference you can reproduce.`,
    { label: `fuzz:${f.k}`, phase: 'Fuzz', schema: FINDINGS })
))

log(`fuzz phase done: ${fuzzResults.filter(Boolean).length}/${FUZZ.length} agents reported`)

// --------------------------------------------------------------- Phase: Audit
const AUDITS = [
  {
    k: 'formatting',
    prompt: `Audit /output/src/color/ostream.rs, which reimplements std::cout's default
float formatting (printf %g with precision 6, on the float promoted to double).

Hunt for inputs where it diverges from the C++ stream. Because rgb.r/g/b are printed
verbatim, you can drive ANY exact float straight through argv (hex float literals give
you exact bit control, e.g. 0x1.fffffep-1).

Specifically attack:
- the style-e / style-f switch at exponent < -4 and >= 6 (e.g. 0.0001 vs 0.00009999999,
  999999.5, 1000000, 9.999999e5, 9.9999995e5)
- half-way rounding of the 6th significant digit in BOTH styles - does Rust's
  {:.5e}/{:.N} round the same way glibc does? Find values whose exact binary expansion
  sits exactly on a decimal tie.
- trailing-zero stripping ("1e+06" vs "1.00000e+06", "0.5" vs "0.500000", integers)
- exponent formatting: two-digit minimum, sign always present, three digits when needed
  (can the exponent of a float reach |e| >= 100? e.g. 1e-38, 1e+38, subnormals)
- signed zero, inf, -inf, nan, -nan
- the smallest and largest finite floats, and every subnormal boundary you can reach.`,
  },
  {
    k: 'stof',
    prompt: `Audit /output/src/color/parse.rs, which reimplements std::stof (i.e. glibc
strtof + libstdc++'s wrapper that throws std::invalid_argument when nothing converted
and std::out_of_range when errno==ERANGE).

Compare against the C++ binary, checking stdout, stderr AND exit status (echo $? after
running each directly, not through a pipe).

Specifically attack:
- what counts as "no conversion": "", " ", "+", "-", ".", "e5", "x", "0x", "0xg", "+.e1",
  "-", ".e", "infi", "na", "nanx"
- ERANGE boundaries: exactly FLT_MIN (1.17549435e-38) vs one ulp below; the largest
  subnormal; FLT_MAX (3.40282347e+38) vs just above; "1e-45"; "0e-99999"; "0.0e999999";
  a value that rounds UP to FLT_MAX vs one that rounds to inf; underflow that rounds
  back up to FLT_MIN.
- hex floats: "0x1p0", "0x.8p1", "0x1.8p+1", "0X1P-1", "0x0p999999", "0x1p-149",
  "0x1p-150", "0x1p128", long hex mantissas needing correct round-to-nearest-even,
  "0x1.000001p0", hex with no exponent, hex with 'p' but no digits after it.
- inf/nan spellings and case, "nan(...)" with and without a closing paren, "-nan".
- very long digit strings, leading zeros, "0000000000.5", 400-digit mantissas that must
  round half-to-even.
- whitespace forms: tab/newline/vertical-tab/formfeed/CR before the number.
- when std::stof throws, does the C++ print any stdout at all? Does the Rust match its
  stderr text and its exit status/signal exactly?`,
  },
  {
    k: 'semantics',
    prompt: `Read /output/src/color/converter.rs and /output/test20.rs, and audit them
against the C++ binary's observable behaviour. Treat every line as a hypothesis about
unavailable C++ source, and try to falsify each one with a crafted colour.

Pay particular attention to:
- the max/min three-way folds and their NaN/ties behaviour, and which branch of the
  hue-sector chain wins when two channels are equal to the max
- the s==0 / max==min / max==0 / k==1 degenerate branches
- whether hsv's hue uses the same double-rounded /6*360 path as hsl's
- adjustSaturation: clamping of s, the l<0.5 branch of q, p=2l-q, and hue2rgb's
  three comparison boundaries (1/6, 1/2, 2/3) - probe colours that land exactly ON each
  boundary and 1 ulp either side
- adjustBrightness clamp order, invert (unclamped), grayscale, colorDistance
- the argv loop bounds (i+2<argc) with 0,1,2,3,4,5,6,7 extra arguments
- the "last colour only" distance rule, and colours.size()>1
- 0 extra args, and a very large number of colours (does "Color 10:" etc. still line up)`,
  },
  {
    k: 'structure',
    prompt: `Audit the DELIVERABLE requirements, not the numerics. Requirements were:

1. Pure Rust, edition 2021, compiles with rustc or as a Cargo project.
2. Same CLI arguments as the C++ binary, parsed via std::env::args().
3. Byte-identical output.
4. ZERO external dependencies - only std. No crates.io.
5. A complete Cargo project in /output, library code organised into modules, and the
   entry test file test20.rs in the package root /output.
6. Compiles and produces an executable.

Check all of it concretely:
- Read /output/Cargo.toml. Confirm edition 2021, no [dependencies], and that both the
  lib and the bin targets are declared correctly.
- Confirm 'cargo build --release --offline' succeeds from /output and check for warnings.
  Report the exact path of the produced binary and confirm it behaves the same as
  /output/test20 on a sample input.
- Confirm 'rustc -O --edition 2021 test20.rs' also succeeds standalone from /output.
- grep the whole tree for any 'extern crate', any 'use' of a non-std crate, and any
  unsafe blocks. Report what you find.
- Run 'cargo test --offline' if any tests exist and report failures.
- List every file in /output with sizes, and flag anything that should not ship
  (stray build dirs, temp files, binaries left in odd places).
- Report warnings from both build paths verbatim - unused imports, dead code, etc.

Report findings as items in the findings array even though they are not byte-diffs; use
'repro' for the command you ran and cpp_output/rust_output for expected vs actual.`,
  },
]

const auditResults = await pipeline(
  AUDITS,
  (a) => agent(`${CTX}\n\n# Your assignment: audit "${a.k}"\n\n${a.prompt}`,
               { label: `audit:${a.k}`, phase: 'Audit', schema: FINDINGS }),
  (res, a) => {
    const items = (res && res.findings) || []
    if (!items.length) return []
    return parallel(items.slice(0, 8).map((f, i) => () =>
      agent(`${CTX}

# Your assignment: adversarially verify a reported finding

Another agent claims the Rust port diverges from the C++ binary. Default to REFUTING it:
most such claims are mistakes (a mis-copied field index, a shell-quoting artifact, a
stale Rust binary, or comparing the wrong column).

Claimed area: ${f.area}
Claimed repro: ${f.repro}
Claimed C++ output: ${f.cpp_output}
Claimed Rust output: ${f.rust_output}
Claimed explanation: ${f.explanation}

Run the repro yourself against BOTH binaries. Compare the raw bytes. Only set real=true
if you personally observe a difference in stdout, stderr or exit status. If it is real,
reduce it to the smallest possible argv and diagnose the root cause precisely enough to
fix (which expression, which rounding, which branch).`,
        { label: `verify:${a.k}#${i}`, phase: 'Verify', schema: VERDICT })
    ))
  }
)

const confirmed = auditResults.flat().filter(Boolean).filter((v) => v.real)
const fuzzFindings = fuzzResults.filter(Boolean).flatMap((r) => r.findings || [])

log(`audit findings confirmed: ${confirmed.length}; raw fuzz findings: ${fuzzFindings.length}`)

// -------------------------------------------------------------- Phase: Critic
const critic = await agent(`${CTX}

# Your assignment: completeness critic

Ten fuzz agents and four audit agents have just finished. Summary of what came back:

Fuzz agents reported: ${JSON.stringify(fuzzResults.filter(Boolean).map((r) => ({ clean: r.clean, n: r.commands_run, notes: r.notes, findings: (r.findings || []).length })))}

Confirmed audit findings: ${JSON.stringify(confirmed)}

Your job is NOT to re-run what they did. It is to ask: what did this whole effort still
MISS? Think about untested surfaces of the program, not more of the same values.

Consider at least: argument-count edge cases; the interaction between a throwing
std::stof and already-buffered stdout; locale; extremely many colours; arguments that
are not valid UTF-8 (Rust's std::env::args() panics on those - does the C++ care?);
empty-string arguments; arguments containing NUL or newlines; stdout being a pipe that
is closed early (SIGPIPE); output when stdout is a file vs a tty; and whether the Rust
binary's exit status matches on every path.

Then actually TEST the gaps you identify - especially the non-UTF-8 argv case, which you
should construct with printf inside bash, e.g.
   /workspace/dataset/test20_executable $'\\xff\\xfe' 0.5 0.5
and compare to the Rust binary. Report anything that really differs.`,
  { label: 'critic', phase: 'Critic', schema: FINDINGS })

return {
  fuzz_clean: fuzzResults.filter(Boolean).every((r) => r.clean),
  fuzz_findings: fuzzFindings,
  fuzz_notes: fuzzResults.filter(Boolean).map((r) => ({ n: r.commands_run, notes: r.notes })),
  confirmed_audit_findings: confirmed,
  critic: critic,
}
