export const meta = {
  name: 'probe-jsonschema-draft7',
  description: 'Black-box probe of the jsonschema Draft7 error-count executable across all keyword families',
  phases: [
    { title: 'Probe', detail: 'one agent per keyword family: author cases, run reference exe, record rules' },
    { title: 'Extend', detail: 'adversarial completeness critic per family: find untested edges, extend corpus' },
  ],
}

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    family: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, observed behavioral rules. Each one line. Include exact error COUNTS.',
      items: { type: 'string' },
    },
    gotchas: {
      type: 'array',
      description: 'Python-vs-JavaScript divergences a JS reimplementer must handle, with the concrete case that proves each.',
      items: { type: 'string' },
    },
    exceptionCases: {
      type: 'array',
      description: 'Inputs that make the reference exit nonzero (unhandled Python exception).',
      items: { type: 'string' },
    },
    corpusPath: { type: 'string' },
    caseCount: { type: 'number' },
  },
  required: ['family', 'rules', 'gotchas', 'exceptionCases', 'corpusPath', 'caseCount'],
  additionalProperties: false,
}

const PREAMBLE = `You are reverse-engineering, PURELY AS A BLACK BOX, the behavior of this program:

    /workspace/dataset/test5_executable --a '<instance JSON>' --b '<schema JSON>'

It is a PyInstaller bundle of this Python script (jsonschema 4.23.0, CPython 3.x):

    instance = json.loads(args.a); schema = json.loads(args.b)
    validator = Draft7Validator(schema)
    errors = list(validator.iter_errors(instance))
    print(len(errors))

So stdout is the NUMBER OF TOP-LEVEL ValidationErrors yielded by iter_errors, then a newline.
Nonzero exit = unhandled Python exception (stdout empty). Exit 2 = argparse usage error.

RULES OF ENGAGEMENT:
- NEVER run 'python'/'python3'. Only run the executable. Do not try to unpack or read the bundle's source.
- Your job is EMPIRICAL: form a hypothesis, then run cases to confirm/refute. Report only what you OBSERVED.
- The consumer of your report is an engineer reimplementing this in pure Node.js ESM with zero dependencies.
  What they need from you: exact error-count semantics, and every place naive JS would diverge from Python.

WORKFLOW (do all of it):
1. Author a case file /workspace/probe/cases/<FAMILY>.json — a JSON array of {"a": "<instance json string>", "b": "<schema json string>", "note": "what this pins down"}.
   Write it with the Write tool (it is plain JSON; remember a/b are STRINGS containing JSON).
2. Run: node /workspace/probe/harness.mjs /workspace/probe/cases/<FAMILY>.json
   It prints one line per case (out="N\\n" or EXIT code) and saves observed results to /workspace/probe/observed/<FAMILY>.json.
   You may also invoke the executable directly for quick one-off checks.
3. Iterate: when a result surprises you, add cases to isolate the rule. Aim for 45-110 cases that are DECISIVE, not repetitive.
4. IMPORTANT: every case in your final case file must have been run through the harness so its observed output is recorded.
   The observed file is the regression corpus the implementer will test against - it must be complete and correct.

Report your findings via the structured output tool. Be dense and specific: "properties yields one error per failing
subschema, and nested errors propagate individually (instance {"a":{"b":1}} vs properties.a.properties.b.type=string
plus a.required=[z,y] => 3)" is useful; "properties works as expected" is useless.`

