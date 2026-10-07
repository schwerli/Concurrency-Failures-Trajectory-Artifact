export const meta = {
  name: 'jsonschema-spec-probe',
  description: 'Black-box probe the Python jsonschema executable to produce precise behavioral specs per domain',
  phases: [
    { title: 'Probe', detail: 'parallel domain probes against the reference executable' },
    { title: 'Critic', detail: 'completeness critic over the gathered specs' },
  ],
}

const PREAMBLE = `
You are reverse-engineering, BY BLACK-BOX PROBING ONLY, the exact behavior of this Python program
(/workspace/dataset/test2.py), compiled to the executable /workspace/dataset/test2_executable:

    import argparse, json, jsonschema
    from jsonschema import ValidationError
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True, help='instance data (JSON string)')
    parser.add_argument('--b', type=str, required=True, help='schema (JSON string)')
    args = parser.parse_args()
    instance = json.loads(args.a); schema = json.loads(args.b)
    try:
        jsonschema.validate(instance, schema)
        print("valid")
    except ValidationError as e:
        print(e.message)

GOAL: someone else will reimplement this in pure Node.js ESM with ZERO dependencies, and stdout +
exit code must match CHARACTER FOR CHARACTER. Your job is to produce the definitive spec for YOUR
domain so they never have to guess.

HARD RULES:
- Do NOT run python. Do NOT look for or read jsonschema/CPython source. Probe the executable only.
- Do NOT write anything to /output. Scratch files go in /tmp only.
- Known baseline facts (already established, don't re-derive): default dialect is Draft 2020-12
  (no $schema -> prefixItems works, "items" as an array is a SchemaError); the "format" keyword is
  NEVER validated at instance-validation time; a SchemaError or a json.loads failure prints NOTHING
  to stdout and exits 1 (traceback on stderr); success prints "valid\\n"; a ValidationError prints
  e.message + "\\n" and exits 0.

TOOLING: use the harness /tmp/probe.mjs to avoid shell-quoting pain (node v18 is available):
    write /tmp/<you>.json  = [{"a": "<instance JSON text>", "b": "<schema JSON text>"}, ...]
    node /tmp/probe.mjs /tmp/<you>.json
  It prints, per case, "rc=<exit code> stdout=<JSON-quoted exact stdout>" plus the last stderr line.
  For raw-argv probes: node /tmp/probe.mjs --argv /tmp/<you>.json  where the file is [["--a","1",...], ...].
  Run MANY cases per invocation (batches of 40-80 are fine and fast).

DELIVERABLE:
1. Write a thorough spec to {SPECFILE} in Markdown. It must contain: (a) exact message TEMPLATES with
   placeholders explained, (b) a table of concrete probe cases -> exact observed stdout (JSON-quoted)
   and exit code, covering normal AND edge cases, (c) explicit statements of any ordering, sorting,
   selection, or precision rule you established, (d) a "still uncertain" section listing anything you
   could not pin down. Be exhaustive; this file is the implementation contract. Include at least 60
   probed cases.
2. Return (as your final text / structured output) a COMPACT summary: the rules an implementer must
   know, in <= 60 lines. Do not paste the whole table into your reply; it lives in the file.
Probe adversarially: try to find the case where the naive assumption breaks.
`

const SCHEMA = {
  type: 'object',
  properties: {
    specFile: { type: 'string' },
    caseCount: { type: 'integer' },
    rules: { type: 'array', items: { type: 'string' }, description: 'Concise implementation rules, each self-contained' },
    surprises: { type: 'array', items: { type: 'string' }, description: 'Counter-intuitive behaviors a naive implementer would get wrong' },
    uncertain: { type: 'array', items: { type: 'string' } },
  },
  required: ['specFile', 'caseCount', 'rules', 'surprises', 'uncertain'],
}

