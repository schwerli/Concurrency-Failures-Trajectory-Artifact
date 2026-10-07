export const meta = {
  name: 'atlas-explore',
  description: 'Fan out behavioral probes of the Atlas CLI binary and write detailed notes per area',
  phases: [
    { title: 'Probe', detail: 'one agent per behavioral area, writes verbatim notes' },
    { title: 'Gaps', detail: 'completeness critic per area' },
  ],
}

const RULES = `
You are reverse-engineering a compiled CLI binary at /workspace/executable (it is the "atlas" CLI, community edition).

ABSOLUTE RULES (violating them fails the whole benchmark):
- NEVER decompile, disassemble, objdump, nm, readelf, strings, strace, ltrace, gdb, or otherwise statically analyze /workspace/executable. Only RUN it.
- NEVER search the internet or fetch/read the original project's source code. There is no network anyway.
- Do NOT install any package.
- You may read /workspace/README.md and /workspace/assets/*.

HOW TO WORK:
- Do all experiments inside your own scratch dir: /tmp/explore/<AREA> (mkdir -p it). Never write to /workspace except your notes file.
- The binary prints a one-time "Notice: This Atlas edition lacks support..." block to STDERR for commands that touch a database. It is suppressed if $HOME/.atlas/local-community.json holds a timestamp newer than 7 days. Before your runs, do:
  mkdir -p $HOME/.atlas && printf '{"v1.us":"2026-08-10T04:00:00Z"}' > $HOME/.atlas/local-community.json
  and re-run that command occasionally in case another agent removed it. When capturing stderr, be aware of this notice.
- sqlite works natively (no server). You can create sqlite DBs with python3's sqlite3 module. No mysql/postgres/docker servers are available, so for those drivers only error paths are observable — still record those exact error strings.
- ALWAYS capture: exact stdout, exact stderr, and exit code. Use a helper like:
    run(){ echo "\\$ atlas $*"; /workspace/executable "$@" >/tmp/o 2>/tmp/e; echo "exit=$?"; echo "--stdout--"; cat /tmp/o; echo "--stderr--"; cat /tmp/e; }
- Be exhaustive and systematic. Vary inputs. Probe error paths as hard as success paths. Test flag aliases, missing args, extra args, conflicting flags.
- Distinguish stdout vs stderr precisely — a reimplementation must match both.

DELIVERABLE:
Write a thorough markdown notes file to the exact path given below. Include VERBATIM command lines and VERBATIM outputs in fenced code blocks, plus a "RULES INFERRED" section stating the precise algorithm/format rules a reimplementer must follow, and an "OPEN QUESTIONS" section. Prefer completeness over brevity; this file is the ONLY thing the implementer will read. Do not summarize outputs — paste them.
Your final returned text should be a SHORT (<=15 line) summary of what you found plus the notes file path. The notes file carries the detail.
`

