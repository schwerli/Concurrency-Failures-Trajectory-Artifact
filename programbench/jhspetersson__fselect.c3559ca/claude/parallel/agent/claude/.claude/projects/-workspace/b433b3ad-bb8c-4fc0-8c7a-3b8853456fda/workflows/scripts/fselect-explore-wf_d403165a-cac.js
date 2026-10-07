export const meta = {
  name: 'fselect-explore',
  description: 'Exhaustively probe the fselect binary behavior across feature areas',
  phases: [
    { title: 'Probe' },
    { title: 'Deepen' },
  ],
}

const COMMON = `
You are reverse-engineering a CLI binary by BLACK-BOX OBSERVATION ONLY.

Binary: /workspace/executable  (it is the tool "fselect" 0.10.0 - find files with SQL-like queries)
Docs (already available, read them): /workspace/README.md and /workspace/docs/usage.md and /workspace/docs/fselect.1
Full --help output: run \`/workspace/executable --help\`

HARD RULES - violating these fails the whole task:
- You MUST NOT decompile, disassemble, or use objdump/nm/strings/gdb/ghidra/radare on /workspace/executable.
- You MUST NOT use strace/ltrace or any tracing tool on it.
- You MUST NOT search the internet or any package registry for its source code. No git clone, no cargo/pip/apt/go get.
- You MAY ONLY run the binary with arguments/stdin and observe stdout/stderr/exit codes.

Method:
- Make your own scratch directory under /tmp (unique to you) with fixture files you create.
- Run MANY experiments. Be systematic and exhaustive. Use \`echo "exit=$?"\` to capture exit codes.
- Use \`cat -A\` or \`od -c\` when whitespace/NUL/newline details matter.
- Set NO_COLOR=1 or use --nocolor when you want clean output; ALSO test what happens without it (output is piped, so likely no color, but verify by checking for ESC bytes).
- Prefer passing the whole query as ONE quoted argument to avoid shell issues, but ALSO test multi-argument form since fselect joins argv.

Report format: return a DETAILED, DENSE markdown report of exact observed behavior. Include literal command lines and their literal outputs for anything non-obvious. Prefer concrete facts and exact strings over prose. The reader is going to reimplement this from your report, so precision matters more than brevity. Do not summarize away details. Also write the same report to the file given below.
`;

