export const meta = {
  name: 'verify-url-parser-port',
  description: 'Adversarially differential-test the Rust url-parser port against the C++ reference binary',
  phases: [
    { title: 'Sweep', detail: 'parallel probing lenses, each fuzzing the reference vs the port' },
    { title: 'Verify', detail: 'independently reproduce every reported divergence' },
    { title: 'Audit', detail: 'build hygiene, requirement compliance, code review' },
    { title: 'Critic', detail: 'what input class was never exercised' },
  ],
}

const CONTEXT = `
You are verifying a C++ -> Rust port by DIFFERENTIAL TESTING. Do not trust any prose spec; only the binaries.

REFERENCE (C++, ground truth):  /workspace/dataset/test7_executable
PORT UNDER TEST (Rust):        /output/test7
Rust sources (read-only for you): /output/test7.rs, /output/src/lib.rs, /output/src/url_parser/{mod,ascii,numeric,split,url}.rs
Original C++ entry point:      /workspace/dataset/test7.cpp
The C++ *library* source is NOT available and must not be sought. Black-box only.

Both binaries take exactly one argument (a URL) and print 7 lines:
  scheme, authority, port, path, query, fragment, is_valid(1/0)
With no argument they print nothing and exit 1.

HARNESS ALREADY BUILT FOR YOU:
  bash /workspace/cmp_one.sh '<arg>'
      Runs both binaries on one argument. Prints nothing and exits 0 if identical
      (stdout AND exit status). On divergence prints a report and exits 1.
  Bulk parallel form (one RAW case per line of a file, no newlines inside cases):
      xargs -a CASES.txt -d '\\n' -P 32 -I{} bash /workspace/cmp_one.sh {} | head -50
  For cases containing newlines/odd bytes, use base64 lines instead:
      bash /workspace/difftest.sh CORPUS_B64.txt      # one base64-encoded case per line

RULES:
  - NEVER modify anything under /output. Never rebuild the Rust binary. Report only.
  - Do not use python3 (not installed). Use bash/awk/sed/printf and the harness.
  - Write your scratch corpora under /workspace/scratch/ (mkdir -p it; use a unique
    filename containing your lens name so you do not collide with other agents).
  - Run LOTS of cases. Thousands, not dozens. Cases are ~2ms each with -P 32.
  - A "divergence" means cmp_one.sh exited non-zero. Report each as base64
    (printf '%s' "$arg" | base64 -w0) so the exact bytes survive.
  - Report ONLY real, reproduced divergences. If you find none, say so plainly and
    report casesRun honestly. Do NOT invent findings. An empty divergence list is a
    perfectly good and expected result.
`

const SWEEP_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    casesRun: { type: 'integer', description: 'How many distinct arguments you actually ran through cmp_one.sh' },
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          argBase64: { type: 'string', description: 'base64 -w0 of the exact argument bytes' },
          note: { type: 'string', description: 'cpp output vs rust output, one line each' },
        },
        required: ['argBase64', 'note'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string', description: 'What you covered and any behaviour worth recording' },
  },
  required: ['lens', 'casesRun', 'divergences', 'notes'],
  additionalProperties: false,
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    arg: { type: 'string' },
    cppOutput: { type: 'string' },
    rustOutput: { type: 'string' },
    rule: { type: 'string', description: 'The reference behaviour rule the port got wrong, and the minimal fix' },
  },
  required: ['real', 'arg', 'cppOutput', 'rustOutput', 'rule'],
  additionalProperties: false,
}

