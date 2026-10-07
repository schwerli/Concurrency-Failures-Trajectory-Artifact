schema_version: 2
pair_id: idna-test1.py/codex
task_id: idna/test1.py
agent: codex
parallel_solution_passed: true
serial_solution_passed: true
outcome_relation: both_pass
verdict: patterns_retained
retained_pattern_count: 1

# Comparative Analysis

## Task-Solving Difference
Both attempts implemented a pure Node.js ESM IDNA/CLI migration under `/output`, matched the executable on representative and edge inputs, and passed the current official 125-case evaluation. The serial run kept one coherent implementation path: it wrote a flat module tree, found an uppercase A-label drift, patched the IDNA decoder, and completed final byte-for-byte checks. The parallel run used child agents and reached the same final quality, but its shared workspace became unstable: a child cleanup deleted `/output/lib/cli/argparse.mjs` while the parent-owned `test1.mjs` still imported it, causing the parent's final scripted verification to fail with `ERR_MODULE_NOT_FOUND`. The parent then reconciled the active tree by switching to `argparse_like.mjs`, repairing IDNA modules, and rerunning verification successfully. Thus the concrete difference is process and recovery work rather than final official outcome.

parallel_anchor: `parallel/agent/codex/sessions/2026/08/09/rollout-2026-08-09T07-50-15-019fe580-4172-7351-8dd0-ce58a396fed4.jsonl:562`
serial_anchor: `serial/agent/codex/sessions/2026/08/09/rollout-2026-08-09T07-39-38-019fe576-86c8-7382-9ac3-1fe4eb2f06f1.jsonl:343`
causal_scope: no outcome difference

## Failure 1
top_label: Shared State and Merge Problems
sub_label: Concurrent Writes
third_label: Deliverable Overwrite
episode_id: parallel-cli-entrypoint-import-overwrite
comparative_role: parallel_adverse_but_not_outcome_differential
parallel_evidence: `parallel/agent/codex/sessions/2026/08/09/rollout-2026-08-09T07-50-36-019fe580-92c7-7022-866e-9c72dc7061e9.jsonl:456`
serial_contrast: `serial/agent/codex/sessions/2026/08/09/rollout-2026-08-09T07-39-38-019fe576-86c8-7382-9ac3-1fe4eb2f06f1.jsonl:265`
realized_consequence: The active entrypoint import graph was broken during final verification, producing `ERR_MODULE_NOT_FOUND` until the parent repaired and reverified the deliverable tree.
reasoning: The child Search actor deleted the CLI module path used by the parent-owned executable entrypoint while other parallel work still depended on that deliverable. The parent immediately observed the missing-module failure during whole-task verification, then had to reconcile the deliverable/import path before final success. Serial provides the control because the same task was solved by one actor through direct patching and verification without a competing child cleanup of the executable tree.
nearest_rejected_label: Final-Tree Overwrite
rejection_reason: The cleanup removed several files, but the retained harm is more specifically the required executable/import deliverable being invalidated while another actor owned and used it; taxonomy precedence selects Deliverable Overwrite over the broader final-tree label.
