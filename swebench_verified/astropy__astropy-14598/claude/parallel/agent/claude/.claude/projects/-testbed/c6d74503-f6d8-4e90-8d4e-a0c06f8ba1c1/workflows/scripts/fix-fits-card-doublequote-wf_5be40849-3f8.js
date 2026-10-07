export const meta = {
  name: 'fix-fits-card-doublequote',
  description: 'Diagnose and fix astropy FITS Card double-single-quote corruption in long (CONTINUE) string values',
  phases: [
    { title: 'Diagnose', detail: 'trace round-trip, audit _split consumers, inventory pinned tests' },
    { title: 'Implement', detail: '3 independent fix strategies in isolated sandboxes, each self-validated' },
    { title: 'Break', detail: 'adversarial breakers per candidate: strict-parser, fuzzer, regression lenses' },
    { title: 'Judge', detail: 'score candidates, synthesize the final patch + regression tests' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'

const BACKGROUND = `
## Context

Repo: astropy at /testbed (git clean, branch main). Python interpreter: ${PY}
(python3.9, astropy installed editable; running from a source-tree copy imports that copy's astropy).

## The bug (astropy issue: "Inconsistency in double single-quote ('') management in FITS Card")

    from astropy.io import fits
    for n in range(60, 70):
        card1 = fits.Card('CONFIG', "x" * n + "''")
        card2 = fits.Card.fromstring(str(card1))
        print(n, card1.value == card2.value)

n=65,67,68,69 -> False: the trailing two single-quotes come back as one. A '' embedded in a
longer value fails at other lengths. Only long values (those rendered with CONTINUE cards) fail.

## Relevant code (astropy/io/fits/card.py)

- Generation: Card._format_image() -> Card._format_long_image() (~line 1044). It escapes the value
  once (value = self._value.replace("'", "''")), then splits the ESCAPED text into chunks of at most
  value_length=67 with _words_group() (astropy/io/fits/util.py:738), and emits
  "KEYWORD  = '<chunk>&'" / "CONTINUE  '<chunk>&'" cards, dropping the trailing '&' on the last chunk
  when there is no comment.
- Parsing: Card._split() (~line 829). For images longer than 80 chars it iterates subcards
  (_itersubcards), matches each with _strg_comment_RE (line 67:
  _strg = r"\\'(?P<strg>([ -~]+?|\\'\\'|) *?)\\'(?=\$|/| )"), then does
      value = m.group("strg") or ""
      value = value.rstrip().replace("''", "'")
      if value and value[-1] == "&": value = value[:-1]
  and finally re-wraps the concatenation: valuecomment = f"'{''.join(values)}' / {' '.join(comments)}"
  which is then parsed again by _parse_value / _value_RE, which unescapes '' -> ' a SECOND time.

## Two defects identified by preliminary scouting (verify independently; do not take on faith)

(A) Double-unescaping on the parse side: _split() unescapes each subcard chunk, then re-wraps the
    already-unescaped concatenation in quotes, and the subsequent _value_RE parse unescapes again.
    Any real quote inside a long value is therefore lost.
(B) Chunking on the generation side can split an escaped '' pair across two cards, because
    _words_group() cuts the ESCAPED string at a fixed width with no knowledge of quote pairing.
    A chunk may then end with an unpaired quote (image "...x'&'") or start with a leftover quote
    (image "CONTINUE  '''''"). astropy's own regex tolerates this only because its closing-quote
    lookahead requires end-of-field, '/', or space; a standard-conforming FITS reader (cfitsio et al.)
    ends a string value at the first quote not followed by another quote, so such cards are
    NOT interoperable and can be misparsed by other tools.

Note the interaction: fixing (B) alone does not fix the reported round-trip failure (a pair fully
contained in one chunk is still double-unescaped); fixing (A) alone makes astropy round-trip its own
output but can still emit cards that violate the FITS string/CONTINUE convention.

## Non-negotiable constraints for any fix

1. card.value must survive str(card) -> Card.fromstring() exactly, for arbitrary printable-ASCII
   values of any length, with and without comments.
2. Emitted card images must stay 80-column multiples and remain parseable by a STRICT FITS parser
   (string ends at the first ' not followed by '; the CONTINUE convention: value chunk ends with &
   inside the quotes).
3. Do not gratuitously change the emitted image for values that contain no quotes: existing tests in
   astropy/io/fits/tests/test_header.py pin exact card images (test_long_string_value,
   test_word_in_long_string_too_long, test_long_string_value_with_multiple_long_words,
   test_final_continue_card_lacks_ampersand, test_long_string_value_via_fromstring, ...).
   The word-splitting-at-blanks behaviour of _words_group must be preserved.
4. Keep the change minimal and idiomatic to the surrounding code style.
`

const DIAG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['location', 'claim', 'evidence'],
        properties: {
          location: { type: 'string', description: 'file:line' },
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'concrete trace / command output proving it' },
          severity: { type: 'string' },
        },
      },
    },
    invariants: { type: 'array', items: { type: 'string' } },
    must_not_break: { type: 'array', items: { type: 'string' } },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy', 'diff', 'brute_force', 'test_suite', 'self_critique'],
  properties: {
    strategy: { type: 'string' },
    diff: { type: 'string', description: 'unified diff of the source fix only (no test files)' },
    tests_added: { type: 'string', description: 'verbatim pytest code added for regression coverage' },
    brute_force: {
      type: 'object',
      additionalProperties: false,
      required: ['cases_run', 'failures'],
      properties: {
        cases_run: { type: 'integer' },
        description: { type: 'string' },
        failures: { type: 'array', items: { type: 'string' } },
      },
    },
    strict_parser_check: { type: 'string', description: 'result of checking emitted images against an independently written strict FITS string/CONTINUE parser' },
    image_stability_check: { type: 'string', description: 'result of comparing emitted images before vs after the fix for a corpus of long values without quotes' },
    test_suite: {
      type: 'object',
      additionalProperties: false,
      required: ['command', 'summary_line', 'failures'],
      properties: {
        command: { type: 'string' },
        summary_line: { type: 'string' },
        failures: { type: 'array', items: { type: 'string' } },
      },
    },
    self_critique: { type: 'string', description: 'honest weaknesses / cases you could not make work' },
  },
}

