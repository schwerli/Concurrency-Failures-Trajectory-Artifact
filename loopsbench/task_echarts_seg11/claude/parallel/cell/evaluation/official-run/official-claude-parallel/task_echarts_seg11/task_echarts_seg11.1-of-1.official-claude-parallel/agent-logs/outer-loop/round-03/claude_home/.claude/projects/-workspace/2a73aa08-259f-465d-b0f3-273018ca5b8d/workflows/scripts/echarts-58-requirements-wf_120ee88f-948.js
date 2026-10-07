export const meta = {
  name: 'echarts-58-requirements',
  description: 'Implement 58 ECharts requirements in file-disjoint clusters, one commit per requirement',
  phases: [
    { title: 'Implement', detail: '21 cluster agents implement + commit their requirements sequentially' }
  ]
}

const COMMON = `You are implementing requirements in the Apache ECharts repository at /workspace.
The source state is ECharts v5.5.0 (TypeScript, sources under src/). Each requirement corresponds to a REAL upstream
apache/echarts pull request whose number is given below. Implement the change the way upstream did wherever you can
recall it, and ALWAYS use exactly the public option/field names quoted in the requirement text.

WORKFLOW RULES
- First read your requirement file: /workspace/requirements/<slug>.yaml (full acceptance criteria).
- Explore the real code with Grep/Read before editing. Make surgical edits with the Edit tool; never rewrite whole files.
- Keep TypeScript compiling. When you add a public option you MUST also extend its option interface
  (e.g. src/coord/axisCommonTypes.ts, src/util/types.ts, or the relevant series/component *Model.ts option interface),
  otherwise \`npx tsc --noEmit\` will fail. Also remember that many option types are consumed by test/ut and by
  the dts build.
- Verify with: cd /workspace && npx jest --config test/ut/jest.config.cjs --coverage=false <testPathPattern>
  The whole suite runs in ~15s: \`npx jest --config test/ut/jest.config.cjs --coverage=false\`.
  You may run \`cd /workspace && npx tsc --noEmit\` at the END of your cluster (it takes ~60s) to confirm types.
- ADD A FOCUSED UNIT TEST whenever the behaviour is headlessly testable. Put it under test/ut/spec/... following the
  existing layout (look at neighbours for the mandatory Apache license header at the top of every new .ts file, and
  for the \`createChart\` helper in test/ut/core/utHelper.ts). Any test you add MUST pass before you commit.
- NEVER run: npm install, npm run build, git add, git commit, git checkout, git reset, git stash, git clean.
  Other agents are concurrently editing OTHER files in this same working tree. Do not touch files outside your
  cluster scope; if you think you must, note it in your report instead of doing it.
- If a file you need was already changed by another cluster, just work with its current content.

COMMIT PROTOCOL (mandatory, one commit per requirement)
After you finish and verify EACH requirement, run:
    /tmp/commit_req.sh <slug> <path1> <path2> ...
listing every file you created/changed for THAT requirement only, as paths relative to /workspace.
The script serializes via flock, stages only those paths, writes requirement_patches/<slug>.diff and commits.
It prints "COMMITTED <slug> (<sha>)" on success. On error it explains why - fix the cause and rerun it.
Work strictly one requirement at a time: implement -> verify -> commit -> next requirement.
Never batch two requirements into one commit. Never leave a requirement uncommitted.

Finally return the JSON report described by your output schema.`;

