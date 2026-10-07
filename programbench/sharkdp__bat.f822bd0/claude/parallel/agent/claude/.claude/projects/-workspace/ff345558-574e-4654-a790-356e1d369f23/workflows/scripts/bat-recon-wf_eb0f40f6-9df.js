export const meta = {
  name: 'bat-recon',
  description: 'Probe the bat binary across behavioral dimensions and write detailed specs',
  phases: [
    { title: 'Probe', detail: 'parallel probes of each behavioral dimension' },
  ],
}

const RULES = `
CRITICAL RULES (violating these fails the whole benchmark):
- You may ONLY learn about /workspace/executable by RUNNING it with different arguments/stdin/env.
- You MUST NOT use objdump, nm, strings, gdb, ghidra, strace, ltrace, readelf, or any disassembler/tracer on /workspace/executable.
- You MUST NOT search the web or any package registry for the source code of this project.
- Do not modify /workspace/executable. Work in /tmp.
The binary is a clone of the 'cat' utility with syntax highlighting (it self-identifies as "bat 0.26.1").
Docs available to read: /workspace/README.md, /workspace/doc/short-help.txt, /workspace/doc/long-help.txt.

NOTE: the ambient environment has NO_COLOR=1 and TERM=dumb set. When probing, control this explicitly
(e.g. 'env -u NO_COLOR TERM=xterm-256color /workspace/executable ...') and RECORD which env you used.
Always pipe output through 'cat -A' or 'od -c' when whitespace/escapes matter, and record exit codes.
`;

const OUT = (f) => `Write your full detailed findings to /tmp/spec/${f}. Be exhaustive and concrete:
include exact literal output text (byte-for-byte, with escapes spelled out), exact error message strings,
exit codes, and the precise command lines that produce them. Someone must be able to reimplement the
behavior from your file WITHOUT running the binary again. Do not summarize away details.
Your returned text should be a short (<=25 line) summary of the most important findings only.`;

const SUM = {
  type: 'object',
  properties: {
    file: { type: 'string', description: 'path to the spec file you wrote' },
    summary: { type: 'string', description: 'short summary of key findings' },
    surprises: { type: 'array', items: { type: 'string' }, description: 'non-obvious behaviors a reimplementer would get wrong' },
  },
  required: ['file', 'summary', 'surprises'],
};

