export const meta = {
  name: 'py2node-whoosh-test3-v2',
  description: 'Port /workspace/dataset/test3.py (argparse + whoosh) to zero-dependency Node ESM in /output; file-based specs, adversarial differential verification',
  phases: [
    { title: 'Probe',     detail: 'Nail argparse core parsing algorithm + whoosh API contract' },
    { title: 'Spec',      detail: 'Architect writes one spec file per module to /tmp/port-spec' },
    { title: 'Implement', detail: 'One agent per module, in parallel, reading its own spec file' },
    { title: 'Integrate', detail: 'Entry point, cross-module drift, first byte-exact smoke run' },
    { title: 'Verify',    detail: 'Adversarial differential testing + compliance audit' },
    { title: 'Repair',    detail: 'Root-cause fixes, then a ruthless final acceptance gate' },
  ],
}

const EXE = '/workspace/dataset/test3_executable'
const SRC = '/workspace/dataset/test3.py'
const REF_SPEC = '/tmp/port-ref/help-layout-spec.md'
const REF_IMPL = '/tmp/port-ref/argparse_layout.mjs'

const RULES = `
HARD RULES (a violation invalidates the deliverable):
- Node.js, PURE ES MODULES. \`import\`/\`export\` only. \`require()\` and \`module.exports\` are FORBIDDEN anywhere in /output.
- Every generated file ends in .mjs. Every relative import specifier includes the full ".mjs" suffix.
- ZERO external dependencies. The only legal imports are relative './…mjs' / '../…mjs' paths and node: builtins (node:path, node:process, …). No bare specifiers. Never import 'whoosh', 'argparse', 'yargs', 'minimist'.
- No Python embedded or spawned. No child_process in the delivered code.
- All delivered code lives under /output. Never write to /workspace/dataset. Use /tmp for scratch.
- argv is parsed by hand from process.argv.
Original Python source: ${SRC}
Reference executable (run it; never run \`python\` to inspect behavior): ${EXE}
`

const PY = `
THE PYTHON PROGRAM BEING PORTED (${SRC}):

    import argparse
    from whoosh.fields import Schema, TEXT
    from whoosh.analysis import StemmingAnalyzer

    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    args = parser.parse_args()

    analyzer = StemmingAnalyzer()  # Create stemming analyzer
    schema = Schema(content=TEXT(analyzer=analyzer))  # Create schema with custom analyzer
    print(schema)
`

const OBSERVED = `
GROUND TRUTH ALREADY VERIFIED BY RUNNING THE EXECUTABLE (trust this; re-verify anything you rely on):
  Interpreter is CPython 3.12 (help header is "options:", not "optional arguments:").
  SUCCESS: \`${EXE} --a hello\` -> stdout exactly \`<Schema: ['content']>\\n\`, exit 0.
    The stdout is CONSTANT for every accepted --a value (tested hello, xyz, "", -5, -5.5, -x).
  --a=xyz ok | --a= ok | --a "" ok | --a one --a two ok (last wins) | --a -5 ok | --a -5.5 ok | --a=-x ok
  --a -x            -> exit 2 "argument --a: expected one argument"
  --a               -> exit 2 "argument --a: expected one argument"
  --a -- -x         -> exit 2 "argument --a: expected one argument"
  --a --a=b         -> exit 2 "argument --a: expected one argument"
  --a -x -5         -> exit 2 "argument --a: expected one argument"
  (no args)         -> exit 2 "the following arguments are required: --a"
  -a v              -> exit 2 "the following arguments are required: --a"
  --ab c            -> exit 2 "the following arguments are required: --a"   <-- required error BEATS unrecognized error
  -- --a v          -> exit 2 "the following arguments are required: --a"
  --a v --b 2       -> exit 2 "unrecognized arguments: --b 2"
  --a v extra       -> exit 2 "unrecognized arguments: extra"
  --a v --          -> exit 2 "unrecognized arguments: --"
  --a= v            -> exit 2 "unrecognized arguments: v"
  --he / --hel / --h -> prints HELP, exit 0 (unambiguous prefix abbreviation of --help)
  --=a              -> exit 2 "ambiguous option: --=a could match --help, --a"
  --=               -> exit 2 "ambiguous option: --= could match --help, --a"
  --a v -h / -h --a -> prints HELP, exit 0
  Program name in usage/error text is Python's os.path.basename(sys.argv[0]).
  => The faithful Node analogue is basename(process.argv[1]) i.e. "test3.mjs". Use that. NEVER hardcode "test3_executable".
`

