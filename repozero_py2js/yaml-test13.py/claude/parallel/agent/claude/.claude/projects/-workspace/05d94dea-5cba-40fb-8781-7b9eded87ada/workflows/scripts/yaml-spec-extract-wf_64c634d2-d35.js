export const meta = {
  name: 'yaml-spec-extract',
  description: 'Probe test13_executable across YAML feature areas to extract a precise reimplementation spec',
  phases: [
    { title: 'Probe', detail: 'parallel probes per feature area' },
    { title: 'Critique', detail: 'completeness critic per area' },
  ],
}

const PREAMBLE = `You are reverse-engineering a compiled Python program to produce a SPEC for a JavaScript reimplementation.

The program is at /workspace/dataset/test13_executable and its source is:
\`\`\`python
import yaml, argparse
parser = argparse.ArgumentParser()
parser.add_argument('--a', type=str, required=True)
args = parser.parse_args()
result = yaml.dump(yaml.safe_load(args.a), default_style='"')
print(result)
\`\`\`

Run it like: /workspace/dataset/test13_executable --a 'YAML TEXT'
Use bash heredocs / printf and pipe output through \`cat -A\` to see exact whitespace, and capture \`$?\` for the return code. Example harness you may write to /tmp:
  run(){ printf '=== %s\\n' "$(printf '%q' "$1")"; out=$(/workspace/dataset/test13_executable --a "$1" 2>&1); echo "RC=$?"; printf '%s\\n' "$out" | cat -A; }

Do NOT modify anything under /workspace/dataset. Write scratch files only under /tmp/probe-<your-area>/.
Run MANY probes (at least 40 distinct inputs), including adversarial and boundary cases.

Report findings as a dense, factual spec: exact rules, exact output bytes, exact error/exit codes. Include a table of input -> output for the most informative probes. Be precise about spaces and newlines. Note anything that surprised you. Do NOT speculate without marking it as unverified.`;

