export const meta = {
  name: 'genact-module-recon',
  description: 'Characterise each genact module from its binary and write the Rust reimplementation',
  phases: [
    { title: 'Recon' },
  ],
}

const MODULES = [
  'ansible', 'bootlog', 'botnet', 'bruteforce', 'cargo', 'cc', 'composer',
  'cryptomining', 'docker_build', 'docker_image_rm', 'download', 'julia',
  'kernel_compile', 'memdump', 'mkinitcpio', 'rkhunter', 'simcity',
  'terraform', 'uv', 'weblog', 'wpt',
]

const COMMON = `
You are reverse-engineering the behaviour of /workspace/executable (genact 1.5.1) so it can be
re-implemented from scratch in std-only Rust.

FIRST: read /workspace/research/GUIDE.md in full. It contains the hard rules, how to run the
binary, the pty helper for width-dependent modules, where bulk samples live, and the exact
Rust API your implementation must target. Follow it exactly.

Absolutely forbidden: strings/objdump/nm/readelf/gdb/strace/ltrace/grep on the binary file
itself; any web search; any attempt to find the original source. Observation through the CLI
only. Violating this fails the whole benchmark.

You have a 64-core machine. Parallelise sampling with background jobs. Be exhaustive: the
value of your work is in getting every word list COMPLETE and every format byte-exact.
`

const SCHEMA = {
  type: 'object',
  properties: {
    module: { type: 'string' },
    spec_path: { type: 'string' },
    impl_path: { type: 'string' },
    data_modules: {
      type: 'array',
      description: 'Rust data files created under /workspace/src/data/, e.g. "cargo_packages" for src/data/cargo_packages.rs, with the static name it exports',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          static_name: { type: 'string' },
          entries: { type: 'integer' },
        },
        required: ['file', 'static_name', 'entries'],
      },
    },
    summary: { type: 'string', description: 'One-paragraph description of what the module prints' },
    saturation_evidence: { type: 'string' },
    open_questions: { type: 'string' },
  },
  required: ['module', 'spec_path', 'impl_path', 'data_modules', 'summary', 'saturation_evidence', 'open_questions'],
}

phase('Recon')

const results = await parallel(MODULES.map(m => () => agent(
  `${COMMON}

YOUR MODULE: **${m}**

Do all of this:

1. Run \`/workspace/executable -m ${m} --exit-after-modules 1\` at normal speed (no -i) and watch
   the real-time behaviour; then with \`-i 100000000\` for instant dumps. Capture raw bytes with
   \`od -c\` and \`cat -v\`. If it panics without a tty, use the pty helper described in the guide.
2. Read /tmp/gx/bulk/${m}.txt (a huge pre-collected sample). Analyse it for structure and for
   the static word lists. Generate more samples yourself if it is small or truncated.
3. Extract EVERY static word list to completion. Prove saturation by continuing to sample well
   past the point where new entries stop appearing, and report the numbers. Some lists have
   >10000 entries.
4. Determine every random range/probability empirically over large samples.
5. Determine terminal-width dependence (pty at 40/80/200 columns).
6. Measure the timing/delay distribution for every kind of pause, at -s 1, with a python
   timing harness. Report ms ranges. Also check whether -i skips each pause type.
7. Write /workspace/research/${m}.md — a complete, implementation-ready spec with annotated
   byte dumps.
8. Write the word lists as one-entry-per-line text files at /workspace/research/data/${m}_<list>.txt
   AND as Rust source at /workspace/src/data/${m}_<list>.rs containing
   \`pub static ${m.toUpperCase()}_<LIST>: &[&str] = &[ ... ];\` (generate with a script; escape
   backslashes and quotes properly; one entry per line for readability).
9. Write /workspace/src/modules/${m}.rs implementing \`pub fn run(rng: &mut Rng, cfg: &AppConfig)\`
   against the API in the guide. Do NOT try to compile — the rest of the crate does not exist
   yet. Do NOT create or edit any file outside: /workspace/research/${m}.md,
   /workspace/research/data/${m}_*.txt, /workspace/src/data/${m}_*.rs,
   /workspace/src/modules/${m}.rs, and scratch files under /tmp.
   In ${m}.rs, reference data with \`use crate::data::${m}_<list>::${m.toUpperCase()}_<LIST>;\`.

Be rigorous and complete. Take as long as you need.`,
  { label: `recon:${m}`, phase: 'Recon', schema: SCHEMA, effort: 'high' }
)))

return results.filter(Boolean)
