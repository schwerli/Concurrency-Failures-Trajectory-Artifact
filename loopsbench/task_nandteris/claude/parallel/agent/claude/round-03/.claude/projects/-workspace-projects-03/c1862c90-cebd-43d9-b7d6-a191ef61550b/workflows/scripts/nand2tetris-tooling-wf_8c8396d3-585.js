export const meta = {
  name: 'nand2tetris-tooling',
  description: 'Build a local .tst/.cmp test harness for nand2tetris HDL and Hack assembly',
  phases: [
    { title: 'Build', detail: 'HDL tst runner, Hack assembler+emulator, equivalence prop-tests' },
    { title: 'Audit', detail: 'adversarial review of harness fidelity vs official semantics' },
  ],
}

const COMMON = `
You are working in the git repo /workspace (a nand2tetris "Elements of Computing Systems" project skeleton).

ABSOLUTE RULES:
- You may ONLY create/modify files under /workspace/agent_tests/. NEVER touch anything under /workspace/projects/ or /workspace/requirements/ (read-only reference).
- Do NOT run git commit / git add. Do not modify git state.
- Python 3 only, standard library only (no pip installs, no pytest dependency - plain scripts with a main()).
- An HDL simulator ALREADY EXISTS and works: /workspace/agent_tests/hdl/simulator.py (class Simulator: set_pin/get_pin/eval_all/tick/tock/get_internal/set_internal/find_chip) and /workspace/agent_tests/hdl/builtins.py (built-in chip set). READ BOTH FIRST and reuse them; fix bugs in them only if you find real defects (report any fix).
- Test scripts (.tst) and expected outputs (.cmp) live next to the chips under /workspace/projects/01..05. The .cmp files use CRLF line endings in some cases - normalize by stripping trailing \\r and trailing whitespace-insensitive compare is NOT allowed except for line-ending normalization.
`;

const TST_SEMANTICS = `
Official nand2tetris .tst semantics you must implement faithfully:
- Comments: // to end of line, and /* ... */ blocks.
- A script is a sequence of commands separated by ',' and terminated by ';' (a ';' ends a "simulation step"; several steps may share a line).
- Commands: load <file>.hdl | output-file <f> | compare-to <f> | output-list <spec>... | set <pin|internal> <value> | eval | output | tick | tock | ticktock | repeat <n> { ... } | repeat { ... } (unbounded -> cap it) | while <lhs> <op> <rhs> { ... } | echo "..." | clear-echo | breakpoint ... | <ChipName> load <file> (e.g. "ROM32K load Add.hack").
- 'set' targets: a chip pin (in, load, address, instruction, reset, ...) OR internal state of a built-in part: RAM16K[0], ARegister[0], DRegister[], PC[], RAM[3] etc. Name in brackets = index into that built-in's state (empty brackets = index 0). Use Simulator.set_internal/get_internal.
- Value literals: plain signed decimal (-1, 12345), %B0011.. (binary), %X2000 (hex), %D-5 (decimal). Values are stored as unsigned bit patterns of the pin width (two's complement for negatives).
- output-list spec: name%Fa.b.c  where F in {B,D,X,S}; a = left pad spaces, b = field width, c = right pad spaces.
  * Column text = a spaces + formatted(b) + c spaces, columns separated by '|', line starts and ends with '|'.
  * D = decimal, right-aligned in b, interpreted SIGNED using the pin's bit width (e.g. 16-bit 0xFFFF -> -1).
  * B = binary, exactly b bits, least-significant b bits of the value, no padding spaces inside.
  * X = hex, exactly ceil(b) hex digits right-aligned zero-padded (verify against any %X usage in the repo; if unused, best effort).
  * S = string, LEFT-aligned in b (used for 'time').
  * The header line (written once, before any output line) contains each pin's display name CENTERED in width (a+b+c) with the extra space biased to the RIGHT (left pad = floor((width-len)/2)), truncated to the first 'width' chars if too long. Verify against real headers, e.g. projects/05/CPU.cmp header "|time| inM  |  instruction   |reset| outM  |writeM |addre| pc  |DRegiste|" from output-list "time%S0.4.0 inM%D0.6.0 instruction%B0.16.0 reset%B2.1.2 outM%D1.6.0 writeM%B3.1.3 addressM%D0.5.0 pc%D0.5.0 DRegister[]%D1.6.1".
- The special output column 'time': starts at 0. After 'tick' it renders "<n>+"; after 'tock' it renders "<n+1>" and n increments. Before any tick it renders "<n>". Confirmed by projects/03/a/Bit.cmp ("| 0+   |", "| 1    |", "| 1+   |", "| 2    |") and projects/05/ComputerAdd.cmp (first output before any tick is "| 0    |").
- Comparison to .cmp: line by line; the character '*' in the .cmp file is a WILDCARD matching any single character (projects/05/CPU.cmp uses "*******" for unchecked outM). Report the first mismatching line with both texts and the line number.
`;

