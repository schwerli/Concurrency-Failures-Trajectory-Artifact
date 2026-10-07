export const meta = {
  name: 'verify-bencoder-port',
  description: 'Adversarially fuzz + review the Node.js port of test4.py against the reference executable',
  phases: [
    { title: 'Fuzz', detail: 'differential fuzzing across behaviour categories' },
    { title: 'Confirm', detail: 'independently reproduce each reported mismatch' },
    { title: 'Review', detail: 'spec-compliance and latent-bug review of the source' },
    { title: 'Critic', detail: 'what coverage is still missing' },
  ],
}

const BRIEF = `
You are verifying a Node.js (ESM) port of a Python program against its reference
implementation. Do NOT edit any files under /output — you only test and report.

Reference (ground truth, a frozen PyInstaller build of test4.py):
  /workspace/dataset/test4_executable --a <VALUE>
Port under test:
  node /output/test4.mjs --a <VALUE>

The Python source is /workspace/dataset/test4.py:
  import argparse, bencoder
  parser = argparse.ArgumentParser()
  parser.add_argument('--a', type=str, required=True)
  args = parser.parse_args()
  result = bencoder.decode(args.a.encode('ascii'))
  print(result)

A differential harness already exists and is concurrency-safe (each run uses its
own temp dir):
  /output/tools/difftest.sh <case-file>
  ... | /output/tools/difftest.sh -        # cases on stdin
Each case line is a bash-quoted argv list, e.g.:   --a '9:value'
Lines starting with # are skipped. The harness compares exit status, stdout AND
stderr (normalising only the program name and the PyInstaller process id) and
prints "pass=N fail=M" plus details for each failure.

IMPORTANT harness caveats:
 - Write your case file to a UNIQUE path, e.g. /tmp/fuzz-<yourcategory>.txt.
 - Cases go through 'eval set -- <line>', so quote carefully. Prefer single
   quotes; to embed a single quote use '"'"' or double quotes.
 - NUL bytes cannot travel through argv at all; do not try.
 - The reference resolves its script path 'test4.py' relative to the CURRENT
   DIRECTORY, so tracebacks include a source line only when ./test4.py exists.
   The port emulates this. Test from BOTH /workspace/dataset (test4.py present)
   and some other directory such as /tmp.
 - Some behaviour depends on the COLUMNS environment variable (argparse help and
   usage wrapping). Note that usage wrapping also depends on the length of the
   program name, which legitimately differs (test4_executable vs test4.mjs), so a
   wrapping difference at a given COLUMNS is NOT automatically a bug: verify by
   constructing a parser with a matching prog, e.g.
     node -e "import('/output/lib/argparse/index.mjs').then(m => { const p = new m.ArgumentParser({prog:'test4_executable'}); p.addArgument('--a',{required:true}); process.stdout.write(p.formatHelp()); })"
   and compare with COLUMNS=<n> /workspace/dataset/test4_executable --help.

Already-verified behaviour (do not merely re-confirm these; probe AROUND them):
 - length prefixes are not validated: '9:value' -> b'value', '100:ab' -> b'ab'
 - dicts come from dict(zip(items[::2], items[1::2])): 'd3:cowe' -> {}
 - unknown leading byte: the ordinal is PRINTED to stdout, then AssertionError
 - trailing data -> TypeError: Malformed input.
 - recursion limit: 998 nested containers ok, 999 -> RecursionError
 - 'i042e' -> 42, 'i-0e' -> 0
 - argparse: '--a -5' ok, '--a -1e5' error, '--h' == help, '-ha' prints help rc=0

Run MANY cases (at least 150 for your category, more if cheap). Be adversarial:
hunt for inputs where the port and the reference diverge. Report ONLY real
divergences reported by the harness, with the exact argv line and the observed
difference. If you find none, say so and report how many cases you ran.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'casesRun', 'mismatches'],
  properties: {
    category: { type: 'string' },
    casesRun: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argvLine', 'description'],
        properties: {
          argvLine: { type: 'string', description: 'exact case line that diverges' },
          description: { type: 'string', description: 'ref vs port: rc/stdout/stderr difference' },
          cwd: { type: 'string', description: 'directory the case was run from, if it matters' },
          env: { type: 'string', description: 'env such as COLUMNS=30, if it matters' },
        },
      },
    },
    notes: { type: 'string', description: 'anything suspicious but not a confirmed mismatch' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reproduced', 'explanation'],
  properties: {
    reproduced: { type: 'boolean' },
    explanation: { type: 'string' },
    refOutput: { type: 'string' },
    portOutput: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'summary', 'severity', 'failureScenario'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          summary: { type: 'string' },
          failureScenario: { type: 'string', description: 'concrete argv/state -> wrong behaviour' },
        },
      },
    },
  },
}

const FUZZ_CATEGORIES = [
  {
    key: 'bytestrings',
    prompt: `Category: bencoded BYTE STRINGS. Length prefixes (0, leading zeros, very large,
astronomically large with 30+ digits), colon placement, missing colon, non-digit
after digits, bodies containing ':' 'i' 'l' 'd' 'e' and digits, exact-fit vs
over-long vs under-long bodies, empty bodies, length prefixes that overflow a
64-bit integer, and byte strings nested inside lists and dicts where the clamped
slice swallows the container terminator.`,
  },
  {
    key: 'integers',
    prompt: `Category: bencoded INTEGERS. Signs, '-0', '-000', leading zeros, huge magnitudes
