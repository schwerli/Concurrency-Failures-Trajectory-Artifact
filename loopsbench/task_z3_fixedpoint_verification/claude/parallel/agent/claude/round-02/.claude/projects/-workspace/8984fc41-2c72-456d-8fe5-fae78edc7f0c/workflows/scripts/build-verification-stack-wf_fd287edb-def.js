export const meta = {
  name: 'build-verification-stack',
  description: 'Implement the five Z3 verification-toolbox layers in parallel, each self-tested',
  phases: [
    { title: 'Implement' },
    { title: 'SelfCheck' },
  ],
}

const COMMON = `
## Shared environment facts (already verified by the orchestrator — trust these)
- Working directory is /workspace. Always run python from there: \`cd /workspace && python3 ...\`.
- Python 3.12.3, \`import z3\` works, z3 python package reports version (5,0,0,0).
- IMPORTANT: this z3 has **NO interpolation API**: \`z3.binary_interpolant\`, \`z3.tree_interpolant\`,
  \`z3.Interpolant\` all DO NOT EXIST. Any interpolation must be implemented manually
  (quantifier elimination via \`z3.Tactic('qe')\` on \`Exists([local_vars], A)\` yields a valid
  Craig interpolant for linear integer arithmetic — verified working).
- \`z3.Fixedpoint\` has: add, add_cover, add_rule, declare_var, fact, get_answer,
  get_ground_sat_answer, get_num_levels, get_rule_names_along_trace, get_rules,
  get_rules_along_trace, parse_file, parse_string, query, register_relation, rule, set,
  set_predicate_representation, statistics, to_string, update_rule.
- \`fp.set(engine='spacer')\` + \`fp.parse_file(path)\` returns a list of query expressions;
  \`fp.query(qs[0])\` returns z3.unsat (SAFE) or z3.sat (UNSAFE). Verified on all 5 benchmarks:
  counter_safe=unsat, counter_unsafe=sat, two_var_safe=unsat, bakery_mutex=unsat,
  double_counter_unsafe=sat.
- After an \`unsat\` spacer query, \`fp.get_answer()\` returns the inductive invariant as an
  expression like \`And(Error == ..., ForAll(A, Inv(A) == Not(A >= 11)))\`.
- After a \`sat\` spacer query, \`fp.get_answer()\` returns a resolution proof term whose
  \`hyper-res(...)\` children contain the ground derived facts of the trace, e.g.
  \`Inv(0), Inv(3), Inv(6), Inv(9), Inv(12)\`. \`fp.get_ground_sat_answer()\` returned \`False\`
  (useless) in that configuration, so walk \`get_answer()\` recursively instead:
  collect application nodes whose decl is the relation you care about and whose args are all
  numerals, in derivation order. Always wrap this in try/except and fall back to a concrete
  bounded-model-checking (BMC) unrolling with a plain z3.Solver to build the trace.
- The framework package already exists and must be used:
  \`from framework import report_result, Graph, PETERSEN_GRAPH, DIAMOND_DAG, CYCLIC_GRAPH_6, TransitionSystem\`
  \`report_result(name, value)\` prints \`f"{name}: {value}"\` and flushes.

## Non-negotiable rules
- DO NOT modify or create /workspace/run.sh — the orchestrator owns it.
- DO NOT modify anything under /workspace/framework/, /workspace/benchmarks/,
  /workspace/requirements/ or /workspace/requirement_patches/.
- DO NOT create/modify /workspace/verification/__init__.py or
  /workspace/verification/experiments/__init__.py — they already exist.
- Only create/edit the files listed in YOUR spec below. Other agents are editing other files
  concurrently; touching theirs will corrupt the build.
- Code quality matters: real docstrings, idiomatic Python matching the existing
  framework style (simple, readable, module docstring at top). No placeholder/TODO code.
- Every public function must be robust: never raise on the experiment path, deterministic
  output, and the whole module's experiment run must finish in well under 60 seconds.
- Print metrics with EXACTLY the key names given, one per line, via report_result.
- You MUST actually run your code and confirm the printed values before finishing.
`;

