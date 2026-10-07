export const meta = {
  name: 'probe-test8-behavior',
  description: 'Exhaustively probe /workspace/dataset/test8_executable to build a char-exact behavioral spec for JS reimplementation',
  phases: [
    { title: 'Probe', detail: 'parallel probers over argparse, json.loads, validator construction, type checker, IO details' },
    { title: 'Critic', detail: 'completeness critic finds unprobed surfaces' },
    { title: 'Probe2', detail: 'follow-up probes for gaps the critic found' },
  ],
}

const COMMON = `
You are reverse-engineering a PyInstaller-frozen Python program as a BLACK BOX.

Binary: /workspace/dataset/test8_executable
Its Python source (you MAY read it, it is short) is /workspace/dataset/test8.py:
---
import argparse
import json
import jsonschema
from jsonschema import Draft7Validator

parser = argparse.ArgumentParser()
parser.add_argument('--a', type=str, required=True, help='schema (JSON string)')
parser.add_argument('--b', type=str, required=True, help='type name')
args = parser.parse_args()

schema = json.loads(args.a)

validator = Draft7Validator(schema)  # Create validator
type_checker = validator.TYPE_CHECKER  # Get type checker
result = type_checker.is_type(args.b, args.b)  # Check if type exists
print(result)
---

HARD RULES:
- Do NOT run 'python', 'pip', or install anything. There is no python interpreter available. ONLY run the executable.
- Do NOT try to read the internals of the frozen jsonschema/referencing/json packages (they are compiled into the binary). Treat library behavior as observable-only.
- Do NOT write any files anywhere. You are a read-only prober.
- Run MANY probes. Batch them in single bash calls with a loop, and capture stdout, stderr SEPARATELY, plus the exit code. Use a helper like:
    run(){ out=$(./test8_executable "$@" 2>/tmp/e); ec=$?; printf 'OUT<%s>\\nERR<%s>\\nEC=%d\\n' "$out" "$(cat /tmp/e)" "$ec"; }
  Better: write results with 'od -c' or 'xxd' when whitespace/newlines matter.
- IMPORTANT: stderr tracebacks contain a final line like '[PYI-1234:ERROR] Failed to execute script ...' where the number is the process PID. That line is a PyInstaller bootloader artifact and VARIES. Report it as such; focus on the Python-level traceback lines above it.

Already-established baseline facts (do not re-derive, build on them):
- '--b string' -> stdout 'True\\n', exit 0. '--b array|boolean|integer|object|null|number' -> 'False\\n', exit 0.
- unknown --b -> stderr traceback ending 'jsonschema.exceptions.UndefinedTypeCheck: Type '<b>' is unknown to this type checker', exit 1.
- '--a' non-dict/non-bool -> traceback through referencing/jsonschema.py _legacy_dollar_id: line 54 'TypeError: argument of type '<X>' is not iterable' for None/int/float; line 56 'AttributeError: '<X>' object has no attribute 'get'' for list/str. bool schemas (true/false) succeed.
- Invalid JSON -> json.decoder.JSONDecodeError traceback, exit 2 is NOT used (exit 1). argparse errors use exit 2.

Return ONLY the structured object required by the schema. Be exhaustive and precise; every string must be byte-exact (use \\n for newlines explicitly).
`

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string', description: 'concise prose summary of the rules discovered' },
    rules: {
      type: 'array',
      description: 'precise, implementable rules',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          evidence: { type: 'string', description: 'the exact command(s) and exact observed stdout/stderr/exit code' },
        },
        required: ['rule', 'evidence'],
      },
    },
    exact_outputs: {
      type: 'array',
      description: 'byte-exact input->output mappings, newlines written as \\n',
      items: {
        type: 'object',
        properties: {
          argv: { type: 'string', description: 'the argv after the program name, shell-quoted' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exit_code: { type: 'integer' },
        },
        required: ['argv', 'stdout', 'stderr', 'exit_code'],
      },
    },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['dimension', 'summary', 'rules', 'exact_outputs'],
}

