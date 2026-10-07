export const meta = {
  name: 'jsonschema-blackbox-probe',
  description: 'Exhaustively probe the test13 executable to reverse-engineer jsonschema validator behavior per keyword family',
  phases: [
    { title: 'Probe', detail: 'one agent per keyword family, runs the executable and records vectors' },
    { title: 'Audit', detail: 'completeness critic per family finding untested edges' },
  ],
}

const EXE = '/workspace/dataset/test13_executable'

const SCHEMA = {
  type: 'object',
  required: ['family', 'findings', 'vectorFile', 'vectorCount', 'gotchas'],
  properties: {
    family: { type: 'string' },
    findings: {
      type: 'string',
      description: 'Dense prose describing EXACT observed semantics: which keywords apply in which drafts, how many top-level errors each situation yields, cross-draft differences, and any surprising behavior. Be specific and complete; this is the spec an implementer will code from.',
    },
    vectorFile: { type: 'string' },
    vectorCount: { type: 'integer' },
    gotchas: { type: 'array', items: { type: 'string' } },
  },
}

const PREAMBLE = `You are reverse-engineering, by BLACK-BOX probing only, the behavior of this Python program (jsonschema library, modern version):

\`\`\`python
import argparse, json, jsonschema
from jsonschema import Draft7Validator, validators
parser = argparse.ArgumentParser()
parser.add_argument('--a', type=str, required=True, help='instance (JSON string)')
parser.add_argument('--b', type=str, required=True, help='schema (JSON string)')
args = parser.parse_args()
instance = json.loads(args.a)
schema = json.loads(args.b)
validator_class = validators.validator_for(schema)
validator = validator_class(schema)
result = validator.is_valid(instance)
errors = list(validator.iter_errors(instance))
print(validator_class.__name__)
print(result)
print(len(errors))
\`\`\`

Run it as: \`${EXE} --a '<instance json>' --b '<schema json>'\`
Output is 3 lines: validator class name, True/False, and the COUNT OF TOP-LEVEL errors from iter_errors (note: sub-errors nested under anyOf/oneOf/if/not live in error.context and do NOT add to this count; errors from properties/items DO each appear at top level because those keyword validators yield descended errors directly).

Do NOT use python. Do NOT read library source (you cannot). Probe only.
Use single-quoted shell args around JSON. For JSON containing single quotes use a heredoc or printf.
ALREADY ESTABLISHED (do not re-derive): no \$schema => Draft202012Validator; \$schema values map to Draft3/4/6/7/201909/202012Validator; unknown \$schema => warning on stderr + Draft202012Validator; boolean schema true/false works (false => 1 error).

YOUR ASSIGNED FAMILY: `

const TAIL = `

METHOD:
1. Probe aggressively and systematically — run MANY invocations (60+). Vary drafts: for each interesting case, re-run under \$schema draft-03, draft-04, draft-06, draft-07, 2019-09 and 2020-12 where the keyword's meaning could differ. Use a bash loop to sweep drafts cheaply, e.g.:
   for S in '"http://json-schema.org/draft-03/schema#"' '"http://json-schema.org/draft-04/schema#"' '"http://json-schema.org/draft-06/schema#"' '"http://json-schema.org/draft-07/schema#"' '"https://json-schema.org/draft/2019-09/schema"' '"https://json-schema.org/draft/2020-12/schema"'; do echo -n "$S -> "; ${EXE} --a '<inst>' --b "{\\"\\\$schema\\":$S, ...}" | tr '\\n' ' '; echo; done
2. Pay special attention to the ERROR COUNT (line 3), not just True/False. Counting semantics is the hardest thing to reimplement. Determine exactly how many errors each keyword yields and whether nested schema errors bubble up as separate top-level errors.
3. Also probe crash/exception behavior (non-zero exit, traceback) for malformed schemas in your family — record exit code and whether a traceback appears.
4. Record EVERY probe you run as a test vector.

DELIVERABLE:
Append every probe as one JSON object per line (JSONL) to the file: FILEPATH
Each line: {"a": <instance JSON string>, "b": <schema JSON string>, "out": "<exact 3-line stdout with \\n>", "exit": <int>}
Write it with a bash script that runs the executable and captures real output — do NOT hand-write expected outputs from memory. Example generator pattern:
  run() { local a="$1" b="$2"; local o; o=$(${EXE} --a "$a" --b "$b" 2>/dev/null); local e=$?; python3 - <<'EOF' 2>/dev/null || printf '%s\\n' "$(printf '%s' "{}" )" >/dev/null
EOF
  }
Simpler and REQUIRED approach: use node (available at /usr/bin/env node) to generate the JSONL, since node is allowed for tooling:
  Write a small node script that has an array of [a,b] pairs, spawns the executable with execFileSync, and appends JSONL lines with JSON.stringify. That guarantees exact escaping.
Return the file path, the count of vectors, dense findings prose, and a list of gotchas an implementer would get wrong.`

