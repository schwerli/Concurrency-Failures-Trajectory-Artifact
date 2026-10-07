export const meta = {
  name: 'rustowl-recon',
  description: 'Exhaustively probe the RustOwl reference binary behavior across CLI, logging, toolchain, LSP, and subprocess protocol surfaces',
  phases: [
    { title: 'Probe', detail: 'parallel behavioral probes of ./executable, each writing exact captured output to /tmp/ref/findings/' },
    { title: 'Critique', detail: 'completeness critic identifies gaps' },
    { title: 'Gapfill', detail: 'follow-up probes for identified gaps' },
  ],
}

const SHARED = `
# Context
You are reverse-engineering a compiled binary for a re-implementation benchmark.
The binary is /workspace/executable — it is "RustOwl v1.0.0-rc.1", a Rust ownership/lifetime
visualizer that acts as an LSP server. Docs are in /workspace/README.md and /workspace/docs/.

# HARD RULES (violating = automatic failure)
- You may ONLY learn about the binary by RUNNING it with various args/stdin/env and observing
  stdout/stderr/exit codes/filesystem effects.
- FORBIDDEN: objdump, nm, readelf, strings, gdb, ghidra, any decompiler/disassembler on
  /workspace/executable. FORBIDDEN: strace/ltrace/perf/eBPF on it.
- FORBIDDEN: searching the web, cloning repos, cargo/pip/npm install of the project, reading any
  copy of the original source.
- There is NO network access in this environment (DNS fails). Do not try to fix that.
- Do NOT modify /workspace (except: you may read it). Do all scratch work under /tmp.

# Already-established facts (do not re-derive, build on them)
- Top-level CLI: options -V/--version, -q/--quiet (repeatable), --stdio, -h/--help.
  Subcommands: check, clean, toolchain (install|uninstall), completions <SHELL>, help.
- "./executable --version" prints "RustOwl v1.0.0-rc.1".
- With no args (or --stdio) it runs an LSP server on stdin/stdout; it prints to STDERR:
  "RustOwl v1.0.0-rc.1\\nThis is an LSP server. You can use --help flag to show help.\\n"
- Log lines go to stderr, format: "2026-08-07T21:21:29.038Z WARN  [rustowl::toolchain] msg"
  (RFC3339 UTC millis, then level padded to width 5, then " [", module path, "] ", message).
- Runtime dir is $HOME/.rustowl ; sysroot is
  $HOME/.rustowl/sysroot/nightly-2025-06-20-x86_64-unknown-linux-gnu.
  If missing it logs "sysroot not found; start setup toolchain" and tries to download
  https://static.rust-lang.org/dist/2025-06-20/rustc-nightly-x86_64-unknown-linux-gnu.tar.gz
  which fails (no DNS). It leaves the empty sysroot dir behind, which makes later runs skip setup.
- It looks for cargo/rustowlc in the sysroot; both missing -> logs
  "cargo not found; fallback" / "rustowlc not found; fallback" (module rustowl::toolchain).
- An analysis "target" must be an EXISTING path ending in .rs; anything else logs
  WARN [rustowl::lsp::analyze] "Invalid analysis target: <path exactly as given>" and
  ERROR [rustowl] "Analyze failed", exit code 1.
- With a valid .rs target it logs (module rustowl::lsp::backend):
  "wait 100ms for rust-analyzer", "stop running analysis processes", "start analysis",
  "analyze N packages...", then WARN rustowl::toolchain "rustowlc not found; fallback",
  then INFO rustowl::lsp::analyze "start analyzing <path>", then panics in a thread named
  "tokio-runtime-worker" at /workspace/src/lsp/analyze.rs:222:41 with
  'called \`Result::unwrap()\` on an \`Err\` value: Os { code: 2, kind: NotFound, message: "No such file or directory" }'
  then ERROR [rustowl] "Analyze failed".
- If a fake \`rustowlc\` IS on PATH, rustowl runs (a) \`cargo metadata\`-ish work with
  RUSTC=rustowlc, RUSTC_WORKSPACE_WRAPPER=rustowlc, RUSTC_BOOTSTRAP=1,
  CARGO_ENCODED_RUSTFLAGS=--sysroot=<sysroot>, LD_LIBRARY_PATH=<...>, cwd = the .rs file's parent
  dir, and (b) \`rustowlc --sysroot=<sysroot> --crate-type=lib -o/dev/null <path>\` with cwd = cwd.
- LSP: initialize result is exactly
  {"capabilities":{"textDocumentSync":{"change":2,"openClose":true,"save":true},"workspace":{"workspaceFolders":{"changeNotifications":true,"supported":true}}}}
  Custom methods: "rustowl/cursor" -> {"decorations":[],"is_analyzed":false,"path":"...","status":"error"},
  "rustowl/analyze" -> {}. Unknown method -> error -32601 "Method not found" with data=<method>.
  Known-but-unimplemented standard LSP methods -> -32602 on bad params, else -32601 with NO data.

# Useful scratch assets already present
- /tmp/ref/lsp.py : python LSP client harness (class Client, helper initialize()). Import with
  \`sys.path.insert(0,'/tmp/ref')\`. Client(args=['--stdio'], cwd=..., env={...}) ; .send(obj),
  .send_raw(bytes), .wait_id(id), .drain(), .all(), .errs(), .close().
- /tmp/proj : minimal cargo package (Cargo.toml + src/main.rs)
- /tmp/ws   : cargo workspace with member crate1 (crate1/src/lib.rs)
- /tmp/loose.rs : a .rs file outside any cargo project
- /tmp/shim/rustowlc : bash shim logging argv/env to /tmp/shim/rustowlc.log

# Isolation notes
- The binary mutates $HOME/.rustowl. If your probe cares about that state, run with a private
  HOME (env HOME=/tmp/home-<yourname>) so you do not race other probes. VERIFY that HOME override
  actually relocates the runtime dir and report the answer.
- Create your own scratch dirs; never reuse another agent's.

# Your deliverable
Write a findings file (markdown) at the EXACT path given in your task, containing:
- Every command you ran, and its EXACT stdout/stderr/exit code (use fenced blocks; make
  byte-exactness explicit where it matters — trailing newlines, blank lines, two spaces after
  level names, etc.). Prefer python repr() dumps for anything subtle.
- Explicit statements of the rules/algorithms you infer.
- A "Gaps / unknowns" section.
Then return a concise summary (<= 60 lines) of the RULES you established (not the raw dumps).
Be exhaustive and precise: someone will re-implement byte-for-byte from your file.
`

