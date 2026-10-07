export const meta = {
  name: 'nominal-scale-categorical-understand',
  description: 'Map how seaborn draws categorical axes and design how so.Nominal should match',
  phases: [
    { title: 'Understand', detail: 'parallel readers over scales, plot, categorical, tests, mpl compat' },
    { title: 'Design', detail: 'independent design proposals for the 3 behaviors' },
    { title: 'Judge', detail: 'score proposals against repo idiom and mpl compat' },
    { title: 'Synthesize', detail: 'single implementation plan with exact edits' },
  ],
}

const READ_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'file:line and a short verbatim snippet' },
        },
        required: ['claim', 'evidence'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings'],
}

const READERS = [
  {
    key: 'scales',
    prompt: `Read /testbed/seaborn/_core/scales.py in full. Report precisely:
- The full class hierarchy and method list of Scale, Nominal, Ordinal, Continuous, Temporal, and PseudoAxis (with line numbers).
- Every hook the base Scale class defines that subclasses override, and whether there is any existing hook called after artists are drawn (e.g. anything named _finalize).
- What PseudoAxis supports and does NOT support (list its methods) — specifically whether it has .grid(), .axes, .axis_name, .get_major_ticks(), .get_gridlines().
- How Nominal._setup sets the view interval and what units_seed/stringify do.
Be exact with line numbers and quote the code.`,
  },
  {
    key: 'plot',
    prompt: `Read /testbed/seaborn/_core/plot.py. Report precisely, with line numbers and quoted code:
- Plotter._setup_scales: how scales are created per variable, what self._scales maps to, how axis objects are obtained, and how a Nominal scale on a coordinate is detected (there is a reference to \`cat_scale\` around line 1240 — quote that whole block and explain it).
- Plotter._finalize_figure in full, and where p._limits is used.
- How p._limits is populated (Plot.limit) and its key format (e.g. "x", "y", "x0"?).
- How subplot dicts (self._subplots entries) map axis keys -> matplotlib axes, and what sub["x"] / sub["y"] contain.
- Anything about theme/rcParams handling relevant to grid display (Plot.theme, _theme_with_defaults).
Quote exactly.`,
  },
  {
    key: 'categorical',
    prompt: `Read /testbed/seaborn/categorical.py (and seaborn/_oldcore.py / seaborn/utils.py if needed). Find EXACTLY how the classic categorical plots achieve these three behaviors, quoting code with file:line:
1. axis limits drawn to +/- 0.5 beyond first/last tick (search for -.5, +.5, set_xlim, set_ylim, "cat_axis").
2. suppressing the grid on the categorical axis (search for grid(False), ax.grid, xaxis.grid).
3. inverting the y axis when the categorical variable is on y (search for invert_yaxis, set_ylim reversed).
Report the exact calls used, including keyword args like auto=None and which="both".`,
  },
  {
    key: 'tests',
    prompt: `Read /testbed/tests/_core/test_scales.py and grep /testbed/tests/_core/test_plot.py. Report:
- Existing test classes/methods for Nominal scales (names + line numbers).
- Test conventions: how they construct a Plot and access axes, how they assert on limits/ticks/gridlines, use of Plot(...).plot() vs .plot()._figure, any helper fixtures.
- Any existing tests that assert on grid visibility or axis inversion anywhere under /testbed/tests (grep for get_gridlines, gridOn, xaxis_inverted, yaxis_inverted, get_xlim).
- Whether tests use \`assert_array_equal\` style helpers and where imported from.
Quote exact snippets with line numbers so new tests can match style.`,
  },
  {
    key: 'compat',
    prompt: `Determine matplotlib compatibility constraints in /testbed:
- Run: python -c "import matplotlib; print(matplotlib.__version__)" and python -c "import seaborn; print(seaborn.__version__)".
- Find the minimum supported matplotlib version (check pyproject.toml, setup.cfg, ci/ requirement files, doc/installing).
- Check whether these APIs exist and behave in the installed mpl: matplotlib.axis.Axis.grid(), Axis.axes, Axis.axis_name, Axis.get_major_ticks(), Axis.get_gridlines(), Axes.set_xlim(..., auto=None). Verify by running short python snippets and report the output.
- Check for existing version-gating idioms in the seaborn codebase (grep for _version_predates or Version( in seaborn/).
Report command outputs verbatim.`,
  },
]

