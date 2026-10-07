export const meta = {
  name: 'bech32-probe-spec',
  description: 'Exhaustively probe test10_executable behavior and synthesize a precise port spec',
  phases: [
    { title: 'Probe', detail: 'parallel black-box probes across argparse, int(), bech32 math, unicode, formatting' },
    { title: 'Synthesize', detail: 'merge probe findings into one authoritative spec' },
  ],
}

const EXE = '/workspace/dataset/test10_executable'

const COMMON = `
You are black-box probing a PyInstaller-frozen Python program at ${EXE}.
Its Python source is:

    import argparse
    import bech32

    def main():
        parser = argparse.ArgumentParser()
        parser.add_argument("--a", type=str, required=True)  # HRP
        parser.add_argument("--b", type=str, required=True)  # Data as comma-separated integers
        args = parser.parse_args()

        data = list(map(int, args.b.split(',')))
        checksum = bech32.bech32_create_checksum(args.a, data)
        combined = data + checksum
        is_valid = bech32.bech32_verify_checksum(args.a, combined)
        print(checksum)
        print(is_valid)

    if __name__ == "__main__":
        main()

RULES:
- Run the executable directly with Bash. NEVER run \`python\`. Do NOT read the executable's bytes/strings to cheat; treat it as black box (you may run it as many times as you like).
- Always capture stdout, stderr, and exit code SEPARATELY, e.g.:
    ${EXE} ARGS >/tmp/o 2>/tmp/e; echo "rc=$?"; echo "--out--"; cat -A /tmp/o | head -20; echo "--err--"; cat /tmp/e
  (use \`cat -A\` or \`od -c\` when whitespace/newlines matter)
- Be exhaustive and systematic within your assigned dimension. Run at least 25 distinct probes.
- Report CONCRETE observed evidence (exact command -> exact bytes out), then the rule you infer.
The goal is a Node.js ESM reimplementation that is byte-identical on stdout, stderr, and exit code.
`

