export const meta = {
  name: 'probe-inflection-abi',
  description: 'Black-box characterize each Inflector API from the compiled C++ binary',
  phases: [
    { title: 'Probe', detail: 'one agent per API group, differential probing' },
    { title: 'Adversarial', detail: 'try to break each derived spec with new inputs' },
  ],
}

const BIN = '/workspace/dataset/test20_executable'

const COMMON = `
You are reverse-engineering a compiled C++ binary as a BLACK BOX. The C++ library source is NOT available and you must NOT look for it.

Binary: ${BIN}
Invoke: ${BIN} '<word>'      (exactly one argument)
It prints exactly 20 lines to stdout, one per API call, in this fixed order (1-indexed):
  1  pluralize(word)
  2  singularize(word)
  3  camelize(word)                       // default 2nd param
  4  camelize(word, false)
  5  underscore(word)
  6  classify(word)
  7  tableize(word)
  8  humanize(word)
  9  titleize(word)
  10 dasherize(word)
  11 parameterize(word)
  12 parameterize("A " + word + " Test")
  13 upcase(word)
  14 downcase(word)
  15 capitalize(word)
  16 decapitalize(word)
  17 truncate(word, 5)
  18 demodulize("Test::" + word)
  19 to_string(isPlural(word))    -> "0"/"1"
  20 to_string(isSingular(word))  -> "0"/"1"

With no argument it prints nothing. With an empty argument it ABORTS (std::out_of_range from
basic_string::substr inside demodulize) printing nothing to stdout.

TOOLING TIPS
- Extract one line:  ${BIN} 'word' | sed -n '5p'
- Show exact bytes:  ${BIN} 'word' | sed -n '5p' | od -c
- Loop:  for w in a b c; do printf '%s -> ' "$w"; ${BIN} "$w" | sed -n '5p'; done
- Use $'...' bash quoting for control bytes / high bytes, e.g. $'a\\tb', $'\\xc3\\xa9'.
- 'file' is unavailable; 'strings', 'od', 'sed', 'nl' work.
- The binary is fast; run HUNDREDS of probes. Be exhaustive, not economical.

GROUND RULES
- Every claim in your output MUST be backed by an observed probe you actually ran.
- Assume C locale: toupper/tolower/isalnum/isspace behave as ASCII-only; bytes >= 0x80 are
  unchanged by case ops and are NOT alnum. VERIFY this rather than assuming.
- Note operations are byte-based (std::string), not char-based. Test multi-byte UTF-8.
- Report the algorithm as precise pseudocode that a Rust programmer can transcribe with zero guessing,
  operating on BYTES.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['apis', 'probes_run', 'uncertainties'],
  properties: {
    apis: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'line', 'pseudocode', 'rust_sketch', 'evidence', 'edge_cases'],
        properties: {
          name: { type: 'string' },
          line: { type: 'integer' },
          pseudocode: { type: 'string', description: 'Exact byte-level algorithm, no ambiguity' },
          rust_sketch: { type: 'string', description: 'Compilable-ish Rust fn operating on &[u8]/String, std only' },
          evidence: {
            type: 'array',
            description: 'input -> observed output pairs actually run',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['input', 'output'],
              properties: { input: { type: 'string' }, output: { type: 'string' } },
            },
          },
          edge_cases: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    probes_run: { type: 'integer' },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
}

const GROUPS = [
  {
    key: 'pluralize',
    prompt: `Characterize ONLY line 1: pluralize(word).
Initial hypothesis from a quick look: it may simply append "s" unconditionally ("city"->"citys",
"boxes"->"boxess", "class"->"classs"). PROVE OR DISPROVE exhaustively.
Hunt hard for any irregular table or suffix rule: sheep fish deer series species news
man woman child person people mouse goose tooth foot ox index matrix vertex axis analysis
crisis datum medium bacterium criterion phenomenon alumnus cactus focus radius quiz half
leaf life knife wife wolf hero potato tomato echo veto piano photo church dish box buzz
penny money day boy toy key city baby fly library status virus campus bus gas atlas
And case variants (Cat, CAT, cAt), trailing punctuation, trailing space, digits, empty-ish
inputs like " " and "1", multibyte UTF-8, and very long strings.
Report the exact rule set (or "unconditional append s") with counterexamples you searched for.`,
  },
  {
    key: 'singularize',
    prompt: `Characterize ONLY line 2: singularize(word).
