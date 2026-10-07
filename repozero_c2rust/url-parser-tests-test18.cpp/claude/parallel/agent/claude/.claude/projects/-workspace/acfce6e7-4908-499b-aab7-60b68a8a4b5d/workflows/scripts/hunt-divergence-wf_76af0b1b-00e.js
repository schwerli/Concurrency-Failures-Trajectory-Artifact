export const meta = {
  name: 'hunt-divergence',
  description: 'Adversarially hunt for any input where the Rust port diverges from the C++ reference binary',
  phases: [
    { title: 'Hunt', detail: 'independent strategies searching for divergent inputs' },
    { title: 'Triage', detail: 'confirm and consolidate every reported divergence' },
  ],
}

const PREAMBLE = `
Two binaries must produce BYTE-IDENTICAL stdout and identical exit codes for every possible single command-line argument:

  REFERENCE (C++): /workspace/dataset/test18_executable
  PORT (Rust):     /output/test18

Both take one argument (a URL) and print exactly 18 lines: scheme, authority, userinfo, host, port(int), path, query, fragment, has_scheme, has_authority, has_userinfo, has_host, has_port, has_path, has_query, has_fragment, to_string, is_valid. With no argument both must exit 1 printing nothing.

YOUR JOB: find ANY input where they differ. This is an adversarial search — assume a divergence EXISTS and hunt it down. Do not verify that they agree; hunt for where they disagree.

A byte-exact comparison helper is at /tmp/difftest.sh (takes a file with one input per line) and /tmp/zdiff.sh (takes a NUL-separated file, so inputs may contain newlines/control bytes). Use them, or compare directly:

  cmp <(/workspace/dataset/test18_executable "$U") <(/output/test18 "$U") && echo SAME || echo DIFFER

To build a NUL-separated corpus and test it:
  { printf 'input one\\0'; printf 'input\\ttwo\\0'; } > /tmp/mycorpus.bin
  /tmp/zdiff.sh /tmp/mycorpus.bin

IMPORTANT: use cmp/diff on the raw bytes, not eyeballing — a trailing-whitespace or empty-line difference is a real failure. Always report the exit codes too.

Already covered by existing testing (do NOT just repeat it — go beyond it):
- A 1.46M-case cartesian product over: scheme prefixes {"", http://, https://, FTP://, ZzZ://, "://", a+b-c.1://, "  http://", mailto:, http:/, http:}, userinfo {"", u@, u:p@, @, a@b@, u:p:q@}, host {"", h.com, H.CoM, 1.2.3.4, [::1], ex%41mple.com, a_b-c.d., \\p}, port {"", :80, :0, :65535, :65536, :abc, ":", :80abc, :+8, :-8, :007}, path {"", /, /p, /p/q/, //dbl, /p:x, /p@x}, query {"", ?, ?a=1, ?a=1&b=2, ?a?b, ?x=http://y}, fragment {"", #, #f, #f?g, #a#b, #a://b} — a 20k random sample showed zero mismatches and the full run is in progress.
- 191 hostile cases: control chars (tab, newline, CR, VT, FF, 0x01, 0x1f, 0x7f) in every position; UTF-8 (ä, 日本語, 🎉, Ä, İ, ǅ, ß, U+00A0) in every component; punctuation soup; percent-encoding oddities (%, %z, %zz, %4, %41, %00, %2F, %3A, %23, %3F); delimiter storms (":::::", "@@@@@", "http://@@@:::///???###"); long inputs (10k host, 100k path, 5000-digit port, 20k scheme, 50k query+fragment).

The Rust port's model of the C++ behavior is below. Attack the ASSUMPTIONS in it — each is a place a divergence could hide:
1. Split order: first '#' takes the fragment; then the first '?' of the remainder takes the query; then the first "://" of the remainder takes the scheme (ASCII-lowercased); without "://" the whole remainder is the path.
2. With a scheme: the authority runs to the first '/' (which starts the path); the first '@' in it splits userinfo; the first ':' in the rest splits host from port.
3. Port: std::stoi semantics — skip leading whitespace (space \\t \\n \\v \\f \\r), optional +/-, consume digits, stop at first non-digit; fail if no digits or the value leaves int range; then accept only 0..=65535, else port = -1.
4. authority() is REBUILT as [userinfo "@"] host [":" port], never the raw substring.
5. to_string() = (scheme non-empty ? scheme + "://" + authority() : "") + path + (query non-empty ? "?" + query : "") + (fragment non-empty ? "#" + fragment : "").
6. has_scheme/userinfo/path/query/fragment = component non-empty; has_port = port != -1; has_authority = host non-empty.
7. is_valid = host non-empty OR path non-empty.
8. Scheme lowercasing is ASCII-only (A-Z); all other bytes, including UTF-8, pass through untouched. No percent-decoding, no path normalisation, no case folding anywhere else.

Run AT LEAST 300 distinct inputs. Generate them programmatically with bash loops where that helps. Report every divergence you find with the exact input (as a bash-reproducible literal or an od -c dump), both outputs, and both exit codes. If you find none, say so plainly and report what you tried — do not invent a divergence.

YOUR ASSIGNED STRATEGY:
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy', 'inputs_tested', 'divergences', 'notes'],
  properties: {
    strategy: { type: 'string' },
    inputs_tested: { type: 'integer', description: 'how many distinct inputs you actually ran through BOTH binaries' },
    divergences: {
      type: 'array',
      description: 'Every confirmed byte-level difference found. Empty if none.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['input_repr', 'cpp_output', 'rust_output'],
        properties: {
          input_repr: { type: 'string', description: 'exact input, as a bash literal or od -c dump' },
          cpp_output: { type: 'string', description: 'the 18 C++ lines joined by |' },
          rust_output: { type: 'string', description: 'the 18 Rust lines joined by |' },
          exit_codes: { type: 'string' },
          which_assumption: { type: 'string', description: 'which numbered assumption it breaks' },
        },
      },
    },
    notes: { type: 'string', description: 'What you tried, what the riskiest untested area still is' },
  },
}

const STRATEGIES = [
  { key: 'stoi', prompt: `PORT PARSING. Attack assumption 3 exhaustively. The C++ almost certainly uses std::stoi inside a try/catch plus a range check; find any numeric string where the Rust emulation differs. Sweep: every boundary (-1,0,1,65534,65535,65536,65537,2147483646..2147483649,4294967295,4294967296,9223372036854775807,9223372036854775808,18446744073709551615,18446744073709551616), all sign forms (+,-,++,--,+-,-+, sign with no digits, sign after whitespace, whitespace after sign), every whitespace byte from assumption 3 alone and in combination and repeated, digits with embedded/leading/trailing whitespace, huge digit runs (100/1000/10000 digits, all 9s, all 0s, leading zeros then a big number, 2000 leading zeros then "80"), non-ASCII and fullwidth/Arabic-Indic digits, locale-ish oddities, "0x"/"0b"/"0o" prefixes, "1_000", "1,000", ".5", "5.", "e5", "INF", "NAN", "nan", "inf" (strtod-isms that strtol must reject), and the empty port. Test each both as "http://h:<X>" and as "http://h:<X>/p?q#f" to confirm the rest still parses. Also test a port on an EMPTY host (":<X>") and after a userinfo ("u@:<X>").` },
  { key: 'delims', prompt: `DELIMITER PRECEDENCE. Attack assumptions 1 and 2. Construct inputs where the '#', '?', '://', '/', '@' and ':' delimiters interleave in every order and multiplicity, so that any off-by-one or wrong-occurrence (first vs last) choice shows up. Systematically generate all permutations and repetitions of the delimiter set over short strings — e.g. every string of length 1..4 over the alphabet {#, ?, :, /, @, a} (that is 6^1+6^2+6^3+6^4 = 1554 strings; run them ALL through both binaries with a bash loop and cmp). That single exhaustive sweep is the core of your job; do it first. Then extend to length-5 strings over a reduced alphabet {#, ?, :, /, @} (3125 strings) and run those too. Report any divergence.` },
  { key: 'serialize', prompt: `SERIALISATION. Attack assumptions 4, 5, 6 and 7. Hunt for inputs where authority(), to_string(), the has_* flags, or is_valid() diverge. Focus on degenerate structures where a component exists but is empty, or where a component exists without the components that normally precede it: port without host, userinfo without host, query without path, fragment without path, authority without scheme ("://h..." forms), scheme without authority, empty scheme with every possible remainder. Systematically enumerate: for every subset of {scheme, userinfo, host, port, path, query, fragment}, build an input that produces exactly that subset (including impossible-looking ones) and compare. Pay special attention to whether to_string() is truly lossy in the ways assumed, and hunt for a case where the Rust port round-trips but the C++ does not (or vice versa). Also probe whether has_authority could be something other than "host non-empty" — try hard to find an input where they differ.` },
  { key: 'bytes', prompt: `BYTES AND ENCODING. Attack assumption 8 and the I/O layer. The Rust port reads its argument through std::env::args() (which requires valid UTF-8) and writes raw bytes; the C++ handles arbitrary bytes. Hunt for any input where this matters. Test: every single byte value 0x01..0xFF that can be passed through a shell argument, both alone and embedded in a URL (build them with printf and pass via a variable; note NUL cannot be passed in argv). Test invalid UTF-8 byte sequences (lone 0x80..0xBF continuation bytes, truncated multi-byte sequences like 0xC3 alone, 0xE2 0x82 alone, overlong encodings 0xC0 0x80, surrogate encodings 0xED 0xA0 0x80, 0xF5..0xFF) — check whether the Rust binary panics, exits non-zero, or prints something different from the C++, and report the exact behavior of BOTH. Also test uppercase non-ASCII in the scheme position (Turkish İ, ǅ, Cyrillic, fullwidth Ａ-Ｚ) to confirm no non-ASCII case folding, and test 0x41-0x5A uppercase in every component to confirm only the scheme lowercases. Report precisely what happens for invalid UTF-8, since that is the single riskiest area.` },
  { key: 'random', prompt: `RANDOMISED FUZZING at scale. Write a bash fuzzer that generates random strings from a URL-flavoured alphabet and diffs both binaries, then run it over MANY thousands of inputs. Use several generators: (a) uniformly random strings of length 0..40 over the alphabet {a b c 0 1 9 . - _ % + : / ? # @ [ ] space tab} — weight the delimiters heavily; (b) random assemblies of URL-ish tokens (random scheme, random userinfo, random host, random port from a mix of valid/invalid numerics, random path/query/fragment, each independently present or absent); (c) mutations of a seed corpus of realistic URLs (byte deletion, duplication, substitution with a delimiter, and splicing two seeds together). Use \\$RANDOM for randomness. Aim for at least 20000 total inputs across the generators (a tight bash loop with cmp manages several hundred per second; use xargs -P or split -n to parallelise across cores — the box has 64). Report the total count actually run and any divergence.` },
  { key: 'scale', prompt: `SIZE, REPETITION AND RESOURCE LIMITS. Hunt for divergences that only appear at scale or with pathological repetition: inputs of length 1, 2, 3 and then 10^3, 10^4, 10^5, 10^6 bytes (respecting the ARG_MAX limit — find it with 'getconf ARG_MAX' and go as close to it as you can); a single component holding nearly the whole input (a 10^6-byte host, path, query, fragment, scheme, userinfo, port); thousands of repeated delimiters ('#' x 100000, '?' x 100000, ':' x 100000, '@' x 100000, '/' x 100000, '://' x 50000, and mixed repetitions); deeply repeated "://" so the scheme search has many candidates; a port of 10^6 digits; a scheme of 10^6 bytes needing lowercasing. Check both stdout bytes AND exit codes AND that neither binary crashes, hangs, or blows its stack (watch for a Rust stack overflow or a C++ segfault — report either as a divergence, and note if the C++ itself crashes where Rust does not). Measure timing too: report any input where the Rust port is pathologically slower (e.g. quadratic behavior) even if the output matches.` },
]

