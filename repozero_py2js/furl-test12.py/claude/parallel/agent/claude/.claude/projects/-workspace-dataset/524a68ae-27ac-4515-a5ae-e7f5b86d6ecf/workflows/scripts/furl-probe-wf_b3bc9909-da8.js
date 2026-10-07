export const meta = {
  name: 'furl-probe',
  description: 'Reverse-engineer furl/argparse behavior from the test12 executable across subsystems',
  phases: [
    { title: 'Probe', detail: 'parallel black-box probing per subsystem' },
    { title: 'Verify', detail: 'adversarial prediction-vs-actual checks per spec' },
  ],
}

const COMMON = `
You are reverse-engineering a Python program's behavior as a BLACK BOX by running a precompiled executable.

Executable: /workspace/dataset/test12_executable
Source (Python, for reference):
    import argparse
    from furl import furl
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    parser.add_argument('--b', type=str, required=True)
    parser.add_argument('--c', type=str, required=True)
    parser.add_argument('--d', type=str, required=True)
    args = parser.parse_args()
    f = furl(args.a)
    print(f.fragment.__setattr__('str', args.b) or f.fragment)   # LINE1
    print(f.fragment.add(args.c))                                # LINE2
    print(f.fragment.set(args.d, 'value'))                       # LINE3
    print(f.url)                                                 # LINE4

RUN IT LIKE: /workspace/dataset/test12_executable --a "<A>" --b "<B>" --c "<C>" --d "<D>"
Never use the 'python' command. Do not read furl source; it is not available. Probe empirically.

ALREADY-ESTABLISHED FACTS (do not re-derive, but DO stress-test if in your area):
- --b is completely ignored: __setattr__('str', b) sets a dead instance attribute, no effect, returns None.
- LINE1 prints str(fragment) as parsed from A.
- LINE2 = fragment.path.add(C) then print str(fragment).
- LINE3 = fragment.path.load(D); fragment.query.load('value'); print str(fragment)  -> query is always literally 'value'.
- LINE4 prints the whole URL with the mutated fragment.
- Fragment str = path + '?' + query when both non-empty, else path+query. When query non-empty, literal '?' chars inside the fragment PATH are escaped to %3F; when query is empty they stay raw.
- furl DECODES percent-escapes on parse and RE-ENCODES on output: '%41%42' -> 'AB'; '%2F' inside a path segment -> stays '%2F'; lone '%' -> '%25'; 'a%zz' -> 'a%25zz'.
- Scheme and host are lowercased. Default ports dropped (http:80, https:443) but non-default kept (http:443 kept).
- URL query: '+' decodes to space, space encodes to '+'. 'a=b&c&d=' round-trips exactly (key-only 'c' vs empty-value 'd=' are distinct).

METHOD: run MANY probes (60+), vary one thing at a time, use printf %q or cat -A style to make whitespace visible, and note exit codes and stderr separately. Prefer a bash loop over a case list.

DELIVERABLE: a precise, implementable specification of YOUR assigned area: exact algorithm/rules, character sets (list the literal safe characters), ordering of operations, and a table of at least 25 concrete input->output examples you actually observed (verbatim). Call out anything surprising or that you could not determine. Be rigorous: an implementer will code directly from your spec with no access to the executable.
`

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'rules', 'safeCharacters', 'examples', 'uncertainties'],
  properties: {
    area: { type: 'string' },
    rules: { type: 'array', items: { type: 'string' }, description: 'Precise implementable rules, ordered' },
    safeCharacters: { type: 'string', description: 'Literal characters left unencoded, or N/A' },
    examples: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['args', 'output'],
        properties: {
          args: { type: 'string', description: 'exact CLI args used' },
          output: { type: 'string', description: 'exact stdout (use \\n for newlines)' },
          note: { type: 'string' },
        },
      },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
}