const AREAS = [
  {
    key: 'scanner-blockscalars',
    prompt: `${PREAMBLE}

YOUR AREA: the YAML **scanner/parser input side** — how source text is tokenized and structured.
Cover exhaustively:
- Block scalars: literal \`|\` and folded \`>\`, all chomping indicators (\`-\`, \`+\`, none), explicit indentation indicators (\`|2\`, \`>3\`), leading-empty-line handling, trailing newline counts, more-indented lines inside folded scalars, tabs inside block scalars.
- Folding rules for \`>\`: single newline -> space, blank lines -> newline, more-indented lines keep their newlines.
- Plain scalar rules: multi-line plain scalars and how line folding joins them; what characters terminate a plain scalar; \`: \` and \` #\` inside plain scalars; plain scalars containing \`:\` not followed by space (e.g. \`a:b\`, \`http://x\`); leading/trailing whitespace stripping.
- Single-quoted scalars: \`''\` escaping, multi-line folding, leading/trailing space handling.
- Double-quoted scalars: every escape (\\0 \\a \\b \\t \\n \\v \\f \\r \\e \\" \\/ \\\\ \\N \\_ \\L \\P \\x41 \\u0041 \\U00000041 and \\<newline> line continuation), multi-line folding, escaped-whitespace edge cases, invalid escapes (error?).
- Comments: full-line, trailing, inside flow collections, comment-only documents, \`#\` not preceded by space.
- Indentation: mappings/sequences at various indents, sequence-in-mapping at same indent as key, tabs used as indentation (error?), empty values, \`key:\` with nothing.
- Flow collections: \`[]\`, \`{}\`, nesting, trailing commas, missing values (\`{a}\`, \`{a: }\`), flow inside block and vice versa, multi-line flow collections, \`? \` explicit keys in flow.
- Explicit key form \`? k\\n: v\` in block context.
- Documents: \`---\`, \`...\`, \`%YAML 1.1\`, \`%TAG\` directives, multiple documents (error message), empty input, whitespace-only input, BOM.
- Anchors/aliases: \`&a\`/\`*a\`, anchor on collections, re-defined anchors, undefined alias error, anchor + tag together, alias as key.
- Merge key \`<<\`: single mapping, list of mappings, precedence/ordering of merged keys, \`<<\` with non-mapping (error).
Report the exact rule set precisely enough to implement a scanner from scratch.`,
  },
  {
    key: 'resolver-types',
    prompt: `${PREAMBLE}

YOUR AREA: **implicit type resolution (YAML 1.1) and value construction** for plain scalars.
Determine the EXACT set of strings that resolve to each tag, by probing many candidates. Cover:
- null: \`\`, \`~\`, \`null\`, \`Null\`, \`NULL\`, \`nUll\`, \`none\`, \`None\`.
- bool: which spellings work — \`yes/Yes/YES/yEs\`, \`no\`, \`true/True/TRUE/tRue\`, \`false\`, \`on/On/ON\`, \`off\`, \`y\`, \`n\`, \`Y\`, \`N\`.
- int: decimal, \`+\`/\`-\` signs, underscores (\`1_000\`, \`_1\`, \`1_\`, \`1__0\`), leading zeros / octal (\`010\`, \`0\`, \`00\`, \`08\`, \`0_10\`), hex (\`0x1f\`, \`0X1F\`, \`0x_1F\`, \`-0x10\`), binary (\`0b101\`, \`0B101\`), \`0o17\`, sexagesimal (\`1:2\`, \`12:30:45\`, \`190:20:30\`, \`1:60\`, \`-1:30\`), huge integers (arbitrary precision!).
- float: \`1.0\`, \`.5\`, \`5.\`, \`1.0e+5\`, \`1e5\`, \`1.0e5\`, \`1.0E+5\`, \`-1.5\`, \`1_000.5\`, \`.inf\`, \`.Inf\`, \`.INF\`, \`+.inf\`, \`.nan\`, \`.NaN\`, \`.NAN\`, sexagesimal floats (\`1:30.5\`), \`0.0\`, \`-0.0\`.
- timestamp: dates \`2001-12-14\`, \`2001-1-1\`, \`20011214\`, datetimes with \`t\`/\`T\`/space separator, fractions of various lengths (1..9 digits — check truncation/rounding to 6), timezones \`Z\`, \`+05\`, \`+05:30\`, \`-0530\`, \`+5:30\`, spaces before tz.
- Anything else: \`=\`, \`!\`, \`!!str 1\`, \`yes: \` as key.
CRITICAL: also determine the exact OUTPUT text for each constructed value (e.g. int 0x1F -> \`!!int "31"\`, float 0.000001 -> \`!!float "1.0e-06"\`). Probe float formatting exhaustively: very large/small, integral floats, 17-significant-digit round-trip cases (\`0.1\`, \`1/3\`-like \`0.3333333333333333\`, \`1e16\`, \`1e17\`, \`123456789012345678.0\`, \`1e-5\`, \`1e-4\`, \`5e-324\`, \`1.7976931348623157e+308\`). Report the float->string algorithm you infer (Python repr semantics) and every case where it differs from naive JS \`String(x)\`.
Also probe explicit tags: \`!!str\`, \`!!int\`, \`!!float\`, \`!!bool\`, \`!!null\`, \`!!binary\`, \`!!timestamp\`, \`!!seq\`, \`!!map\`, \`!!set\`, \`!!omap\`, \`!!pairs\`, \`!!python/...\`, unknown tags like \`!foo\` (error?), and what each produces on output.`,
  },
  {
    key: 'emitter-core',
    prompt: `${PREAMBLE}

YOUR AREA: the **emitter/serializer output side** (yaml.dump with default_style='"', all other options default).
Determine exact formatting rules:
- When is an explicit tag written (\`!!int\`, \`!!float\`, \`!!bool\`, \`!!null\`, \`!!timestamp\`, \`!!binary\`, \`!!set\`, \`!!python/tuple\`) and when not? Derive the rule.
- Indentation: nested mappings (2 spaces), block sequences nested in mappings (indentless — same column as key), sequences in sequences, mapping inside sequence item (\`- "k": "v"\`), deep nesting 6+ levels, sequence of sequences of mappings.
- Empty collections: \`[]\` and \`{}\` inline; empty collection as a mapping value, as a sequence item, as a top-level document, nested.
- Key sorting: strings (code-point order? probe uppercase/lowercase/underscore/digits/unicode keys), ints, floats, mixed int+float, mixed str+int (TypeError -> insertion order?), bools, None, and the exact fallback order when sorting raises. Probe carefully: is the fallback the original insertion order?
- Anchors/aliases on output: which shared objects get anchors (lists/dicts yes; strings/ints/None no?). Anchor naming (\`&id001\`) and numbering order with multiple shared objects. Anchor on a mapping KEY. Recursive structures (can safe_load even build one? try \`&a [*a]\`).
- Non-simple keys: empty-string key, multiline-string key, key longer than 128 chars, collection-as-key (error?), tuple-as-key (from !!omap/!!pairs), aliased key. Show exact \`? \`/\`: \` output form.
- Top-level: is \`---\` ever emitted? trailing newline count from \`print(result)\`.
- \`!!binary\` output style (literal block \`|\`), base64 line wrapping for long binary payloads, indentation of the base64 block.
- \`!!set\` and \`!!omap\`/\`!!pairs\` output shapes.
Report a precise algorithm.`,
  },
  {
    key: 'emitter-quoting',
    prompt: `${PREAMBLE}

YOUR AREA: **double-quoted scalar writing and line-width folding** in the emitter. This is the highest-risk area — be extremely precise.
All scalars are emitted double-quoted (default_style='"'). Determine:
- Which characters are escaped and how. Build the full escape table by probing: NUL, \\x01..\\x1f, \\x7f, \\x80..\\x9f (esp. \\x85), \\xa0, \\xff, U+2028, U+2029, U+FEFF, \`"\`, \`\\\`, DEL, and non-ASCII BMP + astral (emoji). Confirm the exact form (\`\\xHH\` uppercase hex? \`\\uHHHH\`? \`\\UHHHHHHHH\`?). Note: allow_unicode is False by default so ALL non-ASCII should be escaped — verify.
- Line folding: the width threshold (80?), where breaks are allowed (only at spaces? also right after an escape sequence?), the exact continuation form (\`\\\` at end of line; leading \`\\\` on the next line when the next char is a space), and the continuation indent (2 spaces? relative to what?).
- Derive the folding algorithm precisely. Test: a scalar with no spaces but many escapes; a scalar with one very long word; a scalar that is exactly at the boundary (craft inputs of length 74..86 and record where the break lands); a scalar nested deep so the indent is larger (e.g. 3 levels of mapping) — does the continuation indent grow?
- Are mapping KEYS folded? (Suspect split=False for simple keys — verify with a 200-char key and a key with spaces at width boundary.)
- Sequence items vs mapping values: does the starting column affect where the break lands? Verify with the same long string under different nesting depths and key lengths.
- What happens with a long scalar carrying an explicit tag (\`!!int\` etc.) — does the tag length count toward the column?
- Interaction with anchors: \`&id001 "long..."\`.
Report the algorithm as pseudocode with exact variable bookkeeping (column, indent, whitespace flags) and give at least 12 verified input->exact-output byte examples that a reimplementation can be tested against.`,
  },
  {
    key: 'cli-and-errors',
    prompt: `${PREAMBLE}

YOUR AREA: **command-line argument parsing and error/exit-code behavior**.
- Determine exact behavior and exit code for: \`--a X\`, \`--a=X\`, \`--a\` with no value, no args at all, repeated \`--a\`, extra positional args, unknown options, \`-h\`, \`--help\`, \`--a --\`, \`--a -- X\`, \`-- --a X\`, \`--a -1\`, \`--a -1.5\`, \`--a -1e5\`, \`--a -x\`, \`--a -.inf\`, \`--a=-.inf\`, \`--a ""\`, \`--a=\`, prefix abbreviation (\`--\` alone, \`--a\` is the only long option), \`--a=X=Y\`, options after \`--\`.
- Record the EXACT usage/help text bytes (use cat -A), which stream it goes to (stdout vs stderr), and the exit code for each.
- Determine argparse's negative-number heuristic precisely (which \`-...\` values are accepted as the option's value vs. rejected as unknown options).
- Then: **error behavior of yaml.safe_load** on malformed input. Probe at least 15 malformed inputs (bad indentation, tab indentation, unclosed quote, unclosed flow collection, duplicate merge on non-map, unhashable key, multiple documents, unknown tag, bad escape, control char in plain scalar, \`@\`/\`\\\`\` reserved indicators, alias to undefined anchor, \`*\` with no name, block scalar with bad indentation indicator, mapping value in a place it isn't allowed).
  For each: exact exit code, and whether ANYTHING goes to stdout (important!). Summarize the stderr shape (Python traceback + \`yaml.<module>.<ErrorClass>: <message>\` + the context/problem lines with the caret) and give 3-4 full verbatim stderr examples.
- Note: the JS port only needs stdout + exit code to match, but describe the stderr format well enough to imitate.`,
  },
];

phase('Probe')
const results = await pipeline(
  AREAS,
  a => agent(a.prompt, { label: `probe:${a.key}`, phase: 'Probe' }),
  (spec, a) => agent(`You are a completeness critic reviewing a reverse-engineering spec for area "${a.key}" of this program:

/workspace/dataset/test13_executable  (runs: yaml.dump(yaml.safe_load(args.a), default_style='"') then print)

Here is the spec another agent produced:
--- BEGIN SPEC ---
${spec}
--- END SPEC ---

Your job: find what is MISSING, WRONG, or UNVERIFIED. Actually RUN the executable yourself (scratch dir /tmp/critic-${a.key}/) to:
1. Verify at least 12 of the spec's concrete claims. Report any that are false with the real output.
2. Probe at least 15 cases the spec did NOT cover in this area, especially boundary/adversarial ones.
Return: (a) list of CORRECTIONS to the spec, (b) list of ADDITIONS (new verified rules + exact input->output bytes). Be terse and factual. If the spec is right about something, don't restate it.`,
    { label: `critique:${a.key}`, phase: 'Critique' })
    .then(crit => ({ area: a.key, spec, critique: crit }))
);

return results.filter(Boolean)
