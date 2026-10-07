export const meta = {
  name: 'characterize-inflection-binary',
  description: 'Black-box characterize each inflection API from the compiled C++ binary',
  phases: [
    { title: 'Probe', detail: 'one agent per API surface, 30-80 probes each' },
    { title: 'Adversarial', detail: 'independent re-derivation of the riskiest specs' },
  ],
}

const BRIEF = `
CONTEXT: You are reverse-engineering a compiled C++ "inflection" library (Rails-style Inflector) purely as a black box.
BINARY: /workspace/dataset/test11_executable   (run from any cwd; it needs no files)
USAGE: ./test11_executable <int num> <word>    -- requires argc > 2, then prints exactly 11 lines.
LINE MAP (1-indexed):
  1  pluralize(word)
  2  ordinalize(num)
  3  camelize(word, true)
  4  camelize(word, false)
  5  titleize(word)
  6  capitalize(word)
  7  truncate(word, 5)
  8  truncate(word, 10, "~")
  9  parameterize(word)
  10 parameterize(word, "_")
  11 isPlural(word)  -> prints 0 or 1
HOW TO PROBE ONE LINE:
  /workspace/dataset/test11_executable 1 'my_word' | sed -n '3p'
Use single quotes or printf to control argv exactly. To probe words containing spaces, quotes, newlines, backslashes, or
non-ASCII UTF-8, pass them as a SINGLE argv element (e.g. "$(printf 'a\\tb')" or 'héllo'). Empty word: '' (still argc>2).

ALREADY ESTABLISHED — treat as given, do NOT spend probes re-deriving:
  * pluralize(w) = w + "s", UNLESS w exactly (case-sensitively) equals one of the uncountables
      {equipment, information, rice, money, species, series, fish, sheep, jeans, police}  -> then w unchanged.
      (The library's 17 plural regex rules are dead code: the first registered rule /$/ -> "s" always matches first.)
  * isPlural(w) == (singularize(w) != w).  isSingular(w) == !isPlural(w).
  * The library registers 23 singular regex rules (Rails standard) plus a first rule /s$/ -> "" ; first match wins,
    iterating in registration order. There are NO irregular() pairs and NO human() rules (person->persons, child->childs).
  * An acronyms table exists containing exactly: HTML, HTTP, XML, JSON, API.
  * Other literals in the binary: "..." (truncate default omission), "-" (parameterize default sep), "_", " ", "::",
    "_id", "id", "th", "st", "nd", "rd".
  * The C++ is compiled with gcc-12, uses std::regex (ECMAScript grammar) and std::string (byte-oriented, no UTF-8 awareness).

OPTIONAL EXTRA TOOL: you may disassemble to resolve ambiguity (objdump and nm are at /opt/compiler/gcc-12/bin/, on PATH).
  objdump -dC --start-address=0xADDR --stop-address=0xADDR2 /workspace/dataset/test11_executable
  Symbol addresses: pluralize 0x405d12, singularize 0x405f84, camelize 0x406262, underscore 0x40636e, classify 0x40649a,
  tableize 0x40650a, humanize 0x406576, titleize 0x4066fe, ordinalize 0x40681c, dasherize 0x406992, parameterize 0x406a1a,
  isPlural 0x406bc0, isSingular 0x406c0c, upcase 0x406c2a, downcase 0x406cea, capitalize 0x406daa, decapitalize 0x406ed0,
  truncate 0x406f98, demodulize 0x40705a, deconstantize 0x4070c8, foreign_key 0x40716e, ordinal 0x4071e8, initialize 0x403cd4.
  Disassembly is a tiebreaker; observed behavior is the ground truth.

RULES OF ENGAGEMENT:
  * Do NOT write, create, or modify any file anywhere. Read-only + running the binary only. Never touch /output.
  * Run many probes (aim 40-80). Batch them in for-loops so it is cheap. Quote carefully.
  * Adversarially attack your own hypothesis: for every rule you state, try to find an input that breaks it.
  * The goal is a byte-exact Rust reimplementation using only std. Where behavior is byte-oriented rather than
    char-oriented (UTF-8 multibyte input), say so explicitly, because Rust's String indexing would panic there.
`;

const SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    spec: { type: 'string', description: 'Precise, complete, Rust-ready pseudocode/algorithm for the behavior. This is the deliverable an implementer will follow literally.' },
    evidence: {
      type: 'array',
      description: 'Up to 34 most informative probe pairs actually observed (exact bytes; use <empty>, \\n, \\t escapes for clarity).',
      maxItems: 34,
      items: {
        type: 'object',
        properties: {
          input: { type: 'string' },
          output: { type: 'string' },
        },
        required: ['input', 'output'],
      },
    },
    gotchas: { type: 'array', maxItems: 14, items: { type: 'string' }, description: 'Traps a Rust implementer would fall into (UTF-8 byte vs char, off-by-one, locale, empty string, panics).' },
    unresolved: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'Anything you could NOT determine from the exposed surface, and why.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['area', 'spec', 'evidence', 'gotchas', 'unresolved', 'confidence'],
};

