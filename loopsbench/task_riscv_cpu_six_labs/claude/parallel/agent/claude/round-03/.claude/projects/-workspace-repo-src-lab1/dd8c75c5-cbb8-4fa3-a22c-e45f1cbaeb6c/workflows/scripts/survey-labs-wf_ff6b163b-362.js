export const meta = {
  name: 'survey-labs',
  description: 'Survey all 6 RISC-V lab directories and produce detailed implementation specs for each hollowed-out module',
  phases: [
    { title: 'Survey', detail: 'one agent per lab reads every file and reports TODOs + interfaces' },
  ],
}

const LABS = [
  { id: 'lab2', note: 'CSR + ExceptionUnit extension of lab1 5-stage pipeline' },
  { id: 'lab3', note: 'UART-in-RAM + extended hazards 5-stage pipeline' },
  { id: 'lab4', note: 'cache hierarchy (CMU + data_ram) 5-stage pipeline variant' },
  { id: 'lab5', note: 'scoreboard OoO; only 5 FU modules hollowed' },
  { id: 'lab6', note: 'Tomasulo OoO; FUs + CtrlUnit + Regs(RAT) + RAM_B + ImmGen + RV32core' },
]

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lab', 'todoFiles', 'report'],
  properties: {
    lab: { type: 'string' },
    todoFiles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'whatIsMissing'],
        properties: {
          path: { type: 'string' },
          whatIsMissing: { type: 'string' },
        },
      },
    },
    report: {
      type: 'string',
      description: 'Full detailed markdown report: module interfaces, exact signal semantics, parameter encodings, how pre-provided modules expect the hollowed ones to behave, the test program and expected values, and any gotchas.',
    },
  },
}

phase('Survey')

const results = await parallel(LABS.map((l) => () =>
  agent(
    `You are surveying an undergraduate RISC-V (RV32IM) Verilog CPU lab so that another engineer can implement the hollowed-out modules with zero further exploration.

Target: /workspace/repo/src/${l.id}/   (${l.note})
Also read: /workspace/repo/docs/${l.id}.md  and /workspace/repo/src/${l.id}/README.md if present.
Reference for style/conventions: /workspace/repo/src/lab1/ (same project, sibling lab).

Do ALL of this:
1. Read EVERY .v / .vh file under /workspace/repo/src/${l.id}/ (core/, common/, sim/, cache/ if present). Do not skip files that look pre-provided — the pre-provided modules define the contract the hollowed ones must satisfy.
2. Identify every file containing "TODO" / hollowed-out stub logic. For each, record the exact module port list and precisely what logic is missing.
3. Read the lab's simulation testbench(es) under sim/ and note exactly which hierarchical signal names the testbench references (e.g. core.rd_WB). These names MUST be preserved.
4. Read the lab's test program: any .s / .S / .txt assembly listing, and core/rom.mem + core/ram.mem (and lab3_rom.mem/lab3_ram.mem for lab6). Report the expected register values / PCs the test checks.
5. Report every parameter/encoding definition the hollowed modules must match (ALU op codes, cmp codes, ImmSel codes, CtrlDefine.vh contents, FU op encodings, CSR addresses, exception causes, cache/CMU handshake protocol, etc.). Quote them verbatim.
6. Note whether an IP module (e.g. \`multiplier\`, \`divider\`) is referenced but not defined anywhere in the tree — say so explicitly and give the exact instantiation port names expected by any surrounding code or comments.
7. List any behavioural gotchas: clocking, reset polarity, endianness, address decoding ranges, write-through requirements, stall/flush priority.

Return a thorough report. Be exhaustive and quote code verbatim where precision matters. Length is not a concern — completeness is.`,
    { label: `survey:${l.id}`, phase: 'Survey', schema: SCHEMA }
  )
))

return results.filter(Boolean)
