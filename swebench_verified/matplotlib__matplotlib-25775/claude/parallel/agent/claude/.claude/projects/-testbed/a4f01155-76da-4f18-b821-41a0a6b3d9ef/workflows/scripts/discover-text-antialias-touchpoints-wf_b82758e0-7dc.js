export const meta = {
  name: 'discover-text-antialias-touchpoints',
  description: 'Exhaustively map every code/test/doc site involved in adding get/set_antialiased to Text',
  phases: [
    { title: 'Sweep', detail: 'parallel readers over backends, mathtext, text.py, stubs, tests, docs' },
    { title: 'Critic', detail: 'completeness critic: what modality/file was missed' },
  ],
}

const REPO = '/testbed'
const PY = '/opt/miniconda3/envs/testbed/bin/python'

const SITE_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'repo-relative path' },
          lines: { type: 'string', description: 'line numbers or range' },
          what: { type: 'string', description: 'exact current code / signature' },
          why: { type: 'string', description: 'why it must (or must not) change for per-Text antialiasing' },
          change: { type: 'string', description: 'concrete proposed change, or "no change needed" with reason' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['file', 'lines', 'what', 'why', 'change', 'confidence'],
      },
    },
    notes: { type: 'string', description: 'anything surprising, constraints, backcompat hazards' },
  },
  required: ['findings', 'notes'],
}

const COMMON = `
You are investigating the matplotlib repo at ${REPO} (version 3.8.0.dev, editable install; the interpreter is ${PY}).

GOAL of the overall change (matplotlib feature request):
  Add \`get_antialiased\`/\`set_antialiased\` to \`matplotlib.text.Text\` so antialiasing is a per-artist
  property instead of always reading the global \`rcParams["text.antialiased"]\`. The plan is that
  \`Text.draw\` will push its value onto the GraphicsContext (\`gc.set_antialiased(...)\`), and backends
  will read \`gc.get_antialiased()\` instead of \`mpl.rcParams["text.antialiased"]\`.

Your job is DISCOVERY ONLY. Do not edit any files. Read code carefully and report precise,
verified facts with file paths and line numbers. Quote real code, never guess at it.
Be exhaustive within your assigned area. Flag backcompat hazards and public-API implications.
`

