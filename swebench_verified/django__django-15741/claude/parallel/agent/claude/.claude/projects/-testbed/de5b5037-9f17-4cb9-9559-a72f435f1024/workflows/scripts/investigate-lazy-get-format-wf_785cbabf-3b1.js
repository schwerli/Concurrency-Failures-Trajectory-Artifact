export const meta = {
  name: 'investigate-lazy-get-format',
  description: 'Investigate the lazy format_type regression in django.utils.formats.get_format and map all affected call paths, caching implications, and test locations',
  phases: [
    { title: 'Investigate' },
    { title: 'Synthesize' },
  ],
}

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Concise findings' },
    key_files: { type: 'array', items: { type: 'string' }, description: 'file:line references that matter' },
    risks: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'key_files', 'risks', 'recommendations'],
}

const DIMENSIONS = [
  {
    key: 'callpaths',
    prompt: `Repo: /testbed (Django 4.2 dev checkout). Bug: django.utils.formats.get_format() crashes with "TypeError: getattr(): attribute name must be string" when format_type is a lazy string (e.g. \`some_date|date:_('Y-m-d')\` where _ is gettext_lazy). Regression from commit 659d2421c7adb (ticket #20296).

Your job: map EVERY call path in the Django source tree (/testbed/django) through which a *lazy* (django.utils.functional.lazy / gettext_lazy) value could reach get_format()'s format_type parameter. Read django/utils/formats.py, django/template/defaultfilters.py (date, time filters), django/utils/dateformat.py, django/template/defaulttags.py (now tag), django/forms/**, django/contrib/admin/**, django/utils/timesince.py, etc.

Also identify secondary functions that would then receive a lazy value downstream even if get_format is fixed: e.g. dateformat.format(value, format_string), dateformat.time_format, sanitize_strftime_format (note: it is @functools.lru_cache'd — what happens if a lazy str is passed as the key?), localize_input's default parameter, number_format.

Report file:line references and concrete failure modes. Do NOT edit any files.`,
  },
  {
    key: 'semantics',
    prompt: `Repo: /testbed (Django 4.2 dev). Read django/utils/formats.py carefully, especially get_format().

Analyze what breaks and what subtly misbehaves when \`format_type\` is a lazy string proxy (django.utils.functional.lazy(..., str) / gettext_lazy):
1. \`cache_key = (format_type, lang)\` then \`_format_cache[cache_key]\` — is a lazy proxy hashable? Does it hash/compare equal to the resolved str? Read django/utils/functional.py (__proxy__, __hash__, __eq__, lazy(), lazystr) to be sure. What is the cache-pollution / cache-miss consequence? Consider that a lazy translation resolves differently per active language while the cache key would be identical/different.
2. \`getattr(module, format_type, None)\` — the actual TypeError.
3. \`format_type not in FORMAT_SETTINGS\` (a frozenset of str) — does a lazy proxy match?
4. \`getattr(settings, format_type)\`.
5. \`elif format_type in ISO_INPUT_FORMATS\` (a dict).
6. get_format_lazy = lazy(get_format, str, list, tuple) — how does it interact?

Then examine git history: run \`cd /testbed && git log --oneline -20 -- django/utils/formats.py\` and \`git show 659d2421c7adb --stat\` if that commit exists (it may not be in this shallow checkout). Explain precisely why the regression happened (what did the pre-#20296 code do that tolerated lazy input?).

Empirically verify your claims by running python: use /opt/miniconda3/envs/testbed/bin/python with PYTHONPATH=/testbed and a settings.configure() snippet. Report actual observed behavior, not speculation. Do NOT edit files in /testbed (you may write scratch scripts to /tmp).`,
  },
  {
    key: 'tests',
    prompt: `Repo: /testbed (Django 4.2 dev). Task: find where a fix for "get_format() should accept a lazy format_type" should be tested.

Search /testbed/tests for existing coverage of: get_format, get_format_lazy, the \`date\`/\`time\` template filters with a variable/lazy format, i18n format tests, localize/localize_input, sanitize_strftime_format. Look at tests/i18n/tests.py (FormattingTests), tests/utils_tests/test_dateformat.py, tests/template_tests/filter_tests/test_date.py and test_time.py, tests/i18n/test_extraction.py.

Report: exact test file paths + class names + line numbers where new tests belong, the established style/conventions in those tests (e.g. use of @translation.override, self.settings(), translation.activate), and how to run them (the runtests.py invocation for those labels). Also note any existing test that would catch a regression if get_format started str()-ing its argument.

Do NOT edit files.`,
  },
  {
    key: 'upstream',
    prompt: `Repo: /testbed (Django 4.2 dev checkout of the Django framework). The task is to fix: "django.utils.formats.get_format should allow lazy parameter" — TypeError: getattr(): attribute name must be string, triggered by \`some_date|date:_('Y-m-d')\`.

Determine the minimal, idiomatic fix consistent with Django's own coding style. Consider and compare these candidate designs, listing pros/cons of each:
  (a) \`format_type = str(format_type)\` near the top of get_format() (before cache_key is built), with a comment like "# format_type may be lazy."
  (b) Coercing only at the getattr call sites.
  (c) Fixing it in the template filters (django/template/defaultfilters.py date/time) instead.
  (d) Using force_str / str() in dateformat.

Which is the smallest change that fixes all call paths and keeps the format cache correct? Where exactly (file:line) should it go? Check django's own conventions: grep /testdb.. sorry, grep /testbed/django for existing "may be lazy" comments and for str()/force_str coercion patterns on lazy input.

Also check the release notes structure: is there a docs/releases/4.1.txt with a Bugfixes section? Should a docs change accompany this (docs/ref/utils.txt or docs/topics/i18n/formatting.txt)? Report what an upstream-quality patch would include.

Do NOT edit files.`,
  },
]

phase('Investigate')
const results = await parallel(DIMENSIONS.map(d => () =>
  agent(d.prompt, { label: `probe:${d.key}`, phase: 'Investigate', schema: SCHEMA })
    .then(r => ({ key: d.key, ...r }))
))

const good = results.filter(Boolean)

phase('Synthesize')
const synthesis = await agent(
  `You are synthesizing a fix plan for a Django bug in /testbed.

Bug: django.utils.formats.get_format() raises "TypeError: getattr(): attribute name must be string" when format_type is a lazy string, e.g. the template \`{{ some_date|date:_("Y-m-d") }}\`.

Four independent investigators reported the following JSON findings:

${JSON.stringify(good, null, 2)}

Cross-check the claims against the actual source in /testbed/django/utils/formats.py (read it yourself; run python with /opt/miniconda3/envs/testbed/bin/python and PYTHONPATH=/testbed to verify anything doubtful). Discard any claim you cannot confirm and say which you discarded.

Produce the definitive plan: the exact code change (with the precise before/after snippet and file:line), the exact test(s) to add (file, class, method body, matching the surrounding conventions), and anything else an upstream-quality patch needs. Keep the change minimal. Do NOT edit files — just report the plan.`,
  { label: 'synthesize', phase: 'Synthesize', schema: {
    type: 'object',
    properties: {
      plan: { type: 'string' },
      code_change: { type: 'string' },
      tests: { type: 'string' },
      discarded_claims: { type: 'array', items: { type: 'string' } },
      open_questions: { type: 'array', items: { type: 'string' } },
    },
    required: ['plan', 'code_change', 'tests', 'discarded_claims', 'open_questions'],
  } }
)

return { probes: good, synthesis }