const HELPREF = `
The argparse HELP/USAGE LAYOUT is already fully solved and byte-verified. Do not re-derive it.
  - Complete implementer spec: ${REF_SPEC}
  - A validated pure-ESM reference implementation: ${REF_IMPL}
    It exports formatHelp({prog, columnsEnv, isTty, ttyColumns}) and textwrapWrap(text, width), and was diffed
    byte-for-byte against the real executable for every COLUMNS in 1..130 plus 0, -5, "abc", empty and unset,
    for two different prog lengths, with ZERO mismatches.
  READ BOTH FILES. You may adapt the reference implementation into the delivered module (it is our own
  black-box reimplementation, not third-party code), but it must be generalized to be driven by the
  parser's real action list rather than hardcoding the two actions, and it must keep the byte-exact behavior.
`

// ---------------------------------------------------------------- Phase 1: Probe
phase('Probe')

const probeArgparse = agent(
`Reverse-engineer, by black-box experiment ONLY, the ARGUMENT-CLASSIFICATION AND ERROR-PRECEDENCE algorithm of CPython 3.12 argparse as instantiated by this parser:

    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    args = parser.parse_args()

${RULES}
${OBSERVED}

The help/usage TEXT LAYOUT is already solved — do NOT investigate it. Focus exclusively on the PARSING algorithm.

BE EFFICIENT: run a handful of batched bash loops (not one command per case), then reason. Aim to finish in under ~15 tool calls. Capture stdout and stderr separately and record exit codes.

Answer these specific questions with evidence:
1. Exactly when is an argv token treated as an OPTION versus as a VALUE? Determine the rule for: a token that is exactly "-"; a token that is exactly "--"; tokens like "-5", "-5.5", "-1e3", "-.5", "-5x", "-x", "---a", "--a=b=c". State the negative-number heuristic precisely (it applies because no registered option string looks like a negative number).
2. The "--" (double dash) rule: how many are consumed, in which positions, and why does \`--a -- -x\` still fail with "expected one argument" while \`--a v --\` leaves "--" as an unrecognized argument? Test "--" before/after/between options and with multiple "--".
3. Prefix abbreviation: which abbreviations of --help and --a are accepted, which are ambiguous, and what is the EXACT ambiguous-option message including the ORDER in which candidate options are listed? Test "--h","--he","--hel","--help","--a","--ab","--","--=","--=a","--=x". Determine why "--=a" is ambiguous (how does argparse split on "=" and prefix-match the empty string?) and confirm the candidate ordering rule (registration order vs sorted).
4. Error PRECEDENCE. Construct inputs that simultaneously trigger two or more of {required-missing, unrecognized-arguments, expected-one-argument, ambiguous-option, invalid-choice} and determine the total ordering. Confirm specifically that required-missing beats unrecognized-arguments, and where -h/--help sits in that ordering (does help win even when an earlier token is invalid? test "-h --=a", "--=a -h", "-h --b", "--b -h", "-h" with missing required).
5. How are MULTIPLE unrecognized arguments joined in the message (separator, ordering, are they de-duplicated, are "=" forms shown as given)? Test several extras including repeats and "=" forms.
6. Confirm last-wins for repeated "--a" and that the value is stored verbatim (no stripping) — including values with leading/trailing spaces, tabs, newlines, unicode.

Return PLAIN TEXT (no JSON): a numbered list of precise, implementable rules, each followed by the literal command and literal output that proves it. Be complete but do not pad.`,
  { label: 'probe:argparse-core', phase: 'Probe', effort: 'high' })

const probeWhoosh = agent(
`Specify the reimplementation contract for the Whoosh API surface used by this program. You may NOT read the library's source; work from the public interface contract and general knowledge of the library.

${PY}
${RULES}
${OBSERVED}

First, confirm the observable fact yourself: run \`${EXE} --a something | od -c\` and report the exact bytes.

Then write a precise, implementable contract for:

1. **Schema** — constructor taking field-name keyword arguments; how it stores fields; the rule that names must be strings and must not start with "_"; its public API (names(), items(), iteration order, __getitem__, __contains__, add(), copy()); and its string form: the class name plus the SORTED field names rendered as a Python list-of-strings repr, i.e. \`<Schema: ['content']>\`.
2. **TEXT** — a field type. All constructor keyword parameters WITH their default values (analyzer, phrase, chars, stored, field_boost, multitoken_query, spelling/spelling_prefix, sortable, lang, vector) and which format object it selects for each combination of phrase/chars. Also the FieldType attributes a field carries (format, analyzer, stored, unique, multitoken_query, scorable, indexed, sortable, vector).
3. **StemmingAnalyzer** — the pipeline it composes and in what order, plus every keyword parameter and default (expression, stoplist, minsize, maxsize, gaps, stemfn, ignore, cachesize). State the DEFAULT TOKENIZER REGEX used by the library's regex tokenizer, and how a token stream object behaves (the Token object's fields: text, boost, positions/pos, startchar/endchar, stopped, removestops semantics).
4. **StopFilter** — the default English stopword list, verbatim, and the minsize/maxsize/renumber semantics.
5. **The Porter stemming algorithm** — write out the complete published rule set: the consonant/vowel definitions, the measure m, the condition predicates *v*, *d, *o, and every step (1a, 1b, 1b-extra, 1c, 2, 3, 4, 5a, 5b) with all suffix->replacement pairs and their measure conditions. This is a published algorithm; be exhaustive and precise, because an implementer will encode it directly from your text.
6. **Python repr of strings** — the exact rule an implementer must reproduce in JS: single quotes by default; double quotes only when the string contains a single quote AND no double quote; escaping of backslash, \\n, \\r, \\t, and non-printable characters as \\xNN / \\uNNNN / \\UNNNNNNNN; and that printable non-ASCII (like é or 日) is emitted literally, not escaped.

Return PLAIN TEXT (no JSON), organized under those six headings. Be exhaustive on items 4 and 5 — they are the ones an implementer cannot guess.`,
  { label: 'probe:whoosh-contract', phase: 'Probe', effort: 'high' })

