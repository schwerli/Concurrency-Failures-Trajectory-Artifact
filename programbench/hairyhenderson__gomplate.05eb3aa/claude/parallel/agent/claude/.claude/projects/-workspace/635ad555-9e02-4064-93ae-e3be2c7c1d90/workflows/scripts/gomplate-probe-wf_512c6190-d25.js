export const meta = {
  name: 'gomplate-probe',
  description: 'Probe the gomplate binary namespace-by-namespace and write precise behavioral specs',
  phases: [
    { title: 'Probe', detail: 'one agent per namespace / CLI area' },
    { title: 'Audit', detail: 'completeness critic per spec' },
  ],
}

const COMMON = `
You are reverse-engineering the behavior of a compiled binary at /workspace/executable (call it as ./executable from /workspace).
It is "gomplate", a Go text/template renderer. Documentation lives in /workspace/docs/content/.

HARD RULES (violating them fails the whole project):
- You MUST NOT use the network, MUST NOT search the web, MUST NOT download or read the original gomplate source from anywhere.
- You MUST NOT decompile, disassemble, objdump, strace, ltrace, nm, strings(1), or otherwise statically analyze ./executable.
- You may ONLY run ./executable with normal CLI arguments and observe stdout/stderr/exit code, and read the bundled docs.

How to invoke: ./executable -i '<template>'   (prints rendered result to stdout)
Errors are logged to stderr as JSON: {"time":...,"level":"ERROR","msg":"","err":"..."} and exit code 1.
Useful trick: wrap results with printf "%T / %#v" to learn the concrete Go type a function returns, e.g.
  ./executable -i '{{ printf "%T" (conv.ToInt "5") }}'
Another: {{ test.Kind x }} and {{ test.IsKind "int" x }} reveal reflect kinds.

YOUR OUTPUT: write a thorough markdown spec file. Be exhaustive and precise: this spec is the ONLY thing a
separate implementer agent will see — they will not have access to the binary at first. Every fact must be
concrete and verified by an actual command you ran.

For EVERY function in your assigned area document:
1. Exact name(s) including aliases (verify each alias actually exists in THIS build — docs are stale, some
   documented functions were removed; e.g. conv.Bool does NOT exist here).
2. Exact parameter order and count, including variadic behavior and gomplate's "data is the LAST argument"
   pipeline convention. Verify by experiment, not by reading docs.
3. The concrete Go return type (use printf "%T").
4. Type coercion rules for inputs (what happens with int vs string vs float vs bool vs nil vs slice vs map).
5. Error messages VERBATIM (copy the exact "err" string), and whether it errors vs returns zero value.
6. Edge cases: empty string, empty slice, nil, negative numbers, unicode/multibyte, very large numbers,
   wrong arg count, wrong types.
7. At least 5-15 concrete verified examples per function in the form:
   | template | output |
   Use a fenced table or list. Copy outputs EXACTLY (including whitespace/newlines; note trailing newlines).

Finish the spec with a "GOTCHAS" section listing anything surprising an implementer would get wrong.
Do not summarize or truncate — length is good. Aim for a very detailed document.
`

function probe(ns, docFile, extra) {
  return agent(
    COMMON +
    `\nYOUR ASSIGNED AREA: ${ns}\n` +
    (docFile ? `Relevant docs: ${docFile} (read it first to get the function list, then verify each against the binary).\n` : '') +
    `${extra || ''}\n\nWrite your spec to /tmp/spec/${ns}.md using the Write tool. ` +
    `Then reply with just a one-paragraph summary of what you covered and anything you could not determine.`,
    { label: `probe:${ns}`, phase: 'Probe' }
  )
}

phase('Probe')

