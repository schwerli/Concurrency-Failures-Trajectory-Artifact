export const meta = {
  name: 'p4-review',
  description: 'Adversarial review of the Project 4 virtual memory implementation',
  phases: [
    { title: 'Review', detail: 'independent reviewers over distinct lenses' },
    { title: 'Verify', detail: 'refute each finding' },
  ],
}

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'detail', 'severity'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          detail: { type: 'string', description: 'Concrete failure scenario: inputs/state -> wrong behaviour' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
}

const CONTEXT = `Project under review: /workspace/Project4-Virtual_Memory_Management (a RISC-V bare-metal OS lab, SV39 paging, 2 harts, global kernel lock).
The newly written code is in kernel/mm/mm.c, kernel/sched/sched.c and include/os/mm.h (see \`cd /workspace && git diff\`).
Everything else in the tree is given/unmodifiable context: init/main.c, arch/riscv/kernel/{entry.S,boot.c,start.S}, arch/riscv/include/pgtable.h, include/os/{sched.h,elf.h,mm.h}, kernel/irq/irq.c, kernel/syscall/syscall.c, drivers/screen.c, test/*.c, tiny_libc/.
Key facts you must verify against the real files rather than assume:
- user ELFs link at 0x10000 but their PT_LOAD segment starts at vaddr 0xf000 (headers included), memsz up to ~0x3e98.
- USER_STACK_ADDR = 0xf00010000, PGDIR_PA = 0x5e000000, kernel window VPN2 = 0x101, KERNEL_MEM_OFFSET = 0xffffffc000000000.
- main.c init_pcb() loads the shell with load_elf(..., get_kva_of) which only WALKS the page table, so init_page_table() must pre-map the code pages.
- main.c's idle loop frees each exited task's kernel stack with free_user_page(kva2pa(kernel_stack_base - PAGE_SIZE)).
- there is no satp switch in entry.S, so scheduler() must do it.
Only report defects in the NEW code. Do not report pre-existing issues in given files unless the new code depends on them incorrectly.`

const LENSES = [
  { key: 'paging', prompt: `${CONTEXT}\n\nLENS: SV39 page-table correctness. Scrutinise walk_pgdir/find_pte/alloc_page_helper/init_page_table/free_process_user_page in kernel/mm/mm.c. Check: VPN extraction and shifts, PFN vs PA conversions, set_pfn clobbering attributes, intermediate (pointer) PTEs vs leaf PTEs (RWX must be zero on pointers), which VPN2 range belongs to the user, whether the kernel window entry is shared correctly and never freed, double-free of pgdir pages, whether the pre-mapped code range actually covers the ELF segment, TLB flushing.` },
  { key: 'swap', prompt: `${CONTEXT}\n\nLENS: swapping and page replacement. Scrutinise alloc_user_page, selete_page, write_to_sd and the swap-in path of alloc_page_helper in kernel/mm/mm.c. Check: disk slot leaks/double allocation, the PTE encoding used for a swapped-out page (_PAGE_SOFT + pfn=slot) versus a never-mapped PTE of 0, the user_page[].pgtable back-pointer becoming stale, evicting a page that is pinned or shared, sbi_sd_read/sbi_sd_write block arithmetic against SWAP_BEGIN/DISK_PAGE_NUM and the image layout, memset of a page that is about to be overwritten by a disk read, infinite loops or assert(0) reachable in normal operation.` },
  { key: 'sched', prompt: `${CONTEXT}\n\nLENS: scheduler and process lifetime. Scrutinise scheduler(), do_exit(), do_kill(), do_waitpid(), reclaim_pcb(), release_resources() in kernel/sched/sched.c. Check: the satp switch happens before or after touching the dying address space, whether a task can be freed while another hart still runs it, ready-queue invariants (list_del of a node that is not queued, double insertion), TASK_KILLED handling, the kernel stack being freed while still in use, pcb slot reuse, blocked tasks in wait queues on exit, interaction with main.c's idle cleanup loop, the ENTER_ZOMBIE_ON_EXIT vs AUTO_CLEANUP_ON_EXIT paths, preempt_count balance across every early return.` },
  { key: 'exec', prompt: `${CONTEXT}\n\nLENS: do_exec and user-space argument passing. Scrutinise do_exec(), init_pcb_stack(), init_user_stack() in kernel/sched/sched.c. Check: SUM enable/disable balance on every return path, reading user pointers, the argv strings/array actually landing at the right user virtual addresses (verify the kva<->va arithmetic on the stack page byte by byte), stack overflow of the single stack page, 16-byte ABI alignment, whether crt0.S preserves a0/a1 up to main(), the return-value contract the shell in test/test_shell.c expects (0 / -1 / -2 / pid), load_elf being given alloc_page_helper, sstatus/sepc/sscratch initialisation for user mode, and whether pcb fields left over from a previous occupant of the slot are all reinitialised.` },
  { key: 'shm', prompt: `${CONTEXT}\n\nLENS: shared memory and the page fault handler. Scrutinise shm_page_get(), shm_page_dt(), handle_page_fault() in kernel/mm/mm.c against test/consensus.c which does: get -> dt -> write to the old address -> get again and expects a DIFFERENT virtual address. Check: the reserved VA window and whether it collides with the ELF image at 0xf000 or the shm attach ever returns 0 for a valid mapping, reference counting across processes and across process exit (free_process_user_page), pinning, detaching an address that is not shared, the bounds check in handle_page_fault, faults on kernel addresses, and what happens on a fault while a page is on disk.` },
]

phase('Review')
const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS }),
  (r, l) => parallel((r?.findings || []).map(f => () =>
    agent(`${CONTEXT}\n\nA reviewer claims the following defect in the NEW code. Try hard to REFUTE it by reading the actual files. Default to refuted=true when you cannot demonstrate a concrete failure.\n\nTITLE: ${f.title}\nFILE: ${f.file}\nCLAIM: ${f.detail}`,
      { label: `verify:${l.key}`, phase: 'Verify', schema: VERDICT })
      .then(v => ({ ...f, lens: l.key, verdict: v }))
  ))
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter(f => f.verdict && !f.verdict.refuted)
log(`${all.length} raw findings, ${confirmed.length} survived refutation`)
return { confirmed, refuted: all.filter(f => f.verdict && f.verdict.refuted).map(f => f.title) }
