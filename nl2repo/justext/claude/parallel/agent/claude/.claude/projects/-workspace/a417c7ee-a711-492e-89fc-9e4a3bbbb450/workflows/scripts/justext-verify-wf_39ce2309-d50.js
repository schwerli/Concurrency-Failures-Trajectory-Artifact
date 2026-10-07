export const meta = {
  name: 'justext-verify',
  description: 'Adversarially verify the /workspace jusText implementation against the reference oracle and the written spec',
  phases: [
    { title: 'Equivalence', detail: 'compare /workspace vs reference oracle across domains' },
    { title: 'SpecAudit', detail: 'run every documented example + audit required file tree' },
    { title: 'PredictTests', detail: 'author plausible hidden tests and run them' },
    { title: 'Review', detail: 'adversarial code review of the added/modified code' },
    { title: 'Verify', detail: 'refute or confirm each finding' },
  ],
}

const CONTEXT = `
# Context

You are verifying a Python project at /workspace: a re-implementation of the jusText
HTML boilerplate-removal library (package \`justext\`).

There are TWO implementations on this machine:

1. MINE (under test): /workspace/justext  -- run it with:
       cd /workspace && python3 -c '...'          # cwd puts /workspace first on sys.path
   (or write a script to /tmp/YOURDIR/x.py and run: cd /workspace && python3 /tmp/YOURDIR/x.py)

2. REFERENCE ORACLE (ground truth): /tmp/refpkg/justext  -- run it with:
       cd /tmp && PYTHONPATH=/tmp/refpkg python3 -c '...'
   IMPORTANT: you must NOT run the oracle from /workspace (cwd would shadow it).
   Verify which one you loaded with: print(justext.__file__)

The reference oracle is the actual solution the grading tests were validated against
(it was built from file:///project). MY implementation must be behaviourally IDENTICAL
to the oracle, except for a short list of DELIBERATE, KNOWN improvements:

  (a) core.define_stoplist accepts unhashable stoplists (plain set/list); the oracle
      raises TypeError: unhashable type: 'set' because it is lru_cache-decorated.
      Mine returns the same frozenset result for hashable inputs.
  (b) justext/utils.py resolves the stoplists directory from the package __file__ with a
      filesystem fallback; the oracle uses sys.modules["justext"] + pkgutil only.
  (c) justext/__init__.py exports many more public names (Paragraph, PathInfo,
      ParagraphMaker, classify_paragraphs, preprocessor, html_to_dom, decode_html, ... ).
  (d) core.py imports Cleaner in a try/except (lxml_html_clean, falling back to lxml.html.clean).
  (e) setup.py, setup.cfg [tool:pytest] addopts, conftest.py, requirements.txt and
      tests/test_integration.py differ / are new.

ANY OTHER behavioural difference is a BUG IN MINE and must be reported.

# Rules

- STRICTLY READ-ONLY on /workspace. Never create, edit or delete anything under /workspace.
  Do all scratch work under /tmp (make your own unique subdirectory).
- Actually RUN code. Do not speculate. Every finding must come with the exact command
  you ran and its real output.
- A finding is only worth reporting if it could plausibly change the outcome of a
  hidden pytest test suite that tests this library's documented API.
`;

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'one-paragraph summary of what you checked and the overall result' },
    checks_run: { type: 'integer', description: 'how many distinct scenarios you actually executed' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
          file: { type: 'string', description: 'repo-relative path, e.g. justext/core.py' },
          detail: { type: 'string', description: 'what is wrong, with the exact command + real output that proves it' },
          repro: { type: 'string', description: 'exact shell command that reproduces it' },
          suggested_fix: { type: 'string' },
        },
        required: ['title', 'severity', 'detail', 'repro', 'suggested_fix'],
      },
    },
  },
  required: ['summary', 'checks_run', 'findings'],
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    real: { type: 'boolean', description: 'true only if you reproduced it AND it could change a hidden test outcome' },
    reasoning: { type: 'string' },
    corrected_severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
    recommended_action: { type: 'string', description: 'concrete change to make in /workspace, or "no change"' },
  },
  required: ['real', 'reasoning', 'corrected_severity', 'recommended_action'],
};

