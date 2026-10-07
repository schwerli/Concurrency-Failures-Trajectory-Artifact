export const meta = {
  name: 'lnav-behavior-map',
  description: 'Fan out explorers to map the behavior of the lnav reference binary across CLI surfaces',
  phases: [
    { title: 'Map', detail: '15 explorers probing distinct behavior surfaces' },
    { title: 'Gaps', detail: 'completeness critic identifies unexplored surfaces' },
  ],
}

const RULES = `
CRITICAL RULES (violating these fails the whole benchmark):
- The binary is /workspace/executable (it is lnav 0.14.0). You may ONLY run it and observe outputs.
- You MUST NOT decompile, disassemble, objdump, nm, strings, gdb, strace, or ltrace it.
- You MUST NOT search the web or download/inspect any lnav source code or packages.
- Do not modify or delete /workspace/executable.
- Work in your own scratch dir under /tmp (make a uniquely named one).
- Note: the binary writes state to ~/.lnav . Avoid destructive changes there.
- Always use absolute path /workspace/executable. Many invocations need '-n' (headless) since stdout is not a TTY.
- Useful: prefix commands with 'timeout 20' so nothing hangs. If a command needs a TTY, it will error out; note that error verbatim.

OUTPUT REQUIREMENT:
Write your findings to the file given below, in Markdown. Be EXHAUSTIVE and PRECISE: record exact literal
output text (in fenced code blocks), exact exit codes, exact whitespace/alignment where it matters,
and whether output went to stdout or stderr (test with 2>/dev/null and 1>/dev/null separately).
Your final returned text must be a <=25 line summary of the most important findings, NOT the full report.
`;

