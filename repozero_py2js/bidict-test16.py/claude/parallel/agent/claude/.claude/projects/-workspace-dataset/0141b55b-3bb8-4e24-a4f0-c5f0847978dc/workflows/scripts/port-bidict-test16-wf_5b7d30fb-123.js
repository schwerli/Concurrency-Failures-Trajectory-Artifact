export const meta = {
  name: 'port-bidict-test16',
  description: 'Probe the Python bidict/argparse executable, then build + differentially verify an ESM Node port in /output',
  phases: [
    { title: 'Probe', detail: 'parallel black-box probes of argparse, int(), repr, bidict semantics' },
    { title: 'Spec', detail: 'synthesize probe findings into one behavioral spec' },
    { title: 'Implement', detail: 'write hierarchical .mjs library + entry point to /output' },
    { title: 'Verify', detail: 'differential testing node vs executable, loop until dry' },
    { title: 'Fix', detail: 'repair mismatches' },
    { title: 'Audit', detail: 'constraint-compliance and fidelity review' },
  ],
}

const EXE = '/workspace/dataset/test16_executable'

const KNOWN = `
ALREADY-ESTABLISHED FACTS (do not re-derive, but you may re-confirm cheaply):

Source program (/workspace/dataset/bidict/test16.py):
  import argparse; from bidict import bidict
  parser = argparse.ArgumentParser()
  parser.add_argument('--k1', type=str, required=True)   # line 5
  parser.add_argument('--v1', type=int, required=True)   # line 6
  parser.add_argument('--k2', type=str, required=True)   # line 7
  parser.add_argument('--v2', type=int, required=True)   # line 8
  parser.add_argument('--k3', type=str, required=True)   # line 9
  parser.add_argument('--v3', type=int, required=True)   # line 10
  args = parser.parse_args()                             # line 11
  b = bidict({args.k1: args.v1, args.k2: args.v2})       # line 14
  print(b)                                               # line 15
  b[args.k3] = args.v3                                   # line 16
  print(b)                                               # line 17
  b.clear()                                              # line 18
  print(b)                                               # line 19
  b['new'] = 100                                         # line 22
  print(b)                                               # line 23

Executable to probe: ${EXE}   (run it directly; NEVER use the 'python' command)

Confirmed behaviors:
  * happy path: prints 4 lines, e.g.
      bidict({'z': 78, 'k': 1})
      bidict({'z': 78, 'k': 1, 's': 44})
      bidict()
      bidict({'new': 100})
    RC=0
  * k1 == k2  -> Python dict literal collapses; later value wins; ONE entry.
      --k1 a --v1 5 --k2 a --v2 6  =>  bidict({'a': 6})  then bidict({'a': 6, 'c': 9})
  * k3 == an existing key, new value -> value replaced IN PLACE (insertion position kept):
      {a:5,b:6} then b['a']=7  =>  bidict({'a': 7, 'b': 6})
  * k3 == existing key with the SAME value -> no-op, identical repr.
  * v1 == v2 (k1 != k2) -> bidict.ValueDuplicationError at line 14, RC=1, NOTHING on stdout.
    stderr exactly (PID number varies):
      Traceback (most recent call last):
        File "test16.py", line 14, in <module>
          b = bidict({args.k1: args.v1, args.k2: args.v2})
              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
        File "bidict/_base.py", line 161, in __init__
        File "bidict/_base.py", line 454, in _update
        File "bidict/_base.py", line 347, in _dedup
      bidict.ValueDuplicationError: 5
      [PYI-163:ERROR] Failed to execute script 'test16' due to unhandled exception!
  * v3 duplicates an existing value under a DIFFERENT key -> ValueDuplicationError at line 16,
    RC=1, stdout contains ONLY the first print line. stderr:
      Traceback (most recent call last):
        File "test16.py", line 16, in <module>
          b[args.k3] = args.v3
          ~^^^^^^^^^
        File "bidict/_bidict.py", line 80, in __setitem__
        File "bidict/_bidict.py", line 106, in put
        File "bidict/_base.py", line 454, in _update
        File "bidict/_base.py", line 347, in _dedup
      bidict.ValueDuplicationError: 5
      [PYI-166:ERROR] Failed to execute script 'test16' due to unhandled exception!
  * k3 duplicates one key AND v3 duplicates a DIFFERENT key's value ->
    bidict.KeyAndValueDuplicationError: ('a', 6)   with _dedup line 333 (not 347), RC=1.
  * stdout is BLOCK-BUFFERED when piped: on the error path the traceback (stderr, unbuffered)
    appears BEFORE the buffered stdout line in a combined 2>&1 capture.
  * argparse: --v1=5 equals-form works; negative ints as separate tokens work (--v1 -5);
    int(' +1_0 ') == 10 (whitespace stripped, +/- sign, underscores between digits).
  * missing required args -> RC=2, stdout empty, stderr:
      usage: test16_executable [-h] --k1 K1 --v1 V1 --k2 K2 --v2 V2 --k3 K3 --v3 V3
      test16_executable: error: the following arguments are required: --k2, --v2, --k3, --v3
  * --help -> RC=0, stdout:
      usage: test16_executable [-h] --k1 K1 --v1 V1 --k2 K2 --v2 V2 --k3 K3 --v3 V3
      <blank>
      options:
        -h, --help  show this help message and exit
        --k1 K1
        --v1 V1
        --k2 K2
        --v2 V2
        --k3 K3
        --v3 V3
  * bad int -> RC=2, stderr: usage line then
      test16_executable: error: argument --v1: invalid int value: 'xx'
`

