export const meta = {
  name: 'subfigure-legend-investigate',
  description: 'Audit matplotlib Legend/Figure code for SubFigure-parent support and synthesize a minimal fix plan',
  phases: [
    { title: 'Investigate', detail: 'parallel audits of legend.py, figure.py, callers, tests/docs, plus empirical monkeypatch run' },
    { title: 'Synthesize', detail: 'merge findings into one exact-edit plan' },
  ],
}

const REPO = `Repo: /testbed (matplotlib source checkout, editable install).
Python interpreter WITH matplotlib installed: /opt/miniconda3/envs/testbed/bin/python
Always use that interpreter, always set MPLBACKEND=Agg for scripts, and write temp scripts under /tmp.

The bug being fixed:
    import matplotlib.pyplot as plt
    subfig = plt.figure().subfigures()
    ax = subfig.subplots()
    ax.plot([0, 1, 2], [0, 1, 2], label="test")
    subfig.legend()   # TypeError: Legend needs either Axes or Figure as parent

Root cause candidate: lib/matplotlib/legend.py Legend.__init__ lines ~433-442 checks
isinstance(parent, Figure) instead of isinstance(parent, FigureBase); SubFigure subclasses
FigureBase but not Figure. Note legend.py imports Axes/Figure LOCALLY inside __init__ (~line 362-363).

DO NOT modify any file under /testbed/lib or /testbed/lib/matplotlib/tests in this phase.
This is a read-only investigation phase (temp scripts in /tmp are fine).`

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string', description: '3-6 sentence conclusion' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'lines', 'what', 'breaks_for_subfigure', 'recommendation'],
        properties: {
          file: { type: 'string' },
          lines: { type: 'string' },
          what: { type: 'string', description: 'what the code does / which parent attribute it relies on' },
          breaks_for_subfigure: { type: 'string', enum: ['yes', 'no', 'unclear'] },
          recommendation: { type: 'string', description: 'exact change needed, or "no change needed" with the reason' },
        },
      },
    },
  },
}

phase('Investigate')

