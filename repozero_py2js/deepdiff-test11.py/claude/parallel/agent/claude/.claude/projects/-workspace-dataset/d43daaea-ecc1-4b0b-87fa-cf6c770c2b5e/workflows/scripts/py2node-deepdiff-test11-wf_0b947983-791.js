export const meta = {
  name: 'py2node-deepdiff-test11',
  description: 'Migrate /workspace/dataset/test11.py (deepdiff) to zero-dependency ESM Node in /output, then adversarially differential-test to byte equality',
  phases: [
    { title: 'Spec', detail: 'independent black-box specs: repr, difflib, argparse, int()' },
    { title: 'Implement', detail: 'write hierarchical .mjs modules + entry point to /output' },
    { title: 'Test', detail: 'parallel differential testers, distinct lenses, byte-exact' },
    { title: 'Fix', detail: 'serialized fixer applies confirmed mismatches' },
    { title: 'Audit', detail: 'completeness critic + requirements compliance' },
  ],
}

const RULES = `
HARD CONSTRAINTS (violating any of these invalidates the work):
- Target runtime: Node.js, pure JavaScript. ES Modules ONLY: use 'import'/'export'.
  'require()' and 'module.exports' are STRICTLY PROHIBITED anywhere.
- Every generated file MUST use the .mjs suffix. Every relative import MUST include the
  full './x.mjs' suffix.
- ZERO external dependencies. Do NOT npm install anything. Do NOT import any package name.
  Only relative local file imports are allowed. Node built-ins (node:process etc.) are
  permitted but keep them to the absolute minimum - the program needs none beyond the
  'process' global.
- Do NOT embed, shell out to, or invoke Python. NEVER run the 'python' command.
- You MAY and SHOULD run the pre-compiled reference: /workspace/dataset/test11_executable --a X --b N
- All generated code lives under /output. Test scaffolding goes under /workspace/verify/
  (never in /output).
- Read /workspace/GROUND_TRUTH.md first. It is authoritative black-box spec already
  verified against the executable.
- Source program: /workspace/dataset/test11.py (you may read it).
`

const MODULE_LAYOUT = `
Required file layout in /output (hierarchical, split by functionality):
  /output/test11.mjs                  entry point, mirrors test11.py line for line
  /output/lib/unicode_tables.mjs      unicode data needed by repr (non-printable ranges) + decimal-digit values
  /output/lib/pyrepr.mjs              Python repr()/str() for str, int (BigInt), dict, list; plus print()
  /output/lib/pyint.mjs               Python int(str) -> BigInt with full CPython grammar
  /output/lib/argparse.mjs            minimal faithful argparse clone (ArgumentParser)
  /output/lib/difflib.mjs             SequenceMatcher + unified_diff + range formatting
  /output/lib/deepdiff/diff.mjs       DeepDiff
  /output/lib/deepdiff/extract.mjs    extract() + "root['users'][0]" path parser
  /output/lib/deepdiff/index.mjs      re-exports { DeepDiff, extract }
Each module exports its public interface via 'export'.
`

// ---------------------------------------------------------------- Phase 1: Spec
phase('Spec')

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    algorithm: { type: 'string', description: 'Precise, implementable pseudocode / rules. Be exhaustive.' },
    testVectors: {
      type: 'array',
      description: 'Concrete input -> expected output pairs verified against the executable',
      items: {
        type: 'object',
        properties: {
          input: { type: 'string' },
          expected: { type: 'string' },
          howVerified: { type: 'string' },
        },
        required: ['input', 'expected'],
      },
    },
    pitfalls: { type: 'array', items: { type: 'string' } },
  },
  required: ['area', 'algorithm', 'testVectors', 'pitfalls'],
}

