export const meta = {
  name: 'earcut-port-review',
  description: 'Adversarially review the Rust earcut port for faithfulness, Rust-specific hazards, C++ semantic gaps, and requirement compliance',
  phases: [
    { title: 'Review', detail: 'independent lenses over /output' },
    { title: 'Verify', detail: 'refute each finding' },
  ],
}

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'findings'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'line', 'severity', 'detail', 'failingInput'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          detail: { type: 'string' },
          failingInput: {
            type: 'string',
            description: 'A concrete argument to ./test4, or a concrete polygon, that would expose this. Say "none - latent" if the reachable input space of this program cannot expose it.',
          },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'reasoning', 'concreteEvidence'],
  properties: {
    isReal: { type: 'boolean' },
    reasoning: { type: 'string' },
    concreteEvidence: { type: 'string', description: 'What you actually ran or read to decide' },
  },
}

const CONTEXT = `The project under review is in /output. It is a from-scratch Rust port of the C++ program /workspace/dataset/earcut.hpp/tests/test4.cpp (readable) and of the mapbox::earcut polygon triangulation library it calls (the library header is NOT on disk and must not be downloaded - it was reimplemented from knowledge of the algorithm).

The original compiled C++ binary is at /workspace/dataset/test4_executable and you MAY run it with any argument as an oracle.
The Rust build is at /output/test4 (already compiled). You may run it, rebuild it (cd /output && rustc -O test4.rs -o /tmp/mytest4), and run "cd /output && cargo test --offline".

Hard requirements the port must satisfy:
1. Rust 2021, compiles with rustc or cargo.
2. Same CLI as the C++ binary (one optional integer argument, default 4), parsed via std::env::args().
3. Byte-for-byte identical stdout; identical numeric precision and formatting.
4. Zero crates.io dependencies - std only.
5. Complete cargo project in /output, library code in modules, entry file at /output/test4.rs.
6. Reimplemented, not transliterated from the library source.
7. A compiled executable is produced.

Already established by testing: outputs are byte-identical for every integer n from -5 to 260, for n in {300,350,400,450,500,600,700,800,1000}, for the no-argument case, and for the argument strings "", "abc", "7abc", " 9", "+6", "-3", "0", "  \\t-12x34", "2147483648", "99999999999999999999". Exit codes match. Do not re-report "it works" - hunt for what is still WRONG or FRAGILE.

Report only defects you can point at in a specific file and line. Prefer few high-confidence findings over many speculative ones. If you find nothing in your lens, return an empty findings array.`

phase('Review')

