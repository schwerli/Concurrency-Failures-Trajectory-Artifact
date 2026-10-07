export const meta = {
  name: 'cpp-inflection-to-rust',
  description: 'Black-box characterize the C++ inflection binary, implement a dependency-free Rust port in /output, then differentially test to byte-identity',
  phases: [
    { title: 'Characterize', detail: 'parallel probing of each Inflector function against the C++ binary' },
    { title: 'Spec', detail: 'merge probe findings into one authoritative spec' },
    { title: 'Implement', detail: 'write the Cargo project, modules, and test13.rs; compile' },
    { title: 'Difftest', detail: 'parallel differential testing across corpus classes' },
    { title: 'Fix', detail: 'repair mismatches until dry' },
    { title: 'Audit', detail: 'adversarial review of requirements compliance' },
  ],
}

const BIN = '/workspace/dataset/test13_executable'

const COMMON = `
You are reverse-engineering a C++ library black-box. The compiled binary is ${BIN}.
It takes ONE command-line argument (call it W) and, only when argc > 1, prints exactly 13 lines:
  line 1  = Inflector::pluralize(W)
  line 2  = Inflector::singularize(W + "s")
  line 3  = Inflector::camelize("test_" + W)
  line 4  = Inflector::underscore("Test" + W)
  line 5  = Inflector::classify(W + "_table")
  line 6  = Inflector::tableize(W + "Class")
  line 7  = Inflector::humanize(W + "_id")
  line 8  = Inflector::titleize(W)
  line 9  = Inflector::dasherize(W)
  line 10 = Inflector::parameterize("The " + W + " Test")
  line 11 = Inflector::upcase(W)
  line 12 = Inflector::downcase(W)
  line 13 = Inflector::capitalize(W)
Each line is followed by "\\n" (std::endl).

Probe by running the binary and reading the relevant line, e.g.:
  ${BIN} 'someword' | sed -n 2p
Use printf/quoting carefully so W is passed verbatim (including empty string, spaces, punctuation, UTF-8, backslashes).
Note you can only observe a function through its fixed input template, so choose W to synthesize the inputs you need
(e.g. to test singularize on "cities", pass W='citie'; to test underscore on "TestFooBar", pass W='FooBar').

DO NOT read any C++ source (none is present anyway) and do not disassemble. Infer purely from input/output behavior.
Run MANY probes - dozens to hundreds. Be systematic and exhaustive; brute-force over suffixes/character classes.
Report byte-exact observations. Where you cannot observe a behavior through the template, say so explicitly
and mark it UNOBSERVABLE rather than guessing silently.
`

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'pseudocode', 'rules', 'evidence', 'unobservable'],
  properties: {
    area: { type: 'string', description: 'which functions this covers' },
    pseudocode: { type: 'string', description: 'precise language-agnostic pseudocode that reproduces the observed behavior exactly, byte-oriented' },
    rules: {
      type: 'array',
      description: 'ordered rule list / lookup tables discovered, if any',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern', 'replacement', 'note'],
        properties: {
          pattern: { type: 'string' },
          replacement: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
    evidence: {
      type: 'array',
      description: 'at least 25 concrete probe rows proving the pseudocode',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['arg', 'line', 'output'],
        properties: {
          arg: { type: 'string', description: 'the W passed to the binary' },
          line: { type: 'integer', description: 'which of the 13 lines' },
          output: { type: 'string', description: 'byte-exact observed output for that line' },
        },
      },
    },
    unobservable: { type: 'array', items: { type: 'string' } },
  },
}

