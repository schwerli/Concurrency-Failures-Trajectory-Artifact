export const meta = {
  name: 'probe-jsonschema-draft7',
  description: 'Black-box probe of the Python jsonschema Draft7 executable to extract exact semantics',
  phases: [
    { title: 'Probe', detail: 'one agent per keyword family, runs the executable on many inputs' },
    { title: 'Synthesize', detail: 'consolidate into one implementation spec' },
  ],
}

const EXE = '/workspace/dataset/test18_executable'

const COMMON = `
You are reverse-engineering a Python program by BLACK-BOX probing. Never read Python library source; only run the binary.

The program is:
  instance = json.loads(args.a); schema = json.loads(args.b)
  validator = Draft7Validator(schema)
  errors = list(validator.iter_errors(instance)); tree = ErrorTree(errors)
  total = tree.total_errors
  first_pass = list(validator.iter_errors(instance)); second_pass = list(...)
  check1..3 = validator.is_valid(instance)
  schema_check1/2 = validator.check_schema(schema)
  tree1 = ErrorTree(first_pass); tree2 = ErrorTree(second_pass)
  print(total); print(len(first_pass)); print(len(second_pass)); print(check1..3); print(schema_check1/2); print(tree1.total_errors); print(tree2.total_errors)

So stdout is 10 lines: [treeTotal, nErrors, nErrors, bool, bool, bool, None, None, treeTotal, treeTotal].
Line 2 = the RAW COUNT of errors from iter_errors. Line 1 = ErrorTree total, which groups errors by (absolute instance path, validator keyword) in a dict, so two errors sharing both path and keyword COLLAPSE into one. The difference between line 1 and line 2 is the single most valuable signal you can extract — hunt for cases where they differ.
IMPORTANT: every print happens at the end, so ANY exception => EMPTY stdout and non-zero exit. Record exit codes.

Run it like this (ALWAYS redirect stderr away or capture separately; a harmless DeprecationWarning is always on stderr):
  ${EXE} --a '<instance json>' --b '<schema json>' 2>/dev/null; echo "EXIT=$?"

Use single-quoted shell args. Batch many cases into one bash call with a loop or a heredoc-driven script to be efficient; aim for 40+ distinct probe cases. When a case crashes, re-run it with 2>&1 to capture the Python exception type/message (that tells you WHICH operation failed and in what order).

I am reimplementing this in pure JavaScript. Report findings as precise, mechanical RULES that a reimplementer can encode, not prose impressions. Include the exact probe inputs and the exact 10-line stdout (or EMPTY + exit code) as evidence.
`

const SCHEMA = {
  type: 'object',
  properties: {
    family: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Mechanical, implementable rules derived from evidence',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          evidence: { type: 'string', description: 'exact --a / --b inputs and the observed stdout lines or EXIT code' },
          confidence: { type: 'string', enum: ['certain', 'likely', 'unsure'] },
        },
        required: ['rule', 'evidence', 'confidence'],
      },
    },
    surprises: { type: 'array', items: { type: 'string' }, description: 'behaviors a naive reimplementation would get wrong' },
    crashCases: { type: 'array', items: { type: 'string' }, description: 'inputs that produce empty stdout + nonzero exit, with the python exception seen on stderr' },
  },
  required: ['family', 'rules', 'surprises', 'crashCases'],
}

