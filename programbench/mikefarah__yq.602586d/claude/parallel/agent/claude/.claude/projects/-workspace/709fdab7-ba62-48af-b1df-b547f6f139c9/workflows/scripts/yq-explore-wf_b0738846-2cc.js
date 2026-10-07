export const meta = {
  name: 'yq-explore',
  description: 'Fan out subagents to behaviorally probe the reference yq binary and write implementable specs + test cases',
  phases: [
    { title: 'Explore', detail: 'one agent per feature area, writes notes/ + tests/cases/' },
  ],
}

const RULES = `
You are reverse-engineering a compiled binary at /workspace/executable (it is \`yq\` v4.52.5, a
YAML/JSON/XML processor). We are writing an original from-scratch reimplementation in Go.

ABSOLUTE RULES (violating these fails the whole project):
- You MUST NOT search the web, fetch URLs, or look for the original source code anywhere.
- You MUST NOT use objdump/ghidra/strace/ltrace/gdb/nm/strings-style analysis on /workspace/executable.
- Your ONLY source of truth is RUNNING /workspace/executable with inputs and observing output,
  plus /workspace/README.md.
- Do not install anything. There is no network.

HOW TO WORK:
- Run the binary a LOT (hundreds of invocations). Use heredocs / printf to make input files in /tmp.
  Always use a unique /tmp subdir of your own to avoid clobbering other agents.
- Capture EXACT bytes. Use \`| cat -A\` or \`| od -c\` when whitespace/trailing-newline matters.
- Capture exit codes (\`echo rc=$?\`) and stderr separately (\`2>/tmp/err\`).
- Probe edge cases and error messages aggressively: empty input, nulls, missing keys, wrong types,
  malformed input. Record the EXACT error text and exit code.
- When you find a behavior, verify it with 2-3 variations so the rule you write down is right.

DELIVERABLES (both are required):
1. A spec file at /workspace/notes/AREAKEY.md — a precise, implementable behavioral specification.
   Write it for an engineer who will implement it in Go WITHOUT access to the binary.
   Include exact output text in fenced blocks, exact error strings, exact exit codes, and the
   inferred rules/algorithms. Be exhaustive and concrete; prefer many small verified examples over
   prose. Note anything surprising or counter-intuitive explicitly.
2. Test cases appended to /workspace/tests/cases/AREAKEY.jsonl — one JSON object per line:
   {"name":"unique-name","args":["-o=json","."],"stdin":"a: 1\\n","files":{"in.yaml":"a: 1\\n"},"env":{"X":"y"},"read_back":["in.yaml"]}
   - "args" is argv after the program name. "stdin","files","env","read_back" are optional.
   - Files are created in a fresh temp cwd, so reference files by bare relative name.
   - Include 60-200 cases covering everything you learned, INCLUDING error/edge cases.
   - Validate your file parses with python3 json.loads on each line.
   - Then verify the harness can record them:
     python3 /workspace/tests/run.py record /workspace/executable /workspace/tests/cases/AREAKEY.jsonl
     (this writes a .expected sidecar; make sure it succeeds and spot-check a few entries)
   - Do NOT include cases that are nondeterministic (timestamps like \`now\`, random, filesystem
     paths outside the temp cwd, colors depending on TTY). If you want to test time functions, use
     fixed input timestamps only.

Your final message must be a <=25 line summary of the most important/surprising findings. Do not
paste the whole spec back.
`;

