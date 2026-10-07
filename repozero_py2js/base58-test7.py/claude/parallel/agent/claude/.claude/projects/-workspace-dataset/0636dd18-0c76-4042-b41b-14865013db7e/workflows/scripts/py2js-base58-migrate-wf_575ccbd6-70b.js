export const meta = {
  name: 'py2js-base58-migrate',
  description: 'Port /workspace/dataset/test7.py (argparse + base58) to zero-dependency ESM Node.js in /output, then adversarially differential-test against the reference executable until byte-identical',
  phases: [
    { title: 'Probe', detail: 'independent black-box probes of remaining unknown semantics' },
    { title: 'Implement', detail: 'write hierarchical .mjs library + entry point to /output' },
    { title: 'Differential', detail: 'parallel differential fuzzers vs reference executable' },
    { title: 'Fix', detail: 'apply fixes for confirmed mismatches' },
    { title: 'Audit', detail: 'constraint compliance + completeness critics' },
  ],
};

const EXE = '/workspace/dataset/test7_executable';

// ---------------------------------------------------------------------------
// Shared ground truth already established by the lead engineer (do not re-derive).
// ---------------------------------------------------------------------------
const GROUND_TRUTH = `
REFERENCE EXECUTABLE: ${EXE}   (run it directly; NEVER use \`python\`)
SOURCE (Python 3.12 + PyPI \`base58\`):

    import argparse, base58
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    parser.add_argument('--b', type=str, required=True)
    args = parser.parse_args()
    encoded = base58.b58encode(args.a.encode())   # line 9
    decoded = base58.b58decode(args.b)            # line 10
    print(encoded)                                # line 11
    print(decoded)                                # line 12

ALREADY VERIFIED FACTS (trust these; spend your effort elsewhere):

[F1] Alphabet = Bitcoin: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
[F2] b58encode(bytes): strip leading 0x00 -> big-endian int -> base58 digits
     (EMPTY result for value 0, i.e. default_one=False) -> prepend one '1' per
     stripped leading 0x00.  b58encode(b'') == b''.
[F3] b58decode(str):  v = v.rstrip()            # Python str.rstrip(), Unicode-aware
                      v = v.encode('ascii')     # UnicodeEncodeError if any non-ASCII
                      origlen = len(v); v = v.lstrip(b'1'); newlen = len(v)
                      acc = sum of digits base 58 (ValueError on unknown char)
                      return b'\\x00'*(origlen-newlen) + big-endian bytes of acc
     '' -> b''.   '   ' -> b''.   '111z' -> b'\\x00\\x00\\x009'.
[F4] rstrip() strips exactly Python's str.isspace() set:
     STRIPPED: U+0009..U+000D, U+001C..U+001F, U+0020, U+0085, U+00A0, U+1680,
               U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000
     NOT stripped: U+180E, U+200B, U+FEFF (and everything else)
     rstrip happens on the *string* BEFORE the ascii encode, so a trailing U+3000
     is fine but a trailing U+200B raises UnicodeEncodeError.
[F5] print(bytes) uses Python bytes.__repr__:
     prefix b ; quote is ' unless the bytes contain 0x27 and NOT 0x22 -> then "
     escapes: 0x5C -> \\\\ , 0x09 -> \\t , 0x0A -> \\n , 0x0D -> \\r ,
              the active quote char -> backslash + quote,
              any byte < 0x20 or >= 0x7F -> \\xNN with LOWERCASE hex,
              everything else literal.  (0x22 not escaped inside ' quotes and
              0x27 not escaped inside " quotes.)
     Verified: b"it's" , b'say "hi"' , b'both \\' and "' , b'back\\\\slash' ,
               b'tab\\there' , b'nl\\nhere' , b'\\xe4\\xb8\\xad' , b'del'
[F6] --a is UTF-8 encoded (str.encode()).  argv arrives via surrogateescape, so
     invalid UTF-8 bytes in argv become lone surrogates and .encode() raises:
       UnicodeEncodeError: 'utf-8' codec can't encode character '\\udcff' in position 1: surrogates not allowed
[F7] Failure at line 9 or line 10 means NOTHING is printed to stdout (both prints
     come after both computations).  Exit code 1 with a traceback on stderr.
[F8] Exact tracebacks on stderr (then a final non-reproducible
     "[PYI-<pid>:ERROR] Failed to execute script 'test7' due to unhandled exception!" line):

  invalid base58 char:
    Traceback (most recent call last):
      File "test7.py", line 10, in <module>
        decoded = base58.b58decode(args.b)  # 解码Base58字符串
                  ^^^^^^^^^^^^^^^^^^^^^^^^
      File "base58/__init__.py", line 124, in b58decode
      File "base58/__init__.py", line 104, in b58decode_int
    ValueError: Invalid character '0'
  non-ascii in --b:
    ...same first 4 lines...
      File "base58/__init__.py", line 118, in b58decode
      File "base58/__init__.py", line 30, in scrub_input
    UnicodeEncodeError: 'ascii' codec can't encode character '\\xe9' in position 0: ordinal not in range(128)
  surrogate in --a:
    Traceback (most recent call last):
      File "test7.py", line 9, in <module>
        encoded = base58.b58encode(args.a.encode())  # 编码字符串
                                   ^^^^^^^^^^^^^^^
    UnicodeEncodeError: 'utf-8' codec can't encode character '\\udcff' in position 1: surrogates not allowed
[F9] "Invalid character X" uses Python's str repr of the char: '0' '\\t' ' ' "'" '\\\\' '"' '~' '\`'
[F10] ascii UnicodeEncodeError message: single bad char ->
      "'ascii' codec can't encode character <repr> in position N: ordinal not in range(128)"
      RUN of >=2 consecutive bad chars ->
      "'ascii' codec can't encode characters in position N-M: ordinal not in range(128)"
      char repr uses \\xNN (<0x100), \\uNNNN (BMP), \\UNNNNNNNN (astral). N is the
      index in the *rstripped* string. Only the FIRST bad run is reported.
[F11] argparse (Python 3.12), prog name printed by the reference is "test7_executable":
      usage: test7_executable [-h] --a A --b B
      help body (rc 0):
        (blank line) / "options:" / "  -h, --help  show this help message and exit" / "  --a A" / "  --b B"
      errors go to stderr, rc=2, formatted as:
        usage: test7_executable [-h] --a A --b B
        test7_executable: error: <msg>
      verified messages / behaviours:
        no args              -> "the following arguments are required: --a, --b"
        only --a             -> "the following arguments are required: --b"
        "-a x --b 2g"        -> "the following arguments are required: --a"  (required check precedes extras check)
        "--a x --b 2g extra" -> "unrecognized arguments: extra"
        "... x y"            -> "unrecognized arguments: x y"
        "--a --b --b 2g"     -> "argument --a: expected one argument"
        "--a" (at end)       -> "argument --a: expected one argument"
        "--a -x --b 2g"      -> "argument --a: expected one argument"
        "--help=x"           -> "argument -h/--help: ignored explicit argument 'x'"
        "--a=x --b=2g"       -> OK.   "--a= --b=" -> b'' / b''
        "--a x --b 2g --a y" -> last wins
        "--a -5 --b 2g"      -> OK, value "-5" (negative-number matcher ^-\\d+$|^-\\d*\\.\\d+$)
        "-1.5" / "-.5" / "- 5" / "-5x" as a trailing extra -> "unrecognized arguments: <it>"
        "--h" / "--he" / "--hel" -> help (prefix abbreviation), rc 0
        "-h" anywhere (even "-hx") -> help printed, rc 0, wins over other errors
        "--a x --b 2g --"       -> "unrecognized arguments: --"
        "--a x --b 2g -- extra" -> "unrecognized arguments: -- extra"
        "--a x -- --b 2g"       -> "the following arguments are required: --b"
        "-- --a x --b 2g"       -> "the following arguments are required: --a, --b"
        (i.e. the first '--' and everything after it become non-options, and the
         '--' itself survives into the unrecognized-arguments list because the
         parser defines no positionals)
`;

