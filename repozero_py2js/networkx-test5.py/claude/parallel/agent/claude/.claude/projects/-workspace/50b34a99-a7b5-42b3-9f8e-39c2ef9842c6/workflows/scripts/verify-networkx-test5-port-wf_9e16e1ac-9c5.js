export const meta = {
  name: 'verify-networkx-test5-port',
  description: 'Adversarially review and differentially fuzz the Python->Node port of test5.py against the reference executable',
  phases: [
    { title: 'Fuzz', detail: 'differential fuzzing of the Node port vs the reference executable, by category' },
    { title: 'Review', detail: 'multi-lens source audit of the generated /output library' },
    { title: 'Verify', detail: 'adversarially confirm or refute each finding against the executable' },
    { title: 'Critic', detail: 'completeness critic: what surface was never exercised' },
  ],
}

const HARNESS = `
A differential harness exists at /tmp/difftest.mjs. It exports:
  compare(argvArray, envObject) -> {ok, py:{stdout,stderr,status}, js:{stdout,stderr,status}}
  report(cases) -> prints mismatches and an N/M summary, returns failure count
Cases are either an argv array, or {argv, env}. The program name ("test5_executable" vs
"test5.mjs") is normalised away before comparison, so it never counts as a mismatch.

Write your own driver script under /tmp/ (a unique filename, e.g. /tmp/fuzz_<yourtopic>.mjs)
that imports from '/tmp/difftest.mjs' and calls report() with your cases, then run it with node.
You may also invoke the reference directly: /workspace/dataset/test5_executable ARGS
and the port: node /output/test5.mjs ARGS

CRITICAL CONSTRAINTS on the port (violations are findings):
 - pure ESM, .mjs suffixes, no npm/external imports (only local ./ files and node: builtins)
 - no embedded Python, no child processes, no network
 - output must match the reference byte for byte on stdout, stderr and exit status

Do NOT modify anything under /output. Report only.
`

const SOURCE = `
The port under review lives in /output:
  test5.mjs                              entry point
  lib/python/{unicode,int,repr,textwrap,terminal,argv,io,errors,index}.mjs
  lib/argparse/{parser,actions,formatter,errors,index}.mjs
  lib/networkx/{index,exceptions}.mjs, lib/networkx/classes/{graph,digraph}.mjs,
  lib/networkx/algorithms/dag.mjs, lib/networkx/utils/hashing.mjs

The Python original is /workspace/dataset/test5.py:
  five required int options --a --b --c --d --e; builds a DiGraph with edges
  (a,b),(b,c),(c,d),(d,e); prints nx.is_directed_acyclic_graph(G).
The reference binary is /workspace/dataset/test5_executable (CPython + argparse + networkx frozen).
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'detail', 'repro', 'severity'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string', description: 'path, with :line if known' },
          detail: { type: 'string', description: 'what is wrong and why' },
          repro: { type: 'string', description: 'exact shell command or argv that shows the divergence, plus observed vs expected' },
          severity: { type: 'string', enum: ['output-divergence', 'requirement-violation', 'latent-bug', 'nit'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'evidence'],
  properties: {
    real: { type: 'boolean', description: 'true only if you reproduced an actual divergence or requirement violation' },
    evidence: { type: 'string', description: 'the command you ran and its actual output from BOTH programs' },
  },
}

const FUZZ_TOPICS = [
  {
    key: 'dag-semantics',
    prompt: `Differentially fuzz the GRAPH SEMANTICS surface. Exhaustively enumerate every 5-tuple
(a,b,c,d,e) drawn from a small alphabet so that all cycle/self-loop/duplicate-edge shapes are covered:
at minimum every tuple from {0,1,2} (243 cases) and every tuple from {1,2,3,4} (1024 cases).
Then add randomised large-value tuples, negative values, mixed sign, zeros, and huge integers beyond
2**53 (e.g. 99999999999999999999998 vs 99999999999999999999999 in the same tuple, and pairs that
differ only in their last digit) to check that node identity is not collapsed by floating point.
Report every argv where stdout/stderr/exit differ.`,
  },
  {
    key: 'int-parsing',
    prompt: `Differentially fuzz PYTHON int() PARSING of option values. Cover: leading/trailing ASCII