phase('Build')

const results = await parallel([
  () => agent(`${COMMON}
${TST_SEMANTICS}

TASK: Build the HDL test-script runner.

Deliverables:
1. /workspace/agent_tests/hdl/tst.py - the .tst interpreter/runner library (parse + execute + format + compare), built on hdl/simulator.py.
2. /workspace/agent_tests/run_hdl_tests.py - CLI: \`python3 agent_tests/run_hdl_tests.py <paths...>\` where each path is a .tst file or a directory (recurse for *.tst). Prints one line per test: "PASS <path>" or "FAIL <path>: <reason / first diff>", then a summary "N passed, M failed". Exit code 1 if any failed. Support --timeout per test and skip/report chips whose HDL is still a "// TODO: implement" stub as "SKIP (stub)".
   IMPORTANT: write the generated output to the .out path named by the script but INSIDE a temp/scratch dir (e.g. /workspace/agent_tests/.out/<name>.out) so nothing under projects/ is ever written. projects/ must stay clean - verify with \`git status --short projects\` at the end (must be unchanged except pre-existing modifications to projects/01/*.hdl).
3. Extras needed for real scripts:
   - "while <lhs> <op> <rhs> { ... }" with ops <>, =, <, >, <=, >= comparing an output pin or internal value against a literal. projects/05/Memory.tst waits on the keyboard: \`while out <> 75 { tick, tock, }\`. Since there is no interactive user, implement this: when a while loop's condition can never change by ticking (i.e. it did not change after a few iterations) and the loaded chip contains a built-in 'Keyboard' instance, set that Keyboard's value to the literal from the condition (simulating the user pressing the key) and continue. Cap iterations (e.g. 200000) and fail loudly with a clear message rather than hanging.
   - "repeat { ... }" with no count: cap at a configurable number of iterations.
   - "<Chip> load <file>": load a .hack program into the named built-in instance (ROM32K.load_program already exists in builtins.py).
4. Self-verification you MUST run and report:
   a. /workspace/demo/Xor.tst against /workspace/demo/Xor.cmp -> must PASS (ground truth for formatting; note demo/Xor.hdl exists there).
   b. All of /workspace/projects/01/*.tst -> those chips are already implemented; they must all PASS. If any fails, first suspect YOUR runner, then report (do NOT edit the .hdl files - you are forbidden to).
   c. A synthetic negative test: prove the runner actually detects a wrong value (e.g. copy a chip into a scratch dir, break it, confirm FAIL). Keep it as agent_tests/test_runner_selfcheck.py.
Return: a concise report of what you built, the exact commands to run it, self-verification results (pass/fail counts), and any bug you fixed in simulator.py/builtins.py.`,
    {label: 'hdl-tst-runner', phase: 'Build'}),

  () => agent(`${COMMON}
${TST_SEMANTICS}

TASK: Build the Hack assembler + CPU emulator + the .tst runner for ASSEMBLY tests (projects/04). These tests do NOT use HDL at all - the official flow runs them in the CPUEmulator.

Deliverables:
1. /workspace/agent_tests/hack/assembler.py - a complete Hack assembler: strips comments/whitespace, two passes, labels "(LABEL)", predefined symbols R0-R15, SP, LCL, ARG, THIS, THAT, SCREEN=16384, KBD=24576, variables allocated from RAM 16 upward in order of first appearance, A-instruction "@n" or "@symbol", C-instruction "dest=comp;jump" with the standard comp/dest/jump tables (both a=0 and a=1 comps, including the non-standard-but-accepted mirrors like "A+D", "D&A" only if trivial - primary requirement is the canonical table). API: assemble_file(path) -> list[int]; also a CLI printing 16-bit binary lines.
2. /workspace/agent_tests/hack/emulator.py - a Hack CPU emulator: ROM (list of ints), RAM as a flat array of 24577 words (0..16383 data, 16384..24575 screen map, 24576 keyboard), registers A, D, PC. One "ticktock" = execute one instruction. Two's-complement 16-bit arithmetic (mask to 0xFFFF; jump comparisons use SIGNED interpretation). Keep the inner step loop TIGHT: it must be able to run 3,000,000 instructions in well under a couple of minutes (projects/04/fill/FillAutomatic.tst does 3 x 1,000,000 ticktocks). Consider precomputing decoded instructions.
3. /workspace/agent_tests/run_asm_tests.py - CLI running assembly .tst scripts: \`python3 agent_tests/run_asm_tests.py projects/04/mult/Mult.tst projects/04/fill/FillAutomatic.tst\`. Must support: load <prog>.asm (or .hack), output-file, compare-to, output-list with RAM[<n>]%D.. columns (and PC/A/D/time if present), set RAM[n] <v>, set PC <v>, ticktock, repeat n { ... }, repeat { } (capped), output, echo, clear-echo, while. Same formatting/comparison rules as the HDL runner (share the formatting code by importing from agent_tests/hdl/tst.py if convenient, or factor a common module agent_tests/common_fmt.py - your choice, but do not duplicate subtly different logic).
   Write .out files into a scratch dir, never into projects/.
   Note: for these scripts "output" must print the CURRENT RAM values; "set RAM[i] v" writes RAM directly; "set PC v" sets the program counter. Skip programs that are still "// TODO: implement" stubs, reporting SKIP (stub).
4. Self-verification you MUST run and report:
   a. Assembler agreement test: /workspace/projects/06/pong/Pong.asm (with symbols) and /workspace/projects/06/pong/PongL.asm (symbol-less) are the SAME program - assembling both must yield IDENTICAL binaries. This is a strong assembler self-test. Also check line counts.
   b. Emulator test: run /workspace/projects/05/Add.hack (adds 2+3 into RAM[0]) for 6 steps -> RAM[0] must be 5. Run /workspace/projects/05/Max.hack with RAM[0]=8, RAM[1]=3 -> RAM[2]=8; with RAM[0]=2, RAM[1]=9 -> RAM[2]=9. Run /workspace/projects/05/Rect.hack with RAM[0]=3 and check that words 16384,16416,16448 become -1 (0xFFFF) and 16480 stays 0.
   c. Performance check: time 1,000,000 ticktocks of a small loop and report instructions/second.
   Keep these as agent_tests/test_hack_selfcheck.py.
Return: a concise report of what you built, exact commands, and self-verification results.`,
    {label: 'hack-asm-emulator', phase: 'Build'}),

  () => agent(`${COMMON}

TASK: Build an independent equivalence property-tester for HDL chips, using ONLY the existing simulator (agent_tests/hdl/simulator.py) and the golden built-in implementations (agent_tests/hdl/builtins.py). This is an oracle that is independent of the official .cmp files.

Deliverable: /workspace/agent_tests/test_equiv.py

Behaviour: \`python3 agent_tests/test_equiv.py [chip-or-dir ...]\` (default: check every implemented chip it knows about under projects/01, projects/02, projects/03/a, projects/03/b).
For each COMBINATIONAL user chip that has a built-in counterpart of the same name (Not, And, Or, Xor, Mux, DMux, Not16, And16, Or16, Mux16, Or8Way, Mux4Way16, Mux8Way16, DMux4Way, DMux8Way, HalfAdder, FullAdder, Add16, Inc16, ALU):
  - load projects/<dir>/<Chip>.hdl with the Simulator, drive its input pins over EXHAUSTIVE inputs when the input space is <= 65536 combinations, otherwise a deterministic pseudo-random sample (seed fixed, e.g. random.Random(12345)) of at least 4000 vectors PLUS hand-picked edge vectors (0, 1, -1/0xFFFF, 0x8000, 0x7FFF, alternating patterns) - and for the ALU, ALL 64 control-bit combinations crossed with those edge x/y values.
  - compare every output pin against the built-in reference function; report the first few mismatches with the exact input vector.
For SEQUENTIAL user chips (Bit, Register, PC, RAM8, RAM64, RAM512, RAM4K, RAM16K): drive a deterministic randomized sequence of (in, load, address, inc, reset) with tick/tock and compare against the corresponding built-in class from builtins.py step by step (read outputs after tock, and also check that outputs do NOT change during the tick phase for registers). Use a modest number of steps for the big RAMs (they are slow: RAM16K expands to hundreds of built-in RAM64 instances) - e.g. 300 steps, but cover: writing then reading back several addresses, address aliasing across banks (make sure a write to one bank does not disturb another), load=0 holding value, and boundary addresses (0, size-1, and each bank's first/last).
Print "PASS <Chip> (<n> vectors)" / "FAIL <Chip>: ..." and a summary; exit 1 on any failure. SKIP chips whose .hdl is still a "// TODO: implement" stub.
Self-verify NOW against projects/01 (already implemented - all must pass) and confirm the stub chips are reported SKIP, not crash.
Return: what you built, the command, and results.`,
    {label: 'equiv-prop-tester', phase: 'Build'}),
])

