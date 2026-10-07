export const meta = {
  name: 'pyquery-spec-audit',
  description: 'Audit the /workspace pyquery implementation against the project specification',
  phases: [
    { title: 'Audit', detail: 'parallel auditors, one per spec area' },
    { title: 'Verify', detail: 'adversarially verify each finding' },
  ],
}

const CONTEXT = `
You are auditing a Python project at /workspace. It implements the "PyQuery" library
(a jQuery-like API for XML/HTML querying, i.e. a clone of the real pyquery 2.0.x).
Environment: python3.13, lxml 6.0.1, cssselect 1.3.0, requests, pytest. Run commands with
python3 from /workspace (the package is importable from there; do NOT pip install anything).

The project files: /workspace/pyquery/{__init__,pyquery,cssselectpatch,openers,text}.py,
setup.py, pytest.ini, conftest.py, tox.ini, MANIFEST.in, README.rst, CHANGES.rst,
LICENSE.txt, README_fixt.py, .gitignore, .hgignore, tests/, docs/.

The official test suite currently passes 150/150 (run: cd /workspace && python3 -m pytest -q).
YOUR JOB IS TO FIND GAPS *NOT* COVERED BY THAT SUITE, i.e. places where the written
specification requires something the code does not do.

CRITICAL RULES:
- Do NOT modify, create or delete ANY file under /workspace. Read and run only.
  You may write scratch files under /tmp.
- Verify every claim by actually running python3 code before reporting it.
- A finding must be a real deviation from the specification text quoted below, not a
  style preference, not a difference from some other pyquery version, and never something
  that would break the currently passing test suite.
- Report at most the 8 most important findings you can actually demonstrate.
`;

const SPEC_API = `
SPEC EXTRACT — module import & entry points:
  from pyquery import (PyQuery as pq, fromstring, url_opener, no_default)
  Also documented: "from pyquery import PyQuery as pq, JQueryTranslator" with
  translator = JQueryTranslator(xhtml=True); d = pq('<html><body><p>Hello</p></body></html>', css_translator=translator)
  pyquery/__init__.py must be a unified API entry point importing the core PyQuery class
  and providing version information (project version is 2.0.2.dev0).
  setup.py must configure an installable package (pip install) and declare dependencies
  including lxml>=2.1, cssselect>=1.2.0, requests, pytest.
  PyQuery class must accept kwargs: parser, parent, css_translator, namespaces, filename,
  url, opener; raise ValueError('Invalid keyword arguments ...') for unknown kwargs;
  raise TypeError for a non str/list/PyQuery/etree._Element context; raise ValueError when
  given zero or 3+ positional args.
  Documented module members: PyQuery, JQueryTranslator, FlexibleElement, NoDefault/no_default,
  XPathExpr, fromstring(context, parser=None, custom_parser=None), url_opener, _query, _requests,
  _urllib, getargspec, build_camel_case_aliases, with_camel_case_alias, callback,
  squash_html_whitespace, _squash_artifical_nl, _strip_artifical_nl, _merge_original_parts,
  extract_text_array, extract_text, DEFAULT_TIMEOUT=60 (openers.py),
  INLINE_TAGS/SEPARATORS/WHITESPACE_RE (text.py).
  fromstring supports parser in ('html','xml','html5','soup','html_fragments') and
  custom_parser; returns a list of DOM elements; accepts a string OR a file object with read().
  PyQuery methods documented in the spec (each must exist and chain where applicable):
  _css_to_xpath, _copy, __call__, __add__, extend, items, xhtml_to_html, remove_namespaces,
  __str__, __unicode__, __html__, __repr__, root, encoding, _filter_only, parent, prev, next,
  _traverse, _traverse_parent_topdown, _next_all, next_all, next_until, _prev_all, prev_all,
  siblings, parents, children, closest, contents, filter, not_, is_, find, eq, each, map,
  length, size, end, attr, remove_attr, height, width, has_class, add_class, remove_class,
  toggle_class, css, hide, show, val, html, outer_html, text, _get_root, append, append_to,
  prepend, prepend_to, after, insert_after, before, insert_before, wrap, wrap_all,
  replace_with, replace_all, clone, empty, remove, Fn/fn, serialize_array, serialize,
  serialize_pairs, serialize_dict, base_url, make_links_absolute.
  Every snake_case method decorated for aliasing must also be reachable in camelCase
  (e.g. outerHtml, removeAttr, hasClass, addClass, removeClass, toggleClass, nextAll,
  nextUntil, prevAll, appendTo, prependTo, insertAfter, insertBefore, wrapAll, replaceWith,
  replaceAll, serializeArray, serializePairs, serializeDict, makeLinksAbsolute, removeNamespaces,
  xhtmlToHtml).
`;

