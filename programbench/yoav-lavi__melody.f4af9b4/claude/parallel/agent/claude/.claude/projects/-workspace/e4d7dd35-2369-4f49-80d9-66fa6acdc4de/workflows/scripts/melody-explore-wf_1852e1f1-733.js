export const meta = {
  name: 'melody-explore',
  description: 'Exhaustively probe the Melody compiler binary and document behavior',
  phases: [
    { title: 'Probe', detail: 'parallel behavior probes across language + CLI areas' },
    { title: 'Critique', detail: 'completeness critics find gaps' },
  ],
}

const PREAMBLE = `You are reverse-engineering a compiled CLI binary at /workspace/executable (the "Melody" language compiler, version melody_cli 0.20.0). Melody is a small language that compiles to ECMAScript regular expressions.

HARD RULES (violating = disqualification):
- You MUST NOT decompile, disassemble, or use objdump/ghidra/strings/nm/readelf/gdb/strace/ltrace on /workspace/executable.
- You MUST NOT search the internet or any package registry for the project's source code.
- ONLY interact with it by RUNNING it with inputs/flags and observing stdout/stderr/exit codes.

Useful invocation notes already discovered:
- \`printf '%s' 'SRC' | /workspace/executable -\` compiles from stdin. Also \`/workspace/executable FILE.mel\`.
- Errors go to stderr; exit code 65 on error, 0 on success.
- Setting env CLICOLOR_FORCE=1 makes it emit ANSI colors.
- Parse errors are pest-style, e.g.
    Error:  --> 1:1
      |
    1 | "
      | ^---
      |
      = expected root
- Work in /tmp for scratch files. Do NOT modify /workspace/executable or files in /workspace except your own report file.

YOUR OUTPUT: Write an exhaustive, precise markdown report to the given path. Include VERBATIM input->output pairs (exact bytes, use \`cat -A\` or python repr when whitespace matters). Be exhaustive: your report is the ONLY source another engineer will use to reimplement this exactly. Then return a 15-line summary of key findings.`

phase('Probe')

