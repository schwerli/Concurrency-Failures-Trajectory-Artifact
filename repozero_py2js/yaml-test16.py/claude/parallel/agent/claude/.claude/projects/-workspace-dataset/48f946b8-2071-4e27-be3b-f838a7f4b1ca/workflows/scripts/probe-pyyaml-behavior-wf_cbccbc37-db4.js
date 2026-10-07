export const meta = {
  name: 'probe-pyyaml-behavior',
  description: 'Exhaustively probe the PyYAML safe_load+safe_dump executable to build a behavioral spec',
  phases: [
    { title: 'Probe', detail: 'one agent per YAML feature area, running the executable' },
    { title: 'Gaps', detail: 'completeness critic finds unprobed areas and probes them' },
  ],
}

const SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, implementable rules inferred from observed behavior. Each rule must be actionable by an implementer.',
      items: { type: 'string' },
    },
    cases: {
      type: 'array',
      description: 'Concrete input/output evidence. Encode literal newlines as \\n, tabs as \\t.',
      items: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'exact value passed to --a, newlines as \\n' },
          stdout: { type: 'string', description: 'exact stdout, newlines as \\n' },
          rc: { type: 'integer' },
          note: { type: 'string' },
        },
        required: ['input', 'stdout', 'rc'],
      },
    },
    surprises: {
      type: 'array',
      description: 'Behaviors that would surprise an implementer who assumed generic YAML semantics',
      items: { type: 'string' },
    },
  },
  required: ['category', 'rules', 'cases', 'surprises'],
}

const PREAMBLE = `You are probing a pre-compiled Python executable to reverse-engineer exact behavior.

The executable at /workspace/dataset/test16_executable runs exactly this Python:

    import yaml, argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    args = parser.parse_args()
    result = yaml.dump(yaml.safe_load(args.a), Dumper=yaml.SafeDumper)
    print(result)

Invoke it as:  /workspace/dataset/test16_executable --a 'YAML TEXT'
Use single-quoted bash strings, or printf/heredoc into a shell variable, for inputs containing quotes/newlines/backslashes.
To see exact whitespace and newlines, pipe through \`cat -A\` or \`od -c\`. ALWAYS capture the exit code (\`echo "RC=$?"\`).
Batch many probes per bash call (a for-loop over inputs) — you should run MANY DOZENS of distinct inputs.
Note: the trailing print() adds one extra newline beyond yaml.dump's own trailing newline.

Your goal is a precise, implementable behavioral spec for a from-scratch JavaScript reimplementation.
Do NOT write any implementation code. Do NOT read Python library source. Probe empirically, then generalize into rules.
Be exhaustive within your assigned area, including nasty edge cases and error cases (report the error class name and message shape, and the exit code).

YOUR ASSIGNED AREA:
`

