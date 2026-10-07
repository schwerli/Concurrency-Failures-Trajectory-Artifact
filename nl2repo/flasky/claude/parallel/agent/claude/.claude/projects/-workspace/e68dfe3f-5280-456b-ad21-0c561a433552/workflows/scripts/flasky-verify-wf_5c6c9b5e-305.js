export const meta = {
  name: 'flasky-verify',
  description: 'Adversarially verify the Flasky implementation in /workspace against the official flasky test suite and the project specification',
  phases: [
    { title: 'Probe', detail: 'independent test suites written to /tmp and run against /workspace' },
    { title: 'Verify', detail: 'adversarially confirm or refute each reported finding' },
    { title: 'Critic', detail: 'completeness sweep for anything the probes missed' },
  ],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One paragraph: what you tested and the overall pass/fail picture.' },
    tests_run: { type: 'integer' },
    tests_failed: { type: 'integer' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string', description: 'repo-relative path in /workspace that must change' },
          evidence: { type: 'string', description: 'Exact test code + exact traceback/output proving the problem.' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
        required: ['title', 'severity', 'file', evidence_key(), 'expected', 'actual', 'suggested_fix'],
      },
    },
  },
  required: ['summary', 'tests_run', 'tests_failed', 'findings'],
}

function evidence_key() { return 'evidence' }

const RULES = `
HARD RULES:
- /workspace holds the implementation under test. You are READ-ONLY on /workspace: never create, edit, or delete ANY file there. Do not run any command that writes into /workspace (no pip install -e, no flask db, no touching data-dev.sqlite).
- Write all of your own scratch files and test suites under your own private directory: WORKDIR below. mkdir -p it first.
- Run tests with:  cd WORKDIR && PYTHONPATH=/workspace python3 -m pytest -x -q <yourfile>   (or python3 -m unittest). Python is 3.9.23; Flask 0.12.2, Flask-SQLAlchemy 2.5.1, SQLAlchemy 1.4.46, Werkzeug 0.12.2, itsdangerous 0.24, WTForms 2.1, Flask-Login 0.4.0, Flask-HTTPAuth 3.2.3. Do NOT pip install anything.
- Use config name 'testing' (in-memory sqlite, CSRF disabled).
- ACTUALLY RUN every test you write. Never report a finding you have not reproduced with real output. Paste the real traceback into 'evidence'.
- Distinguish "the implementation is wrong" from "my test is wrong". If a test fails because of how YOU set it up (e.g. forgot db.create_all(), forgot Role.insert_roles(), forgot an app/request context), fix your test, do not report a finding.
- Report ONLY genuine defects in /workspace. If everything you tested passes, return an empty findings array. Empty is a perfectly good answer.
`

