export const meta = {
  name: 'py2node-construct-test3',
  description: 'Port test3.py (construct Struct/Int8ul + argparse) to zero-dependency ESM Node, verified differentially against the Python executable',
  phases: [
    { title: 'Implement', detail: '3 independent candidate bundles from the same black-box spec' },
    { title: 'Difftest', detail: 'each candidate differentially fuzzed against test3_executable' },
    { title: 'Judge', detail: 'score candidates on fidelity + spec compliance + structure' },
    { title: 'Finalize', detail: 'write winning synthesis to /output, re-verify' },
    { title: 'Critique', detail: 'adversarial spec-compliance and completeness critics' },
    { title: 'Repair', detail: 'fix confirmed defects and re-verify' },
  ],
}

const EXE = '/workspace/dataset/test3_executable'

const SPEC = `
# SOURCE (Python, /workspace/dataset/test3.py)
\`\`\`python
#!/usr/bin/env python3
import argparse
import construct

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=int, required=True)
    parser.add_argument('--b', type=int, required=True)
    args = parser.parse_args()

    struct_format = construct.Struct(
        "field1" / construct.Int8ul,  # define first field
        "field2" / construct.Int8ul   # define second field
    )
    data = struct_format.build({"field1": args.a, "field2": args.b})
    print(data)

if __name__ == "__main__":
    main()
\`\`\`

# BLACK-BOX GROUND TRUTH (already measured against ${EXE} — do NOT re-derive, but you MAY re-verify)

## A. Success path
stdout = Python repr of the 2-byte string, then a newline. exit code 0.
  --a 16  --b 161 -> b'\\x10\\xa1'
  --a 194 --b 138 -> b'\\xc2\\x8a'
  --a 232 --b 186 -> b'\\xe8\\xba'
  --a 33  --b 108 -> b'!l'
  --a 0   --b 255 -> b'\\x00\\xff'
  --a 255 --b 0   -> b'\\xff\\x00'

## B. Python bytes repr rules (MEASURED, must match exactly)
- Bytes 0x20..0x7e print as the literal ASCII char, EXCEPT backslash and the active quote char.
- 0x09 -> \\t , 0x0a -> \\n , 0x0d -> \\r
- Every other byte (0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f, 0x7f-0xff) -> \\xNN with LOWERCASE hex, always 2 digits.
- 0x5c (backslash) -> two backslash chars.
- QUOTE SELECTION: default single quotes. If the byte string contains 0x27 (') and does NOT contain 0x22 (") -> use double quotes and do not escape the '. If it contains BOTH ' and " -> use single quotes and escape the ' as \\' (the " stays literal).
  MEASURED: --a 39 --b 65 -> b"'A"        (39 = apostrophe, only ' present -> double quotes)
  MEASURED: --a 34 --b 65 -> b'"A'        (34 = quote, only " present -> single quotes, literal ")
  MEASURED: --a 39 --b 34 -> b'\\'"'       (both present -> single quotes, ' escaped, " literal)
  MEASURED: --a 92 --b 92 -> b'\\\\\\\\'      (two backslash bytes -> four backslash chars)
  MEASURED: --a 9 --b 65 -> b'\\tA' ; --a 10 --b 65 -> b'\\nA' ; --a 13 --b 65 -> b'\\rA'
  MEASURED: --a 7 -> \\x07 ; 8 -> \\x08 ; 11 -> \\x0b ; 12 -> \\x0c ; 27 -> \\x1b ; 32 -> literal space ; 126 -> ~ ; 127 -> \\x7f ; 128 -> \\x80

## C. argparse behaviour (exit code 2, message on STDERR)
usage line (STDERR for errors, STDOUT for -h):
  usage: <prog> [-h] --a A --b B
Errors (each preceded by the usage line, then "<prog>: error: ..."):
  no args           -> error: the following arguments are required: --a, --b
  only --a 16       -> error: the following arguments are required: --b
  only --b 16       -> error: the following arguments are required: --a
  --a abc --b 1     -> error: argument --a: invalid int value: 'abc'
  --a 1.5 --b 1     -> error: argument --a: invalid int value: '1.5'
  --a 0x10 --b 1    -> error: argument --a: invalid int value: '0x10'
  --a 1e5 --b 1     -> error: argument --a: invalid int value: '1e5'
  --a 0b101 --b 1   -> error: argument --a: invalid int value: '0b101'
  --a "" --b 1      -> error: argument --a: invalid int value: ''
  --a "-" --b 1     -> error: argument --a: invalid int value: '-'
  --a "1_" --b 1    -> error: argument --a: invalid int value: '1_'
  --a "_1" --b 1    -> error: argument --a: invalid int value: '_1'
  --a "1__2" --b 1  -> error: argument --a: invalid int value: '1__2'
  --a "4 2" --b 1   -> error: argument --a: invalid int value: '4 2'
  --a "- 5" --b 1   -> error: argument --a: invalid int value: '- 5'
  --a 1 --b 2 --c 3 -> error: unrecognized arguments: --c 3
  --a 1 --b 2 extra -> error: unrecognized arguments: extra
  --a               -> error: argument --a: expected one argument
  --a --b --b 1     -> error: argument --a: expected one argument   (a value that looks like an option is NOT consumed)
  -- --a 1 --b 1    -> error: the following arguments are required: --a, --b
                       (everything after a bare "--" becomes positional; the required-args check fires BEFORE
                        the unrecognized-arguments check, so this reports missing required args, NOT unrecognized)
Accepted forms:
  --a=16 --b=161    -> b'\\x10\\xa1'   (= form works)
  --a 1 --b 1 --a 5 -> b'\\x05\\x01'   (last occurrence wins)
  --a -5 --b 1      -> reaches construct with value -5 (a negative-number-looking token IS accepted as a value,
                       because the parser has no options that look like negative numbers)
-h / --help -> prints the following to STDOUT and exits 0 (measured; note the "options:" heading, 2-space indent,
               and that "-h, --help" is followed by two spaces before "show"):
usage: <prog> [-h] --a A --b B

options:
  -h, --help  show this help message and exit
  --a A
  --b B

  -h anywhere (e.g. "--a 1 --b 2 -h") triggers help immediately and exits 0.

## D. Python int() string conversion semantics for type=int (MEASURED)
Accepted: surrounding ASCII/Unicode whitespace is stripped ("  16  " -> 16, "\\t42\\n" -> 42);
leading "+"/"-" sign; single underscores BETWEEN digits ("1_6" -> 16); leading zeros ("016" -> 16);
arbitrary precision (no overflow at parse time); Unicode decimal digits are accepted and mapped by
their numeric value -- MEASURED: fullwidth "１２" -> 12 (output b'\\x0c\\x01'), Arabic-Indic "٣" -> 3 (output b'\\x03\\x01').
Rejected: "0x10", "0b101", "1e5", "1.5", "abc", "", "-", "1_", "_1", "1__2", internal spaces, sign separated by a space.
Because values are arbitrary precision, the integer MUST be carried as a BigInt (never a lossy double),
so the out-of-range error message can echo the exact original magnitude.

## E. Out-of-range path (construct raises) -> exit code 1, all output on STDERR, stdout EMPTY
Exact stderr (MEASURED for --a 256 --b 0; only the PYI number varies -- it is the process id):
Traceback (most recent call last):
  File "construct/core.py", line 1165, in _build
struct.error: 'B' format requires 0 <= number <= 255

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "test3.py", line 19, in <module>
  File "test3.py", line 15, in main
  File "construct/core.py", line 452, in build
  File "construct/core.py", line 464, in build_stream
  File "construct/core.py", line 2260, in _build
  File "construct/core.py", line 2774, in _build
  File "construct/core.py", line 1167, in _build
construct.core.FormatFieldError: Error in path (building) -> field1
struct '<B' error during building, given value 256
[PYI-147:ERROR] Failed to execute script 'test3' due to unhandled exception!

- The blank line after "struct.error: ..." and around the "During handling" line are real (verified with cat -A).
- The failing field name in "Error in path (building) -> fieldN" is whichever field failed FIRST:
  --a 256 --b 0 -> field1 ; --a 1 --b 256 -> field2 . Fields are built in declaration order and it
  aborts on the first failure.
- MEASURED --a -1 --b 0 -> "given value -1"; --a -5 -> "given value -5"; --a 300 --b 400 -> field1, "given value 300";
  --a 99999999999999999999 --b 1 -> field1, "given value 99999999999999999999" (exact, hence BigInt).
- The final [PYI-<pid>:ERROR] line should be emitted with the live process id (exact digits cannot be matched).

# HARD REQUIREMENTS (violating any of these invalidates the work)
1. Pure JavaScript for Node.js (target: Node 18). ESM ONLY: 'import'/'export'. 'require()' and 'module.exports' are
   STRICTLY PROHIBITED anywhere, including in comments/strings.
2. Every generated file MUST use the .mjs suffix, and every relative import MUST include the full './x.mjs' suffix.
3. ZERO external dependencies. No npm packages. import ONLY local relative files. Node built-ins are allowed but you
   almost certainly need none -- if you use one it must be the 'node:' prefixed form. Do NOT shell out to python.
4. FORBIDDEN APIs: you must NOT use or even mention 'DataView' or 'ArrayBuffer' anywhere in the code or comments.
   Do not use typed arrays either (Uint8Array is backed by the forbidden concept) -- represent the built byte
   sequence as a PLAIN JavaScript Array of integers 0..255, and format the repr directly from that array.
   Do not use Buffer either. No binary-view APIs at all.
5. Hierarchical structure: split the library into multiple single-responsibility .mjs modules that expose their
   interfaces via 'export'. The entry file must be thin and read like the Python main().
6. Argument parsing must be done by hand from process.argv.
7. Program name for usage/help must be derived the way argparse derives it: the basename of the script path
   (argparse uses basename(sys.argv[0])). In Node that is basename(process.argv[1]) -> "test3.mjs".
   Derive it dynamically; do NOT hardcode "test3_executable".
8. Exit codes must match: 0 success/help, 2 argparse errors, 1 construct build errors.
   stdout vs stderr routing must match exactly (success -> stdout; help -> stdout; argparse errors -> stderr;
   traceback -> stderr with stdout completely empty).
`