const AREAS = [
  {
    key: 'cli-framework',
    title: 'CLI framework: help, usage, errors, exit codes, completion',
    prompt: `Area: the CLI framework layer (it behaves like Go's cobra+pflag).

Probe and document EXACTLY:
1. Root command with no args, with -h, --help, "help", "help <cmd>", "help <bogus>".
2. Every command and subcommand's --help output, verbatim (atlas, schema, schema apply/clean/diff/fmt/inspect, migrate, migrate apply/diff/hash/import/lint/new/set/status/validate, version, license, completion + its 4 subcommands, help). Include the exact blank lines and trailing newlines. Note flag ordering in each block (it is NOT alphabetical for some).
3. Error behavior: unknown command ("atlas bogus"), unknown subcommand ("atlas schema bogus"), unknown flag ("atlas version --bogus"), flag needing a value with none ("atlas schema inspect -u"), too many positional args, invalid duration for --lock-timeout, invalid value for enum-ish flags (--tx-mode weird, --exec-order weird), --latest with negative/non-numeric. Record exact stderr text, whether usage is reprinted, and exit codes.
4. Does an error print "Usage:" block? Does it print to stdout or stderr? Is there an "Error: " prefix? Is there a trailing "exit status 1"? Check whether unknown-flag errors print the full usage or just a suggestion line.
5. Command suggestions: does "atlas migrat" suggest "migrate"? exact text.
6. Shorthand flags: -u, -s, -c, -f, -t?, -w? Check which shorthands exist per command (e.g. does "schema inspect -w" exist in this edition?).
7. Repeated flags: "-s a -s b", "--to x --to y", comma-separated "--schema a,b". Document StringSlice vs StringArray semantics (does "--var a=1 --var b=2" accumulate? does "--schema a,b" split on comma?).
8. Flag syntax forms: --flag=value, --flag value, -uvalue, -u value, combined shorthands, "--" terminator.
9. The 4 completion scripts: capture each COMPLETELY and verbatim into the notes (they are long; include all of them fully, in fenced blocks). Also "completion bash --help" etc, and the --no-descriptions flag if present.
10. "atlas version" and "atlas license" exact output; also check ATLAS_* env vars that change version output if you can find any (try ATLAS_VERSION, ATLAS_DEBUG, ATLAS_NO_UPDATE_NOTIFIER, ATLAS_TOKEN, ATLAS_TESTING...). Also check "atlas __complete <args>" hidden command output if it exists, and any other hidden commands you can discover by trying likely names (login, logout, whoami, docs, monitor, board, project, test, lint, cloud, registry, push, inspect, apply, deploy, dsn, env, config, completion).
11. Global flags -c/--config, --env, --var: which commands accept them (root? version? license?).

Notes file: /workspace/notes/cli-framework.md`,
  },
  {
    key: 'notice-and-state',
    title: 'Community-edition notice, ~/.atlas state, env vars, misc globals',
    prompt: `Area: the one-time "community edition" notice, the $HOME/.atlas state directory, and process-level behaviors.

Probe and document EXACTLY:
1. The full verbatim notice text (byte-exact, including trailing/leading blank lines and tabs). Which stream? Which commands trigger it and which do NOT (test: version, license, help, completion, schema fmt, migrate new, migrate hash, migrate validate, migrate status, schema inspect, schema diff, schema apply, schema clean, migrate lint, migrate import, migrate set, migrate apply, and each with a failing/invalid invocation). Is it printed before or after the command's own output? Is it printed when the command errors out early (e.g. bad flag)? Is it printed when the command errors during DB connection?
2. The state file $HOME/.atlas/local-community.json: exact JSON shape, key name, timestamp format (RFC3339 with nanoseconds?), file mode, dir mode. What happens if the dir is missing / unwritable / the file is corrupt JSON / the file has extra keys / a different key? Does the notice still print and does it rewrite the file? Confirmed TTL is 7 days -- verify precisely (test boundaries) and document.
3. What if HOME is unset or points somewhere unwritable? (run with env -u HOME, HOME=/nonexistent, HOME=/proc)
4. Are there other files written under $HOME/.atlas ever? (e.g. after various commands). List everything.
5. Environment variables the binary reacts to. Systematically try and document any observable effect: ATLAS_NO_UPDATE_NOTIFIER, ATLAS_DEBUG, ATLAS_TOKEN, ATLAS_VERSION, ATLAS_TESTING, ATLAS_PATH, ATLAS_CONFIG, ATLAS_ENV, ATLAS_PROJECT, ATLAS_EDITOR, EDITOR, VISUAL, NO_COLOR, TERM, CI, ATLAS_LOG_LEVEL, ATLAS_INSECURE, DO_NOT_TRACK.
6. Does the binary attempt network access? (there is no network here) Any timeouts/hangs/warnings? Test "atlas version" and "atlas migrate lint" etc for slow paths.
7. TTY/color behavior: is any output colored? Test piping vs not (script/pty if available via python3 pty). Do prompts appear when stdin is not a TTY? Specifically: "schema apply" without --auto-approve when stdin is a pipe/closed vs a pty (use python3's pty module to make a real tty). Document the exact interactive prompt rendering and what happens on non-tty.
8. Exit codes for interrupted/aborted prompts.

Notes file: /workspace/notes/notice-and-state.md`,
  },
  {
    key: 'fmt',
    title: 'schema fmt — the HCL canonical formatter',
    prompt: `Area: "atlas schema fmt" -- an HCL token-based canonical formatter (hclwrite-style). This must be reimplemented byte-exactly, so derive the complete algorithm.

Probe and document EXACTLY:
1. CLI surface: no args (current dir), one file, multiple files, a directory, nested directories (does it recurse?), non-.hcl files, missing path, unreadable file, empty file, file with only comments, non-UTF8 bytes, CRLF line endings, no trailing newline, BOM. Which files get printed to stdout (only changed ones?) and in what order (sorted? arg order?). Exit codes and error text.
2. Derive the FORMATTING ALGORITHM by constructing many small inputs and observing output. You must cover at minimum:
   - Indentation: nested blocks, how many spaces, blocks inside blocks, closing braces.
   - Attribute alignment: "=" alignment across consecutive lines; what breaks a group (blank line? comment line? nested block? a line without "="? a multi-line value?). Test groups where one name is much longer. Test alignment inside nested blocks.
   - Alignment of trailing line comments (# and //): are they aligned too? in groups?
   - Spacing rules around tokens: = , ( ) [ ] { } . : ? * + - / % ! && || == != < > <= >= "..." ${'${...}'} heredocs, splat, index, function calls, negative numbers, unary !, ternary, object literals { a = 1, b = 2 }, tuple literals, for-expressions, multi-line function args.
   - Blank line handling: are consecutive blank lines collapsed? blank lines at start/end of file/block? Is a trailing newline always added?
   - Comment handling: standalone # comments, // comments, /* */ block comments, comment before/after a block, comment at EOF without newline.
   - Heredocs (<<EOT / <<-EOT) - contents untouched? indentation of the terminator?
   - Single-line blocks: "a { b = 1 }" -> what happens? Is it kept on one line?
   - Malformed input: does it still format (token-based, tolerant)? Test unbalanced braces, stray tokens (see /workspace/assets/malformed_config.hcl and its output), "{{", ")" alone, unterminated string, unterminated heredoc, unterminated block comment. Record exact behavior and any error.
   - Very long lines / deeply nested / tabs used as input indentation.
3. Whether fmt reads or is affected by --config/--env/--var global flags, and whether "atlas.hcl" in cwd affects it.
4. Cross-check with /workspace/assets/unformatted.hcl -> formatted.hcl and with each other asset file (copy them into your scratch dir first).

Give a precise, implementable pseudocode of the formatter (tokenizer token classes + spacing table + indent rules + alignment rules) in the RULES INFERRED section. Be extremely detailed; include tricky counterexamples you found.

Notes file: /workspace/notes/fmt.md`,
  },
  {
    key: 'project-config',
    title: 'Project file (atlas.hcl): env blocks, variables, locals, functions, --var, --env',
    prompt: `Area: the Atlas project/config file (default file://atlas.hcl) and its HCL evaluation.

Probe and document EXACTLY (use "atlas schema inspect"/"migrate status"/etc. with --env to force config evaluation; a convenient trick is to make an env whose url points at a sqlite file so the command succeeds and you can see which values were used; another is to reference an undefined thing to see the error):
1. env blocks: "env \\"name\\" { ... }" and the unnamed/default "env { name = ... }" form. Multiple envs. Selecting with --env. What happens with --env missing/unknown? With a config file that has no matching env? With --env but no config file? With a config file present but no --env? Does an env named "local" get picked implicitly? Document exact error strings.
2. Which attributes an env block understands: url, dev, src, schema {src}, schemas, exclude, migration { dir, format, baseline, exec_order, lock_timeout, revisions_schema }, format { migrate { apply, diff, lint, status }, schema { apply, diff, inspect } }, lint { latest, git { base, dir }, destructive/... }, diff { skip { ... }, concurrent_index {...} }, vars? Test each and show how it changes behavior. Unknown attributes: error or ignored? Show exact error text for unknown blocks/attrs.
3. variable blocks: type (string, int, bool, list(string), map(string), number, any), default, description, nullable? Required variable with no value -> exact error. Passing values via --var name=value, repeated --var, --var with = in the value, wrong type (e.g. --var n=abc for type=int) -> exact error, unknown --var name -> error or ignored? Interpolation "${'${var.x}'}" in strings, and var used in lists.
4. locals blocks: multiple locals, referencing other locals, referencing vars, cycles -> exact error.
5. Built-in functions/objects available in the config: getenv(), atlas.env, atlas.cwd?, file()?, fileset()?, urlsetpath()/urlqueryset()? print()? env()? Try a wide set of HCL/terraform-ish stdlib functions and record which exist and their exact "function not found"/"Call to unknown function" errors: abs, ceil, floor, min, max, concat, join, split, replace, lower, upper, title, trim, trimspace, trimprefix, trimsuffix, substr, format, formatlist, jsonencode, jsondecode, keys, values, lookup, element, length, contains, coalesce, try, can, tostring, tonumber, tobool, tolist, toset, tomap, range, setunion, sort, distinct, flatten, merge, regex, regexall, sha1, sha256, md5, base64encode, base64decode, uuid, timestamp, file, fileexists, dirname, basename, abspath, pathexpand, templatefile, printf, urlescape, sprintf, str, int, bool.
6. Data sources: "data \\"...\\" \\"name\\" {}" blocks. Which types exist in this edition (e.g. external, external_schema, runtimevar, hcl_schema, sql, template_dir, remote_dir, aws_rds_token, gcp_cloudsql_token, composite_schema, entkit...)? For each, the exact error if unsupported/unknown. Test at least: data "external" (runs a command!), data "hcl_schema", data "sql", data "template_dir", data "composite_schema", data "remote_dir", data "runtimevar", data "external_schema". Document those that work with full examples.
7. The -c/--config URL forms: file://path, path without scheme, absolute vs relative, missing file (error text), directory, "atlas://..."? Also test the default behavior when ./atlas.hcl exists vs not.
8. Malformed config: exact diagnostics format (file:line,col-col: Summary; Detail?). Use /workspace/assets/malformed_config.hcl. Show several kinds of HCL syntax and semantic errors and their exact rendering, including multiple diagnostics at once.
9. Precedence: CLI flags vs env block values (e.g. --url on CLI and url in env). Which wins? Any "flag ... is not allowed with env" errors?
10. "for_each" in env blocks (multi-tenancy) - supported here? exact error/behavior.

Notes file: /workspace/notes/project-config.md`,
  },
  {
    key: 'sqlite-inspect',
    title: 'schema inspect against SQLite: HCL output for every feature',
    prompt: `Area: "atlas schema inspect" with sqlite URLs -- the inspection -> Atlas HCL rendering.

Build many sqlite databases with python3's sqlite3 module (or by feeding SQL to a temp db) and record the exact HCL emitted. Cover:
1. URL forms: sqlite://file.db, sqlite://./file.db, sqlite://relative/path.db, sqlite:///abs/path.db, sqlite://file?_fk=1, sqlite://dev?mode=memory, sqlite://:memory:, libsql://?, "sqlite://file:ex1.db?_fk=1", missing file (does it create it?), a directory, a non-sqlite file, permission denied. Exact errors.
2. Empty database output. Database with only one table. Ordering of tables in output (creation order? name order?) and where the "schema" block appears (before/after tables).
3. Column types: INTEGER, INT, TINYINT, SMALLINT, BIGINT, UNSIGNED BIG INT, INT2, INT8, CHARACTER(20), VARCHAR(255), VARYING CHARACTER(255), NCHAR(55), NATIVE CHARACTER(70), NVARCHAR(100), TEXT, CLOB, BLOB, no-type column, REAL, DOUBLE, DOUBLE PRECISION, FLOAT, NUMERIC, DECIMAL(10,5), BOOLEAN, DATE, DATETIME, JSON, uuid, custom/unknown type names, types with weird casing/spacing. Show the exact "type = ..." rendering for each.
4. null/not null, DEFAULT values (numeric, string, expression like CURRENT_TIMESTAMP, (datetime('now')), NULL, hex blobs, negative numbers, TRUE/FALSE), COLLATE, generated columns (STORED and VIRTUAL), AUTOINCREMENT, PRIMARY KEY variations (inline, table-level, composite, DESC/ASC, conflict clauses), WITHOUT ROWID, STRICT tables.
5. Indexes: unique, non-unique, partial (WHERE), expression indexes, DESC columns, COLLATE in index, auto-indexes (sqlite_autoindex -- are they hidden?), index on multiple columns.
6. Foreign keys: single/multi column, ON DELETE/UPDATE actions (CASCADE, SET NULL, SET DEFAULT, RESTRICT, NO ACTION), self references, DEFERRABLE. Exact "foreign_key" block rendering, including the constraint name Atlas invents.
7. CHECK constraints (table-level and column-level), named checks.
8. Views, triggers -- community edition says unsupported; document exactly what happens (ignored silently? warning?).
9. --schema / -s flag with sqlite (schema is "main"): valid, invalid, multiple; attached schemas? "temp"?
10. --exclude patterns: table globs, "table.column", "*.*", "schema.table", multiple patterns; and --include if present. Document exact semantics with examples.
11. sqlite_sequence and other internal tables: hidden?
12. Comments on tables/columns (sqlite has none) -- skip.
13. Behavior when the db has a syntax-unparseable schema entry.

Notes file: /workspace/notes/sqlite-inspect.md`,
  },
  {
    key: 'format-templates',
    title: '--format Go templates: sql, json, hcl, mermaid and friends',
    prompt: `Area: the "--format" flag (a Go text/template) on schema inspect / schema diff / schema apply / migrate status / migrate apply / migrate lint / migrate diff.

Probe and document EXACTLY:
1. For "schema inspect --format": try '{{ json . }}', '{{ sql . }}', '{{ sql . "  " }}', '{{ hcl . }}', '{{ mermaid . }}', '{{ . }}', '{{ json . "" "  " }}', '{{ json .Schemas }}', plus bogus '{{ nope . }}' and syntax errors '{{'. Record exact output and errors. Determine the full JSON shape for a rich schema (all field names, nesting, omitted fields) -- this is critical; dump json for a database exercising many features (types, pk, fk, index, unique, check, default, generated) and paste it verbatim (pretty-print with python json.tool if the raw is one line, but ALSO paste the raw).
2. What template funcs exist? Try: json, sql, hcl, mermaid, upper, lower, title, split, join, trim, quote, sprintf, printf, len, index, slice, default, ternary, base64, yaml, table, list, indent, nindent, dict, hasPrefix, hasSuffix, contains, replace, red/green/yellow/cyan (color helpers), and Go builtins (and, or, not, eq, ne, lt, le, gt, ge, print, println, printf, len, index, slice, call, html, js, urlquery, range, with, if, define, template, block). Record exact "function X not defined" error text.
3. Determine the exact data model exposed to templates for each command (field names accessible). For schema inspect it's the Realm/Schema; for migrate status and migrate apply it's a report struct; for migrate lint a report. Enumerate fields by trying '{{ printf "%+v" . }}' and '{{ json . }}' and by triggering "can't evaluate field X" errors to learn type names (paste the exact Go type names shown in errors -- e.g. "executing \\"\\" at <.Foo>: can't evaluate field Foo in type *cmdlog.SchemaInspect"). This is very valuable: record every Go type name that appears in template errors.
4. Default (no --format) output for each command, contrasted with the template output.
5. mermaid output for a schema with FKs, PKs, and various types -- paste verbatim.
6. sql output: statement ordering, terminators, comments like "-- create \\"users\\" table", quoting/escaping of identifiers for sqlite, indentation argument behavior.
7. Whether --format affects exit code or stderr.
8. Trailing newline behavior of templated output.

Notes file: /workspace/notes/format-templates.md`,
  },
  {
    key: 'schema-diff-apply',
    title: 'schema diff / schema apply / schema clean against SQLite',
    prompt: `Area: "atlas schema diff", "atlas schema apply", "atlas schema clean" with sqlite (and HCL/SQL file states).

Probe and document EXACTLY:
1. schema diff --from/--to combinations: sqlite db <-> sqlite db, sqlite db <-> file://schema.hcl (needs --dev-url), file://a.hcl <-> file://b.hcl, file://schema.sql <-> db, file://migrations dir <-> db, multiple --to URLs merged. Record the exact SQL emitted, statement order, and the "Schemas are synced, no changes to be made." style message when equal (get the exact wording).
2. Every kind of change: create table, drop table, add column, drop column, modify column type, add/drop not-null, change default, rename? (does it detect renames), add/drop index, add/drop unique, add/drop primary key, add/drop foreign key, add/drop check, generated columns. For sqlite many of these require table rebuild -- capture the exact multi-statement rebuild SQL Atlas emits (PRAGMA foreign_keys=off, create new table, INSERT INTO SELECT, drop, rename, etc.) verbatim.
3. Ordering/format of the printed plan; the "-- " comment lines; blank lines between statements; whether output goes to stdout.
4. schema apply: without --auto-approve on a non-TTY (exact error/behavior), with --auto-approve, with --dry-run, with both, --tx-mode none/file/bogus, --lock-timeout, --plan (unsupported? exact error), --edit (no editor -> error text). The "-- Planned Changes:" header format. The output when there are no changes. Exit codes.
5. The interactive approval prompt: run under a real pty using python3's pty module and capture the raw bytes/escape sequences of the prompt ("Use the arrow keys to navigate: ..." / "? Are you sure?:" / "Apply"/"Abort"). Document how it renders and what selecting Abort prints and its exit code.
6. schema clean: on a db with tables, --dry-run, --auto-approve, exact SQL, exact confirmation text, on empty db (exact message), exit codes.
7. Errors: missing --to, missing --url, --to a nonexistent file, HCL schema that fails to parse (exact diagnostics), HCL referencing an undefined table/column, schema name mismatch between HCL ("schema \\"test\\"") and sqlite ("main") -- exact error, --dev-url required errors (exact wording), unsupported driver in --dev-url (docker://mysql/8/dev with no docker -> exact error), and "--from"/"--to" with unknown scheme.
8. --exclude/--include on diff/apply.
9. HCL schema files: what a minimal valid sqlite HCL schema looks like (schema "main" {} + table blocks), and how "schema = schema.main" references work.

Notes file: /workspace/notes/schema-diff-apply.md`,
  },
  {
    key: 'migrate-dir',
    title: 'migrate new / hash / validate / import + dir formats + atlas.sum',
    prompt: `Area: migration directory handling: "atlas migrate new", "migrate hash", "migrate validate", "migrate import", --dir and --dir-format.

NOTE: the atlas.sum algorithm is already known and confirmed:
  running := sha256.New(); for each file in order: running.Write(name); running.Write(content); fileHash := base64.Std(running.Sum(nil))
  total := sha256(); for each entry: total.Write(name); total.Write(fileHash string bytes); sumLine := "h1:"+base64.Std(total.Sum(nil))
  atlas.sum = "h1:<total>\\n" then one line per file: "<name> h1:<fileHash>\\n"
Verify this and find the edge cases (e.g. the "atlas:sum ignore" directive, file ordering, which files are included).

Probe and document EXACTLY:
1. migrate new: with and without a name, name with spaces/slashes/unicode/very long, timestamp format of the generated filename (UTC? local? format string), what's inside the new file (empty? header?), atlas.sum updated?, --dir pointing to a nonexistent dir (created? error?), --dir with file:// vs plain path vs absolute, --edit without EDITOR.
2. migrate hash: on a clean dir, after manual edits, on an empty dir, on a dir with no atlas.sum, on a dir with extra non-.sql files (.txt, subdirectories), on a dir where atlas.sum is corrupt. Exact stdout/stderr/exit. Are files sorted by name? What about a file whose name doesn't start with a version number?
3. migrate validate: in-sync, out-of-sync (exact error text -- this is a well-known message; capture it byte-exactly), missing atlas.sum, extra file, deleted file, modified file, checksum line reordered, with --dev-url sqlite://... to validate SQL semantics (and a file with invalid SQL -> exact error), empty dir, missing dir.
4. The "atlas:sum ignore" / "atlas:sum" directive inside a migration file: exact syntax ("-- atlas:sum ignore"?) and effect on hash/validate.
5. Other "-- atlas:" directives you can discover: nolint, txmode, delimiter, checkpoint, import? Test "-- atlas:delimiter" and "-- atlas:txmode none" and "-- atlas:nolint" and "-- atlas:import".
6. --dir-format variants: atlas, golang-migrate, goose, flyway, liquibase, dbmate. For each, test "migrate new x" and "migrate hash" and "migrate validate" and document the file naming and whether atlas.sum is used. Exact error for an unknown --dir-format.
7. migrate import: from each supported source format to atlas format; exact errors when unsupported; what files are produced. Try --from "file://x?format=liquibase" etc.
8. Statement splitting: how are multi-statement .sql files parsed (semicolons, strings, comments, BEGIN...END blocks, triggers)? Use "migrate validate --dev-url sqlite://dev?mode=memory" or "migrate apply --dry-run" to observe splitting. Document the delimiter rules and the "-- atlas:delimiter" directive.
9. Directory URL forms and errors: --dir "file://migrations" default, missing dir error text, a file instead of a dir, "?format=" query params on --dir.

Notes file: /workspace/notes/migrate-dir.md`,
  },
  {
    key: 'migrate-apply-status',
    title: 'migrate apply / status / set + revisions table',
    prompt: `Area: "atlas migrate apply", "atlas migrate status", "atlas migrate set" against sqlite, and the atlas_schema_revisions table.

Probe and document EXACTLY:
1. migrate status on: an empty db + empty dir, empty db + 2 pending files, partially applied, fully applied, dirty state, out-of-sync sum. Capture the exact multi-line report format (the "Migration Status:", "-- Current Version:", "-- Next Version:", "-- Executed Files:", "-- Pending Files:" lines) byte-exactly including colors/indentation. Also with --format templates.
2. migrate apply: dry-run vs real, with an [amount] argument, 0, negative, non-numeric, more than available; output format byte-exactly (the "Migrating to version X (N migrations in total):", "  -- migrating version X", "    -> CREATE TABLE ...", "  -- ok (durationms)", "  -------------------------", "  -- N migrations", "  -- N sql statements" summary block). Capture with a fake-stable duration if possible; note that durations vary -- describe the exact format string used for durations (e.g. "1.234ms", "(1 migrations)"). Test failure mid-file (a file with bad SQL): exact error report, whether the revision is recorded as failed, exit code, and the follow-up "migrate apply" behavior and "migrate status" output.
3. The revisions table: dump its exact CREATE TABLE DDL from sqlite (query sqlite_master after an apply) and the exact rows inserted (all columns and values, including hash/type/partial_hashes/operator_version). Document the column types and the "operator_version" string value.
4. --revisions-schema with sqlite, --baseline, --allow-dirty, --tx-mode none/file/all/bogus, --exec-order linear/linear-skip/non-linear/bogus, --lock-timeout. Document behavior/errors for each.
5. migrate set: with a version, with no version, an unknown version, on an empty db, after apply; what it writes to the revisions table; exact output text (it prints a summary of changes like "Current version is ..."?). Exit codes.
6. Error strings: "connected database is not clean", "migration directory is not in sync", "sql/migrate: ...", "checksum mismatch", missing --url, bad url. Capture verbatim.
7. Whether "migrate apply" prints the community notice, and where.
8. Idempotence: running apply twice; the "No migration files to execute" message wording.

Notes file: /workspace/notes/migrate-apply-status.md`,
  },
  {
    key: 'migrate-diff-lint',
    title: 'migrate diff / migrate lint',
    prompt: `Area: "atlas migrate diff" and "atlas migrate lint" with sqlite.

Probe and document EXACTLY:
1. migrate diff with --dev-url "sqlite://dev?mode=memory" and --to "file://schema.hcl" / "file://schema.sql" / a sqlite db URL / "file://other_migrations". With and without a [name] arg. The generated filename format, file contents (including the "-- Create \\"users\\" table" style comments -- note exact capitalization), and the atlas.sum update. Output printed to stdout/stderr (is anything printed on success?). When there is no diff: exact message and exit code.
2. All change kinds again but as generated migration files: create/drop table, add/drop/modify column, indexes, fks, checks. Paste the generated SQL verbatim.
3. --qualifier, --format templates, --edit, --dir-format variants, -s/--schema, --lock-timeout.
4. Errors: missing --dev-url (exact text), missing --to, --to with a broken HCL (diagnostics), dev url same as target, dirty dev database (exact error text -- "connected database is not clean" style), sum out of sync before diff, name with invalid chars.
5. migrate lint: --latest N, --git-base (in a real git repo you create), --dir, --dev-url required error. Default text report format byte-exactly for: no files, a clean file, a file that triggers analyzers. Trigger as many analyzers as you can with sqlite and record the exact diagnostic text and codes (e.g. destructive changes DS101/DS102/DS103, backward-incompatible BC101/BC102, data-dependent MF101/MY101/PG101, naming NM101, concurrent index PG101...). Show the exact report layout including the file heading, the "-- " prefixes, and the summary/footer. Exit code when errors/warnings are found.
6. lint --format '{{ json . }}' full JSON shape (paste verbatim) and the Go type names visible in template errors.
7. The lint config in atlas.hcl: "lint { destructive { error = true } ... }" -- which analyzers are configurable, exact attribute names, and the effect (test error=true making exit code nonzero). Also "lint { latest = 1 }" and "lint { git { base = ... dir = ... } }" and "lint { review = ... }" and "lint { rule ... }".
8. Whether lint requires a git repo and what it does when --git-base is set but the dir is not a repo.

Notes file: /workspace/notes/migrate-diff-lint.md`,
  },
  {
    key: 'hcl-schema-lang',
    title: 'Atlas HCL schema language (schema/table/column/... blocks) for sqlite',
    prompt: `Area: the Atlas DDL HCL language used in "--to file://schema.hcl" and produced by "schema inspect".

Use "atlas schema diff --from file://empty.hcl --to file://schema.hcl --dev-url sqlite://dev?mode=memory" (or schema apply --dry-run) to exercise parsing, and "schema inspect" to see the canonical rendering. Probe and document EXACTLY:
1. Top-level blocks recognized: schema, table, view?, enum?, function?, trigger?, materialized?, index?, composite?, sequence?, domain?, and their support in this (community) edition. Exact error text for unsupported/unknown blocks.
2. table block: schema (reference), comment, charset/collate (sqlite?), column, primary_key, index, foreign_key, check, partition?. Attribute/block ordering requirements.
3. column block: null, type, default, as (generated: expr/type), comment, collate, auto_increment?, identity?, unsigned?. Type expressions for sqlite: int, integer, text, varchar(255), blob, real, numeric(10,2), bool, boolean, datetime, date, time, timestamp, json, uuid, decimal, float, double, sql("custom type"). Document which type names are accepted and how each round-trips; exact errors for unknown types and bad arities.
4. Reference syntax: schema.main, table.users, column.id, table.users.column.id, index.x, and errors for dangling references (exact diagnostics).
5. primary_key { columns = [...] }, index { columns/on { column, desc, expr }, unique, where, comment }, foreign_key { columns, ref_columns, on_update, on_delete } with the enum spellings (CASCADE / NO_ACTION / SET_NULL / SET_DEFAULT / RESTRICT -- note underscores vs spaces), check { expr, comment }.
6. Variables/locals/functions inside a SCHEMA hcl file (not the project file): are variable blocks allowed? Is "${'${var.x}'}" evaluated? Does --var apply? What about sql() and other functions?
7. Multiple --to files merged; a directory of .hcl files; conflicting definitions; duplicate table names -> exact error.
8. .sql schema files: how a "--to file://schema.sql" is parsed (needs --dev-url), multiple statements, comments, and errors.
9. Round-trip fidelity: inspect a rich sqlite db, save the HCL, apply it to an empty db, re-inspect, and diff -- report any differences.
10. Exact diagnostic rendering for HCL errors in schema files (format of file:line,col ranges, "Summary" and "Detail" lines, multiple errors).

Notes file: /workspace/notes/hcl-schema-lang.md`,
  },
  {
    key: 'urls-drivers',
    title: 'URL/DSN parsing and driver dispatch (all drivers, error paths)',
    prompt: `Area: how the CLI parses --url/--dev-url/--to/--from/--dir URLs and dispatches to drivers.

There are no mysql/postgres/docker servers available, so focus on parse-time behavior and connection error messages. Probe and document EXACTLY:
1. Which schemes are recognized: sqlite, sqlite3?, libsql?, mysql, maria, mariadb, postgres, postgresql, sqlserver, mssql, azuresql, clickhouse, redshift, tidb, cockroach, crdb, docker, file, atlas, ent, gorm, sqlalchemy, django, ... For each: the exact error you get (unknown driver vs connection refused vs "not supported in community edition"). Use a short --lock-timeout / expect DNS failures quickly; if something hangs, note the hang and use timeout.
2. Exact error text for: empty --url, url with no scheme ("foo.db"), unknown scheme ("bogus://x"), "mysql://" with no host, malformed url ("://"), url with spaces, percent-encoded credentials, query params.
3. sqlite specifics: how the path is derived from the URL (host vs path, "sqlite://file.db" vs "sqlite:///file.db" vs "sqlite://./x.db"), "?mode=memory", "?cache=shared", "?_fk=1", "?_journal_mode=WAL", "file:" prefixed forms, ":memory:", multiple query params, unknown query params (error or ignored?). Does it create the file if missing? Which pragmas does it appear to set (observe via effects, e.g. whether FKs are enforced on apply)?
4. docker:// URLs: docker://mysql/8/dev, docker://postgres/15/test, docker://sqlite? -- exact error without docker installed. Also "docker+postgres://".
5. file:// URLs for --to/--from: relative/absolute, missing file, a directory, a directory with mixed .hcl/.sql, "?format=" params, "file://migrations?version=20220101" (a versioned dir state), multiple files.
6. "atlas://" cloud URLs: exact error in community edition (probably about login/token). Test --dir "atlas://repo" and --to "atlas://..." and "--plan atlas://...".
7. --dev-url requirement rules: which commands/state combinations require it and the exact error message when missing.
8. Any URL normalization visible in error messages (e.g. redacted passwords).

Use "timeout 20" around anything that may hang, and record hangs.

Notes file: /workspace/notes/urls-drivers.md`,
  },
]

phase('Probe')
const results = await pipeline(
  AREAS,
  a => agent(RULES + '\n\n' + a.prompt, { label: `probe:${a.key}`, phase: 'Probe' }),
  (res, a) => agent(RULES + `

You are a COMPLETENESS CRITIC + gap-filler for the notes file /workspace/notes/${a.key}.md (area: ${a.title}).

1. Read that notes file.
2. Identify what is MISSING, vague, or unverified — specifically anything a reimplementer would have to guess at: unrecorded exact strings, unexplored flag combinations, undocumented error paths, algorithms described in prose instead of precise rules, "TODO"/"probably"/"seems" hedges, and any claim not backed by a pasted verbatim output.
3. Actually RUN the missing experiments yourself against /workspace/executable and APPEND a new section "## GAP-FILL (round 2)" to the SAME notes file with verbatim commands + outputs and corrected rules. Fix any wrong claims in place (edit them) and note the correction.
4. Be aggressive: aim to close at least 15 concrete gaps. Prioritize byte-exact strings and algorithmic precision.

Return a short (<=12 line) list of the gaps you closed.`, { label: `gaps:${a.key}`, phase: 'Gaps' })
)

return { areas: AREAS.map(a => a.key), probeCount: results.length }
