export const meta = {
  name: 'idna-groundtruth-extract',
  description: 'Black-box extract IDNA2008/UTS46/bidi tables + CLI/print specs from test3_executable',
  phases: [
    { title: 'Extract', detail: 'parallel ground-truth extraction + spec probing' },
    { title: 'Audit', detail: 'adversarially audit each extraction for completeness' },
  ],
};

const COMMON = `
# Context
You are reverse-engineering, BY BLACK-BOX OBSERVATION ONLY, the behavior of the precompiled
executable /workspace/dataset/test3_executable so it can be reimplemented in pure Node.js ESM.

The Python source it was built from is /workspace/dataset/test3.py — READ IT FIRST. Summary:
  parser.add_argument('--domain', type=str, required=True)
  parser.add_argument('--strict', type=bool, required=True, default=False)
  ...
  if strict_mode: try: print(idna.encode(domain, strict=True)) except idna.core.IDNAError as e: print(f"strict_encode_error: {e}")
  else:           print(idna.encode(domain, strict=False))
  remapped = idna.uts46_remap(domain);  print(remapped)          # line 2 (NOT in try/except)
  print(idna.valid_string_length(remapped, trailing_dot=False))  # line 3
  first_label = domain.split('.')[0]
  if first_label: try: print(idna.ulabel(idna.encode(first_label))); print(idna.alabel(first_label)) except: pass

ALREADY-ESTABLISHED FACTS (trust these, do not re-derive):
* The bundled \`idna\` library's own codepoint tables are Unicode 16.0.
  The bundled Python \`unicodedata\` module is Unicode 15.0 (Python 3.12).
  So chars added in Unicode 15.1 (CJK Ext I U+2EBF0..U+2EE5D, U+2FFC..U+2FFF, U+31EF) and
  in Unicode 16.0 are known to \`idna\` but UNKNOWN to \`unicodedata\`.
  Node 18.19 (available here) has Unicode 15.1 property data.
* Observed error strings (exact):
    "strict_encode_error: Empty domain" / "Empty Label" / "Label too long" / "Domain too long"
    "Label must not start or end with a hyphen"
    "Label has disallowed hyphens in 3rd and 4th position"
    "Label begins with an illegal combining character"
    "Codepoint U+005F at position 3 of 'ex_ample' not allowed"           <- InvalidCodepoint
    "Codepoint U+XXXX not allowed at position N in 'label'"              <- InvalidCodepointContext
    "Unknown codepoint adjacent to joiner U+200D at position 1 in '...'"
    "Invalid direction for codepoint at position N in a right-to-left label"
    "Invalid direction for codepoint at position N in a left-to-right label"
    "Can not mix numeral types in a right-to-left label"
    "Unknown directionality in label 'X' at position N"
* uts46_remap() is called with default std3_rules=False, transitional=False, and finishes with
  unicodedata.normalize('NFC', output). Per-codepoint it either keeps the char, replaces it with a
  mapping string, deletes it, or raises InvalidCodepoint (which is NOT caught -> traceback, exit 1).
* A UTS46-disallowed codepoint anywhere in --domain makes the process exit with code 1 and print a
  Python traceback on stderr; stdout still contains line 1.

# Probe harness (USE IT)
/workspace/probe/lib.mjs exports:
  runSync(domain, strict='True') -> {rc, out, err, lines}
  runMany(domains[], strict='True', conc=48) -> array of same   // ~110 invocations/sec, 64 cores
  hex(cp), toRanges(sortedInts)
Write your own scripts under /workspace/probe/ and run them with \`node\`. Do NOT use python.
Never read the executable's bytes / strings / embedded package source — observation via execution only.

# Deliverables
Write your data/spec files exactly where told. Then return a CONCISE report (< 250 lines):
what you extracted, the file paths + exact schema, counts, and every surprise/edge case found.
Do not paste large tables into your report.
`;

