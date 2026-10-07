export const meta = {
  name: 'probe-url-parser',
  description: 'Black-box probe the C++ url_parser binary across edge-case families and synthesize an exact behavioral spec',
  phases: [
    { title: 'Probe', detail: 'one agent per edge-case family, running the C++ binary' },
    { title: 'Critic', detail: 'find unprobed behaviors and gaps' },
    { title: 'Synthesize', detail: 'merge into one precise implementable spec' },
  ],
}

const PREAMBLE = `
You are reverse-engineering a C++ URL parser library **purely as a black box**.

The only artifact is the compiled binary: /workspace/dataset/test18_executable
There is NO library source available anywhere on disk (do not go looking for url_parser.h/.cpp — it does not exist). Do not try to disassemble or run 'strings'. Use ONLY behavioral probing: run the binary with argument values and observe stdout.

Usage: /workspace/dataset/test18_executable "<url>"
With fewer than 2 argv entries it returns exit code 1 and prints nothing.

It prints EXACTLY 18 lines, in this order (one per line, via std::cout << x << std::endl):
 1  scheme()          (string)
 2  authority()       (string)
 3  userinfo()        (string)
 4  host()            (string)
 5  port()            (int, prints -1 when absent)
 6  path()            (string)
 7  query()           (string)
 8  fragment()        (string)
 9  has_scheme()      (bool printed as 1/0)
10  has_authority()
11  has_userinfo()
12  has_host()
13  has_port()
14  has_path()
15  has_query()
16  has_fragment()
17  to_string()       (string)
18  is_valid()        (bool 1/0)

A labeled probe helper already exists at /tmp/probe.sh (takes any number of url args). If missing, recreate it:

  cat > /tmp/probe.sh << 'EOS'
  #!/bin/bash
  LABELS=(scheme authority userinfo host port path query fragment has_scheme has_authority has_userinfo has_host has_port has_path has_query has_fragment to_string is_valid)
  for arg in "$@"; do
    echo "=== INPUT: [$arg]"
    mapfile -t out < <(/workspace/dataset/test18_executable "$arg"; echo "EXIT:$?")
    for i in "\${!LABELS[@]}"; do printf "  %-14s [%s]\\n" "\${LABELS[\$i]}" "\${out[\$i]}"; done
  done
  EOS
  chmod +x /tmp/probe.sh

Note: /tmp/probe.sh renders empty fields as []. For inputs containing characters bash would mangle, invoke the binary directly with careful quoting, or use printf/hexdump to inspect raw bytes:
  /workspace/dataset/test18_executable "$URL" | od -c | head -40

ALREADY-ESTABLISHED FACTS (verified; you may re-verify but do not spend most of your budget here):
- A scheme is recognized ONLY when the literal "://" appears. "mailto:user@example.com" yields NO scheme and the entire input becomes path. "//example.com/path" yields no scheme and the whole thing is path (authority is parsed only when "://" was found).
- scheme() is LOWERCASED ("HTTP://EXAMPLE.COM" -> scheme "http"), but host() case is preserved ("EXAMPLE.COM").
- authority() is RECONSTRUCTED from userinfo/host/port, not the raw substring: "http://example.com:80abc" -> authority "example.com:80"; "http://example.com:" -> authority "example.com".
- port parsing behaves like std::stoi + a range check: "80abc"->80, "+80"->80, " 80"->80, "065"->65, "0"->0, but "-80"->absent, "65536"->absent, "2147483648"->absent, "abc"->absent, ""->absent. Absent port prints -1 with has_port 0 and is omitted from authority()/to_string().
- Splitting after authority: the FIRST '#' splits off fragment (so "#a#b" -> fragment "a#b"); then within the part BEFORE that '#', the FIRST '?' splits off query. "/p#a?b" -> fragment "a?b", no query.
- has_*() appear to be "field is non-empty" for strings ("http://example.com/#" -> fragment "" and has_fragment 0), and has_port() is port != -1. BUT has_authority() is NOT simply "authority string non-empty": "http://:8080" gives authority ":8080" yet has_authority 0 (host is empty there) — pin down the real rule.
- No path normalization ("/a/./b/../c" preserved), no percent-decoding ("%7E" preserved).
- is_valid(): "" -> 0, "http://" -> 0, "http://:8080" -> 0, but "example.com" -> 1, "/just/a/path" -> 1, "mailto:user@example.com" -> 1.

YOUR JOB: exhaustively probe your assigned family below. Run MANY probes (dozens — at least 40 distinct inputs; more is better). For every behavior you claim, you MUST have run the exact input. Derive precise, implementable rules (as if writing pseudocode), and explicitly flag anything ambiguous or surprising.

Return findings as structured output. Rules must be stated so a programmer can implement them without further probing. Include the concrete probe evidence (input -> the specific field values that matter) for each rule. Prefer many small precise rules over few vague ones.

YOUR ASSIGNED FAMILY:
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['family', 'rules', 'evidence', 'ambiguities', 'probe_count'],
  properties: {
    family: { type: 'string' },
    probe_count: { type: 'integer', description: 'how many distinct inputs you actually ran' },
    rules: {
      type: 'array',
      description: 'Precise implementable rules discovered, most important first',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'confidence'],
        properties: {
          rule: { type: 'string', description: 'A precise implementable statement of behavior' },
          confidence: { type: 'string', enum: ['certain', 'likely', 'uncertain'] },
        },
      },
    },
    evidence: {
      type: 'array',
      description: 'Concrete probe results worth preserving as regression tests. Report the full 18 lines compactly.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['input', 'output_18_lines'],
        properties: {
          input: { type: 'string', description: 'the exact argv[1] value' },
          output_18_lines: { type: 'string', description: 'the 18 output lines joined by | (use empty between pipes for blank lines)' },
          note: { type: 'string' },
        },
      },
    },
    ambiguities: {
      type: 'array',
      description: 'Behaviors you could not pin down, or that seem inconsistent',
      items: { type: 'string' },
    },
  },
}

const FAMILIES = [
  {
    key: 'scheme',
    prompt: `SCHEME DETECTION AND VALIDATION.