const SPEC_FACTS = `
Key spec requirements to hold the implementation to:
- These imports must both work: \`from flask import current_app\` and
  \`from app.models import User, Role, Post, Comment, create_app, db, fake, AnonymousUser, Permission, Follow\`.
  \`from app import ...\` must also export all of those plus a version string.
- Permission bit flags: FOLLOW=1, COMMENT=2, WRITE=4, MODERATE=8, ADMIN=16.
- Roles from Role.insert_roles(): 'User' (default=True, FOLLOW|COMMENT|WRITE), 'Moderator' (+MODERATE), 'Administrator' (+ADMIN).
- Role: add_permission/remove_permission/reset_permissions/has_permission, __repr__ '<Role %r>'.
- User: password write-only property (reading raises AttributeError), verify_password, generate_confirmation_token/confirm,
  generate_reset_token/reset_password (static), generate_email_change_token/change_email, can, is_administrator, ping,
  gravatar_hash, gravatar, follow, unfollow, is_following, is_followed_by, followed_posts property, to_json,
  generate_auth_token, verify_auth_token (static), add_self_follows (static). User.__init__ self-follows.
- AnonymousUser.can() and .is_administrator() both return False; it is the login_manager.anonymous_user.
- Post.on_changed_body renders Markdown then bleach-cleans+linkifies into body_html; Post.to_json/from_json;
  from_json raises app.exceptions.ValidationError when body missing/empty. Same for Comment (narrower tag list).
- API mounted at /api/v1. Endpoints: GET users/<id>, users/<id>/posts/, users/<id>/timeline/, posts/, posts/<id>,
  POST posts/, PUT posts/<id>, GET comments/, comments/<id>, posts/<id>/comments/, POST posts/<id>/comments/, POST tokens/.
  HTTP Basic auth required on every API request (email+password, or auth token as username with empty password).
  Unauthenticated -> 401. Unconfirmed account -> 403. Collection responses carry keys posts/comments, prev, next, count.
- Web routes: main: / (GET+POST), /user/<username>, /edit-profile, /edit-profile/<int:id>, /post/<int:id> (GET+POST),
  /edit/<int:id>, /follow/<username>, /unfollow/<username>, /followers/<username>, /followed_by/<username>,
  /all, /followed, /moderate, /moderate/enable/<int:id>, /moderate/disable/<int:id>, /shutdown.
  auth (url_prefix /auth): /login, /logout, /register, /confirm/<token>, /confirm, /change-password, /reset,
  /reset/<token>, /change_email, /change_email/<token>, /unconfirmed.
- Anonymous GET / must return 200 and contain the word 'Stranger'.
- Forms: app/auth/forms.py -> LoginForm, RegistrationForm, ChangePasswordForm, PasswordResetRequestForm,
  PasswordResetForm, ChangeEmailForm. app/main/forms.py -> NameForm, EditProfileForm, EditProfileAdminForm,
  PostForm, CommentForm.
- app/decorators.py -> permission_required(permission), admin_required(f). app/api/decorators.py -> permission_required.
- app/email.py -> send_email(to, subject, template, **kwargs) returning the Thread, send_async_email(app, msg).
- app/api/errors.py -> bad_request/unauthorized/forbidden + a ValidationError handler on the api blueprint.
`

phase('Probe')

