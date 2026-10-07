export const meta = {
  name: 'port-pyyaml-to-mjs',
  description: 'Port the PyYAML load and dump pipelines to zero-dependency ESM modules',
  phases: [
    { title: 'Port', detail: 'one agent per module group, writing into /output/lib' },
    { title: 'Fidelity review', detail: 'adversarial re-read of each port against PyYAML semantics' },
  ],
}

const COMMON = `
You are porting PyYAML to zero-dependency JavaScript ESM.

FIRST: read /workspace/spec/PORTING.md in full. It defines the hard constraints
(no RegExp, no JSON, no external imports, .mjs suffixes, never write a
backslash-u escape into a file), the mixin composition pattern, and the exact
API of the already-written foundation modules in /output/lib/
(chars.mjs, errors.mjs, pytypes.mjs, tokens.mjs, events.mjs, nodes.mjs).
Read those foundation files too — import from them, never duplicate them.

Ground truth is the reference binary. Run it to check behaviour whenever you are
unsure:  /workspace/dataset/test4_executable --a '<yaml text>'
It is PyYAML 6.0-era. Do NOT run python. Do NOT read or write any file outside
/output/lib except to read /workspace/spec/PORTING.md and /workspace/dataset/test4.py.

Port FAITHFULLY: same method decomposition as PyYAML, same control flow, same
error strings, same edge cases. This is a transcription task, not a redesign.
Every PyYAML regex must become an explicit character-scanning matcher; put the
original pattern in a comment above it.

Write ONLY the files assigned to you. Other agents are concurrently writing the
sibling modules; do not create, modify, or stub them. Assume every method listed
in the cross-module contract table in PORTING.md exists on 'this'.

When done, verify your file at least parses:
  node --input-type=module -e "import('/output/lib/YOURFILE.mjs').then(()=>console.log('ok'),e=>{console.error(e);process.exit(1)})"
(An import error naming a sibling module that does not exist yet is expected and
fine; a SyntaxError in your own file is not.)
Then self-check the constraints:
  grep -nE "require\\(|module\\.exports|JSON\\.|new RegExp|\\.match\\(|\\.matchAll\\(" /output/lib/YOURFILE.mjs
  grep -n "u00\\|u20\\|u{" /output/lib/YOURFILE.mjs   # no backslash-u escapes
Fix anything that turns up.

Return a terse report: what you wrote, and any place you were unsure of PyYAML's
exact behaviour (those become follow-up checks).
`

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'summary', 'uncertainties'],
  additionalProperties: false,
}

