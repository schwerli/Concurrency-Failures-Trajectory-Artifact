export const meta = {
  name: 'verify-cpp-to-rust-port',
  description: 'Adversarially audit the /output Rust port of Clipper test1.cpp for compliance, byte-exact behavior, portability, and library correctness',
  phases: [
    { title: 'Audit', detail: 'four independent auditors: requirements, differential behavior, build/portability, library correctness' },
    { title: 'Verify', detail: 'perspective-diverse refuters per finding' },
    { title: 'Critique', detail: 'completeness critic looks for unexamined surface' },
  ],
}

const CONTEXT = `
# Task under audit

A C++ test file was migrated to pure Rust. You are auditing the RESULT, not writing it.

## Original C++ (/workspace/dataset/test1.cpp)
\`\`\`cpp
#include "clipper2/clipper.h"
#include <iostream>
#include <vector>
using namespace Clipper2Lib;
int main(int argc, char* argv[]) {
    // 最简单的测试：创建一个点并输出
    Path64 path = {Point64(0,0), Point64(100,0), Point64(100,100), Point64(0,100)};
    // 调用1个API：创建多边形
    std::cout << path.size() << std::endl;
    return 0;
}
\`\`\`
Reference C++ binary: /workspace/dataset/test1_executable (always prints "4\\n", exit 0, for every argument set).

## Rust port location
/output — a Cargo project. Files: Cargo.toml, test1.rs (entry, package root), src/lib.rs, src/point.rs, src/path.rs, src/rect.rs.
Toolchain available: rustc/cargo 1.75.0 ONLY. No network access (use --offline).

## The stated requirements (verbatim from the user)
1. Environment: pure Rust, 2021 edition. Must compile with \`rustc\` or as a Cargo project.
2. CLI arguments: the Rust binary must accept exactly the same command-line arguments as the C++ binary (same names, defaults, required fields). Parse args via std::env::args().
3. Logic and output: algorithm logic, numeric precision, and string formatting must exactly match the C++ source. println! output must be byte-for-byte identical to std::cout output.
4. Zero external dependencies: no crates.io crates, std only. Implement everything from scratch.
5. Project structure: complete Cargo project in /output. Organize library code into modules. Place the entry test file test1.rs in the package root /output.
6. Black-box implementation: do not read the C++ library source; infer behavior from the interface and re-implement with std.
7. Output: library files inside /output; entry file at /output/test1.rs; compile and produce an executable (via \`rustc test1.rs\` or \`cargo build --release\`).

## Rules for you
- READ ONLY on /output source files: do NOT edit, create, or delete any file under /output. Report problems instead.
- You MAY run commands, and you MAY create scratch files under /tmp.
- Report ONLY defects you actually verified by reading the file or running a command. Include the exact command and its output in the evidence field.
- Do not report style opinions as defects. A defect is: a requirement not met, a behavioral difference vs the C++ binary, a build failure, a latent logic bug, or a factually wrong claim in a comment/doc.
`

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'severity', 'requirement', 'detail', 'evidence', 'suggested_fix'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string', description: 'path, with :line if known' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          requirement: { type: 'string', description: 'which of requirements 1-7, or "logic-bug" / "doc-accuracy"' },
          detail: { type: 'string' },
          evidence: { type: 'string', description: 'exact command run + verbatim output, or exact quoted source lines' },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning', 'evidence'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is NOT a real defect' },
    reasoning: { type: 'string' },
    evidence: { type: 'string', description: 'command + output you ran to check' },
  },
}

