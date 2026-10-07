export const meta = {
  name: 'tj-explore',
  description: 'Exhaustively probe ./executable (tui-journal 0.16.1) behavior across CLI, config, themes, backends, and TUI',
  phases: [
    { title: 'Probe', detail: 'parallel agents probe each behavioral area and write notes' },
    { title: 'Gaps', detail: 'completeness critic finds unprobed surface' },
  ],
}

const HARNESS = `
You are reverse-engineering /workspace/executable (tui-journal 0.16.1, a Rust TUI journal app)
by BLACK-BOX OBSERVATION ONLY.

ABSOLUTE RULES (violating = task failure):
- NEVER decompile/disassemble/objdump/nm/strings/gdb/strace/ltrace the executable.
- NEVER search the web or fetch source code. No network anyway.
- ONLY run it and observe stdout/stderr/exit codes/files it writes/TUI screens.

TOOLS AVAILABLE TO YOU:
- /workspace/explore/tj.py : tmux-based TUI driver. Read /workspace/explore/README.md first.
  Usage: /workspace/explore/tj.py --sess UNIQ --home /tmp/h_UNIQ [--cols N] [--rows N] [--args "..."] KEYS...
  KEYS: literal text typed as-is; "^Name" = tmux key name (^Enter ^Escape ^Tab ^BTab ^Down ^Up ^C-s ^C-l ^Space ^BSpace);
        "@cap" capture plain screen, "@capE" capture WITH ANSI color escapes, "@s0.5" sleep.
  You MUST use a UNIQUE --sess and --home (include your area name) so parallel agents don't collide.
- Plain Bash for non-TUI invocations: HOME=/tmp/xxx /workspace/executable ...
- python3 available (sqlite3 module included). No cargo network.

Note: running the executable with no tty gives "Error: No such device or address (os error 6)".
Always use tj.py for TUI work.

WRITE YOUR FINDINGS to the exact file path given below, in Markdown.
Be EXTREMELY precise and literal: paste exact strings, exact byte output, exact screen captures
inside fenced code blocks, exact exit codes. A different engineer must be able to reimplement
byte-identical behavior from your notes ALONE without re-running the binary.
Prefer raw transcripts over prose summaries. Do not speculate; mark unknowns as UNKNOWN.
`