phase('Audit')

const audit = await agent(`You are auditing a locally-built test harness for the nand2tetris project in /workspace/agent_tests/ (files: hdl/simulator.py, hdl/builtins.py, hdl/tst.py, run_hdl_tests.py, hack/assembler.py, hack/emulator.py, run_asm_tests.py, test_equiv.py).

The harness must faithfully reproduce the official nand2tetris HardwareSimulator/CPUEmulator behaviour, because it is the only thing standing between the author and a silently-wrong submission. Your job is to find places where the harness would report PASS for an implementation the official tools would REJECT (false negatives are far worse than false positives here), or where it would report FAIL for correct HDL.

Check specifically, by reading code AND by running things:
1. Output formatting fidelity: %B/%D/%X/%S padding, signed decimal for D using pin width, the header line, the 'time' column semantics (tick -> "n+", tock -> "n+1"), '*' wildcard handling in .cmp comparison, CRLF tolerance. Ground truth available: /workspace/demo/Xor.cmp and the *.cmp files under projects/01..05.
2. Clock semantics: during tick, outputs of clocked chips must NOT change; state commits at tock. Sequential chips inside deep hierarchies (RAM16K -> RAM4K -> RAM512 -> built-in RAM64) must all be clocked.
3. Chip resolution order: a part name resolves to <Name>.hdl in the loaded chip's directory first, else to the built-in. (This is why projects/03/b/RAM512.hdl gets a BUILT-IN RAM64, and projects/05/CPU.hdl gets built-in ALU/ARegister/DRegister/PC.)
4. Bus/sub-bus wiring: internal wires, out=x,out=y fan-out, sub-bus on both sides (a[0..7]=x), 'true'/'false' constants, and the official rule that an internal wire's width is inferred. Look for cases the parser silently mis-handles (e.g. a[3..5]=w[1..3]) and write a focused test.
5. Assembler correctness: comp/dest/jump tables bit-exact. Verify by assembling /workspace/projects/05/Add.hack's source-equivalent instructions and by the Pong.asm vs PongL.asm identity.
6. Emulator correctness: signed jump comparisons, M reads/writes through the screen/keyboard map, PC semantics (jump target is the A register, PC increments otherwise), reset.
7. Does anything write into /workspace/projects/? (It must not.) Run \`git status --short\` before and after a full harness run and confirm no new/changed files under projects/.

For every real defect you find, FIX it (you may edit files under /workspace/agent_tests/ only) and add a regression test. Do not commit to git.
Return: a list of defects found (with severity), what you fixed, what you could not fix, and the final self-verification results of the whole harness (commands + pass/fail counts).`,
  {label: 'harness-audit', phase: 'Audit', effort: 'high'})

return {build: results.map(r => (r || '').slice(0, 2000)), audit}
