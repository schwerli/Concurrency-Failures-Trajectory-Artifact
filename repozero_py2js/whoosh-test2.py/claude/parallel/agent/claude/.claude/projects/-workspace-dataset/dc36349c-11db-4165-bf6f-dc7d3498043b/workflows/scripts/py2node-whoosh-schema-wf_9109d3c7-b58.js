export const meta = {
  name: 'py2node-whoosh-schema',
  description: 'Migrate /workspace/dataset/whoosh/test2.py (argparse + whoosh Schema) to zero-dependency ESM Node modules in /output, then adversarially verify byte-for-byte against the precompiled executable',
  phases: [
    { title: 'Spec', detail: 'Black-box probe argparse + design whoosh fields API surface' },
    { title: 'Implement', detail: 'Write hierarchical .mjs modules (py-compat, cli/argparse, whoosh)' },
    { title: 'Integrate', detail: 'Write entry test2.mjs and smoke-run it' },
    { title: 'Verify', detail: 'Adversarial byte-for-byte differential testing + ESM/constraint audit' },
    { title: 'Repair', detail: 'Fix every confirmed defect and re-verify' },
  ],
}

const EXE = '/workspace/dataset/test2_executable'
const SRC = '/workspace/dataset/whoosh/test2.py'

const GROUND_TRUTH = `
=== SOURCE (/workspace/dataset/whoosh/test2.py) ===
import argparse
from whoosh.fields import Schema, TEXT, ID, KEYWORD, NUMERIC

parser = argparse.ArgumentParser()
parser.add_argument('--a', type=str, required=True)
args = parser.parse_args()

schema = Schema(id=ID(stored=True), title=TEXT(stored=True), tags=KEYWORD, price=NUMERIC(stored=True))  # Create schema with multiple field types
print(schema)

=== VERIFIED EXECUTABLE BEHAVIOR (already probed; treat as authoritative) ===
Normal run:  ./test2_executable --a hello
  exit 0, stdout exactly (od -c verified):
  <Schema: ['id', 'price', 'tags', 'title']>\\n
  stderr empty. Output is IDENTICAL for any value of --a (--a=, --a "", --a -5, --a=--b, repeated --a x --a y -> last wins but output unchanged).

-h / --help / --hel / --he / -hx / (--a x -h) / (-h --a):
  exit 0, stdout exactly (od -c verified, note two spaces before -h, blank line after usage,
  10-space gap columns):
usage: test2_executable [-h] --a A

options:
  -h, --help  show this help message and exit
  --a A

  (i.e. bytes: "usage: test2_executable [-h] --a A\\n\\noptions:\\n  -h, --help  show this help message and exit\\n  --a A\\n")
  stderr empty.

Error cases -> exit 2, stdout EMPTY, stderr = usage line + "\\n" + "<prog>: error: <msg>\\n":
  (no args)      -> "the following arguments are required: --a"
  --a            -> "argument --a: expected one argument"
  --a -h         -> "argument --a: expected one argument"
  --a --b        -> "argument --a: expected one argument"
  --a -- x       -> "argument --a: expected one argument"
  --a x extra    -> "unrecognized arguments: extra"
  --a x --       -> "unrecognized arguments: --"
  --b x          -> "the following arguments are required: --a"   (required-check fires BEFORE unrecognized-args check)
  -a x           -> "the following arguments are required: --a"
  ---a x         -> "the following arguments are required: --a"
  --A x          -> "the following arguments are required: --a"
  -- --a x       -> "the following arguments are required: --a"
  stderr usage line for errors is "usage: test2_executable [-h] --a A\\n" then "test2_executable: error: MSG\\n"

PROG NAME RULE: Python argparse uses os.path.basename(sys.argv[0]). The Node port must
use the basename of its own script file, i.e. "test2.mjs", everywhere the executable prints
"test2_executable". Do NOT hardcode "test2_executable".
`

const ARCHITECTURE = `
MANDATORY FILE LAYOUT (exact paths, all .mjs, all ESM \`import\`/\`export\` only):

/output/test2.mjs                            <- entry (mirrors test2.py line-for-line)
/output/lib/py/repr.mjs                      <- pyRepr / pyReprStr / pyReprList (CPython repr() semantics)
/output/lib/py/sorting.mjs                   <- pySorted (code-point / UTF-16-safe lexicographic order)
/output/lib/py/errors.mjs                    <- PyError base, PyTypeError, PyValueError, SystemExit
/output/lib/py/index.mjs                     <- barrel re-exporting the py/ modules
/output/lib/cli/errors.mjs                   <- ArgumentError, ArgumentTypeError, ParserExit
/output/lib/cli/actions.mjs                  <- Action base, StoreAction, HelpAction
/output/lib/cli/formatter.mjs                <- HelpFormatter: formatUsage(), formatHelp()
/output/lib/cli/parser.mjs                   <- ArgumentParser (addArgument/parseArgs/parseKnownArgs/error/exit/printHelp)
/output/lib/cli/index.mjs                    <- barrel
/output/lib/whoosh/support/numeric.mjs       <- sortable numeric encoding helpers (toSortableLong etc.)
/output/lib/whoosh/analysis/tokenizers.mjs   <- Tokenizer base, IDTokenizer, RegexTokenizer
/output/lib/whoosh/analysis/filters.mjs      <- Filter base, LowercaseFilter, StopFilter
/output/lib/whoosh/analysis/analyzers.mjs    <- CompositeAnalyzer, IDAnalyzer, KeywordAnalyzer, StandardAnalyzer
/output/lib/whoosh/analysis/index.mjs        <- barrel
/output/lib/whoosh/formats.mjs               <- Format base, Existence, Frequency, Positions
/output/lib/whoosh/columns.mjs               <- Column base, VarBytesColumn, NumericColumn
/output/lib/whoosh/fields.mjs                <- FieldType, ID, IDLIST, TEXT, KEYWORD, NUMERIC, BOOLEAN, STORED, Schema, FieldConfigurationError
/output/lib/whoosh/index.mjs                 <- barrel re-exporting whoosh subsystem

HARD CONSTRAINTS (violating any invalidates the deliverable):
- ESM only. \`import\`/\`export\`. NEVER \`require()\`, NEVER \`module.exports\`, NEVER \`__dirname\`.
- ZERO npm/external imports. Only relative local './x.mjs' imports and node: builtins
  (node:process, node:path, node:url are allowed and are the ONLY non-relative imports permitted).
- Every relative import MUST carry the explicit .mjs suffix.
- No child_process, no python, no shelling out, no eval of Python.
- Code comments in English, concise, matching the density of ordinary library code.
`

