export const meta = {
  name: 'pyaes-cbc-migration-research',
  description: 'Exhaustively probe the pyaes CBC reference binary to pin down argparse, bytes-repr, and AES behavior before porting to Node ESM',
  phases: [
    { title: 'Probe', detail: 'parallel black-box probes of /workspace/dataset/test17_executable' },
    { title: 'Synthesize', detail: 'merge probe findings into one authoritative spec' },
  ],
}

const BIN = '/workspace/dataset/test17_executable'

const PROBES = [
  {
    key: 'argparse',
    prompt: `You are black-box reverse-engineering the CLI argument parsing of the PyInstaller-frozen Python program at ${BIN}.
Its Python source is:

  parser = argparse.ArgumentParser()
  parser.add_argument('--key', type=str, required=True)
  parser.add_argument('--iv', type=str, required=True)
  parser.add_argument('--data', type=str, required=True)
  args = parser.parse_args()

Run the binary MANY times (dozens) with Bash to determine EXACT observable behavior. Capture stdout, stderr, and exit code SEPARATELY (e.g. run with 2>/tmp/err.txt then cat it; use printf %q or od -c when whitespace matters).

Cover at minimum:
- no args; only some required args present; ordering of the "the following arguments are required: X, Y" list
- -h / --help (exact byte-for-byte help text, including blank lines, column alignment, trailing newline). Also --he, --hel, -h combined with other args, and "-h" AFTER an invalid/unknown arg.
- unknown options (single and multiple), unknown positionals, mixture of both — exact "unrecognized arguments:" text and how multiple leftovers are joined
- prefix abbreviations: --k, --ke, --i, --d, --da; ambiguous prefixes if any exist
- --opt=value form, --opt value form, --opt= (empty value via equals), --opt "" (empty value)
- option given twice (last wins?)
- a value that starts with '-' or '--' (e.g. --data --0123456789abcd), a value that looks like a negative number (e.g. --data -12345)
- the bare "--" separator in various positions
- missing value for the final option (e.g. binary --key)
- what exactly goes to stdout vs stderr for each case, and the exit code
- whether the usage line wraps for long prog names (not testable) — skip
- Is there a trailing newline after the last line of help? After the error message? Use od -c to confirm.

ALSO determine the exact runtime-error output shape (stderr + exit code) for:
- invalid key size (key whose UTF-8 length is not 16/24/32)
- invalid IV size (not 16 bytes)
- data length not a multiple of 16 bytes
Report the EXACT traceback lines. Note: I suspect the "[PYI-NNN:ERROR]" number is the process PID — verify by running repeatedly and comparing, and by correlating with $! or a wrapper that echoes the child's pid.

Return a precise, complete spec as plain text: for each scenario, the literal stdout, literal stderr, and exit code. Quote exact strings. Do not summarize away whitespace. This is a spec another engineer will implement from with zero access to the binary.`,
  },
  {
    key: 'bytesrepr',
    prompt: `You are black-box determining the exact rules Python 3 uses for repr() of a bytes object, as printed by ${BIN}.

The program prints, for each 16-byte AES-CBC ciphertext block, the result of Python's print(cipher) where cipher is a bytes object.

Your job: derive and CONFIRM the exact repr algorithm by experiment. You CANNOT run python. But you CAN use the binary as an oracle: it prints repr() of 16 random-looking ciphertext bytes. Run it MANY times (100+) with varied --key/--iv/--data (all ASCII, key 16 bytes, iv 16 bytes, data a multiple of 16 bytes) and collect the printed lines. Use a bash loop generating random 16/32/48-byte ASCII data so you get a large corpus of reprs over essentially random byte values.

From the corpus, empirically establish:
1. Which byte values are printed literally vs escaped.
2. The escape forms used: \\\\xHH (lowercase hex? zero padded to 2?), \\\\t, \\\\n, \\\\r, \\\\\\\\ , \\\\' , and whether \\\\a \\\\b \\\\f \\\\v \\\\0 are used or whether those bytes are \\\\x07 \\\\x08 \\\\x0c \\\\x0b \\\\x00.
3. The quote-selection rule: when is the literal b'...' vs b"..." — find corpus lines containing 0x27 (') only, 0x22 (") only, and BOTH. Report exactly what happens in each of the three cases and how the quote char is escaped.
4. Byte 0x7f and bytes >= 0x80: literal or \\\\xHH?
5. Whether there is any use of \\\\uXXXX or non-ASCII output (there should not be).

To find corpus lines containing specific bytes, grep the accumulated output. Be systematic: write the corpus to a file, then grep for the interesting patterns. Aim to observe every byte value 0x00-0xff at least once across the corpus; report any byte values you never observed and what you infer for them.

Return: a complete, unambiguous specification of the repr algorithm as pseudocode, plus the concrete evidence lines (a handful of literal example outputs) that prove each rule, especially the three quote cases.`,
  },
  {
    key: 'aesvectors',
    prompt: `You are extracting AES known-answer test vectors from the black-box binary ${BIN} so another engineer can validate a from-scratch AES implementation.

The binary computes AES-CBC (no padding) over the UTF-8 bytes of --data, using UTF-8 bytes of --key and --iv, and prints Python repr() of each 16-byte ciphertext block. Key may be 16, 24, or 32 bytes (AES-128/192/256). IV must be 16 bytes. Data length must be a multiple of 16.

Note all inputs are passed as command-line STRINGS, so you can only produce byte values that are printable/typable via the shell. Use printf and $'...' bash quoting to inject arbitrary bytes where possible, but be careful: NUL bytes cannot be passed in argv. Prefer ASCII printable inputs.

Do this:
1. Confirm the mode is CBC by testing: encrypt a 32-byte plaintext P1||P2 with key K, iv IV. Separately, verify block1 == AES-ECB(K, P1 XOR IV) by constructing a second run whose IV is chosen so the XOR result is a known value. Specifically: to compute AES-ECB(K, X) for an arbitrary 16-byte X, run the binary with --iv X and --data (16 bytes of some string S), which gives AES(K, X XOR S) as block 1. Choosing S carefully (e.g. all 'A' = 0x41) lets you compute ECB of any typable X. Document the trick you used.
2. Confirm chaining: block2 == AES-ECB(K, P2 XOR block1). Verify numerically using the ECB oracle from step 1 where the needed inputs are typable; if the needed bytes aren't typable, verify indirectly (e.g. show that changing only P1 changes block2, and that a run with iv=block1 and data=P2 reproduces block2 exactly — this one IS testable if block1 happens to be typable; keep sampling random keys/data until you find a run where block1 is entirely printable ASCII with no shell-hostile bytes, or handle quoting with $'..' escapes).
   THIS IS THE KEY EXPERIMENT: find a case where you can feed a previous ciphertext block back in as the IV and confirm you get the same next block. Persist until you succeed.
3. Produce a table of at least 12 reproducible test vectors spanning AES-128 (16-byte key), AES-192 (24-byte key), AES-256 (32-byte key), with 16/32/48/64-byte data. For each: the exact shell command, and the exact stdout.
4. Report the exact stdout for these canonical commands (copy them verbatim):
   ${BIN} --key '0123456789abcdef' --iv '0000000000000000' --data 'aaaaaaaaaaaaaaaa'
   ${BIN} --key '0123456789abcdef' --iv 'abcdefghijklmnop' --data 'The quick brown fox jumps over0'
   (note the second data is 31 bytes - report whether it errors)
5. State clearly whether the evidence is consistent with textbook AES-CBC with no padding and a persistent chaining state across successive encrypt() calls.

Return the vectors table and conclusions as plain text. Include exact commands and exact outputs so they can be replayed.`,
  },
  {
    key: 'edges',
    prompt: `You are probing residual edge-case behavior of the black-box binary ${BIN} (frozen Python, argparse + pyaes AESModeOfOperationCBC, prints repr of each ciphertext block).

Source logic:
  aes = pyaes.AESModeOfOperationCBC(args.key.encode(), args.iv.encode())
  data = args.data.encode()
  for i in range(0, len(data), 16): ciphertexts.append(aes.encrypt(data[i:i+16]))
  for c in ciphertexts: print(c)

Investigate and report exact stdout/stderr/exit code for:
- empty --data '' (does it print anything? exit code?)
- --data with multibyte UTF-8 so that the BYTE length is a multiple of 16 but the CHARACTER length is not (e.g. 8 x 'é' = 16 bytes). Confirm slicing is by BYTES not characters. Construct a case that would give a different answer under character slicing and prove which one happens (e.g. 24 chars where bytes = 32).
- --key with multibyte UTF-8 whose byte length is 16 (e.g. 8 x 'é'), and whose byte length is 15 or 17 -> error?
- --iv multibyte with byte length 16
- 4-byte UTF-8 characters (emoji) in data
- very long data (e.g. 1600 bytes = 100 blocks) - confirm it works and that output is 100 lines
- data length 16*N for N up to a few, verifying line count == N
- exact error message text for: key byte-length 0, 1, 15, 17, 23, 25, 31, 33 (is the message always "ValueError: Invalid key size"?) and which traceback frames/line numbers appear
- iv byte-length 0, 15, 17 error text and traceback frames
- data byte-length 1, 15, 17, 47 error text, traceback frames, AND crucially: does it print the ciphertexts of the earlier complete blocks BEFORE erroring? (The source appends to a list and prints AFTER the loop, so I expect NO output, but VERIFY - check whether stdout is empty when data is 17 bytes.)
- ordering of stdout vs stderr, and whether stdout is flushed/line-buffered when piped

Use Bash. Separate stdout and stderr into different files so you can report them exactly. Use od -c or printf %q for anything with odd whitespace. Report a precise table of scenario -> stdout / stderr / exit code.`,
  },
]

