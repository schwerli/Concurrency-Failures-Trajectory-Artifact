export const meta = {
  name: 'dog-explore',
  description: 'Exhaustively probe the dog DNS client binary behaviour and write detailed findings reports',
  phases: [
    { title: 'Explore', detail: 'parallel behavioural probes, one topic per agent' },
    { title: 'Critique', detail: 'find gaps in the collected findings' },
  ],
}

const COMMON = `
You are reverse-engineering the behaviour of a compiled binary at /workspace/executable.
It is a command-line DNS client called \`dog\`. Read /tmp/h/HARNESS.md FIRST — it explains the
python test harness that lets you run a fake local DNS server and observe exactly what dog
sends and how it renders responses (there is NO real network access in this sandbox).

HARD RULES (violating these fails the whole task):
* Learn ONLY by running /workspace/executable and reading the bundled docs
  (/workspace/README.md, /workspace/man/dog.1.md, /workspace/completions/*).
* NEVER decompile, disassemble, run objdump/strings/nm/gdb/strace/ltrace on /workspace/executable.
* NEVER search for the project's source code.

Be EXHAUSTIVE and PRECISE. The end goal is a byte-for-byte identical reimplementation, so:
* record exact strings, exact spacing, exact ANSI escape codes (use od -c or python repr on captured bytes)
* record exit codes for every case
* record whether output goes to stdout or stderr
* probe boundaries and error paths, not just happy paths
* when you find a formatting rule, verify it with at least 3 more inputs, including extremes

Write your findings as a detailed markdown report to the file path given below.
The report must contain literal observed input/output pairs (in fenced code blocks with python
repr() or od -c output where whitespace matters) plus the inferred rules. Do not summarise away
detail. Aim for a report a programmer could implement from without re-running anything.

Finally, return (as your final message) a ~30 line summary of the most important rules you
established, and explicitly list anything you could NOT determine.
`;

