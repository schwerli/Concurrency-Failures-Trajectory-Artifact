schema_version: 2
pair_id: None/claude
task_id: django__django-11999
agent: claude
parallel_solution_passed: true
serial_solution_passed: false
outcome_relation: parallel_only_pass
verdict: patterns_retained
retained_pattern_count: 1

# Comparative Analysis

## Task-Solving Difference
The parallel run shipped the required Django behavior change: it modified `Field.contribute_to_class()` so Django only installs the generated `get_FOO_display()` when the concrete class does not already define that method, and it added regression coverage for both the reported override and an inherited-choices guard case. The serial run found the same area and added similar regression tests, but its submitted patch contains no source change, so the official evaluator still observed `get_foo_bar_display()` returning `foo` instead of `something`. The discordant outcome is therefore explained by implementation delivery, not by a parallel-side failure pattern: parallel delivered the source fix and serial delivered tests only.

parallel_anchor: `parallel/cell/model.patch:8`
serial_anchor: `serial/cell/evaluation/official-run/logs/run_evaluation/formal-claude-serial-django__django-11999/uiuc-claude-serial/django__django-11999/test_output.txt:376`
causal_scope: supported comparative explanation

## Failure 1
top_label: Shared State and Merge Problems
sub_label: Concurrent Writes
third_label: Deliverable Overwrite
episode_id: workflow-checkout-erased-main-fix
comparative_role: parallel_adverse_but_not_outcome_differential
parallel_evidence: `parallel/agent/claude/.claude/projects/-testbed/487dfd9b-4862-4223-9a5f-9346b68a295c/subagents/workflows/wf_ccda2be7-4a3/agent-a3677f09b5ec4450d.jsonl:80`
serial_contrast: `serial/cell/status.json:115`
realized_consequence: A workflow child reset the shared checkout and removed the parent-owned source fix and regression tests, forcing the parent to detect the loss, restore from backup, re-add tests, and re-run verification before delivery.
reasoning: The child action was a concrete write to the submitted workspace, not just parallel analysis. It restored tracked files with `git checkout` while the parent was using those files as the deliverable patch; the parent then found both the source guard and tests missing and had to repair them. Because the parent recovered and the final official run passed, this adverse parallel process episode did not cause the parallel_only_pass outcome.
nearest_rejected_label: Source Overwrite
rejection_reason: The overwritten source file was part of the required submitted patch and the same cleanup also removed the regression-test deliverable, so the canonical write precedence makes Deliverable Overwrite more specific than Source Overwrite.
