schema_version: 2
pair_id: idna-test8.py/claude
task_id: idna/test8.py
agent: claude
parallel_solution_passed: false
serial_solution_passed: false
outcome_relation: both_fail
verdict: patterns_retained
retained_pattern_count: 1

# Comparative Analysis

## Task-Solving Difference
Both trajectories attempted a pure ESM Node.js port of the Python IDNA/argparse script and both produced an artifact that the current official evaluator ran to 19/20, so there is no discordant official outcome to explain. The parallel run used a workflow with many probe children while the parent generated Unicode data, wrote IDNA modules, wrote `test8.mjs`, and timed out after final edits; the serial control performed the same broad black-box probing, local library construction, sample testing, and differential-harness setup inside one non-delegating trajectory. The concrete parallel-only coordination problem is not the final score gap, because there is none; it is that concurrent probe children used shared `/tmp` output paths, contaminating probe evidence and forcing a re-verification boundary with unique temp files.

parallel_anchor: `parallel/agent/claude/.claude/projects/-workspace/4ce0897d-c696-4de3-a402-b1b3689a4110/subagents/workflows/wf_c6bcfc09-cca/agent-a9446d34ad2694442.jsonl:15`
serial_anchor: `serial/cell/status.json:240`
causal_scope: no outcome difference

## Failure 1
top_label: Shared State and Merge Problems
sub_label: Shared Environment Contamination
third_label: Artifact Leakage
episode_id: parallel-shared-tmp-probe-leakage
comparative_role: parallel_adverse_but_not_outcome_differential
parallel_evidence: `parallel/agent/claude/.claude/projects/-workspace/4ce0897d-c696-4de3-a402-b1b3689a4110/subagents/workflows/wf_c6bcfc09-cca/agent-a9446d34ad2694442.jsonl:15`
serial_contrast: `serial/cell/status.json:240`
realized_consequence: A concurrent child probe consumed or observed another actor's `/tmp/o` or `/tmp/e` output as if it were stable probe evidence, so affected argparse evidence had to be treated as contaminated and re-run with per-invocation temporary files before it could be trusted.
reasoning: The parallel run executed a workflow with child agents. One child explicitly identified a race because other processes shared `/tmp` and switched to unique paths, and another completed child reported that shared `/tmp/o` had produced fabricated-looking cross-talk and that every affected rule was re-verified with `mktemp` files. The serial control had workflows and child logs disabled, so this multi-actor temporary artifact contamination did not arise there. Because both official outcomes are 19/20 failures, this is an adverse parallel process pattern but not an outcome-differential explanation.
nearest_rejected_label: Unisolated Workspace Writes
rejection_reason: The adverse object was shared temporary probe output, not a shared implementation workspace or source tree; the realized problem was consuming contaminated artifacts rather than proving unowned workspace implementation writes.