Observed so far: dogs->dog, bus->bu, boxes->box, cities->city, days->day, wolves->wolfe,
class->clas, mouse->mouse, men->men, x->x.
Determine the EXACT ordered rule list and the exact suffix->replacement mapping, including
whether "es" stripping is conditional on the preceding letters (test: cases faces notes houses
buses boxes churches dishes quizzes heroes potatoes shoes toes ties lies pies movies series).
Test: ies ves oes ses xes zes ches shes s ss us is as es, and short inputs "s" "es" "ies" "ves"
"a" "as", plus uppercase forms (DOGS, Dogs, CITIES, Cities, WOLVES), mixed (dogS, citieS),
words shorter than the suffix, trailing spaces, digits+s ("12s"), and UTF-8.
Give the exact ordered if/else chain.`,
  },
  {
    key: 'camelize',
    prompt: `Characterize lines 3 and 4: camelize(word) and camelize(word, false).
Working hypothesis to verify or refute:
  result = ""; cap = false
  for each byte c: if c=='_' { cap = true } else if cap { push toupper(c); cap=false } else { push c }
  line 4 additionally uppercases result[0] (if non-empty); line 3 does not.
Test heavily: leading underscore "_ab", trailing underscore "ab_", double "a__b", only "_", "__",
underscore before digit "a_1b", before non-alpha "a_-b", before UTF-8 "a_\\xc3\\xa9x",
mixed case inputs, dashes, spaces, "::", already-camel input, single char, digits-only,
and whether line 3 EVER lowercases the first byte (try "Hello_world", "HELLO_WORLD", "_Hello").
Also determine what line 4 does when result is empty or starts with a non-letter.`,
  },
  {
    key: 'underscore_dasherize',
    prompt: `Characterize line 5 underscore(word) and line 10 dasherize(word).
underscore hypothesis: for i,c in bytes: if isupper(c) && i>0 { push '_' } ; push tolower(c).
  Verify with: HelloWorld, ADMIN, aB, "Hello World", "Foo::Bar", "A", "AB", "aBC", "A1B",
  "-A", "_A", leading uppercase, consecutive uppercase runs, digits adjacent to uppercase,
  UTF-8 bytes adjacent to uppercase, and whether '-' is ever converted to '_'.
  Also check whether it de-duplicates underscores ("a_B" -> "a__b"?) and whether the i>0 test is
  positional or "previous char was not already an underscore".
dasherize hypothesis: replace every '_' byte with '-'. Verify it does nothing else (spaces,
  existing dashes, case, UTF-8).`,
  },
  {
    key: 'classify_tableize',
    prompt: `Characterize line 6 classify(word) and line 7 tableize(word).
Hypotheses: classify == camelize(singularize(word), false) i.e. upper-camel of the singular;
tableize == pluralize(underscore(word)).
Verify these COMPOSITION hypotheses precisely by comparing, for many inputs, line 6 against the
line-4 output of a run whose argument is the line-2 output, and line 7 against the line-1 output
of a run whose argument is the line-5 output. Automate this cross-run comparison in a bash loop
over at least 60 diverse words (camel, snake, kebab, spaced, uppercase, plural, singular,
punctuated, UTF-8, digits, single char). Report ANY input where the composition fails, and if it
fails give the true algorithm. Note: composition tests must skip inputs whose intermediate value
is empty (the binary aborts on an empty argument) - handle that separately by reasoning.`,
  },
  {
    key: 'humanize_titleize',
    prompt: `Characterize line 8 humanize(word) and line 9 titleize(word).
