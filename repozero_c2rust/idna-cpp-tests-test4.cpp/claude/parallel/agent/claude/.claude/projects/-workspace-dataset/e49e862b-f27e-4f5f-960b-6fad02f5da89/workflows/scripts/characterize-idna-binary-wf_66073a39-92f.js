export const meta = {
  name: 'characterize-idna-binary',
  description: 'Black-box characterize the C++ idna test4 binary into an exact behavioral spec',
  phases: [
    { title: 'Probe', detail: 'parallel probes per behavioral dimension' },
    { title: 'Refute', detail: 'adversarial counterexample hunt per proposed rule' },
    { title: 'Critic', detail: 'completeness critic finds untested surface' },
    { title: 'Spec', detail: 'synthesize the exact specification' },
  ],
}

const BIN = '/workspace/dataset/test4_executable'

const COMMON = `
You are black-box reverse-engineering a compiled C++ binary. You MUST NOT look for or read any C++ library source (there is none on disk; \`idna.hpp\` does not exist). Derive behavior ONLY by running the binary.

BINARY: ${BIN}
Invoke as: ${BIN} "<domain-string>"
It prints exactly 4 lines, each "1" or "0", in this order:
  line1 = idna::is_valid_domain(input)
  line2 = idna::is_valid_label(input)
  line3 = idna::is_ascii_domain(input)
  line4 = idna::is_idn_domain(input)
With no argument, input defaults to the literal string "example.com".

ENVIRONMENT NOTES (important):
- python3 / python are NOT installed. perl may not be installed.
- Use bash loops, printf, tr, head, sed, awk to build test strings.
- Handy helper you can paste:
    rep() { local n=$1 c=$2 s=""; for ((i=0;i<n;i++)); do s+="$c"; done; printf '%s' "$s"; }
  or:  s=$(head -c 64 /dev/zero | tr '\\0' 'a')
- To emit arbitrary/high bytes use: printf '\\xNN'  (bash $'...' quoting also works)
- rustc and cargo ARE available if you need a quick generator program.

ALREADY-ESTABLISHED FACTS (verify, do not blindly trust):
- "" (empty)        -> 0 0 1 0
- "example.com"     -> 1 1 1 0
- "例子.测试"        -> 1 1 0 1
- "a"x63            -> 1 1 1 0
- "a"x64            -> 1 0 1 0   (is_valid_label flips off above 63)
- "a"x255           -> 1 0 1 0
- "a"x256           -> 0 0 1 0   (is_valid_domain flips off above 255)
- "." ".." "a." ".a" "a..b" "-a.com" "a-.com" "a_b.com" "a b.com" "a/b.com" "*.com" -> all 1 1 1 0

Be rigorous and quantitative. Bisect every boundary you claim (test N-1, N, N+1). Report exact reproducible command lines as evidence.
`

const RULES_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          statement: { type: 'string', description: 'A precise, testable rule about the binary behavior' },
          evidence: { type: 'string', description: 'Exact commands run and their outputs proving the rule' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['statement', 'evidence', 'confidence'],
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['dimension', 'rules', 'openQuestions'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    rule: { type: 'string' },
    holds: { type: 'boolean' },
    counterexample: { type: 'string', description: 'Exact input + observed vs predicted output, or empty if none found' },
    correctedStatement: { type: 'string', description: 'If the rule is wrong or imprecise, the corrected version; else empty' },
  },
  required: ['rule', 'holds', 'counterexample', 'correctedStatement'],
}

