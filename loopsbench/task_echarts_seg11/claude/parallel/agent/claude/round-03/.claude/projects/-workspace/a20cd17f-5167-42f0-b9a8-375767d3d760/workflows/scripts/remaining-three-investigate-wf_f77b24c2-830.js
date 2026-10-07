export const meta = {
  name: 'remaining-three-investigate',
  description: 'Investigate the 3 remaining echarts requirements: axis tick overflow with dataZoom, splitLine showMinLine/showMaxLine, line memory reduction verification',
  phases: [
    { title: 'Investigate', detail: 'parallel deep dives: tick overflow repro, splitLine option design, line memory diff review' }
  ]
}

phase('Investigate')

const REPRO_SCHEMA = {
  type: 'object',
  properties: {
    reproduced: {type: 'boolean'},
    failingConfigs: {type: 'array', items: {type: 'string'}},
    rootCause: {type: 'string'},
    codeLocations: {type: 'array', items: {type: 'string'}},
    proposedFix: {type: 'string'},
    risks: {type: 'array', items: {type: 'string'}}
  },
  required: ['reproduced', 'failingConfigs', 'rootCause', 'codeLocations', 'proposedFix', 'risks']
}

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    optionTypeLocations: {type: 'array', items: {type: 'string'}},
    renderLocations: {type: 'array', items: {type: 'string'}},
    plan: {type: 'string'},
    docsAndTypes: {type: 'array', items: {type: 'string'}},
    testHints: {type: 'array', items: {type: 'string'}}
  },
  required: ['optionTypeLocations', 'renderLocations', 'plan', 'docsAndTypes', 'testHints']
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    testsRun: {type: 'array', items: {type: 'string'}},
    allPassed: {type: 'boolean'},
    failures: {type: 'array', items: {type: 'string'}},
    correctnessConcerns: {type: 'array', items: {type: 'string'}},
    verdict: {type: 'string'}
  },
  required: ['testsRun', 'allPassed', 'failures', 'correctnessConcerns', 'verdict']
}

