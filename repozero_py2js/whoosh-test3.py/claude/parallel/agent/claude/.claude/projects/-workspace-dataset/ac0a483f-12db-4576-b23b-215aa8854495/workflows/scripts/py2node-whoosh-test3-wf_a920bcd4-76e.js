export const meta = {
  name: 'py2node-whoosh-test3',
  description: 'Port /workspace/dataset/test3.py (argparse + whoosh Schema/TEXT/StemmingAnalyzer) to zero-dependency Node ESM in /output',
  phases: [
    { title: 'Probe',     detail: 'Black-box the executable: argparse semantics, help/usage text, whoosh surface' },
    { title: 'Spec',      detail: 'Synthesize exact per-module specs for the fixed .mjs hierarchy' },
    { title: 'Implement', detail: 'Write each module in parallel from its spec' },
    { title: 'Integrate', detail: 'Wire entry point, resolve cross-module drift, first smoke run' },
    { title: 'Verify',    detail: 'Adversarial differential testing + compliance audit' },
    { title: 'Repair',    detail: 'Fix confirmed defects and re-verify' },
  ],
}

const EXE = '/workspace/dataset/test3_executable'
const SRC = '/workspace/dataset/test3.py'

const GROUND_RULES = `
GROUND RULES (violating any of these invalidates the whole deliverable):
- Target: Node.js, PURE ES MODULES. Every file uses \`import\`/\`export\`. \`require()\` and \`module.exports\` are STRICTLY FORBIDDEN anywhere.
- Every generated file MUST have the .mjs suffix. Every relative import MUST include the full ".mjs" suffix.
- ZERO external dependencies. No npm packages. The ONLY allowed imports are (a) relative local ./ or ../ paths ending in .mjs, and (b) Node builtins written with the node: prefix (node:path, node:process, node:url, ...). Do NOT import 'whoosh', 'argparse', 'yargs', or anything bare.
- No embedding/spawning Python. No child_process shelling out to python.
- All generated code lives under /output. Never write to /workspace/dataset.
- Command-line arguments must be parsed by hand from process.argv.
- Original Python source: ${SRC}
- Reference executable (run it, do NOT run \`python\`): ${EXE}
`

const LAYOUT = `
FIXED FILE LAYOUT (do not invent other paths):
  /output/test3.mjs                              -- entry point (mirrors test3.py top-to-bottom)
  /output/lib/cli/errors.mjs                     -- ArgumentError, ArgumentTypeError, SystemExit-style exit handling
  /output/lib/cli/formatter.mjs                  -- usage string + help text formatting (argparse HelpFormatter subset)
  /output/lib/cli/actions.mjs                    -- StoreAction / HelpAction descriptors
  /output/lib/cli/argument_parser.mjs            -- ArgumentParser: add_argument / parse_args / parse_known_args
  /output/lib/compat/pyrepr.mjs                  -- Python-compatible repr() helpers (str/list repr, quote selection)
  /output/lib/whoosh/support/stoplist.mjs        -- default STOP_WORDS frozen set
  /output/lib/whoosh/analysis/acore.mjs          -- Token, Composable, CompositeAnalyzer, the | composition helper
  /output/lib/whoosh/analysis/tokenizers.mjs     -- RegexTokenizer (default expr) , IDTokenizer
  /output/lib/whoosh/analysis/morph.mjs          -- Porter stemming algorithm ("stem" function) + lru-style cache
  /output/lib/whoosh/analysis/filters.mjs        -- LowercaseFilter, StopFilter, StemFilter
  /output/lib/whoosh/analysis/analyzers.mjs      -- StandardAnalyzer, StemmingAnalyzer factory functions
  /output/lib/whoosh/analysis/index.mjs          -- re-export barrel for the analysis package
  /output/lib/whoosh/formats.mjs                 -- Format, Existence, Frequency, Positions
  /output/lib/whoosh/fields.mjs                  -- FieldType, TEXT, ID, KEYWORD, STORED, NUMERIC, Schema
  /output/lib/whoosh/index.mjs                   -- top-level barrel
`

