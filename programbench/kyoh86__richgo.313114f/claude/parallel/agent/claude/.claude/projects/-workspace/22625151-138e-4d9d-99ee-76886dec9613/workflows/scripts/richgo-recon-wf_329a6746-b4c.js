export const meta = {
  name: 'richgo-recon',
  description: 'Exhaustively probe the richgo reference binary to derive its exact observable behavior',
  phases: [
    { title: 'Probe', detail: 'parallel agents each probe one behavioral area of ./executable' },
    { title: 'Critique', detail: 'completeness critic finds gaps in each area report' },
    { title: 'Fill', detail: 'follow-up probing to close the gaps' },
  ],
}

const RULES = `
CRITICAL RULES (a benchmark; violating these is disqualification):
- The binary under study is /workspace/executable (richgo, a Go test output colorizer).
- You may ONLY learn about it by RUNNING it with inputs/flags/env. Reading /workspace/README.md is allowed.
- You MUST NOT decompile, disassemble, run objdump/nm/strings/readelf/gdb/ghidra, or strace/ltrace it.
- You MUST NOT search the web, clone repos, use "go get"/"go install", or read any upstream source.
- Do not try to find the original source code anywhere. Derive everything empirically.

USEFUL SETUP (already present):
- Helper: /tmp/rg/f.sh  -> usage: /tmp/rg/f.sh 'line1\\nline2\\n'   (printf %b, pipes to testfilter with RICHGO_FORCE_COLOR=1, output through cat -v)
- A sample Go module at /tmp/rg/proj (module example.com/sample) you can extend with real tests.
- Go 1.21 is installed.
- Reference invocation: printf '...' | RICHGO_FORCE_COLOR=1 /workspace/executable testfilter
- Use \`od -c\` or \`cat -v\` for exact bytes. NEVER trust rendering; always dump bytes.
- Set RICHGO_LOCAL=1 and cd into a scratch dir with a .richstyle file to test config without interference.
  IMPORTANT: without RICHGO_LOCAL=1 the tool also reads $HOME/.richstyle etc. Always control HOME/GOPATH in tests.
- When not a TTY and RICHGO_FORCE_COLOR is empty/unset, testfilter is a pure pass-through. So always set RICHGO_FORCE_COLOR=1.

ALREADY ESTABLISHED (do not re-derive, but DO correct me if wrong):
- Output = for each element of strings.Split(input, "\\n"): print element + "\\n". (empty input -> "\\n")
- RICHGO_FORCE_COLOR non-empty (even "0") enables enrichment; empty/unset + non-TTY = raw pass-through; TTY = enriched.
- Long labels rendered as fmt.Sprintf("%-5s| ", label) with labels BUILD/START/PASS/FAIL/SKIP/COVER and "" for uncategorized.
- Short labels: fmt.Sprintf("%-2s ", label) with !!/>/o/x/-/% .
- labelType "none" or an unrecognized value => no label at all.
- Default styles per README are accurate: build=bold+yellow, start=lightBlack, pass=green, fail=bold+red,
  skip=lightBlack, passPackage=green+hide, failPackage=bold+red+hide, coverThreshold=50, covered=green,
  uncovered=bold+yellow, file=cyan, line=magenta.
- SGR order observed: foreground BEFORE bold, e.g. bold+red => "\\x1b[31m\\x1b[1m", reset "\\x1b[0m".
- Coverage line "coverage: 50.0% of statements" -> "50.0% [#####_____]" ; bar = 10 cells, filled = floor(pct/10).
- file:line highlighting applies to every line; "x.go" cyan, ":1" or ":1:2" magenta; segments outside get the
  category style, segments inside get file/line style (each with its own \\x1b[0m).

DELIVERABLE:
Write your findings to the file path given in your task, as precise, testable, implementation-ready notes.
Include EXACT byte-level input->output examples (use \\x1b for ESC). State regexes you believe are used and
the evidence. Explicitly list things you tested that did NOT match. Your final message must be a concise
summary (< 250 lines) of the confirmed rules; the full detail goes in the file.
`