const SPECS = [
  {
    key: 'z3',
    label: 'smt_solver',
    files: 'smt_solver/__init__.py, smt_solver/__main__.py',
    spec: `
# Requirement: z3 — SMT Constraint Solving Toolkit  (files: smt_solver/__init__.py, smt_solver/__main__.py)

Implement in \`smt_solver/__init__.py\`:

### 1. \`count_nqueens_solutions(n)\` -> int
Counts ALL solutions of N-Queens with Z3.
- Integer variables q_0..q_{n-1} = column of the queen in row i.
- Constraints: 0 <= q_i < n; all columns distinct; no shared diagonal, i.e. for i<j
  \`Abs(q_i - q_j) != abs(i - j)\` (encode as \`And(q_i - q_j != i-j, q_i - q_j != j-i)\`).
- Enumerate every model by adding a blocking clause \`Or(q_i != model_value_i, ...)\` after each
  solution, until unsat. Return the count.
- n=8 MUST return 92. Also sanity-check n=1 -> 1, n=2 -> 0, n=3 -> 0, n=4 -> 2, n=6 -> 4.

### 2. \`chromatic_number(graph)\` -> int
Minimum proper vertex colouring number of a \`framework.Graph\`.
- Try k = 1, 2, 3, ... For each k make an Int color var per node constrained to [0,k),
  and add \`color[u] != color[v]\` for each edge. Return the first k that is sat.
- Handle the degenerate cases: a graph with no nodes -> 0; a graph with nodes but no edges -> 1.
- Guard the loop with an upper bound of the node count so it always terminates.
- PETERSEN_GRAPH MUST return 3.

### 3. \`schedule_jobs(jobs, num_machines)\` -> int
Minimise makespan with \`z3.Optimize\`.
- \`jobs\` is a list of \`(job_id, duration)\` pairs.
- Per job: Int start >= 0, end = start + duration, Int machine in [0, num_machines).
- Non-overlap: for each pair of jobs i<j, \`Implies(machine_i == machine_j,
  Or(end_i <= start_j, end_j <= start_i))\`.
- makespan Int with \`makespan >= end_i\` for all i; \`opt.minimize(makespan)\`; return its value
  as a Python int.
- Empty job list -> 0. num_machines <= 0 should be treated as 1.
- \`[("A",3),("B",5),("C",2),("D",4),("E",6),("F",1)]\` on 3 machines MUST return 7.

### 4. \`run_z3_experiments()\`
Runs the three experiments and reports, in this order and with these EXACT keys:
- \`Z3_NQUEENS_8_SOLUTIONS\`  (value 92)
- \`Z3_PETERSEN_CHROMATIC\`   (value 3)
- \`Z3_SCHEDULE_MAKESPAN\`    (value 7)
Use \`report_result\` imported from \`framework\`. Return a dict of the values as well so other
layers/tests can reuse it.

### 5. \`smt_solver/__main__.py\`
Two-line module that calls \`run_z3_experiments()\` under \`if __name__ == "__main__":\`,
so that \`cd /workspace && python3 -m smt_solver\` prints the three KEY: VALUE lines.

Export a sensible \`__all__\`.

### Verify before finishing
Run \`cd /workspace && python3 -m smt_solver\` and confirm exactly:
\`\`\`
Z3_NQUEENS_8_SOLUTIONS: 92
Z3_PETERSEN_CHROMATIC: 3
Z3_SCHEDULE_MAKESPAN: 7
\`\`\`
Also run the small-n N-Queens sanity checks listed above.
`,
  },
  {
    key: 'uz_fixedpoint',
    label: 'fixedpoint',
    files: 'fixedpoint/__init__.py, fixedpoint/__main__.py',
    spec: `
# Requirement: uz_fixedpoint — Fixedpoint/Datalog engine  (files: fixedpoint/__init__.py, fixedpoint/__main__.py)

Implement in \`fixedpoint/__init__.py\`:

### 1. \`count_reachable_pairs(graph)\` -> int
Transitive closure via Z3 Fixedpoint with the **datalog** engine.
- \`fp = z3.Fixedpoint(); fp.set(engine='datalog')\`
- Sort \`z3.BitVecSort(8)\`; relations \`edge(a,b)\` and \`path(a,b)\`; \`fp.register_relation(edge, path)\`
- Declare BitVec vars a,b,c with \`fp.declare_var(a,b,c)\`
- Rules: \`fp.rule(path(a,b), [edge(a,b)])\` and \`fp.rule(path(a,c), [edge(a,b), path(b,c)])\`
- Facts: for each graph edge \`fp.fact(edge(BitVecVal(u,8), BitVecVal(v,8)))\`. If the graph is
  **undirected** (\`graph.directed is False\`) add both directions.
- Count all ordered pairs (u,v) with u != v where \`fp.query(path(u,v))\` is \`z3.sat\`.
- This exact recipe was verified by the orchestrator to return **26** for DIAMOND_DAG.
- Map node labels to 0..n-1 indices so non-integer node labels also work.

### 2. \`check_horn_safety(smt2_file)\` -> int  (1 = safe, 0 = unsafe)
- \`fp = z3.Fixedpoint(); fp.set(engine='spacer')\`; \`queries = fp.parse_file(path)\`
- Query each returned query; the system is safe (return 1) only if EVERY query is \`z3.unsat\`.
  Any \`sat\` -> return 0. Unknown / exception -> return 0.
- Accept a path relative to the repo root as well as absolute.

### 3. \`analyze_reaching_definitions(num_vars, assignments)\` -> int
Datalog reaching-definitions.
- \`assignments\` is a list of \`(point, var, deps)\` tuples.
- Relations over BitVecSort(8): \`defines(p,v)\`, \`reaches(p,v)\`, \`flows_to(p,q)\`.
- Rules: \`reaches(p,v) :- defines(p,v)\` and \`reaches(q,v) :- flows_to(p,q), reaches(p,v)\`.
- Facts: \`defines(point, var)\` for each assignment; sequential control flow
  \`flows_to(p, p+1)\` for p in 0..num_points-2, where num_points is
  \`max(point in assignments)+1\` (fall back to len(assignments)).
- Return the number of (point, var) pairs with \`reaches(point, var)\` sat, over all program
  points 0..num_points-1 and all vars 0..num_vars-1.
- Keep \`deps\` recorded (they belong to the tuple contract) — you may additionally add a
  \`depends(p,v)\` relation/fact for them, but they must NOT change the counted result.

### 4. \`run_fixedpoint_experiments()\`
Reports, in order, with these EXACT keys:
- \`FP_DAG_REACHABLE_PAIRS\`     — count_reachable_pairs(DIAMOND_DAG); MUST be 26
- \`FP_CYCLIC_REACHABLE_PAIRS\`  — count_reachable_pairs(CYCLIC_GRAPH_6); MUST be 30
- \`FP_HORN_SAFE_COUNT\`         — sum of check_horn_safety over benchmarks/counter_safe.smt2,
  counter_unsafe.smt2, two_var_safe.smt2, double_counter_unsafe.smt2; MUST be 2
- \`FP_REACHING_DEFS\`           — analyze_reaching_definitions on this exact 5-statement,
  3-variable program (define it as a module-level constant, e.g. \`SAMPLE_PROGRAM\`):
  \`[(0, 0, []), (1, 1, [0]), (2, 2, [0, 1]), (3, 0, [2]), (4, 1, [0, 2])]\` with num_vars=3.
  Under the stated rules this is 1+2+3+3+3 = **12**; confirm by running it.
Resolve benchmark paths relative to the repo root computed from \`__file__\`, not the cwd.

### 5. \`fixedpoint/__main__.py\`
Calls \`run_fixedpoint_experiments()\` so \`cd /workspace && python3 -m fixedpoint\` prints the
four KEY: VALUE lines.

### Verify before finishing
Run \`cd /workspace && python3 -m fixedpoint\` and confirm:
\`\`\`
FP_DAG_REACHABLE_PAIRS: 26
FP_CYCLIC_REACHABLE_PAIRS: 30
FP_HORN_SAFE_COUNT: 2
FP_REACHING_DEFS: 12
\`\`\`
Also confirm it still works when invoked from a different cwd (\`cd /tmp && python3 -c
"import sys; sys.path.insert(0,'/workspace'); import fixedpoint; fixedpoint.run_fixedpoint_experiments()"\`).
`,
  },
  {
    key: 'spacer',
    label: 'spacer_verifier',
    files: 'spacer_verifier/__init__.py, spacer_verifier/__main__.py',
    spec: `
# Requirement: spacer — PDR/Spacer safety verification  (files: spacer_verifier/__init__.py, spacer_verifier/__main__.py)

Implement in \`spacer_verifier/__init__.py\`:

### 1. \`verify_transition_system(name, state_sorts, init_cond, trans_rel, safety_prop)\` -> dict
- \`state_sorts\`: list of z3 sorts, one per state variable.
- \`init_cond(state_vars)\` -> BoolRef ; \`trans_rel(state_vars, next_vars)\` -> BoolRef ;
  \`safety_prop(state_vars)\` -> BoolRef, where the arguments are LISTS of z3 vars.
  (Document this calling convention clearly.)
- Build \`fp = z3.Fixedpoint(); fp.set(engine='spacer')\`; declare \`Inv\` over the state sorts and
  a nullary \`Error\` relation; \`fp.register_relation(Inv, Error)\`; declare all current/next vars.
- Rules: \`Inv(x) :- init(x)\` ; \`Inv(x') :- Inv(x), trans(x,x')\` ; \`Error :- Inv(x), Not(safety(x))\`.
- \`fp.query(Error())\`: \`unsat\` => safe. On safe, extract the inductive invariant with
  \`fp.get_answer()\` and store \`str(...)\` of it.
- Return \`{"name": name, "safe": bool, "invariant": str or None}\` — the keys \`"safe"\` and
  \`"invariant"\` are mandatory; extra keys are fine. On unknown/exception return safe=False,
  invariant=None (and record the reason under another key).

### 2. \`verify_horn_file(filepath)\` -> dict
- Spacer Fixedpoint + \`fp.parse_file\`; safe iff every parsed query is \`unsat\`.
- Return \`{"safe": bool, ...}\` — the \`"safe"\` key is mandatory. Resolve relative paths against
  the repo root derived from \`__file__\`.

### 3. Benchmark transition-system builders
Each returns the 4-tuple \`(state_sorts, init_cond, trans_rel, safety_prop)\` ready to feed to
\`verify_transition_system\`.

- \`build_counter_system(bound, safety_limit)\`: one Int state x. init: x == 0.
  trans: \`And(x < bound, x' == x + 1)\`. safety: \`x < safety_limit\`.
- \`build_bakery_system()\`: Lamport's Bakery, 2 processes. State \`(pc1, pc2, y1, y2)\`, four Int
  sorts. PCs: 0=idle 1=waiting 2=critical. init: all four == 0.
  trans is the \`Or\` of these six steps (each step must pin down ALL four next-state vars):
    P1 0->1: pc1==0, pc1'==1, pc2'==pc2, y1'==y2+1, y2'==y2
    P1 1->2: pc1==1, Or(y2==0, y1<=y2), pc1'==2, pc2'==pc2, y1'==y1, y2'==y2
    P1 2->0: pc1==2, pc1'==0, pc2'==pc2, y1'==0, y2'==y2
    P2 0->1: pc2==0, pc2'==1, pc1'==pc1, y2'==y1+1, y1'==y1
    P2 1->2: pc2==1, Or(y1==0, y2<y1), pc2'==2, pc1'==pc1, y1'==y1, y2'==y2
    P2 2->0: pc2==2, pc2'==0, pc1'==pc1, y1'==y1, y2'==0
  safety: \`Not(And(pc1 == 2, pc2 == 2))\`.
  The orchestrator verified this exact encoding returns **unsat (safe)** in ~0.08s.
- \`build_double_inc_system()\`: two Int states (x, y). init: x==0 and y==0.
  trans: \`And(x' == x + 1, y' == y + 2)\`. safety: \`x + y < 50\`. (UNSAFE.)

### 4. \`run_spacer_experiments()\`
Reports, in order, with these EXACT keys:
- \`SPACER_SAFE_SYSTEMS\` — number of safe systems among counter(10,20), counter(10,5),
  bakery, double_inc, counter(100,200). MUST be 3.
- \`SPACER_HORN_SAFE\` — number of safe files among benchmarks/counter_safe.smt2,
  counter_unsafe.smt2, two_var_safe.smt2, bakery_mutex.smt2, double_counter_unsafe.smt2.
  MUST be 3.
- \`SPACER_BAKERY_SAFE\` — 1 if the bakery system verifies safe, else 0. MUST be 1.

### 5. \`spacer_verifier/__main__.py\`
Calls \`run_spacer_experiments()\` so \`cd /workspace && python3 -m spacer_verifier\` works.

Also expose a small convenience \`verify_system(name, builder_tuple)\` or equivalent if it keeps
the experiment code clean, and module-level \`BENCHMARK_FILES\` / \`BENCHMARK_SYSTEMS\` listings
so later layers (the CEGAR module) can reuse them. Export \`__all__\`.

### Verify before finishing
\`cd /workspace && python3 -m spacer_verifier\` must print:
\`\`\`
SPACER_SAFE_SYSTEMS: 3
SPACER_HORN_SAFE: 3
SPACER_BAKERY_SAFE: 1
\`\`\`
Also assert \`verify_transition_system\` returns a non-None \`"invariant"\` string for a safe
counter system, and \`safe=False\` for counter(10,5) and double_inc.
`,
  },
  {
    key: 'horn_translator',
    label: 'horn_translator',
    files: 'verification/horn_translator.py, verification/experiments/horn_exp.py',
    spec: `
# Requirement: horn_translator — Imperative-to-Horn translator
# (files: verification/horn_translator.py, verification/experiments/horn_exp.py)

Implement in \`verification/horn_translator.py\`:

### 1. SimpleAST classes
\`Variable(name)\`, \`Const(value)\`, \`BinOp(op, left, right)\` (ops: + - * < <= == != > >= and or),
\`Assign(var_name, expr)\`, \`If(cond, then_body, else_body)\`,
\`While(cond, body, bound)\` (bound = optional int iteration bound, default None),
\`Assert(cond)\`, \`Sequence(stmts)\`.
Also support unary \`not\` (a \`Not(expr)\` node or \`UnOp('not', e)\` — your choice, document it).
Give every node a \`__repr__\` and a \`to_z3(env)\` where \`env\` maps variable name -> z3 Int
(expression nodes only).

### 2. \`parse_program(text)\` -> Sequence
Hand-written recursive-descent parser + tokenizer for:
- \`var x = expr;\` declarations and \`x = expr;\` assignments (semicolons required after
  simple statements)
- \`if (cond) { ... } else { ... }\` with the \`else\` branch optional
- \`while (cond) { ... }\` with an OPTIONAL bound annotation. Support BOTH
  \`while (cond) bound 100 { ... }\` and a comment-style \`// @bound 100\` preceding the loop;
  pick one as primary and document, but at minimum \`while (cond) { ... }\` must parse.
- \`assert(cond);\`
- Arithmetic \`+ - *\` with standard precedence (\`*\` binds tighter than \`+\`/\`-\`), parentheses,
  unary minus.
- Comparisons \`< <= == != > >=\`; booleans \`and\`, \`or\`, \`not\` with \`not\` > \`and\` > \`or\`.
- \`//\` line comments stripped by the tokenizer.
- Raise a clear \`ParseError\` (subclass of Exception) with line/column on malformed input.

### 3. \`HornClause\` + \`HornEncoder\`
\`HornClause(head, body, name=None)\` where head/body are z3 expressions
(head may be an application of a relation or the Error relation).
\`HornEncoder\` must implement exactly these methods (names are graded):
- \`encode_program(ast)\` -> list[HornClause]: walk the AST creating a fresh relation per
  program point over ALL program variables.
- \`encode_assignment(assign, pre_rel, post_rel)\`: clause where the post state equals the pre
  state with only the assigned variable updated.
- \`encode_loop(while_node, loop_rel)\`: the recursive pair —
  entry -> loop_rel(init); loop_rel(x) and cond and body -> loop_rel(x'); loop_rel(x) and
  not cond -> exit.
- \`encode_branch(if_node, pre_rel, post_rel)\`: two clauses, cond and then-path, not-cond and
  else-path.
- \`encode_assertion(assert_node, pre_rel)\`: \`pre_rel(x) and Not(cond) -> Error\`.
- \`to_z3(program_vars)\`: build and return a configured \`z3.Fixedpoint\` (engine='spacer')
  with every relation registered, every variable declared, and every clause added as a rule.
- Track discovered program variables, the relations created, and which relations correspond to
  loops (expose e.g. \`loop_relations\`), because the experiment needs to count loop invariants.

### 4. \`verify_program(text)\` -> dict
Parse -> encode -> load into a spacer Fixedpoint -> query Error.
Return AT LEAST \`{"safe": bool, "num_clauses": int, "num_relations": int}\`.
Also include \`"invariants"\` (dict of loop relation name -> invariant string extracted from
\`fp.get_answer()\` when the query is unsat) and \`"num_loops"\`, which the experiment uses.
Expose a \`HornVerifier\` class wrapping this (a class with \`verify(text)\` plus the
module-level \`verify_program\` function).

### 5. \`verification/experiments/horn_exp.py\`
Module-level \`PROGRAMS\` list of (name, source) for exactly these 5 programs (write them in the
language your parser accepts; keep them semantically identical to these):
1. counter:  \`var x = 0; while (x < 10) { x = x + 1; } assert(x == 10);\`      -> SAFE
2. sum:      \`var s = 0; var i = 0; while (i < 5) { s = s + i; i = i + 1; } assert(s >= 0);\` -> SAFE
3. branch:   \`var x = 5; if (x > 3) { x = x - 1; } else { x = x + 1; } assert(x >= 0);\` -> SAFE
4. unsafe:   \`var x = 0; while (x < 100) { x = x + 2; } assert(x < 50);\`      -> UNSAFE
5. arith:    \`var a = 1; var b = 2; a = a + b; b = a * 2; assert(b == 6);\`    -> SAFE
\`run_horn_experiments()\` reports, in order, with these EXACT keys:
- \`HORN_CLAUSES_GENERATED\` — total Horn clauses over all 5 programs (whatever your encoding
  produces; must be a positive int and stable across runs)
- \`HORN_PROGRAMS_VERIFIED\` — count proven safe. MUST be 4.
- \`HORN_PROGRAMS_UNSAFE\`   — count found unsafe. MUST be 1.
- \`HORN_LOOP_INVARIANTS\`   — number of loops for which an invariant was successfully extracted.
  There are 3 loops total (programs 1, 2, 4); program 4 is unsafe so no invariant. Expect 2.
- \`HORN_TRANSLATION_TIME\`  — total wall-clock seconds for parsing+encoding all 5 programs,
  formatted to exactly 2 decimals (e.g. \`0.01\`). Time ONLY translation, not the solver queries.
Add \`if __name__ == "__main__": run_horn_experiments()\`.

**Correctness matters more than convenience**: program 1 must verify safe (the encoding must
capture that the loop exits with x == 10), and program 4 must be found unsafe. If a naive
program-point encoding makes spacer answer \`unknown\`, fix the encoding (e.g. make sure the loop
relation is over the full variable vector and the exit clause carries \`Not(cond)\`), do NOT
hard-code the answers.

### Verify before finishing
\`cd /workspace && python3 -m verification.experiments.horn_exp\` must print all five keys, with
HORN_PROGRAMS_VERIFIED: 4 and HORN_PROGRAMS_UNSAFE: 1. Also test that \`parse_program\` raises
ParseError on garbage input, and print the parsed AST repr of each program once to eyeball it.
`,
  },
  {
    key: 'cex_minimizer',
    label: 'cex_minimizer',
    files: 'verification/cex_minimizer.py, verification/experiments/cegar_exp.py',
    spec: `
# Requirement: cex_minimizer — CEGAR counterexample minimization
# (files: verification/cex_minimizer.py, verification/experiments/cegar_exp.py)

Implement in \`verification/cex_minimizer.py\`:

### 1. Counterexample data structures
- \`State(values: dict)\` — variable name -> concrete value. Add \`__getitem__\`, \`__repr__\`,
  \`__eq__\`, and a \`variables\` property.
- \`Transition(src: State, dst: State, action: str)\`.
- \`Counterexample(transitions: list[Transition])\` with:
  - \`length\` **property** = number of transitions
  - \`get_variable_trace(var_name)\` -> list of that variable's value across ALL states
    (src of transition 0, then dst of every transition; length == length+1 for a non-empty cex)
  - \`states\` property, \`__repr__\`, and \`__len__\`.

### 2. \`CEXValidator\`
- \`validate(cex, init_cond, trans_rel, safety)\` -> \`ValidationResult(is_real, first_spurious_step)\`.
  \`init_cond(vars)\`, \`trans_rel(vars, next_vars)\`, \`safety(vars)\` take dicts of name -> z3 Int
  (document the convention; it must match what CEGARLoop passes).
  Simulate concretely: substitute the concrete state values and check with a z3.Solver that
  (a) the first state satisfies init_cond, (b) EVERY transition satisfies trans_rel with those
  concrete pre/post values, (c) the final state violates safety.
  \`is_real\` is True only if all three hold. \`first_spurious_step\` is the index of the first
  failing transition; use \`None\` when real, \`0\` for a bad initial state, \`i\` for the first
  transition that is infeasible, and \`len(transitions)\` when the final state does not actually
  violate safety. Document this.
- \`ValidationResult\` is a small class with \`is_real\` and \`first_spurious_step\`.

### 3. \`PredicateRefiner\`
- \`extract_interpolants(cex, trans_rel)\` -> list of z3 BoolRef predicates.
  **This z3 build has NO interpolation API** (\`z3.binary_interpolant\` does not exist), so
  implement Craig interpolation yourself: for each split point k of the unrolled path formula,
  A = prefix (steps 0..k-1) and B = suffix (steps k..n). If \`And(A, B)\` is unsat, compute the
  interpolant as the quantifier-eliminated post-image of A over the shared (step-k) variables:
  \`z3.Tactic('qe')\` applied to a goal containing \`Exists([vars local to A], A)\`, then convert
  the resulting goal back to an expression (\`goal.as_expr()\`) and rename the step-k variables
  back to the plain program variable names. Simplify the result.
  Verify each produced interpolant really is one: \`Implies(A, I)\` valid and \`And(I, B)\` unsat;
  drop any candidate that fails. Skip trivially-true/false interpolants.
- \`strengthen_invariant(current_preds, new_interpolants)\` -> merged predicate list, dropping
  syntactically duplicate and semantically subsumed predicates (use the AbstractDomain
  subsumption check).
- \`minimize_cex(cex, trans_rel)\` -> Counterexample.
  Greedily try to remove intermediate transitions: for i < j, ask a z3.Solver whether a direct
  jump from state i to state j is consistent with \`trans_rel\` (i.e. one step from state_i lands
  on state_j). Whenever it is, splice out the transitions in between. Repeat until fixpoint.
  Also drop transitions that are no-ops (src == dst). The result must never be
  longer than the input and must keep the first and last state whenever possible.

### 4. \`AbstractDomain\`
- \`predicates\` list of z3 BoolRef; \`predicate_count\` **property**.
- \`abstract_state(concrete_state)\` -> tuple of booleans: evaluate every predicate under the
  concrete values (substitute then \`z3.simplify\`; treat non-boolean results as False).
- \`is_subsumed(pred_new, pred_existing)\` -> bool: True iff \`pred_existing => pred_new\` is valid
  (i.e. pred_new adds nothing), checked with a z3.Solver on the negation.
- \`add_predicate(pred)\` -> bool: add only if not subsumed by an existing predicate; remove any
  existing predicates that the new one subsumes. Return whether it was added.

### 5. \`CEGARLoop\`
- \`__init__(init_cond, trans_rel, safety, max_iterations=20, predicate_budget=50)\`
  (optionally accept \`var_names\` / \`name\` kwargs — give them defaults so the documented
  positional signature still holds).
- \`run()\` -> \`CEGARResult\`. Each iteration:
  1. verify with the current abstraction by building Horn clauses and calling Spacer
     (use \`spacer_verifier.verify_transition_system\` if available — import it lazily inside a
     try/except so this module still works standalone — otherwise build the Fixedpoint inline);
  2. safe -> \`CEGARResult(safe=True, iterations=n, predicates=[...], cex=None)\`;
  3. unsafe -> obtain a concrete counterexample trace (walk \`fp.get_answer()\` for ground facts
     of the Inv relation, or fall back to a bounded unrolling with a plain z3.Solver — the
     fallback must work, since it is what produces the reliable traces);
  4. validate it with CEXValidator;
  5. real -> \`CEGARResult(safe=False, ..., cex=minimize_cex(cex))\` (store the original length
     too, e.g. \`original_cex\`/\`original_length\` attributes);
  6. spurious -> refine via \`extract_interpolants\` + \`add_predicate\`, then loop.
  Terminate when \`max_iterations\` or \`predicate_budget\` is exceeded and report that in the
  result (e.g. an \`exhausted\`/\`reason\` field) with \`safe=False\`.
- \`CEGARResult(safe, iterations, predicates, cex)\` with those attribute names.

### 6. \`verification/experiments/cegar_exp.py\`
Define exactly these 5 systems (module-level list \`SYSTEMS\`, each carrying a
name plus init/trans/safety callables using the dict-of-z3-Int convention):
1. \`counter_offbyone\`   — counter with an off-by-one guard; SAFE (needs refinement)
2. \`double_counter\`     — x+=1, y+=2, safety x+y<50; genuinely UNSAFE (real CEX)
3. \`array_bounds\`       — index/array-bounds abstraction; SAFE (should take 3+ refinements)
4. \`simple_loop\`        — loop with invariant x >= 0; SAFE immediately
5. \`producer_consumer\`  — bounded buffer that can overflow; UNSAFE, and its CEX must shrink
   under \`minimize_cex\` (make sure the raw trace has removable intermediate steps).
\`run_cegar_experiments()\` reports, in order, with these EXACT keys:
- \`CEGAR_ITERATIONS\`             — total CEGAR iterations summed over all 5 systems
- \`CEGAR_PREDICATES_ADDED\`       — total predicates discovered over all runs
- \`CEGAR_CEX_LENGTH_ORIGINAL\`    — sum of ORIGINAL cex lengths for the unsafe systems
- \`CEGAR_CEX_LENGTH_MINIMIZED\`   — sum of MINIMIZED cex lengths for the unsafe systems
- \`CEGAR_VERIFIED_SAFE\`          — number of systems proven safe. MUST be 3.
Requirements on the numbers: all five must be positive integers,
\`CEGAR_CEX_LENGTH_MINIMIZED < CEGAR_CEX_LENGTH_ORIGINAL\` (minimization must genuinely help),
and \`CEGAR_ITERATIONS >= 5\` (every system takes at least one iteration).
Add \`if __name__ == "__main__": run_cegar_experiments()\`.

Everything must be deterministic and the whole run must finish in under ~60s.

### Verify before finishing
\`cd /workspace && python3 -m verification.experiments.cegar_exp\` must print all five keys with
CEGAR_VERIFIED_SAFE: 3 and a strictly smaller minimized total than original. ALSO write a short
throwaway script that checks: CEXValidator flags a hand-built spurious trace as not real and a
hand-built genuine trace as real; \`minimize_cex\` on a trace with a removable middle step returns
a shorter trace; \`AbstractDomain.add_predicate(x>=0)\` then \`add_predicate(x>=1)\` behaves per the
subsumption rules. Report what you observed.

NOTE: \`spacer_verifier/\` is being written concurrently by another agent with this contract:
\`verify_transition_system(name, state_sorts, init_cond, trans_rel, safety_prop)\` where
\`init_cond(state_vars_list)\`, \`trans_rel(state_vars_list, next_vars_list)\`,
\`safety_prop(state_vars_list)\` take LISTS of z3 vars, returning
\`{"name":..., "safe": bool, "invariant": str or None}\`. Import it lazily and defensively
(try/except ImportError) and adapt between the list convention there and your dict convention.
Your module must be fully functional even if that import fails.
`,
  },
];

