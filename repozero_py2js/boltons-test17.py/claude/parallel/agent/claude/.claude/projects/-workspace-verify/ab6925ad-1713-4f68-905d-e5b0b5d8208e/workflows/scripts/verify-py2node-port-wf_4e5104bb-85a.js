export const meta = {
  name: 'verify-py2node-port',
  description: 'Differentially verify the Node port of test17.py against the Python executable, adversarially review the code, then critique coverage',
  phases: [
    { title: 'Probe', detail: 'one agent per input modality: generate cases, diff Python vs Node' },
    { title: 'Review', detail: 'adversarial code review across compliance/correctness/spec lenses' },
    { title: 'Critique', detail: 'completeness critic over everything found' },
  ],
}

const HARNESS = `
The Python reference program is /workspace/dataset/test17_executable and the Node
port is /output/test17.mjs (run as: node /output/test17.mjs --a VALUE).

A differential harness already exists:
  node /workspace/verify/diff.mjs <cases.json>
where cases.json is a JSON array of argv arrays, e.g.
  [["--a","helloWorld,foo_bar"],["--a",""],[]]
It spawns both programs with an explicit argv array (NO shell), so control
characters, quotes, backslashes and newlines reach both untouched. It compares
stdout, stderr and exit status byte-for-byte, normalising only the program-name
token (the executable is named test17_executable, the script test17.mjs -- that
difference is EXPECTED and must not be reported as a finding).

Your job: write a cases file to a UNIQUE path under /tmp, run the harness, and
report only REAL mismatches. Generate the cases file with a small Node script
(node -e '...' writing JSON via fs.writeFileSync) so you can emit exotic code
points precisely with String.fromCodePoint -- never paste raw control characters
into a shell command.

Keep your file to at most ~250 cases so the run finishes promptly. If the
harness reports mismatches, re-run a minimised case to confirm it reproduces,
and report the exact argv, the Python output and the Node output.

Do NOT edit any files under /output. You are verifying, not fixing.
`

const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string' },
    casesRun: { type: 'integer' },
    casesMatched: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          argvEscaped: { type: 'string', description: 'JSON-escaped argv so exotic bytes survive' },
          pythonOutput: { type: 'string' },
          nodeOutput: { type: 'string' },
          diagnosis: { type: 'string' },
        },
        required: ['argvEscaped', 'pythonOutput', 'nodeOutput', 'diagnosis'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['category', 'casesRun', 'casesMatched', 'mismatches'],
}

