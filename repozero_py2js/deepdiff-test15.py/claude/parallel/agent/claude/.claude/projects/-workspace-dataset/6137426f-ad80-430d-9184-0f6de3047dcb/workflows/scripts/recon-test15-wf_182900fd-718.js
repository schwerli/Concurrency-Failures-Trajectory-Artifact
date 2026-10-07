export const meta = {
  name: 'recon-test15',
  description: 'Reverse-engineer test15_executable behavior (deepdiff/Delta/argparse/repr) via black-box probing',
  phases: [
    { title: 'Recon', detail: '8 parallel probers, each owning one behavioral surface' },
    { title: 'Critic', detail: 'completeness critic finds unprobed surfaces' },
  ],
}

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'rules', 'evidence', 'open_questions'],
  properties: {
    area: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, implementable rules. Each must be unambiguous enough to code from directly.',
      items: { type: 'string' },
    },
    evidence: {
      type: 'array',
      description: 'Concrete probe -> exact observed output pairs that justify the rules',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['probe', 'observed'],
        properties: { probe: { type: 'string' }, observed: { type: 'string' } },
      },
    },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
}

const COMMON = `
You are reverse-engineering a PyInstaller-packed Python program by BLACK-BOX PROBING ONLY.

Executable: /workspace/dataset/test15_executable
It takes: --a <str> --b <int> --c <int>   (all required)

Its Python source is:
\`\`\`python
import argparse
from deepdiff import DeepDiff, Delta
parser = argparse.ArgumentParser()
parser.add_argument('--a', type=str, required=True)
parser.add_argument('--b', type=int, required=True)
parser.add_argument('--c', type=int, required=True)
args = parser.parse_args()
obj1 = {'x': args.a, 'y': args.b}
obj2 = {'x': args.a, 'y': args.c}
obj3 = {'x': args.a * 2, 'y': args.b}
obj4 = {'x': args.a, 'y': args.b, 'z': args.c}
diff1 = DeepDiff(obj1, obj2); print(diff1)          # line 1
delta1 = Delta(diff1); print(delta1)                # line 2
result1 = obj1.copy(); result1.update(obj2); print(result1)   # line 3
diff2 = DeepDiff(obj1, obj3); print(diff2)          # line 4
delta2 = Delta(diff2); print(delta2)                # line 5
diff3 = DeepDiff(obj1, obj4); print(diff3)          # line 6
delta3 = Delta(diff3); print(delta3)                # line 7
result2 = {'x': args.a * 2, 'y': args.c}; print(result2)      # line 8
diff4 = DeepDiff(result2, obj4); print(diff4)       # line 9
diff5 = DeepDiff(obj2, obj3); print(diff5)          # line 10
diff6 = DeepDiff(obj3, obj4); print(diff6)          # line 11
diff7 = DeepDiff(obj2, obj4); print(diff7)          # line 12
\`\`\`

HARD RULES:
- You MUST NOT read, extract, unpack, decompile, or grep the packed Python bytecode/source inside the
  executable. No pyinstxtractor, no unzip, no strings-on-binary to find source, no reading site-packages.
  Determine everything by RUNNING the executable and observing stdout/stderr/exit code.
- Do NOT use the \`python\`/\`python3\` interpreter to introspect deepdiff. (Using python3 purely as a
  local calculator to build test input strings is fine, but never to import deepdiff.)
- Do NOT write any files under /output.
- Probe aggressively and systematically: dozens of invocations, binary-search boundaries, and confirm
  each rule with at least one positive and one negative case.

ALREADY ESTABLISHED (do not re-derive, but DO flag if you find a counterexample):
- Diff objects print as ordinary Python dict repr. Category key order observed: 'dictionary_item_added'
  before 'values_changed'.
- Delta prints as \`<Delta: JSON>\` where JSON uses json.dumps default separators (", " and ": ")
  and ensure_ascii=True (non-ASCII becomes \\uXXXX, astral chars become UTF-16 surrogate pairs).
- Delta drops 'old_value' (keeps only 'new_value') and converts 'dictionary_item_added' from a list of
  paths into a {path: value} mapping. Delta omits the 'diff' key entirely.
- Delta JSON is passed through a summarizer. Empirically the gate appears to be:
  sum of (lengths of all dict keys) + (length of the scalar's textual form) <= 100  => print in full.
  Verified: {"values_changed": {"root['y']": {"new_value": N}}} keys=14+9+9=32, full iff len(str(N))<=68.
  {"dictionary_item_added": {"root['z']": N}} keys=21+9=30, full iff len(str(N))<=70.
  When it exceeds the gate: the values_changed leaf is truncated to 1 character, and the
  dictionary_item_added leaf is truncated to 14 characters. (No ellipsis is added.)
- When old_value and new_value are both strings containing a newline, values_changed gains a 'diff' key
  whose value looks like '\\n'.join(difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm='')).
- Python int() parsing accepts surrounding whitespace, leading +/-, and underscores between digits.
- argparse errors go to stderr with exit code 2; --help goes to stdout with exit 0.

Use \`head -c N /dev/zero | tr '\\0' X\` or printf to build exact-length inputs. Beware shell quoting;
prefer writing test inputs to a file and using "$(cat file)" when the input contains awkward bytes.
Always report EXACT observed bytes (use \`| cat -A\` or \`| od -c\` when whitespace matters).
`

