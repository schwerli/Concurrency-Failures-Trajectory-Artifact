export const meta = {
  name: 'echarts-req-investigate',
  description: 'Locate exact code sites and propose precise edits for each ECharts requirement',
  phases: [
    { title: 'Investigate', detail: 'one agent per requirement: find files, lines, and propose exact edits' },
  ],
}

const SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'repo-relative paths that must be edited',
    },
    findings: {
      type: 'string',
      description: 'Detailed description of current code (with file:line refs and exact code snippets) and precisely what to change, including full replacement code where short. Be concrete enough that another engineer can apply it without re-reading the files.',
    },
    risks: { type: 'string', description: 'Anything ambiguous, or other call sites that must be updated in sync.' },
  },
  required: ['slug', 'files', 'findings', 'risks'],
}

const REQS = [
  ['axislabel-formatter-index', 'feat(axis): axisLabel `formatter` should receive the tick index as an additional argument, so it works with axisLabel.customValues. Find where axis label formatters are invoked (src/coord/axisTickLabelBuilder.ts, src/coord/Axis.ts, src/coord/axisCommonTypes.ts, src/component/axis/*, src/util/*). Report how labels/ticks are built for category/value/time/log axes and where formatter(value) is called, plus the TS types for AxisLabelFormatterOption.'],
  ['axislabel-formatter-indexing', 'fix(axis): when axisLabel.customValues is used, the formatter index passed must be the index of the rendered item in the filtered label list, preserved directly through the mapping instead of being looked back up via indexOf on the filtered tick list (which collapses duplicate values). Inspect src/coord/axisTickLabelBuilder.ts thoroughly: makeLabelsByCustomizedTicks / createAxisLabels / makeCategoryLabels / makeRealNumberLabels, and how tickValue->index is derived. Report exact code.'],
  ['bar-zero-size-labels', 'fix(bar): wrong label position when bar width/height is 0. Look at src/chart/bar/BarView.ts (getLabelStatesModels/setLabelStyle, `isPositive`/`labelPositionOutside` logic) and src/label/labelStyle.ts. Find where the sign of the bar rect width/height decides outside label position and report the exact code and the surrounding layout/inversion helpers.'],
  ['candlestick-series-encode-render', 'fix(candlestick): render error with series.encode. Look at src/chart/candlestick/candlestickLayout.ts, CandlestickSeries.ts, CandlestickView.ts. Find how dimension indices for open/close/lowest/highest are resolved (hard-coded 0..3 vs via data.getDimensionIndex / mapDimensionsAll) and how cartesian layout picks value/base dims. Report exact code.'],
  ['cartesian-small-number-rounding', 'Fix extreme small numbers cannot be displayed in Cartesian due to inappropriate rounding precision. Look at src/util/number.ts (round, getPrecision, getPrecisionSafe, nice, quantity), src/scale/helper.ts (intervalScaleNiceTicks, getIntervalPrecision), src/scale/Interval.ts, src/scale/Time.ts, src/scale/Log.ts, src/coord/scaleRawExtentInfo.ts. Report where fixed precision (e.g. round(x, 10) or toFixed) truncates tiny values.'],
  ['darkmode-lightness-algorithm', 'fix(theme): adjust dark mode color lightness algorithm. Find the dark-mode token/color derivation code, likely src/theme/dark.ts or src/model/mixin/palette / src/util/styleCompat / a token file such as src/theme/*.ts. Grep for "lightness", "darkMode", "lift", "liftColor", "toHex", "colorTool". Report the exact current algorithm code.'],
  ['datazoom-single-point-position', 'fix(dataZoom): wrong position when series has only one data point. Look at src/component/dataZoom/SliderZoomView.ts (_resetLocation/_positionInfo/getViewExtent) and src/component/dataZoom/helper.ts, and the axis extent when only one data point exists. Report exact code.'],
  ['gauge-progress-auto-color', "feat(gauge): progress.color supports 'auto'. Look at src/chart/gauge/GaugeSeries.ts (progress option type) and src/chart/gauge/GaugeView.ts (where progress itemStyle color is resolved; compare to how axisLine or itemStyle 'auto' color is resolved elsewhere e.g. getColor / visualMap). Report exact code."],
  ['jitter-overlap-avoidance', 'fix(jitter): fix overlap when there is enough space to avoid. Find the jitter implementation — grep for "jitter" in src/ (likely src/layout/jitter.ts or src/chart/helper/jitter.ts). Report the full current algorithm code verbatim (it is needed to rewrite the overlap-avoidance search).'],
  ['label-layout-margin', 'Fix/label layout margin: unify geometry rules for minMargin, textMargin, hidden-overlap handling and final label bounds after layout. Look at src/label/labelLayoutHelper.ts, src/label/LabelManager.ts, src/chart/pie/labelLayout.ts, src/label/labelStyle.ts, src/util/layout.ts. Report exact current code for margin handling, getBoundingRect/ getLocalTransform usage, shiftLayoutOnY, hideOverlap.'],
  ['labelline-smooth-reset', 'fix(label): labelLine `smooth` cannot be reset. Look at src/chart/helper/labelHelper.ts / src/label/labelGuideHelper.ts (buildLabelLinePath / setLabelLineStyle) and src/chart/pie/labelLayout.ts. Grep for "smooth" in src/label and src/chart/pie. Report exact code where smooth is applied to the guide-line polyline/points.'],
  ['line-areastyle-empty-dimension', "fix(line): areaStyle render error when dimension name is empty string. Look at src/chart/line/LineView.ts (getStackedOnPoints / turnPointsIntoStep / valueDim / stackedOnPoints, and where `dimension` name truthiness is checked e.g. `if (dim)`), and src/chart/line/lineAnimationDiff.ts, src/data/helper/dataStackHelper.ts. Grep for patterns testing a dimension name for truthiness rather than != null. Report exact code."],
  ['lines-loop-symbol-flip', 'fix(lines): effect symbol flip on unidirectional loop end when roundTrip is not enabled. Look at src/chart/helper/EffectLine.ts and EffectSymbol / src/chart/lines/*. Grep for "roundTrip" and the code computing symbol rotation from previous/current point. Report exact code.'],
  ['logscale-negative-exponent-rounding', 'fix(logScale): incorrect rounding usage, support data with big negative exponent. Look at src/scale/Log.ts (fixRoundingError, calcNiceExtent, getTicks, contain, normalize), src/util/number.ts round/ roundingErrorFix. Report exact code.'],
  ['marker-z-option', 'feat(marker): markPoint markLine markArea support z option. Look at src/component/marker/MarkerModel.ts, MarkPointView.ts, MarkLineView.ts, MarkAreaView.ts and how z/zlevel are applied to the created group / elements (compare with series z handling in src/view/Chart.ts / src/model/Series.ts). Report exact code.'],
  ['matrix-darkmode-colors', 'fix(matrix): dark mode colors. Look at src/coord/matrix/* (MatrixModel.ts, MatrixView.ts) and the dark theme file (grep for darkMode / theme/dark). Report the matrix default colors (borderColor, backgroundColor, divider color) and where dark theme overrides component defaults.'],
  ['matrix-dimension-length', 'feat(matrix): support matrix.x/y.length to create a headless matrix without composing an array. Look at src/coord/matrix/MatrixModel.ts and MatrixDim.ts (or similar), how matrix.x.data is parsed into dimension cells. Report exact code and the option types.'],
  ['matrix-label-api', 'Fix matrix label API: matrix labels should inherit option.textStyle like other labels; matrix coordinate locator ranges must handle invalid ranges including the coordClamp path. Look at src/coord/matrix/MatrixModel.ts, MatrixView.ts, matrixCoordHelper / dataToPoint / getCoordByLocator, and grep for "coordClamp". Report exact code.'],
  ['matrix-label-formatter', 'fix(matrix): matrix label formatter does not work (string template + callback). Look at src/coord/matrix/MatrixView.ts where cell/dimension-cell labels are created (setLabelStyle / labelHelper) and whether formatter is passed/evaluated. Report exact code plus how other components pass formatter + labelDataIndex/labelFetcher.'],
  ['parallel-axis-extent', 'fix(parallel): incorrect axis extent when a subsequent series has a larger value than the first. Look at src/coord/parallel/Parallel.ts and src/coord/parallel/parallelCreator.ts / ParallelAxis.ts, and the code in src/coord/parallel/* that unions series extents (grep for getDataExtent / unionExtent / niceScaleExtent). Report exact code.'],
  ['pie-tangential-noflip', "feat(pie): add 'tangential-noflip' rotation mode for label.rotate. Look at src/chart/pie/pieLayout.ts and src/chart/pie/labelLayout.ts, grep for 'tangential' and 'radial' rotate modes, and PieSeries.ts label rotate option type. Report exact code."],
  ['radar-blur-itemstyle', 'fix(radar): itemStyle of blur not working. Look at src/chart/radar/RadarView.ts — how symbols/polygon/polyline styles are set, and where emphasis/blur/select states are set (setStatesStylesFromModel / getModel("blur")). Report exact code verbatim (the whole _appendSymbol / update loop).'],
  ['radar-clockwise-option', 'feat(radar): add `clockwise` option to radar coordinate system. Look at src/coord/radar/Radar.ts, RadarModel.ts, IndicatorAxis.ts — how indicator angles are computed (startAngle, splitNumber, indicator count). Report exact code and option type.'],
  ['radar-style-precedence', 'fix(radar): state-specific styling precedence — emphasis.itemStyle and blur styling must not be overwritten by default symbol styling. Same files as radar-blur-itemstyle: src/chart/radar/RadarView.ts. Report the ordering of setStatesStylesFromModel vs symbol.setStyle / setItemStyle calls.'],
  ['sunburst-root-label-centering', 'fix(sunburst): root node label may not be centered for a full-circle root. Look at src/chart/sunburst/SunburstPiece.ts (label layout, where startAngle/endAngle difference decides centering), grep for "PI * 2" / "isRoot" / "center". Report exact code.'],
  ['time-axis-customvalues-formatter', 'fix(axis): chart breaks when using axisLabel.customValues with formatter in a time axis. Look at src/coord/axisTickLabelBuilder.ts (makeLabelsByCustomizedTicks) and src/scale/Time.ts (getFormattedLabel / getLabel signature) and src/util/time.ts. Report exact code showing how time axis labels are formatted and what breaks with custom values.'],
  ['toolbox-dataview-darkmode', 'fix(toolbox): dataView component does not fit dark mode. Look at src/component/toolbox/feature/DataView.ts — all inline styles (backgroundColor, color, textarea styles, button styles) and how it can read darkMode/ecModel textStyle. Report exact code.'],
  ['toolbox-emphasis-color', 'fix(toolbox): emphasis color should differ from default color. Look at src/component/toolbox/ToolboxModel.ts (iconStyle / emphasis.iconStyle defaults) and ToolboxView.ts. Report exact defaults.'],
  ['tooltip-listener-unbinding', 'fix(tooltip): memory leak — explicitly unbind event listeners. Look at src/component/tooltip/TooltipHTMLContent.ts (constructor addEventListener / _enterable handlers, dispose()) and TooltipView.ts dispose. Report exact code showing which listeners are bound and how dispose currently works.'],
  ['visualmap-darkmode-inrange', 'fix(visualMap): dark mode should not provide inRange. Find the dark theme definition providing visualMap inRange colors (grep "inRange" in src/theme, src/component/visualMap, src/model). Report exact code.'],
  ['visualmap-unbounded-range', 'feat(visualMap): support visualMap.unboundedRange for continuous visual map — when the selected range touches the configured min/max, that side becomes an open interval. Look at src/component/visualMap/ContinuousModel.ts (getSelectedMapKey / isValueActive / completeVisualOption / _resetRange), VisualMapModel.ts, and src/visual/VisualMapping.ts. Report exact code of the range-active checks.'],
  ['axis-min-max-nullable', 'fix(type): axis `min`/`max` callback should allow returning null/undefined. Find the TS type declaration, likely src/coord/axisCommonTypes.ts. Report exact declaration lines.'],
  ['graph-nodescaleratio-type', 'fix(type): graph series `nodeScaleRatio` option type should be `number` not a literal. Find it in src/chart/graph/GraphSeries.ts. Report exact declaration.'],
  ['slider-handlelabel-optional', 'fix(type): `emphasis.handleLabel` of slider dataZoom should be optional. Find in src/component/dataZoom/SliderZoomModel.ts. Report exact declaration.'],
  ['typescript-esm-compatibility', 'fix(types): remove export assignment to support TypeScript ESM compatibility; need distinct ESM and CJS declaration entrypoints. Inspect index.d.ts, package.json ("types", "exports", "typesVersions"), build/pre-publish.js (how .d.ts and types/dist are generated and what files are written), and any index.*.d.ts. Report exact code of index.d.ts and the relevant pre-publish.js sections verbatim.'],
  ['typescript-export-types', 'fix(type): missing or mismatched TS export types, especially series that combine coordinate-system mixins (calendar + matrix). Inspect src/export/option.ts (or src/export/*.ts) listing exported *SeriesOption types, and each series option interface in src/chart/*/ *Series.ts for which mixins (SeriesOnCartesianOptionMixin, SeriesOnCalendarOptionMixin, SeriesOnMatrixOptionMixin, etc.) they extend vs what they actually support at runtime (check coordinateSystem handling / src/coord/matrix and calendar create). Report the full current export list and per-series mixin lists.'],
  ['typo-cleanup', 'chore: fix typos in internal code and example data. Search src/ and test/ for common misspellings (e.g. "seperate", "occured", "recieve", "wether", "lenght", "widht", "hight", "compatable", "acturally", "successfull", "paramters", "postion", "nagative", "shoud", "atleast", "conatiner", "dimesion", "retrun", "seires", "verticle", "unkown", "labelInner", "trigerred", "orignal", "existance", "adjcent", "spacial"). Use ripgrep with a broad alternation and report the exact file:line and the misspelled identifier/word for each hit found in src/, build/, test/, extension-src/. Prefer typos in comments, error messages, and internal (non-public-API) identifiers.'],
]

phase('Investigate')

const results = await parallel(REQS.map(([slug, prompt]) => () =>
  agent(
    `You are investigating the Apache ECharts repository at /workspace (version 6.0.0-beta.1, TypeScript source under src/).

Requirement slug: ${slug}

Task: ${prompt}

Do NOT modify any files. Read the relevant code carefully (use rg/grep and Read). Your job is to produce an accurate, concrete implementation plan that another engineer can apply directly without re-reading much.

Requirements for your report:
- List every repo-relative file path that needs editing.
- Quote the EXACT current code (with file:line) at each site that must change.
- Give the exact replacement code where it is under ~40 lines.
- Note related call sites / type declarations that must change in sync.
- If tests exist under test/ut/spec that relate, name them.

Be precise and complete. Accuracy matters more than brevity, but do not dump whole files - quote only the relevant regions.`,
    { label: `inv:${slug}`, phase: 'Investigate', schema: SCHEMA }
  )
))

return results.filter(Boolean)
