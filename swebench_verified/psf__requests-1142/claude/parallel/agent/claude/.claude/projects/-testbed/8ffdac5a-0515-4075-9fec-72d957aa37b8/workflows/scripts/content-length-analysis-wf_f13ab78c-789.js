export const meta = {
  name: 'content-length-analysis',
  description: 'Map every Content-Length code path in /testbed/requests and design the GET fix',
  phases: [
    { title: 'Map', detail: 'parallel readers: call sites, tests, edge cases' },
    { title: 'Design', detail: 'candidate patches + adversarial critique' },
  ],
}

const MAP_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          what: { type: 'string' },
          why_it_matters: { type: 'string' },
        },
        required: ['file', 'what', 'why_it_matters'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings', 'notes'],
}

const READERS = [
  {
    key: 'callsites',
    prompt: `In the git repo /testbed (the "requests" HTTP library, circa v1.2). IGNORE the /testbed/build directory entirely — it is a stale copy.

Trace EVERY place the 'Content-Length' header is set, read, deleted, or implicitly relied upon, in /testbed/requests/**/*.py — including the vendored urllib3 under /testbed/requests/packages/urllib3/.

Specifically answer:
1. What does requests/adapters.py do differently when 'Content-Length' is absent from request.headers vs present (the \`chunked\` computation)? What happens for a GET with body=None if the header is absent?
2. Does vendored urllib3 (connectionpool.py / httplib) add its own Content-Length when a body is present but the header is absent? What about when body is None?
3. Where is prepare_content_length() called from? List every call site with file:line and the state of self.method / self.body at that moment.
4. Does anything in requests/auth.py (HTTPDigestAuth) or requests/sessions.py depend on Content-Length existing?

Report concrete file:line evidence. Do not propose fixes.`,
  },
  {
    key: 'tests',
    prompt: `In the git repo /testbed (the "requests" HTTP library). IGNORE /testbed/build.

Read /testbed/test_requests.py fully. Report:
1. How tests are run, and whether they need network access (httpbin). Quote the httpbin/service URL setup lines.
2. Every test that asserts on request headers, request body, Content-Length, redirects, digest auth, or prepared requests — list name + file:line + what it asserts.
3. Which tests can run WITHOUT network access (pure PreparedRequest/prepare_* tests). Give the exact pytest -k or unittest invocation to run only those.
4. Actually try running the offline-capable subset with \`cd /testbed && python -m pytest test_requests.py -x -q -k '<selector>' 2>&1 | tail -40\` and report the real output. Also report \`python -c "import requests; print(requests.__version__)"\` and the python version.

Report facts and command output only. Do not change any files.`,
  },
  {
    key: 'edgecases',
    prompt: `In the git repo /testbed (the "requests" HTTP library, circa v1.2). IGNORE /testbed/build.

Read /testbed/requests/models.py, focusing on PreparedRequest.prepare(), prepare_body(), prepare_content_length(), prepare_auth(), and RequestEncodingMixin._encode_files/_encode_params.

The reported bug: requests.get() ALWAYS sends 'Content-Length: 0' because prepare_content_length() unconditionally sets it. The intended fix is roughly: only default to '0' when the method is not GET/HEAD.

Enumerate EVERY behavioral edge case that this fix would change or could break. For each, state the exact code path and the before/after header outcome. Cover at minimum:
- GET with data= (a body IS present on a GET) — must Content-Length still be sent?
- HEAD, DELETE, OPTIONS, POST/PUT/PATCH with empty body
- method=None or lowercase method ('get'), and whether prepare_method runs before prepare_body (check ordering in prepare())
- data='' (empty string), data={} , data=b'', files={} , a file object at nonzero seek position
- streamed/iterable bodies (the is_stream branch — note it does NOT call prepare_content_length)
- prepare_auth() re-calling prepare_content_length after auth mutates the request (HTTPDigestAuth / HTTPBasicAuth)
- Session.resolve_redirects in requests/sessions.py: a 301/302 POST that becomes a GET reuses \`headers = req.headers\`. Does the OLD Content-Length from the POST survive into the redirected GET? Trace it precisely and say what header value the redirected GET would carry BEFORE and AFTER the proposed fix. This one is important — verify by reading the code, and if you can, by writing a tiny throwaway script in /tmp that builds the objects directly (no network) and prints the headers.
- A PreparedRequest constructed manually where prepare_body is called without prepare_method

Report each as a finding with file:line. Do not edit repo files (you may write throwaway scripts under /tmp).`,
  },
]