const PROBES = [
  {
    key: 'official-user-model',
    workdir: '/tmp/verify/user-model',
    prompt: `You are reconstructing and running the OFFICIAL upstream test suite \`tests/test_user_model.py\` from
Miguel Grinberg's flasky repository (2nd edition of "Flask Web Development", the version whose Permission class uses
integer bit flags FOLLOW=1/COMMENT=2/WRITE=4/MODERATE=8/ADMIN=16) against the implementation in /workspace.

Recall that file as faithfully as you can and write it to WORKDIR/test_user_model.py, then RUN it. It contains (at least)
tests for: password setter; no password getter (AttributeError); password verification; salts are random; valid
confirmation token; invalid confirmation token (another user's token); EXPIRED confirmation token (expiration=1 then
time.sleep(2)); valid reset token; invalid reset token; valid email change token; invalid email change token;
duplicate email change token (target email already taken); user role & permissions (can(FOLLOW/COMMENT/WRITE) True,
can(MODERATE) False, can(ADMIN) False); moderator role; administrator role; anonymous user (can() False,
is_administrator() False); timestamps (member_since and last_seen recent); ping() advances last_seen;
gravatar (url contains the md5 hash, size/rating/default args honoured, e.g. 'd4c74594d841139328695756648b6bd6');
follows (u1.follow(u2), is_following, is_followed_by, followed/followers counts INCLUDING the self-follow rows,
unfollow, timestamps, and deleting a user cascades its Follow rows); and to_json (exact key set
['url','username','member_since','last_seen','posts_url','followed_posts_url','post_count'] and url == '/api/v1/users/<id>').
Use setUp that does: create_app('testing'), push app context, db.create_all(), Role.insert_roles(); tearDown that does
db.session.remove(), db.drop_all(), pop context.

Report every genuine failure.`,
  },
  {
    key: 'official-client',
    workdir: '/tmp/verify/client',
    prompt: `You are reconstructing and running the OFFICIAL upstream test suites \`tests/test_basics.py\` and
\`tests/test_client.py\` from Miguel Grinberg's flasky repository against the implementation in /workspace.

test_basics.py: test_app_exists (current_app is not None), test_app_is_testing (current_app.config['TESTING']).
test_client.py (self.client = self.app.test_client(use_cookies=True)):
 - test_home_page: GET '/' is 200 and the body contains 'Stranger'.
 - test_register_and_login: POST /auth/register with email/username/password/password2 -> 302 redirect;
   POST /auth/login with the new credentials, follow_redirects=True -> 200 and body matches 'Hello,\\s+john'
   and contains 'You have not confirmed your account yet';
   then generate a confirmation token for the user and GET /auth/confirm/<token> follow_redirects=True -> body
   contains 'You have confirmed your account';
   then GET /auth/logout follow_redirects=True -> body contains 'You have been logged out'.
Write them to WORKDIR/, RUN them.

THEN extend with your own end-to-end client tests, in the same style, exercising every remaining web route listed in
the spec below: profile page, edit profile, admin edit profile, creating a post through POST '/', the post permalink
page, editing a post, posting a comment, follow/unfollow/followers/followed_by, /all and /followed cookie toggles,
moderation pages as a Moderator, the 403 for a plain user hitting /moderate, /auth/reset and /auth/reset/<token>
password reset round trip, /auth/change-password, /auth/change_email + /auth/change_email/<token> round trip,
/auth/confirm resend, and the 404/403 error pages. Every route must render without a 500.

Report every genuine failure.`,
  },
  {
    key: 'official-api',
    workdir: '/tmp/verify/api',
    prompt: `You are reconstructing and running the OFFICIAL upstream test suite \`tests/test_api.py\` from
Miguel Grinberg's flasky repository against the implementation in /workspace.

It uses a get_api_headers(username, password) helper returning
{'Authorization': 'Basic ' + b64encode((username+':'+password).encode()).decode(), 'Accept': 'application/json',
 'Content-Type': 'application/json'} and covers: test_404 (a bad URL with json headers returns 404 and a JSON body
whose 'error' is 'not found'); test_no_auth (GET /api/v1/posts/ with only Content-Type json -> 401);
test_bad_auth (wrong password -> 401); test_token_auth (POST /api/v1/tokens/ with a bad token -> 401;
POST /api/v1/tokens/ with good email+password -> 200 and a 'token' key; then that token as the Basic username with
an empty password authenticates GET /api/v1/posts/ -> 200); test_anonymous ('' / '' -> 401);
test_unconfirmed_account (confirmed=False user -> 403); test_posts (POST /api/v1/posts/ with an empty body -> 400;
POST with a real body -> 201 plus a Location header; GET that Location -> 200 with the right url/body/body_html;
GET /api/v1/users/<id>/posts/ -> 200 with a 'posts' list of length 1; GET /api/v1/users/<id>/timeline/ -> 200 with
'posts' length 1; PUT the post with a new body -> 200 and the updated body);
test_users (two users, one writes a post; GET /api/v1/users/<id> for both -> 200 with the right usernames);
test_comments (a post plus comments, POST /api/v1/posts/<id>/comments/ -> 201 with a Location header, GET that
Location, GET /api/v1/posts/<id>/comments/ -> 'comments' list, GET /api/v1/comments/ -> 'comments' list).
Note: the users need confirmed=True and a role granting WRITE/COMMENT, so call Role.insert_roles() in setUp.

Write to WORKDIR/test_api.py and RUN it. Then extend with extra API tests: a non-author non-admin user PUTting
someone else's post must get 403; an administrator PUTting someone else's post must succeed; a user whose role
lacks WRITE (create a Role with no permissions) POSTing a post must get 403; GET a nonexistent post id -> 404;
pagination keys 'prev'/'next'/'count' present on every collection endpoint.

Report every genuine failure.`,
  },
  {
    key: 'spec-api-surface',
    workdir: '/tmp/verify/spec-surface',
    prompt: `Audit the implementation in /workspace against the numbered "API Usage Guide" of the project
specification, which enumerates 75 required classes/functions. Read /workspace/app/**/*.py and /workspace/config.py.

For EACH of these, write and RUN a Python check in WORKDIR that the symbol exists at the stated location with the
stated signature/behaviour, using inspect.signature / getattr / actual calls:
 Permission, Role (+insert_roles, add_permission, remove_permission, reset_permissions, has_permission, __repr__),
 Follow, User (every method listed in the spec), AnonymousUser, Post (+on_changed_body, to_json, from_json),
 Comment (+on_changed_body, to_json, from_json), LoginForm, ChangePasswordForm, RegistrationForm (+validate_email,
 validate_username), PasswordResetRequestForm, PasswordResetForm, ChangeEmailForm (+validate_email), PostForm,
 NameForm, EditProfileForm, EditProfileAdminForm (+__init__(user,...), validate_email, validate_username), CommentForm,
 app.email.send_async_email, app.email.send_email, app.decorators.permission_required, app.decorators.admin_required,
 app.api.decorators.permission_required, app.api.authentication.before_request/verify_password/auth_error/get_token,
 app.auth.views.before_request/logout/unconfirmed/login/register/confirm/resend_confirmation/change_password/
 password_reset_request/password_reset/change_email_request/change_email,
 app.api.users.get_user/get_user_posts/get_user_followed_posts,
 app.api.posts.get_posts/get_post/new_post/edit_post,
 app.api.errors.bad_request/unauthorized/forbidden/validation_error,
 app.api.comments.get_comments/get_comment/get_post_comments/new_post_comment,
 app.main.inject_permissions, app.main.errors.forbidden/page_not_found/internal_server_error,
 app.main.views.after_request/server_shutdown/index/user/edit_profile/edit_profile_admin/post/edit/follow/unfollow/
 followers/followed_by/show_all/show_followed/moderate/moderate_enable/moderate_disable.

Also verify the url_map: build the app and assert every route+method listed in the spec facts exists with the exact
rule string and endpoint name.

Also verify the file tree matches the spec's "Project directory structure" exactly (list what is missing or extra):
.gitignore, Dockerfile, LICENSE, Procfile, README.md, boot.sh, config.py, docker-compose.yml, flasky.py,
requirements.txt, app/{__init__,decorators,email,exceptions,fake,models}.py, app/api/{__init__,authentication,
comments,decorators,errors,posts,users}.py, app/auth/{__init__,forms,views}.py, app/main/{__init__,errors,forms,
views}.py, app/static/{favicon.ico,styles.css}, all the templates listed, migrations/{README,alembic.ini,env.py,
script.py.mako} and the 10 named files under migrations/versions/.
(Note: some of these top-level boilerplate files are being written concurrently by another process right now, so if a
top-level non-.py file is missing, re-check it once at the very END of your run before reporting it missing.)

Report each genuinely missing/mismatched item as a finding.`,
  },
  {
    key: 'spec-nodes',
    workdir: '/tmp/verify/spec-nodes',
    prompt: `The project specification contains "Detailed Function Implementation Nodes" 1-7, each with an
"Input and Output Example" that must work verbatim. Turn each into an executable test in WORKDIR and RUN it against
/workspace. The examples are:

Node 1 (auth): build a RegistrationForm inside a test_request_context, set form.email.data/username.data/password.data,
then \`user = User(email=..., username=...); user.password = ...; db.session.add(user); db.session.commit()\`;
assert user.id == 1. Then \`User.query.filter_by(email=...).first().verify_password("password123") is True\`.

Node 2 (posts): PostForm, \`post = Post(body=form.body.data, author=current_user._get_current_object())\`, commit,
post.id == 1, and \`current_user.posts.order_by(Post.timestamp.desc()).all()\` has length 1. (Log a user in with
flask_login.login_user inside a test_request_context so current_user works.)

Node 3 (comments): \`comment = Comment(body="This is a comment", author=current_user._get_current_object(), post=post)\`,
commit, comment.id == 1, \`post.comments.order_by(Comment.timestamp.asc()).all()\` length 1.

Node 4 (following): two users; \`if not user1.is_following(user2): user1.follow(user2); db.session.commit()\`;
\`user1.is_following(user2) is True\`. NOTE the spec then prints \`len(user1.followed.all())\` == 1 — reason about
whether the self-follow in User.__init__ makes that 2 instead, and if so report it as an OBSERVATION finding with
severity 'low' explaining the trade-off (upstream flasky does self-follow, so the spec text is probably just loose)
rather than as a bug. Do not report it as critical.

Node 5 (API): the exact snippet with base64 HTTP Basic auth: create_app('testing'), db.create_all(), a confirmed user
with password 'cat', client.get(f'/api/v1/users/{user.id}', headers={'Authorization': f'Basic {credentials}'}) -> 200,
and client.post('/api/v1/posts/', json={'body': ...}, headers=...) -> 201. IMPORTANT: this snippet as written does NOT
call Role.insert_roles(), so the user has no role and therefore no WRITE permission. Test BOTH variants (with and
without insert_roles) and report what happens. Note Flask 0.12's test client has no \`json=\` kwarg, so use
data=json.dumps(...) with Content-Type application/json; also check whether request.json works when the client sends
json without an explicit content type.

Node 6 (basics): create_app('testing'), app_context, current_app is not None, current_app.config['TESTING'] is True,
client.get('/') is 200 and 'Stranger' in the text.

Node 7 (selenium): do NOT try to run a real browser. Just verify the pieces a selenium test needs: that
/shutdown works when app.testing is True (and 404s otherwise), that the index page for a logged-in user named john
renders text matching 'Hello,\\s+john', and that a live-server style run (app.run in a thread) is possible — check
imports only, don't actually start Chrome.

Also test the "Example Usage" snippets from the spec: \`user.set_password('secret')\` (the spec calls set_password!),
\`Post(body='...', author=user)\`, \`Comment(body='...', post=post, author=user)\`,
\`Follow(follower=user, followed=another_user)\`.

Report every genuine failure.`,
  },
  {
    key: 'robustness',
    workdir: '/tmp/verify/robustness',
    prompt: `Adversarially hunt for real defects in /workspace that a grader's test suite might plausibly trip over.
Write and RUN tests in WORKDIR. Focus on:

1. IMPORT ORDER / CIRCULAR IMPORTS. Test every one of these as the FIRST import in a fresh interpreter
   (use subprocess with PYTHONPATH=/workspace, one process per case):
   \`import app\`; \`import app.models\`; \`from app.models import *\`; \`from app import *\`; \`import app.fake\`;
   \`import app.email\`; \`import app.decorators\`; \`import app.api\`; \`import app.auth.forms\`; \`import app.main.views\`;
   \`import app.api.authentication\`; \`import config\`; \`import flasky\`.
   Also test importing from a DIFFERENT working directory (e.g. cd /tmp) with PYTHONPATH=/workspace — does
   \`from config import config\` still resolve? And with sys.path manipulated instead of PYTHONPATH.
2. Calling to_json() / gravatar() / generate_*_token() with only an app context and NO request context, and with
   NO app context at all (the latter should raise a clear error, not hang).
3. Creating a User when Role.insert_roles() has NOT been run (role is None): does User(...) blow up? does can() work?
   does is_administrator() work? does the index page still render for that user?
4. Creating a User with email=None; with FLASKY_ADMIN set in config to the user's email (does that user get the
   Administrator role?). Test by monkeypatching app.config['FLASKY_ADMIN'] before creating the user.
5. Multiple create_app() calls in one process (does the second one break because extensions/event listeners are
   registered twice? do the db.event.listen calls fire twice and corrupt body_html?).
6. Post.body set to None, to '', to a very long string, to text containing <script> tags (must be stripped),
   javascript: URLs, and raw HTML — assert body_html is sanitised.
7. Comment.from_json / Post.from_json with None, {}, {'body': None}, {'body': ''} -> must raise ValidationError;
   and the API must turn that into a 400.
8. Token edge cases: token from user A used on user B; tampered token; token signed with a DIFFERENT SECRET_KEY;
   expired token (expiration=1 + sleep 2); reset_password with a nonexistent user id baked into the token;
   verify_auth_token with garbage.
9. Threading: send_email spawns a Thread. Register several users in a row and make sure nothing deadlocks or errors,
   and that MAIL_SUPPRESS_SEND is effectively on under TESTING so no SMTP connection is attempted.
10. db.drop_all()/create_all() between tests, and the unittest pattern of pushing/popping app contexts repeatedly.
11. Whether \`python3 -m pytest\` run from /workspace collects anything unexpected (e.g. tries to collect flasky.py,
    setup.py or migrations and errors out). Run \`cd /workspace && python3 -m pytest --collect-only -q\` and report
    if collection ERRORS (a "no tests ran" result is fine and is NOT a finding).
12. \`cd /tmp && PYTHONPATH=/workspace python3 -c "import flasky"\` — flasky.py creates the app at import time with the
    development config; does that write files or fail?

Report every genuine defect with a reproducer.`,
  },
  {
    key: 'packaging',
    workdir: '/tmp/verify/packaging',
    prompt: `Verify the packaging of /workspace WITHOUT mutating /workspace and WITHOUT any network access.

1. Read /workspace/setup.py and /workspace/requirements.txt. Check that \`python3 setup.py --version\`,
   \`python3 setup.py --name\` and \`python3 setup.py check\` succeed. Run them with cwd=/workspace but confirm
   afterwards (git-less: just \`ls -la /workspace\` before and after, and check for new files) that nothing was
   written into /workspace except possibly a *.egg-info directory — if setup.py check DOES create files in
   /workspace, delete only those newly-created build artifacts (\`*.egg-info\`, \`build/\`, \`dist/\`, \`.eggs/\`)
   afterwards and say so. Never delete a source file.
2. Confirm every pinned version in requirements.txt matches what \`pip list\` reports as installed. Report any
   mismatch (a requirement pinned to a version that is NOT what is installed would break \`pip install -r\` offline).
   Also report any INSTALLED core library that the spec's dependency list includes but requirements.txt omits.
3. Copy the whole tree to /tmp/verify/packaging/copy and there run \`python3 -m pip install --no-deps --no-build-isolation --no-index --target /tmp/verify/packaging/site .\`
   Then verify with \`PYTHONPATH=/tmp/verify/packaging/site python3 -c "import app, config; print(app.__version__)"\`
   from cwd=/tmp that the INSTALLED copy imports, and that the templates and static files were included as package
   data (check that /tmp/verify/packaging/site/app/templates/index.html and app/static/styles.css exist). If
   templates are missing from the installed package, that is a real finding (rendering would 500 for an installed
   deployment). If the install command itself is unavailable offline, say so and fall back to checking
   \`python3 setup.py --dry-run install\` / inspecting find_packages() and package_data by importing setup.py's
   helpers directly.
4. Check that setup.py's requirements() helper parses requirements.txt without error and returns a sane list
   (import setup.py as a module with runpy in a way that does not execute setup(), or just re-implement the parse).
5. Sanity-check MANIFEST/package_data coverage: list every non-.py file under /workspace/app and confirm each is
   matched by one of setup.py's package_data globs. Report any template that would be left out (e.g. deeply nested
   auth/email/*.txt).

Report findings.`,
  },
]