const LENSES = [
  {
    key: 'delimiter-combinatorics',
    prompt: `LENS: delimiter combinatorics at LENGTH 7 AND 8.
An exhaustive sweep over the alphabet {a : / ? # @ 8} for lengths 1..6 already passed with zero
divergences. Go LONGER and WIDER: (a) exhaustive length-7 over a reduced alphabet such as
{a : / ? # @} (~280k is too many — instead pick 3-4 reduced alphabets of size 5 and do exhaustive
length 7 = 78125 each, or sample heavily); (b) random strings of length 7..20 over
{a b 8 : / ? # @ . - + % [ ] space} — tens of thousands of them, generated with awk or bash
\$RANDOM; (c) hand-built pathological patterns: many consecutive delimiters, ':///', '://://://',
'@@@', '?#?#', trailing/leading delimiters, delimiters only.
Generate with awk for speed, then run with xargs -P 32.`,
  },
  {
    key: 'port-numeric',
    prompt: `LENS: the port field and its numeric conversion.
The reference appears to use std::stoi (strtol base 10) then a range check. Attack that hard:
every boundary of int and of the port range (-1,0,1,65534,65535,65536,32767,32768,65537,
2147483646..2147483649, 4294967295..4294967297, -2147483648, -2147483649), values with 1..40 digits,
leading zeros of many widths, '+'/'-'/'++'/'--'/'+-'/'-+' prefixes, every C-locale whitespace byte
(space, \\t, \\n, \\v = \\x0b, \\f = \\x0c, \\r) before/after/between sign and digits, digits followed by
junk ('80abc', '80.5', '80e3', '80,5', '0x50', '0X50', '0b1', '080', '8_0'), non-ASCII digits
(Arabic-Indic \\u0660, fullwidth \\uff18), thousands separators, embedded NUL-ish escapes,
and the same set placed after a second colon ('h:1:2'), inside userinfo ('u:80@h'), and with
an empty host (':80'). Build cases as 'http://h:<PORT>/p' AND 'http://h:<PORT>' AND
'http://u@h:<PORT>/p'. Use base64 corpus + difftest.sh for cases containing control bytes.
Thousands of cases.`,
  },
  {
    key: 'scheme',
    prompt: `LENS: the scheme and the '://' separator.
Attack: schemes of every ASCII case mix; schemes containing digits, '+', '-', '.', spaces, tabs,
control bytes, delimiters ('/', ':', '?', '#', '@'); empty scheme ('://x'); multiple '://'
occurrences at many positions; '://' split across what looks like a path ('/a://b', 'a/b://c');
near-misses (':/', ':', '//', ':://', ':///', '://///'); very long schemes (1KB of 'a');
schemes with non-ASCII/UTF-8 bytes and with uppercase non-ASCII (verify the port only
lower-cases ASCII A-Z, never non-ASCII); Turkish dotted/dotless I; 'HTTP', 'HtTp', 'hTTP'.
Also confirm ordering: a '://' that lives inside the query or the fragment must NOT become a
scheme — probe that from many angles. Thousands of cases.`,
  },
  {
    key: 'userinfo-at',
    prompt: `LENS: userinfo and the '@' separator inside the authority.
Attack: zero/one/many '@'; '@' at start, end, adjacent; '@' combined with ':' in every relative
order ('a@b:80', 'a:80@b', 'a@b@c:80', 'a:1@b:2@c:3', ':@', '@:', ':@:', '@:80', 'h:80@');
'@' in the path/query/fragment (must be ignored); userinfo containing '/', '?', '#' (should be
impossible since those terminate the authority — verify); empty userinfo vs absent userinfo and
whether the rebuilt authority keeps or drops the '@'; userinfo with percent-encoding and
non-ASCII; extremely long userinfo. Also probe how the rebuilt authority differs from the raw
input substring in every combination you can construct. Thousands of cases.`,
  },
  {
    key: 'is-valid',
    prompt: `LENS: the is_valid() flag — try to FALSIFY the hypothesis that it equals
(host is non-empty) OR (path is non-empty), where host is the authority text after the first '@'
and before the first ':'.
Systematically enumerate every combination of {scheme present/absent} x {authority
empty/host-only/port-only/userinfo-only/full} x {path empty/'/'/'/p'} x {query empty/non-empty} x
{fragment empty/non-empty}, built as concrete URL strings, and diff them. Pay special attention to
cases where the rebuilt authority is non-empty but the host is empty (':80', 'u@', 'u@:80') and
where the host is non-empty but the authority looks odd. Also whitespace-only hosts and paths
(' ', '\\t'). If you find ANY case where the port's is_valid differs from the reference, report it.
Thousands of cases.`,
  },
  {
    key: 'non-ascii-and-size',
    prompt: `LENS: non-ASCII bytes, encodings, and size.
Attack: UTF-8 multi-byte in every component (scheme, userinfo, host, port slot, path, query,
fragment) — Cyrillic, CJK, emoji (4-byte), combining marks; IDN and punycode hosts
('xn--80ak6aa92e.com'); percent-encoded sequences including '%2F', '%3A', '%23', '%3F', '%40',
'%00', and malformed '%', '%z', '%2'; high bytes \\x80-\\xff standalone (INVALID UTF-8 — this is
important: check whether the Rust port panics or diverges; build these with
printf '\\xNN' and a base64 corpus + difftest.sh); very long inputs (1KB, 64KB, 256KB) of
repeated 'a', of repeated delimiters, and a long URL with all components maxed;
inputs that are a single byte of each value 1..127 (NUL cannot be passed through argv).
Report a Rust panic or any exit-status difference as a divergence. Thousands of cases.`,
  },
  {
    key: 'real-world',
    prompt: `LENS: realistic URLs, broadly sampled.
Build a corpus of at least 600 real-world-shaped URLs spanning: http/https with and without www,
ports, deep paths, trailing slashes, dots and double-dots, index files, query strings with many
params, empty params, repeated params, encoded params, fragments including SPA '#/route' and
'#!' forms; ftp/ftps/sftp/file/ws/wss/git/git+ssh/svn+ssh/ssh/telnet/ldap/ldaps/gopher/
data/blob/javascript/about/chrome/view-source/magnet/urn/tel/sms/mailto/news/nntp/irc/rtsp/
rtmp/mms/s3/gs/redis/postgres/postgresql/mysql/mongodb/amqp/jdbc URLs; IPv4 hosts including
dotted-decimal oddities and 0.0.0.0; IPv6 in brackets with and without ports and zone ids;
localhost; hosts with trailing dots; credentials in the URL; 'data:text/plain;base64,...';
'file:///C:/Windows/path' and Windows drive letters; UNC-ish paths; protocol-relative '//cdn/x';
relative paths and bare filenames; query-only and fragment-only strings.
Run every one through cmp_one.sh.`,
  },
  {
    key: 'random-fuzz',
    prompt: `LENS: high-volume unstructured random fuzzing.
Generate at least 40000 random arguments with awk (seed it from a fixed constant so the run is
reproducible; do NOT use python3) over a wide printable-ASCII alphabet that is DELIBERATELY dense
in the parser's significant characters (':', '/', '?', '#', '@', digits) but also includes letters,
punctuation and spaces. Use a mix of lengths 0..40. Also generate 5000 cases from a grammar that
assembles random component-shaped fragments: {scheme}{sep}{userinfo}{@}{host}{:port}{path}{?query}
{#fragment} where each part is independently present/absent/degenerate.
Run them all with xargs -P 32 and report every divergence.`,
  },
  {
    key: 'whitespace-control',
    prompt: `LENS: whitespace and control characters.
Attack: leading/trailing/internal spaces and tabs in every component; the C-locale whitespace set
(\\t \\n \\v \\f \\r space) individually and in runs, placed before/inside/after the port, the host,
the scheme and the path; embedded newlines and carriage returns (these change the LINE STRUCTURE of
the output, so they are a strong test of byte-for-byte equality — the C++ prints the raw component
with std::endl, so a component containing '\\n' produces extra lines; verify the Rust port does the
same); control bytes \\x01-\\x1f and \\x7f in every component; a lone '\\r' and a '\\r\\n'.
Use a base64 corpus with difftest.sh so the bytes survive. Thousands of cases.`,
  },
  {
    key: 'authority-path-boundary',
    prompt: `LENS: the authority/path boundary and the path component.
Attack: the first '/' after '://' in every position, including absent, immediately present
('http:///p'), doubled ('http:////p'), and only-slashes ('http://///'); authority terminated by
'?' or '#' instead of '/' in every arrangement; paths containing ':', '@', '//', '://', backslashes,
dot segments, empty segments, and a query-looking or fragment-looking substring that was already
consumed; extremely long paths; a path that is exactly '/'; and the no-scheme branch where the
WHOLE remaining string becomes the path ('example.com', '//host/p', '/p', ':', 'a:b', 'a:b:c').
Verify that in the no-scheme branch the authority and port are always empty/-1 no matter what
colons and at-signs the string contains. Thousands of cases.`,
  },
]