const FINDINGS_SCHEMA = {
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
        required: ['rule', 'evidence'],
        properties: {
          rule: { type: 'string', description: 'A precise, implementable behavioral rule.' },
          evidence: { type: 'string', description: 'Exact command run + exact observed stdout/stderr/RC.' },
          jsNote: { type: 'string', description: 'How to reproduce this in Node.js without external deps.' },
        },
      },
    },
  },
}

const PROBES = [
  {
    key: 'argparse-surface',
    prompt: `Black-box probe the COMMAND-LINE ARGUMENT PARSING surface of ${EXE} so it can be reimplemented in pure Node.js.
Run MANY invocations and record exact stdout, exact stderr, and exact return code for each.
Cover at minimum:
  - "--k1 v" space form, "--k1=v" equals form, mixed forms in one call
  - option prefix ABBREVIATION: does "--k" work? "--k1" vs "--v"? Is an ambiguous abbreviation an error, and what is the exact message? Try "--h" for help.
  - repeating an option ("--k1 a --k1 b"): which wins?
  - unrecognized option ("--zzz 1"), positional extra args ("foo"), and the exact "unrecognized arguments" message
  - the "--" end-of-options separator, and values that begin with "-" or "--" (e.g. --k1 -abc, --k1=-abc, --k1 -- -abc)
  - empty string values: --k1 "" and --k1= ; what does the resulting repr look like?
  - an option with a MISSING value at end of argv ("--k1") and in the middle
  - ordering of the "the following arguments are required:" list when several are missing
  - "-h"/"--help" combined with other args, and --help when required args are missing (does help still win? RC?)
  - is the usage line ever wrapped across lines? Does prog name come from argv[0] basename?
  - what happens with "--k1 a --v1 5 --k2 b --v2 6 --k3 c --v3 9 extra1 extra2"
Report every rule with exact byte-level evidence (use 'cat -A' when whitespace matters).`,
  },
  {
    key: 'int-conversion',
    prompt: `Black-box probe how ${EXE} converts the --v1/--v2/--v3 arguments (Python type=int) so it can be reimplemented in Node.js.
Determine the EXACT accept/reject set and the exact error text/RC for rejects. Cover:
  - plain digits, leading zeros ("007"), leading "+" ("+5"), "-5", "  5  " (surrounding whitespace incl. tabs/newlines)
  - underscores: "1_0", "_10", "10_", "1__0", "-1_0", "+1_0"
  - non-decimal: "0x10", "0b11", "0o7", "1e3", "5.0", "5.", ".5", "inf", "nan"
  - empty string, "-", "+", " ", unicode digits (e.g. Arabic-Indic "\\u0665", superscript "\\u00b2"), full-width digits "\\uff15"
  - unicode whitespace around digits (e.g. NBSP U+00A0, U+2009)
  - VERY LARGE integers far beyond 2^53, e.g. 99999999999999999999999999 and -99999999999999999999999999:
    does it print them in full? (this decides whether the JS port must use BigInt) TEST THIS CAREFULLY,
    including a huge value for v1 and confirming the repr in all printed lines.
  - the exact error message format for a rejected value, for each of --v1/--v2/--v3, and how the rejected
    value is quoted in the message (is it Python repr? what about a value containing a single quote, e.g. --v1 "a'b")
Report every rule with exact evidence.`,
  },
  {
    key: 'string-repr',
    prompt: `Black-box probe how ${EXE} RENDERS STRING KEYS inside the printed bidict repr, so Python's repr() can be reimplemented in Node.js.
The keys come from --k1/--k2/--k3. Feed exotic strings and record the exact printed bytes (use 'cat -A' or hexdump -C).
Cover:
  - plain ascii, a string containing a single quote (it's), a double quote, BOTH quote kinds, a backslash
  - control chars: newline, tab, carriage return, \\x00, \\x1b, \\x7f  (pass via bash $'...' quoting)
  - non-ascii printable: accented latin (é), CJK (\\u4e2d\\u6587), emoji (\\U0001F600), combining marks
  - non-printable/format unicode: U+00AD soft hyphen, U+200B zero width space, U+2028 line separator, U+00A0 NBSP, U+FEFF
  - a very long string; a string that is just spaces; the empty string
  - does the key 'new' colliding with the hardcoded b['new']=100 change anything? (test --k3 new, and --k1 new)
Goal: derive the exact rule set for Python 3 repr() of str (quote selection, which chars are escaped and how:
\\\\n \\\\t \\\\r \\\\\\\\ \\\\xNN \\\\uNNNN \\\\UNNNNNNNN, and which non-ascii chars are printed literally).
Also probe whether the key affects sys.stdout encoding/errors (any UnicodeEncodeError?).
Report every rule with exact evidence and note the Unicode general categories involved.`,
  },
  {
    key: 'bidict-semantics',
    prompt: `Black-box probe the bidict CONTAINER SEMANTICS exercised by ${EXE} so they can be reimplemented in Node.js.
The program does: b = bidict({k1: v1, k2: v2}); print(b); b[k3] = v3; print(b); b.clear(); print(b); b['new'] = 100; print(b).
Systematically enumerate the outcome for every relationship class between (k1,v1),(k2,v2),(k3,v3):
  1. all keys distinct, all values distinct
  2. k1 == k2 (with v1 == v2, and with v1 != v2)
  3. v1 == v2 with k1 != k2
  4. k3 == k1 (v3 new / v3 == v1 / v3 == v2)
  5. k3 == k2 (v3 new / v3 == v2 / v3 == v1)
  6. k3 new, v3 == v1 ; k3 new, v3 == v2 ; k3 new, v3 new
  7. k3 == 'new' and/or v3 == 100  (does the later b['new']=100 interact? remember clear() happens first)
  8. all three keys equal; all three values equal
For each: record exact stdout, exact stderr, exact RC. Pay attention to INSERTION ORDER in the repr
(which position a replaced key occupies) and to which exception type/message/traceback-line-number appears
(_dedup line 333 vs 347; KeyDuplicationError vs ValueDuplicationError vs KeyAndValueDuplicationError).
Also verify: is stdout content BEFORE an exception still emitted (and RC)? Confirm buffering order under a pipe
vs. under a tty if you can. Report a decision table precise enough to implement directly.`,
  },
  {
    key: 'io-and-exit',
    prompt: `Black-box probe the PROCESS-LEVEL I/O behavior of ${EXE} so a Node.js port can match it byte-for-byte.
Determine:
  - Does stdout end with a trailing newline after the 4th line? (hexdump -C the tail)
  - Exact byte count/content of a full happy-path stdout run: verify with 'od -c' or 'xxd'.
  - Line endings: LF only?
  - Buffering: with stdout redirected to a FILE and to a PIPE, on the error path, does the stdout
    content still get written (flushed at exit)? Show the file contents.
  - Return codes: happy path, ValueDuplicationError path, argparse-missing-arg path, argparse-bad-int path, --help path.
  - Which stream gets the usage/error text for argparse errors (stdout vs stderr)? Which gets --help?
  - Is anything written to stdout when the program raises? Is stderr ever written on the happy path?
  - Does the '[PYI-NNN:ERROR] Failed to execute script' line's NNN change every run? Run the same failing
    command 5 times and report the NNN values. Conclude whether stderr can be byte-exactly reproduced.
Report exact evidence (hexdumps where relevant).`,
  },
]

