export const meta = {
  name: 'sd-probe-spec',
  description: 'Exhaustively probe the sd binary and produce byte-exact behavioral specs + differential test corpus',
  phases: [
    { title: 'Probe', detail: 'domain experts probe ./executable and write spec files' },
    { title: 'Corpus', detail: 'generate differential test case scripts' },
  ],
}

const RULES = `
STRICT RULES (this is a reverse-engineering benchmark):
- The ONLY source of truth is running /workspace/executable and reading /workspace/README.md, /workspace/README_zh-CN.md, /workspace/gen/*.
- You MUST NOT: search the web, use any package manager to fetch source, decompile/disassemble (objdump/ghidra/nm/readelf/strings on ./executable), or use strace/ltrace on it.
- You may run /workspace/executable with any arguments/stdin as many times as you like.
- Work in your own scratch dir under /tmp (create a unique one). NEVER modify anything in /workspace.
- The binary is at /workspace/executable (mode ---x--x--x, executable but not readable - do not try to read its bytes).
`

const SPEC_DIR = '/tmp/sdspec'

phase('Probe')

const DOMAINS = [
  {
    key: 'cli',
    file: 'cli.md',
    prompt: `Probe the command-line-argument handling of /workspace/executable exhaustively.

Cover, with BYTE-EXACT recorded output (use cat -A or od -c to reveal trailing whitespace/newlines, and record exit codes and which stream each byte went to):
1. Full \`--help\` output and full \`-h\` output. Reproduce them character-for-character in a fenced block. Note trailing newlines exactly.
2. \`--version\` and \`-V\` output.
3. How the program name in the "Usage:" line is derived (try copying the binary to other names, invoking via symlink, via a path with spaces, via 'exec -a').
4. Every argument error: missing required args (0 args, 1 arg), unknown short flag, unknown long flag, flag-like value in each position, invalid value for -n (non-numeric, negative, overflow, empty, "+5", " 5", "0x10", "1_0"), duplicated flags (-p -p, -f a -f b, -n 1 -n 2), '=' forms (--flags=, -f= , -n=5), attached short values (-n5, -fi, -pF, -Fp, -pn 3), '--' end-of-flags in every position, args after '--', empty-string args, invalid UTF-8 args (in FIND, in REPLACE, in FILES).
5. Interaction of --help/--version with other args and with errors (which wins).
6. Does '-' as a file mean stdin? What about a file literally named '-'?
7. Very long arg lists; many files.
8. Anything about clap-specific behaviours: does it suggest similar flags for typos (e.g. --previe, --fixed-string, --flag)? Record those messages exactly.
9. Exit codes for every case.

Write your findings to ${SPEC_DIR}/cli.md as a precise, complete spec that someone could use to reimplement the argument parser byte-exactly. Include a table of case -> exact stdout / exact stderr / exit code. Quote strings unambiguously (show escapes for trailing spaces/newlines).`,
  },
  {
    key: 'regex-errors',
    file: 'regex-errors.md',
    prompt: `Probe the REGEX PARSING / COMPILATION error messages of /workspace/executable exhaustively.

The tool takes FIND as a regex. Invalid regexes produce messages on stderr like:
error: invalid regex regex parse error:
    (
    ^
error: unclosed group

Your job: map out the complete error-message grammar and as many distinct messages as you can find, with EXACT text including the indentation of the pattern line and the exact caret positions (use cat -A to see trailing spaces).

Probe at least: unclosed/unopened groups and classes and braces; bad repetition (a**? x{2,1}, {,}, a{, a{}, ** at start, +, ?, {1} at start); invalid escapes (\\q, \\, \\x, \\xZ, \\x{, \\x{110000}, \\u, \\U, \\p, \\p{Foo}, \\pZ, \\b inside class); duplicate/invalid capture group names ((?P<1>a), (?P<>a), (?P<a-b>a), duplicates, (?P=name)); look-around ((?=a) (?!a) (?<=a) (?<!a)); backreferences (\\1, \\k<a>); unsupported flags ((?z), (?i-i), (?), (?-)); class set operations ([a&&b], [[:foo:]], [[:alpha]], [a-\\d]); nested quantifier size limits (a{1000}{1000}{1000}, huge {n,m}); very long patterns; patterns with multibyte characters where the caret must align (does the caret line use character offsets or byte offsets? Test a pattern like 'éé(' and 'ሴ(' and a pattern containing a literal tab or newline); patterns with multiple errors (which is reported); empty pattern.
Also check: how are patterns containing a literal newline or tab displayed in the error (are control characters rendered as unicode control pictures like the replacement-ambiguity error does)?
Also probe the caret span length rules for multi-character spans.
Also determine whether the -f flags affect which patterns are valid (e.g. -f w wrapping with a pattern ending in a trailing backslash or containing a top-level alternation), and whether -F makes all patterns valid.
Record exit codes.

Write a complete spec to ${SPEC_DIR}/regex-errors.md, with a big table of pattern -> exact stderr bytes -> exit code. Group by message family and state the general rule for the caret line.`,
  },
  {
    key: 'regex-semantics',
    file: 'regex-semantics.md',
    prompt: `Probe the REGEX MATCHING SEMANTICS of /workspace/executable (a find & replace tool: \`executable FIND REPLACE\` reads stdin, writes stdout).

Establish exactly which regex dialect and semantics are implemented, by experiment only. Cover:
1. Match semantics: leftmost-first vs leftmost-longest. Test alternation order: pattern 'a|ab' on 'ab'; '(a|ab)c' on 'abc'; greedy vs lazy quantifiers 'a+?' 'a*?' '.*?' ; nested groups capture values, e.g. '(a*)(a*)' on 'aaa'; '(a|b)*' on 'ab' (what is $1?).
2. Empty match handling in replace-all: patterns '', 'a*', '\\b', '(?:)' on various inputs including inputs with multi-byte UTF-8 (does an empty match occur between the bytes of a multi-byte char? test 'é' and '日本'). Also with -n limits.
3. Unicode: is matching byte-oriented or char-oriented? Test '.' against invalid UTF-8 bytes (printf 'a\\xffb'), '(?-u)' escapes, '(?-u).', '(?u)', '\\w' '\\d' '\\s' against non-ASCII (é, ４ fullwidth digit, non-breaking space, ٣ arabic-indic digit), '[[:alpha:]]' vs '\\p{L}', '\\p{Greek}', '\\p{Script=Greek}', '\\p{Lu}', '\\p{Alphabetic}', '\\p{Any}', case-insensitive matching of non-ASCII (é vs É, ß vs SS, İ, K vs KELVIN SIGN U+212A, Σ vs σ vs ς).
4. Anchors: '^' '$' '\\A' '\\z' '\\Z' '\\b' '\\B' with and without -f e / -f m, on input with and without trailing newline, on input with \\r\\n.
5. What happens with patterns that can match invalid UTF-8 in unicode mode - is an error produced? Test '(?-u)\\xff' , '(?-u).' , '(?-u)[^a]' and check whether matches can split a multi-byte char.
6. Repetition bounds: 'a{2,3}', 'a{,3}', 'a{0}', very large counts.
7. Class features: '[a-]', '[]a]', '[^]]', '[\\d-z]', '[[:^alpha:]]', '[a&&b]', '[[a][b]]', nested negation.
8. Flag groups inside the pattern: '(?i)a', '(?i:a)b', '(?-i)', '(?s)', '(?m)', '(?x)' (is verbose/extended mode supported? test '(?x) a b'), '(?U)' (swap greed).
9. Interaction of the -f flags (c e i m s w) with inline flags; whether -f w wrapping is applied before or after inline flags.
10. Whether the tool ever reports "invalid utf8" style errors on output.

For every experiment record the exact command, exact input bytes, and exact output bytes (use od -An -tx1 for anything non-obvious). Be precise about which engine semantics are implied.

Write your spec to ${SPEC_DIR}/regex-semantics.md.`,
  },
  {
    key: 'replacement',
    file: 'replacement.md',
    prompt: `Probe the REPLACEMENT-STRING handling of /workspace/executable (usage: \`executable FIND REPLACE [FILES]\`; with no FILES it filters stdin to stdout; -F means treat FIND and REPLACE as literal strings).

Already-known facts to verify and extend:
- Capture expansion supports \$0 \$1 .. \$N, \$name, \${1}, \${name}, and \$\$ escapes to a literal \$.
- Unknown group names/numbers expand to the empty string.
- A NUMBERED group reference immediately followed by ASCII word characters is a hard error:
    error: The numbered capture group \`\$1\` in the replacement text is ambiguous.
    hint: Use curly braces to disambiguate it \`\${1}x\`.
    \$1x
     ^^
  Determine the EXACT rule for when this triggers, the exact hint text, and the exact caret line (offset and length; character-based or byte-based; how tabs/newlines/other control characters in the replacement are rendered - it appears control chars become U+2400-block "control pictures").
- The replacement (in regex mode only) is unescaped: \\n \\t \\r \\\\ and \\xHH are interpreted; other backslash sequences stay literal. \\xHH appears to also swallow one EXTRA following character (bug). Confirm and characterise precisely, including \\xHH at end of string, invalid hex, and multi-byte chars being swallowed.
- Order of operations: the ambiguity check runs on the RAW replacement before unescaping.

Your job: verify all of the above, and exhaustively map the remaining behaviour. Also cover:
* \${...} forms: \${}, \${0}, \${99}, \${a b}, \${a-b}, \${ 1 }, \${1x}, unterminated \${1, nested \${\${1}}.
* \$ at end of string, \$\$\$1, \$\$\$\$, \$ followed by non-word chars, \$- \$+ \$& \$' \$\` (do any have special meaning?).
* Group names with unicode/underscore/digits-at-start; names longer than the number of groups; \$10 when only 3 groups exist.
* Which characters count as "word characters" when the expander scans a name (ASCII only? unicode?).
* Whether -F disables both the unescaping and the ambiguity check (and \$ expansion).
* Whether the ambiguity check runs before regex compilation and before file-path validation (test with an invalid regex and a nonexistent file simultaneously).
* Multiple ambiguous references - which is reported.
* Exit code for the ambiguity error, and which stream it goes to.
* Empty replacement, replacement containing NUL bytes (via \\x00), replacement that is only \$\$.
* Does an ambiguity error occur when the pattern has NO capture groups at all (e.g. FIND='a', REPLACE='\$1x')?
* Very long replacements; replacement longer than the input.

Record everything with od -An -tx1 where bytes matter. Write your spec to ${SPEC_DIR}/replacement.md.`,
  },
  {
    key: 'fileio',
    file: 'fileio.md',
    prompt: `Probe the FILE and I/O handling of /workspace/executable (usage: \`executable [OPTIONS] FIND REPLACE [FILES...]\`; modifies files in place; -p/--preview prints instead).

Known facts to verify and extend:
- Nonexistent path -> stderr "error: invalid path: <path-as-given>", exit 1, and NO file is modified (paths are validated up-front). Broken symlinks also fail this way. Paths are canonicalized (symlinks are followed; the symlink itself is preserved and its target rewritten).
- Directories / FIFOs / /dev/null -> "error: No such device (os error 19)" exit 1, and no other file gets modified (so all inputs are opened/mapped before any output is written). /dev/zero succeeds.
- Write-phase failures are collected and reported as:
    error: Failed processing some inputs
    <4 spaces><path-as-given>: <io error>
  followed by a blank line; exit 1. Temp files are named .tmpXXXXXX (6 random alphanumerics) in the same directory as the target; failures creating them render as: Permission denied (os error 13) at path "/abs/path/.tmpXXXXXX"
- Files are replaced via temp file + rename (inode changes). Permission bits are preserved but setuid/setgid are dropped and the sticky bit is kept; owner uid/gid are preserved (when the process has permission).
- Preview mode: with exactly one FILE it prints just the transformed content; with 2+ FILES it prints "----- FILE <path-as-given> -----" then the content, for each file, in argument order.

Verify ALL of the above precisely and then extend. Also determine:
* Exact stdout/stderr bytes and exit codes for every failure mode. Whether errors go to stderr.
* Preview mode header: exact bytes, is there a trailing newline after the content, what if content does not end with a newline, what about an empty file, is the header printed for a file with no matches?
* Non-preview mode: is anything ever printed to stdout when FILES are given?
* Whether unchanged files are still rewritten (compare inode/mtime) - test both "no matches" and "matches that produce identical output".
* Behaviour with the same file listed twice (in-place and preview).
* Hard links (are they broken?), read-only files, files in read-only directories, unreadable files, a path whose parent is not writable, a very deep path, a path with spaces/newlines/unicode in the name, a path that is an empty string "".
* Zero-length files (with and without a pattern that matches the empty string).
* Large files (e.g. 100MB) - correctness and rough timing. Files with NUL bytes and invalid UTF-8.
* stdin: is output streamed or buffered? Behaviour on a closed stdout (broken pipe) - exact message "error: Broken pipe (os error 32)" and exit code. Behaviour when stdin is a terminal, /dev/null, a directory redirect, or very large. Whether a trailing newline is ever added or removed.
* Whether FILES are processed in parallel (test with many large files and check ordering of preview output and of collected errors).
* What happens if a file is modified/deleted between validation and processing (best effort).
* Whether -p and in-place can be combined with anything unexpected.
* Whether an error in one file prevents later files from being written in the write phase (test a mix of failing and succeeding files, both orders).

Run as root and also as the unprivileged user 'agent' (via: su agent -s /bin/bash -c '...') to exercise permission errors. Record exact bytes with cat -A / od.

Write your spec to ${SPEC_DIR}/fileio.md.`,
  },
  {
    key: 'flags',
    file: 'flags.md',
    prompt: `Probe the -f/--flags and -n/--max-replacements and -F/--fixed-strings options of /workspace/executable exhaustively.

Known facts to verify and extend:
- Documented flag letters: c (case-sensitive), e (disable multi-line matching), i (case-insensitive), m (multi-line matching), s (dot matches newline), w (match full words only).
- Multi-line matching is ON by default. 'e' anywhere in the flags string turns it off and 'm' appears to be a no-op. For case, the LAST of i/c wins. Unknown flag letters are silently ignored.
- 'w' wraps the pattern as \\b<pattern>\\b with NO grouping, so top-level alternation binds loosely (e.g. -f w 'cat|dog' behaves like \\bcat|dog\\b).
- -F escapes FIND as a literal and disables \$-expansion and unescaping of REPLACE.
- -n LIMIT limits replacements per file; 0 means unlimited.

Verify all of that and extend:
* Exhaustively test flag-letter combinations and orderings for i/c/e/m/s/w (all 1- and 2-letter combos, plus interesting 3-letter ones) and state the precise rule for each letter.
* Determine whether 's' or 'w' can be turned off by any letter.
* Test every ASCII letter and digit and some punctuation/unicode as a flag letter, to confirm unknown letters are ignored (or find ones that are not). Include letters that are meaningful in other regex dialects: x, U, u, R, l, o, g, a, n, p, v, y, z, and uppercase versions.
* Determine exactly how 'w' interacts with: -F, inline flags in the pattern, patterns starting with ^ or ending with \$, patterns with a trailing unescaped backslash, empty pattern, patterns already containing \\b.
* -n: interaction with -F, with -p, with multiple files (is the limit per file or global? test 2 files each with 3 matches and -n 2, and preview mode too), with empty-matching patterns, with 0, 1, and huge values.
* -F: exactly which characters are escaped (test FIND values containing all ASCII punctuation, newlines, tabs, backslashes, and unicode); confirm REPLACE is fully literal including \$ and backslashes; confirm the ambiguity error never fires.
* Whether -F changes anything about how -f flags apply (case-insensitive literal matching, multi-line irrelevance, s irrelevance).

Record exact bytes and exit codes. Write your spec to ${SPEC_DIR}/flags.md.`,
  },
]

