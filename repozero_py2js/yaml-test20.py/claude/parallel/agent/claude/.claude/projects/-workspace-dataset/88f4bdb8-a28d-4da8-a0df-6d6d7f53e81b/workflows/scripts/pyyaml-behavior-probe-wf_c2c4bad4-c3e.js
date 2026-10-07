export const meta = {
  name: 'pyyaml-behavior-probe',
  description: 'Empirically characterize PyYAML safe_load+dump behavior via the precompiled executable',
  phases: [
    { title: 'Probe', detail: 'parallel black-box probes of each subsystem' },
    { title: 'Gaps', detail: 'completeness critic finds unprobed behavior' },
  ],
}

const EXE = '/workspace/dataset/test20_executable'
const BT = String.fromCharCode(96)

const COMMON = `
You are black-box characterizing a precompiled Python program so it can be reimplemented in JavaScript.

The program is: ${EXE}
Its Python source is exactly:
    import yaml, argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    args = parser.parse_args()
    result = yaml.dump(yaml.safe_load(args.a))
    print(result)

So it is PyYAML safe_load followed by yaml.dump with ALL DEFAULT options
(default_flow_style=False, sort_keys=True, allow_unicode=False, width=80, indent=2,
line_break='\\n', explicit_start=False, version=None, encoding=None), then print().

HOW TO RUN PROBES (do this a LOT — dozens of inputs, batched):
Write the YAML input into a file with printf, then pass it via command substitution:

    printf '%s' 'a: 1' > /tmp/in.txt
    ${EXE} --a "$(cat /tmp/in.txt)" > /tmp/out.txt 2>/tmp/err.txt; echo "rc=$?"
    cat -A /tmp/out.txt

IMPORTANT probe hygiene:
 - ALWAYS capture the exit code directly after the command (a pipe to cat -A destroys $?).
 - ALWAYS inspect stdout with 'cat -A' (or 'od -c' for non-ASCII) so trailing spaces and
   newlines are visible. Report bytes exactly, marking line ends.
 - Note: "$(cat file)" strips trailing newlines; when trailing newlines in the ARGUMENT matter,
   build the arg another way and say so.
 - stderr for crashes is a Python traceback ending in a nondeterministic [PYI-<pid>:ERROR] line.
   Do NOT try to reproduce stderr text. For error cases only record: exit code, empty stdout,
   and the exception class + message line (e.g. "yaml.scanner.ScannerError: mapping values are
   not allowed here"), which IS deterministic.
 - Non-ASCII: pass via printf with backslash-u escapes or dollar-single-quote quoting;
   inspect output with od -c.

DELIVERABLE:
 1. Write a thorough findings document to /workspace/probe/<FILE>.
    It must be a table/list of concrete INPUT -> EXACT STDOUT (with newlines marked) + rc,
    plus prose stating the INFERRED RULE for each behavior, including boundary cases you
    pinned down by bisection. Prefer many small verified facts over speculation.
    Explicitly flag anything you could NOT determine.
 2. Return (as your final message) a compact but information-dense summary of the RULES you
    established — the implementer will read your file for details, but your summary must
    stand alone for the top-3 surprises and any rule that would be easy to get wrong.
Run at least 40 distinct probe inputs. Bisect boundaries rather than guessing.
`

phase('Probe')