const [argparseNotes, whooshNotes] = await Promise.all([probeArgparse, probeWhoosh])

log(`Probes done (argparse: ${argparseNotes ? 'ok' : 'FAILED'}, whoosh: ${whooshNotes ? 'ok' : 'FAILED'})`)

const RESEARCH = `
================ RESEARCH: ARGPARSE PARSING ALGORITHM ================
${argparseNotes || '(probe failed — rely on the OBSERVED ground truth above and CPython 3.12 argparse semantics)'}

================ RESEARCH: WHOOSH API CONTRACT + PORTER ALGORITHM ================
${whooshNotes || '(probe failed — rely on general knowledge of the library contract)'}
`

// ---------------------------------------------------------------- Phase 2: Spec (written to files)
phase('Spec')

const MODULES = [
  ['lib/compat/pyrepr.mjs',              'Python repr() for strings and lists of strings'],
  ['lib/cli/errors.mjs',                 'ArgumentError / ArgumentTypeError / exit + stream plumbing'],
  ['lib/cli/text.mjs',                   'textwrap-style greedy wrapping and terminal-width resolution'],
  ['lib/cli/formatter.mjs',              'HelpFormatter: byte-exact usage + help layout'],
  ['lib/cli/actions.mjs',                'StoreAction / HelpAction descriptors and dest/metavar derivation'],
  ['lib/cli/argument_parser.mjs',        'ArgumentParser: add_argument, parse_args, parse_known_args, error, exit'],
  ['lib/cli/index.mjs',                  'barrel for the cli package'],
  ['lib/whoosh/support/stoplist.mjs',    'default English STOP_WORDS set'],
  ['lib/whoosh/analysis/acore.mjs',      'Token, Composable, CompositeAnalyzer, pipeline composition'],
  ['lib/whoosh/analysis/tokenizers.mjs', 'RegexTokenizer, IDTokenizer'],
  ['lib/whoosh/analysis/morph.mjs',      'Porter stemming algorithm + memoization cache'],
  ['lib/whoosh/analysis/filters.mjs',    'LowercaseFilter, StopFilter, StemFilter'],
  ['lib/whoosh/analysis/analyzers.mjs',  'StandardAnalyzer, StemmingAnalyzer'],
  ['lib/whoosh/analysis/index.mjs',      'barrel for the analysis package'],
  ['lib/whoosh/formats.mjs',             'Format, Existence, Frequency, Positions'],
  ['lib/whoosh/fields.mjs',              'FieldType, TEXT, ID, KEYWORD, STORED, NUMERIC, Schema'],
  ['lib/whoosh/index.mjs',               'top-level whoosh barrel'],
]

const LAYOUT = `
FIXED MODULE LAYOUT (all under /output; do not invent other paths):
${MODULES.map(([p, d]) => `  /output/${p.padEnd(38)} -- ${d}`).join('\n')}
  /output/test3.mjs                             -- entry point, mirrors test3.py statement-for-statement
Dependency order is top-to-bottom: a module may import only from modules listed ABOVE it (plus node: builtins). The graph must be acyclic.
`