const AREAS = [
  {
    key: 'pluralize',
    label: 'pluralize+uncountables',
    prompt: `${COMMON}
YOUR AREA: pluralize (line 1).
Determine exactly what pluralize does. Prior reconnaissance suggests it may simply append "s" unless the word is
in an "uncountables" set, with NO other rules (observed: class->classs, box->boxs, city->citys, church->churchs,
quiz->quizs, leaf->leafs, knife->knifes, hero->heros, bus->buss, analysis->analysiss, status->statuss,
person->persons, child->childs, mouse->mouses, cats->catss) while sheep/fish/money/information/series are unchanged.
Your job: (1) CONFIRM or REFUTE "append s unless uncountable" by trying hard to find ANY counterexample - sweep
many suffixes (y, o, f, fe, s, ss, sh, ch, x, z, us, is, um, on, ex, ix, a, i, eau, man, oof, ife, ...), plural-looking
inputs, mixed case, digits, punctuation, empty string, very long strings, multi-word strings.
(2) Enumerate the COMPLETE uncountables set. Do this by brute force: test a large candidate list of English
uncountable/invariant nouns (equipment, information, rice, money, species, series, fish, sheep, jeans, police,
water, milk, luggage, furniture, advice, news, music, knowledge, sand, sugar, salt, oil, air, homework, research,
traffic, weather, work, bread, butter, cheese, coffee, tea, deer, moose, offspring, aircraft, salmon, trout, swine,
staff, mail, help, wealth, evidence, progress, luck, fun, love, hate, art, beauty, courage, energy, food, fruit,
gold, grass, ice, jam, juice, meat, paper, patience, peace, pollution, power, pressure, rain, room, snow, soap,
software, hardware, space, speed, steam, sunshine, time, toast, transport, trash, garbage, travel, trouble,
violence, vision, wine, wood, wool, gas, glass, health, heat, history, housing, hunger, humour, imagination,
importance, industry, intelligence, kindness, labour, land, laughter, leisure, lightning, literature, logic,
loneliness, magic, management, marketing, mathematics, physics, economics, politics, statistics, gymnastics,
measles, mumps, diabetes, rabies, scissors, trousers, pants, pyjamas, clothes, goods, thanks, cattle, means,
alias, status, campus, corps, cosmos, apparatus, ...). Also test case sensitivity (Sheep, SHEEP, sHeEp),
whether matching is whole-string or last-word ("red sheep", "sheep_x", "the sheep"), and whether an uncountable
word with surrounding whitespace still matches.
Report the exact, complete uncountables list you could confirm, and state your confidence that the list is complete.`,
  },
  {
    key: 'singularize',
    label: 'singularize-rules',
    prompt: `${COMMON}
YOUR AREA: singularize (line 2). THIS IS THE HARDEST AREA - be extremely thorough.
IMPORTANT: you can only ever observe singularize(W + "s"), so the input ALWAYS ends in "s". That is fine -
that is also the only thing the program can ever exercise. Characterize singularize on inputs ending in "s".
Known reconnaissance data points (input -> output):
  cats->cat, classes->class, boxes->box, churches->church, cities->city, movies->movy, wolves->wolfe,
  houses->house, roses->rose, cases->case, horses->horse, mouses->mouse, statuses->status, alias->alia,
  his->hi, bus->bu, s->(empty), ss->s, sss->ss, bases->basis, theses->thesis, diagnoses->diagnosis,
  synopses->synopsis, parentheses->parenthesis, prognoses->prognosis,
  and the ANOMALY:  analyses->analyasis   (note the extra 'a' - a typo in the library's own rule table)
Your job: recover the ORDERED rule list exactly, including that anomaly, and determine precedence.
Systematically brute force. Suggested sweeps (remember: pass W = target minus its final "s"):
  - every 2/3/4-char suffix family ending in s: -s, -ss, -es, -ies, -ves, -oes, -ses, -xes, -ches, -shes,
    -sses, -zes, -ses, -uses, -ises, -ases, -oses, -eses, -ys, -os, -as, -us, -is, -ce s, -ice, -ices, -ax es...
  - the sis-family: try prefixes analy, ba, diagno, parenthe, progno, synop, the, cri, test, axi, neuro, hypothe,
    ellip, empha, oa, cri, and ALSO try them embedded (reanalyses, xbases, aanalyses, ANALYSES, Analyses, nalyses)
    to determine whether the rule is anchored to the string start or matches as a plain suffix, and whether it is
    case sensitive.
  - specific Rails-style special cases to test for presence/absence: series, news, shoes, buses, aliases,
    statuses, octopuses/octopi, viruses/viri, axes, crises, tests, testes, hives, natives/tives, moves, movies,
    lives, knives, wives, wolves, calves, halves, leaves, thieves, elves, shelves, oxes/oxen, mice, lice, dice,
    geese, feet, teeth, children, people, men, women, data, media, criteria, phenomena, indices, matrices,
    vertices, appendices, quizzes, buzzes, atlases, gasses, ...
  - is there an uncountables early-return in singularize? Probe W='serie' (=> singularize("series")),
    W='new' (=> singularize("news")), W='fi'/'fish' , W='sheep', W='mone' (=> singularize("moneys")),
    W='specie' etc. and decide.
  - case sensitivity of each rule (CITIES, Cities, WOLVES, BOXES, CLASSES).
  - degenerate inputs: "" (=> singularize("s")), "s", "ss", "e", "ie", "ve", "se", "oe", "xe", "che", "she".
For the analyses anomaly, pin down its EXACT scope with targeted probes: does 'reanalyses' -> 'reanalyasis'?
does 'Analyses' -> ? does 'analysis' (W='analysi') change? does 'analyse' (W='analys') change?
Deliver the ordered rule list precise enough to reimplement byte-for-byte, plus >=40 evidence rows.`,
  },
  {
    key: 'camelize',
    label: 'camelize+classify',
    prompt: `${COMMON}
YOUR AREA: camelize (line 3, template "test_"+W) and classify (line 5, template W+"_table").
Reconnaissance: camelize("test_foo_bar")="testFooBar", camelize("test_ABCdef")="testABCdef" (rest of segment NOT
lowercased), camelize("test___x")="testX", camelize("test_x__")="testX", camelize("test_1_2")="test12",
camelize("test_foo bar")="testFoo bar", camelize("test_foo-bar")="testFoo-bar", camelize("test_html_id")="testHtmlId",
camelize("test_HTTPServer")="testHTTPServer", camelize("test::Foo")="test::Foo".
classify("cat_table")="CatTable", classify("_table")="Table", classify("::Foo_table")="::FooTable",
classify("Foo.Bar_table")="Foo.BarTable".
Determine: which characters act as segment separators (only '_'? also '-', '/', '.', ' ', '::'?); exactly what
transformation is applied to each segment (uppercase first BYTE only? what if the segment starts with a digit,
punctuation, or a UTF-8 byte?); how empty segments are handled; whether the FIRST segment is transformed at all
(camelize's C++ signature is camelize(string, bool) with a default, and classify clearly uses the
uppercase-first variant while line 3 shows lowercase-first - note the first segment of line 3's input is always
literally "test" so its case-folding may be UNOBSERVABLE; say so if so, and report exactly what IS observable).
For classify determine whether it singularizes, whether it strips namespaces (leading "::", text before "." or
"::"), and the order of operations. Note the template always ends in "_table" so a singularize step may be a
no-op - verify and note.
Test acronym handling (is there an acronyms table? try id, html, http, url, api, xml, json, css, ip, tcp, sql,
uuid, db, io, ui, ssl, cli, gui as segments) - reconnaissance suggests NO acronym table since "id"->"Id".
Also test UTF-8 segments, digits-only segments, very many segments, and no-separator input.`,
  },
  {
    key: 'underscore',
    label: 'underscore+tableize',
    prompt: `${COMMON}
YOUR AREA: underscore (line 4, template "Test"+W) and tableize (line 6, template W+"Class").
Reconnaissance: underscore("TestFooBar")="test_foo_bar", underscore("TestABCdef")="test_a_b_cdef",
underscore("TestHTTPServer")="test_h_t_t_p_server", underscore("Testfoo-bar")="testfoo-bar" (hyphen NOT converted),
underscore("Test__x")="test__x", underscore("Test1_2")="test1_2", underscore("Test::Foo")="test::_foo",
underscore("TestFoo.Bar")="test_foo._bar", underscore("Testfoo bar")="testfoo bar".
Hypothesis to CONFIRM or REFUTE: for each byte at index i, if it is an ASCII uppercase letter then emit "_"
(only when i > 0, or maybe only when the output is non-empty, or maybe only when the previous byte is not
already '_' - DISTINGUISH these) followed by its lowercase; otherwise emit the byte unchanged (or lowercased?).
Design probes that separate those variants, e.g. W='_Foo' (=> underscore("Test_Foo")), W='-Foo', W='1Foo',
W=' Foo', and probes where an uppercase letter is the very first byte (impossible via this template since it
starts with 'T' - note as UNOBSERVABLE if so, but DO determine the i>0 vs prev-is-underscore question using
"Test_Foo" and "Test__Foo").
Also: are non-uppercase bytes passed through verbatim or lowercased (they are already lowercase in most probes -
find a discriminating probe, e.g. UTF-8 bytes, or note UNOBSERVABLE)? Is there any acronym grouping
(HTTPServer -> http_server would indicate yes; recon says no)? Does it convert "::" to "/" (recon says no)?
For tableize: confirm tableize(s) == pluralize(underscore(s)) exactly, including the uncountables interaction
(e.g. can you make underscore's output land on an uncountable word so pluralize is a no-op? try W such that
W+"Class" underscores to "sheep" - impossible since it always ends in "class"; instead verify the composition on
many inputs). Determine the composition order definitively (pluralize(underscore(x)) vs underscore(pluralize(x)))
with a probe where the two differ.`,
  },
  {
    key: 'humanize',
    label: 'humanize+titleize+dasherize',
    prompt: `${COMMON}
YOUR AREA: humanize (line 7, template W+"_id"), titleize (line 8, template W), dasherize (line 9, template W).
Reconnaissance: humanize("cat_id")="Cat id", humanize("foo_bar_id")="Foo bar id", humanize("FooBar_id")="FooBar id"
(rest NOT lowercased, no underscore() applied, no trailing "_id" stripping), humanize("cAT_id")="CAT id",
humanize("_id")=" id", humanize("a-b_id")="A-b id".
titleize("foo_bar")="Foo_bar", titleize("FooBar")="Foobar", titleize("cAT")="Cat", titleize("ABC")="Abc",
titleize("foo bar")="Foo Bar", titleize("foo  bar baz")="Foo  Bar Baz", titleize("a+b@c/d")="A+b@c/d",
titleize("  lead")="  Lead", titleize("trail  ")="Trail  ", titleize("")="".
dasherize("foo_bar")="foo-bar", dasherize("FooBar")="FooBar", dasherize("cat")="cat".
Confirm/refute these models and find the exact boundary conditions:
  humanize(s) = replace every '_' with ' ', then uppercase the FIRST byte only (no other change).
    - probe: multiple/leading/consecutive underscores, first byte being a space/digit/punct/UTF-8 byte, empty-ish
      inputs, whether it is uppercase-first-byte or uppercase-first-LETTER, whether trailing '_id' is special.
  titleize(s) = lowercase all bytes, then uppercase the first byte of every space-delimited word.
    - probe: which bytes count as word boundaries (space only? tab? newline? '_'? '-'? '.'? digits?),
      whether it applies underscore()/humanize() first (recon says no), leading/trailing/multiple spaces,
      UTF-8, digits at word start, single chars.
  dasherize(s) = replace every '_' with '-' and nothing else.
    - probe: consecutive underscores, case preservation, other characters, empty string.
Try to pass tab/newline/CR bytes as W (use $'\\t' style quoting or printf) to settle the whitespace question.
Give >=30 evidence rows across the three functions.`,
  },
  {
    key: 'parameterize',
    label: 'parameterize',
    prompt: `${COMMON}
YOUR AREA: parameterize (line 10, template "The " + W + " Test"). The C++ signature is
parameterize(string, string) - the second arg is a separator with a default (evidently "-").
Reconnaissance: W="cat" -> "the-cat-test"; W="" -> "the--test"; W="  " -> "the----test";
W="foo_bar" -> "the-foobar-test" (underscore DELETED, not converted); W="a-b" -> "the-ab-test" (hyphen DELETED);
W="a.b" -> "the-ab-test"; W="a+b@c/d" -> "the-abcd-test"; W="café" -> "the-caf-test";
W="ÄÖÜ" -> "the--test"; W="  lead" -> "the---lead-test"; W="trail  " -> "the-trail---test".
Hypothesis to CONFIRM or REFUTE: for each byte: if ASCII alphanumeric -> emit lowercase of it;
else if it is whitespace (or exactly ' '?) -> emit the separator; else emit NOTHING. Separators are NOT collapsed
and (unobservably here) may or may not be trimmed at the ends.
Design probes that settle:
  - is the separator emitted for ' ' only, or for all isspace bytes (tab, newline, CR, vertical tab, form feed)?
    Pass W=$'\\t', W=$'\\n', W=$'a\\tb', W=$'\\v', W=$'\\f', W=$'\\r' and report byte-exact results (use od -c
    or cat -A on the output line so you can SEE tabs/newlines; remember a newline in W will shift line numbering,
    so account for that carefully - a newline inside W means line 10 of the logical output may span two physical lines).
  - are runs of separators collapsed? (recon says NO)
  - are leading/trailing separators stripped? The template's fixed "The "/" Test" prevent a leading/trailing
    separator, so mark UNOBSERVABLE if you cannot construct one - but try hard (is there ANY way?).
  - are digits kept? underscores really deleted? high bytes (0x80-0xFF) deleted?
  - what happens with a very long W, and with bytes 0x01-0x1F?
Report byte-exact evidence (use od -c where whitespace is involved).`,
  },
  {
    key: 'case',
    label: 'upcase+downcase+capitalize',
    prompt: `${COMMON}
YOUR AREA: upcase (line 11), downcase (line 12), capitalize (line 13).
Reconnaissance: upcase("café")="CAFé" (the two UTF-8 bytes of é unchanged), upcase("ÄÖÜ")="ÄÖÜ",
downcase("ÄÖÜ")="ÄÖÜ", capitalize("cAT")="Cat", capitalize("ABC")="Abc", capitalize("FooBar")="Foobar",
capitalize("foo_bar")="Foo_bar", capitalize("A B")="A b", capitalize("  lead")="  lead",
capitalize("trail  ")="Trail  ", capitalize("  ")="  ", capitalize("")="" .
Hypothesis: all three are pure per-BYTE ASCII-only case mapping (bytes 0x80-0xFF untouched, i.e. the C locale),
capitalize = uppercase first byte + lowercase all remaining bytes.
Your job: verify EXHAUSTIVELY over the byte space. Write a loop that, for every byte value from 0x01 to 0xFF
(skip 0x00 since it cannot be passed in argv, and handle 0x0A newline specially because it shifts line numbering),
passes a W containing that byte in a safe context (e.g. W = 'a' + byte + 'z', built with printf) and compares
lines 11/12/13 against the pure-ASCII-mapping prediction. Use od -An -tx1 to compare byte-exactly.
Report any byte where the binary deviates from pure ASCII-only mapping.
Also confirm capitalize's behavior when the first byte is not a letter, and on 1-byte and empty inputs.
Be careful with shell quoting; prefer building args via printf and passing with "$(printf ...)" or use a small
helper script. Note that a raw newline byte inside W makes the physical line count exceed 13 - handle it by
reasoning about the full output rather than sed line numbers.`,
  },
  {
    key: 'cli',
    label: 'cli-and-io',
    prompt: `${COMMON}
YOUR AREA: process-level behavior, not the string functions.
Determine byte-exactly:
  - With NO arguments: what is printed (expect nothing) and what is the exit code?
  - With exactly one argument: 13 lines, each terminated by "\\n"? Is there a trailing newline after line 13?
    Confirm with: ${BIN} cat | od -c   and record the exact trailing bytes.
  - With MORE than one argument (e.g. ${BIN} cat dog extra): the C++ reads only argv[1] - confirm the extra
    args are ignored and output matches the single-arg case.
  - With an empty-string argument: ${BIN} '' - confirm 13 lines are printed (argc is 2 so the branch is taken).
  - Exit code in all cases (echo $?).
  - Is anything written to stderr? Check with 2>/dev/null vs 1>/dev/null.
  - Does Inflector::initialize() print anything? (it should not)
  - Is output flushed/ordered as a single stream (any interleaving oddity)? Check that stdout is the only stream used.
  - Behavior with an argument containing a NUL-ish or high-byte content, and with a very long argument (e.g. 100k chars) -
    does it still print 13 lines?
Report the exact process contract a Rust port must reproduce, including exit code and trailing-newline bytes.`,
  },
]

