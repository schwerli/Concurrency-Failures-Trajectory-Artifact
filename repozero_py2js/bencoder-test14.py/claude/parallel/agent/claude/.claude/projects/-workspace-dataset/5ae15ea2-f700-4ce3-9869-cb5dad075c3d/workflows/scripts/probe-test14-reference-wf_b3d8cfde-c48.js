export const meta = {
  name: 'probe-test14-reference',
  description: 'Probe the test14 reference executable exhaustively to map argparse + int() + bencode + print behavior',
  phases: [
    { title: 'Probe', detail: 'four independent probe agents on distinct behavioral dimensions' },
    { title: 'Critic', detail: 'completeness critic: what dimension was not probed' },
  ],
}

const EXE = '/workspace/dataset/test14_executable'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'observations', 'implementation_rules'],
  properties: {
    dimension: { type: 'string' },
    observations: {
      type: 'array',
      description: 'Every concrete command probed and its exact observed output',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'stdout', 'stderr', 'returncode'],
        properties: {
          argv: { type: 'array', items: { type: 'string' } },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          returncode: { type: 'integer' },
          note: { type: 'string' },
        },
      },
    },
    implementation_rules: {
      type: 'array',
      description: 'Precise rules a JS reimplementation must follow, derived from the observations',
      items: { type: 'string' },
    },
  },
}

const COMMON = `
You are probing a PyInstaller-compiled Python program to reverse-engineer its exact observable behavior.
Executable: ${EXE}
Its Python source is:

    import argparse
    import bencoder
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=int, required=True)
    parser.add_argument('--b', type=int, required=True)
    args = parser.parse_args()
    numbers = [args.a, args.b, args.a + args.b, args.a * args.b]
    encoded = bencoder.encode(numbers)
    decoded = bencoder.decode(encoded)
    encoded_negative = bencoder.encode(-args.a)
    encoded_zero = bencoder.encode(0)
    print(encoded); print(decoded); print(encoded_negative); print(encoded_zero)

Run it with the Bash tool. Capture stdout and stderr SEPARATELY and the exact return code, e.g.:
  ${EXE} --a 5 --b 5 >/tmp/o.txt 2>/tmp/e.txt; echo "rc=$?"; then read the files.
Use printf/$'...' or python3-free shell quoting to build exotic arguments. Do NOT use the 'python' command.
Be systematic and exhaustive within your assigned dimension. Report EVERY probe you ran with its exact
output (byte-exact; describe invisible characters explicitly in the note field). Then distill precise
implementation rules for a from-scratch Node.js reimplementation.
`

phase('Probe')

