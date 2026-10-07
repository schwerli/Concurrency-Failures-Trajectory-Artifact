schema_version: 2
pair_id: unidecode/codex
task_id: unidecode
agent: codex
parallel_solution_passed: false
serial_solution_passed: false
outcome_relation: both_fail
verdict: patterns_retained
retained_pattern_count: 1

# Comparative Analysis

## Task-Solving Difference
Both runs attempted the full Unidecode package, CLI, tests, docs, packaging, and typing task and both completed official evaluation. The official relation is not discordant: parallel failed 1 hidden test at 64/65, while serial failed 7 hidden tests at 58/65. The serial run worked as a single actor from an older upstream baseline, fixed local failures, and ended with 65 local tests passing plus package smoke checks. The parallel run used child agents to inspect upstream API, tables, and tests, refreshed the project closer to Unidecode 1.4.0, consumed the completed table report, ran broader local verification, and ended with 71 local tests, mypy, editable install, and CLI smoke checks passing. The retained parallel-side pattern is a process issue, not an outcome-differential explanation: one child edited `unidecode/util.py` while the parent was still implementing the same CLI path, causing the parent patch to fail and forcing a re-read/reconciliation of the already modified file. Serial made the analogous CLI edit without a live same-file writer.

parallel_anchor: `parallel/agent/codex/sessions/2026/08/08/rollout-2026-08-08T14-01-29-019fe1ad-c3ed-7362-8c00-f8af390e9826.jsonl:344`
serial_anchor: `serial/agent/codex/sessions/2026/08/08/rollout-2026-08-08T13-55-18-019fe1a8-1cec-7041-9a20-d983188fe086.jsonl:219`
causal_scope: no outcome difference; supported adverse parallel process episode, not a proven cause of either hidden failure.

## Failure 1
top_label: Shared State and Merge Problems
sub_label: Concurrent Writes
third_label: Same-File Collision
episode_id: parallel_cli_shared_file_collision
comparative_role: parallel_adverse_but_not_outcome_differential
parallel_evidence: `parallel/agent/codex/sessions/2026/08/08/rollout-2026-08-08T14-01-41-019fe1ad-f46e-7c72-adf7-9a140dec7ba8.jsonl:110`
serial_contrast: `serial/agent/codex/sessions/2026/08/08/rollout-2026-08-08T13-55-18-019fe1a8-1cec-7041-9a20-d983188fe086.jsonl:114`
realized_consequence: The parent lost the expected patch context for `unidecode/util.py` and had to inspect and reconcile a CLI implementation that a child had already written in the shared workspace.
reasoning: The child applied a patch to `unidecode/util.py` and `unidecode/__init__.py` while the parent remained active on the same implementation path. The parent then attempted its own `unidecode/util.py` patch, received an apply-patch context failure, re-read the file, and explicitly noted that the CLI file already carried a partial base64 implementation. That is a directly observed same-source-file collision with a concrete reconciliation cost. The serial control made the corresponding CLI change as one actor and did not encounter a shared live writer.
nearest_rejected_label: Source Overwrite
rejection_reason: The evidence shows same-file concurrent editing and reconciliation, but not a wholesale replacement, deletion, or recreation of another agent's source.
