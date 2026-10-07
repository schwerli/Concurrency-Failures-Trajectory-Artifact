export const meta = {
  name: 'echarts-final-reqs',
  description: 'Verify 5 pending in-tree echarts fixes and design the 2 unimplemented requirements',
  phases: [
    { title: 'Review', detail: 'adversarially review each pending in-tree change' },
    { title: 'Design', detail: 'research + design the 2 unimplemented requirements' },
  ],
}

const REPO = '/workspace'

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    verdict: { type: 'string', enum: ['correct', 'needs-fix', 'incomplete'] },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          problem: { type: 'string' },
          failureScenario: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['file', 'severity', 'problem', 'failureScenario', 'suggestedFix'],
      },
    },
    missingCoverage: { type: 'array', items: { type: 'string' } },
  },
  required: ['slug', 'verdict', 'summary', 'issues', 'missingCoverage'],
}

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    rootCause: { type: 'string' },
    upstreamApproach: { type: 'string', description: 'What the real apache/echarts fix most likely did, if inferable from code structure' },
    plan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          change: { type: 'string', description: 'Precise description of the edit, with exact existing code to anchor on and the replacement' },
          rationale: { type: 'string' },
        },
        required: ['file', 'change', 'rationale'],
      },
    },
    typeDeclarationSites: { type: 'array', items: { type: 'string' }, description: 'Files where TS option interfaces must be extended' },
    testPlan: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['slug', 'rootCause', 'plan', 'testPlan', 'risks'],
}