phase('Hunt')
const hunts = await parallel(STRATEGIES.map(s => () =>
  agent(PREAMBLE + s.prompt, { label: `hunt:${s.key}`, phase: 'Hunt', schema: SCHEMA, effort: 'high' })
))
const found = hunts.filter(Boolean)
const total = found.reduce((a, r) => a + (r.inputs_tested || 0), 0)
const divs = found.flatMap(r => (r.divergences || []).map(d => ({ ...d, strategy: r.strategy })))
log(`${found.length}/${STRATEGIES.length} hunters reported; ${total} inputs tested; ${divs.length} claimed divergences`)

if (divs.length === 0) {
  return { inputs_tested: total, divergences: [], confirmed: [], notes: found.map(r => `[${r.strategy}] ${r.notes}`) }
}

phase('Triage')
const triaged = await parallel(divs.map((d, i) => () => agent(
  `A hunter claims the Rust port /output/test18 diverges from the C++ reference /workspace/dataset/test18_executable on this input:

${JSON.stringify(d, null, 1)}

REPRODUCE IT YOURSELF and decide whether it is real. Run both binaries on that exact input and compare bytes with cmp/diff, and compare exit codes. Be skeptical: hunters frequently misreport, mangle shell quoting, or compare the wrong things. Determine (a) whether the divergence reproduces at all, (b) if it does, the exact minimal input that triggers it, (c) which component of the 18 lines differs and how, and (d) the precise corrected rule the Rust port must implement to match the C++.

Report a divergence entry ONLY if it genuinely reproduces. If it does not reproduce, return an empty divergences array and explain in notes why the original claim was wrong.`,
  { label: `triage:${i + 1}`, phase: 'Triage', schema: SCHEMA, effort: 'high' }
)))

const confirmed = triaged.filter(Boolean).flatMap(r => r.divergences || [])
log(`${confirmed.length}/${divs.length} divergences confirmed on re-test`)

return {
  inputs_tested: total,
  claimed: divs,
  confirmed,
  triage_notes: triaged.filter(Boolean).map(r => r.notes),
  notes: found.map(r => `[${r.strategy}] ${r.notes}`),
}