(50+ digits, both signs), values straddling 2**31/2**53/2**63/2**64, missing 'e',
missing digits, 'i-e', 'i+5e', underscores, spaces inside, multiple 'e's, 'ie',
'i' alone, embedded newlines/tabs, and integers appearing as dict keys and dict
values. Confirm the printed decimal form matches exactly (no scientific notation,
no BigInt 'n' suffix).`,
  },
  {
    key: 'lists',
    prompt: `Category: bencoded LISTS. Empty, single, many members, heterogeneous members,
unterminated, extra terminators, 'e' as the first member, nesting to depths 1..50,
lists whose members are malformed, lists where a clamped byte-string slice eats
the trailing 'e', and mixed list/dict nesting. Also verify the printed repr
spacing (', ' separators) exactly for nested structures.`,
  },
  {
    key: 'dicts',
    prompt: `Category: bencoded DICTS. Odd numbers of members (the dangling key is dropped),
duplicate keys (later value wins, original position kept), integer keys, keys and
values of every type, unhashable keys (list, dict) raising TypeError, unsorted
keys preserving insertion order, empty dicts, deeply nested dicts, dicts inside
lists, and dicts where a member is malformed. Verify the printed repr exactly,
including '{' '}' and ': ' and ', ' spacing and key ordering.`,
  },
  {
    key: 'malformed-tail',
    prompt: `Category: TRAILING DATA and 'Malformed input.'. Every kind of valid prefix followed
