export const meta = {
  name: 'gomplate-formats',
  description: 'Implement YAML, TOML, CUE, jq and JSONPath libraries from scratch (stdlib only), verified against the binary',
  phases: [
    { title: 'Implement', detail: 'one agent per library' },
    { title: 'Harden', detail: 'adversarial differential testing per library' },
  ],
}

const RULES = `
CONTEXT: /workspace is a Go module named "gomplate" (go 1.21). We are re-implementing the "gomplate" CLI from
scratch by observing the behaviour of the reference binary /workspace/executable.

HARD RULES (violating them fails the whole project):
- NO NETWORK. There is no internet access and no Go module proxy. You may use the Go STANDARD LIBRARY ONLY.
  Do not add any require directives to go.mod. Do not vendor anything.
- You MUST NOT search for, download, or read the original source of gomplate or of any third-party library
  (no yaml.v3, no BurntSushi/toml, no gojq, no cuelang, etc). Write everything yourself.
- You MUST NOT decompile/disassemble/objdump/strace/nm/strings the reference binary. Only run it with normal
  CLI arguments and observe stdout/stderr/exit status.
- Do not modify any files outside the directory you are assigned (plus adding your own tests). Other agents
  are working in parallel on other directories. NEVER touch /workspace/go.mod.

HOW TO OBSERVE THE REFERENCE: run from /workspace, e.g.
  ./executable -i '{{ (data.YAML "a: 1") | data.ToJSON }}'
  ./executable -i '{{ printf "%T" (data.YAML "a: 1") }}'
Errors go to stderr as JSON with an "err" field and exit status 1.

QUALITY BAR: idiomatic, well-organised Go. Doc comments on exported identifiers. Comments should explain
non-obvious *why*, not restate the code. No dead code, no TODOs, no panics on bad input (return errors).
Write a Go test file for your package with table-driven tests covering everything you verified against the
reference binary. Your package MUST compile and its tests MUST pass:
   cd /workspace && go test ./<your package dir>/
(Other packages in the repo may not compile yet — that is expected; only build/test your own.)
Iterate until your tests pass. Report honestly what is and is not implemented.
`

phase('Implement')

