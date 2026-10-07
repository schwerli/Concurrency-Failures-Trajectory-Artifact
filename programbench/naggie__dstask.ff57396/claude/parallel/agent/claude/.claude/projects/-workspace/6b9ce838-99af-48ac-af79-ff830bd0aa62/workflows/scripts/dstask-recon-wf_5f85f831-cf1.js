export const meta = {
  name: 'dstask-recon',
  description: 'Fan out exhaustive behavioural recon of the dstask executable into spec files',
  phases: [
    { title: 'Recon', detail: '12 parallel explorers probing disjoint behaviour areas' },
    { title: 'Critique', detail: 'completeness critics find gaps' },
  ],
}

const HARNESS = `Read /tmp/spec/HARNESS.md FIRST and follow it exactly (it contains hard rules and setup).
You are reverse-engineering /workspace/executable (the "dstask" CLI) purely by running it.
Use a unique sandbox dir under /tmp/labs/. Be relentless: run dozens of commands, try malformed
input, empty repos, weird unicode, very long strings, etc. Record VERBATIM output and exit codes.
Write your report to the given path. Your final message should just be a short summary of what you
covered plus anything you could NOT determine.`

const AREAS = [
  {
    file: 'cli-parsing.md',
    label: 'cli-parsing',
    task: `AREA: command-line / query parsing.
Determine exactly how argv is parsed into (IDs, cmd, filter/summary). Cover:
- IDs before and after the command, multiple IDs, ranges? ("dstask 1,2 done"? "dstask 1-3 done"?)
- Which tokens are recognised: +tag, -tag, project:x, -project:x, project: (empty), P0..P3,
  template:<id>, due:<...>, /note-separator, "--" (ignore context), plain text.
- Are these keywords case sensitive? (p0? PROJECT:? +Tag uppercase preserved?)
- What happens with unknown commands (treated as text?), with no args at all, with only "--".
- "dstask <id>" alone, "dstask <id> --", multiple ids alone.
- Does the position of "--" matter? Does "--" work mid-args? Multiple "--"?
- What does "/" do exactly in add/log/template/start (note capture)? Is the "/" itself dropped?
  What if "/" appears attached to a word (foo/bar)? What about a trailing "/"?
- due: formats accepted. Try due:today, due:tomorrow, due:2026-01-02, due:"2026-01-02 15:04",
  due:mon, due:+1d, due:1w, etc. Show which are accepted/rejected and the resulting yaml 'due' value.
  Also probe any other date-ish filters (the internal Query struct has fields Due, DateFilter).
- How is priority parsed if several are given? Last wins? First wins?
- Project name with slashes/dots/uppercase; are they normalised/lowercased?
- Tag/project validation: which characters are rejected, with what error message and exit code?
Report every error string verbatim with its exit code.`,
  },
  {
    file: 'yaml-format.md',
    label: 'yaml-format',
    task: `AREA: the on-disk task YAML file format, exactly.
Goal: an implementer must be able to byte-for-byte reproduce these files, and parse
hand-written ones. Cover:
- exact field order, indentation, list style, empty-value representation.
- QUOTING RULES for summary/notes/project/tags: probe strings containing
  double quotes, single quotes, backslashes, ':' followed by space, leading/trailing spaces,
  '#', '-', '?', '[', ']', '{', '}', ',', '&', '*', '!', '|', '>', '%', '@', '\`',
  newlines (via note command), tabs, non-ASCII/unicode/emoji, very long strings (>80 chars, does it
  line-wrap/fold?), strings that look like numbers/booleans ("true", "yes", "null", "123", "1.5",
  "on", "off", "~"), strings starting with "0x", empty string.
  THIS IS THE MOST IMPORTANT PART — yaml.v2 emitter behaviour. Be exhaustive. Long-string folding
  and the exact column at which it wraps matters a lot.
- multi-line notes: exactly how are they serialised (literal block? quoted with \\n?).
- timestamps: format of created/resolved/due, the zero value, timezone handling.
- What happens when you hand-edit a yml file to be invalid / missing fields / extra unknown fields?
  (error message verbatim + exit code)
- Are unknown fields preserved on rewrite or dropped?
- What are 'subtasks', 'dependencies', 'delegatedto' - can they ever be non-empty via the CLI?
- Does the file end with a trailing newline? File permissions/mode of created files & dirs?
To see wrapping, add tasks with summaries of increasing length (50..300 chars, both with spaces
and without) and dump the yml with cat -A.`,
  },
  {
    file: 'json-output.md',
    label: 'json-output',
    task: `AREA: non-tty (piped) output for every command.
For EVERY command (next, show-open, show-active, show-paused, show-resolved, show-templates,
show-unorganised, show-projects, show-tags, add, log, start, stop, done, note, modify, edit,
remove, template, context, undo, sync, git, open, help, version, _completions, and bare "dstask"),
record what goes to stdout vs stderr when piped, and the exit code.
- exact JSON shape and field order and omitempty behaviour: make tasks with/without notes, tags,
  project, due, resolved, delegatedto, subtasks, dependencies and show which keys appear/disappear.
- Is there a trailing newline after the JSON?
- show-projects and show-tags non-tty output shape (JSON? plain lines?).
- Does 'add' print the same on tty and non-tty? What exactly (including git output, colours)?
- Do informational messages go to stderr or stdout?
Use \`... > /tmp/o.txt 2>/tmp/e.txt; echo $?\` and cat -A both files.`,
  },
  {
    file: 'table-render.md',
    label: 'table-render',
    task: `AREA: the tty table renderer (use DSTASK_FAKE_PTY=1).
Goal: byte-exact reproduction of the coloured tables. Cover:
- Column set & header text for each report: next, show-open, show-active, show-paused,
  show-resolved, show-templates, show-unorganised, show-projects.
- Column sizing algorithm: how are widths computed? Total line width? Is there a max total width
  (terminal width fallback when not a real tty)? Determine the assumed width exactly by growing a
  summary until wrapping/truncation kicks in. Report the exact fallback width number.
- What happens to long summaries: truncate with what marker, or wrap onto continuation lines with
  what indent? Does 'next' truncate while 'show-open' wraps? Verify both.
- Exact ANSI sequences: header line, and each row by priority (P0/P1/P2/P3), active, paused,
  and the alternating-row background (rows seem to alternate 48;5;233 / 48;5;232 — confirm the
  rule, including how it interacts with priority colours and active/paused).
- Empty cells, empty result set (what is printed? "0 tasks."?), pluralisation ("1 task." vs "2 tasks.").
- The trailing summary line(s): exact text, blank lines before/after.
- The "N critical task(s) outside this context!" warning: exact trigger condition, exact text,
  colour, stdout or stderr, and when it does NOT appear.
- Task detail view (dstask <id> with a single match): exact rows, which rows are omitted when
  empty, ordering, colours. Include a task with notes, due, resolved, template status.
- Does a single-result 'next' always render the detail view? What about show-open with 1 result?
- Unicode/wide-character handling in column widths (emoji, CJK).
Report exact escape sequences as \\x1b[...m and give a few full lines byte-for-byte.`,
  },
  {
    file: 'cmds-mutate.md',
    label: 'cmds-mutate',
    task: `AREA: mutating commands: add, log, start, stop, done, remove, modify, template, note.
For each: exact stdout/stderr (tty and piped), exit code, which file(s) move where, what the
git commit message is (get it with 'git -C $DSTASK_GIT_REPO log --format=%s%n%b'), and how the
task yaml changes.
- add: commit message format, "Added <id>: <summary>" line, colour of git output. What if summary empty?
- add with template:<id> — what is copied, what is not (notes? status? created? resolved?).
- log: status resolved immediately; commit message; does it get an ID?
- start on pending -> active; start on resolved? start on already active? start with no id but a
  summary (creates+starts). commit messages for each.
- stop: active -> paused. stop on pending? stop with trailing text -> appended to note (exact
  format of the appended note, including separators/newlines).
- done: -> resolved, sets 'resolved' timestamp, ID freed? what happens to ids.bin. done with note text.
- remove: prompts for confirmation? exact prompt text, what stdin answers are accepted, exit code
  when declined. Does it delete the file and commit?
- modify: tags add/remove, project set/clear (project: with empty value), priority change,
  modify with no IDs (confirmation prompt over context) — exact prompt text and behaviour.
- note: 'note <id> <text>' appends. exact appended formatting. 'note <id>' with no text opens editor
  (test with EDITOR=/bin/true, EDITOR=cat, EDITOR="sh -c ..."). Which env var wins: EDITOR/VISUAL?
  What is the temp file name/extension and its initial contents?
- Batch operations with multiple IDs: output lines, single commit or many?
- Operating on a nonexistent ID: exact error + exit code.
Be exhaustive about the git commit subjects: they are user-visible.`,
  },
  {
    file: 'cmds-other.md',
    label: 'cmds-other',
    task: `AREA: context, undo, sync, git, open, edit, version, help, and unknown/hidden commands.
- context: setting tags/project/antitags, 'context none', 'context' with no args (prints current),
  invalid context (e.g. 'context 1'? 'context blah'?). Exact output & exit codes. Does it commit
  anything to git? Where is it stored? What does DSTASK_CONTEXT do and how does it interact with the
  stored context (precedence, is it printed, is a warning shown)? What syntax does DSTASK_CONTEXT use?
- Is there a message printed when a context is active during add/next? (e.g. "Using context ...")
- undo: 'undo', 'undo 3', undo with dirty tree, undo more commits than exist. Exact output, prompt?
- sync: with no remote configured (exact error text + exit code), with a local bare remote (set one
  up in your sandbox and verify the full flow incl. commit messages and merge behaviour).
- git: passthrough of args, exit code propagation, does it print anything extra?
- edit: uses editor on a yaml representation? Determine the exact temp file contents given to the
  editor (use EDITOR='cp {} /tmp/x' style tricks, or EDITOR=cat, or a script that copies $1).
  What fields are editable, what happens if the editor makes it invalid, if it exits nonzero,
  if nothing changed.
- open: which URLs are extracted (regex behaviour: http/https/www/ftp?, from summary AND notes),
  what command is invoked (BROWSER env? xdg-open?), exact error when no URLs found.
- version: exact output; any flags (--version, -v)?
- Hidden commands: _completions (already partly known). Probe for others: 'show-next', 'rm',
  'resolve', 'notes', 'help <unknown>'. Also try '--help', '-h'.
- Behaviour when $DSTASK_GIT_REPO does not exist / is not a git repo / is not writable: exact errors.
- Behaviour in a repo with zero commits, and with tasks but no ids.bin (delete it and see if IDs are
  re-derived and in what order).`,
  },
  {
    file: 'filter-sort.md',
    label: 'filter-sort',
    task: `AREA: filtering and sorting semantics.
Build a rich fixture set (20+ tasks, varied priority/tags/projects/due/status/created order) and
determine exactly:
- Sort order for 'next' and each show-* report. (priority then created? ascending/descending?
  where do active/paused tasks sort? does due date affect it? Is it a stable multi-key sort?)
  Test ties carefully. Report the precise comparator.
- Which statuses each report includes: next, show-open, show-active, show-paused, show-resolved,
  show-templates, show-unorganised.
- 'next' vs 'show-open': difference in included statuses and truncation.
- Filtering: multiple +tags (AND or OR?), -tags, project: (single or multiple? what does specifying
  two projects do?), -project:, priority filter (does P1 mean exactly P1 or P1-and-above?),
  free text search (case sensitivity, searches summary only or notes too, multiple words = AND?,
  substring or word match?), combining text with tags.
- How does the context combine with a command-line filter (union/intersection, conflicts,
  e.g. context +work then 'dstask -work')?
- Does '--' fully ignore context including the project?
- show-resolved ordering and the 1000-task limit; does it show a 'resolved' column/date?
- show-unorganised exact definition (untagged AND no project? statuses included? ignores context?).
- ID assignment/reuse: what IDs do new tasks get after some are resolved/removed? Are IDs reused?
  Confirm with ids.bin and 'dstask show-open'.`,
  },
  {
    file: 'help-text.md',
    label: 'help-text',
    task: `AREA: verbatim capture of all static text.
Produce a report containing EXACT, COMPLETE, byte-for-byte text for:
- 'dstask help' (both tty and piped — note the colour key lines use ANSI codes; give them as \\x1b[..m)
- 'dstask help <cmd>' for every command name AND every alias AND a bogus name.
- the three completion scripts (bash/zsh/fish) — reproduce fully, exactly, including trailing newlines.
- 'dstask version'.
- the colour-key block used in help/next.
Note which commands fall through to the generic usage text. Note exit codes for each help invocation
and whether help goes to stdout or stderr.
Save large verbatim blobs to files under /tmp/spec/verbatim/ (e.g. help-add.txt) using
'/workspace/executable help add > /tmp/spec/verbatim/help-add.txt 2>&1' and note in your report that
they are there, plus their sha256sums and byte sizes. Also record which are identical to the generic
usage text (compare sha256).`,
  },
  {
    file: 'completions.md',
    label: 'completions',
    task: `AREA: the hidden '_completions' subcommand, exhaustively.
It is invoked as: /workspace/executable _completions <the words the user has typed so far...>
(the first word is the program name, e.g. "dstask").
Determine the complete algorithm:
- The full ordered list of command names it can suggest (note it includes hidden aliases).
- When are commands suggested vs tags/projects/priorities? What if a command is already present?
- Prefix matching rules (case sensitive? substring or prefix?).
- Which tags/projects are offered: all in the repo, or only those in the current context? Test with
  and without a context, and for different commands (add vs context vs next vs modify vs help).
  Distinguish "+tag" vs "-tag" vs "project:x" vs "-project:x" suggestion sets and their ORDER
  (sorted? insertion order? is it deterministic across runs? run 10x and check).
- What does it suggest after 'context '? after 'help '? after 'git '? after an id? after '--'?
- Does it suggest 'template:<id>' anywhere?
- Does it ever suggest already-used tags? Does it filter out tags already on the line?
- Exit codes, and behaviour with zero args / one arg / trailing empty arg.
Build a fixture with several projects and tags (including tags only on resolved tasks, and on
templates) to see which are included.`,
  },
  {
    file: 'git-integration.md',
    label: 'git-integration',
    task: `AREA: git integration details.
- Exactly which git commands are run and what the user sees. The 'add' output shows git commit
  output coloured with \\x1b[38;5;245m ... \\x1b[0m — determine precisely which parts of the output are
  wrapped in which colour, on tty vs piped.
- Commit author/committer: does dstask set its own, or rely on git config? What if git config
  user.email is unset (exact error)?
- Are commits made for: add, log, start, stop, done, modify, remove, note, edit, template, context,
  undo, sync? Give the exact commit subject/body template for each (test single and multiple IDs).
- Is 'git add' scoped to specific paths or '-A'? What happens to untracked junk files in the repo?
- Is there a commit for context changes? (context is in .git/dstask so probably not — verify)
- undo: does it use 'git revert' or 'git reset --hard'? Check the resulting log and whether ids.bin
  is refreshed. Exact user-visible output, including any confirmation prompt.
- sync: exact sequence, output, behaviour with no upstream, with a bare remote, with conflicting
  changes on both sides (create a real conflict by cloning twice and modifying the same task) —
  report exactly what happens and any merge commit message.
- Does dstask ever fail because the working tree is dirty? Which commands check?
- Does it create a .gitignore or similar?`,
  },
  {
    file: 'errors-edge.md',
    label: 'errors-edge',
    task: `AREA: errors, exit codes, and hostile edge cases. Capture every message VERBATIM with exit code
and whether it goes to stdout or stderr.
- No such ID; ID 0; negative ID; huge ID; non-numeric ID-looking args.
- Commands requiring an ID given none; commands given an ID that don't accept one (e.g. 'dstask 1 add x',
  'dstask 1 context', 'dstask 1 sync', 'dstask 1 version', 'dstask 1 help').
- add with empty summary, add with only tags, add with only a project.
- Two tasks with the same summary — allowed? Any duplicate warning?
- Operating on a resolved task by ID (does the ID still resolve? show-resolved gives ids?).
- Corrupt/invalid yml file in a status dir; a .yml file whose name is not a uuid; a non-.yml file;
  a subdirectory inside a status dir; a task file in the wrong status dir (e.g. resolved timestamp
  set but file in pending); duplicate uuid in two dirs.
- ids.bin corrupted/truncated/empty; state.bin corrupted.
- $DSTASK_GIT_REPO unset (does it default to ~/.dstask, and does it expand ~?), set to a
  nonexistent path, set to a relative path, set to a file, set to a non-git dir.
- Read-only repo directory.
- Unicode and control characters in summaries; extremely long summary (10k chars); newline in summary
  (can you even?); a summary that is exactly '--' or starts with '-' or '+'.
- SIGINT during a confirmation prompt; EOF on stdin at a confirmation prompt.
- Very large number of tasks (create 300 via a loop) — any pagination/limits? Timing?`,
  },
  {
    file: 'timeflow.md',
    label: 'timeflow',
    task: `AREA: time, dates and the 'due'/deferred/recurring machinery.
- 'due:' parsing: enumerate accepted formats and the exact resulting yaml value (see cli-parsing too,
  but go deeper here). Include relative forms, weekday names, times of day, ISO forms, and how the
  timezone is chosen. What is rejected and with what message?
- How is due rendered in the table (relative like "in 3 days"/"3 days ago"? absolute? which format?)
  Test due in the past, today, tomorrow, next week, next year. Give exact strings.
- Is there any highlighting/colour for overdue tasks? Does due affect sort order?
- Are the 'deferred', 'delegated', 'recurring' status dirs ever used by the CLI? Try to reach them.
  Try 'dstask <id> defer', 'delegate', 'recur', 'wait', 'until', 'delegatedto:x' filters etc. and
  report whether such commands/attributes exist at all.
- show-projects 'Created' column format and what date it shows (earliest task's created?); the
  'Progress' column (resolved/total? does it count templates? resolved-only projects?);
  its colouring and sort order; what happens with tasks with no project.
- show-resolved: what date column, format, and ordering.
- Timezone: run with TZ=UTC, TZ=America/New_York, TZ=Asia/Tokyo and report which outputs change
  (yaml 'created' value, table dates, due parsing).`,
  },
]