phase('Sweep')
log(`Running ${LENSES.length} differential-testing lenses against the reference binary`)

const sweeps = await pipeline(
  LENSES,
  (lens) => agent(`${CONTEXT}\n\n${lens.prompt}\n\nSet "lens" to "${lens.key}" in your result.`, {
    label: `sweep:${lens.key}`,
    phase: 'Sweep',
    schema: SWEEP_SCHEMA,
  }),
  // Each divergence this lens claims gets independently reproduced right away,
  // rather than waiting on the slowest lens.
  (sweep, lens) => {
    if (!sweep || !sweep.divergences || sweep.divergences.length === 0) return { sweep, verdicts: [] }
    return parallel(
      sweep.divergences.slice(0, 12).map((d) => () =>
        agent(
          `${CONTEXT}\n\nA prior agent claims the Rust port DIVERGES from the C++ reference on this argument.\n` +
            `The argument, base64-encoded, is:\n${d.argBase64}\n\n` +
            `Their note: ${d.note}\n\n` +
            `Your job is to REFUTE this claim. Decode it with:\n` +
            `  arg=$(printf '%s' '${d.argBase64}' | base64 -d)\n` +
            `then run both binaries yourself and compare stdout byte-for-byte (use cmp or diff, and\n` +
            `also compare exit status). Default to real=false unless you personally reproduce a real\n` +
            `byte-level difference. If it IS real, state the exact reference rule the port gets wrong\n` +
            `and the minimal fix to the Rust source in "rule".`,
          { label: `verify:${lens.key}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ),
      ),
    ).then((verdicts) => ({ sweep, verdicts: verdicts.filter(Boolean) }))
  },
)

const ok = sweeps.filter(Boolean)
const totalCases = ok.reduce((n, r) => n + (r.sweep && r.sweep.casesRun ? r.sweep.casesRun : 0), 0)
const confirmed = ok.flatMap((r) => r.verdicts.filter((v) => v.real))
log(`Sweep complete: ${totalCases} cases across ${ok.length} lenses, ${confirmed.length} confirmed divergences`)

phase('Audit')
const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
    details: { type: 'string' },
  },
  required: ['ok', 'issues', 'details'],
  additionalProperties: false,
}

const audits = await parallel([
  () => agent(
    `${CONTEXT}\n\nAUDIT: build hygiene. Do NOT modify files under /output, but you MAY run build\n` +
      `commands there (they only create target/ and binaries).\n` +
      `Verify all of the following and report each as an issue if it fails:\n` +
      `  1. cd /output && cargo build --release   -> succeeds with ZERO warnings\n` +
      `  2. cd /output && cargo test              -> all unit tests pass\n` +
      `  3. cd /output && rustc --edition 2021 -O test7.rs -o /tmp/t7_audit -> succeeds, ZERO warnings\n` +
      `  4. The rustc-built and cargo-built binaries behave identically to /output/test7 on a\n` +
      `     dozen sample URLs (diff their outputs).\n` +
      `  5. Cargo.toml declares edition 2021 and has NO [dependencies] entries at all.\n` +
      `  6. No file under /output references any crates.io crate (grep for 'extern crate', 'use ' of\n` +
      `     anything that is not std/core/crate/self/super, and any [dependencies] section).\n` +
      `Report the exact command output for anything that fails.`,
    { label: 'audit:build', phase: 'Audit', schema: AUDIT_SCHEMA },
  ),
  () => agent(
    `${CONTEXT}\n\nAUDIT: requirement compliance. Read /workspace/dataset/test7.cpp and the Rust\n` +
      `sources. Check each requirement and report failures as issues:\n` +
      `  1. Rust 2021 edition, pure std, zero external crates.\n` +
      `  2. CLI arguments identical to the C++: exactly argv[1] is used; fewer than 2 args exits 1\n` +
      `     with no output; extra args ignored. Args parsed via std::env::args(). VERIFY BY RUNNING.\n` +
      `  3. Output formatting identical: 7 lines, same order, port printed as a plain int, is_valid\n` +
      `     printed as 1/0, trailing newline present on the last line. Compare with cmp against the\n` +
      `     reference for several inputs, including one where a component is empty.\n` +
      `  4. A complete Cargo project exists in /output with library code organised into MODULES\n` +
      `     (not one flat file), and the entry file is at /output/test7.rs (package root).\n` +
      `  5. An executable exists at /output/test7 and runs.\n` +
      `  6. Confirm the five documented examples in the comment block at the bottom of test7.cpp\n` +
      `     reproduce EXACTLY against /output/test7.\n` +
      `Report concrete evidence for every check.`,
    { label: 'audit:requirements', phase: 'Audit', schema: AUDIT_SCHEMA },
  ),
  () => agent(
    `${CONTEXT}\n\nAUDIT: Rust code review. Read every file under /output. You are looking for\n` +
      `latent correctness hazards and quality problems, NOT for style nits:\n` +
      `  - Any possible panic: slicing on a non-char-boundary index, integer overflow in the stoi\n` +
      `    emulation (check the accumulator against i64 overflow for a 40-digit input), unwrap/expect,\n` +
      `    indexing. Prove each hazard is reachable or unreachable by ARGUMENT, then try to trigger it\n` +
      `    with a real input through /output/test7.\n` +
      `  - Any place where the Rust logic could differ from the reference for an input class the\n` +
      `    sweep lenses might have missed. Test any suspicion against both binaries.\n` +
      `  - Dead code, misleading comments, comments that state a rule the code does not implement.\n` +
      `Report only issues you can substantiate.`,
    { label: 'audit:code', phase: 'Audit', schema: AUDIT_SCHEMA },
  ),
])

phase('Critic')
const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { lens: { type: 'string' }, why: { type: 'string' } },
        required: ['lens', 'why'],
        additionalProperties: false,
      },
    },
    assessment: { type: 'string' },
  },
  required: ['gaps', 'assessment'],
  additionalProperties: false,
}

const coverage = ok
  .map((r) => `- ${r.sweep.lens}: ${r.sweep.casesRun} cases, ${r.sweep.divergences.length} claimed divergences. ${r.sweep.notes}`)
  .join('\n')

const critic = await agent(
  `${CONTEXT}\n\nCOMPLETENESS CRITIC. These differential-testing lenses have run:\n\n${coverage}\n\n` +
    `Additionally, an exhaustive sweep over every string of length 1..6 from the alphabet\n` +
    `{a : / ? # @ 8} (137k cases) passed with zero divergences, and 100 hand-probed cases passed.\n\n` +
    `Identify input classes that were NEVER exercised and that could plausibly reveal a divergence.\n` +
    `Be concrete and adversarial. Then ACTUALLY TEST the top gaps you find yourself, using the\n` +
    `harness, and report in "assessment" whether any of them produced a divergence.`,
  { label: 'critic:coverage', phase: 'Critic', schema: CRITIC_SCHEMA },
)

const auditIssues = audits.filter(Boolean).flatMap((a) => a.issues)

return {
  totalCases,
  lenses: ok.map((r) => ({ lens: r.sweep.lens, cases: r.sweep.casesRun, claimed: r.sweep.divergences.length })),
  confirmedDivergences: confirmed,
  refutedCount: ok.reduce((n, r) => n + r.verdicts.filter((v) => !v.real).length, 0),
  auditIssues,
  auditDetails: audits.filter(Boolean).map((a) => ({ ok: a.ok, details: a.details })),
  criticGaps: critic ? critic.gaps : [],
  criticAssessment: critic ? critic.assessment : 'critic failed',
}
