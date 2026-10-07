export const meta = {
  name: 'char-url-parser',
  description: 'Black-box characterize the C++ url_parser binary across 8 dimensions, adversarially refute each rule, synthesize a spec',
  phases: [
    { title: 'Characterize', detail: 'one agent per behavioral dimension probing the binary' },
    { title: 'Refute', detail: 'perspective-diverse skeptics hunt counterexamples to each rule' },
    { title: 'Spec', detail: 'merge into one authoritative implementable spec' },
  ],
}

const HARNESS = `
You are reverse-engineering a C++ library PURELY AS A BLACK BOX by running a compiled binary.

BINARY: /workspace/dataset/test16_executable
Its C++ driver source is (library source is NOT available - do not look for it):

  int main(int argc, char* argv[]) {
      if (argc < 2) return 1;
      std::string url = argv[1];
      std::cout << url_parser::URL::is_valid_url(url) << std::endl;       // LINE 1
      url_parser::URL parser(url);
      std::cout << url_parser::is_scheme_valid(parser.scheme()) << std::endl;  // LINE 2
      std::cout << url_parser::is_host_valid(parser.host()) << std::endl;      // LINE 3
      std::cout << url_parser::is_port_valid(parser.port()) << std::endl;      // LINE 4
      auto path_segments = url_parser::split_path(parser.path());
      std::cout << path_segments.size() << std::endl;                          // LINE 5
      for (const auto& segment : path_segments) std::cout << segment << std::endl;  // LINES 6+
      return 0;
  }

So each run gives you exactly 5 numbers + the path segments. Lines 1-4 are bools printed as 1/0.

KNOWN INTERFACE (from the binary's symbol table - this is all you get):
  namespace url_parser {
    std::string url_decode(const std::string&);
    std::string url_encode(const std::string&);
    std::vector<std::string> split_path(const std::string&);
    bool is_scheme_valid(const std::string&);
    bool is_host_valid(const std::string&);
    bool is_port_valid(int);                 // NOTE: port is an int
    static bool URL::is_valid_url(const std::string&);
    class URL {
      URL(); URL(const std::string&);
      void parse(const std::string&);
      std::string scheme() const; std::string userinfo() const; std::string host() const;
      int port() const; std::string path() const; std::string query() const;
      std::string fragment() const; std::string authority() const;
      bool has_scheme/has_authority/has_userinfo/has_host/has_port/has_path/has_query/has_fragment() const;
      bool is_valid() const;
      ... setters, normalize(), normalize_case(), normalize_path(), normalize_query(), to_string(), operator==
    };
    // internal statics: trim(const std::string&), to_lower(const std::string&),
    //                   is_hex(char), hex_to_char(char)
    // to_lower is implemented as std::transform with a lambda taking (unsigned char)
  }

PROBE HARNESS - use this pattern (handles quoting safely):
  BIN=/workspace/dataset/test16_executable
  probe() { printf '%s => ' "$(printf '%q' "$1")"; "$BIN" "$1" 2>&1 | tr '\\n' '|'; printf ' (exit %s)\\n' "\${PIPESTATUS[0]}"; }
  probe 'http://example.com'
  probe $'http://a\\tb'        # use $'...' for control chars / tabs / newlines
  probe "$(printf 'http://a\\xc3\\xa9')"   # for high bytes / UTF-8

You may run HUNDREDS of probes - do it in batches inside one bash call using loops. Be exhaustive and systematic:
sweep single characters, boundary lengths, every ASCII code 0..127 where relevant, high bytes 128..255,
empty strings, and combinations. Isolate one variable at a time.

ESTABLISHED FACTS (already confirmed, do not re-derive, but you MAY correct them if you find contradictions):
  ''                              => 0 0 0 0 0
  'http://example.com'            => 1 1 1 0 0
  'https://localhost:8080'        => 1 1 1 1 0
  'http://example.com/a/b/c'      => 1 1 1 0 3 [a,b,c]
  'http://example.com/a/b/c/'     => 1 1 1 0 3 [a,b,c]
  'http://example.com//a//b'      => 1 1 1 0 2 [a,b]      (empty segments dropped)
  'http://example.com/'           => 1 1 1 0 0
  'example.com'                   => 1 0 0 0 1 [example.com]   (no '://' => whole string is path)
  'http://example.com:0'          => 1 1 1 1 0   (port 0 IS valid => absent port must be a sentinel like -1)
  'http://example.com:65535'      => 1 1 1 1 0
  'http://example.com:65536'      => 1 1 1 0 0
  'http://example.com:-1'         => 1 1 1 0 0
  'http://example.com:abc'        => 1 1 1 0 0
  'http://example.com:'           => 1 1 1 0 0
  'http://example.com:80abc'      => 1 1 1 1 0   (looks like std::stoi: leading digits, trailing junk ignored)
  'HTTP://EXAMPLE.COM/A/B'        => 1 1 1 0 2 [A,B]  (NO case normalization in parse)
  '://example.com'                => 1 0 1 0 0   (scheme='' invalid, host='example.com')
  'http:/example.com'             => 1 0 0 0 2 [http:,example.com]
  'http://'                       => 0 1 0 0 0
  'http:///a/b'                   => 1 1 0 0 2 [a,b]
  'http://:8080'                  => 0 1 0 1 0
  'http://@example.com'           => 1 1 1 0 0   (userinfo split on '@')
  'http://example.com?a=/b/c'     => 1 1 1 0 0   (query stripped before path)
  'http://example.com#/x/y'       => 1 1 1 0 0   (fragment stripped before path)
  'http://example.com/a%20b/c%2Fd'=> 1 1 1 0 2 [a%20b,c%2Fd]  (split_path does NOT url-decode)
  'http://example.com/./../a'     => 1 1 1 0 3 [.,..,a]       (no dot-segment removal)
  'http://exa_mple.com'           => 1 1 0 0 0   (underscore => host INVALID)
  'http://-example.com'           => 1 1 1 0 0   (leading hyphen => host VALID)
  'http://example..com'           => 1 1 1 0 0   (empty label => host VALID)
  'http://[::1]:8080/x'           => 1 1 1 0 1 [x]  (!! port INVALID but host VALID - investigate)
  'http://[::1]/x'                => 1 1 1 0 1 [x]
  'http://ex ample.com'           => 1 1 0 0 0
  ':'                             => 1 0 0 0 1 [:]
  '://'                           => 0 0 0 0 0

A LEADING HYPOTHESIS for line 1 (is_valid_url), which you should test hard if it is in your scope:
  is_valid_url(u) == (!host.empty() || !path.empty())  after parsing
`;

