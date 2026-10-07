export const meta = {
  name: 'srgn-explore-1',
  description: 'Broad behavioral exploration of the srgn 0.14.1 binary across 16 dimensions',
  phases: [{ title: 'Explore', detail: '16 parallel explorers probing distinct behavior areas' }],
}

const PREAMBLE = `
You are reverse-engineering a CLI tool by BEHAVIORAL OBSERVATION ONLY.

The binary is at /tmp/orig-srgn (also /workspace/executable). It is \`srgn\` version 0.14.1,
"a grep-like tool which understands source code syntax and allows for manipulation in addition to search".

HARD RULES (violating them fails the whole project):
- You MAY ONLY run the binary with various inputs/flags and observe stdout/stderr/exit codes.
- You MUST NOT decompile, disassemble, run objdump/nm/strings/gdb/ghidra/readelf on it.
- You MUST NOT use strace/ltrace or any tracing tool on it.
- You MUST NOT search the web or any package registry for its source code. There is no network anyway.
- You MUST NOT read the binary's bytes (no cat/xxd/hexdump/grep on the binary file). It is execute-only anyway.
- Do NOT try to find or read the original project's source.

PRACTICAL RULES:
- ALWAYS prefix invocations with \`timeout 20\` and redirect stdin with \`</dev/null\` unless you are
  deliberately feeding stdin (otherwise the tool blocks reading stdin and you will hang).
- Work inside your own scratch directory: mkdir -p /tmp/probe/work/<YOURAREA> and cd there.
- Capture exit codes carefully (beware pipelines: use \`; echo rc=$?\` right after the command, not after a pipe).
- stderr contains timestamped log lines like "[2026-...Z ERROR srgn] ...". Record their exact text (minus timestamp).
- Use \`--stdout-detection force-pipe\` / \`force-tty\` to see both output modes.
- Be exhaustive and systematic. Prefer many small experiments. Record EXACT bytes of output
  (use cat -A or od -c when whitespace/escapes matter).

DELIVERABLE:
Write a thorough markdown notes file at /tmp/probe/notes/<AREA>.md documenting EVERYTHING you learned,
with exact commands and exact outputs, so that another engineer can reimplement the behavior byte-for-byte
without re-running the binary. Include a "Reimplementation rules" section stating the precise algorithm/format.
Be very detailed: include full tables, full lists, exact spacing.
Your final returned text should be a concise (<= 40 line) summary of key findings; the file holds the detail.
`;