How is the scheme found and validated? Probe: is it the FIRST "://" or some other occurrence ("http://a://b", "a://b://c")? Does anything before "://" get accepted as a scheme, or is there a charset check (letters/digits/+/-/.)? What about "1http://x", "ht tp://x", "ht_tp://x", "h+t-t.p://x", "-a://x", "+a://x", ".a://x", "HTTP://x", "HtTp://x", "://x" (empty scheme), ":///x", "http:////x"? What if "://" appears AFTER a '?' or '#' (e.g. "/path?x=http://y", "#f://g", "path#a://b") — is the scheme still taken from it, or does query/fragment splitting happen first? What about "http:/x" and "http:x" (single slash / no slashes)? Does an invalid scheme make the whole string a path, or produce an empty scheme with authority still parsed? Determine the exact precedence between scheme detection and query/fragment splitting, since that is critical. Also check scheme with trailing/leading spaces (" http://x", "http ://x").`,
  },
  {
    key: 'userinfo',
    prompt: `USERINFO SPLITTING inside the authority.
Which '@' separates userinfo from host — the FIRST or the LAST? Probe "http://a@b@c.com", "http://a@b@c@d.com". What happens with an empty userinfo ("http://@example.com") vs a userinfo but empty host ("http://user@", "http://user@:8080")? Does userinfo keep colons ("http://u:p@h", "http://u:p:q@h")? Does an '@' appearing in the path/query/fragment (rather than the authority) get treated as userinfo ("http://example.com/a@b", "http://example.com?x=a@b", "http://example.com#a@b")? Does an '@' after the authority terminator matter? Check "http://u@h:80/p@q", "http://@", "http://@:80", "http://a@@b". Also does userinfo affect has_authority/is_valid? Pin down whether userinfo is percent-decoded or case-changed (it should not be, but verify). Report the exact rule for locating the authority substring's end and then the '@' within it.`,
  },
  {
    key: 'hostport',
    prompt: `HOST / PORT SPLITTING inside the authority.
Which ':' splits host from port — FIRST or LAST? Probe "http://a:b:c", "http://a:1:2", "http://a:80:90". IPv6: "http://[::1]/", "http://[::1]:8080/", "http://[2001:db8::1]:80/p", "http://[::1]" — are brackets handled specially (host keeps brackets? port found after ']'?) or does naive colon-splitting mangle them? What does authority()/to_string() reconstruct for IPv6? Empty host cases: "http://:8080", "http://:", "http://", "http://?q", "http://#f", "http:///path" (empty authority then path). Host with trailing dot "http://example.com./p". Host containing uppercase, underscores, hyphens, digits, percent escapes ("http://ex%41mple.com"), non-ASCII ("http://exämple.com"). Does host get lowercased or normalized in any way? Determine precisely how has_authority() and has_host() are computed, and exactly how authority() is reconstructed (the separators used, and when each part is included/omitted) — including the empty-host-with-port and userinfo-with-empty-host cases.`,
  },
  {
    key: 'portnum',
    prompt: `PORT NUMERIC PARSING — exhaustive std::stoi-vs-something-else determination.
Establish the exact numeric parse and the exact accept/reject predicate. Probe (all as "http://h:<X>"): "0", "1", "80", "65535", "65536", "65537", "70000", "99999", "-1", "-0", "+0", "+65535", "007", "0x10", "0b1", "1e3", "1.5", "80.9", " 80", "\\t80", "80 ", "80abc", "abc80", "8a0", "2147483647", "2147483648", "4294967296", "18446744073709551617", "99999999999999999999", "", ":", "+", "-", " ", "٣" (Arabic-Indic digit), "１２３" (fullwidth digits), "80%20". Determine: (a) does it skip leading whitespace, (b) does it accept a leading +/-, (c) does it stop at the first non-digit (stoi) or require the whole string to be digits, (d) what is the exact accepted numeric range (is it 0..65535? 1..65535? 0..65535 inclusive?), (e) does an out-of-range or unparsable port cause the ':'+text to be dropped entirely from host (host stays clean) — and does it ever end up appended to host or path instead? (f) Does a rejected port affect is_valid()? Also probe a rejected port combined with a path: "http://h:abc/p?q#f" — confirm path/query/fragment still parse. State the final predicate as exact pseudocode.`,
  },
  {
    key: 'pqf',
    prompt: `PATH / QUERY / FRAGMENT SPLITTING.
Confirm and refine the ordering rule (first '#' splits fragment; then first '?' in the remainder splits query). Probe with and without a scheme/authority. Critical: do '?' and '#' appearing INSIDE the authority region terminate the authority? e.g. "http://example.com?q=1" (already known: authority example.com, query q=1), "http://ex.com#f", "http://u@ex.com?x", "http://ex.com:80?x", "http://ex.com:80#f", "http://ex.com?x:80" — does the authority end at the first of '/', '?', '#'? Probe "http://ex.com" vs "http://ex.com/" (path "/" vs ""). Empty pieces: "http://ex.com/?#", "http://ex.com/#?", "http://ex.com?#", "http://ex.com#?", "?q=1" (no scheme), "#f" (no scheme), "?" alone, "#" alone, "/" alone, "//" alone. Also: for a scheme-less input, is a '?'/'#' still split out ("a/b?c#d")? And does the path include a leading '/' always, or can path be non-slash-prefixed after an authority ("http://ex.comfoo" is one host; but check something like "http://ex.com\\\\p")? Check that query keeps '&', '=', '+', ';' verbatim and fragment keeps everything verbatim. Report the exact substring boundaries.`,
  },
  {
    key: 'isvalid',
    prompt: `IS_VALID() TRUTH TABLE — derive the exact predicate.
Known: "" -> 0, "http://" -> 0, "http://:8080" -> 0, "example.com" -> 1, "/just/a/path" -> 1, "mailto:user@example.com" -> 1.
Systematically probe to find the predicate. Hypotheses to discriminate: (a) valid iff input non-empty; (b) valid iff (scheme present => host non-empty) AND something non-empty; (c) valid iff host non-empty OR path non-empty; (d) something about scheme charset. Probe: "http://h" , "http://h/", "http://@h", "http://u@", "http://u@:80", "http:// " (space host), "http://?q", "http://#f", "http:///p" , "http:///", "?q=1", "#f", "?", "#", "/", " ", "  " (spaces only), "\\t", "a", "://x", "://", "http://h:99999", "HTTP://H", "1abc://h", "a b://h". Also: does is_valid() depend on the scheme being a KNOWN scheme (http/https/ftp/etc.) — probe "zzz://h", "q://h", "x1://h". Does an empty path with a valid host stay valid? Does whitespace-only input count as non-empty (valid)? State the final predicate as exact pseudocode and give the full discriminating truth table.`,
  },
  {
    key: 'tostring',
    prompt: `TO_STRING() RECONSTRUCTION — derive the exact serialization.
Determine exactly how to_string() rebuilds the URL from the parsed parts, including which separators are emitted and under which conditions. Probe every structural combination, especially degenerate ones: scheme only ("http://"), scheme+empty host+port ("http://:8080"), scheme+userinfo+empty host ("http://u@"), scheme+host+rejected port ("http://h:abc"), scheme+host+path+query+fragment, host+query but no path ("http://h?q"), host+fragment no path ("http://h#f"), no scheme but path+query+fragment ("a?b#c"), empty query with '?' present ("http://h/?"), empty fragment with '#' present ("http://h/#"), path only ("/p"), "http://h/p?#", "http://h:0", "http://[::1]:80/p".
Key questions: (1) Is "://" always emitted when scheme is present, even with empty authority? (2) Is '?' emitted only when query is non-empty (so "http://h/?" round-trips to "http://h/")? Same for '#'. (3) Is the authority segment emitted using authority() or rebuilt independently? (4) Are there inputs where to_string() != input (lossy round-trip)? Enumerate every lossy case you can find — these matter enormously. (5) Does to_string() emit "//" when there is no scheme but an authority somehow exists? State the exact serialization pseudocode.`,
  },
  {
    key: 'weird',
    prompt: `HOSTILE / EXOTIC INPUTS — bytes, whitespace, size, and argv handling.
Probe: an input of only spaces; leading/trailing spaces around a full URL ("  http://h/p  "); embedded tab, newline (use $'\\n' in bash), carriage return, NUL is impossible via argv so skip it; control chars; non-ASCII UTF-8 in every component (scheme, host, path, query, fragment) e.g. "http://exämple.com/pä?q=ä#ä" — confirm bytes pass through untouched (compare with 'od -c'); percent-encodings in every component including invalid ones ("%", "%zz", "%4"); characters like '\\\\', '|', '"', '<', '>', '^', '{', '}', '[', ']', backtick, '$'; a very long URL (e.g. host of 10000 chars, path of 100000 chars) — does it still work and is output correct; many colons/at-signs/hashes/question-marks; a URL that is just "://"; repeated "://".
ALSO verify the program's argv contract precisely: run with NO arguments (check exit code and that nothing is printed), with an empty-string argument, and with EXTRA arguments ("url1" "url2" — is only argv[1] used?). Confirm output is always exactly 18 lines terminated by newline, including for the empty input (use 'od -c' or 'wc -l' to be sure there is a trailing newline on the last line).`,
  },
  {
    key: 'combos',
    prompt: `SYSTEMATIC STRUCTURAL COMBINATION SWEEP.
Rather than hunting exotic cases, mechanically enumerate structural combinations and record the full 18-line output for each, to serve as a regression corpus and to cross-check other agents' rules. Build a bash loop over a cartesian product: schemes {"", "http://", "https://", "ftp://", "ZZZ://"} x userinfo {"", "u@", "u:p@"} x host {"", "h.com", "H.CoM", "1.2.3.4", "[::1]"} x port {"", ":80", ":0", ":99999", ":abc"} x path {"", "/", "/p", "/p/q/"} x query {"", "?", "?a=1", "?a=1&b=2"} x fragment {"", "#", "#f", "#f?g"}.
That is a large product — sample it intelligently: run the full product over a reduced set of dimensions and vary the rest independently, so you cover every pairwise interaction. Aim for 150+ probes. Report, in the rules field, the invariants you observe holding across the whole sweep (e.g. "path is always exactly the substring between the authority and the first ? or #", "to_string == input except when <list of conditions>"). In evidence, report the cases where output is SURPRISING or where to_string() != input, plus a representative sample of ~25 ordinary cases. Explicitly list every input in your sweep where to_string() differed from the input.`,
  },
]