const RULE_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    rule: { type: 'string', description: 'Precise, directly-implementable pseudocode/prose. No hedging. Cover every branch and every character class.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence: {
      type: 'array',
      description: 'Confirmed probe results that pin the rule down, especially boundary cases. Represent inputs as bash $\'...\' or plain single-quoted literals.',
      items: {
        type: 'object',
        properties: { input: { type: 'string' }, output: { type: 'string' }, why: { type: 'string' } },
        required: ['input', 'output'],
      },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
    correctionsToEstablishedFacts: { type: 'array', items: { type: 'string' } },
  },
  required: ['dimension', 'rule', 'confidence', 'evidence', 'uncertainties', 'correctionsToEstablishedFacts'],
};

const REFUTE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'corrected', 'refuted'] },
    counterexamples: {
      type: 'array',
      items: {
        type: 'object',
        properties: { input: { type: 'string' }, predictedByRule: { type: 'string' }, actual: { type: 'string' } },
        required: ['input', 'predictedByRule', 'actual'],
      },
    },
    correctedRule: { type: 'string', description: 'The full corrected rule (repeat the original verbatim if confirmed).' },
    notes: { type: 'string' },
  },
  required: ['verdict', 'counterexamples', 'correctedRule', 'notes'],
};

const DIMENSIONS = [
  {
    key: 'parse-structure',
    title: 'URL::parse decomposition',
    task: `Determine EXACTLY how parse() decomposes the input string into scheme / userinfo / host / port / path / query / fragment.
You can only observe the 5 output lines, so design experiments that disambiguate. Techniques:
 - Put a known-valid vs known-invalid marker in a component to read its content off lines 2/3/4.
 - Line 5 + segments leak the ENTIRE path string, so you can read path() almost directly. Exploit this heavily:
   e.g. probe 'X' and look at the segments to see what fell through to path.
 - Determine the ORDER of splitting: is fragment removed before query? is query removed before path? Where does the
   authority end (first '/' vs first of '/','?','#')? Is scheme found via find("://")? first or last occurrence?
 - Where is userinfo split - first '@' or last '@' in authority? Does '@' after a '/' matter?
 - How is the port split from the host - find(':') vs rfind(':')? Is there IPv6 '[...]' special-casing?
   Resolve the 'http://[::1]:8080/x' anomaly definitively: what exactly are host() and port() there?
 - What happens with multiple '://', multiple '?', multiple '#', ':' inside path/query/fragment?
 - Is the input trimmed of whitespace first (there is an internal trim())? Which characters does trim strip?
 - Does parse lowercase anything? (facts say no, confirm)
 - Does the path keep its leading '/'? Does an empty path stay empty or become '/'?
Report the full parsing algorithm as ordered steps.`,
    lenses: ['ordering-of-splits', 'delimiter-search-direction-and-ipv6', 'trim-and-empty-component-semantics'],
  },
  {
    key: 'is_scheme_valid',
    title: 'is_scheme_valid(string)',
    task: `Determine the exact predicate is_scheme_valid(s). To feed an arbitrary scheme string S, probe "S://host" and read LINE 2.
Sweep: empty; every single ASCII char 0..127 as a 1-char scheme; first-char vs later-char rules (letters/digits/'+'/'-'/'.'/'_'/'~'/':'/'%'); uppercase; mixed;
length limits (1,2,...,64,255,256,1000); embedded spaces; high bytes 128..255; NUL is impossible via argv so skip it.
Watch out: your scheme string must not itself contain '://' or otherwise perturb the parse - verify by cross-checking
LINE 3/LINE 5 that the rest still parsed as expected. Report the predicate as an exact character-class rule.`,
    lenses: ['character-classes-and-first-char', 'length-and-boundary', 'high-bytes-and-locale'],
  },
  {
    key: 'is_host_valid',
    title: 'is_host_valid(string)',
    task: `Determine the exact predicate is_host_valid(h). Feed a host via 'http://H' and read LINE 3 (careful: characters like
':' '/' '?' '#' '@' get consumed by the parser, so to test those you must first establish from the parse-structure
what actually reaches host()). Sweep every ASCII char 0..127 in first/middle/last position, high bytes 128..255,
empty, length limits (1..63, 64, 253, 254, 255, 256, 1000+), all-digits, leading/trailing '-' and '.', consecutive dots,
'[' and ']' and IPv6 forms, '_'. Establish whether there is per-label validation (max 63 per dot-label?) or only a
whole-string charset+length check. Resolve definitively whether ':' is an allowed host character (the
'http://[::1]:8080/x' anomaly). Report the predicate as an exact rule.`,
    lenses: ['charset-per-position', 'length-and-label-structure', 'brackets-colons-and-ipv6'],
  },
  {
    key: 'is_port_valid',
    title: 'is_port_valid(int) + string->int port parsing',
    task: `Two things: (a) the integer predicate is_port_valid(int p), and (b) how the port SUBSTRING is converted to that int
(including the sentinel used when no port is present).
Facts: ':0' -> valid, ':65535' -> valid, ':65536' -> invalid, ':-1' -> invalid, ':abc' -> invalid, ':' -> invalid,
':80abc' -> valid, and NO port at all -> invalid. So the absent-port sentinel is NOT 0.
Determine: the exact valid integer range (test 0, 1, 65535, 65536, and think about what the sentinel must be: -1? test
whether any input can make port() == -1 vs some other negative).
Determine the string conversion precisely - is it std::stoi (leading whitespace skipped, optional sign, base 10,
trailing junk ignored, throws invalid_argument on no digits, throws out_of_range beyond INT range) or atoi (no throw,
returns 0) or a hand-rolled digit loop (which would reject ANY non-digit)? Discriminate with:
 ':80abc' (junk after) vs ':abc80', ': 80' / ':\\t80' (leading space - note the parser may trim first), ':+80', ':-0',
 ':007', ':2147483647', ':2147483648', ':99999999999999999999' (out_of_range), ':0x50', ':1e3', ':8.0', ':6 5'.
CRUCIAL: distinguish "conversion produced an out-of-range value" from "conversion threw and fell back to the sentinel" -
both print 0 on line 4, so use additional signals (e.g. does the rest of the URL still parse the same?) or reason from
which inputs are valid. Also test what happens with an EMPTY port after ':' and with ':' appearing twice.
Report both (a) and (b) exactly.`,
    lenses: ['integer-range-and-sentinel', 'string-to-int-conversion-semantics', 'overflow-and-exception-paths'],
  },
  {
    key: 'is_valid_url',
    title: 'URL::is_valid_url(string) - LINE 1',
    task: `Determine the exact static predicate is_valid_url(u). This is the hardest one - it is independent of lines 2-4.
Known: ''->0, 'http://'->0, 'http://:8080'->0, '://'->0, but 'http:///a/b'->1, '://example.com'->1, 'example.com'->1,
'http://@example.com'->1, ':'->1, 'http://?q=1'->0, 'http://#f'->0.
LEADING HYPOTHESIS: is_valid_url(u) == (!host.empty() || !path.empty()) after parsing. TEST THIS EXHAUSTIVELY and try
hard to break it. Alternative hypotheses to rule out: it requires a valid scheme when one is present; it requires
non-empty authority; it delegates to is_valid()/is_host_valid/is_scheme_valid; it checks the trimmed input is non-empty;
it forbids certain characters (spaces? control chars?) anywhere in the URL.
Systematically build a truth table over: {no scheme, empty scheme, valid scheme, invalid scheme} x {empty host,
valid host, invalid host} x {no path, '/', non-empty path} x {query present/absent} x {fragment present/absent} x
{port present/absent}. Use lines 2-5 to know what host/path actually are for each probe, then check line 1 against
your hypothesis. Report the exact predicate.`,
    lenses: ['host-or-path-hypothesis', 'scheme-and-authority-requirements', 'whitespace-control-chars-and-length'],
  },
  {
    key: 'split_path',
    title: 'split_path(string) - LINE 5 and the segments',
    task: `Determine exactly how split_path(p) turns the path string into a vector<string>.
Known: splits on '/', drops empty segments (so '//a//b' -> [a,b], leading and trailing '/' produce nothing),
does NOT url-decode ('a%20b' stays 'a%20b'), does NOT remove '.'/'..' segments.
Determine: does it split on anything besides '/' (e.g. '\\\\')? Does it trim whitespace from each segment (there IS an
internal trim())? Does a segment that is entirely whitespace survive, or does it get trimmed to '' and dropped?
Test '/ /', '/a /', '/ a/', '/\\t/', '/a\\tb/', '/  a  /'. Does it drop segments that become empty AFTER trimming?
Does it handle a completely empty input path (-> 0 segments)? A path of just '/' or '///'? A path with no leading '/'
(relative)? Very long paths and many segments (e.g. 1000 segments - confirm the count prints as a plain integer)?
Non-ASCII bytes preserved byte-for-byte? Also confirm: is url_decode applied anywhere in this pipeline at all
(probe '%41' - does it become 'A'?), and check '%2F' does not become a separator.
Report the exact algorithm.`,
    lenses: ['separator-and-empty-segment-handling', 'per-segment-trimming', 'decoding-and-byte-preservation'],
  },
  {
    key: 'trim-and-bytes',
    title: 'input trimming, whitespace, control chars, high bytes',
    task: `Determine (a) whether/where the internal trim() is applied - to the whole URL in parse()? to individual components?
to path segments? - and (b) EXACTLY which characters trim() strips.
The binary imports std::string::find_first_not_of and find_last_not_of, which strongly suggests
trim(s) = s.substr(first_not_of(WS), ...) with a literal WS character set. Determine that set precisely by testing
each candidate character (space 0x20, tab 0x09, LF 0x0A, CR 0x0D, VT 0x0B, FF 0x0C) as a leading and trailing char.
Method: use LINE 5 + segments to read the path back out - e.g. probe $' /a/b ' or $'\\thttp://example.com/a\\t' and see
whether the whitespace survives into the segments or the host.
Then (c) characterize high bytes 0x80-0xFF: to_lower uses a lambda taking (unsigned char) which suggests the code is
careful about UB; check whether is_host_valid/is_scheme_valid accept high bytes (an isalnum() with the default C
locale rejects them; a hand-rolled a-z/A-Z/0-9 check also rejects them; but a signed-char isalnum could differ).
Test multi-byte UTF-8 in host, scheme, and path. Report exactly what trim strips and how high bytes are treated.`,
    lenses: ['exact-whitespace-set', 'where-trim-is-applied', 'high-byte-and-utf8-treatment'],
  },
  {
    key: 'cli-and-output',
    title: 'CLI contract and exact output formatting',
    task: `Nail the observable I/O contract of the PROGRAM (not the library):
 - No arguments at all: what is printed (nothing?) and what is the exit code (expect 1)?
 - Exactly one arg: normal. Extra args beyond the first: ignored? confirm exit 0.
 - An empty-string arg '': output and exit code.
 - Exact byte formatting: are lines 1-4 printed as '1'/'0' (C++ bool default, no boolalpha)? Confirm with
   'od -c' / 'xxd' that the output is exactly "1\\n1\\n1\\n0\\n0\\n" for 'http://example.com' - LF line endings,
   trailing newline present, no extra spaces, no BOM.
 - LINE 5 is a size_t: confirm it prints as a plain unsigned decimal with no separators (test a path with e.g.
   1500 segments).
 - Is anything ever written to stderr? Any output when the arg is bizarre (control chars, 100KB long arg)?
 - Does a segment containing a newline byte make the output ambiguous (i.e. are segments printed raw)? Test $'/a\\nb/c'.
 - Test a very long argument (e.g. 200000 chars) for crashes/truncation.
Report the exact contract, with hexdump evidence.`,
    lenses: ['exit-codes-and-argc', 'byte-exact-formatting', 'extremes-and-robustness'],
  },
];