const FAMILIES = [
  {
    key: 'validator-selection',
    file: '/workspace/probes/validator-selection.jsonl',
    brief: `validator_for / \$schema dispatch and top-level plumbing.
Probe: \$schema with and without trailing '#'; http vs https scheme for every draft; draft-2019-09/2020-12 with '#'; \$schema as a non-string (number, object, array, null, bool) — does it crash or fall back?; schema that is a JSON array; schema that is a string; schema that is a number (known: TypeError crash); schema that is null; \$schema pointing at a meta-schema URI with extra path; case sensitivity of the URI; \$schema nested inside a subschema (does it change the validator?); empty schema {}; schema with only \$id.
Also probe CLI/argparse behavior exhaustively: '--a=VAL' form, '--b=VAL', argument order swapped, repeated '--a' (last wins?), missing one/both args (exit code + exact stderr text), '-h'/'--help' exact stdout, unknown option '--c' (exit code + stderr), a bare positional argument, '--' separator, empty string values, prefix abbreviation (does '--' plus a unique prefix work — try nothing shorter exists since names are 1 char; try '--a' vs '-a' single dash — argparse allows single-dash long options? test '-a 1 -b 1'), and values that look like options (e.g. --a '-5'). Record exact stderr text for errors too (capture stderr into the "out" field for these, and note it in findings).`,
  },
  {
    key: 'type-and-scalars',
    file: '/workspace/probes/type-and-scalars.jsonl',
    brief: `The 'type' keyword and scalar identity.
Probe: every type name (null, boolean, object, array, number, string, integer) against every JSON value kind; 'type' as an array of names; empty array; duplicate names; unknown type name (e.g. "foo") — error or ignored?; integer vs number for 1.0 / 1e2 / 2.0 (does 1.0 count as integer in each draft? draft3/4 vs draft6+ differ); booleans true/false vs "integer"/"number" (Python bool is an int subclass — verify jsonschema excludes it); very large ints; -0; 0.0; exponent forms; 'type' with a non-string non-array value; draft3 'any' type; draft3 'type' with an inline subschema in the list; draft3 'disallow'.
Also: 'enum' (with mixed types, with 1 vs true, 1 vs 1.0, nested objects/arrays, key order differences, empty enum), 'const' (which drafts support it — is it ignored in draft4/3?), const/enum with true vs 1, with 1 vs 1.0, with objects whose keys are reordered, with nested arrays.
Error counts for each.`,
  },
  {
    key: 'numeric',
    file: '/workspace/probes/numeric.jsonl',
    brief: `Numeric keywords.
Probe: multipleOf (integers, floats like 0.0001, values causing float imprecision e.g. 4.5/1.5, 0.0075/0.0001, 1e308 huge numbers, multipleOf 0 — crash?, negative multipleOf, multipleOf on a boolean/string instance = ignored), divisibleBy (draft3 only?), maximum/minimum, exclusiveMaximum/exclusiveMinimum as BOOLEAN modifiers (draft3/draft4) vs as NUMBERS (draft6+) — verify per draft what happens when you use the wrong form (e.g. numeric exclusiveMaximum in draft4, boolean exclusiveMaximum in draft7: crash or ignored?), maximum with exclusiveMaximum:true in draft4, combined min+max failing simultaneously (error count), numbers vs booleans as instance (bool must be exempt), integer overflow-ish values, -0 vs 0.
Report exact error counts for each and cross-draft differences.`,
  },
  {
    key: 'string',
    file: '/workspace/probes/string.jsonl',
    brief: `String keywords.
Probe: minLength/maxLength with ASCII, with non-BMP characters (emoji like 😀 which is 1 Python code point but 2 JS UTF-16 units — CRITICAL), with combining marks, empty string; both failing at once (error count). pattern: verify it is a SEARCH not a full match (e.g. pattern "b" against "abc"); anchors ^ and \$; Python-specific regex syntax: (?P<name>...), \\d \\w \\s semantics on unicode (does \\d match Arabic-Indic digits? does \\w match accented letters? Python re is unicode-aware by default), \\A \\Z \\b, lookahead/lookbehind, inline flags (?i), invalid regex (crash?), pattern applied to non-string instance (ignored). 
format: is 'format' ASSERTED by default? Test format:"email"/"date-time"/"ipv4"/"uuid" with invalid values across drafts — confirm ignored or not.
contentEncoding/contentMediaType/contentSchema: asserted or ignored?
Report exact error counts.`,
  },
  {
    key: 'array',
    file: '/workspace/probes/array.jsonl',
    brief: `Array keywords across drafts.
Probe: 'items' as a single schema vs as an ARRAY of schemas (tuple form) — in 2020-12 array-form items is NOT tuple validation anymore; determine exactly what 2020-12 does with items:[...] (is it treated as a schema? ignored? crash?) vs 2019-09 and draft7. 'prefixItems' (2020-12 only — is it ignored in 2019-09/draft7?). 'additionalItems' (draft4-2019-09; ignored in 2020-12?) with tuple items, with schema items, with false. 
Error counts: how many errors when 3 array elements each fail 'items'? When both items and additionalItems fail? 
'contains' (draft6+; ignored draft3/4?), 'minContains'/'maxContains' (2019-09+ only; ignored earlier?), minContains:0 special case, contains against empty array. 'uniqueItems' with [1,true],[1,1.0],[0,false],[{},{}],[[1],[1]], nested, with objects with reordered keys, large arrays. minItems/maxItems both failing. 'unevaluatedItems' (2019-09+) with prefixItems/items/contains/allOf/anyOf/if-then — probe carefully, and confirm it's ignored in draft7.
Report exact error counts for every case.`,
  },
  {
    key: 'object',
    file: '/workspace/probes/object.jsonl',
    brief: `Object keywords across drafts.
Probe: properties (multiple failing props => error count; ORDER of iteration irrelevant but count matters), patternProperties (regex search semantics, a property matching multiple patterns => multiple errors?), additionalProperties (false => one error per extra property or one total? test 3 extra properties), additionalProperties as schema, interaction properties+patternProperties+additionalProperties.
required: draft4+ array form; draft3 form where required is a BOOLEAN inside each property subschema — verify draft3 behavior and what draft3 does with an array-form required, and what draft4+ does with boolean-form required (crash/ignored). Error count when 3 required props are missing.
dependencies (draft3-draft7: schema form and array-of-strings form and draft3 single-string form), dependentRequired + dependentSchemas (2019-09+; ignored in draft7?), and whether 'dependencies' still works in 2019-09/2020-12.
propertyNames (draft6+), minProperties/maxProperties (draft4+; draft3?), unevaluatedProperties (2019-09+) with properties/patternProperties/additionalProperties/allOf/anyOf/if-then/\$ref — probe carefully.
draft3 'extends' keyword (single schema and array form).
Report exact error counts for every case.`,
  },
  {
    key: 'combinators',
    file: '/workspace/probes/combinators.jsonl',
    brief: `Boolean combinators and conditionals.
Probe: allOf (3 failing branches => how many top-level errors? likely 3 since allOf descends), anyOf (all failing => 1 error with context), oneOf (0 matches => 1 error; 2+ matches => 1 error), not (=> 1 error), if/then/else (draft7+; ignored in draft6/4/3?), if with no then/else, if-then-else nesting, error counts when then-branch has multiple failures (does it produce N top-level errors or 1?).
Also: allOf containing properties that fail multiple times; combinators nested inside properties (count bubbling); empty allOf/anyOf/oneOf arrays; allOf with boolean schemas (true/false); 'not': true / 'not': false; combinator value not an array (crash?).
Determine precisely the RULE for when sub-errors are flattened into top-level errors vs collapsed into one error with context. Test deeply nested: {"properties":{"x":{"allOf":[{"type":"string"},{"minLength":9}]}}} with x=1.
Report exact error counts for every case.`,
  },
  {
    key: 'refs',
    file: '/workspace/probes/refs.jsonl',
    brief: `\$ref and identifier resolution.
Probe: \$ref to '#/definitions/x' and '#/\$defs/x'; \$ref to '#'(root, recursion); \$ref with JSON-pointer escaping (~0, ~1, percent-encoding %25, spaces); \$ref to array index '#/items/0'; \$ref to a nonexistent pointer (crash? exit code?); \$ref to an external URL like 'http://example.com/x' (crash? what error/exit code? does it try network?); \$ref sibling keywords — in draft7 siblings are IGNORED when \$ref present, in 2019-09+ siblings ARE applied: verify with {"\$ref":"#/\$defs/a","minLength":10} under draft7 vs 2020-12 and report error counts.
\$id / id (draft3,4 use 'id'; draft6+ use '\$id'): base URI changes, \$ref resolving against a local \$id like {"\$id":"http://x/","\$defs":{"a":{"\$id":"b","type":"string"}}} with \$ref "b" or "http://x/b"; \$anchor (2019-09+) and '#foo' plain-name fragments via \$id in draft7; \$recursiveRef/\$recursiveAnchor (2019-09); \$dynamicRef/\$dynamicAnchor (2020-12).
Also: does the validator resolve refs to the META-SCHEMA (e.g. \$ref to "http://json-schema.org/draft-07/schema#") — does that work offline?
Report error counts, crashes (exit code + exception class name from traceback last line).`,
  },
  {
    key: 'error-counting-deep',
    file: '/workspace/probes/error-counting-deep.jsonl',
    brief: `The precise TOP-LEVEL ERROR COUNT rule — this is the single most important output.
Systematically build schemas of increasing nesting depth and record counts. Cases to cover:
- N sibling keywords failing at the root (type + minLength + pattern + enum) => N?
- properties with N failing children, each child failing M keywords => N*M?
- items array with N failing elements each failing M keywords
- nested properties 3 levels deep with multiple failures at the leaf
- allOf/anyOf/oneOf/not at various depths, including allOf inside properties inside items
- if/then where then fails 3 keywords
- \$ref pointing to a schema failing 3 keywords
- patternProperties + additionalProperties both failing
- dependencies schema-form failing multiple keywords
- contains failing (how many errors when no element matches? one, or one per element?)
- propertyNames failing for 3 property names
- unevaluatedProperties with 3 unevaluated props
- 'required' missing 3 keys, additionalProperties:false with 3 extras, uniqueItems + minItems together
Derive and state the general rule (which keyword validators yield descended errors vs a single wrapping error), and enumerate exactly which keywords collapse to 1 error.
Report every case as a vector.`,
  },
  {
    key: 'draft3-legacy',
    file: '/workspace/probes/draft3-legacy.jsonl',
    brief: `Draft 3 and Draft 4 legacy semantics in full (always set \$schema to draft-03 or draft-04).
Draft3: 'required' as boolean inside property schemas; 'dependencies' with string/array/schema values; 'divisibleBy'; 'disallow' (string, array, with inline schemas); 'extends' (schema or array); 'type' with inline schemas in the array; 'properties' + 'additionalProperties'; 'items'+'additionalItems'; 'minimum'/'maximum' with exclusiveMinimum/exclusiveMaximum booleans; does draft3 support 'enum'? 'pattern'? 'minLength'? 'format'? 'uniqueItems'? 'minItems'? 'patternProperties'? 'minProperties'/'maxProperties' (should be IGNORED in draft3)? 'const'? 'contains'? 'allOf/anyOf/oneOf/not' (should be IGNORED in draft3)? '\$ref' with 'id'? Test each: give a schema that WOULD fail if the keyword were supported, and see if it's ignored (True/0) or enforced.
Draft4: which of const/contains/propertyNames/exclusiveMin-as-number/if-then-else/\$defs are ignored? Is 'id' used instead of '\$id' for base URI? Does draft4 support 'dependencies'? 'format'?
Report exactly which keyword is active in which draft — build a keyword-x-draft support matrix in your findings. This matrix is the deliverable.`,
  },
  {
    key: 'draft201909-2020-12',
    file: '/workspace/probes/draft201909-202012.jsonl',
    brief: `Modern draft specifics (2019-09 and 2020-12).
Probe: full keyword support matrix — does 2020-12 still honor 'definitions', 'dependencies', 'additionalItems', array-form 'items'? Does 2019-09 honor 'prefixItems'? Does 2019-09 honor '\$dynamicRef'? Does 2020-12 honor '\$recursiveRef'?
unevaluatedProperties / unevaluatedItems in depth: interaction with allOf, anyOf (only successful branches contribute evaluation), oneOf, if/then/else (does a failing 'if' still evaluate?), \$ref, nested unevaluated*, patternProperties, additionalProperties:true, dependentSchemas, contains (does contains mark items evaluated for unevaluatedItems? — in 2020-12 it does).
'contains'+'minContains':0 (does that make contains always pass?), maxContains.
Vocabulary/'\$vocabulary' handling: does a custom \$vocabulary in the schema change anything (schema is not a meta-schema so probably not)?
'deprecated','readOnly','writeOnly','title','description','default','examples','\$comment' — confirm all ignored.
Error counts for each unevaluated* case (3 unevaluated props => 1 error or 3?).
Report a precise keyword-x-draft matrix for 2019-09 vs 2020-12 vs draft7.`,
  },
]

