export const meta = {
  name: 'furl-blackbox-spec',
  description: 'Exhaustively probe the furl test6 executable to derive a complete behavioral spec for a JS port',
  phases: [
    { title: 'Probe', detail: 'parallel dimension probers running the executable' },
    { title: 'Gaps', detail: 'completeness critic finds unprobed areas' },
    { title: 'Probe2', detail: 'follow-up probes for the gaps' },
    { title: 'Spec', detail: 'synthesize one implementation spec' },
  ],
}

const COMMON = `
You are reverse-engineering a Python program by BLACK-BOX probing. You may NOT read Python library source.

The program is at /workspace/dataset/test6_executable and its Python source is:

    import argparse
    from furl import furl
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    parser.add_argument('--b', type=str, required=True)
    parser.add_argument('--c', type=str, required=True)
    args = parser.parse_args()
    f = furl(args.a)
    print(f.scheme)
    print(f.host)
    print(f.path)
    print(f.query.add({args.b: args.c}))
    print(f.url)

Invoke it as:  /workspace/dataset/test6_executable --a "<URL>" --b "<KEY>" --c "<VAL>"
All three args are REQUIRED. It prints exactly 5 lines:
  line1 = f.scheme      (Python None prints as "None"; empty string prints as "")
  line2 = f.host
  line3 = f.path
  line4 = str(f.query) AFTER add({b: c})
  line5 = f.url AFTER that mutation

PROBING TECHNIQUE:
- Use a bash helper so output is unambiguous. Example:
    p(){ echo "IN=[$1] b=[$2] c=[$3]"; /workspace/dataset/test6_executable --a "$1" --b "$2" --c "$3" 2>&1 | cat -A; echo "rc=$?"; }
  cat -A makes trailing spaces / CR / non-ascii visible ($ = end of line, M- sequences = high bytes).
- Use single quotes in bash to avoid shell mangling.
- To distinguish "empty string" from "None" on a line: cat -A shows "$" for empty and "None$" for None.
- Note lines 4 and 5 reflect the MUTATION (the added b=c pair). To see the *original* query you must
  reason by subtracting the appended pair, or use a b/c pair you can recognize (e.g. b=Z c=Z).
- Some inputs may make the program CRASH (traceback) or exit nonzero. Record those exactly:
  the exception type and message matter, but for our port we mainly need to know WHICH inputs crash.
- Run MANY probes (30+). Be systematic: vary one thing at a time. Confirm every rule with at least
  two independent examples, and actively try to FALSIFY each rule you form.

OUTPUT CONTRACT: return findings as structured data. Rules must be precise enough that another engineer
can implement them in JavaScript WITHOUT running the executable. Always attach the literal probe
transcripts (exact argv you passed, exact 5 output lines) that justify each rule.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'rules', 'transcripts', 'uncertainties'],
  properties: {
    dimension: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, implementable behavioral rules discovered.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'evidence', 'confidence'],
        properties: {
          rule: { type: 'string', description: 'Precise implementable statement of behavior' },
          evidence: { type: 'string', description: 'Concrete argv plus the 5 output lines proving it' },
          confidence: { type: 'string', enum: ['certain', 'likely', 'unsure'] },
        },
      },
    },
    transcripts: {
      type: 'array',
      description: 'Raw probe transcripts: every distinct probe you ran, verbatim.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['a', 'b', 'c', 'out'],
        properties: {
          a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' },
          out: { type: 'string', description: 'The exact 5 output lines joined by newlines, or the crash summary' },
        },
      },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
}

const DIMENSIONS = [
  {
    key: 'scheme',
    prompt: `DIMENSION: SCHEME DETECTION AND NORMALIZATION.
