export const meta = {
  name: 'idna-blackbox-spec',
  description: 'Black-box probe /workspace/dataset/test8_executable to extract an exact behavioral spec for a JS port',
  phases: [
    { title: 'Probe', detail: 'parallel probing agents, one per behavioral dimension' },
    { title: 'Critique', detail: 'completeness critic per dimension, then gap-filling re-probe' },
  ],
}

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string', description: 'The precise rule/behavior discovered' },
          evidence: { type: 'string', description: 'exact command(s) run and exact stdout/stderr/exit code observed' },
        },
        required: ['rule', 'evidence'],
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['dimension', 'findings'],
}

const COMMON = `
You are reverse-engineering a compiled Python program by black-box probing so it can be re-implemented in Node.js.

The program is at /workspace/dataset/test8_executable  (run it directly; DO NOT use python).
Its source is /workspace/dataset/test8.py -- READ IT FIRST, it is short. It uses argparse + the Python 'idna' package.

Known facts already established (do not re-derive, build on these):
- stderr may carry a DeprecationWarning about transitional processing; only stdout + exit code matter for output matching.
- The idna package's codepoint table is Unicode 16.0, but Python's unicodedata is Unicode 15.0. So a codepoint
  assigned only in Unicode 15.1/16.0 can pass the IDNA codepoint check and then fail with
  "Unknown directionality in label <repr> at position N".
- argparse 'type=bool' means bool(str): ANY non-empty string is True, empty string is False.
- Exit code 2 with usage on stderr for argparse errors.
- Errors already seen: "Empty domain", "Empty Label", "Label must not start or end with a hyphen",
  "Label has disallowed hyphens in 3rd and 4th position", "Malformed A-label, no Punycode eligible content found",
  "A-label must not end with a hyphen", "Codepoint U+XXXX at position N of <repr> not allowed",
  "Codepoint U+XXXX not allowed at position N in <repr>",
  "Unknown codepoint adjacent to joiner U+200C at position N in <repr>",
  "First codepoint in label <repr> must be directionality L, R or AL",
  "Invalid direction for codepoint at position N in a left-to-right label",
  "Label begins with an illegal combining character".

Useful shell technique for non-ASCII / control chars:
  D=$(node -e 'process.stdout.write("...")')   then   /workspace/dataset/test8_executable --domain "$D" --mode both
Always capture BOTH streams separately and the exit code, e.g.:
  ./test8_executable ... >/tmp/o 2>/tmp/e; echo "rc=$?"; cat /tmp/o; echo "--STDERR--"; cat /tmp/e

Run MANY probes (dozens to hundreds). Be systematic and exhaustive. Report EXACT strings, byte for byte,
including quoting/escaping. Your return value is a machine-consumed spec: precise rules + verbatim evidence.
`

phase('Probe')