by every kind of junk (letters, digits, 'e', ':', spaces, tabs, quotes,
backslashes, more bencode), plus inputs where the tail is empty only because a
length prefix clamped. Also probe cases where trailing data is consumed vs
rejected, and where the error is raised inside a container instead of at the top
level. Check the traceback's bencoder.py line numbers match.`,
  },
  {
    key: 'unknown-byte',
    prompt: `Category: UNRECOGNISED LEADING BYTE (the print-then-AssertionError path). Try every
printable ASCII byte that is not a digit and not i/l/d as the first character,
both bare and followed by more text, and nested inside lists and dicts at various
depths. Also try control characters that argv can carry (tab, newline, vertical
tab, form feed, escape, DEL, 0x01..0x08). Verify the integer printed to stdout
and the traceback frames both match.`,
  },
  {
    key: 'bytes-repr',
    prompt: `Category: repr() ESCAPING of decoded byte strings. Bodies containing single quotes,
double quotes, both, backslashes, tab/newline/carriage-return, other control
characters (0x01..0x1f, 0x7f) that argv can carry, and combinations. Verify
Python's quote-selection rule (double quotes only when the body has a single
quote and no double quote) and the exact escape spelling. Test both top-level
byte strings and byte strings nested inside lists and dicts.`,
  },
  {
    key: 'ascii-encode',
    prompt: `Category: str.encode('ascii') FAILURES. Non-ASCII characters at position 0, in the
middle, at the end; single characters vs runs of 2..5; runs separated by ASCII
characters (only the FIRST run is reported); Latin-1 range (U+0080..U+00FF),
BMP (U+0100..U+FFFF), astral/emoji (U+10000+, which count as ONE position);
combining marks; and non-ASCII appearing after otherwise valid bencode. Verify
the exact UnicodeEncodeError message, escape form (\\xNN vs \\uNNNN vs
\\UNNNNNNNN) and position numbering.`,
  },
  {
    key: 'argparse-forms',
    prompt: `Category: ARGPARSE option forms. '--a X', '--a=X', '--a=' (empty), repeated --a
(last wins), long-option abbreviations of --help ('--h', '--he', ... ) and
non-matches ('--a' is exact, '--aa', '--A', '---a'), ambiguous prefixes ('--',
'--=x'), joined short options ('-h', '-hx', '-ha', '-h=x', '--help=x'), unknown
options, extra positionals, and values that look like options ('-5', '-5.5',
'-.5', '-0', '-1e5', '-i42e', '-', '-h', '--help', strings containing spaces).
Verify exit status, stdout and the full stderr message.`,
  },
  {
    key: 'argparse-dashdash',
    prompt: `Category: ARGPARSE '--' separator and leftover arguments. '--' before/after/instead
of the value, multiple '--', '--' as the value via '--a=--', empty-string
arguments, arguments consisting only of dashes, and every combination that
produces 'unrecognized arguments' vs 'expected one argument' vs 'the following
arguments are required'. Confirm the precedence between the required-argument
error and the unrecognized-arguments error, and that -h/--help short-circuits
both.`,
  },
  {
    key: 'argparse-help-width',
    prompt: `Category: HELP and USAGE rendering. Compare '--help' output and the usage block
printed on errors for COLUMNS values 1..120 (sweep every value up to 60, then
sample), plus COLUMNS unset, empty, '0', negative, non-numeric, and with
surrounding whitespace. Because usage wrapping depends on the program-name
length, use the formatter-with-matching-prog technique from the brief to compare
apples to apples; also verify that the port's own rendering is self-consistent
with what argparse would do for a 9-character prog.`,
  },
  {
    key: 'recursion',
    prompt: `Category: RECURSION LIMIT. Nesting depth boundaries for lists ('l'*n + 'e'*n), dicts
('d0:'*n + 'e'*n), and mixed alternating l/d nesting, around and far beyond the
limit (n = 1, 2, 100, 500, 990..1005, 1500, 5000, 20000). Verify exit status,
stdout, and the full traceback including the '[Previous line repeated N more
times]' count and its singular/plural form. Also check that a structure just
inside the limit still prints its full repr correctly.`,
  },
  {
    key: 'random-valid',
    prompt: `Category: RANDOMISED VALID INPUTS. Programmatically generate several hundred
well-formed bencode documents (random nesting of ints, byte strings, lists and
dicts, random lengths, random ASCII payloads including punctuation and quote
characters) and diff them all. Use a shell/node generator writing a case file.
Make sure generated payloads are correctly shell-quoted. Report any divergence.`,
  },
  {
    key: 'random-soup',
    prompt: `Category: RANDOMISED MALFORMED INPUTS. Generate several hundred random strings over
the alphabet [0-9ildeo:\\-+ ,.'"\\\\abcxyz] of lengths 0..40, plus random mutations
(insert/delete/replace/truncate one character) of valid bencode documents, and
diff them all. This is the highest-yield category for finding divergences: aim
for breadth. Report every divergence with its exact argv line.`,
  },
  {
    key: 'cwd-traceback',
    prompt: `Category: TRACEBACK SOURCE-LINE RESOLUTION. The reference records its script as the
relative path 'test4.py' and Python's linecache resolves it against the current
directory. Verify the port matches in every situation: cwd with the real
test4.py; cwd with no test4.py; cwd with a test4.py that is shorter than 8 lines;
cwd with a test4.py whose line 8 is blank, whitespace-only, very short, very
long, indented, contains tabs, or contains non-ASCII characters; cwd with
test4.py as an unreadable file or a directory. Use temp directories you create.
Cover both the decode-call and the encode-call caret spans (the latter via a
non-ASCII --a value). This is subtle caret arithmetic: be thorough.`,
  },
  {
    key: 'io-and-exit',
    prompt: `Category: PROCESS-LEVEL BEHAVIOUR. Exit statuses for every outcome class (0 success,
0 help, 1 uncaught exception, 2 argparse error). Stream separation: which bytes
go to stdout vs stderr, especially the print-then-AssertionError path where
stdout gets output before a failure. Behaviour when stdout is a closed pipe
(e.g. piping to 'head -c 0' or to a command that exits immediately), when stdout
is redirected to a file, and with very large outputs (a decoded structure whose
repr is hundreds of kilobytes) to check nothing is truncated or reordered.
Compare byte counts exactly.`,
  },
]

