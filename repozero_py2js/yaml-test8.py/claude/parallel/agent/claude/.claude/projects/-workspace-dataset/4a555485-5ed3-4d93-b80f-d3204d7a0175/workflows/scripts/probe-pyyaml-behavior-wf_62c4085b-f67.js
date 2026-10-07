export const meta = {
  name: 'probe-pyyaml-behavior',
  description: 'Exhaustively probe the test8_executable (PyYAML safe_load+dump) behavior across 9 domains',
  phases: [
    { title: 'Probe', detail: '9 parallel domain probes against the executable' },
  ],
}

const COMMON = `
You are probing a pre-compiled Python executable to reverse-engineer its exact behavior.

The executable is: /workspace/dataset/test8_executable
It runs this Python program:

    import yaml, argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    args = parser.parse_args()
    result = yaml.dump(yaml.safe_load(args.a), allow_unicode=True)
    print(result)

HOW TO RUN IT (bash). Always capture stdout and stderr SEPARATELY and the exit code.
Recommended helper you should create and use:

    mkdir -p /tmp/probe
    cat > /tmp/probe/r.sh <<'EOF'
    #!/bin/bash
    out=$(/workspace/dataset/test8_executable --a "$1" 2>/tmp/probe/err.txt); rc=$?
    printf 'RC=%s\\n--STDOUT--\\n%s\\n--STDERR--\\n' "$rc" "$out"; cat /tmp/probe/err.txt
    printf -- '--END--\\n'
    EOF
    chmod +x /tmp/probe/r.sh

Notes:
- For multi-line YAML input use bash $'line1\\nline2' quoting, or write the input to a file and use "$(cat f)".
- If a value starts with '-', argparse rejects it as an option; use the '--a=VALUE' form instead: /workspace/dataset/test8_executable --a='-.inf'
- To see exact bytes/whitespace of output, pipe through 'od -c' or 'cat -A' when whitespace matters.
- Run MANY cases (at least 60-120 distinct inputs for your domain). Batch them in loops so you use few tool calls.
- Save your full raw transcript to /tmp/probe/DOMAIN.txt (replace DOMAIN with your domain slug) so it can be grepped later.

YOUR OUTPUT: a dense, factual behavioral spec for your domain. Format as compact lines of
  input  =>  exit code + exact stdout (use \\n for newlines, and mark trailing newlines/spaces explicitly)
plus a short "RULES INFERRED" section stating the precise rule (thresholds, formats, orderings).
Do NOT include shell boilerplate, do NOT narrate what you tried. Only findings. Be exhaustive but terse.
Where output has trailing '...' lines or blank lines, report them EXACTLY.
`