const AUDITORS = [
  {
    key: 'api-surface',
    prompt: `${CONTEXT}\n${SPEC_API}\n
TASK: audit the API surface. For EVERY documented member listed above, verify by running
python3 that it exists, is callable/accessible with the documented signature, and that
camelCase aliases resolve. Check pyquery/__init__.py exports and version info, and check
setup.py (does 'python3 setup.py --version' work? does it declare the documented deps?
is the package installable - you may run 'python3 -m pip install --dry-run .' style checks
only if they do not modify the environment; prefer 'python3 -c' inspection of setup.py).
Report anything missing, misnamed, or with a wrong signature.`,
  },
  {
    key: 'selectors',
    prompt: `${CONTEXT}\n
SPEC EXTRACT — selectors: CSS basic/combined/attribute selectors must work, plus the jQuery
pseudo classes: :first :last :even :odd :eq(n) :lt(n) :gt(n) :checked :selected :disabled
:enabled :input :button :radio :checkbox :file :text :password :hidden :submit :reset :image
:header :parent :empty :contains(text) :has(selector).
Spec examples that must hold (verify each one literally):
  d = pq(html) with 3 divs: d('div:first').text()=='node1', d('div:last').text()=='node3',
  d('div:even').text()=='node1 node3', d('div:gt(0)').text()=='node2 node3',
  d('div:lt(1)').text()=='node1', d('div:eq(2)').text()=='node3'
  form example: len(d(':disabled'))==1, len(d(':selected'))==1, len(d(':checked'))==2,
  len(d(':file'))==1, len(d(':input'))==8, len(d(':button'))==2, len(d(':radio'))==3,
  len(d(':checkbox'))==3  (html is in the spec section "5. Form Element Pseudo-classes":
  a form with input text enabled, input text disabled, a select with two options where the
  second is selected, 2 checkboxes (second checked), 2 radios (second checked), 1 file input)
  d('.foo:has(".bar")') supports a QUOTED string argument as well as d('.foo:has(div)')
  XML case sensitivity: pq('<X>foo</X>', parser='xml') -> len(d('X'))==1, len(d('x'))==0;
  with parser='html' both are 1.
  Namespace selectors: d('bar|blah', namespaces={...}), remove_namespaces(), xhtml_to_html().
TASK: verify every pseudo class and the listed expectations by running python3. Also verify
JQueryTranslator exposes xpath_<name>_pseudo / xpath_<name>_function methods for all of them.
Report any pseudo class that is missing, errors, or returns the wrong nodes.`,
  },
  {
    key: 'traversal-manip',
    prompt: `${CONTEXT}\n
SPEC EXTRACT — traversal & manipulation. Verify these documented examples literally by
running python3 (the html snippets are given inline in the spec sections 6,8,12,25-32):
  filter/not_/is_/find/eq/each/map/end/closest/contents/items
  d('#term-2').next_all() -> 6 nodes; next_all('dd') -> 5; next_until('dt') -> 3;
  next_until('dt', ':not(.strange)') -> 2   (definition list example)
  each with a zero-arg lambda using 'this'; map with 0/1/2 arg callbacks; PyQuery.fn hook
  including keyword args (pq.fn.test = lambda p=1: pq(this).eq(p))
  attr: pq('<div>').attr('value','').outer_html()=='<div value=""></div>' and
  outer_html(method='xml')=='<div value=""/>'; removeAttr
  css get/set incl. dict form and underscore->dash conversion; hide()/show()
  add_class/remove_class/toggle_class/has_class; height/width
  wrap/wrap_all/replace_with/replace_all (incl. callable value)/clone/empty/remove(expr)
  append/prepend/after/before/append_to/prepend_to/insert_after/insert_before
  html() get/set incl. entity preservation:
    inner='encoded &lt;script&gt; tag with "quotes".<span>nested &lt;tag&gt;</span>'
    pq('<div>'+inner+'</div>').html()==inner
  text() incl. squash_space=False; comments ignored: pq('<div><!-- foo --> bar</div>').text()=='bar'
  make_links_absolute(base_url=...) and base_url property
  items(), __add__, extend, clone independence, method chaining
TASK: run each one. Report only demonstrable deviations from the spec text.`,
  },
  {
    key: 'forms-text-net',
    prompt: `${CONTEXT}\n
SPEC EXTRACT — forms, text extraction and network. Verify literally with python3:
  val() for input/checkbox/radio/textarea/select (single + multiple), incl.
  d.val(['eggs','sausage','bacon']) on a multiple select keeping only existing options,
  and an empty select returning None.
  serialize(), serialize_array(), serialize_pairs(), serialize_dict() (OrderedDict, repeated
  names become a list), form control filtering (skip disabled, submit, image, reset, file,
  button; include inputs outside their form via form=id; fieldset[disabled]).
  Multiline values serialize with \\r\\n.
  text extraction rules (pyquery/text.py): INLINE_TAGS, SEPARATORS={'br'},
  WHITESPACE_RE, squash_html_whitespace, extract_text_array, extract_text with
  block_symbol/sep_symbol/squash_space. Spec examples:
    'Phas<em>ell</em>us<i> eget </i>sem <b>facilisis</b> justo' -> squash and no-squash both
    'Phasellus eget sem facilisis justo'
    'Phas<p>ell</p>us<div> eget </div>sem <h1>facilisis</h1> justo' ->
    squash 'Phas\\nell\\nus\\neget\\nsem\\nfacilisis\\njusto',
    nosquash 'Phas\\nell\\nus\\n eget \\nsem \\nfacilisis\\n justo'
    'Some words<br>test. Another word<br><br> <br> test.' ->
    squash 'Some words\\ntest. Another word\\n\\n\\ntest.',
    nosquash 'Some words\\ntest. Another word\\n\\n \\n test.'
    (these are evaluated as pq('<html><body>' + html + '</body></html>').text(squash_space=...))
  openers: url_opener/_query/_requests/_urllib, DEFAULT_TIMEOUT=60, custom opener via
  pq(url=..., opener=fn) (also opener receiving kwargs), timeout support, session support,
  data + method='get'/'post'. Use a LOCAL wsgi server (webtest.http.StopableWSGIServer with
  webtest.debugapp.debug_app) for network checks - do not hit the public internet except at
  most one quick check.
  filename= loading and encoding= support: pq(filename='tests/test.html').
TASK: run each one. Report only demonstrable deviations from the spec text.`,
  },
  {
    key: 'spec-snippets',
    prompt: `${CONTEXT}\n
TASK: You are the "documentation executor". The specification contains ~40 numbered sections
each with an "Input and Output Examples" python snippet (sections 1-39: unicode support,
attribute case, css selector query, pseudo classes, form pseudo classes, document traversal,
element iteration/mapping, element navigation, file loader, callbacks, custom fn hooks, DOM
manipulation, form value manipulation, textarea values, select values, html content, form
serialization, link absolutization, html parsers, xml namespaces, web scraping, encoding,
text extraction, attribute manipulation, css styles, show/hide, wrapping, replacement,
cloning, emptying, removal, control filtering, multiline text, error handling, comments,
chaining, naming style compat, performance).
Read the real pyquery documentation shipped in /workspace/docs/*.rst and /workspace/README.rst
and /workspace/tests/doctests.rst as a proxy for the spec's examples, AND reconstruct the
spec examples from the list above using your knowledge of the pyquery API.
Write a single scratch script /tmp/snippets_check.py that exercises as many of these
documented behaviours as you can (30+ independent checks, each printing PASS/FAIL with the
expression and the observed value), run it with python3 from /workspace, and report every FAIL.
Pay special attention to these exact spec claims:
  pq('<html><p>é</p></html>') -> str(xml)=='<html><p>é</p></html>' and
    str(xml('p:contains("é")'))=='<p>é</p>' and type(xml.html()) is str
  pq(xml_str, parser='xml') then d.after(html_with_entities) raises etree.XMLSyntaxError
  pq(html)('img').replace_with('image') then d.__html__() keeps '&amp;dash;'
  pq(object()) raises TypeError; pq(invalid_argument='value') raises ValueError
  d('em').remove('strong') style conditional removal
  a 10000-span document parses and queries quickly
Report the FAILs only, with the exact expression, expected and observed values.`,
  },
  {
    key: 'packaging',
    prompt: `${CONTEXT}\n
TASK: audit the project's non-source files for spec compliance:
 - setup.py: is it a valid, installable setuptools config? does 'python3 setup.py --version'
   print 2.0.2.dev0? does it declare lxml>=2.1, cssselect>=1.2.0 in install_requires and
   requests + pytest (extras are acceptable)? does it include packages, classifiers,
   long_description reading README.rst/CHANGES.rst without crashing? Try
   'cd /tmp && python3 -c "import runpy" ' style safe checks, and
   'cd /workspace && python3 setup.py --version --name --author' (this must not error).
   Also verify a source build works: 'cd /workspace && python3 -m build --help' may be absent;
   instead check 'python3 -c "import setuptools; ..."' or run
   'python3 setup.py check' / 'egg_info' in a COPY of the tree under /tmp so /workspace stays clean
   (copy with cp -a /workspace /tmp/pqcopy first, and only ever run build commands there).
 - pytest.ini / conftest.py / tox.ini / MANIFEST.in / .gitignore / .hgignore / LICENSE.txt /
   CHANGES.rst / README.rst / README_fixt.py: present and coherent? Does the README doctest
   pass? Does MANIFEST.in cover the shipped files?
 - Does 'python3 -m pytest -q' still report 150 passed from /workspace?
 - Is the version consistent between setup.py, pyquery/__init__.py and CHANGES.rst?
Report concrete problems only.`,
  },
];

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'spec_requirement', 'observed', 'repro', 'severity'],
        properties: {
          title: { type: 'string' },
          spec_requirement: { type: 'string' },
          observed: { type: 'string' },
          repro: { type: 'string', description: 'exact python3 snippet demonstrating it' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reason'],
  properties: {
    real: { type: 'boolean' },
    reason: { type: 'string' },
    breaks_official_tests: { type: 'boolean' },
  },
};

phase('Audit')
const results = await pipeline(
  AUDITORS,
  a => agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (res, a) => parallel((res?.findings || []).map(f => () =>
    agent(`${CONTEXT}
You are an adversarial verifier. Another agent reported this finding about /workspace:

TITLE: ${f.title}
SPEC REQUIREMENT: ${f.spec_requirement}
OBSERVED: ${f.observed}
REPRO: ${f.repro}

Try hard to REFUTE it. Run the repro yourself with python3 from /workspace. Decide:
 - real=false if the repro does not reproduce, if the "spec requirement" is not actually
   required by the specification text quoted to you, if the behaviour matches upstream
   pyquery 2.0.x semantics, or if it is a style/preference issue rather than a defect.
 - real=true only if you personally reproduced a concrete deviation.
Also determine breaks_official_tests: would fixing this plausibly break any of the
150 currently passing tests? (run: cd /workspace && python3 -m pytest -q to see the baseline).
Default to real=false when uncertain.`,
      { label: `verify:${a.key}:${f.title.slice(0, 30)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
    .then(v => ({ ...f, area: a.key, verdict: v }))
  )),
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter(f => f.verdict?.real)
log(`audited ${all.length} candidate findings, ${confirmed.length} confirmed`)
return {
  confirmed: confirmed.map(f => ({
    area: f.area, title: f.title, severity: f.severity,
    spec_requirement: f.spec_requirement, observed: f.observed,
    repro: f.repro, suggested_fix: f.suggested_fix,
    breaks_official_tests: f.verdict?.breaks_official_tests,
  })),
  refuted: all.filter(f => !f.verdict?.real).map(f => ({ area: f.area, title: f.title, why: f.verdict?.reason })),
}