const DIMENSIONS = [
  {
    key: 'argparse',
    prompt: `${COMMON}
DIMENSION: command-line argument parsing, exactly as Python's argparse does it here.

Probe and report exact stdout/stderr/exit-code for at least:
- missing --domain, missing --mode, missing both, no args at all
- --help and -h (exact full text, and exit code)
- --mode with an invalid choice (exact error text)
- --domain with a value that starts with '-' or '--' (e.g. --domain -abc.com), and the --domain=-abc.com form
- --domain= (empty value), --mode= (empty)
- prefix abbreviations: --dom, --do, --d, --mo, --tr, --st (which are ambiguous? exact errors)
- repeated options (--domain a --domain b): which wins?
- unrecognized options (--bogus x), extra positional args (foo), '--' separator usage
- --transitional / --strict given with values: True, False, 'false', '0', '', 'no' -- and what the SCRIPT does
  differently for each (remember bool(str)); also --transitional with NO value following it
- interspersed order of options
- exact usage/error message wording and line wrapping (the program name shown), and whether errors go to stderr
- what happens with --domain requiring an argument but at end of argv
Report each as a rule + verbatim evidence.`,
  },
  {
    key: 'encode-decode-core',
    prompt: `${COMMON}
DIMENSION: core encode/decode semantics and control flow of the script.

Probe and report:
- ASCII-only domains: is case preserved in the b'...' output? (e.g. UPPER.COM, MiXeD.CoM, XN--RSUM-BPAD.com)
  and what does the second printed line (the ulabel) look like for each?
- trailing dot: example.com. / example.com.. / .example.com / '.' / '..' / '' -- for modes encode, decode, both
- alternative dot characters: U+3002 (ideographic full stop), U+FF0E (fullwidth full stop), U+FF61
  -- test with --strict True and --strict False (strict changes how the domain is split). Determine the EXACT
  set of characters treated as label separators when strict is False.
- already-encoded input to encode: xn--rsum-bpad.com through --mode encode
- unicode input to decode: 'résumé.com' through --mode decode (does it succeed?)
- decode of mixed: 'xn--rsum-bpad.RÉSUMÉ' etc.
- the exact order of the printed lines for --mode both, and which lines are skipped when encode fails
- when encode fails but the ulabel step would succeed, and vice versa (the script has 'if first_label and encoded')
- the 4th line (valid_label_length of the first label): when is it printed, what values can it print
  (True/False), and what is the exact boundary (try first labels of length 62, 63, 64 ASCII chars)
- does valid_label_length operate on the RAW first label string (before encoding)? Probe with a first label of
  30 non-ASCII chars (raw length 30 but punycode length > 63) and with 64 ASCII chars.
- "Label too long" and "Domain too long" errors: find inputs that trigger each, exact text. Try a 63 vs 64 char
  label, and a total domain > 253 chars, both with and without trailing dot.
Report each as a rule + verbatim evidence.`,
  },
  {
    key: 'repr-formatting',
    prompt: `${COMMON}
DIMENSION: exact Python repr() formatting inside error messages, and exact bytes repr of the encode output.

The error messages embed repr(label) of a Python str. I must reproduce repr() character-for-character in JS.
Probe with labels containing (use the node -e trick to build them):
- a straight apostrophe ' and a double quote " and both together (does repr switch to double quotes?)
- backslash
- control chars: U+0000, U+0007, U+0008, U+0009, U+000A, U+000D, U+001B, U+007F, U+0080, U+009F
- non-BMP chars (astral, > U+FFFF) -- shown as \\U0001abcd (8 hex digits, lowercase hex?)
- BMP non-printable / unassigned like U+0378, U+FFFE, U+E000 (private use), U+2028, U+00AD (soft hyphen)
- printable non-ASCII like é, 例, ß (are they shown literally or escaped?)
- lone surrogates if reachable
Determine: when repr escapes vs prints literally, the exact escape forms (\\x41 / \\u1234 / \\U0001f600 / \\n / \\t),
and hex case. Also confirm the U+XXXX form used in messages (how many hex digits for astral codepoints?).
Also probe the b'...' bytes repr of the encode output for any case where it could contain unusual bytes.
Report each as a rule + verbatim evidence.`,
  },
  {
    key: 'contextj-contexto',
    prompt: `${COMMON}
DIMENSION: CONTEXTJ (U+200C ZWNJ, U+200D ZWJ) and CONTEXTO rules -- find both ACCEPTING and REJECTING cases.

Probe (build strings with node -e):
- Devanagari with virama then ZWNJ, e.g. U+0915 U+094D U+200C U+0937 ("क्\\u200cष") -> accepted?
- same with ZWJ (U+200D) after virama
- Persian/Arabic ZWNJ between joining letters, e.g. U+0645 U+06CC U+200C U+0631 U+0648 U+062F
- ZWNJ at start/end of label, ZWNJ between two Latin letters, ZWJ not after virama
- CONTEXTO codepoints: U+00B7 (middle dot, valid only between two U+006C 'l' -> try "l\\u00b7l" and "a\\u00b7a"),
  U+0375 (Greek lower numeral sign, must be followed by Greek), U+05F3/U+05F4 (must follow Hebrew),
  U+30FB (katakana middle dot: label must contain Hiragana/Katakana/Han), U+0660-U+0669 (Arabic-Indic digits
  cannot mix with U+06F0-U+06F9), U+06F0-U+06F9
  For each: find one ACCEPTED example and one REJECTED example, with the exact error text of the rejection.
- Full-width/other digit mixing.
Report each as a rule + verbatim evidence.`,
  },
  {
    key: 'bidi',
    prompt: `${COMMON}
DIMENSION: the bidi (RFC 5893) rules and their exact error messages.

Probe RTL labels (Hebrew/Arabic) and mixed labels to trigger each distinct bidi error message. Find the exact
wording for as many as possible, e.g. rules about: first codepoint directionality, allowed directions in an
RTL label, allowed directions in an LTR label, last codepoint of an RTL label, last codepoint of an LTR label,
mixing European (U+0030-U+0039) and Arabic-Indic (U+0660-U+0669) numbers in one RTL label,
trailing NSM (combining mark) at the end of a label.
Examples to try (build with node -e):
- Hebrew word + ASCII digit at end, Hebrew word + ASCII digit in middle, Hebrew + Latin letter
- Arabic word + Arabic-Indic digit, Arabic word + ASCII digit, both digit kinds in one Arabic label
- label ending in a combining mark (e.g. Hebrew letter + U+05B0), label ending in a hyphen-like char
- Latin label containing one Hebrew letter in the middle / at the end
- a label that is entirely digits (ASCII) -- accepted? entirely Arabic-Indic digits -- error?
Report each distinct message verbatim with the input that produced it (as a node -e expression + the codepoints).`,
  },
  {
    key: 'nfc-and-misc',
    prompt: `${COMMON}
DIMENSION: NFC normalization check, uppercase/case handling of NON-ascii input, and miscellaneous.

Probe:
- a label that is not in NFC form, e.g. 'e' + U+0301 (should differ from precomposed é). What is the exact
  error message? Try both --mode encode and --mode decode.
- an already-NFC label with combining marks that IS valid, e.g. Devanagari, Thai, Vietnamese.
- NON-ASCII uppercase input: 'RÉSUMÉ.com', 'Ä.de', 'İ.tr' -- is it rejected (uppercase is DISALLOWED in
  IDNA2008) and with what exact message? What is the position reported?
- U+00DF (ß) and U+03C2 (final sigma) -- accepted? (these are the classic transitional cases)
- The --transitional flag: prove whether it changes ANY output at all (try ß, final sigma, ZWJ, ZWNJ with
  --transitional True vs False).
- The --strict flag: prove exactly what it changes (dot splitting) with a concrete pair of runs.
- decode with a non-ASCII domain and --strict True vs False.
- Very long punycode / invalid punycode A-labels: 'xn--a', 'xn--0', 'xn--zzzzzzzzzzzz', 'xn--a-ecp.ru',
  'xn--9-zzzzzzzz', 'xn--pokxncvbs' -- report each exact error or success.
- An A-label whose punycode decodes to something that is itself invalid, and an A-label that decodes to pure
  ASCII (e.g. 'xn--a-0' style) -- what error?
Report each as a rule + verbatim evidence.`,
  },
]

const probed = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: SPEC_SCHEMA }),
  (spec, d) => spec == null ? null : agent(
    `${COMMON}

A prior agent probed the "${d.key}" dimension of ${'/workspace/dataset/test8_executable'} and produced this spec:

${JSON.stringify(spec, null, 2)}

Your job: be the COMPLETENESS CRITIC and GAP FILLER.
1. Identify what is missing, ambiguous, unverified, or likely WRONG in that spec for the purpose of writing a
   byte-exact Node.js reimplementation.
2. Actually RUN the probes needed to close those gaps (dozens more probes).
3. Return the MERGED, corrected, expanded spec (same schema): the prior findings you verified, corrected where
   wrong, plus everything new. Mark any finding you could not verify in openQuestions.
Do not merely restate the prior spec -- probe.`,
    { label: `critique:${d.key}`, phase: 'Critique', schema: SPEC_SCHEMA }
  )
)

return probed.filter(Boolean)
