export const meta = {
  name: 'probe-url-parser-abi',
  description: 'Black-box probe the C++ url_parser binary across behavior dimensions, adversarially verify each inferred rule, synthesize a precise spec',
  phases: [
    { title: 'Probe', detail: 'one agent per behavior dimension, running the binary with many argument combos' },
    { title: 'Falsify', detail: 'adversarial re-probe designed to break each inferred rule' },
    { title: 'Synthesize', detail: 'merge into a single implementable spec' },
  ],
}

const BIN = '/workspace/dataset/test15_executable'

const COMMON = `
You are reverse-engineering a compiled C++ binary as a BLACK BOX. The binary is at ${BIN}.

Invocation contract: it takes EXACTLY 6 positional args: scheme host port path query fragment.
It prints 8 lines to stdout: scheme(), host(), port(), path(), query(), fragment(), to_string(), is_valid().

RULES OF ENGAGEMENT:
- You may ONLY run the binary and observe stdout/stderr/exit code. There is NO C++ source available; do not look for any.
- ALWAYS quote every argument in the shell, including empty ones: ${BIN} "http" "example.com" "80" "/" "" ""
- Make output unambiguous. Use a helper that numbers the lines and marks empties, e.g.:
    p(){ printf '### IN: [%s]\\n' "$*"; ${BIN} "$@" >/tmp/o 2>/tmp/e; printf '  exit=%d\\n' $?; nl -ba -s': ' /tmp/o | sed 's/$/<END>/'; if [ -s /tmp/e ]; then echo "  STDERR: $(cat /tmp/e)"; fi; }
  Then call p with 6 quoted args. Beware: trailing empty args are easy to lose — verify your helper really passes 6.
- Run MANY cases (30+ minimum). Batch them into a few Bash calls; do not do one call per case.
- Be exhaustive about the boundary cases in your assigned dimension.
- Do not guess. Every rule you report must be backed by an observed input/output pair you actually ran.

Baseline facts already established (re-verify if relevant to you):
- ("http","example.com","80","/","","")  -> lines: http / example.com / 80 / "/" / "" / "" / "http://example.com:80/" / 1
- ("http","example.com","-1","/","","") -> to_string is "http://example.com/"  (port omitted), port() prints -1
- ("http","example.com","0","/","","")  -> to_string is "http://example.com:0/"  (port 0 IS included)
- ("http","","80","/","","")            -> to_string is "http://:80/", is_valid=1
- ("","example.com","80","/","","")     -> to_string is "/" (scheme+authority both vanish), is_valid=1
- ("","","0","","","")                  -> to_string is "", is_valid=0

Report rules as precise, implementable statements (pseudocode-level), each with the concrete evidence line.
`

const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string', description: 'Precise implementable statement of behavior' },
          evidence: { type: 'string', description: 'Exact args and exact observed output proving it' },
        },
        required: ['rule', 'evidence'],
      },
    },
    rawObservations: {
      type: 'array',
      description: 'Compact input->output records for every case run, one string each',
      items: { type: 'string' },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
  required: ['dimension', 'rules', 'rawObservations', 'uncertainties'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    confirmedRules: { type: 'array', items: { type: 'string' } },
    refutedRules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          originalRule: { type: 'string' },
          counterexample: { type: 'string' },
          correctedRule: { type: 'string' },
        },
        required: ['originalRule', 'counterexample', 'correctedRule'],
      },
    },
    newRules: { type: 'array', items: { type: 'string' } },
    finalSpec: { type: 'string', description: 'Definitive pseudocode for this dimension after falsification' },
  },
  required: ['dimension', 'confirmedRules', 'refutedRules', 'newRules', 'finalSpec'],
}