const probeResults = await pipeline(
  PROBES,
  (p) => agent(
    `${RULES}\n\nWORKDIR = ${p.workdir}\n\n${SPEC_FACTS}\n\n=== YOUR ASSIGNMENT ===\n${p.prompt}`,
    { label: `probe:${p.key}`, phase: 'Probe', schema: FINDINGS_SCHEMA }
  ),
  (res, p) => {
    if (!res || !res.findings || res.findings.length === 0) return { probe: p.key, res, verdicts: [] }
    return parallel(res.findings.map((f) => () =>
      agent(
        `${RULES}\n\nWORKDIR = ${p.workdir}-verify\n\n${SPEC_FACTS}\n\n=== YOUR ASSIGNMENT ===\n` +
        `Another agent reviewed the Flasky implementation in /workspace and reported the finding below. Your job is to ` +
        `REFUTE it. Default to refuted=true unless you can independently reproduce the defect with your own freshly ` +
        `written test and your own reading of /workspace's source.\n\n` +
        `Reasons a finding should be REFUTED:\n` +
        `- You cannot reproduce it (paste what you actually ran and got).\n` +
        `- The "expected" behaviour is the reporter's invention, not something the specification or the upstream ` +
        `flasky project actually requires.\n` +
        `- The failure is an artifact of the reporter's test setup (missing db.create_all(), missing Role.insert_roles(), ` +
        `missing app/request context, Flask 0.12 test client lacking json=, etc.) rather than a defect in /workspace.\n` +
        `- It is a stylistic preference, a docs nit, or a "nice to have" with no behavioural consequence.\n\n` +
        `FINDING UNDER REVIEW:\n` +
        `title: ${f.title}\nseverity: ${f.severity}\nfile: ${f.file}\nexpected: ${f.expected}\nactual: ${f.actual}\n` +
        `evidence:\n${f.evidence}\n\nsuggested_fix: ${f.suggested_fix}\n`,
        {
          label: `verify:${p.key}:${String(f.title).slice(0, 34)}`,
          phase: 'Verify',
          schema: {
            type: 'object',
            properties: {
              refuted: { type: 'boolean' },
              reasoning: { type: 'string', description: 'What you ran and what you concluded.' },
              reproduced_output: { type: 'string' },
              corrected_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'none'] },
              corrected_fix: { type: 'string', description: 'If real: the minimal precise fix, naming file and the exact code change.' },
            },
            required: ['refuted', 'reasoning', 'corrected_severity', 'corrected_fix'],
          },
        }
      ).then((v) => ({ finding: f, verdict: v }))
    )).then((verdicts) => ({ probe: p.key, res, verdicts: verdicts.filter(Boolean) }))
  }
)