const TASKS = [
  {
    label: 'cli-parsing',
    file: '01-cli-parsing.md',
    prompt: `Map the command-line argument parsing of /workspace/executable EXHAUSTIVELY.
Cover: every flag in doc/long-help.txt; short vs long forms; '=' vs space separated values; repeated flags
(last wins? accumulate?); '--' separator; '-' meaning stdin; unknown flags; missing values; invalid enum values;
abbreviated long flags (does '--colo' work?); combined short flags ('-np', '-pp', '-ppn'); negative/invalid numbers.
Capture the EXACT stderr text and exit code for every error case (note it says 'error: ...' and prints a Usage block
that uses argv[0]'s basename - verify by copying the binary to another name and running it).
Also capture the EXACT full output of: '--help', '-h', '-V', '--version', '--completion bash|fish|zsh|ps1' (just note
line counts + first/last 5 lines + save FULL text to separate files /tmp/spec/completion-<shell>.txt via redirection),
'--diagnostic', '--acknowledgements' (line count + first/last lines, save full to /tmp/spec/acknowledgements.txt).
Also probe undocumented/hidden flags that exist in real 'bat': --config-file, --config-dir, --cache-dir,
--generate-config-file, --no-config, --no-custom-assets, --list-languages/-L, --lessopen, --no-lessopen,
--force-colorization/-f, --terminal-width, --diff-context, --highlight-line, --squeeze-limit, --strip-ansi,
--set-terminal-title, --binary, --nonprintable-notation, --ignored-suffix, --map-syntax/-m, --fallback-syntax.
Note which flags conflict with each other and the exact conflict error text.
${OUT('01-cli-parsing.md')}`,
  },
  {
    label: 'style-decorations',
    file: '02-style-decorations.md',
    prompt: `Map the --style / --decorations / output layout of /workspace/executable EXHAUSTIVELY (use --color=never
to isolate layout from color).
Cover: each style component alone and in combination (default, auto, full, plain, changes, header, header-filename,
header-filesize, grid, rule, numbers, snip); the '+'/'-' modifier syntax ('--style=-numbers', '--style=+grid');
multiple --style flags; BAT_STYLE env var; precedence between CLI/env; what 'auto' does when piped vs not.
Determine the EXACT layout: gutter width as a function of the number of lines in the file (test files with
9, 10, 99, 100, 999, 1000, 10000 lines), the exact separator characters and spacing, the exact box-drawing
characters for grid (top/middle/bottom, with and without numbers, with and without header), the 'rule' separator,
the header line format for one file vs multiple files, header-filesize format and units (test files of size
0, 1, 999, 1000, 1024, 1048576, 1073741824 bytes), and what happens with stdin (what filename is shown?),
with --file-name, and with multiple files (does the grid/rule change?).
How does grid width relate to --terminal-width? Test widths 1,2,5,10,40,80,200.
Also: behavior for an empty file, a file with no trailing newline, a file that is a single newline, -E/--quiet-empty.
${OUT('02-style-decorations.md')}`,
  },
  {
    label: 'ranges-highlight-snip',
    file: '03-ranges.md',
    prompt: `Map --line-range/-r, --highlight-line/-H, and the 'snip' style component of /workspace/executable.
Cover every syntax from the long help: 'N:M', ':M', 'N:', 'N', '-10:', 'N:+M', 'N::C', 'N:M:C'. Also multiple
-r flags (union? separate ranges?), out-of-order/overlapping ranges, ranges beyond EOF, range 0, negative values,
invalid syntax (capture EXACT error text + exit code).
Determine EXACTLY what the snip line looks like (characters, how it fills the terminal width, where the
'8<' scissors symbol goes) for various --terminal-width values and with/without numbers/grid.
For --highlight-line, determine what changes in the output with --color=never (does it still show something?)
and with --color=always (what ANSI codes, what background color, does the whole terminal width get painted?).
Test interaction of -r with -H and with --style combinations, and what happens when -r excludes all lines.
${OUT('03-ranges.md')}`,
  },
  {
    label: 'nonprintable-binary',
    file: '04-nonprintable.md',
    prompt: `Map non-printable character handling of /workspace/executable: -A/--show-all,
--nonprintable-notation=unicode|caret, --binary=no-printing|as-text.
Produce a COMPLETE byte-value -> displayed-string table for bytes 0x00-0xFF in BOTH notations, using
printf to build test files. Use 'od -c' / 'cat -A' on the output. Pay attention to: 0x00-0x1F, 0x7F,
0x20 (space), 0x09 (tab), 0x0A (newline), 0x0D, 0x80-0xFF (invalid UTF-8), and valid multi-byte UTF-8
(including combining chars, emoji, CJK wide chars, zero-width chars).
Also determine EXACTLY how bat decides a file is "binary" (test: NUL byte at various offsets, how many bytes
are inspected, invalid UTF-8 without NUL, a file that is entirely valid UTF-8 but with control chars).
Capture the exact '<BINARY>' / truncation message text and its formatting/coloring for --binary=no-printing.
Test binary + -A, binary + --binary=as-text, binary via stdin, and the interaction with --style.
Also: how are tabs expanded (--tabs=0,1,2,4,8) - is it tab-stop aligned or fixed? Test tabs at various
column offsets, and tabs combined with -A and with line numbers.
${OUT('04-nonprintable.md')}`,
  },
  {
    label: 'wrapping',
    file: '05-wrapping.md',
    prompt: `Map text wrapping in /workspace/executable: --wrap=auto|never|character|word, -S/--chop-long-lines,
--terminal-width (absolute, '+N', '-N' offsets), BAT_WIDTH env var.
Determine EXACTLY where lines break for a given terminal width, with and without the numbers gutter and grid
(the available content width changes). Test with --style=plain, numbers, grid, full at widths 1,2,3,5,10,20,40,80.
For --wrap=word, determine the word-breaking algorithm precisely: where does it break relative to spaces, are
trailing spaces kept on the wrapped line or moved, what happens to a single word longer than the width, what
counts as a word boundary (space only? punctuation? tabs?). Give many concrete examples.
Determine how wide characters (CJK), combining characters, emoji, and zero-width characters count toward width.
Determine what happens when the terminal width is too small to fit the gutter.
Also test wrapping combined with --tabs, with -A/--show-all, and with --color=always (are ANSI codes re-emitted
on each wrapped line?).
${OUT('05-wrapping.md')}`,
  },
  {
    label: 'syntax-detection',
    file: '06-syntax-detection.md',
    prompt: `Map syntax/language detection in /workspace/executable.
1. Save the EXACT full output of '--list-languages' to /tmp/spec/list-languages.txt (redirect it; do not paste
   the whole thing into your spec file, but note the format precisely: 'Name:ext1,ext2,...', sort order, count).
   Also check --list-languages with --color=always and when piped vs not (does the format change? is there a
   header?), and with -p/--plain.
2. Determine the detection precedence: explicit -l, --file-name, -m/--map-syntax globs, filename/extension,
   first-line (shebang / '<?xml' / etc), --ignored-suffix, --fallback-syntax, and the default when nothing matches.
   Test: files with no extension, unknown extension, dotfiles (.gitignore, .bashrc), files named 'Makefile',
   'Dockerfile', 'CMakeLists.txt', full-path globs like '/etc/profile'.
3. Determine which language names/aliases '-l' accepts (name, extension, case sensitivity) and the EXACT error
   text + exit code for an unknown '-l' value.
4. Determine first-line detection rules by testing many shebangs (#!/bin/sh, #!/usr/bin/env python3, #!/usr/bin/perl,
   '<?php', '<?xml', '<!DOCTYPE html', '%!PS', 'diff --git', etc). Which ones actually change the highlighting?
   Use '--color=always --style=plain' and compare against '-l <lang>' output to infer the detected language.
5. Determine -m/--map-syntax glob semantics: matched against basename AND full path? '**' support? Multiple -m
   flags precedence? Error text for a bad mapping (missing ':' , unknown syntax).
${OUT('06-syntax-detection.md')}`,
  },
  {
    label: 'themes-colors-basic',
    file: '07-themes.md',
    prompt: `Map theme handling and the COLOR output structure of /workspace/executable.
1. Exact output of '--list-themes' (piped vs tty-ish, with --color=always, with -p/--plain). Does it print
   sample text per theme? Is there a 'Default theme' note? Save full outputs to /tmp/spec/list-themes-*.txt.
2. Theme selection logic: --theme, --theme-light, --theme-dark, --theme=auto / auto:always / auto:system /
   dark / light; BAT_THEME, BAT_THEME_DARK, BAT_THEME_LIGHT env vars; precedence CLI > env. What is the
   DEFAULT dark theme and DEFAULT light theme? Prove it by comparing '--theme=X' outputs to the default.
   Exact error text + exit code for an unknown theme name. Is theme name matching case-sensitive?
3. For a PLAIN TEXT file (e.g. hello.txt containing 'hello'), record the EXACT ANSI escape sequence emitted
   for the text for EVERY theme in --list-themes with '--color=always --style=plain'. This gives each theme's
   default foreground color. Put the full table in your spec file.
4. Record the EXACT ANSI sequences used for DECORATIONS with '--color=always --decorations=always --style=full'
   for the default theme and for 3-4 other themes: the grid lines, the line numbers, the header 'File:' line,
   the filename itself, the snip line, and the highlighted-line background. Note the difference between the
   number color for a normal line vs the current/highlighted line.
5. How does '--italic-text=always' change output? What about a theme with bold/underline styles?
6. Does bat emit a reset (\\x1b[0m) per token, per line? Exactly how are consecutive same-color tokens handled?
${OUT('07-themes.md')}`,
  },
  {
    label: 'highlighting-monokai',
    file: '08-highlighting.md',
    prompt: `Deep-dive the SYNTAX HIGHLIGHTING token/color output of /workspace/executable for the DEFAULT theme
(use 'env -u NO_COLOR /workspace/executable --color=always --style=plain --theme="Monokai Extended" FILE').
Goal: produce a scope->color mapping table for the default theme, and per-language tokenization rules, precise
enough to reimplement.
Write small representative files for these languages and record the exact colorized output (pipe through 'cat -v'):
C, C++, Rust, Python, JavaScript, TypeScript, JSON, YAML, TOML, Markdown, HTML, CSS, Bash/Shell, Go, Java,
Makefile, XML, INI, SQL, Diff, Log, Plain Text.
For each, cover: keywords, control keywords, types/builtin types, identifiers, function names at definition and
at call site, numbers (int/float/hex), strings (single/double/escape sequences inside strings/interpolation),
chars, comments (line and block), preprocessor directives, operators, punctuation/brackets, constants
(true/false/null/None), annotations/decorators, and language-specific things (Markdown headings/bold/code spans/
links/lists, YAML keys vs values, JSON keys vs values, diff +/- lines, HTML tags vs attributes vs values).
Record the 256-color code used for each token category, and note which categories share a color.
Also note: does whitespace between tokens get its own escape sequence? Does the trailing newline get colored?
IMPORTANT: this is a large job. Be systematic, use scripts, and put a well-organized table in the spec file.
${OUT('08-highlighting.md')}`,
  },
  {
    label: 'misc-behaviors',
    file: '09-misc.md',
    prompt: `Map assorted behaviors of /workspace/executable:
1. -s/--squeeze-blank and --squeeze-limit: exact semantics (are lines with only whitespace 'empty'? what does
   limit N mean exactly? interaction with line numbers - do numbers skip?). Test limit 0,1,2,3.
2. --strip-ansi=auto|always|never: what exactly is stripped (CSI, OSC, other escapes?), and the 'auto' rule
   (docs say: strip unless syntax is plain text - verify).
3. -E/--quiet-empty: exact conditions (empty file, whitespace-only file, empty stdin, one of several files empty).
4. -u/--unbuffered behavior differences.
5. stdin handling: '-' argument, no arguments, multiple '-' args (error?), mixing files and '-',
   what filename/header is shown for stdin, --file-name with stdin.
6. Config file: --config-file path (and how BAT_CONFIG_PATH / XDG_CONFIG_HOME / HOME affect it),
   --config-dir, --cache-dir, --generate-config-file (what does it write? capture the exact file content),
   --no-config. Does bat READ the config file and apply its args? Test by creating one. What is the exact
   config file syntax (comments, quoting, one arg per line?)? Also BAT_OPTS env var - is it applied? In what order?
7. Paging: with --paging=always and PAGER/BAT_PAGER set to something harmless like 'cat' or 'tee /tmp/x',
   determine what bat does - does it exec the pager, what args does it add to 'less' (e.g. -R, -F, -X, --quit-if-one-screen)?
   Check BAT_PAGING env. Check '--pager=builtin'. What happens with --paging=always when stdout is a pipe?
   (Use PAGER='sh -c "cat; echo PAGERARGS: $0 $@"' style tricks or a wrapper script that logs its argv+env.)
8. --set-terminal-title: what escape sequence, when?
9. Exit codes for: success, missing file, one of several files missing, directory, permission denied, broken pipe.
10. Multiple files: order, headers, what happens if one fails mid-way (does it continue? what's the exit code?).
${OUT('09-misc.md')}`,
  },
  {
    label: 'git-diff',
    file: '10-git.md',
    prompt: `Map the Git integration of /workspace/executable: the 'changes' style component and -d/--diff /
--diff-context.
Set up a real git repo in /tmp (git init; configure user; commit files; then modify/add/remove lines) and
determine EXACTLY: the marker characters used for added / removed / modified lines, their column position
relative to line numbers and grid, their colors with --color=always, how removed lines are indicated (a marker
on the following line?), what happens with multiple consecutive changes, untracked files, files outside a repo,
staged vs unstaged changes (docs say 'with respect to the Git index'), and files in a repo with no commits.
For -d/--diff: exactly which lines are shown, how --diff-context=N affects it, how it interacts with snip and
--line-range, and what happens when there are no changes (empty output? exit code?).
Also check: does it work when the file is in a subdirectory, with symlinks, and when git is not installed
(try PATH= to see if it shells out to git or uses a library).
${OUT('10-git.md')}`,
  },
  {
    label: 'help-text-capture',
    file: '11-help-exact.md',
    prompt: `Capture EXACT reference outputs from /workspace/executable and save them verbatim to files, and
verify how they vary.
Save (using shell redirection, byte-exact) to /tmp/spec/:
  help-long.txt      <- '--help'
  help-short.txt     <- '-h'
  version.txt        <- '--version'
  list-languages.txt <- '--list-languages'
  list-themes.txt    <- '--list-themes'
  acknowledgements.txt <- '--acknowledgements'
  completion-bash.txt / completion-fish.txt / completion-zsh.txt / completion-ps1.txt
Then verify: do any of these differ when stdout is a TTY vs a pipe? (Use 'script -qec CMD /dev/null' to fake a
TTY and diff against the piped version - note that 'script' adds CR characters, account for that.)
Do they differ with --color=always vs never, with COLUMNS/--terminal-width set to 40 or 200, with NO_COLOR
unset and TERM=xterm-256color?
Also diff '/workspace/doc/long-help.txt' against the actual '--help' output and report EVERY difference
(the doc may be stale/modified). Same for short-help.txt vs '-h'.
Report the line counts and any wrapping behavior in the help text (is it wrapped to terminal width?).
${OUT('11-help-exact.md')}`,
  },
  {
    label: 'env-and-tty',
    file: '12-env-tty.md',
    prompt: `Map how /workspace/executable behaves with respect to environment variables and TTY detection.
Environment variables to test: NO_COLOR, CLICOLOR, CLICOLOR_FORCE, FORCE_COLOR, TERM (dumb, xterm,
xterm-256color, unset), COLORTERM (truecolor, 24bit), COLUMNS, BAT_WIDTH, BAT_STYLE, BAT_THEME,
BAT_THEME_DARK, BAT_THEME_LIGHT, BAT_TABS, BAT_PAGER, PAGER, BAT_PAGING, BAT_OPTS, BAT_CONFIG_PATH,
BAT_CONFIG_DIR, BAT_CACHE_PATH, LESS, XDG_CONFIG_HOME, XDG_CACHE_HOME, HOME.
For each: what changes? Precedence vs CLI flags. Exact values accepted (e.g. is NO_COLOR= empty treated as unset?).
TTY behavior: use 'script -qec "..." /dev/null' to simulate a TTY and determine what changes when stdout is a
terminal: default --color, default --decorations, default --paging, default --style ('auto'), terminal width
detection, whether the theme auto-detection queries the terminal (does it emit an escape sequence like
'\\x1b]11;?\\x07' to ask for the background color? check with a pty capture).
Does bat check if STDIN is a TTY (for the no-arguments case)? What does it do with no args on a TTY?
Also: does truecolor output (24-bit '38;2;R;G;B') get used when COLORTERM=truecolor, instead of 256-color?
This is IMPORTANT - test '--color=always' with COLORTERM=truecolor vs unset for the same file and record
both escape sequences.
${OUT('12-env-tty.md')}`,
  },
];

phase('Probe')
const results = await parallel(TASKS.map(t => () =>
  agent(RULES + '\n' + t.prompt, { label: t.label, phase: 'Probe', schema: SUM })
));

return results.filter(Boolean);
