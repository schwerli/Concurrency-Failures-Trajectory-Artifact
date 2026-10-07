export const meta = {
  name: 'labs56-ooo-impl',
  description: 'Implement lab5 (scoreboard OoO) and lab6 (Tomasulo OoO) RISC-V cores with iverilog simulation validation',
  phases: [
    { title: 'Implement', detail: 'one agent per lab: implement all hollowed modules + validate by simulation' },
    { title: 'Verify', detail: 'independent adversarial verification by simulation' },
    { title: 'Fix', detail: 'apply fixes for confirmed defects' },
  ],
}

const COMMON = `
## Environment / hard rules

- Repo root: /workspace/repo. You may ONLY modify files under /workspace/repo/src/<LAB>/ and create
  scratch/test files under /workspace/agent_tests/<LAB>/. Never touch other labs, never touch /workspace/requirements,
  never run ANY git command (no add/commit/checkout/stash/clean). The orchestrator handles git.
- Tooling available: iverilog 12.0 and vvp (Icarus Verilog). No Vivado. No Xilinx IP libraries.
- CRITICAL: a hidden grading test suite compiles the lab's Verilog with iverilog and instantiates the
  design, monitoring signals via HIERARCHICAL access (e.g. core.some_wire, core.some_instance.reg).
  Therefore: DO NOT rename or delete any existing module name, port name, parameter name, instance name,
  or internal wire/reg name that already exists in the framework. Only ADD/complete logic. You may add new
  internal wires/regs and new modules where the framework requires them.
- CRITICAL: do NOT create Verilog modules named \`multiplier\` or \`divider\`, and do NOT instantiate them.
  Those are Xilinx IP cores that do not exist in this environment; the grading harness may or may not supply
  them, and a duplicate definition would break compilation. Instead implement the multiply/divide arithmetic
  *inline* inside FU_mul.v / FU_div.v using behavioral Verilog (e.g. \`*\`, \`/\`, \`%\`, signed casts) while keeping
  the exact same latency/handshake state machine that the TODO comments describe. For FU_div you must generate
  the internal \`res_valid\` signal yourself (it is a \`wire\` declared in the framework - you may change it to a
  reg or drive it from your own logic, but keep the name \`res_valid\` and keep \`finish = res_valid & state\`
  semantics working).
- Keep \`timescale directives and the existing file layout intact.
- Do not leave any \`// TODO\` marker unimplemented. Every hollowed-out assignment must become real logic.

## How to build and run a simulation

The FPGA top-level (auxillary/top.v) pulls in a VHDL file, so do NOT try to compile auxillary/top.v.
Write your own minimal testbench that instantiates RV32core directly. Because \`$readmemh("rom.mem", ...)\`
uses a path relative to the *runtime working directory*, run vvp from a directory containing rom.mem/ram.mem,
or copy them next to the simulation. A working recipe:

    mkdir -p /workspace/agent_tests/<LAB>
    cd /workspace/agent_tests/<LAB>
    cp /workspace/repo/src/<LAB>/core/*.mem .
    iverilog -g2012 -o sim.vvp tb.v \\
        /workspace/repo/src/<LAB>/core/*.v \\
        /workspace/repo/src/<LAB>/common/*.v \\
        /workspace/repo/src/<LAB>/auxillary/debug_clk.v \\
        -I /workspace/repo/src/<LAB>/core
    vvp sim.vvp

(Adjust: exclude any file that defines a duplicate module; add \`-I\` include dirs for CtrlDefine.vh.)

Your testbench should drive clk/rst exactly like the provided sim file (clk starts 0, toggles every 1ns,
rst=1 then 0 at t=2), run for a few thousand ns, and print/compare the architectural register file contents
plus a trace of write-backs so you can compare against the expected values documented in the lab's
reference assembly listing.

## Definition of done

You are NOT done until: (a) every TODO is implemented, (b) the design compiles with zero errors under
iverilog, and (c) your simulation shows the architectural register values matching EVERY expected value
documented in the lab's reference assembly file. Iterate until this holds. If some expectation genuinely
cannot be met, say so explicitly and explain why in your final report.

## Final report format (this text is your return value)

  FILES CHANGED: <list>
  SIM RESULT: <pass/fail per expected register value, with actual values>
  REMAINING ISSUES: <list or "none">
`

