export const meta = {
  name: 'characterize-test19',
  description: 'Probe test19_executable to produce exact behavioral specs for int parsing, bytes repr, argparse, and construct errors',
  phases: [
    { title: 'Probe', detail: 'four parallel characterization agents' },
    { title: 'Critic', detail: 'completeness critic finds unprobed surfaces' },
  ],
}

const EXE = '/workspace/dataset/test19_executable'

const SHARED = `
You are characterizing the exact runtime behavior of a compiled Python program so it can be reimplemented in Node.js.

Run it as: ${EXE} --a A --b B --c C --d D --e E --f F --g G --h H --i I
All nine args are required (argparse, type=int for a,b,c,e,f,g,i and type=str for d,h).

The Python source is:
    result1 = construct.Int8ul.build(args.a)
    result2 = construct.Int16ul.build(args.b)
    result3 = construct.Int8ul.build(args.c)
    result4 = construct.Bytes(len(args.d)).build(args.d.encode())
    result5 = construct.Int8ul.build(args.f)
    result6 = construct.Int8ul.build(args.g)
    result7 = construct.Int8ul.build(args.i)
    result8 = construct.Bytes(len(args.h)).build(args.h.encode())
    result9 = construct.Int8ul.build((args.a + args.b + args.c) % 256)
    then print(result1) .. print(result9)
Note args.e is parsed but never used. All nine results are computed BEFORE any printing.

ALREADY ESTABLISHED FACTS (do not re-verify, build on them):
- Success: nine lines on stdout, each a Python bytes repr. Exit 0.
- Any construct build error: full Python traceback on stderr, EMPTY stdout, exit 1.
- argparse error: usage + error line on stderr, exit 2.
- Int8ul range 0..255, Int16ul range 0..65535, else FormatFieldError "struct '<B' error during building, given value N".
- Bytes(len(str)) with non-ASCII str fails: StreamError "bytes object of wrong length, expected C, found B" where C=code points, B=UTF-8 bytes.
- python int() accepts unicode decimal digits: --a '\u0665' parses as 5.
- int() accepts surrounding whitespace, leading +/-, and underscores between digits (1_0 -> 10).
- bytes repr: b'...' normally; b"..." if the data contains ' but no "; if it contains both, single-quoted with \\' escaped.

Use shell loops to batch many probes cheaply. Capture stdout and stderr separately and record exit codes.
Report ONLY facts you actually observed by running the binary. Mark anything you could not test as unknown.
`

phase('Probe')