const WHOOSH_SEMANTICS = `
whoosh.fields semantics that MUST be reproduced (black-box reimplementation; you may not read whoosh source):

1. Schema(**fields) accepts keyword field definitions. In test2.py, \`tags=KEYWORD\` passes the
   CLASS ITSELF, not an instance. Schema.add() must detect a callable/class and instantiate it
   with no args (\`fieldtype = fieldtype()\`), then validate it is a FieldType instance, else raise
   FieldConfigurationError. In JS: if the value is a class constructor (typeof 'function'), \`new\` it.
   The other three (ID(stored=True), TEXT(stored=True), NUMERIC(stored=True)) arrive as instances.
2. Field names starting with '_' are rejected (FieldConfigurationError). Names must be strings.
3. Schema stores fields in a name->fieldtype map. \`names()\` returns the field names SORTED
   ascending. \`repr(schema)\` == "<Schema: %r>" % schema.names() -> "<Schema: ['id', 'price', 'tags', 'title']>".
   \`print(schema)\` falls back to __repr__ (Schema defines no __str__), so stdout is that repr + "\\n".
4. Field constructors take keyword arguments. In JS, model Python kwargs as a single optional
   options object with the SAME defaults Python uses:
     ID({stored=false, unique=false, field_boost=1.0, sortable=false, analyzer=null})
     TEXT({analyzer=null, phrase=true, chars=false, stored=false, field_boost=1.0, multitoken_query='default',
           spelling=false, sortable=false, lang=null, vector=null})
     KEYWORD({stored=false, lowercase=false, commas=false, scorable=false, unique=false,
              field_boost=1.0, sortable=false, vector=null, analyzer=null})
     NUMERIC({numtype=Number/'int', bits=32, stored=false, unique=false, field_boost=1.0,
              decimal_places=0, shift_step=4, signed=true, sortable=false, default=null})
   Each field type sets .format (Existence/Frequency/Positions), .analyzer, .stored, .unique,
   .scorable, .indexed=true, .column_type when sortable.
   NUMERIC validates bits in (8,16,32,64) and raises on bad numtype.
5. Also support the small surface a caller would reasonably touch: Schema.has(name)/get/add/remove,
   iteration over [name, fieldtype] pairs, \`items()\`, \`names()\`, \`stored_names()\`, \`scorable_names()\`,
   and \`copy()\`. Keep it honest: implement what you expose, do not stub-throw on exported API.
   These extras must NOT change the printed output.
`

// ---------------- Phase 1: Spec ----------------
phase('Spec')

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          rule: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['topic', 'rule'],
      },
    },
    testMatrix: {
      type: 'array',
      description: 'argv arrays to differential-test, each an array of raw argv strings',
      items: { type: 'array', items: { type: 'string' } },
    },
    notes: { type: 'string' },
  },
  required: ['findings', 'testMatrix'],
}