const HARD_CONSTRAINTS = `
NON-NEGOTIABLE CONSTRAINTS ON THE GENERATED CODE:
 C1. Pure JavaScript for Node.js. Files live in /output. Entry point: /output/test7.mjs
 C2. ESM only: \`import\` / \`export\`. \`require()\` and \`module.exports\` are FORBIDDEN.
 C3. Every generated file uses the .mjs suffix, and every relative import includes
     the full ".mjs" suffix.
 C4. ZERO npm dependencies. Do not import anything except local ./*.mjs files and
     (at most) Node built-ins via the "node:" prefix. \`process\` / \`console\` are
     globals and need no import.
 C5. FORBIDDEN, both as code and as words anywhere in the files (including comments
     and identifiers): \`Buffer\`, \`Uint8Array\`, and any other typed array
     (Int8Array, Uint8ClampedArray, Uint16Array, ...), \`TextEncoder\`, \`TextDecoder\`,
     \`atob\`, \`btoa\`.  Byte sequences MUST be represented as plain \`Array\` of
     integers 0..255.  Do NOT write the string "Buffer" or "Uint8Array" in a comment.
 C6. No embedded/spawned Python. No child_process. No eval of foreign code.
 C7. Arguments are parsed by hand from \`process.argv\`.
 C8. Hierarchical: split the library into several focused modules that \`export\`
     their interfaces; the entry file wires them together.
 C9. Node 18 compatible (that is the installed runtime). BigInt is allowed.
`;