const MODULES = [
  {
    key: 'reader+scanner',
    files: 'reader.mjs and scanner.mjs',
    body: `
Write /output/lib/reader.mjs (export ReaderMixin) and /output/lib/scanner.mjs
(export ScannerMixin) — ports of PyYAML's reader.py and scanner.py.

reader.mjs — the input is ALWAYS a JS string (the --a argument), so only
PyYAML's 'isinstance(stream, str)' branch matters:
- name = "<unicode string>".
- check_printable BEFORE buffering. PyYAML's NON_PRINTABLE pattern is
  [^\\x09\\x0A\\x0D\\x20-\\x7E\\x85\\xA0-\\uD7FF\\uE000-\\uFFFD\\U00010000-\\U0010ffff]
  i.e. reject anything not in that allowed set. On a hit raise
  ReaderError(name, position, character, 'unicode', "special characters are not allowed")
  where position is the code-point index of the offending character.
- buffer = the input PLUS a trailing '\\0' sentinel, stored as an ARRAY OF
  SINGLE-CODE-POINT STRINGS (use [...text] so astral characters count as one,
  exactly like Python str indexing). index/line/column/pointer all count code
  points. Mark receives this array as its buffer.
- peek(i=0) returns buffer[pointer+i], or '\\0' if that is past the end.
  prefix(n=1) returns the joined slice, clamped at the end.
  forward(n=1) advances, incrementing line and zeroing column on
  LF/NEL/LS/PS or on a CR not followed by LF, and incrementing column for any
  other character except the BOM.
  getMark() returns new Mark(name, index, line, column, buffer, pointer).

scanner.mjs — a complete port of PyYAML's Scanner: the tokens/indents/
possible_simple_keys machinery plus every method:
  checkToken/peekToken/getToken, needMoreTokens, fetchMoreTokens,
  nextPossibleSimpleKey, stalePossibleSimpleKeys, savePossibleSimpleKey,
  removePossibleSimpleKey, unwindIndent, addIndent,
  fetchStreamStart, fetchStreamEnd, fetchDirective, fetchDocumentStart,
  fetchDocumentEnd, fetchDocumentIndicator, fetchFlowSequenceStart,
  fetchFlowMappingStart, fetchFlowCollectionStart, fetchFlowSequenceEnd,
  fetchFlowMappingEnd, fetchFlowCollectionEnd, fetchFlowEntry,
  fetchBlockEntry, fetchKey, fetchValue, fetchAlias, fetchAnchor, fetchTag,
  fetchLiteral, fetchFolded, fetchBlockScalar, fetchSingle, fetchDouble,
  fetchFlowScalar, fetchPlain,
  checkDirective, checkDocumentStart, checkDocumentEnd, checkBlockEntry,
  checkKey, checkValue, checkPlain,
  scanToNextToken, scanDirective, scanDirectiveName, scanYamlDirectiveValue,
  scanYamlDirectiveNumber, scanTagDirectiveValue, scanTagDirectiveHandle,
  scanTagDirectivePrefix, scanDirectiveIgnoredLine, scanAnchor, scanTag,
  scanBlockScalar, scanBlockScalarIndicators, scanBlockScalarIgnoredLine,
  scanBlockScalarIndentation, scanBlockScalarBreaks, scanFlowScalar,
  scanFlowScalarNonSpaces, scanFlowScalarSpaces, scanFlowScalarBreaks,
  scanPlain, scanPlainSpaces, scanTagHandle, scanTagUri, scanUriEscapes,
  scanLineBreak.
Use SCAN_ESCAPES / SCAN_ESCAPE_CODES from chars.mjs for double-quoted escapes
(note PyYAML 5.4+ also accepts \\/ — the table already includes it). scanUriEscapes
must decode percent-escaped UTF-8 byte sequences into characters.
Reproduce PyYAML's ScannerError messages verbatim, e.g.
 "while scanning for the next token" / "found character '@' that cannot start any token",
 "mapping values are not allowed here",
 "while scanning a block scalar" / "expected a comment or a line break, but found ...".

Behaviours to verify against the binary once you are done reasoning:
  '- 1'   '[1,2]'   'a: b'   '? k\\n: v'   '|\\n  x'   '>\\n  x'   '"a\\\\tb"'
  '!!str x'   '&a x'   '*a'   '%YAML 1.1\\n--- x'   'a: b\\n c: d' (must error)
`,
  },
  {
    key: 'parser',
    files: 'parser.mjs',
    body: `
Write /output/lib/parser.mjs exporting ParserMixin — a port of PyYAML's parser.py.

Include DEFAULT_TAGS ({'!': '!', '!!': 'tag:yaml.org,2002:'}), the state-machine
fields (currentEvent, yamlVersion, tagHandles, states, marks, state), and every
method: checkEvent/peekEvent/getEvent, parseStreamStart,
parseImplicitDocumentStart, parseDocumentStart, parseDocumentEnd,
parseDocumentContent, processDirectives, parseBlockNode, parseFlowNode,
parseBlockNodeOrIndentlessSequence, parseNode, parseBlockSequenceFirstEntry,
parseBlockSequenceEntry, parseIndentlessSequenceEntry,
parseBlockMappingFirstKey, parseBlockMappingKey, parseBlockMappingValue,
parseFlowSequenceFirstEntry, parseFlowSequenceEntry,
parseFlowSequenceEntryMappingKey, parseFlowSequenceEntryMappingValue,
parseFlowSequenceEntryMappingEnd, parseFlowMappingFirstKey,
parseFlowMappingKey, parseFlowMappingValue, parseFlowMappingEmptyValue,
processEmptyScalar.

Reproduce ParserError messages verbatim, including the ones that quote a token
id, e.g.:
  "while parsing a flow sequence" + "expected ',' or ']', but got '<stream end>'"
  "while parsing a block collection" + "expected <block end>, but found '...'"
  "expected '<document start>', but found '...'"
  "found undefined tag handle '...'" / "while parsing a node"
The quoted token spelling is the token's '.id' property from tokens.mjs.

Verify against the binary: '[1, 2' , '{a: 1' , '--- a\\n--- b' ,
'!<tag:yaml.org,2002:str> s' , '!x y' , 'a: 1\\nb:\\n- 1'.
`,
  },
  {
    key: 'resolver+composer',
    files: 'resolver.mjs and composer.mjs',
    body: `
Write /output/lib/resolver.mjs (export ResolverMixin) and /output/lib/composer.mjs
(export ComposerMixin) — ports of PyYAML's resolver.py and composer.py.

resolver.mjs is the piece where PyYAML's regexes MUST become hand-written
matchers. Registration order matters: PyYAML registers bool, float, int, merge,
null, timestamp, value, yaml in that order, bucketed by first character, and
resolve() tries the bucket for value[0] (or the '' bucket when value is empty)
in registration order, then the null-key bucket. Implement that exact structure:
a Map from first character to an ordered list of {tag, match} entries.

The patterns (anchored ^...$, verbatim from PyYAML, re.X whitespace stripped):
  bool  first chars 'yYnNoOtTfF'
        yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF
  float first chars '-+0123456789.'
        [-+]?([0-9][0-9_]*)\\.[0-9_]*([eE][-+][0-9]+)?
        |\\.[0-9_]+([eE][-+][0-9]+)?
        |[-+]?[0-9][0-9_]*(:[0-5]?[0-9])+\\.[0-9_]*
        |[-+]?\\.(inf|Inf|INF)
        |\\.(nan|NaN|NAN)
        NOTE the exponent REQUIRES an explicit sign, so '1.5e3' is NOT a float.
  int   first chars '-+0123456789'
        [-+]?0b[0-1_]+ | [-+]?0[0-7_]+ | [-+]?(0|[1-9][0-9_]*)
        | [-+]?0x[0-9a-fA-F_]+ | [-+]?[1-9][0-9_]*(:[0-5]?[0-9])+
  merge first char '<'   :  <<
  null  first chars '~','n','N' and '' :  ~ | null | Null | NULL | (empty)
  timestamp first chars '0123456789'
        [0-9]{4}-[0-9]{2}-[0-9]{2}
        |[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}([Tt]|[ \\t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(\\.[0-9]*)?([ \\t]*(Z|[-+][0-9]{1,2}(:[0-9]{2})?))?
  value first char '='   :  =
  yaml  first chars '!','&','*'  :  ! | & | *
Also DEFAULT_SCALAR_TAG / DEFAULT_SEQUENCE_TAG / DEFAULT_MAPPING_TAG
('tag:yaml.org,2002:str' / ':seq' / ':map') and the resolve() signature
resolve(NodeClass, value, implicit) per PORTING.md. Include descendResolver and
ascendResolver (no path resolvers are registered, so they can stay simple but
must exist and be no-ops when yamlPathResolvers is empty).

Sanity-check a few resolutions against the binary: '1' -> int, '1.5e3' -> str,
'.inf' -> float, '12:30' -> int 750, '2021-01-01' -> timestamp, 'on' -> bool,
'0x1F' -> 31, '017' -> 15, '0o17' -> str.

composer.mjs: checkNode, getNode, getSingleNode, composeDocument, composeNode,
composeScalarNode, composeSequenceNode, composeMappingNode, plus the anchors
map. Errors: "found undefined alias '...'",
"expected a single document in the stream" + "but found another document",
and the duplicate-anchor "found duplicate anchor ...; first occurrence".
`,
  },
  {
    key: 'constructor',
    files: 'constructor.mjs',
    body: `
Write /output/lib/constructor.mjs exporting ConstructorMixin — a port of
PyYAML's BaseConstructor + SafeConstructor (safe_load is what runs).

BaseConstructor: constructedObjects / recursiveObjects / statePendingObjects /
deepConstruct, checkData, checkState, getData, getSingleData, constructDocument
(including the generator/deferred-construction protocol and the final
constructedObjects reset), constructObject, constructScalar, constructSequence,
constructMapping, constructPairs, plus the yamlConstructors /
yamlMultiConstructors registries and addConstructor/addMultiConstructor.

SafeConstructor: constructScalar (the merge/value-key special case),
flattenMapping (merge '<<' handling and its ConstructorError messages),
constructMapping, constructYamlNull, constructYamlBool, constructYamlInt,
constructYamlFloat, constructYamlBinary, constructYamlTimestamp,
constructYamlOmap, constructYamlPairs, constructYamlSet, constructYamlStr,
constructYamlSeq, constructYamlMap, constructYamlObject, constructUndefined.
Register them for the standard tags exactly as PyYAML does, including the
empty-string tag ('' -> constructUndefined... check PyYAML: the None tag maps to
constructUndefined via addConstructor(None, ...)).

Type mapping (see pytypes.mjs): int -> BigInt, float -> number,
str -> string, bytes -> PyBytes, list -> Array, dict -> PyDict,
omap/pairs entries -> PyTuple, set -> PySet, timestamps -> PyDate/PyDateTime.

constructYamlInt: strip '_', handle leading sign, then '0' / '0b' / '0x' /
leading-'0' octal / sexagesimal ':' / decimal. Use BigInt throughout. A bad
literal must throw PyValueError with CPython's exact wording, e.g.
  invalid literal for int() with base 10: 'abc'
(base 2 / 8 / 16 variants for the prefixed forms).
constructYamlFloat: strip '_', lowercase, sign, '.inf' / '.nan' / sexagesimal /
plain float. A bad literal throws PyValueError:
  could not convert string to float: 'abc'
constructYamlBool: PyYAML's boolValues map (yes/no/true/false/on/off in the
lower/title/upper spellings), looked up on value.toLowerCase().
constructYamlTimestamp: re-match the timestamp pattern by hand (no regex).
PyYAML 6.0 semantics: fractional seconds are TRUNCATED to 6 digits (pad with
zeros, never round); a tz offset produces an AWARE datetime that KEEPS its
offset (do not shift the clock); a bare 'Z' means offset 0; with no time part
return a PyDate.
constructYamlBinary: decodeBase64 from pytypes.mjs -> PyBytes.
Unhashable mapping keys: ConstructorError("while constructing a mapping",
node.startMark, "found unhashable key", keyNode.startMark) — catch the
PyTypeError that pyKey/PyDict throws.

Verify against the binary: '!!int abc' (ValueError traceback, exit 1),
'{a: 1}: v' (unhashable key), '!!binary "aGVsbG8="', '!!set {a, b}',
'!!omap [{a: 1}]', '<<: {a: 1}' merges, '2001-12-14 21:59:43.10 -5',
'2021-01-01T12:00:00.123456789Z' (must truncate to .123456),
'!!timestamp 2021-01-01', '12:30', '=' , '!!python/none x' (undefined tag error).
`,
  },
  {
    key: 'emitter',
    files: 'emitter.mjs',
    body: `
Write /output/lib/emitter.mjs exporting EmitterMixin — a port of PyYAML's
emitter.py. This module decides nearly every visible byte of the output, so it
must be exact.

Constructor options as used by yaml.dump defaults: stream sink, canonical=false,
indent=null -> bestIndent 2, width=null -> bestWidth 80, allowUnicode=false,
lineBreak=null -> '\\n'. Keep PyYAML's fields: states/state, events/event,
indents/indent, flowLevel, rootContext/sequenceContext/mappingContext/
simpleKeyContext, line/column/whitespace/indention, openEnded, analysis, style.

Port every method: emit, needMoreEvents, needEvents, increaseIndent,
expectStreamStart, expectNothing, expectFirstDocument, expectDocumentStart,
expectDocumentEnd, expectDocumentRoot, expectNode, expectAlias, expectScalar,
expectFlowSequence, expectFirstFlowSequenceItem, expectFlowSequenceItem,
expectFlowMapping, expectFirstFlowMappingKey, expectFlowMappingKey,
expectFlowMappingSimpleValue, expectFlowMappingValue, expectBlockSequence,
expectFirstBlockSequenceItem, expectBlockSequenceItem, expectBlockMapping,
expectFirstBlockMappingKey, expectBlockMappingKey, expectBlockMappingSimpleValue,
expectBlockMappingValue, checkEmptySequence, checkEmptyMapping,
checkEmptyDocument, checkSimpleKey, processAnchor, processTag,
chooseScalarStyle, processScalar, prepareVersion, prepareTagHandle,
prepareTagPrefix, prepareTag, prepareAnchor, analyzeScalar, flushStream,
writeStreamStart, writeStreamEnd, writeIndicator, writeIndent, writeLineBreak,
writeVersionDirective, writeTagDirective, writeSingleQuoted, writeDoubleQuoted,
determineBlockHints, writeFolded, writeLiteral, writePlain, and the
ScalarAnalysis record.

Details confirmed against the reference binary — your port must reproduce them:
- A root-level PLAIN scalar sets openEnded, so the stream ends with '...' on its
  own line. 'plain' dumps to "plain\\n...\\n". A root-level quoted/literal
  scalar or any collection does NOT get the '...'.
- writeSingleQuoted emits a run of line breaks as ONE EXTRA break followed by the
  breaks themselves, then an indent. So the str "literal\\ntext" dumps as
  "'literal\\n\\n  text'" at root (indent 2 from increaseIndent(flow=true)).
- allowUnicode is false, so every non-ASCII character is escaped in
  double-quoted style with UPPERCASE hex: the 5-character Japanese greeting
  dumps as "\\u3053\\u3093\\u306B\\u3061\\u306F" (use EMIT_ESCAPES from
  chars.mjs, then \\xNN / \\uNNNN / \\UNNNNNNNN with uppercase hex digits).
- bestWidth 80 controls plain/quoted folding: 'longkey: <90 chars of words>'
  wraps onto a continuation line indented by 2.
- Block sequences nested directly under a block mapping key are written
  INDENTLESS (increaseIndent(flow=false, indentless=true)), so
  'key:\\n- 1\\n- 2' round-trips with the dashes at column 0.
- Empty collections emit '{}' and '[]' even with default_flow_style=false.
- analyzeScalar with allowUnicode false marks any non-ASCII as
  specialCharacters, which forces double-quoted style.

Do NOT write a literal backslash-u escape anywhere in the file (see PORTING.md);
build U+2028 / U+2029 / U+0085 / U+00A0 from chars.mjs.

Cross-check with the binary using inputs that round-trip through the loader,
e.g.: 'plain' , '"1"' , '|\\n  a\\n  b' , 'key:\\n- 1\\n- 2' , '{}' , '[]' ,
'a: &x [1,2]\\nb: *x' , a >80-char plain scalar, and a non-ASCII scalar.
`,
  },
  {
    key: 'representer+serializer',
    files: 'representer.mjs and serializer.mjs',
    body: `
Write /output/lib/representer.mjs (export RepresenterMixin) and
/output/lib/serializer.mjs (export SerializerMixin) — ports of PyYAML's
representer.py and serializer.py.

serializer.mjs: ANCHOR_TEMPLATE 'id%03d', open/close/serialize,
anchorNode (the two-pass anchor discovery that only assigns an anchor to a node
reached more than once), generateAnchor, serializeNode. serializeNode computes
  detectedTag = this.resolve(ScalarNode, node.value, [true, false])
  defaultTag  = this.resolve(ScalarNode, node.value, [false, true])
  implicit = [node.tag === detectedTag, node.tag === defaultTag]
for scalars, and [node.tag === this.resolve(Kind, null, true)] for collections,
then emits the matching event. Errors: SerializerError('serializer is closed'),
('serializer is already opened'), ('open() first'). Anchors are numbered in
first-encounter order, so 'a: &x [1,2]\\nb: *x' emits '&id001' / '*id001'.

representer.mjs: BaseRepresenter (representedObjects, objectKeeper, aliasKey,
represent, representData, representKey, representScalar, representSequence,
representMapping, ignoreAliases, and the yamlRepresenters/yamlMultiRepresenters
registries) plus SafeRepresenter and the extra Representer entries.

Because yaml.dump uses the FULL Dumper, tuple must be represented as
'tag:yaml.org,2002:python/tuple' (a sequence). Verify: '!!omap [{a: 1}]' dumps as
  - !!python/tuple
    - a
    - 1

Representers needed for everything safe_load can produce (see pytypes.mjs for
the JS encoding of each Python type):
  null -> representScalar('tag:yaml.org,2002:null', 'null')
  bool -> 'true'/'false'
  BigInt (Python int) -> its decimal string
  number (Python float) -> pyReprFloat, then PyYAML's fixups: NaN -> '.nan',
    +Inf -> '.inf', -Inf -> '-.inf', otherwise lowercase repr and, if the text
    has no '.' but has an 'e', insert '.0' before the 'e' (so 1e+17 -> 1.0e+17).
  string -> representStr
  PyBytes -> representBinary: encodeBase64Wrapped, tag ':binary', style '|'
  Array -> representList (sequence), PyTuple -> ':python/tuple'
  PyDict -> representDict (':map'), PySet -> representSet (':set', a mapping of
    each member to null), PyDate -> ':timestamp' with isoformat(),
    PyDateTime -> ':timestamp' with isoformat(' ')
  ignoreAliases returns true for null, and for the immutable scalars PyYAML
  lists (None, (), and str/bytes/bool/int/float) — port PyYAML's exact predicate.

representMapping must reproduce PyYAML's sort attempt: build the item list, try
to sort it, and SILENTLY KEEP INSERTION ORDER if any comparison raises. Use
pySortInPlace + pyLessThan from pytypes.mjs and catch PyTypeError; compare
[key, value] pairs element-wise the way Python compares tuples. This is why
'!!set {b, a}' comes out alphabetised.

representMapping/representSequence also set bestStyle and honour
defaultFlowStyle (which is false here), and mark a mapping as flow when it is
empty.

Verify against the binary: '{b: 2, a: 1}' (sorted? check!), '!!set {b, a}',
'[1.0, 1e17, 1.0e+17, 0.00001, -0.0]', '!!binary "aGVsbG8="',
'!!omap [{a: 1}]', 'a: &x {p: 1}\\nb: *x', '2021-01-01 12:00:00+05:00'.
Note carefully whether plain dicts come out sorted or in document order and make
your port match.
`,
  },
  {
    key: 'argparse',
    files: 'argparse.mjs',
    body: `
Write /output/lib/argparse.mjs exporting a small, focused replica of the Python
argparse behaviour that /workspace/dataset/test4.py relies on:

  parser = argparse.ArgumentParser()
  parser.add_argument('--a', type=str, required=True)
  args = parser.parse_args()

The program name in messages is the executable's basename. For our port the
entry file is /output/test4.mjs but messages must read 'test4_executable' ONLY
if that is what the reference prints — CHECK, and expose the prog name as a
constructor/function option so the entry point can pass it in.

Probe the reference binary for every case and match stdout/stderr and exit code:
  (no args)            -> usage + "error: the following arguments are required: --a", exit 2
  -h / --help          -> usage + options block, exit 0
  --a x                -> ok
  --a=x                -> ok
  --a x --a y          -> last wins
  --a x extra          -> "error: unrecognized arguments: extra", exit 2
  --a                  -> "error: argument --a: expected one argument", exit 2
  --                   -> also "expected one argument"? verify
  --a -1  / --a -1.5   -> ACCEPTED as values
  --a -abc / --a -.inf -> REJECTED with "expected one argument", exit 2
  --a '- 1'            -> accepted (contains a space)
  --b 1                -> verify
The accept/reject rule is argparse's: a token starting with '-' is treated as a
value if it is exactly a negative number (argparse's matcher is ^-\\d+$ or
^-\\d*\\.\\d+$ and applies only when the parser has no options that look like
negative numbers), or if it contains a space. Implement that matcher WITHOUT
regex.
Reproduce the exact usage line and help text, byte for byte, including the blank
line and two-space indents. Note the Python version's heading is 'options:'
(3.10+) rather than 'optional arguments:' — confirm against the binary.

Export something like:
  export class ArgumentParser { constructor({prog}) ; addArgument(...) ; parseArgs(argv) }
or a simpler purpose-built function — your call, but it must be reusable and it
must not print or exit on its own in a way the entry point cannot control.
Prefer: throw/return a structured result plus helper methods the entry point
calls to print usage and pick the exit code. Writing to process.stdout /
process.stderr and returning an exit code is acceptable.

Also export a helper the entry point can use to print a Python-style traceback
for an escaping YAMLError, since the reference prints a traceback to stderr and
exits 1. Reproduce the shape:
  Traceback (most recent call last):
    File "test4.py", line 8, in <module>
  ...
  yaml.parser.ParserError: <message>
Use the error's .qualifiedName and .message. Match the reference's frame list as
closely as is reasonable (run it to see), but the important invariants are:
empty stdout, exit code 1, and the final 'qualifiedName: message' line.
`,
  },
]

