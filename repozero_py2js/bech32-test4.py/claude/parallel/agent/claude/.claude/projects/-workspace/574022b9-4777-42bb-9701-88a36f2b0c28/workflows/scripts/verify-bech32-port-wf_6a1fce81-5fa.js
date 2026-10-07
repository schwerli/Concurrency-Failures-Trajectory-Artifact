export const meta = {
  name: 'verify-bech32-port',
  description: 'Differentially fuzz and adversarially review the Node port of test4.py against the reference executable',
  phases: [
    { title: 'Fuzz', detail: 'category-specific differential fuzzing vs the reference executable' },
    { title: 'Review', detail: 'per-module adversarial review + requirements audit' },
    { title: 'Verify', detail: 'independent skeptic re-runs each reported finding' },
    { title: 'Critic', detail: 'completeness critic looks for untested surface' },
  ],
};

const CONTEXT = `
You are verifying a Node.js (ESM, .mjs) port of a Python script.

REFERENCE (ground truth, run it, do NOT modify):
  /workspace/dataset/test4_executable --a <hrp> --b <witver> --c <comma-separated ints>
  Source: /workspace/dataset/test4.py  (argparse: --a str required, --b int required, --c str required;
  witprog = list(map(int, args.c.split(','))); result = bech32.encode(args.a, args.b, witprog); print(result))
  The bundled Python "bech32" package internals are NOT viewable - treat it as a black box.

PORT UNDER TEST (read it, do NOT edit it):
  /output/test4.mjs  plus  /output/lib/py/*.mjs  and  /output/lib/bech32/*.mjs
  Run as: node /output/test4.mjs --a bc --b 5 --c 1,2,3

DIFFERENTIAL HARNESS (already written, use it):
  /tmp/difftest.mjs exports  runAll(cases, {label})  where cases is an array of argv arrays.
  It compares stdout, stderr (with [PYI-<pid>:ERROR] normalized) and exit code, and prints
  "[label] pass=N/M fail=K" followed by up to 20 MISMATCH blocks.
  Write your own generator script in /tmp/<yourname>.mjs like:
    import { runAll } from '/tmp/difftest.mjs';
    const cases = [ ['--a','bc','--b','5','--c','1,2'], ... ];
    await runAll(cases, { label: 'mycat' });
  Set env DIFF_CONCURRENCY=6 when running (e.g. DIFF_CONCURRENCY=6 node /tmp/mine.mjs) to avoid
  thrashing, and keep each run under ~800 cases so it finishes in a couple of minutes. Split into
  several runs if you need more coverage. Every process pair costs ~120ms of wall clock.

RULES:
 - NEVER edit anything under /output. Report only. Another process applies fixes.
 - A finding counts ONLY if you actually ran both binaries and observed a difference in
   stdout, exit code, or (PID-normalized) stderr. Paste the exact argv and both observed outputs.
 - Differences purely in the PyInstaller PID number are NOT findings.
 - Report the shortest reproducing argv you can find.
`;

const MISMATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['casesRun', 'mismatches', 'notes'],
  properties: {
    casesRun: { type: 'integer' },
    notes: { type: 'string', description: 'What you covered, and anything suspicious but unconfirmed' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'refObserved', 'portObserved', 'why'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          refObserved: { type: 'string' },
          portObserved: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
  },
};

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'notes'],
  properties: {
    notes: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'summary', 'repro', 'refObserved', 'portObserved', 'severity'],
        properties: {
          file: { type: 'string' },
          summary: { type: 'string' },
          repro: { type: 'string', description: 'Exact shell command(s), or "REQUIREMENT" for a static requirement violation' },
          refObserved: { type: 'string' },
          portObserved: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'evidence'],
  properties: {
    real: { type: 'boolean' },
    evidence: { type: 'string', description: 'What you ran and what you saw' },
  },
};