// ---------------------------------------------------------------------------
// Phase 1 — probe the few things still genuinely unknown, in parallel.
// ---------------------------------------------------------------------------
phase('Probe');

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'implementationNotes'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['input', 'stdout', 'exitCode', 'rule'],
        properties: {
          input: { type: 'string', description: 'exact argv used' },
          stdout: { type: 'string' },
          stderrTail: { type: 'string' },
          exitCode: { type: 'integer' },
          rule: { type: 'string', description: 'the generalizable rule this proves' },
        },
      },
    },
    implementationNotes: { type: 'string', description: 'precise, actionable rules for the implementer' },
  },
};

const PROBES = [
  {
    key: 'argparse-deep',
    prompt: `Black-box probe the reference executable's ARGUMENT PARSING only. You may NOT read Python source; only run the binary.
Focus on things NOT yet in the verified list. Systematically try at least 40 distinct argv shapes, including:
 - option/value separator forms: "--a=v", "--a v", "--a=", "--a=--b", "--a=-5", "--a==", "--a=a=b"
 - abbreviation matrix: --h --he --hel --help --hell --A --B --aa --bb --ab -a -b -ab
 - is "--a" itself abbreviatable/ambiguous? try "--" combined forms
 - repeated options in every combination, including "--a=1 --a=2", "--b 2g --b 3g"
 - "-h" / "--help" interleaved with errors: does help win over "expected one argument"?
   e.g. "--a -h", "--a --help", "-h --zzz", "--zzz -h", "--a x -h --b"
 - values that look like options: "--a -h", "--a --a", "--a -", "--a --"
 - order of error precedence: unrecognized vs required vs expected-one-argument
 - multiple unrecognized args mixing option-like and plain: "--a x --b 2g -z q -- w"
 - empty-string option name / weird: "" as a bare arg, "-" as a bare arg
 - does a bare "" (empty string) count as an unrecognized positional? what is the message?
 - exit codes and which stream each message goes to (stdout vs stderr) for --help vs errors
Report every case where the behaviour is not obviously predicted by the verified list, and state the precise algorithm the implementer must reproduce (including the exact wording/quoting of each error message).`,
  },
  {
    key: 'repr-exhaustive',
    prompt: `Black-box probe the reference executable to pin down Python's bytes.__repr__ over ALL 256 byte values and the quote-selection rule.
Technique: you can obtain the base58 of ANY byte string by using --a with a UTF-8 string, but that only reaches UTF-8-valid sequences. Better technique: compute base58 yourself (in awk/perl/node, your choice) for an arbitrary byte array, then pass it as --b and read the repr the binary prints. Verify your own base58 encoder against the binary's --a output first.
Cover: every byte 0x00..0xFF appearing (a) alone, (b) at the start, (c) at the end, (d) adjacent to another escape; strings containing only 0x27; only 0x22; both 0x27 and 0x22; 0x27 with 0x22 appearing before/after; 0x5C followed by 'x'/'n'/'t' (does Python double-escape?); 0x00 runs (leading NULs come from leading '1's in the base58 input); 0x7F; 0x80; 0xFF.
Also confirm: leading-zero handling means "1"*k + rest gives k NUL bytes, and repr shows \\x00.
Report the exact escaping table and the exact quote-selection predicate.`,
  },
  {
    key: 'unicode-encode',
    prompt: `Black-box probe how the reference executable handles --a (UTF-8 encoding) and non-ASCII --b (ascii encode failure).
For --a: test ASCII, Latin-1 (é), BMP CJK, astral (emoji U+1F600, U+10FFFF), surrogate pairs, combining marks, zero-width joiner sequences, NUL is impossible via argv. Confirm the encoded output equals base58 of the UTF-8 bytes in every case (verify a few by hand-computing UTF-8 bytes).
Also test raw INVALID UTF-8 bytes in --a (use bash printf '\\xff' etc.): single invalid byte, invalid byte at start/middle/end, truncated multi-byte sequence, overlong encoding, a lone 0x80..0xBF continuation byte, 0xC0 0xAF, 0xED 0xA0 0x80 (encoded surrogate), 0xF5.., and byte 0xFF. Record EXACTLY the UnicodeEncodeError message (which surrogate code point, which position, whether it reports a range "characters in position N-M: surrogates not allowed") and the exit code. Determine the surrogateescape mapping precisely (byte 0xNN -> U+DCNN) and whether Python reports the first bad char only or a run.
For --b non-ASCII: test a single non-ASCII char at several positions, 2 and 3 consecutive non-ASCII chars, non-ASCII chars separated by ASCII, astral chars, and combinations with trailing whitespace (does rstrip change the reported position?). Record exact messages.
Report the precise message-construction algorithm.`,
  },
  {
    key: 'base58-scale',
    prompt: `Black-box probe the reference executable's base58 behaviour at scale and at boundaries.
 - Round-trip: for many random ASCII strings of length 0..2000 passed to --a, confirm output length/content matches an independent base58 implementation you write yourself.
 - --b with: every single alphabet character alone (all 58), '1', '11', '1'*20, '1'*20 + 'z', 'z'*100, the max-value strings, strings of length 1..3000, a string of 5000 'z' chars (does it succeed? how slow?).
 - Confirm all-whitespace --b, --b of only '1's (how many NUL bytes?), '1' followed by whitespace.
 - Timing: how long does the binary take for a 20000-char --a and a 20000-char --b? Report wall-clock so the implementer knows the perf budget (a naive O(n^2) JS port must still finish quickly).
 - Confirm there is no checksum/version behaviour (this is b58encode/b58decode, NOT b58encode_check).
Report concrete numbers and any surprise.`,
  },
];

