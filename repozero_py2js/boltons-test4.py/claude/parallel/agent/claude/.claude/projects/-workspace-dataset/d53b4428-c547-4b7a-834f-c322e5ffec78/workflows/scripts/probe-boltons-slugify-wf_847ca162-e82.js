export const meta = {
  name: 'probe-boltons-slugify',
  description: 'Black-box probe boltons.slugify + argparse behavior of /workspace/dataset/test4_executable across separators, Unicode casing, and CLI parsing',
  phases: [
    { title: 'Probe', detail: '5 parallel probes: separator set, degenerate results, Unicode lowercase diff, argparse matrix, help/usage bytes' },
    { title: 'Cross-check', detail: 'independent skeptic re-verifies each probe report against the executable' },
  ],
}

const RULES = `
HARD CONSTRAINTS (violating these invalidates your work):
- The ONLY way to observe Python behavior is running the precompiled binary:
    /workspace/dataset/test4_executable --a <value>
  It reads one required option --a and prints slugify(value).
- NEVER run \`python\`, \`python3\`, \`pip\`, or any Python interpreter. Do NOT try to read,
  extract, unpack, unzip, strings-dump, or decompile the executable or any .pyc/.py of
  boltons. This is a strict black-box exercise. Do not read /workspace/dataset/test4.py's
  dependencies. (Reading /workspace/dataset/test4.py itself is fine - it is 9 lines and
  already known.)
- Do NOT install anything (no pip/npm/apt).
- node v18.19.1 is available at /usr/bin/node for computing expectations in JS.
- Write scratch files ONLY under /tmp/probe-<yourname>/. Do not write to /output.
- When passing tricky bytes as an argument, avoid shell quoting bugs: prefer driving the
  binary from a node script with child_process.spawnSync('/workspace/dataset/test4_executable',
  ['--a', value], {encoding:'buffer'}) so the exact bytes are passed with no shell involved.
  ALWAYS compare raw bytes (hex), never rendered terminal text.
- Verify every claim you make by actually running the binary. Report only measured facts,
  and mark anything you inferred but did not measure as INFERRED.
`;

const ALREADY_KNOWN = `
Facts already measured by the lead (you may re-verify, but do not spend your budget re-deriving):
- slugify(text) with defaults behaves like: split text on runs of a "separator set",
  drop empty pieces, join with "_", then Python str.lower().
- Separator set = ASCII punctuation EXCEPT backslash, PLUS ASCII whitespace
  (space \\t \\n \\r \\x0b \\x0c). Backslash 0x5C is NOT a separator. DEL 0x7F is not.
  U+00A0 NBSP, U+2003 EM SPACE, U+2014 EM DASH, U+00B7 MIDDLE DOT are NOT separators.
- Non-empty input consisting ENTIRELY of separators returns exactly "_" (one underscore),
  e.g. "!" -> "_", "!!!" -> "_", "  " -> "_", "\\t" -> "_".
  But EMPTY input "" returns "" (prints just a newline). This asymmetry is confirmed.
- Python's str.lower() DOES apply the Unicode Final_Sigma rule: "ΟΔΟΣ" -> "οδος" with
  U+03C2 final sigma. Lowercasing happens AFTER the "_" join.
- 'İ' U+0130 -> "i" + U+0307. 'ẞ' U+1E9E -> 'ß'.
- argparse: prog name in usage is "test4_executable"; --help exits 0; missing --a exits 2;
  "--a=VALUE" works; "--a -5" takes "-5" as the value; "--a -x" errors; repeated --a: last wins;
  "--hel" abbreviates --help.
`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'rules', 'evidence', 'surprises', 'confidence'],
  properties: {
    area: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, implementable rules. Each must be stated so a JS implementer can code it with no guessing.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'measured'],
        properties: {
          rule: { type: 'string' },
          measured: { type: 'boolean', description: 'true if directly measured against the binary, false if inferred' },
        },
      },
    },
    evidence: {
      type: 'array',
      description: 'Concrete measured cases. Use hex for input and output bytes so nothing is ambiguous.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['inputHex', 'stdoutHex', 'exitCode'],
        properties: {
          inputHex: { type: 'string', description: 'UTF-8 hex of the --a value, or a description like "<no args>"' },
          stdoutHex: { type: 'string' },
          stderrText: { type: 'string' },
          exitCode: { type: 'integer' },
          note: { type: 'string' },
        },
      },
    },
    surprises: { type: 'array', items: { type: 'string' }, description: 'Anything that contradicts the already-known facts or a naive implementation' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};

