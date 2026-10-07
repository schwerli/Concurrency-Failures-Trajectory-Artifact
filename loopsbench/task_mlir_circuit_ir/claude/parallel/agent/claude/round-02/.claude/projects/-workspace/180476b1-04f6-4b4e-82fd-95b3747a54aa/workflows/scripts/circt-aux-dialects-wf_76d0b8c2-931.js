export const meta = {
  name: 'circt-aux-dialects',
  description: 'Write the three auxiliary CIRCT dialect modules (fsm, sv, firrtl) that src/circt/__init__.py already imports',
  phases: [
    { title: 'Write', detail: 'one agent per dialect file' },
    { title: 'Verify', detail: 'import + lint each written file' },
  ],
}

const SHARED = `
You are working in the Python repo at /workspace. It implements a three-layer stack:
  src/mlir/    - a from-scratch MLIR core (ir.py, parser.py, printer.py, pattern.py, pass_manager.py, dialects/)
  src/circt/   - CIRCT-style hardware dialects + a cycle-accurate simulator
  src/k_circt/ - a K-framework-inspired semantic layer

READ THESE FIRST (they define the conventions you must follow):
  - /workspace/src/mlir/ir.py            (Operation, Block, Region, Type, Attribute, Trait, Dialect, get_default_context)
  - /workspace/src/circt/hw_dialect.py   (HWOp base class, IntType, Port, Direction, bit_width_of, SignalEnv, the
                                          registration idiom at the bottom of the file, and the build_parsed classmethod pattern)
  - /workspace/src/circt/seq_dialect.py  (how stateful ops and dataclass-style helper ops are written)
  - /workspace/src/circt/__init__.py     (THE CONTRACT: it already imports specific names from your file. Every name
                                          it imports from your module MUST exist and be importable.)

HARD CONSTRAINTS:
  * Imports inside src/circt/*.py use the top-level form "from mlir.ir import ..." (src/ is on sys.path), NOT relative
    "from ..mlir.ir import ...". Sibling modules use relative imports: "from .hw_dialect import HWOp, IntType".
  * Do NOT create a new Dialect() for a namespace that another module already registered. Check first.
    hw_dialect.py registers "hw", comb_dialect.py registers "comb", seq_dialect.py registers "seq".
  * Register every Operation subclass with its Dialect at the bottom of the file, following the existing
    "for _op in (...): DIALECT.register_operation(_op)" idiom, and set OPERATION_NAME on each class.
  * Operation subclasses that add instance attributes MUST also provide a build_parsed classmethod that initialises
    those attributes, because the parser bypasses __init__ (see HWOp.build_parsed and CompRegOp.build_parsed).
  * Also set those attributes as CLASS-level defaults so attribute access never raises even if build_parsed is skipped.
  * Include an __all__ list and module/class docstrings in the same voice as the existing files (concise, explanatory,
    no marketing). Match the existing comment density. Type annotations via "from __future__ import annotations".
  * Pure Python 3, no third-party imports.
  * ONLY create/modify the single file you are told to write. Do not touch any other file.

VERIFY BEFORE YOU FINISH: run
  cd /workspace && python3 -c "import sys; sys.path.insert(0,'src'); import importlib; importlib.import_module('circt.<yourmodule>')"
It may fail only because a *sibling* file (a different agent's file) does not exist yet - that is acceptable and expected.
If it fails because of an error in YOUR file, fix it. To test your file in isolation you may create a temporary
throwaway script that stubs the missing siblings, but delete any such scratch file before finishing.

Return a one-paragraph summary of what you created plus the exact list of public names your module exports.
`

phase('Write')

