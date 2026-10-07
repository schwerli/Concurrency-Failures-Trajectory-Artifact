export const meta = {
  name: 'nsh-probe-fanout',
  description: 'Fan out behavioral probes of the provided nsh binary and write detailed notes files',
  phases: [
    { title: 'Probe', detail: 'parallel behavioral probing of distinct areas' },
    { title: 'Critique', detail: 'completeness critic per area, then gap-fill' },
  ],
}

const RULES = `
CRITICAL RULES (this is a reverse-engineering benchmark):
- The binary under study is /workspace/executable (nsh 0.4.2, a POSIX-ish shell written in Rust).
- You may ONLY learn about it by RUNNING it with inputs and reading its stdout/stderr/exit codes, and by reading /workspace/README.md and /workspace/docs/*.md.
- You MUST NOT decompile, disassemble, run objdump/nm/strings/readelf/gdb/ghidra, or use strace/ltrace on it. Do not grep the binary for strings. Do not search the web. Do not download or read the original nsh source from anywhere.
- Do not modify /workspace/executable. Do not write anything to /workspace except your own notes file under /workspace/notes/.
- Work in /tmp for scratch files.
- There is NO network access and NO cargo crates registry, so do not try to fetch anything.

USEFUL FACTS ALREADY ESTABLISHED (don't re-derive, but do verify if relevant):
- Usage: executable [FLAGS] [OPTIONS] [FILE]; flags -h/--help, -l/--login, --norc, --version; option -c <command>. Help/version text is clap 2.x style.
- Parse errors print to stderr as: "nsh: parse error: " followed by a pest-crate formatted error, e.g.
    nsh: parse error:  --> 1:6
      |
    1 | echo {a,b}
      |      ^---
      |
      = expected EOI, word, redirect_direction, heredoc, and_or_list_sep, or compound_list_sep
  and the process exits with code 255.
- Unknown command: stderr "nsh: command not found \`NAME'" and exit code 1.
- Some things panic (break/continue/return at top level -> "nsh: panicked at src/main.rs:133:14:\\nunexpected Break" plus a backtrace, exit 101).
- A debug log is appended to ~/.nsh.log.
- Interactive mode uses raw-mode ANSI rendering; /workspace/tools/pty_run.py drives it under a pty (read its docstring for the stdin directive format).

METHOD:
- Write a small shell helper that runs "/workspace/executable -c <snippet>" capturing stdout, stderr and exit code separately, and prints them with unambiguous markers. Compare against bash where useful to note DIFFERENCES (bash is at /bin/bash) - the differences are the interesting part.
- Test MANY snippets (hundreds). Be exhaustive and systematic. Probe edge cases and error paths, not just happy paths.
- Record EXACT byte-level output including spacing and punctuation. Quote outputs verbatim in your notes.
- Prefer 'printf %q' / od -c / cat -A when whitespace matters.

OUTPUT:
- Write a thorough, well-organised markdown notes file at the path given below. It must be detailed enough that someone can reimplement this behaviour without re-running the binary: include verbatim commands and verbatim expected outputs, exit codes, and explicit statements of the inferred rules.
- Your final reply message must be a CONCISE summary (<= 60 lines) of the key findings and where surprises live. The notes file is the real deliverable.
`

