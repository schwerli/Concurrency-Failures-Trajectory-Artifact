export const meta = {
  name: 'implement-aflpp',
  description: 'Implement the AFL++ requirement (custom mutator API + MOpt PSO) in the fuzzsim framework',
  phases: [
    { title: 'Modules', detail: 'write aflpp_custom_mutator.py and aflpp_mopt.py in parallel' },
    { title: 'Experiment', detail: 'write and tune fuzzsim/experiments/aflpp_experiment.py' },
    { title: 'Verify', detail: 'adversarial review against the requirement yaml' },
  ],
}

const CONTEXT = `
You are working in the Python repo at /workspace (a deterministic fuzzing-algorithm simulation
framework called \`fuzzsim\`). Read these files FIRST to learn the conventions and APIs you must
build on:

  /workspace/requirements/aflpp.yaml          <- THE REQUIREMENT. Every concept listed must exist.
  /workspace/fuzzsim/afl_fuzzer.py            <- AFL core (AFLFuzzer, QueueEntry, ExecResult, Dictionary,
                                                 havoc_mutate, havoc_stage, _rand_below, _wr16/_wr32/_rd16/_rd32,
                                                 ARITH_MAX, HAVOC_CYCLES, HAVOC_CYCLES_INIT, HAVOC_MIN,
                                                 HAVOC_STACK_POW2, MAP_SIZE)
  /workspace/fuzzsim/aflfast_schedules.py     <- PowerSchedule enum, EnergyComputer, ScheduleInputs, SCHEDULE_ORDER
  /workspace/fuzzsim/aflfast_search.py        <- AFLFastFuzzer, PathFrequencyTracker (subclassing example)
  /workspace/fuzzsim/fairfuzz_mask.py         <- another subclassing example (overriding havoc_stage)
  /workspace/fuzzsim/mutation.py              <- INTERESTING_8/16/32 and basic operators
  /workspace/fuzzsim/experiments/afl_experiment.py   <- INITIAL_SEEDS, DICTIONARY, run_afl, SEED=42, MAX_EXECS=30000
  /workspace/fuzzsim/experiments/aflfast_experiment.py <- experiment style to copy
  /workspace/fuzzsim/targets/crashme.py       <- the target program (30 edges; 26 reachable => 86.7%)

HARD RULES
- Determinism: every random draw must come from a numpy.random.RandomState seeded from an explicit
  seed (42). No time, no global random, no set-iteration-order dependence in anything that affects output.
- Do NOT modify any existing file. Only create the new files you are told to create.
- Match the surrounding code style exactly: module docstring explaining the paper mechanism, typed
  signatures, \`from __future__ import annotations\`, short comments only where they add information,
  constants documented with #: comments.
- Python 3 + numpy only (no third-party deps beyond numpy).
`