const PENDING = [
  {
    slug: 'axis-ticks-grid-overflow',
    files: 'src/coord/Axis.ts (function fixOnBandTicksCoords) and test/ut/spec/coord/axisTicksInsideExtent.test.ts',
    intent: `Requirement "fix(axis): fix ticks overflowing grid area with dataZoom": when dataZoom changes the visible window, axis ticks near visible edges must not extend beyond the grid area. Edge ticks must no longer overflow the grid boundary; normal tick rendering inside the plot preserved; non-zoomed charts unchanged.`,
    focus: `The change adds two while-loops that shift/pop ticksCoords when the SECOND (or second-to-last) tick is outside the extent, then reassigns \`last\`. Scrutinize:
 - Is reassigning \`last = ticksCoords[ticksCoords.length - 1]\` after the pop loop correct given how \`last\` is used later (alignWithLabel / clamp handling)? Read the WHOLE function including the code above the hunk that computes and pushes \`last\`.
 - Does \`littleThan\` (with its epsilon/inverse handling) behave correctly here? Note \`littleThan(a, b, inverse)\` — is the \`inverse\` argument being omitted a bug when the axis extent is inversed (axisExtent[0] > axisExtent[1])? The function computes \`const inverse = axisExtent[0] > axisExtent[1];\` — check whether existing clamp code passes \`inverse\` to littleThan and whether the new loops must too.
 - Off-by-one: could the loops drop a tick that is legitimately inside the extent? Could they leave a tick outside when >2 ticks are outside?
 - Interaction with \`alignWithLabel\` and with \`ticksCoords\` entries carrying \`tickValue\`.`,
  },
  {
    slug: 'pie-label-visibility',
    files: 'src/chart/pie/labelLayout.ts (function adjustSingleSide) and test/ut/spec/chart/pie/labelLayout.test.ts',
    intent: `Requirement "fix(pie): fix some labels may not show": dense pie labels get incorrectly dropped. Labels that should be shown must not be dropped during collision handling or final positioning; other overlap-avoidance still works; no stray duplicate labels.`,
    focus: `The change clamps the ellipse-implicit-function radicand to >= 0 so dx is not NaN. Scrutinize:
 - Read the full adjustSingleSide + the caller (avoidOverlap / pieLabelLayout) and confirm NaN dx really is the mechanism by which labels get dropped (search for where labels get \`ignore = true\` or \`labelLine.ignore\`, and where NaN would propagate).
 - Is clamping to 0 the right semantic (dx=0 puts label at cx)? Should it instead clamp \`Math.abs(dy)\` to rB, or set dx = rA when |dy| > rB? Compare: with radicand clamped to 0, dx = 0 => newX = cx + len2*dir, i.e. label pulled to the center horizontally. Is that visually sane, or should the label stay at its current x?
 - Note the diff also removed \`Math.abs(...)\` from \`dy*dy/rB2\`; confirm that is a no-op (dy*dy is non-negative, rB2 non-negative) and not a behavior change.
 - Are there OTHER places in this file where labels can be wrongly dropped (e.g. \`isPositionCenter\`, \`setNotShow\`, \`hideOverlap\`, the recursion in adjustSingleSide, the \`shiftDown\`/\`shiftUp\` helpers)? The requirement says "labels that should be shown are not incorrectly dropped during collision handling or final positioning" — is the single clamp enough or is more needed?`,
  },
  {
    slug: 'tooltip-notmerge-npe',
    files: 'src/component/tooltip/TooltipHTMLContent.ts and test/ut/spec/component/tooltip/tooltip.test.ts',
    intent: `Requirement "fix(tooltip): fix potential NPE when setting option with notMerge strategy": tooltip HTML layer hits a null path during repositioning and throws. setOption with notMerge must not crash; tooltip positioning still works after rerender.`,
    focus: `The change adds \`if (!el) return;\` guards in update/updateLayout/setContent/getSize/moveTo/_moveIfResized/hide/dispose and makes makeStyleCoord tolerate a null zr. Scrutinize:
 - Is the actual upstream root cause guarded? Trace who calls into TooltipHTMLContent after \`dispose()\`. Look at TooltipView.ts \`dispose\`/\`remove\`, the \`_updatePosition\` path, \`_moveIfResized\`, and any zrender/handler listeners or throttled/debounced callbacks (e.g. \`throttle\`, \`setTimeout\`, \`_alwaysShowContent\`) that can fire after dispose. Is there a listener that should be unbound in dispose (e.g. \`this._api.getZr().on(...)\` or the \`_enterable\` mouse handlers on el)?
 - Does \`makeStyleCoord\` with zr==null leave out[0]/out[1] undefined and then \`styleCoord[0] != null\` short-circuit correctly? Read makeStyleCoord fully.
 - Is guarding \`getSize()\` to return [0,0] safe for callers (TooltipView position calc dividing by size)?
 - Is there also a null-\`this._zr\` path in \`update()\`/\`updateLayout()\` reached before the el guard?
 - Confirm the test in test/ut/spec/component/tooltip/tooltip.test.ts actually reproduces a crash WITHOUT the src fix (i.e. it is a real regression test). If it would pass without the fix, say so and describe a test that would fail.`,
  },
  {
    slug: 'map-regions-silent',
    files: 'src/component/helper/MapDraw.ts, src/coord/geo/GeoModel.ts, src/chart/map/MapSeries.ts',
    intent: `Requirement "feat(map): support regions[].silent and update map data in tests": per-region \`silent\` for geo-based maps AND series.map. A silent region keeps its visual but opts out of event handling and interactive affordances, without making the whole map non-interactive. Must apply consistently to GeoJSON regions AND SVG-backed regions. Map data refreshes should preserve the updated region behavior.`,
    focus: `Scrutinize:
 - \`resetSilentForRegion\` is called for GeoJSON (\`_buildGeoJSON\`) with \`regionGroup\` and for SVG (\`_buildSVG\`) with \`el\`. Read both build functions fully. For GeoJSON, is \`regionGroup\` the right el (does it contain the compound path AND the label)? Is there a separate \`_regionsGroup\`/\`textEl\` that also needs it?
 - CRITICAL: does setting \`el.silent = true\` get RESET on the next render? MapDraw reuses els across renders in some paths. The guard is \`if (silent != null)\` — so when a user removes \`silent\` from the option, the el keeps the stale \`silent = true\`. Should it be \`el.silent = !!silent\` unconditionally? Check how els are created/reused (\`_regionsGroup.removeAll()\`? \`RegionGroup\` reuse?) to decide.
 - Does \`regionModel\` actually resolve \`silent\` for BOTH geo (\`regions\` in GeoModel/GeoComponent) and series.map (data item option)? Read \`getRegionModel\`/\`_getRegionModel\` or however regionModel is obtained in MapDraw, and check MapSeries's \`getRegionModel\`/data-item model path — for series.map, per-region config comes from \`series.data[i]\` items (MapDataItemOption) AND/OR \`series.regions\`? Verify \`MapSeries\` exposes a \`regions\` option; if not, is adding \`silent\` to MapDataItemOption sufficient/correct?
 - Does silent need to also suppress tooltip? zrender \`silent\` blocks events, and echarts tooltip uses events — but \`resetTooltipForRegion\` sets \`tooltipConfig\`; check ordering (silent set AFTER state trigger + tooltip reset — fine?) and whether emphasis/select state or \`cursor: pointer\` affordance still gets applied to a silent region (the requirement says "opting out of ... interactive affordances"). Check \`resetStateTriggerForRegion\` / \`enableHoverEmphasis\` / \`setDefaultStateProxy\` and where \`cursor\` is set.
 - "update map data in tests": is there a test/data map fixture (e.g. test/data/map/*.json or test/ut fixtures) referenced by the requirement? Search test/ for map geojson fixtures and for existing MapDraw/geo unit tests, and report what test additions would be appropriate.
 - Is a doc/type entry needed in src/coord/geo/GeoModel.ts \`GeoOption.regions\` (already RegoinOption) and is there an SVG-region option type (\`GeoSVGRegionOption\`?) that also needs \`silent\`?`,
  },
  {
    slug: 'line-memory-reduction',
    files: 'src/chart/line/LineView.ts, src/chart/line/helper.ts, test/ut/spec/chart/line/memory.test.ts',
    intent: `Requirement "perf(line): reduce runtime memory cost": reduce runtime memory footprint of line-series rendering WITHOUT changing chart appearance, public options, or event behavior.`,
    focus: `This is the riskiest change — a rewrite of \`turnPointsIntoStep\` to write into exactly-sized Float32Arrays, plus releasing \`_points\`/\`_stackedOnPoints\` when there is no animation, plus a reusable buffer in \`getStackedOnPoint\`. VERIFY BEHAVIOR IS IDENTICAL:
 - Recompute \`stepPointCount\` by hand for stepTurnAt 'start', 'end', 'middle' with pointCount = 0, 1, 2, 3, 5. Compare against what the ORIGINAL code (see \`git show HEAD:src/chart/line/LineView.ts\`) produced. Report any mismatch in length or in point ORDER/VALUES.
 - The original 'middle' case pushed pt, stepPt, stepPt2 per segment then the last point => 3*(n-1)+1 = 3n-2. Confirm.
 - When connectNulls is FALSE and points contain NaN: original produced 2n-1 points including NaN turning points. Does the new code match exactly, including NaN propagation into \`middle\` computation?
 - Writing into a Float32Array: original returned plain number[] (float64). Does reduced precision break \`isPointsSame\`, \`smoothMonotone\`, clipping/animation (\`_doUpdateAnimation\` diffing), or the \`ECPolygon\`/\`ECPolyline\` shape? Note the non-step path already used Float32Array, so check whether the STEP path being Float32Array now is safe: grep for consumers of \`polyline.shape.points\` / \`polygon.shape.points\` that MUTATE or PUSH to the array (e.g. \`lineAnimationDiff.ts\`, \`ECPolygon\`, \`poly.ts\`, \`_initSymbolLabelAnimation\`, \`_doUpdateAnimation\`, \`clipShapeForSymbol\`). A Float32Array cannot be push()ed to or resized — that would be a hard crash.
 - \`stackedOnPoints\` alignment: in the new loop, both arrays are written at the SAME outOffset and the stacked write ignores the returned offset. Confirm both writes advance identically (they do iff writeStepPoints is deterministic in offset advance, which depends only on stepTurnAt and nextSrcOffset<0). Verify.
 - \`this._points = null\` when \`!hasAnimation\`: grep EVERY use of \`this._points\` and \`this._stackedOnPoints\` in LineView.ts (and any subclass/other file) and confirm each is null-safe. Check \`_doUpdateAnimation\` (does it read this._points?), \`isPointsSame(null, x)\` behavior, and the \`removeClipPath\`/\`_initOrUpdateEndLabel\` paths.
 - \`getStackedOnPoint(..., stackedData)\` reused buffer: the returned point is computed from stackedData via \`coordSys.dataToPoint(stackedData)\` — does dataToPoint RETAIN the passed array (store a reference) anywhere? If Cartesian2D/Polar dataToPoint stores or returns the input array, buffer reuse would corrupt data. Read both dataToPoint implementations and \`getStackedOnPoint\` fully. Also confirm the buffer's stale values can't leak: stackedData[baseDataOffset] and stackedData[1-baseDataOffset] are both always assigned, and length stays 2 — verify no code path leaves index 2+ set.
 - Does the new code still handle \`points.length === 0\` and \`stackedOnPoints\` being null?
 - Also assess: is this change actually reducing memory (the requirement's goal), and does test/ut/spec/chart/line/memory.test.ts meaningfully assert it?`,
  },
]