const AREAS = [
  {
    key: 'agg-and-gc',
    prompt: `${COMMON}
YOUR AREA: the Agg backend and the GraphicsContext plumbing.
- lib/matplotlib/backends/backend_agg.py: draw_text, draw_mathtext, _prepare_font, get_text_width_height_descent, and the GraphicsContextBase subclass used there. How is antialiasing passed to the C++ extension today?
- lib/matplotlib/backend_bases.py: GraphicsContextBase._antialiased, get_antialiased, set_antialiased, copy_properties. Note the "use ints not bools for extension code" comment — investigate whether the C++ side (src/*.cpp, src/*.h) reads gc.antialiased and what type it needs. Check src/_backend_agg_wrapper.cpp / src/_backend_agg.h / src/py_converters.cpp and src/ft2font_wrapper.cpp (draw_glyphs_to_bitmap / draw_glyph_to_bitmap antialiased arg).
- Does RendererAgg.draw_text_image or the FT2Font path care?
- Does any code rely on gc.get_antialiased() being an int for TEXT drawing vs LINE drawing? Note that GraphicsContextBase._antialiased is currently shared between line/patch antialiasing and would now also carry text antialiasing — is that a conflict in practice (is the same gc ever reused for both a path and text)?
Report every site that must change, with exact current code.`,
  },
  {
    key: 'mathtext',
    prompt: `${COMMON}
YOUR AREA: mathtext rasterization.
- lib/matplotlib/_mathtext.py: the \`to_raster\` method (around line 100-140) using mpl.rcParams['text.antialiased'], plus VectorParse/RasterParse namedtuples and \`ship\`.
- lib/matplotlib/mathtext.py: MathTextParser.parse and its caching (_parse_cache / functools.lru_cache), math_to_image, MathTextParser.__init__ output types ('path', 'raster', 'macosx', ...).
- Trace EVERY caller of MathTextParser.parse across the whole repo (grep for mathtext_parser.parse, MathTextParser(...).parse, _mathtext.math_to_image) including backends, textpath.py, and tests.
- CRITICAL: parse() results are CACHED. If antialiased becomes a parameter, how must the cache key change? Show the exact caching code and the exact signature change needed. Is the cache keyed on (s, dpi, prop) today? What is the decorator?
- Does 'path'/'vector' output need the antialiased flag at all, or only 'raster'?
Report exact code and the precise signature changes needed.`,
  },
  {
    key: 'text-artist',
    prompt: `${COMMON}
YOUR AREA: the Text artist itself and its subclasses.
- lib/matplotlib/text.py: __init__ signature, _reset_visual_defaults (note it is called by other classes too — find those callers!), update_from, draw, __getstate__, and the docstring/kwdoc machinery.
- Who else calls _reset_visual_defaults? (grep the whole repo — e.g. offsetbox? table? axis?) They must pass the new parameter or it must be defaulted.
- Text subclasses: Annotation, _AnnotationBase, TextWithDash (if present), matplotlib.offsetbox.TextArea, matplotlib.table.Cell, matplotlib.axis tick labels, mpl_toolkits — do any construct Text and need the kwarg forwarded?
- How does %(Text:kwdoc)s / artist kwdoc auto-doc work — will a new set_antialiased automatically appear? Check lib/matplotlib/artist.py kwdoc/ArtistInspector and whether a matching getter is required.
- Does Artist already define get/set_antialiased (i.e. would Text be overriding)? Check lib/matplotlib/artist.py and lib/matplotlib/lines.py / patches.py / collections.py for the established naming+docstring convention for set_antialiased (parameter name 'b' vs 'aa' vs 'antialiased', docstring format, type).
- lib/matplotlib/text.pyi (type stubs) — report its exact current content for Text.__init__ and where new stubs must be added. Also check lib/matplotlib/backend_bases.pyi and lib/matplotlib/mathtext.pyi / _mathtext.pyi if they exist.
Report exact code.`,
  },
  {
    key: 'other-backends',
    prompt: `${COMMON}
YOUR AREA: ALL backends other than Agg. For each, determine whether text antialiasing is expressible and whether it currently reads rcParams["text.antialiased"].
Examine: backend_cairo.py (draw_text + _draw_mathtext + get_text_width_height_descent), backend_pdf.py, backend_ps.py, backend_svg.py, backend_pgf.py, backend_macosx.py (and src/_macosx.m), backend_template.py, backend_qt*.py, backend_gtk*.py, backend_tk*.py, backend_wx.py, backend_webagg*.py, backend_mixed.py, and lib/matplotlib/backends/_backend_pdf_ps.py.
Also check lib/matplotlib/textpath.py (TextToPath) and lib/matplotlib/patheffects.py (PathEffectRenderer — does it forward gc state correctly for draw_text? Check its draw_path/draw_text/_update_gc).
For each file: quote the current relevant code and say exactly what should change (or explicitly "no change: vector backend, antialiasing is a viewer concern").
Pay special attention to backend_cairo's mathtext path and to whether macosx passes antialiasing through.`,
  },
  {
    key: 'tests-and-docs',
    prompt: `${COMMON}
YOUR AREA: tests, docs, and rcParams surface.
- lib/matplotlib/tests/test_text.py: quote the FULL existing antialiasing test (around line 187) verbatim, plus how it is parameterized/decorated.
- Find any other test touching text antialiasing (grep antialias across lib/matplotlib/tests, including test_backend_cairo, test_mathtext, test_agg, test_artist, test_rcparams).
- lib/matplotlib/tests/test_artist.py or test_getattr / test_api: is there a test that enumerates artist getters/setters (e.g. test_set_alias, ArtistInspector-based, or the "get/set consistency" test in test_artist.py)? Would adding set_antialiased to Text break or require updating any such test? Look for tests asserting the full list of Text properties (e.g. test_text.py::test_get_setters or lib/matplotlib/tests/test_artist.py::test_properties).
- doc/api/next_api_changes/ and doc/users/next_whats_new/: quote 2 recent examples of the file format/naming convention so a new entry can match exactly. List the existing files in doc/users/next_whats_new/.
- lib/matplotlib/mpl-data/matplotlibrc and doc rcParams docs: quote the text.antialiased line and its comment. Should the comment be updated to mention the per-Text override?
- galleries/ or doc/ mentions of text.antialiased worth updating.
Report exact verbatim content for the test and doc conventions.`,
  },
  {
    key: 'upstream-shape',
    prompt: `${COMMON}
YOUR AREA: determine the IDIOMATIC matplotlib shape for this API by studying existing precedent in this exact checkout.
1. How do other artists implement antialiasing? Quote Line2D.set_antialiased, Patch.set_antialiased, Collection.set_antialiased, and their getters + docstrings + how they default from rcParams (e.g. rcParams['lines.antialiased']). Note the parameter name each uses and the numpydoc "Parameters" block format.
2. How do other Text properties that default from an rcParam handle None (e.g. Text.set_usetex which does \`if usetex is None: self._usetex = rcParams['text.usetex']\`)? Quote it. Should Text.set_antialiased(None) mean "fall back to rcParam", or should the rcParam only be consulted at __init__ time? Argue both and recommend one, considering: (a) what happens if a user changes rcParams after creating the Text, (b) consistency with set_color (which resolves the rcParam in _reset_visual_defaults, not in the setter), (c) pickling.
3. Check git log/history for any partially-landed work: \`git log --oneline --all -S"text.antialiased" -- lib/\` and \`git log --oneline -20\`. Report anything relevant.
4. Check whether \`Text\` already inherits a get_antialiased from Artist (which would change whether this is an override).
Give a firm recommendation on: the __init__ kwarg name and default, the setter parameter name, whether None is accepted, and whether the rcParam is read at construction or at draw time.`,
  },
]

