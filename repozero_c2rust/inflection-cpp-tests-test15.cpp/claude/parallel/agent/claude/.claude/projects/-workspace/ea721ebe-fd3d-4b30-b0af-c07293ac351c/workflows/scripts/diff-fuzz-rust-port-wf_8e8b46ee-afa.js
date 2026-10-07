export const meta = {
  name: 'diff-fuzz-rust-port',
  description: 'Adversarially fuzz the Rust port against the C++ reference binary hunting for byte-level divergence',
  phases: [
    { title: 'Fuzz', detail: 'independent fuzzers, each with a distinct attack strategy' },
    { title: 'Triage', detail: 'reproduce and minimise every reported divergence' },
  ],
}

const CPP = '/workspace/dataset/test15_executable'
const RUST = '/output/test15'

const COMMON = `
You are differential-testing a Rust port against its C++ reference.

  reference : ${CPP}
  port      : ${RUST}

Both take the same argv. A case PASSES only if stdout bytes, stderr bytes AND exit status all match exactly.
Compare BYTES, not text: some outputs are deliberately invalid UTF-8, and one input class makes both programs abort.

There is a ready-made helper at /tmp/probe/difflib.sh:

    source /tmp/probe/difflib.sh
    diffcase arg1 arg2 ...      # runs both, records pass/fail
    report                      # prints "pass=N fail=M" plus failing details

Use it, or write your own comparator if you prefer — but it MUST compare stdout bytes, stderr bytes and exit code.
Beware: inputs whose first argument is empty, or ends with ':', make BOTH binaries abort with SIGABRT (exit 134) and
print a libstdc++ diagnostic to stderr. That is expected shared behaviour, not a divergence — the port reproduces it
deliberately. Only report a divergence when the two binaries DISAGREE.

The Rust source lives in /output (test15.rs, src/inflection/*.rs). You MAY read it to find weak spots to attack.
You may NOT modify it. Do not read or look for C++ library source; it does not exist on disk.

Known behaviour of the reference, for context (derived by earlier probing — treat as claims to attack, not gospel):
  pluralize(w)  = w if w is empty or one of {equipment,information,rice,money,species,series,fish,sheep,jeans,police}
                  (exact, case-sensitive, whole-string), else w + "s"
  camelize(w)   = drop '_' separators, ASCII-uppercase the byte after each run of them; first byte untouched
                  unless the input starts with '_'
  underscore(w) = for each byte: if ASCII uppercase, emit '_' (unless byte index 0) then the lowercase byte;
                  else emit the byte unchanged
  isPlural(w)   = false if w is uncountable (whole word) or ends with "news";
                  else true if w ends with one of s / ta / ia / mice / lice / octopi / viri, or w == "oxen"
  isSingular(w) = !isPlural(w)
  demodulize(p) = p[p.rfind(':') + 2 ..]  (aborts when that offset exceeds the length)
  driver: args 1..min(argc-1,5) each contribute pluralize+camelize, plus underscore when the index is even;
          all buffered and printed first, then isPlural/isSingular/demodulize of argv[1].

Run AT LEAST 3000 comparison cases. Report precisely.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy', 'cases_run', 'divergences', 'notes'],
  properties: {
    strategy: { type: 'string' },
    cases_run: { type: 'integer' },
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'cpp', 'rust'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          cpp: { type: 'string', description: 'stdout hex / stderr / exit' },
          rust: { type: 'string' },
          minimised: { type: 'string' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
}

const FUZZERS = [
  {
    key: 'random-ascii',
    prompt: `Strategy: high-volume RANDOM ASCII fuzzing.
Generate thousands of random printable-ASCII arguments of length 0-40 (use $RANDOM / /dev/urandom | tr -dc), with a
heavy bias toward the characters that matter: '_', ':', 's', 'a', 'i', 't', uppercase letters, digits, '-', '.', '/', ' '.
Vary the argument COUNT from 0 to 8. Include multi-argument cases so underscore() at even indices is exercised.
At least 3000 cases.`,
  },
  {
    key: 'structured-morphology',
    prompt: `Strategy: MORPHOLOGY-focused. Attack isPlural/isSingular and pluralize.
Build several thousand words by concatenating realistic stems with realistic endings:
  stems: cat dog box church city bus quiz analy cris ax test octop vir matr vert ind m l ox new seri speci jean fish sheep money police equipment rice
  endings: "" s es ies ves oes ses sis ses is us um a ia ta i ice ices en ae zes sses
Also systematically test EVERY concatenation of a 1-6 letter random stem with each of:
  s ss es ies ves oes a ia ta i ice mice lice octopi viri en oxen news series species jeans ae ices
Specifically hunt for a plural/singular rule the port does not know about. Also test every uncountable word with
prefixes and suffixes attached, and in every letter-case variation (lower, Title, UPPER, mIxEd) — the port claims the
tables are case-sensitive and (for uncountables) whole-word.
At least 3000 cases.`,
  },
  {
    key: 'separators-and-case',
    prompt: `Strategy: attack camelize and underscore.
