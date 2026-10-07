export const meta = {
  name: 'echarts-req-research',
  description: 'Research each remaining ECharts requirement and produce a precise implementation plan file',
  phases: [
    { title: 'Research', detail: 'one agent per requirement, writes plan to agent_plans/<slug>.md' },
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

const SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    files: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths that WILL be modified or created' },
    summary: { type: 'string', description: '2-4 sentence description of the concrete change' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    risk: { type: 'string', description: 'what could break, or unknowns remaining' },
  },
  required: ['slug', 'files', 'summary', 'confidence', 'risk'],
  additionalProperties: false,
}

function prompt(slug) {
  return `You are researching ONE change request for the Apache ECharts repository at /workspace (version 6.0.0-beta.1, TypeScript source under /workspace/src, unit tests under /workspace/test/ut/spec, visual test html under /workspace/test).

Your requirement slug is: **${slug}**
Read /workspace/requirements/${slug}.yaml first — it is the authoritative statement of what must change.

This repo is a real snapshot of apache/echarts just before a set of real upstream commits. Your job is to work out, from the actual source code, exactly what the fix/feature must be, at the level of concrete code edits.

RULES:
- READ-ONLY on the repository. Do NOT modify, create, or delete ANY file under /workspace except the single plan file you are told to write below. Do NOT run any mutating git command (no add/commit/checkout/stash).
- Use Read/Grep/Glob/Bash(read-only) freely. Read the ACTUAL code — never guess at file contents or API shapes. Verify every symbol, option name, type name and file path you cite by opening the file.
- Search widely: src/, test/ut/spec/, test/*.html, index.d.ts, package.json, build/, theme/, ssr/, extension-src/. Related option types often live in src/component/**/[X]Model.ts, src/coord/**, src/util/types.ts, src/util/states.ts, src/label/*, src/scale/*.

DELIVERABLE: write a detailed implementation plan to /workspace/agent_plans/${slug}.md using the Write tool. It must contain, in markdown:
1. **Goal** — restate what must change, in engineering terms.
2. **Findings** — the exact current code that is wrong/missing, with \`path:line\` references and quoted snippets of the current code.
3. **Plan** — an ordered list of edits. For EACH edit give: the file path, the exact anchor (existing code to search for, quoted verbatim so it can be matched), and the exact replacement/new code, fully written out and compilable TypeScript matching surrounding style (4-space indent, existing import conventions, Apache license header on new files).
4. **Tests** — whether a unit test under /workspace/test/ut/spec/... is feasible and, if so, sketch it (jest, ts-jest, uses \`import { createChart } from '../core/utHelper'\` style — CHECK an existing spec file for the real helper API before writing this).
5. **Verification** — what command(s) prove it works (e.g. \`npx tsc --noEmit\`, \`npx jest --config test/ut/jest.config.cjs -t "..."\`).
6. **Risks / open questions**.

Be exhaustive and concrete: another engineer must be able to apply your plan without re-deriving anything. If the requirement is vague, look for the smallest coherent real change that satisfies every acceptance signal in the yaml, and prefer touching the code paths the yaml names.

Finally return the structured summary object. \`files\` must list every repo file the plan will modify or create (excluding the plan file itself).`
}

phase('Research')
const results = await parallel(SLUGS.map(s => () =>
  agent(prompt(s), { label: `research:${s}`, phase: 'Research', schema: SCHEMA, agentType: 'general-purpose' })
))

const ok = results.filter(Boolean)
log(`research complete: ${ok.length}/${SLUGS.length}`)
return ok