const MODALITIES = [
  {
    key: 'camel-case-boundaries',
    prompt: `Probe camel2under/under2camel boundary behaviour with ASCII input: runs of
capitals (ABCDef, HTTPServer, XMLHttpRequest), digits next to capitals (x1Y2z,
a1B, 9Z, Z9a), single characters, leading/trailing/repeated underscores
(_a, a_, __, a__b, _, ___), strings that are only underscores or only capitals,
alternating caps (aBaBaB), mixed underscore+camel (foo_barBaz), and strings
whose camel2under result then round-trips through under2camel. Also cover the
first/last-element and slice-of-3 code paths by varying the number of
comma-separated fields from 1 to 6.`,
  },
  {
    key: 'punctuation-whitespace',
    prompt: `Probe slugify's separator set. Test EVERY ASCII punctuation character
individually as part of a field (! " # $ % & ' ( ) * + , - . / : ; < = > ? @
[ ] ^ _ backtick { | } ~ and BACKSLASH), runs of mixed punctuation, leading and
trailing punctuation, fields that are entirely punctuation, and ASCII whitespace
(space, tab, newline, carriage return, vertical tab U+000B, form feed U+000C).
Pay special attention to the backslash: verify whether it acts as a separator,
including doubled and tripled backslashes and a backslash adjacent to ']'.
Note the comma is the field separator so it splits input before slugify sees it.`,
  },
  {
    key: 'unicode-case-mapping',
    prompt: `Probe Unicode case mapping through camel2under (lower), under2camel
(capitalize) and the upper-cased-keys mapping. Cover: U+00DF sharp s, U+1E9E
capital sharp s, U+0130 and U+0131 dotted/dotless I, Greek sigma in final and
medial position (U+03A3, U+03C2, U+03C3), the Latin digraphs U+01C4..U+01CC and
U+01F1..U+01F3, the Greek ypogegrammeni ranges U+1F80..U+1FFC, U+0149,
U+01F0, U+0390, U+03B0, the ligatures U+FB00..U+FB06 and U+FB13..U+FB17,
U+0587, U+1E96..U+1E9A, U+1F50..U+1F56, Cherokee U+13A0/U+AB70, Deseret
U+10400/U+10428, accented Latin, and Cyrillic. Test each both as the FIRST
character of a field (which exercises capitalize's title mapping) and in the
middle.`,
  },
  {
    key: 'astral-and-combining',
    prompt: `Probe non-BMP and combining-mark handling, which is where UTF-16 vs
code-point semantics diverge (the length mapping prints len(v) and repr must not
split a surrogate pair). Cover: emoji including ZWJ sequences and skin-tone
modifiers, flags (regional indicators), U+10000, U+1D400 mathematical alphanumerics,
U+20000 CJK ext B, U+10FFFF, astral characters adjacent to ASCII capitals and to
underscores, combining diacritics (U+0301, U+0345, U+0342), long combining
sequences, and variation selectors U+FE0F / U+E0100. Verify the printed length
mapping counts code points, not UTF-16 units.`,
  },
  {
    key: 'nonprintable-repr',
    prompt: `Probe Python repr escaping, which drives every printed line. Cover: all C0
controls U+0000..U+001F (note U+0000 cannot be passed in an argv value -- skip it
and say so), U+007F, C1 controls U+0080..U+009F, U+00A0, U+00AD soft hyphen,
U+061C, U+200B..U+200F, U+2028 line separator, U+2029 paragraph separator,
U+202F, U+205F, U+3000, U+FEFF, U+FFF9..U+FFFB, private use U+E000 and U+F8FF and
U+100000, unassigned code points (e.g. U+0378, U+0380, U+05EB, U+2FE0), tag
characters U+E0001, and combining marks (which ARE printable). Also cover quote
selection: fields containing only a single quote, only a double quote, both, and
backslash+quote combinations.`,
  },
  {
    key: 'argparse-surface',
    prompt: `Probe the command-line parsing surface exhaustively. Cover: no arguments at
all; --a with and without a value; --a=value including --a= (empty); repeated
--a (last should win); every abbreviation of --help (--h, --he, --hel, --help)
and of --a; -h alone, -h before and after --a, -h as the value position;
single-dash forms (-a, -a z, -ab); over-long forms (--ab, --ab=z, --aa);
triple dash (---a, ---a=z); bare "-" and bare "--" as values and as standalone
tokens; "--" followed by more tokens; extra positional tokens before and after
--a; unknown options mixed with valid ones; negative numbers as values (-5,
-5.5, -0, -.5, -5., -1e3, --5); values containing a space and a leading dash
("-x y"); values that look like options but contain '='; and the empty string as
a standalone token. Check exit status AND stderr text for every case.`,
  },
  {
    key: 'dict-structure',
    prompt: `Probe the dictionary/mapping half of the program (results 16-20), where key
collision and ordering matter. Cover: repeated fields so dict(zip(...)) collapses
(a,a / a,b,a / a,a,b,b / many repeats) and verify the surviving key keeps its
FIRST position with the LAST value; fields that are distinct but collide after
upper() (a,A / abc,ABC / i,I with dotted-I variants / U+00DF vs ss); fields that
collide after camel2under (aB,a_b / AB,ab); empty fields in every position
(",a", "a,", ",", ",,", "a,,b"); a single field; 1 to 8 fields; long fields; and
fields whose camel2under value is empty. Confirm the FrozenDict repr, including
the empty-ish cases.`,
  },
  {
    key: 'fuzz-ascii',
    prompt: `Random-fuzz with printable ASCII. Generate ~220 cases where each case is a
random number (1-5) of comma-separated fields, each field 0-12 characters drawn
uniformly from the printable ASCII range U+0020..U+007E (include the comma in the
alphabet so field counts vary too). Use a fixed seed via a simple deterministic
PRNG so the run is reproducible, and print the seed in your notes.`,
  },
  {
    key: 'fuzz-unicode',
    prompt: `Random-fuzz across the whole Unicode range. Generate ~220 cases where each
case is a random number (1-4) of comma-separated fields, each field 0-8 code
points drawn from a mix of: ASCII letters/digits/punctuation, Latin-1, Greek,
Cyrillic, CJK, Hangul, combining marks, format characters, unassigned code
points, private use, and astral planes 1-2 and 16. Skip U+0000 (cannot appear in
an argv value) and skip lone surrogates U+D800..U+DFFF (not encodable). Use a
fixed seed via a deterministic PRNG and print the seed in your notes.`,
  },
  {
    key: 'scale-and-shape',
    prompt: `Probe scale and unusual shapes: a single field of 5000 characters; 200
comma-separated fields; 1000 empty fields (i.e. many consecutive commas); fields
that are one character each; a value that is nothing but commas; a value that is
nothing but underscores; a value mixing very long and empty fields; deeply
repeated patterns like "aB" times 500; and a value whose joined form crosses the
camel boundary at the seam between fields (so that joining changes the result,
e.g. "foo","Bar" joins to "fooBar"). Verify the joined-conversion results 9, 10
and 11 specifically -- result 11 replaces every space with an underscore, so
include fields with MULTIPLE spaces to catch a replace-first-only bug.`,
  },
]