const AREAS = [
  {
    key: 'argparse',
    prompt: `AREA: argparse command-line parsing behavior ONLY (not furl).
Determine exactly how the CLI parses process argv so it can be reimplemented by hand in Node:
- required args missing (one, several, all) -> exact stderr text, exit code, usage line wording, order of missing names.
- '--a=value' vs '--a value' forms. '--a' with no following token. Values that look like flags ('--a --b' , '--a -1', '--a=-x').
- Prefix/abbreviation matching: does '--' + partial work? There are options --a --b --c --d and -h/--help. Try '-a' (single dash), '--A' (case), unknown '--e'.
- Repeated options ('--a 1 --a 2') -> which wins.
- Empty string values, values with spaces/newlines/unicode, values starting with '-'.
- Extra positional arguments -> error text.
- '--help'/'-h' exact stdout text and exit code. Bare '--' separator handling.
- Interspersed ordering (--c before --a).
Report exact stderr strings verbatim including the program name shown in usage, and exit codes.`,
  },
  {
    key: 'url-structure',
    prompt: `AREA: URL parsing into components and re-serialization as f.url (LINE4), EXCLUDING fine-grained path/query/fragment character encoding (other agents cover those).
Focus on structure. Use a fixed C and D (e.g. --c c --d d) and vary A. Determine:
- How A is split into scheme / netloc(username,password,host,port) / path / query / fragment, and how it is rebuilt.
- Presence/absence rules: when is '//' emitted? when is ':' after scheme emitted? Try: 'ex.com/p', '//ex.com/p', '/p', 'p', 'http:', 'http://', 'http:///p', 'http://ex.com', '?q', '#f', '', 'mailto:a@b.com', 'tel:+123', 'file:///tmp/x', 'ftp://h/p', 'unknownscheme://h/p', 'a+b-c.d://h/p', 'HTTP://X', 'http:path', 'http:/path', '//user@host', 'http://@host', 'http://user@host', 'http://user:@host', 'http://:pw@host', 'http://host:', 'http://host:0', 'http://host:65536', 'http://host:abc' (does it error?), IPv6 '[::1]', '[::1]:80', trailing-dot hosts, uppercase user/pass, unicode host, host with underscore.
- Default-port dropping table: test schemes http,https,ftp,ftps,ws,wss,sftp,ssh,telnet,file,gopher,imap,smtp and their canonical ports; state exactly which (scheme,port) pairs are omitted from output.
- Does username/password get percent-encoded/decoded? Try 'http://u%40s:p%3Aw@h/'.
- Any error/exception cases (nonzero exit, traceback) — record the exact message and which inputs cause them.
Give the exact reconstruction algorithm for f.url as pseudocode.`,
  },
  {
    key: 'url-path',
    prompt: `AREA: the MAIN URL path encoding/decoding (the part between netloc and '?'), as it appears in LINE4 output.
Vary A's path only, keep --c c --d d. Determine the exact per-segment decode+encode algorithm and the SAFE character set for main-URL path segments.
Test every ASCII punctuation char individually inside a path segment: ! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \\ ] ^ _ \` { | } ~ and space, and control-ish chars. Report which pass through raw and which become %XX (uppercase or lowercase hex?).
Also: percent-decoding on input ('%41'->'A', '%2f' lowercase input -> ?, '%2F', '%', 'a%z', '%%41', '%25', UTF-8 '%E4%B8%AD' and raw unicode, non-UTF8 like '%FF' -> what happens?).
Also: empty segments ('a//b'), leading/trailing slashes, '.' and '..' segments (normalized or preserved?), path params with ';', very long paths, a path that is only '/'.
Note: main-URL path may differ from fragment path in safe chars — another agent covers fragment; just characterize the MAIN path precisely.
State clearly: is decoding done per-segment before splitting on '/' or after? (test 'a%2Fb' vs 'a/b').`,
  },
  {
    key: 'fragment-path',
    prompt: `AREA: the FRAGMENT path: how fragment.path is parsed from A's '#...' portion, how .add(C) appends, how .load(D) replaces, and how segments are encoded in LINE1/LINE2/LINE3/LINE4.
Determine the SAFE character set for FRAGMENT path segments and how it differs from the main URL path (test every ASCII punctuation char inside C and inside D and inside A's fragment).
Nail down .add() semantics precisely:
- add to empty path, add to path with trailing slash, add absolute-looking '/x', add '', add '/', add 'a/b/c', add 'a//b', add '.' and '..'.
- Does add join with '/' always? What happens with trailing-slash bookkeeping (e.g. fragment 'a/' + add 'b' -> 'a/b', fragment 'a' + add 'b' -> 'a/b', fragment 'a' + add '/b' -> ?).
- Is the result of add() the same object printed later (mutation) — confirm LINE3 fully replaces the path from LINE2.
Also characterize .load(D): does it reset absolute/trailing-slash state? Is the leading '/' preserved ('/x' -> '/x?value')?
And confirm the '?'-escaping rule: '?' raw when fragment query empty, '%3F' when query non-empty — test in LINE2 with an A whose fragment already has a query, and in LINE3 (query always 'value'). Does the same conditional escaping apply to any OTHER character (e.g. '#')?`,
  },
  {
    key: 'query',
    prompt: `AREA: query string parsing and re-encoding — BOTH the main URL query (A's '?...' part, shown in LINE4) and the fragment query (A's fragment '#path?query' part, shown in LINE1/LINE2).
Note LINE3/LINE4's fragment query is always literally 'value', so use A's fragment query for fragment-query probing.
Determine:
- Parse rules: separator characters ('&' only, or also ';'?), key/value split on first '=' or last? key with no '=' (prints bare) vs 'k=' (prints 'k='), value with '=' inside ('a=b=c'), empty key ('=v'), lone '&', leading/trailing '&', '&&'.
- Ordering: preserved? duplicates preserved? ('a=1&b=2&a=3')
- Encoding: exact SAFE character set for keys and for values (test every ASCII punctuation individually in both key and value). Is space '+' or '%20'? Is '+' on input decoded to space? '%2B'? Is '/' safe? is '?' safe? is ':' safe? is '=' inside a value escaped? is '&' escaped?
- Percent decoding on input and re-encoding on output ('%41', '%', 'a%zz', UTF-8, '%FF').
- Empty query: 'http://h/p?' -> does output keep the '?'. 'http://h/p?#f' etc.
- Fragment query specifics: does '#' inside... and is the fragment-query safe set identical to the main-URL query safe set? Test the SAME punctuation list in both positions and report any differences in a side-by-side table.
Report the two safe sets explicitly and any key-vs-value differences.`,
  },
  {
    key: 'fragment-compose',
    prompt: `AREA: composition — how str(fragment) is built from (path, query, separator), and how f.url decides to emit '#'.
Determine:
- Exact rule for fragment string: combinations of empty/non-empty path and query. Craft A values giving: empty path+empty query, path only, query only, both. (Use A's fragment for LINE1/LINE2 where the query is not forced.)
- When A's fragment is '#' with nothing after it vs no '#' at all: is there any observable difference in LINE1 and in LINE4? (furl tracks a 'separator'/has-fragment flag). Test A='http://h/p', 'http://h/p#', 'http://h/p#?', 'http://h/p#?q=1', 'http://h/p#a?', 'http://h/p?q#'.
- In LINE4 the fragment always ends up with query 'value', so '#' is presumably always emitted — verify with D='' (empty path) and confirm output is '...#value'.
- Interaction with an empty URL: A='' -> LINE4? A='#'? A='?'? A='#?'
- Whether the fragment query being present forces a '?' separator even when path is empty (observed: D='' -> 'value', no leading '?') — confirm and also test A='http://h#?q=1' (empty fragment path, non-empty fragment query) in LINE1/LINE2.
- Does adding to the fragment path affect whether '#' appears in f.url when everything is empty?
Give the exact pseudocode for str(fragment) and for the '#' emission in f.url.`,
  },
]