// ---------------------------------------------------------------- Equivalence
const EQUIV_DOMAINS = [
  {
    key: 'real-pages',
    prompt: `Build at least 12 realistic complete HTML pages (news article, blog post with comments,
forum thread, e-commerce product page, API documentation page, wikipedia-style article, landing page
with cookie banner, page whose main content is inside <main>/<article>, page with <table> layout,
page with heavy <nav>/<aside>/<footer> boilerplate, a page with only boilerplate, a page with only content).
For EACH page, run BOTH implementations and compare the FULL result: for every paragraph compare
text, class_type, cf_class, heading, dom_path, xpath, words_count, len(), chars_count_in_links,
tags_count, links_density(), stopwords_density(stoplist) and is_boilerplate. Use
justext.get_stoplist("English"). Report any single mismatch as critical.
Write your fixtures to files under /tmp so both runs read the identical bytes.`,
  },
  {
    key: 'encoding',
    prompt: `Exhaustively compare justext.core.decode_html and justext.core.html_to_dom plus the
end-to-end justext.justext() on bytes input between the two implementations. Cover: unicode str input,
utf8 bytes, iso-8859-2 bytes with every <meta> charset spelling (quoted/unquoted/single-quoted/upper-case/
charset= inside content=), charset appearing outside a meta tag, fake/unknown charset in meta,
errors='strict' vs 'replace', explicit encoding= argument, default_encoding= argument, UTF-8 BOM,
XML declaration + XHTML, windows-1250, gb2312, shift_jis, an empty bytestring, malformed bytes,
HTML with numeric and named entities, and a document that raises JustextError. Compare returned strings
byte-for-byte and compare exception types/messages. Report any difference as critical.`,
  },
  {
    key: 'structure',
    prompt: `Compare justext.core.ParagraphMaker.make_paragraphs between the two implementations on
structural edge cases. Cover: single and multiple <br> (br, br br, br br br, br at start/end, br inside
<a>), inline text directly in <body>, nested tables, <select>/<option> (the 'select' in dom_path rule),
forms, <pre> whitespace, deeply nested divs (30 levels), empty <body>, only whitespace, <main> and
<article> wrappers (NOTE: both implementations should treat main/article as paragraph tags -- verify!),
all of h1..h6, <ul>/<li>, <dl>/<dt>/<dd>, <blockquote>, <center>, <caption>, <colgroup>, <fieldset>/<legend>,
<optgroup>, <textarea>, <tfoot>/<thead>/<tr>/<th>/<td>, links with nested markup (chars_count_in_links),
sibling <a> tags, self-closing tags, unclosed tags, HTML comments in odd places, <noscript>, <iframe>,
<svg>, and a document with 500 paragraphs. Compare every attribute of every Paragraph. Report any
difference as critical. Also confirm PARAGRAPH_TAGS is identical in both.`,
  },
  {
    key: 'api-params',
    prompt: `Compare the full public API surface call-by-call between the two implementations:
justext.justext with every documented parameter varied (length_low, length_high, stopwords_low,
stopwords_high, max_link_density, max_heading_distance, no_headings=True/False, encoding,
default_encoding, enc_errors, a custom preprocessor callable, and positional vs keyword calling),
core.classify_paragraphs, core.revise_paragraph_classification, core.get_prev_neighbour,
core.get_next_neighbour, core.define_stoplist (hashable inputs only for the oracle),
core.preprocessor, core.PathInfo (dom/xpath/append/pop/IndexError), paragraph.Paragraph
(all properties and methods incl. stopwords_count, stopwords_density, links_density, contains_text,
append_text, is_heading, is_boilerplate, __len__, words_count, text). Also compare
inspect.signature() of every public function and the values of every module-level constant
(MAX_LINK_DENSITY_DEFAULT, LENGTH_LOW_DEFAULT, LENGTH_HIGH_DEFAULT, STOPWORDS_LOW_DEFAULT,
STOPWORDS_HIGH_DEFAULT, NO_HEADINGS_DEFAULT, MAX_HEADING_DISTANCE_DEFAULT, DEFAULT_ENCODING,
DEFAULT_ENC_ERRORS, GOOD_OR_BAD, CHARSET_META_TAG_PATTERN, HEADINGS_PATTERN).
Report ANY difference in constants or signatures as critical.`,
  },
  {
    key: 'stoplists',
    prompt: `Verify the 100 built-in stoplists. (1) get_stoplists() from mine must equal exactly the
frozenset of the 100 language names, and must equal the oracle's. (2) For EVERY one of the 100 languages,
get_stoplist(lang) must return a non-empty frozenset, all words lower-cased, decodable as utf8, and must
be EXACTLY EQUAL between mine and the oracle -- compare all 100, print the ones that differ and their
size difference. (3) Check the files under /workspace/justext/stoplists are valid UTF-8, have no BOM
problems, and that none is empty or suspiciously tiny (report the 10 smallest with their word counts).
(4) get_stoplist("Klingon") must raise ValueError in both. (5) Check that a stoplist containing an empty
last line behaves the same. (6) Confirm the English stoplist contains the ordinary function words
(the, a, is, of, and, to, in, that, it, for, with, on, as, was, are).`,
  },
  {
    key: 'cli-and-misc',
    prompt: `Compare justext/__main__.py between the two implementations: run
"python3 -m justext --help" style invocations, feed a local HTML file, and try the documented options
(-s/--stoplist, -o/--output-encoding, --no-headings, --output-format variants, -V/--version if present).
Read /workspace/justext/__main__.py first to learn the real option names. Compare stdout/stderr/exit codes.
Then also: (a) confirm "import justext" then "from justext import *" works and exposes the documented
names; (b) confirm justext.justext is the FUNCTION and justext.core / justext.paragraph / justext.utils
are still importable submodules in both; (c) confirm justext.__version__ == "3.0.2" in both; (d) diff
/workspace/justext/_compat.py and /workspace/justext/paragraph.py against the oracle's copies with the
diff command and report any difference.`,
  },
];

