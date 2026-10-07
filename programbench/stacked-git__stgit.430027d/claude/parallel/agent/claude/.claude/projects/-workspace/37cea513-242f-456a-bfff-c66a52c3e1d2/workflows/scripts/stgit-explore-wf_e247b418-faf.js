export const meta = {
  name: 'stgit-explore',
  description: 'Exhaustively explore StGit binary behavior and write detailed specs',
  phases: [
    { title: 'Explore', detail: 'one agent per command family' },
    { title: 'Gaps', detail: 'completeness critic' },
  ],
}

const PREAMBLE = `
You are reverse-engineering a compiled binary for a re-implementation benchmark.

BINARY: /workspace/executable  — it is StGit ("stg") version 2.5.5, a Rust CLI that
manages a stack of patches on a git branch. Invoke it as \`/workspace/executable <args>\`.

HARD RULES (violating these fails the whole benchmark):
- You may ONLY learn about it by RUNNING it and reading its stdout/stderr/exit codes,
  and by inspecting the git repositories it modifies (git cat-file, git log, git config...).
- You MUST NOT decompile, disassemble, or dump it (no objdump/nm/strings/gdb/ghidra/readelf),
  and MUST NOT use strace/ltrace on it. The file is execute-only anyway.
- You MUST NOT search the web, fetch any URL, clone any repo, or use any package manager
  to obtain StGit source code or docs. No network is available anyway.
- Do not consult your memory of the upstream source. Observe empirically.

SETUP: work in your own scratch dir, e.g. \`mkdir -p /tmp/x-<area> && cd /tmp/x-<area>\`.
Create throwaway git repos there. Always set:
  git init -q repo && cd repo && git config user.email au@example.com && git config user.name "A U Thor"
  git config commit.gpgsign false
Use \`GIT_AUTHOR_DATE\`/\`GIT_COMMITTER_DATE\` env vars to make commits deterministic when helpful.
Interactive editors: set \`EDITOR=true\` or \`EDITOR="sed -i ..."\` to script editor interactions;
GIT_EDITOR/VISUAL may also matter — probe which is used and in what precedence.

OUTPUT: Write an extremely detailed markdown spec to the file named below. It is the ONLY
thing my implementation will be based on, so it must be precise and complete:
 - Verbatim exact output strings (stdout AND stderr separately), including leading "> ", "+ ",
   "- ", "! " markers, trailing newlines, capitalization, and punctuation.
 - Exit codes for success and every error path you can trigger.
 - Exact error message wording for every failure mode (in the form \`error: ...\` etc).
 - Every flag: its effect, its interactions, and what happens on conflicting flags.
 - Any git refs / config keys / files it reads or writes.
Prefer tables and fenced code blocks showing the literal commands and literal output.
Be exhaustive: this spec is used to produce byte-identical behavior. Aim for 400+ lines.

Also: whenever output is large and mechanical (e.g. generated scripts), save it verbatim to a
file under /workspace/spec/data/ and reference the path in your markdown instead of inlining.

Return (as your final message) a CONCISE summary, under 500 words: the key discoveries and
anything you could not determine.
`

