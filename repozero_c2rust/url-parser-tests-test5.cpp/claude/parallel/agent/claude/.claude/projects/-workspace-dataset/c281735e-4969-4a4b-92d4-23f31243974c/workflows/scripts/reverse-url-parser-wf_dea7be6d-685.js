export const meta = {
  name: 'reverse-url-parser',
  description: 'Black-box reverse-engineer the C++ url_parser::URL behavior into a precise spec',
  phases: [
    { title: 'Probe', detail: 'parallel probers per URL dimension against the real binary' },
    { title: 'Introspect', detail: 'binary symbol/string/disassembly analysis' },
    { title: 'Synthesize', detail: 'merge observations into one algorithm spec' },
    { title: 'Adversarial', detail: 'construct counterexamples that break the spec' },
    { title: 'Refine', detail: 'final spec incorporating counterexamples' },
  ],
}

const PROTOCOL = `
# Target
The compiled C++ binary is /workspace/dataset/test5_executable .
Its source (the test driver only) is /workspace/dataset/test5.cpp :

    if (argc < 2) return 1;
    std::string url = argv[1];
    url_parser::URL parser(url);
    std::cout << parser.scheme() << std::endl;   // line 1
    std::cout << parser.host()   << std::endl;   // line 2
    std::cout << parser.port()   << std::endl;   // line 3  (an integer; -1 when absent)
    std::cout << parser.path()   << std::endl;   // line 4
    std::cout << parser.query()  << std::endl;   // line 5

So EVERY successful run prints exactly 5 newline-terminated lines. Empty fields print as empty lines.
The library source is NOT available and you must NOT try to find or read it. Pure black-box probing.

# How to probe (IMPORTANT)
Run it like:
    /workspace/dataset/test5_executable 'THE_URL'
To see exact bytes including empty trailing lines, ALWAYS capture with a delimiter, e.g.:
    /workspace/dataset/test5_executable 'http://a.com' | sed -n 'l' ; echo "exit=\${PIPESTATUS[0]}"
or the most reliable formatting for reporting — number every line:
    /workspace/dataset/test5_executable 'http://a.com' | cat -A | nl -ba
Use single quotes around the URL. For URLs containing single quotes, control characters, or
non-UTF8 bytes, use perl to exec with an exact argv, e.g.:
    perl -e 'exec("/workspace/dataset/test5_executable", "http://a\\x27b.com")' | cat -A | nl -ba
Batch many probes in ONE bash call with a loop so you use few tool calls, e.g.:
    for u in 'http://a' 'http://a:1' 'a://b'; do printf '=== [%s]\\n' "\$u"; /workspace/dataset/test5_executable "\$u" | cat -A | nl -ba; done
\`cat -A\` renders end-of-line as \`\$\`, tabs as \`^I\`, so an empty field shows as a line containing only \`\$\`.
Probe generously — dozens to hundreds of inputs. It is cheap. Note python3 is NOT installed; perl is.
Do not write anything into /workspace/dataset or /output. Use /tmp for scratch files.

# What to report
Report the OBSERVED FACTS, not guesses. For each rule you state, cite at least one concrete
input and its exact 5 field values. If two plausible rules both explain your data, say so and
design a discriminating probe, then run it. Be exhaustive within your assigned dimension.
`

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'rules', 'observations', 'uncertainties'],
  properties: {
    dimension: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise behavioral rules discovered, each with evidence',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'evidence'],
        properties: {
          rule: { type: 'string', description: 'One precise, implementable statement of behavior' },
          evidence: { type: 'string', description: 'Concrete input(s) and the exact 5 observed field values' },
          confidence: { type: 'string', enum: ['certain', 'likely', 'unsure'] },
        },
      },
    },
    observations: {
      type: 'array',
      description: 'Raw probe table: every input tried and its exact 5 outputs. Use "" for an empty field.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['input', 'scheme', 'host', 'port', 'path', 'query'],
        properties: {
          input: { type: 'string' },
          scheme: { type: 'string' },
          host: { type: 'string' },
          port: { type: 'string' },
          path: { type: 'string' },
          query: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
    uncertainties: {
      type: 'array',
      description: 'Things still ambiguous after probing',
      items: { type: 'string' },
    },
  },
}

