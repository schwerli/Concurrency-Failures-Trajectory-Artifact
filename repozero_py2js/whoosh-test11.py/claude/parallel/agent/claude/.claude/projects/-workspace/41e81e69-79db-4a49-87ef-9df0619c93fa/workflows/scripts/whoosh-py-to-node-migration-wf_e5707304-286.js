export const meta = {
  name: 'whoosh-py-to-node-migration',
  description: 'Reimplement whoosh/test11.py as a hierarchical zero-dependency ESM Node.js library in /output, verified differentially against the precompiled executable',
  phases: [
    { title: 'Semantics', detail: 'consensus on Whoosh black-box semantics (len(results), Every, StandardAnalyzer, argparse)' },
    { title: 'Implement', detail: 'parallel agents write disjoint module groups per locked contract' },
    { title: 'Integrate', detail: 'barrel + entry point, resolve cross-module signature mismatches, first run' },
    { title: 'Verify', detail: 'adversarial lenses: differential CLI testing, ESM/zero-dep compliance, argparse fidelity, semantic fidelity' },
    { title: 'Fix', detail: 'apply confirmed findings' },
    { title: 'Final', detail: 'full differential sweep + report' },
  ],
}

const GROUND_TRUTH = `
=== MEASURED GROUND TRUTH (from running /workspace/dataset/test11_executable) ===
Source: /workspace/dataset/test11.py (read it; it is 26 lines).

Happy path: every valid invocation prints exactly "3\\n" to stdout, exit 0.
  ./test11_executable --a hello --b world --c foo         -> "3\\n"  exit 0
  ./test11_executable --a "" --b "" --c ""                -> "3\\n"  exit 0
  ./test11_executable --a x --b x --c x                   -> "3\\n"  exit 0
  ./test11_executable --a=1 --b=2 --c=3                   -> "3\\n"  exit 0
  ./test11_executable --a -5 --b 2 --c 3                  -> "3\\n"  exit 0   (negative number IS accepted as a value)
  ./test11_executable --a -5.5 --b 2 --c 3                -> "3\\n"  exit 0
  ./test11_executable --a=-x --b 2 --c 3                  -> "3\\n"  exit 0   (=form accepts any value)
  ./test11_executable --a 1 --a 9 --b 2 --c 3             -> "3\\n"  exit 0   (last occurrence wins)
  unicode args also print "3\\n" (stdout bytes are exactly 0x33 0x0a)

Error paths: message goes to STDERR, exit code 2, stdout empty. PROG = basename of argv[0].
  (missing one)   --a 1 --b 2
      usage: PROG [-h] --a A --b B --c C
      PROG: error: the following arguments are required: --c
  (missing all)   <no args>
      usage: PROG [-h] --a A --b B --c C
      PROG: error: the following arguments are required: --a, --b, --c
  (unknown opt)   --a 1 --b 2 --c 3 --d 4
      PROG: error: unrecognized arguments: --d 4
  (extra positional) --a 1 --b 2 --c 3 extra
      PROG: error: unrecognized arguments: extra
  (bare double dash) --a 1 --b 2 --c 3 --
      PROG: error: unrecognized arguments: --
  (missing value)  --a 1 --b 2 --c
      PROG: error: argument --c: expected one argument
  (value looks like an option) --a --b --b 2 --c 3
      PROG: error: argument --a: expected one argument
  (value looks like a non-numeric short flag) --a -x --b 2 --c 3
      PROG: error: argument --a: expected one argument
  (wrong-case / undefined short flag) -a 1 --b 2 --c 3   AND   --A 1 --b 2 --c 3
      PROG: error: the following arguments are required: --a
      NOTE ORDERING RULE: the "required" check fires BEFORE the "unrecognized arguments" report.
      So when a required option is missing AND there are leftover unknown args, only the
      required-arguments error is printed.

Help: -h or --help anywhere (even alongside other args, even when required args are missing)
prints to STDOUT and exits 0 with EXACTLY these bytes:
usage: PROG [-h] --a A --b B --c C

options:
  -h, --help  show this help message and exit
  --a A
  --b B
  --c C

(that is: usage line, blank line, "options:", then four two-space-indented entries;
the -h entry has its help text aligned at column 14, i.e. "  -h, --help  show this help message and exit")
For our port, PROG must be derived the way argparse derives it: basename(process.argv[1]) -> "test11.mjs".
`