phase('Understand')
const reads = await parallel(READERS.map(r => () =>
  agent(r.prompt, { label: `read:${r.key}`, phase: 'Understand', schema: READ_SCHEMA })
))

const context = READERS.map((r, i) => {
  const res = reads[i]
  if (!res) return `## ${r.key}: (reader failed)`
  const lines = res.findings.map(f => `- ${f.claim}\n  evidence: ${f.evidence}`).join('\n')
  return `## ${r.key}\n${lines}\n${res.notes ? `notes: ${res.notes}` : ''}`
}).join('\n\n')

log(`Collected ${reads.filter(Boolean).length}/${READERS.length} reader reports`)

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    approach_name: { type: 'string' },
    summary: { type: 'string' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          location: { type: 'string', description: 'function/class and approximate line' },
          change: { type: 'string', description: 'exact code to add/modify' },
          rationale: { type: 'string' },
        },
        required: ['file', 'location', 'change'],
      },
    },
    handles_grid: { type: 'string' },
    handles_limits: { type: 'string' },
    handles_inversion: { type: 'string' },
    theme_deference: { type: 'string', description: 'how a user forcing a grid via theme is handled' },
    risks: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'string' } },
  },
  required: ['approach_name', 'summary', 'edits', 'handles_grid', 'handles_limits', 'handles_inversion', 'risks', 'tests'],
}

const ISSUE = `ISSUE (seaborn):
"Nominal scale should be drawn the same way as categorical scales"
Three distinctive things happen on the categorical axis in seaborn's categorical plots:
1. The scale is drawn to +/- 0.5 from the first and last tick, rather than using the normal margin logic
2. A grid is not shown, even when it otherwise would be with the active style
3. If on the y axis, the axis is inverted
It probably makes sense to have so.Nominal scales (including inferred ones) do this too.
Implementation comments from the maintainer:
1. Trickier than you'd think. Suggested approach may be to add an invisible artist with sticky edges and set the margin to 0. Feels like a hack. Maybe setting sticky edges on the spine artist?
2. Probably straightforward in Plotter._finalize_figure. Always a good idea? How do we defer to the theme if the user wants to force a grid? Should the grid be something set in the scale object itself?
3. Probably straightforward but unsure where is best.`

const ANGLES = [
  {
    key: 'scale-hook',
    lens: `Design it with a per-Scale hook: add a no-op _finalize(self, p, axis) to the base Scale class, override it in Nominal, and call it from Plotter._finalize_figure for each axis. Argue for why putting the behavior in the scale object (as the maintainer wonders in comment 2) is the right seam. Handle limits via ax.set_xlim/set_ylim with auto=None using the number of major ticks, y-inversion by swapping lo/hi, and the grid via axis.grid(False, which="both").`,
  },
  {
    key: 'sticky-edges',
    lens: `Design it following the maintainer's literal suggestion in comment 1: invisible artist with sticky edges + zero margin (and/or sticky edges on the spine). Be concrete about the artist, and honestly evaluate the failure modes (shared axes, faceting, pairing, later autoscale calls, interaction with Plot.limit, mpl version differences). If it is worse than direct set_lim, say so explicitly and explain why.`,
  },
  {
    key: 'plotter-central',
    lens: `Design it entirely inside Plotter._finalize_figure with no new Scale API: detect isinstance(scale, Nominal) there and do all three tweaks centrally. Consider how it interacts with Plot.limit overrides, faceting/pairing (multiple subplots sharing an axis key), and the existing cat_scale logic near plot.py:1240. Evaluate against putting the logic in the scale.`,
  },
]