phase('Characterize');
log(`Probing ${DIMENSIONS.length} behavioral dimensions, each with ${3} adversarial lenses`);

const results = await pipeline(
  DIMENSIONS,
  (d) => agent(
    `${HARNESS}\n\n=== YOUR ASSIGNMENT: ${d.title} ===\n\n${d.task}\n\n` +
    `Run as many probes as it takes (hundreds is fine, batch them in loops). Do NOT stop at a plausible rule - ` +
    `push until every boundary is pinned by an actual observed probe result. Then report the rule so precisely that ` +
    `someone can implement it in Rust without ever running the binary. If you find that one of the ESTABLISHED FACTS ` +
    `is wrong, say so in correctionsToEstablishedFacts.`,
    { label: `probe:${d.key}`, phase: 'Characterize', schema: RULE_SCHEMA, effort: 'high' }
  ),
  async (rule, d) => {
    if (!rule) return { dimension: d.key, rule: null, refutations: [] };
    const refutations = await parallel(d.lenses.map((lens) => () =>
      agent(
        `${HARNESS}\n\n=== YOUR ASSIGNMENT: ADVERSARIALLY REFUTE A PROPOSED RULE ===\n\n` +
        `Another engineer probed the binary and proposed this rule for "${d.title}":\n\n` +
        `----- PROPOSED RULE -----\n${rule.rule}\n-------------------------\n\n` +
        `They flagged these uncertainties:\n${(rule.uncertainties || []).map(u => '  - ' + u).join('\n') || '  (none)'}\n\n` +
        `YOUR LENS: **${lens}**. Attack the rule specifically from that angle.\n\n` +
        `Your job is to BREAK IT. Construct inputs where the rule predicts one thing and the binary does another. ` +
        `Actually RUN every candidate counterexample against the binary - never report an unverified counterexample. ` +
        `Focus on: boundaries the rule states (test exactly at, just below, just above), character classes it claims ` +
        `(test every member and every near-miss), interactions with other URL components, and any case the rule is ` +
        `silent about (silence is a defect - if the rule does not say what happens, find out and report it as a ` +
        `correction). Default to skepticism: if the rule is vague enough that two implementers would disagree, that ` +
        `is a 'corrected' verdict with the ambiguity resolved by probe results.\n\n` +
        `Return verdict 'confirmed' ONLY if you genuinely could not break it after a serious effort (report how many ` +
        `probes you ran in notes). Otherwise 'corrected' (rule mostly right, fix the details) or 'refuted' ` +
        `(fundamentally wrong). Always fill correctedRule with the COMPLETE rule as it should read.`,
        { label: `refute:${d.key}/${lens}`, phase: 'Refute', schema: REFUTE_SCHEMA, effort: 'high' }
      )
    ));
    return { dimension: d.key, title: d.title, rule, refutations: refutations.filter(Boolean) };
  }
);

