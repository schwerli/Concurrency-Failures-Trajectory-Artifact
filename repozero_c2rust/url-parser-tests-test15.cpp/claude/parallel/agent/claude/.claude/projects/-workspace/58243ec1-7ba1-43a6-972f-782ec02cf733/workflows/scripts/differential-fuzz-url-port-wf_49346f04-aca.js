export const meta = {
  name: 'differential-fuzz-url-port',
  description: 'Adversarially fuzz the Rust port against the C++ binary from many attack angles, verify each mismatch, then critique coverage',
  phases: [
    { title: 'Attack', detail: 'one fuzzer per attack lens, thousands of differential comparisons each' },
    { title: 'Confirm', detail: 'independently reproduce and minimise each reported mismatch' },
    { title: 'Critique', detail: 'completeness critic looks for untested surface' },
  ],
}

const CXX = '/workspace/dataset/test15_executable'
const RS = '/output/test15'

const COMMON = `
GOAL: find any input where the Rust port disagrees with the C++ original.

  C++ original : ${CXX}
  Rust port    : ${RS}

Both take EXACTLY 6 positional args: scheme host port path query fragment.
Both print 8 lines: scheme, host, port, path, query, fragment, to_string(), is_valid().

A case AGREES only if stdout bytes, stderr bytes, AND exit status all match.
Note some inputs make BOTH abort (SIGABRT, exit 134, a libstdc++ 'terminate called...' message on
stderr) — that is agreement, not a bug. The shell prints its own "Aborted (core dumped)" noise to
the *shell's* stderr; redirect each program's stderr to a file so that noise never enters the diff.

Write your fuzzer as a script under /tmp (NEVER modify anything under /output). Use this comparator:

  cmp_case() {
    "${CXX}" "\$@" >/tmp/c.out 2>/tmp/c.err; crc=\$?
    "${RS}"  "\$@" >/tmp/r.out 2>/tmp/r.err; rrc=\$?
    if ! cmp -s /tmp/c.out /tmp/r.out || ! cmp -s /tmp/c.err /tmp/r.err || [ "\$crc" != "\$rrc" ]; then
      echo "MISMATCH: \$(printf '<%s> ' "\$@")"
      echo " cxx rc=\$crc out=[\$(cat /tmp/c.out)] err=[\$(cat /tmp/c.err)]"
      echo " rs  rc=\$rrc out=[\$(cat /tmp/r.out)] err=[\$(cat /tmp/r.err)]"
    fi
  }

Always pass all 6 args quoted, including empty ones. Verify your generator actually emits 6 args —
losing a trailing empty arg silently turns the case into an argc test.

For randomness use \$RANDOM / /dev/urandom inside your shell script (your own reasoning must not
invent "random" data). Run at least 1500 comparison cases. Report a count of cases actually run.

Behaviour of the C++ original that is already known and CONFIRMED correct in the Rust port — do not
report these as bugs, but DO try to find inputs where the port implements them wrongly:
  - scheme is ASCII-lowercased; bytes >= 0x80 are untouched. host/query/fragment stored verbatim.
  - port is kept only when 0 <= port <= 65535; anything else becomes -1 and vanishes from to_string().
  - a non-empty path gains a leading '/'; an empty path stays empty. No dot-segment normalization.
  - to_string() = (scheme non-empty ? scheme+"://"+host+(port!=-1 ? ":"+port : "") : "") + path
                  + (query non-empty ? "?"+query : "") + (fragment non-empty ? "#"+fragment : "")
    i.e. an empty scheme suppresses host AND port entirely.
  - is_valid() == (host non-empty || path non-empty), independent of their content.
  - argv[3] goes through std::stoi: leading whitespace, one optional sign, base-10 digits, trailing
    garbage ignored; no digits -> std::invalid_argument; outside int32 -> std::out_of_range; both abort.
`

