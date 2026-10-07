export const meta = {
  name: 'netsim-implement-remaining-layers',
  description: 'Implement the containernet, p4_switch and sdn_controller layers of netsim, then adversarially verify each against its requirement spec',
  phases: [
    { title: 'Implement', detail: 'one agent per layer, disjoint file ownership' },
    { title: 'Verify', detail: '3 adversarial reviewers per layer (API surface / numerics / integration)' },
    { title: 'Synthesize', detail: 'single defect list ranked by severity' },
  ],
}

const COMMON = `
You are working in the Python network-simulation library at /workspace (repo root, run python from there).
The library already has TWO COMPLETE LAYERS you MUST build on and MUST NOT modify:
  netsim/node.py    Node, Host, Switch (FORWARDING_OVERHEAD=0.02, throughput_factor property), OVSSwitch, Controller
  netsim/link.py    Intf, Link, TCLink   (bw Mbps, delay ms one-way, loss percent)
  netsim/topo.py    Topo (addHost/addSwitch/addLink/hosts()/switches()/links()/nodeInfo/linkInfo),
                    SingleSwitchTopo, LinearTopo(k,n=1), TreeTopo(depth,fanout), MinimalTopo, RingTopo(k,n=1)
  netsim/net.py     Mininet: addHost/addSwitch/addController/addLink, build/buildFromTopo/start/stop,
                    total_nodes(), path(), path_link_attrs/path_bandwidth/path_delay/path_loss/path_switches,
                    switch_overhead_factor(), ping/pingAll/iperf/rtt/avg_rtt, graph (WeightedGraph)
  netsim/graph.py   WeightedGraph: add_node/add_edge/remove_edge/neighbors/get_edge/has_edge/nodes/shortest_path
                    (shortest_path minimises HOP COUNT and returns None when disconnected)
  netsim/utils.py   generate_ip, compute_bottleneck_bw, compute_path_delay, compute_path_loss_rate,
                    dbm_to_mw, mw_to_dbm, distance_2d, jains_fairness_index
  netsim/wifi/*, netsim/wifi_net.py  (the wireless layer - do not touch)
  netsim/experiments/__init__.py  print_result(name, value): floats print as f"{value:.2f}", everything else bare
  netsim/targets/configs.py  ALL experiment parameters. ALREADY FINAL - DO NOT EDIT.

HARD RULES
- Read your requirement yaml under /workspace/requirements/ IN FULL before writing anything. It is the source of truth
  for every class, method, property name and signature. Implement EVERY named symbol with the EXACT name and signature.
- Distinguish PROPERTIES from METHODS exactly as the spec words it. A property accessed as a method (or vice versa)
  is a silent failure.
- Class-level constants must be class attributes, not assigned in __init__.
- ONLY create/modify the files listed as YOUR FILES. Do NOT touch run.sh, configs.py, or any other layer's files.
- Do NOT run any git command. Do NOT edit files outside YOUR FILES.
- Reuse the existing substrate rather than reimplementing it (WeightedGraph for paths, jains_fairness_index for
  fairness, Mininet.iperf/switch_overhead_factor for throughput derating, Host/Switch/Topo/Mininet as base classes).
- Match the house style of netsim/net.py and netsim/topo.py: module docstring, concise docstrings on public members,
  no type annotations, 4-space indent, lines under 90 chars, no external deps beyond numpy.
- Values are printed via print_result, so INT-typed results must return real python ints and float-typed results
  real floats (returning 1 instead of 1.0 prints "1" not "1.00" and would fail the test).
- The experiments module must expose the named run_*_experiments() function, print one "KEY: VALUE" line per
  experiment via print_result, and have an if __name__ == "__main__" guard.
- Verify by running: python3 -m netsim.experiments.<your module>   and   python3 -m pytest agent_tests/ -q
  (all pre-existing tests must still pass).
- Also write your own pytest file at the path given in YOUR FILES, covering the full API surface of your layer and
  the exact printed values.
When you finish, return a short report: files written, the exact printed KEY: VALUE lines, any spec detail you had to
interpret, and anything you could not do.
`