const [argspec, whooshspec] = await parallel([
  () => agent(
    `You are reverse-engineering the CLI argument-parsing behavior of a precompiled Python
executable so it can be reimplemented in Node.js.

Executable: ${EXE}   (run it directly; do NOT use the \`python\` command)
${GROUND_TRUTH}

Your job: EXPAND the probe matrix well beyond what is listed above and nail down every rule
needed for a faithful reimplementation of \`ArgumentParser()\` + \`add_argument('--a', type=str, required=True)\`
+ \`parse_args()\`.

Probe at minimum (run each and record exit code, exact stdout, exact stderr):
 - abbreviation/prefix matching: --a is an exact option; --h, --he, --hel, --help, --x
 - '=' forms: --a=v, --a=, --a==v, --a=-h
 - short-option clustering: -h, -hh, -hx, -xh, -h=1
 - the '--' separator in every position
 - values that look like options: --a -x, --a --, --a -1, --a -1.5, --a -1e3, --a -.5, --a -x1
   (Python argparse has a negative-number heuristic: since the parser defines no option that looks
    like a negative number, an argv token matching ^-\\d+$|^-\\d*\\.\\d+$ is treated as a VALUE, not an option.
    Determine the EXACT boundary empirically: which of -1, -1.5, -.5, -1e3, -1., -0x1, --1 are accepted as values.)
 - tokens that are a bare '-' 
 - empty-string argv token ''
 - multiple unrecognized args (are they joined with a single space in the error?)
 - interleavings: extra --a x, --a x extra1 extra2, x --a y
 - error precedence: required-missing vs unrecognized vs expected-one-argument, all pairwise
 - unicode / spaces inside values
 - whether stdout gets ANY bytes on error paths, and whether help goes to stdout

Use a bash loop with \`printf '%q'\` style logging so nothing is ambiguous. Capture stdout and stderr
to SEPARATE files. Report exact strings.

Return: findings = the precise, implementable rules (one per behavior, with the observed evidence).
testMatrix = a de-duplicated list of at least 45 argv arrays covering every case you probed,
each element being the raw argv token list (e.g. ["--a","hello"], [], ["--a"], ["-h"]).
Do NOT include the program path in the argv arrays.`,
    { label: 'spec:argparse', phase: 'Spec', schema: SPEC_SCHEMA }
  ),
  () => agent(
    `You are designing the JavaScript API surface for a black-box reimplementation of the
\`whoosh.fields\` module (Python full-text search library), needed to run this exact program:

${GROUND_TRUTH}

${WHOOSH_SEMANTICS}

You may run ${EXE} to confirm the printed output, but you may NOT read whoosh's Python source.
Reason from the public interface and the observed output.

Design (do not write final code yet, produce a precise spec):
 - The exact class hierarchy for FieldType / ID / TEXT / KEYWORD / NUMERIC / BOOLEAN / STORED / IDLIST
   and the supporting analysis + formats + columns modules per this layout:
${ARCHITECTURE}
 - For EACH exported class: constructor signature (JS options-object form of the Python kwargs),
   the instance properties it sets and their default values, and its methods.
 - How Schema.add must handle a CLASS passed instead of an instance (the \`tags=KEYWORD\` case),
   including the JS detection predicate. Note that in JS every class is \`typeof 'function'\`,
   and calling a class without \`new\` throws TypeError — so the predicate must \`new\` it.
   Also explain how to preserve Python's insertion-order-independent SORTED name output.
 - The exact repr algorithm: how Python renders a list of str (quote choice rules: single quotes
   normally, double quotes when the string contains a single quote but no double quote; escapes for
   backslash, \\n, \\r, \\t, and non-printable code points as \\xNN / \\uNNNN / \\UNNNNNNNN).
 - Python's sorted() on strings = ascending by Unicode CODE POINT. JS's default Array#sort compares
   UTF-16 code units, which differs for astral-plane characters. Specify the correct comparator.

Return findings (topic/rule/evidence) covering all of the above, and set testMatrix to an empty array.
Put the full class-by-class spec in \`notes\` — be exhaustive and concrete, it is the contract the
implementers will code against.`,
    { label: 'spec:whoosh', phase: 'Spec', schema: SPEC_SCHEMA }
  ),
])

const argRules = (argspec?.findings ?? []).map(f => `- [${f.topic}] ${f.rule}${f.evidence ? `\n    evidence: ${f.evidence}` : ''}`).join('\n')
const whooshRules = (whooshspec?.findings ?? []).map(f => `- [${f.topic}] ${f.rule}`).join('\n')
const whooshNotes = whooshspec?.notes ?? ''
const matrix = (argspec?.testMatrix ?? []).filter(m => Array.isArray(m))

log(`Spec done: ${argspec?.findings?.length ?? 0} argparse rules, ${matrix.length} test cases, ${whooshspec?.findings?.length ?? 0} whoosh rules`)

const SHARED = `
${GROUND_TRUTH}

${ARCHITECTURE}

=== VERIFIED ARGPARSE RULES (from black-box probing) ===
${argRules}

=== WHOOSH DESIGN RULES ===
${whooshRules}

=== WHOOSH CLASS-BY-CLASS CONTRACT ===
${whooshNotes}
`

// ---------------- Phase 2: Implement ----------------
phase('Implement')

const WRITE_SCHEMA = {
  type: 'object',
  properties: {
    filesWritten: { type: 'array', items: { type: 'string' } },
    exports: { type: 'array', items: { type: 'string' }, description: 'exported symbol names per file, "path :: sym, sym"' },
    summary: { type: 'string' },
  },
  required: ['filesWritten', 'summary'],
}

