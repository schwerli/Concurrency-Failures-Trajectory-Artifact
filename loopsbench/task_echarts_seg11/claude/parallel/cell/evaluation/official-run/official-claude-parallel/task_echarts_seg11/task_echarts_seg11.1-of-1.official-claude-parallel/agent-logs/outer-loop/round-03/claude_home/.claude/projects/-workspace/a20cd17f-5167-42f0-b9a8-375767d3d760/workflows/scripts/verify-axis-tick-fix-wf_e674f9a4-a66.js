export const meta = {
  name: 'verify-axis-tick-fix',
  description: 'Adversarially verify the axis tick/label extent fix: A/B sweep vs pre-fix code, code review, cache-behaviour review',
  phases: [
    { title: 'Verify', detail: 'A/B sweep, adversarial review, cache/label review' }
  ]
}

phase('Verify')

const AB_SCHEMA = {
  type: 'object',
  properties: {
    method: {type: 'string'},
    configsCompared: {type: 'number'},
    differencesFound: {type: 'boolean'},
    differences: {type: 'array', items: {type: 'string'}},
    verdict: {type: 'string'}
  },
  required: ['method', 'configsCompared', 'differencesFound', 'differences', 'verdict']
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: {type: 'string'},
          location: {type: 'string'},
          problem: {type: 'string'},
          failureScenario: {type: 'string'},
          confirmed: {type: 'boolean'}
        },
        required: ['severity', 'location', 'problem', 'failureScenario', 'confirmed']
      }
    },
    verdict: {type: 'string'}
  },
  required: ['findings', 'verdict']
}