const TASKS = [
  {
    label: 'legend-internals',
    prompt: `${REPO}

TASK: Exhaustively audit lib/matplotlib/legend.py for every assumption that the legend's
parent is an Axes or a top-level Figure. Read the WHOLE file (it is ~1300 lines), do not skim.

For EVERY use of self.parent, self.figure, self.isaxes, self.axes, parent.bbox,
self.get_transform(), set_figure(), _set_artist_props, get_bbox_to_anchor,
set_bbox_to_anchor, _findoffset, _find_best_position, _get_anchored_bbox, get_window_extent,
contains, draw, set_draggable/DraggableLegend, and the module-level _parse_legend_args:
determine whether it still behaves correctly when parent is a SubFigure.

Specifically answer, with line numbers and quoted code:
1. Does self.set_figure(parent) with a SubFigure parent work? What does Artist.set_figure do
   (read lib/matplotlib/artist.py), and what becomes of legend.figure? Is legend.figure ==
   subfigure acceptable, given other artists in a subfigure also have .figure == subfigure?
   Check whether anything in legend.py needs the *canvas* / top-level figure (e.g.
   self.figure.canvas, self.figure.dpi, get_window_extent, _get_dpi, savefig paths) and
   whether SubFigure provides it (read the SubFigure class in lib/matplotlib/figure.py,
   ~line 1924-2110: does it have .canvas, .dpi, .bbox, .transSubfigure, .stale?).
2. get_bbox_to_anchor()/set_bbox_to_anchor(): with a SubFigure parent, what bbox is used by
   default? Is it the subfigure's bbox (desired) or the whole figure's?
3. DraggableLegend (top of file, ~lines 60-110): the non-axes branch. Does it work for a
   SubFigure? Quote the code and reason about the transform used.
4. Any isinstance() checks, docstrings, or error messages in legend.py that say "Figure" and
   should mention FigureBase/SubFigure.
5. _parse_legend_args (~line 1160-1230) as called from FigureBase.legend with self.axes.

Return every location as a finding.`,
  },
  {
    label: 'figure-side',
    prompt: `${REPO}

TASK: Audit lib/matplotlib/figure.py for the figure-side half of SubFigure legend support.
Read the whole FigureBase class, the SubFigure class, and the Figure class parts that matter.

Answer with line numbers and quoted code:
1. FigureBase.legend (~line 941-1073): does it work as-is for a SubFigure? Check
   'self.axes' on a SubFigure (what does SubFigure.axes return? ~line 2084), self.legends,
   self.transSubfigure, and the bbox_transform default.
2. Are subfigure legends actually DRAWN? Trace SubFigure.draw and FigureBase.draw: is
   self.legends included in the artists that get drawn? Quote the draw methods. If subfigure
   legends are NOT drawn, that is a second bug that must be fixed for the feature to work.
3. get_default_bbox_extra_artists (~line 232 and ~297): does it collect legends of
   subfigures for savefig(bbox_inches='tight')? Trace the recursion into self.subfigs.
4. Layout: does constrained_layout / tight_layout special-case figure legends
   (grep for 'legends' in lib/matplotlib/_constrained_layout.py, _tight_layout.py,
   tight_bbox.py, and figure.py)? Anything that assumes fig.legends belongs to a top Figure?
5. Anything else in figure.py that would misbehave: e.g. SubFigure.__init__ setting
   self.legends, stale propagation, clip/artist transform in add_artist (~line 500-530).

Empirically confirm claim (2): write /tmp/probe_draw.py that builds a subfigure, appends a
plain Text or Rectangle artist via subfig.add_artist, and also directly constructs a legend
bypassing the isinstance guard with this surgical monkeypatch:

    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt, matplotlib.figure as mf
    fig = plt.figure(); subfig = fig.subfigures(); ax = subfig.subplots()
    ax.plot([0,1,2],[0,1,2], label='test')
    orig = mf.Figure
    mf.Figure = mf.FigureBase        # legend.py imports Figure locally inside __init__
    try:
        leg = subfig.legend()
    finally:
        mf.Figure = orig             # restore immediately
    print('legend created:', leg, 'in subfig.legends:', subfig.legends)
    fig.savefig('/tmp/probe_draw.png')

Then verify whether the legend visually rendered (check the PNG is non-trivial; you may also
compare pixel sums against a run with no legend, or use
leg.get_window_extent(fig.canvas.get_renderer()) and compare to subfig.bbox / fig.bbox).
Report exactly what happened, including whether the legend is positioned relative to the
SUBFIGURE bbox (correct) or the whole figure bbox.`,
  },
  {
    label: 'callers-audit',
    prompt: `${REPO}

TASK: Sweep the whole of lib/matplotlib (and lib/mpl_toolkits) for OTHER code that would
break or behave inconsistently once Legend accepts a SubFigure parent. Be exhaustive; use
grep with several different angles, not one.

Angles to run (at minimum):
- grep -rn "isinstance(.*Figure)" lib/ and review each hit: which should be FigureBase?
- grep -rn "Legend(" lib/ : every construction site of Legend.
- grep -rn "\\.legends" lib/ : every consumer of the figure legends list.
- grep -rn "isaxes" lib/ : every consumer of Legend.isaxes.
- grep -rn "legend" lib/matplotlib/offsetbox.py lib/matplotlib/artist.py
  lib/matplotlib/_tight_bbox.py lib/matplotlib/tight_bbox.py lib/matplotlib/backend_bases.py
  lib/matplotlib/_constrained_layout.py lib/matplotlib/_tight_layout.py
- grep -rn "get_default_bbox_extra_artists\\|bbox_extra_artists" lib/
- Also check lib/matplotlib/pyplot.py figlegend, and lib/matplotlib/axes/_axes.py legend.

For each hit, say whether it needs changing for this fix, and why/why not. Flag anything that
would silently produce a WRONG result (e.g. wrong coordinate system, legend not drawn, legend
missed by tight bbox) rather than an exception. Return every reviewed location as a finding
(group trivially-irrelevant hits into one finding to stay readable, but do not omit real risks).`,
  },
  {
    label: 'tests-and-docs',
    prompt: `${REPO}

TASK: Determine exactly where and how to add tests + docs for this fix, following THIS repo's
conventions (matplotlib 3.5-dev era). Read real examples, do not guess.

1. Find existing tests that touch figure legends and subfigures:
   grep -rn "legend" lib/matplotlib/tests/test_figure.py ;
   grep -rn "subfigure\\|subfigures" lib/matplotlib/tests/*.py ;
   and scan lib/matplotlib/tests/test_legend.py structure (imports, fixtures,
   @image_comparison vs @check_figures_equal vs plain asserts, matplotlib.testing decorators).
2. Is there any existing test asserting the exact TypeError message
   "Legend needs either Axes or Figure as parent"? grep for it in lib/ and doc/. If the message
   changes, list every place that must be updated.
3. Recommend the precise test to add: which FILE, which style (a plain smoke test asserting
   the legend exists and is in subfig.legends, vs image comparison), and give the exact test
   function source code you would add, matching the file's surrounding style (naming, decorator
   usage, imports already present). Prefer a small deterministic non-image test.
4. Docs: check doc/users/next_whats_new/ and doc/api/next_api_changes/ — do they exist in this
   checkout, what is the file-naming convention, and is a whats-new entry warranted for
   "legend on SubFigure now works"? Show an example existing entry's format.
   Also check doc/api/legend_api.rst / figure_api.rst and the legend docstring parameter docs
   (lib/matplotlib/legend.py ~lines 130-260 _legend_kw_doc) for text saying "Figure" that
   should mention subfigures.
5. Report how to RUN the relevant tests (exact pytest command with the testbed interpreter).`,
  },
  {
    label: 'empirical-repro',
    prompt: `${REPO}

TASK: Empirically characterize the bug and the behavior of the candidate fix WITHOUT editing
any repo file. Use the surgical monkeypatch (matplotlib.figure.Figure = FigureBase, restored
immediately after the Legend is constructed) described below.

1. Reproduce the exact failure: run the repro script, capture the full traceback and confirm
   the failing line/message in this checkout.
2. Then run this and report everything:

    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt, matplotlib.figure as mf, numpy as np
    fig = plt.figure()
    subfigs = fig.subfigures(1, 2)
    for i, sf in enumerate(subfigs):
        ax = sf.subplots()
        ax.plot([0,1,2],[0,1,2], label=f'test{i}')
    orig = mf.Figure; mf.Figure = mf.FigureBase
    try:
        legs = [sf.legend() for sf in subfigs]
    finally:
        mf.Figure = orig
    fig.canvas.draw()
    r = fig.canvas.get_renderer()
    for sf, leg in zip(subfigs, legs):
        print('leg.figure is subfig:', leg.figure is sf, '| leg.parent is subfig:', leg.parent is sf)
        print('legend window extent:', leg.get_window_extent(r))
        print('subfig bbox:', sf.bbox, '| fig bbox:', fig.bbox)
        print('in sf.legends:', leg in sf.legends, '| in fig.legends:', leg in fig.legends)
    fig.savefig('/tmp/two_subfig_legends.png')

   CRITICAL question: is each legend anchored to its OWN subfigure's bbox (so the two legends
   land in different places, one per subfigure) or to the whole figure (both in the same
   corner)? Prove it numerically from the window extents, and by rendering. Read the saved PNG
   with the Read tool to visually confirm two separate legends appear, one in each subfigure.
3. Test that the drawn output actually contains the legend: compare
   np.asarray(buffer) pixel content of a run with vs without the legend (same figure otherwise),
   and report whether the legend pixels are present.
4. Also exercise: savefig(bbox_inches='tight'), constrained_layout=True figure with subfigure
   legend, loc='upper left', bbox_to_anchor=(0,0,1,1) explicitly, and a nested subfigure
   (subfig.subfigures()) legend. Report any exception or visibly wrong placement.
5. Report whether 'best' loc is rejected for subfigure legends (it is rejected for figure
   legends) and whether that behavior is consistent.`,
  },
]

