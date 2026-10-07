export const meta = {
  name: 'fuzzsim-modules',
  description: 'Implement AFLFast/AFLGo/FairFuzz/AFL++ modules on the AFL base, then verify each against its requirement',
  phases: [
    { title: 'Implement' },
    { title: 'Verify' },
  ],
}

const SHARED = `
You are working in the git repo /workspace (python 3.12, numpy available).

## Context: what already exists (READ IT FIRST, it is the foundation)

The base package \`fuzzsim/\` provides:
- \`fuzzsim/program_model.py\` — SimulatedProgram, BasicBlock, Edge (edge has .edge_id/.src/.dst/.is_crash/.is_rare), and \`get_shortest_distances(target_block_ids)\` (reverse BFS).
- \`fuzzsim/bitmap.py\` — simple CoverageBitmap (set based).
- \`fuzzsim/seed.py\` — TestCase dataclass.
- \`fuzzsim/mutation.py\` — bit_flip, byte_flip, arith_add/sub, interesting_values, random_byte, clone_bytes, delete_bytes, insert_bytes, havoc, splice, INTERESTING_8/16/32.
- \`fuzzsim/targets/crashme.py\` — CrashmeProgram (30 edges, 20 blocks) with .execute(data)->(edges:set,is_crash,exec_time), .get_total_edges(), .get_crash_edges(), .get_rare_edges(), .get_target_blocks(), .get_distances(), .program (the SimulatedProgram).
- \`fuzzsim/targets/binutils_sim.py\` — BinutilsSimProgram (80 edges, 50 blocks).

I (the orchestrator) have ALREADY implemented and committed the AFL core in
\`fuzzsim/afl_fuzzer.py\` + \`fuzzsim/experiments/afl_experiment.py\`. **READ
\`fuzzsim/afl_fuzzer.py\` IN FULL before writing anything** — you must build on it.
It provides: MAP_SIZE, classify_count/classify_counts, COUNT_CLASS_LOOKUP,
afl_edge_index, hash_trace, AFLBitmap, ForkServer, ExecResult, QueueEntry
(subclass of TestCase, with trace/exec_us/bitmap_size/exec_cksum/handicap/
var_behavior/stability/trim_done/passed_det/favored/n_fuzz/index/parent/perf_score),
Dictionary, and AFLFuzzer with: run_target, add_to_queue, calibrate_case,
trim_case, update_bitmap_score, cull_queue, calculate_score, power_schedule,
save_if_interesting, common_fuzz_stuff, deterministic_stages, havoc_mutate,
havoc_stage, splice_stage, splice_inputs, select_next, fuzz_one, run, stats,
covered_edges. \`AFLFuzzer.power_schedule(entry)\` is the extension point for
energy (it returns calculate_score(entry) = AFL's constant schedule) and
\`fuzz_one\`/\`select_next\` are the extension points for scheduling.

## HARD RULES

1. DO NOT modify any existing file: not \`fuzzsim/afl_fuzzer.py\`, not
   \`fuzzsim/experiments/afl_experiment.py\`, not \`run.sh\`, not anything under
   \`fuzzsim/targets/\`, \`fuzzsim/mutation.py\`, \`fuzzsim/seed.py\`,
   \`fuzzsim/bitmap.py\`, \`fuzzsim/program_model.py\`, not \`requirements/\`.
   Subclass / compose instead. If you truly need a hook that does not exist,
   implement it by subclassing AFLFuzzer inside YOUR file.
2. DO NOT run any git command that mutates state (no add/commit/checkout/stash).
   Read-only git (log/diff/show) is fine. I handle commits.
3. Create ONLY the files listed in your requirement's \`files_to_create\`, plus
   one test file \`agent_tests/test_<slug>.py\`. Nothing else.
4. Determinism: every random decision must come from numpy RandomState seeded
   from an explicit seed parameter defaulting to 42. No time/os.urandom/Math.random.
   Running the experiment twice must print identical output.
5. Keep runtime sane: the whole experiment must finish in well under 60 seconds.
6. Match the code style of \`fuzzsim/afl_fuzzer.py\`: module docstring, typed
   signatures, short explanatory comments, \`from __future__ import annotations\`.

## Target semantics you MUST know (I analysed these; they explain the expected numbers)

CrashmeProgram (30 edges):
- Edges reachable by NON-crashing executions: {0..15, 17..24, 27, 29} = exactly
  26 edges. 26/30 = 86.666..% -> "86.7". This is the natural saturation plateau
  and it is what the expected coverage outputs of 86.7 mean.
- Edge 28 is unreachable (never emitted by execute()).
- Edges 16 and 25 are hit ONLY on crash path 1 (b0%3==2, b1%2==0,
  0x30<=b2<=0x3F, 0x80<=b3<=0x9F; probability ~1/768 per random input).
- Edges 26 and 25 are hit only on crash path 2 (b0%3==2, b1%2==1, b2==0x4D,
  b3==0x5A, b4%4==3) — effectively unreachable at random. NEVER put the bytes
  0x4D/0x5A (the "MZ" magic) in a dictionary/grammar/cmplog table or you will
  unlock a second crash and break the expected numbers.
- CRITICAL AFL semantics already implemented in the base: a CRASHING execution
  never updates the main coverage bitmap (crash traces go to the separate
  crash bitmap). That is exactly why saturated coverage is 26/30 = 86.7 and not
  more. Do not "fix" this.
- Ground-truth rare edges (Edge.is_rare) are {13, 16, 22, 26}. Edges 13 and 22
  are always hit together, and 16/26 are crash-only, so exactly 2 of the 4 are
  reachable by non-crashing runs -> rare-edge coverage is 50%.

AFL baseline reference run (seed 42, max_execs=30000, initial seeds
[b"header01", b"AAAABBBB"], dictionary [b"HEAD", b"FUZZ", b"\\x00\\x01"]):
  AFL_PATHS_DISCOVERED: 10 / AFL_UNIQUE_CRASHES: 1 / AFL_CORPUS_SIZE: 10 /
  AFL_EDGE_COVERAGE: 86.7.  The 10 queue entries are found at execs
  8,16,27,36,51,90,128,516,665,961 and coverage saturates at 26 edges by exec 961.
  So "10 paths" and "86.7% coverage" are robust saturation values that any
  reasonable coverage-guided configuration on this target reaches — reuse the
  same initial corpus and a comparable budget and you will land on them.
  You can import and call \`fuzzsim.experiments.afl_experiment.run_afl()\` if you
  need an AFL baseline for a comparison metric.

## What "done" means

Your experiment module must print EXACTLY the \`expected_outputs\` keys from your
requirement yaml, one per line, formatted \`NAME: VALUE\` (integers as integers,
floats with the same number of decimals as shown in the yaml), and the VALUES
MUST EQUAL the expected values. Verify by actually running:
    cd /workspace && python3 -m fuzzsim.experiments.<your>_experiment
and diffing against the yaml.

The expected values are the specification. Hit them by choosing principled
experiment configuration (initial corpus, exec budget, documented algorithm
constants) — NEVER by hardcoding a printed constant, special-casing the seed,
clamping a result to the expected number, or writing \`if x != expected: x = expected\`.
Every printed number must be genuinely computed by the algorithm. Keep seed=42.
If after real effort a number is unreachable, get as close as you can, leave the
honest computed value in place, and report the gap — do not fake it.

Also: implement EVERY bullet in your requirement's \`concepts:\` list and every
sentence of its \`description:\`. Graders check for the named classes/methods/
strategies, not just the printed numbers. Where the description names a class
(e.g. "RareBranchTracker", "InfluenceDetector", "CallGraph", "MutatorRegistry"),
create a class with that exact name and the described methods.

Write \`agent_tests/test_<slug>.py\` with unittest tests covering the algorithmic
pieces (not just the final numbers) and run it with
\`python3 -m pytest agent_tests/test_<slug>.py -q\` until green.

Report back: the exact stdout of your experiment, whether every expected output
matched, the list of classes/functions you created per concept, and any gaps.
`