const clean = probeResults.filter(Boolean)
const confirmed = []
for (const r of clean) {
  for (const v of r.verdicts) {
    if (v.verdict && v.verdict.refuted === false) {
      confirmed.push({ probe: r.probe, ...v.finding, verdict: v.verdict })
    }
  }
}
log(`probes done: ${clean.length}/${PROBES.length}; raw findings=${clean.reduce((n, r) => n + ((r.res && r.res.findings) ? r.res.findings.length : 0), 0)}; confirmed=${confirmed.length}`)

phase('Critic')

const digest = clean.map((r) => {
  const f = (r.res && r.res.findings) ? r.res.findings.map((x) => `    - [${x.severity}] ${x.file}: ${x.title}`).join('\n') : '    (none)'
  return `PROBE ${r.probe}: ran=${r.res ? r.res.tests_run : '?'} failed=${r.res ? r.res.tests_failed : '?'}\n  summary: ${r.res ? r.res.summary : 'DIED'}\n  findings:\n${f}`
}).join('\n\n')

const critique = await agent(
  `${RULES}\n\nWORKDIR = /tmp/verify/critic\n\n${SPEC_FACTS}\n\n=== YOUR ASSIGNMENT ===\n` +
  `Seven probe agents have just tested the Flasky implementation in /workspace. Their results:\n\n${digest}\n\n` +
  `You are the completeness critic. Ask: what did they NOT cover that a grader's automated test suite would plausibly ` +
  `exercise? Then GO TEST IT YOURSELF in WORKDIR and report only what actually fails.\n\n` +
  `Specifically consider, and actually run: template rendering of every single template file under ` +
  `/workspace/app/templates (render each one through the route that uses it, including the email .txt/.html ` +
  `templates via app.email.send_email with MAIL_SUPPRESS_SEND, and 403.html/404.html/500.html); Flask-Bootstrap / ` +
  `Flask-Moment / Flask-PageDown integration in templates (wtf.quick_form on PageDownField, moment(...).fromNow(), ` +
  `pagedown.include_pagedown()); the pagination_widget macro with a multi-page pagination object (>20 posts) on ` +
  `index, user, post, followers and moderate pages; the show_followed/show_all cookie behaviour; the ` +
  `@auth.before_app_request redirect for unconfirmed users hitting a non-auth endpoint; the /shutdown route; ` +
  `main/errors.py JSON-vs-HTML content negotiation (Accept: application/json only -> JSON error body); ` +
  `after_request slow-query logging with SQLALCHEMY_RECORD_QUERIES; and Role.insert_roles() being idempotent when ` +
  `called twice.\n` +
  `Also re-read /workspace/app/models.py, /workspace/app/main/views.py, /workspace/app/auth/views.py and ` +
  `/workspace/app/api/*.py line by line looking for real logic bugs (wrong variable, off-by-one in the comment ` +
  `page=-1 computation, permission check that lets the wrong user through, missing db.session.commit(), a ` +
  `cascade that would orphan rows).\n\n` +
  `Return findings for genuine defects only.`,
  { label: 'critic', phase: 'Critic', schema: FINDINGS_SCHEMA }
)

return {
  probe_summaries: clean.map((r) => ({
    probe: r.probe,
    tests_run: r.res ? r.res.tests_run : null,
    tests_failed: r.res ? r.res.tests_failed : null,
    summary: r.res ? r.res.summary : 'agent died',
  })),
  confirmed_findings: confirmed.map((c) => ({
    probe: c.probe,
    title: c.title,
    file: c.file,
    severity: c.verdict.corrected_severity,
    expected: c.expected,
    actual: c.actual,
    evidence: String(c.evidence).slice(0, 1500),
    fix: c.verdict.corrected_fix,
    verifier_reasoning: String(c.verdict.reasoning).slice(0, 800),
  })),
  refuted_count: clean.reduce((n, r) => n + r.verdicts.filter((v) => v.verdict && v.verdict.refuted).length, 0),
  critic: critique,
}
