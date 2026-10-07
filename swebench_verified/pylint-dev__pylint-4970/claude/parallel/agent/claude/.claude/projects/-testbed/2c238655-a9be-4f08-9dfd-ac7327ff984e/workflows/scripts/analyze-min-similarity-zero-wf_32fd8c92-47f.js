export const meta = {
  name: 'analyze-min-similarity-zero',
  description: 'Map every code path affected by min-similarity-lines=0 and design the fix',
  phases: [
    { title: 'Analyze', detail: 'parallel probes: runtime paths, option plumbing, test/doc surface' },
    { title: 'Design', detail: 'synthesize one concrete fix plan' },
  ],
}

const PROBES = [
  {
    key: 'runtime-paths',
    prompt: `Repo /testbed is pylint (~2.11 dev). Read /testbed/pylint/checkers/similar.py IN FULL.

Task: enumerate EVERY code path that executes when the duplicate-code / similarity machinery runs with min_lines == 0, and describe exactly what happens today (empirically verify, don't guess).

Cover at minimum:
  1. The pylint checker path: SimilarChecker.open -> process_module -> close (via Similar._compute_sims/_iter_sims/_find_common/hash_lineset).
  2. The standalone \`symilar\` CLI path: Run() -> Similar.run() -> _display_sims -> _get_similarity_report.
  3. The map/reduce parallel path: get_map_data / reduce_map_data / combine_mapreduce_data (see also /testbed/pylint/lint/parallel.py and tests/test_check_parallel.py).

For each: what does min_lines==0 do to hash_lineset() (note shifted_lines = [] -> zip() -> empty), to the \`eff_cmn_nb > self.min_lines\` comparison in _find_common, and to the printed TOTAL report line in _get_similarity_report?

EMPIRICALLY VERIFY with the interpreter at /opt/miniconda3/envs/testbed/bin/python (run from cwd /testbed; plain \`python\` lacks astroid). Useful commands:
  /opt/miniconda3/envs/testbed/bin/python -m pylint --disable=all --enable=duplicate-code --min-similarity-lines=0 <files>
  /opt/miniconda3/envs/testbed/bin/python -c "from pylint.checkers import similar; similar.Run(['--duplicates=0','tests/input/similar1','tests/input/similar2'])"
Also try min-similarity-lines=1 and the default 4 for contrast, and try running the checker over a larger set of files.

Report: a precise path-by-path account of CURRENT behavior with the exact observed output for each, plus which paths still produce user-visible output when min_lines==0 (this is the actual bug surface). Include exact file:line anchors.`,
  },
  {
    key: 'option-plumbing',
    prompt: `Repo /testbed is pylint (~2.11 dev). Trace how the \`min-similarity-lines\` option flows from configuration to the checker.

Read: /testbed/pylint/checkers/similar.py (options tuple, SimilarChecker.__init__, set_option), /testbed/pylint/config/option.py, /testbed/pylint/config/option_manager_mixin.py, /testbed/pylint/lint/pylinter.py (checker registration / config reading).

Answer precisely:
  1. When is SimilarChecker.__init__ called relative to config parsing? Does self.min_lines get set from the DEFAULT at construction and then updated later via set_option? Trace exactly how a value from an rcfile and from a --min-similarity-lines CLI flag reach self.min_lines.
  2. Is set_option ALWAYS called for min-similarity-lines when set in an rcfile, or are there paths where self.config.min_similarity_lines is updated but self.min_lines (the Similar attribute) is NOT? Look hard at pylint/config/option_manager_mixin.py and how optparse callbacks work here. This matters: a fix that only guards on self.min_lines could be bypassed.
  3. Same question for the parallel/multiprocessing path (pylint/lint/parallel.py, _worker_initialize) - does the child process reconstruct the checker and re-apply options?
  4. Does the standalone \`symilar\` Run() entrypoint set min_lines directly (bypassing set_option)?

Report exact file:line anchors and a verdict on which attribute(s) a guard must read to be reliable. Verify claims by running small snippets with /opt/miniconda3/envs/testbed/bin/python from cwd /testbed.`,
  },
  {
    key: 'test-doc-surface',
    prompt: `Repo /testbed is pylint (~2.11 dev). Inventory everything that would need updating for the change "setting min-similarity-lines (or symilar's --duplicates) to 0 disables the duplicate-code check".

Find and report with exact paths/lines:
  1. All existing tests touching similarity/duplicate-code: tests/checkers/unittest_similar.py, tests/test_self.py, tests/test_check_parallel.py, tests/lint/, tests/functional/ (grep for similar, duplicate-code, R0801, symilar, min-similarity, --duplicates). Summarize the ESTABLISHED TEST STYLE in tests/checkers/unittest_similar.py (how each test invokes similar.Run, what it asserts about stdout, how SystemExit is handled).
  2. Documentation: doc/whatsnew/2.11.rst (does it exist? read its structure), ChangeLog (read the top ~60 lines and note the exact formatting convention for entries, including how "Closes #NNNN" is written), doc/ anything mentioning duplicate-code or min-similarity-lines, examples/pylintrc line 301, pylintrc line 121.
  3. The option help text at pylint/checkers/similar.py and the usage() text for symilar - quote them exactly.
  4. Check whether there is a test that asserts the full \`--help\` / option documentation output which would need regenerating if help text changes (grep tests/ for 'Minimum lines number' and for help-message snapshot tests, e.g. tests/test_self.py).

Report a concrete checklist of files to touch, with the exact current text at each site. Do NOT edit anything.`,
  },
]

phase('Analyze')
const probes = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Analyze' })
))

const findings = PROBES.map((p, i) => `### ${p.key}\n${probes[i] || '(probe failed)'}`).join('\n\n')

phase('Design')
const design = await agent(
`You are designing a minimal, upstream-quality fix for pylint issue: "Setting min-similarity-lines to 0 should stop pylint from checking duplicate code."

Desired behavior: min-similarity-lines=0 (and symilar's --duplicates=0) fully disables the duplicate code check - no R0801 messages, and for the standalone symilar tool NO output at all (not even the "TOTAL lines=... duplicates=0 percent=0.00" summary line).

Here are three independent investigation reports on /testbed:

${findings}

Read /testbed/pylint/checkers/similar.py yourself to confirm before recommending.

Produce a CONCRETE fix plan:
  - Exact edits (function, line anchor, the guard condition to add, and why THAT location rather than alternatives).
  - Decide: guard in Similar.run()? in SimilarChecker.process_module()? in SimilarChecker.close()? in hash_lineset()? in _iter_sims()? Justify each inclusion/exclusion. Prefer the smallest set of guards that makes every entry point (checker, symilar CLI, map/reduce parallel) correct - but do not leave a path unguarded just to be minimal.
  - Consider: should append_stream/process_module be skipped entirely when disabled (avoids pointless CPU + memory)? What are the consequences for stats (nb_duplicated_lines, percent_duplicated_lines) and for the RP0801 report?
  - Edge cases: negative values; min_lines=1; the ZeroDivisionError risk in _get_similarity_report when total_line_number==0; the mapreduce reduce_map_data path constructing a fresh SimilarChecker.
  - The option help text wording change.
  - The test to add, written in the exact established style of tests/checkers/unittest_similar.py.
  - ChangeLog + doc/whatsnew entry text matching the repo's existing convention (issue number is 4901).

Be specific enough that another engineer could apply it verbatim. Flag anything the reports disagree on.`,
  { label: 'design', phase: 'Design' }
)

return design