phase('Fuzz')

const fuzzResults = await pipeline(
  FUZZ_CATEGORIES,
  (category) =>
    agent(`${BRIEF}\n\n${category.prompt}`, {
      label: `fuzz:${category.key}`,
      phase: 'Fuzz',
      schema: FINDINGS_SCHEMA,
    }),
  // Each reported mismatch is independently reproduced before we believe it.
  (result, category) => {
    if (result === null) return { category: category.key, casesRun: 0, mismatches: [], notes: 'agent failed' }
    if (result.mismatches.length === 0) return result
    return parallel(
      result.mismatches.map((mismatch) => () =>
        agent(
          `Independently verify a claimed divergence between a reference program and its Node.js port.\n\n` +
            `Reference: /workspace/dataset/test4_executable\n` +
            `Port:      node /output/test4.mjs\n` +
            `Harness:   /output/tools/difftest.sh (reads bash-quoted argv lines; compares rc, stdout, stderr)\n\n` +
            `Claimed diverging case line: ${mismatch.argvLine}\n` +
            `Claimed difference: ${mismatch.description}\n` +
            `Reported cwd: ${mismatch.cwd ?? '(unspecified)'}\n` +
            `Reported env: ${mismatch.env ?? '(none)'}\n\n` +
            `Run BOTH programs yourself with that exact argv (and cwd/env if specified) and compare.\n` +
            `Be skeptical. Default to reproduced=false unless you see a genuine difference in exit\n` +
            `status, stdout bytes, or stderr bytes. Remember two legitimate, unavoidable differences:\n` +
            `the program name argparse prints (test4_executable vs test4.mjs) and the PyInstaller\n` +
            `process id in "[PYI-<pid>:ERROR] ..."; a difference consisting ONLY of those is NOT a\n` +
            `real divergence. Neither is usage-wrapping that differs solely because the program name\n` +
            `has a different length. Quote the actual bytes you observed from each program.`,
          { label: `confirm:${category.key}`, phase: 'Confirm', schema: VERDICT_SCHEMA },
        ).then((verdict) => ({ mismatch, verdict })),
      ),
    ).then((verdicts) => ({ ...result, verdicts }))
  },
)

phase('Review')

