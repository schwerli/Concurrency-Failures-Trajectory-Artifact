---
name: testbed-python-interpreter
description: "In the /testbed sympy repo, use /opt/miniconda3/envs/testbed/bin/python — the default `python` lacks mpmath"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6c4c6aa4-7f73-499a-a93b-d9d6c889430b
---

In the `/testbed` sympy checkout, the `python`/`python3` first on PATH (`/opt/miniconda3/bin/python`, 3.11) has **no `mpmath`**, so `import sympy` fails outright with "SymPy now depends on mpmath as an external library". Use `/opt/miniconda3/envs/testbed/bin/python` (3.9) instead — that is the env sympy is installed into.

There is also no `pytest` in that env. Run tests with sympy's own runner:
`/opt/miniconda3/envs/testbed/bin/python -c "import sympy; sympy.test('sympy/utilities/tests/test_codegen.py')"`

`cython` is **not** installed and there is no `gfortran`, so `sympy/external/tests/test_autowrap.py` fully skips and `sympy/codegen/tests/test_fnodes.py` + `test_algorithms.py` raise 7 exceptions **on a clean tree** — that baseline noise is pre-existing, not a regression. `gcc` *is* present.
