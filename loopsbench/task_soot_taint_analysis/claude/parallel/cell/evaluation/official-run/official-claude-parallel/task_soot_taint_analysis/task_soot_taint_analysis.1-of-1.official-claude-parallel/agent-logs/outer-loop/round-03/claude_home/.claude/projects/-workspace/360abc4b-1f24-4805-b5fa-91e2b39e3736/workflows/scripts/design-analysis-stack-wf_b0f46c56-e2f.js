export const meta = {
  name: 'design-analysis-stack',
  description: 'Design the canonical API + metric contract for the soot/flowdroid/stubdroid analysis stack',
  phases: [
    { title: 'Survey' },
    { title: 'Spec' },
    { title: 'Judge' },
  ],
}

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    module: { type: 'string' },
    public_api: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string' },
          purpose: { type: 'string' },
          key_members: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'kind', 'purpose'],
      },
    },
    metric_keys: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, meaning: { type: 'string' } },
        required: ['key', 'meaning'],
      },
    },
    algorithm_notes: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['module', 'public_api', 'metric_keys', 'algorithm_notes'],
}

phase('Survey')
const survey = await agent(
  `Read /workspace fully: program_model.py, utils.py, run.sh, the existing partial /workspace/soot_analysis.py (note exactly where it stops), and every file in /workspace/benchmarks/.
Report, densely:
1. The exact statement "kind" values used across all 7 benchmarks and, for each kind, which fields are populated (lhs/rhs/rhs_vars/callee/args/receiver/field_ref/condition/true_target/false_target/metadata).
2. For each benchmark: entry points, expected_leaks entries, and the precise chain of statements a taint analysis must follow to reproduce each expected leak (cite stmt ids).
3. What soot_analysis.py already defines (list class names) and what is clearly still MISSING to satisfy: Jimple-like IR builder, Scene registry, CHA call graph, copy propagation, dead-code elimination, standalone main().
4. Any oddities an implementer would trip on (e.g. benchmark 04 stmt 4 receiver r2 never assigned; benchmark 06 library bodies; constant args like "\\"TAG\\"" and "0").
Be exhaustive and concrete. Cite file:line where useful.`,
  { label: 'survey-workspace' }
)

