export const meta = {
  name: 'py2js-bech32-migrate',
  description: 'Build and adversarially verify a Node ESM port of a Python bech32_decode CLI',
  phases: [
    { title: 'Build', detail: 'implement hierarchical .mjs modules in /output' },
    { title: 'Audit', detail: 'differential fuzz + compliance + spec review in parallel' },
    { title: 'Fix', detail: 'apply confirmed defects and re-verify' },
    { title: 'Confirm', detail: 'independent final differential sweep' },
  ],
}

const SPEC = `
# TASK CONTEXT (already established by black-box probing — trust but you MAY re-verify)

Port /workspace/dataset/test2.py to Node.js ESM. The Python source is:

  import argparse, bech32
  def main():
      parser = argparse.ArgumentParser()
      parser.add_argument("--a", type=str, required=True)
      args = parser.parse_args()
      result = bech32.bech32_decode(args.a)
      print(result)
  if __name__ == "__main__": main()

Reference executable (ground truth, runnable): /workspace/dataset/test2_executable --a VALUE
NEVER run 'python'. Only run the executable.

## CONFIRMED DECODE SEMANTICS (verified empirically)
CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"  (index = 5-bit value)
GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

bech32_decode(s) -> (hrp, data) or (None, None):
 1. If ANY character has code point < 33 or > 126 -> (None, None).
 2. If (lower(s) != s AND upper(s) != s)  [i.e. mixed case] -> (None, None).
 3. s = lower(s)
 4. pos = LAST index of '1' in s. If pos < 1 OR pos + 7 > len(s) -> (None, None).
 5. hrp = s[0:pos]. If len(hrp) > 83 -> (None, None).
    *** CRITICAL: this reference has NO total-length limit. A 5008-char input with a
    2-char hrp decodes FINE. The only length cap is hrp <= 83 chars. Do NOT add a
    "len > 90" check — that is stock pypi bech32 and would be WRONG here. Verified:
    hrp 83 -> OK, hrp 84 -> (None,None); total length 95/290/1008/5008 -> all OK. ***
 6. dataPart = s[pos+1:]. If any char of dataPart is not in CHARSET -> (None, None).
 7. data = [CHARSET.indexOf(c) for c in dataPart]
 8. Checksum: polymod(hrpExpand(hrp) + data) must == 1. This is BIP-173 bech32 ONLY.
    bech32m (constant 0x2bc830a3) must FAIL. Verified: taproot bc1p... -> (None,None).
 9. Return (hrp, data[0:len(data)-6])   (strip the 6 checksum values)

polymod(values): chk=1; for v: top=chk>>25; chk=((chk & 0x1ffffff) << 5) ^ v;
                 for i in 0..4: if (top>>i)&1: chk ^= GENERATOR[i]. return chk.
  Keep chk as an unsigned 32-bit value (use >>> 0) so long inputs stay correct.
hrpExpand(hrp): [ord(c)>>5 for c in hrp] + [0] + [ord(c)&31 for c in hrp]

## OUTPUT FORMATTING — must reproduce Python repr() of a tuple, byte-for-byte
print((None, None))        -> "(None, None)"
print(('bc', [0, 14, 20])) -> "('bc', [0, 14, 20])"
print(('a', []))           -> "('a', [])"
So: "(" + repr(hrp) + ", " + repr(list) + ")", list is "[" + ints joined by ", " + "]".
Python str repr rules (VERIFIED against the executable — hrp may contain any char 33..126,
including quotes and backslashes):
  - backslash -> escaped as two backslashes
  - if the string contains "'" and does NOT contain '"'  -> wrap in DOUBLE quotes, "'" unescaped
  - otherwise -> wrap in SINGLE quotes, and escape any "'" as \\'   ('"' is never escaped)
Verified examples (input -> exact stdout):
  "'1qpzsxhfks"   -> ("'", [0, 1, 2])
  '"1qt7wpe'      -> ('"', [])
  '\\\\1qpzhza68u'    -> ('\\\\', [0, 1, 2])         (hrp is one backslash, printed as two)
  '\\'"1qpz7wk0k3'  -> ('\\'"', [0, 1, 2])        (hrp is  '"  -> single-quoted, ' escaped)
  'x\\'y"z1qpzd3n6uh' -> ('x\\'y"z', [0, 1, 2])
Because only chars 33..126 can reach the hrp, no \\x / \\n / \\t escapes are reachable —
but implement a complete, correct repr anyway (defensive, and it costs nothing).
Trailing newline: print() adds exactly one "\\n". Output goes to stdout.

## ARGPARSE SEMANTICS (VERIFIED — must match stdout, stderr AND exit code)
prog name in all messages is literally: test2_executable
(The reference binary is named test2_executable; error/usage text must match it byte-for-byte.)

Usage line (used by both --help and errors):
  usage: test2_executable [-h] --a A

--help / -h  -> STDOUT, exit 0, exactly:
usage: test2_executable [-h] --a A

options:
  -h, --help  show this help message and exit
  --a A

(blank line after usage line; two-space indent for option lines; note "options:" not
"optional arguments:". Get the exact column alignment from the executable's own output.)

Errors -> STDERR, exit code 2, format:
  usage: test2_executable [-h] --a A
  test2_executable: error: <MESSAGE>
Messages observed:
  - missing required:  the following arguments are required: --a
  - "--a" with no value: argument --a: expected one argument
  - extra positional (when --a satisfied): unrecognized arguments: extra
  - "--help=x": argument -h/--help: ignored explicit argument 'x'

Key behaviors, all VERIFIED:
  * "--a V" and "--a=V" both work. "--a=" gives empty string value.
  * Repeated --a: LAST one wins.
  * -h/--help takes effect immediately when encountered, even if --a is missing, and even
    if it appears AFTER --a. Prints help to stdout, exit 0.
  * Long-option ABBREVIATION is enabled: --he, --hel, --h all resolve to --help.
    --a is an exact match. (Only --a and --help exist.)
  * Unknown option like "--b x": the error is "the following arguments are required: --a",
    NOT "unrecognized arguments" — because argparse's required-check fires before extras
    are reported. But "--a V extra" DOES report "unrecognized arguments: extra".
  * "--" is a separator: the first "--" is dropped and later args become positionals
    (which then become "unrecognized arguments", or trigger the required error).
    "-- --a V" -> required error. "--a -- V" -> "expected one argument".
  * A value starting with "-" is accepted as a value only if argparse would not read it
    as an option. Replicate argparse's _parse_optional order exactly:
      1. empty string -> value
      2. first char not "-" -> value
      3. exact match of a known option string -> that option
      4. length 1 (bare "-") -> value
      5. contains "=" and the part before "=" is a known option -> that option + explicit arg
      6. abbreviation/prefix search (_get_option_tuples): for "--xxx" match known long
         options that start with the given prefix (splitting on "=" first); for a
         single-dash string "-XY..." also treat "-X" as a candidate option with the rest
         as an explicit argument. If exactly one candidate -> that option. If several ->
         ambiguous-option error.
      7. matches negative-number regex ^-\\d+$|^-\\d*\\.\\d+$  -> value
      8. contains a space -> value
      9. otherwise -> treated as an UNKNOWN OPTION (so it is not consumed as a value)
    VERIFIED consequences: "--a -5", "--a -0.5", "--a -.5", "--a -", "--a +5",
    "--a -9999999999", "--a '-x y'", "--a '- x'", "--a '--foo bar'", "--a '--a b'"
    -> all ACCEPT the dash-string as the VALUE.
    "--a -5x", "--a -1e5", "--a -5.5.5", "--a --", "--a -ab", "--a -h", "--a --help"
    -> all ERROR "argument --a: expected one argument".
    ("-h x" as a value errors because "-h" is a known short option with " x" as explicit arg.)

## ENGINEERING REQUIREMENTS (hard constraints — violation invalidates the answer)
 - Node.js, PURE ESM: use import/export ONLY. "require()" and "module.exports" are
   STRICTLY PROHIBITED anywhere.
 - ALL files use the .mjs suffix. All relative imports MUST include the .mjs extension.
 - ZERO external/npm dependencies. Do NOT import any bare module specifier at all —
   not even Node builtins are needed for this task (no node:fs, no node:process import
   is required; use the global "process"). Only relative local imports ("./x.mjs").
 - Do NOT embed or invoke Python.
 - STRICTLY PROHIBITED: any use or even MENTION of Uint8Array or DataView (or Buffer,
   or typed arrays of any kind) anywhere in the code or comments. Use plain Arrays,
   Strings and Numbers only.
 - Hierarchical structure: split the library into MULTIPLE modules by responsibility
   under /output/lib/, each exporting a clean interface. Entry point is /output/test2.mjs.
   Suggested split (you may refine): lib/charset.mjs (alphabet + generator constants),
   lib/checksum.mjs (polymod, hrpExpand, verifyChecksum), lib/validate.mjs (character,
   case and structural predicates), lib/bech32.mjs (bech32Decode public API),
   lib/pyrepr.mjs (Python repr/print emulation), lib/argparse.mjs (argparse-compatible
   parser), lib/cli.mjs (wiring: parse -> decode -> print).
 - Code must be clean and readable, with comments explaining Python-fidelity decisions.
 - Iterate the input by CODE POINT (Python iterates code points, JS strings are UTF-16).

## TEST HARNESS (already built — use it)
 - node /tmp/harness/diff.mjs /output/test2.mjs
     Runs 1302 value vectors + 65 argv cases against a cached golden baseline captured
     from the real executable, comparing stdout, stderr and exit code byte-for-byte.
     Prints "checked N, mismatches M" and exits non-zero if any mismatch.
 - /tmp/harness/encode.mjs exports enc(hrp, data) / encM(hrp, data) to MINT NEW valid
   bech32 (and bech32m) strings for fresh test cases. Import it with a relative path.
 - You can always run the executable directly to settle any question.
`

