export const meta = {
  name: 'capslog-explore',
  description: 'Exhaustively probe the caps-log executable behaviour across 16 areas and write findings files',
  phases: [
    { title: 'Explore', detail: '16 parallel behavioural probes, each writing a findings file' },
    { title: 'Critique', detail: 'completeness critic per findings file' },
  ],
}

const RULES = `
CRITICAL RULES:
- The ONLY way you may learn about /workspace/executable is by RUNNING it.
- FORBIDDEN: objdump, gdb, strace, ltrace, nm, readelf, strings, hexdump/xxd/od ON THE EXECUTABLE ITSELF,
  any decompiler, and any internet/package-registry search for its source.
  (hexdump/xxd/od on DATA FILES the program writes is fine and encouraged.)
- Read /workspace/notes/HARNESS.md FIRST for the test harness and baseline facts.
- Read /workspace/README.md for the shipped documentation.
- Use your own unique scratch dirs under /tmp/<yourarea>/ so you do not collide with other agents.
- Be exhaustive and concrete. Record EXACT strings, EXACT column positions, EXACT colors/attributes,
  EXACT exit codes. Quote real observed output. When you guess, label it GUESS.
- Your findings file is the deliverable that someone else will use to reimplement the program
  byte-for-byte without ever seeing the binary. Ambiguity is failure.
`