const FILES = [
  {
    key: 'fsm',
    path: 'src/circt/fsm_dialect.py',
    spec: `Write /workspace/src/circt/fsm_dialect.py - the CIRCT "fsm" dialect (finite state machines).

src/circt/__init__.py imports exactly these names from it:
    FSM_DIALECT, FSMOutputOp, MachineOp, StateEncoding, StateOp, TransitionOp

Design notes:
  * FSM_DIALECT = Dialect("fsm", get_default_context()).
  * StateEncoding: an Enum of state encoding styles - BINARY, ONE_HOT, GRAY - with a helper
    encode(index, num_states) -> int and a width_for(num_states) -> int so a machine can report how many
    bits its state register needs. Gray coding: index ^ (index >> 1). One-hot: 1 << index.
  * MachineOp (OPERATION_NAME "fsm.machine"): an HWOp subclass with a graph region body holding StateOps,
    traits (Trait.SYMBOL, Trait.ISOLATED_FROM_ABOVE, Trait.GRAPH_REGION), a sym_name attribute, an
    initial_state attribute, an encoding (StateEncoding), and accessors: machine_name, states (list of StateOp
    in the body), state_names(), find_state(name), num_states, initial_state, state_width().
    NOTE: /workspace/src/mlir/parser.py already lists "fsm.machine" in GRAPH_REGION_OPS and PORT_LIST_OPS,
    so MachineOp must tolerate being built by the parser with a port list (sym_name / function_type /
    port_names / port_directions attributes) - mirror how HWModuleOp exposes .ports for that.
  * StateOp (OPERATION_NAME "fsm.state"): a named state with a region holding its transitions and an optional
    output. Accessors: state_name, transitions (list of TransitionOp), output_op, add_transition(t).
  * TransitionOp (OPERATION_NAME "fsm.transition"): a transition to a target state with an optional guard.
    Give it: target (the target state name), guard (a callable or None), is_always_taken, and
    is_enabled(env) -> bool that evaluates the guard against a signal environment dict (guard None => True).
  * FSMOutputOp (OPERATION_NAME "fsm.output"): the terminator of a state region (Trait.TERMINATOR),
    with evaluate(env) returning the list of operand values, mirroring hw_dialect.OutputOp.
  * Add an executable helper on MachineOp: run(inputs_per_cycle) or step(env) that walks transitions from the
    current state and returns the resulting state name, so the machine is actually simulatable. Track
    current_state and reset to initial_state via reset_state().`,
  },
  {
    key: 'sv',
    path: 'src/circt/sv_dialect.py',
    spec: `Write /workspace/src/circt/sv_dialect.py - the CIRCT "sv" dialect (SystemVerilog constructs).

src/circt/__init__.py imports exactly these names from it:
    AlwaysCombOp, AlwaysFFOp, AssignOp, GenerateOp, IfOp, InterfaceOp, SVModuleOp, SVRegOp, SVWireOp

Design notes:
  * Create SV_DIALECT = Dialect("sv", get_default_context()) and export it too (add it to __all__), even
    though __init__.py does not import it - the other dialect files export their Dialect object the same way.
  * SVRegOp ("sv.reg"): a procedural register/variable with a name, a width, a current value, read()/write(value),
    and evaluate(env) returning the current value. Truncate writes to the declared width (see HWOp.truncate).
  * SVWireOp ("sv.wire"): a continuously-driven net - name, width, an optional driver operand, assign(value),
    evaluate(env).
  * AssignOp ("sv.assign"): a continuous assignment of a source to a destination. Give it destination/source
    accessors and an apply(env) that computes the assigned value.
  * IfOp ("sv.if"): a procedural conditional with a condition operand and two regions (then/else). Provide
    then_region/else_region/then_body/else_body accessors and taken_branch(env) -> "then" | "else".
  * AlwaysCombOp ("sv.alwayscomb") and AlwaysFFOp ("sv.alwaysff"): procedural blocks owning one region.
    AlwaysFFOp additionally carries a clock edge ("posedge"/"negedge") plus an optional reset and reset edge;
    give it triggers_on(previous_clock, current_clock) -> bool implementing real edge detection.
  * InterfaceOp ("sv.interface"): a named interface with a list of (name, type) signals; accessors
    signal_names(), get_signal(name), add_signal(name, type).
  * GenerateOp ("sv.generate"): a generate block with a label and a region; expose label and body.
  * SVModuleOp ("sv.module"): a SystemVerilog module wrapper - name, ports (reuse hw_dialect.Port and
    Direction), a body region, and accessors ports/input_ports/output_ports/get_port(name), mirroring
    hw_dialect.HWModuleOp but without duplicating its verification logic.
  * All of these are HWOp subclasses so they inherit truncate/read_operand/evaluate plumbing.`,
  },
  {
    key: 'firrtl',
    path: 'src/circt/firrtl_dialect.py',
    spec: `Write /workspace/src/circt/firrtl_dialect.py - the CIRCT "firrtl" dialect plus width inference.

src/circt/__init__.py imports exactly these names from it:
    FIRRTLAnalogType, FIRRTLBundleType, FIRRTLCircuitOp, FIRRTLClockType, FIRRTLConnectOp, FIRRTLInstanceOp,
    FIRRTLModuleOp, FIRRTLNodeOp, FIRRTLRegOp, FIRRTLResetType, FIRRTLSIntType, FIRRTLUIntType,
    FIRRTLVectorType, FIRRTLWhenOp, FIRRTLWireOp, WidthInference

Design notes:
  * Create FIRRTL_DIALECT = Dialect("firrtl", get_default_context()) and export it too (add it to __all__).
  * Types subclass mlir.ir.Type and print in FIRRTL's spelling. Widths may be UNKNOWN (None):
      FIRRTLUIntType(width=None)  -> "!firrtl.uint<8>" or "!firrtl.uint" when the width is unknown
      FIRRTLSIntType(width=None)  -> "!firrtl.sint<...>"
      FIRRTLClockType()           -> "!firrtl.clock"
      FIRRTLResetType(asynchronous=False) -> "!firrtl.reset" / "!firrtl.asyncreset"
      FIRRTLAnalogType(width=None)-> "!firrtl.analog<...>"
      FIRRTLBundleType(fields)    -> "!firrtl.bundle<a: uint<1>, flip b: uint<8>>" (support flipped fields)
      FIRRTLVectorType(element, count) -> "!firrtl.vector<uint<8>, 4>"
    Each should implement bitwidth()/bit_count() where meaningful (None when unknown), plus
    is_width_known and helpers like get_field_type(name) for bundles.
  * Operations (all HWOp subclasses, each with OPERATION_NAME):
      FIRRTLCircuitOp   "firrtl.circuit"  - top level, a region of modules, sym_name, main_module accessor,
                                            modules list, find_module(name).
      FIRRTLModuleOp    "firrtl.module"   - ports + graph-region body. NOTE /workspace/src/mlir/parser.py lists
                                            "firrtl.module" in GRAPH_REGION_OPS and PORT_LIST_OPS, and
                                            /workspace/src/mlir/printer.py formats it with the hw-module header
                                            path, so its attributes must follow the same
                                            sym_name/function_type/port_names/port_directions convention as
                                            hw_dialect.HWModuleOp. Reuse hw_dialect.Port and Direction.
      FIRRTLWireOp      "firrtl.wire"     - named wire with a type.
      FIRRTLRegOp       "firrtl.reg"      - clocked register; also "firrtl.regreset" style optional reset and
                                            reset value; current_value + next_value(env)/commit(value) mirroring
                                            seq_dialect.SeqOp's two-phase interface (import SeqOp and subclass it
                                            if that is the cleanest fit - it is in .seq_dialect).
      FIRRTLNodeOp      "firrtl.node"     - a named intermediate value; evaluate(env) forwards operand 0.
      FIRRTLConnectOp   "firrtl.connect"  - dest <= src; accessors dest/src and apply(env).
      FIRRTLWhenOp      "firrtl.when"     - conditional with then/else regions and taken_branch(env).
      FIRRTLInstanceOp  "firrtl.instance" - instance of a module by name with port bindings.
  * WidthInference: the interesting part. A small analysis class that propagates widths through a FIRRTL-style
    operation graph. API:
      wi = WidthInference()
      wi.set_width("a", 8); wi.constrain(...)  etc.
      wi.infer_binary(op_kind, lhs_width, rhs_width) -> int   # FIRRTL rules:
          add/sub -> max(l, r) + 1 ; mul -> l + r ; div -> l (+1 for signed) ; rem -> min(l, r)
          and/or/xor -> max(l, r) ; cat -> l + r ; cmp -> 1 ; dshl -> l + (2**r - 1)
      wi.infer_module(module_op) -> Dict[str, Optional[int]]   # walk the body, propagate operand widths to
          results, return the map of value name -> inferred width, leaving None where still unknown.
      wi.unresolved() -> List[str] and wi.is_fully_resolved() -> bool.
    Iterate to a fixed point so forward references in a graph region resolve. Keep it deterministic.`,
  },
]