const built = await parallel([
  () => agent(
    `${SHARED}

YOUR TASK: implement ONLY these files, exactly at these paths. Do not create, edit, or delete any other file.

  /output/lib/py/repr.mjs
  /output/lib/py/sorting.mjs
  /output/lib/py/errors.mjs
  /output/lib/py/index.mjs

This is the CPython-semantics compatibility layer.

/output/lib/py/repr.mjs must export:
  - \`pyReprStr(s)\`   -> CPython \`repr()\` of a str. Prefer single quotes; if the string contains
        a "'" and no '"', use double quotes. Escape backslash first, then the active quote char,
        then \\n \\r \\t, then other non-printable code points. CPython uses \\xNN for U+0000-U+00FF
        non-printables, \\uNNNN for U+0100-U+FFFF non-printables, \\UNNNNNNNN above that.
        Printability follows Unicode categories: treat ASCII 0x20-0x7E as printable, C0/C1 controls
        and the surrogate/format ranges as non-printable. Iterate by CODE POINT, not UTF-16 unit.
  - \`pyReprList(arr)\` -> "[a, b, c]" with ", " separator, "[]" when empty.
  - \`pyRepr(v)\`       -> dispatch: string -> pyReprStr, array -> pyReprList, null -> "None",
        true/false -> "True"/"False", number -> Python-ish number repr (integers without ".0",
        floats via repr rules), object with a \`__repr__\` method -> call it, otherwise String(v).

/output/lib/py/sorting.mjs must export:
  - \`pyCompareStrings(a, b)\` -> -1/0/1 comparing by Unicode CODE POINT (use codePointAt iteration
        or [...a] spreading, NOT the default UTF-16 comparison), so astral characters sort correctly.
  - \`pySorted(iterable, keyFn?)\` -> new sorted array, stable, using pyCompareStrings for strings
        and numeric comparison for numbers; mixed types throw a PyTypeError.

/output/lib/py/errors.mjs must export: \`PyError\` (extends Error, has \`.pyName\`), \`PyTypeError\`,
  \`PyValueError\`, and \`SystemExit\` (carries \`.code\`). Each sets \`this.name\` properly and captures
  a stack. \`SystemExit\` must NOT extend PyError semantics for exit handling — it is control flow.

/output/lib/py/index.mjs re-exports all of the above.

Requirements: ESM only, .mjs suffixes on every relative import, no external deps, no require().
Write real, complete, working implementations — no TODOs, no stubs, no placeholder throws for
anything you export. Use the Write tool. After writing, run
\`node --input-type=module -e "import {pyReprList} from '/output/lib/py/repr.mjs'; console.log(pyReprList(['id','price','tags','title']))"\`
and confirm it prints exactly: ['id', 'price', 'tags', 'title']
Report the exact command output you observed.`,
    { label: 'impl:py-compat', phase: 'Implement', schema: WRITE_SCHEMA }
  ),

  () => agent(
    `${SHARED}

YOUR TASK: implement ONLY these files, exactly at these paths. Do not create, edit, or delete any other file.
In particular do NOT write /output/test2.mjs and do NOT write anything under /output/lib/whoosh or /output/lib/py.

  /output/lib/cli/errors.mjs
  /output/lib/cli/actions.mjs
  /output/lib/cli/formatter.mjs
  /output/lib/cli/parser.mjs
  /output/lib/cli/index.mjs

This is a faithful, self-contained reimplementation of the slice of Python's \`argparse\` that
test2.py uses. It must reproduce EVERY verified behavior above, byte for byte.

DEPENDENCY NOTE: another agent is concurrently writing /output/lib/py/*.mjs exporting
\`pyReprStr\`, \`pyReprList\`, \`pyRepr\` (repr.mjs), \`pySorted\`, \`pyCompareStrings\` (sorting.mjs),
and \`SystemExit\` (errors.mjs), with a barrel at /output/lib/py/index.mjs. You may import
\`SystemExit\` from '../py/errors.mjs' — assume it exists; do not create it yourself.

/output/lib/cli/errors.mjs: \`ArgumentError\` (carries the offending argument's option string and
  a message; \`.message\` renders as "argument --a: expected one argument"), \`ArgumentTypeError\`,
  and \`ParserExit\` (status + message).

/output/lib/cli/actions.mjs: an \`Action\` base class holding {optionStrings, dest, nargs, required,
  help, metavar, type}, plus \`StoreAction\` (consumes one value, applies \`type\`, assigns to namespace)
  and \`HelpAction\` (nargs 0; prints help to stdout and exits 0).

/output/lib/cli/formatter.mjs: \`HelpFormatter\` producing:
    formatUsage(prog, actions)  -> "usage: <prog> [-h] --a A\\n"
      * optionals in registration order; \`-h\` first because it is added first
      * optional (not required) actions are wrapped in [ ]; required ones are bare
      * an action taking a value shows "<optstring> <METAVAR>" where METAVAR defaults to
        dest.toUpperCase() -> "A"
    formatHelp(prog, actions) -> usage + "\\n" + "options:\\n" + one line per action
      * each line is two leading spaces, then the invocation
        ("-h, --help" for help; "--a A" for the value option), then padding, then the help text
      * Python's HelpFormatter computes: action_max_length = max over actions of
        len(invocation) (+ indent), help_position = min(action_max_length + 2, max_help_position=24),
        and the help column starts at help_position. For THIS parser the observed output is exactly:
            "  -h, --help  show this help message and exit\\n  --a A\\n"
        i.e. "-h, --help" (10 chars) + 2 spaces + help text; "--a A" has no help text so the line
        is just "  --a A". Implement the general column algorithm so it reproduces this, rather
        than hardcoding the literal string.
      * NOTE the section header is "options:" (Python 3.10+), not "optional arguments:".
      * A trailing "\\n" ends the help text; there is NO extra blank line at the end.

/output/lib/cli/parser.mjs: \`ArgumentParser\` class with:
    constructor({ prog = null, ... }) — when prog is null, derive it the way Python does:
      basename of the entry script. Provide it via an explicit option so the entry file can pass
      \`basename(fileURLToPath(import.meta.url))\`; also support auto-derivation from
      \`process.argv[1]\` using node:path basename as the fallback. Never hardcode "test2_executable".
    addArgument(nameOrFlags, options) — supports { type, required, help, action:'store'|'help',
      default, metavar, dest, nargs }. Auto-adds \`-h/--help\` at construction (add_help default true).
      dest derives from the first long option with leading dashes stripped and '-' -> '_'.
    parseArgs(argv) / parseKnownArgs(argv) with EXACT Python semantics:
      * '--' separator handling (first '--' is removed and everything after is positional;
        a SECOND '--' survives as a literal and becomes an unrecognized argument)
      * '=' splitting for long options
      * unambiguous prefix abbreviation for long options (--hel -> --help); ambiguous prefix is an error
      * short-option clustering for nargs-0 actions (-hx -> -h then -x)
      * the negative-number heuristic (parser has no negative-number-looking options, so a token
        matching Python's _negative_number_matcher is treated as a value, not an option)
      * an argv token that is exactly '-' is treated as a positional value
      * an empty-string token '' is a positional value
      * ORDER OF ERRORS: required-argument check happens inside parseKnownArgs, BEFORE parseArgs'
        unrecognized-arguments check. Verified: \`--b x\` reports the required error, not unrecognized.
      * unrecognized arguments are joined with a single space in the message
    error(message) -> print usage to stderr, then "<prog>: error: <message>\\n" to stderr, exit 2,
      writing NOTHING to stdout.
    printHelp()/printUsage() -> write to stdout, exit 0 for the help action.
    Exiting: use \`process.exit(code)\` only after synchronously writing with
      \`process.stdout.write\` / \`process.stderr.write\` (NOT console.log for the error path, so no
      ordering surprises). Guard against truncation on exit.

/output/lib/cli/index.mjs re-exports the public surface.

Requirements: ESM only, explicit .mjs suffixes, zero external deps, node: builtins only where needed.
Complete working code, no stubs. Use the Write tool. Then self-test with a scratch file OUTSIDE
/output (e.g. /tmp/cli_probe.mjs) that builds the same parser and prints results, and compare
against ${EXE} for at least these argvs: [], ["--a","x"], ["--a"], ["-h"], ["--hel"],
["--a","x","extra"], ["--b","x"], ["--a","-5"], ["-hx"], ["--a","--"].
Report the diffs you found and fixed.`,
    { label: 'impl:argparse', phase: 'Implement', schema: WRITE_SCHEMA }
  ),

  () => agent(
    `${SHARED}

YOUR TASK: implement ONLY these files, exactly at these paths. Do not create, edit, or delete any other file.
In particular do NOT write /output/test2.mjs, /output/lib/cli/*, or /output/lib/py/*.

  /output/lib/whoosh/support/numeric.mjs
  /output/lib/whoosh/analysis/tokenizers.mjs
  /output/lib/whoosh/analysis/filters.mjs
  /output/lib/whoosh/analysis/analyzers.mjs
  /output/lib/whoosh/analysis/index.mjs
  /output/lib/whoosh/formats.mjs
  /output/lib/whoosh/columns.mjs
  /output/lib/whoosh/fields.mjs
  /output/lib/whoosh/index.mjs

This is the black-box reimplementation of \`whoosh.fields\` and the minimum of
\`whoosh.analysis\` / \`whoosh.formats\` / \`whoosh.columns\` it depends on.

DEPENDENCY NOTE: another agent is concurrently writing /output/lib/py/*.mjs exporting
\`pyReprStr\`, \`pyReprList\`, \`pyRepr\` from './repr.mjs' and \`pySorted\`, \`pyCompareStrings\` from
'./sorting.mjs', with a barrel /output/lib/py/index.mjs. Import what you need from
'../py/repr.mjs' and '../py/sorting.mjs' — assume they exist, do NOT create them.
Schema's repr MUST go through pyReprList + pyReprStr so that exotic field names render like CPython.

THE ONE OUTPUT THAT MATTERS:
  new Schema({ id: new ID({stored:true}), title: new TEXT({stored:true}), tags: KEYWORD, price: new NUMERIC({stored:true}) })
  ...printed, must yield exactly:  <Schema: ['id', 'price', 'tags', 'title']>

Follow the class-by-class contract above. Key points:
 - \`Schema\` constructor takes an options object mapping field name -> FieldType instance OR
   FieldType CLASS. A class must be instantiated with no args before storing (this is the
   \`tags=KEYWORD\` case — note KEYWORD is passed WITHOUT parentheses in the Python source).
   Detection: \`typeof v === 'function'\` -> \`v = new v()\`. Then verify \`v instanceof FieldType\`,
   else throw \`FieldConfigurationError\`.
 - Reject names starting with '_' and non-string names with FieldConfigurationError.
 - \`names()\` returns names sorted with the py sorting comparator.
 - \`toString()\` AND a \`__repr__()\` method both return \`<Schema: ${'${pyReprList(this.names().map(pyReprStr))}'}>\`
   — implement it so \`console.log(String(schema))\` and \`console.log(\\\`${'${schema}'}\\\`)\` both work,
   and also define \`[Symbol.toPrimitive]\` or rely on toString consistently. Make sure
   \`console.log(schema)\` in Node does NOT print an object dump — the entry file will use the
   string form explicitly, but exporting a correct \`toString\` + a \`[Symbol.for('nodejs.util.inspect.custom')]\`
   that returns the same repr is the right call.
 - FieldType base: properties \`format\`, \`analyzer\`, \`vector\`, \`scorable\`, \`stored\`, \`unique\`,
   \`indexed\`, \`multitoken_query\`, \`sortable_typecode\`, \`column_type\`, \`field_boost\`,
   plus \`clean()\`, \`onAdd()\`, \`onRemove()\`, \`supports(name)\`, \`selfParsing()\`, and a \`__repr__\`.
 - ID: IDAnalyzer + Existence format, not scorable.
 - TEXT: StandardAnalyzer + (Positions when phrase else Frequency), scorable true.
 - KEYWORD: KeywordAnalyzer(lowercase, commas) + Frequency format, scorable configurable.
 - NUMERIC: no analyzer/tokenization in the text sense, Existence format, sortable_typecode by bits,
   validates bits in (8,16,32,64), stores decimal_places/shift_step/signed, and \`toBytes\`/\`fromBytes\`
   built on support/numeric.mjs sortable-encoding helpers.
 - Implement the analysis + formats + columns classes for real (tokenizing, lowercasing, stopwords,
   the Format subclasses' \`wordValues\`, the Column subclasses' basic value coercion). No stubs.

Requirements: ESM only, explicit .mjs suffixes, zero external deps, complete working code, no TODOs.
Use the Write tool. Then self-test from /tmp (NOT inside /output) by importing
/output/lib/whoosh/fields.mjs, constructing the exact schema above, and printing it. Confirm the
line matches \`<Schema: ['id', 'price', 'tags', 'title']>\` character for character.
Also test: passing a non-FieldType raises FieldConfigurationError; a '_name' field raises;
adding/removing fields keeps names() sorted.
Report the exact observed output.`,
    { label: 'impl:whoosh', phase: 'Implement', schema: WRITE_SCHEMA }
  ),
])