const API_CONTRACT = `
PUBLIC API CONTRACT (both modules and the experiment must agree on these EXACT names):

fuzzsim/aflpp_custom_mutator.py
  MAX_FILE (int constant, e.g. 1 << 20)
  class CustomMutator                      # base class, the AFL++ afl-fuzz-mutator.c API
      name: str  (class attribute)
      __init__(self, seed: int = 42)
      init(self, seed: int) -> None
      describe(self) -> str
      fuzz_count(self, buf: bytes) -> int
      fuzz(self, buf: bytes, add_buf: Optional[bytes] = None, max_size: int = MAX_FILE) -> bytes
      havoc_mutation(self, buf: bytes, max_size: int = MAX_FILE) -> bytes
      havoc_mutation_probability(self) -> int          # 0..100
      post_process(self, buf: bytes) -> bytes
      init_trim(self, buf: bytes) -> int               # number of trim steps
      trim(self) -> bytes                              # current trim candidate
      post_trim(self, success: bool) -> int            # next step index
      trim_full(self, buf, oracle) -> bytes            # convenience: run the whole trim loop
      queue_new_entry(self, buf: bytes, coverage) -> None
      queue_get(self, buf: bytes) -> bool
      stats(self) -> Dict[str, Any]
  class MutatorRegistry
      __init__(self, rng: Optional[np.random.RandomState] = None, seed: int = 42)
      register(self, mutator: CustomMutator, weight: float = 1.0) -> None
      unregister(self, name: str) -> bool
      get(self, name: str) -> Optional[CustomMutator]
      names(self) -> List[str]
      weights(self) -> Dict[str, float]
      probabilities(self) -> Dict[str, float]          # weights normalised to sum 1
      select(self, rng=None) -> Optional[CustomMutator] # weighted random choice
      record_success(self, name: str) -> float         # weight *= SUCCESS_FACTOR (1.1)
      record_failure(self, name: str) -> float         # weight *= FAILURE_FACTOR (0.99), floor MIN_WEIGHT (0.1)
      stats(self) -> Dict[str, Any]
      __len__ / __contains__
      module constants: SUCCESS_FACTOR = 1.1, FAILURE_FACTOR = 0.99, MIN_WEIGHT = 0.1
  class GrammarMutator(CustomMutator)      # token templates, structured input generation,
                                           # grammar-aware trim (drop whole tokens, not bytes)
  class CmpLogMutator(CustomMutator)       # CmpLog/RedQueen: record comparison operands seen at
                                           # runtime and substitute them into the buffer to get past
                                           # magic-byte checks. Needs: record_cmp(operand_a, operand_b),
                                           # observe(buf) / colorization, and an operand table.
  class HavocMutator(CustomMutator)        # thin wrapper over AFL's own havoc (a sensible default entry
                                           # in the registry)
  class CustomMutatorFuzzer(AFLFuzzer)     # AFL++ with the custom-mutator stage: overrides havoc_stage
                                           # (or adds a custom stage) to draw a mutator from the registry,
                                           # call fuzz()/havoc_mutation()/post_process(), feed results back
                                           # via record_success/record_failure and queue_new_entry().
                                           # ctor kwarg: registry: Optional[MutatorRegistry] = None
                                           # exposes .registry and extends stats() with mutator info.

fuzzsim/aflpp_mopt.py
  MOPT_OPERATORS: List[str] = ["bit_flip", "byte_flip", "arith_add", "arith_sub",
                               "interesting", "random_byte", "havoc_1", "havoc_2"]
  constants: W_INIT = 0.9, W_END = 0.3, W_NOW/inertia handling, C1 = 1.3, C2 = 1.3,
             V_MIN = -0.3, V_MAX = 0.3, P_MIN = 0.02, P_MAX = 0.50,
             PILOT_PERIOD (L, execs per pilot iteration), SWARM_NUM (e.g. 5), PERIOD_CORE
  class Particle          # one swarm particle: position[], velocity[], pbest_position[], pbest_fitness,
                          # update_velocity(gbest, w, c1, c2, rng), update_position(), clamp helpers,
                          # normalise() so positions form a valid probability distribution in [P_MIN, P_MAX]
  class MOptScheduler     # PSO over the operator probability simplex
      __init__(self, operators=MOPT_OPERATORS, swarm_num=SWARM_NUM, seed=42, pilot_period=..., ...)
      phase: "pilot" | "core"
      select_operator(self, rng=None) -> str        # sample from the current distribution
      record_result(self, operator: str, found_new: bool) -> None
      step(self) -> None                            # advance the schedule; drives pilot->core transition
      pso_update(self) -> None                      # v = w*v + c1*r1*(pbest-x) + c2*r2*(gbest-x); x += v
      fitness(self, ...) -> float                   # new-paths-per-exec of an operator/particle
      gbest / gbest_fitness, personal bests, fitness_history: List[float]
      has_converged(self) -> bool
      probabilities(self) -> Dict[str, float]
      stats(self) -> Dict[str, Any]
  class MOptMutator       # applies one named operator to a buffer (the 8 operators above)
  class MOptFuzzer(AFLFuzzer)   # havoc_stage driven by MOptScheduler.select_operator; feeds
                                # record_result back; ctor kwargs: swarm_num, pilot_period, mode
  class PowerScheduleEnsemble   # rotates through FAST/COE/EXPLORE/QUAD/LINEAR per queue cycle,
                                # using fuzzsim.aflfast_schedules.PowerSchedule + EnergyComputer.
                                # API: __init__(schedules=None, ...), current() -> PowerSchedule,
                                # advance(cycle: int) -> PowerSchedule, energy(alpha, freq, sel) -> float,
                                # history: List[PowerSchedule], stats()
  class AFLPlusPlusFuzzer(MOptFuzzer)  # optional: MOpt + custom mutators + ensemble schedule together
`