const specReport = await agent(
`You are the architect for a Python->Node.js port. Write the implementation specification TO FILES.

${RULES}
${PY}
${OBSERVED}
${HELPREF}
${LAYOUT}
${RESEARCH}

DO THIS:
1. \`mkdir -p /tmp/port-spec\`. Read ${REF_SPEC} and ${REF_IMPL} first.
2. Write \`/tmp/port-spec/_shared.md\` — invariants binding on EVERY implementer: the hard rules above, naming conventions, the exact byte-for-byte output strings, error/exit semantics, how prog is derived, and the dependency-order rule.
3. For EACH module in the layout write \`/tmp/port-spec/<flattened-path>.md\` (e.g. \`lib_cli_formatter.md\` for lib/cli/formatter.mjs). Each file must be SELF-SUFFICIENT — its implementer sees only _shared.md and its own file. Include:
     - the exact target path,
     - the exact list of import specifiers it is allowed to use,
     - every export: kind, name, full signature, and a precise contract (defaults, edge cases, return shapes, error behavior),
     - a detailed algorithm/behavior section with every literal string and default value spelled out,
     - a SELF-TEST section: concrete input/expected-output pairs the implementer must verify with \`node --input-type=module -e\` before finishing.
4. Also write \`/tmp/port-spec/test3_entry.md\` for /output/test3.mjs.

CRITICAL CONTENT REQUIREMENTS:
- lib/cli must be a self-contained reusable argparse subset reproducing CPython 3.12 semantics for: '=' joined values, prefix abbreviation with ambiguity detection and the exact candidate ordering, the negative-number heuristic, '--' handling, last-wins repeats, and the exact error precedence (required-missing is raised inside parse_known_args; unrecognized-arguments is raised afterwards by parse_args; so required-missing wins). Encode the full parsing algorithm from the research above.
- lib/cli/formatter.mjs must reproduce the byte-exact layout from ${REF_SPEC}, generalized to be driven by the parser's action list. Copy the concrete constants and the get_lines algorithm into the spec so the implementer cannot get it wrong.
- lib/whoosh must be a GENUINE working reimplementation, never a stub that prints a constant. Schema really holds field objects and derives its string form from sorted names via pyrepr. TEXT really builds a format object and holds the analyzer. StemmingAnalyzer really builds a working tokenizer->lowercase->stopword->Porter-stemmer pipeline that yields tokens.
- morph.mjs spec must contain the COMPLETE Porter rule set plus a self-test table of at least 40 word->stem pairs (caresses->caress, ponies->poni, ties->ti, plastered->plaster, motoring->motor, conflated->conflate, troubling->troubl, sized->size, hopping->hop, falling->fall, hissing->hiss, filing->file, happy->happi, sky->sky, relational->relat, conditional->condit, rational->ration, digitizer->digit, radicalli->radic, vietnamization->vietnam, predication->predic, operator->oper, feudalism->feudal, decisiveness->decis, hopefulness->hope, formaliti->formal, sensitiviti->sensit, sensibiliti->sensibl, triplicate->triplic, formative->form, formalize->formal, electriciti->electr, electrical->electr, hopeful->hope, goodness->good, revival->reviv, allowance->allow, inference->infer, airliner->airlin, gyroscopic->gyroscop, adjustable->adjust, defensible->defens, irritant->irrit, replacement->replac, adjustment->adjust, dependent->depend, adoption->adopt, communism->commun, activate->activ, angulariti->angular, homologous->homolog, effective->effect, bowdlerize->bowdler, probate->probat, rate->rate, cease->ceas, controll->control, roll->roll).
- pyrepr.mjs spec must fully define Python's string-repr quote-selection and escaping rules.
- test3.mjs must mirror the Python line-for-line and print exactly one line on the success path.

Return PLAIN TEXT: the list of spec files you wrote with a one-line summary each, and any design decision the implementers must not deviate from. Keep the return short — the content lives in the files.`,
  { label: 'architect', phase: 'Spec', effort: 'high' })

log('Spec files written')

// ---------------------------------------------------------------- Phase 3: Implement (parallel, disjoint files)
phase('Implement')

