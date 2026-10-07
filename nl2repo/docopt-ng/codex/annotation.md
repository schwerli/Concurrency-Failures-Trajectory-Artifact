schema_version: 2
pair_id: docopt-ng/codex
task_id: docopt-ng
agent: codex
parallel_solution_passed: true
serial_solution_passed: false
outcome_relation: parallel_only_pass
verdict: no_parallel_pattern
retained_pattern_count: 0

# Comparative Analysis

## Task-Solving Difference
Both runs recognized the same `docopt-ng` package task and built an installable `docopt` parser with the requested public and underscored API. The parallel run paired parent implementation with auxiliary upstream, metadata, and submit-probe tracks, and its workspace ended with broader compatibility evidence: parent tests passed, package build/install checks passed, and the official evaluator reported 614/614. The serial run implemented the same general package shape and also passed its local 20-test suite plus install checks, but it deliberately used compact smoke coverage rather than the broader upstream test corpus and the official evaluator later reported 603/614. The supported difference is therefore coverage depth and compatibility closure, not a retained parallel-side concurrency error.

parallel_anchor: `parallel/agent/codex/sessions/2026/08/07/rollout-2026-08-07T20-44-43-019fddf8-9515-7513-a87b-cc217a0a355a.jsonl:349`
serial_anchor: `serial/agent/codex/sessions/2026/08/07/rollout-2026-08-07T20-55-23-019fde02-5830-72c2-9914-66f2461cd02d.jsonl:323`
causal_scope: supported comparative explanation
