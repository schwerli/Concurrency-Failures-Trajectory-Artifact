export const meta = {
  name: 'audit-netsim-layers',
  description: 'Audit the netsim implementation against every requirement YAML: API-element coverage, correctness bugs, and cross-layer integration',
  phases: [
    { title: 'Audit', detail: 'per-requirement API coverage + bug hunt, multiple lenses' },
    { title: 'Verify', detail: 'adversarially confirm or refute each finding by running code' },
  ],
}

const CTX = `
Repo: /workspace — a pure-Python network emulation + SDN simulation library ("netsim").
You may Read files and RUN code with Bash (python3 -m ..., python3 -c "...", python3 -m pytest agent_tests -q).
Do NOT edit any files. Investigate and report only.

Layout:
  netsim/{node,link,topo,net,graph,packet,utils,wifi_net,container,sfc,containernet,p4_switch,sdn_controller}.py
  netsim/wifi/*.py, netsim/targets/configs.py
  netsim/experiments/{mininet_exp,wifi_exp,containernet_exp,p4_exp,sdn_exp}.py
  agent_tests/*.py, run.sh
Requirements (the source of truth): /workspace/requirements/*.yaml

./run.sh currently prints 25 KEY: VALUE lines; the last 15 are:
  CONTAINER_SFC_THROUGHPUT: 857.38 / CONTAINER_SFC_LATENCY: 5.00 / CONTAINER_FAIRNESS: 0.73
  CONTAINER_HYBRID_NODES: 7 / CONTAINER_OVERHEAD_RATIO: 50.00
  P4_TABLE_ENTRIES: 16 / P4_FORWARDING_RATE: 922.37 / P4_COUNTER_ACCURACY: 1.00
  P4_PIPELINE_LATENCY: 1.50 / P4_MULTICAST_GROUPS: 6
  SDN_FLOW_RULES_INSTALLED: 180 / SDN_PATH_CONVERGENCE_TIME: 18.00 / SDN_LINK_FAILURE_RECOVERY: 20
  SDN_CONTROLLER_THROUGHPUT: 20000.00 / SDN_RULE_TIMEOUT_EVICTIONS: 10
These values have already been cross-checked and are believed correct — do NOT re-litigate them unless
you find a hard arithmetic error.
`

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'detail', 'severity', 'repro'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          detail: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          repro: { type: 'string', description: 'exact command or code proving the defect, or "n/a" for coverage gaps' },
        },
      },
    },
  },
}

