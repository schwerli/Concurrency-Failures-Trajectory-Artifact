export const meta = {
  name: 'zk-behavior-map',
  description: 'Exhaustively map the reference zk binary behavior into spec files',
  phases: [
    { title: 'Explore', detail: 'parallel explorers, one per feature area' },
    { title: 'Critique', detail: 'completeness critic per area' },
  ],
}

const HARNESS = `
You are reverse-engineering a compiled CLI binary at /workspace/executable (it is \`zk\`, a
Zettelkasten note CLI). You may ONLY learn about it by RUNNING it. Absolutely forbidden:
reading source from the internet (there is no network anyway), decompiling, objdump, strace,
ltrace, gdb, nm, readelf, strings on /workspace/executable. Just run it with inputs and
observe stdout/stderr/exit codes/files it writes.

CRITICAL SETUP: the binary was built without sqlite fts5, so \`zk init\` and every
notebook command fails with "no such module: fts5" UNLESS you pre-create the database.
Use the provided harness:

    python3 /tmp/zkh/mknb.py /tmp/YOURDIR          # default config (wiki links + hashtags)
    python3 /tmp/zkh/mknb.py /tmp/YOURDIR empty    # empty config.toml
    python3 /tmp/zkh/mknb.py /tmp/YOURDIR cfg.toml # custom config file

That creates a WORKING notebook at /tmp/YOURDIR with .zk/config.toml,
.zk/templates/default.md ("# {{title}}\\n\\n{{content}}\\n") and a pre-migrated
.zk/notebook.db. Use a unique directory name so you do not collide with other agents.
Then: cd /tmp/YOURDIR && /workspace/executable <args> --no-input

Notes:
- Always pass --no-input or </dev/null so it never blocks on a prompt.
- Full-text search (-m without -M exact/re) does NOT work (bm25/fts5 missing). Record that
  fact but do not fight it.
- If you need to inspect what the binary wrote into the index, you may read
  .zk/notebook.db with python3's sqlite3 module. The schema is at /tmp/zkh/schema.sql
  (reverse engineered; the binary's real schema may have more columns that the binary
  never needed from us). Reading the index is a great way to learn exact parsed values.
- To drive interactive prompts you can use: python3 /tmp/zkh/../probe/ptyrun.py <cwd> <args...> --IN 'y\\n'
  (a pty driver at /tmp/probe/ptyrun.py that answers terminal cursor-position queries).
- Use \`cat -A\` or \`od -c\` to capture exact whitespace/escape bytes when output has ANSI codes.
  When capturing colors, note the binary only emits ANSI when stdout is a TTY (use the pty
  driver to see colored output, and plain pipes to see uncolored output).

DELIVERABLE: write a thorough, precise, implementation-ready markdown spec to the file path
given below. Include EXACT literal strings, exact spacing, exit codes, and concrete
observed input->output examples (transcripts). Someone must be able to reimplement this
area byte-for-byte from your spec without access to the binary. Be exhaustive; length is
fine. Do not speculate without marking it as unverified.
`;