const CONTRACT = `
=== LOCKED SHARED CONTRACT (other agents are writing the other files RIGHT NOW; do not deviate) ===

HARD RULES (violating any one invalidates the whole deliverable):
 - Pure JavaScript for Node.js. ES Modules ONLY: use import / export.
 - require() and module.exports are STRICTLY FORBIDDEN anywhere, including in comments/strings.
 - Every file has the .mjs suffix. Every relative import MUST include the full .mjs suffix.
 - ZERO external dependencies. No npm packages (no argparse, no yargs, nothing). The ONLY
   non-relative imports permitted are Node builtins written with the node: prefix
   (node:fs, node:path, node:os, node:process, node:url, node:crypto is NOT needed - avoid it).
 - Do NOT shell out to python, do NOT embed python. Do NOT read/extract the executable's internals.
 - No top-level await in library modules (entry may avoid it too; keep everything synchronous).
 - Code must be defensive: never throw on any input the CLI accepts (including empty strings and unicode).

ROOT: /output      ENTRY: /output/test11.mjs      LIBRARY ROOT: /output/lib/

FILE / EXPORT MAP (exact names - other modules import these):

/output/lib/util/py.mjs
  export class PyError extends Error
  export function print(...values)   // Python print(): String() each value, join with ' ', append '\\n', write to process.stdout
  export function len(obj)           // Python len(): if obj && typeof obj.__len__ === 'function' -> obj.__len__();
                                     // else string/Array -> .length; Set/Map -> .size;
                                     // else typeof obj.length === 'number' -> obj.length; else throw PyError
  export function repr(value)
  export function isIterable(value)

/output/lib/compat/argparse.mjs
  export class Namespace                      // plain attribute bag; toString like Python Namespace
  export class ArgumentTypeError extends Error
  export class ArgumentParser {
    constructor(options = {})                 // {prog, usage, description, add_help = true, exit_on_error = true}
                                              // default prog = basename(process.argv[1] || '')
    add_argument(...args)                      // e.g. add_argument('--a', {type: String, required: true})
                                              // supports: type, required, default, help, dest, metavar, action ('store','store_true','help')
    parse_args(argv)                           // argv defaults to process.argv.slice(2); returns Namespace
    parse_known_args(argv)                     // returns [namespace, extras]
    format_usage(); format_help(); print_usage(); print_help()
    error(message)                             // prints format_usage() + prog + ': error: ' + message to stderr, exit(2)
    exit(status = 0, message = null)
  }
  MUST reproduce the MEASURED GROUND TRUTH argparse behavior exactly, including the
  required-before-unrecognized ordering rule, the '--opt=value' form, negative-number values,
  the 'expected one argument' error, and the exact help text.

/output/lib/compat/tempfile.mjs
  export function gettempdir()
  export function mkdtemp(options = {})       // {suffix = '', prefix = 'tmp', dir = null}
                                              // creates a directory (mode 0o700) and returns its absolute path

/output/lib/analysis/token.mjs
  export class Token { constructor(fields = {}) }
    // fields/props: text, original, boost, pos, startchar, endchar, stopped,
    //               positions, chars, removestops, mode
    // copy() method
/output/lib/analysis/stopwords.mjs
  export const STOP_WORDS   // a Set. Whoosh's default English stop list, exactly these words:
                            // a an and are as at be by can for from have if in is it may
                            // not of on or tbd that the this to us we when will with yet you your
/output/lib/analysis/tokenizers.mjs
  export const DEFAULT_WORD_PATTERN   // Whoosh's default tokenizer regex, Python-\\w-equivalent.
        // Python's \\w on str matches [letters, digits, underscore] unicode-aware, so use
        // a unicode-property class such as [\\p{L}\\p{N}_] with the u flag - NOT bare \\w
        // (bare \\w is ASCII-only in JS and would mis-tokenize unicode input).
        // Whoosh's default expression is equivalent to: WORD+(\\.?WORD+)*
  export class Tokenizer                      // base; has *tokenize(value, opts) generator
  export class RegexTokenizer extends Tokenizer   // constructor(expression = DEFAULT_WORD_PATTERN, gaps = false)
  export class IDTokenizer extends Tokenizer      // whole value as a single token
  export class SpaceSeparatedTokenizer extends Tokenizer
  // Every tokenizer exposes: tokenize(value, {positions=false, chars=false, start_pos=0,
  //   start_char=0, mode='', removestops=true, keeporiginal=false} = {}) -> iterable<Token>

/output/lib/analysis/filters.mjs
  export class Filter                          // base; filter(tokenStream, opts) -> iterable<Token>
  export class PassFilter extends Filter
  export class LowercaseFilter extends Filter
  export class StopFilter extends Filter       // constructor({stoplist = STOP_WORDS, minsize = 2,
                                               //   maxsize = null, renumber = true} = {})
                                               // Whoosh semantics: drops stopwords and tokens with
                                               // text.length < minsize; when removestops is false it
                                               // marks token.stopped = true instead of dropping;
                                               // renumber keeps token.pos contiguous.
/output/lib/analysis/analyzers.mjs
  export class Analyzer                        // base with analyze(value, opts)
  export class CompositeAnalyzer extends Analyzer  // constructor(tokenizer, ...filters)
  export function StandardAnalyzer(opts = {})  // RegexTokenizer + LowercaseFilter + StopFilter({minsize:2})
                                               // opts: {expression, stoplist = STOP_WORDS, minsize = 2, maxsize, gaps}
  export function SimpleAnalyzer(opts = {})    // RegexTokenizer + LowercaseFilter
  export function IDAnalyzer(opts = {})        // IDTokenizer (+ LowercaseFilter if lowercase true)
  export function KeywordAnalyzer(opts = {})
  // CANONICAL analysis entry method name is analyze(value, opts). Every analyzer instance
  // must have .analyze(...). Also attach a .call alias with identical behavior for readability.

/output/lib/fields/fieldtypes.mjs
  export class FieldType {
    constructor({analyzer = null, stored = false, unique = false, field_boost = 1.0,
                 indexed = true, sortable = false, vector = null, spelling = false} = {})
    index(value, opts = {})   // -> array of [text, freq, weight, valueBytes] tuples for one field value
    process_text(value, opts = {})   // -> array of token text strings
    to_bytes(value); self_parsing(); sortable_terms()
  }
  export function TEXT(opts = {})     // returns a FieldType instance (Python TEXT(stored=True) is a
                                      // constructor call, so TEXT({stored: true}) returns an instance).
                                      // Default analyzer: StandardAnalyzer. phrase=true means positions.
  export function ID(opts = {})       // IDAnalyzer, single-token, unique option honored
  export function KEYWORD(opts = {})
  export function STORED(opts = {})   // indexed = false, stored = true
  export function NUMERIC(opts = {})
  export function BOOLEAN(opts = {})
  // Each factory must ALSO work when called with no args: TEXT() / ID().
/output/lib/fields/schema.mjs
  export class Schema {
    constructor(fields = {})          // Schema({title: TEXT({stored:true}), content: TEXT()})
    add(name, fieldtype); has(name); get(name)   // get() throws on unknown field
    names(); stored_names(); scorable_names(); items(); [Symbol.iterator]; copy()
  }
  export class FieldConfigurationError extends Error

/output/lib/index/storage.mjs
  // Real on-disk storage using node:fs sync APIs. Segment/term data serialized as JSON text.
  export class Storage                         // abstract base
  export class FileStorage extends Storage {
    constructor(path, {readonly = false} = {})
    create(); destroy(); folder
    create_file(name); open_file(name)          // open_file returns {readJSON(), readText()}
                                                // create_file returns {writeJSON(obj), writeText(s), close()}
    write_json(name, obj); read_json(name)
    file_exists(name); delete_file(name); list(); lock(name)
  }
  export class RamStorage extends Storage
  export class EmptyIndexError extends Error
/output/lib/index/segment.mjs
  export class Segment {
    constructor(indexname, segid, doccount = 0, deleted = null)
    doc_count(); doc_count_all(); has_deletions(); is_deleted(docnum); delete_document(docnum)
    segment_id(); make_filename(ext)
    toJSON(); static fromJSON(obj)
  }
  export function generate_segment_name(indexname, counter)   // MUST be deterministic (no
                                                              // Math.random / Date.now - they are
                                                              // unavailable/forbidden here): use the counter.
/output/lib/index/writer.mjs
  export class IndexWriter {
    constructor(ix)
    add_document(fields = {})       // fields is an object mapping field name -> value.
                                    // Unknown field name -> throw. Missing fields are fine.
                                    // Builds the inverted index: for each indexed field, run the
                                    // field's analyzer, accumulate term -> {docnum: freq} postings,
                                    // record field lengths, and store stored-field values.
                                    // A document with only empty/stopworded values still counts as a document.
    update_document(fields = {}); delete_by_term(fieldname, text); delete_document(docnum)
    commit(); cancel(); searcher()
  }
export /output/lib/index/reader.mjs
  export class IndexReader {
    constructor(storage, schema, segment, data)
    doc_count(); doc_count_all(); all_doc_ids(); is_deleted(docnum)
    stored_fields(docnum); all_stored_fields()
    has_term(fieldname, text); term_info(fieldname, text); doc_frequency(fieldname, text)
    frequency(fieldname, text); postings(fieldname, text)     // -> matcher over docnums
    field_length(fieldname); max_field_length(fieldname); doc_field_length(docnum, fieldname, def = 0)
    indexed_field_names(); all_terms(); expand_prefix(fieldname, prefix)
    doc_ids_with_field(fieldname)   // docnums having at least one indexed term in that field
    close()
  }
/output/lib/index/index.mjs
  export const TOC_FILENAME_PREFIX, DEFAULT_INDEX_NAME   // 'MAIN'
  export function create_in(dirname, schema, indexname = DEFAULT_INDEX_NAME)  // mkdir -p, returns FileIndex
  export function open_dir(dirname, {indexname = DEFAULT_INDEX_NAME, readonly = false} = {})
  export function exists_in(dirname, indexname = DEFAULT_INDEX_NAME)
  export class FileIndex {
    constructor(storage, {schema = null, indexname = DEFAULT_INDEX_NAME} = {})
    schema (property); storage; indexname
    writer(); searcher(opts = {}); reader(); doc_count(); doc_count_all(); is_empty(); latest_generation(); close()
  }
  export class IndexError extends Error
  export class IndexVersionError extends Error

/output/lib/query/matching.mjs
  export class Matcher { is_active(); id(); next(); score(); weight(); all_ids(); reset(); skip_to(id) }
  export class NullMatcher extends Matcher
  export class ListMatcher extends Matcher     // constructor(ids, weights = null, scorer = null)
  export class UnionMatcher extends Matcher
  export class IntersectionMatcher extends Matcher
/output/lib/query/queries.mjs
  export class Query {
    matcher(searcher)                 // -> Matcher
    docs(searcher)                    // -> array of docnums (ascending)
    estimate_size(reader); normalize(); is_leaf(); field(); with_boost(b); toString(); equals(other)
  }
  export class Term extends Query      // constructor(fieldname, text, {boost = 1.0} = {})
  export class Every extends Query     // constructor(fieldname = null, {boost = 1.0} = {})
      // Whoosh semantics: fieldname null OR '*' -> matches ALL non-deleted documents in the index
      // (this is what the source uses: Every() with no arguments).
      // A concrete fieldname -> only documents that have at least one indexed term in that field.
  export class And extends Query; export class Or extends Query; export class AndNot extends Query
  export class Not extends Query; export class NullQuery extends Query
  export class Prefix extends Query; export class Phrase extends Query
/output/lib/searching/scoring.mjs
  export class WeightingModel { scorer(searcher, fieldname, text, qf = 1) }
  export class BM25F extends WeightingModel    // B = 0.75, K1 = 1.2
  export class Frequency extends WeightingModel
  export class TF_IDF extends WeightingModel
  export function bm25(idf, tf, fl, avgfl, B, K1)
/output/lib/searching/results.mjs
  export class Hit {
    constructor(results, docnum, pos = null, score = null)
    docnum; score; rank; fields(); get(name, def = null); has(name); highlights()
  }
  export class Results {
    constructor(searcher, q, hits, {docset = null, runtime = 0, limit = null} = {})
    __len__()          // Python len(results): the TOTAL number of matching documents in the index,
                       // NOT capped by the search limit. THIS IS WHAT THE SCRIPT PRINTS.
    scored_length()    // number of scored hits actually returned (capped by limit)
    estimated_length(); estimated_min_length(); docs(); docset
    is_empty(); [Symbol.iterator]; hit(i); top_n; score(n); scored_list
    // DO NOT define a property or getter named 'length' on Results - py.len() must route
    // through __len__(). Provide size() as a readable alias for __len__() if you like.
  }
/output/lib/searching/searcher.mjs
  export class Searcher {
    constructor(reader, {weighting = null, schema = null, ix = null} = {})
    reader; schema; doc_count(); doc_count_all(); up_to_date()
    search(query, {limit = 10, sortedby = null, reverse = false, scored = true,
                   optimize = true, filter = null, mask = null, terms = false,
                   groupedby = null, collector = null} = {})   // -> Results
        // limit = null means unlimited. Default limit is 10 (Whoosh's default) but the
        // Results total length must still reflect ALL matching documents.
    search_page(...); documents(kwargs); document(kwargs); document_number(kwargs)
    stored_fields(docnum); postings(fieldname, text); idf(fieldname, text); close()
  }
/output/lib/qparser/parser.mjs
  // The Python source imports QueryParser (unused at runtime) - mirror it faithfully.
  export class QueryParser {
    constructor(fieldname, schema, {group = null, plugins = null} = {})
    parse(text, {normalize = true, debug = false} = {})   // -> Query
        // Support: bare terms, quoted phrases, field:term, AND / OR / NOT / ANDNOT keywords,
        // prefix*, parenthesised groups. Terms are run through the field's analyzer.
    add_plugin(p); remove_plugin_class(c); tag(text); process(text)
  }
  export class SyntaxError_ extends Error
/output/lib/whoosh.mjs
  // Barrel module re-exporting the public surface so the entry can import from one place if
  // desired: fields (Schema, TEXT, ID, ...), index (create_in, open_dir), qparser (QueryParser),
  // query (Every, Term, ...), analysis, searching.

/output/test11.mjs
  // Mirrors /workspace/dataset/test11.py line for line, in the SAME ORDER, with the SAME comments,
  // importing from the library modules the way the Python file imports from whoosh submodules
  // (e.g. import { Schema, TEXT, ID } from './lib/fields/schema.mjs' + fieldtypes, create_in from
  // './lib/index/index.mjs', QueryParser from './lib/qparser/parser.mjs', Every from
  // './lib/query/queries.mjs'). Keep the unused ID / QueryParser imports for 1:1 fidelity.
  // Final statement: print(len(results))  ->  must emit exactly "3\\n".
`

