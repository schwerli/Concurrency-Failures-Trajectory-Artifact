export const meta = {
  name: 'validators-value-param-discovery',
  description: 'Map every change needed to make Django built-in validators pass the provided value in ValidationError params',
  phases: [
    { title: 'Discover', detail: 'parallel readers: raise sites, contrib validators, % breakage risk, affected tests, docs' },
    { title: 'Critic', detail: 'completeness critic over the merged map' },
  ],
}

const SITES_SCHEMA = {
  type: 'object',
  properties: {
    sites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          context: { type: 'string', description: 'enclosing class/function' },
          currentCode: { type: 'string', description: 'the exact current raise statement, verbatim' },
          proposedParams: { type: 'string', description: 'exact params dict that should be passed, e.g. {\'value\': value}' },
          inScope: { type: 'boolean' },
          reasoning: { type: 'string' },
        },
        required: ['file', 'line', 'context', 'currentCode', 'proposedParams', 'inScope', 'reasoning'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['sites', 'notes'],
}

const RISK_SCHEMA = {
  type: 'object',
  properties: {
    risks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          description: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          evidence: { type: 'string', description: 'verbatim code/message showing the risk' },
        },
        required: ['file', 'line', 'description', 'severity', 'evidence'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['risks', 'summary'],
}

const REPO = '/testbed'
const TICKET = `Django ticket: "Make validators include the provided value in ValidationError".
Goal: every built-in validator in django/core/validators.py should pass params={'value': value} (merged with any
existing params) when raising ValidationError, so users overriding a validator's message can use a %(value)s
placeholder, e.g. '"blah" is not a valid email.'. This matches the documented custom-validator example in
docs/ref/validators.txt. Django 3.2 development tree at ${REPO}.`

phase('Discover')

const [coreSites, contribSites, percentRisk, testRisk, docsPlan, semanticsRisk] = await parallel([
  () => agent(`${TICKET}

Read ${REPO}/django/core/validators.py IN FULL. Enumerate EVERY \`raise ValidationError(...)\` statement in that
file (there are 20). For each, report the exact line number, enclosing class/function, the verbatim current raise
statement, and the exact params dict it should carry after the change.

Rules to apply:
- Validators that raise about the value being invalid must include 'value': value.
- Where params already exist (DecimalValidator max_digits/max_decimal_places/max_whole_digits, FileExtensionValidator),
  the existing keys must be PRESERVED and 'value': value added.
- BaseValidator already passes 'value': value - report it as already-done, inScope=false.
- Note anywhere the value in scope at the raise is NOT the value originally passed to the validator (e.g.
  URLValidator's IDN punycode retry path calling super().__call__(url)) and say exactly what the param would end up being.
- DecimalValidator's 'invalid' raise currently passes no code= at all - flag whether a code should be added for consistency.

Return every site, including ones you judge out of scope, with inScope set accordingly.`,
    { label: 'core-validators-sites', phase: 'Discover', schema: SITES_SCHEMA }),

  () => agent(`${TICKET}

Find validators OUTSIDE django/core/validators.py in this Django checkout that raise ValidationError and could
plausibly be in scope. Search at minimum:
- ${REPO}/django/contrib/postgres/validators.py
- ${REPO}/django/contrib/auth/validators.py
- ${REPO}/django/contrib/postgres/fields/ and forms/ (ArrayField, HStoreField, RangeField validators)
- ${REPO}/django/forms/fields.py  (to_python/validate raising ValidationError with params)
- ${REPO}/django/db/models/fields/__init__.py (to_python/validate)
- any other \`raise ValidationError\` under ${REPO}/django/ that belongs to a *validator* callable

For each, decide inScope: TRUE only for things that are genuinely "built-in validators" whose message a user would
override with a %(value)s placeholder. Field.to_python / Field.validate on form and model fields are NOT validators
in the validator-callable sense - report them but mark inScope=false and explain. Be precise about which ones
inherit from core validators and therefore get the fix for free (e.g. contrib.auth username validators subclass
RegexValidator; contrib.postgres Array*LengthValidator subclass Max/MinLengthValidator).`,
    { label: 'contrib-validators-sites', phase: 'Discover', schema: SITES_SCHEMA }),

  () => agent(`${TICKET}

CRITICAL REGRESSION HUNT. In Django, django.core.exceptions.ValidationError renders messages as
\`message % params\` ONLY when params is not None (read ${REPO}/django/core/exceptions.py to confirm the exact
condition in ValidationError.__init__ and .messages/.message property). Therefore adding params={'value': value}
to a raise that previously had NO params turns the message into a %-format string. Any message containing a
LITERAL percent sign that is not a valid mapping placeholder (e.g. "100%", "%s", "%d", a stray "%") will now
raise ValueError/TypeError/KeyError at render time instead of producing a message.

Hunt for this hazard across:
1. Default messages in ${REPO}/django/core/validators.py itself.
2. Translated messages: ${REPO}/django/conf/locale/*/LC_MESSAGES/django.po - grep the msgstr entries that
   translate the validator messages ("Enter a valid value.", "Enter a valid URL.", "Enter a valid email address.",
   "Enter a valid integer.", "Enter a valid IPv4 address.", "Enter a valid IPv6 address.",
   "Enter a valid IPv4 or IPv6 address.", "Enter only digits separated by commas.", the two slug messages,
   "Null characters are not allowed.", "Enter a number.") and report ANY translation containing a bare % that is
   not a %(name)s placeholder. Check a broad sample of locales, not just a couple.
3. Custom messages passed to RegexValidator/EmailValidator/URLValidator/ProhibitNullCharactersValidator anywhere
   under ${REPO}/django/ and ${REPO}/tests/ that contain a literal %.
4. Places that construct a validator with message=... from user-ish data.

Report each hazard with file, line, verbatim evidence, and severity. If you find NO hazards in a category, say so
explicitly in the summary. Use grep/rg aggressively; do not guess.`,
    { label: 'percent-format-risk', phase: 'Discover', schema: RISK_SCHEMA }),

  () => agent(`${TICKET}

Find EXISTING TESTS that could break once the built-in validators start passing params={'value': value}.
Search ${REPO}/tests/ for tests that:
- assert on ValidationError.params / .message / .code coming from core validators
- compare ValidationError instances or their repr/str (e.g. tests/test_exceptions/, tests/validators/)
- assert exact rendered error messages from EmailValidator/URLValidator/RegexValidator/ip validators/
  DecimalValidator/FileExtensionValidator/ProhibitNullCharactersValidator, including forms tests
  (tests/forms_tests/), model field tests (tests/model_fields/, tests/validation/), tests/postgres_tests/,
  tests/auth_tests/ (username validators), tests/i18n/
- rely on ValidationError being picklable/deepcopy-able or hashable with params
- use assertFieldOutput (read django/test/testcases.py or tests/forms_tests/tests/test_error_messages.py to see
  how it compares errors)

Also check whether ValidationError equality/hash (django/core/exceptions.py) uses params - if so, name tests that
compare validator-raised errors for equality.

For each candidate, state concretely whether it breaks and why, with the verbatim assertion. Prefer a short list of
REAL breakages over a long list of maybes, but do report medium-confidence ones with severity set accordingly.
Return them in the risks array.`,
    { label: 'existing-test-risk', phase: 'Discover', schema: RISK_SCHEMA }),

  () => agent(`${TICKET}

Plan the DOCUMENTATION change. Read ${REPO}/docs/ref/validators.txt in full and
${REPO}/docs/releases/3.2.txt (the in-development release notes - confirm the version from ${REPO}/django/__init__.py).

Answer concretely:
1. Which parts of docs/ref/validators.txt should mention that built-in validators pass the provided value as
   %(value)s in params? Quote the exact surrounding text and give the exact replacement/addition text in
   reStructuredText matching the file's existing style and directive conventions.
2. What release-note bullet should be added, and under exactly which heading in docs/releases/3.2.txt? Quote the
   heading and neighbouring bullets verbatim so the insertion point is unambiguous, and match their wording style.
3. Does the docs/ref/forms/validation.txt or docs/ref/models/fields.txt need a mention? Say yes/no with reasoning.

Return your answer in the 'notes' field as a complete, ready-to-apply plan with exact text blocks; put any file
locations you identified in 'sites' (currentCode = text to anchor on, proposedParams = text to insert).`,
    { label: 'docs-plan', phase: 'Discover', schema: SITES_SCHEMA }),

  () => agent(`${TICKET}

SEMANTIC RISK REVIEW - think about runtime consequences beyond formatting, and VERIFY each by reading code:
1. ValidationError instances are sometimes deep-copied, pickled, or stored (django/forms/utils.py ErrorList/ErrorDict,
   django/core/exceptions.py). params will now hold arbitrary user-supplied objects - is anything at risk?
   In particular FileExtensionValidator and validate_image_file_extension receive a FILE OBJECT (value.name is used).
   Putting a file object into params: does anything break (repr, pickling of ErrorList, message rendering, memory)?
   Check what upstream-style code would do and whether 'value': value is safe there.
2. DecimalValidator receives a Decimal; ProhibitNullCharactersValidator receives arbitrary objects. Any issue?
3. Does django/forms/fields.py or django/db/models/fields/__init__.py ever inspect e.params and assume specific keys
   (e.g. building error_messages)? Read Field.run_validators in both and report exactly what it does with params.
4. Is there any code that does \`params.update(...)\` or mutates a validator's params dict across calls (shared
   mutable default) that the change could introduce? Confirm each new params dict is constructed per-call.
5. django/contrib/postgres/utils.py prefix_validation_error - read it and report whether adding params to inner
   errors changes its behaviour (it merges params). Quote the function.

Report findings as risks with verbatim evidence. Be adversarial: your job is to find what breaks, not to bless the change.`,
    { label: 'semantic-risk', phase: 'Discover', schema: RISK_SCHEMA }),
])

phase('Critic')

const merged = JSON.stringify({ coreSites, contribSites, percentRisk, testRisk, docsPlan, semanticsRisk }, null, 1)

const critic = await agent(`${TICKET}

Six independent scouts produced the map below. Act as a COMPLETENESS CRITIC. Verify against the real repo at
${REPO} (read the files yourself - do not trust the scouts):

- Is every \`raise ValidationError\` in django/core/validators.py accounted for, with a correct in/out-of-scope call
  and correct params (existing params preserved)? Name any the scouts MISSED or got wrong, with line numbers.
- Are there validators elsewhere that should also change and were missed?
- Are any claimed risks actually false (refute them with evidence)? Are any real risks unclaimed?
- What is the single most likely way a careful implementation of this change still breaks the test suite?

Then output the FINAL AUTHORITATIVE CHANGE LIST as a numbered list: file, line, exact old code, exact new code -
for django/core/validators.py and any other source file that must change. Be exhaustive and exact; this list will
be applied verbatim. Follow the file's existing style (line length ~119 chars, single quotes).

SCOUT MAP:
${merged}`,
  { label: 'completeness-critic', phase: 'Critic', effort: 'high' })

return { coreSites, contribSites, percentRisk, testRisk, docsPlan, semanticsRisk, critic }