const DIMENSIONS = [
  {
    key: 'to_string-composition',
    prompt: `DIMENSION: exact composition algorithm of to_string().

Determine the precise concatenation algorithm. Specifically nail down:
- Is the "scheme://" + host + ":port" authority block gated on scheme being non-empty, on host, or on something else? Test all 4 combos of empty/non-empty scheme x host, at several port values (-1, 0, 80).
- Exactly which port values are OMITTED from to_string()? Test port = -1, -2, -5, -80, 0, 1, 65535, 65536, 70000, 2147483647. Report the exact predicate (e.g. "port > 0" vs "port != -1" vs "port >= 0").
- Separator forms: is it "scheme://" always, or "scheme:" + "//" conditionally? Test scheme non-empty with host empty AND port -1: ("http","","-1","/","","").
- Query: is it prefixed "?" only when query non-empty? Fragment: "#" only when non-empty? Test query="" fragment="f", query="q" fragment="", both, neither.
- Does a leading "?" already in the query arg get duplicated ("??q")? Same for a leading "#" in fragment.
- Path: is path inserted verbatim? Test empty path with everything else set: ("http","h","80","","q","f"). Test path without a leading slash: ("http","h","80","p","","") -> does it become "http://h:80p" or "http://h:80/p"?
- Any userinfo appearing? (there is a userinfo() accessor but from_components takes no userinfo).`,
  },
  {
    key: 'is_valid-predicate',
    prompt: `DIMENSION: the exact predicate behind is_valid() (prints 1 or 0).

This is the highest-value unknown. Build a truth table and find the exact boolean formula.
Known: ("","","0","","","")->0 ; ("http","","80","/","","")->1 ; ("","example.com","80","/","","")->1.
- Vary scheme in: "", "http", "https", "HTTP", "h", "1http", "ht tp", "ht+tp", "ht-tp", "ht.tp", "http:", "!!"  while holding host="example.com" port=80 path="/".
- Vary host in: "", "example.com", "EXAMPLE.COM", "local host", "a", "1.2.3.4", "999.999.999.999", "[::1]", "-bad.com", "bad-.com", "un_der.com", "a..b", ".com", "com.", "x@y.com", a 300-char host  while holding scheme="http".
- Vary port in: -2147483648, -100, -1, 0, 1, 80, 65535, 65536, 100000, 2147483647 while holding scheme="http" host="example.com".
- Vary path/query/fragment (empty vs set vs weird) to see if they matter at all.
- Test the minimal cases: is_valid with scheme="" host="" but path="/x" ; scheme="" host="" port=80 ; etc. Pin down whether it is (scheme_ok || host_ok), (scheme_ok && host_ok), or a stored flag set some other way.
Report the definitive boolean formula, and separately the definitions of scheme-validity, host-validity, port-validity you inferred.`,
  },
  {
    key: 'scheme-transform',
    prompt: `DIMENSION: what from_components does to the scheme string before storing it (as revealed by line 1 = scheme()).

- Case: "HTTP", "Http", "HtTpS" -> is it lowercased?
- Whitespace: " http", "http ", " http ", "ht tp", "\\thttp", "http\\n" (use $'\\t' / $'\\n' in bash) -> trimmed? preserved?
- Trailing colon / separator: "http:", "http://", "://" -> stripped?
- Non-alpha: "1http", "+http", "ht_tp", "ht-tp", "ht.tp", "ht+tp", "HTTP2", "" -> stored verbatim?
- Unicode/UTF-8 multibyte: "htTPÜ", "日本" -> byte-preserved? any case mapping applied to non-ASCII bytes (watch for locale-dependent tolower on bytes >= 0x80)?
- Very long scheme (500 chars).
Also confirm whether the transform applied to scheme also shows up inside to_string() (line 7) identically.`,
  },
  {
    key: 'host-transform',
    prompt: `DIMENSION: what from_components does to the host string before storing it (line 2 = host()).

- Case: "EXAMPLE.COM", "Example.Com" -> lowercased?
- Whitespace: " example.com", "example.com ", "exa mple.com", tab/newline embedded.
- Trailing dot "example.com.", leading dot, double dots "a..b".
- IPv6 forms: "[::1]", "::1", "[2001:db8::1]".
- With port embedded: "example.com:8080" -> is the colon part split off into port, or kept in host?
- With userinfo embedded: "user:pass@example.com" -> split into userinfo (check whether to_string gains "user:pass@")?
- With a path embedded: "example.com/foo".
- Percent-encoded "%65xample.com" -> decoded?
- Uppercase non-ASCII UTF-8 bytes: "ÉXAMPLE.com" -> any byte mangling?
- Very long host (400 chars).
Report exactly which of these are transformed vs stored verbatim, and how line 7 (to_string) reflects it.`,
  },
  {
    key: 'port-stoi',
    prompt: `DIMENSION: how argv[3] is turned into an int (this is std::stoi in the test harness), and how port() prints it.

Determine, for each of these argv[3] values, the printed port() value, the to_string() port segment, exit code, and any stderr:
"80", "080", "+80", " 80", "80 ", " 80 ", $'\\t80', "8 0", "80abc", "80.9", "0x50", "0X50", "abc", "", "-", "+", "-0", "-1", "-2147483648", "2147483647", "2147483648", "-2147483649", "99999999999999999999", "1e3", "0b11", "  -42xyz", "\\n80".
For the throwing cases (std::invalid_argument / std::out_of_range from stoi), record the EXACT stderr text and EXACT exit code (e.g. 134 from SIGABRT) and whether any stdout was produced before dying. Use: ${BIN} ... >/tmp/o 2>/tmp/e; echo "exit=$?"; then dump both files with markers.
This matters because the Rust port must reproduce the same behavior for these inputs. Report exactly which inputs abort and with what message/exit status, and the exact parse rule for accepted inputs (leading whitespace skipped, optional sign, base-10 digits, stop at first invalid char, error if no digits, range-error if outside int32).`,
  },
  {
    key: 'path-transform',
    prompt: `DIMENSION: what from_components does to the path string (line 4 = path()) and how it lands in to_string().

- Empty path "" with scheme+host set: is it stored as "" or defaulted to "/"?
- No leading slash: "foo", "foo/bar".
- Trailing slash: "/foo/", "/".
- Dot segments: "/a/./b", "/a/../b", "/../a", "/a/b/..", "/a/b/../..", "/./", "//a//b//", "///".
  IMPORTANT: determine whether from_components applies normalize_path() automatically or stores verbatim.
- Whitespace: " /a", "/a ", "/a b", tab/newline inside.
- Percent-encodings: "/a%20b", "/a%2Fb", "/%zz", "/a+b" -> decoded? encoded? verbatim?
- Special chars: "/a?b", "/a#b" (does an embedded ? or # get split into query/fragment?), "/a;b", "/a&b".
- UTF-8 multibyte path, 500-char path.
Report which are verbatim vs transformed, with evidence.`,
  },
  {
    key: 'query-fragment-transform',
    prompt: `DIMENSION: what from_components does to query (line 5) and fragment (line 6), and how they appear in to_string().

QUERY: "", "q=1", "?q=1", "??q=1", "q=1&r=2", "&&", "q=", "=1", "q= 1" (space), "q=%20", "q=a+b", "a=1&a=2", "#frag" inside query, tab/newline, 400-char query, UTF-8.
  - Is a leading "?" stripped? Is the query re-normalized/sorted (there is a normalize_query symbol — check whether from_components calls it, e.g. does "b=2&a=1" come back reordered)? Are empty pairs dropped? Is percent-encoding applied or decoded?
FRAGMENT: "", "f", "#f", "##f", "a b", "a%20b", "a#b", "?x", tab/newline, UTF-8, 400 chars.
  - Is a leading "#" stripped?
For each, report the exact stored value (line) and the exact to_string() rendering (line 7), verbatim vs transformed.`,
  },
  {
    key: 'harness-argc-and-io',
    prompt: `DIMENSION: the test harness wrapper behavior, independent of the URL logic.

- argc: run with 0,1,2,3,4,5 args -> confirm exit code 1 and ZERO stdout. Run with 6 args -> normal. Run with 7, 8, 20 args -> are extras ignored, output unchanged?
- Line endings and flushing: confirm each of the 8 outputs is terminated by exactly "\\n" (std::endl) and that there is a trailing newline after line 8, with no CR. Use "od -c | tail" on the output to prove byte-exactness for one case.
- is_valid() printing: confirm it prints "1"/"0" (int-style via operator<< on bool, NOT "true"/"false").
- port() printing: confirm plain decimal, no padding/plus, and how -1 and INT_MIN print.
- Args containing NUL is impossible; but test args that are pure whitespace " ", and args with a literal "-" prefix like "--help" as scheme (make sure there is no flag parsing).
- Confirm stdout ordering is exactly: scheme, host, port, path, query, fragment, to_string, is_valid.
Report byte-level confirmation.`,
  },
  {
    key: 'cross-field-interactions',
    prompt: `DIMENSION: interactions and whole-URL round-trip behavior that single-field probes would miss.

- Does a "?" or "#" embedded in the PATH arg get re-split into query/fragment by from_components? Test ("http","h","80","/p?x=1#f","","") and inspect lines 4,5,6,7.
- Does a ":" + digits embedded in HOST get split into the port, overriding argv[3]? Test ("http","h:9090","80","/","","").
- Does "user@" in host become userinfo and appear in to_string? Test ("http","u:p@h","80","/","","").
- Does a full URL passed as the scheme arg get parsed? Test ("http://h:80/p?q#f","","-1","","","").
- Combined weirdness: all six fields non-empty and weird at once, e.g. ("HTTPS","EXAMPLE.com","443","/a/../b%20c","b=2&a=1","#top") -> report all 8 lines exactly. This is a key differential test case.
- Idempotence check: take to_string() output of a case, and see if feeding its components back reproduces it.
- Also probe several "realistic" cases to be used later as regression fixtures, and report all 8 lines verbatim for each:
  ("http","example.com","80","/","","") ; ("https","www.google.com","443","/search","q=test","results") ;
  ("ftp","ftp.example.org","21","/files/document.pdf","","") ; ("http","localhost","8080","/api/v1/users","id=123&name=john","profile") ;
  ("https","api.github.com","443","/repos/owner/repo","page=1&per_page=100","") ;
  ("mailto","","-1","user@example.com","","") ; ("file","","-1","/etc/hosts","","") ;
  ("HTTP","EXAMPLE.COM","8080","/A/B","Q=V","FRAG") ; ("http","1.2.3.4","65535","//a//b","&&","##x")`,
  },
]