const AREAS = [
  {
    key: 'cli',
    title: 'CLI surface: args, help, errors, exit codes',
    task: `Probe the complete CLI argument-parsing surface (it is clap-based; capture clap's exact wording).
- Exact stdout of: --help, -h, --version, -V, and every subcommand's --help / -h (print-config, import-journals, assign-priority, theme, theme print-path, theme print-default, theme write-defaults, and "help" subcommand forms like "executable help", "executable help theme", "executable theme help", "executable help print-config").
- Note EXACT whitespace/indentation/column alignment and blank lines. Preserve trailing spaces if any (pipe through cat -A on a couple to check).
- Aliases: pc, imj, ap, style, path, default, write. Verify each works.
- Error cases and their exact stderr + exit code: unknown flag (--bogus), unknown subcommand (bogus), invalid -b value, -b with no value, missing required arg (import-journals with no --path, assign-priority with no arg), assign-priority with negative/zero/non-numeric/huge value, extra positional args, "--" handling, abbreviated flags, combined short flags, -vvv and -vvvv (more than 3), --json-file-path and --sqlite-file-path together, -j with -b json vs -b sqlite.
- Exit codes for every case.
- Does it accept "--help" after a subcommand and before? Test "-h" vs "--help" output differences.
- Test invalid unicode / empty string values.`,
  },
  {
    key: 'config',
    title: 'Config file: format, defaults, precedence, errors',
    task: `Probe configuration handling.
- Where is config read from? Default dir is $HOME/.config/tui-journal. Confirm filename(s) (config.toml? and backward-compat single file?). Test -c with a DIR path and with a FILE path.
- print-config exact output format for defaults and after modifying every key. Determine the full set of config keys, their TOML types and default values, and the exact serialization order/grouping in print-config output.
- Discover keys by writing a config.toml with a bogus key and observing errors; and by using the TUI's settings/options UI if any.
- Confirm defaults for: backend_type, scroll_per_page, sync_os_clipboard, history_limit, colored_tags, datum_visibility, app_state_dir, [export] show_confirmation + any path key, [external_editor] auto_save/temp_file_extension/command?, [json_backend] file_path, [sqlite_backend] file_path.
- What are the accepted values for datum_visibility, backend_type, and any enum? Exact error text for invalid values.
- Does the app WRITE config.toml? When (on exit? on change?). Capture the exact written file bytes after changing settings via CLI flags (-j/-s/-b persist?) and via TUI.
- XDG env var handling: XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_STATE_HOME, XDG_CACHE_HOME. Test each.
- Malformed config.toml: exact error message + exit code.
- --log flag behavior and -v levels: what gets written to the log file, format of log lines.`,
  },
  {
    key: 'themes',
    title: 'Themes file: full default dump, parsing, errors',
    task: `Probe theme handling.
- Exact full stdout of "theme print-default" (paste verbatim, every line, exact order).
- "theme print-path" output for default and with -c DIR.
- "theme write-defaults": exact stdout, what file is created, its exact bytes (diff vs print-default), behavior when the file already exists (overwrite? append? message?), behavior when the dir doesn't exist. Exit codes.
- Themes file NAME: THEMES.md says theme.toml, print-path says themes.toml — determine which is actually read.
- Color parsing: what color names are accepted? Test every ANSI name (Black Red Green Yellow Blue Magenta Cyan Gray/Grey White LightRed LightGreen LightYellow LightBlue LightMagenta LightCyan DarkGray Reset), "#RRGGBB", indexed numbers ("5"? "Indexed(5)"?), invalid values -> exact error text and exit code / TUI behavior.
- Modifiers parsing: exact accepted flag names, separator (" | "), empty string, invalid flag -> error text. Is it case sensitive?
- Invalid/unknown group or field name in themes.toml -> error? silently ignored?
- Verify that a custom theme actually changes rendering: set a distinctive theme and use tj.py @capE to capture ANSI escapes for the journals list block and a selected item; record the escape sequences for default vs custom.
- Record the DEFAULT rendering colors as ANSI escapes for: journals list block active/inactive title, selected item, content block, footer, help popup, msgbox variants.`,
  },
  {
    key: 'backend-json',
    title: 'JSON backend file format + export/import formats',
    task: `Determine the exact on-disk JSON formats.
- Run with -b json (and -j PATH). Create entries via the TUI (n = new entry) with title/date/tags/priority, then dump the JSON file bytes exactly (cat, and python3 -c to show repr for whitespace/indent detection).
- Determine: top-level shape (array? object with key?), field names, field order, id assignment (starting value, increments, reuse after delete?), date/datetime serialization format (RFC3339? with timezone? "Z"? fractional seconds?), tags representation, priority representation (null vs absent), content field name.
- Exact indentation (2 spaces? 4? tabs?) and whether the file ends with a newline.
- Empty backend: is the file created with "[]" or "{}" or not created until first entry?
- Export: use the TUI's export ('>' key) and any multi-select export; capture the exported file's exact bytes. Compare to the entries JSON format (transfer format).
- import-journals: build transfer JSON files by hand and import them; determine exactly which fields are required vs optional, how ids are remapped, duplicate handling (same title+date?), exact stdout messages and exit codes, error text for malformed/missing file, empty array, unknown fields, wrong types.
- What happens with unicode, newlines, quotes, very long content, empty title, empty content?
- Test reading a hand-written entries.json with fields missing/extra; exact error messages.`,
  },
  {
    key: 'backend-sqlite',
    title: 'SQLite backend schema and semantics',
    task: `Determine the exact SQLite schema and semantics.
- Run with -b sqlite (default) and create entries via TUI. Then inspect the DB with python3's sqlite3 module: dump "SELECT type,name,sql FROM sqlite_master", user_version pragma, and full row contents with types (use typeof()).
- Record exact table name(s), column names, declared types, constraints, PK/autoincrement, indexes, and any migration/version table.
- How are tags stored (separate table? delimited string? which delimiter)? How is priority stored (NULL vs 0)? Datetime storage format exactly (string? epoch? what precision/timezone)?
- Row id assignment and reuse after deletes.
- Is the file created on startup even with no entries? Is WAL used? Journal mode? Page size? Encoding? Capture "PRAGMA journal_mode; PRAGMA page_size; PRAGMA encoding; PRAGMA user_version".
- Test opening an existing DB with an OLD/altered schema (drop a column, wrong table name, empty file, non-sqlite garbage file) — exact error messages and exit code / TUI error popup text.
- assign-priority subcommand: create entries with NULL priority, run "assign-priority 5", verify exactly which rows change and the exact stdout/exit code. Test on json backend too. Test value 0 and negative.
- Test that -j/-s pointing to a nonexistent nested dir works or errors (exact text).`,
  },
  {
    key: 'tui-main',
    title: 'TUI main screen layout, geometry, footer, resizing',
    task: `Map the main screen's exact layout and rendering rules.
- Capture the empty-state screen at many sizes: 80x24, 100x30, 120x40, 200x50, 60x20, 40x15, 30x10, 20x8, and very small (10x5). Record exactly how panes split (percentage? fixed?), what happens when too small, exact placeholder text and its position/alignment.
- Determine the split ratio between the Journals pane and Content pane precisely from several widths (give the formula).
- Footer: exact text in every state (list focused, editor focused, editor insert mode, multi-select mode, popup open). Does it wrap or truncate? What at narrow widths?
- Journals list entry rendering: create several entries with varied title lengths, dates, tags, priorities. Capture exact rendered lines: how many lines per entry, ordering of title/date/tags/priority, separators, indentation, truncation with long titles, wrapping, the highlight symbol/prefix for the selected row, scrollbar appearance and position.
- datum_visibility config values effect on rendering.
- colored_tags effect (use @capE).
- Scrolling: many entries (25+), test j/k/Down/Up, PageUp/PageDown, Home/End, g/G, Ctrl-d/Ctrl-u, and scroll_per_page config effect. Record exact scroll behavior and scrollbar.
- Content pane: title, how content is displayed when not editing, wrapping, scrolling.
- Focus cycling with Tab/BackTab/Ctrl-l/Ctrl-h: which controls, in what order, and how the active one is indicated (@capE).
- Mouse support? Test if clicking does anything (tmux send-keys can't easily; skip if not).`,
  },
  {
    key: 'tui-entry-dialog',
    title: 'TUI new/edit entry dialog',
    task: `Fully map the entry create/edit dialog ('n' = new, 'e' = edit).
- Capture the dialog at several terminal sizes; record its exact size/position/borders/title, all field labels, field order, and the footer/help line inside it.
- For each field (Title, Date, Time?, Tags, Priority — confirm the real set): allowed input, default value when creating new (is date prefilled with today's date? exact format), max length, validation rules, exact invalid-state rendering (@capE for the invalid style), and the error message shown.
- Date/time input format exactly (e.g. "2026-08-08" / "yyyy-mm-dd", separate time field "hh:mm"?). Test invalid dates (2026-13-45), out-of-range times, empty.
- Tags field: separator (comma? space?), whitespace trimming, duplicates, empty tags, case sensitivity, order preservation, unicode.
- Priority: numeric only? empty allowed? negative? zero? max?
- Keys inside the dialog: Tab/BackTab movement, Enter (submit? newline?), Esc (cancel), Ctrl-c, arrow keys, Home/End, Backspace/Delete, Ctrl-w/Ctrl-u/Ctrl-a/Ctrl-e word/line ops, cursor rendering. Which key confirms? Is there an explicit OK/Cancel indicator?
- Does it warn on unsaved changes when cancelling?
- What happens on submit with empty title? Exact message.
- After creating, where does the new entry appear in the list and is it selected?`,
  },
  {
    key: 'tui-editor',
    title: 'TUI built-in editor: vim-like modes and all editing keys',
    task: `Fully map the built-in content editor (Enter/Ctrl-m from the list to start editing).
- Confirm the mode set (Normal, Insert, Visual, Visual Line?) and how each is indicated in the block title/border and footer (use @capE for the border colors and cursor style).
- Enumerate and verify keybindings in each mode. Test at minimum: i a I A o O, h j k l, w W e E b B, 0 ^ $ , gg G, x X, dd, dw, d$, D, cc cw C, yy yw p P, u (undo), Ctrl-r (redo), v V, y/d/c in visual, >> <<, J, ~, r, s, S, f/t/F/T, %, Ctrl-d/Ctrl-u/Ctrl-f/Ctrl-b, counts (3j, d3w, 2dd), Esc, Ctrl-c, Ctrl-[.
- For each: describe the exact resulting buffer with a small reproducible transcript (start with a known multi-line buffer). Report which bindings DO NOTHING (equally important).
- Saving: 's' and Ctrl-s. Where does the "unsaved changes" indicator appear (exact marker text/char)? Ctrl-q discard — is there a confirmation popup? Exact popup text.
- Exiting the editor while dirty: exact prompt.
- Word wrap in the editor, long lines, tabs, unicode/CJK width handling, trailing whitespace.
- Line numbers shown? Cursor line highlight?
- sync_os_clipboard config effect on y/p.
- Test 'y'/Ctrl-y external editor path: set EDITOR=/bin/true or a script and observe. Capture the temp file path pattern and extension, and auto_save behavior.`,
  },
  {
    key: 'tui-filter-sort-fuzzy',
    title: 'TUI filter popup, sort popup, fuzzy find',
    task: `Fully map filter ('f'), sort ('o'), and fuzzy find (find the key — try '/', Ctrl-f, 'F').
- FILTER popup: exact layout/title/size, all fields and controls (title text? tags multi-select list? priority? date range?), how tags are listed and toggled, keys (Tab, Space, Enter, Esc, arrows, 'a' select-all?, 'c' clear?), the confirm/cancel affordance, and exactly how an active filter is indicated on the main screen afterwards (title suffix? footer?). How to clear the filter.
- SORT popup: exact layout, the list of sortable fields and their order, ascending/descending toggle key and indicator, multi-level sort? keys to reorder criteria, apply/cancel keys, and how sorting is reflected. Default sort order of the list.
- FUZZY FIND: discover the key from the help popup (Global tab) first. Then map: prompt rendering, incremental matching behavior, whether it matches title only or content/tags too, case sensitivity, highlight of matched chars (@capE), navigation keys, Enter behavior, Esc behavior, empty query, no-match rendering text.
- Capture the complete Help popup text for ALL tabs (Global, Editor, Multi-Select) by scrolling to the very bottom — every row, verbatim, with exact column positions. Also record how the tabs are switched and the scroll keys, and the help popup at different terminal sizes.`,
  },
  {
    key: 'tui-multiselect-export',
    title: 'TUI multi-select mode, export, delete, popups/msgboxes',
    task: `Fully map multi-select mode, export flows, and all message boxes.
- Find the key to enter multi-select (check Help popup Multi-Select tab, likely 'v' or 'm' or Space). Record entering/leaving, how selection is marked in the list (exact chars/styles via @capE), the block title change, and the footer text.
- All multi-select keybindings verbatim from the Help tab, then verify each: select/deselect, select all, deselect all, invert, delete selected, export selected, move/copy to other backend?, tag operations?
- DELETE flows: single delete ('d'/Delete/Ctrl-d) and multi delete. Exact confirmation msgbox: border title, message text (including the entry title interpolated), the button/key hints, which keys confirm/cancel. Capture @capE for the msgbox colors (question/warning/error/info).
- EXPORT flows: '>' single export and multi-select export. Exact popup(s): path input prompt, default path/filename shown, overwrite confirmation (export.show_confirmation config effect), success message text, error message for bad path. Capture the exported file bytes.
- Any other popups: error msgbox (trigger by e.g. read-only file / bad path), info, warning. Capture exact text and layout for each.
- Test what happens on 'q' with unsaved changes, and 'q' in various modes.
- Look for any settings/options popup and map it if it exists.`,
  },
]

