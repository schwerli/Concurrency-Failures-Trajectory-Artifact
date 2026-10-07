export const meta = {
  name: 'probe-inflection-cpp',
  description: 'Black-box probe the C++ inflection binary to derive an exact behavioral spec for a Rust port',
  phases: [
    { title: 'Probe', detail: 'one agent per behavioral dimension, hammering the binary' },
    { title: 'Cross-check', detail: 'adversarially re-test each derived rule for counterexamples' },
  ],
}

const BIN = '/workspace/dataset/test15_executable'

const HARNESS = `
You are black-box reverse-engineering a compiled C++ binary at ${BIN}.
DO NOT look for or read any C++ library source (there is none on disk anyway).
DO NOT use \`strings\`, \`objdump\`, \`nm\`, \`gdb\`, or any binary/symbol inspection. Behavioral probing via command-line arguments ONLY.

The binary's driver program is exactly this:

  inflection::Inflector::initialize();
  std::vector<std::string> results;
  for (int i = 1; i < argc && i <= 5; i++) {
      std::string word = argv[i];
      results.push_back(inflection::Inflector::pluralize(word));
      results.push_back(inflection::Inflector::camelize(word));
      if (i % 2 == 0) results.push_back(inflection::Inflector::underscore(word));
  }
  for (const auto& r : results) std::cout << r << std::endl;
  if (argc > 1) {
      std::cout << inflection::Inflector::isPlural(argv[1]) << std::endl;
      std::cout << inflection::Inflector::isSingular(argv[1]) << std::endl;
      std::cout << inflection::Inflector::demodulize("Module::" + std::string(argv[1])) << std::endl;
  }

So to observe a function on an arbitrary word W:
  - pluralize(W)  -> line 1 of \`${BIN} "W"\`
  - camelize(W)   -> line 2 of \`${BIN} "W"\`
  - underscore(W) -> \`${BIN} dummy "W"\` prints: pluralize(dummy), camelize(dummy), pluralize(W), camelize(W), underscore(W), then isPlural/isSingular/demodulize of "dummy". So underscore(W) is line 5.
  - isPlural(W)   -> line 3 of \`${BIN} "W"\` (prints as 0/1 since it's a bool via operator<<)
  - isSingular(W) -> line 4 of \`${BIN} "W"\`
  - demodulize("Module::" + W) -> line 5 of \`${BIN} "W"\`

Run MANY probes (hundreds). Use bash loops. Quote arguments properly. Capture stderr too (2>&1 separately from stdout when it matters) and capture exit codes.
Be systematic: form a hypothesis, then design inputs that DISCRIMINATE between competing hypotheses, then confirm.
Report the exact rule as precise pseudocode operating on BYTES (the C++ code uses std::string = bytes; the "C" locale means std::toupper/tolower only affect ASCII a-z/A-Z). Explicitly test non-ASCII UTF-8 input to confirm byte-level behavior.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'spec_pseudocode', 'findings', 'goldens', 'uncertainties'],
  properties: {
    dimension: { type: 'string' },
    spec_pseudocode: { type: 'string', description: 'Exact, unambiguous pseudocode for the behavior, byte-level' },
    findings: { type: 'array', items: { type: 'string' }, description: 'Key discovered facts, incl. hypotheses ruled out and the discriminating input that ruled them out' },
    goldens: {
      type: 'array',
      description: 'Verified input->output cases. argv = args passed after the program name.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'stdout'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          stdout: { type: 'string', description: 'exact stdout with \\n for newlines' },
          exit_code: { type: 'integer' },
          note: { type: 'string' },
        },
      },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
}

const DIMS = [
  {
    key: 'pluralize',
    prompt: `Derive the COMPLETE behavior of inflection::Inflector::pluralize.

Already known from initial probing: it mostly just appends "s" (cat->cats, box->boxs, city->citys, person->persons, child->childs), and a small set of words is returned UNCHANGED. Confirmed unchanged: equipment, information, rice, money, species, series, fish, sheep, jeans, police. Confirmed NOT unchanged: news->newss, water->waters, data->datas, staff->staffs, advice->advices, music->musics, luggage->luggages, furniture->furnitures, bison->bisons, salmon->salmons, trout->trouts, swine->swines, aircraft->aircrafts, offspring->offsprings. Empty string -> empty string.