phase('Probe')
const findings = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Probe' })
))

phase('Synthesize')
const merged = findings.filter(Boolean).map((f, i) => `## PROBE: ${PROBES[i].key}\n\n${f}`).join('\n\n---\n\n')

const spec = await agent(
`Below are four independent black-box probe reports on the same reference binary (${BIN}): a frozen Python program that does argparse -> pyaes AESModeOfOperationCBC -> print(repr of each ciphertext block).

Your job: merge them into ONE authoritative, self-contained implementation spec for an engineer porting this to Node.js ESM with zero external dependencies and NO access to node:crypto.

The spec must contain, precisely and unambiguously:
1. ARGUMENT PARSING: full algorithm (option forms accepted, abbreviation rules, required-arg checking and message ordering, unrecognized-arg handling, help text VERBATIM, exit codes, stdout vs stderr routing, trailing newlines).
2. BYTES REPR: exact pseudocode for Python 3 repr(bytes), including quote selection and every escape form.
3. AES-CBC: confirmation of the algorithm (key sizes, rounds, chaining, no padding, byte-level slicing), plus a table of replayable test vectors (exact command -> exact stdout) to use as unit tests.
4. ERROR BEHAVIOR: exact stderr text and exit codes for invalid key size / invalid IV size / bad block length, including whether any stdout is emitted first.
5. ANY CONTRADICTIONS between the probe reports — flag them explicitly rather than silently picking one. If a probe made a claim without evidence, mark it UNVERIFIED.

If you need to resolve a contradiction or fill a gap, you may run ${BIN} yourself with Bash to settle it. Do so for anything material.

Return the merged spec as plain text. Be exhaustive; downstream implementation depends only on this document.

${merged}`,
  { label: 'synthesize-spec', phase: 'Synthesize' }
)

return spec
