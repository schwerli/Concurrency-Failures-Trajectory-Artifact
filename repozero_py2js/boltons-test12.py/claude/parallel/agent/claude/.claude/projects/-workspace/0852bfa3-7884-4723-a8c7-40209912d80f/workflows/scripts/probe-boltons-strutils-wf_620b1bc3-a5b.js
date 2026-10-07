export const meta = {
  name: 'probe-boltons-strutils',
  description: 'Black-box reverse-engineer pluralize/cardinalize/unit_len + argparse CLI from a compiled executable',
  phases: [
    { title: 'Sweep', detail: 'parallel probe agents map each behavioral facet' },
    { title: 'Critique', detail: 'completeness critic finds unprobed surface' },
    { title: 'Gapfill', detail: 'probe whatever the critic surfaced' },
  ],
}

const COMMON = `
You are reverse-engineering a compiled Python executable BLACK-BOX.

HARD RULES:
- The ONLY way to observe behavior is running /workspace/dataset/test12_executable
- NEVER run python/python3/pip, never try to read/extract/unpack the executable, never import or inspect the boltons package, never search the internet or your memory of boltons source as ground truth. Every claim must come from an actual observed executable run. (You may use knowledge of English to GENERATE candidate words to probe - that is encouraged.)
- Read /tmp/probe/README.md first for the harness docs.

The executable wraps this Python:
  items = args.a.split(',')
  print(unit_len(items, args.b))          # line 1
  print(cardinalize(args.b, len(items)))  # line 2  <- pluralize(b) when len != 1
  print(unit_len(items[:3], args.b))      # line 3
  print(cardinalize(args.b, 1))           # line 4  <- singular form
  print(unit_len(items[:1], args.b))      # line 5

Helpers (already created, ~0.14s per run, batch.sh does ~200 words/sec with P=32):
  /tmp/probe/plu.sh WORD          -> pluralize(WORD)
  /tmp/probe/p.sh WORD [count]    -> all 5 lines
  /tmp/probe/batch.sh FILE        -> "word<TAB>plural" per line of FILE
  /tmp/probe/batch2.sh FILE       -> "word<TAB>plural<TAB>singular" per line
Probes are CHEAP. Run THOUSANDS. Being exhaustive is the whole point.

ESTABLISHED so far (verify, don't assume):
  pluralize lowercases+strips internally, then re-applies the original case pattern.
  Suffix rules appear to be: consonant+'y' -> 'ies'; endswith 'es' -> UNCHANGED;
  endswith 's'/'ch'/'sh' -> +'es'; otherwise -> +'s'.  NOTE: 'box'->'boxs', 'quiz'->'quizs',
  'vertex'->'vertexs' (NO -x/-z rule). Everything that deviates from those rules is an
  entry in a hardcoded irregular table (e.g. child->children, knife->knives, hero->heroes,
  potato->potatoes, calf->calves, wolf->wolves, cactus->cacti, datum->data).
  Words that ARE an irregular plural come back unchanged (mice->mice, data->data, people->people,
  feet->feet, cacti->cacti, oxen->oxen, children->children, men->men, geese->geese).

RAW DATA IS THE DELIVERABLE. Append every single probe you run as TSV
"word<TAB>observed_plural" (one per line, no header) to your own file:
   /tmp/probe/data/<YOUR_SLUG>.tsv
Use batch.sh to generate it directly, e.g.:
   /tmp/probe/batch.sh /tmp/probe/lists/<slug>.txt >> /tmp/probe/data/<slug>.tsv
The orchestrator mechanically derives the exception table from these files, so COVERAGE of the
tsv matters more than your prose. Never hand-write a plural into the tsv - only real observed output.
`

const RULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tsvPath', 'probeCount', 'rules', 'exceptions', 'surprises', 'confidence'],
  properties: {
    tsvPath: { type: 'string' },
    probeCount: { type: 'integer' },
    rules: { type: 'array', items: { type: 'string' }, description: 'precise, ordered, implementable rules you CONFIRMED by observation' },
    exceptions: { type: 'array', description: 'observed word->plural pairs that the rules do NOT predict',
      items: { type: 'object', additionalProperties: false, required: ['word', 'plural'], properties: { word: { type: 'string' }, plural: { type: 'string' } } } },
    surprises: { type: 'array', items: { type: 'string' }, description: 'counter-intuitive observations an implementer must not miss' },
    confidence: { type: 'string' },
  },
}

