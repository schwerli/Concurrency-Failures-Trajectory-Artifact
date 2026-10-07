export const meta = {
  name: 'offsettext-labelcolor-investigate',
  description: 'Investigate all code paths affecting offsetText color vs tick labelcolor in matplotlib',
  phases: [
    { title: 'Explore', detail: 'parallel readers over axis.py lifecycle, other offsetText sites, tests, rcParams' },
    { title: 'Synthesize', detail: 'merge into one implementation plan' },
  ],
}

const REPO = '/testbed'

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          lines: { type: 'string' },
          what: { type: 'string' },
          relevance: { type: 'string' },
        },
        required: ['file', 'lines', 'what', 'relevance'],
      },
    },
  },
  required: ['summary', 'findings'],
}

phase('Explore')

const LENSES = [
  {
    key: 'lifecycle',
    prompt: `In the matplotlib repo at ${REPO}, read lib/matplotlib/axis.py carefully and map the FULL lifecycle of \`Axis.offsetText\` color:
1. Where offsetText is created (Axis.__init__ ~line 675) and where its visual defaults are set: XAxis._init (~2237) and YAxis._init (~2496) — currently \`color=mpl.rcParams['xtick.color']\` / \`['ytick.color']\`.
2. \`Axis.clear()\` and \`Axis._reset_visual_defaults()\` (~line 880) — what happens to offsetText on clear? Does it call _init again? Quote the code.
3. \`Axis.set_tick_params\` / \`_translate_tick_params\` (~lines 940-1090). Note line ~966-972 where 'labelcolor' in kwtrans -> self.offsetText.set_color(kwtrans['labelcolor']). Does _translate_tick_params resolve 'inherit' for labelcolor? Look at line ~1085 (\`kwtrans['labelcolor'] = c\`) and the surrounding block — quote it exactly.
4. \`Tick.__init__\` labelcolor='inherit' resolution (~lines 122-127).
5. Any place that reads rcParams for offsetText fontsize/color.
Report exact line numbers and quoted code for each. Also state whether set_tick_params(labelcolor='inherit') currently sets offsetText to the literal string 'inherit' (a bug?) or resolves it.`,
  },
  {
    key: 'other-sites',
    prompt: `In the matplotlib repo at ${REPO}, search the WHOLE codebase (lib/matplotlib, lib/mpl_toolkits, and galleries/examples if present) for every other place that constructs or recolors an offset text / exponent label. Specifically grep for: offsetText, offset_text, get_offset_text, set_offset_text, xtick.color, ytick.color, xtick.labelcolor, ytick.labelcolor, labelcolor.
Cover at minimum: lib/mpl_toolkits/mplot3d/axis3d.py, lib/mpl_toolkits/axisartist/*, lib/matplotlib/axes/_secondary_axes.py, lib/matplotlib/colorbar.py, lib/matplotlib/rcsetup.py, lib/matplotlib/style/core.py.
For each hit, report file, line numbers, quoted code, and whether it would ALSO need the labelcolor-inherit fix or is unaffected. Be exhaustive — do not stop at the first few hits.`,
  },
  {
    key: 'tests',
    prompt: `In the matplotlib repo at ${REPO}, find ALL existing tests that touch tick labelcolor, xtick.color/ytick.color rcParams, or offset text color. Grep lib/matplotlib/tests/ for: labelcolor, offsetText, get_offset_text, 'xtick.color', 'ytick.color', tick_params.
Report: file paths, test function names, line numbers, and quote the 2-3 most relevant tests in full so I can match their style. Note in particular any test named like test_tick_label_color, test_tick_params*, test_offset_text*, and any image-comparison (baseline image) tests that could break if offset text color changes. Also state which test file is the right home for a new test about rcParams['ytick.labelcolor'] affecting the offset text (test_axes.py? test_rcparams.py? test_ticker.py?), with reasoning based on where similar tests live.`,
  },
  {
    key: 'rcparams',
    prompt: `In the matplotlib repo at ${REPO}, investigate the rcParam definitions for xtick.labelcolor / ytick.labelcolor:
1. lib/matplotlib/rcsetup.py — find the validator for these (likely validate_color_or_inherit). Quote it and the entries in _validators.
2. lib/matplotlib/mpl-data/matplotlibrc — quote the xtick.labelcolor / ytick.labelcolor lines and their comments.
3. lib/matplotlib/mpl-data/stylelib/*.mplstyle — do any styles set *tick.labelcolor?
4. Check doc/users/next_whats_new/ and doc/api/next_api_changes/ directories — do they exist in this repo, what is the file naming convention, and is a changelog entry conventional for a bugfix like this? Look at git log for recent bugfix commits to see whether they add such entries.
5. Confirm the exact semantics of 'inherit': it means "inherit from {x,y}tick.color".
Report exact quoted text and paths.`,
  },
]

const results = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `explore:${l.key}`, phase: 'Explore', schema: FINDINGS })
))

const good = results.filter(Boolean)
log(`explored ${good.length}/${LENSES.length} lenses`)

phase('Synthesize')

const PLAN = {
  type: 'object',
  properties: {
    rootCause: { type: 'string' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          anchor: { type: 'string', description: 'exact existing code to replace' },
          replacement: { type: 'string', description: 'exact new code' },
          rationale: { type: 'string' },
        },
        required: ['file', 'anchor', 'replacement', 'rationale'],
      },
    },
    testPlan: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['rootCause', 'edits', 'testPlan', 'risks', 'openQuestions'],
}

const plan = await agent(
  `You are synthesizing an implementation plan for this matplotlib bug at ${REPO}:

BUG: rcParams['ytick.labelcolor'] / ['xtick.labelcolor'] do not affect the color of the axis offset text (the "1e9" exponent label). It is always colored from {x,y}tick.color. Expected: when labelcolor != 'inherit', the offset text should use labelcolor.

Here are exhaustive exploration findings from four parallel readers:

${good.map((r, i) => `### Lens ${LENSES[i].key}\n${JSON.stringify(r, null, 2)}`).join('\n\n')}

Produce a precise, minimal, upstream-quality plan. Requirements:
- The fix must live in XAxis._init and YAxis._init in lib/matplotlib/axis.py.
- Give EXACT anchor/replacement strings (must match the file byte-for-byte for the anchor).
- Consider whether set_tick_params(labelcolor='inherit') also needs handling in _translate_tick_params (does it currently push the literal string 'inherit' onto offsetText/labels?). If the exploration shows _translate_tick_params already resolves 'inherit', say so and do NOT add redundant code.
- Prefer matching upstream matplotlib style. Note the real upstream fix used:
      color=mpl.rcParams['xtick.labelcolor'] if mpl.rcParams['xtick.labelcolor'] != 'inherit' else mpl.rcParams['xtick.color']
  Evaluate whether that exact form is best, or whether a cleaner form is warranted.
- Decide whether mplot3d/axisartist need parallel changes (justify with evidence from the findings).
- testPlan: name the exact test file, test function name, and sketch the test body in the style of neighbouring tests.
- Do NOT write any files. Plan only.`,
  { label: 'synthesize-plan', phase: 'Synthesize', schema: PLAN, effort: 'high' }
)

return { plan, lenses: good }