const DOMAINS = [
  {
    key: 'argparse',
    file: '/tmp/spec/argparse.md',
    task: `DOMAIN: argparse emulation (the CLI layer), exit codes, and stdout/stderr routing.
Pin down EXACTLY, using raw-argv probes:
- \`--help\` and \`-h\` output (character for character, including the "usage:" line, blank lines, the
  "options:" section header, and column alignment of the help strings) and its exit code/stream.
- Missing one or both required args; unrecognized arguments; an option with no value; extra positional
  args; empty-string values; a value that looks like an option (e.g. --a --b); "--a=VALUE" form;
  repeated "--a" (which wins); the "--" separator; values starting with "-" or "-5"; option
  abbreviation/prefix matching (is "-a" accepted? is "--" + partial name accepted? note only --a/--b/-h exist);
  a value that is a negative number; interleaved order (--b before --a); unicode values.
- For every failing case: exact stderr text, exact stdout (usually empty), exact exit code.
- The program name shown in usage/error messages (it is "test2_executable" for the binary; state the rule
  so the JS version can hardcode the right thing) — note the JS entry file will be /output/test2.mjs and
  must reproduce the SAME strings as the executable.
Note: stderr almost certainly is NOT compared by the grader, but exit codes and stdout ARE — still,
record stderr verbatim so the implementer can match it if cheap.`,
  },
  {
    key: 'pyrepr',
    file: '/tmp/spec/pyrepr.md',
    task: `DOMAIN: Python repr() formatting of JSON values as it appears inside error messages.
Use a schema that always fails and echoes the instance, e.g. {"type":"null"} or {"const":"__x__"} /
{"enum":[]} etc., to observe repr of arbitrary instances; and schemas like {"not":{...}} to observe
repr of SCHEMA objects (dicts) inside messages.
Pin down: string quoting rule (when ' vs " is used; what about a string containing both quote kinds),
escaping of \\n \\t \\r \\\\ \\0 other control chars, DEL, non-ASCII printable (é, 中, emoji),
combining marks, non-printable unicode (\\u0085, \\u00ad, \\u200b, \\u2028, RTL marks), astral-plane chars,
lone surrogates via \\ud800 escapes; int repr including huge ints and negatives; float repr including
1.0, -0.0, 1e16, 1e17, 1e-5, 1e-4, 0.1+0.2-style values, 1e400 (inf), -1e400, very small denormals,
integers-with-exponent like 1e2 (is it 100.0?), 2e-1; bool/None; empty list/dict; nested containers and
their separators (", " and ": "); dict key ordering (insertion vs sorted); duplicate JSON keys;
non-string-safe keys.
Also: does the message ever wrap/truncate for very long values? Probe a 10KB string and a 1000-element
list. Report the exact rule.`,
  },
  {
    key: 'pyjson',
    file: '/tmp/spec/pyjson.md',
    task: `DOMAIN: json.loads acceptance/rejection semantics for the --a and --b strings (which inputs
exit 1 with a JSONDecodeError vs. parse successfully), and the int-vs-float distinction that survives
into validation.
Pin down: NaN / Infinity / -Infinity (accepted by Python json!); leading "+"; leading zeros; ".5"; "5.";
"1e"; hex; single quotes; trailing commas; trailing/leading whitespace and newlines/tabs; empty string;
duplicate object keys (which wins); \\uXXXX escapes incl. surrogate pairs and LONE surrogates (\\ud800
alone — accepted? what does it repr as?); literal control characters inside strings (rejected?);
literal tab inside a string; a BOM prefix; very deep nesting (recursion limit? probe ~1200 deep);
huge integers (arbitrary precision preserved?); integer-vs-float: 1 vs 1.0 vs 1e2 vs 1E2 vs 1.0e2 —
which are Python ints and which are floats (detect via repr in an error message and via
{"type":"integer"} validation); float overflow 1e400 -> inf; underflow 1e-400 -> 0.0; "-0";
"-0.0". Also: is the TOP-LEVEL allowed to be a scalar (5, "x", true, null)? Empty --a ""?
Report which inputs give rc=1 with empty stdout.`,
  },
  {
    key: 'types-equality',
    file: '/tmp/spec/types-equality.md',
    task: `DOMAIN: the "type" keyword's type checker and the equality relation used by enum/const/uniqueItems.
Pin down with probes:
- Which JSON values satisfy each of: null, boolean, object, array, number, integer, string. Especially:
  is true/false a "number"/"integer"? is 1.0 an "integer" (yes) and is 1.5? is a huge int an integer?
  is inf/nan a number/integer? does "integer" accept 1e2? does -0.0 count?
- The exact message for a single type vs a list of types, incl. type list ordering and repr of each name,
  a 1-element list, and duplicate entries. Does the message reuse the schema's order?
- Equality used by const/enum/uniqueItems: does 1 equal 1.0? does true equal 1? does false equal 0?
  does 0 equal -0.0? does 1 equal a big int written as 1.0000000000000000001? nested list/dict equality;
  key order irrelevance for dicts; string vs number; null vs false. Probe each with BOTH const and enum
  and uniqueItems (e.g. --a "[1,1.0]" --b '{"uniqueItems":true}' , --a "[true,1]" ...).
- The exact "is not one of [...]" rendering for enum (repr of the whole list) and "X was expected" for const.
- Does enum/const short-circuit before type checking? Ordering of errors when both type and enum fail.`,
  },
  {
    key: 'kw-numbers-strings',
    file: '/tmp/spec/kw-numbers-strings.md',
    task: `DOMAIN: numeric and string keywords. minimum, maximum, exclusiveMinimum, exclusiveMaximum,
multipleOf, minLength, maxLength, pattern (and format, to confirm it is inert).
Pin down exact message templates AND edge behavior:
- Are booleans exempt from numeric keywords? Are strings exempt? Is a number exempt from minLength?
- minLength:1 and maxLength:0 — is there a special "should be non-empty" style message? Same question
  for minItems:1/maxItems:0 (probe them here too if cheap).
- minLength counts unicode CODE POINTS (probe with astral emoji: "\\ud83d\\ude00" is 1 code point in
  Python but 2 UTF-16 units in JS — CRITICAL for the JS implementer). Same for maxLength.
- multipleOf: integer and float divisors; 0.0001-style precision cases (e.g. 4.5 multipleOf 1.5,
  0.0075 multipleOf 0.0001, 1e308 multipleOf 1e-308, huge ints); multipleOf 0 (error? which kind?);
  negative multipleOf; the exact message repr of both numbers (e.g. is it "5 is not a multiple of 2"
  or with floats "5.5 is not a multiple of 2.0").
- minimum/maximum with mixed int/float and with huge ints beyond float precision.
- pattern: Python re.search semantics (partial match, ^ $ anchoring, multiline off by default), and
  Python-only regex syntax the JS implementer must translate or handle: \\d \\w \\s unicode semantics,
  \\A \\Z, (?P<name>...), (?P=name), (?#comment), inline flags (?i) / (?im) and mid-pattern flags,
  possessive/atomic groups, backreferences, [[:alpha:]], \\b, lookbehind, {,3} form, unescaped "]" or "{",
  and an INVALID regex (e.g. "(" or "*x" or "[z-a]") -> which exit code / stream? Also whether the
  pattern is applied to non-strings. Report exactly what the JS side must translate.`,
  },
  {
    key: 'kw-objects',
    file: '/tmp/spec/kw-objects.md',
    task: `DOMAIN: object keywords. properties, patternProperties, additionalProperties, required,
dependentRequired, dependentSchemas, propertyNames, minProperties, maxProperties, plus
unevaluatedProperties.
Pin down exact messages and, critically, ORDERING and SELECTION:
- "Additional properties are not allowed (...)" with 1, 2, 3+ extras: are the names in instance
  insertion order or sorted? what is the separator and the singular/plural verb ("was"/"were")?
- required with several missing: which one surfaces (the program prints only ONE message)? Is it the
  first in the schema's required array or the first missing? Probe with reordered arrays.
- The interaction/priority when several object keywords fail at once (e.g. required + additionalProperties
  + a failing property subschema at depth). Which message wins? Probe a matrix of at least 12 combos.
- unevaluatedProperties: exact message, and which properties count as "evaluated" — via properties,
  patternProperties, additionalProperties, $ref, allOf, anyOf (do properties from FAILING anyOf branches
  count?), oneOf, if/then/else (when if fails, does the if-branch's properties still count?),
  dependentSchemas, not, and nested unevaluatedProperties. This is subtle: probe each combination and
  state the rule precisely. Also unevaluatedProperties as a SCHEMA (not just false).
- propertyNames failure message (it reports the key as the instance), minProperties/maxProperties
  including the 1-property special case wording.
- patternProperties with an invalid regex; additionalProperties: true/{} ; properties whose subschema
  is false.`,
  },
  {
    key: 'kw-arrays',
    file: '/tmp/spec/kw-arrays.md',
    task: `DOMAIN: array keywords. prefixItems, items, contains, minContains, maxContains, minItems,
maxItems, uniqueItems, unevaluatedItems.
Pin down exact messages and edge cases:
- items:false with prefixItems -> "Expected at most N item(s) but found M extra: ..." — probe the exact
  singular/plural forms and the rendering of the extras list for 1, 2, and 5 extras, and with N=0
  (no prefixItems, items:false), and with non-scalar extras (objects/strings — repr'd how? separator?).
- unevaluatedItems: exact message with 1 vs many unexpected items, and the evaluation rules (prefixItems,
  items, contains — do contains-matched indices count as evaluated? — allOf, anyOf with failing branches,
  if/then/else, $ref, nested unevaluatedItems).
- contains with minContains:0 (does an empty array pass? does contains still need a match?), maxContains
  with 0, minContains > maxContains, and the exact wording of all three contains-family messages incl.
  the counts.
- uniqueItems message and what counts as duplicate (1 vs 1.0 vs true; nested containers; {"a":1} vs
  {"a":1.0}; key order).
- minItems/maxItems special-case wording at 1 and 0; whether these apply to strings/objects.
- Which array-keyword error wins when several fail at once (probe at least 10 combinations).`,
  },
  {
    key: 'applicators-bestmatch',
    file: '/tmp/spec/applicators-bestmatch.md',
    task: `DOMAIN (the most important one): the applicator keywords allOf/anyOf/oneOf/not/if-then-else AND
the error-SELECTION algorithm (jsonschema's best_match + relevance), since the program prints exactly
ONE message chosen from potentially many errors.
Pin down:
- Exact messages: anyOf/oneOf all-fail; oneOf multiple-match (note: observed
  "1 is valid under each of {'type': 'number'}, {'type': 'integer'}" for
  oneOf:[{"type":"integer"},{"type":"number"}] — determine the EXACT rule for WHICH two schemas are named
  and in what order, by probing oneOf arrays of length 3, 4, and 5 with different match positions, e.g.
  matches at indices {0,1}, {0,2}, {1,2}, {0,1,2}, {0,3} with a non-matching schema last, etc. State a
  deterministic rule); not; if/then and if/else; nested applicators.
- SELECTION RULES. Construct probes where several errors compete and determine the ordering key. Test:
  (a) deeper instance path beats shallower (e.g. {"a":{"b":1}} with a failing top-level keyword AND a
      failing deep one);
  (b) among equal depth, which sibling wins (first by path? probe keys "a" vs "b" and array indices 0 vs 1,
      and a case where the schema lists them in reverse order);
  (c) whether errors from anyOf/oneOf are DE-PRIORITIZED versus other keywords at the same depth
      (probe: a schema with both a failing "anyOf" and a failing sibling keyword like "type" or "required");
  (d) whether an error whose instance is an OBJECT is de-prioritized versus one whose instance is a
      scalar at the same depth/path;
  (e) how the algorithm recurses into the sub-errors ("context") of anyOf/oneOf: which sub-error is
      shown, and is the tie-break the same or INVERTED at that level (probe an anyOf whose branches fail
      at different depths, e.g. anyOf:[{"type":"string"},{"properties":{"a":{"properties":{"b":{"type":"string"}}}}}]);
  (f) whether path comparison can mix int and str (array index vs object key at the same depth) and
      whether that CRASHES the program (rc=1) — probe e.g. an instance/schema where two sibling errors
      have paths [0] and ["a"] at the same depth... construct it via anyOf or via a top-level union.
Write the resulting selection algorithm as explicit pseudocode in the spec file, then VERIFY the
pseudocode by predicting the output of 15 fresh adversarial probes before running them; report the
prediction accuracy in the spec file. Iterate until your pseudocode predicts correctly.`,
  },
  {
    key: 'refs',
    file: '/tmp/spec/refs.md',
    task: `DOMAIN: reference resolution. $ref, $id, $anchor, $dynamicRef, $dynamicAnchor, $defs,
definitions, JSON-Pointer escaping, and recursion.
Pin down:
- $ref to "#/$defs/x", "#/definitions/x", "#" (root, self-recursive), "#/properties/a", pointers with
  escapes ("~0", "~1", "%25", spaces, unicode keys), out-of-range array pointers, and a pointer to a
  NON-EXISTENT location -> what happens (rc? stdout? which exception)?
- $ref to an absolute external URL (e.g. "https://example.com/s.json") -> does it attempt a network
  fetch? rc/stdout/time? What about "http://json-schema.org/draft-07/schema#" (a well-known one that may
  be bundled)? And $ref to the 2020-12 metaschema URI?
- $id changing the base URI, relative $ref resolution against it, $ref to a sibling $id'd subschema,
  $anchor + "#name" refs, and $id inside $defs.
- Does a sibling keyword next to $ref still apply (2020-12 says yes)? Probe {"$ref":"#/$defs/x","type":"string"}.
- $dynamicRef/$dynamicAnchor: basic recursive-extension behavior; and $recursiveRef/$recursiveAnchor
  (2019-09 spelling) under the 2020-12 dialect — ignored or honored?
- Infinite recursion (a $ref cycle with no instance progress) -> RecursionError? rc?
- What error message surfaces from inside a $ref'd subschema (does the path/relevance change?).
- Also probe the $schema keyword: which dialect URIs are recognized (draft-03/04/06/07/2019-09/2020-12,
  with and without trailing "#", http vs https), whether an UNKNOWN $schema URI errors (rc?), and
  briefly whether behavior actually changes per dialect (e.g. "items" as an array, exclusiveMinimum:true,
  "dependencies", "$defs" vs "definitions"). Report which dialects the JS implementer must support.`,
  },
  {
    key: 'checkschema',
    file: '/tmp/spec/checkschema.md',
    task: `DOMAIN: schema validation (jsonschema.validate calls check_schema first). Determine EXACTLY
which schemas are rejected before any instance validation (stdout empty, rc=1) and which are accepted.
Probe at least 70 schemas, including:
- Non-object/boolean schemas: "x", 5, null, [], [{}] ; true and false as the whole schema; {} .
- Wrong-typed keyword values: type:"foo"; type:5; type:[]; type:["string","string"] (uniqueItems!);
  required:"a"; required:[1]; required:["a","a"]; minimum:"1"; minimum:true; minLength:-1; minLength:1.5;
  minLength:1.0; maxItems:-1; multipleOf:0; multipleOf:-1; exclusiveMinimum:true (draft4 spelling);
  items:[{}] (known SchemaError); additionalItems (unknown keyword — allowed?); properties:[];
  properties:{"a":5}; enum:5; enum:[] (allowed in 2020-12?); const (any value ok); pattern:5;
  pattern:"(" (INVALID REGEX — is the metaschema's "format":"regex" enforced by check_schema? THIS IS
  IMPORTANT); format:5; $ref:5; $id:5; $id:"#frag"; $id:"http://x/#f" (non-empty fragment); $anchor:"1bad";
  $defs:5; $comment:5; dependentRequired:{"a":"b"}; contains:5; minContains:-1; unknown keyword "foo":5.
- Nested invalidity: a bad subschema inside properties/items/allOf/$defs — is it caught?
- If pattern:"(" is NOT a SchemaError, determine what happens at validation time (rc/stdout).
- Unknown/absent $schema, and $schema with a bogus URI.
For every case report: rc, exact stdout, and the FIRST line of the SchemaError message from stderr
(the "jsonschema.exceptions.SchemaError: ..." line) so the implementer can approximate it.
Deliver a crisp decision procedure: "reject iff the schema fails the 2020-12 metaschema, where the
metaschema enforces X, Y, Z (and format-assertion is on/off)".`,
  },
  {
    key: 'misc-stress',
    file: '/tmp/spec/misc-stress.md',
    task: `DOMAIN: everything else + stress. Cover:
- Unknown keywords are ignored; keyword applicability by instance type (e.g. "minimum" on a string,
  "required" on an array) — all no-ops.
- Empty schema {} / true / false as schema (message for false schema? probe --b "false").
- Boolean subschemas nested in properties/items/prefixItems/anyOf: {"properties":{"a":false}} etc.,
  and the exact message a "false" subschema produces at depth.
- Very large instances (10k-element array with a failure at the end): message truncation? runtime?
- Deep nesting (300 levels) -> RecursionError? rc?
- Unicode in property names and in messages (does stdout use UTF-8? probe emoji + CJK in a property name
  that shows up in "Additional properties are not allowed (...)").
- Instances/schemas containing NaN/Infinity (Python json accepts them) fed to minimum/maximum/multipleOf/
  enum/const/uniqueItems/type — what happens? Any crash (rc=1)?
- Trailing newline: confirm stdout is exactly the message + "\\n" and nothing else, for a few cases
  (use the JSON-quoted stdout from the harness).
- Exit code for the ValidationError path (0) and for "valid" (0).
- Whether stdout is line-buffered/flushed differently when piped (irrelevant but confirm no CR).
- Any message that contains a NEWLINE or is multi-line (e.g. long schema reprs in "should not be valid
  under ..." messages) — probe "not" with a big nested schema and report whether the repr is
  pretty-printed/wrapped or single-line.`,
  },
]

