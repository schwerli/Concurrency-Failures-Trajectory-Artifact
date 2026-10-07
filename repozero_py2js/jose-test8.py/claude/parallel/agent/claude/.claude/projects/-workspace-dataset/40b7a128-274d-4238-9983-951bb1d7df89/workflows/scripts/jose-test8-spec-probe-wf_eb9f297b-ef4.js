export const meta = {
  name: 'jose-test8-spec-probe',
  description: 'Empirically pin down remaining argparse/repr/JSON edge semantics of test8_executable',
  phases: [
    { title: 'Probe', detail: 'parallel black-box probing of distinct behavioral dimensions' },
    { title: 'Crosscheck', detail: 'independently re-verify each reported rule against the binary' },
  ],
}

const EXE = '/workspace/dataset/test8_executable'

const COMMON = `
You are black-box reverse-engineering a precompiled Python program at ${EXE}.
It was built from this source:

    import argparse
    from jose import jwt
    parser = argparse.ArgumentParser()
    parser.add_argument('--payload', type=str, required=True)
    parser.add_argument('--secret', type=str, required=True)
    args = parser.parse_args()
    secret = args.secret
    payload = {"data": args.payload}
    token = jwt.encode(payload, secret)
    print(token)
    claims = jwt.get_unverified_claims(token)
    print(claims)
    header = jwt.get_unverified_header(token)
    print(header)

RULES:
- You may run the executable as many times as you like via Bash. Never run 'python'.
- Capture stdout and stderr SEPARATELY and record exit codes. Use 'cat -A' or 'xxd' when whitespace/bytes matter.
- Your job is to produce PRECISE, MECHANICAL RULES that a JavaScript reimplementation can follow, backed by the exact commands you ran and their exact output.
- Do not speculate about CPython internals you did not observe. Every rule must be grounded in an observed command/output pair.
`

const RULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'rules', 'rawEvidence'],
  properties: {
    dimension: { type: 'string' },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'evidenceCommand', 'observedStdout', 'observedStderr', 'exitCode'],
        properties: {
          rule: { type: 'string', description: 'A mechanical, implementable rule' },
          evidenceCommand: { type: 'string' },
          observedStdout: { type: 'string' },
          observedStderr: { type: 'string' },
          exitCode: { type: 'integer' },
        },
      },
    },
    rawEvidence: { type: 'string', description: 'Any extra notes, exact byte dumps, alignment columns' },
  },
}

