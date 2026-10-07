export const meta = {
  name: 'derive-netsim-expected-values',
  description: 'Independently derive the 15 expected experiment values for containernet, p4_switch, sdn_controller from the requirement YAMLs and existing netsim conventions',
  phases: [
    { title: 'Derive', detail: 'independent derivations per module, multiple lenses' },
    { title: 'Adjudicate', detail: 'reconcile disagreements into a single value table' },
  ],
}

const CTX = `
You are analysing a Python network-simulation repo at /workspace. Read files with the Read tool.

Key context you MUST read before answering:
- /workspace/requirements/containernet.yaml, /workspace/requirements/p4_switch.yaml, /workspace/requirements/sdn_controller.yaml
- /workspace/netsim/targets/configs.py  (CONTAINERNET_EXPERIMENTS, P4_EXPERIMENTS, SDN_EXPERIMENTS drive the experiments)
- /workspace/netsim/net.py, /workspace/netsim/topo.py, /workspace/netsim/node.py, /workspace/netsim/graph.py, /workspace/netsim/utils.py
- /workspace/netsim/experiments/__init__.py (print_result: floats printed with %.2f, ints printed bare)
- /workspace/netsim/experiments/mininet_exp.py (established conventions)

Already-established conventions from the two completed layers (mininet, mininet_wifi), verified by running ./run.sh:
  MININET_LINEAR10_NODES: 20      (hosts+switches)
  MININET_TREE_HOSTS: 9           (TreeTopo(depth=2,fanout=3) -> 9 hosts, 4 switches)
  MININET_IPERF_5SW: 903.92       (= 1000 * 0.98**5 : each switch hop costs 2% throughput)
  MININET_PINGALL_LOSS: 0.00
  MININET_AVG_RTT: 14.67
A hidden test suite (/tests/<module>/test_outputs.py, NOT visible to us) checks the printed "KEY: VALUE" lines.
Your job is to predict, as accurately as possible, the value a faithful reference implementation of the
requirement text would print.

Be rigorous and arithmetic. Show the derivation. Where the requirement is ambiguous, enumerate the
candidate readings, give the number each produces, and state which is most likely intended and why.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['values'],
  properties: {
    values: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value', 'derivation', 'confidence', 'alternatives'],
        properties: {
          key: { type: 'string' },
          value: { type: 'string', description: 'exact printed string, e.g. "857.38" or "16"' },
          derivation: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          alternatives: { type: 'string', description: 'other plausible values and why they are less likely' },
        },
      },
    },
  },
}

const MODULES = [
  { key: 'containernet', keys: 'CONTAINER_SFC_THROUGHPUT, CONTAINER_SFC_LATENCY, CONTAINER_FAIRNESS, CONTAINER_HYBRID_NODES, CONTAINER_OVERHEAD_RATIO' },
  { key: 'p4_switch', keys: 'P4_TABLE_ENTRIES, P4_FORWARDING_RATE, P4_COUNTER_ACCURACY, P4_PIPELINE_LATENCY, P4_MULTICAST_GROUPS' },
  { key: 'sdn_controller', keys: 'SDN_FLOW_RULES_INSTALLED, SDN_PATH_CONVERGENCE_TIME, SDN_LINK_FAILURE_RECOVERY, SDN_CONTROLLER_THROUGHPUT, SDN_RULE_TIMEOUT_EVICTIONS' },
]

const LENSES = [
  'literal-spec lens: follow the requirement prose word-for-word, formula by formula, ignoring what "feels" natural',
  'config-driven lens: treat netsim/targets/configs.py as the authoritative parameter source; every constant in the config MUST be consumed by some experiment — if a config key is unused by your reading, your reading is probably wrong',
  'reference-implementer lens: imagine the most idiomatic Python a competent engineer would write for this spec, including tie-breaking in Dijkstra (heapq on (dist, name)) and ordered-vs-unordered host pairs, and compute what it prints',
]

phase('Derive')
const derived = await parallel(
  MODULES.flatMap(m =>
    LENSES.map((lens, i) => () =>
      agent(
        `${CTX}\n\nModule: ${m.key}. Derive the printed values for: ${m.keys}.\n\nUse this lens: ${lens}\n\n` +
        `Pay special attention to:\n` +
        ` - containernet: does startup_time_ms == STARTUP_OVERHEAD_MS (500) or STARTUP_OVERHEAD_MS+HOST_STARTUP_MS (510)? What ratio is printed?\n` +
        ` - p4_switch: how many forwarding rules does a 4-switch/1-host-per-switch P4 topology install across all tables? What exactly is "pipeline overhead" in P4_FORWARDING_RATE?\n` +
        ` - sdn_controller: SDN_FLOW_RULES_INSTALLED on TreeTopo(depth=2,fanout=3) — ordered vs unordered host pairs, rules per switch on path. SDN_LINK_FAILURE_RECOVERY — which topology does SDN_EXPERIMENTS["link_failure"] (num_switches=4, num_hosts_per_switch=1, failed_link=("s1","s2")) imply? Note /workspace/netsim/topo.py already contains RingTopo whose docstring says a ring "makes it the natural topology for link-failure-recovery experiments". Count affected paths precisely with heapq (dist, name) tie-breaking, and give both the "reinstall only affected paths" and "reinstall everything" numbers.\n` +
        ` - sdn_controller: SDN_RULE_TIMEOUT_EVICTIONS with num_rules=20, idle_timeout=10, current_time=15, idle_last_matched=0.0, active_last_matched=12.0.\n\n` +
        `Return the exact printed strings (floats use %.2f).`,
        { label: `${m.key}:lens${i + 1}`, phase: 'Derive', schema: SCHEMA }
      )
    )
  )
)

const table = {}
for (const r of derived.filter(Boolean)) {
  for (const v of (r.values || [])) {
    (table[v.key] = table[v.key] || []).push({ value: v.value, confidence: v.confidence, derivation: v.derivation, alternatives: v.alternatives })
  }
}

phase('Adjudicate')
const disputed = Object.entries(table).filter(([, vs]) => new Set(vs.map(v => v.value)).size > 1)
log(`${Object.keys(table).length} keys derived; ${disputed.length} disputed`)

const ADJ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value', 'rationale', 'runnerUp'],
  properties: {
    key: { type: 'string' },
    value: { type: 'string' },
    rationale: { type: 'string' },
    runnerUp: { type: 'string' },
  },
}

const rulings = await parallel(
  disputed.map(([key, vs]) => () =>
    agent(
      `${CTX}\n\nAdjudicate the expected printed value for experiment key ${key}.\n\n` +
      `Independent derivations disagreed:\n` +
      vs.map((v, i) => `--- derivation ${i + 1} (confidence ${v.confidence}) -> "${v.value}"\n${v.derivation}\nalternatives considered: ${v.alternatives}`).join('\n\n') +
      `\n\nRe-derive from first principles yourself (read the files), then pick the single most likely printed string. ` +
      `Weigh: (a) literal fidelity to the requirement prose, (b) consistency with the already-shipped mininet/mininet_wifi conventions, ` +
      `(c) whether every constant in netsim/targets/configs.py for that experiment is actually consumed, (d) which value a test author would most plausibly have recorded.`,
      { label: `adjudicate:${key}`, phase: 'Adjudicate', schema: ADJ_SCHEMA }
    )
  )
)

const final = {}
for (const [key, vs] of Object.entries(table)) {
  if (new Set(vs.map(v => v.value)).size === 1) final[key] = { value: vs[0].value, agreement: 'unanimous', rationale: vs[0].derivation.slice(0, 400) }
}
for (const r of rulings.filter(Boolean)) {
  final[r.key] = { value: r.value, agreement: 'adjudicated', rationale: r.rationale, runnerUp: r.runnerUp }
}

return { final, raw: table }