const clean = results.filter(Boolean).filter(r => r.rule);
log(`Characterized ${clean.length}/${DIMENSIONS.length} dimensions`);

phase('Spec');
const bundle = clean.map(r => {
  const refs = r.refutations.map((f, i) =>
    `  Skeptic #${i + 1} [${f.verdict}]:\n` +
    (f.counterexamples || []).map(c => `    * input=${c.input}  rule-predicted=${c.predictedByRule}  ACTUAL=${c.actual}`).join('\n') +
    `\n    corrected rule: ${f.correctedRule}\n    notes: ${f.notes}`
  ).join('\n');
  return `##### DIMENSION: ${r.title} (${r.dimension})  [confidence: ${r.rule.confidence}]\n` +
    `PROPOSED RULE:\n${r.rule.rule}\n\n` +
    `EVIDENCE:\n${(r.rule.evidence || []).map(e => `  ${e.input} => ${e.output}${e.why ? '   // ' + e.why : ''}`).join('\n')}\n\n` +
    `UNCERTAINTIES: ${(r.rule.uncertainties || []).join(' | ') || 'none'}\n` +
    `CORRECTIONS TO FACTS: ${(r.rule.correctionsToEstablishedFacts || []).join(' | ') || 'none'}\n\n` +
    `ADVERSARIAL REVIEW:\n${refs}`;
}).join('\n\n');