phase('Probe')
const results = await parallel(DOMAINS.map(d => () =>
  agent(PREAMBLE.replace('{SPECFILE}', d.file) + '\n\n' + d.task, {
    label: `probe:${d.key}`,
    phase: 'Probe',
    schema: SCHEMA,
  }).then(r => ({ key: d.key, file: d.file, ...(r || {}) }))
))

const ok = results.filter(Boolean)
log(`gathered ${ok.length} domain specs`)

phase('Critic')
const critic = await agent(
  `Read every file in /tmp/spec/*.md (they are black-box behavioral specs for a Python jsonschema CLI that
must be reimplemented in dependency-free Node.js ESM, matching stdout character-for-character and exit
codes exactly). The reference executable is /workspace/dataset/test2_executable and the harness
/tmp/probe.mjs works as: node /tmp/probe.mjs cases.json where cases.json is [{"a":"<instance json>","b":"<schema json>"}].

Your job: be the COMPLETENESS CRITIC.
1. Identify CONTRADICTIONS between specs, and resolve each by running your own probes.
2. Identify GAPS: behaviors an implementer would still have to guess. Probe the most important 25 of them
   yourself and record answers.
3. Identify claims that are asserted without probe evidence and spot-check the 15 riskiest ones.
Write your findings to /tmp/spec/00-critic.md (contradictions resolved, gaps filled with evidence,
claims that failed spot-check). Return a compact list of the corrections and newly-established rules that
the implementer MUST know — be specific and include the probe evidence inline for each.`,
  { label: 'critic:completeness', phase: 'Critic' },
)

return { specs: ok, critic }