phase('Sweep')
const results = await parallel(AREAS.map(a => () =>
  agent(a.prompt, { label: `sweep:${a.key}`, phase: 'Sweep', schema: SITE_SCHEMA })
    .then(r => ({ area: a.key, ...r }))
))

const good = results.filter(Boolean)
log(`swept ${good.length}/${AREAS.length} areas, ${good.reduce((n, r) => n + (r.findings?.length || 0), 0)} findings`)

const digest = good.map(r =>
  `## AREA ${r.area}\n` +
  (r.findings || []).map(f => `- ${f.file}:${f.lines} [${f.confidence}]\n  now: ${f.what}\n  why: ${f.why}\n  change: ${f.change}`).join('\n') +
  `\nNOTES: ${r.notes}`
).join('\n\n')

phase('Critic')
const critics = await parallel([
  `You are a completeness critic. Below is a discovery digest for adding per-Text antialiasing to matplotlib at ${REPO}.
Find what is MISSING: a file that reads text antialiasing that nobody listed, a caller that would break, a stub file, a test that enumerates properties, a cache that would return stale results, a backend that silently ignores the flag.
VERIFY by reading the repo yourself with grep/Read — do not trust the digest. Report only gaps you confirmed by reading code.
DIGEST:\n${digest}`,
  `You are an adversarial API reviewer for matplotlib core. Below is a discovery digest for adding per-Text antialiasing.
Attack the plan: where would routing text antialiasing through GraphicsContextBase._antialiased (the SAME attribute used for line/patch antialiasing) cause a real bug? Consider: Text.draw creating a fresh gc vs reusing one; the bbox FancyBboxPatch drawn from Text.draw; path effects (PathEffectRenderer); the gc used by draw_tex; collections/quadmesh; backends that cache gc state; the int-vs-bool contract with C++ extension code.
VERIFY each concern by reading actual code at ${REPO}. Report only concerns you can substantiate with a file:line, plus the mitigation.
DIGEST:\n${digest}`,
  `You are a test-design specialist for matplotlib. Given the digest below, specify the EXACT tests that should be written for per-Text antialiasing, matching this repo's existing conventions (read lib/matplotlib/tests/test_text.py and test_backend_cairo.py yourself).
Cover: default from rcParam, explicit True/False via kwarg and setter, that the RENDERED PIXELS actually differ (how do existing tests assert this? quote the mechanism), mathtext path, cairo path, and that rcParams changes after construction behave as designed.
Give concrete runnable pytest code, using the interpreter ${PY}.
DIGEST:\n${digest}`,
].map((p, i) => () => agent(p, { label: `critic:${['gaps', 'adversarial', 'tests'][i]}`, phase: 'Critic' })))

return {
  areas: good,
  criticGaps: critics[0],
  criticAdversarial: critics[1],
  testPlan: critics[2],
}