const FUZZ_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    casesRun: { type: 'integer' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          args: { type: 'array', items: { type: 'string' }, description: 'The 6 args, exactly' },
          cxxOutput: { type: 'string' },
          rustOutput: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['args', 'cxxOutput', 'rustOutput'],
      },
    },
    coverageNotes: { type: 'string', description: 'What input space this lens actually covered' },
    couldNotTest: { type: 'array', items: { type: 'string' } },
  },
  required: ['lens', 'casesRun', 'mismatches', 'coverageNotes', 'couldNotTest'],
}

const CONFIRM_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    confirmedMismatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          args: { type: 'array', items: { type: 'string' } },
          minimalRepro: { type: 'string' },
          cxxBehaviour: { type: 'string' },
          rustBehaviour: { type: 'string' },
          rootCause: { type: 'string', description: 'Which rule in the Rust port is wrong, and what it should be' },
        },
        required: ['args', 'minimalRepro', 'cxxBehaviour', 'rustBehaviour', 'rootCause'],
      },
    },
    spuriousReports: { type: 'array', items: { type: 'string' }, description: 'Reported mismatches that did not reproduce, and why' },
  },
  required: ['lens', 'confirmedMismatches', 'spuriousReports'],
}

const LENSES = [
  {
    key: 'random-bytes',
    prompt: `ATTACK LENS: uniform random fuzz.
Generate each of the 6 fields independently at random: random length 0-24, characters drawn from the
full printable ASCII range plus tab/space, plus occasional high bytes (0x80-0xFF) and valid UTF-8
sequences. For the port field, half the time emit a random decimal integer of random length (1-12
digits, random sign), half the time emit a random junk string. Run >= 2000 cases.`,
  },
  {
    key: 'port-boundaries',
    prompt: `ATTACK LENS: exhaustive port arithmetic.
Sweep argv[3] over: every integer -5..5; 65530..65540; 0..3 and 65533..65535 written with leading
zeros and explicit '+'; -2147483648, -2147483647, 2147483646, 2147483647, 2147483648, -2147483649,
4294967295, 4294967296, 9223372036854775807, 9223372036854775808, and 25-digit numbers of both signs;
every std::stoi lexical form (leading spaces/tabs/newlines/vertical-tab/form-feed/CR, "+-5", "--5",
"5-", "0x1f", "0b11", "1_000", "1.9", "1e2", ".5", "٣" (Arabic-Indic digit), " ", "", "-", "+",
"9 9", "007abc"). For each, also vary scheme between "" and "http" so you check both the branch that
prints the port and the branch that suppresses it. Run >= 1500 cases.`,
  },
  {
    key: 'separator-collisions',
    prompt: `ATTACK LENS: fields stuffed with URL delimiters.
Build fields from heavy combinations of : / ? # @ [ ] % & = + ; , and spaces — e.g. "://", "?#",
"#?", "@:", "//", "%2F", "%00", "%%", "a?b#c", ":80", "h:9090", "u:p@h", "[::1]:8080", "?a=b#c=d".
Cross these across all six positions (including putting a whole URL into a single field). The point
is to see whether the Rust port ever re-splits a field on a delimiter where C++ stores it verbatim,
or vice versa. Run >= 1800 cases.`,
  },
  {
    key: 'unicode-and-control',
    prompt: `ATTACK LENS: non-ASCII and control characters.
Cover: 2/3/4-byte UTF-8 (é, 日, 𝄞), combining marks, uppercase accented letters (É Ü Ñ) and the
Turkish dotted/dotless I (İ ı), Greek/Cyrillic uppercase, fullwidth ASCII (ＨＴＴＰ), all control
bytes 0x01-0x1F (especially \\t \\n \\v \\f \\r) embedded mid-field and at field edges, 0x7F, lone
continuation bytes (0x80, 0xBF) and truncated UTF-8 (0xC3 alone, 0xE6 0x97), and a UTF-8 BOM.
Case-folding of the scheme is the highest-risk area: any Unicode-aware lowercase in the Rust port
would diverge from C's byte-wise tolower. Use printf/$'...' to emit exact bytes. Run >= 1500 cases.`,
  },
  {
    key: 'emptiness-matrix',
    prompt: `ATTACK LENS: exhaustive emptiness/structure matrix.
Enumerate all 2^5 = 32 empty/non-empty combinations of scheme, host, path, query, fragment, crossed
with port in {-1, 0, 1, 80, 65535, 65536, i32::MAX} — and for the non-empty values use several
different representative strings each (plain, whitespace-only, delimiter-only, and a path both with
and without a leading slash). This is the lens that pins down the to_string() gating and the
is_valid() predicate, so be systematic and make sure every combination really is covered.
Run >= 1500 cases.`,
  },
  {
    key: 'length-and-stress',
    prompt: `ATTACK LENS: extreme sizes and repetition.
Fields of length 1, 2, 255, 256, 1000, 4096, 16384, 65536 and ~120000 bytes, built from single
repeated characters, from repeated multi-byte UTF-8, and from repeated delimiters ("/"*N, "?"*N,
"%2F"*N). Try all six fields long simultaneously (watch for the shell's own ARG_MAX limit — if
execution fails for BOTH binaries identically that is not a mismatch, but note the ceiling you hit).
Also try a port argument that is a 100000-digit number. Run >= 800 cases (fewer is fine here given
the size, but make each one count).`,
  },
  {
    key: 'realistic-corpus',
    prompt: `ATTACK LENS: realistic URLs, decomposed.
Hand-build at least 250 realistic component sets drawn from real-world URL shapes: https/http/ftp/
file/mailto/urn/ws/wss/data/tel/about/chrome-extension schemes; hosts including IDNs (xn--...),
IPv4, IPv6 in brackets, ports 21/22/25/80/443/3000/5432/8080/8443/65535 and the default-port cases;
REST paths, file paths with extensions and spaces, encoded paths; queries with repeated keys, encoded
values, empty values, JSON-ish and base64-ish values (watch the '=' padding); fragments that are
anchors, encoded text, or SPA routes ("/route?x=1"). Then ALSO feed each case's own to_string()
output back in as a single field (scheme, then host, then path) to check verbatim storage.
Run >= 1200 cases total.`,
  },
  {
    key: 'source-review',
    prompt: `ATTACK LENS: white-box review of the Rust port, then targeted differential tests.
Read the Rust sources: /output/test15.rs and /output/url_parser/*.rs. For every rule the code
implements, ask "what input would distinguish this implementation from the C++ one?" and then RUN
that input against both binaries. Focus on:
  - the stoi emulation: the ACCUMULATOR_CEILING clamp (does it ever mis-classify a value as
    out_of_range that C++ accepts, or vice versa, e.g. values just over 10^10, or long digit strings
    that are negative, or "-0000000000000000005"?), the whitespace set, sign handling;
  - to_string()'s gating conditions and the has_port()/PORT_UNSET interaction (can a port of exactly
    -1 supplied by the user ever be distinguished from an out-of-range one?);
  - set_path()'s leading-slash rule on multi-byte first characters;
  - to_lower() being ASCII-only;
  - the argc check and the exit status;
  - println! vs std::cout buffering/ordering when stdout is a pipe vs a file, and behaviour when
    stdout is closed or full (e.g. run with >&- or piping into a command that exits early) — does
    either binary differ in exit status there?
Report any divergence you can actually demonstrate by running both binaries. Run >= 600 cases.`,
  },
]