const SPEC_AREAS = [
  {
    key: 'pyrepr',
    prompt: RULES + `

Your job: produce an EXHAUSTIVE, implementable specification of Python's repr()/print()
formatting as this program needs it. Cover:
1. str repr: quote selection (single vs double), backslash escaping, the special short
   escapes (backslash-n, backslash-r, backslash-t, double backslash, and the quote char),
   and the hex fallbacks \\xHH / \\uXXXX / \\UXXXXXXXX.
2. EXACTLY which code points are "non-printable" and therefore escaped. Python uses
   Unicode general categories: not printable = Cc, Cf, Cs, Co, Cn, Zl, Zp, and Zs except
   U+0020. Determine the concrete code-point RANGES a JS implementation needs. Node has
   RegExp Unicode property escapes (\\p{Cc} etc.) available natively with the /u flag -
   evaluate whether using them is simpler and exactly equivalent, and say so.
   Pay attention to astral-plane handling: repr operates on CODE POINTS, not UTF-16 units.
   Determine what Python prints for lone/unpaired surrogates and for astral printables.
3. int repr for arbitrary-precision values (BigInt in JS; never emit the trailing 'n').
4. dict and list repr: separators, key formatting, insertion order.
5. print() semantics: a str argument is written raw; other objects are repr'd.

VERIFY each claim by running the executable. The 5th stdout line is
repr({'name': <a>, 'age': <b>}) so it shows repr of your string. Use bash ANSI-C quoting
like --a $'x\\u00adz' to inject control characters precisely, or build argv from a small
throwaway Node script under /workspace/verify/ to avoid bash quoting fights.
Probe at least: ASCII control chars, DEL 0x7f, the C1 range 0x80-0x9f, U+00A0, U+00AD,
U+200B through U+200F, U+2028, U+2029, U+2060, U+FEFF, U+E000 (private use),
U+FFFE and U+FFFF (unassigned), an astral printable (U+10000, emoji), an astral
private-use char (U+F0000), and strings mixing single and double quotes.
Report findings as structured data. Be precise about ranges; guessing is failure.`,
  },
  {
    key: 'difflib',
    prompt: RULES + `

Your job: produce an EXHAUSTIVE, implementable specification of CPython's
difflib.SequenceMatcher + difflib.unified_diff, sufficient to reimplement byte-exactly in JS.
Cover in full detail:
1. SequenceMatcher.__chain_b: b2j construction, isjunk purge, and the autojunk purge
   (n >= 200, ntest = n // 100 + 1, strictly-greater-than test), and the crucial fact that
   'popular' elements go in bpopular NOT bjunk.
2. find_longest_match: the j2len rolling-dict inner loop, the tie-breaking (earliest i,
   then earliest j, then longest), and BOTH post-extension while-loops - first the
   non-junk extension, then the junk extension. Order matters.
3. get_matching_blocks: the queue/recursion, adjacent-block coalescing, terminating
   sentinel (la, lb, 0).
4. get_opcodes: replace/delete/insert/equal emission.
5. get_grouped_opcodes(n=3): the leading/trailing context trimming (the max(i1, i2-n) and
   min(i2, i1+n) clamps), the group-splitting rule when an equal block exceeds 2*n, and
   the final group flush. This is where off-by-one bugs live.
6. unified_diff with lineterm='' and default empty fromfile/tofile: the exact
   '--- ' and '+++ ' header strings (note the trailing space) and _format_range_unified
   (length 1 -> just the start; length 0 -> start-1 followed by ',0'; else start,length).
7. str.splitlines(): the full set of boundary characters and the no-trailing-empty rule.

VALIDATE against the executable. The 4th stdout line contains the 'diff' payload when
--a contains a newline. Compare against the table in /workspace/GROUND_TRUTH.md and add
NEW cases of your own: strings whose changed line sits exactly 3 and 4 lines from the
start and end (the context boundary), 200-plus line inputs, repeated identical lines,
lines containing only whitespace, and carriage-return-only line endings. Remember that
new_value is always old_value plus the character '2', so the changed region is always at
the tail - state that limitation explicitly.
Also nail down the exact gate for emitting 'diff': confirm it keys off the presence of a
newline character and the len(diff) > 4 threshold. Report as structured data.`,
  },
  {
    key: 'argparse',
    prompt: RULES + `

Your job: produce an EXHAUSTIVE, implementable specification of the argparse behavior of:
  parser = argparse.ArgumentParser()
  parser.add_argument('--a', type=str, required=True)
  parser.add_argument('--b', type=int, required=True)
  args = parser.parse_args()

Determine and verify against the executable, character by character:
1. The exact --help output (stdout, exit 0). Note the section header is 'options:' on
   modern Python. Reproduce the exact column alignment of the help table.
2. The exact usage line, and to which stream it goes in each situation.
3. Every error message and exit code: missing required (single and multiple, ordering),
   invalid int value (including how the offending value is quoted - it is Python repr),
   unrecognized arguments (positional extras, unknown options, a bare double dash), and
   'expected one argument'.
4. Token grammar: the --a=value inline form, the --a value form, later-wins on repeats,
   order independence, whether single-dash -a works, long-option prefix abbreviation
   (is --h accepted? what about ambiguous prefixes?), the effect of a bare double dash
   separator, and how a value that looks like a negative number (--a -5) is treated.
   Test what happens with '--a --b' (does --b get consumed as a's value?).
5. The order in which validation errors are detected when several are present at once
   (for example missing required AND unrecognized AND bad int).
6. Whether the prog name comes from the script basename, and how a JS port should derive
   it from process.argv.
Probe every one of these against the executable and report exact observed bytes.
Report as structured data.`,
  },
  {
    key: 'pyint',
    prompt: RULES + `

Your job: produce an EXHAUSTIVE, implementable specification of Python's int(str)
conversion as used by argparse type=int, targeting a JS BigInt implementation.
Cover and VERIFY against the executable (the 3rd stdout line is b+1, so it reveals the
parsed value; a parse failure produces an argparse error on stderr):
1. Whitespace stripping: which characters count. Python strips per str.isspace() -
   determine the full set including U+00A0, U+0085, U+1680, U+2000 through U+200A,
   U+2028, U+2029, U+202F, U+205F, U+3000, plus ASCII tab, newline, vertical tab,
   form feed, carriage return and space. Test several.
2. Sign handling: '+5', '-5', '  -5  ', and rejection of ' - 5', '--5', '5-'.
3. Underscore rules: single separators between digits only. Test '1_000', '1__0', '_1',
   '1_', '+_1', '1_000_000'. Also test an underscore adjacent to the sign.
4. Unicode decimal digits: Python accepts any character with the Unicode decimal digit
   property, using its numeric value. Verify Arabic-Indic (U+0660-U+0669), Extended
   Arabic-Indic (U+06F0-U+06F9), Devanagari (U+0966-U+096F), fullwidth (U+FF10-U+FF19),
   and at least one astral digit range such as U+1D7CE mathematical bold digits.
   Determine whether MIXING scripts within one number is accepted.
   Also test characters that are 'digit' or 'numeric' but NOT 'decimal' - superscript two
   U+00B2, and Roman numeral one U+2160 - these must be REJECTED. Verify.
   IMPORTANT: enumerate the concrete code-point ranges (or the rule) a JS implementation
   must support, and evaluate whether RegExp \\p{Nd} with the /u flag is exactly equivalent
   and how to map a matched digit to its value (offset from its range start).
5. Arbitrary precision: verify a 40-digit input round-trips through +1 correctly.
6. Rejections: empty string, '5.0', '0x10', '1e3', 'abc', '5 5', 'nan', 'inf'.
Report as structured data with exact observed evidence.`,
  },
]