const AREAS = [
  {
    key: '01-cli',
    title: 'CLI argument parsing and help output',
    prompt: `Probe the command-line interface exhaustively.
- Capture the EXACT bytes of --help (and -h) output. Determine the line-wrapping algorithm used for
  option descriptions (this looks like boost::program_options format_description): what column do
  descriptions start at, what is the total line length, are trailing spaces kept before a wrap,
  how are long words handled? Test by using very narrow/wide COLUMNS env (does it matter?).
- Does the help output depend on the default config path (i.e. $HOME)? Test HOME unset, HOME=/x.
- Test: unknown long/short options, abbreviated long options (--conf, --log, --log-d, ambiguous
  prefixes like --log which matches --log-dir-path and --log-name-format), '--opt=value' syntax,
  '-cVALUE' glued short syntax, '-c VALUE', repeated options (which wins?), positional/extra args,
  '--' separator, empty string values, options after positional args.
- Determine exit codes and whether messages go to stdout or stderr for each case.
- Test all combinations of --encrypt/--decrypt/--password validation and their exact messages.
- Test what happens with --log-dir-path pointing at a nonexistent path, a file, a path needing
  '~' expansion, relative paths, trailing slash or not, and $ENV-looking strings.
- Test --log-name-format with odd values (no extension, no %y, extra %, unknown %X, empty).
- Record whether the program creates directories at startup and exactly which ones.`,
  },
  {
    key: '02-config',
    title: 'Config file (INI) parsing',
    prompt: `Reverse-engineer the config-file format and parser (~/.caps-log/config.ini, overridable via -c).
- Confirm the file MUST exist; what if it is a directory, unreadable, empty, binary?
- Determine the exact accepted syntax: 'key=value', spaces around '=', comments ('#', ';', inline?),
  blank lines, section headers '[section]', nested/dotted sections '[a.b.c]', quoted values,
  values containing '=' or '#', trailing whitespace, CRLF line endings, duplicate keys,
  duplicate sections, keys outside any section, unknown keys, unknown sections, missing '='.
  For each malformed input record the EXACT error message and exit code.
- Enumerate every top-level key the program honours. README mentions: log-dir-path,
  log-filename-format (note README ALSO says --log-name-format for CLI - check which spelling the
  config file wants; test both), sunday-start, first-line-section, password. Test boolean value
  parsing: true/false/1/0/yes/no/TRUE/on/garbage/empty.
- Determine precedence between CLI options and config-file options for every shared key.
- Test the [git] section keys (enable-git-log-repo, ssh-key-path, ssh-pub-key-path, repo-root,
  remote-name, main-branch-name): what validation happens at startup, what exact errors appear
  when repo-root is missing/not a git repo/not a parent of log-dir-path, when ssh keys are missing.
  Do NOT attempt real network pushes.
- Test '~' expansion inside config values.
Write EVERY exact error string you find.`,
  },
  {
    key: '03-repo',
    title: 'Log repository: filenames, dates, directories',
    prompt: `Determine exactly how log files are located, named and enumerated.
- Confirm the layout <log-dir-path>/y<YEAR>/d<YEAR>_<MM>_<DD>.md. Is the 'y<YEAR>' directory
  hardcoded or derived from the name format? Test --log-name-format variations
  (e.g. 'log_%d-%m-%y.txt', '%y%m%d', 'x%m_%d_%y.md', formats with no %y) and see what filename the
  editor is asked to open (use a fake $EDITOR that logs argv) and which existing files get picked up.
- Which %-specifiers are supported? Test %y %Y %m %d %e %j %b %B %a %A %% and unknown ones.
  Determine whether %y means 4-digit or 2-digit year here.
- Put files with wrong names in the log dir and see which are ignored. Test: right name in wrong
  year dir, files directly in log-dir-path, subdirectories, uppercase, extra extension, impossible
  dates (d2026_02_30.md, d2026_13_01.md, d2026_00_00.md), leap day 2024/2026, single-digit
  month/day (d2026_8_5.md).
- Check the header line 'There are N log entries for year YYYY.' counting rules (empty files?
  whitespace-only files? files in other years?).
- Verify what content is written into a brand new log file when opened via $EDITOR (template?),
  and whether an empty/unmodified file is deleted afterwards.
- Check the 'scratchpads' subdirectory creation and naming.
- Check behaviour with a read-only log dir, and with log dir being a symlink.`,
  },
  {
    key: '04-parse',
    title: 'Log content parsing: sections and tags',
    prompt: `Determine the EXACT rules by which section titles and tags are extracted from a markdown log.
Use the Sections and Tags menus (which show counts like '    2 | coding') to observe results.
Test at minimum:
- '# Title' vs '#Title' vs '  # Title' vs '## Title' vs '#' alone vs '# ' vs '#  Multi  Word  '.
- Whether the first line is ignored by default and how --first-line-section changes it; what if
  the first line is a tag instead; what if the file starts with a blank line.
- Tags: '* Tag' vs '*Tag' vs '  * Tag' vs '- Tag' vs '+ Tag' vs '*' alone.
  '* Tag (info)', '* Tag: body', '* Tag (info): body', multiline bodies, nested list items,
  '* Tag (unclosed', '* Tag )x(', tags with '#' inside, tabs instead of spaces.
- Case handling (is everything lowercased? are counts merged case-insensitively? what casing is
  displayed?), trailing/leading whitespace trimming, duplicate tags in one file (counted once or
  twice?), the same tag in two different sections, tags before any section (the '<root section>'),
  the display name of the root section.
- Sorting order in both menus (alphabetical? by count? where does <select none> sit? how are
  '<root section>' and non-ascii/uppercase sorted?).
- The exact rendering of a menu row: column positions of the count and the '|' separator, padding
  for counts >= 10, >= 100, truncation of long names.
- What the counts mean (number of days mentioning the tag).
- Whether section titles also become tags or vice versa.
Report a precise grammar/algorithm someone could implement.`,
  },
  {
    key: '05-layout',
    title: 'Annual view geometry at many terminal sizes',
    prompt: `Map the annual (main) view layout precisely so it can be recreated pixel-for-pixel.
- Render at sizes 200x60, 160x50, 120x40, 100x30, 90x30, 80x24, 60x20, 40x15, 200x24, 80x60 and
  more. For each, give the exact rendered screen (with the --ruler output) and describe:
  the total content width/height, how it is centered, the widths of the Sections menu, Tags menu,
  events box, calendar box, preview box, the number of month columns shown, and how clipping /
  scrolling happens when the terminal is too small.
- Work out the fixed rules: e.g. month box inner width, gap between boxes, calendar box border
  title ('2026'), the '┬┬' and '├' junction characters that appear when clipped, the weekday header
  row ' M  T  W  T  F  S  S ' and how --sunday-start changes it.
- Document the top header line format and its centering, and the bottom help line
  'hjkl/arrow keys - navigation | d - delete log | s - see scratchpads | tab - move focus ...'
  (exact text, when shown/hidden).
- Document the 'Recent & upcoming events (0)' box: exact title, size, position, when it appears.
- Document the log preview box title format ('log preview for 08. 08. 26.') and how it changes with
  the selected date, and its size.
- Note the smallest terminal size where things still render, and any crash/garbling.
Include the raw ruler dumps in your findings file for at least 6 sizes.`,
  },
  {
    key: '06-styles',
    title: 'Colors and text attributes of every UI element',
    prompt: `Using render.py --styles, catalogue the EXACT color/attribute of every UI element in the
annual view and how it changes.
- Default theme: weekend dates, weekday dates, today's date, dates that have a log entry, dates
  highlighted by a selected tag/section, event dates, empty dates, the calendar/month borders,
  box titles, the header line, the help line, focused vs unfocused menu items, the selected menu
  item, the menu box borders when focused vs not.
- Determine what ANSI codes are used (e.g. 34 = blue for weekends, 38;5;59 for something, 31 for
  today, 2 = dim, 1 = bold, 7 = inverse, 4 = underline) and which element each belongs to.
- Determine the color precedence when a date is several things at once (today + weekend + has log
  + highlighted + event). Construct test data to disambiguate every pair.
- Do the same for the theme overrides from README's [view.annual-view.theme.*] sections: verify each
  section name and key actually works, test each color format rgb()/rgba()/ansi16(name)/ansi16(N)/
  ansi256(N)/#RRGGBB/Default, each style flag, each border style (light/dashed/heavy/double/rounded/
  empty) and record the exact border glyphs each produces. Record exact error messages for invalid
  colors/borders.
Report as a table: element -> default style -> config key that overrides it.`,
  },
  {
    key: '07-menus',
    title: 'Sections/Tags menu interaction',
    prompt: `Determine exactly how the two menus behave.
- Keys: j/k/h/l, arrow keys, Home/End, PgUp/PgDn, Enter, Space, mouse (ignore mouse), Tab/Shift-Tab
  focus cycling order (and whether it wraps), what happens at the top/bottom of the list.
- What does selecting a section do to the Tags menu (filtering to tags under that section) and to
  the calendar highlighting? What does '<select none>' mean and where is it?
- Is selection a toggle on Enter, or does moving the cursor select? Verify by watching calendar
  highlight change as the cursor moves.
- Can both a section and a tag be selected simultaneously? What is highlighted then?
- What happens when a tag selection becomes invalid after switching sections?
- Does the menu scroll when the list is longer than the box? How is the scrollbar/indicator drawn?
  Generate 60 tags to test.
- Are counts recomputed when a section filter is applied?
- Record the exact rendering of the highlighted/selected/hovered rows (styles) in each focus state.
- Test the '+'/'-' year navigation and how it affects menus and the header, including years with no
  logs, and how far you can go (year 1970? 2100?).`,
  },
  {
    key: '08-calendar-nav',
    title: 'Calendar cursor navigation and preview',
    prompt: `Determine exactly how the calendar cursor behaves when the calendar is focused (2x <tab>).
- h/j/k/l and arrow keys: how does the cursor move across days, weeks, month boundaries, year
  boundaries? Does it wrap? What happens at Jan 1 / Dec 31 / on days that don't exist in a month
  (e.g. moving down from Jan 30 into February)?
- How is the cursor rendered (inverse? bold?) and does it differ when the calendar is not focused?
- Verify the log preview box updates to the date under the cursor, including its title format.
- '+' and '-' year navigation while the calendar is focused: where does the cursor land?
- 'Enter' opens $EDITOR: capture the exact argv, the environment, whether the screen is suspended
  and restored, what happens if $EDITOR is unset/empty/nonexistent/returns nonzero, whether
  $VISUAL is consulted, whether a shell is used (test EDITOR='sh -c "..."' and EDITOR with args).
- 'd' delete: capture the confirmation dialog exactly (text, buttons, geometry, styles), which keys
  accept/cancel, whether it appears for a date with no log, and the resulting file system change.
- Other keys: 'q' (quit - exact behaviour/exit code), Esc, Ctrl-C, 'r' (README says hjklr are
  navigation - find out what r does), 's', 'g', 'G', '?', unknown keys.
- Terminal resize behaviour (send SIGWINCH by resizing the pty mid-run if you can).`,
  },
  {
    key: '09-preview',
    title: 'Log entry preview rendering (markdown)',
    prompt: `Study the log-entry preview box in the annual view.
- Build log files exercising: level 1-6 headers, unordered lists ('*', '-', '+'), ordered lists,
  block quotes ('>'), fenced code blocks (\`\`\`), inline code, bold/italic, links, tables,
  horizontal rules, very long lines (wrapping?), tabs, blank lines, trailing spaces,
  non-ASCII/UTF-8, emoji, CRLF.
- Record for each construct: the exact text drawn and the exact style (color/attrs) of each run.
  Determine the default markdown theme colors (header1..header6, list, quote, code-fg per README).
- Determine whether the raw markdown is shown or a rendered form (are '#' and '*' kept?).
- How is content longer than the box height handled - clipped, scrolled, scrollable with keys?
- Is the preview shown when the date has no log? What is inside the box then?
- Test the [view.annual-view.theme.log-entry-preview.markdown-theme] overrides for every key.
- Also record the box border/title style and the effect of log-entry-preview.border=<style>.`,
  },
  {
    key: '10-scratchpad',
    title: 'Scratchpad view',
    prompt: `Fully document the scratchpad feature ('s' key toggles it).
- What the view looks like at several terminal sizes (include ruler dumps): boxes, titles, borders,
  help line, centering.
- How scratchpads are stored (path/filenames under <log-dir>/scratchpads?), what creates one,
  how new ones are named, whether a name prompt appears, what the exact prompt/dialog looks like.
- Keys inside the view: navigation, Enter (open in $EDITOR - capture argv), 'd' (delete + dialog),
  's'/Esc/'q' to leave, Tab focus cycling, '+'/'-'.
- The preview pane for scratchpads and its markdown rendering.
- Sorting/ordering of the list, counts, empty-state text when there are no scratchpads.
- Effect of [view.scratchpad-view.theme] config keys (menu.border, preview.border, markdown-theme).
- Whether scratchpads are affected by encryption (--encrypt) and by the git feature.`,
  },
  {
    key: '11-crypto',
    title: 'Encryption: file format and key derivation',
    prompt: `Reverse-engineer the encryption feature from observable file bytes only.
- Run --encrypt --password P on a log dir with known plaintext files of various lengths
  (0, 1, 15, 16, 17, 31, 32, 33, 1000 bytes) and hexdump the resulting files. Determine:
  header/magic, IV/salt presence and size, padding scheme, ciphertext length vs plaintext length.
- Determine whether the same plaintext+password gives identical ciphertext across runs (i.e. random
  IV or not), and whether two different files with the same content encrypt identically.
- Examine the '.cle' marker file (18 bytes) - what is in it? Does its content depend on the password?
  Test the same password twice, different passwords, empty password.
- Try to determine the algorithm/mode/key-derivation by experiment: e.g. does a 1-byte change in the
  plaintext change only one 16-byte block (ECB/CBC?) or everything? Does changing the password's
  length matter? Is the key the raw password bytes padded, or a hash? Compare with locally computed
  AES using a small python/C implementation you write yourself to test hypotheses (you may write and
  run your own AES implementation - that is not decompiling).
- Document the startup password prompt UI exactly (dialog text/geometry/styles, masking character,
  Enter/Submit button, wrong-password message and exit code, right-password behaviour,
  --password given on CLI or in config so no prompt appears, password for a NON-encrypted repo).
- Document --decrypt behaviour and errors, double-encryption, encrypting an already-encrypted dir,
  what happens to files that do not match the log name format, and to scratchpads.
- Document whether editing an entry re-encrypts it on save.`,
  },
  {
    key: '12-events',
    title: 'Annual calendar events',
    prompt: `Document the [calendar-events] config feature.
- Verify the exact config schema from README: '[calendar-events] recent-events-window=60' and
  '[calendar-events.<group>.<index>] name=..., date=DD.MM.' Test: missing trailing dot, 'D.M.',
  '1.1', '01.01.2020', invalid dates (32.01., 00.00., 29.02.), missing name, missing date,
  non-numeric index, non-sequential indices, duplicate indices, groups with dots in the name,
  no [calendar-events] section but event subsections present, and record exact error messages.
- Document the 'Recent & upcoming events (N)' box: what N counts, exact row text for each event
  (does it show days since/until, name, group?), ordering, how recent-events-window filters,
  default window value when unset, box width/height/position, styles.
- Document how event dates are highlighted in the calendar (color) and the precedence vs today /
  weekend / has-log / highlighted.
- Test events on Feb 29, events today, events yesterday/tomorrow, events far away, many events
  (20+) and whether the box scrolls.
- Test how the events box interacts with year navigation ('+'/'-').`,
  },
  {
    key: '13-theme',
    title: 'Theme config: exhaustive key/value matrix',
    prompt: `Systematically verify every theme configuration key documented in /workspace/README.md
plus plausible neighbours, and report which are real.
- For [view.annual-view.theme.<X>] with X in log-date, empty-date, highlighted-date, weekend-date,
  event-date, todays-date (and try: today-date, selected-date, cursor-date, header, help,
  section-menu, tags-menu, ...): which are accepted? What do unknown sections/keys do (silent
  ignore or error)?
- For each accepted section: keys fgcolor, bgcolor, italic, bold, underlined, dim, inverted,
  strikethrough, blink (and try 'underline', 'strike', 'reverse'): verify effect on rendering,
  and the exact ANSI output produced for each color format
  (rgb(1,2,3), rgba(1,2,3,4), ansi16(brightred), ansi16(9), ansi256(123), #00ffaa, Default,
  default, DEFAULT) plus malformed values (rgb(999,0,0), rgb(1,2), ansi256(300), '#fff', 'red',
  empty) with exact error messages and exit codes.
- Border keys: calendar-border, calendar-month-border, tags-menu.border, sections-menu.border,
  events-list.border, log-entry-preview.border under [view.annual-view.theme], and the dedicated
  subsection form. For each of light/dashed/heavy/double/rounded/empty record the EXACT glyphs used
  for corners/edges/junctions. Also test an invalid border value.
- Same for [view.scratchpad-view.theme] menu.border / preview.border / markdown-theme.
- Report whether boolean style flags accept 'false', '0', 'no'.`,
  },
  {
    key: '14-git',
    title: 'Git repository integration',
    prompt: `Document the git-remote feature WITHOUT doing any network access.
- Build a local git repo with a local 'remote' (a bare repo on disk with a file:// or plain path
  remote) and a config enabling enable-git-log-repo. Determine exactly when caps-log touches git:
  at startup? on exit? What commands/effects are observable (new commits, commit message text,
  author, branch, push attempt errors)?
- Record the EXACT error messages for: enable-git-log-repo=true without ssh-key-path, without
  ssh-pub-key-path, without repo-root, repo-root not a git repository, repo-root not an ancestor of
  log-dir-path, missing ssh key files, non-existent remote name, wrong main-branch-name,
  a repo with no commits, a dirty working tree.
- Note whether the program requires the 'git' binary or uses a library (observe by removing git from
  PATH: does it still work?).
- Note stdout/stderr messages printed on exit and the exit code.
- Do NOT attempt to reach any real network host.`,
  },
  {
    key: '15-misc',
    title: 'Startup, shutdown, environment, edge cases',
    prompt: `Cover everything not owned by the other agents.
- Exact behaviour and messages when: HOME unset; HOME empty; ~/.caps-log missing; config.ini
  missing (already known); log dir missing (is it created? with what permissions?); log dir is a
  file; no write permission.
- What exactly is written to the alt screen at startup/teardown: the full escape sequence prologue
  and epilogue (capture raw bytes of a full session: startup, one keypress, quit) and the exit code
  for q / Ctrl-C / Ctrl-D / SIGTERM / SIGHUP.
- Does the program work when stdout is not a tty (piped)? When TERM=dumb? When TERM unset?
  Record what it prints.
- Does it respond to mouse events (it enables 1000/1003/1015/1006)? Send an SGR mouse click on a
  calendar day and on a menu row and see whether the selection changes; document the effect.
- Test extremely small terminals (10x5) and very large (400x120).
- Test a log dir with 366 entries (whole year) for performance/rendering, and multiple years
  (y2024, y2025, y2026) - what does '+'/'-' show, and does the entry count follow?
- Check for any files the program writes on exit (e.g. caching) and whether it ever rewrites config.
- Check the behaviour of the date used as 'today' (can it be faked with TZ or faketime? try TZ).
- Try running two instances concurrently (locking?).`,
  },
  {
    key: '16-dialogs',
    title: 'All modal dialogs and prompts',
    prompt: `Catalogue every modal/dialog/prompt in the program with exact geometry, text and styles.
Known: the startup 'Enter password for log files:' dialog (appears when <logdir>/.cle exists), and
a delete-confirmation dialog for 'd'. Look for others (scratchpad creation/naming, error popups,
unsaved changes, quit confirmation, git errors).
For each dialog record:
- The exact box drawing, border style, title, inner text, button labels, and their positions at
  several terminal sizes (include ruler dumps).
- The exact styles (colors/attrs) of every element, focused and unfocused.
- Every key it responds to: typing, Backspace, arrows, Tab, Enter, Esc, 'q', Ctrl-C.
- The masking character used for the password field and whether the width grows with input.
- What happens on submit with an empty value, a wrong password (exact message + exit code), a
  correct password.
- Whether the underlying view is still drawn behind the dialog, and whether it is dimmed.`,
  },
]