const flat = p => p.replace(/^lib\//, 'lib_').replace(/\//g, '_').replace(/\.mjs$/, '.md')

const written = await parallel(MODULES.map(([p, purpose]) => () => agent(
`Implement exactly one file of a Python->Node ESM port: /output/${p}

${RULES}

READ FIRST, IN THIS ORDER:
  1. /tmp/port-spec/_shared.md            (invariants binding on every module)
  2. /tmp/port-spec/${flat(p)}            (YOUR module's full spec — if this exact filename is missing, \`ls /tmp/port-spec/\` and read the file that clearly corresponds to /output/${p})
${p === 'lib/cli/formatter.mjs' || p === 'lib/cli/text.mjs' ? `  3. ${REF_SPEC} and ${REF_IMPL} — the byte-verified layout spec and reference implementation. Adapt the reference; do not re-derive the algorithm.` : ''}

YOUR MODULE: /output/${p} — ${purpose}

${LAYOUT}

INSTRUCTIONS
- \`mkdir -p\` the parent directory, then Write the file at exactly /output/${p}.
- Export exactly the names your spec lists, with those signatures. Sibling modules are being written CONCURRENTLY against this same spec: do not rename exports, do not change arity, do not add default exports, do not "helpfully" also create a sibling file.
- Import only what your spec allows: relative './…mjs' or '../…mjs' paths (full .mjs suffix, respecting the dependency order) and node: builtins.
- NEVER write require() or module.exports. No npm packages. No child_process. No hardcoding of the expected program output.
- Complete, correct, production-quality code. No TODOs, no stubs, no placeholders.
- RUN YOUR SPEC'S SELF-TESTS before you finish: \`node --input-type=module -e "…import('/output/${p}')…"\`. If a self-test fails, fix your code until it passes. If it fails only because a sibling module does not exist yet, note that in your report instead of creating the sibling.
- NEVER create or modify any file other than /output/${p}. Use /tmp for scratch.

Return a SHORT report: the exports you produced, self-test results, and any assumption the integrator must check.`,
  { label: `impl:${p}`, phase: 'Implement' }
)))

log(`Implemented ${written.filter(Boolean).length}/${MODULES.length} modules`)

// ---------------------------------------------------------------- Phase 4: Integrate
phase('Integrate')

const integration = await agent(
`You are the integrator. The library modules under /output/lib were just written IN PARALLEL by separate agents from a shared spec. Write the entry point and make the whole tree actually work, byte-exactly.

${RULES}
${PY}
${OBSERVED}
${LAYOUT}

Read /tmp/port-spec/_shared.md and /tmp/port-spec/test3_entry.md first.

IMPLEMENTER REPORTS:
${written.map((w, i) => `[/output/${MODULES[i][0]}] ${w ? String(w).slice(0, 900) : '*** AGENT FAILED — this file may be MISSING or incomplete; write it yourself from its spec ***'}`).join('\n\n')}

DO THIS, IN ORDER:
1. \`find /output -type f | sort\` and read every file. Any module missing or truncated: write it yourself from its spec in /tmp/port-spec/.
2. Write /output/test3.mjs per its spec — mirroring the Python statement-for-statement, importing only from ./lib/… .mjs.
3. Fix cross-module drift: mismatched export names/arities, wrong relative paths, missing .mjs suffixes, import cycles, any require()/module.exports, any bare import.
4. Byte-exact success path:
     diff <(${EXE} --a hello) <(node /output/test3.mjs --a hello)      -> MUST be empty, both exit 0
     node /output/test3.mjs --a hello | od -c                          -> MUST be exactly \`<Schema: ['content']>\\n\`
5. Error/help paths — compare stdout, stderr AND exit code against the executable for:
     (no args) | --help | -h | --he | --a | --a -x | --b | --a v --b 2 | --a v extra | --a v -- | --=a | --ab c | -a v | --a v -h | -- --a v | --a -- -x | --a=hello | --a one --a two | --a -5
   The ONLY legitimate difference is the program name. Normalize with
     sed -e 's/test3_executable/PROG/g' -e 's/test3\\.mjs/PROG/g'
   and require byte-identical output on both streams plus identical exit codes. Also check COLUMNS=20 and COLUMNS=40 for --help and for (no args).
6. Prove the whoosh layer is REAL (run via \`node --input-type=module -e\`, leave no files behind):
     - analyze "The ponies are running relationally" through StemmingAnalyzer -> lowercased, stopword-filtered, Porter-stemmed tokens.
     - Schema with fields zebra, apple, mango -> must print \`<Schema: ['apple', 'mango', 'zebra']>\`.
   If the pipeline is faked or broken, FIX the root cause.
7. Compliance: \`grep -rn "require(\\|module\\.exports" /output\` -> empty. Every import specifier relative-and-.mjs or node:-prefixed. \`cd /tmp && node /output/test3.mjs --a x\` works.
8. Delete any stray scratch file from /output that is not in the layout.

Return a concise report: final file tree, the diff/PASS-FAIL result for every check in steps 4-7, and any remaining discrepancy.`,
  { label: 'integrator', phase: 'Integrate', effort: 'high' })

log('Integration complete')

// ---------------------------------------------------------------- Phase 5: Verify (adversarial, pipelined)
phase('Verify')

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'severity', 'repro', 'expected', 'actual'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          repro: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'reasoning', 'evidence'],
  properties: {
    isReal: { type: 'boolean' },
    reasoning: { type: 'string' },
    evidence: { type: 'string' },
  },
}