const FUZZ_CATEGORIES = [
  {
    key: 'mainstream',
    prompt: `Fuzz the MAINSTREAM success path. Random realistic inputs: hrp drawn from lowercase
letters/digits of length 1..12 (e.g. bc, tb, ltc, test, doge, x9), witness version 0..16,
witness program of random length 2..40 with random bytes 0..255. Generate at least 600 random
cases across two runs plus these deliberate boundaries: witver 0 with program length exactly
19, 20, 21, 31, 32, 33; witver 1..16 with lengths 2, 3, 20, 32, 39, 40, 41. Confirm the port
agrees on both the encoded address and on which inputs print "None".`,
  },
  {
    key: 'witver',
    prompt: `Fuzz the --b (witness version) argument exhaustively. Cover every integer -60..60,
then 1000, 2**31, 2**53, 2**53+1, 2**62, 2**63-1, 2**63, 2**63+1, 2**64, 10**30 and the negatives
of all of those. Also cover integer spelling variants Python's int() accepts or rejects:
'+5', '007', ' 5 ', tab/newline padded, '1_3', '1__3', '_5', '5_', '5.0', '0x10', '1e3', '',
'  ', '5,', '- 5', '- -5', full-width digits, Arabic-Indic digits, mixed digit families,
non-breaking-space padding, and '\\u2028'-padded. Compare stdout, stderr and exit code.
Remember argv values starting with '-' may be swallowed by argparse; use both '--b -1' and
'--b=-1' spellings.`,
  },
  {
    key: 'witprog',
    prompt: `Fuzz the --c (witness program) argument. Cover: single element, empty string,
whitespace-only element, trailing/leading comma, consecutive commas, elements with spaces,
'+' signs, underscores, leading zeros, unicode digits, values 255/256/257/1000/2**64/10**40,
negative values (use the '--c=-1,2' spelling since bare '-1,2' is rejected by argparse),
non-numeric junk ('x', '1.0', '1e2', 'NaN', 'inf', '٣'), lengths 0..45 elements, and 100/1000
elements. Verify the ValueError traceback text (including the repr of the offending token, e.g.
tabs shown as \\t) matches byte for byte after PID normalization.`,
  },
  {
    key: 'hrp',
    prompt: `Fuzz the --a (human readable part) argument. Cover: empty string, every single ASCII
character 0x20..0x7e as a one-character hrp, uppercase and mixed-case hrps, hrp containing '1',
hrp containing '=', hrp made of only digits, hrp with leading '-' (use '--a=-1' and '--a -1'),
non-ASCII hrp (accented letters, CJK, emoji, combining marks), hrp lengths 1..70 with a 20-byte
program (watch for any total-length limit), and hrps that are prefixes/suffixes of each other.
Report any case where the port's address string or None-ness differs from the reference.`,
  },
  {
    key: 'argparse-structure',
    prompt: `Fuzz argparse STRUCTURE, not values. Cover: no arguments; each single argument alone;
each pair; duplicate options (last wins?); '--a=value' and '--a value' forms; '--a=' empty;
abbreviations '--h', '--he', '--hel', '--help', '-h', '-hh', '-a', '-abc', '--aa', '--A';
unknown options '--d 1', '-x', '-', '--'; '--' before/between/after the options and twice;
extra positionals; option values that look like options ('--a --b'); an empty-string argv element
('' as a value and as a standalone arg); arguments in every permutation order; '--help' combined
with missing required args and with invalid values (which wins?); '--version'. Compare stdout,
stderr and exit code exactly (usage text, error text, exit status 0 vs 1 vs 2).`,
  },
  {
    key: 'none-boundary',
    prompt: `Map the exact boundary between a printed address and printed "None". For a fixed
hrp 'bc' sweep witness version -40..40 crossed with program lengths 0..42 (skip length 0 if the
CLI cannot express it) using deterministic byte values, and for a few hrps ('', 'a', 'A', 'bc',
'test', 'a1b', 'x'*45, 'x'*60) sweep witver in {0,1,15,16,17} x lengths {2,19,20,21,31,32,33,40,41}.
The port must agree on every single cell. Also probe whether hrp length affects acceptance
(total address length limits) by testing hrp lengths 1..80 with 20- and 32-byte programs.`,
  },
  {
    key: 'unicode',
    prompt: `Fuzz UNICODE handling everywhere. Non-ASCII hrps (Latin-1 range, U+0100..U+FFFF, astral
plane, emoji with ZWJ, lone combining marks). Unicode decimal digits in --b and --c from several
families (full-width U+FF10, Arabic-Indic U+0660, Devanagari U+0966, Bengali U+09E6, Osmanya
U+104A0, mathematical monospace U+1D7F6, Nyiakeng U+1E4F0), digits mixed across families, and
non-decimal digit-like characters that Python's int() must REJECT (superscript U+00B2, Roman
numeral U+2160, circled digit U+2460, U+00BD one-half, Kharoshthi numbers U+10A40). Also unicode
whitespace padding (U+00A0, U+1680, U+2000, U+2028, U+2029, U+3000, U+205F, U+180E, U+200B).
Verify both the parsed value and the exact repr in any error message.`,
  },
  {
    key: 'stress',
    prompt: `Stress and adversarial shapes. Very long --c (500, 5000, 50000 elements), very long
single integer literals (1000 digits, 10000 digits, huge negatives), very long hrp (200, 2000,
20000 chars), hrp of NUL-adjacent control characters, --c consisting of 40 copies of 255,
--b with a 5000-digit value, and combinations of these. Confirm identical stdout/stderr/exit code
and that neither side hangs, crashes with a JS stack trace, or emits a Node warning. Keep case
counts small here since each case is large.`,
  },
];