Determine exactly when furl decides a leading token is a scheme vs. part of the path/host.
Probe at minimum: "http://h/p", "HTTP://H/P" (is scheme lowercased? is host lowercased?),
"mailto:a@b.com", "tel:+123", "urn:isbn:1", "javascript:alert(1)", "a+b-c.d://h/p",
"1http://h", "+http://h", "-x://h", "://h/p", ":", "http:", "http:/", "http://", "http:///p",
"http:x", "http:/x", "//h/p" (protocol-relative), "///p", "h:80/p" (is "h" a scheme or host:port?),
"localhost:8080/p", "C:/win/path", "data:text/plain;base64,AAA", "file:///tmp/x",
"ws://h/p", "unknownscheme://h/p", scheme with trailing/leading spaces, " http://h/p".
Report: when is line1 "None" vs "" vs a value; is it lowercased; what characters are allowed in a scheme;
does a scheme with no "//" still parse a host; how does the scheme appear again in line5 (f.url).`,
  },
  {
    key: 'netloc',
    prompt: `DIMENSION: NETLOC — username, password, host, port.
Probe: "http://user:pass@h/p", "http://user@h/p", "http://:pass@h/p", "http://@h/p",
"http://u%3Aser:p%40ss@h/p" (percent-encoded credentials — are they decoded in f.url?),
"http://h:8080/p", "http://h:80/p" (is default port dropped from f.url?), "https://h:443/p",
"http://h:443/p", "https://h:80/p", "http://h:0/p", "http://h:/p" (empty port),
"http://h:abc/p" (invalid port — crash?), "http://h:99999/p", "http://h:-1/p",
"http://UPPER.Example.COM/p" (host case), "http://h./p", "http://.h/p", "http://h..h/p",
"http://[::1]:8080/p" and "http://[::1]/p" and "http://[2001:db8::1]/p" (IPv6 — what is f.host?),
"http://[::1/p" (malformed), "http://127.0.0.1:8/p", "http://xn--fsq.com/p",
a unicode host like http://hello-with-e-acute.com using a real non-ASCII byte (IDNA? percent-encoded? unchanged?),
"http://h/p" with an underscore or a space in the host, "http://user:pa ss@h/p".
Report exactly: line2 (f.host) formatting incl. brackets for IPv6 and case folding, and how the
netloc is reassembled in line5 (default-port omission, credential re-encoding).`,
  },
  {
    key: 'path-encoding',
    prompt: `DIMENSION: PATH — encoding, decoding, and reassembly.
The path is printed on line3 and re-appears in line5.
Probe which characters are percent-ENCODED vs left literal vs DECODED on output. Test paths containing:
space, plus, "%20", "%2F", "%2f" (lowercase hex — is case preserved?), "%252F" (double encoded),
"%" alone, "%zz" (invalid escape), "%a" (truncated escape), literal "/", "//" (empty segments),
"." and ".." segments (is the path normalized/collapsed? probe "http://h/a/./b/../c"),
trailing slash, ";" and ";params" (path params), ":", "@", "&", "=", "$", ",", "!", "*", "'", "(", ")",
"~", "-", "_", ".", "|", "^", "[", "]", "{", "}", "<", ">", double-quote, backslash, backtick,
"#" (would start fragment), "?" (would start query), non-ASCII Latin-1 and CJK and an emoji,
a raw newline or tab in the path, and a control char like 0x01.
Also probe a path that is exactly "" and exactly "/".
Also: does furl keep the path IDENTICAL on line3 and inside line5, or encode differently in each?
Be very precise: give the exact input byte sequence and exact output byte sequence for each character tested.`,
  },
  {
    key: 'query-parse',
    prompt: `DIMENSION: QUERY PARSING (splitting the incoming query string into pairs).
