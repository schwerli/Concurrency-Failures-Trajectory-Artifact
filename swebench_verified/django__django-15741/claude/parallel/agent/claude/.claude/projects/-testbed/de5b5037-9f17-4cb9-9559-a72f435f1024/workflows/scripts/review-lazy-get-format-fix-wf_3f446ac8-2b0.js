export const meta = {
  name: 'review-lazy-get-format-fix',
  description: 'Adversarially review the one-line get_format() lazy fix and its tests for correctness, regressions, and hidden failure modes',
  phases: [
    { title: 'Attack' },
    { title: 'Verify' },
  ],
}

const DIFF = `diff --git a/django/utils/formats.py b/django/utils/formats.py
@@ -113,6 +113,7 @@ def get_format(format_type, lang=None, use_l10n=None):
             use_l10n = settings.USE_L10N
     if use_l10n and lang is None:
         lang = get_language()
+    format_type = str(format_type)  # format_type may be lazy.
     cache_key = (format_type, lang)
     try:
         return _format_cache[cache_key]

Plus new tests: tests/i18n/tests.py FormattingTests.test_get_format_lazy_format;
tests/template_tests/filter_tests/test_date.py DateTests.test_date10 / test_date11;
tests/template_tests/filter_tests/test_time.py TimeTests.test_time07.
The change is already applied in the /testbed working tree — use \`cd /testbed && git diff\` to see it exactly.`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          failure_scenario: { type: 'string', description: 'Concrete inputs/state -> wrong output/crash. Must be executed, not imagined.' },
          evidence: { type: 'string', description: 'Actual command run and actual output observed' },
        },
        required: ['title', 'file', 'severity', 'failure_scenario', 'evidence'],
      },
    },
  },
  required: ['findings'],
}

const LENSES = [
  { key: 'regression', prompt: `You are trying to BREAK a Django patch. Repo /testbed, interpreter /opt/miniconda3/envs/testbed/bin/python, tests run via \`cd /testbed/tests && /opt/miniconda3/envs/testbed/bin/python runtests.py <labels> --parallel 1\`.

The patch:
${DIFF}

LENS: REGRESSION. Hunt for existing behavior that this str() coercion changes for the worse. Specifically probe, BY EXECUTION:
- Callers that pass non-str format_type today and rely on the old behavior: ints, None, bytes, enums, SafeString, str subclasses, objects with __str__. grep the whole /testbed/django tree for get_format( / get_format_lazy( / date_format( / time_format( call sites and check each one's argument type.
- Return-value types must be unchanged: FIRST_DAY_OF_WEEK (int), NUMBER_GROUPING (int or list), DATE_INPUT_FORMATS (list). Confirm the patch does not stringify returns.
- The unknown-format pass-through \`if format_type not in FORMAT_SETTINGS: return format_type\`: it now returns str(arg) rather than arg. Find any caller that depends on getting the identical object back (identity, subclass, SafeString-ness, lazy-ness). Check django/views/i18n.py JavaScriptCatalog, django/forms/**, django/contrib/admin/**, django/utils/dateformat.py.
- Performance on the hot path: measure the added cost per call with timeit and say whether it matters (get_format is called per rendered value).
- Run a genuinely broad test sweep beyond what I already ran (i18n template_tests utils_tests forms_tests view_tests humanize_tests admin_widgets model_forms all passed except the pre-existing root-only template_tests.test_loaders.FileSystemLoaderTests.test_permissions_error). Try: admin_views, admin_inlines, generic_views, timezones, datetimes, model_fields, validation, flatpages_tests, syndication_tests, sitemaps_tests, contenttypes_tests, humanize_tests, forms_tests.
Report ONLY findings you reproduced by running code. Empty findings array is a perfectly good answer. Do not edit /testbed (scratch files in /tmp are fine; if you must experiment on source, copy the tree).` },

  { key: 'incompleteness', prompt: `You are trying to BREAK a Django patch. Repo /testbed, interpreter /opt/miniconda3/envs/testbed/bin/python.

The patch:
${DIFF}

LENS: INCOMPLETENESS — does the patch actually fix the reported bug in ALL its forms? The report says: "the date template filter (possibly others are affected too) receives a lazy string, like in some_date|date:_('Y-m-d'). This fails with TypeError: getattr(): attribute name must be string in django.utils.formats.get_format."

Probe BY EXECUTION whether these still misbehave AFTER the patch (the tree already has it applied):
- \`{{ d|date:_("...") }}\`, \`{{ d|time:_("...") }}\`, \`{{ d|naturalday:_("...") }}\` (humanize), \`{{ d|naturaltime }}\`, \`{% now _("...") %}\`, SHORT_DATE_FORMAT/SHORT_DATETIME_FORMAT/YEAR_MONTH_FORMAT/MONTH_DAY_FORMAT names, and lazy formats produced by pgettext_lazy / ngettext_lazy / format_lazy / lazystr / reverse_lazy-like proxies.
- Lazy passed to formats.date_format / time_format / number_format / localize / localize_input / get_format_lazy.
- Lazy in a template *context variable* used as the filter arg ({{ d|date:fmt }} with fmt=gettext_lazy(...)), not just the _() literal form.
- USE_L10N on and off, USE_I18N off, an active language with no format module (e.g. an unusual locale), and FORMAT_MODULE_PATH pointing at a custom module.
- A lazy that actually TRANSLATES to a different format per language (not just an untranslated msgid) — e.g. register a fake translation so _("Y-m-d") resolves differently in 'de'. Does the caching then serve the right value per language? This is the subtle one: format_type is str()-ed AFTER lang is computed, so the cache key uses the resolution active at call time. Verify correctness across language switches, including with use_l10n=False (lang is None).
For each thing that still fails, state clearly whether it flows through get_format at all (in scope) or is a separate pre-existing bug (out of scope). Report only executed evidence. Do not edit /testbed.` },

  { key: 'tests', prompt: `You are reviewing the TESTS of a Django patch. Repo /testbed, interpreter /opt/miniconda3/envs/testbed/bin/python, run via \`cd /testbed/tests && /opt/miniconda3/envs/testbed/bin/python runtests.py <labels> --parallel 1\`.

The patch:
${DIFF}

LENS: TEST QUALITY. Read the four new tests in the working tree (\`cd /testbed && git diff\`). Attack them:
- Do they actually FAIL without the source fix? Verify by copying /testbed to /tmp, reverting only the one source line there, and running them. Report the exact pre-fix failure signature of each.
- Are any of them tautological, order-dependent, or accidentally passing? Critically: the module-global _format_cache is shared across the whole test process, and a lazy proxy hashes equal to its resolved str — so a test can pass on BROKEN code if some earlier test warmed (format_type, lang). Verify by running each new test (a) alone, (b) after the full i18n suite, (c) after the full template_tests suite, (d) with --reverse, (e) with --parallel 4 — on a tree with the fix REVERTED. Any new test that passes on the reverted tree in any of those orders is defective and I need to know.
- template_tests' @setup reruns each body six times (cached/uncached x debug x string_if_invalid="INVALID"). Confirm the new template tests are idempotent and correct under all six, especially string_if_invalid="INVALID".
- Are the asserted literals right for the test runner's settings (LANGUAGE_CODE, USE_L10N, USE_TZ, TIME_ZONE in tests/runtests.py and the shared test settings)? Would they break under a different TZ or if run with --settings on another DB backend?
- Naming/convention fit: do date10/date11/time07 collide with anything, and do they match neighboring style?
- Is coverage missing for a failure mode the patch fixes? Notably the second getattr (getattr(settings, format_type), reached with use_l10n=False) and the pass-through branch returning a real str. Propose specific extra assertions ONLY if genuinely valuable.
Report only executed evidence. Do not edit /testbed; do your reverted-tree experiments in /tmp.` },
]

