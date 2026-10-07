export const meta = {
  name: 'session-legacy-encode-investigate',
  description: 'Map every site affected by adding legacy session encoding under DEFAULT_HASHING_ALGORITHM=sha1',
  phases: [
    { title: 'Investigate', detail: 'parallel readers over sessions, signing, messages, tests, docs' },
    { title: 'Synthesize', detail: 'merge into a single implementation spec' },
  ],
}

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          lines: { type: 'string' },
          detail: { type: 'string' },
          action_needed: { type: 'string' },
        },
        required: ['file', 'detail', 'action_needed'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings', 'notes'],
}

const LENSES = [
  {
    key: 'session-format',
    prompt: `In /testbed (Django 3.1 dev checkout), read django/contrib/sessions/backends/base.py fully plus every other file under django/contrib/sessions/.
Goal: we must add a _legacy_encode() (pre-Django-3.1 format: base64(sha1_hash + b":" + serialized)) and make encode() use it when settings.DEFAULT_HASHING_ALGORITHM == 'sha1', so that two instances of a project (one on Django 3.0, one on 3.1) can share sessions during a transition.
Report: exact current code of encode/decode/_hash/_legacy_decode with line numbers; what the pre-3.1 encode() looked like (check git log -p on that file, commit d4fff711d4c97356bd6ba1273d2a5e349326eb5f for #31274); whether _hash() already uses sha1 unconditionally or depends on DEFAULT_HASHING_ALGORITHM (trace django.utils.crypto.salted_hmac and its algorithm default); any other place in the sessions app that assumes the new format.
Be precise about the byte-level format and whether hash.encode() / b':' joining is needed.`,
  },
  {
    key: 'signing-crypto',
    prompt: `In /testbed (Django 3.1 dev checkout), read django/utils/crypto.py (salted_hmac), django/core/signing.py, and django/conf/__init__.py + global_settings.py for DEFAULT_HASHING_ALGORITHM.
Question: if settings.DEFAULT_HASHING_ALGORITHM == 'sha1', does salted_hmac() with no explicit algorithm produce a SHA-1 HMAC? Does signing.dumps() then also use sha1? Show the code paths with line numbers.
Also: does merely READING settings.DEFAULT_HASHING_ALGORITHM emit a RemovedInDjango40Warning? Read django/conf/__init__.py lines ~195-260 carefully and explain exactly when the deprecation warning fires (on override/is_overridden vs on attribute access of Settings vs UserSettingsHolder). This matters because production code reading the setting must not spam warnings.
Report precise conclusions.`,
  },
  {
    key: 'tests',
    prompt: `In /testbed, read tests/sessions_tests/tests.py in full (it is long; focus on SessionTestsMixin and the class list at the bottom) and tests/messages_tests/test_cookie.py.
Report: line numbers of test_decode_legacy and neighbours; how tests reference RemovedInDjango40Warning / ignore_warnings; the exact style used by tests/messages_tests/test_cookie.py::test_default_hashing_algorithm (line ~175) since we want a symmetric sessions test.
Also identify: which test classes inherit SessionTestsMixin, whether any test asserts the exact output format of encode(), any test that would break if encode() changes under DEFAULT_HASHING_ALGORITHM='sha1', and any file-backend/db-backend test that round-trips encode->decode.
Propose concrete test methods (names + body) to add for: (a) a _legacy_encode/_legacy_decode round trip, (b) encode()/decode() round trip with DEFAULT_HASHING_ALGORITHM='sha1' asserting the legacy format is produced.
Also state exactly how to run the sessions + messages test suites in this checkout.`,
  },
  {
    key: 'docs',
    prompt: `In /testbed, read docs/releases/3.1.txt around the DEFAULT_HASHING_ALGORITHM section (~line 95-125), docs/ref/settings.txt around the DEFAULT_HASHING_ALGORITHM setting (~1298), and docs/internals/deprecation.txt line ~121.
Question: does any doc text need updating to say that sessions ALSO fall back to the legacy (pre-3.1) session data format when DEFAULT_HASHING_ALGORITHM='sha1'? Quote the current wording with line numbers and propose a minimal, house-style edit if one is warranted. Django docs are terse; do not propose sprawling additions. Report the exact current wording so a precise edit can be made.`,
  },
  {
    key: 'ripple',
    prompt: `In /testbed, hunt for any OTHER code that would be affected by session encode() returning the legacy base64 format when settings.DEFAULT_HASHING_ALGORITHM == 'sha1'.
Grep for: .encode( calls on session objects, session_data length assumptions, django/contrib/sessions/base_session.py, the db backend's session_data field, cached_db, file backend, django/contrib/auth (login/logout, get_session_auth_hash, update_session_auth_hash), test client (django/test/client.py) session handling, and django/contrib/sessions/serializers.py.
Report each place with file:line and whether it breaks, plus whether the legacy format can exceed any column/cookie length limits (note the legacy format is uncompressed base64, the new one is compressed).
Also check django/contrib/sessions/backends/signed_cookies.py — does it use SessionBase.encode or its own signing? Does it need the same treatment?`,
  },
]

phase('Investigate')
const results = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `probe:${l.key}`, phase: 'Investigate', schema: SCHEMA })
))

const merged = LENSES.map((l, i) => ({ lens: l.key, result: results[i] })).filter(r => r.result)

phase('Synthesize')
const spec = await agent(
  `You are synthesizing an implementation spec for Django ticket #31592 "Session data cannot be decoded during the transition to Django 3.1".

Background: commit d4fff711d4c97356bd6ba1273d2a5e349326eb5f (#31274) changed the session data FORMAT (old: base64(sha1_hmac_hexdigest + ":" + serialized); new: signing.dumps(..., compress=True)). Therefore setting DEFAULT_HASHING_ALGORITHM='sha1' is NOT enough for a multi-instance transition: a Django 3.0 instance cannot decode data written by a 3.1 instance. Fix: SessionBase.encode() should emit the legacy format when settings.DEFAULT_HASHING_ALGORITHM == 'sha1'.

Here are five independent investigation reports (JSON):
${JSON.stringify(merged, null, 2)}

Produce the final spec: exact file edits (file, anchor code, replacement code) for django/contrib/sessions/backends/base.py, exact new tests with full bodies and correct file/class placement, any doc edit, and the exact commands to run the affected test suites. Resolve contradictions between reports by naming the file/line evidence that settles it. Flag anything the reports left uncertain. Keep the code minimal and in Django's house style (comment markers like "# RemovedInDjango40Warning").`,
  { label: 'synthesize-spec', phase: 'Synthesize' }
)

return { spec, merged }
