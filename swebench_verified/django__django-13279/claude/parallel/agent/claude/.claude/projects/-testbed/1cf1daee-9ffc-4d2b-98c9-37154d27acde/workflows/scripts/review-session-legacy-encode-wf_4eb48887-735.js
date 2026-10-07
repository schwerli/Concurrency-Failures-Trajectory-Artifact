export const meta = {
  name: 'review-session-legacy-encode',
  description: 'Adversarially review the SessionBase._legacy_encode change for correctness, security, and completeness',
  phases: [
    { title: 'Review', detail: 'diverse-lens reviewers over the diff' },
    { title: 'Verify', detail: 'independent skeptics try to refute each finding' },
    { title: 'Critic', detail: 'completeness critic: what is missing' },
  ],
}

const DIFF = `diff --git a/django/contrib/sessions/backends/base.py b/django/contrib/sessions/backends/base.py
@@ -108,6 +108,9 @@ class SessionBase:
 
     def encode(self, session_dict):
         "Return the given session dictionary serialized and encoded as a string."
+        # RemovedInDjango40Warning: DEFAULT_HASHING_ALGORITHM will be removed.
+        if settings.DEFAULT_HASHING_ALGORITHM == 'sha1':
+            return self._legacy_encode(session_dict)
         return signing.dumps(
             session_dict, salt=self.key_salt, serializer=self.serializer,
             compress=True,
@@ -121,6 +124,12 @@ class SessionBase:
         except Exception:
             return self._legacy_decode(session_data)
 
+    def _legacy_encode(self, session_dict):
+        # RemovedInDjango40Warning.
+        serialized = self.serializer().dumps(session_dict)
+        hash = self._hash(serialized)
+        return base64.b64encode(hash.encode() + b':' + serialized).decode('ascii')
+
     def _legacy_decode(self, session_data):
         # RemovedInDjango40Warning: pre-Django 3.1 format will be invalid.
         encoded_data = base64.b64decode(session_data.encode('ascii'))

diff --git a/tests/sessions_tests/tests.py b/tests/sessions_tests/tests.py
@@ -34,6 +34,7 @@ from django.test import (
     RequestFactory, TestCase, ignore_warnings, override_settings,
 )
 from django.utils import timezone
+from django.utils.deprecation import RemovedInDjango40Warning
 
 from .models import SessionStore as CustomDatabaseSession
 
@@ -330,6 +331,13 @@ class SessionTestsMixin:
         # The failed decode is logged.
         self.assertIn('corrupted', cm.output[0])
 
+    @ignore_warnings(category=RemovedInDjango40Warning)
+    def test_default_hashing_algorith_legacy_decode(self):
+        with override_settings(DEFAULT_HASHING_ALGORITHM='sha1'):
+            data = {'a test key': 'a test value'}
+            encoded = self.session.encode(data)
+            self.assertEqual(self.session._legacy_decode(encoded), data)
+
     def test_actual_expiry(self):`

const CONTEXT = `Repo: /testbed, Django 3.2.0a0 dev checkout. Ticket #31592: "Session data cannot be decoded during the transition to Django 3.1."
Commit d4fff711d4 (#31274) changed the session data FORMAT (old: base64(sha1_hmac_hexdigest + ":" + serialized); new: signing.dumps(..., compress=True)). So setting DEFAULT_HASHING_ALGORITHM='sha1' alone did NOT let a Django 3.0 instance read data written by 3.1. The accepted fix is to emit the legacy format from encode() when DEFAULT_HASHING_ALGORITHM == 'sha1'.

Already verified by the author (do not re-report as new):
- Full suites pass: sessions_tests, messages_tests, auth_tests, signing, deprecation, test_client, test_client_regress, check_framework (1425 tests, OK).
- An independent re-implementation of pre-3.1 SessionBase.decode() successfully decodes what this code now writes under sha1.
- Tampered legacy payloads still decode to {}.
- Under the default sha256 setting, encode() still emits the new signing format, and a sha256 instance can still read legacy data.
- settings.DEFAULT_HASHING_ALGORITHM emits RemovedInDjango40Warning only on __setattr__/is_overridden, NOT on read, so reading it in encode() does not spam warnings (django/conf/__init__.py:204-205, 253-254).

The diff under review:
${DIFF}`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low', 'nit'] },
          detail: { type: 'string' },
          failure_scenario: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'detail', 'failure_scenario', 'suggested_fix'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['refuted', 'reasoning', 'evidence'],
}

