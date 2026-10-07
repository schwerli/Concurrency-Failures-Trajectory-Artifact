export const meta = {
  name: 'immer-vector-port-design',
  description: 'Design panel + spec extraction for porting immer::vector test11 to dependency-free Rust',
  phases: [
    { title: 'Design', detail: '3 independent persistent-vector designs + C++ semantics spec extraction' },
    { title: 'Judge', detail: 'score designs on fidelity, correctness risk, idiomatic Rust' },
  ],
}

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    approach_name: { type: 'string' },
    data_structure: { type: 'string', description: 'Precise description of the node representation and invariants' },
    key_invariants: { type: 'array', items: { type: 'string' } },
    push_back_algorithm: { type: 'string' },
    index_algorithm: { type: 'string' },
    iteration_algorithm: { type: 'string' },
    module_layout: { type: 'array', items: { type: 'string' } },
    pitfalls: { type: 'array', items: { type: 'string' } },
    rust_1_75_concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['approach_name', 'data_structure', 'key_invariants', 'push_back_algorithm', 'index_algorithm', 'iteration_algorithm', 'module_layout', 'pitfalls'],
}

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    stoi_rules: { type: 'array', items: { type: 'string' } },
    observed_probes: { type: 'array', items: { type: 'object', properties: { arg: { type: 'string' }, stdout: { type: 'string' }, stderr: { type: 'string' }, exit_code: { type: 'integer' } }, required: ['arg', 'stdout', 'exit_code'] } },
    overflow_semantics: { type: 'string' },
    output_format_rules: { type: 'array', items: { type: 'string' } },
    edge_cases_to_replicate: { type: 'array', items: { type: 'string' } },
  },
  required: ['stoi_rules', 'observed_probes', 'overflow_semantics', 'output_format_rules', 'edge_cases_to_replicate'],
}

const CONTEXT = `
Task context: We are porting this C++ program to pure Rust (2021 edition, rustc 1.75.0, ZERO external crates, std only):

\`\`\`cpp
#include <immer/vector.hpp>
#include <iostream>
#include <string>
int main(int argc, char* argv[]) {
    int n = (argc > 1) ? std::stoi(argv[1]) : 11;
    auto v = immer::vector<int>{};
    for (int i = 0; i < n; ++i) { v = v.push_back(i + 1); }
    auto sum = 0;
    for (auto x : v) { sum += x; }
    std::cout << sum << std::endl;
    auto v2 = immer::vector<int>{};
    for (int i = 0; i < v.size(); ++i) { v2 = v2.push_back(v[i] * 2); }
    sum = 0;
    for (auto x : v2) { sum += x; }
    std::cout << sum << std::endl;
    return 0;
}
\`\`\`

The reference compiled C++ binary is at /workspace/dataset/test11_executable — you MAY run it with any arguments to observe behavior.
HARD RULE: do NOT read any immer library source code (it is not present anyway). This is a black-box re-implementation: infer immer::vector's contract from the interface above and re-implement from scratch with std only.

immer::vector is a persistent (immutable) vector: a bit-partitioned vector trie (RRB-tree / Clojure-style PersistentVector with a tail buffer), branching factor 32 (5 bits). push_back returns a NEW vector sharing structure with the old one; the old one remains valid and unchanged. Operations: size() -> size_t, operator[](size_t) -> const T&, begin()/end() forward iteration, default construction.
`;

phase('Design')