phase('Probe')
const probeResults = await parallel(PROBES.map((p) => () =>
  agent(`${KNOWN}\n\nYOUR PROBE ASSIGNMENT (dimension "${p.key}"):\n${p.prompt}\n\nRules: use the Bash tool to run the executable many times. Never run 'python'. Do not write any files into /output. You may write scratch files under /workspace/scratch/. Return findings via the structured schema.`,
    { label: `probe:${p.key}`, phase: 'Probe', schema: FINDINGS_SCHEMA })
))
const probes = probeResults.filter(Boolean)
log(`probes complete: ${probes.map((p) => `${p.dimension}(${p.findings.length})`).join(', ')}`)

phase('Spec')
const SPEC_PATH = '/workspace/scratch/SPEC.md'
const specAgent = await agent(
  `${KNOWN}

Five parallel black-box probes of ${EXE} produced these findings (JSON):

${JSON.stringify(probes, null, 1)}

TASK: Synthesize ONE authoritative, implementable behavioral specification and WRITE it to ${SPEC_PATH}.
Resolve any contradictions between probes by RE-RUNNING the executable yourself to settle them
(report which contradictions you settled and how). The spec must contain:
  1. Exact CLI grammar: option table, required-ness, equals/space forms, abbreviation rules, repeat semantics,
     unrecognized-arg handling, "--" handling, missing-value handling, help/usage text templates (verbatim),
     error message templates (verbatim, with placeholders), exit codes, and which stream each goes to.
  2. Exact Python int() conversion algorithm (accept/reject grammar), including whether BigInt is required.
  3. Exact Python repr() algorithm for str (quote choice + escape table + printability rule by Unicode category)
     and for int, and for the tuple form used by KeyAndValueDuplicationError.
  4. Exact bidict semantics decision table for this program's operation sequence, including insertion-order rules
     and which exception + traceback text each failure produces (verbatim traceback templates).
  5. Exact stdout byte layout and buffering/flush-order requirements, and the one irreproducible element
     (the PYI PID) called out explicitly.
Be exhaustive and unambiguous - an implementer will work ONLY from this file.
Return a short summary (< 25 lines) of the spec's key decisions, especially: is BigInt required? what prog name
should the JS port use for usage/error lines, and why?`,
  { label: 'synthesize-spec', phase: 'Spec' })