log(`Implement done: ${built.filter(Boolean).flatMap(b => b.filesWritten ?? []).length} files written`)

// ---------------- Phase 3: Integrate ----------------
phase('Integrate')

const integration = await agent(
  `${SHARED}

The library modules under /output/lib/py, /output/lib/cli and /output/lib/whoosh have just been
written by three separate agents working in parallel. Your job is to make the whole thing cohere
and to write the entry point.

STEP 1 — read every file under /output/lib (use \`find /output -name '*.mjs'\` then Read each one).
STEP 2 — fix any integration breakage caused by the parallel authoring:
   - import paths that don't resolve, missing .mjs suffixes, symbols imported but never exported,
     duplicate/divergent definitions of the same concept, any \`require\`/\`module.exports\` slip,
     any non-relative import other than \`node:\` builtins.
   - You MAY edit files under /output/lib to fix these, but do not gut a working module and do not
     collapse the file hierarchy — the hierarchical split is a hard requirement.
STEP 3 — write /output/test2.mjs, the entry point. It must mirror test2.py structurally:

     import { basename } from 'node:path'
     import { fileURLToPath } from 'node:url'
     import { ArgumentParser } from './lib/cli/parser.mjs'
     import { Schema, TEXT, ID, KEYWORD, NUMERIC } from './lib/whoosh/fields.mjs'

     const parser = new ArgumentParser({ prog: basename(fileURLToPath(import.meta.url)) })
     parser.addArgument('--a', { type: String, required: true })
     const args = parser.parseArgs(process.argv.slice(2))

     // Create schema with multiple field types
     const schema = new Schema({ id: new ID({ stored: true }), title: new TEXT({ stored: true }), tags: KEYWORD, price: new NUMERIC({ stored: true }) })
     console.log(String(schema))

   (adapt names to whatever the modules actually export — the above is the intended shape, and the
    \`tags: KEYWORD\` bare-class form MUST be preserved because that is what the Python source does).
   Keep the trailing comment on the schema line, matching the Python comment.

STEP 4 — smoke test. Run each of these and paste the exact result:
     node /output/test2.mjs --a hello
     node /output/test2.mjs --a=hello
     node /output/test2.mjs
     node /output/test2.mjs --a
     node /output/test2.mjs -h
     node /output/test2.mjs --a x extra
     node /output/test2.mjs --b x
   Compare each against ${EXE} with the same args, remembering that the prog name legitimately
   differs ("test2.mjs" vs "test2_executable") and that is CORRECT, not a bug — everything else
   (exit code, stream, spacing, wording) must match exactly.
   Fix whatever differs. Iterate until all seven match modulo the prog name.

Return a report: files you edited, integration bugs you found, and the verbatim output of all
seven smoke commands side by side with the executable's.`,
  { label: 'integrate', phase: 'Integrate' }
)