phase('Modules')

const modules = await parallel([
  () => agent(`${CONTEXT}\n${API_CONTRACT}\n
YOUR TASK: create ONLY the file /workspace/fuzzsim/aflpp_custom_mutator.py.

Implement the full AFL++ custom mutator API exactly as listed in the contract, plus MutatorRegistry
with dynamic weights, GrammarMutator, CmpLogMutator, HavocMutator and CustomMutatorFuzzer.

Details that matter:
- The trim API must mirror AFL++: init_trim(buf) returns the number of steps, trim() returns the
  current candidate, post_trim(success) advances. GrammarMutator's trim drops whole grammar tokens.
- CmpLogMutator must model RedQueen: an operand table populated by record_cmp(), input-to-state
  substitution that scans the buffer for occurrences of a recorded operand (and of common encodings:
  1/2/4-byte little- and big-endian) and replaces them with the other side of the comparison. It must
  also be able to seed its table from a dictionary of magic values.
- MutatorRegistry.select must be a *weighted* random choice using a numpy RandomState, deterministic.
- CustomMutatorFuzzer must actually improve/behave sensibly on the crashme target: it replaces the
  havoc stage with a custom-mutator stage that (a) picks a mutator by weight, (b) calls fuzz_count()
  to decide the iteration count, (c) calls fuzz(buf, add_buf) where add_buf is another queue entry,
  (d) with probability havoc_mutation_probability() also calls havoc_mutation(), (e) runs
  post_process() before execution, (f) reports success/failure back to the registry and calls
  queue_new_entry() on every new queue entry.
- Do not break determinism: derive every mutator's RandomState from the fuzzer seed.

Verify your work by running, from /workspace:
  python3 -c "from fuzzsim.aflpp_custom_mutator import *; print('ok')"
and a short smoke run of CustomMutatorFuzzer on CrashmeProgram with max_execs=3000, seed=42,
printing stats. Iterate until it is clean. Report the final public API you actually wrote.`,
    {label: 'custom_mutator', phase: 'Modules'}),

  () => agent(`${CONTEXT}\n${API_CONTRACT}\n
YOUR TASK: create ONLY the file /workspace/fuzzsim/aflpp_mopt.py.

Implement MOpt's PSO-based mutation scheduling exactly as listed in the contract, plus
PowerScheduleEnsemble.

Details that matter (from the MOpt paper, Lyu et al., USENIX Sec'19, and AFL++'s afl-fuzz-mopt.c):
- Pilot phase: each swarm tests the operators independently for L executions each, measuring
  fitness = (number of new paths/interesting inputs found) / (number of executions) per operator.
  After the pilot period the best swarm becomes the global best and the scheduler moves to the core phase.
- Core phase: continuous PSO. velocity update v = w*v + c1*r1*(pbest - x) + c2*r2*(gbest - x),
  position update x = x + v, velocity clamped to [V_MIN, V_MAX] = [-0.3, 0.3], probabilities clamped
  to [P_MIN, P_MAX] = [0.02, 0.50] and then normalised so they sum to 1 (renormalisation must respect
  the bounds -- document how you handle a distribution that cannot satisfy both).
- Inertia weight w decays linearly from W_INIT to W_END over the run.
- Track personal bests per particle, a global best, a fitness_history list and a has_converged()
  monitor (e.g. gbest fitness unchanged for N updates, or swarm spread below a threshold).
- MOptMutator applies exactly the 8 named operators to a bytes buffer using numpy RandomState.
- MOptFuzzer subclasses AFLFuzzer and replaces the havoc stage: for each iteration select an operator
  from the scheduler's current distribution, apply it (stacked 2..2^7 times like havoc), execute, and
  report whether it found something new.
- PowerScheduleEnsemble rotates FAST -> COE -> EXPLORE -> QUAD -> LINEAR per queue cycle and computes
  energy through fuzzsim.aflfast_schedules.EnergyComputer.

Verify your work by running, from /workspace:
  python3 -c "from fuzzsim.aflpp_mopt import *; print('ok')"
and a short smoke run of MOptFuzzer on CrashmeProgram with max_execs=3000, seed=42, printing stats
plus the operator probability distribution before/after. Iterate until clean. Report the final
public API you actually wrote.`,
    {label: 'mopt', phase: 'Modules'}),
])