log('spec written; ' + specAgent.slice(0, 400))

phase('Implement')
const IMPL_RULES = `
HARD CONSTRAINTS (violating any one invalidates the deliverable):
  * Pure JavaScript for Node.js. ES MODULES ONLY: 'import'/'export'. NEVER 'require()' or 'module.exports'.
  * Every generated file MUST use the .mjs extension. Every relative import MUST include the full '.mjs' suffix.
  * ZERO external/npm dependencies. Only local relative imports and, if truly needed, node: builtins
    (node:process, node:path, node:url). Do NOT import any bare package name.
  * NO embedded Python. No child_process. No shelling out.
  * The JS built-in \`Map\` (and WeakMap) is STRICTLY FORBIDDEN: do not call it, construct it, reference it,
    or even write that identifier anywhere in the code or comments. Also avoid Set/WeakSet for safety.
    Implement all key->value and value->key storage with null-prototype plain objects
    (Object.create(null)) plus explicit arrays for insertion order. Avoid the word in filenames too.
    (Array.prototype.map / .flatMap ARE fine - the ban is on the collection type, not array iteration.)
  * All deliverables go in /output. Nothing outside /output for the deliverable.
  * HIERARCHICAL organization: split the library into multiple focused modules by functionality, each
    exporting a clean interface. The entry file MUST be exactly /output/test16.mjs.
`