const AREAS = [
  {
    key: 'literals-escaping',
    file: '/workspace/notes/01-literals-escaping.md',
    prompt: `AREA: string literals, quoting, and regex escaping.
Investigate exhaustively:
- Double-quoted vs single-quoted literals. What characters are allowed inside each? Can you put a single quote in a double-quoted string and vice versa? Are there escape sequences inside literals (backslash handling)? Test \\n \\t \\\\ \\" \\' inside both quote kinds. What does the output look like byte-for-byte?
- Which characters in a literal get escaped in the emitted regex? Test EVERY ASCII punctuation char and control char: . * + ? ^ $ ( ) [ ] { } | / \\\\ - # & ~ ! @ % = : ; , < > " ' \` and space, tab, newline (via a file with a literal newline inside quotes?), and non-ASCII (unicode, emoji, accented letters, CJK).
- Empty literal "" and ''. Multi-char literals. Very long literals.
- What happens with an unterminated literal? Exact error.
- Does a literal spanning multiple physical lines work?
- Interaction of literals with quantifiers: is a multi-char literal wrapped in a group when quantified? e.g. \`2 of "ab";\`, \`some of "ab";\`, \`2 of "a";\`, \`option of "abc";\`. Find the EXACT rule for when a non-capturing group (?:...) is added.
- Test literals of length 1 vs >1 with every quantifier.
Write the report to the file path above.`,
  },
  {
    key: 'quantifiers',
    file: '/workspace/notes/02-quantifiers.md',
    prompt: `AREA: quantifiers.
Investigate exhaustively:
- \`N of X;\`, \`N to M of X;\`, \`some of X;\`, \`any of X;\`, \`option of X;\`, \`over N of X;\`, and the \`lazy\` modifier on each. Are there others? Probe unknown keywords and read the pest "expected ..." lists in errors to enumerate grammar rule names.
- Exact emitted regex for each, including edge numbers: 0 of, 1 of, 2 of, 0 to 0, 0 to 1, 1 to 1, 3 to 3, 5 to 2 (reversed range - error?), over 0, over 1, huge numbers (e.g. 99999999999999999999 - overflow error?), negative numbers.
- Does \`lazy\` work with all of them? \`lazy 3 of\`, \`lazy option of\`, \`lazy over 3 of\`, \`lazy 2 to 5 of\`. Exact output.
- Can quantifiers stack? \`some of some of "a";\`, \`3 of option of "a";\`
- Quantifiers applied to: single char literal, multi char literal, symbol <word>, range a to z, group match{}, either{}, capture{}, ahead{} (assertion - allowed?), variable invocation, raw.
- Whitespace/newline flexibility: \`3   of "a";\`, \`3\\nof\\n"a";\`
- Exact errors for malformed quantifiers.
Write the report to the file path above.`,
  },
  {
    key: 'symbols',
    file: '/workspace/notes/03-symbols.md',
    prompt: `AREA: symbols <...> and unicode categories.
Known so far: <char>=. <space>=(space) <whitespace>=\\\\s <digit>=\\\\d <word>=\\\\w <newline>=\\\\n <tab>=\\\\t <return>=\\\\r <feed>=\\\\f <null>=\\\\0 <vertical>=\\\\v <alphanumeric>=[a-zA-Z0-9] <backspace>=[\\\\b] <boundary>=\\\\b <start>=^ <end>=$
Investigate exhaustively:
- Brute-force discover the COMPLETE symbol list. Try many plausible names (letter, alpha, upper, lower, punct, hex, backslash, quote, any, nothing, ...). Also try singular/plural and underscore/hyphen variants. Report the complete confirmed list with exact emitted regex.
- \`not <symbol>\` for EVERY symbol: which are negatable and what do they emit? Which produce errors and what is the exact error text?
- Unicode category namespace: \`<category::X>\`. Enumerate all accepted X values (try: letter, lowercase_letter, uppercase_letter, titlecase_letter, cased_letter, modifier_letter, other_letter, mark, non_spacing_mark, spacing_combining_mark, enclosing_mark, separator, space_separator, line_separator, paragraph_separator, symbol, math_symbol, currency_symbol, modifier_symbol, other_symbol, number, decimal_digit_number, letter_number, other_number, punctuation, dash_punctuation, open_punctuation, close_punctuation, initial_punctuation, final_punctuation, connector_punctuation, other_punctuation, other, control, format, private_use, surrogate, unassigned, ...). Report exact emitted \\\\p{..} for each accepted one.
- Other namespaces besides \`category\`? Exact error text for a bad namespace and a bad category value.
- \`not <category::letter>\` -> ?
- Are symbol names case sensitive? Whitespace inside <>? e.g. \`< word >\`, \`<word >\`.
- Exact error text and exit code for unknown symbols. Does the error include position info?
Write the report to the file path above.`,
  },
  {
    key: 'groups-assertions',
    file: '/workspace/notes/04-groups-assertions.md',
    prompt: `AREA: groups (capture/match/either) and assertions (ahead/behind).
Investigate exhaustively:
- \`capture { }\`, \`capture NAME { }\`, \`match { }\`, \`either { }\`, \`ahead { }\`, \`behind { }\`, \`not ahead { }\`, \`not behind { }\`. Any others? Probe the pest expected-lists for rule names.
- What characters are legal in a capture name? digits, underscore, hyphen, unicode, starting with a digit? Exact errors.
- Empty bodies: \`capture { }\`, \`match { }\`, \`either { }\`, \`ahead { }\`. What is emitted / what error?
- \`either\` with 1 item, 2 items, many items. Is \`either\` special: does each SEMICOLON-separated statement become an alternative? What about \`either { 2 of "a"; "b"; }\`? What about nested statements inside either that are multi-token?
- Does \`match\` always wrap in (?: )? What about \`match\` with a single item? Compare \`match { "a"; }\` vs \`"a";\`.
- Nesting: groups in groups, assertions in groups, groups in assertions, quantified groups \`3 of capture {...}\`.
- Is a trailing semicolon required after \`}\`? Test \`capture { "a"; };\` and \`capture { "a"; }\` and \`capture { "a" }\`.
- Statements inside blocks: are semicolons required for the last statement?
- Exact errors for unclosed braces, mismatched braces, etc.
Write the report to the file path above.`,
  },
  {
    key: 'ranges-raw',
    file: '/workspace/notes/05-ranges-raw.md',
    prompt: `AREA: ranges (\`a to z\`) and \`raw\`.
Investigate exhaustively:
- \`a to z\`, \`A to Z\`, \`0 to 9\`, \`a to Z\`, \`z to a\` (reversed - error?), \`0 to 5\`, single char to single char with punctuation (\`! to ~\`), multi-char (\`ab to yz\` - error?), unicode chars.
- \`not a to z;\` -> [^a-z]. What about combining multiple ranges? Is there syntax like \`a to z, 0 to 9\` or inside either?
- Interaction with quantifiers: \`3 of a to z;\`, \`some of a to z;\`
- Exact error text when a range is invalid (reversed, non-single-char, etc). Include exit code.
- \`raw\` keyword: exact syntax (\`raw "..."\`? \`raw '...'\`?). What is emitted (passthrough, no escaping)? Test raw with regex metachars, with quotes, empty raw, raw with quantifier applied, raw inside groups.
- Is there a semantic check on raw content (e.g. validating it's a valid regex)?
Write the report to the file path above.`,
  },
  {
    key: 'variables',
    file: '/workspace/notes/06-variables.md',
    prompt: `AREA: variables.
Known: \`let .x = { "a"; }\` then \`.x;\` works and inlines the body.
Investigate exhaustively:
- Exact syntax. Is the trailing semicolon after \`}\` allowed/required? Is \`let x = {...}\` (no dot) allowed? What name characters are legal (digits, underscore, hyphen, unicode, starting digit)?
- Invocation: \`.x;\` — can it be quantified (\`3 of .x;\`)? Can it appear inside groups/either/assertions? Can it be used with \`not\`?
- Does the variable body get wrapped in a group when inlined? Compare \`let .x = { "a"; "b"; } .x;\` vs \`3 of .x;\`.
- Errors: using an undefined variable (exact text + exit code), defining the same variable twice, defining a variable after use, recursive/self-referential variables, variable referencing another variable.
- Are variable declarations allowed inside blocks (inside match/capture/either)?
- Does a declared-but-unused variable emit anything or warn?
- Can a variable shadow a symbol name?
Write the report to the file path above.`,
  },
  {
    key: 'parse-errors',
    file: '/workspace/notes/07-parse-errors.md',
    prompt: `AREA: the EXACT format of pest parse errors. This is critical for byte-exact reimplementation.
Investigate exhaustively and record VERBATIM (use \`| cat -A\` to reveal trailing spaces):
- The general layout. e.g. for input \`"\`:
Error:  --> 1:1
  |
1 | "
  | ^---
  |
  = expected root
  Note there appear to be TWO spaces after "Error:". Confirm exact spacing everywhere.
- How the line-number gutter width changes for line numbers >= 10, >= 100 (test errors on line 10, 100, 1000 by prefixing newlines).
- What the caret line looks like: is it always \`^---\`? Try errors that span, e.g. mid-token. Are there variants like \`^\` alone or \`^^^\`?
- The "= expected X" list: collect the EXACT expected-lists for MANY different error positions. Known examples:
  * \`= expected root\`
  * \`= expected EOI, literal, raw, not, range, quantifier_quantity, group_declaration, assertion_declaration, variable_declaration, or variable_invocation\`
  * \`= expected literal, raw, not, range, quantifier_quantity, group_declaration, assertion_declaration, variable_declaration, or variable_invocation\`
  * \`= expected amount, class_content, or assertion_type\`
  * \`= expected block\`
  Find as many DISTINCT expected-lists as you can and record exactly which input position triggers each. Try: missing semicolon, missing closing brace, missing closing quote, bad quantifier, \`not\` followed by junk, \`of\` without operand, \`to\` without operand, \`let\` with junk, empty input, whitespace-only input, input that is only a comment, stray \`}\`, stray \`;\`, etc.
- Errors with multiple lines of input: does it show only the offending line? Does it show \`-->\` with the right line:col? Test errors on line 2, 3.
- What about a UTF-8 multibyte char before the error: is the column counted in chars or bytes?
- Empty input (0 bytes) and input that's just a newline: what happens? Exit code?
Write the report to the file path above with a table of input -> exact stderr.`,
  },
  {
    key: 'semantic-errors',
    file: '/workspace/notes/08-semantic-errors.md',
    prompt: `AREA: non-parse (semantic/compiler) errors and all other error texts.
Known: \`Error: usage of an unrecognized symbol\` (exit 65), \`Error: usage of an unrecognized symbol namespace\`.
Investigate exhaustively — find EVERY distinct error message the binary can produce:
- unrecognized symbol / namespace / category
- undefined variable, duplicate variable
- invalid range (e.g. \`z to a\`)
- number overflow in quantifiers (\`99999999999999999999 of "a";\`)
- reversed quantifier range (\`5 to 2 of "a";\`)
- file not found for the input file path; a directory passed as input; unreadable file; non-UTF8 file
- \`-o\` to an unwritable path / directory
- \`-f\` with a missing test file
- Anything else you can trigger.
For each: the exact stderr text, whether it's prefixed \`Error: \`, whether there's position info, and the exit code. Also check whether these errors are colored under CLICOLOR_FORCE=1 and with -n.
Also determine: do semantic errors show pest-style position info at all?
Write the report to the file path above.`,
  },
  {
    key: 'cli',
    file: '/workspace/notes/09-cli.md',
    prompt: `AREA: CLI argument parsing and I/O (this binary is built with clap v4).
Investigate exhaustively and record VERBATIM:
- \`--help\`, \`-h\`, \`--version\`, \`-V\` exact output (byte-exact, note trailing newlines) and exit codes, and which stream.
- Exact clap error messages for: unknown flag \`--bogus\`, unknown short \`-x\`, missing value for \`-o\`, too many positional args, \`--test\` without value, invalid UTF-8 arg. Record exact stderr + exit code (clap uses 2).
- \`-o FILE\`: does it still print to stdout? What exactly is written to the file (trailing newline?)? Combined with -t? Overwrite behavior? Nested nonexistent dir?
- stdin: \`-\` argument, piped stdin with NO argument (does it auto-read?), no argument and a TTY (what happens? probably help or waits).
- Input file that does not exist -> exact error, exit code.
- Both \`-t\` and \`-f\` given. \`-t\` with the string truncation rule: confirm exactly (looks like >10 chars truncates to first 10 + '...'). Test unicode strings of various lengths (chars vs bytes). Test empty test string.
- \`-f FILE\`: what is the "name" printed in the output message? Is the file content used verbatim including trailing newline? Test a multi-line file. Test a file whose content is long (truncation?). Missing file error.
- Exit codes for: successful compile (0), test that does not match (?), parse error (65), clap error (2), file-not-found (?).
- Does \`-t\` also print the compiled regex? Does \`-o\` + \`-t\` interact?
- Flag ordering / \`=\` forms (\`-t=x\`, \`--test=x\`, \`-tx\`), combined shorts (\`-nr\`).
Write the report to the file path above.`,
  },
  {
    key: 'repl',
    file: '/workspace/notes/10-repl.md',
    prompt: `AREA: the REPL (\`/workspace/executable -r\` or \`--repl\`).
It is interactive; drive it by piping input, and ALSO with a pseudo-terminal. A helper exists at /tmp/ptyrun.py usable as: \`python3 /tmp/ptyrun.py "COMMAND" [TERM]\` which runs COMMAND under a pty and prints the raw bytes repr. Write your own improved pty driver in /tmp if needed (python's pty module; note: do NOT name your script pty.py).
Investigate exhaustively and record VERBATIM byte sequences (including ANSI escapes and prompt text):
- The startup banner/prompt. Exact bytes.
- What happens when you enter a valid melody statement? An invalid one?
- Multi-line input support: does it accumulate until a complete statement?
- Built-in REPL commands: try \`.exit\`, \`exit\`, \`quit\`, \`.help\`, \`help\`, \`?\`, \`clear\`, \`.clear\`, \`test\`, \`source\`, \`save\`, \`:q\`, empty line, Ctrl-D (EOF), Ctrl-C.
- Does it keep state between lines (e.g. accumulate a program, or variables)?
- Behavior when stdin is a pipe (non-tty) vs a tty. Exit code on EOF.
- Colors in the REPL under CLICOLOR_FORCE=1 and with -n.
- Whether it uses line editing (arrow keys / history). If it looks like rustyline, note the prompt and any history file it creates (check for new files in \$HOME after running).
Write the report to the file path above.`,
  },
  {
    key: 'completions',
    file: '/workspace/notes/11-completions.md',
    prompt: `AREA: shell completions (\`--generate-completions SHELL\`).
- Determine the exact accepted shell values and the exact error text for an invalid one (already seen: "Unknown or unsupported shell: 'foo'" / "Try one of: 'bash', 'zsh', 'fish', 'elvish', 'powershell'"). Check case sensitivity, exit code, which stream.
- Dump each shell's completion output VERBATIM to files: /workspace/corpus/completions/{bash,zsh,fish,elvish,powershell}.txt using \`/workspace/executable --generate-completions SHELL > file\`. Verify byte counts with \`wc -c\`.
- Note whether the binary name used inside the output is "melody" or "executable" (it may depend on argv[0]!). TEST THIS: copy the binary?? NO - you may not copy it. Instead try invoking it via a symlink or via a different argv[0] using \`exec -a\`: e.g. \`bash -c 'exec -a mytool /workspace/executable --generate-completions bash' | head -30\`. Report exactly which parts of the output depend on argv[0] vs are hardcoded to "melody".
- Also check whether \`--generate-completions\` combined with other args changes anything, and whether it reads stdin.
Write a report to the file path above describing the structure and the argv[0] dependence (do NOT paste the whole completion text into the report - it's saved in the corpus files - but DO note file sizes and any argv-dependent lines with line numbers).`,
  },
  {
    key: 'grammar-shape',
    file: '/workspace/notes/12-grammar-shape.md',
    prompt: `AREA: reverse-engineer the underlying PEST GRAMMAR RULE NAMES and structure from error messages.
The binary uses the pest parser. Its parse errors list expected rule names. By crafting inputs that fail at specific positions you can enumerate the grammar's rule names and their alternation order (pest lists them in grammar order).
- Systematically produce errors at: start of file, after a complete statement, inside a block after a statement, after \`not\`, after a number, after \`of\`, after \`to\`, after \`let\`, after \`let .x\`, after \`let .x =\`, after \`capture\`, after \`capture name\`, after \`either\`, after a symbol \`<word>\`, after a literal, inside \`<\`, after \`::\`, etc.
- Record the exact "expected ..." list for each. Build a picture of the grammar: which rules are alternatives of which.
- Pay attention to the ORDER of names in each list — that reflects the grammar's ordered choice.
- Also determine pest's exact rendering when the expected set has 1 item ("expected X"), 2 items ("expected X or Y"), 3+ items ("expected X, Y, or Z" — confirm the Oxford comma).
- Determine whether WHITESPACE and COMMENT are implicit pest rules: test whether comments/newlines can appear in the MIDDLE of constructs, e.g. \`3 /* c */ of "a";\`, \`capture\\n{\\n"a";\\n}\`, \`3 of\\n"a";\`, and notably whether a \`//\` line comment can follow a statement on the SAME line (earlier probe suggests NO: \`"a"; // x\` errored, but \`"a";\\n// x\` was fine, and \`"a"; /* x */\` was fine). Nail down the EXACT rule for where line comments are allowed.
Write the report to the file path above.`,
  },
  {
    key: 'regex-semantics',
    file: '/workspace/notes/13-regex-semantics.md',
    prompt: `AREA: the regex MATCHING engine used by -t/--test and -f/--test-file.
The tool compiles Melody to an ECMAScript-style regex then tests a string against it. I must reimplement the matcher too.
Determine precisely:
- Is the match a SEARCH (unanchored, find anywhere) or a full match? Test \`"b";\` against "abc".
- Are lookaheads/lookbehinds supported and semantically correct? Test negative and positive, variable-length lookbehind (\`behind { some of "a"; }\` — error or works?).
- Case sensitivity, multiline (^ $ semantics against a string containing \\n — test \`<start>;"b";\` with test string "a\\nb"), dotall (does \`<char>\` match \\n? test \`<char>;\` against just "\\n").
- Unicode handling: does \\w match unicode letters? Does \`<char>\` match a multibyte char? Does \\d match unicode digits (e.g. Arabic-Indic ٠)? Does \\b work with unicode? Test \`<category::letter>;\` against 'é' and 'a' and '1'.
- Backtracking/catastrophic cases: does it hang or error?
- What happens when the compiled regex is INVALID (e.g. via \`raw\`)? \`raw "(";\` then -t. Exact error text and exit code.
- Empty test string behavior. Test string with newlines (via -f file).
- Exit code when it does not match.
Write the report to the file path above.`,
  },
]