phase('Probe')
const probes = await parallel(
  MODALITIES.map((modality) => () =>
    agent(
      `You are differentially verifying a Python-to-Node.js port.\n\n${HARNESS}\n\nYour assigned modality: ${modality.key}\n\n${modality.prompt}`,
      { label: `probe:${modality.key}`, phase: 'Probe', schema: PROBE_SCHEMA, agentType: 'general-purpose' },
    ),
  ),
)

const found = probes.filter(Boolean)
const allMismatches = found.flatMap((probe) =>
  (probe.mismatches || []).map((m) => ({ ...m, category: probe.category })),
)
const totalRun = found.reduce((sum, p) => sum + (p.casesRun || 0), 0)
const totalMatched = found.reduce((sum, p) => sum + (p.casesMatched || 0), 0)
log(`Probe phase: ${found.length}/${MODALITIES.length} modalities reported, ${totalMatched}/${totalRun} cases matched, ${allMismatches.length} mismatches`)
for (const probe of found) {
  if ((probe.mismatches || []).length > 0) {
    log(`  ${probe.category}: ${probe.mismatches.length} mismatch(es)`)
  }
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          summary: { type: 'string' },
          failureScenario: { type: 'string', description: 'Concrete input reaching wrong output, or the exact requirement violated' },
          reproCommand: { type: 'string', description: 'A command that demonstrates it, or empty if static-only' },
        },
        required: ['file', 'severity', 'summary', 'failureScenario'],
      },
    },
    verdict: { type: 'string' },
  },
  required: ['lens', 'findings', 'verdict'],
}

const REQUIREMENTS = `
The deliverable is the /output directory. The task's hard requirements:
  1. Pure JavaScript for the Node.js runtime.
  2. ES Modules ONLY: import/export. require() and module.exports are strictly
     prohibited anywhere.
  3. Every generated library file and the entry file must use the .mjs suffix,
     and every relative import must include the full file suffix.
  4. Command-line argument handling must match the Python file exactly (same
     option name --a, same required flag, same default), parsed by hand from
     process.argv.
  5. Output must match Python's print byte-for-byte, including spaces/newlines.
  6. ZERO external dependencies. No npm packages. Only node: builtin modules and
     local relative files may be imported. No embedded Python. No shelling out
     to python or to the reference executable.
  7. Libraries split into multiple modules by functionality, exposing interfaces
     via export; the entry file is /output/test17.mjs.

The Python source is /workspace/dataset/test17.py. The reference executable is
/workspace/dataset/test17_executable (you may run it to check behaviour).
Do NOT edit anything; report findings only.
`

