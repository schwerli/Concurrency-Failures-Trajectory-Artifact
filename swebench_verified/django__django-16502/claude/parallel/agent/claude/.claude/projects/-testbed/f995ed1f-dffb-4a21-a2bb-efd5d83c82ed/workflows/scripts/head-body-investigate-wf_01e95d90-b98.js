export const meta = {
  name: 'head-body-investigate',
  description: 'Investigate how runserver should suppress response bodies for HEAD requests',
  phases: [
    { title: 'Investigate', detail: 'wsgiref internals, existing tests, docs/release notes' },
    { title: 'Synthesize', detail: 'converge on the exact patch shape' },
  ],
}

const LENS = [
  {
    key: 'wsgiref-internals',
    prompt: `You are working in the Django source checkout at /testbed (Django 4.2 dev, Python 3.11).

GOAL: Determine the correct place in django/core/servers/basehttp.py (class ServerHandler, which subclasses wsgiref.simple_server.ServerHandler -> wsgiref.handlers.SimpleHandler -> BaseHandler) to suppress the response BODY for HTTP HEAD requests, while still sending correct headers (including Content-Length, per RFC 9110 which says HEAD responses SHOULD carry the same headers as the GET would).

Read the actual stdlib source of wsgiref/handlers.py and simple_server.py (use python -c "import wsgiref.handlers; print(wsgiref.handlers.__file__)" to locate them). Study in detail: run(), finish_response(), write(), send_headers(), finish_content(), close(), result_is_file(), sendfile(), send_preamble(), and the bytes_sent/headers_sent bookkeeping.

Answer precisely:
1. If we override finish_response() to skip iterating self.result when environ['REQUEST_METHOD'] == 'HEAD', what breaks? Specifically: (a) are headers still sent? (b) is Content-Length still emitted? Trace exactly which call emits headers when nothing is written -- look at finish_content() and close(). (c) must we still consume/close the WSGI app's returned iterable (PEP 3333 requires calling close() on it)? (d) does self.close() need calling, and what does BaseHandler.close() do vs. Django's ServerHandler.close() override (which does self.get_stdin().read())?
2. Compare with the alternative of overriding write() to no-op for HEAD. Enumerate the differences in observable behavior (Content-Length value, bytes_sent, whether send_headers is ever triggered).
3. Note the interaction with Django's ServerHandler.cleanup_headers(), which sets Connection: close when Content-Length is absent. If a HEAD response has no Content-Length (e.g. a streaming response), what should happen?
4. Consider error paths: what if iterating result raises? What does the stdlib do about closing result on exception?

Return a precise technical report with exact quoted stdlib code lines and line numbers, and a concrete recommended override (actual Python code) for Django's ServerHandler. Be exhaustive; this drives the patch.`,
  },
  {
    key: 'existing-tests',
    prompt: `You are in the Django source checkout at /testbed.

GOAL: Map out exactly where and how tests for django/core/servers/basehttp.py's ServerHandler and the runserver HTTP server live, so a new test for "HEAD requests must not return a response body" can be added in the idiomatic place.

Investigate:
- tests/builtin_server/tests.py -- read it fully. How does it instantiate ServerHandler? Is it Django's ServerHandler or the stdlib one? What helper classes (e.g. FileWrapperHandler, DummyHandler) exist? Show the full file content structure and the imports.
- tests/servers/tests.py -- read it. How does LiveServerBase / LiveServerViews work, what URLs are available (tests/servers/urls.py, views.py), and how do tests make raw HTTP requests (urlopen? socket? HTTPConnection?). Look for existing tests that assert on raw response bytes, Connection headers, Content-Length, or HTTP/1.1 keep-alive (there is likely a LiveServerPort / test_closes_connection_without_content_length style test).
- tests/handlers/ and tests/servers/test_basehttp.py if they exist -- any WSGIRequestHandler tests.
- Also grep the whole tests/ tree for 'ServerHandler', 'basehttp', 'HTTPConnection', 'LiveServerTestCase' subclass definitions relevant here.

Return: (a) full relevant file paths, (b) the exact existing test helper patterns with quoted code I can copy, (c) a recommendation of which file(s) a HEAD test belongs in and a concrete draft test using those existing patterns. Quote real code, do not invent APIs.`,
  },
  {
    key: 'docs-and-history',
    prompt: `You are in the Django source checkout at /testbed (Django 4.2 pre-release).

GOAL: Find all documentation, release notes, and historical context relevant to this ticket: "After #26052 runserver returns response body for HTTP HEAD requests". Ticket #26052 removed body-stripping for HEAD from Django's ConditionalGetMiddleware/HttpResponse in favour of letting the WSGI server do it, but runserver (django.core.servers.basehttp) never did it.

Investigate:
1. git log -S and git log --grep for '26052', 'HEAD', 'head request' in django/ and docs/ -- find the commit that removed the body stripping (likely touching django/middleware/http.py, django/http/response.py, or django/core/handlers/). Quote the diff of the relevant commit(s) via git show.
2. Where in django/ is HEAD handled today? grep for 'HEAD' across django/ (e.g. django/middleware/http.py, django/views/static.py, django/test/client.py, django/core/handlers/*). Note whether ConditionalGetMiddleware still strips bodies.
3. Which release notes file is the in-development one? ls docs/releases/ and identify the unreleased version's notes (check django/__init__.py VERSION). Report the exact file path and quote the section headers (e.g. 'Bugfixes', 'Minor features', and any 'django.core.servers'/'runserver' sections) so a note could be added in the right place. Also state Django's convention: are bugfixes in the dev release notes or only in the backport branch notes? Look at how other bugfix-only commits in recent git log handled docs.
4. Any docs mentioning runserver + HEAD, or docs/ref/request-response.txt statements about HEAD bodies.

Return an exhaustive report with quoted commands/output and exact file paths.`,
  },
]

phase('Investigate')
const reports = await parallel(LENS.map((l) => () =>
  agent(l.prompt, { label: `probe:${l.key}`, phase: 'Investigate' })
))

const good = reports.filter(Boolean)
log(`${good.length}/${LENS.length} probes returned`)

phase('Synthesize')
const SYNTH_SCHEMA = {
  type: 'object',
  properties: {
    patch_code: { type: 'string', description: 'Exact Python code to add/change in django/core/servers/basehttp.py, with surrounding context' },
    imports_needed: { type: 'string' },
    rationale: { type: 'string' },
    test_file: { type: 'string' },
    test_code: { type: 'string' },
    release_notes_file: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['patch_code', 'rationale', 'test_file', 'test_code', 'risks'],
}

const synth = await agent(
  `You are finalizing a Django patch for: "runserver must not return a response body for HTTP HEAD requests" (regression after ticket #26052).

Three investigators produced these reports. Reconcile them into ONE concrete patch proposal. Verify any claim you rely on by reading the real files in /testbed yourself -- do not trust the reports blindly.

=== REPORT: wsgiref internals ===
${good[0] || 'MISSING'}

=== REPORT: existing tests ===
${good[1] || 'MISSING'}

=== REPORT: docs and history ===
${good[2] || 'MISSING'}

Constraints:
- Headers MUST still be sent for HEAD, including Content-Length when the app supplied one (RFC 9110: HEAD response headers should match the GET).
- The WSGI app's returned iterable MUST still be closed per PEP 3333.
- Must not break HTTP/1.1 keep-alive logic in ServerHandler.cleanup_headers().
- Must be minimal and idiomatic to Django's codebase style (black-formatted, 88 cols).
- Write the test using ONLY helper patterns that actually exist in /testbed's test suite (quote-verified).

Return the structured result.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA, effort: 'high' }
)

return synth