whitespace (space, tab, \\n, \\v, \\f, \\r) and the C0 separators \\x1c-\\x1f; non-ASCII whitespace
(U+0085, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000); signs (+, -, double
signs, sign with space after); underscores (valid 1_0, 1_000_000; invalid _1, 1_, 1__0, 1_-2);
non-decimal forms (0x10, 0b1, 5.0, 1e3, inf, nan); Unicode decimal digits from many scripts
(Arabic-Indic U+0660s, Extended Arabic-Indic U+06F0s, Devanagari U+0966s, Bengali, Thai U+0E50s,
Khmer, Mongolian, Limbu, N'Ko U+07C0s, Vai U+A620s, Fullwidth U+FF10s, Adlam U+1E950s, Brahmi
U+11066s, Osmanya, and ALL FIVE mathematical alphanumeric runs U+1D7CE-U+1D7FF); mixed-script digit
strings; digits combined with underscores; look-alikes that must be REJECTED (superscripts U+00B2,
vulgar fractions U+2155, Roman numerals U+2164, circled digits U+2460, U+2212 minus sign, Nl/No
category characters). For each accepted value verify the resulting DAG answer agrees, and for each
rejected value verify the error text agrees exactly (it embeds Python repr() of the string).
Use the self-loop oracle when you need to learn the numeric value a digit parsed to:
'--a K --b CHAR --c 1000 --d 2000 --e 3000' prints False exactly when CHAR parsed to K.`,
  },
  {
    key: 'argparse-surface',
    prompt: `Differentially fuzz the ARGPARSE surface. Cover: missing options (every subset of the five,
so all 32 combinations) and the exact ordering of the "required" list; repeated options (last wins);
--opt=value, --opt=, --opt=with=equals; the '--' separator in every position (before, between, after
options, doubled, as a value, as an explicit arg --e=--); values that look like options (-5, -x, --x,
'-', '', ' ', '-1.5', unicode-digit negatives like -\\u0665); abbreviations (--h, --he, --hel, --help,
and any ambiguous prefix); short options (-h, -a, -hx, -h5, -xh); unknown options interleaved with
known ones and the exact "unrecognized arguments" joining and ordering; extra positionals in every
position; -h/--help appearing before, among and after valid/invalid options (help must win, exit 0);
empty argv; and values containing spaces, newlines, tabs, quotes, backslashes and non-ASCII text
(these show up inside Python repr() in the error message, so escaping must match exactly).`,
  },
  {
    key: 'help-layout',
    prompt: `Differentially fuzz the HELP AND USAGE LAYOUT. argparse derives its wrap width from