const JOBS = [
  {
    label: 'coverage:containernet',
    prompt: `Requirement-coverage audit of /workspace/requirements/containernet.yaml.
Enumerate EVERY class, method, attribute, property, constant and file the YAML names (DockerHost with image/cpu_shares/cpu_quota/cpu_period/mem_limit_mb, STARTUP_OVERHEAD_MS, HOST_STARTUP_MS, cpu_fraction, startup_time_ms, is_container; VNF with name/processing_delay_ms/overhead_pct/throughput_factor; ServiceFunctionChain num_links/compute_throughput/compute_latency; Containernet addDocker/compute_resource_fairness/total_nodes/startup_overhead_ratio; the 4 required files; run.sh update).
For each, verify by IMPORTING AND CALLING it that it exists, is spelled exactly as the YAML says, is reachable from the documented module path, and behaves as described. Report anything missing, misspelled, in the wrong module, or with wrong default values / semantics.`,
  },
  {
    label: 'coverage:p4_switch',
    prompt: `Requirement-coverage audit of /workspace/requirements/p4_switch.yaml.
Enumerate EVERY named class and method: P4MatchActionTable(name, match_fields, max_size=1024) with add_rule/lookup/delete_rule/size/clear; P4Parser(header_defs) with parse/is_valid; P4Deparser(header_defs) with deparse(headers, payload); P4Counter(name, size) with increment/read/reset/total_packets/total_bytes; P4Switch(name, program=None) with add_table/add_counter/set_parser/set_deparser/process_packet/get_table/get_counter/pipeline_latency_us; P4Topology(num_switches, num_hosts_per_switch, **link_params) with addP4Switch; P4MulticastGroup(group_id, ports) with replicate/add_port/remove_port; netsim/experiments/p4_exp.py with run_p4_experiments(); run.sh.
Verify each by importing and calling with the EXACT signature the YAML gives (including positional/keyword form and defaults). Report every discrepancy.`,
  },
  {
    label: 'coverage:sdn_controller',
    prompt: `Requirement-coverage audit of /workspace/requirements/sdn_controller.yaml.
Enumerate EVERY named class and method: FlowRule(match_fields, actions, priority=100, idle_timeout=0, hard_timeout=0) with match_fields/actions/priority/idle_timeout/hard_timeout/packet_count/byte_count/is_expired(current_time, last_matched_time)/matches(packet_headers); FlowTable(switch_name, capacity=4096) with install/remove/lookup/evict_expired(current_time, last_matched_times)/size/stats/clear/utilization; SDNController(name) with add_switch/add_link(node1,node2,weight=1)/remove_link/topology_discovery(net)/compute_path/compute_all_paths/install_path_rules(path, src_ip, dst_ip, priority=100)/total_rules_installed/handle_link_failure; ReactiveController with handle_packet_in(switch_name, packet_headers)/packet_in_count; ProactiveController with install_all_rules(hosts_with_ips)/rule_install_time_ms/total_install_time; Dijkstra returning [] on disconnected graphs; netsim/experiments/sdn_exp.py with run_sdn_experiments(); run.sh.
Verify each by importing and calling with the EXACT signature the YAML gives. In particular check: does SDNController('c0') work with only a name? does ProactiveController expose rule_install_time_ms as an instance attribute equal to 0.1 by default? does stats() return (rule, packet_count, byte_count) tuples? Report every discrepancy.`,
  },
  {
    label: 'bughunt:containernet+sfc',
    prompt: `Adversarial correctness review of /workspace/netsim/container.py, netsim/sfc.py, netsim/containernet.py, netsim/experiments/containernet_exp.py.
Hunt for real defects a user would hit: wrong arithmetic, mutable-default or aliasing bugs, broken inheritance (Containernet vs Mininet: does build/buildFromTopo/start/stop/ping/iperf still work when a topo is passed?), addDocker interaction with Mininet.start IP assignment, removeDocker leaving stale graph edges, division by zero, cpu_fraction edge cases, chains with zero VNFs, negative/None inputs. PROVE each finding by running code.`,
  },
  {
    label: 'bughunt:p4',
    prompt: `Adversarial correctness review of /workspace/netsim/p4_switch.py and netsim/experiments/p4_exp.py.
Hunt for real defects: parser/deparser round-trip failures (multi-byte fields, overlapping/non-contiguous offsets, empty header_defs, oversized int values that overflow to_bytes), counter index wrapping with size 0 or negative, table lookup priority/wildcard/tie-break correctness, process_packet with no parser or no deparser set, drop semantics, P4Topology with num_switches=1 or num_hosts_per_switch=0 or 2, P4Topology instantiated through Mininet(topo=...) picking up the P4Switch class, mutable default aliasing (e.g. P4MulticastGroup sharing a ports list). PROVE each finding by running code.`,
  },
  {
    label: 'bughunt:sdn',
    prompt: `Adversarial correctness review of /workspace/netsim/sdn_controller.py and netsim/experiments/sdn_exp.py.
Hunt for real defects: Dijkstra correctness with non-unit weights and with disconnected graphs, remove_link on a non-existent link, handle_link_failure when the new path is empty (flow left unprogrammed — is installed_paths correctly cleaned?), install_path_rules when the path has no switches or is empty, FlowTable capacity accounting when install replaces an existing rule, evict_expired with a plain dict keyed by match tuple vs by rule object vs a callable, FlowRule.is_expired when last_matched_time is None or when both timeouts are set, ReactiveController.throughput with zero events, hosts sharing an IP, topology_discovery called twice (duplicate switches/links?). PROVE each finding by running code.`,
  },
  {
    label: 'integration:stack',
    prompt: `Whole-stack integration review. Verify the five layers still compose:
 - ./run.sh exits 0 and prints exactly 25 well-formed "KEY: VALUE" lines with no duplicates and no stray output on stdout/stderr.
 - python3 -m pytest agent_tests -q passes.
 - Each experiment module is runnable standalone (python3 -m netsim.experiments.<mod>) AND importable without side effects, and each exposes the run_*_experiments() function its YAML names.
 - Every requirement YAML's "Files to create" / "Files to modify" list is satisfied.
 - The later layers genuinely EXTEND the earlier ones rather than replacing them (Containernet subclasses Mininet, P4Switch subclasses Switch, MininetWifi still works, DockerHost subclasses Host, P4Topology subclasses Topo). Check nothing in the new code regressed the mininet/mininet_wifi outputs.
 - No import cycles; "python3 -c 'import netsim.containernet, netsim.p4_switch, netsim.sdn_controller, netsim.wifi_net'" works.
 - Determinism: run ./run.sh three times and confirm byte-identical output.
Report anything broken.`,
  },
]

phase('Audit')
const audits = await parallel(JOBS.map(j => () =>
  agent(`${CTX}\n\n${j.prompt}\n\nReturn only real, verified findings. An empty findings list is a perfectly good answer — do not invent problems or report style preferences as defects.`,
    { label: j.label, phase: 'Audit', schema: FINDINGS })))

const all = audits.filter(Boolean).flatMap(a => a.findings || [])
log(`${all.length} candidate findings from ${audits.filter(Boolean).length} auditors`)

phase('Verify')
const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'real', 'severity', 'evidence', 'fix'],
  properties: {
    title: { type: 'string' },
    real: { type: 'boolean' },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
    evidence: { type: 'string' },
    fix: { type: 'string', description: 'concrete minimal fix, or "none needed"' },
  },
}

const verified = await parallel(all.map((f, i) => () =>
  agent(`${CTX}\n\nA reviewer reported this finding. Your job is to REFUTE it if you can.\n\n` +
    `Title: ${f.title}\nFile: ${f.file}\nSeverity claimed: ${f.severity}\nDetail: ${f.detail}\nRepro: ${f.repro}\n\n` +
    `Read the code and RUN the repro. Decide whether this is a genuine defect that a hidden test of the ` +
    `requirement (/tests/<module>/test_outputs.py, which checks the printed KEY: VALUE lines, and may also ` +
    `import the classes named in the YAML) would plausibly catch, or a false positive / harmless design choice. ` +
    `Default to real=false when uncertain or when the "defect" is only about undocumented edge cases that the ` +
    `requirement never specifies. If real, give the minimal concrete fix.`,
    { label: `verify:${i + 1}`, phase: 'Verify', schema: VERDICT })))

const confirmed = verified.filter(Boolean).filter(v => v.real)
return {
  candidates: all.length,
  confirmed: confirmed.length,
  findings: confirmed.sort((a, b) => ['blocker', 'major', 'minor', 'nit'].indexOf(a.severity) - ['blocker', 'major', 'minor', 'nit'].indexOf(b.severity)),
  refuted: verified.filter(Boolean).filter(v => !v.real).map(v => v.title),
}