const probed = await parallel(DOMAINS.map(d => () => agent(
  `${RULES}

Create ${SPEC_DIR} if needed (mkdir -p ${SPEC_DIR}).

${d.prompt}

Be systematic and exhaustive: write shell loops that run many cases and dump results, then distill. Prefer many small experiments over few big ones. Where behaviour is surprising, design a follow-up experiment that discriminates between competing explanations, and say which explanation won.

Your final returned text should be a CONCISE summary (max 60 lines) of the most important/surprising rules you established, plus the path to the spec file you wrote. The full detail belongs in the spec file.`,
  { label: `probe:${d.key}`, phase: 'Probe' }
)))

phase('Corpus')

const corpus = await parallel([
  () => agent(`${RULES}

Build a DIFFERENTIAL TEST CORPUS for /workspace/executable.

Read the spec files in ${SPEC_DIR}/ (whichever exist) for context.

Create the directory /tmp/sdcases/ . In it, write test-case shell scripts named NNN-<slug>.sh (zero-padded 3-digit index, start at 001). Each script:
  - is run with \`bash <script>\` from inside a FRESH empty scratch directory (cwd), with the environment variable SD set to the absolute path of the binary under test.
  - must invoke "\$SD" (always quoted, never the literal path) for every invocation it tests.
  - may create fixture files in its cwd first.
  - should print a marker line before each invocation, then run the invocation capturing stdout and stderr and exit code, e.g.:
      echo "== case: basic"; "\$SD" 'a' 'b' 2>&1 <<< 'aaa'; echo "exit=\$?"
    but PREFER separating streams so differences are attributable:
      "\$SD" 'a' 'b' >out.txt 2>err.txt; echo "exit=\$?"; echo "--out--"; cat -A out.txt; echo "--err--"; cat -A err.txt
  - must be DETERMINISTIC: no timestamps, no random names, no absolute paths of the scratch dir in the output, no process ids. IMPORTANT: sd creates temp files named .tmpXXXXXX with random suffixes and error messages may contain the scratch dir's absolute path - if a case can produce those, post-process the output with sed to normalise, e.g. sed -E 's/\\.tmp[A-Za-z0-9]{6}/.tmpXXXXXX/g' and replace "\$PWD" with the literal string SCRATCH.
  - must end by dumping the resulting file tree and file contents so in-place edits are compared, e.g.:
      echo "--tree--"; find . -type f | LC_ALL=C sort | while read -r f; do echo "### \$f"; od -An -tx1 -v "\$f"; done
    (skip out.txt/err.txt from that dump, or dump them too - just be consistent).
  - should NOT depend on being root, and should not touch anything outside its cwd.

Write AT LEAST 60 such scripts covering, in depth: basic replacement; the README examples; capture groups (indexed, named, \${} forms, \$\$, ambiguity errors); -F fixed strings; every -f flag letter and combination; -n limits; -p preview with 0/1/2/3 files; multi-file in-place; error cases (bad regex - many varieties, nonexistent path, directory, ambiguity, bad -n value, unknown flags, missing args, --help, --version, --); unicode and invalid-UTF-8 inputs and patterns; empty files and empty patterns and empty replacements; files without trailing newlines; large-ish inputs (a few hundred KB is enough); files with NUL bytes; permission-independent metadata checks (mode bits via stat -c %a); hard links; symlinks; same file twice; stdin edge cases.

Then write /tmp/sdcases/run.sh: a harness that takes two binary paths (REF and NEW) plus optional case globs, and for each case script runs it in a fresh temp dir under /tmp with SD=REF and again with SD=NEW, diffs the combined output, and prints a PASS/FAIL summary with the diff for failures. It must exit non-zero if any case fails.

Finally, VALIDATE: run /tmp/sdcases/run.sh with REF=/workspace/executable and NEW=/workspace/executable and confirm every case passes (this proves determinism). Iterate until 100% pass. Report how many cases you wrote and confirm the self-check passes.

Return a concise summary: number of cases, the exact command to run the harness, and any cases you had to make lenient (and why).`, { label: 'corpus:cases', phase: 'Corpus' }),
])

return {
  probed: probed.map((p, i) => ({ domain: DOMAINS[i].key, summary: p })),
  corpus: corpus[0],
}
