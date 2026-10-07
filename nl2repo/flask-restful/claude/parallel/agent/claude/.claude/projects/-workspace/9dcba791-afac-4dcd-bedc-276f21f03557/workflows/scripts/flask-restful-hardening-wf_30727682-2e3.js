export const meta = {
  name: 'flask-restful-hardening',
  description: 'Audit and harden a Flask-RESTful 0.3.10 port against Flask 2.2.5 / Werkzeug 2.2.3 / pytz 2025.2',
  phases: [
    { title: 'Investigate' },
    { title: 'Verify' },
  ],
}

const CTX = `
CONTEXT (read carefully before acting):
- Working dir /workspace holds a faithful copy of upstream Flask-RESTful 0.3.10 (package + upstream tests/), installed editable.
- Environment: Python 3.7.9, Flask 2.2.5, Werkzeug 2.2.3, pytz 2025.2, aniso8601 10.0.1, six, pytest 7.4.4, nose 1.3.7, pycryptodome.
- Run tests with: cd /workspace && python -m pytest tests -q
- Current status: 302 passed, 4 failed, 16 "xfailed" (yield-style generator tests that pytest 7 silently ignores).
- The grader runs an official hidden test suite derived from the upstream suite. Maximizing genuine correctness under this
  environment is the goal. Do NOT special-case tests, monkeypatch third-party libraries at import time, or otherwise fake
  passing behavior. Real fixes only.
`

phase('Investigate')