const results = await parallel([
  () => agent(`You are investigating a bug in the Apache ECharts repo at /workspace (TypeScript source in src/, jest unit tests in test/ut/spec/, run with:
  npx jest --config test/ut/jest.config.cjs --coverage=false <path-to-test>

REQUIREMENT (requirements/axis-ticks-grid-overflow.yaml): "fix(axis): fix ticks overflowing grid area with dataZoom". When dataZoom is applied, axis ticks near the visible edges can extend beyond the grid area. Desired: keep axis ticks contained within the grid when dataZoom changes the visible window; normal tick rendering inside the plot preserved; non-zoomed charts unchanged.

YOUR JOB: empirically find the ACTUAL overflow case in THIS code base, and locate the root cause. Do not guess from memory of upstream commits — prove it with a running test.

Key code: src/coord/Axis.ts (getTicksCoords, getMinorTicksCoords, fixOnBandTicksCoords), src/coord/axisTickLabelBuilder.ts (createAxisTicks), src/component/axis/AxisBuilder.ts (buildAxisTick, line ~672), src/component/axis/CartesianAxisView.ts (_axisTick/_splitLine/_minorSplitLine), src/component/axis/axisSplitHelper.ts, src/scale/*.ts.

A previous exploratory sweep (test/ut/spec/coord/zzSweep3.test.ts) over category axis + inside dataZoom (boundaryGap, axisTick.interval, alignWithLabel, inverse, filterMode) found ZERO overflow, so the failing case is elsewhere. Broaden the search hard:
 - value / log / time axes with dataZoom (start/end, startValue/endValue, filterMode variants, min/max set, minInterval, scale:true)
 - MINOR ticks (minorTick: {show:true}) and minorSplitLine — getMinorTicksCoords does no clipping at all
 - splitLine / splitArea coords (axis.getTicksCoords({tickModel: splitLineModel, clamp: true}))
 - axisTick with custom values (axisTick.customValues / axisLabel.customValues — see requirements/axis-custom-values.yaml already implemented)
 - single axis, polar (angle/radius) with dataZoom
 - y-axis dataZoom, both axes zoomed, inverse axes
 - dataZoom filterMode 'none'/'weakFilter' where the scale extent becomes fractional/non-integer on a category axis
 - very small windows (end-start tiny), and windows that make the scale extent land between ticks

Write scratch jest tests under test/ut/spec/coord/ named tmpTickOverflowA*.test.ts. For each config, compare each tick coord (axis.toGlobalCoord(tickCoord)) against the grid rect from the coordinate system, AND compare against axis.getExtent(). Report every distinct overflow you find with numbers.

Then read the relevant source and explain the root cause precisely (file:line), and propose a minimal, upstream-style fix that (a) clips/bounds ticks outside the axis extent, (b) does not change non-zoomed charts, (c) keeps clamp:true semantics for splitLine/splitArea. Consider whether the right fix is in Axis#getTicksCoords / getMinorTicksCoords (filter ticks outside extent) vs in createAxisTicks.

IMPORTANT: delete all your tmp* scratch test files before you finish (leave the repo clean of your scratch files; do NOT modify any src/ file, do NOT touch test/ut/spec/coord/zzSweep3.test.ts or axisTicksInsideExtent.test.ts, do not git commit). Return findings only.`, {label: 'repro:tick-overflow', schema: REPRO_SCHEMA, effort: 'high'}),

  () => agent(`You are designing a feature for the Apache ECharts repo at /workspace (TypeScript, src/).

REQUIREMENT (requirements/splitline-min-max-lines.yaml): feat(axis): add \`showMinLine\` / \`showMaxLine\` options for \`splitLine\`. Authors want to independently control whether the minimum and maximum boundary split lines are rendered. Existing behavior must be unchanged when the options are absent; combinable for both ends.

YOUR JOB: read the code and produce a precise implementation plan. Find:
 1. Where the splitLine option type is declared: src/coord/axisCommonTypes.ts (AxisBaseOption splitLine), and any per-axis overrides (cartesian, single, polar radiusAxis/angleAxis, radar). Show the exact interface names/lines.
 2. Every render site that draws splitLines: src/component/axis/CartesianAxisView.ts (_splitLine, _minorSplitLine), src/component/axis/SingleAxisView.ts, src/component/axis/RadiusAxisView.ts, src/component/axis/AngleAxisView.ts, src/component/radar/RadarView.ts. Quote the loops with line numbers so I know exactly where the min/max line would be skipped.
 3. How the boundary lines arise: axis.getTicksCoords({tickModel: splitLineModel}) — for a value axis the first/last tick coincide with the axis extent only sometimes; for onBand category axes fixOnBandTicksCoords adds boundary coords. Explain how to reliably identify "the min line" and "the max line" (compare tick coord to axis.getExtent()[0]/[1] with rounding tolerance? or index 0 / length-1? note inverse axes). Recommend the most robust approach and say why.
 4. Whether defaults should be true (existing behavior preserved) and where defaults live (src/coord/axisDefault.ts? AxisModel defaultOption?).
 5. Any i18n/docs/types surfaces that list axis options and might need the new keys (e.g. src/coord/axisCommonTypes.ts only, or also *.d.ts / option docs?). Search for a comparable recently-added splitLine-ish option to mirror the style.
 6. Whether echarts has an existing similar concept to mirror naming/semantics.

Also state exactly which existing unit tests touch splitLine so I don't regress them (grep test/ut/spec for splitLine).

Read-only: do NOT modify any file. Return the plan.`, {label: 'design:splitline-minmax', schema: DESIGN_SCHEMA, effort: 'high'}),

  () => agent(`You are reviewing an UNCOMMITTED change in the Apache ECharts repo at /workspace.

Run \`git diff\` to see it. It implements requirements/line-memory-reduction.yaml ("perf(line): reduce runtime memory cost") by:
 - reusing one buffer in getStackedOnPoint (src/chart/line/helper.ts)
 - rewriting turnPointsIntoStep (src/chart/line/LineView.ts) to write into exactly-sized Float32Arrays instead of growing plain arrays
 - releasing LineView#_points/_stackedOnPoints when there is no animation

YOUR JOB: verify correctness rigorously and report.
 1. Run the line-related unit tests and report exact results:
    npx jest --config test/ut/jest.config.cjs --coverage=false test/ut/spec/chart/line
    then also: test/ut/spec/chart (whole dir) and test/ut/spec/component/axis if it exists. Report pass/fail counts and any failure text verbatim.
 2. Critically check the new turnPointsIntoStep math against the ORIGINAL code (use \`git show HEAD:src/chart/line/LineView.ts\`): the step point count formula (pointCount*2-1, middle => pointCount*3-2), the connectNulls filtering, the stacked-on array staying index-aligned with points, single-point and zero-point inputs, and the NaN/null handling for non-connectNulls (nulls must be preserved as NaN so gaps still render). Verify the requirement 'stepped-line-area-nulls' (already committed - see \`git log --oneline\` and \`git show\` that commit, plus test/ut/spec/chart/line/*) is NOT regressed.
 3. Check whether Float32Array is safe here: are the shape points consumed anywhere that requires a real Array (e.g. .push, .slice, zrender polygon/polyline shape, clipPath animation, _doUpdateAnimation, lineAnimationDiff.ts)? grep for usages of shape.points / stackedOnPoints and for createFloat32Array in src/.
 4. Check the _points/_stackedOnPoints release logic: any code path that reads this._points assuming non-null (e.g. _doUpdateAnimation, _initSymbolLabelAnimation, updateLayout, removeClipPath)? Verify switching animation off->on and on->off across setOption calls, and dataZoom updates, cannot break.
 5. Report anything else that would change visual output or public behavior.

Read-only on src/: do NOT modify any source file and do not git commit. Running tests is fine. Return your findings.`, {label: 'review:line-memory', schema: REVIEW_SCHEMA, effort: 'high'})
])

return {
  tickOverflow: results[0],
  splitLine: results[1],
  lineMemory: results[2]
}