phase('Recon')

const AREAS = [
  {
    key: 'summarize-gate',
    prompt: `${COMMON}

YOUR AREA: the Delta summarizer GATE metric — exactly when the JSON is printed in full vs truncated.

Confirm or refute the "sum of key lengths + scalar text length <= 100" hypothesis, and pin down
whether the scalar's contribution is measured on:
  (a) the raw Python string (code points),
  (b) the JSON-escaped form (e.g. 'ü' -> \\u00fc is 6 chars; '"' -> \\" is 2 chars; newline -> \\n is 2),
  (c) UTF-16 code units,
  (d) the UTF-8 byte length.
Design inputs that discriminate these decisively. Remember args.a is DOUBLED for the 'x' value, so the
string length under test on output line 5 is 2*len(--a).

Critical discriminating probes to run (line 5 = delta2):
- --a of N ASCII 'a' for N around 34 (so 2N=68, at the gate).
- --a of N 'ü' (2 UTF-8 bytes, 6 escaped chars, 1 code point) for N sweeping 6..40.
- --a of N '😀' (astral: 1 code point, 2 UTF-16 units, 4 UTF-8 bytes, 12 escaped chars) sweeping 2..40.
- --a of N '"' (escaped to 2 chars each) sweeping 20..40.
- --a of N tab characters sweeping 20..40.
Note: strings containing newlines add a 'diff' key to line 4 but line 5 (Delta) should be unaffected —
still, avoid newlines for gate probing unless testing that interaction.

Also pin the gate for line 2 (delta1, values_changed on int) and line 7 (delta3,
dictionary_item_added on int) by sweeping digit counts of --c around their boundaries, and confirm
negative --c (leading '-' adds a char to str(N)) shifts the boundary by exactly 1.

Report the exact metric function, with the precise threshold (<=100 or <100 etc.).`,
  },
  {
    key: 'summarize-truncation',
    prompt: `${COMMON}

YOUR AREA: what the Delta summarizer OUTPUTS once the gate is exceeded.

Established: values_changed leaf -> 1 char; dictionary_item_added leaf -> 14 chars. Verify exhaustively
and determine:
1. Is the truncated length TRULY constant regardless of how far over the gate the input is? Sweep the
   int digit count for --c from just-over-gate to 500 digits, and 2*len(--a) from just-over to 2000.
2. Is truncation a prefix cut? Use a distinguishable pattern (e.g. --a = '0123456789' repeated, or
   'abcdefghij...') and report exactly which characters survive.
3. For a truncated INT, is the output still emitted as a bare JSON number (no quotes)? Does a negative
   number's '-' sign count as one of the kept characters? Test --c = -(70..80 digits).
4. Unicode truncation semantics: with --a made of 'ü' or '😀' or '中', is the surviving output 1 code
   point, 1 UTF-16 unit (which would split a surrogate pair and produce a lone \\ud83d), or 1 escaped
   char? Report the EXACT bytes on line 5.
5. Does a truncated string's kept-prefix get counted before or after escaping? e.g. --a of many '"'.
6. Whether the empty diff prints exactly \`<Delta: {}>\`, and what happens with --a '' (empty string)
   which makes diff2 empty.

Report a precise algorithm for producing the truncated output for each of the three Delta shapes that
this program can emit.`,
  },
  {
    key: 'py-str-repr',
    prompt: `${COMMON}

YOUR AREA: Python's repr() of str, as it appears on output lines 1,3,4,6,8,9,10,11,12.

Line 3 prints {'x': <repr of a>, 'y': <int>} so it is the cleanest probe of repr(a).
Determine and verify the COMPLETE rule set:
1. Quote selection: single quotes normally; double quotes when the string contains a "'" and no '"';
   single quotes (with \\' escapes) when it contains both. Verify all four combinations.
2. Escapes: \\\\ for backslash, \\n, \\r, \\t. What about \\x07 (bell), \\x0b (vertical tab), \\x0c
   (form feed), \\x00, \\x1b (ESC), \\x7f (DEL)? Python uses \\n \\r \\t only for those three and
   \\xNN for other non-printables — CONFIRM, including that \\a\\b\\f\\v are NOT special-cased
   (they render as \\x07 \\x08 \\x0c \\x0b).
3. Non-ASCII: which characters print literally vs as \\xNN / \\uXXXX / \\UXXXXXXXX. Python uses
   str.isprintable(): non-printable = categories Cc, Cf, Cs, Co, Cn, Zl, Zp, Zs (except ASCII space).
   Verify with: U+00A0 (NBSP, Zs), U+00AD (soft hyphen, Cf), U+200B (ZWSP, Cf), U+2028 (Zl),
   U+3000 (ideographic space, Zs), U+E000 (Co private use), U+0378 (Cn unassigned), U+0301 (Mn
   combining acute — printable), U+FFFF (Cn), U+10FFFF (Cn), U+1F600 (So printable emoji),
   U+0080..U+009F (Cc).
4. Escape width: \\xNN for < 0x100, \\uXXXX for < 0x10000, \\UXXXXXXXX for >= 0x10000. Confirm with a
   non-printable astral char such as U+E0001 (Cn) or U+1D173 (Cf, MUSICAL SYMBOL BEGIN BEAM).
5. Can the shell even deliver lone surrogates / invalid UTF-8? Try passing raw invalid UTF-8 bytes
   (e.g. printf '\\xff\\xfe') as --a and report exactly what happens (Python uses surrogateescape on
   argv, so repr may show \\udcff). This matters a lot — report exact bytes of stdout AND the exit code.
6. Confirm dict repr formatting: '{' + "'k': v" joined by ', ' + '}', insertion order preserved,
   ints printed with str().

Build inputs with printf and $'...' or by writing bytes to a file. Report exact observed output.`,
  },
  {
    key: 'unified-diff',
    prompt: `${COMMON}

YOUR AREA: the extra 'diff' key that appears inside values_changed for multi-line strings.

Observed: --a $'nl\\nhere' gives on line 4
{'values_changed': {"root['x']": {'new_value': 'nl\\nherenl\\nhere', 'old_value': 'nl\\nhere', 'diff': '--- \\n+++ \\n@@ -1,2 +1,3 @@\\n nl\\n+herenl\\n here'}}}

Determine:
1. TRIGGER CONDITION. Is it "'\\n' in old_value and '\\n' in new_value"? or "or"? or does it fire for
   any string whose splitlines() yields >1 line (i.e. also for \\r, \\r\\n, \\v \\f \\x1c \\x1d \\x1e
   \\x85 U+2028 U+2029 which Python's str.splitlines() treats as breaks)? Probe each separator
   individually with --a set to e.g. $'a\\rb', $'a\\x0bb', $'a\\x0cb', $'a\\x1cb', $'a\\x85b'(needs UTF-8
   C2 85), $'a\\u2028b'. Report which produce a 'diff' key.
   Also check whether a trailing-only newline (--a $'x\\n') triggers it.
2. KEY ORDER inside the values_changed entry: is it always new_value, old_value, diff?
3. EXACT FORMAT: confirm '\\n'.join(unified_diff(old.splitlines(), new.splitlines(), lineterm='')).
   Verify the '--- ' and '+++ ' headers keep their trailing space. Verify context n=3 by using an
   --a with many lines so that multiple hunks appear (e.g. 30 lines where the doubling creates two
   separated change regions). Report a case with two '@@' hunks verbatim.
4. Whether splitlines() or split('\\n') is used: discriminate with --a $'a\\nb\\n' (trailing newline)
   and with --a containing \\r\\n.
5. Does the 'diff' key appear for lines 1/6/9/10/11/12 too (any values_changed on x)? Check line 9
   (old=a*2, new=a — the REVERSED direction) and line 10, and report the diff strings verbatim so the
   direction/ordering can be validated.
6. Is there any case where old_value/new_value are equal-length multiline and the diff is empty?

Also: does a 'diff' key ever appear for the int 'y' values? Confirm no.

Report the exact algorithm including hunk header formatting rules (e.g. when a range length is 1,
unified_diff emits '@@ -N +M,K @@' without the ',1'). Construct probes that hit the length-1 range case.`,
  },
  {
    key: 'argparse',
    prompt: `${COMMON}

YOUR AREA: argparse CLI behavior, byte-exact.

Establish exact stdout/stderr/exit-code for:
1. --help and -h (exact text, including the 'options:' heading and indentation — report with cat -A).
2. Missing one/two/three required args (exact wording and ORDER of the listed missing args).
3. Unrecognized args: single and multiple extras; extras that look like values; how they are echoed.
4. Invalid int for --b and --c: exact message. Which argument is reported first if BOTH are invalid?
   Is the offending value shown with Python repr (quotes)? Test a value containing a quote.
5. --a=VALUE vs --a VALUE; --a= (empty); --a with a value starting with '-' (e.g. --a -x, --a=-x,
   --a -5); --b -5 vs --b=-5.
6. Prefix abbreviation: does '--h' work? Is there any abbreviation of --a/--b/--c? (they're single
   letters so '--a' is exact). Does '-a' work (single dash)? What error?
7. Repeated options: --a 1 --a 2 (last wins?).
8. The '--' separator: --a x --b 1 --c 2 -- extra.
9. Missing value: --a --b 1 --c 2 ; and trailing --c with no value.
10. Whether the program name in usage/error lines is the basename of argv[0]. Verify by copying the
    executable to another name (e.g. cp to /tmp/zzz_probe and running it) and reporting the usage line.
    Also test invoking it via a symlink and via a relative path with directories.
11. Interspersed order: --c 2 --b 1 --a x (should work).
12. Anything printed when an arg value is an empty string.
13. Exit code for --help; exit code for success; exit code for errors.
14. What happens with a value that has a leading/trailing newline for --b.

Report the exact templates so they can be reproduced character-for-character in JS.`,
  },
  {
    key: 'int-parsing',
    prompt: `${COMMON}

YOUR AREA: Python int() acceptance rules for --b/--c, and the exact error message for rejects.

For each candidate input, run the executable and report ACCEPT (with the parsed value as seen in the
output dict) or REJECT (with the exact stderr line).
Test at minimum:
- '5', '+5', '-5', '007', '-0', '0'
- ' 5', '5 ', '\\t5\\n', '  +5  '  (ASCII whitespace around)
- '1_000', '1_0_0', '_1', '1_', '1__0', '+1_0'
- '', ' ', '-', '+'
- '5.0', '5e3', '0x10', '0b1', '0o7', 'inf', 'nan', 'None'
- Very long: 400 digits (confirm arbitrary precision — report whether the full value appears in output)
- Unicode digits: Arabic-Indic '٥' (U+0665), Devanagari '५' (U+096F), fullwidth '５' (U+FF15) — Python
  int() ACCEPTS these. Confirm and report the parsed value.
- Unicode whitespace around a number: U+00A0 NBSP, U+2000, U+3000, U+2028, U+000B, U+000C, U+001C..1F,
  U+0085 — Python's int() strips characters for which str.isspace() is true. Report which are accepted.
- Superscript '²' (U+00B2) and Roman numeral 'Ⅴ' (U+2164) — should be REJECTED (not Nd).
- A number with a Unicode minus sign U+2212, and a fullwidth plus U+FF0B.
- Whether the error message repr()s the value: test --b $'a\\nb' and --b "it's" and --b 'ü' and report
  the exact stderr bytes.
- Also confirm how the accepted unicode-digit value is PRINTED on stdout (as an ASCII decimal int).

Report the complete acceptance predicate precisely enough to implement, plus the exact error template.`,
  },
  {
    key: 'deepdiff-shapes',
    prompt: `${COMMON}

YOUR AREA: the full set of DeepDiff output shapes this program can produce, and key ordering.

The 12 printed lines are fully determined by (a, b, c). Enumerate the DISTINCT cases:
- b == c vs b != c
- a == '' (so a*2 == a) vs a != ''
- combinations of the above
For each of the 4 combinations, run the executable and report ALL 12 lines verbatim so the exact
expected output for every case is documented. Use a distinctive a like 'Q'.

Then verify:
1. Category key ordering within one diff dict when BOTH dictionary_item_added and values_changed are
   present (line 9, 11, 12) — confirm dictionary_item_added always precedes values_changed.
2. Within values_changed, the ordering of the path keys "root['x']" and "root['y']" — is it insertion
   order following the traversal of the first dict's keys? Confirm it is always x before y.
3. 'dictionary_item_added' value is a LIST rendered with repr: ["root['z']"] — confirm the double
   quotes and list brackets.
4. Whether any OTHER category can appear (type_changes, dictionary_item_removed, etc.) for any input.
   Reason about it and test: can --a ever make x compare as a type change? Can z ever be removed?
   Try to find any input producing a category other than values_changed / dictionary_item_added.
5. Does DeepDiff ever consider int values equal across different reprs (e.g. b=0, c=0 with different
   spellings like '0' and '-0' or '+0')? Confirm b='-0' and c='0' produce an EMPTY diff1.
6. Confirm that when a == '' line 4 (diff2) is '{}' and line 5 is '<Delta: {}>'.
7. Check a case where a is a single character vs empty for line 9/11 shapes.

Report the complete decision table mapping (b==c?, a==''?) to the exact content of each of the 12 lines.`,
  },
  {
    key: 'output-mechanics',
    prompt: `${COMMON}

YOUR AREA: raw output mechanics and anything the other probers would miss.

1. Confirm each of the 12 lines is terminated with a single \\n (LF) and there is no trailing extra
   blank line. Use \`| od -c | tail\`.
2. Confirm all 12 lines go to stdout and nothing to stderr on success (run with 2>/dev/null and
   1>/dev/null separately and compare byte counts).
3. Check behavior when stdout is a pipe that closes early (head -1) — does it error? (Report but this
   likely does not need replicating.)
4. Check whether output encoding is UTF-8 for non-ASCII (report od -c bytes for --a 'ü').
5. Environment sensitivity: does PYTHONIOENCODING / LC_ALL=C change the output for non-ASCII --a?
   Run with LC_ALL=C and LANG=C and report. (We need to know the DEFAULT behavior for our port.)
6. Verify line 3's content equals {'x': a, 'y': c} (obj1 updated by obj2) and line 8 equals
   {'x': a*2, 'y': c} — confirm with a=Q b=1 c=2.
7. Try a very large --a (e.g. 100000 chars) and confirm it still works and lines 4/9/10/11 contain the
   full doubled string (report only lengths, not the content).
8. Test --a with a NUL byte if the shell allows (probably not) — report what happens.
9. Report anything surprising you notice that the other areas would not cover.`,
  },
]

const specs = await parallel(AREAS.map((area) => () =>
  agent(area.prompt, { label: `recon:${area.key}`, phase: 'Recon', schema: SPEC_SCHEMA })
))

const good = specs.filter(Boolean)
log(`${good.length}/${AREAS.length} recon specs returned`)

phase('Critic')

const critic = await agent(`${COMMON}

You are the COMPLETENESS CRITIC. Eight probers investigated these areas and produced these specs:

${JSON.stringify(good, null, 1).slice(0, 60000)}

Your job: find what is still MISSING, WRONG, or UNDER-SPECIFIED for someone about to reimplement this
program in pure Node.js with byte-identical stdout/stderr/exit codes.

Actively RUN the executable to test any rule you doubt, and to fill any gap you identify. Prioritize:
- contradictions between specs
- rules stated without a verifying probe
- boundary cases stated as "probably"
- the Delta summarizer (the least understood part) — especially the interaction between the gate metric
  and JSON escaping, and the exact truncated-length constants
- any input class that would make a naive JS port diverge

Return the gaps you closed as rules, with evidence.`,
  { label: 'critic', phase: 'Critic', schema: SPEC_SCHEMA })

return { specs: good, critic }