const written = await pipeline(
  FILES,
  f => agent(`${SHARED}\n\nYOUR ASSIGNMENT:\n${f.spec}\n`, {
    label: `write:${f.key}`,
    phase: 'Write',
  }),
  (summary, f) => agent(
    `You are reviewing a single new file in /workspace: ${f.path}.\n\n` +
    `Another agent just wrote it. Its stated summary was:\n${summary}\n\n` +
    `Do these checks and FIX any problems you find by editing ONLY ${f.path}:\n` +
    `1. Run: cd /workspace && python3 -c "import ast; ast.parse(open('${f.path}').read())" - must parse.\n` +
    `2. Read /workspace/src/circt/__init__.py and confirm EVERY name it imports from this module actually exists ` +
    `at module top level with the exact spelling. List any missing and add them.\n` +
    `3. Confirm no duplicate Dialect() registration for a namespace already claimed by hw_dialect/comb_dialect/seq_dialect.\n` +
    `4. Confirm imports use "from mlir.ir import ..." (absolute) and "from .hw_dialect import ..." (relative sibling).\n` +
    `5. Confirm each Operation subclass sets OPERATION_NAME, is registered with its Dialect, and that any instance ` +
    `attributes have class-level defaults AND a build_parsed override.\n` +
    `6. Look for actual bugs: wrong operand indices, off-by-one in width math, attribute access that can raise ` +
    `AttributeError, mutable default arguments, super().__init__ signature mismatches against HWOp.__init__.\n` +
    `7. Delete any scratch/temp file the previous agent left behind (check "cd /workspace && git status --short").\n\n` +
    `Report: the list of concrete problems you found and fixed, or "clean" if none. Be specific and honest - do not ` +
    `claim a check passed if you did not run it.`,
    { label: `verify:${f.key}`, phase: 'Verify' }
  ),
)

return { files: FILES.map(f => f.path), reviews: written }