const FILE_PLAN = `
REQUIRED file layout (create exactly this; add more modules if justified, never fewer):

/output/test16.mjs                       -- entry point: mirrors test16.py line-for-line
/output/lib/python/repr.mjs              -- Python repr() for str / int / tuple
/output/lib/python/intparse.mjs          -- Python int(str) conversion semantics (+ InvalidIntError)
/output/lib/python/orderedmapping.mjs    -- insertion-ordered key->value store (null-proto object + key array, NO forbidden collection type)
/output/lib/python/stdio.mjs             -- block-buffered stdout writer + unbuffered stderr, flush-at-exit to match Python pipe buffering
/output/lib/python/exceptions.mjs        -- base PyError + traceback rendering + unhandled-exception exit protocol
/output/lib/argparse/errors.mjs          -- ArgumentError / ArgumentTypeError / SystemExit
/output/lib/argparse/formatter.mjs       -- usage line + help text formatting (verbatim templates)
/output/lib/argparse/parser.mjs          -- ArgumentParser: add_argument / parse_args
/output/lib/argparse/index.mjs           -- public argparse facade
/output/lib/bidict/errors.mjs            -- DuplicationError, KeyDuplicationError, ValueDuplicationError, KeyAndValueDuplicationError
/output/lib/bidict/ondup.mjs             -- OnDup policy constants (RAISE / DROP_OLD / DROP_NEW) + ON_DUP defaults
/output/lib/bidict/base.mjs             -- BidictBase: forward+inverse storage, _dedup, _write, _update, repr
/output/lib/bidict/bidict.mjs            -- mutable bidict: set/put/clear/inverse/len/iteration
/output/lib/bidict/index.mjs             -- public bidict facade (export { bidict })
`

const implSummary = await agent(
  `You are implementing a faithful Node.js (ESM) port of the Python program described in ${SPEC_PATH}.

FIRST: read ${SPEC_PATH} in full. Also read /workspace/dataset/bidict/test16.py.
${KNOWN}
${IMPL_RULES}
${FILE_PLAN}

IMPLEMENTATION REQUIREMENTS:
  * /output/test16.mjs must read like a direct transliteration of test16.py: build the argument parser,
    parse argv, construct the bidict from a dict literal (remember: a duplicate literal key collapses,
    later value wins, and the dict literal is evaluated BEFORE bidict() is called), print, setitem, print,
    clear, print, set 'new'->100, print.
  * Exit codes must match: 0 happy path & --help, 2 argparse errors, 1 unhandled bidict exception.
  * On an unhandled bidict exception, render the verbatim traceback to stderr (line numbers and caret lines
    exactly as in the spec) using the PYI trailer with the real process id, then exit 1 - AFTER ensuring any
    already-printed stdout is flushed in the same relative order Python produces under a pipe
    (stderr first, buffered stdout at exit).
  * Integer values: honour the spec's decision about arbitrarily large integers. If BigInt is required,
    use BigInt consistently and make sure repr() prints it with no 'n' suffix.
  * Python repr() for str keys: implement the full quote-selection + escape + printability rules from the spec
    (use Unicode property escapes in RegExp with the 'u' flag; iterate by code point, not UTF-16 unit).
  * Insertion order must be preserved exactly, including that overwriting an existing key keeps its position.
  * Every module needs a brief header comment saying what it models. Match a clean, consistent style.
  * Do NOT create a package.json (the .mjs suffix already selects ESM). Do not create README/test files
    in /output beyond what the layout lists.

AFTER writing every file, self-verify with the Bash tool:
  1. \`node --check\` every .mjs file.
  2. Run the four sample cases and diff against the executable, e.g.
     diff <(node /output/test16.mjs --k1 z --v1 78 --k2 k --v2 1 --k3 s --v3 44) <(${EXE} --k1 z --v1 78 --k2 k --v2 1 --k3 s --v3 44)
     Sample cases: (z,78,k,1,s,44) (y,91,e,42,d,27) (f,47,m,16,d,51) (v,11,p,12,u,21)
  3. Run a handful of error cases and confirm RCs (1 and 2) and stdout match.
  4. \`grep -rnE '\\brequire\\(|module\\.exports|\\bMap\\b|\\bWeakMap\\b|\\bSet\\b' /output\` must return NOTHING.
  5. \`grep -rn "^import\\|from '" /output\` - confirm no bare-package imports and every relative import ends in .mjs.
Iterate until all checks pass. Return a concise report: files written (with one-line purpose each),
the checks you ran, and anything still failing.`,
  { label: 'implement', phase: 'Implement' })