const LAYERS = [
  {
    id: 'containernet',
    label: 'containernet',
    files: `netsim/container.py, netsim/sfc.py, netsim/containernet.py,
       netsim/experiments/containernet_exp.py, agent_tests/test_containernet.py`,
    spec: `
REQUIREMENT: /workspace/requirements/containernet.yaml  (Containernet 2.0, Peuster et al., NetSoft 2018)

Design decisions already fixed - implement exactly these, they are the expected outputs:
  CONTAINER_SFC_THROUGHPUT: 857.37   1000 * 0.95**3. Accumulate the VNF factors into a product FIRST
                                     (factor = 1.0; for each vnf: factor *= vnf.throughput_factor) and only then
                                     multiply by link_bw - exactly like net.py switch_overhead_factor does.
                                     That association yields 857.3749999999999 -> "857.37".
  CONTAINER_SFC_LATENCY:    5.00     num_links(=3+1=4) * 0.5ms + 3 * 1.0ms
  CONTAINER_FAIRNESS:       0.73     jains_fairness_index([1024,512,256,256]) = 8/11. Feed the raw cpu_shares of the
                                     DockerHosts (NOT cpu_fraction, which would be 1.0 for every container -> 1.00).
  CONTAINER_HYBRID_NODES:   7        int; 2 plain hosts + 3 DockerHosts + 2 switches via the inherited total_nodes()
  CONTAINER_OVERHEAD_RATIO: 50.00    DockerHost.startup_time_ms (= STARTUP_OVERHEAD_MS = 500.0, the TOTAL cost, NOT
                                     10.0+500.0) / HOST_STARTUP_MS (10.0)
Notes:
- DockerHost(Host) must set is_container = True as a CLASS attribute (Node.is_container is False) and must keep
  Host's namespace semantics. cpu_fraction is a PROPERTY: cpu_quota / cpu_period, and 1.0 when cpu_quota <= 0
  (guard on <= 0, not on None). Defaults: cpu_shares=1024, mem_limit_mb=512, cpu_period should default to the
  Docker default 100000 and cpu_quota to -1/0 meaning unlimited.
- Host.STARTUP_MS is already 10.0 in netsim/node.py and DockerHost.HOST_STARTUP_MS = 10.0 must denote the same
  baseline; startup_time_ms overrides Node.startup_time_ms.
- VNF and ServiceFunctionChain live in netsim/sfc.py. ServiceFunctionChain takes the VNF list plus link parameters
  (link_bw, link_delay); num_links is a PROPERTY = len(vnfs) + 1; compute_throughput() and compute_latency() are
  METHODS. The SFC formulas are self-contained: they must NOT pick up Switch.FORWARDING_OVERHEAD or container
  startup overhead. Give the chain a way to be built from VNF objects and also expose add_vnf.
- Containernet(Mininet) in netsim/containernet.py: addDocker(name, image, cls, **params) has that exact signature
  (cls should default to DockerHost when None/omitted - keep the positional order the spec gives); it must delegate
  to addHost so self.hosts stays authoritative; keep a self.dockers / docker hosts list too.
  compute_resource_fairness() uses utils.jains_fairness_index over the container cpu_shares. total_nodes() is
  INHERITED (do not reimplement). startup_overhead_ratio() = container startup / plain host startup.
- Config: CONTAINERNET_EXPERIMENTS["sfc_chain"|"resource_fairness"|"hybrid_topology"] in netsim/targets/configs.py.
  The hybrid topology experiment must actually BUILD a Containernet network (2 switches linked to each other,
  regular hosts and docker hosts attached) and read total_nodes() off it, not hardcode 7.
- Also model an SFC on a real Containernet instance where it is natural, but the printed SFC numbers must come from
  ServiceFunctionChain.compute_throughput()/compute_latency().`,
  },
  {
    id: 'p4_switch',
    label: 'p4_switch',
    files: `netsim/p4_switch.py, netsim/experiments/p4_exp.py, agent_tests/test_p4.py`,
    spec: `
REQUIREMENT: /workspace/requirements/p4_switch.yaml  (P4 programmable data plane)
ALL SEVEN classes go in the single file netsim/p4_switch.py:
  P4MatchActionTable, P4Parser, P4Deparser, P4Counter, P4Switch(Switch), P4Topology(Topo), P4MulticastGroup

Design decisions already fixed - implement exactly these, they are the expected outputs:
  P4_TABLE_ENTRIES:    16     int. P4Topology(num_switches=4, num_hosts_per_switch=1) -> s1..s4 in a linear chain,
                              h1..h4 (one per switch). Give EVERY switch one P4MatchActionTable named "ipv4_lpm"
                              matching on dst_ip, and install one destination-forwarding rule per host in the
                              topology on every switch (including for its own locally attached host):
                              4 switches x 4 destination hosts = 16 entries. Sum table.size() over all switches -
                              do not hardcode. The action for a local host is e.g. "forward" to the host port and
                              for a remote host "forward" out the next-hop port.
  P4_FORWARDING_RATE:  922.37 1000 * 0.98**4. Build the P4 topology in a Mininet instance and call
                              net.iperf([net.hosts[0], net.hosts[-1]]) (pass the pair EXPLICITLY - iperf's default
                              would measure h1<->h2 and give 960.40). P4Switch inherits Switch.FORWARDING_OVERHEAD
                              = 0.02 and MUST NOT override it.
  P4_COUNTER_ACCURACY: 1.00   float. Push P4_EXPERIMENTS["counter"]["num_packets"] packets through
                              P4Switch.process_packet and divide counter.total_packets() by the number sent.
  P4_PIPELINE_LATENCY: 1.50   float. pipeline_latency_us is a PROPERTY = 0.5 * number of tables in the pipeline;
                              a switch with 3 tables -> 1.5.
  P4_MULTICAST_GROUPS: 6      int. From P4_EXPERIMENTS["multicast"]["groups"] = ports [1,2,3] and [4,5,6]:
                              build a P4MulticastGroup per entry, replicate one packet through each and total the
                              returned copies: 3 + 3 = 6. Read the config; do not hardcode.
Notes:
- P4Parser/P4Deparser header_defs is {field_name: (offset, length)} over raw bytes. parse() returns a dict of the
  extracted fields (ints or bytes - be consistent and document it); is_valid() checks the packet is at least as long
  as the highest offset+length. deparse(headers, payload) rebuilds the packet bytes and must round-trip with parse()
  for any packet the parser accepts - test that round trip.
- P4MatchActionTable.lookup(packet_headers): a rule matches when every field in its match_dict equals the
  corresponding packet header value (a rule field absent from the packet does not match); the highest priority
  matching rule wins, and ties should resolve deterministically (earlier insertion wins). Respect max_size=1024
  (reject/refuse beyond it and say so in the docstring). add_rule's priority default is 0 (NOT 100).
  Support ternary/wildcard-free exact matching only, but do handle a rule field whose value is None as a wildcard
  only if you document it.
- P4Counter(name, size): fixed-size arrays of packet and byte counts; increment(index, packet_bytes) - take the index
  modulo size (or validate) so a flow hash cannot crash it; read(index) -> (packets, bytes) tuple;
  reset(index=None) resets ONE counter or ALL of them; total_packets()/total_bytes().
- P4Switch(Switch): __init__(self, name, program=None, **params); tables and counters registries preserving
  insertion order; set_parser/set_deparser; process_packet(packet_data) runs parse -> every table lookup in
  pipeline order (applying the matched action, at least recording the egress port / dropping on no match) ->
  deparse, increments the registered counter(s), and returns a result describing what happened (document the shape;
  a dict with the matched actions, egress port and the deparsed bytes is fine). get_table(name)/get_counter(name).
- P4Topology(Topo): __init__(self, num_switches, num_hosts_per_switch, **link_params) - build() must accept those
  and thread **link_params into every addLink (same as LinearTopo); addP4Switch(name, **params) registers the switch
  AND records it as P4-capable (e.g. self.p4_switches list plus an isP4/is_p4 marker in nodeInfo).
  Naming must be s1..sN and h1..hM like LinearTopo so the Mininet engine and generate_ip stay consistent.
  Make sure the topology can be handed to Mininet(topo=..., switch=P4Switch) so the built switches are P4Switches.
- P4MulticastGroup(group_id, ports): replicate(packet_data) -> list of (port, packet_data) tuples, one per member
  port, in port order; add_port/remove_port must be idempotent-safe.
- Config: P4_EXPERIMENTS in netsim/targets/configs.py has "topology", "counter", "pipeline", "multicast" entries.`,
  },
  {
    id: 'sdn_controller',
    label: 'sdn_controller',
    files: `netsim/sdn_controller.py, netsim/experiments/sdn_exp.py, agent_tests/test_sdn.py`,
    spec: `
REQUIREMENT: /workspace/requirements/sdn_controller.yaml  (reactive/proactive SDN controller)
ALL FIVE classes go in the single file netsim/sdn_controller.py:
  FlowRule, FlowTable, SDNController, ReactiveController(SDNController), ProactiveController(SDNController)

Design decisions already fixed - implement exactly these, they are the expected outputs:
  SDN_FLOW_RULES_INSTALLED:   180     int. ProactiveController.install_all_rules over TreeTopo(depth=2, fanout=3)
                                      (9 hosts, 4 switches). For EVERY ORDERED (src,dst) host pair (72 of them)
                                      compute the path and install one FlowRule on EVERY SWITCH along that path,
                                      with match_fields = {"src_ip": src_ip, "dst_ip": dst_ip} (both, so rules for
                                      different sources to the same destination do not collide) and
                                      actions = [{"type": "output", "port": <next hop port>}].
                                      18 same-edge-switch pairs x 1 switch + 54 cross pairs x 3 switches = 180.
                                      FlowTable.install must NOT dedup by match (only reject when at capacity).
  SDN_PATH_CONVERGENCE_TIME:  18.00   total_install_time() = total_rules_installed() * rule_install_time_ms(0.1).
  SDN_LINK_FAILURE_RECOVERY:  20      int. Use RingTopo(k=4, n=1) from netsim/topo.py (a ring gives redundant
                                      paths; SDN_EXPERIMENTS["link_failure"] pins num_switches=4,
                                      num_hosts_per_switch=1, failed_link=("s1","s2")). Proactively install all
                                      rules, then call handle_link_failure("s1","s2"), which must:
                                        (a) remove the link from the controller's topology graph,
                                        (b) find the AFFECTED installed paths - those whose stored path traversed
                                            the failed link in either direction (not a global recompute),
                                        (c) withdraw their now-stale rules, recompute each path, and reinstall
                                            rules along the new path when one exists,
                                        (d) return the NUMBER OF RULES REINSTALLED.
                                      Paths must come from WeightedGraph.shortest_path (netsim/graph.py) so heapq
                                      tie-breaking is shared with the rest of the library - do NOT hand-roll
                                      Dijkstra or BFS. With that substrate the answer is 20 (6 affected ordered
                                      pairs). If you get a different number, DO NOT tune the topology to force 20:
                                      report the number you get and the affected-pair breakdown in your report.
  SDN_CONTROLLER_THROUGHPUT:  20000.00  float. ReactiveController handles num_packets=1000 packet-ins at
                                      packet_in_time_ms=0.05 each -> 1000 / (1000*0.05/1000 s) = 20000.0 events/s.
                                      Drive it through real handle_packet_in() calls (a table miss must compute the
                                      path and install rules along it, and bump packet_in_count), then divide
                                      packet_in_count by the accumulated simulated seconds.
  SDN_RULE_TIMEOUT_EVICTIONS: 10      int. From SDN_EXPERIMENTS["rule_timeouts"]: install num_rules=20 rules with
                                      idle_timeout=10.0 into a FlowTable, give half of them
                                      last_matched=idle_last_matched(0.0) (stale) and half
                                      last_matched=active_last_matched(12.0) (fresh), then
                                      evict_expired(current_time=15.0, last_matched_times) evicts exactly the 10
                                      stale ones. Read the config; do not hardcode 10.
Notes:
- FlowRule(match_fields, actions, priority=100, idle_timeout=0, hard_timeout=0) with packet_count/byte_count stats
  counters and an install/creation timestamp attribute. matches(packet_headers): every field in match_fields must
  equal the packet's value (missing field -> no match); support a None value as a wildcard only if documented.
  is_expired(current_time, last_matched_time): hard_timeout expiry is measured from install time, idle_timeout from
  last_matched_time; 0 means permanent for both. Add a small helper to bump the stats (e.g. count_packet(bytes)).
- FlowTable(switch_name, capacity=4096): install(rule) returns False (and does not store) when at capacity, True
  otherwise; remove(match_fields) removes matching rule(s) and reports what happened; lookup(packet_headers)
  returns the highest-priority matching rule (ties: earlier install wins) and should bump that rule's stats only if
  you document it; evict_expired(current_time, last_matched_times) takes a dict keyed however you document it
  (rule object or match key) and returns the evicted rules or their count - be explicit in the docstring;
  size(), stats() -> list of (rule, packet_count, byte_count), clear(), utilization() -> size/capacity.
- SDNController(name): owns a WeightedGraph topology and a dict of switch_name -> FlowTable. add_switch(name) both
  registers the switch AND creates its FlowTable. add_link(node1, node2, weight=1) stores the weight on the graph
  edge. remove_link(node1, node2). topology_discovery(net) builds the graph and the flow tables from a Mininet
  instance (walk net.switches / net.hosts / net.links). compute_path(src, dst) delegates to
  WeightedGraph.shortest_path and MUST return an EMPTY LIST (not None) when the two nodes are disconnected.
  compute_all_paths() returns paths between all host pairs. install_path_rules(path, src_ip, dst_ip, priority=100)
  installs one rule per switch on the path and returns the number installed; remember the installed path so
  handle_link_failure can find affected ones. total_rules_installed() sums FlowTable.size() over all switches.
- ReactiveController: handle_packet_in(switch_name, packet_headers) increments packet_in_count, and on a table miss
  resolves src/dst from the headers, computes the path and installs rules along it (returning what it installed).
  Track the simulated packet-in service time so the throughput experiment can be driven from real calls.
- ProactiveController: rule_install_time_ms = 0.1 (per the spec text), install_all_rules(hosts_with_ips) taking an
  iterable of (host_name, ip) pairs (accept a dict too, and document it), total_install_time() =
  total_rules_installed() * rule_install_time_ms.
- Config: SDN_EXPERIMENTS in netsim/targets/configs.py has "proactive_tree", "link_failure",
  "reactive_throughput", "rule_timeouts".`,
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    layer: { type: 'string' },
    lens: { type: 'string' },
    printed_lines: { type: 'string', description: 'the exact KEY: VALUE lines the layer prints, as observed by running it' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          symbol: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string', description: 'what you ran or read that proves it' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'symbol', 'problem', 'evidence', 'fix'],
      },
    },
    spec_symbols_missing: { type: 'string', description: 'named spec symbols absent or with a wrong signature/kind, or "none"' },
  },
  required: ['layer', 'lens', 'printed_lines', 'findings', 'spec_symbols_missing'],
}