phase('Characterize')
log(`Probing ${AREAS.length} behavioral areas against the C++ binary in parallel`)

const specs = await parallel(AREAS.map(a => () =>
  agent(a.prompt, { label: a.label, phase: 'Characterize', schema: SPEC_SCHEMA })
))

const good = specs.filter(Boolean)
log(`Characterization complete: ${good.length}/${AREAS.length} areas returned specs`)

// Barrier is genuinely needed: the spec merge requires ALL areas at once.
phase('Spec')
const specDump = good.map(s => `#### AREA: ${s.area}\nPSEUDOCODE:\n${s.pseudocode}\n\nRULES:\n${
  (s.rules || []).map(r => `  ${JSON.stringify(r.pattern)} -> ${JSON.stringify(r.replacement)}   // ${r.note}`).join('\n')
}\n\nUNOBSERVABLE: ${(s.unobservable || []).join(' | ')}\n\nEVIDENCE (${(s.evidence||[]).length} rows):\n${
  (s.evidence || []).map(e => `  arg=${JSON.stringify(e.arg)} line=${e.line} out=${JSON.stringify(e.output)}`).join('\n')
}`).join('\n\n' + '='.repeat(70) + '\n\n')

const spec = await agent(`You are merging black-box reverse-engineering findings into ONE authoritative implementation spec
for a Rust port of a C++ "inflection" library.

