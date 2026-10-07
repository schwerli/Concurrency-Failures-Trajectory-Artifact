export const meta = {
  name: 'jot-recon',
  description: 'Exhaustively probe the jot/jt reference binary behavior across all command dimensions',
  phases: [
    { title: 'Probe', detail: 'parallel behavioral probes, one agent per command dimension' },
    { title: 'Gaps', detail: 'completeness critic finds unprobed surface' },
  ],
}

const HARNESS = `Read /probe/HARNESS.md FIRST — it explains the sandbox runner and known storage layout.

You are reverse-engineering the reference binary /workspace/executable (a CLI named \`jt\`, project "jot",
a terminal note manager). You may ONLY observe it by running it. NEVER decompile, objdump, strace,
ltrace, nm, strings, or read its bytes. NEVER search the web or package registries for its source.

Use a UNIQUE sandbox dir: export SB=/probe/sb_SLOT  (substitute your slot name, given below).
Run \`/probe/reset.sh\` between independent scenarios. Run the binary ONLY via \`/probe/jt.sh <args>\`.

Be EXHAUSTIVE and MECHANICAL. For every case you try, record:
  - the exact argv
  - exact stdout bytes (pipe through \`cat -A\`), exact stderr bytes (separately), exit code
  - resulting state changes (config file, vaults file, per-vault .jot/data, directory tree)
Prefer running many cases in one bash call with clear \`### label\` separators so you cover a lot fast.

RETURN FORMAT: a dense, complete markdown report. Include LITERAL exact strings (with \\x1b escapes
written out explicitly) for every message you observed. Do not summarize away detail — another agent
will implement from your report alone and cannot re-run the binary. If you observed an ordering,
say exactly what it was and what you did to test it. Flag anything you could not determine.`

