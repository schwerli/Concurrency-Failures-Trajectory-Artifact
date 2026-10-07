export const meta = {
  name: 'probe-base58-test15',
  description: 'Exhaustively characterize /workspace/dataset/test15_executable black-box behavior',
  phases: [
    { title: 'Probe', detail: 'parallel probes of repr, argparse, base58, errors' },
    { title: 'Critique', detail: 'completeness critic finds unprobed dimensions' },
    { title: 'Probe2', detail: 'follow-up probes for gaps' },
  ],
}

const EXE = '/workspace/dataset/test15_executable'

const SPEC = {
  type: 'object',
  required: ['dimension', 'rules', 'evidence', 'open_questions'],
  properties: {
    dimension: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, implementable rules derived from observed behavior',
      items: { type: 'string' },
    },
    evidence: {
      type: 'array',
      description: 'Concrete command -> exact stdout/stderr/exit-code observations that justify the rules',
      items: {
        type: 'object',
        required: ['command', 'stdout', 'exit_code'],
        properties: {
          command: { type: 'string' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exit_code: { type: 'integer' },
        },
      },
    },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
}

const COMMON = `
You are black-box characterizing a compiled Python program at ${EXE}.
Its Python source is:

    import argparse, base58
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    parser.add_argument('--b', type=str, required=True)
    parser.add_argument('--c', type=str, required=True)
    parser.add_argument('--d', type=str, required=True)
    args = parser.parse_args()
    enc1 = base58.b58encode(args.a.encode())
    enc2 = base58.b58encode(args.b.encode())
    dec1 = base58.b58decode(args.c)
    dec2 = base58.b58decode(args.d)
    print(enc1); print(enc2); print(dec1); print(dec2)

Goal: a Node.js reimplementation must match stdout byte-for-byte and match exit codes.
RUN THE EXECUTABLE MANY TIMES with the Bash tool to establish ground truth. Do NOT use the
\`python\` command (unavailable/forbidden). Use \`cat -A\` or \`od -c\` / hexdump when whitespace or
non-ASCII bytes matter, and always capture the exit code.
Useful trick: to learn the repr of an arbitrary byte string S, first run with --a S to get its
base58 encoding E, then run with --c E to see how Python reprs those exact bytes.
Be rigorous and adversarial: try to break your own hypotheses. Report ONLY what you verified by running.
`

phase('Probe')

const DIMS = [
  {
    key: 'bytes-repr',
    prompt: `${COMMON}
YOUR DIMENSION: Python's \`print(bytes_object)\` output format, i.e. bytes repr.
Determine EXACTLY, with evidence, how each byte class is rendered inside b'...':
 - printable ASCII 0x20..0x7e
 - the single quote 0x27 and the double quote 0x22, including which quote character Python
   chooses to delimit the literal when the payload contains ' only, " only, both, or neither
 - backslash 0x5c
 - 0x09 tab, 0x0a newline, 0x0d carriage return
 - other C0 control bytes (0x00..0x08, 0x0b, 0x0c, 0x0e..0x1f) and 0x7f
 - high bytes 0x80..0xff
 - is hex in \\xNN lower or upper case? is it always exactly 2 digits?
 - empty bytes
Construct payloads that contain these bytes by the --a then --c round-trip trick described above.
E.g. to see repr of "it's": run --a "it's" to get base58 E, then --c E.
Cover at minimum: a payload with only ', a payload with only ", a payload with BOTH ' and ",
a payload with a backslash, a payload with tab+newline+CR, a payload with 0x00 and 0x1f and 0x7f,
a payload with 0x80 and 0xff (use UTF-8 multibyte input like 'é' or '€' to generate high bytes),
and the empty payload.
Produce a complete, unambiguous escaping algorithm as rules.`,
  },
  {
    key: 'argparse',
    prompt: `${COMMON}
YOUR DIMENSION: argparse command-line parsing semantics that must be replicated.
Establish with evidence:
 - --a VALUE vs --a=VALUE forms
 - argument order independence; repeated options (which wins?)
 - values that look like options: --a -5, --a -x, --a --b, --a=-5, --a "" (empty string)
 - the \`--\` pseudo-argument
 - missing required options: exact stderr text and exit code (test missing one, missing several,
   and no args at all -- note the ORDER in which missing args are listed)
 - unrecognized/extra arguments: exact stderr and exit code
 - positional/extra bare arguments e.g. \`--a 1 --b 2 --c z --d z extra\`
 - -h / --help: exact stdout text (use cat -A to capture exact spacing/newlines) and exit code
 - abbreviation/prefix matching: is \`--\` alone or a bad prefix like \`--x\` handled how?
 - what happens with an option given no value at the end: \`--a 1 --b 2 --c z --d\`
 - a value containing an equals sign, spaces, or unicode
Report exact stderr strings verbatim and exit codes for every failure mode.`,
  },
  {
    key: 'base58-encode',
    prompt: `${COMMON}
YOUR DIMENSION: base58 ENCODING behavior (the --a / --b path), which is b58encode(str.encode()).
Establish with evidence:
 - the 58-character alphabet and its exact order (derive it empirically: find single-character or
   short inputs whose encodings reveal alphabet ordering; verify Bitcoin alphabet
   123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz is or is not the one used)
 - empty input -> exact output
 - single byte inputs across the range
 - UTF-8 encoding of non-ASCII input: verify that 'é' (2 bytes), '€' (3 bytes), an emoji like
   '😀' (4 bytes) encode as UTF-8 big-endian integers. Cross-check by decoding the result back
   through --c and confirming the byte repr.
 - very long inputs (e.g. 200+ chars) - confirm arbitrary-precision correctness. Verify by
   round-tripping: --a LONG gives E; then --c E must repr back to LONG.
 - inputs with leading characters that could map to zero bytes (note argv cannot contain NUL,
   so state whether leading-zero-byte handling is reachable at all)
Give the exact algorithm as rules, including big-integer handling and leading-zero convention.`,
  },
  {
    key: 'base58-decode',
    prompt: `${COMMON}
YOUR DIMENSION: base58 DECODING behavior (the --c / --d path), which is b58decode(str).
Establish with evidence:
 - empty string -> exact output
 - leading '1' characters -> how many leading 0x00 bytes; test '1', '11', '111', '11z', '1z1'
   (note: is a '1' in the MIDDLE treated as a leading zero? verify)
 - a string of all '1's only
 - invalid characters: exact ValueError message format and exit code. Test '0', 'O', 'I', 'l',
   ' ' (space), '+', '/', '='. Which of these are valid vs invalid in this alphabet?
 - NON-ASCII input to --c, e.g. --c 'é' or --c '€': does it raise ValueError or
   UnicodeEncodeError/UnicodeDecodeError? Report the EXACT exception type and message and exit code.
 - is there any whitespace stripping or autofix? test ' z', 'z ', 'z\\n'
 - long inputs (100+ base58 chars) - verify big-integer correctness by round-tripping through --a
 - whether decode output is checked/validated in any way
Report the exact exception text (including the traceback shape) for each failure, plus exit codes.
Note which parts of stderr are nondeterministic (e.g. PyInstaller PID numbers).`,
  },
  {
    key: 'ordering-and-errors',
    prompt: `${COMMON}
YOUR DIMENSION: evaluation order, partial output, and exit-code semantics.
Establish with evidence:
 - When --c is invalid but --a/--b are fine: is ANY line printed to stdout before the error?
   (capture stdout separately from stderr, e.g. \`cmd 2>/dev/null\` and \`cmd 2>&1 1>/dev/null\`)
 - When --d is invalid but --c is valid: same question.
 - When BOTH --c and --d are invalid: which error is reported?
 - Exit codes for: full success, decode ValueError, argparse failure, --help.
 - Is stdout flushed/ordered relative to stderr? Does the ORDER of encode/decode operations
   matter for observable behavior?
 - Confirm each print emits exactly one trailing newline (\\n not \\r\\n) using cat -A / od -c.
 - Confirm there is no extra trailing output at end of program.
Also verify the 4 sample cases from the source file all reproduce exactly:
  1) --a 'TPcTsjvTNHtabUBA' --b 'U5Oa2ji3Q' --c '32eMed' --d '27sNiTaAuDXTYdy4WiQLdaWGA1Vt'
  2) --a '2Qu1ga2eTaoXNQzeniuzRQxH1rnQ' --b 'drn1vtp' --c 'Cn8eVZg' --d '2722bfR1UtrSp6ixizzEZeVU9B9hBNcHut8QQ2Q'
  3) --a '5kfxvzBm43bWNCpsa3B3dt5uXuced' --b 'U5Oa2ji3Q' --c 'q' --d '3ke2ct1cd4rY7VuvWWKG2'
  4) --a 'TPcTsjvTNHtabUBA' --b '5aN1QrVUtM5PMaBzNoYFqL5wGSWAw' --c '32eMed' --d '79KKvfsXwLkag2r3FrZNPdWKv4pvT8DVk'`,
  },
]

const probes = await parallel(DIMS.map(d => () =>
  agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: SPEC })
))

