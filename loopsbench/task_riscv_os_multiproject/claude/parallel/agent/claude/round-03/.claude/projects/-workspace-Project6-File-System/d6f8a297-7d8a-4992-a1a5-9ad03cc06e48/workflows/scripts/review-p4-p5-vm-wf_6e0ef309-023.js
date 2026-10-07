export const meta = {
  name: 'review-p4-p5-vm',
  description: 'Adversarially review the uncommitted P4 virtual-memory and P5 device-driver implementations for correctness bugs',
  phases: [
    { title: 'Find', detail: 'parallel reviewers over P4/P5 dimensions' },
    { title: 'Verify', detail: 'adversarial refutation of each finding' },
  ],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          title: { type: 'string' },
          detail: { type: 'string' },
          why_wrong: { type: 'string' },
          suggested_fix: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
        },
        required: ['file', 'line', 'title', 'detail', 'why_wrong', 'suggested_fix', 'severity'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
  required: ['refuted', 'reasoning'],
}

const BASE = `You are reviewing an uncommitted implementation in a RISC-V bare-metal OS course lab at /workspace.
The relevant sources are:
  /workspace/Project4-Virtual_Memory_Management/kernel/mm/mm.c
  /workspace/Project4-Virtual_Memory_Management/kernel/sched/sched.c
  /workspace/Project4-Virtual_Memory_Management/include/os/mm.h
  /workspace/Project5-Device_Driver/drivers/net.c
  /workspace/Project5-Device_Driver/kernel/mm/mm.c
  /workspace/Project5-Device_Driver/kernel/sched/sched.c
Use 'git diff' in /workspace to see exactly what was added (the rest of the tree is pre-existing scaffolding).
Read supporting headers (include/os/*.h, arch/riscv/include/pgtable.h, drivers/net.h, kernel/syscall/syscall.c, init/main.c, test/*.c) to understand the intended contracts.
Both projects already COMPILE cleanly, so do not report compile errors unless you are certain.
Report only real correctness defects that would cause wrong behavior at runtime. Be concrete and cite file:line.
Focus dimension: `

const DIMENSIONS = [
  { key: 'pgtable', prompt: BASE + `SV39 page-table manipulation in P4 mm.c — init_page_table (kernel mapping copy from the boot page table, level indexing VPN2/VPN1/VPN0, PTE flag bits V/R/W/X/U/A/D, PPN shifting via pa2kva/kva2pa, ASID handling), alloc_page_helper page-table walk, and free_process_user_page recursive teardown (must free leaf user pages AND intermediate page-table pages, must NOT free the shared kernel mappings copied from the boot table, must not free pinned/shared-memory pages twice).` },
  { key: 'swap', prompt: BASE + `Demand paging and swapping in P4 mm.c — selete_page (NRU victim selection using the A/D accessed/dirty bits, must skip pinned pages, must clear A bits periodically, must not select a page belonging to the page-table structure itself), write_to_sd (choosing a free swap sector, sbi_sd_write of the 4KB page = 8 sectors, recording the swap location in the now-invalid PTE, invalidating the PTE and flushing TLB via sfence), and handle_page_fault (distinguishing load/store/instruction page faults from the scause cause code, swap-in from disk, correctly restoring PTE flags, handling COW/shared memory, killing the process on a genuinely invalid address).` },
  { key: 'shm', prompt: BASE + `Shared memory in P4 mm.c — shm_page_get(key) and shm_page_dt(addr): reference counting, allocating the backing physical page on first use, picking a free user virtual address in the calling process, mapping with correct U|R|W flags, unmapping and freeing the physical page only when the refcount drops to zero, and interaction with free_process_user_page at exit (a shared page must not be freed as if privately owned).` },
  { key: 'sched4', prompt: BASE + `P4 kernel/sched/sched.c — scheduler() and max_priority_node() (priority/CPU-affinity selection, per-core current_running, kernel/user stack switching, satp switch + sfence.vma on context switch, idle handling when no task is ready), do_exec (ELF load via the elf.h helpers, argc/argv setup on the user stack, allocating and mapping user pages, pid allocation), do_exit / do_kill / do_waitpid (freeing page tables, waking waiters, releasing held locks and mailboxes, not freeing the stack the CPU is currently running on).` },
  { key: 'net', prompt: BASE + `P5 drivers/net.c — do_net_send (building the tx BD ring, cache flush, waiting for transmit completion, byte counts), do_net_recv (rx BD ring setup, num_packet loop, writing per-packet lengths into frLength, blocking the caller in interrupt mode and being woken by the ISR, poll-mode busy-waiting), do_net_irq_mode (enabling/disabling the emacps rx/tx interrupts and PLIC routing). Cross-check against drivers/emacps/*.h APIs (XEmacPs_BdRingAlloc/ToHw/FromHw/Free), drivers/plic.c, kernel/irq/irq.c and test/send.c, test/recv.c for the expected contract.` },
  { key: 'p4p5diff', prompt: BASE + `Divergence between P4 and P5. Diff /workspace/Project4-Virtual_Memory_Management/kernel/mm/mm.c against /workspace/Project5-Device_Driver/kernel/mm/mm.c, and likewise the two sched.c files. P5 is supposed to be P4 carried forward plus alloc_page_helper and net-related additions. Report any place where a bug was fixed in one copy but not the other, where a needed P5-specific behavior is missing, or where P5 dropped functionality that P4 has. Also verify alloc_page_helper(va, pgdir) in P5 correctly walks/creates the 3 levels and returns the kernel virtual address of the mapped page.` },
]

phase('Find')
const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `find:${d.key}`, phase: 'Find', schema: FINDINGS_SCHEMA }),
  (r, d) => {
    if (!r || !r.findings || !r.findings.length) return []
    return parallel(r.findings.map(f => () =>
      agent(`You are an adversarial verifier for a RISC-V bare-metal OS lab at /workspace.

A reviewer claims this is a bug:
  file: ${f.file}:${f.line}
  title: ${f.title}
  detail: ${f.detail}
  why it is wrong: ${f.why_wrong}

Your job is to REFUTE it. Read the actual code at that location and all surrounding context, headers, and callers. Common reasons a claim is bogus: the behavior is handled elsewhere, the lab's simplified contract does not require it, the code path is unreachable in this lab's tests, the reviewer misread a macro or pointer type, or the "fix" would break something else.

Set refuted=true unless you can positively confirm, by reading the code, that this is a genuine defect that would produce wrong runtime behavior. Default to refuted=true when uncertain.`,
        { label: `verify:${d.key}:${f.file.split('/').pop()}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then(v => ({ ...f, dimension: d.key, verdict: v }))
    ))
  }
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter(f => f.verdict && !f.verdict.refuted)
log(`${all.length} raw findings, ${confirmed.length} survived refutation`)
return { confirmed, refutedCount: all.length - confirmed.length }