const BREAK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['broken', 'assessment'],
  properties: {
    broken: { type: 'boolean', description: 'true if you found a real defect in this candidate' },
    counterexamples: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['repro', 'expected', 'actual'],
        properties: {
          repro: { type: 'string', description: 'minimal runnable python snippet' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          preexisting: { type: 'boolean', description: 'true if unpatched astropy fails the same way (i.e. not a regression introduced by this candidate)' },
        },
      },
    },
    assessment: { type: 'string' },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ranking', 'recommended_patch', 'recommended_tests', 'rationale'],
  properties: {
    ranking: { type: 'array', items: { type: 'string' } },
    recommended_patch: { type: 'string', description: 'the exact final source change: full replacement text of each changed function/hunk, with file:line anchors' },
    recommended_tests: { type: 'string', description: 'verbatim pytest code to add, astropy style' },
    rationale: { type: 'string' },
    residual_risks: { type: 'array', items: { type: 'string' } },
    out_of_scope_bugs: { type: 'array', items: { type: 'string' } },
  },
}

// ---------------------------------------------------------------- Phase 1
phase('Diagnose')

const diagTasks = [
  {
    label: 'diag:dataflow',
    prompt: `${BACKGROUND}

TASK (read-only; do not modify any file under /testbed): Trace the exact character-level data flow
of the failing round trip and confirm or refute defects (A) and (B).

Do this empirically, not by reading alone. Write throwaway scripts under /tmp/scratch-dataflow/ and
run them with ${PY} from /testbed. For n in 63..69 with value "x"*n + "''", and for the second
reported shape "x"*n + "''" + "x"*10, print: the escaped value, the chunk list returned by
_words_group, every emitted 80-char card image (repr), the per-subcard m.group('strg'), the
value list _split() builds, the re-wrapped valuecomment, and the final parsed card2.value.

Then answer precisely:
1. Is the double-unescape in _split() real? At which exact line does the second unescape happen?
2. Can _words_group() split an escaped '' pair? Show a concrete n where it does, and the resulting
   card image.
3. For each of the two defects, does fixing it alone fully fix the reported round trip? Show why.
4. Is the concatenation of the raw (still escaped) chunks always exactly equal to the original
   escaped value? Consider the per-chunk .rstrip() and the trailing '&' stripping - can either
   destroy data (e.g. a value with a space or an & at a chunk boundary)? Show concrete examples,
   and state clearly whether such cases already fail on unpatched astropy.

Return findings with concrete evidence (actual printed output, not paraphrase).`,
  },
  {
    label: 'diag:consumers',
    prompt: `${BACKGROUND}

TASK (read-only): Audit every consumer of Card._split() and decide what invariant its return value
must satisfy for CONTINUE (long-image) cards, so we can tell whether it is safe for _split() to
return the value chunk still ESCAPED (i.e. with '' for a literal quote) instead of unescaped.

Search the whole repo (astropy/io/fits/*.py and anywhere else) for calls to _split(), and read every
caller in full: _parse_keyword, _parse_value, _parse_comment, _parse_field_specifier, _fix_value,
_verify, image/header code, and anything in header.py, hdu/*.py, convenience.py, scripts/*.
For each caller, state: what it does with the returned valuecomment, whether it re-parses it with
_value_RE / _value_NFSC_RE (which unescapes '' -> '), and therefore whether the value it receives
must be escaped or unescaped.

Also check: does anything cache or compare _valuestring / _image built from _split() output
(e.g. _verify's fixable-error machinery, Card.image regeneration, rvkc / record-valued keyword
cards, HIERARCH)? Would returning escaped chunks change any of those?

Be exhaustive and cite file:line for every claim.`,
  },
  {
    label: 'diag:tests',
    prompt: `${BACKGROUND}

TASK (read-only): Inventory what a fix must not break, and what new coverage it needs.

1. Find EVERY existing test that pins exact card images or values for long/CONTINUE string cards, or
   for quotes in card values/comments: grep astropy/io/fits/tests/*.py (test_header.py especially)
   plus any other tests touching CONTINUE, "''", _words_group, long_string. List them as
   file:line + one-line description of what they assert. Flag any that a change to the chunking
   width or to _split()'s unescaping would alter.
2. Check the docs for pinned examples: grep docs/io/fits/ (and docstrings in card.py/header.py) for
   CONTINUE / long string examples that would change.
3. Propose a regression test suite for this bug, in the style of the surrounding tests in
   test_header.py (naming, use of _pad, pytest.warns usage). Cover at least: the exact reported
   reproducers; '' at the start / middle / end; runs of 1,2,3,4 consecutive quotes; a value that is
   only quotes; quotes plus a comment (which forces & on every chunk); quotes near every chunk
   boundary (sweep lengths so the boundary lands on each side of a pair); long comment containing
   quotes; a value with a space at the chunk boundary; a value containing '&' and '/';
   Header round-trip through an actual FITS file on disk (writeto/open).
   Give the actual test code, and for each test say what it would do on UNPATCHED astropy
   (pass or fail) - verify that by running it with ${PY} from /testbed.

Return the inventory in must_not_break and the proposed tests in summary/findings.`,
  },
]