const REQUIRED_LAYOUT = `
Target module layout (you may refine names, but keep this level of separation and this file set size ~7-9 files):
  <ROOT>/lib/python/bytes_repr.mjs   -- Python bytes repr formatter (quote selection + escaping) over a plain number array
  <ROOT>/lib/python/int_parse.mjs    -- Python int(str) semantics -> BigInt, or a rejection signal
  <ROOT>/lib/python/errors.mjs       -- Python-style exception classes + traceback rendering / SystemExit semantics
  <ROOT>/lib/cli/argument_parser.mjs -- the hand-rolled argparse clone (usage/help/errors/exit codes)
  <ROOT>/lib/construct/errors.mjs    -- FormatFieldError and friends
  <ROOT>/lib/construct/format_field.mjs -- Int8ul (and the little-endian unsigned byte packing rule)
  <ROOT>/lib/construct/struct.mjs    -- Struct combinator + the "name / subcon" renaming helper
  <ROOT>/lib/construct/index.mjs     -- barrel module re-exporting the construct surface
  <ROOT>/test3.mjs                   -- entry point, mirrors the Python main()
Since JS has no operator overloading for "name" / subcon, expose an explicit, documented equivalent
(e.g. a 'field(name, subcon)' / 'named(name, subcon)' helper, and/or a '.named()' method on subcons) and use it
in the entry file so the mapping back to the Python is obvious.
`