const probeResults = await parallel(PROBES.map((p) => () =>
  agent(`${GROUND_TRUTH}\n\nYOUR PROBE TASK (${p.key}):\n${p.prompt}\n\nRules: run ${EXE} directly. Never invoke \`python\`/\`python3\`. Write scratch files only under /tmp. Do not create or modify anything in /output. Return structured findings.`,
    { label: `probe:${p.key}`, phase: 'Probe', schema: PROBE_SCHEMA })
));

const probeSpec = PROBES.map((p, i) => {
  const r = probeResults[i];
  if (!r) return `### ${p.key}\n(probe failed - no data)`;
  const cases = (r.findings || []).slice(0, 60)
    .map((f) => `  argv: ${f.input}\n    stdout: ${JSON.stringify(f.stdout)}\n    stderrTail: ${JSON.stringify(f.stderrTail || '')}\n    rc: ${f.exitCode}\n    rule: ${f.rule}`)
    .join('\n');
  return `### ${p.key}\nNOTES: ${r.implementationNotes}\nEVIDENCE:\n${cases}`;
}).join('\n\n');

log('Probe phase complete - handing consolidated spec to the implementer.');

// ---------------------------------------------------------------------------
// Phase 2 — implement. Single agent so there are no write conflicts.
// ---------------------------------------------------------------------------
phase('Implement');

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'moduleGraph', 'selfTestSummary'],
  properties: {
    files: { type: 'array', items: { type: 'string' }, description: 'absolute paths written' },
    moduleGraph: { type: 'string', description: 'one line per module: path - responsibility - exports' },
    selfTestSummary: { type: 'string', description: 'what you differential-tested and the pass/fail counts' },
    knownGaps: { type: 'string' },
  },
};