Focus on how the ORIGINAL query string in --a is parsed and then re-serialized on line4/line5.
Probe --b Z --c Z consistently so you can subtract the appended "&Z=Z".
Test query strings: "a=1&b=2", "a=1&a=2" (duplicate keys preserved and ordered?),
"a" (key with no equals), "a=" (empty value), "=1" (empty key), "=" , "&" , "&&a=1&&",
"a=1&&b=2", "a==1", "a=1=2", ";" as a separator ("a=1;b=2" — is semicolon a separator?),
empty query ("http://h/p?"), no query at all, "a=1&" trailing ampersand,
plus handling: "a=b+c" (is plus decoded to space and re-encoded?), "a=b%20c", "a=b%2Bc",
"%26" and "%3D" inside keys and values, a key or value containing a raw space,
a query containing "#", a query appearing before a fragment "?a=1#f",
and a URL with "?" inside the fragment "http://h/p#frag?x=1" (does furl treat that as fragment query?).
Report: the exact separator rules, whether ordering is preserved, whether empty pairs are dropped,
and how a bare key (no equals) is re-serialized.`,
  },
  {
    key: 'query-encode',
    prompt: `DIMENSION: QUERY ENCODING on output (str(query) — line4 — and inside f.url — line5).
This is the most important dimension. Use --b/--c to inject EXACT characters into a key and a value
and observe how they are encoded. Use a simple base URL like "http://h/p" (no existing query) so line4
is exactly the encoded "b=c".
For EACH of these characters, probe it as the KEY and as the VALUE, one character at a time:
  space, plus, ampersand, equals, question mark, hash, slash, colon, at, dollar, comma, semicolon,
  bang, star, apostrophe, open paren, close paren, tilde, dash, underscore, dot, percent, pipe, caret,
  open bracket, close bracket, open brace, close brace, less than, greater than, double quote,
  backslash, backtick, tab, newline, a Latin-1 accented char, a CJK char, an emoji,
  and the literal 3-character string "%41".
Report a definitive TABLE: character -> output in key position, output in value position,
and whether line4 and line5 agree. Pay special attention to: is space encoded as "+" or "%20"?
Is a literal plus left alone or encoded as "%2B"? Are "/" ":" "@" "?" left literal (safe chars)?
Is "%" re-encoded as "%25" or passed through? Is percent-hex output UPPERCASE? What is the UTF-8
encoding behavior for non-ASCII (percent-encoded UTF-8 bytes, uppercase hex)?
ALSO: probe whether characters already present in the ORIGINAL --a query get re-encoded the same way
(e.g. --a "http://h/p?x=a b" vs --a "http://h/p?x=a%20b" vs --a "http://h/p?x=a+b").`,
  },
  {
    key: 'fragment',
    prompt: `DIMENSION: FRAGMENT. furl models the fragment as having its own path and query.
Probe: "http://h/p#f", "http://h/p#", "http://h/p#a/b", "http://h/p#a?b=1",
"http://h/p#?b=1", "http://h/p#a=1", "http://h/p?q=1#f?g=2", "http://h/p##x",
"http://h#f", "http://h/p#f#g", fragment containing space / "%20" / plus / non-ASCII / ampersand,
and a URL with only a fragment "#f". Report how the fragment survives into line5 (f.url):
is it re-encoded, is the "?" inside it preserved, does the added query pair ever land in the fragment,
and where exactly the fragment is placed relative to the query in the reassembled URL.
Also check whether an empty fragment ("http://h/p#") keeps the trailing "#" in f.url.`,
  },
  {
    key: 'no-scheme',
    prompt: `DIMENSION: SCHEMELESS / RELATIVE / DEGENERATE INPUTS.
From earlier scouting we know: --a "www.google.com" gives scheme=None host=None path=www.google.com,
and --a "" gives scheme=None host=None path=(empty) url="?K=V".
Map this space exhaustively: "www.google.com", "www.google.com/p", "www.google.com:80/p",
"/p", "p", "./p", "../p", "//h/p", "//h", "///p", "?a=1", "?", "#f", "a?b", ":", "::", "@h/p",
"h@x/p", " " (single space), "   ", a string of only ampersands, "http", "http:", "://",
"1.2.3.4/p", "1.2.3.4:80/p", "[::1]/p", "localhost", "localhost/p", "localhost:80".
For each report the exact 5 lines. Determine the precise rule that decides host-vs-path when there is
no scheme, and how f.url is reassembled when host is None (e.g. is a "?" always emitted before the query,
is there ever a stray "//"). This dimension decides many corner cases of the port.`,
  },
  {
    key: 'url-reassembly',
    prompt: `DIMENSION: f.url REASSEMBLY (line5) — the exact concatenation algorithm.