const AUDITORS = [
  {
    key: 'requirements',
    prompt: `${CONTEXT}

You are the REQUIREMENTS-COMPLIANCE auditor. Go through requirements 1-7 one at a time and check each against what is actually on disk. Read every file in /output (Cargo.toml, test1.rs, src/*.rs).

Check especially:
- Is the edition really 2021, and does it build with plain \`rustc\` AND with cargo? Verify by running both (build a copy in /tmp so you never write into /output: \`cp -r /output /tmp/req && cd /tmp/req\`).
- Are there truly zero external dependencies? Check Cargo.toml, check for any \`extern crate\`, any \`use\` of a non-std path, and confirm no Cargo.lock pulls anything in. Confirm the build works with --offline.
- Is test1.rs really in the package root, and is library code really organized into modules (not all in one file)?
- Is there an executable produced, and where?
- Does anything in the project read the C++ library source (requirement 6)? Note: no Clipper2 C++ library source is even present on this machine — verify that claim yourself (\`find / -name 'clipper*' -not -path '*/proc/*' 2>/dev/null\`) and report if the port appears to depend on something it should not.
Report each unmet requirement as a finding.`,
  },
  {
    key: 'differential',
    prompt: `${CONTEXT}

You are the DIFFERENTIAL-BEHAVIOR auditor. Your job: find ANY observable difference between /workspace/dataset/test1_executable and the Rust binary.

Build the Rust binary into /tmp first, e.g.:
  cp -r /output /tmp/diff && cd /tmp/diff && rustc -O --edition 2021 test1.rs -o /tmp/rust_test1
(also test the cargo --release binary separately: \`cargo build --release --offline\` then target/release/test1)

Then compare exhaustively. Vary:
- no args; one arg; many args; empty-string args; args with spaces, quotes, newlines, unicode, NUL-adjacent bytes; very long args (e.g. 100k chars); 1000+ args; args that look like flags (-h, --help, --version, -1, 0, 100, test).
- exit codes for every case.
- stdout bytes compared with \`cmp\` / \`xxd\`, not by eyeballing.
- stderr content (should both be empty).
- behavior when stdin is closed, when stdin has data, when stdout is a pipe vs a file vs /dev/full, when the locale differs (LC_ALL=C vs LC_ALL=tr_TR.UTF-8 vs LANG=de_DE.UTF-8), when argv[0] differs (run via a symlink/renamed copy), when run with no args at all via \`exec -a\`.
- stdout closed early (\`./bin | head -c 0\`, and \`./bin >&-\`) — compare exit codes; a Rust panic here where C++ exits 0 IS a finding.
Write a loop script in /tmp that runs both binaries over the whole matrix and diffs stdout+stderr+exit code, and report only differences you actually observed, with the reproducing command.`,
  },
  {
    key: 'portability',
    prompt: `${CONTEXT}

You are the BUILD & PORTABILITY auditor. Verify the project builds cleanly from a pristine copy, in every documented way, with no warnings and no network.

Do all of this in /tmp copies (never write into /output):
- \`cp -r /output /tmp/pb1\`, remove any pre-built artifacts (target/, the test1 executable, Cargo.lock), then: \`rustc test1.rs\` (no flags — exactly as requirement 7 words it), \`rustc -O --edition 2021 test1.rs -o test1\`, \`cargo build --release --offline\`, \`cargo build --offline\` (debug), \`cargo test --offline\`.
- Confirm the edition default question: does \`rustc test1.rs\` with NO --edition flag succeed? rustc 1.75 defaults to edition 2015. If the code needs 2021 (e.g. array IntoIterator, FromIterator in prelude, bare trait objects, closure capture) then plain \`rustc test1.rs\` could fail or behave differently. TEST IT and report the actual result. This matters because requirement 7 literally suggests running \`rustc test1.rs\`.
- Check for any warnings from any of those builds. Report warnings as minor findings (with the exact warning text).
- Check whether \`#![allow(dead_code, unused_imports)]\` in src/lib.rs is masking a genuine problem, and whether the crate-root inner attribute is placed legally.
- Try \`cargo build --locked --offline\` and note whether a missing Cargo.lock breaks it.
- Verify the produced executable actually runs and is a real ELF binary (\`file\`).
- Check for anything environment-specific: absolute paths baked into source, reliance on a specific CWD, reliance on \`/output\` existing at a fixed path.`,
  },
  {
    key: 'logic',
    prompt: `${CONTEXT}

You are the LIBRARY-CORRECTNESS auditor. Read /output/src/point.rs, /output/src/path.rs, /output/src/rect.rs and /output/test1.rs closely and hunt for latent logic bugs and factually wrong documentation. The library is small; be thorough and specific.

Verify by reasoning AND by writing throwaway test programs in /tmp (copy the src/ tree there and add your own #[test]s or a main that asserts).

Focus on:
- \`Path64::signed_area2\`: is the shoelace sum correct? Does it close the ring exactly once (no double-counted or missing edge)? Is \`prev\` advanced correctly? Does the documented sign convention ("positive when the ring winds clockwise on screen, y growing downward") actually match what the code computes for a known input? Compute by hand for the test1 square and for a triangle, and check. Can it overflow i128 with i64::MAX coordinates? Verify with an actual test using extreme coordinates.
- \`Point64::from_rounded\`: the doc claims std::llround rounds half away from zero and that f64::round matches. Is that true, including negative halves and values beyond i64 range (what does \`as i64\` do on overflow/NaN in Rust vs C++ llround — Rust saturates, C++ is UB/implementation-defined)? Report the doc claim if it is overstated.
- \`Rect64\`: is \`is_empty\` consistent with \`from_points\` for a single point? Is the top/bottom (y-down) convention applied consistently between \`from_points\`, \`height\`, \`corners\`, and their docs? Does \`mid_point\` overflow for large coordinates (\`left + right\`)? Verify with a test.
- \`Path64\` container semantics vs \`std::vector<Point64>\`: does \`size\`/\`empty\`/\`push_back\` match? Does Deref/DerefMut to Vec expose anything that would break the C++ analogy? Is \`Hash\`+\`Eq\` derivation sound given PointD is f64 (check PathD/PointD do NOT derive Eq/Hash — if they do, that is a bug)?
- The \`path64!\` macro: do all three match arms work? Is the third arm (\`$($p:expr),+\`) reachable at all, or does the second arm shadow it? Does \`path64![(0,0)]\` with a single tuple hit the intended arm? Test each arm from BOTH the lib target and a bin that includes lib.rs via #[path], since the macro uses \`$crate::\`.
- Any comment or doc-comment that states something false about the code or about C++ behavior.`,
  },
]