log('Integration complete')

// ---------------- Phase 4: Verify (adversarial, multi-lens) ----------------
phase('Verify')

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          repro: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'severity', 'title', 'detail'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

const matrixJson = JSON.stringify(matrix)

const LENSES = [
  {
    key: 'differential',
    prompt: `You are a differential tester. Prove that \`node /output/test2.mjs ARGS\` is
byte-for-byte identical to \`${EXE} ARGS\` for every ARGS, modulo the program name
("test2.mjs" vs "test2_executable" — that substitution is EXPECTED and correct).

Write a harness at /tmp/diff_test.sh (NOT in /output) that, for each argv case:
  - runs the executable, capturing stdout, stderr, exit code separately
  - runs \`node /output/test2.mjs\` with the same argv, same capture
  - normalizes ONLY the prog name (sed 's/test2_executable/test2.mjs/g' on the executable's streams)
  - diffs stdout, stderr, and exit code, and prints a PASS/FAIL line per case with a unified diff on FAIL

Use this case list as your starting point (JSON array of argv arrays):
${matrixJson}

Then ADD at least 25 more adversarial cases of your own: unicode values, values with spaces/newlines,
values that look like flags, very long values, repeated flags, '=' oddities, '--' in odd positions,
empty tokens, tokens that are just dashes, near-miss abbreviations.

Report every mismatch as a finding with the exact case, expected bytes, and actual bytes.
Report the total pass/fail count in \`summary\`. Be precise about whitespace — use \`od -c\` on any
mismatching stream.`,
  },
  {
    key: 'constraints',
    prompt: `You are auditing /output against HARD DELIVERY CONSTRAINTS. Read every file under /output.

Flag as a BLOCKER any violation of:
 1. Non-.mjs source file, or a relative import missing its .mjs suffix.
 2. Any \`require(\`, \`module.exports\`, \`exports.\`, \`__dirname\`, \`__filename\` usage.
 3. Any import that is neither relative ('./' or '../') nor a \`node:\`-prefixed builtin.
    An npm package name, a bare builtin without the node: prefix used inconsistently, or a
    dynamic import of anything external — all blockers.
 4. Any invocation of python, any child_process/exec/spawn, any eval of foreign code.
 5. Any mention of, or dependency on, an external JS library (yargs, minimist, commander, lodash, ...)
    in code OR comments.
 6. Files written outside /output (check for stray scratch files INSIDE /output that are not part
    of the deliverable — those should be flagged as cleanup, severity minor).
 7. The hierarchical-module requirement: the library must genuinely be split across multiple
    modules by functionality, each exposing its interface via \`export\`. A single monolith, or
    modules that are empty shells, is a blocker.
 8. Every exported symbol must be actually implemented — grep for \`TODO\`, \`FIXME\`, \`not implemented\`,
    \`throw new Error('stub\`, and empty function bodies on exported functions. Any of these is a major.
 9. \`node --check\` equivalent: run \`node --input-type=module -e "await import('/output/<file>')"\`
    for every module and confirm each loads cleanly.
Also verify \`node /output/test2.mjs --a x\` prints exactly \`<Schema: ['id', 'price', 'tags', 'title']>\`
followed by a single newline (verify with \`od -c\`).

Report each violation as a finding with the file, line, and the exact offending text.`,
  },
  {
    key: 'semantics',
    prompt: `You are a Python-semantics reviewer. Read all of /output and hunt for places where the
JS reimplementation silently diverges from CPython/argparse/whoosh semantics, even if the current
smoke tests pass. Concentrate on:
 - Sorting: does \`names()\` use code-point ordering, or JS default \`.sort()\`? Test with field names
   containing uppercase/underscore/digits/non-ASCII/astral characters and compare with what CPython
   \`sorted()\` would produce (reason it out; you can verify ASCII ordering against the executable's
   own output only for the fixed names, so reason carefully for the rest).
 - repr: does \`pyReprStr\` handle a name containing an apostrophe, a double quote, both, a backslash,
   a newline, a tab, a NUL, U+00A0, U+1F600? Write a scratch test in /tmp and check each against
   CPython's documented repr rules. Report any wrong quoting or escaping.
 - The \`tags: KEYWORD\` bare-class path: is it actually exercised, and does \`schema.get('tags')\`
   return a real KEYWORD INSTANCE (not the class)? Verify \`instanceof\`.
 - argparse: type coercion (\`type: String\`) — is the value actually passed through the type callable?
   Does \`--a\` with a value of \`0\` / \`\` behave like Python (no falsiness bugs)?
 - Does anything rely on object key insertion order in a way that would break for numeric-looking
   field names? (JS objects reorder integer-like keys — \`{2:..., 1:...}\` iterates 1,2. If Schema
   is built from a plain object, a field named "1" would be reordered. Since names() sorts anyway,
   determine whether this is actually observable, and say so honestly rather than inventing a bug.)
 - Exit-code and stream-flush correctness: could \`process.exit()\` truncate a large stdout write?
 - Any place a JS \`Number\` would render differently from a Python int/float.
Report concrete, reproducible divergences only. For each, give a runnable repro.`,
  },
  {
    key: 'robustness',
    prompt: `You are a robustness/quality reviewer for /output. Read every file. Look for:
 - Crashes: run \`node /output/test2.mjs\` under unusual conditions — argv with 500 tokens, a value
   of 1MB, stdout redirected to a closed pipe (\`node /output/test2.mjs --a x | head -c 1\`),
   running from a different cwd (\`cd /tmp && node /output/test2.mjs --a x\`), and invoking via a
   symlink. The executable's behavior on the closed-pipe case is a Python BrokenPipeError trace —
   do NOT try to replicate a crash; just confirm Node does not emit a spurious error on a normal run.
 - Correct behavior when the module is imported rather than executed: does /output/test2.mjs
   guard its side effects, or does importing any lib module trigger argument parsing? Library
   modules must have NO side effects on import. Test each with
   \`node --input-type=module -e "await import('/output/lib/.../x.mjs'); console.log('clean')"\`.
 - Dead code, duplicated logic across the three subsystems, misleading comments, and inconsistent
   naming conventions between modules authored by different agents.
 - Whether the file hierarchy matches the mandated layout exactly (list \`find /output -type f | sort\`
   and compare against the required layout in the brief). Missing or extra files are findings.
Report only real, reproducible issues with a repro command.`,
  },
]

