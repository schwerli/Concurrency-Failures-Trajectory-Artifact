export const meta = {
  name: 'cppcheck-probe',
  description: 'Exhaustively probe the reference cppcheck binary behavior across CLI, output formats, and checks',
  phases: [
    { title: 'Probe', detail: 'parallel agents probe distinct behavior areas' },
    { title: 'Synthesize', detail: 'merge findings into a build spec' },
  ],
}

const COMMON = `
You are reverse-engineering a compiled binary by BLACK-BOX OBSERVATION ONLY.

The binary is /workspace/executable  (it is Cppcheck 2.19 dev, a C/C++ static analyzer).
IMPORTANT RULES YOU MUST OBEY:
- NEVER decompile, disassemble, objdump, nm, strings, gdb, strace, or ltrace /workspace/executable. It is mode ---x--x--x (not readable) anyway.
- NEVER search the web or package registries for cppcheck source code, and never install cppcheck.
- Learn ONLY by running /workspace/executable with inputs and observing stdout/stderr/exit code.

SETUP NOTES:
- A stub library config already exists at /workspace/cfg/std.cfg containing:
    <?xml version="1.0"?>
    <def format="2"/>
  The binary REQUIRES <exedir>/cfg/std.cfg to exist or it refuses to analyze. Do NOT delete it.
  Do NOT modify /workspace/cfg/std.cfg unless your assigned area is specifically about library files
  (and if you do, restore it to exactly the two lines above when finished).
- Work in your own scratch dir: mkdir -p /tmp/probe/work-<YOURAREA> and cd there.
- Capture exact bytes. Use  cmd > out.txt 2> err.txt ; echo "exit=$?"  and then \`cat -A\` when whitespace matters.
- Distinguish stdout vs stderr precisely — this matters enormously.

DELIVERABLE:
Write a thorough markdown report to /tmp/probe/<AREA>.md containing VERBATIM observed
input->output pairs (exact command, exact stdout, exact stderr, exact exit code) plus your
inferred rules. Be exhaustive and precise; this report is the ONLY specification another
engineer will have to reimplement this behavior byte-for-byte. Prefer many concrete examples
over prose. Quote outputs in fenced code blocks.

Then RETURN (as your final message) a compact but information-dense summary of the hard rules you
established, including the most important exact strings/formats. Max ~2500 words.
`