// Barrier is justified: the implementer needs ALL four specs together to write coherent
// interlocking modules.
const specs = (await parallel(SPEC_AREAS.map(a => () =>
  agent(a.prompt, { label: 'spec:' + a.key, phase: 'Spec', schema: SPEC_SCHEMA })
))).filter(Boolean)

log('collected ' + specs.length + '/4 specs')

function renderSpec(s) {
  return '### AREA: ' + s.area + '\n\nALGORITHM:\n' + s.algorithm + '\n\nTEST VECTORS:\n' +
    s.testVectors.map(v => '- input=' + v.input + ' => expected=' + v.expected).join('\n') +
    '\n\nPITFALLS:\n' + s.pitfalls.map(p => '- ' + p).join('\n')
}
const SPEC_DOC = specs.map(renderSpec).join('\n\n---\n\n')

// ---------------------------------------------------------- Phase 2: Implement
phase('Implement')

const implReport = await agent(RULES + MODULE_LAYOUT + `

Write the complete migration now. Below are four verified specifications produced by
independent analysts. Implement to them faithfully.

` + SPEC_DOC + `

IMPLEMENTATION REQUIREMENTS:
- /output/test11.mjs must mirror /workspace/dataset/test11.py statement for statement:
  parse args, build the obj, then eight prints in the same order. Keep the original
  Chinese comments from the Python source where they appeared, as JS comments.
- 'age' values are arbitrary-precision: use BigInt end to end. b + 1 is BigInt addition.
  repr of a BigInt must NOT include the trailing 'n'.
- Dict values must preserve insertion order and be distinguishable from lists by the
  repr/diff layer. Use a small explicit representation (for example a PyDict class
  wrapping an array of key/value entries, or a Map) - your choice, but the choice must
  make repr, DeepDiff and extract all straightforward. Document it in a header comment.
- DeepDiff only has to be correct for the shapes this program produces, but implement it
  as a genuine recursive differ (dict vs dict, list vs list, scalar vs scalar) rather
  than hardcoding the eight expected strings. Hardcoding the answers is FAILURE.
  It must produce: values_changed (with the optional 'diff' payload for multi-line
  strings), iterable_item_removed, iterable_item_added, dictionary_item_removed,
  dictionary_item_added, and type_changes, keyed by root[...] paths, in the same
  report-key order and path order the executable uses.
- extract() must genuinely parse a path string like root['users'][0]['name'] and walk the
  object, not pattern-match the four literal paths used here.
- print(): implement as console.log with a single already-formatted string argument so
  output is byte-exact. Route argparse errors to console.error. For exit codes set
  process.exitCode - do NOT call process.exit, which can truncate piped stderr.
- Include brief comments explaining non-obvious fidelity choices (the autojunk extension
  loops, the printable-category table, the len(diff) > 4 gate, and so on).

After writing every file, self-check by running:
  node /workspace/verify/cmp.mjs --a hello --b 5
  node /workspace/verify/cmp.mjs --a "it's" --b 0
  node /workspace/verify/cmp.mjs --a "$(printf 'a\\nb')" --b 1
  node /workspace/verify/cmp.mjs --b 3
  node /workspace/verify/cmp.mjs --help
That harness spawns both binaries with an identical argv array and compares stdout byte
for byte (stderr is compared with the prog name normalised, since test11_executable vs
test11.mjs legitimately differ). Iterate until all five PASS. Also confirm with grep that
no file in /output contains 'require(' or 'module.exports', and that /output contains only
.mjs files.

Return a concise inventory: each file written, its exported interface, and the results of
the five self-checks.`, { label: 'implement', phase: 'Implement' })