const AREAS = [
  {
    key: 'int-parsing',
    prompt: `${SHARED}

YOUR AREA: the exact accept/reject rules of Python's int() as reached through argparse type=int, for args --a --b --c --e --f --g --i.

Determine precisely, by probing:
1. Which whitespace characters are stripped around the number? Test ASCII space, \\t, \\n, \\r, \\v, \\f, and Unicode ones: U+00A0 (nbsp), U+1680, U+2000, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. For each: accepted or "invalid int value"? (Use bash $'\\u00a0' style quoting or printf to build the args. To detect acceptance without range errors, use a small value and read result9 or use a valid --a and put the test value in --e which is unused -- but note --e still must parse as int, and if it parses the program succeeds, which is a clean accept/reject signal with NO range constraint. USE --e AS YOUR PROBE SLOT.)
2. Underscore rules: 1_0, _10, 10_, 1__0, +1_0, -_1, 1_0_0. Accepted or rejected?
3. Sign rules: +5, -5, ++5, +-5, "+ 5", "- 5", "5-".
4. Unicode digit scripts: Arabic-Indic U+0660-0669, Devanagari U+0966-096F, fullwidth U+FF10-FF19, Bengali, Thai. Are they accepted? Are they accepted MIXED with ASCII digits (e.g. "1" + U+0665)? What about superscript digits U+00B2, circled digits U+2460, Roman numeral U+2160, fraction U+00BD?
5. Other forms: "", " ", "0x10", "0b1", "1e3", "1.0", "inf", "nan", "None", "+", "-", "0", "-0", "007", very long digit strings (bignum, e.g. 40 digits -- confirm it parses then hits the range error), and a value with a NUL or embedded newline.
6. What exactly is the error text? Confirm the format: does the invalid value get repr()'d in the message (quotes, escaping of non-ASCII / backslashes / newlines)? Probe --e with a value containing a single quote, a backslash, a newline, a tab, and a non-ASCII char, and record the EXACT error line each time.

Return a precise, implementable specification: an ordered algorithm a JS developer can follow to decide accept/reject and compute the integer, plus the exact error-message format rule.`,
  },
  {
    key: 'bytes-repr',
    prompt: `${SHARED}

YOUR AREA: the exact Python bytes repr formatting used by print() for result1..result9, i.e. how every possible byte value renders.

The clean probe slot: --d and --h are strings whose bytes are echoed verbatim (as long as the string is pure ASCII so code-point count == byte count). Use --d to inject arbitrary ASCII bytes. For non-ASCII bytes (0x80-0xFF) you CANNOT use --d (it would raise a length error), so instead reach those bytes through the integer fields: --f/--g/--i/--a/--c produce a single byte 0..255 and --b produces two bytes. Use those to observe how bytes 0x00-0xFF render individually.

Determine precisely:
1. For each byte 0x00 through 0xFF, what is the rendered form? Build the full table by looping over --f 0..255 (that prints result5 as a one-byte bytes object). Identify: which bytes print as literal characters, which use short escapes (\\t \\n \\r \\\\ \\' etc.), and which use \\xNN. Confirm the hex digits' case (lowercase?) and zero padding.
2. Specifically confirm the treatment of: 0x00, 0x07 (bell -- does Python use \\a?), 0x08 (\\b?), 0x09, 0x0A, 0x0B (\\v?), 0x0C (\\f?), 0x0D, 0x1B (\\e?), 0x20 (space -- literal?), 0x22 ("), 0x27 ('), 0x5C (backslash), 0x7E, 0x7F, 0x80, 0xA0, 0xFF.
3. Quote selection rule: use --d with strings containing (a) no quotes, (b) only ', (c) only ", (d) both ' and ". Record exact output and derive the rule, including how the escaped quote appears.
4. Empty bytes: --d '' output.
5. Confirm there is no line wrapping / no truncation for a long value: try a 300-char --d and a --d mixing many escapes.
6. Confirm the line terminator is a single \\n per print and nothing else is emitted (no trailing space). Check with od/hexdump on the stdout of one run.

Return the complete 256-entry rendering rule in compact form (ranges + exceptions), the quote-selection algorithm, and any surprises.`,
  },
  {
    key: 'argparse',
    prompt: `${SHARED}

YOUR AREA: the argparse command-line layer -- exact usage text, error messages, exit codes, and parsing rules. Note the program name in messages is "test19_executable" but our JS entry will be test19.mjs; record the reference text verbatim anyway and note where the prog name appears.

Determine precisely:
1. The EXACT usage block (all lines, with exact leading spaces / wrapping) as printed on an argparse error, and the EXACT full --help output including the "options:" section. Capture byte-exact (use od -c or cat -A on a couple of lines to confirm trailing whitespace and the continuation-line indent).
2. Missing-arguments error: with various subsets missing, what is the exact ordering and joining of names in "the following arguments are required: ..."? Is the order declaration order (a..i) or command-line order? Test several subsets including exactly one missing and all missing.
3. Precedence: when BOTH a missing-required error and an invalid-int error are possible, which is reported? e.g. omit --i but pass --a abc. Also: unknown-argument vs invalid-int vs missing-required precedence, with several combinations.
4. Forms accepted: --a 5, --a=5, and does argparse abbreviation matter here (all options are single letters --a..--i; test --ab, and test a bare -a single-dash form, and -h vs --h).
5. Duplicates: last-wins confirmed for --a; verify for --d too.
6. Unrecognized arguments: exact message for one extra, for several extras, for an extra positional value, and note whether it appears when other errors also exist. What is the exact joining/formatting of the unrecognized list?
7. The "--" separator: what does "--" do here? Test '--a 1 ... -- extra'. Also test a value that begins with a dash, e.g. --d '-x' and --d '--e' and --a '-5', and --d ' -x'. Record which succeed.
8. -h/--help: exit code, which stream, and whether it short-circuits before required-argument errors (e.g. '-h' alone, and '--a abc -h').
9. Empty-string values: --d '' works; what about --a ''?

Return a precise decision algorithm for the argument parser, including error precedence order, exact message templates, exit codes, and which stream each goes to.`,
  },
  {
    key: 'construct-and-tracebacks',
    prompt: `${SHARED}

YOUR AREA: construct build semantics and the exact failure output (tracebacks), plus which error wins when several fields are invalid.

Determine precisely:
1. Error precedence across fields: the results are computed in source order result1(a), result2(b), result3(c), result4(d), result5(f), result6(g), result7(i), result8(h), result9(checksum). Confirm by making several fields invalid at once that the FIRST failing one in that order is the one reported (e.g. bad --g and bad --d together should report --d's error). Test at least 5 combinations, including one where only --h is bad and one where only the checksum could overflow (verify the checksum can never fail: (a+b+c)%256 with valid a,b,c is always 0..255 -- confirm the modulo is Python-style and that result9 is always fine).
2. The EXACT stderr traceback text for each distinct failure mode. Capture verbatim, including blank lines, the caret "^^^" line, and the final PyInstaller line. Note carefully which parts are non-deterministic (e.g. the number in "[PYI-NNN:ERROR]" -- confirm it varies run to run and identify what it is, likely the PID). Give the templates for:
   (a) Int8ul out of range, for each of the fields a, c, f, g, i -- note the differing source line numbers and the differing variable name in the caret line.
   (b) Int16ul out of range for b.
   (c) Bytes length mismatch for d, and for h.
   Report the exact source line numbers and code text quoted in each traceback frame.
3. Confirm stdout is byte-for-byte EMPTY in every failure case (check with od).
4. Exit codes for each failure mode.
5. Bytes(n) semantics: what happens for --d '' (n=0)? Confirm success and empty output line.
6. Verify the checksum math on a spread of values including a=255,b=65535,c=255 and values where (a+b+c) is an exact multiple of 256, and confirm result9 equals (a+b+c) % 256 exactly.
7. Is there any case where a non-ASCII --d/--h SUCCEEDS? Think about whether any character has UTF-8 byte length equal to its code-point count... only ASCII does. But check the Latin-1 range and a lone-surrogate-ish input if the shell allows, plus a string mixing ASCII and non-ASCII (e.g. 'ab\u00e9') to confirm expected/found counts are total counts.

Return exact templates with placeholders, the precedence order, and exit codes.`,
  },
]