const REVIEW_TARGETS = [
  {
    key: 'argparse',
    prompt: `Adversarially review /output/lib/py/argparse.mjs against real CPython argparse behaviour
for a parser with exactly: -h/--help, --a (str, required), --b (int, required), --c (str, required),
prog='test4_executable'. Look for reachable divergences in: usage/help text layout, option
abbreviation (_get_option_tuples), '--x=value' splitting, the negative-number heuristic, the
"expected one argument" path, '--' handling, unknown-option leftovers, the order of the
"required" vs "unrecognized arguments" errors, exit codes, and which stream each message goes to.
For every suspicion, construct an argv and RUN both the reference executable and the port to
confirm a real difference before reporting it.`,
  },
  {
    key: 'pyint',
    prompt: `Adversarially review /output/lib/py/int.mjs, /output/lib/py/repr.mjs and
/output/lib/py/unicode.mjs against CPython's int(str) and repr(str). Hunt for accepted-but-should-
reject and rejected-but-should-accept inputs, wrong digit values for non-ASCII digit families,
wrong whitespace set, and any repr escaping difference (quote choice when the string contains
both quote kinds, \\x/\\u/\\U widths, printability of format characters, astral characters,
surrogates). Confirm each suspicion by running the reference executable (its error messages embed
repr) and the port.`,
  },
  {
    key: 'bech32-core',
    prompt: `Adversarially review /output/lib/bech32/*.mjs (charset, checksum, convertbits, codec,
segwit) as a reimplementation of the Python reference bech32 package. Hunt for: BigInt/Number
mixing bugs, operator-precedence differences vs Python, wrong short-circuit ORDER of validity
checks (which check fires first changes which result you get), off-by-one in slicing (data[:-6],
data[1:]), lastIndexOf vs rfind, case-normalization, the padding rules in convertbits, negative
and huge witness versions reaching CHARSET indexing, and the exact IndexError messages. Prove each
finding with a concrete argv where the reference and the port differ.`,
  },
  {
    key: 'requirements',
    prompt: `Audit the deliverable against these HARD requirements and report each violation as a
finding with repro "REQUIREMENT":
 1. Pure JavaScript for Node.js; ESM only. 'import'/'export' only - no require(), no module.exports.
 2. Every generated library and entry file uses the .mjs suffix, and every relative import includes
    the full file suffix.
 3. Zero external dependencies: no npm packages, and NO import of anything that is not a local
    file - except Node built-ins (node:fs, node:path, node:url, ...). Check every import statement.
 4. No embedded Python, no shelling out to python, no calling the reference executable at runtime.
 5. The strings "Uint8Array" and "DataView" must not appear anywhere in /output, and no such
    interface may be used. grep for them.
 6. Library code is split into multiple modules by functionality, each exposing exports; the entry
    file is /output/test4.mjs. Everything lives under /output.
 7. CLI surface matches the Python file exactly: --a (str, required), --b (int, required),
    --c (str, required), no extra or missing options, same defaults.
 8. Nothing extraneous or broken in /output: list the tree, check every file parses
    (node --check works on .mjs), and check for dead/unused exports or leftover scratch files.
Also verify the port runs correctly when invoked from a different working directory and via an
absolute path, and that it does not depend on any file outside /output.`,
  },
  {
    key: 'traceback-stderr',
    prompt: `Adversarially review the error/exit paths: /output/lib/py/traceback.mjs,
/output/lib/py/stdio.mjs and the frozen() wrapper in /output/test4.mjs. Verify byte-for-byte
(after PID normalization) stderr equality for every reachable failure: int() ValueError from --c,
IndexError "string index out of range", IndexError "cannot fit 'int' into an index-sized integer",
all argparse errors, and --help/-h on stdout. Check exit codes (0/1/2), which stream each goes to,
that stdout is empty when the reference's stdout is empty, that output is not truncated when stdout
or stderr is a pipe that closes early (e.g. piping to 'head -1'), and behaviour when stdout is a
closed pipe or /dev/full. Compare against the reference executable for each case.`,
  },
];