const LENSES = [
  {
    key: 'faithfulness',
    prompt: `${CONTEXT}

YOUR LENS: algorithmic faithfulness to the reference earcut implementation.

Read every file under /output/src/earcut/ and check it statement by statement against your own independent knowledge of how mapbox's earcut works. Do NOT trust the port's comments - they were written by the author of the code you are reviewing.

Focus on things that change WHICH triangle is emitted or in WHAT ORDER:
- earcutLinked: the ear = next.next / stop = next.next skip, the push order (prev, ear, next), the pass 0 -> 1 -> 2 -> splitEarcut fallback ladder and where it breaks.
- filterPoints: the "again" flag loop, "p = end = p.prev", the "if (p == p.next) break", what it returns, the steiner guard.
- cureLocalIntersections: that removeNode(p) must NOT clobber p's own next pointer before the second removal, the p = start = b reassignment, the emission order.
- splitEarcut: that a->prev / a->next are read at the right moment relative to splitPolygon, and that it returns after the first successful split.
- eliminateHoles / eliminateHole / findHoleBridge: the leftward ray scan conditions and interpolation, the "if (x == hx) return m" early return, the tanMin tie-break including sectorContainsSector, and whether outerNode is correctly threaded through the hole loop.
- isEar vs isEarHashed: that the hashed path visits exactly the same candidate set the linear path would, that the two tail loops are right, and that new nodes created by splitPolygon (z = 0, not in the z-list) are handled the way the reference handles them.
- linkedList: the winding sum, forward vs reverse insertion, vertex index assignment.
- zOrder / indexCurve / sortLinked: the merge sort must be stable on equal z.

For each divergence you find, state the exact reference behaviour, the exact ported behaviour, and a polygon that would distinguish them.`,
  },
  {
    key: 'rust-hazards',
    prompt: `${CONTEXT}

YOUR LENS: Rust-specific failure modes that C++ did not have.

Read all of /output/src and /output/test4.rs and hunt for:
- Index-out-of-bounds panics: the code uses usize::MAX as a NIL sentinel and indexes self.nodes[handle]. Find any path where a NIL handle can reach an index expression.
- Arithmetic overflow panics in debug builds (the release profile disables overflow-checks, but "cargo test" and "rustc" without -O do not). Look at z_order's shifts and masks, threshold -= len as i32, vertices += len, i.wrapping_mul(2), (4 * n) in tests, nodes.reserve(len * 3 / 2).
- "as" casts that saturate in Rust but truncate/UB in C++ (f64 -> i32 especially: Rust saturates, C++ static_cast is UB out of range). Does any input make (x - min_x) * inv_size fall outside i32 range?
- f64::min / f64::max vs std::min / std::max: they differ on NaN and on signed zero. Can NaN or -0.0 reach them?
- Signed left shift: y << 1 where y can have bit 30 set. Confirm what Rust does versus what C++ does.
- Stack depth: earcut_linked recurses into split_earcut which recurses back into earcut_linked. Estimate the worst-case depth for large n and whether it can blow the stack before the C++ version would.
- Anything that would behave differently between a debug and a release build. That is a real defect: the graders may build either way.

Actually TRY to trigger what you find: build a debug binary with "cd /output && rustc test4.rs -o /tmp/dbg4" (no -O, so overflow checks are ON) and run it across a range of n, comparing against /workspace/dataset/test4_executable.`,
  },
  {
    key: 'cpp-semantics',
    prompt: `${CONTEXT}

YOUR LENS: C++ -> Rust semantic gaps outside the triangulation itself.

Read /workspace/dataset/earcut.hpp/tests/test4.cpp and /output/test4.rs, /output/src/cli.rs, /output/src/polygon.rs.

Check:
- std::atoi: whitespace forms accepted (is \\v and \\f handled?), sign handling, "no digits" case, overflow behaviour. Verify against the real binary by running it - e.g. compare ./test4 and the C++ binary on arguments with embedded NUL-adjacent forms, tabs, vertical tabs, unicode, very long digit strings, "-0", "0x10", "010", "  +  7", "2147483647", "-2147483648", "4294967300".
- argc/argv: does std::env::args() line up with argv exactly? What about a non-UTF-8 argument? std::env::args() PANICS on invalid unicode while argv would be passed through - is that a real divergence, and can it be triggered? Try it with a shell that can pass invalid UTF-8 (e.g. printf '\\xff').
- Numeric widening: "double offset = i * 2;" then "offset + n" where n is int. Confirm the Rust reproduces the exact same doubles.
- Output formatting: "std::cout << idx" for uint32_t, then " ". No trailing newline. Confirm the Rust matches on an empty result and a non-empty one.
- Exit code and stderr behaviour.
- Locale: could std::cout formatting of an unsigned int ever differ from Rust's to_string?

Run the binaries to confirm each claim rather than reasoning alone.`,
  },
  {
    key: 'requirements',
    prompt: `${CONTEXT}

YOUR LENS: requirement compliance and project hygiene. Be picky and concrete.

Verify by actually running things:
- Does "cd /output && cargo build --release --offline" succeed from clean? Try "cargo clean" first, then rebuild, and check target/release/test4 runs correctly.
- Does "cd /output && rustc -O test4.rs -o /tmp/x" succeed standalone, and does the resulting binary match the C++ one? Does plain "rustc test4.rs" (no -O) also work?
- Are there ZERO external dependencies? Check Cargo.toml, Cargo.lock, and grep the sources for any "extern crate" or non-std use.
- Is edition 2021 set?
- Is /output/test4.rs really the entry file, in the package root, and wired as the bin target?
- Is library code actually organised into modules (not one giant file)?
- Are there build warnings? Run "cargo build --release --offline 2>&1" and "cargo clippy" if available, and report any warnings.
- Does "cargo test --offline" pass? How long does it take - is any test unreasonably slow?
- Are there leftover artifacts that should not ship, or files that contradict the README?
- Read /output/README.md and check every factual claim in it against the code. Report any claim that is wrong or overstated.

Note: requirement 7 literally says "produce an executable at /output/test4.rs", which conflicts with also saving the source there. Report how the project resolved this and whether the resolution is sensible - do NOT overwrite the source file yourself.`,
  },
  {
    key: 'break-it',
    prompt: `${CONTEXT}

YOUR LENS: find an input where the Rust and C++ binaries actually disagree. You have a real oracle - use it aggressively rather than reading code.

The program takes one integer. Think hard about which values are structurally special and test them, including but not limited to:
- The z-order hashing threshold (rings total > 80 vertices, i.e. n = 21) and its immediate neighbours.
- Small n where the polygon is not yet self-overlapping: n = 1, 2, 3.
- n values where 2*(n-1) relates to n such that ring corners coincide exactly (exact floating point ties are where >= vs > bugs show up).
- Large n, where z-order truncation to a 15-bit grid starts making distinct vertices share a Morton cell. Compute at which n the grid resolution becomes coarser than the coordinate spacing and test around it. The coordinate extent for a given n is roughly 2*(n-1) + n, and the grid is 32767 wide - so also consider whether any n in a runnable range makes two vertices collide.
- Values near i32 boundaries that atoi produces but that make the polygon loop trivial.

Write a shell loop that compares the two binaries byte-for-byte with cmp and report ONLY actual mismatches, with the exact argument. Keep each run under about 30 seconds (n beyond ~600 gets slow); prefer breadth over depth. If you find no mismatch, say so explicitly and report the total number of distinct arguments you compared.`,
  },
]