const AREAS = [
  {
    key: 'yaml-scalars',
    prompt: `AREA: YAML scalar handling (input resolution + output styling).
Probe deeply:
- Plain scalar type resolution: integers (incl. 0x, 0o, 0b, leading +, underscores?), floats
  (1.0, .5, 1e3, .inf, -.inf, .nan), bools (true/False/TRUE/yes/no/on/off/y/n), null (null/~/Null/empty),
  timestamps/dates. What tag does each get? Use '. | tag' and '. | type' to inspect. Check -o=json
  rendering of each (does 1.0 stay 1.0? does 010 stay 010? big ints? 1e999?).
- Number formatting round-trip: does yq preserve the original text of numbers? Test 1.10, 0x10, 1_000,
  1e5, -0, 007, very long integers (30 digits), floats like 0.1+0.2 arithmetic results.
- Quoting on output: when does yq single-quote / double-quote / leave plain? Strings that look like
  numbers/bools/null, strings with # : - ? [ ] { } , & * ! | > single-quote double-quote % @ backtick,
  leading/trailing spaces, empty string, strings with newlines, tabs, unicode, control chars, emoji.
  Test both round-trip (style preserved from input) and newly-created strings (e.g. '.a = "..."' with -n).
- Escape sequences in double-quoted input (\\n \\t \\u1234 \\x41 \\U0001F600 \\0 \\a \\/ \\\\ \\" \\N \\L \\P \\_ \\e)
  and in single-quoted input (doubled quote). What do they decode to; how are they re-emitted?
- Block scalars: literal |, |-, |+, |2, folded >, >-, >+ ; round-trip preservation, folding rules,
  trailing newlines, indentation detection, leading-space content lines, blank lines.
- Long strings: does the yaml output wrap long plain/double-quoted scalars? At what column? Test a
  200-char plain string, a 200-char string with spaces, a long double-quoted string with spaces.
- The style operator: '.a style = "single"' / "double"/"literal"/"folded"/"flow"/"tagged"/"" and reading
  '.a | style'. And -P/--prettyPrint. And -r/-M interaction for top-level scalar output.
- Multi-line string output when unwrapScalar applies (top-level string result printing).`,
  },
  {
    key: 'yaml-structure',
    prompt: `AREA: YAML document structure, indentation, anchors, tags, multi-doc.
Probe deeply:
- Indentation: -I=0,1,2,3,4,8 on nested maps, nested seqs, seqs of maps, maps in seqs. Note yq's
  default sequence indentation (does '- ' get indented under its parent key?). Then -c/--yaml-compact-seq-indent.
  What does -I=0 do exactly? Does -I affect json output too?
- Flow style: input {a: 1, b: [1,2]} round-trip; nested flow; empty flow {} and []; flow with comments;
  '. style="flow"' output; line wrapping of long flow collections (where does it break?).
- Anchors and aliases: ampersand-a / star-a round-trip, anchors on maps/seqs/scalars, merge keys
  '<<: *a' and '<<: [*a, *b]', explode(.), reading '.a | anchor', setting 'anchor = "x"', '.a | alias',
  'alias = "b"'. Also --yaml-fix-merge-anchor-to-spec flag differences. Duplicate anchors. Undefined alias error.
- Tags: !!str, !!int, !!float, !!bool, !!null, !!map, !!seq, custom !foo, !!binary, verbatim tags.
  Round-trip; '.a | tag'; '.a tag = "!!str"'; how a custom-tagged scalar/map is emitted; -o=json of tagged nodes.
- Multiple documents: --- separators, ... end markers, doc with only a scalar, empty docs, leading ---,
  comments between docs. -N/--no-doc. How many trailing newlines? documentIndex/di. splitDoc.
- Directives: %YAML 1.1 / 1.2, %TAG, how they round-trip, --header-preprocess.
- Empty/whitespace-only input, input that is just a comment, input that is just '---'.
- Top-level scalar documents, top-level null.
- Very deep nesting, keys that are complex (explicit '?' keys), non-string keys (int, bool, null, seq, map keys).
- Sorting: 'sort_keys(..)' / sortKeys.`,
  },
  {
    key: 'yaml-comments',
    prompt: `AREA: YAML comments — parsing, association, emission, and comment operators.
Probe deeply:
- Where comments attach: comment above a key (head), on the same line (line), trailing at end of a
  block (foot), comments before/after document separators, comments at the very top of a file
  (header), comment-only files, blank lines between comment and key (does it still attach?).
- Round-trip fidelity: write files with comments in many positions and check '.' output byte-for-byte.
  Include comments inside sequences, on sequence items, inside flow collections, after values, comments
  with no space after the hash, multiple consecutive comment lines, indented comments.
- What happens to comments when a node is deleted / replaced / assigned to / moved.
- Operators: '.a | head_comment', 'line_comment', 'foot_comment', and setting them
  ('.a head_comment = "x"', '... comments = ""', '.. | comments = ""'). What exact leading hash/space
  handling occurs on read and write? Multi-line comment values.
- 'comments = ""' vs 'head_comment = ""' semantics.
- --header-preprocess=true/false differences (the "slurp header comments" behavior), especially with
  expressions that would otherwise drop the header, and with multi-doc files.
- -o=json with comments (dropped?). -P/--prettyPrint with comments.
- Comments plus anchors/aliases, comments plus block scalars.
- Empty comment (bare hash), comment containing a hash, comment at end of file with no trailing newline.`,
  },
  {
    key: 'expr-paths',
    prompt: `AREA: Core expression traversal and structure.
Probe deeply:
- Path expressions: '.', '.a', '.a.b', '.["a"]', '.["a-b"]', '.a-b' (is that a subtraction?), '."a b"',
  '.a?', '.a.b?', '.[]', '.[]?', '.a[]', '.[0]', '.[-1]', '.[1:3]', '.[:2]', '.[2:]', '.[-2:]', '.a[0].b',
  '..', '...', '.[].a', quoted keys with special chars, keys with dots, unicode keys, numeric-looking keys,
  empty key '.[""]'.
- Behavior on wrong types: '.a' on an array / scalar / null; '.[0]' on a map / string; '.[]' on a scalar/null.
  Record EXACT error messages and exit codes. Which of these are errors vs silent null?
- Auto-creation vs read: does '.a.b' on {} return null? Does '.a[3]' create? What about with assignment?
- Optional operator '?' suppressing errors; where can it be applied.
- Pipe, comma, parentheses grouping, precedence between pipe and comma and other ops.
- 'select(...)', 'with(path; expr)', 'with_entries', 'has', 'in', '..' vs '...' (all vs leaf?).
- 'path(..)', 'paths', 'leaf_paths', 'getpath([...])', 'setpath', 'delpaths', 'pick', 'omit', 'del(...)'.
- 'parent', 'key', 'keys', 'values', 'is_key', 'kind', 'type', 'length' on all kinds.
- 'env(X)', ENV variable access forms, 'strenv(X)'.
- 'first', 'last', 'limit', 'until'/'while'/'repeat'/'recurse' if they exist (check errors if not).
- Empty results: what prints when an expression yields nothing? exit code with and without -e.
- Recursive descent output ordering (document exact order for a nested doc).`,
  },
  {
    key: 'expr-assign',
    prompt: `AREA: Assignment, update, and deletion operators.
Probe deeply:
- '=' vs '|=' semantics (RHS context: what does '.' refer to?), on missing paths (auto-vivification of
  maps/arrays incl. sparse arrays like '.a[3] = 1'), on multiple matches, with '.[]' on LHS.
- Arithmetic-assign: '+=', '-=', '*=', '/=', '%=', '//=' on numbers, strings, arrays, maps, nulls.
- 'del(.a)', 'del(.a, .b)', 'del(.[])', 'del(.[0])', 'del(.. | select(...))', deleting from arrays
  (index shifting), deleting missing keys, 'delpaths'.
- Assigning tags/styles/anchors/comments as part of update expressions.
- 'ref' operator if present ('.a ref $x'), 'as $x | ...' then assigning through $x.
- Whether assignment preserves comments/anchors/style of the replaced node (test carefully! e.g.
  '.a = 5' where .a had a line comment, or was quoted).
- '|=' with 'select' filtering, '(.a,.b) = 1', '(.[] | select(.x)) |= ...'
- Assignment on the root '. = 5', '. |= ...'.
- 'with(.a; .b = 1)'.
- '-i/--inplace' interactions: file content after in-place update including trailing newline, with
  multiple docs, with error mid-expression (is the file clobbered?), with -i and no file (error text).
- 'env' assignment / strenv on RHS.
- 'sort_keys', 'explode' as mutating ops.
- Deep merge assign 'a *= b'.`,
  },
  {
    key: 'expr-arith',
    prompt: `AREA: Arithmetic, comparison, boolean, alternative, and multiply/merge operators.
Probe deeply:
- '+' on: int+int, int+float, float+float, string+string, array+array, map+map, null+x, x+null,
  bool+bool, int+string (error text!), map+array. Number formatting of results (int vs float,
  1+1.5, 0.1+0.2, big ints overflow, division by zero).
- '-' on numbers, arrays (set difference?), strings (error?), maps. Unary minus '-.a', '- 1'.
- '*' merge semantics on maps (deep merge) and its flags: '*+', '*?', '*d', '*n', '*=', combinations
  like '*+?'. Numbers, string times int?
- '/' on numbers (int/int gives what?), strings (split?), '%' on numbers and negative numbers.
- Comparison: '==', '!=', '<', '<=', '>', '>=' across types (string vs number vs null vs bool vs
  arrays vs maps). What is the ordering? Errors?
- Boolean: 'and', 'or', 'not', truthiness of null/false/0/empty-string/empty-array/empty-map. Short-circuiting.
- Alternative '//' with null/false/empty/errors. '//=' .
- 'any', 'all', 'any_c', 'all_c'.
- Precedence: build expressions mixing or/and/==/+/*/'//' and pipe/comma and record results to infer
  the precedence table. Also unary/parenthesization requirements (e.g. does '.a == 1 or .b == 2' parse?).
- 'min','max','add' over mixed types.
- 'error("msg")', 'error' with non-string, exact stderr and exit code.
- 'to_number' and any numeric casts.`,
  },
  {
    key: 'expr-strings',
    prompt: `AREA: String and regex functions, interpolation, at-encodings, dates.
Probe deeply (record exact outputs and error messages):
- split(s), split with regex?, join(s) on mixed types, ascii_downcase, ascii_upcase, downcase/upcase
  aliases?, trim, ltrimstr, rtrimstr, trimstr?, startswith, endswith, test(re), test(re; flags),
  match(re), match(re; "g") output shape (offset/length/string/captures incl. named captures),
  capture(re), capture with named groups, sub(re; repl), sub with flags, gsub, replacement
  backreferences, scan?, splits?
- Regex flavor details: character classes, anchors, case-insensitive flag "i", and other flags.
  What happens with an invalid regex (exact error)?
- String interpolation: literal double-quoted strings containing backslash-paren expressions, nested,
  escaping, --string-interpolation=false, interpolation of non-strings (numbers/maps/arrays/null),
  interpolation in keys.
- At-encodings: @base64, @base64d, @csv, @tsv, @sh, @json, @yaml, @text, @uri, @urid, @html — test
  each on strings/numbers/arrays/maps, and from_json/to_json/from_yaml/to_yaml/load_str variants.
- Number to string: to_string, tostring, to_number, tonumber, format of floats.
- Date/time: does 'now' exist? (don't test its value), to_unix/from_unix, tz("..."),
  format_datetime("..."), with_dtf(...), date arithmetic, parsing date strings.
  Use FIXED input dates. Record the datetime layout syntax (Go-style vs strftime).
- Functions applied to null; functions with wrong arg counts (exact errors).
- Check whether utf8bytelength/explode/implode/ascii exist.
- 'test' etc. inside select for filtering.`,
  },
  {
    key: 'expr-collections',
    prompt: `AREA: Array/object/collection functions.
Probe deeply, recording exact output including ordering and error text:
- keys, values, length (on map/array/string/number/null/bool), has(k) on maps/arrays, in, contains,
  inside, index(x), rindex(x), indices(x) on arrays and strings.
- map(f), map_values(f), to_entries, from_entries, with_entries(f) — exact entry key names, and
  behavior on arrays and on non-collections.
- add (arrays of numbers/strings/maps/arrays/nulls, empty array, map input), any, all, any(f), all(f).
- sort, sort_by(f), sort_by with multiple keys, sort stability, sort of mixed types (document the total
  order!), reverse, unique, unique_by(f), group_by(f) (ordering of groups!), flatten, flatten(depth).
- min, max, min_by, max_by on mixed/empty.
- range(n), range(a;b), range(a;b;c).
- pick([...]), omit([...]) on maps and arrays.
- 'to_entries | from_entries' round trip on arrays.
- collect with square brackets, object construction: '{"a": .b}', '{a: 1}', dynamic keys with parens,
  shorthand forms, nested, with multiple results (cartesian product!), empty object.
- reduce/ireduce full syntax and semantics, foreach if present, limit, first(f), last(f),
  until, while, repeat, recurse — check which exist.
- group_by + map idioms, unique_by tie-breaking.
- to_number on collections, tostring on collections.
- getpath/setpath/delpaths/paths/leaf_paths exact output shapes.
- collect with empty results, empty array vs 'empty'.
- 'empty' operator, 'null' literal, 'true'/'false' literals, numeric literals incl. floats/negatives.`,
  },
  {
    key: 'expr-vars-misc',
    prompt: `AREA: Variables, reduce, document/file context, loading, evaluation, misc operators.
Probe deeply:
- 'as \\$x | ...' binding semantics (per-match iteration!), 'as [\\$a, \\$b]' array destructuring,
  object destructuring, variables with multiple upstream matches, nested bindings.
- Variable reference forms: '.a as \\$x | \\$x', '\\$x.b', referencing an undefined variable (exact error).
- reduce/ireduce: 'reduce .[] as \\$item (0; . + \\$item)', 'ireduce', accumulator semantics, empty input.
- Context ops: 'filename', 'fileIndex'/'fi', 'documentIndex'/'di', 'line', 'column',
  'type', 'tag', 'anchor', 'alias', 'style', 'parent', 'key', 'is_key', 'path', 'to_yaml'.
- File ops: 'load("f.yaml")', 'load_str', 'loadXml', 'load_props', 'load_base64', etc.
  '--security-disable-file-ops' error text. Loading nonexistent file (error).
- 'env(NAME)', 'strenv(NAME)', ENV map access, '--security-disable-env-ops' error text.
- 'eval(".a")' operator, 'system' operator, '--security-enable-system-operator' behavior and default error.
- 'splitDoc', 'select', 'not', 'error', 'sortKeys'/'sort_keys', 'explode', 'del'.
- 'with_dtf'. Check what identifiers are valid: try a long list of plausible function names
  and record which give "invalid input text" (i.e. do not exist) vs some other error. THIS LIST IS
  VALUABLE — enumerate systematically (e.g. try jq builtins: floor, ceil, round, sqrt, pow, log,
  fabs, tostream, fromstream, getpath, splits, ltrimstr, input, inputs, debug, stderr, halt, ascii,
  todate, fromdate, strftime, mktime, gmtime, infinite, nan, isnan, isinf, type, builtins, ...).
- Also enumerate which SYMBOLS/operators the lexer accepts.`,
  },
  {
    key: 'format-json',
    prompt: `AREA: JSON input and output (also kyaml if it exists).
Probe deeply:
- '-o=json' output: default indent (2), '-I=0' (compact single line? spaces after colons?), '-I=4',
  '-I=1'. Exact byte output including trailing newlines. Multiple documents with -o=json (newline
  separated? no commas?). '-o=json' with '-N'.
- Key ordering preserved from input.
- String escaping in JSON output: quotes, backslash, newline, tab, control chars, DEL, unicode BMP,
  astral/emoji, invalid UTF-8 bytes, less-than, greater-than, ampersand, slash (does it escape HTML
  chars?), U+2028/2029.
- Numbers: ints, floats (does 1.0 stay 1.0? 1e5?), -0, huge ints (>2^63), 30-digit ints, 0.1+0.2,
  infinity/nan in json output (error?), leading zeros, hex input.
- YAML-only constructs to JSON: anchors/aliases (expanded?), merge keys, tags, comments, multi-line
  strings, non-string keys (int/bool/null/array keys), duplicate keys, binary tag.
- JSON input parsing ('-p=json' and auto-detect by .json extension): does it accept comments,
  trailing commas, single quotes, NaN, unquoted keys, top-level scalars, multiple concatenated JSON
  docs, JSON lines? Empty file? Record exact parse error messages (with line/col?).
- Round-trip: json to yaml (-P), yaml to json. '-p=json -o=json' idempotence.
- 'kyaml' format if supported: '-o=kyaml' and '-p=kyaml' — figure out what it looks like on nested
  data, arrays, strings, and how it differs from yaml/json.
- '-o=json' with '-r'/'-M'/'-C'.
- json output of empty map/array, null document, empty result set.`,
  },
  {
    key: 'format-xml',
    prompt: `AREA: XML input and output.
Probe deeply:
- '-p=xml' parsing: elements, nested elements, repeated elements (arrays), attributes (prefix '+@'),
  text content (key '+content'), mixed content, self-closing tags, CDATA, comments (where do they go?),
  processing instructions ('+p_xml'), DOCTYPE/directives ('+directive'), namespaces, entities
  (character and named), whitespace handling (is whitespace-only text dropped? preserved?), empty elements.
- Flags: --xml-attribute-prefix, --xml-content-name, --xml-directive-name, --xml-proc-inst-prefix,
  --xml-keep-namespace=false, --xml-raw-token=false, --xml-skip-directives, --xml-skip-proc-inst,
  --xml-strict-mode. Test each with a representative doc.
- '-o=xml' emitting: from maps, arrays (repeated element names), scalars, nested, attributes from
  '+@' keys, content from '+content', comments to xml comments?, indentation with -I, root element
  naming when the doc is a scalar/array, empty map/array, keys that are invalid XML names, null values,
  numbers/bools, special chars escaping.
- Round trips: xml to yaml to xml.
- Errors: malformed XML (exact message), multiple roots, unclosed tag.
- Does xml output emit a header/declaration? trailing newline count? Multi-document xml output.`,
  },
  {
    key: 'format-props-ini',
    prompt: `AREA: Properties and INI formats (input and output).
Probe deeply:
- '-o=props': nested maps to dotted keys, arrays to '.0'/'.1' or '[0]' with --properties-array-brackets,
  --properties-separator variations, empty separator, values needing escaping, null values, empty
  map/array, booleans, numbers, comments from yaml (are they emitted as hash lines?), key ordering,
  deeply nested, top-level scalar/array.
- '-p=props': parsing 'a.b = c', 'a.b=c', 'a.b:c', space separator, comments (hash and bang),
  blank lines, line continuations, duplicate keys, array indices 'a.0=x' (array or map?),
  bracket form, escaped chars, keys with no value, values containing '=',
  auto-parse of numbers/bools (are values typed or strings?).
- '-o=ini' and '-p=ini': sections, global keys, nesting depth >2 (error?), key=value formatting,
  comments (semicolon and hash), duplicate sections, arrays, quoted values, empty sections, ordering.
  Note exactly how ini differs from props.
- Round trips both ways. Exact error messages for malformed input.
- '-o=props'/'-o=ini' with -I indent (any effect?), with multiple documents.`,
  },
  {
    key: 'format-csv-tsv',
    prompt: `AREA: CSV and TSV formats (input and output).
Probe deeply:
- '-o=csv' from: array of maps (header row from union of keys? first object's keys? order?), array of
  arrays, array of scalars, single map, single scalar, nested values (map/array inside a cell), null
  values, booleans, numbers, strings needing quoting (comma, quote, newline, leading space,
  separator char), empty array, array with inconsistent keys (missing keys), unicode.
- '--csv-separator' with ';', '|', tab, multi-char (error?), and interaction with quoting.
- '-o=tsv': quoting/escaping rules (tabs, newlines in values), differences from csv.
- '-p=csv' / '-p=tsv' parsing: header row to array of maps, --csv-auto-parse=true/false (are '1',
  'true', 'null', '1.5', ' 1' typed?), quoted fields, embedded newlines, ragged rows (error?),
  empty file, single column, duplicate header names, BOM, CRLF line endings, trailing newline absent.
- Round trips. Exact error messages.
- Multiple documents with csv output. Line ending used on output.`,
  },
  {
    key: 'format-misc',
    prompt: `AREA: TOML, HCL, Lua, base64, uri, shell formats.
Probe deeply (test both -p and -o where supported; if a direction is unsupported record the exact error):
- TOML input: key=value, tables, arrays of tables, nested tables, dotted keys, all value types
  (strings with escapes, literal strings, multi-line strings, ints incl 0x/underscores, floats,
  inf/nan, bools, offset/local datetimes, dates, times, arrays, inline tables), comments, blank lines.
  What YAML/JSON does each produce? Are datetimes strings? Is '-o=toml' supported?
- HCL: is '-p=hcl' supported? What syntax subset? blocks, attributes, heredocs, lists, objects,
  comments. '-o=hcl'?
- Lua output: '-o=lua' on maps/arrays/scalars/nested/null/bools/numbers/strings needing escapes,
  --lua-globals, --lua-prefix, --lua-suffix, --lua-unquoted, keys that are not valid identifiers,
  indentation with -I, empty collections. Is '-p=lua' supported? If so, what does it parse?
- base64: '-p=base64' (decode input then parse as yaml?), '-o=base64' (encode output), padding,
  invalid base64 error, binary data, combined with other formats ('-p=base64 -o=json').
- uri: '-p=uri' and '-o=uri' — exactly what gets encoded/decoded, which chars, plus/space handling.
- shell output '-o=shell': variable naming from nested paths, --shell-key-separator, quoting of values,
  arrays, special chars, invalid identifier characters, null values, top-level scalar.
- For every format, also test: empty input, null document, top-level scalar, multiple documents,
  and the exact trailing-newline behavior.`,
  },
  {
    key: 'cli',
    prompt: `AREA: CLI surface — argument parsing, subcommands, flags, files, exit codes, errors.
Probe deeply:
- Argument detection: when is the first arg an expression vs a filename? Test: 'yq file.yaml',
  'yq .a file.yaml', 'yq file.yaml .a', 'yq' with no args and no stdin (and with stdin),
  an existing file named like an expression, nonexistent file, '--expression',
  '--from-file', both together, an expression that is also an existing filename.
- Multiple files: 'yq .a f1.yaml f2.yaml' (doc separators between? order?), '-' for stdin mixed with
  files, missing file error text and exit code, directory as input, unreadable file.
- eval vs eval-all: 'e'/'ea' aliases, differences in output for multi-file/multi-doc, 'eval-all' with
  fileIndex/documentIndex, -i with eval-all.
- '-i/--inplace': content after update (permissions? trailing newline?), with multiple files (which
  ones get updated?), with stdin (error?), with -o=json, when the expression errors, when file is a
  symlink. Also '-i' with 'eval-all'.
- '-n/--null-input': what is '.' ? combined with expressions creating docs, with files given too.
- '-e/--exit-status': exit codes for null result, false result, empty result set, error, normal.
  Test the full matrix and record codes exactly.
- '-s/--split-exp' and '--split-exp-file': filenames produced (extension added?), index variable,
  directory creation, with -o=json, output to stdout suppressed?
- '-f/--front-matter=extract|process': behavior on a markdown file with front matter, without one,
  invalid value error.
- '-0/--nul-output', '-r=false', '-M', '-C' (with colors — record the exact ANSI codes for a document
  with strings/numbers/bools/nulls/keys/comments/anchors/tags; also YQ_COLORS env var if supported),
  '-v/--verbose' (what does it print to stderr?), '--debug-node-info'.
- 'help', 'help eval', '--help' on subcommands, 'completion bash|zsh|fish|powershell' (just confirm it
  emits something and note the first/last lines; do NOT add giant completion output to test cases),
  unknown command, unknown flag (exact error + exit code + usage dump?), '-V/--version' exact text.
- Exit codes for: yaml parse error, expression parse error, runtime error, file not found, bad flag value.
- Reading the same file twice, file with no trailing newline (is one added?), CRLF input, BOM input,
  file with only whitespace.`,
  },
  {
    key: 'expr-lexer-grammar',
    prompt: `AREA: Expression lexer/grammar precise rules — needed to write a compatible parser.
This area is about SYNTAX, not semantics. Probe deeply:
- Which characters/sequences are valid tokens. Systematically try single- and double-character
  operator candidates and record the exact lexer error vs acceptance. Cover at least:
  = == != < <= > >= + - * / % // ! ? | & , ; : . .. ... ( ) [ ] { } dollar at hash caret tilde
  backslash quote doublequote backtick, and the '*+', '*?', '*d', '*n', '*=', '+=', '-=', '/=', '%=',
  '//=', '|=' assign forms.
- Identifier rules: which characters may appear in a bare key after '.' (letters, digits, underscore,
  hyphen, unicode, starting with a digit?). Does '.a-b' lex as key "a-b" or as subtraction? What about
  '.a+b', '.1a', '.a1', '._a', '.a_b', '.a.b-c'? And bare identifiers as function names.
- Quoting inside paths: '."a.b"', '.["a.b"]', escaped quotes inside, single quotes allowed?,
  whitespace inside brackets, variable subscripts, dynamic keys, arithmetic inside brackets.
- String literals: double-quoted with escapes, single-quoted strings (supported at all?),
  unterminated string error.
- Number literals: 1, -1, 1.5, .5, 1e3, 0x10, 1_000, +1, 1.5e-3, huge numbers.
- Comments in expressions: hash comment support inside an expression, newlines in expressions,
  leading/trailing whitespace, empty expression and whitespace-only expression.
- Precedence and associativity table: design experiments to determine the relative precedence of
  pipe, comma, '//', or, and, ==, !=, <, >, +, -, *, /, %, '?' and assignment ops, plus 'as',
  'ireduce', 'with', unary minus, 'not'. Record which combinations REQUIRE parentheses (exact error
  message when they do not parse).
- Exact wording of parse/lex errors for: unknown identifier, unbalanced parens/brackets/braces,
  operator with missing operand (left and right), trailing operator, double operator, empty parens,
  bad variable name, keyword misuse.
- Multi-line expressions with comments (as in the README multi-update example).
- Error message format: does it include an 'Error: ' prefix, line:col, and go to stderr? exit code?`,
  },
];

phase('Explore')

const results = await parallel(AREAS.map(a => () => agent(
  RULES.replace(/AREAKEY/g, a.key) + '\n\nYOUR ASSIGNED AREA KEY: ' + a.key + '\n\n' + a.prompt,
  { label: a.key, phase: 'Explore' }
)))

return results.map((r, i) => ({ area: AREAS[i].key, summary: r }))
