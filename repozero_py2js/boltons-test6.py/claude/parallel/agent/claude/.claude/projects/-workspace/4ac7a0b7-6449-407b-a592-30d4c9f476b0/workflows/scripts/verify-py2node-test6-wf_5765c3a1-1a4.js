export const meta = {
  name: 'verify-py2node-test6',
  description: 'Adversarially fuzz + review the Node port of test6.py against the Python executable',
  phases: [
    { title: 'Fuzz', detail: 'parallel differential sweeps per behavioural dimension' },
    { title: 'Verify', detail: 'independently confirm or refute each reported mismatch' },
    { title: 'Review', detail: 'code review of /output under distinct lenses' },
    { title: 'Critic', detail: 'completeness critic over the whole effort' },
  ],
}

const CONTEXT = `
# Task context

A Python program has been ported to Node.js. You are VERIFYING the port.

- Python source:      /workspace/dataset/boltons/test6.py
- Python reference:   /workspace/dataset/test6_executable   (pre-compiled, Python 3.12, run it directly; NEVER use the 'python' command)
- Node port:          /output/test6.mjs  plus libraries under /output/lib/**/*.mjs

The program takes three REQUIRED string options --a --b --c, builds a
boltons OrderedMultiDict, and prints 6 lines (repr of the OMD three times,
then getlist / keys / items results).

## Differential harness (USE THIS)

    /tmp/dt.sh [ARGS...]

It runs the reference executable and the Node port with identical argv and
byte-compares stdout, stderr AND exit status. It prints exactly "PASS" on a
match, or a "FAIL" report with hex dumps and diffs. Exit 0 = match.

IMPORTANT: the harness invokes the port through the shim
/tmp/prog/test6_executable so that argparse derives an IDENTICAL program name
on both sides. Therefore NO output normalisation happens and the comparison is
raw bytes. Do NOT compare by running "node /output/test6.mjs" yourself --
argparse legitimately derives the prog name from basename(argv[0]), so the
usage/error text and even the line wrapping would differ for reasons that are
NOT bugs. Always go through /tmp/dt.sh.

## Rules

- READ-ONLY on /output and /workspace. Do NOT edit, create or delete any file
  there. Use /tmp for scratch files.
- A NUL byte cannot be passed through argv; do not report that as a bug.
- Be efficient: batch many characters into a single argv string (e.g. 200-500
  code points per argument) so one invocation covers many cases, then binary
  search to isolate any failure to a specific character.
- Every mismatch you report MUST come with an exact, self-contained shell
  command that reproduces it via /tmp/dt.sh.
`

const MISMATCH_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    casesRun: { type: 'integer', description: 'approximate number of distinct argv cases compared' },
    coverage: { type: 'string', description: 'what you actually covered, concretely' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          repro: { type: 'string', description: 'exact shell command using /tmp/dt.sh' },
          pythonOutput: { type: 'string' },
          nodeOutput: { type: 'string' },
          suspectedCause: { type: 'string' },
        },
        required: ['title', 'repro', 'pythonOutput', 'nodeOutput'],
      },
    },
    notes: { type: 'string', description: 'anything the maintainer should know; "" if nothing' },
  },
  required: ['dimension', 'casesRun', 'coverage', 'mismatches', 'notes'],
}