phase('Experiment')

const experiment = await agent(`${CONTEXT}\n${API_CONTRACT}\n
The two modules /workspace/fuzzsim/aflpp_custom_mutator.py and /workspace/fuzzsim/aflpp_mopt.py now
exist. Here is what the authors reported writing:

--- custom mutator module ---
${modules[0] || '(failed)'}

--- mopt module ---
${modules[1] || '(failed)'}

YOUR TASK: create ONLY /workspace/fuzzsim/experiments/aflpp_experiment.py, modelled closely on
/workspace/fuzzsim/experiments/aflfast_experiment.py (argparse with --seed/--max-execs/--verbose,
module docstring documenting precisely what each metric means, a run_* helper per fuzzer, and a
main() that prints the metric lines).

It MUST print exactly these four lines with exactly these values when run as
\`python3 -m fuzzsim.experiments.aflpp_experiment\` from /workspace:

  AFLPP_CUSTOM_MUTATOR_PATHS: 10
  AFLPP_MOPT_PATHS: 10
  AFLPP_MOPT_IMPROVEMENT: 0.0
  AFLPP_TOTAL_COVERAGE: 86.7

Semantics: CUSTOM_MUTATOR_PATHS = queue length after a CustomMutatorFuzzer campaign;
MOPT_PATHS = queue length after a MOptFuzzer campaign; MOPT_IMPROVEMENT = relative edge-coverage
improvement of MOpt over the plain AFL baseline in percent, i.e. (mopt_pct - afl_pct)/afl_pct*100;
TOTAL_COVERAGE = edge coverage percentage of the AFL++ (custom mutator) campaign.
Use SEED = 42 and MAX_EXECS = 30000, the same INITIAL_SEEDS and DICTIONARY as the AFL baseline,
and reuse run_afl from fuzzsim.experiments.afl_experiment for the baseline.

The crashme target has 30 edges of which 26 are reachable => 86.7%. Both fuzzers should saturate at
10 queue entries, so these values are the natural outcome of a correct implementation -- but you must
verify empirically. If they do not come out, DIAGNOSE and FIX the cause in the two module files
(you may edit them; you may NOT edit any pre-existing file, and you may NOT special-case or hardcode
the printed numbers). Run the experiment repeatedly until it prints exactly the four lines above, and
confirm it is byte-for-byte reproducible across two runs.

Also add a --verbose block printing the interesting internals (registry weights, mutator stats,
MOpt phase/probabilities/gbest/convergence, ensemble schedule history, coverage, crashes, execs).

Report: the final printed output, and any changes you made to the two module files.`,
  {label: 'experiment', phase: 'Experiment'})

phase('Verify')

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: {type: 'string'},
          summary: {type: 'string'},
          severity: {type: 'string', enum: ['high', 'medium', 'low']},
          fix: {type: 'string'},
        },
        required: ['file', 'summary', 'severity', 'fix'],
      },
    },
    verdict: {type: 'string'},
  },
  required: ['findings', 'verdict'],
}