const OBSERVED = `
ALREADY-OBSERVED GROUND TRUTH (verified by running the executable; re-verify anything you depend on):
  $ test3_executable --a hello        -> stdout: "<Schema: ['content']>" + newline ; exit 0
  The printed output is CONSTANT for every accepted value of --a (tested: hello, xyz, "", -5, -5.5, -x).
  $ test3_executable                  -> exit 2, stderr:
      usage: test3_executable [-h] --a A
      test3_executable: error: the following arguments are required: --a
  $ test3_executable --help           -> exit 0, stdout:
      usage: test3_executable [-h] --a A
      (blank line)
      options:
        -h, --help  show this help message and exit
        --a A
  $ test3_executable --a              -> exit 2, "argument --a: expected one argument"
  $ test3_executable --a v --b 2      -> exit 2, "unrecognized arguments: --b 2"
  $ test3_executable --a v extra      -> exit 2, "unrecognized arguments: extra"
  $ test3_executable --a=xyz          -> ok      (= form supported)
  $ test3_executable --a=             -> ok      (empty value)
  $ test3_executable --a -5           -> ok      (negative-number-looking value consumed, since no option string looks like a negative number)
  $ test3_executable --a -x           -> exit 2, "argument --a: expected one argument"
  $ test3_executable --a one --a two  -> ok      (last wins)
  $ test3_executable --he             -> prints HELP (unambiguous prefix abbreviation of --help)
  $ test3_executable --=a             -> exit 2, "ambiguous option: --=a could match --help, --a"
  $ test3_executable --ab c           -> exit 2, "the following arguments are required: --a"  (required error beats unrecognized error)
  $ test3_executable -- --a v         -> exit 2, "the following arguments are required: --a"
  $ test3_executable --a v --         -> exit 2, "unrecognized arguments: --"
  $ test3_executable --a -- -x        -> exit 2, "argument --a: expected one argument"
  $ test3_executable -a v             -> exit 2, "the following arguments are required: --a"
  $ test3_executable --a v -h         -> prints HELP, exit 0
  Interpreter is CPython 3.12 (note: 3.12 uses the header "options:", not "optional arguments:").
  The program name in usage/error lines is Python's os.path.basename(sys.argv[0]).
  => In the Node port the faithful analogue is basename(process.argv[1]), i.e. "test3.mjs". Use that; do NOT hardcode "test3_executable".
`

// ---------------------------------------------------------------- Phase 1: Probe
phase('Probe')

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'findings', 'exactStrings', 'rulesForImplementer'],
  properties: {
    area: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['behavior', 'evidence'],
        properties: {
          behavior: { type: 'string', description: 'Precise rule, stated so an implementer can encode it' },
          evidence: { type: 'string', description: 'Exact command run and its exact stdout/stderr/exit code, or "reasoned" if not directly observable' },
        },
      },
    },
    exactStrings: {
      type: 'array',
      description: 'Literal output strings that must be reproduced byte-for-byte, with \\n shown explicitly',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['when', 'stream', 'exitCode', 'text'],
        properties: {
          when: { type: 'string' },
          stream: { type: 'string', enum: ['stdout', 'stderr'] },
          exitCode: { type: 'integer' },
          text: { type: 'string' },
        },
      },
    },
    rulesForImplementer: { type: 'array', items: { type: 'string' } },
  },
}

