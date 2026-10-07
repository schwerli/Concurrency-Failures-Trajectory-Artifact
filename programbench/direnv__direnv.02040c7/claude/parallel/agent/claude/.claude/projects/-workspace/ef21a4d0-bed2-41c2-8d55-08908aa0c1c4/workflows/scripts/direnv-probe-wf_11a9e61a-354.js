export const meta = {
  name: 'direnv-probe',
  description: 'Fan out behavioral probes of the direnv binary across all command/format surfaces',
  phases: [
    { title: 'Probe', detail: 'one agent per behavioral area, writes notes to /tmp/notes' },
    { title: 'Gaps', detail: 'completeness critic finds unprobed surface' },
  ],
}

const HARNESS = `Read /tmp/probe/HARNESS.md FIRST — it contains the rules and the isolation recipe. Obey it strictly.`

const AREAS = [
  {
    key: 'shell-escaping',
    title: 'Exact escaping/quoting rules for every export target shell',
    prompt: `Determine the EXACT byte-level escaping function used by \`direnv export SHELL\` for each of:
bash, zsh, fish, tcsh, elvish, pwsh, murex, json, gha, gzenv, systemd, vim.

Method: create an .envrc that exports one variable at a time with a hostile value, allow it, then
run \`direnv export <shell> 2>/dev/null | od -c\`. Because output order is randomised, isolate ONE
variable per run and grep for it, or use a tiny .envrc with a single export.

Cover at minimum these value payloads (use bash $'..' or printf to build them):
  empty string, "a b", single quote, double quote, backslash, backtick, dollar, bang, percent,
  equals sign, newline (\\n), CR (\\r), tab (\\t), bell (\\a), backspace (\\b), formfeed (\\f),
  vertical tab (\\v), ESC (\\e), NUL is impossible in env so skip, byte 0x01, byte 0x7f,
  DEL, latin1 high bytes via UTF-8 (é), a 3-byte UTF-8 char (→), a 4-byte UTF-8 char (emoji),
  an invalid UTF-8 byte sequence if you can inject one, a very long value, a value that is
  only whitespace, a value with leading/trailing spaces, "\\$(id)", "\${HOME}", "*", "?", "[a]",
  "#comment", ";semi", "|pipe", "&amp;amp", "(paren)", "{brace}", "<>", "~tilde", ":colon", ",comma",
  "+plus", "/slash", "@at", "^caret", "0leadingdigit".
Also cover hostile VARIABLE NAMES if direnv lets them through (e.g. names with dots or dashes:
  \`export 'a-b=1'\` is not valid bash but \`env 'a-b=1' ...\` may be).

For each shell record: the exact statement template, the separator between statements, whether a
trailing separator/newline is emitted, and the exact per-character escape table. For unset/removed
variables record the "unset" statement template too (produce one by loading an .envrc that
\`unset\`s a variable that existed in the parent env, and by leaving the directory).
Write notes to /tmp/notes/shell-escaping.md`,
  },
  {
    key: 'gzenv-format',
    title: 'gzenv codec exact bytes',
    prompt: `Reverse the exact "gzenv" codec used for DIRENV_DIFF, DIRENV_WATCHES and \`direnv export gzenv\`.

Known: it is base64url(zlib(json)). Determine precisely:
- Is the base64 alphabet URL-safe with padding ('=' present)? Confirm on several sizes.
- What zlib compression level / flush strategy? Hint: outputs end with "AAD__" before the final
  bytes which is a Z_SYNC_FLUSH empty stored block (00 00 ff ff). Reproduce byte-identical output
  with python zlib: try \`zlib.compressobj(level, zlib.DEFLATED, 15)\` + compress + flush(Z_SYNC_FLUSH)
  + flush(), and try Go-style: zlib.NewWriter(w); w.Write(json); w.Flush(); w.Close().
  Report the EXACT recipe that reproduces the binary's bytes for a given JSON input, and which
  compression level matches (try 1..9 and default -1).
- The exact JSON serialisation: key order (sorted?), escaping of non-ASCII (does it use \\uXXXX?),
  escaping of <, >, & (Go's encoding/json escapes those by default as \\u003c etc), whether HTML
  escaping is on. Test by exporting a variable whose value contains < > & and non-ASCII, then
  decoding DIRENV_DIFF and inspecting the RAW decompressed json bytes.
- Whether the JSON has a trailing newline.
- \`direnv export gzenv\`: decode it, describe the exact top-level structure.
- \`direnv show_dump <dump>\` and \`direnv dump gzenv\` round trips.
To decode, you may use python3 (base64, zlib).
Write notes to /tmp/notes/gzenv-format.md`,
  },
  {
    key: 'dump',
    title: 'dump / apply_dump / show_dump / dotenv private commands',
    prompt: `Fully characterise these private commands:
  direnv dump [SHELL] [FILE]
  direnv apply_dump FILE
  direnv show_dump DUMP
  direnv dotenv [SHELL] [PATH_TO_DOTENV]

For \`dump\`: default shell when omitted? behaviour of the FILE argument (2nd arg) — note the
stdlib calls \`"$direnv" dump json "" >&3\` with an empty second arg. What does empty mean?
What does DIRENV_DUMP_FILE_PATH env var do (stdlib sets it in direnv_load)? Test all shells.
Which env vars are included/excluded from a dump? (compare \`env\` to the dump)

For \`apply_dump\`: feed it a dump file, observe generated bash. What happens with a missing file,
empty file, malformed content?

For \`show_dump\`: feed it gzenv strings and garbage.

For \`dotenv\`: this parses .env files. Determine the FULL .env grammar it accepts. Test:
  KEY=value / KEY = value / export KEY=value / KEY="v" / KEY='v' / multiline double-quoted values /
  \\n inside double quotes / comments (# at line start, # after value, # inside quotes) /
  blank lines / lines with no '=' / KEY= (empty) / duplicate keys / leading whitespace /
  CRLF line endings / values with = in them / 'KEY: value' YAML style / backslash escapes in
  single vs double quotes / \${VAR} interpolation / \`command\` substitution / quotes not closed.
  Report exact output and error messages for each. Test all SHELL values for the dotenv subcommand.
Write notes to /tmp/notes/dump.md`,
  },
  {
    key: 'env-diff',
    title: 'The environment diff algorithm and which variables are ignored',
    prompt: `Reverse engineer direnv's environment diffing rules exactly.

Determine:
- The set of variable names that are IGNORED by the diff (never exported/unexported, never appear
  in DIRENV_DIFF's "p"/"n" maps). Candidates to test: DIRENV_*, all of DIRENV_DIR/FILE/WATCHES/DIFF/
  BASH_PATH/CONFIG/IN_ENVRC/DUMP_FILE_PATH/WARN_TIMEOUT/LOG_FORMAT, COMP_WORDBREAKS, PS1, PS2, PS3,
  PS4, SHELLOPTS, BASH_FUNC_*, IFS, OPTERR, OPTIND, PWD, OLDPWD, SHLVL, _, TMPDIR, HOME, SHELL.
  Method: put \`export X=changed\` in an .envrc for each candidate and see whether the export shows
  up in the shell output and in the "direnv export: +X/~X/-X" summary line.
- The exact format of the summary log line: "direnv export: +NEW ~CHANGED -REMOVED". What are the
  sigils, the ordering (sorted? grouped?), and the separator? Produce a case with many of each.
- What happens when a variable is unset by the .envrc but existed before (does it show as -X)?
- What happens when leaving the directory (unloading) — what is logged and what statements are
  emitted (e.g. "direnv: unloading")?
- How is PATH handled specially, if at all?
- Round trip: after loading, run export again from the same dir with DIRENV_* set — verify it is a
  no-op (no output at all?) and what exactly gets printed.
Test by capturing DIRENV_DIFF / DIRENV_WATCHES from a first run and feeding them back in the env
of a second run.
Write notes to /tmp/notes/env-diff.md`,
  },
  {
    key: 'loading-lifecycle',
    title: 'Load/unload/reload lifecycle, .envrc vs .env discovery, DIRENV_DIR semantics',
    prompt: `Characterise direnv's load/unload state machine driven purely by \`direnv export bash\`
with hand-crafted DIRENV_* environment variables.

Cover:
- Discovery: walking up from cwd looking for .envrc then .env. Which wins in the same dir? In a
  parent vs child dir? Does the .env only get considered when config load_dotenv=true? Test both.
- Nested projects: /a/.envrc and /a/b/.envrc — what is logged when moving between them.
- Leaving the tree entirely: what statements + logs.
- \`direnv reload\` — what does it do exactly (exit code, output, does it need to be inside a
  loaded env?). What error when not in a direnv dir?
- \`direnv exec DIR CMD ARGS\` — exact semantics, exit code propagation, what if DIR is a file,
  what if DIR doesn't exist, what if CMD not found (exit code 127?), signal handling, is DIR
  allowed to be relative? What env does the child see? Test \`direnv exec . env\`.
- \`direnv edit [PATH]\` — behaviour with EDITOR unset/set, with no .envrc present, exit codes,
  what it prints. Use EDITOR=touch or EDITOR=true to avoid interactivity.
- Stale-ness: DIRENV_WATCHES containing an mtime that no longer matches → reload. A watched file
  that gets deleted. A watched file that appears. Confirm the exact log lines.
- What happens when DIRENV_DIFF is corrupt / DIRENV_WATCHES is corrupt.
- The mtime granularity used in watches (seconds? nanoseconds?).
- Does direnv follow symlinks / resolve .. in paths for the RC path?
Write notes to /tmp/notes/loading-lifecycle.md`,
  },
  {
    key: 'allow-block',
    title: 'allow / block / deny / permit / grant / revoke / prune, and whitelist config',
    prompt: `Characterise the authorization subsystem exhaustively.

- All aliases: allow, permit, grant / block, deny, disallow, revoke. Verify each works.
- With and without a PATH_TO_RC argument; with a directory argument; with a nonexistent path; with
  a path to a non-.envrc file (e.g. foo.sh); relative vs absolute; with \`~\` in it.
- Exact stdout/stderr/exit code for every case, including error messages.
- What files are written where (list the allow/deny dirs after each op), permissions (stat -c %a),
  and file contents.
- Does \`allow\` print anything? Does it touch mtimes of anything?
- \`direnv prune\`: create stale allow entries (allow a file then delete the file, or edit it) and
  see which get pruned. Also test the "required" DB. Exact output.
- The \`[whitelist]\` config in ~/.config/direnv/direnv.toml: test both \`prefix\` and \`exact\`,
  with \`~\` expansion, with trailing slashes, with a directory name for \`exact\`, and verify
  \`direnv status\` output reflects them. Confirm a whitelisted .envrc loads without allow, and
  that \`direnv status\` prints "Found RC allowed 2" or similar. Enumerate the numeric values of
  the "Found RC allowed N" field for: allowed-by-file, denied, not-allowed, whitelisted.
- \`direnv current PATH\` private command: exit codes and messages for current/stale/missing.
- \`direnv check-required SHELL ENVRC_PATH PATH...\`: what does it emit? Build the required DB by
  using \`require_allowed\` in an .envrc and running allow. Inspect
  $HOME/.local/share/direnv/required/ contents and naming.
Write notes to /tmp/notes/allow-block.md`,
  },
  {
    key: 'config-toml',
    title: 'direnv.toml parsing and every config key',
    prompt: `Reverse the config file handling.

- Locations tried, in order: $DIRENV_CONFIG, $XDG_CONFIG_HOME/direnv, $HOME/.config/direnv.
  Also test whether \`config.toml\` (legacy) is still read alongside \`direnv.toml\`.
- Every documented key: global.bash_path, global.disable_stdin, global.load_dotenv,
  global.strict_env, global.warn_timeout, global.hide_env_diff, global.log_format,
  global.log_filter; whitelist.prefix, whitelist.exact. Also probe for UNDOCUMENTED keys by
  observing \`direnv status\` output and by trying plausible names (e.g. skip_dotenv,
  hide_env_diff, log_format). What does status print for each?
- Behaviour of a malformed TOML file: exact error message and exit code. Unknown key: ignored or
  error? Wrong type for a key: error message?
- What TOML syntax is actually supported? Test: comments, bare vs quoted keys, single vs double
  quoted strings, literal strings, multi-line strings, arrays (with trailing comma, multi-line),
  booleans, integers, inline tables, dotted keys (global.bash_path = x at top level), duplicate
  tables, [global] appearing twice.
- DIRENV_WARN_TIMEOUT env var override; DIRENV_LOG_FORMAT env var; DIRENV_BASH_PATH env var;
  DIRENV_DISABLE_STDIN. Which env vars override which config keys? Test each.
- log_format: what are the substitution tokens? Try "%s", "custom: %s", "-", "", "[%s]".
  Does it apply to error lines too? Is there a separate error format? Try DIRENV_LOG_FORMAT.
- log_filter: give a regex and confirm which lines are dropped. Is it match=drop or match=keep?
- warn_timeout: set it to 1ms and make an .envrc that sleeps, capture the warning text verbatim.
- hide_env_diff: confirm the "direnv export: ..." line disappears.
- strict_env: confirm \`set -euo pipefail\` behaviour difference.
- bash_path: point it at a non-bash / nonexistent path and record the error.
Write notes to /tmp/notes/config-toml.md`,
  },
  {
    key: 'watches',
    title: 'watch / watch-dir / watch-list / watch-print / current',
    prompt: `Characterise the watch subsystem private commands.

  direnv watch SHELL PATH...
  direnv watch-dir SHELL DIR
  direnv watch-list [SHELL]
  direnv watch-print [--null]
  direnv current PATH

For each: argument validation, output format for every SHELL value, exit codes, error messages.
- \`watch\`: with 0 paths, with a nonexistent path, with a relative path, with a directory, with
  duplicate paths, with a path already in DIRENV_WATCHES (dedup? order?). How is the resulting
  DIRENV_WATCHES built — decode it. Are paths made absolute? Is the list sorted or insertion
  ordered? Is there an implicit inclusion of the .envrc / allow / deny paths?
- \`watch-dir\`: recursion behaviour, what entries appear (the dir itself? each file? each subdir?),
  hidden files, symlinks, empty dir, nonexistent dir, a file instead of a dir. Does it skip
  anything (e.g. .git)?
- \`watch-list\`: reads "mtime path" pairs from stdin per the help text. Determine the exact input
  grammar (separator, how many fields, what happens on malformed lines) and the output.
- \`watch-print\`: prints watched paths from DIRENV_WATCHES; test --null; test with empty/absent
  DIRENV_WATCHES.
- \`current PATH\`: exit codes and messages when the path matches the recorded mtime, when it is
  stale, when it is not in the watch list, when the file is gone.
Write notes to /tmp/notes/watches.md`,
  },
  {
    key: 'cli-surface',
    title: 'CLI dispatch, help text, version, log, and all error messages',
    prompt: `Nail down the CLI layer byte-for-byte.

- \`direnv\` with no args: exact output + exit code.
- \`direnv <unknown>\`: exact error.
- \`direnv help\`, \`direnv help 1\`, \`direnv help anything\`, \`direnv help 0\`, \`direnv help ""\`:
  what argument turns on private commands? Capture the FULL help text verbatim to a file
  (note: the "Supported SHELL values are: [...]" list is in random order).
- Are there global flags? Try --help, -h, --version, -v, --json, -- , and \`direnv --foo\`.
- Are command names matched exactly or by prefix? Try \`direnv allo\`, \`direnv EXPORT\`,
  \`direnv Allow\`.
- \`direnv version\`: bare; with a version arg that is lower / equal / higher / malformed /
  "1.0" / "v2.37.1" / "2.37" / "2.37.1.1" / "abc". Exact messages and exit codes.
- \`direnv log\`: flags -status/-error/--status/--error, no flag, multiple args, empty message,
  message with newlines, message that looks like a flag. Exact bytes (use od -c).
- Colour: does colouring depend on isatty? Test with stderr redirected to a file vs a tty
  (use \`script -qec\` if available). Test NO_COLOR=1, TERM=dumb, CLICOLOR=0, DIRENV_LOG_FORMAT.
- \`direnv export\` with no shell / unknown shell / extra args.
- \`direnv hook\` with no shell / unknown shell / extra args.
- \`direnv stdlib\` with extra args. Does the embedded \`direnv="..."\` line reflect argv[0],
  a resolved absolute path, or a symlink target? Test by copying/symlinking the binary elsewhere
  and invoking via a relative path, via PATH, and via a symlink.
- Exit code for every failure mode.
Write notes to /tmp/notes/cli-surface.md`,
  },
  {
    key: 'fetchurl',
    title: 'fetchurl and the CAS',
    prompt: `Characterise \`direnv fetchurl <url> [<integrity-hash>]\`.

There is probably NO internet access — that itself is a case to document (exact error text for
DNS failure / connection refused). Use a local HTTP server to test the happy path:
start \`python3 -m http.server\` in a temp dir (bind 127.0.0.1) and fetch from it.

Determine:
- The CAS path: $XDG_CACHE_HOME/direnv/cas, default $HOME/.cache/direnv/cas. Filename encoding of
  the hash (the man page shows sha256-7Gxl...pY+p6+gj5Waohfwql3jHIds= becoming
  sha256-7Gxl5GzI9juc_U30Igh_pY+p6+gj5Waohfwql3jHIds= — so which characters are substituted?).
- The hash format: "sha256-" + base64(digest)? standard base64 with padding? Verify against a
  known file with python3 hashlib.
- File mode of the cached file (stat -c %a) and of the cas dir.
- Output when only the URL is given, both when stdout is a tty and when it is a pipe (the man page
  says only the hash is printed when not a tty). Capture both verbatim — use \`script -qec\` for
  the tty case if available.
- Output when the hash is given and matches; when it mismatches (exact error); when the hash is
  malformed; when the algo is unknown (e.g. md5-..., sha512-...); test sha1/sha512 if supported.
- Behaviour on a cache hit (does it re-download? is the output identical?).
- Non-200 responses (404, 500), redirects (301/302) — set up with a tiny python http server.
- Missing url argument; extra arguments; a non-http scheme (file://, ftp://); a URL with no scheme.
- Does it set a User-Agent? Log the request headers your test server receives and report them all.
Write notes to /tmp/notes/fetchurl.md`,
  },
  {
    key: 'envrc-exec',
    title: 'How the .envrc is actually executed (bash invocation, stdin, timeouts, errors)',
    prompt: `Determine exactly how direnv runs the .envrc.

- Find the bash argv used. Trick: make the .envrc print diagnostics, e.g.
  \`echo "ARGV0=$0" >&2; echo "ARGS=$*" >&2; echo "SHELLOPTS=$SHELLOPTS" >&2;
   echo "BASH_ARGV=\${BASH_ARGV[*]}" >&2; cat /proc/self/cmdline | tr '\\0' ' ' >&2\`
  and \`ps -o args= -p $PPID\`. Also dump \`/proc/$$/cmdline\`. Report the full bash command line,
  and the value of \$0 and \$_.
- What is on fd 3? (the stdlib does \`exec 3>&1\`). Confirm the dump comes back on fd 3.
- The .envrc runs with cwd = the .envrc's directory? Verify.
- What is the exit code / logging when the .envrc exits non-zero, when it doesn't exist, when it
  is not readable, when it is a directory, when it contains a syntax error, when it calls exit 0,
  when it kills itself (kill -9 $$), when it writes to stdout directly.
- Does direnv still apply a partial environment when the .envrc fails? (Check the export output.)
- stdin: is it connected? Test with an .envrc that runs \`read -r x\` and with disable_stdin=true.
- warn_timeout: exact warning text and where it goes; does the .envrc keep running?
- Is there a hard timeout / kill?
- Env the .envrc sees: which DIRENV_* vars are set inside it (\`env | sort\` from the .envrc)?
  Confirm DIRENV_IN_ENVRC=1, and note whether DIRENV_DIFF/WATCHES are visible inside.
- direnvrc loading order: create $HOME/.config/direnv/direnvrc and $HOME/.direnvrc and
  $HOME/.config/direnv/lib/{a,b}.sh and print markers to see the load order and precedence.
- Does direnv unset any variables before running bash (e.g. does it run with a scrubbed env)?
- Confirm what the stdlib's \`$direnv\` variable is set to under various invocation paths.
Write notes to /tmp/notes/envrc-exec.md`,
  },
  {
    key: 'export-json-gha-systemd',
    title: 'Deep-dive: json, gha, gzenv, systemd, elvish, murex, vim export targets',
    prompt: `These targets are less shell-like and deserve their own deep dive.

- json: is the output pretty-printed with 2-space indent? trailing newline? Does it include only
  the new env or a diff? What represents a REMOVED variable in json (null? absent?)? Produce an
  unload case and capture it.
- elvish & murex: appear to be compact JSON. Confirm they are identical to each other and how they
  differ from \`json\`. What about removed vars (the elvish hook does \`if $m[$k] ... else unset-env\`,
  so removed vars are probably empty strings or null — determine which). Trailing newline?
- gha (GitHub Actions): the \`NAME<<ghadelimiter_<32 hex>\` heredoc form. Is the delimiter random
  per variable per run, or derived from the value (e.g. md5 of something)? Run twice with the same
  input and compare. What happens for a REMOVED variable? Does gha write to a file when
  GITHUB_ENV / GITHUB_OUTPUT / GITHUB_PATH are set? Read /workspace/docs/github-actions.md for
  hints on intended behaviour and verify. What if a value contains the delimiter?
- systemd: exact quoting predicate — which characters force quoting, and how are chars escaped
  inside the quotes? Removed variables? Trailing newline?
- vim: \`call setenv('N','V')\` — how are quotes, newlines and tabs escaped? Removed variables
  (does it emit setenv(..., v:null)?). Trailing newline?
- gzenv: what exactly is encoded — the full new env, or the diff? Decode and describe.
- For every one of these: what does the output look like when there is NOTHING to export
  (empty diff)? Is it empty, or "{}" or a newline?
Write notes to /tmp/notes/export-json-gha-systemd.md`,
  },
  {
    key: 'stdlib-integration',
    title: 'stdlib output, embedded path substitution, and stdlib-driven subcommands',
    prompt: `Focus on \`direnv stdlib\` and how the stdlib interacts with the binary.

- Capture \`direnv stdlib\` to a file and confirm it is byte-identical across runs except for the
  \`direnv="..."\` line. Determine EXACTLY what that RHS is under: absolute invocation, relative
  invocation (./executable), invocation through a symlink, invocation via PATH lookup, and when
  argv[0] is something weird (use \`exec -a\` in bash). Does it use os.Executable() (i.e. resolved
  /proc/self/exe) or argv[0]?
- Are there other runtime substitutions in the stdlib text? Diff the output under different
  HOME/XDG settings.
- Does \`direnv stdlib\` end with a trailing newline? How many?
- Verify the stdlib functions that shell out to the binary actually work end-to-end by writing
  .envrc files that use them and capturing output:
  watch_file, watch_dir, dotenv, dotenv_if_exists, require_allowed, source_env, source_up,
  source_env_if_exists, direnv_load, direnv_apply_dump, PATH_add, path_add, PATH_rm, path_rm,
  MANPATH_add, load_prefix, semver_search, expand_path, find_up, user_rel_path, log_status,
  log_error, strict_env, unstrict_env, env_vars_required, has, join_args, direnv_version,
  on_git_branch, layout go/node/php/julia/perl/ruby/python, use vim, direnv_layout_dir.
  For each, record the observable stderr log lines and the resulting exports. Report any that
  FAIL in this environment and why (missing tool) — that's fine, just document it.
- Confirm the exact contents of the CACHEDIR.TAG file that \`layout\` writes.
Write notes to /tmp/notes/stdlib-integration.md`,
  },
]