const diagnoses = await parallel(diagTasks.map((t) => () =>
  agent(t.prompt, { label: t.label, phase: 'Diagnose', schema: DIAG_SCHEMA, effort: 'high' })
))

const diagDigest = diagnoses.filter(Boolean).map((d, i) =>
  `### ${diagTasks[i].label}\n${d.summary}\n` +
  (d.findings || []).map((f) => `- [${f.location}] ${f.claim}\n  evidence: ${f.evidence}`).join('\n') +
  (d.invariants?.length ? `\ninvariants:\n- ${d.invariants.join('\n- ')}` : '') +
  (d.must_not_break?.length ? `\nmust not break:\n- ${d.must_not_break.join('\n- ')}` : '')
).join('\n\n')

log(`diagnosis complete (${diagnoses.filter(Boolean).length}/3 agents reported)`)

// ---------------------------------------------------------------- Phase 2 + 3
const CANDIDATES = [
  {
    key: 'A-parse-side',
    dir: '/tmp/sbx/cand1',
    strategy: `PARSE-SIDE ONLY. Fix defect (A) only: make Card._split() stop unescaping the value
chunks of a long/CONTINUE image, so that concatenating the chunks reconstructs the ESCAPED value
exactly, and the single subsequent _value_RE parse performs the one and only unescape. Do NOT change
_format_long_image or _words_group. Then honestly report whether the emitted images are still
standard-conforming when a '' pair lands on a chunk boundary (they may not be) - use your strict
parser check to demonstrate it either way.`,
  },
  {
    key: 'B-generate-side',
    dir: '/tmp/sbx/cand2',
    strategy: `GENERATION-SIDE + RE-ESCAPE AT JOIN. Fix defect (B) by making the chunking in
_format_long_image quote-pair aware, so an escaped '' pair is never split across two cards (back off
the split point by one character when it would land inside a pair; chunks may then be 66 chars
instead of 67 - that is fine, value_length is a maximum). Keep _split()'s per-chunk unescaping, and
instead fix the double-unescape by re-escaping when the concatenation is re-wrapped in quotes
(the f"'{''.join(values)}' / ..." line). Preserve _words_group's split-at-blanks behaviour for
values without quotes so pinned card images do not change.`,
  },
  {
    key: 'C-both-minimal',
    dir: '/tmp/sbx/cand3',
    strategy: `BOTH, MINIMAL. Fix (A) on the parse side (stop the double unescape by keeping chunks
escaped through the join) AND fix (B) on the generation side (never split an escaped '' pair across
cards). Aim for the smallest, most idiomatic diff that makes both the astropy round trip exact and
every emitted card image conform to the strict FITS string + CONTINUE convention. Preserve
_words_group's split-at-blanks behaviour for values without quotes.`,
  },
]