log('implementation written')

// ------------------------------------------------ Phases 3+4: Test / Fix loop
const MISMATCH_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    casesRun: { type: 'number' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          argvJson: { type: 'string', description: 'JSON array of the exact argv that reproduces' },
          stream: { type: 'string', description: 'stdout | stderr | exitcode' },
          pythonSaid: { type: 'string' },
          nodeSaid: { type: 'string' },
          rootCause: { type: 'string', description: 'which /output module and what is wrong' },
        },
        required: ['argvJson', 'stream', 'pythonSaid', 'nodeSaid'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['lens', 'casesRun', 'mismatches'],
}

const LENSES = [
  { key: 'argparse', focus: 'Command-line parsing. Every error path, --help, exit codes, the --a=v inline form, repeated options, ordering, single-dash -a, --h and other prefix abbreviations, the bare double-dash separator, --a -5, --a --b, missing one vs both required args, unknown options, extra positionals, and combinations where several errors coexist. At least 40 cases.' },
  { key: 'repr-unicode', focus: 'repr() fidelity for --a. Control characters (all of 0x00-0x1f and 0x7f), the C1 range 0x80-0x9f, U+00A0, U+00AD, format chars U+200B-U+200F, U+2060, U+FEFF, line and paragraph separators U+2028 and U+2029, every Zs space character, private use U+E000 and U+F0000, unassigned U+FFFE and U+FFFF, astral printables including emoji and U+10000, combining marks, RTL text, strings containing only single quotes, only double quotes, both, backslashes, and strings that are empty or pure whitespace. At least 50 cases. Note: bytes that are invalid UTF-8 in argv are out of scope (Python uses surrogateescape, Node cannot reproduce it) - skip those but say so.' },
  { key: 'multiline-diff', focus: 'The unified-diff payload. Vary line counts 1 through 12 and around 199, 200, 201 and 250 for the autojunk threshold. Include: trailing newline, multiple trailing newlines, leading newline, blank interior lines, CRLF endings, bare CR endings, mixed endings, lines that are only spaces, identical repeated lines, very long single lines, and strings containing vertical tab, form feed, U+2028 and U+0085 (which splitlines splits on but which must NOT trigger the diff gate). Verify the exact hunk headers. At least 45 cases.' },
  { key: 'bigint-int', focus: '--b parsing and arithmetic. Huge magnitudes (40, 100, 400 digits), negative huge, 0, -0, +0, values near 2 to the 53 and 2 to the 64 where naive JS numbers lose precision, underscores in every legal and illegal position, signs, leading and trailing whitespace of every Unicode whitespace kind, Unicode decimal digits from several scripts (Arabic-Indic, Extended Arabic-Indic, Devanagari, Bengali, fullwidth, and an astral set such as U+1D7CE), MIXED-script digit strings, and rejections: empty, 5.0, 0x10, 1e3, abc, nan, inf, an Arabic-Indic number with a decimal point, superscript two U+00B2, Roman numeral U+2160. At least 45 cases.' },
  { key: 'fuzz-a', focus: 'Randomised fuzzing, seed "alpha". Generate about 120 random --a strings (random lengths 0 to 40, drawn from a pool mixing ASCII printables, quotes, backslashes, newlines, tabs, control chars, CJK, emoji, combining marks, and Zs/Cf characters) paired with random valid --b values including huge BigInts. Write them to a JSON cases file and run the harness in --cases mode.' },
  { key: 'fuzz-b', focus: 'Randomised fuzzing, seed "beta" - use a DIFFERENT generator shape than the other fuzzer: bias heavily toward multi-line strings (2 to 15 lines) built from a small alphabet of repeated line values so many lines are identical, plus random blank lines and random line terminators (LF, CRLF, CR). Pair with random --b. About 120 cases via the JSON cases file.' },
  { key: 'structure', focus: 'Compliance and structural review rather than I/O fuzzing. Verify: /output contains ONLY .mjs files and no stray artifacts; no file contains require( or module.exports; no import statement references a bare package name (only relative ./x.mjs paths and at most node: built-ins); no node_modules or package.json was created; nothing invokes python; DeepDiff and extract are genuinely general (not hardcoded to the eight expected strings) - prove it by writing a scratch ESM script under /workspace/verify/ that imports the /output modules directly and exercises DeepDiff and extract on inputs the program never produces (nested dicts, added and removed dict keys, type changes, longer and shorter lists, empty containers, deeply nested paths). Report any hardcoding, any ESM violation, and any general-correctness bug as mismatches with stream=stdout and argvJson set to ["<module-level>"].' },
]