const FAMILIES = [
  {
    key: 'types',
    prompt: `FAMILY: the "type" keyword and the underlying type system.
Probe: every simple type name; type as array; integer vs number for 1, 1.0, 2.0, -0.0, 1e2, true/false (are bools ever numbers/integers?); null; nested arrays/objects; very large integers (e.g. 10000000000000000001) and whether precision is exact; floats like 1.0 being "integer" in draft7; strings with unicode/emoji. Also: how many errors does a failing "type" produce (1 per instance? per listed type?).`,
  },
  {
    key: 'numeric',
    prompt: `FAMILY: numeric keywords: multipleOf, maximum, minimum, exclusiveMaximum, exclusiveMinimum.
CRITICAL: probe whether multipleOf behaves DIFFERENTLY when the divisor is written as an integer literal (2) vs a float literal (2.0) — try instance 7.5 with multipleOf 2 vs 2.0, instance 0.0075 with multipleOf 0.0001, instance 4.5 with multipleOf 1.5, instance 1e308 with multipleOf 1e-308 (overflow?), multipleOf 0 and 0.0 (crash?). Probe huge ints, negative numbers, booleans as instance, non-number instances (ignored?). Probe minimum/maximum with a non-number schema value (e.g. minimum "5") against both a number instance and a string instance — which crashes and which reaches check_schema? Report exit codes and exception types.`,
  },
  {
    key: 'strings',
    prompt: `FAMILY: string keywords: minLength, maxLength, pattern, format.
CRITICAL unicode: does minLength/maxLength count Python code points? Probe with emoji (e.g. "😀😀", a 2-codepoint string that is 4 UTF-16 units) and combining chars against maxLength 2 / minLength 3.
CRITICAL regex semantics (Python re.search, NOT JS): probe pattern "^abc$" against "abc\\n" (Python $ matches before a trailing newline — does it validate?); pattern "\\\\d" against a non-ASCII digit like "٣" (Arabic-Indic three) or "１" (fullwidth one); pattern "\\\\w" against "é"; pattern "\\\\s" against a unicode space; whether the pattern is a SEARCH (unanchored) not a full match, e.g. pattern "b" vs "abc"; named groups "(?P<x>a)"; inline flags "(?i)abc" vs "ABC"; "\\\\A"/"\\\\Z"; an invalid regex like "[" or "(" (does it crash, and does it crash even when the instance is NOT a string?).
Also probe "format": does Draft7Validator check formats at all during iter_errors (e.g. {"format":"email"} with "notanemail", {"format":"date"} with "nope")? Separately, does check_schema reject a schema with an INVALID regex in "pattern" or in a "patternProperties" key (that would mean check_schema applies a format checker)? Test --b '{"pattern":"["}' with a NON-string instance like 1.`,
  },
  {
    key: 'arrays',
    prompt: `FAMILY: array keywords: items (single schema AND array/tuple form), additionalItems, contains, uniqueItems, minItems, maxItems.
Probe error COUNTS and ErrorTree collapse: e.g. items:{"type":"string"} with [1,2,3] => how many raw errors, what tree total (each error is at a different path index so they should NOT collapse). Tuple form with fewer/more items than schemas. additionalItems false with extra items (one error or one per item?). additionalItems as a schema. additionalItems when items is a single schema (ignored?). contains with no matching element (how many errors?) and with an empty array. uniqueItems quirks: [1,1.0], [true,1], [[true],[1]], [{"a":true},{"a":1}], [0,false], ["a","a"], nested duplicates. minItems/maxItems.`,
  },
  {
    key: 'objects',
    prompt: `FAMILY: object keywords: properties, patternProperties, additionalProperties, required, minProperties, maxProperties, dependencies, propertyNames.
Focus HARD on error counts vs ErrorTree totals:
- required with 3 missing props (already known: 3 raw errors, tree total 1 — confirm and find the general rule).
- properties failing on 2 different props (do they collapse? they have different paths).
- additionalProperties:false with 3 extra props (1 error or 3?). additionalProperties as a schema failing on 2 extras (paths?).
- patternProperties with 2 matching props failing.
- dependencies in ARRAY form with 2 missing deps (raw count vs tree total?) and in SCHEMA form.
- propertyNames failing for 2 property names — what path do those errors get (do they collapse into 1 in the tree)? Try {"propertyNames":{"maxLength":2}} with {"aaa":1,"bbb":2}.
- Interaction: additionalProperties:false together with patternProperties.
- Instance that is not an object (keywords ignored).`,
  },
  {
    key: 'combinators',
    prompt: `FAMILY: allOf, anyOf, oneOf, not, if/then/else.
Probe error counts precisely: anyOf where all branches fail (1 error total, or one per branch?); anyOf where one passes; oneOf where none match; oneOf where TWO match (error? how many?); oneOf where exactly one matches; allOf with 2 failing branches (do the sub-errors surface individually and do they collapse in the tree when they share a keyword — e.g. allOf:[{"minimum":10},{"minimum":20}] with 5, and allOf:[{"minimum":10},{"maxLength":1}]); not with a matching instance; nested combinators; if/then/else all three combinations, including if present but no then/else, and errors coming out of then (what keyword do they carry — check tree collapse against a sibling error with the same keyword, e.g. {"minimum":100,"if":{"type":"integer"},"then":{"minimum":200}} with 5).`,
  },
  {
    key: 'enumconst',
    prompt: `FAMILY: enum and const equality semantics (Python == with a boolean-vs-number guard).
Probe: enum [1] with instance true and with 1.0; enum [true] with 1; enum [0] with false; const 1 vs true; const true vs 1; const 1 vs 1.0; nested: const [1] with instance [true]; const {"a":1} with {"a":true}; enum [[1]] with [true]; enum with objects/arrays deep equality; enum [] (does check_schema reject an empty enum?); enum with duplicate entries (rejected by check_schema?); const null vs missing; string vs number "1" vs 1. Also very large ints for exact comparison (10000000000000000001 vs 10000000000000000002 — do they compare unequal, proving arbitrary precision?), and 1e19 vs 10000000000000000000.`,
  },
  {
    key: 'refs',
    prompt: `FAMILY: $ref resolution and $id scoping.
Probe: {"$ref":"#/definitions/x","definitions":{...}}; whether OTHER keywords SIBLING to $ref are ignored (e.g. {"$ref":"#/definitions/x","minimum":100} — if the minimum error never appears, siblings are ignored); recursive $ref; $ref to "#"; $ref with $id base changes; $ref to a plain-name fragment defined by a subschema's "$id":"#foo"; $ref to a subschema by its absolute $id; $ref to "http://json-schema.org/draft-07/schema#" (does it resolve offline from a bundled store?); an unresolvable $ref like "#/nope" or "http://example.com/x.json" (crash? which exception?); $ref inside items/properties. Also: what validator keyword do errors coming through a $ref carry (test tree collapse with a sibling of the same keyword). Try to determine whether the library uses the old RefResolver or the newer 'referencing' library (error message wording on an unresolvable ref is a strong hint) and report the exact exception text.`,
  },
  {
    key: 'metaschema',
    prompt: `FAMILY: check_schema strictness (the Draft-07 meta-schema) and whether a FORMAT CHECKER is applied during check_schema.
Remember: iter_errors runs BEFORE check_schema, so a schema can crash earlier. To isolate check_schema, pick an instance type that makes iter_errors a no-op (e.g. instance null or "x" when the bad keyword only applies to numbers/objects).
Probe which of these produce a crash (empty stdout, exit 1) and capture the exception NAME (SchemaError vs TypeError vs re.error) with 2>&1:
{"minLength":-1}, {"minLength":1.5}, {"maxItems":-1}, {"multipleOf":0}, {"multipleOf":-1}, {"required":"abc"}, {"required":["a","a"]}, {"required":[1]}, {"enum":[]}, {"enum":[1,1]}, {"type":"nope"}, {"type":[]}, {"type":["string","string"]}, {"type":123}, {"properties":[]}, {"properties":{"a":123}}, {"items":123}, {"pattern":123}, {"pattern":"["}, {"patternProperties":{"[":{}}}, {"$ref":123}, {"$id":123}, {"$schema":123}, {"$schema":"not a uri"}, {"$id":"not a uri"}, {"format":123}, {"unknownKeyword":123}, {"dependencies":{"a":123}}, {"dependencies":{"a":[1]}}, {"const":1} (valid), true, false, [], null, 123, "str".
For the top-level schema values true / false / [] / null / 123 / "str": report the FULL 10-line stdout when they do not crash (e.g. --b 'false' should produce 1 error for any instance; --b 'true' zero).
This tells me exactly when my JS port must throw instead of printing.`,
  },
  {
    key: 'errortree',
    prompt: `FAMILY: ErrorTree grouping semantics — the single most important thing to characterize.
Hypothesis to confirm or refute: the tree walks each error's ABSOLUTE instance path and stores it in a per-node dict keyed by the error's validator KEYWORD, so errors sharing (path, keyword) overwrite each other; total_errors = sum over all nodes of the number of distinct keywords at that node.
Design probes that discriminate:
- 2 errors, same path, same keyword => tree 1, raw 2. (e.g. required with 2 missing)
- 2 errors, same path, different keywords => tree 2, raw 2. (e.g. {"minimum":10,"multipleOf":7} with 5)
- 2 errors, different paths, same keyword => tree 2, raw 2. (e.g. properties a/b both type errors)
- deeply nested paths (3+ levels) via properties/items nesting.
- errors from a subschema reached through allOf/if-then/$ref/propertyNames — what path and keyword do they land under?
- a false schema error (--b 'false' or {"properties":{"a":false}}) — what keyword does it use (possibly None/null) and does it collide with other keywords at the same node?
- mixed big case: build one schema producing 8+ raw errors and predict the tree total, then verify.
Report the exact general algorithm you can defend with evidence.`,
  },
  {
    key: 'cli-json',
    prompt: `FAMILY: command-line parsing (Python argparse) and JSON parsing (Python json.loads) edge cases. These must be replicated exactly in a hand-written JS arg parser.
Probe and report EXACT stdout/stderr text and exit codes for:
- no args at all; only --a; only --b; both (baseline).
- --a=VALUE and --b=VALUE equals-form.
- abbreviation: does argparse accept unique prefixes? There are only --a/--b/-h so try --a with a value, and unknown flags like --c 1.
- extra positional arg; duplicate --a given twice (last wins?); "--" separator; a value that starts with a dash, e.g. --a '-1' and --a -1 (does argparse treat -1 as a value or a flag?); empty value --a ''.
- -h / --help exact text and exit code; also the usage/error text and exit code for a missing required arg (exit 2?).
- json.loads acceptance: NaN, Infinity, -Infinity, leading/trailing whitespace, duplicate object keys ({"a":1,"a":2} — last wins?), big ints, "1e400" (inf?), literal trailing comma (error), single quotes (error), unicode escapes \\u, surrogate pairs, an empty string value for --a (JSONDecodeError => exit 1).
Report the precise stderr text of argparse errors (usage line, program name shown) and exit codes.`,
  },
]