phase('Probe')

const results = await pipeline(
  AREAS,
  (a) => agent(`${COMMON}\n\n${a.prompt}`, { label: `probe:${a.key}`, phase: 'Probe', schema: SPEC_SCHEMA, effort: 'high' }),
  (spec, a) => {
    if (!spec) return null
    const claims = spec.rules.slice(0, 40)
    return agent(
      `${COMMON}\n\nAREA UNDER AUDIT: ${a.key}\n\nAnother agent produced these RULES for this area:\n${claims.map((r, i) => `R${i + 1}. ${r}`).join('\n')}\n\nAnd reported safe characters: ${JSON.stringify(spec.safeCharacters)}\n\nYOUR JOB: adversarially falsify. For EACH rule, design at least one probe whose outcome the rule predicts, run it against the executable, and compare prediction vs actual. Default to reporting a rule as WRONG or INCOMPLETE if you find any input where it mispredicts. Also hunt for behavior the rules omit entirely (edge cases they never mention). Run at least 50 probes. Return corrections with verbatim observed outputs.`,
      {
        label: `verify:${a.key}`,
        phase: 'Verify',
        effort: 'high',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['area', 'confirmedRules', 'corrections', 'omissions'],
          properties: {
            area: { type: 'string' },
            confirmedRules: { type: 'array', items: { type: 'string' } },
            corrections: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['rule', 'why', 'evidence'],
                properties: { rule: { type: 'string' }, why: { type: 'string' }, evidence: { type: 'string' } },
              },
            },
            omissions: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    ).then((v) => ({ area: a.key, spec, audit: v }))
  },
)

return results.filter(Boolean)