const implResult = await agent(
  `You are porting a Python CLI to Node.js ESM. Implement it now.

${GROUND_TRUTH}

${HARD_CONSTRAINTS}

ADDITIONAL SPEC GATHERED BY PARALLEL BLACK-BOX PROBES:
${probeSpec}

REQUIRED MODULE LAYOUT (create exactly these, all in /output, all .mjs):
  /output/lib/bytes.mjs        - plain-Array byte-sequence helpers (no typed arrays!)
  /output/lib/utf8.mjs         - manual UTF-8 encode of a JS string to Array<int>,
                                 including lone-surrogate detection for the
                                 UnicodeEncodeError path, and Python-style
                                 surrogateescape decoding of raw argv bytes
  /output/lib/pyrepr.mjs       - Python repr of a byte sequence (bytes.__repr__) and
                                 Python repr of a single character (for error messages)
  /output/lib/bigint58.mjs     - base-conversion core (256 <-> 58) over plain Arrays
  /output/lib/base58.mjs       - b58encode / b58decode reproducing the Python
                                 \`base58\` package's exact semantics + its exact errors
  /output/lib/pystr.mjs        - Python str semantics needed here: isspace() set,
                                 rstrip(), ascii-encode with UnicodeEncodeError
  /output/lib/pyerrors.mjs     - error classes carrying the exact Python message +
                                 the exact traceback frames, and the exit-code policy
  /output/lib/argparse.mjs     - a faithful mini-reimplementation of the Python 3.12
                                 argparse behaviour needed by this program
  /output/lib/rawargv.mjs      - recover the RAW argv bytes so invalid-UTF-8 input can
                                 be modelled with Python's surrogateescape. Read
                                 /proc/self/cmdline with node:fs, align the tail of
                                 that list against process.argv.slice(2), and fall back
                                 silently to process.argv when anything is off
                                 (different length, mismatch after lossy decode,
                                 file unreadable). This must be a pure optimisation:
                                 for all valid-UTF-8 input the result is identical to
                                 process.argv. Wrap everything in try/catch.
  /output/test7.mjs            - entry point: parse argv, compute, print, handle errors
You may add more modules if it genuinely helps, but not fewer.

OUTPUT SEMANTICS THE ENTRY POINT MUST HONOUR:
 - success: two lines on stdout, each a Python bytes repr, each terminated by "\\n". rc 0.
 - argparse error: usage line + "<prog>: error: <msg>" on stderr, rc 2, nothing on stdout.
 - --help/-h: usage + options block on stdout, rc 0.
 - runtime error (bad base58 char / non-ascii --b / surrogate --a): nothing on stdout,
   the exact Python traceback on stderr, rc 1. Emit the trailing
   "[PYI-<pid>:ERROR] Failed to execute script 'test7' due to unhandled exception!"
   line too, using process.pid (the reference prints its own pid there, so the number
   is inherently not reproducible - that is expected and fine).
 - prog name is the literal string "test7_executable" so stderr matches the reference
   byte for byte. Put that in one clearly-named constant.
 - The traceback's source lines contain the ORIGINAL Chinese comments; reproduce them
   exactly, including the caret (^) underline lines.

WORK METHOD (do all of this before returning):
 1. Write the modules.
 2. Immediately build a differential test harness at /tmp/diff.sh (NOT in /output) that
    runs both ${EXE} and \`node /output/test7.mjs\` with identical argv and compares
    stdout byte-for-byte, exit code, and stderr (ignoring only the [PYI-...] line).
 3. Run it over at least 300 cases: the 4 sample cases from the source file, every
    verified fact above, and randomised inputs. Fix everything until it is green.
 4. Verify compliance with C1-C9 yourself: grep the generated files for the forbidden
    identifiers and for \`require(\`; confirm every relative import ends in .mjs.
 5. Confirm \`node /output/test7.mjs --a '5aN1QrVUtM5PMaBzNoYFqL5wGSWAw' --b '2g'\`
    prints exactly:
      b'3RYyLdhz3WZhvaeMoqUS47HWrYtE9oxw4QwVQmNn'
      b'a'
Return the file list, module graph, and your test counts.`,
  { label: 'implement', phase: 'Implement', schema: IMPL_SCHEMA, effort: 'high' }
);

