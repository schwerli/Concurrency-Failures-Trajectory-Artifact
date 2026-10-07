export const meta = {
  name: 'hopscotch-port-design',
  description: 'Recon C++ semantics and design a from-scratch Rust hopscotch_map port for test14',
  phases: [
    { title: 'Recon', detail: 'probe reference binary, pin down std::stoi / std::hash / tsl API semantics' },
    { title: 'Design', detail: '3 independent module-layout designs' },
    { title: 'Judge', detail: 'score designs on fidelity, testability, idiomatic Rust' },
    { title: 'Spec', detail: 'synthesize the winning spec' },
  ],
}

const RECON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'findings', 'gotchas'],
  properties: {
    topic: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    gotchas: { type: 'array', items: { type: 'string' } },
  },
}

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['angle', 'files', 'key_decisions', 'risks'],
  properties: {
    angle: { type: 'string' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'purpose', 'public_items'],
        properties: {
          path: { type: 'string' },
          purpose: { type: 'string' },
          public_items: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    key_decisions: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'winner_index', 'graft_ideas', 'rationale'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'fidelity', 'algorithmic_authenticity', 'idiomatic_rust', 'testability', 'total'],
        properties: {
          index: { type: 'integer' },
          fidelity: { type: 'integer' },
          algorithmic_authenticity: { type: 'integer' },
          idiomatic_rust: { type: 'integer' },
          testability: { type: 'integer' },
          total: { type: 'integer' },
        },
      },
    },
    winner_index: { type: 'integer' },
    graft_ideas: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
}

const CONTEXT = `
TASK CONTEXT (shared):
We are porting this C++ program to pure Rust (2021 edition, std only, ZERO external crates):

    #include <iostream>
    #include <string>
    #include "../include/tsl/hopscotch_map.h"
    int main(int argc, char* argv[]) {
        int count = 14;
        if (argc > 1 && std::string(argv[1]) == "--a") { count = std::stoi(argv[2]); }
        tsl::hopscotch_map<int,int> map1;
        tsl::hopscotch_map<int,int> map2;
        for (int i = 0; i < count; i++) { map1.insert({i, i*11}); map2.insert({i, i*11}); }
        std::cout << (map1 == map2) << " ";
        map2[0] = 999;
        std::cout << (map1 == map2) << std::endl;
        return 0;
    }

The tsl::hopscotch_map C++ library source is NOT available on disk and MUST NOT be read (black-box rule).
Reference binary: /workspace/dataset/test14_executable  (prints exactly the 4 bytes "1 0\\n" for every valid input).
Already-verified reference-binary behavior:
  --a 0|1|3|5|10|14|100  -> "1 0\\n" exit 0
  no args / "--b 5" / "x --a 5" -> "1 0\\n" exit 0 (count stays 14)
  --a  (missing argv[2]) -> SIGABRT rc=134, stderr: terminate called after throwing an instance of 'std::logic_error'  what():  basic_string::_S_construct null not valid
  --a abc  and  --a ""   -> SIGABRT rc=134, stderr: std::invalid_argument / what(): stoi
  --a 99999999999999999999 -> SIGABRT rc=134, stderr: std::out_of_range / what(): stoi
  --a " 12" -> ok (leading ws skipped);  --a 12abc -> parses 12;  --a -5 -> ok (loop body never runs);  --a +7 -> ok;  --a 0x10 -> parses 0
  --a 2147483647 -> hangs (2 billion inserts). DO NOT run large counts; always wrap probes in \`timeout 5\`.
Deliverable will be a Cargo project in /output with library modules plus entry file /output/test14.rs that must ALSO
compile standalone via \`rustc test14.rs\` (so modules are pulled in with #[path = "..."] mod declarations, no [lib] crate).
The Rust hopscotch map must be a GENUINE hopscotch-hashing implementation written from scratch on std only
(neighborhood bitmap, displacement/swap on insert, overflow list fallback, power-of-two buckets, growth/rehash),
not a thin wrapper around std::collections::HashMap.
`