phase('Probe')
const probes = await parallel(FAMILIES.map(f => () =>
  agent(PREAMBLE + f.prompt, { label: `probe:${f.key}`, phase: 'Probe', schema: SCHEMA, effort: 'high' })
))
const good = probes.filter(Boolean)
log(`${good.length}/${FAMILIES.length} probe agents reported; ${good.reduce((a, r) => a + (r.probe_count || 0), 0)} total probes`)

const digest = JSON.stringify(good, null, 1)
const allAmbig = good.flatMap(r => (r.ambiguities || []).map(a => `[${r.family}] ${a}`))

phase('Critic')
const critics = await parallel([
  `You are a COMPLETENESS CRITIC for a black-box reverse-engineering effort on the C++ URL parser binary /workspace/dataset/test18_executable (18 output lines: scheme, authority, userinfo, host, port, path, query, fragment, then the eight has_* flags, then to_string, is_valid).

Here are the findings gathered so far:
${digest}

Your job: find what is MISSING or WRONG. Identify behaviors nobody probed, rules that conflict between agents, and rules stated too vaguely to implement. Then ACTUALLY RUN the binary (use /tmp/probe.sh <url> or the binary directly) to resolve those gaps yourself — at least 40 new probes targeting exactly the untested seams and the contradictions. Report the resolved answers as rules with evidence.`,

  `You are an ADVERSARIAL VERIFIER. Below are rules inferred about the C++ URL parser binary /workspace/dataset/test18_executable (18 output lines: scheme, authority, userinfo, host, port, path, query, fragment, eight has_* flags, to_string, is_valid).

${digest}

For each rule that is load-bearing for an implementation, try HARD to construct an input that FALSIFIES it. Default to skepticism: assume each rule is an overgeneralization from too few examples, and hunt for the counterexample. Run at least 40 probes designed as counterexample attempts (use /tmp/probe.sh or the binary directly). Report which rules SURVIVED and which were FALSIFIED — for falsified ones give the exact input, the actual 18-line output, and the corrected rule.`,

  `You are resolving specific OPEN AMBIGUITIES about the C++ URL parser binary /workspace/dataset/test18_executable (18 output lines: scheme, authority, userinfo, host, port, path, query, fragment, eight has_* flags, to_string, is_valid). Use /tmp/probe.sh <url> or run the binary directly.

Context — rules gathered so far:
${digest}

OPEN AMBIGUITIES to resolve empirically (run the binary; do not speculate):
${allAmbig.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Design targeted probes that discriminate between the competing explanations for each ambiguity. Run at least 40 probes. For each ambiguity, report the resolved rule and the evidence that settles it. If an ambiguity cannot be settled, say exactly why and what the residual risk is.`,
].map((p, i) => () => agent(p, { label: ['critic:completeness', 'critic:adversarial', 'critic:ambiguities'][i], phase: 'Critic', schema: SCHEMA, effort: 'high' })))

