export const meta = {
  name: 'probe-gron',
  description: 'Exhaustively characterize the reference gron binary behavior into precise spec files',
  phases: [
    { title: 'Probe', detail: 'one agent per behavioral dimension, writes a spec file' },
    { title: 'Critic', detail: 'find gaps and unverified claims in each spec' },
    { title: 'Fill', detail: 'close the gaps found by the critics' },
  ],
}

const RULES = `
## Hard rules (benchmark constraints — violating them fails the task)
- The ONLY source of truth is running \`/workspace/executable\` and reading /workspace/README.mkd and /workspace/ADVANCED.mkd.
- You MUST NOT search the web, look for the project's source code, clone repos, use any package manager to fetch the project or its libraries, or read cached module sources.
- You MUST NOT disassemble, decompile, or run objdump/nm/readelf/strings/gdb/strace/ltrace on /workspace/executable. No binary inspection of any kind. Interact only via CLI/stdin/stdout.
- Do not try to install anything. There is no network access.

## Environment notes
- \`NO_COLOR=1\` and \`TERM=dumb\` are set in the environment; they suppress color. To see color output use the helper \`/tmp/probe/g\` (a wrapper that runs the executable with NO_COLOR unset and TERM=xterm) and pipe through \`cat -v\` or \`xxd\`.
- To test TTY-dependent behavior, use \`python3 /tmp/probe/ptyrun.py <args...>\` which attaches stdout to a pty (it also unsets NO_COLOR and sets TERM=xterm) and prints repr() of stdout, stderr and the exit code.
- Always report the exit code (\`echo "exit=$?"\`) and distinguish stdout from stderr (\`2>/dev/null\` / \`1>/dev/null\`).
- Use \`xxd\` or \`od -c\` or \`cat -A\` when exact bytes / trailing newlines matter. ALWAYS determine whether output ends with a newline.
- Work in your own scratch dir, e.g. /tmp/probe/work-<yourdim>, so you don't collide with other agents.

## Deliverable
Write your findings to the exact file path given below, as precise Markdown.
Requirements for the spec file:
- Be exhaustive and unambiguous: someone must be able to reimplement this behavior from your file alone, without re-running the binary.
- Every claim must be backed by an actual command you ran. Include the literal command and the literal observed output for the important cases.
- State exact error message text (byte-for-byte), which stream it goes to (stdout/stderr), and the exit code.
- Where you inferred a general rule, say what you tested and note residual uncertainty explicitly.
- Prefer tables/enumerations of rules over prose.
Then return a SHORT (max 25 line) summary of the most important/surprising findings plus the file path. Do not paste the whole spec into your return value.
`;