const PROBES = [
  {
    key: 'argparse-core',
    prompt: `You are black-box reverse-engineering CPython 3.12's argparse as instantiated by this program:

    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    args = parser.parse_args()

Probe ${EXE} with MANY argv shapes and record EXACT stdout, stderr and exit codes. Use a bash loop with printf/od where whitespace matters. Capture stdout and stderr SEPARATELY (2>/dev/null and 1>/dev/null) so you know which stream each line goes to. Verify with \`od -c\` whether the error/usage block ends in a trailing newline.

Cover at minimum: missing required; value via space; value via '='; empty value; repeated option; unknown long option; unknown short option; bare '-'; bare '--' in several positions; values that start with '-' (letters vs digits vs '-1.5' vs '-1e3' vs '-' alone); '--a' as the very last token; extra positionals; combinations where BOTH a required-missing error AND unrecognized args exist (determine which error wins); the precedence between -h/--help and errors, including '-h' appearing AFTER an invalid token vs after a valid one; prefix abbreviations of --help and of --a ('--h','--he','--hel','--help','--a','--ab'); '--=', '--=a', '-'; interspersed ordering.

Determine and state the exact algorithm rules: how an argv token is classified as option-vs-value, the negative-number heuristic, prefix-matching/ambiguity rules and the exact ambiguous-option message ordering of candidates, and the ORDER in which competing errors are raised.

Also determine how the program name is derived: create symlinks with different basenames in /tmp pointing at the executable, run them, and confirm the usage line follows the basename.

${GROUND_RULES}
Report every literal string with \\n escapes made explicit.`,
  },
  {
    key: 'argparse-help-format',
    prompt: `Black-box CPython 3.12 argparse's HELP and USAGE text layout for this parser:

    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)

Run ${EXE} --help and capture the output through \`od -c\` / \`cat -A\` so every space and newline is unambiguous. Report the byte-exact help text: the usage line, blank lines, the section header, the exact column at which the help description starts, and the trailing newline situation.

Then determine the LAYOUT ALGORITHM generally enough to be reimplemented, and confirm it by experiment where possible:
- how the metavar for '--a' is derived (why is it 'A'?),
- why a required option still appears in usage without brackets while -h appears as [-h],
- the help-position/column rule argparse uses (max action length, the 24-column cap, the 2-space gap, indent width),
- how usage wraps when it would exceed the terminal width. IMPORTANT: test this by running the executable with COLUMNS set to small values (e.g. \`COLUMNS=20 ${EXE} --help\`, also 30, 40) and record whether and how the usage line wraps and how the wrapped continuation lines are indented.
- whether output depends on the terminal width when not a tty.

${GROUND_RULES}
Report every literal string with \\n escapes made explicit, plus the precise wrapping rules.`,
  },
  {
    key: 'whoosh-surface',
    prompt: `Determine exactly what the Whoosh library calls in this script must produce:

    from whoosh.fields import Schema, TEXT
    from whoosh.analysis import StemmingAnalyzer
    analyzer = StemmingAnalyzer()
    schema = Schema(content=TEXT(analyzer=analyzer))
    print(schema)

Observed: stdout is exactly "<Schema: ['content']>" followed by a newline, for every accepted --a value. Confirm this yourself by running ${EXE} --a something and piping through \`od -c\`.

Your job is to specify, from interface behavior and general knowledge of the library's public API (you may NOT read the library's source), a faithful reimplementation target:
1. Schema: how it stores fields, what its string form is (the class name, and that the list is the SORTED field names rendered as a Python list-of-str repr), what its public methods are (names(), items(), __iter__, __getitem__, __contains__, add(), and the rule that field names must be strings not starting with an underscore).
2. TEXT: what a TEXT field type is, its constructor keyword parameters and their DEFAULTS (analyzer, phrase, chars, stored, field_boost, multitoken_query, spelling, sortable, lang, vector), and which format object it selects depending on phrase/chars.
3. StemmingAnalyzer: the pipeline it composes (a regex tokenizer, then lowercase, then stopword removal, then stemming), its keyword parameters and defaults (expression, stoplist, minsize, maxsize, gaps, stemfn, ignore, cachesize), and the default tokenizer regex.
4. The Porter stemming algorithm's exact rules (this is a published, well-known algorithm — write out the full step-by-step rule set, measure/consonant-sequence definition, and the condition predicates *v*, *d, *o, so an implementer can encode it precisely).
5. The default English stopword list used by that library's StopFilter.

CRITICAL for output fidelity: state exactly how Python renders a list of one string, i.e. that repr uses single quotes by default, switching to double quotes only when the string contains a single quote and no double quote, and how backslash/control-character escaping works. This must be reimplemented in JS.

${GROUND_RULES}
Do not read library source. Answer from the public interface contract.`,
  },
]

const probes = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Probe', schema: PROBE_SCHEMA })
))

const probeNotes = probes.filter(Boolean)
  .map(r => `### PROBE: ${r.area}\nFINDINGS:\n${r.findings.map(f => `- ${f.behavior}\n    evidence: ${f.evidence}`).join('\n')}\nEXACT STRINGS:\n${r.exactStrings.map(s => `- [${s.stream} exit=${s.exitCode}] when ${s.when}:\n${JSON.stringify(s.text)}`).join('\n')}\nRULES:\n${r.rulesForImplementer.map(x => `- ${x}`).join('\n')}`)
  .join('\n\n')

log(`Probe complete: ${probes.filter(Boolean).length}/${PROBES.length} reports gathered`)

// ---------------------------------------------------------------- Phase 2: Spec
phase('Spec')

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['modules', 'sharedInvariants'],
  properties: {
    sharedInvariants: {
      type: 'array',
      description: 'Rules every implementer must follow: naming conventions, exact output strings, error semantics',
      items: { type: 'string' },
    },
    modules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'purpose', 'imports', 'exports', 'behaviorSpec'],
        properties: {
          path: { type: 'string', description: 'absolute path under /output' },
          purpose: { type: 'string' },
          imports: { type: 'array', items: { type: 'string' }, description: 'exact relative .mjs specifiers this module may import, and node: builtins' },
          exports: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'kind', 'signature', 'contract'],
              properties: {
                name: { type: 'string' },
                kind: { type: 'string', enum: ['class', 'function', 'const'] },
                signature: { type: 'string' },
                contract: { type: 'string', description: 'exact semantics, defaults, edge cases, return shapes' },
              },
            },
          },
          behaviorSpec: { type: 'string', description: 'Detailed prose spec: algorithms, exact literal strings, edge cases. Long is good.' },
        },
      },
    },
  },
}