phase('Semantics')

const SEMANTICS_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    conclusions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          answer: { type: 'string' },
          confidence: { type: 'string' },
          implementation_note: { type: 'string' },
        },
        required: ['topic', 'answer', 'confidence', 'implementation_note'],
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['lens', 'conclusions', 'risks'],
}

const LENSES = [
  {
    key: 'results-semantics',
    prompt: `You are a Whoosh (Python full-text search library) expert. Answer from your knowledge of Whoosh's PUBLIC API behavior only - you may NOT read whoosh source (it is not installed; the only artifact is a PyInstaller executable you must not unpack).

Questions:
1. In Whoosh, searcher.search(query) has a default limit. What is it?
2. What exactly does len(results) return for a whoosh.searching.Results object - the number of scored hits returned (capped by limit), or the total number of matching documents? Explain the distinction between len(results), results.scored_length(), and results.estimated_length().
3. What does whoosh.query.Every() with NO fieldname argument match? What about Every('fieldname')?
4. Does a document whose every field value analyzes to ZERO tokens (e.g. all values are the empty string, or entirely stop words) still get counted as a document in the index, and is it still matched by Every()?
5. After writer.commit(), does ix.searcher() see all 3 documents?

The observed program adds 3 documents and prints len(searcher.search(Every())). Measured output is always exactly 3, for every input including all-empty strings. Reconcile your answers with that.`,
  },
  {
    key: 'analysis-semantics',
    prompt: `You are a Whoosh expert. From knowledge of Whoosh's PUBLIC documented behavior (no source access):

1. What is the default analyzer for a whoosh.fields.TEXT field? Name its exact component chain.
2. What is the default regular expression used by Whoosh's RegexTokenizer / StandardAnalyzer default? Write it out.
3. What is Whoosh's default English stop word list (whoosh.analysis.STOP_WORDS)? List every word you believe is in it.
4. What is the default minsize for StopFilter in StandardAnalyzer, and what does minsize do?
5. What is the default analyzer for a whoosh.fields.ID field, and how does it tokenize "the quick brown fox"?
6. TEXT(stored=True) vs TEXT(): what does stored change?

Then: this is being ported to JavaScript. Python's re \\w on a str is unicode-aware; JavaScript's \\w is ASCII-only. Specify the exact JS regex (with flags) that best reproduces Python's \\w for tokenization, and explain the failure mode if bare \\w were used with input like "héllo 世界".`,
  },
  {
    key: 'argparse-fidelity',
    prompt: `You are a CPython argparse internals expert. A parser is built as:

  parser = argparse.ArgumentParser()
  parser.add_argument('--a', type=str, required=True)
  parser.add_argument('--b', type=str, required=True)
  parser.add_argument('--c', type=str, required=True)
  args = parser.parse_args()

${GROUND_TRUTH}

Explain the precise ALGORITHM needed to reproduce every measured behavior in a hand-written JS port, specifically:
1. How argparse decides whether a token that starts with '-' is an option or a value (the _negative_number_matcher rule, the "contains a space" rule, and the _has_negative_number_optionals flag). Why is "-5" accepted as a value for --a but "-x" is not?
2. Exactly when 'expected one argument' is raised vs 'unrecognized arguments'.
3. Why does "-a 1 --b 2 --c 3" report "the following arguments are required: --a" instead of "unrecognized arguments: -a 1"? Describe the parse_known_args / parse_args split and the ordering of the required-check.
4. How the usage string is generated and in what order optionals appear.
5. How prog is derived (os.path.basename(sys.argv[0])).
6. How '--opt=value' is split, and whether '--a=-x' is accepted.
7. How is a bare '--' handled in this Python version, given the measured result is: error "unrecognized arguments: --"?
8. Help output formatting: exact column alignment for the options block.
Return a precise spec an implementer can follow mechanically.`,
  },
]