const AREAS = [
  {
    key: 'cli-parsing',
    prompt: `AREA: command-line argument parsing and validation.

Probe exhaustively:
- --version, -h/--help exit codes and which stream they go to. Behavior with no args at all. With only options and no files.
- Every option listed in --help: what happens with a missing value, an empty value, an invalid value. Record the EXACT error text.
  e.g. --enable=, --enable=bogus, --platform=bogus, --std=bogus, --output-format=bogus, --report-type=bogus,
  --showtime=bogus, --check-level=bogus, --max-configs=0, --max-configs=x, -j0, -jx, -j 1000000, -l x,
  --error-exitcode=x, --max-ctu-depth=x, --template= (empty), --file-list=nonexistent, --suppressions-list=nonexistent,
  --library=nonexistent, --project=nonexistent, --rule-file=nonexistent, --include=nonexistent, --addon=nonexistent,
  -D with no id, -U with no id, -I with no dir, -I nonexistentdir, -i, --config-exclude=, unknown options,
  a nonexistent input file, a directory with no source files, an unreadable file, "--" handling, options after files.
- Unrecognized option message format; abbreviations/prefix matching (does --quie work?); "-" as a filename; "--file-list=-".
- Which options are mutually exclusive and the exact conflict messages (e.g. --xml with --output-format, -j with --clang, --project with files, -E with other stuff, --dump with --xml, --plist-output with a bad dir).
- Exit codes for all the above.
- Does argument order matter? Duplicate options?
- Also: exact full text of --help (write it verbatim into the report file, and also save it to /tmp/probe/help-exact.txt via redirect).`,
  },
  {
    key: 'text-output-templates',
    prompt: `AREA: text output formatting, --template, --template-location, --verbose, severities.

Craft small C/C++ files that trigger errors with 1 location and with MULTIPLE locations (e.g. null pointer
dereference where the null assignment is on an earlier line; uninitialized variable; use-after-free) so you
can study callstacks and note lines.

Probe exhaustively and record verbatim:
- Default output format (gcc template) exactly: "file:line:col: severity: message [id]" plus the code line and caret line. How is the caret column computed? What if the line is long / has tabs / is empty / the column is 0?
- The predefined templates: --template=gcc, --template=cppcheck1, --template=vs, --template=edit. Exact formats.
- --template with every field: {file} {line} {column} {callstack} {inconclusive:text} {severity} {message} {id} {cwe} {code} {file0} {gui} and any others you can discover. Try invalid/unknown fields like {bogus}.
- Escape handling: \\t \\n \\r inside --template, literal backslashes, single vs double quotes.
- --template-location with {file} {line} {column} {info} {code}; how multi-location messages render; what happens when template-location is absent (default).
- --verbose effect on messages (verbose text appended? how?).
- Severity spellings: error, warning, style, performance, portability, information, debug, internal.
- Inconclusive messages: use --inconclusive and find a check that yields inconclusive results; how does the default template render them?
- Order of messages, and where "Checking X ..." progress lines go (stdout vs stderr).
- What is printed at the end of a run (e.g. the "checkers report" nudge / information messages)? Record the EXACT trailer text, when it appears, and how --enable=information / -q / --quiet affect it.`,
  },
  {
    key: 'xml-sarif-output',
    prompt: `AREA: structured output: --xml, --output-format=xml|xmlv2|xmlv3|sarif|text, --output-file, --plist-output.

Using files that produce single-location and multi-location diagnostics, and diagnostics with <symbol> data:
- Exact XML v2 document: prologue, indentation (count spaces!), attribute order, escaping of & < > ' ", the <cppcheck version=...> line, <errors>, <error ...>, <location .../>, <symbol>.
- Which attributes appear on <error>: id, severity, msg, verbose, cwe, certainty/inconclusive, file0, hash, remark? Under which conditions? What about column on <location>? info attr?
- xmlv3 differences vs xmlv2 (version attr, extra elements/attributes, e.g. remarks, guideline/classification).
- --xml plus --verbose. --xml with -q. Interleaving of "Checking ..." progress with XML on the same stream (which stream is XML on?).
- --output-format=sarif exact JSON: keys, order, indentation, version, $schema, rules, results, levels mapping from severity, artifactLocation uri, region startLine/startColumn.
- --output-file=<f>: what goes to the file vs stderr/stdout. Does it write progress lines too?
- --plist-output=<dir>: exact plist file name and content for a small file.
- Deprecation warnings: does --xml or --output-format=xml print anything about deprecation? Exact text.
- --report-type=misra-c-2012 / autosar etc. combined with xml and text: what extra fields appear (guideline, classification)? Which ids map to which guidelines? Test a handful of ids.
- --checkers-report=<file>: exact file content for a default run and for --enable=all.`,
  },
  {
    key: 'preprocessor',
    prompt: `AREA: the preprocessor: -E output, -D/-U, #ifdef configuration enumeration, --max-configs, --force, includes.

- Exact -E output for simple files: how are comments, blank lines, #line/# markers, macros handled? Is whitespace preserved? Does it print a header/banner? Which stream? Exit code?
- Macro expansion: object-like, function-like, #, ##, variadic __VA_ARGS__, recursive macros, #undef, #if/#elif/#else, defined(), nested ifdefs, #include of a local header, #pragma once, include guards.
- Predefined macros: __cplusplus (value per --std), __STDC__, __STDC_VERSION__, __GNUC__, _WIN32, __unix__, __SIZE_TYPE__, __x86_64__, per --platform. Test with -E and a file that prints them.
- #error and #warning handling: exact diagnostic text and id (e.g. preprocessorErrorDirective), exit code.
- Configuration enumeration: a file with #ifdef A / #ifdef B; what configurations are checked? Use --verbose and/or -q to see "Checking file.c: A;B..." lines. Record the EXACT format of those lines, ordering, and separator.
- -DA effect on which configs are checked. --force. --max-configs=N and the toomanyconfigs information message. purgedConfiguration message.
- Missing includes: exact messages/ids for a missing #include with and without --enable=missingInclude, --enable=information, --check-config. -I handling and search order. --include=<file> forced include.
- syntaxError cases: unbalanced braces/parens, exact message + id + exit code.`,
  },
  {
    key: 'checks-core-error',
    prompt: `AREA: core "error"-severity checks that fire with DEFAULT settings (no --enable).

Write many tiny C and C++ test files and record the exact diagnostics (id, severity, message text, line, column).
Cover at least: arrayIndexOutOfBounds (and the "index N out of bounds" variants, negativeIndex, bufferAccessOutOfBounds,
pointerOutOfBounds), nullPointer / nullPointerRedundantCheck / nullPointerArithmetic, uninitvar / uninitdata /
uninitStructMember / legacyUninitvar, memleak / memleakOnRealloc / doubleFree / mismatchAllocDealloc / leakReturnValNotUsed,
deallocuse / useClosedFile, invalidFunctionArg / invalidFunctionArgBool, zerodiv / zerodivcond, negativeArraySize,
autoVariables / returnDanglingLifetime / danglingLifetime / returnLocalVariable, containerOutOfBounds, stlOutOfBounds,
eraseDereference, invalidIterator / iterators1..3 / mismatchingContainers, deallocret, doubleFree,
resourceLeak, memsetClass / memsetClassReference, virtualCallInConstructor (may need --enable), operatorEqVarError,
uninitMemberVar (needs --enable=warning?), va_start/va_end issues, wrongPrintfScanfArgNum / invalidPrintfArgType_*,
sprintfOverlappingData, strPlusChar, bufferNotZeroTerminated, terminateStrncpy, sizeofDivisionMemfunc,
integerOverflow, shiftNegative / shiftTooManyBits, floatConversionOverflow, invalidLengthModifierError,
udivError, oppositeInnerCondition, identicalConditionAfterEarlyExit, knownConditionTrueFalse (style),
returnAddressOfLocalVariable, comparePointers, objectIndex, ctu* / ctuOneDefinitionRuleViolation.

For EVERY finding, record the minimal reproducing source, the exact full stderr line(s), and the column number.
Note which ones need --enable=warning|style|performance|portability|all or --inconclusive to appear.
Note that /workspace/cfg/std.cfg is a stub with no function definitions, so library-dependent checks
(printf format, malloc/free leaks) may behave differently than a full install — RECORD WHAT YOU ACTUALLY SEE.`,
  },
  {
    key: 'checks-style-warning',
    prompt: `AREA: checks enabled by --enable=style / warning / performance / portability / all.

Write many tiny C and C++ files; record exact diagnostics for as many ids as you can trigger.
Target ids include (but don't limit yourself to):
style: unusedVariable, unreadVariable, unusedStructMember, unassignedVariable, variableScope, redundantAssignment,
redundantInitialization, duplicateAssignExpression, duplicateBranch, duplicateCondition, duplicateExpression,
duplicateValueTernary, knownConditionTrueFalse, unsignedLessThanZero, unsignedPositive, clarifyCalculation,
clarifyCondition, cstyleCast, invalidPointerCast, redundantCopy, sameIteratorExpression, constParameter,
constParameterReference, constParameterPointer, constVariable, constVariableReference, constVariablePointer,
constParameterCallback, functionStatic, functionConst, useInitializationList, noExplicitConstructor,
noConstructor, noCopyConstructor, noOperatorEq, noDestructor, uselessOverride, missingOverride,
unusedPrivateFunction, redundantPointerOp, nullPointerRedundantCheck, redundantCondition, incorrectStringBooleanError,
zerodivcond, unreachableCode, redundantContinue, redundantIfRemove, oppositeExpression, shadowVariable/shadowFunction/shadowArgument,
multiCondition, identicalInnerCondition, knownEmptyContainer, useStlAlgorithm, containerOutOfBounds,
postfixOperator, stlIfStrFind, stlSize, redundantNextPrevious, uselessCallsSubstr, uselessCallsEmpty,
passedByValue (performance), redundantCopyLocalConst, useInitializationList, unnecessaryForwardDeclaration,
warning: nullPointer variants, uninitMemberVar, uninitDerivedMemberVar, operatorEqRetRefThis, virtualCallInConstructor,
noCopyConstructor, memsetClassFloat, sizeofwithsilentarraypointer, incorrectLogicOperator, incorrectStringCompare,
comparisonOfBoolWithBoolError, comparisonOfFuncReturningBoolError, assignBoolToPointer, bitwiseOnBoolean,
charLiteralWithCharPtrCompare, literalWithCharPtrCompare, suspiciousSemicolon, clarifyStatement, selfAssignment,
truncLongCastAssignment, truncLongCastReturn, redundantAssignInSwitch, missingReturn, funcArgOrderDifferent,
argumentSize, checkCastIntToCharAndBack, sizeofCalculation, integerOverflowCond, raceAfterInterlockedDecrement,
performance: passedByValue, redundantCopy, redundantAssignment, useStlAlgorithm, stlSize, postfixOperator, redundantCopyLocalConst
portability: AssignmentAddressToInteger, AssignmentIntegerToAddress, CastIntegerToAddressAtReturn, CastAddressToIntegerAtReturn, invalidPointerCast, mallocOnClassWarning

Also determine EXACTLY which severities each of --enable=style / warning / performance / portability / all / information
turns on, and what --disable=<sev> does. Test --enable with comma lists and with check ids (does --enable=<id> work?).
Record exact error text for --enable=unusedFunction and --enable=missingInclude.`,
  },
  {
    key: 'progress-jobs-files',
    prompt: `AREA: file discovery, progress reporting, threading, and run-level messages.

- Exact "Checking <file> ..." line format (note spacing before "..."), which stream, and how it changes with configurations (e.g. "Checking f.c: CFG..."). 
- The "N/M files checked P% done" line: exact format, rounding of the percentage, which stream, when it appears (>1 file only?).
- Directory recursion: which extensions are picked up, ordering of files (alphabetical? directory order?), nested dirs, hidden files/dirs, symlinks.
- -i ignore patterns with *, **, ?; leading/trailing slashes; relative vs absolute; exact behavior. --file-filter with globs and multiple uses. --file-list=<file> including "-" for stdin. Comments/blank lines in file lists.
- -j N: does output order change? Are progress lines still printed? Any messages about threads? -j with --report-progress (help says single job only) — exact message.
- --report-progress output format.
- -q/--quiet vs default vs -v/--verbose at run level.
- Path normalization in output: backslashes, "./" prefixes, "../", absolute paths, duplicate slashes. -rp/--relative-paths behavior with one and multiple base paths.
- What happens with the same file listed twice? A file that does not exist (exact message + id "cppcheckError"? exit code)? An empty file? A file with only comments? A binary file? A file with CRLF line endings? A file with a BOM? A file with no trailing newline?
- Unicode/UTF-8 in file names and in code.
- The final summary/nudge lines printed after analysis (exact text, when shown, and which stream).`,
  },
  {
    key: 'suppressions',
    prompt: `AREA: suppressions and related messages.

- --suppress=<spec> all forms: id, id:file, id:file:line, id:*, "*", "*:file", id with wildcards in file, absolute vs relative paths, glob patterns, ":line" only. Exact behavior and any error messages for malformed specs.
- --suppress with unusedFunction / information ids. --suppress=unmatchedSuppression.
- unmatchedSuppression: when is it reported, exact message text, id, severity, file/line reported. How --enable=information affects it.
- --suppressions-list=<file>: file format, comments (#), blank lines, exact parse error messages for bad lines and for a missing file.
- --suppress-xml=<file>: exact XML schema accepted (<suppressions><suppress><id>/<fileName>/<lineNumber>/<symbolName>), error messages for malformed XML.
- Inline suppressions: --inline-suppr with "// cppcheck-suppress id", "// cppcheck-suppress[id1,id2]", "// cppcheck-suppress-begin"/"-end", "-file", "-macro", trailing same-line comments, symbolName in parens "// cppcheck-suppress id symbolName", comments with a message "; comment". Behavior WITHOUT --inline-suppr (is there an information message? exact text/id?).
- Exact messages/ids for malformed inline suppression comments.
- --exitcode-suppressions=<file> behavior with --error-exitcode.
- Interaction with --xml (do suppressed errors appear?).`,
  },
  {
    key: 'library-cfg',
    prompt: `AREA: library configuration files (.cfg XML) and --library / --check-library.

You MAY modify /workspace/cfg/std.cfg for these experiments but you MUST restore it at the end to exactly:
<?xml version="1.0"?>
<def format="2"/>
(two lines, trailing newline).
Prefer creating extra cfg files in your scratch dir and loading them with --library=<path>.

Determine:
- The exact error messages for: missing library file (--library=nope), malformed XML, unsupported format version, unknown elements/attributes. Include exit codes. Test both a bare name (searched in cfg/ dir?) and a path, with and without the .cfg extension.
- Which XML elements the loader accepts and what each does OBSERVABLY. Probe at least: <def format="2">, <define name= value=>, <function name=>...<noreturn>, <use-retval>, <pure>, <const>, <leak-ignore>, <returnValue type= value=>, <arg nr=>...<not-null>, <not-uninit>, <not-bool>, <strz>, <formatstr>, <valid>, <minsize type= arg=>, <iterator>, <memory>/<alloc>/<dealloc>/<realloc>, <resource>, <podtype name= sign= size=>, <platformtype>, <container>, <smart-pointer>, <type-checks>/<unusedvar>, <markup>, <reflection>, <exporter>, <entrypoint>.
  For each, construct a test C file that shows the behavior change (e.g. <noreturn> changing uninitvar results, <alloc>/<dealloc> enabling memleak, <formatstr> enabling printf checks, <use-retval> enabling ignoredReturnValue, <not-null> enabling nullPointer).
- --check-library: exact messages and ids (checkLibraryFunction, checkLibraryNoReturn, checkLibraryUseIgnore?) with the stub std.cfg.
- Where are library names resolved from? Does --library=posix work (is posix.cfg bundled)? List which .cfg names resolve successfully.
- Are there other data files the binary wants (platforms/*.xml for --platform=<file>)? Test --platform=avr8 etc. and --platform=<custom file> and record the XML schema it accepts.`,
  },
  {
    key: 'platform-std-lang',
    prompt: `AREA: --platform, --std, --language/-x, char signedness, and how they change analysis.

- For each builtin platform (unix32 unix64 win32A win32W win64 avr8 elbrus-e1cp pic8 pic8-enhanced pic16 mips32 native unspecified): determine the observable type sizes and signedness. A good probe is code like  char buf[sizeof(int)]; buf[N]=0;  or int x = 1 << 31; or printing via checks that mention sizes; also  --dump  output contains platform info — inspect it. Also try  void f(){ int i; i = 0x7fffffff + 1; }  style overflow checks whose thresholds depend on int size.
- The default platform when none given.
- --platform=<file>: exact XML schema; write one and prove it loads; error messages for bad files.
- --fsigned-char / --funsigned-char observable effects (e.g. char c = 200; if (c < 0)).
- --std=<id> for each value: effects on parsing (e.g. C++11 features, auto, nullptr, range-for, lambdas, digit separators, binary literals, u8 strings, static_assert, _Bool, // comments in c89, VLA in c99), on __cplusplus/__STDC_VERSION__, and on which checks fire. Exact error text for unsupported constructs.
- Language selection by extension for .c .cpp .cxx .cc .c++ .ipp .ixx .tpp .txx .h .hpp .C .H and unknown extensions; -x c / -x c++ / --language=; error text for a bad value. How are .h files treated when given directly on the command line?
- Reading source from stdin: is it supported? ("-" as filename?)`,
  },
  {
    key: 'dump-debug',
    prompt: `AREA: --dump output and undocumented debug flags.

- Run --dump on a small file; record the EXACT structure of the .dump XML (root element and attributes, <standards>, <platform>, <tokenlist>, <token ...> attributes and order, <scopes>, <scope>, <functions>, <variables>, <valueflow>, <values>, <value>, <directivelist>, <macro>, <valueflow>...). Include a full verbatim dump for a tiny file.
- Where is the .dump file written (next to source? cwd?) and what is its name? Does --dump also print anything to stdout/stderr? Does it still run the checks?
- Try undocumented flags that cppcheck historically has and record whether they are accepted and what they print: --debug, --debug-normal, --debug-simplified, --debug-warnings, --debug-symdb, --debug-valueflow, --debug-ast, --debug-template, --debug-clang-output, --debug-lookup, --verbose --debug, --experimental-fast, --check-headers, --check-unused-templates, --no-check-headers, --max-template-recursion, --performance-valueflow-max-time, --performance-valueflow-max-if-count, --template-max-time, --typedef-max-time, --valueflow-max-iterations, --errorlist --xml-version=2, --xml-version=3, --doc, --show-debug-warnings, --rule=..., --rule-file=..., -rp, --enable=internal, --disable=..., --checkers-report, --safety, --emit-duplicates, --premium=..., -h --verbose.
  For each, record: accepted or "unrecognized command line option" and the exact stdout/stderr.
- --doc if it exists: capture full output.`,
  },
  {
    key: 'exitcodes-misc',
    prompt: `AREA: exit codes, --error-exitcode, --safety, --check-config, --addon, --project, --rule.

- Exit code matrix: no errors; errors found (default); with --error-exitcode=N for N in {0,1,5,255,256,-1,x}; internal errors; syntax errors; missing input file; bad option; --error-exitcode with only style messages; with information messages; with suppressed errors; with --exitcode-suppressions.
- --safety: exact extra output (checker summary?), exit code changes, interaction with --error-exitcode and with critical errors (e.g. syntaxError, internalError). Record verbatim.
- --check-config: exact output on a file with a missing include and with unknown macros; exit code.
- --checkers-report=<file>: exact content (header lines, per-checker lines, "Active checkers: N/M" style summary). Compare default vs --enable=all vs --safety.
- --addon=misra / --addon=nonexistent / --addon=<json file>: exact error text (python missing? addon file missing?), exit code. Is python3 available in this container?
- --project=<compile_commands.json>: write a small compile database and record behavior; error text for malformed json; --project with also files on the command line; --project=nonexistent.sln/.vcxproj/.bpr error text.
- --rule=<regex> and --rule-file=<xml>: exact behavior, the id/severity/summary used for matches, the rule-file XML schema, error text for a bad regex or bad file.
- --cppcheck-build-dir=<dir>: what files are created, exact names/contents, behavior on a second run (reuse message?), error text for a nonexistent dir.
- --showtime=summary/file/top5_summary output format (times will vary — record the SHAPE and the exact static text).`,
  },
  {
    key: 'cpp-parsing-hard',
    prompt: `AREA: parser robustness and syntaxError/internalError behavior on tricky C++.

Feed the binary a wide variety of C++ constructs and record whether it parses cleanly (no output) or emits
syntaxError / internalError / debug messages. Use --enable=all --inconclusive and also plain runs.
Cover: templates (nested, variadic, template template params, SFINAE, specializations), lambdas (init capture,
generic, trailing return), auto/decltype, structured bindings, if-constexpr, concepts/requires, coroutines,
fold expressions, user-defined literals, attributes [[nodiscard]] [[maybe_unused]] alignas, operator overloads
including operator<=>, conversion operators, ref-qualified members, noexcept specs, initializer lists,
designated initializers, anonymous unions/structs, bitfields, enum class with base, inline/nested namespaces,
using-declarations and alias templates, extern "C", __attribute__((...)), __asm__/asm blocks, inline assembly,
#pragma pack, MSVC __declspec, K&R C function definitions, VLAs, _Generic, compound literals, restrict,
_Atomic, complex numbers, goto/labels, computed goto, statement expressions ({...}), typeof, digraphs, trigraphs,
raw string literals, string concatenation, wide/char16_t/char32_t/u8 literals, multi-char literals,
comma in template args, most-vexing-parse, function pointers/arrays of, member pointers, placement new,
throw/try/catch, exception specs, macros that expand to broken syntax.

Record the EXACT message text for syntaxError (including the "syntax error" wording and any token shown),
its id, severity, column, and the exit code, plus whether analysis continues for other files.
Also record cases where it prints "Analysis failed..." or "### Internal error" or a debug message,
and exactly what --verbose adds.`,
  },
]