const AREAS = [
  {
    key: 'load-plain-scalar-resolution',
    prompt: `Implicit type resolution of PLAIN (unquoted) scalars on LOAD, as evidenced by how they dump back.
Cover: integers (decimal, leading +/-, underscores like 1_000, octal 0o17 AND 0017, hex 0x1f, binary 0b1010, sexagesimal 1:20:30, huge ints beyond 64-bit);
floats (1.5, .5, 5., 1e3, 1E+3, 1.0e-3, .inf, -.Inf, .NAN, sexagesimal 1:20.5, underscores 1_000.5, "1.0" vs "1");
booleans (every documented YAML 1.1 spelling and case variant: y n Y N yes no Yes YES no NO true TRUE True false on off On OFF ON);
null (null Null NULL ~ empty string / omitted value);
timestamps (2001-12-14, 2001-12-14 21:59:43.10 -5, 2001-12-14t21:59:43.10-05:00, 2001-12-14 21:59:43, partial dates like 2001-12, 20011214);
and near-misses that must stay STRINGS (e.g. 1.2.3, 0x, 1_, +-1, .inf.inf, 12:60:00, 2001-13-45, "1 2", "y." , "Y ES", "TrUe", "NuLl", "0b2", "0o8", "1:2:3:4", "-", "?", "!", "e5", "1e", "1.e5", ".e5", "1:").
For each, report what the value dumped back as (that reveals the resolved Python type: e.g. int -> bare digits, str -> quoted or bare, bool -> true/false, null -> null, datetime -> 2001-12-14 ... , date -> 2001-12-14).
To disambiguate str-vs-int reliably, ALSO probe inside a sequence like '[VALUE]' and as '{k: VALUE}'.`,
  },
  {
    key: 'dump-scalar-style-choice',
    prompt: `The DUMP side style choice and escaping for STRING values (and how non-strings render).
Determine exactly when a string is emitted plain vs 'single-quoted' vs "double-quoted", and the escaping rules.
Probe strings (pass them in via double-quoted YAML input so you control the exact string, e.g. --a '{k: "VALUE"}' or --a '"VALUE"'):
strings that look like numbers/bools/nulls (123, 1.5, true, no, null, ~, .inf, 0x1f, 1:20, 2001-12-14);
empty string ""; strings of only spaces; leading space; trailing space; internal double spaces; leading/trailing tabs;
strings starting with indicators - ? : , [ ] { } # & * ! | > % @ \` " ' and with "- ", "? ", ": ", " #";
strings containing ": " or " #" in the middle; strings containing only "-"; "---"; "..."; "<<";
strings with newlines (one, several, leading newline, trailing newline, consecutive newlines, ONLY newlines);
strings with control chars (\\x00 \\x07 \\x08 \\t \\x0b \\x0c \\r \\x1b \\x85 \\xa0 \\u2028 \\u2029 \\ufeff);
non-ASCII (é, 中文, emoji with surrogate pairs, \\u00a0) — check whether they are escaped as \\xNN / \\uNNNN / \\UNNNNNNNN or emitted raw (allow_unicode default);
backslashes and quotes inside strings; a single "'" ; a single '"'.
Report the EXACT emitted bytes for each (use cat -A). Derive the full precedence rule and the double-quote escape table.`,
  },
  {
    key: 'dump-line-folding-width',
    prompt: `Line-width / wrapping / folding behavior of the dumper (PyYAML best_width defaults).
Probe long scalars and long structures: plain strings of length 50..200 with spaces at various positions; long strings with NO spaces (unbreakable);
long single-quoted-forced strings (e.g. a long string starting with a digit-like token so it must quote); long double-quoted-forced strings (containing a control char or non-ASCII) — check where the line breaks land and how continuation lines are indented;
long keys; long strings nested 1, 2, 3 levels deep in mappings/sequences (indentation changes the available width);
a string with a very long run of spaces; a string whose fold point falls exactly at the boundary; strings with a space at position 79/80/81.
Also probe multi-line strings combined with wrapping.
Derive the exact rule: what column triggers a break, where breaks are allowed, how the continuation is indented, how folding interacts with single vs double quotes (including escaped-char boundaries and \\<newline> continuation in double quotes), and how trailing/leading spaces near a fold are preserved (the "\\ " / \\-escape trick).`,
  },
  {
    key: 'dump-collection-structure',
    prompt: `DUMP structure of collections: indentation, key ordering, nesting, empty collections, and complex keys.
Probe (constructing inputs with flow YAML so you control the loaded object):
nested mappings; sequences inside mappings (is the sequence indented relative to its key?); mappings inside sequences; sequences inside sequences; deep nesting 4-6 levels;
empty mapping {} and empty list [] at root and nested; a mapping whose value is empty map/list;
KEY ORDERING: are mapping keys sorted on output? probe {b: 1, a: 2, C: 3, "10": x, "2": y}; mixed-type keys (int and str keys together: {1: a, "b": c}) — does it raise TypeError or sort somehow? probe {2: x, 10: y, 1: z}; bool/null keys; float keys;
non-string keys generally (int, float, bool, null, date);
COMPLEX keys: a mapping key that is itself a mapping or sequence (via flow input '{? [1,2] : v}' or '{[1,2]: v}' style) — how is "? " / ": " emitted, and when does a simple key become an explicit "?" key (very long keys > 128 chars, multiline keys, keys that are collections)?
Also: !!set inputs, !!omap inputs, merge keys '<<', duplicate keys, and root-level sequence vs mapping vs scalar.
Report exact output bytes including trailing "..." lines when present.`,
  },
  {
    key: 'dump-document-markers',
    prompt: `Document-level dump behavior: the trailing "..." end marker, "---" start marker, and the exact trailing newlines.
The known-odd fact: a root scalar prints an extra "...\\n" line but a root mapping/sequence does not. Pin down the EXACT rule.
Probe root values of every kind: plain string, quoted string, multi-line string, empty string, null, int, float, bool, timestamp, list, map, empty list, empty map, !!binary, !!set, a string that itself is "..." or "---", a very long root string that wraps, a root string ending in a newline, a root double-quoted string, a root single-quoted string.
Also probe INPUT document syntax: leading "---", "--- value", trailing "...", input that is only comments, input that is only "---", input that is only whitespace/newlines, input that is only "..." , multiple documents ("a\\n---\\nb") -> what error/exit code, "%YAML 1.1\\n---\\nx", "%YAML 1.2\\n---\\nx", byte-order-mark prefixed input, input with \\r\\n line endings, input with \\r only, input with a trailing newline vs none, input with NEL (\\x85) and LS/PS line separators.
Report exact stdout bytes (cat -A) and exit codes. For errors give the exception class name and full message text.`,
  },
  {
    key: 'load-block-scalars',
    prompt: `LOAD of block scalars: literal | and folded >, with all chomping and indentation indicators.
Because dump renders newlines visibly (as single-quoted folded blank lines), you can infer the loaded string exactly; to be safest, wrap as '{k: <block>}' and study output, and cross-check with a length probe if useful.
Cover: |, |-, |+, |2, |-2, |2-, >, >-, >+, >2; content with blank lines inside; trailing blank lines; leading blank lines; more-indented lines (folding must not fold them);
lines with trailing spaces; tabs inside content; empty block (nothing after the header); block whose first content line is more indented than the indicator says; block at nested indentation; block as a sequence item ('- |\\n  x');
folded-style line-break folding rules (single newline -> space, blank line -> newline, more-indented lines keep breaks, break before/after a more-indented line);
error cases: inconsistent/insufficient indentation, content less indented than the indicator, a tab used as indentation, both '-' and '+', an indicator digit of 0, text after the header on the same line ('| foo'), a comment after the header ('| # c').
Report exit codes and exception class + message for errors.`,
  },
  {
    key: 'load-quoted-and-escapes',
    prompt: `LOAD of single-quoted and double-quoted scalars, including all escape sequences and multi-line folding.
Cover double-quoted escapes: \\0 \\a \\b \\t \\n \\v \\f \\r \\e \\" \\/ \\\\ \\N \\_ \\L \\P \\  (escaped space) \\xNN \\uNNNN \\UNNNNNNNN, escaped newline (line continuation), invalid escapes (\\q, \\x1, \\u12, \\U1234567, \\xZZ) -> error class/message;
surrogate pairs and astral chars via \\U0001F600; \\uD800 (lone surrogate) behavior.
Single-quoted: '' escaping for a literal quote; a lone ' inside; multi-line single-quoted folding (single break -> space, blank line -> newline, leading/trailing whitespace of each line stripped); trailing/leading spaces preserved or not.
Multi-line double-quoted: folding rules, an escaped newline at end of line, a line ending in a backslash-space, leading whitespace on continuation lines, blank lines inside.
Unclosed quotes and quotes containing tabs/control characters -> error class/message/exit code.
Also: quoted scalars are always strings even if they look like numbers — confirm via dump. And empty '' and "" -> empty string, and how that dumps.`,
  },
  {
    key: 'load-flow-and-plain-multiline',
    prompt: `LOAD of flow collections and plain (unquoted) multi-line scalars — the trickiest scanner areas.
Flow: [1,2,3]; nested [[1],[2]]; {a: 1}; {a: 1, b: {c: [1,2]}}; trailing commas [1,2,]; empty [] {} and [ ] { }; missing values {a: , b: 1}; flow keys without values {a, b}; '{a}' ; '[a: 1]' (single-pair mapping inside a sequence) — what does that produce?; '{? a : b}'; nested empty [{}]; comments inside flow; newlines inside flow collections; deeply nested flow; adjacent-value JSON-like '{"a":1}' (no space after colon — is it allowed for quoted keys but not plain?); plain scalar containing ':' inside flow ('{a: b:c}'); ',' inside a plain scalar in flow.
Plain multi-line: 'a\\n b' at root (continuation lines fold to a space); 'k: a\\n  b'; plain scalars with blank lines inside; plain scalar terminated by ': ' or ' #'; a plain scalar starting on the line after the key; plain scalars containing '#' not preceded by space; plain scalars with trailing spaces before the newline.
Also block sequences/mappings interactions: '- - a', '- a: 1\\n  b: 2', 'a:\\n- 1', explicit '? k\\n: v', a key with no value ('a:'), 'a: \\nb: 2', duplicate keys, tab characters used for indentation -> error class/message, and a mapping value on its own line indented less than the key.
Report exit codes and full error messages for the failures.`,
  },
  {
    key: 'load-tags-anchors-aliases',
    prompt: `LOAD of explicit tags, anchors, aliases, and the safe-loader's tag whitelist.
Cover every standard tag safe_load supports and how each dumps back: !!str, !!int, !!float, !!bool, !!null, !!binary (with valid and invalid base64, whitespace inside, and how bytes dump back as !!binary + base64 wrapping/indentation), !!timestamp, !!seq, !!map, !!set, !!pairs, !!omap, !!python/... (should be rejected — report class/message), an unknown tag like !foo, a shorthand with a handle '!!' vs '!' vs '%TAG' directives, verbatim tags '!<tag:yaml.org,2002:str>', tags applied to the wrong node kind (e.g. '!!int [1]', '!!str [1]', '!!map 5'), '!!int "0x1f"', '!!float "1"', '!!bool "yes"', '!!null ""'.
Anchors/aliases: '&a x' then reuse; anchored collections referenced twice — CHECK whether dump emits &id001/*id001 and the exact naming/ordering; recursive structures ('&a [*a]' or '&a {self: *a}') — does dump succeed and what does it look like?; alias to an undefined anchor -> error; duplicate anchor names; anchor + tag together in either order; alias as a mapping key; the SAME object appearing twice without an anchor in the source (does dump add an anchor? e.g. '[&x abc, *x]' with a string).
Report exact bytes and exit codes/error messages.`,
  },
  {
    key: 'cli-argparse-semantics',
    prompt: `The argparse command-line contract, exactly. Probe /workspace/dataset/test16_executable (NOT the .py).
Determine: exact usage string and help text (--help, -h) and their exit codes; missing --a -> exact stderr text and exit code; unknown option '--b x'; '--a' with no value; '--a=value' form; '--a=' (empty); repeated '--a x --a y' (last wins?); '--a -5' and '--a --b' (values that look like options: which are accepted, which error, and the exact message — note argparse's special handling of negative-number-looking values and values starting with '-');
prefix abbreviation (is '--' alone accepted? does a bare '--' separator work: '-- --a x' vs '--a -- x'); extra positional args ('x'); '--A' (case sensitivity); duplicated '--' handling; empty argv.
Also: is anything written to stdout vs stderr in each case? Use \`2>/dev/null\` and \`1>/dev/null\` to separate streams, and report exit codes.
Finally, probe what happens on a YAML parse error (e.g. --a '{a: ') and on a construction error: which stream, what exit code, and the shape of the message (the traceback goes to stderr; note the last line and the error class).`,
  },
  {
    key: 'dump-numeric-and-special-repr',
    prompt: `Exact textual repr of NON-string leaf values on dump (Python repr semantics matter here).
Probe floats: 1.0, -1.0, 0.0, -0.0, 1.5, 0.1, 1e300, 1e-300, 1.0e+20, 12345678901234567890.0, 1/3-ish values (0.3333333333333333), .inf, -.inf, .nan, 6.02e23, 1e0, 100.0, 1e16, 1e17, 123456789.123456789, 5e-324, 1.7976931348623157e308, sexagesimal floats like 190:20:30.15 — report EXACTLY how each is emitted (PyYAML uses Python repr then a fixup; look for the '.0' suffix, exponent form like '1.0e+300', and the .inf/.nan spellings).
Probe ints: 0, -0, +7, huge (10**30), octal/hex inputs (do they dump as decimal?), sexagesimal ints (1:20 -> 80?), underscored ints.
Probe bools/null: how True/False/None emit. Probe timestamps: date-only vs datetime, with/without microseconds, with timezone offsets (is the value converted to UTC? is the offset dropped? what exact format is emitted, e.g. '2001-12-14 21:59:43.100000+00:00' vs a normalized form?), datetime at midnight, year < 1000, and a date used as a mapping key.
Probe !!binary bytes values: short and long (>60 bytes) to see base64 line wrapping and indentation.
Report exact bytes with cat -A.`,
  },
]