const AREAS = [
  {
    key: 'cli',
    file: '/workspace/notes/01-cli-args.md',
    prompt: `Probe AREA 1: command-line argument handling and startup/exit behaviour.

Cover:
- Exact bytes of --version, -h, --help (which stream? exit code?). Try -V, --vers, --help=x, -hc, combined short flags, "-" alone, "--" separator.
- clap-2-style error messages for: unknown flag, missing value for -c, -c given twice, too many positional args, invalid utf8 arg. Record exact text, stream, exit code.
- Running a FILE: create scripts in /tmp and run them. What is $0? What are $1..$n when extra args follow the file? Does it need a shebang? What if the file does not exist / is a directory / is not readable / is empty? Exit codes and messages.
- Reading a script from stdin (no args, stdin not a tty): does "echo 'echo hi' | ./executable" work? What about "./executable < script"? What is the exit status (status of last command)?
- Interaction of -c with a positional FILE and with extra args after -c COMMAND (what are $0/$1/$#?).
- -l/--login and --norc effects that are observable non-interactively.
- Exit status propagation: exit status of the shell when the script's last command fails, when "exit N" with N>255 or negative or non-numeric, when the last command is killed by a signal.
- What env vars does the shell set for children (compare "env" output under nsh -c env vs bash -c env)? Look for things like SHELL, PWD, OLDPWD, IFS, HOME.
- Whether ~/.nshrc / \$XDG_CONFIG_HOME/nsh/nshrc are loaded in -c mode / file mode / stdin mode, and what --norc changes. Test by creating those files (remember to clean up: back up and restore any pre-existing ones, and delete files you create).
- Signal behaviour: does SIGINT to a non-interactive nsh running a sleep propagate? Exit code?

Notes file: /workspace/notes/01-cli-args.md`,
  },
  {
    key: 'grammar',
    file: '/workspace/notes/02-grammar.md',
    prompt: `Probe AREA 2: the GRAMMAR and its pest-generated parse errors. This is the highest-value area; be extremely thorough.

Goal: reconstruct the pest grammar (rule names, ordered choices, and what each rule accepts) precisely enough that a hand-written parser can emit byte-identical error messages.

Cover:
- For a large systematic corpus of malformed inputs, record the EXACT parse error: the " --> LINE:COL" position, the caret line, and the full "= expected ..." list (order matters!). The expected-list is the set of pest rules that could match at the furthest position, in grammar order, deduplicated, rendered as "expected A", "expected A or B", "expected A, B, or C".
- Known rule names so far: EOI, word, redirect_direction, heredoc, and_or_list_sep, compound_list_sep, command, command_span, backtick_span, expr_span, param_ex_span, param_span, literal_in_double_quoted_span, literal_span, tilde_span, any_string_span, any_char_span, proc_subst_direction, double_quoted_span, single_quoted_span, initializer, var_name, heredoc_marker. Find ALL the others by provoking errors in every construct.
- Multi-line inputs: how does pest render the error when the failure is on line 3? Does it show only that line? What does the line-number gutter look like when the line number has 2+ digits? Test with a 10+ line input. Record exact spacing.
- What is the caret line exactly ("^---" vs "^" vs "^^^")? Test a case where the error is at end-of-input vs mid-input.
- Which constructs PARSE successfully (even if unimplemented at runtime)? Systematically test: if/elif/else/fi, while, until, for x in ...; do, for ((;;)), case/esac (all pattern forms, ;;& ;&), functions (name() {...}, function name {...}), subshell ( ), group { }, [[ ]], (( )), pipelines with | and |&, && || !, ; & newline separators, background &, redirections (> >> < <> >& <& 2>&1 &> |& n> n< >| ), heredocs (<< <<- with quoted/unquoted markers), herestrings <<<, process substitution <(...) >(...), assignments prefixing commands, "local", "export x=y", arrays a=(1 2), \${a[0]}, arithmetic \$(( )) and forms inside, brace expansion, comments (#), line continuation (backslash-newline), tilde forms, glob chars, quoting forms including \$'...' and \$"...", ANSI-C escapes.
- For each: does it parse? does it run? what is the output/exit code/error?
- Note precisely where nsh DIVERGES from POSIX/bash in parsing.
- Also record: what happens with an empty command string, only whitespace, only a comment, a trailing "&&" or "|", a lone ";", ";;" at top level.
- IMPORTANT: distinguish parse errors (exit 255, "nsh: parse error:") from runtime errors and from panics (exit 101). Record panic messages' first line exactly (the "panicked at src/main.rs:LINE:COL:" plus the message line) - the backtrace itself varies, but the message does not.

Notes file: /workspace/notes/02-grammar.md`,
  },
  {
    key: 'expansion',
    file: '/workspace/notes/03-expansion.md',
    prompt: `Probe AREA 3: word expansion semantics.

Cover exhaustively, always noting divergence from bash:
- Parameter expansion: \$x, \${x}, \${x:-w}, \${x-w}, \${x:=w}, \${x=w}, \${x:?w}, \${x?w}, \${x:+w}, \${x+w}, \${#x}, \${x#p}, \${x##p}, \${x%p}, \${x%%p}, \${x/p/r}, \${x//p/r}, \${x^}, \${x,}, \${!x}, \${x:offset}, \${x:offset:len}, \${x@Q}. Which are supported? What does an unsupported form do (parse error? literal? panic?)
- Special parameters: \$?, \$\$, \$!, \$#, \$@, \$*, \$0, \$1..\$9, \${10}, \$-, \$_, \$IFS. Behaviour when unset. Quoted "\$@" vs "\$*" vs unquoted, in a function and at top level.
- Word splitting: does nsh split unquoted expansions on IFS? Does changing IFS matter? Test x='a b c'; for w in \$x; do echo "[\$w]"; done and printf-style arg counting via /bin/echo or a helper that prints argc (write a tiny C or python helper that prints each argv on its own line).
- Empty-removal: unset/empty variables as whole words - do they vanish or become empty args? Test with an argv-printing helper.
- Quoting: single, double, backslash inside/outside quotes, escaped chars in double quotes (\\\$ \\" \\\\ \\\` \\n), \$'...' and \$"..." support, adjacent concatenation of differently-quoted spans.
- Tilde: ~, ~/x, ~user, ~unknownuser, ~+, ~-, tilde not at word start, tilde in assignment RHS, tilde after colon.
- Globbing: *, ?, [abc], [a-z], [!a], [^a], **, hidden files, no-match behaviour (literal? error?), glob in middle of path, glob with directories, sorting order, glob in assignment RHS, glob in case patterns, escaped glob chars, quoted glob chars.
- Command substitution: \$(...) and \`...\`, nesting, trailing newline stripping, exit status, \$? after, inside double quotes, splitting of the result, stderr passthrough.
- Arithmetic: \$(( )) operators (+ - * / % ** << >> & | ^ ~ ! && || ?: comparison, unary +/-, ++/--, assignment ops, comma), precedence, variables inside (bare names), nested \$(( )), hex/octal/base#num literals, division by zero, whitespace, errors, empty expression. Also test whether \$[...] works.
- Process substitution <(...) >(...): supported at runtime?
- Assignment semantics: multiple assignments, assignment prefixes to a command (does it persist after?), assignment with no command, exporting, unset, readonly-ness, assignment values that are unquoted with spaces, appending +=.
- Variable scoping: 'local' inside functions, whether functions see caller vars, whether a var set inside a function leaks out, subshell isolation.

Write an argv-printing helper in /tmp (e.g. a python script printing len(argv) and each arg with delimiters) and use it heavily to determine exact word splitting.

Notes file: /workspace/notes/03-expansion.md`,
  },
  {
    key: 'builtins',
    file: '/workspace/notes/04-builtins.md',
    prompt: `Probe AREA 4: builtin commands - exact behaviour, flags, output, error messages, exit codes.

First determine the complete set of builtins: for a large list of candidate names, run "./executable -c 'NAME'" and see whether you get "nsh: command not found \`NAME'" (not a builtin) or something else. Beware that some candidate names exist as external programs in PATH (echo, printf, test, [, pwd, true, false, kill, time, env) - distinguish by comparing behaviour with the external one (e.g. use a modified PATH: PATH= ./executable -c 'echo hi', or compare 'echo' flag handling).
Known-present so far: cd, alias, unset, export, source, eval, exec, jobs, fg, bg, wait, shift, read, pushd, popd, exit, set. Confirm and find the rest (try: echo, pwd, cd, cd -, cd with no args, set, unset, export, alias, unalias, source, eval, exec, exit, jobs, fg, bg, wait, shift, read, pushd, popd, popd, true, false, kill, disown, history, hash, times, umask, getopts, complete, bind, printf, test, [, let, local, return, break, continue, trap, ulimit, .).

For EACH builtin, probe exhaustively:
- no args, --help, -h, bad flags, too many args, and its real functionality.
- exact stdout/stderr text (verbatim!), exit codes.
- Several of these builtins appear to use clap for argument parsing (e.g. 'read' printed a clap-style error: "read: error: The following required arguments were not provided:\\n    <VAR>\\n\\nUSAGE:\\n    read [OPTIONS] <VAR>\\n\\nFor more information try --help"). For every builtin, run it with --help and with bad args and capture the FULL clap usage text verbatim, including which stream it goes to and the exit code.
- cd: relative/absolute, -, no arg with HOME unset, nonexistent dir, file instead of dir, does it set PWD/OLDPWD? does it print anything? What does 'cd -' print?
- export: with and without =value, multiple, exporting an existing var, 'export' with no args output format, unexporting.
- alias: definition forms, quoting in output, alias expansion rules (only first word? recursive? aliases with args? alias containing a pipeline?), unalias.
- set: with no args (output format), set -e, -x, -u, -o pipefail, positional-parameter setting, set --.
- read: all flags (-r? -p? -n?), reading from a pipe, IFS splitting, multiple VAR args, EOF exit code, trailing backslash.
- source: nonexistent file, arguments passed, relative path resolution, whether it uses PATH.
- exec: with and without args, redirections only, nonexistent command.
- jobs/fg/bg/wait/disown: what is observable non-interactively with background jobs.
- pushd/popd: output format, directory stack semantics, no-arg pushd, popd on empty stack.
- Note any builtin that panics.

Notes file: /workspace/notes/04-builtins.md`,
  },
  {
    key: 'exec',
    file: '/workspace/notes/05-exec-redirect-jobs.md',
    prompt: `Probe AREA 5: execution model - redirections, pipelines, jobs, heredocs, control flow status.

Cover:
- All redirection operators that parse and what they do at runtime: > >> < <> >& <& 2> 2>&1 1>&2 &> n>&m n<&m >| exec-style, redirecting to/from a nonexistent path (error message and exit code, exact text), redirecting to a directory, permission-denied target, closing fds (2>&-), fd numbers >9, redirection order/left-to-right semantics, redirection on compound commands (if/while/for/{}/subshell), multiple redirections on one command.
- Heredocs: << MARKER, <<- MARKER (tab stripping), quoted markers ('EOF' "EOF" \\EOF) - is expansion applied inside? Nested/multiple heredocs on one line. Heredoc with -c on a single line (how do you even provide the body?). Heredoc in a script file. Missing terminator. Heredoc combined with pipes. Record exact behaviour and exit codes.
- Pipelines: exit status of a pipeline (last command? pipefail?), multi-stage, SIGPIPE behaviour (e.g. 'yes | head -1'), pipeline with builtins (does 'echo x | read v; echo \$v' see v? i.e. are pipeline stages subshells?), stderr not piped, pipeline inside if.
- Lists: && || ! precedence and status, ; and newline, & background: what does nsh print when a job starts/finishes in non-interactive mode? Does 'sleep 0.1 &' wait? \$! value. 'wait' semantics and status.
- Subshells ( ) vs groups { }: variable isolation, cd isolation, exit inside, status.
- Control flow: exit status of if with no else and false condition, while/until/for status, empty for list, break/continue INSIDE loops (do they work there even though they panic at top level? test 'for i in 1 2 3; do break; done', nested loops, break 2, continue in while), return inside a function, return outside, function exit status, recursion, functions with redirections, unset function, function named like a builtin.
- case: pattern matching details (globs, |-alternatives, quoting in patterns, no match status, fallthrough forms).
- Signals/timing: what happens to a foreground child on SIGINT, exit status 128+N for signal-killed children (test with 'kill -9 \$\$' style or a helper that raises SIGSEGV), and what nsh prints for a killed child.
- Command lookup: PATH search order, hashing, executing a path with slash, non-executable file (message + exit code, exact text), directory as command, file with bad shebang, empty PATH, PATH with empty component, relative path without ./ .
- exit status when command not found (should be 1 per earlier probe - confirm) and when not executable.

Notes file: /workspace/notes/05-exec-redirect-jobs.md`,
  },
  {
    key: 'interactive',
    file: '/workspace/notes/06-interactive.md',
    prompt: `Probe AREA 6: INTERACTIVE mode byte-exact terminal rendering and line editing.

Use /workspace/tools/pty_run.py (read it first; it takes directives on stdin: "s <text>" to send with backslash escapes, "w <secs>" to wait, "e" for ^D, "q" to quit; it prints a raw repr of everything the shell wrote). Always pass --norc unless testing rc loading. Set --cols/--rows to control the window size.

Already known from one session (80 cols, cwd /tmp):
- On each prompt nsh first writes: ESC[1m ESC[7m "$" ESC[0m then 79 spaces then CR   (a "no trailing newline" marker line)
- then the prompt: ESC[36m ESC[1m "/tmp $" ESC[0m " "
- then per keystroke: ESC[?25l CR ESC[7C ESC[K <highlighted input> CR ESC[<col>C ESC[?25h
- command words are coloured ESC[38;5;10m when found in PATH and ESC[38;5;9m when not.

Determine precisely:
- The default prompt string and how it renders (colours, current_dir abbreviation - does \$HOME become ~? how are long paths handled?).
- The exact leading "marker" line: how many spaces for different --cols values; when is it emitted; what if the previous command output ended WITH a newline vs without.
- The exact redraw protocol for: typing, backspace, arrow keys (left/right/up/down), Home/End, ^A ^E ^C ^D ^K ^W ^L ^R ^H, Alt+f/Alt+b, Alt+Right/Alt+Left, M-q, Delete, Tab, Enter on empty line, Enter on whitespace-only line.
- Syntax highlighting rules: which words get which colour (commands vs args vs quotes vs variables vs redirections vs comments); what about the second word after a pipe or ; or &&; aliases and builtins and functions - are they green? What about "cd" (builtin) vs a nonexistent command? Paths that exist as files?
- The completion UI (Tab): what is displayed, how candidates are laid out, what if there are 0/1/many candidates, how to select, escape.
- History: Up/Down behaviour, ^R search UI (exact rendering), ^H "search history in current dir" UI, and the ~/.nsh_history file format (verify the documented "time<TAB>cwd<TAB>cmd" format by running commands and dumping the file with cat -A; note whether it is written immediately or at exit, and whether duplicates are deduplicated).
- Multi-line input: what happens on Enter when the input is incomplete (e.g. 'if true; then')? Is there a continuation prompt? Exact bytes.
- What is printed on exit (^D on empty line vs 'exit')? Any farewell text? Does it restore the terminal (ESC sequences at exit)?
- Ctrl-C at the prompt and during a running foreground command.
- Whether SIGWINCH/resize is handled.
- Whether a nonzero exit status of the previous command changes the prompt.
- Does it print a right-hand-side prompt / clock? Any use of alternate screen?

Record RAW repr() byte strings verbatim in the notes - they are the specification.

Notes file: /workspace/notes/06-interactive.md`,
  },
  {
    key: 'config',
    file: '/workspace/notes/07-config-prompt-history.md',
    prompt: `Probe AREA 7: configuration, PROMPT template language, history file, and completion machinery.

Cover:
- nshrc loading: exact search order between \$XDG_CONFIG_HOME/nsh/nshrc and ~/.nshrc (which wins? both loaded?). What if XDG_CONFIG_HOME is unset? Is it loaded in -c mode, in FILE mode, in stdin mode, in interactive mode? What does --norc do? What if nshrc has a syntax error or a failing command - is anything printed? Does nshrc see \$0/\$@? (BACK UP and RESTORE any pre-existing ~/.nshrc and \$XDG_CONFIG_HOME/nsh/nshrc; clean up files you create.)
- The PROMPT template language (docs/prompt.md). Exhaustively determine the rendering of every documented directive and probe undocumented ones: \\{username} \\{hostname} \\{current_dir} \\{reset} \\{bold} \\{underline} \\{red} \\{blue} \\{green} \\{yellow} \\{cyan} \\{magenta} \\{repo_status} \\n \\if{cond}{then}{else} with conds in_remote/in_repo. Find the exact ANSI escape emitted for each. What happens with an unknown directive like \\{foo}? Malformed template (unclosed brace)? A literal backslash? Other escapes (\\t, \\\\, \\{)? Is PROMPT read from the environment or only set via nshrc? Is there a PROMPT2/RPROMPT? Test by setting PROMPT in nshrc or via env and driving the shell under a pty (use /workspace/tools/pty_run.py). Determine how {current_dir} renders \$HOME (as ~?) and the root dir, and what {repo_status} looks like inside a git repo in various states (clean, dirty, staged, untracked, detached HEAD, no commits, branch name) - /workspace is a git repo you can copy to /tmp to mutate.
- What is the DEFAULT prompt when PROMPT is unset? Exact bytes.
- History file ~/.nsh_history: exact format (cat -A), when written, dedup, max size, what happens with a corrupt/short line, whether it is read at startup, whether the interactive history is per-directory-filterable (docs mention ^H).
- Completion: docs say nsh shells out to bash for completion, loading scripts from /usr/local/etc/bash_completion.d, /usr/etc/bash_completion.d, /etc/bash_completion.d. Verify observable behaviour: does it spawn bash at startup? (You may observe process trees with ps, that is not binary analysis.) What completions work with no bash-completion scripts installed (file/dir completion? command name completion?). Test under a pty.
- Any other environment variables nsh reads (e.g. PATH, HOME, TERM, PROMPT, SHELL, LANG, NSH_*)? Probe by setting odd values and observing.

Notes file: /workspace/notes/07-config-prompt-history.md`,
  },
]