const spec = await agent(
  `${HARNESS}\n\n=== YOUR ASSIGNMENT: SYNTHESIZE ONE AUTHORITATIVE SPEC ===\n\n` +
  `Eight engineers characterized the binary and skeptics attacked each rule. Here is everything:\n\n${bundle}\n\n` +
  `Produce ONE complete, self-consistent, implementable specification of the observable behavior of this program. ` +
  `Where a skeptic corrected a rule, adopt the correction. Where skeptics CONFLICT with each other or with the ` +
  `original rule, YOU MUST RESOLVE IT BY RUNNING THE BINARY YOURSELF - run whatever probes are needed and state the ` +
  `resolution with the observed output. Do the same for anything still marked uncertain. Do not leave a single ` +
  `"probably" or "may" in the final spec.\n\n` +
  `Then, as a final completeness pass, ask yourself: what is still unverified? Which character classes, boundaries, ` +
  `orderings, or component interactions has nobody actually probed? Probe them now and fold the answers in.\n\n` +
  `Output the spec as precise prose+pseudocode in this exact structure:\n` +
  `  1. CLI contract (argc handling, exit codes, byte-exact output format)\n` +
  `  2. trim(s) - exact character set stripped\n` +
  `  3. parse(url) - the complete ordered decomposition algorithm, yielding scheme/userinfo/host/port/path/query/fragment, including the absent-port sentinel value\n` +
  `  4. is_valid_url(url) - exact predicate\n` +
  `  5. is_scheme_valid(s) - exact predicate\n` +
  `  6. is_host_valid(h) - exact predicate\n` +
  `  7. is_port_valid(int) - exact predicate, and the exact string->int conversion used for the port substring (including exception/fallback paths)\n` +
  `  8. split_path(p) - exact algorithm\n` +
  `  9. A GOLDEN TABLE of at least 60 diverse inputs with their exact observed 5-line-plus-segments output, chosen to cover every branch and boundary in the spec above. Every row MUST be an actually-observed run of the binary, not a prediction.\n` +
  ` 10. Any residual unknowns (ideally none).\n\n` +
  `Be exhaustive. This spec is the ONLY thing the Rust implementer will see.`,
  { label: 'synthesize-spec', phase: 'Spec', effort: 'max' }
);

return { spec, dimensions: clean.map(r => ({ key: r.dimension, confidence: r.rule.confidence, verdicts: r.refutations.map(f => f.verdict) })) };