const semantics = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `semantics:${l.key}`, phase: 'Semantics', schema: SEMANTICS_SCHEMA })
))

const semanticsDigest = semantics.filter(Boolean).map(s =>
  `--- LENS: ${s.lens} ---\n` +
  s.conclusions.map(c => `* ${c.topic} [${c.confidence}]: ${c.answer}\n  IMPL: ${c.implementation_note}`).join('\n') +
  (s.risks && s.risks.length ? `\nRISKS: ${s.risks.join(' | ')}` : '')
).join('\n\n')

log(`Semantics consensus gathered from ${semantics.filter(Boolean).length} lenses`)

phase('Implement')

const COMMON = `${GROUND_TRUTH}\n${CONTRACT}\n
=== SEMANTICS CONSENSUS FROM THE RESEARCH PHASE (use it; flag anything you believe is wrong) ===
${semanticsDigest}

WORKING RULES:
 - Create parent directories as needed (node's fs mkdir with recursive is fine from your shell).
 - Write ONLY the files assigned to you. Other agents own the other files; do not create or edit theirs.
 - Import from sibling modules per the contract - assume they exist even if not yet written.
 - Write real, working, idiomatic implementations. No stubs, no TODOs, no placeholder throws.
 - Do not use Math.random() or Date.now() for identity/naming - keep everything deterministic.
 - Add concise JSDoc-style comments explaining the Whoosh behavior each piece reproduces.
 - You may run 'node --check <file>' to syntax-check your files.
 - Report what you wrote and any contract deviation you were forced to make.
`

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    exports_provided: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['files', 'exports_provided', 'deviations', 'notes'],
}

