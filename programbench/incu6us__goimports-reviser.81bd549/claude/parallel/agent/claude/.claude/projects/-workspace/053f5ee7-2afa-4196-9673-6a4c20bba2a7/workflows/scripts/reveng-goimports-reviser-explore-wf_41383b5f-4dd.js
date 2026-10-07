export const meta = {
  name: 'reveng-goimports-reviser-explore',
  description: 'Fan out black-box behavioral exploration of the goimports-reviser reference binary across many dimensions',
  phases: [
    { title: 'Explore', detail: 'one agent per behavioral dimension, probing the binary by running it' },
    { title: 'Critique', detail: 'completeness critic per report, listing unanswered questions' },
    { title: 'Followup', detail: 'answer the gaps the critic found' },
  ],
}

const RULES = `
You are reverse-engineering a compiled Go CLI binary at /workspace/executable (it is 'goimports-reviser' v3).
It is mode 111 (execute-only): you CANNOT read or copy it. You must NOT decompile, disassemble, strace, ltrace,
objdump, or otherwise inspect it statically. You must NOT search the web or any package registry for its source
code, and must NOT download the upstream project. There is NO network access anyway.
The ONLY legitimate method is: RUN the binary with inputs/flags and observe stdout, stderr, exit codes, and file changes.

Reference docs you may read: /workspace/README.md.

Environment facts already established (do not re-derive):
- Local toolchain is go1.21.0 at /usr/local/go. No network. Empty module cache. Only Go stdlib is usable.
- The binary was built with go1.26.0; 'executable -version' prints:
    version: 3.0.0-20260303205914-9926ea38658f
    built with: go1.26.0
    tag: v3.0.0-20260303205914-9926ea38658f
    commit: n/a
    source: github.com/incu6us/goimports-reviser/v3
- Log/diagnostic lines go to STDERR via Go's standard log package with default flags, e.g.
  "2026/08/10 14:09:14 Paths: [a.go]". Formatted Go code with -output stdout goes to STDOUT.
  IMPORTANT: your terminal may render those timestamps with dashes; the real bytes use slashes. Use 'od -c' if unsure.
- Unknown flag => usage printed to stderr, exit 2. No args at all => usage to stderr, exit 1.
- Bad -output value => log line 'invalid output "bad" specified', exit 1.
- Bad -imports-order value => usage to stderr THEN log line 'unknown order group type: "bad"', exit 1.
- Without a go.mod anywhere up-tree it fails: 'Could not determine project name for path a.go: open go.mod: no such file or directory' exit 1.
- -rm-unused and -set-alias load the package via go/packages (running the 'go' tool), so they need a resolvable
  module; unresolvable imports or two package names in one dir => 'Failed to fix file: package has an errors' exit 1
  (plus raw 'go list'-style errors on stderr with no log timestamp). Plain runs (no -rm-unused/-set-alias) do NOT
  need imports to resolve.

METHOD REQUIREMENTS:
- Work ONLY inside your own scratch directory (given below). Create go.mod files as needed
  (e.g. 'module example.com/proj' + 'go 1.21').
- Capture stdout and stderr SEPARATELY into files, and always record the exit code. Never pipe the binary into
  'head' when measuring exit codes (SIGPIPE gives 141).
- Use 'od -c' / 'cat -A' when whitespace, blank lines, tabs, or trailing newlines matter. Byte-exactness matters
  enormously: this is for a byte-for-byte reimplementation.
- Prefer many small deterministic experiments. For each claim you make, include the exact command and exact
  observed output so a reimplementer can build a regression test from it.
- Test both the presence AND absence of each flag, and idempotency (run twice, does output change?).
- When you find surprising behavior, isolate it with a minimal reproducer.

DELIVERABLE:
Write a detailed report to the report path given below. Structure it as:
  # <dimension>
  ## Confirmed behaviors   (each with: minimal input file(s), exact command, exact output incl. exit code)
  ## Exact strings / formats  (verbatim log messages, error messages, with placeholders marked)
  ## Algorithm inference    (your best precise statement of the rule, e.g. pseudocode)
  ## Surprises / gotchas
  ## Open questions
Be exhaustive and concrete; a reimplementer will follow ONLY your report, not your intuition.
Then RETURN a compact summary (<= 60 lines) of the most decision-relevant findings plus the report path.
`