humanize hypothesis: replace '_' with ' ', then toupper the first byte. Check whether it also
  strips a trailing "_id" (Rails does): test "user_id", "id", "_id", "user_ids", "userid".
  Check whether it lowercases the rest ("aB" observed -> "AB" suggests NOT). Check squeezing of
  multiple underscores, leading/trailing underscores, trailing whitespace, empty-ish, UTF-8 first byte.
titleize hypothesis: capitalizeNext=true; for each byte: if c==' ' {push ' '; capNext=true}
  else if capNext {push toupper(c); capNext=false} else {push tolower(c)}.
  Verify: does it treat '_' or '-' or '\\t' as word separators too? Test "hello_world",
  "hello-world", $'a\\tb', "  spaced  ", "Foo::Bar", "HelloWorld", digits after space ("a 1b"),
  UTF-8 after space, and whether it underscore->space converts first.
Run at least 60 probes each.`,
  },
  {
    key: 'parameterize',
    prompt: `Characterize line 11 parameterize(word) and line 12 parameterize("A " + word + " Test").
Hypothesis: map each byte: isalnum -> tolower ; isspace -> '-' ; otherwise DROP.
Then trim leading and trailing '-' (but do NOT squeeze internal runs).
Evidence: "hello_world"->"helloworld", "a-b"->"ab", "Hello World"->"hello-world",
"  spaced  "->"spaced" while line 12 for that input is "a---spaced---test".
Verify precisely:
 - which whitespace bytes map to '-' (space, \\t, \\n, \\v, \\f, \\r) - use $'...' quoting;
 - whether '-' and '_' in the input are dropped or become separators;
 - whether internal runs are squeezed (try "a  b", "a - b", "a__b");
 - exact trimming semantics (only '-'? also whitespace? leading only? how many?);
 - a word that is entirely non-alnum (e.g. "---", "...", "  ") -> what comes out (and cross-check
   with line 12 which embeds it);
 - UTF-8 handling byte by byte;
 - digits preserved; uppercase lowered.
Use line 12 to infer behavior for inputs whose line-11 result is empty. Run 80+ probes.`,
  },
  {
    key: 'case_ops',
    prompt: `Characterize lines 13-16: upcase, downcase, capitalize, decapitalize.
Hypotheses: upcase = toupper every byte; downcase = tolower every byte;
capitalize = toupper(first byte) + tolower(rest); decapitalize = tolower(first byte) + rest unchanged.
Verify exhaustively over: all-ASCII printable range, digits, punctuation, whitespace-leading
strings, single char, UTF-8 (2-byte and 3-byte sequences, including Latin-1 supplement bytes
0xC0-0xDE which ARE uppercase letters in some locales - confirm they are UNCHANGED here),
raw high bytes if passable, mixed case, and strings starting with a non-letter.
Confirm byte-for-byte with od -c. Report whether any byte >= 0x80 is ever altered.`,
  },
  {
    key: 'truncate_demodulize',
    prompt: `Characterize line 17 truncate(word, 5) and line 18 demodulize("Test::" + word).
truncate hypothesis: if word.size() <= 5 return word; else return word.substr(0,5-3) + "...".
  Verify the exact threshold with lengths 1..12 (is it > 5 or >= 5?), whether length is in BYTES
  (test a 4-char/8-byte UTF-8 string), and whether it can split a UTF-8 sequence mid-way
  (test $'\\xc3\\xa9\\xc3\\xa9\\xc3\\xa9' - 6 bytes - expect a truncated byte sequence; dump with od -c).
demodulize: the argument is always "Test::"+word. Observed: word "cat" -> "at", "x" -> "",
  "Foo::Bar" -> "ar", "a-b" -> "-b".
  Two competing hypotheses:
   (A) pos = s.find_last_of(':'); return pos==npos ? s : s.substr(pos+2)
   (B) pos = s.rfind("::");       return pos==npos ? s : s.substr(pos+3)
  These differ when the word itself contains a SINGLE colon. DISCRIMINATE with words like
  "a:b", ":b", "b:", "a:b:c", "::x", "a::b", ":", "::". Work out what each hypothesis predicts,
  then run the probe and report which survives. Also test a word ending in ':' and a word that is
  exactly ":" (predict whether it aborts). Report exact bytes with od -c.
  Also state precisely what happens for the empty word (the known abort) under the surviving hypothesis.`,
  },
  {
    key: 'plural_flags',
    prompt: `Characterize lines 19 and 20: isPlural(word) and isSingular(word) (printed as 0/1).