phase('Audit')
log('Auditing the /output port: requirements, differential behavior, portability, library correctness')

const audited = await pipeline(
  AUDITORS,
  a => agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: FINDINGS }),
  (res, a) => {
    const found = (res && res.findings) || []
    if (!found.length) return []
    // Each finding gets three refuters with distinct lenses, concurrently.
    const lenses = [
      'Re-run the reporter\'s own evidence command verbatim. If it does not reproduce, the finding is refuted. Quote what you actually got.',
      'Assume the finding is wrong. Argue the strongest case that the current code is correct as written, or that the "difference" is outside what the C++ program itself guarantees. Check whether the C++ reference binary behaves the same way as the Rust one in this scenario — if BOTH behave identically, the finding is refuted.',
      'Assume the finding is real but check whether it MATTERS for the stated requirements: does it change the bytes printed, the exit code, the ability to build, or the truth of a documented claim? A defect that cannot change any observable or any documented claim is refuted as non-actionable.',
    ]
    return parallel(lenses.map((lens, i) => () =>
      agent(`${CONTEXT}

A ${a.key} auditor reported this finding. Adversarially check it.

TITLE: ${found.map(f => '').length ? '' : ''}${''}
${JSON.stringify(found, null, 2)}

There may be several findings above. Evaluate ONLY finding index ${'{{i}}'} is NOT how this works — instead: evaluate ALL of them together is also wrong. Do this: pick the SINGLE finding at index 0 if there is one finding; otherwise evaluate every finding and set refuted=true ONLY if EVERY finding is refuted, and explain per-finding in reasoning.

Your lens: ${lens}

Default to refuted=true when you are uncertain — a finding must earn its place. Run commands to check; put them in evidence.`,
        { label: `verify:${a.key}:${i}`, phase: 'Verify', schema: VERDICT })
    )).then(votes => ({ auditor: a.key, findings: found, votes: votes.filter(Boolean) }))
  }
)

const reviewed = audited.flat().filter(Boolean).filter(r => r && r.findings)

phase('Critique')
const critic = await agent(`${CONTEXT}

You are the COMPLETENESS CRITIC. Four auditors just examined the port. Here is everything they reported (findings plus adversarial verdicts):

${JSON.stringify(reviewed, null, 2)}

Your job is to find what they MISSED. Ask: which requirement was never actually tested end to end? Which file was never read? Which behavior was asserted but never executed? Which claim in the code's own comments was never checked against reality?

Then actually go check those gaps yourself (read files under /output, run commands, write scratch tests in /tmp — but never modify /output). Report only gaps where you found a real problem, with evidence.`,
  { phase: 'Critique', schema: FINDINGS })

const surviving = []
for (const r of reviewed) {
  const refuters = r.votes.filter(v => v.refuted).length
  const survives = r.votes.length ? refuters < 2 : true
  if (survives) surviving.push({ auditor: r.auditor, findings: r.findings, votes: r.votes })
}

log(`Auditors reported ${reviewed.reduce((n, r) => n + r.findings.length, 0)} finding-groups; ${surviving.length} survived adversarial verification`)

return {
  surviving_findings: surviving,
  all_reported: reviewed,
  critic_gaps: (critic && critic.findings) || [],
}