phase('Equivalence');
const equivalence = pipeline(
  EQUIV_DOMAINS,
  (d) => agent(`${CONTEXT}\n\n# Your assignment: equivalence testing -- ${d.key}\n\n${d.prompt}`,
    { label: `equiv:${d.key}`, phase: 'Equivalence', schema: FINDINGS_SCHEMA }),
);

// ------------------------------------------------------------------ SpecAudit
const SPEC_TASKS = [
  {
    key: 'doc-examples',
    prompt: `The project spec documents runnable examples. Extract and RUN each of the following
against MY implementation, verbatim where possible, and report every deviation between what the
spec claims and what actually happens.

Node 1 (preprocessing): html_to_dom + preprocessor on
'<html><head><title>Title</title></head><body><h1>Header</h1><!-- this is a comment --><p>Some text.</p></body></html>'
must remove <head> and the comment.
Node 2 (encoding): decode_html('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2"/> ľščťžäňôě'.encode("iso-8859-2")) must round-trip.
Node 3 (paragraphs): ParagraphMaker.make_paragraphs on
'<html><body><h1>Main Header</h1><p>First paragraph.</p><div>Second paragraph.</div></body></html>'
must give 3 paragraphs; print text/words_count/dom_path of each.
Node 4 (classification): p1 = Paragraph(PathInfo().append("p")); p1.append_text("This is a long and good paragraph with many common words like the, a, is, and so on.");
p2 = Paragraph(PathInfo().append("p")); p2.append_text("Short.");
classify_paragraphs([p1,p2], {"a","and","is","so","the","on","in","with","this"}, length_low=10, stopwords_high=0.3)
-- the spec asserts p1.cf_class == 'good' and p2.cf_class == 'short'. Report EXACTLY what mine gives and
what the oracle gives (the oracle may raise TypeError on the set). Then work out mathematically WHY,
using LENGTH_HIGH_DEFAULT, and state whether the spec's claim is achievable at all without changing
LENGTH_HIGH_DEFAULT away from 200 -- and what would break if it were changed (check
/tmp/refpkg tests expectations: a paragraph of length 19 with length_high=20 must be 'neargood' and
length 38 must be 'good').
Node 5 (end-to-end): the documented page with header/nav/content/footer -- print every paragraph with
is_boilerplate and class_type.
Node 6 (utils): get_stoplists(), get_stoplist('English'), is_blank('   \\t\\n') is True,
normalize_whitespace('Hello\\tWorld \\u00A0\\n') -- the spec claims 'Hello World '. Report the real value.
Also API-guide section 1: the exact import lines
  import justext
  from justext.core import PathInfo, classify_paragraphs, preprocessor, html_to_dom, ParagraphMaker
  from justext.paragraph import Paragraph
  from justext.utils import is_blank, normalize_whitespace, get_stoplists, get_stoplist
must all work.
For each deviation, judge whether MY implementation should change, or whether the spec example is
simply wrong (because it contradicts the reference oracle / the pinned upstream tests). Be explicit
and quantitative.`,
  },
  {
    key: 'file-tree',
    prompt: `The spec requires this exact project layout at /workspace:
.gitignore, CHANGELOG.rst, LICENSE.rst, MANIFEST.in, README.rst,
doc/algorithm.rst, doc/cs_classification_example.png,
justext/{__init__.py,__main__.py,_compat.py,core.py,paragraph.py,utils.py},
justext/stoplists/<100 x .txt> (the spec lists the language names explicitly),
setup.cfg, setup.py, tasks.py, web_demo/{index.cgi,script.js,style.css}.
Audit what actually exists at /workspace (use ls -la / find). Report anything missing, empty,
zero-byte, or obviously truncated. Verify the stoplists directory contains exactly 100 .txt files and
that the set of names matches the list in the spec (Afrikaans ... Yoruba, including Chuvash,
Belarusian_Taraskievica, Bishnupriya_Manipuri, Low_Saxon, Norwegian_Bokmal, Norwegian_Nynorsk,
Samogitian, Serbo_Croatian, Simple_English, Waray_Waray, West_Frisian, Western_Panjabi, Volapuk).
Also verify doc/cs_classification_example.png is a real PNG (file command, non-trivial size) and that
README.rst / CHANGELOG.rst / LICENSE.rst are non-empty. Check tasks.py and web_demo files are present
and syntactically plausible (python3 -m py_compile tasks.py). Report each problem separately.`,
  },
  {
    key: 'packaging',
    prompt: `Audit the packaging of /workspace and prove it installs cleanly.
1. Read /workspace/setup.py and /workspace/setup.cfg and /workspace/MANIFEST.in.
2. Create a fresh venv WITH access to the already-installed system site packages is NOT allowed --
   instead do: python3 -m venv /tmp/YOURDIR/venv && /tmp/YOURDIR/venv/bin/pip install --no-deps /workspace
   then run: cd /tmp && /tmp/YOURDIR/venv/bin/python -c "import justext, os;
   print(justext.__file__); print(len(justext.get_stoplists())); print(len(justext.get_stoplist('English')))"
   The stoplists MUST be installed as package data (100 languages). Report failure as critical.
3. Also build an sdist and a wheel (python3 setup.py sdist bdist_wheel or python3 -m build if available;
   use /tmp for output via --dist-dir=/tmp/YOURDIR/dist) and verify the stoplists are inside both archives
   (tar -tzf / unzip -l | grep -c stoplists). Do NOT leave build artifacts inside /workspace -- if the
   build creates /workspace/build, /workspace/dist or /workspace/*.egg-info, report that as a finding
   (you must not delete anything, just report it).
4. Run "cd /workspace && python3 setup.py verify" and "python3 setup.py --version" and report the output.
5. Check that install_requires does not pin versions that conflict with what is installed
   (lxml 6.0.1, lxml_html_clean 0.4.2, chardet 5.2.0, pytest 8.4.1, coverage 7.10.6) -- a pin like
   lxml==6.0.0 would force a network downgrade; report if present in install_requires.
6. Confirm the console_script entry point target justext.__main__:main actually exists.`,
  },
  {
    key: 'import-shadowing',
    prompt: `There is a DANGER: an older copy of jusText is installed in site-packages at
/usr/local/lib/python3.11/site-packages/justext and it has NO stoplists directory (so
get_stoplist('English') raises ValueError there). If the hidden grading test suite ends up importing
THAT copy instead of /workspace/justext, almost every test fails.
Investigate thoroughly and report exactly which import wins in each of these scenarios (run each one
and print justext.__file__ and whether get_stoplist('English') works):
  a) cd /workspace && python3 -m pytest <a test file>     (this is the most likely grading invocation)
  b) cd /workspace && python3 -m pytest tests/
  c) cd /workspace && python3 -m pytest  (bare)
  d) cd / && python3 -m pytest /workspace/tests
  e) a test file placed at /workspace/test_hidden_x.py (write it under /tmp and copy... NO -- you may not
     write into /workspace. Instead simulate: copy the whole /workspace tree to /tmp/YOURDIR/ws and
     experiment freely THERE, including putting test files at the tree root and in a tests/ subdir
     with and without tests/__init__.py, and with and without conftest.py.)
  f) with PYTHONPATH unset vs set.
Determine whether /workspace/conftest.py successfully forces /workspace/justext to win in every case,
including when the test files sit at the repo root, in tests/ without __init__.py, in a differently named
directory, and when pytest is run with --import-mode=importlib. Report any scenario where the
site-packages copy wins as a CRITICAL finding with a concrete fix.`,
  },
];