const DIMENSIONS = [
  {
    key: 'argparse',
    prompt: `${COMMON}
YOUR DIMENSION: argparse command-line parsing semantics.
Probe and pin down exactly:
- Missing --a, missing --b, missing both (exact stderr text, order of names in the message, exit code).
- Unrecognized extra positionals and unknown options; precedence between "required" errors and "unrecognized arguments" errors; how MULTIPLE unrecognized args are joined in the message.
- --a=value vs --a value; --a= (empty value); repeated --a (last wins?).
- Option value that begins with '-': e.g. --b -1 , --b -1,2 , --b -x , --b --a , --a -5 , --b " -1" (leading space). Determine the exact rule (Python argparse's negative-number matcher is ^-\\d+$|^-\\d*\\.\\d+$ — confirm empirically, including things like "-1.5", "-.5", "-12", "-1_2", "-1,2").
- The '--' separator: e.g. --a bc --b -- -1 , and --a bc -- --b 1.
- Abbreviations/prefix matching: --a, --aa, -a, -ab, --A (case), and whether "--" alone as a value works.
- -h and --help: exact stdout text byte-for-byte (including blank lines, exact indentation and column alignment), exit code, and whether it goes to stdout or stderr. Also: does --help work when required args are missing? Does "--a bc -h" still print help? Is help printed before or after required-arg validation?
- Interspersed ordering: "--b 1,2 --a bc"; args after a valid parse.
- Empty argv (no args at all).
- What is the program name shown in usage/error lines, and does it change if the binary is invoked via a symlink or a different path? (test: copy or symlink the exe to /tmp/othername and run it) -- this tells us whether prog is derived from argv[0] basename.
- Any wrapping of the usage line for long content (probably N/A, but note the exact single-line usage string).
Return a detailed markdown report: for each rule, the exact commands and exact observed output bytes.`,
  },
  {
    key: 'intparse',
    prompt: `${COMMON}
YOUR DIMENSION: the exact semantics of \`list(map(int, args.b.split(',')))\` — i.e. Python str.split(',') plus int(str) with base 10.
Note: the value string is split on ',' FIRST, then each piece goes through int().
Probe and pin down exactly which strings are accepted/rejected, and the exact error text:
- Plain: "0", "7", "31", "007", "+5", "-5" (remember argparse may reject leading '-' — use --b=-5 form to bypass).
- Whitespace: " 12 ", "\\t12\\n", "12 ", " ,1", "1, 2". Which whitespace chars are stripped? Test ASCII space, \\t, \\n, \\r, \\v, \\f, and Unicode spaces (U+00A0 NBSP, U+2007, U+202F, U+3000 ideographic space, U+2028, U+FEFF). Use printf/$'...' to emit exact bytes.
- Underscores: "1_0", "_1", "1_", "1__0", "-1_0", "+1_0", "1_0_0".
- Rejected forms: "", "x", "1.0", "0x10", "1e3", "١٢٣"? (Arabic-Indic), "１２３" (fullwidth), "Ⅷ" (Roman numeral), "½", "²" (superscript two), "٣" , "๓" (Thai), "𝟙" (math digit). Determine exactly which Unicode digit forms int() accepts (hypothesis: Unicode category Nd only, plus decimal-digit-value mapping) and which raise.
- Very large integers (100+ digits) and their effect on output; negative large; mixed.
- Exact ValueError message format, including how the offending string is repr()'d: probe strings containing a single quote, a double quote, a backslash, a newline, a tab, a NUL-ish char, a non-ASCII char, an emoji. Report the EXACT stderr text for each so we can replicate Python's repr() rules (when does it use double quotes? how are \\n, \\t, \\\\ escaped? are non-ASCII chars escaped or printed raw?).
- Confirm the full traceback shape: exact lines, exact leading spaces, the caret '^' line (how many carets, what column), and the trailing "[PYI-<n>:ERROR] Failed to execute script 'test10' due to unhandled exception!" line -- determine what <n> is (run repeatedly; is it the PID? compare with the process's pid if observable).
- Which element fails first when several are invalid (left-to-right?), and whether anything is printed to stdout before the error.
Return a detailed markdown report with exact commands and exact bytes.`,
  },
  {
    key: 'bech32math',
    prompt: `${COMMON}
YOUR DIMENSION: reverse-engineer the exact arithmetic of bech32_create_checksum / bech32_verify_checksum as this build implements them, purely from observed input/output.
Working hypothesis (BIP-173 reference implementation):
    GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    def bech32_polymod(values):
        chk = 1
        for v in values:
            top = chk >> 25
            chk = (chk & 0x1ffffff) << 5 ^ v
            for i in range(5):
                chk ^= GEN[i] if ((top >> i) & 1) else 0
        return chk
    def bech32_hrp_expand(hrp): return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]
    def bech32_verify_checksum(hrp, data): return bech32_polymod(bech32_hrp_expand(hrp) + data) == 1
    def bech32_create_checksum(hrp, data):
        polymod = bech32_polymod(bech32_hrp_expand(hrp) + data + [0,0,0,0,0,0]) ^ 1
        return [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]
VERIFY this hypothesis empirically and hunt for any deviation:
- Write a small standalone Node.js script (BigInt arithmetic, so Python's arbitrary-precision >> << & ^ semantics on huge and NEGATIVE ints are reproduced exactly) implementing the hypothesis, and DIFFERENTIAL-TEST it against the executable on at least 200 randomized cases plus targeted edge cases. Do NOT use python. Do NOT use Uint8Array/DataView anywhere.
- Cases to cover: empty hrp (--a ''), 1-char hrp, long hrp (80+ chars), hrp with uppercase, digits, punctuation, non-ASCII (é, ü, 中, 😀 -- note astral chars: does Python's ord() see one code point where JS charCodeAt sees a surrogate pair? confirm the executable's answer and make sure the JS iterates CODE POINTS), hrp with a space, hrp with control chars.
- data values: 0, 31, 32, 33, 255, 1000000, 2**25, 2**30-1, 2**31, 2**32, 2**53+1, 2**64, a 40-digit integer, and NEGATIVE values (-1, -32, -2**40) passed via --b=-1,-2 to dodge argparse. Also very long data lists (500+ elements).
- Establish whether the printed second line is EVER anything other than True. Try hard to find a False (huge values, negatives, empty hrp+empty-ish data, etc.). Report any case found.
- Report the exact set of differential mismatches (should be none if the hypothesis holds) and the final validated JS reference implementation source.
Return: the validated algorithm, the exact JS BigInt code you confirmed, the number of differential cases run, and any mismatches.`,
  },
  {
    key: 'formatting',
    prompt: `${COMMON}
YOUR DIMENSION: exact stdout formatting of the two print() calls, and process-level behavior.
- print(checksum) prints a Python list of ints: confirm exact separator ", ", brackets, and trailing newline. Verify with \`od -c\`. Confirm there is exactly one '\\n' after each line and no trailing spaces.
- Confirm print(is_valid) emits "True" (capital T) with newline. Look for any case emitting "False".
- Are checksum elements always in 0..31 (never negative, never >31)? Try to break it with negative/huge data values.
- Is the checksum list ALWAYS exactly 6 elements? Confirm across many inputs including empty-ish ones.
- Confirm stdout ordering/interleaving vs stderr, and behavior when stdout is a pipe vs a tty (buffering only affects ordering across streams; note if stdout content differs).
- Check the exit code on success (0), and confirm nothing extra (no BOM, no CR) is emitted; check with \`od -c\` on a full successful run.
- Locale/encoding: run with LC_ALL=C, LANG=C, PYTHONIOENCODING unset/set, and with non-ASCII in --a; does stdout ever change or error?
- Test a huge data list (e.g. 2000 comma-separated values) for any truncation or wrapping in the printed list (Python print of a list never wraps -- confirm).
- Test how the program behaves when stdout is closed / piped to \`head -1\` (BrokenPipe) -- note exit code and stderr, but keep this informational.
Return a detailed markdown report with exact commands and \`od -c\` evidence.`,
  },
]

phase('Probe')
const reports = await parallel(DIMENSIONS.map(d => () =>
  agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe' })
))

phase('Synthesize')
const merged = reports.filter(Boolean).map((r, i) => `\n\n===== REPORT: ${DIMENSIONS[i].key} =====\n${r}`).join('')

const spec = await agent(
  `You are writing the authoritative port spec for reimplementing this Python program in Node.js ESM (.mjs), byte-identical on stdout/stderr/exit-code.

Below are four independent black-box probe reports of /workspace/dataset/test10_executable.
${merged}

Produce a single, precise, self-contained SPEC in markdown covering:
1. CLI parsing rules (exact error strings with placeholders, exit codes, help text verbatim, the negative-number rule, '--' handling, precedence of error types, prog name behavior).
2. The exact int() acceptance grammar and the exact ValueError/traceback bytes (with the repr() rules for the offending string).
3. The validated bech32 algorithm with BigInt-exact semantics notes (code-point iteration for hrp, arbitrary-precision shifts, negative handling).
4. Exact stdout formatting.
5. A prioritized list of TRAPS a naive JS port would fall into (e.g. 32-bit bitwise ops, surrogate pairs, Number precision, argparse negative-number rule, Python int() underscore/unicode-digit rules, repr escaping).
6. Any CONTRADICTIONS between the reports -- flag them explicitly rather than silently picking one.
Be concrete: give exact strings, not descriptions of strings.`,
  { label: 'synthesize-spec', phase: 'Synthesize' }
)

return { spec, reports }