phase('Fuzz');
const fuzz = await parallel(
  FUZZ_CATEGORIES.map((category) => () =>
    agent(`${CONTEXT}\n\nYOUR ASSIGNMENT (${category.key}):\n${category.prompt}`, {
      label: `fuzz:${category.key}`,
      phase: 'Fuzz',
      schema: MISMATCH_SCHEMA,
    }).then((result) => ({ category: category.key, ...(result || { casesRun: 0, mismatches: [], notes: 'agent died' }) })),
  ),
);

const fuzzMismatches = fuzz.filter(Boolean).flatMap((r) =>
  (r.mismatches || []).map((m) => ({ source: `fuzz:${r.category}`, ...m })),
);
log(`Fuzz phase: ${fuzz.filter(Boolean).reduce((n, r) => n + (r.casesRun || 0), 0)} cases, ${fuzzMismatches.length} raw mismatches`);

phase('Review');
const reviewed = await pipeline(
  REVIEW_TARGETS,
  (target) =>
    agent(`${CONTEXT}\n\nYOUR ASSIGNMENT (review:${target.key}):\n${target.prompt}`, {
      label: `review:${target.key}`,
      phase: 'Review',
      schema: FINDING_SCHEMA,
    }),
  (result, target) => {
    const findings = (result?.findings || []).map((f) => ({ source: `review:${target.key}`, ...f }));
    if (findings.length === 0) return [];
    return parallel(
      findings.map((finding) => () =>
        agent(
          `${CONTEXT}\n\nAnother agent reported this finding about the port. Your job is to REFUTE it.\n` +
            `Run the repro yourself against BOTH the reference executable and the port and decide whether a\n` +
            `real, reachable difference exists. Default to real=false when the evidence does not hold up, when\n` +
            `the only difference is the PyInstaller PID, or when the claim is about unreachable code.\n` +
            `For a "REQUIREMENT" finding, check the actual files instead of running.\n\n` +
            `FINDING: ${JSON.stringify(finding)}`,
          { label: `verify:${target.key}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((verdict) => ({ ...finding, verdict })),
      ),
    );
  },
);

const confirmed = reviewed
  .filter(Boolean)
  .flat()
  .filter(Boolean)
  .filter((f) => f.verdict?.real === true);
log(`Review phase: ${confirmed.length} findings survived refutation`);

phase('Critic');
const critic = await agent(
  `${CONTEXT}\n\nYou are the COMPLETENESS CRITIC. These categories were fuzzed: ${FUZZ_CATEGORIES.map((c) => c.key).join(', ')}.\n` +
    `These modules were reviewed: ${REVIEW_TARGETS.map((t) => t.key).join(', ')}.\n` +
    `Confirmed findings so far: ${JSON.stringify(confirmed.map((f) => f.summary))}\n` +
    `Raw fuzz mismatches so far: ${JSON.stringify(fuzzMismatches.slice(0, 40))}\n\n` +
    `Ask what is still UNTESTED about this port: an input shape nobody generated, an environment\n` +
    `condition (cwd, locale env vars, LANG/LC_ALL, PYTHONIOENCODING, stdin closed, non-UTF8 argv\n` +
    `bytes, huge argv, TERM/COLUMNS affecting argparse wrapping), an exit-code path, a stream-\n` +
    `buffering path. Then actually TEST the gaps you identify against both binaries and report only\n` +
    `confirmed differences. Be specific and empirical, not speculative.`,
  { label: 'critic', phase: 'Critic', schema: FINDING_SCHEMA },
);

return {
  fuzzSummary: fuzz.filter(Boolean).map((r) => ({ category: r.category, casesRun: r.casesRun, mismatches: (r.mismatches || []).length, notes: r.notes })),
  fuzzMismatches,
  confirmedReviewFindings: confirmed,
  refutedReviewFindings: reviewed.filter(Boolean).flat().filter(Boolean).filter((f) => f.verdict?.real !== true).map((f) => ({ summary: f.summary, evidence: f.verdict?.evidence })),
  criticFindings: critic?.findings || [],
  criticNotes: critic?.notes || '',
};