const DIMS = [
  {
    key: 'values',
    file: '/tmp/probe/spec/01-value-formatting.md',
    prompt: `Characterize exactly how gron renders the right-hand side VALUE of each assignment in default (gron) mode.

Cover:
1. Numbers: are they echoed verbatim from the input token, or reformatted? Test integers, floats, exponent forms (1e10, 1E10, 1e+10, 3.0e2), negative, -0, leading zeros are invalid JSON so check the error, very long digit strings, very large/small exponents, 1.0, 0.30000000000000004, huge ints beyond int64/float64. Determine precisely whether any normalization happens.
2. Booleans and null.
3. Strings: determine the EXACT escaping rules for output. Do a systematic sweep of every code point that matters. Suggested method: use python3 to generate JSON containing one code point per key, run gron, and diff against your model. Check: which chars get short escapes (\\\\b \\\\f \\\\n \\\\r \\\\t \\\\" \\\\\\\\), which get \\\\uXXXX (and whether hex digits are UPPER or lower case), which pass through literally. Test all of 0x00-0xFF plus U+0100, U+00A0, U+2028, U+2029, U+2027, U+202A, U+FEFF, U+FFFD, U+FFFF, U+10000, U+10FFFF, and unpaired surrogates written as \\\\uD800 in the input.
   Also test whether '<' '>' '&' are escaped, whether '/' is escaped, and whether input escapes like \\\\u0041 are decoded and re-encoded (i.e. is the output canonicalized?).
4. Invalid UTF-8 bytes in the input string (raw bytes, not escapes) - what comes out? Test a lone 0x80, 0xC3 with no continuation, overlong encodings, truncated multi-byte at EOF.
5. Empty string, string that is only escapes.
6. What does the LHS look like for a nested empty object/array vs a non-empty one - confirm the exact placeholder text used ({} and []) and confirm containers always get their own statement.

${RULES}`,
  },
  {
    key: 'keys',
    file: '/tmp/probe/spec/02-path-formatting.md',
    prompt: `Characterize exactly how gron renders the left-hand side PATH of each assignment in default (gron) mode.

Cover:
1. The exact rule deciding whether an object key is rendered bare (\`json.foo\`) or bracket-quoted (\`json["foo"]\`). I already know it is roughly "valid JS identifier". Pin it down precisely with a systematic sweep:
   - Which ASCII characters are legal as the FIRST character vs subsequent characters? Sweep all of 0x21-0x7E individually.
   - Non-ASCII: test letters from many scripts (Latin-1 accented, Greek, Cyrillic, Han, Hiragana, Hebrew, Arabic, Devanagari), combining marks (U+0301), digits from other scripts (Arabic-Indic U+0660, Devanagari U+0966), symbols (emoji, U+00A9, U+20AC currency, U+2603), punctuation-ish letters (U+00AA feminine ordinal, U+02B0 modifier letter, U+3005), U+00B7 middle dot, U+200C/U+200D ZWNJ/ZWJ, U+FF10 fullwidth digit, U+FF21 fullwidth A.
   - Determine which Unicode categories are accepted for first vs subsequent chars (e.g. is it Letter only, or Letter+Nl+Mn+Mc+Nd+Pc, does it include \`$\` and \`_\`?). Say clearly which categories you verified and which you could not distinguish.
   - Are JS reserved words (if, for, class, true, null, function, var, return, this, new, delete, typeof, in, instanceof, undefined) rendered bare or quoted?
   - Empty key.
2. When a key IS bracket-quoted, is the quoted string escaped by the same rules as a string value? Test keys with newlines, quotes, backslashes, control chars, non-BMP chars, invalid UTF-8.
3. Array indices: format for 0, single digit, multi digit, very large arrays (check index >= 10, >= 100).
4. The root identifier: is it always literally \`json\`? Can it be changed by any flag or env var? (test any plausible flag; report what you tried)
5. Confirm exact separator text and spacing: \`json.a.b = value;\` - spaces around \`=\`, trailing \`;\`, and the line terminator (\\n vs \\r\\n).
6. Whether a top-level scalar / array / object at the root produces \`json = ...;\` and what the very first statement is in each case.

${RULES}`,
  },
  {
    key: 'sort',
    file: '/tmp/probe/spec/03-sorting.md',
    prompt: `Characterize gron's output ORDERING precisely (default sorted mode, and --no-sort).

Known starting point: statements appear sorted; array indices sort numerically (json[9] before json[10]) but object keys with numeric-looking names sort lexically (a1, a10, a100, a9). Bare-key statements sort before bracket-quoted ones at the same depth.

Your job: determine the EXACT comparison function. Hypothesis to test and refine: statements are compared token-by-token along the path; when both tokens at a position are numeric array indices they compare numerically, otherwise the token text compares bytewise/lexically. But it might instead be a single "natural sort" over the whole rendered line (digit runs compared numerically). DESIGN EXPERIMENTS THAT DISTINGUISH THESE:
 - An object key like "a10" vs "a9" (already known: lexical -> suggests NOT whole-line natural sort... but verify with more cases, e.g. keys "x2y" vs "x10y", and quoted keys "10" vs "9").
 - A key that is bare and purely a valid identifier containing digits.
 - Array of arrays with 2-digit indices at several depths, e.g. 12 elements each containing 12 elements.
 - Mixed: object whose keys make some statements shorter prefixes of others (json.a vs json.a.b vs json.ab) - is a shorter path always before a longer one that extends it?
 - Compare \`json.a\` vs \`json["a b"]\` vs \`json[0]\` in ungron input order (you can feed hand-written gron statements to \`--ungron\` and also re-gron output to observe ordering; but for gron mode you must construct real JSON).
 - Determine tie-breaking / stability: duplicate keys in the input JSON object (e.g. {"a":1,"a":2}) - what happens?
 - Case sensitivity: keys "B" vs "a" vs "A" vs "b".
 - Test how a key containing a literal '.' or '[' interacts (it gets quoted, so ordering is by the rendered token).
 - Depth-first vs breadth: does \`json.a = {}\` come immediately before \`json.a.x\`? Where does \`json.ab\` land relative to \`json.a.x\`? Construct {"a":{"x":1},"ab":2} and {"a":{"x":1},"a.b":2} etc.
Also carefully test --no-sort: what order do statements come out in? Is it document order? For objects, is it Go map iteration order (i.e. RANDOM between runs)? Run the same input 20 times with --no-sort and report whether the output is stable or varies. Test arrays with --no-sort. Report whether containers come before their children.
Also check whether --no-sort affects --json mode and --stream mode, and whether the flag has a short form.

Provide the comparison function as pseudocode precise enough to implement, and list the experiments that pin down each branch.

${RULES}`,
  },
  {
    key: 'cli',
    file: '/tmp/probe/spec/04-cli-parsing.md',
    prompt: `Characterize gron's command-line argument parsing and top-level behavior exhaustively.

Cover:
1. The exact --help / -h output (byte for byte, including trailing newline) and which stream it goes to and the exit code. Is there a --help vs -h difference? What about no args at all with a TTY stdin vs piped stdin vs closed stdin?
2. --version / exact text and exit code. Any -V short form?
3. Every documented flag: -u/--ungron, -v/--values, -c/--colorize, -m/--monochrome, -s/--stream, -k/--insecure, -x/--proxy, --noproxy, -j/--json, --no-sort, --version. For each: does the short form exist, does it take a value, what forms are accepted (--flag=value, --flag value, -xvalue, -x value)?
4. Are short flags clusterable (-um, -uc, -jm)? Are unknown flags an error - what is the exact message, stream, exit code? Test -z, --bogus, --ungrn (typo), -- (bare double dash), --=x, empty string argument "".
5. Can flags appear AFTER the file argument (gron file.json -m)? Interspersed?
6. What happens with MULTIPLE non-flag arguments (gron a.json b.json)? Exact message/exit code.
7. Precedence and interaction of conflicting flags: -c -m together (both orders), -u -j, -u -v, -v -j, -s -u, -s -j, -s -v, -u -s. Which wins? Does -v -j produce nothing (I observed that) - characterize exactly what -v does with --json input and with gron input.
8. Reading from "-" explicitly, and from stdin implicitly. Is "-" treated as stdin in all modes?
9. Does argument order matter for -c/-m relative to each other?
10. Behavior when stdin is a TTY and no file given (use ptyrun.py, but note it only makes STDOUT a tty; try \`python3 -c\` with pty for stdin too, or just report what you can).
11. Does it respect any environment variables (NO_COLOR, TERM, CLICOLOR, CLICOLOR_FORCE, GRON_*, HTTP_PROXY/HTTPS_PROXY/NO_PROXY)? Test NO_COLOR="" vs NO_COLOR=0 vs unset, TERM=dumb vs xterm vs unset, with and without -c, both piped and via pty.

${RULES}`,
  },
  {
    key: 'input-errors',
    file: '/tmp/probe/spec/05-input-and-errors.md',
    prompt: `Characterize gron's INPUT handling and all error messages / exit codes in gron (forward) direction.

Cover, with exact byte-for-byte messages, the stream they are written to, and exit codes:
1. Nonexistent file. Unreadable file (chmod 000). A directory as the argument. A named pipe/fifo. /dev/null. An empty file. A file with only whitespace.
2. Invalid JSON of many kinds: truncated object, trailing comma, single quotes, unquoted keys, bare word, \`{}{}\` (two values), \`{} garbage\`, \`{}\` followed by whitespace/newlines only, NaN, Infinity, leading zeros (01), \`.5\`, \`5.\`, \`+1\`, control char inside string, unterminated string, bad \\\\u escape, lone surrogate. Report the EXACT error text for each - I need to reproduce the wording, including whether it embeds Go-style json error phrasing like "invalid character 'x' looking for beginning of value" and any offset numbers.
3. A UTF-8 BOM at the start of the file. A UTF-16 file.
4. Top level scalars: \`5\`, \`"str"\`, \`true\`, \`null\`, \`[]\`, \`{}\`, and whether a trailing newline in the file matters.
5. Multiple JSON values concatenated without --stream (e.g. \`{"a":1}\\n{"b":2}\`) - is it an error? Exact message?
6. Very deeply nested JSON (e.g. 100000 nested arrays) - stack overflow? error? Report.
7. Duplicate keys in an object.
8. Huge input performance sanity (e.g. 20MB) - just confirm it completes, note rough time.
9. Whether gron output always ends with a newline; whether empty output happens for any valid input.
10. Exit code table verification: try to trigger each documented exit code 1 (failed to open file), 2 (failed to read input), 3 (failed to form statements), 4 (failed to fetch URL), 5 (failed to parse statements), 6 (failed to encode JSON). Say which you could trigger and how, exact stderr text for each. Note the general shape of error messages (prefix? capitalization? does it include the underlying error?).
11. Does it print errors to stderr and nothing to stdout, or partial output then error?

${RULES}`,
  },
  {
    key: 'json-mode',
    file: '/tmp/probe/spec/06-json-mode.md',
    prompt: `Characterize gron's --json / -j mode fully, in BOTH directions.

Cover:
1. Forward (gron --json): the exact output format. It looks like one JSON array per line: [[path...],value]. Determine:
   - How path elements are represented: object keys as JSON strings, array indices as bare numbers? Confirm with keys that look numeric ("0") vs actual array indices.
   - Is the root statement [[],{}]? What for a top-level scalar?
   - Exact separators/spacing (no spaces after commas?), and how the value is encoded - is it the verbatim number token or reformatted? Test 1.0, 1e10, huge ints, and strings with escapes/unicode/invalid UTF-8. Compare to non-json mode escaping: is the STRING escaping the same rules (uppercase \\\\uXXXX etc.) in --json mode? Test <, >, &, U+2028, 0x7F.
   - Ordering: same sort as normal mode? Does --no-sort apply?
   - Trailing newline behavior.
   - Empty object/array values: are they rendered as {} and []?
2. Reverse (gron --json --ungron): parsing the JSON-stream form back to JSON. Determine:
   - What input is accepted. Blank lines. Extra whitespace. Pretty-printed multi-line JSON arrays as input. Lines that are not arrays. Wrong arity ([[]] or [[],1,2]). Path elements of wrong type (true, null, nested array, object, float index like 1.5, negative index, huge index).
   - Whether the whole input must be a stream of one-per-line values or whether a single JSON array of statements works.
   - Exact error messages and exit codes for each malformed case.
   - Does it sort keys in output? Merge semantics (same as normal ungron?). Array padding with null?
   - Does --json --ungron respect -c (colorize)?
3. --json with --stream (both forward and reverse).
4. --json with --values.
5. Whether -j alone with gron-format (non-json) input on stdin does anything sensible in ungron mode, and what error appears.

${RULES}`,
  },
  {
    key: 'ungron-lex',
    file: '/tmp/probe/spec/07-ungron-lexing.md',
    prompt: `Characterize the LEXER/PARSER for \`gron --ungron\` (statement -> path+value) with extreme precision. This is the trickiest part of the tool, so be very thorough.

Feed hand-written text on stdin to \`/workspace/executable --ungron\` and record exactly what is accepted, what is rejected, the exact error message, stream, and exit code.

Determine:
1. Overall input model: is input split by lines, or by semicolons, or lexed as a whole? Can two statements be on one line (\`json.a = 1; json.b = 2;\`)? Can one statement span multiple lines (path on one line, value on the next)? What about a value containing a literal newline inside a string, or a multi-line JSON object as the value?
2. Leading identifier: must it be \`json\`? Is any identifier accepted (\`foo.bar = 1\`)? Is the FIRST path element dropped from the output? Test \`json = 1\`, \`x.y = 1\`, \`.a = 1\`, \`[0] = 1\`, \`["a"] = 1\`, \`json["a"] = 1\`, \` json.a = 1\` (leading space), \`\\tjson.a = 1\`.
3. Path syntax accepted: dotted bare keys (which characters allowed - is it the same identifier rule as output, or laxer? test dashes, spaces, digits-first, unicode, emoji), bracketed quoted strings with single quotes vs double quotes, bracketed numbers, bracketed unquoted words, bracketed negative/float numbers, empty brackets \`[]\`, nested/consecutive brackets, trailing dot, double dots \`a..b\`, whitespace inside brackets \`[ 0 ]\`, whitespace around dots \`a . b\`, escapes inside quoted keys (\\\\n, \\\\", \\\\uXXXX, \\\\/), unterminated quote/bracket.
4. The \`=\` sign: required spaces? \`json.a=1;\` \`json.a  =  1;\` \`json.a\\t=\\t1;\` multiple \`=\`. Missing \`=\`.
5. The value: which JSON values are accepted (object, array, string, number, true, false, null)? Non-JSON values (bare words, single-quoted strings, trailing garbage after value, \`undefined\`, \`NaN\`)? A value spanning multiple lines? Are numbers preserved verbatim in the output (test 1.0, 1e10, huge)?
6. The terminating semicolon: required or optional? Trailing whitespace after it? Multiple semicolons? Text after the semicolon on the same line?
7. Lines that don't look like statements at all: are they silently skipped or an error? (I saw \`hello world\` -> "no statements were parsed" exit 5, but \`json.a = 1\` without semicolon -> "ungron failed for \\\`json.a = 1\\\`: statement has no value" exit 5. Explain this difference precisely: which inputs are skipped vs which error.) Test: blank lines, comment-looking lines, lines with only whitespace, a line that is just \`json\`, \`json;\`, \`json =\`, \`json = ;\`, \`= 1;\`, \`json.a = 1;;\`, an empty file, a file of only newlines.
8. Whether the error message quotes the original line, and exactly how (backticks? the whole line including trailing whitespace/semicolon?). Enumerate every distinct error message you can produce and the input that produces it.
9. Whether it stops at the first bad statement or reports all; whether valid statements before/after a bad one are still processed.
10. Very long lines / very deep paths.
11. What happens with CRLF line endings, and with no trailing newline on the last line.
12. Whether the value parsing is strict JSON (e.g. does \`json.a = 'x';\` work? \`json.a = {a:1};\`?).

Enumerate findings as a table of input -> output/error. Be exhaustive; this spec must be implementable verbatim.

${RULES}`,
  },
  {
    key: 'ungron-merge',
    file: '/tmp/probe/spec/08-ungron-merge-output.md',
    prompt: `Characterize the MERGE and OUTPUT stage of \`gron --ungron\`: how parsed statements combine into one JSON document, and how that document is printed.

Cover:
1. Output formatting (monochrome, piped): exact indentation (2 spaces?), whether object keys are sorted, key/value separator (\`": "\`), array element layout, empty object/array rendering (\`{}\` vs \`{\\n}\`), trailing newline. Test nested structures several levels deep and empty containers at various depths.
2. String escaping in the ungron OUTPUT: is it the same rule set as gron mode (uppercase \\\\uXXXX, 0x7F-0x9F escaped, U+2028/9 escaped, <>& not escaped, / not escaped)? Test thoroughly - it may differ! Include invalid UTF-8 fed through a quoted string, and \\\\uD800 lone surrogates.
3. Number handling: are numbers echoed verbatim from the statement (1.0 stays 1.0, 1e10 stays 1e10, 300-digit integer preserved) or reformatted? Test carefully.
4. Merge semantics:
   - Same path assigned twice (\`json.a = 1; json.a = 2;\`) - last wins? first?
   - Scalar then object at same path (\`json.a = 1; json.a.b = 2;\`) and the reverse order.
   - Object then array (\`json.a = {}; json.a[0] = 1;\`), array then object.
   - Conflicts that error: I saw \`json[0] = 1; json.a = 2;\` -> \`failed to merge statements: cannot merge array with non-array\` exit 5. Enumerate ALL distinct merge error messages and the minimal input that triggers each (try also merging object with non-object, and at nested depths).
   - Missing intermediate containers: \`json.a.b.c = 1;\` alone (no parent statements) - are parents created?
   - Array index gaps -> null padding. Test index 0 and 5 only; test only index 3; test a huge index like 1000 and 100000 (memory?), and a very large index like 99999999999 (error? OOM? exact message).
   - Negative array index in a statement.
   - Root-level conflict: \`json = 1; json = 2;\`, \`json = 1; json.a = 2;\`, \`json = [];  json.a = 1;\`
   - Does the ROOT type come from the first statement or from the shape of the paths? (\`json.a = 1\` alone -> object; \`json[0] = 1\` alone -> array)
   - Statement order sensitivity: does shuffling the input lines change the result? Test with a script that shuffles a real gron output and re-ungrons, comparing to the unshuffled result.
5. Whether duplicate array indices, or an array with both \`[]\` container statement and elements, behave specially.
6. Interaction with -v/--values: what does --values print exactly (one value per line? how are non-scalar values printed? are strings unquoted? what about numbers, bools, null, objects, arrays?). Test \`json.a = {};\` and \`json.a = [1,2];\` and \`json.a = "with\\nnewline";\` under --values. Determine whether --values implies parsing statements and printing the raw value token or the decoded value.
7. Colorized (-c) ungron output: I observed it becomes COMPACT (no indentation) and uses a colorizing encoder. Verify: is it compact only when colorizing, or also indented? Capture the exact color codes for: braces/brackets, object key (including its quotes), the colon, the comma, string value (quotes vs content colored differently!), number, true/false, null, and empty containers. Report the exact byte sequences and whether there is a trailing newline. Also check -c with --json --ungron and -c with --values.

${RULES}`,
  },
  {
    key: 'stream',
    file: '/tmp/probe/spec/09-stream-mode.md',
    prompt: `Characterize gron's --stream / -s mode fully.

Cover:
1. Forward: each line of input treated as a separate JSON value, results wrapped in a top-level array (I observed \`json = [];\` then \`json[0]...\`). Verify:
   - What if there is exactly one line? Zero lines (empty input)? Only blank lines? Blank lines interspersed between valid ones - are they skipped, errors, or emitted as something?
   - A line with trailing whitespace. A line with leading whitespace. CRLF endings. Last line without a newline.
   - A line containing multiple JSON values (\`{"a":1} {"b":2}\`). A line with invalid JSON - exact error message, exit code, and whether earlier lines still got printed to stdout.
   - Top-level scalars per line (\`1\\n"x"\\ntrue\\nnull\`).
   - Is the output sorted globally or per line? Test with lines whose keys interleave, e.g. \`{"b":1}\\n{"a":2}\` - is it json[0].b then json[1].a (document order of lines preserved) or globally sorted?
   - Does --no-sort change stream output?
   - Very long lines (e.g. 5MB single line) - any line-length limit (Go bufio.Scanner has a 64KB default token limit)? Test lines of 60KB, 70KB, 100KB, 1MB, 10MB and report the exact behavior/error. THIS IS IMPORTANT - determine the limit precisely if there is one.
   - Number of lines: many (100k) lines.
2. --stream with --json (forward). Confirm format.
3. --stream with --ungron: what does it do? Is stream ignored, or does it change parsing? Test feeding gron output and JSON-stream output.
4. --stream with --values.
5. --stream reading from a file argument vs stdin.
6. Whether a UTF-8 BOM on the first line matters.
7. Compare non-stream mode on the same multi-line input to confirm the difference and get the non-stream error message.

${RULES}`,
  },
  {
    key: 'url',
    file: '/tmp/probe/spec/10-url-and-proxy.md',
    prompt: `Characterize gron's URL-fetching behavior. There is NO network access in this environment, so you must use a LOCAL HTTP SERVER you start yourself (python3 -m http.server, or a custom python socket server that echoes the raw request so you can inspect headers). This is allowed - it is normal interaction with the binary.

Cover:
1. How gron decides an argument is a URL rather than a file. Test: \`http://...\`, \`https://...\`, \`HTTP://...\`, \`ftp://...\`, \`file:///tmp/x.json\`, \`localhost:8000/x.json\` (no scheme), \`//host/path\`, a filename that contains \`://\`, a filename literally called \`http:\`, an existing file named \`http://x\` in cwd. Report the exact rule (prefix match? url.Parse? does it check the file exists first?).
2. The exact HTTP request gron sends: method, path, HTTP version, and ALL headers in order (use a raw socket server that dumps the request bytes). In particular the User-Agent (exact string - the README suggests \`gron/0.1\`, but the binary reports version "dev", so determine the real value) and Accept, Accept-Encoding, Connection, Host headers.
3. Response handling: does it check the HTTP status code? Test 200, 204, 301/302 redirect (does it follow? how many hops? report exact behavior and any error at a redirect loop), 400, 404, 500 - for each report whether gron processes the body anyway or errors, the exact error text, and the exit code.
4. Content-Type handling: does it matter? Test text/plain, application/json, no Content-Type, text/html with JSON body.
5. Body handling: gzip Content-Encoding (does it decompress?), chunked transfer encoding, empty body, invalid JSON body (exact error), very large body.
6. Connection errors: connection refused (exact message + exit code), DNS failure for a nonexistent host (exact message + exit code), timeout/hang (is there a timeout? start a server that never responds and report whether gron hangs forever - use \`timeout 20\`).
7. -k/--insecure: set up a local HTTPS server with a self-signed cert (python3 ssl module) and compare with and without -k. Report the exact TLS error message without -k and success with -k.
8. -x/--proxy: determine the value syntax and behavior. Point it at a local server acting as a proxy and dump what gron sends (an absolute-URI GET?). Test http:// proxy URL, socks5:// proxy URL, invalid proxy URL (exact error), empty value. Determine whether -x takes its value as \`-x URL\`, \`-x=URL\`, or both.
9. --noproxy: exact syntax (comma-separated hosts), and verify behavior: with -x set and --noproxy including the target host, the request should go direct. Test wildcard entries, \`*\`, IPs, host:port, leading dots.
10. Do HTTP_PROXY / HTTPS_PROXY / NO_PROXY / http_proxy environment variables affect fetching when -x is NOT given? Test explicitly.
11. Does --stream / --json / --ungron work with a URL source?
12. Does the URL fetch happen before or after other errors (e.g. \`gron -u http://...\`)?

Report a precise spec including the exact request bytes and exact error strings.

${RULES}`,
  },
  {
    key: 'colors',
    file: '/tmp/probe/spec/11-colors.md',
    prompt: `Characterize gron's COLOR output exhaustively and exactly.

Note: NO_COLOR=1 and TERM=dumb are set in this environment and suppress colors. Use /tmp/probe/g (wrapper with NO_COLOR unset, TERM=xterm) and python3 /tmp/probe/ptyrun.py for tty tests.

Cover:
1. The decision to colorize: build a full truth table over {no flag, -c, -m, -c -m, -m -c} x {stdout is pipe, stdout is tty} x {NO_COLOR unset, NO_COLOR=1, NO_COLOR="", NO_COLOR=0} x {TERM=xterm, TERM=dumb, TERM unset}. Also test CLICOLOR/CLICOLOR_FORCE if they have an effect, and whether stderr color matters. Report exactly which combinations produce escape codes. (Hypothesis: an explicit -c forces on, -m forces off, otherwise tty-detect; PLUS an independent library-level suppression from NO_COLOR/TERM=dumb/non-tty. Verify precisely - e.g. does \`-c\` with NO_COLOR=1 produce color?)
2. gron (forward) mode color scheme: exact escape sequences for every token type. Enumerate: the root \`json\` identifier, bare object keys, the \`.\` separator, \`[\` and \`]\` for array index, the numeric index, a bracket-quoted key (are the quotes colored the same as the key?), the \` = \` , the trailing \`;\`, and each value type: string, number, true, false, null, \`{}\`, \`[]\`. Give the literal bytes (e.g. \\\\x1b[34;1m ... \\\\x1b[0;22m).
3. --json mode color scheme: exact sequences for the outer \`[\`, the path array \`[\`/\`]\`, string path elements, numeric path elements, the commas, and the value.
4. --ungron mode color scheme: exact sequences for \`{\` \`}\` \`[\` \`]\`, object key quotes vs key text, \`:\`, \`,\`, string value quotes vs text, numbers, true/false/null, empty containers. Also confirm whether colorized ungron output is compact (no newlines/indent) and whether monochrome ungron output is indented, and the trailing newline in each case.
5. --values mode: is it ever colorized?
6. Whether colorization changes any non-color aspect of the output (spacing, ordering, indentation) - the compact-vs-indented ungron difference is one; look for others (e.g. does -c change gron-mode spacing at all?).
7. Whether the color codes wrap the quotes of strings inside or outside.

Produce a table mapping token -> prefix bytes -> suffix bytes for each mode. This must be exact enough to reimplement byte-for-byte.

${RULES}`,
  },
];

