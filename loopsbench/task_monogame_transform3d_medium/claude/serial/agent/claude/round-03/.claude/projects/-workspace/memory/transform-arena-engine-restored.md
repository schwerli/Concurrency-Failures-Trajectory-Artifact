---
name: transform-arena-engine-restored
description: How to validate the restored MonoGame Vector3/Matrix/Quaternion math in /workspace beyond the graded 7-test filter
metadata: 
  node_type: memory
  type: project
  originSessionId: 67848779-0b5f-4208-a242-cb1ad923cc3c
---

The hollowed XNA math in `/workspace/MonoGame/MonoGame.Framework` (Vector3.cs, Matrix.cs,
Quaternion.cs, Point.cs) was restored to the canonical upstream MonoGame implementations.
`scripts/run_engine_checks.sh` only runs 7 tests (Vector3Test + MatrixTest minus TypeConverter),
which is far too narrow to catch a wrong Matrix.Invert / CreateLookAt / Decompose.

Use this much broader filter to actually validate the engine:

```
dotnet test MonoGame/Tests/MonoGame.Tests.DesktopGL.csproj -c Release --no-build \
 --filter '(FullyQualifiedName~MonoGame.Tests.Framework.Vector2Test|...Vector3Test|...Vector4Test|...MatrixTest|...QuaternionTest|...PlaneTest|...PointTest|...MathHelperTest|...BoundingTest|...RayTest)&FullyQualifiedName!~TypeConverter'
```

That is 119 tests and all pass; BoundingTest/RayTest are the ones that exercise the projection
and look-at factories plus Invert, so they catch mistakes the graded 7 miss. Requires
`SDL_VIDEODRIVER=dummy`.

**Why:** a green `engine_checks.json` does not mean the engine math is right.
**How to apply:** run the wide filter after touching any math type, before regenerating the
replay artifacts. Related: [[transform-arena-reference-hash]].