const SURFACES = [
  {
    key: 'cli-args',
    file: '/workspace/notes/01-cli-args.md',
    prompt: `Map lnav's command-line ARGUMENT PARSING exhaustively.
Test: every documented flag (-h -H -I -W -u -d -V -S --since -U --until -r -R -c -f -e -t -n -N -q -i -m -C),
unknown flags (e.g. -Z, --bogus), flags needing an argument but given none, '--' separator,
long-option forms (--help? --version? --headless? etc - probe which long options exist),
repeated flags, flag ordering (before/after file args), combined short flags (-nq, -nN).
Record exact usage/error text, exit codes, stdout vs stderr.
Also record the FULL exact output of '-h' and '-V' verbatim (character for character, including emoji and
trailing spaces) since those must be reproduced exactly. Note which parts are dynamic (paths, cwd, binary path).
Check how '-h' output changes when run under a different HOME or from a different cwd.`,
  },
  {
    key: 'headless-basic',
    file: '/workspace/notes/02-headless-basic.md',
    prompt: `Map lnav's HEADLESS (-n) output behavior for plain log files.
Create sample logs (syslog style, plain text, empty file, file with one line, file with CRLF, file with
trailing newline vs none, binary-ish content, very long lines, unicode).
Determine: what exactly is printed, is it the raw line or reformatted? are there added columns/prefixes?
What happens with multiple files (ordering/merging by timestamp)? Does it print a file header/separator?
What does -q change? What does -N do? What happens with no file args at all (with and without -N)?
What happens when stdin is a pipe (echo ... | lnav -n)? With '-' as a filename?
What about a directory argument? A nonexistent file? A file with no read permission? A FIFO? /dev/null?
Record exact stdout/stderr text and exit codes for each.`,
  },
  {
    key: 'formats-detect',
    file: '/workspace/notes/03-format-detection.md',
    prompt: `Map lnav's LOG FORMAT DETECTION. Determine the complete list of built-in formats and how each is
recognized. Start by finding a way to list formats from the tool itself (try: -n -c ';SELECT * FROM lnav_format',
';SELECT name FROM sqlite_master', the ':config' command, '-m' management mode subcommands like
'-m format list' / 'format --help', and '-W'/'-C'). Then for each format you can identify, craft a sample line
that is recognized (verify with -n -c ';SELECT format FROM lnav_file' or ';SELECT log_format,* FROM all_logs').
Focus especially on: syslog, access_log (common/combined web log), error_log (apache), json/jsonlines,
generic_log, glog, tcsh_history, bro/zeek, vmw_log, strace, sudo, and any "generic"/fallback behaviors.
Record for each: format name, an example matching line, and the columns exposed by its SQL table.`,
  },
  {
    key: 'sql-tables',
    file: '/workspace/notes/04-sql-tables.md',
    prompt: `Map lnav's SQL layer: the set of TABLES and their SCHEMAS.
Use: /workspace/executable -n -c ';SELECT ...' with a small syslog file loaded.
Enumerate all tables/views: try ';SELECT * FROM sqlite_master', ';SELECT name,sql FROM sqlite_master ORDER BY name',
and the '.schema' style. Record the full CREATE TABLE text for the important ones:
syslog_log, all_logs, lnav_file, lnav_views, lnav_view_stack, lnav_view_filters, lnav_view_files,
environ, lnav_settings/lnav_config, regexp_capture, fstat, logline, log_message_detail?, etc.
Also record the columns that EVERY log table has (log_line, log_part, log_time, log_actual_time, log_idle_msecs,
log_level, log_mark, log_comment, log_tags, log_annotations, log_filters, log_opid, log_format, log_time_msecs,
log_path, log_text, log_body, log_raw_text, log_line_hash, log_unique_path ... verify the exact list and order).
Record exact column order as it appears in 'SELECT *' output.`,
  },
  {
    key: 'sql-output-format',
    file: '/workspace/notes/05-sql-output-format.md',
    prompt: `Map EXACTLY how lnav renders SQL query RESULTS in headless mode. This is high-value: the text
alignment must be byte-identical.
Experiment with: ';SELECT 1', ';SELECT 1 AS a, 2 AS b', long values, NULL values, empty strings,
numeric vs text alignment (are numbers right-aligned and text left-aligned?), very long column names,
values longer than the header, multi-row results, zero-row results, unicode values, values containing newlines,
blobs (x'00ff'), floats (1.5, 1e300, -0.0), large integers, booleans.
Pipe output through 'cat -A' to capture exact trailing spaces and separators.
Determine the padding rule for each column (width = max(len(header), max len(value))? plus how many spaces?).
Also: what is printed for a query returning no rows? for a non-SELECT statement (CREATE TABLE, INSERT, UPDATE)?
What message appears (e.g. row counts, "No rows matched")? Is there a summary line?
Also check ';SELECT' errors: syntax errors, unknown table, unknown column - record the exact error format,
which stream it goes to, and the exit code.`,
  },
  {
    key: 'sql-functions',
    file: '/workspace/notes/06-sql-functions.md',
    prompt: `Map lnav's custom SQL FUNCTIONS. Try ';SELECT name, narg, type FROM pragma_function_list ORDER BY name'
(if supported) or otherwise probe. Identify lnav-specific functions beyond stock SQLite, e.g.:
regexp, regexp_match, regexp_replace, extract, gunzip, gzip, startswith, endswith, humanize_file_size,
humanize_duration, humanize_id, substr?, sparkline, timediff, timeslice, log_top_line, log_top_datetime,
group_concat variants, json_group_object, jget, jset, jconcat, anonymize, encode/decode, basename, dirname,
joinpath, readlink, realpath, shell_exec, leftpad/rightpad, spooky_hash, char/unicode?, logfmt2json,
parse_url, unparse_url, and any 'lnav_*' functions.
For each function found, record its exact behavior on a couple of representative inputs (exact returned text),
its arity, and the exact error when misused. Focus on the ones most likely to be tested.
Also record the exact output of ';SELECT sqlite_version()' and lnav_version() if present.`,
  },
  {
    key: 'lnav-commands',
    file: '/workspace/notes/07-commands.md',
    prompt: `Map lnav's ':' COMMANDS as usable from -c in headless mode.
First find the list of commands: try '-n -c ":help"', '-n -c ":"', an invalid command like '-n -c ":zzz"'
(the error may suggest similar commands), and any SQL table listing commands.
Then test the behavior (exact output/exit code) of the most likely-tested commands in headless mode:
:write-to, :write-json-to, :write-csv-to, :write-raw-to, :write-table-to, :write-jsonlines-to, :write-screen-to,
:echo, :eval, :goto, :filter-in, :filter-out, :hide-lines-before/after, :highlight, :set-min-log-level,
:redirect-to, :switch-to-view, :quit, :sh, :spectrogram, :summarize, :create-logline-table, :create-search-table,
:comment, :tag, :mark, :next-mark, :config, :reset-session, :load-session, :save-session, :export-session-to.
Record which ones work headless and their exact output. Note the exact error text for unknown commands and for
commands with missing/invalid arguments.`,
  },
  {
    key: 'stdin-t-e',
    file: '/workspace/notes/08-stdin-t-e.md',
    prompt: `Map lnav's STDIN handling, the -t flag, and the -e flag.
Tests: 'printf "a\\nb\\n" | /workspace/executable -n', same with -t (what timestamp format is prepended?
is it prepended to the printed output or only used internally?), stdin with log lines that already have
timestamps, empty stdin, stdin that is a TTY-less pipe vs /dev/null redirect, binary stdin.
-e: '/workspace/executable -n -e "echo hello"', '-e "ls /nonexistent"' (stderr capture?), exit code of the
child affecting lnav's exit code, multiple -e flags, -e combined with file args.
Also test how the captured command output is labeled/displayed and what SQL tables show it
(';SELECT * FROM lnav_file' after -e).
Record exact outputs and exit codes.`,
  },
  {
    key: 'mgmt-mode',
    file: '/workspace/notes/09-management-mode.md',
    prompt: `Map lnav's MANAGEMENT MODE and config-checking options: -m, -i, -C, -W, -u, -I.
Try '-m' with no args, '-m --help', '-m help', and probe for subcommands (likely: 'config', 'format',
'piper', 'regex101', 'file'). For each subcommand found, probe its own --help and subcommands
(e.g. 'format <name> get/source/...', 'config get/blame/...', 'piper list/clean').
Test '-C' with: no files, a valid log file, a file that matches no format, an invalid format json file.
Test '-i' with a small custom format json file and with 'extra'; record what it prints and where it installs
(then clean up what you installed under ~/.lnav so the environment stays close to pristine - list what you removed).
Test '-W' and '-u'. Test '-I /nonexistent' and '-I' with a real dir containing a format file.
Record exact outputs and exit codes for everything.`,
  },
  {
    key: 'json-logs',
    file: '/workspace/notes/10-json-logs.md',
    prompt: `Map lnav's handling of JSON / JSON-lines logs and structured content.
Create a .json / .jsonl file of JSON-lines objects with fields like {"ts":"2024-01-01T00:00:00Z","level":"error","msg":"..."}.
Determine: does lnav auto-detect it? what format name is assigned? how is it printed in headless mode
(raw line or reformatted)? What columns does the SQL table expose? Try common shapes: timestamp field named
"time"/"ts"/"@timestamp", level field named "level"/"severity"/"PRIORITY". Test a systemd 'journalctl -o json'
style line: {"__REALTIME_TIMESTAMP":"1700000000000000","PRIORITY":"3","MESSAGE":"oops","_PID":"42","SYSLOG_IDENTIFIER":"x"}.
Also test malformed JSON lines mixed with good ones. Also probe the 'json' format definitions available.
Record exact printed output for each case.`,
  },
  {
    key: 'timestamps-levels',
    file: '/workspace/notes/11-timestamps-levels.md',
    prompt: `Map lnav's TIMESTAMP PARSING and LOG LEVEL detection.
Using a generic/unknown-format text file and via ';SELECT log_time, log_level, log_text FROM all_logs',
determine which timestamp formats lnav recognizes at the start of a line. Test at least:
ISO8601 (2024-01-02T03:04:05Z, with/without T, with .123 millis, with +01:00 offset), syslog 'Jan  2 03:04:05',
'2024-01-02 03:04:05,123', epoch seconds, epoch millis, '[2024-01-02 03:04:05]', RFC822/RFC1123,
'02/Jan/2024:03:04:05 +0000' (web log), 'MM/DD/YYYY hh:mm:ss', bare 'HH:MM:SS'.
For each: is it recognized, and what does log_time show?
Also: how is the YEAR inferred when absent (test with a syslog line - which year appears)?
Then map LEVEL detection: which substrings map to which log_level values
(trace/debug/info/notice/warning/error/critical/fatal/stats/invalid) - test words like
DEBUG, INFO, WARN, WARNING, ERROR, ERR, CRITICAL, CRIT, FATAL, SEVERE, ALERT, EMERG, NOTICE, TRACE,
in various cases/positions. Record exact log_level strings returned.
Also test -S/--since and -U/--until filtering with relative ('-1h', 'today') and absolute times.`,
  },
  {
    key: 'text-files-archives',
    file: '/workspace/notes/12-text-archives.md',
    prompt: `Map lnav's handling of NON-LOG text files, directories, recursion, rotated files, and compression.
Tests: a plain text file with no timestamps (what is printed in -n mode? does it appear in all_logs? in
lnav_file with what format?), a markdown file, a .c source file, a very large file.
Directories: pass a dir (are all files loaded? what order? are hidden files skipped? subdirs?), with -r.
Rotated: file.log, file.log.1, file.log.2.gz - test -R behavior.
Compression: create .gz, .bz2, .xz, .zst versions of a log file and see which decompress transparently
(record the exact error for unsupported ones). Also a .zip and .tar.gz archive (lnav can extract archives).
Also test a file that is actively appended (tail behavior in -n mode - does it exit immediately?).
Record exact outputs and exit codes.`,
  },
  {
    key: 'error-style',
    file: '/workspace/notes/13-error-style.md',
    prompt: `Map lnav's DIAGNOSTIC MESSAGE STYLE precisely. lnav prints multi-line diagnostics like:
  error: unable to open file: /tmp/nope.log
 reason: No such file or directory
Collect as many distinct diagnostics as you can (bad file, bad flag, bad SQL, bad command, bad format file,
bad config, TTY-required, unreadable file, empty dir, unknown format for -C, etc).
For each, capture the EXACT bytes (use 'cat -A' or 'od -c' where whitespace matters), the stream (stdout/stderr),
and the exit code. Deduce the general formatting rule: label alignment (right-aligned labels?), the set of labels
('error:', 'reason:', 'help:', 'warning:', 'note:', ' = help:'), indentation, colors (is there ANSI when not a TTY?
test with TERM set/unset and with a pty via 'script -qec ... /dev/null' if available), and any leading/trailing
blank lines. Also determine whether diagnostics ever go to stdout.`,
  },
  {
    key: 'config-session',
    file: '/workspace/notes/14-config-session.md',
    prompt: `Map lnav's CONFIGURATION and SESSION behavior observable from the CLI.
Explore: the ~/.lnav directory tree it creates on first run (list every file/dir created when HOME is a fresh
empty temp dir - do 'HOME=/tmp/fresh /workspace/executable -n -c ";SELECT 1"' and diff the tree before/after).
The ':config' command: '-n -c ":config /ui/theme"' to read a value, and the full config dump if possible.
The 'lnav_config'/'lnav_settings' SQL tables. The '-m config get' output (may be a big JSON blob - record its
top-level keys and a couple of nested examples, not the whole thing).
Environment variables that affect behavior: XDG_CONFIG_HOME, HOME, LNAV_HOME?, TERM, NO_COLOR, TZ, LANG.
Test TZ effects on displayed log_time. Test NO_COLOR.
Also determine what a 'crash' dir / log file is used for, and whether a session file is written on exit in
headless mode.`,
  },
  {
    key: 'views-filters',
    file: '/workspace/notes/15-views-filters.md',
    prompt: `Map lnav's VIEWS and FILTERING as observable headless.
Tables: lnav_views, lnav_view_stack, lnav_view_filters, lnav_view_files, lnav_focused_msg?
Record the exact schema and default row contents of each (with a small log file loaded).
Commands: ':filter-in <regex>', ':filter-out <regex>', ':set-min-log-level error', ':hide-lines-before',
':hide-lines-after', ':hide-fields', ':highlight' - test each with -n and a log file with several lines
of different levels, and record what the resulting printed output is.
Also test combining -c filters with -c ';SELECT count(*) FROM syslog_log' to see whether filters affect SQL.
Also: ':switch-to-view text|log|help|schema|pretty|hist|db', and what -n prints for each.
Record exact outputs.`,
  },
];