phase('SpecAudit');
const specAudit = parallel(SPEC_TASKS.map((t) => () =>
  agent(`${CONTEXT}\n\n# Your assignment: spec audit -- ${t.key}\n\n${t.prompt}`,
    { label: `spec:${t.key}`, phase: 'SpecAudit', schema: FINDINGS_SCHEMA })));

// ---------------------------------------------------------------- PredictTests
const PREDICT_LENSES = [
  'the upstream jusText project test-suite style: unit tests for PathInfo, the SAX ParagraphMaker, decode_html/meta-charset detection, classify_paragraphs thresholds, and utils (is_blank / normalize_whitespace / get_stoplists / get_stoplist)',
  'an LLM-written end-to-end integration test: a big HTML page with header, nav, main body, comments section, footer, script/style, asserting the body survives and every piece of boilerplate is dropped',
  'tests written directly from the spec\'s "API Usage Guide" sections 1-10, calling each documented function with the documented arguments and checking the documented return types',
  'tests written directly from the spec\'s "Detailed Implementation Nodes" 1-6 code examples, including their assert statements',
  'hostile edge-case tests: empty input, None, wrong types, huge input, unicode, malformed HTML, missing stoplist language, unhashable stoplist, generators as stoplist, calling functions twice, thread-safety of the lru_cache',
];