const CLUSTERS = [
  {
    name: 'aria',
    scope: 'src/visual/aria.ts, src/component/aria/**, src/util/types.ts (AriaOption area only), test/ut/spec/component/aria*.test.ts',
    reqs: [
      { slug: 'aria-ssr-safety', pr: 19892, hint: `src/visual/aria.ts setLabel() does \`const dom = api.getZr().dom; dom.setAttribute(...)\`. In SSR mode (zrender ssr painter) there is no dom, so this throws. Guard it: read the dom once and bail out (or skip only the DOM writes) when it is null/undefined, without skipping the decal work. Browser behaviour must be unchanged.` },
      { slug: 'aria-chart-role-img', pr: 20050, hint: `In src/visual/aria.ts, alongside setting the aria-label attribute on the zrender dom, also set \`role="img"\` on the same container element. Must stay SSR-safe (see previous requirement) and must not change rendering.` },
      { slug: 'aria-label-data-exclusion', pr: 20218, hint: `Add support for \`aria.label.data.excludeDimensionId\` (an array of dimension indexes). In src/visual/aria.ts where the per-data-item label is built from \`data.getValues(i)\`, omit the listed dimension indexes from the joined value string while KEEPING the remaining values in their original order. Must NOT mutate the series data (do not splice the array returned by getValues if it is shared - build a filtered copy). Extend the aria label option interface in src/util/types.ts (AriaLabelOption -> label -> data) with \`excludeDimensionId?: number[]\`. Commit ONLY the src changes here; the test belongs to the next requirement.` },
      { slug: 'aria-test-20218', pr: 20484, hint: `Add the regression test for the previous requirement: test/ut/spec/component/aria.test.ts (create it, with the Apache header). Build a chart with a dataset whose rows carry extra helper columns, set \`aria: { enabled: true, label: { data: { excludeDimensionId: [...] } } }\`, then assert (a) the excluded column values do NOT appear in the container element's aria-label, (b) the remaining values DO appear, and (c) the source series data is untouched (getValues still returns every original value). Use test/ut/core/utHelper.ts createChart. Commit ONLY the test file(s).` }
    ]
  },
  {
    name: 'axis',
    scope: 'src/coord/axisTickLabelBuilder.ts, src/coord/axisCommonTypes.ts, src/coord/Axis.ts, src/coord/axisHelper.ts, src/component/axis/** , src/coord/cartesian/**, src/coord/single/**, src/scale/**, test/ut/spec/coord/**, test/ut/spec/component/axis/**',
    reqs: [
      { slug: 'axis-custom-values', pr: 19919, hint: `Add \`customValues\` to BOTH \`axisTick\` and \`axisLabel\` option types (src/coord/axisCommonTypes.ts: AxisTickOption / AxisLabelOption, value like \`(number | string | Date)[]\`). Implement in src/coord/axisTickLabelBuilder.ts: in createAxisTicks() honour \`tickModel.get('customValues')\` and in createAxisLabels() honour \`labelModel.get('customValues')\`, producing tick/label entries at exactly those values (for ordinal axes map through the scale; for time/value axes use the parsed numeric value, and filter out values outside the axis extent). Labels must go through the normal label formatter so time axes format correctly. When customValues is absent the existing automatic behaviour must be byte-identical. Add a unit test.` },
      { slug: 'axis-ticks-grid-overflow', pr: 20194, hint: `With dataZoom the first/last band tick can be drawn outside the grid. Look at src/coord/Axis.ts (getTicksCoords / fixOnBandTicksCoords - it already has a \`clamp\` notion) and src/coord/axisTickLabelBuilder.ts / src/component/axis/AxisBuilder.ts. Make the tick coords stay inside the axis extent (clamp/filter the out-of-range edge ticks) so ticks never overflow the grid area, while normal non-zoomed rendering is unchanged.` },
      { slug: 'splitline-min-max-lines', pr: 20114, hint: `Add \`showMinLine\` and \`showMaxLine\` (both default true) to the splitLine option (src/coord/axisCommonTypes.ts AxisSplitLineOption or the equivalent interface) and honour them where split lines are drawn (src/component/axis/CartesianAxisView.ts _splitLine, plus SingleAxisView if it shares the logic): when showMinLine is false do not draw the split line that sits on the axis minimum boundary, likewise showMaxLine for the maximum boundary. Absent options => unchanged behaviour. Add a unit test if practical.` },
      { slug: 'inversed-time-bandwidth', pr: 20246, hint: `src/coord/Axis.ts getBandWidth() computes the band width from the axis extent; with \`inverse: true\` on a time (or value) axis the extent is descending so the result is negative/wrong, distorting bar width. Fix so the returned band width is the correct positive magnitude for inversed axes (Math.abs of the span), keeping ordinal/non-inversed results identical. Add a unit test.` }
    ]
  },
  {
    name: 'time',
    scope: 'src/util/time.ts, test/ut/spec/util/time.test.ts',
    reqs: [
      { slug: 'time-meridian-template', pr: 19888, hint: `src/util/time.ts formatTpl/format handles tokens like {yyyy} {MM} {dd} {HH} {hh} {mm} {ss} {SSS}. Add meridian tokens: \`{a}\` -> lowercase 'am'/'pm' and \`{A}\` -> uppercase 'AM'/'PM', derived from the hours in the same UTC/local mode as the other tokens (hour < 12 => am). Careful about replacement order so existing tokens are unaffected (e.g. do not let {a} clash with other single-letter handling). Extend test/ut/spec/util/time.test.ts with morning/afternoon cases.` }
    ]
  },
  {
    name: 'bar-pictorial',
    scope: 'src/chart/bar/BarView.ts, src/chart/bar/PictorialBarView.ts, src/chart/bar/**, test/ut/spec/chart/bar/**',
    reqs: [
      { slug: 'bar-bordercolor-large-data', pr: 20465, hint: `src/chart/bar/BarView.ts large-data path (createLarge / the LargePath \`useStyle\` call) applies borderColor in a way that ends up hiding/overriding the bar fill colour. Make the large path keep its fill (bar colour) while still applying border/stroke styling from itemStyle.borderColor + borderWidth. Add a unit test if practical.` },
      { slug: 'pictorialbar-zero-symbol-flip', pr: 20300, hint: `src/chart/bar/PictorialBarView.ts computes symbol scale/size with a sign derived from the bar's value or layout; a value of exactly 0 makes the sign flip so the image/path symbol renders mirrored. Make zero values keep the non-flipped orientation (treat 0 like a positive/normal direction rather than negative). Look for where symbolSize / boundingLength / \`symbolScale\` sign or \`isValid\`/\`opposite\` is computed.` },
      { slug: 'pictorial-zero-value-flipping', pr: 20557, hint: `Follow-up to the previous fix: the zero-value orientation must be correct for all four combinations - horizontal, horizontal + inverse axis, vertical, vertical + inverse axis - and for both image symbols and path symbols. Derive the direction from the axis orientation/inversion rather than from the sign of the (zero) value, in src/chart/bar/PictorialBarView.ts. Non-zero bars keep their existing direction logic.` }
    ]
  },
  {
    name: 'data',
    scope: 'src/data/SeriesData.ts, src/data/helper/**, src/util/number.ts, src/processor/dataSample.ts, src/model/Series.ts, test/ut/spec/data/**, test/ut/spec/util/number.test.ts, test/ut/spec/processor/**',
    reqs: [
      { slug: 'bigint-data-handling', pr: 19847, hint: `Data containing JS BigInt crashes value detection/parsing (e.g. \`+value\` or arithmetic on a bigint throws "Cannot convert a BigInt value to a number"; also isNaN/parseFloat paths). Look at src/util/number.ts (numericToNumber, parseDate), src/data/helper/dataValueHelper.ts (parseDataValue) and src/data/helper/sourceHelper.ts / dataProvider value detection. Make ingestion BigInt-tolerant so nothing throws: detect \`typeof v === 'bigint'\` and convert with Number(v) where a number is expected (or return NaN), leaving all existing numeric/string/Date paths byte-identical. Add a unit test that passing BigInt data does not throw.` },
      { slug: 'seriesdata-rawindexof-npe', pr: 20534, hint: `src/data/SeriesData.ts rawIndexOf(dim, value) does \`const invertedIndices = ...[dim]\` then indexes into it; when the dimension has no inverted index it throws (in __DEV__ it may also assert). Make it return the existing INDEX_NOT_FOUND constant instead of throwing in production execution, keeping the dev-time error/warning if upstream had one. Add a unit test in test/ut/spec/data/SeriesData.test.ts.` },
      { slug: 'linked-data-npe', pr: 19901, hint: `\`seriesData.getLinkedData\` (src/data/helper/linkSeriesData.ts, consumed in src/model/Series.ts getData/getAllData and possibly elsewhere) is called on data that has no linked datasets, causing a null/undefined dereference. Harden the call sites / the helper so a missing linked dataset degrades gracefully (return the main data or undefined) rather than throwing. Grep for getLinkedData / getLinkedDataAll to find every call site.` },
      { slug: 'minmax-sampling-behavior', pr: 20315, hint: `src/processor/dataSample.ts \`minmax\` sampler picks the wrong point in some buckets (it should preserve each interval's local min and max, and emit them in the correct order/position). Fix the sampler (compare using the actual magnitude, track both min and max index per frame, and return them in data order). Other samplers (average, max, min, sum, lttb, nearest) must be untouched. Add a unit test.` }
    ]
  },
  {
    name: 'boxplot',
    scope: 'src/chart/boxplot/**, test/ut/spec/chart/boxplot/**, test/ut/spec/series/boxplot*',
    reqs: [
      { slug: 'boxplot-encode-category-axis', pr: 20324, hint: `A dataset-driven boxplot with \`series.encode\` on a category axis maps the encoded dimensions wrongly (boxes misplaced/missing). Inspect src/chart/boxplot/BoxplotSeries.ts (getInitialData / dimensions setup) and src/chart/boxplot/boxplotLayout.ts. Boxplot needs its base (category) dimension plus 5 value dimensions; honour the user's encode for both the category dimension and the value dimensions instead of assuming fixed positions. Add a unit test that a dataset + encode boxplot yields the expected categories and box values.` }
    ]
  },
  {
    name: 'calendar',
    scope: 'src/component/calendar/**, src/coord/calendar/**, test/ut/spec/component/calendar/**',
    reqs: [
      { slug: 'calendar-label-silent', pr: 20492, hint: `Support \`silent\` on calendar \`dayLabel\`, \`monthLabel\` and \`yearLabel\`. In src/component/calendar/CalendarView.ts the label graphic.Text elements are created (_renderDayText/_renderMonthText/_renderYearText or similar) - pass \`silent: labelModel.get('silent')\` per label type so pointer events are ignored while visuals/positioning stay identical. Add the \`silent?: boolean\` field to the corresponding label option interfaces in src/coord/calendar/CalendarModel.ts. Each of the three must work independently; omitted/false keeps current behaviour. Add a unit test if practical.` }
    ]
  },
  {
    name: 'candlestick',
    scope: 'src/chart/candlestick/**, test/ut/spec/chart/candlestick/**',
    reqs: [
      { slug: 'candlestick-non-normal-states', pr: 20105, hint: `Since v5.0.0 candlestick lost non-normal (emphasis / blur / select) state style support. In src/chart/candlestick/CandlestickView.ts the box elements get their normal style via useStyle/setItemGraphicEl but never receive state styles. Restore it: apply \`setStatesStylesFromModel(el, itemModel)\` (from src/util/states.ts) or explicitly build emphasis/blur/select styles from \`itemModel.getModel(['emphasis','itemStyle'])\` etc., plus toggleHoverEmphasis/enableHoverEmphasis wiring as done for bar/pie, honouring the series-level emphasis/blur/select config and focus/blurScope. Normal rendering must be unchanged. Add a unit test asserting the emphasis state style exists on the element.` }
    ]
  },
  {
    name: 'custom',
    scope: 'src/chart/custom/**, src/chart/custom.ts, src/export/**(only if needed for registration), test/ut/spec/series/custom.test.ts',
    reqs: [
      { slug: 'reusable-custom-series', pr: 20226, hint: `Add \`itemPayload\` to the custom series option (src/chart/custom/CustomSeries.ts CustomSeriesOption) - an arbitrary object. In src/chart/custom/CustomView.ts, where renderItem params are built (\`makeRenderItemParams\` / the CustomSeriesRenderItemParams object), expose the same object as \`params.itemPayload\`. Add \`itemPayload: unknown\` (or a suitable generic) to the CustomSeriesRenderItemParams interface. When no payload is provided everything must behave exactly as before. Add a unit test in test/ut/spec/series/custom.test.ts asserting renderItem receives params.itemPayload.` },
      { slug: 'custom-renderitem-compoundpath', pr: 20402, hint: `Support element type \`compoundPath\` returned from a custom series renderItem. In src/chart/custom/CustomView.ts (createEl / the element-type switch that maps 'path','image','text','group', etc.) add a branch creating zrender's CompoundPath (import { CompoundPath } from 'zrender/src/graphic/CompoundPath' or via src/util/graphic.ts) and honour \`shape.paths\` when constructing it. Also allow the type in the custom element option types (src/chart/custom/CustomSeries.ts: the CustomElementOption union / TransitionOptionMixin). An invalid compound definition (missing shape.paths) should still fail loudly in __DEV__ rather than silently misrender. Add a unit test.` },
      { slug: 'custom-series-installer', pr: 20329, hint: `Provide installer-based registration for reusable custom series so they can be registered through the standard modular install flow (like other chart types). Look at src/extension.ts (\`use\`, EChartsExtensionInstallRegisters), src/chart/custom/install.ts and how registerCustomSeries-style APIs are wired. Implement an installer/registration API (e.g. a \`registerCustomSeries(seriesType, renderItem)\`-style register on the install registers plus an exported installer) that reuses the itemPayload work from the earlier requirement, keeping all existing custom-series usage working. Keep it minimal, typed, and exported where other installers are exported. Add a unit test that a custom series registered through the installer renders.` }
    ]
  },
  {
    name: 'geo-map',
    scope: 'src/coord/geo/**, src/component/geo/**, src/chart/map/**, src/component/helper/roamHelper.ts, src/component/helper/RoamController.ts, src/component/helper/interactionMutex.ts, src/action/roamHelper.ts, test/ut/spec/coord/geo*, test/ut/spec/chart/map/**, test/ut/spec/component/geo/**',
    reqs: [
      { slug: 'roamcontrollerhost-import-path', pr: 20313, hint: `Some module imports the \`RoamControllerHost\` type from the wrong path. Grep for \`RoamControllerHost\` - it is declared in src/component/helper/roamHelper.ts. Fix any import that points at the wrong module (e.g. importing it from RoamController.ts) so it resolves from the correct location. Runtime behaviour unchanged; \`npx tsc --noEmit\` must still pass.` },
      { slug: 'georoam-totalzoom-event', pr: 19837, hint: `Add a \`totalZoom\` parameter to the \`georoam\` event payload: the accumulated zoom ratio of the geo/map view after the roam. See src/component/geo/GeoView.ts / src/component/helper/roamHelper.ts (updateViewOnZoom) and the geoRoam action in src/action/roamHelper.ts + src/component/geo/install.ts. Track the cumulative zoom (e.g. from the view's current zoom on the model) and include it as \`totalZoom\` in the dispatched action/event params, while keeping existing fields working. Add a unit test that dispatching geoRoam zooms and the georoam event exposes totalZoom.` },
      { slug: 'geojson-region-styling', pr: 20561, hint: `Support region styling embedded in the source GeoJSON: a feature's \`properties.echartsStyle\` should become that region's default styling for geo rendering. Parse it in src/coord/geo/parseGeoJson.ts (attach it to the created Region, e.g. as \`region.properties\` already exists - store the style) and consume it in the geo view (src/component/geo/GeoView.ts / src/chart/map/MapView.ts region style resolution) so it is used as the default under user-specified geo.regions style. GeoJSON without echartsStyle must render exactly as before.` },
      { slug: 'geojson-region-styling-2', pr: 20564, hint: `Make the GeoJSON \`properties.echartsStyle\` default a first-class part of the region MODEL pipeline instead of a view-only patch, so it works for \`series.map\` too - including regions that exist only in the source map and not in the user's \`data\`/\`regions\`. Look at src/coord/geo/GeoModel.ts (getRegionModel / _optionModelMap / the regions option), src/chart/map/MapSeries.ts (getRegionModel / originalData / the data synthesis for missing regions) and src/coord/geo/geoCreator.ts. Synthesize region models/data entries for GeoJSON-styled regions so name-based lookup, rendering and labels stay complete. Add a unit test where a series.map picks up echartsStyle for a region with no matching data item.` },
      { slug: 'map-regions-silent', pr: 20566, hint: `Support \`silent\` per region: \`geo.regions[].silent\` and \`series.map\` region config. A silent region keeps its visuals but stops handling events / showing interactive affordances, while its neighbours stay interactive. Implement in the region rendering path (src/component/geo/GeoView.ts and/or src/chart/map/MapDraw.ts where each region group/compoundPath and its label are created) by setting \`silent\` on the region group when the region model says so, for both GeoJSON-backed and SVG-backed regions. Add \`silent?: boolean\` to the region option interfaces (src/coord/geo/GeoModel.ts RegionOption, src/chart/map/MapSeries.ts if separate). Also make sure it survives map data refresh (registerMap/updated map source). Add a unit test.` }
    ]
  },
  {
    name: 'line',
    scope: 'src/chart/line/**, test/ut/spec/chart/line/**',
    reqs: [
      { slug: 'stepped-line-area-nulls', pr: 20092, hint: `src/chart/line/LineView.ts \`turnPointsIntoStep\` (and the stackedOnPoints variant) builds the stepped polyline; with \`areaStyle\` the generated polygon geometry is skewed, and \`connectNull\` handling around null points is wrong near step transitions. Fix turnPointsIntoStep so (a) the stepped points used for the area polygon match the step geometry (same x/y progression for both the line and its stacked-on baseline) and (b) null gaps are only bridged when connectNull is true. Pass whatever extra context (e.g. connectNull flag) is needed. Add a unit test on the exported helper if it is exported, otherwise on the rendered path points.` },
      { slug: 'line-memory-reduction', pr: 20161, hint: `Reduce runtime memory of line rendering with NO visual/option/event change. Look at src/chart/line/LineView.ts and src/chart/line/poly.ts: candidates are avoiding retained duplicate Float32Array/point arrays (e.g. \`_points\`, \`_stackedOnPoints\`, \`_valueOrigin\` copies kept only for transitions), releasing them when animation is not needed, and reusing buffers instead of allocating new ones per render. Implement a conservative, correct reduction (e.g. do not keep the stackedOnPoints/step-points copies when they are not needed, null out retained references after use) and make sure the full unit-test suite still passes.` }
    ]
  },
  {
    name: 'pie',
    scope: 'src/chart/pie/**, test/ut/spec/chart/pie/**',
    reqs: [
      { slug: 'pie-empty-circle-endangle', pr: 19642, hint: `When a pie series has no data, src/chart/pie/PieView.ts renders an "empty circle" placeholder (createEmptyCircle / the \`_emptyCircleSector\`) using startAngle but a hardcoded full sweep, ignoring the configured \`endAngle\`. Make the placeholder honour the series \`endAngle\` (and startAngle) exactly like a normal pie would, so partial-ring designs keep their geometry. Add a unit test asserting the empty-circle sector shape's endAngle.` },
      { slug: 'pie-label-visibility', pr: 20074, hint: `Pie labels that should be visible are sometimes dropped by the label layout. Look at src/chart/pie/labelLayout.ts (the constrainTextWidth / avoidOverlap / \`isPositionCenter\` and the \`ignoreLabelLineWidth\`/\`recalculateXOnSemiToAlignOnEllipseCurve\` logic and where \`label.ignore = true\` / \`labelLine.ignore\` is set). Fix the condition so labels that fit in the final layout are not incorrectly hidden, without breaking overlap avoidance or creating duplicates. Add a unit test if practical.` }
    ]
  },
  {
    name: 'sankey',
    scope: 'src/chart/sankey/**, test/ut/spec/chart/sankey/**',
    reqs: [
      { slug: 'sankey-border-radius', pr: 19763, hint: `Support \`itemStyle.borderRadius\` on sankey series nodes. In src/chart/sankey/SankeyView.ts the node rects are created (graphic.Rect with shape x/y/width/height); read borderRadius from the node itemStyle model and set \`shape.r\` (accept number or number[] like other ECharts radius options, via the same normalization used elsewhere - e.g. zrender rect \`r\`). Add \`borderRadius?: number | number[]\` to the sankey itemStyle option type in src/chart/sankey/SankeySeries.ts. Unset => current sharp corners. Add a unit test.` },
      { slug: 'sankey-undefined-options', pr: 20380, hint: `A sankey option with \`links\`/\`edges\`, \`nodes\`/\`data\` or \`levels\` undefined throws. Guard those in src/chart/sankey/SankeySeries.ts (getInitialData, and the levels handling in \`_levelModels\`/getLevelModel), src/chart/sankey/sankeyLayout.ts and src/chart/sankey/sankeyVisual.ts - default to empty arrays instead of dereferencing undefined. Add a unit test creating a sankey with each field undefined and asserting no throw.` }
    ]
  },
  {
    name: 'tooltip',
    scope: 'src/component/tooltip/**, test/ut/spec/component/tooltip/**',
    reqs: [
      { slug: 'tooltip-legend-name-xss', pr: 20045, hint: `A legend/series name containing HTML flows unescaped into the tooltip HTML. Find where the name is put into tooltip markup (src/component/tooltip/tooltipMarkup.ts - the \`nameStyle\`/name block in buildSection/buildNameValue, and src/component/tooltip/TooltipView.ts) and escape it with \`encodeHTML\` from src/util/format.ts when the renderMode is 'html'. Do not double-escape values already escaped, and keep richText mode working. Add a unit test asserting the tooltip HTML contains the escaped text, not a live tag.` },
      { slug: 'tooltip-lineheight-default', pr: 20398, hint: `\`tooltip.textStyle.lineHeight\` is ignored by the default (non-formatter) tooltip HTML path. In src/component/tooltip/tooltipMarkup.ts / TooltipHTMLContent.ts, where the text style CSS is assembled (assembleFont / assembleCssText / the per-line style), include line-height from the textStyle model so multi-line default tooltips respect it. Existing text styling must keep working. Add a unit test.` },
      { slug: 'tooltip-notmerge-npe', pr: 20435, hint: `After \`setOption(option, true)\` (notMerge) the tooltip HTML layer can throw a null-pointer error during size/position update. In src/component/tooltip/TooltipHTMLContent.ts look at moveTo/_moveIfResized/getSize/update and the \`_styleCoord\`, \`el\`, \`_zr\`/\`this._api.getZr()\` accesses - guard the null/disposed cases so repositioning is a no-op instead of a crash. Add a unit test that setOption with notMerge twice + showTip does not throw.` }
    ]
  },
  {
    name: 'visualmap',
    scope: 'src/component/visualMap/**, test/ut/spec/component/visualMap/**',
    reqs: [
      { slug: 'visualmap-disabled-pointer-cursor', pr: 20551, hint: `With piecewise visualMap \`selectedMode: false\` the pieces still show a pointer cursor and look clickable. In src/component/visualMap/PiecewiseView.ts (_renderItems / the itemGroup creation with \`cursor: 'pointer'\` and the onclick binding) make the rendered pieces AND their labels non-interactive when selectedMode is false: no pointer cursor, silent display content, no click handler. Selectable modes ('single'/'multiple'/true) must behave exactly as today. Add a unit test asserting the cursor/silent difference.` },
      { slug: 'visualmap-handle-label-collision', pr: 20249, hint: `In a horizontal continuous visualMap using \`itemWidth/itemHeight\` sizing, the drag handle's label collides with neighbouring UI (the end text / the bar). In src/component/visualMap/ContinuousView.ts look at _updateHandle / the handle label positioning (\`handleLabels\`, \`_orient === 'horizontal'\`, textAlign/textVerticalAlign and the offset applied) and place the label so it no longer overlaps in the horizontal layout while vertical layouts stay unchanged.` }
    ]
  },
  {
    name: 'misc-series',
    scope: 'src/chart/gauge/**, src/chart/sunburst/**, src/chart/treemap/**, src/chart/helper/createClipPathFromCoordSys.ts, src/coord/polar/**, src/util/types.ts (emphasis focus type only), test/ut/spec/chart/gauge/**, test/ut/spec/chart/sunburst/**, test/ut/spec/chart/treemap/**',
    reqs: [
      { slug: 'gauge-negative-z2', pr: 20276, hint: `src/chart/gauge/GaugeView.ts derives a \`z2\` from the max value (something like \`z2: maxVal - value\` or using the value magnitude); with a negative max the z2 becomes negative, breaking stacking/visibility. Make the computed z2 always a valid non-negative ordering value (e.g. offset/clamp so relative ordering is preserved) so negative-max gauges render correctly and positive-value gauges are unchanged. Add a unit test.` },
      { slug: 'sunburst-relative-focus', pr: 20399, hint: `Add a new sunburst emphasis focus strategy \`'relative'\` that highlights the emphasized node together with BOTH its ancestors and its descendants. Look at src/chart/sunburst/SunburstView.ts / SunburstPiece.ts where focus 'ancestor' and 'descendant' are handled (they compute a list of node ids for \`focusSelf\`/\`focus\` on the emphasis state), and src/chart/sunburst/SunburstSeries.ts option type (the emphasis.focus union: extend it with 'relative'). Existing strategies keep their semantics. Add a unit test asserting the focus id list contains ancestors and descendants.` },
      { slug: 'treemap-custom-cursor', pr: 20113, hint: `Allow \`cursor\` on treemap node styling so authors can control the pointer over node content. In src/chart/treemap/TreemapView.ts where the node rect/background/content elements are created, read \`cursor\` from the node's itemStyle/model and apply it to the created elements (respecting the per-level/per-node model cascade). Add \`cursor?: string\` to the treemap item style option type in src/chart/treemap/TreemapSeries.ts. Omitted => current behaviour. Add a unit test.` },
      { slug: 'polar-coordinate-clipping', pr: 20370, hint: `Content in polar coordinates gets clipped when it should not. Look at src/chart/helper/createClipPathFromCoordSys.ts (createPolarClipPath - the r0/r/startAngle/endAngle it derives from the polar radius/angle axes) and src/coord/polar/**. Fix the clip geometry so legitimate content inside the polar area is not cut off (e.g. use the full angle range when the axis covers the whole circle, and the correct radius extent), while real boundary clipping still applies. Non-polar coordinate systems must be unaffected. Add a unit test if practical.` }
    ]
  },
  {
    name: 'legend-theme',
    scope: 'src/component/legend/**, src/theme/**, theme/**, test/ut/spec/component/legend/**',
    reqs: [
      { slug: 'legend-action-isolation', pr: 20129, hint: `Legend actions (legendToggleSelect / legendSelect / legendUnSelect / legendAllSelect / legendInverseSelect / legendScroll) leak across multiple legend components. In src/component/legend/legendAction.ts the handlers iterate \`ecModel.eachComponent('legend', ...)\` and mutate every legend. Make each action only affect the legend component(s) actually targeted by the payload (use the standard component finder: payload legendId / legendIndex / legendName via modelUtil, i.e. \`ecModel.eachComponent({mainType: 'legend', query: payload}, ...)\`), while a payload with no legend target keeps the current broadcast behaviour for backwards compatibility where upstream did. Targeted interaction must still work and single-legend charts must be unchanged. Add a unit test with two legends.` },
      { slug: 'dark-legend-page-text', pr: 20396, hint: `In the dark theme the legend pagination text keeps a light-mode colour. Fix src/theme/dark.ts (and the generated theme/dark.js if it is tracked in git) so the legend's \`pageTextStyle.color\` (and pageIconColor/pageIconInactiveColor if they are wrong too) are readable on the dark background. Light theme untouched.` }
    ]
  },
  {
    name: 'marker',
    scope: 'src/component/marker/**, test/ut/spec/component/marker/**',
    reqs: [
      { slug: 'marker-formatter-series-context', pr: 19898, hint: `Marker (markPoint / markLine / markArea) label formatter callbacks do not receive the series information other formatter APIs expose. In src/component/marker/MarkPointView.ts, MarkLineView.ts, MarkAreaView.ts and src/component/marker/markerHelper.ts, the label formatter callback params are built (getFormattedLabel / \`{componentType: 'markPoint', ...}\`); make sure the callback data includes the related series metadata (seriesId, seriesName, seriesIndex, seriesType and the data/value/name/dataIndex) consistently across all three marker types. Rendering with no custom formatter must be unchanged. Add a unit test asserting the formatter params.` },
      { slug: 'markline-symboloffset-2d-array', pr: 20491, hint: `Type-only fix: markLine \`symbolOffset\` must be allowed as a 2D array (a separate offset pair for each of the two end symbols). Update the markLine option type (src/component/marker/MarkLineModel.ts - the MarkLine2DDataItemOption / MarkLineOption \`symbolOffset\` declaration, likely reusing SymbolOffset from src/util/types.ts) so both the simple form and \`[[x0,y0],[x1,y1]]\` type-check. Runtime unchanged. Verify with \`npx tsc --noEmit\` and, if a dts test fixture exists (test/types/**), add a case there.` }
    ]
  },
  {
    name: 'datazoom',
    scope: 'src/component/dataZoom/**, test/ut/spec/component/dataZoom/**',
    reqs: [
      { slug: 'datazoom-handlelabel-show', pr: 20082, hint: `Add \`handleLabel.show\` to the slider dataZoom option so the handle value labels can be shown in the NORMAL state, while \`emphasis.handleLabel.show\` keeps controlling the emphasized/dragging state. See src/component/dataZoom/SliderZoomView.ts (_updateDataInfo / \`_displayables.handleLabels\`, and where it checks \`showDataShadow\`/emphasis state to decide label visibility) and src/component/dataZoom/SliderZoomModel.ts (defaultOption - add \`handleLabel: { show: false }\` and \`emphasis: { handleLabel: { show: true } }\` plus the option interface). Leaving the new option unset must preserve today's behaviour. Add a unit test.` },
      { slug: 'datazoom-movehandler-cursor', pr: 20304, hint: `The dataZoom slider move handle advertises a stronger drag cursor than intended. In src/component/dataZoom/SliderZoomView.ts find the moveHandle creation (\`cursor: 'move'\`) and change the move handler's cursor to the default cursor, keeping dragging behaviour and all other handle cursors (ew-resize / ns-resize) untouched.` }
    ]
  },
  {
    name: 'packaging-release',
    scope: 'package.json, package-lock.json, .npmignore, index.d.ts, build/**, src/i18n/**, i18n/**, src/core/echarts.ts (version only), .github/BRANCH_SYNC.md, test/ut/spec/package/**, test/ut/spec/release/**',
    reqs: [
      { slug: 'pt-br-translation', pr: 20348, hint: `Improve the Brazilian Portuguese locale in src/i18n/langPT-br.ts: make the toolbox titles, series type names, aria strings, time strings etc. read like natural pt-BR (compare with src/i18n/langEN.ts for the full key set and with the other locales for style; fill in anything left in English or awkwardly translated, keep every key and the placeholder tokens intact). Then regenerate the shipped bundle - the tracked generated files are i18n/langPT-br.js and i18n/langPT-br-obj.js, produced by \`node build/build-i18n.js\`. If that generator rewrites other locales too, include only your intended files in the commit and make sure you leave NO other modified files behind in the working tree (regenerate them all identically or restore them). Other locales must be unchanged.` },
      { slug: 'ws-7-5-10', pr: 20044, hint: `Dev-dependency bump of \`ws\` from 7.5.7 to 7.5.10. Grep package.json and package-lock.json for the ws 7.5.7 entries and update the version + resolved/integrity metadata consistently (ws 7.5.10 tarball: https://registry.npmjs.org/ws/-/ws-7.5.10.tgz, integrity sha512-2tJoLxlAuXOo8ATgHIu2AhbTOG5tTsxg1G7KthPFOVArDMhE0FdIcOSSfGiiXKrKxpEsJm9YNSuw+wpxjaDsAg==). If ws only appears as a transitive dep, still make sure the installed range resolves to 7.5.10 and record it as a devDependency the way upstream did. Do NOT run npm install.` },
      { slug: 'npm-package-ignore-files', pr: 19695, hint: `Tighten .npmignore so repo-only development material is not published: add the dev-only top-level dirs/files that consumers never need (e.g. /build, /extension-src, /test (already there), /asset, /KEYS, /licenses is legally needed so KEEP it, /theme/tool + /theme/thumb already there). Be conservative: never exclude anything required at runtime or for types (index.js, index.d.ts, lib/, types/, dist/, i18n/, theme/*.js, ssr/client/, extension/, LICENSE, NOTICE, package.json, README). Keep the existing entries.` },
      { slug: 'types-shared-import-path', pr: 20030, hint: `Since v5.5.0 the package's "exports" map means \`import('echarts/types/dist/shared')\` in a consumer .d.ts no longer resolves to \`echarts/types/dist/shared.d.ts\`. Fix package.json so that subpath resolves again: add explicit exports entries for the types subpath (e.g. "./types/dist/shared": { "types": "./types/dist/shared.d.ts" } and a "./types/*" mapping) and make sure nothing in .npmignore removes types/. Keep every existing export entry working.` },
      { slug: 'typescript-35-compatibility-tests', pr: 19696, hint: `Extend the DTS compatibility tooling so ECharts types are verified against TypeScript versions from 3.5 up through the newer supported compilers. Look at build/testDts.js and the "test:dts" script plus the @definitelytyped/typescript-versions devDependency: make the runner install/iterate the broader version range (>=3.5) instead of only the older set, and expose it through package.json scripts. Public typings must not change.` },
      { slug: 'release-v5-6-0', pr: 20556, hint: `Release engineering for 5.6.0: set package.json "version" to "5.6.0" and its "zrender" dependency to "5.6.1"; update src/core/echarts.ts \`export const version\` to '5.6.0' and \`dependencies.zrender\` to '5.6.1'; and add the new locale bundles langFA (Persian) and langSV (Swedish) - create src/i18n/langFA.ts and src/i18n/langSV.ts modelled exactly on an existing locale file (same keys/structure as src/i18n/langEN.ts, translated) and generate the shipped bundles i18n/langFA.js, i18n/langFA-obj.js, i18n/langSV.js, i18n/langSV-obj.js in the same format as the other tracked i18n bundles (\`node build/build-i18n.js\` produces them; verify against an existing generated file). Do NOT run the heavy dist rollup build. Do not change any other public behaviour. Leave no unintended modified files in the tree.` },
      { slug: 'master-into-v6', pr: 20101, hint: `This is pure branch-management (merge master into v6): it must NOT introduce any standalone feature and must NOT change version numbers, public API or runtime behaviour. Record the synchronisation in a maintainer note: create \`.github/BRANCH_SYNC.md\` (Apache-friendly plain markdown, no license header needed for .md) describing that master has been merged into the v6 line, what it covers (the fixes/features in this batch) and that no public behaviour changes beyond the merged source. Commit only that file.` },
      { slug: 'release-back-merge', pr: 20084, hint: `Also pure branch-management (merge the release branch back to master): no version bumps, no API or runtime change. Append a second section to \`.github/BRANCH_SYNC.md\` recording the release -> master back-merge and that public behaviour remains whatever the merged source defines. Commit only that file.` }
    ]
  },
  {
    name: 'tooling-ci',
    scope: '.vscode/**, .github/workflows/**',
    reqs: [
      { slug: 'workspace-typescript-prompt', pr: 20123, hint: `.vscode/settings.json already sets "typescript.tsdk". Add the setting that makes VS Code prompt contributors to use the workspace TypeScript version: \`"typescript.enablePromptUseWorkspaceTsdk": true\`. Keep valid JSON and keep the existing setting.` },
      { slug: 'forked-workflow-deps', pr: 20051, hint: `The preview-related GitHub workflows depend on an external third-party action that maintainers cannot update in a timely way. In .github/workflows/pr-preview.yml (and teardown-pr-preview.yml if it uses the same action) switch the action dependency to the project-maintained fork (apache/echarts-* / echarts-bot owned fork) pinned the way the other steps are pinned, keeping every input/step and the observable preview behaviour identical. Only change the action source (owner/repo[@ref]).` }
    ]
  }
];

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    cluster: { type: 'string' },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          committed: { type: 'boolean' },
          files: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
          notes: { type: 'string' }
        },
        required: ['slug', 'committed', 'files', 'summary']
      }
    },
    typecheckClean: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    leftoverUncommittedFiles: { type: 'array', items: { type: 'string' } }
  },
  required: ['cluster', 'requirements', 'typecheckClean', 'testsPass', 'leftoverUncommittedFiles']
};