const LENSES = [
  {
    name: 'api-surface',
    prompt: `Go through the requirement yaml LINE BY LINE and check that every named class, method, property,
attribute, class constant and default parameter value exists with the exact name, kind (property vs method vs class
constant) and signature. Use python3 -c with inspect.signature and inspect.getattr_static / type(...).__dict__ to
prove property-vs-method for each one. Also check inheritance (which base class the spec names) and that documented
behaviours hold: capacity rejection, reset-one-vs-all, empty-list-on-disconnected, wildcard/priority semantics,
default values. Report anything missing, misnamed, wrong kind, or wrong default.`,
  },
  {
    name: 'numerics',
    prompt: `Verify every printed value independently. Re-derive each number BY HAND from the requirement text and
netsim/targets/configs.py (use python3 for the arithmetic), then compare against what the module actually prints.
Check int-vs-float typing of each printed value against print_result's formatting (ints bare, floats 2dp). Hunt for
values that are hardcoded rather than computed from the config or from the objects (grep the experiment module for
literal constants), for off-by-one in counts, and for any place a number happens to be right for the wrong reason.
Check the counting conventions: ordered vs unordered pairs, per-switch vs per-link, and whether a number would
change if the config were edited (it should).`,
  },
  {
    name: 'integration',
    prompt: `Check the layer as an EXTENSION of the existing library rather than a parallel universe: does it reuse
Host/Switch/Topo/Mininet/WeightedGraph/utils instead of reimplementing them? Does it break any earlier layer
(run python3 -m pytest agent_tests/ -q and bash run.sh)? Does it mutate shared state, monkeypatch, or touch files it
does not own (git status --porcelain and git diff --stat to see exactly what changed - read-only git commands only)?
Look for crashes and edge cases: empty topology, single node, disconnected graph, missing header field, index out of
range, capacity exactly reached, zero-length packet, repeated calls to the same experiment function, and whether
running the same experiment twice gives the same answer. Also confirm the module is importable and re-runnable and
that the __main__ guard works.`,
  },
]

