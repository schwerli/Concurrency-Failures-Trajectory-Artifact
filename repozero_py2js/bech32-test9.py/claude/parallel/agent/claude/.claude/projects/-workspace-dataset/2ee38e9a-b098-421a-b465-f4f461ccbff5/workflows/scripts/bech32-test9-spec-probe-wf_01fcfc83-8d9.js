export const meta = {
  name: 'bech32-test9-spec-probe',
  description: 'Probe the reference executable to derive an exact behavioral spec for test9.py',
  phases: [
    { title: 'Probe', detail: 'parallel probe agents: argparse, int(), polymod bignum/negative, unicode, formatting, tracebacks' },
    { title: 'Synthesize', detail: 'merge probe findings into one authoritative spec' },
  ],
}

const EXE = '/workspace/dataset/test9_executable'

const COMMON = `
You are probing a PyInstaller-frozen Python program to reverse-engineer its EXACT behavior for a
Python -> Node.js migration. You may ONLY observe it as a black box by running it:

  ${EXE} --a <HRP> --b <comma-separated-ints>

The Python source is:

    import argparse
    import bech32

    def main():
        parser = argparse.ArgumentParser()
        parser.add_argument("--a", type=str, required=True)  # HRP
        parser.add_argument("--b", type=str, required=True)  # Data as comma-separated integers
        args = parser.parse_args()

        data = list(map(int, args.b.split(',')))
        hrp_expanded = bech32.bech32_hrp_expand(args.a)  # Expand HRP
        combined = hrp_expanded + data
        checksum = bech32.bech32_polymod(combined)  # Compute polymod checksum
        print(hrp_expanded)
        print(checksum)

    if __name__ == "__main__":
        main()

ALREADY-ESTABLISHED FACTS (do not re-derive, but do not contradict without hard evidence):
- bech32_hrp_expand(hrp) == [cp>>5 for each codepoint] + [0] + [cp&31 for each codepoint].
  Verified with 'xyz' -> [3,3,3,0,24,25,26], '' -> [0], 'e-acute + snowman' -> [7,304,0,9,3],
  balloon emoji U+1F388 -> [3996,0,8] (so it is per-CODEPOINT, not per-UTF8-byte).
- bech32_polymod is the standard BIP173 one: generator = [0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
  chk=1; for v in values: top=chk>>25; chk=(chk & 0x1ffffff)<<5 ^ v; for i in 0..4: if (top>>i)&1: chk ^= generator[i]; return chk
- Missing required arg -> usage+error on stderr, exit 2. Bad int -> Python traceback on stderr, exit 1.
- int() accepts surrounding whitespace, underscores ('1_0'->10), '+5', and Unicode decimal digits
  (Arabic-Indic '\\u0663'->3, fullwidth '\\uff11'->1). It rejects '0x10' and '1.0'.

Use bash. Quote shell args carefully; use printf/$'...' or python-free tricks to emit exotic bytes
(you may use \`printf\` and shell $'\\uXXXX' quoting). ALWAYS capture stdout, stderr and exit code
separately, e.g.:
  out=$(${EXE} --a X --b Y 2>/tmp/e); rc=$?; echo "RC=$rc"; echo "OUT=[$out]"; echo "ERR=[$(cat /tmp/e)]"

Report concrete evidence: the exact command, exact stdout, exact stderr, exact exit code.
Be exhaustive within your assigned area. Return findings as data, not prose padding.
`

phase('Probe')