const PROBES = [
  {
    key: 'separators',
    prompt: `Determine the EXACT separator set used by slugify, for the full Unicode range.

Method: for a codepoint C, run the binary with value "a" + C + "b" (a, C, b concatenated).
 - if output is "a_b" -> C is a separator
 - if output is "aCb" (with C possibly lowercased) -> C is NOT a separator
 - anything else -> report it as a surprise
Batch aggressively to keep runtime sane: you may test MANY codepoints in ONE invocation by
building a value like "a"+C1+"b" + "\\u0001" ... NO - control chars may themselves be separators.
Instead batch like this: value = "z" + C1 + "z" + "q" + C2 + "z" + "q" + ... is fragile.
The robust batching trick: pick a separator you have CONFIRMED (e.g. "!") as a batch delimiter,
and send value = "a"+C1+"b" + "!" + "a"+C2+"b" + "!" + ... The output is the pieces joined by "_",
so you can parse each piece back. Skip any C that is itself ASCII punctuation/whitespace
(test those individually, one invocation each - there are only ~38).
Coverage required:
 1. EVERY byte 0x00-0x7F individually (128 single invocations is fine, they are cheap).
 2. All of Latin-1 supplement 0x80-0xFF.
 3. A thorough sweep of Unicode punctuation/space blocks: U+2000-U+206F (general punctuation,
    includes all the space characters, line/paragraph separators U+2028/U+2029, U+200B ZWSP,
    U+FEFF BOM), U+3000 IDEOGRAPHIC SPACE, U+00A0, U+1680 OGHAM SPACE MARK, U+180E,
    U+2E00-U+2E7F, CJK punctuation U+3000-U+303F, fullwidth forms U+FF00-U+FF65
    (fullwidth ! " # etc.), U+0085 NEL.
 4. Check whether any NON-ASCII codepoint at all is a separator. This is the single most
    important question in your probe: report a definitive yes/no with evidence.
Also determine: does a run of MIXED different separators collapse to exactly one "_"?
Does a separator run at the very start/end get dropped entirely?
Report the separator set as an explicit sorted list of codepoints in your rules.`,
  },
  {
    key: 'degenerate',
    prompt: `Pin down the degenerate/empty-result rule with certainty, and find any other
special-casing. Known: "" -> "", but "!" -> "_", "!!!" -> "_", "   " -> "_".

Questions to answer with measurements:
 1. Is the fallback ALWAYS exactly one "_" regardless of how many separator chars the input has?
    Test lengths 1,2,3,5,17,100,1000 of separators, both homogeneous ("!!!!") and mixed ("! .,;").
 2. Does the fallback depend on WHICH separator? Test each separator char alone (space, tab,
    newline, CR, VT, FF, and every punctuation char).
 3. Is there any input, other than "", that produces empty output? Try hard to find one.
    (e.g. control chars, U+0000, lone surrogates, U+FEFF, combining marks alone,
    a value that is only characters whose lowercase is empty - does any such char exist?)
 4. What about a value containing a NUL byte (0x00) in the middle - does argparse/Python
    accept it, and is NUL a separator? Report exit code and bytes.
 5. Very long input (e.g. 200000 chars) - any truncation? Confirm no.
 6. Does the output ever contain a trailing/leading "_" for non-degenerate input? Try hard
    to produce one.
 7. Is the joined delimiter always exactly one "_" between words, even for a 50-char separator run?
Formulate the final rule as an exact algorithm.`,
  },
  {
    key: 'casing',
    prompt: `Differentially test Python str.lower() (as observed through the binary) against
Node v18's String.prototype.toLowerCase(), over the ENTIRE Unicode range, and report every
codepoint where they disagree.

Method (do this with a node driver script for speed and byte-exactness):
 - Enumerate all codepoints 0x00..0x10FFFF, skipping surrogates 0xD800-0xDFFF.
 - Keep only "interesting" ones: cp where String.fromCodePoint(cp).toLowerCase() !== String.fromCodePoint(cp)
   PLUS a large random/systematic sample of the rest (at least 20000 spread over all planes,
   including CJK, Hangul, emoji, Deseret/Osage/Adlam/Vithkuqi/Warang Citi/Medefaidrin/
   Old Hungarian/Cherokee-supplement which are astral cased scripts).
 - Also skip codepoints that are separators (ASCII punct/ws) since they vanish.
 - Batch: build a value of the form W1 + "!" + W2 + "!" + ... where each Wi is a single test
   codepoint (or a small designed cluster). The binary returns the pieces joined by "_".
   Then in Node compute the EXPECTED output as: pieces.join("_").toLowerCase() and compare
   byte-for-byte against the binary's stdout. Use batches of ~300-800 codepoints and watch
   out for OS argv length limits (~128KB per arg is fine, but stay under 100KB).
   IMPORTANT: compute the expectation as .toLowerCase() of the WHOLE joined string, not
   per-piece, so context-sensitive rules are exercised identically.
 - When a batch mismatches, bisect it down to the individual codepoint(s) responsible and
   verify each one with a single dedicated invocation. Report each disagreeing codepoint with
   its Python bytes and its Node bytes.
Additionally, hand-test these context-sensitive / multi-char cases explicitly and report bytes:
 - Final sigma: "ΟΔΟΣ", "ΣΣ", "ΑΣ", "Σ", "ΑΣΒ", "ΑΣ'" (apostrophe is a separator!),
   "ΑΣ" + U+0345, "ΑΣ" + combining acute U+0301, "ΑΣ" + U+00AD SOFT HYPHEN,
   and crucially "ΟΔΟΣ FOO" (which becomes "ΟΔΟΣ_FOO" BEFORE lowercasing - is the sigma
   final there? "_" is uncased and not case-ignorable, so it should be. VERIFY.)
 - U+0130 İ, U+0131 ı, U+0049 I, U+00DF ß, U+1E9E ẞ, U+0149, U+01F0, U+1F88-U+1FFC
   (Greek with ypogegrammeni - these have multi-char lowercase), U+1E96-U+1E9A,
   U+0587, U+FB00-U+FB17 ligatures, U+1FD3, U+1FE3, U+0390, U+03B0.
 - Cherokee U+13A0-U+13F5 and U+AB70-U+ABBF (Cherokee is the famous case where lowercase
   mappings were ADDED in Unicode 8 - a version skew between Python and V8 would show here).
 - Recently-added cased scripts: U+10D0? no - use Georgian Mtavruli U+1C90-U+1CBA,
   U+A7C0-U+A7CA, U+A7D0-U+A7DC, U+A7F5, U+10570-U+105BC Vithkuqi, U+16E40 Medefaidrin,
   U+1E900 Adlam, U+104B0 Osage, U+118A0 Warang Citi, U+10C80 Old Hungarian,
   U+10400 Deseret, U+1E7E0 Ethiopic ext.
 - Also test the Turkish/Lithuanian-sensitive ones to confirm NEITHER applies locale rules.
Your deliverable: a definitive statement of whether Node's toLowerCase can be used verbatim,
plus the complete list of exceptions (if any) that a JS implementation must patch, each with
input codepoint -> exact expected output codepoints.`,
  },
  {
    key: 'argparse',
    prompt: `Map the complete argparse CLI contract as a decision procedure precise enough to
reimplement by hand in JS. For each case report argv, exit code, exact stdout bytes, exact
stderr text.

Cases to cover (add more you think of):
 - no args; --a alone; --a with value; --a=value; --a= ; -a x (single dash - is it accepted?);
   --a x y; x --a y; --a x --a y (last wins?); --a=x --a y
 - abbreviations: --a is the full name; is there any other prefix that resolves? try --, -,
   --h, --he, --hel, --help, --hELP, -h, -hx, -h --a x, --a x -h (does -h short-circuit and
   exit 0 BEFORE the required check?), --help --a  (help before required check?)
 - value that looks like an option: --a -x, --a --a, --a -1, --a -1.5, --a -1e5, --a -.5,
   --a -5x, --a "-", --a "--", --a " -x" (leading space), --a=-x  (equals form with dash value)
   Determine argparse's exact rule for "does this token count as a value or as an option".
   The rule involves: token starts with '-'; is it a single '-'; does it look like a negative
   number and does the parser have any option that looks like a negative number; does it
   contain a space. State the rule precisely.
 - the "--" separator: -- --a x ; --a x -- ; --a -- x ; -- ; --a x -- y
 - unknown options: --b, --b=1, -z, --a x --b, and whether the "required" error or the
   "unrecognized arguments" error wins when both apply. Also the exact ORDER/format when
   multiple extras are unrecognized (--a x p q -> one message listing both?).
 - Does it read stdin or env vars at all? (COLUMNS env var can change usage wrapping - test
   COLUMNS=20 and COLUMNS=200 with --help and confirm whether wrapping changes; report.)
 - Exact --help output bytes, and exact usage line used in error messages. Note the exact
   header ("options:" vs "optional arguments:"), indentation and blank lines.
 - Is stdout or stderr used for each? Confirm --help goes to stdout, errors to stderr.
Give the final deliverable as an ordered algorithm: how to scan argv left to right, what to
do at each token, which error to raise first.`,
  },
  {
    key: 'output',
    prompt: `Nail the exact OUTPUT formatting and any encoding behavior.

 1. Confirm print() adds exactly one trailing "\\n" (0x0A) and nothing else, for: normal
    output, empty output, output containing multibyte UTF-8, and very long output.
 2. Is stdout UTF-8 encoded? Test a value with characters outside BMP (emoji, U+10400) and
    astral chars that survive slugify, and confirm the exact bytes are UTF-8 (4-byte sequences,
    not surrogate pairs / CESU-8).
 3. What happens with invalid UTF-8 in the argument bytes? e.g. pass raw bytes 0xFF, 0x80,
    0xC3 (truncated), 0xED 0xA0 0x80 (encoded surrogate). Python decodes argv with
    surrogateescape - report the exit code and the exact stdout bytes for each. Determine
    whether the lone surrogate round-trips back to the original byte on output, or whether it
    raises UnicodeEncodeError (check exit code and stderr).
 4. Test a value containing an actual lone surrogate expressible only via invalid UTF-8, and
    also U+FFFD.
 5. Does any output ever go through NFC/NFD normalization? Test a decomposed sequence
    (e.g. "A" + U+0301 vs U+00C1) and confirm both are preserved distinctly (lowercased).
 6. Confirm no BOM, no CR, no ANSI codes, and that TERM/locale env vars don't change output:
    try LANG=C, LC_ALL=C, PYTHONIOENCODING unset/set to ascii, with a non-ASCII value.
    Report whether LC_ALL=C changes the output bytes or causes an error - this matters.
Report exact bytes for everything.`,
  },
];

phase('Probe');
const reports = await pipeline(
  PROBES,
  p => agent(`${RULES}\n${ALREADY_KNOWN}\n\nYOUR PROBE AREA: ${p.key}\n\n${p.prompt}`,
    { label: `probe:${p.key}`, phase: 'Probe', schema: SCHEMA, effort: 'high' }),
  (rep, p) => rep == null ? null : agent(
    `${RULES}\n\nA prior agent probed the "${p.key}" behavior of /workspace/dataset/test4_executable and produced this report:\n\n` +
    JSON.stringify(rep) +
    `\n\nYou are an adversarial cross-checker. Your job is to FIND ERRORS in it. Independently re-run the binary to test its most load-bearing and most surprising claims, plus at least 8 cases the report did NOT cover in this area. Treat any rule marked measured:true but which you cannot reproduce as a defect. Report the CORRECTED, verified rule set for this area - keep the rules that survive, fix the ones that are wrong, and add what was missed. Be concrete and byte-exact.`,
    { label: `crosscheck:${p.key}`, phase: 'Cross-check', schema: SCHEMA, effort: 'high' })
    .then(v => ({ area: p.key, initial: rep, verified: v })),
);

return reports.filter(Boolean);