const DIMENSIONS = [
  {
    slot: 'vault',
    label: 'vault-cmd',
    prompt: `Dimension: the \`vault\` / \`vl\` subcommand (create + list).

Probe exhaustively:
- \`jt vault\` with zero vaults, one vault, many vaults (5+). Exact output, ordering of listed vaults
  (create them in a scrambled order and in different alphabetical orders to distinguish
  alphabetical vs insertion vs TOML-map order). Indentation and color bytes.
- \`jt vault -l\` in all those states. Exact separator bytes between name and location.
- \`jt vault -l\` when a registered vault's directory has been deleted from disk.
- \`jt vault <name> <location>\`: absolute location; relative location (e.g. \`.\`, \`sub/dir\`);
  location with trailing slash; location that does not exist; location that is a file;
  location that is not writable; \`~\` and \`~/x\` (does it expand?); empty-string location.
- duplicate vault name (same location, different location). Name that already exists as a directory
  at that location. Name containing spaces, dots, slashes, unicode, leading dash, very long,
  empty string. Name \`.\` or \`..\`.
- What exactly does the \`location\` field record — the parent dir you passed, canonicalized or verbatim?
  Test with a relative path, a path with \`..\` in it, a symlinked path, and a trailing slash.
- Arg count errors: \`jt vault a\` (one arg only), \`jt vault a b c\` (three args), \`jt vault -l extra\`,
  \`jt vault -l a b\`, unknown flags like \`jt vault -x\`, \`jt vault --list\`.
- alias \`vl\`. \`jt vault -h\` and \`jt vault --help\` exact bytes and stream.
- Does creating a vault set it as \`current\`? Does it create the config file if missing?
- What happens if the vaults registry file is corrupt/invalid TOML, or the .jot/data is corrupt?`,
  },
  {
    slot: 'enter',
    label: 'enter-chdir',
    prompt: `Dimension: the \`enter\`/\`en\` and \`chdir\`/\`cd\` subcommands, and the \`folder\`+\`history\`
fields in <vault>/.jot/data.

Probe exhaustively:
- \`jt enter <name>\`: valid vault, nonexistent vault, vault registered but directory deleted,
  entering the vault you are already in, entering while inside another vault (does the old vault's
  \`folder\` field persist?). Missing arg, extra args. alias \`en\`. \`-h\`.
- After entering, what exactly changes in the vaults registry and in .jot/data?
- \`jt chdir <path>\`: relative child folder; nested \`a/b\`; with and without leading/trailing slash;
  absolute-from-vault-root \`/a/b\`; \`..\`; \`../..\` past the vault root (does it clamp or error?);
  \`.\`; empty string; \`~\`; a path naming a NOTE not a folder; a nonexistent folder;
  a path with \`..\` in the middle like \`a/../b\`; backslashes; multiple slashes \`a//b\`.
- Exact success message and exact error messages, and whether \`folder\` in .jot/data changes on error.
- What EXACTLY is stored in the \`folder\` field for nested folders (separator, leading/trailing slash)?
- The \`history\` array in .jot/data: figure out what writes it and what reads it. Try \`jt chdir -\`,
  \`jt chdir --\`, and any command that might push history. Report the exact serialized form when
  non-empty (create that state if you can).
- \`jt chdir\` while not in any vault.
- Does \`list\`'s breadcrumb header (\`v1 > f1 > f2\`) match the folder field? Exact bytes/colors.`,
  },
  {
    slot: 'create',
    label: 'note-folder-create',
    prompt: `Dimension: the \`note\`/\`nt\` and \`folder\`/\`fd\` creation subcommands, and the
\`conflict\` config setting.

Probe exhaustively:
- \`jt note <name>\` and \`jt folder <name>\` inside a vault at root and inside nested folders.
  Exact success messages + colors. Is the created note file empty? Any front-matter/content?
  File permissions/mode of created note and folder.
- Name handling: does \`jt note foo.md\` create \`foo.md\` or \`foo.md.md\`? What about \`foo.txt\`,
  \`foo.MD\`, \`foo.\`, a name with a slash \`a/b\`, leading \`/\`, \`..\`, \`.\`, empty string \`""\`,
  spaces, unicode, leading dash \`-x\` (clap flag confusion), very long names, names with quotes
  or backslashes or newlines.
- Duplicates: creating a note that already exists; a note whose name collides with a folder;
  a folder that collides with a note. What does the \`conflict = true\` config do? Set it to false via
  \`jt config conflict false\` and re-test duplicates. Report exact messages in BOTH modes and whether
  the existing file's content is preserved or truncated (put text in the file first).
- \`jt note\` / \`jt folder\` with NO argument (the help says the arg is optional \`[note name]\`).
  Does it prompt on stdin? Test with stdin closed (\`</dev/null\`), with piped input
  (\`printf 'abc\\n' |\`), and with empty input. Capture the exact prompt bytes.
  If it prompts, probe the prompt loop: empty answer, whitespace, duplicate name, EOF.
- Running these outside a vault. Extra args. \`-h\` output for both. Aliases.
- Does creating items touch the vault's .jot/data (history?) at all?`,
  },
  {
    slot: 'list',
    label: 'list-cmd',
    prompt: `Dimension: the \`list\`/\`ls\` subcommand.

Probe exhaustively:
- Exact tree-drawing bytes. Confirmed so far: header line is the breadcrumb, then each item is
  prefixed \`\\u251c\\u2500\\u2500 \` (├── ) except the LAST which is \`\\u2514\\u2500\\u2500 \` (└── ).
  Notes are wrapped in blue \`\\x1b[0;34m...\\x1b[0m\`, folders appear plain. VERIFY this and check
  whether folders get any color/suffix, and whether note names are shown with or without \`.md\`.
- ORDERING. This is critical: create many notes and folders in scrambled orders (e.g. create
  z,a,m,b as notes and Q,c,B as folders) and determine the exact ordering rule. Is it
  notes-then-folders? alphabetical? case-sensitive? reverse? filesystem readdir order?
  Repeat the experiment several times with fresh vaults and different creation orders, and also
  test after renames/removals, to distinguish "readdir order" from a deterministic sort.
  Also test what happens with 30+ items. Report your confidence.
- \`jt list <item type>\`: the values \`note\`, \`nt\`, \`folder\`, \`fd\`, \`vault\`, \`vl\`, and an invalid
  value like \`xyz\`, and an empty string. Exact outputs including header line.
- \`jt list\` in an empty vault, in an empty subfolder, outside any vault.
- Are hidden files (dotfiles) shown? Create \`.hidden.md\` and \`.hiddendir\` manually and check.
  Is \`.jot\` shown? Are non-.md files (e.g. \`foo.txt\`, \`foo\`) shown, and if so how?
- Nested content: does list recurse or only show one level?
- Extra args, aliases, \`-h\`.`,
  },
  {
    slot: 'openeditor',
    label: 'open-opdir-config',
    prompt: `Dimension: the \`open\`/\`op\`, \`opdir\`/\`od\`, and \`config\`/\`cf\` subcommands, plus how the
editor / file-explorer child process is launched.

Probe exhaustively:
- \`jt config\` with no args: what happens? (help says it opens the config in an editor). Capture
  output/exit code. Since \`nvim\` may not exist here, note the exact failure message.
- \`jt config <field>\` for \`editor\` and \`conflict\`, and for an unknown field like \`foo\`. Exact bytes.
- \`jt config <field> <value>\`: set editor to various values; set conflict to \`false\`, \`true\`,
  \`FALSE\`, \`yes\`, \`0\`, \`garbage\`. Exact messages + resulting config file bytes. Does setting an
  unknown field add it? Extra args. Empty value. Value with spaces/quotes.
- \`jt open <note>\`: create a fake editor on PATH to observe invocation. E.g.
    printf '#!/bin/sh\\nprintf "ARGV:"; for a in "$@"; do printf " [%s]" "$a"; done; echo; echo "CWD=$(pwd)"; exit 0\\n' > /probe/fakeed && chmod +x /probe/fakeed
  then \`/probe/jt.sh config editor /probe/fakeed\` and \`/probe/jt.sh open n1\`.
  Determine: exact argv passed to the editor, the child's cwd, whether the parent waits for it,
  whether stdin/stdout are inherited, and the parent's exit code when the editor exits 0 vs nonzero.
  Also test an editor value containing arguments, e.g. \`editor = "/probe/fakeed --flag"\` — is the
  string split on spaces or executed as one program name?
- \`jt open\` on: nonexistent note, a folder name, a name with \`.md\` suffix given explicitly,
  outside a vault, missing arg, extra args. Does \`open\` create the note if missing?
- \`jt opdir\`: which program does it launch? Put shims on PATH for \`xdg-open\`, \`open\`, \`explorer.exe\`,
  \`nautilus\`, \`thunar\`, \`dolphin\`, \`gio\`, \`ranger\`, \`nnn\`, \`lf\`, \`vifm\`, \`mc\` etc. (make each shim
  echo its own name and argv) and see which is invoked and with what argument. Test at vault root and
  in a nested folder, and outside a vault. Report the exact error when the launcher is absent
  (temporarily set PATH to something minimal).
- aliases and \`-h\` for all three.`,
  },
  {
    slot: 'fsops1',
    label: 'remove-rename',
    prompt: `Dimension: the \`remove\`/\`rm\` and \`rename\`/\`rn\` subcommands.

Probe exhaustively for EACH item type (\`vault\`/\`vl\`, \`note\`/\`nt\`, \`folder\`/\`fd\`):
- \`jt remove <type> <name>\`. Does it prompt for confirmation? Test with piped \`y\`, \`n\`, \`yes\`, \`no\`,
  empty line, garbage, and EOF (\`</dev/null\`). Capture the exact prompt bytes and the behavior
  for each answer. Does removing a vault delete the files on disk or only unregister it?
  What happens to \`current\` in the registry if you remove the current vault?
- Removing a non-empty folder (recursive?), a nonexistent item, a note when a folder of that name
  exists, an item outside a vault, \`.\`/\`..\`, a path like \`a/b\` (nested target), a name with \`.md\`.
- \`jt rename <type> <old> <new>\` for each type. Renaming a vault: does it move the directory on disk,
  update the registry key, update \`current\`, and update the vault's own .jot/data \`name\` field?
  Renaming to an existing name (both with \`conflict = true\` and \`false\`). Renaming to the same name.
  Renaming with a path in old or new (\`a/b\`). Renaming a note with/without \`.md\` in old and new.
  Renaming the folder you are currently inside (does \`folder\` in .jot/data update?).
  Renaming a nonexistent item. Empty new name.
- Invalid item type strings (\`xyz\`, \`vaults\`, \`n\`, \`f\`, \`v\`, empty). Missing/extra args.
- Exact success and error messages with color bytes, and exit codes, for everything.
- aliases and \`-h\` for both.`,
  },
  {
    slot: 'fsops2',
    label: 'move-vmove',
    prompt: `Dimension: the \`move\`/\`mv\` and \`vmove\`/\`vm\` subcommands.

Probe exhaustively:
- \`jt move <type> <name> <new location>\` for types \`note\`/\`nt\`, \`folder\`/\`fd\`, \`vault\`/\`vl\`.
  For note/folder the docs say the new location is relative to the CURRENT FOLDER as root — verify
  precisely. Test: child folder \`f1\`, \`f1/f2\`, leading slash \`/f1\` (vault root?), \`..\`,
  \`.\`, empty string, a nonexistent folder, a note used as the destination, an absolute filesystem
  path outside the vault, trailing slashes, and moving into the folder you are currently in.
- Moving a vault: what does <new location> mean (a filesystem directory)? Does it move the directory
  and update the registry + the vault's own .jot/data \`location\` field? Nonexistent destination,
  destination that is a file, same location, relative destination.
- Name collisions at the destination (with \`conflict = true\` and \`conflict = false\`): does it
  overwrite, error, or rename? Verify by putting distinct content in the two files.
- Moving the folder you are currently inside; moving a folder into itself or into its own
  descendant.
- \`jt vmove <type> <name> <vault name>\`: note and folder into another vault. Where in the target
  vault does it land — the target vault's root, or the target vault's CURRENT folder? Test both by
  setting the destination vault's current folder to a subfolder first. Vault type as item type
  (should be rejected?). Nonexistent target vault, the current vault as target, collisions in the
  target, target vault whose directory is missing.
- Exact success and error messages with color bytes, and exit codes, for everything.
- Missing/extra args, invalid item types, aliases, \`-h\` for both.`,
  },
  {
    slot: 'clap',
    label: 'argparse-help',
    prompt: `Dimension: the argument-parsing layer (this binary is built with Rust clap v3) and the
complete help/usage/error text catalog.

Probe exhaustively and capture EXACT BYTES (cat -A) plus stream (stdout vs stderr) plus exit code:
- \`jt\` (no args) — already known: help to stderr, exit 2. Confirm byte-exact.
- \`jt -h\`, \`jt --help\`, \`jt help\`, \`jt help help\`, \`jt help <each subcommand>\`,
  \`jt <each subcommand> -h\`, \`jt <each subcommand> --help\`. Do \`help X\` and \`X -h\` produce
  identical text and identical streams?
- \`jt help nosuchcmd\`, \`jt help vault extra\`, \`jt help -h\`.
- Unknown subcommand: \`jt bogus\`, \`jt Vault\` (case), \`jt v\` (ambiguous prefix?), \`jt vaul\`
  (prefix matching?). Exact error text.
- Every alias: vl, nt, fd, en, op, od, cd, ls, rm, rn, mv, vm, cf. Confirm each works and check for
  any UNDOCUMENTED aliases or subcommands (try plausible ones: \`ver\`, \`version\`, \`init\`, \`status\`,
  \`current\`, \`cur\`, \`pwd\`, \`find\`, \`search\`, \`grep\`, \`sync\`, \`edit\`, \`ed\`, \`new\`, \`del\`, \`delete\`,
  \`cat\`, \`show\`, \`tree\`, \`back\`, \`b\`, \`up\`, \`root\`, \`generate\`, \`completion\`, \`completions\`).
- Global flags: \`-V\`, \`--version\`, \`-v\`, \`--verbose\`, \`--color\`, \`--no-color\`, \`-q\`. Does the
  NO_COLOR or TERM env var change the color output? Does piping (not a tty) change it? Test
  \`NO_COLOR=1\`, \`TERM=dumb\`, \`CLICOLOR=0\`.
- Arguments starting with \`-\` as values: \`jt note -- -weird\`, \`jt note -weird\`.
- Too many positional args for each subcommand — exact clap error text.
- Missing required args for each subcommand — exact clap error text (note which subcommands have
  required vs optional args).
- Exit codes for every error class.
Report the FULL verbatim help text of every subcommand and the full verbatim text of every clap
error you triggered.`,
  },
  {
    slot: 'state',
    label: 'state-files',
    prompt: `Dimension: on-disk state file formats, serialization details, and recovery behavior.

Probe exhaustively:
- Exact byte content of \$XDG_CONFIG_HOME/jot/config in every state: fresh (defaults), after
  \`config editor X\`, after \`config conflict false\`, after setting an unknown key. Trailing newline?
  Key order? Quote style (single vs double)? Blank lines?
- Exact byte content of \$XDG_DATA_HOME/jot/vaults with: no vaults; 1 vault; 5 vaults; with and
  without \`current\`; after entering/removing/renaming vaults. Key ORDER in the [vaults] table
  (insertion? alphabetical? hash order? — create vaults in scrambled name order to tell).
  Exact placement of \`current\` and blank lines.
- Exact byte content of <vault>/.jot/data in every state. Get \`history\` to be non-empty if possible
  and report the exact serialization. What is history for?
- Values needing escaping: vault names / editor values containing single quotes, double quotes,
  backslashes, newlines, unicode, \`#\`. Does it switch quote style or escape? (Set them via the CLI.)
- When are these files created? Does merely running \`jt\` or \`jt -h\` create them? Does \`jt vault\`
  (list) create them? Which command first creates the config file, and the vaults file?
- Directory creation: are parent dirs created recursively? What mode?
- Corruption/recovery: make config invalid TOML, missing, empty, a directory, unreadable(chmod 000);
  same for the vaults file and for .jot/data. Record the exact error/behavior in each case.
- Registry pointing at a vault dir that no longer exists / whose .jot/data was deleted:
  what does \`vault\`, \`vault -l\`, \`enter\`, \`list\` do?
- \`current\` naming a vault not present in [vaults].
- Does the tool ever use the process CWD for anything? Run from different cwds and check.
- Are there any other env vars it reads? Test JOT_*, EDITOR, VISUAL, PAGER by setting them and
  seeing if behavior changes (especially whether \$EDITOR/\$VISUAL override the config editor).`,
  },
]

