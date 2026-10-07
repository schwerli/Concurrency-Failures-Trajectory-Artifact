export const meta = {
  name: 'cpp-to-rust-hopscotch',
  description: 'Port tsl::hopscotch_map test1.cpp to a dependency-free Rust Cargo project in /output',
  phases: [
    { title: 'Design', detail: '3 independent hopscotch-hashing designs (std-only, safe Rust)' },
    { title: 'Judge', detail: 'score designs, synthesize one normative spec' },
    { title: 'Implement', detail: 'one agent per module file, disjoint paths' },
    { title: 'Integrate', detail: 'build with cargo + rustc, fix until clean' },
    { title: 'Verify', detail: 'differential fuzz vs C++ binary, invariant audit, compliance critic' },
    { title: 'Repair', detail: 'fix confirmed defects' },
    { title: 'Final', detail: 'rebuild, re-run differential suite, completeness critic' },
  ],
}

// ---------------------------------------------------------------------------
// Shared, normative contract handed to every agent.
// ---------------------------------------------------------------------------
const CONTRACT = `
# TASK CONTEXT

We are porting this C++ program to pure Rust (2021 edition, rustc 1.75.0, ZERO external
crates - std only, NO unsafe code):

\`\`\`cpp
#include <iostream>
#include <string>
#include "../include/tsl/hopscotch_map.h"

int main(int argc, char* argv[]) {
    int count = 1;
    if (argc > 1 && std::string(argv[1]) == "--a") {
        count = std::stoi(argv[2]);
    }

    tsl::hopscotch_map<int, std::string> map;
    for (int i = 0; i < count; i++) {
        map.insert({i, "value" + std::to_string(i)});
    }

    std::cout << map.size() << std::endl;

    return 0;
}
\`\`\`

RULE: this is a BLACK-BOX port. Do NOT attempt to read, fetch, or search for the
tsl/hopscotch-map C++ library source. It is not present on disk. Re-implement
hopscotch hashing from first principles using only std.

# OBSERVED REFERENCE BEHAVIOUR (measured from the compiled C++ binary at
# /workspace/dataset/test1_executable - this is ground truth)

| argv                        | stdout | stderr                                                        | exit |
|-----------------------------|--------|---------------------------------------------------------------|------|
| (none)                      | \`1\`    | -                                                             | 0    |
| \`--a 0\`                     | \`0\`    | -                                                             | 0    |
| \`--a 1\`                     | \`1\`    | -                                                             | 0    |
| \`--a 2\`                     | \`2\`    | -                                                             | 0    |
| \`--a 5\`                     | \`5\`    | -                                                             | 0    |
| \`--a 100\`                   | \`100\`  | -                                                             | 0    |
| \`--a -1\`, \`--a -5\`          | \`0\`    | -                                                             | 0    |
| \`--a "  7"\` (lead. spaces)  | \`7\`    | -                                                             | 0    |
| \`--a 7abc\`                  | \`7\`    | -                                                             | 0    |
| \`--a +3\`                    | \`3\`    | -                                                             | 0    |
| \`--a 0x10\`                  | \`0\`    | -                                                             | 0    |
| \`--b 5\`, \`foo\`              | \`1\`    | -                                                             | 0    |
| \`--a 3 extra junk\`          | \`3\`    | -                                                             | 0    |
| \`--a abc\`, \`--a ""\`         | (empty)| terminate/std::invalid_argument, what(): stoi                  | 134 (SIGABRT) |
| \`--a 2147483648\`            | (empty)| terminate/std::out_of_range, what(): stoi                      | 134 (SIGABRT) |
| \`--a 99999999999999999999\`  | (empty)| terminate/std::out_of_range, what(): stoi                      | 134 (SIGABRT) |
| \`--a\` (no second arg)       | (empty)| terminate/std::logic_error, what(): basic_string::_S_construct null not valid | 134 (SIGABRT) |

Exact stderr byte sequences to reproduce (note the TWO spaces after \`what():\`):

\`\`\`
terminate called after throwing an instance of 'std::invalid_argument'
  what():  stoi
\`\`\`
\`\`\`
terminate called after throwing an instance of 'std::out_of_range'
  what():  stoi
\`\`\`
\`\`\`
terminate called after throwing an instance of 'std::logic_error'
  what():  basic_string::_S_construct null not valid
\`\`\`

Each is followed by a trailing newline, then the process aborts via SIGABRT
(\`std::process::abort()\` in Rust).

\`std::stoi\` semantics to replicate exactly: skip leading whitespace
(\` \`, \\t, \\n, \\v, \\f, \\r), accept optional single \`+\`/\`-\`, then base-10 digits,
stop at the first non-digit (trailing garbage is ignored, NOT an error).
Zero digits consumed => std::invalid_argument. Value outside \`i32\` range
(including values that overflow a 64-bit intermediate) => std::out_of_range.

# PROJECT LAYOUT (already fixed - do not deviate)

\`\`\`
/output/Cargo.toml                  (already written; [[bin]] name="test1" path="test1.rs")
/output/test1.rs                    crate root of the binary; declares modules via #[path]
/output/src/cxx.rs                  C++ runtime-compatibility shims (stoi, terminate)
/output/src/hopscotch/mod.rs        module hub + re-exports
/output/src/hopscotch/hash.rs       hasher mimicking libstdc++ std::hash
/output/src/hopscotch/bucket.rs     Bucket<K,V> with neighborhood bitmap
/output/src/hopscotch/growth.rs     PowerOfTwoGrowthPolicy
/output/src/hopscotch/map.rs        HopscotchMap<K,V,S> + iterators
\`\`\`

\`test1.rs\` is the crate root and wires the tree with #[path] attributes so that
BOTH \`cargo build --release\` AND a bare \`rustc -O test1.rs -o test1\` (run from
/output) succeed:

\`\`\`rust
#![forbid(unsafe_code)]

#[path = "src/cxx.rs"]
mod cxx;
#[path = "src/hopscotch/mod.rs"]
mod hopscotch;
\`\`\`

Submodules inside src/hopscotch/ are declared normally in mod.rs (\`pub mod map;\`)
and refer to each other with \`crate::hopscotch::...\` or \`super::...\`.

# PINNED PUBLIC APIs (every implementer must match these EXACTLY so the files
# compose without an integration pass)

## src/hopscotch/hash.rs
\`\`\`rust
/// Deterministic hasher mirroring libstdc++'s std::hash: identity for integral
/// types, MurmurHash64A (_Hash_bytes) for byte sequences.
pub struct CxxStdHash;                  // derive/impl: Clone, Copy, Debug, Default
impl std::hash::BuildHasher for CxxStdHash { type Hasher = CxxStdHasher; ... }

pub struct CxxStdHasher { /* private */ }   // impl Clone, Debug, Default
impl std::hash::Hasher for CxxStdHasher {
    fn write(&mut self, bytes: &[u8]);
    fn finish(&self) -> u64;
    // plus overrides making integral writes the IDENTITY (value as u64), matching
    // libstdc++ std::hash<int>: write_u8/i8/u16/i16/u32/i32/u64/i64/usize/isize
}

pub fn murmur_hash64a(data: &[u8], seed: u64) -> u64;
\`\`\`
Rationale for identity integer hashing: it matches std::hash<int> in libstdc++ and
keeps the port deterministic. It also stresses the hopscotch displacement logic,
so the map MUST cope with heavily clustered hashes (sequential integer keys map to
consecutive buckets) - correctness may not depend on hash quality.

## src/hopscotch/growth.rs
\`\`\`rust
pub const MAX_BUCKET_COUNT: usize;              // (usize::MAX/2 + 1) capped sanely
pub fn round_up_to_power_of_two(n: usize) -> usize;   // 0 -> 0, else next pow2 >= n

#[derive(Clone, Copy, Debug)]
pub struct PowerOfTwoGrowthPolicy { /* private mask + count */ }
impl PowerOfTwoGrowthPolicy {
    pub fn new(min_bucket_count: usize) -> Self;  // rounds up to a power of two; 0 stays 0
    pub fn bucket_for_hash(&self, hash: u64) -> usize;  // 0 when bucket_count()==0
    pub fn bucket_count(&self) -> usize;
    pub fn next_bucket_count(&self) -> usize;     // max(MIN_GROWTH, count*2), panics past MAX
    pub fn clear(&mut self);
}
impl Default for PowerOfTwoGrowthPolicy;          // 0 buckets
\`\`\`

## src/hopscotch/bucket.rs
\`\`\`rust
pub const NEIGHBORHOOD_SIZE: usize = 62;
pub const NEIGHBORHOOD_MASK: u64 = (1u64 << 62) - 1;
pub const OVERFLOW_FLAG: u64 = 1u64 << 62;

pub struct Bucket<K, V> { /* entry: Option<(K,V)>, hash: u64, infos: u64 */ }
impl<K, V> Bucket<K, V> {
    pub fn new() -> Self;
    pub fn is_empty(&self) -> bool;            // no entry stored
    pub fn entry(&self) -> Option<&(K, V)>;
    pub fn entry_mut(&mut self) -> Option<&mut (K, V)>;
    pub fn key(&self) -> Option<&K>;
    pub fn value(&self) -> Option<&V>;
    pub fn value_mut(&mut self) -> Option<&mut V>;
    pub fn hash(&self) -> u64;                 // meaningful only when !is_empty()
    pub fn set_entry(&mut self, key: K, value: V, hash: u64);  // debug_assert!(is_empty())
    pub fn take_entry(&mut self) -> Option<(K, V)>;            // leaves infos untouched
    pub fn replace_value(&mut self, value: V) -> Option<V>;
    pub fn neighborhood(&self) -> u64;         // low 62 bits only
    pub fn has_neighbor(&self, offset: usize) -> bool;
    pub fn set_neighbor(&mut self, offset: usize);
    pub fn clear_neighbor(&mut self, offset: usize);
    pub fn has_overflow(&self) -> bool;
    pub fn set_overflow(&mut self, has_overflow: bool);
    pub fn clear_infos(&mut self);
}
impl<K, V> Default for Bucket<K, V>;
impl<K: Clone, V: Clone> Clone for Bucket<K, V>;
impl<K: fmt::Debug, V: fmt::Debug> fmt::Debug for Bucket<K, V>;
\`\`\`
\`offset\` is always \`< NEIGHBORHOOD_SIZE\`; the setters must debug_assert that.

## src/hopscotch/map.rs
\`\`\`rust
pub struct HopscotchMap<K, V, S = CxxStdHash> { /* private */ }

impl<K: Hash + Eq, V> HopscotchMap<K, V, CxxStdHash> {
    pub fn new() -> Self;                                  // 0 buckets, lazy alloc
    pub fn with_capacity(capacity: usize) -> Self;
}
impl<K: Hash + Eq, V, S: BuildHasher> HopscotchMap<K, V, S> {
    pub fn with_hasher(hash_builder: S) -> Self;
    pub fn with_capacity_and_hasher(capacity: usize, hash_builder: S) -> Self;

    pub fn len(&self) -> usize;
    pub fn size(&self) -> usize;              // C++ spelling, delegates to len()
    pub fn is_empty(&self) -> bool;
    pub fn bucket_count(&self) -> usize;
    pub fn capacity(&self) -> usize;          // floor(bucket_count * max_load_factor)
    pub fn load_factor(&self) -> f32;
    pub fn max_load_factor(&self) -> f32;     // default 0.95
    pub fn set_max_load_factor(&mut self, lf: f32);  // clamped to [0.05, 0.95]
    pub fn overflow_size(&self) -> usize;     // entries in the overflow list

    pub fn clear(&mut self);
    pub fn reserve(&mut self, additional: usize);
    pub fn rehash(&mut self, min_bucket_count: usize);

    /// Mirrors C++ \`map.insert({k, v})\`: inserts only if the key is absent.
    /// Returns true when a new element was inserted, false when the key already
    /// existed (the existing value is left UNCHANGED).
    pub fn insert(&mut self, kv: (K, V)) -> bool;
    pub fn insert_or_assign(&mut self, key: K, value: V) -> Option<V>;  // returns old value

    pub fn get(&self, key: &K) -> Option<&V>;
    pub fn get_mut(&mut self, key: &K) -> Option<&mut V>;
    pub fn get_key_value(&self, key: &K) -> Option<(&K, &V)>;
    pub fn contains_key(&self, key: &K) -> bool;
    pub fn count(&self, key: &K) -> usize;    // C++ spelling: 0 or 1
    pub fn remove(&mut self, key: &K) -> Option<V>;
    pub fn remove_entry(&mut self, key: &K) -> Option<(K, V)>;
    pub fn erase(&mut self, key: &K) -> usize; // C++ spelling: 0 or 1

    pub fn iter(&self) -> Iter<'_, K, V>;
    pub fn iter_mut(&mut self) -> IterMut<'_, K, V>;
    pub fn keys(&self) -> Keys<'_, K, V>;
    pub fn values(&self) -> Values<'_, K, V>;
    pub fn values_mut(&mut self) -> ValuesMut<'_, K, V>;
}

pub struct Iter<'a, K, V>;      // + IterMut, IntoIter, Keys, Values, ValuesMut
// All iterators implement Iterator (+ ExactSizeIterator, FusedIterator) and
// size_hint()/len() must be exact.

impl IntoIterator for HopscotchMap / &HopscotchMap / &mut HopscotchMap
impl Default / Debug / Clone / PartialEq / Eq
impl Extend<(K,V)> / FromIterator<(K,V)>
impl Index<&K> for HopscotchMap   // panics "no entry found for key" like std
\`\`\`

## src/cxx.rs
\`\`\`rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoiError { InvalidArgument, OutOfRange }

/// Faithful \`std::stoi\` replacement (base 10).
pub fn stoi(s: &str) -> Result<i32, StoiError>;

/// Writes the libstdc++ \`terminate\` banner for \`err\` to stderr, then aborts
/// with SIGABRT. Never returns.
pub fn terminate_stoi(err: StoiError) -> !;

/// Reproduces \`std::string(nullptr)\`: std::logic_error
/// "basic_string::_S_construct null not valid", then aborts. Never returns.
pub fn terminate_null_string() -> !;
\`\`\`

# HOPSCOTCH ALGORITHM (normative; the Judge phase may refine details but not the
# public API)

- Bucket array length is \`bucket_count + NEIGHBORHOOD_SIZE - 1\` where
  \`bucket_count\` is a power of two. The extra tail buckets remove the need for
  any modular wrap-around: a home bucket \`i in [0, bucket_count)\` owns the
  neighborhood \`[i, i + NEIGHBORHOOD_SIZE)\`, always in bounds.
- Every element lives EITHER in a bucket within its home bucket's neighborhood
  (with the corresponding neighborhood bit set on the HOME bucket) OR in the
  overflow list, in which case the home bucket's overflow flag is set.
- Lookup(key): h = hash(key); i = bucket_for_hash(h); walk the set bits of
  \`buckets[i].neighborhood()\`; for each offset o compare buckets[i+o] (cheap
  cached-hash check first, then key equality). If not found and
  \`buckets[i].has_overflow()\`, scan the overflow list. Otherwise absent.
- Insert(key, value): if the key exists, return false. Otherwise ensure room
  (grow when \`len + 1 > bucket_count * max_load_factor\`, or when bucket_count
  is 0 - initial growth to 16 buckets). Linear-probe from i for the first empty
  bucket j. Then, while \`j - i >= NEIGHBORHOOD_SIZE\`, hopscotch the hole
  backwards: for \`d\` from \`NEIGHBORHOOD_SIZE - 1\` down to 1, let \`c = j - d\`;
  take \`m = buckets[c].neighborhood() & ((1 << d) - 1)\`; if \`m != 0\`, let
  \`o = m.trailing_zeros()\`, move the entry from \`c + o\` into \`j\`, clear bit
  \`o\` and set bit \`d\` on bucket \`c\`, set \`j = c + o\`, and continue the outer
  loop. If no \`d\` yields a movable entry, the hole cannot be brought close
  enough: fall back (grow-and-retry a bounded number of times, then push to the
  overflow list and set the home bucket's overflow flag).
- Erase: find the element; take its entry; clear the corresponding neighborhood
  bit on the HOME bucket (or remove from the overflow list, clearing the home
  bucket's overflow flag when no overflow element maps to that home bucket any
  more). Decrement len.
- Rehash: build a fresh table with the new bucket_count and re-insert every
  element (buckets first, then overflow entries). Reuse the cached hashes -
  never re-hash the keys - and clear/rebuild all neighborhood infos.

# CORRECTNESS INVARIANTS (must hold after every public mutation)

1. \`len()\` == number of occupied buckets + overflow list length.
2. Every stored element is findable by \`get()\`; \`get()\` on an absent key is None.
3. For every occupied bucket \`b = i + o\`, either bucket \`i\` (the element's home)
   has neighborhood bit \`o\` set, or the element sits in the overflow list.
4. \`o < NEIGHBORHOOD_SIZE\` for every set neighborhood bit.
5. A home bucket's overflow flag is set whenever an overflow-list element hashes
   to it.
6. No duplicate keys anywhere in the table.
7. \`bucket_count()\` is 0 or a power of two; \`buckets.len() == bucket_count +
   NEIGHBORHOOD_SIZE - 1\` when bucket_count > 0.

# HARD CONSTRAINTS

- Edition 2021, must compile on rustc 1.75.0. Do NOT use APIs stabilised after
  1.75 (no \`Option::take_if\`, no \`slice::split_at_checked\`, no \`u64::isqrt\`, ...).
  \`let ... else\`, \`Option::is_some_and\`, \`u64::trailing_zeros\` are all fine.
- \`#![forbid(unsafe_code)]\` at the crate root: NO unsafe anywhere.
- Zero external crates. std only. No dev-dependencies either.
- Must compile with NO warnings from \`cargo build --release\`. Do not silence
  warnings with blanket \`#[allow(dead_code)]\` at crate level; a targeted
  \`#[allow(dead_code)]\` on genuinely-public-API-for-completeness items is fine
  (the library surface is intentionally wider than test1.rs uses).
- Doc comments (\`///\`) on all public items; concise, no filler.
- Unit tests in \`#[cfg(test)] mod tests\` blocks inside each module.
`

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'layout', 'algorithm', 'edgeCases', 'risks'],
  properties: {
    summary: { type: 'string', description: 'One-paragraph summary of the design stance' },
    layout: { type: 'string', description: 'Concrete memory layout / struct fields and why' },
    algorithm: { type: 'string', description: 'Insert/lookup/erase/rehash + displacement in precise pseudocode' },
    edgeCases: {
      type: 'array',
      items: { type: 'string' },
      description: 'Edge cases the design handles and how',
    },
    risks: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ways this design could be got wrong in implementation',
    },
  },
}

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['spec', 'scoring', 'pitfalls'],
  properties: {
    spec: {
      type: 'string',
      description:
        'The single normative implementation spec: exact struct fields, exact pseudocode for insert/lookup/erase/rehash/displacement, growth + overflow policy, iterator strategy. Self-contained; an implementer reads only this.',
    },
    scoring: { type: 'string', description: 'Which design won on which axis and what was grafted from the runners-up' },
    pitfalls: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete implementation pitfalls with the required mitigation',
    },
  },
}

const FILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'publicItems', 'notes'],
  properties: {
    path: { type: 'string' },
    publicItems: { type: 'array', items: { type: 'string' }, description: 'Public signatures actually written' },
    notes: { type: 'string', description: 'Deviations from the contract (if any) and why, plus anything integrators must know' },
  },
}

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cargoBuildClean', 'rustcBuildClean', 'testsPass', 'warnings', 'changesMade', 'remainingProblems'],
  properties: {
    cargoBuildClean: { type: 'boolean' },
    rustcBuildClean: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' } },
    changesMade: { type: 'array', items: { type: 'string' } },
    remainingProblems: { type: 'array', items: { type: 'string' } },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'severity', 'detail', 'repro'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          detail: { type: 'string' },
          repro: { type: 'string', description: 'Concrete inputs/state -> wrong behaviour, or the exact command that shows it' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is NOT a real defect' },
    reasoning: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// Phase 1+2: design panel -> judged normative spec
// ---------------------------------------------------------------------------
phase('Design')

const DESIGN_ANGLES = [
  {
    key: 'fidelity',
    brief: `Optimise for FIDELITY to the classic hopscotch-hashing design (Herlihy/Shavit/Tzafrir) and to
what a mature C++ implementation of it would do: 62-slot neighborhood in a 64-bit info word,
tail-padded bucket array to avoid wrap-around, cached hashes, an overflow list as the last
resort, power-of-two growth, 0.95 max load factor. Be precise about the bit manipulation and
about exactly which bucket owns which neighborhood bit.`,
  },
  {
    key: 'safety',
    brief: `Optimise for SAFE-RUST realisability with #![forbid(unsafe_code)]. The hard part is that
displacement moves entries between buckets while you hold indices, and Rust's borrow checker
forbids two simultaneous &mut into one Vec. Specify exactly how each move is expressed
(take_entry/set_entry pairs, split_at_mut, or index-based swaps) so the implementer never needs
unsafe and never needs to clone K or V. Also specify Drop/Clone/iterator design and how
iterators avoid double-visiting displaced elements.`,
  },
  {
    key: 'edge',
    brief: `Optimise for EDGE-CASE robustness. Enumerate and resolve: bucket_count == 0 (lazy first
allocation), identity-hashed sequential integer keys (worst-case clustering - 62-neighborhood
saturates fast, so displacement failure is COMMON, not exotic), displacement failure ->
grow-and-retry vs overflow list, unbounded rehash recursion, load factor exactly at the
threshold, erase clearing the overflow flag only when no other overflow element shares the home
bucket, reserve/rehash with a smaller count than len, capacity overflow near usize::MAX,
zero-sized V, and duplicate-key insert leaving the old value untouched.`,
  },
]

const designs = await parallel(
  DESIGN_ANGLES.map((a) => () =>
    agent(
      `${CONTRACT}

# YOUR ROLE: design proposal "${a.key}"

${a.brief}

Produce a design proposal for the hopscotch map. This is a DESIGN phase: do not write files,
do not run builds. Think hard about the algorithm, especially the displacement loop and the
worst case of identity-hashed sequential integer keys (test1 inserts keys 0..N, so with
identity hashing the keys land in consecutive buckets - reason concretely about what the
neighborhood bitmaps look like in that case and whether insert stays O(1) amortised).

Return your proposal via the structured schema.`,
      { label: `design:${a.key}`, phase: 'Design', schema: DESIGN_SCHEMA },
    ),
  ),
)

const goodDesigns = designs.filter(Boolean)
log(`${goodDesigns.length}/3 designs returned`)

phase('Judge')

const judged = await agent(
  `${CONTRACT}

# YOUR ROLE: judge + spec synthesiser

Three independent designs for the hopscotch map were produced. Score them on (a) algorithmic
correctness, (b) realisability in safe Rust with no unsafe and no cloning of K/V,
(c) edge-case coverage, especially the identity-hash sequential-key case. Then SYNTHESISE ONE
normative implementation spec: pick the strongest backbone and graft the best ideas from the
others. Resolve every disagreement explicitly - the implementers will follow your spec
literally and must not have to make judgement calls.

Your spec MUST pin down, unambiguously:
- exact struct fields for HopscotchMap (including how the overflow list is stored)
- exact pseudocode for: hash_of, find_bucket, insert, insert_or_assign, get/get_mut,
  remove, rehash/grow, and the displacement ("hopscotch the hole backwards") loop
- how a bucket-to-bucket entry move is written in safe Rust without cloning
- the grow-and-retry policy on displacement failure, with a hard bound so it cannot loop forever
- when an element goes to the overflow list, and exactly when the home bucket's overflow flag
  is cleared on erase
- the iterator strategy (what state it carries, how it covers buckets then overflow, and how
  len()/size_hint() stay exact)

${goodDesigns
  .map((d, i) => `## DESIGN ${i + 1} (${DESIGN_ANGLES[i] ? DESIGN_ANGLES[i].key : 'n/a'})

summary: ${d.summary}

layout: ${d.layout}

algorithm: ${d.algorithm}

edge cases:
${(d.edgeCases || []).map((e) => `- ${e}`).join('\n')}

risks:
${(d.risks || []).map((e) => `- ${e}`).join('\n')}`)
  .join('\n\n---\n\n')}

Return via the structured schema.`,
  { label: 'judge:synthesise-spec', phase: 'Judge', schema: SPEC_SCHEMA, effort: 'high' },
)

const SPEC = judged
  ? `# NORMATIVE IMPLEMENTATION SPEC (follow literally)

${judged.spec}

# IMPLEMENTATION PITFALLS (each has a required mitigation)
${(judged.pitfalls || []).map((p) => `- ${p}`).join('\n')}`
  : '# NORMATIVE SPEC\n(unavailable - follow the CONTRACT above and standard hopscotch hashing)'

log('normative spec synthesised')

// ---------------------------------------------------------------------------
// Phase 3: implement, one agent per file (disjoint paths -> no write conflicts)
// ---------------------------------------------------------------------------
phase('Implement')

const FILES = [
  {
    path: '/output/src/hopscotch/hash.rs',
    label: 'hash.rs',
    brief: `Implement the hasher module. CxxStdHash/CxxStdHasher must make integral writes the
identity (so hash(5i32) == 5) and hash byte sequences with MurmurHash64A, matching libstdc++
_Hash_bytes (seed 0xc70f6907 in libstdc++'s std::hash for strings - use that as the default
seed constant, and expose murmur_hash64a(data, seed) publicly). Use wrapping arithmetic
throughout (mul/xor/shift) so nothing panics in debug builds. Note that std's Hash impl for
str/String calls write(bytes) then write_u8(0xff); handle that gracefully by buffering bytes
written via write() and folding integral writes into the state directly - document the exact
composition rule you choose. Tests: identity for ints, stability/determinism, distinct strings
hash differently, empty input works, and hashing the same value twice via two build_hasher()
calls agrees.`,
  },
  {
    path: '/output/src/hopscotch/growth.rs',
    label: 'growth.rs',
    brief: `Implement the power-of-two growth policy. round_up_to_power_of_two(0) == 0;
bucket_for_hash uses a mask (hash as usize & mask) and returns 0 for a 0-sized table;
next_bucket_count() goes 0 -> 16 (MIN_BUCKET_COUNT) then doubles, and panics with a clear
message past MAX_BUCKET_COUNT. Tests cover 0, 1, 16, 17, powers of two, saturation behaviour,
and that bucket_for_hash always returns < bucket_count.`,
  },
  {
    path: '/output/src/hopscotch/bucket.rs',
    label: 'bucket.rs',
    brief: `Implement Bucket<K,V> exactly as pinned: entry: Option<(K,V)>, cached hash, and a u64
info word whose low 62 bits are the neighborhood bitmap and whose bit 62 is the overflow flag.
Provide the pinned accessors, debug_assert offsets are < NEIGHBORHOOD_SIZE, and make sure
take_entry leaves the info word untouched (the info word belongs to the HOME bucket, not to
the stored entry - document this loudly, it is the single most common source of bugs here).
Manual Clone/Debug impls (do NOT derive - K and V must not need bounds on the struct itself).
Tests: set/clear/has neighbor across the full 0..62 range, bit 62 independence from the
neighborhood mask, set_entry/take_entry round-trip, replace_value, clear_infos.`,
  },
  {
    path: '/output/src/hopscotch/map.rs',
    label: 'map.rs',
    brief: `Implement HopscotchMap<K,V,S> and all iterators exactly as pinned in the contract, following
the normative spec literally. This is the core file - be meticulous about the displacement loop
and about keeping len() and the neighborhood bits in sync on every path (insert, duplicate
insert, insert_or_assign, remove from bucket, remove from overflow, clear, rehash).

Write a THOROUGH #[cfg(test)] mod tests: insert/get/len round-trips; duplicate insert returns
false AND leaves the original value untouched; insert_or_assign overwrites and returns the old
value; remove then re-get; remove of an absent key; the exact test1 workload (keys 0..N with
String values, N in {0,1,2,5,100,1000,5000}) asserting len() == N and that every key maps to
"value{i}"; a randomised-but-deterministic stress test (use a small xorshift/LCG PRNG seeded
by a constant - Date/rand are unavailable) doing thousands of mixed insert/remove/lookup ops
against a std::collections::HashMap oracle and comparing len() plus every lookup; a test that
walks the whole table and asserts every invariant 1-7 from the contract; iterator tests
(count == len, no duplicates, covers overflow entries, ExactSizeIterator::len exact); clear();
reserve()/rehash() preserving all contents; and Clone/PartialEq/FromIterator/Extend/Index.
Add a private debug helper (e.g. \`fn assert_invariants(&self)\` under #[cfg(test)]) used by
the stress tests.`,
  },
  {
    path: '/output/src/cxx.rs',
    label: 'cxx.rs',
    brief: `Implement the C++ runtime-compatibility shims: stoi(), terminate_stoi(),
terminate_null_string(). Match std::stoi byte-for-byte in semantics (see the observed
behaviour table). Operate on bytes (s.as_bytes()) so non-ASCII input cannot panic on char
boundaries. Accumulate into i64 and detect overflow with checked arithmetic, mapping anything
outside i32::MIN..=i32::MAX to OutOfRange; make sure a very long digit run (e.g. 40 digits)
returns OutOfRange rather than wrapping or panicking. The terminate functions must write the
exact banner (two spaces after "what():") to stderr, flush it, then std::process::abort().
Tests for every row of the observed-behaviour table that concerns stoi, plus: "-0", "  +42xyz",
"\\t\\n 13", "2147483647", "-2147483648", "-2147483649", "", "   ", "-", "+", "abc", "0x10",
"00000000000000000005", and a 40-digit number.`,
  },
  {
    path: '/output/src/hopscotch/mod.rs',
    label: 'mod.rs',
    brief: `Write the module hub: a short module-level doc comment (//!) explaining that this is a
from-scratch, std-only hopscotch hash map re-implementing the tsl::hopscotch_map interface used
by test1, declarations \`pub mod bucket; pub mod growth; pub mod hash; pub mod map;\`, and
re-exports \`pub use hash::CxxStdHash; pub use map::HopscotchMap;\` (plus the iterator types).
Keep it minimal - no logic.`,
  },
  {
    path: '/output/test1.rs',
    label: 'test1.rs',
    brief: `Write the entry point. It is the crate root: \`#![forbid(unsafe_code)]\`, the two #[path]
module declarations shown in the contract, and \`fn main()\`. main must mirror the C++ control
flow EXACTLY:

- collect args with std::env::args() into a Vec<String> (the requirement is explicit about
  using std::env::args())
- \`let mut count: i32 = 1;\`
- if args.len() > 1 && args[1] == "--a": if there is no args[2], call
  cxx::terminate_null_string() (this reproduces std::string(nullptr)); otherwise
  count = cxx::stoi(&args[2]) or cxx::terminate_stoi(e) on error
- build \`HopscotchMap<i32, String>\` with new(), then \`for i in 0..count { map.insert((i,
  format!("value{}", i))); }\` - note 0..count with a negative count yields nothing, matching
  the C++ for loop
- \`println!("{}", map.size());\`

Keep it as small and literal as the C++. Add a brief //! comment noting the C++ original and
that stdout is byte-identical. No unit tests in this file.`,
  },
]

const implemented = await parallel(
  FILES.map((f) => () =>
    agent(
      `${CONTRACT}

${SPEC}

# YOUR ROLE: implement exactly ONE file: ${f.path}

${f.brief}

Rules:
- Write ONLY ${f.path}. Other agents are concurrently writing the sibling files listed in the
  layout, so do NOT create, read-then-rewrite, or modify any other file. Do not create
  Cargo.toml (it already exists).
- Assume the sibling files exist and expose EXACTLY the pinned APIs. Depend only on those.
- You cannot compile yet (siblings may not exist). Be rigorous: re-read your own code and
  hand-check every borrow, index, and bit operation before finishing. Getting this right
  without a compiler is the job.
- Target rustc 1.75.0, edition 2021, no unsafe, std only, warning-free.
- Use the Write tool to create the file.

Return the structured summary.`,
      { label: `impl:${f.label}`, phase: 'Implement', schema: FILE_SCHEMA, effort: 'high' },
    ),
  ),
)

log(`${implemented.filter(Boolean).length}/${FILES.length} files written`)

// ---------------------------------------------------------------------------
// Phase 4: integrate - build and fix until clean
// ---------------------------------------------------------------------------
phase('Integrate')

const INTEGRATE_PROMPT = `${CONTRACT}

${SPEC}

# YOUR ROLE: integrator

The module files were written independently by separate agents that could not compile. Your job
is to make the project build cleanly and pass its own tests, WITHOUT weakening the design.

Working directory: /output. Run, in order, and fix everything:

1. \`cd /output && cargo build --release 2>&1 | tail -60\`
2. \`cd /output && cargo test 2>&1 | tail -80\`   (unit tests in every module must pass)
3. \`cd /output && rustc -O test1.rs -o test1 2>&1\`  (the bare-rustc path must also work)
4. Sanity-check behaviour against the reference binary:
   \`for a in "" "--a 0" "--a 1" "--a 2" "--a 5" "--a 100"; do ... done\`
   comparing \`/output/test1 $a\` with \`/workspace/dataset/test1_executable $a\`.

Fix rules, in priority order:
- Prefer fixing the CALLER to match the pinned API over changing a pinned API.
- If two files disagree, the CONTRACT's pinned API wins.
- NEVER fix a failing test by deleting or weakening the test, and never by making the
  assertion vacuous. If a stress test or invariant check fails, the map implementation is
  wrong - fix the implementation. A failing invariant check is a real bug; treat it as one.
- Do not add \`#[allow(...)]\` to hide a real warning; fix the cause. The exception is
  targeted \`#[allow(dead_code)]\` on intentionally-broad public library API that test1 does
  not call.
- No unsafe. No new crates. Keep \`#![forbid(unsafe_code)]\`.

Iterate until \`cargo build --release\` is clean and warning-free, \`cargo test\` fully passes,
\`rustc -O test1.rs -o test1\` succeeds, and the sanity outputs match. Report honestly: if
something still fails, say exactly what.`

let build = await agent(INTEGRATE_PROMPT, {
  label: 'integrate:build-and-fix',
  phase: 'Integrate',
  schema: BUILD_SCHEMA,
  effort: 'high',
})

log(
  build
    ? `integrate: cargo=${build.cargoBuildClean} rustc=${build.rustcBuildClean} tests=${build.testsPass}`
    : 'integrate: agent returned nothing',
)

// A second integration pass if the first did not fully converge.
if (!build || !build.cargoBuildClean || !build.testsPass || !build.rustcBuildClean) {
  log('first integration pass did not converge - running a second pass')
  build = await agent(
    `${INTEGRATE_PROMPT}

# NOTE
A previous integrator pass ended with unresolved problems:
${build ? (build.remainingProblems || []).map((p) => `- ${p}`).join('\n') || '- (none reported, but a gate was still failing)' : '- previous pass produced no report'}

Start by re-running the build and tests yourself to see the CURRENT state, then drive it to
fully clean. Do not trust the previous report; verify.`,
    { label: 'integrate:second-pass', phase: 'Integrate', schema: BUILD_SCHEMA, effort: 'high' },
  )
  log(build ? `second pass: cargo=${build.cargoBuildClean} tests=${build.testsPass}` : 'second pass: no report')
}

// ---------------------------------------------------------------------------
// Phase 5: verify - independent lenses, then adversarial refutation
// ---------------------------------------------------------------------------
phase('Verify')

const VERIFIERS = [
  {
    key: 'differential',
    brief: `DIFFERENTIAL TESTING against the reference C++ binary /workspace/dataset/test1_executable.
Build /output/test1 if it is missing (\`cd /output && cargo build --release && cp
target/release/test1 test1\` or \`rustc -O test1.rs -o test1\`). Then compare the Rust binary and
the C++ binary on a LARGE arg matrix, checking stdout bytes, stderr bytes, and exit status for
each: no args; --a with 0,1,2,3,5,10,63,64,65,100,255,256,1000,4096,10000,65536,100000;
negative values; "  7"; "7abc"; "+3"; "0x10"; "-0"; "00005"; "2147483647" (SKIP actually
running this one - it OOM-kills both binaries; note it instead); "2147483648";
"99999999999999999999"; "abc"; ""; "   "; "-"; "+"; a 40-digit number; --a with no second arg;
--b 5; foo; --a 3 extra junk; and an --a value with a UTF-8 multibyte character.
Use a shell loop that prints a diff verdict per case, and compare stdout with byte-exact
comparison (e.g. \`cmp\`), not visual inspection. Report EVERY divergence as a finding with the
exact command. If everything matches, return an empty findings array.`,
  },
  {
    key: 'invariants',
    brief: `HOPSCOTCH INVARIANT AUDIT. Read /output/src/hopscotch/*.rs and audit the algorithm against
invariants 1-7 in the contract. Focus hardest on: (a) the displacement loop - off-by-one in the
\`d\` range, wrong mask \`(1<<d)-1\`, updating the wrong bucket's info word, forgetting to clear
the old bit or set the new one, and whether \`j - i >= NEIGHBORHOOD_SIZE\` can ever fail to
terminate; (b) probing past the end of the tail-padded array; (c) erase clearing the overflow
flag when another overflow element still shares that home bucket (and NOT clearing it when it
should stay); (d) rehash losing elements or leaving stale info words; (e) len() drifting from
the true element count. Then WRITE A NEW temporary test file (e.g.
/output/src/hopscotch/audit_tests.rs is NOT allowed - instead add \`#[cfg(test)]\` tests into an
existing tests module, or better: create /tmp/audit.rs as a standalone rustc test harness that
\`#[path]\`-includes the modules) that tries hard to BREAK the map: adversarial key sequences
designed to saturate neighborhoods under identity hashing (0..N, strided keys like i*bucket
count, all keys colliding to one home bucket), interleaved insert/remove churn, and forced
overflow-list usage. Run it. Report real failures as findings with the exact repro.`,
  },
  {
    key: 'compliance',
    brief: `REQUIREMENTS-COMPLIANCE CRITIC. Check the deliverable against every stated requirement and
report any violation as a finding:
1. Pure Rust, edition 2021, compiles with rustc AND as a Cargo project.
2. CLI args identical to the C++ binary (same option name --a, same default of 1, same
   positional value), parsed via std::env::args().
3. Logic/precision/formatting identical; println! output byte-for-byte identical to std::cout.
4. ZERO external dependencies - verify Cargo.toml has an empty [dependencies] and no
   [dev-dependencies], and that no file has an \`extern crate\` or a non-std \`use\` root.
   Verify the build works with \`CARGO_NET_OFFLINE=true\`.
5. Complete Cargo project in /output, library code organised into MODULES, entry file at
   /output/test1.rs.
6. Black-box: confirm no C++ library source was copied (the port must be idiomatic Rust, not
   transliterated C++; also confirm the hopscotch-map C++ sources are genuinely absent from
   the machine so nothing could have been copied).
7. An executable was produced (\`/output/test1\` via rustc and/or
   \`/output/target/release/test1\` via cargo). Verify both exist and run.
Also verify: \`cargo build --release\` emits NO warnings, and \`#![forbid(unsafe_code)]\` is
present and no \`unsafe\` appears anywhere (\`grep -rn unsafe /output --include=*.rs\`).
Run the commands - do not assume.`,
  },
  {
    key: 'quality',
    brief: `CODE-QUALITY AND CORRECTNESS REVIEW (read-only reasoning, then targeted experiments).
Read every .rs file under /output. Hunt for: panics reachable from main (unwrap/expect/index
out of range/integer overflow in debug), arithmetic that could overflow on 32-bit or near
usize::MAX, incorrect Eq/Hash usage (e.g. comparing cached hashes without also comparing keys),
iterator invalidation logic errors, ExactSizeIterator::len disagreeing with the real count,
PartialEq that returns true for maps with different contents, Clone that copies stale info
words, Index panic message differing from std's, dead or contradictory code, and anything where
a comment claims behaviour the code does not implement. Also check stoi against the C++ table
row by row by reasoning about the code, and verify format!("value{}", i) matching
"value" + std::to_string(i) for negative i (note: test1 never inserts negative i - confirm
that reasoning). Report findings with concrete repros.`,
  },
]

const verifyResults = await pipeline(
  VERIFIERS,
  (v) =>
    agent(
      `${CONTRACT}

${SPEC}

# YOUR ROLE: verifier "${v.key}"

The Rust port has been implemented in /output. ${v.brief}

You may run any commands you need (cargo, rustc, the two binaries, grep, shell loops). You may
create scratch files under /tmp. Do NOT "fix" the implementation - you are a verifier; report
findings instead. The one exception: you may add or extend #[cfg(test)] tests if that is how you
demonstrate a defect, but never delete or weaken an existing test.

Be precise and honest. An empty findings array is a perfectly good result if the code is
correct - do not invent problems to look thorough. Conversely, do not soften a real defect.`,
      { label: `verify:${v.key}`, phase: 'Verify', schema: FINDINGS_SCHEMA, effort: 'high' },
    ),
  // Each verifier's findings get adversarially refuted as soon as that verifier finishes.
  (res, v) =>
    !res || !res.findings || res.findings.length === 0
      ? []
      : parallel(
          res.findings.map((f) => () =>
            parallel(
              ['correctness', 'reproduce'].map((lens) => () =>
                agent(
                  `${CONTRACT}

# YOUR ROLE: adversarial refuter (${lens} lens)

A verifier reported this alleged defect in the Rust port in /output. Your job is to REFUTE it.
Assume it is wrong until the code proves otherwise. Read the actual code and, where possible,
RUN the repro.

- title: ${f.title}
- file: ${f.file}
- severity: ${f.severity}
- detail: ${f.detail}
- repro: ${f.repro}

${lens === 'correctness'
                    ? 'Lens: reason from the code. Does the claimed defect actually follow from what is written? Is the reporter misreading a guard, a bound, or an invariant that holds elsewhere?'
                    : 'Lens: empirically. Actually run the repro (build if needed, write a scratch test under /tmp). Does the bad behaviour reproduce? If it does not reproduce, it is refuted.'}

Set refuted=true if this is NOT a real defect (including: cosmetic, already handled elsewhere,
unreachable from any public API, or simply does not reproduce). Set refuted=false ONLY if you
independently confirmed a real defect. Default to refuted=true when genuinely uncertain.`,
                  { label: `refute:${lens}:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA },
                ),
              ),
            ).then((votes) => {
              const good = votes.filter(Boolean)
              // Survives only if no refuter refuted it (both lenses must agree it is real).
              const survives = good.length > 0 && good.every((x) => !x.refuted)
              return { ...f, verifier: v.key, survives, votes: good.map((x) => x.reasoning) }
            }),
          ),
        ),
)

const allFindings = verifyResults.flat().filter(Boolean)
const confirmed = allFindings.filter((f) => f.survives)
const dismissed = allFindings.filter((f) => !f.survives)
log(`verify: ${allFindings.length} raised, ${confirmed.length} confirmed, ${dismissed.length} refuted`)

// ---------------------------------------------------------------------------
// Phase 6: repair confirmed defects
// ---------------------------------------------------------------------------
phase('Repair')

let repair = null
if (confirmed.length > 0) {
  repair = await agent(
    `${CONTRACT}

${SPEC}

# YOUR ROLE: repair engineer

Independent verifiers found the defects below in /output, and each survived an adversarial
refutation round (two independent refuters failed to dismiss it). Fix every one properly - fix
the CAUSE, never the test, and never by weakening an assertion or deleting coverage.

${confirmed
      .map(
        (f, i) => `## ${i + 1}. [${f.severity}] ${f.title}  (${f.file}, found by ${f.verifier})

${f.detail}

repro: ${f.repro}

why the refuters could not dismiss it:
${f.votes.map((v) => `- ${v}`).join('\n')}`,
      )
      .join('\n\n')}

After fixing, re-run all gates and make sure they are ALL clean:
- \`cd /output && cargo build --release 2>&1\` (no errors, NO warnings)
- \`cd /output && cargo test 2>&1\` (all pass)
- \`cd /output && rustc -O test1.rs -o test1 2>&1\` (succeeds)
- byte-exact differential check against /workspace/dataset/test1_executable for at least:
  no-args, --a 0, --a 1, --a 2, --a 5, --a 100, --a 1000, --a -1, --a 7abc, --a abc,
  --a 2147483648, --a (missing value), --b 5

Add a regression test for each defect you fixed. Report honestly what you changed and any gate
that is still not clean.`,
    { label: 'repair:fix-confirmed', phase: 'Repair', schema: BUILD_SCHEMA, effort: 'high' },
  )
  log(repair ? `repair: cargo=${repair.cargoBuildClean} tests=${repair.testsPass}` : 'repair: no report')
} else {
  log('no confirmed defects - skipping repair')
}

// ---------------------------------------------------------------------------
// Phase 7: final gate + completeness critic
// ---------------------------------------------------------------------------
phase('Final')

const [finalGate, completeness] = await parallel([
  () =>
    agent(
      `${CONTRACT}

# YOUR ROLE: final gate (authoritative)

Independently establish the CURRENT state of /output. Trust nothing you are told; run everything
yourself.

1. \`cd /output && cargo build --release 2>&1\` - must succeed with ZERO warnings.
2. \`cd /output && cargo test 2>&1 | tail -40\` - every test must pass; report the counts.
3. \`cd /output && rustc -O test1.rs -o test1 2>&1\` - must succeed, producing /output/test1.
4. Byte-exact differential vs /workspace/dataset/test1_executable over the full arg matrix
   (all five documented examples plus the negative/whitespace/garbage/overflow/missing-value
   error cases; compare stdout, stderr and exit code; skip --a 2147483647 which OOM-kills
   both).
5. \`grep -rn "unsafe" /output --include=*.rs\` - only the forbid attribute may match.
6. Confirm \`[dependencies]\` in Cargo.toml is empty and no Cargo.lock references any registry
   package.
7. Confirm the executables exist and run: /output/test1 and /output/target/release/test1.

If any gate fails, FIX IT (properly - cause not symptom), then re-run everything. Report the
final honest state: cargoBuildClean, rustcBuildClean, testsPass, warnings, changesMade,
remainingProblems. remainingProblems must be empty only if you truly verified every gate.`,
      { label: 'final:gate', phase: 'Final', schema: BUILD_SCHEMA, effort: 'high' },
    ),
  () =>
    agent(
      `${CONTRACT}

# YOUR ROLE: completeness critic

Read the delivered project in /output. Ask: what is MISSING or WEAK that nobody checked?
Consider: a requirement asserted but never actually exercised; a public API in the pinned
contract that was silently dropped or stubbed; a module that is a shell; tests that assert
something trivially true; the hopscotch algorithm degenerating into something that is not
actually hopscotch hashing (e.g. everything landing in the overflow list, which would make the
map a linear-scan list - CHECK THIS EMPIRICALLY by inspecting overflow_size() after inserting
0..100000 sequential keys, since identity hashing clusters them); documentation that
contradicts the code; and whether \`cargo test\` coverage actually touches the displacement
path and the overflow path at all.

Write and run a scratch probe under /tmp if that is what it takes to answer the
overflow-degeneration question empirically - that one matters most. A map where
overflow_size() is a large fraction of len() has failed to implement hopscotch hashing even if
its outputs are correct.

Report each gap as a finding. Empty array if genuinely complete.`,
      { label: 'final:completeness', phase: 'Final', schema: FINDINGS_SCHEMA, effort: 'high' },
    ),
])

return {
  designs: goodDesigns.length,
  specSynthesised: !!judged,
  filesWritten: implemented.filter(Boolean).map((f) => f.path),
  implementerNotes: implemented.filter(Boolean).map((f) => ({ path: f.path, notes: f.notes })),
  integrate: build,
  findingsRaised: allFindings.length,
  confirmedFindings: confirmed.map((f) => ({ severity: f.severity, file: f.file, title: f.title, detail: f.detail })),
  refutedFindings: dismissed.map((f) => ({ file: f.file, title: f.title })),
  repair,
  finalGate,
  completenessGaps: completeness ? completeness.findings : null,
}
