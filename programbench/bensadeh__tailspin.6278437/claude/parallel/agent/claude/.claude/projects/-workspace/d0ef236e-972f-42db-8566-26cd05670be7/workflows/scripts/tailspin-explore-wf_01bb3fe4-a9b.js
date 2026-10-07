export const meta = {
  name: 'tailspin-explore',
  description: 'Exhaustively characterize tailspin (tspin) behavior by black-box probing to enable reimplementation',
  phases: [
    { title: 'Probe', detail: 'one agent per highlighter/behavior area' },
    { title: 'Critique', detail: 'completeness critic per area' },
  ],
}

const RULES = `
CRITICAL RULES (violating them fails the whole project):
- The binary under study is /workspace/executable (tailspin / tspin v5.6.0, a log highlighter written in Rust).
- You MUST NOT decompile, disassemble, or run objdump/nm/strings/readelf/gdb/ghidra/strace/ltrace on /workspace/executable.
- You MUST NOT search the web or any package registry for tailspin's source code, nor download/install tailspin.
- You may ONLY learn behavior by RUNNING /workspace/executable with inputs and observing stdout/stderr/exit codes.
- Docs you may read: /workspace/README.md, /workspace/man/tspin.1, /workspace/example-logs/*.

USEFUL TECHNIQUE:
- Use -p to print to stdout instead of paging: printf '%s\\n' 'LINE' | /workspace/executable -p
- Make escapes visible by piping through: sed 's/\\x1b/E/g'   (so ESC[36m shows as E[36m)
- Feed many probe lines at once via a heredoc into a helper script. A helper already exists at /tmp/t/probe.sh which does: cat | /workspace/executable -p | sed -e 's/\\x1b/E/g'
- You can pass --disable / --enable with a comma separated list from: numbers, urls, pointers, dates, paths, quotes, key-value-pairs, uuids, ip-addresses, processes, json  --- use these to ISOLATE a single highlighter and remove interference. Also --disable-builtin-keywords.
- NOTE: highlighters run in a fixed order and each one only applies to regions of the line NOT already highlighted by an earlier one. Use --enable/--disable to avoid confounds.
- Beware: "--enable X" means "only X (plus builtin keywords)". Verify that assumption.
- Work in your own scratch dir under /tmp to avoid clobbering other agents.

OUTPUT REQUIREMENTS:
- Write a thorough, precise markdown spec to the file path given in your task, using the Write tool.
- The spec must be precise enough that another engineer can reimplement byte-identical output WITHOUT access to the binary. Give exact regex-like grammar, exact ANSI sequences (write ESC as E, e.g. E[3;34m ... E[0m), exact ordering, and a table of concrete input to output examples.
- Include NEGATIVE cases (what does NOT match) and boundary cases.
- Your final chat message: a compact summary (at most 60 lines) of the key rules. The file has the details.
`;