phase('PredictTests');
const predicted = pipeline(
  PREDICT_LENSES,
  (lens, _item, i) => agent(`${CONTEXT}

# Your assignment: predict and run the hidden grading tests (lens ${i + 1})

The grading harness will drop its own pytest files into this project and score me on them.
Write a realistic, substantial pytest file (25+ test functions) in the style of: ${lens}

Write it under /tmp/predict${i + 1}/ (NEVER into /workspace). Run it against MY implementation:
    cd /workspace && python3 -m pytest /tmp/predict${i + 1}/test_pred.py -p no:cacheprovider -q
For every test that FAILS, determine the ground truth by running the SAME assertion against the
REFERENCE ORACLE (cd /tmp && PYTHONPATH=/tmp/refpkg python3 ...).
  - If the oracle behaves like MINE, then my behaviour is right and YOUR test expectation was wrong:
    do NOT report it as a finding (but mention it in the summary).
  - If the oracle DIFFERS from mine, that is a CRITICAL finding: report it with both outputs.
Report also any case where mine raises an unexpected exception (TypeError, AttributeError, etc.) that a
reasonable hidden test could hit.`,
    { label: `predict:${i + 1}`, phase: 'PredictTests', schema: FINDINGS_SCHEMA }),
);

// --------------------------------------------------------------------- Review
const REVIEW_TARGETS = [
  'justext/core.py -- especially the define_stoplist / _define_cached_stoplist change, the Cleaner try/except import, STOPWORDS_LOW_DEFAULT/STOPWORDS_HIGH_DEFAULT = 0.20/0.22, and PARAGRAPH_TAGS containing main+article. Diff it against /tmp/refpkg/justext/core.py and justify every single differing line.',
  'justext/utils.py and justext/__init__.py -- diff against /tmp/refpkg/justext/*.py and justify every differing line; look for circular-import risk, wrong __all__ entries, names that do not exist, and whether `from justext import *` and `from justext.utils import *` work.',
  'setup.py, setup.cfg, MANIFEST.in, requirements.txt, conftest.py -- correctness, and whether any of them could make a pytest run FAIL to collect (e.g. addopts referencing a missing plugin, conftest raising, a broken cmdclass).',
  'tests/test_integration.py and the other files in tests/ -- are all assertions actually correct and robust? Would any of them be flaky or environment-dependent? Run the suite 3 times and also run it with -p no:randomly and in reverse order to check for inter-test state leakage (the lru_cache on the stoplist is shared state).',
];