phase('Map')
const maps = await parallel(READERS.map(r => () =>
  agent(r.prompt, { label: `map:${r.key}`, phase: 'Map', schema: MAP_SCHEMA })
))

const mapText = READERS.map((r, i) => {
  const m = maps[i]
  if (!m) return `## ${r.key}\n(agent failed)`
  return `## ${r.key}\nNOTES: ${m.notes}\n` + m.findings.map(f => `- ${f.file}${f.line ? ':' + f.line : ''} — ${f.what} :: ${f.why_it_matters}`).join('\n')
}).join('\n\n')

log('Map complete; designing patch candidates')

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    diff: { type: 'string', description: 'unified diff of the proposed change' },
    rationale: { type: 'string' },
    risks: { type: 'string' },
    tests_to_add: { type: 'string' },
  },
  required: ['diff', 'rationale', 'risks', 'tests_to_add'],
}

phase('Design')
const ANGLES = [
  { key: 'minimal', slant: 'Absolutely MINIMAL change: touch only requests/models.py prepare_content_length. Argue why nothing else should change, and be explicit about any behavior you are knowingly leaving broken.' },
  { key: 'correct', slant: 'MOST CORRECT change per RFC 2616: GET/HEAD with no body must omit Content-Length; bodied requests must always carry an accurate one; stale Content-Length must never survive a body-dropping redirect. Fix every path needed, including requests/sessions.py resolve_redirects if the evidence shows a stale header survives.' },
  { key: 'upstream', slant: 'Match what the upstream requests project actually did for this issue historically (prepare_content_length using super_len and an `elif self.method not in (\'GET\', \'HEAD\')` default), staying idiomatic to this 1.2-era codebase.' },
]

const designs = await parallel(ANGLES.map(a => () =>
  agent(`You are designing a patch for the "requests" library in /testbed (IGNORE /testbed/build).

USER BUG REPORT: "requests.get is ALWAYS sending content length. It seems like request.get always adds 'content-length' header to the request. The right behavior is not to add this header automatically in GET requests, or add the possibility to not send it. For example http://amazon.com returns 503 for every GET request that contains a 'content-length' header."

Here is verified analysis of the codebase from three reader agents:

${mapText}

YOUR ASSIGNED ANGLE: ${a.slant}

Read the actual files in /testbed/requests/ yourself to confirm exact current text before writing a diff. Produce a concrete unified diff (do NOT apply it — do not edit repo files). Also propose the exact test code to add to /testbed/test_requests.py that would fail before and pass after, using only offline PreparedRequest construction (no network).`,
    { label: `design:${a.key}`, phase: 'Design', schema: DESIGN_SCHEMA })
))

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidate: { type: 'string' },
          score: { type: 'integer' },
          verdict: { type: 'string' },
        },
        required: ['candidate', 'score', 'verdict'],
      },
    },
    recommended_diff: { type: 'string' },
    recommended_tests: { type: 'string' },
    must_not_forget: { type: 'string' },
  },
  required: ['scores', 'recommended_diff', 'recommended_tests', 'must_not_forget'],
}

const designText = ANGLES.map((a, i) => {
  const d = designs[i]
  if (!d) return `### ${a.key}\n(failed)`
  return `### CANDIDATE ${a.key}\nDIFF:\n${d.diff}\n\nRATIONALE: ${d.rationale}\nRISKS: ${d.risks}\nTESTS: ${d.tests_to_add}`
}).join('\n\n')

const judge = await agent(`You are judging three candidate patches for this bug in the "requests" library at /testbed:

"requests.get is ALWAYS sending Content-Length: 0. GET should not automatically send Content-Length (amazon.com 503s on it)."

Codebase analysis:
${mapText}

Candidates:
${designText}

Score each 0-10 on: (a) does it actually fix the reported bug, (b) does it avoid introducing a regression (especially a stale Content-Length surviving a POST->GET redirect, and bodied GETs losing their Content-Length), (c) minimality/idiomatic fit with this 1.2-era codebase, (d) testability offline.

Then output ONE recommended unified diff synthesizing the best of them, and the recommended test additions. Verify the diff context lines against the real files in /testbed/requests/ before emitting. Do not edit any repo files.

In must_not_forget, list any regression risk the implementer must explicitly check by running code.`,
  { label: 'judge', phase: 'Design', schema: JUDGE_SCHEMA })

return { maps, designs, judge }