const REVIEW_BRIEF = `
Review the Node.js port that lives in /output. Read every file:
  /output/test4.mjs
  /output/lib/argparse/{parser,actions,formatter,errors,index}.mjs
  /output/lib/bencoder/{decoder,index}.mjs
  /output/lib/codecs/ascii.mjs
  /output/lib/pytypes/{bytestring,pydict,pyint,repr}.mjs
  /output/lib/runtime/{stdio,exceptions,linecache}.mjs
  /output/tools/difftest.sh

Ground truth is /workspace/dataset/test4_executable (a frozen build of
/workspace/dataset/test4.py). You may run both programs to check any hypothesis;
do not edit files. Report concrete defects with a reproducing argv where you can.
`

const REVIEW_LENSES = [
  {
    key: 'requirements',
    prompt: `Lens: TASK-REQUIREMENT COMPLIANCE. The port must satisfy all of these hard rules:
 1. Pure JavaScript for Node.js; ES modules only. 'import'/'export' only —
    'require()' and 'module.exports' are forbidden anywhere.
 2. Every generated library and entry file must use the .mjs suffix, and every
    relative import must include the full file suffix.
 3. Command-line interface must match the Python argparse setup exactly:
    a single required '--a' option taking one string value.
 4. Zero external dependencies: no npm packages. Only Node built-in modules
    (node:fs, node:path, ...) and local relative imports. Any bare import
    specifier that is not a 'node:'-prefixed builtin is a violation.
 5. No embedded Python; no shelling out to python or to the reference executable
    from the port itself (the test harness under tools/ may reference it, the
    port must not).
 6. The implementation must not use or even mention the Uint8Array / ArrayBuffer
    family of interfaces for the bencode logic. Grep the whole tree for
    'Uint8Array', 'ArrayBuffer', 'Buffer', 'TextEncoder', 'TextDecoder',
    'DataView', 'SharedArrayBuffer', 'atob', 'btoa' and report ANY occurrence,
    including in comments and strings.
 7. Everything must live under /output, with libraries split into multiple
    modules by functionality and exposing interfaces via 'export'.
Verify each rule mechanically (grep + actually running 'node /output/test4.mjs
--a i42e'). Report every violation, quoting file and line.`,
  },
  {
    key: 'correctness',
    prompt: `Lens: LATENT CORRECTNESS BUGS. Look for inputs that would make the port diverge but
that fuzzing may have missed. Scrutinise in particular:
 - Bytes.sliceCount / sliceAfter clamping with bigint lengths, and any place a
   bigint is converted to a Number (precision loss, Infinity, -0).
 - pyIntFromDecimal on very long digit runs and on '-0'/'-000'.
 - The regexes in decoder.mjs: anchoring, greediness, what '\\d' matches, and
   behaviour on strings containing regex metacharacters or newlines.
 - PyDict key identity: could a bytes key and an int key ever collide in the
   token namespace? What about a bytes key whose payload literally looks like
   another token?
 - pyBytesRepr quote selection and escape order.
 - The recursion-depth constant and where the guard is applied.
 - Exception frame bookkeeping: is a frame ever pushed twice, or lost, when an
   error propagates out of a nested container? Does the mutable pyFrames array
   survive being thrown through several catch blocks correctly?
 - stdio.mjs partial-write and EAGAIN handling; the utf8 length arithmetic.
Give a concrete failing input for each finding if one exists.`,
  },
  {
    key: 'argparse-fidelity',
    prompt: `Lens: ARGPARSE FIDELITY. Compare /output/lib/argparse/parser.mjs and formatter.mjs
against CPython's argparse algorithms (_parse_optional, _get_option_tuples,
consume_optional, _match_argument, _format_usage, _format_action). Look for
divergences in: token classification order, the negative-number matcher, the
space-containing-argument rule, abbreviation matching, the joined-short-option
tail loop, explicit '=' arguments, the '--' pattern character, extras ordering,
the precedence of the required-arguments error over unrecognized-arguments, the
help action short-circuit, help-position and help-width arithmetic, the usage
part-splitting regex, and the terminal-width probe. For each suspected
divergence, construct an argv that would expose it and actually run both
programs to check.`,
  },
  {
    key: 'robustness',
    prompt: `Lens: ROBUSTNESS AND CRASH MODES. Find inputs or environments where the port throws a
raw JavaScript error (a stack trace mentioning .mjs), hangs, exits with the wrong
status, or produces unhandled-rejection output — anything that is not a faithful
Python-style outcome. Consider: extremely long arguments (megabytes), arguments
with lone surrogates or invalid UTF-8, deeply nested structures near the JS stack
limit, a huge repr, missing/odd argv (no arguments at all, only '--'), a
read-only or full filesystem for the linecache read, a test4.py in cwd that is a
directory or unreadable, COLUMNS set to absurd values, stdout closed, and running
via 'node --input-type' or from a different cwd. Report anything that leaks JS
internals to the user.`,
  },
  {
    key: 'quality',
    prompt: `Lens: ENGINEERING QUALITY. Assess the module hierarchy, naming, cohesion, and whether
the comments accurately describe what the code does (flag any comment that is
wrong or misleading — that is a real defect). Flag dead code, unused exports,
duplicated logic that should be shared (for example any repeated repr/escape or
UTF-8 length helper), misplaced responsibilities, and anything that would confuse
a maintainer. Do not propose stylistic rewrites that would change behaviour;
prefer findings that are both safe and clearly worth doing.`,
  },
]