phase('Recon')
const recon = await parallel([
  () => agent(`${CONTEXT}
YOUR JOB (recon lens 1: reference-binary differential matrix).
Empirically probe /workspace/dataset/test14_executable to build the exhaustive list of argument cases a Rust port must
match byte-for-byte, INCLUDING exit codes and stderr. Always use \`timeout 5 ...\` and never pass a count above ~5000.
Cover: 0 args; 1 arg; "--a" with missing/empty/whitespace/sign/overflow/trailing-junk/hex/float-ish values; extra args
after the count; argv[1] not equal to "--a"; count values 0,1,2,3,7,8,9,15,16,17,31,32,33,62,63,64,65,100,1000.
Report the exact stdout bytes (use xxd) and exit code per case. Report findings as concrete "input -> stdout/exit/stderr" rules.`,
    { label: 'recon:binary-matrix', phase: 'Recon', schema: RECON_SCHEMA }),

  () => agent(`${CONTEXT}
YOUR JOB (recon lens 2: libstdc++ std::stoi + std::string(argv[1]) semantics).
From your knowledge of the C++ standard library (do not need internet), specify precisely how to reimplement
\`std::stoi(const std::string&)\` in Rust so it is behaviourally identical: leading whitespace per isspace, optional
+/- sign, base-10 digits, stops at first non-digit, throws std::invalid_argument when no digits consumed,
throws std::out_of_range when the value does not fit in int (note: strtol parses into long first, then the int range
check happens), and what an uncaught C++ exception does to the process (std::terminate -> abort -> SIGABRT -> shell
reports 134, message on stderr). Also specify what \`std::string(argv[2])\` does when argv[2] is NULL (argc==2):
std::logic_error with 'basic_string::_S_construct null not valid'. Give the exact stderr text formats.
Deliver an unambiguous spec (including the two-line 'terminate called after throwing an instance of X' + '  what():  Y' format)
that a Rust implementer can follow to mirror stdout/stderr/exit-code behavior. Verify your claimed stderr strings against
the reference binary with \`timeout 5\` probes.`,
    { label: 'recon:stoi-semantics', phase: 'Recon', schema: RECON_SCHEMA }),

  () => agent(`${CONTEXT}
YOUR JOB (recon lens 3: tsl::hopscotch_map public API + observable semantics, from knowledge only).
Without reading any tsl source (it is absent), specify the observable semantics that matter for this port:
 (a) insert(std::pair<K,V>) -> std::pair<iterator,bool>: does NOT overwrite an existing key.
 (b) operator[](key) -> V&: default-constructs (0 for int) and inserts when key absent; returns ref for assignment.
 (c) operator== for tsl::hopscotch_map: unordered comparison — equal sizes AND for every (k,v) in lhs there is a
     matching key in rhs with an equal value. Confirm it is order-INDEPENDENT (so bucket layout must not affect it).
 (d) default-constructed map: size 0, and whether a default bucket array is allocated lazily.
 (e) which other members a faithful port should expose (find, count, contains, at, erase, clear, size, empty,
     iterators, reserve, rehash, load_factor, max_load_factor, swap, key_eq, hash_function, equal_range, emplace,
     insert_or_assign, try_emplace, begin/end, operator!=).
 (f) libstdc++ std::hash<int> is the IDENTITY function; explain the consequence for a hopscotch table with
     power-of-two bucket count and sequential keys 0..count-1 (each key lands in its own bucket, no collisions),
     and why a from-scratch Rust port should therefore use a deterministic identity-ish hasher for integers rather
     than SipHash, to reproduce the same bucket layout and neighborhood behavior.
Also state the classic hopscotch-hashing invariants precisely (NEIGHBORHOOD_SIZE bitmap semantics, the linear probe
for a free slot then backward-shift/displacement chain, the overflow list when displacement is impossible, and when
a rehash/grow is triggered).`,
    { label: 'recon:tsl-semantics', phase: 'Recon', schema: RECON_SCHEMA }),
])

const reconText = recon.filter(Boolean).map((r, i) =>
  `--- RECON ${i + 1}: ${r.topic}\nFINDINGS:\n- ${r.findings.join('\n- ')}\nGOTCHAS:\n- ${r.gotchas.join('\n- ')}`).join('\n\n')
log(`recon complete: ${recon.filter(Boolean).length}/3 lenses`)