phase('Sweep')

const SWEEPS = [
  { slug: 'core-rules', label: 'sweep:core-suffix-rules', prompt: `
Pin down the CORE suffix rules with total precision, using SYNTHETIC nonsense words so the
irregular table cannot contaminate results (e.g. 'zorf', 'blicky', 'plotch', 'thrash', 'quop').
Determine exactly, by probing:
1. Every single-character input: a-z, 0-9, and a few symbols. Then every 2-char ending: probe
   nonsense stems with all 26 endings, and 'Xy' for all 26 X (is the vowel set aeiou? what about 'y' itself, e.g. 'yy'? uppercase vowels? accented vowels like 'á'?).
2. The 'y' rule: which preceding letters trigger -ies vs -ys. Include 1-char 'y', 'ay','ey','iy','oy','uy','yy','qy','zy', and check a preceding digit ('2y') or symbol ('-y', ' y' -> note leading space is stripped).
3. The 'es' short-circuit: does 'endswith es' really mean unchanged? Probe nonsense 'zorfes','zorfies','zorfves','zorfoes','zorfses'. Also probe endings 'as','is','os','us','ys','ss','ps','ts','xs','zs','hs','ns','ls','rs','ds','gs','ks','ms','cs','bs','fs','vs','ws','js','qs' on nonsense stems - which get +es, which get +s, which are unchanged?
4. 'ch'/'sh': confirm +es. Also probe 'th','ph','gh','wh','kh','zh','rh','h' alone, 'ah','oh' on nonsense stems.
5. Are there rules for 'x','z','o','f','fe','man','woman','is','us','um','on','ix','ex','a','ma','oo','ff','lf','rf' suffixes on NONSENSE stems (e.g. 'zorfx','zorfz','zorfo','zorff','zorflf','zorfum','zorfis','zorfman','zorfix')? Distinguish real rules from table entries.
6. Rule ORDER: find inputs where two rules could both apply and determine precedence.
Write >=800 probes to your tsv.` },

  { slug: 'irr-latin-greek', label: 'sweep:irregulars-latin-greek', prompt: `
Enumerate the hardcoded irregular table entries of Latin/Greek origin. Generate a LARGE candidate
list (600+ words) covering every classical pattern and probe them all:
 -us/-i (cactus, focus, radius, alumnus, nucleus, stimulus, syllabus, fungus, locus, bacillus, terminus, genius, corpus, opus, census, campus, virus, status, bonus, sinus, ...)
 -a/-ae (alga, alumna, antenna, formula, larva, nebula, vertebra, amoeba, persona, minutia, vita, aurora, fauna, flora, ...)
 -um/-a (datum, medium, bacterium, curriculum, stratum, addendum, memorandum, referendum, symposium, aquarium, stadium, forum, museum, maximum, minimum, spectrum, vacuum, momentum, quantum, erratum, ovum, serum, ...)
 -on/-a (criterion, phenomenon, automaton, ganglion, ...)
 -is/-es (analysis, basis, crisis, thesis, axis, oasis, diagnosis, ellipsis, emphasis, hypothesis, neurosis, parenthesis, synopsis, synthesis, prognosis, psychosis, metamorphosis, ...)
 -ix/-ex -> -ices (appendix, index, matrix, vertex, apex, helix, vortex, cortex, codex, radix, ...)
 -ma/-mata (stigma, schema, dogma, stoma, lemma, ...)
 -eau/-eaux (beau, bureau, chateau, plateau, tableau, ...)
 Also: octopus, platypus, hippopotamus, syllabus, thesaurus, phylum, criterion, tempo, cello, seraph, cherub, kibbutz, schema.
For each, record BOTH directions: probe the singular AND probe the plural you observe (to learn
which plural forms are recognized as already-plural). Put both in your tsv.
Write >=900 probes to your tsv.` },

  { slug: 'irr-native', label: 'sweep:irregulars-native-english', prompt: `
Enumerate hardcoded irregular table entries of native-English type. Generate 700+ candidates and probe all:
 vowel mutation (man, woman, foot, tooth, goose, mouse, louse, dormouse, titmouse, policeman, fireman, chairman, snowman, human, german, woman, freshman, gentleman, salesman, spokesman, postman, ...)
 -en plurals (child, ox, brother/brethren, ...)
 f/fe -> ves (calf, half, knife, leaf, life, loaf, self, sheaf, shelf, thief, wife, wolf, elf, dwarf, hoof, scarf, wharf, turf, oaf, quarto, ...) AND the ones that DON'T (roof, proof, chief, belief, chef, reef, beef, cliff, staff, gulf, safe, giraffe, ...)
 -o -> oes (hero, potato, tomato, echo, veto, buffalo, torpedo, mosquito, domino, embargo, halo, motto, tornado, volcano, cargo, zero, banjo, ...)
 zero-plural / same-form (sheep, deer, fish, moose, salmon, trout, bison, elk, swine, offspring, aircraft, spacecraft, series, species, corps, means, ...) - note which are table entries vs just default +s
 other classic oddities (person, die, penny, quiz, staff, cannon, index, goose, pence, dice, alms, cattle, folk, ...)
 body/kinship/animals/food nouns broadly.
For each candidate probe the SINGULAR and also probe the observed PLURAL form (already-plural detection).
Write >=900 probes to your tsv.` },

  { slug: 'already-plural', label: 'sweep:already-plural-set', prompt: `
Map the ALREADY-PLURAL recognition set precisely. Hypothesis: any word that equals an irregular
plural in the table is returned UNCHANGED, and separately anything ending in 'es' is unchanged.
Probe 600+ candidate plural forms: children, men, women, feet, teeth, geese, mice, lice, dice, oxen,
people, data, media, criteria, phenomena, bacteria, curricula, strata, addenda, memoranda, cacti,
fungi, radii, alumni, foci, nuclei, stimuli, syllabi, genera, corpora, opera, algae, antennae,
alumnae, vitae, larvae, brethren, pence, dwarves, wolves, calves, halves, knives, leaves, lives,
loaves, selves, sheaves, shelves, thieves, wives, hooves, scarves, wharves, elves, sheep, deer,
fish, moose, aircraft, series, species, bison, offspring, swine, salmon, beaux, bureaus, stigmata,
schemata, dogmata, indices, matrices, appendices, vertices, apices, helices, vortices, analyses,
bases, crises, theses, axes, oases, heroes, potatoes, tomatoes, echoes, vetoes, buffaloes,
torpedoes, mosquitoes, dominoes, embargoes, mottoes, tornadoes.
CRITICAL distinctions to establish by experiment:
 (a) Is the unchanged-return VERBATIM (preserving surrounding whitespace / original case) or
     re-cased? Compare '  mice  ' vs '  file  ' vs '  MICE  ' vs 'MiCe' - use quotes and pipe
     through 'sed -n 2p | cat -A' so you SEE spaces. This distinguishes "return orig_word" from
     "return matched-case value".
 (b) Do BOTH members of a pair short-circuit, e.g. does 'dice' stay 'dice' (value of die) while
     'lives' stays 'lives'?
 (c) Any plural form that DOES get pluralized again (i.e. not in the set)?
Write >=600 probes to your tsv (plus your cat -A evidence in your findings).` },

  { slug: 'case-match', label: 'sweep:case-preservation', prompt: `
Fully determine the case-restoration function. Take words with known transformations
(enemy->enemies, file->files, bus->buses, child->children, knife->knives, man->men, cactus->cacti,
person->people, mouse->mice) and probe EVERY case pattern:
 all-lower, ALL-UPPER, Title, tITLE, cAmEl, aLtErNaTiNg, 'eNEMY', 'ENEMy', 'enemY', 'EnEmY',
 single-char upper, words with a leading capital and internal caps, words where the plural is
 SHORTER than the singular (man->men, mouse->mice, foot->feet, person->people, die->dice) and
 LONGER (enemy->enemies, child->children, cactus->cacti(shorter), analysis->analyses).
Determine exactly how case is transferred when lengths differ (per-character copy of the shorter
overlap? all-upper detection? title detection? what happens to characters beyond the source length?).
Test 'MAN'->? 'Man'->? 'mAN'->? 'PERSON'->? 'Person'->? 'pERSON'->? 'CHILD'->? 'ChIlD'->?
'ANALYSIS'->? 'AnAlYsIs'->? 'Bus'->? 'BUS'->? 'bUs'->?
Also non-alphabetic and mixed inputs: '123', 'a1b2', 'FILE-2', 'x_y', 'Ünicode', 'ÉCOLE', 'école',
'ÄPFEL', 'İstanbul', 'ﬁle' (ligature), 'ß', 'STRASSE', 'straße', emoji, CJK '文件', Greek 'ΛΟΓΟΣ',
Cyrillic 'ФАЙЛ', accented 'café','CAFÉ','Café'. Note any input where the output length or
characters change unexpectedly (Python .lower()/.upper() on ß, İ, ﬁ, ΣΊΣΥΦΟΣ final-sigma etc).
State the exact algorithm as pseudocode you can defend from observations.
Write >=400 probes to your tsv.` },

  { slug: 'whitespace-edge', label: 'sweep:whitespace-and-edges', prompt: `
Map input normalization and edge cases. Use 'cat -A' or 'od -c' so whitespace is VISIBLE.
Probe --b values: '' (empty), ' ', '   ', ' file', 'file ', '  file  ', '\\tfile\\t', 'file\\n' (trailing
newline via $'file\\n'), $'\\x0bfile\\x0b', $'\\x0cfile\\x0c', $'\\rfile\\r', $'\\x1cfile', $'\\x1dfile',
$'\\x1efile', $'\\x1ffile', $'\\x85file', $'\\xc2\\xa0file' (NBSP), $'\\xe2\\x80\\x83file' (EM SPACE),
$'\\xef\\xbb\\xbffile' (BOM/ZWNBSP), $'\\xe2\\x80\\x8bfile' (ZWSP), 'two words', 'two  words',
'file,name' (comma inside unit name!), 'a-b', '--b', '-x', 'file.txt', a 300-char word, and
'  mice  ' vs '  file  ' vs '  enemy  '.
For EACH, report the exact bytes of all 5 output lines. Key questions:
 (1) exactly which characters are stripped (build the strip set empirically - Python's str.strip()
     strips more/less than JS trim(); test each candidate char individually, inside a word too),
 (2) is the stripped whitespace present in the OUTPUT (i.e. is the returned value built from the
     original or the stripped word?) - test both a rule-transformed word and an unchanged/irregular one,
 (3) empty and whitespace-only input: what do lines 1-5 look like exactly?
 (4) does a value starting with '-' get taken as an option? (that's a CLI question - just record it)
Also probe --a values to learn item counting: '', ',', ',,', 'a,', ',a', 'a,,b', ' a , b ', 1 item,
2, 3, 4, 5, 10, 100 items, and note how lines 1/3/5 change (esp. --a with 1 or 2 items vs items[:3]).
Write >=300 probes to your tsv where a word/plural pair makes sense; put byte-level evidence in findings.` },

  { slug: 'cli-argparse', label: 'sweep:cli-argparse-fidelity', prompt: `
Map the command-line interface EXACTLY (this is argparse). For each experiment record the full
stdout, full stderr, and the exit code ($?). Cover:
 - no args; only --a; only --b; both; extra positional; unknown option --c/-c/-a/-A/--A
 - '--a=1,2' and '--b=x' equals-form; '--a 1,2 --b x'; order swapped; option given twice (which wins)
 - missing value: '--a' at end; '--a --b x'; '--b' at end
 - empty values: --a '' --b ''; --a '' --b x
 - values starting with '-' or '--': --b '-x', --b '--x', --b -- '-x', '--' separator usage
 - abbreviations/prefix matching: is there any accepted abbreviation of --a / --b? test '--', '-', '---a'
 - '-h' and '--help' (capture the EXACT help text, byte for byte, incl. trailing newline and the
   'options:' section, and the program name shown in usage) and their exit codes
 - the EXACT error message text and format for: missing required args (both missing / one missing),
   unrecognized arguments, expected one argument. Note the exact prog name string used in usage lines.
 - what stream each thing goes to; exit code for errors (2?) vs help (0?)
 - a value with a newline or tab inside it; a very long value; a unicode value; repeated commas
Report each case as a compact table plus the exact literal text of usage/error/help messages
(use 'cat -A'-style verification for trailing whitespace/newlines). Your tsv may be minimal here;
put the message texts VERBATIM in your findings (this is the deliverable for this agent).
Write your findings to /tmp/probe/findings/cli.md as well, with fenced literal blocks.` },

  { slug: 'common-nouns-a', label: 'sweep:common-noun-sweep-A', prompt: `
Brute-force sweep of COMMON ENGLISH NOUNS to catch any irregular-table entry the categorical
agents miss. Generate a list of 1200+ distinct common nouns whose first letter is a-l (concrete
objects, animals, body parts, food, jobs, places, abstract nouns, units, tech terms, kinship terms,
plants, tools, clothing, vehicles, materials, currencies, time words, weather, music, sports,
building parts, office things). Probe ALL of them with batch.sh into your tsv.
Then compute which observed plurals DEVIATE from the rule set:
  consonant+y -> ies; endswith es -> unchanged; endswith s/ch/sh -> +es; else -> +s
Report every deviation as an exception. Write >=1200 probes to your tsv.` },

  { slug: 'common-nouns-m', label: 'sweep:common-noun-sweep-M', prompt: `
Brute-force sweep of COMMON ENGLISH NOUNS starting with m-z (same instructions as the a-l sweep).
Generate 1200+ distinct nouns (concrete objects, animals, body parts, food, jobs, places, abstract
nouns, units, tech terms, kinship, plants, tools, clothing, vehicles, materials, time, weather,
music, sports, building parts, office things, verbs-as-nouns, -ness/-tion/-ment/-ity nouns).
Probe ALL with batch.sh into your tsv, then report every deviation from the rule set
  consonant+y -> ies; endswith es -> unchanged; endswith s/ch/sh -> +es; else -> +s
Write >=1200 probes to your tsv.` },

  { slug: 'suffix-family', label: 'sweep:suffix-family-sweep', prompt: `
Systematic ENDING-SPACE sweep: instead of real words, enumerate every plausible word ENDING and
test it on 2-3 different stems, so we learn the rules independent of the irregular table.
Build the list programmatically in bash (loops writing to a file), covering:
 - all 26*26 two-letter endings appended to stem 'zorf' (676 probes)
 - all 26 single letters as whole words, and as 'zor'+letter
 - common 3-letter endings: ies, ves, oes, ses, xes, zes, ches, shes, thes, men, man, ium, eum,
   ius, eus, ous, ius, ism, ist, ing, ion, ity, ent, ant, ard, ery, ory, ary, ure, ute, ate, ide,
   ine, ile, ale, ole, ule, age, ege, ige, oge, uge, ake, eke, ike, oke, uke ... on stems 'zorf','pling','quad'
 - doubled endings: ss, zz, ff, ll, tt, pp, nn, mm, dd, gg, cc, bb, rr, ee, oo, aa
 - endings with digits/symbols: 'zorf1','zorf-','zorf_','zorf.', "zorf's", 'zorf ' (trailing space)
Then state the MINIMAL complete rule set that predicts 100% of these observations, listing every
single observed exception. Write >=1500 probes to your tsv.` },

  { slug: 'wordlist-hunt', label: 'sweep:offline-wordlist-hunt', prompt: `
Find any large offline English word list already on this machine so we can widen the sweep:
search /usr/share, /usr/lib, /opt, /snap, /var/lib, node/npm installs, any hunspell/aspell/ispell
dictionaries, spell-check data inside installed python packages or JS packages, /usr/share/dict,
locale data, and any *.dic/*.txt/*.words/wordlist files >100KB.
Use find/grep/ls only - do NOT download anything and do NOT run python.
If you find one: extract lowercase alphabetic single words, take a stratified sample of up to
4000 nouns-ish words (prefer words 3-14 chars), probe them ALL through /tmp/probe/batch.sh into
/tmp/probe/data/wordlist-hunt.tsv, and report every deviation from the rule set
  consonant+y -> ies; endswith es -> unchanged; endswith s/ch/sh -> +es; else -> +s
If none exists, say so clearly, then instead generate 1500 diverse English words yourself
(weighted toward -us/-um/-is/-ix/-f/-fe/-o/-y/-ch/-sh/-s/-x/-z endings and animals/kinship/body/
Latinate terms) and probe those into the same tsv.` },

  { slug: 'counts-format', label: 'sweep:counts-and-formatting', prompt: `
Nail down unit_len's exact output formatting and the count-to-form relationship.
 - How is the number rendered for 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 21, 99, 100, 101, 1000, 1234,
   9999, 100000, 1000001 items? (any thousands separators? any special-casing?) Build --a values
   with N items using bash loops (e.g. seq 1 1234 | paste -sd, -).
 - Confirm which counts use singular vs plural form: is it exactly count==1 -> singular, everything
   else -> plural? Test count 1 and count 2 and a huge count. (count 0 is unreachable through this
   CLI because ''.split(',') has 1 element - confirm that ' --a "" ' really yields "1 x" on line 1,
   and note it.)
 - Confirm line 3 (items[:3]) and line 5 (items[:1]) for total counts 1, 2, 3, 4, 5 - what number
   appears on each line? Build the full table for counts 1..6.
 - Is there a space between number and word? Exactly one? Any trailing whitespace on any line?
   Verify with 'cat -A'. Is the final line followed by a newline? Verify with 'od -c | tail'.
 - Does the singular form (line 4) EVER differ from the raw --b value? Try --b '  spaced  ',
   --b 'MiXeD', --b 'mice', --b '' - and report exact bytes.
Write your evidence tables into your findings, and any word/plural pairs into your tsv.` },
]