phase('Implement')

const results = await pipeline(
  SPECS,
  (s) => agent(
    `You are implementing ONE requirement of a Z3 verification toolbox at /workspace.\n${COMMON}\n${s.spec}\n\n` +
    `When done, return a short report: the files you created, the exact experiment output you observed, ` +
    `and any caveats or deviations from the spec.`,
    { label: `impl:${s.label}`, phase: 'Implement' }
  ),
  (report, s) => agent(
    `Another agent just implemented the "${s.key}" requirement of the Z3 verification toolbox at /workspace, ` +
    `in these files: ${s.files}.\n\nTheir report:\n${report}\n\n` +
    `Your job is an ADVERSARIAL self-check. Do NOT rewrite the module wholesale. Instead:\n` +
    `1. Read the files and the requirement spec below.\n` +
    `2. Actually RUN the experiment entry point yourself and record the exact output.\n` +
    `3. Check every named class/method/function from the spec EXISTS with the specified name and ` +
    `arity, and that properties specified as properties are properties (not methods).\n` +
    `4. Check the required metric values match the spec's MUST values.\n` +
    `5. Look for correctness bugs: wrong z3 encoding, silently swallowed exceptions that mask ` +
    `failures, hard-coded answers that should be computed, non-determinism, cwd-dependent paths, ` +
    `runtime blowups.\n` +
    `6. FIX any real defect you find directly in those files (minimal, surgical edits), then re-run ` +
    `to confirm.\n\nSpec:\n${s.spec}\n\n${COMMON}\n` +
    `Return: PASS/FAIL per acceptance signal, the exact final experiment output, and a list of ` +
    `every fix you applied.`,
    { label: `check:${s.label}`, phase: 'SelfCheck' }
  )
)

return { reports: results }
