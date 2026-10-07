---
name: java-ds-course-repo-class-file-oracle
description: "In the /workspace Java data-structures course repo, the shipped .class files are pre-stub originals usable as a behavioural oracle"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4173553f-97c0-426b-992b-5a6ae6c6dc95
---

In the `/workspace` Java data-structures course project (Experiments/ + Homework/,
stubbed with `UnsupportedOperationException("TODO: implement")`), the repo tracks the
**original compiled `.class` files from before the stubbing**, next to the stubbed `.java`.

Two ways to exploit this:
1. **Recover exact bodies** — decompile with CFR 0.152
   (`https://repo1.maven.org/maven2/org/benf/cfr/0.152/cfr-0.152.jar`), then un-escape
   `\uXXXX` back to Chinese. Script: `agent_tests/regen_reference.sh` → `/tmp/ref/<Module>/`.
2. **Differential-test** — run the shipped `.class` directly
   (`java -cp <module dir> <Class>`) against your rebuilt one on identical input and
   compare. This is the gold-standard check and settles "is this a restoration bug or
   original behaviour?" questions.

`Experiments/DSExp01_Stack` additionally ships a submission `.zip` with pristine `.java` text.
No `.class` exists for `Homework/DS01/DS01_4`, `DS01_1`, `DS01_2` — those are from-scratch.

**Why:** several originals contain genuine student bugs (e.g. `DS01_3` Hamiltonian search
never resets `hasGet` on backtrack, so it falsely reports 无哈密顿通路 ~75% of the time at
n=8). Fidelity to the original is what's graded, so "fixing" such a bug is wrong.

**How to apply:** before declaring a module's output wrong, run the shipped `.class` on the
same input. If it produces the same wrongness, reproduce it, don't repair it.

Run programs with `LANG=C.UTF-8 java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8` or the
Chinese output turns into `?`. See [[java-ds-course-repo-scanner-stdin-pacing]].