const TASKS = [
  {
    key: 'uts46',
    label: 'extract:uts46-table',
    prompt: `${COMMON}
# YOUR TASK: extract the complete observable UTS46 remap function

Because the script only ever calls uts46_remap(domain) with defaults, the ONLY thing that matters is
the per-codepoint function  f(cp) -> string  (possibly empty = deleted)  |  DISALLOWED (raises).

## Technique (validated)
Build a domain of probe codepoints separated by '!' (U+0021 maps to itself under std3_rules=False):
  domain = '!' + cps.map(String.fromCodePoint).join('!') + '!'
Read stdout line 2 and split on '!'. Verified working:
  U+0041->"a", U+1E9B->"ṡ", U+00DF->"ß", U+03C2->"ς", U+00AD->"", U+FF20->"@",
  U+13A0->"Ꭰ", U+AB70->"Ꭰ", U+0E33->"ํา", U+2126->"ω", U+1E030->"а"
Caveats you MUST handle:
 - If ANY codepoint in the chunk is DISALLOWED the run exits rc=1; recursively bisect that chunk
   (or read the stderr message "Codepoint U+XXXX not allowed at position N in ..." which names the
   FIRST offender and lets you skip forward — much cheaper than bisecting).
 - Exclude '!' (U+0021) itself and '.' (U+002E) from chunks; determine those two separately.
 - Never put a probe codepoint adjacent to another probe codepoint (the '!' separators guarantee this),
   so the final NFC pass cannot merge across probes.
 - Chunk size ~200 works; tune for speed. Keep total invocations reasonable (< 60k).

## Scope
ALL codepoints 0x0..0x10FFFF must be accounted for. You do NOT have to probe every one:
 - Probe exhaustively every codepoint that Node considers assigned (\\p{Assigned}) and NOT
   \\p{Cs} / \\p{Co}, PLUS every codepoint in the Unicode 16.0 additions (which Node reports as
   unassigned but idna knows) — find those empirically: scan the unassigned-per-Node ranges with the
   same chunk technique; any that does NOT raise is a Unicode 16 addition. Do this scan over the full
   unassigned space efficiently using the "first offender position" from stderr to skip forward.
 - For \\p{Cs} (surrogates) and \\p{Co} (private use) verify a decent sample (>= 40 spread out) and
   record the conclusion rather than probing all 137k.

## Output
Write /workspace/probe/data/uts46.json :
{
  "unicodeNodeVersion": "15.1",
  "disallowedRanges": [[lo,hi],...],        // codepoints that raise
  "mappings": { "<cpDecimal>": "<replacement string>" },  // only where f(cp) !== the char itself
  "ignoredRanges": [[lo,hi],...],           // f(cp) === ""  (subset of mappings semantics; list too)
  "notes": "..."
}
Everything not in disallowedRanges and not a key of mappings is "kept as-is".
Also write /workspace/probe/data/uts46-raw.jsonl (one {"cp":N,"out":"..."} or {"cp":N,"disallowed":true} per line)
so later stages can re-verify.

Finally: write /workspace/probe/verify-uts46.mjs which re-probes a random sample of 3000 codepoints
(mix of mapped / valid / ignored / disallowed) and asserts uts46.json predicts them, and RUN it.
Report the pass rate (must be 100%).`,
  },
  {
    key: 'idna2008',
    label: 'extract:idna2008-classes',
    prompt: `${COMMON}
# YOUR TASK: extract the complete IDNA2008 codepoint classification used by idna's check_label

For every codepoint, classify into exactly one of: PVALID | CONTEXTJ | CONTEXTO | DISALLOWED.
(DISALLOWED covers UNASSIGNED too — idna raises InvalidCodepoint for both.)

## Signals (line 1 of stdout, with --strict True)
 - InvalidCodepoint      -> "strict_encode_error: Codepoint U+XXXX at position N of 'LBL' not allowed"
 - InvalidCodepointContext -> "strict_encode_error: Codepoint U+XXXX not allowed at position N in 'LBL'"
 - CONTEXTJ failure      -> "...Joiner U+200C not allowed at position N in ..." /
                            "...Unknown codepoint adjacent to joiner U+200D at position N in ..."
Note the two InvalidCodepoint vs InvalidCodepointContext wordings differ — use that to tell
DISALLOWED from CONTEXTO-with-failing-context.

## Technique (chunk scanning)
check_label runs in this order: check_nfc, check_hyphen_ok, check_initial_combiner,
per-codepoint class loop (reports FIRST offending codepoint + 1-based position), then check_bidi.
So: build ONE label (no dots) interleaving probe codepoints with U+4E00 (一, PVALID, participates in
no canonical composition):
  label = '一' + cps.map(c => c + '一').join('')      // probe i is at 1-based position 2i
  domain = label            // single label, no dot needed
Run with --strict True and parse line 1. The reported position tells you the first non-PVALID probe;
everything before it is PVALID (or a CONTEXT* char whose context happened to be valid). Then resume
scanning after it. If line 1 is NOT a codepoint error (e.g. 'Label too long', a bidi error, or
success) then ALL probes in the chunk passed the class loop.

Caveats:
 - Chunks whose probe char has NFC(c) != c will fail earlier with "Label must be in Normalization
   Form C". Compute that set in Node (there are ~1100) and probe each of those codepoints INDIVIDUALLY
   (label = '一' + c + '一').
 - Exclude U+002E '.' and U+4E00 itself from chunks; handle them separately.
 - Keep label under any argv limits; chunk of ~200 probes is fine.
 - line 2 (uts46_remap) may crash the process (rc=1) — line 1 is still on stdout, so that is harmless.
 - CONTEXTJ/CONTEXTO codepoints in a bare chunk will report a *context* failure (or pass). The full
   set of CONTEXTJ/CONTEXTO codepoints in IDNA2008 is small; identify each precisely.

## Scope
Exhaustive over all codepoints 0..0x10FFFF that Node reports \\p{Assigned}, plus a full scan of the
per-Node-unassigned space to find Unicode 16.0 additions that idna accepts (those will typically fail
LATER with "Unknown directionality in label ... at position N", which proves they passed the class
loop => PVALID). For \\p{Cs}/\\p{Co} sample >= 40 and record the conclusion.

## Output
Write /workspace/probe/data/idna2008.json :
{ "pvalidRanges": [[lo,hi],...], "contextjRanges": [...], "contextoRanges": [...], "notes": "..." }
(everything else is DISALLOWED)
Also /workspace/probe/data/idna2008-raw.jsonl with {"cp":N,"cls":"PVALID"|...} per line.

Then write /workspace/probe/verify-idna2008.mjs that re-probes a random stratified sample of 3000
codepoints one-at-a-time and asserts the table, and RUN it. Report pass rate (must be 100%).`,
  },
  {
    key: 'bidi',
    label: 'extract:bidi-classes',
    prompt: `${COMMON}
# YOUR TASK: extract the Bidi_Class information idna's check_bidi needs, as the bundled
# Unicode 15.0 unicodedata reports it.

idna's check_bidi(label) logic (reconstructed — VERIFY it):
  bidi_label = any(bidirectional(c) in ('R','AL','AN'));  if bidirectional(c)=='' -> IDNABidiError
      "Unknown directionality in label {label!r} at position {idx}"   (idx 1-based, first such char)
  if not bidi_label: return True
  d0 = bidirectional(label[0]); rtl = d0 in ('R','AL'); elif d0=='L': rtl=False else IDNABidiError
  for each char: if rtl: must be in (R,AL,AN,EN,ES,CS,ET,ON,BN,NSM) else
                   "Invalid direction for codepoint at position {idx} in a right-to-left label"
                 else: must be in (L,EN,ES,CS,ET,ON,BN,NSM) else "... left-to-right label"
                 valid_ending tracking (R,AL,EN,AN for rtl / L,EN for ltr; NSM leaves it unchanged)
                 EN/AN may not be mixed -> "Can not mix numeral types in a right-to-left label"
  if not valid_ending -> "Label ends with illegal codepoint directionality"

## What to extract
Only codepoints that can reach check_bidi matter, i.e. those classified PVALID / CONTEXTJ / CONTEXTO
by IDNA2008. Another agent is extracting that set into /workspace/probe/data/idna2008.json — it may
not exist yet, so ALSO derive your own candidate set in Node:
  gc in {Ll,Lu,Lo,Lm,Mn,Mc,Nd} plus U+00DF,U+03C2,U+06FD,U+06FE,U+0F0B,U+3007,U+200C,U+200D,
  U+00B7,U+0375,U+05F3,U+05F4,U+30FB,U+0660..U+0669,U+06F0..U+06F9
For each such codepoint determine which of these buckets it is in:
  UNKNOWN ('' -> Unicode 15.0 doesn't know it) | L | R_or_AL | AN | EN | NSM | OTHER_NEUTRAL
(R vs AL never matters to check_bidi, so one bucket is fine. NSM vs other neutrals DOES matter for
valid_ending, so separate it.)

## Cheap probe recipes (design and validate your own, these are starting points)
 - Is it UNKNOWN? label='一'+c  with an RTL char present, or simply: any label containing c whose
   other chars are fine produces "Unknown directionality in label ... at position N".
 - L vs not-L in an LTR label: label = 'x' + c1 + c2 + ... + 'x'  -> the FIRST char that is
   R/AL/AN triggers "Invalid direction ... in a left-to-right label" at its position. Since most
   codepoints are L this scans thousands per invocation. (Beware: a chunk with no R/AL/AN at all is
   not even a bidi label, so it returns success/other errors — that is your "all clear" signal.)
 - RTL-only allowances: label = 'א' + c + 'א'  -> L chars raise "...right-to-left label".
 - EN detection: label = 'א' + '\\u0660' + c   -> if c is EN you get "Can not mix numeral types".
 - AN detection: label = 'א' + '1' + c        -> if c is AN you get "Can not mix numeral types".
 - NSM vs other neutral: valid_ending. label = 'א' + c  -> if c is NSM the ending stays valid (א is R)
   so no "Label ends with illegal codepoint directionality"; if c is ON/ET/ES/CS/BN it becomes invalid.
 - Remember codepoints must be PVALID to reach check_bidi at all; verify each candidate individually
   where the chunked scan is ambiguous.

Also determine the exact set of codepoints for which unicodedata (Unicode 15.0) returns '' but idna
accepts as PVALID — i.e. the "Unknown directionality" set. Confirm CJK Ext I U+2EBF0..U+2EE5D,
U+2FFC..U+2FFF, U+31EF and the Unicode 16.0 additions.

## Output
Write /workspace/probe/data/bidi.json :
{ "unknownRanges": [[lo,hi],...],   // bidirectional() == ''  (restricted to PVALID-ish candidates; say so)
  "rtlRanges": [...],               // R or AL
  "anRanges": [...], "enRanges": [...], "nsmRanges": [...],
  "otherNeutralRanges": [...],      // ES/CS/ET/ON/BN
  "lRanges": [...],                 // explicit L list for the candidate set (or say "rest is L")
  "candidateSetDescription": "...", "notes": "..." }
Also write /workspace/probe/verify-bidi.mjs exercising >= 400 hand-built RTL/LTR/numeral/NSM labels
against the executable and comparing to a JS reimplementation of check_bidi driven by bidi.json; RUN it.
Report the pass rate and every discrepancy.`,
  },
  {
    key: 'cli',
    label: 'spec:argparse+print',
    prompt: `${COMMON}
# YOUR TASK: pin down the CLI surface and Python's print/repr formatting, exactly.

## A. argparse emulation
Probe exhaustively and write a precise spec:
 - --domain X / --domain=X / abbreviations (--dom, --d, --s, --str) and ambiguity errors
 - missing required args (exit 2 + exact usage+error text on stderr), unrecognized args
 - -h/--help exact text and exit code 0
 - '--' separator; a value that starts with '-' (e.g. --domain -abc) and with a digit
 - repeated options (last wins?), empty string values, values containing '=' or spaces
 - type=bool semantics: what makes strict falsy? (bool('') is False; every non-empty string is True)
 - argument order, interspersed, and what happens with '--strict' given no value
 - program name in usage: is it always "test3_executable"? (we will emit the same literal)
 - Does anything go to stdout vs stderr? exact trailing newlines.

## B. Python print()/repr() of bytes and str
line 1 (success path) prints a bytes object -> "b'...'" form. Determine EXACTLY how Python renders it:
which bytes get escaped (\\x, \\n, \\t, \\r, \\\\, \\'), and whether the quote flips to double quotes when
the value contains a single quote. Probe with domains that force such bytes into an alabel — note
alabel returns the ORIGINAL ascii bytes for all-ASCII labels, so e.g. a label containing a quote or a
backslash is easy to inject (they are DISALLOWED by IDNA2008 but the *error message* also repr()s the
label, which is a str -> gives you Python str-repr rules too).
For str repr in error messages, determine exactly which codepoints are escaped (\\xNN, \\uNNNN,
\\UNNNNNNNN) vs printed literally. Python uses str.isprintable(): NOT printable = categories
Cc,Cf,Cs,Co,Cn,Zl,Zp,Zs (except ASCII space U+0020 which IS printable). VERIFY this empirically with
>= 60 probes across those categories, including astral chars and lone-surrogate-ish cases.
Also check: how is a str repr'd when it contains both ' and "? (Python prefers ' unless the string
contains ' and not ", in which case it uses ").

## C. Uncaught-exception behavior
When uts46_remap raises (line 2) the process prints a traceback to stderr and exits 1. Capture the
EXACT stderr text for several cases and determine which parts vary (the "[PYI-NNN:ERROR]" number).
Also find any other input that produces an uncaught exception (e.g. domains starting with 'xn--'
that make the punycode codec raise UnicodeDecodeError/UnicodeError, or lone surrogates reaching
print()). Enumerate every distinct uncaught-exception shape you can find, with the exact stderr and
exit code, and which line of test3.py it came from.

## D. print() of the ulabel/alabel section
Confirm the exact conditions under which lines 4 and 5 are printed or suppressed (bare except).
Find inputs where line 4 prints but line 5 raises, and vice versa.

## Output
Write a thorough markdown spec to /workspace/probe/data/cli-and-print-spec.md and a machine-usable
/workspace/probe/data/cli-cases.jsonl of {"argv":[...],"rc":N,"stdout":"...","stderr":"..."} covering
>= 80 CLI cases (these become regression tests). Report the key rules concisely.`,
  },
  {
    key: 'core',
    label: 'spec:encode-alabel-ulabel',
    prompt: `${COMMON}
# YOUR TASK: pin down the exact control flow of idna.encode / alabel / ulabel / valid_string_length
# and the CONTEXTJ / CONTEXTO rules.

Reconstructed source to VERIFY and CORRECT by probing (report the corrected version):

  _alabel_prefix = b'xn--'
  def valid_label_length(l): return len(l) <= 63
  def valid_string_length(l, trailing_dot): return len(l) <= (254 if trailing_dot else 253)
  def check_hyphen_ok(label):
      if label[2:4] == '--': raise IDNAError('Label has disallowed hyphens in 3rd and 4th position')
      if label[0] == '-' or label[-1] == '-': raise IDNAError('Label must not start or end with a hyphen')
  def check_nfc(label):
      if unicodedata.normalize('NFC', label) != label: raise IDNAError('Label must be in Normalization Form C')
  def check_initial_combiner(label):
      if unicodedata.category(label[0])[0] == 'M': raise IDNAError('Label begins with an illegal combining character')
  def alabel(label):
      try:
          label_bytes = label.encode('ascii'); ulabel(label_bytes)
          if not valid_label_length(label_bytes): raise IDNAError('Label too long')
          return label_bytes
      except UnicodeEncodeError: pass
      check_label(label)
      label_bytes = _alabel_prefix + _punycode(label)
      if not valid_label_length(label_bytes): raise IDNAError('Label too long')
      return label_bytes
  def ulabel(label):
      if not isinstance(label, (bytes, bytearray)):
          try: label_bytes = label.encode('ascii')
          except UnicodeEncodeError: check_label(label); return label
      else: label_bytes = label
      label_bytes = label_bytes.lower()
      if label_bytes.startswith(_alabel_prefix):
          label_bytes = label_bytes[len(_alabel_prefix):]
          if not label_bytes: raise IDNAError('Malformed A-label, no Punycode eligible content found')
          if label_bytes.decode('ascii')[-1] == '-': raise IDNAError('A-label must not end with a hyphen')
      else:
          check_label(label_bytes); return label_bytes.decode('ascii')
      label = label_bytes.decode('punycode'); check_label(label); return label
  def encode(s, strict=False, uts46=False, std3_rules=False, transitional=False):
      labels = s.split('.') if strict else re.split('[.\\u3002\\uff0e\\uff61]', s)
      if not labels or labels == ['']: raise IDNAError('Empty domain')
      trailing_dot = False
      if labels[-1] == '': del labels[-1]; trailing_dot = True
      result = []
      for label in labels:
          s2 = alabel(label)
          if s2: result.append(s2)
          else: raise IDNAError('Empty label')
      if trailing_dot: result.append(b'')
      s2 = b'.'.join(result)
      if not valid_string_length(s2, trailing_dot): raise IDNAError('Domain too long')
      return s2

Things to determine precisely:
 1. The exact non-strict label separator set. Test U+002E, U+3002, U+FF0E, U+FF61 and confirm nothing
    else splits (try U+2024, U+FE52, U+FF0E, U+A4F8, etc). Confirm strict=True splits ONLY on '.'.
    Note: the script passes strict=bool(argv) so --strict '' gives strict=False.
 2. Which errors come from valid_label_length vs check_label first — for an all-ASCII 64+ char label,
    for a non-ASCII 64+ char label, and for an ASCII label >63 that is also invalid.
 3. Empty label vs Empty domain: exact inputs for each. Behavior of '.', '..', 'a.', '.a', '.a.',
    trailing/leading dots, multiple trailing dots, and non-strict mixed unicode dots.
 4. The 'xn--' A-label paths: 'xn--' alone, 'xn---', 'xn--a-', 'xn--!!', 'xn--zzzz' (invalid punycode),
    'xn--a-ecp', mixed case 'Xn--FSQ', an xn-- label whose decoded form is invalid/uppercase/empty,
    an xn-- label that decodes to something whose re-encoding differs. Record exact messages AND
    which of them are uncaught (traceback + exit 1) vs IDNAError.
 5. hyphen rules interaction with 2-char and 1-char labels (label[2:4] on short strings), and with
    labels that are exactly '--', '-', 'a-', '-a', 'ab--', 'ab--c'.
 6. valid_string_length thresholds: confirm 253/254 boundary for line 3 with trailing_dot=False by
    constructing remapped strings of length 252/253/254/255 (remember it is measured in CODEPOINTS of
    the NFC'd remapped string, not bytes — verify with astral chars and with chars whose mapping
    changes length).
 7. CONTEXTJ rules (RFC 5892 Appendix A.1/A.2) for U+200C and U+200D: verify exact behavior including
    the Virama rule and the Joining_Type L/D/T regex rule for ZWNJ, and error messages
    ("Joiner U+200C not allowed at position N in 'L'" vs "Unknown codepoint adjacent to joiner ...").
    Determine WHICH joining-type data the library uses and give a Node-derivable definition
    (Node has no \\p{Joining_Type}; you must characterize the needed sets empirically or by script
    families, e.g. Arabic/Syriac/Nko/Thaana letters, and enumerate the T set = transparent).
 8. CONTEXTO rules for U+00B7, U+0375, U+05F3, U+05F4, U+30FB, U+0660..0669, U+06F0..06F9 —
    exact accept/reject conditions and messages. Also confirm there are no others.
 9. Whether check_bidi is called for every label or only bidi ones, and the exact
    "Label ends with illegal codepoint directionality" trigger.
10. Anything where the reconstruction above is WRONG.

## Output
Write /workspace/probe/data/core-spec.md (precise, includes corrected pseudocode) and
/workspace/probe/data/core-cases.jsonl with >= 300 {"domain":..., "strict":"True"|"", "rc":N,
"stdout":..., "stderr":...} regression cases covering every branch you found. Report concisely.`,
  },
  {
    key: 'puny',
    label: 'spec:punycode',
    prompt: `${COMMON}
# YOUR TASK: verify a from-scratch RFC 3492 punycode implementation against the executable, in both
# directions, and characterize CPython's \`punycode\` codec quirks.

You MUST NOT use Node's built-in \`punycode\` module or the WHATWG URL class — they are banned in the
final deliverable. Write your own bootstring implementation in /workspace/probe/puny-ref.mjs
(base=36, tmin=1, tmax=26, skew=38, damp=700, initial_bias=72, initial_n=128, delimiter='-',
digits 'abcdefghijklmnopqrstuvwxyz0123456789').

CPython's encodings/punycode.py specifics to replicate/verify:
 - encode: segregate() collects ASCII (<128) chars as the basic string in order, and the set of
   non-ASCII chars sorted ascending; then insertion_unsort produces deltas; generate_integers uses
   bias=72 and adapt(delta, first, baselen+points+1). Output is base + b'-' + extended, or just
   extended when base is empty. NOTE: no b'-' is appended when base is empty.
 - decode: pos = text.rfind(b'-'); if pos == -1 base='' and extended=whole (upper-cased);
   else base=text[:pos], extended=text[pos+1:].upper(). Digits: A-Z -> 0..25, 0-9 -> 26..35.
   char > 0x10FFFF -> UnicodeError; NO surrogate rejection; no canonical-form check.

## Verification plan
 - alabel(label) for non-ASCII labels returns b'xn--' + punycode(label). Use the executable's line 5
   (idna.alabel(first_label)) as ground truth for ENCODE. Generate >= 4000 random labels drawn from
   PVALID codepoints (single script per label so bidi/context rules pass; keep length <= 40 and NFC
   normalized) and compare byte-for-byte with your implementation. Iterate until 100%.
 - ulabel(idna.encode(first_label)) (line 4) round-trips; and for domains whose first label is an
   'xn--' A-label, line 4 is the DECODE of it. Use that to test DECODE: generate >= 1500 xn-- labels
   (valid ones from your encoder, plus adversarial ones: uppercase, no delimiter, multiple hyphens,
   'xn--a-a-a', overflowing deltas, 'xn--zzzzzzzzzz', empty extended part, digits-only extended,
   'xn--0', 'xn--999999999999') and record the executable's exact behavior — success, IDNAError
   message, or uncaught traceback + exit code. Match your implementation's error taxonomy to it.
 - Explicitly find and document any case where CPython's punycode differs from strict RFC 3492
   (e.g. accepting non-canonical encodings, overflow behavior, producing surrogates).

## Output
/workspace/probe/data/punycode-spec.md  (algorithm + quirks + error taxonomy)
/workspace/probe/puny-ref.mjs           (verified reference implementation, ESM, zero deps)
/workspace/probe/data/punycode-cases.jsonl  (>= 1200 cases: {"kind":"encode"|"decode","in":...,"expect":...} )
Report the final pass rates.`,
  },
];