phase('Explore')

const results = await pipeline(
  AREAS,
  (a) => agent(
    `You are reverse-engineering the behaviour of a compiled program by RUNNING it.\n${RULES}\n\n` +
    `YOUR AREA: ${a.title}\n\n${a.prompt}\n\n` +
    `Write your complete findings to /tmp/findings/${a.key}.md (create it; be long and precise; ` +
    `include raw dumps and exact strings). Then return a summary of the most important, ` +
    `implementation-critical facts you established (about 40-80 lines of dense notes, not prose).`,
    { label: `explore:${a.key}`, phase: 'Explore' }
  ),
  (summary, a) => agent(
    `A colleague probed the compiled program /workspace/executable in the area "${a.title}" and wrote ` +
    `findings to /tmp/findings/${a.key}.md.\n${RULES}\n\n` +
    `Read that file. Your job is the COMPLETENESS CRITIC pass: find what is missing, ambiguous, or ` +
    `wrong. Specifically look for (a) claims that are not backed by an observed run, (b) behaviours in ` +
    `this area that were never tested, (c) exact strings/geometry/styles that are still unknown.\n` +
    `Then RUN the executable yourself to fill the gaps you found, and APPEND a section ` +
    `"## Critic pass additions" to /tmp/findings/${a.key}.md with your new findings and any corrections.\n` +
    `Original area brief was:\n${a.prompt}\n\n` +
    `Return only the NEW or CORRECTED facts you established (dense notes).`,
    { label: `critic:${a.key}`, phase: 'Critique' }
  ).then(crit => ({ key: a.key, summary, crit }))
)

return results.filter(Boolean)