log('implementation done')

const MISMATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['casesRun', 'mismatches'],
  properties: {
    casesRun: { type: 'integer' },
    strategy: { type: 'string' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['args', 'expected', 'actual', 'stream'],
        properties: {
          args: { type: 'string', description: 'exact argv after the program name' },
          stream: { type: 'string', description: 'stdout | stderr | returncode' },
          expected: { type: 'string', description: 'executable output (verbatim)' },
          actual: { type: 'string', description: 'node output (verbatim)' },
          diagnosis: { type: 'string' },
        },
      },
    },
  },
}

const VERIFIERS = [
  { key: 'random-happy', prompt: `Write and run a differential fuzz harness (bash or a NODE script under /workspace/scratch/, never in /output) that generates at least 400 RANDOM VALID invocations - random single/multi-char ascii keys and random ints in a wide range including negatives, zero, and values near/beyond 2^53 - runs both ${EXE} and \`node /output/test16.mjs\` with identical argv, and compares stdout, stderr, and return code byte-for-byte. Deliberately include cases where keys collide, values collide, and where a key or value equals 'new'/100. Report every distinct mismatch class.` },
  { key: 'argparse-edge', prompt: `Differentially test ARGUMENT PARSING between ${EXE} and \`node /output/test16.mjs\`: equals vs space forms, option abbreviations (including ambiguous ones), repeated options, missing required options (all subsets you can reasonably cover), unrecognized options, extra positionals, "--" separator, values starting with '-', empty-string values, missing option values, -h/--help alone and mixed with other args, and invalid int values (including values containing quotes/backslashes/unicode). Compare stdout, stderr and RC byte-for-byte; note that the program NAME inside usage/error lines legitimately differs (executable says test16_executable) - normalize ONLY that token, and report the mismatch classes that remain.` },
  { key: 'unicode-repr', prompt: `Differentially test STRING KEY RENDERING between ${EXE} and \`node /output/test16.mjs\`. Feed keys containing: single quotes, double quotes, both, backslashes, control characters (\\x00 \\x07 \\t \\n \\r \\x1b \\x7f), latin accents, CJK, emoji (astral plane), combining marks, U+00A0, U+00AD, U+200B, U+2028, U+2029, U+FEFF, unassigned code points, lone-ish surrogate byte sequences, spaces-only, and the empty string. Use bash $'...' quoting or a node script that spawns both with identical argv byte arrays. Compare stdout byte-for-byte (hexdump if needed) plus RC. At least 60 cases. Report every mismatch.` },
  { key: 'int-edge', prompt: `Differentially test INTEGER CONVERSION between ${EXE} and \`node /output/test16.mjs\`: leading zeros, +/- signs, surrounding ascii and unicode whitespace, underscores in every legal and illegal position, hex/binary/octal/float/exponent/inf/nan strings, empty and sign-only strings, unicode digits (Arabic-Indic, Devanagari, full-width, superscript), and very large magnitudes (30+ digits, positive and negative) checked through ALL FOUR printed lines. Compare stdout, stderr and RC byte-for-byte (normalize only the program-name token and the PYI PID). At least 80 cases. Report every mismatch.` },
  { key: 'error-paths', prompt: `Differentially test the EXCEPTION paths between ${EXE} and \`node /output/test16.mjs\`: every relationship class among (k1,v1),(k2,v2),(k3,v3) that can raise - v1==v2 with distinct keys; k3 new with v3 equal to v1 or v2; k3 equal to an existing key with v3 equal to the OTHER key's value (KeyAndValueDuplicationError); all keys equal; all values equal; plus the non-raising near-misses (k3==k1 with v3==v1, k3==k1 with a fresh v3). For each, verify: return code, stdout content byte-for-byte, and stderr traceback byte-for-byte after normalizing ONLY the \`[PYI-<digits>:ERROR]\` number and the script/prog name token. Also verify buffering: with stdout redirected to a file and stderr to another file, both programs must produce the same file contents. At least 30 cases. Report every mismatch.` },
]