const BREAKER_LENSES = [
  {
    key: 'strict-parser',
    prompt: (c) => `Lens: STANDARD CONFORMANCE / INTEROPERABILITY.

Write your own independent, strict FITS card-image parser from the FITS standard rules (do NOT reuse
astropy code for it): a fixed-format string value starts with ' in the value field; inside the
string, two consecutive quotes '' denote one literal quote; the string ends at the first quote that
is not followed by another quote; under the CONTINUE (long-string) convention the value continues
when the string's last character is '&', and continuation cards have keyword CONTINUE followed by a
string value. Concatenate the unescaped chunks with the trailing & removed.

Then, using the PATCHED astropy in ${c.dir}, generate card images for a large corpus of values -
every length from 0 to 220 crossed with quote patterns at every position (leading, trailing,
embedded, runs of 1..5 quotes, quotes adjacent to spaces, values made only of quotes), with and
without comments (comments both short and long, comments containing quotes) - and check that YOUR
strict parser recovers exactly card.value from the image astropy emitted. Report every mismatch as a
counterexample. Also confirm every image length is a multiple of 80 and every chunk's quoting is
balanced.

For each mismatch you find, also run the same case against UNPATCHED astropy at /testbed and set
"preexisting" accordingly.`,
  },
  {
    key: 'fuzz-roundtrip',
    prompt: (c) => `Lens: ROUND-TRIP FUZZING. Try hard to REFUTE the claim "this patch makes
Card value round-tripping exact". Default to reporting a defect if you find any mismatch.

Using the PATCHED astropy in ${c.dir}, fuzz deterministically (no Math.random needed - iterate
systematically, or use python's random with a FIXED seed and print the seed): values built from the
alphabet of x, spaces, single quotes, &, /, =, digits, and other printable ASCII, over lengths 0..300,
including many with quotes at or adjacent to chunk boundaries (67, 66, 65, 134, 133, ... ) and
including values with trailing/leading spaces. Check, for card with and without a comment:
  card2 = Card.fromstring(str(card1)) -> card2.value == card1.value and card2.comment == card1.comment
  idempotence: str(card2) == str(card1); and a third generation is stable
  Header round-trip through a real file: h['CONFIG']=v; h.tofile / fits.PrimaryHDU(header=h).writeto
    then fits.getheader(...)['CONFIG'] == v
  Header.fromstring(str(h))['CONFIG'] == v
  card.verify('exception') does not raise for values astropy itself generated
Also test HIERARCH long keywords, keyword with field specifier (rvkc), commentary keywords
(COMMENT/HISTORY) with quotes, and value == "''" exactly.
Report every failing case; mark it preexisting=true if unpatched astropy at /testbed fails identically.`,
  },
  {
    key: 'regression-review',
    prompt: (c) => `Lens: REGRESSION RISK + CODE QUALITY. Read the candidate's diff in ${c.dir}
(git -C ${c.dir} diff) and review it as a maintainer.

1. Run the full io.fits test suite in ${c.dir} yourself: cd ${c.dir} && ${PY} -m pytest astropy/io/fits -q
   (also astropy/io/tests if quick). Report the summary line and every failure, and for each failure
   determine whether it also fails on unpatched /testbed.
2. Compare emitted images before/after: for a corpus of long values WITHOUT quotes (with and without
   comments, including the exact values used by test_long_string_value,
   test_word_in_long_string_too_long, test_long_string_value_with_multiple_long_words,
   test_final_continue_card_lacks_ampersand), assert the patched image is byte-identical to the
   unpatched image produced at /testbed. Any difference is a defect unless clearly required.
3. Review for: correctness of edge cases in the new code (empty value, value shorter than a chunk,
   chunk width off-by-one, a chunk that becomes empty, infinite-loop risk in any new loop,
   value that is a single quote, comment-only changes), dead code, non-idiomatic style vs the
   surrounding file, missing or misleading comments, and whether the change is minimal.
4. Check the candidate did not weaken or delete an existing assertion/test to make things pass
   (inspect the diff for changes to existing test expectations - flag any).
Report defects as counterexamples (repro = the command or snippet) and give a maintainer verdict.`,
  },
]