const DIMENSIONS = [
  {
    key: 'unicode-bmp-low',
    prompt: `Differentially fuzz Python's repr() escaping for code points U+0001 through U+2FFF.
Batch ~300 code points per argv string (skip U+0000, which argv cannot carry). Pass batches as
--a/--b/--c so all three get exercised. Any single mismatch inside a batch will show up in the
byte diff; when a batch fails, binary-search to the exact offending code point and report it.
Pay special attention to: C0 controls, U+007F, C1 controls U+0080-U+009F, U+00A0 NBSP,
U+00AD SOFT HYPHEN, combining marks, unassigned (Cn) code points, and format (Cf) characters.`,
  },
  {
    key: 'unicode-bmp-high',
    prompt: `Differentially fuzz Python's repr() escaping for code points U+3000 through U+FFFF
(skip the surrogate range U+D800-U+DFFF, which cannot be encoded in argv). Batch ~300 code points
per argv string. Focus on: U+3000 ideographic space (Zs), Hangul, CJK, private use area
U+E000-U+F8FF (Co), U+FEFF (Cf), U+FFF9-U+FFFB (Cf), U+FFFE/U+FFFF (Cn), variation selectors,
and every unassigned block you can find. Binary-search any failing batch to the exact code point.`,
  },
  {
    key: 'unicode-astral',
    prompt: `Differentially fuzz Python's repr() escaping for astral code points U+10000-U+10FFFF.
Cover ALL of plane 1 (U+10000-U+1FFFF) in batches of ~300, then sample planes 2-16 densely,
and exhaustively cover: plane 14 tag characters U+E0000-U+E007F (Cf), plane 15/16 private use
(Co), the last code points of every plane (U+xFFFE/U+xFFFF, all Cn), emoji and emoji ZWJ
sequences, and U+10FFFF itself. Verify the \\U00xxxxxx 8-hex-digit escape form matches exactly.
Binary-search any failing batch to the exact code point.`,
  },
  {
    key: 'invalid-utf8',
    prompt: `Differentially fuzz how invalid UTF-8 in argv is handled. CPython decodes argv with
utf-8 + the surrogateescape error handler; the Node port recovers raw bytes from
/proc/self/cmdline and reimplements that decode. Use printf to build raw byte arguments, e.g.
  /tmp/dt.sh --a "$(printf 'X\\xffY')" --b b --c c
Cover systematically: every single byte 0x80-0xFF alone and embedded; all continuation bytes
without a leader; overlong encodings (C0 80, C1 BF, E0 80 80, E0 9F BF, F0 80 80 80, F0 8F BF BF);
surrogates encoded in UTF-8 (ED A0 80, ED BF BF); out-of-range leaders (F5-FF, F4 90 80 80);
truncated multi-byte sequences at the end of an argument and in the middle; valid sequences
immediately following invalid bytes; long random byte strings (use several dozen); and invalid
bytes inside an argument that ALSO reaches stderr (e.g. pass one as an unrecognized positional
argument, which exercises the stderr error handler). Report the exact byte sequence for any
mismatch.`,
  },
  {
    key: 'argparse-syntax',
    prompt: `Differentially fuzz the argparse command-line grammar. Be exhaustive and adversarial.
Cover: all orderings/permutations of --a --b --c; the "--opt value" and "--opt=value" forms mixed;
empty values (--a= and --a ""); repeated options; every subset of missing required options (to
check the exact "the following arguments are required: ..." list and order); unknown options
(--d, -d, -xyz, --unknown=1); extra positionals; the "--" separator in every position; values
that look like options (-x, --x); negative-number-looking values (-7, -7.5, -.5, -0, -1e5,
-7abc, --7); prefix abbreviations of --help (--h, --he, --hel, --help) and ambiguous prefixes
(--, --=1, --=); short-option clusters (-h, -habc, -h=x, -ha, -abch); values containing '='
and spaces and leading/trailing whitespace; options after --help; --help combined with errors
(which one wins?); very long values; values that are exactly '--'. Verify exit codes (0 vs 2)
and which stream each message goes to.`,
  },
  {
    key: 'help-layout',
    prompt: `Differentially fuzz help and usage LAYOUT, which depends on terminal width.
For EVERY integer value of COLUMNS from 1 to 200, run both "COLUMNS=$c /tmp/dt.sh --help" and
"COLUMNS=$c /tmp/dt.sh" (the error path, which prints usage to stderr). Then test invalid or
odd COLUMNS values: 0, -1, -50, "", " 40 ", "40x", "abc", "+40", "0040", a huge number like
100000, and COLUMNS unset entirely. Also verify behaviour when stdout is a pipe vs redirected
to a file vs /dev/null while stderr goes elsewhere, and vice versa. Report the exact COLUMNS
value for any mismatch. This dimension is the most layout-sensitive one -- be thorough and do
not sample; cover all 200 widths.`,
  },
  {
    key: 'omd-semantics',
    prompt: `Differentially fuzz the OrderedMultiDict semantics and the printed data structure.
Cover: --b equal to --c; --b different from --c; all three arguments identical; empty-string key
with non-empty values and vice versa; keys/values that are digits, floats, booleans-as-text
("True", "None"), whitespace-only, very long (10k+ chars), containing newlines/tabs/carriage
returns/backslashes/quotes in every combination (single quote only, double quote only, both,
backslash before a quote, trailing backslash); strings that are valid Python repr syntax
themselves; multi-line values. Verify all six printed lines byte-for-byte, especially the
quote-selection rule and that items() shows only the LAST value for the repeated key while the
OMD repr shows BOTH pairs. Also check that the number of output lines and trailing newline are
exact.`,
  },
  {
    key: 'environment',
    prompt: `Differentially fuzz environment and I/O conditions. Cover: LC_ALL and LANG set to C,
POSIX, C.UTF-8, en_US.UTF-8, and empty; LC_CTYPE variations; PYTHONIOENCODING set to utf-8,
ascii, latin-1 and to utf-8:surrogateescape; PYTHONUTF8=0 and 1; PYTHONLEGACYWINDOWSSTDIO;
TERM unset; running with a completely minimal environment via "env -i"; stdout closed
(">&-"), stdout to /dev/full if present, stderr closed; stdin closed or from /dev/null;
running from different working directories; and the program invoked via a relative path vs an
absolute path. For each, use /tmp/dt.sh so both sides see the same conditions. NOTE: differences
caused purely by the Node runtime printing its own diagnostics when a stream is closed are worth
reporting but flag them as low severity and explain. Report the exact environment for any
mismatch.`,
  },
]