Here are the per-area findings from ${good.length} independent probing agents:

${specDump}

Write the definitive spec as a single markdown document. Requirements for the spec:
- One section per function: pluralize, singularize, camelize, underscore, classify, tableize, humanize,
  titleize, dasherize, parameterize, upcase, downcase, capitalize.
- Byte-oriented semantics throughout (the C++ operates on std::string bytes with the C locale; ASCII-only case mapping).
- The COMPLETE ordered singularize rule list and the COMPLETE uncountables list, verbatim.
- Explicitly call out the singularize("analyses") -> "analyasis" anomaly and how to encode it.
- Note the exact process contract: 13 lines, trailing newline, exit code, arg handling, no-arg silence.
- Flag every genuinely UNOBSERVABLE behavior and give a recommended choice for it, noting it cannot affect
  observable output of this program.
- Resolve any contradictions between agents; if two agents disagree, say which evidence wins and why.
Return the markdown spec as your final text.`, { label: 'merge-spec', phase: 'Spec' })

phase('Implement')
const implPrompt = `Implement a pure-Rust (2021 edition), ZERO-dependency port of a C++ "inflection" library as a Cargo project in /output.

THE AUTHORITATIVE BEHAVIORAL SPEC (reverse-engineered from the C++ binary ${BIN}):