const results = await parallel([
  () => agent(`Apache ECharts repo at /workspace. There is an UNCOMMITTED change (see \`git diff\`) in src/coord/Axis.ts and src/coord/axisTickLabelBuilder.ts implementing requirements/axis-ticks-grid-overflow.yaml:
 1. \`Axis#getTicksCoords\` now skips ordinal ticks whose value is outside the current \`scale.getExtent()\`.
 2. \`fixOnBandTicksCoords\` clamp handling now loops so that more than one out-of-extent tick at either end is handled.
 3. The per-axis ticks/labels cache in axisTickLabelBuilder.ts is now keyed by the scale extent as well (so stale ticks/labels for a previous dataZoom window are not reused), and setting a cache entry replaces the entry of the same key instead of appending.

YOUR JOB: prove empirically whether this changes ANY output for normal (non-stale) charts. Method: A/B comparison against the pre-change code.
 - \`git stash\` is NOT allowed (other work is in flight). Instead create a pristine pre-change tree: \`git worktree add /tmp/prefix HEAD\` (HEAD does NOT contain this change). Then \`ln -s /workspace/node_modules /tmp/prefix/node_modules\`.
 - Write the SAME sweep script as a jest test in both trees (e.g. test/ut/spec/coord/tmpAB.test.ts) that renders a big matrix of charts and dumps a JSON fingerprint to a file under /tmp (use \`require('fs').writeFileSync\`). Run with: npx jest --config test/ut/jest.config.cjs --coverage=false <path> (run it from each tree root).
 - Fingerprint per config: for every axis — axis.getTicksCoords() coords+tickValues, axis.getTicksCoords({clamp:true}) coords, axis.getMinorTicksCoords(), axis.getViewLabels() (tickValue + formattedLabel), plus the count and x1/y1/x2/y2 of the rendered splitLine/splitArea/axisTick elements in the axis view group. Round floats to 6 decimals.
 - Matrix (aim for 300+ configs, and also exercise dataZoom actions on each): xAxis/yAxis types value | category | time | log; category with boundaryGap true/false, axisTick.interval 0/1/2/'auto', alignWithLabel true/false, axisLabel.interval 0/'auto'/function, showMinLabel/showMaxLabel, inverse; value with min/max/scale/splitNumber/interval/minInterval; splitLine.show, splitArea.show, minorTick/minorSplitLine; grid.containLabel true/false; multiple grids; singleAxis; polar (angle category + radius value); radar; parallel; dataZoom inside+slider with start/end, startValue/endValue, filterMode filter|weakFilter|empty|none, several dispatchAction({type:'dataZoom'}) steps per chart; large category data (200+ categories, to also hit the auto-interval path and the label cache); a chart resize (chart.resize) to exercise the axisExtent caches.
 - Then diff the two JSON files programmatically and report EVERY difference (config + field + before/after values).
Also measure whether the cache change causes repeated recomputation in a normal render: instrument by counting calls (e.g. monkey-patch axis.scale.getExtent or use a counter via a jest spy) if useful, and report if ticks/labels are computed noticeably more often than before for the large-category chart.

Clean up: remove your tmp test files from BOTH trees, \`git worktree remove /tmp/prefix --force\` and delete the symlink at the end. Do NOT modify any src/ file, do NOT commit, do NOT touch test/ut/spec/coord/axisTicksInsideExtent.test.ts.
Return the findings: every difference found (or a solid statement that there are none), how many configs you compared, and your method.`, {label: 'ab-sweep', schema: AB_SCHEMA, effort: 'high'}),

  () => agent(`Apache ECharts repo at /workspace. Adversarially review the UNCOMMITTED change in src/coord/Axis.ts and src/coord/axisTickLabelBuilder.ts (\`git diff\`), which implements requirements/axis-ticks-grid-overflow.yaml.

Try hard to BREAK it. Read the code (not just the diff) and hunt for real defects:
 - In getTicksCoords: is \`tickVal\` really in the same value space as \`scale.getExtent()\` for an ordinal scale? Check src/scale/Ordinal.ts (getExtent, getRawOrdinalNumber, parse, count, isInExtentRange) and src/coord/axisTickLabelBuilder.ts (makeCategoryTicks / makeLabelsByNumericCategoryInterval / makeLabelsByCustomizedCategoryInterval / parseCustomValues) — including the case of an OrdinalMeta with deduplication, an ordinal scale whose extent is fractional, and \`axisTick.customValues\` on a category axis. Would any legitimate tick now be dropped?
 - Can the filter make ticksCoords EMPTY where it was non-empty before, and what do the consumers do then (AxisBuilder.buildAxisTick / buildAxisLabel pairing in fixMinMaxLabelShow, CartesianAxisView splitLine, axisSplitHelper splitArea with clamp:true, BaseBarSeries around line 103 which uses getTicksCoords for bar layout, RadarView, AngleAxisView/RadiusAxisView, AxisBuilder line ~672)? Look for a crash (index [0] on empty), a NaN, or a silently blank axis.
 - In fixOnBandTicksCoords: verify the two new while loops for correctness on: single tick, two ticks, inverse axes (axisExtent[0] > axisExtent[1]), NaN coords, all ticks out of extent, clamp true/false, ticksLen===1 branch (where \`last\` is ticksCoords[1]), and whether \`last\` can end up detached from the array or undefined. Check that healthy charts hit zero iterations.
 - In axisTickLabelBuilder: the cache now stores scaleExtent0/1 and listCacheSet replaces same-key entries. Check the interaction with makeAutoCategoryInterval (inner(axis).autoInterval is NOT extent-aware) and with the jitter-stabilising cache in inner(axis.model) (lastAutoInterval/axisExtent0/axisExtent1) — can this produce inconsistent ticks vs labels (e.g. splitLine using the label interval computed for a different extent), or label jitter while zooming? Is there any path where ticks and labels are now computed from different extents within one render?
 - Performance: is the extent comparison + replace-on-set loop safe for large category data (10k+ categories), and can the cache thrash (recompute per call) in any real flow, e.g. when the scale extent object is mutated between calls within one render (check src/coord/cartesian/Grid.ts updateAxisExtent/containLabel flows, src/component/dataZoom/AxisProxy.ts, and axis.scale.unionExtent / niceExtent ordering during coordinate system creation)? Specifically: is scale.getExtent() ever called BEFORE the final extent is set for that axis during a single render, such that ticks are cached and then recomputed (correct but slower) or WORSE, cached for the final extent but with a stale auto-interval?
 - Anything that changes rendered output for a chart that never zooms.

You may write throwaway jest tests (name them tmpAdvers*.test.ts under test/ut/spec/coord/, delete them before finishing) and run: npx jest --config test/ut/jest.config.cjs --coverage=false <path>. Do NOT modify src/, do not commit, do not touch axisTicksInsideExtent.test.ts.
Report only defects you can substantiate; mark each as confirmed (you reproduced it) or not. Empty findings list is a fine answer if it holds up.`, {label: 'adversarial-review', schema: REVIEW_SCHEMA, effort: 'high'}),

  () => agent(`Apache ECharts repo at /workspace. Focused review of ONE aspect of the uncommitted change (\`git diff src/coord/axisTickLabelBuilder.ts\`): the ticks/labels cache is now keyed by the scale extent.

Questions to answer with evidence from the code and from running charts:
 1. Trace every caller of createAxisTicks / createAxisLabels / getViewLabels / getTicksCoords in one full chart render (grid + category xAxis with axisLabel.interval 'auto' + dataZoom + containLabel:true). How many times are the ticks/labels actually computed before and after the change? Instrument with jest spies or console counting in a throwaway test.
 2. Does the axis label auto-interval remain stable while a dataZoom window is dragged (the anti-jitter cache in makeAutoCategoryInterval + inner(axis.model).lastAutoInterval)? Write a throwaway test that dispatches a sequence of small dataZoom moves on a 60-category axis and records the displayed label count/tickValues per step, and report whether it jitters. Compare against the pre-change behaviour using a pristine worktree of HEAD (\`git worktree add /tmp/prefix2 HEAD; ln -s /workspace/node_modules /tmp/prefix2/node_modules\`) — HEAD does not contain the change.
 3. Confirm ticks and labels can not be computed from two different extents within one render (which would make splitLine and labels disagree).
 4. Sanity check the memory/perf profile of the new cache: with 10k categories and repeated getTicksCoords/getViewLabels calls, is anything recomputed per call?

Clean up all throwaway files and worktrees. Do NOT modify src/, do not commit, do not touch test/ut/spec/coord/axisTicksInsideExtent.test.ts.
Report concrete findings.`, {label: 'cache-review', schema: REVIEW_SCHEMA, effort: 'high'})
])

return {abSweep: results[0], adversarial: results[1], cache: results[2]}