phase('Verify')
let roundsRun = 0
let allMismatches = []
let dry = 0
let round = 0
while (dry < 1 && round < 3) {
  round++
  const verdicts = (await parallel(VERIFIERS.map((v) => () =>
    agent(`${KNOWN}\n\nThe Node.js port lives at /output/test16.mjs (library under /output/lib/). Reference implementation: ${EXE}.\n\nYOUR DIFFERENTIAL-TEST ASSIGNMENT (round ${round}, dimension "${v.key}"):\n${v.prompt}\n\nRules: scratch files go under /workspace/scratch/ ONLY - never create or modify anything in /output. Never run 'python'. Be rigorous: a case only passes if bytes match after the explicitly-allowed normalizations. Return results via the schema; mismatches must quote verbatim output.`,
      { label: `verify:${v.key}#${round}`, phase: 'Verify', schema: MISMATCH_SCHEMA })
  ))).filter(Boolean)
  roundsRun++
  const fresh = verdicts.flatMap((v) => (v.mismatches || []).map((m) => ({ ...m, dimension: v.dimension || 'x' })))
  const cases = verdicts.reduce((n, v) => n + (v.casesRun || 0), 0)
  log(`verify round ${round}: ${cases} cases, ${fresh.length} mismatches`)
  if (!fresh.length) { dry++; break }
  allMismatches.push(...fresh)

  phase('Fix')
  await agent(
    `The Node.js ESM port in /output must match ${EXE} byte-for-byte. Differential testing found these mismatches (JSON):

${JSON.stringify(fresh, null, 1)}

TASK: fix /output so every one of these disappears, WITHOUT breaking the four sample happy-path cases.
Read ${SPEC_PATH} for the authoritative behavior. Re-confirm any ambiguous mismatch by running the
executable yourself before changing code. Ignore any "mismatch" that is solely the legitimately-different
program-name token or the PYI process-id number - but say so explicitly if you skip one.
${IMPL_RULES}
After fixing, re-run each reported case plus the four sample cases and confirm byte-equality and matching
return codes. Also re-run: \`node --check\` on every .mjs, and
\`grep -rnE '\\brequire\\(|module\\.exports|\\bMap\\b|\\bWeakMap\\b|\\bSet\\b' /output\` (must be empty).
Return a concise list of what you changed and the verification output.`,
    { label: `fix#${round}`, phase: 'Fix' })
}