phase('Build')
const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'diffResult', 'notes'],
  properties: {
    files: { type: 'array', items: { type: 'string' }, description: 'absolute paths written' },
    diffResult: { type: 'string', description: 'final line of the diff harness output' },
    notes: { type: 'string', description: 'design decisions and anything unresolved' },
  },
}

const build = await agent(
  `You are implementing a Python-to-Node.js migration. ${SPEC}

Write the complete implementation now, to /output (create /output/lib/ as needed).
Then run: node /tmp/harness/diff.mjs /output/test2.mjs
Iterate on your code until it reports "mismatches 0". Investigate every mismatch by
running the real executable on that exact input. Do not stop while mismatches remain.
Also self-check the hard constraints: grep your own output for "require(", "module.exports",
"Uint8Array", "DataView", "Buffer", and for any non-relative import — all must be absent.
Return the list of files written, the final diff harness line, and your notes.`,
  { label: 'implement', schema: BUILD_SCHEMA }
)

log(`build: ${build?.diffResult ?? 'FAILED'}`)

phase('Audit')
const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'detail', 'repro', 'severity'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          detail: { type: 'string' },
          repro: { type: 'string', description: 'exact command showing reference vs candidate divergence, or the constraint violated' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
        },
      },
    },
  },
}

const AUDITS = [
  {
    key: 'fuzz-decode',
    prompt: `Adversarially fuzz the bech32 DECODE logic of the candidate at /output/test2.mjs
against the reference /workspace/dataset/test2_executable.
Write your OWN new generator (in /tmp, not /output) — do NOT just re-run the existing harness.
Mint thousands of fresh inputs with /tmp/harness/encode.mjs and by hand:
hrp length exactly 1/2/82/83/84/85; every printable char 33..126 as a 1-char hrp; hrp
containing '1' in many positions; data length 0/1/5/6/7 and very long (500, 2000, 10000);
total length far beyond 90 (the reference has NO 90-char cap — confirm this holds);
bech32m-checksummed strings (must all be (None,None)); every single-character mutation of
several valid strings; all-uppercase and all-lowercase forms; strings whose only '1' is at
index 0; strings with no '1'; empty string. Compare stdout+stderr+exit code byte-for-byte.
Report ONLY real divergences you actually observed, with the exact reproducing command.`,
  },
  {
    key: 'fuzz-argparse',
    prompt: `Adversarially fuzz the ARGUMENT PARSING of /output/test2.mjs against
/workspace/dataset/test2_executable. Invent NEW argv combinations beyond the existing
harness: option abbreviations (--h, --he, --hel, --help, --a, --aa, --a=, -a, -A, --A);
"=" forms including --a==, --a=--a, --help=1, -h=1; "--" in every position; -h and --help
before/after/instead of --a; repeated and conflicting --a; extra positionals in every
position; values that look like options ("-5", "-.5", "-1e5", "-", "--", "-x", "-h",
"-hq", "--foo", "--a", "-x y", "- x", "--foo bar", "+5", "", " "); interleavings like
"--a --a --a V"; unknown options with and without --a present. Compare stdout, stderr AND
exit code byte-for-byte for each. Report ONLY divergences you actually reproduced, with
the exact command.`,
  },
  {
    key: 'fuzz-repr',
    prompt: `Adversarially verify the PYTHON repr()/print() FORMATTING of /output/test2.mjs.
The hrp can be any string of chars 33..126, which includes single quote, double quote and
backslash — Python's repr() switches quoting style and escapes backslashes. Use
/tmp/harness/encode.mjs to MINT valid bech32 strings whose hrp is specifically chosen to
stress repr: "'", '"', backslash, "''", '""', combinations of quote+backslash in many
orders and lengths (e.g. \\\\', '\\\\, "\\\\", '"', \\\\'", multiple backslashes in a row),
plus every printable char as hrp. Also stress the data list rendering: empty list,
single element, elements 0 and 31, long lists (verify separator is exactly ", ").
Compare candidate stdout to the executable's stdout byte-for-byte (use a byte-level diff,
e.g. compare with od/xxd or JSON.stringify — not a visual eyeball).
Report ONLY divergences you actually reproduced, with the exact command.`,
  },
  {
    key: 'compliance',
    prompt: `Audit /output for HARD CONSTRAINT compliance. Read every file there.
Verify ALL of the following and report each violation as a finding:
 1. Every file has the .mjs suffix; entry point is /output/test2.mjs.
 2. Pure ESM: no "require(" and no "module.exports" anywhere.
 3. Every relative import includes the explicit .mjs extension and resolves to a file
    that actually exists (check each import path).
 4. NO bare/external module specifiers imported at all (no npm packages; also flag any
    "node:" builtin import and report it as a finding, since the task requires only
    local relative imports).
 5. No use OR MENTION of Uint8Array, DataView, Buffer, or any typed array — including in
    comments. This is explicitly prohibited. grep for each.
 6. No Python embedded or invoked (no child_process, no spawn/exec of python).
 7. Library is genuinely split into MULTIPLE modules by functionality under /output/lib/,
    each with meaningful exports actually consumed by others (flag dead/unused modules and
    flag a module that is just a pass-through with no responsibility).
 8. No stray non-deliverable files (scratch/test files) left in /output.
 9. The code runs cleanly: node /output/test2.mjs --a bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4
    prints the same as the executable, and there are no warnings on stderr.
Also confirm there is no leftover "len > 90" style total-length check, which would be a
correctness bug for this reference. Report findings; if fully compliant, return an empty list.`,
  },
  {
    key: 'code-review',
    prompt: `Review the code quality and Python-fidelity reasoning of /output/**/*.mjs.
Read every file. Look for latent correctness risks that the current test vectors might
miss, specifically:
 - integer overflow / sign issues in the polymod loop for very long inputs (is chk kept
   unsigned 32-bit? test a 20000-char input against the executable)
 - iterating UTF-16 code units instead of code points, and any place where a surrogate
   pair or astral character (e.g. an emoji) could diverge from Python's len()/ord()
 - case handling that relies on locale-sensitive toLowerCase/toUpperCase (Python's
   str.lower/upper differ from JS for some non-ASCII; verify the mixed-case check can
   never be reached with non-ASCII input, or handle it ASCII-only deliberately)
 - the order of validation steps, where a different order changes which inputs pass
 - off-by-one in the "pos + 7 > len" and "data[:-6]" logic
 - exit code and stream (stdout vs stderr) routing
 - anything that would break if the value contains a newline, tab or space
VERIFY each suspicion by actually running the reference executable and the candidate side
by side before reporting it. Report ONLY confirmed or strongly-evidenced issues with repro
commands. Empty list is a valid answer.`,
  },
]