shutil.get_terminal_size(), so sweep the COLUMNS environment variable over EVERY integer from 1 to
120 inclusive, plus 121, 150, 200, 500, 10000, and the malformed values '', '0', '-5', 'abc', '30x',
' 30 ' (padded, which Python's int() accepts), '+30', '3_0', and a Unicode-digit '\\uff13\\uff10'.
For each, compare BOTH 'node /output/test5.mjs --help' and an error path such as
'node /output/test5.mjs --a 1' (the usage line is reprinted before every error, so it must wrap
identically). Also check that help goes to stdout with exit 0 while errors go to stderr with exit 2,
and that the streams are not swapped or merged. Note the harness normalises the program name, which
is 16 chars in the reference and 9 in the port -- if you find a width where the two genuinely cannot
agree because of that length difference alone, say so explicitly and do NOT report it as a bug.`,
  },
]

const REVIEW_LENSES = [
  {
    key: 'requirements',
    prompt: `Audit COMPLIANCE with the migration requirements. Read every file under /output. Verify:
only 'import' and 'export' are used (no require, no module.exports, no dynamic import of packages);
every relative import carries an explicit .mjs suffix and resolves to a file that exists; every
non-relative import is a node: builtin (list them); no npm package is imported or even referenced;
no Python is embedded or shelled out to; no network or child-process use; all files live under
/output and use the .mjs suffix; the library is genuinely split into functional modules that export
their interfaces; the entry point is /output/test5.mjs. Also actually run 'node --check' on every
file, confirm every exported symbol in each index.mjs really exists in the module it re-exports
from, and confirm there is no dead or unreachable exported code that is never used and never part of
a documented public surface.`,
  },
  {
    key: 'argparse-fidelity',
    prompt: `Audit /output/lib/argparse/*.mjs against CPython's argparse as a SEMANTIC port. Focus on
_parse_known_args, _parse_optional, _get_option_tuples, _match_argument, _get_nargs_pattern,
_get_values and consume_optional. Look for: mistranslated control flow; the extras-collection order;
whether the required-argument check really runs before the unrecognized-argument check; the
'--' separator pattern handling; the joined short-option chain (-hx); prefix abbreviation and the
ambiguous-option path; whether error() short-circuits correctly (it throws, so check that no code
after an error() call can still run and produce output); off-by-one in the help formatter's
help_position / help_width / action_width arithmetic and the 0.75 usage threshold. Reason about
regex differences between Python and JavaScript: Python's \\d matches Unicode digits, Python's
str.split('=', 1) keeps the remainder intact, and JS String.replaceAll vs Python str.replace differ
on empty patterns. Prove each concern with a command against both binaries before reporting it.`,
  },
  {
    key: 'python-semantics',
    prompt: `Audit /output/lib/python/*.mjs as a port of CPython semantics. Scrutinise: pyInt against
_PyUnicode_TransformDecimalAndSpaceToASCII followed by PyLong_FromString (which ASCII code points
pass through untouched, which whitespace sets apply at each stage, and the exact underscore rule);
decimalValue's assumption that Unicode decimal-digit runs are ten long and contiguous, including
where several runs abut (U+1D7CE-U+1D7FF, U+FF10, U+1FBF0) -- verify the computed value for EVERY
Unicode Nd code point by cross-checking against the reference binary using the self-loop oracle
'--a K --b CHAR --c 1000 --d 2000 --e 3000' (prints False exactly when CHAR parsed to K) for a broad
sample including at least one digit from every Nd block; reprString against Python repr() including
quote selection, escape forms, the \\x/\\u/\\U cutoffs and str.isprintable's category set; textwrap's
greedy fill and long-word breaking; getTerminalColumns against shutil.get_terminal_size; and the
surrogateescape argv recovery in argv.mjs (does it stay correct when /proc is absent, when node
options are present, when an argument contains a NUL-adjacent byte sequence, and does it ever
corrupt a well-formed argv?). Prove each concern against the reference binary before reporting.`,
  },
  {
    key: 'graph-correctness',
    prompt: `Audit /output/lib/networkx/**/*.mjs. Verify: Kahn's algorithm in dag.mjs is correct for
self-loops, duplicate edges, multi-node cycles, disconnected components and the empty graph; that
remainingInDegree bookkeeping cannot go negative or miss a decrement when the same edge is added
twice or when a node has a self-loop; that in_degree/out_degree/neighbors agree with the adjacency
structures; that DiGraph's aliasing of _succ onto the inherited _adj cannot corrupt Graph's
undirected invariants or vice versa (check add_edge, has_edge, edges, degree, neighbors on BOTH
classes and construct a case where the inherited undirected add_edge would be reachable on a
DiGraph); and that nodeKey gives exactly Python's dict-key equivalence -- in particular that
integer-valued Numbers, BigInts and booleans unify, that huge BigInts never collide, that a numeric
key can never collide with a string or tuple key, and that the length-prefixed tuple encoding is
truly unambiguous. Write standalone node scripts under /tmp that import the modules directly and
assert these properties; report any that fail.`,
  },
  {
    key: 'runtime-robustness',
    prompt: `Audit RUNTIME ROBUSTNESS of the port as a program. Verify: no stdout/stderr truncation when
output is piped, redirected to a file, or sent to a closed pipe (test with 'head -c1', '| true',
and closing the pipe early); correct behaviour when stdout is a TTY versus a pipe versus /dev/null;
exit statuses; no unhandled promise rejection or stray stack trace on any input; that the SystemExit
catch in test5.mjs cannot swallow a genuine programming error; that fs.writeSync's EAGAIN retry loop
cannot spin forever or drop bytes for large outputs (force a very large usage line via a huge
COLUMNS value and pipe it through a slow reader); that reading /proc/self/cmdline cannot throw
uncaught or misalign argv (test with node options such as --no-warnings and --title, with an
argument containing invalid UTF-8 bytes produced via $'\\xff', and with an empty-string argument);
and that the port behaves identically when invoked from a different working directory or via a
relative or symlinked path. Compare against the reference binary under the same conditions.`,
  },
]

phase('Fuzz')
log(`differential fuzzing across ${FUZZ_TOPICS.length} categories and auditing with ${REVIEW_LENSES.length} lenses`)

// Fuzzers and reviewers are independent producers; each finding is verified as
// soon as its producer finishes rather than waiting on the whole pool.
const producers = [
  ...FUZZ_TOPICS.map((topic) => ({ ...topic, phase: 'Fuzz', body: `${HARNESS}\n${SOURCE}\n${topic.prompt}` })),
  ...REVIEW_LENSES.map((lens) => ({ ...lens, phase: 'Review', body: `${SOURCE}\n${HARNESS}\n${lens.prompt}` })),
]

const verified = await pipeline(
  producers,
  (producer) =>
    agent(
      `${producer.body}\n\nReturn only findings you have actually demonstrated. An empty findings list is a fine and common answer. Never guess.`,
      { label: `${producer.phase.toLowerCase()}:${producer.key}`, phase: producer.phase, schema: FINDINGS_SCHEMA },
    ),
  (result, producer) =>
    parallel(
      (result?.findings ?? []).map((finding) => () =>
        agent(
          `${SOURCE}\n${HARNESS}\n\nA reviewer claims the following defect in the port:\n` +
            `title: ${finding.title}\nfile: ${finding.file}\nseverity: ${finding.severity}\n` +
            `detail: ${finding.detail}\nrepro: ${finding.repro}\n\n` +
            `Try hard to REFUTE it. Run the repro yourself against BOTH /workspace/dataset/test5_executable ` +
            `and 'node /output/test5.mjs'. Remember the program name differs legitimately ` +
            `(test5_executable vs test5.mjs) and a divergence explained solely by that is NOT real. ` +
            `Set real=true only if you personally observed a genuine byte-level divergence in stdout, ` +
            `stderr or exit status, or a black-and-white violation of the stated constraints. ` +
            `Default to real=false when uncertain. Quote the actual output of both programs as evidence.`,
          { label: `verify:${producer.key}:${finding.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((verdict) => ({ ...finding, source: producer.key, verdict })),
      ),
    ),
)