Given that a query pair is always added, determine the precise template used to rebuild the URL.
Probe combinations of presence/absence: scheme yes/no x host yes/no x port yes/no x credentials yes/no
x path empty/rooted/relative x original query present/absent x fragment present/absent.
Enumerate at least 24 combinations systematically and record line5 verbatim.
Specifically answer: Is "//" emitted whenever there is a host? Is "//" emitted for a scheme with no host
(e.g. "mailto:x@y")? Is the "?" always emitted (since a pair is always added)? Where does "#" go?
Does a default port get dropped? Does the path get a leading "/" inserted when a host is present but the
path is relative (e.g. --a "http://h" then is url "http://h?K=V" or "http://h/?K=V")?
Produce a pseudocode template for building line5 from the parts, and validate it against every transcript.`,
  },
  {
    key: 'argparse',
    prompt: `DIMENSION: COMMAND-LINE ARGUMENT PARSING (Python argparse behavior we must replicate in Node).
The port must behave identically for argv handling. Probe the executable's argv behavior and record
EXACT stdout/stderr text and EXIT CODES (use: cmd; echo "rc=$?"  and redirect 2>&1, but also check
which stream each message goes to by testing 2>/dev/null and 1>/dev/null separately).
Test: no args at all; missing one of the three; --help and -h; unknown option --z;
"--a=value" equals-form; "--a value"; abbreviation and prefix forms; "--" alone; "-a" single-dash;
repeated "--a x --a y" (last wins?); a value that starts with a dash: --a -5 and --a=-5 and --a "--b";
empty value --a ""; a value containing spaces; extra positional args "foo";
order permutations (--c v --a v --b v). Record the EXACT usage/error message text including the program
name shown (note: the program name comes from sys.argv[0] basename — report the literal string used,
e.g. "test6_executable"), the exact wording of errors like
"error: the following arguments are required: --a, --b, --c", and the exact exit codes (2 for errors, 0 for --help).
Also report whether usage goes to stdout or stderr for --help vs for errors, and the exact blank-line
and indentation layout of the --help output.`,
  },
  {
    key: 'unicode-idna',
    prompt: `DIMENSION: NON-ASCII AND PERCENT-ENCODING ROUND-TRIPS across every component.
Probe non-ASCII (a Latin-1 accented char, CJK text, an emoji) and percent escapes in: the host, the path,
the query key, the query value, the fragment, and the credentials. For each, report whether the output is:
unchanged raw UTF-8, percent-encoded UTF-8 (and whether hex is upper or lower case), IDNA/punycode
converted, or a crash.
Also probe pre-encoded input: "%C3%A9" in each component — is it decoded on line3/line4 or kept escaped?
Is "%c3%a9" (lowercase hex) normalized to uppercase? Is an invalid UTF-8 escape like "%FF" preserved?
Is "%00" allowed? Test mixed content like "/a%20b c/". Report the definitive round-trip rule per component:
for a given component, is the output = input verbatim, or input normalized through decode-then-encode?
This distinction (verbatim passthrough vs normalize) is the single most important thing to nail down.`,
  },
  {
    key: 'query-add-semantics',
    prompt: `DIMENSION: query.add({b: c}) SEMANTICS AND ITS RETURN VALUE.