const AREAS = [
  {
    key: 'argparse-core',
    prompt: `${COMMON}
YOUR AREA: argparse command-line parsing semantics (the CPython argparse subset this program exercises).
Determine and document with evidence:
1. Exact usage line and exact required-arg error text for: no args, only --a, only --b.
2. Exact --help / -h output (stdout? exit code?). Byte-exact, including blank lines and indentation.
   Test both -h and --help, and -h combined with other args in various positions.
3. The '=' form: --a=bc --b=1,2. Also --a= (empty value), --b= .
4. Prefix/abbreviation matching: --h, --he, --hel, --help, --a, --b, -a, -b, --aa, and any ambiguous prefix.
   Report exact stderr + exit code for each.
5. Repeated options (--a bc --b 1 --a xy): which wins.
6. Unknown options: --x 1, --unknown, -x. Exact 'unrecognized arguments' text and code.
7. Extra positional args: '--a bc --b 1 extra', 'extra --a bc --b 1'.
8. The '--' separator: '--a bc --b -- 1,2', '-- --a bc --b 1,2', '--a bc --b 1,2 --'.
9. Values that look like options: --b '-1' (known to work), --b '-1,2' (known to fail),
   --b '-1.5', --b '-12', --b '- 1', --b '-', --b '--', --b '-x', --b ' -1,2' (leading space),
   --b '-1_0', --b '-0', --a '-1', --a '-x', --a '--a'.
   Explain the rule that separates accepted-as-value from treated-as-option, and give the exact
   error text for each rejected case.
10. Missing value at end of argv: '--a bc --b'.
11. Interspersed order: '--b 1,2 --a bc'.
Return a structured list of {cmd, stdout, stderr, exit} plus a concise statement of the parsing rules.`,
  },
  {
    key: 'int-parsing',
    prompt: `${COMMON}
YOUR AREA: the exact accept/reject grammar of Python's int(str) as exercised via --b, and the
exact ValueError traceback text.
Determine and document with evidence (use --a bc and a single-element --b so the failure is unambiguous):
1. Whitespace stripping: which characters are stripped? Test each of these BEFORE and AFTER a digit:
   space, TAB(\\x09), LF(\\x0a), VT(\\x0b), FF(\\x0c), CR(\\x0d), \\x1c, \\x1d, \\x1e, \\x1f, \\x85,
   U+00A0, U+1680, U+2000, U+2001, U+2002..U+200A, U+200B, U+2028, U+2029, U+202F, U+205F, U+3000,
   U+180E, U+FEFF. For each say ACCEPTED (stripped) or ValueError.
   Note: the shell can emit these via $'\\u00a0' style quoting in bash.
2. Sign handling: '+5', '-5', '++5', '+-5', '-+5', '5+', '+', '-', ' + 5', '+ 5'.
3. Underscore rules: '1_0', '1__0', '_10', '10_', '1_0_0', '+1_0', '-1_0', '_', '1_', ' 1_0 '.
4. Non-decimal forms: '0x10', '0b1', '0o7', '1e3', '1.0', '.5', 'inf', 'nan', 'Infinity', '1j', '  '.
5. Unicode digit forms: Arabic-Indic U+0660..U+0669, Extended Arabic-Indic U+06F0..U+06F9,
   Devanagari U+0966..U+096F, fullwidth U+FF10..U+FF19, mathematical bold digits U+1D7CE..U+1D7D7,
   double-struck U+1D7D8..U+1D7E1, Nko U+07C0, Osmanya U+104A0, superscript two U+00B2,
   circled one U+2460, Roman numeral U+2160, fraction one-half U+00BD, U+3007 (ideographic zero),
   U+4E00 (CJK one). For each: does int() accept it and what value results?
   Verify values by comparing the printed checksum against the ASCII-digit equivalent.
   Also test MIXED scripts in one number, e.g. '1' + U+0661 (i.e. fullwidth/arabic mixed with ascii),
   and U+0661 followed by U+FF12 — does Python accept mixed-script digit strings?
6. Very large magnitudes and how they print: --b '999999999999999999999999' (big value LAST so the
   returned checksum itself is huge), --b '-999999999999999999999999',
   --b '340282366920938463463374607431768211456', --b '2**200-ish' decimal literal.
   Record the EXACT printed checksum digits.
7. Splitting: --b '1,,2', --b ',1', --b '1,', --b ',', --b '1' (no comma), --b with trailing newline.
8. The exact ValueError traceback: capture it byte-for-byte for one case and describe every line,
   including the exact number of leading spaces on the caret line and the exact caret count, and how
   the offending string is repr()'d for: plain 'x', a string with a single quote, with a double quote,
   with a backslash, with a newline, with a tab, with a non-ASCII char (U+00A9), with an emoji,
   with a NUL-ish control char like \\x01, and an empty string. Report the exact 'invalid literal ...' line.
Return a structured accept/reject table plus the exact traceback template.`,
  },
  {
    key: 'polymod-numeric',
    prompt: `${COMMON}
YOUR AREA: numeric semantics of bech32_polymod under Python arbitrary-precision integers, so a JS
implementation can match exactly. The concern: Python ints are unbounded and XOR/shift on negative
numbers uses infinite two's complement.
Determine and document with evidence:
1. Negative data values: --a bc --b '-1' gives -1029332947 (already observed). Confirm and extend:
   --b '-1' , --b '-1,-1' , --b '-2' , --b '-33554432' , --b '-1,1' , --b '0,-1' ,
   --b '-1073741824' , --b '-99999999999' , --b '-1,-1,-1,-1,-1,-1,-1,-1'.
   Record exact printed checksums (they may be negative).
2. Huge positive values in LAST position (so the raw huge chk is printed):
   --b '999999999999999999999999' , --b '1208925819614629174706176' (2^80) ,
   --b '1461501637330902918203684832716283019655932542976' (2^160).
   Record the exact printed digits. Also the same values in NON-last position.
3. Mixed: --b '-999999999999999999999999,1' and --b '1,-999999999999999999999999'.
4. Empty data is impossible (''.split gives ['']), but confirm hrp-only contribution:
   for --a 'bc' --b '0' etc., cross-check that a straightforward BigInt implementation of the
   polymod formula reproduces every value you observed.
   IMPORTANT: You MUST actually write a small throwaway Node.js script (node is available; you may
   write scratch files under /tmp ONLY, never under /output) that implements the polymod with BigInt
   (bitwise ops on BigInt in JS follow infinite two's complement, like Python) and diff it against
   at least 40 executable runs spanning: normal 0..31 values, negatives, huge magnitudes, long lists
   (200+ values), and unicode HRPs. Report the diff result and any mismatch.
5. Determine whether a 32-bit-int JS implementation would be sufficient or whether BigInt is
   REQUIRED, with the specific counterexample inputs.
Return: confirmation of the formula, the BigInt-equivalence verdict, and the raw comparison table.`,
  },
  {
    key: 'unicode-hrp-and-printing',
    prompt: `${COMMON}
YOUR AREA: (a) HRP codepoint handling, (b) exact stdout formatting of both printed lines.
Determine and document with evidence:
1. HRP iteration unit. Confirm per-codepoint (not per-UTF-8-byte, not per-UTF-16-code-unit) using
   astral characters: --a with U+1F388, U+10FFFF-ish, U+FFFF, U+10000, and a string mixing
   BMP + astral chars. Also a combining sequence (e.g. 'e' + U+0301) -> should be 2 codepoints.
   Also a lone-surrogate-ish byte sequence if you can produce one (report what happens: error? mojibake?).
   Also test a HRP containing a NUL byte if possible, and a HRP that is only whitespace.
2. Very long HRP (e.g. 500 chars) - confirm no truncation/wrapping in the printed list.
3. Exact print formatting of line 1 (the Python list): separator is ', ', brackets, no trailing
   space; for the empty-HRP case it is '[0]'. Confirm there is NO line wrapping for very long lists
   (test a 400-char HRP => 801 elements) and record whether the whole list is on ONE line.
4. Exact print formatting of line 2 (the int): no thousands separators, negative sign form,
   and confirm a trailing newline after the last line (check with 'od -c' on the tail of stdout).
   Confirm the total stdout byte count for one known case using 'wc -c'.
5. Confirm output goes to stdout (not stderr) and that stderr is empty on success.
6. Locale/encoding: does the program's stdout encoding matter for the printed list? (The list is all
   ASCII digits, so mainly confirm nothing exotic appears.)
Return exact byte-level observations (include od -c dumps where relevant).`,
  },
  {
    key: 'exit-codes-and-stderr',
    prompt: `${COMMON}
YOUR AREA: process-level behavior: exit codes, which stream each message goes to, and the
PyInstaller-specific wrapper text.
Determine and document with evidence:
1. For each failure class record: stream (stdout vs stderr), exact text, exit code.
   Classes: missing required arg; unknown option; unrecognized positional; option missing its value;
   int() ValueError; --help.
2. The PyInstaller line '[PYI-<N>:ERROR] Failed to execute script 'test9' due to unhandled exception!'
   - determine what N is (run the same failing command several times and see if N changes; compare
   against the process pid if you can infer it). State whether N is stable or per-run.
3. Whether the usage/error messages end with a trailing newline; get byte counts via wc -c.
4. Whether anything is written to stdout in failure cases (should be empty - verify with wc -c).
5. Check behavior with no TTY / piped stdout (already the case) vs redirected - any difference?
6. Test a case where the FIRST print succeeds and the second fails - is that even possible? Reason
   about it: the ValueError happens before both prints, so stdout should be empty. Verify.
Return a table of {case, stdout, stderr, exit}.`,
  },
]