phase('Implement')

const results = await pipeline(
  LAYERS,
  (layer) => agent(
    `${COMMON}\nYOUR FILES (create these, and only these):\n       ${layer.files}\n${layer.spec}\n\n` +
    `Implement the whole layer now, run it, run the existing test suite, iterate until everything passes and the ` +
    `printed values match the expected ones above exactly.`,
    { label: `impl:${layer.id}`, phase: 'Implement' },
  ),
  (report, layer) => parallel(LENSES.map((lens) => () => agent(
    `You are adversarially reviewing a freshly written layer of the Python network simulator at /workspace.\n` +
    `LAYER: ${layer.id}\nSPEC: /workspace/requirements/${layer.id}.yaml (read it in full)\n` +
    `FILES UNDER REVIEW: ${layer.files}\n\n` +
    `The implementer reported:\n${String(report).slice(0, 6000)}\n\n` +
    `REVIEW LENS (${lens.name}): ${lens.prompt}\n\n` +
    `Rules: you are READ-ONLY - do not modify, create or delete any file, and run no git command that writes. ` +
    `Run the code (python3 -m netsim.experiments.*, python3 -c, pytest) as much as you need. ` +
    `Default to reporting a finding only when you can PROVE it by running something or by quoting the spec line ` +
    `it violates. Do not report style preferences. Report the exact printed KEY: VALUE lines you observed.`,
    { label: `verify:${layer.id}:${lens.name}`, phase: 'Verify', schema: FINDINGS_SCHEMA },
  ))),
)