let round = 0
let dry = 0
const fixLog = []

while (round < 4 && dry < 1) {
  round++
  const roundLabel = 'r' + round
  phase('Test')

  // Barrier is justified: the fixer must see ALL mismatches at once so it can edit the
  // shared /output files serially without conflicting concurrent writes.
  const thunks = LENSES.map(l => () => agent(RULES + `

You are differential-test lens "` + l.key + `", round ` + round + `. The Node port already
exists in /output. Your job is to BREAK it by finding inputs where it disagrees with
/workspace/dataset/test11_executable, byte for byte.

FOCUS: ` + l.focus + `

Use the harness: node /workspace/verify/cmp.mjs <argv...>  for single cases, or
  node /workspace/verify/cmp.mjs --cases /workspace/verify/cases_` + l.key + '_' + roundLabel + `.json
where the file is a JSON array of argv arrays. Building the cases file with a small
throwaway Node script under /workspace/verify/ is the reliable way to inject exotic code
points - do not fight bash quoting.

The harness normalises the program name in stderr (test11_executable vs test11.mjs) because
that difference is expected and legitimate. Any OTHER difference is a real bug.

Report ONLY genuine mismatches you actually observed, each with the exact argv JSON that
reproduces it. Do not report cases that pass. Do not fix anything yourself - another agent
applies fixes. If you find zero mismatches, return an empty mismatches array and say in
notes how many cases you ran and what you covered.`,
    { label: 'test:' + l.key + ':' + roundLabel, phase: 'Test', schema: MISMATCH_SCHEMA })
  )

  const reports = (await parallel(thunks)).filter(Boolean)

  const all = []
  let totalCases = 0
  for (const r of reports) {
    totalCases += r.casesRun || 0
    for (const m of (r.mismatches || [])) {
      all.push({ argvJson: m.argvJson, stream: m.stream, pythonSaid: m.pythonSaid, nodeSaid: m.nodeSaid, rootCause: m.rootCause, lens: r.lens || 'unknown' })
    }
  }
  log('round ' + round + ': ' + totalCases + ' cases across ' + reports.length + ' lenses, ' + all.length + ' mismatches')

  if (all.length === 0) {
    dry++
    fixLog.push({ round: round, cases: totalCases, mismatches: 0, fixed: 'nothing to fix' })
    continue
  }

  phase('Fix')
  const bundle = all.map(function (m, i) {
    return '#' + (i + 1) + ' [lens=' + m.lens + '] stream=' + m.stream +
      '\n  argv: ' + m.argvJson +
      '\n  python: ' + m.pythonSaid +
      '\n  node:   ' + m.nodeSaid +
      '\n  suspected cause: ' + (m.rootCause || 'unknown')
  }).join('\n\n')

  const fixResult = await agent(RULES + MODULE_LAYOUT + `

Round ` + round + ` differential testing found ` + all.length + ` reported mismatches
between /output/test11.mjs (plus its lib modules) and the reference executable. Fix them all.

` + bundle + `

METHOD:
1. For EACH reported mismatch, first reproduce it yourself with
   node /workspace/verify/cmp.mjs <argv...>   (or a --cases file for exotic code points).
   Some reports may be wrong or already fixed - if a case actually passes, note it as
   'not reproducible' and move on. Do not change code to chase a phantom.
2. For reproducible ones, find the ROOT CAUSE in the library modules and fix it there,
   generally - never special-case the specific input, and never hardcode expected output.
   Prefer making the JS faithfully implement the underlying CPython/deepdiff algorithm.
3. After fixing, re-run every reported case plus this regression set:
     --a hello --b 5 | --a "it's" --b 0 | --a "" --b -5 | --a $'a\\nb' --b 1
     --a $'p\\nq\\nr' --b 1 | --b 3 | --help | --a x --b 999999999999999999999
     --a x --b abc
   Confirm all pass. Keep iterating until they do.
4. Preserve the ESM / .mjs / zero-dependency constraints while fixing.

Return: for each mismatch, whether it reproduced and what you changed (file plus
rationale); plus the final pass/fail state of the regression set.`,
    { label: 'fix:' + roundLabel, phase: 'Fix' })

  fixLog.push({ round: round, cases: totalCases, mismatches: all.length, fixed: fixResult })
}