// pipeline: each lens's findings get adversarially verified as soon as that lens finishes
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    isReal: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    correctedFix: { type: 'string' },
  },
  required: ['isReal', 'reasoning'],
}

const verified = await pipeline(
  LENSES,
  lens => agent(`${SHARED}\n\n${lens.prompt}`, { label: `verify:${lens.key}`, phase: 'Verify', schema: FINDINGS_SCHEMA }),
  (res, lens) => {
    const fs = (res?.findings ?? []).filter(f => f.severity === 'blocker' || f.severity === 'major')
    if (!fs.length) return []
    return parallel(fs.map(f => () =>
      agent(
        `Adversarially verify this claimed defect in the /output Node.js port. Your default is
REFUTED — only confirm if you can REPRODUCE it with a concrete command.

Claim (from the "${lens.key}" review):
  file: ${f.file}
  severity: ${f.severity}
  title: ${f.title}
  detail: ${f.detail}
  repro: ${f.repro ?? '(none given)'}
  proposed fix: ${f.fix ?? '(none given)'}

Read the actual file. Run the repro. Compare against ${EXE} where relevant.
Remember: the program name legitimately differs ("test2.mjs" vs "test2_executable") — a finding
that boils down to that difference is REFUTED. A finding about behavior the Python source itself
does not exercise is still REAL if it violates the stated hard constraints, but NOT real if it is
merely a hypothetical about code paths that behave correctly.

Set isReal=true ONLY if you reproduced it. If real, give a corrected, minimal fix in correctedFix.`,
        { label: `refute:${(f.title ?? '').slice(0, 34)}`, phase: 'Verify', schema: VERDICT_SCHEMA }
      ).then(v => ({ ...f, lens: lens.key, verdict: v }))
    ))
  }
)