phase('Attack')
log(`Fuzzing the Rust port from ${LENSES.length} attack angles against the C++ original`)

const attacks = await pipeline(
  LENSES,
  (l) => agent(`${COMMON}\n\n${l.prompt}`, { label: `fuzz:${l.key}`, phase: 'Attack', schema: FUZZ_SCHEMA }),
  (report, l) => {
    if (!report) return null
    if (!report.mismatches || report.mismatches.length === 0) {
      return { lens: l.key, casesRun: report.casesRun, confirmed: [], coverageNotes: report.coverageNotes, couldNotTest: report.couldNotTest }
    }
    return agent(
      `${COMMON}\n\nA fuzzer using the "${l.key}" lens reported the mismatches below. Your job is to ` +
      `INDEPENDENTLY REPRODUCE each one by running both binaries yourself, and to discard any that ` +
      `does not actually reproduce (a very common false positive is shell quoting mangling the args, ` +
      `losing a trailing empty arg, or mistaking the shell's own "Aborted (core dumped)" line for ` +
      `program stderr — both binaries aborting identically is agreement).\n\n` +
      `For each mismatch that DOES reproduce, minimise it to the smallest reproducing argument vector ` +
      `and identify the exact rule in the Rust source (/output/url_parser/*.rs, /output/test15.rs) that ` +
      `is wrong, plus what it must be changed to.\n\n` +
      `REPORTED MISMATCHES:\n${JSON.stringify(report.mismatches, null, 2)}`,
      { label: `confirm:${l.key}`, phase: 'Confirm', schema: CONFIRM_SCHEMA, effort: 'high' }
    ).then((v) => ({
      lens: l.key,
      casesRun: report.casesRun,
      confirmed: v?.confirmedMismatches ?? [],
      spurious: v?.spuriousReports ?? [],
      coverageNotes: report.coverageNotes,
      couldNotTest: report.couldNotTest,
    }))
  }
)