const reviewed = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS, effort: 'high' }),
  (result, lens) => {
    if (!result || !result.findings || result.findings.length === 0) return []
    return parallel(result.findings.map(f => () =>
      agent(`${CONTEXT}

A reviewer working the "${lens.key}" lens reported the finding below. Your job is to REFUTE it. Default to refuted=true unless you can demonstrate the defect concretely.

FINDING: ${f.title}
FILE: ${f.file}:${f.line}
SEVERITY CLAIMED: ${f.severity}
DETAIL: ${f.detail}
CLAIMED FAILING INPUT: ${f.failingInput}

Read the cited code. If an input is claimed, RUN it against both /output/test4 and /workspace/dataset/test4_executable and compare with cmp. If the claim is about a debug build, build one and try it. If the claim is about a latent library-level issue that this program's inputs cannot reach, it is still real IF the ported library genuinely diverges from reference earcut semantics - but say clearly that it is unreachable from the CLI.

Return isReal=false if the finding is wrong, already handled, or purely stylistic.`,
        { label: `verify:${lens.key}:${f.title.slice(0, 30)}`, phase: 'Verify', schema: VERDICT, effort: 'high' })
      .then(v => ({ ...f, lens: lens.key, verdict: v }))
    ))
  }
)

const all = reviewed.flat().filter(Boolean)
const real = all.filter(f => f.verdict && f.verdict.isReal)
log(`${all.length} findings raised, ${real.length} survived refutation`)

return { confirmed: real, refuted: all.filter(f => !(f.verdict && f.verdict.isReal)).map(f => ({ title: f.title, why: f.verdict && f.verdict.reasoning })) }