const AREAS = [
  {
    key: 'lexer-parser-errors',
    file: '/tmp/findings/lexer-parser-errors.md',
    prompt: `AREA: query lexing/parsing rules and PARSE ERROR MESSAGES.

Determine exactly:
1. How argv is joined into a query (spaces? test \`executable name from /tmp\` vs \`executable "name from /tmp"\`).
2. Optional leading \`select\` keyword. Is \`select select name\` ok? Case-insensitivity of keywords?
3. Comma rules: are commas optional between columns? What about trailing commas?
4. Quoting: single quotes, double quotes, backticks. Escaped quotes like \\'. What is stripped? Nested quotes?
5. Curly braces {} instead of parens (). Mixed \`(a}\`? Square brackets?
6. Exact stderr/stdout text and exit code for MANY malformed queries. Collect at least 30 distinct error messages verbatim. e.g.:
   - empty query (no args at all -> what happens? does it print help?)
   - \`executable ""\`
   - unknown column name: \`executable "foo from /tmp"\`
   - unknown function: \`executable "nosuchfn(name) from /tmp"\`
   - \`executable "name from"\`
   - \`executable "name where"\`
   - \`executable "name from /tmp where"\`
   - \`executable "name from /tmp where size >"\`
   - \`executable "name from /tmp limit"\`
   - \`executable "name from /tmp limit abc"\`
   - \`executable "name from /tmp into nosuchformat"\`
   - \`executable "name from /tmp order by"\`
   - \`executable "name from /tmp group by"\`
   - unbalanced parens, unterminated quote, bad regex \`name =~ '('\`
   - \`executable "count(*, name) from /tmp"\`, \`executable "min() from /tmp"\`
   - \`executable "name from /tmp depth"\`, \`depth abc\`
   - bogus flags: \`executable --nosuchflag ...\`
   - subquery errors
7. Are error messages on stdout or stderr? Exit codes (0/1/2)? Does --no-errors change them?
8. Where does the parser stop being strict - e.g. is \`name from /tmp blah blah\` accepted?
9. Does a nonexistent search root produce an error? exact text + exit code. Multiple roots where one is missing?
10. Test which words are reserved/keywords: from, where, or, and, not, group, by, order, asc, desc, limit, offset, into, select, as, between, in, exists, like, notlike, mindepth, maxdepth, depth, symlinks, archives, gitignore, etc. What if a column literal equals a keyword?
`,
  },
  {
    key: 'fields',
    file: '/tmp/findings/fields.md',
    prompt: `AREA: every COLUMN/FIELD and its exact rendered value.

Build fixtures that exercise all of these, then record the EXACT output text for each field:
name, filename/fname, extension/ext, path, abspath, dir/directory/dirname, absdir, size, fsize/hsize, uid, gid, user, group, created, accessed, modified, atime, mtime, ctime, is_dir, is_file, is_symlink, is_pipe/is_fifo, is_char, is_block, is_socket, device, rdev, inode, blocks, hardlinks, mode, user_read/write/exec/all/rwx, group_*, other_*, suid/is_suid, sgid/is_sgid, is_sticky/sticky, is_hidden, has_xattrs, xattr_count, extattrs, has_extattrs, acl, has_acl, default_acl, has_default_acl, has_capabilities/has_caps, capabilities/caps, is_shebang, is_empty, width, height, duration, mp3_* , mime, line_count, is_binary, is_text, is_archive/audio/book/doc/font/image/source/video, sha1, sha2_256/sha256, sha2_512/sha512, sha3_512/sha3.

Specifically nail down:
- Exact \`fsize\`/\`hsize\` formatting for many sizes (0, 1, 999, 1000, 1023, 1024, 1025, 1536, 10000, 1048576, 1678123, 1073741824, huge). Is it 1024-based? how many decimals? space before unit? unit names (KiB/MiB or KB/MB)?
- \`mode\` string format exactly (10 chars? does it show suid as 's'? sticky as 't'? for dirs? for symlinks? for fifo/socket/chardev?). Create files with chmod 4755, 2755, 1777, 7777, 0000.
- \`size\` for directories, for symlinks (does it follow?).
- \`dir\` for a file directly in the root (empty string?). \`path\` for the root itself (is root included in results? apparently not - verify with maxdepth).
- date formats for created/accessed/modified. What if unavailable?
- atime/mtime/ctime integer values.
- boolean rendering: exactly "true"/"false"? What about in csv/json (quoted? bare?)?
- empty/unavailable values: what is printed (empty string?) e.g. width for a text file, mp3_title for a txt, sha1 for a directory, line_count for a directory/binary.
- is_empty for empty dir vs non-empty dir vs empty file.
- is_hidden rules (leading dot; what about a dir named ".x"? what about path components?).
- mime for many extensions and contents: .txt .png .jpg .gif .pdf .zip .html .css .js .json .xml .mp3 .sh .py .rs unknown-ext, no-ext, empty file, binary garbage. Is detection by extension or content?
- is_binary / is_text exact rules.
- line_count exact rule (trailing newline? no trailing newline? empty file? binary file?).
- sha1/sha256/sha512/sha3_512 hex case, and value for empty file & known content ("hello\\n"). What for directories?
- is_archive etc for uppercase extensions (.ZIP)?
- user/group when uid has no passwd entry.
- xattr_count/has_xattrs (use setfattr if available).
- extattrs/has_extattrs, acl/has_acl, capabilities - what do they print when unavailable/none?
- width/height: create a tiny valid PNG, GIF, BMP, JPEG with known dimensions and see which are detected. Report exact values.
- duration/mp3_*: probably empty for non-audio; note what happens.
`,
  },
  {
    key: 'output-formats',
    file: '/tmp/findings/output-formats.md',
    prompt: `AREA: output formats (\`into tabs|lines|list|csv|json|html\`) exact byte-level behavior, plus colors.

Nail down exactly:
1. \`tabs\` (default): separator, trailing newline on last row, behavior with 0 rows, with 1 column, with embedded tabs/newlines in values.
2. \`lines\`: each column on separate line; blank line between rows? trailing newline?
3. \`list\`: use \`od -c\` to determine the exact separator bytes (NUL?) and whether there is a trailing separator/newline.
4. \`csv\`: quoting rules (when are fields quoted? values with comma, quote, newline, leading/trailing space). Line terminator (\\n or \\r\\n)? Header row present?
5. \`json\`: exact key names for EVERY column type (e.g. name->"Name"? size->"Size"? \`count(*)\`->? \`lower(name)\`->? arbitrary literal column->? arithmetic->?). Are numbers emitted as JSON numbers or strings? booleans? Trailing newline? Empty result -> \`[]\`? Pretty printed or compact? Duplicate columns?
6. \`html\`: exact template. What is in <title>? Is it the raw query string? How are the column headers rendered (colspan?)? HTML escaping of values (test values containing < > & " ')? Empty result?
7. Case-insensitivity of format names, and \`into\` with unknown format.
8. COLORS: does the binary colorize when stdout is a TTY? Test using \`script -qc\` or a pty if available to see ANSI codes; record exact escape sequences and which parts get colored (directories? by file type like LS_COLORS?). Check NO_COLOR=1, --nocolor, --no-color, /nocolor. If you cannot make a pty, say so and test that piped output has no escapes.
9. Does the query text appear in html title exactly as given on the command line (including the \`into html\` part)?
10. Multiple \`into\` clauses? \`into\` before other clauses?
`,
  },
  {
    key: 'string-funcs',
    file: '/tmp/findings/string-funcs.md',
    prompt: `AREA: string, japanese, greek functions + CONCAT/CONCAT_WS/COALESCE/CONTAINS + base64.

For each of LOWER/LOWERCASE/LCASE, UPPER/UPPERCASE/UCASE, INITCAP, LENGTH/LEN, TO_BASE64/BASE64, FROM_BASE64, CONCAT, CONCAT_WS, LOCATE/POSITION, SUBSTR/SUBSTRING, REPLACE, TRIM, LTRIM, RTRIM, CONTAINS_JAPANESE/JAPANESE, CONTAINS_HIRAGANA/HIRAGANA, CONTAINS_KATAKANA/KATAKANA, CONTAINS_KANA/KANA, CONTAINS_KANJI/KANJI, CONTAINS_GREEK/GREEK, COALESCE, CONTAINS:

determine exactly:
- output for normal args (test with literal string args, e.g. \`executable "lower('ABC')"\` - note: a query with no \`from\` still runs against the current dir, so use a scratch dir with exactly ONE file to get one row, or check whether pure-literal/function-only queries return a single row).
- LENGTH: characters or bytes? test with multibyte UTF-8 ("héllo", "日本語", emoji).
- SUBSTR: is pos 1-based or 0-based? negative pos? len omitted? len 0? len beyond end? pos beyond end? multibyte?
- LOCATE(str, substr) or LOCATE(substr, str)? 1-based? not found -> ? optional 3rd pos arg semantics.
- REPLACE arg order and behavior.
- TRIM: which chars are trimmed (only spaces? all whitespace? tabs/newlines?). Does TRIM accept a 2nd arg?
- INITCAP: exact word-splitting rules (what counts as a word boundary? digits? punctuation? underscores?). Test 'MICHAEL SMITH', 'hello-world', 'foo_bar', 'a1b c', "o'brien".
- TO_BASE64/FROM_BASE64: padding? standard alphabet? invalid input -> ?
- CONCAT with 0/1/many args, with numeric args, with NULL/empty.
- CONCAT_WS: is the FIRST arg the delimiter (per --help "Concatenate the arguments, separated by the value")? Verify. How are empty args handled?
- COALESCE: what counts as "non-empty"? 0? "false"? "" ?
- CONTAINS(x): per docs, checks whether the FILE contains a substring. Test it. Case sensitivity? What's the return value type? What about binary files / directories?
- Japanese/Greek detectors: exact unicode ranges. Test hiragana あ, katakana ア, katakana halfwidth ｱ, kanji 日, chinese-only char like 汉, greek α, greek Ω, coptic, cyrillic. Report which return true.
- What happens when functions are given the wrong number of args, or nested deeply?
- Are function names case-insensitive?
- Do functions work without parens when they take no args (per docs)?
`,
  },
  {
    key: 'numeric-funcs',
    file: '/tmp/findings/numeric-funcs.md',
    prompt: `AREA: numeric functions and arithmetic expressions.

Functions: BIN, HEX, OCT, ABS, POWER/POW, SQRT, LOG, LN, EXP, LEAST, GREATEST, PI, FLOOR, CEIL/CEILING, ROUND, RAND/RANDOM, FORMAT_SIZE/FORMAT_FILESIZE, FORMAT_TIME/PRETTY_TIME.

Determine exactly (run against a scratch dir with ONE file so you get one output row):
- Number formatting in output generally: how are floats printed? \`select 1/3\`, \`select 2.5\`, \`select 1.0\`, \`select 10/2\` (integer or 5?), \`select sqrt(25)\` (5 or 5.0?), \`select pi()\` (how many digits?), \`select exp(2)\`, \`select ln(10)\`, \`select log(1000)\` (base 10? natural?), \`select log(8, 2)\` (2-arg?).
- BIN/HEX/OCT with 0, positive, negative, float input, string input.
- ABS with negative literal - does the parser even accept \`abs(-5)\`? What about \`-5\` alone as a column?
- POW(2,3), POW(2,0.5), POW with 1 arg.
- ROUND(2.5), ROUND(3.5), ROUND(-2.5) - half-up or banker's? ROUND(pi(),2), ROUND(x, 0), ROUND with negative places.
- FLOOR/CEIL on negatives and integers.
- LEAST/GREATEST with numbers, with strings, mixed, single arg, zero args.
- RAND/RANDOM with 0, 1, 2 args - ranges (inclusive?).
- FORMAT_SIZE: reproduce ALL the examples in docs/usage.md's format_size table and verify; then explore the format spec grammar exhaustively: '%.0'..'%.5', ' ', 'd', 'c', 's', unit letters k/m/g/t/kb/mb/gb/tb/kib/mib, combinations, order of flags, unknown flags, empty string, uppercase specifiers. Report exact outputs.
- FORMAT_TIME/PRETTY_TIME: outputs for 0, 1, 59, 60, 61, 3599, 3600, 3601, 86399, 86400, 90061, 1000000. Exact strings/units.
- Arithmetic: + - * / % and aliases plus/minus/mul/div/mod. Operator precedence (\`select "1+2*3"\`). Parentheses. Division by zero. Integer vs float division. String + number. Unary minus. Comparison of arithmetic results in WHERE.
- Arithmetic on date/size fields, e.g. \`size * 2\`, \`size / 1024\`.
- Are arithmetic expressions allowed in WHERE on both sides? In ORDER BY? In GROUP BY?
- Numeric literal forms: 1e3, .5, 0x10, 1_000, leading +.
`,
  },
  {
    key: 'date-funcs',
    file: '/tmp/findings/date-funcs.md',
    prompt: `AREA: date/time functions and DATE PARSING (natural language dates).

Functions: CURRENT_DATE/CUR_DATE/CURDATE, CURRENT_TIME/CUR_TIME/CURTIME, CURRENT_TIMESTAMP/NOW, DAY, MONTH, YEAR, DAYOFWEEK/DOW, DAYNAME, DAYOFYEAR/DOY, DATE_ADD/DATEADD, DATE_SUB/DATESUB, DATE_DIFF/DATEDIFF, FROM_UNIXTIME, LAST_DAY/LAST_DATE.

Use \`touch -d\` to create files with precise known mtimes, then:
- exact output format of each function. CURDATE() -> 'YYYY-MM-DD'? NOW() -> 'YYYY-MM-DD HH:MM:SS'? CURTIME() -> 'HH:MM:SS'?
- DAY/MONTH/YEAR on a \`modified\` value; on a string literal like '2017-05-01'; on garbage -> what?
- DOW: mapping (docs say 1=Sunday). Verify with a known date. DAYNAME exact strings ('Monday'? 'Mon'?).
- DOY on Jan 1 and Dec 31 (leap year too).
- DATE_ADD(modified, 30) exact output format; negative N; DATE_ADD on a date-only string; 3-arg form?
- DATE_DIFF(a,b) sign and units.
- FROM_UNIXTIME(0), FROM_UNIXTIME(1700000000) - what timezone? Report \`date -u -d @1700000000\` and local TZ for comparison. Also test with TZ env var set.
- LAST_DAY output format.
- DATE PARSING in WHERE: this is the big one. For \`modified = X\` / \`modified gte X\`, determine which X strings parse and to what. Test: 2017-05-01, '2017-05-01 15', '2017-05-01 15:10', '2017-05-01 15:10:30', 2017-05, 2017, 'apr 1', 'april 1', '1 apr', 'apr 1 2017', today, yesterday, tomorrow, now, 'last fri', 'last friday', 'next monday', '3 days ago', '01/05', '05/01' (UK vs US - test with and without --us-dates), '-2', '-2d', +1, '1 week ago', 'last week', 'this month'. Report exactly which succeed and what interval/instant they mean (deduce by which files match given known mtimes).
- Confirm the "inexact date = interval" rule for = and != : a date-only value matches the whole day; 'YYYY-MM-DD HH' matches the hour; 'YYYY-MM-DD HH:MM' the minute. What about a full timestamp with seconds - exact second?
- What do >, >=, <, <= do with an inexact date (which endpoint is used)?
- Comparing \`modified\` to another field. Comparing to a bare number.
- Error message for an unparseable date.
`,
  },
  {
    key: 'operators-glob-regex',
    file: '/tmp/findings/operators-glob-regex.md',
    prompt: `AREA: comparison operators, glob auto-expansion, LIKE, regex, IN, BETWEEN, boolean shorthand.

Determine exactly:
1. \`=\`/\`==\`/\`eq\` on a STRING field (e.g. name): when is the value treated as a glob? Docs say "Simple globs expand automatically". Determine the EXACT rule: which characters trigger glob mode (* ? [ ] etc)? Is the match anchored (full match) or substring? Test: name = 'one.txt', name = '*.txt', name = 'one*', name = '*ne*', name = 'o?e.txt', name = '[on]ne.txt', name = 'ONE.TXT' (case sensitivity!), path = '*b*'.
2. \`===\`/\`eeq\` and \`!==\`/\`ene\`: exact-match semantics, no glob, no regex. Case sensitive?
3. \`=~\`/\`~=\`/\`regexp\`/\`rx\`: anchored or unanchored (is_match)? case sensitivity? invalid regex error message+exit code. \`!=~\`/\`!~=\`/\`notrx\`.
4. \`like\`/\`notlike\`: % and _ semantics; anchored?; are other regex/glob chars escaped? Test 'one%', '%ne%', 'o_e.txt', '%report-2018-__-__???' style. Case sensitivity? What about a literal % in the filename?
5. \`between A and B\`: inclusive? on numbers, strings, dates, sizes. What if A>B? \`not between\`?
6. \`in (a, b, c)\`: value list syntax, quoting, numbers vs strings, \`not in\`. Also with a single value, with an empty list.
7. Boolean columns: \`where is_dir\` shorthand, \`where not is_dir\`, \`is_dir = true/false/1/0/yes/no\`, \`is_dir != true\`. Which truthy strings are accepted? What about comparing a boolean field with a string?
8. Numeric fields: comparisons with size units (5k, 5kb, 5mib, 2g), case-insensitivity of units, and with plain numbers, and with strings.
9. \`and\`/\`or\` precedence, \`not\`, parentheses, \`!\` prefix?, nested. Is AND higher precedence than OR? Test \`where a or b and c\`.
10. Comparing two FIELDS (e.g. \`where width = height\`, \`where name = ext\`).
11. Case-insensitivity of operator keywords (EQ, LIKE, Between, IN, AND, OR, NOT).
12. What happens on a type mismatch, e.g. \`where size = 'abc'\`, \`where name > 5\`, \`where is_dir > 1\`.
13. Does \`=\` on a string field with no special chars do exact match or substring? Verify carefully with a file named 'one.txt' and query name = 'ne'.
14. Whether an unquoted value with \`*\` works (shell-escaped) e.g. \`name = \\*.txt\`.
15. \`where\` on a field that is empty/unavailable (e.g. \`where width = 0\` on text files; \`where title = ''\`).
`,
  },
  {
    key: 'clauses',
    file: '/tmp/findings/clauses.md',
    prompt: `AREA: GROUP BY, ORDER BY, LIMIT, OFFSET, aggregate functions, DISTINCT-ish behavior.

Make a fixture dir with files of varied sizes/extensions/dates (at least 12 files, several extensions, duplicate sizes).

Determine exactly:
1. Aggregates: MIN, MAX, AVG, SUM, COUNT, STDDEV_POP/STDDEV/STD, STDDEV_SAMP, VAR_POP/VARIANCE, VAR_SAMP.
   - COUNT(*) vs COUNT(field) vs COUNT(1) - do they differ (nulls/empties skipped)?
   - Exact numeric formatting of AVG/STDDEV/VAR (how many decimals?).
   - MIN/MAX on strings (lexicographic?), on dates, on empty set.
   - Aggregate over empty result set: what is printed for MIN/SUM/AVG/COUNT?
   - Mixing aggregate and non-aggregate columns WITHOUT group by - what happens?
   - Nested: MIN(YEAR(modified)), aggregate of arithmetic SUM(size/1024).
   - Two aggregates in one query.
2. GROUP BY: by a column name, by a function, by a positional number, by multiple columns. Output row ORDER of groups (sorted? insertion order?). Are non-aggregate selected columns that aren't in group by allowed? Does \`group by\` imply sorting? \`having\`?
3. ORDER BY: single column, multiple, asc/desc per column, positional numbers (1-based), ordering by a column not in the select list, ordering by a function/arithmetic expr, order by RAND().
   - Sort STABILITY and comparison semantics: numeric fields sorted numerically? size? \`fsize\` (a formatted string) sorted how? dates? booleans? mixed empty values (where do empties sort)? Case sensitivity of string sort?
   - Interaction of order by with group by and with aggregates.
4. LIMIT n, OFFSET n, both, order of keywords (\`limit 5 offset 2\` and \`offset 2 limit 5\`), limit 0, negative, huge, non-numeric.
5. Interaction with \`into json/csv\`.
6. Does the tool print anything extra (e.g. a summary line, counts) - verify with od if needed.
7. Test whether duplicate rows are collapsed anywhere.
8. \`limit\` with aggregates.
`,
  },
  {
    key: 'roots-traversal',
    file: '/tmp/findings/roots-traversal.md',
    prompt: `AREA: search roots and traversal options: mindepth, maxdepth/depth, symlinks/sym, archives/arc, gitignore/git, nogitignore/nogit, hgignore/hg, nohgignore/nohg, dockerignore/docker, nodockerignore/nodocker, dfs, bfs, regexp/rx, \`as\` alias.

Build a deep fixture tree (at least 4 levels), with symlinks (including a symlink loop, a symlink to a dir, a broken symlink), a zip archive containing nested files, .gitignore/.hgignore/.dockerignore files.

Determine exactly:
1. TRAVERSAL ORDER for default (bfs) and for dfs. Give the exact output ordering for a known tree so it can be reproduced. Is within-directory order raw readdir order or sorted? (Create files in a known creation order and check.) IMPORTANT: determine this precisely - run the same query several times to see if order is stable.
2. Is the search root itself ever included in results? What does \`path\`/\`name\` give for it? Test \`from /tmp/x maxdepth 1\`.
3. Exact meaning of mindepth N and maxdepth N (which levels are included). Table of depth->included for N=0,1,2,3. Is \`depth\` == \`maxdepth\`? Can mindepth and maxdepth combine? mindepth 0? negative?
4. Multiple roots: order of results, duplicate suppression, one missing root, overlapping roots. Are per-root options independent?
5. symlinks: with and without. Broken symlinks. Symlink to dir - is it descended? Loop protection? Does \`size\`/\`is_file\` follow the link when symlinks is on/off?
6. archives: what exactly appears for files inside a .zip? \`path\`, \`name\`, \`size\`, \`is_dir\`, \`modified\` for archive entries. Nested dirs in zip. Is the .zip itself also listed? Non-zip files with .zip extension? Other archive types (.tar.gz) - included or not?
7. gitignore/hgignore/dockerignore: exact pattern semantics observed (negation with !, dir-only trailing /, ** patterns, comments, blank lines, nested .gitignore in subdirs, whether the .gitignore file itself is excluded). Are they OFF by default? Is there a config default? What do nogitignore etc do - do they only matter if config enables it?
8. regexp/rx root: how is the path treated as regex? e.g. \`from '/tmp/x/.*' rx\`. What is matched - full path? Give working examples.
9. \`as alias\`: syntax placement, and its effect when NOT using subqueries.
10. Permission-denied directories: error message text, exit code (should be 1), and does traversal continue? Test with a 000-mode dir (you are root, so instead create an unreadable dir and use a nonexistent path, or test a path like /proc/1/mem read errors). Also test \`--no-errors\`.
11. Whether hidden files/dirs are traversed by default.
12. Order of option keywords after a path, and unknown options -> error text.
`,
  },
  {
    key: 'cli-config-interactive',
    file: '/tmp/findings/cli-config-interactive.md',
    prompt: `AREA: command-line arguments, configuration file, interactive mode, exit codes, misc.

Determine exactly:
1. All CLI flags: --interactive/-i//i, --config/-c//config, --nocolor/--no-color//nocolor, --no-errors, --help/-h//?//h, --us-dates, and any version flag (-V/--version/--version?). Exact output of --help (already captured; note whether it goes to stdout and exit code). Behavior with no arguments at all (prints help? exit code?). Unknown flag -> is it treated as part of the query?
2. Are flags recognized only at the start, or anywhere in argv?
3. CONFIG FILE: run with HOME set to a fresh temp dir and see whether a config file gets CREATED. Report its EXACT full contents verbatim (this is important - I need to generate the same default file). Path used ($HOME/.config/fselect/config.toml? XDG_CONFIG_HOME?). Then test modifying values and observe effects: which keys exist and what they do. Try keys mentioned in docs: no_color, gitignore, hgignore, dockerignore, us_dates, check_for_updates, and the extension lists (archive_extensions, audio_extensions, ...), default_file_size_format. Determine exact key names from the generated file.
   - Also test: does \`--config FILE\` with a nonexistent file error out or create it? Malformed toml -> error text?
   - Does the config file affect is_archive/is_audio extension lists? Verify by editing.
   - Is there a config key that changes the default output format or adds a header?
4. INTERACTIVE MODE: pipe commands into \`executable -i\` via stdin. Record the EXACT prompt string and banner (use od -c to catch escapes/colors). Commands: help, pwd, cd PATH (relative and absolute, nonexistent), errors on/off, exit, quit, empty line, EOF, a normal query, an invalid query. What does it print between results? Does it echo anything? Exit code on EOF. Does history do anything observable? Does it print a goodbye message?
5. EXIT CODES: verify 0 (ok), 1 (I/O error during listing/reading), 2 (parse error). Find concrete reproducible cases for each.
6. NO_COLOR env var, and what happens with TERM=dumb.
7. Anything printed to stderr in normal operation.
8. Does the binary read stdin in non-interactive mode?
`,
  },
  {
    key: 'subqueries',
    file: '/tmp/findings/subqueries.md',
    prompt: `AREA: subqueries with IN / NOT IN / EXISTS / NOT EXISTS, and \`as\` aliases; plus arbitrary-literal columns.

Build two or three fixture dirs with partially overlapping file names/sizes.

Determine exactly:
1. Syntax accepted: \`where size in (select size from /dir2)\`, \`not in\`, \`exists (select * from ...)\`, \`not exists\`. Does \`select\` inside the subquery need to be present? Can the subquery have where/limit/order by?
2. Correlated subqueries with \`as\` aliases: \`select name from /a as outer where exists (select * from /b as inner where inner.name = outer.name)\`. Determine how qualified column references (\`alias.column\`) resolve. What happens with an unknown alias? Without aliases, is a correlated reference possible?
3. What EXACTLY does \`select *\` mean in a subquery? Is \`*\` a valid column elsewhere (e.g. top-level \`select * from /tmp\`)?
4. Behaviour of IN with an empty subquery result; NOT IN with empty; NOT IN when subquery yields empty strings.
5. Nesting depth (3-4 levels) - does it work?
6. Error messages for malformed subqueries.
7. Performance/semantics: is the subquery evaluated once or per-row? (Deduce from correlated vs uncorrelated behavior.)
8. Also: ARBITRARY TEXT COLUMNS. \`executable "name, ' has size of ', size, ' bytes'"\`. How are unquoted bare words that aren't columns/functions treated - as literals or as errors? Test \`executable "hello from /tmp"\`, \`executable "'hello' from /tmp"\`, \`executable "123 from /tmp"\`. What are the JSON keys / html headers for such columns?
9. Duplicate column names in select.
`,
  },
];

phase('Probe')

const reports = await parallel(AREAS.map(a => () =>
  agent(`${COMMON}\n\nWrite your report to: ${a.file}\n\n${a.prompt}`, { label: `probe:${a.key}`, phase: 'Probe' })
    .then(r => ({ key: a.key, file: a.file, report: r }))
))

const good = reports.filter(Boolean)
log(`Probed ${good.length}/${AREAS.length} areas`)

return good.map(r => `\n\n======== AREA: ${r.key} (file: ${r.file}) ========\n${r.report}`).join('')