const DIMENSIONS = [
  {
    key: 'valid-domain-length',
    prompt: `${COMMON}

YOUR DIMENSION: is_valid_domain (line 1) — length semantics.
Determine precisely:
- The exact minimum and maximum accepted length. Bisect around 0/1 and around 253/254/255/256/257.
- Is the length measured in BYTES or in Unicode CODE POINTS? Decide this by building strings of multi-byte UTF-8 characters (e.g. "例" is 3 bytes, "ü" is 2 bytes, an emoji is 4 bytes) and finding where the flip happens. E.g. 85 copies of "例" = 255 bytes = 85 codepoints; 86 copies = 258 bytes. Test 84/85/86 copies and also 255/256 copies. Report byte-count vs codepoint-count at the flip.
- Does a trailing dot get stripped before the length check (i.e. is "a"x255 + "." valid)? Test lengths 255,256,257 with and without a trailing dot.
- Does is_valid_domain ever depend on the length of individual labels? Test a 64+ char label inside a short domain, e.g. ("a"x64)+".com", ("a"x100)+".com", ("a"x200)+".com".
Report each finding as a rule with exact evidence.`,
  },
  {
    key: 'valid-domain-structure',
    prompt: `${COMMON}

YOUR DIMENSION: is_valid_domain (line 1) — structural / character semantics (NOT length; another agent covers length).
Determine precisely, holding total length short (< 20 chars) so length never confounds:
- Are dots special at all? Test "." ".." "..." "a." ".a" "a..b" "..a.." etc.
- Are empty labels rejected? Are leading/trailing dots rejected?
- Are hyphens position-checked? "-a", "a-", "-a-", "a--b", "xn--a", "--", "a--b.com".
- Is ANY ASCII character rejected? Sweep every byte 0x01..0x7F as (a) the whole 1-char input, (b) embedded as "a<BYTE>b.com". Use printf '\\xNN'. Note: NUL (0x00) cannot be passed via argv — say so rather than guessing.
- Are control characters, space, quotes, backslash, slash, '@', '#', '%' rejected?
- Is there any case sensitivity effect? "A.COM" vs "a.com".
Explicitly answer: is is_valid_domain a pure length predicate, or does content matter at all? If content NEVER matters, say so as a high-confidence rule and show the breadth of your sweep.`,
  },
  {
    key: 'valid-label',
    prompt: `${COMMON}

YOUR DIMENSION: is_valid_label (line 2).
Note the whole input string is passed as ONE label (the program does not split on dots before calling it).
Determine precisely:
- Exact min/max length. Bisect 0/1 and 62/63/64/65.
- BYTES or CODE POINTS? Build labels of multi-byte UTF-8 chars: 21 copies of "例" = 63 bytes = 21 codepoints; 22 copies = 66 bytes. Test 20/21/22 copies. Also test with 2-byte chars ("ü": 31/32 copies = 62/64 bytes) and 4-byte chars. Pin down whether the limit is 63 bytes or 63 codepoints.
- Does content matter AT ALL? "example.com" (contains dots) returns 1, so dots are allowed. Sweep every ASCII byte 0x01..0x7F alone and embedded. Test hyphens at start/end, all-hyphens, "xn--" prefixes, digits-only, spaces, control chars.
- Is it exactly \`len >= 1 && len <= 63\`? Try hard to find ANY input of length 1..63 that returns 0, and ANY input of length 0 or >=64 that returns 1. Report the result of that search honestly.`,
  },
  {
    key: 'ascii-vs-idn',
    prompt: `${COMMON}

YOUR DIMENSION: is_ascii_domain (line 3) and is_idn_domain (line 4).
Determine precisely:
- Is is_ascii_domain simply "every byte <= 0x7F"? Sweep bytes: for each of 0x01..0x7F confirm ascii=1; for each of 0x80..0xFF (as a raw lone byte via printf '\\xNN', which is INVALID UTF-8) confirm ascii=0. Report any byte that breaks the pattern.
- Is is_idn_domain exactly the negation of is_ascii_domain for NON-EMPTY input? Find any input where line3 and line4 are BOTH 1, or BOTH 0 (empty string gives 1 and 0 — confirm and note it).
- Empty input: confirm ascii=1, idn=0.
- Does is_idn_domain do anything with the "xn--" ACE prefix? Test "xn--fsq.com", "XN--FSQ.COM", "xn--", "xn--a", "bare-xn--inside". Establish whether punycode prefixes affect line 4 at all.
- Does validity of UTF-8 matter? Test lone continuation bytes (0x80-0xBF), truncated sequences (0xC3 alone, 0xE4 0xBE alone), overlong encodings (0xC0 0x80), and 0xFE/0xFF.
- Interaction with length: is a >255-byte non-ASCII string still ascii=0 / idn=1? Confirm lines 3/4 are independent of the validity lines.`,
  },
  {
    key: 'cli-and-output',
    prompt: `${COMMON}

YOUR DIMENSION: CLI argument handling and exact output bytes.
Determine precisely:
- With NO arguments: what are the 4 lines? (should equal the result for "example.com").
- With an EMPTY first argument ${BIN} "" : what are the 4 lines?
- With MULTIPLE arguments ${BIN} "a" "b" "例子.测试" : is only argv[1] used? Confirm extra args are ignored.
- With an argument that looks like a flag: "--help", "-x". Confirm it is treated as a plain domain string, not a flag.
- Exact output bytes: run \`${BIN} example.com | od -c\` (or \`| xxd\`) and report the EXACT byte sequence. Confirm each line is "1"/"0" followed by \\n (0x0a), that there is a trailing newline after the 4th line, and that there is NO leading/trailing whitespace, no "true"/"false", and no CR.
- Exit code in all the above cases (echo $?).
- Total output byte length for a typical run (should be 8 bytes if each line is 1 char + \\n).
Report the exact od -c output as evidence.`,
  },
  {
    key: 'unicode-deep',
    prompt: `${COMMON}

YOUR DIMENSION: Unicode / multi-byte deep dive, cross-cutting all four outputs.
Determine precisely:
- For the documented example "例子.测试" (13 bytes: 3+3+1+3+3) confirm 1 1 0 1.
- Build a domain of non-ASCII chars near the 255-byte and 63-byte boundaries and determine definitively whether the length predicates count BYTES or CODE POINTS. This is the single most important question — be exhaustive. Suggested: N copies of "例" (3 bytes each) for N in 20,21,22 and 84,85,86; N copies of "ü" (2 bytes) for N in 31,32,33 and 127,128,129; N copies of a 4-byte emoji "😀" for N in 15,16,17 and 63,64,65.
  Then state: for is_valid_label the cutoff is at exactly K bytes / M codepoints — give both numbers observed.
  Same for is_valid_domain.
- Test mixed ASCII+non-ASCII strings straddling the boundary.
- Test a string that is exactly 63 codepoints but 189 bytes, and one that is exactly 63 bytes but 21 codepoints — report line 2 for each. This disambiguates definitively.
- Report whether any Unicode normalization, case folding, or punycode conversion appears to happen (it likely does not — prove it).`,
  },
]