const specs = await parallel(AREAS.map(a => () =>
  agent(a.prompt, { label: `probe:${a.key}`, phase: 'Probe' }).then(text => ({ key: a.key, text }))
))

const good = specs.filter(Boolean)

phase('Critic')

const combined = good.map(s => `##### AREA: ${s.key}\n${s.text}`).join('\n\n')

const critic = await agent(`${SHARED}

Four probe agents characterized this program. Here are their reports:

${combined}

YOUR JOB: be a completeness critic AND a fact-checker.
1. Identify any behavioral surface that was NOT probed but would matter to a byte-exact Node.js reimplementation. Actually run the binary to fill those gaps yourself.
2. Spot-check at least 12 specific claims from the reports by running the binary, especially any claim that looks surprising, hand-wavy, or internally inconsistent between reports. Report any claim that is WRONG, with the command and actual output.
3. Pay special attention to interactions between layers: e.g. an invalid int in --e (unused) still aborts; error precedence between the argparse layer and the construct layer; whether a value like '-5' for --a is treated as a flag or a value.
4. Explicitly resolve any contradictions between the four reports.

Return: (a) list of corrections to the reports, (b) list of newly discovered behaviors with evidence, (c) a final consolidated implementation checklist of every rule a reimplementation must satisfy, ordered by execution stage (argv parse -> int convert -> build fields -> render -> print). Be concrete and exhaustive.`, { label: 'critic:completeness', phase: 'Critic' })

return { specs: good.map(s => ({ area: s.key, spec: s.text })), critic }