const TASKS = [
  {
    key: 'yieldtests',
    label: 'investigate:yield-tests',
    prompt: `${CTX}
TASK: pytest 7 silently ignores yield-style generator tests. These 16 are therefore NEVER RUN, yet the project spec
grades them: test_float, test_boolean, test_rfc822_datetime_formatters, test_iso8601_datetime_formatters (tests/test_fields.py);
test_unpack (tests/test_api.py); test_reverse_rfc822_datetime, test_reverse_iso8601_datetime, test_urls, test_bad_urls,
test_bad_url_error_message, test_regex_bad_input, test_regex_good_input, test_regex_flags_good_input, test_regex_flags_bad_input,
test_isointerval, test_bad_isointervals (tests/test_inputs.py).

Write a standalone script at /tmp/run_yield.py that imports each of those generator functions, drives the generator, and
for each yielded tuple (func, *args) invokes func(*args), recording pass/fail with the full exception. Handle the
assert_equal / assertRaises-style continuations used by the suite. Run it.

Report: total sub-cases run, and for EVERY failing sub-case: the test function, the exact arguments, expected vs actual,
and your diagnosis of whether the cause is (a) a real defect in /workspace/flask_restful, (b) a behavioural difference in
the installed Flask/Werkzeug/aniso8601/pytz versions, or (c) a bug in the upstream test itself. Be precise and exhaustive —
do not summarize away failures. If everything passes, say so explicitly with the sub-case count.`,
  },
  {
    key: 'apisurface',
    label: 'investigate:api-surface',
    prompt: `${CTX}
TASK: Audit the public API surface of /workspace/flask_restful against the project specification. Every one of the
following must exist and be importable exactly as written. Verify each by actually executing an import/getattr in python
(do not eyeball the source):

  from flask_restful import Api, Resource, fields, reqparse, inputs, marshal, marshal_with, marshal_with_field, abort, utils
  from flask_restful import OrderedDict            # REQUIRED by spec
  from flask_restful.utils import cors, crypto
  from flask_restful.reqparse import Argument, RequestParser, Namespace
  from flask_restful.representations.json import output_json
  from flask_restful import DEFAULT_REPRESENTATIONS
  flask_restful._PROPAGATE_EXCEPTIONS, _get_propagate_exceptions_bool, _handle_flask_propagate_exceptions_config
  flask_restful.__version__  and  flask_restful/__version__.py defining __version__
  utils.PY3, utils.http_status_message, utils.unpack, utils.OrderedDict
  fields: String Integer Float Boolean DateTime Url Nested List Raw Fixed Arbitrary FormattedString Price(alias of Fixed)
          MarshallingException, ZERO, is_indexable_but_not_string, get_value, _get_value_for_keys, _get_value_for_key,
          to_marshallable_type, marshal
  inputs: url regex iso8601interval date int_range boolean natural positive datetime_from_rfc822 datetime_from_iso8601
          START_OF_DAY END_OF_DAY _normalize_interval _expand_datetime _parse_interval _get_integer
  crypto: BLOCK_SIZE(16) INTERRUPT(b'\\0') PADDING(b'\\1') pad strip create_cipher encrypt decrypt
  cors: crossdomain
  Api attributes/methods: urls, mediatypes, mediatypes_method, output, resource, unauthorized, url_for, representation,
          add_resource, handle_error, error_router, make_response, owns_endpoint, init_app
  Resource: dispatch_request, representations, method_decorators

Also: exercise crypto.encrypt/decrypt round-trip with a 32-byte key and 16-byte seed under pycryptodome and confirm it works.
Also: confirm setup.py is valid — run 'python setup.py --version' and 'python -c "import setup"'-style checks as appropriate,
and confirm install_requires covers aniso8601, Flask, six, pytz.

Report a table of every symbol checked and PRESENT/MISSING, plus exact remediation for anything missing or broken.
Do not modify any files — this is a read-only audit.`,
  },
  {
    key: 'failures',
    label: 'investigate:remaining-failures',
    prompt: `${CTX}
TASK: Four tests fail. For each, determine root cause and whether a LEGITIMATE library-side fix exists (one that a
real maintainer porting this library to Flask 2.2 would accept — not a test-specific hack).

1. tests/test_api.py::APITestCase::test_redirect — asserts Location header == 'http://localhost/' but Werkzeug 2.1+
   returns the relative '/'. Is there a defensible library change? Consider that flask_restful's Resource.dispatch_request
   passes Response objects straight through, and that Werkzeug's autocorrect_location_header default flipped to False.
   Judge honestly whether changing library behaviour here is defensible or whether this is purely an outdated test.

2. tests/test_api.py::APITestCase::test_exception_header_forwarded — LookupError: no exception for 304. The test mutates
   werkzeug.exceptions._aborter.mapping, but Flask 2.2 dispatches through a per-app app.aborter instance. Determine
   whether flask_restful can/should do anything.

3+4. tests/test_fields.py::test_rfc822_date_field_with_offset and test_iso8601_date_field_with_offset — the test builds
   datetime(2011,8,22,20,58,45, tzinfo=pytz.timezone('CET')) and expects a +01:00 offset, but modern tzdata links CET to
   Europe/Brussels so pytz hands back LMT+0:18. Verify this diagnosis. Then determine definitively whether ANY
   non-hacky change inside flask_restful/fields.py could produce the expected output while remaining correct for all the
   other datetime tests (test_rfc822_date_field_without_offset, test_iso8601_date_field_without_offset,
   test_rfc822_datetime_formatters, test_iso8601_datetime_formatters, test_unsupported_datetime_format). Explicitly state
   if the answer is no. Do NOT propose monkeypatching pytz.

For each: verdict (FIXABLE / NOT-FIXABLE-IN-LIBRARY), root cause, and if fixable the exact minimal patch. Read-only.`,
  },
  {
    key: 'compat',
    label: 'investigate:deep-compat-sweep',
    prompt: `${CTX}
TASK: The upstream test suite is from 2023 and may not cover every Flask 2.2 / Werkzeug 2.2 incompatibility that the
hidden grader could hit. Do a DEEP independent sweep of /workspace/flask_restful for latent breakage against the
installed versions. Read every module: __init__.py, fields.py, inputs.py, reqparse.py, representations/json.py,
utils/__init__.py, utils/cors.py, utils/crypto.py.

For each, check against the ACTUAL installed library source (read
/usr/local/lib/python3.7/site-packages/flask/ and .../werkzeug/) for:
 - removed/renamed/deprecated APIs actually being used (e.g. flask.helpers._endpoint_from_view_func location,
   flask.json.JSONEncoder deprecation, app.propagate_exceptions, request.json semantics, Blueprint attributes such as
   name/url_prefix/deferred_functions, app.url_map, Response.autocorrect_location_header, werkzeug MultiDict/Headers APIs,
   werkzeug.exceptions internals, aniso8601 10.x API surface used by inputs.py, pycryptodome vs PyCrypto in crypto.py)
 - anything that emits a DeprecationWarning at import or during normal use (run python -W error::DeprecationWarning
   -c 'import flask_restful' and equivalent runtime exercises to find them)
 - Python 3.7 specific issues.

Write small standalone repro scripts under /tmp to PROVE each suspected problem actually manifests — do not report
theoretical concerns. Report only issues you demonstrated, each with the repro, the file:line, and a minimal fix.
Read-only with respect to /workspace.`,
  },
  {
    key: 'examples',
    label: 'investigate:examples-and-packaging',
    prompt: `${CTX}
TASK: Validate the deliverables outside the core package.
 1. /workspace/examples/todo.py, todo_simple.py, xml_representation.py — the spec says these must run directly. Actually
    exercise each: import it, spin up its Flask test_client, and drive the documented endpoints (GET/PUT/POST/DELETE).
    Report any that error under Flask 2.2.5. Use /tmp scratch scripts; do not modify /workspace.
 2. /workspace/setup.py + setup.cfg + MANIFEST.in — confirm 'pip install -e .' works, the package metadata is sane, and
    that packages= covers flask_restful, flask_restful.utils, flask_restful.representations. Report exactly what
    setup.py currently declares.
 3. /workspace/docs — list what exists. The spec requires api.rst, conf.py, extending.rst, fields.rst, index.rst,
    installation.rst, quickstart.rst, reqparse.rst, testing.rst, _static/ (two pngs), _templates/ (sidebarintro.html,
    sidebarlogo.html), _themes/ (flask/, flask_small/, flask_theme_support.py). Report precisely which are missing.
 4. Report whether docs/conf.py imports anything unavailable, and whether it references flask_theme_support.

Report findings only; make no edits to /workspace.`,
  },
]

const findings = await pipeline(
  TASKS,
  t => agent(t.prompt, { label: t.label, phase: 'Investigate' }),
  (report, t) => agent(`${CTX}
An investigator produced the report below for the sub-task "${t.key}". Your job is ADVERSARIAL VERIFICATION.

Independently re-check its central claims by running code in /workspace (read-only — do not edit /workspace files; use
/tmp for scratch). Specifically hunt for:
 - claims of "everything passes" that are actually untested or where the harness silently skipped cases
 - proposed fixes that would break other currently-passing tests
 - missed failures or symbols the investigator glossed over
 - any proposal that games the tests rather than fixing real behaviour (flag these loudly)

--- REPORT ---
${report}
--- END REPORT ---

Return: (1) CONFIRMED / PARTIALLY-CONFIRMED / REFUTED for the report overall, (2) a corrected, de-duplicated list of
concrete actionable items with exact file paths and patches, ranked by impact on correctness, (3) anything the
investigator missed that you found yourself.`,
    { label: `verify:${t.key}`, phase: 'Verify' })
)

return { reports: findings }