phase('Map')

const reports = await parallel(SURFACES.map(s => () =>
  agent(
    `You are reverse-engineering the behavior of a reference binary for a clean-room reimplementation.
${RULES}

WRITE YOUR REPORT TO: ${s.file}

YOUR SURFACE:
${s.prompt}

Spend real effort: run many experiments (30+ distinct invocations is reasonable). Prefer discovering the
underlying RULE over listing examples, but record the literal examples too.`,
    { label: `map:${s.key}`, phase: 'Map' }
  )
));

phase('Gaps')

const gaps = await agent(
  `Read all the report files in /workspace/notes/ (01 through 15). ${RULES}

WRITE YOUR REPORT TO: /workspace/notes/16-gaps.md

You are the completeness critic. Identify:
1. Behavior surfaces of the lnav binary at /workspace/executable that were NOT covered by reports 01-15.
2. Contradictions or unverified claims between reports.
3. The 20 highest-value behaviors to get byte-exact for a reimplementation, ranked, with justification
   based on what a black-box behavioral test suite would most likely exercise.
Run your own spot-check experiments against the binary to resolve contradictions and to probe the gaps
you find. Record exact outputs for anything new you discover.`,
  { label: 'gaps:critic', phase: 'Gaps' }
);

return { reports: reports.filter(Boolean).length, gaps }
