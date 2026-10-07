export const meta = {
  name: 'idna-py2js-port',
  description: 'Build and adversarially verify JS modules for a Python idna -> Node.js port',
  phases: [
    { title: 'Build', detail: 'independent module implementations' },
    { title: 'Verify', detail: 'adversarial review of each module' },
  ],
};

const SHARED = `
CONTEXT — you are helping port a Python script to Node.js ESM.

The Python source (/workspace/dataset/test1.py):
\`\`\`python
import argparse
import idna

parser = argparse.ArgumentParser()
parser.add_argument('--domain', type=str, required=True)
args = parser.parse_args()

domain = args.domain

encoded = idna.encode(domain)
print(encoded)

decoded = idna.decode(encoded)
print(decoded)

first_label = domain.split('.')[0]
if first_label:
    ulabel_result = idna.ulabel(idna.encode(first_label))
    print(ulabel_result)

    alabel_result = idna.alabel(first_label)
    print(alabel_result)
\`\`\`

HARD CONSTRAINTS on all code you write:
- Node.js ESM only. File suffix .mjs. Use \`import\`/\`export\`. NEVER \`require()\` or \`module.exports\`.
- ZERO external/npm dependencies. Only node: builtins may be imported, and only if truly needed.
- ABSOLUTELY FORBIDDEN: the built-in punycode module, the URL/URLSearchParams classes, and
  node:url. Do not import them, do not call them, do not even mention them in comments.
  Everything must be implemented from scratch.
- \`String.prototype.normalize\` and RegExp Unicode property escapes (\\p{...}) ARE allowed and encouraged.
- Code style: clean, commented where non-obvious, named exports.

A reference oracle exists: /workspace/dataset/test1_executable --domain <value>
It is currently SATURATED by a background sweep. You may invoke it at most ~80 times total.
Keep invocations targeted. Never run it in a loop of more than ~20 iterations.

Write your deliverable file(s) to the exact paths given in your task. Also return a concise
report: what you implemented, key algorithmic decisions, known risks, and any oracle evidence.
`;

