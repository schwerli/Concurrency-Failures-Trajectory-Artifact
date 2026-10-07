export const meta = {
  name: 'middleware-notused-async-fix',
  description: 'Diagnose and fix MiddlewareNotUsed poisoning the async middleware chain in django/core/handlers/base.py',
  phases: [
    { title: 'Investigate', detail: 'root cause, adjacent bugs, test conventions' },
    { title: 'Verify', detail: 'adversarially check each finding' },
  ],
}

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What you found, concretely' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          detail: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['title', 'file', 'detail', 'confidence'],
      },
    },
  },
  required: ['summary', 'findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    reasoning: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['real', 'reasoning'],
}

const REPO = '/testbed'

const LENSES = [
  {
    key: 'rootcause',
    prompt: `In the Django repo at ${REPO}, read django/core/handlers/base.py load_middleware() closely (lines ~26-95).

The reported bug (Django ticket #32285): when a middleware raises MiddlewareNotUsed inside load_middleware, the \`handler\` variable has ALREADY been reassigned by the preceding \`handler = self.adapt_method_mode(...)\` call before \`middleware(handler)\` raised. The \`continue\` then leaves \`handler\` adapted to the *skipped* middleware's mode, and \`handler_is_async\` still reflects the OLD mode -- so handler and handler_is_async are now inconsistent. Downstream middleware get a wrongly-adapted handler.

Trace the exact failure: ASGI (is_async=True), MIDDLEWARE = [AsyncCapableMw, SyncOnlyMwThatRaisesMiddlewareNotUsed]. Remember the loop iterates settings.MIDDLEWARE in REVERSE. Walk through every variable assignment step by step and state precisely what handler/handler_is_async are at each point, and where the "object HttpResponse can't be used in 'await' expression" TypeError comes from.

Then state the minimal correct fix. Report findings via the schema. Do NOT edit any files.`,
  },
  {
    key: 'adjacent',
    prompt: `In the Django repo at ${REPO}, read django/core/handlers/base.py in full, plus django/core/handlers/asgi.py and django/core/handlers/exception.py (convert_exception_to_response).

Hunt for OTHER state-consistency bugs in load_middleware() beyond the known MiddlewareNotUsed/handler issue: places where a variable is mutated before an operation that can raise, where handler_is_async can desync from handler, where adapt_method_mode is called with a wrong method_is_async, or where an exception path leaves partial state. Also check: does the ImproperlyConfigured "returned None" path leave bad state? Does the final adapt at the top of the stack handle all cases?

Report only concrete, defensible issues with file:line. Do NOT edit any files.`,
  },
  {
    key: 'tests',
    prompt: `In the Django repo at ${REPO}, read tests/middleware_exceptions/tests.py (especially MiddlewareNotUsedTests around line 148) and tests/middleware_exceptions/middleware.py, plus tests/handlers/ and tests/async/ if relevant.

Goal: determine exactly how to write a regression test for this bug -- an ASGI/async request through a middleware chain where a sync-only middleware raises MiddlewareNotUsed, asserting the chain is not poisoned.

Report: (1) exact existing test class/decorator conventions used in that file (imports, @override_settings style, SimpleTestCase vs TestCase, how async tests are written -- async def + which base class), (2) what middleware classes already exist that raise MiddlewareNotUsed and whether they are async_capable, (3) the precise test you'd add and where. Include actual code snippets read from the files. Do NOT edit any files.`,
  },
  {
    key: 'docs',
    prompt: `In the Django repo at ${REPO}, search the docs for MiddlewareNotUsed and async middleware adaptation: grep docs/ for 'MiddlewareNotUsed', 'async_capable', 'sync_capable'. Read docs/topics/http/middleware.txt sections on async support and MiddlewareNotUsed.

Question: does the documentation promise that a sync-only (async_capable=False) middleware raising MiddlewareNotUsed works correctly under ASGI? Is any doc change needed as part of fixing this bug, or is it purely a code bug? Also check docs/releases/ for the current dev version to see if a release note is conventionally required for a bugfix like this.

Report findings. Do NOT edit any files.`,
  },
]

phase('Investigate')

const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `investigate:${l.key}`, phase: 'Investigate', schema: FINDINGS }),
  (res, lens) => {
    if (!res || !res.findings || !res.findings.length) return { lens: lens.key, summary: res ? res.summary : null, verified: [] }
    return parallel(res.findings.map(f => () =>
      agent(`You are an adversarial verifier working in the Django repo at ${REPO}.

A prior agent claims this about django/core/handlers/base.py:

TITLE: ${f.title}
FILE: ${f.file}${f.line ? ':' + f.line : ''}
DETAIL: ${f.detail}

Your job is to REFUTE it. Read the actual source yourself. Trace the control flow by hand. If you can, write and run a tiny reproduction using the repo's test runner or a python snippet with django.conf.settings configured, to prove or disprove the claim empirically. Default to real=false if you cannot substantiate it.

Return real=true ONLY if the claim is factually correct about the code as it exists. Put concrete evidence (line numbers, quoted code, command output) in the evidence field. Do NOT edit any repo files.`,
        { label: `verify:${lens.key}:${f.title.slice(0, 30)}`, phase: 'Verify', schema: VERDICT })
        .then(v => ({ ...f, verdict: v }))
    )).then(vs => ({ lens: lens.key, summary: res.summary, verified: vs.filter(Boolean) }))
  }
)

const clean = results.filter(Boolean)
const confirmed = clean.flatMap(r => (r.verified || []).filter(f => f.verdict && f.verdict.real).map(f => ({ lens: r.lens, ...f })))
const rejected = clean.flatMap(r => (r.verified || []).filter(f => !f.verdict || !f.verdict.real).map(f => ({ lens: r.lens, title: f.title, why: f.verdict ? f.verdict.reasoning : 'no verdict' })))

log(`${confirmed.length} confirmed, ${rejected.length} refuted`)

return {
  summaries: clean.map(r => ({ lens: r.lens, summary: r.summary })),
  confirmed,
  rejected,
}