const spec = await agent(`You are the architect for a Python->Node.js port. Produce an exhaustive, implementation-ready specification.

TASK: port ${SRC} to Node ESM under /output.

${GROUND_RULES}
${LAYOUT}
${OBSERVED}

RESEARCH GATHERED BY THE PROBE AGENTS:
${probeNotes}

Produce one spec entry per file in the FIXED FILE LAYOUT. For each module give: its exact import list (every relative specifier must end in .mjs and must only reference other files in the layout), its exact export list with signatures and contracts, and a long behaviorSpec containing every literal string, default value, and edge case the implementer needs.

Design constraints you must encode in the spec:
- The dependency graph must be acyclic. Order the layout list so that leaves (errors, pyrepr, stoplist, morph, acore) come first.
- lib/cli must be a self-contained, reusable argparse subset: an ArgumentParser class supporting add_argument('--a', {type, required}), parse_args(argv), parse_known_args(argv), format_usage(), format_help(), error(msg), exit(code, msg), print_help(). It must reproduce CPython 3.12 semantics for: '=' joined values, prefix abbreviation with ambiguity detection, the negative-number heuristic, '--' handling, last-wins for repeated options, and the exact error precedence (required-missing is raised inside parse_known_args, unrecognized-arguments is raised afterwards by parse_args, so required wins).
- lib/compat/pyrepr.mjs must implement Python's repr() for strings and lists of strings, including the single-vs-double quote rule and escaping of backslash, newline, tab, carriage return and other non-printables (\\xNN / \\uNNNN forms).
- The whoosh subset must be a genuine, working reimplementation, not a stub that prints a constant. Schema must actually hold field objects and derive its string form from the sorted field names via the pyrepr helpers. TEXT must actually construct a format object and hold the analyzer. StemmingAnalyzer must actually build a working token pipeline (regex tokenizer -> lowercase -> stopwords -> Porter stemmer) whose analyze/call method yields tokens; include the full Porter algorithm in morph.mjs.
- test3.mjs must mirror test3.py statement-for-statement: parse args, build the analyzer, build the schema, print it with a single console.log. Do not print anything else on the success path.
- The program name used in usage/error text must be derived at runtime from basename(process.argv[1]).

Be exhaustive. Implementers will see ONLY sharedInvariants plus their own module's entry, so each entry must be self-sufficient.`,
  { label: 'architect', phase: 'Spec', schema: SPEC_SCHEMA, effort: 'high' })

if (!spec || !spec.modules || !spec.modules.length) {
  log('FATAL: architect returned no modules')
  return { error: 'no spec produced' }
}

const invariants = spec.sharedInvariants.map(s => `- ${s}`).join('\n')
log(`Spec complete: ${spec.modules.length} modules, ${spec.sharedInvariants.length} shared invariants`)

// ---------------------------------------------------------------- Phase 3: Implement (parallel, disjoint files)
phase('Implement')

const implModules = spec.modules.filter(m => m.path && !m.path.endsWith('/test3.mjs'))

const written = await parallel(implModules.map(m => () => agent(
`Write exactly one file: ${m.path}

${GROUND_RULES}

SHARED INVARIANTS (binding on every module):
${invariants}

YOUR MODULE
path: ${m.path}
purpose: ${m.purpose}
allowed imports: ${JSON.stringify(m.imports)}
exports:
${m.exports.map(e => `  - ${e.kind} ${e.name} :: ${e.signature}\n      ${e.contract}`).join('\n')}

BEHAVIOR SPEC:
${m.behaviorSpec}

BACKGROUND (byte-exact ground truth from the reference program):
${OBSERVED}

${LAYOUT}

INSTRUCTIONS
- Use the Write tool to create the file at exactly ${m.path}. Create parent directories with Bash mkdir -p first if needed.
- Export EXACTLY the names listed above with those signatures. Other modules are being written concurrently against this contract; do not rename, do not add default exports, do not change arity.
- Only import from the specifiers listed in "allowed imports". Every relative import ends in .mjs.
- No require(), no module.exports, no npm packages, no bare specifiers other than node: builtins.
- Write complete, correct, production-quality code. No TODOs, no placeholders, no stubs that fake behavior.
- Match the surrounding conventions of a small clean library: JSDoc-free unless clarifying, meaningful names, no dead code.
- After writing, run \`node --input-type=module -e "import('${m.path}').then(m=>console.log(Object.keys(m).join(',')))"\` to confirm it parses and its exports load. If it imports a sibling that does not exist yet, that check may fail on resolution only — in that case run \`node --check\` is not valid for ESM, so instead verify syntax with \`node --input-type=module --eval "$(cat ${m.path} | sed 's/^import .*$//')"\` is also unreliable; simply re-read your file carefully for syntax errors and report the resolution failure rather than creating the sibling yourself.
- NEVER create or modify any file other than ${m.path}.

Return a one-paragraph summary: what you exported and any assumption you made that the integrator must check.`,
  { label: `impl:${m.path.replace('/output/', '')}`, phase: 'Implement' }
)))