line4 is print(f.query.add({key: value})) — the printed object is what add() RETURNS.
Determine: does add() APPEND the pair at the end (even if the key already exists), or replace?
Probe --a "http://h/p?K=1" --b K --c 2  -> is line4 "K=1&K=2" or "K=2"?
Probe an empty key: --b "" --c V ; and an empty value: --b K --c "" ; and both empty.
Probe a key that is only "=" or only "&". Probe when the original URL has NO query at all
(is line4 just "K=V" with no leading "&"?) and when the original query is empty ("http://h/p?").
Determine the exact string form of a pair whose value is empty: "K=" or "K"? And a pair whose key is
empty: "=V"? Determine whether the added pair also shows up in line5 and in what position
(before or after the fragment; before or after existing pairs).
Also determine whether the ORIGINAL query pairs get re-encoded when re-serialized (compare
--a "http://h/p?x=a%2Bb" and --a "http://h/p?x=a+b" and --a "http://h/p?x=a b").`,
  },
  {
    key: 'crashes',
    prompt: `DIMENSION: ERROR AND CRASH BEHAVIOR of furl parsing.
Find inputs to --a that make the program raise (nonzero exit / traceback) rather than print 5 lines.
Try: invalid ports ("http://h:abc/p", "http://h:-1/p", "http://h:99999999/p"),
malformed IPv6 ("http://[::1/p", "http://[]/p", "http://[zz]/p"),
inputs with control characters, extremely long inputs, a backslash in the host, a pipe in the host,
"http://h x/p" (space in host), "http://h%2F/p", inputs with "%00",
"http://" alone, ":::", "http://:@:/", and anything else you suspect.
For each crashing input record the exception class and message and the exit code, plus whether ANY
of the 5 lines were printed before the crash (stdout is line-buffered so partial output matters).
Also try to make --b or --c cause a crash. Conclude with a precise list of the crash conditions and
their exact stderr text, since the port should ideally reproduce at least the exit code and the
"which lines were printed" behavior.`,
  },
]

phase('Probe')
log(`Probing ${DIMENSIONS.length} behavioral dimensions of the furl executable in parallel`)

const reports = (await parallel(DIMENSIONS.map(d => () =>
  agent(`${COMMON}\n\n${d.prompt}`, { label: `probe:${d.key}`, phase: 'Probe', schema: SCHEMA })
))).filter(Boolean)

log(`Collected ${reports.length} dimension reports, ${reports.reduce((n, r) => n + r.rules.length, 0)} rules, ${reports.reduce((n, r) => n + r.transcripts.length, 0)} transcripts`)

const digest = reports.map(r =>
  `### DIMENSION: ${r.dimension}\nRULES:\n${r.rules.map(x => `- [${x.confidence}] ${x.rule}\n  EVIDENCE: ${x.evidence}`).join('\n')}\n` +
  `TRANSCRIPTS:\n${r.transcripts.map(t => `  a=${JSON.stringify(t.a)} b=${JSON.stringify(t.b)} c=${JSON.stringify(t.c)}\n  -> ${JSON.stringify(t.out)}`).join('\n')}\n` +
  `UNCERTAINTIES:\n${r.uncertainties.map(u => `- ${u}`).join('\n')}`
).join('\n\n')

phase('Gaps')
const GAP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['question', 'probes'],
        properties: {
          question: { type: 'string', description: 'A specific behavioral question still unanswered or contradictory' },
          probes: { type: 'array', items: { type: 'string' }, description: 'Concrete --a/--b/--c values to run' },
        },
      },
    },
  },
}

const CRITICS = [
  `You are a COMPLETENESS CRITIC. Below are black-box probe reports for a Python furl program that a
   JavaScript engineer must now reimplement byte-for-byte. Identify what is MISSING, CONTRADICTORY, or
   only marked 'likely'/'unsure' — specifically anything where two dimensions disagree, or where a rule
   is stated without an example that isolates it. Focus on things that would make the JS port produce a
   different byte on some plausible input. Return the specific open questions and the exact probes to run.`,
  `You are an ADVERSARIAL TEST DESIGNER. Below are black-box probe reports for a Python furl program.
   Assume the engineer will write the "obvious" implementation from these rules. Invent the inputs most
   likely to break that obvious implementation — interactions BETWEEN components (e.g. a percent-encoded
   char in a path when there is also a fragment and no scheme; a "?" inside a fragment plus an added
   query pair; an empty host with credentials). Return those as open questions plus exact probes.`,
]