const MODULES = [
  {
    key: 'punycode',
    label: 'punycode-codec',
    path: '/tmp/wf/punycode-codec.mjs',
    prompt: `${SHARED}

TASK: Implement CPython's built-in "punycode" codec (Lib/encodings/punycode.py) from scratch in JS.
Write it to /tmp/wf/punycode-codec.mjs

Export exactly:
  export function punycodeEncode(str)   // JS string -> ASCII JS string, NO "xn--" prefix
  export function punycodeDecode(ascii) // ASCII JS string (no "xn--" prefix) -> JS string

Behaviour must match Python's \`s.encode('punycode')\` / \`b.decode('punycode')\` in STRICT mode,
including its quirks. Reproduce the CPython algorithm structure faithfully:

ENCODE:
- segregate(): all codepoints < 128 go to \`base\` in order; the set of codepoints >= 128 is
  collected, deduplicated, and sorted ascending -> \`extended\`.
- insertion_unsort() produces a list of deltas. Pseudocode:
    oldchar = 0x80; result = []; oldindex = -1
    for c in extended:            # sorted unique non-ascii chars
        index = pos = -1
        char = ord(c)
        curlen = number of chars in the FULL text with ord < char
        delta = (curlen + 1) * (char - oldchar)
        loop:
            (index, pos) = selective_find(text, c, index, pos)
            if index == -1: break
            delta += index - oldindex
            oldindex = index
            result.append(delta - 1)
            delta = 0
        oldchar = char
  where selective_find(text, char, index, pos):
        l = len(text)
        loop:
            pos += 1
            if pos == l: return (-1, -1)
            c = text[pos]
            if c == char: return (index+1, pos)
            elif c < char: index += 1
  IMPORTANT: Python iterates by CODEPOINT, not UTF-16 code unit. Handle astral plane chars
  correctly (use Array.from / codePointAt). Comparisons c < char are codepoint comparisons.
- T(j, bias): res = 36*(j+1) - bias; clamp to [1, 26].
- generate_generalized_integer(N, bias):
    j = 0
    loop:
      t = T(j, bias)
      if N < t: emit digits[N]; return
      emit digits[t + ((N - t) % (36 - t))]
      N = floor((N - t) / (36 - t)); j += 1
  digits = "abcdefghijklmnopqrstuvwxyz0123456789"
- adapt(delta, first, numchars):
    delta = first ? floor(delta/700) : floor(delta/2)
    delta += floor(delta / numchars)
    divisions = 0
    while delta > 455: delta = floor(delta/35); divisions += 36
    return divisions + floor(36*delta / (delta + 38))
- generate_integers(baselen, deltas):
    bias = 72
    for (points, delta) of enumerate(deltas):
      out += generate_generalized_integer(delta, bias)
      bias = adapt(delta, points == 0, baselen + points + 1)
- punycode_encode: base,extended = segregate(text); deltas = insertion_unsort(text, extended);
  ext = generate_integers(base.length, deltas);
  return base ? base + "-" + ext : ext
  (base.length is the count of ASCII codepoints.)

DECODE (strict):
    pos = text.lastIndexOf("-")
    if pos == -1: base = ""; extended = text.toUpperCase()
    else: base = text.slice(0, pos); extended = text.slice(pos+1).toUpperCase()
    then insertion_sort(base, extended):
      char = 0x80; pos = -1; bias = 72; extpos = 0
      while extpos < extended.length:
        (newpos, delta) = decode_generalized_number(extended, extpos, bias)
        pos += delta + 1
        char += floor(pos / (base_len + 1))         # base_len = number of CODEPOINTS in base
        if char > 0x10FFFF: throw UnicodeError("Invalid character U+%x" % char)
        pos = pos % (base_len + 1)
        base = base[:pos] + chr(char) + base[pos:]   # insertion at CODEPOINT index pos
        bias = adapt(delta, extpos == 0, base_len_after_insert)
        extpos = newpos
    decode_generalized_number(extended, extpos, bias):
      result = 0; w = 1; j = 0
      loop:
        if extpos >= len: throw UnicodeError("incomplete punicode string")
        c = extended.charCodeAt(extpos); extpos += 1
        if 0x41 <= c <= 0x5A: digit = c - 0x41
        elif 0x30 <= c <= 0x39: digit = c - 22
        else: throw UnicodeError("Invalid extended code point '<char>'")
        t = T(j, bias)
        result += digit * w
        if digit < t: return (extpos, result)
        w = w * (36 - t)
        j += 1
  NOTE: Python uses arbitrary-precision ints here. \`result\` and \`w\` can exceed 2^53 for
  adversarial input. Use BigInt internally where overflow is possible, and make sure the
  \`char > 0x10FFFF\` check triggers exactly as CPython's would. Deltas that stay small must
  behave identically to the Number path. Also note \`base\` may contain non-ASCII after the
  first insertion, so base_len must be recomputed by codepoint each iteration.
  Do NOT add RFC-3492 overflow/non-minimal-encoding validation — CPython does not have it.

Throw an Error subclass; export it as \`PunycodeError\` with a \`message\` matching CPython's text.

Validate with the oracle (budget ~40 calls). Useful facts already established:
  café       -> xn--caf-dma
  ß          -> xn--zca
  ς          -> xn--3xa
  προγραμματισμός -> xn--mxaae0anacrikcslm7j
  программирование -> xn--80aafcnpc2aandfgoce
  рф         -> xn--p1ai
  సాంకేతికతłęь -> xn--nea5fz9hs9kzca8hb9o9bo8g
  משהו       -> xn--8dbcz8b
  עברית1     -> xn--1-1hcy8a5an
  l·l        -> xn--ll-0ea
  ア・イ       -> xn--ccke4x
  テスト      -> xn--zckzah
  xn--zzzzz  decodes to 箥糪
  ۰۱۲        -> xn--dmbcd
  ابجد٠      -> xn--mgbcmm9v
  α͵β        -> xn--wva3je
  עברית׳     -> xn--5dbqzzl8c
Verify round-trips of ASTRAL-plane strings (e.g. CJK ext B 𠀀, and Deseret 𐐀) by feeding
\`xn--...\` A-labels to the oracle for the decode direction where possible.
Also write a self-test file /tmp/wf/punycode-selftest.mjs that asserts all the vectors above,
and run it.`,
  },
  {
    key: 'pyrepr',
    label: 'python-repr',
    path: '/tmp/wf/pyrepr.mjs',
    prompt: `${SHARED}

TASK: Implement Python 3's \`repr()\` for \`bytes\` and \`str\`, plus \`print()\` semantics.
Write to /tmp/wf/pyrepr.mjs

Export:
  export function bytesRepr(bytes)   // bytes: Uint8Array (or array of 0..255) -> e.g. "b'xn--caf-dma'"
  export function strRepr(s)         // JS string -> Python repr of a str
  export function isPrintable(cp)    // Python str.isprintable() per-codepoint rule

bytesRepr rules (CPython Objects/bytesobject.c):
- Quote selection: default single quote. If the bytes contain a single-quote byte and do NOT
  contain a double-quote byte, use double quotes.
- Prefix b.
- Escapes: \\t \\n \\r for 9/10/13; doubled backslash for backslash; the quote char itself is
  escaped with a backslash; bytes < 0x20 or >= 0x7F are emitted as \\xNN (lowercase hex,
  2 digits). All other bytes are emitted literally.

strRepr rules (CPython Objects/unicodeobject.c unicode_repr):
- Quote selection: default single quote; if the string contains a single quote and not a
  double quote, use double quotes.
- Escape backslash, \\t \\n \\r, and the quote char.
- A codepoint is emitted literally iff it is "printable" per Python's rule:
  printable = NOT in general categories Cc, Cf, Cs, Co, Cn, Zl, Zp, Zs — EXCEPT that
  U+0020 (space) IS printable. (i.e. \`str.isprintable()\`.)
- Non-printable codepoints are escaped: cp < 0x100 -> \\xNN ; cp < 0x10000 -> \\uNNNN ;
  else -> \\UNNNNNNNN. Lowercase hex digits, zero padded to 2/4/8.
- Iterate by codepoint (astral chars are one unit).
Use RegExp Unicode property escapes (\\p{Cc} etc.) to implement the category test — build the
test as a precompiled RegExp, not a giant table. Verify \\p{Cn} works in Node 18; if
\\p{Cn} is unsupported use \\P{Assigned}.

Also export:
  export function printLine(text)  // writes text + "\\n" to stdout as UTF-8, correctly
Use process.stdout.write. Ensure the process does not exit before stdout is flushed.

Verify: Python's repr of the string 'ab\\u200ccd' is the 10-character sequence
  ' a b \\ u 2 0 0 c c d '  (i.e. the ZWNJ is escaped as backslash-u-2-0-0-c)
and repr of 'न\\u200cि' keeps the Devanagari literal but escapes the ZWNJ.
repr(b'xn--caf-dma') is b'xn--caf-dma' wrapped in single quotes.
Write a self-test /tmp/wf/pyrepr-selftest.mjs and run it.`,
  },
  {
    key: 'argparse',
    label: 'py-argparse',
    path: '/tmp/wf/pyargparse.mjs',
    prompt: `${SHARED}

TASK: Emulate Python argparse for EXACTLY this parser, byte-for-byte:
  parser = argparse.ArgumentParser()
  parser.add_argument('--domain', type=str, required=True)
  args = parser.parse_args()

Write to /tmp/wf/pyargparse.mjs, exporting:
  export function parseArgs(argv, progName)  // argv = process.argv.slice(2) -> { domain }
It must handle errors itself by writing to stderr and calling process.exit(2), and handle
-h/--help by writing usage to stdout and process.exit(0).

Established oracle behaviour (prog name is "test1_executable"; for our port the prog name must
be derived the same way Python does: basename of sys.argv[0]. For the JS port use the basename
of process.argv[1], e.g. "test1.mjs". Make the prog name a parameter with that default.):

  $ test1_executable --help
  usage: test1_executable [-h] --domain DOMAIN

  options:
    -h, --help       show this help message and exit
    --domain DOMAIN
  (exit 0)

  $ test1_executable
  usage: test1_executable [-h] --domain DOMAIN
  test1_executable: error: the following arguments are required: --domain
  (exit 2, both lines on stderr)

  $ test1_executable --domain -abc.com
  usage: test1_executable [-h] --domain DOMAIN
  test1_executable: error: argument --domain: expected one argument
  (exit 2, stderr)  <-- because "-abc.com" looks like an option

NOTE the exact spacing in --help output: two-space indent, and the help column alignment.
Reproduce it byte-for-byte by capturing the real output.

Reproduce these argparse behaviours faithfully:
- \`--domain=VALUE\` syntax works, including \`--domain=\` (empty string).
- \`--domain\` alone at end of argv -> "expected one argument".
- A following token that starts with "-" is treated as an option, NOT a value, UNLESS it is
  a negative number and the parser has no options that look like negative numbers, or it is
  exactly "-", or it contains a space. Implement argparse's _negative_number_matcher
  (/^-\\d+$/ plus the float form) and its _has_negative_number_optionals logic: since this
  parser has no numeric-looking option strings, a token matching the negative-number pattern
  IS accepted as a value. A token starting with "-" that contains a space is also a value.
- Abbreviation: \`--dom\`, \`--do\`, \`--d\` all resolve to \`--domain\` (allow_abbrev default True).
  \`--h\` resolves to --help.
- Unrecognized extra args -> \`error: unrecognized arguments: a b\` (exit 2).
- Repeated \`--domain a --domain b\` -> last wins.
- \`--\` separator handling.
- Ordering: argparse's parse_args calls parse_known_args; the required-argument check happens
  inside parse_known_args, so a missing required arg is reported BEFORE unrecognized args.

VERIFY each of these against the oracle (budget ~40 calls) and report the ACTUAL observed
output for each; correct the spec above wherever the oracle disagrees. Record findings in
/tmp/wf/argparse-findings.md. Write a self-test /tmp/wf/pyargparse-selftest.mjs and run it.`,
  },
  {
    key: 'unicodeaux',
    label: 'unicode-aux-tables',
    path: '/tmp/wf/unicode-aux.mjs',
    prompt: `${SHARED}

TASK: Produce auxiliary Unicode tables needed by IDNA2008 (RFC 5891/5892) validation, derived
with Node's own Unicode data (RegExp \\p{...} property escapes) — NOT from any npm package and
NOT from network access.

Write a GENERATOR script /tmp/wf/gen-unicode-aux.mjs that runs under Node 18 and writes the
data module /tmp/wf/unicode-aux.mjs. Run it, and make sure the produced module loads fast
(< 60ms) and is reasonably compact (store sorted range arrays, not per-codepoint sets).

The data module must export:

1) \`bidiClassOf(cp)\` -> one of: 'L','R','AL','AN','EN','NSM','NEUTRAL','BN','UNKNOWN'
   (R and AL behave identically for IDNA; ES/CS/ET/ON may be merged into 'NEUTRAL'.)
   Derivation rules (Unicode DerivedBidiClass.txt semantics):
   - Default by range (the @missing lines):
       AL: 0600..07BF, 0860..08FF, FB50..FDCF, FDF0..FDFF, FE70..FEFF, 10D00..10D3F,
           10EC0..10EFF, 10F30..10F6F, 1EC70..1ECBF, 1ED00..1ED4F, 1EE00..1EEFF
       R : 0590..05FF, 07C0..085F, FB1D..FB4F, 10800..10CFF, 10D40..10EBF, 10F00..10F2F,
           10F70..10FFF, 1E800..1EC6F, 1ECC0..1ECFF, 1ED50..1EDFF, 1EF00..1EFFF
       ET: 20A0..20CF
       BN: noncharacters and default-ignorables
       L : everything else
   - Then actual assigned values override the defaults:
       * \\p{Mn} or \\p{Me}  -> NSM   (Bidi_Class=NSM is exactly Mn union Me)
       * ASCII 0030..0039 -> EN; 002D -> ES (NEUTRAL)
       * Arabic-Indic digits 0660..0669 -> AN; 06F0..06F9 -> EN
       * Hanifi Rohingya digits 10D30..10D39 -> AN
       * Letters: use \\p{Script=...} to pick R vs AL vs L. Candidate AL scripts: Arabic,
         Syriac, Thaana, Manichaean, Sogdian, Hanifi_Rohingya, Chorasmian, Old_Uyghur.
         Candidate R scripts: Hebrew, Nko, Samaritan, Mandaic, Adlam, Cypriot, Phoenician,
         Lydian, Kharoshthi, Imperial_Aramaic, Avestan, Inscriptional_Parthian,
         Inscriptional_Pahlavi, Psalter_Pahlavi, Old_Turkic, Old_Hungarian, Hatran, Elymaic,
         Nabataean, Palmyrene, Mende_Kikakui, Old_North_Arabian, Old_South_Arabian,
         Old_Sogdian, Yezidi, Meroitic_Cursive, Meroitic_Hieroglyphs, Cypro_Minoan.
         VERIFY these rather than trusting the list — some may be wrong.
   - Codepoints unassigned in Node's Unicode -> fall back to the range defaults.

2) \`joiningTypeOf(cp)\` -> 'L' | 'R' | 'D' | 'C' | 'T' | 'U'
   Semantics of Unicode ArabicShaping.txt + defaults:
   - Default T for \\p{Mn}, \\p{Me}, \\p{Cf}  (transparent)
   - Default U otherwise
   - Explicit D/L/R/C values for the cursive-joining scripts: Arabic (incl. Arabic Extended-A/B/C
     and Arabic Presentation Forms), Syriac, Nko, Mandaic, Manichaean, Mongolian,
     Phags_pa, Psalter_Pahlavi, Sogdian, Hanifi_Rohingya, Adlam, Chorasmian, Yezidi,
     Old_Uyghur.
   You cannot read ArabicShaping.txt. Encode the ranges you are confident about, focusing on
   correctness for Arabic (0620..064A, 066E..066F, 0671..06D3, 06D5, 06EE..06EF, 06FA..06FF,
   0750..077F, 08A0..08BD, ...), Syriac (0710..072F, 074D..074F), Nko (07CA..07EA),
   Mongolian, and Adlam (1E900..1E943). Mark clearly in comments which ranges are best-effort.
   This is only used by the IDNA CONTEXTJ rule for ZERO WIDTH NON-JOINER, so the critical
   cases are Arabic/Syriac/Nko letters and transparent marks.

3) \`isVirama(cp)\` -> boolean : Canonical_Combining_Class == 9.
   JS has no \\p{ccc=9}. Hardcode the set. Known virama codepoints (verify/extend):
   094D 09CD 0A4D 0ACD 0B4D 0BCD 0C4D 0CCD 0D3B 0D3C 0D4D 0DCA 0E3A 0EBA 0F84 1039 103A
   1714 1734 17D2 1A60 1B44 1BAA 1BAB 1BF2 1BF3 2D7F A806 A8C4 A953 A9C0 AAF6 ABED 10A3F
   11046 1107F 110B9 11133 11134 111C0 11235 112EA 1134D 11442 114C2 115BF 1163F 116B6
   1172B 11839 1193D 1193E 119E0 11A34 11A47 11A99 11C3F 11D44 11D45 11D97 1612F

4) \`isCombiningMark(cp)\` -> boolean : general category starts with M (Mn|Mc|Me).
   Implement with a precompiled RegExp on \\p{M}.

5) \`isNfc(s)\` / \`toNfc(s)\` helpers using String.prototype.normalize (iterate by codepoint).

Also export \`UNICODE_VERSION_NOTE\` documenting Node's Unicode version
(process.versions.unicode if available).

Validate a sample against the oracle (budget ~60 calls): e.g. a Hebrew label with a digit,
an Arabic label with a ZWNJ in a joining position, a Devanagari virama+ZWNJ label. Report
concrete evidence. Write findings to /tmp/wf/unicode-aux-findings.md.`,
  },
  {
    key: 'diffcorpus',
    label: 'diff-test-corpus',
    path: '/tmp/wf/corpus.txt',
    prompt: `${SHARED}

TASK: Build an exhaustive differential-test CORPUS of --domain argument values that will be
used to compare the Python oracle against the JS port. Do NOT run the whole corpus (the
oracle is saturated); just produce it, plus the runner.

Write /tmp/wf/gen-corpus.mjs which generates /tmp/wf/corpus.txt — ONE domain value per line,
real UTF-8 (no backslash-u escapes in the file), containing NO literal newline/tab/NUL inside
a value. Target 4000-8000 lines. Cover, at minimum:

- Plain ASCII: single label, multi label, trailing dot, uppercase, mixed case, digits,
  hyphens in every legal position, "a--b", "ab--cd", leading/trailing hyphen, 63/64-char labels,
  253/254-char domains (with and without trailing dot), empty labels, "." , ".." , "a..b".
- Already-encoded A-labels: xn--caf-dma.fr, XN--CAF-DMA, mixed case xn--, "xn--", "xn---",
  "xn--a-", xn--zzzzz, invalid punycode payloads, and A-labels that decode to something that
  then fails validation.
- Every major script with realistic domains: Latin-1 accents, Latin Extended-A/B, Greek
  (including final sigma), Cyrillic, Armenian, Georgian, Hebrew, Arabic, Persian, Urdu,
  Thaana, Syriac, Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada,
  Malayalam, Sinhala, Thai, Lao, Tibetan, Myanmar, Khmer, Hiragana, Katakana, Kanji, Hangul,
  Han, Cherokee, Ethiopic, Mongolian, Yi, Vai, N'Ko, Adlam, Tifinagh, Osage, Deseret, Gothic,
  Old Italic, CJK Ext B (astral plane).
- IDNA2008 edge cases: sharp s, final sigma, ZWJ/ZWNJ in valid and invalid contexts
  (Devanagari virama+ZWJ, Persian ZWNJ between joining letters, ZWNJ with no joiner context),
  U+00B7 middle dot (valid and invalid positions), U+0375, U+05F3, U+05F4, U+30FB,
  Arabic-Indic digits U+0660..U+0669 and U+06F0..U+06F9 (alone, and mixed - must fail).
- Bidi rule cases: RTL label starting with a digit, RTL label ending with a digit, RTL label
  mixing EN and AN, LTR label containing an RTL char, RTL label with trailing NSM, RTL label
  with a Latin char.
- Disallowed codepoints: underscore, space, at-sign, exclamation, percent, full-width chars,
  superscript two, the fi ligature, Roman numeral IV, Kelvin sign, ohm sign, U+3000,
  soft hyphen U+00AD, U+200B, U+FEFF, U+2060, control chars, U+E000 private use, U+FFFD,
  U+FFFF noncharacter, emoji U+1F600, regional indicator, variation selectors U+FE0F/U+E0100.
- Non-NFC input: "cafe" + U+0301, Hangul jamo sequences, Devanagari nukta sequences,
  Angstrom sign U+212B, U+FB2E, decomposed Vietnamese.
- Alternative dot separators: U+3002, U+FF0E, U+FF61 (alone and mixed with ASCII dots), and
  the interaction with Python's \`domain.split('.')\` which ONLY splits on U+002E.
- Stress: very long punycode, labels of exactly 63 chars after encoding, labels whose
  punycode expansion exceeds 63, domains whose ENCODED length exceeds 253 but whose input
  length does not.

Also write /tmp/wf/difftest.sh : a bash script taking (corpusFile, jsEntryPath, jobs) that for
each line runs BOTH \`/workspace/dataset/test1_executable --domain "$line"\` and
\`node <jsEntry> --domain "$line"\`, compares STDOUT byte-for-byte and EXIT CODE, and prints a
compact report of mismatches (with the line number, the value in backslash-u-escaped form,
and both outputs). It must be parallel (split into N chunks) and must be robust to values
containing spaces, quotes, backslashes, and leading dashes. STDERR must NOT be compared (the
Python traceback contains an unpredictable PyInstaller counter), but DO compare exit codes
exactly.

Do not run the full corpus. Just verify the runner works on a 20-line smoke subset (the JS
entry can be a stub you write that just echoes nothing) — keep oracle calls under 40.`,
  },
];