const DIMENSIONS = [
  {
    key: 'argparse-cli',
    prompt: `${COMMON}
YOUR DIMENSION: argparse command-line parsing surface (NOT int-value parsing).
Probe at least: missing one/both required args; --help and -h (exact help text, byte-exact, including
blank lines and indentation); -h combined with valid args; long-option abbreviation (--h, --he, --hel,
--a vs --ab, --A case sensitivity); single-dash forms (-a 5, -b, -ab); '=' form (--a=5, --a=, --a==5,
--a=5=6); repeated options (--a 5 --a 7); the '--' separator (before, between, after args); unknown
options (--c 3, --xyz); stray positionals (extra tokens, multiple extras); ORDER of error reporting when
several problems coexist (e.g. -a 5 --b 5, or --c 3 with a missing required arg, or an invalid int AND an
unknown option); a value that looks like an option (--a --b); interspersed/abbreviated combinations;
empty-string option name; and what happens with no arguments at all. Note the exact 'usage:' line, the
exact 'prog' name used, which stream each message goes to, and the exact exit codes.`,
  },
  {
    key: 'python-int-semantics',
    prompt: `${COMMON}
YOUR DIMENSION: the exact accept/reject semantics of Python's int(str) as reached through
--a/--b values, and the exact wording of the rejection message.
Probe at least: plain digits; leading '+' and '-'; multiple signs ('--5', '+-5', '- 5'); surrounding
whitespace of every kind — space, tab, newline, carriage return, vertical tab \\x0b, form feed \\x0c,
\\x1c \\x1d \\x1e \\x1f, \\x85, NBSP \\xa0, U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000,
and also a NON-whitespace lookalike U+200B (zero width space) which should be REJECTED;
whitespace BETWEEN sign and digits ('- 5', '-\\t5'); underscore separators (1_000, 1_0_0, 1__0, _10, 10_,
'-_10' — note this last one may be swallowed by argparse instead, report which); empty string; whitespace-only;
'5.0'; '5e2'; '0x10'; '0b101'; '0o17'; 'inf'; 'nan'; 'abc'; '5 5'; '5,000';
Unicode decimal digits: Arabic-Indic U+0660..U+0669, Extended Arabic-Indic U+06F0..U+06F9, Devanagari
U+0966..U+096F, fullwidth U+FF10..U+FF19, Bengali U+09E6.., Thai U+0E50.., NKo U+07C0..,
Mathematical Bold digits U+1D7CE.., Mathematical Sans-Serif U+1D7E2.., Osmanya U+104A0..,
and MIXING scripts in one number (e.g. Arabic-Indic 5 followed by ASCII 5, or fullwidth digits with an
ASCII '-' sign, or a Unicode digit combined with an underscore separator);
non-decimal numerics that Python int() REJECTS but that look numeric: superscript '\\u00b9', vulgar
fraction '\\u00bd', Roman numeral '\\u2160', circled digit '\\u2460'.
For each, report accepted-or-rejected, the resulting parsed integer when accepted, and the exact
'invalid int value:' message text including how the offending string is quoted/escaped in the message
(especially for values containing quotes, backslashes, newlines or non-ASCII characters).`,
  },
  {
    key: 'bignum-arithmetic',
    prompt: `${COMMON}
YOUR DIMENSION: arbitrary-precision integer arithmetic and the encoded/decoded output for extreme values.
Probe at least: values far beyond IEEE-754 double precision (e.g. 2**53, 2**53+1, 2**63, 2**64,
10**30, a 200-digit number, and their negatives); products of two huge values (verify the exact full
decimal digits of a*b — reproduce them exactly in your report); a=0 with b huge; the negation output
line for a=0 (check it prints i0e and never i-0e); values where a+b is exactly 0; mixed huge signs;
and confirm no scientific notation, no truncation, and no thousands separators ever appear in output.
Also confirm the ordering/content of all four printed lines and that stdout ends with a trailing newline
(check with od -c on the last bytes).`,
  },
  {
    key: 'output-formatting',
    prompt: `${COMMON}
YOUR DIMENSION: exact byte-level output formatting of the four print() lines.
Use od -c / xxd to inspect raw stdout bytes. Establish: the exact bytes of the bytes-literal lines
(prefix b, quote character, contents), the exact list repr line (bracket, comma-space separator),
line terminators (\\n vs \\r\\n), trailing newline presence, absence of any extra whitespace, and whether
anything is written to stderr on success (should be nothing). Verify with several inputs including
negative, zero, and large values. Also determine, by reasoning from the Python bytes repr rules, what
the b'...' line would look like if it ever contained a quote or backslash (you cannot make this program
produce such bytes — state the rules you would implement and mark them as inferred, not observed).
Finally, run these exact four documented cases and confirm byte-exact agreement:
  --a -100 --b -7  ; --a 10 --b -10 ; --a 123456 --b -7 ; --a 123456 --b 1000
expected stdout line 1/2/3/4 for the first case: b'li-100ei-7ei-107ei700ee' / [-100, -7, -107, 700] / b'i100e' / b'i0e'`,
  },
]

const probes = await parallel(DIMENSIONS.map(d => () =>
  agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: SCHEMA })
))

const good = probes.filter(Boolean)

phase('Critic')

const critic = await agent(`${COMMON}
Four probe agents already mapped these dimensions: ${DIMENSIONS.map(d => d.key).join(', ')}.
Here are their distilled implementation rules:
${good.map(p => `## ${p.dimension}\n${(p.implementation_rules || []).map(r => '- ' + r).join('\n')}`).join('\n\n')}

YOUR JOB: be a completeness critic AND close the gaps yourself.
Ask: what observable behavior of this program is still unmapped, or what rule above looks wrong or
unverified? Candidates to consider: locale/encoding effects on non-UTF8 argv bytes (try an invalid UTF-8
byte sequence as a value via printf '\\xff'), argv containing NUL-adjacent oddities, extremely long
argument strings, LANG/PYTHONIOENCODING environment effects on output encoding, stdout when piped vs tty,
behavior when stdout is closed, whether the program reads stdin at all, and anything else the four
dimensions missed. RUN the probes to settle each question, then report what you found.
Set dimension to "completeness-critic". Your implementation_rules should list ONLY corrections to, or
genuinely new rules beyond, the list above.`, { label: 'critic:completeness', phase: 'Critic', schema: SCHEMA })

return { probes: good, critic }