const AREAS = [
  ['strings', '/workspace/docs/content/functions/strings.md', 'This is the biggest namespace (29 funcs). Pay special attention to strings.Trunc/Abbrev/Indent/Slug/WordWrap/ShellQuote/Sort/SkipLines and the exact word-wrapping algorithm (test long inputs, existing newlines, and width edge cases). Also check strings.Split/SplitN return types and strings.Trim family arg order.'],
  ['conv', '/workspace/docs/content/functions/conv.md', 'Focus on ToInt/ToInt64/ToFloat64/ToBool/ToString and their plural forms, Default (what counts as "empty"?), Join, URL, Has, ParseInt/ParseFloat/ParseUint/Atoi, ToInterface. Test conv.ToBool with many spellings (1, "yes", "on", "T", "TRUE", "  true  ", 0.0, empty slice...). Test conv.ToInt with floats, strings with 0x/0b/0o prefixes, huge values, negative, and non-numeric (error text!). Verify conv.Bool and bool do NOT exist.'],
  ['coll', '/workspace/docs/content/functions/coll.md', 'Focus on Dict/Slice/Has/Keys/Values/Append/Prepend/Uniq/Flatten/Reverse/Sort/Merge/Pick/Omit/GroupBy/Index/JSONPath/JQ/Set/Unset. Sort: test mixed types, maps by key, structs. Merge: deep-merge precedence order (which wins?). Flatten with depth arg. Test JQ separately but note its dispatch here.'],
  ['math', '/workspace/docs/content/functions/math.md', 'Focus on Add/Sub/Mul/Div/Rem/Pow/Seq/Max/Min/Ceil/Floor/Round/Abs/IsInt/IsFloat/IsNum. Critical: when do these return int64 vs float64? Test integer overflow, division by zero, mixed int/float args, string numeric args, and the exact rounding rule for math.Round (half away from zero? banker\'s?). Seq with 1, 2, 3 args and negative/zero steps.'],
  ['crypto', '/workspace/docs/content/functions/crypto.md', 'Focus on SHA*/MD5/Bcrypt/PBKDF2/RSA*/ECDSA*/AES*/WPAPSK/Argon2id?/HMAC. Determine which are deterministic (testable) vs random. For RSA/ECDSA note key formats. Record exact output encodings (hex? base64? byte slice?). crypto.SHA256 etc: is output hex string? Test crypto.RSAGenerateKey size and PEM headers.'],
  ['data', '/workspace/docs/content/functions/data.md', 'THIS IS CRITICAL. Focus on data.JSON/JSONArray/YAML/YAMLArray/TOML/CSV/CSVByRow/CSVByColumn/CUE and the To* serializers ToJSON/ToJSONPretty/ToYAML/ToTOML/ToCSV/ToCUE. Determine EXACT output formatting: indentation, key ordering (sorted? insertion?), how nested maps/slices/nil/bools/numbers/strings-needing-quotes are emitted, trailing newlines, YAML flow vs block style, long string handling, special chars. Test round-trips. Also datasource/ds/include/datasourceExists/defineDatasource/listDatasources basics. Produce MANY exact-output samples since an implementer must byte-match these serializers.'],
  ['time', '/workspace/docs/content/functions/time.md', 'Focus on time.Now/Parse/ParseLocal/ParseInLocation/ParseDuration/Since/Until/ZoneName/ZoneOffset/Nanosecond..Hour constants. Note returned types (time.Time?) and what methods templates can call on them (.Format, .Unix, ...). Document the named layout constants (time.ANSIC etc) if present. Test error text for bad layouts.'],
  ['net', '/workspace/docs/content/functions/net.md', 'Focus on the CIDR/IP functions which are offline-testable: net.ParseIP/ParseIPPrefix/ParseAddr/ParseRange/CIDRHost/CIDRNetmask/CIDRSubnets/CIDRSubnetSizes. Note DNS ones (LookupIP etc) need network - just record their signatures and the error text when DNS fails (network is unavailable here, so capture that error). Record exact string forms of returned addr/prefix values.'],
  ['regexp', '/workspace/docs/content/functions/regexp.md', 'Focus on Find/FindAll/Match/QuoteMeta/Replace/ReplaceLiteral/Split. Verify arg order carefully (regex first? last?). Test capture group expansion $1 in Replace vs ReplaceLiteral, the n argument in FindAll/Split, and invalid-regex error text.'],
  ['path-filepath', '/workspace/docs/content/functions/path.md', 'Cover BOTH /workspace/docs/content/functions/path.md and /workspace/docs/content/functions/filepath.md. Document every function in the path.* and filepath.* namespaces, especially Split (returns what? a slice?), Match, Rel, Ext, Clean, IsAbs, Join, VolumeName. Note differences between the two namespaces.'],
  ['file-env-base64', '/workspace/docs/content/functions/file.md', 'Cover /workspace/docs/content/functions/file.md, env.md and base64.md. file.Read/ReadDir/Stat/Exists/IsDir/Walk/Write. Create temp files under /tmp to test. Note file.Write restrictions (relative paths only? sandbox?). env.Getenv/ExpandEnv/Setenv? base64.Encode/Decode/DecodeBytes exact behaviors with binary and invalid input.'],
  ['test-tmpl', '/workspace/docs/content/functions/test.md', 'Cover /workspace/docs/content/functions/test.md and tmpl.md. test.Assert/Fail/IsKind/Kind/Required/Ternary — exact error text is very important here. tmpl.Exec/Inline/Path/Inline+context — how do nested templates get their context and funcmap? Test tmpl.Exec with a defined template and with missing template (error text).'],
  ['random-uuid-semver', '/workspace/docs/content/functions/random.md', 'Cover random.md, uuid.md and semver.md. random.ASCII/Alpha/AlphaNum/String/Item/Number/Float — document character sets and the regex/range argument semantics precisely (these are random, so verify by running many times and checking the character class and length). uuid.V1/V4/IsValid/Parse/Nil — formats. semver.Semver/CheckConstraint — supported constraint operators (test ^ ~ >= < || , * x - and prerelease handling), return type fields (.Major .Minor .Patch .Prerelease .Metadata .Original?).'],
  ['sockaddr', '/workspace/docs/content/functions/sockaddr.md', 'Document all 19 sockaddr functions. Many need real interfaces; test what works in this container (there is at least lo and eth0). Focus on the pure functions and record exact output shapes and error strings for the rest.'],
  ['aws-gcp', '/workspace/docs/content/functions/aws.md', 'Cover aws.md and gcp.md. There is NO network here, so record what each function does when it cannot reach the metadata endpoint / API: exact error text, or empty output, and how long it blocks (note any timeouts - if a call hangs more than ~10s, kill it and record that). This matters because the reimplementation must fail the same way. Also record aws.EC2Region default value and any env vars that change behavior (AWS_TIMEOUT? AWS_META_ENDPOINT? AWS_DEFAULT_REGION?).'],
  ['jq', null, 'Your area is the `jq` / `coll.JQ` function: gomplate embeds a full jq implementation. Systematically map out WHICH jq language features are supported and exactly how results are returned to the template (single value vs array? what Go type?). Test: field access .a .a.b .["a"], iteration .[], slices .[1:3], pipes, comma, select(), map(), add, length, keys, has(), to_entries, from_entries, with_entries, arithmetic, string interpolation "\\(.a)", if/then/elif/else/end, try/catch, alternative //, reduce, foreach, sort_by, group_by, unique, min/max, range, tostring/tonumber, type, env, $__loc__, def user functions, variables as $x, recursive descent .., paths, getpath/setpath, splits, ltrimstr, ascii_downcase, @base64/@csv/@tsv/@json format strings, limit, first/last, any/all, flatten, tojson/fromjson, error(), input/inputs (probably unsupported), regex funcs test/match/capture/sub/gsub. For each: give the exact template, the exact output, and note unsupported ones with their exact error text. This is the single most important spec for a hard subsystem - be extremely thorough.'],
  ['cue', null, 'Your area is CUE support: the `cue` / `data.CUE` parsing function and `toCUE` / `data.ToCUE` serializer. Determine how much of the CUE language the parser supports: basic structs, lists, references, arithmetic on refs, string interpolation, definitions (#Def), constraints/types (int, string, >5), disjunctions (a | b), defaults (*x | y), optional fields (a?:), comprehensions (for/if), imports, embedding, unification of duplicate fields, hidden fields (_x), bytes, null, multiline strings. Test each and record exact output (usually piped through data.ToJSON) or exact error text. Then exhaustively document toCUE output formatting: indentation (tabs? spaces?), key quoting rules, ordering, how nested maps/lists/nulls/bools/floats/multi-line strings are emitted, trailing newline. An implementer must byte-match toCUE output.'],
  ['cli-flags', '/workspace/docs/content/usage.md', 'Your area is the COMMAND-LINE INTERFACE. Document exhaustively: every flag, its short form, default, and behavior; --help output VERBATIM (byte for byte, including spacing) and --version; behavior with no args (reads stdin); -f/--file, -i/--in, --input-dir, --exclude, --include, --exclude-processing, -o/--out, --output-dir, --output-map, --chmod, -t/--template, --exec-pipe and post-run `--` exec commands, --left-delim/--right-delim (and GOMPLATE_LEFT_DELIM env), --missing-key (error/zero/default/invalid), --experimental, -V/--verbose (exact log lines), --plugin. Document error text for invalid combinations (e.g. -i with -f, unknown flag, missing file). Document exit codes. Document the exact stderr JSON log format. Test multiple -f/-o pairs. Test what happens with a directory as -f.'],
  ['cli-config', '/workspace/docs/content/config.md', 'Your area is the CONFIG FILE (.gomplate.yaml) and environment variables. Document: every config key and its mapping to a flag, precedence (flag vs config vs env), the --config flag, GOMPLATE_CONFIG env var, and the exact YAML dump printed by -V ("config is:\\n---\\n...") for a variety of configurations - this reveals the internal config struct field names and ordering, which the implementation must reproduce exactly. Try many flag combos and record the exact dumped YAML each time. Also document env vars: GOMPLATE_LEFT_DELIM, GOMPLATE_RIGHT_DELIM, GOMPLATE_EXPERIMENTAL, GOMPLATE_LOG_FORMAT (try values: json, console, simple, logfmt), GOMPLATE_SUPPRESS_EMPTY, GOMPLATE_PLUGIN_TIMEOUT, and any others mentioned in docs.'],
  ['datasources', '/workspace/docs/content/datasources.md', 'Your area is DATASOURCES. Document every URL scheme and how it behaves offline: file://, relative paths, dir paths (trailing slash), stdin:, env:, http(s):, merge:, aws+smp:, aws+sm:, s3:, gs:, vault:, consul:, boltdb:, git/git+file/git+https. For each, record exact behavior/error. Focus deeply on the offline-usable ones: FILE (all extensions: .json .yaml .yml .toml .csv .cue .env .ini? .plist? .txt, plus ?type= query override), DIRECTORY datasources (what does `ds "dir"` return? what about subpaths?), ENV, STDIN, MERGE. Document the `type` query param and supported MIME types, the -H header flag, and how subpaths work (ds "alias" "sub/path"). Also document -c/--context including the special `.` alias, and how .Env is exposed. Test extensively with real temp files.'],
]

const specs = await parallel(AREAS.map(([ns, doc, extra]) => () => probe(ns, doc, extra)))

phase('Audit')
const audits = await parallel(AREAS.map(([ns], i) => () => agent(
  COMMON +
  `\nYou are the COMPLETENESS CRITIC for the spec at /tmp/spec/${ns}.md (area: ${ns}).\n` +
  `Read that spec. Then find what is MISSING, VAGUE, or WRONG: functions listed in the docs (or discoverable\n` +
  `by probing) that are absent from the spec; claims that are not backed by a verified example; outputs that\n` +
  `look guessed rather than copied; missing error text; missing edge cases.\n` +
  `Verify at least 25 additional distinct probes of your own against ./executable, prioritising whatever the\n` +
  `spec covers least.\n` +
  `Then EDIT /tmp/spec/${ns}.md in place (Edit/Write tools) to add everything you found. Do not delete correct\n` +
  `existing content. Reply with a short list of the gaps you fixed.`,
  { label: `audit:${ns}`, phase: 'Audit' }
)))

return { probed: specs.filter(Boolean).length, audited: audits.filter(Boolean).length }