phase('Build');

const results = await pipeline(
  MODULES,
  (m) => agent(m.prompt, { label: `build:${m.label}`, phase: 'Build' }).then((r) => ({ m, report: r })),
  ({ m, report }) =>
    agent(
      `${SHARED}

TASK: Adversarially review the file(s) produced for the "${m.label}" module.
Primary deliverable path: ${m.path}
The implementer reported:
---
${report}
---

Read the actual file(s) on disk. Your job is to FIND DEFECTS, not to praise. Specifically check:
1. Does it violate any hard constraint (require(), module.exports, npm import, node:url,
   the punycode builtin, the URL class, missing .mjs suffix in relative imports)?
2. Correctness against the CPython / argparse / Unicode semantics described in the task.
   Re-derive the algorithm independently and compare, line by line.
3. Astral-plane (surrogate pair) handling: any place that uses .length, [i], charCodeAt,
   split(''), or a for..of/index mismatch on strings that can hold codepoints > 0xFFFF.
4. Integer overflow / precision: anywhere Python would use bignums.
5. Off-by-one in positions (Python reports 1-based positions).
6. Edge cases: empty input, single char, all-ASCII, all-non-ASCII.

You MAY fix defects directly by editing the file — do so, then re-verify it still loads and
that its self-test passes if one exists. You may use the oracle at most 30 times.

Return: a list of defects found (each with severity and whether you fixed it), and a final
verdict line "VERDICT: CLEAN" or "VERDICT: ISSUES REMAIN: ...".`,
      { label: `verify:${m.label}`, phase: 'Verify' },
    ).then((v) => ({ module: m.label, path: m.path, report, verdict: v })),
);

return results.filter(Boolean);