const PROBERS = [
  {
    key: 'argparse',
    prompt: `${COMMON}

YOUR DIMENSION: argparse command-line parsing semantics. Nothing about JSON or jsonschema.

Probe and pin down BYTE-EXACTLY:
1. The usage line and the full --help / -h output (capture with 'od -c' to get exact spaces/newlines). Which stream? Exit code? Note the program name shown ('test8_executable' — our JS must presumably show its own basename; report exactly what Python shows and where it comes from, i.e. sys.argv[0] basename).
2. All 'error:' messages and their exact format: missing required args (one missing vs both missing — check the ORDER the names are listed, e.g. '--a, --b'), unrecognized arguments (single and multiple extras — how are they joined?), option requiring a value but given none ('--a' at end, '--a --b string'), invalid choices (n/a).
3. Value attachment forms: '--a X', '--a=X', '--a=' (empty), '--a ""'. Does '-a' (single dash) work? Does '--' work as a separator, and what happens with '--a -- --b x'?
4. Abbreviation / prefix matching: is '--a' ambiguous with anything? Try '--', '---a', '--A'. Try unknown '--c 1' and '--c=1'. Try a value that starts with a dash: '--b -x', '--b=-x', '--a -1', '--b -1', '--b -- string'.
5. Repeated options: '--a 1 --a 2' (last wins?). Interleaving order: '--b string --a {}'.
6. Do argparse errors go to stderr with a trailing newline? Is usage printed before the error on the SAME stream? Exact ordering and separator.
7. '-h' combined with missing required args: does help win? '--a {} -h'? '-h --b bogus'?
8. Anything else about argparse behavior an emulator must replicate. Test empty-string program invocation is not applicable.

Report exit codes for every case.`,
  },
  {
    key: 'json',
    prompt: `${COMMON}

YOUR DIMENSION: Python's json.loads behavior, as observed through '--a <string>'. Keep '--b string' fixed so a SUCCESSFUL parse of a dict/bool prints 'True' and a parse failure prints a JSONDecodeError traceback.

Goal: I must reimplement CPython's json.loads error messages and acceptance rules EXACTLY in JavaScript.

A) Catalog every distinct JSONDecodeError message form and the exact traceback shape. Known message prefixes to explore exhaustively: 'Expecting value', 'Expecting property name enclosed in double quotes', "Expecting ':' delimiter", "Expecting ',' delimiter", 'Unterminated string starting at', 'Extra data', 'Invalid control character at', 'Invalid \\\\escape', 'Invalid \\\\uXXXX escape', 'Unpaired high surrogate'/'Unpaired low surrogate' (may not exist in this version), 'Expecting value' for bare words.
   For EACH: give minimal inputs and the FULL stderr traceback byte-exactly. Note that the traceback shape varies — I have seen three shapes ending at:
     '  File "json/decoder.py", line 353, in raw_decode'   (errors from the scanner)
     '  File "json/decoder.py", line 355, in raw_decode'   (StopIteration -> 'Expecting value')
     '  File "json/decoder.py", line 340, in decode'       (Extra data)
   Determine EXACTLY which message maps to which traceback shape, and whether any other shapes exist (e.g. errors raised inside py_scanstring / JSONObject / JSONArray, or RecursionError for deeply nested input). Also print the full traceback header lines (the 'File "test8.py", line 11' + source line + caret line) byte-exactly ONCE, and note the caret line ('             ^^^^...') exact column/length.

B) The 'line N column M (char K)' position arithmetic: verify with multi-line input (embed real newlines via $'...' in bash, and also \\r and \\r\\n) that line counting uses '\\n' only, that column = pos - last_newline_index, and char = absolute 0-based index. Give at least 4 multi-line examples.

C) Acceptance rules / Python-specific extensions vs strict JSON:
   - Are 'NaN', 'Infinity', '-Infinity' accepted? At top level and nested? What about 'nan', 'inf', '+Infinity'?
   - Leading/trailing whitespace: which characters count as whitespace to the parser (' ', '\\t', '\\n', '\\r'; is '\\f' or '\\v' or U+00A0 whitespace?). Test '--a $'\\t{}\\n''.
   - Control characters inside strings: is a raw newline/tab inside a string an error? Exact message and position ('Invalid control character at: line..'). What about \\x7f?
   - Numbers: '01', '1.', '.5', '+1', '-', '1e', '1e+', '0x10', '1_000', '--1', 'Infinity1'. For each: error message + position, or success.
   - Escapes: '"\\\\x"' invalid escape message and position; '"\\\\u12"' truncated; '"\\\\uZZZZ"'; lone surrogates '"\\\\ud800"' (accepted?); '"\\\\/"'.
   - Duplicate object keys: '{"a":1,"a":2}' — succeeds (last wins) presumably; just confirm success.
   - Empty input '' and whitespace-only.
   - BOM at start: '--a $'\\xef\\xbb\\xbf{}''.
   - Very deep nesting: does it hit a RecursionError? Find roughly the depth threshold if reachable within a few thousand, and report the resulting error/traceback tail.

D) CRITICAL for my port: the Python TYPE of the parsed top-level value determines the next step's error. Determine, using the observed downstream error text ('argument of type X is not iterable' / ''X' object has no attribute 'get''), the exact Python type name for these '--a' inputs: 'null', 'true', 'false', '0', '-0', '1', '1.0', '1e2', '1E2', '0e0', '10000000000000000000000000' (big int), '-1', '1.5', 'NaN', 'Infinity', '-Infinity', '"s"', '[]', '[1]', '{}', '{"a":1}'.
   In particular: which numeric literals become Python 'int' vs 'float'? (i.e. what exactly triggers float: presence of '.', 'e', or 'E'?) Test '1e2' and '0e0' and '1E2' carefully. And does '-0' stay int? Is big-int arbitrary precision (does it print 'int')?

Be exhaustive: I want a table I can turn into a parser test suite.`,
  },
  {
    key: 'validator',
    prompt: `${COMMON}

YOUR DIMENSION: what happens inside 'Draft7Validator(schema)' construction, observed via '--b string' fixed (so a successful construction prints 'True').

Established: the constructor runs __attrs_post_init__ -> referencing resolver_with_root -> id() -> _legacy_dollar_id, and raises for None/int/float (TypeError, referencing/jsonschema.py line 54) and list/str (AttributeError, line 56); bool schemas succeed.

Probe EXHAUSTIVELY which schemas succeed and which raise, and the byte-exact traceback for each distinct failure:
1. Top-level dicts with '$ref': '{"$ref":"#"}', '{"$ref":1}', '{"$ref":null}', '{"$ref":"http://x"}' — do these short-circuit and succeed? (hypothesis: '"$ref" in contents' is checked first and returns early)
2. Top-level dicts with '$id': '{"$id":"http://x/y"}', '{"$id":""}', '{"$id":1}', '{"$id":null}', '{"$id":[]}', '{"$id":{}}', '{"$id":"#foo"}', '{"$id":"#"}', '{"$id":"nonurl"}', '{"$id":"urn:x"}', '{"$id":"//x"}', '{"$id":"http://[bad"}' (malformed URL). Any of these raise? What traceback?
3. Both: '{"$ref":"#","$id":1}'.
4. Legacy 'id' key (draft4 style): '{"id":"http://x"}' — succeeds?
5. Keys that trigger other referencing behavior: '$anchor', '$dynamicRef', '$schema'. Try '{"$schema":"http://json-schema.org/draft-07/schema#"}', '{"$schema":"bogus"}', '{"$schema":1}', '{"$schema":null}' — does $schema change the validator/type checker?? CRITICAL: if '$schema' is honored at construction, a draft3 $schema might change the TYPE_CHECKER (draft3 has an 'any' type). Test '--a '{"$schema":"http://json-schema.org/draft-03/schema#"}' --b any' and similar for draft4/6/2019-09/2020-12. Report whether Draft7Validator ignores $schema (it should — the class is fixed) but VERIFY.
6. Nested structures: does construction inspect nested subschemas at all? '{"properties":{"x":null}}', '{"definitions":{"a":[]}}', deeply nested — should all succeed since only the top-level is inspected. Verify.
7. Non-object top levels again for completeness, capturing FULL byte-exact tracebacks (all lines, in order) for: 'null', '1', '1.5', 'NaN', '"s"', '[]', 'true', 'false'. Confirm the line numbers (54 vs 56) and the exact type names in the messages ('NoneType', 'int', 'float', 'str', 'list').
8. Does the ORDER of failure matter — i.e. for an unknown --b AND a bad schema (e.g. '--a null --b bogus'), which error comes first? (schema error should win, line 13 before line 15). Verify. Also '--a "[]" --b bogus'.

Give full byte-exact stderr for every distinct traceback (excluding the varying [PYI-...] line, which you should still mention once).`,
  },
  {
    key: 'typechecker',
    prompt: `${COMMON}

YOUR DIMENSION: TYPE_CHECKER.is_type(b, b) semantics — i.e. 'is the string <b> an instance of JSON type <b>?' under Draft7.

1. Enumerate the COMPLETE set of type names known to the Draft7 type checker by probing: any name that raises UndefinedTypeCheck is unknown; any name that prints True/False is known. Test at least: string, number, integer, boolean, object, array, null, any, none, None, int, float, str, bool, dict, list, Integer, STRING, 'string ' (trailing space), ' string' (leading space), 'strin', 'strings', unicode variants, empty string, names with newlines/tabs, very long names, non-ASCII names ('字符串', 'strïng'), names with quotes/apostrophes (e.g. --b "it's"), names that look like numbers ('1').
2. For every KNOWN type name, report whether is_type(name, name) is True or False. (Only 'string' should be True since the instance is always a str — confirm.)
3. The UndefinedTypeCheck traceback: capture byte-exactly, INCLUDING the 'File "test8.py", line 15' line, the source line '    result = type_checker.is_type(args.b, args.b)  # Check if type exists' and the caret line — get the caret line's exact leading spaces and number of '^' characters via 'od -c'. Also the 'File "jsonschema/_types.py", line 114, in is_type' line.
4. How is the type name rendered inside the message? It looks like "Type '<b>' is unknown to this type checker". Determine whether it is Python repr() or plain string interpolation, by testing names containing: a single quote (--b "a'b"), a double quote (--b 'a"b'), a backslash (--b 'a\\\\b'), a newline (--b $'a\\nb'), a tab, a non-ASCII char (--b 'é'), an emoji, a NUL-ish char if possible. If it is repr(), the quoting rules change (Python repr uses double quotes when the string contains a single quote but no double quote, and escapes \\n as \\\\n). PIN THIS DOWN PRECISELY — give the exact observed message for each. This is the single most important detail in your dimension.
5. Confirm the schema value does not affect the type checker: run '--a "{\\"type\\":\\"integer\\"}" --b string', '--a true --b string', '--a "{\\"type\\":[\\"string\\"]}" --b array'.
6. Confirm output for True/False is exactly 'True\\n' / 'False\\n' on stdout with no trailing spaces (use od -c).`,
  },
  {
    key: 'io',
    prompt: `${COMMON}

YOUR DIMENSION: process-level I/O, encoding, and traceback framing details that an emulator must match.

1. Using 'od -c', confirm the exact bytes of stdout for the success cases ('True\\n', 'False\\n') — no CR, single trailing LF.
2. Traceback framing: capture the COMPLETE stderr for one of each error class and give exact bytes:
   (a) JSONDecodeError, (b) TypeError from validator construction, (c) AttributeError from validator construction, (d) UndefinedTypeCheck.
   For each report: the exact first line ('Traceback (most recent call last):'), each frame's exact indentation (2 spaces for 'File', 4 for the source line), the caret line's exact leading whitespace and caret count, whether frames for frozen library files include a source line or not (I observed library frames have NO source line, only the 'File "..." line N, in func' line), and the exact final exception line. Also confirm there is a trailing newline after the exception line, and whether the '[PYI-NNN:ERROR] ...' line ends with a newline. Report the exact text of that PYI line and confirm the number equals the PID (test by running twice and comparing).
3. Are stdout and stderr both used in the same run in any scenario? (e.g. does anything print to stdout before a traceback?)
4. Encoding: pass non-ASCII and multi-byte UTF-8 in --a and --b. Does the program handle UTF-8 argv correctly? Try '--a '{"é":1}' --b string' and '--b 😀'. Are non-ASCII characters in the UndefinedTypeCheck message emitted as raw UTF-8 or escaped?
5. Very long arguments: does a 1MB --a value work? Does a very long --b appear fully in the error message (any truncation)?
6. Does the program read stdin at all? (echo x | ./test8_executable --a {} --b string). Does it care about env vars, cwd, or TTY?
7. Does the exit code differ between error classes (all unhandled exceptions -> 1; argparse -> 2)? Confirm with a table.
8. Check whether stdout is line-buffered vs block-buffered in a way that changes interleaving when redirected — specifically, in an error case is anything half-written to stdout?`,
  },
]