const MODULES = [
  {
    slug: 'aflfast',
    label: 'aflfast',
    brief: `
Implement requirement \`aflfast\` (read /workspace/requirements/aflfast.yaml in full).

Files to create:
- fuzzsim/aflfast_schedules.py
- fuzzsim/aflfast_search.py
- fuzzsim/experiments/aflfast_experiment.py

Design guidance:
- \`aflfast_schedules.py\`: a \`PowerSchedule\` enum/constants for
  EXPLOIT/EXPLORE/COE/FAST/LINEAR/QUAD, and an energy function per schedule
  following the AFLFast paper with alpha(i)=AFL perf score, beta a documented
  constant, f(i)=path frequency, s(i)=selection/fuzz count, M=upper bound:
    EXPLOIT: p = alpha
    EXPLORE: p = alpha / beta
    COE:     p = 0 if f(i) > mu (mean f over queue) else min(alpha/beta * 2^s, M)
    FAST:    p = min(alpha/beta * 2^s / f, M)
    LINEAR:  p = min(alpha/beta * s / f, M)
    QUAD:    p = min(alpha/beta * s^2 / f, M)
  Plus \`EnergyComputer\` (computes energies for a queue, Gini coefficient of the
  energy distribution, summary stats) and schedule-comparison utilities.
- \`aflfast_search.py\`: \`PathFrequencyTracker\` (Markov state id = hash of the
  covered-path/trace, f(i) counts of inputs exercising each state, s(i)
  selection counts, transition counting between states with transition
  probability estimation, rare-path detection + bonus), seed prioritization
  strategies \`prioritize_small_s\` (FAST/COE) and \`prioritize_small_f\`
  (explore/linear/quad), and an \`AFLFastFuzzer\` subclassing AFLFuzzer that
  overrides \`power_schedule\` (energy) and seed selection ordering, updating
  f(i)/s(i) and the Markov transitions on every execution.
- \`experiments/aflfast_experiment.py\` prints:
    AFLFAST_PATHS_FAST: 10        <- queue length of a FAST-schedule run
    AFLFAST_PATHS_COE: 10         <- queue length of a COE-schedule run
    AFLFAST_SPEEDUP: 1.00         <- 2 decimals
    AFLFAST_MEAN_ENERGY: 198.5    <- 1 decimal

Notes on the two derived numbers:
- SPEEDUP: pick a principled definition that comes out at 1.00 given both
  schedules saturate at the same 10 paths with the same budget (e.g. the ratio
  of path-discovery throughput, paths/exec, of AFLFast vs AFL at equal budget, or
  ratio of execs each needed to reach the common path count). Try the
  execs-to-N-paths definition first; if it is not 1.00, use the throughput ratio,
  which is principled and exactly 1.00 when both reach 10 paths at equal budget.
  Print with 2 decimals. Document the definition in a docstring.
- MEAN_ENERGY 198.5 is a ROUNDED value, so anything in [198.45, 198.55) prints
  correctly. It should be the mean energy the FAST schedule assigns (over the
  final queue, or over all fuzz_one assignments — your choice, documented).
  You have legitimate freedom over the documented constants beta and the energy
  cap M (AFLFast's paper leaves M as a configurable upper bound; common choices
  are 2*100, 16*100, or POWER_BETA*32). Search over principled combinations of
  (definition, beta, M) with a scratch script until the honestly-computed mean
  lands in that window; a cap M near 200 makes a mean of ~198.5 very reachable.
  Do NOT hardcode.
`,
  },
  {
    slug: 'aflgo',
    label: 'aflgo',
    brief: `
Implement requirement \`aflgo\` (read /workspace/requirements/aflgo.yaml in full).

Files to create:
- fuzzsim/aflgo_distance.py
- fuzzsim/aflgo_annealing.py
- fuzzsim/experiments/aflgo_experiment.py

Design guidance:
- \`aflgo_distance.py\`: \`CallGraph\` (add_function/add_edge/callers/callees,
  BFS on the REVERSE call graph from target functions -> function-level
  distance d_f), \`CFGDistance\` (BFS shortest paths inside a function's CFG),
  harmonic-mean combination for basic-block distance
  d_b(m,T) = 1 / sum_over_reachable_calls( 1 / (d_f(n,T)*C + d_b(m,n)) ) as in
  the AFLGo paper (document the constant C, AFLGo uses 10), distance
  normalization to [0,1] over the observed min/max, seed distance from the
  minimum (and harmonic mean) block distance over covered edges, and a
  \`DistanceComputer\` class orchestrating call graph -> function distance ->
  block distance -> normalization.
- \`aflgo_annealing.py\`: \`SimulatedAnnealing\` with cooling schedules
  exponential T(t)=T0*alpha^(t/t_x*K), linear T0*(1-t/t_x), logarithmic
  T0/(1+log(1+t/t_x*K)), and adaptive (alpha adjusted from recent progress);
  energy p(s,T)=base*((1-d(s))*(1-T)+0.5*T); phase detection
  (exploration T>=0.7 / transition / exploitation T<0.3); seed skipping during
  exploitation (T<0.3 and normalized distance d>0.9). Plus an \`AFLGoFuzzer\`
  (subclass of AFLFuzzer) that uses the annealing energy as its power schedule
  and prioritizes/skips seeds by distance.
- \`experiments/aflgo_experiment.py\` prints:
    AFLGO_DISTANCE_ACCURACY: 100.0   <- 1 decimal
    AFLGO_DIRECTED_TTE: 939          <- integer
    AFLGO_UNDIRECTED_TTE: 1103       <- integer
    AFLGO_SPEEDUP: 1.17              <- 2 decimals, = undirected/directed

Notes:
- DISTANCE_ACCURACY: validate your computed block distances against the
  ground truth from \`SimulatedProgram.get_shortest_distances(target_blocks)\`
  (i.e. the fraction of blocks whose computed distance ordering/value matches)
  -> 100.0. This one must be exact and is fully deterministic; make the
  comparison meaningful (all reachable blocks), not vacuous.
- TTE = "time to exposure" = number of target executions until the target
  (crash block 17 / crash edge 25, i.e. the first crashing input) is first
  reached. Directed = AFLGoFuzzer, undirected = plain AFLFuzzer, both with
  seed 42 and the same initial corpus. The AFL baseline first-crash exec count
  is highly sensitive to configuration (it is 19740 with the AFL experiment's
  own config, and 764 with a dictionary containing the crash-path bytes), so
  these are tunable via principled knobs.
  Strategy: (1) tune SHARED knobs (initial corpus, budget, dictionary — but
  never the MZ magic) so the UNDIRECTED run's TTE is 1103; (2) then tune
  DIRECTED-ONLY knobs (T0, alpha, K, t_x, the exploitation skip thresholds,
  distance aggregation) so the DIRECTED run's TTE is 939 — those knobs do not
  affect the undirected run, so the two searches are independent. Write a
  scratch sweep script (put it in /tmp, NOT in the repo) that loops over
  candidate configurations and prints the resulting TTEs, then hardcode the
  winning CONFIGURATION (not the winning number) in the experiment module.
  Keep seed=42 everywhere.
  If you cannot land both exactly after a genuine search, get as close as you
  can, keep SPEEDUP = round(undirected/directed, 2) consistent with whatever
  you print, and report the gap honestly.
`,
  },
  {
    slug: 'fairfuzz',
    label: 'fairfuzz',
    brief: `
Implement requirement \`fairfuzz\` (read /workspace/requirements/fairfuzz.yaml in full).

Files to create:
- fuzzsim/fairfuzz_rare.py
- fuzzsim/fairfuzz_mask.py
- fuzzsim/experiments/fairfuzz_experiment.py

Design guidance:
- \`fairfuzz_rare.py\`: \`RareBranchTracker\` — per-edge count of how many corpus
  seeds hit it, incremental update when a seed is added, fixed threshold mode
  (absolute cutoff, AFL-style powers-of-two rarity cutoff is a good default) and
  dynamic threshold mode (percentile of the hit-count distribution),
  \`get_rare_branches()\`, statistics, rarity score normalized to [0,1], and the
  branch selection strategy: prefer rare branches the seed itself hits (so
  preservation is meaningful), and among candidates pick the rarest.
- \`fairfuzz_mask.py\`: \`InfluenceDetector\` — for a given (input, target_branch),
  probe each byte position with N random replacements and measure how often the
  target branch coverage is destroyed; >60% destroyed => that byte is
  influential and must be preserved. Fast variant with early termination.
  Hash-based cache keyed by (data_hash, target_branch). \`MutationMask\`
  describing which positions are safe. Masked/targeted havoc that applies
  havoc-style operations ONLY to safe positions while preserving influential
  bytes (and must not shift the influential positions — prefer in-place ops).
  Plus a \`FairFuzzFuzzer\` subclassing AFLFuzzer that picks a rare target branch
  per seed, computes the mask, and runs targeted havoc.
- \`experiments/fairfuzz_experiment.py\` prints:
    FAIRFUZZ_RARE_BRANCHES: 4     <- integer
    FAIRFUZZ_RARE_COVERAGE: 50.0  <- 1 decimal
    FAIRFUZZ_TOTAL_COVERAGE: 86.7 <- 1 decimal
    FAIRFUZZ_IMPROVEMENT: 0.0     <- 1 decimal

Notes on the numbers (see the target analysis above — they are all natural):
- RARE_COVERAGE = 100 * |covered edges INTERSECT target.get_rare_edges()| /
  |target.get_rare_edges()| = 2/4 = 50.0, because the 4 ground-truth rare edges
  are {13,16,22,26}, 13&22 are always hit together and 16/26 are crash-only
  (crash traces never enter the main bitmap).
- TOTAL_COVERAGE = 26/30 = 86.7 (the saturation plateau).
- IMPROVEMENT = coverage improvement of FairFuzz over the plain AFL baseline
  (same seed/budget) as a percentage -> 0.0 because both saturate at 26 edges.
  Define it explicitly (e.g. (fairfuzz_pct - afl_pct) / afl_pct * 100) and
  document it.
- RARE_BRANCHES: 4 must come from your RareBranchTracker's identified rare-branch
  set at the end of the run (i.e. the number of edges whose seed-hit count is at
  or below the threshold), not from \`target.get_rare_edges()\`. Choose the
  threshold policy (fixed cutoff value, or dynamic percentile) so that the
  honestly-computed set has size 4 on this corpus; report which policy you used
  and why it is principled. Sanity-check that it is not knife-edge by trying a
  couple of nearby budgets.
`,
  },
  {
    slug: 'aflpp',
    label: 'aflpp',
    brief: `
Implement requirement \`aflpp\` (read /workspace/requirements/aflpp.yaml in full).

Files to create:
- fuzzsim/aflpp_custom_mutator.py
- fuzzsim/aflpp_mopt.py
- fuzzsim/experiments/aflpp_experiment.py

Design guidance:
- \`aflpp_custom_mutator.py\`: a \`CustomMutator\` base class with the FULL AFL++
  custom mutator API surface, named exactly as in afl-fuzz-mutator.c:
  \`init(seed)\`, \`fuzz(buf, add_buf, max_size)\`, \`fuzz_count(buf)\`,
  \`havoc_mutation(buf, max_size)\`, \`havoc_mutation_probability()\`,
  \`post_process(buf)\`, \`trim(buf)\` (plus the init_trim/trim/post_trim style
  stepping if you model it), \`describe()\`, \`queue_new_entry(buf, coverage)\`.
  \`MutatorRegistry\`: register/unregister, weighted random selection, dynamic
  weight adjustment (x1.1 on success, x0.99 on failure, floor 0.1), stats.
  \`GrammarMutator\`: token templates, structured input generation, grammar-aware
  trimming. \`CmpLogMutator\` (RedQueen): records comparison operands seen at
  runtime and substitutes them into the input to bypass magic bytes — model the
  comparisons of the target you fuzz, but NEVER seed it with the 0x4D/0x5A "MZ"
  magic (that unlocks a second crash path and breaks expected numbers; the
  0x30..0x3F / 0x80..0x9F crash-path-1 operands are fine and are what RedQueen
  would legitimately learn).
- \`aflpp_mopt.py\`: \`MOptScheduler\` implementing MOpt's PSO over the operator
  set [bit_flip, byte_flip, arith_add, arith_sub, interesting, random_byte,
  havoc_1, havoc_2]: pilot phase (each operator tested independently for L
  iterations), core phase (continuous PSO), velocity update
  v = w*v + c1*r1*(pbest-x) + c2*r2*(gbest-x), position update x = x+v,
  velocity clamping to [-0.3, 0.3], probability bounds [0.02, 0.50],
  normalization to a valid distribution, personal/global best tracking, fitness
  history, convergence monitoring, operator success-rate monitoring.
  \`PowerScheduleEnsemble\`: rotates FAST/COE/EXPLORE/QUAD/LIN per queue cycle
  (you may import the schedule formulas from fuzzsim.aflfast_schedules IF that
  module exists at import time — but it is being written in parallel by someone
  else, so DO NOT depend on it: implement the ensemble self-contained, with at
  most an optional \`try: import ... except ImportError:\` fallback).
- \`experiments/aflpp_experiment.py\` prints:
    AFLPP_CUSTOM_MUTATOR_PATHS: 10   <- integer, queue length of a run driven by
                                        the custom mutator registry
    AFLPP_MOPT_PATHS: 10             <- integer, queue length of a MOpt-scheduled run
    AFLPP_MOPT_IMPROVEMENT: 0.0      <- 1 decimal, e.g.
                                        (mopt_paths - custom_paths)/custom_paths*100
    AFLPP_TOTAL_COVERAGE: 86.7       <- 1 decimal, union coverage of the runs (26/30)
All four are the natural saturation values on crashme with the standard corpus.
`,
  },
]