log(`Implement complete: ${written.filter(Boolean).length}/${implModules.length} modules written`)

// ---------------------------------------------------------------- Phase 4: Integrate
phase('Integrate')

const entrySpec = spec.modules.find(m => m.path && m.path.endsWith('/test3.mjs'))

const integration = await agent(
`You are the integrator for the Python->Node port. All library modules under /output/lib have just been written in parallel by separate agents from a shared spec. Your job: write the entry point, then make the whole tree actually work together.

${GROUND_RULES}
${LAYOUT}
${OBSERVED}

SHARED INVARIANTS:
${invariants}

ENTRY POINT SPEC (/output/test3.mjs):
${entrySpec ? entrySpec.behaviorSpec + '\n\nexports:\n' + entrySpec.exports.map(e => `  - ${e.kind} ${e.name} :: ${e.signature}\n      ${e.contract}`).join('\n') : 'Mirror test3.py statement-for-statement: hand-parse process.argv with the lib/cli ArgumentParser (--a, type string, required), then build a StemmingAnalyzer, then Schema({content: TEXT({analyzer})}), then print the schema with a single console.log. Import only from ./lib/... .mjs paths.'}

IMPLEMENTER NOTES FROM THE PARALLEL AGENTS:
${written.filter(Boolean).map((w, i) => `[${implModules[i] ? implModules[i].path : i}] ${w}`).join('\n\n')}

DO THIS:
1. \`ls -R /output\` and read every file that was written.
2. Write /output/test3.mjs.
3. Fix cross-module drift: mismatched export names, mismatched arities, wrong relative paths, missing .mjs suffixes, import cycles, any require()/module.exports that slipped in, any bare/npm import.
4. Smoke test the success path and make it byte-exact:
     node /output/test3.mjs --a hello
   must print exactly \`<Schema: ['content']>\` and a newline, exit 0. Compare with \`diff <(${EXE} --a hello) <(node /output/test3.mjs --a hello)\` — it must be empty.
5. Smoke test the analyzer is REAL, not faked. Run a throwaway node -e (do not leave a file behind) that imports the analysis package and analyzes a sentence such as "The Rendering of Running Ponies flies quickly" — confirm it yields lowercased, stopword-filtered, Porter-stemmed tokens ("render","run","poni","flie"/"fli","quickli"/"quick" style output). If the pipeline is fake or broken, FIX it.
6. Smoke test the argparse error paths against the executable for: no args, --help, --a with no value, unknown option, extra positional. The only permitted difference is the program name (test3.mjs vs test3_executable) — normalize that with sed when diffing, and make everything else byte-identical.
7. Re-run \`grep -rn "require(\\|module.exports" /output\` and \`grep -rn "^import .*from ['\\\"][^.n]" /output\` to prove compliance. Fix anything found.

Return a concise report: the final file tree, the diff results for each smoke test, and any remaining known discrepancy.`,
  { label: 'integrator', phase: 'Integrate', effort: 'high' })

log('Integration pass complete')

// ---------------------------------------------------------------- Phase 5: Verify (adversarial, pipelined)
phase('Verify')

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'findings'],
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'severity', 'repro', 'expected', 'actual'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          repro: { type: 'string', description: 'exact shell command that demonstrates it' },
          expected: { type: 'string' },
          actual: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'reasoning', 'evidence'],
  properties: {
    isReal: { type: 'boolean' },
    reasoning: { type: 'string' },
    evidence: { type: 'string', description: 'the command re-run and its literal output' },
  },
}