phase('Review')

const reviews = await parallel(PENDING.map(p => () => agent(
  `You are adversarially reviewing an UNCOMMITTED change in the Apache ECharts repo at ${REPO} (git branch master, version 5.6.0).

Run \`cd ${REPO} && git diff -- ${p.files.split(' and ')[0].split(',').map(s => s.trim()).join(' ')}\` and read the FULL current file contents (not just the diff) plus the pre-change version via \`git show HEAD:<path>\`.

## Requirement being implemented
${p.intent}

## Files changed
${p.files}

## What to scrutinize
${p.focus}

## Method
1. Read the full current files and the HEAD versions. Understand surrounding code, not just the hunks.
2. Trace every caller and consumer you need to. Use grep liberally.
3. Where useful, VERIFY EMPIRICALLY: you may run \`cd ${REPO} && npx jest --config test/ut/jest.config.cjs --coverage=false <testfile>\` on existing tests, and you may write a THROWAWAY scratch test under /tmp (NOT under ${REPO}) and run it with the repo jest config via \`--rootDir\`-compatible means, or simply add a temporary test file under ${REPO}/test/ut/spec/ and DELETE it afterwards. IMPORTANT: you MUST NOT leave any new or modified files in ${REPO} beyond what is already there — no edits to src/, no leftover test files. Verify with \`git status --short\` at the end and clean up anything you added.
4. Be concrete. For each issue give the exact failing scenario and the exact suggested fix (code).
5. Do NOT report style nits. Only correctness, behavior-change, completeness-vs-requirement, and crash risks.

Return the structured verdict. \`verdict\` = 'correct' if the change is right and complete for the requirement; 'needs-fix' if there is a bug; 'incomplete' if it is correct but does not fully satisfy the requirement's acceptance signals.`,
  { label: `review:${p.slug}`, phase: 'Review', schema: REVIEW_SCHEMA, effort: 'high' }
)))