Your job:
1. Determine the EXACT and COMPLETE invariant/uncountable word set. Test the full Rails default uncountable list and many other plausible candidates (mass nouns, -ese nationalities like chinese/japanese, "shoes", "moose", "buffalo", "corps", "means", "scissors", "pants", "gold", "silver", "sand", "wheat", "flour", "butter", "cheese", "milk", "coffee", "tea", "beer", "wine", "bread", "meat", "chicken", "beef", "pork", "sugar", "salt", "pepper", "oil", "gas", "electricity", "energy", "power", "knowledge", "wisdom", "happiness", "sadness", "anger", "fear", "hope", "faith", "trust", "honesty", "courage", "patience", "kindness", "software", "hardware", "homework", "housework", "research", "evidence", "feedback", "traffic", "weather", "news", "mail", "email", "cash", "currency"). Report EXACTLY which are unchanged.
2. Case sensitivity of that set: test Fish, FISH, fIsh, Money, MONEY, Series, SERIES, Police, POLICE, Jeans, Equipment, etc. Is the lookup case-sensitive, case-insensitive, or does it lowercase then compare (and does the returned value preserve original case)?
3. Substring/word-boundary behavior: "fishing", "fishes", "myfish", "fish ", " fish", "fish\\tx", "big fish", "fish_bowl", "goldfish", "moneybag", "policeman", "seriesX". Does it match whole-string only?
4. Any other suffix rules at all? Exhaustively test words ending in: s, ss, sh, ch, x, z, y (consonant+y and vowel+y), o (consonant+o, vowel+o), f, fe, is, us, um, on, ix, ex, en, ouse, oot, ooth, an, and irregulars (man, woman, child, person, tooth, foot, goose, mouse, louse, ox, die, penny, quiz, hero, potato, echo, cactus, focus, radius, alumnus, syllabus, criterion, phenomenon, datum, medium, index, matrix, vertex, appendix, life, wolf, calf, thief, loaf, self, elf, hoof, roof, belief, chief, chef, safe, giraffe). Confirm whether EVERY non-uncountable word simply gets "s" appended.
5. Empty string, single chars, whitespace-only (" ", "  ", "\\t"), strings with newlines, very long strings (e.g. 5000 chars), strings with embedded NUL is impossible via argv so skip.
6. Non-ASCII UTF-8: "café", "naïve", "日本語", "Ω", "ﬁsh". Confirm it appends a literal 's' byte and does not corrupt bytes.
7. Leading/trailing whitespace and mixed case combined with uncountables: " fish", "Fish ", "FISH".

Report the exact rule and a rich golden set.`,
  },
  {
    key: 'camelize',
    prompt: `Derive the COMPLETE behavior of inflection::Inflector::camelize.