${spec}

THE C++ ENTRY POINT you are porting (/workspace/dataset/inflection-cpp/tests/test13.cpp), reproduced:
-----
#include "../inflection.hpp"
#include <iostream>
#include <cstdlib>

int main(int argc, char* argv[]) {
    inflection::Inflector::initialize();

    if (argc > 1) {
        std::string word = argv[1];

        // 13 API calls
        std::cout << inflection::Inflector::pluralize(word) << std::endl;
        std::cout << inflection::Inflector::singularize(word + "s") << std::endl;
        std::cout << inflection::Inflector::camelize("test_" + word) << std::endl;
        std::cout << inflection::Inflector::underscore("Test" + word) << std::endl;
        std::cout << inflection::Inflector::classify(word + "_table") << std::endl;
        std::cout << inflection::Inflector::tableize(word + "Class") << std::endl;
        std::cout << inflection::Inflector::humanize(word + "_id") << std::endl;
        std::cout << inflection::Inflector::titleize(word) << std::endl;
        std::cout << inflection::Inflector::dasherize(word) << std::endl;
        std::cout << inflection::Inflector::parameterize("The " + word + " Test") << std::endl;
        std::cout << inflection::Inflector::upcase(word) << std::endl;
        std::cout << inflection::Inflector::downcase(word) << std::endl;
        std::cout << inflection::Inflector::capitalize(word) << std::endl;
    }

    return 0;
}
-----

HARD REQUIREMENTS (from the user, all must hold):
1. Pure Rust, edition 2021, compiles with rustc 1.75.0 (NO features newer than 1.75 - e.g. no let-chains,
   no c"" literals, no OnceLock::get_or_init misuse... OnceLock IS stable in 1.70 so it is fine; LazyLock is NOT
   stable in 1.75, do NOT use it).
2. ZERO external crates. std only. No dev-dependencies either.
3. CLI args parsed via std::env::args(), same contract as the C++ binary (only argv[1] used; print nothing at all
   when there is no argument; exit code 0).
4. Output must be BYTE-FOR-BYTE identical to the C++ binary's stdout for every input.
5. Cargo project in /output. Library code organized into MODULES (not one giant file). The entry file must be at
   the package root: /output/test13.rs