const AREAS = [
  {
    key: 'core-model',
    file: '/workspace/spec/01-core-model.md',
    task: `AREA: the stack metadata data model, and the stack log / undo / redo / reset / repair.

Determine exactly:
- Which git refs StGit creates and maintains: refs/stacks/<branch>, refs/patches/<branch>/<patch>, and any others
  (probe reflogs too: .git/logs/...). What ref updates happen per command and with what reflog messages?
- The exact structure and byte-for-byte formatting of the stack metadata blob (stack.json): field order,
  indentation, trailing newline?, how it changes with applied/unapplied/hidden patches. Use
  \`git cat-file -p refs/stacks/master:stack.json | xxd | tail\` to check trailing bytes.
- The stack log commit graph: for each state there appear to be two commits (a "simplified" one and the
  ref one). Determine exactly the parents, order of parents, tree, message, author/committer of each,
  across: init, new, refresh, pop, push, delete, commit, uncommit, rename, squash, undo, redo, reset.
  Figure out precisely which commits become extra parents (e.g. patch oids of applied/unapplied/hidden).
- The exact log message strings written for every command (e.g. "initialize", "new: <name>", "refresh",
  "pop", ...). Enumerate as many as you can, one per command, including with multiple patches.
- \`stg log\` output format exactly: default, -n, -f/--full, -d/--diff, --clear, with patch name filters,
  -b branch. Column widths/separators. Date format. What does it show when there is no stack?
- \`stg undo\` / \`stg redo\`: flags (-n, --hard), output, error messages when nothing to undo, and how the
  "prev" pointer walks. Does undo push a new log entry? Show the resulting graph.
- \`stg reset\`: syntax, --hard, committish forms, output, errors.
- \`stg repair\`: what it detects and fixes; run it after \`git commit\` on top of the stack, after
  \`git reset --hard\`, after amending; show exact output.
- git config keys read/written: search with \`git config -l\` before/after each command and probe
  \`stgit.*\` keys (e.g. stgit.autosign, stgit.keepoptimized, stgit.editor, branch.<n>.stgit.*, etc).
  Also probe whether \`stg init\` is implicit for some commands.
- Where is the "patch description" (message) stored - in the patch commit message directly?
  Show a patch commit with \`git cat-file -p\`.`,
  },
  {
    key: 'init-branch',
    file: '/workspace/spec/02-init-branch.md',
    task: `AREA: \`stg init\` and \`stg branch\` (all modes).

Cover: init (repeat init, init on unborn branch, in bare repo, in subdir, detached HEAD, -b?),
and every branch mode: no args, single arg (switch), --merge, --list/-l, --create/-c (with and without
committish, from remote branch, from a tag), --clone/-C (with/without name), --rename/-r (1 and 2 args),
--protect/-p, --unprotect/-u, --delete/-D (with/without --force, on current branch, on branch with patches),
--cleanup (with/without --force, on branch with applied patches), --describe/-d.
Also \`stg branch -\` and \`@{-1}\` syntax.
Record the EXACT \`--list\` output format (markers like ">", "s", "p", padding/alignment, description column,
sorting, what marks a stgit branch vs plain branch vs protected vs current). Try many combinations:
plain git branches, stgit branches, protected, described, current.
Record what config keys branch protection and description use.
Record every error message: switching with dirty worktree, unknown branch, deleting current branch,
renaming to existing name, creating existing branch, protected branch modification attempts
(try \`stg new\` on protected branch), operating in a repo with no commits, etc.
Also test what happens when running stack commands on a branch with no stgit stack ("stg series" etc):
exact error text.`,
  },
  {
    key: 'new-edit',
    file: '/workspace/spec/03-new-edit-rename-delete.md',
    task: `AREA: \`stg new\`, \`stg edit\`, \`stg rename\`, \`stg delete\`, \`stg clean\`, \`stg spill\`.

For \`stg new\`: all flags from --help. Focus on:
- patch NAME AUTO-GENERATION from the message: exact slug algorithm. Test messages with punctuation,
  unicode, uppercase, leading/trailing spaces, multiple spaces, very long messages (what length limit?),
  messages starting with digits or dashes, empty subject, subject with '/', '..', '.lock', '@{', etc.
  Test collisions (same message twice, three times) -> what suffix?
- name validation rules: which characters are rejected in an explicit name; exact error text.
- -m/--message (multiple?), -F/--file (and '-' for stdin), --edit/-e, --diff/-d? , --no-verify,
  --sign/--ack/--review/--sign-by etc trailers (exact trailer text and blank-line handling),
  --author/--authname/--authemail/--authdate (accepted date formats!), -t/--template?, --annotate.
- Where the patch ends up (top of applied), output line format, exit codes.
- What happens with uncommitted changes present? empty patch allowed?
For \`stg edit\`: -d/--diff, --edit, -m, -F, --sign etc, --set-tree, -O, patch arg, editing a
non-top/unapplied patch, the exact template shown to the editor (capture it by using
EDITOR='cp $1 /tmp/captured' style trick — note how the editor is invoked), and how the
edited file is parsed back (headers From:, Date:, blank line, message, then "---" and diff).
Error messages for bad edits (e.g. invalid diff -> what happens, does it save a file?).
For \`stg rename\`: 1 and 2 args, errors. For \`stg delete\`: --top, --spill, -b, multiple patches,
ranges like p1..p3, deleting unapplied/hidden, output text. For \`stg clean\`: -a/-u flags.
For \`stg spill\`: --annotate? --reset, path args, output.`,
  },
  {
    key: 'refresh',
    file: '/workspace/spec/04-refresh.md',
    task: `AREA: \`stg refresh\` in depth, plus how the index/worktree are handled generally.

Test every flag: -u/--update, -i/--index, -F/--force, -p/--patch <patch>, --no-verify, --submodules /
--no-submodules, --spill?, -e/--edit, -m/--message, -F/--file, --sign/--ack/..., --author/--authdate,
--annotate, and path limiting arguments (including pathspecs, deleted files, new untracked files).
Determine:
- Exact output lines for each case (e.g. "Now at patch ...", "Refresh of ... done", warnings).
- Behaviour when there is nothing to refresh (exact message + exit code).
- Behaviour when patch is not the top patch (does it pop/push? what output?).
- Behaviour with --index when index has staged changes and worktree has more.
- Whether untracked files are included (they should not be), and what \`-u\` does exactly.
- What happens with merge conflicts present (exact error).
- Whether the patch commit's author/committer/date change, and whether the message is preserved.
- Interaction with git hooks (pre-commit / commit-msg): does refresh run them? test with a hook that
  echoes and one that fails; check --no-verify.
Also document the general index/worktree preconditions of stack-modifying commands: what exact error
appears when the index is dirty or the worktree is dirty for push/pop/goto/commit/etc.`,
  },
  {
    key: 'push-pop',
    file: '/workspace/spec/05-push-pop-order.md',
    task: `AREA: \`stg push\`, \`stg pop\`, \`stg goto\`, \`stg float\`, \`stg sink\`, \`stg hide\`, \`stg unhide\`.

Build a stack of ~6 patches and exercise every flag of each command:
push: -a/--all, -n/--number <n>, --reverse, --noapply, --set-tree, --merged, --keep, --conflicts?, patch args, ranges.
pop: -a/--all, -n/--number <n>, --spill, --keep, patch args, ranges.
goto: --keep, --merged, patch arg (applied, unapplied, hidden, invalid).
float: --noapply, -s/--series <file>, patch args, ranges, already-applied patches.
sink: -n/--nkeep?, -t/--to <patch>, patch args.
hide/unhide: -b, patch args, ranges, hiding applied patches.
Record EXACT stdout/stderr for each, including the "+ name" / "> name" / "- name" / "# name" markers
and any "Now at patch \\"x\\"" lines, warnings, and the ordering of lines.
CONFLICTS: engineer a genuine conflict (two patches touching the same line) and record:
 - exact error output and exit code of push
 - resulting stack state (stack.json, refs, index conflict state, .git/ files created e.g. anything
   stgit-specific), what \`stg status\`/\`git status\` show
 - what conflict markers look like, and whether patch stays applied
 - how to resolve: \`stg refresh\` after \`git add\`, and what \`stg push\` says if run while conflicts exist
 - \`stg undo --hard\`, \`stg push --keep\` behaviour
Also: range syntax parsing (p1..p3, ..p3, p1.., '@' meaning?), and what error appears for unknown patch names.`,
  },
  {
    key: 'series-info',
    file: '/workspace/spec/06-series-and-info.md',
    task: `AREA: \`stg series\`, \`stg top\`, \`stg next\`, \`stg prev\`, \`stg patches\`, \`stg name\`, \`stg id\`
and the StGit revision-spec grammar.

\`stg series\` is the most format-sensitive command. Enumerate EVERY flag from its --help and show the
exact output for a stack with applied+unapplied+hidden patches, empty patches, and long/short names:
-a/--all, -A/--applied, -U/--unapplied, -H/--hidden, -m/--missing <branch>, -c/--count, -d/--description,
--no-description, -e/--empty, --no-empty, -s/--short, -P/--no-prefix, -i/--indices, -O/--offsets,
--author, --commit-id[=length], --reverse, -b/--branch, --color always (WHAT ANSI CODES for each part?),
patch args/ranges, and combinations. Note the exact prefix characters and padding/alignment rules,
and how empty patches are marked (the "0" marker?). Capture \`--color=always\` output through
\`| cat -v\` so escape codes are visible.
\`stg id\`: every revspec form: patch name, {base}, branch:patch, patch^, patch~2, @, HEAD, sha,
tags, invalid names -> exact errors. Also '/top', '/bottom' style suffixes if any, and \`stg id\` with
no args. Test \`stg name\` similarly incl. --showbranch.
\`stg patches\`: file args, -b, -d/--diff, -O, --short? exact output.
\`stg top\`/\`next\`/\`prev\`: output and errors when stack empty / no unapplied / no previous.`,
  },
  {
    key: 'show-diff-files',
    file: '/workspace/spec/07-show-diff-files.md',
    task: `AREA: \`stg show\`, \`stg diff\`, \`stg files\`.

Determine exact output. In particular figure out whether these shell out to \`git\` (compare
\`stg diff\` output to \`git diff\` output byte-for-byte; try -O options like -O--stat -O-w
-O--find-renames; try \`stg diff -O--bogus\` and see whether git's error surfaces).
\`stg show\`: patch args/ranges, -b, -a/--applied, -U/--unapplied, -s/--stat, -O, --color always;
what it shows with no args and no applied patches; the commit header format (does it match
\`git show\`?); multiple patches; hidden patches; \`stg show {base}\`.
\`stg diff\`: -r/--range with rev1..rev2, rev1.., ..rev2, single rev; -s/--stat; path args; -O;
diff of an unapplied patch; errors on bad revs.
\`stg files\`: default (top patch), revision arg, -s/--stat, --bare, --color always; a patch that adds,
deletes, renames, changes mode, and a binary file; empty patch; what the status letters are and the
exact column formatting.
Report precisely the diff/diffstat text so I can decide whether to shell out to git.`,
  },
  {
    key: 'commit-uncommit-squash',
    file: '/workspace/spec/08-commit-uncommit-squash-pick-fold-sync.md',
    task: `AREA: \`stg commit\`, \`stg uncommit\`, \`stg squash\`, \`stg pick\`, \`stg fold\`, \`stg sync\`.

For each: every flag, exact output lines, exact error messages, resulting stack/ref state.
commit: no args, -n/--number, -a/--all, patch args, --allow-empty?, committing unapplied patches, errors.
uncommit: no args (one), -n/--number <n>, -t/--to <committish> (+ --exclusive), explicit patch names,
  name generation for uncommitted patches (from commit subject?), errors (nothing to uncommit, merge commit).
squash: -n/--name, -m/--message, -F/--file, -e/--edit, --no-verify, -d?, patch args and ranges,
  squashing non-contiguous patches, unapplied patches, only one patch, the default combined message
  format written to the editor (capture it), where the squashed patch lands, exact output.
pick: --name, -B/--ref-branch, --expose, --noapply, --fold, --update, --file, --revert?, -p/--parent,
  picking a plain git commit, a patch from another branch, a merge commit, exact output and the
  resulting patch name and message (does --expose add "(imported from ...)" trailer? exact text).
fold: -t/--threeway, -b/--base, -p/--strip, -C, --reject, reading from stdin vs file, exact output/errors.
sync: -a/--all, -B/--ref-branch, -s/--series, patch args; describe what it does and its output.`,
  },
  {
    key: 'export-import',
    file: '/workspace/spec/09-export-import-email.md',
    task: `AREA: \`stg export\`, \`stg import\`, \`stg email\`.

export: -d/--dir, -b/--branch, -p/--patch, -n/--numbered, -t/--template <file>, -e/--extension,
  -s/--stdout, -O/--diff-opts, --version?, patch args/ranges. Capture the EXACT default output file
  content (headers, message, "---", diffstat, diff, trailing "-- \\n<version>" signature?) and the
  default 'series' and 'patches' files written into the dir, and the default filename scheme.
  Document the template placeholder syntax (%(shortdescr)s etc) by trying a custom template with
  many placeholders; list every placeholder that works and what it expands to. Error text for
  unknown placeholders.
import: from a file created by export, from \`git format-patch\` output, from an mbox (-m/--mbox),
  from a series file (-s/--series), from stdin, from a URL (-u, probably fails offline: capture error),
  flags: -n/--name, -p/--strip, -t/--stripname?, -i/--ignore, --replace, --base, -e/--edit,
  --reject, -3/--3way, -C<n>, --sign etc, --keep-cr, --message-id.
  Determine the exact patch naming rules on import, how the commit message/author/date are taken from
  the patch headers, and the exact output lines ("Importing patch ..." etc) and error messages.
email: subcommands (format/send?), --help of each, and enough behavior to know the surface; test
  \`stg email format\` output files if it works offline. Do not attempt to actually send email.`,
  },
  {
    key: 'rebase-pull',
    file: '/workspace/spec/10-rebase-pull.md',
    task: `AREA: \`stg rebase\` and \`stg pull\`, plus remote-related config.

rebase: <new-base> forms, -n/--nopush, -m/--merged, -i/--interactive, --autostash, --keep?, and what
  happens with conflicts. Set up a repo where the branch base moves (e.g. commit on master while
  patches are popped, or a second branch) and show exact output, the resulting stack log message,
  and stack.json changes. Also test \`stg rebase\` with no args (error?), and with an invalid ref.
  Test the interactive mode's instruction sheet by capturing what is written to the editor.
pull: set up a local "remote" with \`git clone\`/\`git remote add\` + fetch so pull works offline
  (use file:// paths). Test -n/--nopush, -m/--merged, --policy?, and the exact output. Document which
  config keys are consulted (branch.<name>.remote, branch.<name>.merge, stgit.pull-policy,
  branch.<name>.stgit.pull-policy) and the behavior of each policy value (pull/fetch-rebase/rebase).
  Capture exact errors when there is no remote.`,
  },
  {
    key: 'cli-surface',
    file: '/workspace/spec/11-cli-surface.md',
    task: `AREA: the argument-parsing layer (this binary uses Rust's clap v4). I need to reproduce it exactly.

Determine and document:
- Exact error output + exit code for: unknown subcommand (\`stg bogus\`), unknown flag
  (\`stg series --bogus\`), missing required value (\`stg id -b\`), too many positionals,
  invalid enum value (\`stg --color bogus\`), conflicting args (find real conflicts, e.g.
  \`stg series -A -U\`, \`stg new -m x -F y\`), \`stg\` with no args at all, \`stg --bogus\`.
  Show the literal text including the "error: ..." line, the "Usage:" line, and the
  "For more information, try '--help'." line, and whether it goes to stderr.
- Does it suggest similar subcommands/flags? (\`stg serise\`, \`stg series --allx\`) exact "tip:" text.
- Abbreviated/prefix matching of subcommands or long flags? (\`stg ser\`, \`stg series --appl\`)
- \`stg help\`, \`stg help series\`, \`stg help bogus\`, \`stg series help\`.
- Exact help WRAPPING behavior: run \`stg <cmd> --help\` and \`-h\` under COLUMNS=40,60,80,88,90,100,120,200
  and unset, both to a pipe. Determine the effective max width and the wrapping algorithm
  (indent widths, when the two-column layout collapses to the indented layout, hanging indents,
  blank lines between options). Save the raw captures under /workspace/spec/data/wrap/.
- The aliases (add, mv, resolved, rm, status): how they are dispatched, what GIT_PREFIX is, behavior in
  a subdirectory, exit code propagation, and \`stg status --help\`/\`stg add --help\` behavior. Also test
  defining custom aliases in git config: \`stgit.alias.foo\` = "series -a" and shell aliases "!cmd";
  document precedence and \`stg completion list aliases\`.
- Global \`-C <path>\` semantics (multiple, relative, absolute), and \`--color\` values incl. NO_COLOR env.
- Does \`stg\` respect \`GIT_DIR\`, \`GIT_WORK_TREE\`, running from a subdirectory, worktrees
  (\`git worktree add\`)? Test \`stg series\` inside a subdir and inside a linked worktree.`,
  },
  {
    key: 'completion',
    file: '/workspace/spec/12-completion.md',
    task: `AREA: \`stg completion\` and \`stg version\` and \`stg help\` output.

Capture the FULL VERBATIM output of:
  stg completion bash, stg completion fish, stg completion zsh, stg completion list,
  stg completion list commands, stg completion list aliases (probe the exact subcommands from --help),
  stg completion man
Save each to /workspace/spec/data/completion-<name>.txt (exact bytes). Then in your markdown,
describe the structure of each and note any dynamic parts (e.g. does the generated script embed the
list of commands/flags? is it derived from the clap definitions?). Note the -o/--output flag behavior.
Report file sizes and first/last 40 lines of each in the markdown.
Also document \`stg version\` (all flags, exact output, and does it include git version / how is it
obtained) and \`stg --version\`, and \`stg completion man\` output format.
IMPORTANT: since these outputs are large, the markdown should focus on structure + how to regenerate,
and the exact bytes belong in the data files.`,
  },
  {
    key: 'colors-config',
    file: '/workspace/spec/13-colors-and-config.md',
    task: `AREA: color output and all configuration knobs.

- For every command that colorizes (series, show, diff, files, log, branch --list, patches, email?),
  capture \`--color=always\` output piped through \`cat -v\` and record the EXACT escape sequences and
  which text they wrap. Also test NO_COLOR=1, \`--color never\`, \`--color ansi\`, and git config
  \`color.ui\`, \`color.diff\`, \`color.stgit.*\`? (probe for stgit-specific color config keys).
- Enumerate every \`stgit.*\` git config key the binary honors. Probe by setting plausible keys and
  observing behavior changes. Definitely test: stgit.autosign, stgit.editor, stgit.pager,
  stgit.diff-opts, stgit.keepoptimized, stgit.namelength, stgit.pull-policy, stgit.push-policy?,
  stgit.autostash?, stgit.template, stgit.message.template?, stgit.refresh.submodules?,
  branch.<name>.stgit.*, and any \`stgit.<cmd>.*\`. For each that works, document exact effect.
  Also test core.editor / GIT_EDITOR / EDITOR / VISUAL precedence, core.pager / PAGER / GIT_PAGER,
  core.abbrev, core.autocrlf, diff.* keys, user.name/email absence (error text!),
  commit.gpgsign, core.hooksPath, and \`--no-verify\`.
- Does it page output? (test with PAGER=cat, PAGER='sed s/^/P:/' and a tty-less pipe). Which commands page?
- What happens with a missing user.name/user.email when creating a patch: exact error.
- Test \`stgit.template\` / a \`.git/patchdescr.tmpl\` style template file for \`stg new\` (probe for
  template file locations under .git/ and ~/.stgit/ that affect new/export).`,
  },
]

phase('Explore')
const results = await pipeline(
  AREAS,
  a => agent(`${PREAMBLE}

SPEC FILE TO WRITE: ${a.file}
SCRATCH DIR: /tmp/x-${a.key}

${a.task}`, { label: `explore:${a.key}`, phase: 'Explore' })
)

phase('Gaps')
const critic = await agent(`${PREAMBLE}

SPEC FILE TO WRITE: /workspace/spec/99-gaps.md

Several exploration agents have written specs into /workspace/spec/*.md. Read them all (and
ls /workspace/spec/data/). Your job is the COMPLETENESS CRITIC pass:
1. List concrete behaviors of /workspace/executable that are NOT yet covered or are ambiguous
   in the specs. Then actually RUN the binary to resolve as many of those gaps as you can, and
   record the answers in your spec file.
2. Focus especially on: exact stdout vs stderr split, exit codes, trailing whitespace/newlines,
   sorting/ordering rules, and anything where two specs disagree (verify by running the binary
   and state the truth).
3. Produce a prioritized "highest-risk unknowns" list at the end.
Return a concise summary under 500 words.`, { label: 'gaps-critic', phase: 'Gaps' })

return { explored: results.filter(Boolean).length, critic }