phase('Probe')
log(`Probing ${DIMENSIONS.length} behavior dimensions of the C++ binary, each with an adversarial falsification pass`)

const results = await pipeline(
  DIMENSIONS,
  (d) => agent(`${COMMON}\n\n${d.prompt}`, {
    label: `probe:${d.key}`,
    phase: 'Probe',
    schema: PROBE_SCHEMA,
  }),
  (probe, d) => {
    if (!probe) return null
    return agent(
      `${COMMON}\n\nDIMENSION UNDER REVIEW: ${d.key}\n\n` +
      `A previous investigator probed this dimension and inferred the following rules. ` +
      `Your job is ADVERSARIAL: actively try to FALSIFY each rule by finding inputs where it predicts the wrong output. ` +
      `For every rule, design at least 2 new inputs (not already tested) that would expose the rule as wrong if it is wrong, run them, and compare prediction vs reality. ` +
      `Pay special attention to off-by-one boundaries, empty strings, sign boundaries, and whether a rule that was only tested with one other field set still holds when that field is empty.\n\n` +
      `RULES TO ATTACK:\n${JSON.stringify(probe.rules, null, 2)}\n\n` +
      `STATED UNCERTAINTIES (resolve these definitively by experiment):\n${JSON.stringify(probe.uncertainties, null, 2)}\n\n` +
      `Then write finalSpec: complete, unambiguous pseudocode for this dimension that a Rust implementer can follow with zero guesswork. ` +
      `Include the exact literal outputs for any case where the behavior is surprising.`,
      { label: `falsify:${d.key}`, phase: 'Falsify', schema: VERIFY_SCHEMA }
    ).then((v) => ({ dimension: d.key, probe, verify: v }))
  }
)