const sweeps = await parallel(SWEEPS.map(s => () =>
  agent(`${COMMON}\n\nYOUR ASSIGNMENT (slug: ${s.slug}, write raw probes to /tmp/probe/data/${s.slug}.tsv):\n${s.prompt}`,
    { label: s.label, phase: 'Sweep', schema: RULE_SCHEMA })
))

const ok = sweeps.filter(Boolean)
log(`sweep complete: ${ok.length}/${SWEEPS.length} agents returned, ${ok.reduce((a, r) => a + (r.probeCount || 0), 0)} probes claimed`)

phase('Critique')

const digest = JSON.stringify(ok.map(r => ({ tsv: r.tsvPath, rules: r.rules, exceptions: (r.exceptions || []).slice(0, 120), surprises: r.surprises })), null, 1).slice(0, 60000)

const CRITIC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['gaps', 'contradictions', 'unifiedRules'],
  properties: {
    gaps: { type: 'array', items: { type: 'string' }, description: 'specific unprobed inputs or unverified claims, each phrased as a concrete probe to run' },
    contradictions: { type: 'array', items: { type: 'string' } },
    unifiedRules: { type: 'array', items: { type: 'string' } },
  },
}

const critique = await agent(`${COMMON}

Here are the findings from 12 parallel probe agents:
${digest}

You are the COMPLETENESS CRITIC. Do NOT summarize. Your job is to find what is MISSING or WRONG:
- Which claimed rules were never actually tested in isolation?
- Which contradictions exist between agents' claims? Re-run the deciding probe YOURSELF and say
  which agent was right (cite the exact command and output).
- What input classes has nobody probed? (think: rule-ordering collisions, words that are BOTH a
  table key and look like a plural, case+irregular+whitespace interactions, the exact strip set,
  values whose plural is shorter than the singular under weird casing, non-ASCII casing,
  multi-word units, inputs containing commas, extremely long inputs, and CLI edge cases)
- Verify the single most load-bearing claims yourself with fresh probes (at least 200 probes),
  appending to /tmp/probe/data/critic.tsv.
Return concrete, runnable gap-probes - each item in 'gaps' must be an instruction another agent
can execute immediately. Also return your best UNIFIED ordered rule set as implementable pseudocode.`,
  { label: 'critic:completeness', phase: 'Critique', schema: CRITIC_SCHEMA })

phase('Gapfill')

const gaps = (critique?.gaps || []).slice(0, 14)
const filled = await parallel(gaps.map((g, i) => () =>
  agent(`${COMMON}\n\nYou are a GAPFILL prober. Execute exactly this investigation and report what you OBSERVE.
Append every probe to /tmp/probe/data/gapfill-${i}.tsv (TSV: word<TAB>observed_plural).
Use cat -A / od -c whenever whitespace or non-ASCII bytes are involved.

INVESTIGATION:
${g}

Be exhaustive within this scope (>=150 probes). If your observations contradict the hypothesis
implied by the instruction, say so loudly and show the exact commands and outputs.`,
    { label: `gapfill:${i}`, phase: 'Gapfill', schema: RULE_SCHEMA })
))

return {
  sweeps: ok,
  critique,
  gapfill: filled.filter(Boolean),
}