const LABS = [
  {
    id: 'lab5',
    prompt: `You are implementing **Lab 5** of a RISC-V (RV32IM) teaching CPU: out-of-order execution with a
scoreboard. Read these first, completely:
  - /workspace/repo/docs/lab5.md  (Chinese; the assignment description)
  - /workspace/repo/src/lab5/README.md
  - /workspace/repo/src/lab5/ref/inst.S  (the test program WITH the expected register value after each instruction)
  - every file under /workspace/repo/src/lab5/core/ and /workspace/repo/src/lab5/common/
  - /workspace/repo/src/lab5/core/CtrlUnit.v is the pre-provided scoreboard - study exactly how it drives
    ALU_en/MEM_en/MUL_en/DIV_en/JUMP_en and how it consumes ALU_done/MEM_done/MUL_done/DIV_done/JUMP_done,
    because your functional units must match that handshake protocol precisely.
  - /workspace/repo/src/lab5/core/RV32core.v shows exactly how each FU is wired.

Modules to implement (all in /workspace/repo/src/lab5/core/):
  - FU_ALU.v : stateful 1-cycle ALU FU. On (EN & ~state) latch ALUA/ALUB/ALUControl and set state=1; when
    state==1 clear state to 0 so finish is a single-cycle pulse. Implement all ops: ADD(4'b0001) SUB(0010)
    AND(0011) OR(0100) XOR(0101) SLL(0110) SRL(0111) SLT(1000) SLTU(1001) SRA(1010) A+4(1011)
    B-passthrough(1100). SLT is signed, SLTU unsigned, SRA arithmetic. zero = (res==0).
    overflow = signed overflow for ADD/SUB. The result must be computed from the LATCHED registers so it is
    stable during the finish cycle.
  - FU_mul.v : 64-cycle latency. On (EN & ~|state) latch A,B and set state=7'b100_0000; every cycle shift
    state right by 1; finish when state[0]==1. res = lower 32 bits of A*B (unsigned lower bits are identical
    for signed/unsigned so a plain A_reg*B_reg lower word is fine). Result must be stable when finish is high.
  - FU_div.v : quotient of A/B. Keep \`finish = res_valid & state\`. On (EN & ~state) latch A,B, assert
    A_valid/B_valid, set state=1. Model the divider with a small latency (a shift/counter of roughly 30-40
    cycles is realistic) that eventually raises res_valid for one cycle; the framework computes the result
    from divres[63:32] (quotient in the upper half, remainder in the lower half) - keep that structure by
    building a 64-bit \`divres\` wire/reg yourself as {quotient, remainder}. Guard against divide-by-zero
    (do not let iverilog produce x; RISC-V says quotient = all ones on divide by zero - any non-x value is
    acceptable but must not hang the machine). The test program only uses \`div\` with positive operands
    (0x0fff0000 / 8 = 0x01ffe000) - make signed division correct.
  - FU_jump.v : latch on (EN & ~state), state=1 then back to 0. Use the provided cmp_32 module to compare
    rs1_data_reg vs rs2_data_reg with cmp_ctrl_reg[3:1] (note: cmp_32 takes a 3-bit ctrl; the JUMP op
    encoding is documented in ../lab6/core/CtrlDefine.vh as "0; cmp ctrl in cmp_32; 0 stands for branch",
    i.e. bit0 = unconditional-jump flag and bits[3:1] = the cmp_32 ctrl - VERIFY this against how
    lab5's CtrlUnit.v builds JUMP_op / Jump_ctrl before committing to a bit layout).
    PC_jump = (JALR ? rs1_data_reg : PC_reg) + imm_reg ; PC_wb = PC_reg + 4 ;
    is_jump = cmp_ctrl_reg[0] | cmp_res.
  - FU_mem.v : 2-cycle latency. On (EN & ~|state) latch mem_w/bhw/rs1_data/rs2_data/imm and set state=2'b10;
    shift right each cycle; finish when state[0]==1. Compute address with the provided add_32 module
    (rs1_data_reg + imm_reg) and instantiate the provided RAM_B for the access (dina = rs2_data_reg,
    wea = mem_w_reg gated so the write happens exactly once, mem_u_b_h_w = bhw_reg). mem_data = RAM_B douta,
    stable when finish is high. lab5's RAM_B.v is already fully implemented - read it and match its timing
    (it writes on negedge clka).

Then validate with a simulation as described below, comparing against every "# x? = 0x..." comment in
ref/inst.S. The scoreboard writes the register file on the negedge, so sampling register contents at the
end of the run and also tracing (rd_ctrl, wt_data_WB) whenever RegWrite_ctrl is high is the best check.
` + COMMON.replace(/<LAB>/g, 'lab5'),
  },
  {
    id: 'lab6',
    prompt: `You are implementing **Lab 6** of a RISC-V (RV32IM) teaching CPU: full Tomasulo out-of-order
execution with reservation stations, a Common Data Bus (CDB) and a Register Alias Table (RAT).
This is the hardest lab. Read these first, completely:
  - /workspace/repo/docs/lab6.md  (Chinese; the assignment description - it explains the RS/RAT/CDB design
    and explicitly says you must implement the \`RS\` module yourself, matching the interface used in RV32core.v)
  - /workspace/repo/docs/lab5.md and /workspace/repo/src/lab5/ref/inst.S (lab6 reuses lab5's test program:
    src/lab6/core/rom.mem + ram.mem are the same lab5 program, with the expected per-instruction register
    values documented in /workspace/repo/src/lab5/ref/inst.S)
  - /workspace/repo/src/lab6/README.md, /workspace/repo/src/lab6/test.s, /workspace/repo/src/lab6/test.txt
  - every file under /workspace/repo/src/lab6/core/ and /workspace/repo/src/lab6/common/, especially
    core/CtrlDefine.vh (macros for FU ids, RS entry bit fields, and op encodings) and core/RV32core.v
    (which shows the exact RS port list you must implement, via the single provided \`rs_alu\` instance).

Modules/logic to implement (all under /workspace/repo/src/lab6/):
  1. core/ImmGen.v  - I/B/J/S/U sign-extended immediates (identical to lab5's already-complete ImmGen.v;
     use it as the reference).
  2. core/RAM_B.v   - 512-byte byte-addressable RAM with sign/zero-extended byte/half/word reads, negedge
     writes, plus the simulated-UART behaviour described in the TODO comments (word store to
     SIM_UART_ADDR = 32'h10000000 prints the ASCII char of the low byte via $write, gated on \`finish\`).
     lab5/core/RAM_B.v and lab3/core/RAM_B.v are useful references.
  3. core/CtrlUnit.v - finish the decode: ALU_use/MEM_use/MUL_use/DIV_use/JUMP_use routing (from the already
     provided use_ALU/use_MEM/... wires), the 5-bit \`op\` encoding using the \`define macros in CtrlDefine.vh,
     dst_ctrl (0 when the instruction writes no register - branches and stores!), rs1_ctrl/rs2_ctrl
     (0 when unused, so no false dependency is created), ALU_use_PC, ALU_use_imm, ImmSel.
  4. core/Regs.v - the RAT. rs_num_A/rs_num_B are the 8-bit RAT tags for R_addr_A/R_addr_B (must read 0 for
     x0, and must reflect the CDB broadcast happening in the same cycle if your design needs that). On the
     negedge: if a RAT entry equals cdb_rs_num (and is nonzero) then commit cdb_data into that architectural
     register and clear the RAT entry; and if rs_rd_w_en then set rat[R_addr_rd] = rs_num_rd (never for x0).
     Be careful about the ordering when a broadcast and an issue touch the same architectural register in the
     same cycle: the newly issued instruction's tag must win.
  5. core/RS.v (NEW FILE you must write) - a parameterised reservation station bank
     \`module RS #(parameter FU = 3'd0, parameter num = 1) (...)\` with EXACTLY the port names used in
     RV32core.v's rs_alu instance: clk, rst, selected, free_rs, op, Qj, Qk, Vj, Vk, A, pc_IS, en_FU, vj, vk,
     op_out, A_o, pc_FU, cdb_rs_rd, cdb_rs_num, cdb_data, pc_debug. Semantics:
       * \`free_rs\` is an output: the 8-bit tag {FU, entry_index} of a currently free entry (0 if none free).
         The tag layout is documented in Regs.v: bits[7:5] = FU type, bits[4:0] = rs number. Use a nonzero
         entry numbering so that tag 0 unambiguously means "value already in register file / no free entry".
       * \`selected\` means "the instruction currently at Issue belongs to this FU"; combined with the core's
         issue-enable it allocates \`free_rs\` and writes op/Qj/Qk/Vj/Vk/A/pc_IS into that entry.
       * Each entry holds busy/op/Qj/Qk/Vj/Vk/A/pc (see the bit-field macros in CtrlDefine.vh).
       * Snoop the CDB: whenever cdb_rs_num matches an entry's Qj/Qk, capture cdb_data into Vj/Vk and clear
         the corresponding Q.
       * When an entry has Qj==0 && Qk==0 and the FU is not busy, drive en_FU plus vj/vk/op_out/A_o/pc_FU
         for that entry (pick one entry with a deterministic priority) and output its tag on \`cdb_rs_rd\`
         so the core knows which tag to broadcast when the FU finishes; free the entry when its result is
         broadcast on the CDB.
     Add RS instances for MEM, MUL, DIV and JUMP too (the wires rs_num_rd_MEM/MUL/DIV/JUMP, MEM_src1/…,
     MEM_rs_rd/… are already declared in RV32core.v). Give the MEM reservation station exactly ONE entry so
     memory accesses stay in program order, as the doc suggests.
  6. core/RV32core.v - all the TODOs: PC_EN_IF, the branch mux select, REG_IF_IS flush, rs_rd_w_en,
     rs_num_rd selection (pick the free tag of the FU this instruction needs), ctrl_stall / FU_stall / IS_EN
     stall logic (on a jump/branch instruction stall issue until the jump FU resolves, exactly like lab5;
     stall on structural hazard = no free RS entry), all RS port connections (Qj/Qk/Vj/Vk from the RAT +
     register file: if rs_num_A != 0 then Qj = rs_num_A else Vj = rdata_A, etc.), all five FU input
     connections (driven from the RS outputs, decoding \`op\` per CtrlDefine.vh into the FU control encodings
     that FU_ALU/FU_mem/FU_jump expect), and the CDB arbitration: when several FUs finish in the same cycle
     pick one with a fixed priority (use the provided \`done_record\` reg to remember and delay the others),
     driving cdb_data / cdb_rs_num / cdb_pc. \`wb_addr = cdb_pc\` and \`wb_data = cdb_data\` are the signals the
     grader watches, so make sure a completing instruction broadcasts its PC on cdb_pc and its value on cdb_data.
  7. core/FU_ALU.v, FU_mul.v, FU_div.v, FU_jump.v, FU_mem.v - same five functional units as lab5. Their
     TODO comments in src/lab6 describe them; implement them the same way (see below). Note lab6's FU_mem
     instantiates lab6's RAM_B which has an extra \`finish\` input for the UART simulation.

Functional unit details (identical in both labs):
  - FU_ALU: latch on (EN & ~state), state=1 for one cycle. Ops: ADD=4'b0001 SUB=0010 AND=0011 OR=0100
    XOR=0101 SLL=0110 SRL=0111 SLT=1000 SLTU=1001 SRA=1010 A+4=1011 Bout=1100. zero=(res==0),
    overflow=signed ADD/SUB overflow. Compute from the latched registers.
  - FU_mul: 64-cycle latency via the 7-bit shifting state register, res = low 32 bits of A*B.
  - FU_div: keep \`finish = res_valid & state\`; build a 64-bit divres = {quotient, remainder} and take
    divres[63:32]; model a ~30-40 cycle latency yourself and raise res_valid for one cycle. Signed division.
    Never produce x, never hang on divide-by-zero.
  - FU_jump: cmp via cmp_32 on the latched operands; PC_jump = (JALR ? rs1 : PC) + imm; PC_wb = PC + 4;
    is_jump = cmp_ctrl_reg[0] | cmp_res.
  - FU_mem: 2-cycle latency (state 2'b10 -> 2'b01), address = add_32(rs1_data_reg, imm_reg), instantiate RAM_B.

Validate with simulation: the design must execute src/lab6/core/rom.mem (same program as lab5) and produce
every expected register value from /workspace/repo/src/lab5/ref/inst.S. Additionally verify it can run
lab3's larger program: temporarily copy core/lab3_rom.mem to your simulation directory as rom.mem and
core/lab3_ram.mem as ram.mem and confirm the program runs (that program sorts an array and ends in an
infinite loop; it uses the simulated UART). Note ROM_D in lab6 is addressed with PC_IF[10:2] but its array
is only 128 entries deep - check whether the lab3 program needs a bigger ROM and enlarge \`inst_data\` in
core/ROM_D.v if required (that is an allowed change; keep the module/port names). IMPORTANT: leave the
final committed state of core/ROM_D.v and core/RAM_B.v reading "rom.mem" and "ram.mem" respectively, and
leave src/lab6/core/*.mem files unmodified.
` + COMMON.replace(/<LAB>/g, 'lab6'),
  },
]

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    compiles: { type: 'boolean' },
    all_expected_values_match: { type: 'boolean' },
    defects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          summary: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['file', 'summary', 'evidence'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['compiles', 'all_expected_values_match', 'defects', 'notes'],
}