const results = await parallel(AREAS.map(a => () =>
  agent(`${PREAMBLE}\n\nReport file path: ${a.file}\n\n${a.prompt}`, { label: `probe:${a.key}`, phase: 'Probe' })
))

phase('Critique')

const critics = await parallel([
  'Read all the report files in /workspace/notes/. Identify GAPS: behaviors of /workspace/executable that are not yet pinned down precisely enough to reimplement byte-exactly. Then RUN /workspace/executable yourself to fill those gaps (same hard rules: no decompiling, no internet source lookup, run-and-observe only). Append your findings to /workspace/notes/90-gaps-round1.md. Focus on the LANGUAGE (grammar, emitted regex, precedence, group-wrapping rules).',
  'Read all the report files in /workspace/notes/. Identify GAPS in the CLI/IO/REPL/error-formatting surface that are not yet pinned down byte-exactly. Then RUN /workspace/executable yourself to fill those gaps (no decompiling, no internet). Append findings to /workspace/notes/91-gaps-cli.md. Especially: exact clap help text formatting, exit codes for every path, stream routing, color codes for every colored output, and the exact set of pest expected-lists.',
  'Adversarial fuzzer: write a small script that generates many random/odd Melody programs (nesting, unusual whitespace, unicode, deep nesting, weird quantifiers, comments in odd places) and runs /workspace/executable on each, recording input->output. Look for SURPRISING behaviors that a naive reimplementation would get wrong (e.g. unexpected group wrapping, precedence, error positions). No decompiling, no internet. Write the most interesting ~60 surprising cases with exact input/output to /workspace/notes/92-fuzz-surprises.md.',
].map(p => () => agent(`${PREAMBLE.split('YOUR OUTPUT:')[0]}\n\n${p}`, { phase: 'Critique' })))

return { probes: results.filter(Boolean).length, critics: critics.filter(Boolean).length }