const LENSES = [
  {key: 'requirement-coverage', prompt: `Go through /workspace/requirements/aflpp.yaml line by line -- the description AND every entry
under \`concepts\`. For each one, find the concrete code in /workspace/fuzzsim/aflpp_custom_mutator.py,
/workspace/fuzzsim/aflpp_mopt.py and /workspace/fuzzsim/experiments/aflpp_experiment.py that implements
it. Report every concept that is MISSING, or present in name only (a stub, a docstring mention, or a
method that is never actually called from the fuzzing loop). Be specific and harsh.`},
  {key: 'correctness', prompt: `Hunt for real defects in /workspace/fuzzsim/aflpp_custom_mutator.py and /workspace/fuzzsim/aflpp_mopt.py:
wrong PSO equations, velocity/probability clamping that silently breaks the distribution (must stay a
valid distribution summing to 1 with each entry in [0.02, 0.50]), off-by-one in the pilot/core
transition, mutators that can return empty buffers or crash on 1-byte inputs, registry weight floors
not applied, RedQueen substitution that never matches anything, trim loops that don't terminate,
exceptions escaping the fuzzing loop. Write a short python snippet to actually exercise anything you
suspect before reporting it.`},
  {key: 'determinism', prompt: `Verify determinism and integration of the AFL++ work. Run, from /workspace:
  python3 -m fuzzsim.experiments.aflpp_experiment
twice and diff the output. Check every source of nondeterminism in
/workspace/fuzzsim/aflpp_custom_mutator.py and /workspace/fuzzsim/aflpp_mopt.py: iteration over sets or
plain dicts whose order affects results, use of \`random\`/\`time\`/\`id()\`/hash() of str, unseeded
RandomState. Also confirm nothing outside the three new AFL++ files was modified
(\`git status --short\` and \`git diff --stat\`) and that
  python3 -m fuzzsim.experiments.afl_experiment
  python3 -m fuzzsim.experiments.aflfast_experiment
  python3 -m fuzzsim.experiments.fairfuzz_experiment
still print their original values (10/1/10/86.7, 10/10/1.00/198.5, 4/50.0/86.7/0.0).`},
]

const reviews = await parallel(LENSES.map(l => () =>
  agent(`${CONTEXT}\n\nYou are reviewing already-written code. ${l.prompt}\n\nReport findings as structured output.`,
    {label: `review:${l.key}`, phase: 'Verify', schema: REVIEW_SCHEMA})))

const findings = reviews.filter(Boolean).flatMap(r => r.findings || [])

phase('Verify')
let fixReport = 'no findings'
if (findings.length) {
  fixReport = await agent(`${CONTEXT}\n${API_CONTRACT}\n
A review panel raised these findings against the AFL++ implementation:

${JSON.stringify(findings, null, 2)}

YOUR TASK: fix every finding that is real, in /workspace/fuzzsim/aflpp_custom_mutator.py,
/workspace/fuzzsim/aflpp_mopt.py and /workspace/fuzzsim/experiments/aflpp_experiment.py only.
Skip findings that are wrong -- but say why. Do not hardcode metric values anywhere.

After fixing, re-verify from /workspace:
  python3 -m fuzzsim.experiments.aflpp_experiment      (must print 10 / 10 / 0.0 / 86.7, twice identically)
  python3 -m fuzzsim.experiments.afl_experiment        (must still print 10 / 1 / 10 / 86.7)
  python3 -m fuzzsim.experiments.aflfast_experiment    (must still print 10 / 10 / 1.00 / 198.5)
  python3 -m fuzzsim.experiments.fairfuzz_experiment   (must still print 4 / 50.0 / 86.7 / 0.0)
  git status --short                                   (only the 3 new aflpp files may be new/changed)

Report what you fixed, what you skipped and why, and paste the final experiment output.`,
    {label: 'fix', phase: 'Verify'})
}

return {modules, experiment, findings, fixReport}