phase('Probe')

const PROBES = [
  {
    key: 'cli-toplevel',
    file: '/tmp/ref/findings/cli-toplevel.md',
    task: `Map the top-level CLI argument parsing EXHAUSTIVELY (it is clap v4 derive; your job is to
capture every message byte-exactly). Cover at minimum:
- \`--help\` vs \`-h\` (identical? differences), \`--version\` vs \`-V\`, exit codes, which stream.
- No args at all; only \`--stdio\`; \`-q\`, \`-qq\`, \`-qqq\`, \`--quiet --quiet\`, \`-q -q\`.
- Unknown flags: \`--nope\`, \`-x\`, \`--stdi\` (prefix), \`--stdioo\`, \`--STDIO\`.
- Unknown subcommand: \`foo\`, \`Check\`, \`chec\` (does clap suggest? capture the exact
  "tip: a similar subcommand exists" wording if any).
- Unexpected positional at top level: \`./executable somefile\`.
- \`--\` handling: \`./executable -- foo\`, \`./executable --stdio -- --help\`.
- Combined: \`-qh\`, \`-hq\`, \`-Vq\`, \`-qV\`, \`--help --version\`, \`--version --help\`,
  \`--stdio --version\`, \`--version --stdio\`, \`check --help --version\`.
- Equals form: \`--quiet=1\`, \`--stdio=true\`.
- Repeated subcommands: \`check check\`, \`clean clean\`.
- Empty-string arg \`""\`.
- argv[0] sensitivity: symlink/copy the binary to names like \`rustowl\`, \`myapp\`, \`myapp.exe\`,
  \`weird name\`, and a name with a dash; see exactly what appears in "Usage:" lines and in
  \`--version\` output. (Copying/symlinking for OBSERVATION is allowed.)
- Does the top-level help ever show an "Arguments" section? Is there a hidden positional?
Also determine the ORDER of precedence when several conflicting flags are given.
Record the exact exit code for every case (clap uses 0 for help/version, 2 for usage errors).`,
  },
  {
    key: 'cli-subcommands',
    file: '/tmp/ref/findings/cli-subcommands.md',
    task: `Map subcommand argument parsing EXHAUSTIVELY, byte-exactly. Cover:
- \`check\`: the [path] positional (2+ positionals? \`check a b\`), \`--all-targets\`,
  \`--all-features\`, both, unknown flag, \`--all-targets=x\`, \`-a\`, \`--all\`(ambiguous prefix?),
  \`check -- --all-targets\`, \`check --\`, path that looks like a flag.
  NOTE: check actually tries to analyze; to keep output short you may point it at a
  non-.rs path so it fails fast, but you MUST also record the full output for a valid .rs path.
- \`clean\`: any positional/flag rejection (\`clean x\`, \`clean --foo\`).
- \`toolchain\`: bare \`toolchain\` (no subcommand) — what does it do/print/exit?
  \`toolchain foo\`, \`toolchain install --path\` (missing value), \`toolchain install --path=X\`,
  \`toolchain install --path X --skip-rustowl-toolchain\`, \`toolchain install extra\`,
  \`toolchain uninstall extra\`, \`toolchain uninstall --foo\`.
- \`completions\`: missing SHELL, invalid SHELL (exact error incl. possible-values list),
  case sensitivity (\`BASH\`, \`Bash\`), prefix (\`ba\`), extra args \`completions bash zsh\`,
  \`completions --help\` vs \`-h\` (note the long-form value help), \`completions bash --help\`.
- \`help\`: \`help\`, \`help check\`, \`help nonexistent\`, \`help check clean\`,
  \`help toolchain install\`, \`help completions\`, \`help help\`, \`help toolchain nonexistent\`.
- Are global flags (-q/--stdio) accepted after a subcommand? e.g. \`check -q\`, \`check --stdio\`,
  \`-q check\`, \`--stdio check\`.
Record exit codes + which stream for every case.`,
  },
  {
    key: 'completions',
    file: '/tmp/ref/findings/completions.md',
    task: `Deal with shell-completion generation. Steps:
1. Save the exact output of \`/workspace/executable completions <shell>\` for all six shells
   (bash, elvish, fish, powershell, zsh, nushell) to /tmp/ref/raw/comp_<shell>.txt.
   These files ALREADY exist at /tmp/ref/comp_<shell>.txt — verify they are current and copy
   them to /tmp/ref/raw/ too. Confirm byte determinism across runs (diff two runs).
2. Determine whether the generated script's embedded program name depends on argv[0]
   (run through symlinks named rustowl / myapp / etc.) or is a fixed string.
3. Determine whether the output goes to stdout, and whether a trailing newline is present
   (python repr the last 40 bytes of each).
4. In your findings file, include the COMPLETE verbatim text of the elvish, fish, nushell and
   powershell scripts (they are small) inside fenced blocks, and for bash and zsh include the
   complete text too — do not truncate. This file is the spec for re-generating them.
5. Note the exact byte length of each file.
Do NOT try to shorten or summarize the scripts.`,
  },
  {
    key: 'logging',
    file: '/tmp/ref/findings/logging.md',
    task: `Reverse-engineer the logging/output subsystem precisely.
- Exact timestamp format (capture many lines; is it always exactly 3 fractional digits? UTC 'Z'?).
- Level rendering: capture INFO/WARN/ERROR lines; count spaces after the level word
  (padding width). Try to provoke DEBUG/TRACE lines (see RUST_LOG below).
- Effect of -q, -qq, -qqq, -qqqq on which levels appear (use a run that produces INFO+WARN+ERROR,
  e.g. \`check <valid.rs>\` and a fresh HOME to get the sysroot-setup INFO lines).
- Effect of env vars: RUST_LOG=trace/debug/info/warn/error/off, RUST_LOG=rustowl=trace,
  RUST_LOG_STYLE, NO_COLOR, CLICOLOR, CLICOLOR_FORCE, TERM=dumb. Does it ever emit ANSI colors?
  Test with a pty (python pty module or \`script -qc\`) to see if a TTY enables colors, and dump
  the raw bytes to show any escape sequences.
- Confirm log lines go to stderr, and whether the two banner lines
  ("RustOwl v1.0.0-rc.1" / "This is an LSP server...") are stderr and whether -q suppresses them.
- Does the banner appear for subcommands (check/clean/toolchain/completions)? Exactly which
  invocations print it?
- Full list of distinct log messages and their module paths that you can provoke. Include the
  module path strings exactly (e.g. rustowl, rustowl::toolchain, rustowl::lsp::backend,
  rustowl::lsp::analyze).
- Whether stdout is used at all by non-LSP subcommands.`,
  },
  {
    key: 'toolchain',
    file: '/tmp/ref/findings/toolchain.md',
    task: `Reverse-engineer the \`toolchain\` subcommand and the runtime-dir/sysroot logic.
Use a PRIVATE HOME (e.g. HOME=/tmp/home-toolchain) and verify HOME override works.
- \`toolchain install\` from scratch: exact log sequence, exit code, what dirs/files it creates
  (list the full tree afterwards), the temp dir naming pattern (e.g. /tmp/.tmpXXXXXX — how many
  random chars, which alphabet, is it removed afterwards?).
- The download URL(s) it tries, in order. Does it try a second URL (e.g. GitHub releases for
  rustowlc) after the rustc tarball fails? Try making the FIRST download appear to succeed is
  impossible offline — instead try pre-creating files/dirs to skip steps and see what it does next
  (e.g. create a plausible sysroot layout with bin/rustc, bin/cargo, lib/ and see how far it gets).
  Report exactly which paths it probes by observing which pre-created files change behavior.
  Try at least: <sysroot>/bin/rustc, <sysroot>/bin/cargo, <sysroot>/lib/,
  <runtime>/bin/rustowlc, <runtime>/sysroot/<toolchain>/bin/rustowlc.
- \`toolchain install --path DIR\`: where does it install? exact behavior with relative/absolute
  paths, nonexistent parents, a path that is a file, permission-denied path.
- \`toolchain install --skip-rustowl-toolchain\`: difference in log output.
- \`toolchain uninstall\`: exact output/exit code when the runtime dir exists vs not; what exactly
  is removed (the whole ~/.rustowl? only sysroot?).
- Env vars: probe RUSTOWL_RUNTIME_DIR, RUSTOWL_HOME, RUSTOWL_SYSROOT, RUSTOWL_TOOLCHAIN_DIR,
  RUSTOWL_TOOLCHAIN, RUSTOWL_DIR, XDG_DATA_HOME, XDG_CACHE_HOME, CARGO_HOME, RUSTUP_HOME,
  RUSTUP_TOOLCHAIN, RUSTC, SYSROOT, TMPDIR — determine which ones change behavior and how
  (TMPDIR should relocate the temp dir; verify).
- The exact reqwest error text for a DNS failure, and whether the error text changes if the host
  resolves but refuses connection (add an /etc/hosts entry mapping static.rust-lang.org to
  127.0.0.1 in a container-writable way if possible — if /etc/hosts is not writable, say so;
  you may instead point it at a local host by other means if any env var allows it).
- Whether \`toolchain install\` is also implicitly triggered by \`check\`/LSP startup, and whether
  a failed install is retried on every run or cached.`,
  },
  {
    key: 'clean',
    file: '/tmp/ref/findings/clean.md',
    task: `Reverse-engineer the \`clean\` subcommand fully.
- Run it in: a cargo package (/tmp scratch copy), a cargo workspace, a plain empty dir, a dir with
  a bogus Cargo.toml, a nested subdir of a package, a dir with a target/ dir containing files,
  a read-only target dir. Capture exact stdout/stderr/exit code each time.
- Determine EXACTLY what it deletes: create marker files in target/, target/debug/,
  target/rustowl/, target/owl/, etc. and see which survive. Determine whether it uses
  \`cargo clean\` (shim a fake \`cargo\` on PATH that logs argv/env to a file to find out —
  remember the toolchain cargo is not found so it falls back to PATH \`cargo\`).
- Does it respect CARGO_TARGET_DIR / --target-dir / [build] target-dir in .cargo/config.toml?
- Does it print anything on success? Exit code on success and on failure.
- Does it need a Cargo.toml at all? What is the error when there is none?
Use a fresh scratch dir per case under /tmp/clean-<n>/.`,
  },
  {
    key: 'check-and-subprocess',
    file: '/tmp/ref/findings/check-subprocess.md',
    task: `Reverse-engineer the \`check\` subcommand's orchestration and the subprocess protocol.
This is the most valuable probe — be extremely thorough.
1. Shim BOTH \`cargo\` and \`rustowlc\` on PATH (bash scripts under your own /tmp/shim-check/ that
   append argv, cwd, and full env to per-call log files, and can be configured to emit chosen
   stdout/stderr and exit codes). Determine the EXACT sequence of subprocess invocations for
   \`check <file.rs>\`, including: full argv, cwd, and every env var that rustowl sets or modifies
   relative to its own environment (diff against \`env\` of the parent).
2. Determine what rustowl expects on rustowlc's STDOUT. Make the shim emit candidate payloads and
   observe the log messages. Establish: is it line-delimited JSON? Is there a magic prefix?
   You already know an empty stdout gives INFO rustowl::lsp::analyze "stdout closed".
   Try: plain text, \`{}\`, \`{"success":true}\`, JSON with keys you guess, multiple lines, very
   long lines, invalid JSON, and record the resulting log messages verbatim (they will reveal
   field names via serde error messages — that is the gold mine; e.g. "missing field \`xxx\`").
   Iterate: each serde error names the next required field. KEEP ITERATING until you have the
   full schema of the JSON that rustowlc must print. Report the full inferred JSON schema.
3. Determine how \`cargo metadata\` output is consumed: make the cargo shim return real
   \`cargo metadata\` output (call the real cargo) vs garbage vs error, and see the effect on
   "analyze N packages...".
4. Determine the effect of \`--all-targets\` and \`--all-features\` on the cargo/rustowlc argv.
5. Determine what happens when rustowlc exits nonzero, or emits stderr, or hangs (timeout?).
6. Record the exact "analyze N packages..." N for: single .rs file outside cargo, a package with
   1 bin, a package with bin+lib, a workspace with 2 members, and with --all-targets.
7. Report the exact panic text and the conditions that produce it.`,
  },
  {
    key: 'lsp-core',
    file: '/tmp/ref/findings/lsp-core.md',
    task: `Reverse-engineer the LSP transport and lifecycle precisely (use /tmp/ref/lsp.py).
- Header handling: is \`Content-Type\` accepted/required? Are LF-only line endings accepted?
  Extra unknown headers? Missing Content-Length? Content-Length larger/smaller than body?
  Multiple messages in one write? Message split across writes? A 0-length body?
- Response framing of the server's own messages: exact header block bytes (is there a
  Content-Type header? exactly \`\\r\\n\\r\\n\`?). Dump raw bytes with python repr.
- JSON serialization details: key ORDER in responses (capture raw text, not parsed), whether
  "jsonrpc" comes first, where "id" goes, whether nulls are omitted.
- Malformed input: invalid JSON body, valid JSON that is not a JSON-RPC object, array batch
  request, missing "jsonrpc", wrong jsonrpc version "1.0", id as string / float / null,
  missing method, params as array, notification with an id, request without params where params
  are required. Capture the exact error objects and codes.
- Lifecycle: request before \`initialize\` (e.g. rustowl/cursor first) — error code/message?
  Two \`initialize\` calls. \`shutdown\` then another request. \`exit\` notification (process exit
  code after shutdown vs without shutdown). Closing stdin without exit (exit code?).
  Also: what is the process exit code after \`exit\` with and without prior \`shutdown\`?
- Does the server send any requests/notifications to the client on initialize/initialized
  (window/workDoneProgress/create, $/progress, window/logMessage, client/registerCapability)?
  Capture them verbatim, in order, with and without client capabilities
  {"window":{"workDoneProgress":true}} in initialize params.
- Does initialize's response depend on the client's declared capabilities? Try several.
- Effect of \`rootUri\` vs \`rootPath\` vs \`workspaceFolders\` vs none on the startup log lines.
- Whether the process stays alive if stdin stays open with no data, and whether it emits anything
  periodically.`,
  },
  {
    key: 'lsp-features',
    file: '/tmp/ref/findings/lsp-features.md',
    task: `Reverse-engineer the LSP document/feature behaviors (use /tmp/ref/lsp.py).
Work inside a copy of a cargo workspace under /tmp/lspws/ so you can freely edit files.
- textDocument/didOpen, didChange (incremental, change=2 — test both range edits and full-text),
  didSave, didClose, willSave: what log lines and what analysis is triggered? Timing
  ("wait 100ms for rust-analyzer" debounce — measure it; is it 100ms after the last event?).
  Does rapid successive didChange coalesce? What exactly does "stop running analysis processes"
  correspond to?
- workspace/didChangeWorkspaceFolders, workspace/didChangeConfiguration,
  workspace/didChangeWatchedFiles: accepted? logged? errors?
- \`rustowl/cursor\`: determine the FULL params schema by sending wrong params and reading the
  serde error messages (-32602 "missing field \`x\`" / "invalid type: ..."). Iterate until you
  know every field and its type. Then determine the full RESULT schema: what are all possible
  values of "status"? (you have seen "error"; try to provoke others e.g. by not analyzing at all
  vs analyzing) What does "is_analyzed" depend on? Is "path" the raw uri path? How are
  file:// URIs with %20 / relative paths / non-file schemes handled? Windows-style paths?
- \`rustowl/analyze\`: determine its params schema the same way, what it returns, and what side
  effects/log lines it produces. Does it accept params at all?
- Enumerate which standard LSP requests are "known" to the server (they give -32602 on bad params
  instead of -32601 with data). Probe a broad list: textDocument/{hover,definition,completion,
  references,documentHighlight,documentSymbol,codeAction,formatting,rangeFormatting,rename,
  prepareRename,signatureHelp,inlayHint,semanticTokens/full,foldingRange,selectionRange,
  declaration,typeDefinition,implementation,codeLens,documentLink,colorPresentation,
  documentColor,linkedEditingRange,moniker,diagnostic}, workspace/{symbol,executeCommand,
  willCreateFiles,willRenameFiles,willDeleteFiles,diagnostic}, callHierarchy/*, typeHierarchy/*,
  completionItem/resolve, codeAction/resolve, codeLens/resolve, documentLink/resolve,
  inlayHint/resolve, workspaceSymbol/resolve, \$/setTrace, \$/cancelRequest, \$/logTrace,
  window/workDoneProgress/cancel, and a few nonexistent ones.
  Produce a definitive TABLE: method -> (known/unknown, error code, message, data present?).
- Notifications for unknown methods: is there any response? Any log?
- Whether analysis progress is reported to the client at all ($/progress); if the client declares
  window.workDoneProgress capability, does the server send window/workDoneProgress/create?
  The docs mention "The progress of analysis will be shown in your editor" — find the mechanism.`,
  },
  {
    key: 'misc-env',
    file: '/tmp/ref/findings/misc-env.md',
    task: `Grab-bag probe. Determine:
- Behavior with an empty environment (\`env -i /workspace/executable --version\`,
  \`env -i ... check x\`, \`env -i ... --stdio\`): what breaks, what messages appear (esp. when
  HOME is unset — where does the runtime dir go? does it error?).
- Behavior when $HOME is not writable / does not exist.
- Signals: SIGINT/SIGTERM to the LSP server — exit code, any cleanup, any log line.
- Exit codes for every subcommand in success and failure conditions; summarize in a table.
- Whether it writes anything to the current directory or the analyzed project (target/ dir?).
- Whether it creates lock files or sockets.
- Concurrency: run two \`check\` processes at once — any locking message?
- Very long paths, paths with spaces/newlines/unicode, symlinked paths, a .rs path that is a
  directory named "foo.rs", a .rs file that is unreadable (chmod 000), a .rs file that is a
  broken symlink, /dev/null, a named pipe. Capture exact "Invalid analysis target" vs other paths.
- Relative vs absolute path echoing in "Invalid analysis target: X" and "start analyzing X"
  (is the path canonicalized? tilde-expanded?).
- \`--stdio\` combined with subcommands (\`--stdio check x\`, \`check --stdio\`).
- stdin being a closed fd, a directory, /dev/null, a tty.
- Whether the LSP banner is printed before or after any log line (ordering/flush).`,
  },
]