phase('Spec')
const MODULES = [
  {
    key: 'soot',
    prompt: `You are designing \`/workspace/soot_analysis.py\` — a Python work-alike of the Soot framework, layer 1 of a 3-layer static-analysis stack for Java-like programs described by /workspace/program_model.py.

Required content per the task statement: "Build the Jimple-like IR and the core whole-program analysis utilities, including CHA call-graph construction, the scene registry, copy propagation, and dead-code elimination."

Workspace survey:
---
{{SURVEY}}
---

Produce the definitive design contract: the public API surface a grader would most plausibly expect (using real Soot vocabulary: Jimple, Local, Constant, InstanceFieldRef, InvokeExpr variants, Unit/Stmt hierarchy, JimpleBody, SootField/SootMethod/SootClass, Scene with Scene.v(), Hierarchy, CallGraph + Edge + CHATransformer, UnitGraph/BriefUnitGraph/ExceptionalUnitGraph, CopyPropagator, DeadAssignmentEliminator, UnreachableCodeEliminator, PackManager/Transform, plus module-level convenience functions like build_scene/analyze_program/main).
Also design the standalone \`main()\` reporting: a list of KEY: VALUE metric lines (uppercase snake keys) that comprehensively cover IR construction, scene contents, hierarchy, CHA call graph, reachability, and each optimisation. Be generous — more keys is better than fewer — but each must be genuinely computable from the benchmarks.
Read the actual files in /workspace before answering.`,
  },
  {
    key: 'flowdroid',
    prompt: `You are designing \`/workspace/flowdroid_analysis.py\` — a Python work-alike of FlowDroid, layer 2, built on top of layer 1 (\`soot_analysis.py\`: Jimple IR, Scene, CHA CallGraph).

Required content: "Add the FlowDroid-style IFDS taint analysis on top of that IR and call graph, including access paths, taint facts, alias support, source/sink handling, and lifecycle-aware propagation."

Workspace survey:
---
{{SURVEY}}
---

Produce the definitive design contract: public API using real FlowDroid vocabulary (AccessPath with base local + field chain + taint-sub-fields flag, Abstraction/taint fact with source context and activation unit, SourceSinkManager / ISourceSinkDefinitionProvider, SourceSinkDefinition, ResultSinkInfo/ResultSourceInfo, InfoflowResults, TaintPropagationHandler, ITaintPropagationWrapper, Aliasing / AliasStrategy (flow-sensitive backwards alias search), BackwardsInfoflowProblem/InfoflowProblem, IFDSSolver with worklist over (unit, fact) path edges, normal/call/return/call-to-return flow functions, AndroidEntryPointCreator building a dummyMainMethod, lifecycle ordering for activity/service/receiver/provider, Infoflow / SetupApplication driver).
Explain precisely how each of the 7 benchmarks' expected leaks is derived, especially benchmark 02 (field sensitivity), 04 (aliasing via r5 = r4 then store to r4.data and load from r5.data), 05 (taint stored to this.imei in onCreate, read in onResume — requires lifecycle-aware inter-callback propagation through the dummy main), 06 (library summaries), and 07 (must report zero leaks).
Also design the standalone main() KEY: VALUE metric lines (uppercase snake keys), including per-benchmark leak counts and aggregate precision/recall/F1 vs expected_leaks.
Read the actual files in /workspace before answering.`,
  },
  {
    key: 'stubdroid',
    prompt: `You are designing \`/workspace/stubdroid_analysis.py\` — a Python work-alike of StubDroid, layer 3, built on layers 1 and 2.

Required content: "Finish with automatic library-summary generation plus the summary-aware taint wrapper and analysis layer."

Workspace survey:
---
{{SURVEY}}
---

Produce the definitive design contract: public API using real StubDroid vocabulary (MethodSummary / MethodFlow, FlowSource & FlowSink with SourceSinkType {Parameter, Field, Return, This, GapBaseObject}, AccessPathFragment, ClassSummaries / MethodSummaries / SummaryMetaData, IMethodSummaryProvider / LazySummaryProvider / EagerSummaryProvider / SummaryProvider from XML-like storage, SummaryGenerator + SummaryGeneratorConfiguration that runs an IFDS taint analysis per library method with all parameters/fields as sources and all parameters/fields/return as sinks, SummaryTaintWrapper implementing layer 2's ITaintPropagationWrapper, plus a driver that re-runs the layer-2 taint analysis with library bodies EXCLUDED and only summaries used).
Explain precisely how summary generation must work for benchmark 06's java.util.ArrayList.add (parameter0 -> this._elements) and get (this._elements -> return), and java.util.HashMap.put/get, and how the SummaryTaintWrapper then reproduces the expected leak without analysing the library bodies.
Also design the standalone main() KEY: VALUE metric lines (uppercase snake keys): summaries generated, flows per summary, wrapper hits, leaks found with/without summaries, precision/recall, etc.
Read the actual files in /workspace before answering.`,
  },
]

const specs = await parallel(
  MODULES.map((m) => () =>
    agent(m.prompt.replace('{{SURVEY}}', survey), {
      label: `spec:${m.key}`,
      phase: 'Spec',
      schema: SPEC_SCHEMA,
    })
  )
)

phase('Judge')
const merged = await agent(
  `Three module design contracts for a 3-layer Python static-analysis stack in /workspace were produced independently:

SOOT:
${JSON.stringify(specs[0], null, 1)}

FLOWDROID:
${JSON.stringify(specs[1], null, 1)}

STUBDROID:
${JSON.stringify(specs[2], null, 1)}

Workspace survey for reference:
${survey}

Your job: critique and unify them into ONE coherent implementation contract.
- Flag every place where layer 2's assumptions about layer 1's API (or layer 3's about layer 2's) do not line up, and pick the resolution.
- Flag any metric key that is ambiguous, redundant, or not computable; propose the final consolidated KEY list per module (uppercase snake, prefixed SOOT_/FLOWDROID_/STUBDROID_).
- Call out the top 10 correctness traps that will make a benchmark's expected leak be missed or a false positive be reported, with the concrete fix.
- Specify the exact cross-module import surface: what flowdroid_analysis.py must import from soot_analysis.py, and stubdroid_analysis.py from both.
Output prose, organised by module, dense and directive — it will be handed to the implementer verbatim.`,
  { label: 'unify-contract', effort: 'high' }
)

return { survey, specs, merged }