const AREAS = [
  {
    key: 'cli',
    file: '/tmp/rg/findings/cli.md',
    prompt: `Area: COMMAND-LINE INTERFACE AND SUBCOMMAND DISPATCH of /workspace/executable.

Determine exhaustively:
1. Which argv[1] values are intercepted vs forwarded to the real "go" binary. Test: (no args), test, testfilter,
   version, build, help, env, vet, run, list, "Test", "TEST", --help, -h, -v, unknown-subcommand, empty string arg.
2. For forwarded commands: is it exec() replacing the process, or a child process? Compare exit codes
   (e.g. \`/workspace/executable build ./nonexistent\`, \`/workspace/executable env GOPATH\`), stdout vs stderr routing
   (redirect them separately and diff), and whether stdin is passed through.
3. For \`test\`: build real Go modules under /tmp/rg (use several: all-pass, some-fail, build-error, no-test-files,
   with -cover, with -v, with -run, with -json, with -bench). Compare \`/workspace/executable test ...\` output
   (both with and without RICHGO_FORCE_COLOR=1, and with 2>/dev/null vs 2>&1) against plain \`go test ...\`.
   KEY QUESTIONS: does richgo add "-v" automatically? Does it colorize stderr too? What is the EXIT CODE when
   tests fail / build fails / pass? Is output line-buffered/streamed (test with a slow test that sleeps and
   check whether output appears incrementally — use \`timeout\` + partial reads)?
4. Does \`test\` respect a "-json" flag or GOFLAGS? Does it pass through unknown flags? What about \`test -c\`,
   \`test -o\`, \`test -exec\`? What about \`richgo test\` with no package args?
5. \`testfilter\` with extra args: does it ignore them? Does it accept flags? Does it read a file argument?
6. What does richgo do if "go" is not on PATH (test with env PATH=/nonexistent)? Capture the exact error text
   and exit code. Also test GOROOT weirdness.
7. Any other subcommands? Try: richgo testfilter, richgo test-filter, richgo filter, richgo completion,
   richgo help, richgo version, richgo --version. Record exact stdout/stderr/exit for each.
8. Signal/pipe behavior: what happens on SIGPIPE (pipe to \`head -1\`)?

${RULES}`,
  },
  {
    key: 'categorize',
    file: '/tmp/rg/findings/categorize.md',
    prompt: `Area: LINE CATEGORIZATION AND CONTENT REWRITING RULES of richgo testfilter.

Derive, with byte-exact evidence, the matching rule and content rewrite for EVERY category. Known categories:
Build, Start, Pass, Fail, Skip, PassPackage, FailPackage, Cover, and "no category" (default).

Specific puzzles to solve DEFINITIVELY (these are the crux):
a) "=== RUN   TestA" matches (3 spaces) but "=== RUN TestA" (1 space) and "=== RUN   A" do NOT.
   Determine the exact required prefix and the exact requirement on the test name. Try names:
   Test, TestA, Test_x, Test/Sub, TestÜ, Testing, XTest, Benchmark..., Example..., Fuzz..., "Test A",
   leading/trailing spaces, tabs, empty name. Also test with 2 or 4+ spaces after RUN.
b) "--- PASS: TestA (0.00s)" matches. "--- PASS: A (0.00s)" does NOT. "  --- PASS: TestA (0.00s)" (2 leading
   spaces) matches AND renders with NO indent, while go's real 4-space-indented subtest lines render with a
   2-space indent. "\\t--- PASS: TestA (0.00s)" is categorized as Pass but its content is left COMPLETELY RAW
   (label "PASS | " + the original line including the tab). EXPLAIN THIS. Hypothesis to test: category detection
   and content rewriting use different regexes. Find both. Try: "xx --- PASS: TestA", "--- PASS:  TestA",
   "--- PASS: TestA", "---  PASS: TestA", "--- pass: TestA", indentation of 1,2,3,4,5,8 spaces, mixed tabs.
c) Package result lines. Establish the rule for each of:
   "ok  \\tpkg\\t0.002s"  -> "PASS | pkg " (green)
   "ok  \\tpkg\\t(cached)" -> "PASS | pkg "
   "ok \\tpkg\\t0.1s\\tcoverage: 50.0% of statements" -> "PASS | pkg coverage: 50.0% of statements"
   "ok\\tpkg\\t1s" -> "PASS | pkg "
   "ok  \\tpkg" (only TWO fields) -> content is literally "pkg\\n " (A NEWLINE APPEARS IN THE OUTPUT!) -- explain!
   "FAIL\\tpkg\\t0.005s" -> "FAIL | \\tpkg\\t0.005s" (tab preserved, only "FAIL" stripped)
   "FAIL pkg" -> no match ; "FAIL" -> hidden (FailPackage) ; "FAIL " -> hidden ; "PASS" -> hidden
   "?   \\tpkg\\t[no test files]" -> "SKIP | pkg\\t[no test files]"
   Try MANY variants (different field counts, spaces vs tabs, trailing whitespace, no trailing newline vs
   trailing newline, "ok" with 1/2/3 spaces, package names with spaces, "FAIL\\t", "ok\\t", "ok  \\t").
   The "pkg\\n " result strongly suggests the matcher is applied to text that still contains the newline, or
   that a multiline/greedy regex is used. Design experiments (e.g. two consecutive "ok  \\tpkg" lines; an
   "ok  \\tpkg" line followed by other lines; input with NO trailing newline) to distinguish the hypotheses.
d) Build lines: "# pkg" -> "BUILD| pkg". Test "#pkg", "# ", "#", " # pkg", "## pkg", and the follow-on
   compiler error lines. Which lines after a build line inherit the build style, and when does it stop?
e) Cover lines: exact regex (one decimal digit required? "12.34%" fails, "5%" fails). Test "coverage: 100.0% of statements",
   trailing text after "statements", leading whitespace, "coverage: 50.0% of statements in ./...", "\\tcoverage: 50.0% of statements".
f) Which categories update the "current style" used for subsequent uncategorized lines? Established: Start,
   Pass, Fail, Skip do; Cover does NOT. Test Build, PassPackage, FailPackage, the "ok"/"FAIL"/"?" package lines,
   and whether an uncategorized line itself resets/updates the current style. Test whether a HIDDEN line
   (PASS/FAIL package with hide:true) still updates the current style. Test what happens at the very start
   (no style) and whether the state ever resets.
g) The exact indentation rule for test names: does "TestA/B/C" render with 4 spaces? Is it derived from the
   number of "/" in the name, or from leading whitespace in the input line? Test both independently, including
   "--- PASS: TestA/B/C (0.0s)" with 0 input indent and "        --- PASS: TestA (0.0s)" with 8 spaces.
h) Are there any OTHER recognized line forms? Try: "=== PAUSE", "=== CONT", "=== NAME", "--- BENCH", "BenchmarkX-8 ...",
   "PASS\\n", "testing: warning: no tests to run", "panic:", "goroutine 1 [running]:", "exit status 1",
   "--- FAIL: TestA (0.00s)" with unusual durations, "=== RUN   TestA\\n" duplicates, fuzz output, "SKIP".

${RULES}`,
  },
  {
    key: 'config',
    file: '/tmp/rg/findings/config.md',
    prompt: `Area: CONFIGURATION FILE LOADING (.richstyle) of richgo.

Derive exhaustively:
1. Search order and precedence. README claims: \${CWD}/.richstyle, .richstyle.yaml, .richstyle.yml, then \$GOPATH/...,
   \$GOROOT/..., \$HOME/... . VERIFY empirically: create files in several of these dirs with DIFFERENT, clearly
   distinguishable settings (e.g. different labelType and different passStyle foreground) and see which wins.
   KEY QUESTION: is it "first match wins and stop", or "load all and later overrides earlier", or "merge
   field-by-field"? Design experiments that distinguish these (e.g. CWD file sets only labelType, HOME file
   sets only passStyle -> are both applied?).
   Use controlled env: HOME=/tmp/x GOPATH=/tmp/y GOROOT=/tmp/z and cd to a scratch CWD.
   NOTE: GOROOT may default to the real /usr/local/go if unset — control it explicitly, and also test what
   happens when GOPATH/GOROOT are unset (does it fall back to \`go env GOPATH\`? to ~/go?).
2. RICHGO_LOCAL: which values enable it ("1", "0", "true", "", arbitrary)? Exactly what does it restrict?
3. Malformed YAML: what error message goes where (stdout/stderr) and what exit code? Test: invalid YAML syntax,
   unknown top-level keys, wrong types (labelType: 3, coverThreshold: "abc", removals: "str" instead of list,
   passStyle: "green" instead of a map), empty file, file that is a directory, unreadable file (chmod 000).
   Capture EXACT text.
4. Full schema behavior for every documented key: labelType, buildStyle, startStyle, passStyle, failStyle,
   skipStyle, fileStyle, lineStyle, passPackageStyle, failPackageStyle, coverThreshold, coveredStyle,
   uncoveredStyle, removals, leaveTestPrefix. Test each in isolation.
   - Is YAML key matching case-sensitive? Try LABELTYPE, labeltype, label_type.
   - Does specifying e.g. passStyle: {bold: true} keep the default green, or reset the whole style?
   - hide: true on each of the styles — does it hide Start/Pass/Fail/Skip/Build/Cover lines too?
   - coverThreshold: test 0, 100, negative, >100, float values, string.
   - leaveTestPrefix: true/false effect on Start/Pass/Fail/Skip names AND on indentation.
   - removals: multiple regexes, invalid regex (what error?), does it match substring or whole line?
     Does a removed line still update the "current style"? Is removal applied before or after categorization?
     Does it apply to the raw line or the rewritten content?
5. Does the config file affect the raw pass-through mode (no color)? Do removals still apply?
6. Is there any other env var? Try RICHGO_DEBUG, RICHGO_STYLE, RICHGO_CONFIG, NO_COLOR, CLICOLOR, CLICOLOR_FORCE,
   TERM=dumb, GO_TEST... Systematically check whether NO_COLOR / TERM=dumb affect TTY colorization
   (use \`script -qec "..." /dev/null\` to get a pty).

${RULES}`,
  },
  {
    key: 'styles',
    file: '/tmp/rg/findings/styles.md',
    prompt: `Area: COLOR / STYLE VALUE PARSING AND SGR CODE EMISSION in richgo.

Using a .richstyle file in a scratch CWD with RICHGO_LOCAL=1 and RICHGO_FORCE_COLOR=1, and a simple input line
that always matches one category (e.g. "--- PASS: TestA (0.00s)" for passStyle), derive:

1. Every accepted color NAME. Test at minimum: black, red, green, yellow, blue, magenta, cyan, white,
   lightBlack, lightRed, lightGreen, lightYellow, lightBlue, lightMagenta, lightCyan, lightWhite,
   and case variants (RED, Red, LIGHTRED, light_red, lightblack, bright_black, brightBlack, grey, gray, default,
   none, ""). Record the EXACT SGR number emitted for foreground and for background for each accepted name.
2. Hex form "#RRGGBB": what SGR is emitted? (38;2;r;g;b truecolor, or 38;5;N 256-color?) Test #000000, #FFFFFF,
   #ff0000, #FF0000 (case), #abc (3-digit), #12345 (bad length), missing #, "0xFF0000".
3. rgb() forms: "rgb(255,0,0)", "rgb(0xFF,0x00,0x00)", "rgb(255, 0, 0)" (spaces), "rgb(300,0,0)" (out of range),
   "rgb(-1,0,0)", "RGB(1,2,3)", "rgb(1,2)" (too few). Record exact SGR emitted or error.
4. Background: same tests for the "background" key; record SGR (40-47? 100-107? 48;2;...?).
5. Every boolean attribute and its SGR code: bold, faint, italic, underline, blinkSlow, blinkRapid, inverse,
   conceal, crossOut, frame, encircle, overline. Set each ALONE and record the code.
6. ORDERING: set MANY attributes at once (e.g. bold+faint+italic+underline+blinkSlow+blinkRapid+inverse+conceal+
   crossOut+frame+encircle+overline+foreground+background) and record the EXACT emitted escape sequence,
   including whether codes are combined ("\\x1b[1;3m") or separate ("\\x1b[1m\\x1b[3m") and the exact ordering.
   Then try several subsets to confirm the ordering is fixed and not YAML-key-order dependent (reorder the YAML keys!).
7. The reset: is it always "\\x1b[0m"? What is emitted when a style has NO attributes at all (empty map, or
   all false)? What about hide: false explicitly?
8. Invalid color values: "notacolor", 42, true, null, [] — what happens (error message? ignored? exit code?).
9. Does the style apply to the whole rendered line including the label prefix? (Established: yes.) Confirm for
   the file/line sub-styles: what if fileStyle has hide:true? What if fileStyle is empty/unset?
   What if fileStyle and the category style are both set — is the category style re-emitted after the file
   segment? (Established: yes, e.g. "\\x1b[31m\\x1b[1m     |     \\x1b[36mfoo.go\\x1b[0m\\x1b[35m:10\\x1b[0m\\x1b[31m\\x1b[1m: hello\\x1b[0m")
   Test a line where the file:line match is at the very START and at the very END of the content, and a line
   with TWO matches, and confirm the exact escape placement in each case.

${RULES}`,
  },
  {
    key: 'io',
    file: '/tmp/rg/findings/io.md',
    prompt: `Area: I/O SEMANTICS, STREAMING, ENCODING AND EDGE CASES of richgo testfilter.

Derive exhaustively (always with od -c for exact bytes):
1. Newline handling: "" -> "\\n"; "\\n" -> "\\n\\n"; "a\\n" -> "a\\n\\n"; "a\\nb" -> "a\\nb\\n". CONFIRM and extend.
   What about "\\r\\n" line endings? Is the \\r stripped, kept, or does it break matching (e.g.
   "--- PASS: TestA (0.00s)\\r\\n")? What about a lone "\\r"? "\\n\\n\\n"?
   IMPORTANT: does the trailing extra "\\n" also appear in the ENRICHED (colored) mode? Test carefully with od -c:
   compare \`printf 'a\\n' | RICHGO_FORCE_COLOR=1 ./executable testfilter | od -c\` vs without color.
   Also test whether the final empty element is emitted with a label prefix / style when colored.
2. Streaming: is output flushed per line? Use a slow producer:
   \`( echo line1; sleep 2; echo line2 ) | RICHGO_FORCE_COLOR=1 /workspace/executable testfilter\`
   and check with \`timeout 1\` whether line1 appears before the sleep finishes. Also test with a producer that
   never closes stdin. Determine whether it needs EOF before producing output.
3. Very long lines (1 MB single line), lines with NUL bytes, invalid UTF-8, ANSI escapes already present in input,
   extremely many lines (100k) — any truncation, corruption or crash?
4. Unicode: test names / paths with non-ASCII (e.g. "--- PASS: TestÜber (0.0s)", "うんこ.go:1: x").
   Does the label padding use bytes or runes?
5. What happens when stdout is closed early (pipe to \`head -1\`)? Exit code? Error message?
6. Does testfilter write anything to stderr, ever? Does it read stdin when given a file argument?
7. Interaction of the trailing-empty-line with hidden lines and removals (does a removed line still consume a
   newline, i.e. does removing a line reduce the output line count by exactly one?).
8. Compare TTY vs non-TTY: use \`script -qec "cmd" /dev/null\`. Is there any difference besides colorization
   (e.g. \\r\\n from the pty is expected — account for it)? Does the TTY case also emit the trailing blank line?
9. Does the tool ever buffer the whole input (e.g. to compute a summary at the end)? Any summary/footer output?

${RULES}`,
  },
  {
    key: 'gotest',
    file: '/tmp/rg/findings/gotest.md',
    prompt: `Area: REAL-WORLD "go test" OUTPUT CORPUS through richgo, and the \`richgo test\` wrapper.

Build a realistic, DIVERSE corpus of genuine \`go test\` outputs under /tmp/rg/corpus/ (raw .txt files) and record
richgo's enriched rendering for each (with RICHGO_FORCE_COLOR=1). Cover:
 - passing tests, failing tests, skipped tests, subtests (2-3 levels deep), parallel subtests (=== PAUSE/=== CONT),
 - t.Log output, t.Fatal, panics inside tests (full panic + goroutine dump + "exit status 2"),
 - build failures (compile error), vet failures, no test files ("?   pkg [no test files]"),
 - multiple packages in one run (go test ./... over 3 packages, some pass/some fail),
 - -cover and -coverprofile (note "coverage: X% of statements" and "coverage: X% of statements in ./..."),
 - cached results ("(cached)"), -count=1, -run filtering, -bench output, Examples, Fuzz targets (go1.21),
 - "testing: warning: no tests to run", "--- FAIL" with long durations, TestMain,
 - a test binary that writes to stdout/stderr directly, output with tabs and blank lines,
 - "FAIL\\tpkg [build failed]", "ok\\tpkg\\t(cached)\\tcoverage: ...".
Save both the raw input and the exact enriched output (od -c or cat -v) as paired files, and write an index.

Then study \`/workspace/executable test ...\` itself (the wrapper):
 - Does it add -v? Compare \`richgo test ./...\` vs \`go test ./...\` vs \`go test -v ./...\` output content.
 - Exit codes for pass/fail/build-error.
 - Is stderr merged into the filtered stream or passed through unfiltered? (redirect 1 and 2 to different files)
 - Behavior with RICHGO_FORCE_COLOR unset and stdout not a TTY.
 - Does it work from a directory that is not a Go module?

Your report must include a compact but comprehensive table of raw-line -> rendered-line mappings observed in
real output, especially any line form NOT already known.

${RULES}`,
  },
]