phase('Design')
phase('Judge')
const judged = await pipeline(
  ANGLES,
  a => agent(`${ISSUE}

REPO CONTEXT (gathered by readers — verify anything you rely on by reading the files yourself):
${context}

YOUR ASSIGNED DESIGN LENS: ${a.lens}

Produce a concrete, complete implementation design for the seaborn repo at /testbed. Read the actual files (/testbed/seaborn/_core/scales.py, /testbed/seaborn/_core/plot.py, /testbed/tests/_core/test_scales.py) before proposing edits — your \`change\` fields must be real code that fits this codebase's style, not pseudocode. Cover all three behaviors, plus: inferred Nominal scales (not just explicit so.Nominal), Nominal used for non-coordinate properties (color etc. — must not break), Plot.limit() interaction, faceting/pairing, and shared axes. Also state which tests to add.`,
    { label: `design:${a.key}`, phase: 'Design', schema: DESIGN_SCHEMA }),
  (design, a) => agent(`You are a strict reviewer of a proposed seaborn implementation design. The issue:
${ISSUE}

PROPOSED DESIGN (lens: ${a.key}):
${JSON.stringify(design, null, 2)}

Score it. Read /testbed/seaborn/_core/scales.py and /testbed/seaborn/_core/plot.py to check every claim. Try hard to find where this design breaks: PseudoAxis (used for non-coordinate scales) lacking Axes methods, Nominal for color/marker properties, Plot.limit() overriding, faceting/pairing with shared axes, mpl version compat, tick count before vs after draw, and whether the grid suppression can be overridden by the user's theme. Report concrete failure scenarios with inputs.`,
    { label: `judge:${a.key}`, phase: 'Judge', schema: {
      type: 'object',
      properties: {
        score: { type: 'number', description: '0-10 overall' },
        correctness: { type: 'number' },
        idiomatic_fit: { type: 'number' },
        failure_scenarios: { type: 'array', items: { type: 'string' } },
        best_ideas: { type: 'array', items: { type: 'string' } },
        verdict: { type: 'string' },
      },
      required: ['score', 'failure_scenarios', 'best_ideas', 'verdict'],
    } }).then(v => ({ lens: a.key, design, review: v }))
)

const ok = judged.filter(Boolean)
ok.sort((x, y) => (y.review?.score ?? 0) - (x.review?.score ?? 0))
log(`Scored: ${ok.map(r => `${r.lens}=${r.review?.score}`).join(', ')}`)

phase('Synthesize')
const plan = await agent(`${ISSUE}

Three designs were produced and independently reviewed. Ranked by score:
${JSON.stringify(ok, null, 2)}

REPO CONTEXT:
${context}

Synthesize ONE final implementation plan for /testbed (seaborn). Take the winning design as the base and graft in the best ideas from the others; drop anything a reviewer showed to be broken. Read /testbed/seaborn/_core/scales.py and /testbed/seaborn/_core/plot.py yourself to confirm exact insertion points and current code.

Output must be precise enough to apply mechanically: for each edit give the file, the exact anchor code that exists today, and the exact replacement/addition. Also list the exact tests to add (file, test name, body sketch) matching existing test style. Explicitly resolve: (a) does the grid suppression respect a user theme forcing a grid — recommend a decision and justify it; (b) how Plot.limit() interacts; (c) PseudoAxis safety for non-coordinate Nominal scales; (d) faceting/pairing.`,
  { phase: 'Synthesize', effort: 'high', schema: {
    type: 'object',
    properties: {
      plan_summary: { type: 'string' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            anchor: { type: 'string' },
            replacement: { type: 'string' },
            why: { type: 'string' },
          },
          required: ['file', 'anchor', 'replacement'],
        },
      },
      tests_to_add: {
        type: 'array',
        items: {
          type: 'object',
          properties: { file: { type: 'string' }, name: { type: 'string' }, body: { type: 'string' } },
          required: ['file', 'name', 'body'],
        },
      },
      decisions: { type: 'string' },
      open_risks: { type: 'array', items: { type: 'string' } },
    },
    required: ['plan_summary', 'edits', 'tests_to_add', 'decisions'],
  } })

return { plan, scores: ok.map(r => ({ lens: r.lens, score: r.review?.score, verdict: r.review?.verdict })) }
