export const meta = {
  name: 'k-circt-audit',
  description: 'Exhaustively audit the k_circt semantic layer for correctness bugs, cross-layer disagreement, and API gaps',
  phases: [
    { title: 'Audit', detail: 'parallel auditors over each k_circt module + cross-layer differential testing' },
    { title: 'Verify', detail: 'adversarially verify each finding by actually running code' },
  ],
}

const REPO = '/workspace'

const PREAMBLE = `
You are auditing a Python project at ${REPO}. It is a three-layer stack:
  - src/mlir/    : core MLIR model (ir.py, parser.py, printer.py, pass_manager.py, pattern.py, dialects/)
  - src/circt/   : CIRCT hardware dialects (hw/comb/seq + firrtl/sv/fsm) and a cycle-accurate simulator
  - src/k_circt/ : a K-framework-inspired semantic layer (configuration.py, symbols.py, types.py,
                   attributes.py, semantics.py, state.py, kimulator.py)

Inputs live in ${REPO}/inputs/ (alu.mlir, counter.mlir, sample_arith.mlir).
The harness contract is ${REPO}/src/run_experiments.py emitting sorted "KEY: VALUE" lines; the
required keys and values are listed in ${REPO}/tests/test_outputs.py (EXPECTED_OUTPUTS).
Existing regression tests: ${REPO}/agent_tests/test_circt.py and ${REPO}/agent_tests/test_k_circt.py.

You may run python freely, e.g.:
  cd ${REPO} && python3 -c "import sys; sys.path.insert(0,'src'); ..."
  cd ${REPO} && python3 tests/test_outputs.py
  cd ${REPO} && python3 -m pytest agent_tests/ -q

IMPORTANT RULES:
- Do NOT edit any files. You are a read-only auditor. Report findings only.
- A finding must be a REAL defect you demonstrated by running code, or a concrete
  correctness/consistency risk you can point at with file:line.
- Prefer few high-confidence findings over many speculative ones.
- Ignore pure style nits. Focus on: wrong results, crashes, silent wrong behaviour,
  documented behaviour that does not match reality (docstrings that lie), and
  API surface that a reasonable test of this layer would exercise but which is
  missing or broken.
`

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
        required: ['title', 'file', 'line', 'detail', 'repro', 'severity'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          detail: { type: 'string' },
          repro: { type: 'string', description: 'exact shell/python command demonstrating the defect, and its actual vs expected output' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reasoning', 'confirmed_repro'],
  properties: {
    real: { type: 'boolean' },
    reasoning: { type: 'string' },
    confirmed_repro: { type: 'string', description: 'what you actually observed when you ran it' },
  },
}

const AUDITORS = [
  {
    key: 'semantics-rules',
    prompt: `${PREAMBLE}
FOCUS: src/k_circt/semantics.py (the rule set + rule engine) and src/k_circt/configuration.py.

Check every semantic rule against what the operation actually means, and against how
src/circt/comb_dialect.py + src/circt/seq_dialect.py + src/mlir/dialects/arith.py implement
the same operation. Specifically hunt for:
  - wrong bit-width wrapping / truncation (comb ops must wrap to their result width)
  - signed vs unsigned mistakes (comb.icmp slt/sgt/sle/sge, comb.divs/mods, comb.shrs, arith.cmpi)
  - division / modulo by zero behaviour disagreeing between layers
  - comb.extract / comb.concat / comb.replicate / comb.parity bit ordering and widths
  - comb.mux operand order (which operand wins when the condition is true)
  - variadic ops with 0, 1 or many operands
  - the rule engine: does it detect a combinational cycle rather than hanging or
    silently returning a stale value? does it report an operation with no rule?
  - RulePhase / RuleStatus / RuleSet bookkeeping: are rules actually reachable, or are
    some registered under a key that never matches a real op name?
Write small python programs that build tiny hw.module sources, parse them, and compare
k_circt's Kimulator result against src/circt's CircuitSimulator for the SAME circuit.
Report every disagreement.`,
  },
  {
    key: 'state-sequential',
    prompt: `${PREAMBLE}
FOCUS: src/k_circt/state.py (RegisterCell, CircuitState, StatefulCircuit, CycleResult,
execute_function) and how it drives sequential logic.

Hunt for:
  - two-phase update bugs: does a clock edge commit ALL registers from the values they
    saw BEFORE the edge (correct) or does it let one register see another's new value
    (wrong, order-dependent)? Prove it with a two-register shift-register circuit whose
    correct behaviour you can state independently.
  - reset semantics: seq.compreg reset value, reset held over multiple cycles, reset
    releasing, reset value truncation to the register width
  - register width wrapping (the 8-bit counter must wrap 255 -> 0)
  - seq.compreg.ce (clock enable): does disabling the enable really hold the value?
  - graph-region ordering: counter.mlir uses %next BEFORE it is defined. Does everything
    still settle? Try reordering the body lines and confirm the result is unchanged.
  - execute_function on inputs/sample_arith.mlir: @add_constants must be 295,
    @fold_chain must be 90, @multi_block must honour the cf.cond_br / cf.br CFG for
    several argument pairs. Check multi-block control flow really works, including
    block arguments if the layer claims to support them.
  - Kimulator.output_after / run / step / reset consistency: cycle counters, trace
    length, and whether reset() truly restores the initial state.
Compare against src/circt/simulator.py over MANY cycles (e.g. 300) and report any
disagreement.`,
  },
  {
    key: 'analyses',
    prompt: `${PREAMBLE}
FOCUS: src/k_circt/symbols.py, src/k_circt/types.py, src/k_circt/attributes.py.

Hunt for:
  - symbol analysis: scope tree shape, duplicate symbol names, nested modules,
    unresolved references being reported, block labels, hw ports vs func arguments,
    registers marked stateful. Does resolve_symbols on inputs/sample_arith.mlir give
    exactly 3 definitions, and on inputs/alu.mlir / counter.mlir give 1 each?
  - type analysis: the fixpoint loop. Does it converge? Does it report iterations
    honestly? Does inference actually fill in a result type that the source omits
    (construct such a case)? Do !seq.clock and i1 get the Clock / Bool sorts?
    Do widths agree with src/circt/hw_dialect.bit_width_of for every type spelling?
    Are conflicts detected when a value is given two different types?
  - attribute analysis: every attribute kind unwrapped correctly (IntegerAttr, BoolAttr,
    StringAttr, TypeAttr, UnitAttr, ArrayAttr, DictAttr, FlatSymbolRefAttr, FloatAttr).
    Is a symbol-valued attribute resolved to the OPERATION it names? Does an attribute
    resolving to a legitimately falsy value (0, False, "") get wrongly reported as
    unresolved? Look hard at ResolvedAttribute.is_resolved.
  - Do the three analyses agree with the MLIR layer's own SymbolTable / types?
Prove each finding by running code.`,
  },
  {
    key: 'kimulator-api-and-docs',
    prompt: `${PREAMBLE}
FOCUS: src/k_circt/kimulator.py and src/k_circt/__init__.py, plus every docstring in
src/k_circt/*.py.

Task 1 - DOCSTRINGS MUST NOT LIE. Extract every code example / claim from every docstring
in src/k_circt/*.py (including the package __init__ and the module headers) and actually
run it. Any example whose output differs from what the docstring claims is a high-severity
finding. Any prose claim about behaviour that is false is a finding.

Task 2 - EXPORT SURFACE. Every name in src/k_circt/__init__.py __all__ must import and be
usable. Check for names exported but missing, or defined but not exported while a sibling
module clearly expects them. Verify "from k_circt import *" works and that the doctest in
the package docstring is accurate.

Task 3 - API ROBUSTNESS. The Kimulator is the public entry point. Exercise it the way an
outside test would and report anything that crashes with an unhelpful error or returns a
silently wrong value:
  - Kimulator over a root with no hardware module (sample_arith.mlir) - analyses must work
  - Kimulator with a module name that does not exist - must raise a clear error
  - evaluate() with an unknown input port name; with a missing input port
  - run(0), run(-1), step() before any run, output() with no name, output("nope")
  - trace queries: signal(), outputs(), states(), at(), rule_histogram(), total_steps,
    to_text(verbose=True), first/last on an empty trace
  - kimulate() convenience wrapper in all its modes
  - record_configurations=True path
Prove each finding by running code.`,
  },
  {
    key: 'differential-exhaustive',
    prompt: `${PREAMBLE}
FOCUS: differential testing k_circt against src/circt, exhaustively, plus the harness contract.

Do this work:
  1. ALU: for ALL 4*16*16 = 1024 combinations of op in 0..3, a in 0..15, b in 0..15,
     compare k_circt.Kimulator(...).evaluate() against circt.CircuitSimulator(...).evaluate()
     on inputs/alu.mlir. Also compare both against an INDEPENDENT python reference you write
     yourself from reading the alu.mlir source (add wraps at 4 bits; op 0=add, 1=and, 2=or,
     3=xor, and note op==3 vs "anything else" - read the mux chain carefully and decide what
     op=2 and the default really select). Report every mismatch.
  2. Counter: run 300 cycles in both layers and compare the output series element by element.
     Then test reset asserted for the first 3 cycles, released, and compare again.
  3. Verify the harness: cd ${REPO} && python3 tests/test_outputs.py must pass, and
     python3 src/run_experiments.py output must be sorted and contain every key in
     EXPECTED_OUTPUTS with the exact expected value. Confirm each of the 6 k_circt_* values
     is computed from real work rather than hardcoded - read run_experiments.py and say
     whether any value is faked.
  4. Determinism: run src/run_experiments.py three times and confirm byte-identical output.
  5. Check python3 -m pytest agent_tests/ -q and python3 -m pytest tests/ -q both pass.
Report mismatches and any hardcoded/faked value as findings.`,
  },
  {
    key: 'integration-layering',
    prompt: `${PREAMBLE}
FOCUS: whether the three layers are genuinely CONNECTED, and whether the earlier layers
still work after the k_circt layer was added.

The task requires: "Keep the modules connected so later stages reuse the earlier IR and
parsing infrastructure." Verify by reading imports and by running code:
  - Does src/k_circt actually reuse src/mlir's Operation/Region/Block/Value/Type/Attribute
    and src/mlir.parser, rather than re-parsing or re-implementing them? Point at any
    place where k_circt duplicates logic that already exists in mlir or circt and could
    disagree with it (e.g. its own bit-width or its own constant folding).
  - Does src/k_circt reuse src/circt's dialect registration, port model and width rules?
    Is "import k_circt" alone enough to parse a hw/comb/seq file (the package docstring
    claims it is)? Prove it in a FRESH interpreter that never imports circt directly.
  - Dialect registration must not double-register or conflict when modules are imported in
    different orders. Test all import orders: (mlir, circt, k_circt), (k_circt only),
    (circt, k_circt), (k_circt, circt), (mlir, k_circt).
  - Regression: does the MLIR layer still behave? Run python3 tests/test_outputs.py and
    python3 -m pytest agent_tests/ -q. Also re-verify the round-trip printer stability and
    that importing k_circt does NOT change any mlir_* or circt_* output value.
  - Are there import cycles between src/k_circt modules, or between k_circt and circt?
    Check by importing each src/k_circt/*.py module FIRST in a fresh interpreter.
Report anything broken.`,
  },
]

phase('Audit')
log(`auditing the k_circt layer across ${AUDITORS.length} dimensions`)

const results = await pipeline(
  AUDITORS,
  (a) => agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (res, auditor) => {
    const findings = (res && res.findings) || []
    if (!findings.length) return []
    return parallel(
      findings.map((f) => () =>
        agent(
          `${PREAMBLE}

Another auditor reported this finding. Your job is to REFUTE it. Default to real=false
unless you can reproduce the defect yourself by running code.

  title:    ${f.title}
  file:     ${f.file}:${f.line}
  detail:   ${f.detail}
  repro:    ${f.repro}
  severity: ${f.severity}

Run the repro. Read the surrounding code. Decide:
  - real=true  only if you personally observed wrong/crashing/lying behaviour that a
               reasonable maintainer of THIS project would want fixed.
  - real=false if the repro does not reproduce, the "expected" value is the auditor's
               invention rather than a real requirement, the behaviour is a deliberate
               and documented design choice, or it is a style nit with no behavioural
               consequence.
Report exactly what you observed.`,
          { label: `verify:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((v) => ({ ...f, auditor: auditor.key, verdict: v })),
      ),
    )
  },
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter((f) => f.verdict && f.verdict.real)
log(`${all.length} findings raised, ${confirmed.length} survived adversarial verification`)

return {
  confirmed: confirmed.map((f) => ({
    title: f.title,
    file: f.file,
    line: f.line,
    severity: f.severity,
    auditor: f.auditor,
    detail: f.detail,
    repro: f.repro,
    observed: f.verdict.confirmed_repro,
  })),
  refuted_count: all.length - confirmed.length,
  refuted_titles: all.filter((f) => !(f.verdict && f.verdict.real)).map((f) => f.title),
}
