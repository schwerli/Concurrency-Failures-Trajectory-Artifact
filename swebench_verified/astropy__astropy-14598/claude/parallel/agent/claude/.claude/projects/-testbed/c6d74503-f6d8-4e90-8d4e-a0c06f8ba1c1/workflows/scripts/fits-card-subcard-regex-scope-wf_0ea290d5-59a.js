export const meta = {
  name: 'fits-card-subcard-regex-scope',
  description: 'Decide and validate the safest treatment of the CONTINUE-subcard string-regex defect (escaped quote followed by space/slash)',
  phases: [
    { title: 'Characterize', detail: 'delimit the defect and the blast radius of each fix option' },
    { title: 'Try', detail: 'implement + validate 3 fix options in isolated sandboxes' },
    { title: 'Decide', detail: 'include or exclude, with evidence' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'

const BG = `
## Context

astropy repo at /testbed (pristine, do NOT modify anything there - read and run only).
Interpreter: ${PY}. Running it with cwd=<a source-tree copy> imports that copy's astropy.

We are fixing this reported bug: "Inconsistency in double single-quote ('') management in FITS Card" -
long (CONTINUE-rendered) string card values lose a quote on round trip:
  fits.Card('CONFIG', 'x'*65 + "''")  ->  str() -> Card.fromstring() gives back only one quote.

Two defects have already been diagnosed AND fixed; that fix is ALREADY APPLIED in your sandbox
(and only there):

  (A) astropy/io/fits/card.py, Card._split(), long-image branch: each CONTINUE subcard's value chunk
      was unescaped ('' -> ') and the unescaped concatenation was then re-wrapped in quotes and
      parsed AGAIN by _value_RE, which unescapes a second time. Fix: keep the chunks escaped, so the
      later single parse does the one and only unescape. The removed code was:
          value = value.rstrip().replace("''", "'")   ->   value = value.rstrip()

  (B) Card._format_long_image(): the ESCAPED value was chunked by _words_group() at a fixed width
      with no knowledge of quote pairing, so a '' pair could be split across two cards, producing
      images like "...x'&'" / "CONTINUE  '''''" that a strict FITS reader cannot parse. Fix: a new
      helper _split_value_words() in card.py that calls _words_group() per chunk and backs off one
      character when the chunk would end with an odd number of quotes.

With A+B applied: round trip is exact for every value tried (lengths 0..300, many quote patterns),
emitted images pass an independent strict FITS parser, the emitted images for quote-free values are
byte-identical to unpatched astropy, and "${PY} -m pytest astropy/io/fits -q" gives
"1 failed, 1285 passed, 27 skipped, 61 xfailed" - identical to unpatched /testbed (the single failure
is an unrelated pre-existing leap-second/network failure in test_fitstime.py).

## The remaining (third) defect you must rule on

Even with A+B, this still round-trips WRONG, on patched and unpatched astropy alike:

    v = "x"*60 + "' " + "y"*20          # a real quote followed by a space, in a LONG value
    c1 = fits.Card('CONFIG', v); c2 = fits.Card.fromstring(str(c1)); c2.value != c1.value

Cause: card.py line 67-69

    _strg = r"\\'(?P<strg>([ -~]+?|\\'\\'|) *?)\\'(?=\$|/| )"
    _comm_field = r"(?P<comm_field>(?P<sepr>/ *)(?P<comm>(.|\\n)*))"
    _strg_comment_RE = re.compile(f"({_strg})? *{_comm_field}?")

_strg's closing-quote rule is lenient: it accepts a closing quote followed by end-of-string, '/', or
a space. Inside a card the escaped pair '' followed by a space therefore looks like a closing quote,
so the chunk's value is truncated (and its trailing continuation '&' is lost).
_strg_comment_RE (used ONLY in Card._split()'s long-image branch, line ~857) is applied with
.match() and is NOT anchored, so the truncating alternative wins. By contrast _value_RE /
_value_NFSC_RE (lines ~101-125) embed the same _strg but ARE anchored with '\$', so backtracking
forces the correct (last valid) closing quote - which is why SHORT cards with "a' b" round-trip fine.

Known deeper, SEPARATE pre-existing bug, believed OUT OF SCOPE (verify): a real quote immediately
followed by '/' is misparsed even for SHORT cards on unpatched astropy -
fits.Card('K', "a'/b") round-trips to value "a'" with comment "b   '". Fixing that needs a strict
string-content class (e.g. r"\\'(?P<strg>(?:[^\\']|\\'\\')*)\\'") in _value_RE/_value_NFSC_RE, which
changes how astropy tolerates malformed cards found in the wild.

## Your sandbox

You own a private copy of the repo with A+B already applied. cd into it before running anything.
Scratch files go under <your sandbox>/_scratch/ and must be deleted before you finish; at the end
"git -C <sandbox> status --short" must show only your intended source/test changes.
Never write anything under /testbed.
`

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'diff', 'evidence', 'risks'],
  properties: {
    verdict: { type: 'string', enum: ['works-and-safe', 'works-but-risky', 'does-not-work'] },
    diff: { type: 'string', description: 'git diff of the source change you made on top of A+B' },
    evidence: { type: 'string', description: 'actual command output: suite summary line, fuzz results, malformed-card behaviour comparison' },
    risks: { type: 'array', items: { type: 'string' } },
    behaviour_changes: { type: 'array', items: { type: 'string' }, description: 'concrete inputs whose parsed value/comment changes vs unpatched astropy, beyond the bug being fixed' },
  },
}

phase('Characterize')

const charAgent = agent(`${BG}

TASK (analysis, in your sandbox /tmp/sbx/r1 - you may run code, but do not change source yet;
revert any source edit you make while exploring):

Delimit the third defect exactly and map the blast radius of fixing it.

1. Find the full set of inputs mis-parsed because of the unanchored _strg_comment_RE. Sweep long
   values containing a real quote followed by each printable ASCII character, at many positions and
   lengths; classify which characters trigger truncation and why (space, '/', end-of-chunk...).
   Report which of these ALSO fail for short (single-card) values on unpatched astropy - those belong
   to the separate, out-of-scope _value_RE bug.
2. Determine what happens to MALFORMED long cards if _strg_comment_RE is anchored with '$':
   can the regex fail to match at all (m is None)? Read Card._split() around line 857: the
   "if not m: return kw, vc" path returns only the FIRST subcard's field and discards the rest.
   Construct concrete malformed multi-card images (unclosed quote in a CONTINUE card, junk after the
   closing quote, a CONTINUE card with a non-string value, a comment without '/', 80-char cards with
   trailing garbage) and record, for each, the parsed keyword/value/comment on (i) unpatched
   /testbed, (ii) sandbox with A+B, (iii) sandbox with A+B plus the '$' anchor. Show the actual
   values. Which changes are improvements, which are regressions?
3. Search the test suite and the repo for anything that depends on the lenient/unanchored behaviour
   of _strg_comment_RE for malformed long cards (grep tests, also read test_header.py's
   test_long_string_value_via_fromstring which intentionally parses sloppy CONTINUE cards).
4. Give your recommendation on whether the third defect should be fixed in the same patch as A+B,
   and if so by which mechanism (anchor with '$'; strict content class only for subcards; strict with
   fallback to lenient when strict does not match; something else).

Return your findings in "evidence" with real output; set verdict to reflect your recommendation about
the ANCHOR option specifically.`,
  { label: 'characterize', phase: 'Characterize', schema: RESULT_SCHEMA, effort: 'high' })

const characterization = await charAgent

phase('Try')

const OPTIONS = [
  {
    key: 'anchor',
    dir: '/tmp/sbx/r1',
    task: `OPTION 1 - ANCHOR. Change only:
    _strg_comment_RE = re.compile(f"({_strg})? *{_comm_field}?")
to
    _strg_comment_RE = re.compile(f"({_strg})? *{_comm_field}?$")
(plus a brief comment explaining why anchoring matters, matching the file's comment style).
This makes subcard parsing consistent with the anchored _value_RE. Validate it thoroughly and
characterize exactly which malformed-card inputs now take the "if not m: return kw, vc" path in
Card._split() and what that does to them.`,
  },
  {
    key: 'strict-subcard',
    dir: '/tmp/sbx/r2',
    task: `OPTION 2 - STRICT SUBCARD PATTERN. Leave _strg (used by _value_RE / _value_NFSC_RE)
untouched, and give the CONTINUE-subcard parse its own strict string pattern in which the value ends
at the first quote that is not part of a doubled pair, e.g.
    _strg_strict = r"\\'(?P<strg>(?:[ -&(-~]|\\'\\')*)\\'"
used to build a separate compiled regex for _split()'s long-image branch. Decide whether the comment
field must still be optional and whether to anchor. Keep it minimal and idiomatic. Validate
thoroughly, including behaviour on malformed subcards versus unpatched astropy.`,
  },
  {
    key: 'strict-fallback',
    dir: '/tmp/sbx/r3',
    task: `OPTION 3 - STRICT WITH LENIENT FALLBACK. Like option 2, but preserve astropy's tolerance
for malformed cards exactly: in _split()'s long-image branch first try the strict pattern, and only
if it does not match fall back to the existing lenient _strg_comment_RE, so no currently-parsed
malformed card changes meaning. Validate thoroughly, and be honest about whether the extra code is
justified: report whether option 1 or 2 would already have left malformed-card behaviour unchanged
in practice (with evidence).`,
  },
]

const tried = await parallel(OPTIONS.map((o) => () => agent(`${BG}

## Characterization phase findings (verify, do not blindly trust)

verdict: ${characterization?.verdict}
evidence: ${characterization?.evidence}
risks: ${JSON.stringify(characterization?.risks || [])}
behaviour changes: ${JSON.stringify(characterization?.behaviour_changes || [])}

## Your sandbox: ${o.dir} (A+B already applied)

${o.task}

## Validation you must run and report verbatim in "evidence"

1. cd ${o.dir} && ${PY} -m pytest astropy/io/fits -q --no-header -p no:cacheprovider  (tail the
   summary line; unpatched baseline is "1 failed, 1285 passed, 27 skipped, 61 xfailed" where the one
   failure is the unrelated leap-second test).
2. Round-trip sweep: for lengths 0..300 and a large set of quote/space/&//-containing values, with
   and without comments (short and long comments, comments containing quotes), check
   Card.fromstring(str(c)).value == c.value, comment preserved, and str() idempotence. Report the
   number of remaining failures and, for each remaining failure class, whether it also fails on
   unpatched /testbed (i.e. pre-existing) and whether it is the known out-of-scope "quote immediately
   followed by /" bug that also affects short cards.
3. Strict-parser cross-check: write your own independent strict FITS parser (string ends at the first
   quote not followed by a quote; '' is a literal quote; CONTINUE convention via a trailing & inside
   the string) and confirm it recovers card.value from every image your patched astropy emits.
4. Image stability: emitted images for quote-free long values must stay byte-identical to unpatched
   /testbed output.
5. Malformed-card comparison table: for at least 8 malformed/sloppy multi-card images (including
   test_header.py's test_long_string_value_via_fromstring input), print keyword/value/comment as
   parsed by unpatched /testbed vs your sandbox. List every difference in behaviour_changes.

Set verdict honestly: "works-and-safe" only if the defect is fixed, the suite matches baseline, and
you found no malformed-card behaviour change (or only ones that are clear improvements).`,
  { label: `try:${o.key}`, phase: 'Try', schema: RESULT_SCHEMA, effort: 'high' })))

phase('Decide')

const DECIDE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['include_third_fix', 'chosen_option', 'final_source_change', 'rationale'],
  properties: {
    include_third_fix: { type: 'boolean' },
    chosen_option: { type: 'string' },
    final_source_change: { type: 'string', description: 'exact old text -> new text for /testbed/astropy/io/fits/card.py' },
    tests_to_add: { type: 'string', description: 'verbatim pytest code covering the third defect, astropy style' },
    rationale: { type: 'string' },
    residual_out_of_scope: { type: 'array', items: { type: 'string' } },
  },
}