// --------------------------------------------------------------- Phase 5: Audit
phase('Audit')

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', description: 'PASS or FAIL' },
    requirementChecks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirement: { type: 'string' },
          status: { type: 'string', description: 'met | violated | unverified' },
          evidence: { type: 'string' },
        },
        required: ['requirement', 'status', 'evidence'],
      },
    },
    remainingGaps: { type: 'array', items: { type: 'string' } },
    fileInventory: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'requirementChecks', 'remainingGaps', 'fileInventory'],
}

const auditThunks = [
  () => agent(RULES + `

FINAL COMPLIANCE AUDIT. Check the delivered /output against every stated task requirement
and report status with concrete evidence (commands you ran and their output):
1. Pure JavaScript for Node; ESM mandatory; no require() or module.exports anywhere.
2. All generated library and entry files use the .mjs suffix; all relative imports include
   the .mjs suffix and resolve (prove it by actually running the program).
3. The command-line interface matches the Python exactly: --a required string, --b
   required int, same required/optional/default semantics.
4. Output byte-identical to the executable for valid inputs.
5. Zero external dependencies: no npm packages imported, no package.json or node_modules
   created, no bare-specifier imports, no Python embedded or invoked.
6. Hierarchical organisation: libraries genuinely split by functionality with interfaces
   exposed via export - not one monolith and not a pile of stubs.
7. Everything under /output; nothing the program needs lives outside it (verify that no
   import inside /output points outside /output).
8. No hardcoded expected outputs masquerading as an implementation.
Run: node /output/test11.mjs --a hello --b 5 and confirm it matches the executable.
Report structured findings. Be adversarial - your job is to catch a violation, not to
rubber-stamp.`, { label: 'audit:compliance', phase: 'Audit', schema: AUDIT_SCHEMA }),

  () => agent(RULES + `

COMPLETENESS CRITIC. Differential testing has finished. Ask: what is still UNVERIFIED?
Hunt specifically for input classes nobody exercised. Consider at minimum:
- interactions between features (a multi-line --a combined with a huge BigInt --b; a
  string that is simultaneously multi-line and contains quotes, backslashes and control
  characters)
- extremely long inputs (10k-plus chars, 1000-plus lines) and recursion or performance
  limits: does the JS SequenceMatcher blow the stack or take pathologically long where
  Python does not? Try 5000 lines.
- argv edge cases: repeated --help, --help combined with invalid args, options appearing
  after the bare double-dash separator
- whether stdout ordering or buffering can interleave differently from Python
- whether a non-zero exit path ever emits partial stdout in one implementation only
Pick the highest-value gaps, ACTUALLY TEST them with node /workspace/verify/cmp.mjs ...
and report what you found. Anything that fails is a real gap - report it with a
reproducer. Set verdict FAIL if you found any real mismatch.`,
    { label: 'audit:completeness', phase: 'Audit', schema: AUDIT_SCHEMA }),
]

