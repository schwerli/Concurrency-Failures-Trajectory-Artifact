export const meta = {
  name: 'sortedmap-cpp2rust-recon',
  description: 'Independently probe the C++ SortedMap binary and design the Rust port layout',
  phases: [
    { title: 'Probe', detail: 'independent black-box probes: CLI/atoi, API semantics, boundaries, perf' },
    { title: 'Design', detail: 'synthesize module layout + data structure choice' },
  ],
}

const CPP = `#include "../sortedcontainers.h"
#include <iostream>
#include <tuple>

int main(int argc, char* argv[]) {
    int n = 18;
    if (argc > 1) {
        n = std::atoi(argv[1]);
    }

    SortedMap<std::tuple<int, int>, std::string> m;
    for (int i = 0; i < n; i++) {
        auto key = std::make_tuple(i, i*2);
        m.insert(key, "value_" + std::to_string(i));
    }

    std::cout << m.size() << std::endl;

    auto test_key1 = std::make_tuple(3, 6);
    auto test_key2 = std::make_tuple(5, 10);

    std::cout << m.contains(test_key1) << std::endl;
    std::cout << m.contains(test_key2) << std::endl;

    std::cout << m[test_key1] << std::endl;

    m[test_key1] = "modified";
    std::cout << m[test_key1] << std::endl;

    auto keys = m.keys();
    auto values = m.values();

    std::cout << keys.size() << std::endl;
    std::cout << values.size() << std::endl;

    for (int i = 0; i < 4; i++) {
        auto key_to_remove = std::make_tuple(i, i*2);
        m.erase(key_to_remove);
    }

    std::cout << m.size() << std::endl;

    auto it = m.find(std::make_tuple(6, 12));
    if (it != m.end()) {
        std::cout << it->second << std::endl;
    }

    auto lb = m.lower_bound(std::make_tuple(7, 14));
    if (lb != m.end()) {
        std::cout << std::get<0>(lb->first) << std::endl;
    }

    auto ub = m.upper_bound(std::make_tuple(7, 14));
    if (ub != m.end()) {
        std::cout << std::get<0>(ub->first) << std::endl;
    }

    SortedMap<std::tuple<int, int>, std::string> m2;
    for (int i = 0; i < n/2; i++) {
        auto key = std::make_tuple(i+10, (i+10)*2);
        m2.insert(key, "other_" + std::to_string(i));
    }

    sortedcontainers::update(m, m2);

    std::cout << m.size() << std::endl;
    std::cout << m.contains(std::make_tuple(12, 24)) << std::endl;

    auto range = m.equal_range(std::make_tuple(8, 16));
    int count = 0;
    for (auto it = range.first; it != range.second; ++it) {
        count++;
    }
    std::cout << count << std::endl;

    std::cout << m.get(std::make_tuple(100, 200), "default") << std::endl;

    m.clear();

    std::cout << m.size() << std::endl;
    std::cout << m.empty() << std::endl;
    return 0;
}`

const CONTEXT = `
# Task context

We are porting a C++ program to pure Rust (2021 edition, std only, ZERO external crates).

The C++ entry file is /workspace/dataset/test18.cpp (shown below). It includes "../sortedcontainers.h",
a header-only C++ library that is NOT available on disk (deliberately: this is a black-box port).
The compiled reference binary IS available at /workspace/dataset/test18_executable -- run it freely
with any argv to observe behavior.

The Rust port must produce BYTE-FOR-BYTE identical stdout for the same argv.

## C++ entry source
\`\`\`cpp
${CPP}
\`\`\`

## Facts already established by the lead engineer (verify, do not blindly trust)
- Output is plain LF-terminated lines, nothing on stderr, exit code 0.
- \`std::cout << bool\` prints "1"/"0"; sizes print as plain decimal.
- An independent model built on std::map with these semantics reproduced the reference
  binary byte-for-byte for every n in 0..=320:
  - SortedMap is an ordered map with lexicographic tuple key ordering (std::map semantics).
  - insert(k,v) stores; operator[] on a missing key INSERTS a default-constructed value ("")
    and returns a mutable reference (so keys().size() grows).
  - keys()/values() return sequences in ascending key order.
  - erase(k) removes if present. find/lower_bound/upper_bound/equal_range/end behave exactly
    like std::map's. get(k, default) returns the stored value if present else the default.
  - sortedcontainers::update(dst, src) merges src into dst, OVERWRITING existing keys
    (proved at n=182 where the get line prints "other_90" instead of "value_100").
- Reference binary at n=200000 runs in ~88ms, so the real library is sub-linear per op.

## Rules for you
- Do NOT try to find or read the C++ library source (it does not exist on disk). Black-box only.
- Do NOT write anything into /output -- the lead engineer owns that directory. Use /tmp for scratch.
- Toolchain on this box: rustc 1.75.0, cargo 1.75.0, g++ (gcc-12). No network. No python3.
- Your final message is consumed programmatically. Return exactly the requested structured data.
`