Hypothesis: isPlural = (last byte == 's'); isSingular = !isPlural.
Test extensively: words ending in 's', 'S' (uppercase - "DOGS", "CatS"), "ss" ("class"),
non-s endings, single char "s" and "S", trailing space after s ("dogs "), trailing punctuation
("dogs."), digits ("12s", "123"), UTF-8 endings, and words the library considers irregular.
Also test whether isSingular is ever equal to isPlural (both 0 or both 1) - search hard for such
an input, e.g. very short strings, "s", "ss", "es", "us", "is", "as".
Also check whether an uncountable list exists (sheep, fish, series, news, information, equipment,
money, rice, water) - report their flag values.
Run 80+ probes and give the exact predicate for each.`,
  },
  {
    key: 'cli_edges',
    prompt: `Characterize the PROGRAM-level behavior, not individual APIs.
 - No arguments: exact stdout (should be empty), exit code.
 - Empty string argument: exact stdout, stderr, exit code (expected abort/134). Confirm nothing is
   printed to stdout before the abort.
 - More than one argument: is argv[2] ignored? (${BIN} a b)
 - Arguments that look like flags: "-h", "--help", "-", "--".
 - Argument containing a newline, tab, NUL-adjacent bytes, very long (10k chars) string.
 - Invalid UTF-8 raw bytes (use $'\\xff\\xfe').
 - Exit code in the normal case.
 - Confirm output is exactly 20 lines each terminated by '\\n' including the last one
   (check with od -c | tail).
 - Whether stdout is line-buffered / any trailing output.
Report precisely, including exact exit codes and whether stdout ends with a newline.`,
  },
]

phase('Probe')
const results = await pipeline(
  GROUPS,
  g => agent(`${COMMON}\n\nYOUR ASSIGNMENT (${g.key}):\n${g.prompt}`, {
    label: `probe:${g.key}`, phase: 'Probe', schema: SCHEMA,
  }),
  (spec, g) => {
    if (!spec) return null
    return agent(
      `${COMMON}\n\nA colleague derived the following spec for the "${g.key}" API group by probing the binary.\n` +
      `Your job is ADVERSARIAL: try hard to BREAK it. Construct inputs the spec would get WRONG,\n` +
      `run them against the binary, and compare against what the spec predicts.\n\n` +
      `SPEC UNDER TEST:\n${JSON.stringify(spec.apis, null, 2)}\n\n` +
      `Their stated uncertainties: ${JSON.stringify(spec.uncertainties)}\n\n` +
      `Run at least 100 adversarial probes. Focus on: boundary lengths, empty-ish strings, ` +
      `bytes >= 0x80, control characters, punctuation, repeated separators, case boundaries, ` +
      `and any branch the spec describes conditionally.\n` +
      `Return the CORRECTED spec (same schema). If the spec survives unchanged, return it verbatim ` +
      `but with your new probes appended to evidence and uncertainties emptied/updated.\n` +
      `List in uncertainties ONLY things you could not resolve by probing.`,
      { label: `refute:${g.key}`, phase: 'Adversarial', schema: SCHEMA, effort: 'high' }
    )
  }
)

const good = results.filter(Boolean)
log(`${good.length}/${GROUPS.length} API groups characterized`)
return good.flatMap(r => r.apis).map(a => ({
  name: a.name, line: a.line, pseudocode: a.pseudocode, rust_sketch: a.rust_sketch,
  edge_cases: a.edge_cases, evidence: a.evidence.slice(0, 40),
})).concat([{ name: '__uncertainties__', line: 0, pseudocode: JSON.stringify(good.flatMap(r => r.uncertainties)), rust_sketch: '', edge_cases: [], evidence: [] }])
