export const meta = {
  name: 'yaml-behavior-probe',
  description: 'Exhaustively probe the PyYAML-based test15 executable to extract a precise behavioral spec for a JS port',
  phases: [
    { title: 'Probe', detail: 'parallel probes across scanner/parser/resolver/constructor/emitter/argparse dimensions' },
    { title: 'Verify', detail: 'adversarial re-probe of each claimed rule' },
  ],
}

const EXE = '/workspace/dataset/test15_executable'

const COMMON = `
You are reverse-engineering the behavior of a compiled Python program at ${EXE}.
Its source is exactly:

    import yaml, argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    args = parser.parse_args()
    result = yaml.dump(yaml.safe_load(args.a), default_style='>')
    print(result)

So: PyYAML SafeLoader for load, and yaml.Dumper (the FULL Dumper, not SafeDumper) for dump,
with default_style='>' and all other defaults (default_flow_style=False, sort_keys=True,
indent=2, width=80, allow_unicode=False, line_break='\\n', explicit_start/end False, version None).

Run it with:  ${EXE} --a "<input>"
Use bash heredocs / printf / files to feed inputs containing newlines, tabs, quotes, unicode safely.
A good pattern:
    printf '%s' 'YAML TEXT' > /tmp/x.txt; ${EXE} --a "$(cat /tmp/x.txt)" | cat -A
Beware: command substitution strips trailing newlines. To pass exact bytes including trailing
newlines, build the arg in a bash variable using $'...' quoting instead.
Always inspect output with 'cat -A' (or 'od -c') so trailing spaces / newlines are visible.
Note: the program's print() adds ONE extra newline beyond yaml.dump's own trailing newline.

Your job: run MANY probes (30+) in your assigned dimension and report precise, mechanical rules
that a from-scratch JavaScript reimplementation must follow. Report concrete input->output pairs
as evidence. Be exhaustive about edge cases. Do NOT write any implementation code.
Return your findings as detailed prose + evidence table.
`

phase('Probe')