const NOT_A_BUG = `
NOT DEFECTS — do not report these:
- The program name differing ("test3.mjs" vs "test3_executable") in usage/error text. Python derives it from basename(sys.argv[0]); the port correctly derives it from basename(process.argv[1]). This is the faithful behavior.
- Node writing its own diagnostics for genuinely malformed invocations of node itself (as opposed to the ported program's argv).
`

const DIMENSIONS = [
  ['diff-success', `Differential-test /output/test3.mjs against ${EXE} on the SUCCESS path.
Batch a bash loop over many valid invocations; byte-compare stdout with cmp and compare exit codes. Cover: --a hello | --a=hello | --a "" | --a= | --a " spaces " | --a "multi word" | --a -5 | --a -5.5 | --a=-x | --a one --a two | --a "unicode héllo 日本語 🎉" | --a "quote'inside" | --a 'double"inside' | --a "back\\\\slash" | tab and newline inside the value | a 100KB value | --a "--a" | --a "-h".
Verify stdout is byte-identical and ends with exactly one newline in both (od -c). Report only reproduced divergences.`],

  ['diff-errors', `Differential-test /output/test3.mjs against ${EXE} on ALL FAILURE and HELP paths, capturing stdout, stderr and exit code SEPARATELY.
Matrix: (no args) | --help | -h | --h | --he | --hel | --a | --a -x | --a -- -x | --a --a=b | --b | --a v --b 2 | --a v extra | extra --a v | -a v | - | -- | -- --a v | --a v -- | --a v -- extra | --= | --=a | --=x | --ab c | --a v -h | -h --a | -h --=a | --=a -h | -h --b | --b -h | --xyz | ---a | --a=v --a | --a= v | --a -5x | --a -.5 | --a -1e3.
Then repeat the whole matrix with COLUMNS=20, COLUMNS=40, COLUMNS=15 and COLUMNS=200 exported.
Normalize ONLY the program name: sed -e 's/test3_executable/PROG/g' -e 's/test3\\.mjs/PROG/g'. Then require byte-identical stdout, byte-identical stderr, and identical exit codes.
Pay attention to: which stream each line goes to, trailing newlines, the blank line in --help, help column alignment, usage wrapping under narrow COLUMNS, message wording, and which error wins when several apply. Report only reproduced divergences.`],

  ['compliance', `Audit /output for hard-rule compliance. This is a pass/fail gate; report every violation as a finding.
1. \`find /output -type f ! -name '*.mjs'\` -> must be empty. Also flag any stray file not part of the module layout.
2. \`grep -rn "require(\\|module\\.exports\\|exports\\[" /output\` -> must be empty.
3. Extract EVERY import specifier (static \`from '…'\`, side-effect \`import '…'\`, and dynamic \`import('…')\`) and confirm each is relative ending in .mjs, or node:-prefixed. Flag any bare/npm specifier as a BLOCKER, and any builtin imported without the node: prefix as minor.
4. Every relative import resolves to a real file (no extensionless, no directory imports). Verify each resolves on disk.
5. \`grep -rn "child_process\\|execSync\\|spawnSync\\|python" /output\` -> must be empty.
6. Runs without a package.json, from another cwd, and via an absolute path: \`cd /tmp && node /output/test3.mjs --a x\`.
7. /workspace/dataset must still contain ONLY test3.py and test3_executable, unmodified.
8. Genuinely hierarchical: multiple real functional modules with real exports. Flag as a BLOCKER any module that fakes behavior or hardcodes the expected output string (grep for the literal "<Schema:" outside pyrepr/fields logic — the string must be COMPUTED, never a literal).
9. Every module loads: for each .mjs run \`node --input-type=module -e "await import('FILE')"\`; report any that throw.`],

  ['library-fidelity', `Verify /output/lib/whoosh is a REAL working library, not a facade. Read every file, then exercise the public API with \`node --input-type=module -e\` (scratch in /tmp only).
- Schema with several differently-named fields prints \`<Schema: [...]>\` with names SORTED and rendered as a Python list repr with single quotes. Test names needing escaping (apostrophe, backslash, non-ASCII) and confirm the quote-selection/escaping rule matches Python's repr exactly.
- Schema rejects non-string names and names starting with "_"; names()/items()/iteration/contains work.
- TEXT stores the analyzer it was given and selects a positions-vs-frequency format per its phrase/chars arguments; defaults are as specified.
- StemmingAnalyzer end-to-end over real text: default-regex tokenization, lowercasing, stopword removal, Porter stemming.
- Porter stemmer correctness against the reference table: caresses->caress, ponies->poni, ties->ti, caress->caress, cats->cat, feed->feed, agreed->agre, plastered->plaster, motoring->motor, sing->sing, conflated->conflate, troubling->troubl, sized->size, hopping->hop, tanned->tan, falling->fall, hissing->hiss, fizzed->fizz, failing->fail, filing->file, happy->happi, sky->sky, relational->relat, conditional->condit, rational->ration, valenci->valenc, hesitanci->hesit, digitizer->digit, conformabli->conform, radicalli->radic, differentli->differ, vileli->vile, analogousli->analog, vietnamization->vietnam, predication->predic, operator->oper, feudalism->feudal, decisiveness->decis, hopefulness->hope, callousness->callous, formaliti->formal, sensitiviti->sensit, sensibiliti->sensibl, triplicate->triplic, formative->form, formalize->formal, electriciti->electr, electrical->electr, hopeful->hope, goodness->good, revival->reviv, allowance->allow, inference->infer, airliner->airlin, gyroscopic->gyroscop, adjustable->adjust, defensible->defens, irritant->irrit, replacement->replac, adjustment->adjust, dependent->depend, adoption->adopt, communism->commun, activate->activ, angulariti->angular, homologous->homolog, effective->effect, bowdlerize->bowdler, probate->probat, rate->rate, cease->ceas, controll->control, roll->roll.
  Write the table to a /tmp file and check all of them in one run. Every mismatch is a major finding.
- StopFilter drops the expected common/short words and respects its minsize default.`],

  ['robustness', `Hunt latent defects in /output that happy-path tests miss. Read the code, then try hard to break it.
- Crash-vs-clean-exit: does ANY argv produce a raw Node stack trace, an unhandled rejection, or a nonzero-but-wrong exit code instead of argparse-style "usage:" + "error:" on stderr with exit 2? A stack trace is a BLOCKER. Fuzz aggressively: empty strings, only dashes, "---", "--=", 5000 arguments, 1MB argv value, control characters, lone surrogates, "=" chains.
- Exit codes: 0 success, 0 help, 2 usage error — in every path.
- Program-name derivation: invoke via a relative path, via an absolute path, from another cwd, and through a symlink in /tmp pointing at /output/test3.mjs. Does it behave like Python's basename(sys.argv[0])?
- Correctness bugs in the Porter stemmer, tokenizer regex, stopword set, or Python-repr escaping that would surface with other inputs even though this script's output is constant.
- Catastrophic regex backtracking / hangs: push a 200KB pathological string (long runs of dots, digits, mixed punctuation) through the analyzer under \`timeout 10\`.
- Mutable module-level state: does constructing a second parser, or parsing twice in one process, behave correctly? Does building two Schemas leak fields between them?
- Off-by-one in the help formatter at width boundaries: sweep COLUMNS 1..130 for --help and for (no args), diffing against the executable with the program name normalized. Report the first mismatching width.`],
]