phase('Probe')
log('Probing 6 behavioral dimensions of the C++ binary in parallel...')

const probed = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: RULES_SCHEMA }),
  (res, d) => {
    if (!res || !res.rules || !res.rules.length) return []
    return parallel(
      res.rules.map((r) => () =>
        agent(
          `${COMMON}

ADVERSARIAL VERIFICATION TASK.
Another agent studied the dimension "${d.key}" and proposes this rule about the binary:

  RULE: ${r.statement}
  Their claimed evidence: ${r.evidence}

Your job is to REFUTE it. Actively hunt for a counterexample by running ${BIN} yourself. Do not take their evidence on faith — re-run it. Then attack:
 - boundary off-by-ones (test N-1, N, N+1 around every number in the rule)
 - bytes vs codepoints confusion if the rule mentions a length
 - non-ASCII / invalid-UTF-8 inputs
 - empty string and single-character inputs
 - whether the rule over-generalizes from a small sample

Set holds=false and give the exact counterexample input + observed 4-line output if you find one. If the rule is directionally right but imprecise, set holds=false and put a precise version in correctedStatement. Only set holds=true if you genuinely tried and failed to break it. Default to skepticism.`,
          { label: `refute:${d.key}`, phase: 'Refute', schema: VERDICT_SCHEMA }
        ).then((v) => (v ? { ...v, dimension: d.key, original: r.statement, confidence: r.confidence } : null))
      )
    )
  }
)