const AREAS = [
  {
    key: 'json',
    spec: '/tmp/t/specs/json.md',
    task: `Characterize the JSON highlighter of tspin.
Known starting facts: for input line {"timestamp": "2022-09-22T08:11:36.171800155Z", "message": "Task completed", "status": "success"} the output is (E = ESC):
E[2m{E[0m E[2m"E[0mE[2mtimestampE[0mE[2m"E[0mE[2m:E[0m E[2m"E[0m<date-highlighted>E[2m"E[0mE[2m,E[0m E[2m"E[0mE[2mmessageE[0mE[2m"E[0mE[2m:E[0m E[2m"E[0mTask completedE[2m"E[0mE[2m,E[0m ... E[2m}E[0m
Note a SPACE was inserted after the opening brace and before the closing brace that was not in the input, so the JSON appears to be re-serialized/pretty-printed in a specific single-line style. Also a bare "abc" line is treated as JSON (dim quotes) while: x "abc" y  is not.

Determine exhaustively:
1. WHEN does the JSON highlighter trigger? Whole line must be valid JSON? Or does it find embedded JSON substrings inside a longer line (e.g. INFO: {"a":1} done)? Test prefixes/suffixes, multiple JSON objects on one line, JSON after a log prefix, arrays, nested objects, bare numbers, bare true/false/null, bare strings, empty object/array.
2. The EXACT re-serialization format: spacing after opening brace, before closing brace, after colon, after comma, inside square brackets, for empty {} and [], for nested structures. Does it preserve key order? Does it preserve number formatting (1.50, 1e5, -0)? How are unicode escapes and escaped quotes/backslashes/newlines/tabs handled - preserved verbatim or re-escaped? Duplicate keys? Very large numbers / precision?
3. EXACT colors for: opening/closing braces and brackets, colon, comma, key quotes, key text, string-value quotes, string-value text, number values, true/false/null values, nested keys.
4. Does the content of string values get re-highlighted by other highlighters (dates, numbers, urls)? What about number values, are they passed to the numbers highlighter? Test with --enable json alone vs with others.
5. Interaction with the surrounding line (is the non-JSON part still highlighted normally?).
6. Invalid JSON: trailing comma, single quotes, unquoted keys, NaN, truncated. What happens?
7. Report EXACT byte-for-byte output for at least 25 varied test inputs.
Write spec to /tmp/t/specs/json.md`,
  },
  {
    key: 'dates',
    spec: '/tmp/t/specs/dates.md',
    task: `Characterize the DATE and TIME highlighter(s) of tspin (group name: dates).
Known starting facts:
- 2023-10-02 becomes E[35m2023E[0mE[2m-E[0mE[35m10E[0mE[2m-E[0mE[35m02E[0m  (numbers magenta 35, separators dim 2)
- 2023/10/02 also matches (slash separators)
- 00:30:00 becomes E[34m00E[0mE[2m:E[0mE[34m30E[0mE[2m:E[0mE[34m00E[0m (blue 34, dim separators)
- 00:30:00.123 and 00:30:00,123 and 00:30:00:123 all highlight the fractional part blue with a dim separator
- 00:30:00, (trailing comma, no digits) still gets a dim comma
- 2023-10-02T11:47:39Z : the T is RED (31) and the trailing Z is RED (31)
- "x 00:30:00" : the SPACE before the time is RED (31)
- 00:30 (no seconds) is NOT matched as a time (the numbers highlighter colors 00 and 30 cyan instead)

Determine exhaustively (use --enable dates to isolate):
1. Exact date grammar: how many digits per field? Are 2023-1-2, 23-10-02, 10-02-2023, 2023-10-02-05 matched? Which separators (dash, slash, dot, space)? Mixed separators? Year-first only? Is there a month-name form (Aug 14, 14 Aug 2023, Mon, 02 Jan 2006)? Test month names and weekday names.
2. Exact time grammar: is HH:MM:SS required? 1-digit hours? more than 2 digits? 25:99:99? Fractional separator set and allowed digit count. Any HH:MM-only context?
3. The date/time joiner: which characters can be the red separator between date and time (space, T, t, comma, nothing)? Is the red separator matched even without a date present (yes for space) - what about a lone T before a time, e.g. xT00:30:00? What about a tab?
4. Timezone suffix: Z, z, +01:00, -0500, UTC, GMT - which are highlighted and in what color?
5. Are date and time separate highlighter entries or one? Does --enable dates cover both? Is there a separate group name for time?
6. Word-boundary behavior: a2023-10-02, 2023-10-02b, 12023-10-02, 2023-10-021, and same for times.
7. Report exact byte-for-byte output for at least 40 varied inputs.
Write spec to /tmp/t/specs/dates.md`,
  },
  {
    key: 'numbers-pointers-uuid',
    spec: '/tmp/t/specs/numbers-pointers-uuid.md',
    task: `Characterize the NUMBERS, POINTERS and UUIDS highlighters of tspin.
Known starting facts:
- numbers: 123 becomes E[36m123E[0m (cyan 36). 3.14159 becomes E[36m3.14159E[0m as ONE unit. abc123 is not matched.
- pointers: 0x8c2a0aeb becomes E[3;34m0E[0mE[31mxE[0m then each hex char individually: digits E[3;34m (italic blue), a-f letters E[3;35m (italic magenta). Requires EXACTLY 8 or 16 hex digits (7, 9 through 15, 17+, and 6 do NOT match). For 16 digits a DIM BULLET separator E[2m + U+2022 + E[0m is inserted after the 8th digit. 0X uppercase works and the X is red.
- uuids: 5f7d1bce-81ab-4a87-af78-9a37f26c58b1 becomes each hex char individually, digits E[3;34m, letters E[3;35m, dashes E[31m.

Determine exhaustively (use --enable numbers / --enable pointers / --enable uuids to isolate):
NUMBERS:
1. Exact grammar: sign? leading plus/minus? decimals (.5, 5., 1.2.3)? exponent (1e5, 1E-5)? thousands separators (1,000)? hex/octal/binary literals? underscores?
2. Boundary rules: what characters may precede/follow? Test a1, 1a, _1, 1_, -1, +1, (1), 1%, v1, 1.2.3.4, x=1, 1st, 1-2, 1/2.
3. Is there any digit-grouping/bullet separator for long numbers?
POINTERS:
4. Confirm allowed lengths exactly (test 1 through 40 hex digits). Uppercase hex digits A-F? Mixed case? What color do uppercase A-F get?
5. Boundary: a0x12345678, 0x12345678a, 00x12345678, 0x12345678. followed by punctuation.
6. Where exactly is the bullet inserted for 16 digits? Confirm it is U+2022 and give the exact UTF-8 bytes.
UUIDS:
7. Exact grammar: 8-4-4-4-12 only? Are other groupings matched? Uppercase letters get which color? Are non-hex letters rejected? Braces or urn: prefix? Boundary characters before/after.
8. Report exact byte-for-byte output for at least 45 varied inputs across the three groups.
Write spec to /tmp/t/specs/numbers-pointers-uuid.md`,
  },
  {
    key: 'ip',
    spec: '/tmp/t/specs/ip.md',
    task: `Characterize the IP-ADDRESSES highlighter of tspin (group: ip-addresses).
Known starting facts:
- IPv4 10.0.0.123 : each octet E[3;34m (italic blue), each dot E[31m (red).
- IPv6 2001:db8:0:0:0:ff00:42:8329 : each hex CHARACTER individually - digits E[3;34m, letters E[3;35m, colons E[31m. Groups are NOT wrapped per-group; each char gets its own escape pair.
- 2001:db8::ff00:42:8329 : the double colon becomes two separate red colons E[31m:E[0mE[31m:E[0m
- fe80::1ff:fe23:4567:890a%eth0 : the %eth0 zone is NOT highlighted
- [2001:db8:85a3::8a2e:370:7334]:8080 : brackets not highlighted, 8080 handled by numbers
- 2001:db8:85a3::8a2e:192.0.2.33 : embedded IPv4 tail is highlighted with red dots

Determine exhaustively (use --enable ip-addresses to isolate):
1. IPv4 grammar: are octets validated (999.999.999.999? 1.2.3? 1.2.3.4.5? leading zeros 010.1.1.1?). Boundary chars before/after (a1.2.3.4, 1.2.3.4a, 1.2.3.45, v1.2.3.4). Is a CIDR suffix /24 highlighted? Is a port :8080 included?
2. IPv6 grammar: all forms - full 8 groups, compressed, leading ::1, trailing 1::, lone ::, IPv4-mapped ::ffff:192.0.2.1, uppercase hex (which color for A-F?), too many groups, invalid groups (5 hex chars), zone id.
3. Does the IPv6 matcher ever mis-fire on things like 08:11:36 times or a:b:c? Check interaction and required minimum group count.
4. Colors: confirm exact codes for digit vs letter vs separator for both v4 and v6.
5. What about MAC addresses aa:bb:cc:dd:ee:ff?
6. Report exact byte-for-byte output for at least 40 varied inputs.
Write spec to /tmp/t/specs/ip.md`,
  },
  {
    key: 'url-paths',
    spec: '/tmp/t/specs/url-paths.md',
    task: `Characterize the URLS and PATHS highlighters of tspin.
Known starting facts:
- URL http://example.com/path/to/resource?param1=value1&param2=value2 becomes
  E[2;31mhttpE[0m then the literal :// UNCOLORED, then E[2;34mexample.comE[0m, then E[34m/path/to/resourceE[0m, then E[31m?E[0m E[35mparam1E[0m E[31m=E[0m E[36mvalue1E[0m E[31m&E[0m E[35mparam2E[0m E[31m=E[0m E[36mvalue2E[0m
- scheme http is dim red (2;31), https is dim green (2;32)
- PATHS: /usr/local/bin/ becomes E[33m/E[0mE[32musrE[0mE[33m/E[0mE[32mlocalE[0mE[33m/E[0mE[32mbinE[0m followed by a PLAIN trailing slash. ~/project/user becomes E[32m~E[0mE[33m/E[0m...

Determine exhaustively (use --enable urls / --enable paths to isolate):
URLS:
1. Which schemes are recognized (http, https, ftp, ws, wss, file, custom)? What color for non-http(s)? Confirm byte-exactly that :// is uncolored.
2. Host: userinfo (user:pass@host), port (:8080 - what color?), IP host, IPv6 host in brackets.
3. Path color, query color rules, fragment (#frag) color, query with no value (?a), ?a=, ?a=b&c, repeated &&, semicolon separators, url-encoded chars.
4. Where does the URL match END? Trailing punctuation like . , ) after the URL. Whitespace. Quotes.
5. A url with no path: https://example.com  --- note that the input key=https://example.com produced a trailing EMPTY escape pair E[34mE[0m; investigate that carefully and characterize exactly when an empty escape pair is emitted.
PATHS:
6. Exact grammar: must start with / or ~/? Relative paths (./x, ../x, a/b)? Windows paths? Minimum number of segments? Single /? Double //? Trailing slash behavior. Characters allowed in a segment (dots, dashes, underscores, spaces, unicode, percent, plus, colon, at).
7. Where does a path match end - stop chars. Does module_service.go:59 match? Does /a/b:c match?
8. Colors: separator slash is 33 (yellow), segment 32 (green), leading tilde 32. Confirm and check anything else.
9. Report exact byte-for-byte output for at least 40 varied inputs across both groups.
Write spec to /tmp/t/specs/url-paths.md`,
  },
  {
    key: 'quotes-kv',
    spec: '/tmp/t/specs/quotes-kv.md',
    task: `Characterize the QUOTES and KEY-VALUE-PAIRS highlighters of tspin.
Known starting facts:
- x "abc" y : the whole quoted span INCLUDING the quote chars becomes yellow E[33m"abc"E[0m.
- x "abc 123" y : NOT yellow, because the numbers highlighter already colored 123 (numbers run BEFORE quotes and already-highlighted regions block a later match).
- x "" y becomes E[33m""E[0m (matches empty).
- x """ y : no match.
- kv: ts=08:11:36 becomes E[2mtsE[0m (dim key) E[37m=E[0m (white equals) then the value highlighted by other highlighters.

Determine exhaustively (use --enable quotes / --enable key-value-pairs to isolate; also test with everything else disabled to remove blocking effects):
QUOTES:
1. Which quote characters? double only, or also single/backtick? Escaped quotes inside (backslash-quote)?
2. Greedy vs lazy: "a" b "c" - two matches or one? "a"b"c" ?
3. Can the quoted span contain tabs? Very long spans? Unbalanced quotes at end of line?
4. Exact color: is it E[33m...E[0m wrapping the entire token including quotes? Confirm.
5. How does it interact with already-highlighted inner content (state the blocking rule precisely with several examples).
KEY-VALUE:
6. Exact key grammar: which characters allowed in the key (letters, digits, underscore, dash, dots, colons)? Must the key start at a word boundary / start of token? Is whitespace allowed around the equals sign?
7. Is the VALUE part of the match at all, or does the highlighter only color key and equals? Test key= with nothing after, key==v, a=b=c, =v, "k =v", "k= v".
8. Exact colors: key dim E[2m, equals white E[37m. Confirm and test whether the value is left completely untouched.
9. Nested: k1=v1 k2=v2, k1=k2=v, keys with dots a.b=c, keys with brackets, unicode keys.
10. Report exact byte-for-byte output for at least 40 varied inputs across both groups.
Write spec to /tmp/t/specs/quotes-kv.md`,
  },
  {
    key: 'processes-keywords',
    spec: '/tmp/t/specs/processes-keywords.md',
    task: `Characterize the PROCESSES highlighter and the BUILTIN KEYWORD groups of tspin.
Known starting facts:
- processes: kernel[0]: becomes E[33mkernelE[0m (yellow name) E[31m[E[0m (red bracket) E[36m0E[0m (cyan pid) E[31m]E[0m. Also (udev-worker)[1] matched with the parens INSIDE the yellow name: E[33m(udev-worker)E[0m.
- keywords: INFO is E[37m (white), WARN is E[33m (yellow), ERROR is E[31m (red), DEBUG is E[32m (green), TRACE is E[2m (dim). WARNING/FATAL/lowercase did NOT match in a quick test - verify thoroughly.
- booleans/nulls: true, false, null all appeared as E[3;31m (italic red) - verify each separately and check case sensitivity.
- REST verbs: GET becomes E[42;30m GET E[0m (green bg, black fg, with a leading and trailing SPACE inside the highlight), POST is E[43;30m, PUT is E[45;30m, PATCH is E[45;30m, DELETE is E[41;30m. HEAD/OPTIONS/CONNECT did not match - verify.

Determine exhaustively:
1. PROCESSES: exact grammar of the process name (allowed chars: letters, digits, dash, underscore, dot, slash, parens?). Must it be immediately followed by [digits]? Is a trailing colon required? Test name[abc], name[], "name [1]", name[1] without colon, "na me[1]", position requirements (start of line only?), /usr/bin/foo[12]:
2. KEYWORDS: enumerate the COMPLETE set of severity keywords and their colors. Test many candidates: TRACE, DEBUG, INFO, INFORMATION, NOTICE, WARN, WARNING, ERROR, ERR, CRITICAL, CRIT, FATAL, ALERT, EMERG, PANIC, SEVERE, FINE, FINER, FINEST, VERBOSE, and lowercase/mixed-case variants of each, and with surrounding brackets/punctuation. Also check word-boundary behavior (INFOX, XINFO, INFO:, [INFO], -INFO-).
3. Verify whether severity keywords are bold/plain and whether there is any background color or padding.
4. BOOLEANS/NULLS: test true/false/True/False/TRUE/FALSE/null/NULL/Null/nil/None/none/undefined/NaN and N/A. Give exact colors for each that matches.
5. REST verbs: test GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS/TRACE/CONNECT/get/Get, and word boundaries. Exact background+fg codes and exact padding spaces. Does surrounding whitespace in the input get consumed or is the space part of the highlight only?
6. Verify --disable-builtin-keywords turns off exactly (booleans, nulls, severities, REST verbs) and nothing else.
7. Determine whether keyword highlighting is affected by --enable/--disable lists.
8. Also characterize the --highlight COLOR:word1,word2 flag: exact colors produced for red/green/yellow/blue/magenta/cyan, case sensitivity, word boundary behavior, multiple flags, invalid color error text, empty word list, words with regex metacharacters or spaces.
9. Report exact byte-for-byte output for at least 60 varied inputs.
Write spec to /tmp/t/specs/processes-keywords.md`,
  },
  {
    key: 'order',
    spec: '/tmp/t/specs/order.md',
    task: `Determine the EXACT ORDER in which tspin applies its highlighters, and the EXACT semantics of the "already highlighted region blocks later matches" rule.
Groups: numbers, urls, pointers, dates, paths, quotes, key-value-pairs, uuids, ip-addresses, processes, json, plus builtin keyword groups (severities, booleans/nulls, REST verbs) and user --highlight words.

Method: construct inputs where two groups' matches OVERLAP, run with only those two enabled, and see which one wins. Do this for every interesting pair. Then derive the total order.
Known facts to build on:
- json runs before numbers (a bare "abc 123" line: json wins on the quotes, numbers still colors 123 inside)
- numbers runs before quotes (x "abc 123" y : numbers wins, quotes blocked)
- dates run before numbers (00:30:00 : time colors win over per-number cyan)

Also determine:
1. The precise blocking rule: if a candidate match partially overlaps an already-highlighted region, is the whole match discarded, or is it shifted/truncated? Give evidence.
2. Does a later highlighter search INSIDE the un-highlighted gaps only? Confirm that highlighting is done on segments, and whether a match can span across a previously highlighted region.
3. Where do user --highlight red:word matches sit in the order (before or after builtin ones)? And can they be blocked / can they block?
4. Where do severity keywords / booleans / REST verbs sit relative to the regex groups?
5. Does the order of --enable a,b on the command line change application order? Does the order of multiple --highlight flags matter?
6. Test three-way overlaps.
7. Provide the final total order as an ordered list, with the evidence for each adjacent pair.
Write spec to /tmp/t/specs/order.md`,
  },
  {
    key: 'config',
    spec: '/tmp/t/specs/config.md',
    task: `Reverse-engineer the CONFIGURATION FILE (theme.toml) schema of tspin, via --config-path.
Known facts:
- --config-path missing.toml prints to stderr: "Error:   " then U+00D7 then " could not find the TOML file" followed by a blank line, exit 1. Capture the EXACT bytes.
- A TOML syntax error prints a miette diagnostic with the parse error, line/column, a source snippet, exit 1. Reproduce the EXACT bytes for several error kinds.
- Unknown top-level keys are IGNORED (no error).
- This works:
    [[keywords]]
    words = ['foo']
    style = { fg = 'red' }
  and turns "a foo b" into "a E[31mfooE[0m b"

Determine exhaustively:
1. The complete set of config sections/keys. Try plausible names and see which change behavior. Strong candidates: [date], [time], [number], [url], [path], [uuid], [ip], [pointer], [process], [key_value], [quotes], [json], [severity], [[keywords]], and nested style tables. Try both snake_case and kebab-case. For each highlighter find every sub-key that changes a color (e.g. for uuid: number, letter, separator; for url: http, https, host, path, query_params_key, query_params_value, symbols; for date: number/separator; for process: name/id/separator; for key_value: key/separator; for json: key/value etc).
2. The STYLE object grammar: keys like fg, bg, bold, italic, underline, faint/dim, strikethrough? Which color names are accepted (red, green, yellow, blue, magenta, cyan, white, black, bright variants, "default", numbers 0-255, hex "#ff0000")? What ANSI codes does each produce, and in what order are the SGR attributes emitted? What error is emitted for an invalid color?
3. [[keywords]] entries: keys words, style, and is there a border or case-insensitivity or regex key? Do multiple [[keywords]] entries work? What order are they applied in?
4. Is there a way to disable a highlighter from the config (e.g. disabled = true)?
5. Are there top-level non-highlighter settings? Try [settings], pager, follow, print.
6. What happens with a wrong TYPE (e.g. words = 'foo' instead of a list, style = 'red')? Give exact error text.
7. Default config path resolution: XDG_CONFIG_HOME/tailspin/theme.toml then ~/.config/tailspin/theme.toml. Verify by creating those files (use a temp HOME and XDG_CONFIG_HOME so you do not pollute the real home dir).
8. Report exact byte-for-byte outputs and error texts.
Write spec to /tmp/t/specs/config.md`,
  },
  {
    key: 'cli',
    spec: '/tmp/t/specs/cli.md',
    task: `Characterize the COMMAND-LINE INTERFACE and I/O behavior of tspin exhaustively.
Known facts:
- --version and -V print: tspin 5.6.0
- --help and -h produce different (long/short) clap-style help; capture BOTH byte-exactly. The program name shown is "executable" (argv[0] basename).
- Without -p and with a FILE argument, output is written to a temp file /tmp/.tmpXXXXXX/tailspin.temp.<uuid-v4> and a pager is spawned: default: less --ignore-case --RAW-CONTROL-CHARS -- <file> ; with -f it is: less +F --ignore-case --RAW-CONTROL-CHARS -- <file>. The env var LESSSECURE=1 is added to the pager environment.
- --pager "cmd [FILE]" or the TAILSPIN_PAGER env var overrides it, with [FILE] substituted.

Determine exhaustively:
1. Byte-exact --help and -h output; exit codes. Also the output for an unknown flag, a bad value for --enable/--disable/--highlight, a missing value, too many positional args. Capture exact stderr text and exit codes (clap error formatting, tip lines, usage lines).
2. stdin behavior: does piped stdin always print to stdout (never pager)? What if both stdin is piped AND a file argument is given? What if stdin is a TTY and no file is given (does it hang / print help / error)? Try using python3 with a pty (pty.openpty / pty.spawn) to test TTY behavior.
3. Nonexistent file argument: exact error text and exit code. Directory as argument. Unreadable file (chmod 000). Empty file. Named pipe (FIFO).
4. Binary/invalid-UTF-8 input: what happens (lossy conversion? passthrough? error?). Very long lines (1MB). CRLF line endings. A final line with no trailing newline (is a newline added?). NUL bytes. Tabs. Lone CR.
5. Input that already contains ANSI escape codes: preserved? stripped? re-highlighted?
6. -f / --follow with a file: what does -p -f do (follow and print, keep running)? Test appending to a file while it follows (background processes + timeouts). Does it detect truncation/rotation? Does -f without -p and without a file work?
7. -e/--exec: how is the command parsed (shell or argv split)? Is -p honored? Does the command's stderr get included? Exit code propagation. Test --exec 'echo hi', -e 'sh -c "echo a; echo b"', a command that fails, and confirm whether follow is implied.
8. --pager: exact substitution rule for [FILE], what if [FILE] is missing from the string, quoting/splitting rules of the pager command, what if the pager command does not exist (exact error). Does TAILSPIN_PAGER take priority over --pager?
9. Multiple file arguments (help says [FILE] singular): exact error text.
10. Exact temp dir/file naming pattern. Is the temp file deleted afterwards? Permissions?
11. Exit code when the pager exits non-zero. Behavior on SIGINT.
12. Does the tool flush per line? Test with a slow producer piped in and see whether output appears incrementally (use timeouts).
13. Does it respect NO_COLOR or TERM=dumb? (NO_COLOR=1 is already set in this environment and colors still appear - confirm and test unsetting it.)
Write spec to /tmp/t/specs/cli.md`,
  },
];

phase('Probe')
const results = await pipeline(
  AREAS,
  (a) => agent(RULES + "\n\nYOUR TASK:\n" + a.task, { label: `probe:${a.key}`, phase: 'Probe' }),
  (summary, a) => agent(RULES + `\n\nA previous agent wrote a spec at ${a.spec} characterizing tspin behavior for area "${a.key}".
Your job is to be a COMPLETENESS CRITIC and FIXER:
1. Read ${a.spec}.
2. Independently VERIFY at least 20 of its concrete claims by running /workspace/executable yourself. Report any that are WRONG.
3. Find GAPS: cases a reimplementer would hit that the spec does not cover. Probe them.
4. UPDATE the file in place (Write/Edit) so it is correct and complete. Keep the existing structure; add a "## Corrections and additions (critic pass)" section AND fix wrong claims inline.
Your final message: list of corrections made and remaining unknowns (at most 40 lines).`, { label: `critic:${a.key}`, phase: 'Critique' })
);

return { areas: AREAS.map(a => a.key), critiques: results.filter(Boolean).length }