const criticsGood = critics.filter(Boolean)
log(`${criticsGood.length}/3 critics reported`)

phase('Synthesize')
const spec = await agent(
  `You are writing the DEFINITIVE behavioral specification for a C++ URL parser, to be handed to an engineer who will reimplement it in Rust with byte-identical output. The engineer cannot see the C++ source (it does not exist on disk) and will rely solely on your spec.

The binary under study is /workspace/dataset/test18_executable. It prints exactly 18 lines: scheme, authority, userinfo, host, port(int, -1 if absent), path, query, fragment, has_scheme, has_authority, has_userinfo, has_host, has_port, has_path, has_query, has_fragment, to_string, is_valid (bools print as 1/0).

Below are findings from nine independent probe agents plus three critics (a completeness critic, an adversarial verifier, and an ambiguity-resolver). They may CONFLICT. Where they conflict, or where a rule is vague, RUN THE BINARY YOURSELF to settle it — you have full access (/tmp/probe.sh <url>, or invoke the binary directly). Verify every load-bearing rule you write with at least one probe you personally ran. Prefer the adversarial verifier's corrections over the original probe agents' claims when they disagree.

=== PROBE FINDINGS ===
${digest}

=== CRITIC FINDINGS ===
${JSON.stringify(criticsGood, null, 1)}

Produce the spec as precise, unambiguous, ordered pseudocode covering:
1. parse(input): the exact algorithm — order of operations for scheme detection, authority extraction, userinfo/host/port splitting, and path/query/fragment splitting. Be explicit about which occurrence (first/last) of each delimiter is used and what the exact substring boundaries are.
2. port parsing: the exact numeric parse and the exact accept/reject predicate, including whitespace/sign/trailing-garbage/range handling.
3. Each accessor: scheme(), authority(), userinfo(), host(), port(), path(), query(), fragment() — noting any transformation (e.g. lowercasing) and, for authority(), the exact reconstruction rule.
4. Each has_*(): the exact predicate.
5. to_string(): the exact serialization rule, including every case where it is lossy relative to the input.
6. is_valid(): the exact predicate.
7. Any behavior that remains genuinely uncertain, with the residual risk called out.

Write the spec in the 'rules' array as an ordered sequence of implementable statements (pseudocode is welcome inside a rule string). In 'evidence', include a high-value regression corpus of at least 45 inputs with their full 18-line outputs — this becomes the Rust test suite, so choose inputs that pin down every rule and every lossy to_string case. Set family to "SPEC".`,
  { label: 'synthesize:spec', phase: 'Synthesize', schema: SCHEMA, effort: 'max' }
)

return { spec, probeFamilies: good.map(r => r.family), criticCount: criticsGood.length }