const DIMENSIONS = [
  {
    key: 'cli-flags',
    title: 'CLI surface, flag parsing, version, exit codes',
    prompt: `Probe the complete command-line surface.
- Exact usage text (byte-exact; note trailing spaces on the -imports-order lines) and when it is printed (stderr vs stdout).
- Exit codes for: no args; unknown flag; -h; --help; -help; bad -output; bad -imports-order; nonexistent target;
  target that is a non-.go file; empty string target; '-' as target.
- '-version' vs '-version-only' exact output, exit code, stream (stdout or stderr?). Do they work without go.mod / with other flags / with targets present? Does -version short-circuit before path handling?
- Deprecated flags: '-file-path X' and '-local Y'. What do they actually do now? Is -file-path still honored as a target?
  Is there a deprecation warning? What if both -file-path and a positional arg are given? What if -file-path only?
- Flag syntax variants: -flag=value, -flag value, --flag, boolean -flag=false, flags AFTER positional args
  (does Go's flag pkg stop parsing at first non-flag? confirm 'executable a.go -format' behavior).
- What is logged for the target list: exact 'Paths: [...]' formatting for 1, 2, 3 targets (Go slice printing).
- What is logged per file processed ('Processing X')? Is it printed for skipped files? Is order deterministic?
- Behaviour with duplicate targets, and with the same file given twice.
- Does it read stdin ever? Any subcommands?`,
  },
  {
    key: 'targets-walk',
    title: 'Target resolution, directory walking, -recursive, ./...',
    prompt: `Probe how targets map to the set of processed files.
- Single .go file (relative, absolute, ./x.go, ../x.go, nested path).
- A directory without -recursive: which files are processed (only top level? none? error?).
- A directory WITH -recursive.
- './...' and 'dir/...' and '...' and './...' from a subdirectory. Is recursion implicit for '...' patterns?
- Are _test.go files processed? files in 'vendor/'? in 'testdata/'? hidden dirs ('.git', '.hidden')?
  dirs starting with '_'? non-.go files? symlinked files/dirs? empty dirs? nested modules (a subdir with its own go.mod)?
- Ordering of processed files (sorted? walk order?) — build a tree with many files and record exact 'Processing' order.
- What is printed for a directory target: does 'Paths: [...]' show the raw args or the expanded files?
- Mixing multiple targets of different kinds in one command; overlapping targets (dir + file inside it) — is a file processed twice?
- Absolute vs relative path echoing in log lines and in -list-diff output — which form is printed?
- Error messages for: missing dir, unreadable file, a target that is a .go file with a syntax error, a dir with no .go files.
- Does the cwd matter (run from a subdirectory)?`,
  },
  {
    key: 'excludes',
    title: '-excludes pattern semantics',
    prompt: `Determine exactly how -excludes works.
- Value is comma-separated. Are spaces around commas trimmed? Empty entries? Trailing comma?
- Semantics of each entry: exact path? glob? does a trailing '/' mean a directory? is it matched against the
  absolute path, the path relative to cwd, or the base name?
- Test: 'proto/*.go', '*.go', 'x.go', './x.go', 'sub/', 'sub', 'sub/*', 'sub/**/*.go', '**/*.go', absolute paths,
  '.git/'. Does '*' cross directory separators?
- Does excluding a directory prune the walk (and does it work when the dir is given directly as a target)?
- Does an excluded explicit file target get skipped silently or logged?
- What happens with an invalid glob pattern (e.g. '[')? Error message and exit code?
- Interaction with -recursive and with './...'.
- Is there any log line when a file is skipped due to exclusion?
Provide a precise matching algorithm in pseudocode.`,
  },
  {
    key: 'project-name',
    title: 'Project name / module resolution and its effect',
    prompt: `Determine how the "project" (local) import group is identified.
- With no -project-name: where does it look for go.mod? Test: file in the module root; file in a nested subdir;
  cwd inside module vs outside; target given by absolute path while cwd is elsewhere; nested module (subdir with
  its own go.mod) — which module wins? Confirm whether lookup starts from the file's directory or from the cwd.
  (Hint: the error message 'open go.mod: no such file or directory' suggests a relative open — pin down exactly.)
- Exact error text and exit code when go.mod is absent, malformed, has no module line, or is a directory.
- Does it respect the 'module' directive only, or GOPATH/GO111MODULE? Try GO111MODULE=off, GOPATH mode, and a
  file inside GOPATH/src.
- With -project-name given: is go.mod still required? Does it accept arbitrary strings, trailing slashes, multiple
  comma-separated values?
- How does project-name affect classification: is an import 'example.com/proj/sub' project? What about
  'example.com/proj' exactly? 'example.com/projX' (prefix but not path-prefix)? 'example.com/proj-other'?
  Determine whether matching is string-prefix or path-component-prefix.
- Does go.mod's module path with a major-version suffix (/v2) change anything?
- Is the go.mod discovery cached across multiple targets in one run?`,
  },
  {
    key: 'grouping-std',
    title: 'Import classification: std vs general vs company vs project',
    prompt: `Nail the classification rule for every import path.
- std detection: is it a hardcoded/std list, or the heuristic "first path segment contains no dot"?
  Test paths: 'fmt', 'net/http', 'C' (cgo), 'embed', 'unsafe', 'internal/foo', 'cmd/go', 'golang.org/x/exp/slices',
  'example.com/x', 'localhost/x', 'mypkg' (no dot, not std!), 'foo/bar' (no dot, not std), 'gopkg.in/yaml.v2',
  'a.b', 'x/y.z/w' (dot in second segment only), uppercase, single letter, and a std package that does not exist
  in go1.21 but might in 1.26. Use plain runs (no -rm-unused/-set-alias) so unresolvable imports are OK.
  This distinction is critical: does 'mypkg' land in std or general?
- company: only with -company-prefixes. Test matching: exact, path-prefix ('github.com/org' vs
  'github.com/organization'), string-prefix, multiple comma-separated values, spaces around commas, empty values,
  a prefix that also matches the project name (which group wins?), a prefix matching a std path,
  trailing slash in the prefix, and glob characters in the prefix.
- project: relationship to project name (see other agent) and precedence vs company.
- Ordering WITHIN a group: plain lexicographic byte sort of the import path? Where do aliases/dot/blank sort?
  Test paths differing only by case, by '/' vs '.' vs '-' (e.g. 'a/b' vs 'a-b' vs 'a.b'), and duplicates
  (same path imported twice, with and without different aliases).
- Duplicate identical imports: deduplicated or kept?
- Blank lines BETWEEN groups: exactly one? What if a group is empty (no double blank lines)?
Give a precise decision procedure.`,
  },
  {
    key: 'imports-order',
    title: '-imports-order parsing, validation, blanked/dotted groups',
    prompt: `Fully characterize -imports-order.
- Default is 'std,general,company,project'. Test every permutation shape you can: reordering, omitting groups
  (what happens to imports whose group is omitted? dropped? appended? error?), duplicating a group name,
  unknown name (exact error 'unknown order group type: "X"' — is usage printed too? exit code?),
  empty string value, trailing/leading commas, spaces around names, uppercase names.
- 'blanked' and 'dotted' groups: when NOT listed, where do blank ('_') and dot ('.') imports go? When listed,
  do they override the std/general/company/project classification for those imports? What about a blank import of
  a std package, and '_ "embed"'?
- Is 'blanked'/'dotted' allowed in any position (e.g. first)? What if only 'blanked' is given?
- Interaction with -company-prefixes when 'company' is omitted from the order.
- Does the order value affect anything besides group order (e.g. blank line placement)?
- Confirm the README's example with 'std,general,company,project,blanked,dotted' byte-for-byte.
Report the exact set of accepted group tokens.`,
  },
  {
    key: 'separate-named',
    title: '-separate-named semantics',
    prompt: `Characterize -separate-named exactly.
- Which imports count as "named"? Aliased imports; does '_' count? does '.' count? does an alias equal to the
  package's own name count? Is it per group?
- Where do named imports go relative to unnamed ones within a group (after, with a blank line)?
- Sorting within the named sub-group: by import path or by alias?
- Interaction with 'blanked'/'dotted' groups in -imports-order (are blank/dot imports also split, or already
  moved to their own group?).
- Interaction with -set-alias (aliases the tool itself adds — do they then get separated?).
- Blank line rules when a group has only named imports, or only unnamed ones.
- Reproduce the README '-separate-named' example byte-for-byte and report any deviation.
- Idempotency.`,
  },
  {
    key: 'set-alias',
    title: '-set-alias semantics',
    prompt: `Characterize -set-alias exactly. NOTE: it loads the package with the go tool, so build a module whose
imports all resolve — use ONLY stdlib import paths plus locally-created packages inside your own module
(you can create nested dirs with their own package clauses, including version-suffixed dir names like 'pg/v9'
and packages whose package name differs from the dir name). No network.
- Which imports get an alias added? Only ones with a version suffix (/v2, /v9)? What about /v0, /v1, /vX,
  /v10, /v2.1, dir literally named 'v2'? What about a path segment 'v2' not at the end?
- What alias string is chosen: the loaded package's real name, or derived from the path? Create a package in dir
  'pg/v9' whose 'package' clause is something unexpected (e.g. 'package pgsql') and see which wins.
- Is an alias added when the last non-version segment already equals the package name (e.g. dir 'yaml.v2')?
  Test 'gopkg.in'-style paths using a local replace or a local dir named 'yaml.v2'.
- Does it ever REMOVE or rewrite an existing alias? What if the existing alias differs? What if it equals the package name?
- Does it alias non-versioned imports whose package name differs from the last path segment (e.g. dir 'foo-go'
  containing 'package foo')? This distinguishes 'alias versioned' from 'alias mismatched'.
- Does it touch std imports? blank/dot imports?
- Exact failure modes when the package cannot be loaded: the message 'package has an errors', exit code, and which
  raw go-tool stderr lines appear.
- Does it work with -output stdout, and is it idempotent?`,
  },
  {
    key: 'rm-unused',
    title: '-rm-unused semantics',
    prompt: `Characterize -rm-unused exactly. It loads the package with the go tool, so keep all imports resolvable
(stdlib + local packages in your own module). No network.
- Baseline: an unused stdlib import is removed; used one kept. Confirm removal preserves the parenthesized
  import block even when only one import remains, and what happens when ALL imports are removed
  (is 'import ()' left? the whole decl deleted? blank lines?).
- Are blank ('_') imports removed? dot ('.') imports? aliased-but-unused imports? An import used only in a comment?
  Used only in a //go:generate line? Used only inside a string?
- CRITICAL: I observed a file where unused imports were NOT removed. Minimal repro attempt: package main with
  imports fmt, os, unused "net/http", _ "embed", . "math", "strings" and body 'func main() { fmt.Println(os.Args, Pi) }'
  -> NOTHING was removed. But a file with just fmt+strings and body using fmt DID have "strings" removed.
  Isolate the exact trigger (dot import present? blank import? type-check failure? something else). This is the
  single most important question for this dimension — bisect it carefully.
- Does usage detection consider the whole package (other files in the dir) or only this file?
- Is an import used only in a _test.go file kept when processing the non-test file, and vice versa?
- Imports used only in code excluded by build tags / //go:build lines?
- 'C' import for cgo; 'unsafe'; duplicate imports of the same path (one used, one not).
- Interaction with -set-alias (does removing happen before aliasing?).
- Exact failure modes and messages when loading fails.
- Idempotency.`,
  },
  {
    key: 'format-flag',
    title: '-format flag: what extra formatting happens',
    prompt: `Characterize -format.
- Baseline: WITHOUT -format, is the file gofmt'ed at all? Feed badly formatted code (bad indentation, extra blank
  lines, missing blank lines between decls, misaligned struct fields/comments, 'if x{' style, long lines,
  semicolons, tabs vs spaces) and diff the no-format output against the -format output and against gofmt -s / gofmt.
- Is -format equivalent to gofmt (go/format.Source)? Does it also apply the 'add blank line between top-level
  declarations' behavior shown in the README example? Try consecutive func decls with no blank line, consecutive
  var/const/type decls, methods, a func followed by a var, and decls separated by comments.
- Does it collapse multiple consecutive blank lines anywhere? Inside function bodies? Between imports?
- Does -format do anything to comments (e.g. normalizing '//fmt package' to '// fmt package')?
  Test comment normalization WITH and WITHOUT -format, both inside and outside the import block — the README
  example suggests '//fmt package' becomes '// fmt package' in the import block; verify precisely where this applies.
- gofmt -s style simplifications (e.g. 'x[a:len(x)]' -> 'x[a:]', composite literal simplification)? Test several.
- Does -format change struct tag/field alignment, switch/case indentation, or add parentheses?
- Idempotency and interaction with the other flags.
Report a precise statement of what -format adds on top of the default behavior.`,
  },
  {
    key: 'comments',
    title: 'Comment and layout preservation in and around the import block',
    prompt: `Characterize how comments and blank lines in/around imports are handled (no -format, then with -format).
- Inline trailing comments on an import line: preserved? moved with the import? Is '//x' rewritten to '// x'?
  What about '/* block */' comments, multiple comments on one import, and a comment containing tabs?
- Comments on their own line inside the import block: attached to the following import? preceding one? dropped?
  Test a leading comment above the first import, a floating comment between two groups, a comment at the very end
  of the block, and a multi-line comment group.
- The doc comment above 'import (' and a comment on the same line as 'import (' or as ')'.
- Comments containing a blank line, and '//nolint' / '//go:build' style directives.
- Multiple separate import declarations in one file (two 'import (...)' blocks, or 'import "a"' plus a block):
  merged into one? which position? What about an import decl appearing after other declarations (legal Go: no,
  imports must precede decls — so also test 'import' after a func to see the parse error handling).
- Single-import file: 'import "fmt"' — kept unparenthesized or converted to a block?
- 'import ()' empty block. File with no imports at all. File with only a package clause.
- The package clause's own trailing comment ('package testdata // comment') and the file's leading license/build-tag
  comment block: preserved verbatim, including the blank line before 'package'?
- Byte-exactness: report whether the output ends with exactly one newline, and whether CRLF input is preserved.
Give exact before/after pairs.`,
  },
  {
    key: 'output-modes',
    title: '-output file|write|stdout, -list-diff, -set-exit-status',
    prompt: `Characterize output/exit behavior.
- '-output file' (default) vs 'write': any difference at all? Is the file rewritten when nothing changes
  (check mtime and inode)? Are file permissions preserved (test 0600, 0644, 0755)? Owner? Is a temp file used?
- '-output stdout': exact bytes; for MULTIPLE targets is there any separator/header between files?
- '-list-diff' alone: what is printed, to which stream, and in what path form (relative/absolute)? Is the file
  modified? Exit code when a diff exists vs not?
- '-list-diff' combined with each -output value (README says 'write' + '-list-diff' lists the name AND writes).
  Test all 3 combos, with and without an actual difference.
- '-set-exit-status': exit code when a change is needed/made vs not, for each -output mode, and combined with
  -list-diff. With multiple files where only some differ. Does it still write the file?
- Do -list-diff / -set-exit-status consider changes caused by -format / -rm-unused / -set-alias?
- What is the exit code when some files error and others succeed? Does it stop at the first error or continue?
- Any 'diff' text output (unified diff) anywhere?
Report a precise decision table: (output mode, list-diff, set-exit-status, changed?) -> stdout text, stderr text, file written?, exit code.`,
  },
  {
    key: 'cache-generated',
    title: '-use-cache and -apply-to-generated-files',
    prompt: `Two smaller dimensions.
(A) -use-cache: does it create files/dirs (check $HOME, XDG dirs, os.UserCacheDir, /tmp, the module dir, .git dir)?
    Use 'find' on likely locations before/after (do NOT trace the binary; just diff the filesystem).
    What is cached and keyed on (content hash? mtime? path?)? Does a second identical run behave differently
    (faster, different log lines, file not rewritten)? Does it change OUTPUT in any observable way?
    Does it interact with -list-diff/-set-exit-status (e.g. a cached file reported as unchanged)?
    Does modifying the file invalidate it? Is the cache dir created even without changes? Report exact paths and
    file formats (cat the cache files).
(B) -apply-to-generated-files: determine the exact detection rule for a "generated" file. The doc says the first
    comment starts with '// Code generated'. Test: exact prefix, case sensitivity, leading whitespace, the
    canonical '// Code generated by ... DO NOT EDIT.' form, a '/* Code generated */' block comment, the comment
    appearing after the package clause, after a build tag comment, after a blank line, as the second comment,
    and inside the import block. Without the flag, what happens to a generated file: skipped silently, or logged?
    Exit code? Does it count for -list-diff/-set-exit-status? With the flag, is it processed normally?`,
  },
  {
    key: 'edge-cases',
    title: 'Parse errors, weird files, exotic Go syntax',
    prompt: `Stress the parser/printer paths.
- Syntax error in the file: exact error message format and exit code, with and without -output stdout. Is a partial
  result written? Does it continue to the next file? What if the error is inside the import block?
- File with no package clause; empty file (0 bytes); file with only whitespace; file with a UTF-8 BOM;
  CRLF line endings; no trailing newline; extremely long import path; non-UTF8 bytes.
- A .go file whose name starts with '.' or '_'; a file with a '.GO' extension; a directory named 'x.go'.
- Build constraints: '//go:build ignore' + '// +build ignore', a file excluded by GOOS/GOARCH tags
  (e.g. 'foo_windows.go'), and 'package main' vs library.
- cgo: 'import "C"' with a preceding comment block — is the comment kept adjacent to the import (it must be,
  or cgo breaks)? Which group does "C" land in? Test with and without other imports, and with -rm-unused.
- Exotic syntax that go1.21 might not parse but go1.26 would (generics with new syntax, range-over-func,
  'for range 10', new builtins like min/max, aliases with type params 'type A[T any] = ...'). This matters because
  my reimplementation must use go1.21's parser; find out which constructs the binary accepts that go1.21 rejects.
  Report each construct and the binary's verdict.
- Very large file / many imports (100+) — any truncation or reordering surprises?
- Unicode identifiers and import paths with unusual characters.
- A file that is a symlink; a read-only file (0444) with -output file (error message?); a file in a read-only dir.
- Two goroutine-race-ish scenarios: many targets at once — is processing concurrent (interleaved logs) or serial?`,
  },
  {
    key: 'golden-corpus',
    title: 'Golden corpus: build a large reusable differential test suite',
    prompt: `Your job is different: build a REUSABLE golden corpus that a reimplementation can be diffed against.
Create the directory /tmp/golden and inside it:
- 'cases/NNN-name/' directories, each containing the input tree (go.mod + .go files) and a file 'cmd' holding the
  exact argument list (one per line, no binary name), plus 'expected.stdout', 'expected.stderr' (with the log
  timestamps replaced by the literal token <TS> at line start), 'expected.exit', and if the run modifies files,
  'expected.tree/' containing the post-run file contents.
- A runner script /tmp/golden/run.sh that takes a path to ANY binary as $1, executes every case in a fresh temp
  copy of its input tree, normalizes timestamps, and diffs against the expected files, printing PASS/FAIL per case
  and a summary. It must exit non-zero if any case fails. Make it robust and self-contained (bash + diff only).
- Verify run.sh passes 100% against /workspace/executable itself.
Aim for AT LEAST 60 diverse cases covering: default behavior, every flag alone, realistic flag combinations,
all -imports-order permutations incl. blanked/dotted, -company-prefixes, -separate-named, -set-alias, -rm-unused,
-format, -excludes, -recursive, './...', -list-diff, -set-exit-status, -output write/stdout, generated files,
comment preservation, single/multiple/empty import blocks, cgo, no-imports files, error cases (syntax error,
missing file, no go.mod, bad flag values), and idempotency (a case whose input is already formatted).
Keep each case SMALL. Do not use network imports in cases that use -rm-unused/-set-alias (they must resolve);
for those, use stdlib and local packages inside the case's own module.
RETURN: the number of cases, the corpus layout, how to invoke run.sh, and any cases you could not make deterministic.`,
  },
]