const AREAS = [
  {
    key: 'cli',
    file: '/tmp/spec/01-cli.md',
    task: `Area: top-level CLI surface and argument parsing.
- Capture byte-exact help output for: \`zk\`, \`zk -h\`, \`zk --help\`, \`zk --version\`, and
  \`--help\` for EVERY subcommand (init, index, new, list, graph, edit, tag, tag list, lsp)
  and any hidden commands you can discover by trying plausible names (path, path list,
  config, completion, help, alias...). Report which ones exist vs "unexpected argument".
- Exit codes for: no args, -h, unknown command, unknown flag, bad flag value, missing
  required flag (e.g. \`zk graph\` without --format), too many args.
- Exact error message formats: e.g. \`zk: error: ...\`. Test: unknown flag, unknown command,
  invalid enum value for --match-strategy / --sort / --format, non-numeric --limit.
- How are short flags, combined short flags (-qP), --flag=value vs --flag value,
  comma-separated list flags (-t a,b), repeated flags, and \`--\` handled?
- Global flags: --notebook-dir, -W/--working-dir, --no-input. Behavior when they point at
  non-existent dirs or non-notebooks. Notebook auto-discovery (walking up parents).
- Environment variables the binary reacts to: try ZK_NOTEBOOK_DIR, ZK_SHELL, EDITOR,
  VISUAL, PAGER, ZK_PAGER, NO_COLOR, TERM, ZK_EDITOR, LC_ALL. Document precedence.
- What does zk print when run outside any notebook, for each command?
- Help output when a command has an error AND when --help is combined with other flags.`,
  },
  {
    key: 'init',
    file: '/tmp/spec/02-init.md',
    task: `Area: \`zk init\`.
- Exact bytes of the generated .zk/config.toml for every combination of wizard answers
  (wiki links yes/no x each subset of the 3 tag syntaxes) and for --no-input. Save the
  full default file to /tmp/spec/assets/config-default.toml and describe precisely which
  lines vary and how. Note: the harness copy of a generated config is at
  /tmp/zkh/default-config.toml (from \`init --no-input\`).
- Exact bytes of .zk/templates/default.md.
- The full interactive wizard transcript including ANSI escapes and prompt wording
  (use the pty driver /tmp/probe/ptyrun.py). Document the multiselect UI: option labels,
  key handling, what is printed after answering.
- What is printed on success? (the binary fails after writing files because of fts5 —
  document exactly which files exist after the failure, and infer/report the intended
  success message if you can find any way to observe it).
- Behavior: init with no directory argument, with relative/absolute path, with a path that
  does not exist (does it mkdir -p?), with a path that is a file, when .zk already exists
  (exact error), when inside an existing notebook's subdirectory, permissions.
- Exit codes for each case.`,
  },
  {
    key: 'new',
    file: '/tmp/spec/03-new.md',
    task: `Area: \`zk new\`.
- Default filename/ID generation: run it many times, characterize the random ID (charset,
  length, case). Test config id-charset (letters/numbers/alphanum/hex/custom string),
  id-length, id-case (lower/upper/mixed) under [note].
- \`--id\` to force an id. \`--title\`. Default title when none given (default-title config).
- \`filename\` template config: try "{{id}}", "{{slug title}}", "{{format-date now}}",
  "{{format-date now 'timestamp'}}", combinations. Document available variables in the
  filename template.
- \`extension\` config.
- Content templates: what variables are available in the note template? Test exhaustively:
  id, title, content, dir, filename, filename-stem, extra.*, now, format-date, slug, etc.
  Use a template file that dumps every candidate variable and see what renders.
- Reading content from stdin (-i/--interactive) vs not. What does \`{{content}}\` contain?
  Test multi-line stdin, empty stdin, and no stdin.
- --dry-run (what goes to stdout vs stderr), --print-path, both together.
- --extra key=value,... parsing (multiple pairs, values with = or commas or quotes).
- --group and [group."x"] config resolution, including \`paths\` matching and directory
  based implicit groups. Which settings can a group override?
- --date DATE: accepted formats (try natural language: today, yesterday, "last friday",
  "2020-01-02", "2020-01-02 10:00", ISO8601). How does it affect id/filename/template now?
- --template PATH (relative to .zk/templates, absolute, ~ expansion, missing file error).
- Filename collision handling: what happens if the generated filename already exists?
  (test with a fixed filename template and creating twice) — exact error or dedup suffix.
- Creating a note in a subdirectory argument that doesn't exist; nested dirs.
- What is printed on success (no -p/-n)? It tries to launch an editor: test with
  EDITOR=/bin/true, EDITOR=cat, EDITOR unset, EDITOR="" and document exactly.
- Exit codes and error strings for all failure modes.`,
  },
  {
    key: 'templates',
    file: '/tmp/spec/04-templates.md',
    task: `Area: the template engine (a Handlebars dialect) used by --format TEMPLATE, note
templates, filename templates, link-format, lsp completion settings, etc.
Use \`zk list --format '<template>'\` and note templates as probes; \`zk new -n --template\`
with a custom file is great for testing.
- Syntax: {{var}}, {{{var}}} (unescaped?), HTML escaping behavior, {{#if}}/{{else}}/{{/if}},
  {{#unless}}, {{#each}} with {{this}}/{{@index}}/{{@first}}/{{@last}}, {{#with}},
  nested paths {{a.b.c}}, {{../x}}, comments {{! }} and {{!-- --}}, literal braces,
  subexpressions (helper (helper x)), partials {{> name}}, whitespace control {{~ }}.
- Helpers: exhaustively probe which named helpers exist and their exact semantics/args.
  Candidates to test: format-date (with formats: short, medium, long, full, year, month,
  day, time, timestamp, timestamp-unix, elapsed, iso, cust; plus custom Go/strftime-ish
  layout strings), slug, date, prepend, list, json, style, concat, substring, upper,
  lower, len, shorten, links... For each, show exact outputs on concrete inputs.
- Error behavior: unknown helper, unknown variable, malformed template — exact messages
  and exit codes.
- Which variables are in scope for \`zk list --format\`? Dump them all (compare with the
  json format field list: filename, filenameStem, path, absPath, title, link, lead, body,
  snippets, rawContent, wordCount, tags, metadata, created, modified, checksum).
  Determine the template-side names (kebab-case?) e.g. {{filename-stem}}, {{word-count}},
  {{raw-content}}, {{abs-path}}, {{snippets}}, {{checksum}}, {{created}}, {{modified}}.
- Date value rendering: what does {{created}} render as by default?
- Does \`\\n\` in a --format string get unescaped? Test \`--format '{{title}}\\n{{path}}'\`,
  --delimiter '\\t', --header '\\n', footer default "\\\\n".`,
  },
  {
    key: 'markdown',
    file: '/tmp/spec/05-markdown.md',
    task: `Area: markdown/note parsing. Determine exactly how the indexer derives every field.
Create many small notes and read the resulting values via
\`zk list -f json\` and by querying .zk/notebook.db with python3 sqlite3
(tables: notes, links, collections, notes_collections).
- title: from first H1? setext heading? frontmatter \`title:\`? filename fallback? What if
  the first heading is H2/H3, or the file starts with text, or is empty? Does the title get
  stripped of markdown formatting/links? Multiple H1s?
- lead: definition (first paragraph after title?), how blockquotes/lists/code blocks count.
- body: exact content (everything after title? after frontmatter?). Trailing newlines.
- rawContent: exact file bytes? includes frontmatter?
- wordCount: exact counting rule (test punctuation, hyphens, CJK, frontmatter inclusion,
  markdown syntax, code blocks).
- checksum: verify it is sha256 of what exactly (compare with sha256sum of file / of body).
- frontmatter: YAML subset supported. Test: --- delimited, +++?, keys title/tags/keywords/
  date/created/modified/aliases/custom, scalar vs list vs nested map vs inline [a, b] vs
  block list, quoting, booleans, numbers, dates. What lands in \`metadata\` (the json
  \`metadata\` field)? Are keys lowercased? Which keys are special?
- created/modified timestamps: where do they come from (file mtime? frontmatter date?
  filename date?). Test frontmatter \`date:\`/\`created:\` overriding.
- tags: with hashtags on/off, colon-tags on/off, multiword-tags on/off. Exhaustive edge
  cases: #tag, #tag1#tag2, #123, #tag/sub, #tag-with-dash, #tag_underscore, #tag., in code
  blocks, in inline code, in URLs (http://x.com/#frag), at line start, escaped \\#tag,
  #multi word tag#, :a:b:, :a::b:, unicode tags, trailing punctuation. Also frontmatter
  tags + keywords merging and dedup/order.
- links: markdown [t](u), reference links, autolinks <http://x>, bare URLs, images
  ![a](b), wiki [[a]], [[a|b]], [[a\\|b]], [[dir/a]], #[[a]] (?), [[[a]]]? and any
  rel syntax like [t](u "rel"), [#down](x)? Determine the recorded fields per link:
  title/href/type/external/rels/snippet/snippet_start/snippet_end. Read the links table.
- Which files are indexed: extension filter, hidden files/dirs, .zk dir, symlinks,
  non-UTF8, empty files, very large. Sub-directory recursion.`,
  },
  {
    key: 'index',
    file: '/tmp/spec/06-index.md',
    task: `Area: \`zk index\` and the indexing lifecycle.
- Exact output text for: 0 notes, 1 note, N notes; singular vs plural ("Indexed 1 note in 0s"
  vs "Indexed 3 notes in 0s"); the "+ added / ~ modified / - removed" lines (exact spacing,
  exact bytes via cat -A). What does the duration look like (units, rounding)? Does it show
  a progress spinner on a tty (use the pty driver)?
- -v/--verbose output lines for added/modified/removed notes (exact format and order).
- -q/--quiet output.
- -f/--force behavior and its effect on counts.
- Change detection: modify a note (content only, mtime only via touch), rename, delete,
  add. Show resulting counts. Is it checksum or mtime based?
- \`exclude\` config globs: test patterns "drafts/*", "log.md", "**/x", "*.tmp", directory
  names, leading slash, negation. Also test a .zkignore file if it exists.
- Automatic indexing: which commands trigger an index before running? Does \`zk list\`
  reindex automatically (add a file then list without index)? Does it print anything?
- Ordering of the verbose lines and of DB ids.
- Behavior when a note is unreadable / when the notebook dir has no notes.
- Exit codes.`,
  },
  {
    key: 'filters',
    file: '/tmp/spec/07-filters.md',
    task: `Area: note filtering flags for list/edit/graph.
Build a notebook with a rich link/tag graph (at least 8 notes, nested dirs, cycles,
orphans, tagless notes, dead links) and characterize EVERY filter precisely:
- positional <path> args: exact matching semantics (exact path, path prefix/descendants,
  filename without extension, title?, glob?, absolute paths, "." and subdir, trailing /),
  multiple paths (OR), case sensitivity, nonexistent path (error or empty?).
- -x/--exclude with same semantics questions.
- -t/--tag: single, comma list (AND or OR?), "a OR b", "a|b", negation "-a" / "NOT a",
  quoting, globs "a*", hierarchical "a/b", case sensitivity. Document the mini-language.
- --mention / --mentioned-by semantics (how is a "mention" detected? title match in body?
  case sensitivity, word boundaries, frontmatter aliases?).
- -l/--link-to, --no-link-to, -L/--linked-by, --no-linked-by, --max-distance, -r/--recursive
  interaction. Show concrete graphs and results.
- --orphan, --tagless, --missing-backlink exact definitions.
- --related semantics.
- Date filters: --created, --created-before/-after, --modified, --modified-before/-after.
  Test accepted date formats exhaustively including natural language: "today",
  "yesterday", "tomorrow", "last week", "last two weeks", "2 days ago", "monday",
  "last friday", "january", "2020", "2020-01", "2020-01-02", "2020-01-02 15:04",
  "02/01/2020", ISO8601, invalid values (exact error). Are bounds inclusive/exclusive?
  What timezone? Is --created a whole-day range?
- -n/--limit (0, negative, larger than count), --sort/-s all terms: created, modified,
  path, title, random, word-count, and +/- suffixes and "asc"/"desc" spellings, multiple
  sort terms, invalid term error message.
- Interaction/precedence when many filters combined, and named [filter] config entries
  used as positional args (e.g. filter.recents = "--sort created- --created-after 'last two weeks'").
- Exact error messages for invalid values.`,
  },
  {
    key: 'formats',
    file: '/tmp/spec/08-formats.md',
    task: `Area: \`zk list\` output formatting and \`zk tag list\` output.
- Byte-exact output (use cat -A) of every predefined format: oneline, short, medium, long,
  full, json, jsonl — with 0, 1 and 3 notes, notes with/without tags, with empty lead,
  long lead (is it wrapped/indented/truncated?), nested paths, unicode.
- What exactly differs between short/medium/long/full (dates shown, tags, lead)?
- Date formats used in each (e.g. 08/10/2026 vs "August 10, 2026"). Does \`language\`
  config change them?
- The trailing "Found N notes" / "Found 1 note" line: exact wording, where it goes
  (stdout/stderr), plural rules, 0 notes ("Found 0 note"?), suppressed by -q.
- --header/--footer/--delimiter/-0 exact semantics and interaction with the found-count
  line and with json (does json still emit brackets/commas with custom delimiter?).
- Custom --format template output, including the default indentation of {{lead}} in full.
- Colors/styling: capture with the pty driver; document exact ANSI sequences per format
  and per element (title, path, dates, tags, snippet match highlight). Test NO_COLOR and
  piping.
- Pager: does it invoke a pager on tty? \`tool.pager\` config, -P/--no-pager, PAGER env.
  Document how it decides.
- \`zk tag list\`: formats name/full/json/jsonl, --sort options (name, note-count, random?),
  exact output incl. note counts, "Found N tag" line, delimiters, header/footer, colors.
- \`zk graph --format json\`: exact JSON shape (nodes/edges keys, fields per node/edge,
  ordering, empty case) and error when --format missing/unknown.`,
  },
  {
    key: 'edit-lsp',
    file: '/tmp/spec/09-edit-lsp.md',
    task: `Area: \`zk edit\`, editor/pager/fzf integration, and \`zk lsp\`.
- \`zk edit\`: with 0 matches (exact message + exit code), 1 match, many matches (the
  confirmation prompt text — use the pty driver), -f/--force, --no-input behavior,
  how the editor is chosen (tool.editor config vs ZK_EDITOR vs VISUAL vs EDITOR env),
  how arguments are passed (test EDITOR='echo ARGS:' or a wrapper script that dumps
  "$@"), quoting of paths with spaces, working directory of the child process, and which
  env vars are set for the child (write a wrapper script that dumps env | grep ZK).
- Same for the editor launched by \`zk new\` (no -p/-n).
- \`zk list -i\` / \`zk edit -i\`: fzf is probably not installed — document the exact error.
  If fzf-like behavior can be probed with a fake \`fzf\` on PATH that dumps its argv and
  stdin, do that and document the exact command line and the input lines zk feeds it,
  plus tool.fzf-preview / fzf-options config effects.
- \`zk lsp\`: it speaks LSP over stdio. Drive it with a python script that writes
  Content-Length framed JSON-RPC. Capture the exact \`initialize\` result (capabilities
  JSON), server info/name/version, and then probe: textDocument/didOpen,
  textDocument/completion (for [[ and # and :), textDocument/definition,
  textDocument/documentLink, textDocument/hover, textDocument/references,
  textDocument/publishDiagnostics notifications, workspace/executeCommand
  (zk.index, zk.new, zk.list, zk.tag.list, zk.link ...), shutdown/exit.
  Document the exact JSON of every response you can elicit. Note which methods return
  "method not found" (-32601). This is a big surface; be systematic and thorough.`,
  },
  {
    key: 'config',
    file: '/tmp/spec/10-config.md',
    task: `Area: configuration file handling.
- The TOML subset that must be supported: which value types appear/are accepted (strings
  with single/double quotes, multiline strings, booleans, integers, arrays, inline tables
  e.g. missing-backlink = { level = "hint", position = "bottom" }, nested tables,
  dotted keys, comments). Test malformed TOML -> exact error message and exit code.
- Every recognized key and its effect. Sections: [note] (language, default-title, filename,
  extension, template, exclude, id-charset, id-length, id-case), [extra], [group."x"]
  (+ .note/.extra/paths), [format.markdown] (hashtags, colon-tags, multiword-tags,
  link-format, link-encode-path, link-drop-extension), [tool] (editor, shell, pager,
  fzf-preview, fzf-options?, fzf-line?, fzf-bind?), [lsp.diagnostics] (wiki-title,
  dead-link, self-link, missing-backlink), [lsp.completion] (note-label, note-filter-text,
  note-detail), [filter], [alias].
  For each: exact accepted values and what an invalid value does (error text).
- Unknown keys/sections: ignored or error? Test typos.
- Config discovery: notebook .zk/config.toml plus a global config
  (XDG_CONFIG_HOME/zk/config.toml or ~/.config/zk/config.toml). Test whether a global
  config is loaded and how it merges with the notebook config, and whether commands work
  OUTSIDE a notebook using only global config (e.g. aliases).
- [alias]: how aliases are executed (shell, $@ expansion, exit code propagation, stdout),
  precedence vs builtin commands, ZK_* env vars available to the alias (dump env),
  arguments/flags passing, alias that shadows a builtin, unknown command with no alias
  (exact error), nested aliases, tool.shell config, $SHELL env.
- [filter]: named filters used as positional args; how the flags are parsed (shell-like
  quoting), unknown named filter behavior, combining with other flags.
- \`link-format\`: exact output of generated links for "wiki" / "markdown" / custom template
  and interaction with link-encode-path / link-drop-extension. Where are generated links
  observable? ({{link}} in list format, and lsp).`,
  },
]