6. Both of these must work:
     cd /output && rustc test13.rs        (produces /output/test13)
     cd /output && cargo build --release
   To make both work, declare the binary in Cargo.toml as:
     [[bin]]
     name = "test13"
     path = "test13.rs"
   and have test13.rs declare its modules with \`mod ...;\` so that plain \`rustc test13.rs\` resolves them from
   files next to test13.rs (e.g. /output/inflection/mod.rs + submodules). Do NOT use a src/lib.rs that only cargo
   can find, because plain rustc must work too.

IMPLEMENTATION GUIDANCE:
- Work on BYTES (u8), not chars, for case mapping and character classification, so UTF-8 and high bytes behave
  exactly like the C locale C++ code (bytes >= 0x80 are never case-mapped). Use to_ascii_uppercase /
  to_ascii_lowercase / is_ascii_alphanumeric etc.
- args_os()/args(): the C++ takes raw bytes. Prefer std::env::args_os() plus
  std::os::unix::ffi::OsStrExt::as_bytes() so that non-UTF-8 arguments are handled byte-exactly rather than
  panicking or lossily converting. Guard the unix-specific import so the code still builds if possible, or just
  target unix (the grader is linux). Write the result to stdout with std::io::Write::write_all on a locked
  stdout so no lossy conversion happens, and so output is byte-exact.
- Mirror the C++ API shape: an \`Inflector\` struct/impl with associated functions pluralize, singularize,
  camelize, underscore, classify, tableize, humanize, titleize, dasherize, parameterize, upcase, downcase,
  capitalize, plus initialize() (which may be a no-op or build the rule tables). Keep camelize/parameterize's
  optional second parameter expressible (e.g. camelize_with(s, upper_first) and a camelize(s) wrapper;
  parameterize_with(s, sep) and parameterize(s) wrapper) so the API mirrors the C++ defaults.
- Suggested module layout under /output/inflection/: mod.rs (facade + re-exports), ascii.rs (byte case/classify
  helpers), rules.rs (uncountables + ordered singular rule table), inflector.rs (the 13 functions).
- Add clear, brief comments where behavior is deliberately quirky (e.g. the "analyases" typo, the fact that
  pluralize only appends "s", that parameterize DELETES non-alphanumerics rather than replacing them).

DELIVERABLES:
- /output/Cargo.toml
- /output/test13.rs
- /output/inflection/*.rs (modules)
- Compile BOTH ways and make sure both succeed with no errors. Warnings should be eliminated where reasonable.
- Then smoke test: for W in cat dog person child mouse, compare your binary's stdout to ${BIN}'s stdout and
  confirm they are identical (use cmp or diff on the raw bytes).

Do the work now with real file writes and real compiler runs. Report what you created, the exact commands you ran,
and the smoke-test result. If the smoke test fails, FIX IT before returning.`

const implReport = await agent(implPrompt, { label: 'implement', phase: 'Implement' })
log('Implementation phase done; entering differential testing')

// ---- Differential testing: loop until dry ----
const DIFF_AREAS = [
  { key: 'basic', desc: `Plain English nouns and the 5 documented examples. Include: cat dog person child mouse
      horse house class box city boy quiz leaf knife hero photo bus church day sheep fish money information series
      status news analysis datum foot tooth goose man woman ox base thesis diagnose synopsis parenthesis prognosis
      movie wolf wolve life knive alias octopus virus axis crisis test testis hive native shoe atlas gas quizz
      and 200+ more common nouns. ALSO every word from an English word list if one exists on the system
      (/usr/share/dict/words) - if present, test at least 5000 words from it.` },
  { key: 'suffix', desc: `Systematic suffix sweep: for each suffix in a large set (s ss es ies ves oes ses xes ches
      shes zes us is um on ex ix a i o e y f fe ce se ge te le re ne me ke he ye we ve ue tion sion ment ness
      able ible al ial ful ic ical ous ive ize ise ...) combine with stems of length 0..4 (a, ab, abc, abcd, "",
      x, xy, sh, ch, ss, qu, ae, io) to make several thousand words. Also every 1-, 2-, and 3-character ASCII
      lowercase string (26 + 676 + 17576) - test ALL of them.` },
  { key: 'structure', desc: `Structural/punctuation stress: underscores (leading, trailing, doubled, tripled, only
      underscores), hyphens, dots, slashes, colons, "::", spaces (leading/trailing/multiple), mixed case patterns
      (camelCase, PascalCase, SCREAMING, sCrAmBlEd, ALLCAPS runs like HTTPServer XMLHTTPRequest), digits mixed with
      letters, strings that are pure punctuation, pure digits, and every ASCII printable character individually
      (0x20-0x7E) both alone and embedded as 'a<c>z'. Also empty string.` },
  { key: 'bytes', desc: `Byte-level and UTF-8 stress: UTF-8 text (café, naïve, ÄÖÜ, ß, 日本語, emoji, combining
      marks, RTL text), every single byte value 0x01-0xFF embedded as 'a<byte>z' built with printf (skip 0x00
      which cannot appear in argv; handle 0x0A newline carefully since it shifts physical line counts - compare
      the FULL raw stdout bytes with cmp rather than per-line), invalid/truncated UTF-8 sequences (0xFF, 0xC3
      alone, 0x80 alone, overlong encodings), and very long inputs (1KB, 64KB, 200KB of mixed content).` },
  { key: 'process', desc: `Process contract: no arguments at all; empty-string argument; two arguments; ten
      arguments; argument that looks like a flag (-h, --help, -); exit codes for every case (compare with
      echo $?); stderr emptiness; the exact trailing bytes of stdout (compare with od -c and cmp). Also confirm
      that BOTH build paths work: \`cd /output && rustc test13.rs\` and \`cd /output && cargo build --release\`,
      and that the resulting binaries agree with each other and with the C++ binary.` },
]