phase('Probe')
const probes = await parallel(AREAS.map((a) => () =>
  agent(PREAMBLE + a.prompt, { label: `probe:${a.key}`, phase: 'Probe', schema: SCHEMA, effort: 'high' })
))

const good = probes.filter(Boolean)
log(`collected ${good.length}/${AREAS.length} area specs`)

phase('Gaps')
const digest = good.map((p) => `## ${p.category}\nRULES:\n- ${p.rules.join('\n- ')}\nSURPRISES:\n- ${(p.surprises || []).join('\n- ')}`).join('\n\n')

const critics = await parallel([
  () => agent(PREAMBLE + `You are a COMPLETENESS CRITIC. Other agents already probed these areas and derived these rules:\n\n${digest}\n\nYour job: find what is MISSING or UNDERSPECIFIED for a byte-exact reimplementation. Focus on interactions BETWEEN areas that no single prober would have covered (e.g. a wrapped double-quoted string that also contains escapes and sits 3 levels deep; an anchored value that also needs quoting; a block scalar inside a flow-ish context; keys needing quoting AND sorting; a string that would fold at a position where the next char is a space). Probe those interactions on the executable now, and report the gaps you closed as rules + cases.`, { label: 'critic:interactions', phase: 'Gaps', schema: SCHEMA, effort: 'high' }),
  () => agent(PREAMBLE + `You are an ADVERSARIAL FUZZ PROBER. Other agents derived these rules:\n\n${digest}\n\nYour job: try hard to FALSIFY them. Construct inputs where a naive implementation following these rules literally would produce the wrong bytes. Include pathological inputs: pure whitespace, only a comment, control characters, mixed line endings, extremely deep nesting, very long single tokens, strings that are exactly at fold boundaries, values that resolve differently in flow vs block context, duplicate/self-referential anchors, and anything you suspect the rules got wrong. Report every rule you falsified (state the wrong rule and the corrected rule) plus the evidence cases.`, { label: 'critic:falsify', phase: 'Gaps', schema: SCHEMA, effort: 'high' }),
  () => agent(PREAMBLE + `You are probing ROUND-TRIP STABILITY and IDEMPOTENCE, which reveals internal invariants. For ~40 diverse inputs, take the executable's stdout, feed it back in as --a (careful with quoting; write it to a shell variable), and compare output 2 to output 1. Report every input where output is NOT stable under a second pass, with both outputs — each instability reveals an asymmetry between the loader and dumper that an implementer must replicate exactly. Also test dumping values that contain characters the dumper must escape and the loader must un-escape symmetrically.`, { label: 'critic:roundtrip', phase: 'Gaps', schema: SCHEMA, effort: 'high' }),
])

return { areas: good, gaps: critics.filter(Boolean) }