phase('Explore')

const reports = await pipeline(
  DIMENSIONS,
  (d) => agent(
    `${RULES}\n\nYour scratch directory: /tmp/probe/${d.key} (create it).\nYour report path: /tmp/findings/${d.key}.md\n\n## YOUR DIMENSION: ${d.title}\n\n${d.prompt}`,
    { label: `explore:${d.key}`, phase: 'Explore' }
  ),
  async (summary, d) => {
    if (!summary) return null
    const critique = await agent(
      `${RULES}\n\nYour scratch directory: /tmp/probe/${d.key}-critic (create it).\n\nA colleague explored the dimension "${d.title}" and wrote a report at /tmp/findings/${d.key}.md.\nRead that report. Your job is to be a COMPLETENESS CRITIC for a byte-for-byte reimplementation:\n1. List concrete questions the report leaves unanswered or answers vaguely, that a reimplementer would need.\n2. Spot-check 3-6 of its concrete claims by re-running the commands yourself; report any claim that is WRONG or imprecise.\nRETURN a numbered list of the gaps/errors, most important first (max 25 items). Be specific and terse.`,
      { label: `critique:${d.key}`, phase: 'Critique' }
    )
    if (!critique) return { key: d.key, summary, critique: null, followup: null }
    const followup = await agent(
      `${RULES}\n\nYour scratch directory: /tmp/probe/${d.key}-fu (create it).\n\nDimension: "${d.title}". An existing report lives at /tmp/findings/${d.key}.md.\nA critic listed these gaps and suspected errors:\n\n${critique}\n\nYour job: answer EVERY gap by running the binary, and correct every error. Then APPEND a section\n'## Follow-up (round 2)' to /tmp/findings/${d.key}.md containing your findings (exact commands + exact outputs +\ncorrections). Do not delete existing content; if you correct a claim, say clearly 'CORRECTION: ...'.\nRETURN a compact list of the answers and corrections (<= 60 lines).`,
      { label: `followup:${d.key}`, phase: 'Followup' }
    )
    return { key: d.key, summary, critique, followup }
  }
)

return reports.filter(Boolean).map(r => ({
  key: r.key,
  report: `/tmp/findings/${r.key}.md`,
  summary: r.summary,
  corrections: r.followup,
}))