const DIFF_CORPUS = `
The differential suite MUST cover, comparing stdout, stderr-shape, and exit code against ${EXE}:
 (a) all 65536 (a,b) pairs is too many -- instead: every a in 0..255 paired with a fixed b, every b in 0..255
     paired with a fixed a, plus the 4 sample cases, plus the quote/escape criticals
     (39,65) (34,65) (39,34) (92,92) (9,65) (10,65) (13,65) (7,65) (11,65) (12,65) (27,65) (32,65) (126,65) (127,65) (128,65) (0,0) (255,255)
 (b) out-of-range: (256,0) (0,256) (-1,0) (0,-1) (300,400) (99999999999999999999,1) (1,99999999999999999999) (-5,1)
 (c) argparse errors: no args; only --a; only --b; --a abc; --a 1.5; --a 0x10; --a 1e5; --a 0b101; --a ""; --a "-";
     --a "1_"; --a "_1"; --a "1__2"; --a "4 2"; --a "- 5"; --a "+ 5"; --a 1 --b 2 --c 3; --a 1 --b 2 extra;
     --a (no value); --a --b --b 1; -- --a 1 --b 1
 (d) accepted forms: --a=16 --b=161 ; --a 016 ; --a "  16  " ; --a +16 ; --a 1_6 ; --a $'\\t42\\n' ; --a "１２" ; --a "٣" ;
     --a -5 ; --a 1 --b 1 --a 5
 (e) --help ; -h ; --a 1 --b 2 -h
 (f) randomized fuzz: >=400 random (a,b) pairs drawn from 0..255, plus >=100 random pairs drawn from a wider
     range including negatives and >255 so the error path is exercised. Derive randomness however you like.
Comparison rules: stdout must match byte-for-byte and exit code must match exactly. For stderr, compare
byte-for-byte AFTER normalizing the [PYI-<digits>:ERROR] number to a placeholder, and after replacing the
program-name token (the executable prints "test3_executable", the port prints "test3.mjs") with a placeholder.
Report the FULL list of mismatches with the exact expected vs actual bytes. Do not summarize away failures.
Do not stop at the first failure.
`

const CAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['root', 'files', 'notes'],
  properties: {
    root: { type: 'string', description: 'absolute directory the bundle was written to' },
    files: { type: 'array', items: { type: 'string' }, description: 'absolute paths of every file written' },
    notes: { type: 'string', description: 'design decisions and any behaviours you were unsure about' },
  },
}

const TEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['total', 'passed', 'failed', 'mismatches', 'harnessPath', 'verdict'],
  properties: {
    total: { type: 'integer' },
    passed: { type: 'integer' },
    failed: { type: 'integer' },
    harnessPath: { type: 'string' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['args', 'dimension', 'expected', 'actual'],
        properties: {
          args: { type: 'string' },
          dimension: { type: 'string', description: 'stdout | stderr | exitCode' },
          expected: { type: 'string' },
          actual: { type: 'string' },
        },
      },
    },
    verdict: { type: 'string', description: 'PASS if zero mismatches, else FAIL' },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ranking', 'winner', 'bestIdeasToGraft', 'reasoning'],
  properties: {
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['root', 'fidelityScore', 'complianceScore', 'structureScore', 'issues'],
        properties: {
          root: { type: 'string' },
          fidelityScore: { type: 'integer' },
          complianceScore: { type: 'integer' },
          structureScore: { type: 'integer' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    winner: { type: 'string' },
    bestIdeasToGraft: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
}

const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'summary', 'evidence', 'fix'],
        properties: {
          severity: { type: 'string', description: 'blocker | major | minor' },
          file: { type: 'string' },
          summary: { type: 'string' },
          evidence: { type: 'string', description: 'a concrete command + observed vs expected, or an exact quoted line' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reason'],
  properties: {
    real: { type: 'boolean' },
    reason: { type: 'string' },
  },
}

// ---------------------------------------------------------------- Phase 1+2
phase('Implement')

const CANDIDATES = [
  { id: 'c1', root: '/tmp/cand_c1', angle: 'Model the construct library faithfully: a Subcon base class with _build/_parse, a Renamed wrapper for the "name / subcon" idiom, and a path-tracking build context so the error path (building) -> fieldN string falls out of the architecture rather than being hardcoded.' },
  { id: 'c2', root: '/tmp/cand_c2', angle: 'Optimize for exact observable fidelity: drive every module from the measured ground-truth tables (repr escaping table, argparse message catalogue, traceback template). Prefer explicit data tables over clever abstraction, and make each table trivially auditable against the spec.' },
  { id: 'c3', root: '/tmp/cand_c3', angle: 'Optimize for a clean layered port: a Python-semantics layer (int(), bytes repr, exceptions/SystemExit) that knows nothing about this program, a construct layer built on it, a CLI layer, and a 10-line entry point. Emphasize that each layer is independently testable and reusable.' },
]

const built = await pipeline(
  CANDIDATES,
  (c) => agent(
    `You are porting a Python program to zero-dependency ESM Node.js. Write a COMPLETE, WORKING bundle.

${SPEC}

${REQUIRED_LAYOUT.replace(/<ROOT>/g, c.root)}

YOUR DESIGN ANGLE (differentiate on this): ${c.angle}

Write every file under ${c.root} (create the directory). The entry point is ${c.root}/test3.mjs.
After writing, SELF-TEST before you return: run at minimum
  node ${c.root}/test3.mjs --a 16 --b 161      (expect stdout exactly: b'\\x10\\xa1' and exit 0)
  node ${c.root}/test3.mjs --a 33 --b 108      (expect b'!l')
  node ${c.root}/test3.mjs --a 39 --b 65       (expect b"'A")
  node ${c.root}/test3.mjs --a 39 --b 34       (expect b'\\'"')
  node ${c.root}/test3.mjs --a 92 --b 92       (expect four backslashes between the quotes)
  node ${c.root}/test3.mjs --a 256 --b 0       (expect the traceback on stderr, empty stdout, exit 1)
  node ${c.root}/test3.mjs --a 1 --b 256       (expect field2 in the error path)
  node ${c.root}/test3.mjs --a 16              (expect the required-args error on stderr, exit 2)
  node ${c.root}/test3.mjs --help              (expect the help text on stdout, exit 0)
  node ${c.root}/test3.mjs --a 1_6 --b 1       (expect b'\\x10\\x01')
and compare each against ${EXE} with the same args. Iterate until they agree. You may run the executable freely.
Also grep your own output for the forbidden tokens (require(, module.exports, DataView, ArrayBuffer, Uint8Array, Buffer)
and for any import that is not a relative './...mjs' path, and fix any hit.
Return the list of files written and your notes.`,
    { label: `impl:${c.id}`, phase: 'Implement', schema: CAND_SCHEMA }
  ),
  (b, c) => b === null ? null : agent(
    `Differentially test a Node.js port of a Python program against the real Python executable.

The port's entry point: ${c.root}/test3.mjs   (run it as: node ${c.root}/test3.mjs <args>)
The reference:          ${EXE}                (run it as: ${EXE} <args>)

${SPEC}

${DIFF_CORPUS}

Write your harness as a Node .mjs script (ESM, zero external deps, it may use node:child_process since it is a
TEST harness and not part of the deliverable) at ${c.root}/_difftest.mjs and run it. Be careful to pass argument
vectors directly (no shell re-quoting) so that empty strings, embedded spaces, tabs/newlines and unicode survive.
Report every mismatch precisely. Be adversarial: you are trying to FIND divergence, not to certify success.
Do not modify any file other than ${c.root}/_difftest.mjs.`,
    { label: `difftest:${c.id}`, phase: 'Difftest', schema: TEST_SCHEMA }
  ).then((t) => ({ cand: c, build: b, test: t }))
)

const usable = built.filter(Boolean).filter((r) => r && r.test)
log(`candidates built+tested: ${usable.length}/${CANDIDATES.length}`)
for (const u of usable) log(`  ${u.cand.id}: ${u.test.verdict} ${u.test.passed}/${u.test.total} (${u.test.failed} failed)`)

// ---------------------------------------------------------------- Phase 3
phase('Judge')

const judgeInput = usable.map((u) => ({
  root: u.cand.root,
  angle: u.cand.angle,
  files: u.build.files,
  notes: u.build.notes,
  test: { total: u.test.total, passed: u.test.passed, failed: u.test.failed, verdict: u.test.verdict, mismatches: u.test.mismatches.slice(0, 25) },
}))

const judgment = await agent(
  `Three independent ports of the same Python program were written and differentially tested against the real
Python executable. Read the actual source files of each candidate (they are on disk) and pick the best basis
for the final deliverable.

${SPEC}

${REQUIRED_LAYOUT.replace(/<ROOT>/g, '<candidate root>')}

CANDIDATES AND THEIR TEST RESULTS:
${JSON.stringify(judgeInput, null, 2)}

Score each 0-10 on:
 - fidelityScore: observable behavioural fidelity to the executable (differential results are the primary evidence;
   also reason about untested inputs, e.g. does the repr quote-selection logic generalize, is the integer truly
   arbitrary-precision, is the field ordering / first-failure-wins rule right, is stdout truly empty on the error path)
 - complianceScore: hard-requirement compliance (ESM only, .mjs everywhere, suffixed relative imports, zero external
   imports, no DataView/ArrayBuffer/typed-array/Buffer anywhere including comments, hand-rolled argv parsing,
   dynamically derived prog name)
 - structureScore: hierarchical single-responsibility modules, clean exported interfaces, entry file that mirrors
   the Python main(), readable code with comment density comparable to the source
Actually read the files before scoring. List concrete issues per candidate.
Then name the winner (its root path) and list the specific best ideas from the runners-up worth grafting in.`,
  { label: 'judge', phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'high' }
)

log(`winner: ${judgment ? judgment.winner : 'none'}`)

// ---------------------------------------------------------------- Phase 4
phase('Finalize')

const final = await agent(
  `Produce the FINAL deliverable for a Python-to-Node.js port, in /output.

${SPEC}

${REQUIRED_LAYOUT.replace(/<ROOT>/g, '/output')}

Three candidate implementations exist on disk. A judge ranked them:
${JSON.stringify(judgment, null, 2)}

Your job:
1. Start from the winning candidate (${judgment ? judgment.winner : '/tmp/cand_c2'}), read its files, and graft in the
   listed best ideas from the runners-up. Fix every issue the judge listed, for the winner AND any issue that
   applies to the grafted code.
2. Write the final bundle to /output with the layout above. /output must contain ONLY the deliverable:
   the entry file /output/test3.mjs and the lib/ tree. Do NOT copy any _difftest.mjs or scratch files into /output.
3. Every file .mjs; every relative import carries the .mjs suffix; 'export' for all public interfaces.
   No require(, no module.exports, no DataView, no ArrayBuffer, no typed arrays, no Buffer, no npm imports,
   no node: imports unless genuinely unavoidable (you should need NONE).
4. Keep the code commented at roughly the density of the Python source, and preserve the intent of the two Chinese
   comments from the source ("define the first field" / "define the second field" / "build the struct") as comments
   on the corresponding JS lines.
5. Then VERIFY exhaustively: write a throwaway harness OUTSIDE /output (e.g. /tmp/final_difftest.mjs) and run the
   full corpus below against /output/test3.mjs vs ${EXE}. Iterate until there are ZERO mismatches.

${DIFF_CORPUS}

6. Finally, self-audit with grep over /output for: require(, module.exports, DataView, ArrayBuffer, Uint8Array,
   Int8Array, Buffer, and any import line whose specifier does not start with './' or '../' or does not end in '.mjs'.
   Report the results of that audit in your notes. Confirm /output contains no stray files.
Return the list of files written and notes including your final differential test tally.`,
  { label: 'finalize', phase: 'Finalize', schema: CAND_SCHEMA, effort: 'high' }
)

log(`final bundle: ${final ? final.files.length : 0} files`)

// ---------------------------------------------------------------- Phase 5
phase('Critique')

const CRITICS = [
  {
    key: 'compliance',
    prompt: `Audit /output for HARD-REQUIREMENT violations only. Read every file. Check, by actually grepping and by
reading: (1) ESM only -- no require(, no module.exports, anywhere including comments and string literals;
(2) every file ends in .mjs; (3) every import specifier is relative AND ends in .mjs; (4) zero external/npm imports,
and flag any 'node:' import in the deliverable as a finding to justify or remove; (5) the tokens DataView,
ArrayBuffer, Uint8Array, Int8Array, Buffer appear NOWHERE, including comments; (6) argv is parsed by hand from
process.argv with no library; (7) no embedded/invoked Python and no shelling out; (8) /output contains only the
deliverable (no test harnesses, no scratch, no leftover candidate dirs); (9) the deliverable actually runs on
Node 18 -- verify with 'node --version' and a real invocation. Report only real violations you can quote.`,
  },
  {
    key: 'fidelity',
    prompt: `Hunt for BEHAVIOURAL DIVERGENCE between /output/test3.mjs and ${EXE}. Do not trust prior test reports --
re-run things yourself. Focus on inputs a previous tester would plausibly have missed. Specifically try to break:
the bytes-repr quote selection and escaping (every one of the 256 byte values in BOTH positions, and the
apostrophe/quote/backslash interactions); Python int() acceptance (unicode digit scripts beyond the two already
tested, unicode whitespace forms, huge magnitudes, '+'/'-' with underscores, '-0'); argparse minutiae (the '='
form with an empty value like --a=, repeated options, options after '--', a lone '-', '-h' combined with an
invalid value, unrecognized-vs-required error precedence, argument order permutations); the error path
(stdout must be COMPLETELY empty, exit code exactly 1, correct fieldN, exact 'given value' rendering for negative
and huge values). For every divergence give the exact command and the expected vs actual bytes.`,
  },
  {
    key: 'structure',
    prompt: `Review /output as an engineering deliverable for a senior migration review. Read every file. Assess:
is the library genuinely split by functionality into single-responsibility modules with clear exported interfaces
(not one fat file plus token stubs, and not so fragmented that modules are meaningless)? Does the entry file
/output/test3.mjs read like the Python main() so a reviewer can map them line by line? Are the construct
abstractions (Struct, Int8ul, the 'name / subcon' naming idiom) modelled in a way that would extend to other
field types, or hardcoded to this one program in a way that misrepresents the library? Is anything dead,
duplicated, or misleadingly named? Is comment density comparable to the Python source, and are the source's
inline comments carried over? Report concrete, actionable findings only -- no style nitpicks.`,
  },
  {
    key: 'completeness',
    prompt: `You are a completeness critic for a Python-to-Node.js port in /output. Read the files and the spec below,
then answer: what has NOT been verified, what behaviour of the original is NOT represented, and what input class
has NO coverage? Consider: observable dimensions nobody checked (exit codes on every path, stdout/stderr routing,
trailing newline presence/absence, output when stdout is a pipe vs tty); parts of the Python source whose semantics
were dropped (the Struct returning a container, build() accepting a dict, the fact that construct validates per
field in declaration order); and any assumption in the port that happens to hold for the tested inputs but is not
actually justified. For each gap, state the concrete command or check that would close it, and RUN it if you can.
Report what you found, not just what is missing.`,
  },
]

const critiques = await pipeline(
  CRITICS,
  (c) => agent(
    `${c.prompt}

${SPEC}

You may run ${EXE} and node freely. Do NOT modify any file -- you are a reviewer. Write scratch files only under /tmp.`,
    { label: `critic:${c.key}`, phase: 'Critique', schema: CRITIC_SCHEMA, effort: 'high' }
  ),
  // Adversarially verify each finding with 2 skeptics before it earns a repair.
  (rep, c) => rep === null ? [] : parallel(rep.findings.map((f) => () =>
    parallel([
      () => agent(
        `Try to REFUTE this claimed defect in the Node.js port at /output. Reproduce it yourself by running the
commands. If the claim does not reproduce, or the "expected" behaviour is not what ${EXE} actually does, or it is a
style opinion rather than a violation of the requirements, mark real=false. Default to real=false when uncertain.

CLAIM (${c.key}, severity ${f.severity}) in ${f.file}: ${f.summary}
Evidence offered: ${f.evidence}
Proposed fix: ${f.fix}

${SPEC}`,
        { label: `refute:${c.key}`, phase: 'Critique', schema: VERDICT_SCHEMA }
      ),
      () => agent(
        `Independently judge whether this is a genuine, must-fix defect in the deliverable at /output. Verify against
the requirements and against the real behaviour of ${EXE}. A defect is real only if fixing it changes observable
behaviour to better match the executable, OR it violates an explicit hard requirement. Aesthetic preferences are
real=false.

CLAIM (${c.key}, severity ${f.severity}) in ${f.file}: ${f.summary}
Evidence offered: ${f.evidence}

${SPEC}`,
        { label: `judge:${c.key}`, phase: 'Critique', schema: VERDICT_SCHEMA }
      ),
    ]).then((votes) => {
      const ok = votes.filter(Boolean)
      const real = ok.length > 0 && ok.every((v) => v.real)
      return { ...f, source: c.key, confirmed: real, verdicts: ok.map((v) => v.reason) }
    })
  ))
)

const confirmed = critiques.flat().filter(Boolean).filter((f) => f.confirmed)
const rejected = critiques.flat().filter(Boolean).filter((f) => !f.confirmed)
log(`critique: ${confirmed.length} confirmed, ${rejected.length} rejected`)
for (const f of confirmed) log(`  [${f.severity}] ${f.file}: ${f.summary}`)

// ---------------------------------------------------------------- Phase 6
phase('Repair')

let repair = null
if (confirmed.length > 0) {
  repair = await agent(
    `Apply confirmed fixes to the Node.js port in /output, then re-verify end to end.

${SPEC}

${REQUIRED_LAYOUT.replace(/<ROOT>/g, '/output')}

CONFIRMED DEFECTS (each was independently verified by two reviewers):
${JSON.stringify(confirmed, null, 2)}

Rules:
- Fix every confirmed defect. Keep all hard requirements intact (ESM, .mjs, suffixed relative imports,
  zero external deps, no DataView/ArrayBuffer/typed-array/Buffer tokens anywhere, hand-rolled argv parsing).
- Do not regress anything. After fixing, re-run the FULL differential corpus below from a harness in /tmp
  (never inside /output) against ${EXE} and iterate until there are ZERO mismatches.
- Re-run the forbidden-token grep audit over /output and confirm /output holds only the deliverable.

${DIFF_CORPUS}

Return the final file list and notes: what you changed, and the final differential tally (total/passed/failed).`,
    { label: 'repair', phase: 'Repair', schema: CAND_SCHEMA, effort: 'high' }
  )
} else {
  log('no confirmed defects; skipping repair')
}

const gate = await agent(
  `Final acceptance gate for the deliverable in /output. Trust nothing; verify everything yourself.

${SPEC}

Do all of the following and report findings (report ZERO findings only if everything genuinely passes):
1. List /output recursively. Confirm it contains ONLY the deliverable: /output/test3.mjs plus a lib/ tree of .mjs
   modules. Any harness, scratch, log, or candidate file is a blocker finding.
2. grep -rnE 'require\\(|module\\.exports|DataView|ArrayBuffer|Uint8Array|Int8Array|Buffer' /output -- any hit is a blocker.
3. Confirm every import in /output is relative and ends in .mjs, and that no npm package is imported.
4. Run the 4 documented sample cases and confirm stdout matches byte-for-byte with exit code 0:
   --a 16 --b 161 -> b'\\x10\\xa1' ; --a 194 --b 138 -> b'\\xc2\\x8a' ; --a 232 --b 186 -> b'\\xe8\\xba' ; --a 33 --b 108 -> b'!l'
5. Sweep a in 0..255 with b=65, and b in 0..255 with a=65, comparing stdout+exit code to ${EXE}. Report any mismatch.
6. Check the three error paths: --a 256 --b 0 (exit 1, empty stdout, field1) ; --a 1 --b 256 (field2) ;
   --a 16 (exit 2, usage+required error on stderr) ; --help (exit 0, help on stdout).
7. Confirm the deliverable runs under 'node' with no flags on this machine's Node version.
Report each failure as a finding with the exact command and observed vs expected output.`,
  { label: 'gate', phase: 'Repair', schema: CRITIC_SCHEMA, effort: 'high' }
)

return {
  candidates: usable.map((u) => ({ id: u.cand.id, verdict: u.test.verdict, passed: u.test.passed, total: u.test.total, failed: u.test.failed })),
  winner: judgment ? judgment.winner : null,
  finalFiles: (repair ? repair.files : final ? final.files : []),
  finalNotes: repair ? repair.notes : final ? final.notes : null,
  confirmedDefectsFixed: confirmed.map((f) => `[${f.severity}] ${f.file}: ${f.summary}`),
  rejectedClaims: rejected.map((f) => `[${f.source}] ${f.summary}`),
  gateFindings: gate ? gate.findings : null,
}