Generate thousands of strings made only from the alphabet { a, B, _, -, ' ', '.', '/', ':', '0', '9', tab } of length
0-14, exhaustively for short lengths and randomly for longer ones. In particular exhaustively cover EVERY string of
length 0-5 over the alphabet { a, B, _ } (that is 3^0+...+3^5 = 364 strings) and every string of length 0-4 over
{ a, B, _, - , ' ' } (781 strings) — those two families pin down the separator and index-0 rules completely.
Pass each as argument 2 (with a dummy argument 1) so underscore() is exercised as well as camelize().
Also test leading/trailing/repeated separators and long runs.
At least 3000 cases.`,
  },
  {
    key: 'colons-and-abort',
    prompt: `Strategy: attack demodulize, including the abort path.
Generate thousands of arguments built from ':' plus other bytes: every string of length 0-6 over { ':', 'a' }
(exhaustive, 127 strings), plus random strings with colons at random positions, plus colons combined with multi-byte
UTF-8, plus arguments that are only colons of every length 0-30.
CRITICAL: verify the abort cases match EXACTLY — same stderr bytes (including the two numbers in the
"__pos (which is N) > this->size() (which is M)" message), same exit status, and the SAME stdout produced before the
abort. Test the abort with 1..6 arguments so there is buffered stdout to flush first.
Also confirm which inputs abort and which do not, and that the two binaries agree on that partition for every case.
At least 3000 cases.`,
  },
  {
    key: 'unicode-and-bytes',
    prompt: `Strategy: NON-ASCII and raw byte fuzzing — the port claims byte-level fidelity.
Test arguments containing: 2/3/4-byte UTF-8 (accented Latin, Greek, Cyrillic, CJK, emoji), combining marks, and
deliberately INVALID UTF-8 byte sequences (lone continuation bytes 0x80-0xBF, truncated sequences, overlong forms,
0xFE/0xFF). Build such arguments with bash $'\\xNN' escapes.
Two things to hammer:
  1. camelize/underscore must not alter any byte >= 0x80, and must not treat one as an uppercase letter.
     Try 'a_<multibyte>' and '<multibyte>ABC' shapes.
  2. demodulize slices at a byte offset and can split a multi-byte sequence, so it can emit invalid UTF-8. Verify the
     port emits the identical raw bytes. Construct inputs where the split lands mid-sequence for 2, 3 and 4 byte
     characters.
Also test uncountable words with non-ASCII attached, and arguments that are pure invalid-UTF-8.
Compare with od/xxd. At least 3000 cases.`,
  },
  {
    key: 'argv-shape',
    prompt: `Strategy: attack the DRIVER, not the inflection rules.
Systematically vary argument count 0..10 and the content/positions of empty strings, so that line ordering, the
i<=5 cap and the even-index underscore rule are all stressed. For every count 0..10, test: all-normal args, arg1 empty,
a middle arg empty, the last arg empty, all args empty, and args that are single characters.
Also test arguments that look like flags ('-h', '--help', '-', '--'), arguments containing newlines and tabs
(bash $'a\\nb'), arguments of length 0, 1, 2, 4096 and 100000 bytes, and args with leading/trailing spaces.
Verify total line counts follow: N = min(argc-1, 5); lines = 2*N + floor(N/2) + 3 when argc > 1, and 0 when argc == 1.
Verify stdout is empty and exit status 0 for zero arguments, and that nothing is ever written to stderr except in the
abort case. At least 3000 cases.`,
  },
]

phase('Fuzz')
const results = await pipeline(
  FUZZERS,
  f => agent(`${COMMON}\n=== YOUR STRATEGY: ${f.key} ===\n${f.prompt}`, {
    label: `fuzz:${f.key}`,
    phase: 'Fuzz',
    schema: SCHEMA,
    effort: 'high',
  }),
  (res, f) => {
    if (!res) return null
    if (!res.divergences || res.divergences.length === 0) return { fuzzer: f.key, res, triage: null }
    return agent(
      `${COMMON}\n=== TRIAGE: divergences reported by the "${f.key}" fuzzer ===\n\n` +
      `Reproduce EACH of these independently. For every one, decide whether it is a REAL divergence between the two ` +
      `binaries or a false alarm (e.g. a shell-quoting artefact in the fuzzer, a comparison that ignored exit codes, ` +
      `or the shared-by-design abort behaviour). For real ones, MINIMISE to the shortest argv that still diverges and ` +
      `state exactly which byte differs and what the correct rule appears to be.\n\n` +
      `REPORTED:\n${JSON.stringify(res.divergences, null, 2)}\n\n` +
      `Return only the divergences you could reproduce, each with a "minimised" field.`,
      { label: `triage:${f.key}`, phase: 'Triage', schema: SCHEMA, effort: 'high' }
    ).then(t => ({ fuzzer: f.key, res, triage: t }))
  }
)

const clean = results.filter(Boolean)
const real = clean.flatMap(r => (r.triage ? r.triage.divergences || [] : []))
log(`fuzzers finished: ${clean.length}; reproduced divergences: ${real.length}`)
return {
  totalCases: clean.reduce((n, r) => n + (r.res.cases_run || 0), 0),
  perFuzzer: clean.map(r => ({ fuzzer: r.fuzzer, cases: r.res.cases_run, reported: (r.res.divergences || []).length, reproduced: r.triage ? (r.triage.divergences || []).length : 0, notes: r.res.notes })),
  reproducedDivergences: real,
}