phase('Fuzz')
const fuzzResults = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(`${CONTEXT}\n\n# Your dimension: ${d.key}\n\n${d.prompt}\n\nReport every mismatch you found and could reproduce. If you found none, return an empty mismatches array and describe your coverage honestly. Do not invent mismatches.`, {
      label: `fuzz:${d.key}`,
      phase: 'Fuzz',
      schema: MISMATCH_SCHEMA,
    }),
  // Each dimension's findings go straight to independent verification.
  (result, d) => {
    if (!result || !result.mismatches || result.mismatches.length === 0) return []
    return parallel(
      result.mismatches.map((m) => () =>
        agent(`${CONTEXT}

# Your job: ADVERSARIALLY VERIFY a reported mismatch

Another agent claims the Node port diverges from the Python reference:

  title: ${m.title}
  repro: ${m.repro}
  claimed python output: ${m.pythonOutput}
  claimed node output:   ${m.nodeOutput}
  suspected cause: ${m.suspectedCause || 'unstated'}

Try hard to REFUTE this. Run the repro yourself. Common reasons a claim is bogus:
 - the reporter compared "node /output/test6.mjs" directly instead of using /tmp/dt.sh, so the
   argparse program name (and therefore usage text and line wrapping) differed for legitimate
   reasons;
 - shell quoting mangled the argument so the two sides never saw the same argv;
 - the reporter misread a hex dump;
 - the difference is in the harness, not the port.

Default to refuted=true if you cannot reproduce a genuine byte-level divergence through
/tmp/dt.sh. If it IS real, state the minimal reproducing command and the exact expected vs
actual bytes.`, {
          label: `verify:${d.key}`,
          phase: 'Verify',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              refuted: { type: 'boolean' },
              reasoning: { type: 'string' },
              minimalRepro: { type: 'string' },
              expectedBytes: { type: 'string' },
              actualBytes: { type: 'string' },
            },
            required: ['title', 'refuted', 'reasoning'],
          },
        }).then((v) => ({ dimension: d.key, mismatch: m, verdict: v })),
      ),
    )
  },
)

const confirmed = fuzzResults
  .flat()
  .filter(Boolean)
  .filter((r) => r.verdict && r.verdict.refuted === false)

log(`Fuzz complete. ${confirmed.length} mismatch(es) survived adversarial verification.`)