const LIBS = [
  {
    dir: 'internal/yaml',
    label: 'yaml',
    brief: `Write a YAML 1.1/1.2 parser and emitter in package "yaml" at /workspace/internal/yaml/.

REQUIRED PUBLIC API (other packages are already written against it — match it exactly):
    func Unmarshal(data []byte, out any) error        // out is *any, *map[string]any, *[]any, or *map[string]string
    func UnmarshalAll(data []byte) ([]any, error)     // every document in a multi-document stream
    func Marshal(v any) ([]byte, error)               // 2-space indent, trailing newline
    func MarshalIndent(v any, indent int) ([]byte, error)
    func FormatScalar(s string) string                // encode s as a YAML scalar in BLOCK context
    func FormatFlowScalar(s string) string            // encode s as a YAML scalar inside [ ] flow context

PARSER must support: block and flow mappings/sequences, plain/single/double-quoted scalars (with all the
standard double-quote escapes \\n \\t \\" \\\\ \\uXXXX \\xNN), literal (|, |-, |+) and folded (>, >-, >+) block
scalars with explicit indentation indicators, comments, anchors (&a) and aliases (*a), merge keys (<<),
explicit tags (!!str !!int !!float !!bool !!null !!timestamp !!binary), documents separated by --- and
terminated by ..., empty values, nested indentation, and keys that are not strings.

SCALAR RESOLUTION is critical - determine it empirically from the reference binary. Probe things like:
  ./executable -i '{{ $v := data.YAML "a: VALUE" }}{{ printf "%T %#v" $v.a $v.a }}'
Test at minimum: true/True/TRUE/false, yes/no/on/off/y/n/Y/N, null/Null/NULL/~/(empty), 1/-1/+1,
0x1F/0o17/017/0b101, 1_000, 1.5/.5/1e3/1E-3/-.inf/.inf/.nan/.NaN, 2020-01-02, 2020-01-02T03:04:05Z,
2020-01-02 03:04:05, "12:30" and "1:2:3" (sexagesimal!), very large ints that overflow int64, and strings
like "0644". Record which Go type each becomes (int / float64 / bool / nil / string / time.Time) - use
printf "%T" through the reference binary. Mappings must decode to map[string]any and sequences to []any
(verify with %T against the reference; note that a mapping with non-string keys may need map[any]any -
check what the reference does with '{1: a}').

EMITTER must byte-match the reference's data.ToYAML. Derive the rules empirically with MANY probes, e.g.
  ./executable -i '{{ dict "k" "VALUE" | data.ToYAML }}'
covering: strings needing no quotes; strings needing single quotes ('-', '{{', ']]', 'x: y', ' lead',
'trail ', '#c', '*a', '&a', '!t', '|', '>', '%', '@', '\`', ',', '[', ']', '{', '}', '?', ':'); strings that
resolve to another type and so need quotes ("0644", "true", "null", "1", "1.5", "2020-01-02", "y", "n",
"yes", "off", "~", ""); strings containing newlines (literal block style?); strings with tabs or control
characters or invalid UTF-8; very long strings (does it line-wrap? test a 200-char string and a long
sentence with spaces - libyaml folds plain scalars at 80 columns, CHECK THIS CAREFULLY and reproduce it);
nested maps and slices; empty map and empty slice; nil; booleans; ints; int64; float64 (integral floats
like 1.0 - does it emit "1" or "1.0"?); NaN/Inf; time.Time. Also verify map keys are emitted in sorted
order, sequence indentation ("a:\\n  - 1"), and the trailing newline.

Also handle Marshal of a nested empty map/slice, and of map[string]string / []string / structs is NOT
needed beyond what data.ToYAML can receive (map[string]any, []any, scalars) - but be robust via reflection.`,
  },
  {
    dir: 'internal/toml',
    label: 'toml',
    brief: `Write a TOML v1.0 parser and emitter in package "toml" at /workspace/internal/toml/.

REQUIRED PUBLIC API:
    func Unmarshal(data []byte, out any) error   // out is *any / *map[string]any
    func Marshal(v any) ([]byte, error)          // trailing newline

PARSER: bare and quoted keys, dotted keys, basic strings (with escapes), literal strings, multi-line basic
and literal strings, integers (dec/hex/oct/bin, underscores, +/-), floats (incl. inf/nan/exponents),
booleans, offset date-times / local date-times / local dates / local times, arrays (heterogeneous, nested,
multi-line with trailing commas), inline tables, [table] and [[array of table]] headers, comments.
Determine the Go types the reference decodes to via
  ./executable -i '{{ $v := data.TOML "a = 1" }}{{ printf "%T" $v.a }}'
for ints, floats, bools, datetimes, local dates, arrays and tables.

EMITTER must byte-match the reference's data.ToTOML. Probe extensively, e.g.
  ./executable -i '{{ dict "b" 1 "a" (coll.Slice 1 2) "c" (dict "d" "x") | data.ToTOML }}'
Known behaviour to reproduce: simple keys come first, then a blank line, then [table] sections whose
contents are indented by two spaces; arrays are inline "a = [1, 2]". Determine and reproduce: key ordering,
string quoting/escaping, how nested tables ([c.d]) are named and indented, arrays of tables ([[x]]),
arrays of mixed types, empty arrays, empty tables, nil values (what happens?), floats (does 1.0 print as
"1.0"?), time values, and exactly where blank lines go. Test 3+ levels of nesting.`,
  },
  {
    dir: 'internal/jsonpath',
    label: 'jsonpath',
    brief: `Write a JSONPath evaluator in package "jsonpath" at /workspace/internal/jsonpath/.

REQUIRED PUBLIC API:
    func Get(path string, input any) (any, error)

This backs gomplate's coll.JSONPath / jsonpath function. Probe the reference to learn the exact supported
syntax and, crucially, WHEN A SINGLE MATCH IS UNWRAPPED versus returned as a slice:
  ./executable -i '{{ $d := data.JSON \`{"a":{"b":[1,2,3]}}\` }}{{ printf "%#v" (coll.JSONPath "$.a.b" $d) }}'
Cover: $ root, .key, ["key"], bracket with quotes, .., wildcard *, [n] index, negative index, [start:end],
[start:end:step], union [0,2], ['a','b'], filter expressions ?(@.x > 1) with ==, !=, <, <=, >, >=, =~ regex,
&&/||, existence ?(@.x), script expressions, and paths that match nothing (error? empty?). Record the exact
error strings the reference produces for unmatched paths and for malformed expressions, and reproduce them.
Read /workspace/docs/content/functions/coll.md for the documented examples.`,
  },
  {
    dir: 'internal/jq',
    label: 'jq',
    brief: `Write a jq language interpreter in package "jq" at /workspace/internal/jq/.

REQUIRED PUBLIC API:
    func Run(query string, input any) (any, error)

This backs gomplate's coll.JQ / jq function. Determine empirically how multiple results are returned
(single value unwrapped, multiple wrapped in a slice?) and what happens with zero results:
  ./executable -i '{{ printf "%#v" (jq ".a" (data.JSON \`{"a":1}\`)) }}'
  ./executable -i '{{ printf "%#v" (jq ".[]" (data.JSON \`[1,2]\`)) }}'
  ./executable -i '{{ printf "%#v" (jq ".[]" (data.JSON \`[]\`)) }}'

Implement a genuine tokenizer + recursive-descent parser + evaluator producing a STREAM of results per
filter (a generator model), because jq semantics depend on it. Support at least:
  identity . ; field .a .a.b .a? ; .["a"] ; optional ?; iterate .[] .a[] ; index .[0] .[-1] ; slice .[1:3]
  pipe | ; comma , ; parentheses ; recursive descent ..
  literals: numbers, strings with \\(...) interpolation, true false null, arrays [...], objects {a:1, "b":.x, $k, (expr):v, a}
  arithmetic + - * / % (incl. string+string, array+array, object+object merge, string*n, string/string=split)
  comparison == != < <= > >= and boolean and/or/not, alternative //
  if/then/elif/else/end ; try/catch ; error ; ?// not needed
  reduce EXPR as $x (init; update) ; foreach EXPR as $x (init; update; extract)
  variables: EXPR as $x | body ; $__loc__ ; def f: ...; and def f(a): ...; including recursion
  builtins: length, utf8bytelength, keys, keys_unsorted, values, has, in, contains, inside, map, map_values,
  path, paths, leaf_paths, getpath, setpath, delpaths, del, to_entries, from_entries, with_entries, select,
  empty, range (1,2,3 arg), floor, ceil, sqrt, pow, log, exp, fabs, round, tostring, tonumber, type, infinite,
  nan, isinfinite, isnan, isnormal, not, add, any, all (0,1,2 arg), flatten (0,1 arg), sort, sort_by, group_by,
  unique, unique_by, min, max, min_by, max_by, reverse, indices, index, rindex, startswith, endswith,
  ltrimstr, rtrimstr, explode, implode, split (1,2 arg), join, ascii_downcase, ascii_upcase, ascii,
  recurse (0,1,2 arg), env, $ENV, builtins, input_line_number, tojson, fromjson, tostream, fromstream,
  truncate_stream, limit, first, last, nth, until, repeat, while, error, halt, splits, sub, gsub, test, match,
  capture, scan, tojson, ascii, todate, fromdate, now, strftime, strptime, mktime, gmtime, localtime,
  @base64, @base64d, @text, @json, @csv, @tsv, @html, @uri, @sh, and getpath/setpath/paths.
Regex builtins use Go's regexp (RE2) - note flag support "g", "i", "x", "n", "s".

For anything the reference does NOT support, record the exact error text and make your implementation
produce the same error. Verify LOTS of expressions against the reference and encode them as tests.
Prioritise correctness of the common cases and of the generator semantics over exotic builtins.`,
  },
  {
    dir: 'internal/cuelang',
    label: 'cue',
    brief: `Write a CUE evaluator and emitter in package "cuelang" at /workspace/internal/cuelang/.

REQUIRED PUBLIC API:
    func Unmarshal(data []byte, out any) error   // evaluate a CUE file to a concrete Go value
    func Marshal(v any) ([]byte, error)          // the data.ToCUE serialiser

This backs gomplate's data.CUE / cue and data.ToCUE / toCUE functions.

EVALUATOR: probe the reference to find the supported subset, e.g.
  ./executable -i '{{ (data.CUE "a: 1\\nb: a+1") | data.ToJSON }}'
Cover: struct fields (a: 1), nested structs, lists, references between fields, arithmetic and string
concatenation on references, string interpolation "\\(a)", definitions (#Def), field constraints/types
(int, string, bool, number, bytes), disjunctions (a | b) and defaults (*x | y), optional fields (a?: int),
required (a!: int), unification of duplicate fields, comprehensions (for x in list {...}, if cond {...}),
let declarations, hidden fields (_x - are they in the output?), embedding, aliases, multi-line strings
(""" ... """), bytes ('...'), null, comments, top (_) and bottom (_|_), and error cases (incomplete values,
conflicting unification). Record EXACT error text for unsupported/incomplete input and reproduce it.

EMITTER (Marshal) must byte-match data.ToCUE. Known: it indents with TABS and emits
  {\\n\\ta: 1\\n\\tb: [1, "x"]\\n}\\n
Determine precisely: the trailing newline, whether the outer braces are always present, key quoting rules
(when does a key get quoted?), key ordering (sorted or insertion?), how nested maps, empty maps, empty
lists, nil, booleans, ints, floats (1.0?), long lists (do they wrap onto multiple lines? test a list of 20
numbers and a list of maps), and strings with quotes/newlines/unicode are emitted. Probe many shapes.`,
  },
]