const DIMENSIONS = [
  {
    key: 'differential-success',
    prompt: `Adversarially differential-test /output/test3.mjs against ${EXE} on the SUCCESS path.

Write a bash loop over a large matrix of valid invocations and byte-compare stdout AND exit codes using cmp/od. Include at minimum: --a hello, --a=hello, --a "", --a=, --a " spaces ", --a "multi word", --a -5, --a -5.5, --a=-x, --a one --a two, --a "unicode: héllo 日本語 🎉", --a "quote'inside", --a 'double"inside', --a "tab\\there", --a "$(printf 'new\\nline')", very long values, --a v with -h absent, and values containing shell-ish metacharacters.

For each: run both, capture stdout to files, compare with cmp -l, compare exit codes. Report ANY divergence. Also verify stdout ends with exactly one trailing newline in both (od -c).

Report only real, reproduced divergences.`,
  },
  {
    key: 'differential-errors',
    prompt: `Adversarially differential-test /output/test3.mjs against ${EXE} on ALL FAILURE and HELP paths.

Matrix must include: (no args), --help, -h, --h, --he, --hel, --a (missing value), --a -x, --a -- -x, --b, --a v --b 2, --a v extra, extra --a v, -a v, -, --, -- --a v, --a v --, --=, --=a, --ab c, --a v -h, -h --a, --xyz, ---a, --a=v --a, empty argv with COLUMNS=20 / COLUMNS=40 set.

For each case capture stdout, stderr and exit code SEPARATELY from both programs. The ONLY legitimate difference is the program name token ("test3_executable" vs "test3.mjs"). Normalize with \`sed -e 's/test3_executable/PROG/g' -e 's/test3\\.mjs/PROG/g'\` and then require byte-identical output on BOTH streams plus identical exit codes.

Pay special attention to: which stream each line goes to; trailing newlines; the blank line in --help; the exact help column alignment; error message wording and ordering when several errors could apply; whether usage wraps identically under narrow COLUMNS.

Report only real, reproduced divergences with the exact command and both outputs.`,
  },
  {
    key: 'compliance',
    prompt: `Audit /output for hard rule compliance. This is a pass/fail gate.

Check, with commands, and report every violation as a finding:
1. Every file under /output ends in .mjs. (\`find /output -type f ! -name '*.mjs'\`)
2. No \`require(\` and no \`module.exports\` / \`exports.\` anywhere: \`grep -rn "require(\\|module\\.exports\\|exports\\[" /output\`.
3. No bare (npm) import specifiers. Extract every import specifier: \`grep -rhoE "from ['\\\"][^'\\\"]+['\\\"]" /output\` plus dynamic \`import(\` calls, and confirm each is either a relative path ending in .mjs or a \`node:\`-prefixed builtin. Flag any \`whoosh\`, \`argparse\`, \`yargs\`, \`minimist\`, etc. Also flag builtins imported WITHOUT the node: prefix if the task's spirit requires it (report as minor).
4. Every relative import includes the .mjs suffix (no extensionless, no directory imports).
5. No package.json is required for it to run — confirm \`node /output/test3.mjs --a x\` works from a different cwd (e.g. \`cd /tmp && node /output/test3.mjs --a x\`) and with an absolute path.
6. No Python is embedded or spawned: \`grep -rn "child_process\\|spawn\\|execSync\\|python" /output\`.
7. Nothing was written outside /output: confirm /workspace/dataset still contains only test3.py and test3_executable, unmodified (\`ls -la /workspace/dataset\`).
8. The library is genuinely hierarchical (multiple modules by functionality, real exports), not one giant file plus stubs. Report as a finding if any "library" module is a fake that hardcodes the expected output.
9. Every module actually loads: for each .mjs file run \`node --input-type=module -e "await import('FILE')"\` and report any that throw.`,
  },
  {
    key: 'library-fidelity',
    prompt: `Verify the whoosh reimplementation under /output/lib/whoosh is a REAL working library, not a facade that hardcodes "<Schema: ['content']>".

Read every file. Then exercise the public API directly with \`node --input-type=module -e '...'\` (do not leave files behind; if you need scratch space use /tmp, never /output):
- Build a Schema with several fields of different names, print it; confirm the string form is \`<Schema: [...]>\` with names SORTED and rendered as a Python list repr with single quotes. Try names needing escaping (e.g. a name with an apostrophe) and confirm the quote-selection rule matches Python's repr.
- Confirm Schema rejects non-string names and names starting with '_' the way the real library does, and that names()/items()/iteration/__contains__-equivalents work.
- Confirm TEXT stores the analyzer passed to it and picks a positions-vs-frequency format according to its phrase/chars arguments, and that its defaults are sane.
- Run the StemmingAnalyzer over real text and check the token pipeline end to end: tokenization by the default regex, lowercasing, stopword removal, and correct Porter stemming. Test the Porter algorithm against known reference outputs, e.g. caresses->caress, ponies->poni, ties->ti, caress->caress, cats->cat, feed->feed, agreed->agre, plastered->plaster, motoring->motor, sing->sing, conflated->conflate, troubling->troubl, sized->size, hopping->hop, tanned->tan, falling->fall, hissing->hiss, fizzed->fizz, failing->fail, filing->file, happy->happi, sky->sky, relational->relat, conditional->condit, rational->ration, valenci->valenc, hesitanci->hesit, digitizer->digit, conformabli->conform, radicalli->radic, differentli->differ, vileli->vile, analogousli->analog, vietnamization->vietnam, predication->predic, operator->oper, feudalism->feudal, decisiveness->decis, hopefulness->hope, callousness->callous, formaliti->formal, sensitiviti->sensit, sensibiliti->sensibl, triplicate->triplic, formative->form, formalize->formal, electriciti->electr, electrical->electr, hopeful->hope, goodness->good, revival->reviv, allowance->allow, inference->infer, airliner->airlin, gyroscopic->gyroscop, adjustable->adjust, defensible->defens, irritant->irrit, replacement->replac, adjustment->adjust, dependent->depend, adoption->adopt, homologou->homolog, communism->commun, activate->activ, angulariti->angular, homologous->homolog, effective->effect, bowdlerize->bowdler, probate->probat, rate->rate, cease->ceas, controll->control, roll->roll.
  Report every mismatch as a finding with severity major.
- Confirm the stopword filter drops the expected short/common words and respects its minsize default.

Only report findings you actually reproduced.`,
  },
  {
    key: 'robustness',
    prompt: `Hunt for latent defects in /output that the happy-path tests would miss. Read all the code carefully first, then try to break it.

Focus areas:
- Argument parsing corner cases not covered by the obvious matrix: option token exactly "--", "-", "---a", "--a=--a", repeated "=" as in "--a=b=c", arguments after a successful parse, unicode/emoji in option values, extremely long argv, argv containing NUL-free control characters, and \`node /output/test3.mjs\` invoked via a symlink or with a relative path (does the program-name derivation still behave like Python's basename(sys.argv[0])?).
- Crash-vs-clean-exit: does any input produce a raw Node stack trace or an unhandled rejection instead of the argparse-style "usage:" + "error:" on stderr with exit 2? A stack trace is a BLOCKER. Test aggressively.
- Exit code correctness in every path (0 success, 0 help, 2 usage error).
- Correctness bugs in the Porter stemmer, the tokenizer regex, the stopword set, or the Python-repr escaping that would surface with different inputs even if this script's output is constant.
- Infinite loops / catastrophic regex backtracking in the tokenizer: try a 200KB pathological input string through the analyzer with a timeout.
- Any reliance on mutable module-level state that would break a second parse in the same process.

Compare against ${EXE} wherever the behavior is observable. Report only reproduced defects, each with an exact repro command.`,
  },
]