phase('Design')
const ANGLES = [
  'MINIMAL-SURFACE-BUT-AUTHENTIC: fewest modules that still contain a real hopscotch table; optimize for auditability and zero unsafe.',
  'LIBRARY-GRADE: model it like a real crate — separate hash/hasher module, bucket module, table core, map facade, iterators; rich API parity with tsl; zero unsafe; heavy unit tests.',
  'FIDELITY-FIRST: organize modules around reproducing tsl/libstdc++ observable behavior exactly (identity hasher, growth policy, overflow list), with a differential-test module that shells out to the C++ binary.',
]
const designs = await parallel(ANGLES.map((angle, i) => () => agent(`${CONTEXT}

RECON RESULTS (treat as authoritative):
${reconText}

YOUR JOB: propose a concrete file/module layout for the Cargo project in /output, from the angle:
  ${angle}

Hard constraints to respect:
 - /output/test14.rs is the entry file, must compile BOTH via \`rustc test14.rs\` (from /output) and via \`cargo build --release\`
   with [[bin]] name="test14" path="test14.rs". Therefore modules are included from test14.rs using #[path = "src/..."] mod ...;
   and there must be NO [lib] target competing with it (or explain a better scheme that still satisfies both commands).
 - std only, edition 2021, rustc 1.75.0 (no let-chains, no newer-than-1.75 std APIs).
 - Genuine hopscotch hashing, not a HashMap wrapper. Deterministic identity-ish hasher for integers.
 - Must build with zero warnings under \`rustc -D warnings\` ideally, and include unit tests runnable via \`cargo test\`.
Do NOT write any files. Output the layout only.`, { label: `design:${i + 1}`, phase: 'Design', schema: DESIGN_SCHEMA })))

const designText = designs.filter(Boolean).map((d, i) =>
  `=== DESIGN ${i} (${d.angle})\nFILES:\n${d.files.map(f => `  ${f.path} — ${f.purpose}\n    public: ${f.public_items.join(', ')}`).join('\n')}\nDECISIONS:\n- ${d.key_decisions.join('\n- ')}\nRISKS:\n- ${d.risks.join('\n- ')}`).join('\n\n')

phase('Judge')
const verdicts = await parallel(['output-fidelity', 'algorithmic-authenticity', 'maintainability-and-testability'].map(lens => () =>
  agent(`${CONTEXT}

CANDIDATE DESIGNS:
${designText}

YOUR JOB: judge these ${designs.filter(Boolean).length} designs strictly through the ${lens} lens.
Score each 1-10 on fidelity, algorithmic_authenticity, idiomatic_rust, testability; total = sum. Pick a winner_index
(0-based, matching "DESIGN n"). List graft_ideas: specific superior ideas from the losing designs that should be merged
into the winner. Be decisive and concrete.`, { label: `judge:${lens}`, phase: 'Judge', schema: JUDGE_SCHEMA })))

phase('Spec')
const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'hasher_spec', 'table_spec', 'cli_spec', 'api_surface', 'test_plan', 'build_commands', 'pitfalls'],
  properties: {
    files: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'purpose'], properties: { path: { type: 'string' }, purpose: { type: 'string' } } } },
    hasher_spec: { type: 'string' },
    table_spec: { type: 'string' },
    cli_spec: { type: 'string' },
    api_surface: { type: 'array', items: { type: 'string' } },
    test_plan: { type: 'array', items: { type: 'string' } },
    build_commands: { type: 'array', items: { type: 'string' } },
    pitfalls: { type: 'array', items: { type: 'string' } },
  },
}
const spec = await agent(`${CONTEXT}

RECON:
${reconText}

DESIGNS:
${designText}

JUDGE VERDICTS:
${verdicts.filter(Boolean).map(v => `winner=${v.winner_index} scores=${JSON.stringify(v.scores)}\ngrafts:\n- ${v.graft_ideas.join('\n- ')}\nrationale: ${v.rationale}`).join('\n\n')}

YOUR JOB: synthesize ONE final implementation spec: the winning layout plus the grafted ideas. Be extremely concrete and
prescriptive — the implementer will follow this literally. Include exact module paths, the hopscotch algorithm in
step-by-step pseudocode (insert with displacement + overflow list, find, erase, grow/rehash policy, neighborhood bitmap
bit order), the deterministic hasher definition, the CLI/stoi mirroring rules with exact stderr text and exit code, the
full API surface list, the unit/integration test plan, and the build commands. Do NOT write files.`,
  { label: 'spec:synthesize', phase: 'Spec', schema: SPEC_SCHEMA })

return { spec, judge_winners: verdicts.filter(Boolean).map(v => v.winner_index) }