phase('Probe')

const reports = await pipeline(
  AREAS,
  (a) => agent(a.prompt + `\n\nWrite your full notes to ${a.file}.`, {
    label: `probe:${a.key}`, phase: 'Probe',
  }).then(text => ({ area: a, text })),
  (r) => agent(
    `You are a COMPLETENESS CRITIC for a reverse-engineering effort on /workspace/executable (richgo).\n\n` +
    `Read the report at ${r.area.file}. Your job: find what is MISSING, UNVERIFIED, or ASSERTED WITHOUT EVIDENCE, ` +
    `such that a from-scratch reimplementation would diverge byte-for-byte from the reference.\n\n` +
    `You MAY run /workspace/executable yourself to spot-check the report's claims — do so for at least 5 claims, ` +
    `and flag any that are WRONG.\n\n` +
    `Return a JSON-ish list of concrete gaps: each with (a) the open question, (b) an exact shell command that ` +
    `would answer it. Focus on things that change output bytes. Max 15 gaps, ranked by impact.\n\n` +
    RULES,
    { label: `critic:${r.area.key}`, phase: 'Critique' }
  ).then(gaps => ({ ...r, gaps })),
  (r) => agent(
    `You are closing gaps in the reverse-engineering report at ${r.area.file} (about /workspace/executable, richgo).\n\n` +
    `A critic identified these gaps:\n\n${r.gaps}\n\n` +
    `RUN THE EXPERIMENTS. For each gap, execute commands against /workspace/executable and record the byte-exact ` +
    `result. Then APPEND a section "## Gap resolutions" to ${r.area.file} with your findings, and CORRECT any ` +
    `wrong claims already in the file (edit them in place, marking corrections clearly).\n\n` +
    `Your final message: a concise list of the resolved facts and any that remain genuinely unknown.\n\n` +
    RULES,
    { label: `fill:${r.area.key}`, phase: 'Fill' }
  ).then(fill => ({ area: r.area.key, file: r.area.file, summary: r.text, gaps: r.gaps, fill }))
)

return reports.filter(Boolean).map(r => ({ area: r.area, file: r.file, fill: r.fill }))