phase('Synthesize')

const flat = results.flat().filter(Boolean)

const synthesis = await agent(
  `You are the final reviewer for three freshly implemented layers of the Python network simulator at /workspace ` +
  `(containernet, p4_switch, sdn_controller). READ-ONLY: change nothing.\n\n` +
  `Here are 9 adversarial review reports as JSON:\n${JSON.stringify(flat, null, 2)}\n\n` +
  `Produce a single actionable defect list for the maintainer:\n` +
  `1. Deduplicate findings that describe the same defect and drop any you can DISPROVE by running the code ` +
  `(verify the top findings yourself - reviewers sometimes misread a spec or an intentional design decision).\n` +
  `2. Rank by severity: blockers (wrong printed value, missing/misnamed spec symbol, crash, broken earlier layer) ` +
  `first, then majors, then minors worth fixing.\n` +
  `3. For each: file, symbol, what is wrong, the spec line or command that proves it, and the precise fix.\n` +
  `4. Confirm the full output of \`bash run.sh\` plus \`python3 -m netsim.experiments.containernet_exp\`, ` +
  `\`... p4_exp\`, \`... sdn_exp\` and quote the exact lines (note run.sh may not yet invoke the new modules - ` +
  `that is expected, the maintainer wires it up).\n` +
  `5. State explicitly, per layer, whether EVERY symbol named in its requirement yaml now exists with the right ` +
  `name, kind and signature - list any that do not.\n` +
  `Return plain text.`,
  { label: 'synthesize:defects', phase: 'Synthesize' },
)

return { synthesis }
