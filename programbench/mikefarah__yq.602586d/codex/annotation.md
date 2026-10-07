schema_version: 2
pair_id: mikefarah__yq.602586d/codex
task_id: mikefarah__yq.602586d
agent: codex
parallel_solution_passed: false
serial_solution_passed: false
outcome_relation: both_fail
verdict: patterns_retained
retained_pattern_count: 1

# Comparative Analysis

## Task-Solving Difference
Both runs attempted a clean-room replacement for `yq`, but they failed differently under the current completed official evaluation. The serial run stayed on one self-contained Python implementation, built it with `compile.sh`, and reached official execution with 370/2046 tests passing. The parallel run used child agents and concurrent shared-workspace Go rewrites; it left stale and incompatible Go files in the submitted tree, so `compile.sh` attempted `go build .`, hit `formats.go`'s missing `gopkg.in/yaml.v3` dependency, and no tests ran.

parallel_anchor: `parallel/cell/status.json:394`
serial_anchor: `serial/cell/status.json:329`
causal_scope: supported comparative contributor to the parallel run's worse delivery state, not a discordant pass/fail root cause because both official solutions failed

## Failure 1
top_label: Shared State and Merge Problems
sub_label: Concurrent Writes
third_label: Source Overwrite
episode_id: go-shared-worktree-overwrite
comparative_role: parallel_adverse_but_not_outcome_differential
parallel_evidence: `parallel/agent/codex/sessions/2026/08/08/rollout-2026-08-08T17-18-29-019fe262-2113-7241-91ac-9f096893378a.jsonl:486`
serial_contrast: `serial/agent/codex/sessions/2026/08/08/rollout-2026-08-08T16-52-40-019fe24a-7be0-7db1-8957-ced1746cc58b.jsonl:425`
realized_consequence: The submitted parallel workspace retained incompatible stale Go source under a whole-package `go build .`, causing official compile failure and zero tests run.
reasoning: A child in the parallel run deleted `eval.go` and replaced `main.go` inside the same shared implementation tree after the parent had already observed competing rewrites from another parallel actor. The later audit showed those shared-write leftovers were still present and broke the package build; the serial control avoided this coordination boundary by producing a single Python entrypoint and build script.
nearest_rejected_label: Cross-File Scope Collision
rejection_reason: The episode is not merely competing files with overlapping scope; the child directly deleted and recreated source in the shared implementation tree, so the more specific overwrite label applies.