const investigations = await parallel(TASKS.map(t => () =>
  agent(t.prompt, { label: t.label, phase: 'Investigate', schema: FINDINGS })
    .then(r => ({ area: t.label, ...r }))
))

const ok = investigations.filter(Boolean)
log(`${ok.length}/${TASKS.length} investigations returned`)

phase('Synthesize')

const PLAN = {
  type: 'object',
  additionalProperties: false,
  required: ['diagnosis', 'edits', 'test_plan', 'risks', 'verification_commands'],
  properties: {
    diagnosis: { type: 'string' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'anchor', 'change', 'rationale', 'required'],
        properties: {
          file: { type: 'string' },
          anchor: { type: 'string', description: 'exact existing code to locate the edit' },
          change: { type: 'string', description: 'exact replacement code' },
          rationale: { type: 'string' },
          required: { type: 'string', enum: ['required', 'recommended', 'optional'] },
        },
      },
    },
    test_plan: { type: 'string', description: 'exact test file + full test function source' },
    risks: { type: 'array', items: { type: 'string' } },
    verification_commands: { type: 'array', items: { type: 'string' } },
  },
}

const plan = await agent(`${REPO}

You are synthesizing five independent investigations into ONE minimal, correct fix plan for
"Adding a legend to a SubFigure doesn't work".

Investigation results (JSON):
${JSON.stringify(ok, null, 2)}

Rules for the plan:
- MINIMAL and idiomatic: this is an upstream-style bugfix. Prefer the smallest change that makes
  subfigure legends work correctly (create + draw + correct anchoring + tight bbox), matching
  how matplotlib itself would fix it. Do not refactor unrelated code.
- Every edit must be justified by a concrete failure, not by speculation. Mark speculative
  edits 'optional' and say what would confirm them.
- If two investigations disagree, resolve it by reading the code yourself (you have tools) and
  state the resolution explicitly.
- Verify each 'anchor' string actually exists in the file at the stated location before
  including it — read the files.
- Include the error-message wording change and every place that message is asserted.
- test_plan must contain the complete source of the test function(s) to add, in the repo's
  existing style, plus the file to add them to.

Return the structured plan.`, { label: 'synthesize-plan', phase: 'Synthesize', schema: PLAN, effort: 'high' })

return { investigations: ok, plan }
