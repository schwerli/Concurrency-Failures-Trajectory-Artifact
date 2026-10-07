export const meta = {
  name: 'p5-p6-recon',
  description: 'Deep reconnaissance of Project5 (net driver) and Project6 (file system) so the main agent can implement them',
  phases: [
    { title: 'Recon', detail: 'parallel readers over P5 and P6 subsystems' },
    { title: 'Critic', detail: 'find gaps each reader missed' },
  ],
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'findings'],
  properties: {
    area: { type: 'string' },
    findings: { type: 'string', description: 'Detailed markdown report. Include exact file paths, exact function signatures, exact struct/field names, exact constant names+values, and verbatim short code excerpts where they matter.' },
  },
}

const AREAS = [
  {
    key: 'p5-net',
    prompt: `Read /workspace/Project5-Device_Driver thoroughly, focusing on the NETWORK DRIVER.

Report EXACTLY (with file:line references and verbatim excerpts):
1. drivers/net.c in full: every existing function, every global, every TODO stub and its exact signature.
2. drivers/net.h (or wherever the prototypes live) - full contents.
3. The GigabitEthernet / e1000 style register definitions available (drivers/*.h, include/*): mac_send_desc / mac_recv_desc struct layout, register offsets, EMAC/DMA register names, any provided helper functions already implemented (e.g. set_sram_ctrl, net_poll_mode, mac_recv_desc etc).
4. How net interrupts reach the driver: PLIC setup, irq.c registration, EXCC/IRQC constants, net_handle_irq, screen/printk.
5. Every caller of do_net_send / do_net_recv / do_net_irq_mode: kernel/syscall, init/main.c syscall table, tiny_libc/syscall.c, include/sys/syscall.h, test programs under test/ that use networking (quote their main()).
6. Whether do_net_recv must block the caller, and how the tests expect the return value (bytes received? number of packets?) and frLength array semantics.
7. Anything under include/os/net.h.
Be exhaustive and precise; this is used to write the implementation.`,
  },
  {
    key: 'p5-diff',
    prompt: `Compare /workspace/Project4-Virtual_Memory_Management with /workspace/Project5-Device_Driver.

/workspace/Project4-Virtual_Memory_Management/kernel/mm/mm.c is ALREADY IMPLEMENTED in the working tree (read it).
Project5's kernel/mm/mm.c and kernel/sched/sched.c contain '/* TODO: implement */' stubs.

Report EXACTLY:
1. diff of include/os/mm.h, include/os/sched.h, include/os/*.h between P4 and P5 - every structural difference (new fields in pcb_t, new constants, new function prototypes).
2. diff of arch/riscv/include/pgtable.h, init/main.c, kernel/irq/irq.c, kernel/syscall/syscall.c, drivers/screen.c, arch/riscv/kernel/entry.S between P4 and P5.
3. The exact list of functions stubbed out in P5's mm.c and sched.c (grep -n 'TODO: implement' with surrounding signature).
4. What P5's init/main.c expects from init_page_table / alloc_page_helper / load_elf / do_exec (quote init_pcb()).
5. Any P5-only helper in mm.h/mm.c (e.g. alloc_page_helper prototype, share page helpers, net dma buffer mapping).
6. The Makefile differences (new source files, new targets).
Output a precise porting checklist: for each P4 function, does it need changes for P5 and what.`,
  },
  {
    key: 'p6-fs',
    prompt: `Read /workspace/Project6-File_System thoroughly, focusing on the FILE SYSTEM.

Report EXACTLY (file:line + verbatim excerpts):
1. Every file under kernel/fs/ - full listing of existing code and every '/* TODO: implement */' stub with its exact signature.
2. include/os/fs.h (and any other fs headers): every struct (superblock, inode, dentry/dir_entry, fdesc), every field with its type, every #define (magic, block size, sector size, FS_START sector, inode count, bitmap sizes, direct/indirect pointer counts, file type enums, access mode enums like O_RDONLY/O_WRONLY/O_RDWR).
3. disk.c / sd card access helpers: sbi_sd_read / sbi_sd_write wrappers, block read/write helpers already provided.
4. Every caller: init/main.c syscall table entries, kernel/syscall, tiny_libc/syscall.c, include/sys/syscall.h, and the shell test program (test/test_shell.c or similar) - quote how mkfs/statfs/mkdir/rmdir/ls/cd/touch/cat/ln/fopen/fread/fwrite/fclose are invoked and what output format the shell prints (this pins down return-value conventions and the 'int *print_location_y' parameter of do_ls).
5. The exact semantics the shell expects for do_ls(char *dirname, int mode, int *print_location_y) - what mode values mean (-l ?), and how print_location_y is used.
6. do_link(char *filename, char *newfile, int mode) - what mode values distinguish hard vs soft link.
7. Any provided fs constants for on-disk layout (superblock sector, block map, inode map, inode table, data blocks).
Be exhaustive; this is used to write a complete on-disk file system.`,
  },
  {
    key: 'p6-diff',
    prompt: `Compare /workspace/Project5-Device_Driver with /workspace/Project6-File_System.

Report EXACTLY:
1. diff of include/os/mm.h, include/os/sched.h, arch/riscv/include/pgtable.h, init/main.c, kernel/irq/irq.c, kernel/mm/mm.c, kernel/sched/sched.c between P5 and P6.
2. The exact list of '/* TODO: implement */' stubs in P6 (all files, with signatures), grouped by file.
3. P6's Makefile: source file list, new targets, how the fs image / sd card is prepared.
4. Whether P6's mm.c/sched.c differ from P5's at all beyond the stubs (compare the non-stub parts verbatim).
5. P6's init/main.c: quote init_pcb() and init_syscall() in full.
Output a precise porting checklist.`,
  },
  {
    key: 'build-env',
    prompt: `Determine how Project5-Device_Driver and Project6-File_System BUILD in this container.

Facts already known: the cross prefix in the Makefiles is riscv64-unknown-linux-gnu- but only riscv64-linux-gnu-gcc exists; the checked-in host tools elf2char/createimage/generateMapping are mode 644 (not executable); gcc 13 needs -fcommon for the generated user_programs.h.
/workspace/agent_tests/build.sh already automates: copy project to /tmp/b/<first 8 chars of project dir>, chmod +x tools, rewrite CROSS_PREFIX, append -fcommon, run make.

Task: run '/workspace/agent_tests/build.sh Project5-Device_Driver main' and '/workspace/agent_tests/build.sh Project6-File_System main' and report:
1. Whether they build with the current stubs (they should - stubs return 0).
2. Every compile/link error or warning that is NOT a pre-existing warning, verbatim.
3. Any extra Makefile targets needed (e.g. 'make user', 'make image', fs image creation) and whether they work.
4. The full list of source files each project compiles.
Do NOT modify anything under /workspace - only read and run the build script.`,
  },
]

phase('Recon')
const reports = await parallel(AREAS.map(a => () =>
  agent(a.prompt, { label: `recon:${a.key}`, phase: 'Recon', schema: SCHEMA })
))

const good = reports.filter(Boolean)
log(`recon complete: ${good.length}/${AREAS.length} areas reported`)

phase('Critic')
const critique = await agent(
  `You are the completeness critic for a reconnaissance pass over two OS-lab projects that must now be implemented from scratch.

Here are the reports produced so far:

${good.map(r => `### AREA: ${r.area}\n${r.findings}`).join('\n\n---\n\n')}

Independently verify against the real files under /workspace/Project5-Device_Driver and /workspace/Project6-File_System. Report:
1. Any factual error in the reports above (wrong signature, wrong constant, wrong path).
2. Anything MISSING that an implementer would need: unlisted stub, unquoted struct, unstated calling convention, test expectation not captured.
3. For P6 specifically: the precise on-disk layout the implementation must use, and the precise shell output format for ls/cat/statfs.
Be concrete and cite file:line.`,
  { label: 'critic', phase: 'Critic', schema: SCHEMA }
)

return { reports: good, critique }