const results = await pipeline(
  CANDIDATES,
  (c) => agent(`${BACKGROUND}

## Your sandbox

You own the private astropy source copy at ${c.dir} (a full copy of /testbed with compiled
extensions already built). ALWAYS cd ${c.dir} first; running ${PY} from there imports that copy's
astropy. NEVER modify anything under /testbed - it is the pristine reference you compare against
(you may read it and run it to see unpatched behaviour). Other agents own /tmp/sbx/cand* siblings -
do not touch them. Scratch scripts go in ${c.dir}/_scratch/ (delete before you finish, and make sure
git status at the end shows only your intended source/test changes).

## Diagnosis from the analysis phase (verify, do not blindly trust)

${diagDigest}

## Your assigned strategy

${c.strategy}

## What to do

1. Implement the fix in ${c.dir}. Minimal, idiomatic, well-commented where non-obvious.
2. Add regression tests to ${c.dir}/astropy/io/fits/tests/test_header.py in the local style.
3. Validate exhaustively with your own scripts:
   - Round trip Card.fromstring(str(card)).value == card.value for every length 0..250 crossed with
     many quote patterns (leading/trailing/embedded, runs of 1..5 quotes, quotes at every offset
     near chunk boundaries), with and without comments, and long comments containing quotes.
   - Idempotence: str(Card.fromstring(str(card))) == str(card).
   - Header round trip through a real FITS file on disk.
   - STRICT PARSER CHECK: write your own independent strict FITS parser (string ends at the first
     quote not followed by a quote; '' means a literal quote; CONTINUE convention with trailing &)
     and verify it recovers card.value from every image your patched astropy emits.
   - IMAGE STABILITY CHECK: for long values containing NO quotes, the emitted image must be
     byte-identical to what unpatched astropy at /testbed emits.
4. Run the full test suite: cd ${c.dir} && ${PY} -m pytest astropy/io/fits -q  (report the summary
   line verbatim and every failure; check whether any failure also occurs on unpatched /testbed).
5. Report the diff via git -C ${c.dir} diff -- astropy/io/fits/card.py astropy/io/fits/util.py
   (source only) and your test additions separately.

Be scrupulously honest in self_critique: list every case you could not make work. A candidate that
reports a real limitation scores higher than one that hides it.`,
    { label: `impl:${c.key}`, phase: 'Implement', schema: IMPL_SCHEMA, effort: 'high' }),

  (impl, c) => {
    if (!impl) return null
    const digest = `## Candidate ${c.key} (sandbox ${c.dir})

strategy: ${impl.strategy}

diff:
${impl.diff}

tests added:
${impl.tests_added || '(none reported)'}

its own brute force: ${impl.brute_force?.cases_run} cases, failures: ${JSON.stringify(impl.brute_force?.failures || [])}
its strict-parser check: ${impl.strict_parser_check || '(not reported)'}
its image-stability check: ${impl.image_stability_check || '(not reported)'}
its test suite: ${impl.test_suite?.summary_line} failures=${JSON.stringify(impl.test_suite?.failures || [])}
its self critique: ${impl.self_critique}
`
    return parallel(BREAKER_LENSES.map((lens) => () =>
      agent(`${BACKGROUND}

${digest}

You are an adversarial reviewer of the candidate above. The patch is ALREADY APPLIED in ${c.dir}.
Do not change the candidate's source fix (you may add throwaway scripts under /tmp/scratch-${c.key}-${lens.key}/,
and you may run its test suite). Never modify /testbed. Assume the candidate's own reported results
may be wrong or overstated - re-run what matters yourself.

${lens.prompt(c)}`,
        { label: `break:${c.key}:${lens.key}`, phase: 'Break', schema: BREAK_SCHEMA, effort: 'high' })
        .then((v) => ({ lens: lens.key, ...(v || { broken: false, assessment: 'breaker died' }) }))
    )).then((breakers) => ({ cand: c, impl, breakers: breakers.filter(Boolean) }))
  }
)

