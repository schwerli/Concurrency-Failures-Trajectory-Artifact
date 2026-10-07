schema_version: 2
pair_id: furl-test12.py/claude
task_id: furl/test12.py
agent: claude
parallel_solution_passed: false
serial_solution_passed: false
outcome_relation: both_fail
verdict: patterns_retained
retained_pattern_count: 2

# Comparative Analysis

## Task-Solving Difference
Both attempts recognized the Python-to-Node ESM task and both officially failed the completed evaluator with 0/160. Their concrete failure modes differed: the parallel run spent the run in a wide probe-and-verify workflow and delivered an empty artifact directory, while the serial run performed its own probing, began writing library modules, and delivered only `lib/idna.mjs` and `lib/percent.mjs` without the required `test12.mjs` entry file. This is not a discordant official outcome, so the retained parallel patterns describe adverse parallel coordination without explaining a pass/fail split.

parallel_anchor: `parallel/cell/status.json:196`
serial_anchor: `serial/cell/status.json:206`
causal_scope: no outcome difference

## Failure 1
top_label: Task Orchestration Problems
sub_label: Load Imbalance
third_label: Fan-out Budget Exhaustion
episode_id: fanout_probe_verify_budget
comparative_role: parallel_adverse_but_not_outcome_differential
parallel_evidence: `parallel/agent/claude/.claude/projects/-workspace-dataset/524a68ae-27ac-4515-a5ae-e7f5b86d6ecf/workflows/scripts/furl-probe-wf_b3bc9909-da8.js:149`
serial_contrast: `serial/agent/claude/.claude/projects/-workspace/8f28cf6c-c6bb-407c-b818-c2953d1f659a.jsonl:141`
realized_consequence: The broad workflow consumed the available run window and was killed before any required `/output/test12.mjs` or supporting implementation files were delivered.
reasoning: The parallel script fans six subsystem probes into verifier agents, the workflow state records the run as killed with live/retried agents and large child token/tool use, and artifact validation shows the final artifact was empty. The serial run did not use child agents and reached local library writing, although it also failed because it did not finish the entry file.
nearest_rejected_label: Blind Timeout Wait
rejection_reason: The directly evidenced boundary is collective fan-out and retry breadth exhausting the budget; there is no separate parent wait episode where available progress was ignored.

## Failure 2
top_label: Shared State and Merge Problems
sub_label: Shared Environment Contamination
third_label: Artifact Leakage
episode_id: shared_tmp_probe_helper_collision
comparative_role: parallel_adverse_but_not_outcome_differential
parallel_evidence: `parallel/agent/claude/.claude/projects/-workspace/524a68ae-27ac-4515-a5ae-e7f5b86d6ecf/subagents/workflows/wf_b3bc9909-da8/agent-ae69f361b4f08f257.jsonl:35`
serial_contrast: `serial/cell/status.json:229`
realized_consequence: Concurrent probe agents observed shared `/tmp` helper-script contamination and had to abandon the shared helper path for per-agent temporary directories before continuing their probes.
reasoning: Two different parallel children explicitly observed shared `/tmp` helper collisions/overwrites and then created unique helper directories. That is an auxiliary probe-environment contamination episode, not a final workspace write collision. The serial control had workflows and delegation disabled, so the same shared-helper cross-agent contamination boundary was absent.
nearest_rejected_label: Unisolated Workspace Writes
rejection_reason: The contaminated object was a temporary probing helper consumed as tool input, not implementation workspace source or final deliverable output written by multiple agents.
