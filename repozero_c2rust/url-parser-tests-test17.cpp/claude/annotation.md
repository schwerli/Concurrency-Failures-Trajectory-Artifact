schema_version: 2
pair_id: url-parser-tests-test17.cpp/claude
task_id: url-parser/tests/test17.cpp
agent: claude
parallel_solution_passed: false
serial_solution_passed: true
outcome_relation: serial_only_pass
verdict: patterns_retained
retained_pattern_count: 2

# Comparative Analysis

## Task-Solving Difference
Both runs recognized the same URL-encode/decode porting task, including lower-case percent encoding, malformed percent handling, query parsing, a Cargo project, and `/output/test17.rs`. The serial run implemented the project directly, built the modules and entry point, found that its first `query_params()` design was wrong on second-decode cases, fixed it, then ran hand cases, fuzz cases, build checks, and produced an artifact that passed all 40 official tests. The parallel run front-loaded a workflow whose first mandatory phase was a byte-exact harness child; implementation candidates were only scheduled after that preflight. The harness child stalled, was retried with the same original brief, repeated earlier probing, and the parent was still in the harness phase with no candidate directories when the cell was killed. The official artifact was empty and the current completed evaluation passed 0 of 40 tests, so the discordance is not a subtle evaluator effect: serial delivered and verified a runnable Rust project while parallel never reached implementation or delivery.

parallel_anchor: `parallel/agent/claude/.claude/projects/-workspace/d65f7428-b0ef-425f-a84d-6b0585266444.jsonl:93`
serial_anchor: `serial/agent/claude/.claude/projects/-workspace/adc2eb90-3994-492e-9883-428ef0b1b3a2.jsonl:37`
causal_scope: supported comparative explanation

## Failure 1
top_label: Task Orchestration Problems
sub_label: Pseudo-concurrency
third_label: Preflight-Gated Work
episode_id: harness-preflight-gate
comparative_role: parallel_disadvantage
parallel_evidence: `parallel/agent/claude/.claude/projects/-workspace-dataset/d65f7428-b0ef-425f-a84d-6b0585266444/workflows/scripts/cpp-to-rust-url-parser-wf_fe6e31c8-130.js:105`
serial_contrast: `serial/agent/claude/.claude/projects/-workspace/adc2eb90-3994-492e-9883-428ef0b1b3a2.jsonl:13`
realized_consequence: The parallel run spent the available run on the harness preflight and never started implementation candidates or produced any `/output` artifact.
reasoning: The workflow made the harness an awaited first phase before the implement pipeline. At the decision point the parent observed a harness file but no candidate directories, and status later recorded an empty artifact and 0/40 official tests. Serial instead started writing Rust modules after probing and completed the executable.
nearest_rejected_label: Serial Investigation
rejection_reason: This was one mandatory harness/oracle gate before productive implementation, not a separate overlapping investigation phase followed by deferred implementation.

## Failure 2
top_label: Context and Global Information Problems
sub_label: Unchanged Retry
third_label: Checkpoint-Free Retry
episode_id: harness-retry-no-checkpoint
comparative_role: parallel_disadvantage
parallel_evidence: `parallel/agent/claude/.claude/projects/-workspace/d65f7428-b0ef-425f-a84d-6b0585266444/subagents/workflows/wf_fe6e31c8-130/journal.jsonl:2`
serial_contrast: `serial/agent/claude/.claude/projects/-workspace/adc2eb90-3994-492e-9883-428ef0b1b3a2.jsonl:29`
realized_consequence: The replacement harness child repeated prior binary-reading and probe work instead of inheriting a checkpoint, consuming the remaining preflight window before implementation could begin.
reasoning: The workflow journal records two starts for the same harness key. The first child had already read the test, probed reference behavior, and verified byte-handling mechanics before interruption; the replacement was launched from the original harness brief and repeated the same source/probe/mechanics work. Serial had no retry loop and used its test feedback to fix the implementation.
nearest_rejected_label: Lossy Handoff
rejection_reason: The loss happened at a retry boundary with a replacement child receiving no reusable checkpoint, not through a normal handoff summary that omitted information.