log(`Implementation written: ${(implResult?.files || []).length} files. Starting differential fuzzing.`);

// ---------------------------------------------------------------------------
// Phase 3/4 — adversarial differential testing, loop until two clean rounds.
// ---------------------------------------------------------------------------
const MISMATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['casesRun', 'mismatches'],
  properties: {
    casesRun: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argvShell', 'expected', 'actual', 'stream'],
        properties: {
          argvShell: { type: 'string', description: 'a copy-pasteable shell snippet reproducing it' },
          stream: { type: 'string', description: 'stdout | stderr | exitCode' },
          expected: { type: 'string', description: 'what the reference produced' },
          actual: { type: 'string', description: 'what the node port produced' },
          severity: { type: 'string', description: 'high if a plausible grading input, low if exotic' },
        },
      },
    },
    notes: { type: 'string' },
  },
};

const LENSES = [
  { key: 'bulk-fuzz', prompt: `Bulk randomised differential fuzz. Generate >=1500 cases where --a and --b are random strings: random ASCII printable, random lengths 0..300, random picks from the base58 alphabet for --b (so it usually decodes), random UTF-8 text (Latin, CJK, Cyrillic, Arabic, emoji), and cross-feeding (take the base58 the tool prints for --a and feed it back as --b). Compare stdout, stderr and exit code.` },
  { key: 'repr-bytes', prompt: `Target Python bytes-repr fidelity. Construct --b values that decode to byte strings hitting every one of the 256 byte values, every escape branch, and every quote-selection branch (contains 0x27 only; 0x22 only; both, in both orders; neither; backslash next to x/n/t/0; 0x7F; 0x80; 0xFF; long NUL runs from leading '1's; a single byte 0x00..0xFF alone).` },
  { key: 'argparse', prompt: `Target argument parsing. Exhaustively enumerate argv shapes: missing/duplicated/abbreviated/= -form options, -h and --help in every position and combination with other errors, "--" in every position, option-like values, empty-string values and empty-string bare args, unrecognized args (single, multiple, option-like, mixed), "--a" with no value, "--help=x", bad abbreviations, single-dash forms, negative-number-looking values and extras. Compare stdout, stderr AND exit code for each (ignore only the [PYI-...] pid line).` },
  { key: 'unicode', prompt: `Target Unicode. --a with astral chars, surrogate pairs, combining sequences, RTL text, U+FFFD itself, and RAW INVALID UTF-8 byte sequences injected via bash printf (lone 0x80..0xBF, 0xC0 0xAF, 0xED 0xA0 0x80, 0xF5..0xFF, truncated sequences, invalid byte at start/middle/end, several invalid bytes). --b with non-ASCII at various positions, runs of non-ASCII, non-ASCII plus trailing whitespace, and every character in Python's isspace() set as a trailing character (U+0009..U+000D, U+001C..U+001F, U+0020, U+0085, U+00A0, U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000) as well as near-misses U+180E, U+200B, U+FEFF. Verify exit codes and exact error text.` },
  { key: 'boundaries', prompt: `Target boundaries and scale. Empty strings; single chars; --b of only '1's (1..64 of them); '1' runs followed by content; leading/trailing whitespace mixes; very long inputs (--a and --b of length 1000, 5000, 20000, 60000) checking both correctness AND that the node port finishes in reasonable time (report timings; flag anything pathologically slow); the exact 4 sample cases from the source file; and any input that makes either program behave non-deterministically.` },
  { key: 'adversarial-reader', prompt: `Do NOT fuzz blindly. First READ every file in /output line by line, looking for logic that could diverge from Python: off-by-one in escape ranges, hex casing, quote selection, leading-zero counting, rstrip character set, ascii-error position computed on the wrong string, argparse precedence order, integer precision loss (Number vs BigInt), array mutation bugs, and any place a JS string method has different semantics than Python's. For EVERY suspicion you form, construct the specific input that would expose it and actually run it against both programs. Report only differences you reproduced.` },
];