// Pipeline: each dimension's findings get adversarially verified as soon as that dimension finishes.
const verifiedByDim = await pipeline(
  DIMENSIONS,
  d => agent(`${d.prompt}\n\n${GROUND_RULES}\n${OBSERVED}\n\nThe port under test is /output/test3.mjs with its library under /output/lib. Do NOT fix anything — only report. Run real commands; never speculate.`,
    { label: `find:${d.key}`, phase: 'Verify', schema: FINDING_SCHEMA, effort: 'high' }),
  (report, d) => {
    if (!report || !report.findings || !report.findings.length) return []
    return parallel(report.findings.slice(0, 24).map(f => () =>
      agent(`Adversarially verify this reported defect in the Node port at /output. Your default stance is SKEPTICISM: try to REFUTE it. Many reported "bugs" are misreadings, environment artifacts, or differences that are actually correct faithful ports.

CLAIM: ${f.title}
file: ${f.file}
severity claimed: ${f.severity}
repro: ${f.repro}
expected: ${f.expected}
actual: ${f.actual}

Re-run the repro yourself, verbatim, and read the relevant source. Decide:
- Is the divergence REAL and reproducible right now?
- Is it actually a DEFECT, or is it the correct faithful behavior? In particular, a difference in the PROGRAM NAME ("test3.mjs" vs "test3_executable") in usage/error text is CORRECT and NOT a defect, because Python derives it from basename(sys.argv[0]) — refute any finding whose only substance is that. Likewise, differences on paths where the reference program itself is inconsistent are not defects.
- If uncertain, set isReal=false.

${GROUND_RULES}
Return your verdict with the literal command output as evidence.`,
        { label: `verify:${d.key}:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => (v && v.isReal) ? { ...f, dimension: d.key, evidence: v.evidence, reasoning: v.reasoning } : null)
    ))
  }
)

const confirmed = verifiedByDim.flat().filter(Boolean)
log(`Verify complete: ${confirmed.length} confirmed defect(s) after adversarial screening`)

// ---------------------------------------------------------------- Phase 6: Repair
phase('Repair')

let repairReport = 'No confirmed defects; no repair pass needed.'

if (confirmed.length) {
  const bullets = confirmed
    .sort((a, b) => ({ blocker: 0, major: 1, minor: 2 }[a.severity] - { blocker: 0, major: 1, minor: 2 }[b.severity]))
    .map((f, i) => `${i + 1}. [${f.severity}] (${f.dimension}) ${f.title}\n   file: ${f.file}\n   repro: ${f.repro}\n   expected: ${f.expected}\n   actual: ${f.actual}\n   confirmed because: ${f.reasoning}`)
    .join('\n\n')

  repairReport = await agent(
`Fix every confirmed defect in the Node port under /output. Each has already been independently reproduced and adversarially screened, so treat them as real.

${GROUND_RULES}
${OBSERVED}

CONFIRMED DEFECTS (most severe first):
${bullets}

RULES FOR THE REPAIR:
- Fix the ROOT CAUSE in the library module that owns the behavior. Do not special-case the specific test input, and never hardcode the expected stdout.
- Keep the hierarchical module structure and every export contract intact.
- Do not regress anything. After each fix, re-run the relevant repro AND the full regression set below.
- A difference consisting ONLY of the program name (test3.mjs vs test3_executable) is CORRECT — do not "fix" it by hardcoding the executable's name.

REGRESSION SET (all must pass when you are done):
  A) diff <(${EXE} --a hello) <(node /output/test3.mjs --a hello)                       -> empty, both exit 0
  B) for each of: "" , "--a=x" , "--a -5" , "--a one --a two"  -> stdout identical to the executable
  C) for each of: (no args), --help, -h, "--a", "--b", "--a v extra", "--a v --", "--=a", "--ab c", "-a v", "--a v -h", "-- --a v", "--a -- -x"
     -> stdout, stderr and exit code identical after normalizing the program name with
        sed -e 's/test3_executable/PROG/g' -e 's/test3\\.mjs/PROG/g'
  D) grep -rn "require(\\|module\\.exports" /output    -> no matches
  E) every import specifier is relative-and-.mjs or node:-prefixed
  F) cd /tmp && node /output/test3.mjs --a x           -> works
  G) the StemmingAnalyzer still really tokenizes/lowercases/stops/stems (spot-check ponies->poni, running->run, relational->relat)