phase('Review')
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          failureScenario: { type: 'string', description: 'concrete input -> wrong behaviour, or the exact rule violated' },
          suggestedFix: { type: 'string' },
        },
        required: ['severity', 'file', 'summary', 'failureScenario'],
      },
    },
    verdict: { type: 'string' },
  },
  required: ['lens', 'findings', 'verdict'],
}

const REQUIREMENTS = `
# Hard requirements the deliverable must satisfy

1. Pure JavaScript for the Node.js runtime.
2. ES Modules ONLY. 'import'/'export' required; 'require()' and 'module.exports' are strictly
   PROHIBITED anywhere in /output.
3. Every generated library file and the entry file must use the .mjs suffix.
4. Command-line argument handling must be parsed manually from process.argv (or an equivalent
   native mechanism) and must match the Python argparse setup exactly: --a, --b, --c, all
   type=str, all required, no defaults.
5. ZERO external dependencies. No npm packages. Imports may ONLY reference local files
   (relative paths) or Node built-in modules ('node:fs', 'node:path', 'node:url', ...).
   A bare-specifier import of anything that is not a node: builtin is an instant blocker.
6. No embedded/invoked Python. No shelling out to python, and no mention or use of any
   JS external library interface.
7. ESM import statements must include the complete file suffix (e.g. './utils.mjs').
8. Libraries must be split into multiple modules by functionality and expose their interfaces
   via 'export'. Entry file must be /output/test6.mjs.
9. Output must match Python's print() byte-for-byte, including spacing and newlines.
`

const LENSES = [
  {
    key: 'requirements-compliance',
    prompt: `Audit /output against the hard requirements list, mechanically and exhaustively.
List every file under /output. For each: confirm the .mjs suffix, confirm ESM-only syntax,
grep for 'require(', 'module.exports', 'exports.', '__dirname', '__filename' (the last two do
not exist in ESM and would be runtime bugs), and check EVERY import specifier -- it must be
either a relative path ending in .mjs or a 'node:' builtin. Flag any bare specifier. Grep for
any reference to python/py interpreters or child_process. Confirm /output/test6.mjs exists and
is the entry point, and that the library is genuinely split into multiple functional modules
rather than one blob. Also verify the entry file's argparse configuration matches the Python
source exactly (three options, names, type=str, required=true, no defaults).`,
  },
  {
    key: 'repr-and-codecs',
    prompt: `Deeply review /output/lib/py/repr.mjs, /output/lib/py/unicode.mjs and
/output/lib/py/codecs.mjs against CPython semantics. Check the repr quote-selection rule, the
escape precedence order, the printability rule (CPython treats General_Category Cc, Cf, Cs, Co,
Cn, Zl, Zp, Zs as non-printable, with U+0020 SPACE as the sole exception), the \\xhh / \\uxxxx /
\\Uxxxxxxxx thresholds and hex casing/width, and iteration by code point (including lone
surrogates). Then check the UTF-8 surrogateescape decoder byte-range tables against the strict
UTF-8 rules (overlongs, surrogate encodings, the U+10FFFF ceiling, truncated tails), and the
encoders. Look for off-by-one range errors and for any case where the byte-at-a-time invalid
handling would differ from CPython's maximal-subsequence reporting. Construct concrete inputs
for anything you doubt and test them with /tmp/dt.sh.`,
  },
  {
    key: 'argparse-fidelity',
    prompt: `Deeply review /output/lib/argparse/parser.mjs and formatter.mjs as a port of
CPython 3.12 argparse. Verify: option classification (_parse_optional) including the '='
separator tracking, abbreviation matching (_get_option_tuples) for long and short forms, the
negative-number heuristic, the nargs pattern construction and the rule that optionals never
consume '--', the consume_optional loop including the short-option-cluster path, the
required-arguments check happening BEFORE the unrecognized-arguments check, error message
wording and the 'argument NAME: ' prefix, exit codes, and which stream each message goes to.
In the formatter verify the help-position/help-width arithmetic, max_help_position derivation,
the usage-wrapping part regex and the short-prog vs long-prog branches. Hunt for latent bugs
such as unguarded array indexing, Math.min/Math.max on empty arrays, regex differences between
Python and JavaScript, and mutation of shared arrays. Test anything suspicious with /tmp/dt.sh.`,
  },
  {
    key: 'runtime-robustness',
    prompt: `Review /output for runtime robustness and correctness bugs unrelated to the happy
path. Focus on: /output/lib/py/io.mjs (synchronous write loop, partial writes, EAGAIN/EPIPE
handling, ordering guarantees vs process.exit, whether output can be truncated),
/output/lib/py/argv.mjs (the /proc/self/cmdline parsing -- off-by-one on the trailing NUL,
empty arguments, the alignment of raw bytes to process.argv.slice(2), behaviour when /proc is
unavailable, and whether an empty final argument is handled), and /output/lib/dictutils/omd.mjs
(key identity rules, whether the printed order and last-value semantics can ever be wrong,
prototype-pollution style hazards from using object keys, and the pairs/slots invariant staying
consistent after deletions). Also check /output/test6.mjs error handling. Prove each finding
with a concrete input; test with /tmp/dt.sh or a small /tmp scratch script that imports the
modules directly.`,
  },
]