phase('Probe')
const results = await parallel(FAMILIES.map(f => () =>
  agent(`${COMMON}\n\n${f.prompt}`, { label: `probe:${f.key}`, phase: 'Probe', schema: SCHEMA, effort: 'high' })
))

const good = results.filter(Boolean)
log(`probes done: ${good.length}/${FAMILIES.length} families, ${good.reduce((n, r) => n + (r.rules?.length || 0), 0)} rules`)

phase('Synthesize')
const spec = await agent(
  `You are consolidating black-box probe findings about Python's jsonschema Draft7Validator + ErrorTree into ONE implementation spec for a JavaScript reimplementation.

Here are the raw findings from ${good.length} probe agents (JSON):

${JSON.stringify(good, null, 1)}

You may run \`${EXE} --a '<json>' --b '<json>' 2>/dev/null\` yourself to resolve any CONTRADICTION between agents or to fill an obvious gap — do so for every contradiction you find, and for anything marked 'unsure' that matters.

Produce a dense, mechanical spec organized as:
1. Output contract (the 10 printed lines, exact formatting, and the rule that any exception yields empty stdout + which exit code).
2. Per-keyword error generation: for EACH Draft7 keyword — when it applies, how many errors it yields, the instance path each error gets, and the validator-keyword label each error carries.
3. ErrorTree.total_errors algorithm.
4. check_schema: exactly which schemas are rejected (and whether a format checker is applied), plus the ordering relative to iter_errors.
5. Type system, equality, and number semantics (int vs float distinction, bool-vs-number, precision).
6. Regex semantics that differ between Python re and JS RegExp, with required translations.
7. CLI + JSON parsing contract.
8. A list of the highest-risk traps a reimplementer will get wrong.
Be exhaustive and concrete. Cite the probe evidence inline.`,
  { label: 'synthesize-spec', phase: 'Synthesize', effort: 'high' }
)

return { spec, families: good.map(r => ({ family: r.family, rules: r.rules.length, surprises: r.surprises })) }