const TOPICS = [
  {
    key: 'argparse',
    port: 5600,
    title: 'Command-line argument parsing, guessing, and errors',
    body: `Map dog's argument parser completely.
- Every flag from --help: short/long forms, --flag=value vs --flag value vs -fvalue vs -f value.
- Which flags take values, which are boolean. Can booleans be bundled (-TJ1)? Can -q be given twice?
- The "intelligent guess" for bare arguments: when is a bare word treated as a domain, a type, a class,
  or a nameserver (@x)? Test: lowercase type names (mx, Mx), 'IN'/'CH'/'HS', numeric strings,
  words that are both (e.g. a domain literally named "MX"), single labels, names with dots,
  names with trailing dot, IP addresses as bare args, '@1.1.1.1', '@' alone, '--' separator,
  arguments after --.
- Multiple values: multiple domains/types/nameservers/classes -> how many queries, in what ORDER
  are they sent, and in what order are results printed? Verify with the harness (set count high).
- Exact text and exit code of EVERY error message you can trigger: unknown option, missing value,
  invalid type, invalid class, invalid --edns value, invalid --colour value, invalid --txid
  (non-numeric, negative, >65535), invalid -Z tweak, invalid bufsize, no domain given,
  conflicting transports (-T -U together, -S -H), duplicate flags, empty string args,
  a domain that is too long (>253) or a label >63, non-ASCII/unicode domains, '@host:port' with
  bad port, IPv6 nameserver literals ('@::1', '@[::1]:53').
- Does --help/--version take precedence over everything else? What if both? What if invalid options
  are also present? Exit codes for each.
- Also: exact bytes of --help and --version output with --colour=always and never (note the odd
  stray 'm' in the version URL when colour is off — pin down exactly what is printed in each mode,
  including whether -1/-J affect them).`,
  },
  {
    key: 'loc',
    port: 5620,
    title: 'The LOC record rendering algorithm',
    body: `Reverse-engineer dog's LOC (type 29) record rendering exactly, both the table format and JSON.
LOC rdata is: version(1) size(1) horiz_pre(1) vert_pre(1) latitude(4) longitude(4) altitude(4).
The observed output for version=0,size=0x12,hp=0x16,vp=0x13,lat=0x8b0d2c8c,lon=0x7f3a5b40,alt=0x00989680 was:
  LOC ex. 1h00m00s   1e2 (22, 19) (51°30′12.748″ N, 3°35′52.768″ W, 0m)
and JSON: {"size":"1e2","precision":{"horizontal":22,"vertical":19},"point":{"latitude":"51°30′12.748″ N","longitude":"3°35′52.768″ W","altitude":"0m"}}
Determine precisely:
- how the size byte (base/exponent nibbles) becomes the string (test all 256 values of the size byte)
- whether horiz_pre/vert_pre are printed raw or decoded (test many values)
- the latitude/longitude formula: sign/hemisphere letters, degrees, minutes, seconds with how many
  decimal places, rounding, zero padding, the exact unicode characters used (° ′ ″), equator/prime
  meridian edge cases, values at/over the poles, min/max u32
- the altitude formula and units string (test 0, small, large, values below the 10000000 datum,
  min/max u32) — is it metres with decimals?
- what happens for version != 0 (exact error text) and for wrong rdata length
Report a table of at least 40 input->output pairs covering the space so the formula can be verified.`,
  },
  {
    key: 'duration',
    port: 5640,
    title: 'Duration/TTL formatting and table column layout',
    body: `Pin down two things exactly.
(1) Duration formatting used for TTLs and for SOA refresh/retry/expire/minimum.
    Test every interesting u32: 0,1,9,10,59,60,61,119,600,3599,3600,3601,86399,86400,86401,
    90000,604800,1000000,31536000,4294967295, and enough others to prove the rule (zero padding,
    which units appear, whether units are omitted when zero, plural handling).
    Also check --seconds mode for all of them, and JSON mode (raw integer?).
(2) The table layout. Verify: type column right-aligned to the widest type name; name column
    left-aligned padded to widest name; TTL column right-aligned to widest TTL; then a one-char
    'mark' column (' ' for answers, '+' for additionals, 'A' for authorities?) then the data.
    Establish exactly how many spaces separate each column, whether padding is computed over ALL
    rows of ALL responses together or per response, whether the mark column is included when no
    row needs a mark, what happens with an empty name (root '.'), very long names, and how OPT
    rows (which have no name/ttl) fit in.
    Test multiple queries (several domains/types at once) to see whether one big table or several.
    Also check whether there is a blank line between responses, and the exact colour codes for
    each column and each record type name (build a complete type-number -> ANSI code table for
    types 1,2,5,6,12,13,15,16,17,18,24,25,28,29,33,35,36,37,39,41,42,43,44,45,46,47,48,49,50,51,
    52,53,55,59,60,61,62,108,109,249,250,251,252,255,256,257,32768,32769 and an unknown one).`,
  },
  {
    key: 'malformed',
    port: 5660,
    title: 'Malformed packet and wire-protocol error handling',
    body: `Systematically enumerate dog's error handling for bad responses. For each case record the
EXACT stderr/stdout text and exit code.
- Truncated packets: 0 bytes, 1..11 bytes, header only, header claiming N questions/answers with
  no data, rdata length longer than remaining bytes, rdata length shorter than the record needs.
- Wrong record lengths for fixed-size types (A, AAAA, EUI48, EUI64) — exact message.
- Name parsing: compression pointers (do they work? forward pointers? pointer loops? pointer to
  itself? pointer into the middle of a label?), labels > 63, names > 255, a label length byte with
  the top bits 0b01/0b10 (reserved), empty packets, 0x00 mid-name.
- Transaction ID mismatch between request and response — what happens?
- Response with QR bit clear; response where the question section does not match the query;
  qdcount 0; qdcount 2; ancount larger than actual records; extra trailing garbage after the
  last record.
- Class values: 1(IN), 3(CH), 4(HS), 254, 255(ANY), 0, other — how are they rendered in the table
  and in JSON? What error for unknown class?
- OPT record specifics: OPT in the answer section, several OPT records, OPT with rdata (option
  code/length pairs) — how is it rendered with --edns=show, in JSON, and in short mode? Decode the
  four numbers dog prints for OPT ("4096 0 0 0 []") by varying the OPT class/ttl/rdata fields.
- What does dog do when the server sends a response to a different port / no response at all
  (timeout: how long does it wait, does it retry, exact message and exit code)? Test with the
  harness by returning None. Also test a connection refused (port with nothing listening) and TCP
  connection closed early / TCP length prefix lying.`,
  },
  {
    key: 'transport',
    port: 5700,
    title: 'Transports, EDNS, tweaks, txid, timing',
    body: `Determine exactly what bytes dog puts on the wire and how transports behave.
- Default (no flag) vs -U vs -T vs -S vs -H: which is used, and the exact request bytes.
- Truncation: default mode with the TC bit set in the UDP response — does it retry over TCP?
  Verify by running a UDP server and a TCP server on the same port and observing both requests
  (the harness can start two servers; write your own if needed). What does -U do when TC is set
  (exact message/exit code)? What does -T do? Does the TCP retry reuse the same transaction ID?
- The exact OPT record dog appends: bytes for --edns=hide/show/disable, and with
  -Z bufsize=NNN (test 0, 1, 512, 4096, 65535, 65536, non-numeric).
- -Z aa/ad/cd: which header bits get set (dump the request bytes and decode all 16 flag bits).
  Can they be combined (-Z aa -Z cd, -Z aa,cd, -Z=aa)? Unknown tweak error text/exit code.
- --txid: 0, 1, 65535, 65536, -1, 0x10, "abc" — exact bytes and error messages. Is the ID random
  otherwise (check the distribution over ~20 runs)?
- --time: exact output format, where it is printed (stdout/stderr), how it interacts with -J
  (a JSON field?), -1, and with multiple queries. Note the units/precision.
- Multiple nameservers/domains/types: how many packets, sequential or concurrent, same or
  different txids, what if one fails?
- TCP framing: exact 2-byte length prefix handling; does dog send the request in one write?
- -S/-H with no TLS server available: exact error text and exit code (e.g. @127.0.0.1:PORT with a
  plain TCP server that closes, or with a server that sends garbage). Also -H with various URL
  forms (@https://host/path, @host, @http://..., missing scheme) and what error results, and
  whether -H against a plain HTTP server on localhost works at all (try writing a tiny HTTPS-less
  server to see the error).`,
  },
  {
    key: 'json',
    port: 5720,
    title: 'JSON output and short mode, for every record type',
    body: `Produce a complete specification of dog's -J (JSON) output and -1 (short) output.
- Exact JSON shape: key order, no spaces?, trailing newline?, how multiple responses appear,
  how the queries/answers/authorities/additionals arrays appear.
- For EVERY interpretable record type (A, AAAA, CAA, CNAME, EUI48, EUI64, HINFO, LOC, MX, NAPTR,
  NS, OPENPGPKEY, OPT, PTR, SOA, SRV, SSHFP, TLSA, TXT, URI) and for an unknown type, give the
  exact JSON "data" object and the exact short-mode line. Note which fields are dropped
  (SOA's JSON only had "mname" — confirm and look for other such omissions).
- How are non-UTF8 / control / quote / backslash / high bytes rendered in JSON strings and in the
  table for TXT, HINFO, CAA, NAPTR, URI, OPENPGPKEY? (Test bytes 0x00,0x09,0x0a,0x22,0x5c,0x7f,
  0x80,0xff and invalid UTF-8 sequences.) Determine the exact escaping scheme in each mode —
  note the table showed URI target bytes 0x03 and 0x00 as the two-character sequences \\3 and \\0.
- rcode/status handling: what does -J emit for NXDOMAIN etc.? Is there a "status" key? What does
  short mode do (exit code 2?) — test every rcode 0-15 in normal, -1 and -J modes, with and
  without answers present.
- What does short mode print for authorities/additionals-only responses? For OPT? Exit codes.
- Does -J respect --seconds / --time / --colour?  Is JSON ever coloured?
- What happens with -1 -J together? -J twice?`,
  },
  {
    key: 'debug',
    port: 5740,
    title: 'DOG_DEBUG output and system nameserver resolution',
    body: `Two topics.
(1) DOG_DEBUG: run with DOG_DEBUG=1 and DOG_DEBUG=trace (and other values: "", "0", "TRACE",
    "debug", "info", "warn", "error", "junk"). Capture the EXACT stderr lines for a simple
    successful query, for an error, for --help, for --version. Note the format (level tags,
    colours, ANSI codes, whether they contain timestamps, module paths, line numbers, packet
    hexdumps). Establish which log lines appear at which level and their exact wording. Check
    whether DOG_DEBUG output goes to stderr and whether it is coloured when stderr is not a tty.
(2) System nameserver: with no -n/@ argument dog reads the system resolver. Determine how:
    does it read /etc/resolv.conf? Which lines/directives (nameserver, search, options, ports,
    IPv6, comments, multiple nameservers — does it use the first or all)? Use a fake root by
    copying the binary? You cannot chroot, but you CAN check behaviour by observing the request
    destination via DOG_DEBUG=trace and by temporarily... do NOT modify /etc/resolv.conf if you
    cannot restore it; instead read it and use DOG_DEBUG to see what nameserver dog picked.
    Also determine the error and exit code when no nameserver can be determined (man page says
    exit 4) — e.g. try RESOLV_CONF-ish env vars, HOME-relative files, and see if any env var
    influences it.
    Also check: what if -n is given an empty string, a hostname that cannot resolve, a port only,
    an IPv6 address, a URL when not using -H.`,
  },
  {
    key: 'names',
    port: 5760,
    title: 'Domain name encoding, escaping and rendering',
    body: `Determine exactly how dog encodes query names and renders received names.
- Encoding: what bytes does dog put in the question for: "example.net", "example.net.",
  ".", "" (empty -q), "a..b", "a.b..", uppercase names (is case preserved?), names with
  trailing/leading dots, a 63-char label, a 64-char label, a name totalling 254+ chars,
  names containing spaces, quotes, backslashes, escaped dots ("a\\.b"), decimal escapes
  ("\\065"), unicode ("café.example", "日本.example" — is punycode/IDNA applied?), names with
  NUL, and IP-address-looking names.
- Rendering: how are received names printed in the table and JSON when they contain
  non-printable bytes, dots inside labels, backslashes, quotes, high bytes, invalid UTF-8?
  Compare the "name" column, the CNAME/NS/PTR/MX data rendering, and the JSON strings.
- Is the trailing dot always added? What is the root name rendered as (we saw "" for an empty
  MX exchange — confirm for the name column, JSON, and short mode)?
- Compression: does dog follow compression pointers when reading names? Does it emit any?
- Case: does dog compare the response question to the request case-insensitively?
Give the exact bytes (hex) dog sent for each input and the exact rendered output.`,
  },
  {
    key: 'colour',
    port: 5780,
    title: 'Colour handling and TTY detection',
    body: `Determine dog's colour behaviour exhaustively.
- --colour/--color values: always, automatic, never, and invalid values (exact error + exit code).
  Abbreviations? Case sensitivity? Repeated flags (last wins)?
- Default when stdout is NOT a tty (as in the harness) vs when it IS. Use \`script -qc\` or a pty
  via python's pty module to give dog a real tty and capture the bytes, and confirm what
  "automatic" does in each case. Check whether stderr colouring is decided separately.
- Do any environment variables affect colour (NO_COLOR, CLICOLOR, TERM=dumb, TERM unset)?
- Build the COMPLETE mapping of ANSI codes: record type names per type, the name column,
  the TTL column, the '+'/'A' mark characters, the data fields of each record type
  (are any parts of the data coloured? check SOA's serial/durations, MX preference, SRV port,
  TXT quotes, LOC), the "Status: ..." line, error messages ("Error [network]: ..."),
  the --time output, --help output, --version output.
- Confirm the exact escape sequences (e.g. \\x1b[1;32m ... \\x1b[0m) and whether resets are
  emitted per-field.
- Does -J ever emit colour? Does -1 (short mode)?`,
  },
  {
    key: 'multi',
    port: 5800,
    title: 'Multiple queries, ordering, and combined tables',
    body: `The man page says "If more than one domain, type, nameserver, or class is specified, dog
will perform one query for each combination, and display the combined results in a table."
Establish exactly:
- the cartesian product order (which varies fastest: domain, type, class, nameserver?)
- how many UDP packets are sent, sequentially or in parallel, and whether transaction IDs differ
- how results are ordered in the output when the fake server replies differently per request
  (use a callable response function keyed on the request index to make each response distinct)
- whether the table columns are aligned across ALL responses or per response
- whether there is any separator between responses, in plain, colour, JSON and short modes
- what happens if one of the queries fails (malformed reply, timeout, rcode error) — does dog
  abort, exit code, is partial output printed, in what order relative to the successful ones
- with --time, is one timing printed per query?
- with multiple nameservers, does each get every domain?
- duplicate identical queries: are they deduplicated?
- how large can the product get; is there a limit?
Report exact command lines, the sequence of requests observed (hex), and the exact stdout.`,
  },
];