function buildPrompt(c) {
  const list = c.reqs.map((r, i) =>
    `### ${i + 1}. slug: ${r.slug}  (upstream apache/echarts PR #${r.pr})\n${r.hint}`
  ).join('\n\n');
  return `${COMMON}

## YOUR CLUSTER: "${c.name}"
Your file scope (do not edit outside it): ${c.scope}

Implement the following ${c.reqs.length} requirement(s) IN THIS ORDER, committing each one separately with
/tmp/commit_req.sh before starting the next:

${list}

Remember: read /workspace/requirements/<slug>.yaml for each one - the yaml "Acceptance signals" section is the
contract you are graded on. Prefer the smallest faithful change that satisfies it. At the very end of the cluster,
run the full unit suite (\`cd /workspace && npx jest --config test/ut/jest.config.cjs --coverage=false\`) and
\`cd /workspace && npx tsc --noEmit\`, then run \`cd /workspace && git status --porcelain\` and report any file you
left uncommitted.`;
}

phase('Implement')
log(`Dispatching ${CLUSTERS.length} cluster agents for ${CLUSTERS.reduce((n, c) => n + c.reqs.length, 0)} requirements`)

const results = await parallel(CLUSTERS.map(c => () =>
  agent(buildPrompt(c), { label: `cluster:${c.name}`, phase: 'Implement', schema: REPORT_SCHEMA })
))

return results.map((r, i) => r || { cluster: CLUSTERS[i].name, failed: true })