const LENSES = [
  { key: 'correctness', prompt: `Review for CORRECTNESS bugs only. Read the real files in /testbed to check. Specifically scrutinise: byte-vs-str handling in _legacy_encode (self._hash returns str, serializer().dumps returns bytes — is hash.encode() + b':' + serialized correct?); whether _hash() truly produces a SHA-1 HMAC when DEFAULT_HASHING_ALGORITHM='sha1' AND when it is 'sha256' (trace django/utils/crypto.py salted_hmac defaults — this matters because _legacy_decode is also used in sha256 mode to read old data); PickleSerializer vs JSONSerializer; whether decode() round-trips its own legacy output. Verify claims by running python if useful (use /opt/miniconda3/envs/testbed/bin/python, PYTHONPATH=/testbed).` },
  { key: 'security', prompt: `Review for SECURITY issues only. Consider: is emitting SHA-1-HMAC uncompressed base64 session data acceptable given it is opt-in and deprecated? Any signature-verification bypass, any way the legacy branch weakens tamper protection versus signing.loads (note: legacy format has no timestamp/expiry in the signature — does that matter for sessions given expiry is stored in the payload and/or the backend)? Any risk that an attacker-controlled setting or a downgrade could be triggered without the operator opting in? Any information leak from the uncompressed payload? Read the real files in /testbed.` },
  { key: 'completeness', prompt: `Review for COMPLETENESS of the fix. Does anything ELSE in Django still break during a multi-instance 3.0->3.1 transition even after this change? Check django/contrib/messages/storage/cookie.py (does its _encode need the same treatment, or does the signer already handle it because only the algorithm changed and not the format?), django/contrib/sessions/backends/signed_cookies.py, django/contrib/auth (get_session_auth_hash, update_session_auth_hash, PasswordResetTokenGenerator), django/core/signing.py, django/contrib/auth/base_user.py. For each: state whether the FORMAT changed in 3.1 or only the ALGORITHM, and hence whether it is already covered by DEFAULT_HASHING_ALGORITHM. Read the real files in /testbed with line numbers.` },
  { key: 'tests', prompt: `Review the TEST changes only. Is the added test adequate and idiomatic for Django's test suite in /testbed/tests/sessions_tests/tests.py? Consider: does it actually assert the LEGACY FORMAT is produced (calling _legacy_decode is indirect — could it pass even if encode() emitted the new format? check whether _legacy_decode would raise or return {} for new-format input, and whether the assertEqual would then fail — run it to be sure); should there also be a test asserting the new format under sha256; is the method name typo "algorith" a problem given Django's actual upstream naming; does @ignore_warnings(category=RemovedInDjango40Warning) + with override_settings(...) order matter; do all SessionTestsMixin subclasses support it (some are plain unittest.TestCase — self.settings() is unavailable, which is why override_settings is used as a context manager). Run the suite to confirm: cd /testbed/tests && /opt/miniconda3/envs/testbed/bin/python runtests.py sessions_tests` },
  { key: 'docs-style', prompt: `Review for DOCUMENTATION and house-style. Does docs/releases/3.1.txt (the DEFAULT_HASHING_ALGORITHM section ~line 95-125) or docs/ref/settings.txt (~1298) need a note that session data ALSO reverts to the pre-3.1 format under 'sha1'? Quote current wording with line numbers and give a minimal patch if warranted. Also judge code style: the comment "# RemovedInDjango40Warning." vs the fuller comments elsewhere in the file, use of the builtin-shadowing name 'hash', and whether Django upstream would place _legacy_encode before or after decode(). Check other "# RemovedInDjango40Warning" comments in /testbed/django for the conventional phrasing.` },
]

phase('Review')
const reviewed = await pipeline(
  LENSES,
  l => agent(`${CONTEXT}\n\nYOUR LENS: ${l.prompt}\n\nOnly report real, actionable findings. An empty findings list is a perfectly good answer — do not invent issues. Do not report the already-verified items listed above.`,
    { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS }),
  (r, l) => parallel((r?.findings || []).map(f => () =>
    parallel(['correctness-of-claim', 'does-it-actually-reproduce', 'django-upstream-convention'].map(angle => () =>
      agent(`${CONTEXT}\n\nA reviewer (lens: ${l.key}) claims:\nTITLE: ${f.title}\nSEVERITY: ${f.severity}\nDETAIL: ${f.detail}\nFAILURE SCENARIO: ${f.failure_scenario}\nSUGGESTED FIX: ${f.suggested_fix}\n\nYour job is to REFUTE this claim from the "${angle}" angle. Read the actual files in /testbed and run code if needed (/opt/miniconda3/envs/testbed/bin/python, PYTHONPATH=/testbed, tests via cd /testbed/tests && ... runtests.py). Default to refuted=true if you are uncertain or if the claim is speculative/stylistic-noise. Only set refuted=false if you can demonstrate the problem is real and worth fixing.`,
        { label: `refute:${angle}`, phase: 'Verify', schema: VERDICT })))
      .then(vs => {
        const good = vs.filter(Boolean)
        const survives = good.filter(v => !v.refuted).length >= 2
        return { ...f, lens: l.key, survives, votes: good }
      })
  ))
)

const all = reviewed.flat().filter(Boolean)
const confirmed = all.filter(f => f.survives)
log(`${all.length} findings raised, ${confirmed.length} survived adversarial verification`)

phase('Critic')
const critic = await agent(
  `${CONTEXT}\n\nFive reviewers examined this change and their findings were adversarially verified. Surviving findings:\n${JSON.stringify(confirmed, null, 2)}\n\nAll raised findings (including refuted):\n${JSON.stringify(all.map(f => ({ lens: f.lens, title: f.title, severity: f.severity, survives: f.survives })), null, 2)}\n\nYou are the COMPLETENESS CRITIC. Answer: what is still missing from this change or its verification? Consider untested code paths, un-run test suites, doc updates, and whether the fix matches what Django upstream actually shipped for #31592 (check git log/branches in /testbed if that helps, and reason from the codebase conventions). Be concrete and short. If nothing is missing, say so plainly.`,
  { label: 'completeness-critic', phase: 'Critic' }
)

return { confirmed, refuted_count: all.length - confirmed.length, all_titles: all.map(f => ({ lens: f.lens, title: f.title, severity: f.severity, survives: f.survives })), critic }