const auditResults = await pipeline(
  AUDITS,
  (a) => agent(a.prompt, { label: a.key, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (res, a) => (res?.findings ?? []).map((f) => ({ ...f, source: a.key }))
)

const allFindings = auditResults.flat().filter(Boolean)
log(`audit: ${allFindings.length} raw findings`)

phase('Fix')
let fixResult = 'no fixes needed'
if (allFindings.length) {
  const VERDICT = {
    type: 'object',
    additionalProperties: false,
    required: ['diffResult', 'applied', 'rejected'],
    properties: {
      diffResult: { type: 'string' },
      applied: { type: 'array', items: { type: 'string' } },
      rejected: { type: 'array', items: { type: 'string' }, description: 'findings judged invalid, with why' },
    },
  }
  const fix = await agent(
    `You own /output. Other agents audited the Node.js port and reported the findings below.
${SPEC}

RAW FINDINGS (some may be WRONG — verify each against the real executable before acting;
never "fix" toward a behavior the executable does not actually exhibit):
${JSON.stringify(allFindings, null, 2)}

For each finding: reproduce it. If confirmed, fix it in /output. If it is not reproducible
or contradicts the executable, reject it with a reason. Constraint violations (ESM, .mjs,
external imports, prohibited typed-array names, structure) must all be fixed.
Then run: node /tmp/harness/diff.mjs /output/test2.mjs
and iterate until it reports "mismatches 0". Return the final harness line plus what you
applied and rejected.`,
    { label: 'apply-fixes', schema: VERDICT }
  )
  fixResult = fix?.diffResult ?? 'FIX AGENT FAILED'
  log(`fix: ${fixResult}`)
}

phase('Confirm')
const FINAL = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'diffResult', 'constraintsOk', 'summary', 'residualRisks'],
  properties: {
    pass: { type: 'boolean' },
    diffResult: { type: 'string' },
    constraintsOk: { type: 'boolean' },
    summary: { type: 'string' },
    residualRisks: { type: 'array', items: { type: 'string' } },
  },
}