const DIMENSIONS = [
  {
    key: 'scheme',
    prompt: `Dimension: SCHEME extraction and the scheme/authority separator.
Determine exactly how the scheme is found and what happens when it is malformed or missing.
Probe at minimum: 'http://a.com', 'https://a.com', 'ftp://a.com', 'HTTP://a.com', 'HtTp://A.CoM'
(is the scheme lowercased? is the host lowercased?), 'a://b', '://b', 'http:/a.com', 'http:a.com',
'http//a.com', '//a.com', 'a.com', 'example.com/p?q=1', 'http:///a.com', 'http:////a.com',
'ht+tp://a', 'ht-tp://a', 'ht.tp://a', 'ht1tp://a', '1http://a', 'h t t p://a',
'mailto:user@host', 'file:///etc/passwd', 'urn:isbn:123', 'a:b://c', 'http://a://b',
'x://', '://', ':', '//', '///', 'http://', 'http://:', and the empty string ''.
Also: what if the string starts with '://'? What if there are multiple '://' occurrences —
is the FIRST or the LAST used? Test 'a://b://c' and 'http://x/y://z' carefully.
Does a scheme require the '//' after the colon, or does a bare ':' suffice?
Determine precisely: which substring becomes scheme, and where the remainder-parse begins.`,
  },
  {
    key: 'port',
    prompt: `Dimension: PORT parsing. port() returns an integer printed via std::cout.
Determine exactly how the port substring is located and converted to an int.
Probe at minimum: 'http://a.com' (expect -1), 'http://a.com:8080', 'http://a.com:80',
'http://a.com:0', 'http://a.com:00080' (leading zeros -> 80?), 'http://a.com:' (empty port),
'http://a.com:/p', 'http://a.com:abc', 'http://a.com:80abc', 'http://a.com:abc80',
'http://a.com:8 0', 'http://a.com:+80', 'http://a.com:-80', 'http://a.com: 80', 'http://a.com:80 ',
'http://a.com:65535', 'http://a.com:65536', 'http://a.com:99999', 'http://a.com:2147483647',
'http://a.com:2147483648' (int overflow? does it throw/abort/clamp?), 'http://a.com:4294967296',
'http://a.com:99999999999999999999', 'http://a.com:0x50', 'http://a.com:080',
'http://a.com:8080:9090', 'http://a:1:2/p', 'http://a.com:8080/p:q', 'http://a.com/p:80',
'http://a.com?x=:80', 'http://user:pass@a.com' (is 'pass' read as a port?),
'http://user:pass@a.com:8080', 'http://a.com:8080?q=1', 'http://a.com:8080#f'.
CRITICAL: for any input that makes the program crash, abort, or throw (non-zero exit / stderr
output), record the exact exit code and the exact stderr text — capture with
\`prog 'url' > /tmp/o 2>/tmp/e; echo "exit=\$?"; cat -A /tmp/o; echo "--stderr--"; cat /tmp/e\`.
Report whether -1 means "no colon found" vs "empty/invalid port". Nail down the exact numeric
conversion semantics (std::stoi-like prefix parse? atoi? full-string check?).`,
  },
  {
    key: 'host',
    prompt: `Dimension: HOST extraction.
Determine exactly where the host substring starts and ends.
Probe at minimum: 'http://a.com', 'http://a.com/', 'http://a.com/p', 'http://a.com?q',
'http://a.com#f', 'http://a.com:80/p', 'http://' (empty host), 'http:///p' (empty host + path),
'http://user@a.com', 'http://user:pass@a.com', 'http://user@a.com:80/p',
'http://a@b@c.com' (first or last @?), 'http://@a.com', 'http://user@', 'http://:pass@a.com',
'http://[::1]', 'http://[::1]:8080', 'http://[2001:db8::1]/p', 'http://[::1' (unterminated),
'http://a b.com', 'http://A.COM' (case preserved or lowercased?), 'http://a.com.',
'http://xn--bcher-kva.example', 'http://127.0.0.1:8080', 'http://localhost',
'http://a%20b.com', 'http://a.com\\\\p' (backslash), 'http://a.com;x', 'http://a.com,x'.
Is userinfo (the part before '@') stripped from the host, or kept? Are IPv6 brackets kept?
Does the host stop at the first of '/', '?', '#', ':' — and in what precedence?`,
  },
  {
    key: 'path',
    prompt: `Dimension: PATH extraction.
Determine exactly where the path starts and ends, and whether the leading '/' is included.
Probe at minimum: 'http://a.com' (empty path?), 'http://a.com/', 'http://a.com/p',
'http://a.com/p/q/', 'http://a.com//p', 'http://a.com/p?q=1', 'http://a.com/p#f',
'http://a.com/p?q=1#f', 'http://a.com?q=1' (path empty when query directly follows host?),
'http://a.com#f', 'http://a.com:80/p', 'http://a.com/p q', 'http://a.com/a?b?c',
'http://a.com/./../x' (any normalization? probably none — verify), 'http://a.com/%2e%2e/x',
'http://a.com/p%20q' (any percent-decoding? verify), 'http://a.com/a#b?c'
(is a '?' AFTER a '#' still treated as the query start?), 'http://a.com/p;params',
'a.com/p' (no scheme — is 'a.com/p' host+path or all path?), '/just/a/path',
'http://a.com/very/long/'+many segments. Also whether the path retains a trailing slash.
Report the exact delimiter set that terminates the path and their precedence.`,
  },
  {
    key: 'query-fragment',
    prompt: `Dimension: QUERY extraction and FRAGMENT handling.
There is no fragment() accessor, so determine whether a '#...' fragment is stripped, or leaks
into path/query.
Probe at minimum: 'http://a.com?q=1', 'http://a.com/p?q=1', 'http://a.com/p?' (empty query),
'http://a.com/p?#f', 'http://a.com/p?q=1#f' (does query become 'q=1' or 'q=1#f'?),
'http://a.com/p#f?q=1' (does query become 'q=1' even though it is after the '#'?),
'http://a.com/p#f', 'http://a.com#f', 'http://a.com/p?a=1&b=2', 'http://a.com/p?a=1?b=2'
(first or last '?'), 'http://a.com/p?a=%20b' (decoding?), 'http://a.com/p?a=1+2',
'http://a.com?' , 'http://a.com#', 'http://a.com?#', 'http://a.com#?',
'http://a.com/p?q=1#f1#f2', 'http://a.com/?', 'http://a.com/#'.
Also check whether '#' anywhere (even inside the host, e.g. 'http://a#b.com/p') truncates.
Nail down: is the query the substring after the FIRST '?', and does it stop at a later '#'?`,
  },
  {
    key: 'no-scheme-and-degenerate',
    prompt: `Dimension: inputs with NO scheme, and fully degenerate inputs.
This is the highest-risk area for divergence. Determine exactly what the parser does when there
is no '://'.
Probe at minimum: '' (empty string), ' ' (single space), 'a', 'a.com', 'a.com/', 'a.com/p',
'a.com:80', 'a.com:80/p', 'a.com?q=1', 'a.com#f', '/p', '/p?q', '//a.com', '//a.com/p',
'///a.com', '?q=1', '#f', ':80', ':', '::', ':::', '/', '//', '///', '////',
'localhost:8080', 'localhost:8080/p', 'user@host', 'user:pass@host',
'http:/a.com/p', 'http:a.com/p', 'http//a.com/p', 'httpx://a.com',
a 1-char string 'x', a string of only ':' repeated, a string of only '/' repeated,
a very long string (e.g. 100000 chars — build with perl and check for crash/timeout),
a string with embedded newline 'http://a\\nb.com', embedded tab, embedded NUL is impossible in
argv so skip that, high-bit bytes 'http://\\xff\\xfe.com' (use perl exec), and a valid UTF-8
multibyte host 'http://ünïcödé.example/pä?q=ü'.
For every crash/abort record exit code and exact stderr. Also confirm: with NO argument at all
the program exits 1 and prints nothing; with EXTRA arguments only argv[1] is used.`,
  },
  {
    key: 'default-ports-and-int-format',
    prompt: `Dimension: default-port inference and integer formatting of port().
The examples show 'http://example.com' -> port line '-1', so http does NOT default to 80.
Verify that for a wide range of schemes there is never an implicit default port:
'http://a', 'https://a', 'ftp://a', 'ssh://a', 'file://a', 'ws://a', 'wss://a', 'gopher://a',
'telnet://a', 'ldap://a', 'HTTP://a', 'HTTPS://a'.
Then nail the integer PRINTING: std::cout on an int. Find inputs that yield unusual integers and
record the exact printed text: 'http://a:0' -> '0'? 'http://a:-0'? 'http://a:007'?
Very large values: 'http://a:2147483647', 'http://a:2147483648', 'http://a:4294967295',
'http://a:99999999999999999999' — does it print a clamped value, a wrapped value, or does the
program abort with a std::out_of_range / std::invalid_argument message? Record exact exit code and
exact stderr bytes for each. Also 'http://a:' and 'http://a:x' — do they print -1 or 0 or abort?
This determines whether the Rust port conversion must replicate std::stoi (prefix parse + throw),
std::atoi (prefix parse, no throw, UB on overflow), or a hand-rolled digit loop.
Be exhaustive and precise about the boundary between "prints a number" and "aborts".`,
  },
  {
    key: 'precedence-and-interactions',
    prompt: `Dimension: DELIMITER PRECEDENCE and cross-field interactions — the combinatorics.
The parser presumably scans for ':', '/', '?', '#', '@' in some order. Your job is to determine
the exact ORDER of operations by probing inputs where the delimiters appear in unusual relative
positions. Systematically probe inputs of the form 'http://HOSTPART' where HOSTPART contains the
delimiters in every interesting order, e.g.:
'http://a/b:c', 'http://a?b:c', 'http://a#b:c', 'http://a:1/b:2', 'http://a/b?c:d',
'http://a?b/c', 'http://a#b/c', 'http://a#b?c', 'http://a?b#c', 'http://a/b#c?d',
'http://a:1?b/c', 'http://a:1#b/c', 'http://a@b:1/c?d#e', 'http://a:1@b:2/c?d#e',
'http://a/b@c', 'http://a?b@c', 'http://a:1/2:3?4:5#6:7'.
KEY questions to answer definitively with evidence:
 (a) Is the ':' searched for the port limited to the authority segment (before the first '/'),
     or does a ':' later in the path get mistaken for a port?
 (b) Is the '?' searched over the whole string or only after the path start?
 (c) Does a '#' before a '?' prevent the query from being found?
 (d) Is '@' handled at all (userinfo stripping)?
Also probe a full-featured URL 'https://user:pw@sub.example.co.uk:8443/a/b/c.html?x=1&y=2#frag'
and report all five fields exactly.`,
  },
]

