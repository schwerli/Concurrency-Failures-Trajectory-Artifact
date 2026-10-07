export const meta = {
  name: 'clog-probe',
  description: 'Black-box probe of clog 0.10.0 binary to find why no commits are emitted, and map all behavior',
  phases: [
    { title: 'Probe', detail: 'parallel hypothesis probes against ./executable' },
    { title: 'Synthesize', detail: 'merge findings' },
  ],
}

const RULES = `
STRICT RULES (violating these fails the whole task):
- The binary under study is /workspace/executable (clog 0.10.0, a conventional-changelog generator).
- You may ONLY run it with CLI args / stdin and observe stdout/stderr/exit-code/files it writes.
- ABSOLUTELY FORBIDDEN: objdump, readelf, nm, strings, gdb, ltrace, strace, ldd, file, hexdump/xxd ON /workspace/executable;
  no decompilers; no PATH shims that intercept 'git' to log its argv; no GIT_TRACE tracing of clog's git child;
  no /proc inspection or 'ps' spying on clog's children; no network access; no searching for clog source code.
- You MAY freely create your own git repos, run git yourself, write files, and use any tool on files YOU create.
- Work ONLY inside your own scratch directory to avoid clobbering other agents.

CONTEXT ALREADY ESTABLISHED (do not re-derive):
- '/workspace/executable --help' and '--version' work. Version string is "clog 0.10.0".
- A TOML config file is REQUIRED to exist (default path '.clog.toml' relative to cwd). If missing, or if the
  file has no [clog] table, or is malformed, it errors. Errors seen so far (stderr, exit 1, ANSI-colored "error:" prefix):
    "error: fatal I/O error with output file"                (missing config file, and also when 'git' is absent from PATH)
    "error: Failed to parse TOML configuration file"         (bad/empty config, unknown value types, bad link-style)
    "error: Failed to parse version into valid SemVer. Ensure the version is in the X.Y.Z format."  (-M/-m/-p)
- With a minimal valid config ('[clog]\\nrepository = "https://github.com/foo/bar"'), running in a git repo prints to stdout:
      <a name=""></a>
      ##   (2026-08-07)
      (blank)
    then "changelog written. (took N ms)".
  i.e. header only, NEVER any "#### Section" or "* entry" lines, no matter what commits exist.
- '-T json' prints: {"header":{"version":None,"patch_version":false,"subtitle":null,"date":"2026-08-07"},"sections":null}
- '--setversion 2.0.0' -> '<a name="2.0.0"></a>' + '## 2.0.0  (2026-08-07)'. '-s Sub' fills the subtitle slot.
- git IS invoked as a subprocess (removing git from PATH causes the I/O error). Timing proves 'git log' really runs
  over the repo: on a 5000-commit repo clog takes ~40ms, and with '-f HEAD~10' it drops to ~4ms. So --from IS honored
  and the log range shrinks. Yet output still has zero commit entries.
- '[sections]' in the config is parsed as table of section-name -> array-of-alias-strings (wrong value types error out).
- Config keys confirmed parsed: repository (string), link-style (enum github/gitlab/stash/cgit), from-latest-tag (bool),
  outfile (string), changelog (string). 'subtitle' in config had NO effect.

THE CENTRAL MYSTERY YOU MAY BE ASKED TO ATTACK: no commit ever appears in the output. Find ANY invocation
(any repo shape, commit message shape, config, env var, git config, CLI flags) that makes the output contain a
'####' section heading or a '* ' bullet entry. That is the jackpot. Report exact reproduction steps.

REPORTING: be precise and terse. Give exact commands and exact byte-level outputs (use 'cat -A' or 'od -c' on
files/outputs you captured, never on the binary). Distinguish "confirmed by experiment" from "guess".
`

const SCHEMA = {
  type: 'object',
  properties: {
    jackpot: { type: 'boolean', description: 'true only if you found an invocation that emits a #### section or * bullet entry' },
    jackpot_repro: { type: 'string', description: 'exact shell commands + exact output, or empty' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'exact commands and exact output proving it' },
          confidence: { type: 'string', enum: ['confirmed', 'likely', 'guess'] },
        },
        required: ['claim', 'evidence', 'confidence'],
      },
    },
    dead_ends: { type: 'array', items: { type: 'string' } },
  },
  required: ['jackpot', 'findings'],
}