phase('Explore')

const results = await pipeline(
  AREAS,
  a => agent(HARNESS + "\n\nWrite your spec to: " + a.file + "\n\n" + a.task +
    "\n\nWhen done, reply with a SHORT summary (<=15 lines) of the most surprising/critical findings and the absolute path you wrote. Do not paste the spec back.",
    { label: 'explore:' + a.key, phase: 'Explore' }),
  (r, a) => agent(HARNESS + "\n\nA previous agent wrote a spec for area '" + a.key + "' at " + a.file +
    ". Read it. Your job: find what is MISSING, WRONG, or UNVERIFIED. Re-run the binary to check its " +
    "concrete claims (spot-check at least 10 specific claims, especially exact strings/spacing) and to " +
    "cover gaps it left. Then EDIT the file " + a.file + " in place to correct errors and append/merge the " +
    "new findings (keep it organized; do not delete correct content). Focus on things a reimplementer " +
    "would get wrong: exact wording, pluralization, spacing, ordering, exit codes, edge cases.\n\n" +
    "Original area brief was:\n" + a.task +
    "\n\nReply with a SHORT list (<=15 lines) of corrections you made.",
    { label: 'critique:' + a.key, phase: 'Critique' })
)

return { areas: AREAS.map(a => a.file), notes: results.filter(Boolean).length }
