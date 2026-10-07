export const meta = {
  name: 'json-tui-explore',
  description: 'Fan out behavioural probes of the json-tui executable and write per-area specs',
  phases: [
    { title: 'Probe', detail: 'one agent per behavioural dimension' },
  ],
}

const AREAS = [
  {
    key: 'initial-expand',
    prompt: `Determine EXACTLY which JSON nodes json-tui expands vs collapses in the INITIAL view, and how collapsed nodes are rendered.

Questions to answer with hard evidence:
- Given nesting depth and container type (object vs array), which nodes start expanded? Test {"a":{"b":{"c":{"d":1}}}}, [[[[1]]]], {"a":[1]}, [{"a":1}], mixtures, and containers with many children vs few.
- Is the rule depth-based, size-based (number of descendants / rendered lines), or type-based? Try to find the exact predicate. e.g. does an object with 50 keys still expand at depth 1? Does an array of scalars ever expand initially?
- Exact text for a collapsed object / array: "{...}" / "[...]" and where the trailing comma goes; the styling (bold ESC[1m).
- Exact text for empty object/array {} [] both collapsed and expanded.
- What the "(table view)" annotation looks like (exact number of spaces before it), and when it appears.
- Rendering of an EXPANDED object: opening "{" line, children lines with 2-space-per-level indent, closing "}" (with comma if not last).
- Rendering of an EXPANDED array: is there a key/index shown? "[" ... "]"?
Write a precise, example-rich markdown spec to /tmp/probe/findings/initial-expand.md`,
  },
  {
    key: 'colors-styles',
    prompt: `Nail down the exact per-element styling and the exact ANSI byte emission rules of json-tui's renderer (it is FTXUI based).

- For every JSON scalar type (null,true,false,int,double,string) and for keys, braces, collapsed markers, "(table view)", table borders: record the exact escape sequences emitted.
- Determine the RULE for how the renderer emits style changes between adjacent screen cells: e.g. why "ESC[94m ESC[49m" (both fg and bg) is emitted for coloured text but only "ESC[1m" for bold. Test combinations: a selected (inverted) coloured value, a bold+coloured value, transitions colour->colour, colour->default, bold->bold-with-colour, etc. The goal is to write a function UpdatePixelStyle(prev,next)->bytes that is byte-exact.
- What happens at the end of a row / between rows: is style reset before "\\r\\n"? Look at rows where the last cell is styled (e.g. a full-width coloured string) and the next row starts styled.
- Is there a style reset at the very end of the frame?
- Check the inverted/selected style interaction with colours (does selection use ESC[7m only, in addition to the value colour? order of codes?).
Write findings to /tmp/probe/findings/colors-styles.md with concrete byte examples.`,
  },
  {
    key: 'navigation',
    prompt: `Map json-tui's navigation and selection model exactly.

- Which lines are selectable? Test objects/arrays: is the closing brace selectable? Are keys selectable separately from values?
- Keys: Down/Up arrow (ESC[B / ESC[A), j/k, h/l, Left/Right (ESC[D/ESC[C), Enter (\\r or \\n?), Tab, gg, G, page-up (ESC[5~), page-down (ESC[6~), '+', '-', space.
- What does each do? In particular: what do left/right/h/l do (collapse/expand? move to parent?). What does Enter toggle? What do +/- do (deep expand/collapse of the selected subtree or of everything)?
- What do page-up / page-down do ("first"/"last" per the key help)?
- gg needs two 'g' presses - confirm; what does a single 'g' do? Is there a timeout?
- Does selection wrap around at the ends?
- Which unknown keys are ignored (no redraw)? IMPORTANT: does an ignored key still cause a frame to be emitted? (count frames: an.draws() length)
- Does the selection move when a node is collapsed while a descendant was selected?
Write findings to /tmp/probe/findings/navigation.md. Use the frame count and the reported cursor position (an.show prints it) to infer which element is selected.`,
  },
  {
    key: 'scrolling',
    prompt: `Determine how json-tui behaves when the document is taller than the terminal, and how the frame height is chosen.

- With rows=10 and a JSON producing 30 lines, what is the frame height (dimy)? Is it terminal rows, rows-1, or content height?
- How does scrolling work as you move the selection down past the bottom? Record the exact visible window for each step.
- Is there a scroll indicator column (vertical scrollbar) on the right? Record its exact characters and styling.
- What happens with page-up/page-down/gg/G with respect to scrolling.
- Non-fullscreen mode: does the frame ever exceed the terminal height? What if content is 5 lines and rows=50?
- Also test the width: is dimx = min(content_width, cols)? Confirm with several widths.
Write findings to /tmp/probe/findings/scrolling.md`,
  },
  {
    key: 'tables',
    prompt: `Reverse-engineer json-tui's TABLE VIEW for arrays of objects.

- When is an array rendered as a table? (all elements objects? same keys? minimum count? nested values?) Find the exact predicate by testing many arrays.
- How is the table drawn: exact box-drawing characters, header row, column order (sorted?), separators, alignment, padding.
- What is in a cell when a key is missing from one element, or when the value is itself a container?
- How do you enter/toggle table view (the initial view shows "[...] (table view)" - what key shows the table?).
- Record the exact rendered bytes of a small table example, plus styling of headers/borders.
- Also examine the array-of-arrays case and arrays of mixed types.
Write findings to /tmp/probe/findings/tables.md`,
  },
  {
    key: 'text-wrap',
    prompt: `Determine exactly how json-tui lays out one "key: value" row, including long-value wrapping and narrow-terminal clipping.

- For a long string value, at what width does it wrap? Compute the exact wrap width as a function of terminal cols and indentation. Determine the word-wrap algorithm (break on spaces? what about a single word longer than the line? what about explicit \\n inside the string? tabs? multiple consecutive spaces?).
- On continuation lines, what is drawn in the key column (spaces coloured as the key?) and after the value (the comma element)?
- Determine the exact widths of each hbox child: indent, key, ": ", value, comma. What happens when cols is too small (clipping/shrink algorithm)? Test a row like {"aaaa":1234} at cols 4..20 and record the exact output for every width so the shrink algorithm can be reproduced.
- Do long KEYS wrap too?
- Are strings with unicode / wide CJK characters measured by display width? Test "日本語" and emoji.
- How are control characters / escapes in strings rendered (e.g. "a\\nb", "a\\tb", "\\u0001")?
Write findings to /tmp/probe/findings/text-wrap.md`,
  },
  {
    key: 'fullscreen-cli',
    prompt: `Document json-tui's CLI surface and its --fullscreen mode byte protocol.

- Exact stdout/stderr bytes and exit codes for: --help, -h, --version, -v, -k/--key/--keybinding, no args with a tty stdin (no file, stdin is a terminal - what happens?), a directory as the file argument, an unreadable file, multiple file arguments, unknown flags (e.g. --bogus, -x), "--" handling, a file argument that is "-".
- The -k output is a static table: capture the exact bytes (including all escapes) so it can be reproduced verbatim.
- For --fullscreen: capture the full byte protocol (alternate buffer enter/leave, cursor moves, screen dimensions, whether it uses the whole terminal, differences in frames vs inline mode). Record an exact small example.
- Does --fullscreen change the rendering itself (same content, different framing?).
- Does the help text go to stdout or stderr? Exit codes for each.
Write findings to /tmp/probe/findings/fullscreen-cli.md`,
  },
  {
    key: 'json-values',
    prompt: `Determine how json-tui formats JSON scalar values and handles parser edge cases. It uses nlohmann::json.

- Number formatting: integers, negative, 1e10, 1.0, 0.1, 1e-7, 1e300, very large ints (2^63), -0, 1.5e3, 100000000000000000000, 3.0 -> does it print "3.0" or "3"? Record exact output text for a long list of numeric literals.
- String rendering: are escapes re-escaped on output? Test "a\\"b", "a\\\\b", "a\\nb", "a\\u00e9", "\\u0000", "a/b", non-ASCII UTF-8.
- Duplicate keys, empty-string key, keys needing escapes, unicode keys - and confirm the sort order used for keys (byte-wise? locale?). Test keys like "B","a","_","1","é","Z".
- Parse error messages: collect the exact stderr text for ~20 malformed inputs (trailing comma, single quotes, NaN, Infinity, comments, unterminated string, bad \\u escape, control char in string, leading zeros, "01", "+1", ".5", "1.", duplicate colon, deep nesting, BOM, empty file, whitespace only, truncated literals, big invalid number, invalid UTF-8 bytes). Record line/column numbers precisely.
- Does it accept top-level scalars? Multiple JSON values? NDJSON?
Write findings to /tmp/probe/findings/json-values.md`,
  },
  {
    key: 'mouse-misc',
    prompt: `Investigate json-tui mouse handling and miscellaneous runtime behaviour.

- Mouse: the app enables ESC[?1000h ESC[?1003h ESC[?1015h ESC[?1006h. Send SGR mouse sequences (ESC[<0;COL;ROWM / m for release, wheel = button 64/65) via the pty and determine: what does a left click on a row do (select + toggle?), what do wheel up/down do (scroll or move selection?), what does a click outside the content do, what about drag/motion events?
- Terminal resize: does the app redraw on SIGWINCH? Capture what it emits when the pty size changes (use fcntl.ioctl(master, termios.TIOCSWINSZ, ...) then kill(pid, SIGWINCH) is done by the kernel automatically). Record the byte sequence for a resize (does it clear more lines?).
- What happens on SIGINT (Ctrl-C, byte 0x03) and Ctrl-D (0x04), Ctrl-Z? Does it exit cleanly with the teardown sequence? Exit codes.
- Does the app respond to the ESC[6n cursor-position report it sends (feed it "ESC[12;1R" and see if anything changes)? Confirm such input is swallowed and not treated as keys.
- Bracketed paste / other escape input: what does a lone ESC byte do (should quit per the help)? How long does it wait to disambiguate ESC from ESC[A?
Write findings to /tmp/probe/findings/mouse-misc.md`,
  },
]

phase('Probe')
const results = await parallel(AREAS.map(a => () => agent(
  `You are reverse-engineering the behaviour of the compiled binary /workspace/executable (json-tui 1.4.1, a JSON terminal UI). We must reimplement it from scratch, so we need a byte-exact behavioural spec.

FIRST: read /tmp/probe/HARNESS.md - it documents the ready-made python probe harness in /tmp/probe (sep2.py, an.py) and the protocol facts already established. cd /tmp/probe and use it.

HARD RULES: never decompile/disassemble/strace/ltrace/gdb/nm/strings the executable, never look for its source online or in package managers. Only run it and observe. Do not modify sep2.py or an.py (copy them if you need variants). Always use \`timeout 120\` around python invocations. Always end key sequences with b'q'.

YOUR AREA:
${a.prompt}

Be exhaustive and precise: include literal byte strings (python repr) for the important cases, and state the inferred rules explicitly along with the experiments that support them. Where you are unsure, say so. Your final message should be a concise summary (< 60 lines) of the key rules you established; the full detail goes in the markdown file.`,
  { label: `probe:${a.key}`, phase: 'Probe' }
)))

return { areas: AREAS.map(a => a.key), summaries: results.map((r, i) => ({ area: AREAS[i].key, summary: r })) }
