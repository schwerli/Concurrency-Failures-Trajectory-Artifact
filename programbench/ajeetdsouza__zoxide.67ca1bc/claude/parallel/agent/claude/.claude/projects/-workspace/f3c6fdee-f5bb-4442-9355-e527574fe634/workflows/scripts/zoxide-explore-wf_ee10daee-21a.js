export const meta = {
  name: 'zoxide-explore',
  description: 'Behaviorally explore zoxide 0.9.9 binary to spec out a reimplementation',
  phases: [
    { title: 'Explore', detail: 'parallel probes of each subsystem' },
  ],
}

const RULES = `
## HARD RULES (violating these fails the whole benchmark)
- The binary under test is /workspace/executable (zoxide 0.9.9). It is READ+EXECUTE only.
- You may ONLY run it and observe stdout/stderr/exit codes/files it writes.
- You MUST NOT: decompile, disassemble, use objdump/nm/readelf/gdb/ghidra/radare2/strings on it,
  or use strace/ltrace/perf/ptrace on it.
- You MUST NOT search the web, git clone, cargo/pip/npm/apt install zoxide, or look for its source code.
  There is no network anyway. Do not try.
- Do NOT read or write /workspace (except reading /workspace/README.md). Work in your own temp dir.
- ALWAYS set a fresh _ZO_DATA_DIR per experiment so tests do not interfere:
  e.g. export _ZO_DATA_DIR=$(mktemp -d)
- Useful: 'od -A d -t x1z file' for hexdumps (xxd is not installed). python3 is available for
  struct packing/unpacking to craft database files.
- fzf is NOT installed. You can create a FAKE executable named 'fzf' early in PATH (a shell script
  that logs "$@" and its stdin to a file, then prints whatever you want) to observe exactly how the
  binary invokes fzf. This is allowed and encouraged: it is normal interface observation.

## OUTPUT REQUIREMENTS
Return a dense, precise engineering spec in Markdown. Include EXACT literal strings (byte-exact,
showing trailing spaces as <SP> if any), exact exit codes, and exact numbers. Include the concrete
commands you ran for any surprising finding. No hedging, no "probably" — test it. If you could not
determine something, say so explicitly under "UNKNOWNS".
Be exhaustive. Length is not a concern; correctness and completeness are.
`