const good = results.filter(Boolean)
log(`${good.length}/${DIMENSIONS.length} dimensions probed and falsified; synthesizing spec`)

phase('Synthesize')

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    fromComponentsSpec: { type: 'string', description: 'Complete pseudocode for URL::from_components field storage/transforms' },
    toStringSpec: { type: 'string', description: 'Complete pseudocode for to_string()' },
    isValidSpec: { type: 'string', description: 'Complete pseudocode for is_valid() including helper predicates' },
    portParseSpec: { type: 'string', description: 'Complete pseudocode for std::stoi emulation including abort behavior, exact stderr and exit code' },
    harnessSpec: { type: 'string', description: 'Complete pseudocode for main(): argc check, print order, formatting' },
    regressionFixtures: {
      type: 'array',
      description: 'Concrete verified fixtures: the 6 args and the exact 8 expected output lines',
      items: {
        type: 'object',
        properties: {
          args: { type: 'array', items: { type: 'string' } },
          expected: { type: 'array', items: { type: 'string' } },
        },
        required: ['args', 'expected'],
      },
    },
    remainingRisks: { type: 'array', items: { type: 'string' } },
  },
  required: ['fromComponentsSpec', 'toStringSpec', 'isValidSpec', 'portParseSpec', 'harnessSpec', 'regressionFixtures', 'remainingRisks'],
}