const DIMENSIONS = [
  {
    key: 'argparse',
    file: 'argparse.md',
    prompt: `Characterize the ARGUMENT PARSING layer only (Python argparse with a single required
'--a' option of type str, plus the automatic -h/--help).

Determine exactly:
 - Exact stdout of --help and -h (byte for byte, including blank lines and 2-space indents)
   and its exit code. Note the prog name shown.
 - Exact stderr shape and exit code for: no args; '--a' with no value; unknown option '--b x';
   an extra positional; '--a' given twice; '--a=VALUE' form; '--' separator usage.
   (usage/error lines here ARE deterministic — record them verbatim, they go to stderr.)
 - Abbreviation behavior: is '--a' abbreviatable? What does a bare '-a' do? What about '---a'?
   What about '--A' (case)? Try prefix matching with '--' alone.
 - VALUES THAT LOOK LIKE OPTIONS: this is the subtle part. Test values such as
   '-5', '-5.5', '-.5', '-.INF', '-x', '-', '--', '- a', '-a b' (with a space inside),
   '-1e3', '--foo', and the empty string.
   Determine precisely which are accepted as the value of --a and which cause
   "expected one argument" or "unrecognized arguments". Bisect to find the rule
   (hint: argparse has a negative-number matcher and a 'contains a space' escape hatch —
   confirm the exact predicate empirically).
 - Behavior of '--a' after '--'.
 - Does the program read stdin at all? (No, but confirm.)
Also confirm: with a valid tiny input like 'x: 1', the trailing output is 'x: 1' + LF + LF
(dump's trailing newline plus print's newline) and rc=0.`,
  },
  {
    key: 'resolver-scalars',
    file: 'resolver-scalars.md',
    prompt: `Characterize the IMPLICIT TYPE RESOLUTION of plain scalars (PyYAML SafeLoader Resolver,
YAML 1.1 flavored) — i.e. which plain scalars become null / bool / int / float / str /
timestamp, and what each becomes on the way back out through yaml.dump.

Probe at minimum, each as the whole document (e.g. --a 'yes') AND as a mapping value
(--a 'k: yes') to be sure they agree:
 - null forms: empty string, '~', 'null', 'Null', 'NULL', 'nUll', 'none', 'None'
 - bool forms: true/True/TRUE/tRue, false/False/FALSE, yes/Yes/YES, no/No/NO,
   on/On/ON, off/Off/OFF, y, Y, n, N
 - ints: '0', '-0', '+7', '007', '017', '0o17', '0b1010', '0x1f', '0xFF', '0X1F',
   '1_000', '1_0_0', '10:20', '1:20:30', '-1:20', '9223372036854775807',
   '99999999999999999999999999' (bigger than 64-bit — check it prints in full),
   '0_1', '_1', '1_', '0b_1010'
 - floats: '1.0', '1.', '.5', '-.5', '1.5e3', '1.5e+3', '1.5e-3', '1e3', '1E3', '1.0e3',
   '0.0', '-0.0', '.inf', '.Inf', '.INF', '+.inf', '-.inf', 'inf', '.nan', '.NaN', '.NAN',
   'nan', '1_000.5', '190:20:30.15', '6.8523015e+5'
 - strings that merely look typed: '1e3', '0o17', 'y', 'True_', '- 1', '1.2.3', '2001-13-45'
 - timestamps: '2001-12-14', '2001-12-14t21:59:43.10-05:00', '2001-12-14 21:59:43.10 -5',
   '2002-12-14', '2001-12-14 21:59:43', '2001-12-14 21:59:43.1', '2001-12-14 21:59:43.123456789',
   '20:59:43' , '2001-1-1', '2001-01-01 00:00:00Z', '2001-12-14 21:59:43 +5:30'
 - merge/value keys: '<<' and '=' as a scalar and as a key.

For EACH: report the exact stdout. The key question per input is (a) what Python type it
resolved to, and (b) how yaml.dump re-serializes it. Pay special attention to:
 * Float output formatting: Python repr round-tripping. Test 0.1, 0.3333333333333333,
   1e16, 1e17, 1e-5, 1e-4, 123456789012345678.0, 1.7976931348623157e+308,
   5e-324, -0.0, 1e100. Record the EXACT emitted text (PyYAML post-processes the exponent
   form — determine it precisely: does 1e+16 emit as '1.0e+16'? does 1e-05 emit as
   '1.0e-05'? how many digits in the exponent? is there always a '.' before 'e'?).
 * Big integers beyond 2^63 must print in full.
 * Timestamps: what exact string does dump produce for date vs datetime, with and without
   microseconds and timezones? Is the tz preserved or converted to UTC?
Bisect anything ambiguous.`,
  },
  {
    key: 'scanner-syntax',
    file: 'scanner-syntax.md',
    prompt: `Characterize the YAML INPUT SYNTAX accepted by safe_load — the scanner/parser layer.
You care about what parses, what the resulting VALUE is, and which inputs raise
(record exception class + message line only, plus rc).

Cover:
 - Block scalars: '|', '|-', '|+', '>', '>-', '>+', with explicit indentation indicators
   ('|2', '|-2'), leading blank lines, more-indented lines inside a folded scalar,
   trailing newline handling (clip/strip/keep). Give at least 12 block-scalar probes and
   state precisely the resulting Python string for each (deduce it from the dumped output).
 - Quoted scalars: single-quoted with the doubled-quote escape; double-quoted with the
   escapes \\n \\t \\\\ \\" \\x41 \\u00e9 \\U0001F600 \\0 \\a \\b \\e \\f \\v \\N \\_ \\L \\P \\/
   and an escaped space, plus line continuations inside double quotes (backslash at EOL),
   multi-line quoted scalars and how their line breaks fold.
 - Plain scalar edge cases: multi-line plain scalars and folding, plain scalars containing
   ':' not followed by space, '#' preceded by non-space, trailing comments, tabs.
 - Flow collections: '[1, 2]', '{a: 1}', nested, trailing commas, empty '[]' and '{}',
   flow inside block and vice versa, JSON-ish input, flow with complex keys.
 - Block sequences/mappings: nesting, sequences at same indent as parent key,
   empty values ('a:' alone), 'a: # comment', explicit keys with '?'.
 - Anchors/aliases: '&a', '*a', anchor on a key, anchor reuse/redefinition, recursive
   structures (e.g. an anchor referencing itself — does it survive dump? what is emitted?).
 - Tags: '!!str 1', '!!int "7"', '!!float 1', '!!bool yes', '!!null x', '!!seq', '!!map',
   '!!binary', '!!timestamp', '!!set', '!!omap', '!!pairs', unknown '!foo', verbatim tags,
   '%TAG' directives, and the local-tag error behavior.
 - Directives and documents: '%YAML 1.1', '%YAML 1.2', '---', '...', two documents
   (safe_load with 2 docs — what error?), '---' with content, empty document,
   document consisting only of comments, a leading BOM.
 - Whitespace/newline forms: input containing CRLF, a lone CR, NEL (U+0085),
   U+2028/U+2029, trailing spaces, tabs used for indentation (error?).
For each, the primary datum is the exact stdout + rc.`,
  },
  {
    key: 'constructor',
    file: 'constructor.md',
    prompt: `Characterize the CONSTRUCTOR layer of SafeLoader — how parsed nodes become Python
objects, especially collection/key semantics, and how those objects then re-dump.

Cover:
 - Duplicate keys in a mapping: which wins? Same for keys that are equal after type
   resolution but written differently ('1' vs '1.0' vs '01', 'true' vs 'yes',
   int 1 vs string '1' via !!str).
 - KEY EQUALITY/IDENTITY (Python dict semantics!): probe mappings like
   '{1: a, 1.0: b}', '{true: a, 1: b}', '{false: a, 0: b}', '{1: a, "1": b}',
   '{null: a, ~: b}'. Report what survives and what the dumped key text is.
   (Python: True == 1 == 1.0 are hash-equal, so a later value overwrites but the FIRST key
   object is retained — verify this empirically and report the emitted key.)
 - Unhashable keys: a sequence or mapping used as a key -> exact exception class/message, rc.
 - Merge key '<<': single merge, list of merges, merge plus explicit override, merge from an
   alias, '<<' with a non-mapping. What is the resulting key order and what is dumped?
 - !!set (both flow and block '? a'), !!omap, !!pairs — do they load? what do they dump as?
   Include malformed ones (duplicate in omap, non-sequence pairs).
 - !!binary: valid base64, base64 with newlines/whitespace, invalid base64 (error?),
   binary that is valid UTF-8 vs binary that is not. How does dump re-emit bytes?
   (Check the '!!binary |' block form, line wrapping of long base64, and the exact
   line width used for wrapping.)
 - !!timestamp explicit tag on odd values.
 - Empty collections: 'a: {}', 'a: []', '{}', '[]', and 'a:' alone -> null.
 - Deeply nested structures, and aliases shared between multiple parents (verify the
   '&id001' anchor naming and numbering when there are several shared nodes — probe with
   2 and 3 distinct shared objects to pin the numbering/order).
 - Recursive alias structures: do they dump? what is the output?
For each probe: exact stdout + rc.`,
  },
  {
    key: 'emitter-style',
    file: 'emitter-style.md',
    prompt: `Characterize the EMITTER's SCALAR STYLE CHOICE for strings: when does yaml.dump emit a
plain scalar, a single-quoted scalar, or a double-quoted scalar? (Default dump never
chooses block style for strings; confirm.) This is the highest-value dimension — be exhaustive.

To probe a specific Python string S, feed a YAML input that loads to exactly S, e.g. pass a
double-quoted YAML scalar so you control the string exactly. Verify your control method
first on a trivial case.

Determine the rule for each of these string classes (test each empirically):
 - empty string; a single space; strings with leading/trailing spaces; internal double spaces.
 - strings that would resolve to another type: 'null','~','true','yes','off','1','1.5',
   '.inf','.nan','2001-12-14','<<','=','0o7','1:20'
 - strings starting with an indicator char: '-','?',':','!','&','*','#','|','>','%','@',
   backtick, double quote, single quote, '{','}','[',']',',' and the two-char forms
   '- ','-x','? ','?x',': ',':x','#x','x#y','x #y','x: y','x:y','a, b'
 - strings containing ': ' or ' #' anywhere; strings ending in ':' or a space
 - strings with newlines: 'a\\nb', 'a\\n', '\\na', 'a\\n\\nb', a string that is just a newline
 - strings with \\t, \\r, \\x00, \\x07, \\x1b, \\x7f, \\x85, \\xa0, \\u2028, \\u2029, \\ufeff
 - non-ASCII: e-acute, CJK, emoji (astral, U+1F600), and how allow_unicode=False escapes
   them (\\xNN vs \\uNNNN vs \\UNNNNNNNN). Confirm with od -c.
 - a string used as a KEY vs as a VALUE vs as a top-level document — do the choices differ?
   (Notably: a top-level plain scalar document gets a trailing '...' line — pin down exactly
   when that '...' appears and when it does not. Test top-level: plain scalar, quoted scalar,
   empty string, string with newline, int, null, bool, list, dict, empty list/dict.)
 - a very long key (>128 chars) — does it become an explicit '? ' key? Bisect the threshold.
Report, for each, the exact emitted line(s). Then state the inferred decision procedure as
an algorithm (allow_flow_plain / allow_block_plain / allow_single_quoted style rules).`,
  },
  {
    key: 'emitter-folding',
    file: 'emitter-folding.md',
    prompt: `Characterize the EMITTER's LINE FOLDING and INDENTATION (best_width=80, best_indent=2).
This determines where yaml.dump inserts line breaks in long scalars and how deeply nested
structures are indented.

Construct inputs that load to long strings using a double-quoted YAML scalar, and inspect
output with cat -A so trailing spaces are visible.

Determine precisely:
 - PLAIN scalars: at what column does a fold happen? Build strings of many short words
   ('w1 w2 w3 ...') at a top-level value, at nesting depth 1, 2, 3, and as a list item.
   Bisect the exact break column and the continuation indent. Determine whether the
   break replaces the space, and whether a fold ever happens when there is no space.
   Test a single very long word (no spaces) — is it left unfolded?
 - SINGLE-QUOTED scalars: same investigation, plus how embedded newlines are rendered
   (the blank-line trick), how a run of multiple newlines renders, how a newline adjacent
   to a space renders, and how a leading/trailing newline renders.
 - DOUBLE-QUOTED scalars: same, plus the backslash line-continuation form used when
   folding inside double quotes, and how folding interacts with escape sequences
   (does it ever split an escape?). Test a long string of non-ASCII escapes.
 - Interaction with the width: does the width count the indent and the key prefix?
   Test a long value under keys of varying length (1, 10, 40, 70 chars) and pin down the rule.
 - Indentation: nested mappings, nested sequences, sequence inside mapping (is the '-'
   indented under its key or flush?), mapping inside sequence (inline first key), sequence
   inside sequence, deeply nested (5+ levels), and empty collections at depth.
 - Long base64 from !!binary — the wrap column.
Give exact byte-level output for representative cases and state the folding algorithm.`,
  },
  {
    key: 'emitter-ordering',
    file: 'emitter-ordering.md',
    prompt: `Characterize KEY SORTING, ANCHOR NAMING, and TOP-LEVEL DOCUMENT framing in yaml.dump.

 - Sorting: yaml.dump sorts mapping keys. Determine the comparison used for
   all-string keys (codepoint order? case sensitivity? digits vs letters vs punctuation
   vs non-ASCII — test 'B','a','A','b','_','-','1','10','2', e-acute, CJK, ' x', empty).
   Give the exact resulting order.
 - Sorting with MIXED key types: '{1: a, b: 2}', '{true: a, 1: b, x: c}', '{null: a, 1: b}',
   '{1: a, 2.5: b}', and int-vs-string-1. In Python, sorting a list of mixed str/int raises
   TypeError, and PyYAML catches it and leaves the ORIGINAL order. Verify this empirically
   and determine what the original order is (insertion order of the loaded mapping).
   Test carefully: int+float mix sorts fine; int+str raises; bool+int sorts; None+int raises.
 - Nested mappings: is sorting applied at every level? Confirm.
 - Anchors: build inputs where the SAME object is referenced twice (via YAML anchors) and
   determine the emitted anchor names and numbering order with 1, 2, and 3 shared nodes,
   including when a shared node is nested inside another shared node. Determine whether
   an object referenced twice but not via a YAML anchor in the input gets an anchor.
   Determine anchor naming for recursive structures.
 - Document framing: when is the trailing '...' emitted? Confirm for: scalar docs of each
   type, an empty-string doc, an empty mapping/sequence doc, a doc that is a quoted string,
   a doc that is a block-worthy string. Also confirm there is never a leading '---'.
 - The final newlines: dump ends with a newline and print adds another, so stdout ends with
   two newlines. Verify for the '...' case too.
 - Confirm default_flow_style=False means collections are ALWAYS block style except for
   EMPTY collections. Verify empty dict/list nested and at top level.`,
  },
]