const probes = await parallel(AREAS.map(a => () =>
  agent(a.prompt, { label: `probe:${a.key}`, phase: 'Probe' })
))

phase('Synthesize')

const spec = await agent(
  `You are the spec synthesizer for a Python->Node.js migration of /workspace/dataset/test9.py
(bech32 hrp_expand + polymod CLI). Five probe agents independently examined the reference
executable ${EXE}. Merge their findings into ONE authoritative, implementation-ready spec.

Probe reports follow, separated by markers.

${probes.map((p, i) => `===== PROBE ${AREAS[i].key} =====\n${p ?? '(probe failed - no data)'}`).join('\n\n')}

Produce a spec with these sections, resolving contradictions by preferring the report that shows
actual command/output evidence (and say which contradictions you found):
A. Argument parsing algorithm (step by step, enough to reimplement argparse's subset), including the
   negative-number rule, abbreviation matching, '=' form, '--' separator, and every exact error string.
B. int(str) grammar: precise accept/reject rules, the exact whitespace set, sign, underscore rules,
   and the Unicode-decimal-digit rule (how to compute a digit's value in JS).
C. bech32_hrp_expand + bech32_polymod numeric spec, and whether BigInt is required (with counterexamples).
D. Exact stdout formatting for both lines, including trailing newline.
E. Exact stderr templates + exit codes for every failure mode, including the Python traceback template
   (byte exact: leading spaces, caret count) and the repr() rules for the offending string.
F. A concrete regression test matrix: a list of at least 40 {args, expected_stdout, expected_exit}
   triples covering normal cases, all edge cases, and all error cases. Use REAL observed values only -
   do not invent expected outputs you did not see. Mark any triple you could not verify.
Be dense and precise. This spec is the sole input to the implementer.`,
  { label: 'synthesize-spec', phase: 'Synthesize', effort: 'high' }
)

return { spec }