const designs = await parallel([
  () => agent(`${CONTEXT}

You are Designer A. Design a FAITHFUL persistent bit-partitioned vector trie in Rust (std only) that mirrors immer::vector's structural-sharing contract: branching factor 32, a tail/leaf buffer for O(1) amortized push_back, Rc for shared nodes, radix indexing, and a forward iterator.

Emphasis: maximum structural fidelity to the real data structure (a real trie with shared inner nodes and a tail, NOT a wrapper around std::vec::Vec clone-on-write). Explain node enum representation, root shift/depth growth, and how push_back handles: tail not full, tail full but root has room, root full (depth increase).

Also state precisely how the element type must behave for this program: elements are C++ \`int\` (32-bit, wrapping arithmetic in practice). Note where wrapping must be used.

Return your design per the schema. Be concrete enough that another engineer could implement it without further questions.`, { label: 'design:faithful-trie', phase: 'Design', schema: DESIGN_SCHEMA }),

  () => agent(`${CONTEXT}

You are Designer B. Design a persistent vector trie in Rust (std only) optimizing for PROVABLE CORRECTNESS and simplicity of the index/push_back math, while still being a genuine structurally-shared persistent trie (Rc-shared nodes, branching factor 32).

Consider the alternative of a "leaves-only vector of Rc<[T;32]> chunks + spine" vs a full recursive trie, and pick the one whose invariants are easiest to verify. Enumerate the exact arithmetic for radix indexing (shift = 5 * (depth-1)) and prove the boundary cases: size == 0, size == 32, size == 32*32, size == 1024+1, and the depth-growth boundary.

Also identify how iteration should be implemented so it is O(n) total, not O(n log n), and how it must behave for an empty vector.

Return your design per the schema.`, { label: 'design:provable', phase: 'Design', schema: DESIGN_SCHEMA }),

  () => agent(`${CONTEXT}

You are Designer C. Design for ROBUSTNESS AND API COMPLETENESS: a reusable persistent-vector module that would still be correct if the driver program were extended (update/set, iteration via Iterator trait, IntoIterator for &Vector, Clone as O(1) Rc bump, Default, FromIterator, Debug), plus a separate module faithfully emulating C++ \`std::stoi\` and C++ \`int\` wrapping arithmetic.

Pay special attention to:
1. Rust 1.75.0 constraints — no unstable features, no unstable let-chains, nothing requiring a newer toolchain. List anything that risks not compiling on 1.75.
2. Deep recursion / stack overflow risk and Drop recursion depth for large vectors (n up to 10^7).
3. Panic-freedom: no unwrap on user input paths; index out of bounds behavior.
4. Module layout for a Cargo project at /output with entry file /output/test11.rs that must compile BOTH via bare \`rustc test11.rs\` and via \`cargo build --release\`. Explain exactly how to make a single entry file work under both (e.g. #[path] module declarations + [[bin]] path in Cargo.toml) and any gotchas.

Return your design per the schema.`, { label: 'design:robust-api', phase: 'Design', schema: DESIGN_SCHEMA }),

  () => agent(`${CONTEXT}

You are the Semantics Spec Extractor. Do NOT design data structures. Instead, empirically determine the exact observable contract of the reference binary /workspace/dataset/test11_executable so a Rust port can be byte-for-byte identical on stdout.

Run the binary across a wide matrix of arguments, including at minimum:
- no args (default n=11)
- 0, 1, 2, 3, 4, 5, 31, 32, 33, 63, 64, 65, 1023, 1024, 1025, 32767, 32768, 65535, 65536, 92681, 92682, 100000, 200000, 1000000
- negative: -1, -5, -2147483648
- malformed / partial: "abc", "3abc", " 7", "\\t9", "+4", "-0", "0x10", "007", "1 2", "", "  ", "12.9", "1e3"
- range limits: 2147483647, 2147483648, -2147483649, 999999999999999999999
- extra args: 3 99 extra
For each, record stdout EXACTLY (note trailing newline presence), stderr, and exit code. Use commands like: /workspace/dataset/test11_executable 33; echo "exit=$?"
Use \`od -c\` on the output of at least two cases to confirm exact bytes and line endings.
NOTE: 2147483647 will take a very long time / huge memory — use a timeout and report that instead of hanging.

Then state:
1. The precise std::stoi rules implied (whitespace skipping, sign handling, digit prefix consumption, error conditions and their exact stderr text + exit code).
2. The integer overflow semantics for \`sum\` and for \`v[i] * 2\` (both are C++ \`int\`). Derive the closed forms and verify them against observed output for n=65535, 65536, 92681, 100000, 200000, 1000000. State the exact wrapping model.
3. Output formatting rules (std::endl behavior, no thousands separators, negative sign formatting).
4. Every edge case a Rust port must replicate, including whether stderr/exit-code fidelity is achievable in Rust (mention std::process::abort giving SIGABRT/134).

Return per the schema. Be exhaustive and quote real observed bytes.`, { label: 'spec:cpp-semantics', phase: 'Design', schema: SPEC_SCHEMA }),
])

const [dA, dB, dC, spec] = designs

phase('Judge')

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    ranking: { type: 'array', items: { type: 'string' }, description: 'approach names best-first' },
    scores: { type: 'array', items: { type: 'object', properties: { approach: { type: 'string' }, fidelity: { type: 'integer' }, correctness_risk: { type: 'integer' }, simplicity: { type: 'integer' }, notes: { type: 'string' } }, required: ['approach', 'fidelity', 'correctness_risk', 'simplicity', 'notes'] } },
    synthesis: { type: 'string', description: 'The recommended final design, grafting the best ideas from runners-up. Be highly specific: node representation, algorithms, module layout, and where wrapping arithmetic goes.' },
    must_do: { type: 'array', items: { type: 'string' } },
    must_avoid: { type: 'array', items: { type: 'string' } },
  },
  required: ['ranking', 'scores', 'synthesis', 'must_do', 'must_avoid'],
}

const judges = await parallel(['structural fidelity to immer', 'correctness and boundary-case risk', 'Rust 1.75 compilability and maintainability'].map((lens, i) => () =>
  agent(`${CONTEXT}

You are Judge ${i + 1}, evaluating through the lens of: **${lens}**.

Three candidate designs were produced:

--- DESIGN A (${dA?.approach_name}) ---
${JSON.stringify(dA, null, 2)}

--- DESIGN B (${dB?.approach_name}) ---
${JSON.stringify(dB, null, 2)}

--- DESIGN C (${dC?.approach_name}) ---
${JSON.stringify(dC, null, 2)}

--- EMPIRICAL C++ SEMANTICS SPEC ---
${JSON.stringify(spec, null, 2)}

Score each design 1-10 on fidelity (to immer::vector's real persistent-trie contract), correctness_risk (10 = lowest risk), and simplicity (10 = simplest to get right). Then produce a SYNTHESIS: the single design we should implement, grafting the best ideas from the runners-up. Your synthesis must be concrete and implementation-ready, and must respect: pure std, rustc 1.75, zero crates, entry file /output/test11.rs compiling under BOTH bare rustc and cargo, wrapping i32 arithmetic, byte-identical stdout.

You may run /workspace/dataset/test11_executable to check any claim. Do not read immer sources.`, { label: `judge:${lens.split(' ')[0]}`, phase: 'Judge', schema: JUDGE_SCHEMA })))

return { designs: { A: dA, B: dB, C: dC }, spec, judges: judges.filter(Boolean) }