phase('Recon')
const reports = await pipeline(
  AREAS,
  a => agent(`${HARNESS}\n\nWrite your report to /tmp/spec/${a.file}\n\n${a.task}`, {
    label: a.label, phase: 'Recon',
  }),
)

phase('Critique')
const critics = await parallel([
  () => agent(`Read /tmp/spec/HARNESS.md and every file in /tmp/spec/*.md. You are a completeness
critic for a reverse-engineering spec of /workspace/executable (dstask CLI).
Identify CONCRETE gaps, contradictions between reports, and unverified claims that would block a
byte-exact reimplementation. Then GO RUN the executable yourself (same hard rules: CLI only, no
decompiling, no web) to resolve as many gaps as you can. Append your resolutions to
/tmp/spec/gaps-1.md. Focus on: output formatting exactness, parsing precedence, sort comparators,
and git commit message templates.`, { label: 'critic:formatting', phase: 'Critique' }),
  () => agent(`Read /tmp/spec/HARNESS.md and every file in /tmp/spec/*.md. You are a completeness
critic for a reverse-engineering spec of /workspace/executable (dstask CLI).
Find behaviours NOBODY tested. Brainstorm at least 30 untested interactions (flag combos, state
transitions, malformed input, env var combos, interactions between context/filters/ids/templates),
then RUN them against /workspace/executable (CLI only, no decompiling, no web) and record the
results verbatim in /tmp/spec/gaps-2.md.`, { label: 'critic:untested', phase: 'Critique' }),
  () => agent(`Read /tmp/spec/HARNESS.md and /tmp/spec/yaml-format.md and /tmp/spec/table-render.md.
Your single job: make the YAML emitter/parser spec and the table renderer spec airtight enough to
reimplement byte-exactly in Go without the yaml.v2 library.
Run /workspace/executable (CLI only, no decompiling, no web) with adversarial strings and widths.
For YAML: derive the complete decision procedure for when a scalar is emitted plain / single-quoted /
double-quoted / block, and the exact line-folding rules (width, where breaks happen, indentation of
continuations) — test summaries and notes of many lengths and word patterns, incl. words longer than
the fold width and strings with double spaces.
For the table: derive the exact width algorithm and truncation/wrapping rules.
Write /tmp/spec/gaps-3.md with a precise algorithm statement plus the test vectors that prove it.`,
    { label: 'critic:yaml-table', phase: 'Critique' }),
])

return { reports: reports.map((r, i) => ({ area: AREAS[i].label, ok: !!r })), critics: critics.length }