const confirmed = verified.flat().filter(Boolean).filter((finding) => finding.verdict?.real)
log(`${confirmed.length} confirmed finding(s) after adversarial verification`)

phase('Critic')
const critic = await agent(
  `${SOURCE}\n${HARNESS}\n\nFour differential fuzzing runs (graph semantics, int parsing, argparse surface, ` +
    `help layout) and five source audits (requirements, argparse fidelity, python semantics, graph ` +
    `correctness, runtime robustness) have finished. Confirmed findings:\n` +
    `${JSON.stringify(confirmed.map(({ title, file, detail, repro }) => ({ title, file, detail, repro })), null, 2)}\n\n` +
    `Act as a completeness critic. What observable surface of the reference binary was NEVER exercised? ` +
    `Pick the gaps most likely to hide a divergence, exercise them yourself now against both programs, ` +
    `and report only what you actually demonstrate. Consider at minimum: locale and encoding ` +
    `environment variables (LC_ALL, LANG, PYTHONIOENCODING, PYTHONUTF8, LINES, TERM), stdin state, ` +
    `signal and broken-pipe behaviour, very long argument values, argument counts in the thousands, ` +
    `combinations of valid graph args with a trailing --help, and any interaction between two features ` +
    `that were only ever tested in isolation.`,
  { schema: FINDINGS_SCHEMA, phase: 'Critic', label: 'critic:completeness' },
)

const criticVerified = await parallel(
  (critic?.findings ?? []).map((finding) => () =>
    agent(
      `${SOURCE}\n${HARNESS}\n\nClaim to refute:\n${JSON.stringify(finding, null, 2)}\n\n` +
        `Run it against both programs. The program name difference (test5_executable vs test5.mjs) is ` +
        `never a real finding. real=true only for a divergence you personally observed.`,
      { schema: VERDICT_SCHEMA, phase: 'Critic', label: `verify:critic:${finding.title.slice(0, 40)}` },
    ).then((verdict) => ({ ...finding, source: 'critic', verdict })),
  ),
)

return {
  confirmed: [
    ...confirmed,
    ...criticVerified.filter(Boolean).filter((finding) => finding.verdict?.real),
  ],
  producersRun: producers.length,
}