const verified = await pipeline(
  DIMENSIONS,
  ([key, body]) => agent(
`${body}

${RULES}
${OBSERVED}
${NOT_A_BUG}

The port under test is /output/test3.mjs with its library under /output/lib. DO NOT FIX ANYTHING — only observe and report. Run real commands; never speculate. Batch your commands into loops to stay efficient. Report ONLY defects you actually reproduced, with an exact repro command.`,
    { label: `find:${key}`, phase: 'Verify', schema: FINDINGS, effort: 'high' }),

  (report, [key]) => {
    if (!report || !report.findings || !report.findings.length) return []
    return parallel(report.findings.map(f => () =>
      agent(
`Adversarially verify a reported defect in the Node port at /output. Default stance: SKEPTICISM — try to REFUTE it. Many reported bugs are misreadings, environment artifacts, or correct faithful behavior.

CLAIM: ${f.title}
file: ${f.file}
claimed severity: ${f.severity}
repro: ${f.repro}
expected: ${f.expected}
actual: ${f.actual}

Re-run the repro verbatim yourself and read the relevant source. Decide:
- Is the divergence REAL and reproducible right now?
- Is it actually a DEFECT, or correct faithful behavior?
${NOT_A_BUG}
- If you are uncertain, answer isReal=false.

${RULES}
Return your verdict with literal command output as evidence.`,
        { label: `verify:${key}:${f.title.slice(0, 36)}`, phase: 'Verify', schema: VERDICT })
      .then(v => (v && v.isReal) ? { ...f, dimension: key, reasoning: v.reasoning } : null)
    ))
  }
)

const confirmed = verified.flat().filter(Boolean)
const rank = { blocker: 0, major: 1, minor: 2 }
confirmed.sort((a, b) => rank[a.severity] - rank[b.severity])
log(`Verify complete: ${confirmed.length} defect(s) survived adversarial screening`)

// ---------------------------------------------------------------- Phase 6: Repair + final gate
phase('Repair')

let repairReport = 'No confirmed defects — repair pass skipped.'

