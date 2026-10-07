export const meta = {
  name: 'saveasnew-perm-investigate',
  description: 'Investigate the show_save_as_new add-permission bug in django.contrib.admin',
  phases: [
    { title: 'Investigate', detail: 'parallel readers over templatetag, admin views, templates, tests, docs' },
    { title: 'Synthesize', detail: 'merge findings into an implementation plan' },
  ],
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What you found, concisely' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          lines: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['path', 'note'],
        additionalProperties: false,
      },
    },
    implications: { type: 'string', description: 'What this means for fixing show_save_as_new to require has_add_permission' },
  },
  required: ['summary', 'files', 'implications'],
  additionalProperties: false,
}

const DIMENSIONS = [
  {
    key: 'templatetag-tests',
    prompt: `In the Django repo at /testbed, find ALL existing tests that exercise \`submit_row\` in django/contrib/admin/templatetags/admin_modify.py, especially anything asserting on "show_save_as_new". Look in tests/admin_views/ (test_templatetags.py, tests.py), tests/admin_ordering/, and grep broadly for "show_save_as_new", "save_as_new", "_saveasnew", "save_as" across the tests/ directory. Report exact file paths, line numbers, test class/method names, and what each asserts. Also note the existing test helper patterns used (e.g. how they build a context for submit_row, RequestFactory usage, mock request user setup) so a new test can match house style. Read the actual test code, quote the relevant snippets.`,
  },
  {
    key: 'server-side-enforcement',
    prompt: `In the Django repo at /testbed, trace what happens SERVER-SIDE when a POST containing "_saveasnew" arrives at the admin change view. Read django/contrib/admin/options.py: find _changeform_view, the handling of "_saveasnew" in request.POST, response_add/response_change, and the permission checks (has_add_permission, has_change_permission, has_view_permission) applied along that path. Determine precisely: if a user has change permission but NOT add permission, and they POST with _saveasnew set, does Django currently create a new object? Is there a PermissionDenied raised anywhere? Quote the exact code with file:line. This determines whether the reported issue is a cosmetic UI bug or an actual privilege escalation.`,
  },
  {
    key: 'templates-and-context',
    prompt: `In the Django repo at /testbed, examine django/contrib/admin/templates/admin/submit_line.html and change_form.html. Show exactly how "show_save_as_new" is consumed and what the rendered button looks like (name attribute, value). Also find where the "has_add_permission" context variable is set for the change form (django/contrib/admin/options.py render_change_form / admin_modify context). Confirm has_add_permission is always present in the submit_row context for both add and change views, so that adding it to the show_save_as_new expression cannot raise KeyError. Quote code with file:line.`,
  },
  {
    key: 'history-and-docs',
    prompt: `In the Django repo at /testbed, investigate the history and documentation of "save_as" / "save as new". (1) Run git log -p --follow on django/contrib/admin/templatetags/admin_modify.py and grep the git history for "show_save_as_new" to find when the permission conditions were last changed and why (look for related ticket numbers in commit messages). (2) Read docs/ref/contrib/admin/index.txt for the ModelAdmin.save_as documentation. (3) Check docs/releases/ for any existing 4.2 or 5.0 release notes files and how backwards-incompatible admin changes are typically documented there. Report file paths and quote the relevant doc text.`,
  },
  {
    key: 'test-runner',
    prompt: `In the Django repo at /testbed, determine exactly how to run the admin test suite. Look at tests/runtests.py and tests/README.rst. Report the exact shell command to run (a) the whole admin_views test app and (b) a single test module like tests/admin_views/test_templatetags.py, including any required settings module / DJANGO_SETTINGS_MODULE or --settings flag, and what test settings file exists (e.g. tests/test_sqlite.py). Actually verify by listing the relevant files. Do NOT run the full suite; just report the command.`,
  },
]

phase('Investigate')
const results = await parallel(
  DIMENSIONS.map((d) => () =>
    agent(d.prompt, { label: d.key, phase: 'Investigate', schema: FINDING_SCHEMA })
  )
)

const good = results.filter(Boolean)
log(`Collected ${good.length}/${DIMENSIONS.length} investigation reports`)

phase('Synthesize')
const bundle = DIMENSIONS.map((d, i) => `### ${d.key}\n${JSON.stringify(results[i], null, 2)}`).join('\n\n')

const plan = await agent(
  `You are planning a fix in the Django repo at /testbed for this reported issue:

"show_save_as_new" in admin can add without this permission.
In django/contrib/admin/templatetags/admin_modify.py around line 102, the "show_save_as_new" context flag is computed as:
    "show_save_as_new": not is_popup and has_change_permission and change and save_as,
The reporter argues it must also require has_add_permission, because "save as new" performs an add.

Here are five independent investigation reports:

${bundle}

Produce a precise implementation plan:
1. The exact code edit (old lines -> new lines, with correct ordering matching the reporter's suggestion: not is_popup, has_add_permission, has_change_permission, change, save_as).
2. The exact test(s) to add: file path, test class to extend or create, full test method source that matches the house style found in the investigation. Be concrete — real code, not a sketch.
3. Whether any docs or release notes need changing, and if so exactly what.
4. Any risk of breaking existing tests, naming which ones.
5. The exact command to run the relevant tests.

Verify your claims against the actual files before asserting them — re-read anything you are unsure about. Return the plan as markdown.`,
  { label: 'synthesize-plan', phase: 'Synthesize', effort: 'high' }
)

return { plan, reports: results }