phase('Probe')

const results = await pipeline(
  AREAS,
  (a) => agent(`${RULES}\n\n${a.prompt}`, { label: `probe:${a.key}`, phase: 'Probe' }),
  (summary, a) => agent(
    `${RULES}\n\nYou are a COMPLETENESS CRITIC + GAP FILLER for a behavioural probe of /workspace/executable.\n\n` +
    `A previous agent probed the area below and wrote notes to ${a.file}. Read that notes file.\n\n` +
    `Their brief was:\n${a.prompt}\n\nTheir summary was:\n${summary || '(no summary returned)'}\n\n` +
    `Your job:\n1. Identify what the notes MISS or state vaguely/incorrectly: constructs not tested, error paths not provoked, outputs not recorded verbatim, rules asserted without evidence, edge cases skipped.\n` +
    `2. Actually RUN the missing probes yourself against /workspace/executable.\n` +
    `3. APPEND a "## Gap-fill (round 2)" section to ${a.file} with your new verbatim findings, and CORRECT any wrong claims in place (edit the file).\n` +
    `Be aggressive: assume the first pass missed a lot. Aim to add substantial new detail.\n` +
    `Your final reply: <= 40 lines listing what you corrected and what you added.`,
    { label: `gapfill:${a.key}`, phase: 'Critique' }
  ),
)

return { areas: AREAS.map((a) => a.file), critiques: results }
