schema_version: 2
pair_id: earcut.hpp-tests-test11.cpp/claude
task_id: earcut.hpp/tests/test11.cpp
agent: claude
parallel_solution_passed: true
serial_solution_passed: true
outcome_relation: both_pass
verdict: patterns_retained
retained_pattern_count: 2

# Comparative Analysis

## Task-Solving Difference
Both attempts produced a complete pure-Rust Cargo project for the black-box earcut test and both current official evaluations passed 40/40. The serial run stayed single-actor: it implemented the port, fixed its compile issue, ran broad differential sweeps and Cargo checks, then finalized. The parallel run also implemented a valid artifact, but its verification workflow introduced two adverse coordination episodes: verifier children tested a deliverable that the parent changed mid-workflow, and several children consumed a parent-created harness whose fixed `/tmp` artifacts were unsafe under concurrent sweeps. These episodes affected process reliability and verification effort, not the final official outcome; the apparent parallel status discordance is resolved by `cell/status.json:evaluation`, whose completed retry supersedes the stale original evaluator failure.

parallel_anchor: `parallel/cell/status.json:349`
serial_anchor: `serial/cell/status.json:330`
causal_scope: no outcome difference

## Failure 1
top_label: Shared State and Merge Problems
sub_label: Concurrent Writes
third_label: Deliverable Overwrite
episode_id: deliverable-rebuilt-during-verification
comparative_role: parallel_adverse_but_not_outcome_differential
parallel_evidence: `parallel/agent/claude/.claude/projects/-workspace/ab38c2e3-c1d9-47f2-87be-f2fc14feb984.jsonl:111`
serial_contrast: `serial/agent/claude/.claude/projects/-workspace/b712d29e-47d9-4760-9639-a28d850c3932.jsonl:57`
realized_consequence: Parallel verifier children observed that `/output` changed during their tasks and discarded or reran checks against a new source and binary snapshot.
reasoning: The parent launched the workflow, then edited the entry-source path and rebuilt the required executable while workflow children were already using `/output/test11` as their read-only artifact. At least one child reported the mid-session rewrite and rebuilt binary, then redid its validation. Serial verification happened in one actor after its implementation fixes, so no separately owned verifier consumed a moving deliverable.
nearest_rejected_label: Source Overwrite
rejection_reason: Non-entry source files were edited, but the proven episode also replaced the entry file and executable under active verifier use, making Deliverable Overwrite the more specific canonical label.

## Failure 2
top_label: Shared State and Merge Problems
sub_label: Shared Environment Contamination
third_label: Artifact Leakage
episode_id: shared-tmp-difftest-leakage
comparative_role: parallel_adverse_but_not_outcome_differential
parallel_evidence: `parallel/agent/claude/.claude/projects/-workspace/ab38c2e3-c1d9-47f2-87be-f2fc14feb984.jsonl:72`
serial_contrast: `serial/agent/claude/.claude/projects/-workspace/b712d29e-47d9-4760-9639-a28d850c3932.jsonl:57`
realized_consequence: Concurrent verifier children received fabricated mismatch evidence and spent verification effort diagnosing the harness race and rerunning private-temp sweeps.
reasoning: The parent-created differential harness wrote reference and Rust outputs to fixed `/tmp/ref.out` and `/tmp/rus.out`, and the workflow brief directed multiple children to use that ready-made harness concurrently. Children later reported false mismatches caused by those shared temporary files and reran with private temporary paths to prove the Rust artifact matched. Serial used local sequential verification, so its comparison artifacts were not shared across concurrent child processes.
nearest_rejected_label: Unisolated Workspace Writes
rejection_reason: The concrete failure was not an implementation workspace ownership collision; it was generated temporary comparison artifacts leaking across concurrent verifier executions.
