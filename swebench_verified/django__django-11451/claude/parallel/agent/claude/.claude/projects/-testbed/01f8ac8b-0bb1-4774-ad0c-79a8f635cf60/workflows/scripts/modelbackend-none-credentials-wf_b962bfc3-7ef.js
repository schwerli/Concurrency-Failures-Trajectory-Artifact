export const meta = {
  name: 'modelbackend-none-credentials',
  description: 'Investigate ripple effects of short-circuiting ModelBackend.authenticate() on None credentials',
  phases: [
    { title: 'Investigate' },
    { title: 'Critique' },
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
          risk: { type: 'string', enum: ['blocks-patch', 'needs-update', 'informational'] },
        },
        required: ['file', 'detail', 'risk'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

const BASE = `Repo: /testbed (Django source checkout). Proposed patch to django/contrib/auth/backends.py, ModelBackend.authenticate():

    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None:
            username = kwargs.get(UserModel.USERNAME_FIELD)
        if username is None or password is None:
            return
        try:
            user = UserModel._default_manager.get_by_natural_key(username)
        ...

Rationale (Django ticket): when credentials are meant for another auth backend, username/password are None, and the current code makes a useless query (WHERE username IS NULL) plus runs the expensive password hasher. Read only; do not edit files.`

const LENSES = [
  {
    key: 'callers',
    prompt: `${BASE}

Your lens: CALLERS AND SUBCLASSES. Find every place in django/ (source) that calls ModelBackend.authenticate directly or indirectly, and every subclass of ModelBackend (including AllowAllUsersModelBackend, RemoteUserBackend, AllowAllUsersRemoteUserBackend) and any in tests/. For each, determine whether it can reach ModelBackend.authenticate with username=None or password=None, and whether the early return changes observable behavior. Pay special attention to django/contrib/auth/__init__.py authenticate() signature-inspection logic, contrib.auth forms (AuthenticationForm), admin login, RemoteUserMiddleware, and management commands (e.g. createsuperuser, changepassword). Report concrete file:line evidence.`,
  },
  {
    key: 'tests',
    prompt: `${BASE}

Your lens: EXISTING TEST REGRESSIONS. Search tests/ exhaustively for tests that would change behavior or fail under this patch. Specifically hunt for: calls to authenticate()/ModelBackend().authenticate() with username=None, password=None, missing password, empty-string username or password; tests asserting the timing-attack password-hasher run (#20760); tests around unusable passwords (set_unusable_password), custom USERNAME_FIELD user models (auth_tests/models/custom_user.py etc.), tests in auth_tests/test_auth_backends.py, test_forms.py, test_remote_user.py, test_views.py, test_management.py, and any assertNumQueries near auth. Quote the exact test names and lines. State for each whether it PASSES or FAILS under the patch and why.`,
  },
  {
    key: 'docs',
    prompt: `${BASE}

Your lens: DOCUMENTATION AND RELEASE NOTES. Find every doc that describes ModelBackend.authenticate() behavior, the timing-attack mitigation, or what backends should do with credentials they don't understand: docs/topics/auth/customizing.txt, docs/ref/contrib/auth.txt, docs/topics/auth/default.txt, and docs/releases/. Determine (a) whether any documented promise is broken, (b) which release-notes file is the in-development one for this checkout (check django/__init__.py VERSION and docs/releases/), and (c) whether this change warrants a release note and where exactly it would go. Quote existing nearby release-note entries so the style can be matched.`,
  },
  {
    key: 'semantics',
    prompt: `${BASE}

Your lens: SEMANTIC EDGE CASES of the guard itself. Analyze precisely: (1) Should the check be \`is None\` or falsy? What happens today for username='' or password='' — does a query run, can it ever authenticate anyone? Check get_by_natural_key and check_password/hashers behavior for '' and None passwords. (2) Can a user ever legitimately authenticate with password=None today? Trace check_password(None) through django/contrib/auth/hashers.py and django/contrib/auth/base_user.py — including unusable passwords and any custom hasher. (3) Does returning early leak a timing difference that matters WITHIN ModelBackend (as opposed to across backends)? (4) Does the kwargs.get(UserModel.USERNAME_FIELD) fallback interact badly with the new guard for custom user models whose USERNAME_FIELD is e.g. 'email'? Give definitive answers with file:line evidence from the actual source.`,
  },
]

phase('Investigate')
const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `probe:${l.key}`, phase: 'Investigate', schema: SCHEMA }),
  (res, lens) => {
    const blockers = (res?.findings || []).filter(f => f.risk !== 'informational')
    if (!blockers.length) return { lens: lens.key, res, verified: [] }
    return parallel(blockers.map(f => () =>
      agent(`${BASE}

A prior investigator (lens: ${lens.key}) reported this claim about the proposed patch:

  file: ${f.file} ${f.lines || ''}
  risk: ${f.risk}
  claim: ${f.detail}

Adversarially VERIFY it against the real source in /testbed. Open the file, read the surrounding code, and if it is a test claim, reason through the exact execution path (or run just that single test with \`python tests/runtests.py <label>\` if that is decisive). Default to refuted=true if you cannot substantiate it. Be precise about whether the patch truly changes observable behavior or merely removes a query.`,
        { label: `verify:${lens.key}:${f.file.split('/').pop()}`, phase: 'Critique', schema: {
          type: 'object',
          properties: {
            refuted: { type: 'boolean' },
            reasoning: { type: 'string' },
            actionRequired: { type: 'string' },
          },
          required: ['refuted', 'reasoning'],
        } })
        .then(v => ({ claim: f, verdict: v }))
    )).then(verified => ({ lens: lens.key, res, verified }))
  }
)

const clean = results.filter(Boolean)
return {
  summaries: clean.map(r => ({ lens: r.lens, summary: r.res?.summary })),
  informational: clean.flatMap(r => (r.res?.findings || []).filter(f => f.risk === 'informational')),
  confirmed: clean.flatMap(r => (r.verified || []).filter(Boolean).filter(v => !v.verdict?.refuted)),
  refuted: clean.flatMap(r => (r.verified || []).filter(Boolean).filter(v => v.verdict?.refuted).map(v => ({ file: v.claim.file, detail: v.claim.detail, why: v.verdict.reasoning }))),
}