const LENSES = [
  {
    key: 'requirements-compliance',
    prompt: `Audit /output against the hard requirements mechanically. Verify: every file
under /output ends in .mjs; no occurrence of require( or module.exports or
exports. anywhere; every import specifier is either a node: builtin or a relative
path ending in .mjs; no bare package specifiers; no dynamic import of anything
external; no child_process/python invocation in the shipped code; the entry file
is exactly /output/test17.mjs; and the library really is split into multiple
modules with exported interfaces rather than one blob. Use grep/ls to prove each
claim and quote the evidence. Also confirm nothing in /output imports from
outside /output.`,
  },
  {
    key: 'correctness-latent-bugs',
    prompt: `Hunt latent correctness bugs in the /output modules by reading them closely.
Focus on the seams where JS and Python disagree: UTF-16 versus code points
(len, iteration, slicing, indexing); String.replace replacing only the first
occurrence versus Python's replace-all; regex flags (u, g, m) and whether a
stateful /g regex is reused across calls; truthiness translations of Python's
"x and y or z" idiom; Map insertion-order and key-collision semantics versus
Python dict; class field initialisation order and whether a frozen subclass's
own constructor path is blocked by its immutability guard; padStart/padEnd on
strings containing astral characters; and off-by-one in any slice. For each
suspected bug, construct a concrete input and actually run both programs to
confirm or refute it before reporting.`,
  },
  {
    key: 'spec-conformance',
    prompt: `Read /workspace/dataset/test17.py and /output/test17.mjs side by side and
verify semantic equivalence statement by statement, all 20 results plus the two
groups. Check specifically: the split on ',' ; strings[0] and strings[-1]
indexing; strings[:3] slicing; ''.join and '_'.join; len(strings) versus
len(strings[:3]); result9.replace(' ', '_') replacing EVERY space; the fixed
literals 'TestString' and 'Test String!' ; the dict(zip(strings, result1))
construction; and each of the four dict comprehensions (reversed, length,
upper-cased keys, slugified values) including which side of the pair each
function applies to. Also verify print order and that nothing extra is printed.
Report any statement whose translation could diverge for some input, with the
input that would expose it.`,
  },
]

phase('Review')
const reviews = await parallel(
  LENSES.map((lens) => () =>
    agent(
      `You are adversarially reviewing a Python-to-Node.js migration.\n\n${REQUIREMENTS}\n\nYour assigned lens: ${lens.key}\n\n${lens.prompt}\n\nBe skeptical but precise: only report what you can demonstrate. Prefer running a command over speculating.`,
      { label: `review:${lens.key}`, phase: 'Review', schema: REVIEW_SCHEMA, agentType: 'general-purpose' },
    ),
  ),
)

const reviewed = reviews.filter(Boolean)
const allFindings = reviewed.flatMap((r) => (r.findings || []).map((f) => ({ ...f, lens: r.lens })))
log(`Review phase: ${reviewed.length}/${LENSES.length} lenses reported, ${allFindings.length} findings`)

phase('Critique')
const critique = await agent(
  `You are the completeness critic for a Python-to-Node.js migration verification.

Here is everything the verification found.

DIFFERENTIAL PROBES (${totalMatched}/${totalRun} cases matched):
${JSON.stringify(found, null, 2)}

CODE REVIEWS:
${JSON.stringify(reviewed, null, 2)}

${REQUIREMENTS}

${HARNESS}

Your job is to find what is MISSING, not to repeat what was found. Ask:
which input modality was never exercised? which behaviour of the Python program
is asserted but never actually observed? which requirement was checked only by
assertion and not by evidence? did any probe agent silently reduce its coverage
or skip cases it claimed to run? is any reported mismatch actually the expected
program-name difference (a false positive)?

Then ACT on the biggest gap yourself: build a cases file and run
/workspace/verify/diff.mjs to close it. Do not edit anything under /output.

Report: the gaps you identified, what you ran to close the biggest one, its
result, and a final judgement on whether the port is verified.`,
  { label: 'critique', phase: 'Critique', schema: {
    type: 'object',
    properties: {
      gaps: { type: 'array', items: { type: 'string' } },
      falsePositives: { type: 'array', items: { type: 'string' } },
      gapClosed: { type: 'string' },
      casesRun: { type: 'integer' },
      casesMatched: { type: 'integer' },
      newMismatches: { type: 'array', items: { type: 'string' } },
      judgement: { type: 'string' },
    },
    required: ['gaps', 'gapClosed', 'judgement'],
  }, agentType: 'general-purpose' },
)

return {
  probeTotals: { casesRun: totalRun, casesMatched: totalMatched },
  mismatches: allMismatches,
  reviewFindings: allFindings,
  critique,
}