Initial probing (line 2 of \`${BIN} "W"\`) gave:
  hello_world->helloWorld, Hello_World->HelloWorld, hello__world->helloWorld, _hello->Hello, hello_->hello,
  HELLO_WORLD->HELLOWORLD, helloWorld->helloWorld, "hello world"->"hello world", hello-world->hello-world,
  hello.world->hello.world, a_b_c->aBC, "_"->"", "__"->"", _a->A, a_->a, 1_2->12, foo_bar_baz->fooBarBaz,
  Foo_bar->FooBar, foo_Bar->fooBar, active_record->activeRecord, active_record/errors->activeRecord/errors,
  x_1->x1, _x->X, ""->"".

Working hypothesis:
  out = ""; cap = false
  for each byte c in input:
     if c == '_': cap = true
     else if cap: out += toupper(c); cap = false
     else: out += c
  (first character is NOT capitalized unless preceded by '_'; trailing '_' produces nothing)

Your job: try HARD to falsify or refine this hypothesis.
1. Test whether ONLY '_' is a separator, or also '-', ' ', '.', '/', ':', tab, digits. (initial data says only '_', but confirm with e.g. "a-b", "a b", "a.b", "a/b", "a:b", "a\\tb", "a1b").
2. What exactly gets uppercased after '_': digits ("a_1"), symbols ("a_-b", "a_ b", "a_.b"), already-uppercase ("a_B"), non-ASCII ("a_é" — check the exact BYTES of the output; UTF-8 'é' is 0xC3 0xA9; confirm no byte is altered, which proves ASCII-only toupper).
3. Long runs of underscores: "a___b", "___a", "a___", "_", "__", "___".
4. Interaction with mixed case: "aBc_dEf", "ABC_DEF", "_ABC".
5. Only-underscores and empty input.
6. Is there any special handling for "::" or "/" (Rails camelize turns "/" into "::")? Confirm active_record/errors stays literal.
7. Very long input, and input with newlines/tabs (pass via bash $'...' quoting).
8. Non-ASCII: verify byte-for-byte using \`| xxd\` or \`| od -c\`.

Use \`od -c\` or \`xxd\` when bytes matter. Report the confirmed exact rule.`,
  },
  {
    key: 'underscore',
    prompt: `Derive the COMPLETE behavior of inflection::Inflector::underscore.

Observe it as line 5 of \`${BIN} dummy "W"\`.

Initial probing gave:
  HelloWorld->hello_world, helloWorld->hello_world, hello_world->hello_world, ActiveRecord->active_record,
  "ActiveRecord::Errors"->"active_record::_errors", HTMLParser->h_t_m_l_parser, XMLHttpRequest->x_m_l_http_request,
  getHTTPResponse->get_h_t_t_p_response, "Hello World"->"hello _world", hello-world->hello-world,
  ABC->a_b_c, aB->a_b, Ab->ab, A->a, a->a, ABCd->a_b_cd, AbC->ab_c, camelCase99Test->camel_case99_test.

Working hypothesis:
  out = ""
  for i, byte c in input:
     if isupper(c): { if i > 0: out += '_' ; out += tolower(c) }
     else: out += c

Your job: try HARD to falsify or refine this hypothesis.
1. Confirm the "i > 0" condition is about byte INDEX 0 specifically, not "output is empty" and not "previous char was a separator". Discriminating inputs: "_A" (index-0 test vs empty-output test both give... work it out and test), "-A", " A", "__A", "_AB". If the rule were "only skip the underscore when the output buffer is empty" then "_A" -> "_a"; if it is index-based then "_A" -> "__a". TEST THIS — it is the key discriminator.
2. Does it ever collapse existing underscores or avoid doubling? "A_B", "a_B", "A__B", "already_underscored", "Already_Underscored".
3. Digits: "A1B", "a1B", "1A", "99Test", "Test99".
4. Non-alpha and punctuation: "A-B", "A.B", "A/B", "A::B", "A B", tabs, newlines.
5. Non-ASCII UTF-8: "Café", "ÉCOLE", "日本語A". Verify with \`od -c\`/\`xxd\` that non-ASCII bytes pass through unchanged (proves ASCII-only isupper/tolower with the C locale).
6. Empty string, single chars (lower and upper), all-uppercase strings of length 1..5.
7. Very long input.
8. Also confirm underscore is only invoked for even argument indices (i%2==0 -> args 2 and 4) — verify by passing 4 and 5 args and mapping the output lines.

Use \`od -c\`/\`xxd\` when bytes matter. Report the confirmed exact rule.`,
  },
  {
    key: 'isPlural_isSingular',
    prompt: `Derive the COMPLETE behavior of inflection::Inflector::isPlural and isSingular.

Observe: line 3 = isPlural(argv[1]), line 4 = isSingular(argv[1]) of \`${BIN} "W"\`. They print as 0/1.

Initial probing: isPlural returned 1 for every tested word ENDING IN 's' — cats, boxes, churches, cities, boys, bus, buses, analysis, mice(? no: mice->1), s, ss, glass, class, pass, gas, lens, iris, axis, basis, crisis, thesis, diagnosis, alias, status, virus, campus, octopus, corpus, this, his, was, has, yes, plus, miss, kiss, boss, loss, dress, press, address, process, access — EXCEPT three notable exceptions that returned 0: "news", "series", "species".
isPlural returned 0 for every tested word NOT ending in 's'. isSingular was ALWAYS the exact complement of isPlural in every sample so far.

Your job:
1. Determine the EXACT and COMPLETE exception set: words ending in 's' for which isPlural is 0. Test at minimum: news, series, species, jeans, police(no s... skip), pants, scissors, trousers, glasses, means, alms, ethics, physics, mathematics, politics, economics, statistics, measles, mumps, billiards, darts, cards, works, goods, clothes, riches, thanks, regards, congratulations, headquarters, barracks, gallows, crossroads, kudos, bellows, innings, shambles, molasses, mosses, bus, plus, gas, this, us, is, as, os, es, "s", "ss", "es", "ies", "oes", "ses", "sis", "ses", and the full Rails uncountable list members that end in s (equipment/information/rice/money/species/series/fish/sheep/jeans/police -> only species, series, jeans end in s).
   In particular: is "jeans" an exception (isPlural 0) or not? This discriminates "isPlural consults the same uncountable list as pluralize" vs "isPlural has its own list".
2. Case sensitivity: News, NEWS, Series, SERIES, Species, SPECIES, Jeans, JEANS, Cats, CATS, CatS, catS, "CAT", "S", "cats"+uppercase variants. Does the trailing-'s' check accept uppercase 'S'? Test "CATS", "catS", "S", "SS", "NEWS".
3. Whitespace / boundaries: "cats ", " cats", "cats\\t", "the cats", "news ", " news", "cat s".
4. Empty string and single characters: "", "s", "S", "a".
5. Words ending in 's' that are 1-2 chars: "s","S","as","is","us","os","es","ss","ys".
6. Is isSingular ALWAYS !isPlural? Hunt for ANY input where they are equal (both 0 or both 1). Try hundreds of varied inputs including the exception set, empty, uncountables, non-ASCII.
7. Non-ASCII: does a UTF-8 word ending in a non-ASCII byte behave sanely? Test "café", "日本語", and a word ending in the byte 0xB4 etc. Also test a word whose last byte happens to be 's' after non-ASCII, e.g. "cafés".
8. Try to determine whether the underlying implementation looks like "singularize(w) != w" and, if so, whether any input reveals additional singularize invariants beyond news/series/species (e.g. words where isPlural is unexpectedly 0). Sweep a large English word list if one exists on the system (check /usr/share/dict/words); if present, run EVERY word ending in 's' through the binary and report EVERY word where isPlural==0. That gives the complete exception set empirically. Do this — it is the highest-value probe. If no dict exists, generate a large candidate list yourself (several hundred -s words).

Report the exact rule and the complete exception set.`,
  },
  {
    key: 'demodulize',
    prompt: `Derive the COMPLETE behavior of inflection::Inflector::demodulize.

Observe: line 5 of \`${BIN} "W"\` is demodulize("Module::" + W). Note the input ALWAYS has the literal 8-byte prefix "Module::".

Initial probing: W="cat" -> "at"; W="person" -> "erson"; W="a" -> ""; W="" -> the program CRASHES with std::out_of_range (substr __pos 9 > size 8). So there is an off-by-one: it skips 3 bytes past the found position of "::" instead of 2.

Competing hypotheses to DISCRIMINATE:
  (a) pos = rfind("::"); return s.substr(pos + 3)
  (b) pos = find("::");  return s.substr(pos + 3)
  (c) pos = rfind(':');  return s.substr(pos + 2)
  (d) pos = find(':');   return s.substr(pos + 3)
  (e) pos = rfind(':');  return s.substr(pos + 1) + something ... (consider others too)

Discriminating inputs (remember "Module::" is prepended):
  W = "A::B"   -> full input "Module::A::B" (len 12): (a)-> substr(12)="" ; (b)-> substr(9)="A::B" ; (c) rfind(':')=10 -> substr(12)="" ; (d)-> substr(9)="A::B"
  W = "a:b"    -> full input "Module::a:b" (len 11): (a) rfind("::")=6 -> substr(9)=":b" ; (c) rfind(':')=9 -> substr(11)=""
  W = "x::y::z", W = ":", W = "::", W = ":::", W = "a::", W = "::a", W = "a:", W = ":a"
Work out the predictions for each hypothesis yourself and run them ALL. Determine which single hypothesis explains every observation.

Also:
1. Characterize EXACTLY when it crashes (out_of_range) vs returns a value. Capture the exact stderr text and the exit code (use \`; echo "exit=$?"\`). Report the exact stderr bytes.
2. Test W values: "", "a", "ab", ":", "::", ":::", "::::", "a::", "::a", "a::b", "a::b::c", "x:y", "Module::x", "A::B::C::D", strings with trailing colons, whitespace.
3. Non-ASCII: W = "café", "日本語" — is the result a byte slice (possibly splitting a UTF-8 sequence)? Verify with \`od -c\`. This matters a lot: a Rust port must slice BYTES, not chars, and must not panic on invalid UTF-8 boundaries. Find an input where the C++ output is INVALID UTF-8 (e.g. W = "é" gives input "Module::é" where skipping 3 bytes from pos 6 lands mid-sequence — work it out and test).
4. Determine what happens with no "::" at all — you cannot test directly since "Module::" is always prepended, so instead REASON about it and state that the port only needs to be correct for inputs containing "::" (but suggest a safe fallback).

Report the single confirmed hypothesis with the evidence that rules out the others, plus a rich golden set including the crash case (exact stderr + exit code).`,
  },
  {
    key: 'driver_and_argv',
    prompt: `Characterize the DRIVER/CLI behavior of ${BIN} exactly — output ordering, argument count handling, exit codes, and stream behavior.

1. Run with 0 args: \`${BIN}\`. What is printed? exit code? (argc==1 so the loop body never runs and the argc>1 block is skipped -> expect empty output.)
2. Run with 1,2,3,4,5,6,7,8 args. Record the EXACT line ordering. Verify the loop condition \`i < argc && i <= 5\` means only args 1..5 are processed, and that underscore is emitted only for i==2 and i==4. Confirm the total line counts: for N processed args (N=min(argc-1,5)), lines = 2*N + (number of even i in 1..N) + 3. Verify empirically for N=0..7.
3. Verify all pluralize/camelize/underscore results are buffered into a vector and printed FIRST, then the three trailing lines. Confirm with distinctive args.
4. Exit code in the normal case. Also confirm output goes to stdout (not stderr): use \`${BIN} cat 2>/dev/null\` and \`${BIN} cat 1>/dev/null\`.
5. Is there a trailing newline after the last line? Confirm with \`od -c\`. (std::endl always emits '\\n', so the output should end with '\\n' when non-empty and be completely empty for 0 args.)
6. Test args that are empty strings in various positions: \`${BIN} "" x\`, \`${BIN} x ""\`, \`${BIN} "" "" ""\`. Note the crash comes from demodulize on argv[1] only. Record exact behavior + exit codes + whether earlier lines were flushed before the crash.
7. Test args with spaces, newlines (bash $'a\\nb'), tabs, leading dashes ("-h", "--help", "-"), and very long args. Confirm no special flag parsing.
8. Test with 5+ args where arg1 is empty (crash) — confirm the buffered lines ARE printed before the crash (since printing happens before demodulize).
9. Record the exact stderr text and exit code for the crash case, byte for byte (use \`2>&1 1>/dev/null | od -c\`).
10. Check locale sensitivity: run with LC_ALL=C, LC_ALL=en_US.UTF-8, LC_ALL=tr_TR.UTF-8 (if available) on inputs like "I" and "i" for camelize/underscore, to see whether toupper/tolower are locale-dependent. Report whether output changes. (This tells the Rust port whether plain ASCII case mapping is safe.)

Report exact line-ordering rules, counts, exit codes, and a rich golden set covering 0..7 args.`,
  },
]

