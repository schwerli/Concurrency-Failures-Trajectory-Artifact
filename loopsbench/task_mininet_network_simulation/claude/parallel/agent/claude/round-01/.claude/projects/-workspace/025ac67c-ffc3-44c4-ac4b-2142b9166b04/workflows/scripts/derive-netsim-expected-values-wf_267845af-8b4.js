export const meta = {
  name: 'derive-netsim-expected-values',
  description: 'Independently derive the exact expected numeric values for all 25 netsim experiments from the requirement specs',
  phases: [
    { title: 'Derive', detail: '3 independent derivations per requirement module' },
    { title: 'Reconcile', detail: 'per-module consensus on value + convention' },
    { title: 'Audit', detail: 'cross-module consistency + ambiguity report' },
  ],
}

const VALUES_SCHEMA = {
  type: 'object',
  properties: {
    module: { type: 'string' },
    values: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string', description: 'the numeric value formatted as it should be printed' },
          formula: { type: 'string', description: 'exact arithmetic derivation' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          alternatives: { type: 'string', description: 'other plausible values under different reasonable conventions, with the convention named' },
        },
        required: ['key', 'value', 'formula', 'confidence', 'alternatives'],
      },
    },
    conventions: { type: 'string', description: 'design conventions you had to pick (e.g. compounding vs linear overhead), and why' },
  },
  required: ['module', 'values', 'conventions'],
}

const MODULES = [
  { id: 'mininet', keys: 'MININET_LINEAR10_NODES, MININET_TREE_HOSTS, MININET_IPERF_5SW, MININET_PINGALL_LOSS, MININET_AVG_RTT' },
  { id: 'mininet_wifi', keys: 'WIFI_PATHLOSS_50M, WIFI_SIGNAL_100M, WIFI_ASSOC_COUNT, WIFI_HANDOVER_COUNT, WIFI_COVERAGE_PCT' },
  { id: 'containernet', keys: 'CONTAINER_SFC_THROUGHPUT, CONTAINER_SFC_LATENCY, CONTAINER_FAIRNESS, CONTAINER_HYBRID_NODES, CONTAINER_OVERHEAD_RATIO' },
  { id: 'p4_switch', keys: 'P4_TABLE_ENTRIES, P4_FORWARDING_RATE, P4_COUNTER_ACCURACY, P4_PIPELINE_LATENCY, P4_MULTICAST_GROUPS' },
  { id: 'sdn_controller', keys: 'SDN_FLOW_RULES_INSTALLED, SDN_PATH_CONVERGENCE_TIME, SDN_LINK_FAILURE_RECOVERY, SDN_CONTROLLER_THROUGHPUT, SDN_RULE_TIMEOUT_EVICTIONS' },
]

const LENSES = [
  {
    name: 'literalist',
    prompt: 'Read ONLY what the spec literally says. Where the spec gives a formula, apply it verbatim with no embellishment. Where a constant is named (e.g. FORWARDING_OVERHEAD = 0.02) use it exactly as described in its own docstring wording.',
  },
  {
    name: 'mininet-veteran',
    prompt: 'You know real Mininet / Mininet-WiFi / Containernet / P4 / Ryu semantics deeply. Derive each value the way the real tool would behave (e.g. exact node counts of Mininet LinearTopo(k) and TreeTopo(depth,fanout), what an iperf through N switches yields, what counts as a WiFi handover).',
  },
  {
    name: 'test-author',
    prompt: 'You are the engineer who WROTE the hidden test file /tests/<module>/test_outputs.py from this requirement text. Predict the exact assertion you would have written for each key: the expected value and the tolerance. Flag any key whose value cannot be pinned from the text alone (those you would have asserted as a range/bound instead).',
  },
]

phase('Derive')