const probeResults = await parallel(PROBES.map(p => () =>
  agent(`${SHARED}\n# Your task\nWrite your findings file to EXACTLY: ${p.file}\n\n${p.task}`,
    { label: `probe:${p.key}`, phase: 'Probe' })
))

phase('Critique')

const summaries = PROBES.map((p, i) => `## ${p.key} (file: ${p.file})\n${probeResults[i] || '(FAILED — no result)'}`).join('\n\n')

const critique = await agent(`${SHARED}
# Your task
You are a completeness critic. Ten probe agents just explored the binary. Here are their summaries:

${summaries}

Read their findings files under /tmp/ref/findings/ as needed.
Identify the TOP 8 remaining gaps that would prevent a byte-for-byte re-implementation of the
observable behavior. Focus on: contradictions between probes, un-probed surfaces, and any place a
probe said "unknown"/"gap". For each gap, write a concrete, self-contained probe instruction
(what commands to run, what to record).
Return ONLY a JSON array of 8 objects: [{"key":"short-slug","task":"detailed probe instruction"}]
No prose outside the JSON.`, { label: 'critic', phase: 'Critique' })

let gaps = []
try {
  const m = critique.match(/\[[\s\S]*\]/)
  gaps = JSON.parse(m[0])
} catch (e) {
  log('critic JSON parse failed; skipping gapfill')
}

phase('Gapfill')

const gapResults = gaps.length ? await parallel(gaps.slice(0, 8).map((g, i) => () =>
  agent(`${SHARED}\n# Your task\nWrite your findings file to EXACTLY: /tmp/ref/findings/gap-${i}-${(g.key||'x').replace(/[^a-z0-9-]/gi,'')}.md\n\n${g.task}`,
    { label: `gap:${g.key}`, phase: 'Gapfill' })
)) : []

return {
  probes: PROBES.map((p, i) => ({ key: p.key, file: p.file, summary: probeResults[i] })),
  critique,
  gaps: gaps.map((g, i) => ({ key: g.key, summary: gapResults[i] })),
}
