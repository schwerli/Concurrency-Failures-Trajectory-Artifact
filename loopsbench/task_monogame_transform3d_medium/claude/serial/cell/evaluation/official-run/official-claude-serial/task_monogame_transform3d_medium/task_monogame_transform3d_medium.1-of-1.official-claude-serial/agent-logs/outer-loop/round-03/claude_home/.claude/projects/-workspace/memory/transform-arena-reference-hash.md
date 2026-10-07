---
name: transform-arena-reference-hash
description: "Transform Arena replay hash bf3159... is not derivable from the workspace; which hypotheses were already ruled out"
metadata: 
  node_type: memory
  type: project
  originSessionId: 67848779-0b5f-4208-a242-cb1ad923cc3c
---

In /workspace (MonoGame + LhbTransformArena "Transform Arena"), the reference
`assets/expected/final_state.sha256` = `bf3159660327a8dfa6b93a6a1844a2b0f8a422feef4c9f88b8081dfcaf6c5690`
cannot be reproduced from the information present in the workspace: `final_state.json`
includes `quaternion_score`, whose value depends on the five `QuaternionSystem.Compute*Score`
formulas and on the argument values `SimWorld.ComputeQuaternionScores` feeds them. Both were
hollowed out, and the requirement files only name which engine ops each must call, not the
formulas, so the value is under-determined.

Ruled out by direct measurement on 2026-08-14 (do not redo these):
- Run() with no damping and no quaternion scoring -> 54fbfa8f...
- Run() with quaternion scoring but no damping -> 7da255b7...
- Run() with damping but no quaternion scoring -> 81ed788c..., plus a 252-combo sweep over
  damping factor {0.1..0.999} x interval {1,2,3,4,5,6,8,10,16} x dampen-before/after-integrate:
  no match.

**Why:** avoids burning a future round re-searching a space that cannot contain the answer.
**How to apply:** implement the game side canonically, verify determinism (run 1 hash == run 2
hash) and the `math_expectations.json` event types / trace flags, and report the reference-hash
mismatch honestly rather than fabricating the value. See [[transform-arena-engine-restored]].