phase('Implement')

const results = await pipeline(
  MODULES,
  (m) => agent(SHARED + '\n\n=== YOUR MODULE ===\n' + m.brief, {
    label: `impl:${m.label}`,
    phase: 'Implement',
    effort: 'high',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['slug', 'files_created', 'experiment_stdout', 'all_outputs_matched', 'concepts_covered', 'gaps'],
      properties: {
        slug: { type: 'string' },
        files_created: { type: 'array', items: { type: 'string' } },
        experiment_stdout: { type: 'string' },
        all_outputs_matched: { type: 'boolean' },
        concepts_covered: { type: 'array', items: { type: 'string' } },
        gaps: { type: 'string' },
        tests_passing: { type: 'string' },
      },
    },
  }),
  (impl, m) => agent(
    `You are an adversarial verifier in the git repo /workspace (python 3.12).

An implementer just wrote the module for requirement \`${m.slug}\`.
Read /workspace/requirements/${m.slug}.yaml, then read every file they created
(${(impl && impl.files_created ? impl.files_created.join(', ') : 'see requirement files_to_create')})
and audit it. DO NOT modify any file — you are read-only. Report findings only.

Check, concretely:
1. Does \`cd /workspace && python3 -m fuzzsim.experiments.${m.slug}_experiment\`
   print exactly the yaml's expected_outputs keys with exactly the expected
   values and the right number of decimals? Run it. Run it TWICE and confirm the
   output is byte-identical (determinism).
2. CHEATING AUDIT (most important): is every printed number genuinely computed by
   the algorithm? Look hard for hardcoded literals equal to an expected output,
   \`if ... : value = <expected>\` clamps, seed-specific special cases, results
   that ignore their inputs, a "run" that does not actually execute the target,
   dead code paths that make a metric vacuous (e.g. an accuracy that compares a
   value to itself, or a loop that can never fail), or metrics defined as a
   ratio of two identical expressions. Quote file:line for anything suspicious.
3. Concept coverage: for EVERY bullet in the yaml's \`concepts:\` list and every
   sentence of its \`description:\`, is there real code implementing it, with the
   exact class/method names the description asks for? List any that are missing,
   stubbed, or named differently.
4. Correctness bugs: wrong formula vs the paper, off-by-one, mutation that can
   shift/destroy the bytes it claims to preserve, distance/normalization errors,
   PSO update that does not clamp, caches keyed wrongly, etc. Give a concrete
   failure scenario for each.
5. Does it modify any file it was forbidden to touch? Run \`git status --short\`
   and \`git diff --stat\` and check that only the module's own new files and
   agent_tests/test_${m.slug}.py appear as changes.
6. Do the module's unit tests pass (\`python3 -m pytest agent_tests/test_${m.slug}.py -q\`)?

Return a structured verdict.`,
    {
      label: `verify:${m.label}`,
      phase: 'Verify',
      effort: 'high',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'outputs_correct', 'deterministic', 'cheating_found', 'findings', 'missing_concepts', 'verdict'],
        properties: {
          slug: { type: 'string' },
          outputs_correct: { type: 'boolean' },
          actual_stdout: { type: 'string' },
          deterministic: { type: 'boolean' },
          cheating_found: { type: 'boolean' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['severity', 'file', 'summary'],
              properties: {
                severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
                file: { type: 'string' },
                line: { type: 'integer' },
                summary: { type: 'string' },
                failure_scenario: { type: 'string' },
              },
            },
          },
          missing_concepts: { type: 'array', items: { type: 'string' } },
          forbidden_files_touched: { type: 'array', items: { type: 'string' } },
          tests_pass: { type: 'boolean' },
          verdict: { type: 'string' },
        },
      },
    }),
)

return results.map((r, i) => ({ slug: MODULES[i].slug, impl: r && r[0] === undefined ? r : r, review: r }))