const spec = await agent(
  `${COMMON}\n\n` +
  `You are the SYNTHESIZER. Nine independent investigators probed the binary and then adversarially falsified their own findings. ` +
  `Their post-falsification specs are below. Merge them into ONE definitive, self-consistent specification that a Rust engineer can implement with zero guesswork.\n\n` +
  `Where two investigators disagree, RUN THE BINARY YOURSELF to settle it — do not average or hedge. ` +
  `Also independently re-verify, by running the binary, each of these load-bearing claims:\n` +
  `  (a) the exact predicate for omitting the port from to_string()\n` +
  `  (b) whether the scheme://host:port block is gated on scheme, host, or both\n` +
  `  (c) the exact boolean formula for is_valid()\n` +
  `  (d) whether from_components normalizes case / path dot-segments / query order, or stores verbatim\n` +
  `  (e) whether a leading "?" in query or "#" in fragment is stripped\n` +
  `  (f) what happens for a non-numeric port argument (exact stderr + exit code)\n\n` +
  `For regressionFixtures, produce at least 25 verified fixtures spanning the ordinary cases AND every surprising edge you found. ` +
  `Each fixture's "expected" MUST be the 8 stdout lines exactly as the binary printed them (empty string for an empty line). Run them to confirm.\n\n` +
  `INVESTIGATOR REPORTS:\n${JSON.stringify(good.map((g) => ({ dimension: g.dimension, spec: g.verify?.finalSpec, confirmed: g.verify?.confirmedRules, corrections: g.verify?.refutedRules, newRules: g.verify?.newRules })), null, 2)}`,
  { label: 'synthesize-spec', phase: 'Synthesize', schema: SPEC_SCHEMA, effort: 'high' }
)

return { spec, perDimension: good.map((g) => ({ dimension: g.dimension, finalSpec: g.verify?.finalSpec })) }