phase('Probe')

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'confirmed', 'risks'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'evidence'],
        properties: {
          claim: { type: 'string', description: 'A precise behavioral fact the Rust port must reproduce' },
          evidence: { type: 'string', description: 'The exact command(s) run and the output that proves it' },
        },
      },
    },
    confirmed: { type: 'array', items: { type: 'string' }, description: 'Lead-engineer facts you independently reconfirmed' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Ways a naive Rust port would diverge' },
  },
}

const PROBES = [
  {
    key: 'cli-atoi',
    prompt: `${CONTEXT}

## Your assignment: argv / std::atoi fidelity

Determine EXACTLY how the program maps argv[1] to the integer n, so the Rust port can reproduce it
for any input string. Probe /workspace/dataset/test18_executable aggressively.

Cover at minimum: no args; empty string; leading whitespace (space, tab, newline, vertical tab,
form feed, carriage return); "+5"; "-5"; "-0"; "007"; trailing junk ("7abc", "12.9", "1e3", "5 ");
non-numeric ("abc", ".", "+-3", "0x10"); values above INT_MAX ("2147483648", "4294967296");
values above LONG_MAX ("9999999999999999999999" and its negative); multiple args ("4 99");
bytes that are not valid UTF-8 (use bash $'\\xff' style quoting).

Note that all n <= 0 produce identical output, so distinguish "parsed to 0" from "parsed to negative"
only where observable -- and SAY so where it is not observable.

Then state the precise parsing algorithm to implement in Rust, including overflow behavior.
The lead engineer's hypothesis is: glibc atoi == (int)strtol(s, NULL, 10), i.e. skip C isspace,
optional sign, decimal digits, accumulate saturating at i64::MAX / i64::MIN, then truncate with
\`as i32\`. Test this hypothesis and report whether it holds for every case you tried.
Write a tiny C program with g++ and compare its atoi output against your Rust candidate parser to
be certain (that is allowed -- it is not the library source).

Also confirm: exit code, whether anything is written to stderr, and whether output ever lacks a
trailing newline.`,
  },
  {
    key: 'api-semantics',
    prompt: `${CONTEXT}

## Your assignment: derive the observable API semantics and the full output-line map

Work out, line by line, which of the 17 possible printed lines appear for a given n, and what each
one equals as a closed-form function of n. Three of the lines are conditional (find, lower_bound,
upper_bound) so the TOTAL LINE COUNT varies with n -- map exactly which n produce 14, 15, 16, or 17
lines.

Build your own independent reference model (C++ with std::map via g++, or Rust with BTreeMap via
rustc -- your choice, but do NOT reuse the lead engineer's file at /tmp/model/model.cpp; write your
own from scratch) and diff it against /workspace/dataset/test18_executable for EVERY n in 0..=400,
plus a spread of larger n (500, 1000, 5000, 20000, 100000, 200000) and the negative/garbage inputs.

Report any n where your model diverges, with the diff. Explicitly answer:
- Does the get(...) line ever print something other than "default"? For which n exactly, and what?
- Does the equal_range count line ever exceed 1?
- Does contains((12,24)) depend on n in a non-obvious way?
- Are the lower_bound / upper_bound printed values ever anything other than 7 and 8?
- What is the exact closed form for the "size after update" line?`,
  },
  {
    key: 'boundaries',
    prompt: `${CONTEXT}

## Your assignment: boundary hunt

Your job is to find the n values where the output SHAPE or a line's value transitions, and to make
sure no transition is missed. Do this by brute force against the reference binary:
run /workspace/dataset/test18_executable for every n in 0..=1000, record each output, and compute
a table of (n -> line count) and (n -> value of each line index). Then report every transition point
and explain each one in terms of the program logic (which of i<n, i<n/2, key presence conditions
flips at that n).

Pay special attention to: n around 4..10 (where find/lower_bound/upper_bound start printing),
n = 100/101 and n = 181/182 (where the get line changes), n = 12..26 (where contains((12,24))
flips), n = 8/9 (equal_range count), and odd-vs-even n (integer division n/2).

Also test a few very large n for output stability and runtime: 100000, 500000, 1000000 -- report
wall-clock time and whether output is still correct-looking. If a run takes more than ~30s, say so
and stop escalating.

Deliverable: the complete transition table as findings, so the Rust port can be regression-tested
against it.`,
  },
  {
    key: 'rust-layout',
    prompt: `${CONTEXT}

## Your assignment: prove out a Rust project layout that builds BOTH ways

The deliverable project lives in /output and must satisfy all of these simultaneously:
1. The entry file is /output/test18.rs (in the package root, NOT in src/).
2. Library code must be organized into modules in separate files (not one giant file).
3. \`cd /output && rustc test18.rs\` must work standalone (producing ./test18).
4. \`cd /output && cargo build --release\` must also work.
5. Zero external crates -- std only. Rust 2021 edition. rustc 1.75.0.

Build a THROWAWAY proof-of-concept in /tmp (e.g. /tmp/layout-poc) that demonstrates a layout
satisfying all five, using trivial placeholder code (a module with one function that the entry file
calls). Actually run both build commands and paste the real output.

Key questions to answer definitively, with evidence:
- With \`[[bin]] name = "test18" path = "test18.rs"\` in Cargo.toml and \`mod foo;\` in test18.rs,
  where does rustc/cargo look for the module file? Confirm whether \`foo/mod.rs\` and \`foo.rs\`
  both resolve, and whether nested submodules (\`foo::bar\`) work from the package root.
- Does cargo complain about a missing src/main.rs or an autodetected target? Any warnings?
- Does cargo need \`autobins = false\` or an explicit \`edition\`? Does rustc need \`--edition 2021\`
  on the command line (i.e. does the standalone build silently use 2015)? Test whether 2015-vs-2021
  matters for typical code (e.g. array \`IntoIterator\`, \`dyn\`, closures capturing disjoint fields).
- Where does the final binary land in each case, and what is the recommended way to also have the
  compiled executable sitting next to the source in /output?
- Does \`cargo build --release\` overwrite or interfere with an executable produced by rustc in
  /output? Any name collision between /output/test18 (rustc output) and cargo's target dir?

Report the exact recommended Cargo.toml contents and rustc invocation as findings, and list any
gotcha that would make one of the two build paths fail.`,
  },
  {
    key: 'ds-design',
    prompt: `${CONTEXT}

## Your assignment: choose the core sorted-container data structure for the Rust port

The library to re-implement is a C++ analogue of Python's \`sortedcontainers\`. We must expose, in
idiomatic Rust with std only, a generic \`SortedMap<K: Ord, V>\` supporting: insert, operator[]-style
entry access that inserts a default, contains, get_or(default), erase, size/len, is_empty, clear,
keys, values, find, lower_bound, upper_bound, equal_range, end, plus iterator/cursor objects that
can be compared for equality, advanced, and dereferenced to (&K, &V) -- because the C++ test does
\`it->second\`, \`std::get<0>(lb->first)\`, and iterates \`for (it = range.first; it != range.second; ++it)\`.

Evaluate these three candidate cores and recommend ONE, with reasoning:
  (A) a single \`Vec<(K, V)>\` kept sorted, binary search, cursors = usize indices, end() = len();
  (B) a two-level bucket structure (Vec<Vec<(K,V)>> with a load factor and a positional index),
      i.e. a faithful port of sortedcontainers' design, cursors = flat usize rank;
  (C) wrapping std::collections::BTreeMap and layering the C++-shaped API on top.

Judge on: (1) risk of a subtle behavioral bug, (2) asymptotics for THIS program's access pattern
(n ascending inserts, 4 front erases, then a merge of an overlapping mid-range key set, plus point
lookups), (3) asymptotics in general use, (4) how naturally each supports comparable/dereferenceable
cursors -- note that BTreeMap has no stable index-based cursor on rustc 1.75.0 (no \`BTreeCursor\`
on stable), which matters for equal_range/upper_bound/end comparison, (5) code clarity.

Back your asymptotic claims with a real measurement: write a throwaway Rust benchmark in /tmp that
implements a stripped-down version of at least (A) and (B) and times the actual access pattern of
this program for n = 200000 and n = 1000000. Report the numbers. The reference C++ binary does
n=200000 in ~88ms end to end, which is the bar.

Deliverable: a recommendation with the measured evidence, plus the precise module breakdown you would
use (file names and what lives in each), and the exact Rust signatures for the cursor type and the
bound-search methods.`,
  },
]