const results = await pipeline(
  LABS,
  (lab) => agent(lab.prompt, { label: `impl:${lab.id}`, phase: 'Implement' }),
  (implReport, lab) => agent(
    `You are an INDEPENDENT verifier for **${lab.id}** of a RISC-V teaching CPU project at /workspace/repo/src/${lab.id}.
Another engineer just claimed to have implemented it. Their report:

---
${implReport}
---

Do NOT trust that report. Verify it yourself, adversarially:
1. Read every file under /workspace/repo/src/${lab.id}/core/ and check that no \`TODO\` placeholder logic remains
   (e.g. \`assign x = 32'b0; // TODO\`).
2. Build and run a simulation YOURSELF with iverilog/vvp (write your own testbench under
   /workspace/agent_tests/${lab.id}_verify/, copying the .mem files into the run directory). Do not reuse their
   testbench without reading it - check it actually proves what it claims and is not hard-coding results.
3. Compare the architectural register values against the expected values documented in the reference
   assembly listing (${lab.id === 'lab5' ? '/workspace/repo/src/lab5/ref/inst.S' : '/workspace/repo/src/lab5/ref/inst.S (lab6 runs the same program)'}).
4. Look for classic Verilog defects: latches driven from multiple always blocks, x-propagation, reset that
   never clears state, blocking vs non-blocking misuse, off-by-one in a state shift register, a finish pulse
   that lasts more than one cycle, missing sign extension, unguarded array index out of range.
5. Check the hard constraint: no module named \`multiplier\` or \`divider\` may be defined or instantiated
   anywhere under src/${lab.id}.

Do NOT modify any file under /workspace/repo. You are read-only there (you may create files under
/workspace/agent_tests/${lab.id}_verify/). Never run git.

Report structured findings.`,
    { label: `verify:${lab.id}`, phase: 'Verify', schema: VERIFY_SCHEMA },
  ).then((v) => ({ lab, implReport, verdict: v })),
  async (v) => {
    if (!v) return null
    if (v.verdict && v.verdict.compiles && v.verdict.all_expected_values_match && (v.verdict.defects || []).length === 0) {
      log(`${v.lab.id}: verifier found no defects`)
      return { lab: v.lab.id, fixed: false, verdict: v.verdict }
    }
    const fix = await agent(
      `You are fixing **${v.lab.id}** of a RISC-V teaching CPU at /workspace/repo/src/${v.lab.id}.
An independent verifier reported these problems:

compiles: ${v.verdict ? v.verdict.compiles : 'unknown'}
all expected register values match: ${v.verdict ? v.verdict.all_expected_values_match : 'unknown'}
notes: ${v.verdict ? v.verdict.notes : 'verifier failed to report'}
defects:
${((v.verdict && v.verdict.defects) || []).map((d, i) => `${i + 1}. [${d.file}] ${d.summary}\n   evidence: ${d.evidence}`).join('\n')}

Fix every real defect. First reproduce it with your own iverilog simulation, then fix, then re-run and prove
the fix. If a reported "defect" is actually a false alarm, verify that carefully and explain why in your report.
You must end with a compiling design whose simulation reproduces every expected register value from the
lab's reference assembly listing.
` + COMMON.replace(/<LAB>/g, v.lab.id),
      { label: `fix:${v.lab.id}`, phase: 'Fix' },
    )
    return { lab: v.lab.id, fixed: true, verdict: v.verdict, fixReport: fix }
  },
)

return results.filter(Boolean)