const DIMENSIONS = [
  {
    key: 'argparse-dashdash',
    prompt: `${COMMON}
FOCUS: the '--' pseudo-argument and option/value classification in argparse.

Determine exactly, with evidence, what happens for each of these and any others you think of:
  --payload -- --secret s
  -- --payload a --secret s
  --payload a --secret s --
  --payload a -- --secret s
  --payload=-- --secret s
  --payload -- --  (and other multi '--' cases)
  --secret s -- --payload a
Also determine how a value that looks like an option is handled:
  --payload -1 / --payload -1.5 / --payload -x / --payload - / --payload --x / --payload "-a b" (with a space)
  --payload " -x" (leading space)
Report the exact stderr text and exit code for every failing case, and the exact parsed payload/secret for every succeeding case (read them off the printed claims line).
Give me a decision procedure precise enough to reimplement.`,
  },
  {
    key: 'argparse-abbrev-errors',
    prompt: `${COMMON}
FOCUS: option abbreviation, '=' syntax, ambiguity, and the exact text/format of every error and help message.

Determine with evidence:
  - Which abbreviations resolve (--pay, --p, --s, --se, --h, --hel) and which are ambiguous/unknown, and the EXACT error text for each failure.
  - Behaviour of '=': --payload=x, --payload=, --secret=, --help=1, --p=x, --unknown=1
  - Exact error text and exit code for: no args, only --payload, only --secret, unknown option, extra positional, multiple extras, missing value at end of argv.
  - Whether the "required" error or the "unrecognized arguments" error wins when both apply, and the exact ordering/format of the names listed.
  - Whether -h/--help wins over missing required args, and its exit code.
  - The EXACT help text of '--help', byte for byte. Run: ${EXE} --help | cat -A   and report every line verbatim INCLUDING the exact number of spaces used for column alignment. This is critical - I must reproduce the alignment exactly.
  - Whether usage/errors go to stdout or stderr (test with 2>/dev/null and 1>/dev/null separately).
Report exact strings; do not paraphrase.`,
  },
  {
    key: 'python-repr',
    prompt: `${COMMON}
FOCUS: the exact formatting of line 2 and line 3 of stdout, which are Python's repr() of a dict.

Determine with evidence the complete rule for rendering the dict and its string values:
  - Quote selection: test payloads containing only ' , only " , both, neither, and quotes at string edges.
  - Which characters are backslash-escaped and in what form. Test at minimum: backslash, newline, tab, carriage return, \\x00-\\x1f range samples, \\x7f, \\x08, \\x0b, \\x0c, \\x85, \\xa0, \\xad, U+061C, U+200B-U+200F, U+2028, U+2029, U+202A-U+202E, U+2060, U+FEFF, U+3000, U+1680, U+180E, U+E000 (private use), U+FFFD, U+FFFE/U+FFFF (noncharacters), unassigned code points, emoji U+1F600, U+D7FF, CJK, combining marks, RTL text.
  - The escape FORMAT used for each class: is it \\xHH, \\uHHHH, or \\UHHHHHHHH, and is the hex upper or lower case? Determine the exact code point thresholds where the format changes.
  - Which characters are printed RAW (unescaped) vs escaped. Try to find the precise boundary rule in terms of Unicode general categories.
  - The exact separator bytes in the dict rendering: braces, colon-space, comma-space.
Generate bytes with: ${EXE} --payload "$(printf '\\xNN...')" --secret s  and inspect with 'cat -A' / 'xxd'.
State the general rule AND list every code point you tested with its observed rendering.`,
  },
  {
    key: 'json-and-jwt',
    prompt: `${COMMON}
FOCUS: the JWT itself (line 1 of stdout) - how the header and payload JSON are serialized before base64url.

You can decode the base64url segments yourself with 'base64 -d' after re-padding (the tool strips '=' padding). Determine with evidence:
  - The exact header JSON bytes. Is it always identical regardless of input?
  - The exact payload JSON bytes for various payloads: is there whitespace after ':' or ','? Are non-ASCII characters escaped, and in what exact form (case of hex digits, surrogate pairs for non-BMP)?
  - Which characters get short escapes (\\b \\f \\n \\r \\t \\" \\\\) versus \\u00XX form. Test the full 0x00-0x1f range plus 0x7f, '/', '<', '>', '&', "'".
  - Whether base64url padding '=' is stripped, and which alphabet is used (confirm '-' and '_' appear by finding inputs that produce them).
  - Whether the signature is deterministic for a fixed (payload, secret).
  - Whether the secret is UTF-8 encoded (test a non-ASCII secret and confirm determinism), and confirm behaviour for empty secret and secrets longer than 64 bytes.
Report the exact decoded JSON byte strings for every case you test.`,
  },
  {
    key: 'crypto-vectors',
    prompt: `${COMMON}
FOCUS: produce a GOLDEN TEST VECTOR FILE that a JavaScript reimplementation can be diffed against.

Write a file at /tmp/golden_vectors.tsv. Each line: payload<TAB>secret<TAB>base64url_signature<TAB>full_token
Use at least 40 diverse (payload, secret) pairs chosen to stress the implementation:
  - the 4 known sample cases: payload 'unverified_data_N' / secret 'unverified_secret_N' for N in 14, 7, 13, 10
  - empty payload, empty secret, both empty
  - secrets of length 0,1,55,63,64,65,100,200 (HMAC block-size boundaries)
  - payloads of length 0,1,55,56,57,63,64,65,119,120,121,127,128 (SHA-256 padding boundaries)
  - non-ASCII payloads and secrets (accents, CJK, emoji)
  - payloads containing quotes, backslashes, control characters
Use only shell + the executable to generate these (no python). Beware: values with tabs/newlines would corrupt the TSV, so for those use a separate section or skip them and say so.
Confirm the file was written and report its line count, plus the first 5 lines verbatim.
Return a summary of what is in the file and any generation caveats.`,
  },
]

phase('Probe')
const findings = await parallel(DIMENSIONS.map(d => () =>
  agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: RULE_SCHEMA })
    .then(r => ({ ...r, key: d.key }))
))

const good = findings.filter(Boolean)
log(`probed ${good.length}/${DIMENSIONS.length} dimensions; ${good.reduce((n, f) => n + (f.rules?.length || 0), 0)} candidate rules`)

phase('Crosscheck')
const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'status', 'note'],
        properties: {
          rule: { type: 'string' },
          status: { type: 'string', enum: ['CONFIRMED', 'WRONG', 'IMPRECISE'] },
          note: { type: 'string', description: 'If WRONG or IMPRECISE, the corrected rule with evidence' },
        },
      },
    },
  },
}

const checked = await parallel(good.map(f => () =>
  agent(`${COMMON}
Another engineer produced the following claimed rules for the "${f.dimension}" dimension of ${EXE}.
Your job is ADVERSARIAL: independently re-run the executable and try to FALSIFY each rule. Construct inputs the
original engineer probably did not try, especially boundary cases and combinations. Do not trust their stated
observations - reproduce them yourself.

CLAIMED RULES:
${JSON.stringify(f.rules, null, 2)}

EXTRA NOTES:
${f.rawEvidence}

For each rule return CONFIRMED (you reproduced it and could not break it), WRONG (you found a counterexample -
give it), or IMPRECISE (broadly right but the stated rule mispredicts some input - give that input and the
correct behaviour). Be specific and include the commands.`,
    { label: `crosscheck:${f.key}`, phase: 'Crosscheck', schema: CHECK_SCHEMA, effort: 'high' })
    .then(v => ({ key: f.key, dimension: f.dimension, ...v }))
))

const cc = checked.filter(Boolean)
const broken = cc.flatMap(c => c.verdicts.filter(v => v.status !== 'CONFIRMED').map(v => ({ key: c.key, ...v })))
log(`crosscheck complete: ${broken.length} rules were corrected or refined`)

return {
  spec: good.map(f => ({ dimension: f.dimension, key: f.key, rules: f.rules, notes: f.rawEvidence })),
  corrections: broken,
}