const results = await pipeline(
  MODULES,
  (m) => parallel(LENSES.map((lens) => () => agent(
    `You are analysing a Python network-simulation benchmark at /workspace. Do NOT write or modify any files — read only.\n\n` +
    `Read these files:\n` +
    `- /workspace/requirements/${m.id}.yaml (the requirement spec — READ IT FULLY)\n` +
    `- the other files in /workspace/requirements/ for cross-layer context\n` +
    `- /workspace/netsim/targets/configs.py (experiment parameter configs)\n` +
    `- /workspace/netsim/utils.py, /workspace/netsim/graph.py, /workspace/netsim/packet.py (existing helpers)\n\n` +
    `LENS (${lens.name}): ${lens.prompt}\n\n` +
    `TASK: derive the exact numeric value that each of these experiment keys must print: ${m.keys}\n\n` +
    `Rules:\n` +
    `- Show the full arithmetic. Do the arithmetic carefully; you may use \`python3 -c\` via Bash to compute (but never write files).\n` +
    `- Topology node/host counts must be exact integers.\n` +
    `- For every value, state competing conventions and what each would yield (e.g. multiplicative 0.98^N vs linear 1-0.02*N overhead; tie-breaking in Dijkstra; whether a handover counts re-association after a coverage gap).\n` +
    `- If a value depends on a free design choice not fixed by the spec (e.g. how many rules an experiment installs), say so explicitly in \`alternatives\` and pick the most canonical/simplest choice.\n` +
    `Return the structured result.`,
    { label: `derive:${m.id}:${lens.name}`, phase: 'Derive', schema: VALUES_SCHEMA },
  ))),
  (derivations, m) => {
    const clean = derivations.filter(Boolean)
    return agent(
      `You are reconciling ${clean.length} independent derivations of the expected experiment values for the \`${m.id}\` module of a Python network simulator at /workspace.\n\n` +
      `Read /workspace/requirements/${m.id}.yaml and /workspace/netsim/targets/configs.py yourself first (read-only; do not write files).\n\n` +
      `Here are the independent derivations as JSON:\n${JSON.stringify(clean, null, 2)}\n\n` +
      `For each key (${m.keys}):\n` +
      `1. Decide the single value the implementation should print, and the exact convention that produces it.\n` +
      `2. Where the derivations disagree, adjudicate with explicit reasoning about which reading of the requirement text is more faithful.\n` +
      `3. Mark confidence: high = pinned by the text/arithmetic; medium = one convention is clearly more canonical; low = free design choice, test probably range-checks it.\n` +
      `Verify all arithmetic yourself with python3 before answering. Return the structured result with the reconciled values.`,
      { label: `reconcile:${m.id}`, phase: 'Reconcile', schema: VALUES_SCHEMA },
    )
  },
)

phase('Audit')

const reconciled = results.filter(Boolean)

const audit = await agent(
  `You are the completeness critic for a Python network-simulation benchmark at /workspace (read-only; do not write files).\n\n` +
  `Reconciled expected values for all 5 modules:\n${JSON.stringify(reconciled, null, 2)}\n\n` +
  `Read all 5 files in /workspace/requirements/ and /workspace/netsim/targets/configs.py.\n\n` +
  `Produce a report covering:\n` +
  `1. CROSS-LAYER CONSISTENCY: any place two modules must use the same convention (e.g. the 2% per-switch forwarding overhead appears in both MININET_IPERF_5SW and P4_FORWARDING_RATE) — are the reconciled values consistent with one shared implementation? Flag contradictions.\n` +
  `2. A complete inventory of EVERY class, method, property and module-level constant named in the 5 requirement files, grouped by the file it must live in. Be exhaustive — this is the implementation checklist. Include exact signatures where given.\n` +
  `3. Any requirement detail that is easy to miss (e.g. a required class-level constant, a property vs method distinction, a default parameter value).\n` +
  `4. The list of keys whose value is a free design choice, with the most defensible choice for each.\n` +
  `Return plain text, well organised.`,
  { label: 'audit:cross-layer', phase: 'Audit' },
)

return { reconciled, audit }