const reviews = (
  await parallel(
    LENSES.map((l) => () =>
      agent(`${CONTEXT}\n${REQUIREMENTS}\n\n# Your review lens: ${l.key}\n\n${l.prompt}\n\nReport only findings you are confident about, each with a concrete failure scenario or the exact requirement violated. An empty findings array is a perfectly good answer if the code is correct.`, {
        label: `review:${l.key}`,
        phase: 'Review',
        schema: REVIEW_SCHEMA,
      }),
    ),
  )
).filter(Boolean)

phase('Critic')
const critic = await agent(`${CONTEXT}

# Your job: completeness critic

Fuzzing and review of the Node port have just finished. Here is what was covered:

## Fuzz coverage
${fuzzResults.flat().filter(Boolean).length} verification passes ran. Dimensions swept:
${DIMENSIONS.map((d) => '- ' + d.key).join('\n')}

## Confirmed mismatches after adversarial verification
${confirmed.length === 0 ? '(none)' : confirmed.map((c) => `- [${c.dimension}] ${c.mismatch.title}\n  repro: ${c.verdict.minimalRepro || c.mismatch.repro}`).join('\n')}

## Review findings
${reviews.flatMap((r) => r.findings.map((f) => `- [${r.lens}/${f.severity}] ${f.file}: ${f.summary}`)).join('\n') || '(none)'}

# What to do

Ask: what is MISSING? Which observable behaviour of the Python program has NOT been compared
against the port? Think about behavioural surfaces nobody listed above. Then actually GO TEST
the top gaps you identify using /tmp/dt.sh, and report what you found. Be concrete and
skeptical -- your value is in finding the divergence everyone else missed. Prefer running
commands over speculating.`, {
  label: 'critic:completeness',
  phase: 'Critic',
  schema: {
    type: 'object',
    properties: {
      gapsIdentified: { type: 'array', items: { type: 'string' } },
      gapsTested: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            gap: { type: 'string' },
            result: { type: 'string', enum: ['match', 'mismatch', 'untestable'] },
            detail: { type: 'string' },
            repro: { type: 'string' },
          },
          required: ['gap', 'result', 'detail'],
        },
      },
      newMismatches: { type: 'array', items: { type: 'string' } },
      verdict: { type: 'string' },
    },
    required: ['gapsIdentified', 'gapsTested', 'newMismatches', 'verdict'],
  },
})

return {
  fuzz: fuzzResults.flat().filter(Boolean).map((r) => ({
    dimension: r.dimension,
    title: r.mismatch.title,
    refuted: r.verdict && r.verdict.refuted,
    reasoning: r.verdict && r.verdict.reasoning,
    minimalRepro: r.verdict && r.verdict.minimalRepro,
  })),
  coverage: DIMENSIONS.map((d) => d.key),
  confirmedMismatches: confirmed.map((c) => ({
    dimension: c.dimension,
    title: c.mismatch.title,
    repro: c.verdict.minimalRepro || c.mismatch.repro,
    expected: c.verdict.expectedBytes,
    actual: c.verdict.actualBytes,
    reasoning: c.verdict.reasoning,
  })),
  reviews,
  critic,
}