if (confirmed.length) {
  repairReport = await agent(
`Fix every confirmed defect in the Node port under /output. Each was independently reproduced and adversarially screened — treat them as real.

${RULES}
${OBSERVED}
${NOT_A_BUG}

CONFIRMED DEFECTS (most severe first):
${confirmed.map((f, i) => `${i + 1}. [${f.severity}] (${f.dimension}) ${f.title}\n   file: ${f.file}\n   repro: ${f.repro}\n   expected: ${f.expected}\n   actual: ${f.actual}\n   confirmed: ${f.reasoning}`).join('\n\n')}

RULES FOR THE REPAIR:
- Fix the ROOT CAUSE in the module that owns the behavior. Never special-case a test input; never hardcode expected stdout.
- Preserve the hierarchical structure and every export contract.
- Re-run each repro after fixing, then the full regression set below. Do not regress anything.

REGRESSION SET (all must pass):
  A) diff <(${EXE} --a hello) <(node /output/test3.mjs --a hello) -> empty, exit 0 both
  B) stdout identical for: --a=x | --a "" | --a -5 | --a one --a two | --a "héllo 日本語"
  C) stdout+stderr+exit identical (program name normalized via sed) for: (no args) | --help | -h | --he | --a | --a -x | --b | --a v --b 2 | --a v extra | --a v -- | --=a | --ab c | -a v | --a v -h | -- --a v | --a -- -x  — and again under COLUMNS=15, 20, 40
  D) grep -rn "require(\\|module\\.exports" /output -> empty
  E) every import specifier relative-and-.mjs or node:-prefixed
  F) cd /tmp && node /output/test3.mjs --a x works
  G) StemmingAnalyzer still really tokenizes/lowercases/stops/stems (ponies->poni, running->run, relational->relat)
  H) no input produces a Node stack trace

Report what you changed file by file, and paste the final regression results.`,
    { label: 'repair', phase: 'Repair', effort: 'high' })
}

const finalGate = await agent(
`FINAL ACCEPTANCE GATE for the Python->Node port at /output. You are the last check before delivery. Trust no prior report — run everything yourself. If any check fails, FIX the root cause and re-run until everything passes (never hardcode expected output).

${RULES}
${PY}
${OBSERVED}
${NOT_A_BUG}
${LAYOUT}

Run these and paste literal output:
1. \`find /output -type f | sort\` — every file ends in .mjs, matches the layout, no stray scratch files, structure genuinely hierarchical. Delete strays.
2. \`diff <(${EXE} --a hello) <(node /output/test3.mjs --a hello); echo rc=$?\` -> empty.
3. \`node /output/test3.mjs --a hello | od -c\` -> exactly the bytes of \`<Schema: ['content']>\\n\`, nothing more.
4. PASS/FAIL table comparing stdout, stderr and exit code against the executable (program name normalized via sed) for:
   (no args) | --help | -h | --h | --he | --hel | --a | --a hello | --a=hello | --a "" | --a= | --a -5 | --a -5.5 | --a -x | --a one --a two | --b | --a v --b 2 | --a v extra | --a v -- | --= | --=a | --ab c | -a v | - | -- | --a v -h | -h --a | -- --a v | --a -- -x | --a "héllo 日本語 🎉"
   Then repeat for COLUMNS in 15, 20, 33, 40, 80, 200.
5. \`for c in $(seq 1 130); do\` diff \`--help\` output at that COLUMNS against the executable (prog name normalized) — report total mismatches; must be 0.
6. \`grep -rn "require(\\|module\\.exports" /output\` -> empty.
7. List every import specifier in the tree and confirm each is relative-.mjs or node:-prefixed.
8. \`cd /tmp && node /output/test3.mjs --a x\` -> works.
9. \`ls -la /workspace/dataset\` -> still only test3.py and test3_executable.
10. Prove the whoosh layer is real: analyze "The ponies are running relationally" through StemmingAnalyzer and print the tokens; and build a Schema with fields zebra, apple, mango -> must print \`<Schema: ['apple', 'mango', 'zebra']>\`.
11. Confirm no argv produces a Node stack trace (fuzz ~30 hostile argv shapes; every failure must be usage+error on stderr with exit 2).

Finish with: the final file tree, a PASS/FAIL line per check, what you fixed (if anything), and any remaining known limitation stated plainly.`,
  { label: 'final-gate', phase: 'Repair', effort: 'high' })

return {
  modulesWritten: written.filter(Boolean).length,
  modulesTotal: MODULES.length,
  confirmedDefects: confirmed.length,
  defects: confirmed.map(f => `[${f.severity}] (${f.dimension}) ${f.title}`),
  specReport,
  integration,
  repairReport,
  finalGate,
}