const confirmed = verified.flat().filter(Boolean).filter(f => f.verdict?.isReal)
log(`Verify: ${verified.flat().filter(Boolean).length} candidate findings, ${confirmed.length} confirmed`)

// ---------------- Phase 5: Repair ----------------
phase('Repair')

let repairReport = 'No confirmed defects — nothing to repair.'
if (confirmed.length) {
  const list = confirmed
    .map((f, i) => `${i + 1}. [${f.severity}] ${f.file} — ${f.title}\n   detail: ${f.detail}\n   repro: ${f.repro ?? 'n/a'}\n   verified fix: ${f.verdict?.correctedFix ?? f.fix ?? 'n/a'}`)
    .join('\n\n')

  repairReport = await agent(
    `${SHARED}

Adversarial verification confirmed the following REAL defects in the /output port. Fix every one
of them, minimally and correctly, without breaking anything that currently works and without
collapsing the module hierarchy.

${list}

After fixing:
 1. Re-run the full differential suite: for each of these argvs, compare \`node /output/test2.mjs\`
    against \`${EXE}\` on stdout, stderr, and exit code (normalizing only the prog name):
    ${matrixJson}
    plus: [], ["--a","x"], ["-h"], ["--hel"], ["--a"], ["--a","x","extra"], ["--b","x"], ["--a","-5"], ["-hx"]
 2. Confirm \`node /output/test2.mjs --a hello | od -c\` ends with the exact bytes
    \`<Schema: ['id', 'price', 'tags', 'title']>\\n\`.
 3. Re-audit the hard constraints: no require/module.exports, no external imports, every relative
    import ends in .mjs, every module imports cleanly with no side effects.
 4. Delete any scratch/test files that ended up inside /output (tests belong in /tmp).

Report: what you changed per file, and the final pass/fail table of the differential suite.`,
    { label: 'repair', phase: 'Repair' }
  )
}

// ---------------- Final completeness critic ----------------
const critic = await agent(
  `${SHARED}

Final completeness check on the delivered port in /output. You are the last gate.

Do all of the following and report honestly:
 1. \`find /output -type f | sort\` — does the tree match the mandated layout? Any extra scratch files?
 2. Run the definitive check:
      ${EXE} --a hello > /tmp/a.txt 2>/tmp/a.err; echo "exe exit=$?"
      node /output/test2.mjs --a hello > /tmp/b.txt 2>/tmp/b.err; echo "node exit=$?"
      diff /tmp/a.txt /tmp/b.txt && echo STDOUT_IDENTICAL
      od -c /tmp/b.txt
 3. Run the help and every error case; confirm stream, exit code, and wording match (prog name aside).
 4. Grep the whole tree one final time for: require(, module.exports, from 'yargs, from "commander,
    import ' followed by a bare package name, child_process, python.
 5. State plainly, with evidence, whether the deliverable satisfies EVERY numbered requirement:
    ESM-only, .mjs suffixes, exact CLI alignment, byte-identical output, zero external deps,
    hierarchical modules with exports, files in /output, no embedded Python.
 6. Name anything still missing, wrong, or under-implemented. If nothing is, say so and show why.

Be specific and cite command output. Do not claim success you did not observe.`,
  { label: 'completeness-critic', phase: 'Repair' }
)

return {
  argparseRules: argspec?.findings?.length ?? 0,
  testCases: matrix.length,
  filesWritten: built.filter(Boolean).flatMap(b => b.filesWritten ?? []),
  integration,
  candidateFindings: verified.flat().filter(Boolean).length,
  confirmedFindings: confirmed.map(f => ({ file: f.file, severity: f.severity, title: f.title })),
  repairReport,
  critic,
}