const decision = await agent(`${BG}

## Characterization
${characterization?.evidence}
risks: ${JSON.stringify(characterization?.risks || [])}

## Option results
${OPTIONS.map((o, i) => {
  const t = tried[i]
  return `### Option ${o.key} (sandbox ${o.dir})
verdict: ${t?.verdict}
diff:
${t?.diff}
evidence:
${t?.evidence}
risks: ${JSON.stringify(t?.risks || [])}
behaviour changes: ${JSON.stringify(t?.behaviour_changes || [])}`
}).join('\n\n')}

You decide. The patch that ships must fix the reported bug (A+B, already settled) and must not
regress anything. The question is ONLY whether to also include a fix for the third defect
(long values where a real quote is followed by a space), and if so, which mechanism.

Weigh: it is a real data-corruption bug in the same '' -management family and users hit it silently;
against: it changes a parsing regex that also governs sloppy real-world cards, and the reported issue
does not mention it. Prefer the option with the best correctness-per-risk. If two options are
equally correct, prefer the smaller, more idiomatic one.

Before answering, independently verify the chosen option in its sandbox: run the io.fits suite and a
round-trip sweep yourself and quote the real output in rationale. Also state what the chosen option
does NOT fix (e.g. the quote-immediately-followed-by-slash bug that also affects short cards).
Never modify /testbed.`,
  { label: 'decide', phase: 'Decide', schema: DECIDE_SCHEMA, effort: 'max' })

return { characterization, tried: tried.map((t, i) => ({ option: OPTIONS[i].key, verdict: t?.verdict, behaviour_changes: t?.behaviour_changes })), decision }
