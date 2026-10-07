---
name: django-testbed-test-runner
description: "How to actually run the Django test suite in this /testbed checkout (the default python can't import django)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3a2baa5f-75e6-4eba-bdc9-e1065a7b2dc3
---

Run the test suite with the `testbed` conda interpreter from the repo root:

`/opt/miniconda3/envs/testbed/bin/python tests/runtests.py <labels> --settings=test_sqlite`

The default `python` on PATH (`/opt/miniconda3/bin/python`) fails: `import django` doesn't resolve
(no editable install; `runtests.py` puts `/testbed/tests` on `sys.path`, not `/testbed`), and even
with `PYTHONPATH=/testbed` it lacks `asgiref`. Only the `testbed` env has the dependencies.

psycopg2, cx_Oracle, and MySQLdb are NOT installed, so postgresql/oracle/mysql-gated tests skip and
you cannot instantiate those `DatabaseWrapper`s — to exercise backend client code, construct a stub
object exposing `settings_dict` instead of going through `django.db.connections`.

Add `--parallel=1` when a test fails: the parallel runner can't pickle failures from test cases that
hold a real `connection` (RLock), and reports a pickling error instead of the real assertion.