const DIFF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'casesRun', 'mismatches', 'notes'],
  properties: {
    area: { type: 'string' },
    casesRun: { type: 'integer', description: 'how many distinct inputs were actually compared' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['arg', 'lineNo', 'expected', 'actual'],
        properties: {
          arg: { type: 'string', description: 'the argument, shown so it can be reproduced (describe encoding if non-printable)' },
          lineNo: { type: 'integer', description: 'which output line differs, or 0 for whole-stream/process differences' },
          expected: { type: 'string', description: 'C++ binary output' },
          actual: { type: 'string', description: 'Rust binary output' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const diffPrompt = (a, round) => `You are differentially testing a Rust port against the reference C++ binary.

REFERENCE (ground truth): ${BIN}
CANDIDATE: the Rust program in /output. Build it first if needed:
   cd /output && rustc -O test13.rs -o /tmp/rust_test13_${a.key}_${round}
   (or use cargo build --release and the target/release/test13 binary)
   Build into a UNIQUE output path as shown so you do not race other testers. NEVER modify files in /output -
   you are a read-only tester. Do not run \`cargo build\` in /output if it would race others; prefer
   \`rustc -O test13.rs -o <unique tmp path>\`.

Compare BYTE-EXACTLY: for each test input, run both programs with the same argv and compare the complete raw
stdout (use cmp on files, or od -An -tx1, not visual inspection). Also compare exit codes.

Write a shell script to a unique temp file to drive this - do not do it by hand, you need thousands of cases.
Example harness:
   #!/bin/bash
   ref=${BIN}; cand=/tmp/rust_test13_${a.key}_${round}
   fail=0; n=0
   while IFS= read -r w; do
     n=$((n+1))
     "$ref" "$w" > /tmp/a.$$ 2>/dev/null; ra=$?
     "$cand" "$w" > /tmp/b.$$ 2>/dev/null; rb=$?
     if ! cmp -s /tmp/a.$$ /tmp/b.$$ || [ "$ra" != "$rb" ]; then
       fail=$((fail+1)); echo "MISMATCH arg=[$w]"; diff <(od -c /tmp/a.$$) <(od -c /tmp/b.$$) | head -20
     fi
   done < /tmp/words.txt
   echo "ran=$n fail=$fail"
Generate the input corpus programmatically (printf/seq/awk loops) so you get thousands of cases cheaply.

YOUR CORPUS AREA (round ${round}):
${a.desc}

Report the number of cases actually run and EVERY distinct mismatch (dedupe by root cause, but report at least
one concrete reproducer per root cause, with the exact bytes of the argument if it is not printable).
If you find zero mismatches, say so explicitly and report casesRun. Be honest: do not claim coverage you did not run.`

phase('Difftest')
let round = 1
let allMismatches = []
let dry = 0
while (round <= 3 && dry < 1) {
  const results = (await parallel(DIFF_AREAS.map(a => () =>
    agent(diffPrompt(a, round), { label: `difftest:${a.key}:r${round}`, phase: round === 1 ? 'Difftest' : 'Fix', schema: DIFF_SCHEMA })
  ))).filter(Boolean)

  const total = results.reduce((n, r) => n + (r.casesRun || 0), 0)
  const found = results.flatMap(r => (r.mismatches || []).map(m => ({ ...m, area: r.area })))
  log(`Round ${round}: ${total} cases compared across ${results.length} areas, ${found.length} mismatches`)

  if (found.length === 0) { dry++; break }

  allMismatches = allMismatches.concat(found)

  phase('Fix')
  const fixReport = await agent(`You are fixing a Rust port so its output becomes BYTE-IDENTICAL to a reference C++ binary.

REFERENCE: ${BIN}
CANDIDATE SOURCES: the Cargo project in /output (entry /output/test13.rs, modules under /output/inflection/).

Differential testing found these mismatches (expected = C++ ground truth, actual = current Rust output):
${found.map(m => `- area=${m.area} arg=${JSON.stringify(m.arg)} line=${m.lineNo}\n    expected=${JSON.stringify(m.expected)}\n    actual  =${JSON.stringify(m.actual)}`).join('\n')}

For EACH mismatch:
1. Reproduce it yourself against ${BIN} to confirm the reported ground truth (the tester may have made an error -
   verify before changing code; if a reported mismatch does not reproduce, say so and do not "fix" it).
2. Probe around it to understand the true general rule, not just the single case.
3. Fix the Rust source minimally and correctly. Keep the module structure, zero dependencies, edition 2021,
   rustc 1.75 compatibility. Keep the entry point at /output/test13.rs and both build paths working
   (\`cd /output && rustc test13.rs\` and \`cd /output && cargo build --release\`).
4. Rebuild and verify each formerly-failing case now matches byte-exactly, AND re-run a regression check over
   the 5 documented examples (cat, dog, person, child, mouse) plus a few hundred assorted words.

Report exactly what you changed and the verification output.`, { label: `fix:r${round}`, phase: 'Fix' })
  log(`Round ${round} fixes applied`)
  round++
}

phase('Audit')
const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'requirement', 'problem', 'evidence'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          requirement: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const AUDITS = [
  { key: 'requirements', prompt: `Audit the Rust project in /output against these user requirements, one by one, with
EVIDENCE from actually running commands (not from reading the code alone):
 R1. Pure Rust, edition 2021, compiles with rustc (check: \`cd /output && rustc test13.rs -o /tmp/audit_r1\` from a
     CLEAN state - note whether it emits ANY warnings or errors; also \`cd /output && cargo build --release\`).
     Verify Cargo.toml says edition = "2021".
 R2. CLI arguments identical to the C++ binary: parsed via std::env::args (or args_os), only argv[1] used,
     prints nothing with no args, exit code 0. Verify by running both.
 R3. Logic/output byte-identical to the C++ binary for the 5 documented examples AND a few hundred other inputs.
 R4. ZERO external dependencies: verify Cargo.toml has NO [dependencies] entries (or an empty one) and that no
     source file has \`extern crate\` or \`use\` of a non-std crate. Verify there is no Cargo.lock referencing
     any crates.io package, and that the build works with \`cargo build --release --offline\`.
 R5. Complete Cargo project in /output, library code organized into MODULES (more than one file), and the entry
     test file at the package root /output/test13.rs.
 R6. An executable is produced (\`cd /output && rustc test13.rs\` yields /output/test13 - confirm the file exists
     and is executable AND that it matches the C++ binary's output).
Report a verdict and any findings. Be adversarial and precise; run the commands.` },
  { key: 'code', prompt: `Adversarially code-review the Rust sources in /output (test13.rs and inflection/*.rs) for
CORRECTNESS bugs that differential testing might have missed. Specifically hunt for:
 - panics: indexing/slicing that can go out of bounds, unwrap()/expect() on user input, integer underflow on
   \`len - N\` when the string is shorter than N (VERY likely in singularize suffix rules - test short inputs
   like "", "s", "es", "ies" and every 1-3 char input), UTF-8 boundary panics from String slicing.
   Actually RUN the binary on those inputs and confirm no panic.
 - char vs byte confusion: any use of .chars(), .to_uppercase(), .to_lowercase(), char::is_alphanumeric,
   or String indexing that would treat multi-byte UTF-8 differently from the C++ per-byte C-locale behavior.
   Prove any suspicion by running both binaries on a UTF-8 input.
 - lossy argument handling: String::from_utf8_lossy or args() panicking/replacing on non-UTF-8 argv.
   Test with a non-UTF-8 argument built via printf '\\xff' and compare byte-exact output with the C++ binary.
 - output encoding: println! on a String vs write_all on bytes; any place non-UTF-8 bytes could be mangled.
 - rule ORDER bugs in singularize (first-match-wins vs last, and the analyses/analyasis special case).
 - the uncountables lookup: case sensitivity and whole-string-vs-substring matching.
For every suspected bug, CONFIRM it by running both binaries and showing the differing bytes. Do not report
theoretical issues you could not reproduce - mark those as minor at most. Report verdict + findings.` },
  { key: 'coverage', prompt: `You are a completeness critic for a C++ -> Rust port verification effort.
The Rust project is in /output; ground truth is ${BIN}.
Ask: WHAT WAS NOT TESTED? Then actually test it. Consider input dimensions that a straightforward corpus would
miss, for example: arguments that are exactly the uncountable words in every case variant; inputs that make the
singularize rules interact (a word that matches two rules); inputs where pluralize's uncountable check could
collide with tableize's internal pluralize; inputs of length 0 and 1; inputs consisting only of separators;
inputs with a trailing backslash; inputs that look like shell metacharacters; inputs with embedded newlines
(compare FULL raw stdout, not per-line); inputs with 0x7F and 0x1B; extremely long inputs; repeated identical
runs (determinism); and running from a different working directory.
Find and run at least 15 test dimensions the obvious corpus would miss, at least a few hundred cases total.
Report any real mismatch as a blocker with a reproducer. If everything matches, report PASS and list the
dimensions you covered so the coverage claim is auditable.` },
]

const audits = (await parallel(AUDITS.map(a => () =>
  agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: AUDIT_SCHEMA })
))).filter(Boolean)

const blockers = audits.flatMap(a => (a.findings || []).filter(f => f.severity === 'blocker' || f.severity === 'major'))
log(`Audit: ${audits.map(a => a.verdict).join(', ')} | ${blockers.length} blocking/major findings`)

if (blockers.length) {
  phase('Fix')
  const finalFix = await agent(`Final repair pass on the Rust port in /output. An adversarial audit raised these
blocking/major findings:

${blockers.map(f => `- [${f.severity}] requirement=${f.requirement}\n    problem=${f.problem}\n    evidence=${f.evidence}`).join('\n')}

Reference C++ binary: ${BIN}.
For each finding: reproduce it first (reject it explicitly if it does not reproduce), then fix it properly.
Preserve: zero dependencies, edition 2021, rustc 1.75 compatibility, module structure, entry at /output/test13.rs,
and BOTH build paths (\`cd /output && rustc test13.rs\` and \`cd /output && cargo build --release\`).
Afterwards, re-verify byte-identity against ${BIN} over the 5 documented examples plus at least 2000 assorted
inputs (including empty string, 1-3 char strings, UTF-8, punctuation, and a non-UTF-8 argument), and confirm
\`cd /output && rustc test13.rs\` leaves a working /output/test13 executable.
Report what you changed and paste the final verification numbers.`, { label: 'final-fix', phase: 'Fix' })
  log('Final fixes applied')
  return { spec, implReport, mismatchesFound: allMismatches.length, audits, finalFix }
}

return { spec, implReport, mismatchesFound: allMismatches.length, audits, blockers: 0 }