const audits = (await parallel(auditThunks)).filter(Boolean)

// If the audits surfaced real problems, do one final targeted repair pass.
const auditGaps = []
for (const a of audits) {
  const failed = (a.verdict || '').toUpperCase() === 'FAIL'
  for (const c of (a.requirementChecks || [])) {
    if (c.status === 'violated') auditGaps.push(c.requirement + ': ' + c.evidence)
  }
  if (failed) {
    for (const g of (a.remainingGaps || [])) auditGaps.push(g)
  }
}

let finalRepair = 'no audit-driven repair needed'
if (auditGaps.length) {
  phase('Fix')
  finalRepair = await agent(RULES + MODULE_LAYOUT + `

The final audit found these outstanding problems. Reproduce each, fix the root cause in
the /output library modules, and re-verify:

` + auditGaps.map(function (g, i) { return '#' + (i + 1) + ' ' + g }).join('\n') + `

Reproduce with node /workspace/verify/cmp.mjs <argv...> before changing anything; report
anything that does not reproduce as such instead of editing blindly. Finish by re-running
the regression set:
  --a hello --b 5 | --a "it's" --b 0 | --a "" --b -5 | --a $'a\\nb' --b 1 | --b 3
  --help | --a x --b abc | --a x --b 999999999999999999999
and confirming all pass. Report what you changed and the final state.`,
    { label: 'fix:audit', phase: 'Fix' })
}

return {
  implementation: implReport,
  rounds: fixLog,
  audits: audits,
  auditGaps: auditGaps,
  finalRepair: finalRepair,
}