phase('Port')
const results = await pipeline(
  MODULES,
  (m) => agent(COMMON + m.body, {
    label: `port:${m.key}`,
    phase: 'Port',
    schema: REPORT_SCHEMA,
  }),
  (report, m) => agent(`
You are reviewing a freshly written JavaScript port of part of PyYAML for
fidelity. Read /workspace/spec/PORTING.md first, then read ${m.files} in
/output/lib/ closely.

The author's own notes: ${report ? report.summary : '(none)'}
Their stated uncertainties: ${report && report.uncertainties.length ? report.uncertainties.join('; ') : '(none)'}

Your job is to find and FIX real porting defects in those files. Look for:
- logic that silently diverges from PyYAML (off-by-one on indent/column, a
  missing branch of a fetch_*/expect_*/construct_* method, a dropped error case,
  wrong operator precedence when a Python 'and/or' became '&&/||')
- hand-written matchers that do not accept exactly the language the original
  regex accepted (test the boundaries)
- Python truthiness or int-division semantics that do not survive translation
- constraint violations: any RegExp use, any JSON reference, any non-relative
  import, any literal backslash-u escape in the file, a missing .mjs suffix
- Python's 'is None' vs falsy: a JS 'if (x)' where PyYAML wrote 'if x is not None'
  and 0 / '' / false are legitimate values

Verify behaviour against the reference binary
(/workspace/dataset/test4_executable --a '...') wherever a question is settleable
that way. Do NOT run python.

Edit the files in place to fix what you find. Do not touch other modules, and do
not rewrite working code for style. If a whole-pipeline test is impossible
because sibling modules are still landing, reason locally and note it.

Report the defects you fixed and anything still suspicious.
`, {
    label: `review:${m.key}`,
    phase: 'Fidelity review',
    schema: {
      type: 'object',
      properties: {
        fixed: { type: 'array', items: { type: 'string' } },
        suspicious: { type: 'array', items: { type: 'string' } },
      },
      required: ['fixed', 'suspicious'],
      additionalProperties: false,
    },
  }),
)

return {
  ports: MODULES.map((m, i) => ({ key: m.key, review: results[i] })),
}