const PROBES = [
  {
    key: 'msgshape',
    prompt: `Scratch dir: /tmp/p_msgshape.
GOAL: exhaustively hunt for a commit-message shape that clog will actually put in the changelog.
Build small git repos (use '-f <first-commit-sha>' or '-f HEAD~N' so the log range is non-empty and runs fast).
Grid to cover (at least 80 distinct shapes, one commit each, and check output after EACH so you can attribute a hit):
- types: feat, feature, feats, fix, fixes, fixed, bugfix, bug, perf, performance, docs, doc, style, styles,
  refactor, test, tests, chore, chores, improvement, improvements, imp, break, breaks, breaking, revert, ci, build,
  wip, Feat, FEAT, FIX
- separators: 'type: subj', 'type:subj', 'type : subj', 'type:  subj', 'type - subj', 'type subj', 'type(c): subj',
  'type(c):subj', 'type(c) subj', 'type(): subj', 'type(c,d): subj', 'type[c]: subj', 'type/c: subj'
- whitespace/edge: leading space, trailing space, tab after colon, empty subject, subject with ':' inside,
  very long subject, subject with markdown/backticks, unicode subject, CRLF in message
- multi-line: subject + blank + body; subject + body with no blank line; body containing 'BREAKING CHANGE: x',
  'BREAKING CHANGE:x', 'BREAKING-CHANGE: x', 'Closes #1', 'closes #1, #2', 'Fixes #3', 'Resolves #4',
  a body containing lines like '==END==', 'END', '\\x1e', '~~~~', '----'
Also try: merge commits, an empty-tree root commit, a commit with a 40-char-hex-only message.
Report which (if any) produced ANY '####' or '* ' line. If none, say so explicitly and list what you covered.`,
  },
  {
    key: 'range',
    prompt: `Scratch dir: /tmp/p_range.
GOAL: fully characterize how --from/--to/-F/--from-latest-tag and the config equivalents shape the git log range,
using TIMING as the instrument (build a repo with ~4000 commits via 'git fast-import' so a full walk costs ~25ms
and a 10-commit walk costs ~2ms; run each case 5-10x in a bash 'time (for ...)' loop).
Determine, for each combination, whether the walk is FULL-history or SHORT:
  no args; -f X; -t Y; -f X -t Y; -F (with and without tags present); -F -f X; config from=..., to=..., from-latest-tag=true;
  bogus -f; bogus -t; -f "" (empty string); -f HEAD; -t HEAD.
From that, infer the exact range string clog passes to git (e.g. 'HEAD' vs 'from..to' vs '..to') for each case.
ALSO: determine whether -F actually resolves the latest tag: create tags (lightweight and annotated, v-prefixed and not,
multiple tags, tag on HEAD vs older commit) and use timing to see if the range shrinks. Report a decision table.
ALSO: does the config 'from'/'to' get overridden by CLI or vice versa? Use timing to tell.`,
  },
  {
    key: 'repoenv',
    prompt: `Scratch dir: /tmp/p_repoenv.
GOAL: find a REPO SHAPE or ENVIRONMENT that unblocks commit output.
Try, each time checking whether output gains a '####'/'* ' line:
- bare repo (--bare) pointed at via -g; repo where .git is a FILE (git worktree add); submodule; shallow clone
  (git clone --depth 1 file://...); clone with an 'origin' remote configured; repo with packed-refs only;
  branch named main vs master vs weird; detached HEAD; repo with a single root commit; repo with grafts/replace refs.
- env vars: GIT_DIR, GIT_WORK_TREE, GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY, TZ (UTC/America/New_York), LANG/LC_ALL
  (C, C.UTF-8, en_US.UTF-8, POSIX), TERM (dumb/xterm), CLICOLOR/NO_COLOR, HOME unset, PWD lying, cwd = subdir of repo,
  cwd = repo root, cwd outside repo with -g/-w.
- git config knobs inside the repo: log.date=*, log.showSignature, log.decorate, format.pretty (!!! try setting
  format.pretty to a custom format - it may hijack clog's git log output), i18n.logOutputEncoding=UTF-16/latin1,
  i18n.commitEncoding, core.abbrev=4/40, core.commentChar, diff.*, log.follow, notes.displayRef, core.logAllRefUpdates,
  color.ui=always (forces color into git output?), pager.log, alias.log (try to shadow), sequence.*.
  'format.pretty' and 'color.ui=always' and 'i18n.logOutputEncoding' are the most promising: they can change what
  git log emits, which may reveal HOW clog parses (e.g. if setting format.pretty to something odd changes clog's output).
- Also try running clog when the repo is owned by another uid / when safe.directory is NOT configured (use 'chown -R nobody'
  on a throwaway repo) to see if a 'dubious ownership' failure changes the error message.
Report anything that changes clog's stdout at all.`,
  },
  {
    key: 'cfgkeys',
    prompt: `Scratch dir: /tmp/p_cfgkeys.
GOAL: exhaustively map the .clog.toml schema by probing type errors. A key that is READ will reject a wrong-typed value
with "error: Failed to parse TOML configuration file"; a key that is IGNORED will be silently accepted.
For each candidate key, write a config with an intentionally wrong type (e.g. key = 12345 if you expect string,
key = "str" if you expect bool/array) and record whether it errors.
Candidates (test all, plus any variants with '-' vs '_' spelling): repository, repo, link-style, link_style, linkstyle,
from, to, from-latest-tag, from_latest_tag, subtitle, changelog, infile, outfile, git-dir, git_dir, work-tree, work_tree,
setversion, version, major, minor, patch, format, output-format, date, sections, components, aliases, types, ignore,
issues, commit-link, issue-link, name, project, url.
Then determine SEMANTICS of every key that IS read, by observing effects on stdout/files:
  - repository + link-style: with no commits we cannot see links, so instead check which VALUES are accepted/rejected
    for link-style (try github, gitlab, stash, cgit, GitHub, GITHUB, bitbucket, gogs, empty string).
  - outfile / changelog / infile: which file gets written, is it created if missing, is a missing parent dir an error,
    what are the EXACT bytes written (use 'cat -A'), does existing content get prepended/appended/truncated?
    Test all pairwise combos of CLI -o/-i/-C and config outfile/changelog/infile, including CLI-vs-config precedence.
  - Does '[clog]' have to be the FIRST table? Is an empty '[clog]' table alone valid? Are unknown keys ignored?
    Is a top-level (no-table) config valid? Comments? Nested tables? Duplicate keys? Is TOML v0.5 datetime accepted?
Report a complete key -> {type, read?, effect} table.`,
  },
  {
    key: 'cliargs',
    prompt: `Scratch dir: /tmp/p_cliargs.
GOAL: byte-exact map of the command-line interface (this is a clap v4 based Rust CLI; I must reproduce its messages exactly).
Capture EXACT stdout/stderr bytes (pipe through 'cat -A' to reveal ANSI escapes and trailing spaces) and exit codes for:
- '--help', '-h', 'help' (as a subcommand/positional), '--version', '-V', '-v', no args at all.
- unknown flag '--bogus', unknown short '-Z', a bare positional 'foo', two positionals.
- missing values: '-r', '--from', '-o' with nothing after; '--from=' (empty value); '-f=x'.
- invalid enum values: '-T xml', '-l bogus', '--format=JSON', '-T markdown', '-T json', '-T Json'.
- abbreviations/prefix matching: '--rep', '--from-l', '--set', '--for'.
- combined shorts: '-Mm', '-mp', '-Mmp', '-pMm'; repeated flags '-p -p'; '-M -m -p' together (conflict?).
- '--' terminator; args after '--'; arg with leading '-' as a value ('-s -weird'); empty string values ('-s ""').
- very long values; values with spaces/newlines/UTF-8.
- Does the help output differ when stdout is a TTY vs a pipe? (use 'script -qc' to fake a TTY if available).
  Are the error messages colored when stderr is a pipe? (we saw ANSI codes even when piped - verify exactly which codes).
- What is the exact ordering/wrapping of the '--help' text? Reproduce it byte-for-byte, including the trailing
  paragraphs, indentation, and where line wraps fall. Check whether wrapping depends on COLUMNS/terminal width
  (try COLUMNS=40,80,100,200 and a real TTY of various widths).
Report the full byte-exact help text and every error message with its exit code.`,
  },
  {
    key: 'output',
    prompt: `Scratch dir: /tmp/p_output.
GOAL: byte-exact map of the OUTPUT the tool produces (header line, blank lines, trailing newlines, the
"changelog written. (took N ms)" notice) and of file-writing semantics.
- Determine exactly which stream each part goes to: is "changelog written. (took N ms)" on stdout or stderr?
  Is the changelog body on stdout when -o is omitted? Capture with separate redirections and 'cat -A'.
- Determine the EXACT header bytes for: no version, --setversion 1.2.3, --setversion 1.2.0, --setversion 1.0.0,
  --setversion 0.0.1, --setversion v1.2.3, --setversion "1.2.3-alpha.1", --setversion "1.2.3+build", --setversion abc,
  --setversion "" , and with/without -s subtitle, and subtitle containing spaces/UTF-8.
  Pay attention to '##' vs '###' (patch-level) heading depth and to the '<a name="...">' anchor, and to double spaces.
- What date does the header use? (system date; check TZ sensitivity, and whether it is YYYY-MM-DD).
- -T json: exact bytes for all the same cases (note the invalid-JSON 'None' literal for a missing version - pin down
  exactly when 'None' vs 'null' vs a quoted string appears, and the exact key order).
- File semantics: -o to a new file, existing file (truncate? prepend?), a path in a missing dir, a directory path,
  /dev/full, a read-only file, a symlink. -i (infile) with content: where does old content go relative to new?
  -C (changelog) with content: is it prepended? Does it de-duplicate? Combining -C with -i or -o.
  Exact trailing-newline behavior in every case. Use 'od -c' on the resulting files.
- Exit codes for every failure mode, and the exact error text.
Report byte-exact templates I can implement from.`,
  },
  {
    key: 'version',
    prompt: `Scratch dir: /tmp/p_version.
GOAL: fully characterize version handling: --major/-M, --minor/-m, --patch/-p, --setversion, and the tag-derived
"current version", plus the '##' vs '###' heading depth rule.
- Confirm where the current version comes from. We believe it is the latest git tag but every attempt so far failed with
  "error: Failed to parse version into valid SemVer. Ensure the version is in the X.Y.Z format." Try HARD to make -p/-m/-M
  succeed: tags named 1.2.3, v1.2.3, release-1.2.3, 1.2, 1.2.3-rc1; annotated vs lightweight; tag on HEAD vs ancestor;
  multiple tags; tags on other branches; a repo with a changelog.md containing '## 1.2.3 (2020-01-01)' or
  '<a name="1.2.3"></a>'; config from-latest-tag=true; --from-latest-tag; -C changelog.md. Also try combining with -f.
  Report whether ANY combination makes -p produce a version, with exact repro.
- Determine the exact SemVer parsing rules for --setversion: which strings are accepted (does '1.2' error? '1.2.3.4'?
  'v1.2.3'? '1.2.3-alpha+b'? 'abc'? ''? '01.2.3'? ' 1.2.3 '?) and what the resulting header/anchor look like.
  Note: --setversion seems to bypass SemVer validation (it accepted 'v3.1.4'); verify precisely.
- Determine the '###' (patch) vs '##' (minor/major) heading rule empirically from --setversion values:
  1.2.3 vs 1.2.0 vs 1.0.0 vs 0.0.1 vs 0.1.0 vs 2.0.0 vs 1.2.3-rc.1 vs v1.2.3 vs 'notasemver'.
  Also check the json field 'patch_version' for each.
- Conflicts: -M with -m, -p with --setversion, --setversion with -M. Which wins? Any error?
Report a decision table.`,
  },
  {
    key: 'wild',
    prompt: `Scratch dir: /tmp/p_wild.
GOAL: creative, adversarial hunt for ANY way to get commit entries into the output. Think about what a Rust program
parsing 'git log' output would need, and try to satisfy it from the outside. Ideas to try (and invent more):
- Make git emit output in unusual shapes via git config: 'format.pretty' set to a custom format (this could HIJACK
  clog's own --format if clog does not pass one explicitly!), 'log.showSignature=true', 'notes.displayRef',
  'i18n.logOutputEncoding', 'color.ui=always' + 'color.diff=always', 'log.abbrevCommit=true', 'core.abbrev'.
  If clog relies on git's DEFAULT pretty format, then setting format.pretty could make it work or change behavior.
  Systematically try format.pretty values: 'oneline', 'short', 'medium', 'full', 'raw',
  'format:%H%n%s%n%b', 'format:%H%n%ct%n%s%n%b', and formats ending with sentinels like '==END==' or '%x1e'.
- Try 'log.date' + 'log.follow' etc. Try a commit whose message alone looks like a full git-log record, e.g. a message
  that itself contains 'commit <40hex>' / 'Author: x' / 'Date: ...' lines, or contains '==END==' sentinels.
- Try feeding stdin (does clog read stdin at all? 'echo ... | clog').
- Try a repo where HEAD points at a tag object, a repo with only a merge commit, a repo with 2 roots.
- Try clog on the /workspace repo itself (it has .clog.toml with from-latest-tag=true and one commit 'Initial commit').
  Then add conventional commits to a COPY of /workspace and try again (copy to your scratch dir, do not modify /workspace).
- Try every CLI flag combination systematically with a repo of 6 conventional commits and '-f <root>' - about 100 combos -
  grepping for '####' or '^\\* '.
Report the jackpot if found; otherwise report the full list of things ruled out.`,
  },
]

phase('Probe')
const results = await parallel(PROBES.map(p => () =>
  agent(RULES + '\n\nYOUR ASSIGNED PROBE:\n' + p.prompt, {
    label: `probe:${p.key}`, phase: 'Probe', schema: SCHEMA,
  }).then(r => ({ key: p.key, ...r }))
))

const good = results.filter(Boolean)
const jackpots = good.filter(r => r.jackpot)
log(`probes done: ${good.length}/${PROBES.length}; jackpots: ${jackpots.length}`)

return { jackpots, all: good }