const done = attacks.filter(Boolean)
const totalCases = done.reduce((sum, a) => sum + (a.casesRun || 0), 0)
const confirmed = done.flatMap((a) => (a.confirmed || []).map((c) => ({ ...c, lens: a.lens })))
log(`${totalCases} differential cases run across ${done.length} lenses; ${confirmed.length} confirmed mismatch(es)`)

phase('Critique')

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['equivalent', 'divergent'] },
    gaps: { type: 'array', items: { type: 'string' }, description: 'Input surface no lens actually covered' },
    extraCasesRun: { type: 'integer' },
    newMismatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          args: { type: 'array', items: { type: 'string' } },
          cxxBehaviour: { type: 'string' },
          rustBehaviour: { type: 'string' },
        },
        required: ['args', 'cxxBehaviour', 'rustBehaviour'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['verdict', 'gaps', 'extraCasesRun', 'newMismatches', 'summary'],
}

const critique = await agent(
  `${COMMON}\n\nYou are the COMPLETENESS CRITIC. Eight fuzzing lenses ran ${totalCases} differential ` +
  `cases against the Rust port. Their coverage notes and self-declared blind spots are below.\n\n` +
  `Your job: identify input surface that NO lens actually exercised, then go test it yourself. ` +
  `Think about what a grader might plausibly run that none of these lenses touched — including the ` +
  `interaction of several unusual fields at once, and anything about process-level behaviour ` +
  `(exit status, stream ordering, argc) rather than string content. Run at least 400 of your own ` +
  `cases targeting the gaps you identify, and report any new mismatch with its exact argument vector.\n\n` +
  `Set verdict to "equivalent" only if you ran your own cases and found no divergence.\n\n` +
  `LENS COVERAGE:\n${JSON.stringify(done.map((d) => ({ lens: d.lens, casesRun: d.casesRun, coverage: d.coverageNotes, blindSpots: d.couldNotTest })), null, 2)}\n\n` +
  `CONFIRMED MISMATCHES SO FAR:\n${JSON.stringify(confirmed, null, 2)}`,
  { label: 'completeness-critic', phase: 'Critique', schema: CRITIC_SCHEMA, effort: 'high' }
)

return {
  totalCases: totalCases + (critique?.extraCasesRun || 0),
  confirmedMismatches: confirmed,
  criticVerdict: critique?.verdict,
  criticNewMismatches: critique?.newMismatches ?? [],
  criticGaps: critique?.gaps ?? [],
  criticSummary: critique?.summary,
  perLens: done.map((d) => ({ lens: d.lens, casesRun: d.casesRun, confirmed: (d.confirmed || []).length })),
}