phase('Audit')
const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'issues'],
  properties: {
    verdict: { type: 'string', description: 'PASS or FAIL' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'problem', 'fix'],
        properties: {
          severity: { type: 'string' },
          file: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const AUDITS = [
  { key: 'constraints', prompt: `Audit /output for HARD CONSTRAINT violations. Check every file: (a) .mjs suffix only, no package.json needed/present, (b) 'import'/'export' only - zero occurrences of require( or module.exports, (c) every relative import path ends in an explicit .mjs suffix and resolves to a real file, (d) NO bare-package imports - only relative paths and node: builtins, (e) the forbidden JS collection type for dual key/value storage: the identifier that starts with M-a-p (and WeakMap, Set, WeakSet) must appear NOWHERE in /output, including comments, strings and filenames - grep case-sensitively AND check for it hidden in prose; (f) no child_process / no embedded python / no eval of python, (g) node --check passes on every file, (h) the entry point is exactly /output/test16.mjs and it runs. Also confirm the library is genuinely HIERARCHICAL (multiple functional modules with exported interfaces, not one dumped file) and that every module is actually imported/reachable from the entry point (report dead files). Report each violation with the file and a concrete fix.` },
  { key: 'fidelity', prompt: `Audit /output/test16.mjs and its library for BEHAVIORAL FIDELITY to /workspace/dataset/bidict/test16.py, using ${EXE} as ground truth. Independently construct at least 50 adversarial inputs of your own choosing (do not trust prior test lists) and verify stdout/stderr/RC byte-equality, normalizing only the prog-name token and the PYI pid. Specifically try to BREAK the port: values near Number.MAX_SAFE_INTEGER, "-0", "+0", keys that are numeric strings ("5"), keys equal to JS object-prototype names ("__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"), keys/values chosen to collide across the forward and inverse stores, keys that are the string "new", values that are 100, and any input where a JS object used as a store could confuse a key with a prototype property. Report every real divergence with the exact reproducing command.` },
  { key: 'quality', prompt: `Review the code in /output for engineering quality as a senior reviewer: is the module decomposition sensible and non-overlapping; are the exported interfaces clean; is the Python-emulation logic (repr, int parsing, ordered mapping, dedup policy) correct in edge cases a test might miss (read the code, reason about it - e.g. code-point iteration vs UTF-16, null-prototype object usage, integer/BigInt mixing, insertion-order bookkeeping on delete/overwrite, inverse-store consistency after clear); is there dead or duplicated code; do comments match behavior. Report concrete, actionable issues only - no style nitpicks. Verify any suspected bug by running ${EXE} and the port before reporting it.` },
]

const audits = (await parallel(AUDITS.map((a) => () =>
  agent(`${KNOWN}\n\nYOUR AUDIT ASSIGNMENT (dimension "${a.key}"):\n${a.prompt}\n\nRules: you may READ anything and run commands, and you may write scratch files under /workspace/scratch/, but do NOT modify /output. Never run 'python'. Verify before reporting: a claim you could not reproduce must not be reported. Return via the schema.`,
    { label: `audit:${a.key}`, phase: 'Audit', schema: AUDIT_SCHEMA })
))).filter(Boolean)

const auditIssues = audits.flatMap((a) => (a.issues || []).map((i) => ({ ...i, dimension: a.verdict })))
log(`audit: ${auditIssues.length} issues raised`)

if (auditIssues.length) {
  phase('Fix')
  await agent(
    `Three independent auditors reviewed the Node.js ESM port in /output and raised these issues (JSON):

${JSON.stringify(auditIssues, null, 1)}

TASK: For EACH issue, first verify it is real (reproduce it, or read the code carefully). Fix the real ones.
Explicitly state which you dismissed and why. Do not regress anything.
${IMPL_RULES}
Finally re-run the full acceptance check and paste the output:
  * the four sample cases diffed against ${EXE}
  * the ValueDuplicationError / KeyAndValueDuplicationError / missing-arg / bad-int / --help paths with return codes
  * node --check on every .mjs file
  * grep -rnE '\\brequire\\(|module\\.exports|\\bMap\\b|\\bWeakMap\\b|\\bSet\\b' /output   (must be empty)
  * find /output -type f | sort
Return the final file list, the acceptance output, and a one-line status.`,
    { label: 'final-fix', phase: 'Fix' })
}

phase('Audit')
const final = await agent(
  `FINAL ACCEPTANCE GATE for the Node.js ESM port in /output (reference: ${EXE}).
Do not modify any file. Independently run and report:
  1. \`find /output -type f | sort\` and the byte size of each file.
  2. The four sample cases, diffed against the executable (show the diff commands and that they are empty):
     (z,78,k,1,s,44) (y,91,e,42,d,27) (f,47,m,16,d,51) (v,11,p,12,u,21)
  3. 25 fresh randomized valid cases diffed against the executable (stdout + RC).
  4. Error paths: v1==v2 dup; k3-new-with-dup-value; KeyAndValueDuplication; missing args; bad int; --help.
     Report RC and stdout equality for each (stderr modulo prog-name and PYI pid).
  5. \`node --check\` on every .mjs file.
  6. \`grep -rnE '\\brequire\\(|module\\.exports|\\bMap\\b|\\bWeakMap\\b|\\bSet\\b' /output\` output (expect empty).
  7. Every import statement in /output, confirming .mjs suffixes and no bare packages.
Return a compact PASS/FAIL table plus, for each file in /output, a one-line description of its role.
If anything FAILS, say exactly what and how to fix it - do not fix it yourself.`,
  { label: 'acceptance', phase: 'Audit' })

return {
  probeDimensions: probes.map((p) => p.dimension),
  verifyRounds: roundsRun,
  mismatchesFound: allMismatches.length,
  auditIssues: auditIssues.length,
  acceptance: final,
}
