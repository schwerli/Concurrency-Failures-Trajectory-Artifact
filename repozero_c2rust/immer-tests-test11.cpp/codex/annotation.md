schema_version: 2
pair_id: immer-tests-test11.cpp/codex
task_id: immer/tests/test11.cpp
agent: codex
parallel_solution_passed: true
serial_solution_passed: false
outcome_relation: parallel_only_pass
verdict: patterns_retained
retained_pattern_count: 1

# Comparative Analysis

## Task-Solving Difference
Both runs recognized the Rust port requirements, probed `std::stoi` behavior, created a Cargo project, and built `/output/test11`. The official completed evaluation is discordant: parallel passed 38/38 while serial passed 32/38. The concrete implementation difference is that the parallel run identified the first immutable-vector wrapper as too slow and changed append to mutate the owned vector storage before final verification, while the serial run left `PersistentVector::push_back(&self, ...)` cloning the full vector on every append. That serial O(n^2) append path matches the visible hidden-case failure pattern better than the simple smoke checks, which both runs reported as passing.

parallel_anchor: `parallel/agent/codex/sessions/2026/08/08/rollout-2026-08-08T00-00-04-019fdcf3-f926-7bc0-bcab-e75f393bca9a.jsonl:107`
serial_anchor: `serial/agent/codex/sessions/2026/08/08/rollout-2026-08-08T00-06-03-019fdcf9-74bd-7093-b914-18b8df243416.jsonl:87`
causal_scope: supported comparative explanation, not an exclusive root cause because the isolated pair lacks per-test failure detail

## Failure 1
top_label: Shared State and Merge Problems
sub_label: Concurrent Writes
third_label: Deliverable Overwrite
episode_id: parallel-deliverable-overwrite-test11-entry
comparative_role: parallel_adverse_but_not_outcome_differential
parallel_evidence: `parallel/agent/codex/sessions/2026/08/08/rollout-2026-08-08T00-00-50-019fdcf4-abdf-78d1-95eb-690902ca2201.jsonl:62`
serial_contrast: `serial/agent/codex/sessions/2026/08/08/rollout-2026-08-08T00-06-03-019fdcf9-74bd-7093-b914-18b8df243416.jsonl:87`
realized_consequence: The child replaced the required entry/project files while the parent also owned and had built them, forcing the parent to stop, inspect the changed tree, and rebuild against the current state before closure.
reasoning: The parent first wrote `/output/test11.rs` and Cargo files, then the `probe_binary` child wrote its own `/output/test11.rs`, Cargo file, and module graph into the same shared deliverable tree. The parent later observed that the project had been rewritten underneath its working copy and performed extra reconciliation and rebuilds. Serial has one local writer and no corresponding shared deliverable replacement.
nearest_rejected_label: Source Overwrite
rejection_reason: Non-entry source modules were also replaced or orphaned, but the same episode directly touched the required entry file `/output/test11.rs`, so the deliverable-specific label has precedence.