const probes = await parallel(DIMENSIONS.map(d => () =>
  agent(`${COMMON}\n\nYOUR DIMENSION: ${d.key}\nWrite your findings file to /workspace/probe/${d.file}\n\n${d.prompt}`,
    { label: `probe:${d.key}`, phase: 'Probe' })
))

phase('Gaps')

const summaries = DIMENSIONS.map((d, i) => `--- ${d.key} (/workspace/probe/${d.file}) ---\n${probes[i] ?? '(agent failed)'}`).join('\n\n')

const gaps = await agent(
`${COMMON}

YOUR ROLE: completeness critic. Seven probe agents have characterized ${EXE}.
Here are their summaries:

${summaries}

You may also read their full files in /workspace/probe/.

Your job: find what they MISSED or got WRONG. Specifically:
 - Re-verify at least 10 of the most load-bearing or surprising claims above by running the
   executable yourself. Report any claim that is wrong, with the correcting evidence.
 - Probe behaviors NO agent covered. Think hard about the seams between subsystems:
   e.g. a long non-ASCII string that must fold AND escape; a key that is a datetime;
   an alias used as a mapping key; sorting keys that are datetimes or bytes; a string of
   exactly the width boundary; block scalar input whose value dumps as double-quoted;
   NaN/Inf as mapping keys; an empty-string key; a mapping with a single '<<' key only;
   deeply nested aliases; '!!binary' holding astral characters; very deep nesting
   (100 levels) and whether recursion limits bite.
 - Probe at least 25 NEW inputs of your own design chosen to break a naive reimplementation.

Write /workspace/probe/gaps.md with corrections + new findings (exact input -> exact stdout + rc).
Return a summary listing (1) corrections to prior claims, (2) the new rules discovered,
ranked by how likely they are to break a reimplementation.`,
  { label: 'completeness-critic', phase: 'Gaps', effort: 'high' })

return { probes: DIMENSIONS.map((d, i) => ({ key: d.key, file: `/workspace/probe/${d.file}`, summary: probes[i] })), gaps }