phase('Probe')
const results = await parallel(AREAS.map(a => () =>
  agent(
    `${HARNESS}\n\nYou are probing area "${a.key}": ${a.title}\n\n` +
    `Use PROBE=/tmp/probe/${a.key} as your scratch root.\n\n${a.prompt}\n\n` +
    `Be exhaustive and empirical. Every claim must be backed by a transcript you actually ran. ` +
    `If something is non-deterministic, run it 5+ times and say so. ` +
    `Remember: the goal is that someone can reimplement direnv from your notes alone.`,
    { label: `probe:${a.key}`, phase: 'Probe' }
  )
))

phase('Gaps')
const gaps = await agent(
  `${HARNESS}\n\nThirteen probe agents just wrote notes into /tmp/notes/*.md covering: ` +
  AREAS.map(a => a.key).join(', ') + `.\n\n` +
  `Read ALL of /tmp/notes/*.md. Then act as a completeness critic for a reimplementation effort:\n` +
  `1. List every direnv command/flag/config-key/format that is NOT yet characterised, or where the ` +
  `notes are vague, self-contradictory, or unverified.\n` +
  `2. For the top gaps, actually run the binary yourself to fill them in, and append your findings ` +
  `to /tmp/notes/gaps.md (create it).\n` +
  `Use PROBE=/tmp/probe/gaps as scratch. Return the prioritised gap list plus what you resolved.`,
  { label: 'gaps:critic', phase: 'Gaps' }
)

return { probes: AREAS.map(a => a.key), gaps }