phase('Attack')
const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `attack:${l.key}`, phase: 'Attack', schema: FINDINGS_SCHEMA }),
  (r, l) => {
    const fs = (r && r.findings) || []
    if (!fs.length) return []
    return parallel(fs.map(f => () =>
      agent(`You are an adversarial VERIFIER on Django repo /testbed (interpreter /opt/miniconda3/envs/testbed/bin/python). Another reviewer claims this finding about an applied patch. Your DEFAULT is that the claim is WRONG — refute it unless you can reproduce it yourself by running code.

Patch under review:
${DIFF}

CLAIM
title: ${f.title}
file: ${f.file}${f.line ? ':' + f.line : ''}
severity: ${f.severity}
failure_scenario: ${f.failure_scenario}
evidence offered: ${f.evidence}

Reproduce it independently from scratch. Then judge:
- Is it REAL (reproducible, caused by THIS patch, not pre-existing on an unpatched tree)? Check the unpatched baseline by copying /testbed to /tmp and reverting the one source line — if the same behavior exists at baseline, it is PRE-EXISTING, not a regression from this patch.
- Is it IN SCOPE for the ticket "get_format should allow lazy parameter"?
- Does it actually matter (real caller, real user impact) or is it theoretical?
If uncertain, set real=false. Do not edit /testbed.`,
      { label: `verify:${f.title.slice(0, 40)}`, phase: 'Verify', schema: {
        type: 'object',
        properties: {
          real: { type: 'boolean' },
          preexisting: { type: 'boolean' },
          in_scope: { type: 'boolean' },
          matters: { type: 'boolean' },
          reasoning: { type: 'string' },
          recommended_action: { type: 'string' },
        },
        required: ['real', 'preexisting', 'in_scope', 'matters', 'reasoning', 'recommended_action'],
      } }
    ).then(v => ({ lens: l.key, finding: f, verdict: v }))))
  }
)

const all = results.flat().filter(Boolean)
const survivors = all.filter(x => x.verdict && x.verdict.real && x.verdict.matters && !x.verdict.preexisting)
log(`${all.length} findings raised, ${survivors.length} survived verification`)
return { survivors, all }