const results = await pipeline(
  LIBS,
  lib => agent(RULES + '\n' + lib.brief +
    `\n\nWhen finished, reply with: the list of files you created, what is fully supported, what is partial or
unsupported (with the reference's error text where relevant), and the result of your final \`go test\` run.`,
    { label: `impl:${lib.label}`, phase: 'Implement' }),
  (_prev, lib) => agent(RULES +
    `\nYou are HARDENING the package at /workspace/${lib.dir} (written by another agent).\n` +
    `Read all the code and tests there first.\n\n` +
    `Your job: find and fix behavioural divergences from the reference binary. Do this by DIFFERENTIAL\n` +
    `TESTING - construct at least 60 new inputs that exercise areas the existing tests miss (edge cases,\n` +
    `weird whitespace, unicode, deep nesting, numeric extremes, malformed input, error paths), run each\n` +
    `through /workspace/executable to get the expected result, then check your package agrees. Write a\n` +
    `Go test that drives your package directly for each case.\n\n` +
    `Fix every divergence you find, and add the cases as permanent tests. Do not weaken existing tests.\n` +
    `Original brief for context:\n${lib.brief}\n\n` +
    `Finish with \`cd /workspace && go test ./${lib.dir}/\` passing. Reply with the divergences you found\n` +
    `and fixed, and anything still known-divergent.`,
    { label: `harden:${lib.label}`, phase: 'Harden' })
)

return { libs: results.filter(Boolean).length }