phase('Probe')

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['specPath', 'summary', 'openQuestions'],
  properties: {
    specPath: { type: 'string' },
    summary: { type: 'string', description: 'Max 25 lines of the most important findings' },
    openQuestions: { type: 'array', items: { type: 'string' }, description: 'Things still uncertain' },
  },
};

const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description'],
        properties: {
          description: { type: 'string', description: 'A specific missing experiment or unverified claim, phrased as a concrete command to run' },
        },
      },
    },
  },
};

const results = await pipeline(
  DIMS,
  (d) => agent(`${d.prompt}\n\nWrite your spec to: ${d.file}\n`, {
    label: `probe:${d.key}`, phase: 'Probe', schema: SUMMARY_SCHEMA,
  }),
  (res, d) => {
    if (!res) return null;
    return agent(`You are auditing a behavioral spec of the CLI tool at /workspace/executable (a reimplementation target, the JSON tool "gron").

Read the spec file at ${d.file}.

Your job: find GAPS - specific behaviors that a reimplementer would still have to guess at - and CLAIMS that look unverified or wrong. Focus on things that would cause byte-level output differences.

You MAY and SHOULD run /workspace/executable to check whether claims in the spec are actually true. If you find an outright WRONG claim, that is the highest-priority gap.

${RULES}

Ignore the "## Deliverable" section above; instead return up to 12 concrete gaps, each phrased as an actionable experiment (an actual shell command to run). If the spec is genuinely complete, return an empty list.`,
      { label: `critic:${d.key}`, phase: 'Critic', schema: CRITIC_SCHEMA });
  },
  (crit, d) => {
    if (!crit || !crit.gaps || crit.gaps.length === 0) return { key: d.key, filled: 0 };
    const list = crit.gaps.map((g, i) => `${i + 1}. ${g.description}`).join('\n');
    return agent(`You are completing a behavioral spec of the CLI tool /workspace/executable (a gron reimplementation target).

The spec file is at ${d.file}. An auditor found these gaps:

${list}

Your job: run the experiments needed to resolve EVERY gap above, then UPDATE ${d.file} - correct any wrong claims in place, and append a section "## Additional verified findings" with the new results (exact commands, exact observed bytes, exit codes). Keep the file self-contained and implementable.

${RULES}

Ignore the "## Deliverable" section's instruction to write a new file - update ${d.file} in place instead. Return a short list of what you corrected or added (max 15 lines).`,
      { label: `fill:${d.key}`, phase: 'Fill' })
      .then((r) => ({ key: d.key, notes: r }));
  },
);

log(`probed ${results.filter(Boolean).length}/${DIMS.length} dimensions`)

return {
  specs: DIMS.map((d) => d.file),
  summaries: results.filter(Boolean),
}