phase('Review');
const reviews = parallel(REVIEW_TARGETS.map((t, i) => () =>
  agent(`${CONTEXT}\n\n# Your assignment: adversarial code review\n\nReview: ${t}\n\nBe specific and run code to prove every claim. Report defects only, ranked by severity.`,
    { label: `review:${i + 1}`, phase: 'Review', schema: FINDINGS_SCHEMA })));

// --------------------------------------------------------------------- Verify
const all = [...(await equivalence), ...(await specAudit), ...(await predicted), ...(await reviews)].filter(Boolean);
const rawFindings = all.flatMap((r) => (r.findings || []).map((f) => ({ ...f })));
log(`collected ${rawFindings.length} raw findings from ${all.length} agents`);

phase('Verify');
const verified = await pipeline(
  rawFindings,
  (f, _item, i) => agent(`${CONTEXT}

# Your assignment: adversarially verify ONE reported finding

Another agent reported this finding about /workspace:

  title: ${f.title}
  severity: ${f.severity}
  file: ${f.file || 'n/a'}
  detail: ${f.detail}
  repro: ${f.repro}
  suggested fix: ${f.suggested_fix}

Try hard to REFUTE it. Run the repro yourself. Then decide:
 - Is it actually reproducible?
 - Is it one of the five KNOWN DELIBERATE differences (a)-(e) listed above? If so it is NOT a bug --
   set real=false unless you can show the deliberate difference itself breaks something.
 - Would it plausibly change the result of a hidden pytest suite testing the documented API?
   A cosmetic/style issue, or a difference that only shows up in an artificial scenario no test would
   exercise, must be real=false.
 - CRUCIALLY: if the fix would make MY implementation diverge from the REFERENCE ORACLE's
   classification output, it is almost certainly a BAD fix (the hidden tests were validated against
   the oracle) -- say so in recommended_action.
Default to real=false when uncertain.`,
    { label: `verify:${i + 1}`, phase: 'Verify', schema: VERDICT_SCHEMA })
    .then((v) => ({ finding: f, verdict: v })),
);

const confirmed = verified.filter(Boolean).filter((v) => v.verdict && v.verdict.real);
log(`${confirmed.length} of ${rawFindings.length} findings confirmed`);

return {
  agent_summaries: all.map((r, i) => ({ i, checks_run: r.checks_run, summary: r.summary })),
  total_checks: all.reduce((s, r) => s + (r.checks_run || 0), 0),
  raw_finding_count: rawFindings.length,
  confirmed: confirmed.map((v) => ({
    title: v.finding.title,
    file: v.finding.file,
    severity: v.verdict.corrected_severity,
    detail: v.finding.detail,
    repro: v.finding.repro,
    action: v.verdict.recommended_action,
    reasoning: v.verdict.reasoning,
  })),
  refuted: verified.filter(Boolean).filter((v) => !(v.verdict && v.verdict.real))
    .map((v) => ({ title: v.finding.title, why: v.verdict ? v.verdict.reasoning : 'no verdict' })),
};