let round = 0;
let clean = 0;
let allNotes = [];
while (clean < 2 && round < 5) {
  round += 1;
  phase(round === 1 ? 'Differential' : `Differential r${round}`);
  const reports = await parallel(LENSES.map((l) => () =>
    agent(`You are differential-testing a Node.js port against its Python reference.

REFERENCE: ${EXE}
PORT:      node /output/test7.mjs
Same argv must produce byte-identical stdout, byte-identical stderr (EXCEPT the
"[PYI-<number>:ERROR] Failed to execute script 'test7' due to unhandled exception!"
line, whose number is a pid and is intentionally not reproducible) and the same exit code.

${GROUND_TRUTH}

YOUR LENS (${l.key}), round ${round}:
${l.prompt}

Method: write your harness under /tmp only. NEVER modify anything in /output. Never run
\`python\`. Use bash/node for generation. Report the number of cases you actually ran and
every reproduced mismatch with a copy-pasteable repro. If you find none, say so plainly -
do not invent findings.`,
      { label: `diff:${l.key}:r${round}`, phase: round === 1 ? 'Differential' : `Differential r${round}`, schema: MISMATCH_SCHEMA, effort: 'high' })
  ));

  const good = reports.filter(Boolean);
  const totalCases = good.reduce((s, r) => s + (r.casesRun || 0), 0);
  const mismatches = good.flatMap((r, i) => (r.mismatches || []).map((m) => ({ ...m, lens: LENSES[i]?.key })));
  allNotes.push(`round ${round}: ${totalCases} cases, ${mismatches.length} raw mismatches`);
  log(`Round ${round}: ${totalCases} cases run, ${mismatches.length} candidate mismatches.`);

  if (!mismatches.length) { clean += 1; continue; }

  // Adversarially confirm each mismatch before spending a fix on it.
  phase(`Fix`);
  const VERDICT = {
    type: 'object', additionalProperties: false,
    required: ['reproduced', 'explanation'],
    properties: {
      reproduced: { type: 'boolean' },
      explanation: { type: 'string' },
      correctBehaviour: { type: 'string' },
    },
  };
  const verdicts = await parallel(mismatches.slice(0, 40).map((m) => () =>
    agent(`Try to REFUTE this claimed mismatch between the reference and the port.
Repro claimed: ${m.argvShell}
Claimed ${m.stream}: reference=${JSON.stringify(m.expected)} port=${JSON.stringify(m.actual)}
Run BOTH programs yourself with exactly that argv (reference: ${EXE}). Remember the
[PYI-<pid>] line legitimately differs and must NOT count as a mismatch, and that stderr
tracebacks are otherwise expected to match. Set reproduced=false if you cannot reproduce a
real difference, or if the "difference" is only the pid line. Default to false when unsure.
Do not modify /output.`,
      { label: `verify:${(m.lens || 'x')}`, phase: 'Fix', schema: VERDICT })
      .then((v) => ({ m, v }))
  ));

  const confirmed = verdicts.filter(Boolean).filter((x) => x.v?.reproduced);
  log(`Round ${round}: ${confirmed.length}/${mismatches.length} mismatches confirmed by refutation panel.`);
  if (!confirmed.length) { clean += 1; continue; }
  clean = 0;

  await agent(`Fix the Node.js port at /output so it matches the reference exactly.

${GROUND_TRUTH}

${HARD_CONSTRAINTS}

CONFIRMED MISMATCHES (each independently reproduced):
${confirmed.map((x, i) => `${i + 1}. repro: ${x.m.argvShell}\n   stream: ${x.m.stream}\n   reference: ${JSON.stringify(x.m.expected)}\n   port: ${JSON.stringify(x.m.actual)}\n   analysis: ${x.v.explanation}\n   correct behaviour: ${x.v.correctBehaviour || ''}`).join('\n')}

Read the relevant /output modules, fix the ROOT CAUSE (not the symptom), keep the module
layout and all constraints C1-C9 intact, then re-run each repro above against both programs
to prove it is fixed, plus a regression sweep of at least 200 previously-passing cases
(including the 4 sample cases in the original Python file) to prove nothing broke.
Report what you changed and the verification you ran.`,
    { label: `fix:r${round}`, phase: 'Fix', effort: 'high' });
}