phase('Extract');
const results = await pipeline(
  TASKS,
  t => agent(t.prompt, { label: t.label, phase: 'Extract' }),
  (report, t) => agent(
`${COMMON}
# YOUR TASK: adversarially AUDIT another agent's extraction work for the "${t.key}" area.

Their report:
---
${report}
---

Do NOT trust it. Your job is to find what is missing or wrong:
 1. Verify the claimed output files exist, parse, and have the claimed schema and counts.
 2. Independently re-probe the executable on at least 800 NEW cases chosen to stress the areas the
    report is vaguest about, and on every boundary you can think of. Compare against their data.
 3. Look specifically for: silently dropped codepoint ranges, off-by-one range boundaries, astral
    (> 0xFFFF) handling, empty-string / deletion cases, Unicode 15.1-vs-16.0 disagreements between
    idna's tables and unicodedata, and any place their probe technique could have produced a false
    "all clear".
 4. If you find errors, FIX the data files in place (and re-run their verify script if present).

Return: a list of concrete defects found (with the exact probe that shows it) and what you fixed.
If you found nothing after genuinely hard probing, say so explicitly and list what you covered.`,
    { label: `audit:${t.key}`, phase: 'Audit' }
  ).then(audit => ({ key: t.key, report, audit }))
);

return results.filter(Boolean);