phase('Probe')
const probes = DIMENSIONS.map(d => () =>
  agent(PROTOCOL + '\n\n' + d.prompt, {
    label: `probe:${d.key}`,
    phase: 'Probe',
    schema: FINDINGS,
  })
)

phase('Introspect')
const introspects = [
  () => agent(`You are reverse-engineering a compiled C++ binary to understand a URL parser.
Binary: /workspace/dataset/test5_executable . You may NOT look for the C++ library source (it is
not present anyway) but you MAY inspect the binary itself with nm, objdump, strings, c++filt, readelf, gdb.
python3 is not installed; perl is. Do not modify anything outside /tmp.

Tasks:
1. \`nm -C /workspace/dataset/test5_executable\` and \`nm -DC\` — list every url_parser symbol,
   demangled. Report the full member-function list of url_parser::URL (this reveals the real
   interface: e.g. is there a fragment(), a userinfo(), a normalize()?). Note whether accessors
   return by value or const-ref, and whether parsing happens in the constructor.
2. \`strings -a\` the binary and report EVERY string literal that looks parser-related: "://",
   "http", "https", ":", "/", "?", "#", any default-port table, any exception message
   ("stoi", "invalid_argument", "out_of_range", "basic_string"), etc. This reveals whether a
   default-port lookup table or std::stoi is used.
3. Which libstdc++ functions related to conversion are referenced (undefined symbols)? Is
   std::stoi / strtol / atoi / __throw_out_of_range referenced? Report the exact undefined symbol
   list relevant to integer conversion and to string search (find, substr, find_first_of).
4. If the parsing code is in the binary, disassemble it (\`objdump -dC --no-show-raw-insn\` limited
   to the url_parser functions) and summarise the control flow into pseudocode: the sequence of
   find() calls with which needle and which start offset, and the substr ranges. Report the
   character needles you can identify from immediates/string refs.
Report concrete findings only; say "not determinable" rather than guessing. Include the pseudocode
if you can recover it.`, { label: 'introspect:symbols', phase: 'Introspect' }),

  () => agent(`Inspect the compiled binary /workspace/dataset/test5_executable to determine the
exact integer-conversion semantics used for the port. Do NOT look for C++ source. Use nm/objdump/
strings/c++filt/readelf/gdb. python3 is not installed; perl is. Scratch files in /tmp only.

Specifically decide between: std::stoi (throws std::invalid_argument on no-digits and
std::out_of_range on overflow), std::atoi/strtol (no throw), or a hand-rolled loop.
Evidence to gather:
 - undefined/dynamic symbols: does it reference \`std::__cxx11::stoi\`, \`strtol\`, \`atoi\`,
   \`__cxx11::basic_string...stoi\`, \`__throw_invalid_argument\`, \`__throw_out_of_range\`,
   \`std::invalid_argument::invalid_argument\`?
 - string literals: "stoi", "stol", "invalid_argument", "out_of_range", "basic_string::substr" etc.
 - Then CONFIRM behaviorally: run
     /workspace/dataset/test5_executable 'http://a:x' ; echo "exit=\$?"
     /workspace/dataset/test5_executable 'http://a:99999999999' ; echo "exit=\$?"
     /workspace/dataset/test5_executable 'http://a:2147483648' ; echo "exit=\$?"
     /workspace/dataset/test5_executable 'http://a:' ; echo "exit=\$?"
   capturing stdout and stderr separately, and report exact exit codes and exact stderr text.
 - Also determine whether there is a try/catch around the conversion (a landing pad / __cxa_begin_catch
   reference near the port code) — i.e. does the parser swallow the exception and fall back to -1?
Conclude with a definitive statement of the conversion semantics including the exact overflow and
non-numeric behaviour, backed by both static and behavioural evidence.`, { label: 'introspect:stoi', phase: 'Introspect' }),
]