phase('Probe')
const results = await parallel(AREAS.map(a => () =>
  agent(`${COMMON}\nYOUR AREA KEY: ${a.key}\nWrite your report to /tmp/probe/${a.key}.md\n\n${a.prompt}`,
        { label: `probe:${a.key}`, phase: 'Probe' })
))

phase('Synthesize')
const summaries = AREAS.map((a, i) => `## ${a.key}\n${results[i] || '(agent failed)'}`).join('\n\n')

const spec = await agent(
`You are the lead engineer on a from-scratch reimplementation of Cppcheck 2.19 dev (binary at /workspace/executable),
which must be byte-for-byte behaviorally identical for CLI usage. Below are field reports from 12 probe agents.
Detailed reports are on disk at /tmp/probe/*.md — READ the ones you need (do not read the whole set blindly).

Produce a prioritized IMPLEMENTATION SPEC written to /tmp/probe/SPEC.md and also returned as your final message.
Structure it as:
1. Architecture recommendation (language, module breakdown) for a C++17 single-binary reimplementation built with a plain Makefile/g++.
2. The exact non-analysis CLI surface that must be reproduced byte-for-byte (help text, version, errorlist, arg errors, exit codes) with pointers to where the verbatim data lives on disk.
3. Output formatting rules (text templates, xml v2/v3, sarif) as precise pseudo-code.
4. The analysis pipeline stages needed and, ranked by likely test coverage, the list of checks to implement with their exact message strings.
5. A concrete build order (what to write first) with acceptance tests.
Be specific and dense. This is the blueprint the implementation will follow.

FIELD REPORTS:
${summaries}`,
  { label: 'synthesize-spec', phase: 'Synthesize' })

return { spec }