Report what you changed, file by file, and paste the final regression results.`,
    { label: 'repair', phase: 'Repair', effort: 'high' })
}

// ---------------------------------------------------------------- Final gate
const finalGate = await agent(
`FINAL ACCEPTANCE GATE for the Python->Node port at /output. You are the last check before delivery. Be ruthless and run everything yourself; trust no prior report.

${GROUND_RULES}
${OBSERVED}

Run, and paste literal output for, all of:
1. \`find /output -type f | sort\` and confirm every file ends in .mjs and the structure is genuinely hierarchical (multiple functional modules).
2. \`diff <(${EXE} --a hello) <(node /output/test3.mjs --a hello); echo "rc=$?"\` -> must be empty.
3. \`node /output/test3.mjs --a hello | od -c | tail -3\` -> must show the exact bytes of \`<Schema: ['content']>\\n\`.
4. A loop over these argv sets comparing stdout, stderr and exit code with the executable, normalizing only the program name via sed:
   (no args) | --help | -h | --a | --a hello | --a=hello | --a "" | --a= | --a -5 | --a -x | --a one --a two | --b | --a v --b 2 | --a v extra | --a v -- | --=a | --ab c | -a v | --a v -h | -- --a v | --a -- -x
   Print a PASS/FAIL table.
5. \`grep -rn "require(\\|module\\.exports" /output\` -> must be empty.
6. Every import specifier is either relative ending in .mjs or node:-prefixed. Prove it by listing all specifiers.
7. \`cd /tmp && node /output/test3.mjs --a x\` -> works.
8. \`ls -la /workspace/dataset\` -> still only test3.py and test3_executable.
9. Prove the whoosh layer is real: a one-liner importing the analysis package that analyzes "The ponies are running relationally" and prints the token list; and one importing fields that builds Schema with fields named zebra, apple, mango and prints it (must be \`<Schema: ['apple', 'mango', 'zebra']>\`).

If ANY check fails, FIX it now at the root cause and re-run the full list until everything passes. Do not hardcode expected output.

Finish with: the final file tree, a PASS/FAIL line per check, and a short statement of any remaining known limitation.`,
  { label: 'final-gate', phase: 'Repair', effort: 'high' })

return {
  modulesSpecced: spec.modules.length,
  modulesWritten: written.filter(Boolean).length,
  confirmedDefects: confirmed.length,
  defectTitles: confirmed.map(f => `[${f.severity}] ${f.title}`),
  integration,
  repairReport,
  finalGate,
}