// ---------------------------------------------------------------------------
// Phase 5 — compliance + completeness critics.
// ---------------------------------------------------------------------------
phase('Audit');

const AUDIT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['pass', 'violations', 'summary'],
  properties: {
    pass: { type: 'boolean' },
    violations: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

const audits = await parallel([
  () => agent(`Audit /output for CONSTRAINT COMPLIANCE only. Do not fix anything; report.
${HARD_CONSTRAINTS}
Check every file: grep for require(, module.exports, Buffer, Uint8Array, any typed array
name, TextEncoder, TextDecoder, atob, btoa; confirm all files end in .mjs; confirm every
relative import string ends in ".mjs"; confirm no npm import specifiers (only "node:*" or
relative "./*.mjs"); confirm no child_process / python; confirm the entry point is
/output/test7.mjs and that \`node /output/test7.mjs --a x --b 2g\` works from a different
cwd (try cd /tmp). Also confirm the library is genuinely split into multiple modules that
export their interfaces, and that nothing is dead weight. List every violation verbatim
with file:line.`, { label: 'audit:constraints', phase: 'Audit', schema: AUDIT_SCHEMA }),

  () => agent(`Completeness critic for this port. Everything is in /output; reference is ${EXE}.
${GROUND_TRUTH}
Ask: what has NOT been verified? Which input class did the fuzzers never generate? Which
verified fact F1-F11 has no corresponding test? Is there any code path in /output that no
test exercises (read the files and check)? Then GENERATE and RUN the missing cases against
both programs. Report only reproduced gaps/differences, with repros. Do not modify /output.`,
    { label: 'audit:completeness', phase: 'Audit', schema: AUDIT_SCHEMA }),

  () => agent(`Final acceptance test. Run the four sample cases from the original Python file
against BOTH ${EXE} and \`node /output/test7.mjs\` and diff byte-for-byte:
 1. --a '5aN1QrVUtM5PMaBzNoYFqL5wGSWAw'  --b '2g'
 2. --a '中国汉字'                        --b 'KAbNUE1LBRuRVeN'
 3. --a 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' --b '2NEpo7TZRRrLZSi2U'
 4. --a '5aN1QrVUtM5PMaBzNoYFqL5wGSWAw'  --b '2722bfR1UtrSp6ixizzEZeVU9B9hBNcHut8QQ2Q'
Expected stdout for these is documented in the source file comments - confirm the port
matches the DOCUMENTED text too, not just the binary. Also run 200 random valid cases.
Set pass=true only if everything is byte-identical. Do not modify /output.`,
    { label: 'audit:acceptance', phase: 'Audit', schema: AUDIT_SCHEMA }),
]);

const auditList = audits.filter(Boolean);
const violations = auditList.flatMap((a) => a.violations || []);

if (violations.length) {
  phase('Audit');
  await agent(`Resolve these audit findings in /output. ${HARD_CONSTRAINTS}
FINDINGS:
${violations.map((v, i) => `${i + 1}. ${v}`).join('\n')}
Fix the real problems (ignore any finding you can prove is not a real violation, and say
which and why). Then re-verify: constraint greps, the 4 sample cases, and 200 random cases
against ${EXE}. Report precisely what you changed.`,
    { label: 'audit:remediate', phase: 'Audit', effort: 'high' });
}

return {
  moduleGraph: implResult?.moduleGraph || '(unavailable)',
  rounds: allNotes,
  cleanRounds: clean,
  audits: auditList.map((a) => ({ pass: a.pass, summary: a.summary, violations: a.violations })),
  remainingViolations: violations,
};