const SLICES = [
  {
    key: 'camelize',
    prompt: `YOUR SLICE: camelize(word, bool) — lines 3 (bool=true) and 4 (bool=false).
Known: camelize("cat",true)=="cat", camelize("cat",false)=="Cat", so the bool appears to mean "lowercase the first letter".
Determine EXACTLY: how underscores, dashes, spaces, dots, digits, "::" / "/" path separators, leading/trailing/repeated
underscores are handled; whether the acronym table (HTML HTTP XML JSON API) is consulted (probe 'html_tag', 'api_key',
'xml', 'json_data', 'http_request', 'my_html_parser', and the same in mixed case); what happens to already-CamelCase or
UPPERCASE input; whether characters after the first are ever lowercased; empty string; word starting with a digit or
underscore or non-ASCII. Also determine whether the two bool variants differ ONLY in the first character.`,
  },
  {
    key: 'titleize',
    prompt: `YOUR SLICE: titleize(word) — line 5. Also infer the humanize/underscore behavior it is built on.
Determine EXACTLY: how underscores, dashes, spaces, multiple/consecutive separators are turned into words; whether a
trailing "_id" (or "id") is stripped (probe 'user_id', 'post_id', '_id', 'id', 'userid', 'user_ids'); whether camelCase
input is split on case boundaries (probe 'myWord', 'MyWord', 'HTMLParser', 'aB', 'ABCdef'); which characters get
capitalized and whether the rest of each word is lowercased (probe 'hello WORLD', 'mcdonald', "o'brien", 'x-ray');
whether the acronym table is consulted; digits ('word2word', '2word'); empty string; leading/trailing separators;
non-ASCII bytes. State the pipeline (e.g. underscore -> humanize -> capitalize each word) precisely.`,
  },
  {
    key: 'capitalize+truncate',
    prompt: `YOUR SLICE: capitalize(word) — line 6 — and truncate(word, 5) / truncate(word, 10, "~") — lines 7 and 8.
capitalize: determine whether the remainder of the string is lowercased or preserved (probe 'hello world', 'hELLO',
'HELLO WORLD', ' leading', '1abc', '_abc', "o'brien", empty, non-ASCII 'ábc' and 'éxample').
truncate: determine the exact algorithm. Known: truncate("person",5)=="pe...", truncate("cat",5)=="cat".
Probe every length from 0..16 (e.g. words 'a','ab','abc','abcd','abcde','abcdef','abcdefg',... 'abcdefghijklmnop') and
report line 7 AND line 8 for each, so the cutoff arithmetic for BOTH (len=5, omission="...") and (len=10, omission="~")
is pinned down exactly. Determine whether it counts BYTES or CHARACTERS by probing multibyte UTF-8 words
(e.g. 'ééééééé', 'aébcdéfghij', '日本語のテキストです') — report the exact bytes of the output (pipe through
'od -c' or 'xxd') and whether output can end mid-UTF-8-sequence. Also check whether truncate ever tries to break on a
word boundary (probe 'hello world foo' and 'ab cd ef gh ij kl').`,
  },
  {
    key: 'parameterize',
    prompt: `YOUR SLICE: parameterize(word) — line 9 (default separator "-") — and parameterize(word, "_") — line 10.
Determine the EXACT algorithm: which characters are kept, which are replaced by the separator, whether runs of
replaced characters collapse into ONE separator or produce one separator each; whether leading/trailing separators are
stripped; whether the result is lowercased; how an existing literal separator in the input behaves (probe 'a-b', 'a_b',
'a--b', 'a__b', '-abc-', '_abc_'); how the OTHER separator behaves in each mode (does parameterize(x,"_") strip or keep
'-'?). Sweep the whole printable ASCII charset one character at a time: for each byte c in 0x20..0x7E probe the word
'a' + c + 'b' and report which class c falls into. Also probe digits, uppercase, '.', '+', '&', '@', '/', '::', tab,
newline, and non-ASCII UTF-8 ('héllo wörld', 'Ünïcode', 'naïve café') reporting exact output bytes via od -c.
Finally probe empty string and a word made entirely of punctuation ('---', '###').`,
  },
  {
    key: 'ordinalize+atoi',
    prompt: `YOUR SLICE: ordinalize(num) — line 2 — and the argv-to-int conversion (C++ std::atoi) that feeds it.
Probe: 0, 1..30, 40, 42, 100..115, 120, 121, 1000, 1001, 1011, 1013, 1111, 1112, 1113, and NEGATIVES
(-1,-2,-3,-4,-11,-12,-13,-21,-111,-112) plus INT_MAX 2147483647, INT_MIN -2147483648. Report the exact output string.
Then pin down atoi semantics for non-canonical argv: '', 'abc', '12abc', 'abc12', ' 42' (leading spaces/tabs), '+7',
'--5', '007', '0x1A', '1e3', '3.9', '2147483648', '9999999999999999999', '-9999999999999999999', '1 2'.
For each, report the ordinalize line so the effective integer can be inferred. Distinguish saturation from wraparound
from zero. Give the exact suffix rule (th/st/nd/rd) including how negatives and the 11/12/13 mod-100 exception behave,
and state exactly how a Rust reimplementation must parse argv[1] to match glibc atoi byte-for-byte.`,
  },
  {
    key: 'singularize+isPlural',
    prompt: `YOUR SLICE: singularize semantics, observed through isPlural (line 11), which equals (singularize(w) != w).
Established: 24 singular rules, first-match-wins in registration order, first rule /s$/ -> "".
CRITICAL QUESTION 1 — iteration direction: forward (registration) order or reverse? Discriminator: 'news'.
  Forward: /s$/ matches -> "new" (!= news -> prints 1). Reverse: /(n)ews$/ -> "news" (== -> prints 0). Probe it.
  Find and probe MORE discriminators of the same shape (a word ending in 's' that some later rule maps to itself),
  e.g. 'series' is uncountable so useless, but consider 'ss', 'analyses', 'movies', 'shoes', 'buses', 'statuses'.
CRITICAL QUESTION 2 — are the regexes case-insensitive (std::regex::icase) or case-sensitive?
  Probe 'CATS','Cats','catS','NEWS','MICE','Mice','OXEN','QUIZZES','ANALYSES' vs lowercase counterparts.
CRITICAL QUESTION 3 — is the uncountable check case-sensitive and is it whole-string or last-word?
  Probe 'fish','FISH','Fish','red fish','red_fish','fishes','police','policeman'.
Also probe words ending in 's' vs not, to confirm every word ending in lowercase 's' yields 1 (and find counterexamples),
and probe the empty string. Deliver: the exact ordered rule list a Rust implementation should use for singularize, the
iteration direction, the case-sensitivity flags, and the uncountable lookup semantics.`,
  },
  {
    key: 'cross-cutting',
    prompt: `YOUR SLICE: cross-cutting / whole-program behavior — the things that make output byte-exact.
1. argc handling: run with 0 args, 1 arg, 2 args, 3+ args (extra args ignored?). Report exact stdout and EXIT CODE for each.
2. Empty word '': report ALL 11 lines exactly (use od -c to reveal empty lines).
3. Non-ASCII UTF-8 words: 'héllo', 'ÉCOLE', '日本語', 'naïve', 'Ünïcode', 'ß', and a Latin-1 (invalid UTF-8) byte word
   made with printf '\\xe9\\xe8'. For each, report all 11 lines as exact bytes (od -c). Determine whether case
   conversion touches bytes >= 0x80 at all (i.e. plain C locale std::toupper/tolower on signed char), and whether any
   function can emit invalid UTF-8 or split a multibyte sequence. This decides whether the Rust version must operate on
   bytes (Vec<u8>/as_bytes) instead of chars.
4. Words with whitespace/control chars: 'two words', ' lead', 'trail ', 'a  b' (double space), tab, newline inside the
   word, and a word of length 200. Report all 11 lines.
5. Confirm the output framing: exactly 11 lines, each terminated by '\\n', nothing else on stdout, nothing on stderr.
6. Whether the program's behavior depends on locale env vars (try LC_ALL=C vs LC_ALL=en_US.UTF-8 vs LANG=tr_TR.UTF-8
   on a word like 'istanbul'/'ISTANBUL') — this matters because Rust's to_uppercase is locale-independent.`,
  },
];