const GROUPS = [
  {
    key: 'compat',
    files: '/output/lib/util/py.mjs, /output/lib/compat/argparse.mjs, /output/lib/compat/tempfile.mjs',
    extra: `This is the HIGHEST-RISK group: argparse fidelity is explicitly graded. Implement the full
algorithm from the measured ground truth: option/value disambiguation including the negative-number
rule, '--opt=value', the required-check-before-unrecognized ordering, exact error strings, exact help
text and usage string, stderr vs stdout routing, exit codes (2 for error, 0 for help).
Use process.stdout.write / process.stderr.write (NOT console.log) inside argparse so the byte output
is exact, and process.exit for the exit codes.
py.mjs len() MUST prefer obj.__len__() so that len(results) routes to Results.__len__().
tempfile.mkdtemp must build a unique directory name WITHOUT Math.random/Date.now - use an
incrementing in-process counter combined with process.pid, and retry on collision.`,
  },
  {
    key: 'analysis',
    files: '/output/lib/analysis/token.mjs, /output/lib/analysis/stopwords.mjs, /output/lib/analysis/tokenizers.mjs, /output/lib/analysis/filters.mjs, /output/lib/analysis/analyzers.mjs',
    extra: `Reproduce Whoosh's analysis pipeline as a lazy generator chain: tokenizer yields Token
objects, each filter transforms the stream. StandardAnalyzer = RegexTokenizer(default word pattern)
-> LowercaseFilter -> StopFilter({minsize: 2}).
The tokenizer regex MUST be unicode-correct (Python \\w equivalence) - use unicode property escapes
with the u flag and build a FRESH regex per tokenize() call (or reset lastIndex) so the global-flag
lastIndex is never shared across calls: a stale lastIndex is a classic correctness bug here.
Handle empty string, whitespace-only, and unicode input without throwing (they simply yield no tokens).
Whoosh reuses one Token object while iterating; you may yield distinct Token objects for safety, but
document that difference.`,
  },
  {
    key: 'fields',
    files: '/output/lib/fields/fieldtypes.mjs, /output/lib/fields/schema.mjs',
    extra: `TEXT/ID/etc. are FACTORY FUNCTIONS returning FieldType instances so that the call syntax
TEXT({stored: true}) mirrors Python's TEXT(stored=True). They must also work with no arguments.
FieldType.index(value) runs the analyzer and returns one tuple per UNIQUE term with its frequency
(and a weight), plus the caller needs the total token count for field length - expose that too
(e.g. return {terms: [...], length: n} from a dedicated method, and keep index() tuple-shaped as
specified; document precisely which method the writer should call).
Coordinate: /output/lib/index/writer.mjs is being written by another agent against the contract, so
keep index()/process_text() signatures exactly as the contract states and make the extra
length-reporting method obvious and defensively usable (writer may call index() only).
IMPORTANT: make FieldType.index() ALSO return length information in a way that cannot break a caller
that just iterates tuples - e.g. attach a non-enumerable/extra property .field_length on the returned
array AND provide word_count(value). Document this in a header comment.
Schema must preserve field insertion order, expose names() sorted the way Whoosh does (Whoosh's
Schema iterates field names in sorted order - state your choice in a comment and be consistent).`,
  },
  {
    key: 'index',
    files: '/output/lib/index/storage.mjs, /output/lib/index/segment.mjs, /output/lib/index/writer.mjs, /output/lib/index/reader.mjs, /output/lib/index/index.mjs',
    extra: `This is the LARGEST group. Build a genuine on-disk inverted index with node:fs sync APIs:
create_in(dirname, schema) creates the directory if needed, writes a table-of-contents file, and
returns a FileIndex. writer() returns an IndexWriter that accumulates documents in memory and, on
commit(), serializes to the storage as JSON (TOC + segment file containing: schema field names,
stored fields per docnum, term postings {field: {term: {docnum: freq}}}, per-doc field lengths,
doc count, deletions). searcher() reads it back through IndexReader.
Key fidelity requirements:
 - add_document must ACCEPT documents that produce zero tokens and still increment doc count.
 - Unknown field names in add_document must throw (Whoosh raises an error).
 - reader.doc_count() excludes deleted docs; doc_count_all() includes them.
 - reader.doc_ids_with_field(fieldname) returns docnums with >=1 indexed term in that field.
 - Deterministic segment naming (no randomness).
 - The writer must call the fields' FieldType methods per the contract to analyze values.
 - Everything synchronous; no async/await, no promises.
Be robust: if a stored value is undefined/null, omit it rather than crashing. JSON round-trip must
not lose empty-string values.`,
  },
  {
    key: 'query',
    files: '/output/lib/query/matching.mjs, /output/lib/query/queries.mjs',
    extra: `Implement the query tree and matchers over the IndexReader interface in the contract.
Every() with no fieldname (the case the script uses) must match ALL non-deleted docnums via
reader.all_doc_ids(); Every('f') must use reader.doc_ids_with_field('f').
Term uses reader.postings(fieldname, text). And/Or/AndNot/Not compose matchers.
Matchers are simple synchronous cursors: is_active(), id(), next(), score(), all_ids().
Query.docs(searcher) must accept EITHER a Searcher or an IndexReader (duck-type: if the argument has
a .reader property use it, else treat it as the reader) - this defensiveness prevents an integration
break. Terms in Term queries are matched as already-analyzed text (no re-analysis).`,
  },
  {
    key: 'searching',
    files: '/output/lib/searching/scoring.mjs, /output/lib/searching/results.mjs, /output/lib/searching/searcher.mjs',
    extra: `Searcher.search(query, {limit = 10}) must:
 1. collect ALL matching docnums from the query (full docset),
 2. score them (BM25F by default; Every() is an unscored/all-docs query - give every hit the same
    score, which is what Whoosh effectively does for Every),
 3. sort by score desc then docnum asc,
 4. keep only the first 'limit' hits as scored hits (limit null/0 => unlimited),
 5. return Results carrying BOTH the capped hit list AND the FULL docset.
Results.__len__() returns the FULL docset size (total matching documents) - NOT the capped hit count.
This is the value the program prints, so it is the single most important line in this group.
Do NOT define a 'length' property/getter on Results (py.len must fall through to __len__()).
Results must be iterable over Hit objects and support hit(i), docs(), scored_length(), is_empty().
Everything synchronous.`,
  },
  {
    key: 'qparser',
    files: '/output/lib/qparser/parser.mjs',
    extra: `The Python source imports QueryParser but never calls it; still implement a real, working
parser (it is part of the deliverable's library surface). Support bare terms, quoted phrases,
field:term, AND/OR/NOT/ANDNOT keywords, prefix*, and parentheses, producing the query classes from
/output/lib/query/queries.mjs. Run terms through the schema field's analyzer (a term that analyzes
away to nothing yields NullQuery). Default grouping for multiple bare terms: AND (Whoosh's default
group is AndGroup).`,
  },
]