const PROBES = [
  {
    key: 'dbformat',
    prompt: `Reverse-engineer the on-disk database format and file handling of zoxide 0.9.9.

Determine and document precisely:
1. The exact byte layout of the db file. Where is it stored (filename, directory) given _ZO_DATA_DIR?
   What is the default location when _ZO_DATA_DIR is unset (test with a controlled HOME and
   XDG_DATA_HOME)? What if HOME is unset too?
2. The header/version field. What version number does 0.9.9 write? Craft files by hand with python3
   with other version numbers (0,1,2,4,255) and see what error message + exit code you get.
3. Field order and encoding for each entry (path string, rank, last-accessed timestamp). Confirm
   integer widths, endianness, float format. Confirm the entry-count encoding.
4. What happens with: a truncated file, extra trailing bytes, an empty (0-byte) file, a file with
   invalid UTF-8 in a path, a nonexistent db file, a db dir that doesn't exist (is it created? what
   permissions?), a db path that is a directory, an unreadable file, a read-only directory.
   Give EXACT stderr text + exit codes for each.
5. How is the file written? Look for temp files / atomic rename. Create a scenario that leaves a
   temp file behind (e.g. make writes fail) and report the temp filename pattern. Does it write the
   db at all when nothing changed (compare mtime/inode after a no-op query)?
6. Is there any locking? Any concurrency behavior worth noting?
7. What order are entries stored in the file after add/remove/increment? Does the stored order change
   after a query?
8. Does the file get written when the db is empty? Report exact bytes of an empty db.

Report the exact bytes (hex) for several concrete cases so a reimplementation can be byte-compared.`,
  },
  {
    key: 'aging',
    prompt: `Reverse-engineer zoxide 0.9.9's rank/score/aging arithmetic.

Use \`/workspace/executable query --list --score\` (and hand-crafted db files via python3 to set
arbitrary rank and timestamp values) to determine:
1. The EXACT mapping from (rank, age_in_seconds) to the printed score. Find the age thresholds
   (test around 1 hour, 1 day, 1 week and just above/below) and the multipliers/divisors exactly.
   Test negative ages (timestamp in the future) too.
2. The EXACT output format of \`query --list --score\`: field width, alignment, decimal places,
   separator. Test scores like 0, 0.05, 0.5, 1, 9.94, 9.95, 10, 99.9, 100, 999.5, 1000, 12345.6,
   -1, 1e9, inf, nan. Report the exact literal lines (mark spaces).
3. What rank increment does \`add\` apply to a new entry, and to an existing one? What does
   \`add --score N\` do (new vs existing)? Try N = 0, negative, fractional, huge, non-numeric,
   empty, "1e3", "nan", "inf".
4. \`edit increment\` and \`edit decrement\`: what do they do to rank? What happens when a decrement
   takes rank to <= 0 (is the entry deleted)? What is the exact threshold?
5. The aging algorithm triggered by _ZO_MAXAGE: build a db with many entries (use python3 to craft, or
   many \`add\` calls) whose ranks sum above _ZO_MAXAGE and determine exactly when and how ranks are
   scaled down, and exactly which entries get deleted (what rank cutoff). Give the formula.
   When does aging run — on add? on query? on remove? Test _ZO_MAXAGE = 0, negative, non-numeric,
   fractional, huge.
6. Does \`add\` update the timestamp always? Does add of the same dir twice in the same second do
   anything different?
7. Confirm the timestamp is seconds since the Unix epoch, and what happens with a 0 or negative
   timestamp in the db.

Give exact formulas and exact literal output strings.`,
  },
  {
    key: 'matching',
    prompt: `Reverse-engineer zoxide 0.9.9's query MATCHING algorithm in exhaustive detail.

Build databases containing many known paths (create the real directories under a temp root so they
"exist", and also test entries whose directories do NOT exist). Then run
\`/workspace/executable query --list <keywords...>\` and \`query <keywords>\` to deduce the rules.

Determine precisely:
1. How multiple keywords are combined. Must they appear in order? Must they be non-overlapping?
   Is the LAST keyword special (must it match the final path component / the basename)? Test cases
   like a path /a/foo/bar with queries "foo", "bar", "foo bar", "bar foo", "a bar", "oo ar".
2. Case sensitivity. Is it case-insensitive always? Does an uppercase keyword make it case-sensitive
   (smartcase)? Test with paths containing uppercase.
3. Trailing slash semantics: query "foo/" vs "foo". What does a trailing / require? Test the README
   claim "z foo /  # cd into a subdirectory starting with foo".
4. Path separators inside keywords: query "foo/bar", "/foo", "a/b/c". How are they treated?
5. Does the match have to be on the path AFTER some prefix? Test --base-dir and how it interacts.
6. What characters in keywords are special or escaped? Test regex/glob metacharacters:
   . * ? [ ] ( ) + ^ $ | \\ { } and spaces. Is it a literal substring match or a fuzzy match?
   Test whether "abc" matches "a/b/c" or "axbxc" (i.e. is it subsequence-fuzzy or contiguous?).
7. Whether nonexistent directories are filtered out of results, and how --all changes that.
   Is there a difference between "directory does not exist" and "path exists but is a file"?
   Are entries for nonexistent dirs DELETED from the db by a query? (check db before/after)
8. --exclude <path>: exact semantics. Does it exclude only that exact path, or subdirs too?
   Can it be given multiple times?
9. --base-dir <path>: exact semantics, including relative paths, trailing slashes, and whether the
   base dir itself can be returned.
10. Query with zero keywords: what is returned? Query with an empty-string keyword?
11. If the query is itself an existing absolute/relative directory path, is it returned directly
    even when not in the db? Test '.', '..', '~', '-', '/', a real dir not in the db.
12. Tie-breaking among equal scores, and the exact sort order.

Give a precise algorithm description (pseudocode) that a reimplementation can follow, plus the exact
test cases proving each rule.`,
  },
  {
    key: 'queryflags',
    prompt: `Reverse-engineer zoxide 0.9.9's \`query\` subcommand OUTPUT and FLAG behavior, plus its
interactive/fzf integration.

fzf is not installed. Create a fake \`fzf\` script early on PATH that appends "ARGS: $@" and its
stdin to a log file, then prints a chosen line (and lets you control its exit code). Use it to
observe exactly how the binary drives fzf. This is normal interface observation and is allowed.

Determine:
1. Exact stdout of \`query\` (non-interactive, non-list): what exactly is printed (trailing newline?).
   Exit code and exact stderr when there is no match. Exit code with a match.
2. Exact stdout of \`query --list\`: one path per line? trailing newline? order?
3. \`query --score\` with and without --list. Exact column format.
4. \`query --interactive\` / \`-i\`: exact argv passed to fzf, exact bytes written to fzf's stdin
   (hexdump it — is it newline or NUL separated? does it include scores?), how the selected line is
   parsed back, what happens when fzf exits 0/1/2/130/127, what happens when fzf is not found at all
   (exact stderr + exit code). Does it pass different args when there are 0 or 1 candidates?
   Test --interactive combined with --list, --score, --all, and with keywords.
5. Exact effect of _ZO_FZF_OPTS: how is it split (shell-like quoting? whitespace?) and where do the
   options land in the argv order? Test embedded quotes, backslashes, unmatched quotes.
6. \`--all\`: exact effect on output.
7. Repeated/duplicate flags, flags after --, unknown flags: exact clap error text and exit codes.
8. Does \`query\` modify the database (mtime/bytes) in any case?
9. Does \`query\` respect _ZO_EXCLUDE_DIRS? _ZO_RESOLVE_SYMLINKS?
10. Behavior when stdout is not a TTY vs TTY (use \`script -qc\` to get a pty) — any difference in
    output or in whether interactive mode is auto-enabled?

Report exact literal strings and exact fzf argv (one arg per line).`,
  },
  {
    key: 'addremove',
    prompt: `Reverse-engineer zoxide 0.9.9's \`add\` and \`remove\` subcommands and the env vars
_ZO_EXCLUDE_DIRS, _ZO_RESOLVE_SYMLINKS, _ZO_DATA_DIR, _ZO_ECHO.

Determine:
1. \`add\`: path normalization. Test relative paths, ".", "..", "a/./b", "a/../b", trailing slashes,
   double slashes, "~", empty string, a path to a file (not a dir), a nonexistent path, a symlink to
   a dir, a very long path, a path with newlines/unicode/spaces. For each: is it stored? in what
   normalized form? exact stderr + exit code on failure.
   IMPORTANT: does add require the directory to exist?
2. Multiple paths in one \`add\` invocation: all added? what if one fails — are the others still
   added? Order in db?
3. \`add\` with no paths: exact error. \`add --score\` without value: exact error.
4. _ZO_EXCLUDE_DIRS: exact glob syntax supported. Test: exact path, trailing /*, /**, ?, [abc],
   [!abc], {a,b}, leading ~, relative patterns, empty pattern, multiple patterns separated by ':'
   (and confirm the separator on Linux), an empty element, and whether the pattern must match the
   whole path or a prefix. Does '*' cross '/' boundaries? Does it apply to \`add\` only or also to
   \`query\`/\`import\`/\`edit\`? What is the DEFAULT value when the var is unset (README says $HOME)?
   Does an excluded dir already in the db get removed?
5. _ZO_RESOLVE_SYMLINKS=1: exact effect on add. What values count as true ("1", "true", "0", "",
   "yes", "TRUE")?
6. _ZO_DATA_DIR: relative value? nonexistent nested dirs (created recursively?)? empty value?
   a value that is a file? Also test the fallback chain: unset _ZO_DATA_DIR with XDG_DATA_HOME set,
   with XDG_DATA_HOME unset but HOME set, with both unset. Exact error text if it can't be resolved.
7. \`remove\`: exact semantics. Does it normalize the path the same way as add? Exit code and exact
   stderr when the path is not in the db. Multiple paths. No paths at all (does it start fzf? test
   with a fake fzf on PATH — log argv and stdin). Removing a nonexistent-on-disk path that IS in the db.
8. _ZO_ECHO=1: what does it change for \`query\`/\`add\`? (Check whether the binary itself does
   anything with it, versus only the init script.)
9. Does \`add\` print anything on success? Exact exit codes for every case.

Report exact literal stderr strings and exit codes.`,
  },
  {
    key: 'editimport',
    prompt: `Reverse-engineer zoxide 0.9.9's \`edit\` and \`import\` subcommands.

fzf is not installed. Create a fake \`fzf\` script early on PATH that logs its argv and stdin to a
file and prints controllable output with a controllable exit code. Use it to observe the \`edit\`
TUI integration. This is normal interface observation and is allowed.

Determine:
1. \`edit\` with no subcommand: what does it do? Exact fzf argv (one per line) and exact stdin bytes
   (hexdump). What keybindings/--bind strings does it pass? Reproduce them EXACTLY — they are long.
   What happens on fzf exit codes 0, 1, 2, 130, and when fzf is missing (exact stderr + exit code)?
2. The hidden subcommands \`edit increment <PATH>\`, \`edit decrement <PATH>\`, \`edit delete <PATH>\`,
   \`edit reload\`: exact effect on the db, exact stdout/stderr, exit codes, path normalization, and
   behavior when the path is absent from the db. Are they listed in \`edit --help\`? Any others?
   Probe for additional hidden subcommands by trying plausible names and reading the clap error
   (the error lists valid values sometimes).
3. \`import --from=autojump <PATH>\` and \`--from=z <PATH>\`: create sample input files and determine
   the EXACT parse rules for each format (field separator, field order, how rank is converted,
   how timestamps are handled, blank lines, comments, malformed lines, trailing newline absence,
   non-UTF8, duplicate paths, relative paths, and whether the imported paths are normalized/validated).
   For 'z' format, determine what the fields are and how epoch/rank map into zoxide's rank+timestamp.
4. \`import\` without --merge into a NON-empty db: exact stderr + exit code. Into an empty db?
   Into a db file that does not exist yet?
5. \`import --merge\`: exact merge rule when a path exists in both (are ranks summed? max? what about
   the timestamp?).
6. \`import\` with a nonexistent file, a directory, an unreadable file: exact stderr + exit code.
7. \`import\` missing --from, bad --from value, missing PATH, extra args: exact clap error text.
8. Does import apply _ZO_EXCLUDE_DIRS or the aging/_ZO_MAXAGE logic?

Report exact literal strings (especially the fzf --bind arguments, byte for byte) and exit codes.`,
  },
  {
    key: 'clap',
    prompt: `Reverse-engineer the EXACT command-line parsing behavior and all help/error text of
zoxide 0.9.9 (/workspace/executable). It uses a clap-like parser. I need to reproduce every byte.

Produce a complete catalogue of:
1. Exact \`--help\` output for: top level, and each of add, edit, import, init, query, remove, and
   the hidden \`edit increment|decrement|delete|reload\`. Note that the argv[0] name appears in the
   Usage line — run it via a symlink named something else (e.g. ln -s /workspace/executable /tmp/x/zoxide)
   to confirm how the program name and the "zoxide-add"-style display name are derived, and whether
   the version line uses argv[0] or a hardcoded name. Report byte-exact text INCLUDING trailing
   whitespace on each line (pipe through \`cat -A\` and report).
2. \`-h\` vs \`--help\`: identical? \`-V\` vs \`--version\`: exact text. Does each subcommand support -V?
   Does \`help\` work as a subcommand (e.g. \`executable help add\`)? Is there a \`--help\` after \`--\`?
3. Which stream does help go to (stdout/stderr) and what exit code, for: explicit --help (0?),
   no args (2?), unknown subcommand, missing required arg, bad enum value, unknown flag,
   flag given a bad value, missing value for a flag.
4. Exact error text for each failure mode above. Include the "For more information, try '--help'."
   style trailer if present, blank lines, and the exact "Usage:" block echoed with errors.
   Test: unknown subcommand \`executable foo\`; typo close to a real one (\`executable ad\`,
   \`executable quer\`) to see if there is a "tip: a similar subcommand exists" suggestion;
   unknown flag \`query --bogus\`; near-miss flag \`query --lis\` and \`query --intractive\`
   (suggestions?); \`init\` with no shell; \`init badshell\`; \`init bash --hook bogus\`;
   \`init bash --cmd\` (missing value); \`add --score\` (missing value); \`add --score x\`;
   \`import\` without --from; \`import --from=bogus f\`; abbreviated long flags (\`query --lis\` —
   is prefix matching enabled?); combined short flags (\`query -ls\`, \`query -lsa\`);
   \`query -l -l\` repeated; negative-number-looking args (\`query -1\`); args after \`--\`;
   an argument that is exactly \`--\`; empty string args.
5. Whether long flags accept \`--flag=value\` and \`--flag value\` both. Whether short flags accept
   \`-sVALUE\` and \`-s VALUE\` and \`-s=VALUE\`.
6. Any hidden/undocumented top-level flags or subcommands. Probe systematically for plausible ones
   and report what the error message reveals (e.g. does the possible-values list in an error mention
   values not shown in help?).
7. Is there completion generation? Try \`executable init --help\` for hidden flags, and probe
   subcommand names like \`completions\`, \`doctor\`, \`version\`, \`help\`.
8. Does the binary respond to NO_COLOR / TERM / CLICOLOR / --color? Is help ever colorized when
   stdout is a pty? Use \`script -qc 'cmd' /dev/null | cat -v\` to check for ANSI escapes in help
   and error output on a pty. Report exact escape sequences if any.
9. Locale/encoding: non-UTF8 argv bytes — exact error?

This is the single most important probe for byte-exactness. Be exhaustive and report literal text in
fenced blocks, using cat -A output so trailing spaces and line endings are unambiguous.`,
  },
  {
    key: 'initenv',
    prompt: `Reverse-engineer how zoxide 0.9.9's \`init <SHELL>\` output changes with environment
variables and flags.

The 9 shells are: bash, elvish, fish, nushell, posix, powershell, tcsh, xonsh, zsh.

For EACH shell, determine exactly which parts of the emitted script change with:
1. _ZO_RESOLVE_SYMLINKS set to 1 (and to other values: 0, "", "true", "yes", "TRUE", "01") —
   which lines change, and what do they become?
2. _ZO_ECHO set to 1 (and other values as above) — which lines change?
3. Both together.
4. --hook none | prompt | pwd.
5. --no-cmd, and --cmd with various values: "j", "cd", "" (empty), a value with spaces, a value with
   shell metacharacters (\$, ", ', \\, \`, ;, |, (), {}, %, #), a unicode value. Is the value escaped
   or quoted anywhere per shell? Report the exact substitution sites for each shell (which lines
   contain the cmd and in what form, e.g. \`z\` vs \`zi\` vs \`__zoxide_z\`).
   IMPORTANT: is there validation on --cmd (e.g. rejecting empty or invalid identifiers)? Exact error.
6. Whether _ZO_DATA_DIR, _ZO_MAXAGE, _ZO_EXCLUDE_DIRS, _ZO_FZF_OPTS affect init output at all.
7. Whether init output ends with a trailing newline; whether it contains any CRLF (check powershell
   and nushell especially with \`od -c | tail\`).
8. Whether init writes/creates the database or the data dir.
9. Exit code of init, and where output goes (stdout).

Deliverable: for each of the 9 shells, a table of (variable/flag) -> (exact diff of the emitted
script), using unified diff output against the default. Use \`diff -u\` and paste it verbatim.
Do not summarize the diffs — paste them exactly, they will be used to build templates.`,
  },
]

phase('Explore')

const results = await parallel(PROBES.map(p => () =>
  agent(RULES + '\n\n# YOUR PROBE\n' + p.prompt, { label: `probe:${p.key}`, phase: 'Explore' })
    .then(r => ({ key: p.key, report: r }))
))

return results.filter(Boolean)