const FAMILIES = [
  {
    key: 'types-boolean-schemas',
    focus: `The "type" keyword and boolean schemas.
- type as string and as array; every JSON Schema type name; multiple failing types => how many errors?
- Draft6+ quirk: is 1.0 an "integer"? is 1e2? is 100.0? What about true/false vs "integer"/"number"/"boolean"?
- Is null a type? Are ints "number"? Is a bool a "number"? Is a string of digits a number?
- Boolean schemas: true / false as the whole schema, and nested (properties.x = false, items = true, etc.).
- Unknown type name ("bogus", "int", "Object", 5, null, [] , ["string","bogus"]) => exception or ignored? Empty array type?
- Also: schema {} and schema with only unknown keywords => 0 errors?`,
  },
  {
    key: 'numeric-keywords',
    focus: `multipleOf, maximum, minimum, exclusiveMaximum, exclusiveMinimum (Draft7 numeric forms).
- Count per keyword; several failing numeric keywords at once => sum?
- multipleOf: integer divisor vs float divisor (0.1, 0.0001), negative divisor, divisor 0 (exception?), float instance
  with integer divisor, huge instances, 1e308 overflow, instance 0. Probe floating-point edges hard:
  is 0.3 a multiple of 0.1? 4.5 of 1.5? 7.5 of 2.5? 1e-8 of 1e-9? 0.0075 of 0.0001? 12.3 of 0.041?
- Non-number instances (string/bool/null/array) => skipped (0 errors)?
- booleans: is true subject to maximum/minimum/multipleOf?
- exclusiveMaximum/Minimum with a BOOLEAN value under Draft7 (draft4 style) — what happens numerically
  (e.g. instance 1 with exclusiveMaximum:true => is it compared against 1? instance 0/2 with exclusiveMinimum:true)?
- Special JSON values Python's json.loads accepts: NaN, Infinity, -Infinity as the INSTANCE and inside the SCHEMA
  (maximum:Infinity, multipleOf:NaN, instance NaN with maximum/multipleOf/type:number). Which combinations throw?
- Big integers beyond 2^53 (instance 12345678901234567891, maximum 12345678901234567890) — does Python's exact
  integer arithmetic change the answer vs IEEE doubles? Probe several pairs that collide as doubles but differ as ints,
  including multipleOf with big ints, and integers with >17 significant digits.`,
  },
  {
    key: 'string-keywords-unicode',
    focus: `minLength, maxLength (NOT pattern - another agent covers regex).
- Length is measured in what units? Prove it with: non-BMP chars (emoji, "\\ud834\\udd1e", CJK ext), combining marks
  ("e\\u0301"), astral pairs, ZWJ sequences, lone surrogate escapes "\\ud800" (does json.loads even accept them?
  does len() count 1?). JS .length would differ - pin down every divergence.
- Non-string instances skipped? numbers/arrays/objects/bool/null with minLength.
- minLength 0, negative, float bounds (minLength 2.0, 2.5), string bound (exception?).
- Escapes: "\\u0000" in a string, "\\/", "\\b\\f", tabs/newlines - accepted by json.loads? counted as 1 char?
- Also cover the "format" keyword ONLY to confirm whether it is validated at all (Draft7Validator with no
  format_checker): try format date/email/uri/ipv4/regex with clearly invalid values.`,
  },
  {
    key: 'regex-pattern',
    focus: `"pattern" and "patternProperties" regex semantics — Python 're' vs JavaScript RegExp. THE HIGHEST-RISK AREA.
Establish empirically (instance => error count 0 or 1):
- Anchoring: is it search() or fullmatch()? ("abc" vs pattern "b"). "^"/"$" behavior with embedded newlines:
  "a\\nb" vs "^a$", "^b$", "a$"; trailing newline "a\\n" vs "a$" and "^a$"; "\\Z", "\\A", "\\b", "\\B".
- Unicode classes: \\d \\w \\s \\D \\W \\S against non-ASCII: Arabic-Indic digit "\\u0663", superscript "\\u00b2",
  Roman numeral "\\u2160", letter "e\\u0301", "\\u00e9", NBSP "\\u00a0", "\\u3000", vertical tab "\\x0b",
  "\\x1c", "\\u0085", full-width digit "\\uff11", "\\u00b5". Which does Python's \\d/\\w/\\s match that JS's does not (and vice versa)?
- Python-only syntax: (?P<n>...) named group, (?P=n) backref, (?#comment), inline (?i)(?s)(?m)(?x) flags at start
  and MID-pattern (mid-pattern is an error in modern Python - confirm), \\Z, \\A, octal \\101, \\N{...}, possessive
  quantifiers "a++", atomic group "(?>a)", conditional "(?(1)a|b)", "[[:alpha:]]" (literal class in Python?), "\\p{L}"
  (INVALID in Python? confirm), unbalanced/invalid patterns "[", "(", "*", "a{2,1}", "(?P<1>x)", back-ref "\\1" without group.
- JS-vs-Python semantic differences: "$" with multiline, "." vs newline, "[]" (empty class - Python error? JS = never match),
  "[^]" (JS = any; Python = ?), "\\z", nested quantifier "a**", "{,3}" (Python 3.11+ = {0,3}? JS = literal), "a{}" literal braces,
  unescaped "]" or "}" alone, "\\-", "\\/" inside a class, "(?<=a)" lookbehind fixed/variable width, "\\k<n>".
- Case: is IGNORECASE unicode-aware ("K" vs "\\u212a" Kelvin, "\\u00df" vs "SS", Turkish dotless i) with (?i)?
- patternProperties: is the key matched with search (unanchored)? multiple patterns matching one key => how many errors?
  Non-string keys impossible in JSON, but empty-string key "" and keys with newlines/unicode.
- Invalid regex in patternProperties/pattern => exception (report exactly which patterns throw).
Deliver a precise translation table: Python construct -> observed behavior -> what JS RegExp does differently.`,
  },
  {
    key: 'array-keywords',
    focus: `items, additionalItems, maxItems, minItems, contains, and how array element errors multiply.
- items as a schema (applies to all) vs items as an ARRAY of schemas (tuple validation, positional).
  With items array shorter/longer than instance. items:[] with a non-empty array.
- additionalItems: only honored when items is an array? additionalItems:false with extra items => ONE error or one per extra?
  additionalItems as a schema with several failing extras => count. additionalItems with items as a schema (ignored?).
  additionalItems:false with items ABSENT.
- contains: how many errors when nothing matches? when the array is empty? when instance is not an array?
  contains:false, contains:true, contains with an empty array instance.
- minItems/maxItems: float bounds, 0, negative, non-array instances, string instances (skipped?).
- Multiplicity: nested arrays of failing items (e.g. instance [1,2,3] with items:{type:"string"} => 3?),
  items array + additionalItems both failing, deeply nested arrays/objects — prove errors propagate individually
  and are NOT collapsed. Combine 3-4 failing keywords on one array to confirm counts add up.
- items:{...} on an empty array; items as a boolean false with [] and with [1,2].`,
  },
  {
    key: 'object-keywords',
    focus: `properties, patternProperties, additionalProperties, required, minProperties, maxProperties, propertyNames, dependencies.
- required: one error per missing property? duplicates in required (["a","a"]) => 2 errors? required on a non-object
  (array/string/null) => skipped? required:[] ; required with non-string entries.
- properties: only applies to present keys; several failing properties => sum; property whose subschema is false/true.
- patternProperties: multiple patterns hitting the same key => errors from each? non-matching keys ignored.
- additionalProperties false with N extras => exactly ONE error? additionalProperties as a schema failing on N extras => N errors?
  Interaction with properties AND patternProperties (which keys count as "additional"?).
- propertyNames: how many errors for N bad names? propertyNames:false with an empty object vs 2 keys.
  propertyNames with maxLength/pattern; is the NAME validated as a string instance?
- dependencies: array form (one error per missing dep? duplicates?) and schema form (descends => multiple errors?),
  dependency key absent from instance, dependencies on non-objects, empty array dep, dependencies:{"a":true/false}.
- minProperties/maxProperties: floats, 0, non-objects.
- Duplicate keys in the instance JSON ({"a":1,"a":2}) - which wins, and does it affect counts?
- Big combination: one object failing 6 different object keywords at once - confirm the total is the sum.`,
  },
  {
    key: 'combinators',
    focus: `allOf, anyOf, oneOf, not, if/then/else — error COUNT collapsing is the crux.
- anyOf with 0/1/several matching and N failing branches => exactly how many top-level errors? (Sub-errors are in
  .context and must NOT be counted - prove it: an anyOf whose branches would individually produce 5 errors.)
- oneOf: none valid => ? ; exactly one valid => ? ; TWO OR MORE valid => ? (prove the "valid under each of" error);
  three valid; oneOf with duplicate identical branches.
- allOf: N failing branches each producing M errors => N*M? allOf:[] ; allOf with a false schema; nested allOf.
- not: instance valid against the not-schema => 1 error; not:{} ; not:true ; not:false ; nested not.
- Empty combinators: anyOf:[], oneOf:[], allOf:[] (report exact counts).
- if/then/else: if passes & then fails => count of then's errors; if fails & else fails => count; if passes with no then;
  if fails with no else; then/else WITHOUT if (ignored?); if:false/if:true; if that itself has multiple errors
  (do the if-branch's own errors ever surface?).
- Deep mixes: anyOf inside allOf inside properties; oneOf where branches contain required+type failures; combinators
  combined with sibling keywords at the same level (do siblings still contribute?).`,
  },
  {
    key: 'ref-resolution',
    focus: `$ref under Draft7 (jsonschema 4.23 legacy RefResolver).
- SIBLING KEYWORDS: {"$ref":"#/definitions/x","type":"boolean",...} — are siblings ignored entirely? Prove with a case
  where sibling and target disagree, and where BOTH would fail (count 1 vs 2).
- Local JSON pointers: "#", "#/definitions/x", "#/properties/a", pointer INTO an array "#/allOf/0", pointer with
  escaping "~0"/"~1" (keys "a/b" and "a~b"), percent-encoded "%25"/"%20"/"%7E" in pointers, empty fragment "#",
  pointer to a boolean schema, pointer to a non-schema value (e.g. to a string or number => exception?).
- Missing pointer target => exception? Malformed ref "#/a/b/c" ; ref to itself "#" (infinite recursion => exception?);
  mutually recursive refs via definitions (a->b->a) with an instance that terminates the recursion (e.g. linked list) — does it work?
- $id / $anchor: does a subschema "$id" change the base URI (does {"$id":"foo","$ref":"#/x"} still resolve locally)?
  Root "$id":"http://x/y" plus "$ref":"#/definitions/z"; "$ref":"other.json" (network => exception?);
  "$ref":"http://json-schema.org/draft-07/schema#" (network attempt => exception? or bundled?).
- Does a nested "$schema" (e.g. draft-04 or draft-06 inside a subschema/definition) change the dialect used for that
  subschema? Design a DECISIVE test: draft4 exclusiveMaximum:true+maximum, or draft4 "id" vs "$id", or draft6 "contains"
  in a draft4 subschema, or "dependentRequired" (draft2019) inside a subschema with $schema 2019-09.
- $ref to a definition that itself has a $ref; $ref inside items/properties/allOf; count multiplicity through refs.
- "definitions" itself is never validated (a broken schema under definitions that is never referenced => 0 errors)?`,
  },
  {
    key: 'enum-const-equality',
    focus: `enum and const — the equality relation is subtle. One error max per keyword, but WHEN?
Probe the equality relation exhaustively (instance vs enum/const value):
- 1 vs true / 0 vs false / true vs 1 / false vs 0 (both directions, in enum and const).
- 1 vs 1.0 / 1.0 vs 1 / 1e2 vs 100 / 100.0 vs 100 / -0.0 vs 0 / 0 vs -0.0.
- Big ints beyond 2^53 that collide as doubles (e.g. 9007199254740993 vs 9007199254740992).
- NaN vs NaN, Infinity vs Infinity, NaN in enum with instance NaN (identity quirk?).
- Nested: [1] vs [true], [true] vs [1], {"a":1} vs {"a":true}, [[1]] vs [[true]], {"a":[1,true]} duplicated,
  nested 1 vs 1.0 inside arrays/objects, object key order ({"a":1,"b":2} vs {"b":2,"a":1}), extra/missing keys,
  array order and length.
- Strings: "1" vs 1, "true" vs true, unicode normalization ("e\\u0301" vs "\\u00e9"), case, empty string vs null.
- null vs false, null vs 0, null vs "" , null vs [].
- enum:[] (=> 1 error always?), enum with duplicate values, enum:[null] with instance null, single-element enum.
- const:null / const:false / const:0 with matching and non-matching instances; const:{} vs instance {}.
- Does enum/const skip based on instance type? (i.e. are they always applied?)
Report the exact equality algorithm you infer, as a decision procedure.`,
  },
  {
    key: 'uniqueitems-sorting',
    focus: `uniqueItems - the trickiest keyword because jsonschema's implementation is sort-order dependent.
Known starting facts (verified): [1,1.0]=>1 error, [1,true]=>0, [{},{}]=>1, [[1],[true]]=>0, [NaN,NaN]=>1, [1,NaN,1]=>0 (!).
That last one shows a sorted-adjacency algorithm that NaN breaks. Map the whole behavior:
- Duplicate detection for: numbers (int/float cross-type), strings, null, booleans, arrays, objects, and MIXED-type arrays.
- The NaN anomaly: [1,NaN,1], [NaN,1,1], [1,1,NaN], [1,1,NaN,2], ["a",NaN,"a"], [{},NaN,{}], [Infinity,Infinity],
  [NaN], [NaN,NaN,NaN], [1,NaN,NaN,1], and longer arrays (10-20 elements) mixing NaN with duplicates in different
  POSITIONS. The goal: determine exactly when duplicates are missed. Position matters - probe systematically,
  including arrays long enough (>64 elements) to change Python's sort strategy if you can.
- Mixed types that make Python's sort raise TypeError and fall back to a brute-force scan whose equality rule DIFFERS:
  [[1],[true],{}] (=>0), [[1],[true],null], [1,"a",1], [1,null,1] (=>1), [null,null], [true,true], [true,1,true],
  [{},{"a":1},{}], [[],[],{}], ["a",1,"a"], [[1],[1.0]], [[1],[1.0],{}], [{"a":1},{"a":1.0}], [{"a":1},{"a":true}],
  [{"a":1},{"a":true},null]. Find cases where adding an incomparable element CHANGES whether a duplicate is detected.
- uniqueItems:false / absent / non-boolean values; non-array instances; empty array; single element.
- Interaction: uniqueItems plus items/minItems failing together (counts add).
Deliver a decision procedure precise enough to reimplement, naming which comparison rule applies in which regime.`,
  },
  {
    key: 'ignored-keywords',
    focus: `Everything Draft7Validator does NOT validate, plus keywords from other drafts.
- format (no format_checker): every common format with invalid values => 0 errors? Confirm broadly.
- contentEncoding / contentMediaType with garbage (base64 invalid, "application/json" with non-JSON) => 0 errors?
- Annotations: title, description, default, examples, $comment, readOnly, writeOnly, deprecated - all inert even when
  they hold nonsense (e.g. "default": {"type":"string"} or a broken subschema)?
- Keywords from OTHER drafts that Draft7 must IGNORE: dependentRequired, dependentSchemas, prefixItems, unevaluatedItems,
  unevaluatedProperties, $defs (as a container - inert?), minContains, maxContains, $recursiveRef, $dynamicRef,
  $vocabulary, exclusiveMinimum as a boolean (draft4 style), "id" (draft4 style), "divisibleBy" (draft3), "disallow",
  "extends", "required" as a BOOLEAN (draft3 style: {"required":true} on a property) - error or ignored or exception?
- Completely unknown keywords ("foo", "$$x", "0", "" empty-string key), and unknown keywords whose values are broken schemas.
- $schema at the ROOT with various values (draft4/6/7/2019/2020/garbage/non-string) - does it change anything or throw?
- A schema that is a non-object, non-boolean (5, "x", null, [], [{"type":"string"}]) => exception? Report exit codes.
- Keyword casing ("Type", "TYPE", "properties " with a space) => ignored?`,
  },
  {
    key: 'cli-argparse',
    focus: `Command-line parsing fidelity (argparse: two required options --a and --b, both type=str).
For each, report EXACT stdout, exact stderr text, and exit code:
- Correct usage; --a=VALUE and --b=VALUE (equals form); order swapped (--b before --a).
- Missing --a; missing --b; both missing; no args at all.
- -h and --help (capture the FULL exact help text, byte for byte - the JS port must reproduce it).
- Unknown option (--c 1, -x, --A); positional extra ("5"); "--" separator; repeated option (--a 1 --a 2 - last wins?).
- Prefix abbreviation: does argparse accept "--" only, or is any abbreviation of --a possible? Is "-a" (single dash) accepted?
- Option value that looks like an option: --a --b (what error?), --a "-5", --a=-5, --a "" (empty string), --a " " ;
  values starting with "-" in general.
- Values containing newlines, tabs, unicode, NUL-ish escapes; very long values.
- Missing value: --a (at end, no value), --a --b 1.
- Whitespace-only JSON, empty JSON, JSON with leading/trailing whitespace/newlines (accepted?).
- Also: what does the program print on a JSON syntax error in --a vs --b (exit code, stderr shape)?
Report the exact usage/error message strings (they go to stderr) and exit codes: this determines the JS port's CLI.`,
  },
  {
    key: 'json-parsing',
    focus: `What Python's json.loads accepts/rejects for --a and --b, and how numeric precision affects results.
- Accepted extensions vs JS JSON.parse: NaN, Infinity, -Infinity (bare and nested; as schema values too),
  and are they accepted in objects/arrays? Case sensitivity ("nan", "inf", "Inf", "infinity", "+Infinity").
- Rejected forms (confirm exit 1): trailing commas, single quotes, unquoted keys, comments, "01", "+1", ".5", "1.",
  "0x10", "1e", hex/unicode escapes malformed ("\\uZZZZ", "\\u12"), raw control chars in strings, single "\\",
  bare words (undefined/None/True/False/null vs NULL), empty input "", "  ", duplicate JSON docs ("1 2"), BOM.
- Accepted oddities: "1e400" (=> inf?), "-1e400", "1E+2", very deep nesting (1000 levels - RecursionError?),
  big ints (500 digits), "-0", "1e-400" (=> 0.0?), lone surrogates "\\ud800" (accepted? then len()?),
  "\\u0000" in strings and in KEYS, huge exponents, "1.0000000000000000000001".
- PRECISION: cases where Python's exact int arithmetic differs from IEEE doubles - find instance/schema pairs where
  a naive JS implementation using Number would print a DIFFERENT count. Try maximum/minimum/multipleOf/enum/const/
  uniqueItems with integers > 2^53 (e.g. 9007199254740993 vs 9007199254740992, 2^63, 10^30+1 vs 10^30),
  and floats with 17+ significant digits. Also mixed int/float comparisons (10^23 vs 1e23 - are they equal in enum?
  is 10^23 <= 1e23?) - Python compares int-vs-float EXACTLY, doubles do not.
- Duplicate object keys in both instance and schema (last wins?), including duplicate keys in "properties".
Report every case where BigInt-style exact arithmetic is REQUIRED to match, with the exact numbers.`,
  },
  {
    key: 'nesting-multiplicity',
    focus: `How error counts multiply/collapse through deep structures. The implementer needs the exact propagation rule.
- Build schemas 3-6 levels deep (properties > items > properties > allOf > properties) where each level contributes
  failures; verify the total is the sum of leaf errors, and identify every construct that COLLAPSES a subtree to 1 error
  (anyOf/oneOf/not/contains/additionalProperties:false/uniqueItems/enum/const - confirm each) versus PASSES THROUGH
  (properties/items/allOf/if-then-else/$ref/patternProperties/additionalProperties-as-schema/propertyNames/dependencies-as-schema/
  additionalItems-as-schema/definitions-via-ref).
- A single instance + schema producing a LARGE count (20-60 errors) — confirm the exact number and that nothing is deduped
  or capped. Try an array of 30 wrong-typed items; an object with 25 missing required; both at once.
- Sibling keywords at the same level all failing: does each contribute independently (type + enum + minimum + maxLength
  + required + minItems on one instance)?
- Same subschema reached twice (via $ref used in two places) => errors counted twice?
- An error inside a collapsing construct that also fails a sibling: e.g. {"anyOf":[...], "type":"string", "minLength":9}.
- Does keyword ORDER in the schema JSON change the count? (It shouldn't - confirm with reordered duplicates.)
- Very wide: 100 properties each failing => 100?`,
  },
  {
    key: 'exceptions-exit-codes',
    focus: `Every way the program can CRASH (nonzero exit) instead of printing a count. The JS port must fail on exactly
these inputs and succeed on all others, so the boundary must be mapped precisely.
Known crashers to confirm and then GENERALIZE: schema=5, {"type":"bogus"}, {"pattern":"["}, {"multipleOf":0},
instance NaN with {"multipleOf":2.0}, {"$ref":"http://example.com/x"}, {"$ref":"#/nope"}.
Probe systematically (report exit code for each):
- multipleOf: 0, 0.0, -0.0, NaN, Infinity, "2" (string), null, true, [] , {} — with number and non-number instances.
- Instance NaN/Infinity with multipleOf integer vs float divisor (the int path uses % and the float path uses int(quotient) —
  find which combinations throw).
- maximum/minimum/exclusive* with non-numeric values ("5", null, [], true) and numeric instances (TypeError?);
  what if the instance is a non-number (skipped before the comparison)?
- maxLength/minLength/maxItems/minItems/maxProperties/minProperties with non-numeric values, and with matching-type instances.
- type: unknown names, non-string entries (5, null, {}, []), nested arrays, empty array, duplicate names.
- required: non-array value ("a", {}, 5), non-string entries (5, null) with object instances.
- enum/const: non-array enum (5, {}, "abc" — does "abc" iterate as chars?); properties/patternProperties whose value is
  not an object (5, [], null, true); items:5 / items:null; dependencies value 5 / null; propertyNames:5; allOf:5; not:5;
  anyOf:{} ; if:5. Which are silently ignored, which raise?
- $ref: missing pointer, non-string $ref (5, [], null), remote http/https/file URLs, "#/definitions" pointing at a
  non-schema, self-recursive "#" (RecursionError?), deeply/mutually recursive refs, "urn:" refs, relative "x.json".
- uniqueItems with weird values; contains:5 ; additionalItems:5 ; propertyNames:true.
- Anything that raises inside a COLLAPSING construct (e.g. {"anyOf":[{"multipleOf":0}]}) — does the exception escape?
Give the implementer a crisp rule set: which schema shapes must throw.`,
  },
]