const probeResults = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Probe', schema: PROBE_SCHEMA })
    .then(r => ({ key: p.key, ...r }))
))

const good = probeResults.filter(Boolean)
log(`probes done: ${good.map(g => g.key).join(', ')}`)

phase('Design')

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['spec', 'layout', 'core_choice', 'core_rationale', 'regression_table_notes', 'traps'],
  properties: {
    spec: { type: 'string', description: 'The complete, unambiguous behavioral spec of the program as a function of argv, including the argv->n parsing algorithm and the exact conditional-line rules' },
    layout: { type: 'string', description: 'Exact file-by-file project layout for /output plus the verbatim Cargo.toml, and the two build commands that must both work' },
    core_choice: { type: 'string', enum: ['sorted-vec', 'two-level-buckets', 'btreemap'] },
    core_rationale: { type: 'string' },
    regression_table_notes: { type: 'string', description: 'Which n values are the critical regression cases and why' },
    traps: { type: 'array', items: { type: 'string' }, description: 'Concrete ways the Rust port could diverge, each with how to avoid it' },
  },
}

const synthesis = await agent(`${CONTEXT}

## Your assignment: synthesize the recon into one implementation brief

Four independent probe agents investigated this port. Their structured findings:

\`\`\`json
${JSON.stringify(good, null, 2)}
\`\`\`

Reconcile them into a single implementation brief for the lead engineer. Where two probes disagree,
RESOLVE the disagreement by running the reference binary yourself and say what you did. Where a
probe asserted something without evidence, either verify it or flag it as unverified.

Be concrete and prescriptive: the lead engineer will write the code directly from your brief.
Include the exact argv parsing algorithm, the exact list of printed lines with the condition guarding
each, the file layout with verbatim Cargo.toml, the data-structure recommendation, and the traps.`,
  { label: 'synthesize', phase: 'Design', schema: SYNTH_SCHEMA })

return { probes: good, synthesis }