phase('Probe')
const probes = await pipeline(
  DIMS,
  d => agent(`${HARNESS}\n\n=== YOUR DIMENSION: ${d.key} ===\n\n${d.prompt}`, {
    label: `probe:${d.key}`,
    phase: 'Probe',
    schema: SCHEMA,
    effort: 'high',
  }),
  (res, d) => {
    if (!res) return null
    return agent(
      `${HARNESS}\n\n=== ADVERSARIAL CROSS-CHECK: ${d.key} ===\n\n` +
      `Another engineer probed the \`${d.key}\` behavior of ${BIN} and produced this spec. ` +
      `Your job is to FALSIFY it. Assume it is subtly wrong. Design and run inputs specifically engineered to break it, ` +
      `then report every discrepancy between the spec's prediction and the binary's actual output.\n\n` +
      `SPEC PSEUDOCODE:\n${res.spec_pseudocode}\n\n` +
      `CLAIMED FINDINGS:\n${(res.findings || []).map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\n` +
      `CLAIMED UNCERTAINTIES:\n${(res.uncertainties || []).join('\n')}\n\n` +
      `Also independently VERIFY a sample of these claimed goldens by actually re-running the binary:\n` +
      `${JSON.stringify((res.goldens || []).slice(0, 40))}\n\n` +
      `Run at least 150 fresh discriminating probes. Report: (1) any golden that does NOT reproduce, ` +
      `(2) any input where the spec pseudocode predicts a different result than the binary, ` +
      `(3) a CORRECTED spec pseudocode if you found errors (or restate it verbatim if it survived), ` +
      `(4) new goldens covering the edge cases you found.`,
      { label: `falsify:${d.key}`, phase: 'Cross-check', schema: SCHEMA, effort: 'high' }
    ).then(v => ({ dimension: d.key, initial: res, crosscheck: v }))
  }
)

return { probes: probes.filter(Boolean) }