const AREAS = [
  {
    key: 'cli',
    title: 'CLI parsing, help, errors, exit codes, env vars',
    detail: `Map the argument parser exhaustively (it is Rust clap v4 derive).
- Exact text of \`--help\`, \`-h\`, \`--version\`, \`-V\`. (Save full text verbatim into the notes file.)
- Error messages & exit codes for: unknown flag, invalid enum value, missing value, too many positionals,
  conflicting actions (e.g. -d with -u, -d with replacement, -s with others), invalid regex, unreadable query file.
- Does clap suggest "did you mean"? Exact format.
- Env var support: UPPER, LOWER, TITLECASE, NORMALIZE, REPLACE, SQUEEZE, INVERT, LITERAL_STRING,
  C, CSHARP, GO, HCL, PYTHON, RUST, TYPESCRIPT, *_QUERY, *_QUERY_FILE, GERMAN_PREFER_ORIGINAL, GERMAN_NAIVE.
  Test how boolean env vars are interpreted (empty string? "0"? "false"? "1"?).
- Aliases: --squeeze-repeats, --cs, --py, --rs, --ts.
- Combined short flags like -Sgu, -di, etc.
- Behavior of the \`--\` separator and positional REPLACEMENT.
- The "No actions specified, and not in search mode." error: exactly when is it emitted? Is it stderr? exit code?
  Test with -s alone, with only a language scope, with only regex, etc.
- Exit codes for --fail-any / --fail-none / --fail-no-files in various situations.
- What RUST_LOG and -v do to stderr output (format of log lines).`,
  },
  {
    key: 'regex',
    title: 'Regex engine semantics and supported syntax',
    detail: `The scope pattern is a Rust \`regex\` crate pattern. Determine exactly what syntax is accepted.
Test each and record accept/reject + error text:
- literals, ., ^, $, \\A, \\z, \\b, \\B
- classes [a-z], [^a-z], POSIX [[:alpha:]], \\d \\w \\s \\D \\W \\S, unicode \\p{L} \\p{Greek} \\pL
- repetition * + ? {n} {n,} {n,m} and lazy variants *? +? ??
- groups (), (?:), (?P<name>), (?<name>), alternation |
- inline flags (?i) (?m) (?s) (?x) (?U) and scoped (?i:...)
- lookaround (?=) (?!) and backreferences \\1 -- expect these to be REJECTED; record exact error message
- empty pattern, patterns matching empty string (e.g. \`a*\`, \`\\b\`, \`^\`) -- what happens with actions? Very important:
  how are zero-width matches handled by replacement/deletion/upper?
- multiline behavior: does ^ match at line starts by default? Does . match newline by default?
- Default scope is \`.*\` -- with input containing newlines, what does the default scope select?
  (feed multi-line stdin with -u and see.)
- Replacement variable expansion: $1, ${1}, $name, $0, $$, unknown group name, numeric out of range,
  literal $ followed by non-name char. Record exact semantics.
- -L/--literal-string: how is the literal treated? Are regex metacharacters escaped? Can replacement still use $1?
- Interaction: overlapping/adjacent matches, e.g. pattern \`aa\` on \`aaaa\`; pattern \`a|ab\` on \`ab\` (leftmost-first vs longest).
- Case-insensitivity with unicode.`,
  },
  {
    key: 'actions-core',
    title: 'Core actions: replace/delete/squeeze/upper/lower/titlecase/normalize, composition & ordering',
    detail: `- Determine the ORDER in which composable actions are applied when several are given
  (replacement, german, symbols, upper, lower, titlecase, normalize). Design experiments that disambiguate.
- Titlecase: exact algorithm. Test "hello world", "HELLO WORLD", "hello-world", "it's a test", "über alles",
  "foo_bar baz", "123abc def", multiple spaces, punctuation, apostrophes, unicode.
- Normalize: NFD then drop marks. Test "Müller", "café", "ﬁ" ligature, "①", "Å" (U+00C5 vs U+212B),
  Hangul, combining sequences already decomposed, "ẞ", "ß".
- Upper/lower: unicode specifics, "ß" -> "SS"? "İ"? Turkish? Greek final sigma?
- Squeeze: exact semantics with the scope; consecutive matches, matches separated by text,
  zero-width matches, squeeze with regex capturing, squeeze combined with other actions (is it allowed?).
- Delete: with/without explicit scope; is scope required?
- Replacement: interaction with scope=default (.*) and multiline input.
- --invert: exact effect for symbols; what happens when combined with german/upper/etc.
- Empty input, input without trailing newline, input with CRLF, binary/invalid UTF-8 input on stdin.
- Very important: is a trailing newline preserved/added?`,
  },
  {
    key: 'symbols',
    title: 'Symbols action: derive the COMPLETE substitution table',
    detail: `The -S/--symbols action replaces ASCII symbol sequences with Unicode.
Derive the COMPLETE mapping table by brute force: generate candidate ASCII sequences and test them.
Strategy: feed a large corpus of ASCII punctuation combinations through \`-S\` and diff input vs output.
E.g. all 1-, 2-, 3- and 4-character sequences over the set: ! = < > - + * / \\ ~ ^ | & : . , ( ) [ ] { } ? % # @ $
(that is a lot; do it in batches, one candidate per line, and compare lines).
Also test surrounded by spaces vs adjacent to letters/digits (does context matter? e.g. does \`a->b\` convert?).
Test known candidates: -> <- <-> => <= >= != == --> <-- <==> ==> <== +- -+ ...
Record the exact table: ASCII sequence -> Unicode char (give codepoints).
Then test --invert -S to get the reverse mapping (which Unicode chars map back to which ASCII).
Note any asymmetries. Also check longest-match/priority rules (e.g. \`<==>\` vs \`<=\` + \`=>\`).
Check whether replacement happens inside words/identifiers and whether spacing matters.`,
  },
  {
    key: 'german',
    title: 'German action: dictionary-driven umlaut/eszett replacement',
    detail: `-g/--german converts ASCII spellings (ae,oe,ue,ss / Ae,Oe,Ue,AE,OE,UE,SS) to ä,ö,ü,ß when the result
is a legal German word. Determine:
- The exact word-splitting rule (what counts as a word boundary; are digits/punctuation boundaries?).
- Casing handling: "AE"->"Ä", "Ae"->"Ä", "ae"->"ä"; what about mixed case?
- Compound-word support: test long compounds like "Abenteuergruesse", "Fussballstrasse", "Sonnenuebergaenge".
- --german-naive: does it convert everything unconditionally? Test on nonsense like "xaey", "Straesse", "Mueller".
  Determine exact naive algorithm (which sequences, which order, greedy?).
- --german-prefer-original: test "Busse"/"Buße", other ambiguous words.
- Words that already contain umlauts, mixed forms, words with both ae and ss.
- Behavior on non-German text: does "Caesar" become "Cäsar"? "aerodynamic"? "class"/"pass"/"less" (ss)?
  Build a list of ~200 common English words containing ae/oe/ue/ss and record which get converted -- this
  reveals the dictionary. Also test ~150 common German words.
- Try to characterize the dictionary: is it huge (full German wordlist) or small?
- Does it handle "ss"->"ß" at all? test "Strasse", "Fussball", "gross", "Grüsse", "weiss", "muessen".
- Interaction with --invert (docs say ignored) and with other actions.
IMPORTANT: an exact dictionary is impossible to extract; instead determine the ALGORITHM precisely and
produce as large a set of concrete input->output test vectors as you can (aim for 300+), saved in the notes.`,
  },
  {
    key: 'search-output',
    title: 'Search mode: exact output formats (tty vs pipe), ordering, edge cases',
    detail: `"Search mode" is when a language scope is given and NO actions are specified.
Determine exactly:
- The pipe format. Observed: \`birds.py:9:4-7:    age: int\` and \`(stdin):12:13-16;19-22:        self.age = age\`.
  Determine: are the numbers byte offsets or char offsets within the line? 0- or 1-based? line 1-based?
  Multiple ranges joined by ';'. What if a match spans multiple lines? What if the match is the whole line?
  What if a match is zero-width? What if the line has no trailing newline?
- The tty format (\`--stdout-detection force-tty\`): observed \`9:    age: int\`. Does it include the filename
  as a header line when multiple files? Test with 2+ files. Are there blank separators between files?
- Colors: run the binary under a real PTY (use \`python3 -c\` with the pty module, or \`script -qec\`) and
  record exact ANSI escape sequences for filename/line-number/match highlighting in both stdin and file modes.
  Also test NO_COLOR / CLICOLOR / TERM=dumb env vars.
- What is printed when a language scope matches but the regex doesn't?  When nothing matches at all?
- Ordering of results within a file and across files (with/without --sorted, with --threads 1).
- Does search mode apply when only a regex scope is given (no language scope)? Test \`srgn 'pattern'\` on files.
- What about a language scope + actions on stdin (non-search)? Confirm it prints the transformed whole input.
- Interaction of search mode with --fail-any / --fail-none.
- Are results deduplicated when two language scopes overlap? Test with -j.`,
  },
  {
    key: 'files',
    title: 'File discovery, globbing, gitignore, in-place editing, dry-run diff',
    detail: `- Without stdin and without -G: how are files discovered? Confirm it walks the CWD recursively.
  Which files are considered for a given language scope? Determine the EXACT file-extension list per language
  (create files with many extensions: .py .pyi .pyw .rs .go .ts .tsx .js .jsx .mts .cts .c .h .cs .tf .tfvars .hcl etc.)
  and see which are picked up by each --<lang> scope. Also test files with no extension but a shebang
  (e.g. \`#!/usr/bin/env python3\`) -- is shebang detection used?
- With no language scope and no -G and no stdin: what happens? (error? all files?)
- -G glob semantics: relative to CWD? recursive \`**\`? Does -G alone (no language scope) work? Combined with a
  language scope: intersection?
- Hidden files (-H), .gitignore (--gitignored), .git directory, nested .gitignore, global excludes.
  Create a git repo with .gitignore and test.
- --sorted vs default order; --threads 1.
- --fail-no-files exact behavior and exit code and message.
- In-place editing: with a language scope/regex AND an action, are files overwritten? Confirm content changes,
  and what is printed to stdout (docs: "Names of processed files are written to stdout"). Exact format.
  Are unchanged files printed? Test.
- --dry-run: exact diff output format (it says "rich diff ... similar to git diff with word diffing").
  Capture under a PTY too for colors. Record the exact layout: headers, line numbers, +/- markers, word-level marks.
- Symlinks, unreadable files, non-UTF8 files, empty files, very large files.
- Does it create backup files? Preserve permissions? Preserve trailing newline?`,
  },
  {
    key: 'lang-python',
    title: 'Python language scopes: exact ranges for every prepared query',
    detail: `For --python (alias --py), the prepared queries are: comments, strings, imports, doc-strings,
function-names, function-calls, class, def, async-def, methods, class-methods, static-methods, with, try,
lambda, globals, variable-identifiers, types, identifiers.
For EACH query, craft a rich Python sample file exercising many syntactic forms, then run
\`timeout 20 /tmp/orig-srgn --py <query> --stdout-detection force-pipe </dev/null\` in a dir with that file,
and ALSO run with an action (e.g. \`-- 'X'\` replacement or \`-d\`) on stdin to see EXACT byte ranges selected.
A great trick to get exact ranges: \`cat file | timeout 20 /tmp/orig-srgn --py <query> -- '<<<>>>'\`
replaces each scoped region so you can see precisely where regions start/end. Use that heavily.
Record for each query: what node kinds are captured, whether delimiters/quotes/decorators are included,
whether the whole block (with body) or just the header is captured, nesting behavior, overlapping regions.
Cover: comments (#), all string kinds (raw, byte, f-string with interpolation, triple-quoted, concatenated),
imports (import a.b.c, from x.y import z as w, relative imports, star), doc-strings (module/class/function,
first statement only?), function-names, function-calls (incl. method calls, chained, decorators?),
class (whole block incl. decorators?), def/async-def, methods (nested classes?), class-methods/static-methods
(decorator excluded), with (incl. async with?), try (incl. except/else/finally?), lambda, globals
(module-level variables -- LHS only or whole statement?), variable-identifiers, types (annotations, return types),
identifiers (everything?).
ALSO test the \`~<PATTERN>\` dynamic-query syntax if accepted for python (docs list it only for go/rust; verify).
Save the sample files' contents in the notes so they can be reused as test fixtures.`,
  },
  {
    key: 'lang-rust',
    title: 'Rust language scopes: exact ranges for every prepared query',
    detail: `For --rust (alias --rs). Queries: comments, doc-comments, uses, strings, attribute, struct,
struct~<PATTERN>, priv-struct, pub-struct, pub-crate-struct, pub-self-struct, pub-super-struct, enum,
enum~<PATTERN>, priv-enum, pub-enum, pub-crate-enum, pub-self-enum, pub-super-enum, enum-variant, fn,
fn~<PATTERN>, impl-fn, priv-fn, pub-fn, pub-crate-fn, pub-self-fn, pub-super-fn, const-fn, async-fn,
unsafe-fn, extern-fn, test-fn, trait, trait~<PATTERN>, impl, impl-type, impl-trait, mod, mod~<PATTERN>,
mod-tests, type-def, identifier, type-identifier, closure, unsafe.
Method: write a rich Rust sample exercising all forms; for each query run
\`cat sample.rs | timeout 20 /tmp/orig-srgn --rs <query> -- '<<<>>>'\` to see exact selected ranges,
and also without an action (search mode, force-pipe) to see the line/column ranges.
Determine precisely: are attributes/doc-comments included in item ranges? Are visibility modifiers included?
Does \`fn\` include the body? Does \`struct\` include the trailing semicolon for unit/tuple structs?
Are nested items matched? What exactly does \`unsafe\` capture? What does \`uses\` capture (path only)?
What do \`strings\` include (quotes? raw prefixes? interpolation braces?)?
For \`~<PATTERN>\` variants: is PATTERN a regex? case sensitivity? is it a full match or partial?
what is matched against (the item name)? test \`struct~^Foo$\`, \`fn~test\`, invalid regex, empty pattern.
Save the sample file contents in the notes.`,
  },
  {
    key: 'lang-go',
    title: 'Go language scopes: exact ranges for every prepared query',
    detail: `For --go. Queries: comments, strings, imports, expression, type-def, type-alias, struct,
struct~<PATTERN>, interface, interface~<PATTERN>, const, var, func, func~<PATTERN>, method, free-func,
init-func, type-params, defer, select, go, switch, labeled, goto, struct-tags.
Method: write a rich Go sample; for each query run
\`cat sample.go | timeout 20 /tmp/orig-srgn --go <query> -- '<<<>>>'\` and also search mode with force-pipe.
Determine exactly what is captured: does \`func\` include the whole declaration+body? does \`struct\` include
the \`type X struct {...}\` wrapper or only the struct literal type? what are \`expression\` captures (they say
"all of them!" -- check nesting/overlap behaviour, this is a great test of how overlapping ranges are merged).
\`imports\` -- the path string with quotes? the whole import spec? \`struct-tags\` -- backticks included?
\`type-params\` -- brackets included? \`method\` vs \`free-func\` vs \`init-func\`.
Also determine how OVERLAPPING/NESTED matches are merged into the final scope (very important for the
reimplementation): e.g. with \`expression\`, are nested expressions merged into one region?
Test multiple language scopes: \`--go func --go strings\` (intersect) vs with -j (union). Record precisely.
Save the sample file contents in the notes.`,
  },
  {
    key: 'lang-c-csharp',
    title: 'C and C# language scopes',
    detail: `For --c: comments, strings, includes, type-def, enum, struct, variable, function, function-def,
function-decl, switch, if, for, while, do, union, identifier, declaration, call-expression.
For --csharp (alias --cs): comments, strings, usings, struct, enum, interface, class, method,
variable-declaration, property, constructor, destructor, field, attribute, identifier.
Method: rich sample files; per query run \`cat sample.c | timeout 20 /tmp/orig-srgn --c <query> -- '<<<>>>'\`.
Determine exact captured ranges (do blocks include braces? does \`if\` include \`else\`? does \`function\`
include the body? is \`variable\` the declarator or the whole statement? does \`includes\` include the
\`#include\` token and the angle brackets/quotes?).
For C#: do class/method ranges include attributes and modifiers? Are strings' quotes included
(note: "incl. quotes, except for interpolated")? What exactly is \`attribute\` (names only)?
Which file extensions map to C (.c/.h?) and C# (.cs/.csx?).
Save the sample file contents in the notes.`,
  },
  {
    key: 'lang-ts-hcl',
    title: 'TypeScript and HCL language scopes',
    detail: `For --typescript (alias --ts): comments, strings, imports, function, async-function, sync-function,
method, constructor, class, enum, interface, try-catch, var-decl, let, const, var, type-params, type-alias,
namespace, export.
For --hcl: variable, resource, data, output, provider, required-providers, terraform, locals, module,
variables, resource-names, resource-types, data-names, data-sources, comments, strings.
Method: rich sample files (.ts/.tsx and .tf); per query run \`cat sample.ts | timeout 20 /tmp/orig-srgn --ts <query> -- '<<<>>>'\`.
Determine exact captured ranges. For TS: does \`function\` include arrow functions and function expressions?
Does \`class\` include decorators? Are template literals included in \`strings\` (with backticks? with \${} parts?)?
What is \`imports\` exactly (module specifier string incl. quotes?)? What is \`export\` (the whole statement?)?
For HCL: block ranges include the block header and braces? \`variables\` = variable declarations and usages
(e.g. \`var.foo\` references)? \`resource-names\`/\`resource-types\`/\`data-names\`/\`data-sources\` semantics --
test with \`resource "aws_s3_bucket" "my_bucket" {}\` and references like \`aws_s3_bucket.my_bucket.arn\`.
Also determine which extensions map to TS (.ts .tsx .mts .cts .js?) and HCL (.tf .tfvars .hcl .nomad?).
Save the sample file contents in the notes.`,
  },
  {
    key: 'custom-queries',
    title: 'Custom tree-sitter queries (--<lang>-query / --<lang>-query-file)',
    detail: `Determine the exact behavior of custom tree-sitter S-expression queries.
- Which captures are used to build the scope? Test a query with one anonymous pattern like \`(comment)\`,
  with an explicit capture \`(comment) @c\`, with multiple captures, with named captures used for filtering.
- Is there a special capture name that is ignored (e.g. \`@_ignore\` or a leading underscore)? Test \`@_foo\`.
- Are predicates supported? \`(#eq? @a "x")\`, \`(#match? @a "re")\`, \`(#not-eq?)\`, \`(#any-of?)\`? Test each.
- Error messages for invalid queries (syntax error, unknown node type, unknown field, unknown capture,
  unknown predicate) -- record exact stderr text and exit code.
- --<lang>-query-file: nonexistent file, empty file, comments in query file (;; comments).
- Interaction with prepared queries: can both --go and --go-query be given? What happens?
- Node kinds available: probe by trying various node names for each language and recording which are accepted.
  This reveals the underlying grammar node names (useful to know which grammar version). Try a broad list.
- Anonymous nodes like \`"func"\`, wildcards \`(_)\`, \`_\`, field syntax \`(function_declaration name: (identifier) @n)\`,
  alternations \`[(a) (b)]\`, quantifiers \`+ * ?\`, negated fields \`!field\`, anchors \`.\`.
Record which of these are supported and what they select.`,
  },
  {
    key: 'scope-composition',
    title: 'Scope composition: regex + multiple language scopes, -j, ordering, nesting/merging',
    detail: `Understand how scopes compose into the final set of ranges.
- Regex scope + language scope: the regex applies WITHIN each language region? Confirm with experiments where
  the regex could match across region boundaries.
- Multiple language scopes of the same language: \`--go func --go strings\` (intersect, left to right) vs \`-j\`.
- Multiple language scopes of DIFFERENT languages: \`--go func --python class\` -- error? allowed?
- Ordering: does the order of scope flags on the command line matter (with and without -j)?
- How are adjacent/overlapping ranges merged? Does the tool produce a set of disjoint ranges?
  Design an experiment with \`--go expression\` (nested expressions) plus a replacement action to see.
- What are the "in scope" vs "out of scope" segments -- confirm out-of-scope text is passed through verbatim.
- Squeeze with a language scope.
- Does the regex scope run before or after language scoping when both given, for the purposes of --fail-any/--fail-none?
- Empty language regions, regions with zero length.
- -j with a single scope (documented as no effect) -- confirm.
- Language scope with stdin: which language parser is used (from the flag, obviously) -- confirm that
  a .py file fed via stdin with --go produces a parse of garbage; what is output? Any error?`,
  },
  {
    key: 'completions-misc',
    title: 'Shell completions, logging, misc',
    detail: `- Capture the FULL exact output of \`--completions bash\`, \`--completions zsh\`, \`--completions fish\`,
  \`--completions elvish\`, \`--completions powershell\`. Save each verbatim to /tmp/probe/notes/completions/<shell>.txt
  (create the dir). Note: these are generated by clap_complete; the binary name inside will be "executable".
  Check whether the binary name comes from argv[0] (test by making a symlink named \`srgn\` to /tmp/orig-srgn
  in a temp dir and running that).
- Exit code and whether other args are ignored when --completions is given.
- \`-v\`, \`-vv\`, \`-vvv\`, \`-vvvv\`, \`-vvvvv\`: exact log line format and which levels appear. RUST_LOG interaction.
  Record several representative log lines (with the timestamp pattern described).
- Behavior when both stdin is readable AND -G is given.
- --stdin-detection force-readable / force-unreadable behavior.
- Any panics? Try weird inputs: extremely long lines, NUL bytes, invalid UTF-8 (stdin and files),
  huge numbers for --threads, --threads 0.
- Locale/env effects.
- Does it read any config file?`,
  },
  {
    key: 'fail-conditions',
    title: 'fail-any / fail-none / exit codes / stderr messages, and in-scope determination',
    detail: `Precisely determine exit codes and messages for all outcomes.
- --fail-any with: a match, no match, in search mode, in action mode, with files, with stdin.
- --fail-none likewise.
- Both together.
- What counts as "found in scope"? A zero-width match? The default \`.*\` scope on empty input?
  A language region that exists but the regex doesn't match inside it?
- Exact stderr messages (minus timestamp) and exact exit codes for each case.
- Exit codes for: invalid regex, invalid query, no files found with --fail-no-files, file IO error,
  invalid UTF-8 input, clap parse error, --help, --version.
- Does the tool still print output when it fails?
- Behavior in file mode when SOME files match and others don't.
Build a complete exit-code table.`,
  },
];

phase('Explore');

const results = await parallel(AREAS.map((a) => () =>
  agent(`${PREAMBLE}\n\nYOUR AREA: ${a.key} — ${a.title}\nWrite your notes to /tmp/probe/notes/${a.key}.md\n\nTASKS:\n${a.detail}`,
    { label: `explore:${a.key}`, phase: 'Explore' })
));

return results.map((r, i) => ({ area: AREAS[i].key, summary: r }));