const confirm = await agent(
  `Independent final verification of the Node.js port in /output. ${SPEC}

Do ALL of the following yourself, from scratch — trust nothing you are told:
 1. Run: node /tmp/harness/diff.mjs /output/test2.mjs   -> must be "mismatches 0".
 2. Generate a FRESH randomized differential sweep of at least 1500 NEW inputs (your own
    generator in /tmp, different random seed and different construction strategy from the
    existing harness) covering decode, formatting and argv shapes; compare stdout, stderr
    and exit code byte-for-byte against /workspace/dataset/test2_executable. Report the
    exact mismatch count.
 3. Re-run the 4 sample cases from the original Python file and confirm exact output:
      --a 'bcrt145x246ljeza95s58'    -> (None, None)
      --a 'tltc15wyan68gzznl8x0gca'  -> (None, None)
      --a 'bc1y5me6j8ep52ah9mx0'     -> (None, None)
      --a 'tb17wxkh83wmp3pt3n4kqtf'  -> (None, None)
    all with exit code 0.
 4. Verify --help and -h output byte-for-byte against the executable (including the exact
    blank line and indentation), on stdout with exit 0.
 5. Re-check every hard constraint: .mjs suffixes, pure ESM (no require/module.exports),
    only relative imports with .mjs extensions that resolve, zero external/npm imports,
    no Uint8Array/DataView/Buffer/typed-array mention anywhere, no Python invocation,
    multi-module hierarchy under /output/lib/ with real exports, entry /output/test2.mjs.
Set pass=true ONLY if step 1 and 2 show zero mismatches and every constraint holds.
List any residual risk you could not rule out.`,
  { label: 'final-verify', schema: FINAL }
)

return {
  build: build?.diffResult,
  findings: allFindings.length,
  bySource: allFindings.reduce((m, f) => ({ ...m, [f.source]: (m[f.source] || 0) + 1 }), {}),
  fix: fixResult,
  final: confirm,
}