const good = probes.filter(Boolean)
log(`collected ${good.length}/${DIMS.length} dimension reports`)

phase('Critique')

const CRITIC = {
  type: 'object',
  required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['question', 'probe_commands'],
        properties: {
          question: { type: 'string' },
          probe_commands: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const critique = await agent(`${COMMON}
You are a COMPLETENESS CRITIC. Below are characterization reports from five probe agents.
Identify what is still MISSING or UNVERIFIED that could cause a Node.js reimplementation to
diverge from this executable on stdout or exit code. Think about: unusual byte-repr cases, big-int
edge cases, argparse corner cases, locale/encoding issues, surrogates/invalid UTF-8 in argv,
extremely long inputs, inputs at exact byte-length boundaries, and anything the reports flagged as
an open question. For each gap give concrete shell commands that would resolve it.
Return at most 12 high-value gaps. Do not repeat things already firmly established.

REPORTS:
${JSON.stringify(good, null, 1).slice(0, 60000)}`,
  { label: 'critic', phase: 'Critique', schema: CRITIC })

phase('Probe2')

const gaps = (critique?.gaps || []).slice(0, 12)
log(`critic raised ${gaps.length} gaps`)

const followups = await parallel(gaps.map((g, i) => () =>
  agent(`${COMMON}
Resolve this SINGLE open question by actually running the executable. Run every command you need.

QUESTION: ${g.question}

Suggested probes (adapt as needed, add more):
${(g.probe_commands || []).map(c => '  ' + c).join('\n')}

Answer definitively with the implementable rule and the raw evidence. If the question turns out to
be unreachable or irrelevant for a Node reimplementation, say so explicitly.`,
    { label: `gap${i + 1}`, phase: 'Probe2', schema: SPEC })
))

return {
  dimensions: good,
  gapResolutions: followups.filter(Boolean),
}