const reviewResults = await parallel(
  REVIEW_LENSES.map((lens) => () =>
    agent(`${REVIEW_BRIEF}\n\n${lens.prompt}`, {
      label: `review:${lens.key}`,
      phase: 'Review',
      schema: REVIEW_SCHEMA,
    }),
  ),
)

phase('Critic')

const fuzzSummary = fuzzResults
  .filter(Boolean)
  .map((r) => `${r.category}: ${r.casesRun} cases, ${r.mismatches.length} claimed mismatches`)
  .join('\n')

const critic = await agent(
  `${BRIEF}\n\nYou are the completeness critic for a verification effort on this port.\n` +
    `Fuzzing already covered these categories:\n${fuzzSummary}\n\n` +
    `Review lenses already applied: ${REVIEW_LENSES.map((l) => l.key).join(', ')}.\n\n` +
    `Your job: find what is STILL untested. Identify behaviour dimensions nobody exercised, ` +
    `then actually test them yourself and report any divergence you find. Think about ` +
    `interactions between dimensions (e.g. a non-ASCII argument combined with an unusual cwd, ` +
    `a help request combined with a bad value, exotic COLUMNS combined with an error path, ` +
    `locale or environment variables, argv encoding, symlinked invocation paths, ` +
    `concurrent invocation). Report concrete divergences only.`,
  { label: 'critic:coverage', phase: 'Critic', schema: FINDINGS_SCHEMA },
)

const confirmedMismatches = []
for (const result of fuzzResults.filter(Boolean)) {
  for (const entry of result.verdicts ?? []) {
    if (entry.verdict?.reproduced) {
      confirmedMismatches.push({ category: result.category, ...entry.mismatch, verdict: entry.verdict })
    }
  }
}

return {
  totalCasesRun: fuzzResults.filter(Boolean).reduce((sum, r) => sum + (r.casesRun ?? 0), 0),
  perCategory: fuzzResults.filter(Boolean).map((r) => ({
    category: r.category,
    casesRun: r.casesRun,
    claimed: r.mismatches.length,
    notes: r.notes,
  })),
  confirmedMismatches,
  reviewFindings: reviewResults
    .filter(Boolean)
    .flatMap((r, index) => r.findings.map((f) => ({ lens: REVIEW_LENSES[index]?.key, ...f }))),
  criticFindings: critic,
}