const verdicts = probed.flat().filter(Boolean)
const confirmed = verdicts.filter((v) => v.holds)
const corrected = verdicts.filter((v) => !v.holds)
log(`${verdicts.length} rules adjudicated: ${confirmed.length} survived refutation, ${corrected.length} corrected/refuted.`)

const digest = verdicts
  .map(
    (v, i) =>
      `[${i + 1}] (${v.dimension}) ${v.holds ? 'CONFIRMED' : 'REFUTED/CORRECTED'}\n    original: ${v.original}\n    ${
        v.holds ? '' : `counterexample: ${v.counterexample}\n    corrected: ${v.correctedStatement}`
      }`
  )
  .join('\n')

phase('Critic')
const critique = await agent(
  `${COMMON}

COMPLETENESS CRITIC.
Here is everything six probe agents plus their adversarial verifiers established about the binary:

${digest}

Your job: find what is MISSING or STILL AMBIGUOUS. Specifically ask:
 - Is the bytes-vs-codepoints question for BOTH length limits settled with direct evidence? If not, settle it yourself now by running the binary.
 - Is there any input class nobody tested? (invalid UTF-8, lone high bytes, very long non-ASCII, trailing dots at the boundary, all-dot strings at the boundary, mixed-width strings)
 - Are there any contradictions between the rules above? If two rules disagree, run the binary and decide which is right.
 - Is the exact stdout byte format nailed down (od -c evidence)?
Run whatever additional probes you need. Return a concise plain-text list of: (a) any corrections to the rules above, (b) any newly discovered behavior, (c) an explicit statement of the settled bytes-vs-codepoints answer for is_valid_label and is_valid_domain, each backed by a concrete command+output.`,
  { label: 'completeness-critic', phase: 'Critic' }
)

phase('Spec')
const spec = await agent(
  `${COMMON}

FINAL SYNTHESIS.
Adjudicated rules from six probe dimensions and their adversarial verifiers:

${digest}

Completeness critic's findings (these OVERRIDE the above where they conflict):
${critique}

Produce THE definitive implementation specification for a from-scratch Rust reimplementation. Before writing it, run a final confirmation sweep of at least 30 diverse inputs against ${BIN} to sanity-check every claim you are about to make (including the five documented examples: "example.com", "test.org", "subdomain.example.com", "deep.nested.subdomain.example.com", "例子.测试").

Output plain markdown with these sections and nothing else:
1. **CLI contract** — argv handling, default value, extra-arg behavior, exit code.
2. **Exact stdout format** — the precise bytes emitted.
3. **is_valid_domain** — exact predicate, as pseudocode, stating BYTES or CODEPOINTS unambiguously.
4. **is_valid_label** — exact predicate, as pseudocode, stating BYTES or CODEPOINTS unambiguously.
5. **is_ascii_domain** — exact predicate as pseudocode.
6. **is_idn_domain** — exact predicate as pseudocode.
7. **Edge cases table** — a markdown table of at least 25 input -> "d l a i" expected-output rows, all VERIFIED by actually running the binary. Include: empty, single char, 63/64 char, 255/256 char, multibyte at boundaries, invalid UTF-8, dots-only, hyphens, xn--, uppercase.
8. **Traps** — things a naive Rust implementation would get wrong (e.g. using .chars().count() instead of .len(), using String vs OsString for args, non-UTF-8 argv handling).

Be unambiguous: a Rust engineer must be able to implement from this without ever touching the binary.`,
  { label: 'synthesize-spec', phase: 'Spec' }
)

return { spec, critique, confirmedCount: confirmed.length, correctedCount: corrected.length }