const DOMAINS = [
  {
    key: 'errors',
    prompt: `${COMMON}
YOUR DOMAIN: error handling and Python tracebacks.
Probe malformed/invalid YAML inputs of every kind and record the EXACT stderr text (full traceback, character for character, including indentation, the caret '^^^^' marker lines, file/line numbers, the final '[PYI-...]' line) and the exit code.
Cover at least:
- unclosed flow: '[1,2', '{a: 1', "'unterminated", '"unterminated'
- bad indentation: 'a: 1\\n b: 2', 'a:\\n- 1\\n  - 2'
- tab characters used for indentation
- multiple documents: 'a: 1\\n---\\nb: 2'
- unknown tags: '!!foo bar', '!foo bar', '!!python/object:x {}', '!!python/tuple [1,2]', '!!int abc', '!!bool maybe', '!!float xyz', '!!timestamp notatime', '!!binary ###', '!!set [a]', '!!map [1]', '!!seq {a: 1}'
- unhashable keys: '? [a,b]\\n: c', '{[1]: 2}', '{{a: 1}: 2}'
- undefined alias: '*x', 'a: *undef'
- recursive/self-referential: '&a [*a]', '&a {x: *a}'  (note what dump does with these)
- reserved/invalid directives: '%YAML 1.3\\n---\\na', '%FOO\\n---\\na', '%YAML 1.1\\n---\\na'
- '@' and backtick as first char of a plain scalar
- bad escapes in double quotes: '"\\\\q"', '"\\\\u12"'
- block scalar bad indicators: 'a: |4x'
- control characters in the input (e.g. printf '\\x01')
- extremely deep nesting (e.g. 200 nested '[' ) -> is there a RecursionError?
- key too long (>1024 chars simple key)
Report the exact traceback for each distinct error CLASS (deduplicate identical shapes, but give at least one full verbatim example per class, and note exactly which parts vary).`,
  },
  {
    key: 'resolver',
    prompt: `${COMMON}
YOUR DOMAIN: implicit scalar type resolution (YAML 1.1 resolver) and round-trip formatting of each type.
For a plain scalar S, test with input 'k: S' AND bare 'S' and report what comes back.
Cover exhaustively:
- null: '', '~', 'null', 'Null', 'NULL', 'nUll', '~~'
- bool: true/True/TRUE/tRue, false variants, yes/Yes/YES, no/No/NO, on/On/ON, off/Off/OFF, y, Y, n, N, t, f
- int: 0, -0, +0, 007, 08, 0b101, 0B101, 0o17, 0x1f, 0X1F, 0xg, 1_0, 1_000_000, '1:2', '1:2:3', '-1:30', '60:00', '1:60', 12345678901234567890123, '+_1', '_1', '1_'
- float: 1.0, 1., .5, -.5, +.5, 1.5e3, 1.5e+3, 1.5e-3, 1e3, 1.0E5, .inf, +.inf, -.inf, .Inf, .INF, .nan, .NaN, .NAN, inf, nan, '1:30.5', '0.0', '-0.0', '1e400', '1.7976931348623157e+309', '0.1', 0.30000000000000004, 1e15, 1e16, 1e17, 1e-5, 1e-4, 123456789012345678.0, 1.0e-10, 2.5e-15, 1234567890.12345
- timestamp: '2024-01-15', '2024-1-5', '20240115', '2024-01-15T14:30:00', with Z / +05:30 / +5 / -05:00, with .1 / .123 / .1234567 fractional seconds, '2024-01-15 14:30:00', '2024-01-15t14:30:00', tab separator, invalid dates like '2024-02-30', '2024-13-01'
- special: '<<', '=', 'a<<b'
- strings that LOOK typed: 'True ', ' True', 'true#c'
Report the exact reprinted output for each (this reveals both the resolved type and the dump formatting, e.g. float repr rules and datetime str format). State the numeric formatting rules you infer (when does dump use exponent notation, how many digits, '.0' suffix rules).`,
  },
  {
    key: 'quoting',
    prompt: `${COMMON}
YOUR DOMAIN: how the emitter chooses a scalar STYLE and escapes characters (allow_unicode=True is set).
Use inputs of the form  k: "<double quoted escapes>"  to inject arbitrary characters into the loaded string, then observe how dump re-emits it.
Determine exactly when the output is: plain, 'single quoted', "double quoted", or a block scalar.
Cover:
- strings that would be re-resolved as another type: '123', 'true', 'null', '~', '2024-01-15', '.inf', '1:2', '', 'yes'
- leading/trailing spaces, leading '#', ' #', 'a #b', leading indicators: - ? : , [ ] { } # & * ! | > ' " % @ backtick and combinations like '- a', '-a', '? a', ': a', 'a: b', 'a:b', 'a: ', '-', '?', ':'
- embedded newlines: 'a\\nb', 'a\\n\\nb', '\\na', 'a\\n', 'a\\n\\n', multiple lines
- tabs: '\\t', 'a\\tb', ' \\t '
- control chars \\x00 \\x01 \\x07 \\x08 \\x0b \\x0c \\x0d \\x1b \\x7f \\x85 \\xa0 \\u2028 \\u2029 \\ufeff
- unicode: accents, CJK, emoji, combining marks
- backslashes, quotes: apostrophes, double quotes, both, 'a\\\\b'
- very long strings with and without spaces (test folding/wrapping at what column?)
- strings ending with ':' or ' ' or containing ': ' or ' #'
Report the exact output for each input, and a precise RULES section: the escape table (which chars become \\0 \\a \\b \\t \\n \\v \\f \\r \\e \\" \\\\ \\N \\_ \\L \\P \\xXX \\uXXXX \\UXXXXXXXX), and the style-selection decision rules.`,
  },
  {
    key: 'folding',
    prompt: `${COMMON}
YOUR DOMAIN: line wrapping / folding by the emitter (best_width default is 80).
Determine the EXACT column at which the emitter breaks lines, for every scalar style and at several indentation depths.
Method: build strings of controlled shape, e.g. 'k: ' + 'a '*N, or nested mappings 'a:\\n  b:\\n    c: <long text>', and long single-quoted / double-quoted content (force those styles by including characters that require them, e.g. a leading '#' forces quotes; a tab forces double quotes).
Cover:
- plain scalars with spaces at indent 0, 2, 4, 6, 10; determine break column and the continuation indent
- one very long word (no spaces) -> no break?
- words exactly straddling the boundary (sweep lengths, e.g. for n in 60..100)
- single-quoted long text; how are line breaks inserted, and how are literal newlines and doubled quotes handled when folded
- double-quoted long text; note the trailing backslash continuation marker behavior, that a break must not split an escape sequence; also what happens with a long run of non-space characters in a double-quoted string
- long keys (does the emitter wrap keys? when does it emit '? ' explicit key form -- try keys longer than 128 characters)
- long sequence items at several depths
- strings with a space at the fold point and with multiple consecutive spaces
- text where a fold point would land on a leading space of a line (must be avoided)
Report a sweep table (input length -> exact output with \\n markers) and precise RULES: the width threshold comparison, continuation indent computation, and the conditions that suppress a break.`,
  },
  {
    key: 'structure',
    prompt: `${COMMON}
YOUR DOMAIN: collection emission - indentation, nesting, empty collections, anchors/aliases, key sorting.
Cover:
- nested mappings and sequences to depth 5; note indentation of nested sequences under mapping keys (does a sequence under a key get indented?)
- sequences of mappings, mappings of sequences, sequence of sequences '- - 1'
- empty collections: '{}', '[]', 'a: {}', 'a: []', 'a: {b: {}}', '- []'
- KEY SORTING: 'b: 1\\na: 2', numeric keys '2: a\\n10: b\\n1: c', mixed types 'z: 1\\n10: x\\ntrue: y\\nnull: q', bool keys, float keys, unicode keys, case ordering 'B: 1\\na: 2', keys 'a10' vs 'a9', empty-string key, int vs float keys 1 vs 1.0, True vs 1
- anchors/aliases on INPUT that create shared objects: does dump emit '&id001' / '*id001'? Try 'x: &a [1,2]\\ny: *a' and 'x: &a {p: 1}\\ny: *a' and shared scalars 'x: &a hello\\ny: *a' and shared empty containers, and three references
- recursive: '&a [1, *a]' and nested recursive maps -> what does dump output (or error)?
- merge keys: 'a: &x {p: 1}\\nb: {<<: *x, q: 2}', '<<' at top level, merge with a list of maps
- duplicate keys: 'a: 1\\na: 2'
- '=' value key
- very wide mapping (50 keys) and deep nesting (30 levels)
- flow input styles always become block output? confirm with '[[1,2],[3]]', '{a: [1, {b: 2}]}'
- non-string keys of every type incl. timestamps, binary, set, nested
Report exact outputs and the RULES for indentation, sorting (including the fallback when keys are not mutually comparable), and anchor naming/numbering.`,
  },
  {
    key: 'tags',
    prompt: `${COMMON}
YOUR DOMAIN: explicit tags accepted by safe_load, and how the resulting values are re-emitted by yaml.dump (which uses the FULL Dumper, not SafeDumper).
Cover every YAML 1.1 standard tag and note both successes and errors:
- !!str, !!int, !!float, !!bool, !!null, !!timestamp, !!binary, !!seq, !!map, !!set, !!omap, !!pairs, !!merge, !!value
- valid and invalid payloads for each (e.g. '!!int 0x1f', '!!int 1_0', '!!int 1:2', '!!float 1', '!!float 1:30', '!!bool yes', '!!bool YES', '!!bool y', '!!null x', '!!timestamp 2024-01-15', '!!str null')
- !!binary with valid base64 (short and long, >64 chars so the block scalar wraps; also binary that is valid UTF-8 text vs raw bytes), with whitespace/newlines inside, with invalid chars, empty
- !!set with a map / with a seq / with duplicate members / empty; how is a set re-emitted (tag? ordering? sorted?)
- !!omap / !!pairs: exact re-emission (it produces python tuples - report the exact output shape and indentation)
- !!map on a scalar/seq, !!seq on a map/scalar -> error text
- tags in flow context, tags on keys, tags on collection entries, tag on document root with '--- !!str x'
- '!' plain (non-specific tag) on scalar/seq/map, unknown '!!'-prefixed, verbatim tags '!<tag:yaml.org,2002:str> x', local '!foo', and '%TAG' directives
- nested/short forms: '!!seq [ !!int 1, !!str 2 ]'
Report exact outputs (including where a tag survives into the output like '!!set' or '!!binary' or '!!python/tuple') and the exact error text where it fails.`,
  },
  {
    key: 'argparse',
    prompt: `${COMMON}
YOUR DOMAIN: command-line argument parsing (Python argparse) behavior. Ignore YAML here.
Determine EXACT stdout/stderr/exit code for:
- no arguments at all
- --help, -h, --hel, --he, --h (prefix abbreviation!), -a, -x, --b
- --a with no value; --a= (empty value); --a=x; --a x; --a=--b; --a -1; --a=-1; --a='-.inf'
- two --a options: '--a 1 --a 2'
- extra positional args: '--a 1 extra'; 'extra --a 1'
- '--' separator: '--a 1 -- extra', '-- --a 1'
- '--a' with a value that looks like an option: '--a --help'
- unicode and empty-string values
- repeated '--'
Report the EXACT usage/help text and error messages verbatim (they will be compared character-for-character), including the program name shown, line wrapping of the help text, whether output goes to stdout or stderr, and the exit codes.
Also run: 'COLUMNS=40 /workspace/dataset/test8_executable --help' and 'COLUMNS=200 /workspace/dataset/test8_executable --help' to see whether help wrapping depends on terminal width, and report both.`,
  },
  {
    key: 'loader',
    prompt: `${COMMON}
YOUR DOMAIN: scanner/parser level input handling (well-formed but tricky inputs).
Cover:
- comments: leading, trailing, inline, comment-only input, '#' inside quotes, 'a: 1 # c', 'a: #c\\n  b: 1'
- document markers: '---', '--- a', '---\\na: 1', 'a: 1\\n...', '--- a\\n...', '...' alone, trailing '---'
- directives: '%YAML 1.1\\n---\\na: 1', '%TAG ! tag:x,2024:\\n---\\n!foo bar'
- block scalars: literal '|', '|-', '|+', '|2', '|-2', '|2-', folded '>', '>-', '>+', with blank lines, with trailing newlines, with more-indented lines, with tabs inside, empty block scalar, block scalar at various indents. Report how each is RE-EMITTED (dump normally converts to quoted/plain).
- multi-line plain scalars: 'a: b\\n  c', folding rules, plain scalar containing ': ' on a later line
- multi-line quoted scalars, including escaped line breaks in double quotes and leading/trailing space handling across folds
- line endings: CRLF input, lone CR, \\x85 (NEL), \\u2028, \\u2029 as line breaks
- BOM at start, BOM in the middle
- tabs where allowed (inside scalars, after ':') vs not (indentation)
- flow collections spanning lines, trailing commas '[1,2,]', '{a: 1,}', flow with empty entries '[,]', '{,}', 'a: {b: c: d}'
- indentation oddities: 'a:\\n   b: 1' (3 spaces), sequences at same indent as key, '- - - 1'
- empty values: 'a:', 'a:\\nb:', '-', '- \\n- 1', 'a: \\n'
- keys with no value in flow: '{a}', '{a, b: 1}'
- '? explicit key\\n: value', explicit key with empty value
- very long line, 10000-char scalar (does output wrap?)
Report exact outputs, and exact error text where it fails.`,
  },
  {
    key: 'unicode',
    prompt: `${COMMON}
YOUR DOMAIN: unicode / encoding behavior with allow_unicode=True, plus printable-character checks.
Cover:
- non-ASCII in keys and values: Latin-1 accents, CJK, Cyrillic, Greek, Hebrew/Arabic (RTL), Devanagari, emoji (BMP and astral/surrogate-pair), combining sequences, ZWJ sequences
- characters that PyYAML considers non-printable and must escape even with allow_unicode: \\x7f-\\x9f range (\\x85 NEL!), \\ufffe, \\uffff, \\ufdd0, non-characters, \\u2028/\\u2029 (line/paragraph separator), \\u00a0 NBSP in a plain scalar
- astral characters: does dump emit them raw or as \\U escapes? Test an emoji directly and via escapes
- lone surrogates via escapes -> error or output?
- does the width/folding logic count characters or bytes for wide CJK text? Test a long CJK string and report exactly where it breaks
- unicode in anchors/tags/keys
- unicode combined with quoting decisions (does a leading combining mark or NBSP force quotes?)
- the exact byte output for a few cases (pipe to 'od -c' or 'hexdump -C') to confirm UTF-8 and no escaping
Report exact outputs plus a precise list of which codepoint ranges are emitted literally vs escaped, and the escape form used.`,
  },
]

phase('Probe')
const reports = await parallel(DOMAINS.map(d => () =>
  agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe' })
    .then(r => `\n\n########## DOMAIN: ${d.key} ##########\n${r}`)
))

return reports.filter(Boolean).join('\n')