const live = results.filter(Boolean)
log(`${live.length}/${CANDIDATES.length} candidates survived implementation + breaking`)

// ---------------------------------------------------------------- Phase 4
phase('Judge')

const dossier = live.map((r) => `## Candidate ${r.cand.key} (sandbox ${r.cand.dir})

strategy: ${r.impl.strategy}

DIFF:
${r.impl.diff}

TESTS ADDED:
${r.impl.tests_added || '(none)'}

self-reported: brute_force ${r.impl.brute_force?.cases_run} cases failures=${JSON.stringify(r.impl.brute_force?.failures || [])}
strict_parser_check: ${r.impl.strict_parser_check}
image_stability_check: ${r.impl.image_stability_check}
test_suite: ${r.impl.test_suite?.summary_line} failures=${JSON.stringify(r.impl.test_suite?.failures || [])}
self_critique: ${r.impl.self_critique}

BREAKER VERDICTS:
${r.breakers.map((b) => `- ${b.lens}: broken=${b.broken}\n  assessment: ${b.assessment}\n  counterexamples: ${(b.counterexamples || []).map((c) => `\n    * repro: ${c.repro}\n      expected: ${c.expected}\n      actual: ${c.actual}${c.preexisting ? ' [PRE-EXISTING, not a regression]' : ''}`).join('') || 'none'}`).join('\n')}
`).join('\n\n---\n\n')