phase('Probe')
const specs = await parallel(PROBERS.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Probe', schema: SPEC_SCHEMA })
))

const good = specs.filter(Boolean)
log(`collected ${good.length}/${PROBERS.length} dimension specs`)

phase('Critic')
const digest = JSON.stringify(good).slice(0, 220000)
const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          gap: { type: 'string', description: 'what is missing or unverified' },
          probe_plan: { type: 'string', description: 'exact commands to run to close the gap' },
          risk: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['gap', 'probe_plan', 'risk'],
      },
    },
    contradictions: { type: 'array', items: { type: 'string' } },
  },
  required: ['gaps'],
}
const critique = await agent(`${COMMON}

You are a COMPLETENESS CRITIC. Five probers produced the specs below for reimplementing this program in JavaScript byte-exactly.

Your job: find what is MISSING, UNVERIFIED, or CONTRADICTORY — specifically anything where a JS reimplementation would silently diverge. Think about: untested argparse forms, json.loads corner cases (surrogates, escapes, number grammar, whitespace set, recursion limits), Python repr() quoting rules in the UndefinedTypeCheck message, int-vs-float classification of numeric literals, $schema/$id/$ref handling in validator construction, ordering of errors, encoding, exit codes, and any claim asserted without evidence.

You MAY run the executable yourself to check suspicious claims — do so aggressively for the highest-risk items.

SPECS:
${digest}

Return the gaps ranked with the riskiest first (max ~14), each with a concrete probe plan.`, { label: 'critic:completeness', phase: 'Critic', schema: CRITIC_SCHEMA })

const gaps = (critique?.gaps || []).filter(g => g.risk !== 'low').slice(0, 12)
log(`critic found ${critique?.gaps?.length || 0} gaps; probing ${gaps.length} med/high`)

phase('Probe2')
const followups = await parallel(gaps.map((g, i) => () =>
  agent(`${COMMON}

YOUR TASK: close ONE specific gap in the behavioral spec by running the executable.

GAP: ${g.gap}
PROBE PLAN: ${g.probe_plan}

Run the probes (and any additional ones needed to be certain), then report the definitive, byte-exact answer. If the gap turns out to be a non-issue, say so explicitly and show the evidence.`, { label: `gap${i + 1}`, phase: 'Probe2', schema: SPEC_SCHEMA })
))

return {
  specs: good,
  contradictions: critique?.contradictions || [],
  gapFindings: followups.filter(Boolean),
}