const DIMENSIONS = [
  {
    key: 'resolver-scalars',
    prompt: `${COMMON}

DIMENSION: The implicit tag RESOLVER for plain scalars (YAML 1.1 rules as PyYAML implements them),
and how loaded Python values are re-tagged on dump.

Probe exhaustively which plain scalars resolve to null/bool/int/float/timestamp/merge/value/str:
- null: '~', 'null', 'Null', 'NULL', '', 'none', 'NULL '
- bool: yes/Yes/YES/no/No/NO/true/True/TRUE/false/False/FALSE/on/On/ON/off/Off/OFF, y/n/Y/N
- int: decimal, '+5', '-5', leading zeros '007', underscores '1_0_0', octal '0o17' vs '017',
  hex '0x1F' '0X1f' '0xg', binary '0b101', sexagesimal '1:30' '190:20:30' '-1:30', '+0b1'
- float: '1.0','.5','5.','1.e3','1e3','1.0e3','.inf','.Inf','.INF','-.inf','+.inf','.nan','.NaN','.NAN',
  '685_230.15', sexagesimal float '190:20:30.15', '1.0E+3', '-0.0', '0.0'
- timestamp: 'yyyy-mm-dd', full datetimes with T/t, space separator, fractional seconds, timezone
  offsets (+/-HH:MM, +HH, Z), and how they are re-emitted (exact string form!)
- what does an int that came from '0x1F' or '017' or '1:30' look like when re-dumped?
- how are floats re-emitted? repr rules: 1.0 -> '1.0', 0.1, 1e300, 1e-300, very long floats,
  -0.0, 1e16, 1e17, 100000000000000000000.0, 1.5e-8, integer-valued floats.
  Test many float values and record the EXACT emitted text.
- how are inf/-inf/nan emitted?
- big integers beyond 2^53 and beyond 2^64 (Python has arbitrary precision!) e.g.
  '123456789012345678901234567890' -> is it int? how emitted?
- Does an emitted value get a '!!type' tag prefix or not? Explain the rule
  (hint: the emitter omits the tag when the RESOLVER would infer the same tag from the plain
  form of the value; but with default_style='>' the scalar is NOT plain, so tags appear for
  non-str types. Verify precisely which types get tags and which don't.)
- Test strings that LOOK like other types, e.g. the string 'true' loaded from '"true"'.
`,
  },
  {
    key: 'emitter-scalar-style',
    prompt: `${COMMON}

DIMENSION: The EMITTER's scalar style choice and exact serialization with default_style='>'.

Determine precisely, with evidence, when the emitter uses folded '>' vs double-quoted '"' vs
other styles. Key hypotheses to verify:
- Mapping KEYS (simple key context) are always double-quoted, never folded. Verify.
- Scalars inside FLOW collections would be double-quoted -- but is flow style ever produced?
  (default_flow_style=False). Test empty dict {} and empty list [] and nested empties.
- A scalar whose analysis forbids block style (allow_block == False) falls back to double-quoted.
  Find exactly which characters/shapes force that: leading space, trailing space, tabs, control
  chars, non-ASCII (allow_unicode=False), leading/trailing whitespace on any line, empty string,
  strings that are only whitespace, strings with '\\r', '\\x85', '\\u2028', '\\u2029',
  DEL \\x7f, \\x80-\\x9f, characters needing escapes.
- Block hints: the indentation indicator digit (e.g. '>2-') and chomping ('', '-', '+').
  Derive the exact rule from many examples: text starting with space or newline; text ending
  with newline; text ending with two newlines; single-character text '\\n'.
- Line folding/wrapping: width. Find the exact break rule by testing strings of increasing
  length at various indentation levels. Determine whether the break happens when column > 80
  and the next char is a space, etc. Test long runs with no spaces (unbreakable), multiple
  consecutive spaces, spaces at fold points, leading spaces on continuation lines.
- How are embedded newlines rendered in folded style (blank line separators)? Test
  '\\n', '\\n\\n', '\\n\\n\\n', 'a\\n\\nb', 'a\\n \\nb'.
- Double-quoted escaping rules: which chars are escaped and in what form
  (\\0 \\a \\b \\t \\n \\v \\f \\r \\e \\" \\\\ \\N \\_ \\L \\P \\xXX \\uXXXX \\UXXXXXXXX).
  Also: does double-quoted output get line-wrapped at width 80? Test a long single-word
  double-quoted string and a long double-quoted string with spaces. Report the exact
  split behaviour including the '\\' continuation escapes for splits inside/next to spaces.
`,
  },
  {
    key: 'emitter-collections',
    prompt: `${COMMON}

DIMENSION: EMITTER layout for collections, anchors/aliases, tags, and document markers.

Probe and report exact rules for:
- Block mapping / block sequence indentation (indent=2). Nested sequences inside sequences,
  sequences inside mappings (are sequence items indented under the key? evidence shows NOT).
  Mappings inside sequences ('- "a": ...'). Deep nesting 5+ levels. Sequences in sequences in
  sequences. Sequence item that is an empty dict/list.
- A collection with a TAG (e.g. !!set, !!python/tuple) - where does the tag go relative to the
  block collection, and how does indentation change? Test !!set at top level, nested as a value,
  and nested as a sequence item. Test tuples via '!!python/tuple'-producing inputs
  (!!omap / !!pairs load to lists of tuples under SafeLoader).
- Key ORDER: sort_keys=True. What happens with mixed-type keys (int and str keys)? Does it raise?
  Test {1: a, 'b': c} and {true: x, 1: y} etc. Report exact behaviour including any traceback.
- Non-string keys: int keys, float keys, bool keys, null key, tuple keys (from !!python/tuple),
  a mapping/sequence used as a key (complex key '? [1,2]\\n: v'). How are complex keys emitted
  ('?' indicator)? What is the max simple-key length rule (128 chars)?
- Anchors/aliases: naming scheme (id001, id002, ...), assignment order, when an anchor is
  emitted, self-referencing structures, the same scalar object repeated (are equal strings
  aliased? test 'a: &x hello\\nb: *x' and 'a: hello\\nb: hello'), repeated empty dicts.
- Document markers: when is '...' (document end) emitted? Evidence shows it appears after a
  block scalar with '+' chomping. Also test explicit '---' in input, multiple documents
  (should error), and directives.
- The exact trailing whitespace/newlines of the whole output (remember print adds one newline).
- Recursion depth: very deeply nested structures.
`,
  },
  {
    key: 'loader-scanner',
    prompt: `${COMMON}

DIMENSION: The LOADER (scanner/parser/composer/constructor) - what inputs parse and how.

Probe:
- Flow collections: [1,2], {a: b}, nested, trailing commas, flow in block, block in flow (error).
- Quoted scalars: single-quoted with '' escape, double-quoted with all escapes
  (\\0 \\a \\b \\t \\n \\v \\f \\r \\e \\  \\" \\/ \\\\ \\N \\_ \\L \\P \\x41 \\u0041 \\U00000041),
  multi-line quoted scalars and their folding rules, escaped line-break continuation
  (backslash at end of line inside double quotes).
- Block scalars: '|', '>', '|-', '|+', '>-', '>+', '|2', '>2', '|-2', with various indentation,
  leading empty lines, more-indented lines inside folded scalars, trailing blank lines.
- Plain multi-line scalars in block and flow context and their folding.
- Comments: '#' handling in all contexts.
- Anchors & aliases on load, merge keys '<<' (single map, list of maps, precedence order),
  duplicate keys behaviour.
- Explicit tags: !!str !!int !!float !!bool !!null !!binary !!timestamp !!seq !!map !!set
  !!omap !!pairs; unknown tags like '!foo' or '!!python/object' under SafeLoader (should error);
  the '!' non-specific tag; verbatim tags '!<tag:yaml.org,2002:str>'.
- Directives: '%YAML 1.1', '%YAML 1.2', '%TAG'.
- Documents: empty input '' (-> None), only comments, only '---', '--- ' , 'a\\n---\\nb'
  (multiple documents -> ComposerError). Report the exact error text on stderr and exit code.
- Indentation errors, tab characters in indentation, and other ScannerError cases:
  report the EXACT stderr text and exit code for at least 6 distinct error classes
  (ScannerError, ParserError, ComposerError, ConstructorError) including the
  'in "<unicode string>", line N, column M:' context lines and the caret line.
`,
  },
  {
    key: 'argparse',
    prompt: `${COMMON}

DIMENSION: argparse behavior for 'parser.add_argument("--a", type=str, required=True)'.

Determine and report EXACTLY (byte for byte, including stdout vs stderr and exit codes):
- The usage line and the full --help output.
- Missing required arg; unknown option; unrecognized positional; '--a' with no value.
- '--a=value' form, '--a value' form, repeated '--a', '--a' with a value starting with '-'
  (e.g. -5, -.inf, --foo, -x), and whether '--a=-5' works where '--a -5' does not.
- Abbreviation: does '--' + prefix work? There is only one option '--a', so test '--a' only,
  plus '-a', '--aa', '--A'.
- The '--' separator: 'test15_executable --a -- -5' and 'test15_executable -- --a 5'.
- Empty string value.
- Whether the program name in usage/errors is 'test15_executable' (basename of argv[0]).
  A JS port will be run as 'node test15.mjs' - report what Python prints so the port can
  hardcode the right prog name.
- Exit codes for each error case (expect 2) and which stream the messages go to.
Report the exact literal text with all spacing, using 'cat -A' to reveal it.
`,
  },
  {
    key: 'float-int-repr',
    prompt: `${COMMON}

DIMENSION: Numeric REPRESENTATION on output (Python repr semantics) - critical for a JS port.

PyYAML's representer for float does:
    value = repr(data).lower()  (with special handling for inf/nan)
    if '.' not in value and 'e' in value:  value = value.replace('e', '.0e', 1)
and for int:  str(data).

Empirically determine, with MANY probes, the exact emitted text for floats. Test at minimum:
0.0, -0.0, 1.0, -1.0, 0.5, 1.5, 3.14, 0.1, 0.2, 0.3, 1/3-like values, 1e3, 1e15, 1e16, 1e17,
1e21, 1e22, 1.5e-5, 1e-5, 1e-6, 1e-7, 1e300, 1e-300, 5e-324, 1.7976931348623157e308,
123456789.123456789, 2.675, 1234567890123456789.0, 0.000001, 0.0000001, 100.0, 1e100.
Feed them as YAML floats (e.g. --a 'x: 1.0e+16') and record the EXACT output text.
Pay special attention to: when does Python use exponent notation vs fixed, how many digits,
does it print '1e+16' or '1.0e+16', lowercase 'e', the sign of the exponent, and the number of
exponent digits (2 vs 3). Compare against what JavaScript's Number->String would produce and
call out every case where they DIFFER, since the port must implement Python's repr.

Also test integers: very large ints (Python bignum) e.g. 2**64, 2**100, -2**100, and ints
written with underscores/hex/octal/binary/sexagesimal - report the exact decimal output.

Also test the timestamp type: how does Python's datetime/date str() render for many cases
(with and without microseconds, with tzinfo offsets, negative offsets, offsets with minutes)?
Record exact output strings.
`,
  },
]

const findings = await parallel(DIMENSIONS.map(d => () =>
  agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe' })
    .then(text => ({ key: d.key, text }))
))

phase('Verify')

const verified = await parallel(findings.filter(Boolean).map(f => () =>
  agent(`${COMMON}

You are an ADVERSARIAL VERIFIER. Another agent probed the dimension "${f.key}" and produced the
report below. Your job: try to REFUTE it. Run your own independent probes against ${EXE} to
check each concrete rule. Focus on rules stated without evidence, rules that sound like
guesses, and boundary cases the report skipped.

Return: (1) a corrected, consolidated, evidence-backed rule list for this dimension, keeping
everything that survived and fixing/removing what did not; (2) an explicit "CORRECTIONS" section
naming what the original report got wrong. Be concrete and mechanical - the output feeds a
from-scratch JavaScript reimplementation.

--- REPORT UNDER TEST (${f.key}) ---
${f.text}
`, { label: `verify:${f.key}`, phase: 'Verify' })
    .then(text => ({ key: f.key, text }))
))

return verified.filter(Boolean)
