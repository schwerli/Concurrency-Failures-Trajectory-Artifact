export const meta = {
  name: 'csview-explore',
  description: 'Exhaustively probe the csview executable behavior across every dimension',
  phases: [
    { title: 'Explore', detail: 'parallel behavioral probes per dimension' },
    { title: 'Critique', detail: 'find gaps in each dimension report' },
  ],
}

const RULES = `
CRITICAL RULES (violating these fails the benchmark):
- The binary is /workspace/executable (csview 1.3.4). You may ONLY run it and observe stdout/stderr/exit codes.
- You MUST NOT decompile, disassemble, run objdump/nm/strings/readelf/gdb/strace/ltrace on it, nor read its bytes.
- You MUST NOT search the internet or any package registry, and MUST NOT look for the original source code anywhere.
- Do not try to install csview or find its source. Behavioral observation only.
- Work in your own scratch dir under /tmp (create a unique one). Never modify /workspace.

Always pass -P (disable pager) unless you are specifically testing pager behavior.
Use \`cat -A\` or hexdump on YOUR OWN output captures to see exact bytes/spaces.
Be extremely precise and exhaustive. Report EXACT strings, EXACT byte sequences, EXACT exit codes.
`;

const DIMENSIONS = [
  {
    key: 'cli-args',
    prompt: `${RULES}
Your dimension: **command-line argument parsing** (the tool appears to use a clap-v4-style parser; you must characterize it exactly so it can be reimplemented byte-for-byte).

Investigate and report EXACT output (stdout vs stderr, exit code) for:
1. \`--help\`, \`-h\`, \`--version\`, \`-V\` — capture full exact text including trailing newlines and indentation. Note which stream and exit code.
2. Unknown flags: \`--bogus\`, \`-x\`, \`--nohead\`. Exact error message format, stream, exit code.
3. Abbreviated/prefix long flags: does \`--num\` work as \`--number\`? \`--sty\`? Does clap infer long args here?
4. Missing values: \`-d\`, \`--delimiter\`, \`-s\`, \`-p\`, \`-i\`, \`--sniff\`, \`--header-align\`, \`--body-align\` with no value.
5. Invalid enum values: \`-s bogus\`, \`--header-align bogus\`. Exact error incl. the "possible values" list formatting.
6. Invalid numeric values: \`-p x\`, \`-p -1\`, \`-p 999999999999999999999\`, \`-i abc\`, \`--sniff -5\`, \`--sniff abc\`. What integer types? Try boundary values (0, 255, 256, 65535, 65536, 2^32-1, 2^32, 2^64-1).
7. Value syntaxes: \`-dX\`, \`-d=X\`, \`--delimiter=X\`, \`--delimiter X\`, \`-p2\`, \`-s=sharp\`. Combined short flags: \`-HnP\`, \`-Hn\`, \`-nHP\`. \`-HnpX\`?
8. Extra positional args: \`file1 file2\`. Exact error.
9. \`--\` separator handling. A file literally named \`-\`. A file named \`--foo\`.
10. Repeated flags: \`-n -n\`, \`-d , -d ;\` (last wins?). \`-t -d ';'\` interaction (which wins? order dependent?).
11. Case sensitivity of enum values: \`-s SHARP\`, \`-s Sharp\`.
12. Does \`-t\` conflict with \`-d\`? Test \`-t -d ';'\` and \`-d ';' -t\`.
13. Delimiter validation: multi-char delimiter \`-d ab\`, empty \`-d ''\`, multibyte UTF-8 \`-d 中\`, \`-d '\\t'\` (literal backslash-t), tab char itself, \`-d '"'\`, \`-d '\\n'\`.
14. Help output when terminal width differs: try \`COLUMNS=40 ./executable --help\` and \`COLUMNS=200 ./executable --help\` — does wrapping change? (Important: it wraps at some width by default when not a tty.)
15. Exact behavior of \`-h\` vs \`--help\` (identical?), and \`./executable\` with no args and no stdin redirect vs with empty stdin.

Write your full findings to /tmp/findings/cli-args.md with exact quoted transcripts (use fenced blocks, and show trailing whitespace explicitly). Return a thorough summary of the key facts needed to reimplement.`,
  },
  {
    key: 'csv-parsing',
    prompt: `${RULES}
Your dimension: **CSV parsing semantics**.

Investigate exhaustively:
1. Quoting: \`"a"\`, \`"a""b"\`, \`a"b\` (bare quote mid-field), \`"a"b\` (data after closing quote), unterminated \`"abc\`. Exact errors/results.
2. Is there a backslash escape mode? Test \`"a\\"b"\`.
3. Leading/trailing whitespace preservation: \` a , b \`, and \`" a "\`.
4. Line endings: LF, CRLF, CR-only, mixed. Trailing newline present/absent. Multiple trailing newlines. Blank lines in the middle. A file that is only \`\\n\`, only \`\\n\\n\`.
5. UTF-8 BOM at start of file — stripped from first header cell or kept?
6. Invalid UTF-8 bytes in input (e.g. 0xFF). Exact error and exit code.
7. Ragged records: more fields, fewer fields, with and without -H. Exact error text and the record/line/byte numbers — determine precisely how record index, line number, and byte offset are computed (test with quoted multi-line fields before the bad record, and with CRLF).
8. Empty input; input with only a BOM; input with a single empty line; \`,\` alone; \`,,\` alone.
9. Fields containing embedded newlines (quoted) — how are they rendered/measured? Also embedded \\r, \\t, NUL byte, ANSI escape sequences (\\x1b[31m).
10. Comment support? Does a leading \`#\` do anything?
11. Does it handle a header row with duplicate names? Empty header names?
12. \`-H\` with a totally empty file. \`-H\` with one row.
13. Very long fields / many columns (e.g. 500 columns) — any limits?
14. Does it flexibly allow ragged rows in any mode? Try \`--sniff 0\`.
15. Delimiter edge cases: \`-d ';'\` with data containing commas; \`-t\` with tabs; delimiter that is a quote char.

For every error, record the EXACT stderr text, whether it goes to stderr, and the exit code.
Write findings to /tmp/findings/csv-parsing.md. Return a thorough summary.`,
  },
  {
    key: 'styles',
    prompt: `${RULES}
Your dimension: **border styles — exact glyph tables**.

For each of the 8 styles (none, ascii, ascii2, sharp, rounded, reinforced, markdown, grid) determine the EXACT character used at every position:
- top-left, top-mid (T-down), top-right, top horizontal
- header/body separator: left (T-right), mid (cross), right (T-left), horizontal
- vertical: left border, inner vertical, right border
- bottom-left, bottom-mid (T-up), bottom-right, bottom horizontal
- Are there separators between body rows? (grid yes) What about markdown/none/ascii2?

Method: render tables and dump with \`hexdump -C\` or \`python3 -c\` to print codepoints per line. Use multi-column, multi-row inputs. Also test:
1. Single column tables (do T-junctions collapse?), single row, header-only (no body rows), body-only (\`-H\`).
2. Empty input for each style — exact bytes.
3. Interaction with \`-n\` (number column) for each style.
4. Interaction with \`-i N\` indent: is the indent applied to every line including borders? Is it spaces? Does it apply to style \`none\`? Are there trailing spaces on lines?
5. Do any styles have leading/trailing spaces per line (style none and ascii2 seem to)? Confirm exact trailing whitespace for every style using \`cat -A\`.
6. For header-only tables (no data rows), is the header/body separator line printed? For \`-H\` (no header), is it printed?
7. For style \`markdown\` and \`ascii2\`, is there a top/bottom border at all?
8. Does \`-p 0\` change border widths correctly for all styles?

Write a complete ASCII table of glyphs per style to /tmp/findings/styles.md, listing exact Unicode codepoints (U+XXXX) for each of the 11+ positions per style. Return the complete glyph table in your summary — this is the single most important deliverable.`,
  },
  {
    key: 'unicode-width',
    prompt: `${RULES}
Your dimension: **display width computation** (cjk/emoji support is the tool's headline feature).

Method: build a probe. Example that works: for a set of strings S, run
\`python3 -c\` a script that feeds one CSV row with one quoted field per string, with flags \`-P -H -p 0 -s ascii\`, then split the first output line on '+' to read each column's width.

Determine:
1. Width of: ASCII printable (1), CJK ideographs (2), Hangul, Hiragana/Katakana, fullwidth forms, halfwidth katakana, CJK punctuation.
2. Control characters: \\t, \\x00-\\x08, \\x0b, \\x0c, \\x0e-\\x1f, \\x7f, U+0080-U+009F. (I already found \\t and \\x01 measure 1 — confirm across the range and confirm \\n measures 1 too.)
3. Zero-width: U+200B, U+200C, U+200D, U+FEFF, combining marks (U+0300), Hangul jamo medial/final (U+1160, U+11A8), variation selectors U+FE0F/U+FE00, U+00AD soft hyphen.
4. Emoji: single-codepoint emoji (U+1F600), emoji presentation with VS16 (U+2764 U+FE0F), flags (U+1F1FA U+1F1F8), ZWJ sequences (family: U+1F468 U+200D U+1F469 U+200D U+1F466), skin tone modifiers (U+1F44D U+1F3FB), keycaps (U+0031 U+FE0F U+20E3). Report each measured width. Is it per-codepoint sum, or grapheme-cluster aware?
5. "Ambiguous" East Asian width chars: U+00A1, U+00A4, U+00A7, U+00A8, U+2018, U+2019, U+201C, U+201D, U+2190, U+2500, U+25A0, U+00B0, U+03B1 (Greek alpha), Cyrillic. Are they 1 or 2? (This distinguishes width vs width_cjk.)
6. Wide ranges: U+1100-115F, U+2E80-U+303E, U+3041-U+33FF, U+3400-U+4DBF, U+4E00-U+9FFF, U+A000-U+A4CF, U+A960-U+A97F, U+AC00-U+D7A3, U+F900-U+FAFF, U+FE10-U+FE19, U+FE30-U+FE6F, U+FF00-U+FF60, U+FFE0-U+FFE6, U+1F300-U+1F64F, U+1F900-U+1F9FF, U+20000-U+2FFFD, U+30000-U+3FFFD.
7. Newly-assigned/unassigned codepoints in wide ranges (helps identify the Unicode data version): U+31BB, U+9FFD, U+1FA7B, U+1F6DD, U+1F979, U+2FFC, U+31EF, U+1E030.
8. Does the tool truncate or wrap very wide cells based on terminal width? Test a 500-char field. Test with COLUMNS set.
9. Is width computed on the raw field bytes or after any transformation? Test a field with an ANSI color escape \\x1b[31mRED\\x1b[0m.

Write findings to /tmp/findings/unicode-width.md including a table of tested codepoints → width, and your conclusion about the exact algorithm (per-char sum with what rules; is it grapheme-aware; ambiguous=narrow?). Return a thorough summary.`,
  },
  {
    key: 'layout',
    prompt: `${RULES}
Your dimension: **layout: alignment, padding, indent, line numbers, sniff**.

Investigate:
1. Alignment rounding: for content of width w in a column of width W, exactly how many spaces left/right for \`center\`? Test all parities (W-w = 1,2,3,4,5) for header-align center and body-align center. Determine floor vs ceil for the left pad.
2. \`--header-align\` / \`--body-align\` left/center/right for all combinations. Does header-align affect the \`#\` line-number header? Does body-align affect the line numbers themselves?
3. \`-p\`/\`--padding\`: 0,1,2,5,10. Is padding spaces on both sides? Applied to number column too? Interaction with alignment (is content centered within the content width, then padding added — or centered within width+2*padding)?
4. \`-i\`/\`--indent\`: 0,1,3,10. Spaces prepended to every output line? Including for style none/markdown? Any max?
5. \`-n\`/\`--number\`: header of the number column is \`#\`. Width of number column = max digits? Test 1, 9, 10, 99, 100, 1000 rows. Is the number right-aligned or left-aligned or body-align-dependent? With \`-H\` numbering starts at 1 for the first data row. With header, does the header row get a number?
6. \`--sniff N\`: what exactly does it do? Set up a file where row 1..N are narrow and a later row is wide. With \`--sniff 2\`, is the later wide row's column NOT widened (so the table is ragged/misaligned)? Capture exact output. Test \`--sniff 0\` (no limit), \`--sniff 1\`, and default 1000 with 1001+ rows where row 1001 is wide. Does sniffing count the header row? Determine precisely: does it stop widening after N rows but still print all rows (with overflow) — and if a cell is wider than the sniffed width, is it truncated or does it overflow the border?
7. Does the number column participate in sniffing (i.e., if only first 2 rows are sniffed but there are 100 rows, is the # column width based on 2 or 100)?
8. Empty column (all cells empty, header empty) → width 0? What does the row look like with padding 1?
9. Very many columns / very wide table — is there any terminal-width-based truncation? Test with and without COLUMNS env var, stdout not a tty.

Write findings to /tmp/findings/layout.md with exact captured outputs (cat -A). Return a thorough summary, especially the exact sniff semantics.`,
  },
  {
    key: 'io-pager',
    prompt: `${RULES}
Your dimension: **I/O, pager, file handling, environment**.

Investigate:
1. Default behavior WITHOUT -P: when stdout is NOT a tty (e.g. piped to \`cat\` or a file), does it still page? Compare \`./executable f.csv | cat\` vs \`./executable -P f.csv | cat\`. Are they byte-identical?
2. Pager: with stdout a tty (use \`script -qec '...' /dev/null\` to fake a tty), does it invoke a pager? Which one? Test env vars: \`PAGER=cat\`, \`PAGER=/bin/cat\`, \`CSVIEW_PAGER\`, \`LESS\`. Try \`PAGER='sh -c "echo PAGED"'\`. Does it pass args to less (like -S/-R/-F/-X)? Determine the exact pager command and env var precedence. Try unsetting PAGER. Try PAGER=nonexistentcmd123 — what happens (error text, exit code, fallback)?
3. Does the tool require a tty for the pager (i.e. only pages when stdout is a tty)?
4. File arg vs stdin: \`./executable f.csv\`, \`./executable < f.csv\`, \`./executable - < f.csv\` (is \`-\` stdin?). \`./executable /dev/stdin\`.
5. Errors: nonexistent file, a directory as the file, a file with no read permission, a named pipe, /dev/null, an empty file. Exact stderr text + exit code for each. (I found nonexistent → \`csview: No such file or directory (os error 2)\` exit 1.)
6. Is the error prefix always \`csview: \`? Does it go to stderr? Confirm stdout is empty on error.
7. Broken pipe: \`./executable -P big.csv | head -1\` — exit code, any error message?
8. Does it write anything to stdout before detecting a CSV error mid-file (i.e. is output streamed or buffered)? Make a 5000-row file where row 4000 is ragged, run \`-P\` and see whether earlier rows were printed before the error.
9. Locale/env sensitivity: LANG=C, LC_ALL=C — does CJK width change? Does anything change?
10. Does it respect NO_COLOR / TERM? Any ANSI color in output ever?
11. Reading from a pipe that is slow / stdin closed. \`./executable -P\` with stdin at /dev/null.

Write findings to /tmp/findings/io-pager.md. Return a thorough summary, especially exact pager selection logic and exact error message formats.`,
  },
  {
    key: 'help-text',
    prompt: `${RULES}
Your dimension: **exact reproduction of --help and --version and all error texts**.

Deliverable: a byte-exact transcript of every message the program can emit.

1. Capture \`./executable --help\` to a file. Dump it with \`cat -A\`. Record it EXACTLY including every space, blank line, and the trailing newline count. Note: help goes to stdout with exit 0 presumably — confirm.
2. Capture \`./executable -V\` and \`./executable --version\` exactly.
3. Capture the error/usage output for: no such flag, invalid enum value, missing required value, too many positional args. For each, note the exact multi-line format (clap v4 emits e.g. "error: ...\\n\\nUsage: ...\\n\\nFor more information, try '--help'.\\n"). Confirm exact wording, blank lines, and whether "Usage:" line is included.
4. Determine whether help text wrapping depends on terminal width: run \`COLUMNS=60 ./executable --help\`, \`COLUMNS=100\`, \`COLUMNS=200\`, and with stdout piped (no tty). Also with \`script -qec\` to fake a tty at a specific width via \`stty cols\`. Report whether the output differs; if so, report the wrapping algorithm inputs (what width is used when piped?).
5. Is there a short help (\`-h\`) that differs from long help (\`--help\`)? Compare byte-for-byte.
6. Does \`./executable help\` do anything? \`./executable --help=x\`?
7. Test \`./executable -V extra\` and \`./executable --version --help\` precedence.

Write the byte-exact texts to /tmp/findings/help-text.md inside fenced code blocks, and ALSO write raw copies to /tmp/findings/help.txt, /tmp/findings/version.txt, and /tmp/findings/err-*.txt so they can be diffed later. Return a summary describing the formats (do NOT paste the entire help text in your return value, just describe and point to files).`,
  },
];