const probeResults = await parallel(probes.concat(introspects))
const findings = probeResults.filter(Boolean)
log(`gathered ${findings.length} probe/introspection reports`)

const bundle = findings.map((f, i) =>
  `----- report ${i + 1} -----\n` +
  (typeof f === 'string' ? f : JSON.stringify(f, null, 1))
).join('\n\n')

phase('Synthesize')
const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pseudocode', 'rules', 'edgeCases', 'openQuestions'],
  properties: {
    pseudocode: { type: 'string', description: 'Complete, unambiguous parsing algorithm as pseudocode, byte-index precise' },
    rules: { type: 'array', items: { type: 'string' } },
    edgeCases: {
      type: 'array',
      description: 'Canonical test vectors: input -> exact 5 output lines',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['input', 'scheme', 'host', 'port', 'path', 'query'],
        properties: {
          input: { type: 'string' }, scheme: { type: 'string' }, host: { type: 'string' },
          port: { type: 'string' }, path: { type: 'string' }, query: { type: 'string' },
        },
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
}

const spec = await agent(`You are synthesizing a single, precise, implementable specification of a
C++ URL parser's behaviour from many independent black-box probe reports and binary-introspection
reports. The goal is a spec so exact that a Rust reimplementation is byte-for-byte identical on
every input.

Context: a test driver constructs \`url_parser::URL parser(argv[1])\` and prints, one per line:
scheme(), host(), port() (an int, -1 when absent), path(), query(). Always 5 lines. \`argc < 2\`
exits 1 with no output.

Here are the reports:

${bundle}

Produce:
1. \`pseudocode\`: the complete algorithm, precise about byte indices, search directions (find vs
   rfind), search start offsets, delimiter precedence, and the exact integer conversion semantics
   (including overflow and non-numeric behaviour, and whether an exception is caught). It must
   handle EVERY degenerate input the reports covered: empty string, no scheme, only delimiters,
   unterminated IPv6, oversized port, etc.
2. \`rules\`: a flat checklist of the behavioural invariants.
3. \`edgeCases\`: the union of the most discriminating observed test vectors (aim for 80+),
   copied EXACTLY from the reports' raw observation tables. These become the differential test suite.
   If two reports disagree about the same input, prefer the one with explicit byte-level evidence and
   note the conflict in openQuestions.
4. \`openQuestions\`: anything still ambiguous.
Be ruthless about not inventing behaviour that no report observed.`, { label: 'synthesize:spec', phase: 'Synthesize', schema: SPEC_SCHEMA })

phase('Adversarial')
const LENSES = [
  'degenerate/empty inputs and inputs consisting only of delimiter characters',
  'delimiter precedence and ordering (: / ? # @ appearing in surprising relative positions)',
  'numeric port conversion boundaries, overflow, signs, whitespace and non-digit suffixes',
  'the no-scheme / relative-URL path, and schemes with a bare ":" and no "//"',
  'IPv6 bracket hosts, userinfo with embedded ":" and "@", and multibyte/high-bit bytes',
]
const attacks = await parallel(LENSES.map((lens, i) => () => agent(PROTOCOL + `

Below is a CANDIDATE SPECIFICATION of the parser, synthesized from earlier probes. Your job is
adversarial: find inputs where the candidate spec predicts something DIFFERENT from what the real
binary actually does. Focus your attack on this lens: ${lens}.

Method: read the spec, mentally execute it on candidate inputs, PREDICT the 5 outputs, then run the
real binary and compare. Report only inputs where prediction != reality (plus the corrected
behaviour), and any input where the spec is silent/ambiguous so you cannot predict at all.
Try at least 60 distinct inputs in your lens. Batch them in few bash calls.

CANDIDATE SPEC pseudocode:
${spec.pseudocode}

CANDIDATE RULES:
${(spec.rules || []).map(r => '- ' + r).join('\n')}

Report a list of concrete divergences (input, what the spec predicts, what the binary really does)
and any newly discovered rules. If you find no divergence in your lens after a genuinely thorough
attack, say so explicitly and list the inputs that confirmed the spec.`, {
      label: `attack:${i + 1}`, phase: 'Adversarial', schema: FINDINGS,
    })))

const attackBundle = attacks.filter(Boolean).map((a, i) =>
  `----- attack ${i + 1} (${a.dimension || ''}) -----\n${JSON.stringify(a, null, 1)}`).join('\n\n')

phase('Refine')
const finalSpec = await agent(`Refine a URL-parser specification using adversarial counterexamples.

CURRENT SPEC pseudocode:
${spec.pseudocode}

CURRENT RULES:
${(spec.rules || []).map(r => '- ' + r).join('\n')}

CURRENT EDGE CASES (input -> scheme|host|port|path|query):
${(spec.edgeCases || []).map(e => `[${e.input}] -> [${e.scheme}]|[${e.host}]|[${e.port}]|[${e.path}]|[${e.query}]`).join('\n')}

ADVERSARIAL FINDINGS (these were verified against the real binary and OVERRIDE the spec wherever
they conflict):
${attackBundle}

Produce the FINAL specification: corrected pseudocode that accounts for every counterexample, the
full rule checklist, and a merged, de-duplicated edgeCases table (aim for 120+ vectors) combining
the original edge cases with every input mentioned in the adversarial findings, using the REAL
observed outputs. Every vector's outputs must be the real binary's behaviour. openQuestions should
list anything still unresolved.

You may re-run /workspace/dataset/test5_executable yourself to resolve any conflict between reports
— do so for every input where reports disagree, and for any vector you are not fully certain of.
Run it as: /workspace/dataset/test5_executable 'URL' | cat -A | nl -ba`, {
  label: 'refine:final-spec', phase: 'Refine', schema: SPEC_SCHEMA,
})

return { spec: finalSpec, rawProbeCount: findings.length }