const implResults = await parallel(GROUPS.map(g => () =>
  agent(`Implement the ${g.key.toUpperCase()} module group for a Python-to-Node.js migration.

FIRST: read /workspace/dataset/test11.py so you understand the target program.

YOUR FILES (write exactly these, nothing else):
${g.files}

${g.extra}

${COMMON}`, { label: `impl:${g.key}`, phase: 'Implement', schema: IMPL_SCHEMA })
))

const deviations = implResults.filter(Boolean).flatMap(r => (r.deviations || []).map(d => `[${(r.files || [])[0] || 'unknown'}] ${d}`))
log(`Implemented ${implResults.filter(Boolean).length}/${GROUPS.length} module groups; ${deviations.length} reported contract deviations`)

phase('Integrate')

const INTEGRATE_SCHEMA = {
  type: 'object',
  properties: {
    entry_written: { type: 'boolean' },
    barrel_written: { type: 'boolean' },
    happy_path_stdout_matches: { type: 'boolean' },
    actual_stdout_bytes: { type: 'string' },
    fixes_applied: { type: 'array', items: { type: 'string' } },
    remaining_problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['entry_written', 'barrel_written', 'happy_path_stdout_matches', 'actual_stdout_bytes', 'fixes_applied', 'remaining_problems'],
}

const integration = await agent(`You are the INTEGRATOR for a Python-to-Node.js migration. Seven agents just wrote the library
modules in /output/lib per a locked contract. Your job:

1. Write /output/lib/whoosh.mjs (the barrel re-exporting the public surface).
2. Write /output/test11.mjs - the entry point mirroring /workspace/dataset/test11.py line for line,
   same order, same trailing comments. Read the Python file first.
3. Run it and make it work END TO END:
     node /output/test11.mjs --a hello --b world --c foo     -> must print exactly "3" + newline
   Verify byte-exactly, e.g.:
     node /output/test11.mjs --a hello --b world --c foo | od -c
     diff <(node /output/test11.mjs --a x --b y --c z) <(/workspace/dataset/test11_executable --a x --b y --c z)
4. FIX every crash, missing export, signature mismatch, or wrong-name import you find ANYWHERE in
   /output/lib - you now own all files. Prefer making the *importing* side match the contract; if a
   module deviated from the contract, fix that module.
5. Re-run these and make them all pass (stdout, stderr and exit code compared against the
   executable, which is the reference):
     --a hello --b world --c foo   |  --a "" --b "" --c ""   |  --a x --b x --c x
     --a "the quick brown fox" --b "jumps over" --c "lazy dog"
     --a=1 --b=2 --c=3   |  --a -5 --b 2 --c 3   |  --a=-x --b 2 --c 3
     --a "héllo 世界" --b "ünïcode" --c ok
     --a 1 --b 2          (stderr, exit 2)
     (no args)            (stderr, exit 2)
     --a 1 --b 2 --c 3 --d 4  |  --a 1 --b 2 --c    |  --a -x --b 2 --c 3
     -h
   NOTE: for stderr/help comparisons the reference prog name is 'test11_executable' while ours is
   'test11.mjs' - that ONE substitution is expected and correct; everything else must match
   character for character. Use sed to normalize the prog name when diffing.

${GROUND_TRUTH}
${CONTRACT}

Contract deviations self-reported by the implementers:
${deviations.length ? deviations.join('\n') : '(none reported)'}

Report honestly: if something still fails, say exactly what.`, { label: 'integrate', phase: 'Integrate', schema: INTEGRATE_SCHEMA })

log(`Integration: happy path matches = ${integration && integration.happy_path_stdout_matches}; ${integration && integration.remaining_problems ? integration.remaining_problems.length : '?'} remaining problems`)

phase('Verify')

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          severity: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
          reproduction: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'severity', 'title', 'detail', 'fix'],
      },
    },
    verdict: { type: 'string' },
  },
  required: ['lens', 'findings', 'verdict'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    severity_after_review: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

const VERIFY_LENSES = [
  {
    key: 'differential-cli',
    prompt: `ADVERSARIAL DIFFERENTIAL TESTER. Reference implementation: /workspace/dataset/test11_executable
Port under test: node /output/test11.mjs

Write and run a thorough differential test sweep comparing stdout, stderr and exit code. Cover at
minimum: normal words, empty strings, all-identical values, multi-word values, values that are
entirely stop words (e.g. "the and of"), single characters (minsize edge), unicode (CJK, accents,
emoji), very long values, values with newlines/tabs/quotes/backslashes, values that look like flags
(--a=-5, --a -5, --a -5.5, --a=--b), duplicate flags, argument order permutations, '=' forms, missing
each required arg, unknown flags, extra positionals, bare '--', -h/--help in various positions,
and args after --.
The ONLY difference allowed anywhere is the program name (test11_executable vs test11.mjs) in
usage/error/help text. Normalize that with sed before diffing; everything else must be byte-identical.
Report EVERY divergence as a finding with the exact command that reproduces it.
Do not fix anything - only report. Be exhaustive; run at least 30 cases.`,
  },
  {
    key: 'compliance',
    prompt: `ADVERSARIAL COMPLIANCE AUDITOR. Audit /output against these NON-NEGOTIABLE requirements and
report every violation as a finding:
 1. ESM only: no require(, no module.exports, no exports. anywhere. Check with grep.
 2. Every file ends in .mjs. No .js/.cjs/.json/package.json-with-type files sneaked in.
 3. Every relative import includes the .mjs suffix (no extensionless, no directory imports).
 4. ZERO external dependencies: every non-relative import must be a node: builtin. Flag any bare
    specifier (e.g. 'fs' without the node: prefix is a smell; an npm name is a fatal violation).
    Also flag any node_modules dir or package.json listing dependencies.
 5. No embedded/spawned Python, no child_process at all, no shelling out.
 6. All library code lives under /output (nothing written outside /output; nothing importing from
    /workspace).
 7. Hierarchical organization: libraries split into multiple modules by functionality, each exposing
    interfaces via export. Confirm the tree is genuinely layered (util/compat/analysis/fields/index/
    query/searching/qparser) and that no module is an empty stub or a TODO placeholder.
 8. No unreachable/dead file that fails to parse: run 'node --check' on EVERY .mjs file and report
    any that fail.
 9. No top-level await in library modules; no async/promises in the index/search path.
10. Confirm nothing imports a JS third-party search/text library or mentions one as an interface.
Use find/grep/node --check. Report findings only; do not fix.`,
  },
  {
    key: 'argparse-fidelity',
    prompt: `ADVERSARIAL ARGPARSE AUDITOR. Read /output/lib/compat/argparse.mjs closely and stress it against
the reference /workspace/dataset/test11_executable.

${GROUND_TRUTH}

Hunt specifically for:
 - Wrong error text, wrong stream (stdout vs stderr), wrong exit code.
 - The required-check-before-unrecognized ordering rule being violated.
 - '--opt=value' mishandling, including '--a=' (empty value) and '--a=-x'.
 - The negative-number rule: '-5' and '-5.5' must be VALUES; '-x' and '--b' must NOT be.
 - Multiple unrecognized args joined with a single space in the message.
 - Help output byte differences (column alignment, blank lines, 'options:' header, trailing newline).
 - Duplicate flags (last wins), argument order independence.
 - Any place the parser would throw a JS exception (stack trace) instead of printing an argparse
   error - a stack trace is always a finding.
 - Any use of console.log where exact bytes matter.
Run the real commands on both binaries to prove each finding. Report findings only; do not fix.`,
  },
  {
    key: 'semantic-fidelity',
    prompt: `ADVERSARIAL SEMANTIC AUDITOR for a Whoosh reimplementation. Read /workspace/dataset/test11.py, then
read ALL of /output/lib and /output/test11.mjs.

Judge whether the JS library is a faithful black-box reimplementation of the Whoosh behavior the
script exercises - not just whether it happens to print 3. Specifically:
 - Does the entry file mirror the Python file statement for statement, in order (schema, mkdtemp,
   create_in, writer, three add_document calls, commit, searcher, Every(), search, print(len(...)))?
 - Is a REAL inverted index actually built and persisted to the temp dir and read back, or is the
   count faked/short-circuited (e.g. a hardcoded 3, a counter that ignores the index, search()
   ignoring the query, Results.__len__ returning a constant)? Hardcoding or short-circuiting the
   answer is the most serious possible finding - hunt for it explicitly.
 - Does len(results) route through Results.__len__() and return the TOTAL matching docset size
   rather than the limit-capped hit count? Prove it: write a throwaway .mjs script in /tmp that
   builds an index with 25 documents and asserts len(search(Every())) === 25 while
   scored_length() === 10 (Whoosh's default limit). Report the actual numbers.
 - Does StandardAnalyzer lowercase + drop stopwords + apply minsize 2? Prove with a /tmp script:
   analyze 'The Quick a bc' and report the token texts.
 - Is the tokenizer regex unicode-correct (Python \\w semantics)? Test 'héllo 世界 naïve_x1'.
 - Does the tokenizer share regex lastIndex across calls (stateful global-flag bug)? Call the same
   analyzer twice on the same input and confirm identical results.
 - Do empty-string documents still count as documents?
 - Does Every('title') differ correctly from Every()?
 - Any crash on odd input (very long strings, emoji, only-stopwords)?
 - Does the temp dir actually get created and contain index files? Print its contents from a /tmp
   probe script.
Report findings only; do not fix. Cite file:line for each.`,
  },
  {
    key: 'robustness',
    prompt: `ADVERSARIAL ROBUSTNESS / CODE-QUALITY AUDITOR. The deliverable is /output (a zero-dependency ESM
port of a Whoosh script). Read every file under /output.

Hunt for real defects a reviewer would insist on fixing:
 - Any code path that can throw an unhandled JS exception and print a stack trace for input the CLI
   accepts (empty string, unicode, huge input, only stop words, values equal to '__proto__' or
   'constructor' or 'toString' - PROTOTYPE POLLUTION / prototype-key collision when using plain
   objects as term/stored-field maps is a classic real bug here: test --a __proto__ --b constructor
   --c toString and also --a hasOwnProperty).
 - Objects used as maps without Object.create(null) or Map, where a document value could shadow
   Object.prototype members.
 - fs errors ignored, temp dirs never created, writes to relative paths, non-deterministic naming.
 - Off-by-one in doc counts, deletions, or limit capping.
 - Broken JSON round-trip (empty strings, unicode, numeric-looking keys reordering).
 - Dead code, duplicated logic across modules, misleading comments, exports that do not exist,
   imports of names a module does not export (grep each import against the target file's exports -
   this catches integration rot).
 - Any leftover stub, TODO, or function that returns a placeholder.
Run the port with the nasty inputs above and compare to /workspace/dataset/test11_executable.
Report findings only; do not fix. Cite file:line.`,
  },
]

const verifyResults = await pipeline(
  VERIFY_LENSES,
  l => agent(l.prompt, { label: `verify:${l.key}`, phase: 'Verify', schema: FINDINGS_SCHEMA }),
  (res, l) => {
    if (!res || !res.findings || !res.findings.length) return { lens: l.key, confirmed: [] }
    return parallel(res.findings.map(f => () =>
      agent(`You are a SKEPTIC. Try to REFUTE this claimed defect in the Node.js port at /output.

CLAIM (lens: ${l.key})
file: ${f.file}
severity: ${f.severity}
title: ${f.title}
detail: ${f.detail}
reproduction: ${f.reproduction || '(none given)'}
proposed fix: ${f.fix}

Reference implementation for behavioral questions: /workspace/dataset/test11_executable
The port's entry point: node /output/test11.mjs
The ONE allowed difference is the program name in usage/error/help text (test11_executable vs test11.mjs).

Actually run commands and read the cited code. Refute the claim if: it does not reproduce; it
describes a difference that is not observable through the CLI or the library's public surface and
does not violate a stated requirement; the "bug" is intended Whoosh behavior; or the prog-name
difference is all it amounts to. Confirm it only if you can demonstrate it.
Default to refuted = true when you cannot demonstrate the defect.`, { label: `refute:${l.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then(v => ({ finding: f, verdict: v }))
    )).then(votes => ({
      lens: l.key,
      confirmed: votes.filter(Boolean).filter(v => v.verdict && !v.verdict.refuted).map(v => ({
        ...v.finding,
        severity: v.verdict.severity_after_review || v.finding.severity,
        confirmation: v.verdict.reason,
      })),
    }))
  }
)

const confirmed = verifyResults.filter(Boolean).flatMap(r => (r.confirmed || []).map(f => ({ ...f, lens: r.lens })))
log(`Verify: ${confirmed.length} findings survived adversarial refutation`)

phase('Fix')

let fixReport = null
if (confirmed.length) {
  const byFile = {}
  for (const f of confirmed) {
    const k = f.file || 'unknown'
    if (!byFile[k]) byFile[k] = []
    byFile[k].push(f)
  }
  const fileList = Object.keys(byFile)
  const digest = confirmed.map((f, i) =>
    `#${i + 1} [${f.severity}] ${f.file} - ${f.title}\n   detail: ${f.detail}\n   repro: ${f.reproduction || 'n/a'}\n   fix: ${f.fix}\n   why it survived review: ${f.confirmation}`
  ).join('\n\n')

  fixReport = await agent(`You are the FIXER. ${confirmed.length} defects in the Node.js port at /output survived adversarial
review. Apply a correct fix for each, then re-verify.

${digest}

Files implicated: ${fileList.join(', ')}

Rules:
 - Preserve the hard requirements: ESM only (no require/module.exports), .mjs suffixes everywhere,
   .mjs in every relative import, zero external dependencies (node: builtins only), everything under
   /output, hierarchical module split, no Python, no child_process in the deliverable.
 - Do not paper over a defect by hardcoding the answer 3 or short-circuiting the search - the index
   must really be built and queried.
 - After fixing, run 'node --check' on every .mjs file, then run the full differential sweep against
   /workspace/dataset/test11_executable (happy paths, unicode, empty strings, prototype-key inputs
   like --a __proto__ --b constructor --c toString, every argparse error path, -h) and confirm
   byte-identical output modulo the program name.
Report exactly what you changed and the final test results, honestly.`, { label: 'fix', phase: 'Fix', schema: {
    type: 'object',
    properties: {
      changes: { type: 'array', items: { type: 'string' } },
      unfixed: { type: 'array', items: { type: 'string' } },
      all_tests_pass: { type: 'boolean' },
      test_summary: { type: 'string' },
    },
    required: ['changes', 'unfixed', 'all_tests_pass', 'test_summary'],
  } })
} else {
  log('No confirmed findings - skipping fix phase')
}

phase('Final')

const final = await agent(`FINAL GATEKEEPER for the Python-to-Node.js migration deliverable in /output.

Run one last independent, exhaustive validation. Do not fix anything unless something is broken - if
it is broken, fix it and re-validate.

1. Tree: list every file under /output. Confirm hierarchical .mjs layout, entry at /output/test11.mjs.
2. 'node --check' every .mjs file.
3. grep the whole tree for: require(, module.exports, from 'fs', from "fs", child_process,
   node_modules, python, and any bare (non-node:, non-relative) import specifier. All must be clean.
4. Differential sweep vs /workspace/dataset/test11_executable - stdout, stderr, exit code - over at
   least these cases (normalize only the program name test11_executable -> test11.mjs):
   happy: --a hello --b world --c foo | --a "" --b "" --c "" | --a x --b x --c x |
          --a "the quick brown fox" --b "jumps over" --c "lazy dog" | --a=1 --b=2 --c=3 |
          --a -5 --b 2 --c 3 | --a -5.5 --b 2 --c 3 | --a=-x --b 2 --c 3 |
          --a 1 --a 9 --b 2 --c 3 | --a "héllo 世界" --b "ünïcode" --c ok |
          --a __proto__ --b constructor --c toString | --a "the and of" --b "a an" --c "is it"
   errors: (no args) | --a 1 --b 2 | --a 1 --b 2 --c 3 --d 4 | --a 1 --b 2 --c 3 extra |
           --a 1 --b 2 --c 3 -- | --a 1 --b 2 --c | --a --b --b 2 --c 3 | --a -x --b 2 --c 3 |
           -a 1 --b 2 --c 3 | --A 1 --b 2 --c 3
   help:   -h | --help | --a 1 -h | --a 1 --b 2 --c 3 --help
5. Confirm the happy-path stdout is EXACTLY the two bytes 0x33 0x0a (verify with od -c).
6. Confirm the index is genuinely built: write a probe in /tmp that imports from /output/lib, creates
   an index of 25 docs, and asserts len(search(Every())) === 25 and scored_length() === 10. Report
   the numbers. Also confirm the temp dir created by a real run contains index files (a probe that
   prints the directory listing).
7. Confirm no hardcoded '3' anywhere in the count path.

Report the complete pass/fail table and the final file tree.`, { label: 'final-gate', phase: 'Final', schema: {
  type: 'object',
  properties: {
    file_tree: { type: 'array', items: { type: 'string' } },
    syntax_check_all_pass: { type: 'boolean' },
    compliance_clean: { type: 'boolean' },
    differential_all_match: { type: 'boolean' },
    happy_path_bytes_exact: { type: 'boolean' },
    index_really_built: { type: 'boolean' },
    total_len_25_scored_10: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
    fixes_applied: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['file_tree', 'syntax_check_all_pass', 'compliance_clean', 'differential_all_match', 'happy_path_bytes_exact', 'index_really_built', 'failures', 'summary'],
} })

return {
  deviations,
  integration,
  confirmedFindings: confirmed,
  fixReport,
  final,
}
