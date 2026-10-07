export const meta = {
  name: 'reconstruct-oracle-gameside',
  description: 'Independent panel reconstructs the hollowed game-side simulation code of Transform Arena',
  phases: [
    { title: 'Propose', detail: '10 independent reconstructions of the hollowed methods' },
  ],
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['run_body', 'dampen_body', 'quaternion_scores_body', 'rotation_score_body', 'slerp_score_body', 'concatenation_score_body', 'inverse_score_body', 'lerp_score_body', 'key_params', 'reasoning'],
  properties: {
    run_body: { type: 'string', description: 'C# body of SimWorld.Run(int ticks) — only the body, no signature' },
    dampen_body: { type: 'string', description: 'C# body of SimWorld.DampenVelocities(int tick)' },
    quaternion_scores_body: { type: 'string', description: 'C# body of SimWorld.ComputeQuaternionScores(int tick)' },
    rotation_score_body: { type: 'string', description: 'C# body of QuaternionSystem.ComputeRotationScore(float vx, float vy, float vz, float angleDeg)' },
    slerp_score_body: { type: 'string', description: 'C# body of QuaternionSystem.ComputeSlerpScore(float t, float fromAngle, float toAngle)' },
    concatenation_score_body: { type: 'string', description: 'C# body of QuaternionSystem.ComputeConcatenationScore(float yaw, float pitch, float roll)' },
    inverse_score_body: { type: 'string', description: 'C# body of QuaternionSystem.ComputeInverseScore(float vx, float vy, float vz)' },
    lerp_score_body: { type: 'string', description: 'C# body of QuaternionSystem.ComputeLerpScore(float t, float angle1, float angle2)' },
    key_params: {
      type: 'object',
      additionalProperties: false,
      required: ['phase_order', 'dampen_condition', 'dampen_factor', 'dampen_event_fields', 'quaternion_condition', 'quaternion_call_args', 'accumulation'],
      properties: {
        phase_order: { type: 'string', description: 'e.g. "spawn,impulse,integrate,dampen,quaternion,collisions,scan"' },
        dampen_condition: { type: 'string', description: 'e.g. "tick % 4 == 0" or "every tick"' },
        dampen_factor: { type: 'string', description: 'e.g. "0.9f"' },
        dampen_event_fields: { type: 'string', description: 'extra keys in the dampen event besides type/tick/entity' },
        quaternion_condition: { type: 'string', description: 'when ComputeQuaternionScores does work, e.g. "tick % 8 == 0"' },
        quaternion_call_args: { type: 'string', description: 'exact args passed to each of the 5 scoring methods' },
        accumulation: { type: 'string', description: 'how _totalQuatScore accumulates and where _usedQuaternion is set' },
      },
    },
    reasoning: { type: 'string', description: 'Why this is the most likely original implementation (<= 200 words)' },
  },
}

const FRAMINGS = [
  'You are the engineer who originally wrote this benchmark fixture. Reproduce your own code exactly as you first wrote it.',
  'Reconstruct the deleted code the way a careful C# game-engine developer writing a small deterministic headless fixture would write it. Favour the simplest idiomatic implementation.',
  'Think like the author of an auto-generated benchmark: short, clean, obvious methods; no cleverness; every documented engine call used exactly once in the order documented.',
  'You are reverse-engineering deleted method bodies from surrounding code style. Mirror the existing methods (Spawn/ApplyImpulse/IntegrateMotion/ResolveCollisions/ScanArena) as closely as possible in structure, naming and event shape.',
  'Reconstruct the code with emphasis on making the documented event types and trace flags all appear, with the smallest amount of code that does so.',
  'You are the oracle author. Note the requirement text lists, for each scoring method, exactly which engine APIs it calls, in order. Derive each body from that list mechanically.',
  'Assume the author wrote the simulation loop first and the quaternion scoring later as an add-on. Reconstruct both, keeping the add-on minimal and self-contained.',
  'Reconstruct the deleted bodies. Pay special attention to plausible constants (dampening factor, tick cadence) an author would pick for a 32-tick deterministic fixture with 4 entities.',
  'You are writing the reference solution for this task from scratch, aiming for maximum clarity and determinism. No randomness, no hard-coded end state.',
  'Reconstruct as literally as possible from the documentation strings in /workspace/requirements/sim_world.yaml and /workspace/requirements/quaternion_system.yaml, treating them as a specification of the deleted code.',
]

phase('Propose')

const CONTEXT = `You are reconstructing deleted C# method bodies in a deterministic headless MonoGame fixture.

Read these files first (they are the ground truth for style and structure):
- /workspace/game_project/SimWorld.cs        (Run, DampenVelocities, ComputeQuaternionScores are hollowed/empty; every other method is INTACT original code)
- /workspace/game_project/QuaternionSystem.cs (all 5 Compute*Score methods hollowed, return 0f; BuildQuaternionSummary is INTACT)
- /workspace/game_project/ReplayRunner.cs    (intact apart from a deliberate "seed = seed + 1" bug)
- /workspace/game_project/ReplayIO.cs        (LoadReplay hollowed; document classes intact)
- /workspace/assets/replay_inputs/replay_math.json   (the replay: seed 424242, 32 ticks, 4 spawns, 8 impulses)
- /workspace/assets/expected/math_expectations.json  (required event types: spawn, impulse, collision, scan, dampen, quaternion_score; min_event_count 12; min_ticks_simulated 16; required trace flags)
- /workspace/requirements/sim_world.yaml and /workspace/requirements/quaternion_system.yaml (auto-generated one-paragraph descriptions of the DELETED code — treat these as strong evidence of what the original called, and in what order)
- The engine is stock MonoGame (Microsoft.Xna.Framework): /workspace/MonoGame/MonoGame.Framework/{Vector3,Matrix,Quaternion,Point}.cs are fully restored upstream implementations, so any public API there is available.

Goal: produce the SINGLE most likely original body for each deleted method. The original produced a specific final_state.json whose SHA256 is fixed, so exact constants and call order matter. Be decisive: pick the most probable single implementation rather than hedging. Bodies must compile against the code as it exists (C# 12, nullable enabled, ImplicitUsings). Do not restructure existing intact methods. Do not add randomness. Do not hard-code final state.

Notes you must respect:
- SimWorld's constructor discards the seed ("_ = seed;") in the ORIGINAL intact code, so the simulation uses no RNG.
- The events list is a List<Dictionary<string, object?>> and every event dictionary starts with ["type"] then ["tick"].
- QuaternionSystem exposes TotalQuatScore and UsedQuaternion; the 5 Compute* methods return float and must be what makes those two members meaningful.
- BuildQuaternionSummary(entityId, tick) already emits the "quaternion_score" event dictionary, so SimWorld only needs to add its return value to the events list.

${''}`

const proposals = await parallel(FRAMINGS.map((framing, i) => () =>
  agent(`${CONTEXT}\n\nFraming for you specifically: ${framing}\n\nReturn the structured reconstruction.`,
    { label: `propose-${i + 1}`, phase: 'Propose', schema: SCHEMA })))

return { proposals: proposals.filter(Boolean) }