phase('Probe')

const results = await pipeline(
  FAMILIES,
  (f) =>
    agent(PREAMBLE + f.brief + TAIL.replace('FILEPATH', f.file), {
      label: `probe:${f.key}`,
      phase: 'Probe',
      schema: SCHEMA,
      effort: 'high',
    }),
  (r, f) =>
    agent(
      `A prior agent black-box probed the jsonschema behavior family "${f.key}" of the program at ${EXE} (usage: ${EXE} --a '<instance json>' --b '<schema json>'; prints validator class, True/False, top-level error count).

Its findings were:
---
${r ? r.findings : '(the probe agent failed and produced nothing)'}
---
Gotchas it listed: ${r ? JSON.stringify(r.gotchas) : '[]'}
Its vectors are in ${f.file} (${r ? r.vectorCount : 0} lines of JSONL, each {"a","b","out","exit"}).

You are the COMPLETENESS CRITIC. Its assignment was:
${f.brief}

Your job: find what is MISSING or WRONG. Specifically:
1. Read ${f.file} (use head/wc/grep, don't dump the whole thing) and check which parts of the assignment were actually probed.
2. Identify untested edges, especially anything affecting ERROR COUNTS or cross-draft differences, and anything a JavaScript reimplementer would get wrong (unicode string length with astral chars, Python regex vs JS regex, float precision, integer vs bool, object key ordering, deep equality of numbers 1 vs 1.0, -0).
3. RUN those missing probes yourself against the executable and APPEND them as JSONL lines to the SAME file ${f.file} (same format: {"a","b","out","exit"}). Use a node script with execFileSync to append so escaping is exact. Never hand-write expected output.
4. Verify a random sample of ~8 existing lines by re-running them and comparing to the recorded "out" — report any mismatch (a mismatch means the file is corrupt/hand-written).

Return: family name, MERGED and CORRECTED findings prose (restate the full spec for this family incorporating both the prior findings and everything new you learned — the implementer reads ONLY your version, so it must be self-contained and complete), the vector file path, the TOTAL line count after your appends (wc -l), and a gotchas list.`,
      {
        label: `audit:${f.key}`,
        phase: 'Audit',
        schema: SCHEMA,
        effort: 'high',
      },
    ),
)

const ok = results.filter(Boolean)
log(`probed ${ok.length}/${FAMILIES.length} families`)
return ok