phase('Probe')

const results = await pipeline(
  FAMILIES,
  (f) =>
    agent(
      `${PREAMBLE}\n\nYOUR FAMILY: ${f.key}\nFILE: /workspace/probe/cases/${f.key}.json\n\nFOCUS:\n${f.focus}`,
      { label: `probe:${f.key}`, phase: 'Probe', schema: SPEC_SCHEMA },
    ),
  (spec, f) => {
    if (!spec) return null
    return agent(
      `${PREAMBLE}\n\nYou are the COMPLETENESS CRITIC for family "${f.key}". Another agent already probed it and wrote
/workspace/probe/cases/${f.key}.json (observed results in /workspace/probe/observed/${f.key}.json).

Their report:
RULES:
${spec.rules.map((r) => '- ' + r).join('\n')}
GOTCHAS:
${spec.gotchas.map((r) => '- ' + r).join('\n')}
EXCEPTIONS:
${spec.exceptionCases.map((r) => '- ' + r).join('\n')}

Original focus list for this family:
${f.focus}

YOUR JOB — be adversarial, assume their report is incomplete or wrong:
1. Read their case file. Find what the focus list asked for that they did NOT actually test, and any rule they stated
   that their cases do not actually prove (over-generalization). Numeric/precision/unicode/exception boundaries are the
   usual blind spots.
2. Independently RE-VERIFY their 5 most surprising or load-bearing claims by running the executable yourself. If a
   claim is wrong, say so loudly in your rules with the disproving case.
3. Author /workspace/probe/cases/${f.key}-x.json with 30-80 NEW decisive cases covering the gaps and the boundaries
   (especially: off-by-one boundaries, type-skipping, the exception/no-exception frontier, and anything where a naive
   JS port would silently differ). Run it through the harness: node /workspace/probe/harness.mjs /workspace/probe/cases/${f.key}-x.json
4. Report the MERGED, corrected rule set for this family (yours + theirs, corrections applied), with corpusPath
   "/workspace/probe/observed/${f.key}.json,/workspace/probe/observed/${f.key}-x.json" and caseCount = total cases across both.
Your rules list is the specification the implementer will code against. Make it complete, ordered, and unambiguous.`,
      { label: `extend:${f.key}`, phase: 'Extend', schema: SPEC_SCHEMA },
    )
  },
)

const specs = results.filter(Boolean)
log(`probed ${specs.length}/${FAMILIES.length} families, ${specs.reduce((n, s) => n + (s.caseCount || 0), 0)} cases total`)
return specs