phase('Design')

const DESIGNS = [
  {
    slug: 'inversed-time-bandwidth',
    prompt: `Design the fix for this requirement in the Apache ECharts repo at ${REPO}:

title: 'fix(axis): fix bar bandWidth with inversed time axis'
Context: Bar charts on an inversed time axis can calculate the wrong \`bandWidth\`, causing distorted bar sizing/spacing.
Desired outcome: Correct bar bandwidth calculation for inversed time axes so bar width matches the actual axis interval direction and rendered bars keep sensible spacing.
Acceptance: Bars on an inversed time axis render with the expected width; reversing the axis no longer distorts band sizing; non-inversed time-axis bar charts keep their current layout.

## Where to look
- \`${REPO}/src/layout/barGrid.ts\`: \`getValueAxesMinGaps()\` and \`makeColumnLayout()\` (around lines 150-250). \`getValueAxesMinGaps\` computes the minimum gap between adjacent data values per value/time axis; \`makeColumnLayout\` turns it into bandWidth via \`extentSpan / scaleSpan * minGap\`.
- Read \`getValueAxesMinGaps\` VERY carefully. It sorts values and computes min diff. Look for how it collects values (\`data.getStore().get(dimIdx, i)\` or similar), whether it SORTS them, and how it handles the axis being inversed.
- The likely root cause: \`getValueAxesMinGaps\` iterates data in data order and computes \`values[i] - values[i-1]\` WITHOUT sorting (or sorts but then the diff can be negative / zero when inversed), or it early-returns on a non-positive gap. Determine the ACTUAL mechanism by reading the code.
- Also check \`src/layout/barPolar.ts\` for the analogous path, and whether \`axis.inverse\` / \`axis.isBlank\` / \`scale.getExtent()\` ordering matters. Note \`makeColumnLayout\` already uses \`Math.abs()\` for extentSpan and scaleSpan.
- Check whether the bug is instead in the \`min\`/\`max\` tracking loop skipping duplicate/unsorted values, or in \`Math.abs\` being missing on the per-pair diff.

## Also determine
- Whether \`getValueAxesMinGaps\` needs \`Math.abs\` on the gap, or a sort, or a fix to its \`lastValue\`/\`min\` initialization.
- Whether a unit test can be written under \`${REPO}/test/ut/spec/layout/\` (check existing tests there and in test/ut/spec/ for barGrid/barLayout tests) that asserts bar width equality between inverse:true and inverse:false time axes. Look at how existing tests build charts (\`createChart\` helper in test/ut/core/utHelper.ts) and read the layout result (e.g. \`series.getData().getItemLayout(0).width\`).

Produce a precise implementation plan with exact anchors. Do NOT modify any file — this is design only. Verify with \`git status --short\` that you left the repo unchanged.`,
  },
  {
    slug: 'splitline-min-max-lines',
    prompt: `Design the implementation for this requirement in the Apache ECharts repo at ${REPO}:

title: 'feat(axis): add \`showMinLine\` / \`showMaxLine\` option for \`splitLine\`'
Context: Some designs need axis split lines only at the lower bound, upper bound, or both boundary lines.
Desired outcome: Add \`showMinLine\` and \`showMaxLine\` to split-line configuration so authors can independently control whether the minimum and maximum boundary lines are rendered.
Acceptance: Turning on \`showMinLine\`/\`showMaxLine\` renders only the requested boundary split lines; existing split-line behavior is unchanged when the options are absent; authors can combine them for both ends.

## IMPORTANT semantic question to resolve from the code
The real upstream ECharts feature (apache/echarts PR for \`splitLine.showMinLine\`/\`showMaxLine\`) defaults BOTH to \`true\` and lets authors set them to \`false\` to SUPPRESS the boundary split lines (which otherwise coincide with the axis line / the opposite edge of the grid and look like clutter). Read the requirement text again: "Turning on showMinLine or showMaxLine renders only the requested boundary split lines" is ambiguous, but "existing split-line behavior remains unchanged when the options are absent" is decisive — so the defaults MUST preserve today's behavior. Determine from the code what default preserves current rendering (almost certainly \`true\` for both) and design accordingly: when \`showMinLine: false\`, the split line at the axis MIN end is skipped; when \`showMaxLine: false\`, the split line at the axis MAX end is skipped.

## Where to look — you must cover EVERY axis type that renders splitLine
- \`${REPO}/src/component/axis/CartesianAxisView.ts\` — \`splitLine()\` and \`minorSplitLine()\`
- \`${REPO}/src/component/axis/SingleAxisView.ts\` — \`splitLine()\`
- \`${REPO}/src/component/axis/RadiusAxisView.ts\` — \`splitLine()\`
- \`${REPO}/src/component/axis/AngleAxisView.ts\` — \`splitLine()\`
- \`${REPO}/src/component/axis/axisSplitHelper.ts\`
- Type declarations: \`${REPO}/src/coord/axisCommonTypes.ts\` (look for \`AxisSplitLineOption\` / \`splitLine\` in \`AxisBaseOption\`), and any per-coordinate axis option types (\`src/coord/cartesian/AxisModel.ts\`, \`src/coord/single/AxisModel.ts\`, \`src/coord/polar/AxisModel.ts\`). Find the ONE shared interface if there is one.
- Defaults: \`${REPO}/src/coord/axisDefault.ts\` (splitLine defaults) — decide whether to add explicit \`showMinLine: true, showMaxLine: true\` defaults there.
- Also check \`src/coord/axisTickLabelBuilder.ts\` / \`Axis.getTicksCoords\` to understand what the tick coords array looks like and how to identify the min/max boundary entries (first/last of \`ticksCoords\`), remembering the axis may be INVERSED (so ticksCoords[0] may be the max, not the min). Determine how to map "min end" vs "max end" robustly — likely via \`tickValue\`/coord vs \`axis.scale.getExtent()\` or via \`axis.inverse\`.
- Check how \`getTicksCoords({tickModel: splitLineModel})\` behaves and whether \`ticksCoords\` includes boundary entries only when the tick falls exactly on the extent.

## Also determine
- How to identify the "min line" and "max line": is it index 0 / last of ticksCoords, adjusted for \`axis.inverse\`? Or comparing \`tickCoord.tickValue\` to \`axis.scale.getExtent()\`? Give exact code.
- Whether \`minorSplitLine\` should be affected (probably NOT).
- Whether \`splitArea\` is affected (probably NOT).
- A unit test plan under \`${REPO}/test/ut/spec/\` — check existing axis split-line tests, and how to count rendered split lines from a created chart (e.g. walking \`chart.getZr().storage\` / \`getModel\` -> view group children, or via \`chart.getZr().painter.getViewportRoot()\`). Look at test/ut/core/utHelper.ts for \`createChart\`. If counting rendered lines is hard, propose asserting on the group children of the axis view (\`chart.getViewOfComponentModel(axisModel).group\`) and the merged path's \`shape\`/subpaths.

Produce a precise, complete implementation plan with exact code anchors for every file. Do NOT modify any file — design only. Verify with \`git status --short\` that you left the repo unchanged.`,
  },
]

const designs = await parallel(DESIGNS.map(d => () => agent(d.prompt, {
  label: `design:${d.slug}`, phase: 'Design', schema: DESIGN_SCHEMA, effort: 'high'
})))

return {
  reviews: reviews.filter(Boolean),
  designs: designs.filter(Boolean),
}