const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notesPath', 'summary', 'keyFacts', 'unknowns'],
  properties: {
    notesPath: { type: 'string', description: 'absolute path of the notes file written' },
    summary: { type: 'string', description: '3-8 sentence summary of what was learned' },
    keyFacts: {
      type: 'array',
      description: '10-40 crisp, literal, reimplementation-critical facts',
      items: { type: 'string' },
    },
    unknowns: { type: 'array', items: { type: 'string' } },
  },
}

phase('Probe')

const results = await parallel(
  AREAS.map((a) => () =>
    agent(
      `${HARNESS}

## YOUR AREA: ${a.title}

${a.task}

## OUTPUT
Write your notes to: /workspace/explore/notes/${a.key}.md
Use many fenced code blocks with verbatim transcripts. Aim for a thorough, long document.
Then return the structured summary.`,
      { label: `probe:${a.key}`, phase: 'Probe', schema: NOTE_SCHEMA },
    ),
  ),
)

const ok = results.filter(Boolean)
log(`probed ${ok.length}/${AREAS.length} areas`)

phase('Gaps')

const critic = await agent(
  `${HARNESS}

Nine parallel agents just probed /workspace/executable. Read ALL notes in /workspace/explore/notes/*.md.

Your job: be a COMPLETENESS CRITIC for a from-scratch reimplementation effort.
Identify behavior that is still unknown, contradictory between notes, or asserted without evidence.
Then ACTUALLY PROBE the top gaps yourself (use tj.py with --sess gapcritic) and write findings to
/workspace/explore/notes/gaps.md.

Focus especially on things that would make a reimplementation visibly wrong:
exact strings, exact layout arithmetic, default values, ordering, and error text.

Return the structured summary; keyFacts should be the NEW facts you established.`,
  { label: 'critic:gaps', phase: 'Gaps', schema: NOTE_SCHEMA, effort: 'high' },
)

return { areas: ok.map((r) => ({ path: r.notesPath, summary: r.summary, keyFacts: r.keyFacts, unknowns: r.unknowns })), critic }