phase('Probe')

const reports = await parallel(DIMENSIONS.map((d) => () =>
  agent(
    HARNESS.replace('SLOT', d.slot) + '\n\nYour sandbox slot name is: ' + d.slot +
    ' (so `export SB=/probe/sb_' + d.slot + '`).\n\n' + d.prompt,
    { label: d.label, phase: 'Probe' }
  ).then((text) => ({ label: d.label, text }))
))

const good = reports.filter(Boolean)
log(`collected ${good.length}/${DIMENSIONS.length} probe reports`)

phase('Gaps')

const combined = good.map((r) => `## REPORT: ${r.label}\n\n${r.text}`).join('\n\n---\n\n')

const gapFindings = await parallel([
  () => agent(
    HARNESS.replace('SLOT', 'gap1') +
    `\n\nYour sandbox slot: gap1.\n\nBelow are behavioral reports from 8 other probe agents covering ` +
    `the jot binary. Your job is the COMPLETENESS CRITIC role: identify what is MISSING, UNVERIFIED, ` +
    `or CONTRADICTORY across them, then GO RUN THE BINARY YOURSELF to resolve those gaps.\n\n` +
    `Focus especially on: (a) any place a report says "unclear"/"could not determine"/"probably"; ` +
    `(b) contradictions between two reports; (c) interactive prompts and stdin handling; ` +
    `(d) exact ordering rules for listings; (e) exit codes; (f) stdout-vs-stderr routing.\n\n` +
    `Return: a list of RESOLVED gaps with the exact observed behavior, and a list of anything still ` +
    `genuinely unresolved.\n\n${combined}`,
    { label: 'gap-critic', phase: 'Gaps' }
  ),
  () => agent(
    HARNESS.replace('SLOT', 'gap2') +
    `\n\nYour sandbox slot: gap2.\n\nYou are an INDEPENDENT adversarial explorer. Other agents have ` +
    `probed the obvious surface of the jot binary. Your job is to find behavior they would have MISSED. ` +
    `Ideas: multi-command sequences that leave inconsistent state; operating on a vault from inside ` +
    `another vault; symlinks; case-insensitive collisions; very deep nesting; names that are also ` +
    `subcommand names or aliases; concurrent-ish state (edit the TOML by hand then run a command); ` +
    `what happens when the vault location itself is inside another vault; a vault named the same as ` +
    `an existing note; unicode/emoji names; names with trailing spaces; the ` + '`history`' + ` field's ` +
    `actual purpose (try to make it non-empty by every means you can think of); whether any command ` +
    `reads from stdin unexpectedly; whether any command is a no-op stub. Also verify the ` +
    `ASCII-art banner is byte-identical between the no-args (stderr) path and the --help (stdout) path.` +
    `\n\nReturn a dense report of everything surprising you found, with exact bytes and exit codes.` +
    `\n\nFor context, here is what the other agents found (do not just repeat it):\n\n${combined}`,
    { label: 'adversarial-explorer', phase: 'Gaps' }
  ),
])

return {
  probes: good.map((r) => ({ label: r.label, report: r.text })),
  gaps: gapFindings.filter(Boolean),
}