phase('Probe')
const probes = await parallel(SLICES.map(s => () =>
  agent(`${BRIEF}\n\n=== ${s.key} ===\n${s.prompt}`, { label: `probe:${s.key}`, phase: 'Probe', schema: SCHEMA, effort: 'high' })
))

const good = probes.filter(Boolean)
log(`${good.length}/${SLICES.length} probe reports returned`)

// Barrier is justified: the adversarial pass re-derives the riskiest specs and must see what the first pass claimed.
phase('Adversarial')
const RISKY = good.filter(p => ['parameterize', 'titleize', 'camelize', 'capitalize+truncate'].includes(p.area) || ['parameterize', 'titleize', 'camelize', 'capitalize+truncate'].some(k => (p.area || '').includes(k)))
const targets = RISKY.length ? RISKY : good

const checks = await parallel(targets.map(p => () =>
  agent(`${BRIEF}

=== ADVERSARIAL RE-DERIVATION: ${p.area} ===
Another engineer produced the spec below for this area. Your job is to BREAK it. Assume it is subtly wrong until proven
otherwise. Design probes specifically targeting its blind spots, boundary conditions, and any place it hand-waved.
Run at least 40 fresh probes of your own against the binary. Then report the CORRECTED, complete spec.
If the spec is right, say so explicitly and state which of its claims you independently confirmed with which probes.

--- SPEC UNDER TEST ---
${p.spec}
--- CLAIMED GOTCHAS ---
${(p.gotchas || []).join('\n')}
--- END ---`,
    { label: `refute:${p.area}`, phase: 'Adversarial', schema: SCHEMA, effort: 'high' })
))

return { probes: good, adversarial: checks.filter(Boolean) }
