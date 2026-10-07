export const meta = {
  name: 'echarts-req-research',
  description: 'Research each remaining ECharts requirement and produce a precise implementation plan',
  phases: [
    { title: 'Research', detail: 'one agent per requirement, read-only code mapping' },
  ],
}

const SLUGS = [
  'axis-min-max-nullable',
  'axislabel-formatter-index',
  'axislabel-formatter-indexing',
  'bar-zero-size-labels',
  'candlestick-series-encode-render',
  'cartesian-small-number-rounding',
  'darkmode-lightness-algorithm',
  'datazoom-single-point-position',
  'gauge-progress-auto-color',
  'graph-nodescaleratio-type',
  'jitter-overlap-avoidance',
  'label-layout-margin',
  'labelline-smooth-reset',
  'line-areastyle-empty-dimension',
  'lines-loop-symbol-flip',
  'logscale-negative-exponent-rounding',
  'marker-z-option',
  'matrix-darkmode-colors',
  'matrix-dimension-length',
  'matrix-label-api',
  'matrix-label-formatter',
  'parallel-axis-extent',
  'pie-tangential-noflip',
  'radar-blur-itemstyle',
  'radar-clockwise-option',
  'radar-style-precedence',
  'release-6-0-0-rc1',
  'release-merge-master',
  'seriesdata-each-example',
  'slider-handlelabel-optional',
  'sunburst-root-label-centering',
  'time-axis-customvalues-formatter',
  'toolbox-dataview-darkmode',
  'toolbox-emphasis-color',
  'tooltip-listener-unbinding',
  'typescript-esm-compatibility',
  'typescript-export-types',
  'typo-cleanup',
  'visualmap-darkmode-inrange',
  'visualmap-unbounded-range',
]

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    summary: { type: 'string', description: 'What the change must accomplish, 1-3 sentences' },
    files: {
      type: 'array',
      description: 'Repo-relative file paths that must be edited, most important first',
      items: { type: 'string' },
    },
    steps: {
      type: 'array',
      description: 'Concrete edit instructions. Each step names a file, a function/symbol with line numbers, and exactly what to change (quote current code and the replacement idea).',
      items: { type: 'string' },
    },
    risks: { type: 'string', description: 'Anything ambiguous, or code that other requirements also touch' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['slug', 'summary', 'files', 'steps', 'risks', 'confidence'],
}

const results = await parallel(SLUGS.map(slug => () => agent(
  `You are researching ONE change request in the Apache ECharts repository at /workspace (version 6.0.0-beta.1, TypeScript source under /workspace/src).

Read the requirement file: /workspace/requirements/${slug}.yaml

Your job is READ-ONLY research. Do NOT edit any files. Produce a precise, actionable implementation plan that another engineer can execute without re-reading the whole codebase.

Method:
1. Read the requirement yaml fully.
2. Use grep/glob/read to locate the exact source files, functions, and line numbers involved. Be thorough - search src/, test/, index.d.ts, package.json, build/, theme/ as relevant.
3. Read enough surrounding code to understand the current behavior and precisely what must change.
4. Check /workspace/test/ut/spec for existing unit tests that cover this area (they tell you the expected API shape).
5. Note the exact current code that must be replaced (quote it) and what the replacement should be.

Be specific: file path + line numbers + current code snippet + intended new code. If the requirement implies a new public option, name the option, its type location in the *Option interfaces, and the default value.

Return the structured plan.`,
  { label: `research:${slug}`, phase: 'Research', schema: PLAN_SCHEMA }
)))

return results.filter(Boolean)