phase('Explore');
const reports = await parallel(TOPICS.map(t => () =>
  agent(`${COMMON}

# YOUR TOPIC: ${t.title}

${t.body}

Your assigned PORT_BASE is ${t.port} — always run your probe scripts with
\`PORT_BASE=${t.port} python3 yourscript.py\` and put your scripts in /tmp/explore/${t.key}/.
Write your report to /tmp/findings/${t.key}.md (create the directory).
`, { label: `explore:${t.key}`, phase: 'Explore' })
));

phase('Critique');
const critique = await agent(`You are auditing a reverse-engineering effort against the binary /workspace/executable
(a DNS client called \`dog\`). Read /tmp/h/HARNESS.md and every report in /tmp/findings/*.md.

Your job: find GAPS — behaviour that a reimplementer would still not know how to reproduce.
Look for: contradictions between reports, formatting rules stated without evidence, record types
or flags never tested, error paths never triggered, alignment/padding rules that are ambiguous,
and anything marked "could not determine".

You MAY run /workspace/executable yourself to check specific things (use PORT_BASE=5900).
Do NOT decompile or look for source code.

Write your gap list to /tmp/findings/GAPS.md as a prioritised checklist, each item phrased as a
concrete experiment to run. Return the top 25 gaps as your final message.`,
  { label: 'critique', phase: 'Critique' });

return { reports: reports.map((r, i) => ({ topic: TOPICS[i].key, ok: !!r })), critique };