phase('Explore')

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    keyFacts: { type: 'array', items: { type: 'string' }, description: 'Precise, reimplementation-ready facts' },
    openQuestions: { type: 'array', items: { type: 'string' } },
    filePath: { type: 'string' },
  },
  required: ['dimension', 'keyFacts', 'filePath'],
}

const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `explore:${d.key}`, phase: 'Explore', schema: SUMMARY_SCHEMA }),
  (r, d) => r ? agent(`${RULES}

A previous agent explored the "${d.key}" dimension of /workspace/executable and wrote findings to ${r.filePath}.

Read that file. Then act as a COMPLETENESS CRITIC + VERIFIER:
1. Re-run the most load-bearing experiments yourself to confirm the claims are true. Flag anything wrong.
2. Identify what is MISSING — untested flag combinations, unexplored edge cases, unverified claims, ambiguous conclusions.
3. Actually run the missing experiments now and APPEND a "## Round 2 (critic additions)" section to ${r.filePath} with the new findings and any corrections.

Original agent's claimed key facts:
${r.keyFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Open questions it left:
${(r.openQuestions || []).map(q => `- ${q}`).join('\n') || '(none)'}

Return: (a) list of CORRECTIONS to the original claims, (b) list of NEW facts you established, (c) anything still unknown.`,
    { label: `critic:${d.key}`, phase: 'Critique' })
    : null
)

return { explored: DIMENSIONS.map(d => d.key), critiques: results.map((r, i) => ({ key: DIMENSIONS[i].key, critique: r })) }