const gapReports = (await parallel(CRITICS.map(p => () =>
  agent(`${COMMON}\n\n${p}\n\n=== PROBE REPORTS ===\n${digest}`, { label: 'gap-critic', phase: 'Gaps', schema: GAP_SCHEMA })
))).filter(Boolean)

const gaps = gapReports.flatMap(g => g.gaps)
log(`Critics raised ${gaps.length} open questions; resolving each with a dedicated prober`)

phase('Probe2')
const resolutions = (await parallel(gaps.slice(0, 40).map((g, i) => () =>
  agent(`${COMMON}\n\nRESOLVE THIS OPEN QUESTION DEFINITIVELY by running the executable.\n\nQUESTION: ${g.question}\n\nSUGGESTED PROBES (run these AND any others needed):\n${g.probes.map(x => `- ${x}`).join('\n')}\n\nRun every probe, record verbatim output, and state the definitive answer as implementable rules.`,
    { label: `resolve:${i}`, phase: 'Probe2', schema: SCHEMA })
))).filter(Boolean)

const resolutionDigest = resolutions.map(r =>
  `### RESOLVED: ${r.dimension}\n${r.rules.map(x => `- [${x.confidence}] ${x.rule}\n  EVIDENCE: ${x.evidence}`).join('\n')}\n` +
  `TRANSCRIPTS:\n${r.transcripts.map(t => `  a=${JSON.stringify(t.a)} b=${JSON.stringify(t.b)} c=${JSON.stringify(t.c)} -> ${JSON.stringify(t.out)}`).join('\n')}`
).join('\n\n')

phase('Spec')
const spec = await agent(
  `${COMMON}\n\nYou are the SPEC SYNTHESIZER. Below are exhaustive black-box probe reports plus follow-up
resolutions for the furl program. Produce a SINGLE, COMPLETE, UNAMBIGUOUS implementation specification
that a JavaScript engineer can follow to reproduce the program byte-for-byte WITHOUT running the executable.

Requirements for your output (plain markdown, no schema):
1. A precise PARSING algorithm: input string -> scheme, username, password, host, port, path, query, fragment,
   including the exact regex/decision procedure for scheme detection and host-vs-path resolution.
2. Exact per-component ENCODING/DECODING tables: for path, query key, query value, fragment, host, credentials —
   state the set of characters left literal, the set percent-encoded, hex case, space handling, plus handling,
   and whether existing percent escapes are preserved verbatim or normalized.
3. The exact query PARSE + query.add + str(query) serialization algorithm.
4. The exact f.url REASSEMBLY template, as pseudocode, covering every presence/absence combination.
5. The exact printing rules for lines 1-3 (None vs empty string).
6. The exact argparse-compatible CLI behavior: usage text, error text, streams, exit codes.
7. A list of KNOWN CRASH inputs and their behavior.
8. A CONFLICTS section: anywhere the reports disagreed, state which you believe and why (cite the transcript).
9. A GOLDEN TEST TABLE: at least 60 rows of (input a, b, c) -> exact 5 output lines, drawn VERBATIM from the
   transcripts, chosen to cover every rule. These will be used as regression tests, so they must be verbatim.

Be exhaustive and concrete. Do not hand-wave. Where behavior is genuinely uncertain, say so explicitly.

=== DIMENSION REPORTS ===
${digest}

=== FOLLOW-UP RESOLUTIONS ===
${resolutionDigest}`,
  { label: 'synthesize-spec', phase: 'Spec', effort: 'high' }
)

return { spec, dimensionCount: reports.length, gapCount: gaps.length, resolvedCount: resolutions.length }