const judges = await parallel([
  `You are judging on CORRECTNESS AND STANDARD CONFORMANCE above all. Which candidate's change makes
   (a) astropy's own round trip exact for every value, and (b) every emitted card image parseable by a
   strict third-party FITS reader? Weigh the breaker counterexamples; discount ones marked pre-existing
   (they are not regressions, but list them as out_of_scope_bugs). If no single candidate achieves both,
   say exactly which hunks must be combined.`,
  `You are judging on MINIMALITY AND MAINTAINABILITY as an astropy core maintainer reviewing a PR
   against astropy/io/fits/card.py. Prefer the smallest diff that fully fixes the bug, in the file's
   existing idiom, that does not change emitted images for quote-free values, does not weaken existing
   tests, and whose new tests are in the local style and would actually fail before the fix. Call out
   any candidate that solves it with an over-engineered rewrite of _words_group or of the parsing
   regexes.`,
].map((angle) => () => agent(`${BACKGROUND}

## Diagnosis
${diagDigest}

## Candidates, their self-reports, and adversarial breaker verdicts
${dossier}

${angle}

You may verify anything yourself by running ${PY} in the candidate sandboxes (/tmp/sbx/cand1..3) and
against pristine /testbed; do not modify /testbed.

Produce: a ranking, and the RECOMMENDED FINAL PATCH as exact replacement source text for each hunk
that must change in /testbed (with file:line anchors and enough surrounding context to apply
unambiguously) - taking the best candidate as the base and grafting fixes for any defect the
breakers found. Also produce the recommended regression tests, verbatim, in astropy test style.`,
  { label: `judge:${angle.slice(12, 34).toLowerCase().replace(/[^a-z]+/g, '-')}`, phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'high' })))

const panel = judges.filter(Boolean)

const final = await agent(`${BACKGROUND}

## Diagnosis
${diagDigest}

## Candidates + breaker verdicts
${dossier}

## Judge panel opinions
${panel.map((j, i) => `### Judge ${i + 1}
ranking: ${JSON.stringify(j.ranking)}
rationale: ${j.rationale}
residual risks: ${JSON.stringify(j.residual_risks || [])}
out of scope bugs: ${JSON.stringify(j.out_of_scope_bugs || [])}

recommended patch:
${j.recommended_patch}

recommended tests:
${j.recommended_tests}`).join('\n\n')}

You are the final synthesizer. Decide the ONE patch that should be applied to /testbed.

Requirements for your answer:
1. recommended_patch: the exact final source text for every hunk to change in
   /testbed/astropy/io/fits/card.py (and util.py only if genuinely required), given as
   "REPLACE (file:line-range):" old text then "WITH:" new text, copied verbatim from the real file so
   it applies unambiguously. It must fix BOTH the double-unescape and the split-escaped-pair defects
   (unless you can prove one is not a real defect - then justify).
2. recommended_tests: the complete pytest code to add to
   /testbed/astropy/io/fits/tests/test_header.py, in the local style, each test failing before the
   patch and passing after. Include the issue's own reproducers.
3. Before answering, VALIDATE your synthesized patch end to end: pick the sandbox whose state is
   closest, make it match your synthesized patch exactly, then run
   cd <sandbox> && ${PY} -m pytest astropy/io/fits -q
   plus your round-trip + strict-parser sweeps, and report the actual output in rationale.
   State plainly in residual_risks anything you could not verify.
Never modify /testbed.`,
  { label: 'synthesize', phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'max' })

return {
  diagnoses: diagnoses.filter(Boolean).map((d) => d.summary),
  candidates: live.map((r) => ({
    key: r.cand.key,
    dir: r.cand.dir,
    suite: r.impl.test_suite?.summary_line,
    bf_failures: r.impl.brute_force?.failures,
    broken_by: r.breakers.filter((b) => b.broken).map((b) => b.lens),
  })),
  panel: panel.map((j) => ({ ranking: j.ranking, risks: j.residual_risks })),
  final,
}
