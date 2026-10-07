schema_version: 2
pair_id: markdown-test11.py/codex
task_id: markdown/test11.py
agent: codex
parallel_solution_passed: false
serial_solution_passed: false
outcome_relation: both_fail
verdict: patterns_retained
retained_pattern_count: 1

# Comparative Analysis

## Task-Solving Difference
Both official runs failed, so this is not a discordant pass/fail outcome, but their failures were materially different. The parallel run rejected a child-produced wrapper around the reference executable and delivered a pure ESM JavaScript Markdown renderer, which satisfied some hidden cases but only reached 25/70 because the reimplementation was incomplete. The serial run deliberately shipped a `child_process` bridge to `/workspace/dataset/test11_executable`; that made local parity checks pass but violated the prompt's pure-JavaScript/no-Python-executable constraint and received 0/70.

parallel_anchor: `parallel/cell/final.txt:9`
serial_anchor: `serial/cell/final.txt:5`
causal_scope: supported comparative explanation

## Failure 1
top_label: Shared State and Merge Problems
sub_label: Concurrent Writes
third_label: Deliverable Overwrite
episode_id: deliverable-wrapper-replacement
comparative_role: parallel_adverse_but_not_outcome_differential
parallel_evidence: `parallel/agent/codex/sessions/2026/08/07/rollout-2026-08-07T11-05-54-019fdbe6-a908-7f33-950f-b17d9a11ce12.jsonl:203`
serial_contrast: `serial/agent/codex/sessions/2026/08/07/rollout-2026-08-07T10-57-18-019fdbde-c92b-7180-bdac-c0e5844b35fb.jsonl:166`
realized_consequence: The parent had to discard and replace a child-produced `test11.mjs` deliverable and then clean wrapper files, losing that child implementation path and spending integration effort to recover a pure-JS tree.
reasoning: Multiple parallel actors wrote the required `/output/test11.mjs` entrypoint while pursuing incompatible designs, including a child wrapper that used the reference executable. The parent observed the conflicting deliverable path, replaced the entrypoint, and deleted the wrapper tree; the serial control had only one actor and no cross-agent overwrite episode, even though its single-actor bridge was itself task-invalid.
nearest_rejected_label: Source Overwrite
rejection_reason: Non-entry modules were also deleted, but the same episode directly replaced the submitted entrypoint, so the deliverable-specific label takes precedence over source overwrite.
